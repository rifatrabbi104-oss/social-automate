<?php
/**
 * Multi-Platform High-Speed Webhook Receiver & Proxy (Alwaysdata)
 * ----------------------------------------------------------------
 * Handles Telegram, Facebook Page (DMs & Comments), WhatsApp, and Instagram.
 * Implements Global AI Mode, Per-Chat Handover, Instant Admin Alerts,
 * and seamless Failover to Cloudflare Worker.
 */

header('Content-Type: application/json; charset=UTF-8');

// ১. কনফিগ এবং ডিপেন্ডেন্সি লোড
$config = require __DIR__ . '/config.php';
require_once __DIR__ . '/db_client.php';
require_once __DIR__ . '/ai_engine.php';
require_once __DIR__ . '/notifier.php';

$d1Client    = new D1Client($config['cloudflare']);
$aiEngine    = new AIEngine($config['gemini']);
$notifier    = new AdminNotifier($config['admin_alert']);

// ২. মেটা / ফেসবুক Webhook Verification Handshake (GET Request)
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $hubMode      = $_GET['hub_mode'] ?? '';
    $hubToken     = $_GET['hub_verify_token'] ?? '';
    $hubChallenge = $_GET['hub_challenge'] ?? '';

    if ($hubMode === 'subscribe' && $hubToken === $config['platforms']['meta_verify_token']) {
        echo $hubChallenge;
        exit;
    }

    echo json_encode(['status' => 'online', 'service' => 'Alwaysdata Social Proxy', 'timestamp' => time()]);
    exit;
}

// ৩. ইনকামিং রিকোয়েস্ট বডি রিড
$rawBody = file_get_contents('php://input');
$data    = json_decode($rawBody, true);

if (!$data) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON']);
    exit;
}

try {
    $platform        = 'unknown';
    $senderId        = '';
    $senderName      = 'Customer';
    $incomingText    = '';
    $conversationId  = '';
    $isComment       = false;
    $commentId       = null;

    // ৪. প্ল্যাটফর্ম ডিটেকশন ও পার্সিং

    // [A] টেলিগ্রাম (Telegram Bot Update)
    if (isset($data['message']['text'])) {
        $platform       = 'telegram';
        $senderId       = (string)$data['message']['chat']['id'];
        $senderName     = trim(($data['message']['from']['first_name'] ?? '') . ' ' . ($data['message']['from']['last_name'] ?? '')) ?: 'Telegram User';
        $incomingText   = $data['message']['text'];
        $conversationId = "tg_{$senderId}";
    }

    // [B] ফেসবুক পেজ মেসেঞ্জার (Meta Messenger DM)
    elseif (isset($data['entry'][0]['messaging'][0]['message']['text'])) {
        $platform       = 'facebook';
        $messaging      = $data['entry'][0]['messaging'][0];
        $senderId       = (string)$messaging['sender']['id'];
        $incomingText   = $messaging['message']['text'];
        $senderName     = "FB User " . substr($senderId, -4);
        $conversationId = "fb_{$senderId}";
    }

    // [C] ফেসবুক পোস্ট কমেন্ট (Facebook Feed Comment)
    elseif (isset($data['entry'][0]['changes'][0]['value']['item']) && $data['entry'][0]['changes'][0]['value']['item'] === 'comment') {
        $change = $data['entry'][0]['changes'][0]['value'];
        if ($change['verb'] === 'add' && !empty($change['message'])) {
            $platform       = 'facebook';
            $isComment      = true;
            $commentId      = $change['comment_id'];
            $senderId       = (string)$change['from']['id'];
            $senderName     = $change['from']['name'] ?? 'Commenter';
            $incomingText   = $change['message'];
            $conversationId = "fb_cmt_{$senderId}";
        }
    }

    // [D] হোয়াটসঅ্যাপ ক্লাউড এপিআই (WhatsApp Cloud API)
    elseif (isset($data['entry'][0]['changes'][0]['value']['messages'][0]['text']['body'])) {
        $platform       = 'whatsapp';
        $msg            = $data['entry'][0]['changes'][0]['value']['messages'][0];
        $senderId       = (string)$msg['from'];
        $incomingText   = $msg['text']['body'];
        $senderName     = "WhatsApp " . substr($senderId, -4);
        $conversationId = "wa_{$senderId}";
    }

    // যদি কোনো টেক্সট বা সাপোর্টেড মেসেজ না পাওয়া যায়
    if (empty($incomingText) || empty($conversationId)) {
        echo json_encode(['status' => 'ignored_no_text']);
        exit;
    }

    // ৫. কাস্টমারের মেসেজ Cloudflare D1 ডেটাবেসে সেভ
    $d1Client->upsertConversation($conversationId, $platform, $senderId, $senderName, $incomingText, 0);
    $d1Client->saveMessage($conversationId, 'customer', $incomingText);

    // ৬. হ্যান্ডওভার চেক
    // রুল ১: গ্লোবাল এডমিন মোড অন আছে কিনা (যদি অ্যাডমিন সব চ্যাট নিজে হ্যান্ডেল করতে চায়)
    $globalAiActive = $d1Client->isGlobalAiEnabled();
    // রুল ২: নির্দিষ্ট এই চ্যাটের জন্য অ্যাডমিন টেকওভার অন আছে কিনা
    $chatAdminTakeover = $d1Client->isAdminTakeover($conversationId);

    // যদি গ্লোবাল মোড অফ থাকে অথবা এই চ্যাট অ্যাডমিন টেকওভার করে থাকে -> AI চুপ থাকবে
    if (!$globalAiActive || $chatAdminTakeover) {
        echo json_encode([
            'status' => 'human_mode_active',
            'message' => 'AI reply paused due to Admin Takeover.'
        ]);
        exit;
    }

    // ৭. AI রিপ্লাই তৈরি (AI কখনো থামবে না, অলওয়েজ উত্তর দেবে)
    $chatHistory = $d1Client->getRecentMessages($conversationId, 6);
    $aiResult    = $aiEngine->generateReply($incomingText, $chatHistory);
    $replyText   = $aiResult['reply'];

    // ৮. যদি কাস্টমার অ্যাডমিনকে খুঁজে থাকে -> ব্যাকগ্রাউন্ডে অ্যাডমিনের টেলিগ্রামে DM অ্যালার্ট পাঠানো
    if (!empty($aiResult['needs_admin_alert'])) {
        $d1Client->upsertConversation($conversationId, $platform, $senderId, $senderName, $incomingText, 1);
        $notifier->sendTelegramAlert(
            $senderName, 
            $platform, 
            $incomingText, 
            $conversationId, 
            $aiResult['alert_reason'] ?: 'Customer requested human assistance'
        );
    }

    // ৯. কাস্টমারকে উত্তর পাঠানো (টেলিগ্রাম বা মেটা)
    $sentSuccess = false;

    if ($platform === 'telegram') {
        $tgToken = $config['platforms']['telegram_bot_token'];
        $tgUrl   = "https://api.telegram.org/bot{$tgToken}/sendMessage";
        $ch = curl_init($tgUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode([
                'chat_id' => $senderId,
                'text'    => $replyText
            ]),
            CURLOPT_TIMEOUT        => 4,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json']
        ]);
        curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $sentSuccess = ($httpCode === 200);
    } 
    elseif ($platform === 'facebook' && !$isComment) {
        $pageToken = $config['platforms']['meta_page_access_token'];
        $fbUrl     = "https://graph.facebook.com/v19.0/me/messages?access_token={$pageToken}";
        $ch = curl_init($fbUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode([
                'recipient' => ['id' => $senderId],
                'message'   => ['text' => $replyText]
            ]),
            CURLOPT_TIMEOUT        => 4,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json']
        ]);
        curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $sentSuccess = ($httpCode === 200);
    }
    elseif ($platform === 'facebook' && $isComment && $commentId) {
        // পোস্ট কমেন্টে পাবলিক অটো-রিপ্লাই
        $pageToken = $config['platforms']['meta_page_access_token'];
        $fbUrl     = "https://graph.facebook.com/v19.0/{$commentId}/comments?access_token={$pageToken}";
        $ch = curl_init($fbUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode(['message' => $replyText]),
            CURLOPT_TIMEOUT        => 4,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json']
        ]);
        curl_exec($ch);
        curl_close($ch);
        $sentSuccess = true;
    }

    // ১০. AI-এর দেওয়া উত্তর D1-এ সেভ করা
    $d1Client->saveMessage($conversationId, 'ai', $replyText);

    echo json_encode([
        'status'  => 'success',
        'replied' => true,
        'ai_reply' => $replyText,
        'admin_alerted' => $aiResult['needs_admin_alert']
    ]);

} catch (Throwable $e) {
    // ১১. ফলব্যাক মেকানিজম (যদি কোনো অপ্রত্যাশিত এরর হয় -> Cloudflare Worker-এ পুশ)
    error_log("[Alwaysdata Webhook Error] " . $e->getMessage());

    $workerFallback = $config['cloudflare']['worker_fallback_url'] ?? '';
    if (!empty($workerFallback) && strpos($workerFallback, 'social-automate-fallback') === false) {
        $ch = curl_init($workerFallback);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $rawBody,
            CURLOPT_TIMEOUT        => 3,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'X-Fallback-Source: alwaysdata_error'
            ]
        ]);
        curl_exec($ch);
        curl_close($ch);
    }

    http_response_code(200); // টেলিগ্রাম/ফেসবুককে ২০০ পাঠাই যেন বারবার রিট্রাই না করে
    echo json_encode(['status' => 'fallback_triggered', 'error' => $e->getMessage()]);
}

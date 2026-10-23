<?php
/**
 * Admin Instant Alert & Notification Engine
 * ------------------------------------------
 * Sends real-time alerts directly to the Admin's personal Telegram Bot DM.
 * Features 1-click deep links to the Cloudflare Pages Dashboard for instant takeover.
 */

class AdminNotifier {
    private $botToken;
    private $adminChatId;
    private $dashboardUrl;

    public function __construct(array $config) {
        $this->botToken     = $config['telegram_bot_token'] ?? '';
        $this->adminChatId  = $config['admin_chat_id'] ?? '';
        $this->dashboardUrl = rtrim($config['dashboard_base_url'] ?? 'https://your-dashboard.pages.dev', '/');
    }

    /**
     * অ্যাডমিনের ব্যক্তিগত টেলিগ্রামে ইনস্ট্যান্ট পুশ অ্যালার্ট পাঠানো
     */
    public function sendTelegramAlert(string $customerName, string $platform, string $incomingMessage, string $conversationId, string $reason = 'Customer requested Human Admin') {
        if (empty($this->botToken) || empty($this->adminChatId) || $this->botToken === 'YOUR_ADMIN_BOT_TOKEN') {
            error_log("[AdminNotifier] Telegram Bot Token or Admin Chat ID not configured. Skipping alert.");
            return false;
        }

        $platformIcon = match(strtolower($platform)) {
            'telegram'  => '✈️ Telegram',
            'facebook'  => '🔵 Facebook Page',
            'whatsapp'  => '🟢 WhatsApp',
            'instagram' => '📸 Instagram',
            'tiktok'    => '🎵 TikTok',
            default     => '💬 Social Chat'
        };

        $chatLink = "{$this->dashboardUrl}#chat-{$conversationId}";

        $text  = "🚨 *[ADMIN ALERT: জরুরি কাস্টমার]*\n\n";
        $text .= "👤 *কাস্টমার:* " . htmlspecialchars($customerName) . "\n";
        $text .= "📱 *প্ল্যাটফর্ম:* {$platformIcon}\n";
        $text .= "⚠️ *কারণ:* " . htmlspecialchars($reason) . "\n";
        $text .= "💬 *মেসেজ:* \n_\"" . htmlspecialchars(mb_substr($incomingMessage, 0, 300)) . "\"_\n\n";
        $text .= "💡 *নোট:* AI কাস্টমারকে উত্তর দিয়ে চ্যাট চালিয়ে যাচ্ছে। আপনি চাইলে ড্যাশবোর্ড থেকে টেকওভার করতে পারেন।\n";
        $text .= "🔗 [ড্যাশবোর্ডে চ্যাট ওপেন করুন]({$chatLink})";

        $apiUrl = "https://api.telegram.org/bot{$this->botToken}/sendMessage";
        $postData = [
            'chat_id'                  => $this->adminChatId,
            'text'                     => $text,
            'parse_mode'               => 'Markdown',
            'disable_web_page_preview' => false,
            'reply_markup'             => json_encode([
                'inline_keyboard' => [
                    [
                        ['text' => '🚀 Open in Dashboard', 'url' => $chatLink]
                    ]
                ]
            ])
        ];

        $ch = curl_init($apiUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($postData),
            CURLOPT_TIMEOUT        => 3,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json']
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return $httpCode === 200;
    }
}

<?php
/**
 * Google Gemini AI Engine for Social Automation
 * ----------------------------------------------
 * Generates dynamic, context-aware responses in Bengali/English.
 * ALWAYS generates an answer (never pauses on its own) while detecting
 * escalation triggers to alert the human admin in the background.
 */

class AIEngine {
    private $apiKey;
    private $model;
    private $systemPrompt;
    private $apiUrl;

    public function __construct(array $config) {
        $this->apiKey       = $config['api_key'] ?? '';
        $this->model        = $config['model'] ?? 'gemini-1.5-flash';
        $this->systemPrompt = $config['system_prompt'] ?? "You are a polite, helpful customer service agent.";
        $this->apiUrl       = "https://generativelanguage.googleapis.com/v1beta/models/{$this->model}:generateContent?key={$this->apiKey}";
    }

    /**
     * AI রেসপন্স জেনারেট করা এবং অ্যাডমিন অ্যালার্ট ডিটেক্ট করা
     * 
     * @return array ['reply' => string, 'needs_admin_alert' => bool, 'alert_reason' => string]
     */
    public function generateReply(string $incomingText, array $chatHistory = []): array {
        // ১. অ্যাডমিন অ্যালার্ট ডিটেকশন (বাংলা, বাংলিশ ও ইংরেজি কিওয়ার্ডস)
        $needsAlert = false;
        $alertReason = '';
        $alertKeywords = [
            'admin', 'manager', 'owner', 'human', 'manush', 
            'kotha bolbo', 'kotha bolte chai', 'call den', 'phone den', 
            'number dao', 'complaint', 'prostab', 'urgent', 'emergency',
            'order cancel', 'taka ferot', 'refund', 'baje service'
        ];

        $lowerText = mb_strtolower($incomingText);
        foreach ($alertKeywords as $kw) {
            if (mb_strpos($lowerText, $kw) !== false) {
                $needsAlert = true;
                $alertReason = "Customer mentioned keyword: '{$kw}'";
                break;
            }
        }

        // ২. যদি API Key সেট না থাকে, স্মার্ট ফলব্যাক উত্তর দেওয়া (কখনো থেমে থাকবে না)
        if (empty($this->apiKey) || $this->apiKey === 'YOUR_GEMINI_API_KEY') {
            $fallbackReply = "ধন্যবাদ আপনার বার্তার জন্য! আমাদের একজন প্রতিনিধি আপনার সাথে দ্রুত যোগাযোগ করবেন। আপনি কি প্রোডাক্টের দাম বা অর্ডার সম্পর্কে কোনো নির্দিষ্ট তথ্য জানতে চান?";
            return [
                'reply'              => $fallbackReply,
                'needs_admin_alert'  => $needsAlert,
                'alert_reason'       => $alertReason ?: 'Standard customer inquiry'
            ];
        }

        // ৩. Gemini 1.5 Flash এর জন্য কনটেক্সট প্রম্পট তৈরি
        $contents = [];
        
        // হিস্ট্রি যোগ করা (কনটেক্সট বজায় রাখার জন্য)
        foreach ($chatHistory as $msg) {
            $role = ($msg['sender_type'] === 'customer') ? 'user' : 'model';
            $contents[] = [
                'role'  => $role,
                'parts' => [['text' => $msg['message_text']]]
            ];
        }

        // বর্তমান মেসেজ যোগ করা
        $contents[] = [
            'role'  => 'user',
            'parts' => [['text' => $incomingText]]
        ];

        $payload = [
            'system_instruction' => [
                'parts' => [
                    ['text' => $this->systemPrompt]
                ]
            ],
            'contents' => $contents,
            'generationConfig' => [
                'temperature'     => 0.7,
                'topK'            => 40,
                'topP'            => 0.95,
                'maxOutputTokens' => 500,
            ]
        ];

        // ৪. Gemini API কল
        $ch = curl_init($this->apiUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($payload),
            CURLOPT_TIMEOUT        => 8,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json']
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode === 200 && $response) {
            $data = json_decode($response, true);
            $aiText = $data['candidates'][0]['content']['parts'][0]['text'] ?? null;
            if ($aiText) {
                return [
                    'reply'             => trim($aiText),
                    'needs_admin_alert' => $needsAlert,
                    'alert_reason'      => $alertReason
                ];
            }
        }

        // ৫. ফলব্যাক (API সাময়িক ডাউন হলেও AI উত্তর দেবে, থেমে থাকবে না)
        $safeReply = "ধন্যবাদ! আমরা আপনার মেসেজটি পেয়েছি। বিস্তারিত তথ্যের জন্য আমাদের ক্যাটালগ ও পেইজে চোখ রাখুন অথবা নির্দিষ্ট কোনো প্রশ্ন থাকলে জানান।";
        return [
            'reply'             => $safeReply,
            'needs_admin_alert' => true,
            'alert_reason'      => 'Gemini API timeout or rate-limit fallback'
        ];
    }
}

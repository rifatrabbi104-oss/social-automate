<?php
/**
 * Cloudflare D1 Database REST Client for Alwaysdata
 * --------------------------------------------------
 * Interacts with Cloudflare D1 via Cloudflare Client v4 API.
 * Includes local SQLite fallback if internet connection or Cloudflare API is slow.
 */

class D1Client {
    private $accountId;
    private $databaseId;
    private $apiToken;
    private $apiUrl;
    private $localDb = null;

    public function __construct(array $config) {
        $this->accountId  = $config['account_id'];
        $this->databaseId = $config['database_id'];
        $this->apiToken   = $config['api_token'];
        $this->apiUrl     = "https://api.cloudflare.com/client/v4/accounts/{$this->accountId}/d1/database/{$this->databaseId}/query";

        // লোকাল ব্যাকআপের জন্য ছোট SQLite ফাইল (ফলব্যাক ক্যাশ)
        try {
            $dbPath = __DIR__ . '/local_cache.sqlite';
            $this->localDb = new PDO("sqlite:$dbPath");
            $this->localDb->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $this->initLocalTables();
        } catch (Exception $e) {
            // Local SQLite optional
        }
    }

    private function initLocalTables() {
        if (!$this->localDb) return;
        $this->localDb->exec("
            CREATE TABLE IF NOT EXISTS local_conversations (
                id TEXT PRIMARY KEY,
                admin_takeover INTEGER DEFAULT 0,
                needs_attention INTEGER DEFAULT 0,
                updated_at INTEGER
            );
        ");
    }

    /**
     * Cloudflare D1 এ SQL Query এক্সিকিউট করা
     */
    public function query(string $sql, array $params = []) {
        if (empty($this->accountId) || empty($this->apiToken) || $this->accountId === 'YOUR_CLOUDFLARE_ACCOUNT_ID') {
            return $this->queryLocalFallback($sql, $params);
        }

        $payload = json_encode([
            'sql'    => $sql,
            'params' => $params
        ]);

        $ch = curl_init($this->apiUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_TIMEOUT        => 4, // সুপার ফাস্ট রেসপন্স (৪ সেকেন্ড ম্যাক্স)
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . $this->apiToken,
                'Content-Type: application/json'
            ]
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode === 200 && $response) {
            $data = json_decode($response, true);
            if (!empty($data['result'][0]['results'])) {
                return $data['result'][0]['results'];
            }
            return [];
        }

        // যদি কোনো কারণে ক্লাউডফ্লেয়ার ডি১ রেসপন্স না করে, লোকাল ফলব্যাক চলবে
        return $this->queryLocalFallback($sql, $params);
    }

    private function queryLocalFallback(string $sql, array $params = []) {
        if (!$this->localDb) return [];
        try {
            $stmt = $this->localDb->prepare($sql);
            $stmt->execute($params);
            return $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (Exception $e) {
            return [];
        }
    }

    /**
     * গ্লোবাল AI মোড চেক (Active নাকি Admin Mode)
     */
    public function isGlobalAiEnabled(): bool {
        $result = $this->query("SELECT value FROM system_settings WHERE key = 'global_ai_mode' LIMIT 1;");
        if (!empty($result) && isset($result[0]['value'])) {
            return $result[0]['value'] === '1';
        }
        return true; // বাই-ডিফল্ট AI সক্রিয় থাকবে
    }

    /**
     * নির্দিষ্ট চ্যাটে অ্যাডমিন টেকওভার আছে কিনা চেক
     */
    public function isAdminTakeover(string $conversationId): bool {
        $result = $this->query("SELECT admin_takeover FROM conversations WHERE id = ? LIMIT 1;", [$conversationId]);
        if (!empty($result) && isset($result[0]['admin_takeover'])) {
            return (int)$result[0]['admin_takeover'] === 1;
        }
        return false;
    }

    /**
     * কনভারসেশন সেভ বা আপডেট
     */
    public function upsertConversation(string $id, string $platform, string $senderId, string $senderName, string $lastMessage, int $needsAttention = 0) {
        $sql = "INSERT INTO conversations (id, platform, sender_id, sender_name, last_message, needs_attention, last_message_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET 
                    last_message = excluded.last_message,
                    needs_attention = MAX(conversations.needs_attention, excluded.needs_attention),
                    last_message_at = CURRENT_TIMESTAMP;";
        
        $this->query($sql, [$id, $platform, $senderId, $senderName, $lastMessage, $needsAttention]);
    }

    /**
     * চ্যাট মেসেজ সেভ করা
     */
    public function saveMessage(string $conversationId, string $senderType, string $text) {
        $msgId = uniqid('msg_', true);
        $sql = "INSERT INTO messages (id, conversation_id, sender_type, message_text, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP);";
        $this->query($sql, [$msgId, $conversationId, $senderType, $text]);
    }

    /**
     * AI প্রম্পটের জন্য সাম্প্রতিক ৫-৬টি মেসেজ হিস্ট্রি আনা
     */
    public function getRecentMessages(string $conversationId, int $limit = 6): array {
        $sql = "SELECT sender_type, message_text FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?;";
        $rows = $this->query($sql, [$conversationId, $limit]);
        return array_reverse($rows);
    }
}

-- ========================================================
-- Social Automate - Cloudflare D1 Database Schema
-- Designed for High Efficiency, AI Auto-Reply & Admin Handover
-- ========================================================

-- ১. গ্লোবাল সিস্টেম সেটিংস (Global AI Mode, Admin Alerts)
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ডিফল্ট সেটিংস ইনসার্ট (Global AI Mode চালু রাখা)
INSERT OR IGNORE INTO system_settings (key, value) VALUES 
('global_ai_mode', '1'),                     -- 1 = AI Active, 0 = Admin Global Mode (AI Paused)
('ai_model', 'gemini-1.5-flash'),            -- Default AI model
('admin_telegram_chat_id', ''),              -- Admin's personal Telegram Chat ID for alerts
('admin_notification_channel', 'telegram'),  -- 'telegram' or 'email'
('system_prompt', 'You are a helpful and polite social media customer service assistant for our business. Answer questions warmly and accurately in Bengali and English (Banglish friendly). If a customer asks to speak with the manager or human admin, politely inform them that an admin has been notified and will assist soon, while still answering whatever questions you can.');

-- ২. কানেক্টেড সোশ্যাল অ্যাকাউন্টস
CREATE TABLE IF NOT EXISTS social_accounts (
    id TEXT PRIMARY KEY,                         -- e.g. 'fb_page_12345', 'tg_bot_main'
    platform TEXT NOT NULL,                     -- 'telegram', 'facebook', 'instagram', 'whatsapp', 'tiktok'
    account_name TEXT NOT NULL,
    account_id TEXT NOT NULL,                   -- Platform specific Page ID or Bot ID
    access_token TEXT NOT NULL,
    webhook_secret TEXT,
    status TEXT DEFAULT 'active',               -- 'active', 'paused', 'expired'
    metadata TEXT,                              -- Additional JSON configuration
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ৩. কাস্টমার চ্যাট কনভারসেশন ও হ্যান্ডওভার স্টেট
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,                         -- Unique ID, e.g. 'tg_987654321', 'fb_10203040'
    platform TEXT NOT NULL,                     -- 'telegram', 'facebook', 'whatsapp', 'instagram'
    sender_id TEXT NOT NULL,                    -- Platform user/chat ID
    sender_name TEXT DEFAULT 'Customer',        -- Customer's display name or username
    admin_takeover INTEGER DEFAULT 0,           -- 0 = AI Active, 1 = Admin has taken over this chat
    needs_attention INTEGER DEFAULT 0,          -- 1 = Customer asked for human/critical issue, 0 = Normal
    last_message TEXT,
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ৪. চ্যাট মেসেজ হিস্ট্রি
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,                         -- UUID or platform message ID
    conversation_id TEXT NOT NULL,
    sender_type TEXT NOT NULL,                  -- 'customer', 'ai', 'admin'
    message_text TEXT NOT NULL,
    media_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- ৫. শিডিউল্ড পোস্টস (GitHub Actions দিয়ে ফ্রি-তে পাবলিশ হবে)
CREATE TABLE IF NOT EXISTS scheduled_posts (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    media_urls TEXT,                            -- JSON array of image/video URLs
    target_platforms TEXT NOT NULL,             -- JSON array ['facebook', 'telegram', 'tiktok']
    scheduled_at TIMESTAMP NOT NULL,
    status TEXT DEFAULT 'pending',              -- 'pending', 'publishing', 'published', 'failed'
    execution_result TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ৬. অটোমেশন রুলস (কমেন্ট অটো-রিপ্লাই ও স্পেশাল কিওয়ার্ড ফিল্টার)
CREATE TABLE IF NOT EXISTS automation_rules (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,                     -- 'facebook', 'instagram', 'tiktok', 'all'
    trigger_type TEXT NOT NULL,                 -- 'comment_keyword', 'comment_all', 'dm_keyword'
    keywords TEXT,                              -- Comma separated e.g. 'price,dam koto,kivabe nibo'
    public_reply_template TEXT,                 -- Post comment reply
    send_private_dm INTEGER DEFAULT 0,          -- 1 = Send DM to commenter, 0 = No
    private_dm_template TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ৭. অ্যাক্টিভিটি ও ফলব্যাক লগস
CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,                       -- 'alwaysdata', 'worker_fallback', 'github_action', 'admin'
    event_type TEXT NOT NULL,                   -- 'ai_reply', 'admin_takeover', 'post_published', 'error', 'admin_alert'
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ইনডেক্সিং (দ্রুত কুয়েরির জন্য)
CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_posts_pending ON scheduled_posts(status, scheduled_at ASC);

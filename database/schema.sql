-- ========================================================
-- Social Automate - Cloudflare D1 Database Schema
-- Dedicated strictly for Business Data & System Config
-- (Chat history is kept in Edge Cache, Zero D1 Chat Bloat)
-- ========================================================

-- ১. সিস্টেম কনফিগারেশন ও ক্রেডেনশিয়ালস
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ডিফল্ট কনফিগ
INSERT OR IGNORE INTO system_config (key, value) VALUES 
('telegram_bot_token', ''),
('admin_telegram_chat_id', ''),
('gemini_model', 'gemini-2.0-flash'),
('store_name', 'My Online Shop'),
('about_store', 'আমরা সারা দেশে হোম ডেলিভারি সহ কোয়ালিটি পণ্য সরবরাহ করি।'),
('delivery_inside_dhaka', '৬০ টাকা (২৪-৪৮ ঘণ্টার মধ্যে ডেলিভারি)'),
('delivery_outside_dhaka', '১২০ টাকা (২-৩ দিনের মধ্যে ডেলিভারি)'),
('payment_methods', 'ক্যাশ অন ডেলিভারি, বিকাশ, নগদ'),
('return_policy', 'পণ্য ডেলিভারির সময় চেক করে নেওয়া যাবে। ডিফেক্ট থাকলে সাথে সাথে রিটার্ন করা যাবে।'),
('contact_phone', '+8801XXXXXXXXX');

-- ২. প্রোডাক্ট ও সার্ভিস ক্যাটালগ (Business Data in D1)
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'General',
    image_url TEXT,
    product_url TEXT,
    posting_time TEXT DEFAULT '10:00', -- e.g. "10:00", "15:00", "20:00"
    daily_auto_post INTEGER DEFAULT 1, -- 1 = active, 0 = off
    stock_status TEXT DEFAULT 'in_stock', -- 'in_stock', 'out_of_stock'
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ৫. স্বয়ংক্রিয় পোস্টিং হিস্ট্রি (AI যাতে কখনোই একই পোস্ট রিপিট না করে)
CREATE TABLE IF NOT EXISTS post_history (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    platform TEXT DEFAULT 'facebook',
    caption TEXT,
    angle TEXT,
    post_id TEXT,
    published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ৩. সোশ্যাল অ্যাকাউন্টস মেটাডাটা
CREATE TABLE IF NOT EXISTS social_accounts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    account_name TEXT NOT NULL,
    account_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ৪. লাইভ কনভার্সেশন ও চ্যাট স্টেট (এডমিন হ্যান্ডওভার ও সিঙ্ক সাপোর্ট)
CREATE TABLE IF NOT EXISTS live_conversations (
    chat_id TEXT PRIMARY KEY,
    sender_name TEXT NOT NULL,
    platform TEXT DEFAULT 'facebook',
    last_message TEXT,
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    admin_takeover INTEGER DEFAULT 0,
    needs_attention INTEGER DEFAULT 0,
    messages_json TEXT
);

-- ইনডেক্স
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON live_conversations(last_message_at);

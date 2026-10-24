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
    stock_status TEXT DEFAULT 'in_stock', -- 'in_stock', 'out_of_stock'
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

-- ইনডেক্স
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);

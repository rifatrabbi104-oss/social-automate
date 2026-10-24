-- ========================================================
-- Social Automate - Cloudflare D1 Database Schema
-- Dedicated to Business Data, Products & System Settings
-- ========================================================

-- ১. সিস্টেম সেটিংস ও ক্রেডেনশিয়ালস
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ডিফল্ট সিস্টেম কনফিগ
INSERT OR IGNORE INTO system_settings (key, value) VALUES 
('global_ai_mode', '1'),
('gemini_model', 'gemini-2.0-flash'),
('admin_telegram_chat_id', ''),
('telegram_bot_token', '');

-- ২. বিজনেস প্রোফাইল ও স্টোর তথ্য (AI কাস্টমারদের উত্তর দিতে এই ডেটা ব্যবহার করবে)
CREATE TABLE IF NOT EXISTS business_profile (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ডিফল্ট বিজনেস ইনফো
INSERT OR IGNORE INTO business_profile (key, value) VALUES 
('store_name', 'My Online Shop'),
('about', 'আমরা সারা বাংলাদেশে দ্রুত হোম ডেলিভারি সহ প্রিমিয়াম কোয়ালিটি পণ্য সরবরাহ করি।'),
('delivery_inside_dhaka', '৬০ টাকা (২৪ থেকে ৪৮ ঘণ্টার মধ্যে ডেলিভারি)'),
('delivery_outside_dhaka', '১২০ টাকা (২ থেকে ৩ দিনের মধ্যে ডেলিভারি)'),
('payment_methods', 'ক্যাশ অন ডেলিভারি (পণ্য হাতে পেয়ে টাকা পরিশোধ), বিকাশ, নগদ'),
('return_policy', 'পণ্য রিসিভ করার সময় চেক করে নিতে পারবেন। কোনো ডিফেক্ট থাকলে ডেলিভারিম্যানের সামনেই রিটার্ন প্রযোজ্য।'),
('contact_phone', '+8801XXXXXXXXX');

-- ৩. প্রোডাক্ট ও সার্ভিস ক্যাটালগ (Business Data in D1)
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

-- ৪. কানেক্টেড সোশ্যাল অ্যাকাউন্টস
CREATE TABLE IF NOT EXISTS social_accounts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    account_name TEXT NOT NULL,
    account_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ৫. শিডিউল্ড সোশ্যাল পোস্টস (GitHub Actions দিয়ে পাবলিশিং)
CREATE TABLE IF NOT EXISTS scheduled_posts (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    media_urls TEXT,
    target_platforms TEXT NOT NULL,
    scheduled_at TIMESTAMP NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ইনডেক্স
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_posts_pending ON scheduled_posts(status, scheduled_at ASC);

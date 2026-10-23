<?php
/**
 * Alwaysdata High-Speed Messaging Proxy Configuration
 * ----------------------------------------------------
 * Connects Alwaysdata with Cloudflare D1/KV, Google Gemini AI,
 * and Telegram Admin Alerts.
 */

return [
    // ১. ক্লাউডফ্লেয়ার D1 API ক্রেডেনশিয়ালস
    'cloudflare' => [
        'account_id'  => getenv('CF_ACCOUNT_ID') ?: 'YOUR_CLOUDFLARE_ACCOUNT_ID',
        'api_token'   => getenv('CF_API_TOKEN') ?: 'YOUR_CLOUDFLARE_API_TOKEN',
        'database_id' => getenv('CF_D1_DATABASE_ID') ?: 'YOUR_D1_DATABASE_ID',
        'kv_namespace_id' => getenv('CF_KV_ID') ?: '',
        // Cloudflare Worker Fallback URL (যদি Alwaysdata ফেইল করে)
        'worker_fallback_url' => getenv('CF_WORKER_FALLBACK_URL') ?: 'https://social-automate-fallback.yoursubdomain.workers.dev/api/fallback',
    ],

    // ২. গুগল জেমিনি এআই কনফিগারেশন
    'gemini' => [
        'api_key' => getenv('GEMINI_API_KEY') ?: 'YOUR_GEMINI_API_KEY',
        'model'   => 'gemini-1.5-flash',
        'system_prompt' => "You are an intelligent, friendly, and helpful customer support representative for our business.
- Always respond warmly, concisely, and accurately in Bengali and English (Banglish style is welcomed when customer uses it).
- Never stop responding. Always provide the best possible answers regarding products, prices, and services.
- If a customer asks to speak with the human manager or admin, reassure them politely that the admin has been notified and will review their chat, while continuing to assist them directly with any other queries they have.",
    ],

    // ৩. টেলিগ্রাম অ্যাডমিন অ্যালার্ট কনফিগারেশন (Admin DM Alerts)
    'admin_alert' => [
        'telegram_bot_token' => getenv('ADMIN_TG_BOT_TOKEN') ?: 'YOUR_ADMIN_BOT_TOKEN',
        'admin_chat_id'      => getenv('ADMIN_TG_CHAT_ID') ?: 'YOUR_PERSONAL_TELEGRAM_CHAT_ID',
        'dashboard_base_url' => getenv('DASHBOARD_URL') ?: 'https://your-social-dashboard.pages.dev',
    ],

    // ৪. সোশ্যাল প্ল্যাটফর্ম টোকেনস (টেলিগ্রাম বট, মেটা ইত্যাদি)
    'platforms' => [
        'telegram_bot_token' => getenv('CLIENT_TG_BOT_TOKEN') ?: 'YOUR_CUSTOMER_BOT_TOKEN',
        'meta_verify_token'  => getenv('META_VERIFY_TOKEN') ?: 'my_secure_meta_webhook_token_123',
        'meta_page_access_token' => getenv('META_PAGE_ACCESS_TOKEN') ?: 'YOUR_META_PAGE_ACCESS_TOKEN',
    ],

    // ৫. সিকিউরিটি এবং লগ সেটিংস
    'app' => [
        'debug' => true,
        'timezone' => 'Asia/Dhaka',
    ]
];

# ⚡ SocialAutomate — Multi-Platform AI & Hybrid Social Suite
> **100% Cloudflare Native Suite: Cloudflare Worker (Gemini 2.0/3.8 Live AI) + Cloudflare D1/KV + GitHub Actions (Post Publisher) + Cloudflare Pages Dashboard**

---

## 🌟 সিস্টেমের মূল ফিচারসমূহ

1. **⚡ ক্লাউডফ্লেয়ার নেটিভ আর্কিটেকচার:**
   - কোনো বাহ্যিক প্রক্সি সার্ভার ছাড়াই সম্পূর্ণ ব্যাকএন্ড চলছে **Cloudflare Worker** ও **Cloudflare D1 SQL**-এ।
2. **🤖 Gemini 2.0 / 3.8 Flash Live মডেল (হাই-থ্রুপুট / আনলিমিটেড রেসপন্স):**
   - অত্যাধুনিক **Gemini 2.0/3.8 Flash** লাইভ মডেল ব্যবহার করা হয়েছে, যা চোখের পলকে বাংলা ও ইংরেজিতে নির্ভুল উত্তর জেনারেট করে এবং হাই-ভলিউম রিকোয়েস্ট সাপোর্ট করে।
3. **🧪 টেস্ট করার জন্য সবচেয়ে সহজ ২টি উপায় (Easy Connect & Test):**
   - **উপায় ১: ইন-ড্যাশবোর্ড লাইভ স্যান্ডবক্স সিমুলেটর:** কোনো সোশ্যাল অ্যাকাউন্ট ছাড়াই সরাসরি ড্যাশবোর্ড থেকে কাস্টমার মেসেজ পাঠিয়ে AI রিপ্লাই ও অ্যাডমিন অ্যালার্ট লাইভ টেস্ট করা যায়।
   - **উপায় ২: ১-ক্লিক টেলিগ্রাম বট কানেক্ট:** মাত্র ৩০ সেকেন্ডে @BotFather থেকে বট বানিয়ে লাইভ মোবাইল থেকে চ্যাট টেস্ট করা যায়।
4. **🚨 স্মার্ট অ্যাডমিন হ্যান্ডওভার ও টেলিগ্রাম DM অ্যালার্ট:**
   - কাস্টমার অ্যাডমিনকে খুঁজলে AI চ্যাট সচল রেখে অ্যাডমিনের ব্যক্তিগত টেলিগ্রাম অ্যাকাউন্টে সাথে সাথে ১-ক্লিক ড্যাশবোর্ড চ্যাট লিঙ্ক পাঠাবে।
5. **📅 শিডিউল্ড পোস্ট ও কমেন্ট অটোমেশন (GitHub Actions):**
   - পোস্ট শিডিউলিং সম্পূর্ণ ফ্রিতে **GitHub Actions Cron** দিয়ে হয় (ওয়ার্কারের ০ রিকোয়েস্ট খরচ)।
5. **🏢 সিঙ্গেল ক্লায়েন্ট আর্কিটেকচার:**
   - প্রতি ক্লায়েন্টের জন্য আলাদা ইনস্ট্যান্স, ফলে এক ক্লায়েন্টের ট্রাফিকের কারণে অন্যের লিমিট কাটার কোনো সুযোগ নেই।

---

## 📂 প্রোজেক্ট ফাইল স্ট্রাকচার

```
social-automate/
├── alwaysdata-proxy/           # [Alwaysdata] প্রাইমারি হাই-স্পিড মেসেজিং প্রক্সি (PHP)
│   ├── config.php              # D1/KV, Gemini ও Telegram API ক্রেডেনশিয়ালস
│   ├── webhook.php             # Telegram, FB Messenger, Comments Webhook রিসিভার
│   ├── ai_engine.php           # Google Gemini AI ও ইনটেন্ট ডিটেকশন
│   ├── notifier.php            # অ্যাডমিনের টেলিগ্রামে DM পুশ অ্যালার্ট ইঞ্জিন
│   └── db_client.php           # Cloudflare D1 REST ক্লায়েন্ট (উইথ লোকাল SQLite ফলব্যাক)
│
├── cloudflare-worker/          # [Cloudflare Worker] ড্যাশবোর্ড API ও ইমার্জেন্সি ফলব্যাক
│   ├── wrangler.toml           # D1 & KV বাইন্ডিং কনফিগারেশন
│   ├── package.json            # ডিপেন্ডেন্সি ও ডিপ্লয়মেন্ট স্ক্রিপ্ট
│   └── src/index.js            # ড্যাশবোর্ড ব্যাকএন্ড, অ্যাডমিন হ্যান্ডওভার ও ফলব্যাক গেটওয়ে
│
├── database/                   # [Cloudflare D1]
│   └── schema.sql              # ডেটাবেস টেবিল (চ্যাট, সেশন, শিডিউল্ড পোস্ট ও লগ)
│
├── github-actions/
│   └── .github/workflows/
│       └── post_publisher.yml  # প্রতি ১৫ মিনিটে পোস্ট পাবলিশার ক্রন জব
│
├── scripts/
│   └── publish_posts.js        # D1 থেকে পোস্ট নিয়ে টেলিগ্রাম ও ফেসবুকে পাবলিশিং স্ক্রিপ্ট
│
└── frontend/                   # [Cloudflare Pages] প্রিমিয়াম ড্যাশবোর্ড UI
    ├── index.html              # লাইভ ইনবক্স, হ্যান্ডওভার কন্ট্রোল ও শিডিউলার UI
    ├── style.css               # আধুনিক ডার্ক-মোড গ্লাসফরমিক ডিজাইন
    └── app.js                  # রিয়েল-টাইম ইন্টারঅ্যাকশন ও API সিঙ্ক লজিক
```

---

## 🚀 সেটআপ ও ডিপ্লয়মেন্ট গাইড (Step-by-Step)

### ধাপ ১: Cloudflare D1 ডেটাবেস তৈরি করুন
ট্যার্মিনাল বা Cloudflare Dashboard থেকে D1 ডেটাবেস তৈরি করুন:
```bash
npx wrangler d1 create social_automate_db
```
এরপর স্কিমা ফাইলটি রান করুন:
```bash
npx wrangler d1 execute social_automate_db --file=./database/schema.sql
```
আউটপুটে পাওয়া `database_id` টি `cloudflare-worker/wrangler.toml` এবং `alwaysdata-proxy/config.php`-এ পেস্ট করুন।

---

### ধাপ ২: Alwaysdata মেসেজিং প্রক্সি সেটআপ (Primary Gateway)
1. [Alwaysdata.com](https://www.alwaysdata.com)-এ একটি সম্পূর্ণ ফ্রি অ্যাকাউন্ট খুলুন (১০০MB হোস্টিং আজীবন ফ্রি)।
2. সাইট ডিরেক্টরিতে (`/www`) `alwaysdata-proxy/` ফোল্ডারের ফাইলগুলো আপলোড করুন।
3. `config.php` ফাইলে আপনার:
   - `GEMINI_API_KEY` (Google AI Studio থেকে ফ্রি কী নিন)
   - `ADMIN_TG_BOT_TOKEN` এবং `ADMIN_TG_CHAT_ID`
   - `CF_ACCOUNT_ID`, `CF_API_TOKEN`, ও `CF_D1_DATABASE_ID` বসিয়ে দিন।
4. আপনার প্রক্সি ওয়েবমুক URL হবে:
   `https://youraccount.alwaysdata.net/webhook.php`

---

### ধাপ ৩: সোশ্যাল প্ল্যাটফর্মের সাথে Webhook কানেক্ট করুন
- **টেলিগ্রাম বট:**
  টেলিগ্রাম বট সেট করতে ব্রাউজারে নিচের লিঙ্কে হিট করুন:
  `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://youraccount.alwaysdata.net/webhook.php`
- **ফেসবুক পেজ / মেটা:**
  Meta Developer Console-এ Webhook URL হিসেবে দিন `https://youraccount.alwaysdata.net/webhook.php` এবং Verify Token দিন `config.php`-তে সেট করা টোকেনটি। `messages` ও `feed` পারমিশন সাবস্ক্রাইব করুন।

---

### ধাপ ৪: Cloudflare Worker ডিপ্লয় করুন (Dashboard API & Fallback)
```bash
cd cloudflare-worker
npm install
npx wrangler deploy
```

---

### ধাপ ৫: Cloudflare Pages ফ্রন্টএন্ড ডিপ্লয় করুন
1. Cloudflare Dashboard > **Workers & Pages** > **Create application** > **Pages**।
2. `frontend/` ফোল্ডারটি ড্র্যাগ অ্যান্ড ড্রপ করে আপলোড করুন অথবা আপনার গিটহাব রিপোর সাথে কানেক্ট করুন।
3. নিমিষেই আপনার প্রিমিয়াম ড্যাশবোর্ড লাইভ হয়ে যাবে!

---

### ধাপ ৬: GitHub Actions Secrets যোগ করুন (পোস্ট শিডিউলারের জন্য)
আপনার GitHub Repository > **Settings** > **Secrets and variables** > **Actions** এ নিচের সিক্রেটগুলো যোগ করুন:
- `CF_ACCOUNT_ID`
- `CF_D1_DATABASE_ID`
- `CF_API_TOKEN`
- `TELEGRAM_BOT_TOKEN` & `TELEGRAM_CHANNEL_ID`
- `META_PAGE_ACCESS_TOKEN` & `META_PAGE_ID`

---

## 🎯 অ্যাডমিনের জন্য ব্যবহারের নিয়মাবলী

1. **সাধারণ অবস্থায়:** কাস্টমার যখনই মেসেজ দেবে, Alwaysdata থেকে Gemini AI সাথে সাথে উত্তর পাঠাবে।
2. **কাস্টমার অ্যাডমিনকে খুঁজলে:** কাস্টমারকে AI ভদ্রভাবে আশ্বস্ত করবে এবং পলকের মধ্যে অ্যাডমিনের টেলিগ্রাম অ্যাপে অ্যালার্ট পৌঁছে যাবে।
3. **চ্যাট টেকওভার:** অ্যাডমিন নোটিফিকেশনের লিঙ্কে ক্লিক করে ড্যাশবোর্ডে গিয়ে `[👤 Takeover Chat]` বাটনে ক্লিক করলেই AI সেই চ্যাটে থেমে যাবে এবং অ্যাডমিন সরাসরি নিজে রিপ্লাই দিতে পারবেন।
4. **পোস্ট পাবলিশ:** ড্যাশবোর্ডের শিডিউলার থেকে পোস্ট তৈরি করে শিডিউল দিলে GitHub Actions কোনো ওয়ার্কার খরচ ছাড়াই নির্দিষ্ট সময়ে পোস্ট করে দেবে।

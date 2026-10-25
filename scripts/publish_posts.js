/**
 * SocialAutomate - AI Social Post Publisher (GitHub Actions Engine)
 * -----------------------------------------------------------------
 * 1. 100% Free: Runs completely on GitHub Actions Free Runners (0 Cloudflare cost).
 * 2. Website Product Link Crawler: Takes any e-commerce product URL, extracts
 *    the image, price & specs, and lets Gemini AI write an irresistible sales post.
 * 3. Google AI Studio (Gemini): Generates engaging Bengali sales copy, hashtags & purchase link.
 * 4. Facebook Graph API: Directly publishes photo + caption to the Facebook Page.
 * 5. Multi-Channel: Also publishes to Telegram Channel if configured.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const META_PAGE_ID = process.env.META_PAGE_ID || "1287050647827199";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const WORKER_URL = (process.env.WORKER_URL || "https://social-automate.rifatrabbi104.workers.dev").replace(/\/$/, "");
const TARGET_PRODUCT_URL = (process.env.PRODUCT_URL || "").trim();

// 🌐 ১. ওয়েবসাইট প্রোডাক্ট পেজ থেকে তথ্য ও ছবি এক্সট্র্যাক্ট করা
async function fetchProductFromWebUrl(url) {
  console.log(`🌐 প্রোডাক্টের ওয়েবসাইট লিংক থেকে ডেটা রিড করা হচ্ছে: ${url}`);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      }
    });

    if (!res.ok) {
      console.warn(`ওয়েবসাইট রেসপন্স কোড: ${res.status}`);
      return null;
    }

    const html = await res.text();

    // OpenGraph মেটা ট্যাগ এক্সট্র্যাক্ট করা
    const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["'](.*?)["']/i)?.[1] ||
                    html.match(/<title>(.*?)<\/title>/i)?.[1] || "";

    const ogDesc = html.match(/<meta\s+property=["']og:description["']\s+content=["'](.*?)["']/i)?.[1] ||
                   html.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']/i)?.[1] || "";

    let ogImage = html.match(/<meta\s+property=["']og:image["']\s+content=["'](.*?)["']/i)?.[1] || "";

    // রিলেটিভ ইমেজ লিংক থাকলে অ্যাবসোলিউট করা
    if (ogImage && !ogImage.startsWith("http")) {
      const parsedUrl = new URL(url);
      ogImage = new URL(ogImage, parsedUrl.origin).toString();
    }

    // বডি টেক্সটের সারাংশ (অপ্রয়োজনীয় স্ক্রিপ্ট/স্টাইল বাদ দিয়ে)
    const cleanBody = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                          .replace(/<[^>]+>/g, ' ')
                          .replace(/\s+/g, ' ')
                          .trim()
                          .substring(0, 3000);

    return {
      name: ogTitle.trim() || "ওয়েবসাইট প্রোডাক্ট",
      description: ogDesc.trim() || cleanBody.substring(0, 500),
      raw_page_content: cleanBody,
      image_url: ogImage,
      product_url: url
    };
  } catch (e) {
    console.error("ওয়েবসাইট থেকে প্রোডাক্ট লোড করতে ব্যর্থ:", e.message);
    return null;
  }
}

// 📦 ২. প্রোডাক্ট ডেটা সংগ্রহ (ম্যানুয়াল লিংক > D1 ডেটাবেস > ডিফল্ট ক্যাটালগ)
async function getProductToPost() {
  // যদি গিটহাবে ওয়েবসাইটের লিংক ইনপুট দেওয়া থাকে
  if (TARGET_PRODUCT_URL) {
    const webProduct = await fetchProductFromWebUrl(TARGET_PRODUCT_URL);
    if (webProduct) return webProduct;
  }

  // D1 ডেটাবেস থেকে প্রোডাক্ট রিড করা
  try {
    const res = await fetch(`${WORKER_URL}/api/products`);
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) {
        console.log(`📦 D1 ডেটাবেস থেকে ${list.length}টি প্রোডাক্ট পাওয়া গেছে।`);
        return list[Math.floor(Math.random() * list.length)];
      }
    }
  } catch (e) {}

  // ডিফল্ট ডেমো প্রোডাক্ট (যদি কোনো ডেটাবেস কানেক্ট না থাকে)
  return {
    name: "প্রিমিয়াম কোয়ালিটি মেনস ফ্যাশন ওয়াচ",
    price: 1450,
    description: "ওয়াটারপ্রুফ, স্টেইনলেস স্টিল চেইন, ১ বছরের ওয়ারেন্টি সহ আকর্ষণীয় লুক।",
    category: "ফ্যাশন",
    image_url: "https://images.unsplash.com/photo-1524805444758-089113d48a6d?auto=format&fit=crop&w=1000&q=80",
    product_url: ""
  };
}

// 🤖 ৩. Google AI Studio (Gemini) দিয়ে আকর্ষণীয় বাংলা সেলস পোস্ট তৈরি
async function generatePostContent(product) {
  if (!GEMINI_API_KEY) {
    console.log("⚠️ GEMINI_API_KEY পাওয়া যায়নি, স্ট্যান্ডার্ড টেমপ্লেট ব্যবহার করা হচ্ছে।");
    let text = `🔥 সেরা কালেকশন: ${product.name} 🔥\n\n` +
      `✨ পণ্যের বিবরণ:\n${product.description || "অসাধারণ মানের সেরা পণ্য।"}\n\n`;
    if (product.price) text += `💰 অফার মূল্য: মাত্র ৳${product.price}/-\n`;
    text += `🚚 সারা দেশে ক্যাশ অন হোম ডেলিভারি সুবিধা!\n` +
      `📦 ডেলিভারি চার্জ: ঢাকার ভেতরে ৬০ টাকা, ঢাকার বাইরে ১২০ টাকা।\n\n`;
    if (product.product_url) {
      text += `🌐 সরাসরি ওয়েবসাইট থেকে অর্ডার করতে ক্লিক করুন:\n👉 ${product.product_url}\n\n`;
    }
    text += `📩 অথবা বিস্তারিত জানতে এখনই পেজে ইনবক্স করুন!\n\n#Ranonex #OnlineShopping #HomeDelivery #FashionBD`;
    return text;
  }

  const prompt = `
You are an expert e-commerce copywriter in Bangladesh.
Your task is to write an irresistible, high-converting Facebook sales post in natural, friendly Bengali based on the product information below.

Product Information:
- Product Name / Title: ${product.name}
- Product Page / URL: ${product.product_url || "N/A"}
- Price / Offer: ${product.price ? "৳" + product.price : "Extract from page content if mentioned"}
- Description & Specs: ${product.description || ""}
- Raw Webpage Info: ${product.raw_page_content ? product.raw_page_content.substring(0, 1500) : "N/A"}

Requirements for the post:
1. Catchy opening hook with emojis to grab attention immediately.
2. 3-4 bullet points highlighting key benefits, quality, or features.
3. Clearly mention the price (if found on the page or given).
4. Delivery policy: "সারা দেশে ক্যাশ অন ডেলিভারি (পণ্য হাতে পেয়ে দেখে টাকা দেওয়ার সুবিধা)"
5. If a product URL is provided, prominently say:
   "🌐 সরাসরি ওয়েবসাইট থেকে অর্ডার করুন: ${product.product_url}"
6. Call to Action: "অথবা অর্ডার করতে এখনই আমাদের মেসেজ / ইনবক্স করুন।"
7. 4-6 relevant trending hashtags at the end (e.g. #Ranonex, #ShopOnline, #BDStore).
8. Return ONLY the plain text ready to post on Facebook (No markdown backticks, no code blocks).
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
      })
    });

    const data = await res.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candidateText && candidateText.trim()) {
      return candidateText.trim();
    }
  } catch (e) {
    console.error("Gemini API Error:", e.message);
  }

  return `✨ ${product.name} ✨\nঅর্ডার করতে ভিজিট করুন: ${product.product_url || "ইনবক্স করুন"}`;
}

// 📤 ৪. Facebook Page-এ ফটো সহ পোস্ট পাবলিশ (Meta Graph API)
async function publishToFacebook(caption, imageUrl) {
  if (!META_PAGE_ACCESS_TOKEN || !META_PAGE_ID) {
    console.log("❌ [Facebook] META_PAGE_ACCESS_TOKEN অথবা META_PAGE_ID অনুপস্থিত।");
    return { success: false, reason: "Missing credentials" };
  }

  console.log(`📤 Facebook Page (${META_PAGE_ID})-এ পোস্ট পাবলিশ করা হচ্ছে...`);

  // ১. যদি ছবির লিংক পাওয়া যায়, সরাসরি /photos এন্ডপয়েন্টে পোস্ট
  if (imageUrl && imageUrl.startsWith("http")) {
    console.log(`📸 ছবির লিংক: ${imageUrl}`);
    const photoUrl = `https://graph.facebook.com/v19.0/${META_PAGE_ID}/photos`;
    const res = await fetch(photoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: imageUrl,
        caption: caption,
        access_token: META_PAGE_ACCESS_TOKEN
      })
    });

    const data = await res.json();
    if (data.id || data.post_id) {
      console.log(`🎉 [Facebook Photo Post Success] Photo/Post ID: ${data.id || data.post_id}`);
      return { success: true, id: data.id || data.post_id, type: "photo" };
    } else {
      console.error("⚠️ [Facebook Photo Upload Failed, falling back to Feed post]:", data.error?.message || data.error);
    }
  }

  // ২. ছবি ছাড়া টেক্সট পোস্ট (/feed)
  const feedUrl = `https://graph.facebook.com/v19.0/${META_PAGE_ID}/feed`;
  const res = await fetch(feedUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: caption,
      access_token: META_PAGE_ACCESS_TOKEN
    })
  });

  const data = await res.json();
  if (data.id) {
    console.log(`🎉 [Facebook Feed Post Success] Post ID: ${data.id}`);
    return { success: true, id: data.id, type: "feed" };
  } else {
    console.error("❌ [Facebook Feed Post Failed]:", data.error);
    return { success: false, error: data.error };
  }
}

// 💬 ৫. Telegram চ্যানেলে পোস্ট পাবলিশ (ঐচ্ছিক)
async function publishToTelegram(caption, imageUrl) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
    return { success: false, reason: "Telegram not configured" };
  }

  console.log(`📤 Telegram Channel (${TELEGRAM_CHANNEL_ID})-এ পোস্ট পাঠানো হচ্ছে...`);
  try {
    if (imageUrl && imageUrl.startsWith("http")) {
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHANNEL_ID,
          photo: imageUrl,
          caption: caption.substring(0, 1024)
        })
      });
      return { success: res.ok };
    } else {
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHANNEL_ID,
          text: caption
        })
      });
      return { success: res.ok };
    }
  } catch (e) {
    console.error("Telegram post failed:", e.message);
    return { success: false, error: e.message };
  }
}

// 🚀 ৬. প্রধান এক্সিকিউশন
async function main() {
  console.log("=================================================");
  console.log("🤖 [SocialAutomate] AI Social Post Publisher Initiated");
  console.log(`⏰ Time: ${new Date().toISOString()}`);
  if (TARGET_PRODUCT_URL) {
    console.log(`🎯 Custom Website Product URL: ${TARGET_PRODUCT_URL}`);
  }
  console.log("=================================================");

  const product = await getProductToPost();
  if (!product) {
    console.log("পোস্ট করার মতো কোনো প্রোডাক্ট পাওয়া যায়নি।");
    return;
  }

  console.log(`🎯 নির্বাচিত পণ্য: ${product.name}`);

  console.log("✍️ Gemini AI দিয়ে আকর্ষণীয় বাংলা সেলস কপি তৈরি করা হচ্ছে...");
  const postCaption = await generatePostContent(product);
  console.log("\n--- [AI GENERATED CAPTION] ---");
  console.log(postCaption);
  console.log("-------------------------------\n");

  const fbResult = await publishToFacebook(postCaption, product.image_url);
  const tgResult = await publishToTelegram(postCaption, product.image_url);

  console.log("\n📊 [RESULTS SUMMARY]:");
  console.log(`- Facebook Status: ${fbResult.success ? "✅ Published" : "❌ Failed / Skipped"}`);
  console.log(`- Telegram Status: ${tgResult.success ? "✅ Published" : "⚪ Not Configured"}`);
  console.log("🏁 AI Social Post Publisher Job Finished.");
}

main().catch(err => {
  console.error("Fatal Error:", err);
  process.exit(1);
});

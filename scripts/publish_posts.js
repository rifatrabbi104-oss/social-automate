/**
 * SocialAutomate - AI Social Post Publisher (GitHub Actions Engine)
 * -----------------------------------------------------------------
 * 1. 100% Free: Runs completely on GitHub Actions Free Runners (0 Cloudflare cost).
 * 2. Multi-Angle Daily Rotation: Rotates between 7 distinct marketing angles so AI
 *    NEVER repeats the same post twice. Every day is 100% unique and fresh!
 * 3. D1 Post History Tracking: Knows what was posted yesterday to avoid repetition.
 * 4. Website Link Auto-Crawl: Extracts product title, image, price & specs from any URL.
 * 5. Gemini Live WebSocket / REST: Generates high-converting sales copywriting.
 * 6. Meta Graph API: Directly publishes photo + caption to the Facebook Page.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";

const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const META_PAGE_ID = process.env.META_PAGE_ID || "1287050647827199";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const WORKER_URL = (process.env.WORKER_URL || "https://social-automate.rifatrabbi104.workers.dev").replace(/\/$/, "");
const TARGET_PRODUCT_URL = (process.env.PRODUCT_URL || "").trim();

// 🎯 ৭টি ভিন্ন ভিন্ন সাইকোলজিক্যাল মার্কেটিং অ্যাঙ্গেল (প্রতিদিনের জন্য ইউনিক)
const MARKETING_ANGLES = [
  {
    name: "Problem-Solution",
    theme: "কাস্টমারের দৈনন্দিন সমস্যা ও এই পণ্যের মাধ্যমে তার নিখুঁত সমাধান",
    instruction: "Focus on a relatable daily frustration or problem that the customer faces, and reveal this product as the ultimate practical solution."
  },
  {
    name: "Social-Proof",
    theme: "কাস্টমারদের ভালোবাসা ও সন্তুষ্টির রিভিউ ভিত্তিক পোস্ট",
    instruction: "Write from a perspective of popular demand and customer praise. Explain why hundreds of smart customers are choosing this item."
  },
  {
    name: "Feature-Quality",
    theme: "প্রিমিয়াম কোয়ালিটি ও আনকমন ফিচারের বিস্তারিত হাইলাইটস",
    instruction: "Highlight the build quality, durability, premium materials, and why it is far superior to low-cost alternatives in the market."
  },
  {
    name: "Urgency-Offer",
    theme: "সীমিত স্টক ও দ্রুত অফার লুফে নেওয়ার তাগিদ",
    instruction: "Create an exciting sense of urgency. Mention that stock is moving very fast and urge them to book their order today before it runs out."
  },
  {
    name: "Lifestyle-Upgrade",
    theme: "লাইফস্টাইল ও রুচিশীল ব্যক্তিত্বের স্মার্ট সংযোজন",
    instruction: "Paint an inspiring picture of how owning this product elevates the customer's daily lifestyle, confidence, and modern aesthetic."
  },
  {
    name: "Zero-Risk-Delivery",
    theme: "নিশ্চিন্তে কেনাকাটা: হাতে পেয়ে চেক করে টাকা দেওয়ার গ্যারান্টি",
    instruction: "Emphasize 100% risk-free shopping: Cash on delivery nationwide, open the parcel, check the quality, and only pay when fully satisfied."
  },
  {
    name: "Direct-Value",
    theme: "সেরা মূল্যে সর্বোচ্চ ভ্যালু ও পারফরম্যান্স",
    instruction: "Direct, punchy value proposition highlighting the exceptional price-to-benefit ratio and why this is the smartest purchase right now."
  }
];

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

    const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["'](.*?)["']/i)?.[1] ||
                    html.match(/<title>(.*?)<\/title>/i)?.[1] || "";

    const ogDesc = html.match(/<meta\s+property=["']og:description["']\s+content=["'](.*?)["']/i)?.[1] ||
                   html.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']/i)?.[1] || "";

    let ogImage = html.match(/<meta\s+property=["']og:image["']\s+content=["'](.*?)["']/i)?.[1] || "";

    if (ogImage && !ogImage.startsWith("http")) {
      const parsedUrl = new URL(url);
      ogImage = new URL(ogImage, parsedUrl.origin).toString();
    }

    const cleanBody = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                          .replace(/<[^>]+>/g, ' ')
                          .replace(/\s+/g, ' ')
                          .trim()
                          .substring(0, 3000);

    return {
      id: `web_${Date.now()}`,
      name: ogTitle.trim() || "ওয়েবসাইট প্রোডাক্ট",
      description: ogDesc.trim() || cleanBody.substring(0, 500),
      raw_page_content: cleanBody,
      image_url: ogImage,
      product_url: url,
      previous_posts: []
    };
  } catch (e) {
    console.error("ওয়েবসাইট থেকে প্রোডাক্ট লোড করতে ব্যর্থ:", e.message);
    return null;
  }
}

// 📦 ২. D1 ডেটাবেস থেকে অটো-পোস্টিং টাস্ক ও হিস্ট্রি রিড করা
async function getAutoPostTasks() {
  if (TARGET_PRODUCT_URL) {
    const webProduct = await fetchProductFromWebUrl(TARGET_PRODUCT_URL);
    if (webProduct) return [webProduct];
  }

  try {
    const res = await fetch(`${WORKER_URL}/api/auto-post-task`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.tasks) && data.tasks.length > 0) {
        console.log(`📦 D1 থেকে ${data.tasks.length}টি শিডিউল্ড প্রোডাক্ট পাওয়া গেছে।`);
        return data.tasks;
      }
    }
  } catch (e) {
    console.log("Worker auto-post API unavailable:", e.message);
  }

  return [
    {
      id: "demo_watch_1",
      name: "প্রিমিয়াম কোয়ালিটি মেনস ফ্যাশন ওয়াচ",
      price: 1450,
      description: "ওয়াটারপ্রুফ, স্টেইনলেস স্টিল চেইন, ১ বছরের ওয়ারেন্টি সহ আকর্ষণীয় লুক।",
      category: "ফ্যাশন",
      image_url: "https://images.unsplash.com/photo-1524805444758-089113d48a6d?auto=format&fit=crop&w=1000&q=80",
      product_url: "",
      previous_posts: []
    }
  ];
}

// ⚡ ৩.১ Gemini Multimodal Live WebSocket Engine
async function callGeminiLiveWebSocket(prompt, apiKey, modelName = "gemini-2.0-flash-exp") {
  if (typeof WebSocket === "undefined") return null;

  return new Promise((resolve) => {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    let ws;
    let timeoutId;
    let accumulatedText = "";
    let isFinished = false;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (ws) {
        try { ws.close(); } catch (e) {}
      }
    };

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      return resolve(null);
    }

    timeoutId = setTimeout(() => {
      if (!isFinished) {
        cleanup();
        resolve(accumulatedText.trim() || null);
      }
    }, 12000);

    ws.onopen = () => {
      const cleanModel = modelName.includes("/") ? modelName : `models/${modelName}`;
      ws.send(JSON.stringify({
        setup: {
          model: cleanModel,
          generationConfig: { responseModalities: ["TEXT"], temperature: 0.75 }
        }
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
        if (data.setupComplete) {
          ws.send(JSON.stringify({
            clientContent: {
              turns: [{ role: "user", parts: [{ text: prompt }] }],
              turnComplete: true
            }
          }));
          return;
        }

        const parts = data.serverContent?.modelTurn?.parts;
        if (parts && Array.isArray(parts)) {
          for (const part of parts) {
            if (part.text) accumulatedText += part.text;
          }
        }

        if (data.serverContent?.turnComplete) {
          isFinished = true;
          cleanup();
          resolve(accumulatedText.trim());
        }
      } catch (err) {}
    };

    ws.onerror = () => {
      cleanup();
      resolve(accumulatedText.trim() || null);
    };

    ws.onclose = () => {
      if (!isFinished) {
        cleanup();
        resolve(accumulatedText.trim() || null);
      }
    };
  });
}

// 🤖 ৩.২ Google AI Studio দিয়ে আন-রিপিটেবল ইউনিক বাংলা পোস্ট জেনারেট
async function generateUniquePostContent(product, chosenAngle) {
  if (!GEMINI_API_KEY) {
    let text = `🔥 সেরা কালেকশন: ${product.name} 🔥\n\n` +
      `✨ বিশেষত্ব:\n${product.description || "অসাধারণ মানের সেরা পণ্য।"}\n\n`;
    if (product.price) text += `💰 অফার মূল্য: মাত্র ৳${product.price}/-\n`;
    text += `🚚 সারা দেশে ক্যাশ অন হোম ডেলিভারি সুবিধা!\n` +
      `📦 ডেলিভারি চার্জ: ঢাকার ভেতরে ৬০ টাকা, ঢাকার বাইরে ১২০ টাকা।\n\n`;
    if (product.product_url) {
      text += `🌐 সরাসরি ওয়েবসাইট থেকে অর্ডার করতে ক্লিক করুন:\n👉 ${product.product_url}\n\n`;
    }
    text += `📩 অথবা বিস্তারিত জানতে এখনই পেজে ইনবক্স করুন!\n\n#Ranonex #OnlineShopping #HomeDelivery #FashionBD`;
    return text;
  }

  // পূর্ববর্তী পোস্টগুলোর স্ন্যাপশট যাতে AI ওই কথা বা স্টাইল কপি না করে
  const previousCaptions = (product.previous_posts || [])
    .map((p, idx) => `[Post #${idx + 1} (${p.angle || 'Angle'})]: ${p.caption.substring(0, 150)}...`)
    .join("\n");

  const prompt = `
You are an expert e-commerce copywriter in Bangladesh managing a popular Facebook Page.
Your mission is to write an irresistible, high-converting Facebook sales post in natural, engaging Bengali for the product below.

Product Details:
- Product Name: ${product.name}
- Product Page / URL: ${product.product_url || "N/A"}
- Price / Offer: ${product.price ? "৳" + product.price : "Extract from page if mentioned"}
- Description & Specs: ${product.description || ""}
- Raw Webpage Info: ${product.raw_page_content ? product.raw_page_content.substring(0, 1500) : "N/A"}

🎯 TODAY'S MARKETING ANGLE:
- Angle: "${chosenAngle.name}"
- Theme: ${chosenAngle.theme}
- Strategic Instruction: ${chosenAngle.instruction}

🚫 CRITICAL ANTI-REPETITION RULE:
Here are the previous posts made for this exact product:
${previousCaptions || "None (First time post)"}
DO NOT reuse the same opening hooks, sentences, or layout from previous posts. This post must feel completely new, fresh, and captivating to returning followers!

Formatting Requirements:
1. Catchy headline matching today's angle with emojis.
2. 3-4 bullet points highlighting specific benefits.
3. Mention the price: ${product.price ? "৳" + product.price : "best offer"}.
4. Mention Delivery: "সারা দেশে ক্যাশ অন হোম ডেলিভারি (পণ্য হাতে পেয়ে দেখে টাকা দেওয়ার সুবিধা)"
5. If product URL is present, say:
   "🌐 সরাসরি ওয়েবসাইট থেকে অর্ডার করতে ক্লিক করুন: ${product.product_url}"
6. Clear Call to Action: "অথবা অর্ডার করতে এখনই আমাদের পেজে মেসেজ / ইনবক্স করুন।"
7. 4-6 relevant trending hashtags at the end (e.g. #Ranonex, #ShopOnline, #BDStore).
8. Return ONLY the plain text ready to post on Facebook (No markdown code blocks).
`;

  // ১. Gemini Live WebSocket ট্রাই
  try {
    const liveText = await callGeminiLiveWebSocket(prompt, GEMINI_API_KEY, GEMINI_MODEL);
    if (liveText && liveText.length > 50) {
      console.log(`⚡ [Gemini Live WebSocket] ${chosenAngle.name} অ্যাঙ্গেলে পোস্ট সফলভাবে তৈরি!`);
      return liveText;
    }
  } catch (e) {}

  // ২. REST ফলব্যাক
  try {
    const cleanModel = GEMINI_MODEL.replace(/^models\//, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 800 }
      })
    });

    const data = await res.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candidateText && candidateText.trim()) {
      return candidateText.trim();
    }
  } catch (e) {
    console.error("Gemini REST API Error:", e.message);
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

  // ছবির লিংক থাকলে /photos এন্ডপয়েন্টে পোস্ট
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
      console.log(`🎉 [Facebook Photo Post Success] Post ID: ${data.id || data.post_id}`);
      return { success: true, id: data.id || data.post_id, type: "photo" };
    } else {
      console.error("⚠️ [Facebook Photo Upload Failed, falling back to Feed post]:", data.error?.message || data.error);
    }
  }

  // ছবি ছাড়া টেক্সট পোস্ট (/feed)
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
    return { success: false, error: e.message };
  }
}

// 📝 ৬. D1-এ পোস্ট হিস্ট্রি সেভ করা (যাতে কালকের পোস্ট ভিন্ন হয়)
async function recordPostHistory(productId, caption, angle, postId) {
  try {
    await fetch(`${WORKER_URL}/api/record-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: productId,
        platform: "facebook",
        caption: caption,
        angle: angle,
        post_id: postId
      })
    });
    console.log("💾 [D1 History] পোস্টের কপি এবং অ্যাঙ্গেল D1 ডেটাবেসে সফলভাবে রেকর্ড হয়েছে।");
  } catch (e) {
    console.warn("Could not record post history to D1:", e.message);
  }
}

// 🚀 ৭. প্রধান এক্সিকিউশন
async function main() {
  console.log("=================================================");
  console.log("🤖 [SocialAutomate] Daily Unique AI Post Engine");
  console.log(`⏰ Time: ${new Date().toISOString()}`);
  console.log("=================================================");

  const tasks = await getAutoPostTasks();
  if (!tasks || tasks.length === 0) {
    console.log("কোনো শিডিউল্ড প্রোডাক্ট পাওয়া যায়নি।");
    return;
  }

  // প্রতিদিন একটি বা ক্রন অনুযায়ী নির্বাচিত প্রোডাক্টের জন্য পোস্ট করা
  const selectedProduct = tasks[Math.floor(Math.random() * tasks.length)];
  console.log(`🎯 নির্বাচিত পণ্য: ${selectedProduct.name} (মূল্য: ৳${selectedProduct.price || 'N/A'})`);

  // পূর্বে ব্যবহৃত অ্যাঙ্গেলগুলো চিহ্নিত করা
  const usedAngleNames = (selectedProduct.previous_posts || []).map(p => p.angle);
  
  // পূর্বে ব্যবহার হয়নি এমন একটি নতুন অ্যাঙ্গেল বেছে নেওয়া
  let availableAngles = MARKETING_ANGLES.filter(a => !usedAngleNames.includes(a.name));
  if (availableAngles.length === 0) {
    availableAngles = MARKETING_ANGLES; // সবগুলো ব্যবহার হয়ে গেলে রিসাইকেল হবে
  }
  const chosenAngle = availableAngles[Math.floor(Math.random() * availableAngles.length)];

  console.log(`💡 আজকের ইউনিক মার্কেটিং অ্যাঙ্গেল: "${chosenAngle.name}" (${chosenAngle.theme})`);
  console.log("✍️ Gemini AI দিয়ে সম্পূর্ণ নতুন স্টাইলে সেলস কপি তৈরি করা হচ্ছে...");

  const postCaption = await generateUniquePostContent(selectedProduct, chosenAngle);

  console.log("\n--- [TODAY'S UNIQUE AI POST] ---");
  console.log(postCaption);
  console.log("--------------------------------\n");

  const fbResult = await publishToFacebook(postCaption, selectedProduct.image_url);
  const tgResult = await publishToTelegram(postCaption, selectedProduct.image_url);

  if (fbResult.success && selectedProduct.id) {
    await recordPostHistory(selectedProduct.id, postCaption, chosenAngle.name, fbResult.id);
  }

  console.log("\n📊 [RESULTS SUMMARY]:");
  console.log(`- Facebook Status: ${fbResult.success ? "✅ Published" : "❌ Failed / Skipped"}`);
  console.log(`- Telegram Status: ${tgResult.success ? "✅ Published" : "⚪ Not Configured"}`);
  console.log("🏁 Daily Unique Post Job Finished.");

  if (!fbResult.success) {
    console.error("\n❌❌ Facebook পেজে পোস্ট পাবলিশ সম্পন্ন হয়নি!");
    if (fbResult.reason === "Missing credentials") {
      console.error("👉 কারণ: GitHub Secrets-এ 'META_PAGE_ACCESS_TOKEN' বা 'META_PAGE_ID' সিক্রেট যোগ করা হয়নি।");
    } else if (fbResult.error) {
      console.error("👉 ফেসবুক থেকে আসা ইরর:", JSON.stringify(fbResult.error, null, 2));
      if (fbResult.error.code === 200 || fbResult.error.message?.includes("permission") || fbResult.error.message?.includes("pages_manage_posts")) {
        console.error("👉 মূল কারণ: আপনার টোকেনটিতে ফেসবুক পেজে পোস্ট করার পারমিশন (pages_manage_posts) নেই!");
        console.error("👉 সমাধান: Graph API Explorer থেকে 'pages_manage_posts' সহ পেজ টোকেন জেনারেট করে সিক্রেটে দিন।");
      }
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Fatal Error:", err);
  process.exit(1);
});

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
const GEMINI_MODEL = process.env.GEMINI_MODEL || "models/gemini-3.8-live";
const ALWAYSDATA_URL = (process.env.ALWAYSDATA_URL || "https://ranonex.alwaysdata.net").replace(/\/$/, "");

const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const META_PAGE_ID = process.env.META_PAGE_ID || "1287050647827199";

const TIKTOK_ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN;
const TIKTOK_CREATOR_ID = process.env.TIKTOK_CREATOR_ID || process.env.TIKTOK_OPEN_ID;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const TARGET_PLATFORM = (process.env.TARGET_PLATFORM || "all").toLowerCase();

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

// 🌐 ১. ওয়েবসাইট প্রোডাক্ট পেজ থেকে তথ্য ও ছবি এক্সট্র্যাক্ট করা (API + R2 Image Aware)
async function fetchProductFromWebUrl(url) {
  console.log(`🌐 প্রোডাক্টের ওয়েবসাইট লিংক থেকে ডেটা রিড করা হচ্ছে: ${url}`);
  try {
    const parsedUrl = new URL(url);
    const origin = parsedUrl.origin;
    const productId = parsedUrl.searchParams.get("id");

    // ১. ইউজার সাইটের API ও public_data.json প্রোব করা
    if (productId) {
      const endpoints = [
        `${origin}/api/public-data?product_id=${encodeURIComponent(productId)}`,
        `${origin}/public_data.json`,
        `${origin}/api/get-single-product?id=${encodeURIComponent(productId)}`
      ];

      for (const ep of endpoints) {
        try {
          const apiRes = await fetch(ep, {
            headers: {
              "Accept": "application/json",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SocialAutomate-Bot"
            }
          });
          if (apiRes.ok) {
            const json = await apiRes.json();
            let p = null;
            if (json.product) p = json.product;
            else if (json.data) {
              p = Array.isArray(json.data) ? json.data.find(x => String(x.id) === String(productId)) : json.data;
            } else if (json.products && Array.isArray(json.products)) {
              p = json.products.find(x => String(x.id) === String(productId));
            }

            if (p) {
              let gallery = [];
              try { gallery = typeof p.gallery_images === 'string' ? JSON.parse(p.gallery_images) : (p.gallery_images || []); } catch(e) {}
              let variants = [];
              try { variants = typeof p.variants === 'string' ? JSON.parse(p.variants) : (p.variants || []); } catch(e) {}

              let r2Img = "";
              if (gallery.length > 0 && typeof gallery[0] === 'string' && gallery[0].startsWith('http')) r2Img = gallery[0];
              else if (variants.length > 0 && variants[0]?.imageUrl && variants[0].imageUrl.startsWith('http')) r2Img = variants[0].imageUrl;
              else {
                for (const g of gallery) { if (typeof g === 'string' && g.startsWith('http')) { r2Img = g; break; } }
              }

              const basePrice = parseFloat(p.base_price || p.price || 0);
              const flashDiscount = parseFloat(p.flash_sale_price || 0);
              const finalPrice = (flashDiscount > 0 && flashDiscount < basePrice) ? (basePrice - flashDiscount) : basePrice;
              const cleanDesc = (p.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 600);

              console.log(`✅ API থেকে সফলভাবে পাওয়া গেছে: ${p.name} | মূল্য: ৳${finalPrice} | R2 Image: ${r2Img ? 'Yes' : 'No'}`);
              return {
                id: `web_${p.id || Date.now()}`,
                name: p.name || "ওয়েবসাইট প্রোডাক্ট",
                price: finalPrice,
                original_price: basePrice,
                description: cleanDesc,
                raw_page_content: cleanDesc,
                image_url: r2Img,
                gallery_images: gallery,
                product_url: url,
                previous_posts: []
              };
            }
          }
        } catch (e) {}
      }
    }

    // ২. ফলব্যাক: সাধারণ HTML ও OpenGraph
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
      name: ogTitle.replace(/Product Details/gi, '').trim() || "ওয়েবসাইট প্রোডাক্ট",
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
  let credentials = {};
  if (TARGET_PRODUCT_URL) {
    const webProduct = await fetchProductFromWebUrl(TARGET_PRODUCT_URL);
    if (webProduct) return { tasks: [webProduct], credentials: {} };
  }

  try {
    const res = await fetch(`${WORKER_URL}/api/auto-post-task`);
    if (res.ok) {
      const data = await res.json();
      credentials = data.credentials || {};
      if (data.success && Array.isArray(data.tasks) && data.tasks.length > 0) {
        console.log(`📦 D1 থেকে ${data.tasks.length}টি শিডিউল্ড প্রোডাক্ট পাওয়া গেছে।`);
        return { tasks: data.tasks, credentials };
      }
    }
  } catch (e) {
    console.log("Worker auto-post API unavailable:", e.message);
  }

  return {
    tasks: [
      {
        id: "demo_watch_1",
        name: "প্রিমিয়াম কোয়ালিটি মেনস ফ্যাশন ওয়াচ",
        price: 1450,
        description: "ওয়াটারপ্রুফ, স্টেইনলেস স্টিল চেইন, ১ বছরের ওয়ারেন্টি সহ আকর্ষণীয় লুক।",
        category: "ফ্যাশন",
        image_url: "https://images.unsplash.com/photo-1524805444758-089113d48a6d?auto=format&fit=crop&w=1000&q=80",
        product_url: "",
        target_platform: "all",
        previous_posts: []
      }
    ],
    credentials
  };
}

// ⚡ ৩.১ Gemini Multimodal Live WebSocket Engine
async function callGeminiLiveWebSocket(prompt, apiKey, modelName = "models/gemini-3.8-live", imageParts = []) {
  if (typeof WebSocket === "undefined") return null;

  return new Promise((resolve) => {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
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
    }, 15000);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: "models/gemini-3.8-live",
          generationConfig: { responseModalities: ["AUDIO"] },
          outputAudioTranscription: {}
        }
      }));
    };

    ws.onmessage = async (event) => {
      try {
        const raw = event.data instanceof Blob ? await event.data.text() : (typeof event.data === "string" ? event.data : event.data.toString());
        const data = JSON.parse(raw);
        if (data.setupComplete) {
          const userParts = [];
          if (Array.isArray(imageParts) && imageParts.length > 0) {
            for (const img of imageParts) {
              if (img && (img.data || img.base64)) {
                userParts.push({
                  inlineData: {
                    mimeType: img.mimeType || "image/jpeg",
                    data: img.data || img.base64
                  }
                });
              }
            }
          }
          userParts.push({ text: prompt });

          ws.send(JSON.stringify({
            clientContent: {
              turns: [{ role: "user", parts: userParts }],
              turnComplete: true
            }
          }));
          return;
        }

        if (data.serverContent?.outputTranscription?.text) {
          accumulatedText += data.serverContent.outputTranscription.text;
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

// 🤖 ৩.২ AI দিয়ে সম্পূর্ণ অটোমেটিক ও ইউনিক বাংলা পোস্ট জেনারেট
async function generateUniquePostContent(product, chosenAngle) {
  // ১. Alwaysdata হাই-পারফরম্যান্স AI পোস্ট জেনারেটর সার্ভিস ট্রাই (নো কোটা লিমিট)
  try {
    const adRes = await fetch(`${ALWAYSDATA_URL}/api/generate-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product, angle: chosenAngle })
    });
    if (adRes.ok) {
      const adJson = await adRes.json();
      if (adJson.caption && adJson.caption.length > 50) {
        console.log(`⚡ [Alwaysdata AI Engine] ${chosenAngle.name} অ্যাঙ্গেলে পোস্ট সফলভাবে তৈরি! (${adJson.method})`);
        return adJson.caption;
      }
    }
  } catch (e) {}

  if (!GEMINI_API_KEY) {
    let text = `🔥 ${product.name} 🔥\n\n` +
      `${product.description || "দৈনন্দিন ব্যবহারের জন্য দারুণ একটি গ্যাজেট।"}\n\n`;
    if (product.price) text += `💰 অফার মূল্য: মাত্র ৳${product.price}/-\n`;
    text += `🚚 সারা দেশে ক্যাশ অন হোম ডেলিভারি সুবিধা (পার্সেল খুলে দেখে পেমেন্ট করার নিশ্চয়তা)!\n` +
      `📦 ডেলিভারি চার্জ: ঢাকার ভেতরে ৭০ টাকা, ঢাকার বাইরে ১৩০ টাকা।\n\n`;
    if (product.product_url) {
      text += `🌐 সরাসরি ওয়েবসাইট থেকে অর্ডার করতে ক্লিক করুন:\n👉 ${product.product_url}\n\n`;
    }
    text += `📩 অথবা বিস্তারিত জানতে এখনই পেজে ইনবক্স করুন!\n\n#Ranonex #OnlineShopping #HomeDelivery #GadgetBD`;
    return text;
  }

  // পূর্ববর্তী পোস্টগুলোর স্ন্যাপশট যাতে AI ওই কথা বা স্টাইল কপি না করে
  const previousCaptions = (product.previous_posts || [])
    .map((p, idx) => `[Post #${idx + 1} (${p.angle || 'Angle'})]: ${p.caption.substring(0, 150)}...`)
    .join("\n");

  const prompt = `You are an elite, highly persuasive Bangladeshi Direct-Response Copywriter and E-commerce Social Media Marketer for "Ranonex" (https://ranonex.shop).
Your task is to write an irresistible, high-converting Facebook sales post in natural, engaging, pure Bengali script (বাংলা লিপি).

CRITICAL REQUIREMENTS:
1. STRICT ZERO BANGLISH POLICY: Write 100% in natural Bengali script. Never write in Banglish!
2. Write the store brand name in English letters as "Ranonex".
3. NO generic, robotic templates! Do NOT use repetitive formulaic bullets like "💎 কেন এটি আপনার জন্য সেরা পছন্দ?" or "✅ প্রিমিয়াম বিল্ড কোয়ালিটি".
4. Craft an attention-grabbing, curiosity-inducing opening hook matching today's angle: "${chosenAngle.name}".
5. Highlight real customer pain points and how this product solves them with authentic, vivid storytelling.
6. Clearly state the exact price: ${product.price ? "৳" + product.price : "বিশেষ অফার মূল্য"}. Never misquote prices.
7. Mention Cash on Delivery (ক্যাশ অন ডেলিভারি) available across all 64 districts in Bangladesh with open-box parcel checking allowed before payment.
8. State accurate delivery charges: ঢাকা সিটির ভেতরে মাত্র ৭০ টাকা, এবং ঢাকার বাইরে ১৩০ টাকা।
9. Clear Call to Action: ইনবক্সে মেসেজ দিন অথবা ভিজিট করুন: ${product.product_url || 'https://ranonex.shop'}.
10. Include 4-6 relevant Bengali & English hashtags at the end (#Ranonex #GadgetBD etc.).

Product Details:
- Name: ${product.name}
- Product URL: ${product.product_url || "N/A"}
- Price / Offer: ${product.price ? "৳" + product.price : "N/A"}
- Description & Specs: ${product.description || ""}

${previousCaptions ? `PREVIOUS POSTS (DO NOT REPEAT THESE STYLES OR PHRASES):\n${previousCaptions}` : ""}

Output ONLY the final Facebook post caption, ready to publish. No markdown code fences or conversational preamble.`;

  // ২. Gemini Live WebSocket ট্রাই (models/gemini-3.8-live + Photo Vision)
  try {
    const imageParts = [];
    if (product.image_url && product.image_url.startsWith('http')) {
      try {
        const imgRes = await fetch(product.image_url, {
          headers: { "User-Agent": "Mozilla/5.0 SocialAutomate-Bot" }
        });
        if (imgRes.ok) {
          const ab = await imgRes.arrayBuffer();
          imageParts.push({
            mimeType: imgRes.headers.get("content-type") || "image/jpeg",
            data: Buffer.from(ab).toString("base64")
          });
        }
      } catch (e) {}
    }

    const liveText = await callGeminiLiveWebSocket(prompt, GEMINI_API_KEY, "models/gemini-3.8-live", imageParts);
    if (liveText && liveText.length > 50) {
      console.log(`⚡ [Gemini 3.8 Live WebSocket] ${chosenAngle.name} অ্যাঙ্গেলে পোস্ট সফলভাবে তৈরি! (Vision: ${imageParts.length > 0 ? 'Active' : 'No'})`);
      return liveText;
    }
  } catch (e) {}

  // ৩. REST ফলব্যাক (gemini-3.8-flash)
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 1000 }
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

// 🎵 ৪. TikTok Content Posting API v2-এ পোস্ট পাবলিশ (Direct Post + Unaudited Self/Draft Fallback)
async function publishToTikTok(caption, mediaUrl, token = null) {
  const activeToken = token || TIKTOK_ACCESS_TOKEN;
  if (!activeToken) {
    console.log("⚪ [TikTok Skipped] ড্যাশবোর্ড বা D1 ডেটাবেসে কোনো TikTok টোকেন নেই।");
    return { success: false, reason: "Missing credentials" };
  }

  console.log("📤 TikTok Content Posting API v2-এ পোস্ট তৈরি করা হচ্ছে...");

  try {
    const isVideo = mediaUrl && (mediaUrl.includes(".mp4") || mediaUrl.includes(".mov") || mediaUrl.includes(".webm") || mediaUrl.includes("/video"));

    const createPayload = (privacyLevel) => {
      if (isVideo) {
        return {
          post_info: {
            title: caption.substring(0, 2200),
            privacy_level: privacyLevel,
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: mediaUrl
          },
          post_mode: "DIRECT_POST",
          media_type: "VIDEO"
        };
      } else {
        return {
          post_info: {
            title: caption.substring(0, 2200),
            privacy_level: privacyLevel,
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false
          },
          source_info: {
            source: "PULL_FROM_URL",
            photo_cover_index: 1,
            photo_images: [mediaUrl]
          },
          post_mode: "DIRECT_POST",
          media_type: "PHOTO"
        };
      }
    };

    if (!mediaUrl || !mediaUrl.startsWith("http")) {
      console.log("⚠️ TikTok পোস্টের জন্য প্রোডাক্টের ইমেজ বা ভিডিও URL আবশ্যক।");
      return { success: false, reason: "TikTok requires a product image or video URL" };
    }

    console.log(`🎬 মিডিয়া টাইপ: ${isVideo ? "ভিডিও (VIDEO)" : "ছবি (PHOTO)"} -> ${mediaUrl}`);

    // ১. প্রথমে পাবলিক ফিডে ট্রাই করা
    let res = await fetch("https://open.tiktokapis.com/v2/post/publish/content/init/", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${activeToken}`,
        "Content-Type": "application/json; charset=UTF-8"
      },
      body: JSON.stringify(createPayload("PUBLIC_TO_EVERYONE"))
    });

    let data = await res.json();

    // ২. যদি আন-রিভিউড অ্যাপের কারণে পাবলিক পোস্ট না হয় (unaudited_client) -> স্বয়ংক্রিয়ভাবে SELF_ONLY (Private/Tester Mode) এ ট্রাই
    const errMsg = JSON.stringify(data || {});
    if (!res.ok || data?.error?.code !== "ok") {
      if (errMsg.includes("unaudited_client") || errMsg.includes("privacy_level") || errMsg.includes("scope_not_authorized")) {
        console.log("ℹ️ [Unaudited Sandbox Mode] অ্যাপটি এখনো আন-রিভিউড থাকায় SELF_ONLY (প্রাইভেট/টেস্টার মোডে) পাবলিশ করা হচ্ছে...");
        res = await fetch("https://open.tiktokapis.com/v2/post/publish/content/init/", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${activeToken}`,
            "Content-Type": "application/json; charset=UTF-8"
          },
          body: JSON.stringify(createPayload("SELF_ONLY"))
        });
        data = await res.json();
      }
    }

    if (res.ok && data?.data?.publish_id) {
      console.log(`🎉 [TikTok Post Success] Publish ID: ${data.data.publish_id}`);
      return { success: true, id: data.data.publish_id };
    } else {
      console.error("❌ [TikTok Post Failed]:", JSON.stringify(data, null, 2));
      return { success: false, error: data };
    }
  } catch (e) {
    console.error("❌ TikTok API Call Error:", e.message);
    return { success: false, error: e.message };
  }
}

// 📤 ৫. Facebook Page-এ ফটো সহ পোস্ট পাবলিশ (Meta Graph API)
async function publishToFacebook(caption, imageUrl, token = null, pageId = null, galleryImages = []) {
  const activeToken = token || META_PAGE_ACCESS_TOKEN;
  const activePageId = pageId || META_PAGE_ID;
  if (!activeToken || !activePageId) {
    return { success: false, reason: "Missing credentials" };
  }

  console.log(`📤 Facebook Page (${activePageId})-এ পোস্ট পাবলিশ করা হচ্ছে...`);

  // ১. প্রোডাক্টের সমস্ত সিরিয়াল ফটো সংগ্রহ
  let images = [];
  if (Array.isArray(galleryImages) && galleryImages.length > 0) {
    images = galleryImages.filter(u => typeof u === "string" && u.startsWith("http"));
  }
  if (images.length === 0 && imageUrl && imageUrl.startsWith("http")) {
    images = [imageUrl];
  }

  // ২. একাধিক ছবি থাকলে -> ফেসবুক মাল্টি-ফটো অ্যালবাম ফিড পোস্ট (Multi-Photo Album)
  if (images.length > 1) {
    console.log(`📸 ${images.length}টি ফটো সহ ফেসবুক মাল্টি-ফটো অ্যালবাম পোস্ট করা হচ্ছে...`);
    const attachedMedia = [];
    for (let i = 0; i < images.length; i++) {
      try {
        const upRes = await fetch(`https://graph.facebook.com/v19.0/${activePageId}/photos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: images[i],
            published: false,
            access_token: activeToken
          })
        });
        const upData = await upRes.json();
        if (upData.id) {
          attachedMedia.push({ media_fbid: upData.id });
          console.log(`  ✅ Photo #${i + 1} uploaded: FBID ${upData.id}`);
        }
      } catch (upErr) {
        console.warn(`  ⚠️ Photo #${i + 1} upload failed:`, upErr.message);
      }
    }

    if (attachedMedia.length > 0) {
      const feedRes = await fetch(`https://graph.facebook.com/v19.0/${activePageId}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: caption,
          attached_media: attachedMedia,
          published: true,
          access_token: activeToken
        })
      });
      const feedData = await feedRes.json();
      if (feedData.id) {
        console.log(`🎉 [Facebook Multi-Photo Album Post Success] Post ID: ${feedData.id}`);
        return { success: true, id: feedData.id, type: "multi_photo", photos_count: attachedMedia.length };
      } else {
        console.warn("⚠️ Facebook multi-photo post failed, falling back to single photo:", feedData);
      }
    }
  }

  // ৩. সিঙ্গেল ছবি থাকলে /photos এন্ডপয়েন্টে পোস্ট
  if (images.length === 1) {
    console.log(`📸 ছবির লিংক: ${images[0]}`);
    const photoUrl = `https://graph.facebook.com/v19.0/${activePageId}/photos`;
    const res = await fetch(photoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: images[0],
        caption: caption,
        access_token: activeToken
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

  // ৪. ছবি ছাড়া টেক্সট পোস্ট (/feed)
  const feedUrl = `https://graph.facebook.com/v19.0/${activePageId}/feed`;
  const res = await fetch(feedUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: caption,
      access_token: activeToken
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

// 💬 ৬. Telegram চ্যানেলে পোস্ট পাবলিশ (ঐচ্ছিক)
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

// 📝 ৭. D1-এ পোস্ট হিস্ট্রি সেভ করা (যাতে কালকের পোস্ট ভিন্ন হয়)
async function recordPostHistory(productId, caption, angle, postId, platform = "tiktok") {
  try {
    await fetch(`${WORKER_URL}/api/record-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: productId,
        platform: platform,
        caption: caption,
        angle: angle,
        post_id: postId
      })
    });
    console.log(`💾 [D1 History] (${platform}) পোস্টের কপি এবং অ্যাঙ্গেল D1 ডেটাবেসে সফলভাবে রেকর্ড হয়েছে।`);
  } catch (e) {
    console.warn("Could not record post history to D1:", e.message);
  }
}

// 🚀 ৮. প্রধান এক্সিকিউশন
async function main() {
  console.log("=================================================");
  console.log("🤖 [SocialAutomate] Daily Unique AI Post Engine");
  console.log(`⏰ Time: ${new Date().toISOString()}`);
  console.log("=================================================");

  const autoData = await getAutoPostTasks();
  const tasks = Array.isArray(autoData) ? autoData : (autoData.tasks || []);
  const credentials = autoData.credentials || {};

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

  let ttResult = { success: false, reason: "Skipped" };
  let fbResult = { success: false, reason: "Skipped" };
  let tgResult = { success: false, reason: "Skipped" };

  const activeTikTokToken = credentials.tiktok?.token || TIKTOK_ACCESS_TOKEN;
  const activeFbToken = credentials.facebook?.token || META_PAGE_ACCESS_TOKEN;
  const activeFbPageId = credentials.facebook?.id || META_PAGE_ID;

  const explicitPlatform = (process.env.TARGET_PLATFORM || TARGET_PLATFORM || "").trim().toLowerCase();
  const targetPlatform = (explicitPlatform && explicitPlatform !== "all")
    ? explicitPlatform
    : (selectedProduct.target_platform || "facebook");

  console.log(`🎯 টার্গেট প্ল্যাটফর্ম: ${targetPlatform}`);

  // ১. TikTok পাবলিশ
  if (targetPlatform === "all" || targetPlatform === "tiktok") {
    ttResult = await publishToTikTok(postCaption, selectedProduct.image_url, activeTikTokToken);
    if (ttResult.success && selectedProduct.id) {
      await recordPostHistory(selectedProduct.id, postCaption, chosenAngle.name, ttResult.id, "tiktok");
    }
  }

  // ২. Facebook পাবলিশ (ঐচ্ছিক - টোকেন থাকলে রান হবে)
  if (targetPlatform === "all" || targetPlatform === "facebook") {
    if (activeFbToken) {
      const isCaptionOnly = process.env.CAPTION_ONLY === "true" || process.env.POST_TYPE === "caption_only";
      const fbImageUrl = isCaptionOnly ? null : selectedProduct.image_url;
      let galleryList = [];
      try {
        if (typeof selectedProduct.gallery_images === 'string') {
          galleryList = JSON.parse(selectedProduct.gallery_images);
        } else if (Array.isArray(selectedProduct.gallery_images)) {
          galleryList = selectedProduct.gallery_images;
        }
      } catch (e) {}
      if (isCaptionOnly) galleryList = [];

      if (isCaptionOnly) {
        console.log("📝 [Caption-Only Mode] শুধুমাত্র টেক্সট ক্যাপশন নিয়ে পোস্ট করা হচ্ছে (ছবি ছাড়া)।");
      }
      fbResult = await publishToFacebook(postCaption, fbImageUrl, activeFbToken, activeFbPageId, galleryList);
      if (fbResult.success && selectedProduct.id) {
        await recordPostHistory(selectedProduct.id, postCaption, chosenAngle.name, fbResult.id, "facebook");
      }
    } else {
      fbResult = { success: false, reason: "Facebook skipped (Token not provided)" };
      console.log("ℹ️ Facebook পাবলিশিং বাইপাস করা হয়েছে (টোকেন না থাকায়)। টিকটক ও টেলিগ্রাম সচল রয়েছে।");
    }
  }

  // ৩. Telegram পাবলিশ
  if (targetPlatform === "all" || targetPlatform === "telegram") {
    tgResult = await publishToTelegram(postCaption, selectedProduct.image_url);
    if (tgResult.success && selectedProduct.id) {
      await recordPostHistory(selectedProduct.id, postCaption, chosenAngle.name, "tg_" + Date.now(), "telegram");
    }
  }

  console.log("\n📊 [RESULTS SUMMARY]:");
  console.log(`- TikTok Status: ${ttResult.success ? "✅ Published" : (ttResult.reason ? "⚪ " + ttResult.reason : "❌ Failed")}`);
  console.log(`- Facebook Status: ${fbResult.success ? "✅ Published" : (fbResult.reason ? "⚪ " + fbResult.reason : "❌ Failed")}`);
  console.log(`- Telegram Status: ${tgResult.success ? "✅ Published" : (tgResult.reason ? "⚪ " + tgResult.reason : "❌ Failed")}`);
  console.log("🏁 Daily Unique Post Job Finished.");

  const anySuccess = ttResult.success || fbResult.success || tgResult.success;
  if (!anySuccess) {
    if (!activeTikTokToken && !activeFbToken && !TELEGRAM_BOT_TOKEN) {
      console.error("\n❌ কোনো সোশ্যাল প্ল্যাটফর্মের ক্রেডেনশিয়াল সেট করা নেই!");
      console.error("👉 টিকটকে পোস্ট করার জন্য GitHub Secrets-এ 'TIKTOK_ACCESS_TOKEN' যোগ করুন।");
      process.exitCode = 1;
      return;
    }

    if (ttResult.error) {
      console.error("\n❌ TikTok পাবলিশিং ইরর:", JSON.stringify(ttResult.error, null, 2));
      process.exitCode = 1;
      return;
    }
  }
}

main().catch(err => {
  console.error("Fatal Error:", err);
  process.exitCode = 1;
});

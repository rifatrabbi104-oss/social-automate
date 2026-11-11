/**
 * SocialAutomate - GitHub Actions Execution Backend (Cloudflare Worker Handover Engine)
 * -------------------------------------------------------------------------------------
 * Architecture:
 * 1. Zero Hardcoded Secrets Required in GitHub: Cloudflare Worker holds all D1 settings
 *    (Gemini API Key, Permanent Model, Facebook Page Token, Page ID, TikTok/Telegram tokens,
 *    Store Policies, Curated Gallery Photos, Prompt, and First Comment Link).
 * 2. Complete Handover: Worker prepares the complete job payload via `/api/auto-post-task`
 *    and hands it over to GitHub Actions. Whatever Worker sends is 100% FINAL.
 * 3. Permanent AI Engine: Uses `Gemini 2.5 Flash Native Audio Dialog`
 *    (`models/gemini-2.5-flash-native-audio-preview-12-2025`) with Multimodal Vision.
 * 4. Multi-Photo Album + First Comment Link: Uploads all D1 curated photos in serial order,
 *    keeps the caption 100% free of links, and posts the product link in the first comment.
 * 5. D1 Sync: Reports published post_id, angle, and caption back to `/api/record-post`
 *    which updates `post_history` and `products.last_posted_at`.
 */

const WORKER_URL = (process.env.WORKER_URL || "https://social-automate.rifatrabbi104.workers.dev").replace(/\/$/, "");
const TARGET_PRODUCT_ID = (process.env.PRODUCT_ID || "").trim();
const TARGET_PRODUCT_URL = (process.env.PRODUCT_URL || "").trim();
const EXPLICIT_PLATFORM = (process.env.TARGET_PLATFORM || "").trim().toLowerCase();
const POST_TYPE = (process.env.POST_TYPE || "standard").trim().toLowerCase();
const SCHEDULED_ONLY = process.env.SCHEDULED_ONLY === "true";

// 🎯 ৭টি ভিন্ন ভিন্ন সাইকোলজিক্যাল মার্কেটিং অ্যাঙ্গেল (ফলব্যাক রোটেশন)
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

// 📦 ১. Cloudflare Worker থেকে সম্পূর্ণ হ্যান্ডওভার প্যাকেজ গ্রহণ করা (Worker-এর ডেটাই ফাইনাল)
async function fetchWorkerHandoverPackage() {
  const params = new URLSearchParams();
  if (TARGET_PRODUCT_ID) params.set("product_id", TARGET_PRODUCT_ID);
  if (SCHEDULED_ONLY && !TARGET_PRODUCT_ID) params.set("only_due", "true");

  const endpoint = `${WORKER_URL}/api/auto-post-task?${params.toString()}`;
  console.log(`📡 Cloudflare Worker থেকে হ্যান্ডওভার প্যাকেজ নেওয়া হচ্ছে: ${endpoint}`);

  try {
    const res = await fetch(endpoint, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "SocialAutomate-GitHub-Backend/2.0"
      }
    });

    if (res.ok) {
      const data = await res.json();
      let tasks = Array.isArray(data.tasks) ? data.tasks : [];

      // যদি নির্দিষ্ট product_url দেওয়া থাকে কিন্তু product_id না থাকে, তবে সেই লিংকের প্রোডাক্ট ফিল্টার করা
      if (!TARGET_PRODUCT_ID && TARGET_PRODUCT_URL && tasks.length > 0) {
        const matched = tasks.filter(t => t.product_url === TARGET_PRODUCT_URL);
        if (matched.length > 0) tasks = matched;
      }

      return {
        ai: data.ai || {
          api_key: "",
          model: "models/gemini-2.5-flash-native-audio-preview-12-2025"
        },
        policies: data.policies || {},
        credentials: data.credentials || {},
        tasks
      };
    } else {
      console.error(`❌ Worker handover API returned status ${res.status}`);
    }
  } catch (e) {
    console.error("❌ Worker handover API error:", e.message);
  }

  return {
    ai: { api_key: "", model: "models/gemini-2.5-flash-native-audio-preview-12-2025" },
    policies: {},
    credentials: {},
    tasks: []
  };
}

// ⚡ ২.১ Gemini 2.5 Flash Native Audio Dialog Live WebSocket Engine
async function callGeminiLiveWebSocket(prompt, apiKey, modelName = "models/gemini-2.5-flash-native-audio-preview-12-2025", imageParts = []) {
  if (typeof WebSocket === "undefined" || !apiKey) return null;

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
        isFinished = true;
        cleanup();
        resolve(accumulatedText.trim() || null);
      }
    }, 20000);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: modelName || "models/gemini-2.5-flash-native-audio-preview-12-2025",
          generationConfig: { responseModalities: ["AUDIO"] },
          outputAudioTranscription: {}
        }
      }));
    };

    ws.onmessage = async (event) => {
      try {
        const raw = event.data instanceof Blob
          ? await event.data.text()
          : (typeof event.data === "string" ? event.data : event.data.toString());
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
      if (!isFinished) {
        isFinished = true;
        cleanup();
        resolve(accumulatedText.trim() || null);
      }
    };

    ws.onclose = () => {
      if (!isFinished) {
        isFinished = true;
        cleanup();
        resolve(accumulatedText.trim() || null);
      }
    };
  });
}

// 🧹 ক্যাপশন থেকে যেকোনো ওয়েবসাইট লিংক মুছে ফেলার ক্লিনার (Max Organic Reach)
function sanitizeCaptionNoLinks(rawCaption) {
  if (!rawCaption) return "";
  return rawCaption
    .replace(/(?:ভিজিট করুন\s*:?|ওয়েবসাইটে দেখুন\s*:?|অর্ডার লিংক\s*:?)\s*https?:\/\/[^\s]+/gi, "👉 অর্ডার করতে প্রথম কমেন্টের লিংকে ক্লিক করুন অথবা ইনবক্স করুন")
    .replace(/https?:\/\/[^\s]+/gi, "")
    .replace(/(?:www\.)?[a-zA-Z0-9-]+\.(?:shop|com|org|net)[^\s]*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 🤖 ২.২ Worker-এর দেওয়া Prompt, API Key ও Model দিয়ে AI পোস্ট তৈরি
async function generateCaptionFromWorkerHandover(task, aiConfig) {
  const apiKey = (aiConfig?.api_key || process.env.GEMINI_API_KEY || "").trim();
  const modelName = aiConfig?.model || "models/gemini-2.5-flash-native-audio-preview-12-2025";
  const angleName = task.chosen_angle?.name || "Unique-Angle";

  // Worker-এর তৈরি ফাইনাল প্রম্পট ব্যবহার (না থাকলে ফলব্যাক প্রম্পট)
  const prompt = task.prompt || `Write a persuasive Bengali sales post for "${task.name}" (Price: ৳${task.price}). Do not include any website URL in the caption; instruct customers to check the first comment for the order link.`;

  if (!apiKey) {
    console.warn("⚠️ Cloudflare Worker (D1) থেকে কোনো Gemini API Key পাওয়া যায়নি। ড্যাশবোর্ডে API Key সেভ করুন।");
    return task.fallback_caption || `🔥 ${task.name} 🔥\n\n${task.description || ""}\n\n💰 অফার মূল্য: মাত্র ৳${task.price}\n\n👉 বিস্তারিত দেখতে ও সরাসরি অর্ডার করতে প্রথম কমেন্টের লিংকে ক্লিক করুন অথবা পেজে ইনবক্স করুন!`;
  }

  // প্রোডাক্টের প্রথম ছবিটি ভিশন ইনপুট হিসেবে নেওয়া (যাতে AI ছবি দেখে আরও নিখুঁত ক্যাপশন লেখে)
  const imageParts = [];
  const primaryImage = (Array.isArray(task.gallery_images) && task.gallery_images[0]) || task.image_url;
  if (primaryImage && primaryImage.startsWith("http")) {
    try {
      const imgRes = await fetch(primaryImage, {
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

  // ১. প্রাইমারি: Gemini 2.5 Flash Native Audio Dialog (Live WebSocket API)
  try {
    console.log(`⚡ Calling Permanent Model: ${modelName} (Angle: ${angleName}, Vision: ${imageParts.length > 0 ? "Yes" : "No"})...`);
    const liveText = await callGeminiLiveWebSocket(prompt, apiKey, modelName, imageParts);
    if (liveText && liveText.length > 40) {
      const clean = sanitizeCaptionNoLinks(liveText);
      console.log(`✅ [Gemini 2.5 Flash Native Audio Dialog] সফলভাবে ক্যাপশন তৈরি হয়েছে!`);
      return clean;
    }
  } catch (wsErr) {
    console.warn("⚠️ Live WebSocket call warning:", wsErr.message);
  }

  // ২. সেকেন্ডারি ফলব্যাক: একই API Key দিয়ে Gemini REST ইঞ্জিন কল
  const restModels = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
  const restParts = [];
  for (const img of imageParts) {
    restParts.push({
      inlineData: {
        mimeType: img.mimeType || "image/jpeg",
        data: img.data
      }
    });
  }
  restParts.push({ text: prompt });

  for (const rm of restModels) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${rm}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: restParts }],
          generationConfig: {
            temperature: 0.9,
            topP: 0.95,
            maxOutputTokens: 800
          }
        })
      });
      if (res.ok) {
        const d = await res.json();
        const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim().length > 40) {
          console.log(`✅ [Gemini REST Fallback: ${rm}] সফলভাবে ক্যাপশন তৈরি হয়েছে!`);
          return sanitizeCaptionNoLinks(text);
        }
      }
    } catch (e) {}
  }

  return task.fallback_caption || `✨ ${task.name} ✨\n\n${task.description || ""}\n\n💰 অফার মূল্য: মাত্র ৳${task.price}\n\n👉 বিস্তারিত দেখতে ও অর্ডার করতে প্রথম কমেন্টের লিংকে ক্লিক করুন অথবা ইনবক্স করুন!`;
}

// 💬 ৩. ফেসবুক পোস্টে প্রোডাক্ট লিংক সহ প্রথম কমেন্ট সেন্ডার (Worker-এর দেওয়া মেসেজ অনুযায়ী)
async function postFirstComment(postId, task, token) {
  if (!postId || !token) return null;
  try {
    let commentMsg = task?.first_comment_message;
    if (!commentMsg) {
      const rawUrl = task?.product_url || task?.url || "";
      let productUrl = rawUrl;
      if (!productUrl && task?.id) {
        productUrl = `https://ranonex.shop/product.html?id=${encodeURIComponent(task.id)}`;
      }
      if (!productUrl || !productUrl.startsWith("http")) {
        productUrl = "https://ranonex.shop";
      }
      commentMsg = `🛍️ প্রোডাক্টের বিস্তারিত ছবি দেখতে ও সরাসরি ওয়েবসাইট থেকে অর্ডার করতে নিচের লিংকে ক্লিক করুন:\n👉 ${productUrl}\n\n🚚 সারা বাংলাদেশে ক্যাশ অন হোম ডেলিভারি (হাতে পেয়ে চেক করে নেওয়ার সুবিধা)! অথবা সরাসরি অর্ডার করতে পেজে মেসেজ পাঠান।`;
    }

    const res = await fetch(`https://graph.facebook.com/v19.0/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commentMsg,
        access_token: token
      })
    });
    const data = await res.json();
    if (res.ok && data.id) {
      console.log(`💬 [Facebook First Comment Success] Comment ID: ${data.id} on Post: ${postId}`);
      return data.id;
    } else {
      console.warn(`⚠️ [Facebook First Comment Warning]:`, data);
      return null;
    }
  } catch (err) {
    console.warn(`⚠️ [Facebook First Comment Exception]:`, err.message);
    return null;
  }
}

// 🔵 ফেসবুক পেজ টোকেন অটো-রিসলভার (System User Token -> Page Access Token)
async function resolvePageAccessToken(rawToken, targetPageId = "1287050647827199") {
  if (!rawToken) return null;
  try {
    const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,category&access_token=${rawToken}`);
    const meData = await meRes.json();
    if (meData && meData.id && meData.category) return rawToken;

    const accRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${rawToken}`);
    const accData = await accRes.json();
    if (accData && Array.isArray(accData.data) && accData.data.length > 0) {
      const match = (targetPageId ? accData.data.find(p => p.id === targetPageId) : null) || accData.data[0];
      if (match && match.access_token) return match.access_token;
    }

    if (targetPageId) {
      const pRes = await fetch(`https://graph.facebook.com/v19.0/${targetPageId}?fields=access_token&access_token=${rawToken}`);
      const pData = await pRes.json();
      if (pData && pData.access_token) return pData.access_token;
    }
  } catch (e) {
    console.warn("resolvePageAccessToken error in GitHub Actions:", e.message);
  }
  return rawToken;
}

// 📤 ৪. Facebook Page-এ ডেটাবেসের সব ছবি সহ মাল্টি-ফটো অ্যালবাম পোস্ট পাবলিশ
async function publishToFacebook(caption, task, fbCreds) {
  let activeToken = fbCreds?.token || process.env.META_PAGE_ACCESS_TOKEN;
  const activePageId = fbCreds?.id || process.env.META_PAGE_ID || "1287050647827199";

  if (!activeToken || !activePageId) {
    return { success: false, reason: "Missing Facebook Page Token in Worker D1" };
  }

  activeToken = await resolvePageAccessToken(activeToken, activePageId);

  console.log(`📤 Facebook Page (${activePageId})-এ পোস্ট পাবলিশ করা হচ্ছে...`);

  const isCaptionOnly = process.env.CAPTION_ONLY === "true" || POST_TYPE === "caption_only";

  // শুধুমাত্র Worker-এর D1 ডেটাবেস থেকে পাঠানো সিলেক্টেড ছবিগুলোই ব্যবহার হবে
  let images = [];
  if (!isCaptionOnly) {
    if (Array.isArray(task.gallery_images) && task.gallery_images.length > 0) {
      images = task.gallery_images.filter(u => typeof u === "string" && u.startsWith("http"));
    } else if (typeof task.gallery_images === "string") {
      try {
        images = JSON.parse(task.gallery_images).filter(u => typeof u === "string" && u.startsWith("http"));
      } catch (e) {}
    }
    if (images.length === 0 && task.image_url && task.image_url.startsWith("http")) {
      images = [task.image_url];
    }
  }

  // ১. একাধিক ছবি থাকলে -> ফেসবুক মাল্টি-ফটো অ্যালবাম ফিড পোস্ট
  if (images.length > 1) {
    console.log(`📸 ডেটাবেসের ${images.length}টি ফটো সিরিয়াল অনুযায়ী ফেসবুক মাল্টি-ফটো অ্যালবামে আপলোড করা হচ্ছে...`);
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
          attachedMedia.push({ media_fbid: String(upData.id) });
          console.log(`  ✅ Photo #${i + 1}/${images.length} uploaded: FBID ${upData.id}`);
        } else {
          console.warn(`  ⚠️ Photo #${i + 1} upload warning:`, upData);
        }
      } catch (upErr) {
        console.warn(`  ⚠️ Photo #${i + 1} upload error:`, upErr.message);
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
        console.log(`🎉 [Facebook Multi-Photo Album Post Success] Post ID: ${feedData.id} (${attachedMedia.length} photos)`);
        await postFirstComment(feedData.id, task, activeToken);
        return { success: true, id: feedData.id, type: "multi_photo", photos_count: attachedMedia.length };
      } else {
        console.warn("⚠️ Facebook multi-photo post failed, falling back to single photo:", feedData);
      }
    }
  }

  // ২. সিঙ্গেল ছবি থাকলে -> /photos এন্ডপয়েন্টে পোস্ট
  if (images.length >= 1) {
    console.log(`📸 সিঙ্গেল ফটো পোস্ট করা হচ্ছে: ${images[0]}`);
    const photoUrl = `https://graph.facebook.com/v19.0/${activePageId}/photos`;
    const res = await fetch(photoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: images[0],
        caption: caption,
        published: true,
        access_token: activeToken
      })
    });

    const data = await res.json();
    if (data.id || data.post_id) {
      const postId = data.post_id || data.id;
      console.log(`🎉 [Facebook Photo Post Success] Post ID: ${postId}`);
      await postFirstComment(postId, task, activeToken);
      return { success: true, id: postId, type: "photo" };
    } else {
      console.error("⚠️ [Facebook Photo Upload Failed, falling back to Feed post]:", data.error?.message || data.error);
    }
  }

  // ৩. ছবি ছাড়া টেক্সট পোস্ট (/feed)
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
    await postFirstComment(data.id, task, activeToken);
    return { success: true, id: data.id, type: "feed" };
  } else {
    console.error("❌ [Facebook Feed Post Failed]:", data.error);
    return { success: false, error: data.error };
  }
}

// 🎵 ৫. TikTok Content Posting API v2-এ পোস্ট পাবলিশ
async function publishToTikTok(caption, mediaUrl, token = null) {
  const activeToken = token || process.env.TIKTOK_ACCESS_TOKEN;
  if (!activeToken) {
    return { success: false, reason: "Missing TikTok credentials" };
  }

  if (!mediaUrl || !mediaUrl.startsWith("http")) {
    return { success: false, reason: "TikTok requires a product image or video URL" };
  }

  console.log("📤 TikTok Content Posting API v2-এ পোস্ট তৈরি করা হচ্ছে...");
  try {
    const isVideo = mediaUrl.includes(".mp4") || mediaUrl.includes(".mov") || mediaUrl.includes(".webm") || mediaUrl.includes("/video");

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

    let res = await fetch("https://open.tiktokapis.com/v2/post/publish/content/init/", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${activeToken}`,
        "Content-Type": "application/json; charset=UTF-8"
      },
      body: JSON.stringify(createPayload("PUBLIC_TO_EVERYONE"))
    });

    let data = await res.json();
    const errMsg = JSON.stringify(data || {});
    if (!res.ok || data?.error?.code !== "ok") {
      if (errMsg.includes("unaudited_client") || errMsg.includes("privacy_level") || errMsg.includes("scope_not_authorized")) {
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
      return { success: false, error: data };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 💬 ৬. Telegram চ্যানেলে পোস্ট পাবলিশ
async function publishToTelegram(caption, imageUrl, tgCreds) {
  const botToken = tgCreds?.bot_token || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = tgCreds?.chat_id || process.env.TELEGRAM_CHANNEL_ID;
  if (!botToken || !chatId) {
    return { success: false, reason: "Telegram not configured" };
  }

  try {
    if (imageUrl && imageUrl.startsWith("http")) {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          photo: imageUrl,
          caption: caption.substring(0, 1024)
        })
      });
      return { success: res.ok };
    } else {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: caption
        })
      });
      return { success: res.ok };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 📝 ৭. Cloudflare Worker D1-এ পোস্ট হিস্ট্রি ও last_posted_at আপডেট করা
async function recordPostHistory(productId, caption, angle, postId, platform = "facebook", imageUrl = "") {
  try {
    const res = await fetch(`${WORKER_URL}/api/record-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: productId,
        platform,
        caption,
        angle,
        post_id: postId,
        image_url: imageUrl
      })
    });
    if (res.ok) {
      console.log(`💾 [D1 Sync] (${platform}) পোস্ট হিস্ট্রি এবং last_posted_at D1 ডেটাবেসে সফলভাবে আপডেট হয়েছে।`);
    }
  } catch (e) {
    console.warn("Could not record post history to D1:", e.message);
  }
}

// 🚀 ৮. প্রধান এক্সিকিউশন (Worker Handover Driven)
async function main() {
  console.log("=================================================");
  console.log("🤖 [SocialAutomate] GitHub Actions Backend Engine");
  console.log(`⏰ Time: ${new Date().toISOString()}`);
  console.log(`🔗 Worker Handover Source: ${WORKER_URL}`);
  console.log(`🎯 Mode: ${SCHEDULED_ONLY ? "Scheduled Due Check" : (TARGET_PRODUCT_ID ? `Direct Product (${TARGET_PRODUCT_ID})` : "Manual / Test Dispatch")}`);
  console.log("=================================================");

  const handover = await fetchWorkerHandoverPackage();
  const { ai, credentials, tasks } = handover;

  if (!tasks || tasks.length === 0) {
    console.log("ℹ️ এই মুহূর্তে পোস্ট করার মতো কোনো নির্ধারিত (Due) প্রোডাক্ট নেই।");
    return;
  }

  // যদি শিডিউল মোড হয় তবে যতগুলো প্রোডাক্ট ডিউ আছে সবগুলোই প্রসেস হবে; আর টেস্ট/ম্যানুয়াল মোডে নির্দিষ্ট প্রোডাক্টটি প্রসেস হবে
  const productsToProcess = (SCHEDULED_ONLY || TARGET_PRODUCT_ID) ? tasks : [tasks[0]];
  console.log(`📦 মোট ${productsToProcess.length}টি প্রোডাক্ট হ্যান্ডওভার প্রসেসিংয়ের জন্য প্রস্তুত।`);

  for (const selectedProduct of productsToProcess) {
    const angleName = selectedProduct.chosen_angle?.name || MARKETING_ANGLES[0].name;
    console.log(`\n-------------------------------------------------`);
    console.log(`🛍️ প্রোডাক্ট: ${selectedProduct.name} (ID: ${selectedProduct.id} | মূল্য: ৳${selectedProduct.price || "N/A"})`);
    console.log(`💡 মার্কেটিং অ্যাঙ্গেল: "${angleName}"`);
    console.log(`📸 ডেটাবেস ফটো সংখ্যা: ${(selectedProduct.gallery_images || []).length}টি`);

    // ১. Worker-এর দেওয়া প্রম্পট ও Gemini API Key দিয়ে ক্যাপশন তৈরি
    const postCaption = await generateCaptionFromWorkerHandover(selectedProduct, ai);

    console.log("\n--- [GENERATED AI POST CAPTION (NO URL)] ---");
    console.log(postCaption);
    console.log("--------------------------------------------\n");

    const targetPlatform = (EXPLICIT_PLATFORM && EXPLICIT_PLATFORM !== "all")
      ? EXPLICIT_PLATFORM
      : (selectedProduct.target_platform || "facebook").toLowerCase();

    // ২. Facebook পাবলিশ
    if (targetPlatform === "all" || targetPlatform === "facebook") {
      const fbResult = await publishToFacebook(postCaption, selectedProduct, credentials.facebook);
      if (fbResult.success && selectedProduct.id) {
        await recordPostHistory(
          selectedProduct.id,
          postCaption,
          angleName,
          fbResult.id,
          "facebook",
          selectedProduct.image_url || ""
        );
      } else {
        console.warn(`⚠️ Facebook Status:`, fbResult.reason || fbResult.error);
      }
    }

    // ৩. TikTok পাবলিশ (যদি টার্গেট করা থাকে)
    if (targetPlatform === "all" || targetPlatform === "tiktok") {
      const ttResult = await publishToTikTok(postCaption, selectedProduct.image_url, credentials.tiktok?.token);
      if (ttResult.success && selectedProduct.id) {
        await recordPostHistory(
          selectedProduct.id,
          postCaption,
          angleName,
          ttResult.id,
          "tiktok",
          selectedProduct.image_url || ""
        );
      }
    }

    // ৪. Telegram পাবলিশ (যদি টার্গেট করা থাকে)
    if (targetPlatform === "all" || targetPlatform === "telegram") {
      const tgResult = await publishToTelegram(postCaption, selectedProduct.image_url, credentials.telegram);
      if (tgResult.success && selectedProduct.id) {
        await recordPostHistory(
          selectedProduct.id,
          postCaption,
          angleName,
          "tg_" + Date.now(),
          "telegram",
          selectedProduct.image_url || ""
        );
      }
    }
  }

  console.log("\n🏁 GitHub Actions Handover Execution Completed Successfully.");
}

main().catch(err => {
  console.error("Fatal Error:", err);
  process.exitCode = 1;
});

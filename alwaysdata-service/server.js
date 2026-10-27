/**
 * SocialAutomate - High-Efficiency Alwaysdata Node.js Gateway
 * -------------------------------------------------------------
 * 1. Meta Webhook Receiver (Facebook Messenger & Comments)
 * 2. Instant 200 OK Handshake (Never times out Meta's 5s rule)
 * 3. Gemini 3.8 Live Multimodal WebSocket Engine (Unlimited Live Audio + Text)
 * 4. Automatic Facebook Outbound Messenger & Comment Replies
 * 5. In-App WebView Modal (Tall Sheet - View Products inside Messenger)
 * 6. Multi-Product Carousel Slider (Swipeable Catalog of Products)
 * 7. Contextual Dynamic Quick Reply Pills ([🛍️ অর্ডার], [💰 ডেলিভারি], [📍 লোকেশন], [🔊 ভয়েস])
 * 8. One-Tap Click-to-Call Helpline Template (+8801874600203 & WhatsApp)
 * 9. Automated Abandoned Inquiry Follow-up (15-min re-engagement)
 * 10. Instant Telegram Order Alerts (First-turn confirm, edit, cancel, note)
 * 11. Live Store Catalog Auto-Fetch (ranonex.shop)
 * 12. Cloudflare Worker Session Sync (automate.ranonex.shop in sync)
 */

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS Middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Load local .env if present
try {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [k, ...v] = trimmed.split('=');
        if (k && !process.env[k.trim()]) process.env[k.trim()] = v.join('=').trim();
      }
    });
  }
} catch (e) {}

// ==========================================
// ⚙️ কনফিগারেশন ও এনভায়রনমেন্ট ভেরিয়েবল
// ==========================================
const CONFIG = {
  port: process.env.PORT || 8100,
  metaVerifyToken: process.env.META_VERIFY_TOKEN || "ranonex_social_secret_2026",
  metaPageId: process.env.META_PAGE_ID || "1287050647827199",
  metaPageAccessToken: process.env.META_PAGE_ACCESS_TOKEN || "EAAP26tyiJpMBSwbPigSP59zUgrW3nVwverL5dGtxzJxS7wgGZCwa5FZBTwnp5yLYqBWzvGQco6SuJEXgC7csi3mHZApVZCvRpB7zDCu6KnucWzOZC3jNN8uZCI4VWVlOLyj13uzzYo6lNWlzAr4DSi1QBuYqwHZBiSAxSlbwkJaOZAEZBNBTLwoZA5zOZAIegyGZBGcmC4DeXCKs",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: "models/gemini-3.8-live",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "8973914033:AAHA99QmtyefiGYFCePdNuD4ZPyp8xw1uVQ",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "5513474694",
  workerUrl: process.env.WORKER_URL || "https://social-automate.rifatrabbi104.workers.dev",
  storeHotline: "+8801874600203"
};

// Auto-sync tokens from Cloudflare D1 if missing
async function syncCredentialsFromWorker() {
  if (CONFIG.geminiApiKey && CONFIG.metaPageAccessToken && CONFIG.telegramBotToken) return;
  try {
    const res = await fetch(`${CONFIG.workerUrl}/api/settings`);
    if (res.ok) {
      const data = await res.json();
      const fb = data?.settings?.facebook;
      if (fb?.access_token && !CONFIG.metaPageAccessToken) {
        CONFIG.metaPageAccessToken = fb.access_token;
      }
      if (data?.settings?.ai?.api_key && !CONFIG.geminiApiKey) {
        CONFIG.geminiApiKey = data.settings.ai.api_key;
      }
      if (data?.settings?.telegram?.bot_token && !CONFIG.telegramBotToken) {
        CONFIG.telegramBotToken = data.settings.telegram.bot_token;
      }
      if (data?.settings?.telegram?.admin_chat_id && !CONFIG.telegramChatId) {
        CONFIG.telegramChatId = data.settings.telegram.admin_chat_id;
      }
    }
  } catch (e) {}
}
syncCredentialsFromWorker();

// ইন-মেমোরি চ্যাট হিস্ট্রি, অডিও ক্যাশ, প্রোডাক্ট ক্যাশ
const memorySessions = new Map();
const audioCache = new Map(); // audioId -> { buffer: Buffer, createdAt: number }
let productCatalogCache = { data: null, productsList: [], expiresAt: 0 };
let totalMessagesHandled = 0;

// ⚡ পারসিস্টেন্ট অ্যাক্টিভ লাইভ সকেট পুল (WebSocket Session Reuse - ws.send() দিয়ে লাইভ কনটেক্সট প্রিজার্ভ)
const activeLiveSockets = new Map(); // chatId -> { ws, isReady, lastActive, currentHandler, pcmChunks, accumulatedText }

// প্রতি ৫ মিনিট পর পর ১০ মিনিটের বেশি নিষ্ক্রিয় সকেট ক্লোজ ও ক্লিনআপ
setInterval(() => {
  const now = Date.now();
  for (const [chatId, entry] of activeLiveSockets.entries()) {
    if (now - entry.lastActive > 10 * 60 * 1000) {
      try { entry.ws.close(); } catch (e) {}
      activeLiveSockets.delete(chatId);
      console.log(`🔌 [Live WebSocket Idle Timeout Cleanup]: Socket for ${chatId} closed gracefully.`);
    }
  }
}, 5 * 60 * 1000);

// ==========================================
// 🎵 24kHz 16-BIT PCM to WAV CONVERTER
// ==========================================
function pcmToWav(pcmBuffer, sampleRate = 24000, numChannels = 1, bitDepth = 16) {
  const byteRate = sampleRate * numChannels * (bitDepth / 8);
  const blockAlign = numChannels * (bitDepth / 8);
  const dataSize = pcmBuffer.length;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(dataSize + 36, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  pcmBuffer.copy(buffer, 44);
  return buffer;
}

// অডিও ফাইল সার্ভিং রুট (Facebook Messenger-এ পাঠানোর জন্য)
app.get('/audio/:id.wav', (req, res) => {
  const item = audioCache.get(req.params.id);
  if (!item || !item.buffer) {
    return res.status(404).send("Audio not found or expired");
  }
  res.set({
    'Content-Type': 'audio/wav',
    'Content-Length': item.buffer.length,
    'Cache-Control': 'public, max-age=86400',
    'Accept-Ranges': 'bytes'
  });
  res.end(item.buffer);
});

// অন-ডিমান্ড অডিও জেনারেটর (যদি কোনো কারণে ক্যাশে না থাকে)
async function generateAudioFromText(text) {
  if (!CONFIG.geminiApiKey || !text) return null;
  const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${CONFIG.geminiApiKey}`;
  const ws = new WebSocket(wsUrl);

  return new Promise((resolve) => {
    const pcmChunks = [];
    const t = setTimeout(() => {
      try { ws.close(); } catch(e){}
      resolve(null);
    }, 12000);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: "models/gemini-3.8-live",
          generationConfig: { responseModalities: ["AUDIO"] },
          outputAudioTranscription: {}
        }
      }));
    };

    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data instanceof Blob ? await e.data.text() : e.data);
      if (msg.setupComplete !== undefined) {
        ws.send(JSON.stringify({
          clientContent: {
            turns: [{ role: "user", parts: [{ text: "Speak the following message naturally in Bengali: " + text.slice(0, 300) }] }],
            turnComplete: true
          }
        }));
      }
      if (msg.serverContent) {
        const parts = msg.serverContent.modelTurn?.parts || [];
        for (const p of parts) {
          if (p.inlineData && p.inlineData.data) {
            pcmChunks.push(Buffer.from(p.inlineData.data, 'base64'));
          }
        }
        if (msg.serverContent.turnComplete) {
          clearTimeout(t);
          try { ws.close(); } catch(e){}
          if (pcmChunks.length > 0) {
            const wav = pcmToWav(Buffer.concat(pcmChunks));
            const audioId = `aud_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            audioCache.set(audioId, { buffer: wav, createdAt: Date.now() });
            resolve({ audioId, audioUrl: `https://ranonex.alwaysdata.net/audio/${audioId}.wav` });
          } else {
            resolve(null);
          }
        }
      }
    };
    ws.onerror = () => { clearTimeout(t); resolve(null); };
  });
}

// ==========================================
// 🧹 টেক্সট ক্লিনার (ORDER_JSON সম্পূর্ণ হাইড করার জন্য)
// ==========================================
function cleanCustomerReply(raw) {
  if (!raw) return "";
  return raw
    .replace(/(?:ORDER_JSON|ORDER_UPDATE_JSON|ORDER_CANCEL_JSON|ORDER_NOTE_JSON)[\s\S]*/i, "")
    .replace(/```(?:json)?[\s\S]*?```/gi, "")
    .replace(/\{[\s\r\n]*"(?:order_confirmed|customer_name|order_updated|order_cancelled|order_note|delivery_address)"[\s\S]*?\}/gi, "")
    .replace(/\{[\s\S]*?\}[\s]*$/gi, "")
    .trim();
}

// ==========================================
// ⚡ বুলেটপ্রুফ অর্ডার অ্যাকশন ও ফার্স্ট-টার্ন ডিটেক্টর
// ==========================================
// 📞 বাংলাদেশি ফোন নম্বর এক্সট্র্যাক্টর (বাংলা ও ইংরেজি সংখ্যা, স্পেস, হাইফেন হ্যান্ডলার)
// ==========================================
function extractBangladeshiPhone(str) {
  if (!str) return "";
  const bengaliDigits = {'০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9'};
  const normalized = String(str).replace(/[০-৯]/g, d => bengaliDigits[d]);
  const cleaned = normalized.replace(/[\s\-\.\(\)]/g, '');
  const m = cleaned.match(/(?:(?:\+?88)?01[3-9]\d{8})/);
  if (m) {
    return m[0].replace(/^\+?88/, '');
  }
  return "";
}

// ==========================================
// ⚡ বুলেটপ্রুফ কাস্টমার নাম, ফোন ও ঠিকানা পার্সার
// ==========================================
function parseOrderDetailsFromText(text) {
  let name = "", phone = "", address = "";
  if (!text) return { name, phone, address };

  // ১. বাংলাদেশি ফোন নম্বর
  phone = extractBangladeshiPhone(text);

  // ২. সরাসরি লেবেল ভিত্তিক পার্সিং
  const nameMatch = text.match(/(?:নাম|name)\s*[:ঃ-]?\s*([^\r\n,;]+)/i);
  if (nameMatch) name = nameMatch[1].trim();

  const addrMatch = text.match(/(?:ঠিকানা|address|লোকেশন|location)\s*[:ঃ-]?\s*([^\r\n]+)/i);
  if (addrMatch) address = addrMatch[1].trim();

  // ৩. যদি ফোন থাকে কিন্তু নাম বা ঠিকানা না থাকে, ফোন বাউন্ডারি দিয়ে আলাদা করা
  if (phone && (!name || !address)) {
    const rawDigits = phone;
    const phoneIdx = text.search(new RegExp(`(?:\\+?88)?0?${rawDigits.slice(-10)}`));
    if (phoneIdx !== -1) {
      const before = text.substring(0, phoneIdx).trim();
      const after = text.substring(phoneIdx + 11).trim();

      if (!name && before) {
        const cleanBefore = before.replace(/^(?:নাম|name)\s*[:ঃ-]?\s*/i, '').replace(/[,\r\n;]+$/, '').trim();
        if (cleanBefore.length >= 2 && cleanBefore.length < 40 && !/ঢাকা|চট্টগ্রাম|কুমিল্লা|গ্রাম|রোড/i.test(cleanBefore)) {
          name = cleanBefore;
        }
      }
      if (!address && after) {
        const cleanAfter = after.replace(/^(?:ঠিকানা|address)\s*[:ঃ-]?\s*/i, '').replace(/^[,\r\n;]+/, '').trim();
        if (cleanAfter.length >= 4) {
          address = cleanAfter;
        }
      }
    }
  }

  // ৪. লাইন বাই লাইন ফলব্যাক
  if (!address || !name) {
    const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const clean = line.replace(/^(?:নাম|name|ঠিকানা|address|মোবাইল|ফোন|phone)\s*[:ঃ-]?\s*/i, '').trim();
      if (!address && (/ঢাকা|কুমিল্লা|চট্টগ্রাম|রাজশাহী|সিলেট|খুলনা|বরিশাল|রংপুর|বাসা|রোড|গ্রাম|থানা|জেলা|পোস্ট|উপজেলা|sector|block|house|road|village|post|dhaka|cumilla|chittagong/i.test(line) || clean.length > 15)) {
        address = clean;
      } else if (!name && clean.length >= 2 && clean.length < 35 && !/অর্ডার|order|confirm|দাম|টাকা|চাই|নেব|product|01[3-9]/i.test(clean)) {
        name = clean;
      }
    }
  }

  return { name, phone, address };
}

// ==========================================
// ⚡ বুলেটপ্রুফ অর্ডার অ্যাকশন ও ফার্স্ট-টার্ন ডিটেক্টর
// ==========================================
function extractOrderActions(raw, replyText = "", messages = [], activeProduct = null) {
  let order_confirmed = false;
  let order_updated = false;
  let order_cancelled = false;
  let order_note = false;
  let order_data = null;
  let note = "";

  // মেসেজ হিস্ট্রি থেকে কাস্টমারের দেওয়া ফোন, নাম ও ঠিকানা বের করা
  let foundPhone = "";
  let foundName = "";
  let foundAddress = "";

  if (Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const mText = messages[i].message_text || "";
      const parsed = parseOrderDetailsFromText(mText);
      if (!foundPhone && parsed.phone) foundPhone = parsed.phone;
      if (!foundName && parsed.name) foundName = parsed.name;
      if (!foundAddress && parsed.address) foundAddress = parsed.address;
    }
    const lastMsg = messages[messages.length - 1];
    if (!foundName && lastMsg?.sender_name && !lastMsg.sender_name.startsWith("Facebook User")) {
      foundName = lastMsg.sender_name;
    }
  }

  // ১. ORDER_JSON মার্কার চেক
  const orderMatch = raw.match(/ORDER_JSON:\s*(\{[\s\S]*?\})/i);
  if (orderMatch) {
    try {
      const p = JSON.parse(orderMatch[1]);
      if (p.customer_phone) {
        const pPhone = extractBangladeshiPhone(p.customer_phone);
        if (pPhone) foundPhone = pPhone;
      }
      if (p.customer_name && !p.customer_name.startsWith("Facebook User") && p.customer_name !== "Customer" && p.customer_name !== "...") {
        foundName = p.customer_name;
      }
      if (p.delivery_address && p.delivery_address !== "..." && p.delivery_address !== "ইনবক্সে প্রদত্ত ঠিকানা") {
        foundAddress = p.delivery_address;
      }
    } catch (e) {}
  }

  // ২. প্রথম টার্নেই কনফার্মেশন যাচাই (কখনোই ট্র্যাকিং বা প্রসেস স্টেটাসকে অর্ডার ভাবা যাবে না)
  const isConfirmSpoken = /(?:অর্ডার(?:টি)?\s*(?:সফলভাবে\s*)?কনফার্ম(?:\s*করা)?\s*হয়েছে|অর্ডার(?:টি)?\s*(?:সফলভাবে\s*)?নিশ্চিত(?:\s*করা)?\s*হয়েছে|আপনার\s*অর্ডার(?:টি)?\s*গ্রহণ\s*করা\s*হয়েছে)/i.test(replyText);

  // ৩. কঠোর সত্যতা যাচাই: ফোন নম্বর (১১ ডিজিট), ডেলিভারি ঠিকানা এবং বৈধ প্রোডাক্ট থাকলেই কেবল কনফার্ম হবে
  const hasPhone = foundPhone && foundPhone.length >= 11;
  const hasAddress = foundAddress && foundAddress.length >= 4 && foundAddress !== "ইনবক্সে প্রদত্ত ঠিকানা";
  const hasValidProduct = activeProduct && activeProduct.name && activeProduct.name !== "Ranonex Store Product" && Number(activeProduct.price) > 0;

  if (isConfirmSpoken && hasPhone && hasAddress && hasValidProduct) {
    const isDhaka = /ঢাকা|dhaka/i.test(foundAddress) && !/ঢাকার\s*বাইরে|outside/i.test(foundAddress);
    const deliveryCharge = isDhaka ? 70 : 130;
    const basePrice = parseFloat(activeProduct.price || 0);
    const total = basePrice + deliveryCharge;

    order_confirmed = true;
    order_data = {
      order_confirmed: true,
      customer_name: foundName || "Customer",
      customer_phone: foundPhone,
      delivery_address: foundAddress,
      product_name: activeProduct.name,
      variant: "Standard",
      total_amount: total
    };
    console.log(`🎉 [Auto-Detected Real Order Confirmation]: Customer "${order_data.customer_name}", Phone "${foundPhone}", Product "${activeProduct.name}", Total ৳${total}`);
  }

  // ৩. ORDER_UPDATE_JSON (১৫ মিনিটের মধ্যে পরিবর্তন)
  const updateMatch = raw.match(/ORDER_UPDATE_JSON:\s*(\{[\s\S]*?\})/i);
  if (updateMatch) {
    try {
      const p = JSON.parse(updateMatch[1]);
      order_updated = true;
      order_data = p;
    } catch (e) {}
  }

  // ৪. ORDER_CANCEL_JSON (অর্ডার বাতিল)
  const cancelMatch = raw.match(/ORDER_CANCEL_JSON:\s*(\{[\s\S]*?\})/i);
  if (cancelMatch) {
    try {
      const p = JSON.parse(cancelMatch[1]);
      order_cancelled = true;
      order_data = p;
      note = p.reason || "Customer requested cancellation";
    } catch (e) {
      order_cancelled = true;
      note = "Customer requested cancellation";
    }
  }

  // ৫. ORDER_NOTE_JSON (১৫ মিনিট পরের নোট)
  const noteMatch = raw.match(/ORDER_NOTE_JSON:\s*(\{[\s\S]*?\})/i);
  if (noteMatch) {
    try {
      const p = JSON.parse(noteMatch[1]);
      order_note = true;
      note = p.note || "";
    } catch (e) {}
  }

  return { order_confirmed, order_updated, order_cancelled, order_note, order_data, note };
}

// ==========================================
// 📦 লাইভ স্টোর প্রোডাক্টস ও পলিসি ফেচ
// ==========================================
async function getStoreCatalog() {
  const now = Date.now();
  if (productCatalogCache.data && productCatalogCache.expiresAt > now) {
    return productCatalogCache;
  }

  let catalog = `=== STORE POLICIES & INFORMATION ===
- Store Name: Ranonex (Website: https://ranonex.shop)
- Hotline: ${CONFIG.storeHotline}
- Delivery Charge: ঢাকা সিটির ভেতরে ৭০ টাকা, ঢাকার বাইরে ১৩০ টাকা।
- Payment Method: Cash on Delivery (ক্যাশ অন ডেলিভারি - পণ্য হাতে পেয়ে টাকা পরিশোধ)
- Return Policy: ডেলিভারির সময় পার্সেল চেক করে দেখে নেওয়ার সুযোগ।
- Helpline: ${CONFIG.storeHotline} (সরাসরি কল বা হোয়াটসঅ্যাপ)

=== AVAILABLE STORE PRODUCTS (WITH SKU & DIRECT ORDER LINKS) ===\n`;

  const productsList = [];

  try {
    const res = await fetch("https://ranonex.shop/api/public-data", {
      headers: { "User-Agent": "SocialAutomate-Alwaysdata/1.0" }
    });
    if (res.ok) {
      const json = await res.json();
      const items = json?.data?.products || (Array.isArray(json?.data) ? json.data : []);
      if (Array.isArray(items) && items.length > 0) {
        for (const p of items) {
          const sku = (p.sku && p.sku.trim()) ? p.sku.trim() : (p.id ? p.id.toUpperCase() : "SKU");
          const price = p.flash_sale_price && p.flash_sale_price > 0 && p.flash_sale_price < p.base_price
            ? (p.base_price - p.flash_sale_price)
            : (p.base_price || 0);
          const link = `https://ranonex.shop/product.html?id=${encodeURIComponent(p.id)}`;

          let gallery = [];
          try {
            gallery = typeof p.gallery_images === 'string' ? JSON.parse(p.gallery_images) : (p.gallery_images || []);
          } catch(e) {}
          const imgUrl = (Array.isArray(gallery) && gallery[0]) ? gallery[0] : "https://ranonex.shop/assets/logo.png";

          const pObj = {
            id: p.id,
            sku,
            name: p.name,
            price,
            image_url: imgUrl,
            url: link,
            category: p.category || "",
            description: cleanDesc
          };
          pObj.searchTokens = extractProductTokens(pObj);
          productsList.push(pObj);

          catalog += `- [SKU: ${sku}] ${p.name}
    * EXACT PRICE: ৳${price} (${price} BDT)
    * ORDER LINK: ${link}
    * SPECS: ${p.specifications || 'Standard'}
    * KEY FEATURES / INFO: ${cleanDesc || 'প্রিমিয়াম কোয়ালিটি ও আকর্ষণীয় পারফরম্যান্স'}\n`;
        }
      }
    }
  } catch (err) {
    console.warn("Product fetch warning:", err.message);
  }

  productCatalogCache = { data: catalog, productsList, expiresAt: now + 10 * 60 * 1000 };
  return productCatalogCache;
}

// 🔍 প্রতিটি প্রোডাক্টের জন্য ডাইনামিক সার্চ টোকেন তৈরি (যেকোনো নতুন প্রোডাক্ট স্বয়ংক্রিয়ভাবে ইনডেক্স হবে)
function extractProductTokens(p) {
  const tokens = new Set();
  if (!p) return [];

  // ১. প্রোডাক্ট আইডি ও এসকেইউ
  if (p.id) {
    tokens.add(p.id.toLowerCase());
    p.id.toLowerCase().split(/[-_]+/).forEach(t => t.length > 1 && tokens.add(t));
  }
  if (p.sku) {
    tokens.add(p.sku.toLowerCase());
    p.sku.toLowerCase().split(/[-_]+/).forEach(t => t.length > 1 && tokens.add(t));
  }

  // ২. প্রোডাক্টের নামের শব্দসমূহ (ইংরেজি ও বাংলা)
  const nameWords = (p.name || '')
    .toLowerCase()
    .replace(/[^\w\u0980-\u09FF\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);
  nameWords.forEach(w => tokens.add(w));

  // ৩. ক্যাটাগরি ও স্পেক্স
  if (p.category) {
    p.category.toLowerCase().split(/\s+/).filter(w => w.length >= 3).forEach(w => tokens.add(w));
  }

  // ৪. সার্বজনীন বাংলা ও ব্যাংলিশ প্রতিশব্দ ম্যাপিং (ঘড়ি, কুলার, হুডি, পাঞ্জাবি, গেম, ইয়ারফোন ইত্যাদি)
  const fullContent = `${p.name || ''} ${p.description || ''} ${p.specifications || ''} ${p.category || ''} ${p.id || ''}`.toLowerCase();

  // ঘড়ি / Watch
  if (/watch|smartwatch|clock|ঘড়ি|ঘড়ির|হাতঘড়ি|skeleton|wc-1001/i.test(fullContent)) {
    ['watch', 'smartwatch', 'ghori', 'ghorir', 'hatghori', 'ঘড়ি', 'ঘড়ির', 'হাতঘড়ি', 'ওয়াচ', 'ঘড়ী', 'ঘড়িটা'].forEach(t => tokens.add(t));
  }
  // কুলার / Cooler / Fan
  if (/cooler|glacier|fan|কুলার|ফ্যান|ga6|prod_1/i.test(fullContent)) {
    ['cooler', 'kuler', 'mobile cooler', 'phone cooler', 'fan', 'কুলার', 'মোবাইল কুলার', 'ফোন কুলার', 'ফ্যান', 'কুলারটা'].forEach(t => tokens.add(t));
  }
  // গেম কনসোল / Game Console
  if (/game|console|handheld|retro|gaming|controller|gc-1102|p6|j36|x9|গেম|গেমিং/i.test(fullContent)) {
    ['game', 'console', 'game console', 'gaming', 'retro', 'handheld', 'গেম', 'গেম কনসোল', 'গেমিং', 'ভিডিও গেম', 'কনসোল', 'p6', 'j36'].forEach(t => tokens.add(t));
  }
  // ইয়ারফোন / Headphone
  if (/earphone|headphone|headset|ep-1100|m105|ইয়ারফোন|হেডফোন/i.test(fullContent)) {
    ['earphone', 'headphone', 'headset', 'hedphone', 'earfon', 'ইয়ারফোন', 'হেডফোন', 'হেডফন', 'ইয়ারফোন'].forEach(t => tokens.add(t));
  }
  // ইয়ারবাড / Earbuds
  if (/earbuds|earbud|airbuds|airpod|airpods|tws|ep-1105|k8|বাডস|ইয়ারবাড/i.test(fullContent)) {
    ['earbuds', 'earbud', 'airbuds', 'airpod', 'airpods', 'buds', 'tws', 'ইয়ারবাড', 'বাডস', 'ইয়ারবাড', 'বাড'].forEach(t => tokens.add(t));
  }
  // মাইক্রোফোন / Mic
  if (/mic|microphone|lavalier|boya|lm-1100|mw6|মাইক্রোফোন|মাইক/i.test(fullContent)) {
    ['microphone', 'mic', 'maykrofon', 'maik', 'মাইক্রোফোন', 'মাইক', 'মাউথপিস'].forEach(t => tokens.add(t));
  }
  // পাওয়ার ব্যাংক / Power Bank
  if (/power\s*bank|powerbank|magsafe|pb_1100|10000mah|পাওয়ার\s*ব্যাংক/i.test(fullContent)) {
    ['powerbank', 'power bank', 'pawer bank', 'powar bank', 'পাওয়ার ব্যাংক', 'পাওয়ারব্যাংক'].forEach(t => tokens.add(t));
  }
  // লাইট / Light / Neon
  if (/light|neon|rope|argb|rgb|prod_2|নিয়ন|লাইট/i.test(fullContent)) {
    ['light', 'neon', 'led', 'rgb', 'lait', 'নিয়ন', 'রিমোট লাইট', 'লাইট', 'আলো'].forEach(t => tokens.add(t));
  }
  // হুডি / Hoodie
  if (/hoodie|pullover|ds-1100|hd_1100|dropshoulder|হুডি|ড্রপশোল্ডার/i.test(fullContent)) {
    ['hoodie', 'hodi', 'hudy', 'dropshoulder', 'dropsoulder', 'হুডি', 'ড্রপশোল্ডার', 'পেইজলি হুডি', 'উইন্টার হুডি'].forEach(t => tokens.add(t));
  }
  // পাঞ্জাবি / Panjabi
  if (/panjabi|punjabi|crinkle|pj-100|pj-101|pj-102|pj-103|pj-104|পাঞ্জাবি|পাঞ্জাবী/i.test(fullContent)) {
    ['panjabi', 'punjabi', 'panzabi', 'পাঞ্জাবি', 'পাঞ্জাবী', 'পাঞ্জাবিটা'].forEach(t => tokens.add(t));
  }

  return Array.from(tokens);
}

// 🔍 বাংলা ও ইংরেজি সিনোনিম এবং কীওয়ার্ড ব্যাকআপ তালিকা
const BENGALI_PRODUCT_KEYWORDS = [
  { matchWords: ['ঘড়ি', 'ঘড়ির', 'হাতঘড়ি', 'watch', 'ঘড়িটা', 'skeleton', 'wc-1001', 'ওয়াচ'], id: 'wc-1001' },
  { matchWords: ['কুলার', 'মোবাইল কুলার', 'ফোন কুলার', 'cooler', 'ga6', 'hoco ga6', 'glacier', 'fan', 'ফ্যান'], id: 'prod_1' },
  { matchWords: ['গেম কনসোল', 'গেম', 'গেমিং', 'console', 'game', 'handheld', 'retro', 'ভিডিও গেম', 'p6', 'j36', 'x9'], id: 'gc-1102' },
  { matchWords: ['ইয়ারফোন', 'হেডফোন', 'হেডফন', 'headphone', 'earphone', 'গেমিং ইয়ারফোন', 'm105', 'hoco m105'], id: 'ep-1100' },
  { matchWords: ['ইয়ারবাড', 'বাডস', 'earbuds', 'earbud', 'k8', 'wireless earbuds'], id: 'ep-1105' },
  { matchWords: ['মাইক্রোফোন', 'মাইক', 'মাউথপিস', 'microphone', 'mic', 'boya', 'lavalier', 'by-mw6', 'mw6'], id: 'lm-1100' },
  { matchWords: ['পাওয়ার ব্যাংক', 'পাওয়ারব্যাংক', 'power bank', 'powerbank', 'magsafe', 'vd-pb030', '10000mah'], id: 'pb_1100' },
  { matchWords: ['নিয়ন লাইট', 'নিয়ন', 'রিমোট লাইট', 'লাইট', 'neon', 'rope', 'argb', 'rgb light', 'আলো', 'light'], id: 'prod_2' },
  { matchWords: ['পেইজলি হুডি', 'paisley', 'hoodie', 'ড্রপশোল্ডার', 'কম্বো', 'dropshoulder', 'dropsoulder', 'হুডি'], id: 'ds-1100' },
  { matchWords: ['সলিড হুডি', 'solid hoodie', 'pullover', 'উইন্টার হুডি', 'plain hoodie'], id: 'hd_1100' },
  { matchWords: ['অলিভ পাঞ্জাবি', 'crinkle panjabi', 'crinkle', 'panjabi', 'পাঞ্জাবি', 'পাঞ্জাবী'], id: 'pj-101' },
  { matchWords: ['সি গ্রিন পাঞ্জাবি', 'sea green', 'micro stick'], id: 'pj-100' },
  { matchWords: ['পপকন পাঞ্জাবি', 'popcon', 'cream panjabi', 'ক্রিম কালার'], id: 'pj-104' },
  { matchWords: ['সাদা পাঞ্জাবি', 'হোয়াইট পাঞ্জাবি', 'giza cotton', 'white panjabi'], id: 'pj-103' },
  { matchWords: ['চেরি পাঞ্জাবি', 'cherry spandex'], id: 'pj-102' }
];

// টেক্সট থেকে প্রোডাক্ট খোঁজা (বাংলা, ইংরেজি, ব্যাংলিশ, SKU ও ডাইনামিক টোকেন স্কোরিং)
function findMatchingProduct(text, productsList) {
  if (!text || !Array.isArray(productsList) || productsList.length === 0) return null;
  const lower = text.toLowerCase().trim();

  // ১. সরাসরি আইডি বা SKU মিল
  for (const p of productsList) {
    if (lower.includes(p.id.toLowerCase())) return p;
    if (p.sku && lower.includes(p.sku.toLowerCase())) return p;
  }

  // ২. বাংলা ব্যাকআপ সিনোনিম কীওয়ার্ড মিল
  for (const item of BENGALI_PRODUCT_KEYWORDS) {
    for (const kw of item.matchWords) {
      if (lower.includes(kw.toLowerCase())) {
        const found = productsList.find(p => p.id === item.id);
        if (found) return found;
      }
    }
  }

  // ৩. ডাইনামিক টোকেন স্কোরিং (বাংলা, ব্যাংলিশ ও ইংরেজি ম্যাচ)
  let bestProduct = null;
  let highestScore = 0;

  for (const p of productsList) {
    let score = 0;
    const tokens = p.searchTokens || extractProductTokens(p);

    for (const token of tokens) {
      if (!token || token.length < 3) continue;
      if (lower.includes(token.toLowerCase())) {
        // যদি টোকেনটি সরাসরি প্রোডাক্টের টাইটেলে থাকে
        if (p.name.toLowerCase().includes(token.toLowerCase())) {
          score += 4;
        } else {
          score += 2;
        }
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestProduct = p;
    }
  }

  if (highestScore >= 2) {
    return bestProduct;
  }

  // ৪. যেকোনো নতুন প্রোডাক্টের টাইটেল থেকে বড় শব্দের মিল (ফ্যাক্টরি ফলব্যাক)
  for (const p of productsList) {
    const words = p.name.toLowerCase().split(/\s+/).filter(w => w.length >= 4 && !['with', 'control', 'original', 'retro', 'sharp', 'black', 'white'].includes(w));
    for (const w of words) {
      if (lower.includes(w)) {
        return p;
      }
    }
  }

  return null;
}

// ==========================================
// 💡 স্মার্ট কনটেক্সচুয়াল কুইক রিপ্লাই বাটন বিল্ডার
// ==========================================
function buildContextualQuickReplies(session, aiDecision, audioId) {
  const quickReplies = [];

  // ১. যদি অর্ডার কনফার্ম থাকে (১৫ মিনিটের মধ্যে পরিবর্তন/বাতিল বাটন)
  if (aiDecision.order_confirmed || (session.last_order_data && !session.last_order_cancelled)) {
    quickReplies.push({ content_type: "text", title: "🔄 ঠিকানা পরিবর্তন", payload: "ACTION_EDIT_ORDER" });
    quickReplies.push({ content_type: "text", title: "❌ অর্ডার বাতিল", payload: "ACTION_CANCEL_ORDER" });
    quickReplies.push({ content_type: "text", title: "📞 হেল্পলাইনে কল", payload: "ACTION_CALL_SUPPORT" });
  } 
  // ২. যদি কাস্টমার লোকেশন বা ঠিকানা সংক্রান্ত কথা বলে
  else if (/ঠিকানা|লোকেশন|ঢাকার|চার্জ|পাঠিয়ে দিন/i.test(aiDecision.reply)) {
    quickReplies.push({ content_type: "text", title: "📍 ঢাকার ভেতরে (৭০৳)", payload: "ACTION_LOCATION_DHAKA" });
    quickReplies.push({ content_type: "text", title: "📍 ঢাকার বাইরে (১৩০৳)", payload: "ACTION_LOCATION_OUTSIDE" });
    quickReplies.push({ content_type: "text", title: "🛍️ এখনই অর্ডার করব", payload: "ACTION_ORDER_NOW" });
  } 
  // ৩. সাধারণ প্রোডাক্ট ইনকোয়ারি স্টেজ
  else {
    quickReplies.push({ content_type: "text", title: "🛍️ এখনই অর্ডার করব", payload: "ACTION_ORDER_NOW" });
    quickReplies.push({ content_type: "text", title: "💰 ডেলিভারি চার্জ কত?", payload: "ACTION_DELIVERY_CHARGE" });
    quickReplies.push({ content_type: "text", title: "📦 পার্সেল চেক?", payload: "ACTION_PARCEL_CHECK" });
    quickReplies.push({ content_type: "text", title: "📜 সব প্রোডাক্ট দেখুন", payload: "ACTION_SHOW_CATALOG" });
  }

  // 🔊 ভয়েস শুনুন বাটন বাধ্যতামূলকভাবে সর্বশেষে সংযুক্ত করা
  const audioIdForButton = audioId || `aud_fallback_${Date.now()}`;
  quickReplies.push({ content_type: "text", title: "🔊 ভয়েস শুনুন", payload: `PLAY_AUDIO_${audioIdForButton}` });

  return quickReplies.slice(0, 11); // মেটা সর্বোচ্চ ১৩টি বাটন অনুমোদন করে
}

// ==========================================
// 🤖 GEMINI 3.8 LIVE MULTIMODAL WEBSOCKET ENGINE
// (WebSocket Session Reuse via ws.send() + Multimodal Image Vision)
// ==========================================
async function callGeminiSalesAI(
  incomingText,
  chatHistory = [],
  session = null,
  incomingAudioBuffer = null,
  audioMimeType = "audio/mp4",
  incomingImageBuffer = null,
  imageMimeType = "image/jpeg"
) {
  if (!CONFIG.geminiApiKey || CONFIG.geminiApiKey === "YOUR_GEMINI_API_KEY") {
    return {
      reply: "ধন্যবাদ আপনার বার্তার জন্য! আমাদের একজন প্রতিনিধি খুব শীঘ্রই আপনাকে সহায়তা করবেন। নির্দিষ্ট কোনো প্রোডাক্ট সম্পর্কে জানতে চাইলে নির্দ্বিধায় লিখুন।",
      order_confirmed: false,
      order_updated: false,
      order_cancelled: false,
      order_note: false,
      order_data: null,
      note: "",
      audio_id: null,
      audio_url: null
    };
  }

  const { data: catalog, productsList } = await getStoreCatalog();

  // অর্ডার টাইম উইন্ডো চেক (কেবলমাত্র কাস্টমার পূর্বের অর্ডার নিয়ে কথা বললে বা ট্র্যাকিং/পরিবর্তন চাইলে কার্যকর হবে)
  let orderTimeContext = "";
  const now = Date.now();
  const isOrderQuery = /(?:অর্ডার|কখন|দেরি|ট্র্যাকিং|কবে|ঠিকানা পরিবর্তন|বাতিল|ক্যান্সেল|cancel|edit|status|tracking|delivery)/i.test(incomingText);

  if (isOrderQuery && session && session.last_order_data && session.last_order_data.total_amount > 0 && session.last_order_time && !session.last_order_cancelled) {
    const elapsedMinutes = Math.floor((now - session.last_order_time) / (60 * 1000));
    if (elapsedMinutes <= 15) {
      orderTimeContext = `
[ORDER STATUS CONTEXT: Customer confirmed an order ${elapsedMinutes} minute(s) ago:
- Customer Name: ${session.last_order_data.customer_name || 'N/A'}
- Phone: ${session.last_order_data.customer_phone || 'N/A'}
- Address: ${session.last_order_data.delivery_address || 'N/A'}
- Product: ${session.last_order_data.product_name || 'N/A'}
Time remaining for direct edit/cancel: ${15 - elapsedMinutes} minute(s).
RULES:
1. If customer wants to edit/change address, phone, product, or variant:
   Confirm update politely & output:
   ORDER_UPDATE_JSON: {"order_updated": true, "customer_name": "...", "customer_phone": "...", "delivery_address": "...", "product_name": "...", "variant": "...", "total_amount": 0}
2. If customer wants to cancel:
   Politely confirm cancellation & output:
   ORDER_CANCEL_JSON: {"order_cancelled": true, "customer_name": "${session.last_order_data.customer_name || 'Customer'}", "customer_phone": "${session.last_order_data.customer_phone || ''}", "product_name": "${session.last_order_data.product_name || ''}", "reason": "Customer requested cancellation"}]`;
    } else {
      orderTimeContext = `
[ORDER STATUS CONTEXT: Customer confirmed an order ${elapsedMinutes} minutes ago (more than 15 minutes have passed):
- Customer Name: ${session.last_order_data.customer_name || 'N/A'}
- Phone: ${session.last_order_data.customer_phone || 'N/A'}
- Address: ${session.last_order_data.delivery_address || 'N/A'}
- Product: ${session.last_order_data.product_name || 'N/A'}
RULE: The 15-minute direct edit window has expired. Direct change is locked.
Add request as an urgent NOTE for delivery team:
Output:
ORDER_NOTE_JSON: {"order_note": true, "note": "Customer requested change/cancellation...", "customer_name": "${session.last_order_data.customer_name || 'Customer'}"}]`;
    }
  }

  // সক্রিয় ও আলোচিত প্রোডাক্টের তালিকা
  const activeProduct = session?.selected_order_product || session?.last_discussed_product || null;
  const discussedProducts = Array.isArray(session?.discussed_products) ? session.discussed_products : [];

  let productsDiscussionContext = "";
  if (discussedProducts.length > 1 && !session?.selected_order_product) {
    productsDiscussionContext = `
[MULTIPLE PRODUCTS DISCUSSED IN THIS CONVERSATION:
The customer has inquired about multiple items:
${discussedProducts.map((p, idx) => `${idx + 1}. ${p.name} - ৳${p.price} (Link: ${p.url})`).join('\n')}

CRITICAL RULE FOR ORDERING WHEN MULTIPLE PRODUCTS DISCUSSED:
- If the customer says "আমি অর্ডার করতে চাই" / "অর্ডার কনফার্ম করুন" or provides contact details (Phone, Address) WITHOUT specifying which of these items they want:
  DO NOT guess the product!
  Politely ask them with numbering in pure Bengali script (বাংলা লিপি):
  "আপনি কোন প্রোডাক্টটি অর্ডার করতে চান? দয়া করে নম্বর বা নাম লিখে জানান:
${discussedProducts.map((p, idx) => `  ${['১','২','৩','৪','৫'][idx] || (idx+1)}. ${p.name} (মূল্য: ৳${p.price}/-)`).join('\n')}
  (যেটি নিতে চান সেটির নম্বর বা নামটি লিখে জানিয়ে দিন)"
- Once the customer specifies the number (e.g. "১" বা "২") or mentions the name, immediately confirm that specific product!]`;
  } else if (activeProduct) {
    productsDiscussionContext = `
[SINGLE ACTIVE PRODUCT UNDER DISCUSSION:
- Product Name: ${activeProduct.name}
- SKU: ${activeProduct.sku}
- Price: ৳${activeProduct.price}
- Link: ${activeProduct.url}

CRITICAL RULE FOR SINGLE PRODUCT ORDER CONFIRMATION:
- When only 1 product has been discussed, and the customer says they want to order or provides their Name, 11-digit Phone (01XXXXXXXXX), and Address:
  THE CUSTOMER DOES NOT NEED TO REPEAT THE PRODUCT NAME!
  You already know they want '${activeProduct.name}'.
  Immediately understand and confirm the order for '${activeProduct.name}' on the very first turn!
  Never ask "কোন প্রোডাক্টটি নিতে চান?" when only this 1 product was discussed.]`;
  }

  const isFirstMessage = !Array.isArray(chatHistory) || chatHistory.length <= 1;

  const systemInstruction = `You are the official AI Sales Assistant of 'Ranonex' online store in Bangladesh (https://ranonex.shop).

CRITICAL BRAND & LANGUAGE RULES:
1. STRICT ZERO BANGLISH POLICY:
   - You MUST ALWAYS respond in pure, polite, and natural Bengali script (খাঁটি বাংলা লিপি).
   - Under NO circumstances should you EVER respond in Banglish!
   - Even if the customer writes in Banglish, reply 100% in pure Bengali script (বাংলা লিপি).

2. STORE BRAND NAME IN ENGLISH ONLY:
   - ALWAYS write the store brand name in English letters as "Ranonex".

3. STRICT IDENTITY & NO-REPETITIVE-INTRO RULE:
   ${isFirstMessage ? `- ONLY on the very first greeting (if customer says 'hi/hello/salam'), introduce yourself ONCE: "আমি Ranonex স্টোরের সেলস অ্যাসিস্ট্যান্ট..."` : `- DO NOT INTRODUCE YOURSELF! Never repeat "আমি Ranonex স্টোরের সেলস অ্যাসিস্ট্যান্ট..." on subsequent messages or voice replies! Answer directly like a helpful human conversation.`}

4. STRICT PRODUCT PRICE INTEGRITY:
   - Quote the EXACT numeric price listed under 'EXACT PRICE' in the catalog.
   - For example, if EXACT PRICE is ৳1315, state "১৩১৫ টাকা (1315 ৳)". Never drop zeros.

5. 🛍️ COMPLETE PRODUCT CONSULTATION, URL & IN-CHAT ORDERING GUIDE (প্রোডাক্ট তথ্য, লিংক ও মেসেজে অর্ডারের নিয়ম):
   - Whenever ANY product is discussed, asked about, or recommended:
     You MUST ALWAYS provide a complete, well-structured, and helpful response in pure Bengali script containing ALL of the following essential details:
     1. Product Name & Core Features/Benefits: State the product name and explain its core features, specs, and benefits in 1-2 attractive, helpful lines based on KEY FEATURES/SPECS in the catalog.
     2. Exact Price: Clearly state the current offer price: "এর বর্তমান অফার মূল্য মাত্র [Exact Price] টাকা।"
     3. Delivery Terms & Charge: "সারা বাংলাদেশে ক্যাশ অন হোম ডেলিভারিতে পার্সেল চেক করে নেওয়ার নিশ্চয়তা রয়েছে (ডেলিভারি চার্জ: ঢাকা সিটিতে মাত্র ৭০ টাকা, এবং ঢাকার বাইরে ১৩০ টাকা)।"
     4. Direct Website Product Link: Include the direct ORDER LINK from the catalog:
        "🔗 বিস্তারিত দেখতে বা সরাসরি ওয়েবসাইট থেকে অর্ডার লিংক: [ORDER LINK]"
     5. Clear In-Chat Ordering Instructions (মেসেজে অর্ডার করার নিয়ম): Clearly instruct the customer:
        "📩 অথবা এখনই ইনবক্সে মেসেজের মাধ্যমে ক্যাশ অন ডেলিভারিতে অর্ডার করতে আপনার:
        ১. পুরো নাম
        ২. ১১ ডিজিটের মোবাইল নম্বর
        ৩. সম্পূর্ণ ডেলিভারি ঠিকানা
        লিখে পাঠিয়ে দিন।"
     6. Polite Gentle Follow-up: Courteously ask: "আপনার কি এই প্রোডাক্টটি সম্পর্কে আরও কিছু জানার আছে, নাকি এখনই অর্ডার কনফার্ম করে দেব?"

6. 🚨 STRICT FIRST-TURN ORDER CONFIRMATION RULE (কড়াকড়ি নিয়ম):
   - THE VERY INSTANT the customer provides their Name, 11-digit Bangladeshi Phone Number (01XXXXXXXXX), and Delivery Address:
   - YOU MUST IMMEDIATELY CONFIRM THE ORDER ON THAT VERY FIRST TURN!
   - DO NOT wait for a 2nd confirmation!
   - State warmly: "আপনার অর্ডারটি সফলভাবে কনফার্ম করা হয়েছে! আপনি চাইলে আগামী ১৫ মিনিটের মধ্যে যেকোনো তথ্য (ঠিকানা, ফোন নম্বর বা প্রোডাক্ট) পরিবর্তন বা বাতিল করতে পারবেন।"
   - AT THE VERY BOTTOM OF THAT EXACT MESSAGE, OUTPUT:
     ORDER_JSON: {"order_confirmed": true, "customer_name": "...", "customer_phone": "...", "delivery_address": "...", "product_name": "...", "variant": "...", "total_amount": 0}

7. EDIT & CANCELLATION:
   - If customer edits within 15 mins -> Confirm update & output:
     ORDER_UPDATE_JSON: {"order_updated": true, "customer_name": "...", "customer_phone": "...", "delivery_address": "...", "product_name": "...", "variant": "...", "total_amount": 0}
   - If customer cancels -> Confirm cancellation & output:
     ORDER_CANCEL_JSON: {"order_cancelled": true, "customer_name": "...", "customer_phone": "...", "product_name": "...", "reason": "Customer requested cancellation"}

8. 🖼️ VISUAL PRODUCT SEARCH & SCREENSHOT RECOGNITION (ছবি/স্ক্রিনশট শনাক্তকরণ):
   - When the customer sends an image, photo, or screenshot of a product:
     1. Carefully analyze the visual features (appearance, color, shape, buttons, gaming console, cooler, earphone, microphone, powerbank, hoodie, neon light, etc.).
     2. Compare it with the STORE PRODUCTS CATALOG below to identify the exact or closest matching product.
     3. Warmly and politely greet them in pure Bengali script (বাংলা লিপি), confirm the matched product with ALL basic information:
        - Product Name & 1-2 lines of core features/benefits.
        - Exact offer price in ৳ (e.g. "১৩১৫ টাকা").
        - Cash on delivery with open-box parcel checking nationwide (ডেলিভারি চার্জ: ঢাকা সিটিতে ৭০৳, ঢাকার বাইরে ১৩০৳)।
        - Direct Website link: "🔗 বিস্তারিত দেখতে বা সরাসরি ওয়েবসাইট থেকে অর্ডার লিংক: [ORDER LINK]"
        - Clear message ordering instructions: "📩 অথবা ইনবক্সে অর্ডার করতে আপনার নাম, মোবাইল নম্বর ও সম্পূর্ণ ডেলিভারি ঠিকানা লিখে পাঠিয়ে দিন।"
        - Courteous follow-up question: "ছবিতে দেখা প্রোডাক্টটি কি আপনি খুঁজছেন বা এটি কি এখনই অর্ডার কনফার্ম করে দেব?"
     4. NEVER invent prices. Use the exact price and link from the catalog.

9. 🎯 SINGLE VS MULTI-PRODUCT ORDERING RULES:
   - SINGLE PRODUCT DISCUSSED: If only 1 product has been discussed in this conversation, and the customer provides their delivery details (Name, Phone, Address) or says "আমি এটি নিতে চাই / অর্ডার করব":
     DO NOT ask the customer to repeat or state the product name! You already know the active product. Automatically confirm the order for that single product on the very first turn!
   - MULTIPLE PRODUCTS DISCUSSED: If 2 or more different products have been discussed in the conversation, and the customer wants to order without naming which one:
     DO NOT guess blindly!
     Politely ask them with numbering in pure Bengali script (বাংলা লিপি):
     "আপনি কোন প্রোডাক্টটি অর্ডার করতে চান? দয়া করে নম্বর বা নাম লিখে জানান:
     ১. [প্রোডাক্ট ১] (বর্তমান অফার মূল্য: ৳[দাম])
     ২. [প্রোডাক্ট ২] (বর্তমান অফার মূল্য: ৳[দাম])
     (যেটি নিতে চান সেটির নম্বর বা নাম লিখে দিন)"
     Once the customer states the number or name, confirm that specific product!

IMPORTANT: Internal markers (ORDER_JSON, ORDER_UPDATE_JSON, ORDER_CANCEL_JSON, ORDER_NOTE_JSON) are strictly for internal system processing. Never show raw JSON inside customer sentences.

${orderTimeContext}
${productsDiscussionContext}

STORE PRODUCTS CATALOG:
${catalog}`;

  const chatId = session?.sender_id ? `fb_${session.sender_id}` : "default";

  // ==========================================
  // ⚡ মোড ১: অ্যাক্টিভ লাইভ সকেট রি-ইউজ (ws.send() দিয়ে লাইভ কনটেক্সট প্রিজার্ভ)
  // ==========================================
  const cached = activeLiveSockets.get(chatId);
  if (cached && cached.ws && cached.ws.readyState === WebSocket.OPEN && cached.isReady) {
    cached.lastActive = Date.now();
    cached.accumulatedText = "";
    cached.pcmChunks = [];

    return new Promise((resolve) => {
      let isFinished = false;
      const timeout = setTimeout(() => {
        if (!isFinished) {
          isFinished = true;
          const cleanReply = cleanCustomerReply(cached.accumulatedText) || "ধন্যবাদ! আমরা আপনার মেসেজটি পেয়েছি।";
          const actions = extractOrderActions(cached.accumulatedText, cleanReply, chatHistory, activeProduct);
          resolve({
            reply: cleanReply,
            order_confirmed: actions.order_confirmed,
            order_updated: actions.order_updated,
            order_cancelled: actions.order_cancelled,
            order_note: actions.order_note,
            order_data: actions.order_data,
            note: actions.note,
            audio_id: null,
            audio_url: null
          });
        }
      }, 35000);

      cached.currentTurnResolve = (accText, chunks) => {
        if (!isFinished) {
          isFinished = true;
          clearTimeout(timeout);

          let audioId = null;
          let audioUrl = null;
          if (chunks && chunks.length > 0) {
            try {
              const rawPcm = Buffer.concat(chunks);
              const wavBuffer = pcmToWav(rawPcm, 24000, 1, 16);
              audioId = `aud_${Date.now()}_${Math.random().toString(36).substring(7)}`;
              audioCache.set(audioId, { buffer: wavBuffer, createdAt: Date.now() });
              if (audioCache.size > 100) {
                const oldest = audioCache.keys().next().value;
                audioCache.delete(oldest);
              }
              audioUrl = `https://ranonex.alwaysdata.net/audio/${audioId}.wav`;
            } catch (audioErr) {}
          }

          const cleanReply = cleanCustomerReply(accText);
          const actions = extractOrderActions(accText, cleanReply, chatHistory, activeProduct);

          resolve({
            reply: cleanReply,
            order_confirmed: actions.order_confirmed,
            order_updated: actions.order_updated,
            order_cancelled: actions.order_cancelled,
            order_note: actions.order_note,
            order_data: actions.order_data,
            note: actions.note,
            audio_id: audioId,
            audio_url: audioUrl
          });
        }
      };

      // অডিও থাকলে পাঠানো (কেবলমাত্র র' পিসিএম ফরম্যাট অনুমোদিত)
      if (incomingAudioBuffer && audioMimeType && audioMimeType.includes("pcm")) {
        cached.ws.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [{ mimeType: audioMimeType, data: incomingAudioBuffer.toString('base64') }]
          }
        }));
      }

      // ⚡ একই ওপেন সকেটে ws.send() দিয়ে পরবর্তী টার্ন পাঠানো
      const currentParts = [];
      if (incomingImageBuffer) {
        currentParts.push({
          inlineData: {
            mimeType: imageMimeType,
            data: incomingImageBuffer.toString('base64')
          }
        });
      }
      currentParts.push({ text: incomingText.trim() });

      cached.ws.send(JSON.stringify({
        clientContent: {
          turns: [{ role: "user", parts: currentParts }],
          turnComplete: true
        }
      }));
      console.log(`⚡ [Reusing Active Live WebSocket for ${chatId}] Dispatched turn via ws.send()!`);
    });
  }

  // ==========================================
  // 🔌 মোড ২: নতুন লাইভ সকেট ওপেন ও সেশন পুলে সংরক্ষণ
  // ==========================================
  const rawTurns = [];
  if (Array.isArray(chatHistory)) {
    for (const m of chatHistory.slice(-8)) {
      const role = m.sender_type === "assistant" || m.sender_type === "ai" ? "model" : "user";
      const text = (m.message_text || "").trim();
      if (text) rawTurns.push({ role, parts: [{ text }] });
    }
  }

  const lastTurnParts = [];
  if (incomingImageBuffer) {
    lastTurnParts.push({
      inlineData: {
        mimeType: imageMimeType,
        data: incomingImageBuffer.toString('base64')
      }
    });
  }
  lastTurnParts.push({ text: incomingText.trim() });

  if (rawTurns.length === 0 || rawTurns[rawTurns.length - 1].parts[rawTurns[rawTurns.length - 1].parts.length - 1]?.text !== incomingText.trim()) {
    rawTurns.push({ role: "user", parts: lastTurnParts });
  }

  const turns = [];
  for (const turn of rawTurns) {
    if (turns.length === 0) {
      if (turn.role === "user") turns.push(turn);
      continue;
    }
    const prevTurn = turns[turns.length - 1];
    if (prevTurn.role === turn.role) {
      prevTurn.parts[0].text += "\n" + (turn.parts[0]?.text || "");
    } else {
      turns.push(turn);
    }
  }
  if (turns.length === 0) {
    turns.push({ role: "user", parts: lastTurnParts });
  }

  return new Promise((resolve) => {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${CONFIG.geminiApiKey}`;
    const ws = new WebSocket(wsUrl);

    const socketEntry = {
      ws,
      isReady: false,
      lastActive: Date.now(),
      accumulatedText: "",
      pcmChunks: [],
      currentTurnResolve: null
    };
    activeLiveSockets.set(chatId, socketEntry);

    let isFinished = false;
    const timeout = setTimeout(() => {
      if (!isFinished) {
        isFinished = true;
        const cleanReply = cleanCustomerReply(socketEntry.accumulatedText) || "ধন্যবাদ! আমরা আপনার মেসেজটি পেয়েছি। কিছুক্ষণের মধ্যে আমাদের টিম থেকে উত্তর দেওয়া হবে।";
        const actions = extractOrderActions(socketEntry.accumulatedText, cleanReply, chatHistory, activeProduct);
        resolve({
          reply: cleanReply,
          order_confirmed: actions.order_confirmed,
          order_updated: actions.order_updated,
          order_cancelled: actions.order_cancelled,
          order_note: actions.order_note,
          order_data: actions.order_data,
          note: actions.note,
          audio_id: null,
          audio_url: null
        });
      }
    }, 35000);

    socketEntry.currentTurnResolve = (accText, chunks) => {
      if (!isFinished) {
        isFinished = true;
        clearTimeout(timeout);

        let audioId = null;
        let audioUrl = null;
        if (chunks && chunks.length > 0) {
          try {
            const rawPcm = Buffer.concat(chunks);
            const wavBuffer = pcmToWav(rawPcm, 24000, 1, 16);
            audioId = `aud_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            audioCache.set(audioId, { buffer: wavBuffer, createdAt: Date.now() });
            if (audioCache.size > 100) {
              const oldest = audioCache.keys().next().value;
              audioCache.delete(oldest);
            }
            audioUrl = `https://ranonex.alwaysdata.net/audio/${audioId}.wav`;
          } catch (audioErr) {}
        }

        const cleanReply = cleanCustomerReply(accText);
        const actions = extractOrderActions(accText, cleanReply, chatHistory, activeProduct);

        resolve({
          reply: cleanReply,
          order_confirmed: actions.order_confirmed,
          order_updated: actions.order_updated,
          order_cancelled: actions.order_cancelled,
          order_note: actions.order_note,
          order_data: actions.order_data,
          note: actions.note,
          audio_id: audioId,
          audio_url: audioUrl
        });
      }
    };

    ws.onopen = () => {
      const setupPayload = {
        setup: {
          model: "models/gemini-3.8-live",
          generationConfig: { responseModalities: ["AUDIO"] },
          systemInstruction: { parts: [{ text: systemInstruction }] },
          outputAudioTranscription: {}
        }
      };
      ws.send(JSON.stringify(setupPayload));
    };

    ws.onmessage = async (event) => {
      try {
        const rawText = event.data instanceof Blob ? await event.data.text() : event.data;
        const msg = JSON.parse(rawText);

        if (msg.setupComplete !== undefined) {
          socketEntry.isReady = true;
          socketEntry.lastActive = Date.now();

          if (incomingAudioBuffer && audioMimeType && audioMimeType.includes("pcm")) {
            ws.send(JSON.stringify({
              realtimeInput: {
                mediaChunks: [
                  { mimeType: audioMimeType, data: incomingAudioBuffer.toString('base64') }
                ]
              }
            }));
          }

          ws.send(JSON.stringify({
            clientContent: { turns, turnComplete: true }
          }));
          return;
        }

        if (msg.serverContent) {
          if (msg.serverContent.outputTranscription?.text) {
            socketEntry.accumulatedText += msg.serverContent.outputTranscription.text;
          }
          const parts = msg.serverContent.modelTurn?.parts || [];
          for (const p of parts) {
            if (p.text) socketEntry.accumulatedText += p.text;
            if (p.inlineData && p.inlineData.data) {
              socketEntry.pcmChunks.push(Buffer.from(p.inlineData.data, 'base64'));
            }
          }

          if (msg.serverContent.turnComplete) {
            socketEntry.lastActive = Date.now();
            if (socketEntry.currentTurnResolve) {
              const resFn = socketEntry.currentTurnResolve;
              socketEntry.currentTurnResolve = null;
              resFn(socketEntry.accumulatedText, socketEntry.pcmChunks);
            }
          }
        }
      } catch (err) {}
    };

    ws.onerror = (e) => {
      console.error("[Gemini 3.8 Live] WebSocket error:", e.message || e);
      activeLiveSockets.delete(chatId);
    };

    ws.onclose = () => {
      activeLiveSockets.delete(chatId);
      if (!isFinished && socketEntry.currentTurnResolve) {
        const resFn = socketEntry.currentTurnResolve;
        socketEntry.currentTurnResolve = null;
        resFn(socketEntry.accumulatedText, socketEntry.pcmChunks);
      }
    };
  });
}

// ==========================================
// 📢 TELEGRAM অর্ডার ও মেসেজ অ্যালার্ট
// ==========================================
// ==========================================
// 📢 TELEGRAM অর্ডার ও মেসেজ অ্যালার্ট
// ==========================================
async function sendTelegramAlert(order, platform = "Facebook") {
  if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) {
    await syncCredentialsFromWorker();
  }
  if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) {
    console.warn("⚠️ Telegram Alert Skipped: Bot token or Admin Chat ID missing.");
    return;
  }

  const text = `🎉 [নতুন অর্ডার কনফার্ম হয়েছে - ${platform}]
━━━━━━━━━━━━━━━━━━━
👤 কাস্টমার: ${order.customer_name || 'N/A'}
📞 মোবাইল: ${order.customer_phone || 'N/A'}
📍 ঠিকানা: ${order.delivery_address || 'N/A'}
📦 প্রোডাক্ট: ${order.product_name || 'N/A'}
🎨 ভ্যারিয়েন্ট: ${order.variant || 'Standard'}
💰 সর্বমোট: ৳${order.total_amount || 0}/-
🚚 ক্যাশ অন ডেলিভারি (হোম ডেলিভারি)
━━━━━━━━━━━━━━━━━━━
🚀 SocialAutomate Alwaysdata Engine`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CONFIG.telegramChatId, text })
    });
    const d = await res.json();
    if (d.ok) {
      console.log(`✅ [Telegram Order Alert Sent Successfully!] Msg ID: ${d.result?.message_id} to Chat: ${CONFIG.telegramChatId}`);
    } else {
      console.error(`❌ [Telegram Send Error]:`, JSON.stringify(d));
    }
  } catch (e) {
    console.error("❌ Telegram Network Exception:", e.message);
  }
}

async function sendTelegramOrderUpdate(order, platform = "Facebook") {
  if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) {
    await syncCredentialsFromWorker();
  }
  if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) return;

  const text = `🔄 [অর্ডার আপডেট / সংশোধিত - ${platform}]
(⚠️ কাস্টমার ১৫ মিনিটের মধ্যে তথ্য পরিবর্তন করেছেন, পূর্বের অর্ডারটি এই তথ্য দিয়ে প্রতিস্থাপন করুন)
━━━━━━━━━━━━━━━━━━━
👤 কাস্টমার: ${order.customer_name || 'N/A'}
📞 মোবাইল: ${order.customer_phone || 'N/A'}
📍 নতুন ঠিকানা: ${order.delivery_address || 'N/A'}
📦 প্রোডাক্ট: ${order.product_name || 'N/A'}
🎨 ভ্যারিয়েন্ট: ${order.variant || 'Standard'}
💰 সর্বমোট: ৳${order.total_amount || 0}/-
🚚 ক্যাশ অন ডেলিভারি (হোম ডেলিভারি)
━━━━━━━━━━━━━━━━━━━
🚀 SocialAutomate Alwaysdata Engine`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CONFIG.telegramChatId, text })
    });
    const d = await res.json();
    if (d.ok) {
      console.log(`✅ [Telegram Order Update Sent!] Msg ID: ${d.result?.message_id}`);
    } else {
      console.error(`❌ [Telegram Update Error]:`, JSON.stringify(d));
    }
  } catch (e) {
    console.error("❌ Telegram Update Network Exception:", e.message);
  }
}

async function sendTelegramOrderCancel(order, reason, platform = "Facebook") {
  if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) {
    await syncCredentialsFromWorker();
  }
  if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) return;

  const text = `❌ [অর্ডার বাতিল করা হয়েছে - ${platform}]
━━━━━━━━━━━━━━━━━━━
👤 কাস্টমার: ${order.customer_name || 'N/A'}
📞 মোবাইল: ${order.customer_phone || 'N/A'}
📦 প্রোডাক্ট: ${order.product_name || 'N/A'}
💰 সর্বমোট: ৳${order.total_amount || 0}/-
📝 বাতিলের কারণ / বিবরণ: ${reason || 'Customer requested cancellation'}
━━━━━━━━━━━━━━━━━━━
🚀 SocialAutomate Alwaysdata Engine`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CONFIG.telegramChatId, text })
    });
    const d = await res.json();
    if (d.ok) {
      console.log(`✅ [Telegram Cancel Alert Sent!] Msg ID: ${d.result?.message_id}`);
    } else {
      console.error(`❌ [Telegram Cancel Error]:`, JSON.stringify(d));
    }
  } catch (e) {
    console.error("❌ Telegram Cancel Network Exception:", e.message);
  }
}

async function sendTelegramOrderNote(noteText, customer, platform = "Facebook") {
  if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) {
    await syncCredentialsFromWorker();
  }
  if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) return;

  const text = `⚠️ [কাস্টমার অর্ডার পরিবর্তনের অনুরোধ করেছেন - জরুরি নোট - ${platform}]
(সময়সীমা ১৫ মিনিট অতিক্রান্ত হওয়ায় সরাসরি আপডেট হয়নি, ডেলিভারির সময় কাস্টমারের সাথে কথা বলুন)
━━━━━━━━━━━━━━━━━━━
👤 কাস্টমার: ${customer.customer_name || 'N/A'}
📞 মোবাইল: ${customer.customer_phone || 'N/A'}
📝 কাস্টমারের পরিবর্তনের অনুরোধ: ${noteText}
━━━━━━━━━━━━━━━━━━━
🚀 SocialAutomate Alwaysdata Engine`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CONFIG.telegramChatId, text })
    });
    const d = await res.json();
    if (d.ok) {
      console.log(`✅ [Telegram Note Sent!] Msg ID: ${d.result?.message_id}`);
    } else {
      console.error(`❌ [Telegram Note Error]:`, JSON.stringify(d));
    }
  } catch (e) {
    console.error("❌ Telegram Note Network Exception:", e.message);
  }
}

// ==========================================
// 🔵 FACEBOOK GRAPH API OUTBOUND HELPERS
// ==========================================

// ১. সাধারণ টেক্সট মেসেজ (সাথে কুইক রিপ্লাই বাটন)
async function sendFacebookMessage(recipientId, text, quickReplies = null) {
  if (!CONFIG.metaPageAccessToken) return null;
  try {
    const payload = {
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { text }
    };
    if (Array.isArray(quickReplies) && quickReplies.length > 0) {
      payload.message.quick_replies = quickReplies;
    }
    const res = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(CONFIG.metaPageAccessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (e) {
    console.error("FB Send Error:", e.message);
    return null;
  }
}

// ২. ফিচার ১: ইন-অ্যাপ ওয়েবভিউ প্রোডাক্ট কার্ড (In-App WebView Generic Template)
async function sendFacebookProductCard(recipientId, product) {
  if (!CONFIG.metaPageAccessToken || !product) return null;
  try {
    const payload = {
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: [
              {
                title: (product.name || "Ranonex Product").slice(0, 80),
                image_url: product.image_url || "https://ranonex.shop/assets/logo.png",
                subtitle: `মূল্য: ৳${product.price} | ক্যাশ অন ডেলিভারি`,
                default_action: {
                  type: "web_url",
                  url: product.url,
                  webview_height_ratio: "tall"
                },
                buttons: [
                  {
                    type: "web_url",
                    url: product.url,
                    title: "🛍️ বিস্তারিত ও ভিউ",
                    webview_height_ratio: "tall"
                  },
                  {
                    type: "postback",
                    title: "📦 এটি অর্ডার করব",
                    payload: `ORDER_PRODUCT_${product.id}`
                  }
                ]
              }
            ]
          }
        }
      }
    };

    const res = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(CONFIG.metaPageAccessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (e) {
    console.error("FB Card Send Error:", e.message);
    return null;
  }
}

// ৩. ফিচার ২: মাল্টি-প্রোডাক্ট ক্যারোসেল স্লাইডার (Multi-Product Swipeable Carousel Slider)
async function sendFacebookCarousel(recipientId, productsList) {
  if (!CONFIG.metaPageAccessToken || !Array.isArray(productsList) || productsList.length === 0) return null;
  try {
    const elements = productsList.slice(0, 10).map(p => ({
      title: (p.name || "Product").slice(0, 80),
      image_url: p.image_url || "https://ranonex.shop/assets/logo.png",
      subtitle: `মূল্য: ৳${p.price} | ক্যাশ অন ডেলিভারি`,
      default_action: {
        type: "web_url",
        url: p.url,
        webview_height_ratio: "tall"
      },
      buttons: [
        {
          type: "web_url",
          url: p.url,
          title: "🛍️ বিস্তারিত ও ভিউ",
          webview_height_ratio: "tall"
        },
        {
          type: "postback",
          title: "📦 এটি অর্ডার করব",
          payload: `ORDER_PRODUCT_${p.id}`
        }
      ]
    }));

    const payload = {
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements
          }
        }
      }
    };

    const res = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(CONFIG.metaPageAccessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    console.log(`🎠 [FB Carousel Sent to ${recipientId}]: ${elements.length} items`);
    return await res.json();
  } catch (e) {
    console.error("FB Carousel Error:", e.message);
    return null;
  }
}

// ৪. ফিচার ৪: ওয়ান-ট্যাপ ক্লিক-টু-কল হেল্পলাইন বাটন (Click-to-Call Button Template)
async function sendFacebookHelplineCard(recipientId) {
  if (!CONFIG.metaPageAccessToken) return null;
  try {
    const hotline = CONFIG.storeHotline || "+8801874600203";
    const waNumber = hotline.replace(/\+/g, '');
    const payload = {
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: "Ranonex গ্রাহক সেবা ও হেল্পলাইনে আপনাকে স্বাগতম! সরাসরি কথা বলতে বা হোয়াটসঅ্যাপে অর্ডার করতে নিচের বাটন ব্যবহার করুন:",
            buttons: [
              {
                type: "phone_number",
                title: "📞 সরাসরি কল করুন",
                payload: hotline
              },
              {
                type: "web_url",
                url: `https://wa.me/${waNumber}`,
                title: "💬 হোয়াটসঅ্যাপ সাপোর্ট",
                webview_height_ratio: "tall"
              },
              {
                type: "web_url",
                url: "https://ranonex.shop",
                title: "🌐 ওয়েবসাইট ভিউ",
                webview_height_ratio: "tall"
              }
            ]
          }
        }
      }
    };

    const res = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(CONFIG.metaPageAccessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (e) {
    console.error("FB Helpline Error:", e.message);
    return null;
  }
}

// ৫. অডিও ভয়েস মেসেজ সেন্ডার
async function sendFacebookAudio(recipientId, audioUrl) {
  if (!CONFIG.metaPageAccessToken || !audioUrl) return null;
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(CONFIG.metaPageAccessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: "RESPONSE",
        message: {
          attachment: {
            type: "audio",
            payload: { url: audioUrl, is_reusable: true }
          }
        }
      })
    });
    return await res.json();
  } catch (e) {
    console.error("FB Audio Send Error:", e.message);
    return null;
  }
}

async function replyToFacebookComment(commentId, text) {
  if (!CONFIG.metaPageAccessToken) return null;
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(commentId)}/comments?access_token=${encodeURIComponent(CONFIG.metaPageAccessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    });
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function getFacebookUserProfile(senderId) {
  if (!CONFIG.metaPageAccessToken) return { name: `Facebook User (${senderId})`, avatar: "" };
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(senderId)}?fields=first_name,last_name,profile_pic&access_token=${encodeURIComponent(CONFIG.metaPageAccessToken)}`);
    if (res.ok) {
      const data = await res.json();
      const name = `${data.first_name || ''} ${data.last_name || ''}`.trim() || `User (${senderId})`;
      return { name, avatar: data.profile_pic || "" };
    }
  } catch (e) {}
  return { name: `Facebook User (${senderId})`, avatar: "" };
}

// ==========================================
// ⏰ ফিচার ৫: অটোমেটেড ফলোআপ চেকার (Abandoned Inquiry Follow-Up)
// ==========================================
setInterval(async () => {
  const now = Date.now();
  for (const [chatId, session] of memorySessions.entries()) {
    if (
      session.sender_id &&
      session.last_discussed_product &&
      !session.last_order_data &&
      !session.last_order_cancelled &&
      !session.abandoned_reminder_sent &&
      session.last_inquiry_time &&
      (now - session.last_inquiry_time >= 15 * 60 * 1000) && // ১৫ মিনিট অতিক্রান্ত
      (now - session.last_inquiry_time <= 24 * 60 * 60 * 1000) // মেটা ২৪ ঘণ্টার পলিসির ভেতর
    ) {
      session.abandoned_reminder_sent = true;
      const senderId = session.sender_id;
      const prod = session.last_discussed_product;

      console.log(`⏰ [Automated Abandoned Follow-Up Triggered for ${senderId} - Product: ${prod.name}]`);

      const followUpText = `প্রিয় ${session.sender_name || 'গ্রাহক'}, আপনি Ranonex স্টোরে ${prod.name} প্রোডাক্টটি পছন্দ করেছিলেন। আমাদের সীমিত স্টক দ্রুত শেষ হয়ে যাচ্ছে!\n\nআপনি কি পণ্যটি ক্যাশ অন ডেলিভারিতে অর্ডার করতে চান? নিচের বাটনে ট্যাপ করে খুব সহজেই অর্ডার সম্পন্ন করতে পারেন:`;

      const quickReplies = [
        { content_type: "text", title: "🛍️ হ্যাঁ, অর্ডার করব", payload: "ACTION_ORDER_NOW" },
        { content_type: "text", title: "💰 ডেলিভারি চার্জ কত?", payload: "ACTION_DELIVERY_CHARGE" },
        { content_type: "text", title: "❌ পরে নেব", payload: "ACTION_ABANDONED_DECLINE" },
        { content_type: "text", title: "📞 হেল্পলাইনে কল", payload: "ACTION_CALL_SUPPORT" }
      ];

      await sendFacebookMessage(senderId, followUpText, quickReplies);
      await sendFacebookProductCard(senderId, prod);
    }
  }
}, 60 * 1000); // প্রতি ১ মিনিটে চেক

// ==========================================
// 🌐 WEB ROUTES & WEBHOOKS
// ==========================================

// ১. হেলথ চেক ও স্ট্যাটাস
app.get(['/', '/status', '/api/status'], (req, res) => {
  res.json({
    status: "online",
    server: "Alwaysdata High-Throughput Node.js Gateway",
    uptime_seconds: Math.floor(process.uptime()),
    memory_usage_mb: (process.memoryUsage().rss / (1024 * 1024)).toFixed(1),
    total_messages_handled: totalMessagesHandled,
    channels: {
      facebook_messenger: Boolean(CONFIG.metaPageAccessToken),
      facebook_page_id: CONFIG.metaPageId,
      gemini_ai: Boolean(CONFIG.geminiApiKey),
      gemini_model: "models/gemini-3.8-live (Multimodal Live WebSocket Engine)",
      telegram_alerts: Boolean(CONFIG.telegramBotToken),
      audio_cache_count: audioCache.size,
      products_count: productCatalogCache.productsList?.length || 0,
      active_features: [
        "In-App WebView Modal (Tall)",
        "Multi-Product Carousel Slider",
        "Contextual Quick Reply Pills",
        "One-Tap Click-to-Call Helpline",
        "Automated 15-Min Abandoned Follow-Up",
        "Instant First-Turn Telegram Order Alert"
      ]
    }
  });
});

// ১.১ অটোমেটেড সিস্টেম রিলোডার API
app.get('/api/system-restart', (req, res) => {
  res.json({ success: true, message: "Server daemon restarting..." });
  setTimeout(() => process.exit(0), 150);
});

// ২. মেটা ফেসবুক Webhook ভেরিফিকেশন (GET /webhook/meta)
app.get('/webhook/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const validTokens = [CONFIG.metaVerifyToken, "social_automate_verify_token_2026", "ranonex_social_secret_2026"];
  if (mode === 'subscribe' && validTokens.includes(token)) {
    console.log("✅ [Alwaysdata Meta Webhook] Verified successfully by Meta!");
    return res.status(200).send(challenge);
  }
  return res.status(403).send("Forbidden");
});

// ৩. মেটা ফেসবুক Webhook ইভেন্ট হ্যান্ডলার (POST /webhook/meta)
app.post('/webhook/meta', (req, res) => {
  res.status(200).json({ status: "EVENT_RECEIVED" });

  const body = req.body;
  if (!body || body.object !== 'page') return;

  setImmediate(async () => {
    try {
      for (const entry of (body.entry || [])) {
        if (entry.messaging && Array.isArray(entry.messaging)) {
          for (const event of entry.messaging) {
            const senderId = event.sender?.id;
            const recipientId = event.recipient?.id;
            const message = event.message;
            const postback = event.postback;

            if (!senderId || senderId === CONFIG.metaPageId || senderId === '0') continue;
            if (message && message.is_echo) continue;

            const quickReplyPayload = message?.quick_reply ? message.quick_reply.payload : "";
            const postbackPayload = postback ? postback.payload : "";
            const incomingPayload = quickReplyPayload || postbackPayload;
            const incomingText = message?.text || incomingPayload;
            const userSentAudio = Boolean(message?.attachments && message.attachments.some(a => a.type === 'audio'));
            const userSentImage = Boolean(message?.attachments && message.attachments.some(a => a.type === 'image'));

            const chatId = `fb_${senderId}`;
            let session = memorySessions.get(chatId) || { messages: [], sender_id: senderId };
            session.sender_id = senderId;
            if (!Array.isArray(session.discussed_products)) {
              session.discussed_products = [];
            }
            if (session.last_discussed_product && !session.discussed_products.some(p => p.id === session.last_discussed_product.id)) {
              session.discussed_products.push(session.last_discussed_product);
            }

            const profile = await getFacebookUserProfile(senderId);
            session.sender_name = profile.name;

            // ১. ইনকামিং মেসেজ থেকে কোনো প্রোডাক্টের মিল আছে কিনা তা আগেই শনাক্ত ও ট্র্যাকিং করা
            const { productsList } = await getStoreCatalog();
            const earlyMatchedProduct = findMatchingProduct(incomingText, productsList);
            if (earlyMatchedProduct) {
              if (!session.discussed_products.some(p => p.id === earlyMatchedProduct.id)) {
                session.discussed_products.push(earlyMatchedProduct);
              }
              session.last_discussed_product = earlyMatchedProduct;
              session.last_inquiry_time = Date.now();
              session.abandoned_reminder_sent = false;
            }

            // ২. যদি একাধিক প্রোডাক্ট আলোচিত হয়ে থাকে এবং কাস্টমার নম্বর (১, ২, ৩ বা 1, 2, 3) লিখে থাকে
            const numChoiceMatch = (incomingText || "").trim().match(/^(?:আমি\s*)?(?:নং|নম্বর|number\s*)?([1-9]|১|২|৩|৪|৫)(?:\s*(?:নং|নম্বর|number|ta|টা))?(?:\s*(?:nite chai|চাই|order|অর্ডার|দিন|নিব))?$/i)
              || (incomingText || "").trim().match(/\b([1-9]|১|২|৩|৪|৫)\s*(?:নং|নম্বর|number|ta|টা)\b/i)
              || (incomingText || "").trim().match(/^(প্রথমটা|দ্বিতীয়টা|তৃতীয়টা|১ম|২য়|৩য়)$/i);

            if (numChoiceMatch && session.discussed_products.length > 1) {
              const bMap = { '১': 1, '২': 2, '৩': 3, '৪': 4, '৫': 5, 'প্রথমটা': 1, 'দ্বিতীয়টা': 2, 'তৃতীয়টা': 3, '১ম': 1, '২য়': 2, '৩য়': 3 };
              const rawIdx = numChoiceMatch[1];
              const choiceNum = bMap[rawIdx] || parseInt(rawIdx, 10);
              if (choiceNum >= 1 && choiceNum <= session.discussed_products.length) {
                const chosen = session.discussed_products[choiceNum - 1];
                session.selected_order_product = chosen;
                session.last_discussed_product = chosen;
                console.log(`🎯 [Product Chosen by Number]: #${choiceNum} - ${chosen.name}`);
              }
            }

            // ==========================================
            // 🕹️ কুইক রিপ্লাই ও পোস্টব্যাক হ্যান্ডলার
            // ==========================================

            // [SELECT_PRODUCT_...] বাটন ক্লিক (মাল্টি-প্রোডাক্ট তালিকা থেকে নির্বাচন)
            if (incomingPayload.startsWith("SELECT_PRODUCT_")) {
              const prodId = incomingPayload.replace("SELECT_PRODUCT_", "").trim();
              const matched = (session.discussed_products || []).find(p => p.id === prodId) || productsList.find(p => p.id === prodId);
              if (matched) {
                session.selected_order_product = matched;
                session.last_discussed_product = matched;
                session.last_inquiry_time = Date.now();
                session.abandoned_reminder_sent = false;

                const text = `আপনি ${matched.name} প্রোডাক্টটি নির্বাচন করেছেন।\nবর্তমান অফার মূল্য: ৳${matched.price} (ক্যাশ অন ডেলিভারি)।\n\nঅর্ডারটি এখনই কনফার্ম করতে অনুগ্রহ করে আপনার:\n১. পুরো নাম\n২. ১১ ডিজিটের মোবাইল নম্বর\n৩. সম্পূর্ণ ডেলিভারি ঠিকানা লিখে পাঠিয়ে দিন।`;
                const qr = [
                  { content_type: "text", title: "📍 ঢাকার ভেতরে (৭০৳)", payload: "ACTION_LOCATION_DHAKA" },
                  { content_type: "text", title: "📍 ঢাকার বাইরে (১৩০৳)", payload: "ACTION_LOCATION_OUTSIDE" },
                  { content_type: "text", title: "🔊 ভয়েস শুনুন", payload: `PLAY_AUDIO_aud_${Date.now()}` }
                ];
                await sendFacebookMessage(senderId, text, qr);
                await sendFacebookProductCard(senderId, matched);
              }
              continue;
            }

            // ১. [🔊 ভয়েস শুনুন] বাটন ক্লিক
            if (incomingPayload.startsWith("PLAY_AUDIO_")) {
              const clickedAudioId = incomingPayload.replace("PLAY_AUDIO_", "").trim();
              console.log(`🔊 [Voice Play Clicked by ${senderId}]: ${clickedAudioId}`);

              if (audioCache.has(clickedAudioId)) {
                await sendFacebookAudio(senderId, `https://ranonex.alwaysdata.net/audio/${clickedAudioId}.wav`);
              } else {
                const lastAiMsg = session.messages.filter(m => m.sender_type === "assistant").pop();
                const textToSpeak = lastAiMsg ? lastAiMsg.message_text : "ধন্যবাদ Ranonex-এর সাথে থাকার জন্য।";
                const genRes = await generateAudioFromText(textToSpeak);
                if (genRes && genRes.audioUrl) {
                  await sendFacebookAudio(senderId, genRes.audioUrl);
                }
              }
              continue;
            }

            // ২. [🛍️ এখনই অর্ডার করব] বাটন ক্লিক বা অর্ডার ইনটেন্ট
            if (incomingPayload === "ACTION_ORDER_NOW") {
              if (session.discussed_products.length > 1 && !session.selected_order_product) {
                const productListBengali = session.discussed_products.map((p, idx) => {
                  const bNum = ['১', '২', '৩', '৪', '৫'][idx] || (idx + 1);
                  return `${bNum}. ${p.name} (মূল্য: ৳${p.price}/-)`;
                }).join('\n');

                const askText = `আপনি কোন প্রোডাক্টটি অর্ডার করতে চান? দয়া করে নম্বর বা নাম লিখে জানান:\n\n${productListBengali}\n\n(যেটি নিতে চান সেটির নম্বর বা নাম লিখে দিন)`;
                const qr = session.discussed_products.slice(0, 5).map((p, idx) => {
                  const bNum = ['১', '২', '৩', '৪', '৫'][idx] || (idx + 1);
                  return { content_type: "text", title: `${bNum}. ${p.name.slice(0, 16)}`, payload: `SELECT_PRODUCT_${p.id}` };
                });
                await sendFacebookMessage(senderId, askText, qr);
                continue;
              }

              const targetProd = session.selected_order_product || (session.discussed_products.length === 1 ? session.discussed_products[0] : session.last_discussed_product);
              const prodMention = targetProd ? `${targetProd.name} প্রোডাক্টটি ` : "";
              const text = `দারুণ! ${prodMention}ক্যাশ অন ডেলিভারিতে অর্ডার কনফার্ম করতে অনুগ্রহ করে আপনার:\n১. পুরো নাম\n২. ১১ ডিজিটের মোবাইল নম্বর\n৩. সম্পূর্ণ ডেলিভারি ঠিকানা লিখে পাঠিয়ে দিন।`;
              const qr = [
                { content_type: "text", title: "📍 ঢাকার ভেতরে (৭০৳)", payload: "ACTION_LOCATION_DHAKA" },
                { content_type: "text", title: "📍 ঢাকার বাইরে (১৩০৳)", payload: "ACTION_LOCATION_OUTSIDE" },
                { content_type: "text", title: "🔊 ভয়েস শুনুন", payload: `PLAY_AUDIO_aud_${Date.now()}` }
              ];
              await sendFacebookMessage(senderId, text, qr);
              continue;
            }

            // ৩. [💰 ডেলিভারি চার্জ কত?] বাটন ক্লিক
            if (incomingPayload === "ACTION_DELIVERY_CHARGE") {
              const text = "আমাদের ডেলিভারি চার্জ:\n• ঢাকা সিটির ভেতরে: মাত্র ৭০ টাকা\n• ঢাকা সিটির বাইরে: ১৩০ টাকা\n\nক্যাশ অন ডেলিভারিতে পার্সেল চেক করে দেখে নেওয়ার শতভাগ নিশ্চয়তা রয়েছে!";
              const qr = [
                { content_type: "text", title: "🛍️ এখনই অর্ডার করব", payload: "ACTION_ORDER_NOW" },
                { content_type: "text", title: "📦 পার্সেল চেক?", payload: "ACTION_PARCEL_CHECK" },
                { content_type: "text", title: "🔊 ভয়েস শুনুন", payload: `PLAY_AUDIO_aud_${Date.now()}` }
              ];
              await sendFacebookMessage(senderId, text, qr);
              continue;
            }

            // ৪. [📦 পার্সেল চেক?] বাটন ক্লিক
            if (incomingPayload === "ACTION_PARCEL_CHECK") {
              const text = "হ্যাঁ, সম্পূর্ণ নিশ্চিন্ত থাকুন! ডেলিভারি ম্যানের সামনে পার্সেলটি খুলে প্রডাক্ট চেক করে দেখে তারপর মূল্য পরিশোধ করতে পারবেন।";
              const qr = [
                { content_type: "text", title: "🛍️ এখনই অর্ডার করব", payload: "ACTION_ORDER_NOW" },
                { content_type: "text", title: "🔊 ভয়েস শুনুন", payload: `PLAY_AUDIO_aud_${Date.now()}` }
              ];
              await sendFacebookMessage(senderId, text, qr);
              continue;
            }

            // ৫. [📜 সব প্রোডাক্ট দেখুন] বাটন ক্লিক বা ক্যাটালগ চাওয়া
            if (incomingPayload === "ACTION_SHOW_CATALOG" || /সব\s*প্রোডাক্ট|সব\s*পণ্য|আর\s*কি\s*কি\s*আছে|ক্যাটালগ|catalogue|catalog|list|অন্যান্য|সবগুলো|all\s*products/i.test(incomingText)) {
              const { productsList } = await getStoreCatalog();
              const text = "এখানে Ranonex স্টোরের জনপ্রিয় সেরা কিছু ট্রেন্ডি গ্যাজেট রয়েছে। ডানে-বামে সোয়াইপ করে পছন্দমতো প্রোডাক্ট বেছে নিন:";
              const qr = [
                { content_type: "text", title: "🛍️ অর্ডার করতে চাই", payload: "ACTION_ORDER_NOW" },
                { content_type: "text", title: "💰 ডেলিভারি চার্জ", payload: "ACTION_DELIVERY_CHARGE" },
                { content_type: "text", title: "📞 হেল্পলাইনে কল", payload: "ACTION_CALL_SUPPORT" }
              ];
              await sendFacebookMessage(senderId, text, qr);
              await sendFacebookCarousel(senderId, productsList);
              continue;
            }

            // ৬. ক্যারোসেল কার্ড থেকে [📦 এটি অর্ডার করব] ক্লিক
            if (incomingPayload.startsWith("ORDER_PRODUCT_")) {
              const prodId = incomingPayload.replace("ORDER_PRODUCT_", "").trim();
              const { productsList } = await getStoreCatalog();
              const matched = productsList.find(p => p.id === prodId) || null;
              if (matched) {
                session.last_discussed_product = matched;
                session.last_inquiry_time = Date.now();
                session.abandoned_reminder_sent = false;

                const text = `${matched.name} প্রোডাক্টটি নির্বাচন করার জন্য ধন্যবাদ!\nমূল্য: ৳${matched.price} (ক্যাশ অন ডেলিভারি)।\n\nঅর্ডারটি এখনই কনফার্ম করতে অনুগ্রহ করে আপনার নাম, মোবাইল নম্বর এবং সম্পূর্ণ ডেলিভারি ঠিকানা লিখে দিন:`;
                const qr = [
                  { content_type: "text", title: "📍 ঢাকার ভেতরে (৭০৳)", payload: "ACTION_LOCATION_DHAKA" },
                  { content_type: "text", title: "📍 ঢাকার বাইরে (১৩০৳)", payload: "ACTION_LOCATION_OUTSIDE" },
                  { content_type: "text", title: "🔊 ভয়েস শুনুন", payload: `PLAY_AUDIO_aud_${Date.now()}` }
                ];
                await sendFacebookMessage(senderId, text, qr);
                await sendFacebookProductCard(senderId, matched);
              }
              continue;
            }

            // ৭. [📍 ঢাকার ভেতরে / বাইরে] বাটন ক্লিক
            if (incomingPayload === "ACTION_LOCATION_DHAKA") {
              const text = "ডেলিভারি এরিয়া: ঢাকার ভেতরে নোট করা হয়েছে (ডেলিভারি চার্জ ৭০৳)। আপনার নাম, মোবাইল নম্বর এবং সম্পূর্ণ এরিয়া/ঠিকানা লিখে দিন।";
              await sendFacebookMessage(senderId, text);
              continue;
            }
            if (incomingPayload === "ACTION_LOCATION_OUTSIDE") {
              const text = "ডেলিভারি এরিয়া: ঢাকার বাইরে নোট করা হয়েছে (ডেলিভারি চার্জ ১৩০৳)। আপনার নাম, মোবাইল নম্বর এবং জেলা ও থানা সহ সম্পূর্ণ ঠিকানা লিখে দিন।";
              await sendFacebookMessage(senderId, text);
              continue;
            }

            // ৮. [📞 হেল্পলাইনে কল] বাটন ক্লিক
            if (incomingPayload === "ACTION_CALL_SUPPORT" || /কল\s*করতে\s*চাই|হেল্পলাইন|নাম্বার|number|hotline|customer\s*care/i.test(incomingText)) {
              await sendFacebookHelplineCard(senderId);
              continue;
            }

            // ৯. [🔄 ঠিকানা পরিবর্তন] বাটন ক্লিক
            if (incomingPayload === "ACTION_EDIT_ORDER") {
              const text = "আপনার নতুন ডেলিভারি ঠিকানা বা সঠিক ফোন নম্বরটি লিখে পাঠিয়ে দিন, আমরা এখনই অর্ডার আপডেট করে দিচ্ছি।";
              await sendFacebookMessage(senderId, text);
              continue;
            }

            // ১০. [❌ অর্ডার বাতিল] বাটন ক্লিক
            if (incomingPayload === "ACTION_CANCEL_ORDER") {
              const cancelledOrder = session.last_order_data || { customer_name: profile.name, total_amount: 0 };
              session.last_order_cancelled = true;
              await sendTelegramOrderCancel(cancelledOrder, "Customer clicked cancel order button", "Facebook Messenger");
              const text = "আপনার অনুরোধ অনুযায়ী অর্ডারটি সফলভাবে বাতিল করা হয়েছে। পরবর্তীতে যেকোনো প্রয়োজনে আমাদের জানাতে পারেন।";
              await sendFacebookMessage(senderId, text);
              continue;
            }

            // ১১. [❌ পরে নেব] বাটন ক্লিক
            if (incomingPayload === "ACTION_ABANDONED_DECLINE") {
              const text = "ঠিক আছে, কোনো সমস্যা নেই! পরবর্তীতে যেকোনো গ্যাজেট বা কেনাকাটায় আমাদের জানাবেন। Ranonex-এর সাথে থাকার জন্য ধন্যবাদ!";
              await sendFacebookMessage(senderId, text);
              continue;
            }

            if (!incomingText && !userSentAudio && !userSentImage) continue;

            // ==========================================
            // 🎙️ কাস্টমারের ভয়েস অডিও ডাউনলোড ও প্রসেসিং
            // ==========================================
            let incomingAudioBuffer = null;
            let audioMimeType = "audio/mp4";
            if (userSentAudio) {
              const audioAttachment = message.attachments.find(a => a.type === 'audio');
              if (audioAttachment?.payload?.url) {
                try {
                  const aRes = await fetch(audioAttachment.payload.url);
                  if (aRes.ok) {
                    incomingAudioBuffer = Buffer.from(await aRes.arrayBuffer());
                    audioMimeType = aRes.headers.get("content-type") || "audio/mp4";
                  }
                } catch (dlErr) {}
              }
            }

            // ==========================================
            // 📸 কাস্টমারের পাঠানো ছবি / স্ক্রিনশট ডাউনলোড ও প্রসেসিং
            // ==========================================
            let incomingImageBuffer = null;
            let imageMimeType = "image/jpeg";
            if (userSentImage) {
              const imgAttachment = message.attachments.find(a => a.type === 'image');
              if (imgAttachment?.payload?.url) {
                try {
                  console.log(`🖼️ [Customer sent Image / Screenshot]: ${imgAttachment.payload.url}`);
                  const iRes = await fetch(imgAttachment.payload.url);
                  if (iRes.ok) {
                    incomingImageBuffer = Buffer.from(await iRes.arrayBuffer());
                    imageMimeType = iRes.headers.get("content-type") || "image/jpeg";
                    console.log(`✅ Image downloaded successfully (${incomingImageBuffer.length} bytes, ${imageMimeType})`);
                  }
                } catch (dlErr) {
                  console.error("Error downloading customer image:", dlErr.message);
                }
              }
            }

            let userPromptText = incomingText ? incomingText.trim() : "";
            if (userSentAudio) {
              userPromptText = "Customer sent a voice note. DO NOT mention previous order, order processing, or order tracking! Warmly and politely ask in pure Bengali script (বাংলা লিপি) how you can assist them with our Ranonex store products, or if an active product is under discussion, mention its exact price, features, and how to order.";
            } else if (userSentImage) {
              userPromptText = userPromptText
                ? `The customer sent this photo/screenshot with the caption: "${userPromptText}". Carefully analyze this product image, match it with our Ranonex store catalog, state its exact name and price in pure Bengali script, and ask if they are looking for or want to order this product.`
                : "The customer sent this photo/screenshot of a product. Carefully analyze this product image, match it with our Ranonex store catalog, state its exact name and price in pure Bengali script, and ask if they are looking for this product or want to order it.";
            }

            totalMessagesHandled++;
            console.log(`📩 [Messenger from ${senderId}]: ${incomingText || (userSentAudio ? "[Voice Note]" : "[Product Screenshot]")}`);

            session.messages.push({
              id: message?.mid || `m_${Date.now()}`,
              sender_type: "customer",
              sender_name: profile.name,
              message_text: incomingText || (userSentAudio ? "[Voice Message]" : "[Product Image / Screenshot]"),
              timestamp: new Date().toISOString()
            });

            const isVoiceRequested = userSentAudio || /ভয়েস|ভয়েস|audio|voice|কথা বলো|শুনতে চাই/i.test(incomingText || "");

            // Gemini 3.8 Live কল (WebSocket Session Reuse + Multimodal Image Vision)
            const aiDecision = await callGeminiSalesAI(
              userPromptText,
              session.messages,
              session,
              incomingAudioBuffer,
              audioMimeType,
              incomingImageBuffer,
              imageMimeType
            );

            if (aiDecision && aiDecision.reply) {
              console.log(`🤖 [AI Reply to ${profile.name}]: ${aiDecision.reply.substring(0, 80)}...`);

              // ১. ক্যাটালগ ও প্রোডাক্ট ম্যাচিং (ইনকামিং মেসেজ, এআই রিপ্লাই বা সেশন থেকে)
              const { productsList } = await getStoreCatalog();
              const matchedProduct = findMatchingProduct(incomingText, productsList)
                || findMatchingProduct(aiDecision.reply, productsList)
                || session.selected_order_product
                || (session.discussed_products && session.discussed_products.length === 1 ? session.discussed_products[0] : null)
                || session.last_discussed_product
                || null;

              if (matchedProduct) {
                if (!session.discussed_products.some(p => p.id === matchedProduct.id)) {
                  session.discussed_products.push(matchedProduct);
                }
                session.last_discussed_product = matchedProduct;
                session.last_inquiry_time = Date.now();
                session.abandoned_reminder_sent = false;
              }

              // ২. কাস্টমারকে প্রোডাক্ট তথ্য ও সরাসরি ওয়েবসাইট অর্ডার ইউআরএল দেওয়া শতভাগ নিশ্চিতকরণ
              const isOrderConfirmedReply = aiDecision.order_confirmed 
                || /(?:অর্ডারটি\s*(?:সফলভাবে\s*)?কনফার্ম\s*করা\s*হয়েছে|অর্ডার\s*কনফার্ম\s*হয়েছে|অর্ডার\s*নিশ্চিত\s*করা\s*হয়েছে)/i.test(aiDecision.reply);

              const activeProd = session.selected_order_product || matchedProduct || (session.discussed_products && session.discussed_products.length === 1 ? session.discussed_products[0] : null) || session.last_discussed_product;

              if (!isOrderConfirmedReply && activeProd && !aiDecision.reply.includes("ranonex.shop")) {
                const orderUrl = activeProd.url || `https://ranonex.shop/product.html?id=${encodeURIComponent(activeProd.id)}`;
                const productInfoBlock = `\n\n📌 প্রোডাক্ট: ${activeProd.name}\n💰 বর্তমান অফার মূল্য: মাত্র ৳${activeProd.price}/-\n🚚 ডেলিভারি চার্জ: ঢাকা সিটিতে মাত্র ৭০ টাকা, ঢাকার বাইরে ১৩০ টাকা (ক্যাশ অন ডেলিভারিতে পার্সেল চেক করে দেখে নেওয়ার শতভাগ নিশ্চয়তা)।\n🔗 সরাসরি ওয়েবসাইট থেকে অর্ডার লিংক:\n👉 ${orderUrl}\n\n📩 অথবা ইনবক্সে অর্ডার করতে আপনার নাম, মোবাইল নম্বর ও সম্পূর্ণ ডেলিভারি ঠিকানা লিখে পাঠিয়ে দিন।`;
                aiDecision.reply = aiDecision.reply.trim() + productInfoBlock;
              }

              // ওয়েবসাইট লিংক জানতে চাইলে স্বয়ংক্রিয়ভাবে প্রদান
              if (!isOrderConfirmedReply && !aiDecision.reply.includes("ranonex.shop") && /(?:ওয়েবসাইট|ওয়েবসাইট|website|site|store|সাইট|লিংক|link|url)/i.test(incomingText)) {
                aiDecision.reply = aiDecision.reply.trim() + `\n\n🌐 Ranonex অফিশিয়াল ওয়েবসাইট: https://ranonex.shop`;
              }

              // ৩. স্মার্ট কনটেক্সচুয়াল কুইক রিপ্লাই বাটন তৈরি
              const quickReplies = buildContextualQuickReplies(session, aiDecision, aiDecision.audio_id);

              // ৪. ইউজার ভয়েস চাইলে সরাসরি অডিও পাঠানো
              if (isVoiceRequested && aiDecision.audio_url) {
                await sendFacebookAudio(senderId, aiDecision.audio_url);
              }

              // ৫. টেক্সট মেসেজ পাঠানো
              await sendFacebookMessage(senderId, aiDecision.reply, quickReplies);

              // ৬. 🃏 প্রোডাক্ট কার্ড ভিউ (In-App WebView সহ)
              if (matchedProduct && !isOrderConfirmedReply) {
                if (userSentImage || userSentAudio || /দাম|প্রোডাক্ট|price|কত|৳|নিবেন|অর্ডার|চাই|কুলার|ঘড়ি|watch|headphone|cooler|panjabi|hoodie|লাইট|light/i.test(incomingText + " " + aiDecision.reply)) {
                  await sendFacebookProductCard(senderId, matchedProduct);
                }
              }

              session.messages.push({
                id: `ai_${Date.now()}`,
                sender_type: "assistant",
                sender_name: "Ranonex AI Assistant",
                message_text: aiDecision.reply,
                timestamp: new Date().toISOString()
              });
            }

            // ==========================================
            // ১. অর্ডার কনফার্মেশন -> টেলিগ্রাম অ্যালার্ট ও D1 ডাটাবেস সেভ
            // (কঠোর ভ্যালিডেশন: কোনো ফেক/০ টাকার বা ইনকমপ্লিট অর্ডার যাবে না)
            // ==========================================
            const isConfirmedReply = aiDecision.order_confirmed 
              || /(?:অর্ডার(?:টি)?\s*(?:সফলভাবে\s*)?কনফার্ম(?:\s*করা)?\s*হয়েছে|অর্ডার(?:টি)?\s*(?:সফলভাবে\s*)?নিশ্চিত(?:\s*করা)?\s*হয়েছে|আপনার\s*অর্ডার(?:টি)?\s*গ্রহণ\s*করা\s*হয়েছে)/i.test(aiDecision.reply || "");

            if (isConfirmedReply) {
              const resolvedProduct = session.selected_order_product 
                || (session.discussed_products && session.discussed_products.length === 1 ? session.discussed_products[0] : null)
                || session.last_discussed_product;

              if (!aiDecision.order_data) {
                const actions = extractOrderActions(aiDecision.reply || "", aiDecision.reply || "", session.messages, resolvedProduct);
                aiDecision.order_data = actions.order_data;
              }

              const prodName = (aiDecision.order_data && aiDecision.order_data.product_name && aiDecision.order_data.product_name !== "Ranonex Store Product")
                ? aiDecision.order_data.product_name
                : (resolvedProduct?.name || "");

              const basePrice = resolvedProduct ? parseFloat(resolvedProduct.price || 0) : (aiDecision.order_data?.total_amount || 0);
              const isDhaka = /ঢাকা|dhaka/i.test(aiDecision.order_data?.delivery_address || "") && !/ঢাকার\s*বাইরে|outside/i.test(aiDecision.order_data?.delivery_address || "");
              const deliveryCharge = isDhaka ? 70 : 130;
              const totalAmount = basePrice > 0 ? (basePrice + deliveryCharge) : (aiDecision.order_data?.total_amount || 0);

              const orderInfo = {
                customer_name: (aiDecision.order_data && aiDecision.order_data.customer_name && !aiDecision.order_data.customer_name.startsWith("Facebook User"))
                  ? aiDecision.order_data.customer_name
                  : (profile.name || "Customer"),
                customer_phone: aiDecision.order_data?.customer_phone || "",
                delivery_address: aiDecision.order_data?.delivery_address || "",
                product_name: prodName,
                variant: aiDecision.order_data?.variant || "Standard",
                total_amount: totalAmount
              };

              // 🛡️ কঠোর ভ্যালিডেশন: ফোন নম্বর (১১ ডিজিট), সঠিক প্রোডাক্ট, সঠিক ঠিকানা ও মোট মূল্য > ০ হতে হবে
              const hasValidPhone = orderInfo.customer_phone && orderInfo.customer_phone !== "ইনবক্সে প্রদত্ত নম্বর" && orderInfo.customer_phone.replace(/\D/g, '').length >= 11;
              const hasValidProduct = orderInfo.product_name && orderInfo.product_name !== "Ranonex Store Product" && orderInfo.product_name.length > 3;
              const hasValidAddress = orderInfo.delivery_address && orderInfo.delivery_address !== "ইনবক্সে প্রদত্ত ঠিকানা" && orderInfo.delivery_address.trim().length >= 4;
              const hasValidAmount = Number(orderInfo.total_amount) > 0;

              if (hasValidPhone && hasValidProduct && hasValidAddress && hasValidAmount) {
                // ডুপ্লিকেট রোধ: একই ফোন ও প্রোডাক্টের জন্য বারবার অ্যালার্ট না পাঠানো
                const dedupeKey = `${orderInfo.customer_phone}_${orderInfo.product_name}`;
                if (session.last_alerted_order_key === dedupeKey) {
                  console.log(`ℹ️ [Duplicate Order Alert Skipped]: ${dedupeKey}`);
                } else {
                  session.last_alerted_order_key = dedupeKey;
                  session.last_order_data = orderInfo;
                  session.last_order_time = Date.now();
                  session.last_order_cancelled = false;

                  console.log(`🎉 [ORDER CONFIRMED! Sending Telegram Alert & Saving to D1...]`, JSON.stringify(orderInfo));
                  await sendTelegramAlert(orderInfo, "Facebook Messenger");

                  if (CONFIG.workerUrl) {
                    fetch(`${CONFIG.workerUrl}/api/orders`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        chat_id: chatId,
                        platform: "facebook",
                        customer_name: orderInfo.customer_name,
                        customer_phone: orderInfo.customer_phone,
                        delivery_address: orderInfo.delivery_address,
                        product_name: orderInfo.product_name,
                        variant: orderInfo.variant || "Standard",
                        total_amount: orderInfo.total_amount,
                        status: "confirmed"
                      })
                    }).catch((err) => console.error("Worker order save error:", err.message));
                  }
                }
              } else {
                console.warn(`⚠️ [Order Alert Blocked]: Incomplete order details. Phone: "${orderInfo.customer_phone}", Product: "${orderInfo.product_name}", Address: "${orderInfo.delivery_address}", Total: ৳${orderInfo.total_amount}`);
              }
            }

            // ২. অর্ডার এডিট (১৫ মিনিটের মধ্যে)
            if (aiDecision.order_updated && aiDecision.order_data) {
              session.last_order_data = {
                ...(session.last_order_data || {}),
                ...aiDecision.order_data,
                customer_name: aiDecision.order_data.customer_name || profile.name
              };
              session.last_order_time = Date.now();
              session.last_order_cancelled = false;

              await sendTelegramOrderUpdate(session.last_order_data, "Facebook Messenger");
            }

            // ৩. অর্ডার বাতিল
            if (aiDecision.order_cancelled) {
              const cancelledOrder = session.last_order_data || { customer_name: profile.name, total_amount: 0 };
              session.last_order_cancelled = true;
              await sendTelegramOrderCancel(cancelledOrder, aiDecision.note, "Facebook Messenger");
            }

            // ৪. ১৫ মিনিট পর পরিবর্তন নোট
            if (aiDecision.order_note && aiDecision.note) {
              await sendTelegramOrderNote(aiDecision.note, session.last_order_data || { customer_name: profile.name }, "Facebook Messenger");
            }

            memorySessions.set(chatId, session);

            // ক্লাউডফ্লেয়ার ড্যাশবোর্ডে সিঙ্ক
            if (CONFIG.workerUrl) {
              fetch(`${CONFIG.workerUrl}/api/sync-chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: chatId,
                  sender_name: profile.name,
                  sender_avatar: profile.avatar,
                  platform: "facebook",
                  channel_type: "messenger",
                  last_message: incomingText,
                  messages: session.messages,
                  unread_count: 1
                })
              }).catch(() => {});
            }
          }
        }

        // খ. ফেসবুক কমেন্ট রিপ্লাই
        if (entry.changes && Array.isArray(entry.changes)) {
          for (const change of entry.changes) {
            if (change.field === 'feed') {
              const val = change.value;
              if (val.item === 'comment' && val.verb === 'add') {
                const commentId = val.comment_id;
                const senderId = val.from?.id;
                const senderName = val.from?.name || "Customer";
                const commentText = val.message || "";

                if (senderId === CONFIG.metaPageId || !commentText.trim()) continue;

                totalMessagesHandled++;
                console.log(`💬 [Comment by ${senderName} on ${commentId}]: ${commentText}`);

                const aiDecision = await callGeminiSalesAI(commentText, []);
                if (aiDecision && aiDecision.reply) {
                  await replyToFacebookComment(commentId, aiDecision.reply);
                }
              }
            }
          }
        }
      }
    } catch (procErr) {
      console.error("Alwaysdata processing error:", procErr.message);
    }
  });
});

// ==========================================
// 💬 CLOUDFLARE PAGES ড্যাশবোর্ড ইনবক্স API
// ==========================================
app.get(['/api/conversations', '/api/live-conversations'], (req, res) => {
  const list = Array.from(memorySessions.values()).map(s => ({
    id: s.chat_id || s.sender_id,
    sender_id: s.sender_id,
    name: s.sender_name || `Customer (${s.sender_id})`,
    sender_avatar: s.sender_avatar || "",
    platform: "facebook",
    channel_type: "messenger",
    last_message: s.last_message || "",
    last_message_at: s.last_message_at || new Date().toISOString(),
    unread_count: Number(s.unread_count || 0),
    messages_count: s.messages ? s.messages.length : 0
  })).sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));

  res.json(list);
});

app.get('/api/conversations/:id', (req, res) => {
  const session = memorySessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

app.post(['/api/send-reply', '/api/messages/send'], async (req, res) => {
  const { chat_id, message_text } = req.body || {};
  if (!chat_id || !message_text) return res.status(400).json({ error: "Missing chat_id or message_text" });

  const fbResult = await sendFacebookMessage(chat_id, message_text);
  res.json({ success: true, result: fbResult });
});

// ==========================================
// ==========================================
// ✍️ AI POST GENERATOR API (Gemini 3.8 Live Multimodal Vision + Persistent ws.send())
// ==========================================

// ইমেজ ইউআরএল থেকে Base64 ফেচ হেল্পার (Gemini 3.8 Live Vision এর জন্য)
async function fetchImageAsBase64(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'SocialAutomate/1.0' } });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) return null;
    const rawMime = res.headers.get('content-type') || 'image/jpeg';
    const mimeType = rawMime.split(';')[0].trim();
    return {
      mimeType: mimeType || 'image/jpeg',
      data: buffer.toString('base64')
    };
  } catch (e) {
    return null;
  }
}

// ⚡ পারসিস্টেন্ট পোস্ট জেনারেশন লাইভ সকেট (WebSocket Session Reuse - ws.send() দিয়ে আনলিমিটেড পোস্ট ও টোকেন সেভিং)
let persistentPostGenSocket = {
  ws: null,
  isReady: false,
  lastActive: 0,
  currentResolve: null,
  accumulatedText: "",
  activeTimeout: null
};

function getOrCreatePersistentPostGenSocket() {
  if (persistentPostGenSocket.ws && persistentPostGenSocket.ws.readyState === WebSocket.OPEN && persistentPostGenSocket.isReady) {
    return Promise.resolve(persistentPostGenSocket);
  }

  return new Promise((resolve) => {
    if (persistentPostGenSocket.ws) {
      try { persistentPostGenSocket.ws.close(); } catch (e) {}
    }

    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${CONFIG.geminiApiKey}`;
    const ws = new WebSocket(wsUrl);

    persistentPostGenSocket = {
      ws,
      isReady: false,
      lastActive: Date.now(),
      currentResolve: null,
      accumulatedText: "",
      activeTimeout: null
    };

    const handshakeTimeout = setTimeout(() => {
      if (!persistentPostGenSocket.isReady) {
        try { ws.close(); } catch (e) {}
        resolve(null);
      }
    }, 12000);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: "models/gemini-3.8-live",
          generationConfig: {
            responseModalities: ["AUDIO"]
          },
          outputAudioTranscription: {}
        }
      }));
    };

    ws.onmessage = async (evt) => {
      try {
        const raw = evt.data instanceof Blob ? await evt.data.text() : evt.data;
        const msg = JSON.parse(raw);

        if (msg.setupComplete !== undefined) {
          clearTimeout(handshakeTimeout);
          persistentPostGenSocket.isReady = true;
          persistentPostGenSocket.lastActive = Date.now();
          console.log("⚡ [Gemini 3.8 Live Post Generator] Handshake Complete! Persistent ws.send() ready.");
          resolve(persistentPostGenSocket);
          return;
        }

        if (msg.serverContent) {
          if (msg.serverContent.outputTranscription?.text) {
            persistentPostGenSocket.accumulatedText += msg.serverContent.outputTranscription.text;
          }
          const parts = msg.serverContent.modelTurn?.parts || [];
          for (const p of parts) {
            if (p.text) persistentPostGenSocket.accumulatedText += p.text;
          }

          if (msg.serverContent.turnComplete) {
            if (persistentPostGenSocket.currentResolve) {
              const resText = persistentPostGenSocket.accumulatedText.trim();
              if (persistentPostGenSocket.activeTimeout) clearTimeout(persistentPostGenSocket.activeTimeout);
              const cb = persistentPostGenSocket.currentResolve;
              persistentPostGenSocket.currentResolve = null;
              persistentPostGenSocket.accumulatedText = "";
              persistentPostGenSocket.lastActive = Date.now();
              cb(resText || null);
            }
          }
        }
      } catch (e) {}
    };

    ws.onerror = () => {
      clearTimeout(handshakeTimeout);
      if (persistentPostGenSocket.currentResolve) {
        const cb = persistentPostGenSocket.currentResolve;
        persistentPostGenSocket.currentResolve = null;
        cb(persistentPostGenSocket.accumulatedText.trim() || null);
      }
      persistentPostGenSocket.isReady = false;
    };

    ws.onclose = () => {
      clearTimeout(handshakeTimeout);
      if (persistentPostGenSocket.currentResolve) {
        const cb = persistentPostGenSocket.currentResolve;
        persistentPostGenSocket.currentResolve = null;
        cb(persistentPostGenSocket.accumulatedText.trim() || null);
      }
      persistentPostGenSocket.isReady = false;
      persistentPostGenSocket.ws = null;
    };
  });
}

async function generateTextViaLiveWebSocket(prompt, imageParts = []) {
  if (!CONFIG.geminiApiKey) return null;

  try {
    const socketEntry = await getOrCreatePersistentPostGenSocket();
    if (!socketEntry || !socketEntry.ws || socketEntry.ws.readyState !== WebSocket.OPEN) {
      return null;
    }

    return new Promise((resolve) => {
      socketEntry.accumulatedText = "";
      socketEntry.currentResolve = resolve;
      socketEntry.lastActive = Date.now();

      socketEntry.activeTimeout = setTimeout(() => {
        if (socketEntry.currentResolve) {
          const resText = socketEntry.accumulatedText.trim();
          socketEntry.currentResolve = null;
          socketEntry.accumulatedText = "";
          resolve(resText || null);
        }
      }, 25000);

      // ⚡ একই ওপেন লাইভ সকেটে ws.send() দিয়ে টার্ন পাঠানো (টোকেন ও কানেকশন সেভ)
      const userParts = [];
      if (Array.isArray(imageParts) && imageParts.length > 0) {
        for (const img of imageParts) {
          userParts.push({
            inlineData: {
              mimeType: img.mimeType || "image/jpeg",
              data: img.data || img.base64
            }
          });
        }
      }
      userParts.push({ text: prompt });

      socketEntry.ws.send(JSON.stringify({
        clientContent: {
          turns: [{ role: "user", parts: userParts }],
          turnComplete: true
        }
      }));
      console.log(`⚡ [Gemini 3.8 Live WebSocket] Post Prompt + ${imageParts.length} photo(s) sent via ws.send()!`);
    });
  } catch (err) {
    console.error("Error in generateTextViaLiveWebSocket:", err.message);
    return null;
  }
}

// 🌐 লাইভ টেস্টার এইচটিএমএল সার্ভিং রুট
app.get('/tester', (req, res) => {
  const testerPath = path.join(__dirname, 'gemini-live-tester.html');
  if (fs.existsSync(testerPath)) {
    return res.sendFile(testerPath);
  }
  res.send("Gemini 3.8 Live Tester ready.");
});

app.get('/gemini-live-tester.html', (req, res) => {
  const testerPath = path.join(__dirname, 'gemini-live-tester.html');
  if (fs.existsSync(testerPath)) {
    return res.sendFile(testerPath);
  }
  res.send("Gemini 3.8 Live Tester ready.");
});

app.post('/api/generate-post', async (req, res) => {
  const { product, angle, images: customImages } = req.body || {};
  if (!product) return res.status(400).json({ error: "Missing product data" });

  try {
    const angleName = angle?.name || "Problem-Solution";
    const angleTheme = angle?.theme || "কাস্টমারের দৈনন্দিন সমস্যা ও নিখুঁত সমাধান";
    const angleInstruction = angle?.instruction || "Focus on relatable daily frustration and reveal this product as the solution.";

    // প্রোডাক্টের সব ছবি সিরিয়াল অনুযায়ী সংগ্রহ (গ্যালারি ইমেজ, ইউআরএল ও কাস্টম ইমেজ)
    const photoUrls = [];
    if (Array.isArray(customImages)) {
      photoUrls.push(...customImages.filter(Boolean));
    }
    if (product.image_url) photoUrls.push(product.image_url);
    if (product.gallery_images) {
      let gallery = [];
      try {
        gallery = typeof product.gallery_images === 'string' ? JSON.parse(product.gallery_images) : product.gallery_images;
      } catch (e) {}
      if (Array.isArray(gallery)) photoUrls.push(...gallery);
    }
    if (Array.isArray(product.photos)) photoUrls.push(...product.photos);
    if (Array.isArray(product.images)) photoUrls.push(...product.images);

    const uniquePhotoUrls = [...new Set(photoUrls.filter(u => typeof u === 'string' && u.startsWith('http')))].slice(0, 3);

    // প্যারালালে সব ছবি ডাউনলোড ও Base64 কনভার্ট
    const imageParts = [];
    if (uniquePhotoUrls.length > 0) {
      console.log(`📸 [Fetching ${uniquePhotoUrls.length} Product Photos for Gemini 3.8 Live Vision Analysis...]`);
      const downloads = await Promise.allSettled(uniquePhotoUrls.map(url => fetchImageAsBase64(url)));
      for (const d of downloads) {
        if (d.status === 'fulfilled' && d.value) {
          imageParts.push(d.value);
        }
      }
      console.log(`✅ [Vision Ready] Converted ${imageParts.length} photo(s) for Gemini 3.8 Live!`);
    }

    if (product.image_base64) {
      imageParts.push({
        mimeType: product.image_mime || "image/jpeg",
        data: product.image_base64
      });
    }

    const visualInstruction = imageParts.length > 0
      ? `VISUAL INSPECTION DIRECTIVE: You have been provided with ${imageParts.length} real photo(s) of this product in image parts. Carefully inspect the product's actual appearance, colors, finish, materials, buttons, display, ergonomics, and accessories in these photos. Describe these authentic visual details naturally in your Bengali copy so readers can instantly visualize the product in their hands.`
      : "";

    const prompt = `You are an elite, highly persuasive Bangladeshi Direct-Response Copywriter and E-commerce Social Media Marketer for "Ranonex" (https://ranonex.shop).
Your task is to write an irresistible, high-converting Facebook post in natural, engaging, pure Bengali script (বাংলা লিপি).

CRITICAL REQUIREMENTS:
1. STRICT ZERO BANGLISH POLICY: Write 100% in natural Bengali script. Never write in Banglish!
2. Write the store brand name in English letters as "Ranonex".
3. NO generic, robotic templates! Do NOT use repetitive formulaic bullets like "💎 কেন এটি আপনার জন্য সেরা পছন্দ?" or "✅ প্রিমিয়াম বিল্ড কোয়ালিটি".
4. Craft an attention-grabbing, curiosity-inducing opening hook matching today's angle: "${angleName}".
5. Highlight real customer pain points and how this product solves them with authentic, vivid storytelling.
6. Clearly state the exact price: ${product.price} ৳ / টাকা. Never misquote prices.
7. Mention Cash on Delivery (ক্যাশ অন ডেলিভারি) available across all 64 districts in Bangladesh with open-box parcel checking allowed before payment.
8. State accurate delivery charges: ঢাকা সিটির ভেতরে মাত্র ৭০ টাকা, এবং ঢাকার বাইরে ১৩০ টাকা।
9. Clear Call to Action: ইনবক্সে মেসেজ দিন অথবা ভিজিট করুন: ${product.url || 'https://ranonex.shop'}.
10. Include 4-6 relevant Bengali & English hashtags at the end (#Ranonex #GadgetBD etc.).
${visualInstruction}

Product Details:
- Name: ${product.name || product.title}
- Price: ৳${product.price}
- Details: ${product.description || ''}
- URL: ${product.url || ''}

Output ONLY the final Facebook post caption, ready to publish. No conversational preamble.`;

    // ১. Gemini 3.8 Live WebSocket ট্রাই (ws.send() সেশন রিউজ ও ফটো ভিশন সহ)
    const wsCaption = await generateTextViaLiveWebSocket(prompt, imageParts);
    if (wsCaption && wsCaption.length > 50) {
      return res.json({ 
        success: true, 
        caption: wsCaption, 
        method: "gemini-3.8-live-ws", 
        photos_analyzed: imageParts.length,
        session_reused: true 
      });
    }

    // ২. REST ফলব্যাক (gemini-3.8-flash)
    if (CONFIG.geminiApiKey) {
      const restRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${CONFIG.geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.85, maxOutputTokens: 1000 }
        })
      });
      if (restRes.ok) {
        const d = await restRes.json();
        const candidateText = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidateText && candidateText.trim()) {
          return res.json({ success: true, caption: candidateText.trim(), method: "gemini-3.8-flash-rest" });
        }
      }
    }

    // ৩. ফলব্যাক কপি
    return res.json({
      success: true,
      caption: `🔥 ${product.name || product.title} 🔥\n\nদৈনন্দিন ব্যবহারের জন্য দারুণ একটি গ্যাজেট!\n\n💰 অফার মূল্য: মাত্র ৳${product.price}\n🚚 সারা বাংলাদেশে ক্যাশ অন ডেলিভারি (পার্সেল খুলে দেখে মূল্য পরিশোধের সুবিধা)\n📦 ডেলিভারি চার্জ: ঢাকা সিটিতে মাত্র ৭০ টাকা, ঢাকার বাইরে ১৩০ টাকা।\n\n👉 অর্ডার করতে এখনই আমাদের ইনবক্সে মেসেজ দিন অথবা ভিজিট করুন: ${product.url || 'https://ranonex.shop'}\n\n#Ranonex #GadgetBD #OnlineShopping`,
      method: "fallback"
    });
  } catch (err) {
    console.error("Error generating post caption:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ৯. সার্ভার চালু
const PORT = process.env.PORT || CONFIG.port || 8100;
const HOST = process.env.IP || '::';
app.listen(PORT, HOST, () => {
  console.log(`====================================================`);
  console.log(`🚀 SocialAutomate Alwaysdata Server is ONLINE!`);
  console.log(`📡 Listening on: [${HOST}]:${PORT}`);
  console.log(`🔗 Webhook URL: /webhook/meta`);
  console.log(`====================================================`);
});

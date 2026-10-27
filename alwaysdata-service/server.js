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
    .replace(/🔗\s*প্রোডাক্ট\s*লিংক:?\s*https?:\/\/[^\s]+/gi, "")
    .trim();
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

  // ১. ORDER_JSON মার্কার চেক
  const orderMatch = raw.match(/ORDER_JSON:\s*(\{[\s\S]*?\})/i);
  if (orderMatch) {
    try {
      const p = JSON.parse(orderMatch[1]);
      if (p.order_confirmed || p.customer_phone) {
        order_confirmed = true;
        order_data = p;
      }
    } catch (e) {
      const name = (raw.match(/"customer_name":\s*"([^"]+)"/i) || [])[1] || "";
      const phone = (raw.match(/"customer_phone":\s*"([^"]+)"/i) || [])[1] || "";
      const address = (raw.match(/"delivery_address":\s*"([^"]+)"/i) || [])[1] || "";
      const product = (raw.match(/"product_name":\s*"([^"]+)"/i) || [])[1] || "";
      const total = parseFloat((raw.match(/"total_amount":\s*([0-9.]+)/i) || [])[1] || 0);
      if (phone) {
        order_confirmed = true;
        order_data = { customer_name: name, customer_phone: phone, delivery_address: address, product_name: product, total_amount: total };
      }
    }
  }

  // ২. প্রথম টার্নেই কনফার্মেশন ধরা (কখনোই যেন ২য় বারের অপেক্ষায় না থাকে)
  if (!order_confirmed) {
    const isConfirmSpoken = /(?:অর্ডারটি\s*(?:সফলভাবে\s*)?কনফার্ম|অর্ডার\s*কনফার্ম|অর্ডার\s*নিশ্চিত|অর্ডারটি\s*নিশ্চিত|অর্ডার\s*গ্রহণ\s*করা\s*হয়েছে)/i.test(replyText);
    if (isConfirmSpoken) {
      let foundPhone = "";
      for (let i = messages.length - 1; i >= 0; i--) {
        const text = messages[i].message_text || "";
        const phoneMatch = text.match(/(?:(?:\+?88)?01[3-9]\d{8})/);
        if (phoneMatch && !foundPhone) {
          foundPhone = phoneMatch[0].replace(/^\+?88/, "");
          break;
        }
      }

      if (foundPhone) {
        order_confirmed = true;
        const prodName = activeProduct ? activeProduct.name : "Ranonex Store Product";
        const basePrice = activeProduct ? parseFloat(activeProduct.price || 0) : 0;
        const isDhaka = /ঢাকা|dhaka/i.test(raw) && !/ঢাকার\s*বাইরে|outside/i.test(raw);
        const deliveryCharge = isDhaka ? 70 : 130;
        const total = basePrice > 0 ? (basePrice + deliveryCharge) : 0;

        order_data = {
          order_confirmed: true,
          customer_name: messages[messages.length - 1]?.sender_name || "Customer",
          customer_phone: foundPhone,
          delivery_address: "ইনবক্সে প্রদত্ত ঠিকানা",
          product_name: prodName,
          variant: "Standard",
          total_amount: total
        };
        console.log(`⚡ [Auto-Detected First-Time Order Confirmation]: Phone ${foundPhone}, Product ${prodName}`);
      }
    }
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

          productsList.push({
            id: p.id,
            sku,
            name: p.name,
            price,
            image_url: imgUrl,
            url: link
          });

          catalog += `- [SKU: ${sku}] ${p.name}
    * EXACT PRICE: ৳${price} (${price} BDT)
    * ORDER LINK: ${link}
    * SPECS: ${p.specifications || 'Standard'}\n`;
        }
      }
    }
  } catch (err) {
    console.warn("Product fetch warning:", err.message);
  }

  productCatalogCache = { data: catalog, productsList, expiresAt: now + 10 * 60 * 1000 };
  return productCatalogCache;
}

// টেক্সট থেকে প্রোডাক্ট খোঁজা
function findMatchingProduct(text, productsList) {
  if (!text || !Array.isArray(productsList) || productsList.length === 0) return null;
  const lower = text.toLowerCase();
  for (const p of productsList) {
    if (lower.includes(p.id.toLowerCase())) return p;
    if (p.sku && lower.includes(p.sku.toLowerCase())) return p;
    const words = p.name.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !['with', 'control', 'original', 'retro', 'sharp'].includes(w));
    const matchCount = words.filter(w => lower.includes(w)).length;
    if (matchCount >= 2 || (words.length === 1 && matchCount === 1)) {
      return p;
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
// ==========================================
async function callGeminiSalesAI(incomingText, chatHistory = [], session = null, incomingAudioBuffer = null, audioMimeType = "audio/mp4") {
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

  // অর্ডার টাইম উইন্ডো চেক
  let orderTimeContext = "";
  const now = Date.now();
  if (session && session.last_order_data && session.last_order_time && !session.last_order_cancelled) {
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

  // সক্রিয় প্রোডাক্টের কনটেক্সট
  const activeProduct = session?.last_discussed_product || null;
  const activeProductContext = activeProduct ? `
[ACTIVE PRODUCT UNDER DISCUSSION:
- Product Name: ${activeProduct.name}
- SKU: ${activeProduct.sku}
- Price: ৳${activeProduct.price}
- Link: ${activeProduct.url}
RULE: If customer provides Name, Phone, and Address without repeating the product name, immediately confirm the order for this active product!]` : '';

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

5. SOFT CONSULTATIVE SELLING:
   - Empathize with their need/inquiry (phone heating, gaming, budget, etc.).
   - Explain product benefits, exact price (৳), and ask if they would like to order.
   - Do NOT include full raw URLs in the text (an interactive Card View with picture and in-app webview button will automatically appear below your message).

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

IMPORTANT: Internal markers (ORDER_JSON, ORDER_UPDATE_JSON, ORDER_CANCEL_JSON, ORDER_NOTE_JSON) are strictly for internal system processing. Never show raw JSON inside customer sentences.

${orderTimeContext}
${activeProductContext}

STORE PRODUCTS CATALOG:
${catalog}`;

  // Multi-turn turns for Gemini Live API
  const rawTurns = [];
  if (Array.isArray(chatHistory)) {
    for (const m of chatHistory.slice(-8)) {
      const role = m.sender_type === "assistant" || m.sender_type === "ai" ? "model" : "user";
      const text = (m.message_text || "").trim();
      if (text) rawTurns.push({ role, parts: [{ text }] });
    }
  }

  if (rawTurns.length === 0 || rawTurns[rawTurns.length - 1].parts[0].text !== incomingText.trim()) {
    rawTurns.push({ role: "user", parts: [{ text: incomingText.trim() }] });
  }

  const turns = [];
  for (const turn of rawTurns) {
    if (turns.length === 0) {
      if (turn.role === "user") turns.push(turn);
      continue;
    }
    const prevTurn = turns[turns.length - 1];
    if (prevTurn.role === turn.role) {
      prevTurn.parts[0].text += "\n" + turn.parts[0].text;
    } else {
      turns.push(turn);
    }
  }
  if (turns.length === 0) {
    turns.push({ role: "user", parts: [{ text: incomingText.trim() }] });
  }

  return new Promise((resolve) => {
    let accumulatedText = "";
    const pcmChunks = [];
    let isFinished = false;
    const startTime = Date.now();

    const timeout = setTimeout(() => {
      if (!isFinished) {
        isFinished = true;
        try { ws.close(); } catch (e) {}
        const cleanReply = cleanCustomerReply(accumulatedText) || "ধন্যবাদ! আমরা আপনার মেসেজটি পেয়েছি। কিছুক্ষণের মধ্যে আমাদের টিম থেকে উত্তর দেওয়া হবে।";
        resolve({
          reply: cleanReply,
          order_confirmed: false,
          order_updated: false,
          order_cancelled: false,
          order_note: false,
          order_data: null,
          note: "",
          audio_id: null,
          audio_url: null
        });
      }
    }, 25000);

    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${CONFIG.geminiApiKey}`;
    const ws = new WebSocket(wsUrl);

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
          if (incomingAudioBuffer) {
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
            accumulatedText += msg.serverContent.outputTranscription.text;
          }
          const parts = msg.serverContent.modelTurn?.parts || [];
          for (const p of parts) {
            if (p.text) accumulatedText += p.text;
            if (p.inlineData && p.inlineData.data) {
              pcmChunks.push(Buffer.from(p.inlineData.data, 'base64'));
            }
          }

          if (msg.serverContent.turnComplete) {
            if (!isFinished) {
              isFinished = true;
              clearTimeout(timeout);
              try { ws.close(); } catch (e) {}

              let audioId = null;
              let audioUrl = null;
              if (pcmChunks.length > 0) {
                try {
                  const rawPcm = Buffer.concat(pcmChunks);
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

              const cleanReply = cleanCustomerReply(accumulatedText);
              const actions = extractOrderActions(accumulatedText, cleanReply, chatHistory, activeProduct);

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
          }
        }
      } catch (err) {}
    };

    ws.onerror = (e) => {
      console.error("[Gemini 3.8 Live] WebSocket error:", e.message || e);
    };

    ws.onclose = () => {
      if (!isFinished) {
        isFinished = true;
        clearTimeout(timeout);
        const cleanReply = cleanCustomerReply(accumulatedText);
        const actions = extractOrderActions(accumulatedText, cleanReply, chatHistory, activeProduct);
        resolve({
          reply: cleanReply || "ধন্যবাদ! আমরা আপনার মেসেজটি পেয়েছি। কিছুক্ষণের মধ্যে আমাদের টিম থেকে উত্তর দেওয়া হবে।",
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
    };
  });
}

// ==========================================
// 📢 TELEGRAM অর্ডার ও মেসেজ অ্যালার্ট
// ==========================================
async function sendTelegramAlert(order, platform = "Facebook") {
  if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) return;

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
    await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CONFIG.telegramChatId, text, parse_mode: "HTML" })
    });
  } catch (e) {}
}

async function sendTelegramOrderUpdate(order, platform = "Facebook") {
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
    await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CONFIG.telegramChatId, text, parse_mode: "HTML" })
    });
  } catch (e) {}
}

async function sendTelegramOrderCancel(order, reason, platform = "Facebook") {
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
    await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CONFIG.telegramChatId, text, parse_mode: "HTML" })
    });
  } catch (e) {}
}

async function sendTelegramOrderNote(noteText, customer, platform = "Facebook") {
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
    await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CONFIG.telegramChatId, text, parse_mode: "HTML" })
    });
  } catch (e) {}
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

            const chatId = `fb_${senderId}`;
            let session = memorySessions.get(chatId) || { messages: [], sender_id: senderId };
            session.sender_id = senderId;

            const profile = await getFacebookUserProfile(senderId);
            session.sender_name = profile.name;

            // ==========================================
            // 🕹️ কুইক রিপ্লাই ও পোস্টব্যাক হ্যান্ডলার
            // ==========================================

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

            // ২. [🛍️ এখনই অর্ডার করব] বাটন ক্লিক
            if (incomingPayload === "ACTION_ORDER_NOW") {
              const text = "দারুণ! ক্যাশ অন ডেলিভারিতে অর্ডার কনফার্ম করতে অনুগ্রহ করে আপনার:\n১. পুরো নাম\n২. ১১ ডিজিটের মোবাইল নম্বর\n৩. সম্পূর্ণ ডেলিভারি ঠিকানা লিখে পাঠিয়ে দিন।";
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

            if (!incomingText && !userSentAudio) continue;

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

            const userPromptText = userSentAudio
              ? "The customer sent this voice note. Listen to their speech and directly answer their question, need, or inquiry in pure Bengali script like a friendly human conversation. DO NOT introduce yourself! Answer directly."
              : incomingText.trim();

            totalMessagesHandled++;
            console.log(`📩 [Messenger from ${senderId}]: ${incomingText || "[Voice Note]"}`);

            session.messages.push({
              id: message?.mid || `m_${Date.now()}`,
              sender_type: "customer",
              sender_name: profile.name,
              message_text: incomingText || "[Voice Message]",
              timestamp: new Date().toISOString()
            });

            const isVoiceRequested = userSentAudio || /ভয়েস|ভয়েস|audio|voice|কথা বলো|শুনতে চাই/i.test(incomingText || "");

            // Gemini 3.8 Live কল
            const aiDecision = await callGeminiSalesAI(userPromptText, session.messages, session, incomingAudioBuffer, audioMimeType);

            if (aiDecision && aiDecision.reply) {
              console.log(`🤖 [AI Reply to ${profile.name}]: ${aiDecision.reply.substring(0, 80)}...`);

              // স্মার্ট কনটেক্সচুয়াল কুইক রিপ্লাই বাটন তৈরি
              const quickReplies = buildContextualQuickReplies(session, aiDecision, aiDecision.audio_id);

              // ইউজার ভয়েস চাইলে সরাসরি অডিও পাঠানো
              if (isVoiceRequested && aiDecision.audio_url) {
                await sendFacebookAudio(senderId, aiDecision.audio_url);
              }

              // টেক্সট মেসেজ পাঠানো
              await sendFacebookMessage(senderId, aiDecision.reply, quickReplies);

              // 🃏 প্রোডাক্ট কার্ড ভিউ (In-App WebView সহ)
              const { productsList } = await getStoreCatalog();
              const matchedProduct = findMatchingProduct(aiDecision.reply, productsList) || session.last_discussed_product || null;

              if (matchedProduct) {
                session.last_discussed_product = matchedProduct;
                session.last_inquiry_time = Date.now();
                session.abandoned_reminder_sent = false;

                if (/প্রোডাক্ট|কুলার|cooler|হেডফোন|earphone|game|console|neon|light|দাম|৳|অর্ডার|নিবেন/i.test(aiDecision.reply)) {
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

            // ১. অর্ডার কনফার্মেশন -> প্রথমবারেই টেলিগ্রাম অ্যালার্ট
            if (aiDecision.order_confirmed && aiDecision.order_data) {
              session.last_order_data = {
                ...aiDecision.order_data,
                customer_name: aiDecision.order_data.customer_name || profile.name
              };
              session.last_order_time = Date.now();
              session.last_order_cancelled = false;

              console.log(`🎉 [ORDER CONFIRMED FIRST TIME! Sending Telegram Alert...]`);
              await sendTelegramAlert(session.last_order_data, "Facebook Messenger");

              if (CONFIG.workerUrl) {
                fetch(`${CONFIG.workerUrl}/api/orders`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: chatId,
                    platform: "facebook",
                    customer_name: session.last_order_data.customer_name,
                    customer_phone: session.last_order_data.customer_phone || "",
                    delivery_address: session.last_order_data.delivery_address || "",
                    product_name: session.last_order_data.product_name || "",
                    variant: session.last_order_data.variant || "Standard",
                    total_amount: session.last_order_data.total_amount || 0,
                    status: "confirmed"
                  })
                }).catch(() => {});
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

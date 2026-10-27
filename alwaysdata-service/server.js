/**
 * SocialAutomate - High-Efficiency Alwaysdata Node.js Gateway
 * -------------------------------------------------------------
 * 1. Meta Webhook Receiver (Facebook Messenger & Comments)
 * 2. Instant 200 OK Handshake (Never times out Meta's 5s rule)
 * 3. Gemini 3.8 Live Multimodal WebSocket Engine (Unlimited Live Audio + Text)
 * 4. Automatic Facebook Outbound Messenger & Comment Replies
 * 5. On-Demand / Secret Audio Voice Notes & Interactive Quick Replies [🔊 ভয়েস শুনুন]
 * 6. Native Facebook Messenger Generic Template Product Card View (Image + Price + Order Button)
 * 7. Instant Telegram Order Notifications (Confirm on First Turn, Edit, Cancel, Note)
 * 8. Live Store Catalog Auto-Fetch (ranonex.shop)
 * 9. Cloudflare Worker Session Sync (Keeps automate.ranonex.shop in sync)
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
  workerUrl: process.env.WORKER_URL || "https://social-automate.rifatrabbi104.workers.dev"
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
    // যেকোনো ORDER_*_JSON মার্কার থেকে শেষ পর্যন্ত সমস্ত টেক্সট মুছে ফেলা
    .replace(/(?:ORDER_JSON|ORDER_UPDATE_JSON|ORDER_CANCEL_JSON|ORDER_NOTE_JSON)[\s\S]*/i, "")
    // যেকোনো কোড ব্লক বা ব্যাকটিক মুছে ফেলা
    .replace(/```(?:json)?[\s\S]*?```/gi, "")
    // যেকোনো ট্রেইলিং JSON ব্লক মুছে ফেলা
    .replace(/\{[\s\r\n]*"(?:order_confirmed|customer_name|order_updated|order_cancelled|order_note|delivery_address)"[\s\S]*?\}/gi, "")
    .replace(/\{[\s\S]*?\}[\s]*$/gi, "")
    // প্রোডাক্ট লিংক টেক্সট থেকে সরিয়ে ফেলা কারণ এটি নিচে চমৎকার কার্ড ভিউতে দেখাবে
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
      // মেসেজ হিস্ট্রি থেকে কাস্টমারের ১১ ডিজিটের মোবাইল নম্বর বের করা
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
- Delivery Charge: ঢাকা সিটির ভেতরে ৭০ টাকা, ঢাকার বাইরে ১৩০ টাকা।
- Payment Method: Cash on Delivery (ক্যাশ অন ডেলিভারি - পণ্য হাতে পেয়ে টাকা পরিশোধ)
- Return Policy: ডেলিভারির সময় পার্সেল চেক করে দেখে নেওয়ার সুযোগ।
- Hotline / Helpline: ফেসবুক পেজে ইনবক্স করুন।

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

// টেক্সট থেকে প্রোডাক্ট খোঁজা (ফেসবুক কার্ড ভিউর জন্য)
function findMatchingProduct(text, productsList) {
  if (!text || !Array.isArray(productsList) || productsList.length === 0) return null;
  const lower = text.toLowerCase();
  for (const p of productsList) {
    if (lower.includes(p.id.toLowerCase())) return p;
    // SKU ম্যাচ
    if (p.sku && lower.includes(p.sku.toLowerCase())) return p;
    // প্রোডাক্টের নামের গুরুত্বপূর্ণ শব্দ ম্যাচ
    const words = p.name.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !['with', 'control', 'original', 'retro', 'sharp'].includes(w));
    const matchCount = words.filter(w => lower.includes(w)).length;
    if (matchCount >= 2 || (words.length === 1 && matchCount === 1)) {
      return p;
    }
  }
  return null;
}

// ==========================================
// 🤖 GEMINI 3.8 LIVE MULTIMODAL WEBSOCKET ENGINE (BIDIGENERATECONTENT)
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

  // অর্ডার টাইম উইন্ডো চেক (১৫ মিনিটের মধ্যে পরিবর্তন/বাতিল বনাম ১৫ মিনিট পর নোট)
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
   Confirm the update politely and output:
   ORDER_UPDATE_JSON: {"order_updated": true, "customer_name": "...", "customer_phone": "...", "delivery_address": "...", "product_name": "...", "variant": "...", "total_amount": 0}
2. If customer wants to cancel the order ('cancel koro', 'বাতিল করুন', 'lagbe na', etc.):
   Politely confirm cancellation and output:
   ORDER_CANCEL_JSON: {"order_cancelled": true, "customer_name": "${session.last_order_data.customer_name || 'Customer'}", "customer_phone": "${session.last_order_data.customer_phone || ''}", "product_name": "${session.last_order_data.product_name || ''}", "reason": "Customer requested cancellation"}]`;
    } else {
      orderTimeContext = `
[ORDER STATUS CONTEXT: Customer confirmed an order ${elapsedMinutes} minutes ago (more than 15 minutes have passed):
- Customer Name: ${session.last_order_data.customer_name || 'N/A'}
- Phone: ${session.last_order_data.customer_phone || 'N/A'}
- Address: ${session.last_order_data.delivery_address || 'N/A'}
- Product: ${session.last_order_data.product_name || 'N/A'}
RULE: The 15-minute direct edit window has expired (order is in packaging/dispatch queue).
If customer asks to modify details or cancel:
Explain politely that the order is already in packaging/dispatch, so direct modification is locked. Reassure them that you have added their request as an urgent NOTE for the delivery team to call them.
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
RULE: If the customer provides Name, Phone, and Address without repeating the product name, immediately confirm the order for this active product!]` : '';

  const isFirstMessage = !Array.isArray(chatHistory) || chatHistory.length <= 1;

  const systemInstruction = `You are the official AI Sales Assistant of 'Ranonex' online store in Bangladesh (https://ranonex.shop).

CRITICAL BRAND & LANGUAGE RULES:
1. STRICT ZERO BANGLISH POLICY (জিরো বাংলিশ পলিসি):
   - You MUST ALWAYS respond in pure, polite, and natural Bengali script (খাঁটি বাংলা লিপি).
   - Under NO circumstances should you EVER respond in Banglish (English letters for Bengali words)!
   - Even if the customer writes in Banglish (e.g., 'cooler ache?', 'dam koto?'), reply 100% in pure Bengali script (বাংলা লিপি).

2. STORE BRAND NAME IN ENGLISH ONLY:
   - ALWAYS write the store brand name in English letters as "Ranonex". Never in Bengali script.

3. STRICT IDENTITY & NO-REPETITIVE-INTRO RULE:
   ${isFirstMessage ? `- ONLY on the very first greeting (if customer says 'hi/hello/salam'), introduce yourself ONCE: "আমি Ranonex স্টোরের সেলস অ্যাসিস্ট্যান্ট..."` : `- DO NOT INTRODUCE YOURSELF! Never repeat "আমি Ranonex স্টোরের সেলস অ্যাসিস্ট্যান্ট..." on subsequent messages or voice replies! Answer directly like a helpful human conversation.`}

4. STRICT PRODUCT PRICE INTEGRITY:
   - Quote the EXACT numeric price listed under 'EXACT PRICE' in the catalog.
   - For example, if EXACT PRICE is ৳1315, state "১৩১৫ টাকা (1315 ৳)". Never drop zeros or say wrong numbers.

5. SOFT CONSULTATIVE SELLING:
   - Empathize with their need/inquiry (phone heating, gaming, budget, etc.).
   - Explain product benefits, exact price (৳), and ask if they would like to order or know anything else.
   - Do NOT include full raw URLs in the text (an interactive Card View with picture and order button will automatically appear below your message).

6. 🚨 STRICT FIRST-TURN ORDER CONFIRMATION RULE (কড়াকড়ি নিয়ম):
   - THE VERY INSTANT the customer provides their Name, 11-digit Bangladeshi Phone Number (e.g. 01XXXXXXXXX), and Delivery Address:
   - YOU MUST IMMEDIATELY CONFIRM THE ORDER ON THAT VERY FIRST TURN!
   - DO NOT wait for a 2nd confirmation! DO NOT say "অর্ডার কনফার্ম করব কি না"!
   - Confirm warmly: "আপনার অর্ডারটি সফলভাবে কনফার্ম করা হয়েছে! আপনি চাইলে আগামী ১৫ মিনিটের মধ্যে যেকোনো তথ্য (ঠিকানা, ফোন নম্বর বা প্রোডাক্ট) পরিবর্তন বা বাতিল করতে পারবেন।"
   - AT THE VERY BOTTOM OF THAT EXACT MESSAGE, OUTPUT:
     ORDER_JSON: {"order_confirmed": true, "customer_name": "...", "customer_phone": "...", "delivery_address": "...", "product_name": "...", "variant": "...", "total_amount": 0}

7. EDIT & CANCELLATION:
   - If customer edits within 15 minutes -> Confirm update & output:
     ORDER_UPDATE_JSON: {"order_updated": true, "customer_name": "...", "customer_phone": "...", "delivery_address": "...", "product_name": "...", "variant": "...", "total_amount": 0}
   - If customer cancels -> Confirm cancellation & output:
     ORDER_CANCEL_JSON: {"order_cancelled": true, "customer_name": "...", "customer_phone": "...", "product_name": "...", "reason": "Customer requested cancellation"}

IMPORTANT: Internal markers (ORDER_JSON, ORDER_UPDATE_JSON, ORDER_CANCEL_JSON, ORDER_NOTE_JSON) are strictly for internal system processing and will be stripped by the server. Never show raw JSON inside customer sentences.

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

  // Merge consecutive same-role turns
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
        console.warn(`[Gemini 3.8 Live] WebSocket timed out after ${Date.now() - startTime}ms`);
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
      console.log(`🤖 [Gemini 3.8 Live] WebSocket connected in ${Date.now() - startTime}ms. Sending setup...`);
      const setupPayload = {
        setup: {
          model: "models/gemini-3.8-live",
          generationConfig: {
            responseModalities: ["AUDIO"]
          },
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          outputAudioTranscription: {}
        }
      };
      ws.send(JSON.stringify(setupPayload));
    };

    ws.onmessage = async (event) => {
      try {
        const rawText = event.data instanceof Blob ? await event.data.text() : event.data;
        const msg = JSON.parse(rawText);

        // Step 1: Handshake setupComplete
        if (msg.setupComplete !== undefined) {
          console.log(`🤖 [Gemini 3.8 Live] Setup verified in ${Date.now() - startTime}ms. Dispatching prompt...`);

          // যদি ইউজারের ভয়েস অডিও থাকে -> রিয়েল-টাইম মিডিয়া চাঙ্ক পাঠানো
          if (incomingAudioBuffer) {
            console.log(`🎤 [Sending Customer Voice Audio]: ${incomingAudioBuffer.length} bytes (${audioMimeType})`);
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

        // Step 2: Accumulate transcription & audio PCM chunks
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
              console.log(`🤖 [Gemini 3.8 Live] Turn complete in ${Date.now() - startTime}ms`);

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
                  console.log(`🔊 [Audio Generated]: ${wavBuffer.length} bytes -> ${audioUrl}`);
                } catch (audioErr) {
                  console.warn("Audio WAV conversion warning:", audioErr.message);
                }
              }

              const cleanReply = cleanCustomerReply(accumulatedText);
              // কাস্টমার মেসেজ ও রিপ্লাই যাচাই করে প্রথম টার্নেই অর্ডার ধরা
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
      } catch (err) {
        console.warn("[Gemini 3.8 Live] Message parse error:", err.message);
      }
    };

    ws.onerror = (e) => {
      console.error("[Gemini 3.8 Live] WebSocket error:", e.message || e);
    };

    ws.onclose = (event) => {
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
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text,
        parse_mode: "HTML"
      })
    });
    console.log(`📢 [Telegram Order Alert Sent to ${CONFIG.telegramChatId}]:`, res.status);
  } catch (e) {
    console.warn("Telegram alert error:", e.message);
  }
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
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text,
        parse_mode: "HTML"
      })
    });
  } catch (e) {
    console.warn("Telegram update alert error:", e.message);
  }
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
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text,
        parse_mode: "HTML"
      })
    });
  } catch (e) {
    console.warn("Telegram cancel alert error:", e.message);
  }
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
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text,
        parse_mode: "HTML"
      })
    });
  } catch (e) {
    console.warn("Telegram note alert error:", e.message);
  }
}

// ==========================================
// 🔵 FACEBOOK GRAPH API OUTBOUND HELPERS
// ==========================================
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

// ফেসবুক নেটিভ কার্ড ভিউ (Generic Template)
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
                    title: "🛍️ বিস্তারিত ও অর্ডার"
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
    const data = await res.json();
    console.log(`🃏 [FB Product Card View Sent to ${recipientId}]:`, data);
    return data;
  } catch (e) {
    console.error("FB Card Send Error:", e.message);
    return null;
  }
}

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
            payload: {
              url: audioUrl,
              is_reusable: true
            }
          }
        }
      })
    });
    const data = await res.json();
    console.log(`🔊 [FB Audio Send to ${recipientId}]:`, data);
    return data;
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
    console.error("FB Comment Reply Error:", e.message);
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
      products_count: productCatalogCache.productsList?.length || 0
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
  console.warn("❌ [Alwaysdata Meta Webhook] Verification failed. Invalid token:", token);
  return res.status(403).send("Forbidden");
});

// ৩. মেটা ফেসবুক Webhook ইভেন্ট হ্যান্ডলার (POST /webhook/meta)
app.post('/webhook/meta', (req, res) => {
  // মেটাকে তাৎক্ষণিক 200 OK রেসপন্স পাঠানো
  res.status(200).json({ status: "EVENT_RECEIVED" });

  const body = req.body;
  if (!body || body.object !== 'page') return;

  setImmediate(async () => {
    try {
      for (const entry of (body.entry || [])) {
        // ক. ফেসবুক মেসেঞ্জার মেসেজ
        if (entry.messaging && Array.isArray(entry.messaging)) {
          for (const event of entry.messaging) {
            const senderId = event.sender?.id;
            const recipientId = event.recipient?.id;
            const message = event.message;

            // ফিল্টার: নিজের মেসেজ বা ডামি মেসেজ বাদ দেওয়া
            if (!senderId || senderId === CONFIG.metaPageId || senderId === '0' || !message) continue;
            if (message.is_echo) continue;

            const quickReplyPayload = message.quick_reply ? message.quick_reply.payload : "";
            const incomingText = message.text || quickReplyPayload;
            const userSentAudio = Boolean(message.attachments && message.attachments.some(a => a.type === 'audio'));

            const chatId = `fb_${senderId}`;
            let session = memorySessions.get(chatId) || { messages: [] };

            // ১. যদি ইউজার [🔊 ভয়েস শুনুন] বাটনে ক্লিক করে থাকেন
            if (quickReplyPayload && quickReplyPayload.startsWith("PLAY_AUDIO_")) {
              const clickedAudioId = quickReplyPayload.replace("PLAY_AUDIO_", "").trim();
              console.log(`🔊 [Voice Play Clicked by ${senderId}]: ${clickedAudioId}`);

              if (audioCache.has(clickedAudioId)) {
                await sendFacebookAudio(senderId, `https://ranonex.alwaysdata.net/audio/${clickedAudioId}.wav`);
              } else {
                // অন-ডিমান্ড ভয়েস জেনারেট করে পাঠানো
                const lastAiMsg = session.messages.filter(m => m.sender_type === "assistant").pop();
                const textToSpeak = lastAiMsg ? lastAiMsg.message_text : "ধন্যবাদ Ranonex-এর সাথে থাকার জন্য।";
                const genRes = await generateAudioFromText(textToSpeak);
                if (genRes && genRes.audioUrl) {
                  await sendFacebookAudio(senderId, genRes.audioUrl);
                }
              }
              continue;
            }

            if (!incomingText && !userSentAudio) continue;

            // কাস্টমারের ভয়েস অডিও ডাউনলোড করা (যদি ভয়েস মেসেজ পাঠায়)
            let incomingAudioBuffer = null;
            let audioMimeType = "audio/mp4";
            if (userSentAudio) {
              const audioAttachment = message.attachments.find(a => a.type === 'audio');
              if (audioAttachment?.payload?.url) {
                try {
                  console.log(`📥 [Downloading User Voice Attachment]: ${audioAttachment.payload.url.slice(0, 60)}...`);
                  const aRes = await fetch(audioAttachment.payload.url);
                  if (aRes.ok) {
                    incomingAudioBuffer = Buffer.from(await aRes.arrayBuffer());
                    audioMimeType = aRes.headers.get("content-type") || "audio/mp4";
                    console.log(`✅ [Downloaded User Voice]: ${incomingAudioBuffer.length} bytes`);
                  }
                } catch (dlErr) {
                  console.warn("Could not download voice attachment:", dlErr.message);
                }
              }
            }

            // ইউজারের প্রম্পট টেক্সট (ভয়েস মেসেজের ক্ষেত্রে পরিচয় পুনরাবৃত্তি না করার নির্দেশ)
            const userPromptText = userSentAudio
              ? "The customer sent this voice note. Listen to their speech and directly answer their question, need, or inquiry in pure Bengali script like a friendly human conversation. DO NOT introduce yourself! Answer directly."
              : incomingText.trim();

            totalMessagesHandled++;
            console.log(`📩 [Messenger from ${senderId}]: ${incomingText || "[Voice Note]"}`);

            // ইউজারের প্রোফাইল
            const profile = await getFacebookUserProfile(senderId);

            // চ্যাটে ইনকামিং মেসেজ পুশ
            session.messages.push({
              id: event.message.mid || `m_${Date.now()}`,
              sender_type: "customer",
              sender_name: profile.name,
              message_text: incomingText || "[Voice Message]",
              timestamp: new Date().toISOString()
            });

            // কাস্টমার ভয়েস মেসেজ চেয়েছেন কি না ডিটেক্ট
            const isVoiceRequested = userSentAudio || /ভয়েস|ভয়েস|audio|voice|কথা বলো|শুনতে চাই/i.test(incomingText || "");

            // Gemini AI কল (session, chatHistory, incomingAudioBuffer সহ)
            const aiDecision = await callGeminiSalesAI(userPromptText, session.messages, session, incomingAudioBuffer, audioMimeType);

            if (aiDecision && aiDecision.reply) {
              console.log(`🤖 [AI Reply to ${profile.name}]: ${aiDecision.reply.substring(0, 80)}...`);

              // 🔊 প্রতিটি টেক্সট মেসেজের নিচে [ 🔊 ভয়েস শুনুন ] বাটন বাধ্যতামূলকভাবে সংযুক্ত করা
              const audioIdForButton = aiDecision.audio_id || `aud_fallback_${Date.now()}`;
              const quickReplies = [
                {
                  content_type: "text",
                  title: "🔊 ভয়েস শুনুন",
                  payload: `PLAY_AUDIO_${audioIdForButton}`
                }
              ];

              // যদি ইউজার সরাসরি ভয়েস মেসেজ পাঠিয়ে থাকেন -> সরাসরি অডিও ভয়েস মেসেজ পাঠানো
              if (isVoiceRequested && aiDecision.audio_url) {
                await sendFacebookAudio(senderId, aiDecision.audio_url);
              }

              // টেক্সট মেসেজ পাঠানো (সাথে [ 🔊 ভয়েস শুনুন ] কুইক রিপ্লাই বাটন)
              await sendFacebookMessage(senderId, aiDecision.reply, quickReplies);

              // 🃏 প্রোডাক্ট কার্ড ভিউ (Image + Title + Price + Order Button)
              const { productsList } = await getStoreCatalog();
              const matchedProduct = findMatchingProduct(aiDecision.reply, productsList) || session.last_discussed_product || null;

              if (matchedProduct) {
                session.last_discussed_product = matchedProduct;
                // যদি মেসেজে কোনো প্রোডাক্ট নিয়ে কথা হয়, সুন্দর ফেসবুক কার্ড ভিউ পাঠানো
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

            // ১. যদি নতুন অর্ডার কনফার্ম হয় -> প্রথমবারেই তাৎক্ষণিক টেলিগ্রাম অ্যালার্ট
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

            // ২. যদি ১৫ মিনিটের মধ্যে কাস্টমার অর্ডার পরিবর্তন / সংশোধন করে
            if (aiDecision.order_updated && aiDecision.order_data) {
              session.last_order_data = {
                ...(session.last_order_data || {}),
                ...aiDecision.order_data,
                customer_name: aiDecision.order_data.customer_name || profile.name
              };
              session.last_order_time = Date.now();
              session.last_order_cancelled = false;

              console.log(`🔄 [ORDER UPDATED! Sending Telegram Alert...]`);
              await sendTelegramOrderUpdate(session.last_order_data, "Facebook Messenger");

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
                    status: "updated"
                  })
                }).catch(() => {});
              }
            }

            // ৩. যদি কাস্টমার অর্ডার বাতিল করে
            if (aiDecision.order_cancelled) {
              const cancelledOrder = session.last_order_data || {
                customer_name: profile.name,
                customer_phone: "",
                product_name: "পূর্বের অর্ডার",
                total_amount: 0
              };
              session.last_order_cancelled = true;

              console.log(`❌ [ORDER CANCELLED! Sending Telegram Alert...]`);
              await sendTelegramOrderCancel(cancelledOrder, aiDecision.note, "Facebook Messenger");

              if (CONFIG.workerUrl) {
                fetch(`${CONFIG.workerUrl}/api/orders`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: chatId,
                    platform: "facebook",
                    customer_name: cancelledOrder.customer_name,
                    customer_phone: cancelledOrder.customer_phone || "",
                    status: "cancelled",
                    cancel_reason: aiDecision.note
                  })
                }).catch(() => {});
              }
            }

            // ৪. যদি ১৫ মিনিট পর কাস্টমার পরিবর্তন করতে চায় (জরুরি নোট অ্যালার্ট)
            if (aiDecision.order_note && aiDecision.note) {
              await sendTelegramOrderNote(aiDecision.note, session.last_order_data || { customer_name: profile.name }, "Facebook Messenger");
            }

            memorySessions.set(chatId, session);

            // ক্লাউডফ্লেয়ার ড্যাশবোর্ডের সাথে চ্যাট হিস্ট্রি সিঙ্ক
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

        // খ. ফেসবুক পোস্ট কমেন্ট (Feed changes)
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
                  console.log(`✅ [Replied to Comment ${commentId}]`);
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
// 💬 CLOUDFLARE PAGES ড্যাশবোর্ড ইনবক্স API (automate.ranonex.shop)
// ==========================================

// ৪. সব লাইভ কনভারসেশনের তালিকা
app.get(['/api/conversations', '/api/live-conversations'], (req, res) => {
  const list = Array.from(memorySessions.values()).map(s => ({
    id: s.chat_id,
    sender_id: s.chat_id,
    name: s.sender_name || `Customer (${s.chat_id})`,
    sender_avatar: s.sender_avatar || "",
    platform: s.platform || "facebook",
    channel_type: s.channel_type || "messenger",
    last_message: s.last_message || "",
    last_message_at: s.last_message_at || new Date().toISOString(),
    unread_count: Number(s.unread_count || 0),
    admin_takeover: s.admin_takeover ? 1 : 0,
    messages_count: s.messages ? s.messages.length : 0
  })).sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));

  res.json(list);
});

// ৫. নির্দিষ্ট চ্যাট মেসেজ হিস্ট্রি
app.get('/api/conversations/:id', (req, res) => {
  const session = memorySessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

// ৬. ড্যাশবোর্ড থেকে ম্যানুয়াল অ্যাডমিন রিপ্লাই পাঠানো
app.post(['/api/send-reply', '/api/messages/send'], async (req, res) => {
  const { chat_id, message_text } = req.body || {};
  if (!chat_id || !message_text) return res.status(400).json({ error: "Missing chat_id or message_text" });

  const fbResult = await sendFacebookMessage(chat_id, message_text);
  let session = memorySessions.get(chat_id);
  if (!session) {
    session = {
      chat_id,
      sender_name: "Customer",
      sender_avatar: "",
      platform: "facebook",
      messages: []
    };
  }

  session.messages.push({
    id: `admin_${Date.now()}`,
    sender_type: "assistant",
    sender_name: "Admin",
    message_text: message_text,
    timestamp: new Date().toISOString()
  });
  session.last_message = message_text;
  session.last_message_at = new Date().toISOString();
  session.unread_count = 0;
  memorySessions.set(chat_id, session);

  if (CONFIG.workerUrl) {
    fetch(`${CONFIG.workerUrl}/api/sync-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id,
        sender_name: session.sender_name,
        sender_avatar: session.sender_avatar,
        platform: "facebook",
        last_message: message_text,
        messages: session.messages,
        unread_count: 0
      })
    }).catch(() => {});
  }

  res.json({ success: true, result: fbResult });
});

// ৭. অ্যাডমিন টেকওভার টগল
app.post('/api/toggle-takeover', (req, res) => {
  const { chat_id, enable } = req.body || {};
  const session = memorySessions.get(chat_id);
  if (session) {
    session.admin_takeover = Boolean(enable);
  }
  res.json({ success: true, chat_id, admin_takeover: session ? session.admin_takeover : enable });
});

// ৮. আনরিড মার্ক অ্যাজ রিড API
app.post('/api/conversations/mark-read', (req, res) => {
  const { chat_id } = req.body || {};
  const session = memorySessions.get(chat_id);
  if (session) {
    session.unread_count = 0;
  }
  res.json({ success: true, chat_id });
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

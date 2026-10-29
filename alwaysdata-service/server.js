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
  geminiModel: process.env.GEMINI_MODEL || "models/gemini-3.8-live",
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

// ইন-মেমোরি চ্যাট হিস্ট্রি (ডিস্ক পারসিস্টেন্স সহ - Zero D1 Architecture), অডিও ক্যাশ, প্রোডাক্ট ক্যাশ
const memorySessions = new Map();
const SESSIONS_FILE = path.join(__dirname, 'sessions_store.json');
let saveSessionsTimer = null;

function loadSessionsFromDisk() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const [k, v] of parsed) {
          if (k && v && typeof v === 'object') memorySessions.set(k, v);
        }
        console.log(`💾 [Alwaysdata Disk Store] Loaded ${memorySessions.size} chat session(s) from sessions_store.json`);
      }
    }
  } catch (e) {
    console.error("Failed to load sessions_store.json:", e.message);
  }
}

function persistSessionsToDisk() {
  if (saveSessionsTimer) clearTimeout(saveSessionsTimer);
  saveSessionsTimer = setTimeout(() => {
    try {
      const entries = Array.from(memorySessions.entries());
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(entries), 'utf8');
    } catch (e) {
      console.error("Failed to write sessions_store.json:", e.message);
    }
  }, 400);
}

function saveSession(chatId, session) {
  if (!chatId || !session) return;
  session.chat_id = chatId;
  if (!session.last_message_at) session.last_message_at = new Date().toISOString();
  if (Array.isArray(session.messages) && session.messages.length > 0) {
    const lastMsg = session.messages[session.messages.length - 1];
    if (lastMsg?.message_text) session.last_message = lastMsg.message_text;
    if (lastMsg?.timestamp) session.last_message_at = lastMsg.timestamp;
  }
  memorySessions.set(chatId, session);
  persistSessionsToDisk();
}

loadSessionsFromDisk();

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
  const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${CONFIG.geminiApiKey}`;
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
    .replace(/PRODUCT_IDS\s*:\s*[^\r\n]*/gi, "")
    .replace(/SHOW_HELPLINE\s*:\s*[^\r\n]*/gi, "")
    .replace(/\[(?:ACTIVE ORDER SELECTION|SINGLE PRODUCT UNDER DISCUSSION|NOTE FOR AI|PERSONALIZED ABANDONED INQUIRY FOLLOW-UP|AUTOMATED 15-MINUTE FOLLOW-UP)[\s\S]*?\]/gi, "")
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

  // ২. সরাসরি লেবেল ভিত্তিক পার্সিং (বাংলা, ইংরেজি ও বাংলিশ)
  const nameMatch = text.match(/(?:👤\s*)?(?:নাম|name|nam|নেম)\s*[:ঃ-]?\s*([^\r\n,;]+)/i);
  if (nameMatch) {
    const candidateName = nameMatch[1].replace(/\b(?:মোবাইল|ফোন|নাম্বার|নম্বর|number|phone|mobile|num|mob)\s*[:ঃ-]?\s*$/i, '').trim();
    if (candidateName && candidateName !== "..." && !candidateName.startsWith("<")) {
      name = candidateName;
    }
  }

  const addrMatch = text.match(/(?:📍\s*)?(?:ঠিকানা|address|addr|thika?na|লোকেশন|location)\s*[:ঃ-]?\s*([^\r\n]+)/i);
  if (addrMatch) {
    const candidateAddr = addrMatch[1].trim();
    if (candidateAddr && candidateAddr !== "..." && !candidateAddr.startsWith("<")) {
      address = candidateAddr;
    }
  }

  // ৩. যদি ফোন থাকে কিন্তু নাম বা ঠিকানা না থাকে, ফোন বাউন্ডারি দিয়ে আলাদা করা
  if (phone && (!name || !address)) {
    const rawDigits = phone;
    const phoneIdx = text.search(new RegExp(`(?:\\+?88)?0?${rawDigits.slice(-10)}`));
    if (phoneIdx !== -1) {
      const before = text.substring(0, phoneIdx).trim();
      const after = text.substring(phoneIdx + 11).trim();

      if (!name && before) {
        const cleanBefore = before
          .replace(/^(?:👤\s*)?(?:নাম|name|nam|নেম)\s*[:ঃ-]?\s*/i, '')
          .replace(/(?:[\r\n,;]+|\b(?:মোবাইল|ফোন|নাম্বার|নম্বর|number|phone|mobile|num|mob|phn|no)\s*[:ঃ-]?\s*)+$/i, '')
          .replace(/[,\r\n;]+$/, '')
          .trim();
        if (cleanBefore.length >= 2 && cleanBefore.length < 40 && !/ঢাকা|চট্টগ্রাম|কুমিল্লা|গ্রাম|রোড/i.test(cleanBefore)) {
          name = cleanBefore;
        }
      }
      if (!address && after) {
        const cleanAfter = after
          .replace(/^(?:📍\s*)?(?:ঠিকানা|address|addr|thika?na|লোকেশন|location)\s*[:ঃ-]?\s*/i, '')
          .replace(/^[,\r\n;]+/, '')
          .trim();
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
      const clean = line.replace(/^(?:নাম|name|nam|নেম|ঠিকানা|address|addr|thika?na|মোবাইল|ফোন|নাম্বার|নম্বর|number|phone|mobile)\s*[:ঃ-]?\s*/i, '').trim();
      if (!address && (/ঢাকা|কুমিল্লা|চট্টগ্রাম|রাজশাহী|সিলেট|খুলনা|বরিশাল|রংপুর|বাসা|রোড|গ্রাম|থানা|জেলা|পোস্ট|উপজেলা|sector|block|house|road|village|post|dhaka|cumilla|chittagong|moshjid|masjid|villa/i.test(line) || clean.length > 15)) {
        if (!/প্রোডাক্ট|সর্বমোট|কনফার্ম|অনুগ্রহ|পরবর্তী/i.test(clean)) {
          address = clean;
        }
      } else if (!name && clean.length >= 2 && clean.length < 35 && !/অর্ডার|order|confirm|দাম|টাকা|চাই|নেব|product|01[3-9]|প্রোডাক্ট|সর্বমোট|কনফার্ম/i.test(clean)) {
        name = clean;
      }
    }
  }

  return { name, phone, address };
}

// ==========================================
// ⚡ বুলেটপ্রুফ অর্ডার অ্যাকশন ও ফার্স্ট-টার্ন ডিটেক্টর
// ==========================================
function extractOrderActions(raw, replyText = "", messages = [], activeProduct = null, productsList = []) {
  let order_confirmed = false;
  let order_updated = false;
  let order_cancelled = false;
  let order_note = false;
  let order_data = null;
  let note = "";

  // মেসেজ হিস্ট্রি ও বর্তমান রিপ্লাই থেকে কাস্টমারের দেওয়া ফোন, নাম ও ঠিকানা বের করা
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

  if (replyText) {
    const parsedFromReply = parseOrderDetailsFromText(replyText);
    if (!foundPhone && parsedFromReply.phone) foundPhone = parsedFromReply.phone;
    if (!foundName && parsedFromReply.name) foundName = parsedFromReply.name;
    if (!foundAddress && parsedFromReply.address) foundAddress = parsedFromReply.address;
  }

  // ১. ORDER_JSON মার্কার চেক
  let orderJsonObj = null;
  const orderMatch = raw.match(/ORDER_JSON:\s*(\{[\s\S]*?\})/i);
  if (orderMatch) {
    try {
      const p = JSON.parse(orderMatch[1]);
      orderJsonObj = p;
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

  // ২. প্রথম টার্নেই কনফার্মেশন যাচাই (হয়েছে এবং হয়েছে উভয় ইউনিকোড সাপোর্ট সহ)
  const isAlreadyConfirmedReminder = /(?:আগেই|ইতিমধ্যে|ইতিপূর্বে)\s*(?:আপনার\s*)?(?:অর্ডার(?:টি)?\s*)?(?:কনফার্ম|নিশ্চিত)/i.test(replyText);
  const isConfirmSpoken = (orderJsonObj && (orderJsonObj.order_confirmed === true || orderJsonObj.order_confirmed === "true"))
    || (!isAlreadyConfirmedReminder && /(?:অর্ডার(?:টি)?\s*(?:সফলভাবে\s*)?(?:কনফার্ম|নিশ্চিত|গ্রহণ)(?:\s*করা)?\s*(?:হ(?:য়ে|য়ে)ছে|হলো|হল|করেছি|নিলাম)|অর্ডার(?:টি)?\s*(?:সফলভাবে\s*)?(?:কনফার্ম|কনফার্মড)|order\s*(?:is\s*)?confirmed|📋\s*আপনার\s*অর্ডারের\s*তথ্যসমূহ)/i.test(replyText));

  // ৩. কঠোর সত্যতা যাচাই: ফোন নম্বর (১১ ডিজিট), ডেলিভারি ঠিকানা এবং বৈধ প্রোডাক্ট থাকলেই কেবল কনফার্ম হবে
  const hasPhone = foundPhone && foundPhone.length >= 11;
  const hasAddress = foundAddress && foundAddress.length >= 4 && foundAddress !== "ইনবক্সে প্রদত্ত ঠিকানা";
  const matchedFromReply = (!activeProduct && Array.isArray(productsList) && productsList.length > 0)
    ? (findMatchingProduct(replyText, productsList) || findMatchingProduct(raw, productsList))
    : null;
  const targetProduct = activeProduct || matchedFromReply || (orderJsonObj?.product_name && orderJsonObj.product_name !== "Ranonex Store Product" ? {
    id: orderJsonObj.product_id || "prod_custom",
    name: orderJsonObj.product_name,
    price: orderJsonObj.total_amount || 0,
    url: orderJsonObj.product_url || "https://ranonex.shop"
  } : null);
  const hasValidProduct = targetProduct && targetProduct.name && targetProduct.name !== "Ranonex Store Product";

  if (isConfirmSpoken && hasPhone && hasAddress && hasValidProduct) {
    const isDhaka = /ঢাকা|dhaka/i.test(foundAddress) && !/ঢাকার\s*বাইরে|outside/i.test(foundAddress);
    const deliveryCharge = isDhaka ? 70 : 130;
    const basePrice = parseFloat(targetProduct.price || 0);
    const total = basePrice > 0 ? (basePrice + deliveryCharge) : (orderJsonObj?.total_amount || 0);

    order_confirmed = true;
    order_data = {
      order_confirmed: true,
      product_id: orderJsonObj?.product_id || targetProduct.id,
      product_name: targetProduct.name,
      product_url: targetProduct.url || `https://ranonex.shop/product.html?id=${encodeURIComponent(targetProduct.id)}`,
      customer_name: foundName || "Customer",
      customer_phone: foundPhone,
      delivery_address: foundAddress,
      variant: orderJsonObj?.variant || "Standard",
      order_summary: orderJsonObj?.order_summary || orderJsonObj?.summary || orderJsonObj?.note || "",
      total_amount: total
    };
    console.log(`🎉 [Auto-Detected Real Order Confirmation]: Customer "${order_data.customer_name}", Phone "${foundPhone}", Product "${targetProduct.name}", Total ৳${total}`);
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

          const stripHtml = (s) => String(s || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const cleanDesc = stripHtml(p.description).slice(0, 400);
          const cleanSpecs = stripHtml(p.specifications).slice(0, 200);

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
          productsList.push(pObj);

          catalog += `- PRODUCT_ID: ${p.id} | ${p.name}
    * PRICE: ৳${price}
    * LINK: ${link}
    * CATEGORY: ${p.category || '-'}
    * SPECS: ${cleanSpecs || '-'}
    * DETAILS: ${cleanDesc || '-'}\n`;
        }
      }
    }
  } catch (err) {
    console.warn("Product fetch warning:", err.message);
  }

  productCatalogCache = { data: catalog, productsList, expiresAt: now + 10 * 60 * 1000 };
  return productCatalogCache;
}

// 🔍 কোনো হার্ডকোডেড কীওয়ার্ড নেই — কোন প্রোডাক্ট কাস্টমারের দরকার তা AI নিজেই ক্যাটালগ দেখে ঠিক করে।
// এখানে শুধু নিশ্চিত (exact) মিল খোঁজা হয়: প্রোডাক্ট আইডি, SKU, প্রোডাক্ট URL বা হুবহু প্রোডাক্টের নাম।
function findMatchingProduct(text, productsList) {
  if (!text || !Array.isArray(productsList) || productsList.length === 0) return null;
  const lower = String(text).toLowerCase();

  const urlIds = [...lower.matchAll(/product\.html\?id=([\w\-]+)/g)].map(m => m[1]);
  for (const id of urlIds) {
    const p = productsList.find(x => String(x.id).toLowerCase() === id);
    if (p) return p;
  }
  for (const p of productsList) {
    const id = String(p.id || '').toLowerCase();
    if (id && new RegExp(`(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`).test(lower)) return p;
    if (p.sku && p.sku.length > 3 && lower.includes(p.sku.toLowerCase())) return p;
    if (p.name && p.name.length > 6 && lower.includes(p.name.toLowerCase())) return p;
  }
  return null;
}

// 🤖 AI-এর রিপ্লাই থেকে AI-নির্বাচিত প্রোডাক্টগুলো বের করা (PRODUCT_IDS মার্কার + রিপ্লাইতে থাকা প্রোডাক্ট URL)
function extractAIProducts(raw, productsList) {
  if (!raw || !Array.isArray(productsList) || productsList.length === 0) return [];
  const ids = [];
  const marker = String(raw).match(/PRODUCT_IDS\s*:\s*([^\n]+)/i);
  if (marker) {
    marker[1].split(/[,\s]+/).map(s => s.trim().replace(/[\[\]"'.]/g, '')).filter(Boolean).forEach(id => ids.push(id.toLowerCase()));
  }
  for (const m of String(raw).matchAll(/product\.html\?id=([\w\-]+)/gi)) {
    ids.push(m[1].toLowerCase());
  }
  const out = [];
  for (const id of ids) {
    const p = productsList.find(x => String(x.id).toLowerCase() === id);
    if (p && !out.some(o => o.id === p.id)) out.push(p);
  }
  return out;
}

// ==========================================
// 💡 স্মার্ট কনটেক্সচুয়াল কুইক রিপ্লাই বাটন বিল্ডার
// ==========================================
function buildContextualQuickReplies(session, aiDecision, audioId) {
  const quickReplies = [];

  // ১. যদি অর্ডার কনফার্ম থাকে (১৫ মিনিটের মধ্যে তথ্য পরিবর্তন ও সাপোর্ট বাটন)
  if (aiDecision.order_confirmed || (session.last_order_data && !session.last_order_cancelled)) {
    quickReplies.push({ content_type: "text", title: "🔄 তথ্য পরিবর্তন", payload: "ACTION_EDIT_ORDER" });
    quickReplies.push({ content_type: "text", title: "📞 হেল্পলাইনে কল", payload: "ACTION_CALL_SUPPORT" });
    quickReplies.push({ content_type: "text", title: "❌ বাতিল", payload: "ACTION_CANCEL_ORDER" });
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
// 🤖 GEMINI 3.8 LIVE MULTIMODAL PERSISTENT WEBSOCKET ENGINE
// (WebSocket Session Reuse via ws.send() + Multimodal Image Vision)
// ==========================================
async function callGeminiSalesAI(
  incomingText,
  chatHistory = [],
  session = null,
  incomingAudioBuffer = null,
  audioMimeType = "audio/mp4",
  incomingImageBuffer = null,
  imageMimeType = "image/jpeg",
  incomingVideoBuffer = null,
  videoMimeType = "video/mp4"
) {
  if (!CONFIG.geminiApiKey || CONFIG.geminiApiKey === "YOUR_GEMINI_API_KEY") {
    await syncCredentialsFromWorker();
  }

  const { data: catalog, productsList } = await getStoreCatalog();

  // অর্ডার টাইম উইন্ডো চেক (১৫ মিনিটের মধ্যে পরিবর্তন/বাতিল)
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
  Never ask "কোন প্রোডাক্টটি নিতে চান?" when only this 1 product was discussed!]`;
  }

  const isFirstMessage = !Array.isArray(chatHistory) || chatHistory.length <= 1;

  const systemInstruction = `You are a real, friendly sales person chatting on the Facebook page of 'Ranonex' (online store in Bangladesh, https://ranonex.shop). You talk like a helpful human shop assistant, NOT like a robot.

LANGUAGE:
- Always reply in natural, simple Bengali script (বাংলা লিপি), even if the customer writes in Banglish or English.
- Write the brand name only in English: "Ranonex".
- ${isFirstMessage ? `If the customer just greets (hi/hello/salam), greet back warmly in one short line and ask what they are looking for.` : `Do NOT introduce yourself again. Continue the conversation naturally.`}

HOW TO FIND THE RIGHT PRODUCT (you decide, nobody else):
- The full live catalog of the store is given below as STORE PRODUCTS CATALOG. It changes often and new products get added — always rely on it.
- Understand what the customer actually NEEDS (their problem / purpose), not just the exact word. Banglish, typos, indirect requests are normal.
  e.g. "ghor shajabo / room decor" -> decoration items like neon/LED lights; "phone gorom hoy" -> mobile cooler; "gaming er jonno" -> game console / gaming earphone; "shiter jama" -> hoodie; "panjabi" -> panjabi collection.

- FULL CATALOG SEARCH & SCOURING MANDATE (MUST FIND & SHOW ALL MATCHING PRODUCTS):
  CRITICAL: If the customer asks about a category or general product type without naming a specific model (e.g. "পাঞ্জাবি আছে?", "পাঞ্জাবি দেখান", "আপনাদের কি পাঞ্জাবি আছে?", "ঘড়ি আছে?", "গেম কনসোল আছে?", "হুডি আছে?", "হেডফোন আছে?"):
  You MUST scour and search the ENTIRE 'STORE PRODUCTS CATALOG' from top to bottom!
  You MUST find and include EVERY SINGLE MATCHING PRODUCT from the catalog (e.g. if there are 5 Panjabis in the catalog: pj-100, pj-101, pj-102, pj-103, pj-104, YOU MUST INCLUDE ALL 5 PANJABIS — NEVER leave any out, and NEVER show only 1 or 2)!
  How to present multiple products from a category:
  1. Write a short, warm intro in Bengali (e.g. "জী, আমাদের কালেকশনে বর্তমানে এই আকর্ষণীয় পাঞ্জাবিগুলো এভেইলেবল আছে:")
  2. Number each product clearly (১, ২, ৩, ৪, ৫...):
     • <নং>. <প্রোডাক্টের নাম> - <রং/ডিজাইন/কাপড় ও আকর্ষণীয় সুবিধা নিয়ে সংক্ষেপে ১ লাইনের বিবরণ>
     💰 অফার মূল্য: ৳<PRICE>/-
     🔗 <LINK>
  3. Shorten each product's description by 10-20% so the message is compact, clean, and easily scannable on mobile screens.
  4. End with a friendly ordering line: "যেটি আপনার পছন্দ হয়, সেটির নাম বা নম্বর লিখে আপনার নাম, মোবাইল নম্বর ও ঠিকানা দিলেই ক্যাশ অন ডেলিভারিতে অর্ডার কনফার্ম করে দেওয়া হবে।"
  5. MANDATORY: You MUST append ALL of their IDs in the trailing internal marker:
     PRODUCT_IDS: <id1>,<id2>,<id3>,<id4>,<id5>...
     This generates an interactive Messenger carousel slider with photos and buttons for EVERY single one of those products!
- If the customer asks for a specific single item, present that 1 product with the 1-2 line solution format.
- Never invent products, prices, or features that are not in the catalog.

HOW TO WRITE A SINGLE PRODUCT REPLY (short, minimal, solution-style):
- Keep it short — like a real chat message. No long lists of policies.
- Start by connecting to their need in a human way, then introduce the product as the solution.
- For each product:
  • Product name (as in catalog)
  • 1–2 lines explaining how it solves their problem, mentioning its special features from DETAILS/SPECS (e.g. "১০ মিটার লম্বা, অ্যাপ আর রিমোট দিয়ে রঙ বদলানো যায়")
  • Price: ৳<exact PRICE from catalog>
  • The product LINK from the catalog (always include it, on its own line)
- Then ONE short line telling them they can also order right here in the message by sending name, mobile number and address.
- Do NOT mention delivery charge, delivery time, cash on delivery, or return policy unless the customer asks about them. (If asked: Dhaka city ৳70, outside Dhaka ৳130, cash on delivery, can check parcel at delivery.)
- No headings, no "📌 প্রোডাক্ট:" style labels, no repetitive closing questions. At most 1–2 emojis.

PRODUCT_IDS MARKER (internal, mandatory):
- Whenever your reply talks about or recommends any product(s), add this as the very LAST line of your reply:
  PRODUCT_IDS: <id1>,<id2>,...
  using the exact PRODUCT_ID values from the catalog. The system removes this line and shows the customer a product card/carousel. Never mention it.

HELPLINE & DIRECT SUPPORT (internal marker):
- ONLY output SHOW_HELPLINE: true if the customer explicitly asks how to contact, asks for WhatsApp or helpline phone number, or explicitly wants to talk to a human / owner / support (e.g. "আপনাদের সাথে কীভাবে যোগাযোগ করব?", "হোয়াটসঅ্যাপ নম্বর কত?", "হেল্পলাইন বা কাস্টমার কেয়ার নম্বর দিন", "সরাসরি কথা বলতে চাই").
  When requested, politely tell them in 1 line they can call or WhatsApp our official helpline: 01874600203, and add this marker at the very end:
  SHOW_HELPLINE: true
- CRITICAL (NEVER SHOW HELPLINE ON ORDER OR PHONE NUMBER):
  When a customer provides their phone number (e.g. "016...", "amar number 01...", "আমার নম্বর 01...") or is placing an order, DO NOT output SHOW_HELPLINE: true!
  They are providing their contact number to receive the product parcel, NOT asking for customer care. Confirm their order immediately or ask for the missing address/details.

ORDER TAKING & STRICT CONFIRMATION (AI CONFIRMS DIRECTLY WITH INVOICE FORM REVIEW):
- CRITICAL: You (the AI) MUST CONFIRM THE ORDER DIRECTLY, CONFIDENTLY, AND IMMEDIATELY! Do NOT hesitate, do NOT ask the customer to confirm again, and do NOT ask for details you already have!
- SINGLE PRODUCT OR PREVIOUSLY DISCUSSED PRODUCT:
  If only 1 product was discussed, or the customer selected/mentioned a product earlier:
  THE CUSTOMER DOES NOT NEED TO REPEAT OR CHOOSE THE PRODUCT AGAIN!
  You already know which product they want. DO NOT ask "কোন প্রোডাক্টটি নিতে চান?" or "কোনটি নিবেন?"!
- AS SOON AS YOU HAVE: Product + Customer Name + 11-digit Phone (01XXXXXXXXX) + Delivery Address (whether provided in one message or collected over earlier turns):
  YOU MUST CONFIRM THE ORDER IMMEDIATELY IN THAT VERY TURN!
  Your reply message MUST be formatted with this exact structured form-style invoice review:

ধন্যবাদ [Customer Name]! আপনার অর্ডারটি সফলভাবে কনফার্ম করা হয়েছে।

📋 আপনার অর্ডারের তথ্যসমূহ (রিভিউ):
━━━━━━━━━━━━━━━━━━━
📦 প্রোডাক্ট: <Product Name from Catalog>
👤 নাম: <Customer Name>
📞 মোবাইল: <Customer 11-digit Phone Number>
📍 ঠিকানা: <Customer Delivery Address>
💰 সর্বমোট প্রদেয় মূল্য: ৳<Product Price + Delivery Charge (70 for Dhaka, 130 outside Dhaka)>/- (ক্যাশ অন ডেলিভারি)
━━━━━━━━━━━━━━━━━━━
অনুগ্রহ করে উপরের তথ্যগুলো একবার মিলিয়ে দেখে নিন। পরবর্তী ১৫ মিনিটের মধ্যে নাম, মোবাইল নম্বর বা ডেলিভারি ঠিকানায় কোনো পরিবর্তন প্রয়োজন হলে আমাদের এখানে লিখে জানাতে পারেন।

- Do NOT highlight cancellation ("বাতিল") prominently; keep the tone focused on verifying details and giving 15 minutes window for any updates or corrections.
- At the very bottom of that confirmation message output (internal):
  ORDER_JSON: {"order_confirmed": true, "product_id": "<PRODUCT_ID>", "product_name": "<PRODUCT_NAME>", "customer_name": "<CUSTOMER_NAME>", "customer_phone": "<CUSTOMER_PHONE>", "delivery_address": "<DELIVERY_ADDRESS>", "variant": "Standard", "total_amount": <TOTAL_AMOUNT>, "order_summary": "<2-3 sentences in Bengali for the shop owner: who ordered what, any size/color/variant or special request the customer mentioned, how the conversation went, anything delivery team should know>"}

EDIT & CANCEL:
- Edit within 15 minutes -> confirm briefly and output:
  ORDER_UPDATE_JSON: {"order_updated": true, "customer_name": "...", "customer_phone": "...", "delivery_address": "...", "product_name": "...", "variant": "...", "total_amount": 0}
- Cancel -> confirm briefly and output:
  ORDER_CANCEL_JSON: {"order_cancelled": true, "customer_name": "...", "customer_phone": "...", "product_name": "...", "reason": "..."}

MULTIMODAL PHOTOS, VIDEOS & AUDIO:
- If the customer sends a photo/screenshot or video, inspect it carefully, find the matching or closest product from our catalog, and reply with its name, exact price, key features, link, and how to order.
- If the customer sends an audio voice note, listen carefully to their spoken words and reply directly to what they said in Bengali.

IMPORTANT: PRODUCT_IDS, ORDER_JSON, ORDER_UPDATE_JSON, ORDER_CANCEL_JSON, ORDER_NOTE_JSON, SHOW_HELPLINE are internal markers only. Put them at the end, never inside customer sentences.

${orderTimeContext}
${productsDiscussionContext}

STORE PRODUCTS CATALOG:
${catalog}`;

  const chatId = session?.sender_id ? `fb_${session.sender_id}` : "default";
  const modelId = CONFIG.geminiModel || "models/gemini-3.8-live";

  // টার্নস প্রস্তুতি (হিস্ট্রি + বর্তমান মেসেজ + ছবি + ভিডিও + অডিও)
  const currentParts = [];
  if (incomingImageBuffer) {
    let cleanImageMime = (imageMimeType || "image/jpeg").split(';')[0].trim();
    if (!cleanImageMime.startsWith("image/")) cleanImageMime = "image/jpeg";
    currentParts.push({
      inlineData: {
        mimeType: cleanImageMime,
        data: incomingImageBuffer.toString('base64')
      }
    });
  }
  if (incomingVideoBuffer) {
    let cleanVideoMime = (videoMimeType || "video/mp4").split(';')[0].trim();
    if (!cleanVideoMime.startsWith("video/")) cleanVideoMime = "video/mp4";
    currentParts.push({
      inlineData: {
        mimeType: cleanVideoMime,
        data: incomingVideoBuffer.toString('base64')
      }
    });
  }
  if (incomingAudioBuffer) {
    let cleanAudioMime = (audioMimeType || "audio/mp4").split(';')[0].trim();
    if (!cleanAudioMime.startsWith("audio/")) cleanAudioMime = "audio/mp4";
    currentParts.push({
      inlineData: {
        mimeType: cleanAudioMime,
        data: incomingAudioBuffer.toString('base64')
      }
    });
  }

  // অ্যাক্টিভ অর্ডার কনটেক্সট যুক্ত করা যাতে সকেট রিউজে কোনো লুপ তৈরি না হয়
  let turnPrompt = incomingText ? incomingText.trim() : "";
  if (session?.selected_order_product) {
    turnPrompt = `[ACTIVE ORDER SELECTION: The customer has already chosen '${session.selected_order_product.name}' (Price: ৳${session.selected_order_product.price}). DO NOT ask which product they want. If they provide name, 11-digit phone (01XXXXXXXXX) and address, confirm the order for '${session.selected_order_product.name}' immediately!] ${turnPrompt}`;
  } else if (activeProduct && (!session?.discussed_products || session.discussed_products.length <= 1)) {
    turnPrompt = `[SINGLE PRODUCT UNDER DISCUSSION: '${activeProduct.name}' (Price: ৳${activeProduct.price}). If customer sends phone/address, confirm this product immediately!] ${turnPrompt}`;
  }

  if (turnPrompt.trim()) {
    currentParts.push({ text: turnPrompt.trim() });
  } else if (currentParts.length === 0) {
    currentParts.push({ text: "Hello" });
  }

  // ==========================================
  // ⚡ মোড ১: অ্যাক্টিভ লাইভ সকেট রি-ইউজ (Persistent Socket: ws.send() দিয়ে পরবর্তী মেসেজ)
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
          const actions = extractOrderActions(cached.accumulatedText, cleanReply, chatHistory, activeProduct, productsList);
          resolve({
            reply: cleanReply,
            rawReply: cached.accumulatedText,
            order_confirmed: actions.order_confirmed,
            order_updated: actions.order_updated,
            order_cancelled: actions.order_cancelled,
            order_note: actions.order_note,
            order_data: actions.order_data,
            note: actions.note,
            show_helpline: /SHOW_HELPLINE\s*:\s*true/i.test(cached.accumulatedText),
            audio_id: null,
            audio_url: null
          });
        }
      }, 30000);

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

          const cleanReply = cleanCustomerReply(accText) || "ধন্যবাদ! কীভাবে সাহায্য করতে পারি বলুন?";
          const actions = extractOrderActions(accText, cleanReply, chatHistory, activeProduct, productsList);

          resolve({
            reply: cleanReply,
            rawReply: accText,
            order_confirmed: actions.order_confirmed,
            order_updated: actions.order_updated,
            order_cancelled: actions.order_cancelled,
            order_note: actions.order_note,
            order_data: actions.order_data,
            note: actions.note,
            show_helpline: /SHOW_HELPLINE\s*:\s*true/i.test(accText),
            audio_id: audioId,
            audio_url: audioUrl
          });
        }
      };

      // ⚡ সরাসরি আগের ওপেন সকেটে নতুন টার্ন পাঠানো (কোনো নতুন হ্যান্ডশেক নয়)
      cached.ws.send(JSON.stringify({
        clientContent: {
          turns: [{ role: "user", parts: currentParts }],
          turnComplete: true
        }
      }));
      console.log(`⚡ [Reusing Persistent Live WebSocket for ${chatId} (${modelId})] Dispatched turn via ws.send()!`);
    });
  }

  // ==========================================
  // 🔌 মোড ২: নতুন লাইভ সকেট ওপেন ও সেশন পুলে পারসিস্টেন্ট সংরক্ষণ
  // ==========================================
  // পূর্ববর্তী কথোপকথন থেকে হিস্ট্রি টার্নস তৈরি (সর্বশেষ মেসেজটি বর্তমান টার্নে যাবে)
  const pastMessages = (Array.isArray(chatHistory) ? chatHistory : []).slice(0, -1);
  const turns = [];
  for (const m of pastMessages.slice(-6)) {
    const role = (m.sender_type === "assistant" || m.sender_type === "ai") ? "model" : "user";
    const text = (m.message_text || "").trim();
    if (!text) continue;
    if (turns.length > 0 && turns[turns.length - 1].role === role) {
      turns[turns.length - 1].parts[0].text += "\n" + text;
    } else {
      turns.push({ role, parts: [{ text }] });
    }
  }

  // নিশ্চিত করা যে প্রথম টার্নটি user role
  if (turns.length > 0 && turns[0].role !== "user") {
    turns.shift();
  }
  // নিশ্চিত করা যে সর্বশেষ হিস্ট্রি টার্নটি model role যাতে বর্তমান টার্নটি user role হয়
  if (turns.length > 0 && turns[turns.length - 1].role === "user") {
    turns.pop();
  }

  // বর্তমান টার্নে সম্পূর্ণ currentParts (ছবি/ভিডিও/অডিও inlineData + প্রম্পট টেক্সট) অক্ষত অবস্থায় যুক্ত করা
  turns.push({ role: "user", parts: currentParts });

  return new Promise((resolve) => {
    // 🌐 v1alpha এন্ডপয়েন্ট (models/gemini-3.8-live শতভাগ সাপোর্ট করে)
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${CONFIG.geminiApiKey}`;
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
        const actions = extractOrderActions(socketEntry.accumulatedText, cleanReply, chatHistory, activeProduct, productsList);
        resolve({
          reply: cleanReply,
          rawReply: socketEntry.accumulatedText,
          order_confirmed: actions.order_confirmed,
          order_updated: actions.order_updated,
          order_cancelled: actions.order_cancelled,
          order_note: actions.order_note,
          order_data: actions.order_data,
          note: actions.note,
          show_helpline: /SHOW_HELPLINE\s*:\s*true/i.test(socketEntry.accumulatedText),
          audio_id: null,
          audio_url: null
        });
      }
    }, 30000);

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

        const cleanReply = cleanCustomerReply(accText) || "ধন্যবাদ! কীভাবে সাহায্য করতে পারি বলুন?";
        const actions = extractOrderActions(accText, cleanReply, chatHistory, activeProduct, productsList);

        resolve({
          reply: cleanReply,
          rawReply: accText,
          order_confirmed: actions.order_confirmed,
          order_updated: actions.order_updated,
          order_cancelled: actions.order_cancelled,
          order_note: actions.order_note,
          order_data: actions.order_data,
          note: actions.note,
          show_helpline: /SHOW_HELPLINE\s*:\s*true/i.test(accText),
          audio_id: audioId,
          audio_url: audioUrl
        });
      }
    };

    ws.onopen = () => {
      console.log(`🔌 [Opening Persistent Live WebSocket for ${chatId}]: Model: ${modelId}`);
      const setupPayload = {
        setup: {
          model: modelId,
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
        const rawText = event.data instanceof Blob ? await event.data.text() : (event.data?.toString ? event.data.toString() : event.data);
        const msg = JSON.parse(rawText);

        if (msg.setupComplete !== undefined) {
          socketEntry.isReady = true;
          socketEntry.lastActive = Date.now();
          console.log(`✅ [WebSocket Setup Handshake Complete for ${chatId}]: Socket locked open!`);

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
      } catch (err) {
        console.error("Live WS Message parse error:", err.message);
      }
    };

    ws.onerror = (e) => {
      console.error("[Gemini 3.8 Live] WebSocket error:", e.message || e);
      activeLiveSockets.delete(chatId);
    };

    ws.onclose = (ev) => {
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

  const prodUrl = order.product_url || (order.product_id ? `https://ranonex.shop/product.html?id=${encodeURIComponent(order.product_id)}` : 'https://ranonex.shop');

  const text = `🎉 [নতুন অর্ডার কনফার্ম হয়েছে - ${platform}]
━━━━━━━━━━━━━━━━━━━
📝 AI অর্ডার সামারি ও নোট:
${order.order_summary ? order.order_summary : `কাস্টমার ইনবক্সে সরাসরি ${order.product_name} পছন্দ করে ক্যাশ অন ডেলিভারিতে অর্ডার নিশ্চিত করেছেন।`}
━━━━━━━━━━━━━━━━━━━
📋 কাস্টমার ও ডেলিভারি বিবরণ:
👤 কাস্টমার: ${order.customer_name || 'N/A'}
📞 মোবাইল: ${order.customer_phone || 'N/A'}
📍 ঠিকানা: ${order.delivery_address || 'N/A'}
📦 প্রোডাক্ট: ${order.product_name || 'N/A'}
🎨 ভ্যারিয়েন্ট: ${order.variant || 'Standard'}
💰 সর্বমোট: ৳${order.total_amount || 0}/- (ক্যাশ অন ডেলিভারি)
🔗 প্রোডাক্ট লিংক: ${prodUrl}
━━━━━━━━━━━━━━━━━━━
🚀 Ranonex AI Sales Engine`;

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

      // 🧠 AI দিয়ে কাস্টমারের চ্যাট হিস্ট্রি ও প্রোডাক্ট দেখে ১০০% পারসোনালাইজড ফলোআপ মেসেজ তৈরি
      let followUpText = "";
      try {
        const followUpPrompt = `[PERSONALIZED ABANDONED INQUIRY FOLLOW-UP]:
Customer Name: ${session.sender_name || 'গ্রাহক'}
Product: '${prod.name}' (Price: ৳${prod.price})
Review our chat conversation with this customer. Write a warm, personalized, caring 1-2 sentence follow-up check-in in natural Bengali script (বাংলা লিপি).
Acknowledge their inquiry about '${prod.name}', address any hesitation or questions they had, and politely remind them they can easily confirm their order right now with cash on delivery by providing their name, mobile number and address. Do not be aggressive or robotic.`;

        const aiFollowUp = await callGeminiSalesAI(
          followUpPrompt,
          session.messages,
          session
        );

        if (aiFollowUp && aiFollowUp.reply) {
          followUpText = cleanCustomerReply(aiFollowUp.reply);
        }
      } catch (aiErr) {
        console.error("AI Follow-up error:", aiErr.message);
      }

      if (!followUpText) {
        followUpText = `প্রিয় ${session.sender_name || 'গ্রাহক'}, আপনি Ranonex স্টোরে '${prod.name}' প্রোডাক্টটি পছন্দ করেছিলেন। আমাদের সীমিত স্টক দ্রুত শেষ হয়ে যাচ্ছে!\n\nআপনি কি পণ্যটি ক্যাশ অন ডেলিভারিতে অর্ডার করতে চান? নিচের বাটনে ট্যাপ করে খুব সহজেই অর্ডার সম্পন্ন করতে পারেন:`;
      }

      const quickReplies = [
        { content_type: "text", title: "🛍️ হ্যাঁ, অর্ডার করব", payload: "ACTION_ORDER_NOW" },
        { content_type: "text", title: "💰 ডেলিভারি চার্জ কত?", payload: "ACTION_DELIVERY_CHARGE" },
        { content_type: "text", title: "❌ পরে নেব", payload: "ACTION_ABANDONED_DECLINE" },
        { content_type: "text", title: "📞 হেল্পলাইনে কল", payload: "ACTION_CALL_SUPPORT" }
      ];

      await sendFacebookMessage(senderId, followUpText, quickReplies);
      await sendFacebookProductCard(senderId, prod);

      session.messages.push({
        id: `ai_followup_${Date.now()}`,
        sender_type: "assistant",
        sender_name: "Ranonex AI Assistant",
        message_text: followUpText,
        timestamp: new Date().toISOString()
      });
      memorySessions.set(chatId, session);
    }
  }
}, 60 * 1000); // প্রতি ১ মিনিটে চেক

// ==========================================
// 🌐 WEB ROUTES & WEBHOOKS
// ==========================================

// ১. ভিউয়েবল অ্যাডমিন ড্যাশবোর্ড ও হোয়াটসঅ্যাপ QR পোর্টাল (GET / ও /dashboard)
app.get(['/', '/dashboard', '/whatsapp', '/inbox'], (req, res) => {
  // যদি কোনো API ক্লায়েন্ট JSON চায় (?format=json)
  if (req.query.format === 'json') {
    return res.redirect('/api/status');
  }
  const dashPath = path.join(__dirname, 'dashboard.html');
  if (fs.existsSync(dashPath)) {
    return res.sendFile(dashPath);
  }
  res.send("Ranonex Alwaysdata Live Messaging Hub is Online.");
});

// ১.০৫ হেলথ চেক ও JSON স্ট্যাটাস (GET /status ও /api/status)
app.get(['/status', '/api/status'], (req, res) => {
  res.json({
    status: "online",
    server: "Alwaysdata High-Throughput Node.js Gateway (Zero-D1 Architecture)",
    uptime_seconds: Math.floor(process.uptime()),
    memory_usage_mb: (process.memoryUsage().rss / (1024 * 1024)).toFixed(1),
    total_messages_handled: totalMessagesHandled,
    active_sessions_count: memorySessions.size,
    channels: {
      facebook_messenger: Boolean(CONFIG.metaPageAccessToken),
      facebook_page_id: CONFIG.metaPageId,
      whatsapp_status: typeof waState !== 'undefined' ? waState.status : "initializing",
      whatsapp_phone: typeof waState !== 'undefined' ? waState.phone : null,
      whatsapp_personal_only: true,
      gemini_ai: Boolean(CONFIG.geminiApiKey),
      gemini_model: "models/gemini-3.8-live (Multimodal Live WebSocket Engine)",
      telegram_alerts: Boolean(CONFIG.telegramBotToken),
      audio_cache_count: audioCache.size,
      products_count: productCatalogCache.productsList?.length || 0,
      active_features: [
        "Zero-D1 Alwaysdata Direct Messaging & Disk Persistence",
        "Real WhatsApp Multi-Device QR Engine (Personal Chats Only)",
        "Viewable Admin Inbox & Direct Customer Reply Console",
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
            const userSentVideo = Boolean(message?.attachments && message.attachments.some(a => a.type === 'video'));

            const chatId = `fb_${senderId}`;
            let session = memorySessions.get(chatId);
            if (!session) {
              session = {
                chat_id: chatId,
                messages: [],
                sender_id: senderId,
                platform: "facebook",
                channel_type: "messenger",
                unread_count: 0,
                admin_takeover: false
              };
              memorySessions.set(chatId, session);
            }
            session.chat_id = chatId;
            session.sender_id = senderId;
            session.platform = "facebook";
            session.channel_type = "messenger";
            if (!Array.isArray(session.discussed_products)) {
              session.discussed_products = [];
            }
            if (session.last_discussed_product && !session.discussed_products.some(p => p.id === session.last_discussed_product.id)) {
              session.discussed_products.push(session.last_discussed_product);
            }

            const profile = await getFacebookUserProfile(senderId);
            session.sender_name = profile.name;
            if (profile.avatar) session.sender_avatar = profile.avatar;
            saveSession(chatId, session);

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
              memorySessions.set(chatId, session);
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
                session.discussed_products = [chosen];
                memorySessions.set(chatId, session);

                // পুরাতন সকেটের মাল্টি-প্রোডাক্ট হিস্ট্রি ক্লিয়ার যাতে মডেল নতুনভাবে শুধু এই প্রোডাক্টটি চেনে
                const oldWs = activeLiveSockets.get(chatId);
                if (oldWs?.ws) { try { oldWs.ws.close(); } catch(e){} }
                activeLiveSockets.delete(chatId);

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
                session.discussed_products = [matched];
                session.last_inquiry_time = Date.now();
                session.abandoned_reminder_sent = false;
                memorySessions.set(chatId, session);

                const oldWs = activeLiveSockets.get(chatId);
                if (oldWs?.ws) { try { oldWs.ws.close(); } catch(e){} }
                activeLiveSockets.delete(chatId);

                const text = `আপনি ${matched.name} প্রোডাক্টটি নির্বাচন করেছেন।\nবর্তমান অফার মূল্য: ৳${matched.price} (ক্যাশ অন ডেলিভারি)।\n\nঅর্ডারটি এখনই কনফার্ম করতে অনুগ্রহ করে আপনার:\n১. পুরো নাম\n২. ১১ ডিজিটের মোবাইল নম্বর\n৩. সম্পূর্ণ ডেলিভারি ঠিকানা লিখে পাঠিয়ে দিন।`;
                const qr = [
                  { content_type: "text", title: "📍 ঢাকার ভেতরে (৭০৳)", payload: "ACTION_LOCATION_DHAKA" },
                  { content_type: "text", title: "📍 ঢাকার বাইরে (১৩০৳)", payload: "ACTION_LOCATION_OUTSIDE" },
                  { content_type: "text", title: "🔊 ভয়েস শুনুন", payload: `PLAY_AUDIO_aud_${Date.now()}` }
                ];
                await sendFacebookMessage(senderId, text, qr);
                await sendFacebookProductCard(senderId, matched);

                session.messages.push({
                  id: `btn_${Date.now()}`,
                  sender_type: "customer",
                  sender_name: profile.name,
                  message_text: `[কাস্টমার প্রোডাক্ট নির্বাচন করেছেন]: ${matched.name}`,
                  timestamp: new Date().toISOString()
                });
                session.messages.push({
                  id: `ai_${Date.now()}`,
                  sender_type: "assistant",
                  sender_name: "Ranonex AI Assistant",
                  message_text: text,
                  timestamp: new Date().toISOString()
                });
                memorySessions.set(chatId, session);
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
                session.selected_order_product = matched;
                session.last_discussed_product = matched;
                session.discussed_products = [matched]; // পূর্ববর্তী একাধিক চয়েস ক্লিয়ার, যাতে কোনো লুপ তৈরি না হয়
                session.last_inquiry_time = Date.now();
                session.abandoned_reminder_sent = false;
                memorySessions.set(chatId, session);

                // পুরাতন সকেটের মাল্টি-প্রোডাক্ট হিস্ট্রি ক্লিয়ার যাতে মডেল নতুনভাবে শুধু এই প্রোডাক্টটি চেনে
                const oldWs = activeLiveSockets.get(chatId);
                if (oldWs?.ws) { try { oldWs.ws.close(); } catch(e){} }
                activeLiveSockets.delete(chatId);

                const text = `${matched.name} প্রোডাক্টটি নির্বাচন করার জন্য ধন্যবাদ!\nমূল্য: ৳${matched.price} (ক্যাশ অন ডেলিভারি)।\n\nঅর্ডারটি এখনই কনফার্ম করতে অনুগ্রহ করে আপনার নাম, মোবাইল নম্বর এবং সম্পূর্ণ ডেলিভারি ঠিকানা লিখে দিন:`;
                const qr = [
                  { content_type: "text", title: "📍 ঢাকার ভেতরে (৭০৳)", payload: "ACTION_LOCATION_DHAKA" },
                  { content_type: "text", title: "📍 ঢাকার বাইরে (১৩০৳)", payload: "ACTION_LOCATION_OUTSIDE" },
                  { content_type: "text", title: "🔊 ভয়েস শুনুন", payload: `PLAY_AUDIO_aud_${Date.now()}` }
                ];
                await sendFacebookMessage(senderId, text, qr);
                await sendFacebookProductCard(senderId, matched);

                session.messages.push({
                  id: `btn_${Date.now()}`,
                  sender_type: "customer",
                  sender_name: profile.name,
                  message_text: `[কাস্টমার প্রোডাক্ট নির্বাচন করেছেন]: ${matched.name}`,
                  timestamp: new Date().toISOString()
                });
                session.messages.push({
                  id: `ai_${Date.now()}`,
                  sender_type: "assistant",
                  sender_name: "Ranonex AI Assistant",
                  message_text: text,
                  timestamp: new Date().toISOString()
                });
                memorySessions.set(chatId, session);
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

            // ৮. [📞 হেল্পলাইনে কল] বাটন ক্লিক (শুধুমাত্র নির্দিষ্ট বাটন ক্লিকের ক্ষেত্রে)
            // সাধারণ টেক্সটের ক্ষেত্রে AI নিজে সিদ্ধান্ত নিবে (SHOW_HELPLINE: true), কোনো হার্ডকোডেড ইন্টারসেপশন নয়
            if (incomingPayload === "ACTION_CALL_SUPPORT") {
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

            if (!incomingText && !userSentAudio && !userSentImage && !userSentVideo) continue;

            // ==========================================
            // 🎙️ কাস্টমারের ভয়েস অডিও ডাউনলোড ও প্রসেসিং
            // ==========================================
            let incomingAudioBuffer = null;
            let audioMimeType = "audio/mp4";
            if (userSentAudio) {
              const audioAttachment = message.attachments.find(a => a.type === 'audio');
              if (audioAttachment?.payload?.url) {
                try {
                  console.log(`🎙️ [Customer sent Audio]: ${audioAttachment.payload.url}`);
                  const aRes = await fetch(audioAttachment.payload.url);
                  if (aRes.ok) {
                    incomingAudioBuffer = Buffer.from(await aRes.arrayBuffer());
                    audioMimeType = (aRes.headers.get("content-type") || "audio/mp4").split(';')[0].trim();
                    if (!audioMimeType.startsWith("audio/")) audioMimeType = "audio/mp4";
                    console.log(`✅ Audio downloaded successfully (${incomingAudioBuffer.length} bytes, ${audioMimeType})`);
                  }
                } catch (dlErr) {
                  console.error("Error downloading customer audio:", dlErr.message);
                }
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
                    imageMimeType = (iRes.headers.get("content-type") || "image/jpeg").split(';')[0].trim();
                    if (!imageMimeType.startsWith("image/")) imageMimeType = "image/jpeg";
                    console.log(`✅ Image downloaded successfully (${incomingImageBuffer.length} bytes, ${imageMimeType})`);
                  }
                } catch (dlErr) {
                  console.error("Error downloading customer image:", dlErr.message);
                }
              }
            }

            // ==========================================
            // 🎥 কাস্টমারের পাঠানো ভিডিও ডাউনলোড ও প্রসেসিং
            // ==========================================
            let incomingVideoBuffer = null;
            let videoMimeType = "video/mp4";
            if (userSentVideo) {
              const videoAttachment = message.attachments.find(a => a.type === 'video');
              if (videoAttachment?.payload?.url) {
                try {
                  console.log(`🎥 [Customer sent Video]: ${videoAttachment.payload.url}`);
                  const vRes = await fetch(videoAttachment.payload.url);
                  if (vRes.ok) {
                    incomingVideoBuffer = Buffer.from(await vRes.arrayBuffer());
                    videoMimeType = (vRes.headers.get("content-type") || "video/mp4").split(';')[0].trim();
                    if (!videoMimeType.startsWith("video/")) videoMimeType = "video/mp4";
                    console.log(`✅ Video downloaded successfully (${incomingVideoBuffer.length} bytes, ${videoMimeType})`);
                  }
                } catch (dlErr) {
                  console.error("Error downloading customer video:", dlErr.message);
                }
              }
            }

            // 🎯 কাস্টমার যদি টেক্সটে প্রোডাক্ট চয়েস করে (১, ২, প্রথমটা, অথবা প্রোডাক্টের নাম)
            if (session.discussed_products && session.discussed_products.length > 1 && !session.selected_order_product) {
              const cleanMsg = (incomingText || "").trim().toLowerCase();
              let selectedIdx = -1;
              if (/^(?:১|1|১ম|প্রথম|first|1st|এক|১\s*নং|১\s*নম্বর)\b/i.test(cleanMsg)) selectedIdx = 0;
              else if (/^(?:২|2|২য়|দ্বিতীয়|second|2nd|দুই|২\s*নং|২\s*নম্বর)\b/i.test(cleanMsg)) selectedIdx = 1;
              else if (/^(?:৩|3|৩য়|তৃতীয়|third|3rd|তিন|৩\s*নং|৩\s*নম্বর)\b/i.test(cleanMsg)) selectedIdx = 2;
              else if (/^(?:৪|4|৪র্থ|চতুর্থ|fourth|4th|চার|৪\s*নং|৪\s*নম্বর)\b/i.test(cleanMsg)) selectedIdx = 3;
              else if (/^(?:৫|5|৫ম|পঞ্চম|fifth|5th|পাঁচ|৫\s*নং|৫\s*নম্বর)\b/i.test(cleanMsg)) selectedIdx = 4;
              else {
                for (let i = 0; i < session.discussed_products.length; i++) {
                  const p = session.discussed_products[i];
                  const pWords = (p.name || "").toLowerCase().split(/\s+/).filter(w => w.length > 3);
                  if (pWords.some(w => cleanMsg.includes(w))) {
                    selectedIdx = i;
                    break;
                  }
                }
              }

              if (selectedIdx >= 0 && selectedIdx < session.discussed_products.length) {
                const chosen = session.discussed_products[selectedIdx];
                session.selected_order_product = chosen;
                session.last_discussed_product = chosen;
                session.discussed_products = [chosen];
                console.log(`🎯 [Customer Selected Product via text "${incomingText}"]: ${chosen.name}`);
              }
            }

            let userPromptText = incomingText ? incomingText.trim() : "";
            if (userSentAudio) {
              userPromptText = userPromptText
                ? `The customer sent a voice note with caption: "${userPromptText}". LISTEN CAREFULLY to their voice audio. Understand their spoken inquiry in Bengali/Banglish and reply directly to what they asked in pure Bengali script (বাংলা লিপি) based on our Ranonex store catalog. If they ask about a product, mention name, exact price, link, and how to order. If they provide phone number (01XXXXXXXXX) and address, confirm the order immediately.`
                : "The customer sent a voice note. LISTEN CAREFULLY to their voice audio. Understand their spoken inquiry in Bengali/Banglish and answer their question directly based on our Ranonex store catalog in pure Bengali script (বাংলা লিপি). If they ask about a product, state its name, exact price, link, and how to order. If they provide order details (Phone 01XXXXXXXXX, Address), confirm the order immediately.";
            } else if (userSentVideo) {
              userPromptText = userPromptText
                ? `The customer sent a product video with caption: "${userPromptText}". WATCH AND ANALYZE THIS VIDEO CAREFULLY. Match the product shown with our Ranonex store catalog. State its exact name, price, key features, and product link in pure Bengali script (বাংলা লিপি), answer their caption, and ask if they want to order it.`
                : "The customer sent a product video. WATCH AND ANALYZE THIS VIDEO CAREFULLY. Match the product shown with our Ranonex store catalog. State its exact name, price, key features, and product link in pure Bengali script (বাংলা লিপি), and ask if they want to order it right here.";
            } else if (userSentImage) {
              userPromptText = userPromptText
                ? `The customer sent a product photo/screenshot with caption: "${userPromptText}". Carefully analyze this product image, match it with our Ranonex store catalog, state its exact name and price in pure Bengali script (বাংলা লিপি), answer their caption, and ask if they want to order it.`
                : "The customer sent a photo/screenshot of a product. Carefully analyze this product image, match it with our Ranonex store catalog, state its exact name, price, key features, and product link in pure Bengali script (বাংলা লিপি), and ask if they want to order it right here.";
            }

            // যদি কাস্টমার মাত্রই (২৫ সেকেন্ডের ভেতর) ছবি বা ভিডিও পাঠিয়ে থাকে:
            const isJustAfterMedia = session.last_media_time && (Date.now() - session.last_media_time < 25000);
            if (isJustAfterMedia && !userSentImage && !userSentVideo && !userSentAudio) {
              const isOrderIntent = /(?:অর্ডার|order|নিতে\s*চাই|নিব|পাঠিয়ে\s*দিন|01[3-9]\d{8})/i.test(incomingText || "");
              const isProductInquiry = /(?:দাম\s*কত|কত\s*দাম|price|cost|টাকা|rate|আছে|available|হবে|পাওয়া\s*যাবে|পাবো|এইটা|এটা|প্রোডাক্ট|পাঞ্জাবি|ঘড়ি)/i.test(incomingText || "");

              if (isProductInquiry && !isOrderIntent) {
                // ছবি/ভিডিওর পরের মেসেজ যদি প্রোডাক্ট সম্পর্কে হয় তবে ইগনোর করা হবে, কারণ অলরেডি ছবি/ভিডিওর সাথেই বিস্তারিত রিপ্লাই পাঠানো হয়েছে
                console.log(`⏩ [Ignoring redundant follow-up inquiry "${incomingText}" right after media from ${senderId}]`);
                continue;
              }
            }

            totalMessagesHandled++;
            console.log(`📩 [Messenger from ${senderId}]: ${incomingText || (userSentAudio ? "[Voice Note]" : (userSentVideo ? "[Product Video]" : "[Product Screenshot]"))}`);

            const customerMsgText = incomingText || (userSentAudio ? "[Voice Message]" : (userSentVideo ? "[Product Video]" : "[Product Image / Screenshot]"));
            session.messages.push({
              id: message?.mid || `m_${Date.now()}`,
              sender_type: "customer",
              sender_name: profile.name,
              message_text: customerMsgText,
              timestamp: new Date().toISOString()
            });
            session.last_message = customerMsgText;
            session.last_message_at = new Date().toISOString();
            session.unread_count = Number(session.unread_count || 0) + 1;
            saveSession(chatId, session);

            // 👨‍💻 Admin Takeover চেক: অ্যাডমিন ম্যানুয়াল মোডে থাকলে AI রিপ্লাই দিবে না
            if (session.admin_takeover) {
              console.log(`👨‍💻 [Admin Takeover Active for ${chatId}] — Customer message saved to inbox, AI auto-reply paused.`);
              continue;
            }

            const isVoiceRequested = userSentAudio || /ভয়েস|ভয়েস|audio|voice|কথা বলো|শুনতে চাই/i.test(incomingText || "");

            // Gemini 3.8 Live কল (WebSocket Session Reuse + Multimodal Image / Video / Audio)
            const aiDecision = await callGeminiSalesAI(
              userPromptText,
              session.messages,
              session,
              incomingAudioBuffer,
              audioMimeType,
              incomingImageBuffer,
              imageMimeType,
              incomingVideoBuffer,
              videoMimeType
            );

            let isOrderConfirmedReply = false;
            let orderInfo = null;

            if (aiDecision && aiDecision.reply) {
              console.log(`🤖 [AI Reply to ${profile.name}]: ${aiDecision.reply.substring(0, 80)}...`);

              // ১. ক্যাটালগ ও AI-নির্বাচিত প্রোডাক্ট এক্সট্রাকশন (ডাইনামিক AI সিলেক্টর)
              const { productsList } = await getStoreCatalog();
              const aiSelectedProducts = extractAIProducts(aiDecision.rawReply || aiDecision.reply, productsList);

              let matchedProduct = (aiSelectedProducts.length > 0 ? aiSelectedProducts[0] : null)
                || findMatchingProduct(incomingText, productsList)
                || findMatchingProduct(aiDecision.reply, productsList)
                || session.selected_order_product
                || (session.discussed_products && session.discussed_products.length === 1 ? session.discussed_products[0] : null)
                || session.last_discussed_product
                || null;

              if (aiSelectedProducts.length > 0) {
                if (!session.selected_order_product) {
                  for (const p of aiSelectedProducts) {
                    if (!session.discussed_products.some(dp => dp.id === p.id)) {
                      session.discussed_products.push(p);
                    }
                  }
                }
              } else if (matchedProduct) {
                if (!session.selected_order_product && !session.discussed_products.some(dp => dp.id === matchedProduct.id)) {
                  session.discussed_products.push(matchedProduct);
                }
              }

              if (matchedProduct) {
                session.last_discussed_product = matchedProduct;
                session.last_inquiry_time = Date.now();
                session.abandoned_reminder_sent = false;
              }

              // যদি ইউজার ছবি বা ভিডিও পাঠায় এবং প্রোডাক্ট ম্যাচ করে, সরাসরি ওই প্রোডাক্ট লক করা
              if ((userSentImage || userSentVideo) && matchedProduct) {
                session.last_media_time = Date.now();
                session.last_media_product = matchedProduct;
                session.selected_order_product = matchedProduct;
                session.discussed_products = [matchedProduct];
              }

              // ২. অর্ডার কনফার্মেশন যাচাই ও ফর্ম স্টাইল রিভিউ মেসেজ তৈরি (হয়েছে এবং হয়েছে উভয় ইউনিকোড সাপোর্ট সহ)
              const isAlreadyConfirmedReminder = /(?:আগেই|ইতিমধ্যে|ইতিপূর্বে)\s*(?:আপনার\s*)?(?:অর্ডার(?:টি)?\s*)?(?:কনফার্ম|নিশ্চিত)/i.test(aiDecision.reply || "");
              isOrderConfirmedReply = aiDecision.order_confirmed 
                || (!isAlreadyConfirmedReminder && /(?:অর্ডার(?:টি)?\s*(?:সফলভাবে\s*)?(?:কনফার্ম|নিশ্চিত|গ্রহণ)(?:\s*করা)?\s*(?:হ(?:য়ে|য়ে)ছে|হলো|হল|করেছি|নিলাম)|অর্ডার(?:টি)?\s*(?:সফলভাবে\s*)?(?:কনফার্ম|কনফার্মড)|order\s*(?:is\s*)?confirmed|📋\s*আপনার\s*অর্ডারের\s*তথ্যসমূহ)/i.test(aiDecision.reply || ""));

              if (isOrderConfirmedReply) {
                const resolvedProduct = session.selected_order_product 
                  || matchedProduct
                  || (session.discussed_products && session.discussed_products.length === 1 ? session.discussed_products[0] : null)
                  || session.last_discussed_product;

                let customerPhone = (aiDecision.order_data?.customer_phone || "").replace(/\D/g, '');
                let deliveryAddress = (aiDecision.order_data?.delivery_address || "").trim();
                let customerName = (aiDecision.order_data && aiDecision.order_data.customer_name && !aiDecision.order_data.customer_name.startsWith("Facebook User"))
                  ? aiDecision.order_data.customer_name
                  : "";

                // 🔍 চ্যাট হিস্ট্রি, ইনকামিং মেসেজ ও AI রিপ্লাই থেকে সরাসরি ফোন, নাম ও ঠিকানা উদ্ধার (যদি AI JSON এ কোনো ঘাটতি থাকে)
                const allTexts = [...(session.messages || []).map(m => m.message_text || ""), incomingText || "", aiDecision.reply || ""];
                for (let i = allTexts.length - 1; i >= 0; i--) {
                  const text = allTexts[i];
                  const parsed = parseOrderDetailsFromText(text);
                  if ((!customerPhone || customerPhone.length < 11) && parsed.phone) {
                    customerPhone = parsed.phone.replace(/\D/g, '');
                  }
                  if ((!deliveryAddress || deliveryAddress.length < 4 || deliveryAddress === "ইনবক্সে প্রদত্ত ঠিকানা") && parsed.address) {
                    deliveryAddress = parsed.address;
                  }
                  if ((!customerName || customerName === "Customer") && parsed.name) {
                    customerName = parsed.name;
                  }
                }

                if (!customerName || customerName === "Customer") {
                  customerName = profile.name || "Customer";
                }

                const prodFromReplyLine = (aiDecision.reply || "").match(/📦\s*প্রোডাক্ট\s*[:ঃ-]?\s*([^\r\n]+)/i)?.[1]?.trim() || "";
                const prodName = (aiDecision.order_data && aiDecision.order_data.product_name && aiDecision.order_data.product_name !== "Ranonex Store Product")
                  ? aiDecision.order_data.product_name
                  : (resolvedProduct?.name || prodFromReplyLine || "Ranonex Store Product");

                const basePrice = resolvedProduct ? parseFloat(resolvedProduct.price || 0) : (session.selected_order_product ? parseFloat(session.selected_order_product.price || 0) : 0);
                const isDhaka = /ঢাকা|dhaka/i.test(deliveryAddress) && !/ঢাকার\s*বাইরে|outside/i.test(deliveryAddress);
                const deliveryCharge = isDhaka ? 70 : 130;
                const totalAmount = basePrice > 0 ? (basePrice + deliveryCharge) : (aiDecision.order_data?.total_amount || 0);

                orderInfo = {
                  customer_name: customerName,
                  customer_phone: customerPhone,
                  delivery_address: deliveryAddress || "ইনবক্সে প্রদত্ত ঠিকানা",
                  product_name: prodName,
                  variant: aiDecision.order_data?.variant || "Standard",
                  total_amount: totalAmount,
                  product_id: resolvedProduct?.id || aiDecision.order_data?.product_id || null,
                  product_url: resolvedProduct?.url || aiDecision.order_data?.product_url || null,
                  order_summary: aiDecision.order_data?.order_summary || `কাস্টমার ইনবক্সে সরাসরি ${prodName} পছন্দ করে ক্যাশ অন ডেলিভারিতে অর্ডার নিশ্চিত করেছেন।`
                };

                // 📝 ফর্মের মতো সুন্দর স্ট্রাকচার্ড রিভিউ মেসেজ তৈরি (যাতে কাস্টমার সহজেই চেক করতে পারে)
                const formReview = `📋 আপনার অর্ডারের তথ্যসমূহ (রিভিউ):
━━━━━━━━━━━━━━━━━━━
📦 প্রোডাক্ট: ${orderInfo.product_name}
👤 নাম: ${orderInfo.customer_name}
📞 মোবাইল: ${orderInfo.customer_phone}
📍 ঠিকানা: ${orderInfo.delivery_address}
💰 সর্বমোট প্রদেয় মূল্য: ৳${orderInfo.total_amount}/- (ক্যাশ অন ডেলিভারি)
━━━━━━━━━━━━━━━━━━━
অনুগ্রহ করে উপরের তথ্যগুলো একবার মিলিয়ে দেখে নিন। পরবর্তী ১৫ মিনিটের মধ্যে নাম, মোবাইল নম্বর বা ডেলিভারি ঠিকানায় কোনো পরিবর্তন প্রয়োজন হলে আমাদের এখানে লিখে জানাতে পারেন।`;

                // যদি AI রিপ্লাইতে অলরেডি পুরো ফর্ম না থাকে, সুন্দর করে ফর্মটি যুক্ত করা
                if (!aiDecision.reply.includes("📦 প্রোডাক্ট:") && !aiDecision.reply.includes("সর্বমোট প্রদেয় মূল্য")) {
                  aiDecision.reply = `ধন্যবাদ ${orderInfo.customer_name}! আপনার অর্ডারটি সফলভাবে কনফার্ম করা হয়েছে।\n\n${formReview}`;
                }
              }

              const activeProd = session.selected_order_product || matchedProduct || (session.discussed_products && session.discussed_products.length === 1 ? session.discussed_products[0] : null) || session.last_discussed_product;

              if (!isOrderConfirmedReply && activeProd && aiSelectedProducts.length <= 1 && !aiDecision.reply.includes("ranonex.shop")) {
                const orderUrl = activeProd.url || `https://ranonex.shop/product.html?id=${encodeURIComponent(activeProd.id)}`;
                aiDecision.reply = aiDecision.reply.trim() + `\n\n🔗 ${orderUrl}`;
              }

              // ওয়েবসাইট লিংক জানতে চাইলে লিঙ্ক প্রদান
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

              // ৬. 🃏 প্রোডাক্ট কার্ড / ক্যারোসেল অ্যাকশন বাটন (In-App WebView সহ সরাসরি ভিউ ও অর্ডার সুবিধা)
              if (!isOrderConfirmedReply) {
                if (aiSelectedProducts.length > 1) {
                  console.log(`🎴 [Sending Product Carousel (${aiSelectedProducts.length} items)] to ${senderId}`);
                  await sendFacebookCarousel(senderId, aiSelectedProducts);
                } else if (aiSelectedProducts.length === 1) {
                  console.log(`🃏 [Sending Product Card (${aiSelectedProducts[0].name})] to ${senderId}`);
                  await sendFacebookProductCard(senderId, aiSelectedProducts[0]);
                } else if (matchedProduct) {
                  console.log(`🃏 [Sending Product Card (${matchedProduct.name})] to ${senderId}`);
                  await sendFacebookProductCard(senderId, matchedProduct);
                }
              }

              // ৭. 📞 কাস্টমার যোগাযোগ করতে চাইলে হেল্পলাইন/হোয়াটসঅ্যাপ বাটন কার্ড পাঠানো (AI সিদ্ধান্ত অনুযায়ী, অর্ডারের ক্ষেত্রে কখনোই নয়)
              if (aiDecision.show_helpline && !isOrderConfirmedReply && !aiDecision.order_data) {
                console.log(`📞 [Sending Helpline / WhatsApp Support Card by AI Decision] to ${senderId}`);
                await sendFacebookHelplineCard(senderId);
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
            // ==========================================
            if (isOrderConfirmedReply && orderInfo) {
              const hasValidPhone = orderInfo.customer_phone && orderInfo.customer_phone.length >= 11;
              const hasValidProduct = Boolean(orderInfo.product_name && orderInfo.product_name.length > 2);

              if (hasValidPhone && hasValidProduct) {
                // ডুপ্লিকেট রোধ: একই ফোন ও প্রোডাক্টের জন্য ৬০ সেকেন্ডের মধ্যে ডুপ্লিকেট অ্যালার্ট না পাঠানো
                const dedupeKey = `${orderInfo.customer_phone}_${orderInfo.product_name}`;
                const isRecentDuplicate = (session.last_alerted_order_key === dedupeKey) && (Date.now() - (session.last_order_time || 0) < 60 * 1000);
                if (isRecentDuplicate) {
                  console.log(`ℹ️ [Duplicate Order Alert Skipped]: ${dedupeKey}`);
                } else {
                  session.last_alerted_order_key = dedupeKey;
                  session.last_order_data = orderInfo;
                  session.last_order_time = Date.now();
                  session.last_order_cancelled = false;
                  saveSession(chatId, session);

                  console.log(`🎉 [ORDER CONFIRMED! Sending Telegram Alert...]`, JSON.stringify(orderInfo));
                  await sendTelegramAlert(orderInfo, "Facebook Messenger");
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

            saveSession(chatId, session);
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

                const commentChatId = `fb_comment_${senderId || commentId}`;
                let cSession = memorySessions.get(commentChatId);
                if (!cSession) {
                  cSession = {
                    chat_id: commentChatId,
                    sender_id: senderId || commentId,
                    sender_name: senderName,
                    platform: "facebook",
                    channel_type: "comment",
                    unread_count: 0,
                    admin_takeover: false,
                    messages: []
                  };
                }
                cSession.messages.push({
                  id: commentId || `c_${Date.now()}`,
                  sender_type: "customer",
                  sender_name: senderName,
                  message_text: commentText,
                  timestamp: new Date().toISOString()
                });
                cSession.unread_count = Number(cSession.unread_count || 0) + 1;
                saveSession(commentChatId, cSession);

                if (cSession.admin_takeover) continue;

                const aiDecision = await callGeminiSalesAI(commentText, cSession.messages, cSession);
                if (aiDecision && aiDecision.reply) {
                  await replyToFacebookComment(commentId, aiDecision.reply);
                  cSession.messages.push({
                    id: `ai_c_${Date.now()}`,
                    sender_type: "assistant",
                    sender_name: "Ranonex AI Assistant",
                    message_text: aiDecision.reply,
                    timestamp: new Date().toISOString()
                  });
                  saveSession(commentChatId, cSession);
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
// 📱 REAL WHATSAPP MULTI-DEVICE QR ENGINE (Baileys - Personal Chats ONLY)
// ==========================================
const qrcode = require('qrcode');
let pino;
try {
  pino = require('pino');
} catch (e) {
  const noop = () => {};
  const fallbackLogger = { level: 'silent', trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child: () => fallbackLogger };
  pino = () => fallbackLogger;
}
const WA_AUTH_DIR = path.join(__dirname, 'wa_auth_info');

const waState = {
  status: 'disconnected', // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
  qrRaw: null,
  qrDataUrl: null,
  qrUpdatedAt: 0,
  phone: null,
  name: null,
  jid: null,
  lastError: null
};

let waSocket = null;
let waStartingLock = false;
let waReconnectTimer = null;

/**
 * 🔒 STRICT PERSONAL-CHAT-ONLY FILTER FOR WHATSAPP
 * AI শুধুমাত্র Personal 1-on-1 চ্যাটে (@s.whatsapp.net / @lid) কথা বলবে।
 * Group (@g.us), Channel (@newsletter), বা Status/Broadcast-এ কখনোই কিছু করবে না।
 */
function isPersonalWhatsAppJid(jid) {
  if (!jid || typeof jid !== 'string') return false;
  const normalized = jid.trim().toLowerCase();
  if (
    normalized.endsWith('@g.us') ||
    normalized.endsWith('@newsletter') ||
    normalized === 'status@broadcast' ||
    normalized.endsWith('@broadcast')
  ) {
    return false;
  }
  return normalized.endsWith('@s.whatsapp.net') || normalized.endsWith('@lid');
}

async function sendWhatsAppTextMessage(targetJidOrPhone, text) {
  if (!waSocket || waState.status !== 'connected') {
    throw new Error("WhatsApp বর্তমানে কানেক্টেড নেই। অনুগ্রহ করে প্রথমে QR স্ক্যান করে WhatsApp কানেক্ট করুন।");
  }
  let jid = String(targetJidOrPhone || '').trim();
  if (jid.startsWith('wa_')) jid = jid.slice(3);
  if (!jid.includes('@')) {
    let digits = jid.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('01')) {
      digits = '88' + digits;
    }
    jid = `${digits}@s.whatsapp.net`;
  }
  if (!isPersonalWhatsAppJid(jid)) {
    throw new Error("নিরাপত্তা নীতি: শুধুমাত্র Personal WhatsApp চ্যাটে মেসেজ পাঠানো অনুমোদিত (Group/Channel ব্লকড)।");
  }
  return await waSocket.sendMessage(jid, { text: String(text || '').trim() });
}

async function startWhatsAppClient(forceReset = false) {
  if (waStartingLock) return waState;
  waStartingLock = true;

  try {
    if (waReconnectTimer) {
      clearTimeout(waReconnectTimer);
      waReconnectTimer = null;
    }

    if (forceReset) {
      if (waSocket) {
        try { waSocket.ev.removeAllListeners(); } catch (e) {}
        try { waSocket.end(undefined); } catch (e) {}
        waSocket = null;
      }
      try {
        if (fs.existsSync(WA_AUTH_DIR)) {
          fs.rmSync(WA_AUTH_DIR, { recursive: true, force: true });
        }
      } catch (e) {}
    }

    if (waSocket && waState.status === 'connected' && !forceReset) {
      waStartingLock = false;
      return waState;
    }

    if (waSocket) {
      try { waSocket.ev.removeAllListeners(); } catch (e) {}
      try { waSocket.end(undefined); } catch (e) {}
      waSocket = null;
    }

    waState.status = 'connecting';
    waState.lastError = null;

    if (!fs.existsSync(WA_AUTH_DIR)) {
      fs.mkdirSync(WA_AUTH_DIR, { recursive: true });
    }

    const baileys = await import('@whiskeysockets/baileys');
    const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket;
    const useMultiFileAuthState = baileys.useMultiFileAuthState || baileys.default?.useMultiFileAuthState;
    const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion || baileys.default?.fetchLatestBaileysVersion;
    const DisconnectReason = baileys.DisconnectReason || baileys.default?.DisconnectReason || {};
    const downloadMediaMessage = baileys.downloadMediaMessage || baileys.default?.downloadMediaMessage;

    const { state, saveCreds } = await useMultiFileAuthState(WA_AUTH_DIR);
    let version = [2, 3000, 1015901307];
    try {
      const latest = await fetchLatestBaileysVersion();
      if (latest?.version) version = latest.version;
    } catch (e) {}

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Ranonex SocialAutomate', 'Chrome', '122.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false
    });

    waSocket = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          waState.qrRaw = qr;
          waState.qrDataUrl = await qrcode.toDataURL(qr, { margin: 1, width: 320 });
          waState.qrUpdatedAt = Date.now();
          waState.status = 'qr_ready';
          console.log('📱 [WhatsApp QR Ready] নতুন QR কোড জেনারেট হয়েছে।');
        } catch (qrErr) {
          console.error('QR generation error:', qrErr.message);
        }
      }

      if (connection === 'open') {
        const userJid = sock.user?.id || '';
        const cleanNumber = userJid.split(':')[0].split('@')[0].replace(/\D/g, '');
        waState.status = 'connected';
        waState.qrRaw = null;
        waState.qrDataUrl = null;
        waState.jid = userJid;
        waState.phone = cleanNumber || null;
        waState.name = sock.user?.name || 'Ranonex WhatsApp';
        waState.lastError = null;
        console.log(`✅ [WhatsApp Connected]: +${waState.phone} (${waState.name})`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode;
        const isLoggedOut = statusCode === (DisconnectReason.loggedOut || 401);
        console.log(`⚠️ [WhatsApp Connection Closed] code=${statusCode}, isLoggedOut=${isLoggedOut}`);

        waSocket = null;
        if (isLoggedOut) {
          waState.status = 'disconnected';
          waState.qrRaw = null;
          waState.qrDataUrl = null;
          waState.phone = null;
          waState.name = null;
          waState.jid = null;
          try {
            if (fs.existsSync(WA_AUTH_DIR)) {
              fs.rmSync(WA_AUTH_DIR, { recursive: true, force: true });
            }
          } catch (e) {}
          // স্বয়ংক্রিয়ভাবে নতুন QR প্রস্তুত রাখা
          waReconnectTimer = setTimeout(() => startWhatsAppClient(false), 2500);
        } else {
          waState.status = 'connecting';
          waReconnectTimer = setTimeout(() => startWhatsAppClient(false), 3500);
        }
      }
    });

    // ==========================================
    // 📩 WHATSAPP INCOMING MESSAGES (STRICT PERSONAL CHATS ONLY)
    // ==========================================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || !Array.isArray(messages)) return;

      for (const msg of messages) {
        try {
          if (!msg || !msg.message || msg.key?.fromMe) continue;

          const remoteJid = msg.key?.remoteJid || '';
          // 🔒 STRICT FILTER: শুধুমাত্র Personal 1-on-1 চ্যাট অনুমোদিত। Group (@g.us), Channel (@newsletter), Status ব্লকড!
          if (!isPersonalWhatsAppJid(remoteJid) || msg.key?.participant) {
            console.log(`🚫 [WhatsApp Ignored Non-Personal / Group / Channel Message]: ${remoteJid}`);
            continue;
          }

          // আনর‍্যাপ মেসেজ অবজেক্ট (ephemeral / viewOnce থাকলে)
          const innerMsg = msg.message.ephemeralMessage?.message
            || msg.message.viewOnceMessage?.message
            || msg.message.viewOnceMessageV2?.message
            || msg.message;

          const incomingText = (
            innerMsg.conversation ||
            innerMsg.extendedTextMessage?.text ||
            innerMsg.imageMessage?.caption ||
            innerMsg.videoMessage?.caption ||
            ""
          ).trim();

          const userSentAudio = Boolean(innerMsg.audioMessage);
          const userSentImage = Boolean(innerMsg.imageMessage);
          const userSentVideo = Boolean(innerMsg.videoMessage);

          if (!incomingText && !userSentAudio && !userSentImage && !userSentVideo) continue;

          const cleanPhone = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
          const chatId = `wa_${cleanPhone || remoteJid}`;
          const pushName = msg.pushName || `WhatsApp (${cleanPhone || remoteJid})`;

          let session = memorySessions.get(chatId);
          if (!session) {
            session = {
              chat_id: chatId,
              sender_id: cleanPhone || remoteJid,
              wa_jid: remoteJid,
              sender_name: pushName,
              platform: "whatsapp",
              channel_type: "whatsapp",
              unread_count: 0,
              admin_takeover: false,
              messages: [],
              discussed_products: []
            };
          }
          session.chat_id = chatId;
          session.sender_id = cleanPhone || remoteJid;
          session.wa_jid = remoteJid;
          session.sender_name = pushName;
          session.platform = "whatsapp";
          session.channel_type = "whatsapp";
          if (!Array.isArray(session.discussed_products)) session.discussed_products = [];

          const displayMsgText = incomingText || (userSentAudio ? "[Voice Note]" : (userSentVideo ? "[Product Video]" : "[Product Image]"));
          session.messages.push({
            id: msg.key?.id || `wa_${Date.now()}`,
            sender_type: "customer",
            sender_name: pushName,
            message_text: displayMsgText,
            timestamp: new Date().toISOString()
          });
          session.last_message = displayMsgText;
          session.last_message_at = new Date().toISOString();
          session.unread_count = Number(session.unread_count || 0) + 1;
          saveSession(chatId, session);

          totalMessagesHandled++;
          console.log(`📩 [WhatsApp Personal from ${pushName} (${cleanPhone})]: ${displayMsgText}`);

          // 👨‍💻 যদি Admin Takeover চালু থাকে, তবে AI অটো-রিপ্লাই দিবে না
          if (session.admin_takeover) {
            console.log(`👨‍💻 [Admin Takeover Active for ${chatId}] — WhatsApp message saved to inbox, AI auto-reply paused.`);
            continue;
          }

          // মাল্টিমোডাল মিডিয়া ডাউনলোড (ভয়েস / ছবি / ভিডিও)
          let incomingAudioBuffer = null;
          let audioMimeType = "audio/ogg; codecs=opus";
          let incomingImageBuffer = null;
          let imageMimeType = "image/jpeg";
          let incomingVideoBuffer = null;
          let videoMimeType = "video/mp4";

          if (downloadMediaMessage && (userSentAudio || userSentImage || userSentVideo)) {
            try {
              const mediaBuf = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
              );
              if (mediaBuf && mediaBuf.length > 0) {
                if (userSentAudio) {
                  incomingAudioBuffer = Buffer.from(mediaBuf);
                  audioMimeType = (innerMsg.audioMessage?.mimetype || "audio/ogg").split(';')[0].trim();
                } else if (userSentImage) {
                  incomingImageBuffer = Buffer.from(mediaBuf);
                  imageMimeType = (innerMsg.imageMessage?.mimetype || "image/jpeg").split(';')[0].trim();
                } else if (userSentVideo && mediaBuf.length <= 15 * 1024 * 1024) {
                  incomingVideoBuffer = Buffer.from(mediaBuf);
                  videoMimeType = (innerMsg.videoMessage?.mimetype || "video/mp4").split(';')[0].trim();
                }
              }
            } catch (mErr) {
              console.error("WhatsApp media download error:", mErr.message);
            }
          }

          // প্রোডাক্ট ক্যাটালগ ম্যাচিং
          const { productsList } = await getStoreCatalog();
          const earlyMatchedProduct = findMatchingProduct(incomingText, productsList);
          if (earlyMatchedProduct) {
            if (!session.discussed_products.some(p => p.id === earlyMatchedProduct.id)) {
              session.discussed_products.push(earlyMatchedProduct);
            }
            session.last_discussed_product = earlyMatchedProduct;
            session.last_inquiry_time = Date.now();
            session.abandoned_reminder_sent = false;
            saveSession(chatId, session);
          }

          let userPromptText = incomingText;
          if (userSentAudio) {
            userPromptText = userPromptText
              ? `The customer sent a WhatsApp voice note with text: "${userPromptText}". LISTEN CAREFULLY to their voice audio and reply in pure Bengali script (বাংলা লিপি) based on our Ranonex store catalog.`
              : "The customer sent a WhatsApp voice note. LISTEN CAREFULLY to their voice audio and answer their question in pure Bengali script (বাংলা লিপি) based on our Ranonex store catalog.";
          } else if (userSentImage) {
            userPromptText = userPromptText
              ? `The customer sent a product photo on WhatsApp with caption: "${userPromptText}". Match it with our Ranonex store catalog, state its exact name and price in pure Bengali script (বাংলা লিপি), and ask if they want to order.`
              : "The customer sent a product photo on WhatsApp. Match it with our Ranonex store catalog, state its exact name, price, and link in pure Bengali script (বাংলা লিপি), and ask if they want to order.";
          } else if (userSentVideo) {
            userPromptText = "The customer sent a product video on WhatsApp. Match it with our Ranonex store catalog and reply in pure Bengali script (বাংলা লিপি) with exact name, price, and order instructions.";
          }

          const aiDecision = await callGeminiSalesAI(
            userPromptText,
            session.messages,
            session,
            incomingAudioBuffer,
            audioMimeType,
            incomingImageBuffer,
            imageMimeType,
            incomingVideoBuffer,
            videoMimeType
          );

          if (aiDecision && aiDecision.reply) {
            const aiSelectedProducts = extractAIProducts(aiDecision.rawReply || aiDecision.reply, productsList);
            let matchedProduct = (aiSelectedProducts.length > 0 ? aiSelectedProducts[0] : null)
              || earlyMatchedProduct
              || findMatchingProduct(aiDecision.reply, productsList)
              || session.selected_order_product
              || session.last_discussed_product
              || null;

            if (matchedProduct) {
              session.last_discussed_product = matchedProduct;
              if (!session.discussed_products.some(dp => dp.id === matchedProduct.id)) {
                session.discussed_products.push(matchedProduct);
              }
            }

            const isAlreadyConfirmedReminder = /(?:আগেই|ইতিমধ্যে|ইতিপূর্বে)\s*(?:আপনার\s*)?(?:অর্ডার(?:টি)?\s*)?(?:কনফার্ম|নিশ্চিত)/i.test(aiDecision.reply || "");
            const isOrderConfirmedReply = aiDecision.order_confirmed
              || (!isAlreadyConfirmedReminder && /(?:অর্ডার(?:টি)?\s*(?:সফলভাবে\s*)?(?:কনফার্ম|নিশ্চিত|গ্রহণ)(?:\s*করা)?\s*(?:হ(?:য়ে|য়ে)ছে|হলো|হল|করেছি|নিলাম)|অর্ডার(?:টি)?\s*(?:সফলভাবে\s*)?(?:কনফার্ম|কনফার্মড)|order\s*(?:is\s*)?confirmed|📋\s*আপনার\s*অর্ডারের\s*তথ্যসমূহ)/i.test(aiDecision.reply || ""));

            let orderInfo = null;
            if (isOrderConfirmedReply) {
              const resolvedProduct = session.selected_order_product || matchedProduct || session.last_discussed_product;
              let customerPhone = (aiDecision.order_data?.customer_phone || "").replace(/\D/g, '');
              let deliveryAddress = (aiDecision.order_data?.delivery_address || "").trim();
              let customerName = aiDecision.order_data?.customer_name || "";

              const allTexts = [...(session.messages || []).map(m => m.message_text || ""), incomingText || "", aiDecision.reply || ""];
              for (let i = allTexts.length - 1; i >= 0; i--) {
                const parsed = parseOrderDetailsFromText(allTexts[i]);
                if ((!customerPhone || customerPhone.length < 11) && parsed.phone) customerPhone = parsed.phone.replace(/\D/g, '');
                if ((!deliveryAddress || deliveryAddress.length < 4 || deliveryAddress === "ইনবক্সে প্রদত্ত ঠিকানা") && parsed.address) deliveryAddress = parsed.address;
                if ((!customerName || customerName === "Customer") && parsed.name) customerName = parsed.name;
              }
              // যদি কাস্টমারের হোয়াটসঅ্যাপ নম্বর ১১-১৩ ডিজিটের বাংলাদেশি নম্বর হয়, সেটি ফলব্যাক হিসেবে ব্যবহার করা
              if ((!customerPhone || customerPhone.length < 11) && cleanPhone.length >= 11) {
                customerPhone = cleanPhone.startsWith('8801') ? cleanPhone.slice(2) : cleanPhone;
              }
              if (!customerName || customerName === "Customer") customerName = pushName;

              const prodFromReplyLine = (aiDecision.reply || "").match(/📦\s*প্রোডাক্ট\s*[:ঃ-]?\s*([^\r\n]+)/i)?.[1]?.trim() || "";
              const prodName = (aiDecision.order_data?.product_name && aiDecision.order_data.product_name !== "Ranonex Store Product")
                ? aiDecision.order_data.product_name
                : (resolvedProduct?.name || prodFromReplyLine || "Ranonex Store Product");

              const basePrice = resolvedProduct ? parseFloat(resolvedProduct.price || 0) : 0;
              const isDhaka = /ঢাকা|dhaka/i.test(deliveryAddress) && !/ঢাকার\s*বাইরে|outside/i.test(deliveryAddress);
              const deliveryCharge = isDhaka ? 70 : 130;
              const totalAmount = basePrice > 0 ? (basePrice + deliveryCharge) : (aiDecision.order_data?.total_amount || 0);

              orderInfo = {
                customer_name: customerName,
                customer_phone: customerPhone,
                delivery_address: deliveryAddress || "হোয়াটসঅ্যাপে প্রদত্ত ঠিকানা",
                product_name: prodName,
                variant: aiDecision.order_data?.variant || "Standard",
                total_amount: totalAmount,
                product_id: resolvedProduct?.id || null,
                product_url: resolvedProduct?.url || null,
                order_summary: `কাস্টমার WhatsApp পার্সোনাল চ্যাটে সরাসরি ${prodName} ক্যাশ অন ডেলিভারিতে অর্ডার নিশ্চিত করেছেন।`
              };

              const formReview = `📋 আপনার অর্ডারের তথ্যসমূহ (রিভিউ):
━━━━━━━━━━━━━━━━━━━
📦 প্রোডাক্ট: ${orderInfo.product_name}
👤 নাম: ${orderInfo.customer_name}
📞 মোবাইল: ${orderInfo.customer_phone}
📍 ঠিকানা: ${orderInfo.delivery_address}
💰 সর্বমোট প্রদেয় মূল্য: ৳${orderInfo.total_amount}/- (ক্যাশ অন ডেলিভারি)
━━━━━━━━━━━━━━━━━━━
অনুগ্রহ করে উপরের তথ্যগুলো একবার মিলিয়ে দেখে নিন। পরবর্তী ১৫ মিনিটের মধ্যে কোনো পরিবর্তন প্রয়োজন হলে এখানে লিখে জানাতে পারেন।`;

              if (!aiDecision.reply.includes("📦 প্রোডাক্ট:") && !aiDecision.reply.includes("সর্বমোট প্রদেয় মূল্য")) {
                aiDecision.reply = `ধন্যবাদ ${orderInfo.customer_name}! আপনার অর্ডারটি সফলভাবে কনফার্ম করা হয়েছে।\n\n${formReview}`;
              }
            }

            if (!isOrderConfirmedReply && matchedProduct && !aiDecision.reply.includes("ranonex.shop")) {
              const orderUrl = matchedProduct.url || `https://ranonex.shop/product.html?id=${encodeURIComponent(matchedProduct.id)}`;
              aiDecision.reply = aiDecision.reply.trim() + `\n\n🔗 ${orderUrl}`;
            }

            await sock.sendMessage(remoteJid, { text: aiDecision.reply });

            session.messages.push({
              id: `ai_wa_${Date.now()}`,
              sender_type: "assistant",
              sender_name: "Ranonex AI Assistant",
              message_text: aiDecision.reply,
              timestamp: new Date().toISOString()
            });
            saveSession(chatId, session);

            if (isOrderConfirmedReply && orderInfo && orderInfo.customer_phone && orderInfo.customer_phone.length >= 11) {
              const dedupeKey = `${orderInfo.customer_phone}_${orderInfo.product_name}`;
              const isRecentDuplicate = (session.last_alerted_order_key === dedupeKey) && (Date.now() - (session.last_order_time || 0) < 60 * 1000);
              if (!isRecentDuplicate) {
                session.last_alerted_order_key = dedupeKey;
                session.last_order_data = orderInfo;
                session.last_order_time = Date.now();
                saveSession(chatId, session);
                console.log(`🎉 [WhatsApp ORDER CONFIRMED! Sending Telegram Alert...]`, JSON.stringify(orderInfo));
                await sendTelegramAlert(orderInfo, "WhatsApp Personal");
              }
            }

            if (aiDecision.order_updated && aiDecision.order_data) {
              session.last_order_data = { ...(session.last_order_data || {}), ...aiDecision.order_data };
              saveSession(chatId, session);
              await sendTelegramOrderUpdate(session.last_order_data, "WhatsApp Personal");
            }

            if (aiDecision.order_cancelled) {
              await sendTelegramOrderCancel(session.last_order_data || { customer_name: pushName }, aiDecision.note, "WhatsApp Personal");
            }
          }
        } catch (waMsgErr) {
          console.error("WhatsApp message handler error:", waMsgErr.message);
        }
      }
    });
  } catch (err) {
    waState.status = 'disconnected';
    waState.lastError = err.message;
    console.error("Failed to initialize WhatsApp Baileys client:", err.message);
  } finally {
    waStartingLock = false;
  }
  return waState;
}

// সার্ভার চালুর সাথে সাথে WhatsApp সেশন ইনিশিয়ালাইজ করা
setTimeout(() => {
  startWhatsAppClient(false).catch(err => console.error("Initial WhatsApp boot error:", err.message));
}, 1000);

// ==========================================
// 📱 WHATSAPP QR & CONNECTION API ENDPOINTS
// ==========================================
app.get(['/api/whatsapp/status', '/api/whatsapp/qr'], async (req, res) => {
  if (waState.status === 'disconnected' && !waStartingLock && req.query.auto !== 'false') {
    startWhatsAppClient(false).catch(() => {});
  }
  res.json({
    success: true,
    status: waState.status,
    qr_data_url: waState.qrDataUrl,
    phone: waState.phone,
    name: waState.name,
    jid: waState.jid,
    updated_at: waState.qrUpdatedAt,
    personal_only_mode: true,
    last_error: waState.lastError
  });
});

app.post('/api/whatsapp/connect', async (req, res) => {
  const force = Boolean(req.body?.force);
  await startWhatsAppClient(force);
  res.json({
    success: true,
    status: waState.status,
    qr_data_url: waState.qrDataUrl,
    phone: waState.phone,
    name: waState.name,
    jid: waState.jid,
    personal_only_mode: true
  });
});

app.post('/api/whatsapp/logout', async (req, res) => {
  try {
    if (waSocket) {
      try { await waSocket.logout(); } catch (e) {}
      try { waSocket.ev.removeAllListeners(); } catch (e) {}
      try { waSocket.end(undefined); } catch (e) {}
      waSocket = null;
    }
    if (fs.existsSync(WA_AUTH_DIR)) {
      fs.rmSync(WA_AUTH_DIR, { recursive: true, force: true });
    }
    waState.status = 'disconnected';
    waState.qrRaw = null;
    waState.qrDataUrl = null;
    waState.phone = null;
    waState.name = null;
    waState.jid = null;
    // নতুন QR সেশন শুরু করা যাতে অ্যাডমিন সাথে সাথে আবার স্ক্যান করতে পারে
    startWhatsAppClient(false).catch(() => {});
    res.json({ success: true, status: waState.status, message: "WhatsApp logged out and reset." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================================
// 💬 ZERO-D1 ALWAYSDATA LIVE INBOX & MESSAGING API
// ==========================================
function buildConversationsList(platformFilter) {
  return Array.from(memorySessions.values())
    .map(s => {
      const id = s.chat_id || s.sender_id;
      const platform = s.platform || (String(id).startsWith('wa_') ? 'whatsapp' : 'facebook');
      const channelType = s.channel_type || (platform === 'whatsapp' ? 'whatsapp' : 'messenger');
      const lastMsgObj = Array.isArray(s.messages) && s.messages.length > 0 ? s.messages[s.messages.length - 1] : null;
      return {
        id,
        chat_id: id,
        sender_id: s.sender_id || id,
        name: s.sender_name || s.name || `Customer (${s.sender_id || id})`,
        sender_name: s.sender_name || s.name || `Customer (${s.sender_id || id})`,
        sender_avatar: s.sender_avatar || "",
        platform,
        channel_type: channelType,
        last_message: s.last_message || lastMsgObj?.message_text || "",
        last_message_at: s.last_message_at || lastMsgObj?.timestamp || new Date().toISOString(),
        unread_count: Number(s.unread_count || 0),
        admin_takeover: Boolean(s.admin_takeover),
        messages_count: Array.isArray(s.messages) ? s.messages.length : 0
      };
    })
    .filter(item => {
      if (!platformFilter || platformFilter === 'all') return true;
      return item.platform === platformFilter || item.channel_type === platformFilter;
    })
    .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
}

app.get(['/api/conversations', '/api/live-conversations'], (req, res) => {
  const list = buildConversationsList(req.query.platform);
  res.json(list);
});

app.get('/api/conversations-check', (req, res) => {
  const since = req.query.since || '';
  const list = buildConversationsList(req.query.platform);
  const latestTimestamp = list.length > 0 ? list[0].last_message_at : null;
  const changed = !since || !latestTimestamp || new Date(latestTimestamp) > new Date(since);
  res.json({
    changed,
    latest_timestamp: latestTimestamp,
    conversations: changed ? list : undefined
  });
});

app.get('/api/conversations/:id', (req, res) => {
  const id = req.params.id;
  const session = memorySessions.get(id) || memorySessions.get(`fb_${id}`) || memorySessions.get(`wa_${id}`);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

app.get('/api/messages', (req, res) => {
  const chatId = req.query.chat_id || req.query.id || '';
  const session = memorySessions.get(chatId) || memorySessions.get(`fb_${chatId}`) || memorySessions.get(`wa_${chatId}`);
  if (!session) {
    return res.json({ messages: [], admin_takeover: false });
  }
  res.json({
    chat_id: session.chat_id || chatId,
    sender_name: session.sender_name,
    platform: session.platform || 'facebook',
    admin_takeover: Boolean(session.admin_takeover),
    messages: session.messages || []
  });
});

app.post('/api/conversations/read', (req, res) => {
  const chatId = req.body?.chat_id || req.body?.id;
  const session = memorySessions.get(chatId);
  if (session) {
    session.unread_count = 0;
    saveSession(chatId, session);
  }
  res.json({ success: true });
});

app.post('/api/handover', (req, res) => {
  const chatId = req.body?.chat_id || req.body?.id;
  if (!chatId) return res.status(400).json({ error: "Missing chat_id" });
  let session = memorySessions.get(chatId);
  if (!session) {
    session = {
      chat_id: chatId,
      sender_id: chatId.replace(/^(fb_|wa_)/, ''),
      platform: chatId.startsWith('wa_') ? 'whatsapp' : 'facebook',
      channel_type: chatId.startsWith('wa_') ? 'whatsapp' : 'messenger',
      messages: [],
      unread_count: 0,
      admin_takeover: false
    };
  }
  if (typeof req.body.admin_takeover === 'boolean') {
    session.admin_takeover = req.body.admin_takeover;
  } else if (req.body.mode) {
    session.admin_takeover = (req.body.mode === 'human' || req.body.mode === 'admin');
  } else {
    session.admin_takeover = !Boolean(session.admin_takeover);
  }
  saveSession(chatId, session);
  res.json({
    success: true,
    chat_id: chatId,
    admin_takeover: session.admin_takeover
  });
});

app.post(['/api/send-reply', '/api/messages/send', '/api/admin-reply'], async (req, res) => {
  try {
    const rawChatId = req.body?.chat_id || req.body?.recipient_id || req.body?.sender_id || '';
    const text = (req.body?.message_text || req.body?.text || '').trim();
    if (!rawChatId || !text) {
      return res.status(400).json({ error: "Missing chat_id or message_text" });
    }

    let session = memorySessions.get(rawChatId)
      || memorySessions.get(`fb_${rawChatId}`)
      || memorySessions.get(`wa_${rawChatId}`);

    const isWhatsApp = (req.body?.platform === 'whatsapp')
      || String(rawChatId).startsWith('wa_')
      || String(rawChatId).endsWith('@s.whatsapp.net')
      || (session && session.platform === 'whatsapp');

    const chatId = session?.chat_id || (isWhatsApp
      ? (String(rawChatId).startsWith('wa_') ? rawChatId : `wa_${String(rawChatId).replace(/@.*$/, '')}`)
      : (String(rawChatId).startsWith('fb_') ? rawChatId : `fb_${rawChatId}`));

    if (!session) {
      session = {
        chat_id: chatId,
        sender_id: String(rawChatId).replace(/^(fb_|wa_)/, ''),
        sender_name: req.body?.sender_name || `Customer (${rawChatId})`,
        platform: isWhatsApp ? 'whatsapp' : 'facebook',
        channel_type: isWhatsApp ? 'whatsapp' : 'messenger',
        messages: [],
        unread_count: 0,
        admin_takeover: true
      };
    }

    let sendResult = null;
    if (isWhatsApp) {
      const targetJid = session.wa_jid || session.sender_id || rawChatId;
      sendResult = await sendWhatsAppTextMessage(targetJid, text);
    } else {
      const targetFbId = String(session.sender_id || rawChatId).replace(/^fb_/, '');
      sendResult = await sendFacebookMessage(targetFbId, text);
    }

    if (!Array.isArray(session.messages)) session.messages = [];
    session.messages.push({
      id: `admin_${Date.now()}`,
      sender_type: "admin",
      sender_name: "Admin",
      message_text: text,
      timestamp: new Date().toISOString()
    });
    session.last_message = text;
    session.last_message_at = new Date().toISOString();
    session.unread_count = 0;
    // অ্যাডমিন নিজে মেসেজ পাঠালে সেশনটি অটোমেটিক Admin Takeover মোডে যাবে (যদি আলাদা করে false না পাঠানো হয়)
    if (req.body?.keep_ai_active !== true) {
      session.admin_takeover = true;
    }
    saveSession(chatId, session);

    res.json({
      success: true,
      chat_id: chatId,
      platform: isWhatsApp ? 'whatsapp' : 'facebook',
      admin_takeover: session.admin_takeover,
      result: sendResult
    });
  } catch (err) {
    console.error("Admin send-reply error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai-suggest-reply', async (req, res) => {
  try {
    const chatId = req.body?.chat_id || '';
    const session = memorySessions.get(chatId) || { messages: req.body?.history || [] };
    const lastCustomerMsg = req.body?.customer_message
      || [...(session.messages || [])].reverse().find(m => m.sender_type === 'customer')?.message_text
      || "প্রোডাক্ট সম্পর্কে জানতে চাই";

    const aiDecision = await callGeminiSalesAI(lastCustomerMsg, session.messages || [], session);
    res.json({
      success: true,
      suggestion: aiDecision?.reply || "ধন্যবাদ আমাদের মেসেজ করার জন্য! কীভাবে আপনাকে সাহায্য করতে পারি?"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${CONFIG.geminiApiKey}`;
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
            if (p.thought) continue;
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

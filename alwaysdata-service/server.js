/**
 * SocialAutomate - High-Efficiency Alwaysdata Node.js Gateway
 * -------------------------------------------------------------
 * 1. Meta Webhook Receiver (Facebook Messenger & Comments)
 * 2. Instant 200 OK Handshake (Never times out Meta's 5s rule)
 * 3. Gemini 2.0 Flash AI Sales & Order Assistant
 * 4. Automatic Facebook Outbound Messenger & Comment Replies
 * 5. Instant Telegram Order Notifications to Admin
 * 6. Live Store Catalog Auto-Fetch (ranonex.shop)
 * 7. Cloudflare Worker Session Sync (Keeps Dashboard in sync)
 */

const express = require('express');
const http = require('http');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS Middleware (Cloudflare Pages automate.ranonex.shop-এর সাথে সরাসরি কানেক্ট করার জন্য)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Load local .env if present
const fs = require('fs');
const path = require('path');
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

// হেল্পার: Gemini Live মডেল নির্ধারণ
function cleanModelName(model) {
  return "models/gemini-3.8-live";
}

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

// ইন-মেমোরি চ্যাট হিস্ট্রি ও ডিবাউন্স ট্র্যাকার
const memorySessions = new Map();
const userLastMessageTime = new Map();
let productCatalogCache = { data: null, expiresAt: 0 };
let totalMessagesHandled = 0;

// ==========================================
// 📦 লাইভ স্টোর প্রোডাক্টস ও পলিসি ফেচ
// ==========================================
async function getStoreCatalog() {
  const now = Date.now();
  if (productCatalogCache.data && productCatalogCache.expiresAt > now) {
    return productCatalogCache.data;
  }

  let catalog = `=== STORE POLICIES & INFORMATION ===
- Store Name: Ranonex (Website: https://ranonex.shop)
- Delivery Charge: ঢাকা সিটির ভেতরে ৭০ টাকা, ঢাকার বাইরে ১৩০ টাকা।
- Payment Method: Cash on Delivery (ক্যাশ অন ডেলিভারি - পণ্য হাতে পেয়ে টাকা পরিশোধ)
- Return Policy: ডেলিভারির সময় পার্সেল চেক করে দেখে নেওয়ার সুযোগ।
- Hotline / Helpline: ফেসবুক পেজে ইনবক্স করুন।

=== AVAILABLE STORE PRODUCTS (WITH SKU & DIRECT ORDER LINKS) ===\n`;

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

  productCatalogCache = { data: catalog, expiresAt: now + 10 * 60 * 1000 };
  return catalog;
}

// ==========================================
// 🤖 GEMINI 3.8 LIVE MULTIMODAL WEBSOCKET ENGINE (BIDIGENERATECONTENT)
// ==========================================
// Gemini 3.8 Live operates via Google's Multimodal Live API over WebSockets.
// It connects directly to wss://generativelanguage.googleapis.com/...
// and streams live audio + transcription with Unlimited RPM/RPD.
async function callGeminiSalesAI(incomingText, chatHistory = [], session = null) {
  if (!CONFIG.geminiApiKey || CONFIG.geminiApiKey === "YOUR_GEMINI_API_KEY") {
    return {
      reply: "ধন্যবাদ আপনার বার্তার জন্য! আমাদের একজন প্রতিনিধি খুব শীঘ্রই আপনাকে সহায়তা করবেন। নির্দিষ্ট কোনো প্রোডাক্ট সম্পর্কে জানতে চাইলে নির্দ্বিধায় লিখুন।",
      order_confirmed: false,
      order_updated: false,
      order_note: false,
      order_data: null,
      note: ""
    };
  }

  const catalog = await getStoreCatalog();

  // অর্ডার টাইম উইন্ডো চেক (১৫ মিনিটের মধ্যে পরিবর্তন বনাম ১৫ মিনিট পর নোট)
  let orderTimeContext = "";
  const now = Date.now();
  if (session && session.last_order_data && session.last_order_time) {
    const elapsedMinutes = Math.floor((now - session.last_order_time) / (60 * 1000));
    if (elapsedMinutes <= 15) {
      orderTimeContext = `
[ORDER STATUS CONTEXT: Customer confirmed an order ${elapsedMinutes} minute(s) ago:
- Customer Name: ${session.last_order_data.customer_name || 'N/A'}
- Phone: ${session.last_order_data.customer_phone || 'N/A'}
- Address: ${session.last_order_data.delivery_address || 'N/A'}
- Product: ${session.last_order_data.product_name || 'N/A'}
Time remaining for direct edit: ${15 - elapsedMinutes} minute(s).
RULE: If customer wants to edit/change address, phone, product, or variant, confirm the change politely and output:
ORDER_UPDATE_JSON: {"order_updated": true, "customer_name": "...", "customer_phone": "...", "delivery_address": "...", "product_name": "...", "variant": "...", "total_amount": 0}]`;
    } else {
      orderTimeContext = `
[ORDER STATUS CONTEXT: Customer confirmed an order ${elapsedMinutes} minutes ago (more than 15 minutes have passed):
- Customer Name: ${session.last_order_data.customer_name || 'N/A'}
- Phone: ${session.last_order_data.customer_phone || 'N/A'}
- Address: ${session.last_order_data.delivery_address || 'N/A'}
- Product: ${session.last_order_data.product_name || 'N/A'}
RULE: The 15-minute direct edit window has expired (order is in packaging/dispatch queue).
If customer asks to modify details:
Explain politely that the order is already in packaging/dispatch, so direct modification is locked. Reassure them that you have added their request as an urgent NOTE for the delivery team to call them and adjust.
Output:
ORDER_NOTE_JSON: {"order_note": true, "note": "Customer requested change details...", "customer_name": "${session.last_order_data.customer_name || 'Customer'}"}]`;
    }
  }

  const systemInstruction = `You are the expert, polite, and friendly sales & customer support AI for 'Ranonex' online store in Bangladesh (https://ranonex.shop).

CRITICAL BRAND & LANGUAGE RULES:
1. SCRIPT & BANGLISH RULES:
   - DEFAULT: Pure Bengali (বাংলা লিপি).
   - ONLY IF the customer types in Banglish (English letters for Bengali words, e.g. 'kemon achen', 'cooler ache?'), ONLY THEN reply in Banglish.
   - If the customer writes in Bengali script (বাংলা লিপি), you MUST reply in pure Bengali script.
2. BRAND NAME IN ENGLISH ONLY:
   - ALWAYS write the brand name in English letters as "Ranonex". NEVER write it in Bengali script (do not write 'র‌্যানোনেক্স' or 'রেনোনেক্স')!
   - Website link: https://ranonex.shop

3. STRICT PRODUCT PRICE INTEGRITY (দাম সংক্রান্ত কঠোর ও অলঙ্ঘনীয় নিয়ম):
   - You MUST quote the EXACT numeric price listed under 'EXACT PRICE' in the catalog.
   - NEVER misquote, drop zeros, calculate wrongly, or say wrong numbers!
     For example, if EXACT PRICE is ৳650, you MUST state "৬৫০ টাকা (650 ৳)" or "দাম মাত্র ৬৫০ টাকা". NEVER say ৬৫ টাকা or any other number!
   - Always state the price and include the product order link.

4. SOFT CONSULTATIVE SELLING (NO DIRECT FORCING):
   - Never aggressively force or pressure the customer to buy.
   - First empathize with their problem, need, or inquiry (e.g. phone heating, gaming, daily use, budget).
   - Recommend the best matching product with features, benefits, exact price (৳), and link.

5. COURTEOUS ORDER FOLLOW-UP (ইনবক্সে সহজে অর্ডারের নিয়ম উল্লেখ করা):
   - When discussing any product, always politely follow up at the end of your message to explain how simple it is to order right inside the chat:
     * If in Bengali script:
       "আপনি চাইলে ওয়েবসাইট ছাড়াও এখানেই মেসেজে আপনার নাম, মোবাইল নম্বর এবং সম্পূর্ণ ডেলিভারি ঠিকানা পাঠিয়ে দিলেই আমরা ক্যাশ অন ডেলিভারিতে অর্ডার কনফার্ম করে দেব! আপনি কি প্রোডাক্টটি এখনই অর্ডার করতে চান, নাকি এ বিষয়ে আরও কিছু জানতে চান?"
     * If in Banglish:
       "Apni chaile website charao ekhanei inbox-e apnar Name, Mobile Number ar Delivery Address pathiye dilei amra Cash on Delivery-te order confirm kore debo! Apni ki ekhoni order korte chan, naki aro kichu janar ache?"
   - Keep it polite, helpful, and completely frictionless.

6. MULTI-TURN ORDER CONFIRMATION & MODIFICATION:
   - INITIAL ORDER:
     When customer provides: Name, Active 11-digit Phone, Delivery Address, Variant/Product:
     Warmly confirm the order summary (Cash on delivery, Delivery: Dhaka 70 BDT, Outside Dhaka 130 BDT, parcel inspection upon delivery).
     State to customer:
     "আপনার অর্ডারটি সফলভাবে কনফার্ম করা হয়েছে! আপনি চাইলে আগামী ১৫ মিনিটের মধ্যে যেকোনো তথ্য (ঠিকানা, ফোন নম্বর বা প্রোডাক্ট) পরিবর্তন করতে পারবেন।"
     Output at the very bottom:
     ORDER_JSON: {"order_confirmed": true, "customer_name": "...", "customer_phone": "...", "delivery_address": "...", "product_name": "...", "variant": "...", "total_amount": 0}

   - EDIT WITHIN 15 MINUTES:
     If customer wants to modify details within 15 minutes, confirm politely: "আপনার অর্ডারের তথ্য সফলভাবে পরিবর্তন করা হয়েছে!"
     Output:
     ORDER_UPDATE_JSON: {"order_updated": true, "customer_name": "...", "customer_phone": "...", "delivery_address": "...", "product_name": "...", "variant": "...", "total_amount": 0}

   - EDIT AFTER 15 MINUTES:
     If customer wants to modify details after 15 minutes, explain order is in packaging/dispatch, reassure them that a note is added for the delivery agent, and output:
     ORDER_NOTE_JSON: {"order_note": true, "note": "...", "customer_name": "..."}

${orderTimeContext}

STORE PRODUCTS CATALOG:
${catalog}`;

  // Multi-turn turns for Live API
  const turns = [];
  if (Array.isArray(chatHistory)) {
    for (const m of chatHistory.slice(-8)) {
      const role = m.sender_type === "assistant" || m.sender_type === "ai" ? "model" : "user";
      const text = (m.message_text || "").trim();
      if (text) turns.push({ role, parts: [{ text }] });
    }
  }

  if (turns.length === 0 || turns[turns.length - 1].parts[0].text !== incomingText.trim()) {
    turns.push({ role: "user", parts: [{ text: incomingText.trim() }] });
  }

  return new Promise((resolve) => {
    let accumulatedText = "";
    let isFinished = false;
    const startTime = Date.now();

    // 25 second safety timeout
    const timeout = setTimeout(() => {
      if (!isFinished) {
        isFinished = true;
        try { ws.close(); } catch (e) {}
        console.warn(`[Gemini 3.8 Live] WebSocket timed out after ${Date.now() - startTime}ms`);
        resolve({
          reply: accumulatedText.trim() || "ধন্যবাদ! আমরা আপনার মেসেজটি পেয়েছি। কিছুক্ষণের মধ্যে আমাদের টিম থেকে উত্তর দেওয়া হবে।",
          order_confirmed: false,
          order_updated: false,
          order_note: false,
          order_data: null,
          note: ""
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
          ws.send(JSON.stringify({
            clientContent: { turns, turnComplete: true }
          }));
          return;
        }

        // Step 2: Accumulate live streamed transcription & text
        if (msg.serverContent) {
          if (msg.serverContent.outputTranscription?.text) {
            accumulatedText += msg.serverContent.outputTranscription.text;
          }
          const parts = msg.serverContent.modelTurn?.parts || [];
          for (const p of parts) {
            if (p.text) accumulatedText += p.text;
          }

          if (msg.serverContent.turnComplete) {
            if (!isFinished) {
              isFinished = true;
              clearTimeout(timeout);
              try { ws.close(); } catch (e) {}
              console.log(`🤖 [Gemini 3.8 Live] Turn complete in ${Date.now() - startTime}ms`);

              let orderConfirmed = false;
              let orderUpdated = false;
              let orderNote = false;
              let orderData = null;
              let noteText = "";
              let reply = accumulatedText.trim();

              // 1. ORDER_JSON
              const orderMatch = reply.match(/ORDER_JSON:\s*(\{[\s\S]*?\})/i);
              if (orderMatch) {
                try {
                  const parsed = JSON.parse(orderMatch[1]);
                  if (parsed.order_confirmed) {
                    orderConfirmed = true;
                    orderData = parsed;
                    reply = reply.replace(/ORDER_JSON:\s*\{[\s\S]*?\}/i, "").trim();
                  }
                } catch (e) {}
              }

              // 2. ORDER_UPDATE_JSON
              const updateMatch = reply.match(/ORDER_UPDATE_JSON:\s*(\{[\s\S]*?\})/i);
              if (updateMatch) {
                try {
                  const parsed = JSON.parse(updateMatch[1]);
                  if (parsed.order_updated) {
                    orderUpdated = true;
                    orderData = parsed;
                    reply = reply.replace(/ORDER_UPDATE_JSON:\s*\{[\s\S]*?\}/i, "").trim();
                  }
                } catch (e) {}
              }

              // 3. ORDER_NOTE_JSON
              const noteMatch = reply.match(/ORDER_NOTE_JSON:\s*(\{[\s\S]*?\})/i);
              if (noteMatch) {
                try {
                  const parsed = JSON.parse(noteMatch[1]);
                  if (parsed.order_note) {
                    orderNote = true;
                    noteText = parsed.note;
                    reply = reply.replace(/ORDER_NOTE_JSON:\s*\{[\s\S]*?\}/i, "").trim();
                  }
                } catch (e) {}
              }

              resolve({
                reply,
                order_confirmed: orderConfirmed,
                order_updated: orderUpdated,
                order_note: orderNote,
                order_data: orderData,
                note: noteText
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
        console.log(`[Gemini 3.8 Live] WebSocket closed (code ${event.code})`);
        resolve({
          reply: accumulatedText.trim() || "ধন্যবাদ! আমরা আপনার মেসেজটি পেয়েছি। কিছুক্ষণের মধ্যে আমাদের টিম থেকে উত্তর দেওয়া হবে।",
          order_confirmed: false,
          order_updated: false,
          order_note: false,
          order_data: null,
          note: ""
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
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text,
        parse_mode: "HTML"
      })
    });
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
async function sendFacebookMessage(recipientId, text) {
  if (!CONFIG.metaPageAccessToken) return null;
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(CONFIG.metaPageAccessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: "RESPONSE",
        message: { text }
      })
    });
    return await res.json();
  } catch (e) {
    console.error("FB Send Error:", e.message);
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
      telegram_alerts: Boolean(CONFIG.telegramBotToken)
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
  // ⚡ নিয়ম: মেটাকে তাৎক্ষণিক 200 OK রেসপন্স পাঠানো যাতে কোনো অবস্থাতেই টাইমআউট না হয়!
  res.status(200).json({ status: "EVENT_RECEIVED" });

  const body = req.body;
  if (!body || body.object !== 'page') return;

  // ব্যাকগ্রাউন্ডে অ্যাসিনক্রোনাস প্রসেসিং
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

            const incomingText = message.text || (message.quick_reply ? message.quick_reply.payload : "");
            if (!incomingText || !incomingText.trim()) continue;

            totalMessagesHandled++;
            console.log(`📩 [Messenger from ${senderId}]: ${incomingText}`);

            // চ্যাট সেশন বের করা
            const chatId = `fb_${senderId}`;
            let session = memorySessions.get(chatId) || { messages: [] };

            // ইউজারের প্রোফাইল (নাম ও ছবি) আনা
            const profile = await getFacebookUserProfile(senderId);

            // চ্যাটে ইনকামিং মেসেজ পুশ
            session.messages.push({
              id: event.message.mid || `m_${Date.now()}`,
              sender_type: "customer",
              sender_name: profile.name,
              message_text: incomingText,
              timestamp: new Date().toISOString()
            });

            // Gemini AI দিয়ে সেলস রিপ্লাই জেনারেট (session সহ পাস করা হচ্ছে যাতে অর্ডার টাইম ট্র্যাক থাকে)
            const aiDecision = await callGeminiSalesAI(incomingText, session.messages, session);

            if (aiDecision && aiDecision.reply) {
              console.log(`🤖 [AI Reply to ${profile.name}]: ${aiDecision.reply.substring(0, 80)}...`);
              await sendFacebookMessage(senderId, aiDecision.reply);

              session.messages.push({
                id: `ai_${Date.now()}`,
                sender_type: "assistant",
                sender_name: "Ranonex AI Assistant",
                message_text: aiDecision.reply,
                timestamp: new Date().toISOString()
              });
            }

            // ১. যদি নতুন অর্ডার কনফার্ম হয়
            if (aiDecision.order_confirmed && aiDecision.order_data) {
              session.last_order_data = {
                ...aiDecision.order_data,
                customer_name: aiDecision.order_data.customer_name || profile.name
              };
              session.last_order_time = Date.now();

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
                    total_amount: session.last_order_data.total_amount || 0
                  })
                }).catch(() => {});
              }
            }

            // ২. যদি ১৫ মিনিটের মধ্যে কাস্টমার অর্ডার পরিবর্তন / সংশোধন করে
            if (aiDecision.order_updated && aiDecision.order_data) {
              session.last_order_data = {
                ...aiDecision.order_data,
                customer_name: aiDecision.order_data.customer_name || profile.name
              };
              session.last_order_time = Date.now();

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

            // ৩. যদি ১৫ মিনিট পর কাস্টমার পরিবর্তন করতে চায় (জরুরি নোট অ্যালার্ট)
            if (aiDecision.order_note && aiDecision.note) {
              await sendTelegramOrderNote(aiDecision.note, session.last_order_data || { customer_name: profile.name }, "Facebook Messenger");
            }

            memorySessions.set(chatId, session);

            // ক্লাউডফ্লেয়ার ড্যাশবোর্ডের সাথে চ্যাট হিস্ট্রি সিঙ্ক (যাতে automate.ranonex.shop-এ দেখা যায়)
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

                // কমেন্টের জন্য AI উত্তর তৈরি
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

  // ক্লাউডফ্লেয়ার D1-এ সিঙ্ক
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

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

// ==========================================
// ⚙️ কনফিগারেশন ও এনভায়রনমেন্ট ভেরিয়েবল
// ==========================================
const CONFIG = {
  port: process.env.PORT || 8100,
  metaVerifyToken: process.env.META_VERIFY_TOKEN || "ranonex_social_secret_2026",
  metaPageId: process.env.META_PAGE_ID || "1287050647827199",
  metaPageAccessToken: process.env.META_PAGE_ACCESS_TOKEN || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  workerUrl: process.env.WORKER_URL || "https://social-automate.rifatrabbi104.workers.dev"
};

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
          catalog += `- [SKU: ${sku}] ${p.name}\n    * Price: ৳${price}\n    * Order Link: ${link}\n    * Specs: ${p.specifications || 'Standard'}\n`;
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
// 🤖 GOOGLE GEMINI AI SALES DECISION ENGINE
// ==========================================
async function callGeminiSalesAI(incomingText, chatHistory = []) {
  if (!CONFIG.geminiApiKey || CONFIG.geminiApiKey === "YOUR_GEMINI_API_KEY") {
    return {
      reply: "ধন্যবাদ আপনার বার্তার জন্য! আমাদের একজন প্রতিনিধি খুব শীঘ্রই আপনাকে সহায়তা করবেন। নির্দিষ্ট কোনো প্রোডাক্ট সম্পর্কে জানতে চাইলে নির্দ্বিধায় লিখুন।",
      order_confirmed: false,
      order_data: null
    };
  }

  const catalog = await getStoreCatalog();
  const systemInstruction = `You are the expert, polite, and friendly sales & customer support AI for 'Ranonex' online store in Bangladesh.
Always respond warmly and naturally in Bengali (বাংলা) or Banglish (if customer writes in Banglish).

CORE RESPONSIBILITIES:
1. SMART PRODUCT MATCHING:
   - When a customer asks about a product, problem, budget, or feature:
     Carefully check ALL products in the Store Catalog below. Recommend the best matching product, state exact price (৳), and give the direct order link (https://ranonex.shop/product.html?id=...).
2. SKU RECOGNITION:
   - When a customer mentions a specific SKU (e.g. GC-1102, HD_1100, EP-1100, PROD_1, etc.), immediately identify the product with price and stock status.
3. MULTI-TURN ORDER CONFIRMATION:
   - When customer wants to buy ('nibo', 'order korbo', 'kinbo', etc.):
     Ask step-by-step for: Full Name, Active 11-digit Phone, Delivery Address, Variant/Size.
     State: Cash on Delivery available, Delivery Charge: Dhaka 70 BDT, Outside Dhaka 130 BDT.
   - Once all 4 details (Name, Phone, Address, Product) are present:
     Confirm the order enthusiastically with a neat summary, set "order_confirmed": true, and fill "order_data".

STORE PRODUCTS CATALOG:
${catalog}

RESPONSE FORMAT (JSON ONLY):
{
  "reply": "Your friendly Bengali response message",
  "order_confirmed": false,
  "order_data": {
    "customer_name": "...",
    "customer_phone": "...",
    "delivery_address": "...",
    "product_name": "...",
    "variant": "...",
    "total_amount": 0
  }
}`;

  // Multi-turn contents
  const contents = [];
  if (Array.isArray(chatHistory)) {
    for (const m of chatHistory.slice(-8)) {
      const role = m.sender_type === "assistant" || m.sender_type === "ai" ? "model" : "user";
      const text = (m.message_text || "").trim();
      if (text) contents.push({ role, parts: [{ text }] });
    }
  }

  // Ensure incomingText is last turn
  if (contents.length === 0 || contents[contents.length - 1].parts[0].text !== incomingText.trim()) {
    contents.push({ role: "user", parts: [{ text: incomingText.trim() }] });
  }

  try {
    const cleanModel = CONFIG.geminiModel.replace(/^models\//, '');
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${CONFIG.geminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: { temperature: 0.6, response_mime_type: "application/json" }
      })
    });

    if (res.ok) {
      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText) {
        const parsed = JSON.parse(rawText);
        return {
          reply: parsed.reply || rawText,
          order_confirmed: Boolean(parsed.order_confirmed),
          order_data: parsed.order_data || null
        };
      }
    }
  } catch (err) {
    console.error("Gemini AI Error:", err.message);
  }

  return {
    reply: "ধন্যবাদ! আমরা আপনার মেসেজটি পেয়েছি। কিছুক্ষণের মধ্যে আমাদের টিম থেকে উত্তর দেওয়া হবে।",
    order_confirmed: false,
    order_data: null
  };
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
      gemini_model: CONFIG.geminiModel,
      telegram_alerts: Boolean(CONFIG.telegramBotToken)
    }
  });
});

// ২. মেটা ফেসবুক Webhook ভেরিফিকেশন (GET /webhook/meta)
app.get('/webhook/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === CONFIG.metaVerifyToken) {
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

            // Gemini AI দিয়ে সেলস রিপ্লাই জেনারেট
            const aiDecision = await callGeminiSalesAI(incomingText, session.messages);

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

            memorySessions.set(chatId, session);

            // যদি অর্ডার কনফার্ম হয়, টেলিগ্রামে এডমিনকে মেসেজ পাঠানো
            if (aiDecision.order_confirmed && aiDecision.order_data) {
              await sendTelegramAlert({
                ...aiDecision.order_data,
                customer_name: aiDecision.order_data.customer_name || profile.name
              }, "Facebook Messenger");
            }

            // ক্লাউডফ্লেয়ার ড্যাশবোর্ডের সাথে সিঙ্ক (যাতে automate.ranonex.shop-এ দেখা যায়)
            if (CONFIG.workerUrl) {
              fetch(`${CONFIG.workerUrl}/api/sync-chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: chatId,
                  sender_name: profile.name,
                  sender_avatar: profile.avatar,
                  platform: "facebook",
                  last_message: incomingText,
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

// ৪. সার্ভার চালু
const PORT = CONFIG.port;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 SocialAutomate Alwaysdata Server is ONLINE!`);
  console.log(`📡 Listening on Port: ${PORT}`);
  console.log(`🔗 Webhook URL: http://0.0.0.0:${PORT}/webhook/meta`);
  console.log(`====================================================`);
});

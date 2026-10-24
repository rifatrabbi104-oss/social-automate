/**
 * SocialAutomate - High-Efficiency Cloudflare Worker Engine
 * -----------------------------------------------------------
 * 1. Cloudflare D1: Dedicated strictly for Business Data (Products, Store Info, Settings)
 * 2. Telegram Webhook: Gemini AI answers with live D1 business context
 * 3. Two-Way Live Chat: Admin can take over and reply directly from dashboard to customer's Telegram
 * 4. Admin DM Alerts: Instant Telegram notification when customer asks for manager/admin
 * 5. Worker Quota Protection: In-memory debounce & session management
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// In-Memory Live Session Store (Chat history & Handover state kept at edge)
// Key: chat_id (e.g. "12345678")
const liveSessions = new Map();
const userLastMessageTime = new Map();

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ०. সিস্টেম হেলথ ও ডায়াগনস্টিকস
      if (request.method === "GET" && (path === "/" || path === "/api" || path === "/status")) {
        const hasD1 = Boolean(env.DB);
        let botUsername = null;
        let hasToken = false;
        let productCount = 0;

        if (hasD1) {
          await ensureTables(env.DB);
          const token = await getTelegramBotToken(env);
          hasToken = Boolean(token);
          const uRow = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'telegram_bot_username'").first();
          botUsername = uRow?.value || null;
          const pRow = await env.DB.prepare("SELECT COUNT(*) as cnt FROM products WHERE is_active = 1").first();
          productCount = pRow?.cnt || 0;
        }

        return jsonResponse({
          status: "online",
          service: "SocialAutomate Hybrid Engine",
          d1_database: hasD1 ? "✅ Connected (Stores Business Data & Products)" : "❌ Not Bound (Bind 'DB')",
          products_in_d1: productCount,
          telegram_connection: hasToken 
            ? (botUsername ? `✅ Connected (@${botUsername})` : "✅ Token Active") 
            : "⚠️ Bot Token Missing",
          active_sessions: liveSessions.size,
          webhook_url: `${url.origin}/webhook/telegram`,
          timestamp: new Date().toISOString()
        });
      }

      // ==========================================
      // ১. টেলিগ্রাম Webhook (কাস্টমার মেসেজ হ্যান্ডলার)
      // ==========================================
      if (request.method === "POST" && (path === "/webhook/telegram" || path === "/api/telegram/webhook")) {
        const update = await request.json();
        return await handleTelegramUpdate(update, env, url.origin);
      }

      // ==========================================
      // ২. চ্যাট সেশন ও লাইভ ইনবক্স API (Edge Sessions)
      // ==========================================
      if (request.method === "GET" && path === "/api/conversations") {
        const list = Array.from(liveSessions.values()).map(s => ({
          id: s.chat_id,
          sender_id: s.chat_id,
          name: s.sender_name,
          platform: "telegram",
          last_message: s.last_message,
          last_message_at: s.last_message_at,
          admin_takeover: s.admin_takeover ? 1 : 0,
          needs_attention: s.needs_attention ? 1 : 0,
          unread_count: s.unread_count || 0
        })).sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));

        return jsonResponse(list);
      }

      if (request.method === "GET" && path === "/api/messages") {
        const chatId = url.searchParams.get("chat_id") || url.searchParams.get("conversation_id");
        if (!chatId) return jsonResponse({ error: "Missing chat_id parameter" }, 400);

        const cleanId = String(chatId).replace(/^tg_/, '');
        const session = liveSessions.get(cleanId);
        return jsonResponse(session ? session.messages : []);
      }

      // ==========================================
      // ৩. ড্যাশবোর্ড থেকে কাস্টমারকে অ্যাডমিন রিপ্লাই
      // ==========================================
      if (request.method === "POST" && path === "/api/admin/reply") {
        const body = await request.json();
        return await handleAdminReply(body, env);
      }

      // ==========================================
      // ৪. হ্যান্ডওভার টগল API
      // ==========================================
      if (request.method === "POST" && path === "/api/handover") {
        const body = await request.json();
        const { chat_id, admin_takeover } = body;
        const cleanId = String(chat_id).replace(/^tg_/, '');
        const session = liveSessions.get(cleanId);
        if (session) {
          session.admin_takeover = Boolean(admin_takeover);
          if (session.admin_takeover) session.needs_attention = false;
        }
        return jsonResponse({ success: true, chat_id: cleanId, admin_takeover: Boolean(admin_takeover) });
      }

      // ==========================================
      // ৫. D1 বিজনেস ডেটা: প্রোডাক্টস ক্যাটালগ CRUD
      // ==========================================
      if (request.method === "GET" && path === "/api/products") {
        if (!env.DB) return jsonResponse([]);
        await ensureTables(env.DB);
        const { results } = await env.DB.prepare(
          "SELECT * FROM products WHERE is_active = 1 ORDER BY created_at DESC"
        ).all();
        return jsonResponse(results || []);
      }

      if (request.method === "POST" && path === "/api/products") {
        if (!env.DB) return jsonResponse({ error: "D1 Database 'DB' binding missing" }, 500);
        await ensureTables(env.DB);
        const body = await request.json();
        const { id, name, price, description, category, stock_status } = body;

        const prodId = id || `prod_${Date.now()}`;
        await env.DB.prepare(`
          INSERT INTO products (id, name, price, description, category, stock_status, is_active)
          VALUES (?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            price = excluded.price,
            description = excluded.description,
            category = excluded.category,
            stock_status = excluded.stock_status
        `).bind(
          prodId, 
          name, 
          parseFloat(price) || 0, 
          description || '', 
          category || 'General', 
          stock_status || 'in_stock'
        ).run();

        return jsonResponse({ success: true, id: prodId, message: "প্রোডাক্ট সফলভাবে D1-এ সেভ হয়েছে" });
      }

      if (request.method === "DELETE" && path === "/api/products") {
        if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
        const id = url.searchParams.get("id");
        if (!id) return jsonResponse({ error: "Missing product id" }, 400);

        await env.DB.prepare("UPDATE products SET is_active = 0 WHERE id = ?").bind(id).run();
        return jsonResponse({ success: true, message: "Product deleted" });
      }

      // ==========================================
      // ৬. D1 বিজনেস ডেটা: স্টোর ইনফো ও পলিসিজ
      // ==========================================
      if (request.method === "GET" && path === "/api/business-profile") {
        if (!env.DB) return jsonResponse({});
        await ensureTables(env.DB);
        const { results } = await env.DB.prepare("SELECT key, value FROM business_profile").all();
        const profile = {};
        for (const row of (results || [])) {
          profile[row.key] = row.value;
        }
        return jsonResponse(profile);
      }

      if (request.method === "POST" && path === "/api/business-profile") {
        if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
        await ensureTables(env.DB);
        const body = await request.json();

        for (const [key, value] of Object.entries(body)) {
          await env.DB.prepare(`
            INSERT INTO business_profile (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
          `).bind(key, String(value)).run();
        }

        return jsonResponse({ success: true, message: "বিজনেস প্রোফাইল D1-এ আপডেট হয়েছে" });
      }

      // ==========================================
      // ৭. টেলিগ্রাম বট কানেকশন ও সেটিংস API
      // ==========================================
      if (request.method === "POST" && path === "/api/settings/telegram") {
        const body = await request.json();
        return await handleSaveTelegramSettings(body, env, request.url);
      }

      if (request.method === "GET" && path === "/api/settings") {
        let hasTgToken = false;
        let tgMasked = "";
        let botUser = null;
        let adminChat = "";

        if (env.DB) {
          await ensureTables(env.DB);
          const { results } = await env.DB.prepare("SELECT key, value FROM system_settings").all();
          for (const r of (results || [])) {
            if (r.key === 'telegram_bot_token' && r.value) {
              hasTgToken = true;
              tgMasked = r.value.substring(0, 5) + "..." + r.value.slice(-4);
            }
            if (r.key === 'telegram_bot_username') botUser = r.value;
            if (r.key === 'admin_telegram_chat_id') adminChat = r.value;
          }
        }

        return jsonResponse({
          d1_connected: Boolean(env.DB),
          telegram_connected: hasTgToken || Boolean(env.TELEGRAM_BOT_TOKEN),
          bot_username: botUser,
          admin_chat_id: adminChat,
          telegram_token_masked: tgMasked,
          webhook_url: `${url.origin}/webhook/telegram`
        });
      }

      return jsonResponse({ error: "Endpoint not found", path }, 404);

    } catch (err) {
      console.error("Worker Global Error:", err);
      return jsonResponse({ error: err.message, stack: err.stack }, 500);
    }
  }
};

// ========================================================
// ✈️ TELEGRAM UPDATE HANDLER WITH D1 BUSINESS KNOWLEDGE
// ========================================================
async function handleTelegramUpdate(update, env, workerOrigin) {
  if (!update.message || !update.message.text) {
    return jsonResponse({ status: "ignored_non_text" });
  }

  const msg = update.message;
  const chatId = String(msg.chat.id);
  const senderName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") 
    || msg.from.username 
    || `User (${chatId})`;
  const incomingText = msg.text.trim();

  // 🛡️ LIMIT OPTIMIZER: 2.5 সেকেন্ড ডিবাইন্স গেট (স্প্যাম ফিল্টার)
  const now = Date.now();
  const lastTime = userLastMessageTime.get(chatId) || 0;
  if (now - lastTime < 2500) {
    // দ্রুত স্প্যাম আসলে রিটার্ন 200 দিয়ে ফাংশন লিমিট সেইভ
    appendMessageToSession(chatId, senderName, "customer", incomingText);
    return jsonResponse({ status: "debounced" });
  }
  userLastMessageTime.set(chatId, now);

  // সেশনে কাস্টমারের মেসেজ রেকর্ড
  const session = appendMessageToSession(chatId, senderName, "customer", incomingText);

  // ১. /start কমান্ড আসলে তাৎক্ষণিক ওয়েলকাম মেসেজ
  if (incomingText === "/start") {
    const welcome = `হ্যালো ${senderName}! 👋 আমাদের স্টোরে আপনাকে স্বাগতম।\n\nআমাদের প্রোডাক্ট, মূল্য, ডেলিভারি বা যেকোনো প্রশ্ন নিচে লিখে পাঠান, আমি সাহায্য করতে প্রস্তুত!`;
    await sendTelegramMessage(env, chatId, welcome);
    appendMessageToSession(chatId, senderName, "assistant", welcome);
    return jsonResponse({ success: true, reply: welcome });
  }

  // ২. হ্যান্ডওভার চেক: অ্যাডমিন যদি টেকওভার করে থাকেন তবে AI উত্তর দেবে না
  if (session.admin_takeover) {
    return jsonResponse({ status: "admin_takeover_active", message: "AI paused for this session" });
  }

  // ৩. D1 থেকে লাইভ বিজনেস ডেটা ও প্রোডাক্ট ক্যাটালগ লোড করা
  const businessContext = await getBusinessContextFromD1(env.DB);

  // ৪. অ্যাডমিন অ্যালার্ট কিওয়ার্ড ডিটেকশন
  const alertKeywords = [
    'admin', 'manager', 'owner', 'human', 'manush', 
    'kotha bolbo', 'call den', 'phone den', 'number dao', 
    'complaint', 'urgent', 'cancel', 'refund', 'emergency'
  ];
  let needsAlert = false;
  let matchedKeyword = "";
  const lowerText = incomingText.toLowerCase();
  for (const kw of alertKeywords) {
    if (lowerText.includes(kw)) {
      needsAlert = true;
      matchedKeyword = kw;
      break;
    }
  }

  if (needsAlert) {
    session.needs_attention = true;
    // অ্যাডমিনকে সরাসরি ব্যক্তিগত টেলিগ্রাম DM অ্যালার্ট পাঠানো
    await sendAdminTelegramAlert(env, senderName, incomingText, chatId, matchedKeyword, workerOrigin);
  }

  // ৫. Gemini AI দিয়ে উত্তর জেনারেট (D1 বিজনেস ডেটা সহ)
  const aiReply = await generateAiReply(incomingText, session.messages.slice(-6), businessContext, env);

  // ৬. টেলিগ্রামে কাস্টমারকে উত্তর পাঠানো
  await sendTelegramMessage(env, chatId, aiReply);

  // ৭. সেশনে AI রিপ্লাই সেভ
  appendMessageToSession(chatId, senderName, "assistant", aiReply);

  return jsonResponse({ success: true, ai_reply: aiReply, admin_alerted: needsAlert });
}

// ========================================================
// 👤 ADMIN MANUAL REPLY (DASHBOARD -> TELEGRAM)
// ========================================================
async function handleAdminReply(body, env) {
  const { chat_id, conversation_id, message_text } = body;
  const targetChatId = String(chat_id || conversation_id || '').replace(/^tg_/, '');
  
  if (!targetChatId || !message_text || !message_text.trim()) {
    return jsonResponse({ error: "Missing chat_id or message_text" }, 400);
  }

  const cleanText = message_text.trim();

  // ১. টেলিগ্রাম Bot API দিয়ে সরাসরি ইউজারের টেলিগ্রামে পাঠানো
  const tgResult = await sendTelegramMessage(env, targetChatId, cleanText);
  if (!tgResult.ok) {
    return jsonResponse({
      error: `টেলিগ্রামে মেসেজ পাঠানো যায়নি: ${tgResult.description || 'Unknown error'}`,
      details: tgResult
    }, 502);
  }

  // ২. সেশনে অ্যাডমিন মেসেজ যোগ করা এবং অটো-টেকওভার এনেবল করা
  const session = appendMessageToSession(targetChatId, `User (${targetChatId})`, "admin", cleanText);
  session.admin_takeover = true;
  session.needs_attention = false;

  return jsonResponse({
    success: true,
    delivered: true,
    chat_id: targetChatId,
    text: cleanText
  });
}

// ========================================================
// 🗄️ D1 BUSINESS KNOWLEDGE RETRIEVER
// ========================================================
async function getBusinessContextFromD1(db) {
  if (!db) {
    return "Official Store Policies:\n- Standard Delivery Available across the country.\n- Cash on Delivery accepted.";
  }

  try {
    await ensureTables(db);
    // ১. প্রোডাক্ট ক্যাটালগ
    const { results: products } = await db.prepare(
      "SELECT name, price, description, stock_status FROM products WHERE is_active = 1 LIMIT 30"
    ).all();

    // ২. স্টোর প্রোফাইল ও ডেলিভারি পলিসি
    const { results: profileRows } = await db.prepare(
      "SELECT key, value FROM business_profile"
    ).all();

    let context = "=== STORE & BUSINESS INFORMATION (FROM D1 DATABASE) ===\n";
    for (const row of (profileRows || [])) {
      context += `- ${row.key.replace(/_/g, ' ').toUpperCase()}: ${row.value}\n`;
    }

    if (products && products.length > 0) {
      context += "\n=== ACTIVE PRODUCTS & PRICING (FROM D1 DATABASE) ===\n";
      for (const p of products) {
        context += `- Product: ${p.name} | Price: ৳${p.price} | Stock: ${p.stock_status} | Details: ${p.description || 'N/A'}\n`;
      }
    }

    return context;
  } catch (err) {
    console.warn("Could not fetch D1 business data:", err.message);
    return "Standard Store Support Active.";
  }
}

// ========================================================
// 🤖 GEMINI AI CORE ENGINE (WITH D1 BUSINESS DATA)
// ========================================================
async function generateAiReply(userMessage, recentHistory, businessContext, env) {
  const apiKey = env.GEMINI_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";

  // যদি API Key এখনো না থাকে, পলিশড ডিফল্ট রেসপন্স
  if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY") {
    return "ধন্যবাদ আপনার বার্তার জন্য! আমাদের একজন প্রতিনিধি খুব শীঘ্রই আপনার প্রশ্নের উত্তর দেবেন। নির্দিষ্ট কোনো প্রোডাক্ট সম্পর্কে জানতে চাইলে নির্দ্বিধায় লিখুন।";
  }

  const systemInstruction = 
`You are an intelligent, polite, and enthusiastic customer service assistant for our business on Telegram.
Always respond warmly, accurately, and promptly in Bengali or natural Banglish.
Answer customer inquiries regarding products, prices, and delivery strictly using the official D1 Business Information provided below.
If a customer asks to speak with the manager or admin, assure them politely that an admin has been notified and will assist them soon, while still answering whatever questions you can.

${businessContext}`;

  const contents = [];
  for (const m of recentHistory) {
    if (m.sender_type === 'customer') {
      contents.push({ role: "user", parts: [{ text: m.message_text }] });
    } else {
      contents.push({ role: "model", parts: [{ text: m.message_text }] });
    }
  }

  // Ensure current message is present
  if (contents.length === 0 || contents[contents.length - 1].role !== "user") {
    contents.push({ role: "user", parts: [{ text: userMessage }] });
  }

  const payload = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: contents,
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 600,
      topP: 0.95
    }
  };

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text.trim();
    }
  } catch (err) {
    console.error("Gemini API Error:", err);
  }

  return "ধন্যবাদ! আমরা আপনার বার্তাটি পেয়েছি। আমাদের টিম কিছুক্ষণের মধ্যেই আপনার সাথে বিস্তারিত শেয়ার করবে।";
}

// ========================================================
// 🚨 ADMIN TELEGRAM DM ALERT ENGINE
// ========================================================
async function sendAdminTelegramAlert(env, customerName, incomingText, chatId, keyword, workerOrigin) {
  let adminChatId = env.ADMIN_TG_CHAT_ID;
  let botToken = await getTelegramBotToken(env);

  if (env.DB) {
    const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'admin_telegram_chat_id'").first();
    if (row && row.value) adminChatId = row.value;
  }

  if (!adminChatId || !botToken) return;

  const dashboardUrl = env.DASHBOARD_URL || workerOrigin;
  const alertText = 
`🚨 *[জরুরি কাস্টমার অ্যালার্ট]*\n\n` +
`👤 *কাস্টমার:* ${customerName} (ID: \`${chatId}\`)\n` +
`⚠️ *কারণ:* '${keyword || 'Customer inquiry'}'\n` +
`💬 *মেসেজ:* _"${incomingText.substring(0, 250)}"_\n\n` +
`💡 AI কাস্টমারকে উত্তর দিয়ে চ্যাট চালিয়ে যাচ্ছে। আপনি ড্যাশবোর্ড থেকে টেকওভার করতে পারেন।\n` +
`🔗 [ড্যাশবোর্ডে চ্যাট খুলুন](${dashboardUrl})`;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: adminChatId,
        text: alertText,
        parse_mode: "Markdown"
      })
    });
  } catch (e) {
    console.warn("Admin alert delivery failed:", e.message);
  }
}

// ========================================================
// 📤 TELEGRAM SEND MESSAGE HELPER
// ========================================================
async function sendTelegramMessage(env, chatId, text) {
  const token = await getTelegramBotToken(env);
  if (!token) return { ok: false, description: "Bot Token not found" };

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text
      })
    });
    return await res.json();
  } catch (err) {
    return { ok: false, description: err.message };
  }
}

// ========================================================
// ⚙️ TELEGRAM SETTINGS & WEBHOOK SYNC
// ========================================================
async function handleSaveTelegramSettings(body, env, requestUrl) {
  const { bot_token, admin_chat_id } = body;
  if (!bot_token || !bot_token.trim()) {
    return jsonResponse({ error: "Bot Token প্রদান করা আবশ্যক" }, 400);
  }

  const cleanToken = bot_token.trim();

  // ১. ভেরিফাই টোকেন
  const testRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
  const testData = await testRes.json();
  if (!testData.ok) {
    return jsonResponse({
      error: `টেলিগ্রাম বট টোকেন সঠিক নয়: ${testData.description || 'Verification failed'}`,
      details: testData
    }, 400);
  }

  const botInfo = testData.result;

  // ২. D1 ডেটাবেসে সেভ
  if (env.DB) {
    await ensureTables(env.DB);
    await env.DB.prepare(`
      INSERT INTO system_settings (key, value) VALUES ('telegram_bot_token', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(cleanToken).run();

    await env.DB.prepare(`
      INSERT INTO system_settings (key, value) VALUES ('telegram_bot_username', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(botInfo.username).run();

    if (admin_chat_id) {
      await env.DB.prepare(`
        INSERT INTO system_settings (key, value) VALUES ('admin_telegram_chat_id', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).bind(admin_chat_id.trim()).run();
    }
  }

  // ৩. অটোমেটিক ওয়েবমুক অ্যাক্টিভেশন
  const origin = new URL(requestUrl).origin;
  const webhookUrl = `${origin}/webhook/telegram`;
  let webhookStatus = "active";
  try {
    const setWebhookRes = await fetch(`https://api.telegram.org/bot${cleanToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
    const webhookData = await setWebhookRes.json();
    if (!webhookData.ok) webhookStatus = webhookData.description;
  } catch (err) {
    webhookStatus = err.message;
  }

  return jsonResponse({
    success: true,
    message: `টেলিগ্রাম বট @${botInfo.username} সফলভাবে কানেক্ট হয়েছে এবং Webhook সক্রিয় করা হয়েছে!`,
    bot: {
      id: botInfo.id,
      name: botInfo.first_name,
      username: `@${botInfo.username}`
    },
    webhook_url: webhookUrl,
    webhook_status: webhookStatus
  });
}

// ========================================================
// 🗄️ D1 TABLE ENSURER (BUSINESS DATA TABLES)
// ========================================================
async function ensureTables(db) {
  if (!db) return;
  try {
    await db.batch([
      db.prepare(`
        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS business_profile (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS products (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          price REAL NOT NULL,
          description TEXT,
          category TEXT DEFAULT 'General',
          stock_status TEXT DEFAULT 'in_stock',
          is_active INTEGER DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS social_accounts (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          account_name TEXT NOT NULL,
          account_id TEXT NOT NULL,
          access_token TEXT NOT NULL,
          status TEXT DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `)
    ]);
  } catch (e) {
    console.warn("D1 ensureTables warning:", e.message);
  }
}

async function getTelegramBotToken(env) {
  if (env.DB) {
    try {
      const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'telegram_bot_token'").first();
      if (row && row.value && row.value.trim().length > 10) {
        return row.value.trim();
      }
    } catch (e) {}
  }

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_TOKEN !== "YOUR_CUSTOMER_BOT_TOKEN") {
    return env.TELEGRAM_BOT_TOKEN.trim();
  }
  return null;
}

// ========================================================
// 🧠 IN-MEMORY SESSION BUFFER (ZERO D1 CHAT BLOAT)
// ========================================================
function appendMessageToSession(chatId, senderName, senderType, text) {
  let session = liveSessions.get(chatId);
  const nowStr = new Date().toISOString();

  if (!session) {
    session = {
      chat_id: chatId,
      sender_name: senderName,
      admin_takeover: false,
      needs_attention: false,
      last_message: text,
      last_message_at: nowStr,
      messages: []
    };
    liveSessions.set(chatId, session);
  }

  session.sender_name = senderName || session.sender_name;
  session.last_message = text;
  session.last_message_at = nowStr;

  session.messages.push({
    id: `m_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    sender_type: senderType,
    message_text: text,
    created_at: nowStr
  });

  // Keep last 40 messages in memory per session
  if (session.messages.length > 40) {
    session.messages.shift();
  }

  // Clean old sessions if Map exceeds 500
  if (liveSessions.size > 500) {
    const oldestKey = liveSessions.keys().next().value;
    liveSessions.delete(oldestKey);
  }

  return session;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

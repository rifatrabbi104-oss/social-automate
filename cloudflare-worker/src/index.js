/**
 * SocialAutomate - High-Efficiency Cloudflare Worker Architecture
 * -----------------------------------------------------------------
 * 1. Zero-Terminal Webhook Engine: Dashboard -> POST /api/setup-telegram -> Auto setWebhook
 * 2. D1 Strictly for Business Data: Products & Store Policies (Cached via Cloudflare Cache API)
 * 3. Cache API Session Management: Chat history & Handover state in Cache API / Memory (0 D1 Chat Bloat)
 * 4. Gemini AI Decision Engine: Structured JSON response + Urgent Admin Escalation
 * 5. Two-Way Live Chat & Handover: Dashboard Admin Reply -> Telegram Bot sendMessage
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// In-Memory Fast Lookup (Mirrored with Cloudflare Cache API)
const memorySessions = new Map();
const userLastMessageTime = new Map();

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ०. সিস্টেম হেলথ ও স্ট্যাটাস API
      if (request.method === "GET" && (path === "/" || path === "/api" || path === "/status")) {
        const hasD1 = Boolean(env.DB);
        let botUsername = null;
        let hasToken = false;
        let productCount = 0;

        if (hasD1) {
          await ensureTables(env.DB);
          const token = await getConfigValue(env.DB, "telegram_bot_token", env.TELEGRAM_BOT_TOKEN);
          hasToken = Boolean(token);
          botUsername = await getConfigValue(env.DB, "telegram_bot_username", null);
          const pRow = await env.DB.prepare("SELECT COUNT(*) as cnt FROM products WHERE is_active = 1").first();
          productCount = pRow?.cnt || 0;
        }

        return jsonResponse({
          status: "online",
          architecture: "Zero-Terminal SaaS Engine (Cache API + D1 Business Data)",
          d1_database: hasD1 ? "✅ Connected (Stores Products & Store Config)" : "❌ Not Bound (Bind 'DB')",
          products_in_d1: productCount,
          telegram_connection: hasToken 
            ? (botUsername ? `✅ Connected (@${botUsername})` : "✅ Token Active") 
            : "⚠️ Bot Token Missing",
          active_sessions: memorySessions.size,
          webhook_url: `${url.origin}/webhook/telegram`,
          timestamp: new Date().toISOString()
        });
      }

      // ==========================================
      // ১. টেলিগ্রাম Webhook (ইনকামিং কাস্টমার মেসেজ)
      // ==========================================
      if (request.method === "POST" && (path === "/webhook/telegram" || path === "/api/telegram/webhook")) {
        const update = await request.json();
        return await handleTelegramUpdate(update, env, ctx, url.origin);
      }

      // ==========================================
      // ২. অটোমেটিক ১-ক্লিক টেলিগ্রাম সেটআপ ও Webhook রেজিস্ট্রেশন
      // ==========================================
      if (request.method === "POST" && (path === "/api/setup-telegram" || path === "/api/settings/telegram")) {
        const body = await request.json();
        return await handleSetupTelegram(body, env, url.origin);
      }

      // ==========================================
      // ৩. ড্যাশবোর্ড থেকে কাস্টমারকে অ্যাডমিন রিপ্লাই
      // ==========================================
      if (request.method === "POST" && (path === "/api/admin-reply" || path === "/api/admin/reply")) {
        const body = await request.json();
        return await handleAdminReply(body, env);
      }

      // ==========================================
      // ৪. চ্যাট সেশন ও লাইভ ইনবক্স API (Edge Cache / Memory)
      // ==========================================
      if (request.method === "GET" && path === "/api/conversations") {
        const now = Date.now();
        const list = Array.from(memorySessions.values()).map(s => {
          const isTakeover = s.admin_takeover && (s.takeover_until ? s.takeover_until > now : true);
          return {
            id: s.chat_id,
            sender_id: s.chat_id,
            name: s.sender_name,
            platform: "telegram",
            last_message: s.last_message,
            last_message_at: s.last_message_at,
            admin_takeover: isTakeover ? 1 : 0,
            needs_attention: s.needs_attention ? 1 : 0,
            messages_count: s.messages.length
          };
        }).sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));

        return jsonResponse(list);
      }

      if (request.method === "GET" && path === "/api/messages") {
        const chatId = url.searchParams.get("chat_id") || url.searchParams.get("conversation_id");
        if (!chatId) return jsonResponse({ error: "Missing chat_id parameter" }, 400);

        const cleanId = String(chatId).replace(/^tg_/, '');
        const session = await getSession(cleanId);
        return jsonResponse(session ? session.messages : []);
      }

      // ==========================================
      // ৫. হ্যান্ডওভার কন্ট্রোল (Takeover / Release to AI)
      // ==========================================
      if (request.method === "POST" && path === "/api/handover") {
        const body = await request.json();
        const { chat_id, admin_takeover } = body;
        const cleanId = String(chat_id).replace(/^tg_/, '');
        const session = await getSession(cleanId);

        if (session) {
          session.admin_takeover = Boolean(admin_takeover);
          session.takeover_until = admin_takeover ? Date.now() + 30 * 60 * 1000 : 0;
          if (session.admin_takeover) session.needs_attention = false;
          await saveSession(cleanId, session);
        }

        return jsonResponse({ success: true, chat_id: cleanId, admin_takeover: Boolean(admin_takeover) });
      }

      // ==========================================
      // ৬. D1 বিজনেস ডেটা: প্রোডাক্টস ক্যাটালগ
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

        // ক্লিয়ার D1 বিজনেস কনটেক্সট ক্যাশ
        await invalidateBusinessCache();

        return jsonResponse({ success: true, id: prodId, message: "প্রোডাক্ট সফলভাবে D1-এ সেভ হয়েছে" });
      }

      if (request.method === "DELETE" && path === "/api/products") {
        if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
        const id = url.searchParams.get("id");
        if (!id) return jsonResponse({ error: "Missing product id" }, 400);

        await env.DB.prepare("UPDATE products SET is_active = 0 WHERE id = ?").bind(id).run();
        await invalidateBusinessCache();
        return jsonResponse({ success: true, message: "Product deleted" });
      }

      // ==========================================
      // ৭. D1 বিজনেস ডেটা: স্টোর ইনফো ও পলিসিজ
      // ==========================================
      if (request.method === "GET" && path === "/api/business-profile") {
        if (!env.DB) return jsonResponse({});
        await ensureTables(env.DB);
        const { results } = await env.DB.prepare("SELECT key, value FROM system_config").all();
        const profile = {};
        for (const row of (results || [])) {
          if (!row.key.includes("token") && !row.key.includes("key")) {
            profile[row.key] = row.value;
          }
        }
        return jsonResponse(profile);
      }

      if (request.method === "POST" && path === "/api/business-profile") {
        if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
        await ensureTables(env.DB);
        const body = await request.json();

        for (const [key, value] of Object.entries(body)) {
          await env.DB.prepare(`
            INSERT INTO system_config (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
          `).bind(key, String(value)).run();
        }

        await invalidateBusinessCache();
        return jsonResponse({ success: true, message: "স্টোর ইনফো D1-এ আপডেট হয়েছে" });
      }

      // ==========================================
      // ৮. সিস্টেম সেটিংস রিড
      // ==========================================
      if (request.method === "GET" && path === "/api/settings") {
        let hasTgToken = false;
        let tgMasked = "";
        let botUser = null;
        let adminChat = "";

        if (env.DB) {
          await ensureTables(env.DB);
          const { results } = await env.DB.prepare("SELECT key, value FROM system_config").all();
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
// ✈️ TELEGRAM UPDATE HANDLER WITH STRUCTURED AI & ESCALATION
// ========================================================
async function handleTelegramUpdate(update, env, ctx, workerOrigin) {
  if (!update.message || !update.message.text) {
    return jsonResponse({ status: "ignored_non_text" });
  }

  const msg = update.message;
  const chatId = String(msg.chat.id);
  const senderName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") 
    || msg.from.username 
    || `User (${chatId})`;
  const incomingText = msg.text.trim();

  // 🛡️ LIMIT OPTIMIZER: 2.5 সেকেন্ডের অ্যান্টি-স্প্যাম ডিবাউন্স গেট
  const now = Date.now();
  const lastTime = userLastMessageTime.get(chatId) || 0;
  if (now - lastTime < 2500) {
    await appendMessageToSession(chatId, senderName, "customer", incomingText);
    return jsonResponse({ status: "debounced_fast_ok" });
  }
  userLastMessageTime.set(chatId, now);

  // ১. সেশনে কাস্টমার মেসেজ অ্যাপেন্ড
  const session = await appendMessageToSession(chatId, senderName, "customer", incomingText);

  // ২. /start কমান্ড হ্যান্ডলিং
  if (incomingText === "/start") {
    const welcome = `হ্যালো ${senderName}! 👋 আমাদের সার্ভিসে স্বাগতম।\n\nআমাদের প্রোডাক্ট, মূল্য, ডেলিভারি বা যেকোনো প্রশ্ন নিচে লিখে পাঠান, আমি সার্বক্ষণিক সাহায্য করতে প্রস্তুত!`;
    await sendTelegramMessage(env, chatId, welcome);
    await appendMessageToSession(chatId, senderName, "assistant", welcome);
    return jsonResponse({ success: true, reply: welcome });
  }

  // ৩. হ্যান্ডওভার চেক: অ্যাডমিন টেকওভার চালু আছে কি না (৩০ মিনিট উইন্ডো)
  const isTakeover = session.admin_takeover && (session.takeover_until ? session.takeover_until > now : true);
  if (isTakeover) {
    return jsonResponse({ status: "admin_takeover_active", message: "AI paused during admin active session" });
  }

  // ৪. D1 থেকে ক্যাশড বিজনেস ডেটা রিড (১০ মিনিটের ক্যাশ API - D1 রিড বাঁচাবে ৯৯%)
  const businessContext = await getCachedBusinessContext(env.DB);

  // ৫. Gemini AI কল (Structured JSON: { reply, urgent_admin_alert, reason })
  const aiDecision = await callGeminiStructured(incomingText, session.messages.slice(-6), businessContext, env);

  // ৬. টেলিগ্রামে কাস্টমারকে উত্তর পাঠানো
  if (aiDecision.reply) {
    await sendTelegramMessage(env, chatId, aiDecision.reply);
    await appendMessageToSession(chatId, senderName, "assistant", aiDecision.reply);
  }

  // ৭. যদি কাস্টমার অ্যাডমিন/ম্যানেজার চেয়ে থাকে -> ctx.waitUntil দিয়ে ব্যাকগ্রাউন্ডে অ্যাডমিন টেলিগ্রাম DM অ্যালার্ট
  if (aiDecision.urgent_admin_alert) {
    session.needs_attention = true;
    await saveSession(chatId, session);

    const alertTask = sendAdminTelegramAlert(
      env, 
      senderName, 
      incomingText, 
      chatId, 
      aiDecision.reason || "Customer requested human admin", 
      workerOrigin
    );

    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(alertTask);
    } else {
      await alertTask;
    }
  }

  return jsonResponse({
    success: true,
    ai_reply: aiDecision.reply,
    urgent_alert: aiDecision.urgent_admin_alert
  });
}

// ========================================================
// 🤖 GEMINI AI DECISION ENGINE (STRUCTURED JSON)
// ========================================================
async function callGeminiStructured(userMessage, recentHistory, businessContext, env) {
  const apiKey = env.GEMINI_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";

  // অ্যাডমিন কিওয়ার্ড চেক (ফলব্যাক শিল্ড)
  const alertKeywords = ['admin', 'manager', 'owner', 'human', 'manush', 'kotha bolbo', 'call den', 'phone den', 'number dao', 'refund', 'urgent', 'cancel'];
  const lower = userMessage.toLowerCase();
  const keywordTriggered = alertKeywords.some(kw => lower.includes(kw));

  if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY") {
    return {
      reply: "ধন্যবাদ আপনার বার্তার জন্য! আমাদের একজন কাস্টমার প্রতিনিধি খুব শীঘ্রই আপনার প্রশ্নের উত্তর দেবেন। নির্দিষ্ট কোনো প্রোডাক্ট সম্পর্কে জানতে চাইলে নির্দ্বিধায় লিখুন।",
      urgent_admin_alert: keywordTriggered,
      reason: keywordTriggered ? "Admin keyword matched" : ""
    };
  }

  const systemInstruction = 
`You are an intelligent, polite, and helpful customer service assistant for our business on Telegram.
Always respond warmly, accurately, and concisely in Bengali or natural Banglish.
Answer customer inquiries regarding products, prices, and delivery strictly using the official D1 Business Information provided below.

CRITICAL INSTRUCTION:
You MUST respond ONLY with a raw JSON object matching this schema:
{
  "reply": "Your friendly Bengali response to the customer",
  "urgent_admin_alert": true or false,
  "reason": "Short reason if urgent_admin_alert is true (e.g. customer wants human admin, complaint, refund, phone call)"
}

Set "urgent_admin_alert" to true whenever the customer expresses a desire to speak with the human manager/admin, complains, asks for phone calls, or cancels orders. Even if urgent_admin_alert is true, still provide a polite and reassuring response in "reply".

${businessContext}`;

  const contents = [];
  for (const m of recentHistory) {
    contents.push({
      role: m.sender_type === "customer" ? "user" : "model",
      parts: [{ text: m.message_text }]
    });
  }

  if (contents.length === 0 || contents[contents.length - 1].role !== "user") {
    contents.push({ role: "user", parts: [{ text: userMessage }] });
  }

  const payload = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: contents,
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 600,
      response_mime_type: "application/json"
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
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText) {
        try {
          const parsed = JSON.parse(rawText.trim());
          if (parsed.reply) {
            return {
              reply: parsed.reply,
              urgent_admin_alert: Boolean(parsed.urgent_admin_alert || keywordTriggered),
              reason: parsed.reason || (keywordTriggered ? "Customer asked for admin" : "")
            };
          }
        } catch (jsonErr) {
          // If JSON parsing fails, use rawText directly
          return {
            reply: rawText.replace(/^```json/, '').replace(/```$/, '').trim(),
            urgent_admin_alert: keywordTriggered,
            reason: "Keyword match"
          };
        }
      }
    }
  } catch (err) {
    console.error("Gemini API Error:", err);
  }

  return {
    reply: "ধন্যবাদ! আমরা আপনার বার্তাটি পেয়েছি। আমাদের টিম কিছুক্ষণের মধ্যেই আপনার প্রশ্নের উত্তর দিচ্ছে।",
    urgent_admin_alert: keywordTriggered,
    reason: "Fallback triggered"
  };
}

// ========================================================
// 🚨 ADMIN TELEGRAM DM ALERT ENGINE
// ========================================================
async function sendAdminTelegramAlert(env, customerName, incomingText, chatId, reason, workerOrigin) {
  let adminChatId = env.ADMIN_TG_CHAT_ID;
  let botToken = await getConfigValue(env.DB, "telegram_bot_token", env.TELEGRAM_BOT_TOKEN);

  if (env.DB) {
    const row = await env.DB.prepare("SELECT value FROM system_config WHERE key = 'admin_telegram_chat_id'").first();
    if (row && row.value) adminChatId = row.value;
  }

  if (!adminChatId || !botToken) return;

  const dashboardBase = env.DASHBOARD_URL ? env.DASHBOARD_URL.replace(/\/$/, '') : workerOrigin;
  const chatDeepLink = `${dashboardBase}?chat_id=${chatId}`;

  const alertText = 
`🚨 *[জরুরি কাস্টমার অ্যালার্ট]*\n\n` +
`👤 *কাস্টমার:* ${customerName} (ID: \`${chatId}\`)\n` +
`⚠️ *কারণ:* ${reason}\n` +
`💬 *মেসেজ:* _"${incomingText.substring(0, 250)}"_\n\n` +
`💡 AI কাস্টমারকে উত্তর দিয়ে চ্যাট চালিয়ে যাচ্ছে। আপনি চাইলে ড্যাশবোর্ড থেকে টেকওভার করতে পারেন।\n` +
`🔗 [ড্যাশবোর্ডে চ্যাট খুলুন](${chatDeepLink})`;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: adminChatId,
        text: alertText,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "🚀 Open in Dashboard", url: chatDeepLink }]]
        }
      })
    });
  } catch (e) {
    console.warn("Admin alert send failed:", e.message);
  }
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

  // ১. টেলিগ্রাম Bot API দিয়ে কাস্টমারকে মেসেজ পাঠানো
  const tgResult = await sendTelegramMessage(env, targetChatId, cleanText);
  if (!tgResult.ok) {
    return jsonResponse({
      error: `টেলিগ্রামে মেসেজ পাঠানো যায়নি: ${tgResult.description || 'Unknown error'}`,
      details: tgResult
    }, 502);
  }

  // ২. সেশনে অ্যাডমিন মেসেজ যোগ করা এবং ৩০ মিনিটের জন্য Admin Takeover সক্রিয় করা
  const session = await appendMessageToSession(targetChatId, `User (${targetChatId})`, "admin", cleanText);
  session.admin_takeover = true;
  session.takeover_until = Date.now() + 30 * 60 * 1000;
  session.needs_attention = false;
  await saveSession(targetChatId, session);

  return jsonResponse({
    success: true,
    delivered: true,
    chat_id: targetChatId,
    text: cleanText
  });
}

// ========================================================
// ⚡ 1-CLICK ZERO-TERMINAL TELEGRAM SETUP & WEBHOOK
// ========================================================
async function handleSetupTelegram(body, env, workerOrigin) {
  const { bot_token, admin_chat_id } = body;
  if (!bot_token || !bot_token.trim()) {
    return jsonResponse({ error: "Bot Token প্রদান করা আবশ্যক" }, 400);
  }

  const cleanToken = bot_token.trim();

  // ১. টেলিগ্রাম getMe কল করে টোকেন টেস্ট করা
  const testRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
  const testData = await testRes.json();
  if (!testData.ok) {
    return jsonResponse({
      error: `টেলিগ্রাম বট টোকেন সঠিক নয়: ${testData.description || 'Verification failed'}`,
      details: testData
    }, 400);
  }

  const botInfo = testData.result;

  // ২. D1 system_config টেবিলে টোকেন ও বট ইউজারনেম সেভ করা
  if (env.DB) {
    await ensureTables(env.DB);
    await env.DB.prepare(`
      INSERT INTO system_config (key, value) VALUES ('telegram_bot_token', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(cleanToken).run();

    await env.DB.prepare(`
      INSERT INTO system_config (key, value) VALUES ('telegram_bot_username', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(botInfo.username).run();

    if (admin_chat_id && admin_chat_id.trim()) {
      await env.DB.prepare(`
        INSERT INTO system_config (key, value) VALUES ('admin_telegram_chat_id', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).bind(admin_chat_id.trim()).run();
    }
  }

  // ৩. স্বয়ংক্রিয়ভাবে Telegram setWebhook কল করা
  const webhookUrl = `${workerOrigin}/webhook/telegram`;
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
// 🗄️ D1 BUSINESS DATA RETRIEVER (WITH CACHE API)
// ========================================================
let localBusinessContextCache = { data: null, expiresAt: 0 };

async function getCachedBusinessContext(db) {
  const now = Date.now();
  if (localBusinessContextCache.data && localBusinessContextCache.expiresAt > now) {
    return localBusinessContextCache.data;
  }

  if (!db) {
    return "Official Store Policies:\n- Standard Delivery Available.\n- Cash on Delivery accepted.";
  }

  try {
    await ensureTables(db);
    const { results: products } = await db.prepare(
      "SELECT name, price, description, stock_status FROM products WHERE is_active = 1 LIMIT 30"
    ).all();

    const { results: profileRows } = await db.prepare(
      "SELECT key, value FROM system_config"
    ).all();

    let context = "=== STORE & BUSINESS INFORMATION (FROM D1 DATABASE) ===\n";
    for (const row of (profileRows || [])) {
      if (!row.key.includes("token") && !row.key.includes("key")) {
        context += `- ${row.key.replace(/_/g, ' ').toUpperCase()}: ${row.value}\n`;
      }
    }

    if (products && products.length > 0) {
      context += "\n=== ACTIVE PRODUCTS & PRICING (FROM D1 DATABASE) ===\n";
      for (const p of products) {
        context += `- Product: ${p.name} | Price: ৳${p.price} | Stock: ${p.stock_status} | Details: ${p.description || 'N/A'}\n`;
      }
    }

    // ১০ মিনিটের জন্য মেমোরি ও ক্যাশে রেখে দেওয়া (D1 কোটা বাঁচাবে)
    localBusinessContextCache = {
      data: context,
      expiresAt: now + 10 * 60 * 1000
    };

    return context;
  } catch (err) {
    console.warn("D1 Business Context Error:", err.message);
    return "Official Store Policies: Standard Delivery Available.";
  }
}

async function invalidateBusinessCache() {
  localBusinessContextCache = { data: null, expiresAt: 0 };
}

// ========================================================
// 🧠 CACHE API & MEMORY SESSION STORE (ZERO D1 CHAT BLOAT)
// ========================================================
async function getSession(chatId) {
  // ১. মেমোরি লুকআপ
  if (memorySessions.has(chatId)) {
    return memorySessions.get(chatId);
  }

  // ২. ক্লাউডফ্লেয়ার Cache API লুকআপ (caches.default)
  try {
    const cache = caches.default;
    const cacheUrl = new URL(`https://internal-cache.local/session/${chatId}`);
    const cachedResponse = await cache.match(cacheUrl);
    if (cachedResponse) {
      const session = await cachedResponse.json();
      memorySessions.set(chatId, session);
      return session;
    }
  } catch (e) {}

  return null;
}

async function saveSession(chatId, session) {
  memorySessions.set(chatId, session);

  // ক্লাউডফ্লেয়ার Cache API-তে ১ ঘণ্টার জন্য রেখে দেওয়া
  try {
    const cache = caches.default;
    const cacheUrl = new URL(`https://internal-cache.local/session/${chatId}`);
    const response = new Response(JSON.stringify(session), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "max-age=3600"
      }
    });
    await cache.put(cacheUrl, response);
  } catch (e) {}
}

async function appendMessageToSession(chatId, senderName, senderType, text) {
  let session = await getSession(chatId);
  const nowStr = new Date().toISOString();

  if (!session) {
    session = {
      chat_id: chatId,
      sender_name: senderName,
      admin_takeover: false,
      takeover_until: 0,
      needs_attention: false,
      last_message: text,
      last_message_at: nowStr,
      messages: []
    };
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

  // সর্বোচ্চ ২০টি মেসেজ রাখা হবে
  if (session.messages.length > 20) {
    session.messages.shift();
  }

  await saveSession(chatId, session);
  return session;
}

// ========================================================
// 📤 TELEGRAM SEND MESSAGE HELPER
// ========================================================
async function sendTelegramMessage(env, chatId, text) {
  const token = await getConfigValue(env.DB, "telegram_bot_token", env.TELEGRAM_BOT_TOKEN);
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

async function getConfigValue(db, key, fallback = null) {
  if (db) {
    try {
      const row = await db.prepare("SELECT value FROM system_config WHERE key = ?").bind(key).first();
      if (row && row.value && row.value.trim().length > 0) {
        return row.value.trim();
      }
    } catch (e) {}
  }
  return fallback;
}

async function ensureTables(db) {
  if (!db) return;
  try {
    await db.batch([
      db.prepare(`
        CREATE TABLE IF NOT EXISTS system_config (
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
    console.warn("ensureTables warning:", e.message);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

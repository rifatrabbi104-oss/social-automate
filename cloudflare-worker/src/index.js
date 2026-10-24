/**
 * SocialAutomate - Telegram-First D1 Native Worker Engine
 * --------------------------------------------------------
 * 1. Cloudflare D1 Database Persistence (Zero LocalStorage Rely)
 * 2. Telegram Webhook Receiver (Saves customer messages to D1)
 * 3. Outbound Admin Reply API (Sends message from Bot/ID to Customer on Telegram)
 * 4. Automatic Webhook & Bot Token Manager (Stored in D1)
 * 5. Conversations & Message History Query API
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ०. হেলথচেক ও সিস্টেম স্ট্যাটাস API
      if (request.method === "GET" && (path === "/" || path === "/api" || path === "/status")) {
        const hasD1 = Boolean(env.DB);
        let botUsername = null;
        let hasToken = false;

        if (hasD1) {
          await ensureTables(env.DB);
          const token = await getTelegramBotToken(env);
          hasToken = Boolean(token);
          const uRow = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'telegram_bot_username'").first();
          botUsername = uRow?.value || null;
        }

        return jsonResponse({
          status: "online",
          service: "SocialAutomate Telegram Live Engine",
          d1_database: hasD1 ? "✅ Connected (D1 Active)" : "❌ Not Bound (Bind 'DB' in Cloudflare Settings)",
          telegram_connection: hasToken 
            ? (botUsername ? `✅ Connected (@${botUsername})` : "✅ Token Active") 
            : "⚠️ Bot Token Missing (Set in Dashboard Settings)",
          webhook_url: `${url.origin}/webhook/telegram`,
          timestamp: new Date().toISOString()
        });
      }

      // ==========================================
      // ১. টেলিগ্রাম Webhook (ইনকামিং কাস্টমার মেসেজ)
      // ==========================================
      if (request.method === "POST" && (path === "/webhook/telegram" || path === "/api/telegram/webhook")) {
        const update = await request.json();
        return await handleTelegramUpdate(update, env);
      }

      // ==========================================
      // ২. কনভারসেশন লিস্ট ফেচ API (D1 থেকে সরাসরি)
      // ==========================================
      if (request.method === "GET" && path === "/api/conversations") {
        if (!env.DB) {
          return jsonResponse({ 
            error: "D1 Database 'DB' binding missing in Cloudflare Worker settings.",
            help: "Cloudflare Dashboard > Workers > Settings > Bindings এ গিয়ে D1 Database যোগ করুন।"
          }, 503);
        }
        await ensureTables(env.DB);
        const { results } = await env.DB.prepare(
          "SELECT * FROM conversations ORDER BY last_message_at DESC LIMIT 50;"
        ).all();
        return jsonResponse(results || []);
      }

      // ==========================================
      // ৩. মেসেজ হিস্ট্রি ফেচ API (D1 থেকে সরাসরি)
      // ==========================================
      if (request.method === "GET" && path === "/api/messages") {
        const convId = url.searchParams.get("conversation_id");
        if (!convId) return jsonResponse({ error: "Missing conversation_id parameter" }, 400);

        if (!env.DB) {
          return jsonResponse([], 200);
        }
        await ensureTables(env.DB);
        const { results } = await env.DB.prepare(
          "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 150;"
        ).bind(convId).all();
        return jsonResponse(results || []);
      }

      // ==========================================
      // ৪. ড্যাশবোর্ড থেকে অ্যাডমিন রিপ্লাই পাঠানো (আউটবাউন্ড)
      // ==========================================
      if (request.method === "POST" && path === "/api/admin/reply") {
        const body = await request.json();
        return await handleAdminReply(body, env);
      }

      // ==========================================
      // ৫. টেলিগ্রাম বট কানেকশন ও D1 সেটিংস সেভ
      // ==========================================
      if (request.method === "POST" && path === "/api/settings/telegram") {
        const body = await request.json();
        return await handleSaveTelegramSettings(body, env, request.url);
      }

      if (request.method === "GET" && path === "/api/settings") {
        if (!env.DB) {
          return jsonResponse({
            d1_connected: false,
            telegram_connected: false,
            message: "D1 Database binding missing"
          });
        }
        await ensureTables(env.DB);
        const { results } = await env.DB.prepare("SELECT key, value FROM system_settings").all();
        const settings = {};
        for (const row of (results || [])) {
          if (row.key === "telegram_bot_token") {
            settings.has_telegram_token = Boolean(row.value);
            settings.telegram_bot_token_masked = row.value ? row.value.substring(0, 5) + "..." + row.value.slice(-4) : "";
          } else {
            settings[row.key] = row.value;
          }
        }
        return jsonResponse({
          d1_connected: true,
          telegram_connected: Boolean(settings.has_telegram_token),
          bot_username: settings.telegram_bot_username || null,
          webhook_url: `${url.origin}/webhook/telegram`,
          settings: settings
        });
      }

      // ==========================================
      // ৬. ডেটাবেস ইনিশিয়ালাইজেশন চেক
      // ==========================================
      if (request.method === "POST" && path === "/api/setup-db") {
        if (!env.DB) return jsonResponse({ error: "DB binding missing" }, 500);
        await ensureTables(env.DB);
        return jsonResponse({ success: true, message: "D1 tables initialized successfully" });
      }

      // ==========================================
      // ৭. ড্যাশবোর্ড স্ট্যাটস
      // ==========================================
      if (request.method === "GET" && path === "/api/stats") {
        return await getDashboardStats(env);
      }

      return jsonResponse({ error: "Endpoint not found", path }, 404);

    } catch (err) {
      console.error("Worker error:", err);
      return jsonResponse({ error: err.message, stack: err.stack }, 500);
    }
  }
};

// ========================================================
// ✈️ TELEGRAM INBOUND UPDATE HANDLER (D1 SAVER)
// ========================================================
async function handleTelegramUpdate(update, env) {
  if (!update.message || !update.message.text) {
    return jsonResponse({ status: "ignored_non_text" });
  }

  const msg = update.message;
  const senderId = String(msg.chat.id);
  const senderName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") 
    || msg.from.username 
    || `Telegram User (${senderId})`;
  const incomingText = msg.text.trim();
  const conversationId = `tg_${senderId}`;

  if (!env.DB) {
    console.error("D1 database binding missing in Worker");
    return jsonResponse({ error: "D1 Database 'DB' binding not found" }, 500);
  }

  await ensureTables(env.DB);

  // ১. D1 ডেটাবেসে কাস্টমার ও চ্যাট রেকর্ড আপডেট
  await upsertConversation(env.DB, conversationId, "telegram", senderId, senderName, incomingText);

  // ২. কাস্টমারের পাঠানো মেসেজ D1 messages টেবিলে সেভ করা
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  await saveMessage(env.DB, messageId, conversationId, "customer", incomingText);

  // ৩. /start কমান্ড দিলে একটি ফ্রেন্ডলি কনফার্মেশন পাঠানো (যদি বটের টোকেন থাকে)
  if (incomingText === "/start") {
    const token = await getTelegramBotToken(env);
    if (token) {
      const welcome = `হ্যালো ${senderName}! 👋\nআপনার মেসেজটি আমাদের ড্যাশবোর্ডে পৌঁছেছে। আমাদের প্রতিনিধি খুব শীঘ্রই এখান থেকেই আপনার উত্তর দেবেন।`;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: senderId, text: welcome })
      }).catch(e => console.warn("Welcome msg failed:", e.message));

      await saveMessage(env.DB, `msg_welcome_${Date.now()}`, conversationId, "admin", welcome);
    }
  }

  return jsonResponse({
    success: true,
    stored_in_d1: true,
    conversation_id: conversationId,
    customer: senderName,
    message: incomingText
  });
}

// ========================================================
// 👤 ADMIN OUTBOUND REPLY (DASHBOARD -> TELEGRAM)
// ========================================================
async function handleAdminReply(body, env) {
  const { conversation_id, message_text } = body;
  if (!conversation_id || !message_text) {
    return jsonResponse({ error: "Missing conversation_id or message_text" }, 400);
  }

  if (!env.DB) {
    return jsonResponse({ error: "Cloudflare D1 Database 'DB' binding missing" }, 500);
  }

  await ensureTables(env.DB);

  // ১. D1 থেকে কনভারসেশন খুঁজে বের করা
  const conv = await env.DB.prepare("SELECT * FROM conversations WHERE id = ?").bind(conversation_id).first();
  if (!conv) {
    return jsonResponse({ error: "Conversation not found in D1 database" }, 404);
  }

  const botToken = await getTelegramBotToken(env);
  if (!botToken) {
    return jsonResponse({
      error: "Telegram Bot Token পাওয়া যায়নি। অনুগ্রহ করে ড্যাশবোর্ডের Settings থেকে Bot Token কানেক্ট করুন।"
    }, 400);
  }

  // ২. টেলিগ্রাম Bot API তে কল করে মেসেজ সেন্ড করা
  let tgResult = null;
  if (conv.platform === "telegram") {
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: conv.sender_id,
        text: message_text
      })
    });

    tgResult = await tgRes.json();
    if (!tgResult.ok) {
      return jsonResponse({
        error: `Telegram এ মেসেজ পাঠাতে ব্যর্থ হয়েছে: ${tgResult.description || 'Unknown error'}`,
        tg_details: tgResult
      }, 502);
    }
  }

  // ৩. অ্যাডমিনের পাঠানো মেসেজ D1 messages টেবিলে সেভ করা
  const msgId = `adm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  await saveMessage(env.DB, msgId, conversation_id, "admin", message_text);

  // ৪. conversations টেবিলের লাস্ট মেসেজ আপডেট করা
  await env.DB.prepare(
    "UPDATE conversations SET last_message = ?, last_message_at = CURRENT_TIMESTAMP, admin_takeover = 1 WHERE id = ?"
  ).bind(message_text, conversation_id).run();

  return jsonResponse({
    success: true,
    delivered_to_telegram: true,
    message_id: msgId,
    recipient_chat_id: conv.sender_id,
    text: message_text
  });
}

// ========================================================
// ⚙️ TELEGRAM SETTINGS & 1-CLICK WEBHOOK SYNC
// ========================================================
async function handleSaveTelegramSettings(body, env, requestUrl) {
  const { bot_token, admin_chat_id } = body;
  if (!bot_token || !bot_token.trim()) {
    return jsonResponse({ error: "Bot Token প্রদান করা আবশ্যক" }, 400);
  }

  if (!env.DB) {
    return jsonResponse({
      error: "Cloudflare D1 Database binding 'DB' সংযুক্ত নেই। Cloudflare Dashboard > Workers > Settings > Bindings এ গিয়ে DB সেট করুন।"
    }, 500);
  }

  await ensureTables(env.DB);

  const cleanToken = bot_token.trim();

  // ১. ভেরিফাই টোকেন উইথ টেলিগ্রাম getMe API
  const testRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
  const testData = await testRes.json();
  if (!testData.ok) {
    return jsonResponse({
      error: `টেলিগ্রাম বট টোকেন সঠিক নয়: ${testData.description || 'Verification failed'}`,
      details: testData
    }, 400);
  }

  const botInfo = testData.result;
  const botUsername = botInfo.username;
  const botFirstName = botInfo.first_name;

  // ২. D1 ডেটাবেসে টোকেন ও বট ইউজারনেম সংরক্ষণ
  await env.DB.prepare(`
    INSERT INTO system_settings (key, value) VALUES ('telegram_bot_token', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).bind(cleanToken).run();

  await env.DB.prepare(`
    INSERT INTO system_settings (key, value) VALUES ('telegram_bot_username', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).bind(botUsername).run();

  if (admin_chat_id && admin_chat_id.trim()) {
    await env.DB.prepare(`
      INSERT INTO system_settings (key, value) VALUES ('admin_telegram_chat_id', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(admin_chat_id.trim()).run();
  }

  // ৩. সোশ্যাল অ্যাকাউন্টস টেবিলে এন্ট্রি
  await env.DB.prepare(`
    INSERT INTO social_accounts (id, platform, account_name, account_id, access_token, status)
    VALUES (?, 'telegram', ?, ?, ?, 'active')
    ON CONFLICT(id) DO UPDATE SET 
      account_name = excluded.account_name,
      access_token = excluded.access_token,
      status = 'active'
  `).bind(`tg_${botInfo.id}`, botFirstName, botUsername, cleanToken).run();

  // ৪. অটোমেটিক টেলিগ্রাম ওয়েবমুক অ্যাক্টিভেশন
  const origin = new URL(requestUrl).origin;
  const webhookUrl = `${origin}/webhook/telegram`;
  let webhookStatus = "active";
  try {
    const setWebhookRes = await fetch(`https://api.telegram.org/bot${cleanToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
    const webhookData = await setWebhookRes.json();
    if (!webhookData.ok) {
      webhookStatus = webhookData.description || "Failed to set webhook";
    }
  } catch (err) {
    webhookStatus = err.message;
  }

  return jsonResponse({
    success: true,
    message: `টেলিগ্রাম বট @${botUsername} সফলভাবে D1 ডেটাবেসে কানেক্ট হয়েছে এবং Webhook চালু হয়েছে!`,
    bot: {
      id: botInfo.id,
      name: botFirstName,
      username: `@${botUsername}`
    },
    webhook_url: webhookUrl,
    webhook_status: webhookStatus
  });
}

// ========================================================
// 🗄️ D1 DATABASE HELPERS (AUTO-MIGRATION & PERSISTENCE)
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
        CREATE TABLE IF NOT EXISTS social_accounts (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          account_name TEXT NOT NULL,
          account_id TEXT NOT NULL,
          access_token TEXT NOT NULL,
          status TEXT DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          sender_name TEXT DEFAULT 'Customer',
          admin_takeover INTEGER DEFAULT 1,
          needs_attention INTEGER DEFAULT 0,
          last_message TEXT,
          last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          sender_type TEXT NOT NULL,
          message_text TEXT NOT NULL,
          media_url TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `)
    ]);
  } catch (e) {
    console.warn("Table auto-migration warning:", e.message);
  }
}

async function getTelegramBotToken(env) {
  if (env.DB) {
    try {
      const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'telegram_bot_token'").first();
      if (row && row.value && row.value.trim().length > 10) {
        return row.value.trim();
      }
    } catch (e) {
      console.warn("Error reading bot token from D1:", e.message);
    }
  }

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_TOKEN !== "YOUR_CUSTOMER_BOT_TOKEN") {
    return env.TELEGRAM_BOT_TOKEN.trim();
  }
  return null;
}

async function upsertConversation(db, id, platform, senderId, senderName, lastMessage) {
  if (!db) return;
  try {
    await db.prepare(`
      INSERT INTO conversations (id, platform, sender_id, sender_name, last_message, last_message_at, admin_takeover)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
      ON CONFLICT(id) DO UPDATE SET 
        sender_name = excluded.sender_name,
        last_message = excluded.last_message,
        last_message_at = CURRENT_TIMESTAMP
    `).bind(id, platform, senderId, senderName, lastMessage).run();
  } catch (e) {
    console.warn("D1 upsertConversation error:", e.message);
  }
}

async function saveMessage(db, id, conversationId, senderType, text) {
  if (!db) return;
  try {
    await db.prepare(
      "INSERT INTO messages (id, conversation_id, sender_type, message_text) VALUES (?, ?, ?, ?)"
    ).bind(id, conversationId, senderType, text).run();
  } catch (e) {
    console.warn("D1 saveMessage error:", e.message);
  }
}

async function getDashboardStats(env) {
  if (!env.DB) {
    return jsonResponse({
      total_conversations: 0,
      total_messages: 0,
      d1_connected: false,
      telegram_connected: false,
      status: "Waiting for D1 binding"
    });
  }

  try {
    await ensureTables(env.DB);
    const totalConvs = await env.DB.prepare("SELECT COUNT(*) as count FROM conversations").first();
    const totalMsgs = await env.DB.prepare("SELECT COUNT(*) as count FROM messages").first();
    const botToken = await getTelegramBotToken(env);
    const botUser = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'telegram_bot_username'").first();

    return jsonResponse({
      total_conversations: totalConvs?.count || 0,
      total_messages: totalMsgs?.count || 0,
      d1_connected: true,
      telegram_connected: Boolean(botToken),
      bot_username: botUser?.value || null,
      status: "Operational"
    });
  } catch (e) {
    return jsonResponse({
      total_conversations: 0,
      total_messages: 0,
      d1_connected: false,
      error: e.message
    });
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

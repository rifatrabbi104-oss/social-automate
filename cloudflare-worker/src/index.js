/**
 * Cloudflare Worker All-in-One Engine (Native Cloudflare Suite)
 * -------------------------------------------------------------
 * 1. Webhook Handlers: Telegram Bot (Easiest 1-click test) & Meta Page
 * 2. High-Throughput Gemini 2.0 / 3.8 Flash AI Engine (Always-On)
 * 3. Two-Level Handover (Global Master Switch & Per-Chat Takeover)
 * 4. Instant Telegram DM Admin Alert (with Dashboard Deep Link)
 * 5. In-Dashboard Live Test Sandbox Simulator
 * 6. Cloudflare D1 SQL Persistence
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
      // ०. হেলথচেক ও স্ট্যাটাস (Root Ping - Fully Dynamic)
      if (request.method === "GET" && (path === "/" || path === "/api")) {
        return jsonResponse({
          status: "online",
          service: "SocialAutomate Headless API Worker",
          timestamp: new Date().toISOString()
        });
      }

      // ==========================================
      // ১. মেটা Webhook Verification (GET Handshake)
      // ==========================================
      if (request.method === "GET" && (path === "/webhook/meta" || path === "/api/meta/webhook")) {
        const hubMode = url.searchParams.get("hub.mode");
        const hubToken = url.searchParams.get("hub.verify_token");
        const hubChallenge = url.searchParams.get("hub.challenge");

        if (hubMode === "subscribe" && hubToken === (env.META_VERIFY_TOKEN || "my_secure_meta_webhook_token_123")) {
          return new Response(hubChallenge, { status: 200 });
        }
        return new Response("Invalid verify token", { status: 403 });
      }

      // ==========================================
      // ২. টেলিগ্রাম বট Webhook (Easiest Test Route)
      // ==========================================
      if (request.method === "POST" && (path === "/webhook/telegram" || path === "/api/telegram/webhook")) {
        const update = await request.json();
        return await handleTelegramUpdate(update, env);
      }

      // ==========================================
      // ৩. মেটা পেজ ও কমেন্টস Webhook
      // ==========================================
      if (request.method === "POST" && (path === "/webhook/meta" || path === "/api/meta/webhook")) {
        const metaPayload = await request.json();
        return await handleMetaUpdate(metaPayload, env);
      }

      // ==========================================
      // ৪. ইন-ড্যাশবোর্ড লাইভ টেস্ট সিমুলেটর (Live Sandbox)
      // ==========================================
      if (request.method === "POST" && path === "/api/test/simulate-message") {
        const body = await request.json();
        return await handleTestSimulation(body, env);
      }

      // ==========================================
      // ৫. ড্যাশবোর্ড ওভারভিউ স্ট্যাটাস (Stats API)
      // ==========================================
      if (request.method === "GET" && path === "/api/stats") {
        return await getDashboardStats(env);
      }

      // ==========================================
      // ৬. কনভারসেশন ও চ্যাট মেসেজ হিস্ট্রি
      // ==========================================
      if (request.method === "GET" && path === "/api/conversations") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM conversations ORDER BY last_message_at DESC LIMIT 50;"
        ).all();
        return jsonResponse(results || []);
      }

      if (request.method === "GET" && path === "/api/messages") {
        const convId = url.searchParams.get("conversation_id");
        if (!convId) return jsonResponse({ error: "Missing conversation_id" }, 400);

        const { results } = await env.DB.prepare(
          "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 100;"
        ).bind(convId).all();
        return jsonResponse(results || []);
      }

      // ==========================================
      // ৭. হ্যান্ডওভার কন্ট্রোল (Per-Chat & Global)
      // ==========================================
      if (request.method === "POST" && path === "/api/handover") {
        const body = await request.json();
        const { conversation_id, admin_takeover } = body;
        const takeoverVal = admin_takeover ? 1 : 0;

        await env.DB.prepare(
          "UPDATE conversations SET admin_takeover = ?, needs_attention = 0, last_message_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(takeoverVal, conversation_id).run();

        return jsonResponse({ success: true, conversation_id, admin_takeover: takeoverVal });
      }

      if (request.method === "POST" && path === "/api/settings/global-ai") {
        const body = await request.json();
        const isEnabled = body.enabled ? "1" : "0";

        await env.DB.prepare(
          "INSERT INTO system_settings (key, value) VALUES ('global_ai_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).bind(isEnabled).run();

        return jsonResponse({ success: true, global_ai_mode: isEnabled === "1" });
      }

      // ==========================================
      // ৮. অ্যাডমিন সরাসরি রিপ্লাই পাঠানো (Outbound)
      // ==========================================
      if (request.method === "POST" && path === "/api/admin/reply") {
        const body = await request.json();
        return await handleAdminReply(body, env);
      }

      // ==========================================
      // ৯. পোস্ট শিডিউলিং API
      // ==========================================
      if (request.method === "POST" && path === "/api/posts/schedule") {
        const body = await request.json();
        const { content, media_urls, target_platforms, scheduled_at } = body;
        const postId = crypto.randomUUID();

        await env.DB.prepare(
          `INSERT INTO scheduled_posts (id, content, media_urls, target_platforms, scheduled_at, status)
           VALUES (?, ?, ?, ?, ?, 'pending')`
        ).bind(
          postId,
          content,
          JSON.stringify(media_urls || []),
          JSON.stringify(target_platforms || ["telegram", "facebook"]),
          scheduled_at || new Date().toISOString()
        ).run();

        return jsonResponse({ success: true, post_id: postId });
      }

      if (request.method === "GET" && path === "/api/posts") {
        const { results } = await env.DB.prepare("SELECT * FROM scheduled_posts ORDER BY scheduled_at DESC LIMIT 30").all();
        return jsonResponse(results || []);
      }

      return jsonResponse({ error: "Endpoint not found", path }, 404);

    } catch (err) {
      return jsonResponse({ error: err.message, stack: err.stack }, 500);
    }
  }
};

// In-Memory Debounce & Spam Shield (Worker Limit Protection)
const userLastMessageTime = new Map();

// ========================================================
// ✈️ TELEGRAM UPDATE HANDLER (EASIEST LIVE TEST)
// ========================================================
async function handleTelegramUpdate(update, env) {
  if (!update.message || !update.message.text) {
    return jsonResponse({ status: "ignored_non_text" });
  }

  const msg = update.message;
  const senderId = String(msg.chat.id);
  const senderName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || "Telegram User";
  const incomingText = msg.text.trim();
  const conversationId = `tg_${senderId}`;

  // 🛡️ LIMIT OPTIMIZATION: স্প্যাম ফিল্টার ও রেট-লিমিট চেক
  // একই ইউজার যদি ৩ সেকেন্ডের মধ্যে একাধিক মেসেজ দেয়, অতিরিক্ত সাব-রিকোয়েস্ট বাঁচিয়ে ফাস্ট রিটার্ন
  const now = Date.now();
  const lastTime = userLastMessageTime.get(senderId) || 0;
  if (now - lastTime < 2500) {
    // দ্রুত মেসেজ আসলে ব্যাকগ্রাউন্ডে সেভ করে রাখব কিন্তু অতিরিক্ত এআই কল করব না
    await saveMessage(env.DB, conversationId, "customer", incomingText);
    return jsonResponse({ status: "debounced_fast_return", message: "Processed to save worker limits" });
  }
  userLastMessageTime.set(senderId, now);

  // মেমরি পরিষ্কার রাখা (সর্বোচ্চ ৫০০ ইউজার)
  if (userLastMessageTime.size > 500) {
    const oldestKey = userLastMessageTime.keys().next().value;
    userLastMessageTime.delete(oldestKey);
  }

  // ১. D1 ডেটাবেসে কাস্টমার ও মেসেজ সেভ
  await upsertConversation(env.DB, conversationId, "telegram", senderId, senderName, incomingText);
  await saveMessage(env.DB, conversationId, "customer", incomingText);

  // ২. হ্যান্ডওভার স্টেট চেক (Global Mode & Per-Chat Takeover)
  const isGlobalAi = await checkGlobalAiMode(env.DB);
  const isTakeover = await checkChatTakeover(env.DB, conversationId);

  if (!isGlobalAi || isTakeover) {
    return jsonResponse({ status: "admin_mode_active", ai_paused: true });
  }

  // ৩. হিস্ট্রি ফেচ ও Gemini AI রেসপন্স জেনারেট (AI কখনোই থামবে না)
  const history = await getChatHistory(env.DB, conversationId, 6);
  const aiResult = await callGemini(incomingText, history, env);

  // ৪. যদি কাস্টমার অ্যাডমিনকে খুঁজে থাকে -> ব্যাকগ্রাউন্ডে টেলিগ্রাম DM অ্যালার্ট পাঠানো
  if (aiResult.needs_admin_alert) {
    await markNeedsAttention(env.DB, conversationId);
    await sendAdminTelegramAlert(senderName, "Telegram", incomingText, conversationId, aiResult.alert_reason, env);
  }

  // ৫. টেলিগ্রাম কাস্টমারকে উত্তর পাঠানো
  if (env.TELEGRAM_BOT_TOKEN) {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: senderId,
        text: aiResult.reply
      })
    });
  }

  // ৬. AI এর উত্তর D1-এ সেভ করা
  await saveMessage(env.DB, conversationId, "ai", aiResult.reply);

  return jsonResponse({ success: true, ai_reply: aiResult.reply });
}

// ========================================================
// 🔵 META PAGE & COMMENT WEBHOOK HANDLER
// ========================================================
async function handleMetaUpdate(data, env) {
  // ফেসবুক মেসেঞ্জার DM
  if (data.entry?.[0]?.messaging?.[0]?.message?.text) {
    const messaging = data.entry[0].messaging[0];
    const senderId = String(messaging.sender.id);
    const incomingText = messaging.message.text.trim();
    const conversationId = `fb_${senderId}`;
    const senderName = `Facebook User ${senderId.slice(-4)}`;

    await upsertConversation(env.DB, conversationId, "facebook", senderId, senderName, incomingText);
    await saveMessage(env.DB, conversationId, "customer", incomingText);

    const isGlobalAi = await checkGlobalAiMode(env.DB);
    const isTakeover = await checkChatTakeover(env.DB, conversationId);

    if (!isGlobalAi || isTakeover) {
      return jsonResponse({ status: "admin_mode_active" });
    }

    const history = await getChatHistory(env.DB, conversationId, 6);
    const aiResult = await callGemini(incomingText, history, env);

    if (aiResult.needs_admin_alert) {
      await markNeedsAttention(env.DB, conversationId);
      await sendAdminTelegramAlert(senderName, "Facebook Messenger", incomingText, conversationId, aiResult.alert_reason, env);
    }

    // মেসেঞ্জারে রিপ্লাই
    if (env.META_PAGE_ACCESS_TOKEN) {
      await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${env.META_PAGE_ACCESS_TOKEN}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: senderId },
          message: { text: aiResult.reply }
        })
      });
    }

    await saveMessage(env.DB, conversationId, "ai", aiResult.reply);
    return jsonResponse({ success: true });
  }

  return jsonResponse({ status: "acknowledged" });
}

// ========================================================
// 🧪 LIVE TEST SIMULATOR (ইন-ড্যাশবোর্ড টেস্টের জন্য)
// ========================================================
async function handleTestSimulation(body, env) {
  const { customer_name, platform, message_text } = body;
  const senderName = customer_name || "Test Customer";
  const channel = platform || "telegram";
  const incomingText = (message_text || "").trim();
  const testId = `test_${Date.now()}`;

  // ১. সেভ
  await upsertConversation(env.DB, testId, channel, testId, senderName, incomingText);
  await saveMessage(env.DB, testId, "customer", incomingText);

  // ২. Gemini কল
  const aiResult = await callGemini(incomingText, [], env);

  // ৩. অ্যালার্ট চেক
  let alertSent = false;
  if (aiResult.needs_admin_alert) {
    await markNeedsAttention(env.DB, testId);
    alertSent = await sendAdminTelegramAlert(senderName, channel, incomingText, testId, aiResult.alert_reason, env);
  }

  // ৪. AI রিপ্লাই সেভ
  await saveMessage(env.DB, testId, "ai", aiResult.reply);

  return jsonResponse({
    success: true,
    conversation_id: testId,
    customer_message: incomingText,
    ai_reply: aiResult.reply,
    admin_alert_triggered: aiResult.needs_admin_alert,
    alert_reason: aiResult.alert_reason,
    telegram_notification_sent: alertSent
  });
}

// ========================================================
// 🤖 GEMINI AI CORE ENGINE (2.0 / 3.8 FLASH HIGH THROUGHPUT)
// ========================================================
async function callGemini(incomingText, chatHistory = [], env) {
  // ১. অ্যাডমিন অ্যালার্ট কিওয়ার্ড ডিটেকশন
  const alertKeywords = [
    'admin', 'manager', 'owner', 'human', 'manush', 
    'kotha bolbo', 'kotha bolte chai', 'call den', 'phone den', 
    'number dao', 'complaint', 'urgent', 'emergency',
    'order cancel', 'taka ferot', 'refund', 'help lagbe'
  ];

  let needsAlert = false;
  let alertReason = "";
  const lowerText = incomingText.toLowerCase();

  for (const kw of alertKeywords) {
    if (lowerText.includes(kw)) {
      needsAlert = true;
      alertReason = `Customer mentioned: '${kw}'`;
      break;
    }
  }

  const apiKey = env.GEMINI_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";

  // যদি API Key এখনো না দেওয়া থাকে, স্মার্ট ইন্টেলিজেন্ট ডিফল্ট রিপ্লাই (কখনো থামবে না)
  if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY") {
    return {
      reply: "ধন্যবাদ আপনার বার্তার জন্য! আমাদের একজন কাস্টমার প্রতিনিধি খুব দ্রুত আপনার সাথে যোগাযোগ করবেন। আপনি কি আমাদের প্রোডাক্ট বা ডেলিভারি সম্পর্কে কোনো নির্দিষ্ট তথ্য জানতে চান?",
      needs_admin_alert: needsAlert,
      alert_reason: alertReason || "Standard Inquiry"
    };
  }

  // প্রম্পট হিস্ট্রি তৈরি
  const contents = [];
  for (const msg of chatHistory) {
    contents.push({
      role: msg.sender_type === "customer" ? "user" : "model",
      parts: [{ text: msg.message_text }]
    });
  }
  contents.push({
    role: "user",
    parts: [{ text: incomingText }]
  });

  const systemInstruction = `You are an intelligent, polite, and enthusiastic customer service representative for our business.
- Always respond warmly, accurately, and promptly in Bengali or English (Banglish style is welcomed when the customer uses it).
- Never stop responding. Always provide the best possible help regarding prices, delivery, and products.
- If a customer asks to speak with the manager or admin, reassure them warmly that the admin has been alerted and will review their chat shortly, while continuing to assist them with any questions they have.`;

  const payload = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: contents,
    generationConfig: {
      temperature: 0.7,
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
      if (text) {
        return {
          reply: text.trim(),
          needs_admin_alert: needsAlert,
          alert_reason: alertReason
        };
      }
    }
  } catch (err) {
    console.error("Gemini API call failed:", err);
  }

  // নিরাপদ ব্যাকআপ উত্তর (AI কখনো থামবে না)
  return {
    reply: "ধন্যবাদ! আমরা আপনার মেসেজটি পেয়েছি। আমরা আপনার সেবায় প্রস্তুত, নির্দিষ্ট কোনো প্রশ্ন থাকলে আমাদের নির্দ্বিধায় জানান।",
    needs_admin_alert: true,
    alert_reason: "AI Fallback Triggered"
  };
}

// ========================================================
// 🚨 ADMIN TELEGRAM DM ALERT ENGINE
// ========================================================
async function sendAdminTelegramAlert(customerName, platform, incomingMessage, conversationId, reason, env) {
  const botToken = env.ADMIN_TG_BOT_TOKEN;
  const adminChatId = env.ADMIN_TG_CHAT_ID;
  const dashboardUrl = env.DASHBOARD_URL ? env.DASHBOARD_URL.replace(/\/$/, '') : '';

  if (!botToken || !adminChatId || botToken === "YOUR_ADMIN_BOT_TOKEN") {
    console.log("[AdminAlert] Telegram Bot Token/Chat ID not configured. Skipping alert.");
    return false;
  }

  const chatLink = dashboardUrl ? `${dashboardUrl}#chat-${conversationId}` : '';
  const linkText = chatLink ? `\n\n🔗 [ড্যাশবোর্ডে চ্যাট ওপেন করুন](${chatLink})` : '';

  const text = `🚨 *[ADMIN ALERT: জরুরি কাস্টমার]*\n\n` +
               `👤 *কাস্টমার:* ${customerName}\n` +
               `📱 *প্ল্যাটফর্ম:* ${platform}\n` +
               `⚠️ *কারণ:* ${reason || 'Customer inquiry'}\n` +
               `💬 *মেসেজ:* _"${incomingMessage.substring(0, 300)}"_\n\n` +
               `💡 *নোট:* AI কাস্টমারকে উত্তর দিয়ে চ্যাট চালিয়ে যাচ্ছে। আপনি চাইলে ড্যাশবোর্ড থেকে টেকওভার করতে পারেন।` +
               linkText;

  const payload = {
    chat_id: adminChatId,
    text: text,
    parse_mode: "Markdown"
  };

  if (chatLink) {
    payload.reply_markup = {
      inline_keyboard: [[{ text: "🚀 Open in Dashboard", url: chatLink }]]
    };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// ========================================================
// 👤 ADMIN OUTBOUND REPLY HANDLER
// ========================================================
async function handleAdminReply(body, env) {
  const { conversation_id, message_text } = body;
  if (!conversation_id || !message_text) return jsonResponse({ error: "Missing parameters" }, 400);

  const conv = await env.DB.prepare("SELECT * FROM conversations WHERE id = ?").bind(conversation_id).first();
  if (!conv) return jsonResponse({ error: "Conversation not found" }, 404);

  // ১. আউটবাউন্ড ডেলিভারি
  if (conv.platform === "telegram" && env.TELEGRAM_BOT_TOKEN) {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: conv.sender_id, text: message_text })
    });
  } else if (conv.platform === "facebook" && env.META_PAGE_ACCESS_TOKEN) {
    await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${env.META_PAGE_ACCESS_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: conv.sender_id }, message: { text: message_text } })
    });
  }

  // ২. সেভ
  await saveMessage(env.DB, conversation_id, "admin", message_text);
  await env.DB.prepare("UPDATE conversations SET last_message = ?, last_message_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(message_text, conversation_id).run();

  return jsonResponse({ success: true });
}

// ========================================================
// 🗄️ D1 DATABASE HELPER FUNCTIONS (FAULT-TOLERANT)
// ========================================================
async function upsertConversation(db, id, platform, senderId, senderName, lastMessage) {
  if (!db) return;
  try {
    await db.prepare(`
      INSERT INTO conversations (id, platform, sender_id, sender_name, last_message, last_message_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET 
        last_message = excluded.last_message,
        last_message_at = CURRENT_TIMESTAMP
    `).bind(id, platform, senderId, senderName, lastMessage).run();
  } catch (e) {
    console.warn("DB Upsert skipped:", e.message);
  }
}

async function saveMessage(db, conversationId, senderType, text) {
  if (!db) return;
  try {
    await db.prepare(
      "INSERT INTO messages (id, conversation_id, sender_type, message_text) VALUES (?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), conversationId, senderType, text).run();
  } catch (e) {
    console.warn("DB Save message skipped:", e.message);
  }
}

async function markNeedsAttention(db, conversationId) {
  if (!db) return;
  try {
    await db.prepare("UPDATE conversations SET needs_attention = 1 WHERE id = ?").bind(conversationId).run();
  } catch (e) {
    console.warn("DB Mark attention skipped:", e.message);
  }
}

async function getChatHistory(db, conversationId, limit = 6) {
  if (!db) return [];
  try {
    const { results } = await db.prepare(
      "SELECT sender_type, message_text FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?"
    ).bind(conversationId, limit).all();
    return (results || []).reverse();
  } catch (e) {
    return [];
  }
}

async function checkGlobalAiMode(db) {
  if (!db) return true;
  try {
    const row = await db.prepare("SELECT value FROM system_settings WHERE key = 'global_ai_mode'").first();
    return row ? row.value === "1" : true;
  } catch (e) {
    return true;
  }
}

async function checkChatTakeover(db, conversationId) {
  if (!db) return false;
  try {
    const row = await db.prepare("SELECT admin_takeover FROM conversations WHERE id = ?").bind(conversationId).first();
    return row ? row.admin_takeover === 1 : false;
  } catch (e) {
    return false;
  }
}

async function getDashboardStats(env) {
  if (!env.DB) {
    return jsonResponse({
      total_conversations: 0,
      ai_active_chats: 0,
      admin_takeover_chats: 0,
      needs_attention_chats: 0,
      global_ai_mode: true,
      engine: "Cloudflare Native Worker + Gemini 2.0/3.8 Flash Live",
      db_status: "Standalone (D1 optional)",
      status: "Operational"
    });
  }

  try {
    const totalConvs = await env.DB.prepare("SELECT COUNT(*) as count FROM conversations").first();
    const activeAiConvs = await env.DB.prepare("SELECT COUNT(*) as count FROM conversations WHERE admin_takeover = 0").first();
    const takeoverConvs = await env.DB.prepare("SELECT COUNT(*) as count FROM conversations WHERE admin_takeover = 1").first();
    const attentionConvs = await env.DB.prepare("SELECT COUNT(*) as count FROM conversations WHERE needs_attention = 1").first();
    const globalAiSetting = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'global_ai_mode'").first();

    return jsonResponse({
      total_conversations: totalConvs?.count || 0,
      ai_active_chats: activeAiConvs?.count || 0,
      admin_takeover_chats: takeoverConvs?.count || 0,
      needs_attention_chats: attentionConvs?.count || 0,
      global_ai_mode: globalAiSetting?.value === "1",
      engine: "Cloudflare Native Worker + Gemini 2.0/3.8 Flash Live",
      status: "Operational"
    });
  } catch (e) {
    return jsonResponse({
      total_conversations: 0,
      ai_active_chats: 0,
      admin_takeover_chats: 0,
      needs_attention_chats: 0,
      global_ai_mode: true,
      engine: "Cloudflare Native Worker + Gemini 2.0/3.8 Flash Live",
      status: "Operational"
    });
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

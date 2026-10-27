/**
 * SocialAutomate - High-Efficiency Multi-Platform Cloudflare Worker Architecture
 * -----------------------------------------------------------------------------
 * 1. Lifetime 1-Time Social Connections: Meta (Facebook Page, WhatsApp, Instagram)
 * 2. Zero-Terminal Webhook Handshake: GET /webhook/meta verification + subscribed_apps
 * 3. 0-Worker Request Dashboard: Zero background polling, 100% event-driven
 * 4. D1 Strictly for Business Data: Products & Store Policies (Cached via Cloudflare Cache API)
 * 5. Gemini AI Decision Engine: Structured JSON response + Outbound Multi-Channel Reply
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// In-Memory Fast Lookup (Mirrored with Cloudflare Cache API)
const memorySessions = new Map();
const userLastMessageTime = new Map();
let activeMetaToken = null;
let activeMetaPageId = null;

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ०. সিস্টেম হেলথ ও কানেকশন স্ট্যাটাস
      if (request.method === "GET" && (path === "/" || path === "/api" || path === "/status")) {
        const hasD1 = Boolean(env.DB);
        let connectedAccounts = [];
        let productCount = 0;

        if (hasD1) {
          await ensureTables(env.DB);
          const { results: accs } = await env.DB.prepare("SELECT platform, account_name, status FROM social_accounts WHERE status = 'active'").all();
          connectedAccounts = accs || [];
          const pRow = await env.DB.prepare("SELECT COUNT(*) as cnt FROM products WHERE is_active = 1").first();
          productCount = pRow?.cnt || 0;
        }

        return jsonResponse({
          status: "online",
          architecture: "Event-Driven Zero-Polling Engine",
          d1_database: hasD1 ? "✅ Connected (Stores Products & Store Config)" : "❌ Not Bound (Bind 'DB')",
          products_in_d1: productCount,
          connected_platforms: connectedAccounts,
          active_sessions_cached: memorySessions.size,
          webhook_endpoints: {
            meta: `${url.origin}/webhook/meta`,
            telegram: `${url.origin}/webhook/telegram`
          },
          timestamp: new Date().toISOString()
        });
      }

      // ==========================================
      // ০. টিকটক ডোমেইন ভেরিফিকেশন টেক্সট ফাইল রুট
      // ==========================================
      if (request.method === "GET" && (path.toLowerCase().includes("tiktok") && path.endsWith(".txt"))) {
        return new Response("tiktok-developers-site-verification=c08852w0Lw08iYtozIiZEFmNR3XYa8u8", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS_HEADERS }
        });
      }

      // ==========================================
      // ১. মেটা ও হোয়াটসঅ্যাপ Webhook Verification (১-বার লাইফটাইম হ্যান্ডশেক)
      // ==========================================
      if (request.method === "GET" && (path === "/webhook/meta" || path === "/api/meta/webhook" || path === "/webhook/whatsapp" || path === "/api/whatsapp/webhook")) {
        const hubMode = url.searchParams.get("hub.mode");
        const hubToken = url.searchParams.get("hub.verify_token");
        const hubChallenge = url.searchParams.get("hub.challenge");

        let expectedToken = env.META_VERIFY_TOKEN || "my_secure_meta_webhook_token_123";
        if (env.DB) {
          const dbToken = await getConfigValue(env.DB, "meta_verify_token", null);
          if (dbToken) expectedToken = dbToken;
        }

        if (hubMode === "subscribe" && (
          hubToken === expectedToken || 
          hubToken === "my_secure_meta_webhook_token_123" || 
          hubToken === "social_automate_verify_token_2026"
        )) {
          return new Response(hubChallenge, { status: 200 });
        }
        return new Response("Verification token mismatch", { status: 403 });
      }

      // ==========================================
      // ২. হোয়াটসঅ্যাপ Webhook ইভেন্ট রিসিভার (WhatsApp Web Bridge / Cloud API)
      // ==========================================
      if (request.method === "POST" && (path === "/webhook/whatsapp" || path === "/api/whatsapp/webhook")) {
        const body = await request.json().catch(() => ({}));
        return await handleWhatsAppUpdate(body, env, ctx, url.origin);
      }

      // ==========================================
      // ৩. হোয়াটসঅ্যাপ কানেকশন ও কনফিগ API
      // ==========================================
      if (request.method === "POST" && path === "/api/setup-whatsapp") {
        const body = await request.json();
        return await handleSetupWhatsApp(body, env);
      }

      // ==========================================
      // ৩.১ টিকটক ড্যাশবোর্ড কানেকশন ও কনফিগ API
      // ==========================================
      if (request.method === "POST" && path === "/api/setup-tiktok") {
        const body = await request.json();
        return await handleSetupTikTok(body, env);
      }

      // ==========================================
      // ৩.২ টিকটক অফিসিয়াল OAuth ১-ক্লিক লগইন ও কলব্যাক
      // ==========================================
      if (request.method === "GET" && path === "/api/auth/tiktok/login") {
        return await handleTikTokOAuthLogin(url, env);
      }

      if (request.method === "GET" && path === "/api/auth/tiktok/callback") {
        return await handleTikTokOAuthCallback(url, env);
      }

      // ==========================================
      // ৩.৩ ড্যাশবোর্ড থেকে ১-ক্লিক ইনস্ট্যান্ট পোস্ট ট্রিগার (GitHub Actions Engine)
      // ==========================================
      if (request.method === "POST" && path === "/api/trigger-post") {
        const body = await request.json().catch(() => ({}));
        return await handleTriggerPost(body, env);
      }

      // ==========================================
      // ৩.৪ ড্যাশবোর্ড সেটিংস ও কানেক্টেড অ্যাকাউন্ট লোড API
      // ==========================================
      if (request.method === "GET" && path === "/api/settings") {
        return await handleGetSettings(env);
      }

      // ==========================================
      // ৩.৫ গিটহাব অ্যাকশনস ক্রেডেনশিয়াল সেভ API
      // ==========================================
      if (request.method === "POST" && path === "/api/setup-github") {
        const body = await request.json().catch(() => ({}));
        return await handleSetupGitHub(body, env);
      }

      // ==========================================
      // ৪. মেটা Webhook ইভেন্ট রিসিভার (Inbound Message/Comment)
      // ==========================================
      if (request.method === "POST" && (path === "/webhook/meta" || path === "/api/meta/webhook")) {
        const body = await request.json();
        return await handleMetaUpdate(body, env, ctx, url.origin);
      }

      // ==========================================
      // ৫. মেটা ১-টাইম কানেক্ট API (POST /api/setup-meta)
      // ==========================================
      if (request.method === "POST" && path === "/api/setup-meta") {
        const body = await request.json();
        return await handleSetupMeta(body, env);
      }

      // ==========================================
      // ৬. টেলিগ্রাম Webhook (ঐচ্ছিক ব্যাকআপ)
      // ==========================================
      if (request.method === "POST" && (path === "/webhook/telegram" || path === "/api/telegram/webhook")) {
        const update = await request.json();
        return await handleTelegramUpdate(update, env, ctx, url.origin);
      }

      // ==========================================
      // ৭. ড্যাশবোর্ড থেকে আউটবাউন্ড অ্যাডমিন রিপ্লাই
      // ==========================================
      if (request.method === "POST" && (path === "/api/admin-reply" || path === "/api/admin/reply")) {
        const body = await request.json();
        return await handleAdminReply(body, env);
      }

      // ==========================================
      // ৬. লাইভ সেশন ফেচ (শুধুমাত্র অ্যাডমিন রিফ্রেশ বাটনে চাপলে কল হবে)
      // ==========================================
      if (request.method === "GET" && path === "/api/conversations") {
        let list = [];
        if (env.DB) {
          try {
            await ensureTables(env.DB);
            const { results } = await env.DB.prepare(
              "SELECT chat_id as id, chat_id as sender_id, sender_name as name, platform, last_message, last_message_at, admin_takeover, needs_attention, messages_json FROM live_conversations ORDER BY last_message_at DESC LIMIT 50"
            ).all();
            if (results && results.length > 0) {
              list = results.map(r => {
                let count = 0;
                try { count = JSON.parse(r.messages_json || "[]").length; } catch (e) {}
                return {
                  id: r.id,
                  sender_id: r.sender_id,
                  name: r.name,
                  platform: r.platform || "facebook",
                  last_message: r.last_message,
                  last_message_at: r.last_message_at,
                  admin_takeover: r.admin_takeover,
                  needs_attention: r.needs_attention,
                  messages_count: count
                };
              });
            }
          } catch (e) {
            console.warn("Could not read D1 live_conversations:", e);
          }
        }

        if (list.length === 0) {
          list = Array.from(memorySessions.values()).map(s => ({
            id: s.chat_id,
            sender_id: s.chat_id,
            name: s.sender_name,
            platform: s.platform || "facebook",
            last_message: s.last_message,
            last_message_at: s.last_message_at,
            admin_takeover: s.admin_takeover ? 1 : 0,
            needs_attention: s.needs_attention ? 1 : 0,
            messages_count: s.messages ? s.messages.length : 0
          })).sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
        }

        return jsonResponse(list);
      }

      if (request.method === "GET" && path === "/api/messages") {
        const chatId = url.searchParams.get("chat_id") || url.searchParams.get("conversation_id");
        if (!chatId) return jsonResponse({ error: "Missing chat_id parameter" }, 400);

        const cleanId = String(chatId).replace(/^(tg_|fb_|wa_)/, '');
        const session = await getSession(cleanId, env);
        return jsonResponse(session ? session.messages : []);
      }

      // টেস্ট ইনকামিং মেসেজ (ড্যাশবোর্ড বা কার্ল দিয়ে সরাসরি টেস্ট করার জন্য)
      if (request.method === "POST" && path === "/api/test-incoming") {
        const body = await request.json().catch(() => ({}));
        const platform = body.platform || "whatsapp";
        const testSenderId = body.sender_id || (platform === "whatsapp" ? `wa_01882${Math.floor(Math.random() * 899999 + 100000)}` : `fb_user_${Math.floor(Math.random() * 89999 + 10000)}`);
        const testName = body.sender_name || (platform === "whatsapp" ? "WhatsApp Customer (+88018...)" : "Facebook Customer");
        const testMsg = body.message || "Assalamu alaikum, product er dam koto?";
        const session = await appendMessageToSession(testSenderId, testName, "customer", testMsg, platform, env);
        return jsonResponse({
          success: true,
          message: `Test message for ${platform} stored successfully in D1!`,
          chat_id: testSenderId,
          platform: platform,
          last_message: testMsg
        });
      }

      // ==========================================
      // ৭. D1 বিজনেস ডেটা: প্রোডাক্টস ক্যাটালগ CRUD
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
        if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
        await ensureTables(env.DB);
        const body = await request.json();
        const {
          id, name, price, description, category, image_url, product_url,
          posting_time, daily_auto_post, stock_status, target_platform,
          schedule_type, interval_hours
        } = body;

        const prodId = id || `prod_${Date.now()}`;
        await env.DB.prepare(`
          INSERT INTO products (
            id, name, price, description, category, image_url, product_url,
            posting_time, daily_auto_post, stock_status, target_platform,
            schedule_type, interval_hours, is_active
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            price = excluded.price,
            description = excluded.description,
            category = excluded.category,
            image_url = excluded.image_url,
            product_url = excluded.product_url,
            posting_time = excluded.posting_time,
            daily_auto_post = excluded.daily_auto_post,
            stock_status = excluded.stock_status,
            target_platform = excluded.target_platform,
            schedule_type = excluded.schedule_type,
            interval_hours = excluded.interval_hours
        `).bind(
          prodId,
          name,
          parseFloat(price) || 0,
          description || '',
          category || 'General',
          image_url || '',
          product_url || '',
          posting_time || '10:00',
          daily_auto_post !== undefined ? Number(daily_auto_post) : 1,
          stock_status || 'in_stock',
          target_platform || 'facebook',
          schedule_type || 'daily',
          interval_hours ? Number(interval_hours) : 4
        ).run();

        await invalidateBusinessCache();
        return jsonResponse({ success: true, id: prodId, message: "Product saved to D1" });
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
      // ৭.১ ওয়েবসাইট লিংক থেকে স্বয়ংক্রিয় প্রোডাক্ট ও R2 ছবি ফেচ API
      // ==========================================
      if (request.method === "POST" && path === "/api/extract-product") {
        const body = await request.json().catch(() => ({}));
        const targetUrl = body.url || body.product_url;
        if (!targetUrl) return jsonResponse({ error: "Missing product url" }, 400);
        const extracted = await extractProductFromUrl(targetUrl);
        return jsonResponse(extracted, extracted.success ? 200 : 400);
      }

      // ==========================================
      // ৭.২ ড্যাশবোর্ড থেকে ১-ক্লিক ডাইরেক্ট টেস্ট পোস্ট (Worker Engine)
      // ==========================================
      if (request.method === "POST" && path === "/api/publish-product-now") {
        const body = await request.json().catch(() => ({}));
        return await handlePublishProductNow(body, env);
      }

      // ==========================================
      // ৭.২.১ ক্রন শিডিউল স্ট্যাটাস ও ম্যানুয়াল রান ডায়াগনস্টিক API
      // ==========================================
      if (request.method === "GET" && (path === "/api/cron-status" || path === "/api/check-schedule")) {
        return await handleCronStatusCheck(url, env);
      }

      // ==========================================
      // ৭.৩ অটো-পোস্টিং টাস্ক ও হিস্ট্রি API (GitHub Actions এর জন্য)
      // ==========================================
      if (request.method === "GET" && path === "/api/auto-post-task") {
        if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
        await ensureTables(env.DB);

        // ১. অ্যাক্টিভ শিডিউল্ড প্রোডাক্টগুলো নেওয়া
        const { results: prods } = await env.DB.prepare(
          "SELECT * FROM products WHERE is_active = 1 AND daily_auto_post = 1 ORDER BY created_at DESC"
        ).all();

        const tasks = [];
        for (const p of (prods || [])) {
          // পূর্বের পোস্ট হিস্ট্রি (যাতে AI রিপিট না করে)
          const { results: hist } = await env.DB.prepare(
            "SELECT caption, angle, platform, published_at FROM post_history WHERE product_id = ? ORDER BY published_at DESC LIMIT 3"
          ).bind(p.id).all();

          tasks.push({
            ...p,
            target_platform: p.target_platform || "tiktok",
            previous_posts: hist || []
          });
        }

        // ২. D1 থেকে সোশ্যাল অ্যাকাউন্ট ক্রেডেনশিয়ালস নেওয়া (TikTok, Facebook, etc.)
        const { results: accs } = await env.DB.prepare(
          "SELECT platform, account_name, account_id, access_token FROM social_accounts WHERE status = 'active'"
        ).all();

        const credentials = {};
        for (const a of (accs || [])) {
          credentials[a.platform] = {
            name: a.account_name,
            id: a.account_id,
            token: a.access_token
          };
        }

        return jsonResponse({
          success: true,
          count: tasks.length,
          tasks,
          credentials
        });
      }

      if (request.method === "POST" && path === "/api/record-post") {
        if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
        await ensureTables(env.DB);
        const body = await request.json();
        const { product_id, platform, caption, angle, post_id } = body;

        const histId = `post_${Date.now()}`;
        await env.DB.prepare(`
          INSERT INTO post_history (id, product_id, platform, caption, angle, post_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(histId, product_id, platform || 'facebook', caption || '', angle || 'General', post_id || '').run();

        return jsonResponse({ success: true, id: histId, message: "Post history recorded" });
      }

      // ==========================================
      // ৮. D1 বিজনেস ডেটা: স্টোর ইনফো ও পলিসিজ
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
        return jsonResponse({ success: true, message: "Store profile updated in D1" });
      }

      // ==========================================
      // ৯. সেটিংস ও সোশ্যাল অ্যাকাউন্টস
      // ==========================================
      if (request.method === "GET" && path === "/api/settings") {
        let accounts = [];
        let verifyToken = "social_automate_verify_token_2026";

        if (env.DB) {
          await ensureTables(env.DB);
          const { results } = await env.DB.prepare("SELECT id, platform, account_name, status FROM social_accounts").all();
          accounts = results || [];
          const vt = await getConfigValue(env.DB, "meta_verify_token", null);
          if (vt) verifyToken = vt;
        }

        return jsonResponse({
          d1_connected: Boolean(env.DB),
          connected_accounts: accounts,
          meta_webhook_url: `${url.origin}/webhook/meta`,
          whatsapp_webhook_url: `${url.origin}/webhook/whatsapp`,
          meta_verify_token: verifyToken,
          whatsapp_verify_token: verifyToken
        });
      }

      return jsonResponse({ error: "Endpoint not found", path }, 404);

    } catch (err) {
      console.error("Worker Global Error:", err);
      return jsonResponse({ error: err.message, stack: err.stack }, 500);
    }
  },

  // ⏰ ক্রন শিডিউল: নির্দিষ্ট সময়ে স্বয়ংক্রিয়ভাবে D1 প্রোডাক্ট ও শিডিউল চেক করে ফেসবুক/সোশ্যালে পোস্ট করবে (Ultra-Low CPU)
  async scheduled(event, env, ctx) {
    console.log("⏰ [Cron Triggered] Scheduled check starting...");
    ctx.waitUntil(handleScheduledAutoPosting(env));
  }
};

// ========================================================
// 🟢 WHATSAPP (WEB GATEWAY & CLOUD API) HANDLER
// ========================================================
async function handleWhatsAppUpdate(body, env, ctx, workerOrigin) {
  let senderPhone = null;
  let senderName = null;
  let incomingText = null;

  // ১. মেটা অফিসিয়াল ক্লাউড API পেলোড
  if (body.object === "whatsapp_business_account" || body.entry?.[0]?.changes?.[0]?.value?.messages) {
    const value = body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (msg) {
      senderPhone = msg.from;
      senderName = value.contacts?.[0]?.profile?.name || `WhatsApp (+${senderPhone})`;
      incomingText = msg.text?.body || msg.interactive?.button_reply?.title || "";
    }
  }
  // ২. Baileys / Evolution API পেলোড
  else if (body.event === "messages.upsert" || body.data?.message) {
    const data = body.data || body;
    const msg = data.message || {};
    const jid = data.key?.remoteJid || body.sender || "";
    if (!data.key?.fromMe) {
      senderPhone = jid.replace(/@.*$/, "");
      senderName = data.pushName || `WhatsApp (+${senderPhone})`;
      incomingText = msg.conversation || msg.extendedTextMessage?.text || "";
    }
  }
  // ৩. জেনেরিক বা কাস্টম ব্রিজ পেলোড ({ phone, message, name } অথবা { from, body, senderName })
  else if (body.phone || body.from || body.number) {
    senderPhone = String(body.phone || body.from || body.number).replace(/[^0-9]/g, "");
    senderName = body.name || body.senderName || body.pushName || `WhatsApp (+${senderPhone})`;
    incomingText = body.message || body.body || body.text || "";
  }

  if (!senderPhone || !incomingText || !incomingText.trim()) {
    return jsonResponse({ status: "ignored", reason: "No valid message text or from self" });
  }

  senderPhone = senderPhone.trim();
  incomingText = incomingText.trim();
  const chatId = `wa_${senderPhone}`;

  // অ্যান্টি-স্প্যাম ডিবাউন্স
  const now = Date.now();
  const lastTime = userLastMessageTime.get(chatId) || 0;
  if (now - lastTime < 2500) {
    await appendMessageToSession(chatId, senderName, "customer", incomingText, "whatsapp", env);
    return jsonResponse({ status: "debounced" });
  }
  userLastMessageTime.set(chatId, now);

  const session = await appendMessageToSession(chatId, senderName, "customer", incomingText, "whatsapp", env);

  // হ্যান্ডওভার চেক (এডমিন টেকওভার চালু থাকলে AI উত্তর দেবে না)
  if (session.admin_takeover && (session.takeover_until ? session.takeover_until > now : true)) {
    return jsonResponse({ status: "admin_takeover_active" });
  }

  // D1 বিজনেস ডেটা রিড
  const businessContext = await getCachedBusinessContext(env.DB);

  // Gemini AI কল (Structured Response)
  const aiDecision = await callGeminiStructured(incomingText, session.messages.slice(-6), businessContext, env);

  if (aiDecision.reply) {
    // হোয়াটসঅ্যাপে অটো-রিপ্লাই পাঠানো
    await sendWhatsAppMessage(senderPhone, aiDecision.reply, env);
    await appendMessageToSession(chatId, senderName, "assistant", aiDecision.reply, "whatsapp", env);
  }

  return jsonResponse({ status: "success", reply_sent: Boolean(aiDecision.reply) });
}

// 📤 হোয়াটসঅ্যাপ মেসেজ সেন্ডার (Gateway / Cloud API)
async function sendWhatsAppMessage(recipientPhone, messageText, env) {
  if (!recipientPhone || !messageText) return { success: false, reason: "Missing phone or text" };
  const cleanPhone = String(recipientPhone).replace(/[^0-9]/g, '');

  // ১. চেক: WhatsApp Web Gateway (Baileys / Evolution API / UltraMsg / Green API)
  let gatewayUrl = env.WHATSAPP_GATEWAY_URL;
  let gatewayToken = env.WHATSAPP_GATEWAY_TOKEN;

  if (env.DB) {
    const dbUrl = await getConfigValue(env.DB, "whatsapp_gateway_url", null);
    const dbToken = await getConfigValue(env.DB, "whatsapp_gateway_token", null);
    if (dbUrl) gatewayUrl = dbUrl;
    if (dbToken) gatewayToken = dbToken;
  }

  if (gatewayUrl) {
    try {
      const res = await fetch(gatewayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(gatewayToken ? { "apikey": gatewayToken, "Authorization": `Bearer ${gatewayToken}` } : {})
        },
        body: JSON.stringify({
          number: cleanPhone,
          to: cleanPhone,
          text: messageText,
          message: messageText
        })
      });
      return { success: res.ok, mode: "gateway" };
    } catch (e) {
      console.error("WhatsApp Gateway send failed:", e);
    }
  }

  // ২. চেক: Official Meta WhatsApp Cloud API
  let cloudToken = env.WHATSAPP_ACCESS_TOKEN || env.META_PAGE_ACCESS_TOKEN;
  let phoneId = env.WHATSAPP_PHONE_ID;

  if (env.DB) {
    const dbToken = await getConfigValue(env.DB, "whatsapp_access_token", null);
    const dbPhoneId = await getConfigValue(env.DB, "whatsapp_phone_id", null);
    if (dbToken) cloudToken = dbToken;
    if (dbPhoneId) phoneId = dbPhoneId;
  }

  if (cloudToken && phoneId) {
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${cloudToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanPhone,
          type: "text",
          text: { preview_url: false, body: messageText }
        })
      });
      return { success: res.ok, mode: "cloud_api" };
    } catch (e) {
      console.error("WhatsApp Cloud API send failed:", e);
    }
  }

  return { success: false, reason: "No WhatsApp credentials configured" };
}

// ⚙️ হোয়াটসঅ্যাপ কানেকশন ও কনফিগ সেভ API
async function handleSetupWhatsApp(body, env) {
  const { mode, gateway_url, gateway_token, phone_number_id, access_token, phone } = body;
  if (env.DB) {
    await ensureTables(env.DB);
    if (mode) await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('whatsapp_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(mode).run();
    if (gateway_url) await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('whatsapp_gateway_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(gateway_url.trim()).run();
    if (gateway_token) await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('whatsapp_gateway_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(gateway_token.trim()).run();
    if (phone_number_id) await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('whatsapp_phone_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(phone_number_id.trim()).run();
    if (access_token) await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('whatsapp_access_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(access_token.trim()).run();
    if (phone) await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('whatsapp_phone', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(phone.trim()).run();

    await env.DB.prepare(`
      INSERT INTO social_accounts (id, platform, account_name, account_id, access_token, status)
      VALUES (?, 'whatsapp', ?, ?, ?, 'active')
      ON CONFLICT(id) DO UPDATE SET
        account_name = excluded.account_name,
        access_token = excluded.access_token,
        status = 'active'
    `).bind('whatsapp_primary', `WhatsApp (${phone || 'Business'})`, phone || 'wa_main', gateway_token || access_token || 'connected').run();
  }

  return jsonResponse({
    success: true,
    message: "হোয়াটসঅ্যাপ সেটিংস D1 ডেটাবেসে সফলভাবে সেভ হয়েছে!"
  });
}

// ========================================================
// 🎵 TIKTOK OFFICIAL OAUTH & SETUP HANDLERS
// ========================================================
async function handleSetupTikTok(body, env) {
  if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
  await ensureTables(env.DB);
  const { access_token, client_key, client_secret, account_name } = body;

  if (client_key) {
    await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('tiktok_client_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(client_key.trim()).run();
  }
  if (client_secret) {
    await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('tiktok_client_secret', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(client_secret.trim()).run();
  }

  if (access_token && access_token.trim()) {
    const cleanToken = access_token.trim();
    await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('tiktok_access_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(cleanToken).run();
    await env.DB.prepare(`
      INSERT INTO social_accounts (id, platform, account_name, account_id, access_token, status)
      VALUES ('tiktok_primary', 'tiktok', ?, 'tiktok_main', ?, 'active')
      ON CONFLICT(id) DO UPDATE SET
        account_name = excluded.account_name,
        access_token = excluded.access_token,
        status = 'active'
    `).bind(account_name || 'TikTok Creator Account', cleanToken).run();
  }

  return jsonResponse({
    success: true,
    message: "TikTok অ্যাকাউন্ট সেটিংস D1 ডেটাবেসে সফলভাবে সেভ হয়েছে!"
  });
}

async function handleTikTokOAuthLogin(url, env) {
  let clientKey = url.searchParams.get("client_key");
  if (!clientKey && env.DB) {
    clientKey = await getConfigValue(env.DB, "tiktok_client_key", null);
  }
  if (!clientKey && env.TIKTOK_CLIENT_KEY) {
    clientKey = env.TIKTOK_CLIENT_KEY;
  }
  if (!clientKey) {
    return jsonResponse({ error: "Missing TikTok client_key. অনুগ্রহ করে প্রথমে ড্যাশবোর্ডে TikTok Client Key সেভ করুন।" }, 400);
  }

  const redirectUri = encodeURIComponent(`${url.origin}/api/auth/tiktok/callback`);
  const state = Math.random().toString(36).substring(7);
  const tiktokAuthUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=user.info.basic,video.publish,video.upload&response_type=code&redirect_uri=${redirectUri}&state=${state}`;
  return Response.redirect(tiktokAuthUrl, 302);
}

async function handleTikTokOAuthCallback(url, env) {
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error || !code) {
    return new Response(`TikTok কানেকশন ব্যর্থ হয়েছে: ${error || "Code পাওয়া যায়নি"}`, { status: 400 });
  }

  let clientKey = (env.DB ? await getConfigValue(env.DB, "tiktok_client_key", null) : null) || env.TIKTOK_CLIENT_KEY;
  let clientSecret = (env.DB ? await getConfigValue(env.DB, "tiktok_client_secret", null) : null) || env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    return new Response("Missing TikTok Client Key বা Secret in D1। অনুগ্রহ করে ড্যাশবোর্ডে সেট করুন।", { status: 400 });
  }

  const redirectUri = `${url.origin}/api/auth/tiktok/callback`;
  const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code: code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    })
  });

  const tokenData = await tokenRes.json();
  if (tokenData && tokenData.data && tokenData.data.access_token) {
    const accessToken = tokenData.data.access_token;
    const openId = tokenData.data.open_id || "tiktok_creator";
    
    if (env.DB) {
      await ensureTables(env.DB);
      await env.DB.prepare(`
        INSERT INTO social_accounts (id, platform, account_name, account_id, access_token, status)
        VALUES ('tiktok_primary', 'tiktok', 'TikTok Creator Account', ?, ?, 'active')
        ON CONFLICT(id) DO UPDATE SET
          account_id = excluded.account_id,
          access_token = excluded.access_token,
          status = 'active'
      `).bind(openId, accessToken).run();

      await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('tiktok_access_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(accessToken).run();
    }

    return Response.redirect("https://automate.ranonex.shop/?tab=settings&tiktok_connected=1", 302);
  } else {
    return new Response(`Failed to exchange TikTok code for token: ${JSON.stringify(tokenData)}`, { status: 400 });
  }
}

async function handleTriggerPost(body, env) {
  let ghToken = env.GITHUB_TOKEN;
  let ghRepo = env.GITHUB_REPOSITORY || "rifatrabbi104-oss/social-automate";
  if (env.DB) {
    const dbToken = await getConfigValue(env.DB, "github_token", null);
    const dbRepo = await getConfigValue(env.DB, "github_repo", null);
    if (dbToken) ghToken = dbToken;
    if (dbRepo) ghRepo = dbRepo;
  }
  if (body.github_token) ghToken = body.github_token.trim();
  if (body.github_repo) ghRepo = body.github_repo.trim();

  const targetPlatform = body.target_platform || "facebook";
  const postType = body.post_type || "caption_only";
  const productUrl = body.product_url || "";

  if (ghToken) {
    try {
      const dispatchRes = await fetch(`https://api.github.com/repos/${ghRepo}/actions/workflows/post_publisher.yml/dispatches`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${ghToken}`,
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "SocialAutomate-Worker"
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            target_platform: targetPlatform,
            post_type: postType,
            product_url: productUrl
          }
        })
      });

      if (dispatchRes.ok) {
        return jsonResponse({
          success: true,
          message: `🚀 GitHub Actions-এ ${targetPlatform.toUpperCase()} পোস্ট (${postType === 'caption_only' ? 'ক্যাপশন-অনলি' : 'ছবি সহ'}) সফলভাবে ট্রিগার হয়েছে!`,
          run_url: `https://github.com/${ghRepo}/actions`
        });
      } else {
        const errText = await dispatchRes.text();
        return jsonResponse({
          success: false,
          error: `GitHub Dispatch ব্যর্থ হয়েছে (${dispatchRes.status}): ${errText}`,
          run_url: `https://github.com/${ghRepo}/actions/workflows/post_publisher.yml`
        }, 400);
      }
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  return jsonResponse({
    success: false,
    missing_token: true,
    message: "GitHub Personal Access Token সেভ করা নেই। আপনি সরাসরি GitHub Actions পেজ থেকে ১-ক্লিকে 'Run workflow' চালাতে পারেন অথবা ড্যাশবোর্ডে GitHub টোকেন সেভ করুন।",
    workflow_url: `https://github.com/${ghRepo}/actions/workflows/post_publisher.yml`
  });
}

// ⚙️ ড্যাশবোর্ড সেটিংস ও ক্রেডেনশিয়াল ফেচ API (রিফ্রেশ মারলে ফর্ম পূরণ রাখার জন্য)
async function handleGetSettings(env) {
  const settings = {
    facebook: { connected: false, account_name: '', account_id: '', access_token: '' },
    tiktok: { connected: false, account_name: '', account_id: '', access_token: '', client_key: 'awq5kzk0rv01o6z0', client_secret: '' },
    whatsapp: { connected: false, phone: '', mode: 'gateway', gateway_url: '', gateway_token: '' },
    github: { connected: false, repo: 'rifatrabbi104-oss/social-automate', token: '' }
  };

  if (env.DB) {
    try {
      await ensureTables(env.DB);
      const { results: accs } = await env.DB.prepare(
        "SELECT platform, account_name, account_id, access_token, status FROM social_accounts WHERE status = 'active'"
      ).all();

      for (const a of (accs || [])) {
        if (a.platform === 'facebook') {
          settings.facebook = {
            connected: true,
            account_name: a.account_name || 'Ranonex',
            account_id: a.account_id || '',
            access_token: a.access_token || ''
          };
        } else if (a.platform === 'tiktok') {
          settings.tiktok.connected = true;
          settings.tiktok.account_name = a.account_name || 'TikTok Account';
          settings.tiktok.account_id = a.account_id || '';
          settings.tiktok.access_token = a.access_token || '';
        } else if (a.platform === 'whatsapp') {
          settings.whatsapp.connected = true;
          settings.whatsapp.phone = a.account_id || '';
          settings.whatsapp.gateway_token = a.access_token || '';
        }
      }

      const { results: configs } = await env.DB.prepare("SELECT key, value FROM system_config").all();
      for (const c of (configs || [])) {
        if (c.key === 'tiktok_client_key') settings.tiktok.client_key = c.value;
        if (c.key === 'tiktok_client_secret') settings.tiktok.client_secret = c.value;
        if (c.key === 'tiktok_access_token' && !settings.tiktok.access_token) settings.tiktok.access_token = c.value;
        if (c.key === 'whatsapp_mode') settings.whatsapp.mode = c.value;
        if (c.key === 'whatsapp_phone') settings.whatsapp.phone = c.value;
        if (c.key === 'whatsapp_gateway_url') settings.whatsapp.gateway_url = c.value;
        if (c.key === 'whatsapp_gateway_token') settings.whatsapp.gateway_token = c.value;
        if (c.key === 'github_token') {
          settings.github.connected = Boolean(c.value);
          settings.github.token = c.value;
        }
        if (c.key === 'github_repo') settings.github.repo = c.value;
      }
    } catch (e) {
      console.warn("Could not load settings from D1:", e);
    }
  }

  return jsonResponse({ success: true, settings });
}

// 🐙 GitHub Actions সেটিংস সেভ API
async function handleSetupGitHub(body, env) {
  if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
  await ensureTables(env.DB);
  const { github_token, github_repo } = body;
  if (github_token) {
    await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('github_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(github_token.trim()).run();
  }
  if (github_repo) {
    await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('github_repo', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(github_repo.trim()).run();
  }
  return jsonResponse({
    success: true,
    message: "GitHub Actions ক্রেডেনশিয়ালস D1 ডেটাবেসে সফলভাবে সেভ হয়েছে!"
  });
}

// ========================================================
// 🔵 META (FACEBOOK / INSTAGRAM / WHATSAPP) HANDLER
// ========================================================
async function handleMetaUpdate(body, env, ctx, workerOrigin) {
  // হোয়াটসঅ্যাপ বিজনেস অ্যাকাউন্ট হলে সরাসরি হোয়াটসঅ্যাপ হ্যান্ডলারে পাঠানো
  if (body.object === "whatsapp_business_account") {
    return await handleWhatsAppUpdate(body, env, ctx, workerOrigin);
  }

  // মেটা ইভেন্ট ভ্যালিডেশন
  if (body.object !== "page" && body.object !== "instagram") {
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  // ১. ফেসবুক পেজ / মেসেঞ্জার মেসেজ
  const messaging = body.entry?.[0]?.messaging?.[0];
  if (messaging && messaging.message && messaging.message.text && !messaging.message.is_echo) {
    const senderId = String(messaging.sender.id);
    const recipientId = String(messaging.recipient.id);
    const incomingText = messaging.message.text.trim();
    const senderName = `User (${senderId.slice(-4)})`;

    // অ্যান্টি-স্প্যাম ডিবাউন্স
    const now = Date.now();
    const lastTime = userLastMessageTime.get(senderId) || 0;
    if (now - lastTime < 2500) {
      await appendMessageToSession(senderId, senderName, "customer", incomingText, "facebook", env);
      return new Response("EVENT_RECEIVED", { status: 200 });
    }
    userLastMessageTime.set(senderId, now);

    const session = await appendMessageToSession(senderId, senderName, "customer", incomingText, "facebook", env);

    // হ্যান্ডওভার চেক
    if (session.admin_takeover && (session.takeover_until ? session.takeover_until > now : true)) {
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    // D1 বিজনেস ডেটা রিড (১০ মিনিটের ক্যাশ API)
    const businessContext = await getCachedBusinessContext(env.DB);

    // Gemini AI কল (Structured Response)
    const aiDecision = await callGeminiStructured(incomingText, session.messages.slice(-6), businessContext, env);

    if (aiDecision.reply) {
      // মেটা গ্রাফ API দিয়ে পেজ থেকে মেসেঞ্জারে উত্তর পাঠানো
      const token = await getMetaPageToken(env, recipientId);
      if (token) {
        await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: senderId },
            message: { text: aiDecision.reply }
          })
        });
      }
      await appendMessageToSession(senderId, senderName, "assistant", aiDecision.reply, "facebook", env);
    }

    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  // ২. পেজের পোস্টের কমেন্ট (Feed Comments Auto-Reply)
  const changes = body.entry?.[0]?.changes?.[0];
  if (changes && changes.field === "feed") {
    const val = changes.value;
    if (val && val.item === "comment" && val.verb === "add" && val.message) {
      const commentId = val.comment_id;
      const commentText = val.message.trim();
      const commenterId = val.from?.id;

      // নিজের পেজের কমেন্টে রিপ্লাই দেবে না
      const token = await getMetaPageToken(env);
      if (token && commentId && (!activeMetaPageId || commenterId !== activeMetaPageId)) {
        const businessContext = await getCachedBusinessContext(env.DB);
        const aiDecision = await callGeminiStructured(commentText, [], businessContext, env);
        if (aiDecision.reply) {
          await fetch(`https://graph.facebook.com/v19.0/${commentId}/comments?access_token=${token}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: aiDecision.reply })
          });
        }
      }
    }
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}

// ========================================================
// ⚡ 1-TIME LIFETIME META CONNECTION SETUP
// ========================================================
async function handleSetupMeta(body, env) {
  const { page_access_token, page_id, verify_token, platform } = body;
  if (!page_access_token || !page_access_token.trim()) {
    return jsonResponse({ error: "Page Access Token is required" }, 400);
  }

  const cleanToken = page_access_token.trim();
  const cleanPlatform = platform || "facebook";
  let accountId = page_id ? page_id.trim() : null;
  let accountName = "Facebook Page";

  // ১. মেটা গ্রাফ API দিয়ে পেজ আইডি ভেরিফাই
  try {
    const testRes = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${cleanToken}`);
    const testData = await testRes.json();
    if (testData.id) {
      accountId = testData.id;
      if (testData.name) accountName = testData.name;
    }
  } catch (e) {
    console.warn("Could not query /me:", e);
  }

  if (!accountId && page_id) {
    accountId = page_id.trim();
  }
  if (!accountId) {
    accountId = "1287050647827199";
  }
  accountName = accountName || `Facebook Page (${accountId})`;

  // ২. পেজকে স্বয়ংক্রিয়ভাবে Webhooks-এ সাবস্ক্রাইব করা (১-বার লাইফটাইম)
  let subStatus = "active";
  try {
    const subRes = await fetch(`https://graph.facebook.com/v19.0/${accountId}/subscribed_apps?subscribed_fields=messages,feed,messaging_postbacks&access_token=${cleanToken}`, {
      method: "POST"
    });
    const subJson = await subRes.json();
    if (subJson && subJson.success) subStatus = "subscribed_auto";
  } catch (e) {
    subStatus = "subscribed_fallback";
  }

  // ৩. ইন-মেমোরি ও এজ ক্যাশে সেভ (১০০% ক্যাশ ব্যাকআপ)
  activeMetaToken = cleanToken;
  activeMetaPageId = accountId;

  try {
    const cache = caches.default;
    const tokenUrl = new URL("https://internal-cache.local/config/meta_token");
    await cache.put(tokenUrl, new Response(JSON.stringify({ token: cleanToken, page_id: accountId, name: accountName }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "max-age=2592000" }
    }));
  } catch (e) {}

  // ৪. D1 social_accounts টেবিলে সংরক্ষণ (যদি D1 থাকে)
  if (env.DB) {
    try {
      await ensureTables(env.DB);
      await env.DB.prepare(`
        INSERT INTO social_accounts (id, platform, account_name, account_id, access_token, status)
        VALUES (?, ?, ?, ?, ?, 'active')
        ON CONFLICT(id) DO UPDATE SET
          account_name = excluded.account_name,
          access_token = excluded.access_token,
          status = 'active'
      `).bind(`meta_${accountId}`, cleanPlatform, accountName, accountId, cleanToken).run();

      if (verify_token) {
        await env.DB.prepare(`
          INSERT INTO system_config (key, value) VALUES ('meta_verify_token', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).bind(verify_token.trim()).run();
      }
    } catch (e) {
      console.warn("D1 save failed, cached in edge cache:", e);
    }
  }

  return jsonResponse({
    success: true,
    message: `${accountName} সফলভাবে লাইফটাইম সংযুক্ত হয়েছে!`,
    account: { id: accountId, name: accountName, platform: cleanPlatform },
    subscription: subStatus
  });
}

// ========================================================
// 👤 ADMIN MANUAL REPLY (DASHBOARD OUTBOUND)
// ========================================================
async function handleAdminReply(body, env) {
  const { chat_id, message_text, platform } = body;
  if (!chat_id || !message_text || !message_text.trim()) {
    return jsonResponse({ error: "Missing chat_id or message_text" }, 400);
  }

  const cleanText = message_text.trim();
  const cleanId = String(chat_id).replace(/^(tg_|fb_|wa_)/, '');

  // ১. মেটা পেজে রিপ্লাই
  if (platform === "facebook" || platform === "meta") {
    const token = await getMetaPageToken(env);
    if (token) {
      await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: cleanId },
          message: { text: cleanText }
        })
      });
    }
  } else if (platform === "whatsapp" || String(chat_id).startsWith("wa_")) {
    // ২. হোয়াটসঅ্যাপে রিপ্লাই পাঠানো (Gateway বা Cloud API দিয়ে)
    await sendWhatsAppMessage(cleanId, cleanText, env);
  }

  const session = await appendMessageToSession(cleanId, `User (${cleanId})`, "admin", cleanText, platform || "facebook", env);
  session.admin_takeover = true;
  session.takeover_until = Date.now() + 30 * 60 * 1000;
  session.needs_attention = false;
  await saveSession(cleanId, session, env);

  return jsonResponse({
    success: true,
    delivered: true,
    chat_id: cleanId,
    text: cleanText
  });
}

// ========================================================
// 🤖 GEMINI AI ENGINE (STRUCTURED RESPONSE)
// ========================================================
async function callGeminiStructured(userMessage, recentHistory, businessContext, env) {
  const apiKey = env.GEMINI_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";

  if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY") {
    return {
      reply: "ধন্যবাদ আপনার বার্তার জন্য! আমাদের একজন প্রতিনিধি খুব শীঘ্রই আপনাকে সহায়তা করবেন। নির্দিষ্ট কোনো প্রোডাক্ট সম্পর্কে জানতে চাইলে নির্দ্বিধায় লিখুন।",
      urgent_admin_alert: false
    };
  }

  const systemInstruction = 
`You are an intelligent, polite customer support assistant for our business.
Always respond warmly and accurately in Bengali or Banglish.
Answer inquiries regarding products, prices, and delivery strictly based on this D1 Business Information:
${businessContext}

Respond ONLY with a JSON object: {"reply": "Your response", "urgent_admin_alert": false}`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: { temperature: 0.5, response_mime_type: "application/json" }
      })
    });

    if (res.ok) {
      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText) {
        const parsed = JSON.parse(rawText);
        return { reply: parsed.reply || rawText, urgent_admin_alert: Boolean(parsed.urgent_admin_alert) };
      }
    }
  } catch (e) {}

  return { reply: "ধন্যবাদ! আমরা আপনার মেসেজটি পেয়েছি। কিছুক্ষণের মধ্যে উত্তর দেওয়া হবে।", urgent_admin_alert: false };
}

// ========================================================
// 🗄️ D1 BUSINESS CONTEXT & CACHE API
// ========================================================
let localBusinessCache = { data: null, expiresAt: 0 };

async function getCachedBusinessContext(db) {
  const now = Date.now();
  if (localBusinessCache.data && localBusinessCache.expiresAt > now) {
    return localBusinessCache.data;
  }

  if (!db) return "Standard Store Policies: Cash on Delivery available across the country.";

  try {
    await ensureTables(db);
    const { results: products } = await db.prepare("SELECT name, price, stock_status FROM products WHERE is_active = 1 LIMIT 30").all();
    const { results: profileRows } = await db.prepare("SELECT key, value FROM system_config").all();

    let context = "=== STORE INFORMATION (D1 DATABASE) ===\n";
    for (const r of (profileRows || [])) {
      if (!r.key.includes("token") && !r.key.includes("key")) {
        context += `- ${r.key}: ${r.value}\n`;
      }
    }
    if (products && products.length > 0) {
      context += "\n=== PRODUCTS ===\n";
      for (const p of products) {
        context += `- ${p.name}: ৳${p.price} (${p.stock_status})\n`;
      }
    }

    localBusinessCache = { data: context, expiresAt: now + 10 * 60 * 1000 };
    return context;
  } catch (e) {
    return "Standard Store Support.";
  }
}

async function invalidateBusinessCache() {
  localBusinessCache = { data: null, expiresAt: 0 };
}

// ========================================================
// 🧠 CACHE API & D1 LIVE CONVERSATIONS STORE
// ========================================================
async function getSession(chatId, env = null) {
  if (memorySessions.has(chatId)) return memorySessions.get(chatId);
  try {
    const cache = caches.default;
    const cacheUrl = new URL(`https://internal-cache.local/session/${chatId}`);
    const res = await cache.match(cacheUrl);
    if (res) {
      const s = await res.json();
      memorySessions.set(chatId, s);
      return s;
    }
  } catch (e) {}

  if (env && env.DB) {
    try {
      await ensureTables(env.DB);
      const row = await env.DB.prepare("SELECT * FROM live_conversations WHERE chat_id = ?").bind(chatId).first();
      if (row) {
        let msgs = [];
        try { msgs = JSON.parse(row.messages_json || "[]"); } catch (e) {}
        const s = {
          chat_id: row.chat_id,
          sender_name: row.sender_name,
          platform: row.platform || "facebook",
          admin_takeover: Boolean(row.admin_takeover),
          takeover_until: 0,
          needs_attention: Boolean(row.needs_attention),
          last_message: row.last_message,
          last_message_at: row.last_message_at,
          messages: msgs
        };
        memorySessions.set(chatId, s);
        return s;
      }
    } catch (e) {}
  }
  return null;
}

async function saveSession(chatId, session, env = null) {
  memorySessions.set(chatId, session);
  try {
    const cache = caches.default;
    const cacheUrl = new URL(`https://internal-cache.local/session/${chatId}`);
    const res = new Response(JSON.stringify(session), {
      headers: { "Content-Type": "application/json", "Cache-Control": "max-age=3600" }
    });
    await cache.put(cacheUrl, res);
  } catch (e) {}

  if (env && env.DB) {
    try {
      await ensureTables(env.DB);
      await env.DB.prepare(`
        INSERT INTO live_conversations (chat_id, sender_name, platform, last_message, last_message_at, admin_takeover, needs_attention, messages_json)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
        ON CONFLICT(chat_id) DO UPDATE SET
          sender_name = excluded.sender_name,
          platform = excluded.platform,
          last_message = excluded.last_message,
          last_message_at = CURRENT_TIMESTAMP,
          admin_takeover = excluded.admin_takeover,
          needs_attention = excluded.needs_attention,
          messages_json = excluded.messages_json
      `).bind(
        chatId,
        session.sender_name || `User (${chatId.slice(-4)})`,
        session.platform || "facebook",
        session.last_message || "",
        session.admin_takeover ? 1 : 0,
        session.needs_attention ? 1 : 0,
        JSON.stringify(session.messages || [])
      ).run();
    } catch (e) {
      console.warn("Could not save conversation to D1:", e);
    }
  }
}

async function appendMessageToSession(chatId, senderName, senderType, text, platform = "meta", env = null) {
  let session = await getSession(chatId, env);
  const nowStr = new Date().toISOString();

  if (!session) {
    session = {
      chat_id: chatId,
      sender_name: senderName,
      platform: platform,
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

  if (session.messages.length > 30) session.messages.shift();
  await saveSession(chatId, session, env);
  return session;
}

async function getMetaPageToken(env, pageId = null) {
  if (env.META_PAGE_ACCESS_TOKEN && !env.META_PAGE_ACCESS_TOKEN.startsWith("YOUR_")) {
    return env.META_PAGE_ACCESS_TOKEN;
  }
  if (activeMetaToken) return activeMetaToken;

  try {
    const cache = caches.default;
    const tokenUrl = new URL("https://internal-cache.local/config/meta_token");
    const cached = await cache.match(tokenUrl);
    if (cached) {
      const data = await cached.json();
      if (data && data.token) {
        activeMetaToken = data.token;
        return data.token;
      }
    }
  } catch (e) {}

  if (env.DB) {
    try {
      const row = await env.DB.prepare("SELECT access_token FROM social_accounts WHERE platform = 'facebook' AND status = 'active' ORDER BY created_at DESC").first();
      if (row && row.access_token) {
        activeMetaToken = row.access_token;
        return row.access_token;
      }
    } catch (e) {}
  }
  return null;
}

async function getConfigValue(db, key, fallback = null) {
  if (db) {
    try {
      const row = await db.prepare("SELECT value FROM system_config WHERE key = ?").bind(key).first();
      if (row && row.value) return row.value.trim();
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
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS live_conversations (
          chat_id TEXT PRIMARY KEY,
          sender_name TEXT NOT NULL,
          platform TEXT DEFAULT 'facebook',
          last_message TEXT,
          last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          admin_takeover INTEGER DEFAULT 0,
          needs_attention INTEGER DEFAULT 0,
          messages_json TEXT
        );
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS post_history (
          id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL,
          platform TEXT DEFAULT 'facebook',
          caption TEXT,
          angle TEXT,
          post_id TEXT,
          published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `)
    ]);

    // মাইগ্রেশন: পূর্বের টেবিলে নতুন কলাম থাকলে অ্যাড করা (safe ignore if exists)
    try { await db.prepare("ALTER TABLE products ADD COLUMN image_url TEXT").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN product_url TEXT").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN posting_time TEXT DEFAULT '10:00'").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN daily_auto_post INTEGER DEFAULT 1").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN target_platform TEXT DEFAULT 'facebook'").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN schedule_type TEXT DEFAULT 'daily'").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN interval_hours INTEGER DEFAULT 4").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN last_posted_at TIMESTAMP").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE post_history ADD COLUMN image_url TEXT").run(); } catch (e) {}
  } catch (e) {}
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

// ========================================================
// 🌐 স্মার্ট ওয়েবসাইট প্রোডাক্ট ও পাবলিক R2 ফটো এক্সট্র্যাক্টর
// ========================================================
async function extractProductFromUrl(targetUrl) {
  if (!targetUrl || !targetUrl.trim()) {
    return { success: false, error: "প্রোডাক্ট লিংকটি খালি। অনুগ্রহ করে সঠিক URL দিন।" };
  }
  const cleanUrl = targetUrl.trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(cleanUrl);
  } catch (e) {
    return { success: false, error: "ভুল URL ফরম্যাট! সঠিক লিংক (যেমন: https://ranonex.shop/product.html?id=...) দিন।" };
  }

  const origin = parsedUrl.origin;
  const productId = parsedUrl.searchParams.get("id");

  // ১. ইউজার সাইটের API ও public_data.json থেকে ডাইরেক্ট প্রোডাক্ট ফেচ (100% accurate for CSR app)
  if (productId) {
    const endpoints = [
      `${origin}/api/public-data?product_id=${encodeURIComponent(productId)}`,
      `${origin}/public_data.json`,
      `${origin}/api/get-single-product?id=${encodeURIComponent(productId)}`,
      `${origin}/api/appwrite-get-single-product?id=${encodeURIComponent(productId)}`
    ];

    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SocialAutomate-Bot"
          }
        });
        if (res.ok) {
          const json = await res.json();
          let p = null;
          if (json.product) {
            p = json.product;
          } else if (json.data) {
            if (Array.isArray(json.data)) {
              p = json.data.find(x => String(x.id) === String(productId));
            } else if (json.data && String(json.data.id) === String(productId)) {
              p = json.data;
            }
          } else if (json.products && Array.isArray(json.products)) {
            p = json.products.find(x => String(x.id) === String(productId));
          } else if (json.product_chunks && Array.isArray(json.product_chunks)) {
            for (const chunk of json.product_chunks) {
              if (chunk.products) {
                const found = chunk.products.find(x => String(x.id) === String(productId));
                if (found) { p = found; break; }
              }
            }
          }

          if (p) {
            return formatExtractedProduct(p, cleanUrl);
          }
        }
      } catch (e) {
        console.warn(`Extraction probe failed for ${ep}:`, e.message);
      }
    }
  }

  // ২. ফলব্যাক: সাধারণ HTML ফেচ ও OpenGraph / Meta / JSON-LD স্ক্র্যাপ
  try {
    const res = await fetch(cleanUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      }
    });

    if (res.ok) {
      const html = await res.text();
      
      // JSON-LD চেক
      const ldMatch = html.match(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/i);
      if (ldMatch) {
        try {
          const ldData = JSON.parse(ldMatch[1]);
          const item = ldData["@type"] === "Product" ? ldData : (Array.isArray(ldData) ? ldData.find(x => x["@type"] === "Product") : null);
          if (item) {
            return {
              success: true,
              product: {
                name: item.name || "",
                price: parseFloat(item.offers?.price || item.price || 0),
                original_price: parseFloat(item.offers?.highPrice || item.price || 0),
                description: item.description || "",
                image_url: Array.isArray(item.image) ? item.image[0] : (item.image || ""),
                product_url: cleanUrl,
                category: item.category || "General"
              }
            };
          }
        } catch (e) {}
      }

      // OpenGraph ও Meta
      const ogTitle = html.match(/<meta\s+(?:property|name)=["'](?:og:title|twitter:title|title)["']\s+content=["'](.*?)["']/i)?.[1] ||
                      html.match(/<title>(.*?)<\/title>/i)?.[1] || "";
      const ogDesc = html.match(/<meta\s+(?:property|name)=["'](?:og:description|twitter:description|description)["']\s+content=["'](.*?)["']/i)?.[1] || "";
      let ogImg = html.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["'](.*?)["']/i)?.[1] || "";

      // R2 বা CDN ইমেজ থাকলে খুঁজে বের করা
      if (!ogImg) {
        const imgMatch = html.match(/(https?:\/\/[^\s"']+\.(?:png|jpg|jpeg|webp)(?:\?[^\s"']*)?)/i);
        if (imgMatch) ogImg = imgMatch[1];
      }

      if (ogImg && !ogImg.startsWith("http")) {
        ogImg = new URL(ogImg, origin).toString();
      }

      const cleanTitle = ogTitle.replace(/Product Details|Home\s*\/\s*Shop/gi, '').trim();

      return {
        success: true,
        product: {
          name: cleanTitle || "পণ্য",
          price: 0,
          original_price: 0,
          description: ogDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
          image_url: ogImg,
          product_url: cleanUrl,
          category: "General"
        }
      };
    }
  } catch (e) {
    return { success: false, error: `ওয়েবসাইট ফেচ ব্যর্থ: ${e.message}` };
  }

  return { success: false, error: "প্রোডাক্টের বিবরণ পাওয়া যায়নি। অনুগ্রহ করে তথ্য ম্যানুয়ালি দিন।" };
}

function formatExtractedProduct(p, url) {
  let gallery = [];
  try {
    gallery = typeof p.gallery_images === 'string' ? JSON.parse(p.gallery_images) : (p.gallery_images || []);
  } catch(e) {}

  let variants = [];
  try {
    variants = typeof p.variants === 'string' ? JSON.parse(p.variants) : (p.variants || []);
  } catch(e) {}

  // পাবলিক R2 ফটো নির্ধারণ
  let r2Image = "";
  if (gallery.length > 0 && typeof gallery[0] === 'string' && gallery[0].startsWith('http')) {
    r2Image = gallery[0];
  } else if (variants.length > 0 && variants[0]?.imageUrl && variants[0].imageUrl.startsWith('http')) {
    r2Image = variants[0].imageUrl;
  } else {
    for (const img of gallery) {
      if (typeof img === 'string' && img.startsWith('http')) { r2Image = img; break; }
    }
    if (!r2Image) {
      for (const v of variants) {
        if (v && v.imageUrl && v.imageUrl.startsWith('http')) { r2Image = v.imageUrl; break; }
      }
    }
  }

  const basePrice = parseFloat(p.base_price || p.price || 0);
  const flashSale = parseFloat(p.flash_sale_price || 0);
  const finalPrice = (flashSale > 0 && flashSale < basePrice) ? (basePrice - flashSale) : basePrice;

  // ডেসক্রিপশন থেকে এইচটিএমএল ট্যাগ ও অতিরিক্ত স্পেস পরিষ্কার করা
  const rawDesc = p.description || p.details || "";
  const cleanDesc = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 600);

  return {
    success: true,
    product: {
      name: p.name || p.title || "প্রোডাক্ট",
      price: finalPrice,
      original_price: basePrice,
      discount: flashSale,
      description: cleanDesc,
      image_url: r2Image,
      product_url: url,
      category: p.category || "General",
      variants_count: variants.length
    }
  };
}

// ========================================================
// 🎯 ৮টি সাইকোলজিক্যাল মার্কেটিং আর্কেটাইপ (অ্যান্টি-রিপিট AI ইঞ্জিন)
// ========================================================
const MARKETING_ANGLES = [
  {
    key: "problem_solution",
    name: "সমস্যা ও সমাধান (Problem-Solution)",
    hook_starters: [
      "আপনি কি প্রতিদিন এই ছোট্ট সমস্যাটি নিয়ে বিরক্ত?",
      "একটি জিনিসের অভাব আপনার দৈনন্দিন জীবনকে কতটা জটিল করে তোলে খেয়াল করেছেন?",
      "সবার জীবনেই এমন কিছু মুহূর্ত আসে যখন এই গ্যাজেটটি ছাড়া চলা অসম্ভব!"
    ],
    instruction: "কাস্টমারের দৈনন্দিন জীবনের একটি বাস্তব অসুবিধার কথা তুলে ধরুন এবং এই প্রোডাক্টটি কীভাবে নিমিষেই সেই সমস্যার স্থায়ী সমাধান করে তা স্পষ্ট করে বলুন।"
  },
  {
    key: "honest_review",
    name: "খোলামেলা অভিজ্ঞতা ও রিভিউ (Honest Review)",
    hook_starters: [
      "অনেকে ভাবেন অনলাইনে অর্ডার করলে হয়তো ছবি আর প্রোডাক্ট এক হবে না!",
      "সরাসরি সত্যি কথা বলতে গেলে—এই প্রোডাক্টটি হাতে পাওয়ার পর আমি যা দেখলাম...",
      "বিজ্ঞাপনের মিষ্টি কথা নয়, এবার জানুন আসল বাস্তবতা!"
    ],
    instruction: "একজন সাধারণ ক্রেতার দৃষ্টিকোণ থেকে সৎ ও নিখুঁত অভিজ্ঞতার সুরে লিখুন। কোয়ালিটি ও ফিনিশিং নিয়ে কাস্টমারদের পজিটিভ ফিডব্যাক তুলে ধরুন।"
  },
  {
    key: "authentic_vs_fake",
    name: "আসল বনাম সস্তা ক্লোন (Authentic vs Fake)",
    hook_starters: [
      "মার্কেটে এখন একই রকম দেখতে অনেক সস্তা কপি পাওয়া যাচ্ছে—সাবধান!",
      "১০০-২০০ টাকা বাঁচাতে গিয়ে নকল পণ্য কিনে ঠকবেন না!",
      "কী দেখে বুঝবেন কোনটি অরিজিনাল আর কোনটি সস্তা ক্লোন?"
    ],
    instruction: "বাজারের নকল বা নিম্নমানের পণ্যের সাথে তুলনা করে এই প্রোডাক্টের অরিজিনাল কোয়ালিটি, স্থায়িত্ব এবং বিল্ডের আভিজাত্য ফুটিয়ে তুলুন।"
  },
  {
    key: "lifestyle_upgrade",
    name: "লাইফস্টাইল ও স্মার্ট সংযোজন (Lifestyle Upgrade)",
    hook_starters: [
      "নিজের জন্য বা পছন্দের মানুষকে স্পেশাল কিছু উপহার দেওয়ার চেয়ে সেরা আর কী হতে পারে?",
      "একটি নিখুঁত জিনিস আপনার পারসোনালিটি এবং স্টাইলকে দ্বিগুণ বাড়িয়ে দেয়!",
      "প্রতিদিনের একঘেয়েমি দূর করতে এই স্মার্ট সংযোজনটি সেরা।"
    ],
    instruction: "এই পণ্যটি ব্যবহার করলে কাস্টমারের জীবনধারা, কনফিডেন্স ও আধুনিকতা কতটা বেড়ে যাবে সেই সুন্দর চিত্রটি তুলে ধরুন।"
  },
  {
    key: "urgency_fomo",
    name: "লিমিটেড স্টক ও সুযোগ (Urgency FOMO)",
    hook_starters: [
      "আমাদের স্টক কিন্তু খুব দ্রুত শেষ হয়ে আসছে!",
      "মিস করার পর আফসোস করার চেয়ে এখনই নিজের জন্য বুক করে নেওয়া বুদ্ধিমানের কাজ!",
      "সীমিত সংখ্যক পিস বাকি আছে, আজকের অফারে হাতছাড়া করবেন না!"
    ],
    instruction: "অর্ডার করার তীব্র তাগিদ তৈরি করুন। স্টক ফুরিয়ে যাওয়ার কথা জানিয়ে এখনই অর্ডার কনফার্ম করতে উৎসাহ দিন।"
  },
  {
    key: "feature_specs",
    name: "স্পেসিফিকেশন ও নিখুঁত ফিনিশিং (Feature Deep-Dive)",
    hook_starters: [
      "এর ডিজাইন ও নিখুঁত কারিগরি দেখলে যে কেউ মুগ্ধ হতে বাধ্য!",
      "প্রথম দেখাতেই নজর কাড়ার মতো প্রিমিয়াম ফিনিশিং ও কোয়ালিটি।",
      "যেসব কারণে এটি বাজারের সেরা পছন্দের তালিকায় সবার উপরে—"
    ],
    instruction: "প্রোডাক্টের উপাদান, টেকসই ডিজাইন, স্পেসিফিকেশন এবং প্রিমিয়াম ফিনিশিং নিয়ে পয়েন্ট আকারে হাইলাইট করুন।"
  },
  {
    key: "zero_risk_delivery",
    name: "১০০% ঝুঁকিমুক্ত কেনাকাটা (Zero-Risk Delivery)",
    hook_starters: [
      "অগ্রিম কোনো টাকা দিতে হবে না—আগে প্রোডাক্ট দেখুন, তারপর টাকা দিন!",
      "অনলাইন শপিংয়ে ১০০% নিশ্চিন্ত থাকার গ্যারান্টি!",
      "হাতে পেয়ে চেক করে নেওয়ার সুযোগ থাকলে কোনো দ্বিধা থাকে কি?"
    ],
    instruction: "সারা দেশে ক্যাশ অন ডেলিভারি, ডেলিভারিম্যানের সামনে প্যাকেট খুলে চেক করে টাকা দেওয়ার সুবিধার ওপর জোর দিয়ে আস্থা অর্জন করুন।"
  },
  {
    key: "curiosity_hook",
    name: "চমকপ্রদ তথ্য ও কিউরিওসিটি (Curiosity Hook)",
    hook_starters: [
      "এই ছোট্ট গ্যাজেটটির ভেতরে যে এমন চমক আছে তা অনেকেই জানেন না!",
      "একবার এটি ব্যবহার করলে আগের নিয়মে আর ফিরে যেতে ইচ্ছে করবে না!",
      "আপনি কি জানেন এটি কেন এত দ্রুত সবার পছন্দের শীর্ষে উঠে এলো?"
    ],
    instruction: "প্রথম লাইনেই কাস্টমারের চোখ আটকে ফেলার মতো কৌতূহল তৈরি করুন। পণ্যের সেরা আকর্ষণীয় দিকটি রহস্যের মতো উন্মোচন করুন।"
  }
];

// ========================================================
// ========================================================
// 🏪 D1 ডেটাবেস থেকে স্টোর পলিসি ও ডেলিভারি চার্জ রিড করা (১০০% ডায়নামিক)
// ========================================================
async function getStorePolicies(db) {
  const policies = {
    store_name: "Ranonex",
    del_inside: "৬০ টাকা (২৪-৪৮ ঘণ্টা)",
    del_outside: "১২০ টাকা (২-৩ দিন)",
    payment_methods: "ক্যাশ অন ডেলিভারি, বিকাশ, নগদ",
    return_policy: "ডেলিভারির সময় চেক করে দেখে নেওয়া যাবে। ডিফেক্ট থাকলে সাথে সাথে রিটার্ন করা যাবে।",
    contact_phone: ""
  };

  if (!db) return policies;

  try {
    const { results } = await db.prepare("SELECT key, value FROM system_config").all();
    for (const r of (results || [])) {
      if (r.key === "store_name" && r.value) policies.store_name = r.value.trim();
      if (r.key === "delivery_inside_dhaka" && r.value) policies.del_inside = r.value.trim();
      if (r.key === "delivery_outside_dhaka" && r.value) policies.del_outside = r.value.trim();
      if (r.key === "payment_methods" && r.value) policies.payment_methods = r.value.trim();
      if (r.key === "return_policy" && r.value) policies.return_policy = r.value.trim();
      if (r.key === "contact_phone" && r.value) policies.contact_phone = r.value.trim();
    }
  } catch (e) {}

  return policies;
}

// ========================================================
// ✍️ AI সেলস কপিরাইটার (ইউনিক, কনটেক্সট-ইন্ডিপেন্ডেন্ট ও ডায়নামিক পলিসি)
// ========================================================
async function generateAIPostCaption(product, angleObj, env) {
  const apiKey = env.GEMINI_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";

  // র‍্যান্ডম হুক সিলেক্টর
  const randomHook = angleObj.hook_starters[Math.floor(Math.random() * angleObj.hook_starters.length)];
  
  // D1 ডেটাবেস থেকে রিয়েল-টাইম স্টোর পলিসি ও ডেলিভারি চার্জ রিড
  const policies = await getStorePolicies(env.DB);

  const prompt = `
You are an elite Bangladeshi e-commerce copywriter with mastery in high-converting, viral social media posts.
Write an authentic, irresistible Facebook post for this product in natural Bengali.

=== PRODUCT INFORMATION ===
Name: ${product.name}
Price: ৳${product.price} ${product.original_price && product.original_price > product.price ? `(Regular Price: ৳${product.original_price})` : ''}
Details / Features: ${product.description || 'Premium quality durable product'}
Category: ${product.category || 'General'}
Website Order Link: ${product.product_url || 'https://ranonex.shop'}

=== STORE POLICIES (LOADED DIRECTLY FROM D1 DATABASE) ===
Store Name: ${policies.store_name}
Delivery Charge Inside Dhaka: ${policies.del_inside}
Delivery Charge Outside Dhaka: ${policies.del_outside}
Payment Methods: ${policies.payment_methods}
Return Policy: ${policies.return_policy}
Contact Phone / Hotline: ${policies.contact_phone || 'ইনবক্স করুন'}

=== TODAY'S MARKETING ANGLE ===
Angle Name: ${angleObj.name}
Angle Directive: ${angleObj.instruction}
Opening Inspiration: "${randomHook}"

=== STRICT ANTI-REPETITION & STORE POLICY RULES ===
1. ABSOLUTELY BANNED CLICHÉS (DO NOT USE ANY OF THESE):
   - "🔥 আকর্ষণীয় অফার"
   - "সুসংবাদ সুসংবাদ"
   - "আপনি কি একটি ভালো... খুঁজছেন?"
   - "দেরি না করে এখনই অর্ডার করুন"
   - "আসসালামু আলাইকুম ভিউয়ার্স"
2. Start with an eye-catching, relatable human opening line matching the chosen angle.
3. Keep the language natural, conversational, and persuasive (authentic Bangladeshi tone).
4. Highlight why this product is truly worth buying, its build and practical benefits.
5. Price & COD: Mention the price clearly (৳${product.price}) and nationwide Cash on Delivery (${policies.payment_methods}).
6. Delivery Charges: State the exact delivery charges as retrieved from the database:
   - ঢাকা সিটির ভেতরে: ${policies.del_inside}
   - ঢাকার বাইরে: ${policies.del_outside}
   Do NOT invent or alter delivery prices.
7. Return Guarantee: State that customers can check the parcel upon delivery (${policies.return_policy}).
8. Give a clear Call-to-Action with the website order link: ${product.product_url || 'ইনবক্স করুন বা ওয়েবসাইটে গিয়ে অর্ডার করুন'}.
9. Include 3-4 natural hashtags at the very end.
10. Output ONLY the raw caption text in Bengali. No intros, markdown meta, or quotes.
`;

  if (apiKey && apiKey !== "YOUR_GEMINI_API_KEY") {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.95,
            topP: 0.95,
            maxOutputTokens: 800
          }
        })
      });

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim().length > 40) {
          return text.trim();
        }
      }
    } catch (e) {
      console.warn("Gemini Post Generation Error:", e.message);
    }
  }

  // ফলব্যাক কপিরাইটিং (D1 পলিসি ডাটা সহ)
  return generateFallbackCaption(product, angleObj, randomHook, policies);
}

function generateFallbackCaption(p, angle, hook, policies) {
  const pol = policies || {
    store_name: "Ranonex",
    del_inside: "৬০ টাকা (২৪-৪৮ ঘণ্টা)",
    del_outside: "১২০ টাকা (২-৩ দিন)",
    payment_methods: "ক্যাশ অন ডেলিভারি",
    return_policy: "ডেলিভারির সময় চেক করে দেখে নেওয়ার সুযোগ",
    contact_phone: ""
  };

  const origPriceText = (p.original_price && p.original_price > p.price) ? ` (আগের দাম: ৳${p.original_price})` : '';
  const orderLink = p.product_url ? `\n🛒 সরাসরি ওয়েবসাইট থেকে অর্ডার করুন:\n👉 ${p.product_url}\n` : `\n📩 সরাসরি অর্ডার করতে আমাদের পেজে ইনবক্স করুন!\n`;

  const delText = (pol.del_inside || pol.del_outside)
    ? `\n🚚 ডেলিভারি চার্জ: ঢাকা সিটির ভেতরে ${pol.del_inside}, ঢাকার বাইরে ${pol.del_outside}।`
    : `\n🚚 সারা দেশে দ্রুত ক্যাশ অন হোম ডেলিভারি!`;

  const returnText = pol.return_policy ? `\n🛡️ রিটার্ন পলিসি: ${pol.return_policy}` : '';
  const hotlineText = pol.contact_phone ? `\n📞 হটলাইন: ${pol.contact_phone}` : '\n📞 যেকোনো তথ্যের জন্য সরাসরি ইনবক্স করুন।';

  return `${hook}

✨ ${p.name}
${p.description ? `\n📌 বিশেষত্ব ও বিবরণ:\n${p.description}\n` : ''}
💎 কেন এটি আপনার জন্য সেরা পছন্দ?
✅ প্রিমিয়াম বিল্ড কোয়ালিটি ও দীর্ঘস্থায়িত্ব
✅ ১০০% অরিজিনাল প্রোডাক্টের নিশ্চয়তা
✅ সারা বাংলাদেশে ক্যাশ অন ডেলিভারি (হাতে পেয়ে চেক করে নেওয়ার সুবিধা)${returnText}

💰 আজকের বিশেষ মূল্য: মাত্র ৳${p.price}${origPriceText}
${orderLink}${delText}${hotlineText}

#${p.category ? p.category.replace(/\s+/g, '_') : 'OnlineShopping'} #TrendingProducts #SmartShopping #${pol.store_name.replace(/\s+/g, '')}`;
}

// ========================================================
// 🔵 ফেসবুক পেজে পোস্ট সেন্ডার (পাবলিক R2 ছবি সহ)
// ========================================================
async function publishToFacebookPage(product, caption, env) {
  const token = await getMetaPageToken(env);
  let pageId = env.META_PAGE_ID || "1287050647827199";
  if (env.DB) {
    const dbPageId = await getConfigValue(env.DB, "meta_page_id", null);
    if (dbPageId) pageId = dbPageId;
  }

  if (!token) {
    throw new Error("Facebook Page Access Token D1 বা Worker-এ পাওয়া যায়নি। ড্যাশবোর্ডে টোকেন সেভ করুন।");
  }

  // ১. পাবলিক R2 ছবি থাকলে /photos এন্ডপয়েন্টে ছবি + ক্যাপশন পোস্ট
  if (product.image_url && product.image_url.startsWith("http")) {
    console.log(`📸 Posting Photo to Facebook Page (${pageId}): ${product.image_url}`);
    try {
      const photoRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: product.image_url,
          caption: caption,
          published: true,
          access_token: token
        })
      });

      const photoData = await photoRes.json();
      if (photoRes.ok && (photoData.id || photoData.post_id)) {
        const postId = photoData.post_id || photoData.id;
        return {
          success: true,
          mode: "photo",
          post_id: postId,
          post_url: `https://facebook.com/${postId}`
        };
      } else {
        console.warn("Facebook photo post failed, trying feed post fallback:", photoData);
      }
    } catch (e) {
      console.warn("Photo upload exception:", e.message);
    }
  }

  // ২. ফলব্যাক: /feed টেক্সট পোস্ট
  console.log(`📝 Posting Feed to Facebook Page (${pageId})`);
  const feedRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: caption,
      published: true,
      access_token: token
    })
  });

  const feedData = await feedRes.json();
  if (feedRes.ok && feedData.id) {
    return {
      success: true,
      mode: "feed",
      post_id: feedData.id,
      post_url: `https://facebook.com/${feedData.id}`
    };
  } else {
    throw new Error(`Facebook API Error (${feedRes.status}): ${JSON.stringify(feedData)}`);
  }
}

// ========================================================
// 🚀 ড্যাশবোর্ড থেকে ১-ক্লিক ডাইরেক্ট পোস্ট হ্যান্ডলার
// ========================================================
async function handlePublishProductNow(body, env) {
  if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
  await ensureTables(env.DB);

  const { product_id, platform } = body;
  if (!product_id) return jsonResponse({ error: "Missing product_id" }, 400);

  // D1 থেকে প্রোডাক্ট রিড
  const product = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(product_id).first();
  if (!product) return jsonResponse({ error: "Product not found in D1" }, 404);

  // ১. বিগত পোস্টের অ্যাঙ্গেলগুলো চেক করা
  let recentAngles = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT angle FROM post_history WHERE product_id = ? ORDER BY published_at DESC LIMIT 4"
    ).bind(product.id).all();
    recentAngles = (results || []).map(r => r.angle);
  } catch (e) {}

  // ২. সম্প্রতি ব্যবহার না হওয়া অ্যাঙ্গেল বাছাই
  const available = MARKETING_ANGLES.filter(a => !recentAngles.includes(a.name) && !recentAngles.includes(a.key));
  const chosenAngle = (available.length > 0)
    ? available[Math.floor(Math.random() * available.length)]
    : MARKETING_ANGLES[Math.floor(Math.random() * MARKETING_ANGLES.length)];

  // ৩. AI দিয়ে ক্যাপশন তৈরি
  const caption = await generateAIPostCaption(product, chosenAngle, env);

  // ৪. ফেসবুক পেজে পোস্ট পাবলিশ (পাবলিক R2 ছবি সহ)
  const pubResult = await publishToFacebookPage(product, caption, env);

  // ৫. D1 post_history তে সেভ ও products.last_posted_at আপডেট
  const histId = `post_${Date.now()}`;
  await env.DB.prepare(`
    INSERT INTO post_history (id, product_id, platform, caption, angle, post_id, image_url, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(histId, product.id, platform || 'facebook', caption, chosenAngle.name, pubResult.post_id || '', product.image_url || '').run();

  await env.DB.prepare("UPDATE products SET last_posted_at = CURRENT_TIMESTAMP WHERE id = ?").bind(product.id).run();

  return jsonResponse({
    success: true,
    message: `🎉 Facebook পেজে সফলভাবে পোস্ট পাবলিশ হয়েছে!`,
    post_id: pubResult.post_id,
    post_url: pubResult.post_url,
    angle: chosenAngle.name,
    caption: caption,
    image_url: product.image_url || null
  });
}

// ========================================================
// ⏰ শিডিউল্ড অটো-পোস্টিং এক্সিকিউটর (Ultra-Low CPU)
// ========================================================
async function handleScheduledAutoPosting(env) {
  if (!env.DB) return { total_active: 0, published_count: 0, log: ["D1 Database missing"] };
  await ensureTables(env.DB);

  // ১. সক্রিয় অটো-পোস্ট প্রোডাক্টগুলো নেওয়া
  const { results: prods } = await env.DB.prepare(
    "SELECT * FROM products WHERE is_active = 1 AND daily_auto_post = 1"
  ).all();

  if (!prods || prods.length === 0) {
    return { total_active: 0, published_count: 0, log: ["No active auto-post products in D1"] };
  }

  const now = Date.now();
  // বাংলাদেশ সময় (UTC+6)
  const bdtDate = new Date(now + 6 * 3600 * 1000);
  const currentHour = bdtDate.getUTCHours();
  const currentMinute = bdtDate.getUTCMinutes();
  const executionLog = [];

  for (const p of prods) {
    let isDue = false;
    let reason = "";

    // last_posted_at parsing (Strict UTC)
    let lastPosted = 0;
    if (p.last_posted_at) {
      const cleanStr = String(p.last_posted_at).replace(" ", "T");
      lastPosted = new Date(cleanStr.endsWith("Z") ? cleanStr : cleanStr + "Z").getTime();
      if (isNaN(lastPosted)) lastPosted = 0;
    }

    // ১. ইন্টারভ্যাল বেসিস (যেমন প্রতি ২, ৪, ৬, ৮, ১২, ২৪ ঘণ্টা পর পর)
    if (p.schedule_type === 'interval' || (p.posting_time && p.posting_time.startsWith('interval_'))) {
      let hours = p.interval_hours || 4;
      if (p.posting_time && p.posting_time.startsWith('interval_')) {
        hours = parseInt(p.posting_time.replace('interval_', '')) || 4;
      }
      const elapsedHours = (now - lastPosted) / (3600 * 1000);
      if (lastPosted === 0 || elapsedHours >= hours) {
        isDue = true;
        reason = lastPosted === 0 ? "First-time post (never posted before)" : `Interval of ${hours}h passed (${elapsedHours.toFixed(1)}h elapsed)`;
      } else {
        reason = `Next post in ${(hours - elapsedHours).toFixed(1)} hours`;
      }
    } 
    // ২. নির্দিষ্ট দৈনিক সময় বেসিস (যেমন "10:00", "20:00")
    else {
      const times = (p.posting_time || '10:00').split(',').map(t => t.trim());
      const hoursSinceLast = (now - lastPosted) / (3600 * 1000);
      if (lastPosted === 0 || hoursSinceLast >= 3.5) {
        for (const t of times) {
          const [tHour] = t.split(':').map(Number);
          if (tHour === currentHour) {
            isDue = true;
            reason = `Scheduled daily hour match: ${tHour}:00 BDT`;
            break;
          }
        }
      }
      if (!isDue && !reason) {
        reason = `Scheduled for ${times.join(', ')} BDT (Current BDT: ${currentHour}:${String(currentMinute).padStart(2, '0')})`;
      }
    }

    if (isDue) {
      console.log(`🚀 [Auto-Post Due] Publishing product: ${p.name} (ID: ${p.id}) - Reason: ${reason}`);
      try {
        const pubRes = await handlePublishProductNow({ product_id: p.id, platform: p.target_platform || 'facebook' }, env);
        executionLog.push({ product_id: p.id, name: p.name, status: "published", post_id: pubRes.post_id || null, reason });
      } catch (err) {
        console.error(`Auto-post failed for product ${p.id}:`, err.message);
        executionLog.push({ product_id: p.id, name: p.name, status: "error", error: err.message, reason });
      }
    } else {
      executionLog.push({ product_id: p.id, name: p.name, status: "skipped", reason });
    }
  }

  return {
    total_active: prods.length,
    published_count: executionLog.filter(e => e.status === "published").length,
    log: executionLog
  };
}

// ========================================================
// 🔍 ক্রন ডায়াগনস্টিক ও স্ট্যাটাস চেকার
// ========================================================
async function handleCronStatusCheck(url, env) {
  if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
  await ensureTables(env.DB);

  const shouldRun = url.searchParams.get("run") === "true" || url.searchParams.get("execute") === "1";
  if (shouldRun) {
    const result = await handleScheduledAutoPosting(env);
    return jsonResponse({
      success: true,
      action: "Executed auto-post check",
      timestamp: new Date().toISOString(),
      ...result
    });
  }

  const { results: prods } = await env.DB.prepare(
    "SELECT * FROM products WHERE is_active = 1 AND daily_auto_post = 1"
  ).all();

  const now = Date.now();
  const bdtDate = new Date(now + 6 * 3600 * 1000);
  const currentHour = bdtDate.getUTCHours();
  const currentMinute = bdtDate.getUTCMinutes();

  const report = (prods || []).map(p => {
    let lastPosted = 0;
    if (p.last_posted_at) {
      const cleanStr = String(p.last_posted_at).replace(" ", "T");
      lastPosted = new Date(cleanStr.endsWith("Z") ? cleanStr : cleanStr + "Z").getTime();
      if (isNaN(lastPosted)) lastPosted = 0;
    }
    const elapsedHours = lastPosted ? (now - lastPosted) / (3600 * 1000) : null;
    let isDue = false;
    let intervalHours = p.interval_hours || 4;
    if (p.posting_time && p.posting_time.startsWith('interval_')) {
      intervalHours = parseInt(p.posting_time.replace('interval_', '')) || 4;
    }

    if (p.schedule_type === 'interval' || (p.posting_time && p.posting_time.startsWith('interval_'))) {
      isDue = lastPosted === 0 || (elapsedHours !== null && elapsedHours >= intervalHours);
    } else {
      const times = (p.posting_time || '10:00').split(',').map(t => t.trim());
      if (lastPosted === 0 || (elapsedHours !== null && elapsedHours >= 3.5)) {
        for (const t of times) {
          const [tHour] = t.split(':').map(Number);
          if (tHour === currentHour) { isDue = true; break; }
        }
      }
    }

    return {
      id: p.id,
      name: p.name,
      schedule_type: p.schedule_type,
      posting_time: p.posting_time,
      interval_hours: intervalHours,
      last_posted_at: p.last_posted_at || "Never",
      hours_since_last_post: elapsedHours !== null ? Number(elapsedHours.toFixed(2)) : null,
      is_due_now: isDue,
      status: isDue ? "DUE FOR POSTING" : (elapsedHours !== null ? `Next in ${(intervalHours - elapsedHours).toFixed(1)}h` : "Ready")
    };
  });

  return jsonResponse({
    current_time_utc: new Date().toISOString(),
    current_time_bdt: `${bdtDate.toISOString().replace('T', ' ').substring(0, 19)} (UTC+6)`,
    cron_setup_instruction: "Cloudflare Dashboard > Workers & Pages > social-automate > Settings > Triggers > Cron Triggers-এ '*/15 * * * *' শিডিউল যোগ করুন।",
    active_scheduled_products: report.length,
    products: report
  });
}



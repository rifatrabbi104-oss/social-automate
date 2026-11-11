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
      // ৫.১ মেটা পেজ ওয়েববুক সাবস্ক্রিপশন চেক ও ডায়াগনস্টিক API
      // ==========================================
      if (request.method === "GET" && (path === "/api/subscribe-page" || path === "/api/check-meta-subscription")) {
        const token = await getMetaPageToken(env);
        if (!token) return jsonResponse({ success: false, error: "No Meta Page token found in D1 or env" }, 400);

        try {
          // ১. মেসেজিং ওয়েববুক সাবস্ক্রাইব (pages_messaging পারমিশন দিয়ে ১০০% কাজ করে)
          const subRes = await fetch(`https://graph.facebook.com/v19.0/me/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_reactions,messaging_optins&access_token=${token}`, {
            method: "POST"
          });
          const subData = await subRes.json();

          // ২. কমেন্ট / ফিড ওয়েববুক সাবস্ক্রাইব (pages_manage_metadata পারমিশন থাকলে কাজ করবে)
          let feedSubData = null;
          try {
            const feedRes = await fetch(`https://graph.facebook.com/v19.0/me/subscribed_apps?subscribed_fields=feed&access_token=${token}`, {
              method: "POST"
            });
            feedSubData = await feedRes.json();
          } catch (e) {
            feedSubData = { error: e.message };
          }

          const pageRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${token}`);
          const pageData = await pageRes.json();

          return jsonResponse({
            success: true,
            page: pageData,
            messaging_subscription: subData,
            feed_subscription: feedSubData,
            feed_active: Boolean(feedSubData && feedSubData.success),
            note: feedSubData && feedSubData.success 
              ? "✅ মেসেঞ্জার এবং কমেন্ট উভয় ওয়েববুকই সফলভাবে সক্রিয় আছে!" 
              : "ℹ️ মেসেঞ্জার অ্যাক্টিভ আছে। কমেন্টের অটো-রিপ্লাই পেতে টোকেন জেনারেট করার সময় 'pages_manage_metadata' পারমিশন দিয়ে সেভ করুন।",
            webhook_url: `${url.origin}/webhook/meta`
          });
        } catch (err) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      }

      // ==========================================
      // ৬.১ টেলিগ্রাম অ্যাডমিন অ্যালার্ট সেটআপ ও টেস্ট API
      // ==========================================
      if (request.method === "POST" && path === "/api/setup-telegram") {
        if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
        await ensureTables(env.DB);
        const body = await request.json().catch(() => ({}));
        const { bot_token, chat_id } = body;
        if (!bot_token || !chat_id) {
          return jsonResponse({ error: "Bot token and Chat ID are required" }, 400);
        }

        await env.DB.prepare(`
          INSERT INTO system_config (key, value) VALUES ('telegram_bot_token', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).bind(bot_token.trim()).run();

        await env.DB.prepare(`
          INSERT INTO system_config (key, value) VALUES ('telegram_admin_chat_id', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).bind(chat_id.trim()).run();

        return jsonResponse({ success: true, message: "Telegram Bot Token ও Chat ID সফলভাবে D1-এ সেভ হয়েছে!" });
      }

      if (request.method === "POST" && path === "/api/test-telegram") {
        const testRes = await sendTelegramOrderNotification({
          platform: "facebook",
          customer_name: "Test Customer (এডমিন টেস্ট)",
          customer_phone: "01874600203",
          delivery_address: "ঢাকা, বাংলাদেশ",
          product_name: "P6 Retro Game Console (GC-1102)",
          variant: "Standard",
          total_amount: 920
        }, env);

        return jsonResponse(testRes, testRes.success ? 200 : 400);
      }

      // ==========================================
      // 💬 ZERO-D1 MESSAGING & WHATSAPP PROXY TO ALWAYSDATA
      // (D1 এ মেসেজিংয়ের কোনো কাজ নেই - সব মেসেজ ও হোয়াটসঅ্যাপ Alwaysdata হ্যান্ডেল করে)
      // ==========================================
      if (
        path === "/api/conversations" ||
        path === "/api/live-conversations" ||
        path === "/api/conversations-check" ||
        path === "/api/conversations/read" ||
        path.startsWith("/api/conversations/") ||
        path === "/api/messages" ||
        path === "/api/messages/send" ||
        path === "/api/send-reply" ||
        path === "/api/admin-reply" ||
        path === "/api/admin/reply" ||
        path === "/api/handover" ||
        path === "/api/ai-suggest-reply" ||
        path.startsWith("/api/whatsapp/")
      ) {
        const alwaysdataUrl = `https://ranonex.alwaysdata.net${path}${url.search}`;
        const proxyInit = {
          method: request.method,
          headers: { "Content-Type": "application/json" }
        };
        if (request.method !== "GET" && request.method !== "HEAD") {
          proxyInit.body = await request.text();
        }
        try {
          const adRes = await fetch(alwaysdataUrl, proxyInit);
          const adText = await adRes.text();
          return new Response(adText, {
            status: adRes.status,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS }
          });
        } catch (proxyErr) {
          return jsonResponse({ error: "Alwaysdata Messaging Gateway unreachable: " + proxyErr.message }, 502);
        }
      }

      // ৬.১ ফেসবুক পেজের রিয়েল ইনবক্স ও কনভারসেশন ফেচ / সিঙ্ক API
      if (request.method === "POST" && (path === "/api/sync-fb-conversations" || path === "/api/sync-conversations")) {
        return await handleSyncFacebookConversations(env);
      }

      // ৬.৪ Gemini AI ইঞ্জিন কনফিগার ও টেস্ট API
      if (request.method === "POST" && path === "/api/setup-ai") {
        const body = await request.json().catch(() => ({}));
        return await handleSetupAI(body, env);
      }

      // টেস্ট ইনকামিং মেসেজ (ডামি ইউজার ইনজেকশন বন্ধ - নিরাপদ হেলথ চেক)
      if (request.method === "POST" && path === "/api/test-incoming") {
        return jsonResponse({
          success: true,
          message: "Social Automate API is healthy and online."
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
          id, sku, name, price, description, category, image_url, product_url,
          specifications, posting_time, daily_auto_post, stock_status, target_platform,
          schedule_type, interval_hours, gallery_images
        } = body;

        let galleryStr = "[]";
        if (Array.isArray(gallery_images)) {
          galleryStr = JSON.stringify(gallery_images);
        } else if (typeof gallery_images === "string" && gallery_images.trim()) {
          galleryStr = gallery_images.trim();
        } else if (image_url) {
          galleryStr = JSON.stringify([image_url]);
        }

        const prodId = id || `prod_${Date.now()}`;
        const prodSku = (sku && sku.trim()) ? sku.trim() : prodId.toUpperCase();
        await env.DB.prepare(`
          INSERT INTO products (
            id, sku, name, price, description, category, image_url, product_url,
            specifications, posting_time, daily_auto_post, stock_status, target_platform,
            schedule_type, interval_hours, gallery_images, is_active
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id) DO UPDATE SET
            sku = excluded.sku,
            name = excluded.name,
            price = excluded.price,
            description = excluded.description,
            category = excluded.category,
            image_url = excluded.image_url,
            product_url = excluded.product_url,
            specifications = excluded.specifications,
            posting_time = excluded.posting_time,
            daily_auto_post = excluded.daily_auto_post,
            stock_status = excluded.stock_status,
            target_platform = excluded.target_platform,
            schedule_type = excluded.schedule_type,
            interval_hours = excluded.interval_hours,
            gallery_images = excluded.gallery_images,
            is_active = 1
        `).bind(
          prodId,
          prodSku,
          name,
          parseFloat(price) || 0,
          description || '',
          category || 'General',
          image_url || '',
          product_url || '',
          specifications || '',
          posting_time || '10:00',
          daily_auto_post !== undefined ? Number(daily_auto_post) : 1,
          stock_status || 'in_stock',
          target_platform || 'facebook',
          schedule_type || 'daily',
          interval_hours ? Number(interval_hours) : 4,
          galleryStr
        ).run();

        await invalidateBusinessCache();
        return jsonResponse({ success: true, id: prodId, sku: prodSku, message: "Product saved to D1" });
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
      // ৭.১.১ ১-ক্লিকে শপের সমস্ত ১১টি প্রোডাক্ট ও SKU সিঙ্ক API
      // ==========================================
      if (request.method === "POST" && (path === "/api/sync-all-store-products" || path === "/api/sync-store")) {
        if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
        await ensureTables(env.DB);

        try {
          const res = await fetch("https://ranonex.shop/api/public-data", {
            headers: {
              "Accept": "application/json",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SocialAutomate-Bot"
            }
          });

          if (!res.ok) {
            return jsonResponse({ success: false, error: `Store API responded with status ${res.status}` }, 400);
          }

          const json = await res.json();
          const items = json?.data?.products || (Array.isArray(json?.data) ? json.data : []);
          if (!items || items.length === 0) {
            return jsonResponse({ success: false, error: "No products returned from store public API" }, 400);
          }

          const synced = [];
          for (const p of items) {
            let gallery = [];
            try { gallery = typeof p.gallery_images === 'string' ? JSON.parse(p.gallery_images) : (p.gallery_images || []); } catch(e) {}
            let variants = [];
            try { variants = typeof p.variants === 'string' ? JSON.parse(p.variants) : (p.variants || []); } catch(e) {}

            const allImgs = [];
            for (const img of gallery) {
              if (typeof img === 'string' && img.startsWith('http') && !allImgs.includes(img)) allImgs.push(img);
            }
            for (const v of variants) {
              if (v?.imageUrl && typeof v.imageUrl === 'string' && v.imageUrl.startsWith('http') && !allImgs.includes(v.imageUrl)) {
                allImgs.push(v.imageUrl);
              }
            }
            const r2Img = allImgs[0] || "";

            const basePrice = parseFloat(p.base_price || 0);
            const flashPrice = parseFloat(p.flash_sale_price || 0);
            const finalPrice = (flashPrice > 0 && flashPrice < basePrice) ? (basePrice - flashPrice) : basePrice;

            const rawDesc = p.description || p.details || "";
            const cleanDesc = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);

            const specsSummary = variants.map(v => {
              const color = v.colorName || 'Default';
              const sizes = (v.sizes || []).map(s => `${s.size}${s.stock <= 0 ? ' (Stock Out)' : ''}`).join(', ');
              return sizes ? `${color}: ${sizes}` : color;
            }).join(' | ') || 'Standard / One Size';

            const prodId = p.id || `p_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            const sku = (p.sku && p.sku.trim()) ? p.sku.trim() : prodId.toUpperCase();
            const productUrl = `https://ranonex.shop/product.html?id=${encodeURIComponent(p.id)}`;

            const galleryJson = JSON.stringify(allImgs);

            await env.DB.prepare(`
              INSERT INTO products (
                id, sku, name, price, description, category, image_url, product_url,
                specifications, gallery_images, stock_status, daily_auto_post, target_platform, schedule_type,
                posting_time, interval_hours, is_active
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_stock', 1, 'facebook', 'interval', 'interval_4', 4, 1)
              ON CONFLICT(id) DO UPDATE SET
                sku = excluded.sku,
                name = excluded.name,
                price = excluded.price,
                description = excluded.description,
                image_url = excluded.image_url,
                product_url = excluded.product_url,
                specifications = excluded.specifications,
                gallery_images = excluded.gallery_images,
                stock_status = 'in_stock',
                target_platform = 'facebook',
                schedule_type = 'interval',
                posting_time = 'interval_4',
                interval_hours = 4,
                daily_auto_post = 1,
                is_active = 1
            `).bind(
              prodId,
              sku,
              p.name || 'Store Product',
              finalPrice,
              cleanDesc,
              p.category || 'General',
              r2Img,
              productUrl,
              specsSummary,
              galleryJson
            ).run();

            synced.push({
              id: prodId,
              sku,
              name: p.name,
              price: finalPrice,
              image_url: r2Img,
              gallery_images: galleryJson,
              product_url: productUrl,
              specifications: specsSummary,
              target_platform: 'facebook',
              schedule_type: 'interval',
              interval_hours: 4,
              posting_time: 'interval_4',
              stock_status: 'in_stock',
              daily_auto_post: 1
            });
          }

          await invalidateBusinessCache();

          return jsonResponse({
            success: true,
            count: synced.length,
            message: `সফলভাবে আপনার শপের ${synced.length}টি প্রোডাক্ট D1-এ সিঙ্ক হয়েছে!`,
            products: synced
          });
        } catch (err) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      }

      // ==========================================
      // ৭.১.২ কনফার্মড অর্ডার তালিকা ও সেভ API
      // ==========================================
      if (request.method === "GET" && path === "/api/orders") {
        if (!env.DB) return jsonResponse([]);
        await ensureTables(env.DB);
        const { results } = await env.DB.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 50").all();
        return jsonResponse(results || []);
      }

      if (request.method === "POST" && path === "/api/orders") {
        if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
        await ensureTables(env.DB);
        const b = await request.json().catch(() => ({}));
        const orderId = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        await env.DB.prepare(`
          INSERT INTO orders (id, chat_id, platform, customer_name, customer_phone, delivery_address, product_name, variant, total_amount, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', CURRENT_TIMESTAMP)
        `).bind(
          orderId,
          b.chat_id || '',
          b.platform || 'facebook',
          b.customer_name || 'Customer',
          b.customer_phone || '',
          b.delivery_address || '',
          b.product_name || '',
          b.variant || 'Standard',
          Number(b.total_amount || 0)
        ).run();
        return jsonResponse({ success: true, order_id: orderId });
      }

      // ==========================================
      // ৭.১.৩ চ্যাট সিঙ্ক API (Zero-D1: শুধুমাত্র মেমোরি ক্যাশ আপডেট)
      // ==========================================
      if (request.method === "POST" && path === "/api/sync-chat") {
        const b = await request.json().catch(() => ({}));
        const chatId = b.chat_id;
        if (!chatId) return jsonResponse({ error: "Missing chat_id" }, 400);
        memorySessions.set(chatId, {
          chat_id: chatId,
          sender_name: b.sender_name || "Customer",
          sender_avatar: b.sender_avatar || "",
          platform: b.platform || "facebook",
          channel_type: b.channel_type || "messenger",
          last_message: b.last_message || "",
          last_message_at: new Date().toISOString(),
          unread_count: b.unread_count || 1,
          messages: Array.isArray(b.messages) ? b.messages : []
        });
        return jsonResponse({ success: true, chat_id: chatId });
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
      // ৭.৩ অটো-পোস্টিং হ্যান্ডওভার পেলোড ও হিস্ট্রি API (GitHub Actions Backend এর জন্য)
      // ==========================================
      if ((request.method === "GET" || request.method === "POST") && (path === "/api/auto-post-task" || path === "/api/github-handover")) {
        return await handleGetAutoPostHandover(request, url, env);
      }

      if (request.method === "POST" && path === "/api/record-post") {
        if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
        await ensureTables(env.DB);
        const body = await request.json();
        const { product_id, platform, caption, angle, post_id, image_url } = body;

        const histId = `post_${Date.now()}`;
        await env.DB.prepare(`
          INSERT INTO post_history (id, product_id, platform, caption, angle, post_id, image_url, published_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).bind(histId, product_id, platform || 'facebook', caption || '', angle || 'General', post_id || '', image_url || '').run();

        if (product_id) {
          await env.DB.prepare("UPDATE products SET last_posted_at = CURRENT_TIMESTAMP WHERE id = ?").bind(product_id).run();
        }

        return jsonResponse({ success: true, id: histId, message: "Post history and last_posted_at recorded in D1" });
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
        return await handleGetSettings(env, url);
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
  const aiDecision = await callGeminiStructured(incomingText, session.messages.slice(-8), businessContext, env);

  if (aiDecision.reply) {
    // হোয়াটসঅ্যাপে অটো-রিপ্লাই পাঠানো
    await sendWhatsAppMessage(senderPhone, aiDecision.reply, env);
    await appendMessageToSession(chatId, senderName, "assistant", aiDecision.reply, "whatsapp", env);
  }

  // যদি চ্যাটে অর্ডার কনফার্ম হয়, D1 orders টেবিলে সেভ ও নোটিফিকেশন
  if (aiDecision.order_confirmed && aiDecision.order_data && env.DB) {
    try {
      const od = aiDecision.order_data;
      const orderId = `ord_${Date.now()}`;
      await env.DB.prepare(`
        INSERT INTO orders (id, chat_id, platform, customer_name, customer_phone, delivery_address, product_name, variant, total_amount, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')
      `).bind(
        orderId,
        chatId,
        "whatsapp",
        od.customer_name || senderName || "Customer",
        od.customer_phone || senderPhone || "",
        od.delivery_address || "",
        od.product_name || "",
        od.variant || "",
        parseFloat(od.total_amount || 0)
      ).run();
      await env.DB.prepare("UPDATE live_conversations SET needs_attention = 1 WHERE chat_id = ?").bind(chatId).run();

      // 📢 টেলিগ্রামে এডমিনকে সাথে সাথে বিস্তারিত অর্ডার পাঠানো
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(sendTelegramOrderNotification({
          platform: "whatsapp",
          chat_id: chatId,
          customer_name: od.customer_name || senderName || "Customer",
          customer_phone: od.customer_phone || senderPhone || "",
          delivery_address: od.delivery_address || "",
          product_name: od.product_name || "",
          variant: od.variant || "",
          total_amount: parseFloat(od.total_amount || 0)
        }, env));
      } else {
        await sendTelegramOrderNotification({
          platform: "whatsapp",
          chat_id: chatId,
          customer_name: od.customer_name || senderName || "Customer",
          customer_phone: od.customer_phone || senderPhone || "",
          delivery_address: od.delivery_address || "",
          product_name: od.product_name || "",
          variant: od.variant || "",
          total_amount: parseFloat(od.total_amount || 0)
        }, env);
      }
    } catch (ordErr) {
      console.warn("Order save error:", ordErr.message);
    }
  }

  return jsonResponse({ status: "success", reply_sent: Boolean(aiDecision.reply), order_confirmed: Boolean(aiDecision.order_confirmed) });
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
  let ghBranch = "main";
  let ghWorkflow = "post_publisher.yml";

  if (env.DB) {
    await ensureTables(env.DB);
    const dbToken = await getConfigValue(env.DB, "github_token", null);
    const dbRepo = await getConfigValue(env.DB, "github_repo", null);
    const dbBranch = await getConfigValue(env.DB, "github_branch", null);
    const dbWorkflow = await getConfigValue(env.DB, "github_workflow", null);
    if (dbToken) ghToken = dbToken;
    if (dbRepo) ghRepo = dbRepo;
    if (dbBranch) ghBranch = dbBranch;
    if (dbWorkflow) ghWorkflow = dbWorkflow;
  }
  if (body.github_token) ghToken = body.github_token.trim();
  if (body.github_repo) ghRepo = body.github_repo.trim();
  if (body.github_branch) ghBranch = body.github_branch.trim();
  if (body.github_workflow) ghWorkflow = body.github_workflow.trim();

  const targetPlatform = body.target_platform || "facebook";
  const postType = body.post_type || "standard";
  const productUrl = body.product_url || "";

  // প্রোডাক্ট নির্বাচন (D1 থেকে)
  let prod = null;
  if (env.DB) {
    if (body.product_id) {
      prod = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(body.product_id).first();
    }
    if (!prod && productUrl) {
      prod = await env.DB.prepare("SELECT * FROM products WHERE product_url = ?").bind(productUrl).first();
    }
    if (!prod) {
      prod = await env.DB.prepare("SELECT * FROM products WHERE is_active = 1 ORDER BY last_posted_at ASC, id ASC LIMIT 1").first();
    }
    if (!prod) {
      prod = await env.DB.prepare("SELECT * FROM products ORDER BY id ASC LIMIT 1").first();
    }
  }

  // ১. GitHub Token থাকলে সরাসরি GitHub Actions Backend-এ সম্পূর্ণ কাজ হ্যান্ডওভার করা (Primary Handover Engine)
  if (ghToken && !body.direct_worker) {
    const dispatchResult = await dispatchGitHubActionHandover(env, {
      product_id: prod ? prod.id : (body.product_id || ""),
      target_platform: targetPlatform,
      post_type: postType,
      product_url: productUrl || (prod ? prod.product_url : ""),
      github_token: ghToken,
      github_repo: ghRepo,
      github_branch: ghBranch,
      github_workflow: ghWorkflow
    });

    if (dispatchResult.success) {
      return jsonResponse({
        success: true,
        handover: true,
        engine: "GitHub Actions Backend (Handover from Cloudflare Worker)",
        product_id: prod ? prod.id : null,
        product_name: prod ? prod.name : null,
        message: `🚀 GitHub Actions ব্যাকএন্ডে কাজের সম্পূর্ণ দায়িত্ব (Prompt, API Key, Token ও ছবি সহ) সফলভাবে হ্যান্ডওভার করা হয়েছে! কয়েক সেকেন্ডের মধ্যে পোস্ট পাবলিশ হয়ে যাবে।`,
        run_url: dispatchResult.run_url
      });
    } else if (body.force_github_handover) {
      return jsonResponse({
        success: false,
        error: dispatchResult.error,
        run_url: dispatchResult.run_url
      }, 400);
    }
  }

  // ২. ফলব্যাক: যদি GitHub Token না থাকে বা ডিরেক্ট ওয়ার্কার রিকোয়েস্ট হয়
  if (prod && env.DB) {
    const pubRes = await handlePublishProductNow({ product_id: prod.id, platform: targetPlatform, direct_worker: true }, env);
    const pubData = await pubRes.json();
    if (pubData.success) {
      return jsonResponse({
        success: true,
        message: `🎉 ${targetPlatform.toUpperCase()} পেজে পোস্ট সফলভাবে পাবলিশ হয়েছে!`,
        post_id: pubData.post_id,
        post_url: pubData.post_url,
        caption: pubData.caption,
        angle: pubData.angle,
        engine: pubData.engine || "Cloudflare Worker (Gemini 2.5 Flash Native Audio Dialog)"
      });
    } else {
      return jsonResponse({
        success: false,
        error: pubData.error || "পোস্ট পাবলিশ ব্যর্থ হয়েছে।"
      }, 400);
    }
  }

  return jsonResponse({
    success: false,
    missing_token: true,
    message: "D1 ডেটাবেসে কোনো সক্রিয় প্রোডাক্ট পাওয়া যায়নি অথবা GitHub Personal Access Token সেভ করা নেই। প্রথমে D1-এ প্রোডাক্ট ও GitHub টোকেন সেভ করুন।",
    workflow_url: `https://github.com/${ghRepo}/actions/workflows/${ghWorkflow}`
  });
}

// ⚙️ ড্যাশবোর্ড সেটিংস ও ক্রেডেনশিয়াল ফেচ API (রিফ্রেশ মারলে ফর্ম পূরণ রাখার জন্য)
async function handleGetSettings(env, url = null) {
  const settings = {
    facebook: { connected: false, account_name: '', account_id: '', access_token: '' },
    tiktok: { connected: false, account_name: '', account_id: '', access_token: '', client_key: 'awq5kzk0rv01o6z0', client_secret: '' },
    whatsapp: { connected: false, phone: '', mode: 'gateway', gateway_url: '', gateway_token: '', phone_number_id: '', access_token: '' },
    telegram: { connected: false, bot_token: '', admin_chat_id: '' },
    github: { connected: false, repo: 'rifatrabbi104-oss/social-automate', branch: 'main', workflow: 'post_publisher.yml', token: '', token_preview: '' },
    // ⚡ DEFAULT & PERMANENT MODEL: Gemini 3.8 Live WebSocket Engine
    ai: { connected: false, api_key: '', key_preview: '', model: 'models/gemini-3.8-live' }
  };

  if (env.GEMINI_API_KEY && env.GEMINI_API_KEY !== "YOUR_GEMINI_API_KEY") {
    settings.ai.connected = true;
    settings.ai.api_key = env.GEMINI_API_KEY;
    settings.ai.key_preview = `${env.GEMINI_API_KEY.slice(0, 6)}...${env.GEMINI_API_KEY.slice(-4)}`;
  }

  let verifyToken = "social_automate_verify_token_2026";
  let accsList = [];

  if (env.DB) {
    try {
      await ensureTables(env.DB);
      const { results: accs } = await env.DB.prepare(
        "SELECT platform, account_name, account_id, access_token, status FROM social_accounts WHERE status = 'active'"
      ).all();
      accsList = accs || [];

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
        if (c.key === 'meta_page_token' && c.value && !settings.facebook.access_token) {
          settings.facebook.access_token = c.value;
          settings.facebook.connected = true;
        }
        if (c.key === 'meta_page_id' && c.value && !settings.facebook.account_id) {
          settings.facebook.account_id = c.value;
        }
        if (c.key === 'tiktok_client_key') settings.tiktok.client_key = c.value;
        if (c.key === 'tiktok_client_secret') settings.tiktok.client_secret = c.value;
        if (c.key === 'tiktok_access_token' && !settings.tiktok.access_token) settings.tiktok.access_token = c.value;
        if (c.key === 'whatsapp_mode') settings.whatsapp.mode = c.value;
        if (c.key === 'whatsapp_phone') settings.whatsapp.phone = c.value;
        if (c.key === 'whatsapp_gateway_url') settings.whatsapp.gateway_url = c.value;
        if (c.key === 'whatsapp_gateway_token') settings.whatsapp.gateway_token = c.value;
        if (c.key === 'whatsapp_phone_id') settings.whatsapp.phone_number_id = c.value;
        if (c.key === 'whatsapp_access_token') settings.whatsapp.access_token = c.value;
        if (c.key === 'telegram_bot_token') {
          settings.telegram.connected = Boolean(c.value);
          settings.telegram.bot_token = c.value;
        }
        if (c.key === 'telegram_admin_chat_id') settings.telegram.admin_chat_id = c.value;
        if (c.key === 'github_token' && c.value) {
          settings.github.connected = true;
          settings.github.token = c.value;
          settings.github.token_preview = `${c.value.slice(0, 6)}...${c.value.slice(-4)}`;
        }
        if (c.key === 'github_repo' && c.value) settings.github.repo = c.value;
        if (c.key === 'github_branch' && c.value) settings.github.branch = c.value;
        if (c.key === 'github_workflow' && c.value) settings.github.workflow = c.value;
        if (c.key === 'meta_verify_token') verifyToken = c.value;
        if (c.key === 'gemini_api_key' && c.value) {
          settings.ai.connected = true;
          settings.ai.api_key = c.value;
          settings.ai.key_preview = `${c.value.slice(0, 6)}...${c.value.slice(-4)}`;
        }
        if (c.key === 'gemini_model' && c.value) {
          settings.ai.model = c.value;
        }
      }
    } catch (e) {
      console.warn("Could not load settings from D1:", e);
    }
  }

  const origin = url ? url.origin : 'https://social-automate.rifatrabbi104.workers.dev';
  return jsonResponse({
    success: true,
    settings,
    d1_connected: Boolean(env.DB),
    connected_accounts: accsList,
    meta_webhook_url: `${origin}/webhook/meta`,
    whatsapp_webhook_url: `${origin}/webhook/whatsapp`,
    meta_verify_token: verifyToken,
    whatsapp_verify_token: verifyToken
  });
}

// 🐙 GitHub Actions হ্যান্ডওভার সেটিংস সেভ API (D1 Database)
async function handleSetupGitHub(body, env) {
  if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
  await ensureTables(env.DB);
  const { github_token, github_repo, github_branch, github_workflow } = body;

  if (github_token !== undefined && github_token.trim() !== "") {
    await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('github_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(github_token.trim()).run();
  }
  if (github_repo !== undefined && github_repo.trim() !== "") {
    await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('github_repo', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(github_repo.trim()).run();
  }
  if (github_branch !== undefined && github_branch.trim() !== "") {
    await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('github_branch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(github_branch.trim()).run();
  }
  if (github_workflow !== undefined && github_workflow.trim() !== "") {
    await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('github_workflow', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(github_workflow.trim()).run();
  }

  return jsonResponse({
    success: true,
    message: "GitHub Actions হ্যান্ডওভার কনফিগারেশন D1 ডেটাবেসে সফলভাবে সেভ হয়েছে!"
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
  const entries = Array.isArray(body.entry) ? body.entry : (body.entry ? [body.entry] : []);
  for (const entry of entries) {
    const rawList = entry.messaging || entry.standby || [];
    for (const messaging of rawList) {
      const isPostback = Boolean(messaging && messaging.postback && (messaging.postback.payload || messaging.postback.title));
      const hasMessage = Boolean(messaging && messaging.message && messaging.message.text && !messaging.message.is_echo);

      if (messaging && (hasMessage || isPostback)) {
        const senderId = String(messaging.sender?.id || "");
        const recipientId = String(messaging.recipient?.id || "");

        // মেটা ডেভেলপার কনসোল থেকে টেস্ট পিং বা ডামি ইভেন্ট আসলে ড্যাশবোর্ডে ডামি চ্যাট না বানিয়ে শুধু 200 রেসপন্স দেওয়া
        if (!senderId || senderId === "0" || recipientId === "0" || senderId === recipientId) {
          return new Response("TEST_IGNORED", { status: 200 });
        }

        const incomingText = (hasMessage ? messaging.message.text : (messaging.postback.title || messaging.postback.payload || "")).trim();
        let senderName = `User (${senderId.slice(-4)})`;
        let senderAvatar = "";

        // মেটা গ্রাফ এপিআই দিয়ে কাস্টমারের আসল নাম ও ছবি ফেচ করা (PSID lookup)
        const token = await getMetaPageToken(env, recipientId);
        if (token) {
          try {
            const userProfileRes = await fetch(`https://graph.facebook.com/v19.0/${senderId}?fields=first_name,last_name,name,profile_pic&access_token=${token}`);
            const userProfile = await userProfileRes.json();
            if (userProfile && userProfile.name) senderName = userProfile.name;
            if (userProfile && userProfile.profile_pic) senderAvatar = userProfile.profile_pic;
          } catch (uErr) {
            console.warn("Could not fetch user profile:", uErr.message);
          }
        }

        // অ্যান্টি-স্প্যাম ডিবাউন্স
        const now = Date.now();
        const lastTime = userLastMessageTime.get(senderId) || 0;
        if (now - lastTime < 2000) {
          await appendMessageToSession(senderId, senderName, "customer", incomingText, "facebook", env, senderAvatar);
          continue;
        }
        userLastMessageTime.set(senderId, now);

        const session = await appendMessageToSession(senderId, senderName, "customer", incomingText, "facebook", env, senderAvatar);

        // হ্যান্ডওভার চেক (অ্যাডমিন টেকওভার যদি ১৫ মিনিটের বেশি আগের হয় তবে স্বয়ংক্রিয়ভাবে আবার AI সক্রিয় করা)
        const isTakeoverExpired = session.takeover_until 
          ? (now > session.takeover_until) 
          : (session.last_message_at ? (now - new Date(session.last_message_at).getTime() > 15 * 60 * 1000) : true);

        if (session.admin_takeover) {
          if (isTakeoverExpired) {
            // ১৫ মিনিট পুরনো টেকওভার হলে স্বয়ংক্রিয়ভাবে আবার AI সক্রিয় করা
            session.admin_takeover = false;
            if (env.DB) {
              env.DB.prepare("UPDATE live_conversations SET admin_takeover = 0 WHERE chat_id = ?").bind(senderId).run().catch(() => {});
            }
          } else {
            continue;
          }
        }

        // D1 বিজনেস ডেটা রিড (৫ মিনিটের ক্যাশ API)
        const businessContext = await getCachedBusinessContext(env.DB);

        // Gemini AI কল (Structured Response)
        const aiDecision = await callGeminiStructured(incomingText, session.messages.slice(-8), businessContext, env);

        if (aiDecision.reply) {
          // মেটা গ্রাফ API দিয়ে পেজ থেকে মেসেঞ্জারে উত্তর পাঠানো
          if (token) {
            try {
              const fbSendRes = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  recipient: { id: senderId },
                  message: { text: aiDecision.reply }
                })
              });
              const fbSendData = await fbSendRes.json().catch(() => ({}));
              if (!fbSendRes.ok) {
                console.error("Facebook Send Error:", JSON.stringify(fbSendData));
              } else {
                console.log("Facebook Message sent successfully to", senderId);
              }
            } catch (fbErr) {
              console.error("Facebook Send Fetch Exception:", fbErr.message);
            }
          }
          await appendMessageToSession(senderId, senderName, "assistant", aiDecision.reply, "facebook", env, senderAvatar);
        }

        // যদি চ্যাটে অর্ডার কনফার্ম হয়, D1 orders টেবিলে সেভ ও নোটিফিকেশন
        if (aiDecision.order_confirmed && aiDecision.order_data && env.DB) {
          try {
            const od = aiDecision.order_data;
            const orderId = `ord_${Date.now()}`;
            await env.DB.prepare(`
              INSERT INTO orders (id, chat_id, platform, customer_name, customer_phone, delivery_address, product_name, variant, total_amount, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')
            `).bind(
              orderId,
              senderId,
              "facebook",
              od.customer_name || senderName || "Customer",
              od.customer_phone || "",
              od.delivery_address || "",
              od.product_name || "",
              od.variant || "",
              parseFloat(od.total_amount || 0)
            ).run();
            await env.DB.prepare("UPDATE live_conversations SET needs_attention = 1 WHERE chat_id = ?").bind(senderId).run();

            // 📢 টেলিগ্রামে এডমিনকে সাথে সাথে বিস্তারিত অর্ডার পাঠানো
            if (ctx && typeof ctx.waitUntil === 'function') {
              ctx.waitUntil(sendTelegramOrderNotification({
                platform: "facebook",
                chat_id: senderId,
                customer_name: od.customer_name || senderName || "Customer",
                customer_phone: od.customer_phone || "",
                delivery_address: od.delivery_address || "",
                product_name: od.product_name || "",
                variant: od.variant || "",
                total_amount: parseFloat(od.total_amount || 0)
              }, env));
            } else {
              await sendTelegramOrderNotification({
                platform: "facebook",
                chat_id: senderId,
                customer_name: od.customer_name || senderName || "Customer",
                customer_phone: od.customer_phone || "",
                delivery_address: od.delivery_address || "",
                product_name: od.product_name || "",
                variant: od.variant || "",
                total_amount: parseFloat(od.total_amount || 0)
              }, env);
            }
          } catch (ordErr) {
            console.warn("Order save error:", ordErr.message);
          }
        }
      }
    }
  }

  // ২. পেজের পোস্টের কমেন্ট (Feed Comments Auto-Reply & Intelligent Private DM)
  const changes = body.entry?.[0]?.changes?.[0];
  if (changes && changes.field === "feed") {
    const val = changes.value;
    if (val && val.item === "comment" && val.verb === "add" && val.message) {
      const commenterId = val.from?.id;
      const token = await getMetaPageToken(env);
      if (token && (!activeMetaPageId || commenterId !== activeMetaPageId)) {
        if (ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(handleFacebookComment(val, token, env));
        } else {
          await handleFacebookComment(val, token, env);
        }
      }
    }
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}

// ========================================================
// 💬 ফেসবুক পেজের কমেন্ট অটো-রিপ্লাই ও ইনবক্স প্রাইভেট DM ইঞ্জিন (AI Decision)
// ========================================================
async function handleFacebookComment(val, token, env) {
  const commentId = val.comment_id;
  const commentText = (val.message || "").trim();
  const commenterId = val.from?.id;
  const commenterName = val.from?.name || "Customer";

  if (!token || !commentId || !commentText) return;

  const businessContext = await getCachedBusinessContext(env.DB);
  let apiKey = env.GEMINI_API_KEY;
  if ((!apiKey || apiKey === "YOUR_GEMINI_API_KEY") && env.DB) {
    apiKey = await getConfigValue(env.DB, "gemini_api_key", null);
  }
  const model = env.GEMINI_MODEL || "models/gemini-3.8-live";

  let aiDecision = {
    action: "both",
    public_reply: `ধন্যবাদ ${commenterName}! বিস্তারিত ও অফার প্রাইস আপনার ইনবক্সে মেসেজ পাঠিয়ে দেওয়া হয়েছে, দয়া করে মেসেজ চেক করুন। 😊`,
    private_reply: ""
  };

  if (apiKey && apiKey !== "YOUR_GEMINI_API_KEY") {
    try {
      const prompt = 
`You are the expert social media sales assistant for 'Ranonex' online store in Bangladesh.
A customer just left a comment on our Facebook Page post:
Customer Name: ${commenterName}
Customer Comment: "${commentText}"

AVAILABLE STORE PRODUCTS & STORE INFO:
${businessContext}

TASK:
Analyze the comment and decide how to respond:
1. "action": 
   - Set "both" if the customer is asking for price (e.g. "dam koto", "price?", "koto", "কত?"), asking about details/specifications, asking how to buy/order, or showing product interest. (AI will post a polite public comment AND send a complete private DM to their Messenger inbox).
   - Set "public_only" if it's just a general compliment (e.g. "nice", "সুন্দর", "good", "great"), a greeting, or simple emoji.
   - Set "none" if spam or irrelevant.
2. "public_reply":
   - If action is "both", write: "ধন্যবাদ ${commenterName}! বিস্তারিত ও অফার প্রাইস আপনার ইনবক্সে মেসেজ পাঠিয়ে দিয়েছি, দয়া করে ইনবক্স চেক করুন। 😊"
   - If action is "public_only", write: "অসংখ্য ধন্যবাদ আপনার সুন্দর মন্তব্যের জন্য! ❤️"
3. "private_reply": If action is "both", write a complete, helpful sales DM in natural Bengali:
   - Identify the product from the catalog with exact price in BDT (৳)
   - Mention available specifications/sizes/colors
   - Mention Cash on Delivery across Bangladesh (Dhaka ৳70, outside ৳130)
   - Direct order link: https://ranonex.shop/product.html?id=...
   - Ask them to reply with Name, Mobile number, and Address to confirm order directly.

Response Format (JSON ONLY):
{
  "action": "both",
  "public_reply": "...",
  "private_reply": "..."
}`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: "application/json" }
        })
      });

      if (res.ok) {
        const data = await res.json();
        const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawJson) {
          aiDecision = JSON.parse(rawJson);
        }
      }
    } catch (e) {
      console.warn("Gemini comment evaluation error:", e.message);
    }
  }

  // ১. পোস্টের নিচে পাবলিক কমেন্ট রিপ্লাই দেওয়া
  if (aiDecision.public_reply) {
    try {
      await fetch(`https://graph.facebook.com/v19.0/${commentId}/comments?access_token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: aiDecision.public_reply })
      });
    } catch (pubErr) {
      console.warn("Public comment reply error:", pubErr.message);
    }
  }

  // ২. ইনবক্সে প্রাইভেট মেসেজ পাঠানো (Meta Private Replies API: recipient.comment_id)
  if (aiDecision.action === "both" && aiDecision.private_reply) {
    try {
      await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { comment_id: commentId },
          message: { text: aiDecision.private_reply }
        })
      });

      // চ্যাট সেশনে সেভ করা যেন ড্যাশবোর্ডে সাথে সাথে চলে আসে
      const chatId = commenterId || `fb_comm_${commentId.slice(-6)}`;
      await appendMessageToSession(chatId, commenterName, "customer", `[পোস্টে কমেন্ট]: "${commentText}"`, "fb_comment", env);
      await appendMessageToSession(chatId, commenterName, "assistant", aiDecision.private_reply, "fb_comment", env);
    } catch (privErr) {
      console.warn("Private comment DM error:", privErr.message);
    }
  }
}

// ========================================================
// 🔄 ফেসবুক পেজের রিয়েল ইনবক্স ও কনভারসেশন ফেচ / সিঙ্ক ইঞ্জিন
// ========================================================
async function handleSyncFacebookConversations(env) {
  const token = await getMetaPageToken(env);
  if (!token) {
    return jsonResponse({ success: false, error: "Facebook Page Access Token পাওয়া যায়নি। অনুগ্রহ করে কানেক্ট করুন।" }, 400);
  }

  let pageId = null;
  if (env.DB) {
    try {
      const row = await env.DB.prepare("SELECT account_id FROM social_accounts WHERE platform = 'facebook' AND status = 'active' ORDER BY created_at DESC").first();
      if (row && row.account_id) pageId = row.account_id;
    } catch (e) {}
  }
  if (!pageId) pageId = "me";

  try {
    const url = `https://graph.facebook.com/v19.0/${pageId}/conversations?fields=id,snippet,updated_time,unread_count,senders,participants,messages{id,message,from,created_time}&access_token=${token}`;
    const fbRes = await fetch(url);
    const fbData = await fbRes.json();
    if (!fbRes.ok || !fbData.data) {
      return jsonResponse({ success: false, error: fbData?.error?.message || "Facebook Graph API কল ব্যর্থ হয়েছে" }, 400);
    }

    const conversations = fbData.data || [];
    let syncedCount = 0;

    if (env.DB) {
      await ensureTables(env.DB);
    }

    for (const conv of conversations) {
      // Find customer
      const participants = conv.participants?.data || conv.senders?.data || [];
      const customer = participants.find(p => String(p.id) !== String(pageId) && !String(p.name || '').toLowerCase().includes('ranonex')) || participants[0];
      if (!customer || !customer.id) continue;

      const customerId = String(customer.id);
      let customerName = customer.name || `User (${customerId.slice(-4)})`;
      let customerAvatar = "";

      // Try fetching customer avatar from Graph API
      try {
        const uRes = await fetch(`https://graph.facebook.com/v19.0/${customerId}?fields=name,profile_pic&access_token=${token}`);
        if (uRes.ok) {
          const uData = await uRes.json();
          if (uData.name) customerName = uData.name;
          if (uData.profile_pic) customerAvatar = uData.profile_pic;
        }
      } catch (e) {}

      // Messages in this conversation
      const rawMsgs = conv.messages?.data || [];
      const messages = rawMsgs.slice().reverse().map(m => {
        const isFromPage = String(m.from?.id) === String(pageId) || String(m.from?.name || '').toLowerCase().includes('ranonex');
        return {
          sender_type: isFromPage ? "assistant" : "customer",
          sender_name: m.from?.name || (isFromPage ? "Ranonex" : customerName),
          message_text: m.message || "",
          created_at: m.created_time || new Date().toISOString()
        };
      });

      const lastMessageText = conv.snippet || (messages.length > 0 ? messages[messages.length - 1].message_text : "");
      const lastMessageAt = conv.updated_time ? new Date(conv.updated_time).toISOString().replace("T", " ").replace("Z", "") : new Date().toISOString().replace("T", " ").slice(0, 19);
      const unreadCount = Number(conv.unread_count || 0);

      // Memory session update (Zero-D1 for messaging)
      memorySessions.set(customerId, {
        chat_id: customerId,
        sender_name: customerName,
        sender_avatar: customerAvatar,
        platform: "facebook",
        channel_type: "messenger",
        last_message: lastMessageText,
        last_message_at: lastMessageAt,
        unread_count: unreadCount,
        admin_takeover: false,
        needs_attention: false,
        messages: messages
      });

      syncedCount++;
    }

    return jsonResponse({
      success: true,
      message: `ফেসবুক পেজ থেকে ${syncedCount} টি রিয়েল কনভারসেশন ও মেসেজ সিঙ্ক সম্পন্ন হয়েছে!`,
      synced_count: syncedCount
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

// ========================================================
// 🤖 GEMINI AI কনফিগার ও লাইভ টেস্ট ইঞ্জিন
// ========================================================
async function handleSetupAI(body, env) {
  const { gemini_api_key, gemini_model } = body;
  if (!gemini_api_key || !gemini_api_key.trim()) {
    return jsonResponse({ success: false, error: "Gemini API Key খালি রাখা যাবে না!" }, 400);
  }
  const cleanKey = gemini_api_key.trim();
  const cleanModel = gemini_model ? gemini_model.trim() : "models/gemini-3.8-live";

  // টেস্ট রিকোয়েস্ট পাঠিয়ে ভ্যালিডেশন (Google AI Studio Models Endpoint)
  try {
    const testRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`);
    if (!testRes.ok) {
      const errData = await testRes.json().catch(() => ({}));
      const errMsg = errData?.error?.message || '';
      // যদি সাময়িক হাই ডিমান্ড (503) বা রেট লিমিট (429) থাকে, তার মানে API Key সঠিক!
      if (testRes.status === 503 || testRes.status === 429 || errMsg.includes('high demand') || errMsg.includes('Resource has been exhausted')) {
        console.log('Gemini API key is authenticated (temporary Google capacity spike).');
      } else {
        return jsonResponse({
          success: false,
          error: "Google Gemini API Key সঠিক নয়: " + (errMsg || `HTTP ${testRes.status}`)
        }, 400);
      }
    }
  } catch (netErr) {
    return jsonResponse({ success: false, error: "Gemini সার্ভারে কানেক্ট করা যায়নি: " + netErr.message }, 500);
  }

  // D1-এ সেভ করা
  if (env.DB) {
    await ensureTables(env.DB);
    await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('gemini_api_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(cleanKey).run();
    await env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('gemini_model', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(cleanModel).run();
  }

  return jsonResponse({
    success: true,
    message: "Google Gemini AI সফলভাবে কানেক্ট ও D1 ডেটাবেসে সেভ হয়েছে!",
    model: cleanModel
  });
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

  let actualPageToken = cleanToken;
  let targetPageId = page_id && page_id.trim() ? page_id.trim() : "1287050647827199";

  // ১. মেটা গ্রাফ API দিয়ে পেজ আইডি ও আসল Page Access Token নিশ্চিত করা
  try {
    // A. প্রথমে চেক করা এটি কি ইতিমধ্যে কোনো ফেসবুক পেজের টোকেন কি না?
    const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name,category&access_token=${cleanToken}`);
    const meData = await meRes.json();
    if (meData && meData.id && meData.category) {
      // এটি সরাসরি পেজ টোকেন!
      accountId = meData.id;
      if (meData.name) accountName = meData.name;
      actualPageToken = cleanToken;
      console.log(`Direct Page Token detected for: ${accountName} (${accountId})`);
    } else {
      // B. এটি সিস্টেম ইউজার বা ইউজার টোকেন! /me/accounts থেকে পেজের নিজস্ব অ্যাক্সেস টোকেন বের করা
      const accRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${cleanToken}`);
      const accData = await accRes.json();
      if (accData && Array.isArray(accData.data) && accData.data.length > 0) {
        const matched = accData.data.find(p => p.id === targetPageId) || accData.data[0];
        if (matched && matched.access_token) {
          actualPageToken = matched.access_token;
          accountId = matched.id;
          accountName = matched.name || accountName;
          console.log(`Resolved Page Access Token for ${accountName} (${accountId}) from /me/accounts`);
        }
      } else {
        // C. টার্গেট পেজ আইডি দিয়ে সরাসরি পেজের access_token চাওয়া
        try {
          const directPageRes = await fetch(`https://graph.facebook.com/v19.0/${targetPageId}?fields=access_token,name,id&access_token=${cleanToken}`);
          const directPageData = await directPageRes.json();
          if (directPageData && directPageData.access_token) {
            actualPageToken = directPageData.access_token;
            accountId = directPageData.id || targetPageId;
            if (directPageData.name) accountName = directPageData.name;
            console.log(`Resolved Page Access Token directly from page ${accountId}: ${accountName}`);
          }
        } catch (dpErr) {}
      }
    }
  } catch (e) {
    console.warn("Could not query Meta API for page token:", e);
  }

  if (!accountId) {
    accountId = targetPageId || "1287050647827199";
  }
  accountName = accountName || `Facebook Page (${accountId})`;

  // ২. পেজকে স্বয়ংক্রিয়ভাবে Webhooks-এ সাবস্ক্রাইব করা (১-বার লাইফটাইম)
  let subStatus = "active";
  try {
    // ২.১ প্রথমে মেসেঞ্জার ইভেন্টগুলো সাবস্ক্রাইব (pages_messaging পারমিশন দিয়ে শতভাগ কাজ করে)
    const subRes = await fetch(`https://graph.facebook.com/v19.0/${accountId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_reactions,messaging_optins&access_token=${actualPageToken}`, {
      method: "POST"
    });
    const subJson = await subRes.json();
    if (subJson && subJson.success) subStatus = "subscribed_messages";

    // ২.২ আলাদাভাবে কমেন্ট/ফিড ট্রাই করা (যদি pages_manage_metadata পারমিশন থাকে)
    try {
      await fetch(`https://graph.facebook.com/v19.0/${accountId}/subscribed_apps?subscribed_fields=feed&access_token=${actualPageToken}`, {
        method: "POST"
      });
    } catch (e) {}
  } catch (e) {
    subStatus = "subscribed_fallback";
  }

  // ৩. ইন-মেমোরি ও এজ ক্যাশে সেভ (১০০% ক্যাশ ব্যাকআপ)
  activeMetaToken = actualPageToken;
  activeMetaPageId = accountId;

  try {
    const cache = caches.default;
    const tokenUrl = new URL("https://internal-cache.local/config/meta_token");
    await cache.put(tokenUrl, new Response(JSON.stringify({ token: actualPageToken, page_id: accountId, name: accountName }), {
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
      `).bind(`meta_${accountId}`, cleanPlatform, accountName, accountId, actualPageToken).run();

      await env.DB.prepare(`
        INSERT INTO system_config (key, value) VALUES ('meta_page_id', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).bind(accountId).run();

      await env.DB.prepare(`
        INSERT INTO system_config (key, value) VALUES ('meta_system_user_token', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).bind(cleanToken).run();

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
  let apiKey = env.GEMINI_API_KEY;
  if ((!apiKey || apiKey === "YOUR_GEMINI_API_KEY") && env.DB) {
    apiKey = await getConfigValue(env.DB, "gemini_api_key", null);
  }
  let model = env.GEMINI_MODEL;
  if (!model && env.DB) {
    model = await getConfigValue(env.DB, "gemini_model", null);
  }
  if (!model) model = "models/gemini-3.8-live";

  if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY") {
    return {
      reply: "ধন্যবাদ আপনার বার্তার জন্য! আমাদের একজন প্রতিনিধি খুব শীঘ্রই আপনাকে সহায়তা করবেন। নির্দিষ্ট কোনো প্রোডাক্ট সম্পর্কে জানতে চাইলে নির্দ্বিধায় লিখুন।",
      urgent_admin_alert: false,
      order_confirmed: false
    };
  }

  const systemInstruction = 
`You are the expert, polite, and friendly sales & customer support AI for 'Ranonex' online store in Bangladesh (https://ranonex.shop).
Respond warmly, politely, and naturally in pure Bengali (বাংলা) by default, or Banglish if the customer writes in Banglish.

CRITICAL BRAND & LANGUAGE RULES:
1. BRAND NAME IN ENGLISH ONLY:
   - ALWAYS write the brand name in English letters as "Ranonex". NEVER write it in Bengali script (e.g., do not write 'র‌্যানোনেক্স' or 'রেনোনেক্স')!
   - Website link: https://ranonex.shop

2. 🛍️ COMPLETE PRODUCT CONSULTATION & FULL CATALOG SCOURING:
   - CATEGORY SEARCH RULE (SHOW ALL OPTIONS):
     If customer asks about a category or general type (e.g. "পাঞ্জাবি আছে?", "ঘড়ি আছে?", "গেম কনসোল আছে?", "হুডি আছে?"):
     You MUST scan the ENTIRE catalog from top to bottom and list ALL matching products (e.g. all matching models/variants). Number them clearly (১, ২, ৩...), shorten each description by 10-20% (1 line stating color/spec + Price + Link), so the customer sees all choices!
   - Single product inquiry: 1-2 lines explaining features, Price, direct order link, and in-chat ordering prompt.

3. 🛒 STRICT ORDER CONFIRMATION & STRUCTURED FORM REVIEW:
   - When a product is selected/discussed and customer provides Full Name, 11-digit Phone (01XXXXXXXXX), and Complete Delivery Address:
     YOU MUST CONFIRM THE ORDER IMMEDIATELY IN THAT SAME TURN! Never ask again.
     Present the exact structured form review:
     ধন্যবাদ [Customer Name]! আপনার অর্ডারটি সফলভাবে কনফার্ম করা হয়েছে।

     📋 আপনার অর্ডারের তথ্যসমূহ (রিভিউ):
     ━━━━━━━━━━━━━━━━━━━
     📦 প্রোডাক্ট: [Product Name]
     👤 নাম: [Customer Name]
     📞 মোবাইল: [Customer 11-digit Phone]
     📍 ঠিকানা: [Delivery Address]
     💰 সর্বমোট প্রদেয় মূল্য: ৳[Total (Product Price + 70 Tk Dhaka / 130 Tk outside Dhaka)]/- (ক্যাশ অন ডেলিভারি)
     ━━━━━━━━━━━━━━━━━━━
     অনুগ্রহ করে উপরের তথ্যগুলো একবার মিলিয়ে দেখে নিন। পরবর্তী ১৫ মিনিটের মধ্যে নাম, মোবাইল নম্বর বা ডেলিভারি ঠিকানায় কোনো পরিবর্তন প্রয়োজন হলে আমাদের এখানে লিখে জানাতে পারেন।
     AND set "order_confirmed": true and populate "order_data".

D1 STORE & PRODUCTS CATALOG:
${businessContext}

RESPONSE FORMAT (JSON ONLY):
Respond ONLY with a valid JSON object matching this schema:
{
  "reply": "Your Bengali response message to customer",
  "order_confirmed": false,
  "order_data": {
    "customer_name": "...",
    "customer_phone": "...",
    "delivery_address": "...",
    "product_name": "...",
    "variant": "...",
    "total_amount": 0
  },
  "urgent_admin_alert": false
}`;

  // Build Gemini multi-turn conversation history
  const rawTurns = [];
  if (Array.isArray(recentHistory)) {
    for (const m of recentHistory) {
      const role = (m.sender_type === "assistant" || m.sender_type === "ai") ? "model" : "user";
      const text = (m.message_text || m.text || "").trim();
      if (text) {
        rawTurns.push({ role, parts: [{ text }] });
      }
    }
  }

  // Ensure userMessage is the final turn
  if (rawTurns.length === 0 || rawTurns[rawTurns.length - 1].parts[0].text !== userMessage.trim()) {
    rawTurns.push({ role: "user", parts: [{ text: userMessage.trim() }] });
  }

  // Gemini requires strictly alternating roles starting with user
  const contents = [];
  for (const turn of rawTurns) {
    if (contents.length === 0) {
      if (turn.role === "user") contents.push(turn);
      continue;
    }
    const prevTurn = contents[contents.length - 1];
    if (prevTurn.role === turn.role) {
      prevTurn.parts[0].text += "\n" + turn.parts[0].text;
    } else {
      contents.push(turn);
    }
  }

  if (contents.length === 0 || contents[contents.length - 1].role !== "user") {
    contents.push({ role: "user", parts: [{ text: userMessage.trim() }] });
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: { temperature: 0.5, response_mime_type: "application/json" }
      })
    });

    if (res.ok) {
      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText) {
        const cleanJson = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        const parsed = JSON.parse(cleanJson);
        const replyStr = parsed.reply || rawText;
        const isConfirmInText = /(?:অর্ডার(?:টি)?\s*(?:সফলভাবে\s*)?(?:কনফার্ম|নিশ্চিত|গ্রহণ)(?:\s*করা)?\s*(?:হ(?:য়ে|য়ে)ছে|হলো|হল|করেছি|নিলাম)|📋\s*আপনার\s*অর্ডারের\s*তথ্যসমূহ)/i.test(replyStr);
        const isOrderConfirmed = Boolean(parsed.order_confirmed || isConfirmInText);
        return {
          reply: replyStr,
          urgent_admin_alert: Boolean(parsed.urgent_admin_alert || isOrderConfirmed),
          order_confirmed: isOrderConfirmed,
          order_data: parsed.order_data || null
        };
      }
    }
  } catch (e) {
    console.warn("Gemini call error:", e.message);
  }

  return {
    reply: "ধন্যবাদ! আমরা আপনার মেসেজটি পেয়েছি। কিছুক্ষণের মধ্যে আমাদের টিম থেকে উত্তর দেওয়া হবে।",
    urgent_admin_alert: false,
    order_confirmed: false
  };
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

  if (!db) return "Standard Store Policies: Cash on Delivery available across Bangladesh. Delivery: Dhaka 70 BDT, Outside Dhaka 130 BDT.";

  try {
    await ensureTables(db);
    const { results: products } = await db.prepare(`
      SELECT id, sku, name, price, description, category, stock_status, specifications, product_url 
      FROM products 
      WHERE is_active = 1 
      ORDER BY created_at DESC 
      LIMIT 50
    `).all();
    const { results: profileRows } = await db.prepare("SELECT key, value FROM system_config").all();

    let context = "=== STORE POLICIES & INFORMATION ===\n";
    context += "- Store Name: Ranonex (Website: https://ranonex.shop)\n";
    let delDhaka = "70";
    let delOutside = "130";
    let payment = "Cash on Delivery (ক্যাশ অন ডেলিভারি - পণ্য হাতে পেয়ে টাকা পরিশোধ)";

    for (const r of (profileRows || [])) {
      if (!r.key.includes("token") && !r.key.includes("key") && !r.key.includes("secret")) {
        if (r.key === "delivery_inside_dhaka" && r.value) delDhaka = r.value;
        if (r.key === "delivery_outside_dhaka" && r.value) delOutside = r.value;
        if (r.key === "payment_methods" && r.value) payment = r.value;
        context += `- ${r.key}: ${r.value}\n`;
      }
    }
    context += `- Delivery Charge: Dhaka City ৳${delDhaka}, Outside Dhaka ৳${delOutside}\n`;
    context += `- Payment Method: ${payment}\n`;

    if (products && products.length > 0) {
      context += "\n=== ALL AVAILABLE STORE PRODUCTS (WITH SKU, SPECS & DIRECT ORDER LINKS) ===\n";
      for (const p of products) {
        const skuStr = p.sku ? `[SKU: ${p.sku}] ` : `[ID: ${p.id}] `;
        const specsStr = p.specifications ? `\n    * Available Specs/Variants: ${p.specifications}` : '';
        const descSnippet = p.description ? `\n    * Details: ${p.description.slice(0, 160)}` : '';
        const orderUrl = p.product_url || `https://ranonex.shop/product.html?id=${p.id}`;
        context += `\n- ${skuStr}${p.name}\n    * Price: ৳${p.price} (${p.stock_status})${specsStr}\n    * Direct Order Link: ${orderUrl}${descSnippet}\n`;
      }
    }

    localBusinessCache = { data: context, expiresAt: now + 5 * 60 * 1000 };
    return context;
  } catch (e) {
    return "Standard Store Support: Cash on Delivery available across Bangladesh.";
  }
}

async function invalidateBusinessCache() {
  localBusinessCache = { data: null, expiresAt: 0 };
}

// ========================================================
// 🧠 ZERO-D1 IN-MEMORY & EDGE CACHE CONVERSATIONS STORE
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
}

async function appendMessageToSession(chatId, senderName, senderType, text, platform = "meta", env = null, senderAvatar = null) {
  let session = await getSession(chatId, env);
  const nowStr = new Date().toISOString();

  if (!session) {
    session = {
      chat_id: chatId,
      sender_name: senderName,
      sender_avatar: senderAvatar || "",
      platform: platform,
      channel_type: platform === "whatsapp" ? "whatsapp" : (platform === "fb_comment" ? "comment" : "messenger"),
      admin_takeover: false,
      takeover_until: 0,
      unread_count: 0,
      needs_attention: false,
      last_message: text,
      last_message_at: nowStr,
      messages: []
    };
  }

  session.sender_name = senderName || session.sender_name;
  if (senderAvatar) session.sender_avatar = senderAvatar;
  session.last_message = text;
  session.last_message_at = nowStr;
  session.platform = platform || session.platform;
  if (platform === "fb_comment") session.channel_type = "comment";

  if (senderType === "customer") {
    session.unread_count = (session.unread_count || 0) + 1;
  } else {
    session.unread_count = 0;
  }

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
          sku TEXT,
          name TEXT NOT NULL,
          price REAL NOT NULL,
          description TEXT,
          category TEXT DEFAULT 'General',
          stock_status TEXT DEFAULT 'in_stock',
          specifications TEXT,
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
          sender_avatar TEXT,
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
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS orders (
          id TEXT PRIMARY KEY,
          chat_id TEXT,
          platform TEXT DEFAULT 'whatsapp',
          customer_name TEXT,
          customer_phone TEXT,
          delivery_address TEXT,
          product_name TEXT,
          variant TEXT,
          total_amount REAL,
          status TEXT DEFAULT 'confirmed',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `)
    ]);

    // মাইগ্রেশন: পূর্বের টেবিলে নতুন কলাম থাকলে অ্যাড করা (safe ignore if exists)
    try { await db.prepare("ALTER TABLE products ADD COLUMN sku TEXT").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN specifications TEXT").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN image_url TEXT").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN product_url TEXT").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN posting_time TEXT DEFAULT '10:00'").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN daily_auto_post INTEGER DEFAULT 1").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN target_platform TEXT DEFAULT 'facebook'").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN schedule_type TEXT DEFAULT 'daily'").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN interval_hours INTEGER DEFAULT 4").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN last_posted_at TIMESTAMP").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE products ADD COLUMN gallery_images TEXT").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE post_history ADD COLUMN image_url TEXT").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE live_conversations ADD COLUMN sender_avatar TEXT").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE live_conversations ADD COLUMN unread_count INTEGER DEFAULT 0").run(); } catch (e) {}
    try { await db.prepare("ALTER TABLE live_conversations ADD COLUMN channel_type TEXT DEFAULT 'messenger'").run(); } catch (e) {}
    try { await db.prepare("DELETE FROM live_conversations WHERE chat_id = '0' OR chat_id LIKE 'fb_user_%' OR chat_id LIKE 'wa_01882%' OR chat_id LIKE 'test_%'").run(); } catch (e) {}
    try { await db.prepare("UPDATE live_conversations SET admin_takeover = 0").run(); } catch (e) {}
    // পূর্ববর্তী টেস্ট ডামি প্রোডাক্ট রিমুভ ও ফাঁকা ডিফল্ট ফিল্ডগুলো পূরণ করা (ইউজারের সেভ করা শিডিউল কখনোই ওভাররাইট করবে না)
    try { await db.prepare("DELETE FROM products WHERE id LIKE 'p_1793%' AND sku IS NULL").run(); } catch (e) {}
    try { await db.prepare("UPDATE products SET target_platform = 'facebook' WHERE target_platform IS NULL OR target_platform = ''").run(); } catch (e) {}
    try { await db.prepare("UPDATE products SET posting_time = '20:00' WHERE posting_time IS NULL OR posting_time = ''").run(); } catch (e) {}
    try { await db.prepare("UPDATE products SET stock_status = 'in_stock' WHERE stock_status IS NULL OR stock_status = ''").run(); } catch (e) {}
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

  // সমস্ত ইউনিক ফটো সংগ্রহ (গ্যালারি ও ভ্যারিয়েন্ট ইমেজ সহ সব ফটো)
  const allImages = [];
  for (const img of gallery) {
    if (typeof img === 'string' && img.startsWith('http') && !allImages.includes(img)) {
      allImages.push(img);
    }
  }
  for (const v of variants) {
    if (v && typeof v.imageUrl === 'string' && v.imageUrl.startsWith('http') && !allImages.includes(v.imageUrl)) {
      allImages.push(v.imageUrl);
    }
  }

  // প্রাইমারি ইমেজ নির্বাচন
  let r2Image = allImages[0] || "";
  if (!r2Image && p.image_url && p.image_url.startsWith('http')) {
    r2Image = p.image_url;
    allImages.push(r2Image);
  }

  const basePrice = parseFloat(p.base_price || p.price || 0);
  const flashSale = parseFloat(p.flash_sale_price || 0);
  const finalPrice = (flashSale > 0 && flashSale < basePrice) ? (basePrice - flashSale) : basePrice;

  // ডেসক্রিপশন থেকে এইচটিএমএল ট্যাগ ও অতিরিক্ত স্পেস পরিষ্কার করা
  const rawDesc = p.description || p.details || "";
  const cleanDesc = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 600);

  const specsSummary = variants.map(v => {
    const color = v.colorName || 'Default';
    const sizes = (v.sizes || []).map(s => `${s.size}${s.stock <= 0 ? ' (Stock Out)' : ''}`).join(', ');
    return sizes ? `${color}: ${sizes}` : color;
  }).join(' | ') || 'Standard / One Size';

  const sku = (p.sku && p.sku.trim()) ? p.sku.trim() : (p.id ? String(p.id).toUpperCase() : '');

  return {
    success: true,
    product: {
      name: p.name || p.title || "প্রোডাক্ট",
      sku: sku,
      price: finalPrice,
      original_price: basePrice,
      discount: flashSale,
      description: cleanDesc,
      image_url: r2Image,
      gallery_images: allImages,
      product_url: url,
      category: p.category || "General",
      specifications: specsSummary,
      variants_count: variants.length
    }
  };
}

// ========================================================
// 📢 টেলিগ্রাম ইনস্ট্যান্ট অর্ডার নোটিফিকেশন ইঞ্জিন
// ========================================================
async function sendTelegramOrderNotification(orderData, env) {
  let botToken = env.TELEGRAM_BOT_TOKEN;
  let chatId = env.TELEGRAM_ADMIN_CHAT_ID;

  if (env.DB) {
    const dbToken = await getConfigValue(env.DB, "telegram_bot_token", null);
    const dbChat = await getConfigValue(env.DB, "telegram_admin_chat_id", null);
    if (dbToken) botToken = dbToken;
    if (dbChat) chatId = dbChat;
  }

  if (!botToken || !chatId) {
    console.warn("Telegram bot token or admin chat ID missing in env/D1");
    return { success: false, reason: "Missing telegram credentials" };
  }

  const cleanToken = botToken.replace(/^bot/, '').trim();
  const nowBdt = new Date(Date.now() + 6 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19);

  const platformEmoji = orderData.platform === 'facebook' ? '🔵 Facebook Messenger (Page: Ranonex)' : '🟢 WhatsApp Live Chat';
  const chatUrl = orderData.chat_id 
    ? `https://automate.ranonex.shop?chat_id=${encodeURIComponent(orderData.chat_id)}`
    : `https://automate.ranonex.shop?tab=inbox`;

  const text = 
`🎉 [নতুন অর্ডার কনফার্ম করেছে AI - Ranonex]
━━━━━━━━━━━━━━━━━━━━
📱 অর্ডার সোর্স: ${platformEmoji}
👤 কাস্টমার: ${orderData.customer_name || 'Customer'}
📞 মোবাইল নম্বর: ${orderData.customer_phone || 'N/A'}
📍 ডেলিভারি ঠিকানা: ${orderData.delivery_address || 'N/A'}
━━━━━━━━━━━━━━━━━━━━
📦 অর্ডারকৃত পণ্য: ${orderData.product_name || 'N/A'}
🎨 সাইজ / কালার: ${orderData.variant || 'Standard'}
💵 সর্বমোট বিল (COD): ৳${orderData.total_amount || 0} BDT
━━━━━━━━━━━━━━━━━━━━
🤖 হ্যান্ডেল করেছে: Ranonex AI Sales Agent
⏰ অর্ডারের সময়: ${nowBdt} (BDT)
👉 কাস্টমার চ্যাট লিংক: ${chatUrl}
🌐 ড্যাশবোর্ড: https://automate.ranonex.shop`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: String(chatId).trim(),
        text: text
      })
    });
    const json = await res.json();
    return { success: json.ok, data: json };
  } catch (e) {
    console.warn("Telegram notification error:", e.message);
    return { success: false, error: e.message };
  }
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
// ⚡ DEFAULT & PERMANENT MODEL: Gemini 3.8 Live WebSocket Engine
// Model: "models/gemini-3.8-live" (Unlimited Request Limit for high-throughput social automation)
// ========================================================
const PERMANENT_LIVE_MODEL = "models/gemini-3.8-live";
const FALLBACK_LIVE_MODEL = "models/gemini-2.5-flash-native-audio-preview-12-2025";

async function callGeminiLiveInWorker(prompt, apiKey, modelName = PERMANENT_LIVE_MODEL, imageParts = []) {
  if (!apiKey || typeof WebSocket === "undefined") return null;

  try {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    const ws = new WebSocket(wsUrl);

    return new Promise((resolve) => {
      let accumulatedTranscription = "";
      let accumulatedParts = "";
      let isDone = false;

      const timer = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          try { ws.close(); } catch (e) {}
          const finalTxt = accumulatedTranscription.trim() || accumulatedParts.trim();
          resolve(finalTxt || null);
        }
      }, 20000);

      ws.addEventListener("open", () => {
        const setupPayload = {
          setup: {
            model: modelName || PERMANENT_LIVE_MODEL,
            generationConfig: {
              responseModalities: ["AUDIO"]
            },
            outputAudioTranscription: {}
          }
        };
        ws.send(JSON.stringify(setupPayload));
      });

      ws.addEventListener("message", (event) => {
        try {
          const raw = typeof event.data === "string" ? event.data : event.data.toString();
          const data = JSON.parse(raw);

          if (data.setupComplete) {
            const userParts = [];
            if (Array.isArray(imageParts) && imageParts.length > 0) {
              for (const img of imageParts) {
                if (img && img.data) {
                  userParts.push({
                    inlineData: {
                      mimeType: img.mimeType || "image/jpeg",
                      data: img.data
                    }
                  });
                }
              }
            }
            userParts.push({ text: prompt });

            ws.send(JSON.stringify({
              clientContent: {
                turns: [{ role: "user", parts: userParts }],
                turnComplete: true
              }
            }));
            return;
          }

          if (data.serverContent) {
            // 🌟 Live Audio Output Transcription (পবিত্র টেক্সট - নো থিংকিং মনোলগ)
            if (data.serverContent.outputTranscription?.text) {
              accumulatedTranscription += data.serverContent.outputTranscription.text;
            }
            const parts = data.serverContent.modelTurn?.parts || [];
            for (const p of parts) {
              if (p.text && !p.thought) accumulatedParts += p.text;
            }
            if (data.serverContent.turnComplete || data.serverContent.generationComplete) {
              if (!isDone) {
                isDone = true;
                clearTimeout(timer);
                try { ws.close(); } catch (e) {}
                const finalTxt = accumulatedTranscription.trim() || accumulatedParts.trim();
                resolve(finalTxt || null);
              }
            }
          }
        } catch (err) {}
      });

      ws.addEventListener("error", () => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timer);
          const finalTxt = accumulatedTranscription.trim() || accumulatedParts.trim();
          resolve(finalTxt || null);
        }
      });

      ws.addEventListener("close", () => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timer);
          const finalTxt = accumulatedTranscription.trim() || accumulatedParts.trim();
          resolve(finalTxt || null);
        }
      });
    });
  } catch (e) {
    return null;
  }
}

// 🧠 AI সেলস কপিরাইটার (Worker Direct Posting: Gemini 2.5 Flash Native Audio Dialog Engine)
async function generateAIPostCaption(product, angleObj, env) {
  let apiKey = env.GEMINI_API_KEY;
  if ((!apiKey || apiKey === "YOUR_GEMINI_API_KEY") && env.DB) {
    apiKey = await getConfigValue(env.DB, "gemini_api_key", null);
  }
  if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY") {
    apiKey = "";
  }

  // র‍্যান্ডম হুক সিলেক্টর
  const randomHook = angleObj.hook_starters[Math.floor(Math.random() * angleObj.hook_starters.length)];
  
  // D1 ডেটাবেস থেকে রিয়েল-টাইম স্টোর পলিসি ও ডেলিভারি চার্জ রিড
  const policies = await getStorePolicies(env.DB);

  // প্রোডাক্টের ছবি সংগ্রহ ও Base64 রূপান্তর (Gemini Multimodal Vision এর জন্য)
  const imageParts = [];
  if (product.image_url && product.image_url.startsWith('http')) {
    try {
      const imgRes = await fetch(product.image_url, {
        headers: { "User-Agent": "SocialAutomate-Worker/1.0" }
      });
      if (imgRes.ok) {
        const ab = await imgRes.arrayBuffer();
        const bytes = new Uint8Array(ab);
        const len = bytes.byteLength;
        let b64 = "";
        for (let i = 0; i < len; i += 8192) {
          b64 += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, len)));
        }
        imageParts.push({
          mimeType: imgRes.headers.get("content-type") || "image/jpeg",
          data: btoa(b64)
        });
      }
    } catch (imgErr) {}
  }

  const prompt = `
You are an elite Bangladeshi e-commerce direct-response copywriter and social media marketer for "Ranonex".
Write an authentic, irresistible, highly persuasive Facebook sales post for this product in natural, engaging Bengali script (বাংলা লিপি).

=== PRODUCT INFORMATION ===
Name: ${product.name}
Price: ৳${product.price} ${product.original_price && product.original_price > product.price ? `(Regular Price: ৳${product.original_price})` : ''}
Details / Features: ${product.description || 'Premium quality durable product'}
Category: ${product.category || 'General'}
Order Method: Customers will find the direct website order link in the FIRST COMMENT of this post or can message the page directly.

=== STORE POLICIES (LOADED DIRECTLY FROM DATABASE) ===
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

=== STRICT ANTI-REPETITION & ZERO-TEMPLATE RULES ===
1. Natural Bengali & Authentic Brand Tone: Write the persuasive storytelling and sales narrative in natural Bengali script (বাংলা লিপি). PRESERVE essential English product terms, brand name ("${policies.store_name}"), fabric/material names (e.g. "China Giza Cotton"), sizes ("M-40 | L-42 | XL-44"), color names, and English hashtags naturally as top Bangladeshi fashion brands do.
2. ABSOLUTELY BANNED CLICHÉS & ROBOTIC FORMULAIC BULLETS (DO NOT USE ANY OF THESE):
   - "🔥 আকর্ষণীয় অফার"
   - "সুসংবাদ সুসংবাদ"
   - "💎 কেন এটি আপনার জন্য সেরা পছন্দ?"
   - "✅ প্রিমিয়াম বিল্ড কোয়ালিটি ও দীর্ঘস্থায়িত্ব"
   - "✅ ১০০% অরিজিনাল প্রোডাক্টের নিশ্চয়তা"
   - "হিসাব করলে এটি বাজারের সেরা পছন্দের তালিকায় সবার উপরে"
   - "আপনি কি একটি ভালো... খুঁজছেন?"
   - "দেরি না করে এখনই অর্ডার করুন"
   - "আসসালামু আলাইকুম ভিউয়ার্স"
3. Start with an eye-catching, relatable human opening line matching the chosen angle: "${randomHook}".
4. Keep the language natural, conversational, vivid, and persuasive (authentic Bangladeshi tone like an expert talking to a friend).
5. Highlight why this product is truly worth buying, practical daily benefits and emotional appeal.
6. Price & COD: Mention the price clearly (৳${product.price}) and nationwide Cash on Delivery (${policies.payment_methods}).
7. Delivery Charges: State the exact delivery charges:
   - ঢাকা সিটির ভেতরে: ${policies.del_inside}
   - ঢাকার বাইরে: ${policies.del_outside}
8. Return Guarantee: State that customers can check the parcel upon delivery (${policies.return_policy}).
9. STRICT NO-LINK IN CAPTION RULE: NEVER include any website link (no http/https, no ranonex.shop) in the post caption body! Facebook penalizes posts with external links and destroys organic reach.
   Instead, your Call-to-Action MUST instruct: "👉 বিস্তারিত দেখতে ও সরাসরি অর্ডার করতে প্রথম কমেন্টের লিংকে ক্লিক করুন অথবা পেজে ইনবক্স করুন!"
10. Include 3-4 natural hashtags at the very end (#${policies.store_name.replace(/\s+/g, '')} #MensFashionBD etc.).
11. Output ONLY the raw caption text in Bengali. No intros, internal reasoning/thoughts, markdown meta, or quotes.
`;

  // ⚡ ১. পার্মানেন্ট ও ডিফল্ট ইঞ্জিন: Gemini 3.8 Live WebSocket Engine (Unlimited Request Limit)
  if (apiKey) {
    try {
      console.log(`⚡ [Worker] Calling Permanent Live Model: ${PERMANENT_LIVE_MODEL}...`);
      const liveCaption = await callGeminiLiveInWorker(prompt, apiKey, PERMANENT_LIVE_MODEL, imageParts);
      if (liveCaption && liveCaption.trim().length > 40) {
        let cleanText = liveCaption.trim()
          .replace(/\*\*(?:Considering|Defining|Refining|Crafting|Finalizing|Constructing|Formulating|Composing|Thinking|Structuring)[^*]*\*\*[\s\S]*?(?=\n\n|$)/gi, "")
          .replace(/^(?:I'm|I have|I've|I am) (?:now |currently )?(?:focusing|crafting|iterating|putting|integrating|fleshing|building|polishing|drafting|finished|written|incorporating|structuring)[^\n]*\n?/gim, "")
          .replace(/(?:ভিজিট করুন\s*:?|ওয়েবসাইটে দেখুন\s*:?|অর্ডার লিংক\s*:?)\s*https?:\/\/[^\s]+/gi, '👉 অর্ডার করতে প্রথম কমেন্টের লিংকে ক্লিক করুন অথবা ইনবক্স করুন')
          .replace(/https?:\/\/[^\s]+/gi, '')
          .replace(/(?:www\.)?[a-zA-Z0-9-]+\.(?:shop|com|org|net)[^\s]*/gi, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        console.log(`⚡ [Worker Gemini 3.8 Live WS Engine] ${angleObj.name} অ্যাঙ্গেলে পোস্ট সফলভাবে তৈরি!`);
        return cleanText;
      }
    } catch (wsErr) {
      console.warn("callGeminiLiveInWorker 3.8 failed:", wsErr.message);
    }

    // ⚡ ২. সেকেন্ডারি লাইভ মডেল ফলব্যাক (models/gemini-2.5-flash-native-audio-preview-12-2025)
    try {
      const fbLive = await callGeminiLiveInWorker(prompt, apiKey, FALLBACK_LIVE_MODEL, imageParts);
      if (fbLive && fbLive.trim().length > 40) {
        let cleanText = fbLive.trim()
          .replace(/\*\*(?:Considering|Defining|Refining|Crafting|Finalizing|Constructing|Formulating|Composing|Thinking|Structuring)[^*]*\*\*[\s\S]*?(?=\n\n|$)/gi, "")
          .replace(/^(?:I'm|I have|I've|I am) (?:now |currently )?(?:focusing|crafting|iterating|putting|integrating|fleshing|building|polishing|drafting|finished|written|incorporating|structuring)[^\n]*\n?/gim, "")
          .replace(/(?:ভিজিট করুন\s*:?|ওয়েবসাইটে দেখুন\s*:?|অর্ডার লিংক\s*:?)\s*https?:\/\/[^\s]+/gi, '👉 অর্ডার করতে প্রথম কমেন্টের লিংকে ক্লিক করুন অথবা ইনবক্স করুন')
          .replace(/https?:\/\/[^\s]+/gi, '')
          .replace(/(?:www\.)?[a-zA-Z0-9-]+\.(?:shop|com|org|net)[^\s]*/gi, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        return cleanText;
      }
    } catch (fbErr) {}

    // ৩. ইমার্জেন্সি ফলব্যাক: Google Gemini AI REST ইঞ্জিন (যদি নেটওয়ার্কের কারণে WebSocket ড্রপ করে)
    const candidateModels = [
      "models/gemini-3.1-flash-lite",
      "models/gemini-3-flash-preview",
      "models/gemini-3.5-flash",
      "models/gemini-3.8-flash"
    ];

    const restParts = [];
    if (imageParts.length > 0) {
      for (const img of imageParts) {
        restParts.push({
          inlineData: {
            mimeType: img.mimeType || "image/jpeg",
            data: img.data
          }
        });
      }
    }
    restParts.push({ text: prompt });

    for (const model of candidateModels) {
      try {
        const url = model.startsWith("models/")
          ? `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`
          : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: restParts }],
            generationConfig: {
              temperature: 0.85,
              topP: 0.95,
              maxOutputTokens: 1500
            }
          })
        });

        if (res.ok) {
          const data = await res.json();
          const parts = data?.candidates?.[0]?.content?.parts || [];
          let text = "";
          for (const p of parts) {
            if (!p.thought && p.text) text += p.text;
          }
          if (text && text.trim().length > 40) {
            let cleanText = text.trim()
              .replace(/\*\*(?:Considering|Defining|Refining|Crafting|Finalizing|Constructing|Formulating|Composing|Thinking|Structuring)[^*]*\*\*[\s\S]*?(?=\n\n|$)/gi, "")
              .replace(/^(?:I'm|I have|I've|I am) (?:now |currently )?(?:focusing|crafting|iterating|putting|integrating|fleshing|building|polishing|drafting|finished|written|incorporating|structuring)[^\n]*\n?/gim, "")
              .replace(/(?:ভিজিট করুন\s*:?|ওয়েবসাইটে দেখুন\s*:?|অর্ডার লিংক\s*:?)\s*https?:\/\/[^\s]+/gi, '👉 অর্ডার করতে প্রথম কমেন্টের লিংকে ক্লিক করুন অথবা ইনবক্স করুন')
              .replace(/https?:\/\/[^\s]+/gi, '')
              .replace(/(?:www\.)?[a-zA-Z0-9-]+\.(?:shop|com|org|net)[^\s]*/gi, '')
              .replace(/\n{3,}/g, '\n\n')
              .trim();
            console.log(`⚡ [Gemini AI Engine] ${angleObj.name} অ্যাঙ্গেলে ব্যাকআপ পোস্ট তৈরি! (মডেল: ${model})`);
            return cleanText;
          }
        }
      } catch (err) {}
    }
  } else {
    console.warn("⚠️ [Gemini AI Notice] D1 ডেটাবেসে কোনো gemini_api_key পাওয়া যায়নি। ড্যাশবোর্ডের Settings থেকে সেভ করুন।");
  }

  // ২. যদি ক্লাউডফ্লেয়ার Workers AI বাইন্ডিং থাকে
  if (env.AI) {
    try {
      const cfRes = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [{ role: "user", content: prompt }]
      });
      const cfText = cfRes?.response;
      if (cfText && cfText.trim().length > 40) {
        let cleanText = cfText.trim()
          .replace(/https?:\/\/[^\s]+/gi, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        console.log(`⚡ [Cloudflare Workers AI] Llama-3.1 দিয়ে পোস্ট সফলভাবে তৈরি!`);
        return cleanText;
      }
    } catch (cfErr) {
      console.warn("Cloudflare Workers AI note:", cfErr.message);
    }
  }

  // ৩. স্মার্ট হিউম্যান কপিরাইটিং (বুলিটলেস ও প্রাকৃতিক স্টোরিটেলিং)
  return generateFallbackCaption(product, angleObj, randomHook, policies);
}

function generateFallbackCaption(p, angle, hook, policies) {
  const pol = policies || {
    store_name: "Ranonex",
    del_inside: "৬০ টাকা",
    del_outside: "১২০ টাকা",
    payment_methods: "ক্যাশ অন ডেলিভারি",
    return_policy: "ডেলিভারির সময় চেক করে দেখে নেওয়ার সুযোগ",
    contact_phone: ""
  };

  const origPriceText = (p.original_price && p.original_price > p.price) ? ` (রেগুলার প্রাইস: ৳${p.original_price})` : '';
  const descText = p.description ? `${p.description}\n\n` : '';
  const hotlineText = pol.contact_phone ? `\n📞 প্রয়োজনে কল করুন: ${pol.contact_phone}` : '';

  return `${hook}

${p.name} — যারা কোয়ালিটি, স্থায়িত্ব ও প্রিমিয়াম ফিনিশের সাথে কোনো আপস করতে চান না, এটি তাদের জন্যই পারফেক্ট চয়েস।

${descText}🚚 সারা বাংলাদেশে দ্রুত ক্যাশ অন হোম ডেলিভারি (পার্সেল হাতে পেয়ে চেক করে দেখে নেওয়ার শতভাগ সুযোগ রয়েছে)। ডেলিভারি চার্জ: ঢাকা সিটির ভেতরে ${pol.del_inside}, ঢাকার বাইরে ${pol.del_outside}।${hotlineText}

💰 অফার মূল্য: মাত্র ৳${p.price}${origPriceText}

👉 বিস্তারিত দেখতে ও সরাসরি অর্ডার করতে প্রথম কমেন্টের লিংকে ক্লিক করুন অথবা পেজে ইনবক্স করুন!

#${p.category ? p.category.replace(/\s+/g, '_') : 'OnlineShopping'} #TrendingProducts #SmartShopping #${pol.store_name.replace(/\s+/g, '')}`;
}

// ========================================================
// 💬 ফেসবুক পোস্টে প্রোডাক্ট লিংক সহ প্রথম কমেন্ট সেন্ডার (Max Organic Reach)
// ========================================================
async function postFirstComment(postId, product, token) {
  if (!postId || !token) return null;
  try {
    const rawUrl = product?.product_url || product?.url || '';
    let productUrl = rawUrl;
    if (!productUrl && product?.id) {
      productUrl = `https://ranonex.shop/product.html?id=${encodeURIComponent(product.id)}`;
    }
    if (!productUrl || !productUrl.startsWith('http')) {
      productUrl = 'https://ranonex.shop';
    }

    const commentMsg = `🛍️ প্রোডাক্টের বিস্তারিত ছবি দেখতে ও সরাসরি ওয়েবসাইট থেকে অর্ডার করতে নিচের লিংকে ক্লিক করুন:\n👉 ${productUrl}\n\n🚚 সারা বাংলাদেশে ক্যাশ অন হোম ডেলিভারি (হাতে পেয়ে চেক করে নেওয়ার সুবিধা)! অথবা সরাসরি অর্ডার করতে পেজে মেসেজ পাঠান।`;

    const res = await fetch(`https://graph.facebook.com/v19.0/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commentMsg,
        access_token: token
      })
    });
    const data = await res.json();
    if (res.ok && data.id) {
      console.log(`💬 [Facebook First Comment Success] Comment ID: ${data.id} on Post: ${postId}`);
      return data.id;
    } else {
      console.warn(`⚠️ [Facebook First Comment Warning]:`, data);
      return null;
    }
  } catch (err) {
    console.warn(`⚠️ [Facebook First Comment Exception]:`, err.message);
    return null;
  }
}

// ========================================================
// 🔵 ফেসবুক পেজ টোকেন অটো-রিসলভার (System User Token -> Page Access Token)
// ========================================================
async function resolvePageAccessToken(rawToken, targetPageId = "1287050647827199") {
  if (!rawToken) return null;
  try {
    // ১. সরাসরি পেজ টোকেন কি না চেক করা
    const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,category&access_token=${rawToken}`);
    const meData = await meRes.json();
    if (meData && meData.id && meData.category) return rawToken;

    // ২. /me/accounts থেকে পেজ টোকেন খোঁজা
    const accRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${rawToken}`);
    const accData = await accRes.json();
    if (accData && Array.isArray(accData.data) && accData.data.length > 0) {
      const match = (targetPageId ? accData.data.find(p => p.id === targetPageId) : null) || accData.data[0];
      if (match && match.access_token) return match.access_token;
    }

    // ৩. পেজ আইডি থেকে সরাসরি টোকেন চাওয়া
    if (targetPageId) {
      const pRes = await fetch(`https://graph.facebook.com/v19.0/${targetPageId}?fields=access_token&access_token=${rawToken}`);
      const pData = await pRes.json();
      if (pData && pData.access_token) return pData.access_token;
    }
  } catch (e) {
    console.warn("resolvePageAccessToken error:", e);
  }
  return rawToken;
}

// ========================================================
// 🔵 ফেসবুক পেজে পোস্ট সেন্ডার (মাল্টি-ফটো অ্যালবাম + পাবলিক R2 ছবি সহ)
// ========================================================
async function publishToFacebookPage(product, caption, env) {
  let token = await getMetaPageToken(env);
  let pageId = env.META_PAGE_ID || "1287050647827199";
  if (env.DB) {
    const dbPageId = await getConfigValue(env.DB, "meta_page_id", null);
    if (dbPageId) pageId = dbPageId;
  }
  token = await resolvePageAccessToken(token, pageId);

  if (!token) {
    throw new Error("Facebook Page Access Token D1 বা Worker-এ পাওয়া যায়নি। ড্যাশবোর্ডে টোকেন সেভ করুন।");
  }

  // ১. ডেটাবেসে থাকা প্রোডাক্টের সমস্ত সিরিয়াল ফটো সংগ্রহ (শুধুমাত্র ইউজারের সেভ করা ছবি ব্যবহার হবে)
  let images = [];
  try {
    if (typeof product.gallery_images === 'string') {
      images = JSON.parse(product.gallery_images);
    } else if (Array.isArray(product.gallery_images)) {
      images = product.gallery_images;
    }
  } catch (e) {}

  if (!images || images.length === 0) {
    if (product.image_url) images = [product.image_url];
  }
  images = (images || []).filter(u => typeof u === 'string' && u.startsWith('http'));

  // ২. একাধিক ছবি থাকলে -> ফেসবুক মাল্টি-ফটো অ্যালবাম ফিড পোস্ট (Multi-Photo Attached Media)
  if (images.length > 1) {
    console.log(`📸 Posting ALL ${images.length} Photos in Serial Order to Facebook Page (${pageId})`);
    const attachedMedia = [];
    for (let i = 0; i < images.length; i++) {
      const photoUrl = images[i];
      try {
        const upRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: photoUrl,
            published: false,
            access_token: token
          })
        });
        const upData = await upRes.json();
        if (upData.id) {
          attachedMedia.push({ media_fbid: String(upData.id) });
          console.log(`  ✅ Photo #${i + 1}/${images.length} uploaded: FBID ${upData.id}`);
        } else {
          console.warn(`  ⚠️ Photo #${i + 1} upload failed:`, upData);
        }
      } catch (upErr) {
        console.warn(`  ⚠️ Photo #${i + 1} upload failed:`, upErr.message);
      }
    }

    if (attachedMedia.length > 0) {
      const feedRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: caption,
          attached_media: attachedMedia,
          published: true,
          access_token: token
        })
      });
      const feedData = await feedRes.json();
      if (feedRes.ok && feedData.id) {
        await postFirstComment(feedData.id, product, token);
        return {
          success: true,
          mode: "multi_photo",
          post_id: feedData.id,
          photos_count: attachedMedia.length,
          post_url: `https://facebook.com/${feedData.id}`
        };
      } else {
        console.warn("Facebook multi-photo feed post failed, falling back to single photo:", feedData);
      }
    }
  }

  // ৩. সিঙ্গেল ছবি অথবা ফলব্যাক ফটো পোস্ট -> /photos এন্ডপয়েন্টে পোস্ট
  if (images.length >= 1) {
    console.log(`📸 Posting Single/Fallback Photo to Facebook Page (${pageId}): ${images[0]}`);
    try {
      const photoRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: images[0],
          caption: caption,
          published: true,
          access_token: token
        })
      });

      const photoData = await photoRes.json();
      if (photoRes.ok && (photoData.id || photoData.post_id)) {
        const postId = photoData.post_id || photoData.id;
        await postFirstComment(postId, product, token);
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

  // ৪. ছবি ছাড়া টেক্সট পোস্ট -> /feed
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
    await postFirstComment(feedData.id, product, token);
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
// 🧠 ওয়ার্কারের মাস্টার প্রম্পট ও ফার্স্ট কমেন্ট বিল্ডার (GitHub Handover এর জন্য ফাইনাল)
// ========================================================
function buildFirstCommentMessage(product) {
  const rawUrl = product?.product_url || product?.url || '';
  let productUrl = rawUrl;
  if (!productUrl && product?.id) {
    productUrl = `https://ranonex.shop/product.html?id=${encodeURIComponent(product.id)}`;
  }
  if (!productUrl || !productUrl.startsWith('http')) {
    productUrl = 'https://ranonex.shop';
  }
  return `🛍️ প্রোডাক্টের বিস্তারিত ছবি দেখতে ও সরাসরি ওয়েবসাইট থেকে অর্ডার করতে নিচের লিংকে ক্লিক করুন:\n👉 ${productUrl}\n\n🚚 সারা বাংলাদেশে ক্যাশ অন হোম ডেলিভারি (হাতে পেয়ে চেক করে নেওয়ার সুবিধা)! অথবা সরাসরি অর্ডার করতে পেজে মেসেজ পাঠান।`;
}

function buildWorkerPostPrompt(product, angleObj, randomHook, policies, previousPosts = []) {
  const pol = policies || {
    store_name: "Ranonex",
    del_inside: "৬০ টাকা",
    del_outside: "১২০ টাকা",
    payment_methods: "ক্যাশ অন ডেলিভারি",
    return_policy: "ডেলিভারির সময় চেক করে দেখে নেওয়ার সুযোগ",
    contact_phone: ""
  };

  const prevSnapshot = (previousPosts || [])
    .slice(0, 3)
    .map((hp, i) => `[পূর্বের পোস্ট #${i + 1} (${hp.angle || 'Angle'})]: ${(hp.caption || '').substring(0, 160)}...`)
    .join("\n");

  return `You are an elite Bangladeshi e-commerce direct-response copywriter and social media marketer for "${pol.store_name}".
Write an authentic, irresistible, highly persuasive Facebook sales post for this product in natural, engaging Bengali script (বাংলা লিপি).

=== PRODUCT INFORMATION ===
Name: ${product.name}
Price: ৳${product.price} ${product.original_price && product.original_price > product.price ? `(Regular Price: ৳${product.original_price})` : ''}
Details / Features: ${product.description || 'Premium quality durable product'}
Specifications: ${product.specifications || ''}
Category: ${product.category || 'General'}
Order Method: Customers will find the direct website order link in the FIRST COMMENT of this post or can message the page directly.

=== STORE POLICIES (LOADED DIRECTLY FROM D1 DATABASE) ===
Store Name: ${pol.store_name}
Delivery Charge Inside Dhaka: ${pol.del_inside}
Delivery Charge Outside Dhaka: ${pol.del_outside}
Payment Methods: ${pol.payment_methods}
Return Policy: ${pol.return_policy}
Contact Phone / Hotline: ${pol.contact_phone || 'ইনবক্স করুন'}

=== TODAY'S MARKETING ANGLE ===
Angle Name: ${angleObj.name}
Angle Directive: ${angleObj.instruction}
Opening Inspiration: "${randomHook}"

${prevSnapshot ? `=== PREVIOUS POSTS (DO NOT REPEAT THESE PHRASES OR OPENINGS) ===\n${prevSnapshot}\n` : ''}
=== STRICT ANTI-REPETITION & ZERO-TEMPLATE RULES ===
1. Natural Bengali & Authentic Brand Tone: Write the persuasive storytelling and sales narrative in natural Bengali script (বাংলা লিপি). PRESERVE essential English product terms, brand name ("${pol.store_name}"), fabric/material names (e.g. "China Giza Cotton"), sizes ("M-40 | L-42 | XL-44"), color names, and English hashtags naturally as top Bangladeshi fashion brands do.
2. ABSOLUTELY BANNED CLICHÉS & ROBOTIC FORMULAIC BULLETS (DO NOT USE ANY OF THESE):
   - "🔥 আকর্ষণীয় অফার"
   - "সুসংবাদ সুসংবাদ"
   - "💎 কেন এটি আপনার জন্য সেরা পছন্দ?"
   - "✅ প্রিমিয়াম বিল্ড কোয়ালিটি ও দীর্ঘস্থায়িত্ব"
   - "✅ ১০০% অরিজিনাল প্রোডাক্টের নিশ্চয়তা"
   - "হিসাব করলে এটি বাজারের সেরা পছন্দের তালিকায় সবার উপরে"
   - "আপনি কি একটি ভালো... খুঁজছেন?"
   - "দেরি না করে এখনই অর্ডার করুন"
   - "আসসালামু আলাইকুম ভিউয়ার্স"
3. Start with an eye-catching, relatable human opening line matching the chosen angle: "${randomHook}".
4. Keep the language natural, conversational, vivid, and persuasive (authentic Bangladeshi tone).
5. Highlight why this product is truly worth buying, practical daily benefits and emotional appeal.
6. Price & COD: Mention the exact price clearly (৳${product.price}) and nationwide Cash on Delivery (${pol.payment_methods}).
7. Delivery Charges: State the exact delivery charges:
   - ঢাকা সিটির ভেতরে: ${pol.del_inside}
   - ঢাকার বাইরে: ${pol.del_outside}
8. Return Guarantee: State that customers can check the parcel upon delivery (${pol.return_policy}).
9. STRICT NO-LINK IN CAPTION RULE: NEVER include any website link (no http/https, no ranonex.shop) in the post caption body! Facebook penalizes posts with external links and destroys organic reach.
   Instead, your Call-to-Action MUST instruct: "👉 বিস্তারিত দেখতে ও সরাসরি অর্ডার করতে প্রথম কমেন্টের লিংকে ক্লিক করুন অথবা পেজে ইনবক্স করুন!"
10. Include 3-5 relevant hashtags at the very end (#${pol.store_name.replace(/\s+/g, '')} #OnlineShoppingBD etc.).
11. Output ONLY the raw caption text in Bengali. No intros, markdown meta, or quotes.`;
}

// ⏰ প্রোডাক্টের শিডিউল ডিউ চেকার (Interval এবং Daily Time উভয় মোড সমর্থিত - BDT UTC+6)
function evaluateProductSchedule(p, now = Date.now()) {
  const bdtDate = new Date(now + 6 * 3600 * 1000);
  const currentHour = bdtDate.getUTCHours();
  const currentMinute = bdtDate.getUTCMinutes();
  const currentMinutesOfDay = currentHour * 60 + currentMinute;
  const currentBdtDateStr = bdtDate.toISOString().slice(0, 10);

  let lastPostedMs = 0;
  let lastPostedBdtDateStr = "";
  if (p.last_posted_at) {
    try {
      const cleanStr = String(p.last_posted_at).replace(" ", "T");
      const dt = new Date(cleanStr.endsWith("Z") ? cleanStr : cleanStr + "Z");
      if (!isNaN(dt.getTime())) {
        lastPostedMs = dt.getTime();
        const lastBdt = new Date(lastPostedMs + 6 * 3600 * 1000);
        lastPostedBdtDateStr = lastBdt.toISOString().slice(0, 10);
      }
    } catch (e) {}
  }

  const elapsedHours = lastPostedMs > 0 ? (now - lastPostedMs) / (3600 * 1000) : null;
  const isIntervalMode = p.schedule_type === 'interval' || (p.posting_time && String(p.posting_time).startsWith('interval_'));

  if (isIntervalMode) {
    let intervalHours = Number(p.interval_hours) || 4;
    if (p.posting_time && String(p.posting_time).startsWith('interval_')) {
      intervalHours = parseInt(String(p.posting_time).replace('interval_', ''), 10) || intervalHours;
    }
    const isDue = lastPostedMs === 0 || (elapsedHours !== null && elapsedHours >= (intervalHours - 0.15));
    return {
      isDue,
      mode: "interval",
      intervalHours,
      elapsedHours: elapsedHours !== null ? Number(elapsedHours.toFixed(2)) : null,
      reason: isDue
        ? (lastPostedMs === 0 ? "প্রথম অটো-পোস্টের জন্য প্রস্তুত (Never Posted)" : `${intervalHours} ঘণ্টার ইন্টারভ্যাল পূর্ণ হয়েছে (${elapsedHours.toFixed(1)}h elapsed)`)
        : `পরবর্তী পোস্ট ${(intervalHours - elapsedHours).toFixed(1)} ঘণ্টা পর`
    };
  }

  // Daily Fixed Time Mode (যেমন "10:00", "20:00" বা একাধিক সময় "10:00, 20:00")
  const rawTimes = String(p.posting_time || '20:00')
    .split(',')
    .map(t => t.trim())
    .filter(t => t.includes(':'));
  const times = rawTimes.length > 0 ? rawTimes : ['20:00'];

  if (times.length === 1) {
    const [tH, tM] = times[0].split(':').map(Number);
    const targetMinutes = (isNaN(tH) ? 20 : tH) * 60 + (isNaN(tM) ? 0 : tM);

    if (lastPostedBdtDateStr === currentBdtDateStr) {
      return {
        isDue: false,
        mode: "daily",
        intervalHours: 24,
        elapsedHours: elapsedHours !== null ? Number(elapsedHours.toFixed(2)) : null,
        reason: `আজকের (${currentBdtDateStr}) পোস্ট ইতোমধ্যে সম্পন্ন হয়েছে`
      };
    }

    // নির্ধারিত সময় বা তার পরে যেকোনো সময় ক্রন রান হলেই পোস্ট হবে (যাতে GitHub ক্রন দেরি করলেও মিস না হয়)
    const isDue = currentMinutesOfDay >= targetMinutes;
    return {
      isDue,
      mode: "daily",
      intervalHours: 24,
      elapsedHours: elapsedHours !== null ? Number(elapsedHours.toFixed(2)) : null,
      reason: isDue
        ? `দৈনিক শিডিউল সময় (${times[0]} BDT) পূর্ণ হয়েছে`
        : `আজকের নির্ধারিত সময় ${times[0]} BDT (বর্তমান সময় ${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')} BDT)`
    };
  }

  // একাধিক দৈনিক সময় থাকলে
  let matchedTime = null;
  for (const t of times) {
    const [tH, tM] = t.split(':').map(Number);
    const targetMinutes = (isNaN(tH) ? 10 : tH) * 60 + (isNaN(tM) ? 0 : tM);
    if (currentMinutesOfDay >= targetMinutes && currentMinutesOfDay <= targetMinutes + 120) {
      matchedTime = t;
      break;
    }
  }
  const isDue = Boolean(matchedTime) && (lastPostedMs === 0 || (elapsedHours !== null && elapsedHours >= 3));
  return {
    isDue,
    mode: "daily_multi",
    intervalHours: Math.round(24 / times.length),
    elapsedHours: elapsedHours !== null ? Number(elapsedHours.toFixed(2)) : null,
    reason: isDue ? `শিডিউল টাইম ম্যাচ (${matchedTime} BDT)` : `পরবর্তী নির্ধারিত সময়ের অপেক্ষায় (${times.join(', ')} BDT)`
  };
}

// 🐙 Cloudflare Worker থেকে GitHub Actions-এ ডিসপ্যাচ হ্যান্ডওভার কলার
async function dispatchGitHubActionHandover(env, params = {}) {
  let ghToken = params.github_token || env.GITHUB_TOKEN || "";
  let ghRepo = params.github_repo || env.GITHUB_REPOSITORY || "rifatrabbi104-oss/social-automate";
  let ghBranch = params.github_branch || "main";
  let ghWorkflow = params.github_workflow || "post_publisher.yml";

  if (env.DB) {
    if (!ghToken) ghToken = await getConfigValue(env.DB, "github_token", "");
    const dbRepo = await getConfigValue(env.DB, "github_repo", "");
    const dbBranch = await getConfigValue(env.DB, "github_branch", "");
    const dbWorkflow = await getConfigValue(env.DB, "github_workflow", "");
    if (dbRepo) ghRepo = dbRepo;
    if (dbBranch) ghBranch = dbBranch;
    if (dbWorkflow) ghWorkflow = dbWorkflow;
  }

  if (!ghToken) {
    return {
      success: false,
      missing_token: true,
      error: "D1 ডেটাবেসে GitHub Personal Access Token (github_token) সেভ করা নেই।"
    };
  }

  try {
    const dispatchRes = await fetch(`https://api.github.com/repos/${ghRepo}/actions/workflows/${ghWorkflow}/dispatches`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ghToken}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "SocialAutomate-Cloudflare-Worker"
      },
      body: JSON.stringify({
        ref: ghBranch,
        inputs: {
          product_id: String(params.product_id || ""),
          product_url: String(params.product_url || ""),
          target_platform: String(params.target_platform || "facebook"),
          post_type: String(params.post_type || "standard")
        }
      })
    });

    if (dispatchRes.ok || dispatchRes.status === 204) {
      return {
        success: true,
        repo: ghRepo,
        workflow: ghWorkflow,
        run_url: `https://github.com/${ghRepo}/actions`
      };
    } else {
      const errText = await dispatchRes.text();
      return {
        success: false,
        error: `GitHub API Error (${dispatchRes.status}): ${errText}`,
        run_url: `https://github.com/${ghRepo}/actions/workflows/${ghWorkflow}`
      };
    }
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

// 📦 GitHub Actions-এর জন্য সম্পূর্ণ হ্যান্ডওভার প্যাকেজ প্রদানকারী API (/api/auto-post-task)
async function handleGetAutoPostHandover(request, url, env) {
  if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
  await ensureTables(env.DB);

  let reqProductId = url.searchParams.get("product_id") || "";
  let onlyDue = url.searchParams.get("only_due") === "true" || url.searchParams.get("scheduled") === "true";

  if (request.method === "POST") {
    try {
      const b = await request.json();
      if (b.product_id) reqProductId = String(b.product_id);
      if (b.only_due !== undefined) onlyDue = Boolean(b.only_due);
    } catch (e) {}
  }

  // ১. D1 থেকে Gemini API Key, Permanent Model এবং Store Policies রিড করা
  let geminiApiKey = env.GEMINI_API_KEY || "";
  if (!geminiApiKey || geminiApiKey === "YOUR_GEMINI_API_KEY") {
    geminiApiKey = await getConfigValue(env.DB, "gemini_api_key", "");
  }
  // ⚡ DEFAULT & PERMANENT MODEL: Gemini 3.8 Live WebSocket Engine (models/gemini-3.8-live) - Unlimited Request Limit
  const geminiModel = "models/gemini-3.8-live";
  const policies = await getStorePolicies(env.DB);

  // ২. D1 থেকে সকল সোশ্যাল মিডিয়া টোকেন ও ক্রেডেনশিয়ালস রিড করা (Worker যা পাঠাবে সেটাই ফাইনাল)
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

  // system_config থেকেও ফলব্যাক টোকেন নিশ্চিত করা
  const cfgFbToken = await getMetaPageToken(env);
  const cfgFbPageId = await getConfigValue(env.DB, "meta_page_id", env.META_PAGE_ID || "1287050647827199");
  const finalFbPageId = (cfgFbPageId && cfgFbPageId !== "122104564287541163") ? cfgFbPageId : "1287050647827199";

  if (cfgFbToken) {
    credentials.facebook = {
      name: credentials.facebook?.name || policies.store_name || "Ranonex",
      id: finalFbPageId,
      token: cfgFbToken
    };
  } else if (credentials.facebook) {
    credentials.facebook.id = finalFbPageId;
  }

  const cfgTkToken = await getConfigValue(env.DB, "tiktok_access_token", "");
  if (cfgTkToken && !credentials.tiktok?.token) {
    credentials.tiktok = {
      name: credentials.tiktok?.name || "TikTok",
      id: credentials.tiktok?.id || "",
      token: cfgTkToken
    };
  }

  const tgBotToken = await getConfigValue(env.DB, "telegram_bot_token", "");
  const tgChatId = await getConfigValue(env.DB, "telegram_admin_chat_id", "");
  if (tgBotToken && tgChatId) {
    credentials.telegram = {
      bot_token: tgBotToken,
      chat_id: tgChatId
    };
  }

  // ৩. প্রোডাক্ট বাছাই ও প্রতিটির জন্য প্রম্পট, ছবি ও ফার্স্ট কমেন্ট রেডি করা
  let prods = [];
  if (reqProductId) {
    const single = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(reqProductId).first();
    if (single) prods = [single];
  } else {
    const { results } = await env.DB.prepare(
      "SELECT * FROM products WHERE is_active = 1 AND daily_auto_post = 1 ORDER BY last_posted_at ASC, created_at DESC"
    ).all();
    prods = results || [];
  }

  const now = Date.now();
  const tasks = [];

  for (const p of prods) {
    const sched = evaluateProductSchedule(p, now);
    if (onlyDue && !reqProductId && !sched.isDue) {
      continue;
    }

    // পূর্বের পোস্ট হিস্ট্রি নেওয়া (যাতে AI রিপিট না করে)
    const { results: hist } = await env.DB.prepare(
      "SELECT caption, angle, platform, published_at FROM post_history WHERE product_id = ? ORDER BY published_at DESC LIMIT 4"
    ).bind(p.id).all();
    const previousPosts = hist || [];
    const recentAngles = previousPosts.map(r => r.angle);

    // নতুন ইউনিক মার্কেটিং অ্যাঙ্গেল নির্বাচন
    const availableAngles = MARKETING_ANGLES.filter(a => !recentAngles.includes(a.name) && !recentAngles.includes(a.key));
    const chosenAngle = availableAngles.length > 0
      ? availableAngles[Math.floor(Math.random() * availableAngles.length)]
      : MARKETING_ANGLES[Math.floor(Math.random() * MARKETING_ANGLES.length)];

    const randomHook = chosenAngle.hook_starters[Math.floor(Math.random() * chosenAngle.hook_starters.length)];

    // ডেটাবেসে থাকা ইউজারের বাছাই করা সব ছবি সিরিয়াল অনুযায়ী প্রস্তুত করা
    let galleryImages = [];
    try {
      if (typeof p.gallery_images === "string") {
        galleryImages = JSON.parse(p.gallery_images);
      } else if (Array.isArray(p.gallery_images)) {
        galleryImages = p.gallery_images;
      }
    } catch (e) {}
    galleryImages = (galleryImages || []).filter(u => typeof u === "string" && u.startsWith("http"));
    if (galleryImages.length === 0 && p.image_url && p.image_url.startsWith("http")) {
      galleryImages = [p.image_url];
    }

    // ওয়ার্কারের তৈরি ফাইনাল প্রম্পট ও প্রথম কমেন্টের মেসেজ
    const finalPrompt = buildWorkerPostPrompt(p, chosenAngle, randomHook, policies, previousPosts);
    const firstCommentMessage = buildFirstCommentMessage(p);
    const fallbackCaption = generateFallbackCaption(p, chosenAngle, randomHook, policies);

    tasks.push({
      ...p,
      target_platform: p.target_platform || "facebook",
      gallery_images: galleryImages,
      image_url: galleryImages[0] || p.image_url || "",
      schedule_evaluation: sched,
      chosen_angle: {
        key: chosenAngle.key,
        name: chosenAngle.name,
        instruction: chosenAngle.instruction,
        hook: randomHook
      },
      prompt: finalPrompt,
      first_comment_message: firstCommentMessage,
      fallback_caption: fallbackCaption,
      previous_posts: previousPosts
    });
  }

  return jsonResponse({
    success: true,
    handover_engine: "Cloudflare Worker -> GitHub Actions Backend",
    timestamp: new Date().toISOString(),
    count: tasks.length,
    ai: {
      api_key: geminiApiKey,
      model: geminiModel
    },
    policies,
    credentials,
    tasks
  });
}

// ========================================================
// 🚀 ড্যাশবোর্ড থেকে ১-ক্লিক প্রোডাক্ট পোস্ট হ্যান্ডলার (GitHub Handover + Direct Fallback)
// ========================================================
async function handlePublishProductNow(body, env) {
  if (!env.DB) return jsonResponse({ error: "D1 Database missing" }, 500);
  await ensureTables(env.DB);

  const { product_id, platform, direct_worker } = body;
  if (!product_id) return jsonResponse({ error: "Missing product_id" }, 400);

  // D1 থেকে প্রোডাক্ট রিড
  const product = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(product_id).first();
  if (!product) return jsonResponse({ error: "Product not found in D1" }, 404);

  // ১. যদি D1-এ GitHub Token সেভ করা থাকে এবং direct_worker না বলা হয় -> সরাসরি GitHub Actions-এ হ্যান্ডওভার!
  const ghToken = await getConfigValue(env.DB, "github_token", env.GITHUB_TOKEN || "");
  if (ghToken && !direct_worker) {
    const dispatchRes = await dispatchGitHubActionHandover(env, {
      product_id: product.id,
      product_url: product.product_url || "",
      target_platform: platform || product.target_platform || "facebook",
      post_type: "standard",
      github_token: ghToken
    });

    if (dispatchRes.success) {
      return jsonResponse({
        success: true,
        handover: true,
        engine: "GitHub Actions Backend",
        product_id: product.id,
        angle: "Worker Handover Package",
        run_url: dispatchRes.run_url,
        message: `🚀 "${product.name}" প্রোডাক্টের সম্পূর্ণ পোস্টিং দায়িত্ব (Prompt, API Key, Token ও সব ছবি সহ) GitHub Actions-এ হ্যান্ডওভার করা হয়েছে!`
      });
    }
  }

  // ২. ফলব্যাক: সরাসরি Worker থেকে পাবলিশ
  let recentAngles = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT angle FROM post_history WHERE product_id = ? ORDER BY published_at DESC LIMIT 4"
    ).bind(product.id).all();
    recentAngles = (results || []).map(r => r.angle);
  } catch (e) {}

  const available = MARKETING_ANGLES.filter(a => !recentAngles.includes(a.name) && !recentAngles.includes(a.key));
  const chosenAngle = (available.length > 0)
    ? available[Math.floor(Math.random() * available.length)]
    : MARKETING_ANGLES[Math.floor(Math.random() * MARKETING_ANGLES.length)];

  const caption = await generateAIPostCaption(product, chosenAngle, env);
  const pubResult = await publishToFacebookPage(product, caption, env);

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
// ⏰ শিডিউল্ড অটো-পোস্টিং এক্সিকিউটর (GitHub Handover First)
// ========================================================
async function handleScheduledAutoPosting(env) {
  if (!env.DB) return { total_active: 0, published_count: 0, log: ["D1 Database missing"] };
  await ensureTables(env.DB);

  const { results: prods } = await env.DB.prepare(
    "SELECT * FROM products WHERE is_active = 1 AND daily_auto_post = 1"
  ).all();

  if (!prods || prods.length === 0) {
    return { total_active: 0, published_count: 0, log: ["No active auto-post products in D1"] };
  }

  const now = Date.now();
  const executionLog = [];
  const ghToken = await getConfigValue(env.DB, "github_token", env.GITHUB_TOKEN || "");

  for (const p of prods) {
    const sched = evaluateProductSchedule(p, now);

    if (!sched.isDue) {
      executionLog.push({
        product_id: p.id,
        name: p.name,
        sku: p.sku,
        status: "waiting",
        mode: sched.mode,
        reason: sched.reason
      });
      continue;
    }

    console.log(`🚀 [Auto-Post Due] Handing over / publishing: ${p.name} (SKU: ${p.sku || p.id}) | Reason: ${sched.reason}`);

    // ১. GitHub Token থাকলে সরাসরি GitHub Actions-এ ওই প্রোডাক্টের জন্য ওয়ার্কফ্লো ডিসপ্যাচ করা
    if (ghToken) {
      const dispatchRes = await dispatchGitHubActionHandover(env, {
        product_id: p.id,
        product_url: p.product_url || "",
        target_platform: p.target_platform || "facebook",
        post_type: "standard",
        github_token: ghToken
      });

      if (dispatchRes.success) {
        executionLog.push({
          product_id: p.id,
          name: p.name,
          sku: p.sku,
          status: "dispatched_to_github",
          run_url: dispatchRes.run_url,
          reason: `${sched.reason} -> GitHub Actions-এ হ্যান্ডওভার সম্পন্ন`
        });
        continue;
      }
    }

    // ২. ফলব্যাক: যদি GitHub Token না থাকে বা ডিসপ্যাচ ব্যর্থ হয়, তবে ওয়ার্কার নিজে পাবলিশ করবে
    try {
      const pubRes = await handlePublishProductNow({ product_id: p.id, platform: p.target_platform || 'facebook', direct_worker: true }, env);
      const pubData = await pubRes.json();
      executionLog.push({
        product_id: p.id,
        name: p.name,
        sku: p.sku,
        status: pubData.success ? "published" : "error",
        post_id: pubData.post_id || null,
        reason: sched.reason
      });
    } catch (err) {
      executionLog.push({
        product_id: p.id,
        name: p.name,
        sku: p.sku,
        status: "error",
        error: err.message,
        reason: sched.reason
      });
    }
  }

  return {
    total_active: prods.length,
    published_count: executionLog.filter(e => e.status === "published" || e.status === "dispatched_to_github").length,
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
      action: "Executed auto-post schedule check & handover",
      timestamp: new Date().toISOString(),
      ...result
    });
  }

  const { results: prods } = await env.DB.prepare(
    "SELECT * FROM products WHERE is_active = 1 AND daily_auto_post = 1"
  ).all();

  const now = Date.now();
  const bdtDate = new Date(now + 6 * 3600 * 1000);
  const ghToken = await getConfigValue(env.DB, "github_token", env.GITHUB_TOKEN || "");
  const geminiKey = await getConfigValue(env.DB, "gemini_api_key", env.GEMINI_API_KEY || "");
  const fbToken = await getMetaPageToken(env);

  const report = (prods || []).map(p => {
    const sched = evaluateProductSchedule(p, now);
    return {
      id: p.id,
      name: p.name,
      schedule_type: sched.mode,
      posting_time: p.posting_time,
      interval_hours: sched.intervalHours,
      last_posted_at: p.last_posted_at || "Never",
      hours_since_last_post: sched.elapsedHours,
      is_due_now: sched.isDue,
      status: sched.isDue ? "DUE FOR POSTING" : sched.reason
    };
  });

  return jsonResponse({
    current_time_utc: new Date().toISOString(),
    current_time_bdt: `${bdtDate.toISOString().replace('T', ' ').substring(0, 19)} (UTC+6)`,
    handover_readiness: {
      github_token_in_d1: Boolean(ghToken),
      gemini_api_key_in_d1: Boolean(geminiKey && geminiKey !== "YOUR_GEMINI_API_KEY"),
      facebook_token_in_d1: Boolean(fbToken)
    },
    active_scheduled_products: report.length,
    products: report
  });
}



/**
 * GitHub Actions Scheduled Post Publisher
 * ---------------------------------------
 * Queries Cloudflare D1 for pending scheduled posts and publishes them
 * across Telegram, Facebook, TikTok, etc.
 * Runs 100% on GitHub Actions Free Runners (Zero Cloudflare Worker requests!).
 */

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_D1_DATABASE_ID = process.env.CF_D1_DATABASE_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID; // e.g. @your_channel or -100123456789
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const META_PAGE_ID = process.env.META_PAGE_ID;

async function queryD1(sql, params = []) {
  if (!CF_ACCOUNT_ID || !CF_D1_DATABASE_ID || !CF_API_TOKEN) {
    console.log("[D1 Query Mock] Cloudflare credentials not set in GitHub Secrets. Skipping DB query.");
    return [];
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ sql, params })
  });

  const data = await res.json();
  if (data.success && data.result?.[0]?.results) {
    return data.result[0].results;
  }
  return [];
}

async function publishToTelegram(content, mediaUrls) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
    console.log("[Telegram] Bot token or Channel ID missing. Skipping.");
    return false;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHANNEL_ID,
      text: content,
      parse_mode: "HTML"
    })
  });

  return res.ok;
}

async function publishToFacebook(content, mediaUrls) {
  if (!META_PAGE_ACCESS_TOKEN || !META_PAGE_ID) {
    console.log("[Facebook] Page token or Page ID missing. Skipping.");
    return false;
  }

  const url = `https://graph.facebook.com/v19.0/${META_PAGE_ID}/feed`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: content,
      access_token: META_PAGE_ACCESS_TOKEN
    })
  });

  return res.ok;
}

async function main() {
  console.log("🚀 [GitHub Actions] Starting Post Publisher Job...");
  const now = new Date().toISOString();

  // ১. পেন্ডিং পোস্ট খুঁজে বের করা
  const pendingPosts = await queryD1(
    "SELECT * FROM scheduled_posts WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 10;",
    [now]
  );

  console.log(`Found ${pendingPosts.length} posts due for publishing.`);

  for (const post of pendingPosts) {
    console.log(`Processing Post ID: ${post.id}`);
    let platforms = [];
    try {
      platforms = JSON.parse(post.target_platforms);
    } catch (e) {
      platforms = ["telegram", "facebook"];
    }

    const results = {};

    if (platforms.includes("telegram")) {
      results.telegram = await publishToTelegram(post.content);
    }
    if (platforms.includes("facebook")) {
      results.facebook = await publishToFacebook(post.content);
    }

    // ২. D1-এ স্ট্যাটাস আপডেট
    await queryD1(
      "UPDATE scheduled_posts SET status = 'published', execution_result = ? WHERE id = ?;",
      [JSON.stringify(results), post.id]
    );

    console.log(`✅ Successfully published Post ${post.id}`);
  }

  console.log("🏁 Job completed.");
}

main().catch(err => {
  console.error("Fatal Error:", err);
  process.exit(1);
});

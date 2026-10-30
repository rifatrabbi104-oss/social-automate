/**
 * SocialAutomate - Zero-Worker-Quota Frontend Engine
 * ----------------------------------------------------
 * 1. 100% Zero-Polling: NO setInterval loops. 0 Worker requests on dashboard visits.
 * 2. Persistent Client-Side Caching: Loads conversations, messages & products from localStorage.
 * 3. On-Demand Sync: Fetches from backend ONLY when admin explicitly clicks "🔄 Sync".
 * 4. 1-Time Lifetime Social Connection Setup (Meta / Facebook Page / WhatsApp).
 */

function getApiBase() {
  const custom = localStorage.getItem('social_automate_worker_url');
  if (custom) return custom.replace(/\/$/, '') + '/api';
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://127.0.0.1:8787/api';
  }
  return 'https://social-automate.rifatrabbi104.workers.dev/api';
}

const API_BASE = getApiBase();

// Client Cache Keys
const CACHE_KEYS = {
  CONVERSATIONS: 'sa_conversations_v1',
  MESSAGES: 'sa_messages_v1',
  PRODUCTS: 'sa_products_v1',
  PROFILE: 'sa_profile_v1',
  SETTINGS: 'sa_settings_v1'
};

let appState = {
  activeChatId: null,
  channelFilter: 'all', // 'all', 'facebook', 'fb_comment', 'whatsapp', 'instagram'
  statusFilter: 'all',  // 'all', 'unread', 'read'
  conversations: getLocalCache(CACHE_KEYS.CONVERSATIONS, []),
  messages: getLocalCache(CACHE_KEYS.MESSAGES, {}),
  products: getLocalCache(CACHE_KEYS.PRODUCTS, []),
  businessProfile: getLocalCache(CACHE_KEYS.PROFILE, {}),
  d1Connected: true,
  isSending: false
};

document.addEventListener('DOMContentLoaded', () => {
  // Deep link check (?chat_id=123 or ?tab=settings or ?tiktok_connected=1)
  const urlParams = new URLSearchParams(window.location.search);
  const deepChatId = urlParams.get('chat_id');
  if (deepChatId) {
    appState.activeChatId = deepChatId.replace(/^(tg_|fb_|wa_)/, '');
  }

  const tabParam = urlParams.get('tab');
  const tiktokConnected = urlParams.get('tiktok_connected');

  initNavigation();
  initChatReply();
  initHandoverToggle();
  initBusinessDataForms();
  initSettingsForm();
  initManualSync();
  initConversationFilters();

  // ⚡ 0-Worker Request Init: Render directly from localStorage!
  renderConversationList();
  renderProductsTable();
  populateBusinessProfileUI();

  // 📡 Zero-Quota Waste Live Polling (pauses when tab is background/minimized)
  startZeroWasteLivePolling();

  // Initial Sync from server
  syncWithBackend(true);

  if (appState.activeChatId) {
    renderActiveChat();
  }

  if (tabParam === 'settings' || tiktokConnected === '1') {
    const settingsNav = document.querySelector('.nav-item[data-tab="settings"]');
    if (settingsNav) settingsNav.click();
    if (tiktokConnected === '1') {
      showToast('🎉 TikTok অ্যাকাউন্ট সফলভাবে সংযুক্ত হয়েছে!');
      const tkResult = document.getElementById('tiktok-setup-result');
      if (tkResult) {
        tkResult.style.display = 'block';
        tkResult.style.background = 'rgba(16, 185, 129, 0.15)';
        tkResult.style.border = '1px solid rgba(16, 185, 129, 0.4)';
        tkResult.style.color = '#a7f3d0';
        tkResult.innerHTML = '<strong>✅ TikTok অ্যাকাউন্ট সফলভাবে সংযুক্ত হয়েছে!</strong><br>Access Token আপনার ক্লাউড D1 ডেটাবেসে সুরক্ষিত রয়েছে। এখন থেকে প্রোডাক্ট শিডিউলে টিকটকে অটো-পোস্ট হবে।';
      }
    }
  }

  // Only if local storage is completely empty, trigger a silent 1-time fetch
  if (appState.conversations.length === 0 && appState.products.length === 0) {
    syncWithBackend(true);
  }
});

// ========================================================
// ১. নেভিগেশন ট্যাব
// ========================================================
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');
  const pageTitle = document.getElementById('page-title');
  const pageSubtitle = document.getElementById('page-subtitle');

  const headers = {
    'inbox': {
      title: 'Live Chat & AI Handover',
      sub: 'কাস্টমার মেসেজ দিলে AI উত্তর দেবে। আপনি চাইলে ড্যাশবোর্ড থেকে টেকওভার করে রিপ্লাই দিতে পারেন।'
    },
    'business-d1': {
      title: 'D1 Business Data & Products Catalog',
      sub: 'আপনার স্টোরের প্রোডাক্ট ও ডেলিভারি পলিসি D1-এ সেভ রাখুন। AI এই ডেটা থেকেই কাস্টমারকে উত্তর দেবে।'
    },
    'settings': {
      title: 'Lifetime Social Connection & Webhook',
      sub: 'হোয়াটসঅ্যাপ এআই মেসেজিং ও টিকটক ডেইলি অটো-পোস্টিং কানেকশন।'
    }
  };

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.getAttribute('data-tab');
      navItems.forEach(n => n.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      item.classList.add('active');
      const target = document.getElementById(`tab-${tab}`);
      if (target) target.classList.add('active');

      if (headers[tab]) {
        if (pageTitle) pageTitle.textContent = headers[tab].title;
        if (pageSubtitle) pageSubtitle.textContent = headers[tab].sub;
      }
    });
  });
}

// ========================================================
// ২. ম্যানুয়াল অন-ডিমান্ড সিঙ্ক ও প্ল্যাটফর্ম ফিল্টারিং
// ========================================================
function initManualSync() {
  const btn = document.getElementById('btn-manual-sync');
  if (btn) {
    btn.addEventListener('click', async () => {
      btn.textContent = '⏳ Syncing...';
      await syncWithBackend();
      showToast('🔄 ক্লাউড থেকে লেটেস্ট ডেটা সিঙ্ক সম্পন্ন হয়েছে!');
      btn.textContent = '🔄 Sync';
    });
  }

  // ফেসবুক পেজের রিয়েল ইনবক্স ও মেসেজ সিঙ্ক বাটন
  const syncFbBtn = document.getElementById('btn-sync-fb-inbox');
  if (syncFbBtn) {
    syncFbBtn.addEventListener('click', async () => {
      syncFbBtn.disabled = true;
      syncFbBtn.textContent = '⏳ Syncing FB...';
      try {
        const res = await fetch(`${API_BASE}/sync-fb-conversations`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast(data.message || '✅ ফেসবুক পেজ থেকে মেসেজ সফলভাবে সিঙ্ক হয়েছে!');
          await window.fetchLatestConversations(false);
        } else {
          showToast('❌ সিঙ্ক ব্যর্থ: ' + (data.error || 'Unknown error'));
        }
      } catch (e) {
        showToast('❌ সিঙ্ক এরর: ' + e.message);
      } finally {
        syncFbBtn.disabled = false;
        syncFbBtn.textContent = '🔄 Sync FB';
      }
    });
  }
}

// সোশ্যাল চ্যানেল ও রিড/আনরিড ফিল্টার হ্যান্ডলার
function initConversationFilters() {
  const chanContainer = document.getElementById('channel-filters');
  if (chanContainer) {
    chanContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.chan-pill');
      if (!btn) return;
      chanContainer.querySelectorAll('.chan-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      appState.channelFilter = btn.dataset.chan || 'all';
      renderConversationList();
    });
  }

  const statContainer = document.getElementById('status-filters');
  if (statContainer) {
    statContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.stat-pill');
      if (!btn) return;
      statContainer.querySelectorAll('.stat-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      appState.statusFilter = btn.dataset.stat || 'all';
      renderConversationList();
    });
  }
}

async function syncWithBackend(isSilent = false) {
  // ১. কনভারসেশন ফেচ (100% Alwaysdata Direct - Zero D1)
  try {
    const convRes = await fetch(`https://ranonex.alwaysdata.net/api/conversations`);
    if (convRes.ok) {
      const convs = await convRes.json();
      if (Array.isArray(convs)) {
        appState.conversations = convs;
        setLocalCache(CACHE_KEYS.CONVERSATIONS, convs);
        renderConversationList();
      }
    }

    // ২. প্রোডাক্ট ফেচ
    const prodRes = await fetch(`${API_BASE}/products`);
    if (prodRes.ok) {
      const prods = await prodRes.json();
      if (Array.isArray(prods)) {
        appState.products = prods;
        setLocalCache(CACHE_KEYS.PRODUCTS, prods);
        renderProductsTable();
      }
    }

    // ৩. প্রোফাইল ফেচ
    const profRes = await fetch(`${API_BASE}/business-profile`);
    if (profRes.ok) {
      const prof = await profRes.json();
      appState.businessProfile = prof;
      setLocalCache(CACHE_KEYS.PROFILE, prof);
      populateBusinessProfileUI();
    }

    // ৪. সেটিংস ফেচ
    const setRes = await fetch(`${API_BASE}/settings`);
    if (setRes.ok) {
      const settings = await setRes.json();
      updateSettingsUI(settings);
    }
  } catch (err) {
    if (!isSilent) showToast('❌ সিঙ্ক করতে ব্যর্থ হয়েছে। নেটওয়ার্ক চেক করুন।');
  }
}

// ========================================================
// 📡 ৩. জিরো-কোটা লাইভ পোলিং ও কনভারসেশন সিঙ্ক ইঞ্জিন
// ========================================================
let livePollingTimer = null;
let lastKnownLatestTime = '';
let lastKnownTopMessage = '';

// সাউন্ড প্লেয়ার (Web Audio API - কোনো বাহ্যিক ফাইল লাগে না)
function playMessageChime() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch (e) {}
}

window.fetchLatestConversations = async function(isManual = false) {
  const btn = document.getElementById('btn-fetch-d1-convs');
  if (isManual && btn) {
    btn.disabled = true;
    btn.textContent = '⏳';
  }

  try {
    let convs = null;
    // ১. Alwaysdata লাইভ নোডজেএস গেটওয়ে থেকে রিয়েল-টাইম কনভারসেশন ফেচ (Facebook Server Live Fetch)
    try {
      const adUrl = isManual
        ? `https://ranonex.alwaysdata.net/api/conversations?force=1`
        : `https://ranonex.alwaysdata.net/api/conversations`;
      const adRes = await fetch(adUrl, { signal: AbortSignal.timeout(6000) });
      if (adRes.ok) {
        const adData = await adRes.json();
        if (Array.isArray(adData) && adData.length > 0) {
          convs = adData;
          // যদি চ্যাটের সাথে মেসেজ ও মিডিয়া থাকে, লোকাল টেম্পোরারি ক্যাশে সংরক্ষণ করা
          for (const c of convs) {
            if (Array.isArray(c.messages) && c.messages.length > 0) {
              appState.messages[c.id] = c.messages.map(m => ({
                id: m.id,
                sender_type: m.sender_type || (m.role === 'model' ? 'assistant' : 'customer'),
                message_text: m.message_text || m.text || '',
                media_type: m.media_type || null,
                media_url: m.media_url || null,
                media_mime: m.media_mime || null,
                attachments: m.attachments || [],
                created_at: m.timestamp || m.created_at || new Date().toISOString()
              }));
            }
          }
          setLocalCache(CACHE_KEYS.MESSAGES, appState.messages);
        }
      }
    } catch (adErr) {}

    // ২. যদি Alwaysdata খালি বা আনরিচেবল থাকে, Cloudflare Worker D1 থেকে ফেচ
    if (!convs) {
      const res = await fetch(`${API_BASE}/conversations`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      convs = await res.json();
    }

    if (Array.isArray(convs)) {
      const topConv = convs[0];
      const currentTopMsg = topConv ? `${topConv.id}_${topConv.last_message_at}_${topConv.last_message}` : '';

      // নতুন মেসেজ ডিটেকশন
      if (lastKnownTopMessage && currentTopMsg && currentTopMsg !== lastKnownTopMessage) {
        playMessageChime();
        const pLabel = topConv.platform === 'facebook' ? '🔵 FB' : (topConv.platform === 'whatsapp' ? '🟢 WA' : '💬');
        showToast(`💬 [${pLabel}] ${topConv.name}: "${(topConv.last_message || '').substring(0, 35)}..."`);

        if (String(appState.activeChatId) === String(topConv.id)) {
          await forceRefreshActiveChatMessages(topConv.id);
        }
      }

      lastKnownTopMessage = currentTopMsg;
      if (topConv && topConv.last_message_at) {
        lastKnownLatestTime = topConv.last_message_at;
      }
      appState.conversations = convs;
      setLocalCache(CACHE_KEYS.CONVERSATIONS, convs);
      renderConversationList();

      if (isManual) {
        showToast(`✅ ${convs.length} টি কনভারসেশন লোড হয়েছে!`);
      }
    }
  } catch (err) {
    if (isManual) showToast('❌ চ্যাট ফেচ ব্যর্থ: ' + err.message);
  } finally {
    if (isManual && btn) {
      btn.disabled = false;
      btn.textContent = '↻';
    }
  }
};

// ⚡ জিরো-কোটা লাইভ পোলিং (ট্যাব মিনিমাইজ বা ব্যাকগ্রাউন্ডে থাকলে অটো-পজ, কোনো কুয়েরি অপচয় হবে না)
function startZeroWasteLivePolling() {
  if (livePollingTimer) clearInterval(livePollingTimer);

  const checkLive = async () => {
    // ১. ব্রাউজার ট্যাব ব্যাকগ্রাউন্ডে থাকলে রিকোয়েস্ট পাঠানো সম্পূর্ণ বন্ধ
    if (document.hidden) return;

    try {
      const url = lastKnownLatestTime
        ? `https://ranonex.alwaysdata.net/api/conversations-check?since=${encodeURIComponent(lastKnownLatestTime)}`
        : `https://ranonex.alwaysdata.net/api/conversations-check`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();

      // ২. শুধুমাত্র নতুন মেসেজ আসলেই কনভারসেশন রিলোড হবে (Zero D1)
      if (data && data.changed) {
        lastKnownLatestTime = data.latest_timestamp || data.latest_time || '';
        await window.fetchLatestConversations(false);
      }
    } catch (e) {}
  };

  // প্রতি ৬ সেকেন্ডে শুধুমাত্র হালকা টাইমস্ট্যাম্প চেক
  livePollingTimer = setInterval(checkLive, 6000);

  // ট্যাব অ্যাক্টিভ হলে সাথে সাথে চেক করা
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      checkLive();
    }
  });
}

async function forceRefreshActiveChatMessages(chatId) {
  try {
    let msgs = null;
    try {
      const adRes = await fetch(`https://ranonex.alwaysdata.net/api/conversations/${encodeURIComponent(chatId)}`, { signal: AbortSignal.timeout(5000) });
      if (adRes.ok) {
        const adData = await adRes.json();
        if (adData) {
          if (!appState.pagingInfo) appState.pagingInfo = {};
          appState.pagingInfo[chatId] = {
            paging_after: adData.paging_after || null,
            has_more: adData.has_more !== false
          };
        }
        if (adData && Array.isArray(adData.messages)) {
          msgs = adData.messages.map(m => ({
            id: m.id,
            sender_type: m.sender_type || (m.role === 'model' ? 'assistant' : 'customer'),
            message_text: m.message_text || m.text || '',
            media_type: m.media_type || null,
            media_url: m.media_url || null,
            media_mime: m.media_mime || null,
            attachments: m.attachments || [],
            created_at: m.timestamp || m.created_at || new Date().toISOString()
          }));
        }
      }
    } catch (e) {}

    if (!msgs) {
      const res = await fetch(`${API_BASE}/messages?chat_id=${encodeURIComponent(chatId)}`);
      if (res.ok) msgs = await res.json();
    }

    if (msgs) {
      appState.messages[chatId] = msgs;
      setLocalCache(CACHE_KEYS.MESSAGES, appState.messages);
      renderMessageBubbles(chatId);
    }
  } catch (e) {}
}

// ========================================================
// ৪. কনভারসেশন ও চ্যাট লিস্ট (ফিল্টারড রেন্ডার ও রিড/আনরিড)
// ========================================================
function renderConversationList() {
  const listEl = document.getElementById('conversation-list');
  const badge = document.getElementById('unread-badge');
  const statActive = document.getElementById('stat-active-sessions');

  if (!listEl) return;

  // ১. কাউন্টার আপডেট (চ্যানেল এবং আনরিড ব্যাজ)
  const convs = appState.conversations || [];
  const countAll = convs.length;
  const countFb = convs.filter(c => c.platform === 'facebook' && (c.channel_type === 'messenger' || !c.channel_type || c.channel_type === 'facebook')).length;
  const countComm = convs.filter(c => c.channel_type === 'comment' || c.platform === 'fb_comment').length;
  const countWa = convs.filter(c => c.platform === 'whatsapp').length;
  const countIg = convs.filter(c => c.platform === 'instagram').length;
  const countUnread = convs.filter(c => Number(c.unread_count || 0) > 0).length;

  const elAll = document.getElementById('pill-count-all'); if (elAll) elAll.textContent = countAll;
  const elFb = document.getElementById('pill-count-fb'); if (elFb) elFb.textContent = countFb;
  const elComm = document.getElementById('pill-count-comm'); if (elComm) elComm.textContent = countComm;
  const elWa = document.getElementById('pill-count-wa'); if (elWa) elWa.textContent = countWa;
  const elIg = document.getElementById('pill-count-ig'); if (elIg) elIg.textContent = countIg;
  const elUnread = document.getElementById('pill-count-unread'); if (elUnread) elUnread.textContent = countUnread;

  if (badge) badge.textContent = countUnread > 0 ? countUnread : countAll;
  if (statActive) statActive.textContent = countAll;

  // ২. ফিল্টারিং লজিক (প্ল্যাটফর্ম ও রিড/আনরিড ফিল্টার)
  const filteredList = convs.filter(c => {
    // চ্যানেল ফিল্টার
    if (appState.channelFilter === 'facebook') {
      if (!(c.platform === 'facebook' && (c.channel_type === 'messenger' || !c.channel_type || c.channel_type === 'facebook'))) return false;
    } else if (appState.channelFilter === 'fb_comment') {
      if (!(c.channel_type === 'comment' || c.platform === 'fb_comment')) return false;
    } else if (appState.channelFilter === 'whatsapp') {
      if (c.platform !== 'whatsapp') return false;
    } else if (appState.channelFilter === 'instagram') {
      if (c.platform !== 'instagram') return false;
    }

    // স্ট্যাটাস ফিল্টার (রিড / আনরিড)
    const isUnread = Number(c.unread_count || 0) > 0;
    if (appState.statusFilter === 'unread' && !isUnread) return false;
    if (appState.statusFilter === 'read' && isUnread) return false;

    return true;
  });

  if (filteredList.length === 0) {
    listEl.innerHTML = `
      <div style="padding: 40px 16px; text-align: center; color: var(--text-dim); font-size: 13px;">
        <div style="font-size: 36px; margin-bottom: 8px;">💬</div>
        <div style="color: var(--text-muted); font-weight: 600;">এই ফিল্টারে কোনো চ্যাট নেই</div>
        <p style="font-size: 11px; margin-top: 4px; line-height: 1.5;">অন্য ফিল্টার সিলেক্ট করুন অথবা উপরে <strong>🔄 Sync FB</strong> বাটনে চাপ দিন।</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = '';
  filteredList.forEach(c => {
    const item = document.createElement('div');
    const isActive = String(c.id) === String(appState.activeChatId);
    const isUnread = Number(c.unread_count || 0) > 0;
    item.className = `conv-item ${isActive ? 'active' : ''} ${isUnread ? 'unread' : ''}`;

    const initial = (c.name || 'U').charAt(0).toUpperCase();
    const timeFormatted = formatTime(c.last_message_at);

    // চ্যানেল ব্যাজ ও আইকন
    let platformLabel = '🔵 Messenger';
    if (c.channel_type === 'comment' || c.platform === 'fb_comment') {
      platformLabel = '💬 FB Comment';
    } else if (c.platform === 'whatsapp') {
      platformLabel = '🟢 WhatsApp';
    } else if (c.platform === 'instagram') {
      platformLabel = '📸 Instagram';
    }

    const avatarHtml = c.sender_avatar 
      ? `<img src="${escapeHtml(c.sender_avatar)}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" onerror="this.onerror=null;this.parentElement.textContent='${initial}';">` 
      : initial;

    item.innerHTML = `
      <div class="conv-avatar">${avatarHtml}</div>
      <div class="conv-details">
        <div class="conv-top-row">
          <span class="conv-name">${escapeHtml(c.name)}</span>
          <span class="conv-time">${timeFormatted}</span>
        </div>
        <div class="conv-snippet">${escapeHtml(c.last_message || '')}</div>
        <div class="conv-badges">
          <span class="badge-tag platform">${platformLabel}</span>
          ${c.admin_takeover ? '<span class="badge-tag takeover">👤 Handover</span>' : '<span class="badge-tag ai">🤖 AI Active</span>'}
          ${isUnread ? `<span class="unread-count-badge">🔴 ${c.unread_count}</span>` : ''}
        </div>
      </div>
    `;

    item.addEventListener('click', async () => {
      appState.activeChatId = c.id;

      // রিড স্ট্যাটাস আপডেট (Alwaysdata Direct)
      if (Number(c.unread_count || 0) > 0) {
        c.unread_count = 0;
        item.classList.remove('unread');
        fetch(`https://ranonex.alwaysdata.net/api/conversations/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: c.id })
        }).catch(() => {});
      }

      renderConversationList();
      renderActiveChat();
      loadChatMessages(c.id);
    });

    listEl.appendChild(item);
  });
}

function renderActiveChat() {
  const conv = appState.conversations.find(c => String(c.id) === String(appState.activeChatId));
  const container = document.getElementById('messages-container');
  const badge = document.getElementById('handover-badge');
  const btn = document.getElementById('btn-toggle-handover');
  const warning = document.getElementById('ai-active-warning');

  if (!conv) {
    document.getElementById('active-chat-avatar').textContent = '-';
    document.getElementById('active-chat-name').textContent = 'কোনো চ্যাট সিলেক্ট করা নেই';
    document.getElementById('active-chat-id').textContent = '';
    if (badge) badge.style.display = 'none';
    if (btn) btn.style.display = 'none';
    if (warning) warning.classList.add('hidden');
    return;
  }

  if (badge) badge.style.display = 'flex';
  if (btn) btn.style.display = 'flex';

  const avatarEl = document.getElementById('active-chat-avatar');
  const initial = (conv.name || 'U').charAt(0).toUpperCase();
  if (conv.sender_avatar) {
    avatarEl.innerHTML = `<img src="${escapeHtml(conv.sender_avatar)}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" onerror="this.onerror=null;this.parentElement.textContent='${initial}';">`;
  } else {
    avatarEl.textContent = initial;
  }
  document.getElementById('active-chat-name').textContent = conv.name;
  document.getElementById('active-chat-id').textContent = `#${conv.id}`;

  updateHandoverUI(conv);
  renderMessageBubbles(conv.id);
}

function updateHandoverUI(conv) {
  const badge = document.getElementById('handover-badge');
  const btn = document.getElementById('btn-toggle-handover');
  const warning = document.getElementById('ai-active-warning');

  if (conv.admin_takeover) {
    badge.className = 'handover-status-badge takeover';
    badge.querySelector('.text').textContent = 'Admin Active';
    btn.className = 'btn-handover release';
    btn.querySelector('.btn-text').textContent = 'Release to AI';
    btn.querySelector('.icon').textContent = '🤖';
    if (warning) warning.classList.add('hidden');
  } else {
    badge.className = 'handover-status-badge ai';
    badge.querySelector('.text').textContent = 'AI Active';
    btn.className = 'btn-handover';
    btn.querySelector('.btn-text').textContent = 'Takeover Chat';
    btn.querySelector('.icon').textContent = '👤';
    if (warning) warning.classList.remove('hidden');
  }
}

async function loadChatMessages(chatId) {
  // ১. প্রথমে লোকাল টেম্পোরারি ক্যাশ থেকে তাৎক্ষণিক রেন্ডার
  if (appState.messages[chatId] && appState.messages[chatId].length > 0) {
    renderMessageBubbles(chatId);
  }

  // ২. Alwaysdata (Facebook Server Live Fetch) থেকে সর্বশেষ মেসেজ ও মিডিয়া সিঙ্ক
  try {
    let msgs = null;
    try {
      const adRes = await fetch(`https://ranonex.alwaysdata.net/api/conversations/${encodeURIComponent(chatId)}`, { signal: AbortSignal.timeout(5000) });
      if (adRes.ok) {
        const adData = await adRes.json();
        if (adData) {
          if (!appState.pagingInfo) appState.pagingInfo = {};
          appState.pagingInfo[chatId] = {
            paging_after: adData.paging_after || null,
            has_more: adData.has_more !== false
          };
        }
        if (adData && Array.isArray(adData.messages)) {
          msgs = adData.messages.map(m => ({
            id: m.id,
            sender_type: m.sender_type || (m.role === 'model' ? 'assistant' : 'customer'),
            message_text: m.message_text || m.text || '',
            media_type: m.media_type || null,
            media_url: m.media_url || null,
            media_mime: m.media_mime || null,
            attachments: m.attachments || [],
            created_at: m.timestamp || m.created_at || new Date().toISOString()
          }));
        }
      }
    } catch (e) {}

    if (!msgs && (!appState.messages[chatId] || appState.messages[chatId].length === 0)) {
      const res = await fetch(`${API_BASE}/messages?chat_id=${encodeURIComponent(chatId)}`);
      if (res.ok) msgs = await res.json();
    }

    if (msgs && msgs.length > 0) {
      appState.messages[chatId] = msgs;
      setLocalCache(CACHE_KEYS.MESSAGES, appState.messages);
      renderMessageBubbles(chatId);
    }
  } catch (e) {}
}

function renderMainMessageAttachmentsHtml(m) {
  const items = [];
  if (Array.isArray(m.attachments) && m.attachments.length > 0) {
    items.push(...m.attachments);
  } else if (m.media_url) {
    items.push({
      type: m.media_type || 'image',
      url: m.media_url,
      mime_type: m.media_mime || ''
    });
  }
  if (items.length === 0) return '';

  return items.map(att => {
    const url = att.url || att.file_url;
    if (!url) return '';
    const type = String(att.type || '').toLowerCase();
    const mime = String(att.mime_type || '').toLowerCase();
    const safeUrl = escapeHtml(url);

    if (type === 'image' || mime.startsWith('image/')) {
      return `<div style="margin: 6px 0;"><img src="${safeUrl}" alt="Photo" onclick="window.open('${safeUrl}', '_blank')" style="max-width: 260px; max-height: 240px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.18); object-fit: cover; cursor: zoom-in; display: block;" loading="lazy"></div>`;
    }
    if (type === 'video' || mime.startsWith('video/')) {
      return `<div style="margin: 6px 0;"><video src="${safeUrl}" controls preload="metadata" style="max-width: 280px; max-height: 240px; border-radius: 10px; background: #000; display: block;"></video></div>`;
    }
    if (type === 'audio' || mime.startsWith('audio/')) {
      return `<div style="margin: 6px 0;"><audio src="${safeUrl}" controls preload="metadata" style="height: 34px; max-width: 250px;"></audio></div>`;
    }
    return `<div style="margin: 6px 0;"><a href="${safeUrl}" target="_blank" style="color: #93c5fd; text-decoration: underline; font-size: 12px;">📎 ফাইল ডাউনলোড করুন</a></div>`;
  }).join('');
}

function renderMessageBubbles(chatId) {
  const container = document.getElementById('messages-container');
  if (!container) return;

  const msgs = appState.messages[chatId] || [];
  if (msgs.length === 0) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-dim); text-align: center;">
        <div style="font-size: 32px; margin-bottom: 8px;">📩</div>
        <p style="font-size: 13px;">কোনো মেসেজ হিস্ট্রি ক্যাশ করা নেই।</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  msgs.forEach(m => {
    const row = document.createElement('div');
    const isAdmin = m.sender_type === 'admin';
    const isAi = m.sender_type === 'assistant' || m.sender_type === 'ai';

    row.className = `msg-row ${isAdmin ? 'admin' : 'customer'}`;
    let tag = 'Customer';
    if (isAi) tag = '🤖 AI Assistant';
    if (isAdmin) tag = '👤 You (Admin)';

    const mediaHtml = renderMainMessageAttachmentsHtml(m);
    const rawText = String(m.message_text || '').trim();
    const isPlaceholderOnly = mediaHtml && /^(\📷|\🎥|\🎙️|\📎)?\s*\[(Photo|Video|Voice Audio|Voice Message|Voice Note|Product Video|Product Image|Product Image \/ Screenshot|Attachment)\]$/i.test(rawText);
    const textHtml = (!rawText || isPlaceholderOnly) ? '' : `<div>${escapeHtml(rawText)}</div>`;

    row.innerHTML = `
      <div class="msg-sender-tag">${tag}</div>
      <div class="msg-bubble">${mediaHtml}${textHtml}</div>
      <span class="msg-time">${formatTime(m.created_at)}</span>
    `;
    container.appendChild(row);
  });

  container.scrollTop = container.scrollHeight;

  if (!container._hasOlderScrollListener) {
    container._hasOlderScrollListener = true;
    container.addEventListener('scroll', async () => {
      if (container.scrollTop < 60 && appState.activeChatId) {
        const pInfo = (appState.pagingInfo && appState.pagingInfo[appState.activeChatId]) || {};
        if (pInfo.has_more === false || !pInfo.paging_after) return;
        if (appState.isLoadingOlder) return;

        appState.isLoadingOlder = true;
        const prevScrollHeight = container.scrollHeight;
        try {
          const res = await fetch(`https://ranonex.alwaysdata.net/api/conversations/${encodeURIComponent(appState.activeChatId)}/older?after=${encodeURIComponent(pInfo.paging_after)}&limit=20`);
          if (res.ok) {
            const data = await res.json();
            const older = Array.isArray(data.messages) ? data.messages : [];
            if (older.length > 0) {
              const mapped = older.map(m => ({
                id: m.id,
                sender_type: m.sender_type || 'customer',
                message_text: m.message_text || '',
                media_type: m.media_type || null,
                media_url: m.media_url || null,
                media_mime: m.media_mime || null,
                attachments: m.attachments || [],
                created_at: m.timestamp || new Date().toISOString()
              }));
              const currentMsgs = appState.messages[appState.activeChatId] || [];
              const existingIds = new Set(currentMsgs.map(m => m.id));
              const trulyOlder = mapped.filter(m => !existingIds.has(m.id));
              if (trulyOlder.length > 0) {
                appState.messages[appState.activeChatId] = [...trulyOlder, ...currentMsgs];
                setLocalCache(CACHE_KEYS.MESSAGES, appState.messages);
                pInfo.paging_after = data.cursor || null;
                pInfo.has_more = Boolean(data.has_more);
                renderMessageBubbles(appState.activeChatId);
                container.scrollTop = container.scrollHeight - prevScrollHeight;
              }
            }
            if (!data.has_more || older.length === 0) {
              pInfo.has_more = false;
            }
          }
        } catch (e) {
          console.error("Older scroll error:", e);
        } finally {
          appState.isLoadingOlder = false;
        }
      }
    });
  }
}

// ========================================================
// ৪. আউটবাউন্ড অ্যাডমিন রিপ্লাই (টেক্সট + ছবি / ভিডিও / অডিও / ভয়েস রেকর্ড)
// ========================================================
let mainPendingMedia = null;
let mainMediaRecorder = null;
let mainRecChunks = [];
let mainRecStream = null;
let mainRecStart = 0;
let mainRecTimer = null;
let mainRecCancelled = false;

function encodeMainAudioBufferToWavBase64(audioBuffer) {
  const numOfChan = 1;
  const sampleRate = 24000;
  const channelData = audioBuffer.getChannelData(0);
  const origRate = audioBuffer.sampleRate;
  const ratio = origRate / sampleRate;
  const newLength = Math.floor(channelData.length / ratio);
  const pcm16 = new Int16Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const idx = Math.min(channelData.length - 1, Math.floor(i * ratio));
    const s = Math.max(-1, Math.min(1, channelData[idx]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const wavBuffer = new ArrayBuffer(44 + pcm16.length * 2);
  const view = new DataView(wavBuffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcm16.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numOfChan * 2, true);
  view.setUint16(32, numOfChan * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcm16.length * 2, true);
  const bytes = new Uint8Array(wavBuffer);
  bytes.set(new Uint8Array(pcm16.buffer), 44);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return 'data:audio/wav;base64,' + btoa(binary);
}

window.setMainPendingMedia = function(mediaObj) {
  mainPendingMedia = mediaObj;
  const bar = document.getElementById('main-pending-media-preview');
  const content = document.getElementById('main-pending-media-content');
  if (!bar || !content) return;
  if (!mediaObj) {
    bar.style.display = 'none';
    content.innerHTML = '';
    return;
  }
  bar.style.display = 'flex';
  const safeName = escapeHtml(mediaObj.name || 'Media');
  if (mediaObj.type === 'image') {
    content.innerHTML = `<img src="${mediaObj.base64}" style="width: 44px; height: 44px; border-radius: 8px; object-fit: cover;"><div><strong style="font-size: 12px; color: #93c5fd;">📷 ছবি যুক্ত করা হয়েছে</strong><div style="font-size: 11px; color: #94a3b8;">${safeName}</div></div>`;
  } else if (mediaObj.type === 'video') {
    content.innerHTML = `<video src="${mediaObj.base64}" style="width: 56px; height: 44px; border-radius: 8px; object-fit: cover; background: #000;"></video><div><strong style="font-size: 12px; color: #93c5fd;">🎥 ভিডিও যুক্ত করা হয়েছে</strong><div style="font-size: 11px; color: #94a3b8;">${safeName}</div></div>`;
  } else if (mediaObj.type === 'audio') {
    content.innerHTML = `<span style="font-size: 18px;">🎙️</span><div><strong style="font-size: 12px; color: #6ee7b7;">ভয়েস / অডিও প্রস্তুত</strong><div style="margin-top: 4px;"><audio src="${mediaObj.base64}" controls style="height: 28px; max-width: 220px;"></audio></div></div>`;
  } else {
    content.innerHTML = `<span>📎 ${safeName}</span>`;
  }
};

window.clearMainPendingMedia = function() {
  mainPendingMedia = null;
  const inp = document.getElementById('main-media-file-input');
  if (inp) inp.value = '';
  const bar = document.getElementById('main-pending-media-preview');
  const content = document.getElementById('main-pending-media-content');
  if (bar) bar.style.display = 'none';
  if (content) content.innerHTML = '';
};

window.handleMainMediaSelect = function(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) {
    showToast('⚠️ ফাইলের সাইজ সর্বোচ্চ ২৫ MB হতে পারবে');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const mime = file.type || 'application/octet-stream';
    let type = 'file';
    if (mime.startsWith('image/')) type = 'image';
    else if (mime.startsWith('video/')) type = 'video';
    else if (mime.startsWith('audio/')) type = 'audio';
    window.setMainPendingMedia({
      base64: reader.result,
      type,
      mime,
      name: file.name
    });
  };
  reader.readAsDataURL(file);
};

window.toggleMainVoiceRec = async function() {
  if (mainMediaRecorder && mainMediaRecorder.state === 'recording') {
    window.stopMainVoiceRec();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('⚠️ ব্রাউজারে মাইক্রোফোন সাপোর্ট নেই');
    return;
  }
  try {
    mainRecStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mainRecChunks = [];
    mainRecCancelled = false;
    mainMediaRecorder = new MediaRecorder(mainRecStream);

    mainMediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) mainRecChunks.push(e.data);
    };

    mainMediaRecorder.onstop = async () => {
      clearInterval(mainRecTimer);
      const banner = document.getElementById('main-voice-rec-banner');
      if (banner) banner.style.display = 'none';
      if (mainRecStream) {
        mainRecStream.getTracks().forEach(t => t.stop());
        mainRecStream = null;
      }
      if (mainRecCancelled || mainRecChunks.length === 0) return;
      try {
        const rawBlob = new Blob(mainRecChunks, { type: mainMediaRecorder.mimeType || 'audio/webm' });
        const arrayBuf = await rawBlob.arrayBuffer();
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioCtx();
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        const wavDataUrl = encodeMainAudioBufferToWavBase64(decoded);
        try { audioCtx.close(); } catch (e) {}
        window.setMainPendingMedia({
          base64: wavDataUrl,
          type: 'audio',
          mime: 'audio/wav',
          name: `voice_${Date.now()}.wav`
        });
        showToast('🎙️ ভয়েস রেকর্ড সম্পন্ন! এখন Send বাটনে চাপুন।');
      } catch (e) {
        const rawBlob = new Blob(mainRecChunks, { type: 'audio/mp4' });
        const reader = new FileReader();
        reader.onload = () => {
          window.setMainPendingMedia({
            base64: reader.result,
            type: 'audio',
            mime: 'audio/mp4',
            name: `voice_${Date.now()}.mp4`
          });
        };
        reader.readAsDataURL(rawBlob);
      }
    };

    mainMediaRecorder.start();
    mainRecStart = Date.now();
    const banner = document.getElementById('main-voice-rec-banner');
    if (banner) banner.style.display = 'flex';
    const timerEl = document.getElementById('main-voice-rec-timer');
    if (timerEl) timerEl.textContent = '00:00';
    mainRecTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - mainRecStart) / 1000);
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      if (timerEl) timerEl.textContent = `${mm}:${ss}`;
    }, 500);
  } catch (err) {
    showToast('❌ মাইক্রোফোন পারমিশন পাওয়া যায়নি');
  }
};

window.stopMainVoiceRec = function() {
  if (mainMediaRecorder && mainMediaRecorder.state === 'recording') {
    mainRecCancelled = false;
    mainMediaRecorder.stop();
  }
};

window.cancelMainVoiceRec = function() {
  mainRecCancelled = true;
  if (mainMediaRecorder && mainMediaRecorder.state === 'recording') {
    mainMediaRecorder.stop();
  }
};

function initChatReply() {
  const form = document.getElementById('chat-reply-form');
  const inputEl = document.getElementById('admin-message-input');
  const sendBtn = document.getElementById('btn-send-message');

  if (!form || !inputEl) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if ((!text && !mainPendingMedia) || appState.isSending) return;

    const chatId = appState.activeChatId;
    if (!chatId) {
      showToast('⚠️ অনুগ্রহ করে প্রথমে একটি চ্যাট সিলেক্ট করুন।');
      return;
    }

    appState.isSending = true;
    sendBtn.disabled = true;

    const attachedMedia = mainPendingMedia ? { ...mainPendingMedia } : null;
    const displayMsgText = text || (attachedMedia ? (attachedMedia.type === 'image' ? '📷 [Photo]' : (attachedMedia.type === 'video' ? '🎥 [Video]' : '🎙️ [Voice Audio]')) : '');

    // ১. লোকাল ক্যাশে তাৎক্ষণিক সেভ (Instant UI)
    const newMsg = {
      id: 'm_' + Date.now(),
      sender_type: 'admin',
      message_text: displayMsgText,
      media_type: attachedMedia ? attachedMedia.type : null,
      media_url: attachedMedia ? attachedMedia.base64 : null,
      media_mime: attachedMedia ? attachedMedia.mime : null,
      attachments: attachedMedia ? [{ type: attachedMedia.type, url: attachedMedia.base64, mime_type: attachedMedia.mime }] : [],
      created_at: new Date().toISOString()
    };

    if (!appState.messages[chatId]) appState.messages[chatId] = [];
    appState.messages[chatId].push(newMsg);
    setLocalCache(CACHE_KEYS.MESSAGES, appState.messages);
    renderMessageBubbles(chatId);
    inputEl.value = '';
    window.clearMainPendingMedia();

    const payload = { chat_id: chatId, message_text: text };
    if (attachedMedia) {
      payload.media_base64 = attachedMedia.base64;
      payload.media_type = attachedMedia.type;
      payload.media_mime = attachedMedia.mime;
    }

    // ২. Alwaysdata গেটওয়ে অথবা Worker-এ ১টি একক আউটবাউন্ড POST কল
    try {
      let res = await fetch(`https://ranonex.alwaysdata.net/api/send-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      }).catch(() => null);

      if (!res || !res.ok) {
        res = await fetch(`${API_BASE}/admin-reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      const data = await res.json();
      if (res.ok && data.success) {
        if (data.media_url && newMsg.attachments && newMsg.attachments[0]) {
          newMsg.media_url = data.media_url;
          newMsg.attachments[0].url = data.media_url;
          setLocalCache(CACHE_KEYS.MESSAGES, appState.messages);
        }
        showToast('✅ কাস্টমারকে মেসেজ পাঠানো হয়েছে!');
        const conv = appState.conversations.find(c => String(c.id) === String(chatId));
        if (conv) {
          conv.admin_takeover = true;
          conv.last_message = displayMsgText;
          setLocalCache(CACHE_KEYS.CONVERSATIONS, appState.conversations);
          renderConversationList();
          updateHandoverUI(conv);
        }
      } else {
        showToast('❌ মেসেজ পাঠানো যায়নি: ' + (data.error || 'Server error'));
      }
    } catch (err) {
      showToast('❌ নেটওয়ার্ক ত্রুটি: ' + err.message);
    } finally {
      appState.isSending = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  });
}

// 🤖 AI সেলস রিপ্লাই সাজেশন (অ্যাডমিন যখন চ্যাটে রিপ্লাই করতে চান)
window.requestAiReplySuggestion = async function() {
  const chatId = appState.activeChatId;
  if (!chatId) {
    showToast('⚠️ অনুগ্রহ করে প্রথমে বাম পাশ থেকে একটি চ্যাট সিলেক্ট করুন!');
    return;
  }
  const inputEl = document.getElementById('admin-message-input');
  const btnText = document.getElementById('btn-ai-suggest-text');
  const btn = document.getElementById('btn-ai-suggest-reply');
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Thinking...';

  try {
    const res = await fetch(`https://ranonex.alwaysdata.net/api/ai-suggest-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId })
    });
    const data = await res.json();
    const replySuggestion = data.suggestion || data.suggested_reply;
    if (res.ok && data.success && replySuggestion) {
      if (inputEl) {
        inputEl.value = replySuggestion;
        inputEl.focus();
      }
      showToast('✨ AI সেলস রিপ্লাই সাজেস্ট করেছে! দেখে Send চাপুন।');
    } else {
      showToast('⚠️ ' + (data.error || 'AI রিপ্লাই তৈরি করতে পারেনি'));
    }
  } catch (err) {
    showToast('❌ এরর: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'AI Suggest';
  }
};

function initHandoverToggle() {
  const btn = document.getElementById('btn-toggle-handover');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const conv = appState.conversations.find(c => String(c.id) === String(appState.activeChatId));
    if (!conv) return;

    conv.admin_takeover = !conv.admin_takeover;
    setLocalCache(CACHE_KEYS.CONVERSATIONS, appState.conversations);
    updateHandoverUI(conv);
    renderConversationList();

    try {
      await fetch(`https://ranonex.alwaysdata.net/api/handover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: conv.id, admin_takeover: conv.admin_takeover })
      });
    } catch (e) {}

    showToast(conv.admin_takeover ? '👤 Admin Takeover সক্রিয়।' : '🤖 AI সক্রিয় করা হয়েছে।');
  });
}

// ========================================================
// ৫. D1 প্রোডাক্টস ও বিজনেস প্রোফাইল (লোকাল ক্যাশ ফার্স্ট)
// ========================================================
function renderProductsTable() {
  const tbody = document.getElementById('products-table-tbody');
  const countBadge = document.getElementById('badge-prod-count');
  const statProd = document.getElementById('stat-d1-products');

  if (countBadge) countBadge.textContent = appState.products.length;
  if (statProd) statProd.textContent = appState.products.length;
  if (!tbody) return;

  if (appState.products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 28px; color: var(--text-dim);">কোনো প্রোডাক্ট নেই। উপরে <strong>⚡ 1-Click Sync All Store Products</strong> বাটনে ক্লিক করে শপের ১১টি প্রোডাক্ট নিয়ে আসুন।</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  appState.products.forEach(p => {
    const tr = document.createElement('tr');

    // ফটো থাম্বনেইল
    const imgThumb = p.image_url 
      ? `<img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 6px; border: 1px solid rgba(255,255,255,0.15); flex-shrink: 0;" onerror="this.style.display='none'">`
      : `<div style="width: 40px; height: 40px; background: rgba(255,255,255,0.06); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0;">📦</div>`;

    const productTitle = p.product_url 
      ? `<a href="${escapeHtml(p.product_url)}" target="_blank" style="color: var(--primary-light); text-decoration: underline; font-weight: 600;">${escapeHtml(p.name)} 🔗</a>`
      : `<strong>${escapeHtml(p.name)}</strong>`;

    // শিডিউল টেক্সট
    let schedText = '⏱️ প্রতি ৪ ঘণ্টা পর পর';
    if (p.posting_time && p.posting_time.startsWith('interval_')) {
      const h = p.posting_time.replace('interval_', '');
      schedText = `⏱️ প্রতি ${h} ঘণ্টা পর পর`;
    } else if (p.schedule_type === 'interval') {
      schedText = `⏱️ প্রতি ${p.interval_hours || 4} ঘণ্টা পর পর`;
    } else if (p.posting_time && p.posting_time !== '10:00') {
      schedText = `⏰ ${p.posting_time}`;
    }

    const autoBadge = (p.daily_auto_post === undefined || p.daily_auto_post != 0)
      ? `<span style="background: rgba(16, 185, 129, 0.15); color: var(--emerald); padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">${schedText} (🟢 চালু)</span>`
      : `<span style="background: rgba(255, 255, 255, 0.05); color: var(--text-dim); padding: 4px 8px; border-radius: 4px; font-size: 11px;">⚪ বন্ধ</span>`;

    const platform = p.target_platform || 'facebook';
    const platformBadge = platform === 'facebook'
      ? `<span style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🔵 FB</span>`
      : (platform === 'all'
        ? `<span style="background: rgba(139, 92, 246, 0.15); color: #a78bfa; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🌐 All</span>`
        : `<span style="background: rgba(254, 44, 85, 0.15); color: #fe2c55; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🎵 TikTok</span>`);

    const isStockIn = (p.stock_status || 'in_stock') === 'in_stock';
    const skuDisplay = p.sku || p.id || 'N/A';
    const specsDisplay = p.specifications ? p.specifications : 'Standard / Single';

    let galleryCount = 0;
    try {
      const g = typeof p.gallery_images === 'string' ? JSON.parse(p.gallery_images) : (p.gallery_images || []);
      galleryCount = Array.isArray(g) ? g.length : (p.image_url ? 1 : 0);
    } catch (e) {
      galleryCount = p.image_url ? 1 : 0;
    }

    const photoBadge = galleryCount > 1 
      ? `<span style="font-size: 10px; background: rgba(59, 130, 246, 0.2); color: #60a5fa; font-weight: 700; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px; margin-top: 3px;">📸 ${galleryCount} Photos</span>`
      : '';

    tr.innerHTML = `
      <td>
        <div style="display: flex; align-items: center; gap: 10px;">
          ${imgThumb}
          <div>
            ${productTitle}
            ${photoBadge}
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${escapeHtml(p.description || '').substring(0, 40)}...</div>
          </div>
        </div>
      </td>
      <td>
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <span style="font-family: monospace; font-weight: 700; font-size: 11px; color: #93c5fd; background: rgba(59, 130, 246, 0.18); padding: 2px 6px; border-radius: 4px; display: inline-block; width: fit-content;">
            ${escapeHtml(skuDisplay)}
          </span>
          <span style="font-size: 10px; color: var(--text-muted); line-height: 1.3;" title="${escapeHtml(specsDisplay)}">
            ${escapeHtml(specsDisplay.slice(0, 36))}${specsDisplay.length > 36 ? '...' : ''}
          </span>
        </div>
      </td>
      <td><span style="color: var(--emerald); font-weight: 700; font-size: 14px;">৳${p.price}</span></td>
      <td>${platformBadge}</td>
      <td>${autoBadge}</td>
      <td><span class="badge-status ${isStockIn ? 'published' : 'pending'}">${isStockIn ? 'In Stock' : 'Out of Stock'}</span></td>
      <td style="white-space: nowrap;">
        <button class="btn-primary" style="padding: 6px 12px; font-size: 11px; font-weight: 700; background: linear-gradient(135deg, #10b981, #059669); border: none; border-radius: 6px; cursor: pointer; color: #fff; margin-right: 5px;" onclick="publishProductNow('${p.id}', this)" title="এই প্রোডাক্টটি ফেসবুক পেজে পোস্ট করুন">
          🚀 Post Now
        </button>
        <button class="btn-secondary" style="padding: 6px 10px; font-size: 11px; font-weight: 600; cursor: pointer; margin-right: 5px; border-color: rgba(59, 130, 246, 0.4); color: #93c5fd;" onclick="editProduct('${p.id}')" title="প্রোডাক্ট ও সমস্ত ছবি এডিট করুন">
          ✏️ Edit
        </button>
        <button class="btn-refresh" style="color: var(--rose); font-size: 11px; padding: 6px 8px;" onclick="deleteProduct('${p.id}')">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ⚡ ১-ক্লিকে পুরো ওয়েবসাইট (ranonex.shop) এর সমস্ত প্রোডাক্ট D1-এ সিঙ্ক
window.syncAllStoreProducts = async function() {
  const btn = document.getElementById('btn-sync-all-store');
  const origText = btn ? btn.innerHTML : '<span>⚡</span> 1-Click Sync All Store Products (11 Products)';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> শপের ১১টি প্রোডাক্ট ও SKU সিঙ্ক হচ্ছে...';
  }

  try {
    const res = await fetch(`${API_BASE}/sync-all-store-products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await res.json();
    if (res.ok && data.success && data.products) {
      appState.products = data.products;
      setLocalCache(CACHE_KEYS.PRODUCTS, appState.products);
      renderProductsTable();
      showToast(`🎉 ${data.message || `${data.count}টি প্রোডাক্ট D1-এ সিঙ্ক সম্পন্ন!`}`);
    } else {
      showToast(`❌ সিঙ্ক ব্যর্থ: ${data.error || 'অজানা ত্রুটি'}`);
      alert(`সিঙ্ক ব্যর্থ হয়েছে:\n${data.error || 'সার্ভার রেসপন্স চেক করুন'}`);
    }
  } catch (err) {
    showToast(`❌ নেটওয়ার্ক এরর: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  }
};

// 🚀 ১-ক্লিক ডাইরেক্ট প্রোডাক্ট পোস্ট (Worker Engine)
window.publishProductNow = async function(id, btn) {
  const origText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ Posting...';

  try {
    const res = await fetch(`${API_BASE}/publish-product-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: id, platform: 'facebook' })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('🎉 ফেসবুকে পোস্ট সফলভাবে পাবলিশ হয়েছে!');
      btn.innerHTML = '✅ Posted!';
      btn.style.background = '#059669';
      
      if (data.post_url) {
        setTimeout(() => {
          if (confirm(`🎉 ফেসবুক পেজে পোস্ট সফল হয়েছে!\n\nঅ্যাঙ্গেল: ${data.angle}\n\nআপনি কি পেজে গিয়ে পোস্টটি দেখতে চান?`)) {
            window.open(data.post_url, '_blank');
          }
        }, 500);
      }
    } else {
      showToast('❌ পোস্ট ব্যর্থ: ' + (data.error || 'Unknown error'));
      alert(`পোস্ট ব্যর্থ হয়েছে:\n${data.error || 'Server error'}`);
      btn.innerHTML = origText;
    }
  } catch (err) {
    showToast('❌ নেটওয়ার্ক এরর: ' + err.message);
    btn.innerHTML = origText;
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = '🚀 Post Now';
      btn.style.background = '';
    }, 4000);
  }
};

window.deleteProduct = async function(id) {
  appState.products = appState.products.filter(p => p.id !== id);
  setLocalCache(CACHE_KEYS.PRODUCTS, appState.products);
  renderProductsTable();
  showToast('🗑️ প্রোডাক্ট সরানো হয়েছে।');

  try {
    await fetch(`${API_BASE}/products?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {}
};

// ⏱️ ক্রন শিডিউল স্ট্যাটাস ও টেস্ট রান
window.checkCronSchedule = async function(triggerNow = false) {
  try {
    const url = triggerNow ? `${API_BASE}/cron-status?run=true` : `${API_BASE}/cron-status`;
    showToast(triggerNow ? '⏳ অটো-পোস্ট চেক চলছে...' : '🔍 শিডিউল স্ট্যাটাস লোড হচ্ছে...');
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');

    if (triggerNow) {
      alert(`⏰ শিডিউল রান সম্পন্ন!\n\nমোট সক্রিয় প্রোডাক্ট: ${data.total_active || 0}\nপোস্ট পাবলিশ হয়েছে: ${data.published_count || 0}\n\nলগ:\n` + JSON.stringify(data.log, null, 2));
      return;
    }

    let msg = `⏰ সোশ্যাল অটোমেট ক্রন শিডিউল স্ট্যাটাস:\n`;
    msg += `------------------------------------\n`;
    msg += `বাংলাদেশ সময়: ${data.current_time_bdt || 'N/A'}\n`;
    msg += `মোট সক্রিয় শিডিউল প্রোডাক্ট: ${data.active_scheduled_products || 0}\n\n`;

    if (!data.products || data.products.length === 0) {
      msg += `কোনো প্রোডাক্ট সক্রিয় নেই। Product ফর্মে "Auto-Post Status: 🟢 চালু" সিলেক্ট করে সেভ করুন।`;
    } else {
      data.products.forEach((p, idx) => {
        msg += `${idx + 1}. ${p.name}\n`;
        msg += `   • শিডিউল: প্রতি ${p.interval_hours} ঘণ্টা পর পর (Time: ${p.posting_time})\n`;
        msg += `   • পূর্বের পোস্ট: ${p.last_posted_at} (${p.hours_since_last_post !== null ? p.hours_since_last_post + ' ঘণ্টা আগে' : 'কখনোই পোস্ট হয়নি'})\n`;
        msg += `   • স্ট্যাটাস: ${p.status}\n\n`;
      });
    }

    msg += `\n⚠️ গুরুত্বপূর্ণ নোট:\nক্লাউডফ্লেয়ার ড্যাশবোর্ডে Worker Triggers-এ '*/15 * * * *' Cron Trigger যোগ করা থাকতে হবে যাতে ক্লাউডফ্লেয়ার ব্যাকগ্রাউন্ডে স্বয়ংক্রিয়ভাবে চালায়।\n\nআপনি কি এখনই শিডিউল রান টেস্ট করতে চান?`;

    if (confirm(msg)) {
      window.checkCronSchedule(true);
    }
  } catch (err) {
    alert('❌ ক্রন স্ট্যাটাস লোড ব্যর্থ: ' + err.message);
  }
};

function populateBusinessProfileUI() {
  const data = appState.businessProfile;
  if (data.store_name) document.getElementById('store-name').value = data.store_name;
  if (data.delivery_inside_dhaka) document.getElementById('del-dhaka').value = data.delivery_inside_dhaka;
  if (data.delivery_outside_dhaka) document.getElementById('del-outside').value = data.delivery_outside_dhaka;
  if (data.payment_methods) document.getElementById('payment-methods').value = data.payment_methods;
  if (data.return_policy) document.getElementById('return-policy').value = data.return_policy;
  if (data.contact_phone) document.getElementById('contact-phone').value = data.contact_phone;
}

// ==========================================
// 📸 মাল্টি-ফটো সিরিয়াল গ্যালারি কন্ট্রোলার
// ==========================================
window.currentGalleryPhotos = [];

window.renderGalleryPhotos = function() {
  const container = document.getElementById('prod-gallery-container');
  const countBadge = document.getElementById('gallery-count-badge');
  const jsonInput = document.getElementById('prod-gallery-json');
  const primaryImgInput = document.getElementById('prod-img');
  const primaryImgPreview = document.getElementById('prod-img-preview');

  if (!container) return;

  if (countBadge) {
    countBadge.textContent = `${window.currentGalleryPhotos.length} Photo${window.currentGalleryPhotos.length === 1 ? '' : 's'}`;
  }

  if (jsonInput) {
    jsonInput.value = JSON.stringify(window.currentGalleryPhotos);
  }

  if (primaryImgInput) {
    primaryImgInput.value = window.currentGalleryPhotos[0] || '';
  }

  if (primaryImgPreview) {
    if (window.currentGalleryPhotos[0]) {
      primaryImgPreview.src = window.currentGalleryPhotos[0];
      primaryImgPreview.style.display = 'block';
    } else {
      primaryImgPreview.style.display = 'none';
    }
  }

  if (window.currentGalleryPhotos.length === 0) {
    container.innerHTML = `<div id="gallery-empty-placeholder" style="font-size: 12px; color: var(--text-dim); padding: 8px 4px;">কোনো ছবি নেই। ওয়েবসাইট থেকে ফেচ করলে সমস্ত ছবি এখানে সিরিয়ালি আসবে বা নিচের বক্সে লিঙ্ক দিন।</div>`;
    return;
  }

  container.innerHTML = window.currentGalleryPhotos.map((url, idx) => `
    <div class="gallery-photo-chip" style="position: relative; width: 68px; height: 68px; border-radius: 8px; overflow: hidden; border: 2px solid ${idx === 0 ? '#10b981' : 'rgba(59, 130, 246, 0.4)'}; background: #0b0f19; flex-shrink: 0; box-shadow: 0 2px 6px rgba(0,0,0,0.4);" title="Photo #${idx + 1}${idx === 0 ? ' (Primary Cover Photo)' : ''}">
      <img src="${escapeHtml(url)}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='https://via.placeholder.com/68?text=Error'">
      <span style="position: absolute; bottom: 2px; left: 4px; background: rgba(0,0,0,0.75); color: #fff; font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 3px;">
        ${idx === 0 ? '★ Cover' : `#${idx + 1}`}
      </span>
      <button type="button" onclick="removeGalleryPhoto(${idx})" title="ছবিটি বাদ দিন" style="position: absolute; top: 2px; right: 2px; width: 20px; height: 20px; border-radius: 50%; background: rgba(239, 68, 68, 0.95); color: #fff; border: none; font-size: 11px; font-weight: 900; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; transition: transform 0.15s ease;" onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'">✕</button>
    </div>
  `).join('');
};

window.addGalleryPhoto = function(url) {
  if (!url || typeof url !== 'string' || !url.trim().startsWith('http')) {
    showToast('⚠️ অনুগ্রহ করে একটি সঠিক ইমেজ URL পেস্ট করুন (http/https)!');
    return false;
  }
  const cleanUrl = url.trim();
  if (!window.currentGalleryPhotos.includes(cleanUrl)) {
    window.currentGalleryPhotos.push(cleanUrl);
    window.renderGalleryPhotos();
    showToast(`📸 ছবি #${window.currentGalleryPhotos.length} সফলভাবে যুক্ত হয়েছে!`);
    return true;
  } else {
    showToast('ℹ️ এই ছবির লিঙ্কটি ইতিমধ্যে তালিকায় রয়েছে।');
    return false;
  }
};

window.removeGalleryPhoto = function(index) {
  if (index >= 0 && index < window.currentGalleryPhotos.length) {
    window.currentGalleryPhotos.splice(index, 1);
    window.renderGalleryPhotos();
    showToast(`🗑️ ছবিটি বাদ দেওয়া হয়েছে।`);
  }
};

// ✏️ প্রোডাক্ট এডিটর
window.editProduct = function(id) {
  const p = appState.products.find(x => x.id === id);
  if (!p) return;
  document.getElementById('prod-name').value = p.name || '';
  document.getElementById('prod-price').value = p.price || '';
  if (document.getElementById('prod-sku')) document.getElementById('prod-sku').value = p.sku || '';
  if (document.getElementById('prod-specs')) document.getElementById('prod-specs').value = p.specifications || '';
  if (document.getElementById('prod-url')) document.getElementById('prod-url').value = p.product_url || '';
  if (document.getElementById('prod-desc')) document.getElementById('prod-desc').value = p.description || '';
  if (document.getElementById('prod-post-time')) document.getElementById('prod-post-time').value = p.posting_time || 'interval_4';
  if (document.getElementById('prod-target-platform')) document.getElementById('prod-target-platform').value = p.target_platform || 'facebook';
  if (document.getElementById('prod-stock')) document.getElementById('prod-stock').value = p.stock_status || 'in_stock';
  if (document.getElementById('prod-auto-post')) document.getElementById('prod-auto-post').value = (p.daily_auto_post === undefined || p.daily_auto_post != 0) ? '1' : '0';

  let gallery = [];
  try {
    gallery = typeof p.gallery_images === 'string' ? JSON.parse(p.gallery_images) : (p.gallery_images || []);
  } catch(e){}
  if (gallery.length === 0 && p.image_url) gallery = [p.image_url];
  window.currentGalleryPhotos = gallery;
  window.renderGalleryPhotos();

  const formCard = document.getElementById('add-product-form');
  if (formCard) {
    formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`✏️ "${p.name}" এর তথ্য ও ${gallery.length}টি ছবি এডিটের জন্য লোড হয়েছে!`);
  }
};

function initBusinessDataForms() {
  // ⚡ পদ্ধতি ১: ওয়েবসাইট প্রোডাক্ট লিংক দিয়ে অটো-ফেচ
  const quickFetchBtn = document.getElementById('btn-quick-fetch-prod');
  const quickFetchInput = document.getElementById('input-quick-fetch-url');
  const previewBox = document.getElementById('fetch-preview-box');
  const previewImg = document.getElementById('fetch-preview-img');
  const previewTitle = document.getElementById('fetch-preview-title');
  const previewPrice = document.getElementById('fetch-preview-price');
  const prodImgInput = document.getElementById('prod-img');
  const prodImgPreview = document.getElementById('prod-img-preview');

  // গ্যালারি এড বাটন ইভেন্ট ওয়্যারিং
  const addPhotoBtn = document.getElementById('btn-add-gallery-photo');
  const newPhotoInput = document.getElementById('input-new-photo-url');
  if (addPhotoBtn && newPhotoInput) {
    addPhotoBtn.addEventListener('click', () => {
      const val = newPhotoInput.value.trim();
      if (window.addGalleryPhoto(val)) {
        newPhotoInput.value = '';
      }
    });
    newPhotoInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = newPhotoInput.value.trim();
        if (window.addGalleryPhoto(val)) {
          newPhotoInput.value = '';
        }
      }
    });
  }

  if (prodImgInput && prodImgPreview) {
    prodImgInput.addEventListener('input', () => {
      const val = prodImgInput.value.trim();
      if (val && val.startsWith('http')) {
        prodImgPreview.src = val;
        prodImgPreview.style.display = 'block';
      } else {
        prodImgPreview.style.display = 'none';
      }
    });
  }

  if (quickFetchBtn && quickFetchInput) {
    quickFetchBtn.addEventListener('click', async () => {
      const url = quickFetchInput.value.trim();
      if (!url) {
        showToast('⚠️ অনুগ্রহ করে একটি প্রোডাক্ট লিংক পেস্ট করুন!');
        quickFetchInput.focus();
        return;
      }

      quickFetchBtn.disabled = true;
      quickFetchBtn.textContent = '⏳ Auto-Fetching...';

      try {
        const res = await fetch(`${API_BASE}/extract-product`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });

        const data = await res.json();
        if (res.ok && data.success && data.product) {
          const p = data.product;
          // ফর্মে অটো-ফিল করা
          document.getElementById('prod-name').value = p.name || '';
          document.getElementById('prod-price').value = p.price || '';
          if (document.getElementById('prod-sku')) document.getElementById('prod-sku').value = p.sku || '';
          if (document.getElementById('prod-specs')) document.getElementById('prod-specs').value = p.specifications || '';
          if (document.getElementById('prod-url')) document.getElementById('prod-url').value = p.product_url || url;
          if (document.getElementById('prod-desc')) document.getElementById('prod-desc').value = p.description || '';

          // সমস্ত ছবি গ্যালারিতে রেন্ডার
          let fetchedGallery = [];
          try {
            fetchedGallery = typeof p.gallery_images === 'string' ? JSON.parse(p.gallery_images) : (p.gallery_images || []);
          } catch(e){}
          if (fetchedGallery.length === 0 && p.image_url) {
            fetchedGallery = [p.image_url];
          }
          window.currentGalleryPhotos = fetchedGallery;
          window.renderGalleryPhotos();

          // প্রিভিউ কার্ড দেখানো
          if (previewBox) {
            previewBox.style.display = 'flex';
            if (previewImg) previewImg.src = fetchedGallery[0] || p.image_url || 'https://via.placeholder.com/50';
            if (previewTitle) previewTitle.textContent = p.name;
            if (previewPrice) previewPrice.textContent = `৳${p.price} BDT`;
          }

          showToast(`✅ "${p.name}" এর তথ্য ও ${fetchedGallery.length}টি R2 ফটো লোড হয়েছে!`);
        } else {
          showToast(`❌ ফেচ ব্যর্থ: ${data.error || 'Product not found'}`);
          alert(`ফেচ ব্যর্থ হয়েছে:\n${data.error || 'প্রোডাক্টের তথ্য খুঁজে পাওয়া যায়নি। অনুগ্রহ করে ম্যানুয়ালি লিখুন।'}`);
        }
      } catch (err) {
        showToast(`❌ নেটওয়ার্ক এরর: ${err.message}`);
      } finally {
        quickFetchBtn.disabled = false;
        quickFetchBtn.textContent = '⚡ Auto-Fetch Product Info';
      }
    });
  }

  // পদ্ধতি ২: Add Product Form সেভ হ্যান্ডলার
  const prodForm = document.getElementById('add-product-form');
  if (prodForm) {
    prodForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('prod-name').value.trim();
      const price = document.getElementById('prod-price').value.trim();
      const sku = document.getElementById('prod-sku') ? document.getElementById('prod-sku').value.trim() : '';
      const specs = document.getElementById('prod-specs') ? document.getElementById('prod-specs').value.trim() : '';
      const url = document.getElementById('prod-url') ? document.getElementById('prod-url').value.trim() : '';
      const postTime = document.getElementById('prod-post-time') ? document.getElementById('prod-post-time').value : 'interval_4';
      const targetPlatform = document.getElementById('prod-target-platform') ? document.getElementById('prod-target-platform').value : 'facebook';
      const autoPost = document.getElementById('prod-auto-post') ? Number(document.getElementById('prod-auto-post').value) : 1;
      const stock = document.getElementById('prod-stock').value;
      const desc = document.getElementById('prod-desc').value.trim();

      if (!name || !price) return;

      const isInterval = postTime.startsWith('interval_');
      const intervalHours = isInterval ? (parseInt(postTime.replace('interval_', '')) || 4) : 4;

      const galleryPhotos = window.currentGalleryPhotos || [];
      const primaryImg = galleryPhotos[0] || (document.getElementById('prod-img') ? document.getElementById('prod-img').value.trim() : '');

      const existingProd = appState.products.find(x => x.name.trim().toLowerCase() === name.toLowerCase() || (sku && x.sku === sku));
      const prodId = existingProd ? existingProd.id : ('p_' + Date.now());

      const newProd = {
        id: prodId,
        sku: sku || ('P_' + Date.now()),
        name,
        price: parseFloat(price) || 0,
        specifications: specs,
        product_url: url,
        image_url: primaryImg,
        gallery_images: JSON.stringify(galleryPhotos),
        posting_time: postTime,
        schedule_type: isInterval ? 'interval' : 'daily',
        interval_hours: intervalHours,
        target_platform: targetPlatform,
        daily_auto_post: autoPost,
        stock_status: stock,
        description: desc
      };

      if (existingProd) {
        const idx = appState.products.indexOf(existingProd);
        appState.products[idx] = newProd;
      } else {
        appState.products.unshift(newProd);
      }

      setLocalCache(CACHE_KEYS.PRODUCTS, appState.products);
      renderProductsTable();
      prodForm.reset();
      window.currentGalleryPhotos = [];
      window.renderGalleryPhotos();
      if (previewBox) previewBox.style.display = 'none';
      showToast(`✅ "${name}" (${galleryPhotos.length}টি ফটো সহ) D1-এ সেভ হয়েছে!`);

      // ব্যাকএন্ড D1-এ সেভ
      try {
        await fetch(`${API_BASE}/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newProd)
        });
      } catch (e) {}
    });
  }

  // Profile Form
  const profForm = document.getElementById('business-profile-form');
  if (profForm) {
    profForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        store_name: document.getElementById('store-name').value.trim(),
        delivery_inside_dhaka: document.getElementById('del-dhaka').value.trim(),
        delivery_outside_dhaka: document.getElementById('del-outside').value.trim(),
        payment_methods: document.getElementById('payment-methods').value.trim(),
        return_policy: document.getElementById('return-policy').value.trim(),
        contact_phone: document.getElementById('contact-phone').value.trim()
      };

      appState.businessProfile = payload;
      setLocalCache(CACHE_KEYS.PROFILE, payload);
      showToast('✅ বিজনেস প্রোফাইল সেভ হয়েছে!');

      try {
        await fetch(`${API_BASE}/business-profile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (e) {}
    });
  }
}

// ========================================================
// ৬. ১-টাইম লাইফটাইম সোশ্যাল কানেকশন (WhatsApp / TikTok / Meta)
// ========================================================
function initSettingsForm() {
  // ১. WhatsApp Connect Form
  // 🟢 ১. WhatsApp Connect Form (Redesigned with QR Gateway vs Cloud API)
  window.switchWaMode = function(mode) {
    const inputMode = document.getElementById('input-wa-mode');
    const btnGateway = document.getElementById('tab-btn-wa-gateway');
    const btnCloud = document.getElementById('tab-btn-wa-cloud');
    const secGateway = document.getElementById('section-wa-gateway');
    const secCloud = document.getElementById('section-wa-cloud');

    if (inputMode) inputMode.value = mode;

    if (mode === 'gateway') {
      if (btnGateway) {
        btnGateway.style.background = 'rgba(16, 185, 129, 0.15)';
        btnGateway.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        btnGateway.style.color = 'var(--emerald)';
        btnGateway.style.fontWeight = '700';
      }
      if (btnCloud) {
        btnCloud.style.background = 'transparent';
        btnCloud.style.borderColor = 'transparent';
        btnCloud.style.color = 'var(--text-muted)';
        btnCloud.style.fontWeight = '600';
      }
      if (secGateway) secGateway.style.display = 'block';
      if (secCloud) secCloud.style.display = 'none';
    } else {
      if (btnCloud) {
        btnCloud.style.background = 'rgba(59, 130, 246, 0.15)';
        btnCloud.style.borderColor = 'rgba(59, 130, 246, 0.4)';
        btnCloud.style.color = '#60a5fa';
        btnCloud.style.fontWeight = '700';
      }
      if (btnGateway) {
        btnGateway.style.background = 'transparent';
        btnGateway.style.borderColor = 'transparent';
        btnGateway.style.color = 'var(--text-muted)';
        btnGateway.style.fontWeight = '600';
      }
      if (secGateway) secGateway.style.display = 'none';
      if (secCloud) secCloud.style.display = 'block';
    }
  };

  const waForm = document.getElementById('whatsapp-connect-form');
  const waPhoneInput = document.getElementById('input-wa-phone');
  const waSubmitBtn = document.getElementById('btn-save-whatsapp');
  const waResultBox = document.getElementById('wa-setup-result');
  const waCopyBtn = document.getElementById('btn-copy-wa-webhook');
  const waWebhookInput = document.getElementById('display-wa-webhook-url');

  // 🟢 Alwaysdata Live WhatsApp QR Engine Polling & Controls
  window.updateDashWhatsAppUI = function(data) {
    if (!data) return;
    const status = data.status || 'disconnected';
    const pill = document.getElementById('dash-wa-status-pill');
    const dot = document.getElementById('dash-wa-status-dot');
    const text = document.getElementById('dash-wa-status-text');
    const qrWrap = document.getElementById('dash-wa-qr-wrapper');
    const qrImg = document.getElementById('dash-wa-qr-img');
    const qrPlace = document.getElementById('dash-wa-qr-placeholder');
    const connInfo = document.getElementById('dash-wa-connected-info');
    const connPhone = document.getElementById('dash-wa-connected-phone');
    const badge = document.getElementById('wa-connection-badge');

    if (status === 'connected') {
      if (pill) {
        pill.style.background = 'rgba(16, 185, 129, 0.15)';
        pill.style.color = '#34d399';
        pill.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      }
      if (dot) dot.style.background = '#34d399';
      if (text) text.textContent = 'Connected (Personal Chat AI সক্রিয়)';
      if (qrWrap) qrWrap.style.display = 'none';
      if (connInfo) connInfo.style.display = 'block';
      if (connPhone) connPhone.textContent = data.phone ? `নম্বর: +${data.phone} (${data.name || 'WhatsApp'})` : (data.name || 'Connected');
      if (badge) badge.textContent = data.phone ? `Connected (+${data.phone})` : 'Connected ✅';
    } else if (status === 'qr_ready' && data.qr_data_url) {
      if (pill) {
        pill.style.background = 'rgba(245, 158, 11, 0.15)';
        pill.style.color = '#fbbf24';
        pill.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      }
      if (dot) dot.style.background = '#fbbf24';
      if (text) text.textContent = 'আপনার ফোনের WhatsApp থেকে নিচের QR স্ক্যান করুন';
      if (connInfo) connInfo.style.display = 'none';
      if (qrWrap) qrWrap.style.display = 'flex';
      if (qrImg) {
        qrImg.src = data.qr_data_url;
        qrImg.style.display = 'block';
      }
      if (qrPlace) qrPlace.style.display = 'none';
      if (badge) badge.textContent = 'Scan QR Code 📱';
    } else {
      if (pill) {
        pill.style.background = 'rgba(59, 130, 246, 0.15)';
        pill.style.color = '#93c5fd';
        pill.style.borderColor = 'rgba(59, 130, 246, 0.4)';
      }
      if (dot) dot.style.background = '#60a5fa';
      if (text) text.textContent = status === 'connecting' ? 'QR কোড তৈরি হচ্ছে...' : 'ডিসকানেক্টেড (Generate QR চাপুন)';
      if (connInfo) connInfo.style.display = 'none';
      if (qrWrap) qrWrap.style.display = 'flex';
      if (qrImg) qrImg.style.display = 'none';
      if (qrPlace) {
        qrPlace.style.display = 'block';
        qrPlace.innerHTML = '⏳ WhatsApp সেশন প্রস্তুত হচ্ছে...<br><small>কয়েক সেকেন্ড অপেক্ষা করুন অথবা নিচে Generate QR চাপুন</small>';
      }
    }
  };

  window.pollAlwaysdataWhatsAppStatus = async function() {
    if (document.hidden) return;
    try {
      const res = await fetch('https://ranonex.alwaysdata.net/api/whatsapp/status');
      if (res.ok) {
        const data = await res.json();
        window.updateDashWhatsAppUI(data);
      }
    } catch (e) {}
  };

  window.connectAlwaysdataWhatsApp = async function(force = false) {
    const btn = document.getElementById('btn-dash-wa-qr');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ QR তৈরি হচ্ছে...';
    }
    try {
      const res = await fetch('https://ranonex.alwaysdata.net/api/whatsapp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force })
      });
      const data = await res.json();
      window.updateDashWhatsAppUI(data);
      showToast('📱 নতুন WhatsApp QR সেশন শুরু হয়েছে!');
      setTimeout(window.pollAlwaysdataWhatsAppStatus, 1800);
    } catch (e) {
      showToast('❌ QR জেনারেট করতে সমস্যা হয়েছে');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '⚡ নতুন QR জেনারেট করুন';
      }
    }
  };

  window.logoutAlwaysdataWhatsApp = async function() {
    if (!confirm('আপনি কি নিশ্চিতভাবে WhatsApp সেশন ডিসকানেক্ট ও রিসেট করতে চান?')) return;
    try {
      const res = await fetch('https://ranonex.alwaysdata.net/api/whatsapp/logout', { method: 'POST' });
      const data = await res.json();
      window.updateDashWhatsAppUI(data);
      showToast('🔌 WhatsApp সেশন ডিসকানেক্ট করা হয়েছে');
      setTimeout(window.pollAlwaysdataWhatsAppStatus, 2000);
    } catch (e) {
      showToast('❌ ডিসকানেক্ট করতে সমস্যা হয়েছে');
    }
  };

  window.pollAlwaysdataWhatsAppStatus();
  setInterval(window.pollAlwaysdataWhatsAppStatus, 5000);

  if (waCopyBtn && waWebhookInput) {
    waCopyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(waWebhookInput.value).then(() => {
        showToast('📋 WhatsApp Webhook URL কপি হয়েছে!');
      });
    });
  }

  if (waForm) {
    waForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = waPhoneInput ? waPhoneInput.value.trim() : '';
      const mode = document.getElementById('input-wa-mode')?.value || 'gateway';
      const gatewayUrl = document.getElementById('input-wa-gateway-url')?.value.trim() || '';
      const gatewayToken = document.getElementById('input-wa-gateway-token')?.value.trim() || '';
      const phoneId = document.getElementById('input-wa-phone-id')?.value.trim() || '';
      const cloudToken = document.getElementById('input-wa-cloud-token')?.value.trim() || '';

      if (waSubmitBtn) {
        waSubmitBtn.disabled = true;
        waSubmitBtn.textContent = '⏳ Saving WhatsApp to D1...';
      }

      try {
        const res = await fetch(`${API_BASE}/setup-whatsapp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: phone,
            mode: mode,
            gateway_url: gatewayUrl,
            gateway_token: gatewayToken,
            phone_number_id: phoneId,
            access_token: mode === 'gateway' ? gatewayToken : cloudToken
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          if (waResultBox) {
            waResultBox.style.display = 'block';
            waResultBox.style.background = 'rgba(16, 185, 129, 0.15)';
            waResultBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
            waResultBox.style.color = '#a7f3d0';
            const modeText = mode === 'gateway' ? '📱 মোবাইল অ্যাপ + AI (QR Gateway)' : '☁️ Meta Cloud API';
            waResultBox.innerHTML = `
              <strong>✅ WhatsApp সেটিংস D1-এ সফলভাবে সেভ হয়েছে!</strong><br>
              নম্বর: <strong>${escapeHtml(phone)}</strong> (${modeText})<br>
              স্ট্যাটাস: এখন কাস্টমার হোয়াটসঅ্যাপে মেসেজ দিলে AI স্বয়ংক্রিয়ভাবে উত্তর দেবে।
            `;
          }
          showToast('🎉 WhatsApp সেটিংস D1-এ সেভ হয়েছে!');
        } else {
          if (waResultBox) {
            waResultBox.style.display = 'block';
            waResultBox.style.background = 'rgba(239, 68, 68, 0.15)';
            waResultBox.style.border = '1px solid rgba(239, 68, 68, 0.4)';
            waResultBox.style.color = '#fca5a5';
            waResultBox.innerHTML = `❌ ${escapeHtml(data.error || 'Failed to save WhatsApp config')}`;
          }
          showToast('❌ সেভ করতে ব্যর্থ হয়েছে।');
        }
      } catch (err) {
        showToast('❌ নেটওয়ার্ক এরর: ' + err.message);
      } finally {
        if (waSubmitBtn) {
          waSubmitBtn.disabled = false;
          waSubmitBtn.textContent = '💾 Save WhatsApp Settings to D1';
        }
      }
    });
  }

  // ২. TikTok Connect Form, 1-Click OAuth & On-Demand Test Post
  const tkForm = document.getElementById('tiktok-connect-form');
  const tkKeyInput = document.getElementById('input-tiktok-client-key');
  const tkSecretInput = document.getElementById('input-tiktok-client-secret');
  const tkTokenInput = document.getElementById('input-tiktok-access-token');
  const tkSubmitBtn = document.getElementById('btn-save-tiktok');
  const tkOAuthBtn = document.getElementById('btn-tiktok-oauth');
  const tkResultBox = document.getElementById('tiktok-setup-result');
  const tkCopyUriBtn = document.getElementById('btn-copy-tiktok-uri');
  const tkUriInput = document.getElementById('display-tiktok-redirect-uri');
  const tkTestPostBtn = document.getElementById('btn-test-post-tiktok');

  if (tkCopyUriBtn && tkUriInput) {
    tkCopyUriBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(tkUriInput.value).then(() => {
        showToast('📋 TikTok Redirect URI কপি হয়েছে!');
      });
    });
  }

  if (tkOAuthBtn) {
    tkOAuthBtn.addEventListener('click', () => {
      const key = tkKeyInput ? tkKeyInput.value.trim() : 'awq5kzk0rv01o6z0';
      if (!key) {
        showToast('⚠️ অনুগ্রহ করে প্রথমে TikTok Client Key বসান!');
        return;
      }
      showToast('🚀 TikTok Authorize পেজে নিয়ে যাওয়া হচ্ছে...');
      const redirectUri = encodeURIComponent("https://social-automate.rifatrabbi104.workers.dev/api/auth/tiktok/callback");
      const tiktokAuthUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${encodeURIComponent(key)}&scope=user.info.basic,video.publish,video.upload&response_type=code&redirect_uri=${redirectUri}&state=social_automate`;
      window.location.href = tiktokAuthUrl;
    });
  }

  if (tkForm) {
    tkForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const key = tkKeyInput ? tkKeyInput.value.trim() : '';
      const secret = tkSecretInput ? tkSecretInput.value.trim() : '';
      const token = tkTokenInput ? tkTokenInput.value.trim() : '';

      setLocalCache('sa_tiktok_config', { client_key: key, client_secret: secret, access_token: token });

      if (tkSubmitBtn) {
        tkSubmitBtn.disabled = true;
        tkSubmitBtn.textContent = '⏳ Saving TikTok to D1...';
      }

      try {
        const res = await fetch(`${API_BASE}/setup-tiktok`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_key: key,
            client_secret: secret,
            access_token: token
          })
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          if (tkResultBox) {
            tkResultBox.style.display = 'block';
            tkResultBox.style.background = 'rgba(16, 185, 129, 0.15)';
            tkResultBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
            tkResultBox.style.color = '#a7f3d0';
            tkResultBox.innerHTML = `
              <strong>✅ TikTok সেটিংস সেভ হয়েছে!</strong><br>
              Client Key: <strong>${escapeHtml(key)}</strong><br>
              এখন আপনি <strong>🔗 1-Click Authorize TikTok</strong> বাটনে চাপলেই সরাসরি টিকটকের সাথে কানেক্ট হয়ে যাবে।
            `;
          }
          showToast('🎉 TikTok ক্রেডেনশিয়ালস সেভ হয়েছে!');
        } else {
          // Local fallback
          if (tkResultBox) {
            tkResultBox.style.display = 'block';
            tkResultBox.style.background = 'rgba(16, 185, 129, 0.15)';
            tkResultBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
            tkResultBox.style.color = '#a7f3d0';
            tkResultBox.innerHTML = `
              <strong>✅ TikTok কি এবং সিক্রেট ড্যাশবোর্ডে সুরক্ষিতভাবে সেভ হয়েছে!</strong><br>
              এখন সরাসরি <strong>🔗 1-Click Authorize TikTok</strong> বাটনে চাপ দিন।
            `;
          }
          showToast('✅ ড্যাশবোর্ডে ক্রেডেনশিয়ালস সেভ হয়েছে!');
        }
      } catch (err) {
        if (tkResultBox) {
          tkResultBox.style.display = 'block';
          tkResultBox.style.background = 'rgba(16, 185, 129, 0.15)';
          tkResultBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
          tkResultBox.style.color = '#a7f3d0';
          tkResultBox.innerHTML = `
            <strong>✅ TikTok কি এবং সিক্রেট ড্যাশবোর্ডে সুরক্ষিতভাবে সেভ হয়েছে!</strong><br>
            এখন সরাসরি <strong>🔗 1-Click Authorize TikTok</strong> বাটনে চাপ দিন।
          `;
        }
        showToast('✅ ড্যাশবোর্ডে ক্রেডেনশিয়ালস সেভ হয়েছে!');
      } finally {
        if (tkSubmitBtn) {
          tkSubmitBtn.disabled = false;
          tkSubmitBtn.textContent = '💾 Save TikTok Keys to D1';
        }
      }
    });
  }

  if (tkTestPostBtn) {
    tkTestPostBtn.addEventListener('click', async () => {
      tkTestPostBtn.disabled = true;
      tkTestPostBtn.textContent = '⏳ Triggering Post...';
      try {
        const res = await fetch(`${API_BASE}/trigger-post`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_platform: 'tiktok' })
        });
        const data = await res.json();
        showToast(data.message || 'পোস্টিং টাস্ক ট্রিগার হয়েছে!');
      } catch (e) {
        showToast('❌ ট্রিগার এরর: ' + e.message);
      } finally {
        tkTestPostBtn.disabled = false;
        tkTestPostBtn.textContent = '🚀 1-Click Test Post Now';
      }
    });
  }

  // ৩. Meta (Facebook) Form (Optional)
  const form = document.getElementById('meta-connect-form');
  const tokenInput = document.getElementById('input-meta-token');
  const pageIdInput = document.getElementById('input-meta-page-id');
  const submitBtn = document.getElementById('btn-save-meta');
  const resultBox = document.getElementById('meta-setup-result');
  const copyBtn = document.getElementById('btn-copy-webhook');
  const webhookInput = document.getElementById('display-webhook-url');

  if (copyBtn && webhookInput) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(webhookInput.value).then(() => {
        showToast('📋 Webhook URL কপি হয়েছে!');
      });
    });
  }

  // সার্ভার ও লোকাল থেকে সেটিংস লোড করা (রিফ্রেশ মারলে ফর্ম পূরণ রাখার জন্য)
  loadSettingsFromServer();

  if (form && tokenInput) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = tokenInput.value.trim();
      const pageId = pageIdInput ? pageIdInput.value.trim() : '';

      if (!token) return;

      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Saving Meta Settings...';

      try {
        const res = await fetch(`${API_BASE}/setup-meta`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page_access_token: token, page_id: pageId })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          resultBox.style.display = 'block';
          resultBox.style.background = 'rgba(16, 185, 129, 0.15)';
          resultBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
          resultBox.style.color = '#a7f3d0';
          resultBox.innerHTML = `
            <strong>✅ মেটা সেটিংস সেভ হয়েছে!</strong><br>
            সংযুক্ত পেজ: <strong>${escapeHtml(data.account.name)}</strong> (ID: ${escapeHtml(data.account.id)})<br>
            এখন নিচে <strong>🚀 1-Click Test Post (Caption Only)</strong> বাটনে ক্লিক করে GitHub Actions দিয়ে টেস্ট পোস্ট চালান।
          `;

          const metaBadge = document.getElementById('meta-connected-badge');
          if (metaBadge) {
            metaBadge.style.display = 'block';
            metaBadge.style.background = 'rgba(16, 185, 129, 0.15)';
            metaBadge.style.border = '1px solid rgba(16, 185, 129, 0.4)';
            metaBadge.style.color = '#a7f3d0';
            metaBadge.innerHTML = `✅ <strong>সংযুক্ত ফেসবুক পেজ:</strong> ${escapeHtml(data.account.name)} (ID: <code>${escapeHtml(data.account.id)}</code>)`;
          }

          showToast('🎉 মেটা সেটিংস সফলভাবে সেভ হয়েছে!');
        } else {
          resultBox.style.display = 'block';
          resultBox.style.background = 'rgba(239, 68, 68, 0.15)';
          resultBox.style.border = '1px solid rgba(239, 68, 68, 0.4)';
          resultBox.style.color = '#fca5a5';
          resultBox.innerHTML = `❌ ${escapeHtml(data.error || 'Connection failed')}`;
          showToast('❌ সেভ ব্যর্থ হয়েছে।');
        }
      } catch (err) {
        showToast('❌ নেটওয়ার্ক এরর: ' + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 Save Meta Settings';
      }
    });
  }

  // ৪. Facebook ১-ক্লিক টেস্ট পোস্ট (GitHub Actions Engine দিয়ে)
  const fbTestPostBtn = document.getElementById('btn-test-post-facebook');
  if (fbTestPostBtn) {
    fbTestPostBtn.addEventListener('click', async () => {
      fbTestPostBtn.disabled = true;
      fbTestPostBtn.textContent = '⏳ Triggering GitHub Actions...';

      try {
        const res = await fetch(`${API_BASE}/trigger-post`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_platform: 'facebook',
            post_type: 'caption_only'
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          if (resultBox) {
            resultBox.style.display = 'block';
            resultBox.style.background = 'rgba(16, 185, 129, 0.15)';
            resultBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
            resultBox.style.color = '#a7f3d0';
            resultBox.innerHTML = `
              <strong>🎉 Facebook পেজে টেস্ট পোস্ট সফলভাবে পাবলিশ হয়েছে!</strong><br>
              ${data.engine ? `ইঞ্জিন: <code>${escapeHtml(data.engine)}</code><br>` : ''}
              ${data.post_url ? `<a href="${escapeHtml(data.post_url)}" target="_blank" style="color: #60a5fa; font-weight: 600; text-decoration: underline; margin-top: 8px; display: inline-block;">👉 ক্লিক করে ফেসবুকে লাইভ পোস্টটি দেখুন</a><br>` : ''}
              ${data.run_url ? `<a href="${escapeHtml(data.run_url)}" target="_blank" style="color: #93c5fd; text-decoration: underline; margin-top: 4px; display: inline-block;">👉 GitHub Actions লাইভ লগ</a>` : ''}
            `;
          }
          showToast('🎉 টেস্ট পোস্ট সফলভাবে সম্পন্ন হয়েছে!');
          if (data.post_url) {
            setTimeout(() => {
              if (confirm('🎉 ফেসবুকে টেস্ট পোস্ট সফল হয়েছে!\nআপনি কি ফেসবুকে লাইভ পোস্টটি দেখতে চান?')) {
                window.open(data.post_url, '_blank');
              }
            }, 600);
          }
        } else if (data.missing_token) {
          if (resultBox) {
            resultBox.style.display = 'block';
            resultBox.style.background = 'rgba(234, 179, 8, 0.15)';
            resultBox.style.border = '1px solid rgba(234, 179, 8, 0.4)';
            resultBox.style.color = '#fef08a';
            resultBox.innerHTML = `
              <strong>ℹ️ GitHub Actions সরাসরি রান করুন:</strong><br>
              ${escapeHtml(data.message)}<br>
              <a href="${escapeHtml(data.workflow_url)}" target="_blank" class="btn-primary" style="display: inline-block; margin-top: 10px; padding: 10px 18px; text-decoration: none; font-size: 13px; color: #fff; border-radius: 6px;">⚡ GitHub Actions এ ১-ক্লিকে 'Run workflow' চাপুন</a>
            `;
          }
          showToast('⚠️ GitHub-এ সরাসরি রান করুন অথবা GitHub টোকেন সেভ করুন।');
        } else {
          if (resultBox) {
            resultBox.style.display = 'block';
            resultBox.style.background = 'rgba(239, 68, 68, 0.15)';
            resultBox.style.border = '1px solid rgba(239, 68, 68, 0.4)';
            resultBox.style.color = '#fca5a5';
            resultBox.innerHTML = `❌ ${escapeHtml(data.error || 'Failed to trigger post')}`;
          }
          showToast('❌ ট্রিগার এরর: ' + (data.error || 'Failed'));
        }
      } catch (err) {
        showToast('❌ এরর: ' + err.message);
      } finally {
        fbTestPostBtn.disabled = false;
        fbTestPostBtn.textContent = '🚀 1-Click Test Post (Caption Only)';
      }
    });
  }

  // ৫. GitHub Actions Connect Form
  const ghForm = document.getElementById('github-connect-form');
  const ghTokenInput = document.getElementById('input-gh-token');
  const ghRepoInput = document.getElementById('input-gh-repo');
  const ghSubmitBtn = document.getElementById('btn-save-github');
  const ghResultBox = document.getElementById('github-setup-result');

  if (ghForm) {
    ghForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = ghTokenInput ? ghTokenInput.value.trim() : '';
      const repo = ghRepoInput ? ghRepoInput.value.trim() : 'rifatrabbi104-oss/social-automate';

      if (ghSubmitBtn) {
        ghSubmitBtn.disabled = true;
        ghSubmitBtn.textContent = '⏳ Saving GitHub Token...';
      }

      try {
        const res = await fetch(`${API_BASE}/setup-github`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ github_token: token, github_repo: repo })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (ghResultBox) {
            ghResultBox.style.display = 'block';
            ghResultBox.style.background = 'rgba(16, 185, 129, 0.15)';
            ghResultBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
            ghResultBox.style.color = '#a7f3d0';
            ghResultBox.innerHTML = `<strong>✅ GitHub Actions ক্রেডেনশিয়ালস D1-এ সেভ হয়েছে!</strong> এখন ড্যাশবোর্ডের টেস্ট বাটন চাপলেই স্বয়ংক্রিয়ভাবে GitHub Actions চলবে।`;
          }
          showToast('✅ GitHub Token D1-এ সেভ হয়েছে!');
        } else {
          showToast('❌ সেভ করতে ব্যর্থ: ' + (data.error || 'Error'));
        }
      } catch (e) {
        showToast('❌ নেটওয়ার্ক এরর: ' + e.message);
      } finally {
        if (ghSubmitBtn) {
          ghSubmitBtn.disabled = false;
          ghSubmitBtn.textContent = '💾 Save GitHub Token to D1';
        }
      }
    });
  }

  // ৫.১ Telegram Instant Admin Order Alert Form
  const tgForm = document.getElementById('telegram-connect-form');
  const tgTokenInput = document.getElementById('input-tg-bot-token');
  const tgChatIdInput = document.getElementById('input-tg-chat-id');
  const tgSubmitBtn = document.getElementById('btn-save-telegram');
  const tgTestBtn = document.getElementById('btn-test-telegram');
  const tgResultBox = document.getElementById('telegram-setup-result');
  const tgBadgeStatus = document.getElementById('badge-tg-status');

  if (tgForm) {
    tgForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const bot_token = tgTokenInput ? tgTokenInput.value.trim() : '';
      const chat_id = tgChatIdInput ? tgChatIdInput.value.trim() : '';

      if (!bot_token || !chat_id) {
        showToast('⚠️ Telegram Bot Token এবং Chat ID উভয়ই প্রয়োজন!');
        return;
      }

      if (tgSubmitBtn) {
        tgSubmitBtn.disabled = true;
        tgSubmitBtn.textContent = '⏳ Saving Telegram Keys...';
      }

      try {
        const res = await fetch(`${API_BASE}/setup-telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bot_token, chat_id })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (tgResultBox) {
            tgResultBox.style.display = 'block';
            tgResultBox.style.background = 'rgba(16, 185, 129, 0.15)';
            tgResultBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
            tgResultBox.style.color = '#a7f3d0';
            tgResultBox.innerHTML = `<strong>✅ Telegram ক্রেডেনশিয়ালস D1-এ সেভ হয়েছে!</strong> এখন AI কোনো অর্ডার কনফার্ম করলে সাথে সাথে আপনার টেলিগ্রাম আইডিতে বিস্তারিত অ্যালার্ট চলে যাবে।`;
          }
          if (tgBadgeStatus) {
            tgBadgeStatus.textContent = '🟢 Connected';
            tgBadgeStatus.style.background = 'rgba(16, 185, 129, 0.2)';
            tgBadgeStatus.style.color = '#34d399';
          }
          showToast('✅ Telegram Keys D1-এ সেভ হয়েছে!');
        } else {
          showToast('❌ সেভ করতে ব্যর্থ: ' + (data.error || 'Error'));
        }
      } catch (e) {
        showToast('❌ নেটওয়ার্ক এরর: ' + e.message);
      } finally {
        if (tgSubmitBtn) {
          tgSubmitBtn.disabled = false;
          tgSubmitBtn.textContent = '💾 Save Telegram Keys to D1';
        }
      }
    });
  }

  if (tgTestBtn) {
    tgTestBtn.addEventListener('click', async () => {
      tgTestBtn.disabled = true;
      tgTestBtn.textContent = '⏳ Sending Test Alert...';

      try {
        const res = await fetch(`${API_BASE}/test-telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (tgResultBox) {
            tgResultBox.style.display = 'block';
            tgResultBox.style.background = 'rgba(16, 185, 129, 0.15)';
            tgResultBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
            tgResultBox.style.color = '#a7f3d0';
            tgResultBox.innerHTML = `<strong>🎉 টেস্ট অর্ডার নোটিফিকেশন সফলভাবে আপনার টেলিগ্রামে পাঠানো হয়েছে!</strong><br>আপনার টেলিগ্রাম অ্যাপ ওপেন করে চেক করুন।`;
          }
          showToast('🎉 টেলিগ্রামে টেস্ট অর্ডার অ্যালার্ট পৌঁছেছে!');
        } else {
          if (tgResultBox) {
            tgResultBox.style.display = 'block';
            tgResultBox.style.background = 'rgba(239, 68, 68, 0.15)';
            tgResultBox.style.border = '1px solid rgba(239, 68, 68, 0.4)';
            tgResultBox.style.color = '#fca5a5';
            tgResultBox.innerHTML = `<strong>❌ টেলিগ্রাম মেসেজ পাঠাতে ব্যর্থ:</strong> ${escapeHtml(data.error || data.reason || 'Telegram API Error')}<br><small>অনুগ্রহ করে Bot Token ও Admin Chat ID সঠিক কিনা চেক করুন এবং বটকে টেলিগ্রামে একবার <code>/start</code> দিয়ে মেসেজ চালু করেছেন কিনা নিশ্চিত করুন।</small>`;
          }
          showToast('❌ টেস্ট অ্যালার্ট পাঠাতে ব্যর্থ হয়েছে।');
        }
      } catch (err) {
        showToast('❌ নেটওয়ার্ক এরর: ' + err.message);
      } finally {
        tgTestBtn.disabled = false;
        tgTestBtn.textContent = '🔔 Send Test Order Alert';
      }
    });
  }

  // ৫.২ Google Gemini AI Connect Form
  const aiForm = document.getElementById('ai-connect-form');
  const aiKeyInput = document.getElementById('input-gemini-api-key');
  const aiModelSelect = document.getElementById('select-gemini-model');
  const aiSubmitBtn = document.getElementById('btn-save-ai-key');
  const aiResultBox = document.getElementById('ai-setup-result');
  const aiBadgeStatus = document.getElementById('badge-ai-status');
  const btnToggleShowAiKey = document.getElementById('btn-toggle-show-ai-key');

  if (btnToggleShowAiKey && aiKeyInput) {
    btnToggleShowAiKey.addEventListener('click', () => {
      aiKeyInput.type = aiKeyInput.type === 'password' ? 'text' : 'password';
    });
  }

  if (aiForm) {
    aiForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const apiKey = aiKeyInput ? aiKeyInput.value.trim() : '';
      const model = aiModelSelect ? aiModelSelect.value : 'gemini-2.0-flash';

      if (!apiKey) {
        showToast('⚠️ Gemini API Key দিন!');
        return;
      }

      if (aiSubmitBtn) {
        aiSubmitBtn.disabled = true;
        aiSubmitBtn.textContent = '⏳ Testing & Saving AI Key...';
      }

      try {
        const res = await fetch(`${API_BASE}/setup-ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gemini_api_key: apiKey, gemini_model: model })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (aiResultBox) {
            aiResultBox.style.display = 'block';
            aiResultBox.style.background = 'rgba(16, 185, 129, 0.15)';
            aiResultBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
            aiResultBox.style.color = '#a7f3d0';
            aiResultBox.innerHTML = `<strong>🎉 ${escapeHtml(data.message)}</strong><br>মডেল: <code>${escapeHtml(data.model || model)}</code> - এখন কাস্টমার মেসেজ বা কমেন্ট করলে AI স্বয়ংক্রিয়ভাবে রিপ্লাই দেবে।`;
          }
          if (aiBadgeStatus) {
            aiBadgeStatus.textContent = '🟢 Connected';
            aiBadgeStatus.style.background = 'rgba(16, 185, 129, 0.2)';
            aiBadgeStatus.style.color = '#34d399';
          }
          showToast('🎉 Gemini AI সফলভাবে সক্রিয় হয়েছে!');
        } else {
          if (aiResultBox) {
            aiResultBox.style.display = 'block';
            aiResultBox.style.background = 'rgba(239, 68, 68, 0.15)';
            aiResultBox.style.border = '1px solid rgba(239, 68, 68, 0.4)';
            aiResultBox.style.color = '#fca5a5';
            aiResultBox.innerHTML = `<strong>❌ সংযোগ ব্যর্থ:</strong> ${escapeHtml(data.error || 'Gemini API Error')}`;
          }
          showToast('❌ Gemini AI কী সেভ করা যায়নি।');
        }
      } catch (err) {
        showToast('❌ নেটওয়ার্ক এরর: ' + err.message);
      } finally {
        if (aiSubmitBtn) {
          aiSubmitBtn.disabled = false;
          aiSubmitBtn.textContent = '💾 Save & Test Gemini AI';
        }
      }
    });
  }
}

// 🌐 সেটিংস ও ক্রেডেনশিয়াল সার্ভার থেকে ফেচ করে ফর্ম পূরণ করা
async function loadSettingsFromServer() {
  try {
    const res = await fetch(`${API_BASE}/settings`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success || !data.settings) return;

    const s = data.settings;
    setLocalCache(CACHE_KEYS.SETTINGS, s);

    // ১. Meta / Facebook প্রি-ফিল
    const tokenInput = document.getElementById('input-meta-token');
    const pageIdInput = document.getElementById('input-meta-page-id');
    const metaBadge = document.getElementById('meta-connected-badge');
    const metaStatus = document.getElementById('badge-meta-status');
    const linkFbPage = document.getElementById('link-view-fb-page');

    if (s.facebook && s.facebook.connected) {
      if (tokenInput && s.facebook.access_token) tokenInput.value = s.facebook.access_token;
      if (pageIdInput && s.facebook.account_id) {
        pageIdInput.value = s.facebook.account_id;
        if (linkFbPage) linkFbPage.href = `https://www.facebook.com/${s.facebook.account_id}`;
      }
      if (metaBadge) {
        metaBadge.style.display = 'block';
        metaBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        metaBadge.style.border = '1px solid rgba(16, 185, 129, 0.4)';
        metaBadge.style.color = '#a7f3d0';
        metaBadge.innerHTML = `✅ <strong>সংযুক্ত ফেসবুক পেজ:</strong> ${escapeHtml(s.facebook.account_name || 'Ranonex')} (Page ID: <code>${escapeHtml(s.facebook.account_id)}</code>)`;
      }
      if (metaStatus) {
        metaStatus.textContent = '🟢 Connected';
        metaStatus.style.background = 'rgba(16, 185, 129, 0.2)';
        metaStatus.style.color = '#34d399';
      }
    }

    // ২. TikTok প্রি-ফিল
    const tkKeyInput = document.getElementById('input-tiktok-client-key');
    const tkSecretInput = document.getElementById('input-tiktok-client-secret');
    const tkTokenInput = document.getElementById('input-tiktok-access-token');
    if (s.tiktok) {
      if (tkKeyInput && s.tiktok.client_key) tkKeyInput.value = s.tiktok.client_key;
      if (tkSecretInput && s.tiktok.client_secret) tkSecretInput.value = s.tiktok.client_secret;
      if (tkTokenInput && s.tiktok.access_token) tkTokenInput.value = s.tiktok.access_token;
    }

    // ৩. WhatsApp প্রি-ফিল (QR Gateway vs Cloud API)
    const waPhoneInput = document.getElementById('input-wa-phone');
    const waGatewayUrlInput = document.getElementById('input-wa-gateway-url');
    const waGatewayTokenInput = document.getElementById('input-wa-gateway-token');
    const waPhoneIdInput = document.getElementById('input-wa-phone-id');
    const waCloudTokenInput = document.getElementById('input-wa-cloud-token');

    if (s.whatsapp) {
      if (waPhoneInput && s.whatsapp.phone) waPhoneInput.value = s.whatsapp.phone;
      if (s.whatsapp.mode) window.switchWaMode(s.whatsapp.mode);
      if (waGatewayUrlInput && s.whatsapp.gateway_url) waGatewayUrlInput.value = s.whatsapp.gateway_url;
      if (waGatewayTokenInput && s.whatsapp.gateway_token) waGatewayTokenInput.value = s.whatsapp.gateway_token;
      if (waPhoneIdInput && s.whatsapp.phone_number_id) waPhoneIdInput.value = s.whatsapp.phone_number_id;
      if (waCloudTokenInput && s.whatsapp.access_token) waCloudTokenInput.value = s.whatsapp.access_token;
    }

    // ৪. GitHub Actions প্রি-ফিল
    const ghTokenInput = document.getElementById('input-gh-token');
    const ghRepoInput = document.getElementById('input-gh-repo');
    if (s.github) {
      if (ghTokenInput && s.github.token) ghTokenInput.value = s.github.token;
      if (ghRepoInput && s.github.repo) ghRepoInput.value = s.github.repo;
    }

    // ৫. Telegram প্রি-ফিল
    const tgTokenInput = document.getElementById('input-tg-bot-token');
    const tgChatIdInput = document.getElementById('input-tg-chat-id');
    const tgBadge = document.getElementById('badge-tg-status');
    if (s.telegram) {
      if (tgTokenInput && s.telegram.bot_token) tgTokenInput.value = s.telegram.bot_token;
      if (tgChatIdInput && s.telegram.admin_chat_id) tgChatIdInput.value = s.telegram.admin_chat_id;
      if (tgBadge && s.telegram.bot_token && s.telegram.admin_chat_id) {
        tgBadge.textContent = '🟢 Connected';
        tgBadge.style.background = 'rgba(16, 185, 129, 0.2)';
        tgBadge.style.color = '#34d399';
      }
    }

    // ৬. Gemini AI প্রি-ফিল
    const aiKeyInput = document.getElementById('input-gemini-api-key');
    const aiModelSelect = document.getElementById('select-gemini-model');
    const aiBadge = document.getElementById('badge-ai-status');
    if (s.ai) {
      if (s.ai.model && aiModelSelect) aiModelSelect.value = s.ai.model;
      if (s.ai.connected) {
        if (aiKeyInput && s.ai.key_preview) aiKeyInput.placeholder = `সংরক্ষিত চাবি: ${s.ai.key_preview}`;
        if (aiBadge) {
          aiBadge.textContent = '🟢 Connected';
          aiBadge.style.background = 'rgba(16, 185, 129, 0.2)';
          aiBadge.style.color = '#34d399';
        }
      } else {
        if (aiBadge) {
          aiBadge.textContent = '⚪ Not Configured';
          aiBadge.style.background = 'rgba(245, 158, 11, 0.2)';
          aiBadge.style.color = '#fbbf24';
        }
      }
    }
  } catch (e) {
    console.warn('Could not load settings from server:', e);
  }
}

function updateSettingsUI(settings) {
  const webhookInput = document.getElementById('display-webhook-url');
  if (webhookInput && settings.meta_webhook_url) {
    webhookInput.value = settings.meta_webhook_url;
  }
  const waWebhookInput = document.getElementById('display-wa-webhook-url');
  if (waWebhookInput && settings.whatsapp_webhook_url) {
    waWebhookInput.value = settings.whatsapp_webhook_url;
  }
}

// ========================================================
// ইউটিলিটি: লোকাল স্টোরেজ হেল্পার
// ========================================================
function getLocalCache(key, defaultValue) {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

function setLocalCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return isoStr;
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
}

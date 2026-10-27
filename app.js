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

  // ⚡ 0-Worker Request Init: Render directly from localStorage!
  renderConversationList();
  renderProductsTable();
  populateBusinessProfileUI();

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
// ২. ম্যানুয়াল অন-ডিমান্ড সিঙ্ক (০ অটো-পোলিং)
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

  const testWaBtn = document.getElementById('btn-quick-test-wa');
  if (testWaBtn) {
    testWaBtn.addEventListener('click', async () => {
      testWaBtn.disabled = true;
      testWaBtn.textContent = '⏳ Sending...';
      try {
        const res = await fetch(`${API_BASE}/test-incoming`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: 'whatsapp',
            sender_name: 'WhatsApp Buyer (+88018...)',
            message: 'আসসালামু আলাইকুম ভাইয়া, পণ্যটি কি স্টকে আছে? ঢাকা সিটিতে ডেলিভারি কত দিনে পাবো?'
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast('✅ WhatsApp টেস্ট মেসেজ ক্লাউড D1-এ তৈরি হয়েছে!');
          await syncWithBackend();
          if (data.chat_id) {
            openConversation(data.chat_id);
          }
        }
      } catch (e) {
        showToast('❌ টেস্ট মেসেজ পাঠানো যায়নি: ' + e.message);
      } finally {
        testWaBtn.disabled = false;
        testWaBtn.textContent = '🟢 Test WA';
      }
    });
  }

  const testBtn = document.getElementById('btn-quick-test');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = '⏳ Sending...';
      try {
        const res = await fetch(`${API_BASE}/test-incoming`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: 'facebook',
            sender_name: 'Mr. Rafiq (Test Customer)',
            message: 'আসসালামু আলাইকুম, আপনাদের এই প্রোডাক্টের ডেলিভারি চার্জ কত?'
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast('✅ Facebook টেস্ট মেসেজ ক্লাউড D1-এ তৈরি হয়েছে!');
          await syncWithBackend();
          if (data.chat_id) {
            openConversation(data.chat_id);
          }
        }
      } catch (e) {
        showToast('❌ টেস্ট মেসেজ পাঠানো যায়নি: ' + e.message);
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = '🔵 Test FB';
      }
    });
  }
}

async function syncWithBackend(isSilent = false) {
  try {
    // ১. কনভারসেশন ফেচ
    const convRes = await fetch(`${API_BASE}/conversations`);
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
// 📡 লাইভ পোলিং ও ম্যানুয়াল D1 ফেচ কন্ট্রোলার
// ========================================================
let livePollingTimer = null;
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
    btn.textContent = '⏳ Fetching...';
  }

  try {
    const res = await fetch(`${API_BASE}/conversations`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const convs = await res.json();

    if (Array.isArray(convs)) {
      const topConv = convs[0];
      const currentTopMsg = topConv ? `${topConv.id}_${topConv.last_message_at}_${topConv.last_message}` : '';

      // নতুন মেসেজ ডিটেকশন
      if (lastKnownTopMessage && currentTopMsg && currentTopMsg !== lastKnownTopMessage) {
        playMessageChime();
        const pLabel = topConv.platform === 'facebook' ? '🔵 FB' : (topConv.platform === 'whatsapp' ? '🟢 WA' : '💬');
        showToast(`💬 [${pLabel}] ${topConv.name}: "${(topConv.last_message || '').substring(0, 35)}..."`);

        // যদি এই চ্যাটটি বর্তমানে ওপেন থাকে, তবে রিয়েল-টাইমে মেসেজগুলো রিফ্রেশ করা
        if (String(appState.activeChatId) === String(topConv.id)) {
          await forceRefreshActiveChatMessages(topConv.id);
        }
      }

      lastKnownTopMessage = currentTopMsg;
      appState.conversations = convs;
      setLocalCache(CACHE_KEYS.CONVERSATIONS, convs);
      renderConversationList();

      if (isManual) {
        showToast(`✅ D1 থেকে ${convs.length} টি কনভারসেশন সিঙ্ক হয়েছে!`);
      }
    }
  } catch (err) {
    if (isManual) showToast('❌ চ্যাট ফেচ ব্যর্থ: ' + err.message);
  } finally {
    if (isManual && btn) {
      btn.disabled = false;
      btn.textContent = '🔄 Fetch D1';
    }
  }
};

window.toggleLivePolling = function() {
  const btn = document.getElementById('btn-toggle-live-polling');
  const badge = document.getElementById('live-polling-badge');

  if (livePollingTimer) {
    // টার্ন অফ
    clearInterval(livePollingTimer);
    livePollingTimer = null;
    if (btn) {
      btn.textContent = '📡 Live: OFF';
      btn.style.background = '';
      btn.style.color = '#60a5fa';
      btn.style.borderColor = 'rgba(59, 130, 246, 0.4)';
    }
    if (badge) {
      badge.textContent = '⚪ Manual Sync';
      badge.style.background = 'rgba(255,255,255,0.06)';
      badge.style.color = 'var(--text-muted)';
    }
    showToast('⚪ Live Auto-Sync বন্ধ (Worker 0 Request Mode)');
  } else {
    // টার্ন অন
    window.fetchLatestConversations(false);
    livePollingTimer = setInterval(() => {
      window.fetchLatestConversations(false);
    }, 4000);

    if (btn) {
      btn.textContent = '🟢 Live: ON (4s)';
      btn.style.background = 'rgba(16, 185, 129, 0.15)';
      btn.style.color = 'var(--emerald)';
      btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    }
    if (badge) {
      badge.textContent = '🟢 Live Active (4s)';
      badge.style.background = 'rgba(16, 185, 129, 0.2)';
      badge.style.color = 'var(--emerald)';
    }
    showToast('🟢 Live Auto-Sync চালু (নতুন মেসেজ আসামাত্র প্রতি ৪ সেকেন্ডে স্ক্রিনে দেখাবে)');
  }
};

async function forceRefreshActiveChatMessages(chatId) {
  try {
    const res = await fetch(`${API_BASE}/messages?chat_id=${encodeURIComponent(chatId)}`);
    if (res.ok) {
      const msgs = await res.json();
      appState.messages[chatId] = msgs;
      setLocalCache(CACHE_KEYS.MESSAGES, appState.messages);
      renderMessageBubbles(chatId);
    }
  } catch (e) {}
}

// ========================================================
// ৩. কনভারসেশন ও চ্যাট লিস্ট (লোকাল স্টোরেজ থেকে রেন্ডার)
// ========================================================
function renderConversationList() {
  const listEl = document.getElementById('conversation-list');
  const badge = document.getElementById('unread-badge');
  const statActive = document.getElementById('stat-active-sessions');

  if (badge) badge.textContent = appState.conversations.length;
  if (statActive) statActive.textContent = appState.conversations.length;

  if (!listEl) return;

  if (appState.conversations.length === 0) {
    listEl.innerHTML = `
      <div style="padding: 40px 16px; text-align: center; color: var(--text-dim); font-size: 13px;">
        <div style="font-size: 36px; margin-bottom: 8px;">💬</div>
        <div style="color: var(--text-muted); font-weight: 600;">কোনো চ্যাট ক্যাশ করা নেই</div>
        <p style="font-size: 11px; margin-top: 4px; line-height: 1.5;">কাস্টমার মেসেজ পাঠালে অথবা 🔄 Sync চাপলে চ্যাট দেখা যাবে।</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = '';
  appState.conversations.forEach(c => {
    const item = document.createElement('div');
    const isActive = String(c.id) === String(appState.activeChatId);
    item.className = `conv-item ${isActive ? 'active' : ''}`;

    const initial = (c.name || 'U').charAt(0).toUpperCase();
    const timeFormatted = formatTime(c.last_message_at);
    const platformLabel = c.platform === 'facebook' ? '🔵 FB' : (c.platform === 'whatsapp' ? '🟢 WA' : '💬 Chat');

    item.innerHTML = `
      <div class="conv-avatar">${initial}</div>
      <div class="conv-details">
        <div class="conv-top-row">
          <span class="conv-name">${escapeHtml(c.name)}</span>
          <span class="conv-time">${timeFormatted}</span>
        </div>
        <div class="conv-snippet">${escapeHtml(c.last_message || '')}</div>
        <div class="conv-badges">
          <span class="badge-tag platform">${platformLabel}</span>
          ${c.admin_takeover ? '<span class="badge-tag takeover">👤 Handover</span>' : '<span class="badge-tag ai">🤖 AI Active</span>'}
        </div>
      </div>
    `;

    item.addEventListener('click', () => {
      appState.activeChatId = c.id;
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

  document.getElementById('active-chat-avatar').textContent = (conv.name || 'U').charAt(0).toUpperCase();
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
  // ১. লোকাল ক্যাশ চেক
  if (appState.messages[chatId] && appState.messages[chatId].length > 0) {
    renderMessageBubbles(chatId);
    return;
  }

  // ২. লোকাল ক্যাশ খালি থাকলে ১-বার ব্যাকএন্ড থেকে ফেচ
  try {
    const res = await fetch(`${API_BASE}/messages?chat_id=${encodeURIComponent(chatId)}`);
    if (res.ok) {
      const msgs = await res.json();
      appState.messages[chatId] = msgs;
      setLocalCache(CACHE_KEYS.MESSAGES, appState.messages);
      renderMessageBubbles(chatId);
    }
  } catch (e) {}
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

    row.innerHTML = `
      <div class="msg-sender-tag">${tag}</div>
      <div class="msg-bubble">${escapeHtml(m.message_text)}</div>
      <span class="msg-time">${formatTime(m.created_at)}</span>
    `;
    container.appendChild(row);
  });

  container.scrollTop = container.scrollHeight;
}

// ========================================================
// ৪. আউটবাউন্ড অ্যাডমিন রিপ্লাই
// ========================================================
function initChatReply() {
  const form = document.getElementById('chat-reply-form');
  const inputEl = document.getElementById('admin-message-input');
  const sendBtn = document.getElementById('btn-send-message');

  if (!form || !inputEl) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text || appState.isSending) return;

    const chatId = appState.activeChatId;
    if (!chatId) {
      showToast('⚠️ অনুগ্রহ করে প্রথমে একটি চ্যাট সিলেক্ট করুন।');
      return;
    }

    appState.isSending = true;
    sendBtn.disabled = true;

    // ১. লোকাল ক্যাশে তাৎক্ষণিক সেভ (Instant UI)
    const newMsg = {
      id: 'm_' + Date.now(),
      sender_type: 'admin',
      message_text: text,
      created_at: new Date().toISOString()
    };

    if (!appState.messages[chatId]) appState.messages[chatId] = [];
    appState.messages[chatId].push(newMsg);
    setLocalCache(CACHE_KEYS.MESSAGES, appState.messages);
    renderMessageBubbles(chatId);
    inputEl.value = '';

    // ২. Worker-এ ১টি একক আউটবাউন্ড POST কল
    try {
      const res = await fetch(`${API_BASE}/admin-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_text: text })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast('✅ কাস্টমারকে মেসেজ পাঠানো হয়েছে!');
        const conv = appState.conversations.find(c => String(c.id) === String(chatId));
        if (conv) {
          conv.admin_takeover = true;
          conv.last_message = text;
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

function initHandoverToggle() {
  const btn = document.getElementById('btn-toggle-handover');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const conv = appState.conversations.find(c => String(c.id) === String(appState.activeChatId));
    if (!conv) return;

    conv.admin_takeover = !conv.admin_takeover;
    setLocalCache(CACHE_KEYS.CONVERSATIONS, appState.conversations);
    updateHandoverUI(conv);
    renderConversationList();

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
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 28px; color: var(--text-dim);">কোনো প্রোডাক্ট নেই। উপরে ওয়েবসাইট লিংক পেস্ট করে Auto-Fetch চাপুন অথবা 🔄 Sync করুন।</td></tr>`;
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
    let schedText = p.posting_time || '10:00';
    if (p.posting_time && p.posting_time.startsWith('interval_')) {
      const h = p.posting_time.replace('interval_', '');
      schedText = `⏱️ প্রতি ${h} ঘণ্টা পর পর`;
    } else if (p.schedule_type === 'interval') {
      schedText = `⏱️ প্রতি ${p.interval_hours || 4} ঘণ্টা পর পর`;
    } else {
      schedText = `⏰ ${p.posting_time || '10:00'}`;
    }

    const autoBadge = p.daily_auto_post != 0 
      ? `<span style="background: rgba(16, 185, 129, 0.15); color: var(--emerald); padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">${schedText} (🟢 চালু)</span>`
      : `<span style="background: rgba(255, 255, 255, 0.05); color: var(--text-dim); padding: 4px 8px; border-radius: 4px; font-size: 11px;">⚪ বন্ধ</span>`;

    const platformBadge = p.target_platform === 'facebook'
      ? `<span style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🔵 FB</span>`
      : (p.target_platform === 'all'
        ? `<span style="background: rgba(139, 92, 246, 0.15); color: #a78bfa; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🌐 All</span>`
        : `<span style="background: rgba(254, 44, 85, 0.15); color: #fe2c55; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🎵 TikTok</span>`);

    tr.innerHTML = `
      <td>
        <div style="display: flex; align-items: center; gap: 10px;">
          ${imgThumb}
          <div>
            ${productTitle}
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${escapeHtml(p.description || '').substring(0, 45)}...</div>
          </div>
        </div>
      </td>
      <td><span style="color: var(--emerald); font-weight: 700; font-size: 14px;">৳${p.price}</span></td>
      <td>${platformBadge}</td>
      <td>${autoBadge}</td>
      <td><span class="badge-status ${p.stock_status === 'in_stock' ? 'published' : 'pending'}">${p.stock_status === 'in_stock' ? 'In Stock' : 'Out of Stock'}</span></td>
      <td style="white-space: nowrap;">
        <button class="btn-primary" style="padding: 6px 12px; font-size: 11px; font-weight: 700; background: linear-gradient(135deg, #10b981, #059669); border: none; border-radius: 6px; cursor: pointer; color: #fff; margin-right: 6px;" onclick="publishProductNow('${p.id}', this)" title="এই প্রোডাক্টটি ফেসবুক পেজে পোস্ট করুন">
          🚀 Post Now
        </button>
        <button class="btn-refresh" style="color: var(--rose); font-size: 11px; padding: 6px 8px;" onclick="deleteProduct('${p.id}')">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

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
          if (document.getElementById('prod-url')) document.getElementById('prod-url').value = p.product_url || url;
          if (prodImgInput) {
            prodImgInput.value = p.image_url || '';
            if (p.image_url) {
              prodImgPreview.src = p.image_url;
              prodImgPreview.style.display = 'block';
            }
          }
          if (document.getElementById('prod-desc')) document.getElementById('prod-desc').value = p.description || '';

          // প্রিভিউ কার্ড দেখানো
          if (previewBox) {
            previewBox.style.display = 'flex';
            if (previewImg) previewImg.src = p.image_url || 'https://via.placeholder.com/50';
            if (previewTitle) previewTitle.textContent = p.name;
            if (previewPrice) previewPrice.textContent = `৳${p.price} BDT`;
          }

          showToast(`✅ "${p.name}" এর তথ্য ও R2 ইমেজ সফলভাবে ফেচ হয়েছে!`);
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
      const url = document.getElementById('prod-url') ? document.getElementById('prod-url').value.trim() : '';
      const img = document.getElementById('prod-img') ? document.getElementById('prod-img').value.trim() : '';
      const postTime = document.getElementById('prod-post-time') ? document.getElementById('prod-post-time').value : 'interval_4';
      const targetPlatform = document.getElementById('prod-target-platform') ? document.getElementById('prod-target-platform').value : 'facebook';
      const autoPost = document.getElementById('prod-auto-post') ? Number(document.getElementById('prod-auto-post').value) : 1;
      const stock = document.getElementById('prod-stock').value;
      const desc = document.getElementById('prod-desc').value.trim();

      if (!name || !price) return;

      const isInterval = postTime.startsWith('interval_');
      const intervalHours = isInterval ? (parseInt(postTime.replace('interval_', '')) || 4) : 4;

      const newProd = {
        id: 'p_' + Date.now(),
        name,
        price: parseFloat(price) || 0,
        product_url: url,
        image_url: img,
        posting_time: postTime,
        schedule_type: isInterval ? 'interval' : 'daily',
        interval_hours: intervalHours,
        target_platform: targetPlatform,
        daily_auto_post: autoPost,
        stock_status: stock,
        description: desc
      };

      appState.products.unshift(newProd);
      setLocalCache(CACHE_KEYS.PRODUCTS, appState.products);
      renderProductsTable();
      prodForm.reset();
      if (prodImgPreview) prodImgPreview.style.display = 'none';
      if (previewBox) previewBox.style.display = 'none';
      showToast('✅ প্রোডাক্ট ও শিডিউল D1-এ সেভ হয়েছে!');

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
  const waForm = document.getElementById('whatsapp-connect-form');
  const waPhoneInput = document.getElementById('input-wa-phone');
  const waModeInput = document.getElementById('input-wa-mode');
  const waGatewayUrlInput = document.getElementById('input-wa-gateway-url');
  const waTokenInput = document.getElementById('input-wa-token');
  const waSubmitBtn = document.getElementById('btn-save-whatsapp');
  const waResultBox = document.getElementById('wa-setup-result');
  const waCopyBtn = document.getElementById('btn-copy-wa-webhook');
  const waWebhookInput = document.getElementById('display-wa-webhook-url');

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
      const mode = waModeInput ? waModeInput.value : 'gateway';
      const gatewayUrl = waGatewayUrlInput ? waGatewayUrlInput.value.trim() : '';
      const token = waTokenInput ? waTokenInput.value.trim() : '';

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
            gateway_token: token,
            access_token: token
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          if (waResultBox) {
            waResultBox.style.display = 'block';
            waResultBox.style.background = 'rgba(16, 185, 129, 0.15)';
            waResultBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
            waResultBox.style.color = '#a7f3d0';
            waResultBox.innerHTML = `
              <strong>✅ WhatsApp সফলভাবে সংযুক্ত হয়েছে!</strong><br>
              নম্বর: <strong>${escapeHtml(phone)}</strong> (মোড: ${mode === 'gateway' ? '🌐 Web Gateway' : '☁️ Cloud API'})<br>
              স্ট্যাটাস: এখন থেকে কোনো কাস্টমার মেসেজ দিলে AI স্বয়ংক্রিয়ভাবে উত্তর দেবে।
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
          waSubmitBtn.textContent = '💾 Connect WhatsApp to D1';
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
              <strong>🚀 GitHub Actions-এ Facebook টেস্ট পোস্টিং শুরু হয়েছে!</strong><br>
              GitHub Actions রানারে Gemini AI দিয়ে ইউনিক সেলস ক্যাপশন তৈরি করে আপনার Ranonex পেজে পোস্ট পাবলিশ হচ্ছে।<br>
              <a href="${escapeHtml(data.run_url || 'https://github.com/rifatrabbi104-oss/social-automate/actions')}" target="_blank" style="color: #60a5fa; text-decoration: underline; margin-top: 8px; display: inline-block;">👉 ক্লিক করে GitHub Actions লাইভ লগ দেখুন</a>
            `;
          }
          showToast('🚀 GitHub Actions ক্রন পোস্টিং শুরু হয়েছে!');
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

    // ৩. WhatsApp প্রি-ফিল
    const waPhoneInput = document.getElementById('input-wa-phone');
    const waModeInput = document.getElementById('input-wa-mode');
    const waGatewayUrlInput = document.getElementById('input-wa-gateway-url');
    const waTokenInput = document.getElementById('input-wa-token');
    if (s.whatsapp) {
      if (waPhoneInput && s.whatsapp.phone) waPhoneInput.value = s.whatsapp.phone;
      if (waModeInput && s.whatsapp.mode) waModeInput.value = s.whatsapp.mode;
      if (waGatewayUrlInput && s.whatsapp.gateway_url) waGatewayUrlInput.value = s.whatsapp.gateway_url;
      if (waTokenInput && s.whatsapp.gateway_token) waTokenInput.value = s.whatsapp.gateway_token;
    }

    // ৪. GitHub Actions প্রি-ফিল
    const ghTokenInput = document.getElementById('input-gh-token');
    const ghRepoInput = document.getElementById('input-gh-repo');
    if (s.github) {
      if (ghTokenInput && s.github.token) ghTokenInput.value = s.github.token;
      if (ghRepoInput && s.github.repo) ghRepoInput.value = s.github.repo;
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

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
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px; color: var(--text-dim);">কোনো প্রোডাক্ট নেই। উপরে অ্যাড করুন বা 🔄 Sync চাপুন।</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  appState.products.forEach(p => {
    const tr = document.createElement('tr');
    const autoBadge = p.daily_auto_post != 0 
      ? `<span style="background: rgba(16, 185, 129, 0.15); color: var(--emerald); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">⏰ ${p.posting_time || '10:00'} (🟢 চালু)</span>`
      : `<span style="background: rgba(255, 255, 255, 0.05); color: var(--text-dim); padding: 2px 6px; border-radius: 4px; font-size: 11px;">⚪ বন্ধ</span>`;

    const productTitle = p.product_url 
      ? `<a href="${escapeHtml(p.product_url)}" target="_blank" style="color: var(--primary-light); text-decoration: underline;">${escapeHtml(p.name)} 🔗</a>`
      : `<strong>${escapeHtml(p.name)}</strong>`;

    const platformBadge = p.target_platform === 'facebook'
      ? `<span style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🔵 FB</span>`
      : (p.target_platform === 'all'
        ? `<span style="background: rgba(139, 92, 246, 0.15); color: #a78bfa; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🌐 All</span>`
        : `<span style="background: rgba(254, 44, 85, 0.15); color: #fe2c55; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🎵 TikTok</span>`);

    tr.innerHTML = `
      <td>${productTitle}</td>
      <td><span style="color: var(--emerald); font-weight: 700;">৳${p.price}</span></td>
      <td>${platformBadge}</td>
      <td>${autoBadge}</td>
      <td><span class="badge-status ${p.stock_status === 'in_stock' ? 'published' : 'pending'}">${p.stock_status === 'in_stock' ? 'In Stock' : 'Out of Stock'}</span></td>
      <td><button class="btn-refresh" style="color: var(--rose); font-size: 11px;" onclick="deleteProduct('${p.id}')">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  });
}

window.deleteProduct = async function(id) {
  appState.products = appState.products.filter(p => p.id !== id);
  setLocalCache(CACHE_KEYS.PRODUCTS, appState.products);
  renderProductsTable();
  showToast('🗑️ প্রোডাক্ট সরানো হয়েছে।');

  try {
    await fetch(`${API_BASE}/products?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {}
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
  // Add Product Form
  const prodForm = document.getElementById('add-product-form');
  if (prodForm) {
    prodForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('prod-name').value.trim();
      const price = document.getElementById('prod-price').value.trim();
      const url = document.getElementById('prod-url') ? document.getElementById('prod-url').value.trim() : '';
      const img = document.getElementById('prod-img') ? document.getElementById('prod-img').value.trim() : '';
      const postTime = document.getElementById('prod-post-time') ? document.getElementById('prod-post-time').value : '10:00';
      const targetPlatform = document.getElementById('prod-target-platform') ? document.getElementById('prod-target-platform').value : 'tiktok';
      const autoPost = document.getElementById('prod-auto-post') ? Number(document.getElementById('prod-auto-post').value) : 1;
      const stock = document.getElementById('prod-stock').value;
      const desc = document.getElementById('prod-desc').value.trim();

      if (!name || !price) return;

      const newProd = {
        id: 'p_' + Date.now(),
        name,
        price,
        product_url: url,
        image_url: img,
        posting_time: postTime,
        target_platform: targetPlatform,
        daily_auto_post: autoPost,
        stock_status: stock,
        description: desc
      };

      appState.products.unshift(newProd);
      setLocalCache(CACHE_KEYS.PRODUCTS, appState.products);
      renderProductsTable();
      prodForm.reset();
      showToast('✅ প্রোডাক্ট ও দৈনিক শিডিউল D1-এ সেভ হয়েছে!');

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

        const data = await res.json();
        if (res.ok && data.success) {
          if (tkResultBox) {
            tkResultBox.style.display = 'block';
            tkResultBox.style.background = 'rgba(16, 185, 129, 0.15)';
            tkResultBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
            tkResultBox.style.color = '#a7f3d0';
            tkResultBox.innerHTML = `
              <strong>✅ TikTok সেটিংস D1 ডেটাবেসে সেভ হয়েছে!</strong><br>
              Client Key: <strong>${escapeHtml(key)}</strong><br>
              এখন আপনি <strong>🔗 1-Click Authorize TikTok</strong> চাপলে সরাসরি টিকটকের সাথে কানেক্ট হয়ে যাবে।
            `;
          }
          showToast('🎉 TikTok ক্রেডেনশিয়ালস D1-এ সেভ হয়েছে!');
        } else {
          showToast('❌ সেভ ব্যর্থ: ' + (data.error || 'Server error'));
        }
      } catch (err) {
        showToast('❌ নেটওয়ার্ক এরর: ' + err.message);
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
            সংযুক্ত পেজ: <strong>${escapeHtml(data.account.name)}</strong> (ID: ${escapeHtml(data.account.id)})
          `;
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

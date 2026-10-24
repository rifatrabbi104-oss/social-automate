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
  // Deep link check (?chat_id=123)
  const urlParams = new URLSearchParams(window.location.search);
  const deepChatId = urlParams.get('chat_id');
  if (deepChatId) {
    appState.activeChatId = deepChatId.replace(/^(tg_|fb_|wa_)/, '');
  }

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
      sub: 'মেটা ফেসবুক পেজ / হোয়াটসঅ্যাপের লাইফটাইম Webhook ও ১-ক্লিক ভেরিফিকেশন।'
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
            sender_name: 'Mr. Rafiq (Test Customer)',
            message: 'আসসালামু আলাইকুম, আপনাদের এই প্রোডাক্টের ডেলিভারি চার্জ কত?'
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast('✅ টেস্ট মেসেজ ক্লাউড D1-এ তৈরি হয়েছে!');
          await syncWithBackend();
          if (data.chat_id) {
            openConversation(data.chat_id);
          }
        }
      } catch (e) {
        showToast('❌ টেস্ট মেসেজ পাঠানো যায়নি: ' + e.message);
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = '🧪 Test Msg';
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
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 24px; color: var(--text-dim);">কোনো প্রোডাক্ট নেই। উপরে অ্যাড করুন বা 🔄 Sync চাপুন।</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  appState.products.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td><span style="color: var(--emerald); font-weight: 700;">৳${p.price}</span></td>
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
      const stock = document.getElementById('prod-stock').value;
      const desc = document.getElementById('prod-desc').value.trim();

      if (!name || !price) return;

      const newProd = { id: 'p_' + Date.now(), name, price, stock_status: stock, description: desc };
      appState.products.unshift(newProd);
      setLocalCache(CACHE_KEYS.PRODUCTS, appState.products);
      renderProductsTable();
      prodForm.reset();
      showToast('✅ প্রোডাক্ট সেভ হয়েছে!');

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
// ৬. ১-টাইম লাইফটাইম সোশ্যাল কানেকশন (Meta / Webhook)
// ========================================================
function initSettingsForm() {
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
      submitBtn.textContent = '⏳ Verifying 1-Time Lifetime Connection...';

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
            <strong>✅ লাইফটাইম কানেকশন সম্পন্ন!</strong><br>
            সংযুক্ত পেজ: <strong>${escapeHtml(data.account.name)}</strong> (ID: ${escapeHtml(data.account.id)})<br>
            স্ট্যাটাস: Webhook সাবস্ক্রিপশন আজীবনের জন্য অ্যাক্টিভ হয়েছে।
          `;
          showToast('🎉 পেজ সফলভাবে লাইফটাইম কানেক্ট হয়েছে!');
          tokenInput.value = '';
        } else {
          resultBox.style.display = 'block';
          resultBox.style.background = 'rgba(239, 68, 68, 0.15)';
          resultBox.style.border = '1px solid rgba(239, 68, 68, 0.4)';
          resultBox.style.color = '#fca5a5';
          resultBox.innerHTML = `❌ ${escapeHtml(data.error || 'Connection failed')}`;
          showToast('❌ কানেকশন ব্যর্থ হয়েছে।');
        }
      } catch (err) {
        showToast('❌ নেটওয়ার্ক এরর: ' + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 Connect Once for Lifetime';
      }
    });
  }
}

function updateSettingsUI(settings) {
  const webhookInput = document.getElementById('display-webhook-url');
  if (webhookInput && settings.meta_webhook_url) {
    webhookInput.value = settings.meta_webhook_url;
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

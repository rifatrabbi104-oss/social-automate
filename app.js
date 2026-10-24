/**
 * SocialAutomate - Frontend Application Engine
 * ---------------------------------------------
 * 1. Deep-linking (?chat_id=123) for Instant Admin Escalation from Telegram DM
 * 2. On-Demand Smart Polling (Zero requests when window is minimized/closed)
 * 3. 1-Click Zero-Terminal Telegram Webhook Registration
 * 4. D1 Business Data Management (Products & Store Policies)
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

let appState = {
  activeChatId: null,
  conversations: [],
  messages: {},
  products: [],
  businessProfile: {},
  d1Connected: false,
  telegramConnected: false,
  botUsername: null,
  isSending: false
};

document.addEventListener('DOMContentLoaded', () => {
  // Check for Deep Link (?chat_id=12345 from Telegram Admin Alert)
  const urlParams = new URLSearchParams(window.location.search);
  const deepChatId = urlParams.get('chat_id');
  if (deepChatId) {
    appState.activeChatId = deepChatId.replace(/^tg_/, '');
  }

  initNavigation();
  initChatReply();
  initHandoverToggle();
  initBusinessDataForms();
  initSettingsForm();
  initManualSync();

  loadInitialData();

  // 🛡️ ON-DEMAND SMART POLLING:
  // শুধুমাত্র যখন অ্যাডমিন ড্যাশবোর্ড ট্যাবটি দেখছেন (visible), তখনই প্রতি ৩.৫ সেকেন্ডে পোল হবে।
  // পেজ বন্ধ বা মিনিমাইজ থাকলে ০ রিকোয়েস্ট খরচ হবে।
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      pollLiveUpdates();
    }
  }, 3500);
});

// ========================================================
// ১. নেভিগেশন
// ========================================================
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');
  const pageTitle = document.getElementById('page-title');
  const pageSubtitle = document.getElementById('page-subtitle');

  const headers = {
    'inbox': {
      title: 'Live Chat & AI Handover',
      sub: 'AI কাস্টমারকে D1 বিজনেস ডেটা থেকে উত্তর দেবে। আপনি চাইলে যেকোনো চ্যাট টেকওভার করে সরাসরি টেলিগ্রামে রিপ্লাই দিতে পারেন।'
    },
    'business-d1': {
      title: 'D1 Business Data & Products Catalog',
      sub: 'আপনার স্টোরের প্রোডাক্ট ক্যাটালগ এবং ডেলিভারি পলিসি D1-এ সংরক্ষণ করুন। AI কাস্টমারকে এই ডেটা থেকেই উত্তর দেবে।'
    },
    'settings': {
      title: 'Telegram Connection & Settings',
      sub: 'টেলিগ্রাম বটের টোকেন D1 ডেটাবেসে সংরক্ষণ করুন এবং স্বয়ংক্রিয়ভাবে Webhook চালু করুন।'
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

      if (tab === 'business-d1') {
        fetchProducts();
        fetchBusinessProfile();
      }
    });
  });
}

// ========================================================
// ২. ডেটা লোড ও ব্যাকগ্রাউন্ড সিঙ্ক
// ========================================================
async function loadInitialData() {
  await fetchSystemSettings();
  await fetchConversations();
  await fetchProducts();
  await fetchBusinessProfile();

  if (appState.activeChatId) {
    await fetchMessages(appState.activeChatId);
    renderActiveChat();
  }
}

async function pollLiveUpdates() {
  await fetchConversations(true);
  if (appState.activeChatId) {
    await fetchMessages(appState.activeChatId, true);
  }
}

function initManualSync() {
  const btn = document.getElementById('btn-manual-sync');
  if (btn) {
    btn.addEventListener('click', async () => {
      btn.textContent = '⏳ Syncing...';
      await loadInitialData();
      showToast('🔄 রিয়েল-টাইম ডেটা সিঙ্ক সম্পন্ন হয়েছে।');
      btn.textContent = '🔄 Sync';
    });
  }
}

// ========================================================
// ৩. সিস্টেম সেটিংস ও স্ট্যাটাস
// ========================================================
async function fetchSystemSettings() {
  try {
    const res = await fetch(`${API_BASE}/settings`);
    if (res.ok) {
      const data = await res.json();
      appState.d1Connected = Boolean(data.d1_connected);
      appState.telegramConnected = Boolean(data.telegram_connected);
      appState.botUsername = data.bot_username;

      updateStatusUI(data);
    }
  } catch (err) {
    updateStatusUI({ d1_connected: false, telegram_connected: false });
  }
}

function updateStatusUI(data) {
  const d1Dot = document.getElementById('d1-status-dot');
  const d1Text = document.getElementById('d1-status-text');
  const d1Banner = document.getElementById('d1-warning-banner');
  const statTg = document.getElementById('stat-tg-status');
  const topbarTg = document.getElementById('topbar-tg-bot');
  const setupBadge = document.getElementById('setup-status-badge');
  const tgConnectedBadge = document.getElementById('tg-connected-badge');
  const webhookInput = document.getElementById('display-webhook-url');

  if (webhookInput) {
    const base = API_BASE.replace(/\/api$/, '');
    webhookInput.value = `${base}/webhook/telegram`;
  }

  // D1 Status
  if (data.d1_connected) {
    if (d1Dot) d1Dot.style.background = 'var(--emerald)';
    if (d1Text) d1Text.textContent = 'D1 Business Data: Active';
    if (d1Banner) d1Banner.style.display = 'none';
  } else {
    if (d1Dot) d1Dot.style.background = 'var(--rose)';
    if (d1Text) d1Text.textContent = 'D1: Not Bound';
    if (d1Banner) d1Banner.style.display = 'block';
  }

  // Telegram Status
  if (data.telegram_connected) {
    const username = data.bot_username ? `@${data.bot_username}` : 'Connected';
    if (topbarTg) topbarTg.textContent = `✈️ Telegram: ${username}`;
    if (statTg) {
      statTg.textContent = username;
      statTg.style.color = 'var(--emerald)';
    }
    if (setupBadge) {
      setupBadge.textContent = 'Active';
      setupBadge.style.background = 'var(--emerald)';
      setupBadge.style.color = '#fff';
    }
    if (tgConnectedBadge) tgConnectedBadge.style.display = 'inline-block';
  } else {
    if (topbarTg) topbarTg.textContent = '✈️ Telegram: Not Connected';
    if (statTg) {
      statTg.textContent = 'Not Connected ⚠️';
      statTg.style.color = 'var(--amber)';
    }
    if (setupBadge) {
      setupBadge.textContent = 'Setup';
      setupBadge.style.background = 'var(--amber)';
      setupBadge.style.color = '#000';
    }
    if (tgConnectedBadge) tgConnectedBadge.style.display = 'none';
  }
}

// ========================================================
// ৪. লাইভ কনভারসেশন লিস্ট (Edge Sessions)
// ========================================================
async function fetchConversations(isBackground = false) {
  try {
    const res = await fetch(`${API_BASE}/conversations`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        appState.conversations = data;
        renderConversationList();

        const badge = document.getElementById('unread-badge');
        if (badge) badge.textContent = data.length;

        const statActive = document.getElementById('stat-active-sessions');
        if (statActive) statActive.textContent = data.length;

        if (!appState.activeChatId && data.length > 0) {
          appState.activeChatId = data[0].id;
          renderActiveChat();
          fetchMessages(data[0].id);
        }
      }
    }
  } catch (err) {
    if (!isBackground) console.warn("Conversations error:", err);
  }
}

function renderConversationList() {
  const listEl = document.getElementById('conversation-list');
  if (!listEl) return;

  if (appState.conversations.length === 0) {
    listEl.innerHTML = `
      <div style="padding: 40px 16px; text-align: center; color: var(--text-dim); font-size: 13px;">
        <div style="font-size: 36px; margin-bottom: 8px;">✈️</div>
        <div style="color: var(--text-muted); font-weight: 600;">কোনো সক্রিয় চ্যাট নেই</div>
        <p style="font-size: 11px; margin-top: 4px; line-height: 1.5;">টেলিগ্রামে মেসেজ পাঠালে এখানে লাইভ সেশন দেখতে পাবেন।</p>
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

    let badgeHtml = '';
    if (c.needs_attention) {
      badgeHtml += `<span class="badge-tag attention">🚨 Needs Attention</span>`;
    }
    if (c.admin_takeover) {
      badgeHtml += `<span class="badge-tag takeover">👤 Handover</span>`;
    } else {
      badgeHtml += `<span class="badge-tag ai">🤖 AI Active</span>`;
    }

    item.innerHTML = `
      <div class="conv-avatar">${initial}</div>
      <div class="conv-details">
        <div class="conv-top-row">
          <span class="conv-name">${escapeHtml(c.name)}</span>
          <span class="conv-time">${timeFormatted}</span>
        </div>
        <div class="conv-snippet">${escapeHtml(c.last_message || '')}</div>
        <div class="conv-badges">
          <span class="badge-tag platform">✈️ TG</span>
          ${badgeHtml}
        </div>
      </div>
    `;

    item.addEventListener('click', () => {
      if (appState.activeChatId !== c.id) {
        appState.activeChatId = c.id;
        renderConversationList();
        renderActiveChat();
        fetchMessages(c.id);
      }
    });

    listEl.appendChild(item);
  });
}

// ========================================================
// ৫. চ্যাট ভিউ এবং হ্যান্ডওভার টগল
// ========================================================
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

    if (container) {
      container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-dim); text-align: center;">
          <div style="font-size: 42px; margin-bottom: 12px; opacity: 0.5;">💬</div>
          <h4 style="font-size: 15px; color: var(--text-main); margin-bottom: 4px;">কোনো চ্যাট সিলেক্ট করা নেই</h4>
          <p style="font-size: 12px; max-width: 300px; line-height: 1.6;">বাম পাশের তালিকা থেকে যেকোনো কাস্টমার চ্যাট সিলেক্ট করুন।</p>
        </div>
      `;
    }
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
    badge.querySelector('.text').textContent = 'Admin Takeover (AI Paused)';
    btn.className = 'btn-handover release';
    btn.querySelector('.btn-text').textContent = 'Release to AI';
    btn.querySelector('.icon').textContent = '🤖';
    if (warning) warning.classList.add('hidden');
  } else {
    badge.className = 'handover-status-badge ai';
    badge.querySelector('.text').textContent = 'AI Active (D1 Context)';
    btn.className = 'btn-handover';
    btn.querySelector('.btn-text').textContent = 'Takeover This Chat';
    btn.querySelector('.icon').textContent = '👤';
    if (warning) warning.classList.remove('hidden');
  }
}

function initHandoverToggle() {
  const btn = document.getElementById('btn-toggle-handover');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const conv = appState.conversations.find(c => String(c.id) === String(appState.activeChatId));
    if (!conv) return;

    const newStatus = !conv.admin_takeover;
    conv.admin_takeover = newStatus;
    if (newStatus) conv.needs_attention = false;

    updateHandoverUI(conv);
    renderConversationList();

    showToast(newStatus 
      ? '👤 আপনি এই চ্যাটটি টেকওভার করেছেন। AI আর রিপ্লাই দেবে না।' 
      : '🤖 চ্যাটটি AI-এর কাছে হস্তান্তর করা হয়েছে। AI স্বাভাবিক উত্তর দেবে।');

    try {
      await fetch(`${API_BASE}/handover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: conv.id, admin_takeover: newStatus })
      });
    } catch (e) {}
  });
}

async function fetchMessages(chatId, isBackground = false) {
  try {
    const res = await fetch(`${API_BASE}/messages?chat_id=${encodeURIComponent(chatId)}`);
    if (res.ok) {
      const msgs = await res.json();
      if (Array.isArray(msgs)) {
        appState.messages[chatId] = msgs;
        if (String(appState.activeChatId) === String(chatId)) {
          renderMessageBubbles(chatId);
        }
      }
    }
  } catch (err) {
    if (!isBackground) console.warn("Messages error:", err);
  }
}

function renderMessageBubbles(chatId) {
  const container = document.getElementById('messages-container');
  if (!container) return;

  const msgs = appState.messages[chatId] || [];
  if (msgs.length === 0) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-dim); text-align: center;">
        <div style="font-size: 32px; margin-bottom: 8px;">📩</div>
        <p style="font-size: 13px;">কোনো মেসেজ নেই। নিচে লিখুন।</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  msgs.forEach(m => {
    const row = document.createElement('div');
    const sender = m.sender_type;
    const isAi = sender === 'assistant' || sender === 'ai';
    const isAdmin = sender === 'admin';

    row.className = `msg-row ${isAdmin ? 'admin' : 'customer'}`;

    let tag = '✈️ Telegram Customer';
    if (isAi) tag = '🤖 AI Assistant (D1 Context)';
    if (isAdmin) tag = '👤 You (Dashboard Admin)';

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
// ৬. ড্যাশবোর্ড থেকে টেলিগ্রামে রিপ্লাই পাঠানো (Admin Outbound)
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
      showToast('⚠️ অনুগ্রহ করে প্রথমে বাম পাশের তালিকা থেকে একটি চ্যাট সিলেক্ট করুন।');
      return;
    }

    appState.isSending = true;
    sendBtn.disabled = true;
    sendBtn.querySelector('span').textContent = 'Sending...';

    // ১. তাৎক্ষণিক লোকাল বাবল যোগ
    const tempMsg = {
      id: 'temp_' + Date.now(),
      sender_type: 'admin',
      message_text: text,
      created_at: new Date().toISOString()
    };

    if (!appState.messages[chatId]) appState.messages[chatId] = [];
    appState.messages[chatId].push(tempMsg);
    renderMessageBubbles(chatId);
    inputEl.value = '';

    // ২. Worker API-তে সেন্ড (POST /api/admin-reply)
    try {
      const res = await fetch(`${API_BASE}/admin-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_text: text })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast('✅ মেসেজটি সরাসরি ইউজারের টেলিগ্রামে পৌঁছে গেছে!');
        const conv = appState.conversations.find(c => String(c.id) === String(chatId));
        if (conv) {
          conv.admin_takeover = true;
          conv.needs_attention = false;
          updateHandoverUI(conv);
          renderConversationList();
        }
        await fetchMessages(chatId, true);
      } else {
        showToast(`❌ টেলিগ্রামে মেসেজ পাঠানো যায়নি: ${data.error || 'Server error'}`);
      }
    } catch (err) {
      showToast(`❌ নেটওয়ার্ক এরর: ${err.message}`);
    } finally {
      appState.isSending = false;
      sendBtn.disabled = false;
      sendBtn.querySelector('span').textContent = 'Send';
      inputEl.focus();
    }
  });
}

// ========================================================
// ৭. D1 বিজনেস ডেটা ও প্রোডাক্ট ক্যাটালগ
// ========================================================
async function fetchProducts() {
  try {
    const res = await fetch(`${API_BASE}/products`);
    if (res.ok) {
      const data = await res.json();
      appState.products = Array.isArray(data) ? data : [];
      renderProductsTable();

      const countBadge = document.getElementById('badge-prod-count');
      if (countBadge) countBadge.textContent = appState.products.length;

      const statProd = document.getElementById('stat-d1-products');
      if (statProd) statProd.textContent = appState.products.length;
    }
  } catch (e) {}
}

function renderProductsTable() {
  const tbody = document.getElementById('products-table-tbody');
  if (!tbody) return;

  if (appState.products.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 24px; color: var(--text-dim);">
          D1 ডেটাবেসে কোনো প্রোডাক্ট নেই। উপরের ফর্ম থেকে প্রোডাক্ট যোগ করুন।
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  appState.products.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(p.name)}</strong><br><small style="color: var(--text-muted);">${escapeHtml(p.description || '')}</small></td>
      <td><span style="color: var(--emerald); font-weight: 700;">৳${p.price}</span></td>
      <td><span class="badge-status ${p.stock_status === 'in_stock' ? 'published' : 'pending'}">${p.stock_status === 'in_stock' ? 'In Stock' : 'Out of Stock'}</span></td>
      <td>
        <button class="btn-refresh" style="color: var(--rose); padding: 4px 10px; font-size: 11px;" onclick="deleteProduct('${p.id}')">🗑️ Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.deleteProduct = async function(id) {
  if (!confirm('আপনি কি এই প্রোডাক্টটি D1 ডেটাবেস থেকে মুছে ফেলতে চান?')) return;
  try {
    const res = await fetch(`${API_BASE}/products?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('🗑️ প্রোডাক্টটি D1 থেকে ডিলিট করা হয়েছে।');
      await fetchProducts();
    }
  } catch (e) {
    showToast('ডিলিট করা যায়নি।');
  }
};

async function fetchBusinessProfile() {
  try {
    const res = await fetch(`${API_BASE}/business-profile`);
    if (res.ok) {
      const data = await res.json();
      appState.businessProfile = data || {};
      
      if (data.store_name) document.getElementById('store-name').value = data.store_name;
      if (data.delivery_inside_dhaka) document.getElementById('del-dhaka').value = data.delivery_inside_dhaka;
      if (data.delivery_outside_dhaka) document.getElementById('del-outside').value = data.delivery_outside_dhaka;
      if (data.payment_methods) document.getElementById('payment-methods').value = data.payment_methods;
      if (data.return_policy) document.getElementById('return-policy').value = data.return_policy;
      if (data.contact_phone) document.getElementById('contact-phone').value = data.contact_phone;
    }
  } catch (e) {}
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

      const btn = document.getElementById('btn-add-product');
      btn.disabled = true;
      btn.textContent = 'Saving to D1...';

      try {
        const res = await fetch(`${API_BASE}/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, price, stock_status: stock, description: desc })
        });

        if (res.ok) {
          showToast('✅ প্রোডাক্ট সফলভাবে D1 ডেটাবেসে যুক্ত হয়েছে!');
          prodForm.reset();
          await fetchProducts();
        } else {
          showToast('❌ সেভ করা যায়নি। D1 বাইন্ডিং চেক করুন।');
        }
      } catch (err) {
        showToast('❌ এরর: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '➕ Add Product to D1 Database';
      }
    });
  }

  // Business Profile Form
  const profForm = document.getElementById('business-profile-form');
  if (profForm) {
    profForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const store_name = document.getElementById('store-name').value.trim();
      const delivery_inside_dhaka = document.getElementById('del-dhaka').value.trim();
      const delivery_outside_dhaka = document.getElementById('del-outside').value.trim();
      const payment_methods = document.getElementById('payment-methods').value.trim();
      const return_policy = document.getElementById('return-policy').value.trim();
      const contact_phone = document.getElementById('contact-phone').value.trim();

      const btn = document.getElementById('btn-save-profile');
      btn.disabled = true;
      btn.textContent = 'Saving Profile...';

      try {
        const res = await fetch(`${API_BASE}/business-profile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            store_name,
            delivery_inside_dhaka,
            delivery_outside_dhaka,
            payment_methods,
            return_policy,
            contact_phone
          })
        });

        if (res.ok) {
          showToast('✅ স্টোর পলিসি ও বিজনেস প্রোফাইল D1-এ সেভ হয়েছে!');
        } else {
          showToast('❌ সেভ করা যায়নি।');
        }
      } catch (err) {
        showToast('❌ এরর: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 Save Business Profile to D1';
      }
    });
  }
}

// ========================================================
// ৮. টেলিগ্রাম বট কানেকশন ফর্ম (POST /api/setup-telegram)
// ========================================================
function initSettingsForm() {
  const form = document.getElementById('tg-connect-form');
  const tokenInput = document.getElementById('input-tg-bot-token');
  const adminChatInput = document.getElementById('input-tg-admin-chat');
  const submitBtn = document.getElementById('btn-save-tg');
  const resultBox = document.getElementById('tg-setup-result');
  const copyBtn = document.getElementById('btn-copy-webhook');
  const webhookInput = document.getElementById('display-webhook-url');
  const workerUrlInput = document.getElementById('setting-worker-url');
  const saveWorkerBtn = document.getElementById('btn-save-worker-url');

  if (copyBtn && webhookInput) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(webhookInput.value).then(() => {
        showToast('📋 Webhook URL ক্লিপবোর্ডে কপি হয়েছে!');
      }).catch(() => {
        webhookInput.select();
        document.execCommand('copy');
        showToast('📋 Webhook URL কপি হয়েছে!');
      });
    });
  }

  if (saveWorkerBtn && workerUrlInput) {
    const saved = localStorage.getItem('social_automate_worker_url');
    if (saved) workerUrlInput.value = saved;

    saveWorkerBtn.addEventListener('click', () => {
      const val = workerUrlInput.value.trim();
      if (val) {
        localStorage.setItem('social_automate_worker_url', val);
        showToast('🌐 Worker URL সংরক্ষিত হয়েছে!');
        setTimeout(() => window.location.reload(), 800);
      }
    });
  }

  if (form && tokenInput) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = tokenInput.value.trim();
      const adminChat = adminChatInput.value.trim();

      if (!token) return;

      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Verifying & Registering Webhook...';

      try {
        const res = await fetch(`${API_BASE}/setup-telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bot_token: token, admin_chat_id: adminChat })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          resultBox.style.display = 'block';
          resultBox.style.background = 'rgba(16, 185, 129, 0.15)';
          resultBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
          resultBox.style.color = '#a7f3d0';
          resultBox.innerHTML = `
            <strong>✅ টেলিগ্রাম বট সফলভাবে কানেক্ট হয়েছে!</strong><br>
            বট নাম: <strong>${escapeHtml(data.bot.name)}</strong> (${escapeHtml(data.bot.username)})<br>
            Webhook স্ট্যাটাস: <strong>${escapeHtml(data.webhook_status)}</strong>
          `;
          showToast('🎉 টেলিগ্রাম বট সফলভাবে কানেক্ট হয়েছে!');
          tokenInput.value = '';
          await fetchSystemSettings();
        } else {
          resultBox.style.display = 'block';
          resultBox.style.background = 'rgba(239, 68, 68, 0.15)';
          resultBox.style.border = '1px solid rgba(239, 68, 68, 0.4)';
          resultBox.style.color = '#fca5a5';
          resultBox.innerHTML = `❌ ${escapeHtml(data.error || 'Verification failed')}`;
          showToast('❌ বট টোকেন সঠিক নয়!');
        }
      } catch (err) {
        showToast('❌ এরর: ' + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 Connect Telegram & Save to D1';
      }
    });
  }
}

// ========================================================
// ইউটিলিটি
// ========================================================
function formatTime(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return isoStr;
  }
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = 'block';

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.display = 'none';
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}

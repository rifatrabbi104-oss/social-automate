/**
 * SocialAutomate - Telegram Live Chat & Cloudflare D1 Application Engine
 * ---------------------------------------------------------------------
 * 1. Live 2-way communication: Customer on Telegram <-> Admin in Dashboard
 * 2. Persistent Cloudflare D1 storage for all conversations & messages
 * 3. Automated Telegram Bot token verification & webhook sync
 * 4. Real-time background polling (zero local demo mock data)
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

// Application State
let appState = {
  activeConversationId: null,
  conversations: [],
  messages: {},
  d1Connected: false,
  telegramConnected: false,
  botUsername: null,
  pollTimer: null,
  isSending: false
};

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initChatReply();
  initSettingsForm();
  initManualSync();

  // Initial load
  loadAllData();

  // Background real-time polling every 3.5 seconds
  appState.pollTimer = setInterval(pollLiveUpdates, 3500);
});

// ========================================================
// ১. নেভিগেশন ট্যাব হ্যান্ডলিং
// ========================================================
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');
  const pageTitle = document.getElementById('page-title');
  const pageSubtitle = document.getElementById('page-subtitle');

  const headers = {
    'inbox': {
      title: 'Telegram Live Inbox',
      sub: 'কাস্টমার টেলিগ্রামে মেসেজ পাঠালে এখানে আসবে, আপনি ড্যাশবোর্ড থেকে উত্তর দিলে সরাসরি ইউজারের টেলিগ্রামেই রিপ্লাই যাবে।'
    },
    'telegram-setup': {
      title: 'Telegram & Cloudflare D1 Setup',
      sub: 'টেলিগ্রাম বটের টোকেন D1 ডেটাবেসে সংরক্ষণ করুন এবং স্বয়ংক্রিয়ভাবে Webhook চালু করুন।'
    },
    'logs': {
      title: 'D1 Activity & Message History',
      sub: 'Cloudflare D1 ডেটাবেসে স্থায়ীভাবে সংরক্ষিত মেসেজ ও ইভেন্ট হিস্ট্রি।'
    }
  };

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.getAttribute('data-tab');
      navItems.forEach(n => n.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      item.classList.add('active');
      const targetPane = document.getElementById(`tab-${tab}`);
      if (targetPane) targetPane.classList.add('active');

      if (headers[tab]) {
        if (pageTitle) pageTitle.textContent = headers[tab].title;
        if (pageSubtitle) pageSubtitle.textContent = headers[tab].sub;
      }

      if (tab === 'logs') {
        renderAuditLogs();
      }
    });
  });
}

// ========================================================
// ২. ডেটা লোড ও ব্যাকগ্রাউন্ড সিঙ্ক (Live D1 Polling)
// ========================================================
async function loadAllData() {
  await fetchSystemSettings();
  await fetchConversations();
  if (appState.activeConversationId) {
    await fetchMessages(appState.activeConversationId);
  }
}

async function pollLiveUpdates() {
  await fetchConversations(true);
  if (appState.activeConversationId) {
    await fetchMessages(appState.activeConversationId, true);
  }
}

function initManualSync() {
  const syncBtn = document.getElementById('btn-manual-sync');
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      syncBtn.textContent = '⏳ Syncing...';
      await loadAllData();
      showToast('🔄 ডেটাবেস থেকে রিয়েল-টাইম ডেটা রিফ্রেশ করা হয়েছে।');
      syncBtn.textContent = '🔄 Sync';
    });
  }

  const refreshChatBtn = document.getElementById('btn-refresh-active-chat');
  if (refreshChatBtn) {
    refreshChatBtn.addEventListener('click', async () => {
      if (appState.activeConversationId) {
        await fetchMessages(appState.activeConversationId);
        showToast('🔄 চ্যাট হিস্ট্রি রিফ্রেশ হয়েছে।');
      }
    });
  }
}

// ========================================================
// ৩. সিস্টেম ও D1 সেটিংস ফেচ
// ========================================================
async function fetchSystemSettings() {
  try {
    const res = await fetch(`${API_BASE}/settings`);
    if (res.ok) {
      const data = await res.json();
      appState.d1Connected = Boolean(data.d1_connected);
      appState.telegramConnected = Boolean(data.telegram_connected);
      appState.botUsername = data.bot_username || null;

      updateStatusUI(data);
    } else {
      updateStatusUI({ d1_connected: false, telegram_connected: false });
    }
  } catch (err) {
    console.warn("API offline or unreachable:", err);
    updateStatusUI({ d1_connected: false, telegram_connected: false });
  }
}

function updateStatusUI(data) {
  const d1Dot = document.getElementById('d1-status-dot');
  const d1Text = document.getElementById('d1-status-text');
  const d1Banner = document.getElementById('d1-warning-banner');
  const statD1 = document.getElementById('stat-d1-status');
  const statTg = document.getElementById('stat-tg-status');
  const topbarTg = document.getElementById('topbar-tg-bot');
  const setupBadge = document.getElementById('setup-status-badge');
  const tgConnectedBadge = document.getElementById('tg-connected-badge');
  const webhookInput = document.getElementById('display-webhook-url');

  if (webhookInput) {
    const baseOrigin = API_BASE.replace(/\/api$/, '');
    webhookInput.value = `${baseOrigin}/webhook/telegram`;
  }

  // D1 Status
  if (data.d1_connected) {
    if (d1Dot) d1Dot.style.background = 'var(--emerald)';
    if (d1Text) d1Text.textContent = 'D1 Database: Active';
    if (statD1) {
      statD1.textContent = 'Connected ✅';
      statD1.style.color = 'var(--emerald)';
    }
    if (d1Banner) d1Banner.style.display = 'none';
  } else {
    if (d1Dot) d1Dot.style.background = 'var(--rose)';
    if (d1Text) d1Text.textContent = 'D1 DB: Not Bound';
    if (statD1) {
      statD1.textContent = 'Not Bound ❌';
      statD1.style.color = 'var(--rose)';
    }
    if (d1Banner) d1Banner.style.display = 'block';
  }

  // Telegram Status
  if (data.telegram_connected) {
    const username = data.bot_username ? `@${data.bot_username}` : 'Active';
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
// ৪. কনভারসেশন লিস্ট ফেচ ও রেন্ডার (D1)
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

        const statTotal = document.getElementById('stat-total-convs');
        if (statTotal) statTotal.textContent = data.length;

        // Auto select first conversation if none selected
        if (!appState.activeConversationId && data.length > 0) {
          appState.activeConversationId = data[0].id;
          renderActiveChat();
          fetchMessages(data[0].id);
        }
      }
    }
  } catch (err) {
    if (!isBackground) console.warn("Failed to fetch conversations:", err);
  }
}

function renderConversationList() {
  const listEl = document.getElementById('conversation-list');
  if (!listEl) return;

  if (appState.conversations.length === 0) {
    listEl.innerHTML = `
      <div style="padding: 40px 16px; text-align: center; color: var(--text-dim); font-size: 13px;">
        <div style="font-size: 36px; margin-bottom: 8px;">✈️</div>
        <div style="color: var(--text-muted); font-weight: 600; font-size: 14px;">কোনো চ্যাট নেই</div>
        <p style="font-size: 12px; margin-top: 6px; line-height: 1.5;">
          আপনার টেলিগ্রাম বটে মেসেজ দিলে সেটি সরাসরি এখানে আসবে।
        </p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = '';

  appState.conversations.forEach(c => {
    const item = document.createElement('div');
    const isActive = c.id === appState.activeConversationId;
    item.className = `conv-item ${isActive ? 'active' : ''}`;

    const senderName = c.sender_name || 'Telegram User';
    const initial = senderName.charAt(0).toUpperCase();
    const timeFormatted = formatTime(c.last_message_at);

    item.innerHTML = `
      <div class="conv-avatar">${initial}</div>
      <div class="conv-details">
        <div class="conv-top-row">
          <span class="conv-name">${escapeHtml(senderName)}</span>
          <span class="conv-time">${timeFormatted}</span>
        </div>
        <div class="conv-snippet">${escapeHtml(c.last_message || 'No messages yet')}</div>
        <div class="conv-badges">
          <span class="badge-tag platform">✈️ TG</span>
          <span class="badge-tag" style="background: rgba(16, 185, 129, 0.15); color: var(--emerald);">ID: ${escapeHtml(c.sender_id || '')}</span>
        </div>
      </div>
    `;

    item.addEventListener('click', () => {
      if (appState.activeConversationId !== c.id) {
        appState.activeConversationId = c.id;
        renderConversationList();
        renderActiveChat();
        fetchMessages(c.id);
      }
    });

    listEl.appendChild(item);
  });
}

// ========================================================
// ৫. চ্যাট ভিউ ও মেসেজ হিস্ট্রি (D1 Messages)
// ========================================================
function renderActiveChat() {
  const conv = appState.conversations.find(c => c.id === appState.activeConversationId);
  const container = document.getElementById('messages-container');
  const refreshBtn = document.getElementById('btn-refresh-active-chat');

  if (!conv) {
    document.getElementById('active-chat-avatar').textContent = '-';
    document.getElementById('active-chat-name').textContent = 'কোনো চ্যাট সিলেক্ট করা নেই';
    document.getElementById('active-chat-id').textContent = '';
    if (refreshBtn) refreshBtn.style.display = 'none';

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

  if (refreshBtn) refreshBtn.style.display = 'block';

  const senderName = conv.sender_name || 'Telegram User';
  document.getElementById('active-chat-avatar').textContent = senderName.charAt(0).toUpperCase();
  document.getElementById('active-chat-name').textContent = senderName;
  document.getElementById('active-chat-id').textContent = `#${conv.sender_id || conv.id}`;

  renderMessageBubbles(conv.id);
}

async function fetchMessages(convId, isBackground = false) {
  try {
    const res = await fetch(`${API_BASE}/messages?conversation_id=${encodeURIComponent(convId)}`);
    if (res.ok) {
      const msgs = await res.json();
      if (Array.isArray(msgs)) {
        appState.messages[convId] = msgs;
        if (appState.activeConversationId === convId) {
          renderMessageBubbles(convId);
        }

        // Update total message metric
        const total = Object.values(appState.messages).reduce((acc, mList) => acc + mList.length, 0);
        const statMsg = document.getElementById('stat-total-msgs');
        if (statMsg) statMsg.textContent = total;
      }
    }
  } catch (err) {
    if (!isBackground) console.warn("Failed to fetch messages:", err);
  }
}

function renderMessageBubbles(convId) {
  const container = document.getElementById('messages-container');
  if (!container) return;

  const msgs = appState.messages[convId] || [];
  if (msgs.length === 0) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-dim); text-align: center;">
        <div style="font-size: 32px; margin-bottom: 8px;">📩</div>
        <p style="font-size: 13px;">কোনো মেসেজ হিস্ট্রি নেই। নিচে মেসেজ লিখে পাঠিয়ে দিন!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  msgs.forEach(m => {
    const row = document.createElement('div');
    const isAdmin = m.sender_type === 'admin';
    row.className = `msg-row ${isAdmin ? 'admin' : 'customer'}`;

    const senderTag = isAdmin ? '👤 You (Dashboard Admin)' : '✈️ Telegram Customer';
    const timeFormatted = formatTime(m.created_at);

    row.innerHTML = `
      <div class="msg-sender-tag">${senderTag}</div>
      <div class="msg-bubble">${escapeHtml(m.message_text)}</div>
      <span class="msg-time">${timeFormatted}</span>
    `;

    container.appendChild(row);
  });

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

// ========================================================
// ৬. অ্যাডমিন রিপ্লাই হ্যান্ডলার (Dashboard -> Telegram API)
// ========================================================
function initChatReply() {
  const replyForm = document.getElementById('chat-reply-form');
  const inputEl = document.getElementById('admin-message-input');
  const sendBtn = document.getElementById('btn-send-message');

  if (!replyForm || !inputEl) return;

  replyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text || appState.isSending) return;

    const convId = appState.activeConversationId;
    if (!convId) {
      showToast('⚠️ অনুগ্রহ করে প্রথমে বাম পাশের তালিকা থেকে একটি চ্যাট সিলেক্ট করুন।');
      return;
    }

    appState.isSending = true;
    sendBtn.disabled = true;
    sendBtn.querySelector('span').textContent = 'Sending...';

    // ১. লোকাল স্টেট এবং UI-তে তাৎক্ষণিক বাবল যোগ
    const tempMsg = {
      id: 'temp_' + Date.now(),
      conversation_id: convId,
      sender_type: 'admin',
      message_text: text,
      created_at: new Date().toISOString()
    };

    if (!appState.messages[convId]) appState.messages[convId] = [];
    appState.messages[convId].push(tempMsg);
    renderMessageBubbles(convId);
    inputEl.value = '';

    // ২. Cloudflare Worker API তে পোস্ট
    try {
      const res = await fetch(`${API_BASE}/admin/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: convId,
          message_text: text
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        showToast('✅ মেসেজটি ইউজারের টেলিগ্রামে সফলভাবে পৌঁছেছে!');
        // D1 থেকে নিশ্চিত মেসেজ রিফ্রেশ
        await fetchMessages(convId, true);
        await fetchConversations(true);
      } else {
        showToast(`❌ টেলিগ্রামে মেসেজ পাঠানো যায়নি: ${data.error || 'Server error'}`);
      }
    } catch (err) {
      showToast(`❌ নেটওয়ার্ক ত্রুটি: ${err.message}`);
    } finally {
      appState.isSending = false;
      sendBtn.disabled = false;
      sendBtn.querySelector('span').textContent = 'Send';
      inputEl.focus();
    }
  });
}

// ========================================================
// ৭. টেলিগ্রাম সেটিংস ও D1 কানেকশন ফর্ম
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

  // Worker URL Save
  if (saveWorkerBtn && workerUrlInput) {
    const saved = localStorage.getItem('social_automate_worker_url');
    if (saved) workerUrlInput.value = saved;

    saveWorkerBtn.addEventListener('click', () => {
      const val = workerUrlInput.value.trim();
      if (val) {
        localStorage.setItem('social_automate_worker_url', val);
        showToast('🌐 Worker URL সংরক্ষিত হয়েছে! পেজ রিফ্রেশ হচ্ছে...');
        setTimeout(() => window.location.reload(), 1000);
      }
    });
  }

  // Telegram Connect Form
  if (form && tokenInput) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = tokenInput.value.trim();
      const adminChat = adminChatInput.value.trim();

      if (!token) {
        showToast('⚠️ অনুগ্রহ করে টেলিগ্রাম বট টোকেন লিখুন।');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Verifying & Saving to D1...';

      try {
        const res = await fetch(`${API_BASE}/settings/telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bot_token: token,
            admin_chat_id: adminChat
          })
        });

        const data = await res.json();

        if (res.ok && data.success) {
          resultBox.style.display = 'block';
          resultBox.style.background = 'rgba(16, 185, 129, 0.15)';
          resultBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
          resultBox.style.color = '#a7f3d0';
          resultBox.innerHTML = `
            <strong>✅ সফলভাবে কানেক্ট হয়েছে!</strong><br>
            বট নাম: <strong>${escapeHtml(data.bot.name)}</strong> (${escapeHtml(data.bot.username)})<br>
            টোকেন স্ট্যাটাস: Cloudflare D1-এ স্থায়ীভাবে সেভ হয়েছে।<br>
            Webhook স্ট্যাটাস: <strong>${escapeHtml(data.webhook_status)}</strong>
          `;

          showToast('🎉 টেলিগ্রাম বট সফলভাবে D1-এ কানেক্ট হয়েছে!');
          tokenInput.value = '';
          await fetchSystemSettings();
        } else {
          resultBox.style.display = 'block';
          resultBox.style.background = 'rgba(239, 68, 68, 0.15)';
          resultBox.style.border = '1px solid rgba(239, 68, 68, 0.4)';
          resultBox.style.color = '#fca5a5';
          resultBox.innerHTML = `❌ <strong>কানেক্ট করা যায়নি:</strong> ${escapeHtml(data.error || 'Unknown error')}`;
          showToast(`❌ ত্রুটি: ${data.error || 'Server error'}`);
        }
      } catch (err) {
        showToast(`❌ কানেকশন ত্রুটি: ${err.message}`);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 Connect Telegram & Save to D1';
      }
    });
  }
}

// ========================================================
// ৮. D1 লগস ভিউ রেন্ডার
// ========================================================
async function renderAuditLogs() {
  const tbody = document.getElementById('logs-table-tbody');
  if (!tbody) return;

  const refreshBtn = document.getElementById('btn-refresh-logs');
  if (refreshBtn) {
    refreshBtn.onclick = () => {
      renderAuditLogs();
      showToast('🔄 লগস রিফ্রেশ করা হয়েছে।');
    };
  }

  const allMsgs = [];
  for (const convId of Object.keys(appState.messages)) {
    const list = appState.messages[convId] || [];
    for (const m of list) {
      allMsgs.push(m);
    }
  }

  // Sort by created_at DESC
  allMsgs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (allMsgs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 32px; color: var(--text-dim);">
          কোনো মেসেজ লগ পাওয়া যায়নি।
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  allMsgs.slice(0, 50).forEach(m => {
    const tr = document.createElement('tr');
    const senderTag = m.sender_type === 'admin' 
      ? '<span style="color: var(--primary); font-weight: 700;">Admin (Dashboard)</span>' 
      : '<span style="color: var(--emerald); font-weight: 700;">Customer (Telegram)</span>';

    tr.innerHTML = `
      <td><code>${escapeHtml(m.conversation_id || '-')}</code></td>
      <td>${senderTag}</td>
      <td>${escapeHtml(m.message_text || '')}</td>
      <td><small style="color: var(--text-muted);">${formatTime(m.created_at)}</small></td>
    `;
    tbody.appendChild(tr);
  });
}

// ========================================================
// ইউটিলিটি ফাংশন
// ========================================================
function formatTime(isoStr) {
  if (!isoStr) return '';
  try {
    const date = new Date(isoStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

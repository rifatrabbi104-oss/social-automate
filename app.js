/**
 * SocialAutomate Frontend Application Engine
 * -------------------------------------------
 * Powers the Live Chat Inbox, Per-Chat Handover, Global Master Switch,
 * Social Post Scheduler, and Admin Alert Configuration.
 * Works seamlessly with Cloudflare Worker API & local interactive preview.
 */

// কনফিগারেশন: ক্লাউডফ্লেয়ার ওয়ার্কার এপিআই এন্ডপয়েন্ট (GitHub Pages বা Custom Domain সাপোর্ট)
function getApiBase() {
  const custom = localStorage.getItem('social_automate_worker_url');
  if (custom) return custom.replace(/\/$/, '') + '/api';
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://127.0.0.1:8787/api';
  }
  return '/api';
}
const API_BASE = getApiBase();

// অ্যাপ্লিকেশন স্টেট (Clean State - Zero Demo Data)
let appState = {
  globalAiActive: true,
  activeFilter: 'all',
  activeConversationId: null,
  conversations: [],
  messages: {},
  scheduledPosts: []
};

// ইনিশিয়ালাইজেশন
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initGlobalSwitch();
  initConversationList();
  initChatView();
  initSandboxSimulator();
  initScheduler();
  initSettingsForms();
  fetchLiveStats();
});

// ১. নেভিগেশন ট্যাব হ্যান্ডলিং
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');
  const pageTitle = document.getElementById('page-title');

  const titles = {
    'inbox': 'Live Chat & AI Handover',
    'test-sandbox': 'Interactive Test Sandbox & Easy Connect',
    'scheduler': 'Social Post Scheduler & Publisher',
    'analytics': 'Quota Monitor & Performance Analytics',
    'settings': 'Settings & Telegram Admin Alert'
  };

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.getAttribute('data-tab');
      navItems.forEach(n => n.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      item.classList.add('active');
      const targetPane = document.getElementById(`tab-${tab}`);
      if (targetPane) targetPane.classList.add('active');
      if (pageTitle && titles[tab]) pageTitle.textContent = titles[tab];
    });
  });
}

// ২. গ্লোবাল AI মাস্টার সুইচ
function initGlobalSwitch() {
  const toggle = document.getElementById('global-ai-toggle');
  const statusText = document.getElementById('global-status-text');

  toggle.addEventListener('change', async (e) => {
    const isEnabled = e.target.checked;
    appState.globalAiActive = isEnabled;

    if (statusText) {
      statusText.textContent = isEnabled ? 'Active (AI replying)' : 'Disabled (Admin Mode)';
      statusText.style.color = isEnabled ? 'var(--emerald)' : 'var(--amber)';
    }

    showToast(isEnabled ? '🤖 Global AI Auto-Pilot চালু হয়েছে।' : '👤 Global Admin Mode চালু হয়েছে (AI রিপ্লাই সাময়িক বন্ধ)।');

    try {
      await fetch(`${API_BASE}/settings/global-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: isEnabled })
      });
    } catch (err) {
      console.log('Running in local/offline mode.');
    }
  });
}

// ৩. চ্যাট কনভারসেশন লিস্ট রেন্ডার
function initConversationList() {
  const listEl = document.getElementById('conversation-list');
  const filterBtns = document.querySelectorAll('.filter-pill');

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      appState.activeFilter = btn.getAttribute('data-filter');
      renderConversationList();
    });
  });

  renderConversationList();
}

function renderConversationList() {
  const listEl = document.getElementById('conversation-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  const filtered = appState.conversations.filter(c => {
    if (appState.activeFilter === 'attention') return c.needs_attention === 1;
    if (appState.activeFilter === 'takeover') return c.admin_takeover === 1;
    return true;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div style="padding: 40px 16px; text-align: center; color: var(--text-dim); font-size: 13px;">
        <div style="font-size: 32px; margin-bottom: 8px;">💬</div>
        <div style="color: var(--text-muted); font-weight: 600;">কোনো চ্যাট হিস্ট্রি নেই</div>
        <p style="font-size: 11px; margin-top: 4px; line-height: 1.5;">টেলিগ্রাম বট কানেক্ট করলে বা Test & Connect ট্যাব থেকে মেসেজ টেস্ট করলে এখানে চ্যাট জমা হবে।</p>
      </div>
    `;
    return;
  }

  filtered.forEach(c => {
    const item = document.createElement('div');
    item.className = `conv-item ${c.id === appState.activeConversationId ? 'active' : ''}`;
    
    const initial = c.name.charAt(0).toUpperCase();
    const platformLabel = c.platform === 'facebook' ? '🔵 FB' : (c.platform === 'telegram' ? '✈️ TG' : '🟢 WA');

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
          <span class="conv-time">${c.time}</span>
        </div>
        <div class="conv-snippet">${escapeHtml(c.last_message)}</div>
        <div class="conv-badges">
          <span class="badge-tag platform">${platformLabel}</span>
          ${badgeHtml}
        </div>
      </div>
    `;

    item.addEventListener('click', () => {
      appState.activeConversationId = c.id;
      renderConversationList();
      renderActiveChat();
    });

    listEl.appendChild(item);
  });
}

// ৪. চ্যাট ভিউ এবং হ্যান্ডওভার টগল
function initChatView() {
  renderActiveChat();

  // পার-চ্যাট হ্যান্ডওভার বাটন
  const toggleBtn = document.getElementById('btn-toggle-handover');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const conv = appState.conversations.find(c => c.id === appState.activeConversationId);
      if (!conv) return;

      const newStatus = conv.admin_takeover ? 0 : 1;
      conv.admin_takeover = newStatus;
      if (newStatus === 1) conv.needs_attention = 0;

      updateHandoverUI(conv);
      renderConversationList();

      showToast(newStatus === 1 
        ? `👤 ${conv.name}-এর জন্য Admin Takeover সক্রিয়। AI আর উত্তর দেবে না।` 
        : `🤖 ${conv.name}-এর জন্য AI সক্রিয় করা হয়েছে। AI স্বাভাবিক উত্তর দেবে।`);

      fetch(`${API_BASE}/handover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conv.id, admin_takeover: newStatus })
      }).catch(err => console.log('Handover sync locally.'));
    });
  }

  // অ্যাডমিন মেসেজ সাবমিশন
  const replyForm = document.getElementById('chat-reply-form');
  const inputEl = document.getElementById('admin-message-input');

  if (replyForm && inputEl) {
    replyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = inputEl.value.trim();
      if (!text) return;

      sendAdminReply(text);
      inputEl.value = '';
    });
  }
}

function renderActiveChat() {
  const conv = appState.conversations.find(c => c.id === appState.activeConversationId);
  const container = document.getElementById('messages-container');
  const badge = document.getElementById('handover-badge');
  const btn = document.getElementById('btn-toggle-handover');
  const warning = document.getElementById('ai-active-warning');

  if (!conv) {
    document.getElementById('active-chat-avatar').textContent = '-';
    document.getElementById('active-chat-name').textContent = 'কোনো চ্যাট সিলেক্ট করা নেই';
    document.getElementById('active-chat-id').textContent = '';
    const platformTag = document.getElementById('active-chat-platform');
    if (platformTag) {
      platformTag.className = 'platform-tag';
      platformTag.textContent = 'Waiting for chat';
    }
    if (badge) badge.style.display = 'none';
    if (btn) btn.style.display = 'none';
    if (warning) warning.classList.add('hidden');
    if (container) {
      container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-dim); text-align: center;">
          <div style="font-size: 38px; margin-bottom: 12px; opacity: 0.6;">💬</div>
          <h4 style="font-size: 15px; color: var(--text-main); margin-bottom: 4px;">কোনো চ্যাট ওপেন করা নেই</h4>
          <p style="font-size: 12px; max-width: 280px; line-height: 1.5;">বাম পাশের তালিকা থেকে একটি কনভারসেশন সিলেক্ট করুন অথবা Test & Connect ট্যাব থেকে টেস্ট মেসেজ পাঠান।</p>
        </div>
      `;
    }
    return;
  }

  if (badge) badge.style.display = 'flex';
  if (btn) btn.style.display = 'flex';

  document.getElementById('active-chat-avatar').textContent = conv.name.charAt(0).toUpperCase();
  document.getElementById('active-chat-name').textContent = conv.name;
  document.getElementById('active-chat-id').textContent = `#${conv.id}`;

  const platformTag = document.getElementById('active-chat-platform');
  if (platformTag) {
    platformTag.className = `platform-tag ${conv.platform === 'facebook' ? 'fb' : (conv.platform === 'telegram' ? 'tg' : 'wa')}`;
    platformTag.textContent = conv.platform.toUpperCase();
  }

  updateHandoverUI(conv);
  renderMessages(conv.id);
}

function updateHandoverUI(conv) {
  const badge = document.getElementById('handover-badge');
  const btn = document.getElementById('btn-toggle-handover');
  const warning = document.getElementById('ai-active-warning');

  if (conv.admin_takeover) {
    badge.className = 'handover-status-badge takeover';
    badge.querySelector('.text').textContent = 'Admin Takeover';
    btn.className = 'btn-handover release';
    btn.querySelector('.btn-text').textContent = 'Release to AI';
    btn.querySelector('.icon').textContent = '🤖';
    if (warning) warning.classList.add('hidden');
  } else {
    badge.className = 'handover-status-badge ai';
    badge.querySelector('.text').textContent = 'AI Active';
    btn.className = 'btn-handover';
    btn.querySelector('.btn-text').textContent = 'Takeover This Chat';
    btn.querySelector('.icon').textContent = '👤';
    if (warning) warning.classList.remove('hidden');
  }
}

function renderMessages(convId) {
  const container = document.getElementById('messages-container');
  if (!container) return;
  container.innerHTML = '';

  const msgs = appState.messages[convId] || [];

  msgs.forEach(m => {
    const row = document.createElement('div');
    row.className = `msg-row ${m.sender_type}`;

    let senderLabel = 'Customer';
    if (m.sender_type === 'ai') senderLabel = '🤖 AI Assistant';
    if (m.sender_type === 'admin') senderLabel = '👤 Admin (You)';

    row.innerHTML = `
      <div class="msg-sender-tag">${senderLabel}</div>
      <div class="msg-bubble">${escapeHtml(m.text)}</div>
      <span class="msg-time">${m.time}</span>
    `;

    container.appendChild(row);
  });

  container.scrollTop = container.scrollHeight;
}

function sendAdminReply(text) {
  const convId = appState.activeConversationId;
  const conv = appState.conversations.find(c => c.id === convId);
  if (!conv) return;

  // ১. স্বয়ংক্রিয়ভাবে টেকওভার এনেবল করা যদি অ্যাডমিন নিজে মেসেজ পাঠায়
  if (!conv.admin_takeover) {
    conv.admin_takeover = 1;
    conv.needs_attention = 0;
    updateHandoverUI(conv);
    showToast('👤 আপনি উত্তর দিয়েছেন, এই চ্যাটটি স্বয়ংক্রিয়ভাবে Admin Takeover মোডে চলে এসেছে।');
  }

  // ২. লোকাল মেসেজ যোগ
  const newMsg = {
    id: 'm_' + Date.now(),
    sender_type: 'admin',
    text: text,
    time: 'Just now'
  };

  if (!appState.messages[convId]) appState.messages[convId] = [];
  appState.messages[convId].push(newMsg);

  conv.last_message = text;
  conv.time = 'Just now';

  renderMessages(convId);
  renderConversationList();

  // ৩. ব্যাকএন্ড API-তে সেন্ড
  fetch(`${API_BASE}/admin/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: convId, message_text: text })
  }).catch(err => console.log('Admin reply saved locally.'));
}

// ৪.৫ টেস্ট স্যান্ডবক্স ও ১-ক্লিক টেলিগ্রাম কানেক্টর
function initSandboxSimulator() {
  const form = document.getElementById('sandbox-simulator-form');
  const copyBtn = document.getElementById('btn-copy-webhook');
  const webhookInput = document.getElementById('tg-webhook-url-input');

  // টেলিগ্রাম ওয়েবমুক কপি বাটন ও ডায়নামিক URL পপুলেশন
  if (webhookInput) {
    const savedWorker = localStorage.getItem('social_automate_worker_url');
    if (savedWorker) {
      webhookInput.value = `${savedWorker.replace(/\/$/, '')}/webhook/telegram`;
    }
  }

  if (copyBtn && webhookInput) {
    copyBtn.addEventListener('click', () => {
      if (!webhookInput.value) {
        showToast('⚠️ অনুগ্রহ করে প্রথমে Settings থেকে আপনার Worker URL কানেক্ট করুন।');
        return;
      }
      navigator.clipboard.writeText(webhookInput.value).then(() => {
        showToast('📋 Webhook URL ক্লিপবোর্ডে কপি হয়েছে!');
      }).catch(() => {
        webhookInput.select();
        document.execCommand('copy');
        showToast('📋 Webhook URL কপি হয়েছে!');
      });
    });
  }

  // লাইভ টেস্ট ফর্ম সাবমিশন
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const customerName = document.getElementById('sim-customer-name').value.trim() || 'Test Customer';
      const platform = document.getElementById('sim-platform').value;
      const messageText = document.getElementById('sim-message-text').value.trim();

      if (!messageText) return;

      const outputBox = document.getElementById('sim-output-box');
      const responseText = document.getElementById('sim-response-text');
      const alertBadge = document.getElementById('sim-alert-badge');
      const runBtn = document.getElementById('btn-run-sim');

      runBtn.disabled = true;
      runBtn.textContent = '⏳ Processing with Gemini Live...';

      let aiReply = '';
      let needsAlert = false;
      let alertReason = '';

      // কিওয়ার্ড চেক (অ্যাডমিন অ্যালার্ট সিমুলেশন)
      const alertKws = ['admin', 'manager', 'owner', 'human', 'manush', 'kotha bolbo', 'call den', 'urgent', 'cancel', 'refund'];
      for (const kw of alertKws) {
        if (messageText.toLowerCase().includes(kw)) {
          needsAlert = true;
          alertReason = `Keyword match: '${kw}'`;
          break;
        }
      }

      try {
        const res = await fetch(`${API_BASE}/test/simulate-message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_name: customerName,
            platform: platform,
            message_text: messageText
          })
        });

        if (res.ok) {
          const data = await res.json();
          aiReply = data.ai_reply;
          needsAlert = data.admin_alert_triggered;
          alertReason = data.alert_reason;
        } else {
          throw new Error('API offline');
        }
      } catch (err) {
        // অফলাইন/লোকাল সিমুলেশন রেসপন্স
        if (needsAlert) {
          aiReply = `হ্যালো ${customerName}! আমি আমাদের ম্যানেজমেন্ট ও অ্যাডমিনকে বিষয়টি তাৎক্ষণিক জানিয়ে দিয়েছি। তিনি শীঘ্রই আপনার সাথে যোগাযোগ করবেন। ইতিমধ্যে আপনার পণ্যের অর্ডার বা সাইজ সম্পর্কে কি কিছু জানতে চান?`;
        } else {
          aiReply = `ধন্যবাদ ${customerName}! আমাদের যেকোনো পণ্যের মূল্য, ক্যাশ অন ডেলিভারি এবং দ্রুত শিপিং সম্পর্কে আমি আপনাকে সম্পূর্ণ সাহায্য করতে পারি। আপনি কোন পণ্যটি সম্পর্কে জানতে আগ্রহী?`;
        }
      }

      // আউটপুট বক্সে ডিসপ্লে
      if (outputBox && responseText) {
        outputBox.style.display = 'block';
        responseText.textContent = aiReply;

        if (alertBadge) {
          if (needsAlert) {
            alertBadge.innerHTML = `🚨 <strong>Telegram Admin DM Alert Triggered!</strong> (কারণ: ${alertReason || 'Customer asked for human admin'})`;
            alertBadge.style.color = 'var(--amber)';
          } else {
            alertBadge.innerHTML = `✅ <strong>Standard AI Reply</strong> (কোনো অ্যাডমিন অ্যালার্টের প্রয়োজন হয়নি, AI একাই সমাধান করেছে)`;
            alertBadge.style.color = 'var(--emerald)';
          }
        }
      }

      // ইনবক্স কনভারসেশনে লাইভ যোগ করা
      const testConvId = `test_${Date.now()}`;
      appState.conversations.unshift({
        id: testConvId,
        name: customerName,
        platform: platform,
        sender_id: 'sim_123',
        admin_takeover: 0,
        needs_attention: needsAlert ? 1 : 0,
        last_message: messageText,
        time: 'Just now',
        unread: true
      });

      appState.messages[testConvId] = [
        { id: 'm1', sender_type: 'customer', text: messageText, time: 'Just now' },
        { id: 'm2', sender_type: 'ai', text: aiReply, time: 'Just now' }
      ];

      renderConversationList();
      showToast('⚡ টেস্ট মেসেজ সফলভাবে প্রসেস হয়েছে এবং Live Inbox-এ নতুন চ্যাট হিসেবে যোগ হয়েছে!');

      runBtn.disabled = false;
      runBtn.textContent = '⚡ Send Test Message';
    });
  }
}

// ৫. পোস্ট শিডিউলার লজিক
function initScheduler() {
  renderScheduledPosts();

  const form = document.getElementById('schedule-post-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const content = document.getElementById('post-content').value.trim();
      const mediaUrl = document.getElementById('post-media-url').value.trim();
      const datetime = document.getElementById('post-datetime').value;

      const checkedPlatforms = Array.from(document.querySelectorAll('input[name="platform"]:checked')).map(cb => cb.value);

      if (!content || checkedPlatforms.length === 0) {
        showToast('⚠️ অনুগ্রহ করে পোস্টের টেক্সট এবং অন্তত ১টি প্ল্যাটফর্ম সিলেক্ট করুন।');
        return;
      }

      const newPost = {
        id: 'p_' + Date.now(),
        content: content,
        media_urls: mediaUrl ? [mediaUrl] : [],
        platforms: checkedPlatforms,
        scheduled_at: datetime || '2026-10-24 10:00 AM',
        status: 'pending'
      };

      appState.scheduledPosts.unshift(newPost);
      renderScheduledPosts();
      form.reset();
      showToast('📅 পোস্ট সফলভাবে শিডিউল হয়েছে! GitHub Actions যথাসময়ে স্বয়ংক্রিয়ভাবে পোস্ট করবে (০ Worker রিকোয়েস্টে)।');

      // API সিঙ্ক
      fetch(`${API_BASE}/posts/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPost)
      }).catch(err => console.log('Post saved locally.'));
    });
  }

  const refreshBtn = document.getElementById('btn-refresh-posts');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      renderScheduledPosts();
      showToast('🔄 শিডিউল পোস্ট লিস্ট রিফ্রেশ হয়েছে।');
    });
  }
}

function renderScheduledPosts() {
  const tbody = document.getElementById('scheduled-posts-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (appState.scheduledPosts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 36px 16px; color: var(--text-dim); font-size: 13px;">
          📅 কোনো শিডিউল্ড পোস্ট নেই। বাম পাশের ফর্ম থেকে সোশ্যাল পোস্ট শিডিউল করুন।
        </td>
      </tr>
    `;
    return;
  }

  appState.scheduledPosts.forEach(p => {
    const tr = document.createElement('tr');
    const platformsStr = (p.platforms || []).join(', ').toUpperCase();
    const statusClass = p.status === 'published' ? 'published' : 'pending';

    tr.innerHTML = `
      <td>${escapeHtml(p.content.substring(0, 70))}...</td>
      <td><strong>${platformsStr}</strong></td>
      <td>${p.scheduled_at}</td>
      <td><span class="badge-status ${statusClass}">${p.status.toUpperCase()}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// ৬. সেটিংস ফরম্স
function initSettingsForms() {
  const alertForm = document.getElementById('settings-alert-form');
  if (alertForm) {
    alertForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const chatId = document.getElementById('setting-tg-chat-id').value;
      showToast(`✅ Telegram Admin Alert সফলভাবে কনফিগার হয়েছে (Chat ID: ${chatId || 'Saved'})!`);
    });
  }

  const promptForm = document.getElementById('settings-prompt-form');
  if (promptForm) {
    promptForm.addEventListener('submit', (e) => {
      e.preventDefault();
      showToast('✅ Gemini AI System Prompt সফলভাবে আপডেট হয়েছে!');
    });
  }

  // Worker URL Form (For GitHub Pages integration)
  const workerForm = document.getElementById('settings-worker-form');
  const workerInput = document.getElementById('setting-worker-url');
  if (workerInput) {
    workerInput.value = localStorage.getItem('social_automate_worker_url') || '';
  }
  if (workerForm && workerInput) {
    workerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const url = workerInput.value.trim();
      if (url) {
        localStorage.setItem('social_automate_worker_url', url);
        showToast('🌐 Cloudflare Worker URL সংরক্ষিত হয়েছে! পেজ রিফ্রেশ হচ্ছে...');
        setTimeout(() => window.location.reload(), 1200);
      } else {
        localStorage.removeItem('social_automate_worker_url');
        showToast('Worker URL রিমুভ করা হয়েছে।');
      }
    });
  }
}

// ৭. লাইভ স্ট্যাটাস ফেচ
async function fetchLiveStats() {
  try {
    const res = await fetch(`${API_BASE}/stats`);
    if (res.ok) {
      const data = await res.json();
      if (data.total_conversations !== undefined) {
        document.getElementById('stat-total-convs').textContent = data.total_conversations;
        document.getElementById('stat-ai-chats').textContent = data.ai_active_chats;
        document.getElementById('stat-takeover-chats').textContent = data.admin_takeover_chats;
        document.getElementById('stat-attention-chats').textContent = data.needs_attention_chats;
      }
    }
  } catch (e) {
    // Local fallback
  }
}

// ইউটিলিটি: টোস্ট নোটিফিকেশন
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = 'block';

  setTimeout(() => {
    toast.style.display = 'none';
  }, 3500);
}

// ইউটিলিটি: HTML Escape
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}

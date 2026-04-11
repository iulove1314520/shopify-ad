const TOKEN_STORAGE_KEY = 'shopee-cpas-api-token';
const DEFAULT_LIMIT = 20;
const DISPLAY_TIME_ZONE = 'Asia/Shanghai';
const AUTO_REFRESH_MS = 60_000;
let autoRefreshTimer = null;
let currentRefreshController = null;

function createEmptyBusinessData() {
  return {
    system: null,
    stats: null,
    orders: [],
    callbacks: [],
    matches: [],
    events: [],
    visitors: [],
  };
}

const state = {
  showOnlyFailures: false,
  cleanupInputsDirty: false,
  data: createEmptyBusinessData(),
};

const elements = {
  usernameInput: document.getElementById('usernameInput'),
  passwordInput: document.getElementById('passwordInput'),
  toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
  sidebar: document.querySelector('.sidebar'),
  loginBtn: document.getElementById('loginBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  openCleanupModalBtn: document.getElementById('openCleanupModalBtn'),
  cleanupModal: document.getElementById('cleanupModal'),
  cleanupModalBackdrop: document.getElementById('cleanupModalBackdrop'),
  closeCleanupModalBtn: document.getElementById('closeCleanupModalBtn'),
  cleanupDataBtn: document.getElementById('cleanupDataBtn'),
  visitorCleanupDaysInput: document.getElementById('visitorCleanupDaysInput'),
  businessCleanupDaysInput: document.getElementById('businessCleanupDaysInput'),
  resetCleanupWindowBtn: document.getElementById('resetCleanupWindowBtn'),
  cleanupSummary: document.getElementById('cleanupSummary'),
  purgeAllConfirmHint: document.getElementById('purgeAllConfirmHint'),
  purgeAllConfirmInput: document.getElementById('purgeAllConfirmInput'),
  purgeAllDataBtn: document.getElementById('purgeAllDataBtn'),
  dangerConfirmModal: document.getElementById('dangerConfirmModal'),
  dangerConfirmBackdrop: document.getElementById('dangerConfirmBackdrop'),
  dangerConfirmMessage: document.getElementById('dangerConfirmMessage'),
  dangerConfirmCancelBtn: document.getElementById('dangerConfirmCancelBtn'),
  dangerConfirmOkBtn: document.getElementById('dangerConfirmOkBtn'),
  authStatus: document.getElementById('authStatus'),
  lastUpdated: document.getElementById('lastUpdated'),
  healthPill: document.getElementById('healthPill'),
  healthStatusText: document.getElementById('healthStatusText'),
  healthEnvironment: document.getElementById('healthEnvironment'),
  cleanupHint: document.getElementById('cleanupHint'),
  healthDatabase: document.getElementById('healthDatabase'),
  healthJournal: document.getElementById('healthJournal'),
  metricGrid: document.getElementById('metricGrid'),
  orderStatusList: document.getElementById('orderStatusList'),
  callbackStatusList: document.getElementById('callbackStatusList'),
  eventStatusList: document.getElementById('eventStatusList'),
  platformStatusList: document.getElementById('platformStatusList'),
  ordersTable: document.getElementById('ordersTable'),
  callbacksTable: document.getElementById('callbacksTable'),
  matchesTable: document.getElementById('matchesTable'),
  eventsTable: document.getElementById('eventsTable'),
  visitorsTable: document.getElementById('visitorsTable'),
  failedFilterBtn: document.getElementById('failedFilterBtn'),
  filterStatusText: document.getElementById('filterStatusText'),
  scrollCanvas: document.querySelector('.scroll-canvas'),
  loginModal: document.getElementById('loginModal'),
};

const endpointConfig = {
  health: '/health',
  login: '/api/login',
  system: '/api/system',
  cleanupOldData: '/api/system/cleanup-old-data',
  purgeAllData: '/api/system/purge-all-data',
  stats: '/api/stats',
  orders: `/api/orders?limit=${DEFAULT_LIMIT}`,
  callbacks: `/api/callbacks?limit=${DEFAULT_LIMIT}`,
  matches: `/api/matches?limit=${DEFAULT_LIMIT}`,
  events: `/api/webhook-events?limit=${DEFAULT_LIMIT}`,
  visitors: `/api/visitors?limit=${DEFAULT_LIMIT}`,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

function maskToken(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '未捕获';
  }

  if (text.length <= 12) {
    return text;
  }

  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function readToken() {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY) || '';
}

function writeToken(token) {
  if (!token) {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

function setAuthStatus(text, tone = 'warning') {
  elements.authStatus.innerHTML = `
    <span class="status-dot ${tone}"></span>
    ${escapeHtml(text)}
  `;
  elements.authStatus.className = `login-card-status ${tone}`;
}

function translateEnvironment(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'production') return '正式环境';
  if (normalized === 'development') return '测试环境';
  if (normalized === 'staging') return '预发环境';
  return value || '-';
}

function translateStatus(value) {
  const normalized = String(value || '').toLowerCase();
  const dictionary = {
    success: '成功',
    failed: '失败',
    callback_failed: '回传失败',
    callback_sent: '回传成功',
    skipped: '已跳过',
    matched_no_callback: '已匹配，待补回传',
    matched_revoked: '匹配已撤销',
    unmatched: '未匹配',
    processed: '处理完毕',
    processing_failed: '处理失败',
    pending: '处理中',
    received: '已收到',
    duplicate_ignored: '重复跳过',
    ignored_pending: '状态不符跳过',
    no_visitors_in_window: '时间窗口内没有访客',
    visitors_missing_click_id: '访客没有广告点击参数',
    visitors_missing_click_id_or_occupied: '无可用访客（缺点击ID或已被占用）',
    ambiguous_match_candidates: '候选记录过于接近，系统不敢自动判定',
    product_not_matched: '有访客，但商品对不上',
    time_gap_too_large: '访客和下单时间差过大',
    score_below_threshold: '匹配分太低，系统判定不可靠',
    no_valid_match_candidate: '没有足够可靠的匹配对象',
    main_score_too_low: '主路径匹配分不足',
    main_gap_too_small: '主路径领先分差不够',
    fallback_score_too_low: '降级路径匹配分不足',
    fallback_gap_too_small: '降级路径候选太接近',
    no_candidate: '无有效候选',
    ok: '正常',
    tiktok: 'TikTok',
    facebook: 'Facebook',
    high: '高可信',
    medium: '中可信',
    low: '低可信',
    paid: '已付款',
    authorized: '已授权',
    refunded: '已退款',
    partially_refunded: '部分退款',
    '高': '高可信',
    '中': '中可信',
    '低': '低可信',
    main: '主路径',
    fallback: '降级路径',
  };

  return dictionary[normalized] || value || '-';
}

function getStatusTone(status = '') {
  const normalized = String(status).toLowerCase();

  if (
    normalized.includes('success') ||
    normalized.includes('callback_sent') ||
    normalized === 'processed' ||
    normalized === 'ok'
  ) {
    return 'success';
  }

  if (
    normalized.includes('fail') ||
    normalized.includes('invalid') ||
    normalized === 'unmatched' ||
    normalized.includes('error') ||
    normalized === 'matched_revoked'
  ) {
    return 'danger';
  }

  if (
    normalized.includes('skip') ||
    normalized.includes('pending') ||
    normalized.includes('ignored') ||
    normalized.includes('matched_no_callback')
  ) {
    return 'warning';
  }

  if (
    normalized.includes('tiktok') ||
    normalized.includes('facebook') ||
    normalized.includes('high')
  ) {
    return 'info';
  }

  return 'muted';
}

function badge(value, label = translateStatus(value)) {
  return `<span class="badge badge-${getStatusTone(value)}">${escapeHtml(label)}</span>`;
}

function describeReasonKey(key) {
  const dictionary = {
    reason: '未成功原因',
    total_visitors: '时间窗口内访客数',
    eligible_visitors: '带广告参数的访客数',
    candidates: '有效候选数',
    product_match_candidates: '商品能对上的候选数',
    ip_match_candidates: 'IP 或地区能对上的候选数',
    best_score: '最高匹配分',
    second_score: '第二名分数',
    score_gap: '第一名领先分差',
    best_time_diff_minutes: '最佳候选时间差(分钟)',
    matched_platform: '匹配平台',
    confidence: '匹配可信度',
    score: '匹配分',
    signals: '命中信号',
    callback: '回传结果',
    attempt: '发送次数',
    failure_code: '失败代码',
    http_status: 'HTTP 状态',
    retryable: '是否可重试',
    error: '失败说明',
    mode: '匹配路径',
    product: '商品证据',
    time_diff_minutes: '时间差(分钟)',
    ip: 'IP 信号',
    lead_gap: '领先分差',
    click_source: '点击来源',
  };

  return dictionary[key] || key;
}

function translateSignalToken(value) {
  const dictionary = {
    time_close: '下单时间很接近（≤1h）',
    time_medium: '下单时间中等距离（1-6h）',
    time_window_ok: '在合理时间窗口内',
    time_far: '时间偏远（6-24h）',
    product_match: '商品信息一致',
    product_mismatch: '商品信息不一致',
    product_strong: '商品证据强一致',
    product_weak: '商品证据部分相似',
    browser_ip_exact: '浏览器 IP 一致',
    browser_ip_mismatch: '浏览器 IP 不一致',
    geo_country: '国家一致',
    geo_region: '地区一致',
    geo_city: '城市一致',
  };

  return dictionary[value] || value;
}

function translateReasonValue(key, value) {
  if (!value) {
    return '-';
  }

  if (key === 'reason' || key === 'matched_platform' || key === 'confidence' || key === 'callback') {
    return translateStatus(value);
  }

  if (key === 'signals') {
    return String(value)
      .split(',')
      .map((item) => translateSignalToken(item.trim()))
      .filter(Boolean)
      .join('、');
  }

  if (key === 'retryable') {
    return String(value).toLowerCase() === 'true' ? '可以自动重试' : '不建议自动重试';
  }

  return value;
}

function parseReasonDetail(value) {
  return String(value || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [key, ...rest] = part.split('=');
      return {
        key: String(key || '').trim(),
        value: rest.join('=').trim(),
      };
    })
    .filter((item) => item.key && item.value);
}

function describeMetric(key) {
  const descriptions = {
    visitors: '成功记录下来的广告点击访问人数。',
    orders: '系统收到并保存的订单总数。',
    matches: '成功找到对应广告点击的订单数。',
    callbacks: '系统尝试向广告平台发回传的总次数。',
    successful_callbacks: '广告平台真正接收成功的次数。',
  };

  return descriptions[key] || '';
}

function renderMetricGrid(stats) {
  const callbackSuccessCount = (stats?.callbacks_by_status || []).reduce(
    (sum, item) => {
      const status = String(item.status || '').toLowerCase();
      if (status === 'success' || status === 'callback_sent') {
        return sum + Number(item.count || 0);
      }

      return sum;
    },
    0
  );

  const formatter = new Intl.NumberFormat();
  const cards = [
    ['visitors', '广告访问人数', formatter.format(stats?.counts?.visitors ?? 0)],
    ['orders', '累计订单数量', formatter.format(stats?.counts?.orders ?? 0)],
    ['matches', '成功匹配总数', formatter.format(stats?.counts?.matches ?? 0)],
    ['callbacks', '触发回传次数', formatter.format(stats?.counts?.callbacks ?? 0)],
    ['successful_callbacks', '实际回传成功', formatter.format(callbackSuccessCount)],
  ];

  const frag = document.createDocumentFragment();
  cards.forEach(([key, label, value]) => {
    const div = document.createElement('div');
    div.className = 'metric-card glass-panel';
    div.title = describeMetric(key);
    div.innerHTML = `
      <span class="metric-label">${escapeHtml(label)}</span>
      <div class="metric-value mono">${escapeHtml(value)}</div>
      <small class="metric-desc">${escapeHtml(describeMetric(key))}</small>
    `;
    frag.appendChild(div);
  });

  elements.metricGrid.innerHTML = '';
  elements.metricGrid.appendChild(frag);
}

function renderStatusList(container, rows, emptyLabel) {
  if (!rows || rows.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>暂无数据</strong>
        ${escapeHtml(emptyLabel)}
      </div>
    `;
    return;
  }

  const frag = document.createDocumentFragment();
  const listDiv = document.createElement('div');
  listDiv.className = 'status-list';

  rows.forEach((row) => {
    const translated = translateStatus(row.status);
    const itemDiv = document.createElement('div');
    itemDiv.className = 'status-item';
    itemDiv.innerHTML = `
      <div class="status-item-left">
        <strong>${escapeHtml(translated)}</strong>
        <span>共 ${escapeHtml(row.count)} 条记录</span>
      </div>
      <span class="status-count">${escapeHtml(row.count)}</span>
    `;
    listDiv.appendChild(itemDiv);
  });

  frag.appendChild(listDiv);
  container.innerHTML = '';
  container.appendChild(frag);
}

function getCleanupLimits(system) {
  const minDays = Number(system?.cleanup_limits?.min_days);
  const maxDays = Number(system?.cleanup_limits?.max_days);

  return {
    minDays: Number.isFinite(minDays) ? minDays : 1,
    maxDays: Number.isFinite(maxDays) ? maxDays : 3650,
  };
}

function isValidCleanupDay(value, limits) {
  return (
    Number.isInteger(value) &&
    value >= limits.minDays &&
    value <= limits.maxDays
  );
}

function clampCleanupDay(value, fallback, limits) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const rounded = Math.round(parsed);
  if (rounded < limits.minDays) {
    return fallback;
  }

  if (rounded > limits.maxDays) {
    return limits.maxDays;
  }

  return rounded;
}

function getDefaultCleanupDays(system) {
  const visitorDays = Number(system?.retention_policy?.visitors_days);
  const businessDays = Number(system?.retention_policy?.business_days);
  const limits = getCleanupLimits(system);

  return {
    visitorDays: isValidCleanupDay(visitorDays, limits) ? visitorDays : 7,
    businessDays: isValidCleanupDay(businessDays, limits) ? businessDays : 30,
  };
}

function getPurgeAllConfirmText(system) {
  const value = String(system?.dangerous_actions?.purge_all_confirm_text || '').trim();
  return value || '清空全部数据';
}

function updatePurgeAllUi(system) {
  const confirmText = getPurgeAllConfirmText(system);
  const inputValue = String(elements.purgeAllConfirmInput?.value || '').trim();

  if (elements.purgeAllConfirmHint) {
    elements.purgeAllConfirmHint.textContent = `确认文本：${confirmText}`;
  }

  if (elements.purgeAllDataBtn) {
    elements.purgeAllDataBtn.disabled = inputValue !== confirmText;
  }
}

function renderCleanupSummary(stats) {
  if (!elements.cleanupSummary) {
    return;
  }

  const counts = stats?.counts;
  if (!counts) {
    elements.cleanupSummary.textContent =
      '登录后可查看当前访客、订单、匹配、回传和 Webhook 的数量。';
    return;
  }

  elements.cleanupSummary.textContent =
    `当前数据概况：访客 ${counts.visitors ?? 0} 条，订单 ${counts.orders ?? 0} 笔，` +
    `匹配 ${counts.matches ?? 0} 条，回传 ${counts.callbacks ?? 0} 条，` +
    `Webhook ${counts.webhook_events ?? 0} 条。`;
}

function syncCleanupInputs(system, force = false) {
  if (!elements.visitorCleanupDaysInput || !elements.businessCleanupDaysInput) {
    return;
  }

  const defaults = getDefaultCleanupDays(system);
  const limits = getCleanupLimits(system);

  elements.visitorCleanupDaysInput.min = String(limits.minDays);
  elements.visitorCleanupDaysInput.max = String(limits.maxDays);
  elements.businessCleanupDaysInput.min = String(limits.minDays);
  elements.businessCleanupDaysInput.max = String(limits.maxDays);

  if (!state.cleanupInputsDirty || force) {
    elements.visitorCleanupDaysInput.value = String(defaults.visitorDays);
    elements.businessCleanupDaysInput.value = String(defaults.businessDays);
    return;
  }

  const currentVisitorDays = Number(elements.visitorCleanupDaysInput.value);
  const currentBusinessDays = Number(elements.businessCleanupDaysInput.value);

  if (!isValidCleanupDay(currentVisitorDays, limits)) {
    elements.visitorCleanupDaysInput.value = String(defaults.visitorDays);
  }

  if (!isValidCleanupDay(currentBusinessDays, limits)) {
    elements.businessCleanupDaysInput.value = String(defaults.businessDays);
  }
}

function normalizeCleanupInputs(system) {
  const defaults = getDefaultCleanupDays(system);
  const limits = getCleanupLimits(system);

  if (elements.visitorCleanupDaysInput) {
    elements.visitorCleanupDaysInput.value = String(
      clampCleanupDay(
        elements.visitorCleanupDaysInput.value,
        defaults.visitorDays,
        limits
      )
    );
  }

  if (elements.businessCleanupDaysInput) {
    elements.businessCleanupDaysInput.value = String(
      clampCleanupDay(
        elements.businessCleanupDaysInput.value,
        defaults.businessDays,
        limits
      )
    );
  }
}

function readSelectedCleanupDays(system) {
  const defaults = getDefaultCleanupDays(system);
  const limits = getCleanupLimits(system);
  const visitorRaw = elements.visitorCleanupDaysInput?.value?.trim();
  const businessRaw = elements.businessCleanupDaysInput?.value?.trim();
  const visitorDays = Number(visitorRaw || defaults.visitorDays);
  const businessDays = Number(businessRaw || defaults.businessDays);

  if (
    !Number.isInteger(visitorDays) ||
    visitorDays < limits.minDays ||
    visitorDays > limits.maxDays
  ) {
    throw new Error(
      `访客保留天数需填写 ${limits.minDays}-${limits.maxDays} 之间的整数。`
    );
  }

  if (
    !Number.isInteger(businessDays) ||
    businessDays < limits.minDays ||
    businessDays > limits.maxDays
  ) {
    throw new Error(
      `订单和日志保留天数需填写 ${limits.minDays}-${limits.maxDays} 之间的整数。`
    );
  }

  return {
    visitorDays,
    businessDays,
  };
}

function getRetentionText(system) {
  const defaults = getDefaultCleanupDays(system);
  const limits = getCleanupLimits(system);
  const hasInputs =
    Boolean(elements.visitorCleanupDaysInput) &&
    Boolean(elements.businessCleanupDaysInput);
  const selected = hasInputs
    ? {
        visitorDays: clampCleanupDay(
          elements.visitorCleanupDaysInput.value,
          defaults.visitorDays,
          limits
        ),
        businessDays: clampCleanupDay(
          elements.businessCleanupDaysInput.value,
          defaults.businessDays,
          limits
        ),
      }
    : defaults;
  const usingDefaults =
    selected.visitorDays === defaults.visitorDays &&
    selected.businessDays === defaults.businessDays;
  const prefix = usingDefaults ? '当前按系统默认清理：' : '当前按自定义时间清理：';

  return `${prefix}访客记录保留最近 ${selected.visitorDays} 天，订单、匹配、回传和 Webhook 记录保留最近 ${selected.businessDays} 天。`;
}

function updateCleanupHint(system) {
  if (!elements.cleanupHint) {
    return;
  }

  elements.cleanupHint.textContent = getRetentionText(system);
}

function openCleanupModal() {
  syncCleanupInputs(state.data.system);
  normalizeCleanupInputs(state.data.system);
  updateCleanupHint(state.data.system);
  renderCleanupSummary(state.data.stats);

  if (elements.purgeAllConfirmInput) {
    elements.purgeAllConfirmInput.value = '';
  }

  updatePurgeAllUi(state.data.system);

  if (elements.cleanupModal) {
    elements.cleanupModal.hidden = false;

    const cleanupTabs = document.querySelectorAll('.cleanup-tab');
    const cleanupTabContents = document.querySelectorAll('.cleanup-tab-content');
    cleanupTabs.forEach(t => t.classList.remove('active'));
    cleanupTabContents.forEach(c => c.classList.remove('active'));

    const defaultTab = document.querySelector('[data-target="cleanup-retention"]');
    const defaultContent = document.getElementById('cleanup-retention');
    if (defaultTab) defaultTab.classList.add('active');
    if (defaultContent) defaultContent.classList.add('active');

    trapFocus(elements.cleanupModal, elements.openCleanupModalBtn);
  }
}

function closeCleanupModal() {
  releaseFocus();
  if (elements.cleanupModal) {
    elements.cleanupModal.hidden = true;
  }

  if (elements.purgeAllConfirmInput) {
    elements.purgeAllConfirmInput.value = '';
  }

  updatePurgeAllUi(state.data.system);
}

function renderPlatformStatus(system) {
  const platforms = Array.isArray(system?.platforms) ? system.platforms : [];

  if (!elements.platformStatusList) {
    return;
  }

  if (platforms.length === 0) {
    renderEmpty(
      elements.platformStatusList,
      '暂无平台状态',
      '登录后可查看 TikTok 和 Facebook 的配置检查结果。'
    );
    return;
  }

  const frag = document.createDocumentFragment();
  const listDiv = document.createElement('div');
  listDiv.className = 'status-list';

  platforms.forEach((item) => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'status-item';
    itemDiv.innerHTML = `
      <div class="status-item-left">
        <strong>${escapeHtml(item.label)}</strong>
        <span class="platform-issues">
          ${escapeHtml(
            item.configured
              ? '关键配置已就绪，可以正常尝试回传。'
              : item.issues.join('、')
          )}
        </span>
      </div>
      ${badge(item.configured ? 'success' : 'failed', item.configured ? '已就绪' : '待补齐')}
    `;
    listDiv.appendChild(itemDiv);
  });

  frag.appendChild(listDiv);
  elements.platformStatusList.innerHTML = '';
  elements.platformStatusList.appendChild(frag);
}

function renderEmpty(container, title, message) {
  container.innerHTML = `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      ${escapeHtml(message)}
    </div>
  `;
}

function renderTextDetail(value, emptyLabel = '-') {
  if (!value) {
    return `<span class="muted">${escapeHtml(emptyLabel)}</span>`;
  }

  const text = String(value);
  if (text.length <= 50) {
    return `<div class="wrap mono">${escapeHtml(text)}</div>`;
  }

  return `
    <details class="text-detail">
      <summary>点击查看完整内容</summary>
      <div class="detail-content-wrap">
        <p>${escapeHtml(text)}</p>
        <button class="btn-copy-float" data-copy-text="${escapeHtml(text).replace(/"/g, '&quot;')}" title="复制完整内容">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
      </div>
    </details>
  `;
}

async function copyToClipboard(btn) {
  const text = btn.getAttribute('data-copy-text');
  try {
    await navigator.clipboard.writeText(text);
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = originalHtml;
      btn.classList.remove('copied');
    }, 2000);
  } catch(e) {
    console.error('Copy failed', e);
  }
}

function renderReasonDetail(value, emptyLabel = '暂无说明') {
  const parts = parseReasonDetail(value);
  if (parts.length === 0) {
    return renderTextDetail(value, emptyLabel);
  }

  const primaryPart = parts.find(p => p.key === 'reason') || parts.find(p => p.key === 'error') || parts[0];
  const otherParts = parts.filter(p => p !== primaryPart);

  const primaryText = escapeHtml(translateReasonValue(primaryPart.key, primaryPart.value));
  
  if (otherParts.length === 0) {
    return `<div style="color: var(--warning); font-weight: 500; font-size: 0.9rem;">${primaryText}</div>`;
  }

  return `
    <div style="color: var(--warning); font-weight: 500; font-size: 0.9rem; margin-bottom: 8px; line-height: 1.4;">
      ${primaryText}
    </div>
    <details class="text-detail">
      <summary>排查数据明细</summary>
      <div class="detail-content-wrap">
        <div class="reason-list" style="margin-top: 8px;">
          ${otherParts
            .map(
              (item) => `
                <div class="reason-item">
                  <span class="reason-key">${escapeHtml(describeReasonKey(item.key))}</span>
                  <span class="reason-value">${escapeHtml(translateReasonValue(item.key, item.value))}</span>
                </div>
              `
            )
            .join('')}
        </div>
      </div>
    </details>
  `;
}



function updateHealth(health) {
  const isHealthy = Boolean(health?.ok);
  elements.healthPill.className = `health-pill pulse-${isHealthy ? 'success' : 'danger'}`;
  elements.healthStatusText.textContent = isHealthy ? '后台运行正常' : '后台运行异常';
  elements.healthEnvironment.textContent = translateEnvironment(health?.environment);
  elements.healthDatabase.textContent = '-';
  elements.healthJournal.textContent = '-';
}

function updateSystemDetail(system) {
  if (!system) {
    return;
  }

  elements.healthDatabase.textContent = system?.database?.reachable ? '√' : 'X';
  elements.healthJournal.textContent = system?.database?.journal_mode || '-';
  syncCleanupInputs(system);
  updateCleanupHint(system);
}

async function requestJson(url, options = {}) {
  const { token = '', method = 'GET', body, signal } = options;
  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  const responseText = await response.text();
  let payload = null;

  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch (error) {
      payload = responseText;
    }
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && (payload.message || payload.error)) ||
      responseText ||
      `HTTP ${response.status}`;

    throw new Error(message);
  }

  return payload;
}

// ── Focus Trap ────────────────────────────────────────────────────────────
let _focusTrapCleanup = null;
let _focusTrapTrigger = null;

function trapFocus(modalEl, triggerEl = null) {
  _focusTrapTrigger = triggerEl;
  const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const getFocusable = () => Array.from(modalEl.querySelectorAll(FOCUSABLE));

  function handler(e) {
    if (e.key !== 'Tab') return;
    const focusable = getFocusable();
    if (focusable.length === 0) { e.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  modalEl.addEventListener('keydown', handler);
  _focusTrapCleanup = () => modalEl.removeEventListener('keydown', handler);
  const focusable = getFocusable();
  if (focusable.length > 0) focusable[0].focus();
}

function releaseFocus() {
  if (_focusTrapCleanup) { _focusTrapCleanup(); _focusTrapCleanup = null; }
  if (_focusTrapTrigger) { _focusTrapTrigger.focus(); _focusTrapTrigger = null; }
}
// ── End Focus Trap ────────────────────────────────────────────────────────────

// ── Auto-Refresh ───────────────────────────────────────────────────────────
function stopAutoRefresh() {
  if (autoRefreshTimer !== null) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(refreshDashboard, AUTO_REFRESH_MS);
}
// ── End Auto-Refresh ───────────────────────────────────────────────────────────

function bootstrapAuth() {
  const token = readToken();
  syncCleanupInputs(null, true);
  updateCleanupHint(null);
  renderCleanupSummary(null);
  updatePurgeAllUi(null);

  if (token) {
    hideLoginModal();
    setAuthStatus('已登录，正在加载数据...', 'success');
    return;
  }

  showLoginModal();
  setAuthStatus('请登录以查看业务数据。', 'warning');
}

function showLoginModal() {
  elements.loginModal.hidden = false;
  elements.logoutBtn.hidden = true;
  document.body.classList.add('login-active');
}

function hideLoginModal() {
  elements.loginModal.hidden = true;
  elements.logoutBtn.hidden = false;
  document.body.classList.remove('login-active');
}

async function handleLogin() {
  const username = (elements.usernameInput?.value || '').trim();
  const password = (elements.passwordInput?.value || '').trim();

  if (!username || !password) {
    setAuthStatus('请输入用户名和密码。', 'warning');
    return;
  }

  elements.loginBtn.disabled = true;
  setAuthStatus('正在登录...', 'warning');

  try {
    const result = await requestJson(endpointConfig.login, {
      method: 'POST',
      body: { username, password },
    });

    if (result?.token) {
      writeToken(result.token);
      hideLoginModal();
      setAuthStatus('登录成功，正在加载数据...', 'success');
      refreshDashboard();
    }
  } catch (error) {
    setAuthStatus(error.message || '登录失败', 'danger');
  } finally {
    elements.loginBtn.disabled = false;
  }
}

function handleLogout() {
  stopAutoRefresh();
  writeToken('');
  if (elements.usernameInput) elements.usernameInput.value = '';
  if (elements.passwordInput) elements.passwordInput.value = '';
  state.data = createEmptyBusinessData();
  state.showOnlyFailures = false;
  state.cleanupInputsDirty = false;
  showLoginModal();
  clearBusinessViews('请登录以查看业务数据。');
  updateFilterUi();
  setAuthStatus('已退出登录。', 'warning');
}

function clearBusinessViews(message) {
  const fallbackMessage = message || '暂未获得访问权限。';

  updateCleanupHint(null);
  renderCleanupSummary(null);
  updatePurgeAllUi(null);
  renderMetricGrid({ counts: {}, callbacks_by_status: [] });
  renderEmpty(elements.orderStatusList, '暂无统计数据', fallbackMessage);
  renderEmpty(elements.callbackStatusList, '暂无统计数据', fallbackMessage);
  renderEmpty(elements.eventStatusList, '暂无统计数据', fallbackMessage);
  renderEmpty(elements.platformStatusList, '暂无平台状态', fallbackMessage);
  renderEmpty(elements.ordersTable, '暂无订单记录', fallbackMessage);
  renderEmpty(elements.callbacksTable, '暂无回调记录', fallbackMessage);
  renderEmpty(elements.matchesTable, '暂无匹配记录', fallbackMessage);
  renderEmpty(elements.eventsTable, '暂无事件记录', fallbackMessage);
  renderEmpty(elements.visitorsTable, '暂无访客记录', fallbackMessage);
}

function isProblemOrder(order) {
  const status = String(order?.status || '').toLowerCase();
  return [
    'callback_failed',
    'processing_failed',
    'unmatched',
    'matched_no_callback',
    'matched_revoked',
  ].includes(status);
}

function isProblemCallback(callback) {
  const status = String(callback?.status || '').toLowerCase();
  return status === 'failed' || status === 'skipped';
}

function isProblemEvent(event) {
  return String(event?.status || '').toLowerCase() === 'failed';
}

function canRetryOrder(order) {
  const status = String(order?.status || '').toLowerCase();
  const financialStatus = String(order?.financial_status || '').toLowerCase();

  if (financialStatus === 'pending') {
    return false;
  }

  return !['callback_sent', 'duplicate_ignored', 'ignored_pending'].includes(status);
}

function getFilteredRows(rows, type) {
  if (!state.showOnlyFailures) {
    return rows;
  }

  if (type === 'orders') {
    return rows.filter(isProblemOrder);
  }

  if (type === 'callbacks') {
    return rows.filter(isProblemCallback);
  }

  if (type === 'events') {
    return rows.filter(isProblemEvent);
  }

  return rows;
}

function updateFilterUi() {
  if (!elements.failedFilterBtn || !elements.filterStatusText) {
    return;
  }

  elements.failedFilterBtn.classList.toggle('is-active', state.showOnlyFailures);
  elements.failedFilterBtn.setAttribute(
    'aria-pressed',
    state.showOnlyFailures ? 'true' : 'false'
  );
  elements.failedFilterBtn.textContent = state.showOnlyFailures
    ? '显示全部明细'
    : '只看异常明细';
  elements.filterStatusText.textContent = state.showOnlyFailures
    ? '当前只显示异常订单、失败回传和失败事件。'
    : '当前显示全部订单、回调和事件记录。';
}

function renderOrders(container, rows, emptyTitle, emptyMessage) {
  if (!rows || rows.length === 0) {
    renderEmpty(container, emptyTitle, emptyMessage);
    return;
  }
  const frag = document.createDocumentFragment();
  const feedList = document.createElement('div');
  feedList.className = 'order-list-grid';

  rows.forEach((row, index) => {
    const card = document.createElement('div');
    card.className = 'order-ui-card';
    card.style.animationDelay = `${index * 0.05}s`;

    const statusBadge = badge(row.status);
    const amountStr = `${escapeHtml(row.total_price)} ${escapeHtml(row.currency)}`;
    const dateStr = escapeHtml(formatDate(row.created_at));
    const payStatusText = escapeHtml(translateStatus(row.financial_status) || row.financial_status || '-');

    let actionHtml = '';
    if (canRetryOrder(row)) {
      actionHtml = `
        <button
          class="order-btn-retry"
          type="button"
          data-action="retry-order"
          data-order-id="${escapeHtml(row.order_id)}"
        >
          手动重试 / 重发回调
        </button>
      `;
    }

    card.innerHTML = `
      <div class="order-hd">
        <div class="order-id-block">
          <span class="order-tag">Order ID</span>
          <span class="order-uid mono">${escapeHtml(row.order_id)}</span>
        </div>
        <div class="order-status-block">${statusBadge}</div>
      </div>
      <div class="order-bd">
        <div class="o-amount-group">
          <div class="o-amount-val mono">${amountStr}</div>
          <div class="o-amount-sub">支付状态：${payStatusText}</div>
        </div>
        <div class="o-meta-grid">
          <div class="o-meta-row">
            <span class="o-meta-label">接收时间</span>
            <span class="o-meta-value">${dateStr}</span>
          </div>
          <div class="o-meta-row">
            <span class="o-meta-label">排查编号</span>
            <span class="o-meta-value">${renderTextDetail(row.trace_id, '暂无')}</span>
          </div>
          ${row.status_reason ? `
          <div class="o-meta-row o-error-row">
            <span class="o-meta-label">诊断结论</span>
            <span class="o-meta-value">${renderReasonDetail(row.status_reason, '正常')}</span>
          </div>` : ''}
        </div>
      </div>
      ${actionHtml ? `<div class="order-ft">${actionHtml}</div>` : ''}
    `;

    feedList.appendChild(card);
  });

  frag.appendChild(feedList);
  container.innerHTML = '';
  container.appendChild(frag);
}

function renderCallbacks(container, rows, emptyTitle, emptyMessage) {
  if (!rows || rows.length === 0) {
    renderEmpty(container, emptyTitle, emptyMessage);
    return;
  }
  const frag = document.createDocumentFragment();
  const feedList = document.createElement('div');
  feedList.className = 'cb-feed';

  rows.forEach((row, index) => {
    const card = document.createElement('div');
    card.className = 'cb-card glass-panel';
    card.style.animationDelay = `${index * 0.04}s`;

    const statusBadge = badge(row.status);
    const platformBadge = badge(row.platform, row.platform || '-');
    const triggerLabel = row.trigger_source === 'manual_retry' ? '手动' : '自动';
    const httpLabel = row.http_status ? `HTTP ${row.http_status}` : '';

    // Order ID display — combine system ID + Shopify human-readable number
    const orderName = row.shopify_order_name
      ? `<span class="cb-shopify-name">${escapeHtml(row.shopify_order_name)}</span>`
      : '';
    const orderIdDisplay = `<span class="cb-order-id mono">${escapeHtml(row.order_id)}</span>${orderName}`;

    // Footer: only show if there's response or error data
    const hasFooter = row.response_summary || row.error_message || row.trace_id;
    let footerHtml = '';
    if (hasFooter) {
      const detailItems = [];
      if (row.trace_id) {
        detailItems.push(`<div class="cb-detail-row"><span class="cb-dl">链路</span><span class="cb-dv mono">${escapeHtml(maskToken(row.trace_id))}</span></div>`);
      }
      if (row.response_summary) {
        detailItems.push(`<div class="cb-detail-row"><span class="cb-dl">返回值</span><span class="cb-dv mono">${escapeHtml(row.response_summary.length > 80 ? row.response_summary.slice(0, 80) + '…' : row.response_summary)}</span></div>`);
      }
      if (row.error_message) {
        detailItems.push(`<div class="cb-detail-row cb-detail-error"><span class="cb-dl">错误</span><span class="cb-dv mono">${escapeHtml(row.error_message)}</span></div>`);
      }
      footerHtml = `
        <details class="cb-expand">
          <summary>
            <span class="cb-expand-label">${row.error_message ? '⚠ 查看错误详情' : '排查明细'}</span>
            <svg class="cb-expand-chevron" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </summary>
          <div class="cb-detail-body">${detailItems.join('')}</div>
        </details>
      `;
    }

    card.innerHTML = `
      <div class="cb-row-hd">
        <div class="cb-row-left">
          ${platformBadge}
          ${statusBadge}
          ${httpLabel ? `<span class="cb-http-code mono">${escapeHtml(httpLabel)}</span>` : ''}
        </div>
        <span class="cb-ts">${escapeHtml(formatDate(row.callback_time))}</span>
      </div>
      <div class="cb-row-body">
        <div class="cb-order-line">
          <span class="cb-order-label">关联订单</span>
          ${orderIdDisplay}
        </div>
        <div class="cb-meta-strip">
          <span class="cb-chip">${escapeHtml(triggerLabel)}</span>
          <span class="cb-chip mono">尝试 #${escapeHtml(String(row.attempt_number || '1'))}</span>
        </div>
      </div>
      ${footerHtml}
    `;

    feedList.appendChild(card);
  });

  frag.appendChild(feedList);
  container.innerHTML = '';
  container.appendChild(frag);
}


function translateMatchMode(mode) {
  if (!mode) return '-';
  if (mode === 'main') return '主路径';
  if (mode === 'fallback') return '降级路径';
  return mode;
}

function renderMatches(container, rows, emptyTitle, emptyMessage) {
  if (!rows || rows.length === 0) {
    renderEmpty(container, emptyTitle, emptyMessage);
    return;
  }
  const frag = document.createDocumentFragment();
  const feedList = document.createElement('div');
  feedList.className = 'match-list-grid';

  rows.forEach((row, index) => {
    const card = document.createElement('div');
    card.className = 'match-ui-card glass-panel';
    card.style.animationDelay = `${index * 0.05}s`;

    const isActive = row.active !== 0;
    const platformBadge = badge(row.platform, row.platform || '-');
    const confidenceBadge = badge(row.confidence, translateStatus(row.confidence));
    const scoreVal = row.match_score ?? '-';
    const modeBadge = row.match_mode
      ? badge(row.match_mode === 'main' ? 'ok' : 'pending', translateMatchMode(row.match_mode))
      : '<span class="muted">-</span>';
    const gapVal = row.lead_score_gap != null ? row.lead_score_gap : '-';
    const activeLabel = isActive
      ? '<span class="badge badge-success">占用中</span>'
      : '<span class="badge badge-danger">已释放</span>';

    // Parse signals
    const signalsRaw = row.match_signals || '';
    const signalTokens = String(signalsRaw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const translatedSignals = signalTokens.map(translateSignalToken);
    const signalsCount = translatedSignals.length;

    let revokeHtml = '';
    if (isActive) {
      revokeHtml = `
        <button
          class="order-btn-retry" style="background: rgba(255,69,58,0.15); color: var(--danger); border-color: rgba(255,69,58,0.3);"
          type="button"
          data-action="revoke-match"
          data-order-id="${escapeHtml(row.order_id)}"
        >
          撤销匹配
        </button>
      `;
    }

    // Compact signals (collapsible)
    let signalsHtml = '';
    if (signalsCount > 0) {
      signalsHtml = `
      <details class="match-signals-ft">
        <summary>
          <div class="m-signals-hd">
            <span class="m-signals-icon">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </span>
            <span class="m-signals-title">证据链</span>
            <span class="m-signals-count">${signalsCount} 项</span>
          </div>
          <svg class="m-signals-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </summary>
        <div class="m-signals-detail">
          <div class="m-signals-list">
            ${translatedSignals.map((s) => `<span class="m-signal-tag">${escapeHtml(s)}</span>`).join('')}
          </div>
        </div>
      </details>`;
    }

    // Decision summary - compact inline
    let decisionHtml = '';
    if (row.decision_summary) {
      decisionHtml = `
      <div class="m-decision-zone">
        <div class="m-decision-title">决策摘要</div>
        ${renderReasonDetail(row.decision_summary, '暂无')}
      </div>`;
    }

    card.innerHTML = `
      <div class="match-hd">
        <div class="match-hd-left">
          <span class="match-hd-tag">订单 ID</span>
          <span class="match-hd-oid mono">${escapeHtml(row.order_id)}</span>
        </div>
        <div class="match-hd-right">
          ${platformBadge}
          ${activeLabel}
        </div>
      </div>

      <div class="match-bd">
        <div class="m-metrics-strip">
          <div class="m-metric-cell m-metric-score">
            <span class="m-metric-num mono">${scoreVal}</span>
            <span class="m-metric-lbl">匹配分</span>
          </div>
          <div class="m-metric-cell">
            <div class="m-metric-badge">${confidenceBadge}</div>
            <span class="m-metric-lbl">可信度</span>
          </div>
          <div class="m-metric-cell">
            <div class="m-metric-badge">${modeBadge}</div>
            <span class="m-metric-lbl">路径</span>
          </div>
          <div class="m-metric-cell">
            <span class="m-metric-num mono">${escapeHtml(gapVal)}</span>
            <span class="m-metric-lbl">领先分差</span>
          </div>
          <div class="m-metric-cell">
            <span class="m-metric-num mono">${escapeHtml(row.time_diff_seconds)}<small>s</small></span>
            <span class="m-metric-lbl">时间差</span>
          </div>
        </div>

        <div class="m-data-rows">
          <div class="m-data-row">
            <span class="m-data-label">追踪码</span>
            <span class="m-data-value mono">${escapeHtml(maskToken(row.click_id))}</span>
          </div>
          ${row.visitor_ip ? `
          <div class="m-data-row">
            <span class="m-data-label">绑定 IP</span>
            <span class="m-data-value mono">${escapeHtml(row.visitor_ip)}</span>
          </div>` : ''}
          <div class="m-data-row">
            <span class="m-data-label">快照时间</span>
            <span class="m-data-value">${escapeHtml(formatDate(row.match_time))}</span>
          </div>
        </div>
      </div>

      ${signalsHtml}
      ${decisionHtml}
      ${revokeHtml ? `<div class="match-action-ft">${revokeHtml}</div>` : ''}
    `;

    feedList.appendChild(card);
  });

  frag.appendChild(feedList);
  container.innerHTML = '';
  container.appendChild(frag);
}

function renderEvents(container, rows, emptyTitle, emptyMessage) {
  if (!rows || rows.length === 0) {
    renderEmpty(container, emptyTitle, emptyMessage);
    return;
  }
  const frag = document.createDocumentFragment();
  const feedList = document.createElement('div');
  feedList.className = 'event-list-grid';

  rows.forEach((row, index) => {
    const card = document.createElement('div');
    card.className = 'event-ui-card glass-panel';
    card.style.animationDelay = `${index * 0.05}s`;

    const statusBadge = badge(row.status);
    
    card.innerHTML = `
      <div class="evt-hd">
        <div class="evt-topic"><span class="mono" style="font-weight:700; color:var(--text-main); font-size:1rem;">${escapeHtml(row.topic)}</span></div>
        <div class="evt-status">${statusBadge}</div>
      </div>
      <div class="evt-bd">
        <div class="evt-row">
          <span class="evt-lbl">提取订单戳:</span>
          <span class="evt-val mono" style="color:var(--text-main);">${escapeHtml(row.shopify_order_id || '未能提取 / 无关事件')}</span>
        </div>
        <div class="evt-row">
          <span class="evt-lbl">Shopify 握手签:</span>
          <span class="evt-val mono">${escapeHtml(row.webhook_id)}</span>
        </div>
        <div class="evt-row">
          <span class="evt-lbl">内部排查环:</span>
          <span class="evt-val mono">${renderTextDetail(row.trace_id, '暂无')}</span>
        </div>
        <div class="evt-row">
          <span class="evt-lbl">时间戳流:</span>
          <span class="evt-val">${escapeHtml(formatDate(row.received_at))}</span>
        </div>
      </div>
      ${row.error_message ? `
      <div class="evt-ft error-zone">
         <span class="evt-err-lbl">解包异样警示</span>
         <div class="mono" style="color:var(--danger); font-size:0.8rem; word-break:break-all; margin-top:4px;">${escapeHtml(row.error_message)}</div>
      </div>
      ` : ''}
    `;
    feedList.appendChild(card);
  });
  frag.appendChild(feedList);
  container.innerHTML = '';
  container.appendChild(frag);
}

function renderVisitors(container, rows, emptyTitle, emptyMessage) {
  if (!rows || rows.length === 0) {
    renderEmpty(container, emptyTitle, emptyMessage);
    return;
  }
  const frag = document.createDocumentFragment();
  const feedList = document.createElement('div');
  feedList.className = 'vis-feed';

  rows.forEach((row, index) => {
    const trafficLabel = row.traffic_label || '广告流量';
    const trafficReason = row.traffic_reason || '';
    const uaSummary = row.ua_summary || '未解析出可靠的终端信息';
    const uaRisk = row.ua_risk || '';
    const isTest = row.is_test_traffic;
    const hasTtclid = Boolean(row.ttclid);
    const hasFbclid = Boolean(row.fbclid);

    // Determine which platform badge to show
    let platformBadge = '';
    if (hasTtclid && hasFbclid) {
      platformBadge = '<span class="vis-plat-chip vis-plat-tt">TikTok</span><span class="vis-plat-chip vis-plat-fb">Facebook</span>';
    } else if (hasTtclid) {
      platformBadge = '<span class="vis-plat-chip vis-plat-tt">TikTok</span>';
    } else if (hasFbclid) {
      platformBadge = '<span class="vis-plat-chip vis-plat-fb">Facebook</span>';
    } else {
      platformBadge = '<span class="vis-plat-chip vis-plat-none">无广告参数</span>';
    }

    // Traffic badge
    const trafficBadge = isTest
      ? `<span class="vis-traffic-chip vis-traffic-test">${escapeHtml(trafficLabel)}</span>`
      : `<span class="vis-traffic-chip">${escapeHtml(trafficLabel)}</span>`;

    // IP initials for avatar
    const ipParts = (row.ip || '0.0').split('.');
    const ipInitial = ipParts.length >= 2 ? `${ipParts[0]}.${ipParts[1]}` : row.ip || '?';

    // Device icon based on device type
    const deviceType = String(row.ua_device || '').toLowerCase();
    let deviceIcon;
    if (deviceType.includes('mobile') || deviceType.includes('phone') || deviceType.includes('iphone') || deviceType.includes('android')) {
      deviceIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>';
    } else if (deviceType.includes('tablet') || deviceType.includes('ipad')) {
      deviceIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>';
    } else {
      deviceIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
    }

    const card = document.createElement('div');
    card.className = 'vis-card';
    card.style.animationDelay = `${index * 0.04}s`;

    card.innerHTML = `
      <div class="vis-card-hd">
        <div class="vis-hd-ident">
          <span class="vis-hd-tag">访客 IP</span>
          <span class="vis-hd-ip mono">${escapeHtml(row.ip || 'Unknown IP')}</span>
        </div>
        <div class="vis-hd-badges">
          ${platformBadge}
          ${trafficBadge}
        </div>
      </div>

      <div class="vis-card-bd">
        <div class="vis-ts-row">${escapeHtml(formatDate(row.timestamp))}</div>

        <div class="vis-id-grid">
          <div class="vis-meta-row">
            <span class="vis-meta-label">TTCLID</span>
            <span class="vis-meta-value mono ${hasTtclid ? '' : 'vis-empty'}">${hasTtclid ? escapeHtml(maskToken(row.ttclid)) : '未捕获'}</span>
            ${hasTtclid ? `<span class="vis-id-full" title="${escapeHtml(row.ttclid)}">${escapeHtml(row.ttclid)}</span>` : ''}
          </div>
          <div class="vis-meta-row">
            <span class="vis-meta-label">FBCLID</span>
            <span class="vis-meta-value mono ${hasFbclid ? '' : 'vis-empty'}">${hasFbclid ? escapeHtml(maskToken(row.fbclid)) : '未捕获'}</span>
            ${hasFbclid ? `<span class="vis-id-full" title="${escapeHtml(row.fbclid)}">${escapeHtml(row.fbclid)}</span>` : ''}
          </div>
        </div>

        <div class="vis-meta-row">
          <span class="vis-meta-label">商品触点 (Product ID)</span>
          <span class="vis-meta-value mono ${row.product_id ? '' : 'vis-empty'}">${escapeHtml(row.product_id || '未关联')}</span>
        </div>

        <div class="vis-meta-row">
          <span class="vis-meta-label">TTP Cookie</span>
          <span class="vis-meta-value mono ${row.ttp ? '' : 'vis-empty'}">${escapeHtml(row.ttp ? maskToken(row.ttp) : '未捕获')}</span>
        </div>
      </div>

      <details class="vis-card-ua">
        <summary>
          <div class="vis-ua-header">
            <span class="vis-ua-icon">${deviceIcon}</span>
            <span class="vis-ua-summary">${escapeHtml(uaSummary)}</span>
            ${uaRisk ? `<span class="vis-ua-risk">${escapeHtml(uaRisk)}</span>` : ''}
          </div>
          <svg class="vis-ua-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </summary>
        <div class="vis-ua-detail">
          <div class="vis-ua-trio">
            <span class="vis-ua-trio-item">${escapeHtml(row.ua_device || '-')}</span>
            <span class="vis-ua-trio-sep">·</span>
            <span class="vis-ua-trio-item">${escapeHtml(row.ua_os || '-')}</span>
            <span class="vis-ua-trio-sep">·</span>
            <span class="vis-ua-trio-item">${escapeHtml(row.ua_browser || '-')}</span>
          </div>
          ${trafficReason ? `<div class="vis-ua-traffic-reason">${escapeHtml(trafficReason)}</div>` : ''}
          <div class="vis-ua-raw mono">${escapeHtml(row.user_agent || '未捕获 User-Agent')}</div>
        </div>
      </details>
    `;
    feedList.appendChild(card);
  });
  frag.appendChild(feedList);
  container.innerHTML = '';
  container.appendChild(frag);
}

function renderBusinessViews() {
  const stats = state.data.stats || { counts: {}, callbacks_by_status: [] };
  const orders = getFilteredRows(state.data.orders || [], 'orders');
  const callbacks = getFilteredRows(state.data.callbacks || [], 'callbacks');
  const matches = state.data.matches || [];
  const events = getFilteredRows(state.data.events || [], 'events');
  const visitors = state.data.visitors || [];

  renderMetricGrid(stats);
  renderStatusList(elements.orderStatusList, stats.orders_by_status, '今天暂无订单。');
  renderStatusList(
    elements.callbackStatusList,
    stats.callbacks_by_status,
    '今天暂无回传。'
  );
  renderStatusList(
    elements.eventStatusList,
    stats.webhook_events_by_status,
    '今天暂无事件。'
  );
  updateCleanupHint(state.data.system);
  renderCleanupSummary(stats);
  updatePurgeAllUi(state.data.system);
  renderPlatformStatus(state.data.system);

  renderOrders(
    elements.ordersTable,
    orders,
    '暂无订单记录',
    state.showOnlyFailures
      ? '当前没有异常订单，说明订单处理情况比较稳定。'
      : '当前还没有任何订单记录。'
  );

  renderCallbacks(
    elements.callbacksTable,
    callbacks,
    '暂无回调记录',
    state.showOnlyFailures
      ? '当前没有异常回调，说明最近没有失败或跳过的发送记录。'
      : '当前还没有发起过回调请求。'
  );

  renderMatches(
    elements.matchesTable,
    matches,
    '暂无匹配记录',
    '当前还没有任何订单匹配到广告点击。'
  );

  renderEvents(
    elements.eventsTable,
    events,
    '暂无 Webhook 事件',
    state.showOnlyFailures
      ? '当前没有失败事件，说明最近 Shopify 推送处理比较稳定。'
      : '当前尚未收到 Shopify 推送任何事件。'
  );

  renderVisitors(
    elements.visitorsTable,
    visitors,
    '暂无访客记录',
    '当前还没有带有广告参数的访客来访。'
  );

  updateFilterUi();
}

async function refreshDashboard() {
  // Abort any in-flight refresh to prevent race conditions
  if (currentRefreshController) {
    currentRefreshController.abort();
  }
  currentRefreshController = new AbortController();
  const { signal } = currentRefreshController;

  const token = readToken();
  elements.refreshBtn.disabled = true;
  elements.refreshBtn.classList.add('is-refreshing');
  if (elements.scrollCanvas) elements.scrollCanvas.classList.add('is-refreshing-data');
  setAuthStatus('正在加载数据...', 'warning');

  try {
    const health = await requestJson(endpointConfig.health, { signal });
    updateHealth(health);
  } catch (error) {
    if (error.name === 'AbortError') {
      currentRefreshController = null;
      return;
    }
    elements.healthPill.className = 'health-pill pulse-danger';
    elements.healthStatusText.textContent = '无法连接后台';
    setAuthStatus(`后台服务未响应：${error.message}`, 'danger');
    elements.refreshBtn.disabled = false;
    elements.refreshBtn.classList.remove('is-refreshing');
    if (elements.scrollCanvas) elements.scrollCanvas.classList.remove('is-refreshing-data');
    currentRefreshController = null;
    return;
  }

  elements.lastUpdated.textContent = formatDate(new Date().toISOString());

  if (!token) {
    state.data = createEmptyBusinessData();
    clearBusinessViews('请登录以查看业务数据。');
    updateFilterUi();
    setAuthStatus('未登录，请先登录。', 'warning');
    elements.refreshBtn.disabled = false;
    elements.refreshBtn.classList.remove('is-refreshing');
    if (elements.scrollCanvas) elements.scrollCanvas.classList.remove('is-refreshing-data');
    currentRefreshController = null;
    return;
  }

  try {
    const [system, stats, orders, callbacks, matches, events, visitors] =
      await Promise.all([
        requestJson(endpointConfig.system, { token, signal }),
        requestJson(endpointConfig.stats, { token, signal }),
        requestJson(endpointConfig.orders, { token, signal }),
        requestJson(endpointConfig.callbacks, { token, signal }),
        requestJson(endpointConfig.matches, { token, signal }),
        requestJson(endpointConfig.events, { token, signal }),
        requestJson(endpointConfig.visitors, { token, signal }),
      ]);

    state.data = { system, stats, orders, callbacks, matches, events, visitors };
    updateSystemDetail(system);
    renderBusinessViews();
    hideLoginModal();
    setAuthStatus('数据已全部刷新成功。', 'success');
    startAutoRefresh();
  } catch (error) {
    if (error.name === 'AbortError') {
      currentRefreshController = null;
      return;
    }
    state.data = createEmptyBusinessData();
    showLoginModal();
    clearBusinessViews('登录已失效或网络异常，请重新登录。');
    updateFilterUi();
    setAuthStatus(`读取数据报错：${error.message}`, 'danger');
  } finally {
    elements.refreshBtn.disabled = false;
    elements.refreshBtn.classList.remove('is-refreshing');
    if (elements.scrollCanvas) elements.scrollCanvas.classList.remove('is-refreshing-data');
    currentRefreshController = null;
  }
}

async function handleRetryOrder(orderId, button) {
  const token = readToken();
  if (!token) {
    setAuthStatus('请先输入有效令牌，再进行手动重试。', 'warning');
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = '重试中...';
  setAuthStatus(`正在重试订单 ${orderId} ...`, 'warning');

  try {
    const result = await requestJson(
      `/api/orders/${encodeURIComponent(orderId)}/retry-callback`,
      {
        token,
        method: 'POST',
      }
    );

    const callbackStatus = result?.result?.callbackStatus;
    if (callbackStatus === 'success') {
      setAuthStatus(`订单 ${orderId} 已成功重新回传。`, 'success');
    } else {
      setAuthStatus(
        `订单 ${orderId} 已完成重试，但结果仍为：${translateStatus(callbackStatus || 'processed')}。`,
        'warning'
      );
    }

    await refreshDashboard();
  } catch (error) {
    setAuthStatus(`订单 ${orderId} 重试失败：${error.message}`, 'danger');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function handleRevokeMatch(orderId, button) {
  const token = readToken();
  if (!token) {
    setAuthStatus('请先输入有效令牌，再执行撤销操作。', 'warning');
    return;
  }

  if (!confirm(`确定要撤销订单 ${orderId} 的匹配吗？\n\n撤销后该访客将被释放，可以重新参与其他订单的匹配。`)) {
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = '撤销中...';
  setAuthStatus(`正在撤销订单 ${orderId} 的匹配 ...`, 'warning');

  try {
    await requestJson(
      `/api/orders/${encodeURIComponent(orderId)}/revoke-match`,
      {
        token,
        method: 'POST',
        body: { reason: '前端手动撤销' },
      }
    );

    setAuthStatus(`订单 ${orderId} 的匹配已成功撤销，访客已释放。`, 'success');
    await refreshDashboard();
  } catch (error) {
    setAuthStatus(`订单 ${orderId} 撤销失败：${error.message}`, 'danger');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function summarizeCleanupResult(result) {
  const deleted = result?.deleted || {};
  const isPurgeAll = String(result?.mode || '') === 'purge_all';
  const summaryItems = [
    [isPurgeAll ? '访客' : '旧访客', deleted.visitors || 0, '条'],
    [isPurgeAll ? '订单' : '旧订单', deleted.orders || 0, '笔'],
    [isPurgeAll ? '匹配' : '旧匹配', deleted.matches || 0, '条'],
    [isPurgeAll ? '回传' : '旧回传', deleted.callbacks || 0, '条'],
    [isPurgeAll ? 'Webhook 记录' : '旧 Webhook 记录', deleted.webhook_events || 0, '条'],
  ];
  const total = summaryItems.reduce((sum, [, count]) => sum + Number(count || 0), 0);
  const actionLabel = isPurgeAll ? '全部数据已清空：' : '旧数据清理完成：';
  const emptyLabel = isPurgeAll
    ? '数据库已经是空的，无需再次清空。'
    : '没有发现超出保留期的旧数据，本次无需清理。';

  return {
    total,
    tone: 'success',
    text:
      total === 0
        ? emptyLabel
        : `${actionLabel}${summaryItems
            .filter(([, count]) => Number(count || 0) > 0)
            .map(([label, count, unit]) => `${label} ${count} ${unit}`)
            .join('，')}。`,
  };
}

async function handleCleanupOldData(button) {
  const token = readToken();
  if (!token) {
    setAuthStatus('请先输入有效令牌，再执行旧数据清理。', 'warning');
    return;
  }

  let cleanupDays;
  try {
    cleanupDays = readSelectedCleanupDays(state.data.system);
  } catch (error) {
    setAuthStatus(error.message, 'danger');
    return;
  }

  const confirmText =
    `确认清理旧数据吗？\n\n` +
    `本次将保留最近 ${cleanupDays.visitorDays} 天访客数据，以及最近 ${cleanupDays.businessDays} 天订单和日志数据。\n\n` +
    '这一步会永久删除超出保留期的历史数据，不能撤销。';

  openDangerConfirm(confirmText, async () => {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = '清理中...';
    setAuthStatus('正在清理旧数据，请稍候...', 'warning');

    try {
      const payload = await requestJson(endpointConfig.cleanupOldData, {
        token,
        method: 'POST',
        body: {
          confirm: true,
          visitorRetentionDays: cleanupDays.visitorDays,
          businessRetentionDays: cleanupDays.businessDays,
        },
      });
      const summary = summarizeCleanupResult(payload?.result);
      await refreshDashboard();
      closeCleanupModal();
      setAuthStatus(summary.text, summary.tone);
    } catch (error) {
      setAuthStatus(`清理旧数据失败：${error.message}`, 'danger');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }, () => {
    setAuthStatus('已取消旧数据清理。', 'warning');
  });
}

async function handlePurgeAllData(button) {
  const token = readToken();
  if (!token) {
    setAuthStatus('请先输入有效令牌，再执行清空全部数据。', 'warning');
    return;
  }

  const confirmText = getPurgeAllConfirmText(state.data.system);
  const typedText = String(elements.purgeAllConfirmInput?.value || '').trim();
  if (typedText !== confirmText) {
    setAuthStatus(`请输入正确确认文本后再执行：${confirmText}`, 'warning');
    return;
  }

  const confirmMessage =
    '这是高风险操作。\n\n' +
    '执行后会清空全部访客、订单、匹配、回传和 Webhook 记录，且不能恢复。\n\n' +
    '如果你确认要继续，请点击“确认执行”。';

  openDangerConfirm(confirmMessage, async () => {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = '清空中...';
    setAuthStatus('正在清空全部数据，请稍候...', 'warning');

    try {
      const payload = await requestJson(endpointConfig.purgeAllData, {
        token,
        method: 'POST',
        body: { confirm: true, confirmText },
      });
      const summary = summarizeCleanupResult(payload?.result);

      state.cleanupInputsDirty = false;
      if (elements.purgeAllConfirmInput) {
        elements.purgeAllConfirmInput.value = '';
      }

      await refreshDashboard();
      closeCleanupModal();
      setAuthStatus(
        summary.total === 0 ? '数据库已经是空的，无需再次清空。' : summary.text,
        'success'
      );
    } catch (error) {
      setAuthStatus(`清空全部数据失败：${error.message}`, 'danger');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
      updatePurgeAllUi(state.data.system);
    }
  }, () => {
    setAuthStatus('已取消清空全部数据。', 'warning');
  });
}

// ── Danger Confirm Modal ───────────────────────────────────────────────────────────
let _dangerConfirmAbort = null;

function closeDangerConfirm() {
  if (!elements.dangerConfirmModal) return;
  elements.dangerConfirmModal.hidden = true;
  if (_dangerConfirmAbort) {
    _dangerConfirmAbort.abort();
    _dangerConfirmAbort = null;
  }
  releaseFocus();
}

function openDangerConfirm(message, onConfirm, onCancel) {
  if (!elements.dangerConfirmModal) return;

  // 清理上一轮可能残留的监听器
  if (_dangerConfirmAbort) {
    _dangerConfirmAbort.abort();
  }
  _dangerConfirmAbort = new AbortController();
  const { signal } = _dangerConfirmAbort;

  elements.dangerConfirmMessage.textContent = message;
  elements.dangerConfirmModal.hidden = false;
  trapFocus(elements.dangerConfirmModal, null);

  elements.dangerConfirmOkBtn.addEventListener('click', () => {
    closeDangerConfirm();
    onConfirm();
  }, { signal });

  elements.dangerConfirmCancelBtn.addEventListener('click', () => {
    closeDangerConfirm();
    if (onCancel) onCancel();
  }, { signal });

  elements.dangerConfirmBackdrop.addEventListener('click', () => {
    closeDangerConfirm();
    if (onCancel) onCancel();
  }, { signal });
}
// ── End Danger Confirm Modal ───────────────────────────────────────────────────────────

function bindEvents() {
  if (elements.toggleSidebarBtn && elements.sidebar) {
    elements.toggleSidebarBtn.addEventListener('click', () => {
      elements.sidebar.classList.toggle('collapsed');
    });
  }

  elements.loginBtn.addEventListener('click', handleLogin);

  // Allow Enter key to submit login
  if (elements.passwordInput) {
    elements.passwordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLogin();
    });
  }
  if (elements.usernameInput) {
    elements.usernameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') elements.passwordInput?.focus();
    });
  }

  elements.logoutBtn.addEventListener('click', handleLogout);

  elements.refreshBtn.addEventListener('click', refreshDashboard);
  if (elements.openCleanupModalBtn) {
    elements.openCleanupModalBtn.addEventListener('click', openCleanupModal);
  }
  if (elements.closeCleanupModalBtn) {
    elements.closeCleanupModalBtn.addEventListener('click', closeCleanupModal);
  }
  if (elements.cleanupModalBackdrop) {
    elements.cleanupModalBackdrop.addEventListener('click', closeCleanupModal);
  }
  if (elements.cleanupDataBtn) {
    elements.cleanupDataBtn.addEventListener('click', () =>
      handleCleanupOldData(elements.cleanupDataBtn)
    );
  }
  if (elements.visitorCleanupDaysInput) {
    elements.visitorCleanupDaysInput.addEventListener('input', () => {
      state.cleanupInputsDirty = true;
      updateCleanupHint(state.data.system);
    });
    elements.visitorCleanupDaysInput.addEventListener('blur', () => {
      normalizeCleanupInputs(state.data.system);
      updateCleanupHint(state.data.system);
    });
    elements.visitorCleanupDaysInput.addEventListener(
      'wheel',
      (event) => {
        if (document.activeElement === elements.visitorCleanupDaysInput) {
          event.preventDefault();
          elements.visitorCleanupDaysInput.blur();
        }
      },
      { passive: false }
    );
  }
  if (elements.businessCleanupDaysInput) {
    elements.businessCleanupDaysInput.addEventListener('input', () => {
      state.cleanupInputsDirty = true;
      updateCleanupHint(state.data.system);
    });
    elements.businessCleanupDaysInput.addEventListener('blur', () => {
      normalizeCleanupInputs(state.data.system);
      updateCleanupHint(state.data.system);
    });
    elements.businessCleanupDaysInput.addEventListener(
      'wheel',
      (event) => {
        if (document.activeElement === elements.businessCleanupDaysInput) {
          event.preventDefault();
          elements.businessCleanupDaysInput.blur();
        }
      },
      { passive: false }
    );
  }
  if (elements.resetCleanupWindowBtn) {
    elements.resetCleanupWindowBtn.addEventListener('click', () => {
      state.cleanupInputsDirty = false;
      syncCleanupInputs(state.data.system, true);
      updateCleanupHint(state.data.system);
      setAuthStatus('已恢复默认清理天数。', 'success');
    });
  }
  if (elements.purgeAllConfirmInput) {
    elements.purgeAllConfirmInput.addEventListener('input', () => {
      updatePurgeAllUi(state.data.system);
    });
  }
  if (elements.purgeAllDataBtn) {
    elements.purgeAllDataBtn.addEventListener('click', () =>
      handlePurgeAllData(elements.purgeAllDataBtn)
    );
  }

  const cleanupTabs = document.querySelectorAll('.cleanup-tab');
  const cleanupTabContents = document.querySelectorAll('.cleanup-tab-content');
  cleanupTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      cleanupTabs.forEach(t => t.classList.remove('active'));
      cleanupTabContents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.target);
      if (target) target.classList.add('active');
    });
  });

  if (elements.failedFilterBtn) {
    elements.failedFilterBtn.addEventListener('click', () => {
      state.showOnlyFailures = !state.showOnlyFailures;
      renderBusinessViews();
    });
  }

  elements.ordersTable.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="retry-order"]');
    if (!button) {
      return;
    }
    handleRetryOrder(button.dataset.orderId, button);
  });

  elements.matchesTable.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="revoke-match"]');
    if (!button) {
      return;
    }
    handleRevokeMatch(button.dataset.orderId, button);
  });

  // Issue #1 fix: event delegation for copy buttons (replaces global window.copyToClipboard + onclick)
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('.btn-copy-float');
    if (btn) copyToClipboard(btn);
  });

  const navItems = document.querySelectorAll('.nav-item');
  const scrollCanvas = elements.scrollCanvas;

  function handleRoute() {
    let hash = window.location.hash || '#overview';
    let targetId = `view-${hash.slice(1)}`;
    let targetElement = document.getElementById(targetId);

    if (!targetElement) {
      hash = '#overview';
      targetId = 'view-overview';
      targetElement = document.getElementById(targetId);
    }

    navItems.forEach((navItem) => {
      navItem.classList.toggle('active', navItem.getAttribute('href') === hash);
    });

    document.querySelectorAll('.page-view').forEach((view) => {
      view.classList.remove('active');
    });

    if (targetElement) {
      targetElement.classList.add('active');
    }

    if (scrollCanvas) {
      scrollCanvas.scrollTop = 0;
    }
  }

  navItems.forEach((navItem) => {
    navItem.addEventListener('click', (e) => {
      e.preventDefault();
      const targetHash = navItem.getAttribute('href');
      if (targetHash) {
        window.location.hash = targetHash;
        handleRoute();
      }
    });
  });

  window.addEventListener('hashchange', handleRoute);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (elements.dangerConfirmModal && !elements.dangerConfirmModal.hidden) {
        closeDangerConfirm();
        return;
      }
      if (elements.cleanupModal && !elements.cleanupModal.hidden) {
        closeCleanupModal();
      }
    }
  });

  setTimeout(handleRoute, 0);
}

bootstrapAuth();
bindEvents();
window.addEventListener('beforeunload', stopAutoRefresh);
refreshDashboard();

const TOKEN_STORAGE_KEY = 'shopee-cpas-api-token';
const DEFAULT_LIMIT = 20;

const state = {
  showOnlyFailures: false,
  data: {
    system: null,
    stats: null,
    orders: [],
    callbacks: [],
    matches: [],
    events: [],
    visitors: [],
  },
};

const elements = {
  tokenInput: document.getElementById('tokenInput'),
  toggleTokenBtn: document.getElementById('toggleTokenBtn'),
  saveTokenBtn: document.getElementById('saveTokenBtn'),
  clearTokenBtn: document.getElementById('clearTokenBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  authStatus: document.getElementById('authStatus'),
  lastUpdated: document.getElementById('lastUpdated'),
  healthPill: document.getElementById('healthPill'),
  healthStatusText: document.getElementById('healthStatusText'),
  healthEnvironment: document.getElementById('healthEnvironment'),
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
};

const endpointConfig = {
  health: '/health',
  system: '/api/system',
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
  }).format(date);
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
  elements.authStatus.className = `status-indicator ${tone}`;
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
    unmatched: '未匹配',
    processed: '处理完毕',
    processing_failed: '处理失败',
    pending: '处理中',
    received: '已收到',
    duplicate_ignored: '重复跳过',
    ignored_pending: '状态不符跳过',
    no_visitors_in_window: '时间窗口内没有访客',
    visitors_missing_click_id: '访客没有广告点击参数',
    ambiguous_match_candidates: '候选记录过于接近，系统不敢自动判定',
    product_not_matched: '有访客，但商品对不上',
    time_gap_too_large: '访客和下单时间差过大',
    score_below_threshold: '匹配分太低，系统判定不可靠',
    no_valid_match_candidate: '没有足够可靠的匹配对象',
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
    normalized.includes('error')
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
    product_match_candidates: '商品能对上的候选数',
    ip_match_candidates: 'IP 或地区能对上的候选数',
    best_score: '最高匹配分',
    score_gap: '第一名领先分差',
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
  };

  return dictionary[key] || key;
}

function translateSignalToken(value) {
  const dictionary = {
    time_close: '下单时间很接近',
    time_window_ok: '在合理时间窗口内',
    time_far: '时间偏远',
    product_match: '商品信息一致',
    product_mismatch: '商品信息不一致',
    browser_ip_exact: '浏览器 IP 一致',
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

  elements.metricGrid.innerHTML = cards
    .map(
      ([key, label, value]) => `
        <div class="metric-card glass-panel" title="${escapeHtml(describeMetric(key))}">
          <span class="metric-label">${escapeHtml(label)}</span>
          <div class="metric-value mono">${escapeHtml(value)}</div>
          <small class="metric-desc">${escapeHtml(describeMetric(key))}</small>
        </div>
      `
    )
    .join('');
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

  container.innerHTML = `
    <div class="status-list">
      ${rows
        .map((row) => {
          const translated = translateStatus(row.status);
          return `
            <div class="status-item">
              <div class="status-item-left">
                <strong>${escapeHtml(translated)}</strong>
                <span>共 ${escapeHtml(row.count)} 条记录</span>
              </div>
              <span class="status-count">${escapeHtml(row.count)}</span>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
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

  elements.platformStatusList.innerHTML = `
    <div class="status-list">
      ${platforms
        .map((item) => `
          <div class="status-item">
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
          </div>
        `)
        .join('')}
    </div>
  `;
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
  if (text.length <= 90) {
    return `<div class="wrap mono">${escapeHtml(text)}</div>`;
  }

  return `
    <details class="text-detail">
      <summary>点击查看完整内容</summary>
      <p>${escapeHtml(text)}</p>
    </details>
  `;
}

function renderReasonDetail(value, emptyLabel = '暂无说明') {
  const parts = parseReasonDetail(value);
  if (parts.length === 0) {
    return renderTextDetail(value, emptyLabel);
  }

  return `
    <div class="reason-list">
      ${parts
        .map(
          (item) => `
            <div class="reason-item">
              <span class="reason-key">${escapeHtml(describeReasonKey(item.key))}</span>
              <span class="reason-value">${escapeHtml(
                translateReasonValue(item.key, item.value)
              )}</span>
            </div>
          `
        )
        .join('')}
    </div>
  `;
}

function renderTable(container, columns, rows, emptyTitle, emptyMessage) {
  if (!rows || rows.length === 0) {
    renderEmpty(container, emptyTitle, emptyMessage);
    return;
  }

  const thead = columns
    .map(
      (column) => `
        <th>
          <span class="head-main">${escapeHtml(column.label)}</span>
          <span class="head-help">${escapeHtml(column.help)}</span>
        </th>
      `
    )
    .join('');

  const tbody = rows
    .map((row) => {
      const cells = columns.map((column) => `<td>${column.render(row)}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  container.innerHTML = `
    <table>
      <thead><tr>${thead}</tr></thead>
      <tbody>${tbody}</tbody>
    </table>
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
}

async function requestJson(url, options = {}) {
  const { token = '', method = 'GET', body } = options;
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

function bootstrapToken() {
  const token = readToken();
  elements.tokenInput.value = token;

  if (token) {
    setAuthStatus('已读取保存的认证令牌。', 'success');
    return;
  }

  setAuthStatus('请先输入令牌验证身份。', 'warning');
}

function clearBusinessViews(message) {
  const fallbackMessage = message || '暂未获得访问权限。';

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
  renderPlatformStatus(state.data.system);

  renderTable(
    elements.ordersTable,
    [
      {
        label: '订单号',
        help: 'Shopify 订单编号',
        render: (row) => `<span class="mono">${escapeHtml(row.order_id)}</span>`,
      },
      {
        label: '处理状态',
        help: '该订单当前的状态',
        render: (row) => badge(row.status),
      },
      {
        label: '排查编号',
        help: '需要找开发排查时，可把这个编号发给他',
        render: (row) => renderTextDetail(row.trace_id, '暂无编号'),
      },
      {
        label: '失败原因',
        help: '如果处理不顺利，这里会写原因',
        render: (row) => renderReasonDetail(row.status_reason, '暂无错误原因'),
      },
      {
        label: '订单金额',
        help: '订单金额和币种',
        render: (row) =>
          `<span class="mono">${escapeHtml(row.total_price)} ${escapeHtml(row.currency)}</span>`,
      },
      {
        label: '支付状态',
        help: '订单是否已付款',
        render: (row) =>
          `<span class="muted">${escapeHtml(translateStatus(row.financial_status) || row.financial_status || '-')}</span>`,
      },
      {
        label: '接收时间',
        help: '后台收到订单的时间',
        render: (row) => escapeHtml(formatDate(row.created_at)),
      },
      {
        label: '操作',
        help: '必要时可手动重试匹配和回传',
        render: (row) =>
          canRetryOrder(row)
            ? `
              <div class="table-action-cell">
                <button
                  class="btn btn-ghost btn-inline"
                  type="button"
                  data-action="retry-order"
                  data-order-id="${escapeHtml(row.order_id)}"
                >
                  手动重试
                </button>
              </div>
            `
            : `<span class="muted">无需处理</span>`,
      },
    ],
    orders,
    '暂无订单记录',
    state.showOnlyFailures
      ? '当前没有异常订单，说明订单处理情况比较稳定。'
      : '当前还没有任何订单记录。'
  );

  renderTable(
    elements.callbacksTable,
    [
      {
        label: '订单号',
        help: '关联的订单号',
        render: (row) => `<span class="mono">${escapeHtml(row.order_id)}</span>`,
      },
      {
        label: '广告平台',
        help: '发送给哪个平台',
        render: (row) => badge(row.platform, row.platform || '-'),
      },
      {
        label: '触发来源',
        help: '是 webhook 自动触发还是人工重试',
        render: (row) =>
          badge(
            row.trigger_source,
            row.trigger_source === 'manual_retry' ? '手动重试' : '自动处理'
          ),
      },
      {
        label: '排查编号',
        help: '同一次处理链路的统一编号',
        render: (row) => renderTextDetail(row.trace_id, '暂无编号'),
      },
      {
        label: '发送结果',
        help: '成功、失败还是已跳过',
        render: (row) => badge(row.status),
      },
      {
        label: '尝试次数',
        help: '这是第几次发送',
        render: (row) => `<span class="mono">${escapeHtml(row.attempt_number || '-')}</span>`,
      },
      {
        label: '平台返回值',
        help: '接口返回的主要内容',
        render: (row) => renderTextDetail(row.response_summary, '无返回值'),
      },
      {
        label: '报错详情',
        help: '发送失败的具体原因',
        render: (row) => renderTextDetail(row.error_message, '无报错'),
      },
      {
        label: '发送时间',
        help: '回传请求发送的时间',
        render: (row) => escapeHtml(formatDate(row.callback_time)),
      },
    ],
    callbacks,
    '暂无回调记录',
    state.showOnlyFailures
      ? '当前没有异常回调，说明最近没有失败或跳过的发送记录。'
      : '当前还没有发起过回调请求。'
  );

  renderTable(
    elements.matchesTable,
    [
      {
        label: '订单号',
        help: '被匹配的订单',
        render: (row) => `<span class="mono">${escapeHtml(row.order_id)}</span>`,
      },
      {
        label: '广告平台',
        help: '匹配到的广告平台',
        render: (row) => badge(row.platform, row.platform || '-'),
      },
      {
        label: '点击标识',
        help: '访客的点击 ID',
        render: (row) => `<div class="mono wrap">${escapeHtml(row.click_id)}</div>`,
      },
      {
        label: '匹配可信度',
        help: '匹配是否可靠',
        render: (row) => badge(row.confidence, translateStatus(row.confidence)),
      },
      {
        label: '匹配分',
        help: '分数越高，说明越像同一位访客',
        render: (row) => `<span class="mono">${escapeHtml(row.match_score ?? '-')}</span>`,
      },
      {
        label: '命中信号',
        help: '系统是根据哪些证据判断匹配的',
        render: (row) =>
          renderTextDetail(
            translateReasonValue('signals', row.match_signals),
            '暂无命中信号'
          ),
      },
      {
        label: '时间间隔',
        help: '点击到下单过了多少秒',
        render: (row) => `<span class="mono">${escapeHtml(row.time_diff_seconds)}s</span>`,
      },
      {
        label: '匹配时间',
        help: '匹配成功的时间',
        render: (row) => escapeHtml(formatDate(row.match_time)),
      },
    ],
    matches,
    '暂无匹配记录',
    '当前还没有任何订单匹配到广告点击。'
  );

  renderTable(
    elements.eventsTable,
    [
      {
        label: '事件编号',
        help: 'Shopify 事件 ID',
        render: (row) => `<div class="mono wrap">${escapeHtml(row.webhook_id)}</div>`,
      },
      {
        label: '事件类型',
        help: '收到什么类型的事件',
        render: (row) => `<span class="mono">${escapeHtml(row.topic)}</span>`,
      },
      {
        label: '相关订单号',
        help: '此事件对应的订单',
        render: (row) => `<span class="mono">${escapeHtml(row.shopify_order_id)}</span>`,
      },
      {
        label: '排查编号',
        help: '可用来串联 webhook、订单和回调日志',
        render: (row) => renderTextDetail(row.trace_id, '暂无编号'),
      },
      {
        label: '处理状态',
        help: '系统是否处理成功',
        render: (row) => badge(row.status),
      },
      {
        label: '报错提示',
        help: '如果未处理成功，这里会写原因',
        render: (row) => renderTextDetail(row.error_message, '无报错'),
      },
      {
        label: '接收时间',
        help: '收到该请求的时间',
        render: (row) => escapeHtml(formatDate(row.received_at)),
      },
    ],
    events,
    '暂无 Webhook 事件',
    state.showOnlyFailures
      ? '当前没有失败事件，说明最近 Shopify 推送处理比较稳定。'
      : '当前尚未收到 Shopify 推送任何事件。'
  );

  renderTable(
    elements.visitorsTable,
    [
      {
        label: '访问时间',
        help: '访客到达的时间',
        render: (row) => escapeHtml(formatDate(row.timestamp)),
      },
      {
        label: 'TT 点击标识',
        help: 'TikTok 广告参数',
        render: (row) => `<div class="mono wrap">${escapeHtml(row.ttclid || '-')}</div>`,
      },
      {
        label: 'FB 点击标识',
        help: 'Facebook 广告参数',
        render: (row) => `<div class="mono wrap">${escapeHtml(row.fbclid || '-')}</div>`,
      },
      {
        label: '访客 IP',
        help: '访问来源 IP 地址',
        render: (row) => `<span class="mono">${escapeHtml(row.ip || '-')}</span>`,
      },
      {
        label: '访问商品',
        help: '访客浏览的是哪个商品',
        render: (row) => `<div class="wrap">${escapeHtml(row.product_id || '-')}</div>`,
      },
      {
        label: '浏览器信息',
        help: '使用的设备或浏览器',
        render: (row) => renderTextDetail(row.user_agent, '无设备信息'),
      },
    ],
    visitors,
    '暂无访客记录',
    '当前还没有带有广告参数的访客来访。'
  );

  updateFilterUi();
}

async function refreshDashboard() {
  const token = elements.tokenInput.value.trim();
  elements.refreshBtn.disabled = true;
  setAuthStatus('正在加载数据...', 'warning');

  try {
    const health = await requestJson(endpointConfig.health);
    updateHealth(health);
  } catch (error) {
    elements.healthPill.className = 'health-pill pulse-danger';
    elements.healthStatusText.textContent = '无法连接后台';
    setAuthStatus(`后台服务未响应：${error.message}`, 'danger');
    elements.refreshBtn.disabled = false;
    return;
  }

  elements.lastUpdated.textContent = formatDate(new Date().toISOString());

  if (!token) {
    state.data = {
      system: null,
      stats: null,
      orders: [],
      callbacks: [],
      matches: [],
      events: [],
      visitors: [],
    };
    clearBusinessViews('请输入 API_AUTH_TOKEN 以读取业务数据。');
    updateFilterUi();
    setAuthStatus('未输入令牌，业务数据已隐藏。', 'warning');
    elements.refreshBtn.disabled = false;
    return;
  }

  try {
    const [system, stats, orders, callbacks, matches, events, visitors] =
      await Promise.all([
        requestJson(endpointConfig.system, { token }),
        requestJson(endpointConfig.stats, { token }),
        requestJson(endpointConfig.orders, { token }),
        requestJson(endpointConfig.callbacks, { token }),
        requestJson(endpointConfig.matches, { token }),
        requestJson(endpointConfig.events, { token }),
        requestJson(endpointConfig.visitors, { token }),
      ]);

    state.data = {
      system,
      stats,
      orders,
      callbacks,
      matches,
      events,
      visitors,
    };

    updateSystemDetail(system);
    renderBusinessViews();
    setAuthStatus('数据已全部刷新成功。', 'success');
  } catch (error) {
    clearBusinessViews('由于令牌错误或网络问题，读取数据失败。');
    updateFilterUi();
    setAuthStatus(`读取数据报错：${error.message}`, 'danger');
  } finally {
    elements.refreshBtn.disabled = false;
  }
}

async function handleRetryOrder(orderId, button) {
  const token = elements.tokenInput.value.trim();
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

function bindEvents() {
  elements.saveTokenBtn.addEventListener('click', () => {
    const token = elements.tokenInput.value.trim();
    writeToken(token);

    if (token) {
      setAuthStatus('已成功保存验证令牌。', 'success');
      return;
    }

    setAuthStatus('令牌为空，已取消验证。', 'warning');
  });

  elements.clearTokenBtn.addEventListener('click', () => {
    elements.tokenInput.value = '';
    writeToken('');
    setAuthStatus('已清除验证令牌。', 'danger');
  });

  elements.toggleTokenBtn.addEventListener('click', () => {
    const isPassword = elements.tokenInput.type === 'password';
    elements.tokenInput.type = isPassword ? 'text' : 'password';
    elements.toggleTokenBtn.textContent = isPassword ? '❌' : '👁️';
  });

  elements.refreshBtn.addEventListener('click', refreshDashboard);

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

  const navItems = document.querySelectorAll('.nav-item');
  const scrollCanvas = elements.scrollCanvas;
  if (navItems.length > 0 && scrollCanvas) {
    navItems.forEach((item) => {
      item.addEventListener('click', (event) => {
        event.preventDefault();
        navItems.forEach((navItem) => navItem.classList.remove('active'));
        item.classList.add('active');

        const targetId = item.getAttribute('href').slice(1);
        const targetElement = document.getElementById(targetId);
        if (!targetElement) {
          return;
        }

        scrollCanvas.scrollTo({
          top: targetElement.offsetTop - scrollCanvas.offsetTop - 20,
          behavior: 'smooth',
        });
      });
    });

    const sections = Array.from(document.querySelectorAll('.section-title[id]'));
    if (sections.length > 0) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) {
              return;
            }

            navItems.forEach((navItem) => {
              navItem.classList.toggle(
                'active',
                navItem.getAttribute('href') === `#${entry.target.id}`
              );
            });
          });
        },
        {
          root: scrollCanvas,
          threshold: 0.5,
        }
      );

      sections.forEach((section) => observer.observe(section));
    }
  }
}

bootstrapToken();
bindEvents();
refreshDashboard();

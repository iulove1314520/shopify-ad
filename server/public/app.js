const TOKEN_STORAGE_KEY = 'shopee-cpas-api-token';
const DEFAULT_LIMIT = 20;

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
  ordersTable: document.getElementById('ordersTable'),
  callbacksTable: document.getElementById('callbacksTable'),
  matchesTable: document.getElementById('matchesTable'),
  eventsTable: document.getElementById('eventsTable'),
  visitorsTable: document.getElementById('visitorsTable'),
};

const endpointConfig = {
  stats: `/api/stats`,
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
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short', timeStyle: 'medium',
  }).format(date);
}

function readToken() { return window.localStorage.getItem(TOKEN_STORAGE_KEY) || ''; }
function writeToken(token) {
  if (!token) window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  else window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

function setAuthStatus(text, tone = 'warning') {
  elements.authStatus.innerHTML = `<span class="status-dot ${tone}"></span> ${escapeHtml(text)}`;
  elements.authStatus.className = `status-indicator ${tone}`;
}

function translateEnvironment(value) {
  const norm = String(value || '').toLowerCase();
  if (norm === 'production') return '正式环境';
  if (norm === 'development') return '测试环境';
  if (norm === 'staging') return '预发环境';
  return value || '-';
}

function translateStatus(value) {
  const norm = String(value || '').toLowerCase();
  const dict = {
    success: '成功', failed: '失败', callback_failed: '回传失败',
    callback_sent: '回传成功', skipped: '已跳过', matched_no_callback: '已匹配，不可回传',
    unmatched: '未匹配', processed: '处理完毕', pending: '处理中',
    received: '已收到', duplicate_ignored: '重复跳过', ignored_pending: '状态不符跳过',
    ok: '正常', tiktok: 'TikTok', facebook: 'Facebook',
    high: '高精核对', medium: '常态匹配', low: '低信度匹配',
    '高': '高', '中': '中', '低': '低'
  };
  return dict[norm] || value || '-';
}

function getStatusTone(status = '') {
  const norm = String(status).toLowerCase();
  if (norm.includes('success') || norm.includes('callback_sent') || norm === 'processed' || norm === 'ok') return 'success';
  if (norm.includes('fail') || norm.includes('invalid') || norm === 'unmatched' || norm.includes('error')) return 'danger';
  if (norm.includes('skip') || norm.includes('pending') || norm.includes('ignored') || norm.includes('matched_no_callback')) return 'warning';
  if (norm.includes('tiktok') || norm.includes('facebook') || norm.includes('high')) return 'info';
  return 'muted';
}

function badge(value, label = translateStatus(value)) {
  return `<span class="badge badge-${getStatusTone(value)}">${escapeHtml(label)}</span>`;
}

function describeMetric(key) {
  const descs = {
    visitors: '成功记录下来的广告点击访问人数。',
    orders: '系统收到并记录下来的订单数量。',
    matches: '成功找到对应广告点击的订单数。',
    callbacks: '尝试向 TikTok 或 Facebook 发送回传的次数。',
    successful_callbacks: '平台实际接收成功的回传数。'
  };
  return descs[key] || '';
}

function renderMetricGrid(stats) {
  const successCount = (stats?.callbacks_by_status || []).reduce((sum, item) => {
    const s = String(item.status || '').toLowerCase();
    if (s === 'success' || s === 'callback_sent') return sum + Number(item.count || 0);
    return sum;
  }, 0);

  const formatter = new Intl.NumberFormat();
  const cards = [
    ['visitors', '广告访问人数', formatter.format(stats?.counts?.visitors ?? 0)],
    ['orders', '累计订单数量', formatter.format(stats?.counts?.orders ?? 0)],
    ['matches', '成功匹配总数', formatter.format(stats?.counts?.matches ?? 0)],
    ['callbacks', '触发回传次数', formatter.format(stats?.counts?.callbacks ?? 0)],
    ['successful_callbacks', '实际回传成功', formatter.format(successCount)],
  ];

  elements.metricGrid.innerHTML = cards.map(([key, label, value]) => `
    <div class="metric-card glass-panel" title="${escapeHtml(describeMetric(key))}">
      <span class="metric-label">${escapeHtml(label)}</span>
      <div class="metric-value mono">${escapeHtml(value)}</div>
      <small class="metric-desc">${escapeHtml(describeMetric(key))}</small>
    </div>
  `).join('');
}

function renderStatusList(container, rows, emptyLabel) {
  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="empty-state"><strong>暂无数据</strong>${escapeHtml(emptyLabel)}</div>`;
    return;
  }
  container.innerHTML = `<div class="status-list">` + rows.map(row => {
    const translated = translateStatus(row.status);
    return `
      <div class="status-item">
        <div class="status-item-left">
          <strong>${escapeHtml(translated)}</strong>
          <span>共 ${row.count} 条记录</span>
        </div>
        <span class="status-count">${escapeHtml(row.count)}</span>
      </div>
    `;
  }).join('') + `</div>`;
}

function renderEmpty(container, title, message) {
  container.innerHTML = `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}</div>`;
}

function renderTextDetail(value, emptyLabel = '-') {
  if (!value) return `<span class="muted">${escapeHtml(emptyLabel)}</span>`;
  const text = String(value);
  if (text.length <= 90) return `<div class="wrap mono">${escapeHtml(text)}</div>`;
  return `
    <details class="text-detail">
      <summary>点击查看完整内容</summary>
      <p>${escapeHtml(text)}</p>
    </details>
  `;
}

function renderTable(container, columns, rows, emptyTitle, emptyMessage) {
  if (!rows || rows.length === 0) {
    renderEmpty(container, emptyTitle, emptyMessage);
    return;
  }
  const thead = columns.map(c => `<th><span class="head-main">${escapeHtml(c.label)}</span><span class="head-help">${escapeHtml(c.help)}</span></th>`).join('');
  const tbody = rows.map(r => `<tr>${columns.map(c => `<td>${c.render(r)}</td>`).join('')}</tr>`).join('');
  container.innerHTML = `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

function updateHealth(health) {
  const isHealthy = Boolean(health?.ok);
  elements.healthPill.className = `health-pill pulse-${isHealthy ? 'success' : 'danger'}`;
  elements.healthStatusText.textContent = isHealthy ? '后台运行正常' : '后台运行异常';
  elements.healthEnvironment.textContent = translateEnvironment(health?.environment);
  if(elements.healthDatabase) elements.healthDatabase.textContent = health?.database?.reachable ? '√' : 'X';
  if(elements.healthJournal) elements.healthJournal.textContent = health?.database?.journal_mode || '-';
}

async function fetchJson(url, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

function bootstrapToken() {
  const t = readToken();
  elements.tokenInput.value = t;
  if (t) setAuthStatus('已读取保存的认证令牌', 'success');
  else setAuthStatus('请先输入令牌验证身份', 'warning');
}

function clearBusinessViews(message) {
  const msg = message || '暂未获得访问权限。';
  renderMetricGrid({ counts: {}, callbacks_by_status: [] });
  renderEmpty(elements.orderStatusList, '暂无统计数据', msg);
  renderEmpty(elements.callbackStatusList, '暂无统计数据', msg);
  renderEmpty(elements.eventStatusList, '暂无统计数据', msg);
  renderEmpty(elements.ordersTable, '当前暂无订单记录', msg);
  renderEmpty(elements.callbacksTable, '当前暂无回传记录', msg);
  renderEmpty(elements.matchesTable, '当前暂无匹配记录', msg);
  renderEmpty(elements.eventsTable, '当前暂无事件记录', msg);
  renderEmpty(elements.visitorsTable, '当前暂无访客记录', msg);
}

async function refreshDashboard() {
  const token = elements.tokenInput.value.trim();
  elements.refreshBtn.disabled = true;
  setAuthStatus('正在加载数据...', 'warning');

  try {
    const health = await fetchJson('/health');
    updateHealth(health);
  } catch (err) {
    elements.healthPill.className = 'health-pill pulse-danger';
    elements.healthStatusText.textContent = '无法连接后台';
    setAuthStatus(`后台服务未响应：${err.message}`, 'danger');
    elements.refreshBtn.disabled = false;
    return;
  }

  elements.lastUpdated.textContent = formatDate(new Date().toISOString());

  if (!token) {
    clearBusinessViews('请输入 API_AUTH_TOKEN 以读取业务数据。');
    setAuthStatus('未输入令牌，部分数据已隐藏。', 'warning');
    elements.refreshBtn.disabled = false;
    return;
  }

  try {
    const [stats, orders, cbs, matches, events, visitors] = await Promise.all([
      fetchJson(endpointConfig.stats, token), fetchJson(endpointConfig.orders, token),
      fetchJson(endpointConfig.callbacks, token), fetchJson(endpointConfig.matches, token),
      fetchJson(endpointConfig.events, token), fetchJson(endpointConfig.visitors, token),
    ]);

    renderMetricGrid(stats);
    renderStatusList(elements.orderStatusList, stats.orders_by_status, '今天暂无订单');
    renderStatusList(elements.callbackStatusList, stats.callbacks_by_status, '今天暂无回传');
    renderStatusList(elements.eventStatusList, stats.webhook_events_by_status, '今天暂无事件');

    renderTable(elements.ordersTable, [
      { label: '订单号', help: 'Shopify 订单编号', render: r => `<span class="mono">${escapeHtml(r.order_id)}</span>` },
      { label: '处理状态', help: '该订单当前的状态', render: r => badge(r.status) },
      { label: '失败原因', help: '如果失败，这里会写原因', render: r => renderTextDetail(r.status_reason, '暂无错误原因') },
      { label: '订单金额', help: '金额及币种', render: r => `<span class="mono">${escapeHtml(r.total_price)} ${escapeHtml(r.currency)}</span>` },
      { label: '支付状态', help: '订单是否已付款', render: r => `<span class="muted">${escapeHtml(translateStatus(r.financial_status) || r.financial_status || '-')}</span>` },
      { label: '接收时间', help: '后台收到订单的时间', render: r => escapeHtml(formatDate(r.created_at)) },
    ], orders, '暂无订单记录', '当前还没有任何订单记录。');

    renderTable(elements.callbacksTable, [
      { label: '订单号', help: '关联的订单号', render: r => `<span class="mono">${escapeHtml(r.order_id)}</span>` },
      { label: '广告平台', help: '发送给哪个平台', render: r => badge(r.platform, r.platform || '-') },
      { label: '发送结果', help: '成功还是失败', render: r => badge(r.status) },
      { label: '平台返回值', help: '接口返回的具体内容', render: r => renderTextDetail(r.response_summary, '无返回值') },
      { label: '报错详情', help: '发送失败的具体原因', render: r => renderTextDetail(r.error_message, '无报错') },
      { label: '发送时间', help: '回传请求发送的时间', render: r => escapeHtml(formatDate(r.callback_time)) },
    ], cbs, '暂无回调记录', '当前还没有发起过回调请求。');

    renderTable(elements.matchesTable, [
      { label: '订单号', help: '被匹配的订单', render: r => `<span class="mono">${escapeHtml(r.order_id)}</span>` },
      { label: '广告平台', help: '匹配到的广告平台', render: r => badge(r.platform, r.platform || '-') },
      { label: '点击标识', help: '访客的点击 ID', render: r => `<div class="mono wrap">${escapeHtml(r.click_id)}</div>` },
      { label: '匹配可信度', help: '匹配是否可靠', render: r => badge(r.confidence, `${translateStatus(r.confidence)}`) },
      { label: '时间间隔', help: '点击到下单过了多少秒', render: r => `<span class="mono">${escapeHtml(r.time_diff_seconds)}s</span>` },
      { label: '匹配时间', help: '匹配成功的时间', render: r => escapeHtml(formatDate(r.match_time)) },
    ], matches, '暂无匹配记录', '当前还没有任何订单匹配到广告点击。');

    renderTable(elements.eventsTable, [
      { label: '事件编号', help: 'Shopify 事件 ID', render: r => `<div class="mono wrap">${escapeHtml(r.webhook_id)}</div>` },
      { label: '事件类型', help: '收到什么类型的事件', render: r => `<span class="mono">${escapeHtml(r.topic)}</span>` },
      { label: '相关订单号', help: '此事件对应的订单', render: r => `<span class="mono">${escapeHtml(r.shopify_order_id)}</span>` },
      { label: '处理状态', help: '系统是否处理成功', render: r => badge(r.status) },
      { label: '报错提示', help: '如果未处理或报错的原因', render: r => renderTextDetail(r.error_message, '无报错') },
      { label: '接收时间', help: '收到该请求的时间', render: r => escapeHtml(formatDate(r.received_at)) },
    ], events, '暂无 Webhook 事件', '当前尚未收到 Shopify 推送任何事件。');

    renderTable(elements.visitorsTable, [
      { label: '访问时间', help: '访客到达的时间', render: r => escapeHtml(formatDate(r.timestamp)) },
      { label: 'TT 点击标识', help: 'TikTok 广告参数', render: r => `<div class="mono wrap">${escapeHtml(r.ttclid || '-')}</div>` },
      { label: 'FB 点击标识', help: 'FaceBook 广告参数', render: r => `<div class="mono wrap">${escapeHtml(r.fbclid || '-')}</div>` },
      { label: '访客 IP', help: '访问来源 IP 地址', render: r => `<span class="mono">${escapeHtml(r.ip || '-')}</span>` },
      { label: '访问商品', help: '正在看哪个商品', render: r => `<div class="wrap">${escapeHtml(r.product_id || '-')}</div>` },
      { label: '浏览器信息', help: '使用的设备或浏览器', render: r => renderTextDetail(r.user_agent, '无设备信息') },
    ], visitors, '暂无访客记录', '当前还没有带有广告参数的访客来访。');

    setAuthStatus('数据已全部刷新成功。', 'success');
  } catch (err) {
    clearBusinessViews('由于令牌错误或网络问题，读取数据失败。');
    setAuthStatus(`读取数据报错：${err.message}`, 'danger');
  } finally {
    elements.refreshBtn.disabled = false;
  }
}

function bindEvents() {
  elements.saveTokenBtn.addEventListener('click', () => {
    const t = elements.tokenInput.value.trim();
    writeToken(t);
    if (t) setAuthStatus('已成功保存验证令牌', 'success');
    else setAuthStatus('令牌为空，已取消验证', 'warning');
  });

  elements.clearTokenBtn.addEventListener('click', () => {
    elements.tokenInput.value = '';
    writeToken('');
    setAuthStatus('已清除验证令牌。', 'danger');
  });

  elements.toggleTokenBtn.addEventListener('click', () => {
    const isPswd = elements.tokenInput.type === 'password';
    elements.tokenInput.type = isPswd ? 'text' : 'password';
    elements.toggleTokenBtn.textContent = isPswd ? '❌' : '👁️';
  });

  elements.refreshBtn.addEventListener('click', refreshDashboard);

  // Sidebar navigation highlight logic
  const navItems = document.querySelectorAll('.nav-item');
  const scrollCanvas = document.querySelector('.scroll-canvas');
  if(navItems.length && scrollCanvas) {
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault(); // Prevent native anchor hash scroll that shifts the whole UI
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        
        const targetId = item.getAttribute('href').substring(1);
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
          scrollCanvas.scrollTo({
            top: targetElement.offsetTop - scrollCanvas.offsetTop - 20, // Add a little top offset
            behavior: 'smooth'
          });
        }
      });
    });

    // Intersection Observer for scroll spy
    const sections = Array.from(document.querySelectorAll('.section-title[id]'));
    if(sections.length) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if(entry.isIntersecting) {
            navItems.forEach(n => {
              n.classList.remove('active');
              if(n.getAttribute('href') === '#' + entry.target.id) n.classList.add('active');
            });
          }
        });
      }, { root: scrollCanvas, threshold: 0.5 });
      sections.forEach(s => observer.observe(s));
    }
  }
}

bootstrapToken();
bindEvents();
refreshDashboard();

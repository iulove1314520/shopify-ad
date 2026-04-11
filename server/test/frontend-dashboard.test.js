const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const APP_PATH = path.join(__dirname, '..', 'public', 'app.js');

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.tokens = new Set();
  }

  add(...tokens) {
    tokens.filter(Boolean).forEach((token) => this.tokens.add(token));
    this.#sync();
  }

  remove(...tokens) {
    tokens.filter(Boolean).forEach((token) => this.tokens.delete(token));
    this.#sync();
  }

  toggle(token, force) {
    if (force === true) {
      this.tokens.add(token);
    } else if (force === false) {
      this.tokens.delete(token);
    } else if (this.tokens.has(token)) {
      this.tokens.delete(token);
    } else {
      this.tokens.add(token);
    }

    this.#sync();
    return this.tokens.has(token);
  }

  contains(token) {
    return this.tokens.has(token);
  }

  setFromString(value) {
    this.tokens = new Set(String(value || '').split(/\s+/).filter(Boolean));
    this.#sync();
  }

  #sync() {
    this.element._className = Array.from(this.tokens).join(' ');
  }
}

class FakeElement {
  constructor(tagName = 'div', ownerDocument = null) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.type = 'text';
    this.textContent = '';
    this.innerHTML = '';
    this.title = '';
    this.id = '';
    this._className = '';
    this.classList = new FakeClassList(this);
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this.classList.setFromString(value);
  }

  addEventListener(type, handler) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }

    this.listeners[type].push(handler);
  }

  dispatchEvent(event) {
    const handlers = this.listeners[event.type] || [];
    handlers.forEach((handler) => handler(event));
  }

  click() {
    this.dispatchEvent({
      type: 'click',
      target: this,
      currentTarget: this,
      preventDefault() {},
      stopPropagation() {},
    });
  }

  focus() {}

  blur() {}

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'class') {
      this.className = value;
      return;
    }

    if (name === 'id') {
      this.id = String(value);
    }
  }

  getAttribute(name) {
    if (name === 'class') {
      return this.className;
    }

    if (name === 'id') {
      return this.id;
    }

    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null;
  }

  closest() {
    return null;
  }
}

class FakeDocument {
  constructor() {
    this.elementsById = new Map();
    this.selectorMap = new Map();
  }

  registerId(id, element) {
    element.id = id;
    this.elementsById.set(id, element);
    return element;
  }

  registerSelector(selector, value) {
    this.selectorMap.set(selector, value);
    return value;
  }

  getElementById(id) {
    return this.elementsById.get(id) || null;
  }

  querySelector(selector) {
    const value = this.selectorMap.get(selector);
    if (Array.isArray(value)) {
      return value[0] || null;
    }

    return value || null;
  }

  querySelectorAll(selector) {
    const value = this.selectorMap.get(selector);
    if (!value) {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  createDocumentFragment() {
    return new FakeElement('fragment', this);
  }

  addEventListener() {}
}

function createElement(document, options = {}) {
  const element = new FakeElement(options.tagName || 'div', document);
  if (options.className) {
    element.className = options.className;
  }
  if (options.type) {
    element.type = options.type;
  }
  if (options.value) {
    element.value = options.value;
  }
  return element;
}

function loadDashboardApp(options = {}) {
  const {
    storedToken = '',
    intl = Intl,
    fetchImpl = async () => {
      throw new Error('Unexpected fetch in frontend unit test');
    },
  } = options;
  const document = new FakeDocument();

  const ids = {
    tokenInput: createElement(document, { tagName: 'input', type: 'password' }),
    usernameInput: createElement(document, { tagName: 'input', type: 'text' }),
    passwordInput: createElement(document, { tagName: 'input', type: 'password' }),
    toggleSidebarBtn: createElement(document, { tagName: 'button' }),
    loginBtn: createElement(document, { tagName: 'button' }),
    logoutBtn: createElement(document, { tagName: 'button' }),
    refreshBtn: createElement(document, { tagName: 'button' }),
    openCleanupModalBtn: createElement(document, { tagName: 'button' }),
    cleanupModal: createElement(document, { tagName: 'div' }),
    cleanupModalBackdrop: createElement(document, { tagName: 'div' }),
    closeCleanupModalBtn: createElement(document, { tagName: 'button' }),
    cleanupDataBtn: createElement(document, { tagName: 'button' }),
    visitorCleanupDaysInput: createElement(document, { tagName: 'input', type: 'number' }),
    businessCleanupDaysInput: createElement(document, { tagName: 'input', type: 'number' }),
    resetCleanupWindowBtn: createElement(document, { tagName: 'button' }),
    cleanupSummary: createElement(document, { tagName: 'div' }),
    purgeAllConfirmHint: createElement(document, { tagName: 'p' }),
    purgeAllConfirmInput: createElement(document, { tagName: 'input', type: 'text' }),
    purgeAllDataBtn: createElement(document, { tagName: 'button' }),
    authStatus: createElement(document, { tagName: 'div' }),
    lastUpdated: createElement(document, { tagName: 'span' }),
    healthPill: createElement(document, { tagName: 'div' }),
    healthStatusText: createElement(document, { tagName: 'span' }),
    healthEnvironment: createElement(document, { tagName: 'span' }),
    cleanupHint: createElement(document, { tagName: 'p' }),
    healthDatabase: createElement(document, { tagName: 'span' }),
    healthJournal: createElement(document, { tagName: 'span' }),
    metricGrid: createElement(document, { tagName: 'section' }),
    orderStatusList: createElement(document, { tagName: 'div' }),
    callbackStatusList: createElement(document, { tagName: 'div' }),
    eventStatusList: createElement(document, { tagName: 'div' }),
    platformStatusList: createElement(document, { tagName: 'div' }),
    ordersTable: createElement(document, { tagName: 'div' }),
    callbacksTable: createElement(document, { tagName: 'div' }),
    matchesTable: createElement(document, { tagName: 'div' }),
    eventsTable: createElement(document, { tagName: 'div' }),
    visitorsTable: createElement(document, { tagName: 'div' }),
    failedFilterBtn: createElement(document, { tagName: 'button' }),
    filterStatusText: createElement(document, { tagName: 'span' }),
    loginModal: createElement(document, { tagName: 'div' }),
  };

  Object.entries(ids).forEach(([id, element]) => {
    document.registerId(id, element);
  });

  const sidebar = createElement(document, { tagName: 'aside', className: 'sidebar' });
  const scrollCanvas = createElement(document, { tagName: 'div', className: 'scroll-canvas' });

  document.registerSelector('.sidebar', sidebar);
  document.registerSelector('.scroll-canvas', scrollCanvas);
  document.registerSelector('.cleanup-tab', []);

  // Provide document.body for showLoginModal/hideLoginModal body class toggling
  document.body = createElement(document, { tagName: 'body' });
  document.registerSelector('.cleanup-tab-content', []);
  document.registerSelector('.nav-item', []);
  document.registerSelector('.page-view', []);

  const storage = new Map();
  if (storedToken) {
    storage.set('shopee-cpas-api-token', storedToken);
  }

  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };

  const context = vm.createContext({
    console,
    document,
    Intl: intl,
    Date,
    fetch: fetchImpl,
    AbortController: class AbortController {
      constructor() {
        this.signal = { aborted: false };
      }

      abort() {
        this.signal.aborted = true;
      }
    },
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    navigator: {
      clipboard: {
        async writeText() {},
      },
    },
    window: {
      localStorage,
      location: { hash: '' },
      addEventListener() {},
      confirm() {
        return true;
      },
    },
    confirm() {
      return true;
    },
  });

  const source = fs
    .readFileSync(APP_PATH, 'utf8')
    .replace(
      /\nbootstrapAuth\(\);\nbindEvents\(\);\nwindow\.addEventListener\('beforeunload', stopAutoRefresh\);\nrefreshDashboard\(\);\s*$/,
      '\n'
    )
    .concat(
      '\n' +
      'globalThis.__app = {' +
        ' state,' +
        ' elements,' +
        ' formatDate,' +
        ' readToken,' +
        ' writeToken,' +
        ' getFilteredRows,' +
        ' renderVisitors,' +
        ' requestJson,' +
        ' handleRevokeMatch,' +
        ' handleLogout,' +
        ' showLoginModal,' +
        ' hideLoginModal,' +
        ' bindEvents,' +
        ' bootstrapAuth,' +
        ' refreshDashboard' +
        '};\n'
    );

  vm.runInContext(source, context, { filename: 'app.js' });

  return {
    app: context.__app,
    document,
    localStorage,
  };
}

function createEmptyDashboardData() {
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

test('退出登录时会立即清空已加载的业务数据', () => {
  const { app } = loadDashboardApp({ storedToken: 'demo-token' });
  app.bootstrapAuth();
  app.bindEvents();

  app.state.showOnlyFailures = true;
  app.state.data = {
    system: { environment: 'production' },
    stats: { counts: { orders: 1 } },
    orders: [{ order_id: 'SO-1' }],
    callbacks: [{ order_id: 'SO-1', status: 'failed' }],
    matches: [{ order_id: 'SO-1' }],
    events: [{ webhook_id: 'WH-1' }],
    visitors: [{ ip: '203.0.113.10' }],
  };
  app.handleLogout();

  assert.equal(app.readToken(), '');
  assert.equal(app.elements.loginModal.hidden, false);
  assert.equal(
    JSON.stringify(app.state.data),
    JSON.stringify(createEmptyDashboardData())
  );
  assert.equal(app.state.showOnlyFailures, false);
});

test('只看异常明细时会同时过滤回调和事件记录', () => {
  const { app } = loadDashboardApp();
  app.state.showOnlyFailures = true;

  const callbacks = app.getFilteredRows(
    [
      { status: 'success' },
      { status: 'failed' },
      { status: 'skipped' },
    ],
    'callbacks'
  );
  const events = app.getFilteredRows(
    [
      { status: 'processed' },
      { status: 'failed' },
      { status: 'received' },
    ],
    'events'
  );

  assert.deepEqual(callbacks.map((item) => item.status), ['failed', 'skipped']);
  assert.deepEqual(events.map((item) => item.status), ['failed']);
});

test('formatDate 会显式固定为北京时间格式化', () => {
  let capturedOptions = null;
  const intlSpy = {
    DateTimeFormat: function DateTimeFormat(locale, options) {
      capturedOptions = { locale, ...options };
      return {
        format() {
          return 'formatted';
        },
      };
    },
  };

  const { app } = loadDashboardApp({ intl: intlSpy });

  assert.equal(app.formatDate('2026-04-04T00:30:00.000Z'), 'formatted');
  assert.equal(capturedOptions.locale, 'zh-CN');
  assert.equal(capturedOptions.timeZone, 'Asia/Shanghai');
});

test('鉴权失败时会清空旧业务数据，避免页面再次渲染旧结果', async () => {
  function createJsonResponse(status, payload) {
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return JSON.stringify(payload);
      },
    };
  }

  const { app } = loadDashboardApp({
    storedToken: 'demo-token',
    fetchImpl: async (url) => {
      if (url === '/health') {
        return createJsonResponse(200, {
          ok: true,
          environment: 'production',
        });
      }

      return createJsonResponse(401, {
        error: 'Unauthorized',
      });
    },
  });

  app.state.data = {
    system: { environment: 'production' },
    stats: { counts: { orders: 2 } },
    orders: [{ order_id: 'SO-1001', status: 'callback_failed' }],
    callbacks: [{ order_id: 'SO-1001', status: 'failed' }],
    matches: [{ order_id: 'SO-1001' }],
    events: [{ webhook_id: 'WH-1001', status: 'failed' }],
    visitors: [{ ip: '203.0.113.10' }],
  };

  await app.refreshDashboard();

  assert.equal(
    JSON.stringify(app.state.data),
    JSON.stringify(createEmptyDashboardData())
  );
  assert.equal(app.elements.loginModal.hidden, false);
});

test('撤销匹配时请求体只会被序列化一次', async () => {
  const fetchCalls = [];

  function createJsonResponse(status, payload) {
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return JSON.stringify(payload);
      },
    };
  }

  const { app, document } = loadDashboardApp({
    storedToken: 'demo-token',
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({ url, options });

      if (url === '/health') {
        return createJsonResponse(200, {
          ok: true,
          environment: 'production',
        });
      }

      if (url === '/api/system') {
        return createJsonResponse(200, {
          database: { reachable: true, journal_mode: 'wal' },
          cleanup_limits: { min_days: 1, max_days: 3650 },
          retention_policy: { visitors_days: 7, business_days: 30 },
          dangerous_actions: { purge_all_confirm_text: '清空全部数据' },
        });
      }

      if (url === '/api/stats') {
        return createJsonResponse(200, {
          counts: {
            visitors: 0,
            orders: 0,
            matches: 0,
            callbacks: 0,
            webhook_events: 0,
          },
          callbacks_by_status: [],
        });
      }

      if (String(url).includes('/api/orders/SO-REV-1/revoke-match')) {
        return createJsonResponse(200, { ok: true });
      }

      return createJsonResponse(200, []);
    },
  });

  const button = createElement(document, { tagName: 'button' });
  button.textContent = '撤销匹配';

  await app.handleRevokeMatch('SO-REV-1', button);

  const revokeCall = fetchCalls.find((call) =>
    String(call.url).includes('/api/orders/SO-REV-1/revoke-match')
  );

  assert.ok(revokeCall, 'should send revoke request');
  assert.equal(
    revokeCall.options.body,
    JSON.stringify({ reason: '前端手动撤销' })
  );
});

test('访客卡片会显示测试流量标记和终端解析摘要，而不是只堆原始 UA', () => {
  const { app, document } = loadDashboardApp();
  const container = document.getElementById('visitorsTable');

  app.renderVisitors(
    container,
    [
      {
        ip: '198.51.100.24',
        timestamp: '2026-04-02T07:27:50.414Z',
        ttclid: '__CLICKID__',
        fbclid: '',
        product_id: '/products/demo-shelf',
        user_agent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 bytedancewebview Safari/604.1',
        is_test_traffic: true,
        traffic_label: '测试流量',
        traffic_reason: '__CLICKID__ 占位符',
        ua_summary: 'iPhone · iOS · TikTok 内置浏览器',
        ua_device: 'iPhone',
        ua_os: 'iOS',
        ua_browser: 'TikTok 内置浏览器',
        ttp: 'ttp_cookie_demo_003',
      },
    ],
    '暂无访客记录',
    '当前没有访客点击。'
  );

  const html = container.children[0].children[0].children[0].innerHTML;
  assert.match(html, /测试流量/);
  assert.match(html, /iPhone · iOS · TikTok 内置浏览器/);
  assert.match(html, /__CLICKID__ 占位符/);
  assert.match(html, /TTP Cookie/);
  assert.match(html, /ttp_co\.\.\._003/);
});

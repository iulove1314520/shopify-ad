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
  } = options;
  const document = new FakeDocument();

  const ids = {
    tokenInput: createElement(document, { tagName: 'input', type: 'password' }),
    toggleTokenBtn: createElement(document, { tagName: 'button' }),
    toggleSidebarBtn: createElement(document, { tagName: 'button' }),
    saveTokenBtn: createElement(document, { tagName: 'button' }),
    clearTokenBtn: createElement(document, { tagName: 'button' }),
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
  };

  Object.entries(ids).forEach(([id, element]) => {
    document.registerId(id, element);
  });

  const sidebar = createElement(document, { tagName: 'aside', className: 'sidebar' });
  const scrollCanvas = createElement(document, { tagName: 'div', className: 'scroll-canvas' });
  const authModule = createElement(document, { tagName: 'details', className: 'auth-module' });

  document.registerSelector('.sidebar', sidebar);
  document.registerSelector('.scroll-canvas', scrollCanvas);
  document.registerSelector('.auth-module', authModule);
  document.registerSelector('.auth-icon-only', null);
  document.registerSelector('.cleanup-tab', []);
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
    fetch: async () => {
      throw new Error('Unexpected fetch in frontend unit test');
    },
    setTimeout: () => 0,
    clearTimeout() {},
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
  });

  const source = fs
    .readFileSync(APP_PATH, 'utf8')
    .replace(/\nbootstrapToken\(\);\nbindEvents\(\);\nrefreshDashboard\(\);\s*$/, '\n')
    .concat(
      '\n' +
        'globalThis.__app = {' +
        ' state,' +
        ' elements,' +
        ' formatDate,' +
        ' readToken,' +
        ' writeToken,' +
        ' getFilteredRows,' +
        ' bindEvents,' +
        ' bootstrapToken' +
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

test('清除令牌时会立即清空已加载的业务数据', () => {
  const { app } = loadDashboardApp({ storedToken: 'demo-token' });
  app.bootstrapToken();
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
  app.elements.tokenInput.value = 'demo-token';
  app.elements.authModule.classList.add('is-authorized');

  app.elements.clearTokenBtn.click();

  assert.equal(app.elements.tokenInput.value, '');
  assert.equal(app.readToken(), '');
  assert.equal(
    JSON.stringify(app.state.data),
    JSON.stringify(createEmptyDashboardData())
  );
  assert.equal(app.state.showOnlyFailures, false);
  assert.equal(app.elements.authModule.classList.contains('is-authorized'), false);
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

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const TRACKER_PATH = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'integrations',
  'shopify',
  'manual-theme',
  'assets',
  'cpas-visitor-tracker.js'
);

class FakeNode {
  constructor() {
    this.children = [];
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, beforeChild) {
    child.parentNode = this;
    const index = this.children.indexOf(beforeChild);
    if (index === -1) {
      this.children.push(child);
    } else {
      this.children.splice(index, 0, child);
    }

    return child;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.parentNode = null;
    this.parentElement = null;
    this.attributes = {};
    this.children = [];
    this.elements = [];
    this.value = '';
    this.name = '';
    this.type = '';
    this.href = '';
    this.action = '';
    this.textContent = '';
  }

  appendChild(child) {
    child.parentNode = this;
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    this[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null;
  }
}

class FakeDocument {
  constructor(config) {
    this.readyState = 'complete';
    this.cookie = '';
    this.listeners = {};
    this.head = new FakeNode();
    this.body = new FakeNode();
    this.documentElement = new FakeNode();
    this.configNode = { textContent: JSON.stringify(config) };
    this.scriptAnchorParent = new FakeNode();
    this.scriptAnchor = new FakeElement('script');
    this.scriptAnchorParent.appendChild(this.scriptAnchor);
  }

  getElementById(id) {
    if (id === 'cpas-visitor-tracker-config') {
      return this.configNode;
    }

    return null;
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

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  getElementsByTagName(tagName) {
    if (String(tagName).toLowerCase() === 'script') {
      return [this.scriptAnchor];
    }

    return [];
  }
}

function createLocalStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function createFetchSpy() {
  const calls = [];
  async function fetchImpl(url, options = {}) {
    calls.push({
      url,
      method: options.method || 'GET',
      body: options.body ? JSON.parse(options.body) : null,
    });

    return {
      ok: true,
      async json() {
        return { success: true };
      },
    };
  }

  return {
    calls,
    fetchImpl,
  };
}

function createTimerController() {
  const queue = [];
  return {
    setTimeout(handler) {
      queue.push(handler);
      return queue.length;
    },
    clearTimeout() {},
    async flushAll() {
      while (queue.length > 0) {
        const handler = queue.shift();
        handler();
        await Promise.resolve();
      }
    },
  };
}

function createForm(action, fields) {
  const form = new FakeElement('form');
  form.action = action;
  form.elements = Object.entries(fields || {}).map(([name, value]) => {
    const input = new FakeElement('input');
    input.name = name;
    input.value = String(value);
    input.parentElement = form;
    input.parentNode = form;
    return input;
  });
  return form;
}

function createLink(href) {
  const link = new FakeElement('a');
  link.href = href;
  return link;
}

async function loadThemeTracker(configOverrides = {}) {
  const config = {
    apiBaseUrl: '',
    storageDays: 7,
    debug: false,
    trackProductOnly: false,
    pageType: 'home',
    path: '/',
    tiktokPixelCode: '',
    product: null,
    ...configOverrides,
  };
  const document = new FakeDocument(config);
  const fetchSpy = createFetchSpy();
  const timers = createTimerController();
  const window = {
    localStorage: createLocalStorage(),
    location: {
      pathname: config.path,
      search: config.search || '',
    },
  };

  const context = vm.createContext({
    console: {
      log() {},
    },
    window,
    document,
    fetch: fetchSpy.fetchImpl,
    URLSearchParams,
    Date,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Promise,
    decodeURIComponent,
    encodeURIComponent,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  const source = fs.readFileSync(TRACKER_PATH, 'utf8');
  vm.runInContext(source, context, { filename: 'cpas-visitor-tracker.js' });

  await Promise.resolve();

  return {
    document,
    fetchCalls: fetchSpy.calls,
    flushTimers: timers.flushAll,
    window,
  };
}

function getQueuedCommands(window, methodName, eventName) {
  const queue = Array.isArray(window.ttq && window.ttq._queue) ? window.ttq._queue : [];
  return queue.filter((item) => {
    if (item[0] !== methodName) {
      return false;
    }

    if (!eventName) {
      return true;
    }

    return item[1] === eventName;
  });
}

test('未配置 TikTok 像素码时不会初始化浏览器像素', async () => {
  const { document, window } = await loadThemeTracker({
    pageType: 'product',
    path: '/products/demo-shelf',
    product: {
      id: 'product_demo_001',
      variantId: 'variant_demo_001',
      title: 'Demo shelf',
      price: 29.9,
      currency: 'USD',
    },
  });

  assert.equal(window.ttq, undefined);
  assert.equal(document.head.children.length, 0);
});

test('配置 TikTok 像素码后会初始化 page 与 ViewContent', async () => {
  const { document, window } = await loadThemeTracker({
    pageType: 'product',
    path: '/products/demo-shelf',
    tiktokPixelCode: 'PIXEL_DEMO_001',
    product: {
      id: 'product_demo_001',
      variantId: 'variant_demo_001',
      title: 'Demo shelf',
      price: 29.9,
      currency: 'USD',
    },
  });

  assert.ok(window.ttq);
  assert.equal(document.head.children.length, 1);
  assert.match(document.head.children[0].src, /PIXEL_DEMO_001/);

  const pageCommands = getQueuedCommands(window, 'page');
  const viewContentCommands = getQueuedCommands(window, 'track', 'ViewContent');

  assert.equal(pageCommands.length, 1);
  assert.equal(viewContentCommands.length, 1);
  assert.equal(viewContentCommands[0][2].content_id, 'variant_demo_001');
  assert.equal(viewContentCommands[0][2].currency, 'USD');
});

test('商品页加入购物车表单提交时会发送 AddToCart', async () => {
  const { document, window } = await loadThemeTracker({
    pageType: 'product',
    path: '/products/demo-shelf',
    tiktokPixelCode: 'PIXEL_DEMO_002',
    product: {
      id: 'product_demo_002',
      variantId: 'variant_demo_002',
      title: 'Demo shelf',
      price: 35.5,
      currency: 'USD',
    },
  });

  const form = createForm('/cart/add', {
    id: 'variant_form_002',
    quantity: '2',
  });

  document.dispatchEvent({
    type: 'submit',
    target: form,
    preventDefault() {},
    stopPropagation() {},
  });

  const addToCartCommands = getQueuedCommands(window, 'track', 'AddToCart');
  assert.equal(addToCartCommands.length, 1);
  assert.equal(addToCartCommands[0][2].content_id, 'variant_form_002');
  assert.equal(addToCartCommands[0][2].quantity, 2);
});

test('点击结账入口时只发送一次 InitiateCheckout', async () => {
  const { document, window } = await loadThemeTracker({
    pageType: 'cart',
    path: '/cart',
    tiktokPixelCode: 'PIXEL_DEMO_003',
  });

  const checkoutLink = createLink('/checkout');

  document.dispatchEvent({
    type: 'click',
    target: checkoutLink,
    preventDefault() {},
    stopPropagation() {},
  });
  document.dispatchEvent({
    type: 'click',
    target: checkoutLink,
    preventDefault() {},
    stopPropagation() {},
  });

  const initiateCheckoutCommands = getQueuedCommands(window, 'track', 'InitiateCheckout');
  assert.equal(initiateCheckoutCommands.length, 1);
});

test('访客上报会等待 _ttp 出现后再发送，并把 ttp 带进 payload', async () => {
  const { document, fetchCalls, flushTimers } = await loadThemeTracker({
    apiBaseUrl: 'https://sp.yyl66666.com',
    pageType: 'product',
    path: '/products/demo-shelf',
    search: '?ttclid=ttclid_demo_003',
    tiktokPixelCode: 'PIXEL_DEMO_004',
    product: {
      id: 'product_demo_004',
      variantId: 'variant_demo_004',
      title: 'Demo shelf',
      price: 29.9,
      currency: 'USD',
    },
  });

  assert.equal(fetchCalls.length, 0);

  document.cookie = '_ttp=ttp_cookie_demo_004';
  await flushTimers();

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://sp.yyl66666.com/api/visitor');
  assert.equal(fetchCalls[0].body.ttclid, 'ttclid_demo_003');
  assert.equal(fetchCalls[0].body.ttp, 'ttp_cookie_demo_004');
});

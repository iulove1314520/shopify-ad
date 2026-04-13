# TikTok Purchase Single-Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the self-hosted backend callback the only intended TikTok `Purchase` source, while surfacing that mode clearly in local diagnostics and operator docs.

**Architecture:** Add an explicit `TIKTOK_PURCHASE_MODE` environment switch, keep the existing order-to-visitor match engine unchanged, and gate only the TikTok purchase callback sender. Surface the active mode through the system summary, dashboard platform status, and callback summaries so operators can verify the single-source policy locally while separately disabling Shopify/TikTok native `Purchase` in admin.

**Tech Stack:** Node.js, Express, better-sqlite3, vanilla JS dashboard, Node test runner

---

### Task 1: Add purchase-mode coverage to tests first

**Files:**
- Modify: `server/test/tiktok-request.test.js`
- Modify: `server/test/frontend-dashboard.test.js`
- Create: `server/test/system-config.test.js`

- [ ] **Step 1: Write failing tests for TikTok purchase mode behavior**

```js
test('sendToTikTok disabled mode returns skipped result with source metadata', async () => {
  const context = createTestContext({
    TIKTOK_PIXEL_ID: 'CKN3ABRC77U4JN785N60',
    TIKTOK_ACCESS_TOKEN: 'demo-token',
    TIKTOK_PURCHASE_MODE: 'disabled',
  });

  try {
    const { sendToTikTok } = context.requireServer('services/tiktok');
    const result = await sendToTikTok(
      {
        shopify_order_id: 'order_disabled_001',
        created_at: '2026-04-02T07:27:50.414Z',
        total_price: 100,
        currency: 'USD',
        raw_payload: JSON.stringify({}),
      },
      'click_demo_001'
    );

    assert.equal(result.status, 'skipped');
    assert.match(result.requestSummary, /"purchaseMode":"disabled"/);
    assert.match(result.requestSummary, /"purchaseSource":"self_hosted_backend"/);
  } finally {
    context.cleanup();
  }
});
```

- [ ] **Step 2: Write failing tests for env/system visibility**

```js
test('system detail exposes tiktok purchase mode', () => {
  const context = createTestContext({
    TIKTOK_PURCHASE_MODE: 'self_hosted_only',
  });

  try {
    const { buildSystemDetail } = context.requireServer('modules/system');
    const detail = buildSystemDetail();
    assert.equal(detail.tiktok_purchase_mode, 'self_hosted_only');
  } finally {
    context.cleanup();
  }
});
```

- [ ] **Step 3: Write failing dashboard visibility test**

```js
test('platform status shows TikTok purchase mode when present', async () => {
  const { app } = loadDashboardApp({
    storedToken: 'demo-token',
    fetchImpl: async (url) => {
      if (url === '/health') return okJson({ ok: true, environment: 'production' });
      if (url === '/api/system') {
        return okJson({
          ok: true,
          environment: 'production',
          platforms: [{ label: 'TikTok', configured: true, issues: [] }],
          tiktok_purchase_mode: 'self_hosted_only',
        });
      }
      return okJson([]);
    },
  });

  await app.refreshDashboard();
  assert.match(app.elements.platformStatusList.innerHTML, /self_hosted_only/);
});
```

- [ ] **Step 4: Run the focused tests to verify they fail for the expected reason**

Run:

```bash
node --test server/test/tiktok-request.test.js server/test/frontend-dashboard.test.js server/test/system-config.test.js
```

Expected: FAIL because purchase-mode behavior and system-mode surfacing do not exist yet.

### Task 2: Implement backend purchase mode

**Files:**
- Modify: `server/src/config/env.js`
- Modify: `server/src/services/tiktok.js`
- Modify: `server/src/modules/system.js`

- [ ] **Step 1: Add env parsing and validation**

```js
function normalizeTikTokPurchaseMode(value) {
  const normalized = String(value || 'self_hosted_only').trim().toLowerCase();
  return ['self_hosted_only', 'disabled'].includes(normalized)
    ? normalized
    : 'invalid';
}
```

- [ ] **Step 2: Gate TikTok purchase callback sending**

```js
if (env.tiktokPurchaseMode === 'disabled') {
  return createSkippedResult(
    'TikTok',
    'TikTok purchase callbacks are disabled by configuration',
    requestSummary,
    'purchase_mode_disabled'
  );
}
```

- [ ] **Step 3: Add local purchase-mode observability**

```js
const requestSummary = summarize({
  orderId: order.shopify_order_id,
  purchaseMode: env.tiktokPurchaseMode,
  purchaseSource: 'self_hosted_backend',
  // existing summary fields...
});
```

- [ ] **Step 4: Expose mode in system detail**

```js
return {
  // existing fields...
  tiktok_purchase_mode: env.tiktokPurchaseMode,
};
```

- [ ] **Step 5: Run focused tests to verify backend behavior passes**

Run:

```bash
node --test server/test/tiktok-request.test.js server/test/system-config.test.js
```

Expected: PASS

### Task 3: Surface mode in dashboard and docs

**Files:**
- Modify: `server/public/app.js`
- Modify: `README.md`
- Create: `docx/tiktok-purchase-single-source-runbook.md`

- [ ] **Step 1: Show purchase mode in platform status rendering**

```js
const purchaseModeText =
  item.id === 'tiktok' && system?.tiktok_purchase_mode
    ? `Purchase 模式：${system.tiktok_purchase_mode}`
    : '';
```

- [ ] **Step 2: Document the env var and operator action**

```md
| `TIKTOK_PURCHASE_MODE` | TikTok Purchase 回传模式，支持 `self_hosted_only` 和 `disabled` |
```

- [ ] **Step 3: Write operator runbook**

```md
# TikTok Purchase 单一来源操作手册

1. 保留 TikTok 页面浏览与像素基础链路。
2. 关闭 Shopify/TikTok 原生 `Purchase` 事件共享。
3. 保持本系统 `TIKTOK_PURCHASE_MODE=self_hosted_only`。
4. 用本地 callbacks 列表核对后端 Purchase 是否正常发送。
```

- [ ] **Step 4: Run dashboard/doc-related tests**

Run:

```bash
node --test server/test/frontend-dashboard.test.js
```

Expected: PASS

### Task 4: Run full verification

**Files:**
- Modify: `记录.md`

- [ ] **Step 1: Run the relevant backend/frontend test suite**

Run:

```bash
node --test server/test/tiktok-request.test.js server/test/frontend-dashboard.test.js server/test/system-config.test.js server/test/visitor.test.js server/test/logger.test.js
```

Expected: PASS

- [ ] **Step 2: Run the full test suite**

Run:

```bash
node --test server/test/*.test.js
```

Expected: PASS

- [ ] **Step 3: Rebuild the API container for runtime verification**

Run:

```bash
docker compose up -d --build api
```

Expected: API rebuilds successfully and container returns healthy status.

- [ ] **Step 4: Verify runtime health**

Run:

```bash
curl -fsS http://127.0.0.1:38417/health
```

Expected: JSON response with `"ok":true`

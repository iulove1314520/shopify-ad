# TikTok Browser Pixel Takeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Horizon 手动主题注入草稿里接管 TikTok 浏览器侧 `PageView`、`ViewContent`、`AddToCart`、`InitiateCheckout`，同时保持 `Purchase` 只走后端回传。

**Architecture:** 继续复用现有 `cpas-visitor-tracker.js` 作为唯一前端注入脚本，在其中增加 TikTok 像素初始化、事件构造、DOM 监听和去重逻辑。Liquid snippet 只负责提供像素码与最小商品上下文，README 负责指导部署和后续断开 Shopify 原生网站转化。

**Tech Stack:** Shopify Liquid、原生浏览器 JavaScript、Node.js `node:test`

---

### Task 1: 补前端脚本测试基建并先写失败用例

**Files:**
- Create: `server/test/theme-tracker.test.js`
- Modify: `docx/shopify-horizon-manual-theme/assets/cpas-visitor-tracker.js`

- [ ] **Step 1: 写失败测试，覆盖像素初始化和关键事件**

```js
test('配置 TikTok 像素码后会初始化 page 与 ViewContent', () => {
  // 加载脚本，断言 ttq.load / ttq.page / ttq.track 被调用
});

test('商品页加入购物车表单提交时会发送 AddToCart', () => {
  // 构造 /cart/add 表单并触发 submit
});

test('点击结账入口时只发送一次 InitiateCheckout', () => {
  // 同一按钮多次点击也只应记录一次
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /root/data/tk/server && node --test test/theme-tracker.test.js`

Expected: FAIL，提示缺少 TikTok 初始化或事件行为。

- [ ] **Step 3: 在测试文件中搭建最小 fake DOM / fake ttq 环境**

```js
const document = {
  readyState: 'complete',
  getElementById() {},
  addEventListener() {},
  createElement() {},
};
```

- [ ] **Step 4: 再次运行测试，确认失败原因已对准目标行为**

Run: `cd /root/data/tk/server && node --test test/theme-tracker.test.js`

Expected: FAIL，且失败点集中在 TikTok 行为断言本身。

### Task 2: 实现 TikTok 浏览器侧接管逻辑

**Files:**
- Modify: `docx/shopify-horizon-manual-theme/assets/cpas-visitor-tracker.js`
- Modify: `docx/shopify-horizon-manual-theme/snippets/cpas-visitor-tracker.liquid`

- [ ] **Step 1: 在 Liquid snippet 中补 TikTok 最小配置**

```liquid
"tiktokPixelCode": {{ cpas_tiktok_pixel_code | json }},
"shopDomain": {{ shop.permanent_domain | json }},
"product": {
  "id": {{ product.id | default: blank | json }},
  "variantId": {{ product.selected_or_first_available_variant.id | default: blank | json }},
  "title": {{ product.title | default: blank | json }},
  "price": {{ product.selected_or_first_available_variant.price | divided_by: 100.0 | json }},
  "currency": {{ cart.currency.iso_code | default: shop.currency | json }}
}
```

- [ ] **Step 2: 在脚本里实现 TikTok 基础代码注入与幂等保护**

```js
function ensureTikTokPixel(pixelCode, debug) {
  if (!pixelCode) return null;
  if (window.ttq && typeof window.ttq.track === 'function') return window.ttq;
  // 注入官方基础代码并调用 ttq.load(pixelCode)
}
```

- [ ] **Step 3: 实现标准版事件发送函数**

```js
function trackTikTokPageView(ttq, debug) {}
function trackTikTokViewContent(ttq, config, debug) {}
function trackTikTokAddToCart(ttq, config, debug) {}
function trackTikTokInitiateCheckout(ttq, config, debug) {}
```

- [ ] **Step 4: 绑定 `/cart/add` 表单和结账入口监听**

```js
document.addEventListener('submit', handleSubmit, true);
document.addEventListener('click', handleClick, true);
```

- [ ] **Step 5: 运行聚焦测试确认通过**

Run: `cd /root/data/tk/server && node --test test/theme-tracker.test.js`

Expected: PASS

### Task 3: 更新部署说明并做回归验证

**Files:**
- Modify: `docx/shopify-horizon-manual-theme/README.md`
- Modify: `记录.md`

- [ ] **Step 1: 在 README 中说明新增 TikTok 像素配置项与验证步骤**

```md
- 填入 `cpas_tiktok_pixel_code`
- 验证 `_ttp`
- 验证 Pixel Helper 中出现 `page_viewed / view_content / add_to_cart / initiate_checkout`
- 说明浏览器侧不会发送 `Purchase`
```

- [ ] **Step 2: 运行完整测试集**

Run: `cd /root/data/tk/server && node --test test/*.test.js`

Expected: PASS，全部测试通过。

- [ ] **Step 3: 做最小本地自建验证**

Run: `cd /root/data/tk && docker compose up -d --build api`

Then run:

`curl -s http://127.0.0.1:38417/health`

Expected: 返回 `{"ok":true,...}`

- [ ] **Step 4: 写入变更记录**

```md
## 2026-04-13 HH:MM（北京时间 UTC+8）

- 任务：TikTok 浏览器像素接管标准版
- 改了什么：
  -
- 修复了什么：
  -
- 更新了什么：
  -
```

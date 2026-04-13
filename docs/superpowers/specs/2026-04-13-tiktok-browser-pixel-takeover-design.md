# TikTok Browser Pixel Takeover Design

## Goal

在不依赖 Shopify TikTok 销售渠道自动上报购买事件的前提下，由主题脚本手动接管 TikTok 浏览器侧事件，保留浏览器信号和 `_ttp` 链路，同时继续让 `Purchase` 只走当前后端 Events API 回传。

## Scope

本次只覆盖当前 Horizon 手动主题注入草稿：

- `docx/shopify-horizon-manual-theme/assets/cpas-visitor-tracker.js`
- `docx/shopify-horizon-manual-theme/snippets/cpas-visitor-tracker.liquid`
- `docx/shopify-horizon-manual-theme/README.md`

`app embed` 草稿本轮不改，避免把验证范围扩得过大。

## Chosen Approach

在现有 `cpas-visitor-tracker.js` 内增加一个轻量的 TikTok 浏览器事件层，而不是再引入第二个独立脚本。

原因：

- 当前主题里已经稳定注入了这一个脚本，复用它可以减少主题复制步骤。
- 访客上报与 TikTok 像素都依赖同一份页面上下文，合并后更容易共享配置与日志。
- 这一层只负责浏览器事件，不负责 `Purchase`，职责边界仍然清晰。

## Browser Events

手动接管以下事件：

- `PageView`
- `ViewContent`
- `AddToCart`
- `InitiateCheckout`

明确不接管：

- `Purchase`

`Purchase` 仍由现有后端 TikTok 回传链路负责，保持 `TIKTOK_PURCHASE_MODE=self_hosted_only`。

## Data Strategy

通过 Liquid 向脚本提供 TikTok 像素运行所需的最小字段：

- `tiktokPixelCode`
- `shopDomain`
- `pageType`
- `path`
- 当前商品页可用的商品信息：
  - `productId`
  - `variantId`
  - `productTitle`
  - `currency`
  - `price`

浏览器事件参数遵循“少而稳定”的原则：

- `PageView`：只做页面初始化
- `ViewContent`：商品页发送，带 `content_id`、`content_type`、`content_name`、`value`、`currency`
- `AddToCart`：监听 `/cart/add` 表单提交，优先使用当前商品上下文
- `InitiateCheckout`：在检测到结账入口点击时发送，并对同页做去重

## Reliability Rules

- 只在配置了 `tiktokPixelCode` 时初始化。
- 如果页面上已经存在 `ttq` 且已加载，不重复注入基础代码。
- `PageView` 每次页面加载只发一次。
- `ViewContent` 仅商品页发送一次。
- `InitiateCheckout` 同一路径只发一次，防止按钮重复点击刷事件。
- 任一 TikTok 浏览器事件失败时，不影响现有访客上报逻辑。

## Verification

新增一个前端脚本单测，覆盖至少以下行为：

- 未配置像素码时，不初始化 TikTok。
- 配置像素码后，会注入 `ttq.load(...)` 并发送 `page()`。
- 商品页会发送 `ViewContent`。
- 购物车提交会触发 `AddToCart`。
- 结账入口点击会触发一次 `InitiateCheckout`。

人工验证目标：

- 主题脚本仍能向 `/api/visitor` 正常上报。
- 浏览器控制台可见 TikTok `page_view` / `view_content` / `add_to_cart` / `initiate_checkout`。
- 不出现浏览器侧 `Purchase`。

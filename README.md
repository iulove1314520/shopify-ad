# Shopee CPAS 广告追踪后端

这是一个基于 `Node.js + Express + SQLite + Docker Compose` 的 Shopee CPAS 广告追踪后端，用来承接落地页访客上报、接收 Shopify 订单 Webhook、进行点击与订单匹配，并把转化事件回传到 TikTok / Facebook。

## 项目能力

- 接收落地页上报的 `ttclid` / `fbclid`
- 记录真实访问 IP、访问时间、产品路径和 User-Agent
- 接收 Shopify 订单 Webhook，并执行 HMAC 验签
- 在时间窗口内用“时间差 + 商品信息 + IP / 地区信息”匹配访客与订单
- 回传 TikTok / Facebook `Purchase` 事件
- 为 webhook、订单和回传记录生成统一 `trace_id`，方便排查
- 提供看板接口：访客、订单、匹配、回传、Webhook 事件、统计摘要
- 使用 SQLite 持久化数据，并通过 Docker volume 保留数据库文件

## 当前技术栈

- Node.js 20
- Express 4
- better-sqlite3
- axios
- geoip-lite
- Docker Compose

## 目录结构

```text
.
├── server/
│   ├── src/
│   │   ├── app.js
│   │   ├── index.js
│   │   ├── config/
│   │   ├── db/
│   │   ├── modules/
│   │   ├── routes/
│   │   ├── services/
│   │   └── utils/
├── Dockerfile
├── docker-compose.yml
├── .env
├── .env.example
└── README.md
```

### Internal Module Layout

- `server/src/bootstrap/`
  - 负责 HTTP 服务启动、优雅停机和定时维护任务安装
- `server/src/modules/order/`
  - 拆分了 Shopify webhook 验签、webhook 事件落库、订单存取、重试和路由处理器
- `server/src/modules/match/`
  - 拆分了候选访客查询、未匹配原因摘要、callback 分发和状态写入
- `server/src/modules/system/`
  - 拆分了系统详情、保留策略、旧数据清理和全量清空逻辑
- `server/src/services/tiktok-request.js` / `server/src/services/facebook-request.js`
  - 只负责平台请求体构造，发送器本身保留在 `tiktok.js` / `facebook.js`

这些内部子模块通过 `modules/order.js`、`modules/match.js`、`modules/system.js` 等 facade 暴露稳定入口，`routes/` 层只保留挂载、鉴权和限流职责。

## 快速启动

1. 复制环境变量模板并按需要修改：

```bash
cp .env.example .env
```

2. 启动服务：

```bash
docker compose up -d --build
```

3. 检查健康状态：

```bash
curl http://localhost:38417/health
```

4. 打开简易 WebUI：

```text
http://localhost:38417/ui
```

5. 查看日志：

```bash
docker compose logs -f api
```

6. 运行自动化测试：

```bash
docker compose exec -T api npm test
```

## 核心环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | API 服务监听端口，当前默认 `38417` |
| `CORS_ALLOW_ORIGINS` | 允许跨域访问的来源列表，走同域代理时可留空 |
| `SQLITE_PATH` | SQLite 数据库文件路径 |
| `VISITOR_RETENTION_DAYS` | 访客数据保留天数 |
| `BUSINESS_DATA_RETENTION_DAYS` | 订单、匹配、回传、Webhook 记录的保留天数 |
| `MATCH_WINDOW_DAYS` | 订单匹配时间窗口，单位天 |
| `REQUEST_TIMEOUT_MS` | 调用第三方平台 API 的超时时间 |
| `CALLBACK_MAX_ATTEMPTS` | 单次回传流程里允许的最大尝试次数 |
| `CALLBACK_RETRY_DELAY_MS` | 回传失败且可重试时的重试间隔，单位毫秒 |
| `VISITOR_RATE_LIMIT_WINDOW_MS` | 访客上报接口的限流窗口 |
| `VISITOR_RATE_LIMIT_MAX` | 访客上报接口限流窗口内允许的最大请求数 |
| `WEBHOOK_RATE_LIMIT_WINDOW_MS` | Shopify Webhook 接口的限流窗口 |
| `WEBHOOK_RATE_LIMIT_MAX` | Shopify Webhook 接口限流窗口内允许的最大请求数 |
| `RETRY_RATE_LIMIT_WINDOW_MS` | 手动重试接口的限流窗口 |
| `RETRY_RATE_LIMIT_MAX` | 手动重试接口限流窗口内允许的最大请求数 |
| `CLEANUP_RATE_LIMIT_WINDOW_MS` | 一键清理旧数据接口的限流窗口 |
| `CLEANUP_RATE_LIMIT_MAX` | 一键清理旧数据接口限流窗口内允许的最大请求数 |
| `PURGE_RATE_LIMIT_WINDOW_MS` | 清空全部数据接口的限流窗口 |
| `PURGE_RATE_LIMIT_MAX` | 清空全部数据接口限流窗口内允许的最大请求数 |
| `DEFAULT_LIST_LIMIT` | 列表接口默认返回条数 |
| `MAX_LIST_LIMIT` | 列表接口允许查询的最大条数 |
| `API_AUTH_TOKEN` | 看板接口鉴权令牌 |
| `SHOPIFY_WEBHOOK_SECRET` | Shopify Webhook 验签密钥 |
| `TIKTOK_PIXEL_ID` | TikTok Pixel ID |
| `TIKTOK_ACCESS_TOKEN` | TikTok Access Token |
| `TIKTOK_PAGE_URL_BASE` | 当访客记录只保存相对路径时，用来拼接 TikTok 所需页面 URL 的基础域名 |
| `TIKTOK_PURCHASE_MODE` | TikTok Purchase 回传模式，支持 `self_hosted_only`（默认，仅保留自建后端 Purchase）和 `disabled` |
| `FACEBOOK_PIXEL_ID` | Facebook Pixel ID |
| `FACEBOOK_ACCESS_TOKEN` | Facebook Access Token |

## API 一览

### 无鉴权接口

- `GET /health`
- `POST /api/visitor`
- `POST /webhook/orders`

### 需要鉴权的看板接口

请求头二选一：

- `Authorization: Bearer <API_AUTH_TOKEN>`
- `X-API-Token: <API_AUTH_TOKEN>`

接口列表：

- `GET /api/stats`
- `GET /api/system`
- `POST /api/system/cleanup-old-data`
- `POST /api/system/purge-all-data`
- `GET /api/visitors`
- `GET /api/orders`
- `POST /api/orders/:orderId/retry-callback`
- `GET /api/matches`
- `GET /api/callbacks`
- `GET /api/webhook-events`

所有列表接口都支持 `?limit=100` 这样的查询参数。

新增说明：

- `POST /api/orders/:orderId/retry-callback` 用于手动重试失败或已跳过的广告平台回传
- `POST /api/system/cleanup-old-data` 用于一键清理超出保留期的旧访客、旧订单、旧匹配、旧回传和旧 Webhook 记录
- `POST /api/system/purge-all-data` 用于清空全部访客、订单、匹配、回传和 Webhook 数据
- 该接口需要和其他看板接口一样携带 `API_AUTH_TOKEN`
- 该接口支持在请求体里传 `visitorRetentionDays` 和 `businessRetentionDays`，按本次选择的天数自定义清理范围
- `POST /api/system/purge-all-data` 需要额外传入确认文本 `清空全部数据`，避免误删
- 如果订单已经成功回传，接口会返回 `409`
- `GET /api/system` 提供仅限已鉴权用户查看的详细系统状态，包括数据库与进程信息
- `GET /api/system` 现在还会返回 TikTok / Facebook 的配置自检结果，WebUI 会直接显示“已就绪 / 待补齐”
- `GET /api/system` 还会返回当前的数据保留策略，WebUI 会据此提示“一键清理旧数据”会删除哪些历史记录
- `GET /api/orders`、`GET /api/callbacks`、`GET /api/webhook-events` 会返回 `trace_id`，方便一条订单一路查到底
- `GET /api/matches` 会返回 `match_score` 和 `match_signals`，方便判断匹配是否可靠

## WebUI

项目现在自带一个简易运维面板，访问地址：

```text
http://localhost:38417/ui
```

使用方式：

1. 打开页面
2. 输入 `.env` 里的 `API_AUTH_TOKEN`
3. 点击“保存令牌”或“刷新数据”
4. 查看健康状态、统计、订单、匹配、回传和 Webhook 事件

说明：

- WebUI 不会自动读取服务器上的 `.env`
- Token 只会保存在当前浏览器的 localStorage
- 页面现在支持在订单列表中直接手动重试失败或未完成的订单回传
- 页面现在支持“一键清理旧数据”，只会清理超过保留期的历史记录，不会直接清空最近数据
- 页面现在支持自定义“保留最近多少天”的清理时间选择，访客和订单日志可以分别设置
- 页面现在把“按保留期清理”和“清空全部数据”拆成独立弹窗，不会再把顶栏布局撑乱
- 页面支持“只看异常明细”，方便快速过滤失败订单、失败回调和失败事件
- 页面会直接显示 TikTok / Facebook 是否已配置完整
- 订单、回传、Webhook 列表会展示“排查编号”，方便把同一次处理链路串起来看

## 常用联调示例

### 1. 上报访客

```bash
curl -X POST http://localhost:38417/api/visitor \
  -H 'Content-Type: application/json' \
  -d '{
    "ttclid": "ttclid_demo_001",
    "product_id": "/products/demo",
    "timestamp": "2026-03-26T05:05:00.000Z",
    "user_agent": "manual-test"
  }'
```

### 2. 查看看板统计

```bash
curl http://localhost:38417/api/stats \
  -H 'Authorization: Bearer change_me'
```

### 3. 查看订单列表

```bash
curl http://localhost:38417/api/orders \
  -H 'Authorization: Bearer change_me'
```

### 4. 查看匹配结果

```bash
curl http://localhost:38417/api/matches \
  -H 'Authorization: Bearer change_me'
```

### 5. 手动重试某个订单的回传

```bash
curl -X POST http://localhost:38417/api/orders/7480137056487/retry-callback \
  -H 'Authorization: Bearer change_me'
```

## 当前优化点

相较于最初骨架版本，当前项目已经补上了这些能力：

- SQLite 持久化而不是内存存储
- 公网 `/health` 已收敛为精简状态返回，详细状态改为鉴权接口 `GET /api/system`
- 订单状态原因 `status_reason`，便于排查未匹配或回传失败
- 看板调试接口：`orders`、`webhook-events`、`stats`
- 回传请求会记录触发来源、尝试次数、HTTP 状态、请求摘要和平台返回摘要
- TikTok 回传现在会尽量补齐 `event_source`、`event_id`、`context.ip`、`context.user_agent` 和 `context.page.url`
- 可重试失败会在单次处理流程内自动重试，并保留每次尝试记录
- 支持通过鉴权接口手动重试失败或已跳过的订单回传
- 新增多条件匹配评分，匹配结果会记录 `match_score` 和 `match_signals`
- 新增 `trace_id` 串联 webhook、订单和回传记录，排查时可以一条链路追到底
- 新增平台配置自检，能更早发现 TikTok / Facebook 的 Pixel 或 Token 漏填
- 关键入口已经增加基础限流，降低被刷爆或误触发洪峰的风险
- 生产环境下会强制要求配置非默认的 `API_AUTH_TOKEN`
- Docker Compose 挂载命名卷，容器重建后数据仍可保留
- `.gitignore` 已覆盖敏感配置和本地数据库文件
- 已补充最关键的自动化测试：webhook 验签、visitor 入库、匹配评分、回传失败重试

## 目前仍建议继续做的增强

- 将 webhook 回传链路改成异步任务队列
- 增加自动备份与恢复方案
- 根据业务量评估是否从 SQLite 升级到 MySQL / PostgreSQL

## 相关文件

- 需求说明：[虾皮广告追踪系统.md](./虾皮广告追踪系统.md)
- 逻辑流程图：[程序逻辑流程图.md](./程序逻辑流程图.md)
- 任务清单：[后端搭建任务清单.md](./后端搭建任务清单.md)
- 变更记录：[记录.md](./记录.md)

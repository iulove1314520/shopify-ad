# Shopee CPAS 广告追踪后端

这是一个基于 `Node.js + Express + SQLite + Docker Compose` 的 Shopee CPAS 广告追踪后端，用来承接落地页访客上报、接收 Shopify 订单 Webhook、进行点击与订单匹配，并把转化事件回传到 TikTok / Facebook。

## 项目能力

- 接收落地页上报的 `ttclid` / `fbclid`
- 记录真实访问 IP、访问时间、产品路径和 User-Agent
- 接收 Shopify 订单 Webhook，并执行 HMAC 验签
- 在时间窗口内匹配访客与订单
- 回传 TikTok / Facebook `Purchase` 事件
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

## 核心环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | API 服务监听端口，当前默认 `38417` |
| `SQLITE_PATH` | SQLite 数据库文件路径 |
| `VISITOR_RETENTION_DAYS` | 访客数据保留天数 |
| `MATCH_WINDOW_DAYS` | 订单匹配时间窗口，单位天 |
| `REQUEST_TIMEOUT_MS` | 调用第三方平台 API 的超时时间 |
| `CALLBACK_MAX_ATTEMPTS` | 单次回传流程里允许的最大尝试次数 |
| `CALLBACK_RETRY_DELAY_MS` | 回传失败且可重试时的重试间隔，单位毫秒 |
| `DEFAULT_LIST_LIMIT` | 列表接口默认返回条数 |
| `MAX_LIST_LIMIT` | 列表接口允许查询的最大条数 |
| `API_AUTH_TOKEN` | 看板接口鉴权令牌 |
| `SHOPIFY_WEBHOOK_SECRET` | Shopify Webhook 验签密钥 |
| `TIKTOK_PIXEL_ID` | TikTok Pixel ID |
| `TIKTOK_ACCESS_TOKEN` | TikTok Access Token |
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
- `GET /api/visitors`
- `GET /api/orders`
- `POST /api/orders/:orderId/retry-callback`
- `GET /api/matches`
- `GET /api/callbacks`
- `GET /api/webhook-events`

所有列表接口都支持 `?limit=100` 这样的查询参数。

新增说明：

- `POST /api/orders/:orderId/retry-callback` 用于手动重试失败或已跳过的广告平台回传
- 该接口需要和其他看板接口一样携带 `API_AUTH_TOKEN`
- 如果订单已经成功回传，接口会返回 `409`

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
- 页面本身是只读的，不会修改订单或回传数据

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
- 健康检查包含数据库状态
- 订单状态原因 `status_reason`，便于排查未匹配或回传失败
- 看板调试接口：`orders`、`webhook-events`、`stats`
- 回传请求会记录触发来源、尝试次数、HTTP 状态、请求摘要和平台返回摘要
- 可重试失败会在单次处理流程内自动重试，并保留每次尝试记录
- 支持通过鉴权接口手动重试失败或已跳过的订单回传
- Docker Compose 挂载命名卷，容器重建后数据仍可保留
- `.gitignore` 已覆盖敏感配置和本地数据库文件

## 目前仍建议继续做的增强

- 为未匹配订单保存更细的诊断信息
- 补充自动化测试
- 生产环境前加上反向代理、HTTPS 和访问控制
- 根据业务量评估是否从 SQLite 升级到 MySQL / PostgreSQL

## 相关文件

- 需求说明：[虾皮广告追踪系统.md](./虾皮广告追踪系统.md)
- 任务清单：[后端搭建任务清单.md](./后端搭建任务清单.md)
- 变更记录：[记录.md](./记录.md)

# Shopify 广告归因与转化回传后端

一个基于 `Node.js + Express + SQLite + Docker Compose` 的后端服务，用来接收落地页点击数据、消费 Shopify 订单 Webhook、完成订单归因，并把 `Purchase` 事件回传到 TikTok / Facebook。

## What It Does

- 接收落地页访客上报，记录 `ttclid` / `fbclid`、访问路径、IP、User-Agent 和时间戳
- 接收 Shopify 订单 Webhook，并执行 HMAC 验签
- 在时间窗口内按时间差、商品线索和 IP / 地理线索匹配访客与订单
- 把匹配成功的订单回传为 TikTok / Facebook `Purchase` 事件
- 为订单、Webhook、回传链路生成统一 `trace_id`
- 提供 WebUI 和鉴权 API，用于查看订单、匹配、回传、Webhook 事件和系统状态

## Architecture Snapshot

项目保持 `routes -> modules -> services / utils / db` 的分层：

- `routes/`
  - 负责挂载、鉴权和限流
- `modules/order/`
  - 负责 Shopify webhook、订单存取、回传重试和事件状态
- `modules/match/`
  - 负责候选查询、匹配决策、状态摘要和 callback 分发
- `modules/system/`
  - 负责系统状态、保留策略、旧数据清理和全量清空
- `bootstrap/`
  - 负责服务启动、优雅停机和维护任务安装

## Quick Start

1. 复制环境变量模板：

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

4. 打开 WebUI：

```text
http://localhost:38417/ui
```

5. 运行测试：

```bash
docker compose exec -T api npm test
```

## Core Endpoints

### Public

- `GET /health`
  - 返回精简健康状态
- `POST /api/visitor`
  - 接收落地页访客上报
- `POST /webhook/orders`
  - 接收 Shopify 订单 Webhook
- `GET /ui`
  - 打开内置运维面板

### Authenticated

- `POST /api/login`
  - 登录获取看板访问态
- `GET /api/system`
  - 查看系统状态、平台配置和保留策略
- `GET /api/stats`
  - 查看核心计数和状态摘要
- `GET /api/orders`
  - 查看订单处理结果
- `GET /api/matches`
  - 查看订单匹配结果
- `GET /api/callbacks`
  - 查看平台回传结果
- `GET /api/webhook-events`
  - 查看 Webhook 接收与处理状态

## Minimal Config

只列首次部署最关键的环境变量，完整示例见 `.env.example`。

| 变量 | 用途 |
| --- | --- |
| `PORT` | API 服务监听端口，默认 `38417` |
| `SQLITE_PATH` | SQLite 数据库文件路径 |
| `API_AUTH_TOKEN` | WebUI 和鉴权 API 使用的访问令牌 |
| `SHOPIFY_WEBHOOK_SECRET` | Shopify Webhook 验签密钥 |
| `TIKTOK_PIXEL_ID` | TikTok Pixel ID |
| `TIKTOK_ACCESS_TOKEN` | TikTok Access Token |
| `TIKTOK_PURCHASE_MODE` | TikTok Purchase 回传模式，默认 `self_hosted_only` |
| `FACEBOOK_PIXEL_ID` | Facebook Pixel ID |
| `FACEBOOK_ACCESS_TOKEN` | Facebook Access Token |

## Development Notes

- 数据持久化使用 SQLite，默认路径是 `data/app.db`
- `/health` 只返回精简状态，详细信息走鉴权接口 `GET /api/system`
- WebUI 不会自动读取服务器环境变量，需要手动输入 `API_AUTH_TOKEN`
- TikTok / Facebook 任一侧配置不完整时，系统会在面板和系统状态接口中标记为待补齐
- 服务默认带限流、错误日志和 `trace_id`，便于排查整条处理链路

## Verification

本地最小验证命令：

```bash
curl http://localhost:38417/health
docker compose exec -T api npm test
```

如果不走容器，也可以在 `server/` 目录执行：

```bash
npm test
node src/index.js
```

## Repo Layout

```text
.
├── server/
│   ├── src/
│   │   ├── app.js
│   │   ├── index.js
│   │   ├── bootstrap/
│   │   ├── config/
│   │   ├── db/
│   │   ├── modules/
│   │   ├── routes/
│   │   ├── services/
│   │   └── utils/
│   └── test/
├── data/
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

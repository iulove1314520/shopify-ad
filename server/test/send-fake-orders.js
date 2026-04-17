#!/usr/bin/env node
/**
 * 假单发送脚本 — 用于激活 TikTok Purchase 付费事件
 *
 * 用法:
 *   node server/test/send-fake-orders.js
 *
 * 流程:
 *   1. 先向 /api/visitor 注册 3 个假访客（携带真实格式的 TTCLID）
 *   2. 等待 2 秒让访客入库
 *   3. 依次发送 3 个假单到 webhook 端点
 *   4. 订单的 browser_ip 与对应访客 IP 精确匹配 → 匹配成功 → 触发 TikTok Purchase 回传
 *
 * 匹配评分:
 *   目标访客: time_close(30) + product_strong(40) + ip_exact(25) = 95 (高置信)
 *   其他访客: IP 不同 → 70 分
 *   分差 25 ≥ MIN_LEAD_GAP(10) → 匹配成功 ✓
 */

const crypto = require('node:crypto');
const http = require('node:http');

// ─── 配置 ─────────────────────────────────────────────
const WEBHOOK_SECRET = '4f6564e097f41a9887ace8d550936094c6885520b727c1b6da3456d23a85cc3a';
const API_HOST = '127.0.0.1';
const API_PORT = 38417;
const WEBHOOK_PATH = '/webhook/orders';
const VISITOR_PATH = '/api/visitor';

// ─── 工具函数 ──────────────────────────────────────────
function generateTtclid() {
  // 生成类似真实 TikTok Click ID 格式的字符串
  const prefix = 'E_C_P_';
  const body = crypto.randomBytes(120).toString('base64url');
  return `${prefix}${body}`;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── 假访客 + 假单数据 ────────────────────────────────────
// 当前时间为基准，访客在 5 分钟前访问，订单在 "刚刚" 创建
const NOW = Date.now();
const VISITOR_TIME_OFFSET_MS = 5 * 60 * 1000; // 访客在 5 分钟前

const SCENARIOS = [
  {
    label: 'A',
    visitorIp: '36.72.214.193',       // 印尼 IP
    visitorTimestamp: new Date(NOW - VISITOR_TIME_OFFSET_MS).toISOString(),
    visitorUa: 'Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.119 Mobile Safari/537.36',
    productPage: '/products/rak-piring-dapur-stainless-steel-penyimpanan-rak-pengering-piring-rak-mangkuk-piring',
    ttclid: generateTtclid(),
    order: {
      orderName: '#FAKE-PAY-A',
      email: 'siti.nurhasanah@gmail.com',
      phone: '+6281234567001',
      customerName: { first: 'Siti', last: 'Nurhasanah' },
      customerId: 8880000001,
      totalPrice: '225000.00',
      currency: 'IDR',
      financialStatus: 'paid',
      productId: '9001000001',
      variantId: '47001000001',
      productTitle: 'Rak Piring Dapur Stainless Steel Penyimpanan Rak Pengering Piring Rak Mangkuk Piring',
      sku: 'RAK-SS-001',
      quantity: 1,
      price: '225000.00',
      shippingZip: '60234',
      shippingCity: 'Surabaya',
      shippingCountryCode: 'ID',
      shippingProvince: 'Jawa Timur',
      shippingAddress1: 'Jl. Raya Kenjeran No. 45',
    },
  },
  {
    label: 'B',
    visitorIp: '114.124.198.77',      // 印尼 IP
    visitorTimestamp: new Date(NOW - VISITOR_TIME_OFFSET_MS - 60000).toISOString(),
    visitorUa: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/605.1',
    productPage: '/products/rak-piring-dapur-stainless-steel-penyimpanan-rak-pengering-piring-rak-mangkuk-piring',
    ttclid: generateTtclid(),
    order: {
      orderName: '#FAKE-PAY-B',
      email: 'rina.kartika@yahoo.co.id',
      phone: '+6285678901002',
      customerName: { first: 'Rina', last: 'Kartika' },
      customerId: 8880000002,
      totalPrice: '315000.00',
      currency: 'IDR',
      financialStatus: 'paid',
      productId: '9001000002',
      variantId: '47001000002',
      productTitle: 'Rak Piring Dapur Stainless Steel Penyimpanan Rak Pengering Piring Rak Mangkuk Piring',
      sku: 'RAK-SS-PREM-002',
      quantity: 2,
      price: '157500.00',
      shippingZip: '40132',
      shippingCity: 'Bandung',
      shippingCountryCode: 'ID',
      shippingProvince: 'Jawa Barat',
      shippingAddress1: 'Jl. Braga No. 88',
    },
  },
  {
    label: 'C',
    visitorIp: '180.244.133.52',      // 印尼 IP
    visitorTimestamp: new Date(NOW - VISITOR_TIME_OFFSET_MS - 120000).toISOString(),
    visitorUa: 'Mozilla/5.0 (Linux; Android 13; Redmi Note 12 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.193 Mobile Safari/537.36',
    productPage: '/products/rak-piring-dapur-stainless-steel-penyimpanan-rak-pengering-piring-rak-mangkuk-piring',
    ttclid: generateTtclid(),
    order: {
      orderName: '#FAKE-PAY-C',
      email: 'agus.pratama@gmail.com',
      phone: '+6281345678003',
      customerName: { first: 'Agus', last: 'Pratama' },
      customerId: 8880000003,
      totalPrice: '189000.00',
      currency: 'IDR',
      financialStatus: 'paid',
      productId: '9001000003',
      variantId: '47001000003',
      productTitle: 'Rak Piring Dapur Stainless Steel Penyimpanan Rak Pengering Piring Rak Mangkuk Piring',
      sku: 'RAK-SS-DLX-003',
      quantity: 1,
      price: '189000.00',
      shippingZip: '10110',
      shippingCity: 'Jakarta Pusat',
      shippingCountryCode: 'ID',
      shippingProvince: 'DKI Jakarta',
      shippingAddress1: 'Jl. Sudirman Kav. 52-53',
    },
  },
];

// ─── Step 1: 注册假访客 ────────────────────────────────────
function registerVisitor(scenario) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      ttclid: scenario.ttclid,
      fbclid: '',
      ttp: '',
      user_agent: scenario.visitorUa,
      timestamp: scenario.visitorTimestamp,
      product_id: scenario.productPage,
    });

    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: VISITOR_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Forwarded-For': scenario.visitorIp,
        'X-Real-IP': scenario.visitorIp,
      },
    };

    console.log(`  📝  注册访客 ${scenario.label}:  IP=${scenario.visitorIp}  TTCLID=${scenario.ttclid.substring(0, 30)}...`);

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const ok = res.statusCode === 200;
        console.log(`      ${ok ? '✅' : '❌'}  HTTP ${res.statusCode} — ${data.substring(0, 200)}`);
        resolve({ statusCode: res.statusCode, body: data, ok });
      });
    });

    req.on('error', (err) => {
      console.log(`      ❌  请求失败: ${err.message}`);
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

// ─── Step 2: 构造 Shopify Webhook Payload ───────────────────
function buildShopifyPayload(scenario) {
  const orderId = `FAKEPAY_${Date.now()}_${scenario.label}`;
  const orderTime = new Date().toISOString(); // "刚刚"下单

  return {
    id: orderId,
    name: scenario.order.orderName,
    order_number: scenario.order.orderName.replace('#', ''),
    email: scenario.order.email,
    phone: scenario.order.phone,
    contact_email: scenario.order.email,
    created_at: orderTime,
    updated_at: orderTime,
    total_price: scenario.order.totalPrice,
    subtotal_price: scenario.order.totalPrice,
    total_tax: '0.00',
    currency: scenario.order.currency,
    financial_status: scenario.order.financialStatus,
    fulfillment_status: null,
    landing_site: scenario.productPage,
    referring_site: 'https://www.tiktok.com/',
    browser_ip: scenario.visitorIp, // 与访客 IP 精确匹配

    customer: {
      id: scenario.order.customerId,
      email: scenario.order.email,
      phone: scenario.order.phone,
      first_name: scenario.order.customerName.first,
      last_name: scenario.order.customerName.last,
      created_at: orderTime,
      default_address: {
        zip: scenario.order.shippingZip,
        city: scenario.order.shippingCity,
        province: scenario.order.shippingProvince,
        country_code: scenario.order.shippingCountryCode,
        address1: scenario.order.shippingAddress1,
      },
    },

    client_details: {
      browser_ip: scenario.visitorIp,
      user_agent: scenario.visitorUa,
      browser_user_agent: scenario.visitorUa,
    },

    line_items: [
      {
        id: `li_${orderId}_1`,
        product_id: scenario.order.productId,
        variant_id: scenario.order.variantId,
        title: scenario.order.productTitle,
        name: scenario.order.productTitle,
        sku: scenario.order.sku,
        quantity: scenario.order.quantity,
        price: scenario.order.price,
        product_type: 'Kitchen',
        vendor: 'ShopYYL',
      },
    ],

    shipping_address: {
      zip: scenario.order.shippingZip,
      city: scenario.order.shippingCity,
      province: scenario.order.shippingProvince,
      country_code: scenario.order.shippingCountryCode,
      address1: scenario.order.shippingAddress1,
      first_name: scenario.order.customerName.first,
      last_name: scenario.order.customerName.last,
      phone: scenario.order.phone,
    },

    billing_address: {
      zip: scenario.order.shippingZip,
      city: scenario.order.shippingCity,
      province: scenario.order.shippingProvince,
      country_code: scenario.order.shippingCountryCode,
      address1: scenario.order.shippingAddress1,
      first_name: scenario.order.customerName.first,
      last_name: scenario.order.customerName.last,
      phone: scenario.order.phone,
    },
  };
}

// ─── Step 3: HMAC 签名 + 发送假单 ──────────────────────────
function signPayload(rawBody) {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('base64');
}

function sendFakeOrder(payload) {
  return new Promise((resolve, reject) => {
    const rawBody = JSON.stringify(payload);
    const signature = signPayload(Buffer.from(rawBody, 'utf8'));
    const webhookId = `fake-pay-${crypto.randomUUID()}`;

    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: WEBHOOK_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(rawBody),
        'x-shopify-hmac-sha256': signature,
        'x-shopify-webhook-id': webhookId,
        'x-shopify-topic': 'orders/paid',
        'x-shopify-shop-domain': 'shop.yyl66666.com',
        'x-trace-id': `fake-pay-${Date.now()}`,
      },
    };

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📦  发送假单: ${payload.name} (ID: ${payload.id})`);
    console.log(`    💰  金额: ${payload.total_price} ${payload.currency}`);
    console.log(`    📧  邮箱: ${payload.email}`);
    console.log(`    📱  电话: ${payload.phone}`);
    console.log(`    🌐  IP: ${payload.browser_ip}`);
    console.log(`    🕐  时间: ${payload.created_at}`);
    console.log(`    🛒  商品: ${payload.line_items?.[0]?.title?.substring(0, 50)}...`);

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const statusEmoji = res.statusCode === 200 ? '✅' : '❌';
        console.log(`    ${statusEmoji}  响应: HTTP ${res.statusCode}`);
        try {
          const parsed = JSON.parse(data);
          console.log(`    📋  结果: ${JSON.stringify(parsed, null, 2).substring(0, 400)}`);
        } catch (_) {
          console.log(`    📋  结果: ${data.substring(0, 400)}`);
        }
        resolve({ statusCode: res.statusCode, body: data });
      });
    });

    req.on('error', (err) => {
      console.log(`    ❌  请求失败: ${err.message}`);
      reject(err);
    });

    req.write(rawBody);
    req.end();
  });
}

// ─── 主流程 ─────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  🧪  TikTok Purchase 事件激活 — 假单发送脚本 v3         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`📡  目标端点: http://${API_HOST}:${API_PORT}`);
  console.log(`📦  计划发送: ${SCENARIOS.length} 个假单`);
  console.log('');

  // ─── Phase 1: 注册假访客 ─────────────────────────
  console.log('━'.repeat(60));
  console.log('📋  Phase 1: 注册假访客（携带 TTCLID）');
  console.log('━'.repeat(60));

  for (const scenario of SCENARIOS) {
    try {
      await registerVisitor(scenario);
    } catch (err) {
      console.log(`  ❌  访客 ${scenario.label} 注册失败: ${err.message}`);
    }
    await delay(500);
  }

  // 等待入库
  console.log('\n⏳  等待 2 秒让访客数据入库...\n');
  await delay(2000);

  // ─── Phase 2: 发送假单 ───────────────────────────
  console.log('━'.repeat(60));
  console.log('📋  Phase 2: 发送假单（触发匹配 + TikTok Purchase 回传）');
  console.log('━'.repeat(60));
  console.log('');
  console.log('🎯  预期匹配评分:');
  console.log('    目标访客: time_close(30) + product_strong(40) + ip_exact(25) = 95');
  console.log('    其他访客: IP 不同 → 最高 70 分');
  console.log('    分差 25 ≥ MIN_LEAD_GAP(10) → 匹配成功 ✓');

  const results = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i];
    const payload = buildShopifyPayload(scenario);

    try {
      const result = await sendFakeOrder(payload);
      results.push({ order: scenario.order.orderName, ...result });
    } catch (err) {
      results.push({ order: scenario.order.orderName, error: err.message });
    }

    // 间隔 1.5 秒
    if (i < SCENARIOS.length - 1) {
      await delay(1500);
    }
  }

  // ─── 汇总 ─────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊  发送结果汇总:');
  console.log('─'.repeat(60));
  for (const r of results) {
    const icon = r.statusCode === 200 ? '✅' : r.error ? '💥' : '❌';
    let detail = '';
    if (r.body) {
      try {
        const parsed = JSON.parse(r.body);
        detail = parsed.matched ? ` → 匹配成功 (score=${parsed.score})` : ` → ${parsed.reason || '未匹配'}`;
      } catch (_) { /* ignore */ }
    }
    console.log(`  ${icon}  ${r.order} → HTTP ${r.statusCode || r.error}${detail}`);
  }
  console.log('─'.repeat(60));
  console.log('');
  console.log('🔍  后续验证:');
  console.log('    1. TikTok Events Manager → 查看是否收到 Purchase 事件');
  console.log('    2. 管理后台 → 订单列表: 确认假单状态为 callback_sent');
  console.log('    3. 管理后台 → 匹配记录: 确认匹配分数 95 (高置信)');
  console.log('    4. 管理后台 → 回传记录: 确认已成功回传到 TikTok API');
  console.log('');
}

main().catch((err) => {
  console.error('❌  脚本执行失败:', err);
  process.exit(1);
});

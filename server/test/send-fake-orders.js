#!/usr/bin/env node
/**
 * 假单发送脚本 — 用于测试 TikTok 归因
 *
 * 用法:
 *   node server/test/send-fake-orders.js
 *
 * 说明:
 *   - 使用数据库中真实的 TTCLID（关联到真实访客）
 *   - 构造完整的 Shopify 格式 webhook payload
 *   - 包含所有 EMQ 字段：email / phone / external_id / content_id / value / currency / event_id
 *   - 使用 SHOPIFY_WEBHOOK_SECRET 签名，确保 webhook 验签通过
 *   - 发送到本地 webhook 端点，触发完整匹配→回传流程
 *
 * 匹配策略:
 *   - 每个假单的 browser_ip 与目标访客 IP 一致 → 触发 browser_ip_exact (+25)
 *   - 其他访客因 IP 不匹配得到 browser_ip_mismatch (0分)
 *   - 目标访客总分: time(30) + product(40) + ip(25) = 95
 *   - 其他访客总分: time(30) + product(40) + ip(0) = 70
 *   - 分差 25 ≥ MAIN_MIN_LEAD_GAP(10) ✓ ，确保匹配成功
 */

const crypto = require('node:crypto');
const http = require('node:http');

// ─── 配置 ─────────────────────────────────────────────
const WEBHOOK_SECRET = '4f6564e097f41a9887ace8d550936094c6885520b727c1b6da3456d23a85cc3a';
const API_HOST = '127.0.0.1';
const API_PORT = 38417;
const WEBHOOK_PATH = '/webhook/orders';

// ─── 假单数据 ─────────────────────────────────────────
// 选择 FREE 状态的、有不同 IP 的真实访客
// 订单 created_at 设在目标访客 timestamp 之后 10 分钟内，确保 time_close (+30)
const FAKE_ORDERS = [
  {
    // 目标：访客 ID 78 (103.155.191.231, 2026-04-11T07:46:16.210Z)
    // 该访客有独立 TTCLID 和独立 IP
    orderId: `FAKETEST_${Date.now()}_A`,
    orderName: '#TEST-A78',
    email: 'ika.wijaya.test@gmail.com',
    phone: '+6281234567890',
    customerName: { first: 'Ika', last: 'Wijaya' },
    customerId: 9990000001,
    totalPrice: '189000.00',
    currency: 'IDR',
    financialStatus: 'paid',
    // IP 与目标访客一致 → browser_ip_exact (+25)
    ip: '103.155.191.231',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/605.1',
    productId: '9001000001',
    variantId: '47001000001',
    productTitle: 'Rak Piring Dapur Stainless Steel Penyimpanan Rak Pengering Piring Rak Mangkuk Piring',
    sku: 'RAK-SS-001',
    quantity: 1,
    price: '189000.00',
    shippingZip: '60112',
    shippingCity: 'Surabaya',
    shippingCountryCode: 'ID',
    shippingProvince: 'Jawa Timur',
    shippingAddress1: 'Jl. Raya Darmo No. 88',
    // 10 分钟后下单
    createdAt: '2026-04-11T07:56:16.000Z',
    landingSite: '/products/rak-piring-dapur-stainless-steel-penyimpanan-rak-pengering-piring-rak-mangkuk-piring',
    referringSite: 'https://www.tiktok.com/',
  },
  {
    // 目标：访客 ID 77 (182.8.131.23, 2026-04-11T07:43:20.355Z)
    // 该访客有独立 TTCLID 和独立 IP
    orderId: `FAKETEST_${Date.now()}_B`,
    orderName: '#TEST-B77',
    email: 'dewi.lestari.test@yahoo.co.id',
    phone: '+6285678901234',
    customerName: { first: 'Dewi', last: 'Lestari' },
    customerId: 9990000002,
    totalPrice: '247500.00',
    currency: 'IDR',
    financialStatus: 'paid',
    ip: '182.8.131.23',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.119 Mobile Safari/537.36',
    productId: '9001000002',
    variantId: '47001000002',
    productTitle: 'Rak Piring Dapur Stainless Steel Penyimpanan Rak Pengering Piring Rak Mangkuk Piring',
    sku: 'RAK-SS-PREM-002',
    quantity: 2,
    price: '123750.00',
    shippingZip: '40132',
    shippingCity: 'Bandung',
    shippingCountryCode: 'ID',
    shippingProvince: 'Jawa Barat',
    shippingAddress1: 'Jl. Asia Afrika No. 56',
    // 8 分钟后下单
    createdAt: '2026-04-11T07:51:20.000Z',
    landingSite: '/products/rak-piring-dapur-stainless-steel-penyimpanan-rak-pengering-piring-rak-mangkuk-piring',
    referringSite: 'https://www.tiktok.com/',
  },
  {
    // 目标：访客 ID 75 (103.255.132.214, 2026-04-11T07:12:35.469Z)
    // 该访客有独立 TTCLID 和独立 IP
    orderId: `FAKETEST_${Date.now()}_C`,
    orderName: '#TEST-C75',
    email: 'budi.santoso.test@gmail.com',
    phone: '+6281345678901',
    customerName: { first: 'Budi', last: 'Santoso' },
    customerId: 9990000003,
    totalPrice: '315000.00',
    currency: 'IDR',
    financialStatus: 'paid',
    ip: '103.255.132.214',
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Redmi Note 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.193 Mobile Safari/537.36',
    productId: '9001000003',
    variantId: '47001000003',
    productTitle: 'Rak Piring Dapur Stainless Steel Penyimpanan Rak Pengering Piring Rak Mangkuk Piring',
    sku: 'RAK-SS-DLX-003',
    quantity: 1,
    price: '315000.00',
    shippingZip: '10110',
    shippingCity: 'Jakarta Pusat',
    shippingCountryCode: 'ID',
    shippingProvince: 'DKI Jakarta',
    shippingAddress1: 'Jl. Thamrin No. 12',
    // 5 分钟后下单
    createdAt: '2026-04-11T07:17:35.000Z',
    landingSite: '/products/rak-piring-dapur-stainless-steel-penyimpanan-rak-pengering-piring-rak-mangkuk-piring',
    referringSite: 'https://www.tiktok.com/',
  },
];

// ─── 构造 Shopify 格式的 Order Payload ─────────────────
function buildShopifyPayload(order) {
  return {
    id: order.orderId,
    name: order.orderName,
    order_number: order.orderName.replace('#', ''),
    email: order.email,
    phone: order.phone,
    contact_email: order.email,
    created_at: order.createdAt,
    updated_at: order.createdAt,
    total_price: order.totalPrice,
    subtotal_price: order.totalPrice,
    total_tax: '0.00',
    currency: order.currency,
    financial_status: order.financialStatus,
    fulfillment_status: null,
    landing_site: order.landingSite,
    referring_site: order.referringSite,
    browser_ip: order.ip,

    customer: {
      id: order.customerId,
      email: order.email,
      phone: order.phone,
      first_name: order.customerName.first,
      last_name: order.customerName.last,
      created_at: order.createdAt,
      default_address: {
        zip: order.shippingZip,
        city: order.shippingCity,
        province: order.shippingProvince,
        country_code: order.shippingCountryCode,
        address1: order.shippingAddress1,
      },
    },

    client_details: {
      browser_ip: order.ip,
      user_agent: order.userAgent,
      browser_user_agent: order.userAgent,
    },

    line_items: [
      {
        id: `li_${order.orderId}_1`,
        product_id: order.productId,
        variant_id: order.variantId,
        title: order.productTitle,
        name: order.productTitle,
        sku: order.sku,
        quantity: order.quantity,
        price: order.price,
        product_type: 'Kitchen',
        vendor: 'ShopYYL',
      },
    ],

    shipping_address: {
      zip: order.shippingZip,
      city: order.shippingCity,
      province: order.shippingProvince,
      country_code: order.shippingCountryCode,
      address1: order.shippingAddress1,
      first_name: order.customerName.first,
      last_name: order.customerName.last,
      phone: order.phone,
    },

    billing_address: {
      zip: order.shippingZip,
      city: order.shippingCity,
      province: order.shippingProvince,
      country_code: order.shippingCountryCode,
      address1: order.shippingAddress1,
      first_name: order.customerName.first,
      last_name: order.customerName.last,
      phone: order.phone,
    },
  };
}

// ─── HMAC 签名 ─────────────────────────────────────────
function signPayload(rawBody) {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('base64');
}

// ─── 发送单个假单 ───────────────────────────────────────
function sendFakeOrder(payload) {
  return new Promise((resolve, reject) => {
    const rawBody = JSON.stringify(payload);
    const signature = signPayload(Buffer.from(rawBody, 'utf8'));
    const webhookId = `fake-webhook-${crypto.randomUUID()}`;

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
        'x-trace-id': `fake-test-${Date.now()}`,
      },
    };

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📦  发送假单: ${payload.name} (ID: ${payload.id})`);
    console.log(`    订单金额: ${payload.total_price} ${payload.currency}`);
    console.log(`    创建时间: ${payload.created_at}`);
    console.log(`    邮箱: ${payload.email}`);
    console.log(`    电话: ${payload.phone}`);
    console.log(`    客户ID: ${payload.customer?.id}`);
    console.log(`    商品: ${payload.line_items?.[0]?.title?.substring(0, 50)}...`);
    console.log(`    商品ID: ${payload.line_items?.[0]?.product_id}`);
    console.log(`    IP: ${payload.browser_ip}`);
    console.log(`    UA: ${(payload.client_details?.user_agent || '').substring(0, 60)}...`);
    console.log(`    Webhook-ID: ${webhookId}`);

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const statusEmoji = res.statusCode === 200 ? '✅' : '❌';
        console.log(`    ${statusEmoji}  响应: HTTP ${res.statusCode}`);
        try {
          const parsed = JSON.parse(data);
          console.log(`    📋  响应内容: ${JSON.stringify(parsed, null, 2).substring(0, 300)}`);
        } catch (_) {
          console.log(`    📋  响应内容: ${data.substring(0, 300)}`);
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
  console.log('║  🧪  TikTok 归因测试 — 假单发送脚本 v2                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`📡  目标端点: http://${API_HOST}:${API_PORT}${WEBHOOK_PATH}`);
  console.log(`📦  待发送假单数: ${FAKE_ORDERS.length}`);
  console.log('');
  console.log('🎯  匹配策略:');
  console.log('    每个假单的 browser_ip 与目标访客 IP 精确匹配');
  console.log('    目标访客评分: time(30) + product(40) + ip_exact(25) = 95');
  console.log('    其他访客评分: time(30) + product(40) + ip_mismatch(0) = 70');
  console.log('    分差 25 ≥ MAIN_MIN_LEAD_GAP(10) → 匹配成功 ✓');
  console.log('');
  console.log('EMQ 字段:');
  console.log('  • click_id (ttclid)    → 匹配引擎自动从访客获取');
  console.log('  • ip                   → payload.browser_ip → 明文上报');
  console.log('  • user_agent           → payload.client_details.user_agent → 明文上报');
  console.log('  • email                → payload.email → SHA256 哈希后上报');
  console.log('  • phone_number         → payload.phone → 标准化+SHA256 哈希后上报');
  console.log('  • external_id          → shopify_customer:{id} → SHA256 哈希后上报');
  console.log('  • content_id           → line_items[].product_id');
  console.log('  • value                → total_price');
  console.log('  • currency             → currency (IDR)');
  console.log('  • event_id             → order_{shopify_order_id}');

  const results = [];

  for (let i = 0; i < FAKE_ORDERS.length; i++) {
    const payload = buildShopifyPayload(FAKE_ORDERS[i]);

    try {
      const result = await sendFakeOrder(payload);
      results.push({ order: FAKE_ORDERS[i].orderName, ...result });
    } catch (err) {
      results.push({ order: FAKE_ORDERS[i].orderName, error: err.message });
    }

    // 间隔 1.5 秒发送
    if (i < FAKE_ORDERS.length - 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊  发送结果汇总:');
  console.log('─'.repeat(60));
  for (const r of results) {
    const icon = r.statusCode === 200 ? '✅' : r.error ? '💥' : '❌';
    console.log(`  ${icon}  ${r.order} → ${r.statusCode || r.error}`);
  }
  console.log('─'.repeat(60));
  console.log('');
  console.log('🔍  请前往 TikTok Events Manager 查看是否收到事件');
  console.log('    并检查 EMQ 评分是否有所提升');
  console.log('');
  console.log('💡  后续验证:');
  console.log('    - 管理后台 → 订单列表: 确认假单已入库且 status=callback_sent');
  console.log('    - 管理后台 → 匹配记录: 确认已与真实访客匹配 (score=95)');
  console.log('    - 管理后台 → 回传记录: 确认已成功回传到 TikTok API');
}

main().catch((err) => {
  console.error('❌  脚本执行失败:', err);
  process.exit(1);
});

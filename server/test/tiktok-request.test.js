const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const axios = require('axios');

const { createTestContext } = require('./helpers/test-context');

test('buildTikTokRequestBody 会构建稳定的 Purchase request body', () => {
  const context = createTestContext({
    TIKTOK_PIXEL_ID: 'CKN3ABRC77U4JN785N60',
    TIKTOK_PAGE_URL_BASE: 'https://shop.example.com',
  });

  try {
    const { env } = context.requireServer('config/env');
    const { buildTikTokRequestBody } = context.requireServer('services/tiktok-request');

    const body = buildTikTokRequestBody(
      {
        shopify_order_id: 'order_tiktok_builder_001',
        created_at: '2026-04-02T07:27:50.414Z',
        total_price: 259170,
        currency: 'IDR',
        raw_payload: JSON.stringify({
          line_items: [
            {
              title: 'Demo Shelf',
              quantity: 1,
              price: '259170.00',
              product_id: 'shelf-001',
            },
          ],
        }),
      },
      'ttclid-builder-001',
      {
        visitor: {
          ip: '198.51.100.24',
          user_agent: 'Mozilla/5.0 test browser',
          product_id: '/products/demo-shelf',
        },
      },
      env
    );

    assert.equal(body.event_source, 'web');
    assert.equal(body.event_source_id, 'CKN3ABRC77U4JN785N60');
    assert.equal(body.pixel_code, undefined);
    assert.equal(body.data[0].event, 'Purchase');
    assert.equal(body.data[0].event_id, 'order_order_tiktok_builder_001');
    assert.equal(body.data[0].timestamp, undefined);
    assert.equal(body.data[0].context, undefined);
    assert.equal(body.data[0].user.ttclid, 'ttclid-builder-001');
    assert.equal(body.data[0].user.ip, '198.51.100.24');
    assert.equal(body.data[0].user.user_agent, 'Mozilla/5.0 test browser');
    assert.equal(
      body.data[0].page.url,
      'https://shop.example.com/products/demo-shelf'
    );
    assert.equal(body.data[0].properties.contents[0].content_id, 'shelf-001');
  } finally {
    context.cleanup();
  }
});

test('sendToTikTok 会补齐 event_source、event_id、ip、user_agent 和 page url', async () => {
  const context = createTestContext({
    TIKTOK_PIXEL_ID: 'CKN3ABRC77U4JN785N60',
    TIKTOK_ACCESS_TOKEN: 'demo-token',
    TIKTOK_PAGE_URL_BASE: 'https://shop.example.com',
  });
  const originalPost = axios.post;
  let capturedRequest = null;

  axios.post = async (url, body, config) => {
    capturedRequest = { url, body, config };
    return {
      status: 200,
      data: {
        code: 0,
        message: 'ok',
      },
    };
  };

  try {
    const { sendToTikTok } = context.requireServer('services/tiktok');

    const result = await sendToTikTok(
      {
        shopify_order_id: 'order_tiktok_001',
        created_at: '2026-04-02T07:27:50.414Z',
        total_price: 259170,
        currency: 'IDR',
        raw_payload: JSON.stringify({
          line_items: [
            {
              title: 'Demo Shelf',
              quantity: 1,
              price: '259170.00',
              product_id: 'shelf-001',
            },
          ],
        }),
      },
      'E.C.P.v3fQ2RHacdksKfofPmlyuStIIHJ4Af1tKYxF9zz2c2PLx1Oaw15oHpcfl5AH',
      {
        visitor: {
          ip: '198.51.100.24',
          user_agent: 'Mozilla/5.0 test browser',
          product_id: '/products/demo-shelf',
        },
      }
    );

    assert.equal(result.status, 'success');
    assert.ok(capturedRequest);
    assert.equal(
      capturedRequest.url,
      'https://business-api.tiktok.com/open_api/v1.3/event/track/'
    );
    assert.equal(capturedRequest.body.pixel_code, undefined);
    assert.equal(capturedRequest.body.event_source, 'web');
    assert.equal(capturedRequest.body.event_source_id, 'CKN3ABRC77U4JN785N60');
    assert.equal(capturedRequest.body.data.length, 1);
    assert.equal(capturedRequest.body.data[0].event, 'Purchase');
    assert.equal(capturedRequest.body.data[0].event_id, 'order_order_tiktok_001');
    assert.equal(capturedRequest.body.data[0].timestamp, undefined);
    assert.equal(capturedRequest.body.data[0].event_time, 1775114870);
    assert.equal(capturedRequest.body.data[0].context, undefined);
    assert.equal(capturedRequest.body.data[0].user.ip, '198.51.100.24');
    assert.equal(
      capturedRequest.body.data[0].user.user_agent,
      'Mozilla/5.0 test browser'
    );
    assert.equal(
      capturedRequest.body.data[0].page.url,
      'https://shop.example.com/products/demo-shelf'
    );
    assert.equal(
      capturedRequest.body.data[0].user.ttclid,
      'E.C.P.v3fQ2RHacdksKfofPmlyuStIIHJ4Af1tKYxF9zz2c2PLx1Oaw15oHpcfl5AH'
    );
    assert.equal(capturedRequest.body.data[0].properties.currency, 'IDR');
    assert.equal(capturedRequest.body.data[0].properties.value, 259170);
    assert.equal(capturedRequest.body.data[0].properties.content_type, 'product');
    assert.equal(capturedRequest.body.data[0].properties.contents.length, 1);
    assert.equal(
      capturedRequest.body.data[0].properties.contents[0].content_id,
      'shelf-001'
    );
  } finally {
    axios.post = originalPost;
    context.cleanup();
  }
});

test('sendToTikTok 会优先选择信息更完整的 User-Agent 作为回传上下文', async () => {
  const context = createTestContext({
    TIKTOK_PIXEL_ID: 'CKN3ABRC77U4JN785N60',
    TIKTOK_ACCESS_TOKEN: 'demo-token',
    TIKTOK_PAGE_URL_BASE: 'https://shop.example.com',
  });
  const originalPost = axios.post;
  let capturedRequest = null;

  axios.post = async (url, body, config) => {
    capturedRequest = { url, body, config };
    return {
      status: 200,
      data: {
        code: 0,
        message: 'ok',
      },
    };
  };

  try {
    const { sendToTikTok } = context.requireServer('services/tiktok');

    await sendToTikTok(
      {
        shopify_order_id: 'order_tiktok_ua_choice',
        created_at: '2026-04-02T07:27:50.414Z',
        total_price: 259170,
        currency: 'IDR',
        raw_payload: JSON.stringify({
          client_details: {
            user_agent:
              'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
          },
          line_items: [
            {
              title: 'Demo Shelf',
              quantity: 1,
              price: '259170.00',
              product_id: 'shelf-001',
            },
          ],
        }),
      },
      'E.C.P.v3fQ2RHacdksKfofPmlyuStIIHJ4Af1tKYxF9zz2c2PLx1Oaw15oHpcfl5AH',
      {
        visitor: {
          ip: '198.51.100.24',
          user_agent: 'Mozilla/5.0',
          product_id: '/products/demo-shelf',
        },
      }
    );

    assert.ok(capturedRequest);
    assert.equal(
      capturedRequest.body.data[0].user.user_agent,
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
    );
  } finally {
    axios.post = originalPost;
    context.cleanup();
  }
});

test('sendToTikTok 会在可用时补充哈希后的 email、phone、external_id 和 ttp', async () => {
  const context = createTestContext({
    TIKTOK_PIXEL_ID: 'CKN3ABRC77U4JN785N60',
    TIKTOK_ACCESS_TOKEN: 'demo-token',
    TIKTOK_PAGE_URL_BASE: 'https://shop.example.com',
  });
  const originalPost = axios.post;
  let capturedRequest = null;

  axios.post = async (url, body, config) => {
    capturedRequest = { url, body, config };
    return {
      status: 200,
      data: {
        code: 0,
        message: 'ok',
      },
    };
  };

  try {
    const { sendToTikTok } = context.requireServer('services/tiktok');

    await sendToTikTok(
      {
        shopify_order_id: 'order_tiktok_identity_keys',
        created_at: '2026-04-02T07:27:50.414Z',
        total_price: 259170,
        currency: 'IDR',
        raw_payload: JSON.stringify({
          email: ' FadliKamalHuda.Shopee@example.com ',
          customer: {
            id: 998877,
          },
          shipping_address: {
            country_code: 'ID',
            phone: '0812 3456 7890',
          },
          line_items: [
            {
              title: 'Demo Shelf',
              quantity: 1,
              price: '259170.00',
              product_id: 'shelf-001',
            },
          ],
        }),
      },
      'E.C.P.v3fQ2RHacdksKfofPmlyuStIIHJ4Af1tKYxF9zz2c2PLx1Oaw15oHpcfl5AH',
      {
        visitor: {
          ip: '198.51.100.24',
          user_agent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 bytedancewebview Safari/604.1',
          product_id: '/products/demo-shelf',
          ttp: 'ttp_cookie_demo_003',
        },
      }
    );

    const user = capturedRequest.body.data[0].user;
    const sha256 = (value) =>
      crypto.createHash('sha256').update(value, 'utf8').digest('hex');

    assert.ok(capturedRequest);
    assert.equal(user.email, sha256('fadlikamalhuda.shopee@example.com'));
    assert.equal(user.phone, sha256('+6281234567890'));
    assert.equal(user.external_id, sha256('shopify_customer:998877'));
    assert.equal(user.ttp, 'ttp_cookie_demo_003');
  } finally {
    axios.post = originalPost;
    context.cleanup();
  }
});

test('sendToTikTok 遇到无法安全规范化的手机号时不会发送 phone', async () => {
  const context = createTestContext({
    TIKTOK_PIXEL_ID: 'CKN3ABRC77U4JN785N60',
    TIKTOK_ACCESS_TOKEN: 'demo-token',
    TIKTOK_PAGE_URL_BASE: 'https://shop.example.com',
  });
  const originalPost = axios.post;
  let capturedRequest = null;

  axios.post = async (url, body, config) => {
    capturedRequest = { url, body, config };
    return {
      status: 200,
      data: {
        code: 0,
        message: 'ok',
      },
    };
  };

  try {
    const { sendToTikTok } = context.requireServer('services/tiktok');

    await sendToTikTok(
      {
        shopify_order_id: 'order_tiktok_bad_phone',
        created_at: '2026-04-02T07:27:50.414Z',
        total_price: 259170,
        currency: 'IDR',
        raw_payload: JSON.stringify({
          email: 'demo@example.com',
          shipping_address: {
            country_code: 'ID',
            phone: 'abc-not-a-phone',
          },
        }),
      },
      'E.C.P.v3fQ2RHacdksKfofPmlyuStIIHJ4Af1tKYxF9zz2c2PLx1Oaw15oHpcfl5AH',
      {
        visitor: {
          ip: '198.51.100.24',
          user_agent: 'Mozilla/5.0 test browser',
          product_id: '/products/demo-shelf',
        },
      }
    );

    assert.ok(capturedRequest);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        capturedRequest.body.data[0].user,
        'phone'
      ),
      false
    );
  } finally {
    axios.post = originalPost;
    context.cleanup();
  }
});

test('sendToTikTok 在 payload.email 缺失时会回退使用 contact_email 作为 email 匹配键', async () => {
  const context = createTestContext({
    TIKTOK_PIXEL_ID: 'CKN3ABRC77U4JN785N60',
    TIKTOK_ACCESS_TOKEN: 'demo-token',
    TIKTOK_PAGE_URL_BASE: 'https://shop.example.com',
  });
  const originalPost = axios.post;
  let capturedRequest = null;

  axios.post = async (url, body, config) => {
    capturedRequest = { url, body, config };
    return {
      status: 200,
      data: {
        code: 0,
        message: 'ok',
      },
    };
  };

  try {
    const { sendToTikTok } = context.requireServer('services/tiktok');
    const sha256 = (value) =>
      crypto.createHash('sha256').update(value, 'utf8').digest('hex');

    await sendToTikTok(
      {
        shopify_order_id: 'order_tiktok_contact_email_fallback',
        created_at: '2026-04-02T07:27:50.414Z',
        total_price: 259170,
        currency: 'IDR',
        raw_payload: JSON.stringify({
          email: '    ',
          contact_email: '   contact.only@example.com  ',
          customer: {
            email: '',
          },
          shipping_address: {
            country_code: 'ID',
            phone: '******88',
          },
        }),
      },
      'E.C.P.contact_email_fallback',
      {
        visitor: {
          ip: '198.51.100.24',
          user_agent: 'Mozilla/5.0 test browser',
          product_id: '/products/demo-shelf',
        },
      }
    );

    assert.ok(capturedRequest);
    assert.equal(
      capturedRequest.body.data[0].user.email,
      sha256('contact.only@example.com')
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        capturedRequest.body.data[0].user,
        'phone'
      ),
      false
    );
  } finally {
    axios.post = originalPost;
    context.cleanup();
  }
});

test('sendToTikTok 不会把包含掩码星号的 email 当成有效匹配键', async () => {
  const context = createTestContext({
    TIKTOK_PIXEL_ID: 'CKN3ABRC77U4JN785N60',
    TIKTOK_ACCESS_TOKEN: 'demo-token',
    TIKTOK_PAGE_URL_BASE: 'https://shop.example.com',
  });
  const originalPost = axios.post;
  let capturedRequest = null;

  axios.post = async (url, body, config) => {
    capturedRequest = { url, body, config };
    return {
      status: 200,
      data: {
        code: 0,
        message: 'ok',
      },
    };
  };

  try {
    const { sendToTikTok } = context.requireServer('services/tiktok');

    await sendToTikTok(
      {
        shopify_order_id: 'order_tiktok_masked_email',
        created_at: '2026-04-02T07:27:50.414Z',
        total_price: 259170,
        currency: 'IDR',
        raw_payload: JSON.stringify({
          email: 'abc***@example.com',
          customer: {
            id: 887766,
          },
          shipping_address: {
            country_code: 'ID',
            phone: '******88',
          },
        }),
      },
      'E.C.P.masked_email',
      {
        visitor: {
          ip: '198.51.100.24',
          user_agent: 'Mozilla/5.0 test browser',
          product_id: '/products/demo-shelf',
        },
      }
    );

    assert.ok(capturedRequest);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        capturedRequest.body.data[0].user,
        'email'
      ),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        capturedRequest.body.data[0].user,
        'phone'
      ),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        capturedRequest.body.data[0].user,
        'external_id'
      ),
      true
    );
  } finally {
    axios.post = originalPost;
    context.cleanup();
  }
});

test('sendToTikTok 在 disabled 模式下会跳过 Purchase 回传并写入本地来源标签', async () => {
  const context = createTestContext({
    TIKTOK_PIXEL_ID: 'CKN3ABRC77U4JN785N60',
    TIKTOK_ACCESS_TOKEN: 'demo-token',
    TIKTOK_PURCHASE_MODE: 'disabled',
  });
  const originalPost = axios.post;
  let postCallCount = 0;

  axios.post = async () => {
    postCallCount += 1;
    return {
      status: 200,
      data: {
        code: 0,
        message: 'ok',
      },
    };
  };

  try {
    const { sendToTikTok } = context.requireServer('services/tiktok');

    const result = await sendToTikTok(
      {
        shopify_order_id: 'order_tiktok_disabled_mode',
        created_at: '2026-04-02T07:27:50.414Z',
        total_price: 259170,
        currency: 'IDR',
        raw_payload: JSON.stringify({}),
      },
      'E.C.P.disabled.click.id'
    );

    assert.equal(result.status, 'skipped');
    assert.equal(postCallCount, 0);
    assert.match(result.requestSummary, /"purchaseMode":"disabled"/);
    assert.match(result.requestSummary, /"purchaseSource":"self_hosted_backend"/);
  } finally {
    axios.post = originalPost;
    context.cleanup();
  }
});

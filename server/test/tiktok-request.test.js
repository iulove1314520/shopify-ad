const test = require('node:test');
const assert = require('node:assert/strict');

const axios = require('axios');

const { createTestContext } = require('./helpers/test-context');

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
    assert.equal(capturedRequest.body.pixel_code, 'CKN3ABRC77U4JN785N60');
    assert.equal(capturedRequest.body.event_source, 'web');
    assert.equal(capturedRequest.body.event_source_id, 'CKN3ABRC77U4JN785N60');
    assert.equal(capturedRequest.body.data.length, 1);
    assert.equal(capturedRequest.body.data[0].event, 'Purchase');
    assert.equal(capturedRequest.body.data[0].event_id, 'order_order_tiktok_001');
    assert.equal(capturedRequest.body.data[0].timestamp, 1775114870414);
    assert.equal(capturedRequest.body.data[0].event_time, 1775114870);
    assert.equal(capturedRequest.body.data[0].context.ip, '198.51.100.24');
    assert.equal(
      capturedRequest.body.data[0].context.user_agent,
      'Mozilla/5.0 test browser'
    );
    assert.equal(
      capturedRequest.body.data[0].context.page.url,
      'https://shop.example.com/products/demo-shelf'
    );
    assert.equal(
      capturedRequest.body.data[0].context.ad.callback,
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

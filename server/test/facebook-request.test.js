const test = require('node:test');
const assert = require('node:assert/strict');

const axios = require('axios');

const { createTestContext } = require('./helpers/test-context');

test('buildFacebookRequestPayload 会构建稳定的 Purchase payload', () => {
  const context = createTestContext();

  try {
    const { env } = context.requireServer('config/env');
    const { buildFacebookRequestPayload } = context.requireServer('services/facebook-request');

    const payload = buildFacebookRequestPayload(
      {
        shopify_order_id: 'order_fb_builder_001',
        created_at: '2026-04-02T07:27:50.414Z',
        total_price: 259170,
        currency: 'IDR',
        raw_payload: JSON.stringify({
          line_items: [
            {
              product_id: 'demo-product-001',
              quantity: 2,
              price: '129585.00',
            },
          ],
        }),
      },
      'fbclid-demo-builder',
      {
        visitor: {
          ip: '198.51.100.24',
          user_agent: 'Mozilla/5.0 builder browser',
        },
      },
      env
    );

    assert.equal(payload.data[0].event_name, 'Purchase');
    assert.equal(payload.data[0].event_id, 'order_order_fb_builder_001');
    assert.equal(payload.data[0].action_source, 'website');
    assert.equal(payload.data[0].user_data.fbc, 'fbclid-demo-builder');
    assert.equal(payload.data[0].user_data.client_ip_address, '198.51.100.24');
    assert.equal(
      payload.data[0].user_data.client_user_agent,
      'Mozilla/5.0 builder browser'
    );
    assert.equal(payload.data[0].custom_data.currency, 'IDR');
    assert.equal(payload.data[0].custom_data.value, 259170);
    assert.equal(payload.data[0].custom_data.contents[0].id, 'demo-product-001');
  } finally {
    context.cleanup();
  }
});

test('sendToFacebook 会优先选择信息更完整的 User-Agent 作为回传上下文', async () => {
  const context = createTestContext({
    FACEBOOK_PIXEL_ID: '1234567890',
    FACEBOOK_ACCESS_TOKEN: 'demo-token',
  });
  const originalPost = axios.post;
  let capturedRequest = null;

  axios.post = async (url, body, config) => {
    capturedRequest = { url, body, config };
    return {
      status: 200,
      data: {
        events_received: 1,
      },
    };
  };

  try {
    const { sendToFacebook } = context.requireServer('services/facebook');

    const result = await sendToFacebook(
      {
        shopify_order_id: 'order_fb_ua_choice',
        created_at: '2026-04-02T07:27:50.414Z',
        total_price: 259170,
        currency: 'IDR',
        raw_payload: JSON.stringify({
          client_details: {
            user_agent:
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
          },
        }),
      },
      'fbclid-demo-001',
      {
        visitor: {
          ip: '198.51.100.24',
          user_agent: 'Mozilla/5.0',
        },
      }
    );

    assert.equal(result.status, 'success');
    assert.ok(capturedRequest);
    assert.equal(
      capturedRequest.body.data[0].user_data.client_user_agent,
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
    );
  } finally {
    axios.post = originalPost;
    context.cleanup();
  }
});

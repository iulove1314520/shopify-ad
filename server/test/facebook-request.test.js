const test = require('node:test');
const assert = require('node:assert/strict');

const axios = require('axios');

const { createTestContext } = require('./helpers/test-context');

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

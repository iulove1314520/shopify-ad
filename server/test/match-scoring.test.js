const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext } = require('./helpers/test-context');

test('多条件评分会优先选中商品和 IP 都更接近的访客', () => {
  const context = createTestContext();

  try {
    const { rankVisitorCandidates } = context.requireServer('utils/match-scoring');

    const order = {
      created_at: '2026-03-28T02:00:00.000Z',
      raw_payload: JSON.stringify({
        line_items: [
          {
            product_id: 'demo-shirt',
            title: 'Demo Shirt',
          },
        ],
        client_details: {
          browser_ip: '8.8.8.8',
        },
      }),
      zip: '',
    };

    const ranked = rankVisitorCandidates(order, [
      {
        id: 1,
        ttclid: 'ttclid_best',
        fbclid: '',
        ip: '8.8.8.8',
        timestamp: '2026-03-28T01:30:00.000Z',
        product_id: '/products/demo-shirt',
      },
      {
        id: 2,
        ttclid: 'ttclid_weaker',
        fbclid: '',
        ip: '1.1.1.1',
        timestamp: '2026-03-28T01:40:00.000Z',
        product_id: '/products/other-item',
      },
    ]);

    assert.equal(ranked[0].visitor.id, 1);
    assert.ok(ranked[0].score > ranked[1].score);
    assert.equal(ranked[0].productMatched, true);
    assert.equal(ranked[0].exactIpMatched, true);
    assert.ok(ranked[0].signals.includes('product_match'));
    assert.ok(ranked[0].signals.includes('browser_ip_exact'));
  } finally {
    context.cleanup();
  }
});

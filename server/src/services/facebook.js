const axios = require('axios');

const { env } = require('../config/env');

function summarize(value) {
  if (value === undefined || value === null) {
    return '';
  }

  const stringified =
    typeof value === 'string' ? value : JSON.stringify(value, null, 0);

  return stringified.slice(0, 1000);
}

async function sendToFacebook(order, fbclid) {
  if (!env.facebookPixelId || !env.facebookAccessToken) {
    return {
      platform: 'Facebook',
      status: 'skipped',
      responseSummary: 'Facebook credentials are missing',
      errorMessage: '',
    };
  }

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${env.facebookPixelId}/events`,
      {
        data: [
          {
            event_name: 'Purchase',
            event_time: Math.floor(new Date(order.created_at).getTime() / 1000),
            action_source: 'website',
            user_data: {
              fbc: fbclid,
            },
            custom_data: {
              currency: order.currency,
              value: Number(order.total_price || 0),
            },
          },
        ],
        access_token: env.facebookAccessToken,
      },
      {
        timeout: env.requestTimeoutMs,
      }
    );

    return {
      platform: 'Facebook',
      status: 'success',
      responseSummary: summarize(response.data),
      errorMessage: '',
    };
  } catch (error) {
    return {
      platform: 'Facebook',
      status: 'failed',
      responseSummary: summarize(error.response?.data),
      errorMessage: error.message,
    };
  }
}

module.exports = { sendToFacebook };


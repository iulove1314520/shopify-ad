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

async function sendToTikTok(order, ttclid) {
  if (!env.tiktokPixelId || !env.tiktokAccessToken) {
    return {
      platform: 'TikTok',
      status: 'skipped',
      responseSummary: 'TikTok credentials are missing',
      errorMessage: '',
    };
  }

  try {
    const response = await axios.post(
      env.tiktokApiUrl,
      {
        pixel_code: env.tiktokPixelId,
        event: 'Purchase',
        event_time: Math.floor(new Date(order.created_at).getTime() / 1000),
        properties: {
          currency: order.currency,
          value: Number(order.total_price || 0),
        },
        context: {
          ad: {
            callback: ttclid,
          },
        },
      },
      {
        headers: {
          'Access-Token': env.tiktokAccessToken,
          'Content-Type': 'application/json',
        },
        timeout: env.requestTimeoutMs,
      }
    );

    return {
      platform: 'TikTok',
      status: 'success',
      responseSummary: summarize(response.data),
      errorMessage: '',
    };
  } catch (error) {
    return {
      platform: 'TikTok',
      status: 'failed',
      responseSummary: summarize(error.response?.data),
      errorMessage: error.message,
    };
  }
}

module.exports = { sendToTikTok };


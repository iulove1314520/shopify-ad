const { env } = require('../../config/env');
const { db } = require('../../db/client');
const { sleep } = require('../../services/callback-utils');
const { sendToTikTok } = require('../../services/tiktok');
const { sendToFacebook } = require('../../services/facebook');
const { logInfo, logWarn, withTraceId } = require('../../utils/logger');

function resolveSender(
  platform,
  senders = {},
  defaultSenders = {
    TikTok: sendToTikTok,
    Facebook: sendToFacebook,
  }
) {
  if (typeof senders?.[platform] === 'function') {
    return senders[platform];
  }

  return defaultSenders[platform];
}

function getNextAttemptNumber(dbClient, orderId, platform) {
  return dbClient
    .transaction((currentOrderId, currentPlatform) => {
      const row = dbClient
        .prepare(
          `
            SELECT COALESCE(MAX(attempt_number), 0) AS max_attempt
            FROM callbacks
            WHERE order_id = ? AND platform = ?
          `
        )
        .get(currentOrderId, currentPlatform);

      return Number(row?.max_attempt || 0) + 1;
    })(orderId, platform);
}

function saveCallback(dbClient, order, callbackResult, triggerSource, traceId = '') {
  dbClient
    .prepare(
      `
        INSERT INTO callbacks (
          order_id,
          shopify_order_id,
          platform,
          trigger_source,
          trace_id,
          attempt_number,
          status,
          retryable,
          http_status,
          request_summary,
          response_summary,
          error_message,
          callback_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      order.id,
      order.shopify_order_id,
      callbackResult.platform,
      triggerSource,
      traceId,
      callbackResult.attemptNumber,
      callbackResult.status,
      callbackResult.retryable ? 1 : 0,
      callbackResult.httpStatus,
      callbackResult.requestSummary || '',
      callbackResult.responseSummary || '',
      callbackResult.errorMessage || '',
      new Date().toISOString()
    );
}

function isSqliteUniqueConstraintError(error) {
  const message = String(error?.message || '');
  return (
    message.includes('UNIQUE constraint failed') &&
    message.includes('callbacks.order_id') &&
    message.includes('callbacks.platform') &&
    message.includes('callbacks.attempt_number')
  );
}

async function dispatchCallback({
  order,
  platform,
  clickId,
  triggerSource,
  traceId = '',
  env: runtimeEnv = env,
  senders = {},
  callbackContext = {},
  dbClient = db,
  getNextAttemptNumber: injectedGetNextAttemptNumber,
  getNextAttemptNumberFn,
  saveCallback: injectedSaveCallback,
  saveCallbackFn,
  logInfoFn = logInfo,
  logWarnFn = logWarn,
  withTraceIdFn = withTraceId,
  sleepFn = sleep,
  defaultSenders = {
    TikTok: sendToTikTok,
    Facebook: sendToFacebook,
  },
}) {
  const sender = resolveSender(platform, senders, defaultSenders);
  const maxAttempts = Math.max(1, runtimeEnv.callbackMaxAttempts);
  const nextAttemptNumber = getNextAttemptNumberFn
    || injectedGetNextAttemptNumber
    || ((orderId, callbackPlatform) => getNextAttemptNumber(dbClient, orderId, callbackPlatform));
  const persistCallback = saveCallbackFn
    || injectedSaveCallback
    || ((currentOrder, callbackResult, source, currentTraceId) => saveCallback(
      dbClient,
      currentOrder,
      callbackResult,
      source,
      currentTraceId
    ));
  let finalResult = null;

  for (let index = 0; index < maxAttempts; index += 1) {
    const rawResult = await sender(order, clickId, callbackContext);
    let callbackResult = null;

    // Concurrent retries for the same order/platform can race.
    // Retry local attempt allocation when unique attempt_number conflicts happen.
    for (let persistRetry = 0; persistRetry < 3; persistRetry += 1) {
      callbackResult = {
        ...rawResult,
        attemptNumber: nextAttemptNumber(order.id, platform),
      };

      try {
        persistCallback(order, callbackResult, triggerSource, traceId);
        break;
      } catch (error) {
        if (!isSqliteUniqueConstraintError(error) || persistRetry === 2) {
          throw error;
        }
      }
    }

    if (!callbackResult) {
      throw new Error('failed to persist callback result');
    }
    finalResult = callbackResult;

    const logDetails = withTraceIdFn(traceId, {
      orderId: order.shopify_order_id,
      platform,
      triggerSource,
      attemptNumber: callbackResult.attemptNumber,
      status: callbackResult.status,
      retryable: callbackResult.retryable,
      httpStatus: callbackResult.httpStatus,
      failureCode: callbackResult.failureCode || '',
    });

    if (callbackResult.status === 'success') {
      logInfoFn('callback.sent', logDetails);
      break;
    }

    if (callbackResult.status === 'skipped') {
      logWarnFn('callback.skipped', {
        ...logDetails,
        reason: callbackResult.errorMessage,
      });
      break;
    }

    logWarnFn('callback.failed', {
      ...logDetails,
      errorMessage: callbackResult.errorMessage,
    });

    if (!callbackResult.retryable || index === maxAttempts - 1) {
      break;
    }

    await sleepFn(runtimeEnv.callbackRetryDelayMs);
  }

  return finalResult;
}

module.exports = {
  dispatchCallback,
  getNextAttemptNumber,
  resolveSender,
  saveCallback,
};

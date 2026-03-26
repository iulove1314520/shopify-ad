const geoip = require('geoip-lite');

const { env } = require('../config/env');
const { db } = require('../db/client');
const { sendToTikTok } = require('../services/tiktok');
const { sendToFacebook } = require('../services/facebook');

function getConfidence(timeDiffMs, ip) {
  let confidence = '低';

  if (timeDiffMs < 24 * 60 * 60 * 1000) {
    confidence = '高';
  } else if (timeDiffMs < 48 * 60 * 60 * 1000) {
    confidence = '中';
  }

  const geo = ip ? geoip.lookup(ip) : null;
  if (!geo && confidence === '高') {
    confidence = '中';
  }

  return confidence;
}

function findBestVisitor(orderCreatedAt) {
  const orderTime = new Date(orderCreatedAt).getTime();
  const windowStart = new Date(
    orderTime - env.matchWindowDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const candidates = db
    .prepare(
      `
        SELECT
          id,
          ttclid,
          fbclid,
          ip,
          timestamp,
          product_id
        FROM visitors
        WHERE
          (ttclid <> '' OR fbclid <> '')
          AND timestamp >= ?
          AND timestamp <= ?
        ORDER BY timestamp DESC
      `
    )
    .all(windowStart, orderCreatedAt);

  let bestVisitor = null;
  let bestTimeDiffMs = Number.POSITIVE_INFINITY;

  for (const visitor of candidates) {
    const timeDiffMs = orderTime - new Date(visitor.timestamp).getTime();
    if (timeDiffMs < 0 || timeDiffMs > bestTimeDiffMs) {
      continue;
    }

    bestVisitor = visitor;
    bestTimeDiffMs = timeDiffMs;
  }

  if (!bestVisitor) {
    return null;
  }

  return {
    visitor: bestVisitor,
    timeDiffMs: bestTimeDiffMs,
  };
}

function saveCallback(order, callbackResult) {
  db.prepare(
    `
      INSERT INTO callbacks (
        order_id,
        shopify_order_id,
        platform,
        status,
        response_summary,
        error_message,
        callback_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    order.id,
    order.shopify_order_id,
    callbackResult.platform,
    callbackResult.status,
    callbackResult.responseSummary,
    callbackResult.errorMessage,
    new Date().toISOString()
  );
}

async function matchOrder(order) {
  const bestMatch = findBestVisitor(order.created_at);

  if (!bestMatch) {
    db.prepare(
      'UPDATE orders SET status = ?, processed_at = ? WHERE id = ?'
    ).run('unmatched', new Date().toISOString(), order.id);

    return { matched: false };
  }

  const platform = bestMatch.visitor.ttclid ? 'TikTok' : 'Facebook';
  const clickId = bestMatch.visitor.ttclid || bestMatch.visitor.fbclid;
  const confidence = getConfidence(bestMatch.timeDiffMs, bestMatch.visitor.ip);

  db.prepare(
    `
      INSERT INTO matches (
        order_id,
        visitor_id,
        shopify_order_id,
        click_id,
        platform,
        confidence,
        match_time,
        time_diff_seconds
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    order.id,
    bestMatch.visitor.id,
    order.shopify_order_id,
    clickId,
    platform,
    confidence,
    new Date().toISOString(),
    Math.round(bestMatch.timeDiffMs / 1000)
  );

  const callbackResult =
    platform === 'TikTok'
      ? await sendToTikTok(order, clickId)
      : await sendToFacebook(order, clickId);

  saveCallback(order, callbackResult);

  let nextStatus = 'callback_failed';
  if (callbackResult.status === 'success') {
    nextStatus = 'callback_sent';
  } else if (callbackResult.status === 'skipped') {
    nextStatus = 'matched_no_callback';
  }

  db.prepare(
    'UPDATE orders SET status = ?, processed_at = ? WHERE id = ?'
  ).run(nextStatus, new Date().toISOString(), order.id);

  return {
    matched: true,
    platform,
    confidence,
    callbackStatus: callbackResult.status,
  };
}

function listMatches(req, res, next) {
  try {
    const rows = db
      .prepare(
        `
          SELECT
            shopify_order_id AS order_id,
            click_id,
            platform,
            confidence,
            match_time,
            time_diff_seconds
          FROM matches
          ORDER BY match_time DESC
          LIMIT 200
        `
      )
      .all();

    res.json(rows);
  } catch (error) {
    next(error);
  }
}

function listCallbacks(req, res, next) {
  try {
    const rows = db
      .prepare(
        `
          SELECT
            shopify_order_id AS order_id,
            platform,
            status,
            response_summary,
            error_message,
            callback_time
          FROM callbacks
          ORDER BY callback_time DESC
          LIMIT 200
        `
      )
      .all();

    res.json(rows);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  matchOrder,
  listMatches,
  listCallbacks,
};


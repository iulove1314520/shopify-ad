const { env } = require('../config/env');
const { db } = require('../db/client');
const { buildSystemDetail: buildSystemDetailRecord, countTable, summarizeByStatus } = require('./system/detail');
const {
  assertPurgeAllConfirmation,
  resolveCleanupRetentionDays,
} = require('./system/retention');
const { cleanupOldDataRecords: cleanupOldDataRecordsWithDeps } = require('./system/cleanup');
const { purgeAllDataRecords: purgeAllDataRecordsWithDeps } = require('./system/purge');

function buildSystemDetail() {
  return buildSystemDetailRecord();
}

function cleanupOldDataRecords(options = {}) {
  return cleanupOldDataRecordsWithDeps({
    db,
    env,
    options,
  });
}

function purgeAllDataRecords() {
  return purgeAllDataRecordsWithDeps({ db });
}

function getHealth(req, res, next) {
  try {
    const detail = buildSystemDetail();

    res.json({
      ok: detail.ok,
      service: detail.service,
      environment: detail.environment,
      timestamp: detail.timestamp,
    });
  } catch (error) {
    next(error);
  }
}

function getSystemDetail(req, res, next) {
  try {
    res.json(buildSystemDetail());
  } catch (error) {
    next(error);
  }
}

function cleanupOldData(req, res, next) {
  try {
    if (req.body?.confirm !== true) {
      res.status(400).json({
        error: 'Bad Request',
        message: '请在请求体中传入 {"confirm": true}，确认后再清理旧数据。',
      });
      return;
    }

    const retention = resolveCleanupRetentionDays({
      visitorRetentionDays: req.body?.visitorRetentionDays,
      businessRetentionDays: req.body?.businessRetentionDays,
    });
    const result = cleanupOldDataRecords(retention);
    res.json({
      ok: true,
      message: '旧数据清理完成。',
      result,
    });
  } catch (error) {
    if (error.statusCode === 400) {
      res.status(400).json({
        error: 'Bad Request',
        message: error.message,
      });
      return;
    }

    next(error);
  }
}

function purgeAllData(req, res, next) {
  try {
    assertPurgeAllConfirmation(req.body);

    const result = purgeAllDataRecords();
    res.json({
      ok: true,
      message: '全部数据已清空。',
      result,
    });
  } catch (error) {
    if (error.statusCode === 400) {
      res.status(400).json({
        error: 'Bad Request',
        message: error.message,
      });
      return;
    }

    next(error);
  }
}

function getStats(req, res, next) {
  try {
    res.json({
      generated_at: new Date().toISOString(),
      counts: {
        visitors: countTable(db, 'visitors'),
        orders: countTable(db, 'orders'),
        matches: countTable(db, 'matches'),
        callbacks: countTable(db, 'callbacks'),
        webhook_events: countTable(db, 'webhook_events'),
      },
      orders_by_status: summarizeByStatus(db, 'orders'),
      callbacks_by_status: summarizeByStatus(db, 'callbacks'),
      webhook_events_by_status: summarizeByStatus(db, 'webhook_events'),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  assertPurgeAllConfirmation,
  buildSystemDetail,
  cleanupOldData,
  cleanupOldDataRecords,
  getHealth,
  getStats,
  getSystemDetail,
  purgeAllData,
  purgeAllDataRecords,
  resolveCleanupRetentionDays,
};

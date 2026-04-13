const { env } = require('../../config/env');

const CLEANUP_RETENTION_MIN_DAYS = 1;
const CLEANUP_RETENTION_MAX_DAYS = 3650;
const PURGE_ALL_CONFIRM_TEXT = '清空全部数据';

function createBadRequestError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function getRetentionPolicy(runtimeEnv = env) {
  return {
    visitors_days: runtimeEnv.visitorRetentionDays,
    business_days: runtimeEnv.businessDataRetentionDays,
  };
}

function getCleanupLimits() {
  return {
    min_days: CLEANUP_RETENTION_MIN_DAYS,
    max_days: CLEANUP_RETENTION_MAX_DAYS,
  };
}

function getDangerousActions() {
  return {
    purge_all_confirm_text: PURGE_ALL_CONFIRM_TEXT,
  };
}

function readRetentionDays(value, fallback, label) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (
    !Number.isInteger(parsed)
    || parsed < CLEANUP_RETENTION_MIN_DAYS
    || parsed > CLEANUP_RETENTION_MAX_DAYS
  ) {
    throw createBadRequestError(
      `${label}需为 ${CLEANUP_RETENTION_MIN_DAYS}-${CLEANUP_RETENTION_MAX_DAYS} 之间的整数天数。`
    );
  }

  return parsed;
}

function resolveCleanupRetentionDays(options = {}, runtimeEnv = env) {
  return {
    visitorRetentionDays: readRetentionDays(
      options.visitorRetentionDays,
      runtimeEnv.visitorRetentionDays,
      '访客数据保留天数'
    ),
    businessRetentionDays: readRetentionDays(
      options.businessRetentionDays,
      runtimeEnv.businessDataRetentionDays,
      '业务数据保留天数'
    ),
  };
}

function assertPurgeAllConfirmation(body = {}) {
  if (body?.confirm !== true) {
    throw createBadRequestError(
      '请在请求体中传入 {"confirm": true}，确认后再清空全部数据。'
    );
  }

  if (String(body?.confirmText || '').trim() !== PURGE_ALL_CONFIRM_TEXT) {
    throw createBadRequestError(
      `清空全部数据前，请输入确认文本：${PURGE_ALL_CONFIRM_TEXT}`
    );
  }
}

module.exports = {
  assertPurgeAllConfirmation,
  createBadRequestError,
  getCleanupLimits,
  getDangerousActions,
  getRetentionPolicy,
  resolveCleanupRetentionDays,
};

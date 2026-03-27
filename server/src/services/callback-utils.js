function summarize(value, limit = 1000) {
  if (value === undefined || value === null) {
    return '';
  }

  const stringified =
    typeof value === 'string' ? value : JSON.stringify(value, null, 0);

  return String(stringified).slice(0, limit);
}

function maskValue(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if (text.length <= 8) {
    return `${text.slice(0, 2)}***${text.slice(-2)}`;
  }

  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function getHttpStatus(error) {
  const status = Number(error?.response?.status);
  return Number.isFinite(status) ? status : null;
}

function extractErrorMessage(error) {
  const data = error?.response?.data;

  if (typeof data === 'string' && data.trim()) {
    return data.trim().slice(0, 300);
  }

  if (data && typeof data === 'object') {
    const candidate = [
      data.message,
      data.msg,
      data.error,
      data.error_message,
      data.description,
    ].find((value) => typeof value === 'string' && value.trim());

    if (candidate) {
      return candidate.trim().slice(0, 300);
    }
  }

  return String(error?.message || 'Unknown callback error')
    .trim()
    .slice(0, 300);
}

function classifyFailure(error) {
  const status = getHttpStatus(error);
  const code = String(error?.code || '').toUpperCase();

  if (status === 408) {
    return { failureCode: 'http_timeout', retryable: true, httpStatus: status };
  }

  if (status === 429) {
    return {
      failureCode: 'rate_limited',
      retryable: true,
      httpStatus: status,
    };
  }

  if (status >= 500) {
    return {
      failureCode: `http_${status}`,
      retryable: true,
      httpStatus: status,
    };
  }

  if (status >= 400) {
    return {
      failureCode: `http_${status}`,
      retryable: false,
      httpStatus: status,
    };
  }

  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
    return { failureCode: 'timeout', retryable: true, httpStatus: null };
  }

  if (['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code)) {
    return { failureCode: 'network_error', retryable: true, httpStatus: null };
  }

  return { failureCode: 'request_failed', retryable: false, httpStatus: status };
}

function createSkippedResult(platform, responseSummary, requestSummary, failureCode) {
  return {
    platform,
    status: 'skipped',
    responseSummary,
    errorMessage: responseSummary,
    requestSummary,
    failureCode,
    httpStatus: null,
    retryable: false,
  };
}

function createSuccessResult(platform, response, requestSummary) {
  return {
    platform,
    status: 'success',
    responseSummary: summarize(response?.data),
    errorMessage: '',
    requestSummary,
    failureCode: '',
    httpStatus: Number(response?.status || 200),
    retryable: false,
  };
}

function createFailureResult(platform, error, requestSummary) {
  const failure = classifyFailure(error);

  return {
    platform,
    status: 'failed',
    responseSummary: summarize(error?.response?.data),
    errorMessage: extractErrorMessage(error),
    requestSummary,
    failureCode: failure.failureCode,
    httpStatus: failure.httpStatus,
    retryable: failure.retryable,
  };
}

function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

module.exports = {
  summarize,
  maskValue,
  createSkippedResult,
  createSuccessResult,
  createFailureResult,
  sleep,
};

function normalizeClickId(value) {
  return String(value || '').trim();
}

function isPlaceholderClickId(value) {
  return normalizeClickId(value).toUpperCase() === '__CLICKID__';
}

function classifyVisitorTraffic(row = {}) {
  const reasons = [];

  if (isPlaceholderClickId(row.ttclid)) {
    reasons.push('TTCLID 为 __CLICKID__ 占位符');
  }

  if (isPlaceholderClickId(row.fbclid)) {
    reasons.push('FBCLID 为 __CLICKID__ 占位符');
  }

  if (reasons.length > 0) {
    return {
      isTestTraffic: true,
      trafficLabel: '测试流量',
      trafficReason: reasons.join('；'),
    };
  }

  return {
    isTestTraffic: false,
    trafficLabel: '广告流量',
    trafficReason: '',
  };
}

module.exports = {
  classifyVisitorTraffic,
  isPlaceholderClickId,
};

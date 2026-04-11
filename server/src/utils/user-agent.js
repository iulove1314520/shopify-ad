function normalizeUserAgent(value) {
  return String(value || '').trim();
}

function detectDeviceAndOs(lowered) {
  if (lowered.includes('iphone')) {
    return { device: 'iPhone', os: 'iOS', score: 3 };
  }

  if (lowered.includes('ipad')) {
    return { device: 'iPad', os: 'iPadOS', score: 3 };
  }

  if (lowered.includes('ipod')) {
    return { device: 'iPod', os: 'iOS', score: 3 };
  }

  if (lowered.includes('android')) {
    const isTablet = !lowered.includes('mobile');
    return {
      device: isTablet ? 'Android 平板' : 'Android 手机',
      os: 'Android',
      score: 3,
    };
  }

  if (lowered.includes('windows nt')) {
    return { device: 'Desktop', os: 'Windows', score: 2 };
  }

  if (lowered.includes('macintosh') || lowered.includes('mac os x')) {
    return { device: 'Mac', os: 'macOS', score: 2 };
  }

  if (lowered.includes('linux')) {
    return { device: 'Desktop', os: 'Linux', score: 1 };
  }

  return { device: '未知设备', os: '未知系统', score: 0 };
}

function detectBrowser(lowered) {
  if (
    lowered.includes('bytedancewebview') ||
    lowered.includes('ttwebview') ||
    lowered.includes('tiktok') ||
    lowered.includes('musical_ly') ||
    lowered.includes('trill')
  ) {
    return {
      browser: 'TikTok 内置浏览器',
      app: 'TikTok',
      score: 6,
      risk: '',
    };
  }

  if (lowered.includes('instagram')) {
    return {
      browser: 'Instagram 内置浏览器',
      app: 'Instagram',
      score: 6,
      risk: '',
    };
  }

  if (lowered.includes('messengerforios') || lowered.includes('messenger')) {
    return {
      browser: 'Messenger 内置浏览器',
      app: 'Messenger',
      score: 5,
      risk: '',
    };
  }

  if (lowered.includes('fban') || lowered.includes('fbav')) {
    return {
      browser: 'Facebook 内置浏览器',
      app: 'Facebook',
      score: 5,
      risk: '',
    };
  }

  if (lowered.includes('samsungbrowser/')) {
    return { browser: 'Samsung Internet', app: '', score: 4, risk: '' };
  }

  if (lowered.includes('edg/')) {
    return { browser: 'Edge', app: '', score: 4, risk: '' };
  }

  if (lowered.includes('opr/') || lowered.includes('opera')) {
    return { browser: 'Opera', app: '', score: 4, risk: '' };
  }

  if (lowered.includes('fxios/') || lowered.includes('firefox/')) {
    return { browser: 'Firefox', app: '', score: 4, risk: '' };
  }

  if (lowered.includes('; wv') || lowered.includes(' wv)')) {
    return {
      browser: 'Android WebView',
      app: '',
      score: 2,
      risk: '通用 WebView，准确性有限',
    };
  }

  if (lowered.includes('crios/') || lowered.includes('chrome/')) {
    return { browser: 'Chrome', app: '', score: 4, risk: '' };
  }

  if (lowered.includes('version/') && lowered.includes('safari/')) {
    return { browser: 'Safari', app: '', score: 4, risk: '' };
  }

  if (lowered === 'mozilla/5.0' || lowered === 'mozilla/5.0 ') {
    return {
      browser: '通用浏览器',
      app: '',
      score: 1,
      risk: 'UA 信息过少',
    };
  }

  if (lowered.includes('mozilla/5.0')) {
    return {
      browser: '通用浏览器',
      app: '',
      score: 1,
      risk: 'UA 信息不完整，识别结果有限',
    };
  }

  return {
    browser: '未知浏览器',
    app: '',
    score: 0,
    risk: '无法识别浏览器特征',
  };
}

function analyzeUserAgent(value) {
  const raw = normalizeUserAgent(value);

  if (!raw) {
    return {
      raw: '',
      device: '未捕获',
      os: '未捕获',
      browser: '未捕获',
      app: '',
      summary: '未捕获 User-Agent',
      risk: '请求中没有可用的 User-Agent',
      confidence: 'low',
      score: 0,
      isBot: false,
    };
  }

  const lowered = raw.toLowerCase();
  const isBot = /(bot|crawler|spider|uptimerobot|headlesschrome|python-requests|curl\/|wget\/)/i.test(
    raw
  );

  if (isBot) {
    return {
      raw,
      device: '疑似机器人',
      os: '未知系统',
      browser: '机器人/监控程序',
      app: '',
      summary: '疑似机器人 · 机器人/监控程序',
      risk: '该 UA 看起来像监控、爬虫或脚本流量',
      confidence: 'low',
      score: -10,
      isBot: true,
    };
  }

  const deviceAndOs = detectDeviceAndOs(lowered);
  const browser = detectBrowser(lowered);
  const score = deviceAndOs.score + browser.score;
  const confidence = score >= 8 ? 'high' : score >= 5 ? 'medium' : 'low';

  return {
    raw,
    device: deviceAndOs.device,
    os: deviceAndOs.os,
    browser: browser.browser,
    app: browser.app,
    summary: [deviceAndOs.device, deviceAndOs.os, browser.browser].join(' · '),
    risk: browser.risk,
    confidence,
    score,
    isBot: false,
  };
}

function pickBestUserAgent(candidates = []) {
  const sourcePriority = {
    visitor: 4,
    client_details_user_agent: 3,
    client_details_browser_user_agent: 2,
    client_details_http_user_agent: 1,
    payload_user_agent: 0,
  };

  const ranked = candidates
    .map((candidate) => {
      const value = normalizeUserAgent(candidate?.value);
      if (!value) {
        return null;
      }

      const profile = analyzeUserAgent(value);
      return {
        value,
        source: String(candidate?.source || ''),
        profile,
        rankScore:
          profile.score * 10 +
          (sourcePriority[String(candidate?.source || '')] || 0),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.rankScore - left.rankScore);

  if (ranked.length === 0) {
    return {
      value: '',
      source: '',
      profile: analyzeUserAgent(''),
    };
  }

  return {
    value: ranked[0].value,
    source: ranked[0].source,
    profile: ranked[0].profile,
  };
}

module.exports = {
  analyzeUserAgent,
  normalizeUserAgent,
  pickBestUserAgent,
};

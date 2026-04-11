const crypto = require('node:crypto');

function normalizeText(value) {
  return String(value || '').trim();
}

function hashSha256(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }

  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function mapCountryDialCode(countryCode) {
  switch (String(countryCode || '').trim().toUpperCase()) {
    case 'ID':
      return '62';
    case 'US':
    case 'CA':
      return '1';
    default:
      return '';
  }
}

function normalizePhone(value, countryCode = '') {
  const raw = normalizeText(value);
  if (!raw) {
    return '';
  }

  const compact = raw.replace(/[^\d+]/g, '');
  if (!compact) {
    return '';
  }

  let normalized = compact;

  if (normalized.startsWith('00')) {
    normalized = `+${normalized.slice(2)}`;
  } else if (normalized.startsWith('+')) {
    normalized = `+${normalized.slice(1).replace(/\D/g, '')}`;
  } else {
    const digitsOnly = normalized.replace(/\D/g, '');
    const dialCode = mapCountryDialCode(countryCode);

    if (dialCode && digitsOnly.startsWith('0')) {
      normalized = `+${dialCode}${digitsOnly.slice(1)}`;
    } else if (dialCode && digitsOnly.startsWith(dialCode)) {
      normalized = `+${digitsOnly}`;
    } else {
      return '';
    }
  }

  if (!/^\+\d{8,15}$/.test(normalized)) {
    return '';
  }

  return normalized;
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) {
      return text;
    }
  }

  return '';
}

function buildExternalId(payload = {}) {
  const customer =
    payload?.customer && typeof payload.customer === 'object'
      ? payload.customer
      : {};

  const customerId = normalizeText(customer.id);
  if (customerId) {
    return `shopify_customer:${customerId}`;
  }

  const customerEmail = normalizeEmail(customer.email || payload.email);
  if (customerEmail) {
    return `shopify_email:${customerEmail}`;
  }

  const customerPhone = normalizePhone(
    customer.phone ||
      payload.phone ||
      payload?.shipping_address?.phone ||
      payload?.billing_address?.phone,
    payload?.shipping_address?.country_code || payload?.billing_address?.country_code
  );
  if (customerPhone) {
    return `shopify_phone:${customerPhone}`;
  }

  return '';
}

function buildHashedMatchKeys(payload = {}, visitor = null) {
  const shippingAddress =
    payload?.shipping_address && typeof payload.shipping_address === 'object'
      ? payload.shipping_address
      : {};
  const billingAddress =
    payload?.billing_address && typeof payload.billing_address === 'object'
      ? payload.billing_address
      : {};
  const customer =
    payload?.customer && typeof payload.customer === 'object'
      ? payload.customer
      : {};

  const email = normalizeEmail(
    pickFirstText(payload.email, customer.email, payload.contact_email)
  );
  const phone = normalizePhone(
    pickFirstText(
      payload.phone,
      customer.phone,
      shippingAddress.phone,
      billingAddress.phone
    ),
    pickFirstText(shippingAddress.country_code, billingAddress.country_code)
  );
  const externalId = normalizeText(buildExternalId(payload));
  const ttp = normalizeText(visitor?.ttp);

  const user = {};

  if (email) {
    user.email = hashSha256(email);
  }

  if (phone) {
    user.phone_number = hashSha256(phone);
  }

  if (externalId) {
    user.external_id = hashSha256(externalId);
  }

  if (ttp) {
    user.ttp = ttp;
  }

  return user;
}

module.exports = {
  buildExternalId,
  buildHashedMatchKeys,
  hashSha256,
  normalizeEmail,
  normalizePhone,
};

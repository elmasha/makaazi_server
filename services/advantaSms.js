// services/advantaSms.js
const axios = require('axios');
const db = require('../config/db');

// ============================================================
// Config loader — DB first, env fallback, 60s cache
// ============================================================
const CACHE_TTL_MS = 60_000;
let _cache = null;
let _cacheAt = 0;

async function loadSmsConfig() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;

  const cfg = {
    apiKey:    process.env.ADVANTA_API_KEY    || '',
    partnerId: process.env.ADVANTA_PARTNER_ID || '',
    shortcode: process.env.ADVANTA_SHORTCODE  || 'INTEC',
    baseUrl:   process.env.ADVANTA_BASE       || 'https://quicksms.advantasms.com',
  };

  try {
    const [rows] = await db.promise().query(
      `SELECT setting_key, setting_value FROM platform_settings
       WHERE setting_key IN
         ('sms_api_key','sms_partner_id','sms_sender_id','sms_api_base')`
    );
    const map = {};
    for (const r of rows) map[r.setting_key] = r.setting_value;

    if (map['sms_api_key'])    cfg.apiKey    = map['sms_api_key'];
    if (map['sms_partner_id']) cfg.partnerId = map['sms_partner_id'];
    if (map['sms_sender_id'])  cfg.shortcode = map['sms_sender_id'];
    if (map['sms_api_base'])   cfg.baseUrl   = map['sms_api_base'];
  } catch (e) {
    console.warn('advantaSms: could not load settings from DB:', e.message);
  }

  cfg.baseUrl = cfg.baseUrl.replace(/\/+$/, '');

  _cache = cfg;
  _cacheAt = Date.now();
  return cfg;
}

/** Call this after PATCH /api/admin/settings saves SMS keys. */
function invalidateCache() {
  _cache = null;
  _cacheAt = 0;
}

/** Lets the settings page report which source is live. */
async function getSmsConfig() {
  const cfg = await loadSmsConfig();
  return {
    provider:  'Advanta Bulk SMS',
    apiKey:    cfg.apiKey,
    partnerId: cfg.partnerId,
    shortcode: cfg.shortcode,
    baseUrl:   cfg.baseUrl,
  };
}

// ============================================================
// Phone normaliser
// ============================================================
function normalizePhone(mobile) {
  if (!mobile) return null;
  let m = String(mobile).replace(/\D/g, '');
  if (m.startsWith('0')) m = '254' + m.slice(1);
  if (!m.startsWith('254')) m = '254' + m;
  if (m.length !== 12) return null;
  return m;
}

// ============================================================
// Send a single SMS
// ============================================================
async function sendSms(mobile, message) {
  // Guard: reject Promise-by-mistake so we never send "[object Promise]"
  if (message && typeof message.then === 'function') {
    console.error('sendSms: received a Promise instead of a string. Add await at the call site.');
    return { ok: false, error: 'SMS body was a Promise — missing await' };
  }
  if (typeof message !== 'string') {
    message = String(message ?? '');
  }

  const cfg = await loadSmsConfig();

  if (!cfg.apiKey || !cfg.partnerId || !cfg.shortcode) {
    return { ok: false, error: 'Advanta credentials not configured' };
  }

  const msisdn = normalizePhone(mobile);
  if (!msisdn) {
    return { ok: false, error: 'Invalid phone number' };
  }

  const body = {
    apikey:    cfg.apiKey,
    partnerID: cfg.partnerId,
    shortcode: cfg.shortcode,
    mobile:    msisdn,
    message:   message.slice(0, 480),
  };

  try {
    const r = await axios.post(
      `${cfg.baseUrl}/api/services/sendsms`,
      body,
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
        validateStatus: () => true,
      }
    );

    const data = r.data;

    if (r.status < 200 || r.status >= 300) {
      const errText = typeof data === 'string'
        ? data.slice(0, 200)
        : JSON.stringify(data).slice(0, 200);
      return { ok: false, error: `HTTP ${r.status}: ${errText}` };
    }

    const first = data?.responses?.[0];
    const code  = first?.['respose-code'] ?? first?.['response-code'] ?? first?.code;
    const ok    = code === 200 || code === '200' || data?.success === true;

    return {
      ok,
      ref: first?.messageid || first?.['message-id'] || null,
      error: ok
        ? undefined
        : (first?.['response-description'] || JSON.stringify(data).slice(0, 200)),
    };
  } catch (e) {
    const detail = e.response
      ? `HTTP ${e.response.status}`
      : (e.code || e.message || 'unknown');
    return { ok: false, error: `Request failed: ${detail}` };
  }
}

// ============================================================
// Fetch SMS credit balance
// ============================================================
async function getSmsBalance() {
  const cfg = await loadSmsConfig();

  if (!cfg.apiKey || !cfg.partnerId) {
    return { ok: false, error: 'Advanta credentials not configured' };
  }

  try {
    const r = await axios.post(
      `${cfg.baseUrl}/api/services/getbalance`,
      {
        apikey:    cfg.apiKey,
        partnerID: cfg.partnerId,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
        validateStatus: () => true,
      }
    );

    const data = r.data;

    if (r.status < 200 || r.status >= 300) {
      const errText = typeof data === 'string'
        ? data.slice(0, 200)
        : JSON.stringify(data).slice(0, 200);
      return { ok: false, error: `HTTP ${r.status}: ${errText}` };
    }

    const credit = data?.credit || data?.balance || '0';
    return {
      ok: true,
      balance: Number(credit) || 0,
      currency: 'KES',
    };
  } catch (e) {
    const detail = e.response
      ? `HTTP ${e.response.status}`
      : (e.code || e.message || 'unknown');
    return { ok: false, error: `Request failed: ${detail}` };
  }
}

module.exports = {
  sendSms,
  getSmsBalance,
  normalizePhone,
  getSmsConfig,
  invalidateCache,
};
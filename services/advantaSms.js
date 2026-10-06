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
    apiKey:    process.env.ADVANTA_API_KEY     || '',
    partnerId: process.env.ADVANTA_PARTNER_ID  || '',
    shortcode: process.env.ADVANTA_SHORTCODE   || 'INTEC',
    baseUrl:   process.env.ADVANTA_BASE        || 'https://quicksms.advantasms.com',
  };

  try {
    const [rows] = await db.promise().query(
      `SELECT setting_key, setting_value FROM platform_settings
       WHERE setting_key IN
         ('sms.api_key','sms.partner_id','sms.sender_id','sms.base_url')`
    );
    const map = {};
    for (const r of rows) map[r.setting_key] = r.setting_value;

    // DB value wins only if it's non-empty
    if (map['sms.api_key'])    cfg.apiKey    = map['sms.api_key'];
    if (map['sms.partner_id']) cfg.partnerId = map['sms.partner_id'];
    if (map['sms.sender_id'])  cfg.shortcode = map['sms.sender_id'];
    if (map['sms.base_url'])   cfg.baseUrl   = map['sms.base_url'];
  } catch (e) {
    // Table might not exist yet (pre-migration) — silently fall back to env
    console.warn('advantaSms: could not load settings from DB:', e.message);
  }

  // Strip trailing slash so we can safely append /api/...
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
// Phone normaliser (unchanged behaviour)
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
    message:   String(message || '').slice(0, 480), // ≤3 SMS segments
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

    // Advanta replies:
    // { responses: [{ "respose-code": 200, "response-description": "Success", "messageid": "..." }] }
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
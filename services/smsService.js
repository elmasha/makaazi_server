// services/smsService.js
const crypto = require('crypto');
const db = require('../config/db');
const { sendSms } = require('./advantaSms');

const recentSends = new Map();
const DEDUPE_WINDOW_MS = 60_000;

/**
 * Fire-and-forget SMS send. Logs to `sms_logs` table.
 * Never throws — callers don't need try/catch.
 */
async function queueSms(to, message, meta = {}) {
  if (!to || !message) return { ok: false, error: 'Missing to/message' };

  // Dedupe guard (prevents duplicate sends on retried callbacks)
  const kind = meta.kind || 'generic';
  const hash = crypto
    .createHash('sha1')
    .update(String(message).slice(0, 80))
    .digest('hex')
    .slice(0, 12);
  const dedupeKey = `${to}|${kind}|${hash}`;
  const last = recentSends.get(dedupeKey);
  const now = Date.now();
  if (last && now - last < DEDUPE_WINDOW_MS) {
    console.log(`↩️  SMS deduped: ${kind} → ${to}`);
    return { ok: true, deduped: true };
  }
  recentSends.set(dedupeKey, now);

  if (recentSends.size > 5000) {
    for (const [k, t] of recentSends) {
      if (now - t > DEDUPE_WINDOW_MS) recentSends.delete(k);
    }
  }

  // Send
  const result = await sendSms(to, message);

  // Log
  try {
    await db.promise().query(
      `INSERT INTO sms_logs
         (phone, message, kind, user_uid, estate_id, ok, provider_ref, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(to),
        message.slice(0, 500),
        kind,
        meta.user_uid || null,
        meta.estate_id || null,
        result.ok ? 1 : 0,
        result.ref || null,
        result.error || null,
      ]
    );
  } catch (e) {
    console.warn('sms_logs insert failed:', e.message);
  }

  if (!result.ok) {
    console.warn(`📵 SMS to ${to} failed:`, result.error);
  } else {
    console.log(`📤 SMS to ${to} sent (ref ${result.ref}) [${kind}]`);
  }

  return result;
}

module.exports = { queueSms };
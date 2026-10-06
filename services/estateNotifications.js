// services/estateNotifications.js
const db = require('../config/db');
const { queueSms } = require('./smsService');
const templates = require('./smsTemplates');

/**
 * Which official roles should receive payment notifications.
 * Add 'Chairman' or 'Secretary' here to loop them in too.
 * Matched case-insensitively against officials.role.
 */
const PAYMENT_RECIPIENT_ROLES = ['Treasurer'];

/**
 * Notify the estate treasurer (and any other configured roles) whenever
 * a payment is recorded. Never throws.
 *
 * @param {Object} args
 * @param {number} args.estateId
 * @param {string} args.ownerName
 * @param {number} args.amount
 * @param {string} [args.chargeType]
 * @param {string} [args.period]
 * @param {string} [args.receipt]
 * @param {string} [args.estateName]
 */
async function notifyEstateTreasurer(args) {
  const {
    estateId,
    ownerName,
    amount,
    chargeType = null,
    period = null,
    receipt = null,
    estateName = null,
  } = args || {};

  if (!estateId) {
    console.warn('notifyEstateTreasurer: missing estateId');
    return [];
  }

  // 1) Look up officials with a matching role for this estate
  let recipients = [];
  try {
    const rolePlaceholders = PAYMENT_RECIPIENT_ROLES.map(() => '?').join(',');
    const [rows] = await db.promise().query(
      `SELECT official_id, full_name, role, contact_number
       FROM officials
       WHERE estate_id = ?
         AND LOWER(role) IN (${rolePlaceholders})
         AND contact_number IS NOT NULL
         AND contact_number <> ''`,
      [estateId, ...PAYMENT_RECIPIENT_ROLES.map((r) => r.toLowerCase())]
    );
    recipients = rows;
  } catch (e) {
    console.warn('notifyEstateTreasurer: lookup failed:', e.message);
    return [];
  }

  if (!recipients.length) {
    console.warn(`notifyEstateTreasurer: no treasurer for estate ${estateId}`);
    return [];
  }

  // 2) Build the message once
  const message = templates.paymentReceivedTreasurer({
    ownerName: ownerName || 'A resident',
    amount,
    chargeType,
    period,
    receipt,
    estateName,
  });

  // 3) Send to each recipient
  const results = [];
  for (const r of recipients) {
    try {
      const out = await queueSms(r.contact_number, message, {
        kind: 'treasurer_payment_received',
        estate_id: estateId,
      });
      results.push({
        official_id: r.official_id,
        role: r.role,
        phone: r.contact_number,
        ...out,
      });
    } catch (e) {
      results.push({
        official_id: r.official_id,
        role: r.role,
        phone: r.contact_number,
        ok: false,
        error: e.message,
      });
    }
  }

  return results;
}

module.exports = { notifyEstateTreasurer, PAYMENT_RECIPIENT_ROLES };
// services/adminApprovalSms.js
const db = require('../config/db');
const { queueSms } = require('./smsService');
const templates = require('./smsTemplates');

const APP_URL = (process.env.APP_URL || 'https://makaazi.netlify.app').replace(/\/+$/, '');

/**
 * Map operation → { group, action label }
 *   group   decides which template to use
 *   action  short human word ("create", "delete", "promote"...)
 */
const OPERATION_MAP = {
  // Estate
  'estate.create':         { group: 'estate',   action: 'create' },
  'estate.update':         { group: 'estate',   action: 'update' },
  'estate.delete':         { group: 'estate',   action: 'DELETE' },
  'estate.address_config': { group: 'estate',   action: 'config' },

  // Admin access
  'admin.create':          { group: 'admin',    action: 'add' },
  'admin.update':          { group: 'admin',    action: 'change' },
  'admin.delete':          { group: 'admin',    action: 'remove' },

  // Billing
  'subscription.upsert':   { group: 'billing',  action: 'subscribe' },
  'subscription.status':   { group: 'billing',  action: 'status' },
  'plan.create':           { group: 'billing',  action: 'plan+' },
  'plan.update':           { group: 'billing',  action: 'plan~' },
  'plan.delete':           { group: 'billing',  action: 'plan-' },

  // Official / charges
  'official.create':       { group: 'official', action: 'New official' },
  'official.update':       { group: 'official', action: 'Official role' },
  'official.delete':       { group: 'official', action: 'Remove official' },
  'charge.add':            { group: 'official', action: 'New charge' },
  'charge.delete':         { group: 'official', action: 'Drop charge' },
};

function buildMessage({ operation, requesterEmail, summary, reviewUrl, reference }) {
  const meta = OPERATION_MAP[operation] || { group: 'generic', action: 'request' };

  const base = {
    requesterEmail,
    action: meta.action,
    summary,
    reviewUrl,
    reference,
  };

  switch (meta.group) {
    case 'estate':   return templates.adminApprovalEstate(base);
    case 'admin':    return templates.adminApprovalAdmin(base);
    case 'billing':  return templates.adminApprovalBilling(base);
    case 'official': return templates.adminApprovalOfficial(base);
    default:         return templates.adminApprovalGeneric(base);
  }
}

/**
 * Fire an SMS to every active super admin with a phone number on file.
 * Never throws.
 *
 * @param {Object} args
 * @param {string} args.reference        e.g. "APV-A7K2M9"
 * @param {string} args.operation
 * @param {string} args.summary
 * @param {string} args.requestedEmail
 */
async function notifySuperAdminsBySms({ reference, operation, summary, requestedEmail }) {
  let supers = [];
  try {
    const [rows] = await db.promise().query(
      `SELECT id, full_name, phone_number
       FROM intec_admins
       WHERE role = 'super'
         AND active = 1
         AND phone_number IS NOT NULL
         AND phone_number <> ''`
    );
    supers = rows;
  } catch (e) {
    console.warn('notifySuperAdminsBySms: lookup failed:', e.message);
    return [];
  }

  if (!supers.length) {
    console.warn('notifySuperAdminsBySms: no super admins with a phone number');
    return [];
  }

  // URL uses the reference, not the numeric id
  const reviewUrl = `${APP_URL}/admin/approve/${reference}`;

  const message = buildMessage({
    operation,
    requesterEmail: requestedEmail,
    summary,
    reviewUrl,
    reference,
  });

  const results = [];
  for (const s of supers) {
    try {
      const r = await queueSms(s.phone_number, message, {
        kind: `admin_approval_${(operation || 'generic').split('.')[0]}`,
      });
      results.push({ admin_id: s.id, phone: s.phone_number, ...r });
    } catch (e) {
      results.push({
        admin_id: s.id,
        phone: s.phone_number,
        ok: false,
        error: e.message,
      });
    }
  }

  return results;
}

/**
 * Notify the admin who submitted a request that it was approved or rejected.
 * Looks up their phone from intec_admins.phone_number. Never throws.
 *
 * @param {Object} args
 * @param {number} args.requestedBy      admin id (admin_approval_requests.requested_by)
 * @param {string} args.reference        e.g. "APV-A7K2M9"
 * @param {string} args.status           'Approved' | 'Rejected'
 * @param {string} args.summary          original request summary
 * @param {string} args.reviewerEmail    who approved/rejected
 * @param {string} [args.reason]         rejection reason (only for Rejected)
 */
async function notifyRequesterBySms({
  requestedBy,
  reference,
  status,
  summary,
  reviewerEmail,
  reason = null,
}) {
  if (!requestedBy || !reference || !status) return null;

  // 1) Look up the requester's phone
  let requester = null;
  try {
    const [[row]] = await db.promise().query(
      `SELECT id, full_name, email, phone_number
       FROM intec_admins
       WHERE id = ? LIMIT 1`,
      [requestedBy]
    );
    requester = row;
  } catch (e) {
    console.warn('notifyRequesterBySms: lookup failed:', e.message);
    return null;
  }

  if (!requester?.phone_number) {
    console.warn(
      `notifyRequesterBySms: admin #${requestedBy} has no phone_number on file`
    );
    return null;
  }

  // 2) Build the message
  let message;
  if (status === 'Approved') {
    message = templates.adminApprovalApproved({
      reference,
      summary,
      reviewerEmail,
    });
  } else if (status === 'Rejected') {
    message = templates.adminApprovalRejected({
      reference,
      summary,
      reviewerEmail,
      reason,
    });
  } else {
    return null;
  }

  // 3) Send
  try {
    const out = await queueSms(requester.phone_number, message, {
      kind: status === 'Approved'
        ? 'admin_approval_approved'
        : 'admin_approval_rejected',
      user_uid: null,
      estate_id: null,
    });
    return { phone: requester.phone_number, ...out };
  } catch (e) {
    console.warn('notifyRequesterBySms: send failed:', e.message);
    return { phone: requester.phone_number, ok: false, error: e.message };
  }
}

module.exports = {
  notifySuperAdminsBySms,
  notifyRequesterBySms,   // ← NEW
  OPERATION_MAP,
};
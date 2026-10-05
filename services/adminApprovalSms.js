// services/adminApprovalSms.js
const db = require('../config/db');
const { queueSms } = require('./smsService');
const templates = require('./smsTemplates');

const APP_URL = (process.env.APP_URL || 'https://makaazi.co.ke').replace(/\/+$/, '');

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

function buildMessage({ operation, requesterEmail, summary, reviewUrl, requestId }) {
  const meta = OPERATION_MAP[operation] || { group: 'generic', action: 'request' };

  const base = {
    requesterEmail,
    action: meta.action,
    summary,
    reviewUrl,
    requestId,
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
 */
async function notifySuperAdminsBySms({ requestId, operation, summary, requestedEmail }) {
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

  const reviewUrl = `${APP_URL}/admin/approvals/${requestId}`;
  const message = buildMessage({
    operation,
    requesterEmail: requestedEmail,
    summary,
    reviewUrl,
    requestId,
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

module.exports = { notifySuperAdminsBySms, OPERATION_MAP };
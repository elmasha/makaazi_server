// services/smsTemplates.js
const db = require('../config/db');

// ============================================================
// Shared formatters (unchanged)
// ============================================================
function fmt(amount) {
  return Number(amount || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function today() {
  return new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function signoff() {
  return `- Makaazi · ${today()}`;
}

// ============================================================
// DB template loader + token renderer
// ============================================================

// Keys now match the frontend Settings page exactly.
const DB_TEMPLATE_KEYS = {
  householdApproved: 'sms_template_approval',
  paymentSuccessful: 'sms_template_payment',
};

const CACHE_TTL_MS = 60_000;
let _tplCache = null;
let _tplCacheAt = 0;

async function loadDbTemplates() {
  if (_tplCache && Date.now() - _tplCacheAt < CACHE_TTL_MS) return _tplCache;

  const map = {};
  try {
    const [rows] = await db.promise().query(
      `SELECT setting_key, setting_value FROM platform_settings
       WHERE setting_key IN (?, ?)`,
      [DB_TEMPLATE_KEYS.householdApproved, DB_TEMPLATE_KEYS.paymentSuccessful]
    );
    for (const r of rows) {
      if (r.setting_value && String(r.setting_value).trim()) {
        map[r.setting_key] = String(r.setting_value);
      }
    }
  } catch (e) {
    // Table may not exist yet on a fresh DB — silently fall through
    console.warn('smsTemplates: DB template load failed:', e.message);
  }

  _tplCache = map;
  _tplCacheAt = Date.now();
  return map;
}

/** Call this from settingsController after saving SMS templates. */
function invalidateTemplateCache() {
  _tplCache = null;
  _tplCacheAt = 0;
}

/**
 * Render a template string with {{token}} placeholders.
 * Unknown tokens become empty strings.
 */
function renderTokens(tpl, vars) {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
    vars[k] != null ? String(vars[k]) : ''
  );
}

/**
 * Try to build from DB template. Returns null if none configured
 * so the caller falls back to the hardcoded builder.
 */
async function tryDbTemplate(kind, vars) {
  const key = DB_TEMPLATE_KEYS[kind];
  if (!key) return null;

  const tpls = await loadDbTemplates();
  const tpl = tpls[key];
  if (!tpl) return null;

  return renderTokens(tpl, vars);
}

// ============================================================
// Public API — every function stays async
// ============================================================

module.exports = {
  invalidateTemplateCache,
  renderTokens,

  /* 1. OFFICIAL ASSIGNED */
  officialAssigned: async ({ name, role, estateName }) => {
    return `Hi ${name}, you have been appointed as ${role} of ${estateName}. Open the Makaazi app to access your official console. ${signoff()}`;
  },

  /* 2. OFFICIAL PROMOTED */
  officialPromoted: async ({ name, oldRole, newRole, estateName }) => {
    const from = oldRole && oldRole !== 'none' ? `from ${oldRole} ` : '';
    return `Hi ${name}, your role at ${estateName} has been updated ${from}to ${newRole}. Open Makaazi for details. ${signoff()}`;
  },

  /* 3. REGISTRATION SUCCESSFUL */
  registrationSuccessful: async ({ name, estateName, houseNumber, section, court, street }) => {
    const addr = [houseNumber && `Hs ${houseNumber}`, section, court, street]
      .filter(Boolean).join(' / ');
    const addrLine = addr ? ` for ${addr}` : '';
    return `Hi ${name}, we have received your registration request${addrLine} at ${estateName}. An estate official will review and approve it shortly. ${signoff()}`;
  },

  /* 4. HOUSEHOLD APPROVED — DB-overridable
     Available tokens in the settings UI:
       {{name}} {{estate}} {{account}} {{phone}}            */
  householdApproved: async ({ name, estateName, urn, takeOnBalance, phone }) => {
    const dbBody = await tryDbTemplate('householdApproved', {
      name,
      estate:  estateName,
      account: urn,
      phone,
    });
    if (dbBody) return dbBody;

    // Fallback: original hardcoded builder
    const bal = Number(takeOnBalance || 0);
    const balLine = bal > 0
      ? ` Opening balance: KES ${fmt(bal)}.`
      : ` Starting balance: KES 0.`;
    return `Hi ${name}, your registration at ${estateName} has been approved. Your account number is ${urn}.${balLine} Welcome to Makaazi! ${signoff()}`;
  },

  /* 5. PAYMENT SUCCESSFUL — DB-overridable
     Available tokens in the settings UI:
       {{name}} {{amount}} {{estate}} {{receipt}} {{balance_line}}

     balance_line is pre-rendered by this module so the admin can
     drop it anywhere in the template, or omit it entirely.        */
  paymentSuccessful: async ({ name, amount, receipt, estateName, balance }) => {
    // Pre-render the balance sentence as a single token
    let balanceLine = '';
    if (balance != null) {
      balanceLine = Number(balance) > 0
        ? `Outstanding: KES ${fmt(balance)}.`
        : `You are fully paid up. Asante!`;
    }

    const dbBody = await tryDbTemplate('paymentSuccessful', {
      name,
      amount:       fmt(amount),
      estate:       estateName,
      receipt,
      balance_line: balanceLine,
    });
    if (dbBody) return dbBody;

    // Fallback: original hardcoded builder
    const parts = [
      `Hi ${name},`,
      `we have received your payment of KES ${fmt(amount)} for ${estateName || 'your estate'}.`,
      `Receipt: ${receipt || '—'}.`,
    ];
    if (balanceLine) parts.push(balanceLine);
    parts.push(signoff());
    return parts.join(' ');
  },

  /* 5b. PAYMENT RECEIVED — treasurer notification */
  paymentReceivedTreasurer: async ({ ownerName, amount, chargeType, period, receipt, estateName }) => {
    const chargeLine = chargeType ? ` for ${chargeType}` : '';
    const periodLine = period ? ` (${period})` : '';
    return `Makaazi: Payment received at ${estateName || 'your estate'}. ${ownerName} paid KES ${fmt(amount)}${chargeLine}${periodLine}. Receipt: ${receipt || '—'}. ${signoff()}`;
  },

  /* 6. VISITOR PASS CREATED */
  visitorPassCreated: async ({ visitorName, hostName, estateName, checkinUrl, validUntil }) => {
    const until = new Date(validUntil).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    return `Hi ${visitorName}, ${hostName} has invited you to ${estateName}. Check in when you arrive: ${checkinUrl}. Valid until ${until}. ${signoff()}`;
  },

  /* 7. VISITOR ARRIVED */
  visitorArrived: async ({ name, visitorName, gateName }) => {
    const gate = gateName ? ` at the ${gateName}` : '';
    return `Hi ${name}, your visitor ${visitorName} has been checked in${gate}. ${signoff()}`;
  },

  /* 8-12. ADMIN APPROVAL (to super admins) */
  adminApprovalEstate: async ({ requesterEmail, action, summary, reviewUrl, reference }) =>
    `Makaazi [Estate ${action}] ${requesterEmail}: ${truncate(summary, 55)}. Approve: ${reviewUrl} (${reference}) ${signoff()}`,

  adminApprovalAdmin: async ({ requesterEmail, action, summary, reviewUrl, reference }) =>
    `Makaazi [Admin ${action}] ⚠️ ${requesterEmail}: ${truncate(summary, 50)}. Approve: ${reviewUrl} (${reference}) ${signoff()}`,

  adminApprovalBilling: async ({ requesterEmail, action, summary, reviewUrl, reference }) =>
    `Makaazi [Billing ${action}] 💰 ${requesterEmail}: ${truncate(summary, 50)}. Approve: ${reviewUrl} (${reference}) ${signoff()}`,

  adminApprovalOfficial: async ({ requesterEmail, action, summary, reviewUrl, reference }) =>
    `Makaazi [${action}] ${requesterEmail}: ${truncate(summary, 55)}. Approve: ${reviewUrl} (${reference}) ${signoff()}`,

  adminApprovalGeneric: async ({ requesterEmail, summary, reviewUrl, reference }) =>
    `Makaazi: ${requesterEmail} requested — ${truncate(summary, 55)}. Approve: ${reviewUrl} (${reference}) ${signoff()}`,

  /* 13-14. ADMIN APPROVAL OUTCOME */
  adminApprovalApproved: async ({ reference, summary, reviewerEmail }) =>
    `Makaazi: Your request ${reference} was approved ✓ — ${truncate(summary, 50)}. By ${reviewerEmail || 'super admin'}. ${signoff()}`,

  adminApprovalRejected: async ({ reference, summary, reviewerEmail, reason }) => {
    const reasonLine = reason ? ` Reason: ${truncate(reason, 60)}.` : '';
    return `Makaazi: Your request ${reference} was rejected ✗ — ${truncate(summary, 40)}.${reasonLine} By ${reviewerEmail || 'super admin'}. ${signoff()}`;
  },
};
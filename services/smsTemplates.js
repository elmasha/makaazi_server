// services/smsTemplates.js
const db = require('../config/db');

// ============================================================
// Shared formatters
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
// DB template cache — populated async, read sync
// ============================================================

const DB_TEMPLATE_KEYS = {
  householdApproved: 'sms_template_approval',
  paymentSuccessful: 'sms_template_payment',
};

const CACHE_TTL_MS = 60_000;

// { 'sms_template_approval': '...', 'sms_template_payment': '...' }
let _tplCache = {};

async function refreshTemplateCache() {
  try {
    const [rows] = await db.promise().query(
      `SELECT setting_key, setting_value FROM platform_settings
       WHERE setting_key IN (?, ?)`,
      [DB_TEMPLATE_KEYS.householdApproved, DB_TEMPLATE_KEYS.paymentSuccessful]
    );
    const map = {};
    for (const r of rows) {
      if (r.setting_value && String(r.setting_value).trim()) {
        map[r.setting_key] = String(r.setting_value);
      }
    }
    _tplCache = map;
  } catch (e) {
    // Table may not exist yet on a fresh DB — keep whatever we had
    console.warn('smsTemplates: template cache refresh failed:', e.message);
  }
}

/**
 * Called from settingsController after saving SMS keys.
 * Fires a refresh in the background; keeps serving the old
 * templates until the new ones load (no cache-miss window).
 */
function invalidateTemplateCache() {
  refreshTemplateCache().catch(() => {});
}

function getDbTemplate(kind) {
  const key = DB_TEMPLATE_KEYS[kind];
  return key ? (_tplCache[key] || null) : null;
}

function renderTokens(tpl, vars) {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
    vars[k] != null ? String(vars[k]) : ''
  );
}

// Kick off initial load. Non-blocking — the first few requests
// may use the hardcoded fallbacks, which is fine.
refreshTemplateCache().catch(() => {});

// Refresh every 60s so template edits propagate even without
// an explicit invalidate. .unref() so it doesn't block process exit.
const _timer = setInterval(() => {
  refreshTemplateCache().catch(() => {});
}, CACHE_TTL_MS);
if (_timer.unref) _timer.unref();

// ============================================================
// Public API — ALL SYNCHRONOUS
// ============================================================

module.exports = {
  refreshTemplateCache,
  invalidateTemplateCache,
  renderTokens,

  /* 1. OFFICIAL ASSIGNED */
  officialAssigned: ({ name, role, estateName }) => {
    return `Hi ${name}, you have been appointed as ${role} of ${estateName}. Open the Makaazi app to access your official console. ${signoff()}`;
  },

  /* 2. OFFICIAL PROMOTED */
  officialPromoted: ({ name, oldRole, newRole, estateName }) => {
    const from = oldRole && oldRole !== 'none' ? `from ${oldRole} ` : '';
    return `Hi ${name}, your role at ${estateName} has been updated ${from}to ${newRole}. Open Makaazi for details. ${signoff()}`;
  },

  /* 3. REGISTRATION SUCCESSFUL */
  registrationSuccessful: ({ name, estateName, houseNumber, section, court, street }) => {
    const addr = [houseNumber && `Hs ${houseNumber}`, section, court, street]
      .filter(Boolean).join(' / ');
    const addrLine = addr ? ` for ${addr}` : '';
    return `Hi ${name}, we have received your registration request${addrLine} at ${estateName}. An estate official will review and approve it shortly. ${signoff()}`;
  },

  /* 4. HOUSEHOLD APPROVED — DB-overridable */
  householdApproved: ({ name, estateName, urn, takeOnBalance, phone }) => {
    const tpl = getDbTemplate('householdApproved');
    if (tpl) {
      return renderTokens(tpl, {
        name,
        estate:  estateName,
        account: urn,
        phone,
      });
    }

    const bal = Number(takeOnBalance || 0);
    const balLine = bal > 0
      ? ` Opening balance: KES ${fmt(bal)}.`
      : ` Starting balance: KES 0.`;
    return `Hi ${name}, your registration at ${estateName} has been approved. Your account number is ${urn}.${balLine} Welcome to Makaazi! ${signoff()}`;
  },

  /* 5. PAYMENT SUCCESSFUL — DB-overridable */
  paymentSuccessful: ({ name, amount, receipt, estateName, balance }) => {
    let balanceLine = '';
    if (balance != null) {
      balanceLine = Number(balance) > 0
        ? `Outstanding: KES ${fmt(balance)}.`
        : `You are fully paid up. Asante!`;
    }

    const tpl = getDbTemplate('paymentSuccessful');
    if (tpl) {
      return renderTokens(tpl, {
        name,
        amount:       fmt(amount),
        estate:       estateName,
        receipt,
        balance_line: balanceLine,
      });
    }

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
  paymentReceivedTreasurer: ({ ownerName, amount, chargeType, period, receipt, estateName }) => {
    const chargeLine = chargeType ? ` for ${chargeType}` : '';
    const periodLine = period ? ` (${period})` : '';
    return `Makaazi: Payment received at ${estateName || 'your estate'}. ${ownerName} paid KES ${fmt(amount)}${chargeLine}${periodLine}. Receipt: ${receipt || '—'}. ${signoff()}`;
  },

  /* 6. VISITOR PASS CREATED */
  visitorPassCreated: ({ visitorName, hostName, estateName, checkinUrl, validUntil }) => {
    const until = new Date(validUntil).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    return `Hi ${visitorName}, ${hostName} has invited you to ${estateName}. Check in when you arrive: ${checkinUrl}. Valid until ${until}. ${signoff()}`;
  },

  /* 7. VISITOR ARRIVED */
  visitorArrived: ({ name, visitorName, gateName }) => {
    const gate = gateName ? ` at the ${gateName}` : '';
    return `Hi ${name}, your visitor ${visitorName} has been checked in${gate}. ${signoff()}`;
  },

  /* 8-12. ADMIN APPROVAL (to super admins) */
  adminApprovalEstate: ({ requesterEmail, action, summary, reviewUrl, reference }) =>
    `Makaazi [Estate ${action}] ${requesterEmail}: ${truncate(summary, 55)}. Approve: ${reviewUrl} (${reference}) ${signoff()}`,

  adminApprovalAdmin: ({ requesterEmail, action, summary, reviewUrl, reference }) =>
    `Makaazi [Admin ${action}] ⚠️ ${requesterEmail}: ${truncate(summary, 50)}. Approve: ${reviewUrl} (${reference}) ${signoff()}`,

  adminApprovalBilling: ({ requesterEmail, action, summary, reviewUrl, reference }) =>
    `Makaazi [Billing ${action}] 💰 ${requesterEmail}: ${truncate(summary, 50)}. Approve: ${reviewUrl} (${reference}) ${signoff()}`,

  adminApprovalOfficial: ({ requesterEmail, action, summary, reviewUrl, reference }) =>
    `Makaazi [${action}] ${requesterEmail}: ${truncate(summary, 55)}. Approve: ${reviewUrl} (${reference}) ${signoff()}`,

  adminApprovalGeneric: ({ requesterEmail, summary, reviewUrl, reference }) =>
    `Makaazi: ${requesterEmail} requested — ${truncate(summary, 55)}. Approve: ${reviewUrl} (${reference}) ${signoff()}`,

  /* 13-14. ADMIN APPROVAL OUTCOME */
  adminApprovalApproved: ({ reference, summary, reviewerEmail }) =>
    `Makaazi: Your request ${reference} was approved ✓ — ${truncate(summary, 50)}. By ${reviewerEmail || 'super admin'}. ${signoff()}`,

  adminApprovalRejected: ({ reference, summary, reviewerEmail, reason }) => {
    const reasonLine = reason ? ` Reason: ${truncate(reason, 60)}.` : '';
    return `Makaazi: Your request ${reference} was rejected ✗ — ${truncate(summary, 40)}.${reasonLine} By ${reviewerEmail || 'super admin'}. ${signoff()}`;
  },
};
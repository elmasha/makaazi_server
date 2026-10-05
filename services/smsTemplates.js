// services/smsTemplates.js

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

module.exports = {
  /* ============================================================
   * 1. OFFICIAL ASSIGNED
   * ============================================================ */
  officialAssigned: ({ name, role, estateName }) => {
    return `Hi ${name}, you have been appointed as ${role} of ${estateName}. Open the Makaazi app to access your official console. - Makaazi`;
  },

  /* ============================================================
   * 2. OFFICIAL PROMOTED
   * ============================================================ */
  officialPromoted: ({ name, oldRole, newRole, estateName }) => {
    const from = oldRole && oldRole !== 'none' ? `from ${oldRole} ` : '';
    return `Hi ${name}, your role at ${estateName} has been updated ${from}to ${newRole}. Open Makaazi for details. - Makaazi`;
  },

  /* ============================================================
   * 3. REGISTRATION SUCCESSFUL
   * ============================================================ */
  registrationSuccessful: ({ name, estateName, houseNumber, section, court, street }) => {
    const addr = [houseNumber && `Hs ${houseNumber}`, section, court, street]
      .filter(Boolean)
      .join(' / ');
    const addrLine = addr ? ` for ${addr}` : '';
    return `Hi ${name}, we have received your registration request${addrLine} at ${estateName}. An estate official will review and approve it shortly. - Makaazi`;
  },

  /* ============================================================
   * 4. HOUSEHOLD APPROVED
   * ============================================================ */
  householdApproved: ({ name, estateName, urn, takeOnBalance }) => {
    const bal = Number(takeOnBalance || 0);
    const balLine =
      bal > 0
        ? ` Opening balance: KES ${fmt(bal)}.`
        : ` Starting balance: KES 0.`;
    return `Hi ${name}, your registration at ${estateName} has been approved. Your account number is ${urn}.${balLine} Welcome to Makaazi!`;
  },

  /* ============================================================
   * 5. PAYMENT SUCCESSFUL
   * ============================================================ */
  paymentSuccessful: ({ name, amount, receipt, estateName, balance }) => {
    const parts = [
      `Hi ${name},`,
      `we have received your payment of KES ${fmt(amount)} for ${estateName || 'your estate'}.`,
      `Receipt: ${receipt || '—'}.`,
    ];
    if (balance != null) {
      parts.push(
        Number(balance) > 0
          ? `Outstanding: KES ${fmt(balance)}.`
          : `You are fully paid up. Asante!`
      );
    }
    parts.push(`- Makaazi`);
    return parts.join(' ');
  },

  /* ============================================================
   * 6. VISITOR PASS CREATED
   * ============================================================ */
  visitorPassCreated: ({ visitorName, hostName, estateName, checkinUrl, validUntil }) => {
    const until = new Date(validUntil).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    return `Hi ${visitorName}, ${hostName} has invited you to ${estateName}. Check in when you arrive: ${checkinUrl}. Valid until ${until}. - Makaazi`;
  },

  /* ============================================================
   * 7. VISITOR ARRIVED
   * ============================================================ */
  visitorArrived: ({ name, visitorName, gateName }) => {
    const gate = gateName ? ` at the ${gateName}` : '';
    return `Hi ${name}, your visitor ${visitorName} has been checked in${gate}. - Makaazi`;
  },

  /* ============================================================
   * ADMIN APPROVAL — reference is a short code like "APV-A7K2M9"
   *
   * 8.  ESTATE
   * 9.  ADMIN
   * 10. BILLING
   * 11. OFFICIAL
   * 12. GENERIC
   * ============================================================ */

  adminApprovalEstate: ({ requesterEmail, action, summary, reviewUrl, reference }) => {
    return `Makaazi [Estate ${action}] ${requesterEmail}: ${truncate(summary, 60)}. Approve: ${reviewUrl} (${reference}) - Makaazi`;
  },

  adminApprovalAdmin: ({ requesterEmail, action, summary, reviewUrl, reference }) => {
    return `Makaazi [Admin ${action}] ⚠️ ${requesterEmail}: ${truncate(summary, 55)}. Approve: ${reviewUrl} (${reference}) - Makaazi`;
  },

  adminApprovalBilling: ({ requesterEmail, action, summary, reviewUrl, reference }) => {
    return `Makaazi [Billing ${action}] 💰 ${requesterEmail}: ${truncate(summary, 55)}. Approve: ${reviewUrl} (${reference}) - Makaazi`;
  },

  adminApprovalOfficial: ({ requesterEmail, action, summary, reviewUrl, reference }) => {
    return `Makaazi [${action}] ${requesterEmail}: ${truncate(summary, 60)}. Approve: ${reviewUrl} (${reference}) - Makaazi`;
  },

  adminApprovalGeneric: ({ requesterEmail, summary, reviewUrl, reference }) => {
    return `Makaazi: ${requesterEmail} requested — ${truncate(summary, 60)}. Approve: ${reviewUrl} (${reference}) - Makaazi`;
  },
};
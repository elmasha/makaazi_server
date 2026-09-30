// services/smsTemplates.js

function fmt(amount) {
  return Number(amount || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

module.exports = {
  /* ============================================================
   * 1. OFFICIAL ASSIGNED — household becomes an official
   * ============================================================ */
  officialAssigned: ({ name, role, estateName }) => {
    return `Hi ${name}, you have been appointed as ${role} of ${estateName}. Open the Makaazi app to access your official console. - Makaazi`;
  },

  /* ============================================================
   * 2. OFFICIAL PROMOTED — role changed on an existing official
   * ============================================================ */
  officialPromoted: ({ name, oldRole, newRole, estateName }) => {
    const from = oldRole && oldRole !== 'none' ? `from ${oldRole} ` : '';
    return `Hi ${name}, your role at ${estateName} has been updated ${from}to ${newRole}. Open Makaazi for details. - Makaazi`;
  },

  /* ============================================================
   * 3. REGISTRATION SUCCESSFUL — self-registration received
   * ============================================================ */
  registrationSuccessful: ({ name, estateName, houseNumber, section, court, street }) => {
    const addr = [houseNumber && `Hs ${houseNumber}`, section, court, street]
      .filter(Boolean)
      .join(' / ');
    const addrLine = addr ? ` for ${addr}` : '';
    return `Hi ${name}, we have received your registration request${addrLine} at ${estateName}. An estate official will review and approve it shortly. - Makaazi`;
  },

  /* ============================================================
   * 4. HOUSEHOLD APPROVED — official approved the registration
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
   * 5. PAYMENT SUCCESSFUL — M-Pesa payment confirmed
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
   * 6. VISITOR ARRIVED — gate verified the pass
   * ============================================================ */
  visitorArrived: ({ name, visitorName, gateName }) => {
    const gate = gateName ? ` at the ${gateName}` : '';
    return `Hi ${name}, your visitor ${visitorName} has been checked in${gate}. - Makaazi`;
  },
};
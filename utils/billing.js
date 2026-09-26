// utils/billing.js
const db = require('../config/db');

/**
 * Sum of all Monthly-frequency service charges for an estate.
 * Ignores Quarterly/Annual for now — extend later if needed.
 */
async function getEstateMonthlyRate(estateId) {
  const [rows] = await db.promise().query(
    `SELECT COALESCE(SUM(amount), 0) AS rate
     FROM service_charges
     WHERE estate_id = ?
       AND frequency = 'Monthly'`,
    [estateId]
  );
  return Number(rows[0]?.rate || 0);
}

/**
 * Annual due = monthly rate × 12.
 */
async function getEstateAnnualDue(estateId) {
  const monthly = await getEstateMonthlyRate(estateId);
  return monthly * 12;
}

/**
 * Month of year 1..12 for a given date (defaults to today).
 */
function monthOfYear(date = new Date()) {
  return date.getMonth() + 1;
}

/**
 * Compute dashboard numbers for a household_payments row.
 * Returns: { due_to_date, total_paid, overdue, months_equivalent,
 *            status, monthly_rate, annual_due }
 */
async function computeDashboard(paymentRow, estateId, today = new Date()) {
  const monthlyRate = await getEstateMonthlyRate(estateId);
  const annualDue = monthlyRate * 12;
  const monthsElapsed = monthOfYear(today);

  const bf = Number(paymentRow.balance_brought_forward || 0);
  const totalPaid = Number(paymentRow.total_paid || 0);

  const dueToDate = bf + monthlyRate * monthsElapsed;
  const overdue = Math.max(0, dueToDate - totalPaid);
  const prepaid = Math.max(0, totalPaid - dueToDate);

  const monthsEquivalent = monthlyRate > 0
    ? Number((totalPaid / monthlyRate).toFixed(2))
    : 0;

  let status = 'Paid';
  if (overdue > 0) status = 'Overdue';
  else if (prepaid > 0) status = 'Prepaid';

  return {
    due_to_date: Number(dueToDate.toFixed(2)),
    total_paid: Number(totalPaid.toFixed(2)),
    overdue: Number(overdue.toFixed(2)),
    prepaid: Number(prepaid.toFixed(2)),
    months_equivalent: monthsEquivalent,
    status,
    monthly_rate: monthlyRate,
    annual_due: Number(annualDue.toFixed(2)),
  };
}

/**
 * Generate a household URN.
 * Format: <ESTATE_PREFIX>-H-<timestamp_ms>-<rand>
 * Example: GALIL-H-1770569818607-4412
 */
function generateHouseholdUrn(estateUrn) {
  const prefix = String(estateUrn || 'EST').split('-')[0].slice(0, 5).toUpperCase();
  const ts = Date.now();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-H-${ts}-${rand}`;
}

module.exports = {
  getEstateMonthlyRate,
  getEstateAnnualDue,
  computeDashboard,
  generateHouseholdUrn,
  monthOfYear,
};
// utils/billing.js
const db = require('../config/db');

// ==================================================================
// MONTH CONSTANTS
// ==================================================================
const MONTHS_FULL = [
  'January', 'February', 'March', 'April',
  'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
];

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr',
  'May', 'Jun', 'Jul', 'Aug',
  'Sep', 'Oct', 'Nov', 'Dec',
];

// ==================================================================
// RATE HELPERS
// ==================================================================

/**
 * Sum of all Monthly-frequency service charges for an estate.
 * Returns 0 if none configured (avoids divide-by-zero upstream).
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

// ==================================================================
// MONEY FORMATTING
// ==================================================================

/**
 * Format a number as "4" / "4.5" / "4.25" — trims trailing zeros.
 * Returns "0" for null/undefined/NaN/0.
 */
function formatMoney(n) {
  const num = Number(n);
  if (!num || isNaN(num)) return '0';
  return num.toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

// ==================================================================
// DASHBOARD MATH (pure function — no DB calls)
// ==================================================================

/**
 * Compute a household's dashboard numbers from an already-loaded row.
 *
 * @param {Object} paymentRow  Row from household_payments
 *                             (must include balance_brought_forward, total_paid)
 * @param {Number} monthlyRate Estate monthly rate (pre-fetched by caller)
 * @param {Date}   today       For testability
 */
function computeDashboard(paymentRow, monthlyRate, today = new Date()) {
  const rate = Number(monthlyRate) || 0;
  const annualDue = rate * 12;
  const monthsElapsed = monthOfYear(today);

  const bf = Number(paymentRow?.balance_brought_forward || 0);
  const totalPaid = Number(paymentRow?.total_paid || 0);

  const dueToDate = bf + rate * monthsElapsed;
  const overdue = Math.max(0, dueToDate - totalPaid);
  const prepaid = Math.max(0, totalPaid - dueToDate);

  const monthsEquivalent = rate > 0
    ? Number((totalPaid / rate).toFixed(2))
    : 0;

  let status = 'Paid';
  if (overdue > 0) status = 'Overdue';
  else if (prepaid > 0) status = 'Prepaid';

  return {
    balance_brought_forward: Number(bf.toFixed(2)),
    due_to_date: Number(dueToDate.toFixed(2)),
    total_paid: Number(totalPaid.toFixed(2)),
    overdue: Number(overdue.toFixed(2)),
    prepaid: Number(prepaid.toFixed(2)),
    months_equivalent: monthsEquivalent,
    status,
    monthly_rate: rate,
    annual_due: Number(annualDue.toFixed(2)),
    months_elapsed: monthsElapsed,
  };
}

// ==================================================================
// MONTHLY GRID BUILDERS
// ==================================================================

/**
 * Build the Jan–Dec grid for one household.
 * Fetches amounts from household_payments and counts from payments.
 *
 * ALWAYS returns 12 rows in calendar order.
 * Each row: { month, month_short, month_number, amount,
 *             amount_formatted, count, display }
 */
async function buildMonthlyTable(householdId, year) {
  // 1. Summary row (amounts)
  const [rows] = await db.promise().query(
    `SELECT * FROM household_payments
     WHERE household_id = ? AND year = ? LIMIT 1`,
    [householdId, year]
  );
  const summary = rows[0] || {};

  // 2. Counts per month from payments table
  const [counts] = await db.promise().query(
    `SELECT MONTH(payment_date) AS m, COUNT(*) AS c
     FROM payments
     WHERE household_id = ? AND YEAR(payment_date) = ?
     GROUP BY MONTH(payment_date)`,
    [householdId, year]
  );
  const countMap = {};
  for (const c of counts) countMap[c.m] = c.c;

  // 3. Assemble
  return MONTHS_FULL.map((name, idx) => {
    const key = name.toLowerCase();
    const amount = Number(summary[key] || 0);
    const count = countMap[idx + 1] || 0;

    let display;
    if (amount === 0 && count === 0) display = '0';
    else if (count > 1)              display = `${formatMoney(amount)}[${count}]`;
    else                             display = formatMoney(amount);

    return {
      month: name,
      month_short: MONTHS_SHORT[idx],
      month_number: idx + 1,
      amount,
      amount_formatted: formatMoney(amount),
      count,
      display,
    };
  });
}

/**
 * Build the 12-row grid from an ALREADY-FETCHED household_payments row.
 * No extra DB queries — use this in list endpoints to avoid N+1.
 *
 * Counts will be 0 unless supplied in `countMap` (keyed by month number 1..12).
 */
function buildMonthlyTableFromRow(summaryRow, countMap = {}) {
  const s = summaryRow || {};
  return MONTHS_FULL.map((name, idx) => {
    const key = name.toLowerCase();
    const amount = Number(s[key] || 0);
    const count = countMap[idx + 1] || 0;

    let display;
    if (amount === 0 && count === 0) display = '0';
    else if (count > 1)              display = `${formatMoney(amount)}[${count}]`;
    else                             display = formatMoney(amount);

    return {
      month: name,
      month_short: MONTHS_SHORT[idx],
      month_number: idx + 1,
      amount,
      amount_formatted: formatMoney(amount),
      count,
      display,
    };
  });
}

/**
 * Bulk-fetch monthly payment counts for a set of households in one year.
 * Returns: { [householdId]: { [monthNumber]: count } }
 *
 * Use alongside buildMonthlyTableFromRow() in estate list endpoints.
 */
async function getBulkMonthlyCounts(householdIds, year) {
  if (!householdIds || householdIds.length === 0) return {};

  const placeholders = householdIds.map(() => '?').join(',');
  const [rows] = await db.promise().query(
    `SELECT household_id, MONTH(payment_date) AS m, COUNT(*) AS c
     FROM payments
     WHERE household_id IN (${placeholders})
       AND YEAR(payment_date) = ?
     GROUP BY household_id, MONTH(payment_date)`,
    [...householdIds, year]
  );

  const result = {};
  for (const r of rows) {
    if (!result[r.household_id]) result[r.household_id] = {};
    result[r.household_id][r.m] = r.c;
  }
  return result;
}

// ==================================================================
// URN GENERATOR
// ==================================================================

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

// ==================================================================
// EXPORTS
// ==================================================================

module.exports = {
  // Rates
  getEstateMonthlyRate,
  getEstateAnnualDue,

  // Time
  monthOfYear,
  MONTHS_FULL,
  MONTHS_SHORT,

  // Math
  computeDashboard,

  // Monthly grids
  buildMonthlyTable,
  buildMonthlyTableFromRow,
  getBulkMonthlyCounts,

  // Utility
  formatMoney,
  generateHouseholdUrn,
};
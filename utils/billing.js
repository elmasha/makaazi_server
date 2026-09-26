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
 *
 * @param {number} estateId
 * @param {object} [connection]  Optional connection for transactions
 * @returns {Promise<number>}
 */
async function getEstateMonthlyRate(estateId, connection = null) {
  const runner = connection || db.promise();
  const [rows] = await runner.query(
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
 *
 * @param {number} estateId
 * @returns {Promise<number>}
 */
async function getEstateAnnualDue(estateId) {
  const monthly = await getEstateMonthlyRate(estateId);
  return monthly * 12;
}

/**
 * Breakdown of all charges for an estate grouped by frequency.
 * Useful for showing residents what they're being charged for.
 *
 * @param {number} estateId
 * @returns {Promise<{
 *   monthly: number,
 *   quarterly: number,
 *   half_yearly: number,
 *   annual: number,
 *   adhoc: number,
 *   items: Array<{charges_id:number, charge_type:string, frequency:string, amount:number}>
 * }>}
 */
async function getEstateChargesBreakdown(estateId) {
  const [rows] = await db.promise().query(
    `SELECT charges_id, charge_type, frequency, amount
     FROM service_charges
     WHERE estate_id = ?
     ORDER BY frequency, charge_type`,
    [estateId]
  );

  const buckets = {
    monthly: 0,
    quarterly: 0,
    half_yearly: 0,
    annual: 0,
    adhoc: 0,
  };

  for (const r of rows) {
    const key = String(r.frequency || '').toLowerCase().replace(/[^a-z]/g, '_');
    if (key === 'monthly')          buckets.monthly     += Number(r.amount || 0);
    else if (key === 'quarterly')   buckets.quarterly   += Number(r.amount || 0);
    else if (key === 'half_yearly') buckets.half_yearly += Number(r.amount || 0);
    else if (key === 'annual')      buckets.annual      += Number(r.amount || 0);
    else                            buckets.adhoc       += Number(r.amount || 0);
  }

  return { ...buckets, items: rows };
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

/**
 * Safe number coercion — returns fallback for null/undefined/NaN.
 */
function safeNum(v, fallback = 0) {
  const n = Number(v);
  return isNaN(n) || !isFinite(n) ? fallback : n;
}

// ==================================================================
// DASHBOARD MATH (pure function — no DB calls)
// ==================================================================

/**
 * Compute a household's dashboard numbers from an already-loaded row.
 *
 * FORMULA:
 *   due_to_date = balance_brought_forward + (monthly_rate × months_elapsed)
 *   overdue     = max(0, due_to_date - total_paid)
 *   prepaid     = max(0, total_paid - due_to_date)
 *   months_eq   = total_paid / monthly_rate          (0 if rate is 0)
 *
 * @param {Object} paymentRow  Row from household_payments
 *                             (may include: balance_brought_forward, total_paid)
 * @param {Number} monthlyRate Estate monthly rate (pre-fetched by caller)
 * @param {Date}   today       For testability
 */
function computeDashboard(paymentRow, monthlyRate, today = new Date()) {
  const rate = safeNum(monthlyRate, 0);
  const annualDue = rate * 12;
  const monthsElapsed = monthOfYear(today);

  const bf        = safeNum(paymentRow?.balance_brought_forward, 0);
  const totalPaid = safeNum(paymentRow?.total_paid, 0);

  const dueToDate = bf + rate * monthsElapsed;
  const overdue   = Math.max(0, dueToDate - totalPaid);
  const prepaid   = Math.max(0, totalPaid - dueToDate);

  const monthsEquivalent = rate > 0
    ? Number((totalPaid / rate).toFixed(2))
    : 0;

  let status = 'Paid';
  if (overdue > 0) status = 'Overdue';
  else if (prepaid > 0) status = 'Prepaid';

  const result = {
    // Preferred names
    balance_brought_forward: Number(bf.toFixed(2)),
    due_to_date:             Number(dueToDate.toFixed(2)),
    total_paid:              Number(totalPaid.toFixed(2)),
    overdue:                 Number(overdue.toFixed(2)),
    prepaid:                 Number(prepaid.toFixed(2)),
    months_equivalent:       monthsEquivalent,
    monthly_equivalent:      monthsEquivalent,   // alias used by some controllers
    status,
    monthly_rate:            rate,
    annual_due:              Number(annualDue.toFixed(2)),
    months_elapsed:          monthsElapsed,
  };

  // Backwards-compatible alias
  result.due_year_to_date = result.due_to_date;

  return result;
}

/**
 * Just the overdue + prepaid numbers, for controllers that only need those.
 * Returns { overdue, prepaid } as positive numbers.
 */
function computeOverdueAndPrepaid(totalPaid, dueYearToDate) {
  const paid = safeNum(totalPaid, 0);
  const due  = safeNum(dueYearToDate, 0);
  const diff = due - paid;
  return {
    overdue:  diff > 0 ? Number(diff.toFixed(2)) : 0,
    prepaid:  diff < 0 ? Number(Math.abs(diff).toFixed(2)) : 0,
    on_track: diff === 0,
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
  // 1. Summary row (amounts) — tolerate missing row
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
    const amount = safeNum(summary[key], 0);
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
    const amount = safeNum(s[key], 0);
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
 *
 * Handles large arrays by chunking (MySQL IN() has a param limit).
 */
async function getBulkMonthlyCounts(householdIds, year) {
  if (!householdIds || householdIds.length === 0) return {};

  const result = {};
  const CHUNK = 500;

  for (let i = 0; i < householdIds.length; i += CHUNK) {
    const chunk = householdIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');

    const [rows] = await db.promise().query(
      `SELECT household_id, MONTH(payment_date) AS m, COUNT(*) AS c
       FROM payments
       WHERE household_id IN (${placeholders})
         AND YEAR(payment_date) = ?
       GROUP BY household_id, MONTH(payment_date)`,
      [...chunk, year]
    );

    for (const r of rows) {
      if (!result[r.household_id]) result[r.household_id] = {};
      result[r.household_id][r.m] = r.c;
    }
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
  const prefix = String(estateUrn || 'EST')
    .split('-')[0]
    .slice(0, 5)
    .toUpperCase();
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
  getEstateChargesBreakdown,

  // Time
  monthOfYear,
  MONTHS_FULL,
  MONTHS_SHORT,

  // Math
  computeDashboard,
  computeOverdueAndPrepaid,
  safeNum,

  // Monthly grids
  buildMonthlyTable,
  buildMonthlyTableFromRow,
  getBulkMonthlyCounts,

  // Utility
  formatMoney,
  generateHouseholdUrn,
};
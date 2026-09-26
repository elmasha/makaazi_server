// controllers/householdDashboardController.js
const db = require('../config/db');
const redisClient = require('../config/redis');
const {
  getEstateMonthlyRate,
  computeDashboard,
  buildMonthlyTable,
} = require('../utils/billing');

const CACHE_TTL = 120; // 2 minutes

// ==================================================================
// GET /households/dashboard/:uid
// Returns: dashboard numbers for the current year.
// Fixes the "Infinity" bug by guarding monthly_rate = 0.
// ==================================================================
exports.getHouseholdDashboard = async (req, res) => {
  const { uid } = req.params;
  const cacheKey = `dashboard:${uid}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    // 1. Resolve household
    const [hRows] = await db.promise().query(
      `SELECT household_id, estate_id, primary_owner, section, street, court,
              status, take_on_balance, active
       FROM households WHERE uid = ? LIMIT 1`,
      [uid]
    );
    if (!hRows.length) {
      return res.status(404).json({ error: 'Household not found' });
    }
    const household = hRows[0];

    // 2. If not approved, return empty state (all zeros, finite)
    if (household.status !== 'Approved') {
      const empty = {
        household_id: household.household_id,
        primary_owner: household.primary_owner,
        section: household.section,
        court: household.court,
        street: household.street,
        status: household.status,
        year: new Date().getFullYear(),
        monthly_rate: 0,
        annual_due: 0,
        due_to_date: 0,
        total_paid: 0,
        overdue: 0,
        prepaid: 0,
        months_equivalent: 0,
        months_elapsed: 0,
        balance_brought_forward: 0,
      };
      return res.json(empty);
    }

    // 3. Get current year's payment row
    const year = new Date().getFullYear();
    const [pRows] = await db.promise().query(
      `SELECT * FROM household_payments
       WHERE household_id = ? AND year = ? LIMIT 1`,
      [household.household_id, year]
    );

    // If no row exists yet, synthesize one from take_on_balance
    const paymentRow = pRows[0] || {
      balance_brought_forward: household.take_on_balance || 0,
      total_paid: 0,
      january: 0, february: 0, march: 0, april: 0,
      may: 0, june: 0, july: 0, august: 0,
      september: 0, october: 0, november: 0, december: 0,
    };

    // 4. Rate from service_charges (NOT hardcoded)
    const monthlyRate = await getEstateMonthlyRate(household.estate_id);

    // 5. Compute (sync — no await)
    const numbers = computeDashboard(paymentRow, monthlyRate);

    const response = {
      household_id: household.household_id,
      primary_owner: household.primary_owner,
      section: household.section,
      court: household.court,
      street: household.street,
      year,
      ...numbers,
    };

    await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(response));
    return res.json(response);
  } catch (err) {
    console.error('getHouseholdDashboard error:', err.message);
    return res.status(500).json({ error: 'Dashboard fetch failed' });
  }
};

// ==================================================================
// GET /households/dashboard/pk/:householdId?year=2026
// Same as above but by primary key (used by officials)
// ==================================================================
exports.getHouseholdDashboardById = async (req, res) => {
  const { householdId } = req.params;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const cacheKey = `dashboard:pk:${householdId}:${year}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [hRows] = await db.promise().query(
      `SELECT household_id, estate_id, primary_owner, section, street, court,
              status, take_on_balance, uid
       FROM households WHERE household_id = ? LIMIT 1`,
      [householdId]
    );
    if (!hRows.length) {
      return res.status(404).json({ error: 'Household not found' });
    }
    const household = hRows[0];

    const [pRows] = await db.promise().query(
      `SELECT * FROM household_payments
       WHERE household_id = ? AND year = ? LIMIT 1`,
      [householdId, year]
    );
    const summary = pRows[0] || {
      balance_brought_forward: household.take_on_balance || 0,
      total_paid: 0,
      january: 0, february: 0, march: 0, april: 0,
      may: 0, june: 0, july: 0, august: 0,
      september: 0, october: 0, november: 0, december: 0,
    };

    const monthlyRate = await getEstateMonthlyRate(household.estate_id);
    const numbers = computeDashboard(summary, monthlyRate);
    const months = await buildMonthlyTable(household.household_id, year);

    const response = {
      household,
      year,
      ...numbers,
      months,
    };

    await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(response));
    return res.json(response);
  } catch (err) {
    console.error('getHouseholdDashboardById error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ==================================================================
// GET /households/payment-summary/:uid?year=2026
// Returns everything the "Payment summary" screen needs in one shot.
// Layout matches the 4×3 grid: 12 months, all present.
// ==================================================================
exports.getPaymentSummary = async (req, res) => {
  const { uid } = req.params;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const cacheKey = `payment-summary:${uid}:${year}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    // 1. Resolve household
    const [hRows] = await db.promise().query(
      `SELECT household_id, estate_id, primary_owner, section, street, court,
              status, take_on_balance
       FROM households WHERE uid = ? LIMIT 1`,
      [uid]
    );
    if (!hRows.length) {
      return res.status(404).json({ error: 'Household not found' });
    }
    const household = hRows[0];

    // 2. Not approved → return empty grid, not an error
    const isApproved = household.status === 'Approved';

    // 3. Load or synthesize the summary row
    const [pRows] = await db.promise().query(
      `SELECT * FROM household_payments
       WHERE household_id = ? AND year = ? LIMIT 1`,
      [household.household_id, year]
    );
    const summary = pRows[0] || {
      balance_brought_forward: household.take_on_balance || 0,
      total_paid: 0,
      january: 0, february: 0, march: 0, april: 0,
      may: 0, june: 0, july: 0, august: 0,
      september: 0, october: 0, november: 0, december: 0,
    };

    // 4. Monthly grid — always 12 rows
    const months = await buildMonthlyTable(household.household_id, year);

    // 5. Rates + computed numbers
    const monthlyRate = isApproved
      ? await getEstateMonthlyRate(household.estate_id)
      : 0;
    const numbers = computeDashboard(summary, monthlyRate);

    // 6. Shape for the screen
    const response = {
      household: {
        household_id: household.household_id,
        uid,
        primary_owner: household.primary_owner,
        section: household.section,
        court: household.court,
        street: household.street,
      },
      year,
      status: numbers.status,

      // Top-left stat block
      balance_brought_forward: numbers.balance_brought_forward,
      total_paid: numbers.total_paid,
      due_to_date: numbers.due_to_date,

      // Right / footer stats
      overdue: numbers.overdue,
      prepaid: numbers.prepaid,
      months_equivalent: numbers.months_equivalent,
      monthly_rate: numbers.monthly_rate,
      annual_due: numbers.annual_due,

      // The 4×3 grid — always 12 rows
      months,
    };

    await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(response));
    return res.json(response);
  } catch (err) {
    console.error('getPaymentSummary error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch summary' });
  }
};
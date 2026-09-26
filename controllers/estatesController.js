const db = require('../config/db');
const redisClient = require('../config/redis');

const ESTATES_CACHE_TTL = 300; // 5 min

// ============================================================
// Helpers
// ============================================================

/**
 * Generate a unique estate URN using the estate's configured prefix.
 * Format: {PREFIX}-{timestamp}-{random}
 */
function generateUrn(prefix) {
  const safePrefix =
    (prefix || 'EST')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 5) || 'EST';
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 99999)
    .toString()
    .padStart(5, '0');
  return `${safePrefix}-${ts}-${rand}`;
}

/**
 * Invalidate all estate-related cache keys.
 */
async function invalidateEstateCache(estateId = null) {
  const keys = ['estates'];
  if (estateId) {
    keys.push(`estate:${estateId}`);
    keys.push(`dropdowns:${estateId}`);
    keys.push(`address-config:${estateId}`);
  }
  try {
    await redisClient.del(keys);
  } catch (err) {
    console.warn('⚠️ Cache invalidation failed:', err.message);
  }
}

// ============================================================
// LIST & READ
// ============================================================

exports.getAllEstates = async (req, res) => {
  const cacheKey = 'estates';
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT estate_id, estate_name, estate_urn, urn_prefix, estate_location,
              latitude, longitude, estate_image, logo_url, welfare_mandatory,
              created_at, updated_at
       FROM estates
       ORDER BY estate_name ASC`
    );
    await redisClient.setEx(cacheKey, ESTATES_CACHE_TTL, JSON.stringify(rows));
    res.json(rows);
  } catch (err) {
    console.error('❌ getAllEstates:', err.message);
    res.status(500).json({ error: 'Failed to fetch estates' });
  }
};

exports.getEstateById = async (req, res) => {
  const { id } = req.params;
  const cacheKey = `estate:${id}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db
      .promise()
      .query('SELECT * FROM estates WHERE estate_id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Estate not found' });
    }
    await redisClient.setEx(cacheKey, ESTATES_CACHE_TTL, JSON.stringify(rows[0]));
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ getEstateById:', err.message);
    res.status(500).json({ error: 'Failed to fetch estate' });
  }
};

exports.getEstateByName = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db
      .promise()
      .query('SELECT * FROM estates WHERE estate_name = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Estate not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ getEstateByName:', err.message);
    res.status(500).json({ error: 'Failed to fetch estate' });
  }
};

exports.getEstateSubById = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db
      .promise()
      .query(
        'SELECT * FROM estate_subscriptions WHERE estate_id = ? LIMIT 1',
        [id]
      );
    if (!rows.length)
      return res.status(404).json({ error: 'No subscription found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ getEstateSubById:', err.message);
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
};

// ============================================================
// CREATE — transactional, no legacy columns, config auto-created
// ============================================================

exports.createEstate = async (req, res) => {
  const {
    estate_name,
    estate_location,
    latitude,
    longitude,
    estate_image,
    logo_url,
    urn_prefix,
    welfare_mandatory = 0,
    show_street = 1,
    show_section = 1,
    show_court = 1,
    show_house_number = 1,
  } = req.body;

  if (!estate_name) {
    return res.status(400).json({ error: 'estate_name is required' });
  }

  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    const prefix = (urn_prefix || estate_name.slice(0, 5)).toUpperCase();
    const estate_urn = generateUrn(prefix);

    const [estateResult] = await connection.query(
      `INSERT INTO estates
         (estate_name, estate_urn, urn_prefix, estate_location,
          latitude, longitude, estate_image, logo_url, welfare_mandatory)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        estate_name,
        estate_urn,
        prefix,
        estate_location || null,
        latitude || null,
        longitude || null,
        estate_image || null,
        logo_url || null,
        welfare_mandatory ? 1 : 0,
      ]
    );
    const estate_id = estateResult.insertId;

    await connection.query(
      `INSERT INTO estate_address_config
         (estate_id, show_street, show_section, show_court, show_house_number)
       VALUES (?, ?, ?, ?, ?)`,
      [
        estate_id,
        show_street ? 1 : 0,
        show_section ? 1 : 0,
        show_court ? 1 : 0,
        show_house_number ? 1 : 0,
      ]
    );

    await connection.commit();
    await invalidateEstateCache(estate_id);

    res.status(201).json({
      message: 'Estate created with address config',
      estate_id,
      estate_urn,
    });
  } catch (err) {
    await connection.rollback();
    console.error('❌ createEstate:', err.message);
    res.status(500).json({ error: 'Failed to create estate' });
  } finally {
    connection.release();
  }
};

/**
 * @deprecated Address config is now created automatically inside createEstate.
 * Kept for backward compatibility with older frontends.
 */
exports.createEstateConfig = async (req, res) => {
  const { estate_id, show_street = 1, show_section = 1, show_court = 1, show_house_number = 1 } = req.body;
  if (!estate_id) return res.status(400).json({ error: 'estate_id is required' });

  try {
    await db.promise().query(
      `INSERT INTO estate_address_config
         (estate_id, show_street, show_section, show_court, show_house_number)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         show_street = VALUES(show_street),
         show_section = VALUES(show_section),
         show_court = VALUES(show_court),
         show_house_number = VALUES(show_house_number),
         updated_at = CURRENT_TIMESTAMP`,
      [
        estate_id,
        show_street ? 1 : 0,
        show_section ? 1 : 0,
        show_court ? 1 : 0,
        show_house_number ? 1 : 0,
      ]
    );
    await invalidateEstateCache(estate_id);
    res.status(201).json({ message: 'Estate config saved', estate_id });
  } catch (err) {
    console.error('❌ createEstateConfig:', err.message);
    res.status(500).json({ error: 'Failed to save estate config' });
  }
};

// ============================================================
// UPDATE
// ============================================================

exports.updateEstate = async (req, res) => {
  const { id } = req.params;
  const fields = req.body;

  if (!id) return res.status(400).json({ error: 'Estate ID is required' });
  if (!fields || Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  // Whitelist updatable columns (never trust raw keys from client)
  const allowed = [
    'estate_name',
    'estate_location',
    'latitude',
    'longitude',
    'estate_image',
    'logo_url',
    'urn_prefix',
    'welfare_mandatory',
  ];

  const updates = [];
  const values = [];
  for (const key of Object.keys(fields)) {
    if (allowed.includes(key)) {
      updates.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  values.push(id);

  try {
    const [result] = await db
      .promise()
      .query(`UPDATE estates SET ${updates.join(', ')} WHERE estate_id = ?`, values);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Estate not found' });
    }
    await invalidateEstateCache(id);
    res.json({ message: 'Estate updated successfully' });
  } catch (err) {
    console.error('❌ updateEstate:', err.message);
    res.status(500).json({ error: 'Failed to update estate' });
  }
};

// ============================================================
// DELETE — refuses if estate has households
// ============================================================

exports.deleteEstate = async (req, res) => {
  const { id } = req.params;
  try {
    const [[{ householdCount }]] = await db
      .promise()
      .query(
        'SELECT COUNT(*) AS householdCount FROM households WHERE estate_id = ?',
        [id]
      );

    if (householdCount > 0) {
      return res.status(409).json({
        error: `Cannot delete: estate has ${householdCount} household(s). Archive it instead.`,
      });
    }

    const [result] = await db
      .promise()
      .query('DELETE FROM estates WHERE estate_id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Estate not found' });
    }
    await invalidateEstateCache(id);
    res.json({ message: 'Estate deleted successfully' });
  } catch (err) {
    console.error('❌ deleteEstate:', err.message);
    res.status(500).json({ error: 'Failed to delete estate' });
  }
};

// ============================================================
// SEARCH
// ============================================================

exports.searchEstates = async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Search query is required' });

  const cacheKey = `search:estates:${query}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT estate_id, estate_name, estate_urn, estate_location
       FROM estates
       WHERE MATCH(estate_name, estate_urn, estate_location)
             AGAINST(? IN NATURAL LANGUAGE MODE)`,
      [query]
    );
    await redisClient.setEx(cacheKey, 60, JSON.stringify(rows));
    res.json(rows);
  } catch (err) {
    console.error('❌ searchEstates:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
};

/**
 * @deprecated Use searchEstates instead. Kept for backward compat.
 */
exports.searchAllEstates = exports.searchEstates;

// ============================================================
// SUBSCRIPTION (uses subscription_plans — no hardcoded tiers)
// ============================================================

exports.subscription = async (req, res) => {
  const { estate_id } = req.body;
  if (!estate_id) return res.status(400).json({ error: 'estate_id is required' });

  try {
    const [[{ total_households }]] = await db
      .promise()
      .query(
        'SELECT COUNT(*) AS total_households FROM households WHERE estate_id = ? AND active = 1',
        [estate_id]
      );

    // NOTE: max_households IS NULL check for the top tier
    const [plans] = await db.promise().query(
      `SELECT plan_id, plan_name, monthly_rate
       FROM subscription_plans
       WHERE ? >= min_households
         AND (? <= max_households OR max_households IS NULL)
       ORDER BY min_households ASC
       LIMIT 1`,
      [total_households, total_households]
    );

    if (!plans.length) {
      return res.status(404).json({ error: 'No matching subscription plan' });
    }

    const plan = plans[0];
    res.json({
      estate_id,
      total_households,
      plan,
      billing_rate: Number(plan.monthly_rate),
      total_amount: Number(plan.monthly_rate) * total_households,
    });
  } catch (err) {
    console.error('❌ subscription:', err.message);
    res.status(500).json({ error: 'Failed to compute subscription' });
  }
};

// ============================================================
// SUBSCRIPTION MONITORING
// ============================================================

exports.checkEstateDue = async (req, res) => {
  const { estate_id } = req.params;
  try {
    const [rows] = await db.promise().query(
      `SELECT es.estate_id, es.plan_id, sp.plan_name, es.start_date,
              DATE_ADD(es.start_date, INTERVAL 30 DAY) AS due_date,
              CASE
                WHEN CURDATE() > DATE_ADD(es.start_date, INTERVAL 30 DAY)
                  THEN 'Due'
                ELSE 'Not Due'
              END AS payment_status
       FROM estate_subscriptions es
       JOIN subscription_plans sp ON es.plan_id = sp.plan_id
       WHERE es.estate_id = ?`,
      [estate_id]
    );
    if (!rows.length)
      return res.status(404).json({ error: 'No subscription found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ checkEstateDue:', err.message);
    res.status(500).json({ error: 'Failed to check subscription' });
  }
};

exports.getBillingMessage = async (req, res) => {
  const { estate_id } = req.params;
  try {
    const [rows] = await db.promise().query(
      `SELECT sp.plan_name, es.amount_paid, sp.monthly_rate, es.start_date,
              DATE_ADD(es.start_date, INTERVAL 1 MONTH) AS next_billing_date,
              h.household_count
       FROM estate_subscriptions es
       JOIN subscription_plans sp ON es.plan_id = sp.plan_id
       JOIN (
         SELECT estate_id, COUNT(*) AS household_count
         FROM households
         GROUP BY estate_id
       ) h ON es.estate_id = h.estate_id
       WHERE es.estate_id = ?`,
      [estate_id]
    );
    if (!rows.length)
      return res.status(404).json({ error: 'No active subscription' });

    const plan = rows[0];
    const message = `Your estate is on the ${plan.plan_name} plan (${plan.household_count} households), billed at KSh ${plan.monthly_rate} per month. Next billing date: ${new Date(plan.next_billing_date).toLocaleDateString()}.`;
    res.json({ plan, message });
  } catch (err) {
    console.error('❌ getBillingMessage:', err.message);
    res.status(500).json({ error: 'Failed to build billing message' });
  }
};

exports.checkDueSubscriptions = async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT es.estate_id, e.estate_name, es.start_date,
              DATEDIFF(CURDATE(), es.start_date) AS days_since_last_payment,
              CASE
                WHEN DATEDIFF(CURDATE(), es.start_date) > 30 THEN 'Due'
                ELSE 'Not Due'
              END AS payment_status
       FROM estate_subscriptions es
       JOIN estates e ON es.estate_id = e.estate_id`
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ checkDueSubscriptions:', err.message);
    res.status(500).json({ error: 'Failed to check subscriptions' });
  }
};

exports.checkAndDisableEstateSubscription = async (req, res) => {
  const { estate_id } = req.params;
  try {
    const [rows] = await db.promise().query(
      `SELECT es.subscription_id, es.estate_id, es.plan_id, es.start_date,
              DATE_ADD(es.start_date, INTERVAL 30 DAY) AS due_date, es.is_active,
              CASE
                WHEN CURDATE() > DATE_ADD(es.start_date, INTERVAL 30 DAY) THEN 'Due'
                ELSE 'Not Due'
              END AS payment_status
       FROM estate_subscriptions es
       WHERE es.estate_id = ?`,
      [estate_id]
    );
    if (!rows.length) return res.json({ message: 'No subscription found' });

    const subscription = rows[0];
    if (subscription.payment_status === 'Due' && subscription.is_active === 1) {
      await db
        .promise()
        .query(
          'UPDATE estate_subscriptions SET is_active = 0 WHERE estate_id = ?',
          [estate_id]
        );
      subscription.is_active = 0;
      return res.json({
        subscription,
        message: 'Subscription is due and has been disabled',
      });
    }
    res.json({ subscription, message: 'Subscription is active' });
  } catch (err) {
    console.error('❌ checkAndDisableEstateSubscription:', err.message);
    res.status(500).json({ error: 'Failed to check subscription' });
  }
};
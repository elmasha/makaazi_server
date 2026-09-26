// controllers/officialsController.js
const db = require('../config/db');
const redisClient = require('../config/redis');
const { sendNotification } = require('../utils/notify');

// ============================================================
// Cache keys
// ============================================================
const CACHE = {
  all:            'officials:all',
  byEstate:  (e) => `official:estate:${e}`,
  byContact: (c) => `official:contact:${c}`,
  byUid:    (u) => `getofficial/:${u}`,
  exists:   (c) => `official:exists:${c}`,
  search:   (q) => `search:officials:${q}`,
  addressSummary: (e, y, t, m) => `summary:${e}:${y}:${t}:${m}`,
};

async function invalidateOfficialCaches(estateId, uid, contact) {
  const keys = [CACHE.all];
  if (estateId) keys.push(CACHE.byEstate(estateId));
  if (uid)      keys.push(CACHE.byUid(uid));
  if (contact)  keys.push(CACHE.byContact(contact), CACHE.exists(contact));
  await Promise.all(keys.map((k) => redisClient.del(k)));
}

// ============================================================
// ADDRESS SUMMARY — section / court / street rollups
// GET /officials/address-summary?estate_id=&type=&year=
// ============================================================
exports.getAddressSummary = async (req, res) => {
  const { estate_id, type, year } = req.query;

  if (!estate_id) {
    return res.status(400).json({ error: 'estate_id is required' });
  }
  if (!type || !['section', 'street', 'court'].includes(type)) {
    return res.status(400).json({ error: 'type must be section, street, or court' });
  }

  const selectedYear = parseInt(year) || new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const cacheKey = CACHE.addressSummary(estate_id, selectedYear, type, currentMonth);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    // ✅ FIX: read monthly rate from service_charges instead of hardcoding
    const [rates] = await db.promise().query(
      `SELECT COALESCE(SUM(amount), 0) AS rate
       FROM service_charges
       WHERE estate_id = ? AND frequency = 'Monthly'`,
      [estate_id]
    );
    const monthlyRate = Number(rates[0]?.rate || 0);

    // Build dynamic sum of month columns up to current month
    const monthColumns = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december',
    ].slice(0, currentMonth);

    const monthSum = monthColumns.map((c) => `COALESCE(hp.${c},0)`).join(' + ');

    // Note: `type` is validated against a whitelist above, so
    // interpolating it here is safe from SQL injection.
    const sql = `
      SELECT
        h.${type} AS name,
        COUNT(DISTINCT h.household_id) AS households,
        COALESCE(SUM(${monthSum}), 0) AS total_paid
      FROM households h
      LEFT JOIN household_payments hp
        ON h.household_id = hp.household_id
        AND hp.year = ?
      WHERE h.estate_id = ?
        AND h.status = 'Approved'
      GROUP BY h.${type}
      ORDER BY h.${type}
    `;

    const [rows] = await db.promise().query(sql, [selectedYear, estate_id]);

    const result = rows.map((r) => {
      const households = parseInt(r.households, 10) || 0;
      const totalPaid = parseFloat(r.total_paid || 0);
      const expectedPerHousehold = monthlyRate * currentMonth;
      const totalExpected = expectedPerHousehold * households;
      const balance = totalPaid - totalExpected;

      return {
        name: r.name || 'Uncategorised',
        households,
        total_paid: Number(totalPaid.toFixed(2)),
        arrears: Number(Math.max(0, -balance).toFixed(2)),      // negative → owed
        prepayment: Number(Math.max(0, balance).toFixed(2)),    // positive → extra
        monthly_rate: monthlyRate,
      };
    });

    await redisClient.setEx(cacheKey, 200, JSON.stringify(result));
    return res.json(result);
  } catch (err) {
    console.error('Address summary error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch address summary' });
  }
};

// ============================================================
// GET /officials/getAll
// ============================================================
exports.getAllOfficials = async (req, res) => {
  try {
    const cached = await redisClient.get(CACHE.all);
    if (cached) {
      console.log('🔁 Serving all officials from Redis cache');
      return res.status(200).json(JSON.parse(cached));
    }

    const [results] = await db.promise().query('SELECT * FROM officials');
    await redisClient.setEx(CACHE.all, 300, JSON.stringify(results));
    console.log('💾 Cached all officials data');
    return res.json(results);
  } catch (error) {
    console.error('❌ Redis error:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ============================================================
// POST /officials/addOfficial
// Body: { estate_id, full_name, role, contact_number, uid, estate_urn? }
// ============================================================
exports.addOfficial = async (req, res) => {
  const { estate_id, full_name, role, contact_number, uid, estate_urn = null } = req.body;

  const missing = [];
  if (!estate_id)      missing.push('estate_id');
  if (!full_name)      missing.push('full_name');
  if (!role)           missing.push('role');
  if (!contact_number) missing.push('contact_number');
  if (!uid)            missing.push('uid');
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  try {
    // Prevent duplicates by uid or contact_number
    const [dupe] = await db.promise().query(
      `SELECT official_id FROM officials
       WHERE uid = ? OR contact_number = ? LIMIT 1`,
      [uid, contact_number]
    );
    if (dupe.length) {
      return res.status(409).json({ error: 'An official with this UID or contact already exists' });
    }

    const [result] = await db.promise().query(
      `INSERT INTO officials
         (estate_id, full_name, role, contact_number, estate_urn, uid)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [estate_id, full_name.trim(), role, contact_number, estate_urn, uid]
    );

    // Invalidate caches
    await invalidateOfficialCaches(estate_id, uid, contact_number);

    // Best-effort notification (doesn't block response)
    try {
      await sendNotification({
        user_uid: uid,
        user_type: 'USER',
        title: 'Official Added',
        message: `You have been added as ${role}.`,
        type: 'SYSTEM',
      });
    } catch (err) {
      console.warn('⚠️ Notification failed:', err.message);
    }

    return res.json({
      message: 'Official added successfully',
      officialId: result.insertId,
    });
  } catch (err) {
    console.error('❌ Error adding official:', err.message);
    return res.status(500).json({ error: 'Failed to add official' });
  }
};

// ============================================================
// GET /officials/getOfficialByEstateId/:estate_id
// ============================================================
exports.getOfficialByEstateId = async (req, res) => {
  const { estate_id } = req.params;
  const cacheKey = CACHE.byEstate(estate_id);

  try {
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      console.log('🔁 Serving officials from Redis cache');
      return res.status(200).json(JSON.parse(cachedData));
    }

    const [results] = await db.promise().query(
      'SELECT * FROM officials WHERE estate_id = ?',
      [estate_id]
    );

    if (!results.length) {
      return res.status(200).json([]);
    }

    await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
    console.log('💾 Officials cached in Redis');
    return res.status(200).json(results);
  } catch (error) {
    console.error('❌ Redis error:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ============================================================
// GET /officials/getOfficialByContact/:phone
// ============================================================
exports.getOfficialByContact = async (req, res) => {
  const { phone } = req.params;
  const cacheKey = CACHE.byContact(phone);

  try {
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      console.log('🔁 Serving official from Redis cache');
      return res.status(200).json(JSON.parse(cachedData));
    }

    const [results] = await db.promise().query(
      'SELECT * FROM officials WHERE contact_number = ? LIMIT 1',
      [phone]
    );

    if (!results.length) {
      return res.status(404).json({ message: 'Official not found' });
    }

    await redisClient.setEx(cacheKey, 300, JSON.stringify(results[0]));
    return res.status(200).json(results[0]);
  } catch (error) {
    console.error('❌ Redis error:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ============================================================
// GET /officials/getOfficialById/:uid
// ============================================================
exports.getOfficialById = async (req, res) => {
  const { uid } = req.params;

  if (!uid) {
    return res.status(400).json({ error: 'uid is required' });
  }

  const cacheKey = CACHE.byUid(uid);

  try {
    const cachedResult = await redisClient.get(cacheKey);
    if (cachedResult) {
      console.log('🔁 Serving official from Redis cache');
      return res.status(200).json(JSON.parse(cachedResult));
    }

    const [results] = await db.promise().query(
      `SELECT official_id, estate_id, full_name, role, contact_number,
              estate_urn, uid, created_at, updated_at
       FROM officials
       WHERE uid = ?
       LIMIT 1`,
      [uid]
    );

    if (!results.length) {
      return res.status(404).json({ message: 'Official not found' });
    }

    await redisClient.setEx(cacheKey, 300, JSON.stringify(results[0]));
    console.log('💾 Cached official data by UID');
    return res.status(200).json(results[0]);
  } catch (error) {
    console.error('❌ Redis error:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ============================================================
// GET /officials/search?query=
// ============================================================
exports.searchOfficials = async (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  const cacheKey = CACHE.search(query);

  try {
    const cachedResults = await redisClient.get(cacheKey);
    if (cachedResults) {
      console.log('🔁 Serving search results from Redis cache');
      return res.status(200).json(JSON.parse(cachedResults));
    }

    const [results] = await db.promise().query(
      `SELECT full_name, role, contact_number
       FROM officials
       WHERE MATCH(full_name, role, contact_number) AGAINST(? IN NATURAL LANGUAGE MODE)`,
      [query]
    );

    await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
    return res.status(200).json(results);
  } catch (error) {
    console.error('❌ Redis error:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ============================================================
// PATCH /officials/update_official/:id
// Body: { full_name?, role?, contact_number? }
// ============================================================
exports.updateOfficial = async (req, res) => {
  const { id } = req.params;
  const fields = req.body || {};

  if (!id) return res.status(400).json({ error: 'official ID is required' });
  if (!Object.keys(fields).length) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  // Whitelist updatable columns
  const allowed = ['full_name', 'role', 'contact_number'];
  const updates = {};
  for (const k of allowed) {
    if (fields[k] !== undefined && fields[k] !== null && fields[k] !== '') {
      updates[k] = fields[k];
    }
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    // Fetch for cache invalidation
    const [[existing]] = await db.promise().query(
      `SELECT estate_id, uid, contact_number FROM officials WHERE official_id = ? LIMIT 1`,
      [id]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Official not found' });
    }

    const setters = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), id];

    const [result] = await db.promise().query(
      `UPDATE officials SET ${setters} WHERE official_id = ?`,
      values
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Official not found' });
    }

    await invalidateOfficialCaches(
      existing.estate_id,
      existing.uid,
      existing.contact_number
    );

    return res.json({ message: 'Official updated successfully' });
  } catch (err) {
    console.error('Database Error:', err.message);
    return res.status(500).json({ error: 'Failed to update official' });
  }
};

// ============================================================
// PUT /officials/delete_official/:contact_number
// (kept as PUT for backward-compat with the frontend)
// ============================================================
exports.deleteOfficial = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'contact_number is required' });
  }

  try {
    // Fetch for cache invalidation
    const [[existing]] = await db.promise().query(
      `SELECT official_id, estate_id, uid FROM officials WHERE contact_number = ? LIMIT 1`,
      [id]
    );
    if (!existing) {
      return res.status(404).json({ message: 'Official not found' });
    }

    await db.promise().query(
      `DELETE FROM officials WHERE contact_number = ?`,
      [id]
    );

    await invalidateOfficialCaches(existing.estate_id, existing.uid, id);

    return res.json({ message: 'Official deleted successfully' });
  } catch (err) {
    console.error('Delete official error:', err.message);
    return res.status(500).json({ error: 'Failed to delete official' });
  }
};

// ============================================================
// GET /officials/existingOfficial/:phone
// ============================================================
exports.existingOfficial = async (req, res) => {
  const { phone } = req.params;
  const cacheKey = CACHE.exists(phone);

  try {
    const cachedResult = await redisClient.get(cacheKey);
    if (cachedResult) {
      console.log('🔁 Serving official existence from Redis cache');
      return res.status(200).json(JSON.parse(cachedResult));
    }

    const [results] = await db.promise().query(
      'SELECT 1 FROM officials WHERE contact_number = ? LIMIT 1',
      [phone]
    );

    const response = results.length
      ? { exists: true, message: `Official with ${phone} exists.` }
      : { exists: false, message: `No official with ${phone}.` };

    await redisClient.setEx(cacheKey, 300, JSON.stringify(response));
    return res.json(response);
  } catch (error) {
    console.error('❌ Redis error:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
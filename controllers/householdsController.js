// controllers/households/households.js
const db = require('../config/db');
const redisClient = require('../config/redis');
const { generateHouseholdUrn } = require('../utils/billing');
const { sendNotification } = require('../utils/notify');

// ------------------------------------------------------------------
// Cache key helpers — keep them consistent so invalidation works
// ------------------------------------------------------------------
const CACHE = {
  all:                'households:all',
  byEstate:      (id) => `households:estate:${id}`,
  byAddress: (e, s, st, c) =>
    `households:addr:${e}:${s || 'all'}:${st || 'all'}:${c || 'all'}`,
  byPk:          (pk) => `household:pk:${pk}`,
  byUid:        (uid) => `household:uid:${uid}`,
  byPhone: (e, phone) => `household:phone:${e}:${phone}`,
  searchEstate: (e, q) => `households:search:${e}:${q}`,
  searchAll:       (q) => `households:search:all:${q}`,
  active:     (flag)   => `households:active:${flag}`,
  activeEstate: (flag, e) => `households:active:${flag}:estate:${e}`,
  officials:  (flag)   => `households:officials:${flag}`,
  dropdowns:     (e)   => `estate:${e}:dropdowns`,
};

async function invalidateHouseholdCaches(estateId, pk, uid) {
  const keys = [
    CACHE.all,
    CACHE.byEstate(estateId),
    CACHE.active(0), CACHE.active(1),
    CACHE.activeEstate(0, estateId), CACHE.activeEstate(1, estateId),
    CACHE.officials(0), CACHE.officials(1),
    CACHE.byPk(pk),
    CACHE.byUid(uid),
    CACHE.dropdowns(estateId),
  ];
  await Promise.all(keys.map((k) => redisClient.del(k)));
}

// ==================================================================
// READS
// ==================================================================

// GET /households/by-address?estate_id=&section=&street=&court=
exports.getHouseholdsByAddress = async (req, res) => {
  const { estate_id, section, street, court } = req.query;

  if (!estate_id) {
    return res.status(400).json({ error: 'estate_id is required' });
  }

  const cacheKey = CACHE.byAddress(estate_id, section, street, court);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const conditions = ["estate_id = ?", "status = 'Approved'"];
    const values = [estate_id];

    if (section) { conditions.push('section = ?'); values.push(section); }
    if (street)  { conditions.push('street = ?');  values.push(street); }
    if (court)   { conditions.push('court = ?');   values.push(court); }

    const sql = `
      SELECT
        household_id, uid, primary_owner, contact_number, house_number,
        section, street, court, active, status, take_on_balance
      FROM households
      WHERE ${conditions.join(' AND ')}
      ORDER BY section, street, court, house_number
    `;

    const [rows] = await db.promise().query(sql, values);
    await redisClient.setEx(cacheKey, 200, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('getHouseholdsByAddress error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch households' });
  }
};

// GET /households
exports.getAllHouseholds = async (req, res) => {
  try {
    const cached = await redisClient.get(CACHE.all);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT * FROM households ORDER BY created_at DESC`
    );
    await redisClient.setEx(CACHE.all, 60, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('getAllHouseholds error:', err.message);
    return res.status(500).json({ error: 'Error getting households' });
  }
};

// GET /households/uid/:uid   ← resolve by Firebase UID (what the app has)
exports.getHouseholdByUid = async (req, res) => {
  const { uid } = req.params;
  const cacheKey = CACHE.byUid(uid);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT * FROM households WHERE uid = ? LIMIT 1`,
      [uid]
    );
    if (!rows.length) {
      return res.status(404).json({ message: 'Household not found' });
    }
    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows[0]));
    return res.json(rows[0]);
  } catch (err) {
    console.error('getHouseholdByUid error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// GET /households/:id   ← resolve by primary key
exports.getHouseholdById = async (req, res) => {
  const { id } = req.params;
  const cacheKey = CACHE.byPk(id);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT * FROM households WHERE household_id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ message: 'Household not found' });
    }
    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows[0]));
    return res.json(rows[0]);
  } catch (err) {
    console.error('getHouseholdById error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// GET /households/estate/:estateId/phone/:phone
exports.getHouseholdByPhone = async (req, res) => {
  const { estateId, phone } = req.params;
  const cacheKey = CACHE.byPhone(estateId, phone);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT * FROM households
       WHERE contact_number = ? AND estate_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [phone, estateId]
    );
    if (!rows.length) {
      return res.status(404).json({ message: 'Household not found' });
    }
    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows[0]));
    return res.json(rows[0]);
  } catch (err) {
    console.error('getHouseholdByPhone error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// GET /households/estate/:id/search?query=
exports.searchHouseholdsId = async (req, res) => {
  const { id } = req.params;
  const { query } = req.query;

  if (!query) return res.status(400).json({ error: 'Search query is required' });

  const cacheKey = CACHE.searchEstate(id, query);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const sql = `
      SELECT * FROM households
      WHERE estate_id = ?
        AND status = 'Approved'
        AND (primary_owner LIKE ?
          OR contact_number LIKE ?
          OR house_number LIKE ?
          OR uid LIKE ?)
    `;
    const pat = `%${query}%`;
    const [rows] = await db.promise().query(sql, [id, pat, pat, pat, pat]);

    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('searchHouseholdsId error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// GET /households/search?query=
exports.searchHouseholds = async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Search query is required' });

  const cacheKey = CACHE.searchAll(query);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const sql = `
      SELECT * FROM households
      WHERE status = 'Approved'
        AND (primary_owner LIKE ?
          OR contact_number LIKE ?
          OR house_number LIKE ?
          OR uid LIKE ?)
    `;
    const pat = `%${query}%`;
    const [rows] = await db.promise().query(sql, [pat, pat, pat, pat]);

    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('searchHouseholds error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// GET /households/active/:active
exports.getActiveHouseHolds = async (req, res) => {
  const flag = normalizeBool(req.params.active);
  if (flag === null) {
    return res.status(400).json({ error: 'active must be 0 or 1' });
  }

  const cacheKey = CACHE.active(flag);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT * FROM households
       WHERE active = ? AND status = 'Approved'
       ORDER BY created_at DESC`,
      [flag]
    );
    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('getActiveHouseHolds error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// GET /households/active/:active/estate/:estate_id
exports.getActiveEstate = async (req, res) => {
  const flag = normalizeBool(req.params.active);
  const { estate_id } = req.params;
  if (flag === null || !estate_id) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const cacheKey = CACHE.activeEstate(flag, estate_id);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT * FROM households
       WHERE active = ? AND estate_id = ? AND status = 'Approved'
       ORDER BY created_at DESC`,
      [flag, estate_id]
    );
    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('getActiveEstate error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// GET /households/officials/:flag   ← flag 0|1
exports.getOfficials = async (req, res) => {
  const flag = normalizeBool(req.params.is_official);
  if (flag === null) {
    return res.status(400).json({ error: 'is_official must be 0 or 1' });
  }

  const cacheKey = CACHE.officials(flag);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT * FROM households
       WHERE is_official = ? AND status = 'Approved'
       ORDER BY created_at DESC`,
      [flag]
    );
    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('getOfficials error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// GET /households/estate/:id
exports.getHsHlByEstateId = async (req, res) => {
  const { id } = req.params;
  const cacheKey = CACHE.byEstate(id);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT * FROM households
       WHERE estate_id = ? AND status = 'Approved'
       ORDER BY created_at DESC`,
      [id]
    );
    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('getHsHlByEstateId error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ==================================================================
// ADDRESS DROPDOWNS (for registration + filters)
// ==================================================================

/**
 * GET /households/address-dropdowns/:estate_id
 * Returns the section / court / street lists for an estate.
 * Used by the registration form and filter controls.
 */
exports.getAddressDropdowns = async (req, res) => {
  const { estate_id } = req.params;

  if (!estate_id) {
    return res.status(400).json({ error: 'estate_id is required' });
  }

  const cacheKey = CACHE.dropdowns(estate_id);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [sections] = await db.promise().query(
      `SELECT section_name FROM estate_sections
       WHERE estate_id = ? AND active = 1
       ORDER BY section_name`,
      [estate_id]
    );
    const [courts] = await db.promise().query(
      `SELECT court_name FROM estate_courts
       WHERE estate_id = ? AND active = 1
       ORDER BY court_name`,
      [estate_id]
    );
    const [streets] = await db.promise().query(
      `SELECT street_name FROM estate_streets
       WHERE estate_id = ? AND active = 1
       ORDER BY street_name`,
      [estate_id]
    );

    const result = {
      estate_id: Number(estate_id),
      sections: sections.map((r) => r.section_name),
      courts:   courts.map((r) => r.court_name),
      streets:  streets.map((r) => r.street_name),
    };

    await redisClient.setEx(cacheKey, 300, JSON.stringify(result));
    return res.json(result);
  } catch (err) {
    console.error('getAddressDropdowns error:', err.message);
    return res.status(500).json({ error: 'Failed to load address options' });
  }
};

/**
 * GET /households/address-config/:estate_id
 * Returns which address components are visible for an estate.
 */
exports.getEstateAddressConfig = async (req, res) => {
  const { estate_id } = req.params;

  try {
    const [rows] = await db.promise().query(
      `SELECT show_street, show_section, show_court
       FROM estate_address_config WHERE estate_id = ? LIMIT 1`,
      [estate_id]
    );

    if (!rows.length) {
      return res.json({
        show_street: true,
        show_section: true,
        show_court: true,
      });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('getEstateAddressConfig error:', err.message);
    return res.status(500).json({ error: 'Failed to load estate config' });
  }
};

// ==================================================================
// WRITES
// ==================================================================

// POST /households
// Official registers a household on behalf. Auto-approved.
exports.createHousehold = async (req, res) => {
  const {
    estate_id, primary_owner, spouse_name = null, caretaker_name = null,
    residence_status, contact_number, house_number = null,
    section, court, street,
    is_official = 0, official_role = null,
    take_on_balance = 0,
    uid,
  } = req.body;

  const missing = [];
  if (!estate_id)        missing.push('estate_id');
  if (!primary_owner)    missing.push('primary_owner');
  if (!residence_status) missing.push('residence_status');
  if (!contact_number)   missing.push('contact_number');
  if (!section)          missing.push('section');
  if (!court)            missing.push('court');
  if (!street)           missing.push('street');

  if (missing.length) {
    return res.status(400).json({
      error: `Missing required fields: ${missing.join(', ')}`,
    });
  }

  if (residence_status === 'Non-resident' && !caretaker_name) {
    return res.status(400).json({
      error: 'Caretaker name is required when residence status is Non-resident',
    });
  }

  const tob = Number(take_on_balance) || 0;
  if (tob < 0) {
    return res.status(400).json({ error: 'take_on_balance must be >= 0' });
  }

  try {
    const [estates] = await db.promise().query(
      `SELECT estate_id, estate_urn FROM estates WHERE estate_id = ? LIMIT 1`,
      [estate_id]
    );
    if (!estates.length) {
      return res.status(404).json({ error: 'Estate not found' });
    }

    const [dupe] = await db.promise().query(
      `SELECT household_id FROM households
       WHERE contact_number = ? AND estate_id = ? LIMIT 1`,
      [contact_number, estate_id]
    );
    if (dupe.length) {
      return res.status(409).json({
        error: 'A household with this contact number already exists in this estate',
      });
    }

    let householdUrn = uid || null;
    if (!householdUrn) {
      let collision = true, attempts = 0;
      while (collision && attempts < 5) {
        householdUrn = generateHouseholdUrn(estates[0].estate_urn);
        const [c] = await db.promise().query(
          `SELECT 1 FROM households WHERE uid = ? LIMIT 1`,
          [householdUrn]
        );
        collision = c.length > 0;
        attempts++;
      }
      if (collision) {
        return res.status(500).json({ error: 'Failed to generate unique URN' });
      }
    }

    const sql = `
      INSERT INTO households (
        estate_id, uid, primary_owner, spouse_name, caretaker_name,
        residence_status, contact_number, house_number,
        section, court, street,
        is_official, official_role, active,
        status, take_on_balance
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Approved', ?)
    `;
    const values = [
      estate_id, householdUrn, primary_owner, spouse_name, caretaker_name,
      residence_status, contact_number, house_number,
      section, court, street,
      is_official ? 1 : 0, official_role, tob,
    ];

    const [result] = await db.promise().query(sql, values);

    const year = new Date().getFullYear();
    await db.promise().query(
      `INSERT INTO household_payments
         (household_id, estate_id, full_name, section, street, court,
          year, balance_brought_forward, uid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         full_name = VALUES(full_name),
         section = VALUES(section),
         street = VALUES(street),
         court = VALUES(court),
         balance_brought_forward = VALUES(balance_brought_forward)`,
      [result.insertId, estate_id, primary_owner, section, street, court,
       year, tob, householdUrn]
    );

    await invalidateHouseholdCaches(estate_id, result.insertId, householdUrn);

    return res.status(201).json({
      message: 'Household created successfully',
      householdId: result.insertId,
      urn: householdUrn,
      status: 'Approved',
    });
  } catch (err) {
    console.error('createHousehold error:', err.message);
    return res.status(500).json({ error: 'Failed to create household' });
  }
};

// PATCH /households/:id/roles
exports.updateHouseholdRoles = async (req, res) => {
  const { household_id, is_official, official_role } = req.body;
  if (!household_id) return res.status(400).json({ error: 'household_id is required' });

  try {
    const [result] = await db.promise().query(
      `UPDATE households SET is_official = ?, official_role = ?
       WHERE household_id = ?`,
      [is_official ? 1 : 0, official_role || null, household_id]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Household not found' });
    }

    const [[h]] = await db.promise().query(
      `SELECT estate_id, uid FROM households WHERE household_id = ?`,
      [household_id]
    );
    if (h) await invalidateHouseholdCaches(h.estate_id, household_id, h.uid);

    return res.json({ message: 'Household roles updated' });
  } catch (err) {
    console.error('updateHouseholdRoles error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// GET /households/exists/:phone?estate_id=
exports.existingHousehold = async (req, res) => {
  const { phone } = req.params;
  const { estate_id } = req.query;

  try {
    let sql = `SELECT household_id FROM households WHERE contact_number = ?`;
    const params = [phone];
    if (estate_id) {
      sql += ` AND estate_id = ?`;
      params.push(estate_id);
    }
    sql += ` LIMIT 1`;

    const [rows] = await db.promise().query(sql, params);
    return res.json({
      exists: rows.length > 0,
      message: rows.length
        ? `Phone ${phone} already registered`
        : `Phone ${phone} is available`,
    });
  } catch (err) {
    console.error('existingHousehold error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// PUT /households/:id
exports.updateHousehold = async (req, res) => {
  const { id } = req.params;
  const fields = req.body;

  if (!id) return res.status(400).json({ error: 'household ID is required' });
  if (!Object.keys(fields).length) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const blocked = ['household_id', 'uid', 'created_at', 'approved_by', 'approved_at'];
  for (const k of blocked) delete fields[k];

  if (!Object.keys(fields).length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const setters = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  const values = [...Object.values(fields), id];

  try {
    const [result] = await db.promise().query(
      `UPDATE households SET ${setters} WHERE household_id = ?`,
      values
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Household not found' });
    }

    const [[h]] = await db.promise().query(
      `SELECT estate_id, uid FROM households WHERE household_id = ?`,
      [id]
    );
    if (h) await invalidateHouseholdCaches(h.estate_id, id, h.uid);

    return res.json({ message: 'Household updated successfully' });
  } catch (err) {
    console.error('updateHousehold error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /households/:id
exports.deleteHousehold = async (req, res) => {
  const { id } = req.params;

  try {
    const [[h]] = await db.promise().query(
      `SELECT estate_id, uid FROM households WHERE household_id = ?`,
      [id]
    );
    if (!h) return res.status(404).json({ error: 'Household not found' });

    await db.promise().query(
      `DELETE FROM households WHERE household_id = ?`,
      [id]
    );

    await invalidateHouseholdCaches(h.estate_id, id, h.uid);
    return res.json({ message: 'Household deleted successfully' });
  } catch (err) {
    console.error('deleteHousehold error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ==================================================================
// Helpers
// ==================================================================

function normalizeBool(v) {
  if (v === 1 || v === '1' || v === true  || v === 'true')  return 1;
  if (v === 0 || v === '0' || v === false || v === 'false') return 0;
  return null;
}
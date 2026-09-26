const db = require('../config/db');
const redisClient = require('../config/redis');

const CACHE_TTL = 600; // 10 min

// ============================================================
// Helpers
// ============================================================

async function invalidateDropdownCache(estateId) {
  try {
    await redisClient.del([
      `dropdowns:${estateId}`,
      `address-config:${estateId}`,
    ]);
  } catch (err) {
    console.warn('⚠️ Cache invalidation failed:', err.message);
  }
}

// ============================================================
// GET CONFIG
// ============================================================

exports.getEstateAddressConfig = async (req, res) => {
  const { estate_id } = req.params;
  const cacheKey = `address-config:${estate_id}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT show_street, show_section, show_court, show_house_number
       FROM estate_address_config
       WHERE estate_id = ?`,
      [estate_id]
    );

    const config = rows[0] || {
      show_street: true,
      show_section: true,
      show_court: true,
      show_house_number: true,
    };

    await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(config));
    res.json(config);
  } catch (err) {
    console.error('❌ getEstateAddressConfig:', err.message);
    res.status(500).json({ error: 'Failed to fetch address config' });
  }
};

/**
 * @deprecated Use getEstateAddressConfig instead.
 * Kept as alias for backward compatibility.
 */
exports.getAddressConfig = exports.getEstateAddressConfig;

// ============================================================
// SAVE / UPDATE CONFIG (upsert)
// ============================================================

exports.saveEstateAddressConfig = async (req, res) => {
  const {
    estate_id,
    show_street = 1,
    show_section = 1,
    show_court = 1,
    show_house_number = 1,
  } = req.body;

  if (!estate_id) {
    return res.status(400).json({ error: 'estate_id is required' });
  }

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

    await invalidateDropdownCache(estate_id);
    res.json({ message: 'Estate address configuration saved' });
  } catch (err) {
    console.error('❌ saveEstateAddressConfig:', err.message);
    res.status(500).json({ error: 'Failed to save config' });
  }
};

/**
 * @deprecated Use saveEstateAddressConfig instead.
 * Kept as alias for backward compatibility.
 */
exports.createEstateAddress = exports.saveEstateAddressConfig;

// ============================================================
// DROPDOWN VALUES (REGISTRATION)
// ============================================================

exports.getAddressDropdowns = async (req, res) => {
  const { estate_id } = req.params;
  const cacheKey = `dropdowns:${estate_id}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [
      [sections],
      [courts],
      [streets],
    ] = await Promise.all([
      db.promise().query(
        'SELECT section_name FROM estate_sections WHERE estate_id = ? AND active = 1 ORDER BY section_name',
        [estate_id]
      ),
      db.promise().query(
        'SELECT court_name FROM estate_courts WHERE estate_id = ? AND active = 1 ORDER BY court_name',
        [estate_id]
      ),
      db.promise().query(
        'SELECT street_name FROM estate_streets WHERE estate_id = ? AND active = 1 ORDER BY street_name',
        [estate_id]
      ),
    ]);

    // Doc §1.2 — "Not Applicable" is always the last option
    const withNA = (arr, key) => [...arr.map((r) => r[key]), 'Not Applicable'];

    const result = {
      sections: withNA(sections, 'section_name'),
      courts: withNA(courts, 'court_name'),
      streets: withNA(streets, 'street_name'),
    };

    await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(result));
    res.json(result);
  } catch (err) {
    console.error('❌ getAddressDropdowns:', err.message);
    res.status(500).json({ error: 'Failed to load dropdowns' });
  }
};

// ============================================================
// ADD ADDRESS COMPONENTS
// ============================================================

exports.addSection = async (req, res) => {
  const { estate_id, section_name } = req.body;
  if (!estate_id || !section_name) {
    return res
      .status(400)
      .json({ error: 'estate_id and section_name are required' });
  }
  try {
    const [result] = await db
      .promise()
      .query(
        'INSERT INTO estate_sections (estate_id, section_name) VALUES (?, ?)',
        [estate_id, section_name]
      );
    await invalidateDropdownCache(estate_id);
    res.status(201).json({ message: 'Section added', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res
        .status(409)
        .json({ error: 'Section already exists in this estate' });
    }
    console.error('❌ addSection:', err.message);
    res.status(500).json({ error: 'Failed to add section' });
  }
};

exports.addCourt = async (req, res) => {
  const { estate_id, court_name } = req.body;
  if (!estate_id || !court_name) {
    return res
      .status(400)
      .json({ error: 'estate_id and court_name are required' });
  }
  try {
    const [result] = await db
      .promise()
      .query(
        'INSERT INTO estate_courts (estate_id, court_name) VALUES (?, ?)',
        [estate_id, court_name]
      );
    await invalidateDropdownCache(estate_id);
    res.status(201).json({ message: 'Court added', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res
        .status(409)
        .json({ error: 'Court already exists in this estate' });
    }
    console.error('❌ addCourt:', err.message);
    res.status(500).json({ error: 'Failed to add court' });
  }
};

exports.addStreet = async (req, res) => {
  const { estate_id, street_name } = req.body;
  if (!estate_id || !street_name) {
    return res
      .status(400)
      .json({ error: 'estate_id and street_name are required' });
  }
  try {
    const [result] = await db
      .promise()
      .query(
        'INSERT INTO estate_streets (estate_id, street_name) VALUES (?, ?)',
        [estate_id, street_name]
      );
    await invalidateDropdownCache(estate_id);
    res.status(201).json({ message: 'Street added', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res
        .status(409)
        .json({ error: 'Street already exists in this estate' });
    }
    console.error('❌ addStreet:', err.message);
    res.status(500).json({ error: 'Failed to add street' });
  }
};
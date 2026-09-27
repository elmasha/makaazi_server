// controllers/adminController.js
const db = require('../config/db');
const redisClient = require('../config/redis');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// ============================================================
// Helper
// ============================================================
async function logAdminAction(adminEmail, action, entityType, entityId, details) {
  try {
    await db.promise().query(
      `INSERT INTO admin_audit_logs (admin_email, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?)`,
      [adminEmail, action, entityType || null, entityId || null, details ? JSON.stringify(details) : null]
    );
  } catch (e) {
    console.warn('Audit log failed:', e.message);
  }
}

function generateEstateUrn(prefix) {
  const safe = String(prefix || 'EST')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5) || 'EST';
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
  return `${safe}-${ts}-${rand}`;
}

// ============================================================
// POST /api/admin/login
// Body: { email, token }
// Validates against ADMIN_EMAILS + ADMIN_SHARED_SECRET
// ============================================================
exports.adminLogin = async (req, res) => {
  const { email, token } = req.body;

  if (!email || !token) {
    return res.status(400).json({ error: 'email and token are required' });
  }

  const normalized = String(email).toLowerCase().trim();

  if (!ADMIN_EMAILS.includes(normalized)) {
    return res.status(403).json({ error: 'This email is not authorized for admin access' });
  }

  if (token !== process.env.ADMIN_SHARED_SECRET) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }

  await logAdminAction(normalized, 'login', 'admin', null, { ip: req.ip });

  return res.json({
    message: 'Login successful',
    admin: { email: normalized },
    token: process.env.ADMIN_SHARED_SECRET,
  });
};

// ============================================================
// GET /api/admin/stats
// Platform-wide numbers for the dashboard
// ============================================================
exports.getPlatformStats = async (req, res) => {
  try {
    const [[{ total_estates }]] = await db.promise().query(
      `SELECT COUNT(*) AS total_estates FROM estates WHERE status != 'Archived'`
    );
    const [[{ active_estates }]] = await db.promise().query(
      `SELECT COUNT(*) AS active_estates FROM estates WHERE status = 'Active'`
    );
    const [[{ total_households }]] = await db.promise().query(
      `SELECT COUNT(*) AS total_households FROM households WHERE status = 'Approved'`
    );
    const [[{ pending_households }]] = await db.promise().query(
      `SELECT COUNT(*) AS pending_households FROM households WHERE status = 'Pending'`
    );
    const [[{ total_officials }]] = await db.promise().query(
      `SELECT COUNT(*) AS total_officials FROM officials`
    );
    const [[{ total_collected }]] = await db.promise().query(
      `SELECT COALESCE(SUM(amount_paid), 0) AS total_collected
       FROM payments WHERE payment_status = 'Completed'`
    );
    const [[{ collected_this_year }]] = await db.promise().query(
      `SELECT COALESCE(SUM(amount_paid), 0) AS collected_this_year
       FROM payments
       WHERE payment_status = 'Completed' AND YEAR(payment_date) = YEAR(CURDATE())`
    );
    const [[{ active_subs }]] = await db.promise().query(
      `SELECT COUNT(*) AS active_subs FROM estate_subscriptions WHERE is_active = 1`
    );

    return res.json({
      total_estates,
      active_estates,
      total_households,
      pending_households,
      total_officials,
      total_collected: Number(total_collected),
      collected_this_year: Number(collected_this_year),
      active_subscriptions: active_subs,
    });
  } catch (err) {
    console.error('getPlatformStats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch platform stats' });
  }
};

// ============================================================
// GET /api/admin/estates
// List all estates with their key stats
// Query: ?search=&status=
// ============================================================
exports.listEstates = async (req, res) => {
  const { search, status } = req.query;

  try {
    let sql = `
      SELECT
        e.estate_id, e.estate_name, e.estate_urn, e.urn_prefix, e.estate_location,
        e.latitude, e.longitude, e.estate_image, e.logo_url,
        e.welfare_mandatory, e.status, e.created_at,
        (SELECT COUNT(*) FROM households h
         WHERE h.estate_id = e.estate_id AND h.status = 'Approved') AS household_count,
        (SELECT COUNT(*) FROM officials o
         WHERE o.estate_id = e.estate_id) AS official_count,
        (SELECT COALESCE(SUM(p.amount_paid), 0) FROM payments p
         WHERE p.estate_id = e.estate_id AND p.payment_status = 'Completed') AS total_collected
      FROM estates e
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ` AND e.status = ?`;
      params.push(status);
    } else {
      sql += ` AND e.status != 'Archived'`;
    }

    if (search) {
      sql += ` AND (e.estate_name LIKE ? OR e.estate_urn LIKE ? OR e.estate_location LIKE ?)`;
      const pat = `%${search}%`;
      params.push(pat, pat, pat);
    }

    sql += ` ORDER BY e.created_at DESC`;

    const [rows] = await db.promise().query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('listEstates error:', err.message);
    return res.status(500).json({ error: 'Failed to list estates' });
  }
};

// ============================================================
// GET /api/admin/estates/:id
// Single estate with full details
// ============================================================
exports.getEstate = async (req, res) => {
  const { id } = req.params;

  try {
    const [[estate]] = await db.promise().query(
      `SELECT * FROM estates WHERE estate_id = ?`,
      [id]
    );
    if (!estate) return res.status(404).json({ error: 'Estate not found' });

    const [[addressConfig]] = await db.promise().query(
      `SELECT * FROM estate_address_config WHERE estate_id = ? LIMIT 1`,
      [id]
    );
    const [charges] = await db.promise().query(
      `SELECT * FROM service_charges WHERE estate_id = ? ORDER BY charge_type`,
      [id]
    );
    const [officials] = await db.promise().query(
      `SELECT official_id, full_name, role, contact_number, uid FROM officials WHERE estate_id = ?`,
      [id]
    );
    const [sections] = await db.promise().query(
      `SELECT id, section_name, active FROM estate_sections WHERE estate_id = ? ORDER BY section_name`,
      [id]
    );
    const [courts] = await db.promise().query(
      `SELECT id, court_name, active FROM estate_courts WHERE estate_id = ? ORDER BY court_name`,
      [id]
    );
    const [streets] = await db.promise().query(
      `SELECT id, street_name, active FROM estate_streets WHERE estate_id = ? ORDER BY street_name`,
      [id]
    );
    const [[stats]] = await db.promise().query(
      `SELECT
         (SELECT COUNT(*) FROM households WHERE estate_id = ? AND status = 'Approved') AS household_count,
         (SELECT COUNT(*) FROM households WHERE estate_id = ? AND status = 'Pending') AS pending_count,
         (SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE estate_id = ? AND payment_status = 'Completed') AS total_collected`,
      [id, id, id]
    );

    return res.json({
      estate,
      address_config: addressConfig || null,
      charges,
      officials,
      sections,
      courts,
      streets,
      stats,
    });
  } catch (err) {
    console.error('getEstate error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch estate' });
  }
};

// ============================================================
// POST /api/admin/estates
// Create estate (with address config) in ONE transaction
// Body:
// {
//   estate_name, estate_location, latitude, longitude,
//   urn_prefix, welfare_mandatory,
//   estate_image, logo_url,
//   address_config: { show_street, show_section, show_court, show_house_number }
// }
// ============================================================
exports.createEstate = async (req, res) => {
  const {
    estate_name,
    estate_location,
    latitude,
    longitude,
    urn_prefix,
    welfare_mandatory = 0,
    estate_image,
    logo_url,
    address_config = {},
  } = req.body;

  if (!estate_name) {
    return res.status(400).json({ error: 'estate_name is required' });
  }

  const prefix = (urn_prefix || estate_name.slice(0, 5)).toUpperCase();
  const estate_urn = generateEstateUrn(prefix);

  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO estates
         (estate_name, estate_urn, urn_prefix, estate_location,
          latitude, longitude, estate_image, logo_url, welfare_mandatory, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
      [
        estate_name,
        estate_urn,
        prefix,
        estate_location || null,
        latitude != null ? Number(latitude) : null,
        longitude != null ? Number(longitude) : null,
        estate_image || null,
        logo_url || null,
        welfare_mandatory ? 1 : 0,
      ]
    );

    const estate_id = result.insertId;

    await connection.query(
      `INSERT INTO estate_address_config
         (estate_id, show_street, show_section, show_court, show_house_number)
       VALUES (?, ?, ?, ?, ?)`,
      [
        estate_id,
        address_config.show_street ?? 1,
        address_config.show_section ?? 1,
        address_config.show_court ?? 1,
        address_config.show_house_number ?? 1,
      ]
    );

    await connection.commit();
    await redisClient.del('estates');

    await logAdminAction(req.admin?.email, 'create_estate', 'estate', estate_id, {
      estate_name,
      estate_urn,
    });

    return res.status(201).json({
      message: 'Estate created',
      estate_id,
      estate_urn,
    });
  } catch (err) {
    await connection.rollback();
    console.error('createEstate error:', err.message);
    return res.status(500).json({ error: 'Failed to create estate' });
  } finally {
    connection.release();
  }
};

// ============================================================
// PATCH /api/admin/estates/:id
// Update estate basics
// ============================================================
exports.updateEstate = async (req, res) => {
  const { id } = req.params;
  const allowed = [
    'estate_name',
    'estate_location',
    'latitude',
    'longitude',
    'estate_image',
    'logo_url',
    'urn_prefix',
    'welfare_mandatory',
    'status',
  ];

  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const setters = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), id];

  try {
    const [result] = await db.promise().query(
      `UPDATE estates SET ${setters} WHERE estate_id = ?`,
      values
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Estate not found' });

    await redisClient.del('estates');
    await redisClient.del(`estate:${id}`);

    await logAdminAction(req.admin?.email, 'update_estate', 'estate', id, updates);

    return res.json({ message: 'Estate updated' });
  } catch (err) {
    console.error('updateEstate error:', err.message);
    return res.status(500).json({ error: 'Failed to update estate' });
  }
};

// ============================================================
// POST /api/admin/estates/:id/status
// Body: { status: 'Active' | 'Inactive' | 'Archived' }
// ============================================================
exports.setEstateStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['Active', 'Inactive', 'Archived'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const [result] = await db.promise().query(
      `UPDATE estates SET status = ? WHERE estate_id = ?`,
      [status, id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Estate not found' });

    await redisClient.del('estates');
    await redisClient.del(`estate:${id}`);
    await logAdminAction(req.admin?.email, 'set_estate_status', 'estate', id, { status });

    return res.json({ message: `Estate status set to ${status}` });
  } catch (err) {
    console.error('setEstateStatus error:', err.message);
    return res.status(500).json({ error: 'Failed to update status' });
  }
};

// ============================================================
// POST /api/admin/estates/:id/address-config
// Upsert address config flags
// ============================================================
exports.setAddressConfig = async (req, res) => {
  const { id } = req.params;
  const {
    show_street = 1,
    show_section = 1,
    show_court = 1,
    show_house_number = 1,
  } = req.body;

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
        id,
        show_street ? 1 : 0,
        show_section ? 1 : 0,
        show_court ? 1 : 0,
        show_house_number ? 1 : 0,
      ]
    );
    await redisClient.del(`address-config:${id}`);
    await logAdminAction(req.admin?.email, 'set_address_config', 'estate', id, req.body);
    return res.json({ message: 'Address config saved' });
  } catch (err) {
    console.error('setAddressConfig error:', err.message);
    return res.status(500).json({ error: 'Failed to save config' });
  }
};

// ============================================================
// POST /api/admin/estates/:id/charges
// Add a service charge
// Body: { charge_type, frequency, amount }
// ============================================================
exports.addCharge = async (req, res) => {
  const { id } = req.params;
  const { charge_type, frequency, amount } = req.body;

  if (!charge_type || !frequency || amount == null) {
    return res.status(400).json({ error: 'charge_type, frequency, and amount are required' });
  }

  try {
    const [result] = await db.promise().query(
      `INSERT INTO service_charges (estate_id, charge_type, frequency, amount)
       VALUES (?, ?, ?, ?)`,
      [id, charge_type, frequency, Number(amount)]
    );
    await redisClient.del(`service_charges/:${id}`);
    await logAdminAction(req.admin?.email, 'add_charge', 'estate', id, {
      charge_type,
      frequency,
      amount,
    });
    return res.status(201).json({ message: 'Charge added', charges_id: result.insertId });
  } catch (err) {
    console.error('addCharge error:', err.message);
    return res.status(500).json({ error: 'Failed to add charge' });
  }
};

// ============================================================
// DELETE /api/admin/charges/:chargeId
// ============================================================
exports.deleteCharge = async (req, res) => {
  const { chargeId } = req.params;
  try {
    const [result] = await db.promise().query(
      `DELETE FROM service_charges WHERE charges_id = ?`,
      [chargeId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Charge not found' });
    await logAdminAction(req.admin?.email, 'delete_charge', 'charge', chargeId, null);
    return res.json({ message: 'Charge deleted' });
  } catch (err) {
    console.error('deleteCharge error:', err.message);
    return res.status(500).json({ error: 'Failed to delete charge' });
  }
};

// ============================================================
// POST /api/admin/estates/:id/sections
// POST /api/admin/estates/:id/courts
// POST /api/admin/estates/:id/streets
// ============================================================
exports.addSection = async (req, res) => {
  const { id } = req.params;
  const { section_name } = req.body;
  if (!section_name) return res.status(400).json({ error: 'section_name required' });

  try {
    const [r] = await db.promise().query(
      `INSERT INTO estate_sections (estate_id, section_name) VALUES (?, ?)`,
      [id, section_name]
    );
    await redisClient.del(`dropdowns:${id}`);
    return res.status(201).json({ message: 'Section added', id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Section already exists' });
    }
    return res.status(500).json({ error: 'Failed to add section' });
  }
};

exports.addCourt = async (req, res) => {
  const { id } = req.params;
  const { court_name } = req.body;
  if (!court_name) return res.status(400).json({ error: 'court_name required' });

  try {
    const [r] = await db.promise().query(
      `INSERT INTO estate_courts (estate_id, court_name) VALUES (?, ?)`,
      [id, court_name]
    );
    await redisClient.del(`dropdowns:${id}`);
    return res.status(201).json({ message: 'Court added', id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Court already exists' });
    }
    return res.status(500).json({ error: 'Failed to add court' });
  }
};

exports.addStreet = async (req, res) => {
  const { id } = req.params;
  const { street_name } = req.body;
  if (!street_name) return res.status(400).json({ error: 'street_name required' });

  try {
    const [r] = await db.promise().query(
      `INSERT INTO estate_streets (estate_id, street_name) VALUES (?, ?)`,
      [id, street_name]
    );
    await redisClient.del(`dropdowns:${id}`);
    return res.status(201).json({ message: 'Street added', id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Street already exists' });
    }
    return res.status(500).json({ error: 'Failed to add street' });
  }
};

// ============================================================
// POST /api/admin/estates/:id/first-official
// Creates the first Chairman official
// Body: { full_name, contact_number, uid, email? }
// ============================================================
exports.createFirstOfficial = async (req, res) => {
  const { id } = req.params;
  const { full_name, contact_number, uid, email } = req.body;

  if (!full_name || !contact_number) {
    return res.status(400).json({ error: 'full_name and contact_number required' });
  }

  try {
    const [[estate]] = await db.promise().query(
      `SELECT estate_urn FROM estates WHERE estate_id = ?`,
      [id]
    );
    if (!estate) return res.status(404).json({ error: 'Estate not found' });

    const [result] = await db.promise().query(
      `INSERT INTO officials (estate_id, full_name, role, contact_number, estate_urn, uid)
       VALUES (?, ?, 'Chairman', ?, ?, ?)`,
      [id, full_name, contact_number, estate.estate_urn, uid || null]
    );

    await logAdminAction(req.admin?.email, 'create_first_official', 'estate', id, {
      full_name,
      contact_number,
    });

    return res.status(201).json({
      message: 'First official created',
      official_id: result.insertId,
    });
  } catch (err) {
    console.error('createFirstOfficial error:', err.message);
    return res.status(500).json({ error: 'Failed to create official' });
  }
};

// ============================================================
// GET /api/admin/audit-logs
// Recent admin actions
// ============================================================
exports.getAuditLogs = async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT * FROM admin_audit_logs ORDER BY id DESC LIMIT 100`
    );
    return res.json(rows);
  } catch (err) {
    console.error('getAuditLogs error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch logs' });
  }
};
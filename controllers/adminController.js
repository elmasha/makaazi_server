// controllers/adminController.js
const db = require('../config/db');
const redisClient = require('../config/redis');
const admin = require('../config/firebaseAdmin');
const { getSmsBalance } = require('../services/advantaSms');

// ============================================================
// Helpers
// ============================================================
async function logAdminAction(adminEmail, action, entityType, entityId, details) {
  try {
    await db.promise().query(
      `INSERT INTO admin_audit_logs (admin_email, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?)`,
      [adminEmail, action, entityType || null, entityId || null,
       details ? JSON.stringify(details) : null]
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
// Body: { id_token }
// ============================================================
exports.adminLogin = async (req, res) => {
  const { id_token } = req.body;

  if (!id_token) {
    return res.status(400).json({ error: 'id_token is required' });
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(id_token);
  } catch (err) {
    console.error('adminLogin: token verify failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const uid = decoded.uid;
  const email = (decoded.email || '').toLowerCase();

  let adminRow;
  try {
    const [rows] = await db.promise().query(
      `SELECT id, email, firebase_uid, full_name, role, active
       FROM intec_admins
       WHERE firebase_uid = ?
          OR (firebase_uid IS NULL AND email = ?)
       LIMIT 1`,
      [uid, email]
    );
    adminRow = rows[0];
  } catch (err) {
    console.error('adminLogin DB error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }

  if (!adminRow) {
    return res.status(403).json({ error: 'This account is not authorized for admin access' });
  }
  if (!adminRow.active) {
    return res.status(403).json({ error: 'This admin account is disabled' });
  }

  try {
    await db.promise().query(
      `UPDATE intec_admins
       SET firebase_uid = COALESCE(firebase_uid, ?),
           last_login_at = NOW()
       WHERE id = ?`,
      [uid, adminRow.id]
    );
  } catch (e) {
    console.warn('adminLogin: could not update last_login_at:', e.message);
  }

  await logAdminAction(adminRow.email, 'login', 'admin', adminRow.id, { uid });

  return res.json({
    message: 'Login successful',
    admin: {
      id: adminRow.id,
      email: adminRow.email,
      full_name: adminRow.full_name,
      role: adminRow.role,
      uid,
    },
  });
};

// ============================================================
// GET /api/admin/me
// ============================================================
exports.getMe = async (req, res) => {
  return res.json({ admin: req.admin });
};

// ============================================================
// GET /api/admin/public-stats
// ============================================================
exports.getPublicStats = async (req, res) => {
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
    const [[{ collected_this_year }]] = await db.promise().query(
      `SELECT COALESCE(SUM(amount_paid), 0) AS collected_this_year
       FROM payments
       WHERE payment_status = 'Completed' AND YEAR(payment_date) = YEAR(CURDATE())`
    );

    return res.json({
      total_estates,
      active_estates,
      total_households,
      pending_households,
      total_officials,
      collected_this_year: Number(collected_this_year),
    });
  } catch (err) {
    console.error('getPublicStats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

// ============================================================
// GET /api/admin/stats
// ============================================================
exports.getPlatformStats = async (req, res) => {
  try {
    const [[{ total_estates }]] = await db.promise().query(
      `SELECT COUNT(*) AS total_estates FROM estates`
    );
    const [[{ active_estates }]] = await db.promise().query(
      `SELECT COUNT(*) AS active_estates FROM estates`
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
    const [[{ total_residents }]] = await db.promise().query(
      `SELECT COUNT(*) AS total_residents FROM households WHERE active = 1`
    );
    const [[{ pending_subs }]] = await db.promise().query(
      `SELECT COUNT(*) AS pending_subs FROM estate_subscriptions WHERE payment_status = 'Pending'`
    );

    return res.json({
      total_estates,
      active_estates,
      total_households,
      pending_households,
      total_officials,
      total_residents,
      total_collected: Number(total_collected),
      collected_this_year: Number(collected_this_year),
      active_subscriptions: active_subs,
      pending_subscriptions: pending_subs,
    });
  } catch (err) {
    console.error('getPlatformStats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch platform stats' });
  }
};

// ============================================================
// GET /api/admin/estates
// ============================================================
exports.listEstates = async (req, res) => {
  const { search, status } = req.query;

  try {
    let sql = `
      SELECT
        e.estate_id, e.estate_name, e.estate_urn, e.estate_location,
        e.latitude, e.longitude, e.estate_image, e.logo_url,
        e.created_at,
        (SELECT COUNT(*) FROM households h
         WHERE h.estate_id = e.estate_id AND h.status = 'Approved') AS household_count,
        (SELECT COUNT(*) FROM officials o
         WHERE o.estate_id = e.estate_id) AS official_count,
        (SELECT COALESCE(SUM(p.amount_paid), 0) FROM payments p
         WHERE p.estate_id = e.estate_id AND p.payment_status = 'Completed') AS total_collected,
        (SELECT s.is_active FROM estate_subscriptions s
         WHERE s.estate_id = e.estate_id LIMIT 1) AS sub_active
      FROM estates e
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ` AND (e.estate_name LIKE ? OR e.estate_urn LIKE ? OR e.estate_location LIKE ?)`;
      const pat = `%${search}%`;
      params.push(pat, pat, pat);
    }

    sql += ` ORDER BY e.created_at DESC`;

    const [rows] = await db.promise().query(sql, params);

    const normalized = rows.map((r) => ({
      ...r,
      status: 'Active',
    }));

    return res.json(normalized);
  } catch (err) {
    console.error('listEstates error:', err.message);
    return res.status(500).json({ error: 'Failed to list estates' });
  }
};

// ============================================================
// GET /api/admin/estates/:id
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
    const [[subscription]] = await db.promise().query(
      `SELECT s.*, p.plan_name, p.monthly_rate
       FROM estate_subscriptions s
       LEFT JOIN subscription_plans p ON p.plan_id = s.plan_id
       WHERE s.estate_id = ? LIMIT 1`,
      [id]
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
      subscription: subscription || null,
    });
  } catch (err) {
    console.error('getEstate error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch estate' });
  }
};

// ============================================================
// POST /api/admin/estates
// ============================================================
exports.createEstate = async (req, res) => {
  const {
    estate_name,
    estate_location,
    latitude,
    longitude,
    urn_prefix,
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
         (estate_name, estate_urn, estate_location,
          latitude, longitude, estate_image, logo_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        estate_name,
        estate_urn,
        estate_location || null,
        latitude != null ? Number(latitude) : null,
        longitude != null ? Number(longitude) : null,
        estate_image || null,
        logo_url || null,
      ]
    );

    const estate_id = result.insertId;

    await connection.query(
      `INSERT INTO estate_address_config
         (estate_id, show_street, show_section, show_court)
       VALUES (?, ?, ?, ?)`,
      [
        estate_id,
        address_config.show_street ?? 1,
        address_config.show_section ?? 1,
        address_config.show_court ?? 1,
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
// DELETE /api/admin/estates/:id
// ============================================================
exports.archiveEstate = async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await db.promise().query(
      `DELETE FROM estates WHERE estate_id = ?`,
      [id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Estate not found' });
    await redisClient.del('estates');
    await redisClient.del(`estate:${id}`);
    await logAdminAction(req.admin?.email, 'delete_estate', 'estate', id, null);
    return res.json({ message: 'Estate removed' });
  } catch (err) {
    console.error('archiveEstate error:', err.message);
    return res.status(500).json({ error: 'Failed to remove estate' });
  }
};

// ============================================================
// POST /api/admin/estates/:id/address-config
// ============================================================
exports.setAddressConfig = async (req, res) => {
  const { id } = req.params;
  const {
    show_street = 1,
    show_section = 1,
    show_court = 1,
  } = req.body;

  try {
    await db.promise().query(
      `INSERT INTO estate_address_config
         (estate_id, show_street, show_section, show_court)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         show_street = VALUES(show_street),
         show_section = VALUES(show_section),
         show_court = VALUES(show_court),
         updated_at = CURRENT_TIMESTAMP`,
      [
        id,
        show_street ? 1 : 0,
        show_section ? 1 : 0,
        show_court ? 1 : 0,
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
      charge_type, frequency, amount,
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
// POST /api/admin/estates/:id/sections|courts|streets
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
// DELETE /api/admin/sections/:id   (also courts, streets)
// ============================================================
exports.deleteSection = async (req, res) => {
  const { id } = req.params;
  try {
    const [r] = await db.promise().query(
      `DELETE FROM estate_sections WHERE id = ?`, [id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found' });
    return res.json({ message: 'Deleted' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete' });
  }
};

exports.deleteCourt = async (req, res) => {
  const { id } = req.params;
  try {
    const [r] = await db.promise().query(
      `DELETE FROM estate_courts WHERE id = ?`, [id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found' });
    return res.json({ message: 'Deleted' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete' });
  }
};

exports.deleteStreet = async (req, res) => {
  const { id } = req.params;
  try {
    const [r] = await db.promise().query(
      `DELETE FROM estate_streets WHERE id = ?`, [id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found' });
    return res.json({ message: 'Deleted' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete' });
  }
};

// ============================================================
// POST /api/admin/estates/:id/first-official
// ============================================================
exports.createFirstOfficial = async (req, res) => {
  const { id } = req.params;
  const { full_name, contact_number, uid, role } = req.body;

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
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, full_name, role || 'Chairman', contact_number, estate.estate_urn, uid || null]
    );

    await logAdminAction(req.admin?.email, 'create_first_official', 'estate', id, {
      full_name, contact_number,
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
// GET /api/admin/officials
// ============================================================
exports.listOfficials = async (req, res) => {
  const { search, role, estate_id } = req.query;

  try {
    let sql = `
      SELECT
        o.official_id,
        o.estate_id,
        o.full_name,
        o.role,
        o.contact_number,
        o.uid,
        o.created_at,
        e.estate_name,
        e.estate_urn
      FROM officials o
      LEFT JOIN estates e ON e.estate_id = o.estate_id
      WHERE 1=1
    `;
    const params = [];

    if (role) {
      sql += ` AND o.role = ?`;
      params.push(role);
    }
    if (estate_id) {
      sql += ` AND o.estate_id = ?`;
      params.push(estate_id);
    }
    if (search) {
      sql += ` AND (o.full_name LIKE ? OR o.contact_number LIKE ? OR e.estate_name LIKE ?)`;
      const pat = `%${search}%`;
      params.push(pat, pat, pat);
    }

    sql += ` ORDER BY o.created_at DESC`;

    const [rows] = await db.promise().query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('listOfficials error:', err.message);
    return res.status(500).json({ error: 'Failed to list officials' });
  }
};

// ============================================================
// DELETE /api/admin/officials/:id
// ============================================================
exports.deleteOfficial = async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await db.promise().query(
      `DELETE FROM officials WHERE official_id = ?`,
      [id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Official not found' });
    await logAdminAction(req.admin?.email, 'delete_official', 'official', Number(id), null);
    return res.json({ message: 'Official removed' });
  } catch (err) {
    console.error('deleteOfficial error:', err.message);
    return res.status(500).json({ error: 'Failed to remove official' });
  }
};

// ============================================================
// GET /api/admin/subscriptions
// ============================================================
exports.listSubscriptions = async (req, res) => {
  try {
    const [rows] = await db.promise().query(`
      SELECT
        e.estate_id,
        e.estate_name,
        e.estate_urn,
        e.estate_location,

        s.subscription_id,
        s.plan_id,
        s.start_date,
        s.end_date,
        s.amount_paid,
        s.payment_status,
        s.payment_method,
        s.transaction_id,
        s.is_active,
        s.created_at AS subscription_created_at,

        p.plan_name,
        p.monthly_rate,
        p.min_households,
        p.max_households
      FROM estates e
      LEFT JOIN estate_subscriptions s
        ON s.estate_id = e.estate_id
      LEFT JOIN subscription_plans p
        ON p.plan_id = s.plan_id
      ORDER BY
        (s.subscription_id IS NULL) ASC,
        s.end_date ASC,
        e.estate_name ASC
    `);

    const now = Date.now();

    const normalized = rows.map((r) => {
      let status = 'NotSubscribed';
      if (r.subscription_id) {
        if (!r.is_active) status = 'Cancelled';
        else if (r.end_date && new Date(r.end_date).getTime() < now) status = 'Expired';
        else if (r.payment_status === 'Pending') status = 'Pending';
        else if (r.payment_status === 'Failed') status = 'Failed';
        else status = 'Active';
      }

      return {
        id: r.subscription_id || `estate-${r.estate_id}`,
        estate_id: r.estate_id,
        estate_name: r.estate_name,
        estate_urn: r.estate_urn,
        estate_location: r.estate_location,

        plan_id: r.plan_id || null,
        plan_name: r.plan_name || null,
        plan_code: r.plan_id ? `Band ${r.plan_id}` : null,
        monthly_rate: r.monthly_rate != null ? Number(r.monthly_rate) : null,
        min_households: r.min_households,
        max_households: r.max_households,

        amount: r.amount_paid != null ? Number(r.amount_paid) : 0,
        billing_cycle: r.start_date && r.end_date ? 'Custom' : 'Monthly',
        status,
        payment_status: r.payment_status || null,
        payment_method: r.payment_method || null,
        transaction_id: r.transaction_id || null,

        current_period_start: r.start_date,
        current_period_end: r.end_date,
        reference: r.subscription_id
          ? `SUB-${String(r.subscription_id).padStart(4, '0')}`
          : null,
      };
    });

    return res.json(normalized);
  } catch (err) {
    console.error('listSubscriptions error:', err.message);
    return res.status(500).json({ error: 'Failed to list subscriptions' });
  }
};

// ============================================================
// POST /api/admin/subscriptions
// ============================================================
exports.upsertSubscription = async (req, res) => {
  const {
    estate_id,
    plan_id,
    start_date,
    end_date,
    amount_paid,
    payment_status = 'Pending',
    payment_method,
    transaction_id,
    is_active = 1,
  } = req.body;

  if (!estate_id || !plan_id || !start_date || amount_paid == null) {
    return res.status(400).json({
      error: 'estate_id, plan_id, start_date, amount_paid are required',
    });
  }

  try {
    const [[estate]] = await db.promise().query(
      `SELECT estate_id FROM estates WHERE estate_id = ?`, [estate_id]
    );
    if (!estate) return res.status(404).json({ error: 'Estate not found' });

    await db.promise().query(
      `INSERT INTO estate_subscriptions
         (estate_id, plan_id, start_date, end_date, amount_paid,
          payment_status, payment_method, transaction_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         plan_id = VALUES(plan_id),
         start_date = VALUES(start_date),
         end_date = VALUES(end_date),
         amount_paid = VALUES(amount_paid),
         payment_status = VALUES(payment_status),
         payment_method = VALUES(payment_method),
         transaction_id = VALUES(transaction_id),
         is_active = VALUES(is_active),
         updated_at = CURRENT_TIMESTAMP`,
      [
        estate_id,
        plan_id,
        start_date,
        end_date || null,
        Number(amount_paid),
        payment_status,
        payment_method || 'Mpesa',
        transaction_id || `ADMIN-${Date.now()}`,
        is_active ? 1 : 0,
      ]
    );

    await logAdminAction(req.admin?.email, 'upsert_subscription', 'estate', estate_id, {
      plan_id, amount_paid, payment_status,
    });

    return res.status(201).json({ message: 'Subscription saved' });
  } catch (err) {
    console.error('upsertSubscription error:', err.message);
    return res.status(500).json({ error: 'Failed to save subscription' });
  }
};

// ============================================================
// POST /api/admin/subscriptions/:id/status
// ============================================================
exports.setSubscriptionStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['Active', 'Pending', 'Failed', 'Cancelled', 'Expired'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    if (status === 'Active') {
      await db.promise().query(
        `UPDATE estate_subscriptions
         SET is_active = 1, payment_status = 'Paid'
         WHERE subscription_id = ?`,
        [id]
      );
    } else if (status === 'Cancelled') {
      await db.promise().query(
        `UPDATE estate_subscriptions SET is_active = 0 WHERE subscription_id = ?`,
        [id]
      );
    } else if (status === 'Pending') {
      await db.promise().query(
        `UPDATE estate_subscriptions
         SET payment_status = 'Pending', is_active = 1
         WHERE subscription_id = ?`,
        [id]
      );
    } else if (status === 'Failed') {
      await db.promise().query(
        `UPDATE estate_subscriptions
         SET payment_status = 'Failed', is_active = 0
         WHERE subscription_id = ?`,
        [id]
      );
    } else if (status === 'Expired') {
      await db.promise().query(
        `UPDATE estate_subscriptions
         SET is_active = 0
         WHERE subscription_id = ?`,
        [id]
      );
    }

    await logAdminAction(req.admin?.email, 'set_subscription_status', 'subscription', Number(id), { status });
    return res.json({ message: `Subscription set to ${status}` });
  } catch (err) {
    console.error('setSubscriptionStatus error:', err.message);
    return res.status(500).json({ error: 'Failed to update subscription' });
  }
};

// ============================================================
// GET /api/admin/residents
// ============================================================
exports.listResidents = async (req, res) => {
  const { search, estate_id, status } = req.query;

  try {
    let sql = `
      SELECT
        h.household_id,
        h.estate_id,
        h.uid,
        h.primary_owner,
        h.spouse_name,
        h.contact_number,
        h.house_number,
        h.section,
        h.court,
        h.street,
        h.residence_status,
        h.is_official,
        h.official_role,
        h.active,
        h.status,
        h.take_on_balance,
        h.created_at,
        e.estate_name,
        e.estate_urn
      FROM households h
      LEFT JOIN estates e ON e.estate_id = h.estate_id
      WHERE 1=1
    `;
    const params = [];

    if (estate_id) {
      sql += ` AND h.estate_id = ?`;
      params.push(estate_id);
    }
    if (status) {
      sql += ` AND h.status = ?`;
      params.push(status);
    }
    if (search) {
      sql += ` AND (h.primary_owner LIKE ? OR h.contact_number LIKE ?
                    OR h.house_number LIKE ? OR e.estate_name LIKE ?)`;
      const pat = `%${search}%`;
      params.push(pat, pat, pat, pat);
    }

    sql += ` ORDER BY h.created_at DESC`;

    const [rows] = await db.promise().query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('listResidents error:', err.message);
    return res.status(500).json({ error: 'Failed to list residents' });
  }
};

// ============================================================
// GET /api/admin/activity
// ============================================================
exports.getRecentActivity = async (req, res) => {
  try {
    const [recentEstates] = await db.promise().query(`
      SELECT estate_id AS id, estate_name AS label, 'estate' AS type, created_at
      FROM estates ORDER BY created_at DESC LIMIT 5
    `);
    const [recentHouseholds] = await db.promise().query(`
      SELECT h.household_id AS id, h.primary_owner AS label, 'household' AS type, h.created_at,
             e.estate_name AS estate_name
      FROM households h
      LEFT JOIN estates e ON e.estate_id = h.estate_id
      ORDER BY h.created_at DESC LIMIT 5
    `);
    const [recentPayments] = await db.promise().query(`
      SELECT p.payment_id AS id, p.amount_paid AS amount, p.payment_method,
             p.payment_date AS created_at, e.estate_name
      FROM payments p
      LEFT JOIN estates e ON e.estate_id = p.estate_id
      WHERE p.payment_status = 'Completed'
      ORDER BY p.payment_date DESC LIMIT 5
    `);

    return res.json({ recentEstates, recentHouseholds, recentPayments });
  } catch (err) {
    console.error('getRecentActivity error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch activity' });
  }
};

// ============================================================
// GET /api/admin/audit-logs
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

// ============================================================
// ADMINS MANAGEMENT
// ============================================================
exports.listAdmins = async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT id, email, firebase_uid, full_name, role, active, last_login_at, created_at
       FROM intec_admins
       ORDER BY created_at DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('listAdmins error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch admins' });
  }
};

exports.addAdmin = async (req, res) => {
  const { email, full_name = null, role = 'support', firebase_uid = null } = req.body;

  if (!email) return res.status(400).json({ error: 'email is required' });

  const normalized = String(email).toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (!['super', 'support', 'readonly'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const [result] = await db.promise().query(
      `INSERT INTO intec_admins (email, firebase_uid, full_name, role, active)
       VALUES (?, ?, ?, ?, 1)`,
      [normalized, firebase_uid || null, full_name, role]
    );

    await logAdminAction(req.admin?.email, 'add_admin', 'admin', result.insertId, {
      email: normalized, role,
    });

    return res.status(201).json({
      message: 'Admin added',
      id: result.insertId,
      email: normalized,
      role,
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'This email is already an admin' });
    }
    console.error('addAdmin error:', err.message);
    return res.status(500).json({ error: 'Failed to add admin' });
  }
};

exports.updateAdmin = async (req, res) => {
  const { id } = req.params;
  const { role, active, full_name, firebase_uid } = req.body;

  const updates = {};
  if (role !== undefined) {
    if (!['super', 'support', 'readonly'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    updates.role = role;
  }
  if (active !== undefined) updates.active = active ? 1 : 0;
  if (full_name !== undefined) updates.full_name = full_name;
  if (firebase_uid !== undefined) updates.firebase_uid = firebase_uid || null;

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const setters = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), id];

  try {
    const [result] = await db.promise().query(
      `UPDATE intec_admins SET ${setters} WHERE id = ?`,
      values
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Admin not found' });

    await logAdminAction(req.admin?.email, 'update_admin', 'admin', Number(id), updates);
    return res.json({ message: 'Admin updated' });
  } catch (err) {
    console.error('updateAdmin error:', err.message);
    return res.status(500).json({ error: 'Failed to update admin' });
  }
};

exports.removeAdmin = async (req, res) => {
  const { id } = req.params;

  try {
    const [[target]] = await db.promise().query(
      `SELECT email FROM intec_admins WHERE id = ?`,
      [id]
    );
    if (!target) return res.status(404).json({ error: 'Admin not found' });

    if (target.email === req.admin?.email) {
      return res.status(400).json({ error: 'You cannot remove your own admin account' });
    }

    await db.promise().query(
      `UPDATE intec_admins SET active = 0 WHERE id = ?`,
      [id]
    );

    await logAdminAction(req.admin?.email, 'remove_admin', 'admin', Number(id), {
      email: target.email,
    });

    return res.json({ message: 'Admin removed' });
  } catch (err) {
    console.error('removeAdmin error:', err.message);
    return res.status(500).json({ error: 'Failed to remove admin' });
  }
};

// ============================================================
// GET /api/admin/sms-logs
// ============================================================
exports.listSmsLogs = async (req, res) => {
  const { kind, estate_id, ok, search } = req.query;

  try {
    let sql = `
      SELECT
        s.id            AS sms_id,
        s.phone         AS phone_number,
        s.message,
        s.kind,
        s.user_uid,
        s.estate_id,
        s.ok,
        s.provider_ref,
        s.error,
        s.created_at,
        e.estate_name
      FROM sms_logs s
      LEFT JOIN estates e ON e.estate_id = s.estate_id
      WHERE 1=1
    `;
    const params = [];

    if (kind) {
      sql += ` AND s.kind = ?`;
      params.push(kind);
    }
    if (estate_id) {
      sql += ` AND s.estate_id = ?`;
      params.push(estate_id);
    }
    if (ok === '1' || ok === '0') {
      sql += ` AND s.ok = ?`;
      params.push(Number(ok));
    }
    if (search) {
      sql += ` AND (s.phone LIKE ? OR s.message LIKE ? OR e.estate_name LIKE ?)`;
      const pat = `%${search}%`;
      params.push(pat, pat, pat);
    }

    sql += ` ORDER BY s.created_at DESC LIMIT 500`;

    const [rows] = await db.promise().query(sql, params);

    const normalized = rows.map((r) => ({
      sms_id: r.sms_id,
      phone_number: r.phone_number,
      message: r.message,
      category: r.kind || 'generic',
      kind: r.kind,
      user_uid: r.user_uid,
      estate_id: r.estate_id,
      estate_name: r.estate_name,
      provider_ref: r.provider_ref,
      error: r.error,
      status: r.ok ? 'Sent' : 'Failed',
      created_at: r.created_at,
    }));

    return res.json(normalized);
  } catch (err) {
    console.error('listSmsLogs error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch SMS logs' });
  }
};

// ============================================================
// GET /api/admin/sms-logs/:id
// ============================================================
exports.getSmsLog = async (req, res) => {
  const { id } = req.params;
  try {
    const [[row]] = await db.promise().query(
      `SELECT s.*, e.estate_name
       FROM sms_logs s
       LEFT JOIN estates e ON e.estate_id = s.estate_id
       WHERE s.id = ? LIMIT 1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'SMS log not found' });
    return res.json({
      ...row,
      sms_id: row.id,
      phone_number: row.phone,
      category: row.kind,
      status: row.ok ? 'Sent' : 'Failed',
    });
  } catch (err) {
    console.error('getSmsLog error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch SMS log' });
  }
};

// ============================================================
// GET /api/admin/sms-balance
// ============================================================
exports.getSmsBalance = async (req, res) => {
  try {
    const result = await getSmsBalance();
    if (!result.ok) {
      return res.status(200).json({
        ok: false,
        error: result.error || 'Could not fetch balance',
      });
    }
    return res.json({
      ok: true,
      balance: result.balance,
      currency: result.currency || 'KES',
    });
  } catch (err) {
    console.error('getSmsBalance error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to fetch balance' });
  }
};

// ============================================================
// GET /api/admin/sms-stats
// ============================================================
exports.getSmsStats = async (req, res) => {
  try {
    const [[totals]] = await db.promise().query(`
      SELECT
        COUNT(*)                                AS total,
        SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) AS today
      FROM sms_logs
    `);

    return res.json({
      total: Number(totals.total || 0),
      sent: Number(totals.sent || 0),
      failed: Number(totals.failed || 0),
      today: Number(totals.today || 0),
    });
  } catch (err) {
    console.error('getSmsStats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch SMS stats' });
  }
};


// ============================================================
// GET /api/admin/admins/eligible-users
// Distinct users (households + officials) that are not yet admins
// ============================================================
exports.listEligibleAdminUsers = async (req, res) => {
  const { search } = req.query;

  try {
    let sql = `
      SELECT * FROM (
        SELECT
          h.uid                              AS uid,
          NULL                               AS email,
          h.primary_owner                    AS full_name,
          h.contact_number                   AS phone,
          'household'                        AS source,
          h.household_id                     AS source_id,
          e.estate_name                      AS estate_name
        FROM households h
        LEFT JOIN estates e ON e.estate_id = h.estate_id
        WHERE h.status = 'Approved'

        UNION

        SELECT
          o.uid                              AS uid,
          NULL                               AS email,
          o.full_name                        AS full_name,
          o.contact_number                   AS phone,
          'official'                         AS source,
          o.official_id                      AS source_id,
          e.estate_name                      AS estate_name
        FROM officials o
        LEFT JOIN estates e ON e.estate_id = o.estate_id
      ) u
      WHERE NOT EXISTS (
        SELECT 1 FROM intec_admins a
        WHERE a.firebase_uid = u.uid
      )
    `;
    const params = [];

    if (search) {
      sql += ` AND (u.full_name LIKE ? OR u.phone LIKE ? OR u.estate_name LIKE ?)`;
      const pat = `%${search}%`;
      params.push(pat, pat, pat);
    }

    sql += ` ORDER BY u.full_name ASC LIMIT 200`;

    const [rows] = await db.promise().query(sql, params);

    // Enrich with Firebase email if we can
    // (auth.getUsers requires UIDs in batches of 100)
    const uids = rows.map((r) => r.uid).filter(Boolean);
    const emailByUid = {};
    if (uids.length) {
      try {
        const batch = uids.slice(0, 100);
        const result = await admin.auth().getUsers(batch.map((uid) => ({ uid })));
        result.users.forEach((u) => {
          emailByUid[u.uid] = u.email || null;
        });
      } catch (e) {
        console.warn('getUsers failed:', e.message);
      }
    }

    const enriched = rows.map((r) => ({
      uid: r.uid,
      email: emailByUid[r.uid] || r.email || null,
      full_name: r.full_name,
      phone: r.phone,
      source: r.source,
      source_id: r.source_id,
      estate_name: r.estate_name,
    }));

    return res.json(enriched);
  } catch (err) {
    console.error('listEligibleAdminUsers error:', err.message);
    return res.status(500).json({ error: 'Failed to load eligible users' });
  }
};


// ============================================================
// GET /api/admin/subscription-plans
// Returns all subscription plans ordered by tier
// ============================================================
exports.listSubscriptionPlans = async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT plan_id, plan_name, min_households, max_households,
              monthly_rate, created_at, updated_at
       FROM subscription_plans
       ORDER BY min_households ASC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('listSubscriptionPlans error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch plans' });
  }
};

// ============================================================
// POST /api/admin/subscription-plans
// Body: { plan_name, min_households, max_households?, monthly_rate }
// ============================================================
exports.createSubscriptionPlan = async (req, res) => {
  const { plan_name, min_households, max_households, monthly_rate } = req.body;

  if (!plan_name || min_households == null || monthly_rate == null) {
    return res.status(400).json({
      error: 'plan_name, min_households and monthly_rate are required',
    });
  }

  const minH = Number(min_households);
  const maxH =
    max_households === '' || max_households == null
      ? null
      : Number(max_households);
  const rate = Number(monthly_rate);

  if (Number.isNaN(minH) || minH < 1) {
    return res.status(400).json({ error: 'min_households must be >= 1' });
  }
  if (maxH !== null && (Number.isNaN(maxH) || maxH < minH)) {
    return res.status(400).json({ error: 'max_households must be >= min_households' });
  }
  if (Number.isNaN(rate) || rate < 0) {
    return res.status(400).json({ error: 'monthly_rate must be >= 0' });
  }

  try {
    // Check for overlapping tier
    const [[overlap]] = await db.promise().query(
      `SELECT plan_id, plan_name
       FROM subscription_plans
       WHERE (? <= COALESCE(max_households, 999999999))
         AND (COALESCE(?, 999999999) >= min_households)
       LIMIT 1`,
      [minH, maxH]
    );

    if (overlap) {
      return res.status(409).json({
        error: `Range overlaps with existing plan "${overlap.plan_name}"`,
      });
    }

    const [result] = await db.promise().query(
      `INSERT INTO subscription_plans
         (plan_name, min_households, max_households, monthly_rate)
       VALUES (?, ?, ?, ?)`,
      [plan_name, minH, maxH, rate]
    );

    await logAdminAction(req.admin?.email, 'create_plan', 'plan', result.insertId, {
      plan_name, min_households: minH, max_households: maxH, monthly_rate: rate,
    });

    return res.status(201).json({
      message: 'Plan created',
      plan_id: result.insertId,
    });
  } catch (err) {
    console.error('createSubscriptionPlan error:', err.message);
    return res.status(500).json({ error: 'Failed to create plan' });
  }
};

// ============================================================
// PATCH /api/admin/subscription-plans/:id
// ============================================================
exports.updateSubscriptionPlan = async (req, res) => {
  const { id } = req.params;
  const { plan_name, min_households, max_households, monthly_rate } = req.body;

  const updates = {};
  if (plan_name !== undefined) updates.plan_name = plan_name;
  if (min_households !== undefined) updates.min_households = Number(min_households);
  if (monthly_rate !== undefined) updates.monthly_rate = Number(monthly_rate);
  if (max_households !== undefined) {
    updates.max_households =
      max_households === '' || max_households == null
        ? null
        : Number(max_households);
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  if (updates.min_households != null && updates.min_households < 1) {
    return res.status(400).json({ error: 'min_households must be >= 1' });
  }
  if (
    updates.max_households != null &&
    updates.min_households != null &&
    updates.max_households < updates.min_households
  ) {
    return res.status(400).json({ error: 'max_households must be >= min_households' });
  }

  const setters = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), id];

  try {
    const [result] = await db.promise().query(
      `UPDATE subscription_plans SET ${setters} WHERE plan_id = ?`,
      values
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    await logAdminAction(req.admin?.email, 'update_plan', 'plan', Number(id), updates);

    return res.json({ message: 'Plan updated' });
  } catch (err) {
    console.error('updateSubscriptionPlan error:', err.message);
    return res.status(500).json({ error: 'Failed to update plan' });
  }
};

// ============================================================
// DELETE /api/admin/subscription-plans/:id
// Blocked if any estate_subscriptions reference this plan
// ============================================================
exports.deleteSubscriptionPlan = async (req, res) => {
  const { id } = req.params;

  try {
    // Block if in use
    const [[{ count }]] = await db.promise().query(
      `SELECT COUNT(*) AS count FROM estate_subscriptions WHERE plan_id = ?`,
      [id]
    );
    if (count > 0) {
      return res.status(400).json({
        error: `Cannot delete — ${count} estate subscription(s) use this plan`,
      });
    }

    const [result] = await db.promise().query(
      `DELETE FROM subscription_plans WHERE plan_id = ?`,
      [id]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    await logAdminAction(req.admin?.email, 'delete_plan', 'plan', Number(id), null);

    return res.json({ message: 'Plan deleted' });
  } catch (err) {
    console.error('deleteSubscriptionPlan error:', err.message);
    return res.status(500).json({ error: 'Failed to delete plan' });
  }
};
// controllers/visitorsController.js
const db = require('../config/db');
const redisClient = require('../config/redis');
const { queueSms } = require('../services/smsService');
const templates = require('../services/smsTemplates');

const APP_URL = process.env.APP_URL || 'https://makaazi.app';

// ============================================================
// Helpers
// ============================================================
async function logAction(actorUid, action, entityType, entityId, details) {
  try {
    let actorEmail = null;
    if (actorUid) {
      const [[a]] = await db.promise().query(
        `SELECT email FROM intec_admins WHERE firebase_uid = ? LIMIT 1`,
        [actorUid]
      );
      actorEmail = a?.email || null;
    }
    await db.promise().query(
      `INSERT INTO admin_audit_logs (admin_email, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?)`,
      [
        actorEmail || actorUid || 'system',
        action,
        entityType,
        entityId || null,
        details ? JSON.stringify(details) : null,
      ]
    );
  } catch (e) {
    console.warn('visitor pass audit log failed:', e.message);
  }
}

function generatePassCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function toMysqlDatetime(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    '-' + pad(d.getUTCMonth() + 1) +
    '-' + pad(d.getUTCDate()) +
    ' ' + pad(d.getUTCHours()) +
    ':' + pad(d.getUTCMinutes()) +
    ':' + pad(d.getUTCSeconds())
  );
}

// Normalize Kenyan phone numbers to 2547XXXXXXXX form.
function normalizeKenyanPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0'))   return '254' + digits.slice(1);
  if (digits.length === 9)      return '254' + digits;
  return digits;
}

// ============================================================
// PUBLIC — no auth
// ============================================================

// GET /api/visitor-passes/public/:code
// Used by the /checkin/:code page to render pass details before confirming.
exports.getPublicPass = async (req, res) => {
  const { code } = req.params;
  try {
    const [[pass]] = await db.promise().query(
      `SELECT p.pass_id, p.pass_code, p.visitor_name, p.visitor_phone,
              p.status, p.valid_from, p.valid_until, p.used_at,
              h.primary_owner AS host_name,
              e.estate_name
       FROM visitor_passes p
       LEFT JOIN households h ON h.household_id = p.household_id
       LEFT JOIN estates    e ON e.estate_id    = p.estate_id
       WHERE p.pass_code = ?
       LIMIT 1`,
      [String(code).toUpperCase().trim()]
    );

    if (!pass) return res.status(404).json({ error: 'Pass not found' });

    const now = new Date();
    let effective_status = pass.status;
    if (pass.status === 'Active' && now > new Date(pass.valid_until)) {
      effective_status = 'Expired';
    }

    return res.json({
      pass_code:   pass.pass_code,
      visitor_name: pass.visitor_name,
      host_name:   pass.host_name || 'your host',
      estate_name: pass.estate_name || 'the estate',
      valid_from:  pass.valid_from,
      valid_until: pass.valid_until,
      used_at:     pass.used_at,
      status:      effective_status,
      can_checkin: effective_status === 'Active',
    });
  } catch (err) {
    console.error('getPublicPass error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch pass' });
  }
};

// POST /api/visitor-passes/checkin/:code
// Visitor taps "I'm here". Marks the pass used, notifies the resident.
exports.checkinPass = async (req, res) => {
  const { code } = req.params;

  try {
    const [[pass]] = await db.promise().query(
      `SELECT * FROM visitor_passes WHERE pass_code = ? LIMIT 1`,
      [String(code).toUpperCase().trim()]
    );
    if (!pass) return res.status(404).json({ error: 'Pass not found' });

    if (pass.status === 'Cancelled') {
      return res.status(400).json({ error: 'This pass has been cancelled' });
    }
    if (pass.status === 'Used') {
      return res.status(400).json({ error: 'This pass has already been used' });
    }
    if (pass.status === 'Expired') {
      return res.status(400).json({ error: 'This pass has expired' });
    }

    const now = new Date();
    if (now < new Date(pass.valid_from)) {
      return res.status(400).json({ error: 'This pass is not yet valid' });
    }
    if (now > new Date(pass.valid_until)) {
      await db.promise().query(
        `UPDATE visitor_passes SET status = 'Expired' WHERE pass_id = ?`,
        [pass.pass_id]
      );
      return res.status(400).json({ error: 'This pass has expired' });
    }

    // Mark used
    await db.promise().query(
      `UPDATE visitor_passes
       SET status = 'Used', used_at = UTC_TIMESTAMP()
       WHERE pass_id = ?`,
      [pass.pass_id]
    );

    // Access log — self check-in
    await db.promise().query(
      `INSERT INTO vehicle_access_logs
         (estate_id, pass_id, plate_number, direction, gate_name, logged_by_uid, notes)
       VALUES (?, ?, ?, 'IN', ?, NULL, 'self-check-in')`,
      [
        pass.estate_id,
        pass.pass_id,
        pass.visitor_plate || null,
        req.body?.gate_name || 'Self check-in',
      ]
    );

    await logAction(null, 'self_checkin_visitor_pass', 'visitor_pass', pass.pass_id, {
      pass_code: pass.pass_code,
      method: 'self_checkin',
    });

    // Notify the resident (background)
    (async () => {
      try {
        const [[household]] = await db.promise().query(
          `SELECT primary_owner, contact_number
           FROM households
           WHERE household_id = ?
           LIMIT 1`,
          [pass.household_id]
        );
        if (!household?.contact_number) {
          console.warn('checkinPass SMS skipped — no contact_number', pass.household_id);
          return;
        }
        const message = templates.visitorArrived({
          name: household.primary_owner || 'resident',
          visitorName: pass.visitor_name,
          gateName: req.body?.gate_name || '',
        });
        await queueSms(normalizeKenyanPhone(household.contact_number), message, {
          kind: 'visitor_arrived',
          estate_id: pass.estate_id,
        });
      } catch (e) {
        console.warn('checkinPass SMS failed:', e.message);
      }
    })();

    return res.json({
      message: 'Checked in',
      pass: {
        pass_id: pass.pass_id,
        pass_code: pass.pass_code,
        visitor_name: pass.visitor_name,
        host_name: null,
        used_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('checkinPass error:', err.message);
    return res.status(500).json({ error: 'Failed to check in' });
  }
};

// ============================================================
// AUTHENTICATED
// ============================================================

exports.listMyPasses = async (req, res) => {
  const uid = req.auth.uid;
  try {
    const [rows] = await db.promise().query(
      `SELECT * FROM visitor_passes
       WHERE host_uid = ?
       ORDER BY created_at DESC`,
      [uid]
    );
    return res.json(rows);
  } catch (err) {
    console.error('listMyPasses error:', err.message);
    return res.status(500).json({ error: 'Failed to list passes' });
  }
};

exports.listEstatePasses = async (req, res) => {
  const { estateId } = req.params;
  const { status, search } = req.query;

  try {
    let sql = `
      SELECT p.*,
             h.primary_owner AS host_name,
             h.contact_number AS host_phone,
             h.house_number
      FROM visitor_passes p
      LEFT JOIN households h ON h.household_id = p.household_id
      WHERE p.estate_id = ?
    `;
    const params = [estateId];

    if (status) { sql += ` AND p.status = ?`; params.push(status); }
    if (search) {
      sql += ` AND (p.visitor_name LIKE ? OR p.visitor_phone LIKE ?
                   OR p.visitor_plate LIKE ? OR p.pass_code LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    sql += ` ORDER BY p.created_at DESC LIMIT 500`;

    const [rows] = await db.promise().query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('listEstatePasses error:', err.message);
    return res.status(500).json({ error: 'Failed to list passes' });
  }
};

exports.getPass = async (req, res) => {
  const { id } = req.params;
  try {
    const [[row]] = await db.promise().query(
      `SELECT p.*, h.primary_owner AS host_name, h.contact_number AS host_phone,
              e.estate_name, e.estate_urn
       FROM visitor_passes p
       LEFT JOIN households h ON h.household_id = p.household_id
       LEFT JOIN estates    e ON e.estate_id    = p.estate_id
       WHERE p.pass_id = ? LIMIT 1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Pass not found' });

    if (req.auth.role === 'resident' && row.host_uid !== req.auth.uid) {
      return res.status(403).json({ error: 'Not your pass' });
    }

    return res.json(row);
  } catch (err) {
    console.error('getPass error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch pass' });
  }
};

exports.createPass = async (req, res) => {
  const uid = req.auth.uid;
  const role = req.auth.role;

  const {
    estate_id,
    household_id,
    visitor_name, visitor_phone, visitor_plate,
    purpose, valid_from, valid_until,
  } = req.body;

  if (!visitor_name || !estate_id || !valid_from || !valid_until) {
    return res.status(400).json({
      error: 'visitor_name, estate_id, valid_from and valid_until are required',
    });
  }

  const from = new Date(valid_from);
  const until = new Date(valid_until);
  if (isNaN(from.getTime()) || isNaN(until.getTime())) {
    return res.status(400).json({ error: 'Invalid date format' });
  }
  if (until <= from) {
    return res.status(400).json({ error: 'valid_until must be after valid_from' });
  }

  const mysqlFrom = toMysqlDatetime(valid_from);
  const mysqlUntil = toMysqlDatetime(valid_until);

  try {
    let householdId = household_id || null;

    if (role === 'resident') {
      const [[me]] = await db.promise().query(
        `SELECT household_id FROM households WHERE uid = ? LIMIT 1`,
        [uid]
      );
      if (!me) return res.status(403).json({ error: 'Resident profile not found' });
      householdId = me.household_id;
    }

    let passCode = null;
    for (let i = 0; i < 5; i++) {
      const candidate = generatePassCode();
      const [[exists]] = await db.promise().query(
        `SELECT pass_id FROM visitor_passes WHERE pass_code = ? LIMIT 1`,
        [candidate]
      );
      if (!exists) { passCode = candidate; break; }
    }
    if (!passCode) {
      return res.status(500).json({ error: 'Could not generate unique pass code' });
    }

    const [result] = await db.promise().query(
      `INSERT INTO visitor_passes
         (estate_id, household_id, host_uid,
          visitor_name, visitor_phone, visitor_plate, purpose,
          pass_code, valid_from, valid_until, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
      [
        estate_id,
        householdId,
        uid,
        visitor_name,
        visitor_phone || null,
        visitor_plate ? String(visitor_plate).toUpperCase().trim() : null,
        purpose || null,
        passCode,
        mysqlFrom,
        mysqlUntil,
      ]
    );

    await logAction(uid, 'create_visitor_pass', 'visitor_pass', result.insertId, {
      visitor_name,
      pass_code: passCode,
      estate_id,
    });
    await redisClient.del(`passes:estate:${estate_id}`);

    // ---- SMS to the VISITOR with check-in link ----
    const visitorPhone = normalizeKenyanPhone(visitor_phone);
    if (visitorPhone) {
      (async () => {
        try {
          const [[host]] = await db.promise().query(
            `SELECT primary_owner FROM households WHERE household_id = ? LIMIT 1`,
            [householdId]
          );
          const [[estate]] = await db.promise().query(
            `SELECT estate_name FROM estates WHERE estate_id = ? LIMIT 1`,
            [estate_id]
          );

          const checkinUrl = `${APP_URL}/checkin/${passCode}`;
          const message = templates.visitorPassCreated({
            visitorName: visitor_name,
            hostName: host?.primary_owner || 'Your host',
            estateName: estate?.estate_name || 'the estate',
            checkinUrl,
            validUntil: valid_until,
          });

          await queueSms(visitorPhone, message, {
            kind: 'visitor_pass_created',
            user_uid: uid,
            estate_id,
          });
        } catch (e) {
          console.warn('visitor pass SMS failed:', e.message);
        }
      })();
    }
    // ---- End SMS ----

    return res.status(201).json({
      message: 'Visitor pass created',
      pass_id: result.insertId,
      pass_code: passCode,
      checkin_url: `${APP_URL}/checkin/${passCode}`,
    });
  } catch (err) {
    console.error('createPass error:', err.message);
    return res.status(500).json({ error: 'Failed to create pass' });
  }
};

exports.verifyPass = async (req, res) => {
  const uid = req.auth.uid;
  const { pass_code, direction = 'IN', gate_name } = req.body;

  if (!pass_code) return res.status(400).json({ error: 'pass_code required' });
  if (!['IN', 'OUT'].includes(direction)) {
    return res.status(400).json({ error: "direction must be 'IN' or 'OUT'" });
  }

  try {
    const [[pass]] = await db.promise().query(
      `SELECT * FROM visitor_passes WHERE pass_code = ? LIMIT 1`,
      [String(pass_code).toUpperCase().trim()]
    );
    if (!pass) return res.status(404).json({ error: 'Pass not found' });

    if (pass.status === 'Cancelled') {
      return res.status(400).json({ error: 'Pass was cancelled' });
    }

    const now = new Date();
    if (now < new Date(pass.valid_from)) {
      return res.status(400).json({ error: 'Pass is not yet valid' });
    }
    if (now > new Date(pass.valid_until)) {
      await db.promise().query(
        `UPDATE visitor_passes SET status = 'Expired' WHERE pass_id = ?`,
        [pass.pass_id]
      );
      return res.status(400).json({ error: 'Pass has expired' });
    }

    await db.promise().query(
      `INSERT INTO vehicle_access_logs
         (estate_id, pass_id, plate_number, direction, gate_name, logged_by_uid)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        pass.estate_id,
        pass.pass_id,
        pass.visitor_plate || null,
        direction,
        gate_name || null,
        uid,
      ]
    );

    if (direction === 'IN' && pass.status === 'Active') {
      await db.promise().query(
        `UPDATE visitor_passes
         SET status = 'Used', used_at = UTC_TIMESTAMP()
         WHERE pass_id = ?`,
        [pass.pass_id]
      );
    }

    await logAction(uid, 'verify_visitor_pass', 'visitor_pass', pass.pass_id, {
      pass_code: pass.pass_code,
      direction,
      gate_name: gate_name || null,
    });

    if (direction === 'IN') {
      (async () => {
        try {
          const [[household]] = await db.promise().query(
            `SELECT primary_owner, contact_number
             FROM households
             WHERE household_id = ?
             LIMIT 1`,
            [pass.household_id]
          );
          if (!household?.contact_number) return;
          const message = templates.visitorArrived({
            name: household.primary_owner || 'resident',
            visitorName: pass.visitor_name,
            gateName: gate_name || '',
          });
          await queueSms(normalizeKenyanPhone(household.contact_number), message, {
            kind: 'visitor_arrived',
            user_uid: uid,
            estate_id: pass.estate_id,
          });
        } catch (e) {
          console.warn('visitor arrived SMS failed:', e.message);
        }
      })();
    }

    return res.json({
      message: `Visitor ${direction === 'OUT' ? 'exited' : 'entered'}`,
      pass: {
        pass_id: pass.pass_id,
        pass_code: pass.pass_code,
        visitor_name: pass.visitor_name,
        visitor_phone: pass.visitor_phone,
        visitor_plate: pass.visitor_plate,
        valid_from: pass.valid_from,
        valid_until: pass.valid_until,
      },
    });
  } catch (err) {
    console.error('verifyPass error:', err.message);
    return res.status(500).json({ error: 'Failed to verify pass' });
  }
};

exports.cancelPass = async (req, res) => {
  const { id } = req.params;
  const uid = req.auth.uid;
  const role = req.auth.role;

  try {
    if (role === 'resident') {
      const [[p]] = await db.promise().query(
        `SELECT host_uid FROM visitor_passes WHERE pass_id = ?`, [id]
      );
      if (!p) return res.status(404).json({ error: 'Pass not found' });
      if (p.host_uid !== uid) {
        return res.status(403).json({ error: 'Not your pass' });
      }
    }

    const [r] = await db.promise().query(
      `UPDATE visitor_passes SET status = 'Cancelled' WHERE pass_id = ?`,
      [id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Pass not found' });

    await logAction(uid, 'cancel_visitor_pass', 'visitor_pass', Number(id), null);
    return res.json({ message: 'Pass cancelled' });
  } catch (err) {
    console.error('cancelPass error:', err.message);
    return res.status(500).json({ error: 'Failed to cancel pass' });
  }
};

exports.extendPass = async (req, res) => {
  const { id } = req.params;
  const uid = req.auth.uid;
  const role = req.auth.role;
  const hours = Math.min(Math.max(Number(req.body.hours) || 2, 1), 48);

  try {
    const [[p]] = await db.promise().query(
      `SELECT * FROM visitor_passes WHERE pass_id = ?`, [id]
    );
    if (!p) return res.status(404).json({ error: 'Pass not found' });

    if (role === 'resident' && p.host_uid !== uid) {
      return res.status(403).json({ error: 'Not your pass' });
    }
    if (['Cancelled', 'Used'].includes(p.status)) {
      return res.status(400).json({ error: `Cannot extend a ${p.status} pass` });
    }

    await db.promise().query(
      `UPDATE visitor_passes
       SET valid_until = DATE_ADD(GREATEST(valid_until, UTC_TIMESTAMP()), INTERVAL ? HOUR)
       WHERE pass_id = ?`,
      [hours, id]
    );

    await logAction(uid, 'extend_visitor_pass', 'visitor_pass', Number(id), { hours });
    return res.json({ message: `Pass extended by ${hours}h` });
  } catch (err) {
    console.error('extendPass error:', err.message);
    return res.status(500).json({ error: 'Failed to extend pass' });
  }
};

exports.getEstatePassStats = async (req, res) => {
  const { estateId } = req.params;
  try {
    const [[stats]] = await db.promise().query(
      `SELECT
         (SELECT COUNT(*) FROM visitor_passes
          WHERE estate_id = ? AND status = 'Active'
            AND valid_until > UTC_TIMESTAMP())                       AS active_passes,
         (SELECT COUNT(*) FROM visitor_passes
          WHERE estate_id = ? AND DATE(created_at) = CURDATE())       AS created_today,
         (SELECT COUNT(*) FROM visitor_passes
          WHERE estate_id = ? AND status = 'Used')                    AS used_total,
         (SELECT COUNT(*) FROM visitor_passes
          WHERE estate_id = ? AND status = 'Expired')                 AS expired_total`,
      [estateId, estateId, estateId, estateId]
    );
    return res.json(stats);
  } catch (err) {
    console.error('getEstatePassStats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
};
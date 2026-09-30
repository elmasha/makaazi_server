// controllers/vehicleController.js
const db = require('../config/db');
const redisClient = require('../config/redis');

// ============================================================
// Helper: audit log (matches your adminController pattern)
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
    console.warn('vehicle audit log failed:', e.message);
  }
}

// ============================================================
// VEHICLES
// ============================================================

// ------------------------------------------------------------
// GET /api/vehicles/mine
// Vehicles owned by the caller (resident view)
// ------------------------------------------------------------
exports.listMyVehicles = async (req, res) => {
  const uid = req.auth.uid;
  try {
    const [rows] = await db.promise().query(
      `SELECT * FROM vehicles
       WHERE owner_uid = ?
       ORDER BY created_at DESC`,
      [uid]
    );
    return res.json(rows);
  } catch (err) {
    console.error('listMyVehicles error:', err.message);
    return res.status(500).json({ error: 'Failed to list vehicles' });
  }
};

// ------------------------------------------------------------
// GET /api/vehicles/estate/:estateId
// All vehicles in an estate (official view)
// Query: ?status=&search=&household_id=
// ------------------------------------------------------------
exports.listEstateVehicles = async (req, res) => {
  const { estateId } = req.params;
  const { status, search, household_id } = req.query;

  try {
    let sql = `
      SELECT
        v.vehicle_id, v.estate_id, v.household_id, v.owner_uid,
        v.plate_number, v.make, v.model, v.color, v.year,
        v.vehicle_type, v.sticker_number, v.parking_slot,
        v.status, v.notes, v.created_at, v.approved_at,
        h.primary_owner AS household_owner,
        h.contact_number AS household_phone,
        h.house_number
      FROM vehicles v
      LEFT JOIN households h ON h.household_id = v.household_id
      WHERE v.estate_id = ?
    `;
    const params = [estateId];

    if (status) {
      sql += ` AND v.status = ?`;
      params.push(status);
    }
    if (household_id) {
      sql += ` AND v.household_id = ?`;
      params.push(household_id);
    }
    if (search) {
      sql += ` AND (v.plate_number LIKE ? OR v.make LIKE ? OR v.model LIKE ?
                   OR h.primary_owner LIKE ? OR h.house_number LIKE ?)`;
      const p = `%${search}%`;
      params.push(p, p, p, p, p);
    }

    sql += ` ORDER BY v.created_at DESC LIMIT 500`;

    const [rows] = await db.promise().query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('listEstateVehicles error:', err.message);
    return res.status(500).json({ error: 'Failed to list vehicles' });
  }
};

// ------------------------------------------------------------
// GET /api/vehicles/:id
// ------------------------------------------------------------
exports.getVehicle = async (req, res) => {
  const { id } = req.params;
  try {
    const [[row]] = await db.promise().query(
      `SELECT v.*, h.primary_owner, h.contact_number, h.house_number,
              e.estate_name, e.estate_urn
       FROM vehicles v
       LEFT JOIN households h ON h.household_id = v.household_id
       LEFT JOIN estates    e ON e.estate_id    = v.estate_id
       WHERE v.vehicle_id = ? LIMIT 1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Vehicle not found' });

    // Residents can only view their own
    if (req.auth.role === 'resident' && row.owner_uid !== req.auth.uid) {
      return res.status(403).json({ error: 'Not your vehicle' });
    }

    return res.json(row);
  } catch (err) {
    console.error('getVehicle error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch vehicle' });
  }
};

// ------------------------------------------------------------
// POST /api/vehicles
// Resident registers their own; official can attach to a household
// ------------------------------------------------------------
exports.createVehicle = async (req, res) => {
  const uid = req.auth.uid;
  const role = req.auth.role;

  const {
    estate_id, household_id, plate_number,
    make, model, color, year, vehicle_type,
    sticker_number, parking_slot, notes,
  } = req.body;

  if (!estate_id || !plate_number) {
    return res.status(400).json({ error: 'estate_id and plate_number are required' });
  }

  try {
    let householdId = household_id || null;
    let ownerUid = uid;

    if (role === 'resident') {
      // Residents can only add vehicles to their own household
      const [[me]] = await db.promise().query(
        `SELECT household_id FROM households WHERE uid = ? LIMIT 1`,
        [uid]
      );
      if (!me) return res.status(403).json({ error: 'Resident profile not found' });
      householdId = me.household_id;
    }

    // Officials: Auto-approve. Residents: Pending until official approves.
    const status = ['official', 'super', 'support'].includes(role) ? 'Active' : 'Pending';

    const [result] = await db.promise().query(
      `INSERT INTO vehicles
         (estate_id, household_id, owner_uid, plate_number,
          make, model, color, year, vehicle_type,
          sticker_number, parking_slot, notes, status, created_by_uid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        estate_id,
        householdId,
        ownerUid,
        String(plate_number).toUpperCase().trim(),
        make || null,
        model || null,
        color || null,
        year || null,
        vehicle_type || 'car',
        sticker_number || null,
        parking_slot || null,
        notes || null,
        status,
        uid,
      ]
    );

    await logAction(uid, 'create_vehicle', 'vehicle', result.insertId, {
      plate_number, estate_id, household_id: householdId, status,
    });
    await redisClient.del(`vehicles:estate:${estate_id}`);

    return res.status(201).json({
      message: status === 'Active' ? 'Vehicle registered' : 'Vehicle submitted for approval',
      vehicle_id: result.insertId,
      status,
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'This plate is already registered in this estate' });
    }
    console.error('createVehicle error:', err.message);
    return res.status(500).json({ error: 'Failed to register vehicle' });
  }
};

// ------------------------------------------------------------
// PATCH /api/vehicles/:id
// Residents can only edit their own; officials can edit any in their estate
// ------------------------------------------------------------
exports.updateVehicle = async (req, res) => {
  const { id } = req.params;
  const uid = req.auth.uid;
  const role = req.auth.role;

  const allowed = [
    'plate_number', 'make', 'model', 'color', 'year',
    'vehicle_type', 'sticker_number', 'parking_slot', 'notes',
  ];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }
  if (updates.plate_number) {
    updates.plate_number = String(updates.plate_number).toUpperCase().trim();
  }

  try {
    if (role === 'resident') {
      const [[v]] = await db.promise().query(
        `SELECT owner_uid FROM vehicles WHERE vehicle_id = ?`, [id]
      );
      if (!v) return res.status(404).json({ error: 'Vehicle not found' });
      if (v.owner_uid !== uid) {
        return res.status(403).json({ error: 'Not your vehicle' });
      }
    }

    const setters = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), id];

    const [r] = await db.promise().query(
      `UPDATE vehicles SET ${setters} WHERE vehicle_id = ?`,
      values
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Vehicle not found' });

    await logAction(uid, 'update_vehicle', 'vehicle', Number(id), updates);
    return res.json({ message: 'Vehicle updated' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Duplicate plate for this estate' });
    }
    console.error('updateVehicle error:', err.message);
    return res.status(500).json({ error: 'Failed to update vehicle' });
  }
};

// ------------------------------------------------------------
// POST /api/vehicles/:id/approve    (official)
// ------------------------------------------------------------
exports.approveVehicle = async (req, res) => {
  const { id } = req.params;
  const uid = req.auth.uid;
  try {
    const [r] = await db.promise().query(
      `UPDATE vehicles
       SET status = 'Active', approved_by_uid = ?, approved_at = NOW()
       WHERE vehicle_id = ?`,
      [uid, id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Vehicle not found' });

    await logAction(uid, 'approve_vehicle', 'vehicle', Number(id), null);
    return res.json({ message: 'Vehicle approved' });
  } catch (err) {
    console.error('approveVehicle error:', err.message);
    return res.status(500).json({ error: 'Failed to approve' });
  }
};

// ------------------------------------------------------------
// POST /api/vehicles/:id/suspend    (official)
// ------------------------------------------------------------
exports.suspendVehicle = async (req, res) => {
  const { id } = req.params;
  const uid = req.auth.uid;
  try {
    const [r] = await db.promise().query(
      `UPDATE vehicles SET status = 'Suspended' WHERE vehicle_id = ?`,
      [id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Vehicle not found' });

    await logAction(uid, 'suspend_vehicle', 'vehicle', Number(id), null);
    return res.json({ message: 'Vehicle suspended' });
  } catch (err) {
    console.error('suspendVehicle error:', err.message);
    return res.status(500).json({ error: 'Failed to suspend' });
  }
};

// ------------------------------------------------------------
// DELETE /api/vehicles/:id
// ------------------------------------------------------------
exports.deleteVehicle = async (req, res) => {
  const { id } = req.params;
  const uid = req.auth.uid;
  const role = req.auth.role;

  try {
    if (role === 'resident') {
      const [[v]] = await db.promise().query(
        `SELECT owner_uid FROM vehicles WHERE vehicle_id = ?`, [id]
      );
      if (!v) return res.status(404).json({ error: 'Vehicle not found' });
      if (v.owner_uid !== uid) {
        return res.status(403).json({ error: 'Not your vehicle' });
      }
    }

    const [r] = await db.promise().query(
      `DELETE FROM vehicles WHERE vehicle_id = ?`, [id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Vehicle not found' });

    await logAction(uid, 'delete_vehicle', 'vehicle', Number(id), null);
    return res.json({ message: 'Vehicle removed' });
  } catch (err) {
    console.error('deleteVehicle error:', err.message);
    return res.status(500).json({ error: 'Failed to delete vehicle' });
  }
};

// ============================================================
// STATS (used by dashboards)
// ============================================================

// ------------------------------------------------------------
// GET /api/vehicles/estate/:estateId/stats
// ------------------------------------------------------------
exports.getEstateVehicleStats = async (req, res) => {
  const { estateId } = req.params;
  try {
    const [[stats]] = await db.promise().query(
      `SELECT
         (SELECT COUNT(*) FROM vehicles
          WHERE estate_id = ? AND status = 'Active')      AS active_vehicles,
         (SELECT COUNT(*) FROM vehicles
          WHERE estate_id = ? AND status = 'Pending')     AS pending_vehicles,
         (SELECT COUNT(*) FROM vehicles
          WHERE estate_id = ?)                            AS total_vehicles,
         (SELECT COUNT(*) FROM visitor_passes
          WHERE estate_id = ? AND status = 'Active'
            AND valid_until > NOW())                      AS active_passes,
         (SELECT COUNT(*) FROM vehicle_access_logs
          WHERE estate_id = ? AND DATE(created_at) = CURDATE()) AS today_entries`,
      [estateId, estateId, estateId, estateId, estateId]
    );
    return res.json(stats);
  } catch (err) {
    console.error('getEstateVehicleStats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

// ============================================================
// ACCESS LOGS  (guard/official logging at the gate)
// ============================================================

// ------------------------------------------------------------
// GET /api/vehicles/logs/estate/:estateId
// Query: ?from=&to=&plate=
// ------------------------------------------------------------
exports.listAccessLogs = async (req, res) => {
  const { estateId } = req.params;
  const { from, to, plate } = req.query;

  try {
    let sql = `
      SELECT
        l.log_id, l.estate_id, l.vehicle_id, l.pass_id,
        l.plate_number, l.direction, l.gate_name,
        l.logged_by_uid, l.notes, l.created_at,
        v.make, v.model, v.color,
        p.visitor_name
      FROM vehicle_access_logs l
      LEFT JOIN vehicles       v ON v.vehicle_id = l.vehicle_id
      LEFT JOIN visitor_passes p ON p.pass_id    = l.pass_id
      WHERE l.estate_id = ?
    `;
    const params = [estateId];

    if (from)  { sql += ` AND l.created_at >= ?`; params.push(from); }
    if (to)    { sql += ` AND l.created_at <= ?`; params.push(to); }
    if (plate) { sql += ` AND l.plate_number LIKE ?`; params.push(`%${plate}%`); }

    sql += ` ORDER BY l.created_at DESC LIMIT 500`;

    const [rows] = await db.promise().query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('listAccessLogs error:', err.message);
    return res.status(500).json({ error: 'Failed to list access logs' });
  }
};

// ------------------------------------------------------------
// POST /api/vehicles/logs
// Guard logs a registered vehicle IN / OUT
// ------------------------------------------------------------
exports.logAccess = async (req, res) => {
  const uid = req.auth.uid;
  const { estate_id, vehicle_id, plate_number, direction, gate_name, notes } = req.body;

  if (!estate_id || !direction) {
    return res.status(400).json({ error: 'estate_id and direction are required' });
  }
  if (!['IN', 'OUT'].includes(direction)) {
    return res.status(400).json({ error: "direction must be 'IN' or 'OUT'" });
  }

  try {
    const [r] = await db.promise().query(
      `INSERT INTO vehicle_access_logs
         (estate_id, vehicle_id, plate_number, direction, gate_name, logged_by_uid, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        estate_id,
        vehicle_id || null,
        plate_number ? String(plate_number).toUpperCase() : null,
        direction,
        gate_name || null,
        uid,
        notes || null,
      ]
    );

    await logAction(uid, 'log_vehicle_access', 'vehicle_access_log', r.insertId, {
      direction, plate_number: plate_number || null, estate_id,
    });

    return res.status(201).json({ message: 'Access logged', log_id: r.insertId });
  } catch (err) {
    console.error('logAccess error:', err.message);
    return res.status(500).json({ error: 'Failed to log access' });
  }
};

// ------------------------------------------------------------
// POST /api/vehicles/lookup-plate
// Body: { estate_id, plate_number }
// Guard enters a plate to see whether it's a known vehicle
// ------------------------------------------------------------
exports.lookupPlate = async (req, res) => {
  const { estate_id, plate_number } = req.body;
  if (!estate_id || !plate_number) {
    return res.status(400).json({ error: 'estate_id and plate_number required' });
  }

  try {
    const [[vehicle]] = await db.promise().query(
      `SELECT v.vehicle_id, v.plate_number, v.make, v.model, v.color,
              v.status, h.primary_owner, h.contact_number, h.house_number
       FROM vehicles v
       LEFT JOIN households h ON h.household_id = v.household_id
       WHERE v.estate_id = ?
         AND v.plate_number = ?
       LIMIT 1`,
      [estate_id, String(plate_number).toUpperCase().trim()]
    );

    if (!vehicle) {
      return res.status(404).json({
        known: false,
        error: 'Plate not registered in this estate',
      });
    }
    if (vehicle.status !== 'Active') {
      return res.status(200).json({
        known: true,
        warning: `Vehicle is ${vehicle.status}`,
        vehicle,
      });
    }
    return res.json({ known: true, vehicle });
  } catch (err) {
    console.error('lookupPlate error:', err.message);
    return res.status(500).json({ error: 'Failed to look up plate' });
  }
};
// controllers/serviceChargesController.js
const db = require('../config/db');
const redisClient = require('../config/redis');

// ============================================================
// GET /services/getAll
// All charges across every estate (admin/support use)
// ============================================================
exports.getAllCharges = async (req, res) => {
  const cacheKey = 'charges';

  try {
    const cachedResults = await redisClient.get(cacheKey);
    if (cachedResults) {
      console.log('🔁 Serving all charges from Redis cache');
      return res.status(200).json(JSON.parse(cachedResults));
    }

    const [results] = await db.promise().query('SELECT * FROM service_charges');
    await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
    console.log('💾 Cached all charges data');
    return res.json(results);
  } catch (error) {
    console.error('❌ Error in getAllCharges:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ============================================================
// GET /services/getEstateServiceCharges/:id
// All charges for one estate
// ============================================================
exports.getEstateServiceCharges = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'estate id is required' });
  }

  const cacheKey = `service_charges/:${id}`;

  try {
    const cachedResult = await redisClient.get(cacheKey);
    if (cachedResult) {
      console.log('🔁 Serving estate charges from Redis cache');
      return res.status(200).json(JSON.parse(cachedResult));
    }

    const [results] = await db.promise().query(
      `SELECT * FROM service_charges WHERE estate_id = ? ORDER BY charge_type ASC`,
      [id]
    );

    if (!results.length) {
      // Return empty array with 200 so UI can show "no charges" state
      return res.status(200).json([]);
    }

    await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
    console.log('💾 Cached estate charges data for estate', id);
    return res.status(200).json(results);
  } catch (error) {
    console.error('❌ Error in getEstateServiceCharges:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ============================================================
// POST /services/addServiceCharge
// Body: { estate_id, charge_type, frequency, amount }
// ============================================================
exports.addCharge = async (req, res) => {
  const { estate_id, charge_type, frequency, amount } = req.body;

  // Validate
  const missing = [];
  if (!estate_id)    missing.push('estate_id');
  if (!charge_type)  missing.push('charge_type');
  if (!frequency)    missing.push('frequency');
  if (amount === undefined || amount === null || amount === '') missing.push('amount');
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  const amountNum = Number(amount);
  if (!amountNum || amountNum <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than 0' });
  }

  const allowedFrequencies = ['Monthly', 'Quarterly', 'Half yearly', 'Annual', 'Adhoc'];
  if (!allowedFrequencies.includes(frequency)) {
    return res.status(400).json({
      error: `Invalid frequency. Must be one of: ${allowedFrequencies.join(', ')}`,
    });
  }

  try {
    const [result] = await db.promise().query(
      `INSERT INTO service_charges (estate_id, charge_type, frequency, amount)
       VALUES (?, ?, ?, ?)`,
      [estate_id, charge_type.trim(), frequency, amountNum]
    );

    // Invalidate cached lists
    await Promise.all([
      redisClient.del('charges'),
      redisClient.del(`service_charges/:${estate_id}`),
    ]);

    console.log('✅ Charge added:', result.insertId);
    return res.status(200).json({
      message: 'Service charge added successfully',
      charges_id: result.insertId,
    });
  } catch (error) {
    console.error('❌ Error in addCharge:', error.message);
    return res.status(500).json({ error: 'Failed to add charge' });
  }
};

// ============================================================
// PUT /services/update/:id
// Body: { charge_type?, frequency?, amount? }
// ============================================================
exports.updateCharges = async (req, res) => {
  const { id } = req.params;
  const fields = req.body || {};

  if (!id) {
    return res.status(400).json({ error: 'charges ID is required' });
  }
  if (!Object.keys(fields).length) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  // Whitelist updatable columns
  const allowed = ['charge_type', 'amount', 'frequency'];
  const updates = {};
  for (const k of allowed) {
    if (fields[k] !== undefined && fields[k] !== null && fields[k] !== '') {
      updates[k] = fields[k];
    }
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  // Validate specific fields
  if (updates.amount !== undefined) {
    const amt = Number(updates.amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }
    updates.amount = amt;
  }
  if (updates.frequency !== undefined) {
    const allowedFrequencies = ['Monthly', 'Quarterly', 'Half yearly', 'Annual', 'Adhoc'];
    if (!allowedFrequencies.includes(updates.frequency)) {
      return res.status(400).json({
        error: `Invalid frequency. Must be one of: ${allowedFrequencies.join(', ')}`,
      });
    }
  }
  if (updates.charge_type !== undefined) {
    updates.charge_type = String(updates.charge_type).trim();
    if (!updates.charge_type) {
      return res.status(400).json({ error: 'Charge name cannot be empty' });
    }
  }

  // Look up the estate for cache invalidation
  let estateId = null;
  try {
    const [rows] = await db.promise().query(
      `SELECT estate_id FROM service_charges WHERE charges_id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Charge not found' });
    }
    estateId = rows[0].estate_id;
  } catch (err) {
    console.error('❌ Error looking up charge:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }

  // Build and run UPDATE
  const setters = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), id];

  try {
    const [result] = await db.promise().query(
      `UPDATE service_charges SET ${setters} WHERE charges_id = ?`,
      values
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Charge not found' });
    }

    // Invalidate caches
    await Promise.all([
      redisClient.del('charges'),
      redisClient.del(`service_charges/:${estateId}`),
    ]);

    console.log('✅ Charge updated:', id);
    return res.json({ message: 'Charge updated successfully' });
  } catch (error) {
    console.error('❌ Error in updateCharges:', error.message);
    return res.status(500).json({ error: 'Failed to update charge' });
  }
};

// ============================================================
// DELETE /services/delete/:id
// ============================================================
exports.deleteCharge = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'charges ID is required' });
  }

  // Look up the estate for cache invalidation
  let estateId = null;
  try {
    const [rows] = await db.promise().query(
      `SELECT estate_id FROM service_charges WHERE charges_id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Charge not found' });
    }
    estateId = rows[0].estate_id;
  } catch (err) {
    console.error('❌ Error looking up charge:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }

  try {
    const [result] = await db.promise().query(
      `DELETE FROM service_charges WHERE charges_id = ?`,
      [id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Charge not found' });
    }

    // Invalidate caches
    await Promise.all([
      redisClient.del('charges'),
      redisClient.del(`service_charges/:${estateId}`),
    ]);

    console.log('✅ Charge deleted:', id);
    return res.json({ message: 'Charge deleted successfully' });
  } catch (error) {
    console.error('❌ Error in deleteCharge:', error.message);
    return res.status(500).json({ error: 'Failed to delete charge' });
  }
};
const db = require('../config/db');
const redisClient = require('../config/redis');

// CREATE a new visitor entry
exports.createVisitor = async (req, res) => {
  const {
    household_id,
    estate_id,
    name,
    contact_number,
    purpose,
    time_in,
    time_out,
    approved_by,
    status 
  } = req.body;

  const sql = `
    INSERT INTO visitors (
      household_id, estate_id, name, contact_number,
      purpose, time_in, time_out, approved_by, status
    ) VALUES (?, ?,  ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(sql, [
    household_id, estate_id, name, contact_number,
    purpose, time_in, time_out, approved_by, status
  ], async (err, result) => {
    if (err) return res.status(500).json({ error: err.message });

    // Invalidate cache after insertion
    await redisClient.del('visitors:all');

    res.status(200).json({
      message: 'Visitor record created',
      visitor_id: result.insertId,
    });
  });
};

// READ all visitor records with Redis caching
exports.getAllVisitors = async (req, res) => {
  const cacheKey = 'visitors:all';

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      console.log('🔁 Served from Redis cache');
      return res.json(JSON.parse(cached));
    }

    const sql = 'SELECT * FROM visitors ORDER BY time_in DESC';
    db.query(sql, async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });

      await redisClient.setEx(cacheKey, 300, JSON.stringify(results)); // cache 5 mins
      res.json(results);
    });
  } catch (err) {
    console.error('Redis error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// READ one visitor record by ID
exports.getVisitorById = async (req, res) => {
  const { visitor_id } = req.params;
  const cacheKey = `visitor:${visitor_id}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      console.log('🔁 Served single visitor from cache');
      return res.json(JSON.parse(cached));
    }

    const sql = 'SELECT * FROM visitors WHERE visitor_id = ?';
    db.query(sql, [visitor_id], async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.length === 0) return res.status(404).json({ message: 'Visitor not found' });

      await redisClient.setEx(cacheKey, 300, JSON.stringify(results[0]));
      res.json(results[0]);
    });
  } catch (error) {
    console.error('Redis error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// UPDATE visitor
exports.updateVisitor = async (req, res) => {
  const { visitor_id } = req.params;
  const updates = req.body;

  const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
  const values = [...Object.values(updates), visitor_id];

  const sql = `UPDATE visitors SET ${fields} WHERE visitor_id = ?`;

  db.query(sql, values, async (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Visitor not found' });

    // Invalidate both caches
    await redisClient.del('visitors:all');
    await redisClient.del(`visitor:${visitor_id}`);

    res.json({ message: 'Visitor record updated' });
  });
};

// DELETE visitor
exports.deleteVisitor = async (req, res) => {
  const { visitor_id } = req.params;

  const sql = 'DELETE FROM visitors WHERE visitor_id = ?';
  db.query(sql, [visitor_id], async (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Visitor not found' });

    await redisClient.del('visitors:all');
    await redisClient.del(`visitor:${visitor_id}`);

    res.json({ message: 'Visitor record deleted' });
  });
};





// Add Visitor
exports.addVisitor = (req, res) => {
    const { household_id, name, contact_number,reason,timeIn,timeOut } = req.body;
    const sql = 'INSERT INTO visitors (household_id, name, contact_number,reason,timeIn,timeOut) VALUES (?, ?, ?, ?,?,?)';
    db.query(sql, [household_id, name, contact_number,reason,timeIn,timeOut], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Visitor added successfully', visitorId: result.insertId });
    });
};

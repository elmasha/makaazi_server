const db = require('../config/db'); // Database connection
const redisClient = require('../config/redisClient');

// Cache key prefix
const cachePrefix = 'payment:';

// Create Payment
exports.createPayment = async (req, res) => {
    const paymentData = req.body;

    const sql = `INSERT INTO payments SET ?`;
    db.query(sql, paymentData, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        // Invalidate cache after creating a new payment
        redisClient.del(`${cachePrefix}all`);
        res.status(201).json({ message: 'Payment created', id: result.insertId });
    });
};

// Get All Payments
exports.getAllPayments = async (req, res) => {
    try {
        const cacheKey = `${cachePrefix}all`;
        
        // Check Redis cache
        const cachedPayments = await redisClient.get(cacheKey);
        if (cachedPayments) {
            console.log('✅ Serving payments from cache');
            return res.json(JSON.parse(cachedPayments));
        }

        const sql = 'SELECT * FROM payments';
        db.query(sql, async (err, results) => {
            if (err) return res.status(500).json({ error: err.message });

            // Cache the result for 5 minutes
            await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
            res.json(results);
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Get Single Payment
exports.getPaymentById = async (req, res) => {
    const id = req.params.id;
    const cacheKey = `${cachePrefix}${id}`;

    try {
        // Check Redis cache
        const cachedPayment = await redisClient.get(cacheKey);
        if (cachedPayment) {
            console.log('✅ Serving payment from cache');
            return res.json(JSON.parse(cachedPayment));
        }

        const sql = 'SELECT * FROM payments WHERE id = ?';
        db.query(sql, [id], async (err, result) => {
            if (err) return res.status(500).json({ error: err.message });

            if (result.length === 0) return res.status(404).json({ error: 'Payment not found' });

            // Cache the result for 5 minutes
            await redisClient.setEx(cacheKey, 300, JSON.stringify(result[0]));
            res.json(result[0]);
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Update Payment
exports.updatePayment = async (req, res) => {
    const id = req.params.id;
    const updatedData = req.body;

    const sql = 'UPDATE payments SET ? WHERE id = ?';
    db.query(sql, [updatedData, id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        if (result.affectedRows === 0) return res.status(404).json({ error: 'Payment not found' });

        // Invalidate the cache
        redisClient.del(`${cachePrefix}${id}`);
        redisClient.del(`${cachePrefix}all`);

        res.json({ message: 'Payment updated' });
    });
};

// Delete Payment
exports.deletePayment = async (req, res) => {
    const id = req.params.id;

    const sql = 'DELETE FROM payments WHERE id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        if (result.affectedRows === 0) return res.status(404).json({ error: 'Payment not found' });

        // Invalidate the cache
        redisClient.del(`${cachePrefix}${id}`);
        redisClient.del(`${cachePrefix}all`);

        res.json({ message: 'Payment deleted' });
    });
};

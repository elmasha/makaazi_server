const db = require('../config/db');
const redisClient = require('../config/redis');

const DEFAULT_EXPIRATION = 60;

// Make Payment
exports.makePayment = (req, res) => {
    const { household_id, amount_paid, payment_method, transaction_id } = req.body;
    const sql = 'INSERT INTO payments (household_id, amount_paid, payment_method, transaction_id) VALUES (?, ?, ?, ?)';
    db.query(sql, [household_id, amount_paid, payment_method, transaction_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Payment successful', paymentId: result.insertId });
    });
};



////.........Get households by ID........////
exports.getPaymentById = (req, res) => {
    const estateId = req.params.id;
    const sql = `SELECT * FROM payments WHERE household_id = ? ORDER BY created_at DESC`;
    db.query(sql, [estateId], (err, results) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(500).send("Error retrieving household");
        }
       return res.status(200).json(results);
    });
};


////.........Get Estate by ID........////
exports.getPaymentByEstateId = (req, res) => {
    const estateId = req.params.id;
    const sql = `SELECT * FROM payments WHERE estate_id = ? ORDER BY created_at DESC`;
    db.query(sql, [estateId], (err, results) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(500).send("Error retrieving estate");
        }
       return res.status(200).json(results);
    });
};


// Get All Payments
exports.getAllPayments = (req, res) => {
    const sql = 'SELECT * FROM payments ORDER BY created_at DESC';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};


///-----Query Estate ---////
exports.getEstateQueryPayments= async (req, res) => {
    const estate_id = req.params.id;
    const {query} = req.query;
    let sql = 'SELECT * FROM payments WHERE estate_id = ?';
    if (query === 'today') {
        sql += ' AND DATE(payment_date) = CURDATE()';
    } else if (query === 'yesterday') {
        sql += ' AND DATE(payment_date) = CURDATE() - INTERVAL 1 DAY';
    } else if (query === 'week') {
        sql += ' AND WEEK(payment_date) = WEEK(CURDATE())';
    } else if (query === 'month') {
        sql += ' AND MONTH(payment_date) = MONTH(CURDATE())';
    }else if (query === 'year') {
        sql += ' AND YEAR(payment_date) = YEAR(CURDATE())';
    }
    db.query(sql, [estate_id], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });;
        }
       return res.status(200).json(results);
    });
};


///-----Query Households ---////
exports.getUserQueryPayments= async (req, res) => {
    const household_id = req.params.id;
    const {query} = req.query;

    let sql = 'SELECT * FROM payments WHERE household_id = ?';

    if (query === 'today') {
        sql += ' AND DATE(payment_date) = CURDATE()';
    } else if (query === 'yesterday') {
        sql += ' AND DATE(payment_date) = CURDATE() - INTERVAL 1 DAY';
    } else if (query === 'week') {
        sql += ' AND WEEK(payment_date) = WEEK(CURDATE())';
    } else if (query === 'month') {
        sql += ' AND MONTH(payment_date) = MONTH(CURDATE())';
    }

    db.query(sql, [household_id], (err, results) => {
        if (err) {
        
            return res.status(500).json({ error: 'Database error' });;
        }
       return res.status(200).json(results);
    });
};




// Search households by estate ID and keyword
exports.searchHouseholdsId = async (req, res) => {
    const household_id = req.params.id;
    const { query } = req.query;

    if (!query) {
        return res.status(400).json({ error: 'Search query is required' });
    }

    const cacheKey = `payments/:${household_id}/:${query}`;

    try {
        // Check Redis cache for the search results
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            console.log('🔁 Serving search results from cache');
            return res.status(200).json(JSON.parse(cachedResults));
        }

        // SQL query to search within the specified estate ID
        const sql = `
            SELECT * FROM payments 
            WHERE household_id = ? AND (
                estate_name LIKE ? OR
                transaction_id LIKE ? OR
                transaction_type LIKE ?
            )
        `;
        const searchPattern = `%${query}%`;

        db.query(sql, [household_id, searchPattern, searchPattern, searchPattern], async (err, results) => {
            if (err) {
                console.error('Database error: ' + err.message);
                return res.status(500).json({ error: 'Database error' });
            }

            if (results.length === 0) {
                return res.status(404).json({ message: 'No matching payments found' });
            }

            // Cache the results in Redis with a 5-minute expiration
            await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
            console.log('💾 Search results cached');

          return  res.json({ message: 'Search results', data: results });
        });
    } catch (error) {
        console.error('❌ Redis error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
};



// Search households by estate ID and keyword
exports.searchEstateId = async (req, res) => {
    const estate_id = req.params.id;
    const { query } = req.query;

    if (!query) {
        return res.status(400).json({ error: 'Search query is required' });
    }

    const cacheKey = `payments/:${estate_id}/:${query}`;

    try {
        // Check Redis cache for the search results
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            console.log('🔁 Serving search results from cache');
            return res.status(200).json(JSON.parse(cachedResults));
        }

        // SQL query to search within the specified estate ID
        const sql = `
            SELECT * FROM payments 
            WHERE estate_id = ? AND (
                estate_name LIKE ? OR
                transaction_id LIKE ? OR
                transaction_type LIKE ?
            )
        `;
        const searchPattern = `%${query}%`;

        db.query(sql, [estate_id, searchPattern, searchPattern, searchPattern], async (err, results) => {
            if (err) {
                console.error('Database error: ' + err.message);
                return res.status(500).json({ error: 'Database error' });
            }

            if (results.length === 0) {
                return res.status(404).json({ message: 'No matching payments found' });
            }

            // Cache the results in Redis with a 5-minute expiration
            await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
            console.log('💾 Search results cached');

          return  res.json(results);
        });
    } catch (error) {
        console.error('❌ Redis error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
};




////......Search AllPayments...../////
exports.searchAllPayments = async (req, res) => {
    const { query } = req.query; // Retrieve the search query from the client

    if (!query) {
        return res.status(400).send("Search query is required");
    }

    // Full-Text Search Query
    const cacheKey = `search:AllPayments:${query}`;

    try {
        // Check Redis cache for the search results
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            console.log('🔁 Serving search results from cache');
            return res.status(200).json(JSON.parse(cachedResults));
        }

        // Full-Text Search Query (MySQL)
        let sql = `
            SELECT estate_name, transaction_id, transaction_type
            FROM Payments
            WHERE MATCH(estate_name, transaction_id, transaction_type) AGAINST(? IN NATURAL LANGUAGE MODE)
        `;
        db.query(sql, query, async (err, results) => {
            if (err) {
                console.error('❌ Error searching AllPayments:', err);
                return res.status(500).send("Error searching posts");
            }

            // Cache the results in Redis with an expiration of 1 minute
            await redisClient.setEx(cacheKey, 60, JSON.stringify(results));
            console.log('💾 Search results cached');

           return res.status(200).json(results);
        });
    } catch (error) {
        console.error('❌ Redis error:', error);
        return  res.status(500).send("Server error");
    }


};


// GET /api/payments/summary/:estateId
exports.getPaymentSummaryByEstate = (req, res) => {
    const estateId = req.params.estateId;

    const sql = `
        SELECT 
            ps.household_id,
            h.primary_owner,
            ps.month,
            ps.year,
            ps.total_paid
        FROM payments_summary ps
        JOIN households h ON h.household_id = ps.household_id
        WHERE h.estate_id = ?
        ORDER BY h.household_id, ps.year, ps.month
    `;

    db.query(sql, [estateId], (err, results) => {
        if (err) {
            console.error('❌ Database Error:', err.message);
            return res.status(500).json({ error: 'Failed to retrieve summary' });
        }
        res.status(200).json(results);
    });
};
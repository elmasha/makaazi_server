const db = require('../config/db');

// Get All Cash Routing Records
exports.getAllCashRouting = (req, res) => {
    const sql = 'SELECT * FROM cash_routing';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// Create Cash Routing Record
exports.addCashRouting = (req, res) => {
    const { official_id, total_collected, date_range, remarks } = req.body;
    const sql = 'INSERT INTO cash_routing (official_id, total_collected, date_range, remarks) VALUES (?, ?, ?, ?)';
    db.query(sql, [official_id, total_collected, date_range, remarks], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Cash routing record added successfully', routingId: result.insertId });
    });
};

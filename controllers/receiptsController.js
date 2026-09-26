const db = require('../config/db');

// Get All Receipts
exports.getAllReceipts = (req, res) => {
    const sql = 'SELECT * FROM receipts';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// Create Receipt
exports.createReceipt = (req, res) => {
    const { payment_id, receipt_url } = req.body;
    const sql = 'INSERT INTO receipts (payment_id, receipt_url) VALUES (?, ?)';
    db.query(sql, [payment_id, receipt_url], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Receipt created successfully', receiptId: result.insertId });
    });
};

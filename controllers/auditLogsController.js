const db = require('../config/db');

// Get All Audit Logs
exports.getAllAuditLogs = (req, res) => {
    const sql = 'SELECT * FROM audit_logs';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// Create Audit Log
exports.createAuditLog = (req, res) => {
    const { user_id, action, table_name, record_id } = req.body;
    const sql = 'INSERT INTO audit_logs (user_id, action, table_name, record_id) VALUES (?, ?, ?, ?)';
    db.query(sql, [user_id, action, table_name, record_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Audit log created successfully', logId: result.insertId });
    });
};

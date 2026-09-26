const db = require('../config/db');

// Get All Visitor Logs
exports.getAllVisitorLogs = (req, res) => {
    const sql = 'SELECT * FROM visitor_logs';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// Create Visitor Log
exports.createVisitorLog = (req, res) => {
    const { visitor_id, entry_time, exit_time } = req.body;
    const sql = 'INSERT INTO visitor_logs (visitor_id, entry_time, exit_time) VALUES (?, ?, ?)';
    db.query(sql, [visitor_id, entry_time, exit_time], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Visitor log created successfully', logId: result.insertId });
    });
};

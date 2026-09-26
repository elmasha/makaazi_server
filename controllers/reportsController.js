const db = require('../config/db');

// ✅ Get All Reports
exports.getAllReports = (req, res) => {
    const sql = 'SELECT * FROM reports';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// ✅ Generate a New Report
exports.generateReport = (req, res) => {
    const { report_type, generated_by } = req.body;
    const sql = 'INSERT INTO reports (report_type, generated_by) VALUES (?, ?)';
    db.query(sql, [report_type, generated_by], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: 'Report generated successfully', reportId: result.insertId });
    });
};

// ✅ Get a Report by ID
exports.getReportById = (req, res) => {
    const { id } = req.params;
    const sql = 'SELECT * FROM reports WHERE report_id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.length === 0) return res.status(404).json({ message: 'Report not found' });
        res.json(result[0]);
    });
};

// ✅ Delete a Report
exports.deleteReport = (req, res) => {
    const { id } = req.params;
    const sql = 'DELETE FROM reports WHERE report_id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Report deleted successfully' });
    });
};

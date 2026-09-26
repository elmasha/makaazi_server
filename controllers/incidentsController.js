const db = require('../config/db');

// ✅ Get All Incidents
exports.getAllIncidents = (req, res) => {
    const sql = 'SELECT * FROM incidents';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// ✅ Report an Incident
exports.reportIncident = (req, res) => {
    const { estate_id, description, reported_by } = req.body;
    const sql = 'INSERT INTO incidents (estate_id, description, reported_by) VALUES (?, ?, ?)';
    db.query(sql, [estate_id, description, reported_by], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: 'Incident reported successfully', incidentId: result.insertId });
    });
};

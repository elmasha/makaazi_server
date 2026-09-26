const db = require('../config/db');

// Get All Incident Types
exports.getAllIncidentTypes = (req, res) => {
    const sql = 'SELECT * FROM incident_types';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// Create Incident Type
exports.createIncidentType = (req, res) => {
    const { type_name, description } = req.body;
    const sql = 'INSERT INTO incident_types (type_name, description) VALUES (?, ?)';
    db.query(sql, [type_name, description], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Incident type created successfully', typeId: result.insertId });
    });
};

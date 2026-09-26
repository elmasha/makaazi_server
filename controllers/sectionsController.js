const db = require('../config/db');

// Get All Sections
exports.getAllSections = (req, res) => {
    const sql = 'SELECT * FROM sections';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// Create Section
exports.createSection = (req, res) => {
    const { estate_id, section_name, description } = req.body;
    const sql = 'INSERT INTO sections (estate_id, section_name, description) VALUES (?, ?, ?)';
    db.query(sql, [estate_id, section_name, description], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Section created successfully', sectionId: result.insertId });
    });
};

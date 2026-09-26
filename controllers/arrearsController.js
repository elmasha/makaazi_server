const db = require('../config/db');

// Get All Arrears
exports.getAllArrears = (req, res) => {
    const sql = 'SELECT * FROM arrears';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// Create Arrear Record
exports.createArrear = (req, res) => {
    const { household_id, amount_due, due_date, status } = req.body;
    const sql = 'INSERT INTO arrears (household_id, amount_due, due_date, status) VALUES (?, ?, ?, ?)';
    db.query(sql, [household_id, amount_due, due_date, status], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Arrear record created successfully', arrearId: result.insertId });
    });
};

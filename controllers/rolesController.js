const db = require('../config/db');

// Get All Roles
exports.getAllRoles = (req, res) => {
    const sql = 'SELECT * FROM roles';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// Create Role
exports.createRole = (req, res) => {
    const { role_name, permissions } = req.body;
    const sql = 'INSERT INTO roles (role_name, permissions) VALUES (?, ?)';
    db.query(sql, [role_name, permissions], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Role created successfully', roleId: result.insertId });
    });
};

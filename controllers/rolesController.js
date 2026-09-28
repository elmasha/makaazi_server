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

// PATCH /api/roles/:id
exports.updateRole = (req, res) => {
  const { id } = req.params;
  const { role_name, permissions } = req.body;

  const updates = {};
  if (role_name !== undefined) updates.role_name = role_name;
  if (permissions !== undefined) {
    updates.permissions =
      typeof permissions === 'string' ? permissions : JSON.stringify(permissions);
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const setters = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), id];

  db.query(
    `UPDATE roles SET ${setters} WHERE id = ?`,
    values,
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!result.affectedRows) {
        return res.status(404).json({ error: 'Role not found' });
      }
      res.json({ message: 'Role updated' });
    }
  );
};

// DELETE /api/roles/:id
exports.deleteRole = (req, res) => {
  const { id } = req.params;

  // Block if any user still uses this role
  db.query(
    `SELECT role_name FROM roles WHERE id = ?`,
    [id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length) return res.status(404).json({ error: 'Role not found' });

      const roleName = rows[0].role_name;

      // Check across all three user tables
      const checkSql = `
        SELECT
          (SELECT COUNT(*) FROM intec_admins WHERE role = ?) AS admins,
          (SELECT COUNT(*) FROM officials     WHERE role = ?) AS officials,
          (SELECT COUNT(*) FROM households    WHERE role = ?) AS households
      `;
      db.query(checkSql, [roleName, roleName, roleName], (err2, counts) => {
        if (err2) return res.status(500).json({ error: err2.message });
        const c = counts[0];
        const total = c.admins + c.officials + c.households;
        if (total > 0) {
          return res.status(400).json({
            error: `Cannot delete — ${total} user(s) still assigned to "${roleName}"`,
          });
        }

        db.query(`DELETE FROM roles WHERE id = ?`, [id], (err3) => {
          if (err3) return res.status(500).json({ error: err3.message });
          res.json({ message: 'Role deleted' });
        });
      });
    }
  );
};

// controllers/rolesController.js — add this export
// ============================================================
// GET /api/roles/for-user/:uid
// Public endpoint used by Nuxt middleware to resolve role.
// Returns { role, permissions, profile } or 404.
// ============================================================
exports.getRoleForUser = async (req, res) => {
  const { uid } = req.params;
  if (!uid) return res.status(400).json({ error: 'uid required' });

  try {
    // Try each user table in priority order: admin > official > resident
    const candidates = [
      {
        table: 'intec_admins',
        idCol: 'id',
        uidCol: 'firebase_uid',
        labelCol: 'full_name',
        extra: 'email, active',
      },
      {
        table: 'officials',
        idCol: 'official_id',
        uidCol: 'uid',
        labelCol: 'full_name',
        extra: 'estate_id, contact_number',
      },
      {
        table: 'households',
        idCol: 'household_id',
        uidCol: 'uid',
        labelCol: 'primary_owner',
        extra: 'estate_id, contact_number, status',
      },
    ];

    for (const c of candidates) {
      const [[user]] = await db.promise().query(
        `SELECT ${c.idCol} AS id,
                ${c.uidCol} AS uid,
                ${c.labelCol} AS full_name,
                role,
                ${c.extra}
         FROM ${c.table}
         WHERE ${c.uidCol} = ?
         LIMIT 1`,
        [uid]
      );

      if (!user) continue;

      // Look up permissions for that role name from the roles table
      const [[roleRow]] = await db.promise().query(
        `SELECT id, role_name, permissions
         FROM roles
         WHERE role_name = ?
         LIMIT 1`,
        [user.role]
      );

      let permissions = [];
      if (roleRow?.permissions) {
        try {
          permissions =
            typeof roleRow.permissions === 'string'
              ? JSON.parse(roleRow.permissions)
              : roleRow.permissions;
        } catch (_) {
          permissions = [];
        }
      }

      return res.json({
        role: user.role,                       // 'super' | 'official' | 'resident' | ...
        permissions,                           // ['view_audit','manage_estates', ...]
        role_id: roleRow?.id || null,
        source_table: c.table,
        profile: user,
      });
    }

    return res.status(404).json({ error: 'No role for this uid' });
  } catch (err) {
    console.error('getRoleForUser error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
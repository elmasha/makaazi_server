// middleware/adminAuth.js
const admin = require('../config/fcm');
const db = require('../config/db');

/**
 * Verifies the Firebase ID token from the Authorization header,
 * then checks the intec_admins table for an active admin row.
 * Attaches req.admin on success.
 */
async function adminAuth(req, res, next) {
  // 1. Extract Firebase ID token
  const authHeader = req.headers['authorization'] || '';
  const idToken = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!idToken) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  // 2. Verify with Firebase Admin SDK
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    console.error('adminAuth: token verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const uid = decoded.uid;
  const email = (decoded.email || '').toLowerCase();

  // 3. Look up the admin
  let adminRow;
  try {
    const [rows] = await db.promise().query(
      `SELECT id, email, firebase_uid, full_name, role, active
       FROM intec_admins
       WHERE firebase_uid = ?
          OR (firebase_uid IS NULL AND email = ?)
       LIMIT 1`,
      [uid, email]
    );
    adminRow = rows[0];
  } catch (err) {
    console.error('adminAuth: DB lookup failed:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }

  if (!adminRow) {
    return res.status(403).json({ error: 'This account is not authorized for admin access' });
  }

  if (!adminRow.active) {
    return res.status(403).json({ error: 'This admin account is disabled' });
  }

  // 4. Auto-bind firebase_uid on first login + update last_login_at
  try {
    await db.promise().query(
      `UPDATE intec_admins
       SET firebase_uid = COALESCE(firebase_uid, ?),
           last_login_at = NOW()
       WHERE id = ?`,
      [uid, adminRow.id]
    );
  } catch (e) {
    console.warn('adminAuth: could not update UID/last_login:', e.message);
  }

  // 5. Attach admin context
  req.admin = {
    id: adminRow.id,
    email: adminRow.email,
    full_name: adminRow.full_name,
    role: adminRow.role,
    uid,
  };

  next();
}

/**
 * Role guard.
 * Usage:
 *   router.post('/admins', adminAuth, requireRole('super'), ctrl.addAdmin)
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = adminAuth;
module.exports.requireRole = requireRole;
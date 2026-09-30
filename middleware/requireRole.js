// middleware/requireRole.js
const db = require('../config/db');
const admin = require('../config/firebaseAdmin');

// uid -> { role, profile, source }
const roleCache = new Map();

async function resolveRole(uid) {
  if (roleCache.has(uid)) return roleCache.get(uid);

  let result = null;

  try {
    // 1. Admin?
    const [[adminRow]] = await db.promise().query(
      `SELECT id, email, firebase_uid AS uid, full_name, role
       FROM intec_admins
       WHERE firebase_uid = ? AND active = 1
       LIMIT 1`,
      [uid]
    );
    if (adminRow) {
      result = { role: adminRow.role, profile: adminRow, source: 'admin' };
    }
  } catch (e) {
    console.warn('requireRole: admin lookup failed:', e.message);
  }

  // 2. Official?
  if (!result) {
    try {
      const [[officialRow]] = await db.promise().query(
        `SELECT official_id AS id, uid, full_name, role, estate_id, contact_number
         FROM officials
         WHERE uid = ?
         LIMIT 1`,
        [uid]
      );
      if (officialRow) {
        result = { role: 'official', profile: officialRow, source: 'official' };
      }
    } catch (e) {
      console.warn('requireRole: official lookup failed:', e.message);
    }
  }

  // 3. Resident?
  if (!result) {
    try {
      const [[residentRow]] = await db.promise().query(
        `SELECT household_id AS id, uid, primary_owner AS full_name,
                estate_id, contact_number, status
         FROM households
         WHERE uid = ? AND status = 'Approved'
         LIMIT 1`,
        [uid]
      );
      if (residentRow) {
        result = { role: 'resident', profile: residentRow, source: 'resident' };
      }
    } catch (e) {
      console.warn('requireRole: resident lookup failed:', e.message);
    }
  }

  roleCache.set(uid, result);
  return result;
}

/**
 * Usage:
 *   router.get('/x', requireRole('official'), handler)
 *   router.get('/y', requireRole('official','super','support'), handler)
 */
function requireRole(...allowed) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) {
        return res.status(401).json({ error: 'No token' });
      }

      let decoded;
      try {
        decoded = await admin.auth().verifyIdToken(token);
      } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      const session = await resolveRole(decoded.uid);
      if (!session) {
        return res.status(403).json({ error: 'No role for this uid' });
      }

      if (allowed.length && !allowed.includes(session.role)) {
        return res.status(403).json({
          error: 'Forbidden',
          your_role: session.role,
          allowed,
        });
      }

      req.auth = {
        uid: decoded.uid,
        email: decoded.email || null,
        role: session.role,
        profile: session.profile,
        source: session.source,
      };
      return next();
    } catch (err) {
      console.error('requireRole error:', err.message);
      return res.status(500).json({ error: 'Auth middleware error' });
    }
  };
}

module.exports = { requireRole, resolveRole };
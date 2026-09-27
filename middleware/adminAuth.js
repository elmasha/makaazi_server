// middleware/adminAuth.js

const ADMIN_SHARED_SECRET = process.env.ADMIN_SHARED_SECRET;

module.exports = function adminAuth(req, res, next) {
  if (!ADMIN_SHARED_SECRET) {
    console.error('⚠️ ADMIN_SHARED_SECRET not configured');
    return res.status(500).json({ error: 'Admin auth not configured' });
  }

  const header = req.headers['x-admin-token'] || req.headers['x-admin-secret'];
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const token = header || bearer;

  if (!token || token !== ADMIN_SHARED_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  // Attach a placeholder so downstream handlers know the request is admin
  req.admin = { email: req.headers['x-admin-email'] || 'admin@intec.co.ke' };
  next();
};
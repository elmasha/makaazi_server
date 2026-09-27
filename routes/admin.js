// routes/admin.js
const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;
const ctrl = require('../controllers/adminController');

// ============================================================
// PUBLIC (no auth)
// ============================================================
router.post('/login', ctrl.adminLogin);
router.get('/public-stats', ctrl.getPublicStats);

// ============================================================
// AUTHENTICATED (any admin)
// ============================================================
router.use(adminAuth);

// Identity
router.get('/me', ctrl.getMe);

// Platform stats
router.get('/stats', ctrl.getPlatformStats);

// Estates
router.get('/estates', ctrl.listEstates);
router.post('/estates', ctrl.createEstate);
router.get('/estates/:id', ctrl.getEstate);
router.patch('/estates/:id', ctrl.updateEstate);
router.post('/estates/:id/status', ctrl.setEstateStatus);
router.post('/estates/:id/address-config', ctrl.setAddressConfig);
router.post('/estates/:id/charges', ctrl.addCharge);
router.post('/estates/:id/sections', ctrl.addSection);
router.post('/estates/:id/courts', ctrl.addCourt);
router.post('/estates/:id/streets', ctrl.addStreet);
router.post('/estates/:id/first-official', ctrl.createFirstOfficial);

// Charges
router.delete('/charges/:chargeId', ctrl.deleteCharge);

// Audit — any admin can read
router.get('/audit-logs', ctrl.getAuditLogs);

// ============================================================
// SUPER-ADMIN ONLY
// ============================================================
router.get('/admins', requireRole('super'), ctrl.listAdmins);
router.post('/admins', requireRole('super'), ctrl.addAdmin);
router.patch('/admins/:id', requireRole('super'), ctrl.updateAdmin);
router.delete('/admins/:id', requireRole('super'), ctrl.removeAdmin);

module.exports = router;
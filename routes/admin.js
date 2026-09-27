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

// ------------------------------------------------------------
// Identity
// ------------------------------------------------------------
router.get('/me', ctrl.getMe);

// ------------------------------------------------------------
// Platform stats + activity
// ------------------------------------------------------------
router.get('/stats', ctrl.getPlatformStats);
router.get('/activity', ctrl.getRecentActivity);

// ------------------------------------------------------------
// Estates
// ------------------------------------------------------------
router.get('/estates', ctrl.listEstates);
router.post('/estates', ctrl.createEstate);
router.get('/estates/:id', ctrl.getEstate);
router.patch('/estates/:id', ctrl.updateEstate);
router.delete('/estates/:id', ctrl.archiveEstate);

// Estate sub-resources
router.post('/estates/:id/address-config', ctrl.setAddressConfig);
router.post('/estates/:id/charges', ctrl.addCharge);
router.post('/estates/:id/sections', ctrl.addSection);
router.post('/estates/:id/courts', ctrl.addCourt);
router.post('/estates/:id/streets', ctrl.addStreet);
router.post('/estates/:id/first-official', ctrl.createFirstOfficial);

// Dropdown management
router.delete('/sections/:id', ctrl.deleteSection);
router.delete('/courts/:id', ctrl.deleteCourt);
router.delete('/streets/:id', ctrl.deleteStreet);

// Charges
router.delete('/charges/:chargeId', ctrl.deleteCharge);

// ------------------------------------------------------------
// Officials (cross-estate)
// ------------------------------------------------------------
router.get('/officials', ctrl.listOfficials);
router.delete('/officials/:id', ctrl.deleteOfficial);

// ------------------------------------------------------------
// Subscriptions
// ------------------------------------------------------------
router.get('/subscriptions', ctrl.listSubscriptions);
router.post('/subscriptions', ctrl.upsertSubscription);
router.post('/subscriptions/:id/status', ctrl.setSubscriptionStatus);

// ------------------------------------------------------------
// Subscription plans (CRUD — super admin for mutations)
// ------------------------------------------------------------
router.get('/subscription-plans', ctrl.listSubscriptionPlans);
router.post('/subscription-plans', requireRole('super'), ctrl.createSubscriptionPlan);
router.patch('/subscription-plans/:id', requireRole('super'), ctrl.updateSubscriptionPlan);
router.delete('/subscription-plans/:id', requireRole('super'), ctrl.deleteSubscriptionPlan);

// ------------------------------------------------------------
// Residents (cross-estate household view)
// ------------------------------------------------------------
router.get('/residents', ctrl.listResidents);

// ------------------------------------------------------------
// Audit logs (any admin can read)
// ------------------------------------------------------------
router.get('/audit-logs', ctrl.getAuditLogs);

// ------------------------------------------------------------
// SMS logs + balance (any admin can read)
// NOTE: /sms-balance and /sms-stats MUST be registered
// BEFORE /sms-logs/:id, otherwise Express matches them
// against the :id param.
// ------------------------------------------------------------
router.get('/sms-balance', ctrl.getSmsBalance);
router.get('/sms-stats',   ctrl.getSmsStats);
router.get('/sms-logs',    ctrl.listSmsLogs);
router.get('/sms-logs/:id', ctrl.getSmsLog);

// ============================================================
// SUPER-ADMIN ONLY
// ============================================================
router.get('/admins', requireRole('super'), ctrl.listAdmins);
router.post('/admins', requireRole('super'), ctrl.addAdmin);
router.patch('/admins/:id', requireRole('super'), ctrl.updateAdmin);
router.delete('/admins/:id', requireRole('super'), ctrl.removeAdmin);
router.get('/admins/eligible-users', requireRole('super'), ctrl.listEligibleAdminUsers);

module.exports = router;
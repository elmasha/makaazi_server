// routes/admin.js
const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const ctrl = require('../controllers/adminController');

// Public — login only
router.post('/login', ctrl.adminLogin);

// Everything below requires admin token
router.use(adminAuth);

// Stats
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

// Audit
router.get('/audit-logs', ctrl.getAuditLogs);

module.exports = router;
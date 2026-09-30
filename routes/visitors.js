// routes/visitors.js
const router = require('express').Router();
const c = require('../controllers/visitorsController');
const { requireRole } = require('../middleware/requireRole');

const everyone  = requireRole('resident','official','super','support','readonly');
const canWrite  = requireRole('resident','official','super','support');
const officialW = requireRole('official','super','support');
const official  = requireRole('official','super','support','readonly');

// -------- PUBLIC (no auth) --------
// Registered FIRST so they aren't shadowed by /:id or the auth guard.
router.get ('/public/:code',  c.getPublicPass);
router.post('/checkin/:code', c.checkinPass);

// -------- AUTHENTICATED --------
router.get   ('/mine',                    everyone,  c.listMyPasses);
router.get   ('/estate/:estateId',        official,  c.listEstatePasses);
router.get   ('/estate/:estateId/stats',  official,  c.getEstatePassStats);
router.post  ('/verify',                  officialW, c.verifyPass);
router.get   ('/:id',                     everyone,  c.getPass);
router.post  ('/',                        canWrite,  c.createPass);
router.post  ('/:id/cancel',              canWrite,  c.cancelPass);
router.post  ('/:id/extend',              canWrite,  c.extendPass);

module.exports = router;
// routes/visitorPasses.js
const router = require('express').Router();
const c = require('../controllers/visitorsController');
// const { requireRole } = require('../middleware/requireRole');

// const everyone  = requireRole('resident','official','super','support','readonly');
// const canWrite  = requireRole('resident','official','super','support');
// const officialW = requireRole('official','super','support');
// const official  = requireRole('official','super','support','readonly');

// // Specific paths first
// router.get   ('/mine',                    everyone,  c.listMyPasses);
// router.get   ('/estate/:estateId',        official,  c.listEstatePasses);
// router.get   ('/estate/:estateId/stats',  official,  c.getEstatePassStats);
// router.post  ('/verify',                  officialW, c.verifyPass);   // gate
// router.get   ('/:id',                     everyone,  c.getPass);
// router.post  ('/',                        canWrite,  c.createPass);
// router.post  ('/:id/cancel',              canWrite,  c.cancelPass);
// router.post  ('/:id/extend',              canWrite,  c.extendPass);

// Specific paths first
router.get   ('/mine',                    c.listMyPasses);
router.get   ('/estate/:estateId',        c.listEstatePasses);
router.get   ('/estate/:estateId/stats',  c.getEstatePassStats);
router.post  ('/verify',                  c.verifyPass);   // gate
router.get   ('/:id',                     c.getPass);
router.post  ('/',                        c.createPass);
router.post  ('/:id/cancel',              c.cancelPass);
router.post  ('/:id/extend',              c.extendPass);

module.exports = router;
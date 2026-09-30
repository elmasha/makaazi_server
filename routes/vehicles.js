// routes/vehicles.js
const router = require('express').Router();
const c = require('../controllers/vehicleController');
const { requireRole } = require('../middleware/requireRole');

const everyone  = requireRole('resident','official','super','support','readonly');
const canWrite  = requireRole('resident','official','super','support');
const official  = requireRole('official','super','support','readonly');
const officialW = requireRole('official','super','support');

// Specific paths first, /:id last
router.get   ('/mine',                     everyone,   c.listMyVehicles);
router.get   ('/estate/:estateId',         official,   c.listEstateVehicles);
router.get   ('/estate/:estateId/stats',   official,   c.getEstateVehicleStats);
router.get   ('/logs/estate/:estateId',    official,   c.listAccessLogs);
router.post  ('/logs',                     officialW,  c.logAccess);
router.post  ('/lookup-plate',             officialW,  c.lookupPlate);
router.get   ('/:id',                      everyone,   c.getVehicle);
router.post  ('/',                         canWrite,   c.createVehicle);
router.patch ('/:id',                      canWrite,   c.updateVehicle);
router.post  ('/:id/approve',              officialW,  c.approveVehicle);
router.post  ('/:id/suspend',              officialW,  c.suspendVehicle);
router.delete('/:id',                      canWrite,   c.deleteVehicle);

module.exports = router;
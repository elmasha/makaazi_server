// routes/households.js
const express = require('express');
const router = express.Router();

const {
  getAllHouseholds,
  getHouseholdsByAddress,
  searchHouseholds,
  searchHouseholdsId,
  getHsHlByEstateId,
  getActiveEstate,
  getActiveHouseHolds,
  getOfficials,
  existingHousehold,
  getHouseholdByPhone,
  getHouseholdByUid,
  getHouseholdById,
  createHousehold,
  updateHouseholdRoles,
  updateHousehold,
  deleteHousehold,
} = require('../controllers/householdsController');

const {
  registerHousehold,
  getRegistrationStatus,
  getPendingHouseholds,
  approveHousehold,
  rejectHousehold,
} = require('../controllers/householdApprovalController');

// ============================================================
// ORDER MATTERS — static/scoped first, /:id last
// ============================================================

// ---- Self-registration (resident) ----
router.post('/register',                            registerHousehold);
router.get('/registration-status/:uid',             getRegistrationStatus);

// ---- Official approval flow ----
router.get('/estate/:estateId/pending',             getPendingHouseholds);
router.post('/:householdId/approve',                approveHousehold);
router.post('/:householdId/reject',                 rejectHousehold);

// ---- Static reads ----
router.get('/getAll',                               getAllHouseholds);
router.get('/by-address',                           getHouseholdsByAddress);
router.get('/search',                               searchHouseholds);
router.get('/searchExisting/:phone',                existingHousehold);
router.get('/getOfficials/:is_official',            getOfficials);

// ---- Estate-scoped reads ----
router.get('/getBHsHldEstId/:id',                   getHsHlByEstateId);
router.get('/searchEstate/:id',                     searchHouseholdsId);
router.get('/getActiveEstate/:active/:estate_id',   getActiveEstate);
router.get('/getActiveaddHouseHold/:active',        getActiveHouseHolds);

// ---- Identity lookups ----
router.get('/getHouseHoldId/:uid',                  getHouseholdByUid);
router.get('/getHouseHoldByPhone/:estateId/:phone', getHouseholdByPhone);
router.get('/getHousehold/:id',                     getHouseholdById);

// ---- Writes (official-side create / edit) ----
router.post('/addHousehold',                        createHousehold);
router.patch('/update_household/:id',               updateHousehold);
router.post('/updateRoles/:id',                     updateHouseholdRoles);
router.delete('/deleteHousehold/:id',               deleteHousehold);

module.exports = router;
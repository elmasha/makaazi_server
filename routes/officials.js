// routes/officials.js
const express = require('express');
const router = express.Router();

const {
  getAllOfficials,
  addOfficial,
  getOfficialByEstateId,
  getOfficialByContact,
  getOfficialById,
  searchOfficials,
  updateOfficial,
  deleteOfficial,
  existingOfficial,
  getAddressSummary,
} = require('../controllers/officialsController');

// ---- Reads ----
router.get('/getAll',                        getAllOfficials);
router.get('/getOfficialByEstateId/:estate_id', getOfficialByEstateId);
router.get('/getOfficialByContact/:phone',   getOfficialByContact);
router.get('/getOfficialById/:uid',          getOfficialById);
router.get('/search',                        searchOfficials);
router.get('/existingOfficial/:phone',       existingOfficial);
router.get('/address-summary',               getAddressSummary);

// ---- Writes ----
router.post('/addOfficial',                  addOfficial);
router.patch('/update_official/:id',         updateOfficial);
router.put('/delete_official/:id',           deleteOfficial);

module.exports = router;
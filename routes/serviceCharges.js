// routes/serviceCharges.js
const express = require('express');
const router = express.Router();

const {
  getAllCharges,
  getEstateServiceCharges,
  addCharge,
  updateCharges,
  deleteCharge,
} = require('../controllers/serviceChargesController');

// ---- Reads ----
router.get('/getAll', getAllCharges);
router.get('/getEstateServiceCharges/:id', getEstateServiceCharges);

// ---- Writes ----
router.post('/addServiceCharge', addCharge);
router.put('/update/:id', updateCharges);
router.delete('/delete/:id', deleteCharge);

module.exports = router;
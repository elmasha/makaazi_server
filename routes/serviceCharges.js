const express = require('express');
const router = express.Router();
const { getAllCharges, addCharge,getEstateServiceCharges } = require('../controllers/serviceChargesController');

router.get('/getAll', getAllCharges);     // Get all charges
router.get('/getEstateServiceCharges/:id', getEstateServiceCharges);     // Get Estate charges
router.post('/addServiceCharge', addCharge);        // Add a new charge

module.exports = router;

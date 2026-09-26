const express = require('express');
const router = express.Router();
const { getAllArrears, createArrear } = require('../controllers/arrearsController');

router.get('/', getAllArrears);     // Get all arrears
router.post('/', createArrear);     // Create an arrear record

module.exports = router;

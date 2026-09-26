const express = require('express');
const router = express.Router();
const { getAllCashRouting, addCashRouting } = require('../controllers/cashRoutingController');

router.get('/', getAllCashRouting); // Get all cash routing records
router.post('/', addCashRouting);   // Add cash routing

module.exports = router;

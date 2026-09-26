const express = require('express');
const router = express.Router();
const { getAllReceipts, createReceipt } = require('../controllers/receiptsController');

router.get('/', getAllReceipts);     // Get all receipts
router.post('/', createReceipt);     // Create a new receipt

module.exports = router;

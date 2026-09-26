const express = require('express');
const router = express.Router();
const { getAllReports, generateReport } = require('../controllers/reportsController');

router.get('/', getAllReports);     // Get all reports
router.post('/', generateReport);   // Generate a report

module.exports = router;

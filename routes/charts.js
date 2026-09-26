const express = require('express');
const router = express.Router();
const { getMonthlyEstateSummary, getHouseholdTrendsByEstate } = require('../controllers/chartsControllers');

router.get('/monthly-estate-summary', getMonthlyEstateSummary);    // Create a new estate
router.get('/trends/:estate_id', getHouseholdTrendsByEstate);// get estate

module.exports = router;

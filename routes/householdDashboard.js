// routes/householdDashboard.js
const express = require('express');
const router = express.Router();

const {
  getHouseholdDashboard,
  getPaymentSummary,
  getHouseholdDashboardById,
} = require('../controllers/householdDashboardController');

const {
  getEstateSummary,
  getEstateHouseholdList,
} = require('../controllers/estateSummaryController');

// ----- Household dashboard (resident side) -----
router.get('/dashboard/:uid',              getHouseholdDashboard);
router.get('/dashboard/pk/:householdId',   getHouseholdDashboardById);
router.get('/payment-summary/:uid',        getPaymentSummary);

// ----- Estate summary (official side) -----
router.get('/estate/:estateId/summary',              getEstateSummary);
router.get('/estate/:estateId/households/list',      getEstateHouseholdList);

module.exports = router;
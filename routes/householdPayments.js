const express = require('express');
const router = express.Router();
const controller = require('../controllers/householdPaymentsController');

router.get('/getAllPayments/:id', controller.getAllPayments); // All or filtered
router.get('/summary/:household_id', controller.getMonthlySummary); // Monthly summary
router.get('/overdue', controller.getOverdueHouseholds); // Overdue list
router.get('/getPaymentById/:id', controller.getPaymentById); // Single by ID
router.get('/getPaymentByUid/:id', controller.getPaymentByUid); // Single by UID
router.post('/applyPayment', controller.applyMonthlyPayment); // apply payment
router.post('/addPayment', controller.createPayment); // Create
router.patch('/updatePayment/:id', controller.updatePayment); // Update
router.delete('/deletePayment/:id', controller.deletePayment); // Delete
router.post('/initNewYear', controller.initializeNewYearPayments); // Delete
router.get('/yearly-summary', controller.getHouseholdYearlySummary);
router.get('/by-estate/:estate_id', controller.getHouseholdYearlySummary);
router.get('/year-by-estate/:id', controller.getHouseholdYearlySummaryEstate);
router.get('/summaryHousehold/:household_id', controller.getSummaryByHouseholdId);
router.get('/summaryEstateSearch/:id', controller.getSummaryByEstateId);
router.get('/dashboard/:uid', controller.getHouseholdDashboard); // Dashboard data for household
router.get("/payments/by-address", controller.getHouseholdPaymentsByAddress);


module.exports = router;

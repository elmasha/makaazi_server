const express = require('express');
const router = express.Router();
const { getAllPayments, makePayment,searchEstateId,getPaymentById,searchHouseholdsId,getUserQueryPayments,getPaymentByEstateId,getEstateQueryPayments,searchAllPayments,getPaymentSummaryByEstate } = require('../controllers/paymentsController');

router.get('/getAll', getAllPayments);    // Get all payments
router.post('/', makePayment);      // Make a payment
router.get('/getPaymentByHsId/:id',getPaymentById) // Pay
 router.get('/getPaymentByHsQuery/:id',getUserQueryPayments) // Payment ID
 router.get('/getPaymentByHsQuery/:id',getUserQueryPayments) // Payment ID
 router.get('/getPaymentByEstQuery/:id',getEstateQueryPayments) // Payment ID
router.get('/search/:id',searchHouseholdsId) // Payment ID
router.get('/getByEstateId/:id',getPaymentByEstateId) // Payment ID
router.get('/getPaymentSummaryByEstate/:id',getPaymentSummaryByEstate) // Payment ID
router.get('/searchAll',searchAllPayments) // Payment ID
router.get('/searchEstate/:id',searchEstateId) // Payment ID



module.exports = router;

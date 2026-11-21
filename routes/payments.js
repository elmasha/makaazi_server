const express = require('express');
const router = express.Router();

const { 
  getAllPayments, 
  makePayment,
  searchEstateId,
  getPaymentById,
  searchHouseholdsId,
  getUserQueryPayments,
  getPaymentByEstateId,
  getEstateQueryPayments,
  searchAllPayments,
  getPaymentSummaryByEstate,
  // NEW IMPORTS
  stkPushSubscription,
  mpesaCallback
} = require('../controllers/paymentsController');

// --- EXISTING ROUTES ---
router.get('/getAll', getAllPayments);    
router.post('/', makePayment);      
router.get('/getPaymentByHsId/:id', getPaymentById); 
router.get('/getPaymentByHsQuery/:id', getUserQueryPayments); 
router.get('/getPaymentByEstQuery/:id', getEstateQueryPayments); 
router.get('/search/:id', searchHouseholdsId); 
router.get('/getByEstateId/:id', getPaymentByEstateId); 
router.get('/getPaymentSummaryByEstate/:id', getPaymentSummaryByEstate); 
router.get('/searchAll', searchAllPayments); 
router.get('/searchEstate/:id', searchEstateId); 

// --- NEW M-PESA ROUTES ---

// 1. Initiate STK Push (Frontend calls this)
router.post('/stk_push_subscription', stkPushSubscription);

// 2. Safaricom Callback (Safaricom hits this, do NOT put auth middleware on this)
router.post('/callback', mpesaCallback);

// 3. Query STK Push status (Frontend polling)
// (If you are using the query endpoint I mentioned earlier, add it here)
// router.post('/stk_push_subscription/query', stkQuery);


module.exports = router;
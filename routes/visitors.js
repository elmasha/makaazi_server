const express = require('express');
const router = express.Router();
const { createVisitor,getAllVisitors,getVisitorById,updateVisitor,deleteVisitor } = require('../controllers/visitorsController');

// router.get('/', getAllVisitors);    // Get all visitors
router.post('/createVisitor', createVisitor);
router.get('/getAllVisitors', getAllVisitors);
router.get('/getVisitorById:visitor_id', getVisitorById);
router.patch('/updateVisitor:visitor_id', updateVisitor);
router.delete('/deleteVisitor:visitor_id', deleteVisitor);

module.exports = router;   // Register a visitor


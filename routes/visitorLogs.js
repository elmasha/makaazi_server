const express = require('express');
const router = express.Router();
const { getAllVisitorLogs, createVisitorLog } = require('../controllers/visitorLogsController');

router.get('/', getAllVisitorLogs); // Get all visitor logs
router.post('/', createVisitorLog); // Add a visitor log

module.exports = router;

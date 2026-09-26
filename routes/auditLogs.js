const express = require('express');
const router = express.Router();
const { getAllAuditLogs, createAuditLog } = require('../controllers/auditLogsController');

router.get('/', getAllAuditLogs);   // Get all audit logs
router.post('/', createAuditLog);   // Create an audit log

module.exports = router;

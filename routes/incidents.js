const express = require('express');
const router = express.Router();
const { getAllIncidents, reportIncident } = require('../controllers/incidentsController');

router.get('/', getAllIncidents);    // Get all incidents
router.post('/', reportIncident);    // Report an incident

module.exports = router;

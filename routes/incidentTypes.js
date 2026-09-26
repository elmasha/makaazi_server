const express = require('express');
const router = express.Router();
const { getAllIncidentTypes, createIncidentType } = require('../controllers/incidentTypesController');

router.get('/', getAllIncidentTypes); // Get all incident types
router.post('/', createIncidentType); // Create an incident type

module.exports = router;

const express = require('express');
const router = express.Router();
const { getAllSections, createSection } = require('../controllers/sectionsController');

router.get('/', getAllSections);    // Get all sections
router.post('/', createSection);    // Create a new section

module.exports = router;

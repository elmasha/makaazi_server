const express = require('express');
const router = express.Router();
const { getAllRoles, createRole } = require('../controllers/rolesController');

router.get('/', getAllRoles);      // Get all roles
router.post('/', createRole);      // Create a new role

module.exports = router;

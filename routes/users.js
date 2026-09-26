const express = require('express');
const router = express.Router();
const { getAllUsers, createUser } = require('../controllers/usersController');

router.get('/', getAllUsers);      // Get all users
router.post('/', createUser);      // Create a new user

module.exports = router;

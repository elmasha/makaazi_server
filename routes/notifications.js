const express = require('express');
const router = express.Router();
const { sendNotification,getNotifications } = require('../controllers/notificationsController');

router.post('/send', sendNotification); // Send a notification
router.get('/get-notify/:uid', getNotifications); // Get notifications for a user
module.exports = router;

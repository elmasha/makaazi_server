// routes/notifications.js
const express = require('express');
const router = express.Router();

const {
  sendNotification,
  getNotifications,
  markNotificationRead,
  markAllRead,
  deleteNotification,
} = require('../controllers/notificationsController');

// ---- Send a notification (admin/system) ----
router.post('/send', sendNotification);

// ---- List notifications for a user ----
// Keep both paths so old + new clients work
router.get('/get-notify/:uid', getNotifications);   // ✅ existing
router.get('/:uid',            getNotifications);   // ⚡ alias matching the Vue page

// ---- Actions ----
// Order matters: static routes before :id
router.patch('/:uid/read-all',        markAllRead);          // ⚡ mark ALL
router.patch('/:id/read',             markNotificationRead);  // ⚡ mark one
router.delete('/:id',                 deleteNotification);    // ⚡ delete

module.exports = router;
// controllers/notificationsController.js
const redisClient = require('../config/redis');
const { sendNotification: dispatchNotification } = require('../utils/notify');
const db = require('../config/db');

// ============================================================
// POST /notifications/send
// Publish + persist + push a notification
// ============================================================
exports.sendNotification = async (req, res) => {
  const { message, uid, title } = req.body;

  if (!uid) {
    return res.status(400).json({ error: 'uid is required' });
  }

  try {
    // Publish to Redis (for live subscribers)
    await new Promise((resolve, reject) => {
      redisClient.publish('notifications', message || title || '', (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Send + persist via the notify utility
    await dispatchNotification({
      user_uid: uid,
      user_type: 'USER',
      title: title || 'Notification',
      message: message || '',
      type: 'SYSTEM',
    });

    return res.json({ message: 'Notification sent' });
  } catch (err) {
    console.error('sendNotification error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ============================================================
// GET /notifications/get-notify/:uid  (and /notifications/:uid alias)
// Returns all notifications for a user, newest first
// ============================================================
exports.getNotifications = async (req, res) => {
  const { uid } = req.params;

  if (!uid) {
    return res.status(400).json({ error: 'uid is required' });
  }

  try {
    const [rows] = await db.promise().query(
      `SELECT id, user_uid, user_type, title, message, type, is_read, created_at
       FROM notifications
       WHERE user_uid = ?
       ORDER BY created_at DESC`,
      [uid]
    );

    return res.json(rows);
  } catch (err) {
    console.error('getNotifications error:', err.message);
    return res.status(500).json({ message: 'DB error' });
  }
};

// ============================================================
// PATCH /notifications/:id/read
// Mark a single notification as read
// ============================================================
exports.markNotificationRead = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'id is required' });
  }

  try {
    const [result] = await db.promise().query(
      `UPDATE notifications SET is_read = 1 WHERE id = ?`,
      [id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    return res.json({ message: 'Marked as read' });
  } catch (err) {
    console.error('markNotificationRead error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ============================================================
// PATCH /notifications/:uid/read-all
// Mark all notifications for a user as read
// ============================================================
exports.markAllRead = async (req, res) => {
  const { uid } = req.params;

  if (!uid) {
    return res.status(400).json({ error: 'uid is required' });
  }

  try {
    await db.promise().query(
      `UPDATE notifications SET is_read = 1 WHERE user_uid = ? AND is_read = 0`,
      [uid]
    );
    return res.json({ message: 'All marked as read' });
  } catch (err) {
    console.error('markAllRead error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ============================================================
// DELETE /notifications/:id
// Delete a single notification
// ============================================================
exports.deleteNotification = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'id is required' });
  }

  try {
    const [result] = await db.promise().query(
      `DELETE FROM notifications WHERE id = ?`,
      [id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('deleteNotification error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
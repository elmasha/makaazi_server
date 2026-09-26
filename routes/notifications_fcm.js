const express = require("express");
const router = express.Router();
const { sendFCMNotification } = require("./notification/notificationsController");

router.post("/send", sendFCMNotification); // Send Notification to a single user

module.exports = router;

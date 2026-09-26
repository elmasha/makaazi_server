const express = require("express");
const router = express.Router();
const { sendFCMNotification,saveToken,getTokenById,updateFcmToken } = require("../notification/notificationsController");

router.post("/sendNotification", sendFCMNotification); // Send Notification to a single user
router.post("/save-token", saveToken); // Save FCM token
router.get("/get-token/:id", getTokenById); // Save FCM Get token
router.patch("/updateFcmToken/:uid", updateFcmToken); // Save FCM Get token

module.exports = router;

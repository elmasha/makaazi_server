const admin = require("../config/fcm");
const db = require("../config/db");


// Send Notification to a Single User
exports.sendFCMNotification = async (req, res) => {
    const { fcmToken, title, body } = req.body;

    if (!fcmToken || !title || !body ) {
        return res.status(400).json({ error: "FCM Token, title, and body are required" });
    }

    
    const message = {
        notification: {
            title,
            body,
         },
         apns: {
             payload: {
                aps: {
                    icon: 4,
                }
             }
        },
        token: fcmToken
     };
 
    try {
        const response = await admin.messaging().send(message);
        console.log("✅ Notification sent successfully:", response);
        res.status(200).json({ message: "Notification sent", response });
    } catch (error) {
        console.error("❌ Error sending notification:", error);
        res.status(500).json({ error: "Failed to send notification" });
    }
};


exports.saveToken =  async (req, res) => {
    const { user_id, fcm_token, uid } = req.body;

    if (!user_id || !fcm_token  || !uid) {
        return res.status(400).json({ error: "User ID and FCM Token are required" });
    }

    const sql = `INSERT INTO user_tokens (user_id, fcm_token,uid) VALUES (?, ?,?)`;
    db.query(sql, [user_id, fcm_token,uid], (err, result) => {
        if (err != null) {
            console.error("Database error:", err.message);
            return res.status(500).json({ error: err.message });
        }
           console.log("data:", result);
           return res.status(200).json({ message: "Token saved successfully" });
        
       
    });
};



///.......Update Estate......////
exports.updateFcmToken = (req, res) => {
    const uid = req.params.uid;
    const fields = req.body;

    // Check if the ID is provided
    if (!uid) {
        return res.status(400).json({ error: "User ID is required" });
    }
    // Check if there are fields to update
    if (Object.keys(fields).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
    }
    // Build dynamic SQL query and values array
    let sql = "UPDATE user_tokens SET ";
    const values = [];

    for (const [key, value] of Object.entries(fields)) {
        sql += `${key} = ?, `;
        values.push(value);
    }
    // Remove the last comma and space
    sql = sql.slice(0, -2);

    // Add the WHERE clause
    sql += " WHERE uid = ?";
    values.push(uid);

    // Execute the query
    db.query(sql, values, (err, result) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(500).json({ error: err.message });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "User ID not found" });
        }

         return res.status(200).json({ message: "User ID updated successfully" });
    });
};


////.........Get Token by ID........////
exports.getTokenById = (req, res) => {
    const user_id = req.params.id;
    const sql = `SELECT * FROM user_tokens WHERE user_id = ?`;
    db.query(sql, [user_id], (err, results) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(500).send("Error retrieving estate");
        }

        if (results.length === 0) {
            return res.send("Fcm not found");
        }

        res.status(200).json(results[0]);
    });
};
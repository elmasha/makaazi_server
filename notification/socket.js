const express = require('express');
const admin = require('firebase-admin');
const socketIo = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Initialize Firebase Admin
const serviceAccount = require("./service_account.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// Store users' FCM tokens
let userTokens = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('registerToken', (data) => {
        userTokens[data.userId] = data.token;
        console.log(`Token registered for user ${data.userId}: ${data.token}`);
    });

    socket.on('sendNotification', (data) => {
        io.to(data.room).emit('receiveNotification', data.message);

        // Send Firebase Notification
        if (userTokens[data.userId]) {
            const payload = {
                notification: {
                    title: "New Alert",
                    body: data.message,
                },
                token: userTokens[data.userId]
            };

            admin.messaging().send(payload)
                .then(response => console.log("FCM Sent:", response))
                .catch(error => console.error("FCM Error:", error));
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});


module.exports = io;

const admin = require("firebase-admin");
const serviceAccount = require("../service_account.js");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

module.exports = admin;
const admin = require('firebase-admin');
const serviceAccount = require('../service_account.js');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log('✅ Firebase Admin initialized');
}

module.exports = admin;
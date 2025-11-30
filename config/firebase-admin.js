// config/firebaseAdmin.js
const admin = require("firebase-admin");
const serviceAccount = require("./astroguru-chat-firebase-adminsdk.json"); // download from firebase

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

module.exports = admin;
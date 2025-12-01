require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const bodyParser = require("body-parser");
const path = require("path");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");
const admin = require("firebase-admin"); // ← YE NAYA ADD HUA

const User = require("./models/Users");
const Message = require("./models/Message");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// ================ FIREBASE ADMIN SETUP (OFFLINE PUSH) ================
// DELETE YE LINE
// const serviceAccount = require("./firebase-service-account.json");

// ISKE BADLE YE DAALO
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || "dummy", // optional
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"), // ← YE ZAROORI HAI!
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID || "dummy",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FIREBASE_CLIENT_EMAIL}`
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

console.log("Firebase Admin Initialized from .env (SECURE!)");

// ================ MIDDLEWARES ================
app.use(cors());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('trust proxy', 1); // trust first proxy

app.use(session({
  secret: "astro-secret-123",
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === "production", 
    maxAge: 24 * 60 * 60 * 1000 
  }
}));

// ================ MONGODB ================

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ MongoDB Error:", err));
// ================ MULTER ================
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });

// ================ AUTH MIDDLEWARE ================
function isAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not Logged In" });
  next();
}

// ================ ROUTES ================
app.get("/signup", (req, res) => res.sendFile(path.join(__dirname, "public", "signup.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/profile", isAuth, (req, res) => res.sendFile(path.join(__dirname, "public", "profile.html")));
app.get("/astrologer", isAuth, (req, res) => res.sendFile(path.join(__dirname, "public", "astrologer.html")));

// ================ LOGIN (unchanged) ================
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found!" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Incorrect password!" });

    req.session.userId = user._id;
    req.session.userType = user.userType;

    req.session.save(err => {
      if (err) return res.status(500).json({ error: "Session error" });
      res.json({ success: true });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ================ GET ALL ASTROLOGERS ================
app.get("/api/astrologers", async (req, res) => {
  try {
    const astrologers = await User.find({ userType: "astrologer" }).select("-password");
    res.json(astrologers);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ================ GET LOGGED-IN USER ================
// ---------------- GET LOGGED-IN USER ----------------
app.get("/api/user", async (req, res) => {
  try {
    // Check if user is logged in
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not logged in" });
    }

    // Fetch user from DB
    const user = await User.findById(req.session.userId).lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    // Remove sensitive info
    delete user.password;

    // Ensure _id is a string (for Socket.IO)
    user._id = user._id.toString();

    // Set default fields if missing
    user.fullName = user.fullName || "User";
    user.email = user.email || "";
    user.dob = user.dob || null;
    user.gender = user.gender || "Not set";
    user.profileImage = user.profileImage || null;
    user.userType = user.userType || "user";
    user.prices = user.prices || {};

    res.json(user);

  } catch (err) {
    console.error("Error fetching user:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ================ SAVE FCM TOKEN (Naya Route) ================
app.post("/api/save-fcm-token", isAuth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Token missing" });

    await User.findByIdAndUpdate(req.session.userId, { fcmToken: token });
    console.log(`FCM Token saved for user: ${req.session.userId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("FCM Token save error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ================ SOCKET.IO + FCM PUSH (MAIN MAGIC) ================
const onlineUsers = {}; // userId → socket.id

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("register", async (userId) => {
    if (!userId) return;
    onlineUsers[userId] = socket.id;
    console.log(`User ${userId} is now online`);

    // Send old unread messages
    try {
      const unreadMessages = await Message.find({
        to: userId,
        seen: false
      })
      .populate("from", "fullName profileImage")
      .sort({ timestamp: 1 });

      for (const msg of unreadMessages) {
        socket.emit("chatMessage", {
          from: msg.from._id.toString(),
          fromName: msg.from.fullName,
          message: msg.message,
          timestamp: msg.timestamp
        });
        msg.seen = true;
        await msg.save();
      }
    } catch (err) {
      console.error("Error loading unread messages:", err);
    }
  });

  // ================ NEW MESSAGE ================
// ================ NEW MESSAGE (FULLY FIXED VERSION) ================
socket.on("chatMessage", async ({ to, from, message }) => {
  if (!to || !from || !message?.trim()) return;

  try {
    // Save message in DB
    const savedMessage = new Message({ from, to, message: message.trim() });
    await savedMessage.save();

    const populatedMessage = await Message.findById(savedMessage._id)
      .populate("from", "fullName profileImage");

    const messageData = {
      from: populatedMessage.from._id.toString(),
      fromName: populatedMessage.from.fullName,
      fromImage: populatedMessage.from.profileImage || null,
      message: populatedMessage.message,
      timestamp: populatedMessage.timestamp
    };

    const receiverSocketId = onlineUsers[to];

    // Agar receiver online hai → real-time Socket.IO se bhejo
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("chatMessage", messageData);
      savedMessage.seen = true;
      await savedMessage.save();
    } 
    // Agar offline hai → FCM se DATA MESSAGE only bhejo (sabse reliable)
    else {
      const receiver = await User.findById(to);
      if (receiver?.fcmToken) {
        try {
          const payload = {
            token: receiver.fcmToken,
            data: {  // ← Sirf data payload (best practice 2025)
              title: `New Message from ${populatedMessage.from.fullName}`,
              body: message.trim().substring(0, 100) + (message.trim().length > 100 ? "..." : ""),
              url: "https://asteroguru.onrender.com/astrologer",
              click_action: "OPEN_CHAT_ACTIVITY"
            },
            android: {
              priority: "high",
              notification: {
                channelId: "mystudy_channel",
                sound: "default",
                clickAction: "OPEN_CHAT_ACTIVITY",
                defaultSound: true,
                visibility: "private"
              }
            },
            apns: {
              payload: {
                aps: {
                  sound: "default",
                  badge: 1,
                  category: "MESSAGE_CATEGORY"
                }
              }
            }
          };

          await admin.messaging().send(payload);
          console.log(`FCM Data Message sent to ${receiver.fullName} (User was offline)`);

        } catch (error) {
          console.error("FCM Send Failed:", error.message);

          // Token invalid ya expired → DB se hata do
          if (error.code === 'messaging/registration-token-not-registered' ||
              error.code === 'messaging/invalid-registration-token') {
            await User.findByIdAndUpdate(to, { $unset: { fcmToken: 1 } });
            console.log("Invalid FCM token removed for user:", to);
          }
        }
      } else {
        console.log("Receiver has no FCM token");
      }
    }

    // Sender ko bhi message dikhao (apna message right side pe)
    const senderSocketId = onlineUsers[from];
    if (senderSocketId) {
      io.to(senderSocketId).emit("chatMessage", messageData);
    }

  } catch (err) {
    console.error("Error in chatMessage handler:", err);
  }
});

  socket.on("disconnect", () => {
    for (const userId in onlineUsers) {
      if (onlineUsers[userId] === socket.id) {
        console.log(`User ${userId} went offline`);
        delete onlineUsers[userId];
        break;
      }
    }
  });
});



// Dynamic Service Worker – secrets bilkul nahi jayenge GitHub pe
app.get("/firebase-messaging-sw.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.send(`
    importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js");
    importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js");

    firebase.initializeApp({
      apiKey: "${process.env.FIREBASE_WEB_API_KEY}",
      authDomain: "${process.env.FIREBASE_AUTH_DOMAIN}",
      projectId: "${process.env.FIREBASE_PROJECT_ID}",
      storageBucket: "${process.env.FIREBASE_STORAGE_BUCKET}",
      messagingSenderId: "${process.env.FIREBASE_MESSAGING_SENDER_ID}",
      appId: "${process.env.FIREBASE_APP_ID}"
    });

    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      console.log("Background message:", payload);
      const title = payload.data?.title || "New Message from Astrologer";
      const options = {
        body: payload.data?.body || "Click to open chat",
        icon: "/icon-192.png",
        badge: "/badge-72.png",
        tag: "chat-message",
        renotify: true,
        requireInteraction: true
      };
      self.registration.showNotification(title, options);
    });

    self.addEventListener("notificationclick", (event) => {
      event.notification.close();
      event.waitUntil(clients.openWindow("/astrologer"));
    });
  `);
});

// 1. Firebase Web Config (public – lekin server se serve kar rahe hain)
app.get("/api/firebase-config", (req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_WEB_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
  });
});

// 2. VAPID Key (ye bhi public hai, lekin clean ke liye alag se)
app.get("/api/vapid-key", (req, res) => {
  res.json({ 
    vapidKey: process.env.FIREBASE_VAPID_KEY || "BKgrJTz4gFHA_eMTQKxltSaqL3yr9YIcsHk6t8zviNaNG4-0ENcv7n8znT91BUFmqpqYaJS2jWzsQRHCUz8FV9A"
  });
});
app.get("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.log("Logout error:", err);
      return res.status(500).json({ error: "Logout failed" });
    }

    // Session cookie clear karo
    res.clearCookie("connect.sid");

    return res.json({ message: "Logged out successfully" });
  });
});


// ================ START SERVER ================
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Go to: http://localhost:${PORT}/signup`);
  console.log(`OFFLINE PUSH NOTIFICATIONS ENABLED!`);
});










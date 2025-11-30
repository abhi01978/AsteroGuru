

// public/firebase-messaging-sw.js
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js");

firebase.initializeApp({
 apiKey: "AIzaSyAiHAhRvakTIAkJCxsfYBVMo-TfTmQwFnA",
  authDomain: "astroguru-chat.firebaseapp.com",
  projectId: "astroguru-chat",
  storageBucket: "astroguru-chat.firebasestorage.app",
  messagingSenderId: "709987887042",
  appId: "1:709987887042:web:2eac33a465a2399c16d85b",
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const title = payload.data?.title || "New Message";
  const options = {
    body: payload.data?.body || "You have a new message",
    icon: "/astrology-icon.png",
    tag: "chat-message",
    data: { url: "/" }
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('https://asteroguru.onrender.com/astrologer'));
});

const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, "Full Name is required"],
    trim: true,
    minlength: 2
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, "Password is required"],
    minlength: 6
  },
  dob: {
    type: Date,
    required: [true, "Date of Birth is required"]
  },
  gender: {
    type: String,
    enum: ["male", "female", "other"],
    required: [true, "Gender is required"]
  },
  profileImage: {
    type: String,
    default: "" // agar image na ho to empty string
  },
  userType: {
    type: String,
    enum: ["customer", "astrologer"],
    required: [true, "User type is required"]
  },
  // Astrologer specific fields
  prices: {
    "1min": { type: Number, min: 0, default: 0 },
    "10min": { type: Number, min: 0, default: 0 },
    "30min": { type: Number, min: 0, default: 0 }
  },
  experience: {
    type: Number,
    min: 0,
    default: 0 // sirf astrologers ke liye
  },
  fcmToken: { type: String, default: null } // ← YE ADD KARO
}, { timestamps: true });


module.exports = mongoose.model("User", userSchema);

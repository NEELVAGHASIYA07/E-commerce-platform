import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import { JWT_SECRET } from "../config/jwt.js";
import User from "../models/user.js";
import Order from "../models/Order.js";
import Contact from "../models/contact.js";
import Product from "../models/product.js";

const router = express.Router();

// Multer config for profile image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, 'profile-' + req.user.id + '-' + Date.now() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    if (allowed.test(file.mimetype) && allowed.test(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

const normalizeUsername = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "")
    .replace(/^[._-]+|[._-]+$/g, "");

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sanitizeText = (value, maxLength) => String(value || "")
  .replace(/[\u0000-\u001F\u007F]/g, "")
  .trim()
  .slice(0, maxLength);
const sanitizeAlphaText = (value, maxLength) => sanitizeText(value, maxLength).replace(/[^a-zA-Z\s.'-]/g, "");
const sanitizeDigits = (value, maxLength) => String(value || "").replace(/\D/g, "").slice(0, maxLength);
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || "").trim());
const isValidCountryCode = (value) => /^\+\d{1,4}$/.test(String(value || "").trim());
const isValidMobileNumber = (value) => /^\d{7,15}$/.test(String(value || "").trim());
const isValidPincode = (value) => /^\d{4,10}$/.test(String(value || "").trim());
const isStrongPassword = (value) => {
  const password = String(value || "");
  return password.length >= 8 && password.length <= 72;
};
const ALLOWED_GENDERS = new Set(["", "Male", "Female", "Other", "Prefer not to say"]);
const ALLOWED_OTP_PREFERENCES = new Set(["email", "sms"]);

const pendingSignupOtps = new Map();
const toPositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const SIGNUP_OTP_TTL_MS = toPositiveNumber(process.env.SIGNUP_OTP_TTL_MS, 5 * 60 * 1000);
const SIGNUP_OTP_MAX_ATTEMPTS = 5;
const OTP_SEND_WINDOW_MS = toPositiveNumber(process.env.OTP_SEND_WINDOW_MS, 10 * 60 * 1000);
const OTP_VERIFY_FAIL_WINDOW_MS = toPositiveNumber(process.env.OTP_VERIFY_FAIL_WINDOW_MS, 15 * 60 * 1000);
const OTP_VERIFY_LOCK_MS = toPositiveNumber(process.env.OTP_VERIFY_LOCK_MS, 30 * 60 * 1000);

const otpSendLimitByIp = new Map();
const otpSendLimitByEmail = new Map();
const otpSendLimitByPhone = new Map();
const otpResendLimitByIp = new Map();
const otpResendLimitByEmail = new Map();
const otpResendLimitByPhone = new Map();

const otpVerifyFailuresByIp = new Map();
const otpVerifyFailuresByEmail = new Map();
const otpVerifyFailuresByPhone = new Map();

const normalizeIp = (rawIp) => {
  const ip = String(rawIp || "").trim();
  if (!ip) return "unknown";
  return ip.startsWith("::ffff:") ? ip.replace("::ffff:", "") : ip;
};

const toE164Phone = (countryCode, mobileNumber) => {
  const code = String(countryCode || "+91").trim() || "+91";
  const digits = String(mobileNumber || "").replace(/\D/g, "");
  return `${code}${digits}`;
};

const consumeRateLimit = (bucketMap, key, limit, windowMs) => {
  const now = Date.now();
  const normalizedKey = String(key || "unknown").toLowerCase();
  const existing = bucketMap.get(normalizedKey);

  if (!existing || existing.resetAt <= now) {
    bucketMap.set(normalizedKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return { allowed: false, retryAfterMs: Math.max(existing.resetAt - now, 0) };
  }

  existing.count += 1;
  bucketMap.set(normalizedKey, existing);
  return { allowed: true, retryAfterMs: 0 };
};

const cleanupRateBucket = (bucketMap) => {
  const now = Date.now();
  for (const [key, value] of bucketMap.entries()) {
    if (!value || value.resetAt <= now) {
      bucketMap.delete(key);
    }
  }
};

const isLockedOut = (bucketMap, key) => {
  const now = Date.now();
  const normalizedKey = String(key || "unknown").toLowerCase();
  const record = bucketMap.get(normalizedKey);
  if (!record) return { locked: false, retryAfterMs: 0 };

  if (record.lockedUntil && record.lockedUntil > now) {
    return { locked: true, retryAfterMs: record.lockedUntil - now };
  }

  return { locked: false, retryAfterMs: 0 };
};

const registerFailedOtpAttempt = (bucketMap, key, maxFailures, windowMs, lockMs) => {
  const now = Date.now();
  const normalizedKey = String(key || "unknown").toLowerCase();
  const existing = bucketMap.get(normalizedKey);

  let record = existing;
  if (!record || record.resetAt <= now) {
    record = {
      count: 0,
      resetAt: now + windowMs,
      lockedUntil: 0
    };
  }

  record.count += 1;
  if (record.count >= maxFailures) {
    record.lockedUntil = now + lockMs;
    record.count = 0;
    record.resetAt = now + windowMs;
  }

  bucketMap.set(normalizedKey, record);
  return record;
};

const clearFailedOtpAttempts = (bucketMap, key) => {
  const normalizedKey = String(key || "unknown").toLowerCase();
  bucketMap.delete(normalizedKey);
};

const setRateLimitHeaders = (res, retryAfterMs) => {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  res.set("Retry-After", String(retryAfterSeconds));
  return retryAfterSeconds;
};

const cleanupExpiredSignupOtps = () => {
  const now = Date.now();
  for (const [requestId, record] of pendingSignupOtps.entries()) {
    if (!record || record.expiresAt <= now) {
      pendingSignupOtps.delete(requestId);
    }
  }

  [
    otpSendLimitByIp,
    otpSendLimitByEmail,
    otpSendLimitByPhone,
    otpResendLimitByIp,
    otpResendLimitByEmail,
    otpResendLimitByPhone,
    otpVerifyFailuresByIp,
    otpVerifyFailuresByEmail,
    otpVerifyFailuresByPhone
  ].forEach(cleanupRateBucket);
};

const cleanupTimer = setInterval(cleanupExpiredSignupOtps, 60 * 1000);
if (typeof cleanupTimer.unref === "function") {
  cleanupTimer.unref();
}

const generateSignupOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const generateSignupRequestId = () => crypto.randomUUID();

const normalizeSignupOtpPreference = (value) => {
  const preference = String(value || "email").trim().toLowerCase();
  return preference === "sms" ? "sms" : "email";
};

const maskEmail = (email) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const [localPart = "", domainPart = ""] = normalizedEmail.split("@");
  if (!domainPart) return normalizedEmail;

  const visibleLocal = localPart.slice(0, 2) || "*";
  const domainParts = domainPart.split(".");
  const domainHead = domainParts[0] || "";
  const domainTail = domainParts.slice(1).join(".");
  const visibleDomain = domainHead ? `${domainHead.slice(0, 1)}***` : "***";

  return `${visibleLocal}***@${visibleDomain}${domainTail ? `.${domainTail}` : ""}`;
};

const maskPhone = (countryCode, mobileNumber) => {
  const digits = String(mobileNumber || "").replace(/\D/g, "");
  const visibleDigits = digits.slice(-4) || "0000";
  const prefix = String(countryCode || "+91").trim() || "+91";
  return `${prefix} ${"*".repeat(Math.max(digits.length - 4, 4))}${visibleDigits}`;
};

const buildSignupPayload = (body) => {
  const name = sanitizeAlphaText(body.name, 80);
  const email = sanitizeText(body.email, 120).toLowerCase();
  const password = String(body.password || "");
  const streetAddress = sanitizeText(body.streetAddress, 220);
  const district = sanitizeText(body.district, 80);
  const state = sanitizeText(body.state, 80);
  const country = sanitizeText(body.country, 80);
  const pincode = sanitizeDigits(body.pincode, 10);
  const mobileNumber = sanitizeDigits(body.mobileNumber, 15);
  const countryCode = sanitizeText(body.countryCode || "+91", 6) || "+91";
  const gender = sanitizeText(body.gender, 40);
  const otpDeliveryPreference = normalizeSignupOtpPreference(body.otpDeliveryPreference || "email");
  const addressFromFields = [streetAddress, district, state, country, pincode].filter(Boolean).join(", ");
  const address = sanitizeText(body.address || addressFromFields, 300);

  const missingFields = [];
  if (!name) missingFields.push("name");
  if (!email) missingFields.push("email");
  if (!password) missingFields.push("password");
  if (!mobileNumber) missingFields.push("mobileNumber");
  if (!streetAddress) missingFields.push("streetAddress");
  if (!country) missingFields.push("country");
  if (!state) missingFields.push("state");
  if (!district) missingFields.push("district");
  if (!pincode) missingFields.push("pincode");

  const invalidFields = [];
  if (name && name.length < 2) invalidFields.push("name");
  if (email && !isValidEmail(email)) invalidFields.push("email");
  if (password && !isStrongPassword(password)) invalidFields.push("password");
  if (countryCode && !isValidCountryCode(countryCode)) invalidFields.push("countryCode");
  if (mobileNumber && !isValidMobileNumber(mobileNumber)) invalidFields.push("mobileNumber");
  if (pincode && !isValidPincode(pincode)) invalidFields.push("pincode");
  if (!ALLOWED_GENDERS.has(gender)) invalidFields.push("gender");
  if (!ALLOWED_OTP_PREFERENCES.has(otpDeliveryPreference)) invalidFields.push("otpDeliveryPreference");

  return {
    name,
    email,
    password,
    streetAddress,
    district,
    state,
    country,
    pincode,
    mobileNumber,
    countryCode,
    gender,
    otpDeliveryPreference,
    address,
    missingFields,
    invalidFields
  };
};

const getSignupChannelAndDestination = (payload) => {
  const channel = payload.otpDeliveryPreference === "sms" ? "sms" : "email";
  const target = channel === "sms"
    ? toE164Phone(payload.countryCode, payload.mobileNumber)
    : payload.email;
  const maskedDestination = channel === "sms"
    ? maskPhone(payload.countryCode, payload.mobileNumber)
    : maskEmail(payload.email);

  return { channel, target, maskedDestination };
};

const sendSignupOtp = async ({ channel, target, otp, name, email }) => {
  const allowConsoleFallback = String(process.env.OTP_ALLOW_CONSOLE_FALLBACK || "").trim().toLowerCase() === "true";
  const smtpHost = String(process.env.SMTP_HOST || "").trim();
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = String(process.env.SMTP_USER || "").trim();
  const smtpPass = String(process.env.SMTP_PASS || "").trim();
  const smtpFrom = String(process.env.SMTP_FROM || smtpUser || "").trim();

  if (channel === "email" && smtpHost && smtpUser && smtpPass) {
    try {
      const nodemailer = await import("nodemailer");
      const nodemailerFactory = nodemailer.default || nodemailer;
      const transporter = nodemailerFactory.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass
        }
      });

      await transporter.sendMail({
        from: smtpFrom,
        to: email,
        subject: "ROMUYKS verification code",
        text: `Hello ${name || "User"}, your ROMUYKS verification code is ${otp}. It expires in 5 minutes.`,
        html: `<p>Hello ${name || "User"},</p><p>Your ROMUYKS verification code is <strong>${otp}</strong>.</p><p>This code expires in 5 minutes.</p>`
      });

      return { delivered: true, provider: "email" };
    } catch (error) {
      if (!allowConsoleFallback) {
        const deliveryError = new Error(`Email OTP delivery failed: ${error.message}`);
        deliveryError.statusCode = 503;
        throw deliveryError;
      }
      console.warn("OTP email delivery failed, falling back to console OTP.", error.message);
    }
  }

  const twilioAccountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const twilioAuthToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const twilioFromNumber = String(process.env.TWILIO_FROM_NUMBER || "").trim();

  if (channel === "sms" && twilioAccountSid && twilioAuthToken && twilioFromNumber) {
    try {
      const twilioModule = await import("twilio");
      const twilioFactory = twilioModule.default || twilioModule;
      const client = twilioFactory(twilioAccountSid, twilioAuthToken);

      await client.messages.create({
        body: `ROMUYKS verification code: ${otp}. It expires in 5 minutes.`,
        from: twilioFromNumber,
        to: target
      });

      return { delivered: true, provider: "sms" };
    } catch (error) {
      if (!allowConsoleFallback) {
        const deliveryError = new Error(`SMS OTP delivery failed: ${error.message}`);
        deliveryError.statusCode = 503;
        throw deliveryError;
      }
      console.warn("OTP SMS delivery failed, falling back to console OTP.", error.message);
    }
  }

  if (channel === "email") {
    if (!allowConsoleFallback) {
      const configError = new Error("Email OTP provider is not configured. Set SMTP credentials in backend environment.");
      configError.statusCode = 503;
      throw configError;
    }
  }

  if (channel === "sms") {
    if (!allowConsoleFallback) {
      const configError = new Error("SMS OTP provider is not configured. Set Twilio credentials in backend environment.");
      configError.statusCode = 503;
      throw configError;
    }
  }

  console.log(`[OTP SIGNUP][${channel}] ${otp} -> ${target}`);
  return { delivered: false, provider: "local" };
};

const createUserFromSignupPayload = async (payload) => {
  const existingUser = await User.findOne({ email: { $regex: `^${escapeRegex(payload.email)}$`, $options: "i" } });
  if (existingUser) {
    const error = new Error("User already exists");
    error.statusCode = 409;
    throw error;
  }

  const username = await generateUniqueUsername(undefined, payload.name, payload.email);
  const hashed = await bcrypt.hash(payload.password, 10);

  return User.create({
    name: payload.name,
    email: payload.email,
    username,
    password: hashed,
    address: payload.address,
    streetAddress: payload.streetAddress,
    country: payload.country,
    state: payload.state,
    district: payload.district,
    pincode: payload.pincode,
    mobileNumber: payload.mobileNumber,
    countryCode: payload.countryCode,
    gender: payload.gender,
    otpDeliveryPreference: payload.otpDeliveryPreference,
    accountType: "customer",
    isSellerRequested: false,
    personalPage: "9.dashboard.html"
  });
};

const generateUniqueUsername = async (preferredUsername, name, email) => {
  const fallbackSource = normalizeUsername(name) || normalizeUsername(String(email || "").split("@")[0]);
  const baseUsername = normalizeUsername(preferredUsername) || fallbackSource || `user${Date.now().toString().slice(-6)}`;

  let candidate = baseUsername;
  let suffix = 1;

  while (await User.findOne({ username: candidate })) {
    candidate = `${baseUsername}${suffix}`;
    suffix += 1;
  }

  return candidate;
};

/* =========================
   SIGNUP / REGISTER
========================= */
router.post("/signup", async (req, res) => {
  try {
    console.log("📩 Signup data received:", req.body);
    const payload = buildSignupPayload(req.body);
    const { name, email, password, streetAddress, district, state, country, pincode, mobileNumber, countryCode, gender, otpDeliveryPreference, address, missingFields, invalidFields } = payload;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }

    if (invalidFields.length) {
      return res.status(400).json({
        message: "Some signup fields are invalid",
        invalidFields
      });
    }

    if (missingFields.length) {
      return res.status(400).json({
        message: "Please complete all required signup details",
        missingFields
      });
    }

    const user = await createUserFromSignupPayload(payload);

    console.log("✅ User saved in DB:", user);

    // Generate token so user is automatically logged in after sign up
    const token = jwt.sign(
      { id: user._id, isAdmin: user.isAdmin },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({ 
      message: "Signup successful",
      token: token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        username: user.username,
        isAdmin: user.isAdmin,
        cart: user.cart
      }
    });
  } catch (err) {
    console.error("❌ Signup error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/signup/send-otp", async (req, res) => {
  try {
    const payload = buildSignupPayload(req.body);
    const ip = normalizeIp(req.ip || req.socket?.remoteAddress);
    const emailKey = String(payload.email || "").trim().toLowerCase();
    const phoneKey = toE164Phone(payload.countryCode, payload.mobileNumber);

    const ipRate = consumeRateLimit(otpSendLimitByIp, ip, 10, OTP_SEND_WINDOW_MS);
    if (!ipRate.allowed) {
      const retryAfterSeconds = setRateLimitHeaders(res, ipRate.retryAfterMs);
      return res.status(429).json({ message: "Too many OTP requests from your IP. Please try again later.", retryAfterSeconds });
    }

    const emailRate = consumeRateLimit(otpSendLimitByEmail, emailKey, 5, OTP_SEND_WINDOW_MS);
    if (!emailRate.allowed) {
      const retryAfterSeconds = setRateLimitHeaders(res, emailRate.retryAfterMs);
      return res.status(429).json({ message: "Too many OTP requests for this email. Please try again later.", retryAfterSeconds });
    }

    const phoneRate = consumeRateLimit(otpSendLimitByPhone, phoneKey, 5, OTP_SEND_WINDOW_MS);
    if (!phoneRate.allowed) {
      const retryAfterSeconds = setRateLimitHeaders(res, phoneRate.retryAfterMs);
      return res.status(429).json({ message: "Too many OTP requests for this mobile number. Please try again later.", retryAfterSeconds });
    }

    if (!payload.name || !payload.email || !payload.password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }

    if (payload.missingFields.length) {
      return res.status(400).json({
        message: "Please complete all required signup details",
        missingFields: payload.missingFields
      });
    }

    if (payload.invalidFields.length) {
      return res.status(400).json({
        message: "Some signup fields are invalid",
        invalidFields: payload.invalidFields
      });
    }

    const existingUser = await User.findOne({ email: { $regex: `^${escapeRegex(payload.email)}$`, $options: "i" } });
    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const requestId = generateSignupRequestId();
    const otp = generateSignupOtp();
    const expiresAt = Date.now() + SIGNUP_OTP_TTL_MS;
    const { channel, target, maskedDestination } = getSignupChannelAndDestination(payload);

    pendingSignupOtps.set(requestId, {
      payload,
      otp,
      channel,
      target,
      maskedDestination,
      expiresAt,
      attempts: 0
    });

    try {
      await sendSignupOtp({
        channel,
        target,
        otp,
        name: payload.name,
        email: payload.email
      });
    } catch (deliveryError) {
      pendingSignupOtps.delete(requestId);
      const statusCode = Number(deliveryError.statusCode || 500);
      return res.status(statusCode).json({ message: deliveryError.message || "Unable to send OTP" });
    }

    res.json({
      message: `OTP sent to your ${channel === "sms" ? "mobile number" : "email"}`,
      requestId,
      channel,
      destination: maskedDestination,
      maskedDestination,
      expiresInSeconds: Math.floor(SIGNUP_OTP_TTL_MS / 1000)
    });
  } catch (err) {
    console.error("❌ Signup OTP send error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/signup/resend-otp", async (req, res) => {
  try {
    const requestId = String(req.body.requestId || "").trim();
    const record = pendingSignupOtps.get(requestId);
    const ip = normalizeIp(req.ip || req.socket?.remoteAddress);

    if (!requestId || !record) {
      return res.status(404).json({ message: "OTP request not found or expired" });
    }

    const resendIpRate = consumeRateLimit(otpResendLimitByIp, ip, 8, OTP_SEND_WINDOW_MS);
    if (!resendIpRate.allowed) {
      const retryAfterSeconds = setRateLimitHeaders(res, resendIpRate.retryAfterMs);
      return res.status(429).json({ message: "Too many OTP resend requests from your IP. Please try again later.", retryAfterSeconds });
    }

    const resendEmailRate = consumeRateLimit(otpResendLimitByEmail, record.payload?.email, 4, OTP_SEND_WINDOW_MS);
    if (!resendEmailRate.allowed) {
      const retryAfterSeconds = setRateLimitHeaders(res, resendEmailRate.retryAfterMs);
      return res.status(429).json({ message: "Too many OTP resend requests for this email. Please try again later.", retryAfterSeconds });
    }

    const resendPhoneRate = consumeRateLimit(
      otpResendLimitByPhone,
      toE164Phone(record.payload?.countryCode, record.payload?.mobileNumber),
      4,
      OTP_SEND_WINDOW_MS
    );
    if (!resendPhoneRate.allowed) {
      const retryAfterSeconds = setRateLimitHeaders(res, resendPhoneRate.retryAfterMs);
      return res.status(429).json({ message: "Too many OTP resend requests for this mobile number. Please try again later.", retryAfterSeconds });
    }

    if (record.expiresAt <= Date.now()) {
      pendingSignupOtps.delete(requestId);
      return res.status(410).json({ message: "OTP expired. Please request a new code." });
    }

    record.otp = generateSignupOtp();
    record.expiresAt = Date.now() + SIGNUP_OTP_TTL_MS;
    record.attempts = 0;

    try {
      await sendSignupOtp({
        channel: record.channel,
        target: record.target,
        otp: record.otp,
        name: record.payload.name,
        email: record.payload.email
      });
    } catch (deliveryError) {
      const statusCode = Number(deliveryError.statusCode || 500);
      return res.status(statusCode).json({ message: deliveryError.message || "Unable to resend OTP" });
    }

    res.json({
      message: "OTP resent successfully",
      requestId,
      channel: record.channel,
      destination: record.maskedDestination,
      maskedDestination: record.maskedDestination,
      expiresInSeconds: Math.floor(SIGNUP_OTP_TTL_MS / 1000)
    });
  } catch (err) {
    console.error("❌ Signup OTP resend error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/signup/verify-otp", async (req, res) => {
  try {
    const requestId = String(req.body.requestId || "").trim();
    const otp = String(req.body.otp || "").trim();
    const record = pendingSignupOtps.get(requestId);
    const ip = normalizeIp(req.ip || req.socket?.remoteAddress);

    if (!requestId || !record) {
      return res.status(404).json({ message: "OTP request not found or expired" });
    }

    const emailKey = String(record.payload?.email || "").trim().toLowerCase();
    const phoneKey = toE164Phone(record.payload?.countryCode, record.payload?.mobileNumber);

    const ipLock = isLockedOut(otpVerifyFailuresByIp, ip);
    if (ipLock.locked) {
      const retryAfterSeconds = setRateLimitHeaders(res, ipLock.retryAfterMs);
      return res.status(429).json({ message: "Too many failed OTP attempts from your IP. Try again later.", retryAfterSeconds });
    }

    const emailLock = isLockedOut(otpVerifyFailuresByEmail, emailKey);
    if (emailLock.locked) {
      const retryAfterSeconds = setRateLimitHeaders(res, emailLock.retryAfterMs);
      return res.status(429).json({ message: "Too many failed OTP attempts for this email. Try again later.", retryAfterSeconds });
    }

    const phoneLock = isLockedOut(otpVerifyFailuresByPhone, phoneKey);
    if (phoneLock.locked) {
      const retryAfterSeconds = setRateLimitHeaders(res, phoneLock.retryAfterMs);
      return res.status(429).json({ message: "Too many failed OTP attempts for this mobile number. Try again later.", retryAfterSeconds });
    }

    if (record.expiresAt <= Date.now()) {
      pendingSignupOtps.delete(requestId);
      return res.status(410).json({ message: "OTP expired. Please request a new code." });
    }

    if (!otp || otp !== record.otp) {
      record.attempts += 1;
      registerFailedOtpAttempt(otpVerifyFailuresByIp, ip, 8, OTP_VERIFY_FAIL_WINDOW_MS, OTP_VERIFY_LOCK_MS);
      registerFailedOtpAttempt(otpVerifyFailuresByEmail, emailKey, 6, OTP_VERIFY_FAIL_WINDOW_MS, OTP_VERIFY_LOCK_MS);
      registerFailedOtpAttempt(otpVerifyFailuresByPhone, phoneKey, 6, OTP_VERIFY_FAIL_WINDOW_MS, OTP_VERIFY_LOCK_MS);

      if (record.attempts >= SIGNUP_OTP_MAX_ATTEMPTS) {
        pendingSignupOtps.delete(requestId);
        return res.status(429).json({ message: "Too many invalid attempts. Please request a new code." });
      }

      return res.status(400).json({ message: "Invalid OTP" });
    }

    pendingSignupOtps.delete(requestId);
  clearFailedOtpAttempts(otpVerifyFailuresByIp, ip);
  clearFailedOtpAttempts(otpVerifyFailuresByEmail, emailKey);
  clearFailedOtpAttempts(otpVerifyFailuresByPhone, phoneKey);

    const user = await createUserFromSignupPayload(record.payload);
    const token = jwt.sign(
      { id: user._id, isAdmin: user.isAdmin },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      message: "Signup successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        username: user.username,
        isAdmin: user.isAdmin,
        cart: user.cart
      }
    });
  } catch (err) {
    if (err.statusCode === 409) {
      return res.status(409).json({ message: err.message });
    }

    console.error("❌ Signup OTP verify error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


/* =========================
   LOGIN
========================= */
router.post("/login", async (req, res) => {
  try {
    const email = sanitizeText(req.body.email, 120).toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({ message: "Invalid password format" });
    }

    const user = await User.findOne({ email: { $regex: `^${escapeRegex(email)}$`, $options: "i" } });
    if (!user)
      return res.status(401).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok)
      return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: user._id, isAdmin: user.isAdmin },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        username: user.username,
        isAdmin: user.isAdmin,
        cart: user.cart
      },
      personalPage: user.personalPage
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   GET USER PROFILE
========================= */
export const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Access Denied" });
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ message: "Invalid Token" });
  }
};

router.get("/profile", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    
    // Fetch orders for this user
    const orders = await Order.find({ user: user._id }).sort({ createdAt: -1 });

    res.json({ user, orders });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   UPDATE USER PROFILE
========================= */
router.put("/profile", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const {
      name,
      email,
      address,
      mobileNumber,
      countryCode,
      streetAddress,
      country,
      state,
      district,
      pincode,
      gender,
      otpDeliveryPreference,
      oldPassword,
      newPassword
    } = req.body;

    const invalidFields = [];

    const normalizedName = name !== undefined ? sanitizeAlphaText(name, 80) : undefined;
    const normalizedEmail = email !== undefined ? sanitizeText(email, 120).toLowerCase() : undefined;
    const normalizedAddress = address !== undefined ? sanitizeText(address, 300) : undefined;
    const normalizedMobile = mobileNumber !== undefined ? sanitizeDigits(mobileNumber, 15) : undefined;
    const normalizedCountryCode = countryCode !== undefined ? sanitizeText(countryCode || "+91", 6) : undefined;
    const normalizedStreetAddress = streetAddress !== undefined ? sanitizeText(streetAddress, 220) : undefined;
    const normalizedCountry = country !== undefined ? sanitizeText(country, 80) : undefined;
    const normalizedState = state !== undefined ? sanitizeText(state, 80) : undefined;
    const normalizedDistrict = district !== undefined ? sanitizeText(district, 80) : undefined;
    const normalizedPincode = pincode !== undefined ? sanitizeDigits(pincode, 10) : undefined;
    const normalizedGender = gender !== undefined ? sanitizeText(gender, 40) : undefined;
    const normalizedOtpPreference = otpDeliveryPreference !== undefined ? normalizeSignupOtpPreference(otpDeliveryPreference) : undefined;
    const normalizedOldPassword = oldPassword !== undefined ? String(oldPassword || "") : undefined;
    const normalizedNewPassword = newPassword !== undefined ? String(newPassword || "") : undefined;

    if (normalizedName !== undefined && normalizedName && normalizedName.length < 2) invalidFields.push("name");
    if (normalizedEmail !== undefined && normalizedEmail && !isValidEmail(normalizedEmail)) invalidFields.push("email");
    if (normalizedCountryCode !== undefined && normalizedCountryCode && !isValidCountryCode(normalizedCountryCode)) invalidFields.push("countryCode");
    if (normalizedMobile !== undefined && normalizedMobile && !isValidMobileNumber(normalizedMobile)) invalidFields.push("mobileNumber");
    if (normalizedPincode !== undefined && normalizedPincode && !isValidPincode(normalizedPincode)) invalidFields.push("pincode");
    if (normalizedGender !== undefined && !ALLOWED_GENDERS.has(normalizedGender)) invalidFields.push("gender");
    if (normalizedOtpPreference !== undefined && !ALLOWED_OTP_PREFERENCES.has(normalizedOtpPreference)) invalidFields.push("otpDeliveryPreference");

    const isOldPasswordProvided = normalizedOldPassword !== undefined && normalizedOldPassword.length > 0;
    const isNewPasswordProvided = normalizedNewPassword !== undefined && normalizedNewPassword.length > 0;

    if (isOldPasswordProvided !== isNewPasswordProvided) {
      invalidFields.push("passwordChange");
    }

    if (isNewPasswordProvided && !isStrongPassword(normalizedNewPassword)) {
      invalidFields.push("newPassword");
    }

    if (invalidFields.length) {
      return res.status(400).json({
        message: "Some profile fields are invalid",
        invalidFields
      });
    }

    if (normalizedName) user.name = normalizedName;
    if (normalizedEmail) {
      if (normalizedEmail !== user.email) {
        const alreadyUsed = await User.findOne({
          email: { $regex: `^${escapeRegex(normalizedEmail)}$`, $options: "i" },
          _id: { $ne: user._id }
        });
        if (alreadyUsed) {
          return res.status(409).json({ message: "Email already in use" });
        }
      }
      user.email = normalizedEmail;
    }
    if (normalizedAddress !== undefined) user.address = normalizedAddress;
    if (normalizedMobile !== undefined) user.mobileNumber = normalizedMobile;
    if (normalizedCountryCode !== undefined) user.countryCode = normalizedCountryCode || "+91";
    if (normalizedStreetAddress !== undefined) user.streetAddress = normalizedStreetAddress;
    if (normalizedCountry !== undefined) user.country = normalizedCountry;
    if (normalizedState !== undefined) user.state = normalizedState;
    if (normalizedDistrict !== undefined) user.district = normalizedDistrict;
    if (normalizedPincode !== undefined) user.pincode = normalizedPincode;
    if (normalizedGender !== undefined) user.gender = normalizedGender;
    if (normalizedOtpPreference !== undefined) {
      user.otpDeliveryPreference = normalizedOtpPreference;
    }

    if (
      streetAddress !== undefined ||
      district !== undefined ||
      state !== undefined ||
      country !== undefined ||
      pincode !== undefined
    ) {
      user.address = [user.streetAddress, user.district, user.state, user.country, user.pincode]
        .filter(Boolean)
        .join(", ");
    }

    if (isOldPasswordProvided && isNewPasswordProvided) {
      const ok = await bcrypt.compare(normalizedOldPassword, user.password);
      if (!ok) return res.status(400).json({ message: "Current password is incorrect" });
      user.password = await bcrypt.hash(normalizedNewPassword, 10);
    }

    await user.save();
    const updated = await User.findById(req.user.id).select("-password");
    res.json({ message: "Profile updated", user: updated });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   UPLOAD PROFILE IMAGE
========================= */
router.post("/profile/image", verifyToken, upload.single('profileImage'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No image uploaded" });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.profileImage = '/uploads/' + req.file.filename;
    await user.save();
    res.json({ message: "Image uploaded", profileImage: user.profileImage });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   SYNC CART ITEMS
========================= */
router.post("/sync-cart", verifyToken, async (req, res) => {
  try {
    const { cart } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (cart !== undefined && !Array.isArray(cart)) {
      return res.status(400).json({ message: "Cart must be an array" });
    }

    const normalizedCart = (Array.isArray(cart) ? cart : [])
      .slice(0, 100)
      .map((item) => ({
        name: sanitizeText(item?.name, 120),
        price: Math.max(0, Number(item?.price) || 0),
        quantity: Math.max(1, Math.min(20, Math.floor(Number(item?.quantity) || 1))),
        image: sanitizeText(item?.image, 220)
      }))
      .filter((item) => item.name);

    user.cart = normalizedCart;
    await user.save();
    
    res.json({ message: "Cart synced successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   SEARCH HISTORY
========================= */
// Add to search history
router.post("/search-history", verifyToken, async (req, res) => {
  try {
    const query = sanitizeText(req.body?.query, 120);
    if (!query) return res.status(400).json({ message: "Query required" });
    
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Remove if exists to put it at the top
    user.searchHistory = user.searchHistory.filter(q => q !== query);
    user.searchHistory.unshift(query); // Add to beginning
    
    // limit to 10
    if (user.searchHistory.length > 10) {
      user.searchHistory.pop();
    }
    
    await user.save();
    res.json({ searchHistory: user.searchHistory });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Delete search history
router.delete("/search-history", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const query = sanitizeText(req.body?.query, 120); // if we want to delete a specific one
    
    if (query) {
      user.searchHistory = user.searchHistory.filter(q => q !== query);
    } else {
      user.searchHistory = []; // clear all
    }
    
    await user.save();
    res.json({ searchHistory: user.searchHistory });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   ADMIN: GET ALL USERS
========================= */
router.get("/admin/users", verifyToken, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: "Admin access required" });
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   ADMIN: GET DASHBOARD STATS
========================= */
router.get("/admin/stats", verifyToken, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: "Admin access required" });
  try {
    const totalUsers = await User.countDocuments();
    const totalOrders = await Order.countDocuments();
    const pendingOrders = await Order.countDocuments({ status: "Pending" });
    const confirmedOrders = await Order.countDocuments({ status: "Confirmed" });
    const rejectedOrders = await Order.countDocuments({ status: "Rejected" });
    const totalProducts = await Product.countDocuments();
    const totalMessages = await Contact.countDocuments();

    const revenueResult = await Order.aggregate([
      { $match: { status: "Confirmed" } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } }
    ]);
    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

    res.json({
      totalUsers, totalOrders, pendingOrders, confirmedOrders,
      rejectedOrders, totalProducts, totalMessages, totalRevenue
    });
  } catch (err) {
    console.error("❌ Stats error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   ADMIN: GET CONTACT MESSAGES
========================= */
router.get("/admin/messages", verifyToken, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: "Admin access required" });
  try {
    const messages = await Contact.find().sort({ createdAt: -1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   ADMIN: DELETE A USER
========================= */
router.delete("/admin/users/:id", verifyToken, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: "Admin access required" });
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ message: "Cannot delete yourself" });
    }
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;

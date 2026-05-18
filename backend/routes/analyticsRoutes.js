import express from "express";
import jwt from "jsonwebtoken";
import AnalyticsEvent from "../models/AnalyticsEvent.js";
import { JWT_SECRET } from "../config/jwt.js";

const router = express.Router();

const sanitizeText = (value, maxLength) => String(value || "")
  .replace(/[\u0000-\u001F\u007F]/g, "")
  .trim()
  .slice(0, maxLength);

const sanitizeMetadata = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const cleaned = {};
  Object.entries(value).forEach(([key, raw]) => {
    const safeKey = sanitizeText(key, 64);
    if (!safeKey) return;

    if (typeof raw === "string") {
      cleaned[safeKey] = sanitizeText(raw, 500);
      return;
    }

    if (typeof raw === "number" || typeof raw === "boolean") {
      cleaned[safeKey] = raw;
      return;
    }

    if (raw === null) {
      cleaned[safeKey] = null;
      return;
    }

    cleaned[safeKey] = sanitizeText(JSON.stringify(raw), 500);
  });

  return cleaned;
};

const parseUserIdFromToken = (authorizationHeader) => {
  const header = String(authorizationHeader || "").trim();
  if (!header.startsWith("Bearer ")) return null;

  const token = header.slice(7).trim();
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded?.id || decoded?._id || null;
  } catch {
    return null;
  }
};

router.post("/event", async (req, res) => {
  try {
    const eventName = sanitizeText(req.body?.eventName, 80).toLowerCase();
    const page = sanitizeText(req.body?.page, 160);
    const source = sanitizeText(req.body?.source, 30) || "web";
    const sessionId = sanitizeText(req.body?.sessionId, 80);
    const metadata = sanitizeMetadata(req.body?.metadata);

    if (!eventName || !/^[a-z0-9._-]{3,80}$/.test(eventName)) {
      return res.status(400).json({ message: "Invalid eventName" });
    }

    const userId = parseUserIdFromToken(req.headers.authorization);

    await AnalyticsEvent.create({
      eventName,
      page,
      source,
      sessionId,
      user: userId,
      metadata
    });

    res.status(201).json({ message: "Event tracked" });
  } catch (error) {
    res.status(500).json({ message: "Failed to track event" });
  }
});

export default router;

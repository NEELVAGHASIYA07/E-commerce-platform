import express from "express";
import Contact from "../models/contact.js";

const router = express.Router();

const sanitizeText = (value, maxLength) => String(value || "")
  .replace(/[\u0000-\u001F\u007F]/g, "")
  .trim()
  .slice(0, maxLength);

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || "").trim());

// POST: Save contact message
router.post("/", async (req, res) => {
  try {
    const name = sanitizeText(req.body?.name, 80);
    const email = sanitizeText(req.body?.email, 120).toLowerCase();
    const message = sanitizeText(req.body?.message, 2000);

    if (!name || name.length < 2) {
      return res.status(400).json({ error: "Name must be at least 2 characters" });
    }

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }

    if (!message || message.length < 10) {
      return res.status(400).json({ error: "Message must be at least 10 characters" });
    }

    const newContact = new Contact({
      name,
      email,
      message
    });

    await newContact.save();
    res.status(201).json({ message: "Contact saved successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to save contact" });
  }
});

export default router;

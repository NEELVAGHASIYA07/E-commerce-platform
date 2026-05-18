import express from "express";
import mongoose from "mongoose";
import Order from "../models/Order.js";
import Product from "../models/product.js";
import User from "../models/user.js";
import { buildProductPriceMap, resolveServerPrice } from "../utils/productPricing.js";

const router = express.Router();

import { verifyToken } from "./authRoutes.js";

const ALLOWED_PAYMENT_METHODS = new Set(["UPI", "COD", "NetBanking", "Card"]);

const sanitizeText = (value, maxLength) => String(value || "")
  .replace(/[\u0000-\u001F\u007F]/g, "")
  .trim()
  .slice(0, maxLength);

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || "").trim());

const sanitizeBillingAddress = (billingAddress, user) => {
  const userNameParts = String(user?.name || "").trim().split(/\s+/).filter(Boolean);
  const firstName = sanitizeText(billingAddress?.firstName || userNameParts[0] || "", 60);
  const lastName = sanitizeText(billingAddress?.lastName || userNameParts.slice(1).join(" ") || "", 60);
  const email = sanitizeText(billingAddress?.email || user?.email || "", 120).toLowerCase();
  const phone = sanitizeText(billingAddress?.phone || "", 24);
  const country = sanitizeText(billingAddress?.country || "", 80);
  const address = sanitizeText(billingAddress?.address || user?.address || "", 260);
  const city = sanitizeText(billingAddress?.city || "", 80);
  const state = sanitizeText(billingAddress?.state || "", 80);
  const zip = sanitizeText(billingAddress?.zip || "", 16);
  const shipSameAddress = typeof billingAddress?.shipSameAddress === "boolean" ? billingAddress.shipSameAddress : true;

  const errors = [];
  if (!firstName || firstName.length < 2) errors.push("billingAddress.firstName");
  if (!lastName || lastName.length < 1) errors.push("billingAddress.lastName");
  if (!email || !isValidEmail(email)) errors.push("billingAddress.email");
  if (!phone || !/^\+?[0-9\s-]{7,20}$/.test(phone)) errors.push("billingAddress.phone");
  if (!country || country.length < 2) errors.push("billingAddress.country");
  if (!address || address.length < 6) errors.push("billingAddress.address");
  if (!city || city.length < 2) errors.push("billingAddress.city");
  if (!state || state.length < 2) errors.push("billingAddress.state");
  if (!zip || !/^[A-Za-z0-9-]{4,12}$/.test(zip)) errors.push("billingAddress.zip");

  return {
    mergedBillingAddress: {
      firstName,
      lastName,
      email,
      phone,
      country,
      address,
      city,
      state,
      zip,
      shipSameAddress
    },
    errors
  };
};

// POST: Save order
router.post("/", verifyToken, async (req, res) => {
  try {
    const { items, paymentMethod, billingAddress } = req.body;

    const normalizedPaymentMethod = sanitizeText(paymentMethod, 20);
    if (!ALLOWED_PAYMENT_METHODS.has(normalizedPaymentMethod)) {
      return res.status(400).json({ error: "Invalid payment method" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Order must contain at least one item" });
    }

    if (items.length > 30) {
      return res.status(400).json({ error: "Order cannot contain more than 30 items" });
    }

    const normalizedNames = items
      .map((item) => String(item?.name || "").trim().toLowerCase())
      .filter(Boolean);

    if (normalizedNames.length !== items.length) {
      return res.status(400).json({ error: "Each order item must have a valid name" });
    }

    const dbProducts = await Product.find();
    const priceMap = buildProductPriceMap(dbProducts);

    const sanitizedItems = [];
    let computedTotal = 0;

    for (const item of items) {
      const name = sanitizeText(item?.name, 120);
      const quantity = Math.max(1, Math.min(20, Math.floor(Number(item?.quantity) || 1)));

      const serverPrice = resolveServerPrice(priceMap, name);
      if (serverPrice === null) {
        return res.status(400).json({ error: "One or more products are invalid" });
      }

      computedTotal += serverPrice * quantity;

      sanitizedItems.push({
        name,
        price: serverPrice,
        quantity,
        image: sanitizeText(item?.image, 220)
      });
    }

    const user = await User.findById(req.user.id).select("name email address");

    const { mergedBillingAddress, errors } = sanitizeBillingAddress(billingAddress, user);
    if (errors.length) {
      return res.status(400).json({
        error: "Invalid billing address details",
        invalidFields: errors
      });
    }

    const newOrder = new Order({
      user: req.user.id,
      items: sanitizedItems,
      totalAmount: computedTotal,
      paymentMethod: normalizedPaymentMethod,
      billingAddress: mergedBillingAddress
    });

    await newOrder.save();
    
    // Optionally: clear the user's cart in DB since they ordered
    await User.findByIdAndUpdate(req.user.id, { cart: [] });

    res.status(201).json({ message: "Order saved successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to save order" });
  }
});

// GET: Fetch orders for logged-in user
router.get("/", verifyToken, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// PUT: Confirm order (admin only)
router.put("/:id/confirm", verifyToken, async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid order ID" });
  }

  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status: "Confirmed" },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json({ message: "Order confirmed", order });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// PUT: Reject order (admin only)
router.put("/:id/reject", verifyToken, async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid order ID" });
  }

  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status: "Rejected" },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json({ message: "Order rejected", order });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET: Fetch all orders (admin only)
router.get("/admin/all", verifyToken, async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).populate("user", "name email");
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// ✅ EXPORT MUST BE LAST
export default router;

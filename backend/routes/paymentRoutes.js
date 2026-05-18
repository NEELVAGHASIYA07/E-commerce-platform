import crypto from "crypto";
import express from "express";
import Order from "../models/Order.js";
import Product from "../models/product.js";
import User from "../models/user.js";
import { verifyToken } from "./authRoutes.js";
import { buildProductPriceMap, resolveServerPrice } from "../utils/productPricing.js";

const router = express.Router();
const DEFAULT_UPI_ID = process.env.UPI_ID || "neelvaghasiya6265-1@oksbi";
const WEBHOOK_SECRET = process.env.UPI_WEBHOOK_SECRET || "";

const sanitizeText = (value, maxLength) => String(value || "")
  .replace(/[\u0000-\u001F\u007F]/g, "")
  .trim()
  .slice(0, maxLength);

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || "").trim());

function buildUpiPayload({ upiId, amount, reference }) {
  const safeAmount = Number(amount || 0).toFixed(2);
  return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent("Roumyks")}&am=${encodeURIComponent(safeAmount)}&cu=INR&tn=${encodeURIComponent("Roumyks Order")}&tr=${encodeURIComponent(reference)}`;
}

async function computeItemsAndTotal(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Order must contain at least one item");
  }

  if (items.length > 30) {
    throw new Error("Order cannot contain more than 30 items");
  }

  const normalizedNames = items
    .map((item) => String(item?.name || "").trim().toLowerCase())
    .filter(Boolean);

  if (normalizedNames.length !== items.length) {
    throw new Error("Each order item must have a valid name");
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
      throw new Error("One or more products are invalid");
    }

    computedTotal += serverPrice * quantity;

    sanitizedItems.push({
      name,
      price: serverPrice,
      quantity,
      image: sanitizeText(item?.image, 220)
    });
  }

  return { sanitizedItems, computedTotal };
}

router.post("/upi/initiate", verifyToken, async (req, res) => {
  try {
    const { items, billingAddress } = req.body;
    const { sanitizedItems, computedTotal } = await computeItemsAndTotal(items);

    const user = await User.findById(req.user.id).select("name email address");

    const userNameParts = String(user?.name || "").trim().split(/\s+/).filter(Boolean);
    const mergedBillingAddress = {
      firstName: sanitizeText(billingAddress?.firstName || userNameParts[0] || "", 60),
      lastName: sanitizeText(billingAddress?.lastName || userNameParts.slice(1).join(" ") || "", 60),
      email: sanitizeText(billingAddress?.email || user?.email || "", 120).toLowerCase(),
      phone: sanitizeText(billingAddress?.phone || "", 24),
      country: sanitizeText(billingAddress?.country || "", 80),
      address: sanitizeText(billingAddress?.address || user?.address || "", 260),
      city: sanitizeText(billingAddress?.city || "", 80),
      state: sanitizeText(billingAddress?.state || "", 80),
      zip: sanitizeText(billingAddress?.zip || "", 16),
      shipSameAddress: typeof billingAddress?.shipSameAddress === "boolean" ? billingAddress.shipSameAddress : true
    };

    const invalidBillingFields = [];
    if (!mergedBillingAddress.firstName || mergedBillingAddress.firstName.length < 2) invalidBillingFields.push("billingAddress.firstName");
    if (!mergedBillingAddress.lastName || mergedBillingAddress.lastName.length < 1) invalidBillingFields.push("billingAddress.lastName");
    if (!mergedBillingAddress.email || !isValidEmail(mergedBillingAddress.email)) invalidBillingFields.push("billingAddress.email");
    if (!mergedBillingAddress.phone || !/^\+?[0-9\s-]{7,20}$/.test(mergedBillingAddress.phone)) invalidBillingFields.push("billingAddress.phone");
    if (!mergedBillingAddress.country || mergedBillingAddress.country.length < 2) invalidBillingFields.push("billingAddress.country");
    if (!mergedBillingAddress.address || mergedBillingAddress.address.length < 6) invalidBillingFields.push("billingAddress.address");
    if (!mergedBillingAddress.city || mergedBillingAddress.city.length < 2) invalidBillingFields.push("billingAddress.city");
    if (!mergedBillingAddress.state || mergedBillingAddress.state.length < 2) invalidBillingFields.push("billingAddress.state");
    if (!mergedBillingAddress.zip || !/^[A-Za-z0-9-]{4,12}$/.test(mergedBillingAddress.zip)) invalidBillingFields.push("billingAddress.zip");

    if (invalidBillingFields.length) {
      return res.status(400).json({
        error: "Invalid billing address details",
        invalidFields: invalidBillingFields
      });
    }

    const paymentReference = `UPI-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    const newOrder = new Order({
      user: req.user.id,
      items: sanitizedItems,
      totalAmount: computedTotal,
      paymentMethod: "UPI",
      billingAddress: mergedBillingAddress,
      status: "Pending",
      paymentStatus: "pending",
      paymentReference
    });

    await newOrder.save();

    const upiPayload = buildUpiPayload({
      upiId: DEFAULT_UPI_ID,
      amount: computedTotal,
      reference: paymentReference
    });

    res.status(201).json({
      message: "UPI payment initiated",
      orderId: newOrder._id,
      paymentReference,
      amount: computedTotal,
      upiId: DEFAULT_UPI_ID,
      upiPayload
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to initiate UPI payment" });
  }
});

router.get("/orders/:orderId/status", verifyToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId).select("user status paymentStatus paymentReference paymentTransactionId paymentVerifiedAt");
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (String(order.user) !== String(req.user.id) && !req.user.isAdmin) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json({
      orderId: order._id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentReference: order.paymentReference,
      paymentTransactionId: order.paymentTransactionId,
      paymentVerifiedAt: order.paymentVerifiedAt || null
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch payment status" });
  }
});

router.post("/webhook/upi", async (req, res) => {
  try {
    const rawBody = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body || {});
    const signature = req.get("x-upi-signature") || req.get("x-webhook-signature") || "";

    if (!WEBHOOK_SECRET) {
      return res.status(500).json({ message: "Webhook secret not configured" });
    }

    const expectedSignature = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    if (signature !== expectedSignature) {
      return res.status(401).json({ message: "Invalid webhook signature" });
    }

    const event = req.body || {};
    const paymentReference = String(event.paymentReference || event.reference || "").trim();
    const transactionId = String(event.transactionId || event.utr || event.txnId || "").trim();
    const status = String(event.status || "").toLowerCase();
    const eventId = String(event.eventId || event.webhookId || "").trim();
    const eventKey = eventId || `${paymentReference}:${status}:${transactionId || "na"}`;

    if (!paymentReference) {
      return res.status(400).json({ message: "paymentReference is required" });
    }

    const order = await Order.findOne({ paymentReference }).select("_id user paymentStatus status paymentTransactionId webhookEventKeys");
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (status === "success" || status === "paid" || status === "captured") {
      const updatedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          webhookEventKeys: { $ne: eventKey }
        },
        {
          $set: {
            paymentStatus: "paid",
            status: "Confirmed",
            paymentTransactionId: transactionId || order.paymentTransactionId,
            paymentVerifiedAt: new Date()
          },
          $addToSet: { webhookEventKeys: eventKey }
        },
        { new: true }
      );

      if (!updatedOrder) {
        return res.json({ message: "Duplicate webhook ignored", orderId: order._id });
      }

      await User.findByIdAndUpdate(order.user, { cart: [] });
      return res.json({ message: "Payment verified", orderId: order._id });
    }

    if (status === "failed" || status === "failure") {
      if (order.paymentStatus === "paid") {
        return res.json({ message: "Ignoring failed event for already paid order", orderId: order._id });
      }

      const updatedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          webhookEventKeys: { $ne: eventKey },
          paymentStatus: { $ne: "paid" }
        },
        {
          $set: {
            paymentStatus: "failed",
            status: "Rejected",
            paymentTransactionId: transactionId || order.paymentTransactionId
          },
          $addToSet: { webhookEventKeys: eventKey }
        },
        { new: true }
      );

      if (!updatedOrder) {
        return res.json({ message: "Duplicate webhook ignored", orderId: order._id });
      }

      return res.json({ message: "Payment marked as failed", orderId: order._id });
    }

    res.json({ message: "Webhook received" });
  } catch (error) {
    res.status(500).json({ message: "Webhook processing failed" });
  }
});

export default router;

import express from "express";
import Product from "../models/product.js";
import User from "../models/user.js";
import Order from "../models/Order.js";
import { protect, adminOnly } from "../middleware/authMiddleware.js";
import { searchProducts } from "../ai/search.js";

const router = express.Router();

function escapeRegex(input) {
  return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


/* ✅ SEARCH ROUTE (POST for frontend) */
router.post("/search-products", async (req, res) => {

  try {

    const { query } = req.body;

    if (!query)
      return res.json([]);

    const products = await Product.find();

    const results = searchProducts(products, query);

    return res.json(results);

  }
  catch (err) {

    console.error("SEARCH ERROR:", err);

    res.status(500).json({ message: "Search error" });

  }

});


/* ✅ ADD THIS HERE (GET version for browser testing) */
router.get("/search-products/:query", async (req, res) => {

  try {

    const query = req.params.query;

    const products = await Product.find();

    const results = searchProducts(products, query);

    res.json(results);

  }
  catch (err) {

    console.error("SEARCH ERROR:", err);

    res.status(500).json({ message: "Search error" });

  }

});


/* ✅ GET ALL PRODUCTS */
router.get("/", async (req, res) => {

  const products = await Product.find();

  res.json(products);

});

/* ✅ GET LATEST 3 TEXT REVIEWS FOR A PRODUCT */
router.get("/reviews/:productName", async (req, res) => {
  try {
    const requestedName = decodeURIComponent(String(req.params.productName || "")).trim();
    if (!requestedName) {
      return res.status(400).json({ message: "productName is required" });
    }

    const product = await Product.findOne({
      name: { $regex: `^${escapeRegex(requestedName)}$`, $options: "i" }
    }).select("name averageRating ratingCount reviews");

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const latestTextReviews = [...product.reviews]
      .filter((review) => String(review.comment || "").trim().length > 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3);

    const reviewerIds = [...new Set(latestTextReviews.map((review) => String(review.user)))];
    const reviewers = reviewerIds.length > 0
      ? await User.find({ _id: { $in: reviewerIds } }).select("name username")
      : [];
    const reviewerMap = new Map(
      reviewers.map((user) => [String(user._id), user.name || user.username || "Anonymous User"])
    );

    const payload = latestTextReviews.map((review) => ({
      userName: reviewerMap.get(String(review.user)) || "Anonymous User",
      rating: Number(review.rating || 0),
      comment: String(review.comment || ""),
      createdAt: review.createdAt,
      verifiedPurchase: true
    }));

    res.json({
      productName: product.name,
      averageRating: Number(product.averageRating || 0),
      ratingCount: Number(product.ratingCount || 0),
      reviews: payload
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to load product reviews" });
  }
});

/* ✅ GET MY REVIEWS (for order page prefill) */
router.get("/my-reviews", protect, async (req, res) => {
  try {
    const products = await Product.find({ "reviews.user": req.user.id }).select("name reviews");

    const reviews = [];
    for (const product of products) {
      for (const review of product.reviews) {
        if (String(review.user) === String(req.user.id)) {
          reviews.push({
            productName: product.name,
            orderId: review.order,
            rating: review.rating,
            comment: review.comment || "",
            createdAt: review.createdAt
          });
        }
      }
    }

    res.json(reviews);
  } catch (error) {
    res.status(500).json({ message: "Failed to load reviews" });
  }
});

/* ✅ SUBMIT/UPDATE REVIEW WITH 5 STAR RATING */
router.post("/review", protect, async (req, res) => {
  try {
    const { productName, orderId, rating, comment } = req.body;

    const safeProductName = String(productName || "").trim();
    const safeOrderId = String(orderId || "").trim();
    const ratingValue = Number(rating);

    if (!safeProductName || !safeOrderId) {
      return res.status(400).json({ message: "productName and orderId are required" });
    }

    if (!Number.isInteger(ratingValue) || ratingValue < 1 || ratingValue > 5) {
      return res.status(400).json({ message: "rating must be an integer between 1 and 5" });
    }

    const product = await Product.findOne({
      name: { $regex: `^${escapeRegex(safeProductName)}$`, $options: "i" }
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const order = await Order.findOne({
      _id: safeOrderId,
      user: req.user.id,
      "items.name": { $regex: `^${escapeRegex(product.name)}$`, $options: "i" }
    });

    if (!order) {
      return res.status(403).json({ message: "You can only review purchased products" });
    }

    const isPurchased = order.status === "Confirmed" || order.status === "Delivered" || order.paymentStatus === "paid";
    if (!isPurchased) {
      return res.status(403).json({ message: "Review is allowed after payment confirmation" });
    }

    const existingReviewIndex = product.reviews.findIndex(
      (review) => String(review.user) === String(req.user.id) && String(review.order) === String(order._id)
    );

    if (existingReviewIndex >= 0) {
      const existingCreatedAt = new Date(product.reviews[existingReviewIndex].createdAt || Date.now());
      const editWindowMs = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - existingCreatedAt.getTime() > editWindowMs) {
        return res.status(403).json({ message: "Review editing window is closed after 7 days" });
      }

      product.reviews[existingReviewIndex].rating = ratingValue;
      product.reviews[existingReviewIndex].comment = String(comment || "").trim();
    } else {
      product.reviews.push({
        user: req.user.id,
        order: order._id,
        rating: ratingValue,
        comment: String(comment || "").trim(),
        createdAt: new Date()
      });
    }

    const totalRatings = product.reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
    product.ratingCount = product.reviews.length;
    product.averageRating = product.ratingCount > 0 ? Number((totalRatings / product.ratingCount).toFixed(1)) : 0;

    await product.save();

    res.json({
      message: "Review saved",
      productName: product.name,
      averageRating: product.averageRating,
      ratingCount: product.ratingCount
    });
  } catch (error) {
    console.error("REVIEW ERROR:", error);
    res.status(500).json({ message: "Failed to save review" });
  }
});


/* ✅ GET SINGLE PRODUCT BY ID */
router.get("/:id", async (req, res) => {

  try {

    const id = req.params.id;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        message: "Invalid Product ID"
      });
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        message: "Product not found"
      });
    }

    res.json(product);

  }
  catch (error) {

    console.error("GET PRODUCT ERROR:", error);

    res.status(500).json({
      message: "Server error"
    });

  }

});


/* ADD PRODUCT */
router.post("/add", protect, adminOnly, async (req, res) => {

  await Product.create(req.body);

  res.json("Product added");

});

/* =========================
   GET USER PROFILE
========================= */
router.get("/profile", protect, async (req, res) => {

  try {

    const user = await User.findById(req.user.id).select("-password");

    if (!user)
      return res.status(404).json({ message: "User not found" });

    res.json(user);

  } catch {
    res.status(401).json({ message: "Invalid token" });
  }

});


/* =========================
   SAVE ADDRESS
========================= */
router.put("/address", protect, async (req, res) => {

  try {
    const { address } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { address },
      { new: true }
    );

    if (!user)
      return res.status(404).json({ message: "User not found" });

    res.json({
      message: "Address saved",
      address: user.address
    });

  } catch {

    res.status(401).json({ message: "Error saving address" });

  }

});


export default router;
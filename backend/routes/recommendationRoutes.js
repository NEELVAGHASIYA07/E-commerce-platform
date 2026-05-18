import express from "express";
import Product from "../models/product.js";
import Order from "../models/Order.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

/* ============================================================
   AI RECOMMENDATION ROUTES
   Provides server-side recommendations using co-purchase data
============================================================ */

/**
 * GET /api/recommendations/for-you
 * Personalized recommendations based on user's order history
 * Protected — requires login
 */
router.get("/for-you", protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const orders = await Order.find({ user: userId });
    const allProducts = await Product.find();

    if (!orders.length) {
      // No history — return random products
      const shuffled = allProducts.sort(() => Math.random() - 0.5).slice(0, 6);
      return res.json(shuffled);
    }

    // Gather purchased item names
    const purchasedNames = new Set();
    const purchasedCategories = {};
    const purchasedPrices = [];

    orders.forEach(order => {
      (order.items || []).forEach(item => {
        purchasedNames.add((item.name || '').toLowerCase());
        purchasedPrices.push(item.price || 0);
      });
    });

    // Match categories from product db
    allProducts.forEach(p => {
      if (purchasedNames.has((p.name || '').toLowerCase())) {
        const cat = p.category || 'general';
        purchasedCategories[cat] = (purchasedCategories[cat] || 0) + 1;
      }
    });

    const avgPrice = purchasedPrices.length > 0
      ? purchasedPrices.reduce((a, b) => a + b, 0) / purchasedPrices.length
      : 0;

    // Score all non-purchased products
    const scored = allProducts
      .filter(p => !purchasedNames.has((p.name || '').toLowerCase()))
      .map(p => {
        let score = 0;
        const cat = p.category || 'general';
        if (purchasedCategories[cat]) score += purchasedCategories[cat] * 10;
        if (avgPrice > 0) {
          const priceDiff = Math.abs(p.price - avgPrice);
          score += Math.max(0, 20 - (priceDiff / avgPrice) * 20);
        }
        return { product: p, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    res.json(scored.map(s => s.product));
  } catch (err) {
    console.error("Recommendation error:", err);
    res.status(500).json({ message: "Recommendation error" });
  }
});

/**
 * GET /api/recommendations/similar/:productId
 * Similar products based on category and price proximity
 */
router.get("/similar/:productId", async (req, res) => {
  try {
    const productId = req.params.productId;

    // Allow lookup by name (query param) or MongoDB ID
    let current;
    if (productId.match(/^[0-9a-fA-F]{24}$/)) {
      current = await Product.findById(productId);
    } else {
      current = await Product.findOne({
        name: { $regex: new RegExp("^" + productId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "$", "i") }
      });
    }

    if (!current) {
      return res.status(404).json({ message: "Product not found" });
    }

    const allProducts = await Product.find({ _id: { $ne: current._id } });

    const scored = allProducts.map(p => {
      let score = 0;
      // Same category
      if (p.category && current.category && p.category === current.category) score += 30;
      // Price similarity
      if (current.price > 0) {
        const diff = Math.abs(p.price - current.price);
        score += Math.max(0, 20 - (diff / current.price) * 20);
      }
      return { product: p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

    res.json(scored.map(s => s.product));
  } catch (err) {
    console.error("Similar products error:", err);
    res.status(500).json({ message: "Similar products error" });
  }
});

/**
 * POST /api/recommendations/also-bought
 * Products frequently bought alongside the given items
 * Body: { items: [{ name, price }] }
 */
router.post("/also-bought", async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !items.length) return res.json([]);

    const itemNames = items.map(i => (i.name || '').toLowerCase());

    // Find orders containing any of these items
    const orders = await Order.find();
    const coBoughtCounts = {};

    orders.forEach(order => {
      const orderItemNames = (order.items || []).map(i => (i.name || '').toLowerCase());
      const hasMatch = itemNames.some(n => orderItemNames.includes(n));

      if (hasMatch) {
        orderItemNames.forEach(name => {
          if (!itemNames.includes(name)) {
            coBoughtCounts[name] = (coBoughtCounts[name] || 0) + 1;
          }
        });
      }
    });

    // Sort by co-occurrence frequency
    const sorted = Object.entries(coBoughtCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name]) => name);

    // Fetch full product data for top co-bought items
    const allProducts = await Product.find();
    const results = sorted
      .map(name => allProducts.find(p => (p.name || '').toLowerCase() === name))
      .filter(Boolean);

    // If not enough co-bought data, fill with random products
    if (results.length < 4) {
      const existingNames = new Set([...results.map(p => p.name.toLowerCase()), ...itemNames]);
      const filler = allProducts
        .filter(p => !existingNames.has(p.name.toLowerCase()))
        .sort(() => Math.random() - 0.5)
        .slice(0, 4 - results.length);
      results.push(...filler);
    }

    res.json(results);
  } catch (err) {
    console.error("Also bought error:", err);
    res.status(500).json({ message: "Also bought error" });
  }
});

/**
 * GET /api/recommendations/trending
 * Returns top 3 best-selling products based on order history
 */
router.get("/trending", async (req, res) => {
  try {
    const orders = await Order.find();
    const allProducts = await Product.find();
    
    // Count product frequency in all orders
    const productCount = {};
    
    orders.forEach(order => {
      if (order.items && Array.isArray(order.items)) {
        order.items.forEach(item => {
          const productName = (item.name || '').toLowerCase();
          if (productName) {
            productCount[productName] = (productCount[productName] || 0) + 1;
          }
        });
      }
    });
    
    // Sort products by sales count (descending)
    const sortedNames = Object.entries(productCount)
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);
    
    // Get top 3 product details
    const topProducts = [];
    sortedNames.slice(0, 3).forEach(name => {
      const product = allProducts.find(p => (p.name || '').toLowerCase() === name);
      if (product) {
        topProducts.push(product);
      }
    });
    
    // If less than 3 from orders, fill with random products
    if (topProducts.length < 3) {
      const remaining = allProducts.filter(p => 
        !topProducts.find(tp => tp._id.toString() === p._id.toString())
      );
      while (topProducts.length < 3 && remaining.length > 0) {
        const idx = Math.floor(Math.random() * remaining.length);
        topProducts.push(remaining[idx]);
        remaining.splice(idx, 1);
      }
    }
    
    res.json(topProducts.slice(0, 3));
  } catch (err) {
    console.error("Trending error:", err);
    res.status(500).json({ message: "Trending error" });
  }
});

export default router;

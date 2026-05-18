import express from "express";
import cors from "cors";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import contactRoutes from "./routes/contactRoutes.js";
import recommendationRoutes from "./routes/recommendationRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";

const app = express();

/* =========================
   MIDDLEWARE
========================= */
app.use(cors());
app.use(express.json({
   verify: (req, res, buf) => {
      req.rawBody = buf;
   }
}));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/* =========================
   DATABASE
========================= */
if (process.env.NODE_ENV !== "test") {
   connectDB();
}

/* =========================
   ROUTES
========================= */
app.use("/api/auth", authRoutes);   
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/recommendations", recommendationRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/analytics", analyticsRoutes);

/* =========================
   TEST
========================= */
app.get("/", (req, res) => {
  res.send("🚀 Roumyks Backend Running");
});

/* =========================
   START SERVER
========================= */
if (process.env.NODE_ENV !== "test") {
  const PORT = Number(process.env.PORT || 5000);

  const server = app.listen(PORT, () => {
     console.log(`✅ Server running at http://localhost:${PORT}`);
  });

  server.on("error", (error) => {
     if (error && error.code === "EADDRINUSE") {
        console.error(`❌ Port ${PORT} is already in use. Stop the existing server process and try again.`);
        process.exit(1);
     }

     console.error("❌ Server startup error:", error);
     process.exit(1);
  });
}

export default app;

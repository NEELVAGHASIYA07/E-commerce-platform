import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/jwt.js";

export const protect = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json("No token");

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json("Invalid token");
  }
};

export const adminOnly = (req, res, next) => {
  if (!req.user.isAdmin) return res.status(403).json("Admin only");
  next();
};

import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../server.js";
import { JWT_SECRET } from "../config/jwt.js";

const makeToken = () => jwt.sign(
  { id: "507f1f77bcf86cd799439011", isAdmin: false },
  JWT_SECRET,
  { expiresIn: "1h" }
);

test("GET / health endpoint responds", async () => {
  const response = await request(app).get("/");
  assert.equal(response.status, 200);
  assert.match(response.text, /Backend Running/i);
});

test("POST /api/contact rejects too-short message", async () => {
  const response = await request(app)
    .post("/api/contact")
    .send({
      name: "Te",
      email: "test@example.com",
      message: "short"
    });

  assert.equal(response.status, 400);
  assert.match(String(response.body.error || ""), /message/i);
});

test("POST /api/auth/login rejects invalid email format", async () => {
  const response = await request(app)
    .post("/api/auth/login")
    .send({
      email: "invalid-email",
      password: "Password123"
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.message, "Invalid email format");
});

test("POST /api/auth/signup/send-otp validates missing fields", async () => {
  const response = await request(app)
    .post("/api/auth/signup/send-otp")
    .send({
      name: "Tester User",
      email: "tester@example.com",
      password: "Password123"
    });

  assert.equal(response.status, 400);
  assert.match(String(response.body.message || ""), /required signup details/i);
  assert.ok(Array.isArray(response.body.missingFields));
  assert.ok(response.body.missingFields.includes("streetAddress"));
});

test("POST /api/orders rejects invalid payment method", async () => {
  const token = makeToken();

  const response = await request(app)
    .post("/api/orders")
    .set("Authorization", `Bearer ${token}`)
    .send({
      paymentMethod: "Crypto",
      items: [
        { name: "Sample Item", quantity: 1 }
      ],
      billingAddress: {
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        phone: "+919999999999",
        country: "India",
        address: "Street 1",
        city: "Surat",
        state: "Gujarat",
        zip: "395006"
      }
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, "Invalid payment method");
});

test("POST /api/payments/upi/initiate rejects empty items", async () => {
  const token = makeToken();

  const response = await request(app)
    .post("/api/payments/upi/initiate")
    .set("Authorization", `Bearer ${token}`)
    .send({
      items: [],
      billingAddress: {
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        phone: "+919999999999",
        country: "India",
        address: "Street 1",
        city: "Surat",
        state: "Gujarat",
        zip: "395006"
      }
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, "Order must contain at least one item");
});

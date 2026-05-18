import mongoose from "mongoose";

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  items: Array,
  totalAmount: Number,
  paymentMethod: String,
  billingAddress: {
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    country: { type: String, default: "" },
    address: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    zip: { type: String, default: "" },
    shipSameAddress: { type: Boolean, default: true }
  },
  status: {
    type: String,
    default: "Pending"
  },
  paymentStatus: {
    type: String,
    enum: ["pending", "paid", "failed"],
    default: "pending"
  },
  paymentReference: {
    type: String,
    index: true
  },
  paymentTransactionId: {
    type: String,
    default: ""
  },
  paymentVerifiedAt: {
    type: Date
  },
  webhookEventKeys: {
    type: [String],
    default: []
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.models.Order ||
  mongoose.model("Order", orderSchema);
import mongoose from "mongoose";

const analyticsEventSchema = new mongoose.Schema({
  eventName: { type: String, required: true, index: true },
  page: { type: String, default: "" },
  source: { type: String, default: "web" },
  sessionId: { type: String, default: "" },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
    index: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: { type: Date, default: Date.now, index: true }
});

export default mongoose.models.AnalyticsEvent || mongoose.model("AnalyticsEvent", analyticsEventSchema);

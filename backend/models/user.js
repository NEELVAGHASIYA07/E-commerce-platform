import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  username: { type: String, unique: true },
  password: { type: String, required: true },
  address: { type: String, default: ""},
  mobileNumber: { type: String, default: "" },
  countryCode: { type: String, default: "+91" },
  streetAddress: { type: String, default: "" },
  country: { type: String, default: "India" },
  state: { type: String, default: "" },
  district: { type: String, default: "" },
  pincode: { type: String, default: "" },
  gender: { type: String, default: "" },
  otpDeliveryPreference: { type: String, default: "email" },
  accountType: { type: String, default: "customer" },
  isSellerRequested: { type: Boolean, default: false },
  profileImage: { type: String, default: "" },
  cart: { type: Array, default: [] },
  searchHistory: { type: Array, default: [] },
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  personalPage: { type: String, default: "1.index.html" } 
});

export default mongoose.model("User", UserSchema);

// Usage: node make-admin.js <email>
// Example: node make-admin.js admin@roumyks.com

import mongoose from "mongoose";
import User from "./models/user.js";

const email = process.argv[2];
if (!email) {
  console.log("Usage: node make-admin.js <email>");
  process.exit(1);
}

await mongoose.connect("mongodb://127.0.0.1:27017/roumyks");

const user = await User.findOneAndUpdate(
  { email },
  { isAdmin: true },
  { new: true }
);

if (user) {
  console.log(`✅ ${user.name} (${user.email}) is now an admin.`);
} else {
  console.log(`❌ No user found with email: ${email}`);
}

await mongoose.disconnect();

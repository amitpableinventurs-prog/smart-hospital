/**
 * Creates (or resets) the super admin account.
 *
 *   npm run create-super-admin
 *
 * Reads MONGODB_URI, SUPER_ADMIN_NAME, SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD
 * from .env.local. Re-running it resets the super admin's password.
 */
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

const { MONGODB_URI, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_NAME = "Super Admin" } = process.env;

if (!MONGODB_URI || !SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
  console.error("Set MONGODB_URI, SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in .env.local first.");
  process.exit(1);
}
if (SUPER_ADMIN_PASSWORD.length < 8 || !/[A-Za-z]/.test(SUPER_ADMIN_PASSWORD) || !/[0-9]/.test(SUPER_ADMIN_PASSWORD)) {
  console.error("SUPER_ADMIN_PASSWORD must be at least 8 characters and contain letters and numbers.");
  process.exit(1);
}

await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
const users = mongoose.connection.collection("users");
const email = SUPER_ADMIN_EMAIL.trim().toLowerCase();
const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);
const now = new Date();

await users.createIndex({ email: 1 }, { unique: true });
const existing = await users.findOne({ email });
if (existing && existing.role !== "super_admin") {
  console.error(`${email} already exists as a regular admin. Use a different SUPER_ADMIN_EMAIL.`);
  process.exit(1);
}

await users.updateOne(
  { email },
  {
    $set: { name: SUPER_ADMIN_NAME, role: "super_admin", active: true, passwordHash, failedLogins: 0, updatedAt: now },
    $unset: { lockUntil: "" },
    $inc: { tokenVersion: 1 },
    $setOnInsert: { email, modules: [], createdAt: now },
  },
  { upsert: true }
);

console.log(`${existing ? "Reset" : "Created"} super admin: ${email}`);
await mongoose.disconnect();

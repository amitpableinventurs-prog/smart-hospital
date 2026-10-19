/**
 * Creates (or resets) one demo admin per module, plus two combined accounts
 * for testing cross-module workflows.
 *
 *   npm run create-demo-admins
 *
 * Re-running resets these accounts' passwords and module allocation.
 * For testing only — deactivate or delete these accounts before going live.
 */
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

const { MONGODB_URI, DEMO_ADMIN_PASSWORD = "Medicare@123" } = process.env;
if (!MONGODB_URI) {
  console.error("Set MONGODB_URI in .env.local first.");
  process.exit(1);
}

const ACCOUNTS = [
  ["Patients Admin", "patients", ["patients"]],
  ["OPD/IPD Admin", "opd", ["opd_ipd"]],
  ["Doctors Admin", "doctors", ["doctors"]],
  ["Nursing Admin", "nursing", ["nursing"]],
  ["Laboratory Admin", "lab", ["laboratory"]],
  ["Inventory Admin", "inventory", ["inventory"]],
  ["Billing Admin", "billing", ["billing"]],
  ["HR Admin", "hr", ["hr"]],
  ["Insurance Admin", "insurance", ["insurance"]],
  ["Ambulance Admin", "ambulance", ["ambulance"]],
  ["Blood Bank Admin", "bloodbank", ["blood_bank"]],
  ["Pharmacy Admin", "pharmacy", ["pharmacy"]],
  ["Marketing Admin", "marketing", ["marketing"]],
  ["Reports Admin", "reports", ["reports"]],
  ["Front Desk (combined)", "frontdesk", ["patients", "opd_ipd", "doctors", "billing"]],
  ["Medical Store (combined)", "store", ["pharmacy", "inventory", "reports"]],
];

await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
const users = mongoose.connection.collection("users");
const logs = mongoose.connection.collection("activitylogs");
const passwordHash = await bcrypt.hash(DEMO_ADMIN_PASSWORD, 12);
const now = new Date();

for (const [name, local, modules] of ACCOUNTS) {
  const email = `${local}@medicare.local`;
  const existing = await users.findOne({ email });
  if (existing?.role === "super_admin") {
    console.log(`skip ${email} (super admin)`);
    continue;
  }
  await users.updateOne(
    { email },
    {
      $set: { name, role: "admin", modules, active: true, passwordHash, failedLogins: 0, updatedAt: now },
      $unset: { lockUntil: "" },
      $inc: { tokenVersion: 1 },
      $setOnInsert: { email, createdAt: now },
    },
    { upsert: true }
  );
  const user = await users.findOne({ email });
  await logs.insertOne({
    actorName: "Setup script", actorRole: "super_admin", action: existing ? "admin_update" : "admin_create", module: "system",
    resource: "admins", entityId: String(user._id), entityLabel: `${name} <${email}>`,
    summary: `${existing ? "Reset" : "Created"} demo admin ${name} with access to: ${modules.join(", ")}`, ip: "local", createdAt: now,
  });
  console.log(`${existing ? "reset  " : "created"} ${email.padEnd(30)} ${modules.join(", ")}`);
}

console.log(`\nPassword for all demo accounts: ${DEMO_ADMIN_PASSWORD}`);
await mongoose.disconnect();

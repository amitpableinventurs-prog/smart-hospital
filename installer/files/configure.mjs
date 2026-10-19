// Writes the server's settings on install (run by the setup with the bundled Node.js, as administrator):
//   node configure.mjs --control-url=https://control.example.com --port=3010 [--domain=his.example.com]
// Existing settings (secrets, database) are kept on upgrade; only the given options change.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  })
);
const dataDir = path.join(process.env.ProgramData ?? "C:\ProgramData", "SmartHospital");
for (const d of ["db", "logs"]) fs.mkdirSync(path.join(dataDir, d), { recursive: true });

const file = path.join(dataDir, "config.env");
const current = {};
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) current[m[1]] = m[2];
  }
}
const dbPort = args["db-port"] || "27027";
const config = {
  ...current,
  APP_MODE: "client",
  NODE_ENV: "production",
  PORT: args.port || current.PORT || "3010",
  HOSTNAME: "0.0.0.0",
  MONGODB_URI: current.MONGODB_URI || `mongodb://127.0.0.1:${dbPort}/smart_hospital`,
  AUTH_SECRET: current.AUTH_SECRET || randomBytes(48).toString("base64url"),
  CONTROL_URL: args["control-url"] || current.CONTROL_URL || "",
  DOMAIN: args.domain !== undefined ? args.domain.trim().toLowerCase() : current.DOMAIN || "",
};
fs.writeFileSync(
  file,
  ["# Smart Hospital server settings. Restart the PC (or the SmartHospital\Server task) after editing.", ...Object.entries(config).map(([k, v]) => `${k}=${v}`), ""].join("\r\n")
);

const slash = (p) => p.replaceAll("\\", "/");
fs.writeFileSync(
  path.join(dataDir, "mongod.cfg"),
  [
    "# Smart Hospital database (local only)",
    "storage:",
    `  dbPath: ${slash(path.join(dataDir, "db"))}`,
    "systemLog:",
    "  destination: file",
    `  path: ${slash(path.join(dataDir, "logs", "mongod.log"))}`,
    "  logAppend: true",
    "net:",
    "  bindIp: 127.0.0.1",
    `  port: ${new URL(config.MONGODB_URI).port || dbPort}`,
    "",
  ].join("\r\n")
);
console.log(`Settings written to ${file}`);

// Writes the server's settings on install (run by the setup with the bundled Node.js, as administrator):
//   node configure.mjs --control-url=https://control.example.com --port=3010 [--domain=his.example.com]
// Existing settings (secrets, database) are kept on upgrade; only the given options change.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  })
);
const dataDir = path.join(process.env.ProgramData ?? "C:\\ProgramData", "SmartHospital");
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
  // The database engine (bin/services.cmd), chosen once: a database stays on the engine that created it,
  // and one set up before there was a choice ran on mongodb\.
  DB_ENGINE: current.DB_ENGINE || (fs.existsSync(path.join(dataDir, "db", "WiredTiger")) || modernDbRuns() ? "mongodb" : "mongodb-legacy"),
};
fs.writeFileSync(
  file,
  ["# Smart Hospital server settings. Restart the PC (or the SmartHospital\\Server task) after editing.", ...Object.entries(config).map(([k, v]) => `${k}=${v}`), ""].join("\r\n")
);

const slash = (p) => p.replaceAll("\\", "/");
fs.writeFileSync(
  path.join(dataDir, "mongod.cfg"),
  [
    "# Smart Hospital database (local only)",
    "storage:",
    `  dbPath: ${slash(path.join(dataDir, "db"))}`,
    // A quarter of the memory (MongoDB's default is half), leaving room for the app on PCs with 4–8 GB.
    "  wiredTiger:",
    "    engineConfig:",
    `      cacheSizeGB: ${Math.max(0.25, Math.round(os.totalmem() / 2 ** 30) / 4)}`,
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
console.log(`Settings written to ${file} (database: ${config.DB_ENGINE})`);

/**
 * Whether this PC can run mongodb\ (MongoDB 5.0 and later need a CPU with AVX, which many Celeron and
 * Pentium PCs lack); otherwise the database runs on mongodb-legacy\ (4.4). Any doubt picks 4.4, which runs everywhere.
 */
function modernDbRuns() {
  if (!fs.existsSync(path.join(root, "mongodb-legacy", "mongod.exe"))) return true;
  const avxCheck = `Add-Type -Namespace SH -Name Cpu -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(uint f);'; [SH.Cpu]::IsProcessorFeaturePresent(39)`;
  const avx = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(avxCheck, "utf16le").toString("base64")], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  if (avx.stdout?.trim() !== "True") return false;
  return spawnSync(path.join(root, "mongodb", "mongod.exe"), ["--version"], { windowsHide: true, timeout: 60_000 }).status === 0;
}

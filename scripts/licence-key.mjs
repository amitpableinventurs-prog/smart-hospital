/**
 * Offline licence keys (see src/lib/offline-licence.ts for the format).
 *
 *   npm run licence-key -- init
 *       Creates the vendor's signing key pair, once: the private key goes to .env.local
 *       (LICENCE_SIGNING_KEY — also set it on your Control Panel server, and keep a backup),
 *       the public key to src/lib/licence-public-key.ts (built into every setup).
 *
 *   npm run licence-key -- --hospital="City Hospital" [--code=CH001] [--expires=2027-03-31|never]
 *                          [--modules=all|patients,pharmacy,...] [--users=10] [--plan=Basic] [--trial]
 *       Prints a key that activates any installation offline until it expires.
 */
import { createPrivateKey, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
const publicKeyFile = path.join(root, "src", "lib", "licence-public-key.ts");
const argv = process.argv.slice(2);
const args = Object.fromEntries(
  argv.filter((a) => a.startsWith("--")).map((a) => {
    const [k, ...v] = a.slice(2).split("=");
    return [k, v.length ? v.join("=") : true];
  })
);
const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (argv[0] === "init") {
  const existing = process.env.LICENCE_SIGNING_KEY || (fs.existsSync(envFile) && /^LICENCE_SIGNING_KEY=./m.test(fs.readFileSync(envFile, "utf8")));
  if (existing && !args.force) die("A signing key already exists in .env.local. Keys issued with it stop working if it is replaced; pass --force to replace it anyway.");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const priv = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const pub = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  let env = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
  env = env.replace(/^# Signs offline licence keys.*\r?\n/m, "").replace(/^LICENCE_SIGNING_KEY=.*\r?\n?/m, "");
  if (env && !env.endsWith("\n")) env += "\n";
  fs.writeFileSync(envFile, `${env}\n# Signs offline licence keys (npm run licence-key). Keep secret and backed up.\nLICENCE_SIGNING_KEY=${priv}\n`);
  fs.writeFileSync(
    publicKeyFile,
    `/** Verifies offline licence keys (lib/offline-licence.ts). Created by \`npm run licence-key -- init\`; the private half is LICENCE_SIGNING_KEY. */\nexport const LICENCE_PUBLIC_KEY = "${pub}";\n`
  );
  console.log(`Signing key saved to .env.local and public key to ${path.relative(root, publicKeyFile)}.`);
  console.log("Next: set LICENCE_SIGNING_KEY on your Control Panel server too, back it up, and rebuild the setup (npm run build:windows).");
  process.exit(0);
}

const secret = process.env.LICENCE_SIGNING_KEY || (fs.existsSync(envFile) && fs.readFileSync(envFile, "utf8").match(/^LICENCE_SIGNING_KEY=(.+)$/m)?.[1]?.trim());
if (!secret) die("No signing key. Run: npm run licence-key -- init");
const hospital = typeof args.hospital === "string" ? args.hospital.trim() : "";
if (!hospital) die('Usage: npm run licence-key -- --hospital="City Hospital" [--expires=2027-03-31|never] [--modules=all|a,b] [--users=10] [--plan=Basic] [--trial] [--code=CH001]');

// The module list lives in a TypeScript file; read the keys straight from it.
const allModules = [...fs.readFileSync(path.join(root, "src", "lib", "modules.ts"), "utf8").match(/export const MODULE_KEYS = \[([\s\S]*?)\]/)[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
const modules = !args.modules || args.modules === "all" ? allModules : String(args.modules).split(",").map((m) => m.trim()).filter(Boolean);
const unknown = modules.filter((m) => !allModules.includes(m));
if (unknown.length) die(`Unknown module(s): ${unknown.join(", ")}\nModules: ${allModules.join(", ")}`);

let expiresAt = null;
if (args.expires && args.expires !== "never") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.expires)) die("--expires must be YYYY-MM-DD or never");
  // Valid through the whole of that day in India.
  expiresAt = new Date(`${args.expires}T23:59:59.999+05:30`).toISOString();
} else if (!args.expires) {
  die("Pass --expires=YYYY-MM-DD (or --expires=never for a lifetime licence)");
}
const users = args.users === undefined ? 0 : Number(args.users);
if (!Number.isInteger(users) || users < 0) die("--users must be a whole number (0 = unlimited)");

const lic = {
  v: 1,
  id: randomUUID(),
  code: typeof args.code === "string" ? args.code.trim().toUpperCase() : `OFF-${randomBytes(3).toString("hex").toUpperCase()}`,
  hospital,
  modules,
  expiresAt,
  maxUsers: users,
  plan: typeof args.plan === "string" ? { code: args.plan.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: args.plan } : null,
  trial: !!args.trial,
  issuedAt: new Date().toISOString(),
};
const key = createPrivateKey({ key: Buffer.from(secret, "base64"), format: "der", type: "pkcs8" });
const json = Buffer.from(JSON.stringify(lic));
console.log(`\n${lic.hospital} (${lic.code}) · ${modules.length} module(s) · ${users || "unlimited"} login(s) · ${expiresAt ? `valid until ${args.expires}` : "no expiry"}\n`);
console.log(`SH1.${json.toString("base64url")}.${sign(null, json, key).toString("base64url")}\n`);

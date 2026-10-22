/**
 * Builds the Windows setup (SmartHospital-Setup-<version>.exe) for client installations.
 *
 *   npm run build:windows -- --control-url=https://control.yourcompany.com
 *
 * Options:
 *   --control-url=URL   your Control Panel (APP_MODE=control) — optional; pre-fills the licence server
 *                       field, which the setup asks for on every server install
 *   --mongo-bin=DIR     MongoDB server binaries to bundle (default: newest under C:\Program Files\MongoDB\Server)
 *   --skip-build        reuse the last standalone build in .next/standalone
 *
 * Output: dist/windows/stage (everything the setup installs) and, when Inno Setup 6 is installed,
 * dist/SmartHospital-Setup-<version>.exe. Optional: put caddy.exe in installer/vendor/ to enable
 * automatic HTTPS for clients with a custom domain.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  })
);
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const controlUrl = String(args["control-url"] ?? "").replace(/\/+$/, "");
if (!/^https?:\/\/[^\s"]+$/.test(controlUrl)) {
  console.error("Pass your Control Panel's address: --control-url=https://control.yourcompany.com");
  process.exit(1);
}

const step = (msg) => console.log(`\n▸ ${msg}`);
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, dereference: true });

// 1. Self-contained Next.js server
if (!args["skip-build"]) {
  step("Building the app (standalone)…");
  const r = spawnSync("npx", ["next", "build"], { cwd: root, stdio: "inherit", shell: true, env: { ...process.env, BUILD_STANDALONE: "1" } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const standalone = path.join(root, ".next", "standalone");
if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("No standalone build found. Run without --skip-build.");
  process.exit(1);
}

// 2. Stage everything the setup installs
const dist = path.join(root, "dist");
const stage = path.join(dist, "windows", "stage");
step(`Staging files in ${path.relative(root, stage)}…`);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
copy(standalone, path.join(stage, "app"));
copy(path.join(root, ".next", "static"), path.join(stage, "app", ".next", "static"));
if (fs.existsSync(path.join(root, "public"))) copy(path.join(root, "public"), path.join(stage, "app", "public"));
// Never ship this machine's settings or secrets: installations write their own config.env.
for (const f of fs.readdirSync(path.join(stage, "app"))) if (f.startsWith(".env")) fs.rmSync(path.join(stage, "app", f));

fs.mkdirSync(path.join(stage, "runtime"));
fs.copyFileSync(process.execPath, path.join(stage, "runtime", "node.exe"));

const mongoBin = args["mongo-bin"] ? String(args["mongo-bin"]) : newestMongoBin();
if (!mongoBin || !fs.existsSync(path.join(mongoBin, "mongod.exe"))) {
  console.error("MongoDB server not found. Install MongoDB Community Server or pass --mongo-bin=DIR (the folder with mongod.exe).");
  process.exit(1);
}
fs.mkdirSync(path.join(stage, "mongodb"));
for (const f of fs.readdirSync(mongoBin)) if (f === "mongod.exe" || f.toLowerCase().endsWith(".dll")) fs.copyFileSync(path.join(mongoBin, f), path.join(stage, "mongodb", f));

const caddy = path.join(root, "installer", "vendor", "caddy.exe");
if (fs.existsSync(caddy)) {
  fs.mkdirSync(path.join(stage, "caddy"));
  fs.copyFileSync(caddy, path.join(stage, "caddy", "caddy.exe"));
}

copy(path.join(root, "installer", "files"), path.join(stage, "bin"));
fs.copyFileSync(path.join(root, "src", "app", "favicon.ico"), path.join(stage, "bin", "app.ico"));
console.log(`  app ${pkg.version}, Node ${process.version}, MongoDB from ${mongoBin}${fs.existsSync(caddy) ? ", Caddy (HTTPS)" : ""}`);

// 3. Compile the setup
const iscc = ["C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe", "C:\\Program Files\\Inno Setup 6\\ISCC.exe", path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Inno Setup 6", "ISCC.exe")].find((p) => fs.existsSync(p));
if (!iscc) {
  console.log("\nInno Setup 6 is not installed, so the .exe was not compiled. Install it from https://jrsoftware.org/isdl.php and run again with --skip-build.");
  process.exit(0);
}
step("Compiling the setup…");
const r = spawnSync(iscc, [`/DAppVersion=${pkg.version}`, `/DControlUrl=${controlUrl}`, `/DStageDir=${stage}`, path.join(root, "installer", "SmartHospital.iss")], { stdio: "inherit" });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`\n✓ ${path.join(dist, `SmartHospital-Setup-${pkg.version}.exe`)}`);

function newestMongoBin() {
  const base = "C:\\Program Files\\MongoDB\\Server";
  if (!fs.existsSync(base)) return null;
  const versions = fs.readdirSync(base).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return versions.length ? path.join(base, versions[0], "bin") : null;
}

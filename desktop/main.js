/**
 * Smart Hospital desktop app (Electron), installed by SmartHospital-Setup.exe.
 *
 * First run asks what this PC is:
 *   Server      — keeps the hospital's data. Sets up the bundled database and web server as
 *                 Windows services (installer/files/setup-server.cmd, as administrator), which
 *                 start at boot and keep running without this window, so staff PCs can connect.
 *   Workstation — another staff PC: only opens the server's address.
 * After that it opens the app in its own window. Everything runs offline.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pkg = require("./package.json");
/** Bundled server files: next to the app when installed, the staged build in development. */
const SH = app.isPackaged ? path.join(process.resourcesPath, "sh") : path.join(__dirname, "..", "dist", "windows", "stage");
const DATA = path.join(process.env.ProgramData || "C:\\ProgramData", "SmartHospital");
const SETTINGS = () => path.join(app.getPath("userData"), "settings.json");
const DEFAULT_PORT = "3010";

let win = null;
let current = null; // { mode, url }

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

/* ---------------- settings ---------------- */

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS(), "utf8"));
  } catch {
    return {};
  }
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(SETTINGS()), { recursive: true });
  fs.writeFileSync(SETTINGS(), JSON.stringify(s, null, 2));
}

/** Settings of the server installed on this PC (written by configure.mjs), or null. */
function serverConfig() {
  try {
    const env = Object.fromEntries(
      fs.readFileSync(path.join(DATA, "config.env"), "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]])
    );
    return { port: env.PORT || DEFAULT_PORT, domain: env.DOMAIN || "", controlUrl: env.CONTROL_URL || "" };
  } catch {
    return null;
  }
}

/** What this PC opens: a workstation's chosen server, else the server installed here, else nothing yet. */
function target() {
  const s = readSettings();
  if (s.mode === "workstation" && s.url) return { mode: "workstation", url: s.url };
  const cfg = serverConfig();
  return cfg ? { mode: "server", url: `http://localhost:${cfg.port}` } : null;
}

/** "192.168.1.10", "server-pc:3010", "his.city.com" or a full URL → the URL to open. */
function serverUrl(address) {
  let a = String(address ?? "").trim().replace(/\/+$/, "");
  if (!a) return null;
  if (!/^https?:\/\//i.test(a)) {
    if (a.includes(":")) a = `http://${a}`;
    else if (/^[\d.]+$/.test(a) || !a.includes(".")) a = `http://${a}:${DEFAULT_PORT}`;
    else a = `https://${a}`;
  }
  try {
    const u = new URL(a);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/* ---------------- windows ---------------- */

function showPage(page, query = {}) {
  // Rejects when another page replaces it before it finishes loading; nothing to do then.
  return win?.loadFile(path.join(__dirname, "setup.html"), { query: { page, ...query } }).catch(() => {});
}

/** Resolves once the app answers at `url`, or rejects after `ms`. */
async function waitFor(url, ms) {
  const until = Date.now() + ms;
  let last = "";
  while (Date.now() < until) {
    try {
      const res = await fetch(`${url}/login`, { signal: AbortSignal.timeout(4000), redirect: "manual" });
      if (res.status < 500) return;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e.cause?.code || e.message;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(last);
}

async function open() {
  current = target();
  if (!current) return showPage("setup");
  await showPage("loading", { mode: current.mode, url: current.url });
  try {
    // The server PC's services may still be starting after boot.
    await waitFor(current.url, current.mode === "server" ? 120_000 : 15_000);
    await win.loadURL(current.url);
  } catch (e) {
    await showPage("error", { mode: current.mode, url: current.url, reason: e.message });
  }
}

function sameApp(url) {
  try {
    return current && new URL(url).origin === new URL(current.url).origin;
  } catch {
    return false;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: "Smart Hospital",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });
  // Pop-ups of the app itself (print views) and of the payment page stay in the app; other links open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (sameApp(url) || /^https:\/\/([a-z0-9-]+\.)*razorpay\.com\//i.test(url)) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith("file:") || sameApp(url)) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  win.webContents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    // -3: replaced by another navigation.
    if (!isMainFrame || code === -3 || url.startsWith("file:") || !current) return;
    showPage("error", { mode: current.mode, url: current.url, reason: description });
  });
  win.on("closed", () => {
    win = null;
  });
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          { label: "Home", accelerator: "Alt+Home", click: () => current && win?.loadURL(current.url) },
          { label: "Connection settings…", click: () => win && showPage("setup", { change: "1" }) },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
          { role: "toggleDevTools" },
        ],
      },
      {
        label: "Help",
        submenu: [
          {
            label: "About Smart Hospital",
            click: () =>
              dialog.showMessageBox(win, {
                type: "info",
                title: "Smart Hospital",
                message: `Smart Hospital ${pkg.version}`,
                detail: current ? `${current.mode === "server" ? "Server" : "Workstation"} · ${current.url}\nData folder: ${DATA}` : "Not set up yet",
              }),
          },
        ],
      },
    ])
  );
}

/* ---------------- setup actions (setup.html) ---------------- */

/** Runs a .cmd as administrator (Windows asks for permission). */
function runElevated(file, args) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const argList = args.length ? ` -ArgumentList ${args.map(q).join(",")}` : "";
  const ps = `try { $p = Start-Process -FilePath ${q(file)}${argList} -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop; exit $p.ExitCode } catch { exit 1223 }`;
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], { windowsHide: true }, (err) => resolve(err ? (typeof err.code === "number" ? err.code : 1) : 0));
  });
}

const elevatedError = (code) =>
  code === 1223 ? "Windows did not give administrator permission. Click Yes when Windows asks, or sign in as an administrator." : `Setup failed (code ${code}). See ${path.join(DATA, "logs")} or run the setup again.`;

function fromSetupPage(e) {
  if (!e.senderFrame?.url.startsWith("file:")) throw new Error("Not allowed");
}

ipcMain.handle("desktop:info", (e) => {
  fromSetupPage(e);
  const s = readSettings();
  return { version: pkg.version, host: os.hostname(), server: serverConfig(), workstationUrl: s.mode === "workstation" ? s.url : null, controlUrl: pkg.smartHospital?.controlUrl ?? "", dataDir: DATA, current };
});

ipcMain.handle("desktop:setup-server", async (e, opts) => {
  fromSetupPage(e);
  const port = String(opts?.port ?? "").trim() || DEFAULT_PORT;
  const domain = String(opts?.domain ?? "").trim().toLowerCase();
  const controlUrl = String(opts?.controlUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) return { error: "Enter a port between 1024 and 65535." };
  if (domain && !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return { error: "Enter a domain like his.cityhospital.com, or leave it blank." };
  if (controlUrl && !/^https?:\/\/[^\s"']+$/.test(controlUrl)) return { error: "The licence server address must start with https:// (or leave it blank to use offline keys)." };
  const script = path.join(SH, "bin", "setup-server.cmd");
  if (!fs.existsSync(script)) return { error: `Server files are missing (${script}). Reinstall Smart Hospital.` };
  const code = await runElevated(script, [`--port=${port}`, `--domain=${domain}`, ...(controlUrl ? [`--control-url=${controlUrl}`] : [])]);
  if (code !== 0) return { error: elevatedError(code) };
  writeSettings({ ...readSettings(), mode: "server", url: undefined });
  open();
  return { ok: true };
});

ipcMain.handle("desktop:setup-workstation", async (e, opts) => {
  fromSetupPage(e);
  const url = serverUrl(opts?.address);
  if (!url) return { error: "Enter the server's address, for example 192.168.1.10 or server-pc:3010." };
  if (!opts?.force) {
    try {
      await waitFor(url, 6000);
    } catch (err) {
      return { error: `Cannot reach Smart Hospital at ${url} (${err.message}). Check the address, that the server PC is on, and that both PCs are on the same network.`, unreachable: true };
    }
  }
  writeSettings({ ...readSettings(), mode: "workstation", url });
  open();
  return { ok: true };
});

ipcMain.handle("desktop:restart-server", async (e) => {
  fromSetupPage(e);
  const code = await runElevated(path.join(SH, "bin", "services.cmd"), ["install"]);
  if (code !== 0) return { error: elevatedError(code) };
  open();
  return { ok: true };
});

ipcMain.handle("desktop:retry", (e) => {
  fromSetupPage(e);
  open();
});

ipcMain.handle("desktop:settings", (e) => {
  fromSetupPage(e);
  return showPage("setup", { change: "1" });
});

app.whenReady().then(() => {
  app.setAppUserModelId("com.smarthospital.desktop");
  buildMenu();
  createWindow();
  open();
});

app.on("window-all-closed", () => app.quit());

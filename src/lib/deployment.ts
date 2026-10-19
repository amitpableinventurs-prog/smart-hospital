import "server-only";
import pkg from "../../package.json";

/**
 * How this server is deployed (APP_MODE):
 *   standalone — a single hospital, no licensing (the default).
 *   control    — your central server: the Control Panel that licenses client
 *                installations and keeps a copy of their data.
 *   client     — a hospital installed from the Windows setup. It runs offline
 *                on its own database, checks its licence with CONTROL_URL and
 *                uploads its data there whenever it is online.
 */
export type AppMode = "standalone" | "control" | "client";

export function appMode(): AppMode {
  const m = process.env.APP_MODE?.trim().toLowerCase();
  return m === "control" || m === "client" ? m : "standalone";
}

/** The Control Panel's base URL, e.g. https://control.yourcompany.com (client mode). */
export function controlUrl() {
  return (process.env.CONTROL_URL ?? "").trim().replace(/\/+$/, "");
}

export const APP_VERSION: string = pkg.version;

// Gives the bundled setup screen (setup.html) its few desktop actions. Pages of the app itself get nothing.
const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("desktop", {
    info: () => ipcRenderer.invoke("desktop:info"),
    setupServer: (opts) => ipcRenderer.invoke("desktop:setup-server", opts),
    setupWorkstation: (opts) => ipcRenderer.invoke("desktop:setup-workstation", opts),
    restartServer: () => ipcRenderer.invoke("desktop:restart-server"),
    retry: () => ipcRenderer.invoke("desktop:retry"),
    settings: () => ipcRenderer.invoke("desktop:settings"),
  });
}

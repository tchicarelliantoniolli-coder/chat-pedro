// Ponte entre o programa e o site: o site so ganha window.ChatPedroDesktop quando a pagina e a do Chat Pedro.
// O site (public/desktop.js) usa isso para a barra da janela, o numero de nao lidas, os atalhos globais, etc.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const info = ipcRenderer.sendSync("cp:info");
if (info && location.origin === info.origin) {
  const on = (ch) => (cb) => {
    const f = (_e, ...a) => { try { cb(...a); } catch (err) { console.error(err); } };
    ipcRenderer.on(ch, f);
    return () => ipcRenderer.removeListener(ch, f);
  };
  contextBridge.exposeInMainWorld("ChatPedroDesktop", {
    version: info.version,
    platform: info.platform,
    minimize: () => ipcRenderer.send("cp:win", "min"),
    maximize: () => ipcRenderer.send("cp:win", "max"),
    close: () => ipcRenderer.send("cp:win", "close"),
    show: () => ipcRenderer.send("cp:win", "show"),
    ready: () => ipcRenderer.send("cp:ready"),
    setBadge: (n, png) => ipcRenderer.send("cp:badge", Number(n) || 0, typeof png === "string" ? png : ""),
    flash: () => ipcRenderer.send("cp:flash"),
    setVoice: (s) => ipcRenderer.send("cp:voice", { inCall: !!(s && s.inCall), micOn: !!(s && s.micOn), deaf: !!(s && s.deaf) }),
    setDevMode: (v) => ipcRenderer.send("cp:dev", !!v),
    getConfig: () => ipcRenderer.invoke("cp:config:get"),
    setConfig: (p) => ipcRenderer.invoke("cp:config:set", p),
    recordBind: () => ipcRenderer.invoke("cp:bind:record"),
    cancelRecord: () => ipcRenderer.send("cp:bind:cancel"),
    listPrograms: () => ipcRenderer.invoke("cp:programs"),
    gameNow: () => ipcRenderer.invoke("cp:game:now"),
    pickReply: (id, choice) => ipcRenderer.send("cp:pick", id, choice || null),
    installUpdate: () => ipcRenderer.send("cp:update:install"),
    onWinState: on("cp:win-state"),
    onHotkey: on("cp:hotkey"),
    onTray: on("cp:tray"),
    onGame: on("cp:game"),
    onPickScreen: on("cp:pick-screen"),
    onZoom: on("cp:zoom"),
    onUpdate: on("cp:update"),
    onConfig: on("cp:config"),
  });
}

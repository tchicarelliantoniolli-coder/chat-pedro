// Chat Pedro para Windows (Electron).
// Uma janela so do Chat Pedro, sem nada de navegador em volta: a barra de cima do proprio site vira a barra da
// janela. As telas vem do site (SITE), entao tudo que muda no site aparece aqui na hora, sem reinstalar.
// O que o navegador nao deixa e o programa faz: ficar perto do relogio ao fechar (bandeja), numero de nao lidas
// no icone, atalhos do microfone que funcionam com outra janela na frente (dentro de jogos), "Jogando ..."
// automatico, abrir junto com o Windows e escolher a tela/janela para compartilhar como no Discord.
"use strict";
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, session, desktopCapturer, net, screen, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const KNOWN_GAMES = require("./games");

const SITE = (process.env.CHATPEDRO_URL || "https://chat-pedro.onrender.com").replace(/\/+$/, "");
const ORIGIN = new URL(SITE).origin;
const TEST = process.env.CHATPEDRO_TEST === "1"; // testes automaticos (no Linux, com tela virtual)
const WIN = process.platform === "win32";
const AUTOSTART = process.argv.includes("--autostart"); // aberto junto com o Windows
const SCAN_MS = Number(process.env.CHATPEDRO_SCAN_MS) || 15000; // de quanto em quanto tempo procura jogo aberto

if (process.env.CHATPEDRO_USERDATA) app.setPath("userData", process.env.CHATPEDRO_USERDATA);

// registro de erros em %APPDATA%/Chat Pedro/chat-pedro.log (no Windows o programa nao tem tela de texto)
const LOG = () => path.join(app.getPath("userData"), "chat-pedro.log");
function log(...a) {
  const line = new Date().toISOString() + " " + a.map((x) => (x instanceof Error ? x.stack : typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n";
  try {
    fs.mkdirSync(path.dirname(LOG()), { recursive: true });
    if (fs.existsSync(LOG()) && fs.statSync(LOG()).size > 256 * 1024) fs.renameSync(LOG(), LOG() + ".old");
    fs.appendFileSync(LOG(), line);
  } catch {}
}
const consoleError = console.error.bind(console);
console.error = (...a) => { consoleError(...a); log(...a); };
process.on("uncaughtException", (e) => console.error("erro:", e));
process.on("unhandledRejection", (e) => console.error("erro (promessa):", e));
app.setAppUserModelId("com.chatpedro.desktop"); // avisos do Windows com o nome e o icone do Chat Pedro

const asset = (n) => path.join(__dirname, "assets", n);
const img = (n) => nativeImage.createFromPath(asset(n));
const ours = (url) => { try { return new URL(url).origin === ORIGIN; } catch { return false; } };
const fromUs = (e) => !!(e && e.senderFrame && ours(e.senderFrame.url));

// ---------- configuracoes do programa (%APPDATA%/Chat Pedro/config.json) ----------
const DEFAULTS = {
  openAtLogin: true, startMinimized: false, closeToTray: true,
  bounds: null, maximized: false,
  binds: {}, // { ptt: {...}, mute: {...}, deaf: {...} } atalhos que funcionam com outra janela na frente
  games: [], // jogos que a pessoa adicionou: [{ exe, name }]
  ignored: [], // jogos conhecidos que a pessoa nao quer mostrar
  trayTip: false, firstRun: true,
};
let cfg = { ...DEFAULTS };
const cfgFile = () => path.join(app.getPath("userData"), "config.json");
function loadCfg() {
  try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgFile(), "utf8")) }; } catch { cfg = { ...DEFAULTS }; }
}
let saveTimer = null;
function saveCfg(now) {
  clearTimeout(saveTimer);
  const write = () => {
    try { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 1)); } catch (e) { console.error("config:", e.message); }
  };
  if (now) write(); else saveTimer = setTimeout(write, 400);
}
function applyLogin() {
  if (!app.isPackaged) return; // so o programa instalado se registra para abrir com o Windows
  try { app.setLoginItemSettings({ openAtLogin: !!cfg.openAtLogin, args: ["--autostart"] }); } catch {}
}
const publicCfg = () => ({
  openAtLogin: cfg.openAtLogin, startMinimized: cfg.startMinimized, closeToTray: cfg.closeToTray,
  binds: cfg.binds, games: cfg.games, ignored: cfg.ignored, version: app.getVersion(), platform: process.platform,
  hookOk: hookState() !== "erro", update: updateReady,
});

// ---------- janelas ----------
let lastWinAction = "";
let win = null, splash = null, tray = null, quitting = false, revealed = false, devMode = false;
let startHidden = false; // abriu junto com o Windows em "Iniciar minimizado": nao aparece ate clicar no icone
const send = (ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };

function makeSplash() {
  splash = new BrowserWindow({
    width: 300, height: 350, frame: false, resizable: false, maximizable: false, fullscreenable: false, show: false,
    backgroundColor: "#121214", title: "Chat Pedro", icon: asset("icon.png"), center: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  splash.removeMenu();
  splash.loadFile(path.join(__dirname, "splash.html"));
  splash.once("ready-to-show", () => { if (splash && !splash.isDestroyed()) splash.show(); });
  splash.on("closed", () => { splash = null; if (!revealed && !quitting) quit(); }); // fechou a abertura: sai
}
let splashText = ["Iniciando...", ""];
function setSplash(title, sub) {
  splashText = [title, sub || ""];
  if (splash && !splash.isDestroyed()) splash.webContents.executeJavaScript("window.setStatus && setStatus(" + JSON.stringify(title) + "," + JSON.stringify(sub || "") + ")").catch(() => {});
}

function boundsOk(b) {
  if (!b || !(b.width >= 400) || !(b.height >= 300)) return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 20 && b.y < a.y + a.height - 80;
  });
}
function saveBounds() {
  if (!win || win.isDestroyed()) return;
  cfg.maximized = win.isMaximized();
  if (!win.isMinimized() && !win.isFullScreen()) cfg.bounds = win.getNormalBounds();
  saveCfg();
}
// "visible" e "focused" dizem ao site se a pessoa esta olhando (com outra janela na frente conta como longe)
const winState = () => (win && !win.isDestroyed() ? { maximized: win.isMaximized(), focused: win.isFocused(), visible: win.isVisible() && !win.isMinimized(), fullscreen: win.isFullScreen() } : {});

function makeMain() {
  const b = boundsOk(cfg.bounds) ? cfg.bounds : { width: 1280, height: 720 };
  win = new BrowserWindow({
    ...b, minWidth: 940, minHeight: 500, frame: false, show: false, title: "Chat Pedro",
    backgroundColor: "#121214", icon: asset("icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false, // a call, os sons e as mensagens continuam com a janela escondida
      spellcheck: true,
    },
  });
  win.removeMenu();
  const wc = win.webContents;
  wc.setUserAgent(wc.getUserAgent().replace(/ (Electron|chat-pedro-desktop)\/\S+/g, "") + " ChatPedroDesktop/" + app.getVersion());
  wc.setVisualZoomLevelLimits(1, 1).catch(() => {});

  for (const ev of ["maximize", "unmaximize", "focus", "blur", "show", "hide", "minimize", "restore", "enter-full-screen", "leave-full-screen"]) win.on(ev, () => send("cp:win-state", winState()));
  win.on("focus", () => win.flashFrame(false));
  win.on("resize", saveBounds);
  win.on("move", saveBounds);
  win.on("close", (e) => {
    saveBounds();
    if (quitting || !cfg.closeToTray) return;
    e.preventDefault(); // o X so esconde: o Chat Pedro continua perto do relogio
    win.hide();
    if (!cfg.trayTip && tray && WIN) {
      cfg.trayTip = true; saveCfg();
      try { tray.displayBalloon({ iconType: "info", title: "O Chat Pedro continua aberto", content: "Ele fica aqui perto do relógio para você receber mensagens e chamadas. Para sair de vez: botão direito no ícone > Sair do Chat Pedro." }); } catch {}
    }
  });
  win.on("closed", () => { win = null; });
  // botoes "voltar"/"avancar" do mouse: voltam pelos servidores e conversas, como no Discord
  win.on("app-command", (e, cmd) => {
    const h = wc.navigationHistory;
    if (cmd === "browser-backward" && h.canGoBack()) h.goBack();
    if (cmd === "browser-forward" && h.canGoForward()) h.goForward();
  });

  // links de fora abrem no navegador da pessoa, nunca dentro do programa
  wc.setWindowOpenHandler(({ url }) => { openLink(url); return { action: "deny" }; });
  wc.on("will-navigate", (e, url) => { if (!ours(url)) { e.preventDefault(); openLink(url); } });
  wc.on("will-attach-webview", (e) => e.preventDefault());

  wc.on("before-input-event", (e, i) => {
    if (i.type !== "keyDown") return;
    const k = String(i.key || "").toLowerCase(), ctrl = i.control || i.meta;
    // nada de F5/Ctrl+R recarregando tudo (o site ja se atualiza sozinho quando sai versao nova)
    if (k === "f5" || (ctrl && k === "r")) return e.preventDefault();
    if (k === "f12" || (ctrl && i.shift && k === "i")) { e.preventDefault(); if (devMode || TEST) wc.toggleDevTools(); return; }
    // Ctrl + / Ctrl - / Ctrl 0: zoom (o mesmo de Acessibilidade > Nivel de zoom)
    if (ctrl && !i.alt && (k === "=" || k === "+" || k === "-" || k === "0")) { e.preventDefault(); send("cp:zoom", k === "-" ? -1 : k === "0" ? 0 : 1); }
  });

  // menu do botao direito so onde o site nao tem o dele: campos de texto, texto selecionado, links e imagens
  wc.on("context-menu", (e, p) => {
    const t = [], sep = { type: "separator" };
    if (p.misspelledWord) {
      for (const s of (p.dictionarySuggestions || []).slice(0, 5)) t.push({ label: s, click: () => wc.replaceMisspelling(s) });
      if (!t.length) t.push({ label: "Nenhuma sugestão", enabled: false });
      t.push({ label: "Adicionar ao dicionário", click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, sep);
    }
    if (p.linkURL && !p.isEditable) t.push({ label: "Copiar link", click: () => clipboard.writeText(p.linkURL) }, { label: "Abrir link", click: () => openLink(p.linkURL) }, sep);
    if (p.mediaType === "image" && p.srcURL) t.push({ label: "Copiar imagem", click: () => wc.copyImageAt(p.x, p.y) }, { label: "Salvar imagem", click: () => wc.downloadURL(p.srcURL) }, sep);
    if (p.isEditable) {
      const f = p.editFlags || {};
      t.push({ label: "Recortar", role: "cut", enabled: !!f.canCut }, { label: "Copiar", role: "copy", enabled: !!f.canCopy }, { label: "Colar", role: "paste", enabled: !!f.canPaste }, sep, { label: "Selecionar tudo", role: "selectAll" });
    } else if (p.selectionText && p.selectionText.trim()) t.push({ label: "Copiar", role: "copy" });
    while (t.length && t[t.length - 1].type === "separator") t.pop();
    if (t.length) Menu.buildFromTemplate(t).popup({ window: win });
  });

  wc.on("did-fail-load", (e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return; // -3 = carregamento trocado por outro (normal)
    console.error("falhou ao abrir", url, code, desc);
    reconnect();
  });
  wc.on("render-process-gone", (e, d) => { if (d.reason !== "clean-exit" && !quitting) setTimeout(() => win && wc.reload(), 1000); });
  let readyTimer = null;
  wc.on("did-finish-load", () => {
    send("cp:win-state", winState());
    clearTimeout(readyTimer);
    readyTimer = setTimeout(reveal, 15000); // se o site nao avisar que abriu, mostra mesmo assim
  });
  wc.loadURL(SITE + "/");
}

function reveal() {
  if (revealed || !win) return;
  revealed = true;
  if (splash && !splash.isDestroyed()) splash.destroy();
  splash = null;
  if (startHidden) return; // abriu junto com o Windows em "Iniciar minimizado": fica so perto do relogio
  if (cfg.maximized) win.maximize();
  win.show();
}
function showMain() {
  if (!win) return;
  startHidden = false;
  if (!revealed) { if (splash && !splash.isDestroyed()) splash.show(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function quit() { quitting = true; app.quit(); }

// sem conexao depois de aberto (o site foi recarregar e nao achou o servidor): volta para a abertura e tenta de novo
let reconnecting = false;
async function reconnect() {
  if (reconnecting || quitting) return;
  reconnecting = true;
  const visible = !!(win && win.isVisible());
  if (revealed) {
    revealed = false;
    startHidden = !visible; // estava escondido perto do relogio: continua escondido
    if (visible) { makeSplash(); win.hide(); }
  }
  await waitServer();
  reconnecting = false;
  if (win) win.webContents.loadURL(SITE + "/");
}

function openLink(url) {
  let u;
  try { u = new URL(url); } catch { return; }
  if (u.origin === ORIGIN && /^\/(s|convite)\//.test(u.pathname)) { if (win) win.webContents.loadURL(u.href); return; }
  if (["http:", "https:", "mailto:"].includes(u.protocol)) shell.openExternal(u.href).catch(() => {});
}

// ---------- servidor (o Render gratis dorme: a abertura mostra que esta acordando) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitServer() {
  for (let attempt = 0; !quitting; attempt++) {
    setSplash(attempt ? "Conectando de novo..." : "Conectando...", "");
    const slow = setTimeout(() => setSplash("Acordando o servidor...", "Na primeira vez do dia pode levar até 1 minuto."), 2500);
    let reached = false;
    try {
      const r = await net.fetch(SITE + "/api/ping", { cache: "no-store", signal: AbortSignal.timeout(75000) });
      reached = r.status < 500;
    } catch {}
    clearTimeout(slow);
    if (reached) return;
    const offline = !net.isOnline();
    for (let s = 5; s > 0 && !quitting; s--) {
      setSplash(offline ? "Sem conexão com a internet" : "O servidor não respondeu", "Tentando de novo em " + s + " s");
      await sleep(1000);
    }
  }
}

// ---------- atualizacoes do programa (GitHub Releases) ----------
let updater = null, updateReady = false;
function getUpdater() {
  if (!app.isPackaged || TEST) return null;
  if (updater) return updater;
  try {
    updater = require("electron-updater").autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.logger = null;
    updater.on("update-downloaded", () => { updateReady = true; send("cp:update", "ready"); buildTray(); });
    updater.on("error", (e) => console.error("atualização:", e && e.message));
  } catch (e) { console.error("atualização:", e.message); updater = null; }
  return updater;
}
function updateAtStart() {
  const u = getUpdater();
  if (!u) return Promise.resolve();
  return new Promise((done) => {
    let over = false, timer;
    const offs = [];
    const on = (ev, fn) => { u.on(ev, fn); offs.push(() => u.removeListener(ev, fn)); };
    const end = () => { if (over) return; over = true; clearTimeout(timer); offs.forEach((f) => f()); done(); };
    timer = setTimeout(end, 12000); // sem resposta: abre assim mesmo
    on("update-available", () => { clearTimeout(timer); timer = setTimeout(end, 180000); setSplash("Baixando atualização...", ""); });
    on("download-progress", (p) => setSplash("Baixando atualização...", Math.round(p.percent || 0) + "%"));
    on("update-downloaded", () => { over = true; setSplash("Instalando atualização...", ""); quitting = true; setTimeout(() => u.quitAndInstall(true, true), 500); });
    on("update-not-available", end);
    on("error", end);
    setSplash("Verificando atualizações...", "");
    u.checkForUpdates().catch(end);
  });
}
function checkUpdatesLater() {
  const u = getUpdater();
  if (!u) return;
  setInterval(() => { if (!updateReady) u.checkForUpdates().catch(() => {}); }, 4 * 3600 * 1000);
}

// ---------- icone perto do relogio ----------
let voice = { inCall: false, micOn: true, deaf: false }, badge = 0, trayItems = [];
function buildTray() {
  if (!tray) return;
  trayItems = [
    { label: "Abrir o Chat Pedro", click: showMain },
    { type: "separator" },
    { label: "Silenciar microfone", type: "checkbox", checked: !voice.micOn, click: () => send("cp:tray", "mute") },
    { label: "Desativar áudio", type: "checkbox", checked: !!voice.deaf, click: () => send("cp:tray", "deaf") },
    { type: "separator" },
    { label: "Abrir junto com o Windows", type: "checkbox", checked: !!cfg.openAtLogin, click: (m) => { cfg.openAtLogin = m.checked; applyLogin(); saveCfg(); send("cp:config", publicCfg()); } },
    updateReady ? { label: "Reiniciar para atualizar", click: installUpdate } : { label: "Procurar atualizações", enabled: !!getUpdater(), click: () => { const u = getUpdater(); if (u) u.checkForUpdates().catch(() => {}); } },
    { type: "separator" },
    { label: "Sair do Chat Pedro", click: quit },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(trayItems));
}
function makeTray() {
  tray = new Tray(img(WIN ? "tray.ico" : "tray.png"));
  tray.setToolTip("Chat Pedro");
  tray.on("click", showMain);
  buildTray();
}
function setBadge(n, png) {
  badge = Math.max(0, n | 0);
  if (win && WIN) {
    let icon = null;
    try { if (badge && png) icon = nativeImage.createFromDataURL(png); } catch {}
    win.setOverlayIcon(icon, badge ? badge + " não lidas" : "");
  }
  if (!WIN) try { app.setBadgeCount(badge); } catch {}
  if (tray) {
    tray.setImage(img(badge ? (WIN ? "tray-unread.ico" : "tray-unread.png") : (WIN ? "tray.ico" : "tray.png")));
    tray.setToolTip(badge ? "Chat Pedro (" + badge + ")" : "Chat Pedro");
  }
}
function installUpdate() { const u = getUpdater(); if (u && updateReady) { quitting = true; u.quitAndInstall(true, true); } }

// ---------- atalhos globais (funcionam com o jogo na frente) ----------
// Usa o uiohook (le o teclado e o mouse do Windows sem "roubar" a tecla do jogo).
const MODS = { 29: "ctrl", 3613: "ctrl", 42: "shift", 54: "shift", 56: "alt", 3640: "alt", 3675: "meta", 3676: "meta" };
const KEY_LABEL = {
  Space: "ESPAÇO", Ctrl: "CTRL", CtrlRight: "CTRL DIREITO", Shift: "SHIFT", ShiftRight: "SHIFT DIREITO", Alt: "ALT", AltRight: "ALT GR",
  Meta: "WINDOWS", MetaRight: "WINDOWS", CapsLock: "CAPS LOCK", Escape: "ESC", Enter: "ENTER", Backspace: "BACKSPACE", Tab: "TAB",
  ArrowUp: "SETA PARA CIMA", ArrowDown: "SETA PARA BAIXO", ArrowLeft: "SETA PARA A ESQUERDA", ArrowRight: "SETA PARA A DIREITA",
  PageUp: "PAGE UP", PageDown: "PAGE DOWN", Insert: "INSERT", Delete: "DELETE", Home: "HOME", End: "END", PrintScreen: "PRINT SCREEN",
  ScrollLock: "SCROLL LOCK", NumLock: "NUM LOCK", Backquote: "'", Minus: "-", Equal: "=", BracketLeft: "´", BracketRight: "[",
  Backslash: "]", Semicolon: "Ç", Quote: "~", Comma: ",", Period: ".", Slash: ";",
};
let hook = null, hookErr = false, hookOn = false, keyNames = null;
const hookState = () => (hookErr ? "erro" : hookOn ? "on" : "off");
function loadHook() {
  if (hook || hookErr) return hook;
  try {
    hook = require("uiohook-napi");
    keyNames = {};
    for (const [name, code] of Object.entries(hook.UiohookKey)) if (!(code in keyNames)) keyNames[code] = name;
    hook.uIOhook.on("keydown", (e) => onInput("key", e.keycode, true, e));
    hook.uIOhook.on("keyup", (e) => onInput("key", e.keycode, false, e));
    hook.uIOhook.on("mousedown", (e) => onInput("mouse", e.button, true, e));
    hook.uIOhook.on("mouseup", (e) => onInput("mouse", e.button, false, e));
  } catch (e) { console.error("atalhos globais:", e.message); hook = null; hookErr = true; }
  return hook;
}
function labelOf(kind, code, mods) {
  if (kind === "mouse") return "MOUSE" + code;
  if (!keyNames) loadHook();
  const n = (keyNames && keyNames[code]) || "TECLA " + code;
  let base = KEY_LABEL[n] || n.replace(/^Numpad/, "NUM ").toUpperCase();
  const pre = mods && !MODS[code] ? ["ctrl", "shift", "alt", "meta"].filter((m) => mods[m]).map((m) => (m === "meta" ? "WINDOWS" : m.toUpperCase())) : [];
  return [...pre, base].join(" + ");
}
function wantHook() { return recording || Object.values(cfg.binds || {}).some(Boolean); }
function syncHook() {
  const want = wantHook();
  if (TEST && process.env.CHATPEDRO_REALHOOK !== "1") { hookOn = want; return; } // testes: teclas de mentira (global.__cp.key)
  if (want && !hookOn) {
    if (!loadHook()) return;
    try { hook.uIOhook.start(); hookOn = true; } catch (e) { console.error("atalhos globais:", e.message); hookErr = true; }
  } else if (!want && hookOn) {
    try { hook.uIOhook.stop(); } catch {}
    hookOn = false;
  }
}
const held = {};
let recording = null; // { resolve, mods, onlyMod }
function onInput(kind, code, down, e) {
  if (recording) return recordInput(kind, code, down, e);
  for (const [action, b] of Object.entries(cfg.binds || {})) {
    if (!b || b.kind !== kind || b.code !== code) continue;
    if (action === "ptt") { // segurar para falar: vale mesmo com outras teclas apertadas (correr + falar)
      if (held.ptt === down) continue;
      held.ptt = down;
      send("cp:hotkey", { action, down });
    } else if (down) {
      const m = b.mods || {};
      if (kind === "key" && !MODS[code] && ["ctrl", "shift", "alt", "meta"].some((k) => !!m[k] !== !!e[k + "Key"])) continue;
      if (held[action]) continue;
      held[action] = true;
      send("cp:hotkey", { action, down: true });
    } else held[action] = false;
  }
}
function recordInput(kind, code, down, e) {
  const r = recording;
  if (kind === "mouse") {
    if (!down || code === 1 || code === 2) return; // botao esquerdo e direito nao (seriam usados para clicar)
    return finishRecord({ kind, code, label: labelOf(kind, code) });
  }
  if (down) {
    if (code === 1) return finishRecord(null); // ESC cancela
    if (MODS[code]) { r.lastMod = code; return; }
    const mods = { ctrl: !!e.ctrlKey, shift: !!e.shiftKey, alt: !!e.altKey, meta: !!e.metaKey };
    return finishRecord({ kind, code, mods, label: labelOf(kind, code, mods) });
  }
  if (MODS[code] && r.lastMod === code) finishRecord({ kind, code, label: labelOf(kind, code) }); // so CTRL, so SHIFT...
}
function finishRecord(bind) {
  const r = recording;
  if (!r) return;
  recording = null;
  clearTimeout(r.timer);
  r.resolve(bind);
  syncHook();
}
function startRecord() {
  if (recording) finishRecord(null);
  return new Promise((resolve) => {
    recording = { resolve, timer: setTimeout(() => finishRecord(null), 15000) };
    syncHook();
    if (!hookOn) finishRecord(null);
  });
}

// ---------- "Jogando ..." (procura jogos abertos de tempos em tempos) ----------
let gameNow = null;
const run = (cmd, args) => new Promise((res) => execFile(cmd, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 15000 }, (err, out) => res(err ? "" : String(out))));
async function processNames() {
  if (WIN) {
    const out = await run("tasklist", ["/fo", "csv", "/nh"]);
    return out.split(/\r?\n/).map((l) => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean).map((s) => s.toLowerCase());
  }
  const out = await run("ps", ["-A", "-o", "comm="]);
  return out.split("\n").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
const base = (s) => String(s || "").toLowerCase().replace(/\.exe$/, "");
async function scanGames() {
  const names = new Set((await processNames()).map(base));
  let found = null;
  for (const g of cfg.games || []) if (names.has(base(g.exe))) { found = { exe: g.exe, name: g.name }; break; }
  if (!found) {
    for (const [exe, name] of Object.entries(KNOWN_GAMES)) {
      if (names.has(base(exe)) && !(cfg.ignored || []).includes(exe)) { found = { exe, name }; break; }
    }
  }
  if ((found && found.name) !== (gameNow && gameNow.name)) {
    gameNow = found ? { ...found, since: Date.now() } : null;
    send("cp:game", gameNow);
  }
}
async function listPrograms() {
  if (WIN) {
    const ps = "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName, MainWindowTitle | ConvertTo-Json -Compress";
    const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps]);
    let list = [];
    try { list = JSON.parse(out || "[]"); } catch {}
    if (!Array.isArray(list)) list = [list];
    const skip = new Set(["explorer", "applicationframehost", "textinputhost", "systemsettings", "chat pedro", "shellexperiencehost", "searchhost", "startmenuexperiencehost", "lockapp"]);
    return list.filter((p) => p && p.ProcessName && !skip.has(String(p.ProcessName).toLowerCase()))
      .map((p) => ({ exe: p.ProcessName + ".exe", title: String(p.MainWindowTitle || p.ProcessName).slice(0, 80) }));
  }
  const names = [...new Set(await processNames())].sort();
  return names.map((n) => ({ exe: n, title: n }));
}

// ---------- compartilhar tela: escolher tela ou janela (a lista aparece dentro do Chat Pedro) ----------
let pickSeq = 0;
const picks = new Map();
async function displayMediaHandler(req, cb) {
  try {
    if (!win || !ours((req.frame && req.frame.url) || req.securityOrigin || "")) return cb(null);
    const sources = await desktopCapturer.getSources({ types: ["window", "screen"], thumbnailSize: { width: 352, height: 198 }, fetchWindowIcons: true });
    const self = win.getMediaSourceId();
    const list = sources.filter((s) => s.id !== self && s.name !== "Chat Pedro");
    const id = ++pickSeq;
    const choice = await new Promise((resolve) => {
      picks.set(id, resolve);
      setTimeout(() => { if (picks.has(id)) { picks.delete(id); resolve(null); } }, 120000);
      send("cp:pick-screen", {
        id, audio: !!req.audioRequested && WIN,
        sources: list.map((s) => ({
          id: s.id, name: s.name, kind: s.id.startsWith("screen:") ? "screen" : "window",
          thumb: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : "",
          icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : "",
        })),
      });
    });
    const src = choice && list.find((s) => s.id === choice.id);
    if (!src) return cb(null);
    // som do computador junto (so o Windows deixa)
    cb(choice.audio && WIN ? { video: src, audio: "loopback" } : { video: src });
  } catch (e) { console.error("compartilhar tela:", e.message); try { cb(null); } catch {} }
}

// ---------- permissoes: microfone, camera, avisos... so para o Chat Pedro ----------
const ALLOW = new Set(["media", "notifications", "fullscreen", "clipboard-read", "clipboard-sanitized-write", "display-capture", "speaker-selection", "idle-detection", "keyboardLock", "pointerLock", "screen-wake-lock", "window-management", "automatic-fullscreen"]);
function setupSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, perm, cb, d) => {
    const url = (d && (d.requestingUrl || d.securityOrigin)) || (wc && wc.getURL()) || "";
    cb(ours(url) ? ALLOW.has(perm) : perm === "fullscreen");
  });
  ses.setPermissionCheckHandler((wc, perm, origin) => (ours(origin) ? ALLOW.has(perm) : perm === "fullscreen"));
  ses.setDisplayMediaRequestHandler(displayMediaHandler, { useSystemPicker: false });
  if (!TEST && !WIN) try { ses.setSpellCheckerLanguages(["pt-BR"]); } catch {}
}

// ---------- conversa com o site (preload.js) ----------
function setupIpc() {
  ipcMain.on("cp:info", (e) => { e.returnValue = { origin: ORIGIN, version: app.getVersion(), platform: process.platform }; });
  ipcMain.on("cp:win", (e, a) => {
    if (!fromUs(e) || !win) return;
    lastWinAction = a;
    if (a === "min") win.minimize();
    else if (a === "max") { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
    else if (a === "close") win.close();
    else if (a === "show") showMain();
  });
  ipcMain.on("cp:ready", (e) => { if (fromUs(e)) reveal(); });
  ipcMain.on("cp:badge", (e, n, png) => { if (fromUs(e)) setBadge(n, typeof png === "string" ? png : ""); });
  ipcMain.on("cp:flash", (e) => { if (fromUs(e) && win && !win.isFocused()) win.flashFrame(true); });
  ipcMain.on("cp:voice", (e, s) => {
    if (!fromUs(e) || !s || typeof s !== "object") return;
    voice = { inCall: !!s.inCall, micOn: !!s.micOn, deaf: !!s.deaf };
    buildTray();
  });
  ipcMain.on("cp:dev", (e, on) => { if (fromUs(e)) devMode = !!on; });
  ipcMain.on("cp:update:install", (e) => { if (fromUs(e)) installUpdate(); });
  ipcMain.on("cp:pick", (e, id, choice) => {
    if (!fromUs(e) || !picks.has(id)) return;
    const r = picks.get(id); picks.delete(id);
    r(choice && typeof choice.id === "string" ? { id: choice.id, audio: !!choice.audio } : null);
  });
  ipcMain.handle("cp:config:get", (e) => (fromUs(e) ? publicCfg() : null));
  ipcMain.handle("cp:config:set", (e, p) => {
    if (!fromUs(e) || !p || typeof p !== "object") return null;
    for (const k of ["openAtLogin", "startMinimized", "closeToTray"]) if (typeof p[k] === "boolean") cfg[k] = p[k];
    if (p.binds && typeof p.binds === "object") {
      const nb = {};
      for (const a of ["ptt", "mute", "deaf"]) {
        const b = p.binds[a];
        if (b && (b.kind === "key" || b.kind === "mouse") && Number.isInteger(b.code)) {
          nb[a] = { kind: b.kind, code: b.code, label: String(b.label || labelOf(b.kind, b.code, b.mods)).slice(0, 40) };
          if (b.mods) nb[a].mods = { ctrl: !!b.mods.ctrl, shift: !!b.mods.shift, alt: !!b.mods.alt, meta: !!b.mods.meta };
        }
      }
      cfg.binds = nb;
      for (const k of Object.keys(held)) held[k] = false;
    }
    if (Array.isArray(p.games)) cfg.games = p.games.filter((g) => g && g.exe && g.name).slice(0, 50).map((g) => ({ exe: String(g.exe).slice(0, 120), name: String(g.name).slice(0, 60) }));
    if (Array.isArray(p.ignored)) cfg.ignored = p.ignored.map(String).slice(0, 200);
    applyLogin();
    saveCfg();
    syncHook();
    if (p.games || p.ignored) scanGames().catch(() => {});
    return publicCfg();
  });
  ipcMain.handle("cp:bind:record", (e) => (fromUs(e) ? startRecord() : null));
  ipcMain.on("cp:bind:cancel", (e) => { if (fromUs(e)) finishRecord(null); });
  ipcMain.handle("cp:programs", (e) => (fromUs(e) ? listPrograms() : []));
  ipcMain.handle("cp:game:now", (e) => (fromUs(e) ? gameNow : null));
}

// ---------- comeco ----------
if (!app.requestSingleInstanceLock()) {
  app.quit(); // ja tem um Chat Pedro aberto: ele aparece (second-instance)
} else {
  app.on("second-instance", () => showMain());
  app.on("before-quit", () => { quitting = true; saveBounds(); saveCfg(true); if (hookOn) try { hook.uIOhook.stop(); } catch {} });
  app.on("window-all-closed", () => { if (quitting || !cfg.closeToTray || !tray) app.quit(); });
  app.whenReady().then(async () => {
    log("abrindo", app.getVersion(), process.platform, SITE, AUTOSTART ? "(junto com o Windows)" : "");
    loadCfg();
    if (cfg.firstRun) { cfg.firstRun = false; saveCfg(); }
    applyLogin();
    startHidden = AUTOSTART && cfg.startMinimized;
    setupSession();
    setupIpc();
    makeTray();
    if (!startHidden) makeSplash();
    await updateAtStart();
    if (quitting) return;
    await waitServer();
    if (quitting) return;
    setSplash("Abrindo o Chat Pedro...", "");
    log("servidor respondeu; abrindo a janela");
    makeMain();
    syncHook();
    scanGames().catch(() => {});
    setInterval(() => scanGames().catch(() => {}), SCAN_MS);
    checkUpdatesLater();
  }).catch((e) => console.error("erro ao abrir:", e));
}

// para os testes automaticos olharem por dentro
if (TEST) {
  global.__cp = {
    cfg: () => cfg, badge: () => badge, voice: () => voice, game: () => gameNow, revealed: () => revealed,
    trayLabels: () => trayItems.map((i) => (i.type === "separator" ? "-" : i.label + (i.type === "checkbox" ? (i.checked ? " [x]" : " [ ]") : ""))),
    trayClick: (label) => { const i = trayItems.find((x) => x.label === label); if (i) i.click({ checked: !i.checked }); return !!i; },
    key: (kind, code, down, mods) => onInput(kind, code, down, { ctrlKey: !!(mods && mods.ctrl), shiftKey: !!(mods && mods.shift), altKey: !!(mods && mods.alt), metaKey: false }),
    recordFake: (kind, code, down, mods) => recording && recordInput(kind, code, down, { ctrlKey: !!(mods && mods.ctrl), shiftKey: !!(mods && mods.shift), altKey: !!(mods && mods.alt), metaKey: false }),
    lastWin: () => lastWinAction, winState, hook: hookState, splashText: () => splashText, scan: () => scanGames(), close: () => win && win.close(), visible: () => !!(win && win.isVisible()),
  };
}

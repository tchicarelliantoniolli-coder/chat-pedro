const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { createPoker } = require("./poker");
const { createTruco } = require("./truco");
const { createStorage } = require("./storage");

const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 200; // quantas mensagens ficam guardadas
const MAX_TEXT = 2000;
const MAX_LINES = 12;
const MAX_NICK = 20;
const MAX_IMAGE = 3 * 1024 * 1024; // tamanho maximo da foto (ja comprimida) em bytes de texto
const MAX_AUDIO = 1.5 * 1024 * 1024; // audio de ate ~1 minuto
const MAX_MEDIA_KEPT = 40; // fotos e audios mais antigos que isso saem do historico
const IMAGE_RE = /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const AUDIO_RE = /^data:audio\/(webm|ogg|mp4|mpeg|aac)(;codecs=[A-Za-z0-9.,=-]+)?;base64,[A-Za-z0-9+/=]+$/;
const MAX_AVATAR = 60 * 1024; // foto de perfil ja vem pequena (48x48) do navegador
const MAX_AVATARS_KEPT = 200;
const REACTIONS = ["\u{1F602}", "\u{1F525}", "\u{1F480}", "\u{1F44D}", "❤️", "\u{1F62E}"];
const NAME_COLORS = ["#33ff66", "#b6ffc8", "#ffd84d", "#ffb000", "#ff7a59", "#ff5fa2", "#c792ff", "#5fd7ff", "#7aa2ff", "#e6e6e6"];
const STATUSES = ["online", "ausente", "ocupado"];
const SFX = ["buzina", "ihhh", "risada", "aplausos", "tambor", "erro"];
// Senha do ADM: fica nas variaveis de ambiente do Render (o codigo no GitHub e publico).
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const LOGIN_TRIES = 5; // tentativas erradas por endereco a cada 10 minutos

// Servidores para a call atravessar redes chatas (4G, escola, empresa). O TURN e opcional e vem do Render.
const ICE_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
if (process.env.TURN_URLS) {
  ICE_SERVERS.push({
    urls: process.env.TURN_URLS.split(",").map((u) => u.trim()).filter(Boolean),
    username: process.env.TURN_USERNAME || "",
    credential: process.env.TURN_CREDENTIAL || "",
  });
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: MAX_IMAGE + 64 * 1024 });

app.use(express.static(path.join(__dirname, "public")));

let history = [];
let nextId = 1;
const online = new Map(); // socket.id -> apelido
let avatars = {}; // apelido em minusculas -> foto de perfil
let profiles = {}; // apelido em minusculas -> { color }
const statuses = new Map(); // socket.id -> online | ausente | ocupado
// Chamada: o servidor so guarda quem esta nela e repassa os sinais de conexao.
// Audio e video vao direto de navegador para navegador (WebRTC).
const callMembers = new Map(); // socket.id -> { id, nick, mic, deaf, cam, screen }
let watch = null; // video do YouTube que a call esta assistindo junto
const watchMsg = () => watch && { ...watch, now: Date.now() }; // "now" deixa cada um corrigir o proprio relogio
const admins = new Set(); // socket.id de quem entrou com a senha de ADM
const failedLogins = new Map(); // endereco -> { count, until }
const mutes = new Map(); // apelido(minusculo) -> silenciado ate
const floodMuted = new Set(); // quem foi silenciado pelo anti-flood (e nao pelo ADM)
const bans = new Map(); // apelido(minusculo) ou "ip:endereco" -> expulso ate

const storage = createStorage();
const keyOf = (nick) => nick.toLowerCase();
const persist = () => storage && storage.saveSoon({ history, avatars, profiles, nextId });

function cleanNick(nick) {
  return String(nick || "").replace(/\s+/g, " ").trim().slice(0, MAX_NICK);
}

function clientAddress(socket) {
  const fwd = socket.handshake.headers["x-forwarded-for"]; // o Render fica na frente do servidor
  return (fwd ? String(fwd).split(",")[0] : socket.handshake.address).trim();
}

const isMedia = (m) => m.type === "img" || m.type === "audio";

function dropMessages(list) {
  if (!list.length) return;
  const gone = new Set(list);
  history = history.filter((m) => !gone.has(m));
  if (storage) storage.deleteMedia(list.filter(isMedia).map((m) => m.id));
}

function pushMessage(msg) {
  msg.id = nextId++;
  history.push(msg);
  if (storage && isMedia(msg)) storage.saveMedia(msg.id, msg.src);
  const old = [];
  if (history.length > MAX_HISTORY) old.push(history[0]);
  const media = history.filter(isMedia);
  if (media.length > MAX_MEDIA_KEPT) old.push(media[0]);
  dropMessages(old);
  io.emit("message", msg);
  persist();
}

const sys = (text) => pushMessage({ type: "sys", text, ts: Date.now() });

const poker = createPoker(io, {
  nickOf: (id) => online.get(id),
  isAdmin: (id) => admins.has(id),
});

const truco = createTruco(io, {
  nickOf: (id) => online.get(id),
  isAdmin: (id) => admins.has(id),
});

function sendCall() {
  io.emit("call:members", [...callMembers.values()]);
  if (!callMembers.size && watch) { watch = null; io.emit("watch:state", null); }
}

function cleanCallState(s) {
  s = s && typeof s === "object" ? s : {};
  const streamId = (v) => (typeof v === "string" && v ? v.slice(0, 100) : null);
  return { mic: !!s.mic, deaf: !!s.deaf, cam: streamId(s.cam), screen: streamId(s.screen) };
}

function sendUsers() {
  io.emit("users", [...new Set(online.values())].sort());
  sendProfiles();
}

// Cor do nome (guardada) + status (de quem esta online)
function sendProfiles() {
  const out = {};
  for (const [k, p] of Object.entries(profiles)) out[k] = { color: p.color, status: "offline" };
  for (const [id, nick] of online) {
    const k = keyOf(nick);
    out[k] = { ...(out[k] || {}), status: statuses.get(id) || "online" };
  }
  io.emit("profiles", out);
}

function blockedUntil(map, key) {
  const until = map.get(key);
  if (!until) return 0;
  if (until <= Date.now()) { map.delete(key); return 0; }
  return until;
}
const minutesLeft = (until) => Math.max(1, Math.ceil((until - Date.now()) / 60000));

// Snippet da mensagem respondida, para mostrar a citacao
function quoteOf(id) {
  const m = history.find((x) => x.id === Number(id));
  if (!m || m.type === "sys") return null;
  const text = m.type === "img" ? "[foto]" : m.type === "audio" ? "[audio]" : m.text.slice(0, 90);
  return { id: m.id, nick: m.nick, text };
}

io.on("connection", (socket) => {
  socket.emit("avatars", avatars);
  socket.emit("history", history);
  socket.emit("call:members", [...callMembers.values()]);
  socket.emit("ice", ICE_SERVERS);
  socket.emit("watch:state", watchMsg());
  sendUsers();
  poker.handle(socket);
  truco.handle(socket);

  const addr = clientAddress(socket);
  const nickNow = () => online.get(socket.id);
  const isAdmin = () => admins.has(socket.id);
  const notice = (text) => socket.emit("notice", text);

  socket.on("join", (nick, reply) => {
    nick = cleanNick(nick);
    if (!nick) return reply && reply({ ok: false, error: "Apelido vazio." });
    const ban = Math.max(blockedUntil(bans, keyOf(nick)), blockedUntil(bans, "ip:" + addr));
    if (ban) return reply && reply({ ok: false, error: "Voce foi expulso pelo ADM. Volte em " + minutesLeft(ban) + " min.", kicked: true });
    const taken = [...online.entries()].some(([id, n]) => id !== socket.id && keyOf(n) === keyOf(nick));
    if (taken) return reply && reply({ ok: false, error: "Esse apelido ja esta em uso." });
    const old = online.get(socket.id);
    online.set(socket.id, nick);
    reply && reply({ ok: true, nick });
    if (old && old !== nick) sys(`${old} agora se chama ${nick}`);
    sendUsers();
    if (callMembers.has(socket.id)) { callMembers.get(socket.id).nick = nick; sendCall(); }
    if (old && old !== nick) { poker.rename(old, nick); truco.rename(old, nick); }
    poker.broadcast();
    truco.broadcast();
    poker.refresh();
  });

  // ---------- anti-flood ----------
  const flood = { times: [], last: "", lastAt: 0, repeats: 0, strikes: [] };
  function floodCheck(text) {
    const now = Date.now();
    flood.times = flood.times.filter((t) => now - t < 5000);
    let why = null;
    const lines = text.split("\n");
    const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
    if (flood.times.length >= 5) why = "Calma! Muitas mensagens seguidas. Espere uns segundos.";
    else if (lines.length > MAX_LINES) why = "Mensagem com linhas demais (maximo " + MAX_LINES + ").";
    else if (lines.length >= 4 && new Set(lines.map((l) => l.trim())).size === 1) why = "Nada de repetir a mesma linha varias vezes.";
    else if (norm === flood.last && now - flood.lastAt < 30000 && flood.repeats >= 1) why = "Voce ja mandou essa mensagem.";
    if (why) {
      flood.strikes = flood.strikes.filter((t) => now - t < 60000);
      flood.strikes.push(now);
      // insistiu 4 vezes em 1 minuto: fica 2 minutos sem poder mandar mensagem
      if (flood.strikes.length >= 4) {
        mutes.set(keyOf(nickNow()), now + 2 * 60000);
        floodMuted.add(keyOf(nickNow()));
        flood.strikes = [];
        sys(nickNow() + " foi silenciado por 2 min (flood)");
        return "Voce foi silenciado por 2 min por flood.";
      }
      return why;
    }
    flood.repeats = norm === flood.last && now - flood.lastAt < 30000 ? flood.repeats + 1 : 0;
    flood.last = norm; flood.lastAt = now;
    flood.times.push(now);
    return null;
  }

  // Confere se pode mandar algo no chat (apelido, silenciado, flood)
  function canPost(text) {
    const nick = nickNow();
    if (!nick) return null;
    const muted = blockedUntil(mutes, keyOf(nick));
    if (muted) { notice("Voce esta silenciado " + (floodMuted.has(keyOf(nick)) ? "por flood" : "pelo ADM") + " por mais " + minutesLeft(muted) + " min."); return null; }
    const err = floodCheck(text);
    if (err) { notice(err); return null; }
    return nick;
  }

  socket.on("message", (msg) => {
    const raw = typeof msg === "string" ? msg : msg && msg.text;
    const text = String(raw || "").replace(/\r/g, "").trim().slice(0, MAX_TEXT);
    if (!text) return;
    const nick = canPost(text);
    if (!nick) return;
    const reply = msg && typeof msg === "object" && msg.replyTo ? quoteOf(msg.replyTo) : null;
    pushMessage({ type: "msg", nick, text, ts: Date.now(), reply: reply || undefined });
  });

  socket.on("image", (data, replyTo) => {
    if (typeof data !== "string" || data.length > MAX_IMAGE || !IMAGE_RE.test(data)) return;
    const nick = canPost("[foto " + Date.now() + "]");
    if (!nick) return;
    pushMessage({ type: "img", nick, src: data, ts: Date.now(), reply: quoteOf(replyTo) || undefined });
  });

  socket.on("audio", (data, replyTo) => {
    if (typeof data !== "string" || data.length > MAX_AUDIO || !AUDIO_RE.test(data)) return notice("Audio muito grande ou invalido (maximo 1 minuto).");
    const nick = canPost("[audio " + Date.now() + "]");
    if (!nick) return;
    pushMessage({ type: "audio", nick, src: data, ts: Date.now(), reply: quoteOf(replyTo) || undefined });
  });

  // Reacao: clicar de novo tira a sua
  socket.on("react", (msg) => {
    const nick = nickNow();
    if (!nick || !msg || !REACTIONS.includes(msg.emoji)) return;
    if (blockedUntil(mutes, keyOf(nick))) return notice("Voce esta silenciado pelo ADM.");
    const m = history.find((x) => x.id === Number(msg.id));
    if (!m || m.type === "sys") return;
    m.reactions = m.reactions || {};
    const who = m.reactions[msg.emoji] || [];
    const i = who.indexOf(nick);
    if (i >= 0) who.splice(i, 1); else who.push(nick);
    if (who.length) m.reactions[msg.emoji] = who; else delete m.reactions[msg.emoji];
    io.emit("message:update", { id: m.id, reactions: m.reactions });
    persist();
  });

  // Apagar: a propria mensagem, ou qualquer uma se for ADM
  socket.on("delete", (id) => {
    const nick = nickNow();
    const m = history.find((x) => x.id === Number(id));
    if (!nick || !m) return;
    if (!isAdmin() && !(m.nick && keyOf(m.nick) === keyOf(nick))) return;
    dropMessages([m]);
    io.emit("message:delete", m.id);
    persist();
  });

  let lastTyping = 0;
  socket.on("typing", () => {
    const nick = nickNow();
    const now = Date.now();
    if (!nick || now - lastTyping < 1500) return;
    lastTyping = now;
    socket.broadcast.emit("typing", nick);
  });

  socket.on("profile", (p) => {
    const nick = nickNow();
    if (!nick || !p || typeof p !== "object") return;
    const k = keyOf(nick);
    if (NAME_COLORS.includes(p.color)) profiles[k] = { ...(profiles[k] || {}), color: p.color };
    if (STATUSES.includes(p.status)) statuses.set(socket.id, p.status);
    sendProfiles();
    persist();
  });

  socket.on("avatar", (data) => {
    const nick = nickNow();
    if (!nick || typeof data !== "string") return;
    if (data.length > MAX_AVATAR || !IMAGE_RE.test(data)) return;
    const key = keyOf(nick);
    delete avatars[key]; // reinsere no fim para a ordem refletir o uso recente
    avatars[key] = data;
    const keys = Object.keys(avatars);
    if (keys.length > MAX_AVATARS_KEPT) delete avatars[keys[0]];
    io.emit("avatar", { nick: key, src: data });
    persist();
  });

  // ---------- ADM ----------
  socket.on("admin:login", (password, reply) => {
    if (typeof reply !== "function") return;
    if (!ADMIN_PASSWORD) return reply({ ok: false, error: "O ADM ainda nao foi configurado no servidor." });
    const now = Date.now();
    const fail = failedLogins.get(addr);
    if (fail && fail.count >= LOGIN_TRIES && fail.until > now) {
      return reply({ ok: false, error: "Muitas tentativas erradas. Espere " + Math.ceil((fail.until - now) / 60000) + " min." });
    }
    if (String(password) !== ADMIN_PASSWORD) {
      const f = fail && fail.until > now ? fail : { count: 0, until: now + 10 * 60000 };
      f.count++;
      failedLogins.set(addr, f);
      return reply({ ok: false, error: "Senha errada." });
    }
    failedLogins.delete(addr);
    admins.add(socket.id);
    reply({ ok: true });
    poker.broadcast();
    truco.broadcast();
    sendModeration();
  });

  socket.on("admin:logout", () => {
    admins.delete(socket.id);
    poker.broadcast();
    truco.broadcast();
  });

  // Lista de quem esta silenciado/expulso, so para os ADMs
  function sendModeration() {
    const list = (map) => [...map.entries()].filter(([, until]) => until > Date.now()).map(([k, until]) => ({ key: k, min: minutesLeft(until) })).filter((x) => !x.key.startsWith("ip:"));
    const data = { muted: list(mutes), banned: list(bans) };
    for (const id of admins) io.to(id).emit("admin:moderation", data);
  }

  socket.on("admin:clear", () => {
    if (!isAdmin()) return;
    dropMessages([...history]);
    io.emit("history", history);
    sys("O ADM limpou o chat");
  });

  socket.on("admin:mute", (msg) => {
    if (!isAdmin() || !msg) return;
    const k = keyOf(cleanNick(msg.nick));
    const min = Math.min(24 * 60, Math.max(0, Number(msg.minutes) || 0));
    if (!k || k === keyOf(nickNow() || "")) return;
    floodMuted.delete(k);
    if (min) { mutes.set(k, Date.now() + min * 60000); sys(msg.nick + " foi silenciado pelo ADM por " + min + " min"); }
    else if (mutes.delete(k)) sys(msg.nick + " pode falar de novo");
    sendModeration();
  });

  socket.on("admin:kick", (msg) => {
    if (!isAdmin() || !msg) return;
    const k = keyOf(cleanNick(msg.nick));
    const min = Math.min(24 * 60, Math.max(0, Number(msg.minutes) || 0));
    if (!k || k === keyOf(nickNow() || "")) return;
    if (!min) return;
    const until = Date.now() + min * 60000;
    bans.set(k, until);
    for (const [id, n] of online) {
      if (keyOf(n) !== k) continue;
      const s = io.sockets.sockets.get(id);
      if (!s) continue;
      bans.set("ip:" + clientAddress(s), until); // trocar de apelido nao adianta
      s.emit("kicked", min);
      setTimeout(() => s.disconnect(true), 200);
    }
    sys(msg.nick + " foi expulso pelo ADM por " + min + " min");
    sendModeration();
  });

  socket.on("admin:unban", (key) => {
    if (!isAdmin()) return;
    const k = keyOf(String(key || ""));
    const until = bans.get(k);
    bans.delete(k);
    // libera tambem o endereco que foi bloqueado junto
    for (const [bk, bu] of [...bans]) if (bk.startsWith("ip:") && bu === until) bans.delete(bk);
    sendModeration();
  });

  // ---------- call ----------
  socket.on("call:join", (state, reply) => {
    const nick = nickNow();
    if (!nick || typeof reply !== "function") return;
    const others = [...callMembers.keys()].filter((id) => id !== socket.id);
    callMembers.set(socket.id, { id: socket.id, nick, ...cleanCallState(state) });
    reply({ ok: true, others });
    sendCall();
  });

  socket.on("call:state", (state) => {
    const member = callMembers.get(socket.id);
    if (!member) return;
    Object.assign(member, cleanCallState(state));
    sendCall();
  });

  socket.on("call:signal", (msg) => {
    if (!msg || !callMembers.has(socket.id) || !callMembers.has(msg.to)) return;
    if (JSON.stringify(msg).length > 100 * 1024) return;
    io.to(msg.to).emit("call:signal", { from: socket.id, description: msg.description, candidate: msg.candidate });
  });

  // Soundboard: som curto que toca para todo mundo da call
  let lastSfx = 0;
  socket.on("call:sfx", (name) => {
    const member = callMembers.get(socket.id);
    const now = Date.now();
    if (!member || !SFX.includes(name) || now - lastSfx < 2500) return;
    lastSfx = now;
    for (const id of callMembers.keys()) io.to(id).emit("call:sfx", { name, nick: member.nick });
  });

  // Assistir junto: um video do YouTube sincronizado para a call
  socket.on("watch:set", (url) => {
    const member = callMembers.get(socket.id);
    const m = String(url || "").match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/) || String(url || "").match(/^([A-Za-z0-9_-]{11})$/);
    if (!member) return;
    if (!m) return notice("Esse link nao parece ser do YouTube.");
    watch = { id: m[1], playing: true, pos: 0, at: Date.now(), by: member.nick };
    io.emit("watch:state", watchMsg());
  });

  socket.on("watch:control", (msg) => {
    const member = callMembers.get(socket.id);
    if (!member || !watch || !msg) return;
    const pos = Math.max(0, Number(msg.pos) || 0);
    if (msg.action === "play") Object.assign(watch, { playing: true, pos, at: Date.now() });
    else if (msg.action === "pause") Object.assign(watch, { playing: false, pos, at: Date.now() });
    else if (msg.action === "seek") Object.assign(watch, { pos, at: Date.now() });
    else return;
    watch.by = member.nick;
    io.emit("watch:state", watchMsg());
  });

  socket.on("watch:stop", () => {
    if (!callMembers.has(socket.id) || !watch) return;
    watch = null;
    io.emit("watch:state", null);
  });

  function leaveCall() {
    const member = callMembers.get(socket.id);
    if (!member) return;
    callMembers.delete(socket.id);
    sendCall();
  }
  socket.on("call:leave", leaveCall);

  socket.on("disconnect", () => {
    leaveCall();
    admins.delete(socket.id);
    statuses.delete(socket.id);
    const nick = online.get(socket.id);
    if (!nick) return;
    online.delete(socket.id);
    sendUsers();
    poker.left(nick);
    truco.left(nick);
  });
});

async function start() {
  if (storage) {
    try {
      const saved = await storage.load();
      history = saved.history;
      avatars = saved.avatars;
      profiles = saved.profiles;
      nextId = Math.max(saved.nextId, ...history.map((m) => m.id + 1), 1);
      console.log(`Chat carregado do Supabase: ${history.length} mensagens`);
    } catch (e) {
      console.error("Nao deu para carregar o chat salvo (seguindo so na memoria):", e.message);
    }
  } else {
    console.log("Sem SUPABASE_URL/SUPABASE_SECRET_KEY: o chat fica so na memoria");
  }
  server.listen(PORT, () => console.log(`Chat Pedro rodando na porta ${PORT}`));
}
start();

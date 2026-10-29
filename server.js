const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { createPoker } = require("./poker");
const { createTruco } = require("./truco");

const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 200; // quantas mensagens ficam guardadas na memoria
const MAX_TEXT = 2000;
const MAX_NICK = 20;
const MAX_IMAGE = 3 * 1024 * 1024; // tamanho maximo da foto (ja comprimida) em bytes de texto
const MAX_IMAGES_KEPT = 40; // fotos mais antigas que isso saem do historico para nao lotar a memoria
const IMAGE_RE = /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_AVATAR = 60 * 1024; // foto de perfil ja vem pequena (48x48) do navegador
const MAX_AVATARS_KEPT = 200;
// Senha do ADM: fica nas variaveis de ambiente do Render (o codigo no GitHub e publico).
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const LOGIN_TRIES = 5; // tentativas erradas por endereco a cada 10 minutos

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: MAX_IMAGE + 64 * 1024 });

app.use(express.static(path.join(__dirname, "public")));

// Historico em memoria: some quando o servidor reinicia.
const history = [];
const online = new Map(); // socket.id -> apelido
const avatars = new Map(); // apelido em minusculas -> foto de perfil
// Chamada: o servidor so guarda quem esta nela e repassa os sinais de conexao.
// Audio e video vao direto de navegador para navegador (WebRTC).
const callMembers = new Map(); // socket.id -> { id, nick, mic, deaf, cam, screen }
const admins = new Set(); // socket.id de quem entrou com a senha de ADM
const failedLogins = new Map(); // endereco -> { count, until }

function cleanNick(nick) {
  return String(nick || "").replace(/\s+/g, " ").trim().slice(0, MAX_NICK);
}

function pushMessage(msg) {
  history.push(msg);
  if (history.length > MAX_HISTORY) history.shift();
  const images = history.filter((m) => m.type === "img");
  if (images.length > MAX_IMAGES_KEPT) history.splice(history.indexOf(images[0]), 1);
  io.emit("message", msg);
}

const poker = createPoker(io, {
  nickOf: (id) => online.get(id),
  isAdmin: (id) => admins.has(id),
});

const truco = createTruco(io, {
  nickOf: (id) => online.get(id),
  isAdmin: (id) => admins.has(id),
});

function clientAddress(socket) {
  const fwd = socket.handshake.headers["x-forwarded-for"]; // o Render fica na frente do servidor
  return (fwd ? String(fwd).split(",")[0] : socket.handshake.address).trim();
}

function sendCall() {
  io.emit("call:members", [...callMembers.values()]);
}

function cleanCallState(s) {
  s = s && typeof s === "object" ? s : {};
  const streamId = (v) => (typeof v === "string" && v ? v.slice(0, 100) : null);
  return { mic: !!s.mic, deaf: !!s.deaf, cam: streamId(s.cam), screen: streamId(s.screen) };
}

function sendUsers() {
  io.emit("users", [...new Set(online.values())].sort());
}

io.on("connection", (socket) => {
  socket.emit("avatars", Object.fromEntries(avatars));
  socket.emit("history", history);
  socket.emit("call:members", [...callMembers.values()]);
  sendUsers();
  poker.handle(socket);
  truco.handle(socket);

  socket.on("join", (nick, reply) => {
    nick = cleanNick(nick);
    if (!nick) return reply && reply({ ok: false, error: "Apelido vazio." });
    const taken = [...online.entries()].some(([id, n]) => id !== socket.id && n.toLowerCase() === nick.toLowerCase());
    if (taken) return reply && reply({ ok: false, error: "Esse apelido ja esta em uso." });
    const old = online.get(socket.id);
    online.set(socket.id, nick);
    reply && reply({ ok: true, nick });
    if (old && old !== nick) pushMessage({ type: "sys", text: `${old} agora se chama ${nick}`, ts: Date.now() });
    sendUsers();
    if (callMembers.has(socket.id)) { callMembers.get(socket.id).nick = nick; sendCall(); }
    if (old && old !== nick) { poker.rename(old, nick); truco.rename(old, nick); }
    poker.broadcast();
    truco.broadcast();
    poker.refresh();
  });

  let lastSent = 0;
  socket.on("message", (text) => {
    const nick = online.get(socket.id);
    if (!nick) return;
    text = String(text || "").trim().slice(0, MAX_TEXT);
    if (!text) return;
    const now = Date.now();
    if (now - lastSent < 300) return; // evita flood
    lastSent = now;
    pushMessage({ type: "msg", nick, text, ts: now });
  });

  socket.on("image", (data) => {
    const nick = online.get(socket.id);
    if (!nick || typeof data !== "string") return;
    if (data.length > MAX_IMAGE || !IMAGE_RE.test(data)) return;
    const now = Date.now();
    if (now - lastSent < 1000) return;
    lastSent = now;
    pushMessage({ type: "img", nick, src: data, ts: now });
  });

  socket.on("avatar", (data) => {
    const nick = online.get(socket.id);
    if (!nick || typeof data !== "string") return;
    if (data.length > MAX_AVATAR || !IMAGE_RE.test(data)) return;
    const key = nick.toLowerCase();
    avatars.delete(key); // reinsere no fim para a ordem refletir o uso recente
    avatars.set(key, data);
    if (avatars.size > MAX_AVATARS_KEPT) avatars.delete(avatars.keys().next().value);
    io.emit("avatar", { nick: key, src: data });
  });

  socket.on("admin:login", (password, reply) => {
    if (typeof reply !== "function") return;
    if (!ADMIN_PASSWORD) return reply({ ok: false, error: "O ADM ainda nao foi configurado no servidor." });
    const addr = clientAddress(socket);
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
  });

  socket.on("admin:logout", () => {
    admins.delete(socket.id);
    poker.broadcast();
  });

  socket.on("call:join", (state, reply) => {
    const nick = online.get(socket.id);
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
    const nick = online.get(socket.id);
    if (!nick) return;
    online.delete(socket.id);
    sendUsers();
    poker.left(nick);
    truco.left(nick);
  });
});

server.listen(PORT, () => console.log(`Chat Pedro rodando na porta ${PORT}`));

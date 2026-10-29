const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 200; // quantas mensagens ficam guardadas na memoria
const MAX_TEXT = 2000;
const MAX_NICK = 20;
const MAX_IMAGE = 3 * 1024 * 1024; // tamanho maximo da foto (ja comprimida) em bytes de texto
const MAX_IMAGES_KEPT = 40; // fotos mais antigas que isso saem do historico para nao lotar a memoria
const IMAGE_RE = /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: MAX_IMAGE + 64 * 1024 });

app.use(express.static(path.join(__dirname, "public")));

// Historico em memoria: some quando o servidor reinicia.
const history = [];
const online = new Map(); // socket.id -> apelido

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

function sendUsers() {
  io.emit("users", [...new Set(online.values())].sort());
}

io.on("connection", (socket) => {
  socket.emit("history", history);
  sendUsers();

  socket.on("join", (nick, reply) => {
    nick = cleanNick(nick);
    if (!nick) return reply && reply({ ok: false, error: "Apelido vazio." });
    const taken = [...online.entries()].some(([id, n]) => id !== socket.id && n.toLowerCase() === nick.toLowerCase());
    if (taken) return reply && reply({ ok: false, error: "Esse apelido ja esta em uso." });
    const old = online.get(socket.id);
    online.set(socket.id, nick);
    reply && reply({ ok: true, nick });
    pushMessage({ type: "sys", text: old ? `${old} agora se chama ${nick}` : `${nick} entrou no chat`, ts: Date.now() });
    sendUsers();
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

  socket.on("disconnect", () => {
    const nick = online.get(socket.id);
    if (!nick) return;
    online.delete(socket.id);
    pushMessage({ type: "sys", text: `${nick} saiu do chat`, ts: Date.now() });
    sendUsers();
  });
});

server.listen(PORT, () => console.log(`Chat Pedro rodando na porta ${PORT}`));

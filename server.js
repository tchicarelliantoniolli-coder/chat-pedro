const path = require("path");
const http = require("http");
const https = require("https");
const dns = require("dns");
const net = require("net");
const crypto = require("crypto");
const express = require("express");
const compression = require("compression");
const { Server } = require("socket.io");
const { createPoker } = require("./poker");
const { createTruco } = require("./truco");
const { createBlefe } = require("./blefe");
const { createStorage, cleanupExpired } = require("./storage");
const { db, auth, ready, SUPABASE_URL, PUBLISHABLE_KEY } = require("./db");

const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 200; // quantas mensagens ficam guardadas por servidor
const MAX_TEXT = 2000;
const MAX_LINES = 12;
const MAX_NICK = 20;
const MAX_SERVER_NAME = 40;
const MAX_SERVERS_OWNED = 10;
const MAX_IMAGE = 1.1 * 1024 * 1024; // tamanho maximo da foto (ja comprimida pelo navegador, ate 1 MB) em bytes de texto
const MAX_AUDIO = 1.5 * 1024 * 1024; // audio de ate ~1 minuto
const MAX_MEDIA_KEPT = 40; // fotos e audios mais antigos que isso saem do historico
const IMAGE_RE = /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const AUDIO_RE = /^data:audio\/(webm|ogg|mp4|mpeg|aac)(;codecs=[A-Za-z0-9.,=-]+)?;base64,[A-Za-z0-9+/=]+$/;
const MAX_FILE = 2.8 * 1024 * 1024; // arquivo qualquer de ate ~2 MB (em base64)
const FILE_RE = /^data:[\w.+-]+\/[\w.+-]+(;[\w=.+-]+)*;base64,[A-Za-z0-9+/=]+$/;
// qualquer emoji (inclusive com tom de pele, bandeiras e combinacoes)
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\u20e3)+$/u;
const MAX_CHANNELS = 30;
const SLOW_STEPS = [0, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
const MAX_SERVER_ICON = 120 * 1024; // foto do servidor ja vem pequena (96x96) do navegador
const MAX_AVATAR = 60 * 1024; // foto de perfil ja vem pequena (48x48) do navegador
const REACTIONS = ["\u{1F602}", "\u{1F525}", "\u{1F480}", "\u{1F44D}", "\u2764\uFE0F", "\u{1F62E}"];
const NAME_COLORS = ["#33ff66", "#b6ffc8", "#ffd84d", "#ffb000", "#ff7a59", "#ff5fa2", "#c792ff", "#5fd7ff", "#7aa2ff", "#e6e6e6"];
const STATUSES = ["online", "ausente", "ocupado", "invisivel"];
const INVITE_HOURS = [1, 24, 168, 0]; // 0 = nunca vence
// permissoes dos cargos personalizados (dono e ADM tem todas)
const PERMS = ["channels", "messages", "members", "ban", "server", "roles", "everyone"];
const MAX_ROLES = 20;
const MAX_THREADS = 100;
const MAX_EMOJIS = 50;
const MAX_STICKERS = 30;
const MAX_EMOJI_IMG = 16 * 1024;    // emoji do servidor (64x64)
const MAX_STICKER_IMG = 160 * 1024; // figurinha (ate 320x320)
const MAX_BANNER = 300 * 1024;      // banner do servidor
const CUSTOM_EMOJI_RE = /^<:([A-Za-z0-9_]{2,32}):([a-f0-9]{10})>$/;
const INVITE_CODE_RE = /^[A-Za-z0-9_-]{3,32}$/;
const DECORATIONS = ["", "fogo", "neon", "arco-iris", "ouro", "gelo", "coracoes"];
const CONNECTION_TYPES = ["steam", "instagram", "youtube", "twitch", "spotify", "github", "x", "tiktok", "xbox", "playstation", "epic", "riot"];
// modelos de servidor (canais que ja vem prontos)
const TEMPLATES = {
  amigos: [["geral", "text"], ["memes", "text"], ["fotos", "text"], ["Call", "voice"], ["Jogando", "voice"]],
  jogos: [["avisos", "text", { announce: true }], ["geral", "text"], ["procurando-time", "text"], ["dicas", "forum"], ["Lobby", "voice"], ["Partida 1", "voice"], ["Partida 2", "voice"]],
  estudos: [["avisos", "text", { announce: true }], ["geral", "text"], ["duvidas", "forum"], ["Sala de estudo", "voice"], ["Aula", "voice", { stage: true }]],
  comunidade: [["regras", "text", { announce: true }], ["boas-vindas", "text"], ["geral", "text"], ["sugestoes", "forum"], ["Bate-papo", "voice"], ["Palco", "voice", { stage: true }]],
};
const newId = () => crypto.randomBytes(5).toString("hex");
function templateChannels(name) {
  const t = TEMPLATES[name];
  if (!t) return null;
  return t.map(([n, type, extra]) => ({ id: newId(), name: n, type, ...(type === "text" ? { topic: "", slow: 0 } : {}), ...(type === "forum" ? { topic: "" } : {}), ...(extra || {}) }));
}

// Servidores para a call atravessar redes chatas (4G, escola, empresa). O TURN e opcional e vem do Render.
const ICE_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
if (process.env.TURN_URLS) {
  ICE_SERVERS.push({
    urls: process.env.TURN_URLS.split(",").map((u) => u.trim()).filter(Boolean),
    username: process.env.TURN_USERNAME || "",
    credential: process.env.TURN_CREDENTIAL || "",
  });
}
// TURN da Cloudflare (gratis ate 1 TB por mes): o servidor pede senhas temporarias e renova a cada 12 h
let cfIce = null, cfIceAt = 0;
async function iceServers() {
  const id = process.env.CF_TURN_KEY_ID, token = process.env.CF_TURN_API_TOKEN;
  if (!id || !token) return ICE_SERVERS;
  if (!cfIce || Date.now() - cfIceAt > 12 * 3600 * 1000) {
    try {
      const r = await fetch("https://rtc.live.cloudflare.com/v1/turn/keys/" + encodeURIComponent(id) + "/credentials/generate-ice-servers", {
        method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 86400 }), signal: AbortSignal.timeout(5000),
      });
      const j = await r.json();
      const list = Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : [];
      if (!r.ok || !list.length) throw new Error("resposta " + r.status);
      cfIce = list; cfIceAt = Date.now();
    } catch (e) { console.error("TURN da Cloudflare:", e.message); if (!cfIce) return ICE_SERVERS; }
  }
  return [...ICE_SERVERS, ...cfIce];
}

const app = express();
const server = http.createServer(app);
// perMessageDeflate compacta as mensagens grandes (historico, listas); as pequenas vao como estao
const io = new Server(server, { maxHttpBufferSize: Math.max(MAX_IMAGE, MAX_FILE, MAX_AUDIO) + 64 * 1024, serveClient: false, perMessageDeflate: { threshold: 2048 } });
const INDEX = path.join(__dirname, "public", "index.html");

app.set("trust proxy", true); // o Render fica na frente do servidor
app.use(compression()); // texto do site vai compactado (gzip): carrega varias vezes mais rapido
app.use(express.json({ limit: "200kb" }));
// os arquivos do site sao conferidos a cada visita (ETag): se nao mudaram, o navegador usa o que ja tem
app.use(express.static(path.join(__dirname, "public"), { cacheControl: true, maxAge: 0 }));
// bibliotecas com versao fixa: o navegador guarda por 7 dias sem perguntar de novo
const vendor = (dir) => express.static(dir, { maxAge: "7d" });
app.use("/vendor/supabase", vendor(path.join(__dirname, "node_modules", "@supabase", "supabase-js", "dist", "umd")));
app.use("/vendor/socket.io", vendor(path.join(__dirname, "node_modules", "socket.io", "client-dist")));
// 3D da Mesa do Blefe: so e baixado quando alguem abre a mesa
app.use("/vendor/three", vendor(path.join(__dirname, "node_modules", "three", "build")));
app.get(["/s/:id", "/convite/:code"], (req, res) => res.sendFile(INDEX));

const keyOf = (nick) => String(nick || "").toLowerCase();
const isMedia = (m) => m.type === "img" || m.type === "audio" || m.type === "file";
const chOf = (m) => m.ch || "chat"; // mensagens antigas (de antes dos canais) ficam no #chat
const DEFAULT_CHANNELS = () => [
  { id: "chat", name: "chat", type: "text", topic: "", slow: 0 },
  { id: "call", name: "Call", type: "voice" },
];
const minutesLeft = (until) => Math.max(1, Math.ceil((until - Date.now()) / 60000));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanNick(nick) {
  return String(nick || "").replace(/\s+/g, " ").trim().slice(0, MAX_NICK);
}
// estes caracteres atrapalham a busca no banco e confundem as @mencoes
const NICK_BAD = /[*%_,()"\\:@<>]/;

// ---------- contas ----------
const profileCache = new Map(); // id da conta -> { id, nick, avatar, color }
async function getProfiles(ids) {
  const missing = [...new Set(ids)].filter((id) => !profileCache.has(id));
  if (missing.length) {
    const rows = await db.select("profiles", { select: "id,nick,avatar,color,status_text,bio,banner,decoration,connections", id: db.inList(missing) });
    for (const r of rows) profileCache.set(r.id, r);
  }
  return ids.map((id) => profileCache.get(id)).filter(Boolean);
}
const getProfile = async (id) => (await getProfiles([id]))[0] || null;

const tokenCache = new Map(); // token -> { user, until }
async function userFromToken(token) {
  if (!token || typeof token !== "string") return null;
  const hit = tokenCache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  try {
    const u = await auth.getUser(token);
    // conta com verificacao em 2 etapas: o token precisa ter passado pelo codigo (aal2)
    const mfa = Array.isArray(u.factors) && u.factors.some((f) => f.status === "verified");
    let aal = null;
    try { aal = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).aal; } catch {}
    const user = { id: u.id, email: u.email, mfa, needCode: mfa && aal !== "aal2" };
    tokenCache.set(token, { user, until: Date.now() + 60000 });
    if (tokenCache.size > 2000) tokenCache.delete(tokenCache.keys().next().value);
    return user;
  } catch {
    return null;
  }
}

async function nickTaken(nick, exceptId) {
  const rows = await db.select("profiles", { select: "id", nick: "ilike." + nick });
  return rows.some((r) => r.id !== exceptId);
}

async function membership(serverId, userId) {
  const rows = await db.select("server_members", { select: "role", server_id: "eq." + serverId, user_id: "eq." + userId });
  return rows[0] ? rows[0].role : null;
}

async function activeBan(serverId, userId) {
  const rows = await db.select("server_bans", { select: "until", server_id: "eq." + serverId, user_id: "eq." + userId });
  const b = rows[0];
  if (!b) return null;
  if (b.until && Date.parse(b.until) <= Date.now()) { db.remove("server_bans", { server_id: "eq." + serverId, user_id: "eq." + userId }).catch(() => {}); return null; }
  return b;
}

// ---------- cada servidor e um mundo separado: chat, call, poker, truco e moderacao ----------
const contexts = new Map(); // id do servidor -> Promise<ctx>

function getCtx(serverId) {
  if (!contexts.has(serverId)) contexts.set(serverId, buildCtx(serverId).catch((e) => { contexts.delete(serverId); throw e; }));
  return contexts.get(serverId);
}

async function buildCtx(serverId) {
  const [srv] = await db.select("servers", { select: "id,name,owner_id,icon,dm,public,description", id: "eq." + serverId });
  if (!srv) throw new Error("servidor não existe");
  const ctx = {
    id: serverId, name: srv.name, icon: srv.icon || null, ownerId: srv.owner_id, room: "srv:" + serverId, dm: !!srv.dm,
    channels: DEFAULT_CHANNELS(), automod: { words: [] }, audit: [], events: [],
    isPublic: !!srv.public, description: srv.description || "",
    roles: [], memberRoles: {}, nicks: {}, emojis: [], stickers: [], webhooks: [], welcome: { desc: "", rules: [] }, banner: null, vanity: null,
    memberIds: new Set(),
    history: [], nextId: 1, storage: createStorage(serverId),
    sockets: new Map(),     // socket.id -> socket (so deste servidor)
    online: new Map(),      // socket.id -> apelido
    statuses: new Map(),    // socket.id -> online | ausente | ocupado
    callMembers: new Map(), // socket.id -> { id, nick, mic, deaf, cam, screen }
    watch: null,            // video do YouTube que a call esta assistindo junto
    mutes: new Map(),       // id da conta -> silenciado ate
    floodMuted: new Set(),  // quem foi silenciado pelo anti-flood (e nao pela moderacao)
    members: [],            // [{ id, nick, avatar, color, role }]
    dead: false,
  };
  if (ctx.storage) {
    try {
      const saved = await ctx.storage.load();
      ctx.history = saved.history;
      ctx.nextId = Math.max(saved.nextId, ...ctx.history.map((m) => m.id + 1), 1);
    } catch (e) {
      console.error("Não deu para carregar o chat do servidor " + serverId + ":", e.message);
    }
    try {
      const meta = await ctx.storage.loadMeta();
      if (Array.isArray(meta.channels) && meta.channels.some((c) => c.type === "text")) ctx.channels = meta.channels;
      if (meta.automod && Array.isArray(meta.automod.words)) ctx.automod = meta.automod;
      if (Array.isArray(meta.audit)) ctx.audit = meta.audit;
      if (Array.isArray(meta.events)) ctx.events = meta.events;
      for (const n of ["roles", "emojis", "stickers", "webhooks"]) if (Array.isArray(meta[n])) ctx[n] = meta[n];
      for (const n of ["memberRoles", "nicks", "welcome"]) if (meta[n] && typeof meta[n] === "object") ctx[n] = meta[n];
      if (typeof meta.banner === "string") ctx.banner = meta.banner;
      if (typeof meta.vanity === "string") ctx.vanity = meta.vanity;
      // silenciados continuam silenciados depois que o Render dorme e acorda
      if (meta.mutes && typeof meta.mutes === "object") for (const [id, until] of Object.entries(meta.mutes)) if (Number(until) > Date.now()) ctx.mutes.set(id, Number(until));
    } catch (e) {
      console.error("Não deu para carregar os canais do servidor " + serverId + ":", e.message);
    }
  }
  // os jogos enxergam so quem esta neste servidor
  const scopedIo = { sockets: { sockets: ctx.sockets }, emit: (ev, data) => io.to(ctx.room).emit(ev, data) };
  const helpers = {
    nickOf: (id) => ctx.online.get(id),
    isAdmin: (id) => { const s = ctx.sockets.get(id); return !!s && ["owner", "admin"].includes(s.data.role); },
  };
  ctx.poker = createPoker(scopedIo, helpers);
  ctx.truco = createTruco(scopedIo, helpers);
  ctx.blefe = createBlefe(scopedIo, helpers);
  await loadMembers(ctx);
  return ctx;
}

async function loadMembers(ctx) {
  const rows = await db.select("server_members", { select: "user_id,role", server_id: "eq." + ctx.id });
  const profiles = await getProfiles(rows.map((r) => r.user_id));
  const byId = new Map(profiles.map((p) => [p.id, p]));
  ctx.members = rows.filter((r) => byId.has(r.user_id)).map((r) => ({ ...byId.get(r.user_id), role: r.role }));
  ctx.memberIds = new Set(ctx.members.map((m) => m.id));
}

// permissoes de alguem no servidor: dono e ADM tem todas; membro tem as dos cargos dele
function permsOf(ctx, uid, role) {
  if (role === "owner" || role === "admin") return new Set(PERMS);
  const out = new Set();
  for (const rid of ctx.memberRoles[uid] || []) { const r = ctx.roles.find((x) => x.id === rid); if (r) for (const p of r.perms) out.add(p); }
  return out;
}
const sockCan = (ctx, s, perm) => permsOf(ctx, s.data.user.id, s.data.role).has(perm);
// dados do servidor que todo mundo precisa (cargos, apelidos, emojis, figurinhas, boas-vindas)
function guildOf(ctx) {
  return {
    roles: ctx.roles, memberRoles: ctx.memberRoles, nicks: ctx.nicks, emojis: ctx.emojis,
    stickers: ctx.stickers.map((x) => ({ id: x.id, name: x.name })), welcome: ctx.welcome, vanity: ctx.vanity,
    isPublic: ctx.isPublic, description: ctx.description,
  };
}
const sendGuild = (ctx) => toRoom(ctx, "guild", guildOf(ctx));

const toRoom = (ctx, ev, data) => io.to(ctx.room).emit(ev, data);
const persist = (ctx) => ctx.storage && !ctx.dead && ctx.storage.saveSoon({ history: ctx.history, nextId: ctx.nextId });

function dropMessages(ctx, list) {
  if (!list.length) return;
  const gone = new Set(list);
  ctx.history = ctx.history.filter((m) => !gone.has(m));
  if (ctx.storage) ctx.storage.deleteMedia(list.filter(isMedia).map((m) => m.id));
}

function pushMessage(ctx, msg) {
  msg.id = ctx.nextId++;
  msg.ch = msg.ch || "chat";
  ctx.history.push(msg);
  if (ctx.storage && isMedia(msg)) ctx.storage.saveMedia(msg.id, msg.src);
  const old = [];
  // cada canal guarda as ultimas MAX_HISTORY mensagens
  const inCh = ctx.history.filter((m) => chOf(m) === msg.ch);
  if (inCh.length > MAX_HISTORY) old.push(inCh[0]);
  const media = ctx.history.filter(isMedia);
  if (media.length > MAX_MEDIA_KEPT) old.push(media[0]);
  dropMessages(ctx, old);
  toRoom(ctx, "message", msg);
  persist(ctx);
  if (msg.type === "sys") return;
  // topico: conta as respostas e mostra a ultima atividade
  const th = ctx.channels.find((c) => c.id === msg.ch && c.type === "thread");
  if (th) {
    th.count = (th.count || 0) + 1; th.last = msg.ts;
    toRoom(ctx, "thread:touch", { id: th.id, count: th.count, last: th.last });
    const root = th.msg && ctx.history.find((x) => x.id === th.msg);
    if (root) { root.thread = { id: th.id, name: th.name, count: th.count, last: th.last }; toRoom(ctx, "message:update", { id: root.id, thread: root.thread }); }
    saveMeta(ctx, "channels");
  }
  // mensagem direta: avisa a outra pessoa mesmo se ela estiver em outro servidor
  if (ctx.dm) { for (const m of ctx.members) if (m.id !== msg.uid) toUser(m.id, "dm:ping", { server: ctx.id, nick: msg.nick, text: msg.type === "msg" ? String(msg.text || "").slice(0, 120) : "" }, ctx); return; }
  // servidor: bolinha de "nao lido" (e contador de mencao) para quem esta com outro servidor aberto
  const text = msg.type === "msg" ? String(msg.text || "").toLowerCase() : "";
  const mentioned = (m) => msg.everyone || (text && text.includes("@" + m.nick.toLowerCase())) || (msg.reply && msg.reply.ping && msg.reply.uid === m.id);
  const byId = new Map(ctx.members.map((m) => [m.id, m]));
  for (const s of io.sockets.sockets.values()) {
    const u = s.data.user && s.data.user.id;
    if (!u || s.data.ctx === ctx || u === msg.uid || !byId.has(u)) continue;
    s.emit("srv:ping", { server: ctx.id, mention: !!mentioned(byId.get(u)) });
  }
}
// manda um evento para todas as abas abertas de uma conta (em qualquer servidor, menos o skip)
function toUser(uid, event, data, skip) {
  for (const s of io.sockets.sockets.values()) if (s.data.user && s.data.user.id === uid && s.data.ctx !== skip) s.emit(event, data);
}
// Historico sem o conteudo das fotos e audios (que sao pesados): o navegador pede cada um quando precisa
const historyFor = (ctx, ch) => ctx.history.filter((m) => chOf(m) === ch).map((m) => (isMedia(m) ? { ...m, src: undefined, lazy: true } : m));
const sys = (ctx, text, ch, extra) => pushMessage(ctx, { type: "sys", text, ts: Date.now(), ch: ch || (ctx.channels.find((c) => c.type === "text") || {}).id || "chat", ...(extra || {}) });
// canais onde da para mandar mensagem: texto e topicos (o forum so tem posts, que sao topicos)
const textChannel = (ctx, id) => ctx.channels.find((c) => c.id === id && (c.type === "text" || c.type === "thread"));
const voiceChannel = (ctx, id) => ctx.channels.find((c) => c.id === id && c.type === "voice");
const saveMeta = (ctx, name) => ctx.storage && !ctx.dead && ctx.storage.saveMeta(name, ctx[name]);
const sendChannels = (ctx) => toRoom(ctx, "channels", ctx.channels);
const saveMutes = (ctx) => ctx.storage && !ctx.dead && ctx.storage.saveMeta("mutes", Object.fromEntries([...ctx.mutes].filter(([, until]) => until > Date.now())));
// registro de moderacao (o que o dono e os ADMs fizeram)
function audit(ctx, by, action, target) {
  ctx.audit.unshift({ ts: Date.now(), by, action, target: target || "" });
  ctx.audit = ctx.audit.slice(0, 100);
  saveMeta(ctx, "audit");
}

const watchMsg = (ctx) => ctx.watch && { ...ctx.watch, now: Date.now() }; // "now" deixa cada um corrigir o proprio relogio

function sendCall(ctx) {
  toRoom(ctx, "call:members", [...ctx.callMembers.values()]);
  // o video junto acaba quando o canal de voz dele fica vazio
  if (ctx.watch && ![...ctx.callMembers.values()].some((m) => m.ch === ctx.watch.ch)) { ctx.watch = null; toRoom(ctx, "watch:state", null); }
}

// ---------- ligar na conversa privada (como no Discord) ----------
// Quem comeca a chamada numa DM (ou DM em grupo) faz tocar para os outros, em qualquer aba aberta do site.
// Para de tocar quando a pessoa entra, recusa ("Ignorar"), passa RING_MS ou a chamada acaba.
const RING_MS = 60000;
const ringingCtx = new Map(); // id da conversa -> ctx (conversas tocando agora)
const uidInCall = (ctx, uid) => [...ctx.callMembers.values()].some((m) => m.uid === uid);
const ringList = (ctx) => (ctx.ring ? [...ctx.ring.targets.keys()] : []);
const sendRinging = (ctx) => toRoom(ctx, "call:ringing", ringList(ctx));
function ringPayload(ctx) {
  const by = ctx.members.find((m) => m.id === ctx.ring.uid) || {};
  const group = ctx.members.length > 2;
  return { server: ctx.id, from: ctx.ring.nick, title: group ? ctx.name : ctx.ring.nick, avatar: (group && ctx.icon) || by.avatar || null, video: ctx.ring.video, group };
}
function ringUser(ctx, uid) {
  if (!ctx.ring || uidInCall(ctx, uid) || !ctx.memberIds.has(uid)) return;
  clearTimeout(ctx.ring.targets.get(uid));
  ctx.ring.targets.set(uid, setTimeout(() => stopRing(ctx, uid), RING_MS));
  ringingCtx.set(ctx.id, ctx);
  toUser(uid, "call:ring", ringPayload(ctx));
}
function stopRing(ctx, uid) {
  if (!ctx.ring) return;
  for (const u of uid ? [uid] : [...ctx.ring.targets.keys()]) {
    if (!ctx.ring.targets.has(u)) continue;
    clearTimeout(ctx.ring.targets.get(u));
    ctx.ring.targets.delete(u);
    toUser(u, "call:ringstop", { server: ctx.id });
  }
  if (!ctx.ring.targets.size) ringingCtx.delete(ctx.id);
  sendRinging(ctx);
}
// a chamada comecou: mensagem "Fulano iniciou uma chamada." e toca para todo mundo da conversa
function startDmCall(ctx, uid, nick, video) {
  const msg = { type: "sys", text: nick + " iniciou uma chamada.", ts: Date.now(), ch: (ctx.channels.find((c) => c.type === "text") || {}).id || "chat", call: { by: nick, uid, start: Date.now(), joined: [uid] } };
  pushMessage(ctx, msg);
  ctx.ring = { uid, nick, video: !!video, targets: new Map(), joined: new Set([uid]), msg };
  for (const m of ctx.members) if (m.id !== uid) ringUser(ctx, m.id);
  sendRinging(ctx);
}
// todo mundo saiu: para de tocar e a mensagem vira "... que durou 5 minutos" (ou "Você perdeu uma chamada")
function endDmCall(ctx) {
  if (!ctx.ring || ctx.callMembers.size) return;
  stopRing(ctx);
  const m = ctx.ring.msg;
  m.call = { ...m.call, end: Date.now(), joined: [...ctx.ring.joined] };
  toRoom(ctx, "message:update", { id: m.id, call: m.call });
  persist(ctx);
  ctx.ring = null;
}

function cleanCallState(s) {
  s = s && typeof s === "object" ? s : {};
  const streamId = (v) => (typeof v === "string" && v ? v.slice(0, 100) : null);
  return { mic: !!s.mic, deaf: !!s.deaf, cam: streamId(s.cam), screen: streamId(s.screen) };
}

// Fotos de perfil de todos os membros: so vai para todo mundo quando muda (sao pesadas)
function avatarsOf(ctx) {
  const avatars = {};
  for (const m of ctx.members) if (m.avatar) avatars[keyOf(m.nick)] = m.avatar;
  return avatars;
}
// Quem esta online, cores, status e a lista de membros (online e offline)
function sendUsers(ctx, withAvatars) {
  // quem esta invisivel aparece como offline para os outros
  const visible = [...ctx.online].filter(([id]) => ctx.statuses.get(id) !== "invisivel");
  const onlineIds = new Set([...ctx.sockets.values()].filter((s) => ctx.statuses.get(s.id) !== "invisivel").map((s) => s.data.user.id));
  toRoom(ctx, "users", [...new Set(visible.map(([, n]) => n))].sort());
  const profiles = {};
  for (const m of ctx.members) profiles[keyOf(m.nick)] = { color: m.color || undefined, status: "offline", text: m.status_text || undefined, bio: m.bio || undefined, id: m.id, banner: m.banner || undefined, deco: m.decoration || undefined, conn: m.connections || undefined };
  for (const [id, nick] of visible) {
    const s = ctx.sockets.get(id);
    profiles[keyOf(nick)] = { ...(profiles[keyOf(nick)] || {}), status: ctx.statuses.get(id) || "online", noact: (s && s.data.hideAct) || undefined };
  }
  if (withAvatars) toRoom(ctx, "avatars", avatarsOf(ctx));
  toRoom(ctx, "profiles", profiles);
  toRoom(ctx, "members", ctx.members.map((m) => ({ id: m.id, nick: m.nick, role: m.role, online: onlineIds.has(m.id) })));
}

function blockedUntil(map, key) {
  const until = map.get(key);
  if (!until) return 0;
  if (until <= Date.now()) { map.delete(key); return 0; }
  return until;
}

function quoteOf(ctx, id) {
  const m = ctx.history.find((x) => x.id === Number(id));
  if (!m || m.type === "sys") return null;
  const text = m.type === "img" ? "foto" : m.type === "audio" ? "áudio" : m.type === "file" ? "arquivo " + (m.name || "") : m.type === "poll" ? "enquete: " + m.poll.q : m.type === "sticker" ? "figurinha" : String(m.text || "").slice(0, 90);
  return { id: m.id, nick: m.nick, uid: m.uid, text };
}

// Lista de silenciados, so para quem modera
function sendModeration(ctx) {
  const muted = [...ctx.mutes.entries()].filter(([, until]) => until > Date.now()).map(([uid, until]) => {
    const m = ctx.members.find((x) => x.id === uid);
    return { id: uid, nick: m ? m.nick : "?", min: minutesLeft(until) };
  });
  for (const s of ctx.sockets.values()) if (sockCan(ctx, s, "members")) s.emit("admin:moderation", { muted });
}

// Tira alguem do servidor (expulso, banido ou servidor apagado)
function removeUserFromCtx(ctx, userId, reason) {
  for (const s of ctx.sockets.values()) {
    if (s.data.user.id !== userId) continue;
    s.emit("server:removed", reason);
    setTimeout(() => s.disconnect(true), 200);
  }
}

// ---------- API de contas e servidores ----------
const api = express.Router();
app.use("/api", api);
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error("Erro na API:", e.message);
  res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.status && e.status < 500 ? e.message : "Deu erro no servidor. Tente de novo." });
});
const fail = (res, status, error) => res.status(status).json({ error });

async function requireUser(req, res) {
  if (!ready()) { fail(res, 503, "O site ainda não foi ligado ao banco (falta SUPABASE_SECRET_KEY no Render)."); return null; }
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = await userFromToken(token);
  if (!user) { fail(res, 401, "Sua sessão acabou. Entre de novo."); return null; }
  if (user.needCode && !req.allowPartial) { fail(res, 401, "Digite o código da verificação em 2 etapas."); return null; }
  return user;
}

api.get("/config", (req, res) => res.json({ supabaseUrl: SUPABASE_URL, publishableKey: PUBLISHABLE_KEY, ready: ready() }));

const signups = new Map(); // endereco -> [horarios]
api.post("/signup", wrap(async (req, res) => {
  if (!ready()) return fail(res, 503, "O site ainda não foi ligado ao banco (falta SUPABASE_SECRET_KEY no Render).");
  const now = Date.now();
  const times = (signups.get(req.ip) || []).filter((t) => now - t < 3600000);
  if (times.length >= 5) return fail(res, 429, "Muitas contas criadas daqui. Tente de novo em 1 hora.");
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const nick = cleanNick(req.body.nick);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return fail(res, 400, "E-mail inválido.");
  if (password.length < 6 || password.length > 72) return fail(res, 400, "A senha precisa ter de 6 a 72 caracteres.");
  if (!nick) return fail(res, 400, "Escolha um apelido.");
  if (NICK_BAD.test(nick)) return fail(res, 400, "O apelido não pode ter estes caracteres: * % _ , ( ) \" \\ : @ < >");
  if (await nickTaken(nick)) return fail(res, 409, "Esse apelido já tem dono. Escolha outro.");
  let user;
  try { user = await auth.createUser(email, password); }
  catch (e) {
    if (/already|registered|exists/i.test(e.message)) return fail(res, 409, "Já existe uma conta com esse e-mail. Use a aba Entrar.");
    if (/password/i.test(e.message)) return fail(res, 400, "Senha fraca demais. Use pelo menos 6 caracteres, misturando letras e numeros.");
    throw e;
  }
  try {
    await db.insert("profiles", [{ id: user.id, nick }], false);
  } catch (e) {
    await auth.deleteUser(user.id).catch(() => {}); // alguem pegou o apelido no mesmo segundo
    return fail(res, 409, "Esse apelido já tem dono. Escolha outro.");
  }
  times.push(now); signups.set(req.ip, times);
  res.json({ ok: true });
}));

api.get("/me", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const profile = await getProfile(user.id);
  if (!profile) return fail(res, 404, "Conta sem perfil. Crie a conta de novo.");
  const rows = await db.select("server_members", { select: "role,server:servers(id,name,owner_id,icon,dm)", user_id: "eq." + user.id, order: "joined_at.asc" });
  const list = rows.filter((r) => r.server).map((r) => ({ id: r.server.id, name: r.server.name, icon: r.server.icon || null, role: r.role, dm: !!r.server.dm }));
  // conversas privadas: mostram a outra pessoa (nome e foto)
  const dms = list.filter((x) => x.dm);
  if (dms.length) {
    const mem = await db.select("server_members", { select: "server_id,user_id", server_id: db.inList(dms.map((d) => d.id)) });
    const others = new Map();
    for (const m of mem) if (m.user_id !== user.id) others.set(m.server_id, [...(others.get(m.server_id) || []), m.user_id]);
    const profs = await getProfiles([...new Set(mem.map((m) => m.user_id).filter((id) => id !== user.id))]);
    const byId = new Map(profs.map((p) => [p.id, p]));
    for (const d of dms) {
      const list = (others.get(d.id) || []).map((id) => byId.get(id)).filter(Boolean);
      // conversa em grupo: nome escolhido ou os apelidos de quem esta nela
      if (list.length > 1) { d.group = true; d.name = d.name && d.name !== "DM" ? d.name : list.map((o) => o.nick).join(", ").slice(0, 60); d.icon = d.icon || null; continue; }
      const o = list[0]; d.name = o ? o.nick : "Conversa"; d.icon = o ? o.avatar || null : null; d.peer = o ? o.id : null;
    }
  }
  res.json({ user: { id: user.id, email: user.email }, profile, servers: list });
}));

// Muda apelido, cor ou foto (vale em todos os servidores)
api.patch("/me", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const old = await getProfile(user.id);
  if (!old) return fail(res, 404, "Conta sem perfil.");
  const patch = {};
  if (req.body.nick !== undefined) {
    const nick = cleanNick(req.body.nick);
    if (!nick || NICK_BAD.test(nick)) return fail(res, 400, "Apelido inválido.");
    if (nick !== old.nick) {
      if (await nickTaken(nick, user.id)) return fail(res, 409, "Esse apelido já tem dono.");
      patch.nick = nick;
    }
  }
  if (req.body.bio !== undefined) {
    const t = String(req.body.bio || "").replace(/\r/g, "").trim().slice(0, 190);
    patch.bio = t || null;
  }
  if (req.body.status_text !== undefined) {
    const t = String(req.body.status_text || "").replace(/\s+/g, " ").trim().slice(0, 60);
    patch.status_text = t || null;
  }
  if (req.body.color !== undefined) { if (!NAME_COLORS.includes(req.body.color)) return fail(res, 400, "Cor inválida."); patch.color = req.body.color; }
  if (req.body.banner !== undefined) {
    if (req.body.banner !== null && !/^#[0-9a-f]{6}$/i.test(String(req.body.banner))) return fail(res, 400, "Cor do banner inválida.");
    patch.banner = req.body.banner;
  }
  if (req.body.decoration !== undefined) {
    if (!DECORATIONS.includes(String(req.body.decoration || ""))) return fail(res, 400, "Decoração inválida.");
    patch.decoration = req.body.decoration || null;
  }
  if (req.body.connections !== undefined) {
    const list = (Array.isArray(req.body.connections) ? req.body.connections : [])
      .filter((c) => c && CONNECTION_TYPES.includes(c.type))
      .map((c) => ({ type: c.type, name: String(c.name || "").replace(/[\s<>"]/g, "").slice(0, 60) }))
      .filter((c) => c.name).slice(0, 8);
    patch.connections = list.length ? list : null;
  }
  if (req.body.avatar !== undefined) {
    const a = String(req.body.avatar);
    if (a.length > MAX_AVATAR || !IMAGE_RE.test(a)) return fail(res, 400, "Foto inválida.");
    patch.avatar = a;
  }
  if (!Object.keys(patch).length) return res.json({ profile: old });
  try { await db.update("profiles", { id: "eq." + user.id }, patch); }
  catch (e) { if (patch.nick) return fail(res, 409, "Esse apelido já tem dono."); throw e; }
  const profile = { ...old, ...patch };
  profileCache.set(user.id, profile);
  // avisa todos os servidores onde a pessoa esta
  for (const p of contexts.values()) {
    const ctx = await p.catch(() => null);
    if (!ctx || !ctx.members.some((m) => m.id === user.id)) continue;
    ctx.members = ctx.members.map((m) => (m.id === user.id ? { ...m, ...patch } : m));
    if (patch.nick) {
      let wasOnline = false;
      for (const [sid, s] of ctx.sockets) {
        if (s.data.user.id !== user.id) continue;
        wasOnline = true;
        ctx.online.set(sid, patch.nick);
        s.data.nick = patch.nick;
        if (ctx.callMembers.has(sid)) ctx.callMembers.get(sid).nick = patch.nick;
        s.emit("me", meOf(ctx, s));
      }
      // as reacoes antigas passam para o apelido novo
      for (const m of ctx.history) {
        let changed = false;
        for (const who of Object.values(m.reactions || {})) { const i = who.indexOf(old.nick); if (i >= 0) { who[i] = patch.nick; changed = true; } }
        if (changed) toRoom(ctx, "message:update", { id: m.id, reactions: m.reactions });
        // votos das enquetes tambem (senao daria para votar de novo com o nome novo)
        if (m.type === "poll" && m.poll.options.some((o) => o.votes.includes(old.nick))) {
          for (const o of m.poll.options) o.votes = o.votes.map((n) => (n === old.nick ? patch.nick : n));
          toRoom(ctx, "message:update", { id: m.id, poll: m.poll });
        }
      }
      // eventos: quem vai e quem criou
      let evChanged = false;
      for (const ev of ctx.events) {
        if (ev.by === old.nick) { ev.by = patch.nick; evChanged = true; }
        if (ev.going.includes(old.nick)) { ev.going = ev.going.map((n) => (n === old.nick ? patch.nick : n)); evChanged = true; }
      }
      if (evChanged) { saveMeta(ctx, "events"); toRoom(ctx, "events", ctx.events); }
      persist(ctx);
      ctx.poker.rename(old.nick, patch.nick);
      ctx.truco.rename(old.nick, patch.nick);
      ctx.blefe.rename(old.nick, patch.nick);
      if (wasOnline) sendCall(ctx);
      sys(ctx, old.nick + " agora se chama " + patch.nick);
    }
    sendUsers(ctx, !!(patch.nick || patch.avatar));
  }
  res.json({ profile });
}));

// Excluir a conta (Configuracoes > Minha conta). Como no Discord, quem e dono de servidor apaga ou passa ele antes.
// O navegador ja conferiu a senha; o banco apaga perfil, amizades e participacoes junto com a conta.
api.delete("/me", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const owned = await db.select("servers", { select: "id", owner_id: "eq." + user.id, dm: "eq.false" });
  if (owned.length) return fail(res, 400, "Você é dono de " + owned.length + (owned.length === 1 ? " servidor" : " servidores") + ". Apague antes de excluir a conta.");
  const touched = [];
  for (const p of contexts.values()) {
    const ctx = await p.catch(() => null);
    if (ctx && ctx.members.some((m) => m.id === user.id)) { removeUserFromCtx(ctx, user.id, "Sua conta foi excluída."); touched.push(ctx); }
  }
  await db.remove("server_members", { user_id: "eq." + user.id });
  await db.remove("friendships", { user_id: "eq." + user.id });
  await db.remove("friendships", { friend_id: "eq." + user.id });
  await db.remove("profiles", { id: "eq." + user.id });
  await auth.deleteUser(user.id);
  profileCache.delete(user.id);
  for (const ctx of touched) { await loadMembers(ctx).catch(() => {}); sendUsers(ctx, true); }
  res.json({ ok: true });
}));

api.post("/servers", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const name = String(req.body.name || "").replace(/\s+/g, " ").trim().slice(0, MAX_SERVER_NAME);
  if (!name) return fail(res, 400, "Dê um nome para o servidor.");
  const owned = await db.select("servers", { select: "id", owner_id: "eq." + user.id, dm: "eq.false" });
  if (owned.length >= MAX_SERVERS_OWNED) return fail(res, 400, "Você já é dono de " + MAX_SERVERS_OWNED + " servidores.");
  const [srv] = await db.insert("servers", [{ name, owner_id: user.id }]);
  await db.insert("server_members", [{ server_id: srv.id, user_id: user.id, role: "owner" }], false);
  const chans = templateChannels(String(req.body.template || ""));
  if (chans) await db.upsert("chat_kv", [{ key: "srv:" + srv.id + ":channels", value: JSON.stringify(chans), expires_at: null }], "key");
  res.json({ server: { id: srv.id, name: srv.name, icon: null, role: "owner" } });
}));

async function requireRole(req, res, user, roles) {
  const id = req.params.id;
  if (!UUID_RE.test(id)) { fail(res, 404, "Servidor não encontrado."); return null; }
  const role = await membership(id, user.id);
  if (!role || !roles.includes(role)) { fail(res, 403, "Você não tem permissão para isso nesse servidor."); return null; }
  return role;
}

api.patch("/servers/:id", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  if (!(await requireRole(req, res, user, ["owner", "admin"]))) return;
  // muda o nome e/ou a foto do servidor (icon: null tira a foto)
  const patch = {};
  if (req.body.name !== undefined) {
    const name = String(req.body.name || "").replace(/\s+/g, " ").trim().slice(0, MAX_SERVER_NAME);
    if (!name) return fail(res, 400, "Dê um nome para o servidor.");
    patch.name = name;
  }
  if (req.body.icon !== undefined) {
    if (req.body.icon === null) patch.icon = null;
    else {
      const icon = String(req.body.icon);
      if (icon.length > MAX_SERVER_ICON || !IMAGE_RE.test(icon)) return fail(res, 400, "Foto inválida.");
      patch.icon = icon;
    }
  }
  if (!Object.keys(patch).length) return res.json({ ok: true });
  await db.update("servers", { id: "eq." + req.params.id }, patch);
  if (contexts.has(req.params.id)) {
    const ctx = await contexts.get(req.params.id);
    Object.assign(ctx, patch);
    for (const s of ctx.sockets.values()) s.emit("me", meOf(ctx, s));
  }
  res.json({ ok: true });
}));

api.delete("/servers/:id", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  if (!(await requireRole(req, res, user, ["owner"]))) return;
  await db.remove("servers", { id: "eq." + req.params.id });
  const st = createStorage(req.params.id);
  if (st) st.deleteAll();
  if (contexts.has(req.params.id)) {
    const ctx = await contexts.get(req.params.id).catch(() => null);
    contexts.delete(req.params.id);
    if (ctx) { ctx.dead = true; for (const s of ctx.sockets.values()) { s.emit("server:removed", "O servidor foi apagado pelo dono."); setTimeout(() => s.disconnect(true), 200); } }
  }
  res.json({ ok: true });
}));

api.post("/servers/:id/leave", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const role = await requireRole(req, res, user, ["admin", "member", "owner"]); if (!role) return;
  const [srvRow] = await db.select("servers", { select: "dm", id: "eq." + req.params.id });
  if (role === "owner" && !(srvRow && srvRow.dm)) return fail(res, 400, "O dono não pode sair. Apague o servidor se não quiser mais ele.");
  await db.remove("server_members", { server_id: "eq." + req.params.id, user_id: "eq." + user.id });
  if (contexts.has(req.params.id)) {
    const ctx = await contexts.get(req.params.id);
    removeUserFromCtx(ctx, user.id, "Você saiu do servidor.");
    await loadMembers(ctx); sendUsers(ctx, true);
  }
  res.json({ ok: true });
}));

// Mensagem direta: conversa privada entre duas pessoas que estao em algum servidor juntas.
// Por baixo e um "servidor" de 2 pessoas (dm = true), entao tem chat, call, fotos e tudo mais.
async function friendsOf(uid) {
  const [a, b] = await Promise.all([
    db.select("friendships", { select: "user_id,friend_id,status", user_id: "eq." + uid }),
    db.select("friendships", { select: "user_id,friend_id,status", friend_id: "eq." + uid }),
  ]);
  return [...a, ...b];
}
const areFriends = (rows, a, b) => rows.some((r) => r.status === "accepted" && ((r.user_id === a && r.friend_id === b) || (r.user_id === b && r.friend_id === a)));
api.post("/dm", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  // conversa em grupo (ate 10 pessoas, todas amigas de quem cria)
  if (Array.isArray(req.body.userIds)) {
    const ids = [...new Set(req.body.userIds.map(String))].filter((id) => UUID_RE.test(id) && id !== user.id);
    if (ids.length < 1 || ids.length > 9) return fail(res, 400, "Escolha de 1 a 9 amigos.");
    const fr = await friendsOf(user.id);
    if (!ids.every((id) => areFriends(fr, user.id, id))) return fail(res, 403, "Só dá para colocar amigos no grupo.");
    const [srv] = await db.insert("servers", [{ name: "DM", owner_id: user.id, dm: true }]);
    await db.insert("server_members", [user.id, ...ids].map((id) => ({ server_id: srv.id, user_id: id, role: id === user.id ? "owner" : "member" })), false);
    for (const id of ids) toUser(id, "dm:new", { server: srv.id });
    return res.json({ server: { id: srv.id } });
  }
  const other = String(req.body.userId || "");
  if (!UUID_RE.test(other) || other === user.id) return fail(res, 400, "Pessoa inválida.");
  const mine = await db.select("server_members", { select: "server_id,server:servers(dm)", user_id: "eq." + user.id });
  const theirs = await db.select("server_members", { select: "server_id,server:servers(dm)", user_id: "eq." + other });
  const theirSet = new Set(theirs.map((m) => m.server_id));
  const shared = mine.filter((m) => theirSet.has(m.server_id));
  // conversa de 2 que ja existe (grupo nao conta)
  const dmIds = shared.filter((m) => m.server && m.server.dm).map((m) => m.server_id);
  if (dmIds.length) {
    const mem = await db.select("server_members", { select: "server_id,user_id", server_id: db.inList(dmIds) });
    const two = dmIds.find((id) => mem.filter((m) => m.server_id === id).length === 2);
    if (two) return res.json({ server: { id: two } });
  }
  if (!shared.some((m) => m.server && !m.server.dm) && !areFriends(await friendsOf(user.id), user.id, other)) return fail(res, 403, "Você só pode mandar mensagem para amigos ou para quem está em um servidor com você.");
  const [srv] = await db.insert("servers", [{ name: "DM", owner_id: user.id, dm: true }]);
  await db.insert("server_members", [{ server_id: srv.id, user_id: user.id, role: "member" }, { server_id: srv.id, user_id: other, role: "member" }], false);
  toUser(other, "dm:new", { server: srv.id });
  res.json({ server: { id: srv.id } });
}));

// Convites do servidor: a moderacao ve a lista e pode cancelar
api.get("/servers/:id/invites", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  if (!(await requireRole(req, res, user, ["owner", "admin"]))) return;
  const rows = await db.select("server_invites", { select: "code,expires_at,uses,created_by", server_id: "eq." + req.params.id, order: "created_at.desc" });
  const live = rows.filter((r) => !r.expires_at || Date.parse(r.expires_at) > Date.now());
  const profs = await getProfiles([...new Set(live.map((r) => r.created_by).filter(Boolean))]);
  const nick = new Map(profs.map((p) => [p.id, p.nick]));
  res.json({ invites: live.map((r) => ({ code: r.code, expires_at: r.expires_at, uses: r.uses, by: nick.get(r.created_by) || "?" })) });
}));
api.delete("/servers/:id/invites/:code", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  if (!(await requireRole(req, res, user, ["owner", "admin"]))) return;
  if (!INVITE_CODE_RE.test(req.params.code)) return fail(res, 400, "Convite inválido.");
  await db.remove("server_invites", { code: "eq." + req.params.code, server_id: "eq." + req.params.id });
  if (contexts.has(req.params.id)) { const ctx = await contexts.get(req.params.id).catch(() => null); if (ctx) audit(ctx, (await getProfile(user.id) || {}).nick || "?", "cancelou o convite", req.params.code); }
  res.json({ ok: true });
}));

api.post("/servers/:id/invites", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  if (!(await requireRole(req, res, user, ["owner", "admin", "member"]))) return;
  const [isDm] = await db.select("servers", { select: "dm", id: "eq." + req.params.id });
  if (isDm && isDm.dm) return fail(res, 400, "Conversa privada não tem convite.");
  const hours = INVITE_HOURS.includes(Number(req.body.hours)) ? Number(req.body.hours) : 24;
  const code = crypto.randomBytes(6).toString("base64url");
  await db.insert("server_invites", [{ code, server_id: req.params.id, created_by: user.id, expires_at: hours ? new Date(Date.now() + hours * 3600000).toISOString() : null }], false);
  res.json({ code, hours });
}));

async function findInvite(code) {
  if (!INVITE_CODE_RE.test(code)) return null;
  const rows = await db.select("server_invites", { select: "code,server_id,expires_at,uses,server:servers(id,name,icon)", code: "eq." + code });
  const inv = rows[0];
  if (!inv || !inv.server || (inv.expires_at && Date.parse(inv.expires_at) <= Date.now())) return null;
  return inv;
}

api.get("/invites/:code", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const inv = await findInvite(req.params.code);
  if (!inv) return fail(res, 404, "Esse convite não existe ou já venceu.");
  const members = await db.select("server_members", { select: "user_id", server_id: "eq." + inv.server_id });
  res.json({ server: inv.server, members: members.length, already: members.some((m) => m.user_id === user.id) });
}));

api.post("/invites/:code/accept", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const inv = await findInvite(req.params.code);
  if (!inv) return fail(res, 404, "Esse convite não existe ou já venceu.");
  const ban = await activeBan(inv.server_id, user.id);
  if (ban) return fail(res, 403, ban.until ? "Você está banido desse servidor até " + new Date(ban.until).toLocaleString("pt-BR") + "." : "Você foi banido desse servidor.");
  if (!(await membership(inv.server_id, user.id))) {
    await db.insert("server_members", [{ server_id: inv.server_id, user_id: user.id, role: "member" }], false);
    await db.update("server_invites", { code: "eq." + inv.code }, { uses: inv.uses + 1 });
    if (contexts.has(inv.server_id)) {
      const ctx = await contexts.get(inv.server_id);
      await loadMembers(ctx); sendUsers(ctx, true);
      const p = await getProfile(user.id);
      if (p) sys(ctx, p.nick + " entrou no servidor pelo convite", null, { join: p.nick });
    }
  }
  res.json({ server: inv.server });
}));


// ---------- amigos ----------
// online de verdade: alguma aba aberta e nao invisivel
function presenceOf(uid) {
  let st = "offline";
  for (const s of io.sockets.sockets.values()) {
    if (!s.data.user || s.data.user.id !== uid) continue;
    const v = s.data.ctx.statuses.get(s.id) || "online";
    if (v === "invisivel") return "offline";
    if (st === "offline" || v === "online") st = v;
  }
  return st;
}
api.get("/friends", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const rows = await friendsOf(user.id);
  const ids = rows.map((r) => (r.user_id === user.id ? r.friend_id : r.user_id));
  const profs = await getProfiles(ids);
  const byId = new Map(profs.map((p) => [p.id, p]));
  res.json({ friends: rows.map((r) => {
    const id = r.user_id === user.id ? r.friend_id : r.user_id, p = byId.get(id);
    if (!p) return null;
    const kind = r.status === "accepted" ? "friend" : r.user_id === user.id ? "outgoing" : "incoming";
    return { id, nick: p.nick, avatar: p.avatar || null, color: p.color || null, text: p.status_text || null, kind, status: kind === "friend" ? presenceOf(id) : "offline" };
  }).filter(Boolean) });
}));
api.post("/friends", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const nick = cleanNick(req.body.nick);
  if (!nick || NICK_BAD.test(nick)) return fail(res, 400, "Digite o apelido certinho da pessoa.");
  const [other] = await db.select("profiles", { select: "id,nick", nick: "ilike." + nick });
  if (!other) return fail(res, 404, "Ninguém com esse apelido. Confira se digitou certo.");
  if (other.id === user.id) return fail(res, 400, "Você não pode adicionar você mesmo.");
  const rows = await friendsOf(user.id);
  if (rows.length >= 300) return fail(res, 400, "Lista de amigos cheia.");
  const rel = rows.find((r) => r.user_id === other.id || r.friend_id === other.id);
  if (rel && rel.status === "accepted") return fail(res, 409, "Vocês já são amigos.");
  if (rel && rel.user_id === user.id) return fail(res, 409, "Pedido já enviado. Espere " + other.nick + " aceitar.");
  if (rel) await db.update("friendships", { user_id: "eq." + other.id, friend_id: "eq." + user.id }, { status: "accepted" });
  else await db.insert("friendships", [{ user_id: user.id, friend_id: other.id, status: "pending" }], false);
  toUser(other.id, "friends:update", { from: (await getProfile(user.id) || {}).nick, accepted: !!rel });
  res.json({ ok: true, accepted: !!rel, nick: other.nick });
}));
api.post("/friends/:id/accept", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  if (!UUID_RE.test(req.params.id)) return fail(res, 400, "Pedido inválido.");
  const rows = await db.update("friendships", { user_id: "eq." + req.params.id, friend_id: "eq." + user.id, status: "eq.pending" }, { status: "accepted" });
  if (!rows.length) return fail(res, 404, "Esse pedido não existe mais.");
  toUser(req.params.id, "friends:update", { from: (await getProfile(user.id) || {}).nick, accepted: true });
  res.json({ ok: true });
}));
api.delete("/friends/:id", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  if (!UUID_RE.test(req.params.id)) return fail(res, 400, "Pessoa inválida.");
  await db.remove("friendships", { user_id: "eq." + user.id, friend_id: "eq." + req.params.id });
  await db.remove("friendships", { user_id: "eq." + req.params.id, friend_id: "eq." + user.id });
  toUser(req.params.id, "friends:update", {});
  res.json({ ok: true });
}));

// ---------- Descobrir: servidores publicos ----------
api.get("/discover", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const rows = await db.select("servers", { select: "id,name,icon,description", public: "eq.true", dm: "eq.false", order: "created_at.desc" });
  const list = rows.slice(0, 60);
  const mem = list.length ? await db.select("server_members", { select: "server_id,user_id", server_id: db.inList(list.map((x) => x.id)) }) : [];
  const q = String(req.query.q || "").toLowerCase();
  res.json({ servers: list.map((x) => {
    const ms = mem.filter((m) => m.server_id === x.id);
    return { id: x.id, name: x.name, icon: x.icon || null, description: x.description || "", members: ms.length, online: ms.filter((m) => presenceOf(m.user_id) !== "offline").length, joined: ms.some((m) => m.user_id === user.id) };
  }).filter((x) => !q || (x.name + " " + x.description).toLowerCase().includes(q)).sort((a, b) => b.members - a.members) });
}));
api.post("/servers/:id/join", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  if (!UUID_RE.test(req.params.id)) return fail(res, 404, "Servidor não encontrado.");
  const [srv] = await db.select("servers", { select: "id,name,icon,public,dm", id: "eq." + req.params.id });
  if (!srv || !srv.public || srv.dm) return fail(res, 404, "Esse servidor não está aberto no Descobrir.");
  const ban = await activeBan(srv.id, user.id);
  if (ban) return fail(res, 403, "Você foi banido desse servidor.");
  if (!(await membership(srv.id, user.id))) {
    await db.insert("server_members", [{ server_id: srv.id, user_id: user.id, role: "member" }], false);
    if (contexts.has(srv.id)) {
      const ctx = await contexts.get(srv.id);
      await loadMembers(ctx); sendUsers(ctx, true);
      const p = await getProfile(user.id);
      if (p) sys(ctx, p.nick + " chegou pelo Descobrir", null, { join: p.nick });
    }
  }
  res.json({ server: { id: srv.id, name: srv.name, icon: srv.icon || null } });
}));

// ---------- webhooks: POST com { content, username } manda mensagem no canal ----------
const hookHits = new Map(); // webhook -> [horarios]
api.post("/webhooks/:server/:id/:token", wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.server)) return fail(res, 404, "Webhook não existe.");
  const ctx = await getCtx(req.params.server).catch(() => null);
  const w = ctx && ctx.webhooks.find((x) => x.id === req.params.id);
  const tok = Buffer.from(String(req.params.token)), real = Buffer.from(w ? w.token : "x");
  if (!w || tok.length !== real.length || !crypto.timingSafeEqual(tok, real)) return fail(res, 404, "Webhook não existe.");
  const now = Date.now(), hits = (hookHits.get(w.id) || []).filter((t) => now - t < 60000);
  if (hits.length >= 30) return fail(res, 429, "Muitas mensagens. Máximo de 30 por minuto.");
  hits.push(now); hookHits.set(w.id, hits);
  const text = String(req.body.content || req.body.text || "").replace(/\r/g, "").trim().slice(0, MAX_TEXT);
  if (!text) return fail(res, 400, "Mande o texto em \"content\".");
  if (!ctx.channels.some((c) => c.id === w.ch)) return fail(res, 410, "O canal desse webhook foi apagado.");
  const nick = cleanNick(req.body.username) || w.name;
  pushMessage(ctx, { type: "msg", nick, bot: true, text, ts: now, ch: w.ch });
  res.status(204).end();
}));

// ---------- previa de links (titulo, descricao e imagem do site) ----------
const embedCache = new Map(); // url -> { data, until }
const embedHits = new Map();  // conta -> [horarios]
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}
// so deixa o servidor buscar sites da internet aberta (nunca a rede interna)
function safeLookup(host, opts, cb) {
  dns.lookup(host, { family: 0 }, (err, address, family) => {
    if (err) return cb(err);
    if (privateIp(address) && !process.env.EMBED_ALLOW_LOCAL) return cb(new Error("endereço bloqueado"));
    if (opts && opts.all) return cb(null, [{ address, family }]);
    cb(null, address, family);
  });
}
function fetchHtml(url, hops = 3) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error("link inválido")); }
    if (!/^https?:$/.test(u.protocol) || (u.port && !["80", "443"].includes(u.port) && !process.env.EMBED_ALLOW_LOCAL)) return reject(new Error("link inválido"));
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.get(u, { lookup: safeLookup, timeout: 5000, headers: { "User-Agent": "Mozilla/5.0 (compatible; ChatPedroBot/1.0; +https://chat-pedro.onrender.com)", Accept: "text/html", "Accept-Language": "pt-BR,pt;q=0.9" } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && hops > 0) { r.resume(); return resolve(fetchHtml(new URL(r.headers.location, u).href, hops - 1)); }
      if (r.statusCode !== 200 || !/text\/html|xhtml/i.test(r.headers["content-type"] || "")) { r.resume(); return reject(new Error("sem página")); }
      let size = 0; const chunks = [];
      r.on("data", (c) => { size += c.length; chunks.push(c); if (size > 400 * 1024) r.destroy(); });
      r.on("close", () => resolve({ html: Buffer.concat(chunks).toString("utf8"), url: u.href }));
      r.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("demorou demais")));
    req.on("error", reject);
  });
}
const decodeHtml = (t) => String(t || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, " ").trim();
function metaOf(html, base) {
  const head = html.slice(0, 200000);
  const get = (...names) => {
    for (const n of names) {
      const re = new RegExp("<meta[^>]+(?:property|name)=[\"']" + n + "[\"'][^>]*>", "i");
      const tag = head.match(re);
      if (tag) { const c = tag[0].match(/content=["']([^"']*)["']/i); if (c && c[1].trim()) return decodeHtml(c[1]); }
    }
    return "";
  };
  const title = get("og:title", "twitter:title") || decodeHtml((head.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]);
  let image = get("og:image", "og:image:url", "twitter:image");
  try { image = image ? new URL(image, base).href : ""; } catch { image = ""; }
  if (image && !/^https:/.test(image)) image = "";
  const color = get("theme-color");
  return {
    site: get("og:site_name").slice(0, 80) || new URL(base).hostname.replace(/^www\./, ""),
    title: title.slice(0, 200), desc: get("og:description", "description", "twitter:description").slice(0, 350),
    image, big: get("twitter:card") === "summary_large_image", color: /^#[0-9a-f]{3,8}$/i.test(color) ? color : "",
  };
}
api.get("/embed", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const url = String(req.query.url || "").slice(0, 1000);
  const hit = embedCache.get(url);
  if (hit && hit.until > Date.now()) return res.json(hit.data);
  const now = Date.now(), times = (embedHits.get(user.id) || []).filter((t) => now - t < 60000);
  if (times.length >= 40) return fail(res, 429, "Calma.");
  times.push(now); embedHits.set(user.id, times);
  let data = null;
  try { const page = await fetchHtml(url); const m = metaOf(page.html, page.url); if (m.title || m.desc) data = { ...m, url }; } catch {}
  embedCache.set(url, { data, until: now + (data ? 3600000 : 600000) });
  if (embedCache.size > 1000) embedCache.delete(embedCache.keys().next().value);
  res.json(data);
}));

// ---------- conexao em tempo real: so com login e sendo membro do servidor ----------
io.use(async (socket, next) => {
  try {
    if (!ready()) return next(new Error("sem_banco"));
    const { token, server: serverId } = socket.handshake.auth || {};
    const user = await userFromToken(token);
    if (!user) return next(new Error("login"));
    if (user.needCode) return next(new Error("codigo"));
    if (!UUID_RE.test(String(serverId || ""))) return next(new Error("nao_membro"));
    const role = await membership(serverId, user.id);
    if (!role) return next(new Error("nao_membro"));
    if (await activeBan(serverId, user.id)) return next(new Error("banido"));
    const profile = await getProfile(user.id);
    if (!profile) return next(new Error("login"));
    const ctx = await getCtx(serverId);
    if (ctx.dead) return next(new Error("nao_membro"));
    socket.data = { user, role, nick: profile.nick, ctx };
    next();
  } catch (e) {
    console.error("Erro ao conectar:", e.message);
    next(new Error("erro"));
  }
});

function meOf(ctx, s) {
  return { uid: s.data.user.id, nick: s.data.nick, role: s.data.role, perms: [...permsOf(ctx, s.data.user.id, s.data.role)], server: { id: ctx.id, name: ctx.name, icon: ctx.icon, dm: ctx.dm } };
}

// Protecao: um pedido malfeito (de proposito ou nao) nunca derruba o site. Se uma funcao der erro,
// so aquele pedido falha; o erro vai para o registro do Render.
function guardSocket(socket) {
  const on = socket.on.bind(socket);
  socket.on = (ev, fn) => on(ev, (...args) => {
    try {
      const r = fn(...args);
      if (r && typeof r.catch === "function") r.catch((e) => console.error("Erro em " + ev + ":", e.message));
    } catch (e) { console.error("Erro em " + ev + ":", e.message); }
  });
}

io.on("connection", (socket) => {
  guardSocket(socket);
  const ctx = socket.data.ctx;
  const uid = socket.data.user.id;
  socket.join(ctx.room);
  ctx.sockets.set(socket.id, socket);
  ctx.online.set(socket.id, socket.data.nick);
  if (!ctx.members.some((m) => m.id === uid)) loadMembers(ctx).then(() => sendUsers(ctx, true)).catch(() => {});

  socket.emit("me", meOf(ctx, socket));
  socket.emit("avatars", avatarsOf(ctx));
  socket.emit("guild", guildOf(ctx));
  socket.emit("channels", ctx.channels);
  socket.emit("events", ctx.events);
  if (ctx.banner) socket.emit("banner", ctx.banner);
  socket.emit("call:members", [...ctx.callMembers.values()]);
  if (ctx.dm) socket.emit("call:ringing", ringList(ctx));
  // alguem esta me ligando agora (abri o site ou troquei de pagina no meio do toque)
  for (const c of ringingCtx.values()) if (c.ring && c.ring.targets.has(uid)) socket.emit("call:ring", ringPayload(c));
  iceServers().then((list) => socket.emit("ice", list));
  socket.emit("watch:state", watchMsg(ctx));
  sendUsers(ctx);
  ctx.poker.handle(socket);
  ctx.truco.handle(socket);
  ctx.blefe.handle(socket);
  ctx.poker.broadcast();
  ctx.truco.broadcast();
  ctx.blefe.broadcast();
  ctx.poker.refresh();

  const nickNow = () => ctx.online.get(socket.id);
  const can = (perm) => permsOf(ctx, uid, socket.data.role).has(perm);
  const notice = (text) => socket.emit("notice", text);
  if (can("members")) sendModeration(ctx);

  // ---------- anti-flood ----------
  const flood = { times: [], last: "", lastAt: 0, repeats: 0, strikes: [] };
  function floodCheck(text) {
    const now = Date.now();
    flood.times = flood.times.filter((t) => now - t < 5000);
    let why = null;
    const lines = text.split("\n");
    const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
    if (flood.times.length >= 5) why = "Calma! Muitas mensagens seguidas. Espere uns segundos.";
    else if (lines.length > MAX_LINES) why = "Mensagem com linhas demais (máximo " + MAX_LINES + ").";
    else if (lines.length >= 4 && new Set(lines.map((l) => l.trim())).size === 1) why = "Nada de repetir a mesma linha várias vezes.";
    else if (norm === flood.last && now - flood.lastAt < 30000 && flood.repeats >= 1) why = "Você já mandou essa mensagem.";
    if (why) {
      flood.strikes = flood.strikes.filter((t) => now - t < 60000);
      flood.strikes.push(now);
      // insistiu 4 vezes em 1 minuto: fica 2 minutos sem poder mandar mensagem
      if (flood.strikes.length >= 4) {
        ctx.mutes.set(uid, now + 2 * 60000);
        ctx.floodMuted.add(uid);
        saveMutes(ctx);
        flood.strikes = [];
        sys(ctx, nickNow() + " foi silenciado por 2 min (flood)");
        return "Você foi silenciado por 2 min por flood.";
      }
      return why;
    }
    flood.repeats = norm === flood.last && now - flood.lastAt < 30000 ? flood.repeats + 1 : 0;
    flood.last = norm; flood.lastAt = now;
    flood.times.push(now);
    return null;
  }

  // AutoMod: palavras bloqueadas pela moderacao (quem modera nao e bloqueado)
  const blockedWord = (text) => {
    if (can("server") || !ctx.automod.words.length) return null;
    const low = " " + text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") + " ";
    return ctx.automod.words.find((w) => low.includes(w)) || null;
  };
  // modo lento: tempo minimo entre mensagens de cada pessoa no canal
  const lastPost = new Map(); // canal -> horario
  // Confere se pode mandar algo no chat (canal, silenciado, modo lento, AutoMod, flood)
  function canPost(text, ch) {
    const c = textChannel(ctx, ch);
    if (!c) { notice("Esse canal não existe mais."); return null; }
    const muted = blockedUntil(ctx.mutes, uid);
    if (muted) { notice("Você está silenciado " + (ctx.floodMuted.has(uid) ? "por flood" : "pela moderação") + " por mais " + minutesLeft(muted) + " min."); return null; }
    if (c.announce && !can("messages")) { notice("Só a moderação manda mensagem em canais de anúncios."); return null; }
    if (c.slow && !can("messages")) {
      const wait = (lastPost.get(ch) || 0) + c.slow * 1000 - Date.now();
      if (wait > 0) { notice("Modo lento: espere " + Math.ceil(wait / 1000) + " s para mandar outra mensagem em #" + c.name + "."); return null; }
    }
    if (blockedWord(text)) { notice("Sua mensagem foi bloqueada pelo AutoMod deste servidor."); return null; }
    const err = floodCheck(text);
    if (err) { notice(err); return null; }
    lastPost.set(ch, Date.now());
    return nickNow();
  }
  const chIn = (v) => (typeof v === "string" ? v : "chat");

  // ack(false) avisa o navegador para tirar da tela a mensagem que ele ja mostrou
  socket.on("message", (msg, ack) => {
    const done = typeof ack === "function" ? ack : () => {};
    const raw = typeof msg === "string" ? msg : msg && msg.text;
    const text = String(raw || "").replace(/\r/g, "").trim().slice(0, MAX_TEXT);
    if (!text) return done(false);
    const ch = chIn(msg && msg.ch);
    const nick = canPost(text, ch);
    if (!nick) return done(false);
    const reply = msg && typeof msg === "object" && msg.replyTo ? quoteOf(ctx, msg.replyTo) : null;
    if (reply && msg.replyPing !== false) reply.ping = true;
    const everyone = /@(everyone|here)\b/.test(text) && can("everyone") ? true : undefined;
    pushMessage(ctx, { type: "msg", nick, uid, text, ts: Date.now(), ch, reply: reply || undefined, tts: msg && msg.tts ? true : undefined, everyone });
    done(true);
  });

  // historico de um canal (quando a pessoa abre o canal)
  socket.on("channel:open", (ch, reply) => {
    if (typeof reply !== "function") return;
    reply(textChannel(ctx, ch) ? historyFor(ctx, ch) : null);
  });

  // arquivo qualquer (pdf, zip, txt...) de ate ~2 MB
  socket.on("file", (f, replyTo, ch) => {
    if (!f || typeof f.data !== "string" || f.data.length > MAX_FILE || !FILE_RE.test(f.data)) return notice("Arquivo grande demais (máximo 2 MB) ou inválido.");
    ch = chIn(ch);
    const nick = canPost("[arquivo " + Date.now() + "]", ch);
    if (!nick) return;
    const name = String(f.name || "arquivo").replace(/[\\/\n\r]/g, "_").slice(0, 120);
    pushMessage(ctx, { type: "file", nick, uid, name, size: Number(f.size) || 0, src: f.data, ts: Date.now(), ch, reply: quoteOf(ctx, replyTo) || undefined });
  });

  // enquete: pergunta com ate 10 opcoes; cada pessoa vota (em uma ou varias, se a enquete deixar)
  socket.on("poll:create", (p) => {
    if (!p) return;
    const q = String(p.q || "").trim().slice(0, 300);
    const options = (Array.isArray(p.options) ? p.options : []).map((o) => String(o || "").trim().slice(0, 55)).filter(Boolean).slice(0, 10);
    if (!q || options.length < 2) return notice("A enquete precisa de uma pergunta e pelo menos 2 opções.");
    const ch = chIn(p.ch);
    const nick = canPost(q, ch);
    if (!nick) return;
    const hours = [1, 4, 8, 24, 72, 168].includes(Number(p.hours)) ? Number(p.hours) : 24;
    pushMessage(ctx, { type: "poll", nick, uid, ts: Date.now(), ch, poll: { q, multi: !!p.multi, ends: Date.now() + hours * 3600000, options: options.map((t) => ({ t, votes: [] })) } });
  });
  socket.on("poll:vote", (v) => {
    if (!v) return;
    const m = ctx.history.find((x) => x.id === Number(v.id));
    if (!m || m.type !== "poll" || Date.now() > m.poll.ends) return;
    const o = m.poll.options[Number(v.idx)];
    if (!o) return;
    const nick = nickNow();
    const had = o.votes.includes(nick);
    if (!m.poll.multi) for (const x of m.poll.options) x.votes = x.votes.filter((n) => n !== nick);
    else o.votes = o.votes.filter((n) => n !== nick);
    if (!had) o.votes.push(nick);
    toRoom(ctx, "message:update", { id: m.id, poll: m.poll });
    persist(ctx);
  });

  // encaminhar uma mensagem para outro canal do servidor
  socket.on("forward", (f) => {
    if (!f) return;
    const m = ctx.history.find((x) => x.id === Number(f.id));
    if (!m || !["msg", "img", "file"].includes(m.type)) return;
    const ch = chIn(f.to);
    const nick = canPost(m.text || "[encaminhada " + Date.now() + "]", ch);
    if (!nick) return;
    const fwd = { nick: m.nick, ch: chOf(m) };
    if (m.type === "msg") pushMessage(ctx, { type: "msg", nick, uid, text: m.text, ts: Date.now(), ch, fwd });
    else pushMessage(ctx, { type: m.type, nick, uid, src: m.src, name: m.name, size: m.size, ts: Date.now(), ch, fwd });
  });

  // fotos e audios do historico chegam sob demanda (quando aparecem na tela)
  socket.on("media", (id, reply) => {
    if (typeof reply !== "function") return;
    const m = ctx.history.find((x) => x.id === Number(id));
    reply(m && isMedia(m) ? m.src || null : null);
  });

  socket.on("image", (data, replyTo, ch, spoiler) => {
    if (typeof data !== "string" || data.length > MAX_IMAGE || !IMAGE_RE.test(data)) return;
    ch = chIn(ch);
    const nick = canPost("[foto " + Date.now() + "]", ch);
    if (!nick) return;
    pushMessage(ctx, { type: "img", nick, uid, src: data, ts: Date.now(), ch, spoiler: spoiler ? true : undefined, reply: quoteOf(ctx, replyTo) || undefined });
  });

  socket.on("audio", (data, replyTo, ch) => {
    if (typeof data !== "string" || data.length > MAX_AUDIO || !AUDIO_RE.test(data)) return notice("Áudio muito grande ou inválido (máximo 1 minuto).");
    ch = chIn(ch);
    const nick = canPost("[áudio " + Date.now() + "]", ch);
    if (!nick) return;
    pushMessage(ctx, { type: "audio", nick, uid, src: data, ts: Date.now(), ch, reply: quoteOf(ctx, replyTo) || undefined });
  });

  // Reacao: clicar de novo tira a sua
  socket.on("react", (msg) => {
    const nick = nickNow();
    if (!msg || typeof msg.emoji !== "string") return;
    const ce = CUSTOM_EMOJI_RE.exec(msg.emoji);
    if (ce ? !ctx.emojis.some((e) => e.id === ce[2]) : msg.emoji.length > 16 || !EMOJI_RE.test(msg.emoji)) return;
    if (blockedUntil(ctx.mutes, uid)) return notice("Você está silenciado.");
    const m = ctx.history.find((x) => x.id === Number(msg.id));
    if (!m || m.type === "sys") return;
    m.reactions = m.reactions || {};
    const who = m.reactions[msg.emoji] || [];
    const i = who.indexOf(nick);
    if (i >= 0) who.splice(i, 1);
    else {
      // so uma reacao por pessoa: a nova substitui a antiga
      for (const [emoji, list] of Object.entries(m.reactions)) {
        const j = list.indexOf(nick);
        if (j >= 0) list.splice(j, 1);
        if (!list.length) delete m.reactions[emoji];
      }
      who.push(nick);
    }
    if (who.length) m.reactions[msg.emoji] = who; else delete m.reactions[msg.emoji];
    toRoom(ctx, "message:update", { id: m.id, reactions: m.reactions });
    persist(ctx);
  });

  // Editar: so a propria mensagem de texto
  socket.on("edit", (msg) => {
    if (!msg) return;
    const m = ctx.history.find((x) => x.id === Number(msg.id));
    if (!m || m.type !== "msg" || m.uid !== uid) return;
    const text = String(msg.text || "").replace(/\r/g, "").trim().slice(0, MAX_TEXT);
    if (!text || text === m.text) return;
    if (text.split("\n").length > MAX_LINES) return notice("Mensagem com linhas demais (máximo " + MAX_LINES + ").");
    if (blockedWord(text)) return notice("Sua edição foi bloqueada pelo AutoMod deste servidor.");
    m.text = text; m.edited = Date.now();
    toRoom(ctx, "message:update", { id: m.id, text: m.text, edited: m.edited });
    persist(ctx);
  });

  // Fixar: qualquer membro fixa ou desfixa uma mensagem (como no Discord, aparece um aviso)
  socket.on("pin", (id) => {
    const m = ctx.history.find((x) => x.id === Number(id));
    if (!m || m.type === "sys") return;
    if (blockedUntil(ctx.mutes, uid)) return notice("Você está silenciado.");
    m.pinned = !m.pinned;
    toRoom(ctx, "message:update", { id: m.id, pinned: m.pinned });
    if (m.pinned) sys(ctx, nickNow() + " fixou uma mensagem neste canal.", chOf(m));
    persist(ctx);
  });

  // Apagar: a propria mensagem, ou qualquer uma se for da moderacao
  socket.on("delete", (id) => {
    const m = ctx.history.find((x) => x.id === Number(id));
    if (!m) return;
    if (!can("messages") && m.uid !== uid) return;
    if (m.uid !== uid) audit(ctx, nickNow(), "apagou uma mensagem de", m.nick || "sistema");
    dropMessages(ctx, [m]);
    toRoom(ctx, "message:delete", m.id);
    persist(ctx);
  });

  let lastTyping = 0;
  socket.on("typing", (ch) => {
    const now = Date.now();
    if (now - lastTyping < 1500) return;
    lastTyping = now;
    socket.to(ctx.room).emit("typing", { nick: nickNow(), ch: chIn(ch) });
  });

  socket.on("profile", (p) => {
    if (!p || typeof p !== "object") return;
    if (STATUSES.includes(p.status)) ctx.statuses.set(socket.id, p.status);
    if (typeof p.hideAct === "boolean") socket.data.hideAct = p.hideAct; // nao mostrar "jogando poker", "na call"...
    sendUsers(ctx);
  });

  // ---------- moderacao (dono e ADMs do servidor) ----------
  const target = (id) => ctx.members.find((m) => m.id === id);
  // ADM nao mexe no dono nem em outro ADM; o dono mexe em todo mundo
  const canTouch = (t) => t && t.id !== uid && t.role !== "owner" && (socket.data.role === "owner" || t.role === "member");
  const wrapAsync = (fn) => (...args) => fn(...args).catch((e) => { console.error("Erro na moderação:", e.message); notice("Deu erro. Tente de novo."); });

  socket.on("admin:clear", (ch) => {
    if (!can("messages")) return;
    ch = chIn(ch);
    const c = textChannel(ctx, ch);
    if (!c) return;
    dropMessages(ctx, ctx.history.filter((m) => chOf(m) === ch));
    toRoom(ctx, "channel:cleared", ch);
    sys(ctx, nickNow() + " limpou o canal", ch);
    audit(ctx, nickNow(), "limpou o canal", "#" + c.name);
  });

  // ---------- canais (dono e ADMs criam, editam e apagam) ----------
  const cleanName = (n, type) => {
    const t = String(n || "").trim().slice(0, 32);
    return type === "text" || type === "forum" ? t.toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "") : t.replace(/\s+/g, " ");
  };
  socket.on("channel:create", (c) => {
    if (!can("channels") || ctx.dm || !c) return;
    const type = ["voice", "forum"].includes(c.type) ? c.type : "text";
    const name = cleanName(c.name, type);
    if (!name) return notice("Dê um nome para o canal.");
    if (ctx.channels.filter((x) => x.type !== "thread").length >= MAX_CHANNELS) return notice("Máximo de " + MAX_CHANNELS + " canais.");
    const ch = { id: newId(), name, type };
    if (type === "text") { ch.topic = String(c.topic || "").trim().slice(0, 300); ch.slow = SLOW_STEPS.includes(Number(c.slow)) ? Number(c.slow) : 0; if (c.announce) ch.announce = true; }
    if (type === "forum") ch.topic = String(c.topic || "").trim().slice(0, 300);
    if (type === "voice" && c.stage) ch.stage = true;
    ctx.channels.push(ch);
    saveMeta(ctx, "channels"); sendChannels(ctx);
    audit(ctx, nickNow(), "criou o canal", (type === "text" ? "#" : "") + name);
  });
  socket.on("channel:update", (c) => {
    if (!c) return;
    const ch = ctx.channels.find((x) => x.id === c.id);
    if (!ch) return;
    // topico: quem criou tambem pode renomear
    if (!can("channels") && !(ch.type === "thread" && ch.uid === uid)) return;
    if (c.name !== undefined) { const n = cleanName(c.name, ch.type === "thread" ? "voice" : ch.type).slice(0, 100); if (n) ch.name = n; }
    if (ch.type === "text" || ch.type === "forum") {
      if (c.topic !== undefined) ch.topic = String(c.topic || "").trim().slice(0, 300);
      if (c.slow !== undefined && ch.type === "text") ch.slow = SLOW_STEPS.includes(Number(c.slow)) ? Number(c.slow) : 0;
      if (c.announce !== undefined && ch.type === "text") { if (c.announce) ch.announce = true; else delete ch.announce; }
    }
    if (ch.type === "voice" && c.stage !== undefined) { if (c.stage) ch.stage = true; else delete ch.stage; }
    if (ch.type === "thread" && ch.msg) { const root = ctx.history.find((x) => x.id === ch.msg); if (root && root.thread) { root.thread.name = ch.name; toRoom(ctx, "message:update", { id: root.id, thread: root.thread }); } }
    if (Number.isInteger(c.pos)) { const i = ctx.channels.indexOf(ch); ctx.channels.splice(i, 1); ctx.channels.splice(Math.max(0, Math.min(ctx.channels.length, c.pos)), 0, ch); }
    saveMeta(ctx, "channels"); sendChannels(ctx);
    audit(ctx, nickNow(), "editou o canal", (ch.type === "text" ? "#" : "") + ch.name);
  });
  socket.on("channel:delete", (id) => {
    const ch = ctx.channels.find((x) => x.id === id);
    if (!ch || (ctx.dm && ch.type !== "thread")) return;
    if (!can("channels") && !(ch.type === "thread" && ch.uid === uid)) return;
    if (ch.type === "text" && ctx.channels.filter((x) => x.type === "text").length <= 1) return notice("O servidor precisa de pelo menos um canal de texto.");
    if (ch.type === "voice" && [...ctx.callMembers.values()].some((m) => m.ch === ch.id)) return notice("Tem gente nesse canal de voz. Espere todo mundo sair.");
    // apagar um canal apaga os topicos dele junto
    const gone = new Set([ch.id, ...ctx.channels.filter((x) => x.type === "thread" && x.parent === ch.id).map((x) => x.id)]);
    ctx.channels = ctx.channels.filter((x) => !gone.has(x.id));
    if (ch.type !== "voice") { dropMessages(ctx, ctx.history.filter((m) => gone.has(chOf(m)))); persist(ctx); }
    if (ch.type === "thread" && ch.msg) { const root = ctx.history.find((x) => x.id === ch.msg); if (root) { delete root.thread; toRoom(ctx, "message:update", { id: root.id, thread: null }); persist(ctx); } }
    saveMeta(ctx, "channels"); sendChannels(ctx);
    audit(ctx, nickNow(), "apagou o canal", (ch.type === "text" ? "#" : "") + ch.name);
  });

  // ---------- AutoMod e registro de moderacao ----------
  socket.on("automod:get", (reply) => { if (can("server") && typeof reply === "function") reply(ctx.automod); });
  socket.on("automod:set", (a) => {
    if (!can("server") || !a || !Array.isArray(a.words)) return;
    ctx.automod.words = [...new Set(a.words.map((w) => String(w || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().slice(0, 40)).filter(Boolean))].slice(0, 200);
    saveMeta(ctx, "automod");
    audit(ctx, nickNow(), "mudou as palavras bloqueadas do AutoMod", ctx.automod.words.length + " palavras");
  });
  socket.on("admin:audit", (reply) => { if ((can("server") || can("members")) && typeof reply === "function") reply(ctx.audit); });

  // ---------- eventos do servidor ----------
  socket.on("event:create", (e) => {
    if (!e || ctx.dm) return;
    const title = String(e.title || "").trim().slice(0, 100);
    const when = Date.parse(e.when);
    if (!title || !when || when < Date.now() - 3600000) return notice("Dê um nome e uma data futura para o evento.");
    if (ctx.events.length >= 50) ctx.events.shift();
    ctx.events.push({ id: crypto.randomBytes(5).toString("hex"), title, desc: String(e.desc || "").trim().slice(0, 500), when, by: nickNow(), going: [nickNow()] });
    ctx.events.sort((a, b) => a.when - b.when);
    saveMeta(ctx, "events"); toRoom(ctx, "events", ctx.events);
    sys(ctx, nickNow() + " criou o evento \"" + title + "\"");
  });
  socket.on("event:going", (id) => {
    const ev = ctx.events.find((x) => x.id === id);
    if (!ev) return;
    const n = nickNow();
    ev.going = ev.going.includes(n) ? ev.going.filter((x) => x !== n) : [...ev.going, n];
    saveMeta(ctx, "events"); toRoom(ctx, "events", ctx.events);
  });
  socket.on("event:delete", (id) => {
    const ev = ctx.events.find((x) => x.id === id);
    if (!ev || (!can("server") && ev.by !== nickNow())) return;
    ctx.events = ctx.events.filter((x) => x !== ev);
    saveMeta(ctx, "events"); toRoom(ctx, "events", ctx.events);
  });

  socket.on("admin:mute", (msg) => {
    if (!can("members") || !msg) return;
    const t = target(msg.id);
    if (!canTouch(t)) return notice("Você não pode silenciar essa pessoa.");
    const min = Math.min(24 * 60, Math.max(0, Number(msg.minutes) || 0));
    ctx.floodMuted.delete(t.id);
    if (min) { ctx.mutes.set(t.id, Date.now() + min * 60000); sys(ctx, t.nick + " foi silenciado por " + min + " min"); audit(ctx, nickNow(), "silenciou por " + min + " min", t.nick); }
    else if (ctx.mutes.delete(t.id)) { sys(ctx, t.nick + " pode falar de novo"); audit(ctx, nickNow(), "liberou", t.nick); }
    saveMutes(ctx);
    sendModeration(ctx);
  });

  // Expulsar: tira do servidor (volta so com convite). Banir: tira e impede de voltar.
  socket.on("admin:kick", wrapAsync(async (msg) => {
    if (!can("members") || !msg) return;
    const t = target(msg.id);
    if (!canTouch(t)) return notice("Você não pode expulsar essa pessoa.");
    await db.remove("server_members", { server_id: "eq." + ctx.id, user_id: "eq." + t.id });
    removeUserFromCtx(ctx, t.id, "Você foi expulso do servidor " + ctx.name + ". Só volta com um convite novo.");
    sys(ctx, t.nick + " foi expulso do servidor");
    audit(ctx, nickNow(), "expulsou", t.nick);
    await loadMembers(ctx); sendUsers(ctx, true);
  }));

  socket.on("admin:ban", wrapAsync(async (msg) => {
    if (!can("ban") || !msg) return;
    const t = target(msg.id);
    if (!canTouch(t)) return notice("Você não pode banir essa pessoa.");
    const min = Math.max(0, Number(msg.minutes) || 0); // 0 = para sempre
    const until = min ? new Date(Date.now() + min * 60000).toISOString() : null;
    await db.upsert("server_bans", [{ server_id: ctx.id, user_id: t.id, until }], "server_id,user_id");
    await db.remove("server_members", { server_id: "eq." + ctx.id, user_id: "eq." + t.id });
    removeUserFromCtx(ctx, t.id, "Você foi banido do servidor " + ctx.name + (min ? " por " + (min >= 1440 ? min / 1440 + " dia(s)" : min + " min") : " para sempre") + ".");
    sys(ctx, t.nick + " foi banido " + (min ? "por " + (min >= 1440 ? min / 1440 + " dia(s)" : min + " min") : "para sempre"));
    audit(ctx, nickNow(), "baniu " + (min ? "por " + (min >= 1440 ? min / 1440 + " dia(s)" : min + " min") : "para sempre"), t.nick);
    await loadMembers(ctx); sendUsers(ctx, true);
    sendBans();
  }));

  async function sendBans() {
    if (!can("ban")) return;
    const rows = await db.select("server_bans", { select: "user_id,until", server_id: "eq." + ctx.id });
    const live = rows.filter((b) => !b.until || Date.parse(b.until) > Date.now());
    const profiles = await getProfiles(live.map((b) => b.user_id));
    const nick = new Map(profiles.map((p) => [p.id, p.nick]));
    for (const s of ctx.sockets.values()) if (sockCan(ctx, s, "ban")) s.emit("admin:bans", live.map((b) => ({ id: b.user_id, nick: nick.get(b.user_id) || "?", until: b.until })));
  }
  socket.on("admin:bans", wrapAsync(sendBans));

  socket.on("admin:unban", wrapAsync(async (id) => {
    if (!can("ban") || !UUID_RE.test(String(id))) return;
    await db.remove("server_bans", { server_id: "eq." + ctx.id, user_id: "eq." + id });
    audit(ctx, nickNow(), "desbaniu", ((await getProfile(id)) || {}).nick || "?");
    sendBans();
  }));

  // So o dono promove e rebaixa ADMs
  socket.on("admin:role", wrapAsync(async (msg) => {
    if (socket.data.role !== "owner" || !msg || !["admin", "member"].includes(msg.role)) return;
    const t = target(msg.id);
    if (!t || t.role === "owner") return;
    await db.update("server_members", { server_id: "eq." + ctx.id, user_id: "eq." + t.id }, { role: msg.role });
    for (const s of ctx.sockets.values()) if (s.data.user.id === t.id) { s.data.role = msg.role; s.emit("me", meOf(ctx, s)); }
    sys(ctx, t.nick + (msg.role === "admin" ? " agora é ADM do servidor" : " não é mais ADM"));
    audit(ctx, nickNow(), msg.role === "admin" ? "deu ADM para" : "tirou o ADM de", t.nick);
    await loadMembers(ctx); sendUsers(ctx);
    ctx.poker.broadcast(); ctx.truco.broadcast(); ctx.blefe.broadcast();
    sendModeration(ctx);
  }));



  // ---------- cargos personalizados (quem tem a permissao "roles") ----------
  const cleanColor = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || "")) ? String(c).toLowerCase() : null);
  // depois de mexer em cargos: todo mundo recebe as permissoes novas
  function rolesChanged() {
    saveMeta(ctx, "roles"); saveMeta(ctx, "memberRoles");
    sendGuild(ctx);
    for (const s of ctx.sockets.values()) s.emit("me", meOf(ctx, s));
    sendModeration(ctx);
  }
  socket.on("role:save", (r) => {
    if (!can("roles") || !r || ctx.dm) return;
    const name = String(r.name || "").replace(/\s+/g, " ").trim().slice(0, 32);
    if (!name) return notice("Dê um nome para o cargo.");
    const perms = (Array.isArray(r.perms) ? r.perms : []).filter((x) => PERMS.includes(x));
    // so o dono distribui a permissao de mexer em cargos
    if (socket.data.role !== "owner" && perms.includes("roles")) return notice("Só o dono pode dar a permissão de gerenciar cargos.");
    let role = r.id && ctx.roles.find((x) => x.id === r.id);
    if (!role) {
      if (ctx.roles.length >= MAX_ROLES) return notice("Máximo de " + MAX_ROLES + " cargos.");
      role = { id: newId() }; ctx.roles.push(role);
    }
    Object.assign(role, { name, color: cleanColor(r.color), perms, hoist: !!r.hoist, mention: !!r.mention });
    audit(ctx, nickNow(), "salvou o cargo", name);
    rolesChanged();
  });
  socket.on("role:delete", (id) => {
    if (!can("roles")) return;
    const role = ctx.roles.find((x) => x.id === id);
    if (!role) return;
    ctx.roles = ctx.roles.filter((x) => x !== role);
    for (const k of Object.keys(ctx.memberRoles)) { ctx.memberRoles[k] = ctx.memberRoles[k].filter((x) => x !== id); if (!ctx.memberRoles[k].length) delete ctx.memberRoles[k]; }
    audit(ctx, nickNow(), "apagou o cargo", role.name);
    rolesChanged();
  });
  socket.on("role:move", (m) => {
    if (!can("roles") || !m) return;
    const i = ctx.roles.findIndex((x) => x.id === m.id), j = i + (m.dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= ctx.roles.length) return;
    [ctx.roles[i], ctx.roles[j]] = [ctx.roles[j], ctx.roles[i]];
    rolesChanged();
  });
  socket.on("role:assign", (a) => {
    if (!can("roles") || !a) return;
    const t = target(a.uid), role = ctx.roles.find((x) => x.id === a.role);
    if (!t || !role) return;
    if (role.perms.includes("roles") && socket.data.role !== "owner") return notice("Só o dono dá esse cargo.");
    const list = new Set(ctx.memberRoles[t.id] || []);
    if (a.on) list.add(role.id); else list.delete(role.id);
    if (list.size) ctx.memberRoles[t.id] = [...list]; else delete ctx.memberRoles[t.id];
    audit(ctx, nickNow(), (a.on ? "deu o cargo " : "tirou o cargo ") + role.name, t.nick);
    rolesChanged();
  });

  // ---------- apelido no servidor (cada um muda o seu; a moderacao muda o dos outros) ----------
  socket.on("nick:set", (n) => {
    if (!n || ctx.dm) return;
    const who = n.uid && n.uid !== uid ? target(n.uid) : target(uid);
    if (!who) return;
    if (who.id !== uid && (!can("members") || !canTouch(who))) return notice("Você não pode mudar o apelido dessa pessoa.");
    const nick = cleanNick(n.nick);
    if (nick && NICK_BAD.test(nick)) return notice("O apelido não pode ter estes caracteres: * % _ , ( ) \" \\ : @ < >");
    if (nick && nick !== who.nick) ctx.nicks[who.id] = nick; else delete ctx.nicks[who.id];
    saveMeta(ctx, "nicks"); sendGuild(ctx);
    if (who.id !== uid) audit(ctx, nickNow(), "mudou o apelido de", who.nick + (nick ? " para " + nick : ""));
  });

  // ---------- topicos (de uma mensagem ou de um post de forum) ----------
  socket.on("thread:create", (t, reply) => {
    const done = typeof reply === "function" ? reply : () => {};
    if (!t) return done(null);
    const parent = ctx.channels.find((c) => c.id === t.parent && (c.type === "text" || c.type === "forum"));
    if (!parent) return done(null);
    if (ctx.channels.filter((c) => c.type === "thread").length >= MAX_THREADS) {
      // os topicos mais antigos sem movimento saem para dar lugar
      const old = ctx.channels.filter((c) => c.type === "thread").sort((a, b) => (a.last || 0) - (b.last || 0))[0];
      const gone = new Set([old.id]);
      ctx.channels = ctx.channels.filter((c) => c !== old);
      dropMessages(ctx, ctx.history.filter((m) => gone.has(chOf(m))));
      // a mensagem que tinha esse topico deixa de mostrar o link para ele
      const oldRoot = old.msg && ctx.history.find((x) => x.id === old.msg);
      if (oldRoot && oldRoot.thread) { delete oldRoot.thread; toRoom(ctx, "message:update", { id: oldRoot.id, thread: null }); }
      persist(ctx);
    }
    const root = t.msg ? ctx.history.find((x) => x.id === Number(t.msg) && chOf(x) === parent.id && x.type !== "sys") : null;
    if (t.msg && (!root || root.thread)) return done(root && root.thread ? root.thread.id : null);
    const text = String(t.text || "").replace(/\r/g, "").trim().slice(0, MAX_TEXT);
    if (parent.type === "forum" && !text) { notice("Escreva a mensagem do post."); return done(null); }
    let name = String(t.name || "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (!name && root) name = String(root.text || root.name || "Tópico").replace(/\s+/g, " ").slice(0, 40) || "Tópico";
    if (!name) { notice("Dê um nome para o tópico."); return done(null); }
    if (blockedWord(name + " " + text)) { notice("Bloqueado pelo AutoMod deste servidor."); return done(null); }
    if (blockedUntil(ctx.mutes, uid)) { notice("Você está silenciado."); return done(null); }
    const th = { id: newId(), name, type: "thread", parent: parent.id, msg: root ? root.id : null, by: nickNow(), uid, ts: Date.now(), last: Date.now(), count: 0 };
    if (parent.type === "forum") th.preview = text.slice(0, 200);
    ctx.channels.push(th);
    if (root) { root.thread = { id: th.id, name, count: 0, last: th.ts }; toRoom(ctx, "message:update", { id: root.id, thread: root.thread }); persist(ctx); }
    saveMeta(ctx, "channels"); sendChannels(ctx);
    if (text) pushMessage(ctx, { type: "msg", nick: nickNow(), uid, text, ts: Date.now(), ch: th.id });
    else if (root) sys(ctx, nickNow() + " começou o tópico " + name, parent.id);
    done(th.id);
  });

  // ---------- emojis e figurinhas do servidor ----------
  socket.on("emoji:add", (e) => {
    if (!can("server") || !e) return;
    const name = String(e.name || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 32);
    if (name.length < 2) return notice("O nome do emoji precisa de 2 letras ou mais (só letras, números e _).");
    if (typeof e.data !== "string" || e.data.length > MAX_EMOJI_IMG || !IMAGE_RE.test(e.data)) return notice("Imagem do emoji inválida ou grande demais.");
    if (ctx.emojis.length >= MAX_EMOJIS) return notice("Máximo de " + MAX_EMOJIS + " emojis.");
    if (ctx.emojis.some((x) => x.name.toLowerCase() === name.toLowerCase())) return notice("Já existe um emoji com esse nome.");
    ctx.emojis.push({ id: newId(), name, src: e.data, by: nickNow() });
    saveMeta(ctx, "emojis"); sendGuild(ctx);
  });
  socket.on("emoji:delete", (id) => {
    if (!can("server")) return;
    ctx.emojis = ctx.emojis.filter((x) => x.id !== id);
    saveMeta(ctx, "emojis"); sendGuild(ctx);
  });
  socket.on("sticker:add", (e) => {
    if (!can("server") || !e) return;
    const name = String(e.name || "").replace(/\s+/g, " ").trim().slice(0, 30);
    if (!name) return notice("Dê um nome para a figurinha.");
    if (typeof e.data !== "string" || e.data.length > MAX_STICKER_IMG || !IMAGE_RE.test(e.data)) return notice("Imagem da figurinha inválida ou grande demais.");
    if (ctx.stickers.length >= MAX_STICKERS) return notice("Máximo de " + MAX_STICKERS + " figurinhas.");
    ctx.stickers.push({ id: newId(), name, src: e.data, by: nickNow() });
    saveMeta(ctx, "stickers"); sendGuild(ctx);
  });
  socket.on("sticker:delete", (id) => {
    if (!can("server")) return;
    ctx.stickers = ctx.stickers.filter((x) => x.id !== id);
    saveMeta(ctx, "stickers"); sendGuild(ctx);
  });
  socket.on("sticker:get", (id, reply) => {
    if (typeof reply !== "function") return;
    const st = ctx.stickers.find((x) => x.id === id);
    reply(st ? st.src : null);
  });
  socket.on("sticker", (m) => {
    if (!m) return;
    const st = ctx.stickers.find((x) => x.id === m.id);
    if (!st) return;
    const ch = chIn(m.ch);
    const nick = canPost("[figurinha " + Date.now() + "]", ch);
    if (!nick) return;
    pushMessage(ctx, { type: "sticker", nick, uid, sticker: { id: st.id, name: st.name }, ts: Date.now(), ch, reply: quoteOf(ctx, m.replyTo) || undefined });
  });

  // ---------- webhooks (outros programas mandam mensagem num canal) ----------
  socket.on("webhook:list", (reply) => {
    if (!can("server") || typeof reply !== "function") return;
    reply(ctx.webhooks.map((w) => ({ id: w.id, name: w.name, ch: w.ch, url: "/api/webhooks/" + ctx.id + "/" + w.id + "/" + w.token })));
  });
  socket.on("webhook:create", (w) => {
    if (!can("server") || !w || ctx.dm) return;
    if (!ctx.channels.some((c) => c.id === w.ch && c.type === "text")) return notice("Escolha um canal de texto.");
    if (ctx.webhooks.length >= 10) return notice("Máximo de 10 webhooks.");
    const name = cleanNick(w.name) || "Capitão Gancho";
    ctx.webhooks.push({ id: newId(), token: crypto.randomBytes(24).toString("base64url"), name, ch: w.ch });
    saveMeta(ctx, "webhooks");
    audit(ctx, nickNow(), "criou o webhook", name);
    socket.emit("webhooks:changed");
  });
  socket.on("webhook:delete", (id) => {
    if (!can("server")) return;
    ctx.webhooks = ctx.webhooks.filter((x) => x.id !== id);
    saveMeta(ctx, "webhooks");
    socket.emit("webhooks:changed");
  });

  // ---------- tela de boas-vindas, link personalizado, banner e Descobrir ----------
  socket.on("welcome:set", (w) => {
    if (!can("server") || !w) return;
    ctx.welcome = {
      desc: String(w.desc || "").trim().slice(0, 500),
      rules: (Array.isArray(w.rules) ? w.rules : []).map((r) => String(r || "").trim().slice(0, 200)).filter(Boolean).slice(0, 10),
    };
    saveMeta(ctx, "welcome"); sendGuild(ctx);
    audit(ctx, nickNow(), "mudou a tela de boas-vindas", "");
  });
  socket.on("vanity:set", wrapAsync(async (code) => {
    if (!can("server") || ctx.dm) return;
    code = String(code || "").trim().toLowerCase();
    if (code && !/^[a-z0-9-]{3,32}$/.test(code)) return notice("O link precisa ter de 3 a 32 letras, números ou hífen.");
    if (code === ctx.vanity) return;
    if (code) {
      try { await db.insert("server_invites", [{ code, server_id: ctx.id, created_by: uid, expires_at: null }], false); }
      catch { return notice("Esse link já está em uso. Escolha outro."); }
    }
    if (ctx.vanity) await db.remove("server_invites", { code: "eq." + ctx.vanity, server_id: "eq." + ctx.id }).catch(() => {});
    ctx.vanity = code || null;
    saveMeta(ctx, "vanity"); sendGuild(ctx);
    audit(ctx, nickNow(), "mudou o link personalizado", code || "(nenhum)");
  }));
  socket.on("banner:set", (data) => {
    if (!can("server") || ctx.dm) return;
    if (data !== null && (typeof data !== "string" || data.length > MAX_BANNER || !IMAGE_RE.test(data))) return notice("Banner inválido ou grande demais.");
    ctx.banner = data;
    saveMeta(ctx, "banner");
    toRoom(ctx, "banner", data);
  });
  socket.on("discover:set", wrapAsync(async (d) => {
    if (!can("server") || !d || ctx.dm) return;
    const patch = { public: !!d.isPublic, description: String(d.description || "").trim().slice(0, 300) || null };
    await db.update("servers", { id: "eq." + ctx.id }, patch);
    ctx.isPublic = patch.public; ctx.description = patch.description || "";
    sendGuild(ctx);
    audit(ctx, nickNow(), patch.public ? "colocou o servidor no Descobrir" : "tirou o servidor do Descobrir", "");
  }));

  // ---------- palco: so quem e orador fala; a plateia levanta a mao ----------
  const isStage = (ch) => !!(ctx.channels.find((c) => c.id === ch) || {}).stage;
  socket.on("stage:hand", (up) => {
    const me = ctx.callMembers.get(socket.id);
    if (!me || !isStage(me.ch) || me.speaker) return;
    me.hand = !!up;
    sendCall(ctx);
  });
  socket.on("stage:speaker", (m) => {
    const me = ctx.callMembers.get(socket.id);
    if (!m) return;
    const t = ctx.callMembers.get(m.sid);
    if (!t || !isStage(t.ch)) return;
    // a moderacao convida e tira; cada um pode descer do palco sozinho
    if (!(can("members") || (m.sid === socket.id && !m.on))) return;
    t.speaker = !!m.on; t.hand = false;
    if (!t.speaker) { t.mic = false; t.cam = null; t.screen = null; }
    sendCall(ctx);
    if (me && t !== me) io.to(m.sid).emit("notice", m.on ? me.nick + " convidou você para falar no palco." : "Você voltou para a plateia.");
  });

  // ---------- call ----------
  socket.on("call:join", (state, reply) => {
    if (typeof reply !== "function") return;
    const ch = state && voiceChannel(ctx, state.ch) ? state.ch : (ctx.channels.find((c) => c.type === "voice") || {}).id;
    if (!ch) return reply({ ok: false });
    const others = [...ctx.callMembers.values()].filter((m) => m.id !== socket.id && m.ch === ch).map((m) => m.id);
    const member = { id: socket.id, nick: nickNow(), uid, ...cleanCallState(state), ch };
    if (isStage(ch)) { member.speaker = can("members"); member.hand = false; if (!member.speaker) Object.assign(member, { mic: false, cam: null, screen: null }); }
    ctx.callMembers.set(socket.id, member);
    reply({ ok: true, others });
    sendCall(ctx);
    // conversa privada: quem comeca liga para os outros; quem entra para de tocar
    if (ctx.dm) {
      if (!ctx.ring) startDmCall(ctx, uid, member.nick, state && state.video);
      else { ctx.ring.joined.add(uid); stopRing(ctx, uid); }
    }
  });

  // "Tocar novamente": quem esta na chamada liga de novo para alguem da conversa
  socket.on("call:ring", (who) => {
    if (!ctx.dm || !ctx.ring || !ctx.callMembers.has(socket.id) || who === uid || ctx.ring.targets.has(who)) return;
    ringUser(ctx, String(who || ""));
    sendRinging(ctx);
  });
  // "Ignorar": para de tocar so para mim (em todas as minhas abas), de qualquer pagina do site
  socket.on("call:decline", (serverId) => {
    const c = ringingCtx.get(String(serverId || ""));
    if (c && c.ring && c.ring.targets.has(uid)) stopRing(c, uid);
  });

  socket.on("call:state", (state) => {
    const member = ctx.callMembers.get(socket.id);
    if (!member) return;
    Object.assign(member, cleanCallState(state));
    if (isStage(member.ch) && !member.speaker) Object.assign(member, { mic: false, cam: null, screen: null });
    sendCall(ctx);
  });

  socket.on("call:signal", (msg) => {
    if (!msg || !ctx.callMembers.has(socket.id) || !ctx.callMembers.has(msg.to)) return;
    if (ctx.callMembers.get(socket.id).ch !== ctx.callMembers.get(msg.to).ch) return; // so dentro do mesmo canal de voz
    if (JSON.stringify(msg).length > 100 * 1024) return;
    io.to(msg.to).emit("call:signal", { from: socket.id, description: msg.description, candidate: msg.candidate });
  });

  // Assistir junto: um video do YouTube sincronizado para a call
  socket.on("watch:set", (url) => {
    const member = ctx.callMembers.get(socket.id);
    const m = String(url || "").match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/) || String(url || "").match(/^([A-Za-z0-9_-]{11})$/);
    if (!member) return;
    if (!m) return notice("Esse link não parece ser do YouTube.");
    ctx.watch = { id: m[1], playing: true, pos: 0, at: Date.now(), by: member.nick, ch: member.ch };
    toRoom(ctx, "watch:state", watchMsg(ctx));
  });

  socket.on("watch:control", (msg) => {
    const member = ctx.callMembers.get(socket.id);
    if (!member || !ctx.watch || !msg || member.ch !== ctx.watch.ch) return;
    const pos = Math.max(0, Number(msg.pos) || 0);
    if (msg.action === "play") Object.assign(ctx.watch, { playing: true, pos, at: Date.now() });
    else if (msg.action === "pause") Object.assign(ctx.watch, { playing: false, pos, at: Date.now() });
    else if (msg.action === "seek") Object.assign(ctx.watch, { pos, at: Date.now() });
    else return;
    ctx.watch.by = member.nick;
    toRoom(ctx, "watch:state", watchMsg(ctx));
  });

  socket.on("watch:stop", () => {
    if (!ctx.callMembers.has(socket.id) || !ctx.watch) return;
    ctx.watch = null;
    toRoom(ctx, "watch:state", null);
  });

  function leaveCall() {
    if (!ctx.callMembers.delete(socket.id)) return;
    sendCall(ctx);
    if (ctx.dm) endDmCall(ctx);
  }
  socket.on("call:leave", leaveCall);

  socket.on("disconnect", () => {
    leaveCall();
    const nick = nickNow();
    ctx.sockets.delete(socket.id);
    ctx.online.delete(socket.id);
    ctx.statuses.delete(socket.id);
    sendUsers(ctx);
    // a mesma conta pode estar em outra aba: so sai dos jogos quando fecha a ultima
    if (nick && ![...ctx.online.values()].includes(nick)) { ctx.poker.left(nick); ctx.truco.left(nick); ctx.blefe.left(nick); }
  });
});

if (!ready()) console.log("ATENÇÃO: falta SUPABASE_SECRET_KEY no Render. Sem ela ninguém consegue entrar no site.");
cleanupExpired();

// ---------- faxina: o banco gratis do Supabase tem 500 MB ----------
// Passando de STORAGE_LIMIT_MB, as fotos, audios e arquivos mais antigos (de todos os servidores) sao
// apagados ate o chat voltar a STORAGE_TARGET_MB. Mensagens de texto nunca sao apagadas pela faxina.
const STORAGE_LIMIT = Number(process.env.STORAGE_LIMIT_MB || 380) * 1024 * 1024;
const STORAGE_TARGET = Number(process.env.STORAGE_TARGET_MB || 300) * 1024 * 1024;
async function trimStorage() {
  if (!ready()) return;
  try {
    const keys = await db.rpc("chat_kv_trim_media", { limit_bytes: Math.round(STORAGE_LIMIT), target_bytes: Math.round(STORAGE_TARGET) });
    if (!Array.isArray(keys) || !keys.length) return;
    console.log("Faxina: " + keys.length + " fotos/áudios/arquivos antigos apagados para liberar espaço no banco");
    // tira essas midias tambem dos servidores que estao abertos agora
    const byServer = new Map();
    for (const k of keys) {
      const m = /^srv:([^:]+):media:(\d+)$/.exec(String(k));
      if (m) byServer.set(m[1], [...(byServer.get(m[1]) || []), Number(m[2])]);
    }
    for (const [sid, ids] of byServer) {
      const ctx = contexts.has(sid) ? await contexts.get(sid).catch(() => null) : null;
      if (!ctx) continue;
      const gone = ctx.history.filter((m) => isMedia(m) && ids.includes(m.id));
      if (!gone.length) continue;
      dropMessages(ctx, gone);
      for (const m of gone) toRoom(ctx, "message:delete", m.id);
      persist(ctx);
    }
  } catch (e) { console.error("Faxina do banco:", e.message); }
}
setTimeout(trimStorage, Number(process.env.FAXINA_FIRST_MS || 60000));
setInterval(trimStorage, Number(process.env.FAXINA_MS || 30 * 60000));
// ---------- Painel "adm" do site: som, foto, video e audio na tela de todo mundo ----------
// A senha fica so no Render (ADMIN_PASSWORD); sem ela o painel fica desligado.
const fs = require("fs");
const os = require("os");
const ADM_MAX = 40 * 1024 * 1024; // arquivo de ate 40 MB (o plano gratis tem pouca memoria e disco)
const ADM_FILE = path.join(os.tmpdir(), "chatpedro-adm-media");
const admTokens = new Map(); // token -> quando vence
const admTries = new Map();  // ip -> { n, at } (tentativas de senha erradas)
let admMedia = null;         // { id, kind, mime, size, name }
let admShow = null;          // o que esta na tela de todo mundo agora: { id, kind, at }
const admOk = (req) => { const t = req.get("x-adm") || ""; const v = admTokens.get(t); if (v && v > Date.now()) return true; admTokens.delete(t); return false; };
const admGuard = (req, res, next) => (admOk(req) ? next() : res.status(401).json({ error: "Entre de novo com a senha." }));
// canal proprio (sem login): chega ate em quem esta na tela de entrada ou fora de servidor
const admNs = io.of("/adm");
// Versao do site: muda quando os arquivos mudam (nao quando o Render so acorda). O navegador compara e recarrega.
const SITE_VERSION = (() => {
  const h = crypto.createHash("sha1");
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) walk(full); else { h.update(f.name); h.update(fs.readFileSync(full)); }
    }
  };
  try {
    walk(path.join(__dirname, "public"));
    for (const f of ["server.js", "db.js", "storage.js", "poker.js", "truco.js", "blefe.js"]) h.update(fs.readFileSync(path.join(__dirname, f)));
  } catch (e) { console.error("Versao do site:", e.message); h.update(String(Date.now())); }
  return h.digest("hex").slice(0, 12);
})();
admNs.on("connection", (s) => { s.emit("site:version", SITE_VERSION); if (admShow) s.emit("adm:show", admShowMsg()); });
const admShowMsg = () => (admShow && admMedia ? { ...admShow, url: "/api/adm/media/" + admMedia.id, mime: admMedia.mime, now: Date.now() } : null);

api.post("/adm/login", (req, res) => {
  const pass = process.env.ADMIN_PASSWORD || "";
  if (!pass) return res.status(503).json({ error: "O painel está desligado: falta a senha ADMIN_PASSWORD no Render." });
  const ip = req.ip, t = admTries.get(ip) || { n: 0, at: Date.now() };
  if (Date.now() - t.at > 15 * 60 * 1000) { t.n = 0; t.at = Date.now(); }
  if (t.n >= 5) return res.status(429).json({ error: "Muitas tentativas. Espere 15 minutos." });
  const a = crypto.createHash("sha256").update(String((req.body || {}).senha || "")).digest();
  const b = crypto.createHash("sha256").update(pass).digest();
  if (!crypto.timingSafeEqual(a, b)) { t.n++; admTries.set(ip, t); return res.status(403).json({ error: "Senha errada." }); }
  admTries.delete(ip);
  for (const [t, until] of admTokens) if (until <= Date.now()) admTokens.delete(t); // tira as chaves vencidas
  const token = crypto.randomBytes(24).toString("hex");
  admTokens.set(token, Date.now() + 12 * 3600 * 1000);
  res.json({ token, media: admMedia, showing: !!admShow });
});

api.post("/adm/media", admGuard, express.raw({ type: () => true, limit: ADM_MAX }), (req, res) => {
  const mime = String(req.get("content-type") || "").split(";")[0].toLowerCase();
  const kind = /^image\/(jpeg|png|gif|webp)$/.test(mime) ? "img" : /^video\/(mp4|webm|ogg|quicktime)$/.test(mime) ? "video" : /^audio\/(mpeg|mp3|mp4|x-m4a|aac|ogg|wav|x-wav|webm)$/.test(mime) ? "audio" : null;
  if (!kind) return res.status(400).json({ error: "Use uma foto (JPG, PNG, GIF, WEBP), um vídeo (MP4, WEBM) ou um áudio (MP3, M4A, OGG, WAV)." });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Arquivo vazio." });
  if (admShow) { admShow = null; admNs.emit("adm:show", null); }
  fs.writeFile(ADM_FILE, req.body, (err) => {
    if (err) return res.status(500).json({ error: "Não deu para guardar o arquivo." });
    admMedia = { id: crypto.randomBytes(8).toString("hex"), kind, mime, size: req.body.length, name: (() => { try { return decodeURIComponent(req.get("x-name") || ""); } catch { return ""; } })().slice(0, 80) };
    res.json({ media: admMedia });
  });
});

api.get("/adm/media/:id", (req, res) => {
  if (!admMedia || req.params.id !== admMedia.id) return res.sendStatus(404);
  res.type(admMedia.mime);
  res.sendFile(ADM_FILE, { maxAge: "1h" }); // sendFile entende "Range": o video pode ser pulado e toca no iPhone
});

api.post("/adm/start", admGuard, (req, res) => {
  if (!admMedia) return res.status(400).json({ error: "Escolha um arquivo primeiro." });
  admShow = { id: admMedia.id, kind: admMedia.kind, at: Date.now() };
  admNs.emit("adm:show", admShowMsg());
  res.json({ ok: true });
});
api.post("/adm/stop", admGuard, (req, res) => { admShow = null; admNs.emit("adm:show", null); res.json({ ok: true }); });
api.post("/adm/beep", admGuard, (req, res) => { admNs.emit("adm:beep"); res.json({ ok: true }); });

// ultima rede de seguranca: um erro esquecido vai para o registro em vez de desligar o site
process.on("uncaughtException", (e) => console.error("Erro sem tratamento:", e && e.stack || e));
process.on("unhandledRejection", (e) => console.error("Promessa sem tratamento:", e && e.message || e));

server.listen(PORT, () => console.log(`Chat Pedro rodando na porta ${PORT}`));

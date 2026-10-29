const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const { createPoker } = require("./poker");
const { createTruco } = require("./truco");
const { createStorage, cleanupExpired } = require("./storage");
const { db, auth, ready, SUPABASE_URL, PUBLISHABLE_KEY } = require("./db");

const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 200; // quantas mensagens ficam guardadas por servidor
const MAX_TEXT = 2000;
const MAX_LINES = 12;
const MAX_NICK = 20;
const MAX_SERVER_NAME = 40;
const MAX_SERVERS_OWNED = 10;
const MAX_IMAGE = 3 * 1024 * 1024; // tamanho maximo da foto (ja comprimida) em bytes de texto
const MAX_AUDIO = 1.5 * 1024 * 1024; // audio de ate ~1 minuto
const MAX_MEDIA_KEPT = 40; // fotos e audios mais antigos que isso saem do historico
const IMAGE_RE = /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const AUDIO_RE = /^data:audio\/(webm|ogg|mp4|mpeg|aac)(;codecs=[A-Za-z0-9.,=-]+)?;base64,[A-Za-z0-9+/=]+$/;
const MAX_SERVER_ICON = 120 * 1024; // foto do servidor ja vem pequena (96x96) do navegador
const MAX_AVATAR = 60 * 1024; // foto de perfil ja vem pequena (48x48) do navegador
const REACTIONS = ["\u{1F602}", "\u{1F525}", "\u{1F480}", "\u{1F44D}", "\u2764\uFE0F", "\u{1F62E}"];
const NAME_COLORS = ["#33ff66", "#b6ffc8", "#ffd84d", "#ffb000", "#ff7a59", "#ff5fa2", "#c792ff", "#5fd7ff", "#7aa2ff", "#e6e6e6"];
const STATUSES = ["online", "ausente", "ocupado"];
const SFX = ["buzina", "ihhh", "risada", "aplausos", "tambor", "erro"];
const INVITE_HOURS = [1, 24, 168, 0]; // 0 = nunca vence

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
const INDEX = path.join(__dirname, "public", "index.html");

app.set("trust proxy", true); // o Render fica na frente do servidor
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(__dirname, "public")));
// biblioteca de login do Supabase servida daqui mesmo (nao depende de CDN)
app.use("/vendor/supabase", express.static(path.join(__dirname, "node_modules", "@supabase", "supabase-js", "dist", "umd")));
app.get(["/s/:id", "/convite/:code"], (req, res) => res.sendFile(INDEX));

const keyOf = (nick) => String(nick || "").toLowerCase();
const isMedia = (m) => m.type === "img" || m.type === "audio";
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
    const rows = await db.select("profiles", { select: "id,nick,avatar,color", id: db.inList(missing) });
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
    const user = { id: u.id, email: u.email };
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
  const [srv] = await db.select("servers", { select: "id,name,owner_id,icon", id: "eq." + serverId });
  if (!srv) throw new Error("servidor não existe");
  const ctx = {
    id: serverId, name: srv.name, icon: srv.icon || null, ownerId: srv.owner_id, room: "srv:" + serverId,
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
  }
  // os jogos enxergam so quem esta neste servidor
  const scopedIo = { sockets: { sockets: ctx.sockets }, emit: (ev, data) => io.to(ctx.room).emit(ev, data) };
  const helpers = {
    nickOf: (id) => ctx.online.get(id),
    isAdmin: (id) => { const s = ctx.sockets.get(id); return !!s && ["owner", "admin"].includes(s.data.role); },
  };
  ctx.poker = createPoker(scopedIo, helpers);
  ctx.truco = createTruco(scopedIo, helpers);
  await loadMembers(ctx);
  return ctx;
}

async function loadMembers(ctx) {
  const rows = await db.select("server_members", { select: "user_id,role", server_id: "eq." + ctx.id });
  const profiles = await getProfiles(rows.map((r) => r.user_id));
  const byId = new Map(profiles.map((p) => [p.id, p]));
  ctx.members = rows.filter((r) => byId.has(r.user_id)).map((r) => ({ ...byId.get(r.user_id), role: r.role }));
}

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
  ctx.history.push(msg);
  if (ctx.storage && isMedia(msg)) ctx.storage.saveMedia(msg.id, msg.src);
  const old = [];
  if (ctx.history.length > MAX_HISTORY) old.push(ctx.history[0]);
  const media = ctx.history.filter(isMedia);
  if (media.length > MAX_MEDIA_KEPT) old.push(media[0]);
  dropMessages(ctx, old);
  toRoom(ctx, "message", msg);
  persist(ctx);
}
// Historico sem o conteudo das fotos e audios (que sao pesados): o navegador pede cada um quando precisa
const historyFor = (ctx) => ctx.history.map((m) => (isMedia(m) ? { ...m, src: undefined, lazy: true } : m));
const sys = (ctx, text) => pushMessage(ctx, { type: "sys", text, ts: Date.now() });

const watchMsg = (ctx) => ctx.watch && { ...ctx.watch, now: Date.now() }; // "now" deixa cada um corrigir o proprio relogio

function sendCall(ctx) {
  toRoom(ctx, "call:members", [...ctx.callMembers.values()]);
  if (!ctx.callMembers.size && ctx.watch) { ctx.watch = null; toRoom(ctx, "watch:state", null); }
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
  const onlineIds = new Set([...ctx.sockets.values()].map((s) => s.data.user.id));
  toRoom(ctx, "users", [...new Set(ctx.online.values())].sort());
  const profiles = {};
  for (const m of ctx.members) profiles[keyOf(m.nick)] = { color: m.color || undefined, status: "offline" };
  for (const [id, nick] of ctx.online) profiles[keyOf(nick)] = { ...(profiles[keyOf(nick)] || {}), status: ctx.statuses.get(id) || "online" };
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
  const text = m.type === "img" ? "foto" : m.type === "audio" ? "áudio" : m.text.slice(0, 90);
  return { id: m.id, nick: m.nick, text };
}

// Lista de silenciados, so para quem modera
function sendModeration(ctx) {
  const muted = [...ctx.mutes.entries()].filter(([, until]) => until > Date.now()).map(([uid, until]) => {
    const m = ctx.members.find((x) => x.id === uid);
    return { id: uid, nick: m ? m.nick : "?", min: minutesLeft(until) };
  });
  for (const s of ctx.sockets.values()) if (["owner", "admin"].includes(s.data.role)) s.emit("admin:moderation", { muted });
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
  const rows = await db.select("server_members", { select: "role,server:servers(id,name,owner_id,icon)", user_id: "eq." + user.id, order: "joined_at.asc" });
  res.json({ user: { id: user.id, email: user.email }, profile, servers: rows.filter((r) => r.server).map((r) => ({ id: r.server.id, name: r.server.name, icon: r.server.icon || null, role: r.role })) });
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
  if (req.body.color !== undefined) { if (!NAME_COLORS.includes(req.body.color)) return fail(res, 400, "Cor inválida."); patch.color = req.body.color; }
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
      }
      persist(ctx);
      ctx.poker.rename(old.nick, patch.nick);
      ctx.truco.rename(old.nick, patch.nick);
      if (wasOnline) sendCall(ctx);
      sys(ctx, old.nick + " agora se chama " + patch.nick);
    }
    sendUsers(ctx, !!(patch.nick || patch.avatar));
  }
  res.json({ profile });
}));

api.post("/servers", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const name = String(req.body.name || "").replace(/\s+/g, " ").trim().slice(0, MAX_SERVER_NAME);
  if (!name) return fail(res, 400, "Dê um nome para o servidor.");
  const owned = await db.select("servers", { select: "id", owner_id: "eq." + user.id });
  if (owned.length >= MAX_SERVERS_OWNED) return fail(res, 400, "Você já é dono de " + MAX_SERVERS_OWNED + " servidores.");
  const [srv] = await db.insert("servers", [{ name, owner_id: user.id }]);
  await db.insert("server_members", [{ server_id: srv.id, user_id: user.id, role: "owner" }], false);
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
  if (role === "owner") return fail(res, 400, "O dono não pode sair. Apague o servidor se não quiser mais ele.");
  await db.remove("server_members", { server_id: "eq." + req.params.id, user_id: "eq." + user.id });
  if (contexts.has(req.params.id)) {
    const ctx = await contexts.get(req.params.id);
    removeUserFromCtx(ctx, user.id, "Você saiu do servidor.");
    await loadMembers(ctx); sendUsers(ctx, true);
  }
  res.json({ ok: true });
}));

api.post("/servers/:id/invites", wrap(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  if (!(await requireRole(req, res, user, ["owner", "admin", "member"]))) return;
  const hours = INVITE_HOURS.includes(Number(req.body.hours)) ? Number(req.body.hours) : 24;
  const code = crypto.randomBytes(6).toString("base64url");
  await db.insert("server_invites", [{ code, server_id: req.params.id, created_by: user.id, expires_at: hours ? new Date(Date.now() + hours * 3600000).toISOString() : null }], false);
  res.json({ code, hours });
}));

async function findInvite(code) {
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(code)) return null;
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
      if (p) sys(ctx, p.nick + " entrou no servidor pelo convite");
    }
  }
  res.json({ server: inv.server });
}));

// ---------- conexao em tempo real: so com login e sendo membro do servidor ----------
io.use(async (socket, next) => {
  try {
    if (!ready()) return next(new Error("sem_banco"));
    const { token, server: serverId } = socket.handshake.auth || {};
    const user = await userFromToken(token);
    if (!user) return next(new Error("login"));
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
  return { uid: s.data.user.id, nick: s.data.nick, role: s.data.role, server: { id: ctx.id, name: ctx.name, icon: ctx.icon } };
}

io.on("connection", (socket) => {
  const ctx = socket.data.ctx;
  const uid = socket.data.user.id;
  socket.join(ctx.room);
  ctx.sockets.set(socket.id, socket);
  ctx.online.set(socket.id, socket.data.nick);
  if (!ctx.members.some((m) => m.id === uid)) loadMembers(ctx).then(() => sendUsers(ctx, true)).catch(() => {});

  socket.emit("me", meOf(ctx, socket));
  socket.emit("avatars", avatarsOf(ctx));
  socket.emit("history", historyFor(ctx));
  socket.emit("call:members", [...ctx.callMembers.values()]);
  socket.emit("ice", ICE_SERVERS);
  socket.emit("watch:state", watchMsg(ctx));
  sendUsers(ctx);
  ctx.poker.handle(socket);
  ctx.truco.handle(socket);
  ctx.poker.broadcast();
  ctx.truco.broadcast();
  ctx.poker.refresh();

  const nickNow = () => ctx.online.get(socket.id);
  const isMod = () => ["owner", "admin"].includes(socket.data.role);
  const notice = (text) => socket.emit("notice", text);
  if (isMod()) sendModeration(ctx);

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

  // Confere se pode mandar algo no chat (silenciado, flood)
  function canPost(text) {
    const muted = blockedUntil(ctx.mutes, uid);
    if (muted) { notice("Você está silenciado " + (ctx.floodMuted.has(uid) ? "por flood" : "pela moderação") + " por mais " + minutesLeft(muted) + " min."); return null; }
    const err = floodCheck(text);
    if (err) { notice(err); return null; }
    return nickNow();
  }

  // ack(false) avisa o navegador para tirar da tela a mensagem que ele ja mostrou
  socket.on("message", (msg, ack) => {
    const done = typeof ack === "function" ? ack : () => {};
    const raw = typeof msg === "string" ? msg : msg && msg.text;
    const text = String(raw || "").replace(/\r/g, "").trim().slice(0, MAX_TEXT);
    if (!text) return done(false);
    const nick = canPost(text);
    if (!nick) return done(false);
    const reply = msg && typeof msg === "object" && msg.replyTo ? quoteOf(ctx, msg.replyTo) : null;
    pushMessage(ctx, { type: "msg", nick, uid, text, ts: Date.now(), reply: reply || undefined });
    done(true);
  });

  // fotos e audios do historico chegam sob demanda (quando aparecem na tela)
  socket.on("media", (id, reply) => {
    if (typeof reply !== "function") return;
    const m = ctx.history.find((x) => x.id === Number(id));
    reply(m && isMedia(m) ? m.src || null : null);
  });

  socket.on("image", (data, replyTo) => {
    if (typeof data !== "string" || data.length > MAX_IMAGE || !IMAGE_RE.test(data)) return;
    const nick = canPost("[foto " + Date.now() + "]");
    if (!nick) return;
    pushMessage(ctx, { type: "img", nick, uid, src: data, ts: Date.now(), reply: quoteOf(ctx, replyTo) || undefined });
  });

  socket.on("audio", (data, replyTo) => {
    if (typeof data !== "string" || data.length > MAX_AUDIO || !AUDIO_RE.test(data)) return notice("Áudio muito grande ou inválido (máximo 1 minuto).");
    const nick = canPost("[áudio " + Date.now() + "]");
    if (!nick) return;
    pushMessage(ctx, { type: "audio", nick, uid, src: data, ts: Date.now(), reply: quoteOf(ctx, replyTo) || undefined });
  });

  // Reacao: clicar de novo tira a sua
  socket.on("react", (msg) => {
    const nick = nickNow();
    if (!msg || !REACTIONS.includes(msg.emoji)) return;
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

  // Apagar: a propria mensagem, ou qualquer uma se for da moderacao
  socket.on("delete", (id) => {
    const m = ctx.history.find((x) => x.id === Number(id));
    if (!m) return;
    if (!isMod() && m.uid !== uid) return;
    dropMessages(ctx, [m]);
    toRoom(ctx, "message:delete", m.id);
    persist(ctx);
  });

  let lastTyping = 0;
  socket.on("typing", () => {
    const now = Date.now();
    if (now - lastTyping < 1500) return;
    lastTyping = now;
    socket.to(ctx.room).emit("typing", nickNow());
  });

  socket.on("profile", (p) => {
    if (!p || typeof p !== "object") return;
    if (STATUSES.includes(p.status)) ctx.statuses.set(socket.id, p.status);
    sendUsers(ctx);
  });

  // ---------- moderacao (dono e ADMs do servidor) ----------
  const target = (id) => ctx.members.find((m) => m.id === id);
  // ADM nao mexe no dono nem em outro ADM; o dono mexe em todo mundo
  const canTouch = (t) => t && t.id !== uid && t.role !== "owner" && (socket.data.role === "owner" || t.role === "member");

  socket.on("admin:clear", () => {
    if (!isMod()) return;
    dropMessages(ctx, [...ctx.history]);
    toRoom(ctx, "history", []);
    sys(ctx, nickNow() + " limpou o chat");
  });

  socket.on("admin:mute", (msg) => {
    if (!isMod() || !msg) return;
    const t = target(msg.id);
    if (!canTouch(t)) return notice("Você não pode silenciar essa pessoa.");
    const min = Math.min(24 * 60, Math.max(0, Number(msg.minutes) || 0));
    ctx.floodMuted.delete(t.id);
    if (min) { ctx.mutes.set(t.id, Date.now() + min * 60000); sys(ctx, t.nick + " foi silenciado por " + min + " min"); }
    else if (ctx.mutes.delete(t.id)) sys(ctx, t.nick + " pode falar de novo");
    sendModeration(ctx);
  });

  // Expulsar: tira do servidor (volta so com convite). Banir: tira e impede de voltar.
  socket.on("admin:kick", wrapAsync(async (msg) => {
    if (!isMod() || !msg) return;
    const t = target(msg.id);
    if (!canTouch(t)) return notice("Você não pode expulsar essa pessoa.");
    await db.remove("server_members", { server_id: "eq." + ctx.id, user_id: "eq." + t.id });
    removeUserFromCtx(ctx, t.id, "Você foi expulso do servidor " + ctx.name + ". Só volta com um convite novo.");
    sys(ctx, t.nick + " foi expulso do servidor");
    await loadMembers(ctx); sendUsers(ctx, true);
  }));

  socket.on("admin:ban", wrapAsync(async (msg) => {
    if (!isMod() || !msg) return;
    const t = target(msg.id);
    if (!canTouch(t)) return notice("Você não pode banir essa pessoa.");
    const min = Math.max(0, Number(msg.minutes) || 0); // 0 = para sempre
    const until = min ? new Date(Date.now() + min * 60000).toISOString() : null;
    await db.upsert("server_bans", [{ server_id: ctx.id, user_id: t.id, until }], "server_id,user_id");
    await db.remove("server_members", { server_id: "eq." + ctx.id, user_id: "eq." + t.id });
    removeUserFromCtx(ctx, t.id, "Você foi banido do servidor " + ctx.name + (min ? " por " + (min >= 1440 ? min / 1440 + " dia(s)" : min + " min") : " para sempre") + ".");
    sys(ctx, t.nick + " foi banido " + (min ? "por " + (min >= 1440 ? min / 1440 + " dia(s)" : min + " min") : "para sempre"));
    await loadMembers(ctx); sendUsers(ctx, true);
    sendBans();
  }));

  async function sendBans() {
    if (!isMod()) return;
    const rows = await db.select("server_bans", { select: "user_id,until", server_id: "eq." + ctx.id });
    const live = rows.filter((b) => !b.until || Date.parse(b.until) > Date.now());
    const profiles = await getProfiles(live.map((b) => b.user_id));
    const nick = new Map(profiles.map((p) => [p.id, p.nick]));
    for (const s of ctx.sockets.values()) if (["owner", "admin"].includes(s.data.role)) s.emit("admin:bans", live.map((b) => ({ id: b.user_id, nick: nick.get(b.user_id) || "?", until: b.until })));
  }
  socket.on("admin:bans", wrapAsync(sendBans));

  socket.on("admin:unban", wrapAsync(async (id) => {
    if (!isMod() || !UUID_RE.test(String(id))) return;
    await db.remove("server_bans", { server_id: "eq." + ctx.id, user_id: "eq." + id });
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
    await loadMembers(ctx); sendUsers(ctx);
    ctx.poker.broadcast(); ctx.truco.broadcast();
    sendModeration(ctx);
  }));

  function wrapAsync(fn) {
    return (...args) => fn(...args).catch((e) => { console.error("Erro na moderação:", e.message); notice("Deu erro. Tente de novo."); });
  }

  // ---------- call ----------
  socket.on("call:join", (state, reply) => {
    if (typeof reply !== "function") return;
    const others = [...ctx.callMembers.keys()].filter((id) => id !== socket.id);
    ctx.callMembers.set(socket.id, { id: socket.id, nick: nickNow(), ...cleanCallState(state) });
    reply({ ok: true, others });
    sendCall(ctx);
  });

  socket.on("call:state", (state) => {
    const member = ctx.callMembers.get(socket.id);
    if (!member) return;
    Object.assign(member, cleanCallState(state));
    sendCall(ctx);
  });

  socket.on("call:signal", (msg) => {
    if (!msg || !ctx.callMembers.has(socket.id) || !ctx.callMembers.has(msg.to)) return;
    if (JSON.stringify(msg).length > 100 * 1024) return;
    io.to(msg.to).emit("call:signal", { from: socket.id, description: msg.description, candidate: msg.candidate });
  });

  // Soundboard: som curto que toca para todo mundo da call
  let lastSfx = 0;
  socket.on("call:sfx", (name) => {
    const member = ctx.callMembers.get(socket.id);
    const now = Date.now();
    if (!member || !SFX.includes(name) || now - lastSfx < 2500) return;
    lastSfx = now;
    for (const id of ctx.callMembers.keys()) io.to(id).emit("call:sfx", { name, nick: member.nick });
  });

  // Assistir junto: um video do YouTube sincronizado para a call
  socket.on("watch:set", (url) => {
    const member = ctx.callMembers.get(socket.id);
    const m = String(url || "").match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/) || String(url || "").match(/^([A-Za-z0-9_-]{11})$/);
    if (!member) return;
    if (!m) return notice("Esse link não parece ser do YouTube.");
    ctx.watch = { id: m[1], playing: true, pos: 0, at: Date.now(), by: member.nick };
    toRoom(ctx, "watch:state", watchMsg(ctx));
  });

  socket.on("watch:control", (msg) => {
    const member = ctx.callMembers.get(socket.id);
    if (!member || !ctx.watch || !msg) return;
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
    if (nick && ![...ctx.online.values()].includes(nick)) { ctx.poker.left(nick); ctx.truco.left(nick); }
  });
});

if (!ready()) console.log("ATENÇÃO: falta SUPABASE_SECRET_KEY no Render. Sem ela ninguém consegue entrar no site.");
cleanupExpired();
server.listen(PORT, () => console.log(`Chat Pedro rodando na porta ${PORT}`));

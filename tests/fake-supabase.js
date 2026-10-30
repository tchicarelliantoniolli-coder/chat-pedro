// Supabase falso para testes: Auth (contas e tokens) + PostgREST (tabelas do Chat Pedro).
const http = require("http"), crypto = require("crypto");
const PORT = Number(process.argv[2]);
const SECRET = "sb_secret_teste", PUB = "sb_publishable_teste";
const users = new Map();   // id -> { id, email, password }
const tokens = new Map();  // access -> userId
const refresh = new Map(); // refresh -> userId
const T = { profiles: [], servers: [], server_members: [], server_invites: [], server_bans: [], chat_kv: [], friendships: [] };
const PK = { profiles: ["id"], servers: ["id"], server_members: ["server_id", "user_id"], server_invites: ["code"], server_bans: ["server_id", "user_id"], chat_kv: ["key"], friendships: ["user_id", "friend_id"] };
const now = () => new Date().toISOString();
const DEFAULTS = {
  profiles: () => ({ avatar: null, color: null, created_at: now() }),
  servers: () => ({ id: crypto.randomUUID(), created_at: now(), dm: false, public: false, description: null }),
  server_members: () => ({ role: "member", joined_at: now() }),
  server_invites: () => ({ uses: 0, expires_at: null, created_at: now() }),
  server_bans: () => ({ until: null, created_at: now() }),
  chat_kv: () => ({ expires_at: null, updated_at: now() }),
  friendships: () => ({ status: "pending", created_at: now() }),
};

function send(res, code, data) { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" }); res.end(data === undefined ? "" : JSON.stringify(data)); }
function session(uid) {
  const access = "tok_" + crypto.randomBytes(12).toString("hex"), ref = "ref_" + crypto.randomBytes(12).toString("hex");
  tokens.set(access, uid); refresh.set(ref, uid);
  const u = users.get(uid);
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: ref, user: userObj(u) };
}
const userObj = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: now(), app_metadata: {}, user_metadata: {}, created_at: now() });

// ---------- filtros do PostgREST ----------
function parseVal(op, raw) {
  if (op === "in") return raw.replace(/^\(|\)$/g, "").match(/"[^"]*"|[^,]+/g).map((x) => x.replace(/^"|"$/g, ""));
  return raw;
}
function matches(row, filters) {
  return filters.every(([col, op, val]) => {
    const v = row[col];
    if (op === "eq") return String(v) === val;
    if (op === "in") return val.includes(String(v));
    if (op === "ilike") return typeof v === "string" && new RegExp("^" + val.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i").test(v);
    if (op === "like") return typeof v === "string" && new RegExp("^" + val.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(v);
    if (op === "lt") return v != null && Date.parse(v) < Date.parse(val);
    throw new Error("filtro " + op);
  });
}
function project(table, row, select) {
  if (!select || select === "*") return { ...row };
  const out = {};
  // campos simples e embutidos do tipo alias:tabela(col,col)
  const parts = select.match(/[a-z_]+:[a-z_]+\([^)]*\)|[a-z_]+\([^)]*\)|[^,]+/g);
  for (const p of parts) {
    const emb = p.match(/^(?:([a-z_]+):)?([a-z_]+)\(([^)]*)\)$/);
    if (emb) {
      const alias = emb[1] || emb[2], target = emb[2], cols = emb[3].split(",");
      const fk = target === "servers" ? row.server_id : null;
      const t = T[target].find((r) => r.id === fk);
      out[alias] = t ? Object.fromEntries(cols.map((c) => [c, t[c]])) : null;
    } else out[p] = row[p];
  }
  return out;
}
function uniqueClash(table, row, ignore) {
  const pk = PK[table];
  if (T[table].some((r) => r !== ignore && pk.every((k) => r[k] === row[k]))) return true;
  if (table === "profiles" && T.profiles.some((r) => r !== ignore && r.id !== row.id && r.nick.toLowerCase() === row.nick.toLowerCase())) return true;
  return false;
}
function cascadeDelete(table, rows) {
  if (table === "servers") for (const s of rows) for (const t of ["server_members", "server_invites", "server_bans"]) T[t] = T[t].filter((r) => r.server_id !== s.id);
}

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    if (req.method === "OPTIONS") return send(res, 204);
    const data = body ? JSON.parse(body) : null;
    const apikey = req.headers.apikey;
    if (apikey !== SECRET && apikey !== PUB) return send(res, 401, { message: "Invalid API key" });
    const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");
    // ---------- Auth ----------
    if (u.pathname === "/auth/v1/admin/users" && req.method === "POST") {
      if (bearer !== SECRET) return send(res, 403, { msg: "nao autorizado" });
      if ([...users.values()].some((x) => x.email === data.email)) return send(res, 422, { msg: "A user with this email address has already been registered" });
      const id = crypto.randomUUID();
      users.set(id, { id, email: data.email, password: data.password });
      return send(res, 200, userObj(users.get(id)));
    }
    if (u.pathname.startsWith("/auth/v1/admin/users/") && req.method === "DELETE") { users.delete(u.pathname.split("/").pop()); return send(res, 200, {}); }
    if (u.pathname === "/auth/v1/token") {
      const gt = u.searchParams.get("grant_type");
      if (gt === "password") {
        const usr = [...users.values()].find((x) => x.email === data.email && x.password === data.password);
        if (!usr) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials" });
        return send(res, 200, session(usr.id));
      }
      if (gt === "refresh_token") {
        const uid = refresh.get(data.refresh_token);
        if (!uid) return send(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
        return send(res, 200, session(uid));
      }
    }
    if (u.pathname === "/auth/v1/user" && req.method === "GET") {
      const uid = tokens.get(bearer);
      if (!uid || !users.get(uid)) return send(res, 401, { msg: "invalid JWT" });
      return send(res, 200, userObj(users.get(uid)));
    }
    if (u.pathname === "/auth/v1/logout") { tokens.delete(bearer); return send(res, 204); }
    if (u.pathname === "/auth/v1/recover") return send(res, 200, {});
    // ---------- tabelas ----------
    const m = u.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m || !T[m[1]]) return send(res, 404, { message: "nao existe " + u.pathname });
    if (bearer !== SECRET) return send(res, 401, { message: "permission denied" }); // RLS: so a chave secreta
    const table = m[1];
    const filters = [];
    for (const [k, v] of u.searchParams) {
      if (["select", "order", "on_conflict"].includes(k)) continue;
      const i = v.indexOf(".");
      const op = v.slice(0, i);
      filters.push([k, op, parseVal(op, v.slice(i + 1))]);
    }
    const prefer = req.headers.prefer || "";
    try {
      if (req.method === "GET") {
        let rows = T[table].filter((r) => matches(r, filters));
        const ord = u.searchParams.get("order");
        if (ord) { const [c, dir] = ord.split("."); rows = [...rows].sort((a, b) => (a[c] > b[c] ? 1 : -1) * (dir === "desc" ? -1 : 1)); }
        return send(res, 200, rows.map((r) => project(table, r, u.searchParams.get("select"))));
      }
      if (req.method === "POST") {
        const rows = (Array.isArray(data) ? data : [data]).map((r) => ({ ...DEFAULTS[table](), ...r }));
        const merge = /merge-duplicates/.test(prefer);
        const out = [];
        for (const r of rows) {
          const pk = PK[table];
          const existing = T[table].find((x) => pk.every((k) => x[k] === r[k]));
          if (existing && merge) { if (uniqueClash(table, { ...existing, ...r }, existing)) return send(res, 409, { message: "duplicate key" }); Object.assign(existing, r); out.push(existing); continue; }
          if (uniqueClash(table, r)) return send(res, 409, { code: "23505", message: "duplicate key value violates unique constraint" });
          T[table].push(r); out.push(r);
        }
        return /return=representation/.test(prefer) ? send(res, 201, out) : send(res, 201);
      }
      if (req.method === "PATCH") {
        const rows = T[table].filter((r) => matches(r, filters));
        for (const r of rows) { if (uniqueClash(table, { ...r, ...data }, r)) return send(res, 409, { code: "23505", message: "duplicate key value violates unique constraint" }); }
        for (const r of rows) Object.assign(r, data);
        return send(res, 200, rows);
      }
      if (req.method === "DELETE") {
        const gone = T[table].filter((r) => matches(r, filters));
        T[table] = T[table].filter((r) => !gone.includes(r));
        cascadeDelete(table, gone);
        return send(res, 204);
      }
    } catch (e) { return send(res, 400, { message: e.message }); }
    send(res, 405, {});
  });
}).listen(PORT, () => console.log("supabase falso na porta " + PORT));

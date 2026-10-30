// Acesso do servidor ao Supabase: tabelas (API REST) e contas (Auth).
// Usa a chave secreta, entao so roda no servidor; o navegador nunca ve essa chave.
const SUPABASE_URL = (process.env.SUPABASE_URL || "https://yvdlkwdmhlvpjmesmkye.supabase.co").replace(/\/+$/, "");
// A chave publica pode ficar no codigo: as tabelas tem RLS ligado e nenhuma regra publica.
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_vzXyGltrmh80VOBnfLTyzA_iJCa-PpN";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const ready = () => !!SECRET_KEY;

async function call(path, { method = "GET", body, headers = {}, key = SECRET_KEY, token } = {}) {
  const r = await fetch(SUPABASE_URL + path, {
    method,
    headers: {
      apikey: key,
      Authorization: "Bearer " + (token || key),
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const msg = (data && (data.msg || data.message || data.error_description || data.error)) || ("erro " + r.status);
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    err.status = r.status; err.data = data;
    throw err;
  }
  return data;
}

// ---------- tabelas ----------
const q = (params) => Object.entries(params).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
const inList = (vals) => "in.(" + vals.map((v) => '"' + String(v).replace(/"/g, "") + '"').join(",") + ")";

const db = {
  select: (table, params = {}) => call("/rest/v1/" + table + "?" + q({ select: "*", ...params })),
  insert: (table, rows, returning = true) => call("/rest/v1/" + table, { method: "POST", body: rows, headers: { Prefer: returning ? "return=representation" : "return=minimal" } }),
  upsert: (table, rows, onConflict) => call("/rest/v1/" + table + "?" + q({ on_conflict: onConflict }), { method: "POST", body: rows, headers: { Prefer: "resolution=merge-duplicates,return=minimal" } }),
  update: (table, params, patch) => call("/rest/v1/" + table + "?" + q(params), { method: "PATCH", body: patch, headers: { Prefer: "return=representation" } }),
  remove: (table, params) => call("/rest/v1/" + table + "?" + q(params), { method: "DELETE", headers: { Prefer: "return=minimal" } }),
  rpc: (name, args = {}) => call("/rest/v1/rpc/" + name, { method: "POST", body: args }), // funcoes do banco (ex.: faxina)
  inList,
};

// ---------- contas ----------
const auth = {
  // Cria a conta ja confirmada (sem e-mail de confirmacao: o envio gratis do Supabase so chega para a equipe do projeto)
  createUser: (email, password) => call("/auth/v1/admin/users", { method: "POST", body: { email, password, email_confirm: true } }),
  deleteUser: (id) => call("/auth/v1/admin/users/" + id, { method: "DELETE" }),
  // Confere o token de login que o navegador mandou e devolve quem e
  getUser: (token) => call("/auth/v1/user", { key: PUBLISHABLE_KEY, token }),
};

module.exports = { db, auth, ready, SUPABASE_URL, PUBLISHABLE_KEY };

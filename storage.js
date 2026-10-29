// Guarda o chat no Supabase (plano gratis) para nada sumir quando o Render dorme ou reinicia.
// So liga se SUPABASE_URL e SUPABASE_SECRET_KEY estiverem configuradas no Render;
// sem elas, o site funciona como antes, so na memoria.
//
// Tudo fica numa tabela simples de chave/valor (chat_kv). A tabela tem RLS ligado e nenhuma
// regra de acesso publico: so o servidor, com a chave secreta, consegue ler e escrever.
const TABLE = "chat_kv";
const MEDIA_TTL_DAYS = 30; // fotos e audios ficam guardados por 30 dias

function createStorage() {
  const base = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !key) return null;
  const endpoint = base + "/rest/v1/" + TABLE;
  const headers = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };

  async function req(method, query, body, extra) {
    const r = await fetch(endpoint + (query ? "?" + query : ""), {
      method, headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) throw new Error("Supabase respondeu " + r.status + ": " + text.slice(0, 200));
    return text ? JSON.parse(text) : null; // gravar e apagar respondem sem conteudo
  }
  const inList = (keys) => "in.(" + keys.map((k) => '"' + k + '"').join(",") + ")";
  // Le varias chaves de uma vez; ignora o que ja venceu
  async function getMany(keys) {
    if (!keys.length) return {};
    const rows = await req("GET", "select=key,value,expires_at&key=" + encodeURIComponent(inList(keys)));
    const now = Date.now();
    const out = {};
    for (const row of rows) if (!row.expires_at || Date.parse(row.expires_at) > now) out[row.key] = row.value;
    return out;
  }
  // Grava (ou substitui) varias chaves de uma vez
  const upsert = (rows) => req("POST", "on_conflict=key", rows, { Prefer: "resolution=merge-duplicates,return=minimal" });
  const remove = (keys) => req("DELETE", "key=" + encodeURIComponent(inList(keys)), undefined, { Prefer: "return=minimal" });
  const isMedia = (m) => m.type === "img" || m.type === "audio";

  let pending = null, timer = null, saving = Promise.resolve();
  const queue = (fn, what) => { saving = saving.then(fn).catch((e) => console.error("Nao deu para " + what + ":", e.message)); };

  return {
    // Le tudo na hora que o servidor liga
    async load() {
      const got = await getMany(["chat:history", "chat:avatars", "chat:profiles", "chat:nextid"]);
      let history = got["chat:history"] ? JSON.parse(got["chat:history"]) : [];
      const media = history.filter(isMedia);
      if (media.length) {
        const srcs = await getMany(media.map((m) => "chat:media:" + m.id));
        media.forEach((m) => { m.src = srcs["chat:media:" + m.id]; });
        history = history.filter((m) => !isMedia(m) || m.src); // midia que venceu some da lista
      }
      // faxina: apaga fotos e audios vencidos
      req("DELETE", "expires_at=lt." + encodeURIComponent(new Date().toISOString()), undefined, { Prefer: "return=minimal" })
        .catch((e) => console.error("Nao deu para apagar midias vencidas:", e.message));
      return {
        history,
        avatars: got["chat:avatars"] ? JSON.parse(got["chat:avatars"]) : {},
        profiles: got["chat:profiles"] ? JSON.parse(got["chat:profiles"]) : {},
        nextId: Number(got["chat:nextid"]) || 1,
      };
    },

    // Salva a lista de mensagens (sem as fotos e audios, que vao em linhas proprias) logo depois de mudar
    saveSoon(state) {
      pending = state;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const s = pending;
        const slim = s.history.map((m) => (isMedia(m) ? { ...m, src: undefined } : m));
        queue(() => upsert([
          { key: "chat:history", value: JSON.stringify(slim), expires_at: null },
          { key: "chat:avatars", value: JSON.stringify(s.avatars), expires_at: null },
          { key: "chat:profiles", value: JSON.stringify(s.profiles), expires_at: null },
          { key: "chat:nextid", value: String(s.nextId), expires_at: null },
        ]), "salvar o chat");
      }, 1500);
    },

    saveMedia(id, src) {
      const expires = new Date(Date.now() + MEDIA_TTL_DAYS * 86400000).toISOString();
      queue(() => upsert([{ key: "chat:media:" + id, value: src, expires_at: expires }]), "salvar a midia");
    },

    deleteMedia(ids) {
      if (ids.length) queue(() => remove(ids.map((id) => "chat:media:" + id)), "apagar a midia");
    },
  };
}

module.exports = { createStorage };

// Guarda o chat de cada servidor no Supabase (tabela chave/valor chat_kv) para nada sumir
// quando o Render dorme ou reinicia. As chaves de um servidor comecam com "srv:<id>:".
const { db, ready } = require("./db");

const TABLE = "chat_kv";
const MEDIA_TTL_DAYS = 30; // fotos e audios ficam guardados por 30 dias
const isMedia = (m) => m.type === "img" || m.type === "audio";
let saving = Promise.resolve();
const queue = (fn, what) => { saving = saving.then(fn).catch((e) => console.error("Nao deu para " + what + ":", e.message)); };

async function getMany(keys) {
  if (!keys.length) return {};
  const rows = await db.select(TABLE, { select: "key,value,expires_at", key: db.inList(keys) });
  const now = Date.now();
  const out = {};
  for (const row of rows) if (!row.expires_at || Date.parse(row.expires_at) > now) out[row.key] = row.value;
  return out;
}

function createStorage(serverId) {
  if (!ready()) return null;
  const p = "srv:" + serverId + ":";
  let pending = null, timer = null;

  return {
    async load() {
      const got = await getMany([p + "history", p + "nextid"]);
      let history = got[p + "history"] ? JSON.parse(got[p + "history"]) : [];
      const media = history.filter(isMedia);
      if (media.length) {
        const srcs = await getMany(media.map((m) => p + "media:" + m.id));
        media.forEach((m) => { m.src = srcs[p + "media:" + m.id]; });
        history = history.filter((m) => !isMedia(m) || m.src); // midia que venceu some da lista
      }
      return { history, nextId: Number(got[p + "nextid"]) || 1 };
    },

    // Salva a lista de mensagens (sem fotos e audios, que vao em linhas proprias) logo depois de mudar
    saveSoon(state) {
      pending = state;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const slim = pending.history.map((m) => (isMedia(m) ? { ...m, src: undefined } : m));
        queue(() => db.upsert(TABLE, [
          { key: p + "history", value: JSON.stringify(slim), expires_at: null },
          { key: p + "nextid", value: String(pending.nextId), expires_at: null },
        ], "key"), "salvar o chat");
      }, 1500);
    },

    saveMedia(id, src) {
      const expires = new Date(Date.now() + MEDIA_TTL_DAYS * 86400000).toISOString();
      queue(() => db.upsert(TABLE, [{ key: p + "media:" + id, value: src, expires_at: expires }], "key"), "salvar a midia");
    },

    deleteMedia(ids) {
      if (ids.length) queue(() => db.remove(TABLE, { key: db.inList(ids.map((id) => p + "media:" + id)) }), "apagar a midia");
    },

    // Servidor apagado: some com tudo dele
    deleteAll() {
      queue(() => db.remove(TABLE, { key: "like." + p + "*" }), "apagar o chat do servidor");
    },
  };
}

// Faxina na hora que o site liga: apaga fotos e audios vencidos de todos os servidores
function cleanupExpired() {
  if (!ready()) return;
  queue(() => db.remove(TABLE, { expires_at: "lt." + new Date().toISOString() }), "apagar midias vencidas");
}

module.exports = { createStorage, cleanupExpired };

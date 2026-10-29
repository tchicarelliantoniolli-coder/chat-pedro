// Guarda o chat no Upstash Redis (plano gratis) para nada sumir quando o Render dorme ou reinicia.
// So liga se UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN estiverem configuradas no Render;
// sem elas, o site funciona como antes, so na memoria.
const MEDIA_TTL = 30 * 24 * 3600; // fotos e audios ficam guardados por 30 dias

function createStorage() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) return null;

  async function call(path, body) {
    const r = await fetch(url + path, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error("Upstash respondeu " + r.status);
    return r.json();
  }
  const cmd = async (...args) => (await call("", args)).result;
  const pipeline = (cmds) => call("/pipeline", cmds);
  const isMedia = (m) => m.type === "img" || m.type === "audio";

  let pending = null, timer = null, saving = Promise.resolve();

  return {
    // Le tudo na hora que o servidor liga
    async load() {
      const [hist, avatars, profiles, nextId] = await Promise.all([
        cmd("GET", "chat:history"), cmd("GET", "chat:avatars"), cmd("GET", "chat:profiles"), cmd("GET", "chat:nextid"),
      ]);
      let history = hist ? JSON.parse(hist) : [];
      const media = history.filter(isMedia);
      if (media.length) {
        const srcs = await cmd("MGET", ...media.map((m) => "chat:media:" + m.id));
        media.forEach((m, i) => { m.src = srcs[i]; });
        history = history.filter((m) => !isMedia(m) || m.src); // midia que expirou some da lista
      }
      return {
        history,
        avatars: avatars ? JSON.parse(avatars) : {},
        profiles: profiles ? JSON.parse(profiles) : {},
        nextId: Number(nextId) || 1,
      };
    },

    // Salva a lista de mensagens (sem as fotos e audios, que vao em chaves proprias) logo depois de mudar
    saveSoon(state) {
      pending = state;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const s = pending;
        const slim = s.history.map((m) => (isMedia(m) ? { ...m, src: undefined } : m));
        saving = saving.then(() => pipeline([
          ["SET", "chat:history", JSON.stringify(slim)],
          ["SET", "chat:avatars", JSON.stringify(s.avatars)],
          ["SET", "chat:profiles", JSON.stringify(s.profiles)],
          ["SET", "chat:nextid", String(s.nextId)],
        ])).catch((e) => console.error("Nao deu para salvar o chat:", e.message));
      }, 1500);
    },

    saveMedia(id, src) {
      saving = saving.then(() => cmd("SET", "chat:media:" + id, src, "EX", MEDIA_TTL))
        .catch((e) => console.error("Nao deu para salvar a midia:", e.message));
    },

    deleteMedia(ids) {
      if (!ids.length) return;
      saving = saving.then(() => cmd("DEL", ...ids.map((id) => "chat:media:" + id)))
        .catch((e) => console.error("Nao deu para apagar a midia:", e.message));
    },
  };
}

module.exports = { createStorage };

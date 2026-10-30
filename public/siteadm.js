// Painel "adm" do site (botao no canto de cima a direita): com a senha, toca um som para todo mundo
// e mostra uma foto, um video ou um audio na tela de todas as pessoas com o Chat Pedro aberto.
(() => {
  const $ = (id) => document.getElementById(id);
  // canal proprio do painel: chega ate em quem nao entrou em servidor (divide a conexao com o chat)
  const socket = window.io("/adm");
  socket.connect();
  let token = "";
  try { token = sessionStorage.getItem("cp-adm") || ""; } catch {}
  let media = null, showing = false, file = null, prevUrl = "";

  const call = async (path, opts = {}) => {
    const r = await fetch("/api/adm/" + path, { method: "POST", ...opts, headers: { "x-adm": token, ...(opts.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { setToken(""); showLogin(); }
    if (!r.ok) throw new Error(j.error || "Deu erro. Tente de novo.");
    return j;
  };
  const setToken = (t) => { token = t; try { t ? sessionStorage.setItem("cp-adm", t) : sessionStorage.removeItem("cp-adm"); } catch {} };
  const msg = (text, ok) => { $("saMsg").textContent = text || ""; $("saMsg").classList.toggle("ok", !!ok); };

  function showLogin() { $("saLogin").hidden = false; $("saPanel").hidden = true; $("saErr").textContent = ""; $("saPass").value = ""; setTimeout(() => $("saPass").focus(), 50); }
  function showPanel() { $("saLogin").hidden = true; $("saPanel").hidden = false; refresh(); }
  const KIND = { img: "Foto", video: "Vídeo", audio: "Áudio" };
  function refresh() {
    const go = $("saGo");
    go.disabled = !showing && !media && !file;
    go.textContent = showing ? "Parar para todos" : file ? "Enviar e mostrar para todos" : "Mostrar para todos";
    go.classList.toggle("stop", showing);
    if (!file && media && !$("saPrev").textContent) $("saPrev").textContent = KIND[media.kind] + " pronto" + (media.name ? ": " + media.name : "");
  }

  $("saBtn").addEventListener("click", () => { $("saModal").hidden = false; token ? showPanel() : showLogin(); });
  $("saClose").addEventListener("click", () => { $("saModal").hidden = true; });
  $("saModal").addEventListener("click", (e) => { if (e.target === $("saModal")) $("saModal").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("saModal").hidden = true; });

  $("saLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("saErr").textContent = "";
    try {
      const r = await fetch("/api/adm/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senha: $("saPass").value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Deu erro. Tente de novo.");
      setToken(j.token); media = j.media; showing = j.showing; showPanel();
    } catch (err) { $("saErr").textContent = err.message; }
  });

  $("saBeep").addEventListener("click", async () => {
    try { await call("beep"); msg("Som tocado para todos.", true); } catch (err) { msg(err.message); }
  });

  $("saFile").addEventListener("change", () => {
    const f = $("saFile").files[0];
    $("saFile").value = "";
    if (!f) return;
    if (f.size > 40 * 1024 * 1024) { msg("Arquivo grande demais (máximo 40 MB)."); return; }
    file = f; msg("");
    if (prevUrl) URL.revokeObjectURL(prevUrl);
    prevUrl = URL.createObjectURL(f);
    const box = $("saPrev"); box.replaceChildren();
    if (f.type.startsWith("image/")) { const i = new Image(); i.src = prevUrl; box.append(i); }
    else if (f.type.startsWith("video/")) { const v = document.createElement("video"); v.src = prevUrl; v.muted = true; box.append(v); }
    const n = document.createElement("span"); n.textContent = f.name; box.append(n);
    refresh();
  });

  $("saGo").addEventListener("click", async () => {
    const go = $("saGo");
    go.disabled = true;
    try {
      if (showing) { await call("stop"); showing = false; msg("Parado para todos.", true); }
      else {
        if (file) {
          msg("Enviando…", true);
          const j = await call("media", { body: file, headers: { "Content-Type": file.type || "application/octet-stream", "x-name": encodeURIComponent(file.name).slice(0, 200) } });
          media = j.media; file = null;
        }
        await call("start"); showing = true; msg("Aparecendo na tela de todos.", true);
      }
    } catch (err) { msg(err.message); }
    refresh();
  });

  // ---------- o que todo mundo ve ----------
  const show = $("saShow");
  let shownId = null;
  function close() {
    for (const el of show.querySelectorAll("video, audio")) { el.pause(); el.removeAttribute("src"); el.load(); }
    show.querySelectorAll("img, video, audio, .sa-label, .sa-stop").forEach((el) => el.remove());
    show.hidden = true; $("saTap").hidden = true; shownId = null;
  }
  socket.on("adm:show", (s) => {
    if (!s) { close(); showing = false; refresh(); return; }
    showing = !!token; refresh();
    if (shownId === s.id + ":" + s.at) return;
    close();
    shownId = s.id + ":" + s.at;
    show.className = s.kind === "audio" ? "audio" : "";
    if (s.kind === "img") { const i = new Image(); i.src = s.url; i.alt = ""; show.prepend(i); }
    else {
      const el = document.createElement(s.kind === "video" ? "video" : "audio");
      el.src = s.url; el.playsInline = true; el.autoplay = true;
      // quem abriu o site depois que comecou entra no mesmo ponto
      const late = Math.max(0, (s.now - s.at) / 1000);
      el.addEventListener("loadedmetadata", () => { if (late > 1 && late < el.duration) el.currentTime = late; }, { once: true });
      show.prepend(el);
      if (s.kind === "audio") { const l = document.createElement("span"); l.className = "sa-label"; l.textContent = "Tocando um áudio do adm"; show.append(l); }
      // o navegador pode bloquear som sem um clique antes: toca mudo e pede um toque
      el.play().catch(() => {
        if (s.kind === "video") { el.muted = true; el.play().catch(() => {}); }
        $("saTap").hidden = false;
      });
    }
    if (token) {
      const b = document.createElement("button"); b.type = "button"; b.className = "cmd sa-stop"; b.textContent = "Parar para todos";
      b.addEventListener("click", () => { $("saGo").click(); });
      show.append(b);
    }
    show.hidden = false;
  });
  $("saTap").addEventListener("click", () => {
    const el = show.querySelector("video, audio");
    if (el) { el.muted = false; el.play().catch(() => {}); }
    $("saTap").hidden = true;
  });
  $("saShowClose").addEventListener("click", close);

  // som de aviso: dois toques, feito no proprio navegador (sem baixar nada)
  socket.on("adm:beep", () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume().catch(() => {});
      [[880, 0], [1320, 0.18]].forEach(([f, t]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.45);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.5);
      });
      setTimeout(() => ctx.close().catch(() => {}), 1200);
    } catch {}
  });
})();

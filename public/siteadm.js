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
  // iPhone e iPad so deixam tocar som depois que a pessoa toca na pagina. Por isso os players sao
  // sempre os mesmos e sao "destravados" no primeiro toque em qualquer lugar do site (tocando um
  // silencio); depois disso o som do adm toca sozinho, sem pedir nada.
  const wavUrl = (tones, secs) => {
    const rate = 22050, n = Math.round(rate * secs), b = new DataView(new ArrayBuffer(44 + n * 2));
    const str = (o, t) => { for (let i = 0; i < t.length; i++) b.setUint8(o + i, t.charCodeAt(i)); };
    str(0, "RIFF"); b.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt "); b.setUint32(16, 16, true); b.setUint16(20, 1, true);
    b.setUint16(22, 1, true); b.setUint32(24, rate, true); b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true);
    str(36, "data"); b.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const t = i / rate; let v = 0;
      for (const [f, at] of tones) { const d = t - at; if (d >= 0 && d < 0.45) v += Math.sin(2 * Math.PI * f * d) * Math.min(1, d / 0.02) * Math.exp(-d * 9); }
      b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v * 0.5)) * 32767, true);
    }
    return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
  };
  const SILENCE = wavUrl([], 0.1);
  const BEEP = wavUrl([[880, 0], [1320, 0.18]], 0.7); // som de aviso: dois toques
  const mkPlayer = (tag) => { const el = document.createElement(tag); el.playsInline = true; el.setAttribute("playsinline", ""); el.preload = "auto"; el.hidden = true; show.prepend(el); return el; };
  const show = $("saShow");
  const video = mkPlayer("video"), audio = mkPlayer("audio"), beep = mkPlayer("audio");
  beep.src = BEEP;
  let unlocked = false, busy = null; // busy: o player que esta mostrando algo do adm agora
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    for (const el of [video, audio, beep]) {
      if (el === busy) continue;
      const keep = el.src && el !== beep ? el.src : null;
      el.src = SILENCE; el.muted = false;
      el.play().then(() => { if (el === busy) return; el.pause(); el.src = keep || (el === beep ? BEEP : SILENCE); }).catch(() => { unlocked = false; });
    }
  }
  for (const ev of ["pointerdown", "touchend", "click", "keydown"]) addEventListener(ev, unlock, { capture: true, passive: true });

  // Aviso fora da aba: com a aba minimizada ou em outra aba, a pagina nao consegue se desenhar por
  // cima de nada. Entao aparece uma notificacao do sistema com a foto (fica ate a pessoa clicar ou o
  // adm parar) e o titulo da aba pisca. A permissao e pedida uma vez, no primeiro clique no site.
  const NTAG = "chatpedro-adm";
  const canNotify = "Notification" in window;
  const swReg = "serviceWorker" in navigator ? navigator.serviceWorker.register("/sw.js").catch(() => null) : Promise.resolve(null);
  function askNotify() {
    if (!canNotify || Notification.permission !== "default") return;
    try { if (localStorage.getItem("cp-adm-ask")) return; localStorage.setItem("cp-adm-ask", "1"); } catch {}
    try { Notification.requestPermission().catch(() => {}); } catch {}
  }
  for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, askNotify, { capture: true, passive: true, once: true });
  let notified = null, current = null, blink = null;
  const baseTitle = () => document.title.replace(/^\u{1F4E2} .*? \| /u, "");
  async function notify() {
    if (!current || notified === shownId || !document.hidden) return;
    notified = shownId;
    const s = current, url = new URL(s.url, location.href).href;
    const title = s.kind === "img" ? "O adm mostrou uma foto" : s.kind === "video" ? "O adm está mostrando um vídeo" : "O adm está tocando um áudio";
    const opts = { body: "Clique para abrir o Chat Pedro", tag: NTAG, renotify: true, requireInteraction: true, ...(s.kind === "img" ? { image: url, icon: url } : {}) };
    if (canNotify && Notification.permission === "granted") {
      const reg = await swReg;
      try { if (reg) await reg.showNotification(title, opts); else { const n = new Notification(title, opts); n.onclick = () => { focus(); n.close(); }; } } catch {}
    }
    clearInterval(blink);
    const t0 = baseTitle(); let on = false;
    blink = setInterval(() => { on = !on; document.title = on ? "\u{1F4E2} " + title + " | " + t0 : t0; }, 1000);
  }
  async function unnotify() {
    clearInterval(blink); blink = null; document.title = baseTitle(); notified = null;
    const reg = await swReg;
    if (reg) try { (await reg.getNotifications({ tag: NTAG })).forEach((n) => n.close()); } catch {}
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) notify(); else if (blink) unnotify(); });

  let shownId = null;
  function close() {
    for (const el of [video, audio]) { el.pause(); el.hidden = true; el.muted = false; }
    busy = null;
    show.querySelectorAll("img, .sa-label, .sa-stop").forEach((el) => el.remove());
    show.hidden = true; $("saTap").hidden = true; shownId = null; current = null;
    unnotify();
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
      const el = busy = s.kind === "video" ? video : audio;
      el.src = s.url; el.hidden = s.kind !== "video"; el.muted = false;
      // quem abriu o site depois que comecou entra no mesmo ponto
      const late = Math.max(0, (s.now - s.at) / 1000);
      el.addEventListener("loadedmetadata", () => { if (late > 1 && late < el.duration) el.currentTime = late; }, { once: true });
      if (s.kind === "audio") { const l = document.createElement("span"); l.className = "sa-label"; l.textContent = "Tocando um áudio do adm"; show.append(l); }
      // so quem ainda nao tocou na pagina cai aqui: o video vai mudo e aparece o "Toque para ouvir"
      const me = shownId;
      el.play().catch(() => {
        if (shownId !== me) return; // ja trocou ou parou
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
    current = s; notify();
  });
  $("saTap").addEventListener("click", () => {
    if (busy) { busy.muted = false; busy.play().catch(() => {}); }
    $("saTap").hidden = true;
  });
  $("saShowClose").addEventListener("click", close);

  socket.on("adm:beep", () => { beep.currentTime = 0; beep.muted = false; beep.play().catch(() => {}); });
})();

// Site atualizado: quando sai uma versao nova (o Render reinicia o servidor), cada navegador recarrega
// sozinho. O que estava escrito na caixa de mensagem volta depois de recarregar.
(() => {
  const socket = window.io("/adm");
  let version = null, reloading = false;
  try {
    const draft = sessionStorage.getItem("cp-draft");
    if (draft) {
      sessionStorage.removeItem("cp-draft");
      const put = () => { const i = document.getElementById("input"); if (i && !i.value) { i.value = draft; i.dispatchEvent(new Event("input", { bubbles: true })); } };
      setTimeout(put, 1500);
    }
  } catch {}
  socket.on("site:version", (v) => {
    if (!version) { version = v; return; }
    if (v === version || reloading) return;
    reloading = true;
    const app = window.ChatPedro;
    if (app && app.setNote) app.setNote("O Chat Pedro foi atualizado. Recarregando…");
    try { const i = document.getElementById("input"); if (i && i.value.trim()) sessionStorage.setItem("cp-draft", i.value); } catch {}
    // cada um espera um pouquinho diferente para o servidor nao receber todo mundo no mesmo segundo
    setTimeout(() => location.reload(), 1000 + Math.random() * 2000);
  });
})();

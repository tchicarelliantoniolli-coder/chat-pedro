// Ligar na conversa privada, como no Discord: quem recebe ve a janelinha "Chamada recebida..." (com a foto
// pulsando e o toque) em qualquer pagina do site; dentro da propria conversa aparece no lugar da call.
// Quem liga ouve o som de "chamando" (tocado pelo call.js com app.ringTone). Os sons sao feitos aqui no
// navegador (nenhum arquivo de audio): mesmo ritmo e duracao dos do Discord, com melodia propria.
(() => {
  const $ = (id) => document.getElementById(id);
  const app = window.ChatPedro;
  const { socket, store } = app;
  const P = (k) => (window.ChatPedroPrefs ? window.ChatPedroPrefs.get(k) : true);

  // ---------- sons ----------
  let ac = null;
  function audio() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const out = store.get("cp-out");
      if (out && ac.setSinkId) ac.setSinkId(out).catch(() => {});
    }
    if (ac.state !== "running") ac.resume().catch(() => {});
    return ac;
  }
  // o navegador so deixa tocar som depois que a pessoa mexe na pagina: destrava no primeiro toque
  addEventListener("pointerdown", () => { if (ac && ac.state !== "running") ac.resume().catch(() => {}); }, true);
  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
  // nota de sino suave (fundamental + oitava + duas oitavas que somem antes)
  function bell(c, out, t, midi, len, vol) {
    for (const [mult, part] of [[1, 1], [2, 0.4], [4, 0.1]]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.value = hz(midi) * mult;
      const end = t + len / (mult === 1 ? 1 : 1.8);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol * part, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      o.connect(g).connect(out); o.start(t); o.stop(end + 0.02);
    }
  }
  // "Chamada recebida": 4 frases de 1,35 s (uma para cada pulso da foto), arpejo por cima de um baixo
  const STEP = [0, 0.17, 0.34, 0.5, 0.67, 0.84, 1.0];
  const PHRASES = [[53, [84, 81, 77, 72, 81, 77]], [53, [84, 81, 77, 72, 81, 77, 81]], [50, [86, 81, 77, 74, 81, 77]], [50, [86, 81, 77, 74, 81, 77, 81]]];
  function ringPattern(c, out, t) {
    PHRASES.forEach(([bass, notes], i) => {
      const t0 = t + i * 1.35;
      bell(c, out, t0, bass, 1.2, 0.33);
      notes.forEach((n, k) => bell(c, out, t0 + STEP[k], n, 0.45, 0.2));
    });
  }
  // "Chamando": duas notas, de novo as duas e uma pausa (2,5 s, como o pulso de quem esta sendo chamado)
  function callingPattern(c, out, t) {
    for (const s of [0.15, 0.85]) { bell(c, out, t + s, 69, 0.35, 0.45); bell(c, out, t + s + 0.3, 64, 0.5, 0.45); }
  }
  function loop(pattern, period) {
    const c = audio(), out = c.createGain();
    out.gain.value = 0.9; out.connect(c.destination);
    let next = c.currentTime + 0.05, timer = 0, on = true;
    const plan = () => { if (!on) return; while (next < c.currentTime + 1) { pattern(c, out, next); next += period; } timer = setTimeout(plan, 300); };
    plan();
    return () => { on = false; clearTimeout(timer); out.gain.setTargetAtTime(0, c.currentTime, 0.04); setTimeout(() => out.disconnect(), 400); };
  }
  let stopIn = null, stopOut = null;
  const soundOk = (k) => P(k) && !P("mute") && app.myStatus !== "ocupado" && !(app.isDeaf && app.isDeaf());
  function incomingSound(on) {
    on = on && soundOk("snd-ring");
    if (on && !stopIn) { try { stopIn = loop(ringPattern, 5.4); } catch {} }
    else if (!on && stopIn) { stopIn(); stopIn = null; }
  }
  app.ringTone = {
    // quem esta na chamada ouve "chamando" enquanto alguem esta sendo chamado
    calling(on) {
      on = on && soundOk("snd-calling");
      if (on && !stopOut) { try { stopOut = loop(callingPattern, 2.5); } catch {} }
      else if (!on && stopOut) { stopOut(); stopOut = null; }
    },
  };

  // ---------- quem esta me ligando ----------
  const rings = new Map(); // id da conversa -> { p, el }
  const fullAvatar = (p, cls) => {
    if (!p.avatar) { const a = app.avatar(p.from, true); a.classList.add(cls); return a; }
    const a = document.createElement("span"); a.className = "av big " + cls;
    const img = document.createElement("img"); img.src = p.avatar; img.alt = ""; a.append(img);
    return a;
  };
  const btn = (cls, ic, label, fn) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "ib rpb " + cls;
    setIcon(b, ic, label);
    b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  const decline = (id) => { socket.emit("call:decline", id); drop(id); };
  function answer(id, video) {
    drop(id);
    if (id === app.serverId) { app.joinCall(video); return; }
    // outra conversa ou servidor: abre a conversa ja entrando na chamada
    location.href = "/s/" + id + "?atender=" + (video ? "video" : "voz");
  }
  // janelinha que aparece no meio da tela (da para arrastar; volta para onde a pessoa deixou)
  function popup(p) {
    const el = document.createElement("div");
    el.className = "ringpop"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", (p.video ? "Chamada de vídeo recebida de " : "Chamada recebida de ") + p.title);
    const av = document.createElement("div"); av.className = "rpav ringin"; av.append(fullAvatar(p, "rpimg"));
    const t = document.createElement("div"); t.className = "rpt"; t.textContent = p.title;
    const s = document.createElement("div"); s.className = "rps"; s.textContent = p.video ? "Chamada de vídeo recebida..." : "Chamada recebida...";
    const acts = document.createElement("div"); acts.className = "rpacts";
    acts.append(btn("no", "x", "Ignorar", () => decline(p.server)));
    if (p.video) acts.append(btn("yes", "ucam", "Entrar na chamada de vídeo", () => answer(p.server, true)));
    acts.append(btn("yes", "uphone", "Juntar-se à chamada", () => answer(p.server, false)));
    el.append(av, t, s, acts);
    document.body.append(el);
    // posicao: a ultima onde a pessoa deixou (se couber), senao o meio da tela; cada chamada a mais desce 10px
    let pos = null;
    try { pos = JSON.parse(store.get("cp-ringpos") || "null"); } catch {}
    const w = el.offsetWidth, h = el.offsetHeight, extra = 10 * [...rings.values()].filter((r) => r.el && r.el.classList.contains("ringpop")).length;
    if (!pos || pos.x + w > innerWidth || pos.y + h > innerHeight) pos = { x: innerWidth / 2 - w / 2, y: innerHeight / 2 - h / 2 };
    el.style.left = Math.max(0, pos.x + extra) + "px"; el.style.top = Math.max(0, pos.y + extra) + "px";
    drag(el);
    return el;
  }
  function drag(el) {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop;
      el.setPointerCapture(e.pointerId);
      el.classList.add("dragging");
      const move = (ev) => {
        el.style.left = Math.max(0, Math.min(innerWidth - el.offsetWidth, ev.clientX - sx)) + "px";
        el.style.top = Math.max(0, Math.min(innerHeight - el.offsetHeight, ev.clientY - sy)) + "px";
      };
      const up = () => {
        el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
        el.classList.remove("dragging");
        store.set("cp-ringpos", JSON.stringify({ x: el.offsetLeft, y: el.offsetTop }));
      };
      el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    });
  }
  // dentro da propria conversa: no lugar da call, quem esta na chamada e a minha foto pulsando
  function inline(p) {
    const el = $("ringBar");
    const people = $("rbPeople");
    people.replaceChildren();
    const inCall = [...(app.callNicks || [])];
    for (const n of inCall.length ? inCall : [p.from]) { const a = app.avatar(n, true); a.title = n; people.append(a); }
    const me = document.createElement("div"); me.className = "rpav ringin me"; me.title = app.nick + " (você)";
    me.append(app.avatar(app.nick, true)); people.append(me);
    $("rbText").textContent = p.video ? "Chamada de vídeo recebida..." : "Chamada recebida...";
    const acts = $("rbActs");
    acts.replaceChildren(
      btn("yes", "ucam", "Entrar na chamada de vídeo", () => answer(p.server, true)),
      btn("yes", "uphone", "Juntar-se à chamada", () => answer(p.server, false)),
      btn("no", "x", "Ignorar", () => decline(p.server)),
    );
    el.hidden = false;
    return el;
  }
  function show(p) {
    if (!p || !p.server || app.answering === p.server) return;
    if (app.inCall && app.inCall() && p.server === app.serverId) return; // ja estou nessa chamada
    const old = rings.get(p.server);
    if (old) { removeEl(old.el); }
    const here = p.server === app.serverId;
    // "Nao perturbe": sem janelinha e sem som (como no Discord); na propria conversa a chamada continua aparecendo
    const el = here ? inline(p) : app.myStatus === "ocupado" ? null : popup(p);
    rings.set(p.server, { p, el });
    sync();
    if (!old && document.hidden && app.myStatus !== "ocupado" && store.get("chatpedro-notif") === "on" && "Notification" in window && Notification.permission === "granted") {
      try { new Notification(p.title, { body: p.video ? "Chamada de vídeo recebida..." : "Chamada recebida...", tag: "chatpedro-ring-" + p.server, icon: p.avatar || undefined }); } catch {}
    }
  }
  function removeEl(el) {
    if (!el) return;
    if (el.id === "ringBar") { el.hidden = true; return; }
    el.classList.add("leaving");
    setTimeout(() => el.remove(), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 150);
  }
  function drop(id) {
    const r = rings.get(id);
    if (!r) return;
    rings.delete(id);
    removeEl(r.el);
    sync();
  }
  // toca enquanto alguma janelinha estiver aberta (ou a chamada aparecendo na conversa)
  const sync = () => incomingSound(rings.size > 0 && !(app.inCall && app.inCall()));
  app.ringSync = () => {
    // entrei na chamada desta conversa: para de tocar aqui
    if (app.inCall && app.inCall()) drop(app.serverId);
    sync();
  };

  socket.on("call:ring", show);
  socket.on("call:ringstop", (p) => { if (p) drop(p.server); });
  socket.on("disconnect", () => { for (const id of [...rings.keys()]) drop(id); });
  // Esc recusa a chamada mais recente (como no Discord)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const last = [...rings.entries()].filter(([, r]) => r.el && r.el.classList.contains("ringpop")).pop();
    if (last) decline(last[0]);
  });
})();

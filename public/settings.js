// Configuracoes de usuario (tela cheia, como no Discord), o cartao da conta (clique no seu nome)
// e os menus das setinhas do microfone e do fone, no painel embaixo da barra de canais.
(() => {
  const app = window.ChatPedro;
  const { store } = app;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const auth = () => window.ChatPedroAuth;
  const note = (t, bad) => app.setNote(t, bad);

  // ---------- preferencias (ficam neste navegador) ----------
  const DEFAULTS = {
    typing: true, compact: false, font: 16, gap: 12, zoom: 100, sat: 100, underline: false, rolecolors: true, reduce: false, anim: true,
    images: true, embeds: true, reactions: true, emoticons: true, stickers: true, spoilers: false,
    titlebadge: true, mute: false, "snd-mention": true, "snd-dm": true, dev: false, activity: true,
  };
  let prefs = {};
  try { prefs = JSON.parse(store.get("chatpedro-prefs") || "{}") || {}; } catch { prefs = {}; }
  const get = (k) => (k in prefs ? prefs[k] : DEFAULTS[k]);
  window.ChatPedroPrefs = { get };
  const OUT = { font: (v) => v + "px", gap: (v) => v + "px", zoom: (v) => v + "%", sat: (v) => v + "%" };

  function apply() {
    const b = document.body.classList;
    b.toggle("compact", get("compact"));
    b.toggle("no-images", !get("images"));
    b.toggle("no-embeds", !get("embeds"));
    b.toggle("no-reactions", !get("reactions"));
    b.toggle("no-stickers", !get("stickers"));
    b.toggle("spoilers-open", get("spoilers"));
    b.toggle("underline-links", get("underline"));
    b.toggle("reduce-motion", get("reduce"));
    b.toggle("no-anim", !get("anim"));
    const root = document.documentElement.style;
    root.setProperty("--chat-fs", get("font") + "px");
    root.setProperty("--group-gap", get("gap") + "px");
    root.zoom = get("zoom") === 100 ? "" : String(get("zoom") / 100);
    root.filter = get("sat") === 100 ? "" : "saturate(" + get("sat") / 100 + ")";
  }
  function set(k, v) {
    if (v === DEFAULTS[k]) delete prefs[k]; else prefs[k] = v;
    store.set("chatpedro-prefs", JSON.stringify(prefs));
    apply();
    if (k === "rolecolors") app.rerenderAll();
    if (k === "activity") app.sendProfile();
  }
  apply();

  // liga cada controle com data-pref a sua preferencia
  function syncControls() {
    document.querySelectorAll("#userSettings [data-pref]").forEach((c) => {
      const k = c.dataset.pref;
      if (c.type === "checkbox") c.checked = !!get(k);
      else if (c.type === "range") c.value = get(k);
      else if (c.classList.contains("us-radio")) c.querySelectorAll("input").forEach((r) => { r.checked = r.value === (get(k) ? "on" : ""); });
    });
    document.querySelectorAll("#userSettings [data-out]").forEach((o) => { o.textContent = OUT[o.dataset.out](get(o.dataset.out)); });
  }
  document.querySelectorAll("#userSettings [data-pref]").forEach((c) => {
    const k = c.dataset.pref;
    if (c.type === "checkbox") c.addEventListener("change", () => set(k, c.checked));
    else if (c.type === "range") c.addEventListener("input", () => { set(k, Number(c.value)); syncControls(); });
    else if (c.classList.contains("us-radio")) c.addEventListener("change", (e) => set(k, e.target.value === "on"));
  });

  // ---------- janela ----------
  const modal = $("userSettings");
  let page = "conta";
  function show(p) {
    page = p;
    document.querySelectorAll("#usTabs .gs-tab[data-page]").forEach((t) => t.classList.toggle("on", t.dataset.page === p));
    document.querySelectorAll("#userSettings .us-page").forEach((s) => { s.hidden = s.dataset.page !== p; });
    $("profMsg").textContent = "";
    $("usMain").scrollTop = 0;
    if (p === "voz" && app.onAVShown) app.onAVShown();
    if (RENDER[p]) RENDER[p]();
  }
  function open(p) {
    closePops();
    if (modal.hidden) {
      modal.hidden = false;
      modal.classList.remove("closing");
      document.body.classList.add("us-open");
      if (auth()) auth().fillProfileForm();
      app.renderProfile();
      syncControls();
      $("usSearch").value = ""; filterTabs("");
    }
    show(p || "conta");
  }
  function close() {
    if (modal.hidden || modal.classList.contains("closing")) return;
    modal.classList.add("closing");
    document.body.classList.remove("us-open");
    setTimeout(() => { modal.hidden = true; modal.classList.remove("closing"); $("settings").hidden = true; }, 150);
  }
  app.openUserSettings = open;
  $("usClose").addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (closePops()) return;
    if (!modal.hidden) close();
  });
  $("usTabs").addEventListener("click", (e) => { const t = e.target.closest(".gs-tab[data-page]"); if (t) show(t.dataset.page); });
  modal.addEventListener("click", (e) => { const g = e.target.closest("[data-go]"); if (g) show(g.dataset.go); });
  $("upSet").addEventListener("click", () => open("conta"));

  // pesquisa: filtra as abas pelo nome e pelo texto das paginas
  function filterTabs(q) {
    q = q.trim().toLowerCase();
    document.querySelectorAll("#usTabs .gs-tab[data-page]").forEach((t) => {
      const pg = document.querySelector('#userSettings .us-page[data-page="' + t.dataset.page + '"]');
      t.hidden = !!q && !(t.textContent.toLowerCase().includes(q) || (pg && pg.textContent.toLowerCase().includes(q)));
    });
    document.querySelectorAll("#usTabs .gs-h").forEach((h) => { h.hidden = !!q; });
  }
  $("usSearch").addEventListener("input", () => filterTabs($("usSearch").value));

  // ---------- paginas ----------
  const profile = () => (auth() && auth().profile) || {};
  const nick = () => app.nick || profile().nick || "";
  const statusOf = () => app.myStatus;
  function presOf(n, big, status) {
    const st = status || statusOf();
    const p = el("span", "pres" + (big ? " big" : "") + (st === "ausente" || st === "ocupado" || st === "invisivel" ? " " + st : "") + (profile().decoration ? " deco-" + profile().decoration : ""));
    p.append(app.avatar(n, true));
    return p;
  }
  function maskEmail(e) { const [u, d] = String(e || "").split("@"); return d ? "*".repeat(Math.max(4, u.length)) + "@" + d : e || ""; }

  const RENDER = {
    conta() {
      const p = profile();
      $("usBanner").style.background = p.banner || p.color || "var(--accent)";
      $("usAv").replaceWith(Object.assign(presOf(nick(), true), { id: "usAv" }));
      $("usNick").textContent = nick();
      $("usNickVal").textContent = nick();
      const em = $("profEmail");
      em.textContent = em.dataset.shown ? em.dataset.email : maskEmail(em.dataset.email);
      $("usEmailShow").textContent = em.dataset.shown ? "Esconder" : "Mostrar";
      $("nickForm").hidden = true; $("pwForm").hidden = true; $("usDelForm").hidden = true;
    },
    perfis() { subTab(curSub); preview(); },
    social() {
      const list = app.blocked;
      const box = $("usBlocked"); box.replaceChildren();
      if (!list.length) { box.append(el("span", "gs-sub", "Você não bloqueou ninguém.")); return; }
      for (const k of list) {
        const m = app.members.find((x) => app.keyOf(x.nick) === k);
        const name = m ? m.nick : k;
        const r = el("div", "gs-rrow");
        const b = el("button", "cmd", "Desbloquear"); b.type = "button";
        b.addEventListener("click", () => { app.toggleBlock(name); RENDER.social(); });
        r.append(app.avatar(name, true), el("span", "gs-rname", name), b);
        box.append(r);
      }
    },
    dispositivos() {
      const ua = navigator.userAgent;
      const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navegador";
      const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
      $("usDevName").textContent = (os ? os + " · " : "") + br;
      $("usDevInfo").textContent = "Este aparelho · agora";
    },
    atalhos() {
      const src = document.querySelector("#shortcutsModal .keys, .keys");
      $("usKeys").replaceChildren(...(src ? [...src.children].map((n) => n.cloneNode(true)) : []));
    },
  };

  // Minha conta
  $("usEmailShow").addEventListener("click", () => { const em = $("profEmail"); if (em.dataset.shown) delete em.dataset.shown; else em.dataset.shown = "1"; RENDER.conta(); });
  $("usNickEdit").addEventListener("click", () => { $("nickForm").hidden = !$("nickForm").hidden; if (!$("nickForm").hidden) { $("nickInput").value = nick(); $("nickInput").focus(); } });
  $("nickForm").addEventListener("submit", () => setTimeout(() => { if (!$("profMsg").textContent) { $("nickForm").hidden = true; } RENDER.conta(); }, 700));
  $("usPwBtn").addEventListener("click", () => { $("pwForm").hidden = !$("pwForm").hidden; if (!$("pwForm").hidden) $("pwInput").focus(); });
  $("usDelBtn").addEventListener("click", () => { $("usDelForm").hidden = !$("usDelForm").hidden; if (!$("usDelForm").hidden) $("usDelPw").focus(); });
  $("usDelForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await auth().deleteAccount($("usDelPw").value); }
    catch (err) { $("profMsg").textContent = err.message; }
  });

  // Perfis: perfil principal e perfil do servidor, com a previa do cartao ao lado
  let curSub = "main";
  function subTab(s) {
    curSub = s;
    document.querySelectorAll("#userSettings .us-t").forEach((t) => t.classList.toggle("on", t.dataset.sub === s));
    document.querySelectorAll("#userSettings .us-col").forEach((c) => { c.hidden = c.dataset.sub !== s; });
    $("usSrvTab").hidden = app.isDm;
    if (s === "srv") {
      $("usSrvName").textContent = $("serverName").textContent;
      $("usSrvNick").value = (app.guild.nicks || {})[app.myUid] || "";
    }
    preview();
  }
  document.querySelectorAll("#userSettings .us-t").forEach((t) => t.addEventListener("click", () => subTab(t.dataset.sub)));
  $("usSrvNickForm").addEventListener("submit", (e) => { e.preventDefault(); app.socket.emit("nick:set", { uid: app.myUid, nick: $("usSrvNick").value }); note("Apelido no servidor salvo."); setTimeout(preview, 500); });
  $("usSrvNickReset").addEventListener("click", () => { $("usSrvNick").value = ""; app.socket.emit("nick:set", { uid: app.myUid, nick: "" }); setTimeout(preview, 500); });
  function cardOf(box, opts) {
    const p = profile(), n = nick();
    const shown = opts.srvNick || app.dispName(n);
    const banner = el("span", "banner"); banner.style.background = opts.banner || p.banner || p.color || "var(--accent)";
    const parts = [banner, presOf(n, true), el("span", "pname", shown)];
    if (shown !== n) parts.push(el("span", "puser", n));
    const text = opts.text !== undefined ? opts.text : p.status_text;
    if (text) parts.push(el("span", "ptext", text));
    const bio = opts.bio !== undefined ? opts.bio : p.bio;
    if (bio) { parts.push(el("span", "plabel", "SOBRE MIM")); parts.push(el("span", "pbio", bio)); }
    box.replaceChildren(...parts);
  }
  function preview() {
    if (page !== "perfis") return;
    cardOf($("usCard"), {
      banner: document.activeElement === $("bannerColor") ? $("bannerColor").value : undefined,
      text: $("statusTextInput").value, bio: $("bioInput").value,
      srvNick: curSub === "srv" ? $("usSrvNick").value.trim() || undefined : undefined,
    });
  }
  for (const id of ["statusTextInput", "bioInput", "usSrvNick", "bannerColor"]) $(id).addEventListener("input", preview);
  for (const id of ["statusTextForm", "bioForm", "bannerSave", "bannerReset", "decoPick", "colorPick", "avatarFile"]) $(id).addEventListener(id.endsWith("Form") ? "submit" : id === "avatarFile" ? "change" : "click", () => setTimeout(preview, 800));

  // Dados e privacidade
  $("usExport").addEventListener("click", async () => {
    try {
      const data = await auth().exportData();
      const a = el("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      a.download = "chat-pedro-meus-dados.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (err) { $("profMsg").textContent = err.message; }
  });
  // Dispositivos
  let othersArmed = false;
  $("usOthersOut").addEventListener("click", async () => {
    if (!othersArmed) { othersArmed = true; $("usOthersOut").textContent = "Certeza? Clique de novo"; setTimeout(() => { othersArmed = false; $("usOthersOut").textContent = "Sair de todos os outros dispositivos"; }, 4000); return; }
    try { await auth().signOutOthers(); note("Pronto: sua conta saiu de todos os outros aparelhos."); }
    catch (err) { $("profMsg").textContent = err.message; }
  });

  // ---------- menus flutuantes: cartao da conta e setinhas do microfone/fone ----------
  const pop = el("div", "upop"); pop.id = "upPop"; pop.hidden = true; pop.setAttribute("role", "menu");
  document.body.append(pop);
  let popFor = null;
  function closePops() {
    if (pop.hidden) return false;
    pop.hidden = true;
    if (popFor) popFor.setAttribute("aria-expanded", "false");
    popFor = null;
    return true;
  }
  function openPop(anchor, build, align) {
    if (popFor === anchor) { closePops(); return; }
    closePops();
    pop.className = "upop" + (align === "card" ? " ucard" : "");
    build(pop);
    pop.hidden = false;
    popFor = anchor; anchor.setAttribute("aria-expanded", "true");
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, align === "card" ? r.left : r.left + r.width / 2 - w / 2)) + "px";
    pop.style.top = Math.max(8, r.top - h - 8) + "px";
  }
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target) && !(popFor && popFor.contains(e.target))) closePops(); });
  window.addEventListener("resize", closePops);

  const item = (label, ic, fn, opts = {}) => {
    const b = el("button", "uitem" + (opts.danger ? " danger" : "")); b.type = "button"; b.setAttribute("role", "menuitem");
    if (opts.lead) b.append(opts.lead);
    const t = el("span", "ul"); t.append(el("span", "", label)); if (opts.sub) t.append(el("small", "", opts.sub));
    b.append(t);
    if (ic) b.append(app.icon(ic));
    if (fn) b.addEventListener("click", (e) => { e.stopPropagation(); fn(b); });
    return b;
  };
  const sep = () => el("div", "usep");
  const dot = (st) => el("span", "sdot " + st);

  // cartao da conta (clique no seu nome)
  const STATUS_INFO = { online: "", ausente: "", ocupado: "Você não vai receber notificações na área de trabalho.", invisivel: "Você não vai aparecer online, mas vai ter acesso total ao Chat Pedro." };
  function accountCard(box) {
    box.replaceChildren();
    const wrap = el("div", "ucard-in");
    cardOf(wrap, {});
    const menu = el("div", "ubox");
    menu.append(item("Editar perfil", "pencil", () => open("perfis")));
    menu.append(sep());
    const st = statusOf();
    const stRow = item(app.STATUS[st] || "Online", "chevron-right", () => { list.hidden = !list.hidden; stRow.classList.toggle("open", !list.hidden); }, { lead: dot(st) });
    stRow.classList.add("hassub");
    const list = el("div", "ustatus"); list.hidden = true;
    for (const [k, label] of Object.entries(app.STATUS)) {
      const r = item(label, k === st ? "check" : null, () => { app.setStatus(k); closePops(); }, { lead: dot(k), sub: STATUS_INFO[k] || undefined });
      list.append(r);
    }
    menu.append(stRow, list);
    menu.append(item(profile().status_text ? "Editar status personalizado" : "Definir status personalizado", "smile", () => { open("perfis"); setTimeout(() => $("statusTextInput").focus(), 50); }));
    menu.append(sep());
    menu.append(item("Configurações de usuário", "ugear", () => open("conta")));
    if (get("dev") && app.myUid) menu.append(item("Copiar ID do usuário", "copy", () => { closePops(); app.copyText(app.myUid, "ID copiado."); }));
    box.append(wrap, menu);
  }
  $("profileBtn").addEventListener("click", (e) => { e.stopPropagation(); openPop($("profileBtn"), accountCard, "card"); });

  // setinhas do microfone e do fone: escolher o aparelho, volume e atalho para Voz e video
  async function devices(kind) {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === kind); } catch { return []; }
  }
  function slider(label, id, max, value) {
    const box = el("label", "uslider");
    const head = el("span", "ul"); const val = el("b", "", value + "%"); head.append(el("span", "", label), val);
    const r = el("input"); r.type = "range"; r.min = 0; r.max = max; r.step = 5; r.value = value;
    r.addEventListener("input", () => { val.textContent = r.value + "%"; app.audio.setRange(id, r.value); });
    r.addEventListener("click", (e) => e.stopPropagation());
    box.append(head, r);
    return box;
  }
  async function deviceMenu(box, kind) {
    const a = app.audio;
    const isIn = kind === "audioinput";
    const list = await devices(kind);
    const cur = isIn ? a.micNow() : a.prefs.outId || "default";
    const curDev = list.find((d) => d.deviceId === cur) || list[0];
    box.replaceChildren();
    const devRow = item(isIn ? "Dispositivo de entrada" : "Dispositivo de saída", "chevron-right", () => { sub.hidden = !sub.hidden; devRow.classList.toggle("open", !sub.hidden); }, { sub: curDev ? curDev.label || "Padrão" : "Padrão" });
    devRow.classList.add("hassub");
    const sub = el("div", "ustatus"); sub.hidden = true;
    if (!isIn && !a.canPickOutput()) sub.append(el("small", "uhint", "Seu navegador não deixa escolher a saída. No Chrome ou no Edge do computador dá."));
    else if (!list.length) sub.append(el("small", "uhint", "Nenhum aparelho encontrado. Libere o microfone no navegador."));
    list.forEach((d, i) => {
      const on = d === curDev;
      const r = item(d.label || (isIn ? "Microfone " : "Saída ") + (i + 1), null, () => { a.pick(isIn ? "micSelect" : "outSelect", d.deviceId); closePops(); }, { lead: el("span", "uradio" + (on ? " on" : "")) });
      sub.append(r);
    });
    box.append(devRow, sub);
    if (isIn) {
      const simple = item("Perfil de entrada", null, null, { sub: a.prefs.simple ? "Sem filtros" : "Isolamento de voz" });
      const tg = el("input"); tg.type = "checkbox"; tg.className = "utog"; tg.checked = !a.prefs.simple; tg.title = "Cancelamento de eco e redução de ruído";
      tg.addEventListener("click", (e) => e.stopPropagation());
      tg.addEventListener("change", () => { $("simpleMic").click(); simple.querySelector("small").textContent = a.prefs.simple ? "Sem filtros" : "Isolamento de voz"; });
      simple.append(tg);
      box.append(simple);
    }
    box.append(sep());
    box.append(isIn ? slider("Volume de entrada", "micGain", 200, a.prefs.micGain) : slider("Volume de saída", "master", 100, a.prefs.master));
    box.append(sep());
    box.append(item("Configurações de voz", "ugear", () => open("voz")));
  }
  const devPop = (btn, kind) => (e) => {
    e.stopPropagation();
    openPop(btn, (box) => { box.replaceChildren(el("small", "uhint", "carregando...")); deviceMenu(box, kind).then(() => { if (popFor === btn) reposition(btn); }); });
  };
  function reposition(anchor) {
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
    pop.style.top = Math.max(8, r.top - h - 8) + "px";
  }
  $("upMicMenu").addEventListener("click", devPop($("upMicMenu"), "audioinput"));
  $("upDeafMenu").addEventListener("click", devPop($("upDeafMenu"), "audiooutput"));

  $("usAgent").textContent = navigator.platform || "";
})();

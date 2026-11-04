// Chat Pedro dentro do programa do Windows (pasta desktop/). So faz algo quando o site esta aberto pelo
// programa: window.ChatPedroDesktop vem do desktop/preload.js. No navegador para na primeira linha.
// Aqui ficam: botoes da janela na barra de cima, numero de nao lidas no icone, mutar pelo icone perto do relogio,
// atalhos que funcionam dentro de jogos, "Jogando ...", escolher a tela/janela para compartilhar e as paginas
// "Configuracoes do Windows" e "Jogos registrados" nas Configuracoes de usuario.
(() => {
  const D = window.ChatPedroDesktop;
  if (!D) return;
  const app = window.ChatPedro;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const ico = (inner, vb) => '<svg viewBox="' + (vb || "0 0 16 16") + '" aria-hidden="true">' + inner + "</svg>";
  const P = (k) => (window.ChatPedroPrefs ? window.ChatPedroPrefs.get(k) : undefined);
  document.documentElement.classList.add("desktop");
  let cfg = {};

  // ---------- barra da janela (minimizar, maximizar, fechar) ----------
  const I = {
    min: '<path d="M3.5 8h9"/>',
    max: '<rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/>',
    restore: '<path d="M6 3.5h5a1.5 1.5 0 0 1 1.5 1.5v5"/><rect x="3.5" y="6" width="6.5" height="6.5" rx="1.5"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
    upd: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  };
  const header = document.querySelector("body > header");
  const mk = (cls, label, icon, fn, vb) => {
    const b = el("button", cls); b.type = "button"; b.title = label; b.setAttribute("aria-label", label);
    b.innerHTML = ico(icon, vb); b.addEventListener("click", fn);
    return b;
  };
  const trail = el("div", "wtrail"); trail.hidden = true;
  trail.append(mk("wupd", "Atualização pronta: clique para reiniciar o Chat Pedro", I.upd, () => D.installUpdate(), "0 0 24 24"));
  const bar = el("div", "winbtns"); bar.id = "winBtns";
  const bMax = mk("wmax", "Maximizar", I.max, () => D.maximize());
  bar.append(mk("wmin", "Minimizar", I.min, () => D.minimize()), bMax, mk("wclose", "Fechar", I.close, () => D.close()));
  if (header) header.append(trail, bar);
  // a pessoa esta olhando para o Chat Pedro? (o programa sabe melhor que a pagina: janela escondida perto do
  // relogio ou com um jogo na frente conta como longe, para os avisos e o numero no icone)
  let winSeen = true;
  window.ChatPedroDesktopAway = () => !winSeen;
  D.onWinState((s) => {
    winSeen = !!(s.focused && s.visible !== false);
    if (winSeen && unread) setUnread(0);
    bMax.innerHTML = ico(s.maximized ? I.restore : I.max);
    const t = s.maximized ? "Restaurar" : "Maximizar"; bMax.title = t; bMax.setAttribute("aria-label", t);
    document.body.classList.toggle("win-blur", !s.focused);
  });
  D.onUpdate((s) => { if (s === "ready") trail.hidden = false; });

  // a janela aparece quando o site termina de abrir (antes disso fica a janelinha de abertura)
  const isReady = () => document.body.classList.contains("ready") || document.body.classList.contains("booted");
  if (isReady()) D.ready();
  else {
    const mo = new MutationObserver(() => { if (isReady()) { mo.disconnect(); D.ready(); } });
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  // ---------- nao lidas: numero vermelho no icone da barra de tarefas e bolinha no icone perto do relogio ----------
  let unread = 0;
  function badgePng(n) {
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const g = c.getContext("2d");
    g.fillStyle = "#d22d39"; g.beginPath(); g.arc(16, 16, 16, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
    const t = n > 9 ? "9+" : String(n);
    g.font = "700 " + (t.length > 1 ? 17 : 21) + 'px "gg sans", "Noto Sans", "Segoe UI", sans-serif';
    g.fillText(t, 16, 17);
    return c.toDataURL("image/png");
  }
  function setUnread(n) { unread = n; D.setBadge(n, n ? badgePng(n) : ""); }
  // mencao ou mensagem direta com a janela sem foco: conta e pisca na barra de tarefas (como no Discord)
  app.onAlert = (a) => {
    if (!a || !a.away || !(a.mentioned || a.dm)) return;
    if (a.busy && !a.mentioned) return; // "Nao perturbe"
    setUnread(unread + 1);
    D.flash();
  };
  app.onRing = () => { if (window.ChatPedroAway && window.ChatPedroAway()) D.flash(); };
  window.addEventListener("focus", () => { if (unread) setUnread(0); });
  // clicar no aviso do Windows traz o Chat Pedro para frente
  if ("Notification" in window) {
    const N = window.Notification;
    class DeskNotification extends N {
      constructor(title, opts) { super(title, opts); this.addEventListener("click", () => { D.show(); window.focus(); }); }
    }
    window.Notification = DeskNotification;
  }

  // ---------- microfone e fone pelo icone perto do relogio e pelos atalhos globais ----------
  let lastVoice = "";
  app.onVoice = (s) => { const k = JSON.stringify(s); if (k !== lastVoice) { lastVoice = k; D.setVoice(s); } };
  if (app.audio && app.audio.state) app.onVoice((({ inCall, micOn, deaf }) => ({ inCall, micOn, deaf }))(app.audio.state()));
  D.onTray((a) => {
    if (!app.audio) return;
    if (a === "mute") app.audio.toggleMic();
    if (a === "deaf") app.audio.toggleDeaf();
  });
  D.onHotkey(({ action, down }) => {
    if (!app.audio) return;
    if (action === "ptt") app.audio.ptt(down);
    else if (action === "mute" && down) app.audio.toggleMic();
    else if (action === "deaf" && down) app.audio.toggleDeaf();
  });

  // ---------- "Jogando ..." ----------
  let game = null;
  const setGame = (g) => { game = g || null; if (app.setGame) app.setGame(game ? game.name : ""); renderGames(); };
  D.onGame(setGame);
  D.gameNow().then((g) => { if (g) setGame(g); }).catch(() => {});

  // ---------- zoom (Ctrl + / Ctrl - / Ctrl 0) e modo desenvolvedor (F12) ----------
  D.onZoom((d) => {
    const prefs = window.ChatPedroPrefs;
    if (!prefs || !prefs.set) return;
    const z = Number(prefs.get("zoom")) || 100;
    prefs.set("zoom", d === 0 ? 100 : Math.max(50, Math.min(200, z + d * 10)));
  });
  D.setDevMode(!!P("dev"));
  document.addEventListener("change", (e) => { if (e.target && e.target.matches && e.target.matches('#userSettings [data-pref="dev"]')) D.setDevMode(e.target.checked); });

  // ---------- compartilhar tela: escolher o que mostrar (como a janela "Compartilhar tela" do Discord) ----------
  D.onPickScreen(({ id, audio, sources }) => {
    const old = $("pickModal"); if (old) old.remove();
    const wrap = el("div", "modal"); wrap.id = "pickModal"; wrap.style.zIndex = "80";
    const box = el("div", "pick-box"); box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Compartilhar tela");
    const head = el("div", "pick-head");
    const tabs = el("div", "pick-tabs");
    const grid = el("div", "pick-grid");
    const foot = el("div", "pick-foot");
    const snd = el("label"); const sndIn = el("input"); sndIn.type = "checkbox"; sndIn.checked = true; snd.append(sndIn, document.createTextNode("Compartilhar o som do computador"));
    snd.hidden = !audio;
    const cancel = el("button", "btn2 cancel", "Cancelar"); cancel.type = "button";
    const go = el("button", "btn2 go", "Compartilhar"); go.type = "button"; go.disabled = true;
    foot.append(snd, cancel, go);
    head.append(el("h3", "", "Compartilhar tela"), tabs);
    box.append(head, grid, foot);
    wrap.append(box);
    let chosen = null, kind = sources.some((s) => s.kind === "window") ? "window" : "screen", done = false;
    const finish = (choice) => {
      if (done) return; done = true;
      D.pickReply(id, choice);
      wrap.remove();
      document.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); finish(null); } };
    document.addEventListener("keydown", onKey, true);
    const tab = (k, label) => {
      const b = el("button", "", label); b.type = "button";
      b.addEventListener("click", () => { kind = k; draw(); });
      return b;
    };
    const tWin = tab("window", "Aplicativos"), tScr = tab("screen", "Telas");
    tabs.append(tWin, tScr);
    function draw() {
      tWin.classList.toggle("on", kind === "window"); tScr.classList.toggle("on", kind === "screen");
      grid.replaceChildren();
      const list = sources.filter((s) => s.kind === kind);
      if (!list.length) grid.append(el("div", "pick-empty", kind === "window" ? "Nenhum aplicativo aberto para compartilhar." : "Nenhuma tela encontrada."));
      list.forEach((s, i) => {
        const b = el("button", "pick-item" + (chosen === s.id ? " on" : "")); b.type = "button";
        if (s.thumb) { const im = el("img", "th"); im.src = s.thumb; im.alt = ""; b.append(im); }
        const nm = el("span", "nm");
        if (s.icon) { const ic = el("img"); ic.src = s.icon; ic.alt = ""; nm.append(ic); }
        nm.append(el("span", "", s.kind === "screen" && sources.filter((x) => x.kind === "screen").length > 1 ? "Tela " + (i + 1) : s.kind === "screen" ? "Tela inteira" : s.name));
        b.title = s.name;
        b.append(nm);
        b.addEventListener("click", () => { chosen = s.id; go.disabled = false; draw(); });
        b.addEventListener("dblclick", () => finish({ id: s.id, audio: audio && sndIn.checked }));
        grid.append(b);
      });
    }
    cancel.addEventListener("click", () => finish(null));
    go.addEventListener("click", () => { if (chosen) finish({ id: chosen, audio: audio && sndIn.checked }); });
    wrap.addEventListener("click", (e) => { if (e.target === wrap) finish(null); });
    draw();
    document.body.append(wrap);
  });

  // ---------- Configuracoes de usuario: paginas que so existem no programa ----------
  const tabs = $("usTabs"), main = $("usMain");
  const pagesBox = main && main.querySelector(".gs-in");
  const tabBtn = (page, label) => { const b = el("button", "gs-tab", label); b.type = "button"; b.dataset.page = page; return b; };
  const page = (name, title) => { const s = el("section", "us-page"); s.dataset.page = name; s.hidden = true; s.append(el("h2", "gs-title", title)); return s; };
  const toggle = (label, hint, key) => {
    const l = el("label", "gs-toggle"); const t = el("span", "gs-ptxt", label);
    if (hint) t.append(el("small", "", hint));
    const i = el("input"); i.type = "checkbox"; i.dataset.desk = key;
    i.addEventListener("change", async () => { cfg = (await D.setConfig({ [key]: i.checked })) || cfg; renderWindows(); });
    l.append(t, i);
    return l;
  };
  const before = (sel) => tabs && tabs.querySelector(sel);
  // "Configuracoes do Windows" (no Discord fica entre Idioma e Modo streamer)
  const pgWin = page("windows", "Configurações do Windows");
  pgWin.append(
    el("span", "gs-label", "COMPORTAMENTO DE INICIALIZAÇÃO DO SISTEMA"),
    toggle("Abrir o Chat Pedro", "Abre sozinho quando você liga o computador, para não perder mensagens nem chamadas.", "openAtLogin"),
    toggle("Iniciar minimizado", "Quando abre junto com o Windows, fica só no ícone perto do relógio.", "startMinimized"),
    el("div", "us-divider"),
    el("span", "gs-label", "BOTÃO FECHAR"),
    toggle("Minimizar para a área de notificação", "Ao clicar no X, o Chat Pedro continua aberto perto do relógio, recebendo mensagens e chamadas.", "closeToTray"),
    el("div", "us-divider"),
    el("span", "gs-label", "VERSÃO"),
  );
  const verTxt = el("p", "gs-sub", "");
  pgWin.append(verTxt);
  function renderWindows() {
    pgWin.querySelectorAll("input[data-desk]").forEach((i) => { i.checked = !!cfg[i.dataset.desk]; });
    const sm = pgWin.querySelector('input[data-desk="startMinimized"]');
    if (sm) { sm.disabled = !cfg.openAtLogin; sm.closest("label").style.opacity = cfg.openAtLogin ? "" : "0.5"; }
    verTxt.textContent = "Chat Pedro para Windows " + (cfg.version || D.version) + ". As telas vêm direto do site, então as novidades aparecem aqui sem reinstalar.";
  }

  // atalhos globais, no comeco da pagina "Atalhos do teclado"
  const kbBox = el("div", "kb-box");
  const KB = [
    ["ptt", "Apertar para falar", "Segure para falar, mesmo com um jogo na frente."],
    ["mute", "Ativar/desativar microfone", "Silencia ou liga o seu microfone."],
    ["deaf", "Ativar/desativar áudio", "Para de ouvir a call (e silencia o microfone)."],
  ];
  let recordingAction = null;
  function renderKeys() {
    kbBox.replaceChildren(el("span", "gs-label", "ATALHOS QUE FUNCIONAM EM QUALQUER LUGAR"));
    const sub = el("p", "gs-sub", "Funcionam mesmo com um jogo ou outra janela na frente. Clique no quadro e aperte a tecla (ou um botão lateral do mouse).");
    kbBox.append(sub);
    if (cfg.hookOk === false) kbBox.append(el("p", "gs-sub", "Não deu para ligar os atalhos globais neste computador."));
    for (const [action, name, hint] of KB) {
      const row = el("div", "kb-row");
      const nm = el("span", "kb-name", name);
      const h = el("small", "", hint);
      if (action === "ptt" && app.audio && !app.audio.prefs.ptt) {
        h.textContent = hint + " Ligue \"Apertar para falar\" em ";
        const a = el("a", "", "Voz e vídeo"); a.href = "#"; a.dataset.go = "voz";
        a.addEventListener("click", (e) => e.preventDefault());
        h.append(a, document.createTextNode("."));
      }
      nm.append(h);
      const b = (cfg.binds || {})[action];
      const key = el("button", "kb-key" + (recordingAction === action ? " rec" : "")); key.type = "button";
      key.dataset.action = action;
      key.append(el("span", "", recordingAction === action ? "Aperte uma tecla..." : b ? b.label : "Nenhum atalho"));
      if (b && recordingAction !== action) {
        const x = el("span", "kb-x"); x.setAttribute("role", "button"); x.title = "Remover atalho"; x.setAttribute("aria-label", "Remover atalho");
        x.innerHTML = ico(I.close);
        x.addEventListener("click", async (e) => {
          e.stopPropagation();
          const nb = { ...(cfg.binds || {}) }; delete nb[action];
          cfg = (await D.setConfig({ binds: nb })) || cfg; renderKeys();
        });
        key.append(x);
      }
      key.addEventListener("click", async () => {
        if (recordingAction) { D.cancelRecord(); return; }
        recordingAction = action; renderKeys();
        const got = await D.recordBind().catch(() => null);
        recordingAction = null;
        if (got) {
          const nb = { ...(cfg.binds || {}) };
          for (const k of Object.keys(nb)) if (nb[k] && nb[k].kind === got.kind && nb[k].code === got.code && k !== action) delete nb[k]; // a mesma tecla em duas acoes nao
          nb[action] = got;
          cfg = (await D.setConfig({ binds: nb })) || cfg;
        }
        renderKeys();
      });
      row.append(nm, key);
      kbBox.append(row);
    }
    kbBox.append(el("div", "us-divider"), el("span", "gs-label", "ATALHOS DENTRO DO CHAT PEDRO"));
  }

  // "Jogos registrados" (no Discord fica em Configuracoes de atividade)
  const pgGames = page("jogos", "Jogos registrados");
  const gamesBody = el("div", "games-body");
  pgGames.append(gamesBody);
  let progs = null;
  function renderGames() {
    if (!pgGames.isConnected || pgGames.hidden) return;
    gamesBody.replaceChildren();
    const now = el("div", "game-now" + (game ? "" : " none"));
    const gi = el("span", "gi"); gi.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-gamepad"/></svg>';
    const gt = el("span", "gt");
    if (game) gt.append(el("small", "", "Jogando agora"), el("b", "", game.name));
    else gt.append(el("b", "", "Nenhum jogo detectado"), el("small", "", "O Chat Pedro olha os programas abertos e mostra o jogo para os seus amigos."));
    now.append(gi, gt);
    if (game && !(cfg.games || []).some((g) => g.exe === game.exe)) {
      const hide = el("button", "cmd", "Não mostrar"); hide.type = "button";
      hide.addEventListener("click", async () => { cfg = (await D.setConfig({ ignored: [...(cfg.ignored || []), game.exe] })) || cfg; renderGames(); });
      now.append(hide);
    }
    gamesBody.append(now);
    if (!P("activity")) {
      const n = el("p", "gs-sub", "\"Compartilhar minha atividade\" está desligado: ninguém vê o que você joga. ");
      const a = el("a", "", "Ligar em Privacidade nas atividades"); a.href = "#"; a.dataset.go = "atividade"; a.addEventListener("click", (e) => e.preventDefault());
      n.append(a); gamesBody.append(n);
    }
    const addRow = el("p", "gs-sub", "Não está vendo seu jogo? ");
    const add = el("a", "", "Adicionar!"); add.href = "#";
    add.addEventListener("click", async (e) => {
      e.preventDefault();
      progs = el("div", "prog-list"); progs.append(el("small", "gs-sub", "Procurando programas abertos..."));
      renderGames();
      const list = await D.listPrograms().catch(() => []);
      progs.replaceChildren();
      if (!list.length) progs.append(el("small", "gs-sub", "Nenhum programa aberto encontrado. Abra o jogo e tente de novo."));
      for (const p of list) {
        const b = el("button"); b.type = "button";
        b.append(el("span", "", p.title), el("small", "", p.exe));
        // escolheu o programa: confirma o nome que aparece para os amigos
        b.addEventListener("click", () => {
          const f = el("form", "game-add");
          const inp = el("input"); inp.type = "text"; inp.value = p.title; inp.maxLength = 60; inp.setAttribute("aria-label", "Nome do jogo para os seus amigos");
          const ok = el("button", "cmd", "Adicionar"); ok.type = "submit";
          const no = el("button", "cmd", "Cancelar"); no.type = "button";
          no.addEventListener("click", () => { progs = null; renderGames(); });
          f.addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const name = inp.value.trim();
            if (!name) return;
            progs = null;
            cfg = (await D.setConfig({ games: [...(cfg.games || []).filter((g) => g.exe !== p.exe), { exe: p.exe, name }] })) || cfg;
            renderGames();
          });
          f.append(el("span", "gs-label", "NOME DO JOGO PARA OS SEUS AMIGOS"), inp, ok, no);
          progs = f;
          renderGames();
          inp.focus(); inp.select();
        });
        progs.append(b);
      }
      renderGames();
    });
    addRow.append(add);
    gamesBody.append(addRow);
    if (progs) gamesBody.append(progs);
    const mine = cfg.games || [], ign = cfg.ignored || [];
    if (mine.length) {
      gamesBody.append(el("span", "gs-label", "JOGOS ADICIONADOS"));
      const list = el("div", "game-list");
      for (const g of mine) {
        const r = el("div", "gs-rrow");
        const x = el("button", "cmd", "Remover"); x.type = "button";
        x.addEventListener("click", async () => { cfg = (await D.setConfig({ games: mine.filter((y) => y !== g) })) || cfg; renderGames(); });
        r.append(el("span", "gs-rname", g.name), el("small", "gs-sub", g.exe), x);
        list.append(r);
      }
      gamesBody.append(list);
    }
    if (ign.length) {
      gamesBody.append(el("span", "gs-label", "JOGOS QUE NÃO APARECEM"));
      const list = el("div", "game-list");
      for (const exe of ign) {
        const r = el("div", "gs-rrow");
        const x = el("button", "cmd", "Mostrar de novo"); x.type = "button";
        x.addEventListener("click", async () => { cfg = (await D.setConfig({ ignored: ign.filter((y) => y !== exe) })) || cfg; renderGames(); });
        r.append(el("span", "gs-rname", exe), x);
        list.append(r);
      }
      gamesBody.append(list);
    }
  }

  if (tabs && pagesBox) {
    const streamerTab = before('.gs-tab[data-page="streamer"]');
    tabs.insertBefore(tabBtn("windows", "Configurações do Windows"), streamerTab);
    const actTab = before('.gs-tab[data-page="atividade"]');
    if (actTab) actTab.after(tabBtn("jogos", "Jogos registrados"));
    const streamerPage = pagesBox.querySelector('.us-page[data-page="streamer"]');
    pagesBox.insertBefore(pgWin, streamerPage);
    const actPage = pagesBox.querySelector('.us-page[data-page="atividade"]');
    if (actPage) actPage.after(pgGames);
    const keysPage = pagesBox.querySelector('.us-page[data-page="atalhos"]');
    // atalhos globais logo depois do titulo; os de dentro do Chat Pedro ficam embaixo
    const keysTitle = keysPage && keysPage.querySelector(".gs-title");
    if (keysTitle) keysTitle.after(kbBox);
    // cada pagina se desenha quando aparece
    const watch = (sec, fn) => new MutationObserver(() => { if (!sec.hidden) fn(); }).observe(sec, { attributes: true, attributeFilter: ["hidden"] });
    const refresh = async (fn) => { cfg = (await D.getConfig().catch(() => null)) || cfg; fn(); };
    watch(pgWin, () => refresh(renderWindows));
    watch(pgGames, () => { progs = null; refresh(renderGames); });
    if (keysPage) watch(keysPage, () => refresh(renderKeys));
    const devPage = pagesBox.querySelector('.us-page[data-page="dispositivos"]');
    if (devPage) watch(devPage, () => { const n = $("usDevName"); if (n) n.textContent = "Windows · Chat Pedro para Windows"; });
  }
  const appLbl = $("usApp");
  if (appLbl) appLbl.textContent = "Chat Pedro para Windows " + D.version;
  D.onConfig((c) => { cfg = c || cfg; if (!pgWin.hidden) renderWindows(); });
  D.getConfig().then((c) => { cfg = c || {}; if (cfg.update) trail.hidden = false; }).catch(() => {});
})();

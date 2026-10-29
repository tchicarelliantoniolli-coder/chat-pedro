// Mesa de truco (lado do navegador): desenha o que o servidor manda, envia as jogadas
// e cuida da parte divertida (gritos, sons 8-bit, zoeira e sinais para o parceiro).
(() => {
  const $ = (id) => document.getElementById(id);
  const app = window.ChatPedro;
  const { socket, avatar, setNote, store } = app;
  const SUIT = { d: "♦", s: "♠", h: "♥", c: "♣" };
  const RANK = { Q: "Q", J: "J", K: "K", A: "A" };
  const MANILHA_NAME = { d: "PICA-FUMO", s: "ESPADILHA", h: "COPAS", c: "ZAP" };
  let st = null;
  let clockSkew = 0;             // diferenca entre o relogio do servidor e o daqui
  let hopNow = false;            // alguem acabou de jogar: as cartas da mesa pulam
  let lastTick = -1, lastEnds = 0;
  let hideNext = false;          // proxima carta vai encoberta
  let funOpen = null;            // "zoar" | "sinal" | null
  const bubbles = new Map();     // seat -> { text, sig, until }
  let sound = store.get("chatpedro-trucosom") !== "off";

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const open = () => !$("truco").hidden;

  // ---------- sons 8-bit ----------
  let actx = null;
  function beep(notes) {
    if (!sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      let t = actx.currentTime;
      for (const [freq, dur, type] of notes) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type || "square"; o.frequency.value = freq;
        g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
        t += dur * 0.9;
      }
    } catch {}
  }
  const SFX = {
    card: [[520, 0.05], [260, 0.05]],
    raise: [[330, 0.09], [440, 0.09], [660, 0.09], [880, 0.22, "sawtooth"]],
    accept: [[523, 0.1], [784, 0.18]],
    run: [[600, 0.1], [400, 0.1], [250, 0.25, "sawtooth"]],
    round: [[880, 0.06]],
    tie: [[300, 0.12], [300, 0.12]],
    game: [[523, 0.12], [659, 0.12], [784, 0.12], [1046, 0.35]],
    phrase: [[700, 0.04], [900, 0.04]],
    turn: [[990, 0.08], [1320, 0.12]],
  };

  function card(code, opts = {}) {
    const tag = opts.button ? "button" : "div";
    if (!code || code === "??") {
      const b = el(tag, "tcard back"); if (opts.button) b.type = "button"; return b;
    }
    const isMani = st && st.manilha && code[0] === st.manilha;
    const c = el(tag, "tcard" + (code[1] === "h" || code[1] === "d" ? " red" : "") + (isMani ? " mani" : ""));
    if (opts.button) c.type = "button";
    c.append(el("span", "r", RANK[code[0]] || code[0]), el("span", "s", SUIT[code[1]]));
    c.setAttribute("aria-label", code + (isMani ? " (manilha " + MANILHA_NAME[code[1]] + ")" : ""));
    return c;
  }

  const base = () => (st.me >= 0 ? st.me : 0);
  function spot(seat, r) {
    const k = (seat - base() + st.size) % st.size;
    const a = (90 + k * (360 / st.size)) * Math.PI / 180;
    return { x: 50 + r[0] * Math.cos(a), y: 50 + r[1] * Math.sin(a) };
  }
  const usTeam = () => (st.myTeam === null ? 0 : st.myTeam);
  const teamLabel = (t) => (st.myTeam === null ? (t ? "TIME B" : "TIME A") : t === st.myTeam ? "NOS" : "ELES");

  // ---------- desenho ----------
  function render() {
    if (!st) return;
    renderScore();
    renderFelt();
    renderHand();
    renderActions();
    renderFun();
    renderBar();
    const log = $("trLog");
    log.replaceChildren(...st.log.map((l) => el("div", "", l)));
    log.scrollTop = log.scrollHeight;
  }

  function renderScore() {
    const box = $("trScore");
    box.replaceChildren();
    $("trInfo").textContent = st.stage === "empty" ? "" : "mesa de " + st.size + (st.hostNick ? "  criada por " + st.hostNick : "");
    if (["empty", "lobby"].includes(st.stage)) return;
    const us = usTeam(), them = 1 - us;
    box.append(
      el("span", "pts us", teamLabel(us) + " " + st.score[us]),
      el("span", "pts", "x"),
      el("span", "pts them", st.score[them] + " " + teamLabel(them)),
      el("span", "val", "VALE " + st.value),
    );
    if (st.special === "onze") box.append(el("span", "val", "MÃO DE ONZE"));
    if (st.special === "ferro") box.append(el("span", "val", "MÃO DE FERRO"));
    const rounds = el("span", "rounds", "rodadas ");
    for (let i = 0; i < 3; i++) {
      const r = st.rounds[i];
      rounds.append(el("i", r === undefined ? "" : r === "tie" ? "tie" : r === us ? "us" : "them"));
    }
    box.append(rounds);
    if (st.games[0] || st.games[1]) box.append(el("span", "games", "partidas " + st.games[us] + " x " + st.games[them]));
  }

  function renderFelt() {
    const felt = $("trFelt");
    const keep = felt.querySelector(".tr-shout");
    felt.replaceChildren();
    if (st.stage === "empty") {
      const c = el("div", "tr-center");
      c.append(el("div", "lbl", app.nick ? "Ninguém abriu mesa ainda. Crie uma lá embaixo!" : "Escolha um apelido para jogar"));
      felt.append(c);
      return;
    }
    const SEAT = [39, 39]; // mesa redonda: todo mundo na mesma distancia do centro
    const PLAY = [23, 23];
    // centro: vira e manilha
    const center = el("div", "tr-center");
    if (st.vira && !["lobby"].includes(st.stage)) {
      const v = el("div", "");
      v.append(hopCard(card(st.vira), 0));
      center.append(v);
      center.append(el("div", "lbl", st.manilha ? "VIRA\nmanilha: " + (RANK[st.manilha] || st.manilha) : "VIRA\n(no escuro)"));
      center.lastChild.style.whiteSpace = "pre";
    } else if (st.stage === "lobby") {
      const n = st.seats.filter((s) => s.nick).length;
      center.append(el("div", "lbl", n + " de " + st.size + " sentados\n" + (n < st.size ? "esperando a galera..." : "pronto para começar!")));
      center.lastChild.style.whiteSpace = "pre";
    }
    if (st.stage === "gameOver") {
      center.replaceChildren(el("div", "lbl", (st.winner === st.myTeam ? "VOCÊS GANHARAM!" : st.myTeam === null ? teamLabel(st.winner) + " GANHOU!" : "PERDERAM...") + "\n" + st.score[usTeam()] + " x " + st.score[1 - usTeam()]));
      center.lastChild.style.whiteSpace = "pre";
    }
    felt.append(center);

    st.seats.forEach((s, i) => {
      const pos = spot(i, SEAT);
      const seat = el("div", "tr-seat" + (s.team === usTeam() ? "" : " them") + (s.nick ? "" : " empty") + (st.toPlay === i && st.stage === "playing" ? " turn" : ""));
      seat.style.left = pos.x + "%"; seat.style.top = pos.y + "%";
      // cartas do parceiro na mao de onze
      if (s.hand) { const ph = el("div", "partner"); s.hand.forEach((c) => ph.append(card(c))); seat.append(ph); }
      else if (s.cards && i !== st.me) { const bk = el("div", "backs"); for (let k = 0; k < s.cards; k++) bk.append(hopCard(card("??"), i + 1)); seat.append(bk); }
      const box = el("div", "box");
      if (s.nick) {
        box.append(avatar(s.nick), el("span", "nm", s.nick + (i === st.me ? " (você)" : "")));
      } else if (st.me < 0 && app.nick && st.stage !== "gameOver") {
        const b = el("button", "cmd", st.stage === "lobby" ? "Sentar" : "Assumir");
        b.type = "button"; b.style.width = "100%";
        b.addEventListener("click", () => socket.emit("truco:sit", i, done));
        box.append(b);
      } else box.append(el("span", "nm", st.stage === "lobby" ? "vazio" : "vazio (joga sozinho)"));
      seat.append(box);
      if (whoActs().seats.includes(i)) { const tm = el("div", "ttimer"); tm.append(el("i")); seat.append(tm); }
      const tags = [];
      if (i === st.dealer && !["lobby"].includes(st.stage)) tags.push("deu as cartas");
      if (s.nick && !s.online) tags.push("offline");
      if (tags.length) seat.append(el("span", "tag", tags.join(" | ")));
      const bub = bubbles.get(i);
      if (bub && bub.until > Date.now()) seat.append(el("div", "bubble" + (bub.sig ? " sig" : ""), bub.text));
      felt.append(seat);
    });

    // cartas jogadas na rodada
    st.table.forEach((p, n) => {
      const pos = spot(p.seat, PLAY);
      const c = hopCard(card(p.card), n + 1);
      c.classList.add("tr-played");
      if (hopNow && n === st.table.length - 1) c.classList.add("new");
      c.style.left = pos.x + "%"; c.style.top = pos.y + "%";
      felt.append(c);
    });
    hopNow = false;
    if (keep) felt.append(keep);
  }

  function hopCard(c, i) {
    if (hopNow) { c.classList.add("hop"); c.style.setProperty("--i", i); }
    return c;
  }

  // Quem precisa agir agora e se sou eu (para o relogio)
  function whoActs() {
    if (!st) return { seats: [], mine: false };
    if (st.stage === "eleven") {
      const seats = st.seats.map((s, i) => i).filter((i) => st.seats[i].team === st.elevenTeam);
      return { seats, mine: st.myTeam === st.elevenTeam };
    }
    if (st.stage !== "playing") return { seats: [], mine: false };
    if (st.pending) {
      const t = 1 - st.pending.team;
      return { seats: st.seats.map((s, i) => i).filter((i) => st.seats[i].team === t), mine: st.myTeam === t };
    }
    return { seats: [st.toPlay], mine: st.toPlay === st.me };
  }

  // Relogio da jogada: numero, barra embaixo das acoes e barrinha no lugar de quem joga
  setInterval(() => {
    const bar = $("trTimebar");
    const acts = whoActs();
    if (!st || !open() || !acts.seats.length) { bar.hidden = true; return; }
    const left = Math.max(0, st.turnEndsAt - (Date.now() + clockSkew));
    const pct = Math.min(100, (left / st.turnMs) * 100) + "%";
    const secs = Math.ceil(left / 1000);
    const low = secs <= 5;
    bar.hidden = false;
    bar.firstChild.style.width = pct;
    bar.firstChild.classList.toggle("low", low);
    document.querySelectorAll("#trFelt .ttimer i").forEach((i) => { i.style.width = pct; i.style.background = low ? "var(--err)" : ""; });
    const clock = $("trClock");
    if (clock) { clock.textContent = secs + "s"; clock.classList.toggle("low", low); }
    if (acts.mine && low && secs > 0 && secs !== lastTick) { lastTick = secs; beep([[1200, 0.05]]); }
  }, 200);

  function renderHand() {
    const box = $("trHand");
    box.replaceChildren();
    box.classList.toggle("hide", hideNext && st.canHide);
    if (st.me < 0 || !st.hand.length) return;
    const myTurn = st.stage === "playing" && st.toPlay === st.me && !st.pending;
    st.hand.forEach((c, i) => {
      const b = card(c, { button: true });
      b.disabled = !myTurn;
      b.title = myTurn ? (hideNext && st.canHide ? "Jogar encoberta" : "Jogar esta carta") : "Espere sua vez";
      b.addEventListener("click", () => {
        socket.emit("truco:play", { index: i, hidden: hideNext && st.canHide }, done);
        hideNext = false;
      });
      box.append(b);
    });
  }

  function bigBtn(text, cls, fn) {
    const b = el("button", "big " + (cls || ""), text); b.type = "button"; b.addEventListener("click", fn); return b;
  }

  function renderActions() {
    const box = $("trActions");
    box.replaceChildren();
    if (whoActs().seats.length) { const c = el("span", "tr-clock"); c.id = "trClock"; box.append(c); }
    if (st.me < 0) {
      if (!["empty", "lobby"].includes(st.stage)) box.append(el("span", "msg", "assistindo"));
      return;
    }
    const nameOf = (i) => (st.seats[i] && st.seats[i].nick) || "lugar vazio";
    if (st.stage === "eleven") {
      if (st.elevenTeam === st.myTeam) {
        box.append(el("span", "msg", "MÃO DE ONZE: olhe as cartas do parceiro e decida"));
        box.append(bigBtn("JOGAR (vale 3)", "", () => socket.emit("truco:eleven", true, done)));
        box.append(bigBtn("CORRER (eles ganham 1)", "no", () => socket.emit("truco:eleven", false, done)));
      } else box.append(el("span", "msg", "mão de onze: esperando eles decidirem se jogam..."));
      return;
    }
    if (st.pending) {
      if (st.pending.team !== st.myTeam) {
        box.append(el("span", "msg", "PEDIRAM " + st.pending.name + "! (vale " + st.pending.to + ")"));
        box.append(bigBtn("DESCE!", "", () => socket.emit("truco:answer", "accept", done)));
        box.append(bigBtn("CORRO", "no", () => socket.emit("truco:answer", "run", done)));
        if (st.pending.canRaiseBack) box.append(bigBtn(nextName(st.pending.to) + "!", "truco", () => socket.emit("truco:answer", "raise", done)));
      } else box.append(el("span", "msg", "pediu " + st.pending.name + "... esperando eles responderem"));
      return;
    }
    if (st.stage === "playing") {
      if (st.toPlay === st.me) {
        box.append(el("span", "msg", "SUA VEZ"));
        if (st.canRaise) box.append(bigBtn(st.raiseName + "!", "truco", () => socket.emit("truco:raise", done)));
        if (st.canHide) {
          const h = el("button", "cmd" + (hideNext ? " on" : ""), hideNext ? "Encoberta: sim" : "Jogar encoberta");
          h.type = "button"; h.title = "A próxima carta vai virada para baixo (não ganha de ninguém)";
          h.addEventListener("click", () => { hideNext = !hideNext; render(); });
          box.append(h);
        }
      } else box.append(el("span", "msg", "vez de " + nameOf(st.toPlay)));
    } else if (st.stage === "handEnd" && st.lastHand) {
      const t = st.lastHand.team;
      box.append(el("span", "msg", t === null ? "ninguém pontuou" : teamLabel(t) + " +" + st.lastHand.points));
    }
  }
  const nextName = (v) => ({ 3: "SEIS", 6: "NOVE", 9: "DOZE" })[v];

  function renderFun() {
    const box = $("trFun");
    box.replaceChildren();
    if (st.me < 0 || ["empty", "lobby"].includes(st.stage)) return;
    const toggle = (name, label) => {
      const b = el("button", "cmd", label + (funOpen === name ? " ▴" : " ▾"));
      b.type = "button";
      b.addEventListener("click", () => { funOpen = funOpen === name ? null : name; renderFun(); });
      return b;
    };
    box.append(toggle("zoar", "Zoar"), toggle("sinal", "Sinal pro parceiro"));
    if (funOpen === "zoar") st.phrases.forEach((p, i) => {
      const b = el("button", "cmd", "\"" + p + "\""); b.type = "button";
      b.addEventListener("click", () => { socket.emit("truco:shout", i); funOpen = null; renderFun(); });
      box.append(b);
    });
    if (funOpen === "sinal") Object.entries(st.signals).forEach(([code, text]) => {
      const b = el("button", "cmd chip", text); b.type = "button";
      b.addEventListener("click", () => { socket.emit("truco:signal", code); funOpen = null; renderFun(); setNote("Sinal enviado: " + text); });
      box.append(b);
    });
  }

  function renderBar() {
    const bar = $("trBar");
    bar.replaceChildren();
    const cmd = (text, fn, cls) => { const b = el("button", "cmd" + (cls ? " " + cls : ""), text); b.type = "button"; b.addEventListener("click", fn); return b; };
    if (st.stage === "empty") {
      if (app.nick) bar.append(cmd("Criar mesa de 4", () => socket.emit("truco:create", 4, done)), cmd("Criar mesa de 6", () => socket.emit("truco:create", 6, done)));
    } else {
      if (st.isHost && st.stage === "lobby") {
        bar.append(cmd(st.size === 4 ? "Mesa de 4 ✓" : "Mesa de 4", () => socket.emit("truco:size", 4, done), st.size === 4 ? "on" : ""));
        bar.append(cmd(st.size === 6 ? "Mesa de 6 ✓" : "Mesa de 6", () => socket.emit("truco:size", 6, done), st.size === 6 ? "on" : ""));
        const full = st.seats.every((s) => s.nick);
        bar.append(cmd(full ? "Começar" : "Começar (falta gente)", () => socket.emit("truco:start", done), full ? "on" : ""));
      }
      if (st.isHost && st.stage === "gameOver") bar.append(cmd("Nova partida", () => socket.emit("truco:start", done), "on"));
      if (st.me >= 0) bar.append(cmd("Levantar", () => socket.emit("truco:stand", done)));
      else if (st.stage === "lobby") bar.append(el("span", "", "clique em Sentar: os times alternam (frente a frente e parceiro)"));
      if (st.isHost || st.isAdmin) bar.append(cmd("Encerrar mesa", () => socket.emit("truco:close", done)));
    }
    bar.append(el("span", "spacer"));
    const log = $("trLog");
    bar.append(cmd(log.hidden ? "Histórico" : "Esconder histórico", () => { log.hidden = !log.hidden; renderBar(); log.scrollTop = log.scrollHeight; }));
  }

  function done(r) { if (r && !r.ok) setNote("ERRO: " + r.error, true); }

  // ---------- gritos e efeitos ----------
  function shout(text, cls, sub) {
    const felt = $("trFelt");
    felt.querySelector(".tr-shout")?.remove();
    const s = el("div", "tr-shout " + (cls || ""), text);
    if (sub) s.append(el("small", "", sub));
    felt.append(s);
    felt.classList.remove("shake"); void felt.offsetWidth; felt.classList.add("shake");
    setTimeout(() => s.remove(), 1700);
  }

  function bubble(seat, text, sig) {
    bubbles.set(seat, { text, sig, until: Date.now() + 2800 });
    if (open()) renderFelt();
    setTimeout(() => { if (open()) renderFelt(); }, 2900);
  }

  socket.on("truco:event", (e) => {
    if (!st) return;
    const mine = st.myTeam !== null && e.team === st.myTeam;
    if (e.type === "phrase") { beep(SFX.phrase); if (e.seat >= 0) bubble(e.seat, e.text); return; }
    if (e.type === "raise") {
      beep(SFX.raise);
      if (open()) shout(e.text, "", (e.nick || "") + " pediu " + e.to);
      else if (st.me >= 0 && !mine) setNote("Truco: " + e.text + " Abra o truco (ícone de paus) para responder!", true);
      return;
    }
    if (e.type === "accept") { beep(SFX.accept); if (open()) shout(e.text, "ok", e.nick ? e.nick + " aceitou" : ""); return; }
    if (e.type === "run") { beep(SFX.run); if (open()) shout(e.text, "run", e.nick || ""); return; }
    if (e.type === "tie") { beep(SFX.tie); if (open()) shout(e.text, "", "empatou a rodada"); return; }
    if (e.type === "round") { beep(SFX.round); return; }
    if (e.type === "onze" || e.type === "ferro") { beep(SFX.raise); if (open()) shout(e.text); return; }
    if (e.type === "game") { beep(SFX.game); if (open()) shout(st.myTeam === null ? "FIM!" : mine ? "GANHAMOS!" : "PERDEMOS!", mine ? "ok" : "run"); return; }
  });

  socket.on("truco:signal", (s) => {
    if (s.text) { bubble(s.seat, "piscou: " + s.text, true); beep(SFX.phrase); }
    else bubble(s.seat, "*piscou*", false);
  });

  socket.on("truco:state", (s) => {
    const wasMyTurn = st && st.stage === "playing" && st.toPlay === st.me && !st.pending;
    // carta nova na mesa: todo mundo pula (e faz o barulhinho para todos)
    if (st && s.table.length > st.table.length) { hopNow = true; beep(SFX.card); }
    st = s;
    clockSkew = s.serverNow - Date.now();
    if (s.turnEndsAt !== lastEnds) { lastEnds = s.turnEndsAt; lastTick = -1; } // relogio novo
    const myTurn = s.stage === "playing" && s.toPlay === s.me && s.me >= 0 && !s.pending;
    if (myTurn && !wasMyTurn) { beep(SFX.turn); if (!open()) setNote("Truco: sua vez de jogar!"); }
    if (!s.canHide) hideNext = false;
    sidebar();
    if (open()) render(); else hopNow = false;
  });

  function sidebar() {
    const n = st.seats.filter((x) => x.nick).length;
    $("trTags").textContent = st.stage === "empty" ? "sem mesa" : st.stage === "lobby" ? n + "/" + st.size + " na sala" : n + " jogando";
    $("trOpen").classList.toggle("on", st.stage !== "empty");
    app.trucoNicks = new Set(st.seats.filter((x) => x.nick).map((x) => x.nick.toLowerCase()));
    app.renderPeople();
  }

  function show() {
    $("truco").hidden = false;
    $("activity").hidden = true; // um jogo aberto por vez
    document.body.classList.remove("drawer");
    render();
  }
  $("trucoBtn").addEventListener("click", () => (open() ? ($("truco").hidden = true) : show()));
  $("trOpen").addEventListener("click", show);
  $("trClose").addEventListener("click", () => { $("truco").hidden = true; });
  const soundIcon = () => setIcon($("trSound"), sound ? "volume" : "volume-off", sound ? "Desligar os sons" : "Ligar os sons");
  soundIcon();
  $("trSound").addEventListener("click", () => {
    sound = !sound; store.set("chatpedro-trucosom", sound ? "on" : "off");
    soundIcon();
    if (sound) beep(SFX.accept);
  });
  window.addEventListener("resize", () => { if (open()) render(); });

  const prevJoin = app.onJoin;
  app.onJoin = () => { prevJoin(); $("trucoBtn").hidden = false; if (open()) render(); };
})();

// Mesa de poker (lado do navegador): so desenha o que o servidor manda e envia as acoes.
(() => {
  const $ = (id) => document.getElementById(id);
  const app = window.ChatPedro;
  const { socket, avatar, setNote } = app;
  const SUIT = { s: "♠", h: "♥", d: "♦", c: "♣" };
  let st = null;          // estado mais recente
  let clockSkew = 0;      // diferenca entre o relogio do servidor e o daqui
  let raiseTo = 0;
  let lastTurnKey = "";

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function card(code, extra) {
    if (!code) return el("div", "card slot");
    if (code === "??") return el("div", "card back");
    const c = el("div", "card" + (code[1] === "h" || code[1] === "d" ? " red" : "") + (extra ? " " + extra : ""));
    c.append(el("span", "r", code[0] === "T" ? "10" : code[0]), el("span", "s", SUIT[code[1]]));
    c.setAttribute("aria-label", code);
    return c;
  }

  // Posicoes ao redor da mesa; o seu lugar fica sempre embaixo, no meio (como no PokerStars)
  function spot(seat, rx, ry) {
    const base = st.mySeat >= 0 ? st.mySeat : 0;
    const k = (seat - base + 9) % 9;
    const a = (90 + k * 40) * Math.PI / 180; // sentido horario na tela
    return { x: 50 + rx * Math.cos(a), y: 50 + ry * Math.sin(a) };
  }

  function render() {
    if (!st) return;
    const felt = $("felt");
    felt.replaceChildren();
    const narrow = felt.clientWidth < 520;
    const [SRX, SRY] = narrow ? [37, 43] : [41, 41];
    const [BRX, BRY] = narrow ? [24, 28] : [29, 26];
    const winningCards = new Set();
    for (const s of st.seats) if (s && s.best && st.result && st.result.winners.some((w) => w.nick === s.nick)) s.best.forEach((c) => winningCards.add(c));

    // centro: mesa, pote e resultado
    const center = el("div", "center");
    const board = el("div", "board");
    for (let i = 0; i < 5; i++) {
      const code = st.board[i];
      board.append(card(code, code && winningCards.size ? (winningCards.has(code) ? "win" : "dim") : ""));
    }
    const pending = st.seats.reduce((n, s) => n + (s ? s.bet : 0), 0);
    center.append(board);
    if (st.pot || pending) center.append(el("div", "pot", "POTE: " + (st.pot + pending)));
    if (st.result) center.append(el("div", "banner", st.result.winners.map((w) => w.nick + " ganha " + w.amount + (w.hand ? " - " + w.hand : "")).join(" | ")));
    else if (st.stage === "waiting") {
      const sitting = st.seats.filter(Boolean).length;
      center.append(el("div", "banner", sitting < 2 ? "Esperando jogadores (minimo 2)" : "Proxima mao comecando..."));
    }
    felt.append(center);

    // lugares
    for (let i = 0; i < 9; i++) {
      const s = st.seats[i];
      const pos = spot(i, SRX, SRY);
      const seat = el("div", "seat");
      seat.style.left = pos.x + "%"; seat.style.top = pos.y + "%";
      if (!s) {
        seat.classList.add("empty");
        if (st.mySeat < 0 && app.nick && !st.myRequest) {
          const ask = st.locked && !st.isOwner;
          const b = el("button", "", ask ? "[PEDIR]" : "[SENTAR]");
          b.type = "button";
          b.title = ask ? "A mesa esta trancada: o dono precisa aceitar" : "Sentar neste lugar";
          b.addEventListener("click", () => socket.emit("poker:sit", i, (r) => {
            if (r && r.pending) setNote("Pedido enviado. Esperando " + (st.ownerNick || "o dono") + " aceitar.");
            else if (r && !r.ok) setNote("ERRO: " + r.error, true);
          }));
          seat.append(b);
        } else seat.append(el("span", "", "vazio"));
        felt.append(seat);
        continue;
      }
      if (s.folded) seat.classList.add("folded");
      if (s.sittingOut) seat.classList.add("out");
      if (st.toAct === i) seat.classList.add("turn");
      const cards = el("div", "cards");
      for (const c of s.cards) cards.append(card(c, s.best && winningCards.size ? (winningCards.has(c) ? "win" : "dim") : ""));
      seat.append(cards);
      const box = el("div", "box");
      const info = el("div", "info");
      const nm = el("div", "nm", s.nick + (i === st.mySeat ? " (voce)" : ""));
      if (s.owner) { const c = el("span", "crown", " \u2605"); c.title = "Dono da mesa"; nm.prepend(c); }
      info.append(nm, el("div", "ch", s.allIn && s.chips === 0 ? "ALL-IN" : s.chips + ""));
      box.append(avatar(s.nick), info);
      seat.append(box);
      if (st.toAct === i) { const tm = el("div", "timer"); tm.append(el("i")); seat.append(tm); }
      if (s.lastAction) seat.append(el("div", "act", s.lastAction));
      felt.append(seat);

      if (s.bet > 0) {
        const bp = spot(i, BRX, BRY);
        const chip = el("div", "chipbet", s.bet + "");
        chip.style.left = bp.x + "%"; chip.style.top = bp.y + "%";
        felt.append(chip);
      }
      if (st.button === i && st.stage !== "waiting") {
        const d = el("div", "dealer", "D"); // botao do dealer, um pouco ao lado da aposta
        const a = (90 + ((i - (st.mySeat >= 0 ? st.mySeat : 0) + 9) % 9) * 40 + 16) * Math.PI / 180;
        d.style.left = (50 + (BRX + 4) * Math.cos(a)) + "%"; d.style.top = (50 + (BRY + 4) * Math.sin(a)) + "%";
        felt.append(d);
      }
    }
    renderActions();
    renderBar();
    const log = $("dealerlog");
    log.replaceChildren(...st.log.map((l) => el("div", "", l)));
    log.scrollTop = log.scrollHeight;
  }

  function renderActions() {
    const box = $("actions");
    const me = st.me;
    if (!me) { box.hidden = true; box.replaceChildren(); return; }
    const turnKey = st.handNo + ":" + st.stage + ":" + me.currentBet;
    if (turnKey !== lastTurnKey) { raiseTo = me.minTo; lastTurnKey = turnKey; }
    else if (box.contains(document.activeElement) && !box.hidden) return; // nao redesenha enquanto a pessoa mexe
    box.hidden = false;
    box.replaceChildren();
    const btn = (cls, text, fn, disabled) => {
      const b = el("button", "big " + cls, text); b.type = "button"; b.disabled = !!disabled;
      b.addEventListener("click", fn); return b;
    };
    const send = (action, amount) => socket.emit("poker:act", { action, amount }, (r) => {
      if (r && !r.ok) setNote("ERRO: " + r.error, true);
    });
    box.append(btn("fold", "DESISTIR", () => send("fold")));
    if (me.canCheck) box.append(btn("", "PASSAR", () => send("check")));
    else box.append(btn("", (me.callAllIn ? "ALL-IN " : "PAGAR ") + me.toCall, () => send("call")));
    if (me.canRaise) {
      const opening = me.currentBet === 0;
      const label = () => (raiseTo >= me.maxTo ? "ALL-IN " + me.maxTo : (opening ? "APOSTAR " : "AUMENTAR PARA ") + raiseTo);
      const main = btn("", label(), () => send("raise", raiseTo));
      const sizing = el("div", "sizing");
      const range = el("input"); range.type = "range"; range.min = me.minTo; range.max = me.maxTo; range.step = 1; range.value = raiseTo;
      range.setAttribute("aria-label", "Valor da aposta");
      const num = el("input"); num.type = "number"; num.min = me.minTo; num.max = me.maxTo; num.value = raiseTo;
      num.setAttribute("aria-label", "Valor da aposta");
      const set = (v) => {
        raiseTo = Math.max(me.minTo, Math.min(me.maxTo, Math.round(Number(v) || me.minTo)));
        range.value = raiseTo; num.value = raiseTo; main.textContent = label();
      };
      range.addEventListener("input", () => set(range.value));
      num.addEventListener("change", () => set(num.value));
      const preset = (text, v) => { const b = el("button", "cmd", text); b.type = "button"; b.addEventListener("click", () => set(v)); return b; };
      const pot = me.potAfterCall;
      sizing.append(
        preset("[MIN]", me.minTo),
        preset("[1/2 POTE]", me.currentBet + Math.floor(pot / 2)),
        preset("[POTE]", me.currentBet + pot),
        preset("[ALL-IN]", me.maxTo),
        range, num,
      );
      if (me.minTo >= me.maxTo) sizing.hidden = true;
      box.append(main, sizing);
    }
  }

  function renderBar() {
    $("actInfo").textContent = "blinds " + st.blinds.join("/") + (st.handNo ? "  mao " + st.handNo : "") + (st.locked ? "  trancada" : "");
    const bar = $("tablebar");
    bar.replaceChildren();
    const me = st.mySeat >= 0 ? st.seats[st.mySeat] : null;
    const cmd = (text, fn, cls) => { const b = el("button", "cmd" + (cls ? " " + cls : ""), text); b.type = "button"; b.addEventListener("click", fn); return b; };
    const done = (r) => {
      if (r && r.pending) setNote("Pedido enviado. Esperando " + (st.ownerNick || "o dono") + " aceitar.");
      else if (r && !r.ok) setNote("ERRO: " + r.error, true);
    };

    if (st.myRequest) {
      bar.append(el("span", "", "esperando " + (st.ownerNick || "o dono") + (st.myRequest === "rebuy" ? " liberar a recompra" : " aceitar voce")));
      bar.append(cmd("[CANCELAR]", () => socket.emit("poker:cancel")));
    } else if (!me) {
      bar.append(el("span", "", !app.nick ? "escolha um apelido para jogar"
        : st.locked && !st.isOwner ? "mesa trancada: clique em [PEDIR] num lugar" : "clique em [SENTAR] num lugar vazio"));
    } else {
      if (me.chips < st.blinds[1] && !(me.inHand && st.stage !== "waiting")) {
        bar.append(cmd(st.locked && !st.isOwner ? "[PEDIR RECOMPRA]" : "[RECOMPRAR " + st.startChips + "]", () => socket.emit("poker:rebuy", done)));
      }
      bar.append(me.sittingOut
        ? cmd("[VOLTAR]", () => socket.emit("poker:away", false, done), "on")
        : cmd("[AUSENTE]", () => socket.emit("poker:away", true, done)));
      bar.append(cmd(me.leaving ? "[SAINDO...]" : "[LEVANTAR]", () => socket.emit("poker:stand", done)));
    }
    bar.append(el("span", "spacer"));
    if (st.isOwner) {
      bar.append(cmd(st.locked ? "[DESTRANCAR MESA]" : "[TRANCAR MESA]", () => socket.emit("poker:lock", !st.locked), st.locked ? "on" : ""));
    }
    const log = $("dealerlog");
    bar.append(cmd(log.hidden ? "[HISTORICO]" : "[ESCONDER HISTORICO]", () => { log.hidden = !log.hidden; renderBar(); log.scrollTop = log.scrollHeight; }));
  }

  // Convites para o dono: aparecem em qualquer tela, mesmo com o poker fechado
  function renderInvites() {
    const box = $("invites");
    const reqs = st && st.isOwner ? st.requests : [];
    box.replaceChildren(...reqs.map((r) => {
      const card = el("div", "invite");
      const tx = el("div", "t", r.nick + (r.type === "rebuy" ? " quer recomprar " + st.startChips + " fichas" : " quer entrar na mesa"));
      tx.append(el("small", "", "a mesa de poker esta trancada"));
      const row = el("div", "row");
      const yes = el("button", "cmd", "[ACEITAR]"); yes.type = "button";
      const no = el("button", "cmd danger", "[RECUSAR]"); no.type = "button";
      yes.addEventListener("click", () => socket.emit("poker:answer", { key: r.key, accept: true }));
      no.addEventListener("click", () => socket.emit("poker:answer", { key: r.key, accept: false }));
      row.append(yes, no);
      card.append(tx, row);
      return card;
    }));
  }

  // barra de tempo de quem esta jogando
  setInterval(() => {
    if (!st || st.toAct < 0 || $("activity").hidden) return;
    const left = st.turnEndsAt - (Date.now() + clockSkew);
    const bar = document.querySelector(".seat.turn .timer i");
    if (bar) bar.style.width = Math.max(0, Math.min(100, (left / st.turnMs) * 100)) + "%";
  }, 200);

  function sidebar() {
    const players = st ? st.seats.filter(Boolean) : [];
    $("actTags").textContent = players.length ? players.length + " jogando" + (st.locked ? ", trancada" : "") : "mesa vazia";
    app.pokerNicks = new Set(players.map((p) => p.nick.toLowerCase()));
    app.renderPeople();
  }

  socket.on("poker:state", (s) => {
    const wasMyTurn = st && st.me;
    st = s;
    clockSkew = s.serverNow - Date.now();
    sidebar();
    renderInvites();
    if (!$("activity").hidden) render();
    if (s.me && !wasMyTurn && $("activity").hidden) setNote("[POKER] Sua vez de jogar! Clique em [POKER] la em cima.");
  });

  function open() {
    $("activity").hidden = false;
    document.body.classList.remove("drawer");
    render();
  }
  $("pokerBtn").addEventListener("click", () => ($("activity").hidden ? open() : ($("activity").hidden = true)));
  $("actOpen").addEventListener("click", open);
  $("actClose").addEventListener("click", () => { $("activity").hidden = true; });
  window.addEventListener("resize", () => { if (!$("activity").hidden) render(); });

  const prevJoin = app.onJoin;
  app.onJoin = () => { prevJoin(); $("pokerBtn").hidden = false; if (!$("activity").hidden) render(); };
})();

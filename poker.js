// Mesa de Texas Hold'em No-Limit (regras padrao PokerStars / TDA).
// O servidor e a unica fonte da verdade: embaralha, distribui, valida apostas e paga os potes.
// Cada pessoa so recebe as proprias cartas; as dos outros so aparecem no showdown.
const crypto = require("crypto");

const SEATS = 9;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const START_CHIPS = 1000;
let TURN_MS = 30000;           // tempo para agir
let AWAY_TURN_MS = 8000;       // tempo para quem caiu da conexao
let NEXT_HAND_MS = 6000;       // pausa mostrando o resultado
let RUNOUT_MS = 1200;          // pausa entre cartas quando todos estao all-in
const LOG_SIZE = 12;

const RANKS = "23456789TJQKA";
const SUITS = "shdc"; // espadas, copas, ouros, paus
const RANK_NAME = { 14: "As", 13: "Rei", 12: "Dama", 11: "Valete", 10: "10", 9: "9", 8: "8", 7: "7", 6: "6", 5: "5", 4: "4", 3: "3", 2: "2" };
const RANK_PLURAL = { 14: "Ases", 13: "Reis", 12: "Damas", 11: "Valetes", 10: "10s", 9: "9s", 8: "8s", 7: "7s", 6: "6s", 5: "5s", 4: "4s", 3: "3s", 2: "2s" };

// ---------- cartas e avaliacao de maos ----------
const rankOf = (c) => RANKS.indexOf(c[0]) + 2;

function newDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) { // Fisher-Yates com aleatorio criptografico
    const j = crypto.randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Avalia 5 cartas -> [categoria, desempates...]; maior e melhor.
function eval5(cards) {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);
  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks.join() === "14,5,4,3,2") straightHigh = 5; // A-2-3-4-5 (roda)
  }
  const count = {};
  for (const r of ranks) count[r] = (count[r] || 0) + 1;
  const groups = Object.entries(count).map(([r, n]) => [n, Number(r)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const byGroup = groups.map((g) => g[1]);
  if (straightHigh && flush) return [8, straightHigh];
  if (groups[0][0] === 4) return [7, ...byGroup];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, ...byGroup];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][0] === 3) return [3, ...byGroup];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, ...byGroup];
  if (groups[0][0] === 2) return [1, ...byGroup];
  return [0, ...ranks];
}

function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Melhor mao de 5 entre 7 cartas
function bestHand(cards) {
  let best = null, bestCards = null;
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
    for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
      const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
      const v = eval5(five);
      if (!best || compare(v, best) > 0) { best = v; bestCards = five; }
    }
  return { value: best, cards: bestCards, name: handName(best) };
}

function handName(v) {
  const [cat, a, b] = v;
  switch (cat) {
    case 8: return a === 14 ? "Royal Flush" : "Straight Flush, " + RANK_NAME[a] + " alto";
    case 7: return "Quadra de " + RANK_PLURAL[a];
    case 6: return "Full House, " + RANK_PLURAL[a] + " com " + RANK_PLURAL[b];
    case 5: return "Flush, " + RANK_NAME[a] + " alto";
    case 4: return "Sequencia, " + RANK_NAME[a] + " alto";
    case 3: return "Trinca de " + RANK_PLURAL[a];
    case 2: return "Dois Pares, " + RANK_PLURAL[a] + " e " + RANK_PLURAL[b];
    case 1: return "Par de " + RANK_PLURAL[a];
    default: return "Carta Alta, " + RANK_NAME[a];
  }
}

// ---------- mesa ----------
function createPoker(io, helpers, timing) {
  if (timing) ({ TURN_MS = TURN_MS, AWAY_TURN_MS = AWAY_TURN_MS, NEXT_HAND_MS = NEXT_HAND_MS, RUNOUT_MS = RUNOUT_MS } = timing); // usado nos testes
  // nickOf(socket.id) -> apelido; isAdmin(socket.id) -> entrou com a senha de ADM
  const { nickOf, isAdmin } = helpers;
  const adminKeys = () => new Set([...io.sockets.sockets.values()].filter((x) => isAdmin(x.id)).map((x) => (nickOf(x.id) || "").toLowerCase()));
  const bank = new Map(); // apelido(minusculo) -> fichas guardadas quando a pessoa levanta (0 = perdeu tudo)

  const t = {
    seats: Array(SEATS).fill(null),
    button: -1,
    stage: "waiting", // waiting | preflop | flop | turn | river | showdown
    board: [],
    deck: [],
    toAct: -1,
    currentBet: 0,
    minRaise: BIG_BLIND,
    turnEndsAt: 0,
    handNo: 0,
    result: null,
    log: [],
    sb: -1, bb: -1,
    // So o ADM manda na mesa. Trancada: ninguem novo senta sem o ADM aceitar.
    // Recomprar (ou voltar depois de perder tudo) sempre precisa do aceite do ADM.
    locked: false,
    requests: new Map(), // apelido(minusculo) -> { nick, type: "sit" | "rebuy", seat }
  };
  let timer = null;

  const keyOf = (nick) => nick.toLowerCase();
  const seatOfKey = (key) => t.seats.findIndex((p) => p && p.key === key);
  const inHand = (p) => p && p.inHand && !p.folded;
  const canAct = (p) => inHand(p) && !p.allIn;
  const say = (text) => { t.log.push(text); if (t.log.length > LOG_SIZE) t.log.shift(); };
  const isOnline = (key) => [...io.sockets.sockets.values()].some((s) => (nickOf(s.id) || "").toLowerCase() === key);

  function nextSeat(from, pred) {
    for (let i = 1; i <= SEATS; i++) {
      const s = (from + i + SEATS) % SEATS;
      if (pred(t.seats[s], s)) return s;
    }
    return -1;
  }

  const eligible = (p) => p && !p.sittingOut && !p.leaving && p.chips > 0 && isOnline(p.key);

  function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }

  // ---------- inicio da mao ----------
  function maybeStart() {
    if (t.stage !== "waiting") return;
    const ready = t.seats.filter(eligible);
    if (ready.length < 2) { broadcast(); return; }
    clearTimer();
    timer = setTimeout(startHand, Math.min(1500, NEXT_HAND_MS));
    broadcast();
  }

  function startHand() {
    clearTimer();
    const ready = t.seats.filter(eligible);
    if (ready.length < 2) { t.stage = "waiting"; broadcast(); return; }
    t.handNo++;
    t.deck = newDeck();
    t.board = [];
    t.result = null;
    for (const p of t.seats) if (p) Object.assign(p, {
      inHand: eligible(p), folded: false, allIn: false, bet: 0, total: 0, hole: [], acted: false, raiseLocked: false, lastAction: "", shown: false,
    });

    t.button = nextSeat(t.button, (p) => p && p.inHand);
    const headsUp = ready.length === 2;
    // Mano a mano: o botao paga o small blind e age primeiro no pre-flop
    t.sb = headsUp ? t.button : nextSeat(t.button, (p) => p && p.inHand);
    t.bb = nextSeat(t.sb, (p) => p && p.inHand);
    say("--- Mao #" + t.handNo + " ---");
    post(t.sb, SMALL_BLIND, "small blind");
    post(t.bb, BIG_BLIND, "big blind");
    t.currentBet = BIG_BLIND;
    t.minRaise = BIG_BLIND;

    // Duas cartas para cada um, comecando a esquerda do botao
    for (let round = 0; round < 2; round++) {
      let s = t.button;
      for (let i = 0; i < ready.length; i++) {
        s = nextSeat(s, (p) => p && p.inHand);
        t.seats[s].hole.push(t.deck.pop());
      }
    }
    t.stage = "preflop";
    const first = nextSeat(t.bb, canAct);
    if (first === -1 || !needsAction()) return endBettingRound();
    setTurn(first);
  }

  function post(seat, amount, label) {
    const p = t.seats[seat];
    const amt = Math.min(amount, p.chips);
    p.chips -= amt; p.bet += amt; p.total += amt;
    if (p.chips === 0) p.allIn = true;
    p.lastAction = (label === "small blind" ? "SB " : "BB ") + amt;
    say(p.nick + " paga " + label + " (" + amt + ")");
  }

  // ---------- vez de jogar ----------
  function setTurn(seat) {
    clearTimer();
    t.toAct = seat;
    const p = t.seats[seat];
    const fast = p.leaving || p.sittingOut || !isOnline(p.key);
    const ms = p.leaving ? 300 : fast ? AWAY_TURN_MS : TURN_MS;
    t.turnEndsAt = Date.now() + ms;
    timer = setTimeout(() => timeout(seat), ms);
    broadcast();
  }

  function timeout(seat) {
    const p = t.seats[seat];
    if (!p || t.toAct !== seat) return;
    const check = p.bet === t.currentBet;
    if (!p.leaving && !check) { p.sittingOut = true; say(p.nick + " demorou demais e ficou ausente"); }
    act(seat, check ? "check" : "fold", 0, true);
  }

  function needsAction() {
    const active = t.seats.filter(canAct);
    if (active.length === 0) return false;
    // so uma pessoa pode agir e ela ja cobriu a aposta: nao ha mais nada a decidir
    if (active.length === 1 && active[0].bet >= t.currentBet && t.seats.filter(inHand).length > 1) return false;
    return active.some((p) => !p.acted || p.bet < t.currentBet);
  }

  // action: fold | check | call | raise (amount = valor total "aumentar para")
  function act(seat, action, amount, auto) {
    const p = t.seats[seat];
    if (!p || t.toAct !== seat || !canAct(p)) return "Nao e sua vez.";
    const toCall = t.currentBet - p.bet;

    if (action === "fold") {
      p.folded = true; p.lastAction = "FOLD";
      say(p.nick + " desiste");
    } else if (action === "check") {
      if (toCall > 0) return "Nao da para passar: tem aposta de " + toCall + ".";
      p.lastAction = "CHECK";
      say(p.nick + " passa");
    } else if (action === "call") {
      if (toCall <= 0) return "Nada para pagar.";
      const amt = Math.min(toCall, p.chips);
      p.chips -= amt; p.bet += amt; p.total += amt;
      if (p.chips === 0) p.allIn = true;
      p.lastAction = p.allIn ? "ALL-IN " + p.bet : "CALL " + amt;
      say(p.nick + " paga " + amt + (p.allIn ? " e esta all-in" : ""));
    } else if (action === "raise") {
      const maxTo = p.bet + p.chips;
      let to = Math.floor(Number(amount));
      if (!Number.isFinite(to)) return "Valor invalido.";
      if (p.raiseLocked) return "Voce ja agiu e o all-in curto nao reabre as apostas: so pagar ou desistir.";
      if (maxTo <= t.currentBet) return "Voce nao tem fichas para aumentar.";
      const minTo = t.currentBet + t.minRaise;
      if (to > maxTo) to = maxTo;
      if (to < minTo && to !== maxTo) return "O minimo e " + minTo + ".";
      const raiseBy = to - t.currentBet;
      const opening = t.currentBet === 0;
      const amt = to - p.bet;
      p.chips -= amt; p.bet = to; p.total += amt;
      if (p.chips === 0) p.allIn = true;
      const full = raiseBy >= t.minRaise;
      for (const o of t.seats) {
        if (!o || o === p || !canAct(o)) continue;
        if (full) { o.acted = false; o.raiseLocked = false; }
        else if (o.acted) { o.acted = false; o.raiseLocked = true; } // aumento incompleto nao reabre para quem ja agiu
      }
      if (full) t.minRaise = raiseBy;
      t.currentBet = to;
      p.lastAction = p.allIn ? "ALL-IN " + to : (opening ? "BET " : "RAISE ") + to;
      say(p.nick + (opening ? " aposta " : " aumenta para ") + to + (p.allIn ? " (all-in)" : ""));
    } else return "Acao invalida.";

    p.acted = true;
    p.raiseLocked = false;
    clearTimer();

    if (t.seats.filter(inHand).length === 1) return winByFold();
    if (!needsAction()) return endBettingRound();
    const next = nextSeat(seat, (o) => canAct(o) && (!o.acted || o.bet < t.currentBet));
    if (next === -1) return endBettingRound();
    setTurn(next);
    return null;
  }

  // ---------- ruas ----------
  function collectBets() {
    for (const p of t.seats) if (p) { p.bet = 0; p.acted = false; p.raiseLocked = false; }
    t.currentBet = 0;
    t.minRaise = BIG_BLIND;
  }

  function endBettingRound() {
    clearTimer();
    t.toAct = -1;
    collectBets();
    if (t.stage === "river") return showdown();
    dealNext();
    for (const p of t.seats) if (p && canAct(p)) p.lastAction = "";
    if (needsAction()) {
      const first = nextSeat(t.button, canAct);
      setTurn(first);
    } else {
      // todos (ou todos menos um) all-in: abre as cartas que faltam com pausa
      broadcast();
      timer = setTimeout(endBettingRound, RUNOUT_MS);
    }
  }

  function dealNext() {
    t.deck.pop(); // carta queimada
    if (t.stage === "preflop") { t.board.push(t.deck.pop(), t.deck.pop(), t.deck.pop()); t.stage = "flop"; }
    else if (t.stage === "flop") { t.board.push(t.deck.pop()); t.stage = "turn"; }
    else if (t.stage === "turn") { t.board.push(t.deck.pop()); t.stage = "river"; }
    say("Mesa: " + t.board.join(" "));
  }

  // Monta o pote principal e os side pots a partir do que cada um colocou
  function buildPots() {
    const contributors = t.seats.filter((p) => p && p.inHand);
    const live = contributors.filter((p) => !p.folded);
    const levels = [...new Set(live.map((p) => p.total))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    levels.forEach((level, i) => {
      const cap = i === levels.length - 1 ? Infinity : level;
      let amount = 0;
      for (const p of contributors) amount += Math.max(0, Math.min(p.total, cap) - prev);
      const players = live.filter((p) => p.total >= level);
      if (amount > 0) pots.push({ amount, players });
      prev = level;
    });
    return pots;
  }

  function payPot(pot, winners) {
    // ficha impar vai para o primeiro ganhador a esquerda do botao
    const order = [];
    let s = t.button;
    for (let i = 0; i < SEATS; i++) { s = nextSeat(s, () => true); if (winners.includes(t.seats[s])) order.push(t.seats[s]); }
    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    const paid = new Map();
    for (const w of order) {
      const amt = share + (odd > 0 ? 1 : 0);
      if (odd > 0) odd--;
      w.chips += amt;
      paid.set(w, amt);
    }
    return paid;
  }

  function winByFold() {
    clearTimer();
    t.toAct = -1;
    const winner = t.seats.find(inHand);
    const pot = t.seats.reduce((n, p) => n + (p && p.inHand ? p.total : 0), 0);
    winner.chips += pot;
    t.result = { winners: [{ nick: winner.nick, amount: pot, hand: "" }] };
    say(winner.nick + " ganha " + pot + " (todos desistiram)");
    finishHand();
  }

  function showdown() {
    clearTimer();
    t.toAct = -1;
    t.stage = "showdown";
    const live = t.seats.filter(inHand);
    for (const p of live) { p.best = bestHand([...p.hole, ...t.board]); p.shown = true; p.lastAction = p.best.name; }
    const totals = new Map();
    const pots = buildPots();
    pots.forEach((pot, i) => {
      let best = null, winners = [];
      for (const p of pot.players) {
        const c = best ? compare(p.best.value, best) : 1;
        if (c > 0) { best = p.best.value; winners = [p]; } else if (c === 0) winners.push(p);
      }
      const paid = payPot(pot, winners);
      // pote com uma pessoa so e aposta nao paga que volta: nao conta como premio
      if (pot.players.length > 1) for (const [w, amt] of paid) totals.set(w, (totals.get(w) || 0) + amt);
      const label = pots.length > 1 ? (i === 0 ? "pote principal" : "side pot " + i) : "pote";
      if (pot.players.length === 1) say(winners[0].nick + " recebe de volta " + pot.amount + " nao pago");
      else say(winners.map((w) => w.nick).join(" e ") + " ganha" + (winners.length > 1 ? "m" : "") + " o " + label + " (" + pot.amount + ") com " + winners[0].best.name);
    });
    t.result = { winners: [...totals].map(([w, amt]) => ({ nick: w.nick, amount: amt, hand: w.best.name })), losers: [] };
    // All-in pago: quem foi ate o fim e nao levou nada "se fodeu"
    if (live.some((p) => p.allIn)) t.result.losers = live.filter((p) => !totals.has(p)).map((p) => p.nick);
    finishHand();
  }

  function finishHand() {
    t.stage = "showdown";
    for (const p of t.seats) if (p) p.bet = 0;
    const busted = t.seats.filter((p) => p && p.inHand && p.chips === 0);
    for (const p of busted) say(p.nick + " ficou sem fichas. Clique em RECOMPRAR para voltar.");
    broadcast();
    timer = setTimeout(() => {
      timer = null;
      for (let s = 0; s < SEATS; s++) {
        const p = t.seats[s];
        if (p && (p.leaving || !isOnline(p.key))) { bank.set(p.key, p.chips); t.seats[s] = null; }
      }
      for (const p of t.seats) if (p) { p.inHand = false; p.hole = []; p.lastAction = ""; p.shown = false; p.best = null; p.total = 0; p.bet = 0; }
      t.stage = "waiting";
      t.board = [];
      t.result = null;
      maybeStart();
    }, NEXT_HAND_MS);
  }

  // ---------- visao de cada pessoa ----------
  function viewFor(socketId) {
    const nick = nickOf(socketId);
    const key = nick ? keyOf(nick) : null;
    const mySeat = key ? seatOfKey(key) : -1;
    const me = mySeat >= 0 ? t.seats[mySeat] : null;
    const collected = t.seats.reduce((n, p) => n + (p ? p.total - p.bet : 0), 0);
    const admins = adminKeys();
    const amAdmin = isAdmin(socketId);
    const view = {
      seats: t.seats.map((p, i) => p && {
        seat: i, nick: p.nick, chips: p.chips, bet: p.bet, folded: p.folded, allIn: p.allIn, inHand: p.inHand,
        sittingOut: p.sittingOut, leaving: p.leaving, lastAction: p.lastAction,
        cards: p.inHand ? (p.key === key || p.shown ? p.hole : p.folded ? [] : ["??", "??"]) : [],
        best: p.shown && p.best ? p.best.cards : null, admin: admins.has(p.key),
      }),
      board: t.board, stage: t.stage, button: t.button, sb: t.sb, bb: t.bb, toAct: t.toAct, turnEndsAt: t.turnEndsAt,
      turnMs: TURN_MS, pot: collected, handNo: t.handNo, result: t.result, log: t.log,
      blinds: [SMALL_BLIND, BIG_BLIND], startChips: START_CHIPS, mySeat, serverNow: Date.now(),
      locked: t.locked, isAdmin: amAdmin, adminOnline: admins.size > 0,
      busted: !!key && bank.get(key) === 0 && mySeat < 0,
      myRequest: key && t.requests.has(key) ? t.requests.get(key).type : null,
      requests: amAdmin ? [...t.requests].map(([k, r]) => ({ key: k, nick: r.nick, type: r.type })) : [],
    };
    if (me && t.toAct === mySeat) {
      const toCall = Math.min(t.currentBet - me.bet, me.chips);
      const maxTo = me.bet + me.chips;
      view.me = {
        toCall, canCheck: toCall === 0, callAllIn: toCall > 0 && toCall >= me.chips,
        canRaise: !me.raiseLocked && maxTo > t.currentBet,
        minTo: Math.min(t.currentBet + t.minRaise, maxTo), maxTo,
        currentBet: t.currentBet, potAfterCall: collected + t.seats.reduce((n, p) => n + (p ? p.bet : 0), 0) + toCall,
      };
    }
    return view;
  }

  function broadcast() {
    for (const s of io.sockets.sockets.values()) s.emit("poker:state", viewFor(s.id));
  }

  // ---------- comandos dos jogadores ----------
  function handle(socket) {
    const nickNow = () => nickOf(socket.id);
    const reply = (cb, err) => typeof cb === "function" && cb(err ? { ok: false, error: err } : { ok: true });

    socket.emit("poker:state", viewFor(socket.id));

    socket.on("poker:sit", (seat, cb) => {
      const nick = nickNow();
      if (!nick) return reply(cb, "Escolha um apelido primeiro.");
      const key = keyOf(nick);
      seat = Number(seat);
      if (!(seat >= 0 && seat < SEATS) || t.seats[seat]) return reply(cb, "Lugar ocupado.");
      const already = seatOfKey(key);
      if (already >= 0) {
        if (t.seats[already].inHand) return reply(cb, "Espere a mao acabar para trocar de lugar.");
        t.seats[seat] = t.seats[already]; t.seats[already] = null;
        reply(cb); broadcast(); return;
      }
      const lost = bank.get(key) === 0; // perdeu tudo e saiu: voltar e uma recompra
      if (!isAdmin(socket.id) && (t.locked || lost)) {
        t.requests.set(key, { nick, type: lost ? "rebuy" : "sit", seat });
        say(nick + (lost ? " pediu para voltar com fichas novas" : " pediu para entrar"));
        if (typeof cb === "function") cb({ ok: false, pending: true });
        broadcast(); return;
      }
      reply(cb);
      doSit(key, nick, seat);
    });

    socket.on("poker:cancel", () => {
      const nick = nickNow(); if (!nick) return;
      if (t.requests.delete(keyOf(nick))) broadcast();
    });

    socket.on("poker:lock", (locked) => {
      if (!isAdmin(socket.id)) return;
      t.locked = !!locked;
      say(t.locked ? "O ADM trancou a mesa" : "O ADM abriu a mesa");
      // abrir a mesa aceita quem so queria sentar; recompras continuam esperando o ADM
      if (!t.locked) for (const [k, r] of [...t.requests]) if (r.type === "sit") approve(k);
      broadcast();
    });

    socket.on("poker:answer", (msg) => {
      if (!isAdmin(socket.id) || !msg) return;
      const req = t.requests.get(String(msg.key));
      if (!req) return;
      if (msg.accept) approve(String(msg.key));
      else { t.requests.delete(String(msg.key)); say(req.nick + " nao foi aceito"); }
      broadcast();
    });

    socket.on("poker:stand", (cb) => {
      const nick = nickNow(); if (!nick) return reply(cb);
      const s = seatOfKey(keyOf(nick)); if (s < 0) return reply(cb);
      const p = t.seats[s];
      if (p.inHand && t.stage !== "showdown" && t.stage !== "waiting") {
        p.leaving = true;
        if (!p.folded && !p.allIn) {
          p.folded = true; p.lastAction = "FOLD"; say(p.nick + " desiste e sai da mesa");
          if (t.toAct === s) { clearTimer(); p.acted = true;
            if (t.seats.filter(inHand).length === 1) winByFold();
            else if (!needsAction()) endBettingRound();
            else setTurn(nextSeat(s, (o) => canAct(o) && (!o.acted || o.bet < t.currentBet)));
          } else if (t.seats.filter(inHand).length === 1) winByFold();
        }
      } else if (p.inHand) {
        p.leaving = true; // sai quando o resultado sumir
      } else {
        bank.set(p.key, p.chips); t.seats[s] = null; say(p.nick + " saiu da mesa");
      }
      reply(cb);
      broadcast();
    });

    socket.on("poker:act", (msg, cb) => {
      const nick = nickNow(); if (!nick) return reply(cb, "Escolha um apelido primeiro.");
      const s = seatOfKey(keyOf(nick));
      if (s < 0) return reply(cb, "Voce nao esta na mesa.");
      const err = act(s, msg && msg.action, msg && msg.amount, false);
      reply(cb, err);
      if (err) broadcast();
    });

    socket.on("poker:away", (away, cb) => {
      const nick = nickNow(); if (!nick) return reply(cb);
      const s = seatOfKey(keyOf(nick)); if (s < 0) return reply(cb);
      t.seats[s].sittingOut = !!away;
      say(t.seats[s].nick + (away ? " ficou ausente" : " voltou"));
      reply(cb);
      maybeStart();
      broadcast();
    });

    socket.on("poker:rebuy", (cb) => {
      const nick = nickNow(); if (!nick) return reply(cb);
      const key = keyOf(nick);
      const s = seatOfKey(key); if (s < 0) return reply(cb, "Voce nao esta na mesa.");
      const p = t.seats[s];
      if (p.inHand && t.stage !== "waiting") return reply(cb, "Espere a mao acabar.");
      if (p.chips >= BIG_BLIND) return reply(cb, "Voce ainda tem fichas.");
      if (!isAdmin(socket.id)) {
        t.requests.set(key, { nick, type: "rebuy", seat: s });
        say(nick + " pediu para recomprar");
        if (typeof cb === "function") cb({ ok: false, pending: true });
        broadcast(); return;
      }
      reply(cb);
      doRebuy(p);
    });
  }

  function doSit(key, nick, seat) {
    if (seatOfKey(key) >= 0) return;
    if (!(seat >= 0 && seat < SEATS) || t.seats[seat]) seat = t.seats.findIndex((x) => !x);
    if (seat < 0) return;
    const chips = bank.has(key) && bank.get(key) > 0 ? bank.get(key) : START_CHIPS;
    t.seats[seat] = { key, nick, chips, inHand: false, hole: [], bet: 0, total: 0, sittingOut: false, leaving: false, lastAction: "" };
    say(nick + " sentou com " + chips + " fichas");
    maybeStart();
    broadcast();
  }

  function doRebuy(p) {
    p.chips = START_CHIPS; p.sittingOut = false;
    say(p.nick + " recomprou " + START_CHIPS + " fichas");
    maybeStart();
    broadcast();
  }

  function approve(key) {
    const req = t.requests.get(key);
    t.requests.delete(key);
    if (!req || !isOnline(key)) return;
    if (req.type === "sit" || seatOfKey(key) < 0) {
      if (!t.seats.some((x) => !x)) { say("Mesa cheia: " + req.nick + " nao conseguiu sentar"); return; }
      doSit(key, req.nick, req.seat); // quem tinha perdido tudo volta com fichas novas
    } else {
      const s = seatOfKey(key);
      const p = s >= 0 ? t.seats[s] : null;
      if (p && p.chips < BIG_BLIND && !(p.inHand && t.stage !== "waiting")) doRebuy(p);
    }
  }

  // Quando alguem troca de apelido, o lugar acompanha
  function rename(oldNick, newNick) {
    const s = seatOfKey(keyOf(oldNick));
    if (s >= 0) { t.seats[s].nick = newNick; t.seats[s].key = keyOf(newNick); }
    const req = t.requests.get(keyOf(oldNick));
    if (req) { t.requests.delete(keyOf(oldNick)); t.requests.set(keyOf(newNick), { ...req, nick: newNick }); }
    broadcast();
  }

  // Quem fecha a pagina sai da mesa (se estiver numa mao, sai quando ela acabar)
  function left(nick) {
    t.requests.delete(keyOf(nick));
    const s = seatOfKey(keyOf(nick));
    if (s >= 0) {
      const p = t.seats[s];
      if (!p.inHand || t.stage === "waiting") { bank.set(p.key, p.chips); t.seats[s] = null; say(p.nick + " saiu da mesa"); }
    }
    broadcast();
  }

  return { handle, broadcast, rename, left, refresh: maybeStart };
}

module.exports = { createPoker, bestHand, eval5, compare, handName };

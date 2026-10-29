// Truco Paulista (baralho de 40 cartas, vira e manilha), mesa de 4 (2x2) ou 6 (3x3).
// O servidor embaralha, distribui, valida as jogadas e conta os pontos; cada pessoa so recebe
// as proprias cartas (e as do parceiro na mao de onze).
const crypto = require("crypto");

const ORDER = "4567QJKA23"; // forca das cartas comuns, da mais fraca para a mais forte
const SUITS = "dshc";       // ouros (pica-fumo) < espadas (espadilha) < copas < paus (zap)
const MANILHA_NAME = { d: "Pica-fumo", s: "Espadilha", h: "Copas", c: "Zap" };
const RANK_NAME = { 4: "4", 5: "5", 6: "6", 7: "7", Q: "Dama", J: "Valete", K: "Rei", A: "As", 2: "2", 3: "3" };
const RAISES = [1, 3, 6, 9, 12];
const RAISE_NAME = { 3: "TRUCO", 6: "SEIS", 9: "NOVE", 12: "DOZE" };
const WIN_POINTS = 12;

let TURN_MS = 40000;        // tempo para jogar
let ANSWER_MS = 30000;      // tempo para responder truco (acabou: corre)
let ELEVEN_MS = 30000;      // tempo para decidir a mao de onze (acabou: joga)
let EMPTY_SEAT_MS = 2500;   // lugar vazio joga sozinho, rapido
let ROUND_PAUSE_MS = 1600;  // pausa para todo mundo ver as cartas da rodada
let HAND_PAUSE_MS = 3200;   // pausa entre maos

const SHOUTS = {
  3: ["TRUCO!", "TRUCO, MARRECO!", "TRUCO! CAI DENTRO!", "TRUUUCO!", "TRUCO, LADRAO!"],
  6: ["SEIS!", "SEIS, PATO!", "SEEEIS!", "TOMA SEIS!"],
  9: ["NOVE!", "NOVE, SEU MOLE!", "NOOOVE!"],
  12: ["DOZE!", "DOZE, ACABOU A BRINCADEIRA!", "DOOOZE!"],
  accept: ["DESCE!", "VEM!", "PODE VIR!", "DESCE QUE EU QUERO VER!"],
  run: ["CORREU!", "FUGIU, GALINHA!", "PEDIU PRA SAIR!", "CORRE, CORRE!"],
};
const PHRASES = [
  "Ta com medo?", "Mao de alface!", "Essa ja e nossa", "Joga logo!", "Vixe...", "Cai dentro!",
  "Que carta e essa?!", "Hoje nao, filhao", "Confia no parceiro", "Ta facil demais",
];
const SIGNALS = { zap: "ZAP", copas: "COPAS", espadilha: "ESPADILHA", picafumo: "PICA-FUMO", tres: "TEM 3", manilha: "TEM MANILHA", nada: "NAO TENHO NADA", truca: "PODE TRUCAR" };

const pick = (list) => list[crypto.randomInt(list.length)];

function newDeck() {
  const deck = [];
  for (const r of ORDER) for (const s of SUITS) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const manilhaOf = (vira) => ORDER[(ORDER.indexOf(vira[0]) + 1) % ORDER.length];

// Forca da carta: manilhas acima de tudo (por naipe); cartas encobertas valem -1
function strength(card, manilha, hidden) {
  if (hidden) return -1;
  if (card[0] === manilha) return 100 + SUITS.indexOf(card[1]);
  return ORDER.indexOf(card[0]);
}

// Resultado da mao pelas rodadas (0, 1 ou "tie"); undefined = ainda nao decidiu; "none" = ninguem pontua
function handWinner(r) {
  if (r.length >= 2) {
    if (r[0] !== "tie" && (r[1] === r[0] || r[1] === "tie")) return r[0]; // fez a 1a e ganhou/empatou a 2a
    if (r[0] === "tie" && r[1] !== "tie") return r[1];                    // empatou a 1a: quem fez a 2a
  }
  if (r.length === 3) {
    if (r[2] !== "tie") return r[2];
    if (r[0] !== "tie") return r[0]; // empatou a 3a: vale quem fez a 1a
    return "none";                   // empatou tudo
  }
  return undefined;
}

function createTruco(io, helpers, timing) {
  if (timing) ({ TURN_MS = TURN_MS, ANSWER_MS = ANSWER_MS, ELEVEN_MS = ELEVEN_MS, EMPTY_SEAT_MS = EMPTY_SEAT_MS, ROUND_PAUSE_MS = ROUND_PAUSE_MS, HAND_PAUSE_MS = HAND_PAUSE_MS } = timing);
  const { nickOf, isAdmin } = helpers;
  const keyOf = (nick) => nick.toLowerCase();
  const isOnline = (key) => [...io.sockets.sockets.values()].some((s) => (nickOf(s.id) || "").toLowerCase() === key);

  let g = blank();
  let timer = null;
  let eventId = 0;

  function blank() {
    return {
      stage: "empty", // empty | lobby | eleven | playing | roundEnd | handEnd | gameOver
      size: 4, host: null, seats: [], score: [0, 0], games: [0, 0], dealer: -1,
      deck: [], vira: null, manilha: null, value: 1, raisedBy: null, pending: null,
      rounds: [], table: [], toPlay: -1, special: null, elevenTeam: null, turnEndsAt: 0,
      handNo: 0, log: [], winner: null, lastHand: null,
    };
  }

  const team = (seat) => seat % 2;
  const seatOfKey = (key) => g.seats.findIndex((s) => s && s.key === key);
  const occupied = (s) => s && s.key;
  const say = (text) => { g.log.push(text); if (g.log.length > 14) g.log.shift(); };
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const teamNames = (t) => g.seats.filter((s, i) => occupied(s) && team(i) === t).map((s) => s.nick).join(" e ") || "Time " + (t ? "B" : "A");

  function event(type, text, extra) {
    io.emit("truco:event", { id: ++eventId, type, text, ...extra });
  }

  // ---------- partida ----------
  function startGame() {
    g.score = [0, 0];
    g.winner = null;
    g.dealer = g.dealer < 0 ? crypto.randomInt(g.size) : g.dealer;
    say("--- Nova partida ---");
    startHand();
  }

  function startHand() {
    clearTimer();
    g.handNo++;
    g.dealer = (g.dealer + 1) % g.size;
    g.deck = newDeck();
    for (const s of g.seats) s.hand = [g.deck.pop(), g.deck.pop(), g.deck.pop()];
    g.vira = g.deck.pop();
    g.manilha = manilhaOf(g.vira);
    g.value = 1; g.raisedBy = null; g.pending = null;
    g.rounds = []; g.table = []; g.lastHand = null;
    g.special = null; g.elevenTeam = null;
    g.toPlay = (g.dealer + 1) % g.size; // comeca quem esta depois de quem deu as cartas
    const at11 = [0, 1].filter((t) => g.score[t] === WIN_POINTS - 1);
    if (at11.length === 2) {
      g.special = "ferro";
      say("MAO DE FERRO: todo mundo joga no escuro");
      event("ferro", "MAO DE FERRO!");
      setTurn();
    } else if (at11.length === 1) {
      g.special = "onze";
      g.elevenTeam = at11[0];
      g.value = 3;
      g.stage = "eleven";
      say("Mao de onze para " + teamNames(g.elevenTeam) + ": joga valendo 3 ou corre");
      event("onze", "MAO DE ONZE!");
      g.turnEndsAt = Date.now() + ELEVEN_MS;
      timer = setTimeout(() => decideEleven(g.elevenTeam, true), ELEVEN_MS);
      broadcast();
    } else {
      say("Mao " + g.handNo + ": vira " + g.vira + ", manilha " + RANK_NAME[g.manilha]);
      setTurn();
    }
  }

  function decideEleven(t, play) {
    if (g.stage !== "eleven" || t !== g.elevenTeam) return;
    clearTimer();
    if (!play) {
      say(teamNames(t) + " correu da mao de onze");
      event("run", pick(SHOUTS.run), { team: t });
      return endHand(1 - t, 1);
    }
    say(teamNames(t) + " vai jogar a mao de onze valendo 3");
    event("accept", "VAI JOGAR!", { team: t });
    setTurn();
  }

  function setTurn() {
    clearTimer();
    g.stage = "playing";
    const s = g.seats[g.toPlay];
    const ms = occupied(s) && isOnline(s.key) ? TURN_MS : EMPTY_SEAT_MS;
    g.turnEndsAt = Date.now() + ms;
    timer = setTimeout(autoPlay, ms);
    broadcast();
  }

  function autoPlay() {
    const s = g.seats[g.toPlay];
    if (g.stage !== "playing" || !s || !s.hand.length) return;
    // joga a carta mais fraca
    let idx = 0;
    s.hand.forEach((c, i) => { if (strength(c, g.manilha) < strength(s.hand[idx], g.manilha)) idx = i; });
    if (occupied(s)) say(s.nick + " demorou e jogou automatico");
    play(g.toPlay, idx, false);
  }

  function play(seat, idx, hidden) {
    const s = g.seats[seat];
    if (g.stage !== "playing" || g.pending || seat !== g.toPlay) return "Nao e sua vez.";
    if (!(idx >= 0 && idx < s.hand.length)) return "Carta invalida.";
    if (hidden && g.rounds.length === 0) return "Na primeira rodada nao pode jogar encoberta.";
    if (hidden && g.special === "ferro") hidden = false;
    const card = s.hand.splice(idx, 1)[0];
    g.table.push({ seat, card, hidden: !!hidden });
    if (g.table.length < g.size) {
      g.toPlay = (seat + 1) % g.size;
      setTurn();
    } else {
      clearTimer();
      g.stage = "roundEnd";
      g.toPlay = -1;
      broadcast();
      timer = setTimeout(resolveRound, ROUND_PAUSE_MS);
    }
    return null;
  }

  function resolveRound() {
    const strengths = g.table.map((p) => strength(p.card, g.manilha, p.hidden));
    const best = Math.max(...strengths);
    const tops = g.table.filter((p, i) => strengths[i] === best);
    const teams = new Set(tops.map((p) => team(p.seat)));
    const n = g.rounds.length + 1;
    let result;
    if (teams.size === 1) {
      result = team(tops[0].seat);
      g.toPlay = tops[0].seat; // quem fez a rodada comeca a proxima
      const c = tops[0].card;
      const name = c[0] === g.manilha ? MANILHA_NAME[c[1]] : RANK_NAME[c[0]];
      say(g.seats[tops[0].seat].nick + " fez a " + n + "a rodada com " + (tops[0].hidden ? "carta encoberta" : name));
      event("round", g.seats[tops[0].seat].nick.toUpperCase() + " FEZ!", { team: result, seat: tops[0].seat, quiet: true });
    } else {
      result = "tie";
      g.toPlay = tops[0].seat; // cangou: quem empatou primeiro comeca
      say(n + "a rodada empatou (cangou)");
      event("tie", "CANGOU!", { quiet: true });
    }
    g.rounds.push(result);
    g.table = [];
    const w = handWinner(g.rounds);
    if (w === undefined) return setTurn();
    if (w === "none") { say("Empatou tudo: ninguem pontua"); return endHand(null, 0); }
    endHand(w, g.value);
  }

  function endHand(winnerTeam, points) {
    clearTimer();
    g.pending = null;
    g.toPlay = -1;
    g.table = [];
    if (winnerTeam !== null) {
      g.score[winnerTeam] += points;
      say(teamNames(winnerTeam) + " ganhou " + points + (points === 1 ? " ponto" : " pontos"));
    }
    g.lastHand = { team: winnerTeam, points };
    if (winnerTeam !== null && g.score[winnerTeam] >= WIN_POINTS) {
      g.stage = "gameOver";
      g.winner = winnerTeam;
      g.games[winnerTeam]++;
      say(teamNames(winnerTeam) + " GANHOU A PARTIDA!");
      event("game", "PARTIDA!", { team: winnerTeam });
      broadcast();
      return;
    }
    g.stage = "handEnd";
    if (winnerTeam !== null) event("hand", "+" + points, { team: winnerTeam, quiet: true });
    broadcast();
    timer = setTimeout(startHand, HAND_PAUSE_MS);
  }

  // ---------- truco ----------
  const nextRaise = () => RAISES[RAISES.indexOf(g.value) + 1];
  function canRaise(seat) {
    return g.stage === "playing" && !g.pending && seat === g.toPlay && !g.special
      && g.raisedBy !== team(seat) && nextRaise() !== undefined;
  }

  function raise(seat) {
    if (!canRaise(seat)) return "Agora nao da para pedir.";
    const to = nextRaise();
    clearTimer();
    g.pending = { team: team(seat), seat, to };
    say(g.seats[seat].nick + " pediu " + RAISE_NAME[to] + " (vale " + to + ")");
    event("raise", pick(SHOUTS[to]), { team: team(seat), seat, to, nick: g.seats[seat].nick });
    waitAnswer();
    return null;
  }

  function waitAnswer() {
    const answering = 1 - g.pending.team;
    const anyone = g.seats.some((s, i) => team(i) === answering && occupied(s) && isOnline(s.key));
    const ms = anyone ? ANSWER_MS : EMPTY_SEAT_MS;
    g.turnEndsAt = Date.now() + ms;
    timer = setTimeout(() => answer(answering, "run", null, true), ms);
    broadcast();
  }

  function answer(t, choice, nick, auto) {
    const p = g.pending;
    if (!p || t === p.team) return "Nao e voce que responde.";
    clearTimer();
    const who = nick || teamNames(t);
    if (choice === "run") {
      g.pending = null;
      say(who + (auto ? " nao respondeu e correu" : " correu"));
      event("run", pick(SHOUTS.run), { team: t, nick: who });
      return endHand(p.team, g.value), null; // quem pediu ganha o que valia antes
    }
    g.value = p.to;
    g.raisedBy = p.team;
    if (choice === "raise" && nextRaise() !== undefined) {
      const to = nextRaise();
      g.pending = { team: t, seat: -1, to };
      g.raisedBy = null;
      say(who + " aceitou e pediu " + RAISE_NAME[to]);
      event("raise", pick(SHOUTS[to]), { team: t, to, nick: who });
      waitAnswer();
      return null;
    }
    g.pending = null;
    say(who + " aceitou: vale " + g.value);
    event("accept", pick(SHOUTS.accept), { team: t, nick: who });
    setTurn(); // volta para quem ia jogar
    return null;
  }

  // ---------- visao de cada um ----------
  function viewFor(socketId) {
    const nick = nickOf(socketId);
    const key = nick ? keyOf(nick) : null;
    const me = key ? seatOfKey(key) : -1;
    const myTeam = me >= 0 ? team(me) : null;
    const blind = g.special === "ferro";
    const showPartners = g.stage === "eleven" && myTeam === g.elevenTeam;
    return {
      stage: g.stage, size: g.size, isHost: !!key && key === g.host, isAdmin: isAdmin(socketId),
      hostNick: g.host ? (g.seats.find((s) => s && s.key === g.host) || {}).nick || null : null,
      seats: g.seats.map((s, i) => ({
        nick: s && s.nick, team: team(i), cards: s && s.hand ? s.hand.length : 0, online: !!(s && s.key && isOnline(s.key)),
        hand: s && s.hand && i !== me && showPartners && team(i) === myTeam ? s.hand : null,
      })),
      me, myTeam,
      hand: me >= 0 && g.seats[me].hand ? (blind ? g.seats[me].hand.map(() => "??") : g.seats[me].hand) : [],
      vira: blind ? "??" : g.vira, manilha: blind ? null : g.manilha,
      score: g.score, games: g.games, value: g.value, rounds: g.rounds, special: g.special, elevenTeam: g.elevenTeam,
      table: g.table.map((p) => ({ seat: p.seat, card: p.hidden ? "??" : p.card })),
      toPlay: g.toPlay, dealer: g.dealer, turnEndsAt: g.turnEndsAt, serverNow: Date.now(), turnMs: g.pending ? ANSWER_MS : g.stage === "eleven" ? ELEVEN_MS : TURN_MS,
      pending: g.pending && { team: g.pending.team, to: g.pending.to, name: RAISE_NAME[g.pending.to], canRaiseBack: g.pending.to < 12 },
      canRaise: me >= 0 && canRaise(me), raiseName: RAISE_NAME[nextRaise()] || null,
      canHide: g.rounds.length > 0 && !blind,
      winner: g.winner, lastHand: g.lastHand, log: g.log, handNo: g.handNo,
      phrases: PHRASES, signals: SIGNALS,
    };
  }

  function broadcast() {
    for (const s of io.sockets.sockets.values()) s.emit("truco:state", viewFor(s.id));
  }

  function resetIfAbandoned() {
    if (g.stage !== "empty" && !g.seats.some((s) => s && s.key && isOnline(s.key))) {
      clearTimer();
      g = blank(); // todo mundo foi embora: a mesa some
    }
  }

  // ---------- comandos ----------
  function handle(socket) {
    const me = () => { const n = nickOf(socket.id); return n ? { nick: n, key: keyOf(n) } : null; };
    const reply = (cb, err) => typeof cb === "function" && cb(err ? { ok: false, error: err } : { ok: true });
    const inGame = () => !["empty", "lobby"].includes(g.stage);

    socket.emit("truco:state", viewFor(socket.id));

    socket.on("truco:create", (size, cb) => {
      const u = me(); if (!u) return reply(cb, "Escolha um apelido primeiro.");
      resetIfAbandoned();
      if (g.stage !== "empty") return reply(cb, "Ja tem uma mesa criada.");
      g = blank();
      g.size = Number(size) === 6 ? 6 : 4;
      g.host = u.key;
      g.stage = "lobby";
      g.seats = Array.from({ length: g.size }, () => null);
      g.seats[0] = { key: u.key, nick: u.nick, hand: null };
      say(u.nick + " criou uma mesa de " + g.size);
      reply(cb); broadcast();
    });

    socket.on("truco:size", (size, cb) => {
      const u = me(); if (!u || u.key !== g.host || g.stage !== "lobby") return reply(cb, "So quem criou a mesa muda isso.");
      const n = Number(size) === 6 ? 6 : 4;
      const people = g.seats.filter(Boolean);
      if (people.length > n) return reply(cb, "Tem gente demais sentada para uma mesa de " + n + ".");
      const seats = Array.from({ length: n }, (_, i) => g.seats[i] || null);
      // quem estava num lugar que deixou de existir vai para o primeiro vazio
      for (const p of g.seats.slice(n)) if (p) seats[seats.indexOf(null)] = p;
      g.seats = seats; g.size = n;
      say("Mesa agora e de " + n);
      reply(cb); broadcast();
    });

    socket.on("truco:sit", (seat, cb) => {
      const u = me(); if (!u) return reply(cb, "Escolha um apelido primeiro.");
      seat = Number(seat);
      if (!(seat >= 0 && seat < g.size) || g.stage === "empty") return reply(cb, "Lugar invalido.");
      const s = g.seats[seat];
      if (s && s.key) return reply(cb, "Lugar ocupado.");
      const was = seatOfKey(u.key);
      if (was >= 0) {
        if (inGame()) return reply(cb, "Voce ja esta jogando.");
        g.seats[was] = null;
      }
      if (inGame()) { s.key = u.key; s.nick = u.nick; say(u.nick + " assumiu um lugar vazio"); }
      else g.seats[seat] = { key: u.key, nick: u.nick, hand: null };
      reply(cb); broadcast();
    });

    socket.on("truco:stand", (cb) => {
      const u = me(); if (!u) return reply(cb);
      const i = seatOfKey(u.key); if (i < 0) return reply(cb);
      leaveSeat(i);
      reply(cb); broadcast();
    });

    socket.on("truco:start", (cb) => {
      const u = me(); if (!u || u.key !== g.host) return reply(cb, "So quem criou a mesa comeca o jogo.");
      if (g.stage !== "lobby" && g.stage !== "gameOver") return reply(cb, "O jogo ja comecou.");
      if (g.seats.some((s) => !s || !s.key)) return reply(cb, "Precisa de " + g.size + " jogadores sentados.");
      for (const s of g.seats) s.hand = [];
      startGame();
      reply(cb);
    });

    socket.on("truco:close", (cb) => {
      const u = me(); if (!u || (u.key !== g.host && !isAdmin(socket.id))) return reply(cb, "So quem criou a mesa (ou o ADM) encerra.");
      clearTimer();
      say("Mesa encerrada");
      g = blank();
      reply(cb); broadcast();
    });

    socket.on("truco:play", (msg, cb) => {
      const u = me(); if (!u) return reply(cb);
      const i = seatOfKey(u.key); if (i < 0) return reply(cb, "Voce nao esta na mesa.");
      reply(cb, play(i, Number(msg && msg.index), !!(msg && msg.hidden)));
    });

    socket.on("truco:raise", (cb) => {
      const u = me(); if (!u) return reply(cb);
      const i = seatOfKey(u.key); if (i < 0) return reply(cb, "Voce nao esta na mesa.");
      reply(cb, raise(i));
    });

    socket.on("truco:answer", (choice, cb) => {
      const u = me(); if (!u) return reply(cb);
      const i = seatOfKey(u.key); if (i < 0) return reply(cb, "Voce nao esta na mesa.");
      if (!["accept", "run", "raise"].includes(choice)) return reply(cb, "Resposta invalida.");
      reply(cb, answer(team(i), choice, u.nick, false));
    });

    socket.on("truco:eleven", (playIt, cb) => {
      const u = me(); if (!u) return reply(cb);
      const i = seatOfKey(u.key);
      if (i < 0 || g.stage !== "eleven" || team(i) !== g.elevenTeam) return reply(cb, "Nao e voce que decide.");
      decideEleven(team(i), !!playIt);
      reply(cb);
    });

    let lastShout = 0;
    socket.on("truco:shout", (idx) => {
      const u = me(); if (!u || seatOfKey(u.key) < 0) return;
      const now = Date.now();
      if (now - lastShout < 2500 || !PHRASES[idx]) return;
      lastShout = now;
      event("phrase", PHRASES[idx], { nick: u.nick, seat: seatOfKey(u.key), quiet: true });
    });

    // Sinal so para o parceiro; os adversarios so percebem que teve uma piscada
    socket.on("truco:signal", (code) => {
      const u = me(); if (!u) return;
      const i = seatOfKey(u.key);
      if (i < 0 || !SIGNALS[code] || !inGame()) return;
      const now = Date.now();
      if (now - lastShout < 1500) return;
      lastShout = now;
      for (const s of io.sockets.sockets.values()) {
        const k = (nickOf(s.id) || "").toLowerCase();
        const j = seatOfKey(k);
        if (j < 0 || j === i) continue;
        const partner = team(j) === team(i);
        s.emit("truco:signal", { nick: u.nick, seat: i, text: partner ? SIGNALS[code] : null });
      }
    });
  }

  function leaveSeat(i) {
    const s = g.seats[i];
    if (!s) return;
    if (g.stage === "lobby") {
      g.seats[i] = null;
      if (s.key === g.host) { const next = g.seats.find(Boolean); g.host = next ? next.key : null; }
      say(s.nick + " saiu da mesa");
      if (!g.seats.some(Boolean)) { clearTimer(); g = blank(); }
    } else if (g.stage !== "empty") {
      say(s.nick + " saiu: o lugar joga sozinho ate alguem assumir");
      const wasHost = s.key === g.host;
      s.key = null; s.nick = null;
      if (wasHost) { const next = g.seats.find((x) => x && x.key); g.host = next ? next.key : null; }
      // se era a vez desse lugar, acelera
      if (g.stage === "playing" && g.toPlay === i && !g.pending) setTurn();
      resetIfAbandoned();
    }
  }

  function left(nick) {
    const i = seatOfKey(keyOf(nick));
    if (i >= 0) leaveSeat(i);
    broadcast();
  }

  function rename(oldNick, newNick) {
    const i = seatOfKey(keyOf(oldNick));
    if (i >= 0) { g.seats[i].key = keyOf(newNick); g.seats[i].nick = newNick; }
    if (g.host === keyOf(oldNick)) g.host = keyOf(newNick);
    broadcast();
  }

  return { handle, broadcast, left, rename };
}

module.exports = { createTruco, handWinner, strength, manilhaOf };

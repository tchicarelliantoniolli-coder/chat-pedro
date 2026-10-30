// Mesa do Blefe: jogo de cartas de blefe com castigo de revolver (de 2 a 6 jogadores).
// Regras nossas: baralho de 36 cartas (8 de cada naipe + 4 coringas), 5 cartas para cada um por rodada,
// a mesa sorteia um naipe e cada um joga de 1 a 3 cartas viradas dizendo que sao desse naipe.
// O proximo joga tambem ou grita DUVIDO. Quem perde a duvida puxa o gatilho do proprio revolver
// (6 espacos, 1 bala escondida que so o servidor sabe). Quem sobrar vivo ganha.
const crypto = require("crypto");

const SUITS = "hdsc";            // copas, ouros, espadas, paus
const JOKER = "J";               // coringa: vale como qualquer naipe
const PER_SUIT = 8, JOKERS = 4, HAND = 5, MAX_PLAY = 3, CHAMBERS = 6, MAX_SEATS = 6;

let TURN_MS = 25000;       // tempo para jogar ou duvidar (acabou: joga uma carta qualquer)
let TRIGGER_MS = 10000;    // tempo para puxar o gatilho (acabou: puxa sozinho)
let EMPTY_SEAT_MS = 2500;  // lugar vazio joga sozinho, rapido
let REVEAL_MS = 3200;      // cartas viradas na mesa antes do revolver
let SHOT_MS = 3800;        // depois do tiro (ou do clique), antes da proxima rodada
let ROUND_MS = 1500;       // pausa entre rodadas

const COLORS = ["#c0392b", "#2e86de", "#27ae60", "#8e44ad", "#e67e22", "#16a085", "#d4ac0d", "#7f8c8d", "#e84393", "#2d3436"];
const HATS = ["none", "cartola", "bone", "festa", "coroa", "cowboy"];
const EMOTES = ["apontar", "rir", "bater", "ombros", "suar", "joinha"];

const pick = (list) => list[crypto.randomInt(list.length)];

function newDeck() {
  const deck = [];
  for (const s of SUITS) for (let i = 0; i < PER_SUIT; i++) deck.push(s);
  for (let i = 0; i < JOKERS; i++) deck.push(JOKER);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// a jogada e verdade se todas as cartas sao do naipe da mesa (ou coringa)
const isTruth = (cards, suit) => cards.every((c) => c === suit || c === JOKER);

function createBlefe(io, helpers, timing) {
  if (timing) ({ TURN_MS = TURN_MS, TRIGGER_MS = TRIGGER_MS, EMPTY_SEAT_MS = EMPTY_SEAT_MS, REVEAL_MS = REVEAL_MS, SHOT_MS = SHOT_MS, ROUND_MS = ROUND_MS } = timing);
  const { nickOf, isAdmin } = helpers;
  const keyOf = (nick) => nick.toLowerCase();
  const isOnline = (key) => [...io.sockets.sockets.values()].some((s) => (nickOf(s.id) || "").toLowerCase() === key);

  let g = blank();
  let timer = null;
  let eventId = 0;

  function blank() {
    return {
      stage: "empty", // empty | lobby | playing | reveal | trigger | shot | roundEnd | gameOver
      host: null, seats: Array.from({ length: MAX_SEATS }, () => null),
      suit: null, pile: 0, last: null, toPlay: -1, starter: -1, turnEndsAt: 0, roundNo: 0,
      reveal: null, shot: null, winner: null, log: [], wins: {},
    };
  }

  const seatOfKey = (key) => g.seats.findIndex((s) => s && s.key === key);
  const say = (text) => { g.log.push(text); if (g.log.length > 14) g.log.shift(); };
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const nameOf = (i) => (g.seats[i] && g.seats[i].nick) || "Lugar vazio";
  const playing = () => g.seats.map((s, i) => (s && s.inGame ? i : -1)).filter((i) => i >= 0);
  const alive = () => playing().filter((i) => g.seats[i].alive);
  const inGame = () => !["empty", "lobby", "gameOver"].includes(g.stage);
  const human = (i) => { const s = g.seats[i]; return !!(s && s.key && isOnline(s.key)); };
  const event = (type, extra) => io.emit("blefe:event", { id: ++eventId, type, ...extra });

  // proximo vivo depois de "from" que ainda tem cartas
  function nextWithCards(from) {
    const order = alive();
    if (!order.length) return -1;
    let k = order.indexOf(from);
    for (let n = 0; n < order.length; n++) {
      k = (k + 1) % order.length;
      const i = order[k];
      if (g.seats[i].hand.length) return i;
    }
    return -1;
  }
  const nextAlive = (from) => { const order = alive(); const k = order.indexOf(from); return order[(k + 1) % order.length]; };

  // ---------- partida ----------
  function startGame() {
    clearTimer();
    for (const s of g.seats) if (s) {
      s.inGame = true; s.alive = true; s.hand = []; s.pulls = 0;
      s.bullet = crypto.randomInt(CHAMBERS); // em qual puxada sai a bala (0 = ja na primeira)
    }
    g.winner = null; g.roundNo = 0;
    g.starter = pick(alive());
    say("--- Nova partida com " + alive().length + " jogadores ---");
    event("start");
    startRound();
  }

  function startRound() {
    clearTimer();
    g.roundNo++;
    const deck = newDeck();
    for (const i of alive()) g.seats[i].hand = deck.splice(0, HAND).sort();
    g.suit = pick(SUITS);
    g.pile = 0; g.last = null; g.reveal = null; g.shot = null;
    if (!g.seats[g.starter] || !g.seats[g.starter].alive) g.starter = nextAlive(g.starter);
    g.toPlay = g.starter;
    say("Rodada " + g.roundNo + ": a mesa é de " + { h: "Copas", d: "Ouros", s: "Espadas", c: "Paus" }[g.suit]);
    event("round", { suit: g.suit });
    setTurn();
  }

  // so quem ainda tem cartas joga; se so sobrou ele com cartas, e obrigado a duvidar
  const mustDoubt = (i) => !!g.last && g.last.seat !== i && alive().every((j) => j === i || !g.seats[j].hand.length);

  function setTurn() {
    clearTimer();
    g.stage = "playing";
    const ms = human(g.toPlay) ? TURN_MS : EMPTY_SEAT_MS;
    g.turnEndsAt = Date.now() + ms;
    timer = setTimeout(autoPlay, ms);
    broadcast();
  }

  function autoPlay() {
    if (g.stage !== "playing") return;
    const i = g.toPlay, s = g.seats[i];
    if (s.key) say(s.nick + " demorou e o jogo decidiu");
    // lugar vazio: duvida de vez em quando; quem demorou joga uma carta
    if (g.last && (mustDoubt(i) || (!s.key && crypto.randomInt(3) === 0))) return doubt(i);
    const best = s.hand.findIndex((c) => c === g.suit || c === JOKER);
    play(i, [best >= 0 ? best : 0]);
  }

  function play(i, idxs) {
    const s = g.seats[i];
    if (g.stage !== "playing" || i !== g.toPlay) return "Não é sua vez.";
    if (mustDoubt(i)) return "Só você tem cartas: tem que duvidar.";
    if (!Array.isArray(idxs)) return "Escolha as cartas.";
    idxs = [...new Set(idxs.map(Number))];
    if (!idxs.length || idxs.length > MAX_PLAY) return "Jogue de 1 a " + MAX_PLAY + " cartas.";
    if (idxs.some((k) => !(Number.isInteger(k) && k >= 0 && k < s.hand.length))) return "Carta inválida.";
    clearTimer();
    const cards = idxs.map((k) => s.hand[k]);
    s.hand = s.hand.filter((_, k) => !idxs.includes(k));
    g.last = { seat: i, cards };
    g.pile += cards.length;
    say(s.nick + " jogou " + cards.length + (cards.length === 1 ? " carta" : " cartas"));
    event("play", { seat: i, count: cards.length });
    if (!s.hand.length) { say(s.nick + " ficou sem cartas e está salvo nesta rodada"); event("safe", { seat: i }); }
    const nx = nextWithCards(i);
    if (nx < 0) {
      // ninguem mais tem cartas: o proximo vivo e obrigado a duvidar da ultima jogada
      g.toPlay = nextAlive(i);
      return doubt(g.toPlay), null;
    }
    g.toPlay = nx;
    setTurn();
    return null;
  }

  function doubt(i) {
    if (g.stage !== "playing" || i !== g.toPlay) return "Não é sua vez.";
    if (!g.last || g.last.seat === i) return "Não tem jogada para duvidar.";
    clearTimer();
    const truth = isTruth(g.last.cards, g.suit);
    const loser = truth ? i : g.last.seat;
    g.reveal = { by: i, seat: g.last.seat, cards: g.last.cards, truth, loser };
    g.stage = "reveal";
    g.toPlay = -1;
    say(nameOf(i) + " gritou DUVIDO para " + nameOf(g.last.seat) + ": " + (truth ? "era verdade!" : "era mentira!"));
    event("doubt", { seat: i, target: g.last.seat });
    broadcast();
    timer = setTimeout(waitTrigger, REVEAL_MS);
    return null;
  }

  function waitTrigger() {
    clearTimer();
    g.stage = "trigger";
    g.shot = { seat: g.reveal.loser, result: null };
    const ms = human(g.shot.seat) ? TRIGGER_MS : EMPTY_SEAT_MS;
    g.turnEndsAt = Date.now() + ms;
    timer = setTimeout(() => pull(g.shot.seat), ms);
    event("aim", { seat: g.shot.seat });
    broadcast();
  }

  function pull(i) {
    if (g.stage !== "trigger" || !g.shot || g.shot.seat !== i) return "Não é você que atira.";
    clearTimer();
    const s = g.seats[i];
    const bang = s.pulls === s.bullet;
    s.pulls++;
    g.shot.result = bang ? "bang" : "click";
    g.stage = "shot";
    if (bang) {
      s.alive = false; s.hand = [];
      say("BANG! " + nameOf(i) + " está fora");
    } else say("Clique... " + nameOf(i) + " escapou (" + s.pulls + " de " + CHAMBERS + ")");
    event(bang ? "bang" : "click", { seat: i, pulls: s.pulls });
    g.starter = bang ? nextAlive(i) : i; // quem levou o tiro comeca a proxima (se ainda estiver vivo)
    broadcast();
    timer = setTimeout(afterShot, SHOT_MS);
    return null;
  }

  function afterShot() {
    clearTimer();
    const left = alive();
    if (left.length <= 1) {
      g.stage = "gameOver";
      g.winner = left.length ? left[0] : null;
      g.toPlay = -1;
      if (g.winner !== null) {
        const w = g.seats[g.winner];
        if (w.key) g.wins[w.key] = (g.wins[w.key] || 0) + 1;
        say(nameOf(g.winner) + " GANHOU A MESA!");
      }
      event("win", { seat: g.winner });
      return broadcast();
    }
    g.stage = "roundEnd";
    broadcast();
    timer = setTimeout(startRound, ROUND_MS);
  }

  // ---------- visao de cada um ----------
  function viewFor(socketId) {
    const nick = nickOf(socketId);
    const key = nick ? keyOf(nick) : null;
    const me = key ? seatOfKey(key) : -1;
    const mine = me >= 0 ? g.seats[me] : null;
    return {
      stage: g.stage, isHost: !!key && key === g.host, isAdmin: isAdmin(socketId),
      hostNick: g.host ? (g.seats.find((s) => s && s.key === g.host) || {}).nick || null : null,
      seats: g.seats.map((s, i) => s && {
        nick: s.nick, online: !!(s.key && isOnline(s.key)), inGame: !!s.inGame, alive: s.alive !== false,
        cards: s.hand ? s.hand.length : 0, pulls: s.pulls || 0, look: s.look, wins: (s.key && g.wins[s.key]) || 0,
      }),
      me, hand: mine && mine.inGame && mine.hand ? mine.hand : [],
      suit: g.suit, pile: g.pile, last: g.last && { seat: g.last.seat, count: g.last.cards.length },
      toPlay: g.toPlay, turnEndsAt: g.turnEndsAt, serverNow: Date.now(),
      turnMs: g.stage === "trigger" ? TRIGGER_MS : TURN_MS,
      canDoubt: me >= 0 && g.stage === "playing" && g.toPlay === me && !!g.last && g.last.seat !== me,
      mustDoubt: me >= 0 && g.stage === "playing" && g.toPlay === me && mustDoubt(me),
      reveal: g.reveal && ["reveal", "trigger", "shot"].includes(g.stage) ? g.reveal : null,
      shot: g.shot && ["trigger", "shot"].includes(g.stage) ? g.shot : null,
      winner: g.winner, roundNo: g.roundNo, log: g.log, chambers: CHAMBERS, maxPlay: MAX_PLAY,
    };
  }

  function broadcast() {
    for (const s of io.sockets.sockets.values()) s.emit("blefe:state", viewFor(s.id));
  }

  function resetIfAbandoned() {
    if (g.stage !== "empty" && !g.seats.some((s) => s && s.key && isOnline(s.key))) {
      clearTimer();
      g = blank(); // todo mundo foi embora: a mesa some
    }
  }

  const cleanLook = (l) => ({
    color: l && COLORS.includes(l.color) ? l.color : pick(COLORS),
    hat: l && HATS.includes(l.hat) ? l.hat : "none",
  });

  // ---------- comandos ----------
  function handle(socket) {
    const me = () => { const n = nickOf(socket.id); return n ? { nick: n, key: keyOf(n) } : null; };
    const reply = (cb, err) => typeof cb === "function" && cb(err ? { ok: false, error: err } : { ok: true });
    const mySeat = () => { const u = me(); return u ? seatOfKey(u.key) : -1; };

    socket.emit("blefe:state", viewFor(socket.id));

    socket.on("blefe:create", (look, cb) => {
      const u = me(); if (!u) return reply(cb, "Escolha um apelido primeiro.");
      resetIfAbandoned();
      if (g.stage !== "empty") return reply(cb, "Já tem uma mesa aberta.");
      g = { ...blank(), wins: g.wins };
      g.host = u.key; g.stage = "lobby";
      g.seats[0] = { key: u.key, nick: u.nick, look: cleanLook(look) };
      say(u.nick + " abriu a Mesa do Blefe");
      reply(cb); broadcast();
    });

    socket.on("blefe:sit", (msg, cb) => {
      const u = me(); if (!u) return reply(cb, "Escolha um apelido primeiro.");
      const seat = Number(msg && msg.seat);
      if (!(seat >= 0 && seat < MAX_SEATS) || g.stage === "empty") return reply(cb, "Lugar inválido.");
      const s = g.seats[seat];
      const was = seatOfKey(u.key);
      if (inGame()) {
        // no meio da partida so da para assumir um lugar vivo que ficou vazio
        if (was >= 0) return reply(cb, "Você já está na mesa.");
        if (!s || s.key || !s.inGame || !s.alive) return reply(cb, "Não dá para sentar aí agora.");
        s.key = u.key; s.nick = u.nick; s.look = cleanLook(msg && msg.look);
        say(u.nick + " assumiu um lugar vazio");
      } else {
        if (s && s.key) return reply(cb, "Lugar ocupado.");
        if (was >= 0) g.seats[was] = null;
        g.seats[seat] = { key: u.key, nick: u.nick, look: cleanLook(msg && msg.look) };
      }
      reply(cb); broadcast();
    });

    socket.on("blefe:look", (look, cb) => {
      const i = mySeat(); if (i < 0) return reply(cb);
      g.seats[i].look = cleanLook(look);
      reply(cb); broadcast();
    });

    socket.on("blefe:stand", (cb) => {
      const i = mySeat(); if (i < 0) return reply(cb);
      leaveSeat(i);
      reply(cb); broadcast();
    });

    socket.on("blefe:start", (cb) => {
      const u = me(); if (!u || u.key !== g.host) return reply(cb, "Só quem abriu a mesa começa o jogo.");
      if (g.stage !== "lobby" && g.stage !== "gameOver") return reply(cb, "O jogo já começou.");
      // quem saiu no meio da partida anterior deixa o lugar livre
      g.seats = g.seats.map((s) => (s && s.key ? s : null));
      if (g.seats.filter(Boolean).length < 2) return reply(cb, "Precisa de pelo menos 2 jogadores sentados.");
      startGame();
      reply(cb);
    });

    socket.on("blefe:close", (cb) => {
      const u = me(); if (!u || (u.key !== g.host && !isAdmin(socket.id))) return reply(cb, "Só quem abriu a mesa (ou o ADM) fecha.");
      clearTimer();
      g = { ...blank(), wins: g.wins };
      say("Mesa fechada");
      reply(cb); broadcast();
    });

    socket.on("blefe:play", (idxs, cb) => {
      const i = mySeat(); if (i < 0) return reply(cb, "Você não está na mesa.");
      reply(cb, play(i, idxs));
    });

    socket.on("blefe:doubt", (cb) => {
      const i = mySeat(); if (i < 0) return reply(cb, "Você não está na mesa.");
      reply(cb, doubt(i));
    });

    socket.on("blefe:pull", (cb) => {
      const i = mySeat(); if (i < 0) return reply(cb, "Você não está na mesa.");
      reply(cb, pull(i));
    });

    // reacoes do boneco (apontar, rir, bater na mesa...): todo mundo ve
    let lastEmote = 0;
    socket.on("blefe:emote", (msg) => {
      const i = mySeat();
      if (i < 0 || !msg || !EMOTES.includes(msg.type)) return;
      const now = Date.now();
      if (now - lastEmote < 1200) return;
      lastEmote = now;
      const to = Number(msg.to);
      event("emote", { seat: i, emote: msg.type, to: to >= 0 && to < MAX_SEATS && g.seats[to] ? to : -1 });
    });
  }

  function leaveSeat(i) {
    const s = g.seats[i];
    if (!s) return;
    if (!inGame()) {
      g.seats[i] = null;
      if (s.key === g.host) { const next = g.seats.find(Boolean); g.host = next ? next.key : null; }
      say(s.nick + " saiu da mesa");
      if (!g.seats.some(Boolean)) { clearTimer(); g = { ...blank(), wins: g.wins }; }
    } else {
      say(s.nick + " saiu: o lugar joga sozinho até alguém assumir");
      const wasHost = s.key === g.host;
      s.key = null; s.nick = s.nick + " (vazio)";
      if (wasHost) { const next = g.seats.find((x) => x && x.key); g.host = next ? next.key : null; }
      // se era a vez desse lugar, acelera
      if (g.stage === "playing" && g.toPlay === i) setTurn();
      if (g.stage === "trigger" && g.shot && g.shot.seat === i) { clearTimer(); timer = setTimeout(() => pull(i), EMPTY_SEAT_MS); }
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

module.exports = { createBlefe, isTruth, newDeck };

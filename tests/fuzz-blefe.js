// Joga muitas partidas da Mesa do Blefe com robos que jogam e duvidam ao acaso, procurando travas e regras quebradas
const { createBlefe } = require((process.argv[2] || require('path').join(__dirname, '..')) + '/blefe.js');
const N = Number(process.argv[3]), GAMES = Number(process.argv[4] || 30);
const sockets = new Map(), nicks = new Map(), events = {};
const io = { sockets: { sockets }, emit: (ev, d) => { if (ev === 'blefe:event') { events[d.type] = (events[d.type] || 0) + 1; onEvent(d); } } };
let problems = [], games = 0, rounds = 0, lastRound = 0, lastProgress = Date.now(), shots = 0, bangs = 0, lies = 0, truths = 0;
const bots = [];
for (let i = 0; i < N; i++) {
  const id = 's' + i; nicks.set(id, 'Bot' + i);
  const sock = { id, h: {}, on(ev, fn) { this.h[ev] = fn; }, emit(ev, v) { if (ev === 'blefe:state') onState(this, v); } };
  sockets.set(id, sock); bots.push(sock);
}
const send = (sock, ev, arg) => setImmediate(() => { const cb = (r) => { if (r && !r.ok) problems.push(sock.id + ' ' + ev + ' ' + JSON.stringify(arg) + ': ' + r.error); }; arg === undefined ? sock.h[ev](cb) : sock.h[ev](arg, cb); });
function onEvent(d) {
  if (d.type === 'click' || d.type === 'bang') shots++;
  if (d.type === 'bang') bangs++;
}
function onState(sock, v) {
  if (sock.id === 's0') {
    if (v.roundNo !== lastRound) { lastRound = v.roundNo; rounds++; lastProgress = Date.now(); }
    const total = v.seats.reduce((n, s) => n + (s ? s.cards : 0), 0) + v.pile;
    if (v.stage === 'playing' && total !== v.seats.filter((s) => s && s.inGame && s.alive).length * 5) problems.push('cartas somem ou aparecem: ' + total);
    if (v.seats.some((s) => s && s.pulls > 6)) problems.push('puxou mais de 6 vezes');
    if (v.reveal && v.stage === 'reveal' && !sock.rev) { sock.rev = true; v.reveal.truth ? truths++ : lies++; }
    if (v.stage !== 'reveal') sock.rev = false;
    if (v.stage === 'gameOver' && !sock.over) {
      sock.over = true; games++;
      const alive = v.seats.filter((s) => s && s.inGame && s.alive);
      if (alive.length !== 1 || v.seats[v.winner] !== alive[0]) problems.push('fim errado: ' + alive.length + ' vivos');
      if (games < GAMES) send(sock, 'blefe:start');
    }
    if (v.stage !== 'gameOver') sock.over = false;
  }
  if (v.me < 0 || sock.busy) return;
  const mine = (fn) => { sock.busy = true; setImmediate(() => { sock.busy = false; fn(); }); };
  if (v.stage === 'trigger' && v.shot && v.shot.seat === v.me && Math.random() < 0.7) return mine(() => send(sock, 'blefe:pull'));
  if (v.stage === 'playing' && v.toPlay === v.me) {
    if (v.mustDoubt || (v.canDoubt && Math.random() < 0.3)) return mine(() => send(sock, 'blefe:doubt'));
    if (Math.random() < 0.05) return; // as vezes demora e o jogo decide
    const n = 1 + Math.floor(Math.random() * Math.min(3, v.hand.length));
    const idx = [...Array(v.hand.length).keys()].sort(() => Math.random() - 0.5).slice(0, n);
    return mine(() => send(sock, 'blefe:play', idx));
  }
}
const bl = createBlefe(io, { nickOf: id => nicks.get(id), isAdmin: () => false }, { TURN_MS: 30, TRIGGER_MS: 30, EMPTY_SEAT_MS: 5, REVEAL_MS: 1, SHOT_MS: 1, ROUND_MS: 1 });
for (const b of bots) bl.handle(b);
bots[0].h['blefe:create']({ color: '#c0392b', hat: 'cartola' }, () => {});
for (let i = 1; i < N; i++) bots[i].h['blefe:sit']({ seat: i }, (r) => { if (!r.ok) problems.push('sentar ' + r.error); });
bots[0].h['blefe:start'](() => {});
// no meio, um sai e outro volta (lugar vazio joga sozinho)
setTimeout(() => { if (N > 2) bl.left('Bot' + (N - 1)); }, 300);
const iv = setInterval(() => {
  if (games >= GAMES || Date.now() - lastProgress > 4000 || problems.length > 8) {
    clearInterval(iv);
    console.log(`mesa de ${N}: ${games} partidas, ${rounds} rodadas, ${shots} gatilhos, ${bangs} tiros, duvidas: ${lies} mentiras e ${truths} verdades` + (Date.now() - lastProgress > 4000 ? ' (TRAVOU!)' : ''));
    console.log('  problemas:', problems.slice(0, 8));
    process.exit(0);
  }
}, 100);

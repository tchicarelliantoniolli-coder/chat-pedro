const { createTruco } = require((process.argv[2] || require('path').join(__dirname, '..')) + '/truco.js');
const N = Number(process.argv[3]), GAMES = Number(process.argv[4] || 30);
const sockets = new Map(), nicks = new Map();
const io = { sockets: { sockets }, emit: (ev, d) => { if (ev === 'truco:event') events[d.type] = (events[d.type] || 0) + 1; } };
const events = {};
let problems = [], games = 0, hands = 0, lastHand = 0, lastProgress = Date.now(), lastScore = [0, 0], specials = { onze: 0, ferro: 0 }, lastSpecialHand = 0;
const bots = [];
for (let i = 0; i < N; i++) {
  const id = 's' + i; nicks.set(id, 'Bot' + i);
  const sock = { id, h: {}, on(ev, fn) { this.h[ev] = fn; }, emit(ev, v) { if (ev === 'truco:state') onState(this, v); } };
  sockets.set(id, sock); bots.push(sock);
}
const send = (sock, ev, arg) => setImmediate(() => sock.h[ev](arg, (r) => { if (r && !r.ok && !/N(a|ã)o (e|é) (voce|você) que (responde|decide)/.test(r.error)) problems.push(sock.id + ' ' + ev + ' ' + JSON.stringify(arg) + ': ' + r.error); }));
function onState(sock, v) {
  if (sock.id === 's0') {
    if (v.handNo !== lastHand) { lastHand = v.handNo; hands++; lastProgress = Date.now(); }
    if (v.special && v.handNo !== lastSpecialHand) { specials[v.special]++; lastSpecialHand = v.handNo; }
    if (v.stage === 'gameOver' && !sock.over) {
      sock.over = true; games++;
      if (Math.max(...v.score) < 12) problems.push('fim sem 12: ' + v.score);
      if (v.winner !== v.score.indexOf(Math.max(...v.score))) problems.push('vencedor errado');
      if (games < GAMES) send(sock, 'truco:start');
    }
    if (v.stage !== 'gameOver') sock.over = false;
    if (v.stage !== 'gameOver' && (v.score[0] < lastScore[0] || v.score[1] < lastScore[1]) && !(v.score[0] === 0 && v.score[1] === 0)) problems.push('placar voltou ' + lastScore + ' -> ' + v.score);
    lastScore = v.score.slice();
    if (v.seats.reduce((n, s) => n + s.cards, 0) + v.table.length > N * 3) problems.push('cartas demais');
  }
  if (v.me < 0 || sock.busy) return;
  const mine = (fn) => { sock.busy = true; setImmediate(() => { sock.busy = false; fn(); }); };
  if (v.stage === 'eleven' && v.myTeam === v.elevenTeam) {
    if (v.seats.filter((s, i) => i !== v.me && s.team === v.myTeam).some(s => !s.hand)) problems.push('parceiro nao viu as cartas na mao de onze');
    return mine(() => send(sock, 'truco:eleven', Math.random() < 0.7));
  }
  if (v.pending && v.pending.team !== v.myTeam && Math.random() < 0.5) {
    const r = Math.random();
    return mine(() => send(sock, 'truco:answer', r < 0.45 ? 'accept' : r < 0.8 ? 'run' : (v.pending.canRaiseBack ? 'raise' : 'accept')));
  }
  if (v.stage === 'playing' && !v.pending && v.toPlay === v.me) {
    if (v.canRaise && Math.random() < 0.15) return mine(() => send(sock, 'truco:raise'));
    const idx = Math.floor(Math.random() * v.hand.length);
    const hidden = v.canHide && Math.random() < 0.1;
    return mine(() => send(sock, 'truco:play', { index: idx, hidden }));
  }
}
const tr = createTruco(io, { nickOf: id => nicks.get(id), isAdmin: () => false }, { TURN_MS: 3000, ANSWER_MS: 400, ELEVEN_MS: 400, EMPTY_SEAT_MS: 50, ROUND_PAUSE_MS: 1, HAND_PAUSE_MS: 1 });
for (const b of bots) tr.handle(b);
bots[0].h['truco:create'](N, () => {});
for (let i = 1; i < N; i++) bots[i].h['truco:sit'](i, (r) => { if (!r.ok) problems.push('sentar ' + r.error); });
bots[0].h['truco:start'](() => {});
const iv = setInterval(() => {
  if (games >= GAMES || Date.now() - lastProgress > 4000 || problems.length > 8) {
    clearInterval(iv);
    console.log(`mesa de ${N}: ${games} partidas, ${hands} maos, mao de onze ${specials.onze}x, mao de ferro ${specials.ferro}x` + (Date.now() - lastProgress > 4000 ? ' (TRAVOU!)' : ''));
    console.log('  gritos:', JSON.stringify(events));
    console.log('  problemas:', problems.slice(0, 8));
    process.exit(0);
  }
}, 100);

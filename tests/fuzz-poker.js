const { createPoker } = require((process.argv[2] || require('path').join(__dirname, '..')) + '/poker.js');
const N = Number(process.argv[3] || 4);
const sockets = new Map(), nicks = new Map();
const io = { sockets: { sockets } };
let hands = 0, problems = [], lastHand = 0, lastProgress = Date.now();
const bots = [];
for (let i = 0; i < N; i++) {
  const id = 's' + i; nicks.set(id, 'Bot' + i);
  const sock = { id, h: {}, on(ev, fn) { this.h[ev] = fn; }, emit(ev, v) { if (ev === 'poker:state') onState(this, v); } };
  sockets.set(id, sock); bots.push(sock);
}
let total = N * 1000; let rebuys = 0, showdowns = 0, sidepots = 0;
function onState(sock, v) {
  const sum = v.seats.reduce((n, s) => n + (s ? s.chips : 0), 0) + v.pot + v.seats.reduce((n, s) => n + (s ? s.bet : 0), 0);
  if (v.seats.some(s => s && s.chips < 0)) problems.push('fichas negativas');
  if (v.stage === 'waiting' && sum !== total && v.seats.filter(Boolean).length === N) problems.push('soma ' + sum + ' != ' + total + ' na mao ' + v.handNo);
  const mine = v.mySeat >= 0 && v.seats[v.mySeat];
  if (mine && mine.chips === 0 && !mine.inHand && !sock.rb) { sock.rb = true; sock.h['poker:rebuy']((r) => { sock.rb = false; if (r.ok) { total += 1000; rebuys++; } }); }
  if (sock.id === 's0' && v.result && v.result !== sock.lastRes) { sock.lastRes = v.result; if (v.result.winners.some(w => w.hand)) showdowns++; }
  if (sock.id === 's0') for (const l of v.log) if (/side pot/.test(l) && !(sock.seen ||= new Set()).has(l + v.handNo)) { sock.seen.add(l + v.handNo); sidepots++; }
  if (v.handNo !== lastHand) { lastHand = v.handNo; hands++; lastProgress = Date.now(); }
  if (v.me && !sock.pending) {
    sock.pending = true;
    setImmediate(() => {
      sock.pending = false;
      const me = v.me, r = Math.random();
      let msg;
      if (r < 0.12) msg = { action: 'fold' };
      else if (r < 0.55) msg = { action: me.canCheck ? 'check' : 'call' };
      else if (me.canRaise) {
        const span = me.maxTo - me.minTo;
        const amt = r > 0.93 ? me.maxTo : me.minTo + Math.floor(Math.random() * Math.min(span, 200));
        msg = { action: 'raise', amount: amt };
      } else msg = { action: me.canCheck ? 'check' : 'call' };
      sock.h['poker:act'](msg, (res) => { if (!res.ok) { problems.push('acao recusada: ' + res.error + ' ' + JSON.stringify(msg) + ' ' + JSON.stringify(me)); sock.h['poker:act']({ action: me.canCheck ? 'check' : 'fold' }, () => {}); } });
    });
  }
}
const poker = createPoker(io, { nickOf: id => nicks.get(id), isAdmin: () => true }, { TURN_MS: 2000, AWAY_TURN_MS: 2000, NEXT_HAND_MS: 1, RUNOUT_MS: 1 });
for (const b of bots) poker.handle(b);
bots.forEach((b, i) => b.h['poker:sit'](i * 2 % 9, () => {}));
const iv = setInterval(() => {
  const busted = Date.now() - lastProgress > 3000;
  if (hands >= 400 || busted || problems.length > 5) {
    clearInterval(iv);
    console.log(N + ' jogadores: ' + hands + ' maos, ' + showdowns + ' showdowns, ' + sidepots + ' side pots, ' + rebuys + ' recompras' + (busted ? ' (parou: so sobrou 1 com fichas ou travou)' : ''));
    console.log('problemas:', problems.slice(0, 5));
    process.exit(0);
  }
}, 200);

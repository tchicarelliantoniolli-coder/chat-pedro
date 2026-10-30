// Correcoes da varredura de bugs: o servidor nao cai com pedido malfeito; trocar de apelido leva junto
// os votos das enquetes e o "vou" dos eventos.
const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1366, height: 700 } }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); return p; };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };
  const P = await mk(); await signup(P, 'a@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1500);
  // pedidos malfeitos de proposito: antes um deles derrubava o site inteiro
  await P.evaluate(() => { const s = window.ChatPedro.socket; for (const ev of ['channel:create', 'role:save', 'emoji:add', 'sticker:add', 'blefe:sit', 'thread:create']) for (const v of [{ name: { toString: 1 } }, null, 5, [], { seat: 0 }]) s.emit(ev, v, () => {}); });
  await P.waitForTimeout(800);
  ok(await fetch(URL + '/api/config').then((r) => r.ok).catch(() => false), 'servidor continua no ar depois de pedidos malfeitos');
  // enquete e evento, depois troca de apelido
  await P.evaluate(() => { const s = window.ChatPedro.socket; s.emit('poll:create', { q: 'Pizza?', options: ['sim', 'não'], ch: 'chat' }); s.emit('event:create', { title: 'Jogatina', when: new Date(Date.now() + 86400000).toISOString() }); });
  await P.waitForTimeout(600);
  const pollId = await P.evaluate(() => new Promise((r) => window.ChatPedro.socket.emit('channel:open', 'chat', (h) => r((h.find((m) => m.type === 'poll') || {}).id))));
  await P.evaluate((id) => window.ChatPedro.socket.emit('poll:vote', { id, idx: 0 }), pollId); await P.waitForTimeout(400);
  await P.evaluate(() => window.ChatPedro.socket.emit('profile', {}));
  await P.evaluate(() => window.ChatPedro.socket.emit('profile', {}));
  await P.evaluate(() => window.ChatPedroAuth.updateProfile({ nick: 'PedroNovo' })); await P.waitForTimeout(1200);
  const poll = await P.evaluate(() => new Promise((r) => window.ChatPedro.socket.emit('channel:open', 'chat', (h) => r(h.find((m) => m.type === 'poll').poll))));
  ok(poll.options[0].votes.join() === 'PedroNovo', 'voto da enquete passa para o apelido novo: ' + JSON.stringify(poll.options[0].votes));
  await P.evaluate((id) => window.ChatPedro.socket.emit('poll:vote', { id, idx: 0 }), pollId); await P.waitForTimeout(400);
  const poll2 = await P.evaluate(() => new Promise((r) => window.ChatPedro.socket.emit('channel:open', 'chat', (h) => r(h.find((m) => m.type === 'poll').poll))));
  ok(poll2.options[0].votes.length === 0, 'votar de novo tira o voto (nao conta dobrado)');
  await P.click('#eventsBtn'); await P.waitForTimeout(400);
  ok((await P.textContent('body')).includes('PedroNovo'), 'evento mostra o apelido novo de quem vai');
  console.log('erros:', errs); await b.close();
})().catch(e => { console.error(e); process.exit(1); });

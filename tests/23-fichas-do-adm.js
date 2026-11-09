// Poker: so o ADM (dono do servidor) muda as fichas de alguem. Clicar nas fichas do lugar abre um campo,
// escreve o valor e Enter salva. Quem nao e ADM ve as fichas como texto e o servidor recusa o pedido.
const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('ERRO ' + name + ': ' + e.message.split('\n')[0]); } };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1366, height: 768 } }); const p = await c.newPage(); p.setDefaultTimeout(10000); p.on('pageerror', e => errs.push(e.stack)); return p; };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };
  const seatOf = (p, nick) => p.locator('#activity .seat', { has: p.locator('.nm', { hasText: nick }) });

  const P = await mk(); await signup(P, 'p@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1500);
  await P.click('#srvBtn'); await P.click('#invMake'); await P.waitForTimeout(300); const link = await P.inputValue('#invLink'); await P.click('#srvClose');
  const L = await mk(); await signup(L, 'l@t.com', 'Lucas'); await L.goto(link); await L.waitForTimeout(800); await L.click('#invAccept'); await L.waitForTimeout(1500);

  await P.click('#actOpen'); await L.click('#actOpen'); await P.waitForTimeout(300);
  await L.click('#activity .seat.empty button >> nth=0'); await L.waitForTimeout(500);

  await step('quem nao e ADM', async () => {
    ok(await L.locator('#activity .seat button.ch').count() === 0, 'para quem nao e ADM as fichas sao so texto');
    const r = await L.evaluate(() => new Promise((res) => window.ChatPedro.socket.emit('poker:setchips', { seat: 0, chips: 999999 }, res)).catch((e) => ({ ok: false, error: String(e) })));
    ok(r && r.ok === false, 'o servidor recusa quem nao e ADM mudar fichas (' + (r && r.error) + ')');
  });

  await step('ADM muda as fichas', async () => {
    const chip = seatOf(P, 'Lucas').locator('button.ch');
    ok(await chip.count() === 1, 'para o ADM as fichas do Lucas sao um botao');
    await chip.click();
    const inp = seatOf(P, 'Lucas').locator('input.ch');
    ok(await inp.count() === 1, 'clicar nas fichas abre o campo para escrever');
    await P.screenshot({ path: SP + '/23-editando.png' });
    await inp.fill('5000'); await inp.press('Enter'); await P.waitForTimeout(500);
    ok((await seatOf(L, 'Lucas').locator('.ch').textContent()).replace(/\D/g, '') === '5000', 'Enter salva: Lucas ve 5.000 fichas');
    ok(await L.locator('#dealerlog', { hasText: 'O ADM mudou as fichas de Lucas para 5.000' }).count() === 1, 'historico avisa a mudanca');
    await seatOf(P, 'Lucas').locator('button.ch').click();
    await seatOf(P, 'Lucas').locator('input.ch').fill('1'); await seatOf(P, 'Lucas').locator('input.ch').press('Escape'); await P.waitForTimeout(400);
    ok((await seatOf(L, 'Lucas').locator('.ch').textContent()).replace(/\D/g, '') === '5000', 'Esc cancela sem mudar');
    await seatOf(P, 'Lucas').locator('button.ch').click();
    await seatOf(P, 'Lucas').locator('input.ch').fill('0'); await seatOf(P, 'Lucas').locator('input.ch').press('Enter'); await P.waitForTimeout(400);
    ok((await seatOf(L, 'Lucas').locator('.ch').textContent()).replace(/\D/g, '') === '0', 'ADM pode zerar');
    await seatOf(P, 'Lucas').locator('button.ch').click();
    await seatOf(P, 'Lucas').locator('input.ch').fill('2500'); await seatOf(P, 'Lucas').locator('input.ch').press('Enter'); await P.waitForTimeout(400);
    ok((await seatOf(L, 'Lucas').locator('.ch').textContent()).replace(/\D/g, '') === '2500', 'e dar fichas de volta para quem perdeu tudo');
  });

  console.log('erros: ' + JSON.stringify(errs));
  await b.close();
})();

const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errs = [];
  const mk = async (w, h, touch) => { const c = await b.newContext({ viewport: { width: w, height: h }, permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write'], hasTouch: !!touch, isMobile: !!touch }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push('console: ' + m.text()); }); return p; };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };
  const send = async (p, t) => { await p.fill('#input', t); await p.press('#input', 'Enter'); await p.waitForTimeout(200); };
  const P = await mk(1366, 650);
  await signup(P, 'p@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1500);
  await P.click('#srvBtn'); await P.click('#invMake'); await P.waitForTimeout(400); const link = await P.inputValue('#invLink');
  await P.click('#invCopy'); await P.waitForTimeout(200);
  ok(await P.locator('#invCopy svg').count() === 1, 'botao copiar continua com icone');
  await P.fill('#srvNameInput', 'Galera Nova'); await P.click('#srvRename button'); await P.waitForTimeout(600);
  ok((await P.textContent('#serverName')) === 'Galera Nova', 'renomear servidor'); await P.click('#srvClose');
  const L = await mk(1366, 650); await signup(L, 'l@t.com', 'Lucas'); await L.goto(link); await L.waitForTimeout(800); await L.click('#invAccept'); await L.waitForTimeout(1500);
  // foto
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await P.setInputFiles('#file', { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }); await P.waitForTimeout(800);
  ok(await L.locator('.pic img.ok').count() === 1, 'foto ao vivo chega');
  await send(L, 'oi pedro'); await send(P, 'oi lucas');
  await L.locator('#log .line.msg', { hasText: 'oi lucas' }).hover(); await L.click('#log .line.msg:has-text("oi lucas") button[aria-label="Reagir"]'); await L.locator('.picker button').first().click(); await P.waitForTimeout(400);
  // recarregar: historico com foto sob demanda
  await L.reload(); await L.waitForTimeout(2000);
  ok(await L.locator('.pic img.ok').count() === 1, 'foto do historico carrega sob demanda');
  ok(await L.locator('.rx.mine').count() === 1, 'minha reacao continua minha depois de recarregar');
  // trocar apelido: reacao segue
  await L.click('#upSet'); await L.click('#usNickEdit'); await L.fill('#nickInput', 'Lukinhas'); await L.click('#nickForm button'); await L.waitForTimeout(800); await L.click('#usClose'); await L.waitForTimeout(300);
  ok(await L.locator('.rx.mine').count() === 1, 'reacao continua minha depois de trocar o apelido');
  ok(await P.locator('#people', { hasText: 'Lukinhas' }).count() === 1, 'outros veem o apelido novo');
  // titulo com nao lidas
  await P.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
  await send(L, 'ta ai?'); await P.waitForTimeout(400);
  ok(/^\(1\)/.test(await P.title()), 'titulo mostra nao lidas: ' + await P.title());
  await P.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  ok(!/^\(/.test(await P.title()), 'titulo limpa ao voltar');
  // call: clique duplo nao entra duas vezes
  await P.click('.chan.voice[data-voice]'); await P.click('.chan.voice[data-voice]', { force: true }); await P.waitForTimeout(1200);
  ok((await P.locator('.vpeople li').count()) === 1, 'entrar na call uma vez so: ' + '');
  await P.click('#vpLeave'); await P.waitForTimeout(400);
  // tooltip
  await P.hover('#pinsBtn'); await P.waitForTimeout(250);
  ok(await P.isVisible('#tip') && (await P.textContent('#tip')).startsWith('Mensagens fixadas'), 'dica no icone');
  // celular: acoes da mensagem
  const M = await mk(390, 800, true); await signup(M, 'm@t.com', 'Celular'); await M.goto(link); await M.waitForTimeout(800); await M.click('#invAccept'); await M.waitForTimeout(1500);
  await M.locator('#log .line.msg', { hasText: 'oi lucas' }).tap(); await M.waitForTimeout(300);
  const box = await M.locator('#log .line.msg:has-text("oi lucas") .acts').boundingBox();
  ok(box && box.x > 40, 'acoes no celular ficam embaixo do texto (x=' + (box && Math.round(box.x)) + ')');
  await M.screenshot({ path: SP + '/x-mobile.png' });
  // expulsar
  await P.click('#srvBtn'); await P.click('#srvMod'); await P.waitForTimeout(400);
  const row = P.locator('#modUsers .row', { hasText: 'Celular' });
  await row.locator('button', { hasText: 'Expulsar' }).click(); await row.locator('button', { hasText: 'Certeza?' }).click(); await P.waitForTimeout(1200);
  ok(await M.isVisible('#gHome'), 'expulso volta para a tela inicial');
  await P.click('#admClose');
  await P.screenshot({ path: SP + '/x-desk.png' });
  console.log('erros:', errs); await b.close();
})().catch(e => { console.error(e); process.exit(1); });

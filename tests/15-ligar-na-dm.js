// Ligar na conversa privada (como no Discord): toca para a outra pessoa em qualquer pagina,
// janelinha "Chamada recebida...", Ignorar, Tocar novamente, atender de outra pagina e a mensagem da chamada.
const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('ERRO ' + name + ': ' + e.message.split('\n')[0]); } };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errs = [];
  const mk = async () => {
    const c = await b.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['microphone', 'camera'] });
    // conta as notas tocadas (os toques sao feitos no navegador)
    await c.addInitScript(() => { window.__notes = 0; const o = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function () { window.__notes++; return o.call(this); }; });
    const p = await c.newPage(); p.setDefaultTimeout(8000); p.on('pageerror', e => errs.push(e.stack)); return p;
  };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };
  const notes = (p) => p.evaluate(() => window.__notes);
  const P = await mk(); await signup(P, 'p@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1300);
  await P.click('#srvBtn'); await P.click('#invMake'); await P.waitForTimeout(300); const link = await P.inputValue('#invLink'); await P.click('#srvClose');
  const L = await mk(); await signup(L, 'l@t.com', 'Lucas'); await L.goto(link); await L.waitForTimeout(800); await L.click('#invAccept'); await L.waitForTimeout(1300);
  const galera = L.url();
  // Pedro abre a conversa com o Lucas; o Lucas continua no servidor
  await P.locator('#people li', { hasText: 'Lucas' }).click(); await P.waitForTimeout(300);
  await P.locator('#popout button', { hasText: 'Mandar mensagem' }).click(); await P.waitForTimeout(2500);
  const dmUrl = P.url();

  await step('liga', async () => {
    const n0 = await notes(L), m0 = await notes(P);
    await P.click('#dmCallBtn'); await P.waitForTimeout(1500);
    ok(await L.locator('.ringpop .rpt', { hasText: 'Pedro' }).count() === 1, 'janelinha de chamada aparece para quem está em outro servidor');
    ok(await L.locator('.ringpop .rps', { hasText: 'Chamada recebida...' }).count() === 1, 'texto "Chamada recebida..."');
    ok(await L.locator('.ringpop .rpav.ringin').count() === 1, 'foto com o anel pulsando');
    ok(await L.locator('.ringpop .rpb').count() === 2, 'chamada de voz: Ignorar e Juntar-se à chamada');
    ok(await notes(L) > n0, 'o toque de chamada recebida está tocando');
    ok(await P.locator('#tiles .tile.ghost.ringing').count() === 1, 'quem ligou vê a outra pessoa apagada e pulsando');
    ok(await notes(P) > m0, 'quem ligou ouve o "chamando"');
    await L.screenshot({ path: SP + '/r-recebendo.png' });
    await P.screenshot({ path: SP + '/r-chamando.png' });
    await L.locator('.ringpop .rpb[aria-label="Ignorar"]').click(); await P.waitForTimeout(800);
    ok(await L.locator('.ringpop').count() === 0, 'Ignorar fecha a janelinha');
    ok(await P.locator('#tiles .tile.ghost:not(.ringing)').count() === 1, 'depois de ignorar a foto para de pulsar');
    const n1 = await notes(L); await L.waitForTimeout(1500);
    ok(await notes(L) === n1, 'o toque para depois de ignorar');
    await P.locator('#tiles .tile.ghost').click(); await L.waitForTimeout(1000);
    ok(await L.locator('.ringpop').count() === 1, '"Tocar novamente" liga de novo');
    await L.keyboard.press('Escape'); await L.waitForTimeout(500);
    ok(await L.locator('.ringpop').count() === 0, 'Esc recusa a chamada');
    await P.locator('#tiles .tile.ghost').click(); await L.waitForTimeout(1000);
    // atender de outra pagina: abre a conversa ja entrando na chamada
    await L.locator('.ringpop .rpb[aria-label="Juntar-se à chamada"]').click();
    await L.waitForURL(/\/s\//); await L.waitForTimeout(3500);
    ok(L.url().split('?')[0] === dmUrl.split('?')[0], 'atender abre a conversa');
    ok(await L.isVisible('#call') && await L.locator('#tiles .tile:not(.ghost)').count() === 2, 'atender entra na chamada');
    ok(await P.locator('#tiles .tile.ghost').count() === 0, 'quem atendeu deixa de aparecer apagado');
    await L.click('#leaveBtn'); await P.click('#leaveBtn'); await P.waitForTimeout(800);
    ok(await P.locator('.line.calll.ended', { hasText: 'Pedro iniciou uma chamada que durou' }).count() === 1, 'mensagem "iniciou uma chamada que durou..."');
  });

  await step('perdida', async () => {
    // agora o Lucas esta dentro da conversa: a chamada aparece no lugar da call
    await P.click('#dmVideoBtn'); await L.waitForTimeout(1500);
    ok(await L.isVisible('#ringBar') && await L.locator('#rbText', { hasText: 'Chamada de vídeo recebida...' }).count() === 1, 'na própria conversa aparece a chamada recebida (de vídeo)');
    ok(await L.locator('.ringpop').count() === 0, 'sem janelinha dentro da própria conversa');
    await L.screenshot({ path: SP + '/r-na-conversa.png' });
    await P.click('#leaveBtn'); await L.waitForTimeout(1000);
    ok(!(await L.isVisible('#ringBar')), 'quem ligou desistiu: para de tocar');
    ok(await L.locator('.line.calll.missed', { hasText: 'Você perdeu uma chamada de Pedro' }).count() === 1, 'mensagem "Você perdeu uma chamada"');
    await L.screenshot({ path: SP + '/r-perdida.png' });
  });

  await step('video', async () => {
    await L.goto(galera); await L.waitForTimeout(2000);
    await P.click('#dmVideoBtn'); await L.waitForTimeout(1500);
    ok(await L.locator('.ringpop .rps', { hasText: 'Chamada de vídeo recebida...' }).count() === 1 && await L.locator('.ringpop .rpb').count() === 3, 'chamada de vídeo: três botões');
    await L.locator('.ringpop .rpb[aria-label="Entrar na chamada de vídeo"]').click();
    await L.waitForURL(/\/s\//); await L.waitForTimeout(4000);
    ok(await L.locator('#tiles video').count() >= 1 && await L.locator('#camBtn.on').count() === 1, 'atender com vídeo liga a câmera');
    await L.click('#leaveBtn'); await P.click('#leaveBtn');
  });
  console.log('erros:', errs.map((e) => e.split('\n').slice(0, 3).join(' | '))); await b.close(); process.exit(0);
})().catch(e => { console.error(e.message.split('\n')[0]); process.exit(1); });

const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('ERRO ' + name + ': ' + e.message.split('\n')[0]); } };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errs = [];
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['microphone', 'camera'] }); const p = await c.newPage(); p.setDefaultTimeout(8000); p.on('pageerror', e => errs.push(e.stack)); return p; };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };
  const P = await mk(); await signup(P, 'p@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1300);
  await P.click('#srvBtn'); await P.click('#invMake'); await P.waitForTimeout(300); const link = await P.inputValue('#invLink'); await P.click('#srvClose');
  const L = await mk(); await signup(L, 'l@t.com', 'Lucas'); await L.goto(link); await L.waitForTimeout(800); await L.click('#invAccept'); await L.waitForTimeout(1300);

  await step('call', async () => {
    await P.locator('.chan.voice').first().click(); await P.waitForTimeout(1500);
    await L.locator('.chan.voice').first().click(); await L.waitForTimeout(2000);
    ok(await P.locator('#tiles.avmode .tile').count() === 2, 'sem câmera: só as fotos redondas na call');
    ok(await P.locator('#meStatus.incall', { hasText: 'Em uma chamada' }).count() === 1, 'painel do usuário mostra "Em uma chamada"');
    await L.click('#micBtn'); await P.waitForTimeout(600);
    ok(await P.locator('#tiles .tile .mbadge').count() === 1, 'quem está mudo ganha a bolinha vermelha');
    ok(await L.locator('.cpair.off #micBtn').count() === 1, 'botão do microfone fica vermelho na barra da call');
    await P.click('#vpCam'); await P.waitForTimeout(1500);
    ok(await P.locator('#tiles:not(.avmode) video').count() >= 1 && await P.locator('#vpCam.on').count() === 1, 'câmera pelo painel "Voz conectada"');
    await P.screenshot({ path: SP + '/c-call.png' });
    await P.click('#vpCam'); await P.waitForTimeout(300);
    await P.click('#moreBtn'); ok(await P.locator('#ctxMenu .mitem', { hasText: 'Configurações de voz' }).count() === 1, 'menu "..." da call');
    await P.keyboard.press('Escape');
    await P.click('#vpAct'); ok(await P.locator('#ctxMenu .mitem', { hasText: 'Truco' }).count() === 1, 'botão Atividades do painel');
    await P.keyboard.press('Escape');
    await P.click('#leaveBtn'); await L.click('#leaveBtn'); await P.waitForTimeout(500);
  });
  await step('dm', async () => {
    await P.locator('#people li', { hasText: 'Lucas' }).click(); await P.waitForTimeout(300);
    await P.locator('#popout button', { hasText: 'Mandar mensagem' }).click(); await P.waitForTimeout(2500);
    ok(await P.locator('#dmIntro .t', { hasText: 'Lucas' }).count() === 1, 'DM começa com o perfil da pessoa');
    ok(await P.locator('#dmList .dmrow.on', { hasText: 'Lucas' }).count() === 1, 'coluna da esquerda lista as conversas');
    ok(await P.locator('#people .dmprof .pname', { hasText: 'Lucas' }).count() === 1, 'coluna da direita mostra o perfil');
    await P.click('#dmCallBtn'); await P.waitForTimeout(1500);
    ok(await P.isVisible('#call') && await P.isVisible('#voicePanel'), 'botão de ligar do topo começa a chamada');
    await P.screenshot({ path: SP + '/c-dm.png' });
    await P.click('#leaveBtn');
  });
  console.log('erros:', errs.map((e) => e.split('\n').slice(0, 3).join(' | '))); await b.close(); process.exit(0);
})().catch(e => { console.error(e.message.split('\n')[0]); process.exit(1); });

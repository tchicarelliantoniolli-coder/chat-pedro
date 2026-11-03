// Trocar de servidor como no Discord: a pagina NAO recarrega (a barra fica parada e so o meio muda), o endereco
// muda e o botao "voltar" do navegador funciona, e quem esta na call CONTINUA na call enquanto olha outro servidor.
const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('ERRO ' + name + ': ' + e.message.split('\n')[0]); } };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errs = [];
  const mk = async () => {
    const c = await b.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['microphone', 'camera'] }); const p = await c.newPage();
    p.setDefaultTimeout(10000); p.on('pageerror', e => errs.push(e.stack));
    // guarda as conexoes de audio da call para conferir que nao foram refeitas
    await p.addInitScript(() => { const R = window.RTCPeerConnection; window.__pcs = []; window.RTCPeerConnection = function (...a) { const pc = new R(...a); window.__pcs.push(pc); return pc; }; window.RTCPeerConnection.prototype = R.prototype; });
    return p;
  };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };
  const send = async (p, t) => { await p.fill('#input', t); await p.press('#input', 'Enter'); await p.waitForTimeout(400); };
  const rail = (p, name) => p.locator('#rail button.srv[aria-label="' + name + '"]');
  const hasMsg = (p, t) => p.locator('#log .txt', { hasText: t }).count();

  const P = await mk(); await signup(P, 'p@t.com', 'Pedro');
  await P.fill('#createName', 'Servidor A'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1500);
  const idA = await P.evaluate(() => location.pathname.split('/').pop());
  await send(P, 'mensagem no A');
  await P.click('#srvBtn'); await P.click('#invMake'); await P.waitForTimeout(300); const link = await P.inputValue('#invLink'); await P.click('#srvClose');
  const L = await mk(); await signup(L, 'l@t.com', 'Lucas'); await L.goto(link); await L.waitForTimeout(800); await L.click('#invAccept'); await L.waitForTimeout(1500);
  const idB = await P.evaluate(() => window.ChatPedroAuth.api('/api/servers', { method: 'POST', body: { name: 'Servidor B' } }).then((r) => r.server.id));
  await P.goto(URL + '/s/' + idB); await P.waitForTimeout(1500);
  await send(P, 'mensagem no B');
  await P.goto(URL + '/s/' + idA); await P.waitForTimeout(1500);

  await step('trocar sem recarregar', async () => {
    await P.evaluate(() => { window.__semRecarregar = true; });
    const t0 = Date.now();
    await rail(P, 'Servidor B').click();
    await P.locator('#log .txt', { hasText: 'mensagem no B' }).waitFor();
    const ms = Date.now() - t0;
    ok(await P.evaluate(() => window.__semRecarregar === true), 'trocar de servidor nao recarrega a pagina');
    ok(P.url().endsWith('/s/' + idB), 'o endereco muda para o servidor novo');
    ok(await hasMsg(P, 'mensagem no A') === 0 && await hasMsg(P, 'mensagem no B') === 1, 'o chat mostra so as mensagens do servidor novo (' + ms + ' ms)');
    ok(await P.textContent('#serverName') === 'Servidor B', 'nome do servidor no topo da barra de canais');
    ok(await P.locator('#rail button.srv.on[aria-label="Servidor B"]').count() === 1, 'icone do servidor novo fica marcado na barra');
    ok(!(await P.isVisible('#gate')), 'sem tela de carregamento no meio da troca');
    await send(P, 'outra no B');
    ok(await L.locator('#log .txt', { hasText: 'outra no B' }).count() === 0, 'mensagem enviada depois da troca vai para o servidor novo (quem esta no A nao recebe)');
    ok(await P.locator('#people li', { hasText: 'Lucas' }).count() === 0, 'lista de membros e do servidor novo');
    // voltar do navegador
    await P.goBack(); await P.locator('#log .txt', { hasText: 'mensagem no A' }).waitFor();
    ok(await P.evaluate(() => window.__semRecarregar === true) && P.url().endsWith('/s/' + idA) && await hasMsg(P, 'mensagem no B') === 0, 'botao voltar do navegador volta para o servidor anterior sem recarregar');
    ok(await P.locator('#people li', { hasText: 'Lucas' }).count() === 1, 'membros do servidor A de volta');
    await send(P, 'de volta no A'); await L.waitForTimeout(500);
    ok(await L.locator('#log .txt', { hasText: 'de volta no A' }).count() === 1, 'mensagem depois de voltar chega para quem esta no A');
  });

  await step('call continua', async () => {
    await P.locator('.chan.voice').first().click(); await P.waitForTimeout(1500);
    await L.locator('.chan.voice').first().click(); await L.waitForTimeout(3000);
    const pcOk = (p) => p.evaluate(() => window.__pcs.filter((pc) => pc.connectionState === 'connected').length);
    ok(await pcOk(P) === 1 && await L.locator('#tiles .tile').count() === 2, 'os dois na call do A');
    const before = await P.evaluate(() => window.__pcs.length);
    await rail(P, 'Servidor B').click(); await P.locator('#log .txt', { hasText: 'mensagem no B' }).waitFor(); await P.waitForTimeout(2000);
    ok(await P.evaluate(() => window.ChatPedro.inCall()), 'olhando o servidor B, continua na call do A');
    ok(await P.evaluate((n) => window.__pcs.length === n, before) && await pcOk(P) === 1, 'a ligacao de audio nao caiu nem foi refeita');
    ok(await L.locator('#tiles .tile').count() === 2, 'quem ficou no A continua vendo a pessoa na call');
    ok(await P.isVisible('#voicePanel') && (await P.textContent('#vpWhere')).includes('Servidor A'), 'painel "Voz conectada" mostra o servidor da call');
    ok(!(await P.isVisible('#tiles')), 'a tela da call fica no servidor dela (no B mostra o chat)');
    ok(await P.locator('.vpeople li').count() === 0, 'canal de voz do B nao mostra quem esta na call do A');
    await P.screenshot({ path: SP + '/troca-call.png' });
    await P.click('#vpWhere'); await P.locator('#log .txt', { hasText: 'mensagem no A' }).waitFor(); await P.waitForTimeout(800);
    ok(P.url().endsWith('/s/' + idA) && await P.isVisible('#tiles') && await P.locator('#tiles .tile').count() === 2, 'clicar no "Voz conectada" volta para o servidor da call com a call na tela');
    ok(await pcOk(P) === 1 && await P.evaluate((n) => window.__pcs.length === n, before), 'continua a mesma ligacao de audio');
    await P.click('#vpLeave'); await P.waitForTimeout(1200);
    ok(await L.locator('#tiles .tile').count() === 1 && !(await P.evaluate(() => window.ChatPedro.inCall())), 'desconectar sai da call');
  });

  await step('call em outro servidor', async () => {
    // na call do A, entra no canal de voz do B: sai do A e entra no B (como no Discord)
    await P.locator('.chan.voice').first().click(); await P.waitForTimeout(1500);
    await rail(P, 'Servidor B').click(); await P.locator('#log .txt', { hasText: 'mensagem no B' }).waitFor(); await P.waitForTimeout(500);
    await P.locator('.chan.voice').first().click(); await P.waitForTimeout(2000);
    ok(await P.isVisible('#tiles') && (await P.textContent('#vpWhere')).includes('Servidor B'), 'entrar em canal de voz de outro servidor troca a call');
    ok(await L.locator('.vpeople li').count() === 1, 'no A so ficou quem nao saiu');
    await P.click('#vpLeave'); await P.waitForTimeout(500);
  });

  console.log('erros:', errs); await b.close();
})().catch(e => { console.error(e); process.exit(1); });

const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('ERRO ' + name + ': ' + e.message.split('\n')[0]); } };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errs = [];
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1440, height: 860 }, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] }); const p = await c.newPage(); p.setDefaultTimeout(6000); p.on('pageerror', e => errs.push(e.stack)); p.on('dialog', d => d.accept('')); return p; };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };
  const send = async (p, t) => { await p.fill('#input', t); await p.press('#input', 'Enter'); await p.waitForTimeout(350); };
  const P = await mk(); await signup(P, 'p@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1300);
  await P.click('#srvBtn'); await P.click('#invMake'); await P.waitForTimeout(300); const link = await P.inputValue('#invLink'); await P.click('#srvClose');
  const L = await mk(); await signup(L, 'l@t.com', 'Lucas'); await L.goto(link); await L.waitForTimeout(800); await L.click('#invAccept'); await L.waitForTimeout(1300);

  await step('painel do usuario', async () => {
    await P.screenshot({ path: SP + '/u-painel.png', clip: { x: 0, y: 760, width: 360, height: 100 } });
    await P.click('#upMic'); await P.waitForTimeout(200);
    ok(await P.locator('.agrp.off #upMic').count() === 1, 'mutar deixa o botão do microfone vermelho');
    await P.click('#upDeaf'); await P.waitForTimeout(200);
    ok(await P.locator('.agrp.off #upDeaf').count() === 1, 'desativar áudio deixa o botão do fone vermelho');
    await P.screenshot({ path: SP + '/u-painel-mudo.png', clip: { x: 0, y: 760, width: 360, height: 100 } });
    await P.click('#upDeaf'); await P.click('#upMic'); await P.waitForTimeout(200);
    await P.click('#upMicMenu'); await P.waitForTimeout(600);
    ok(await P.locator('#upPop .uitem', { hasText: 'Dispositivo de entrada' }).count() === 1, 'setinha do microfone abre o menu de entrada');
    ok(await P.locator('#upPop .uslider', { hasText: 'Volume de entrada' }).count() === 1, 'menu de entrada tem o volume');
    await P.screenshot({ path: SP + '/u-menu-mic.png' });
    await P.locator('#upPop .uitem', { hasText: 'Configurações de voz' }).click(); await P.waitForTimeout(400);
    ok(await P.isVisible('#settings'), 'Configurações de voz abre a página Voz e vídeo');
    await P.click('#usClose'); await P.waitForTimeout(300);
    await P.click('#upDeafMenu'); await P.waitForTimeout(600);
    ok(await P.locator('#upPop .uslider', { hasText: 'Volume de saída' }).count() === 1, 'setinha do fone abre o menu de saída');
    await P.keyboard.press('Escape'); await P.waitForTimeout(200);
    ok(await P.locator('#upPop').isHidden(), 'ESC fecha o menu');
  });

  await step('cartao da conta', async () => {
    await P.click('#profileBtn'); await P.waitForTimeout(300);
    ok(await P.locator('#upPop .pname', { hasText: 'Pedro' }).count() === 1, 'clicar no nome abre o cartão da conta');
    await P.screenshot({ path: SP + '/u-cartao.png' });
    await P.locator('#upPop .uitem.hassub').click();
    await P.locator('#upPop .ustatus .uitem', { hasText: 'Não perturbe' }).click(); await P.waitForTimeout(500);
    ok(await P.locator('#meAv.ocupado').count() === 1, 'trocar o status pelo cartão');
    await P.click('#profileBtn'); await P.locator('#upPop .uitem', { hasText: 'Editar perfil' }).click(); await P.waitForTimeout(300);
    ok(await P.isVisible('.us-page[data-page=perfis]'), 'Editar perfil abre Perfis');
  });

  await step('configuracoes', async () => {
    await P.fill('#bioInput', 'Sou o Pedro'); await P.waitForTimeout(100);
    ok(await P.locator('#usCard .pbio', { hasText: 'Sou o Pedro' }).count() === 1, 'prévia do perfil muda enquanto escreve');
    await P.screenshot({ path: SP + '/u-perfis.png' });
    await P.click('#usTabs [data-page=conta]'); await P.waitForTimeout(200);
    ok(!(await P.textContent('#profEmail')).includes('p@t.com'), 'e-mail fica escondido');
    await P.click('#usEmailShow');
    ok((await P.textContent('#profEmail')).includes('p@t.com'), 'Mostrar revela o e-mail');
    await P.screenshot({ path: SP + '/u-conta.png' });
    await P.fill('#usSearch', 'compacto'); await P.waitForTimeout(100);
    ok(await P.locator('#usTabs .gs-tab[data-page=aparencia]').isVisible() && await P.locator('#usTabs .gs-tab[data-page=conta]').isHidden(), 'pesquisa filtra as seções');
    await P.fill('#usSearch', '');
    await P.click('#usTabs [data-page=aparencia]');
    await P.locator('.us-radio[data-pref=compact] input[value=on]').check(); await P.waitForTimeout(100);
    ok(await P.evaluate(() => document.body.classList.contains('compact')), 'modo compacto');
    await P.screenshot({ path: SP + '/u-aparencia.png' });
    await P.click('#usTabs [data-page=voz]'); await P.waitForTimeout(800); await P.screenshot({ path: SP + '/u-voz.png' });
    await P.click('#usTabs [data-page=chat]');
    await P.locator('.gs-toggle', { hasText: 'Mostrar reações' }).locator('input').uncheck();
    ok(await P.evaluate(() => document.body.classList.contains('no-reactions')), 'esconder reações');
    await P.click('#usTabs [data-page=avancado]');
    await P.locator('.gs-toggle', { hasText: 'Modo desenvolvedor' }).locator('input').check();
    await P.click('#usTabs [data-page=atalhos]');
    ok(await P.locator('#usKeys kbd').count() > 3, 'lista de atalhos');
    await P.click('#usTabs [data-page=atividade]');
    await P.locator('.gs-toggle', { hasText: 'Compartilhar minha atividade' }).locator('input').uncheck();
    await P.keyboard.press('Escape'); await P.waitForTimeout(300);
    ok(await P.locator('#userSettings').isHidden(), 'ESC fecha as configurações');
    await P.reload(); await P.waitForTimeout(1500);
    ok(await P.evaluate(() => document.body.classList.contains('compact')), 'preferência continua depois de recarregar');
    await send(P, 'oi :)');
    ok(await P.locator('.line .txt', { hasText: '🙂' }).count() >= 1, 'emoticon vira emoji');
    await P.locator('.line.msg').last().click({ button: 'right' }); await P.waitForTimeout(200);
    ok(await P.locator('#ctxMenu .mitem', { hasText: 'Copiar ID da mensagem' }).count() === 1, 'modo desenvolvedor: copiar ID');
    await P.keyboard.press('Escape');
    await P.screenshot({ path: SP + '/u-compacto.png' });
  });

  await step('excluir conta', async () => {
    await L.click('#upSet'); await L.click('#usDelBtn'); await L.fill('#usDelPw', 'errada'); await L.click('#usDelForm button'); await L.waitForTimeout(600);
    ok((await L.textContent('#profMsg')).includes('Senha errada'), 'senha errada não exclui');
    await L.fill('#usDelPw', 'senha123'); await L.click('#usDelForm button'); await L.waitForTimeout(1500);
    ok(await L.isVisible('#gAuth'), 'conta excluída volta para o login');
    await P.waitForTimeout(500);
    ok(await P.locator('#people li', { hasText: 'Lucas' }).count() === 0, 'quem excluiu a conta sai da lista de membros');
    await P.click('#upSet'); await P.click('#usDelBtn'); await P.fill('#usDelPw', 'senha123'); await P.click('#usDelForm button'); await P.waitForTimeout(800);
    ok((await P.textContent('#profMsg')).includes('dono'), 'dono de servidor não consegue excluir a conta');
  });
  console.log('erros:', errs.map((e) => e.split('\n').slice(0, 3).join(' | '))); await b.close(); process.exit(0);
})().catch(e => { console.error(e.message.split('\n')[0]); process.exit(1); });

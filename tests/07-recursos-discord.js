const { chromium } = require('playwright');
const http = require('http');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('ERRO ' + name + ': ' + e.message.split('\n')[0]); } };
// pagina local para a previa de link
http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<html><head><title>x</title><meta property="og:title" content="Receita de bolo"><meta property="og:description" content="O melhor bolo de cenoura"><meta property="og:site_name" content="Cozinha"></head><body>oi</body></html>'); }).listen(3340);
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errs = [];
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1440, height: 860 }, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] }); const p = await c.newPage(); p.setDefaultTimeout(6000); p.on('pageerror', e => errs.push(e.stack)); p.on('dialog', d => d.accept(p._answer || '')); return p; };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };
  const send = async (p, t) => { await p.fill('#input', t); await p.press('#input', 'Enter'); await p.waitForTimeout(350); };
  const chan = (p, n) => p.locator('.chan.text', { hasText: n }).first();
  const P = await mk(); await signup(P, 'p@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1300);
  await P.click('#srvBtn'); await P.click('#invMake'); await P.waitForTimeout(300); const link = await P.inputValue('#invLink'); await P.click('#srvClose');
  const L = await mk(); await signup(L, 'l@t.com', 'Lucas'); await L.goto(link); await L.waitForTimeout(800); await L.click('#invAccept'); await L.waitForTimeout(1300);

  await step('cargos', async () => {
    await P.click('#srvBtn'); await P.click('#srvSettings'); await P.waitForTimeout(300);
    await P.locator('#guildModal .gs-tab', { hasText: 'Cargos' }).click();
    await P.locator('#gsBody button', { hasText: 'Criar cargo' }).click();
    await P.locator('#guildModal .gs-field input[type=text]').fill('Moderador');
    await P.locator('#guildModal .gs-perm', { hasText: 'Moderar membros' }).locator('input').check();
    await P.locator('#guildModal .gs-toggle input').check();
    await P.locator('#gsBody button', { hasText: 'Salvar alterações' }).click(); await P.waitForTimeout(500);
    await P.screenshot({ path: SP + '/g-roles.png' });
    ok(await P.locator('#guildModal .gs-rrow', { hasText: 'Moderador' }).count() === 1, 'criar cargo nas Configurações do servidor');
    await P.click('#gsClose');
    await P.locator('#people li', { hasText: 'Lucas' }).click(); await P.waitForTimeout(300);
    await P.locator('#popout .rpill.add').click(); await P.locator('#ctxMenu .mitem', { hasText: 'Moderador' }).click(); await P.waitForTimeout(600);
    ok(await L.locator('#people .grp', { hasText: 'Moderador' }).count() === 1, 'cargo separado aparece como grupo na lista de membros');
    const col = await L.locator('#people li', { hasText: 'Lucas' }).locator('.name').evaluate((e) => getComputedStyle(e).color);
    ok(col !== 'rgb(223, 223, 226)', 'nome pega a cor do cargo (' + col + ')');
    await L.click('#srvBtn'); await L.waitForTimeout(200);
    ok(await L.isVisible('#srvMod'), 'cargo com "Moderar membros" libera a moderação');
    await L.click('#srvClose');
  });
  await step('apelido no servidor', async () => {
    L._answer = 'Lukinhas';
    await L.locator('#people li', { hasText: 'Lucas' }).click(); await L.waitForTimeout(200);
    await L.locator('#popout button', { hasText: 'Mudar meu apelido aqui' }).click(); await L.waitForTimeout(600);
    ok(await P.locator('#people li', { hasText: 'Lukinhas' }).count() === 1, 'apelido no servidor aparece para todos');
  });
  await step('canal de anuncios', async () => {
    await P.click('.catadd[data-add="text"]'); await P.fill('#chanNameInput', 'avisos'); await P.check('#chanAnnounce'); await P.click('#chanSave'); await P.waitForTimeout(600);
    await chan(L, 'avisos').click(); await L.waitForTimeout(400);
    ok(await L.isVisible('#noPerm') && await L.isHidden('#form'), 'canal de anúncios: membro comum não pode escrever');
    await chan(P, 'avisos').click(); await P.waitForTimeout(300);
    ok(await P.isVisible('#form'), 'canal de anúncios: quem modera escreve');
    await chan(P, 'chat').click(); await chan(L, 'chat').click(); await P.waitForTimeout(300);
  });
  await step('topico', async () => {
    await send(P, 'vamos jogar sabado?');
    await P.locator('#log .line.msg', { hasText: 'vamos jogar sabado' }).click({ button: 'right' });
    await P.locator('#ctxMenu .mitem', { hasText: 'Criar tópico' }).click();
    await P.fill('#thName', 'Jogo de sabado'); await P.click('#thSave'); await P.waitForTimeout(700);
    ok((await P.textContent('#chanName')).includes('Jogo de sabado'), 'criar tópico a partir da mensagem abre o tópico');
    await send(P, 'eu levo o baralho');
    await L.waitForTimeout(400);
    ok(await L.locator('.thcard', { hasText: '1 mensagem' }).count() === 1, 'cartão do tópico embaixo da mensagem conta as respostas');
    ok(await L.locator('.chan.thread', { hasText: 'Jogo de sabado' }).count() === 1, 'tópico aparece embaixo do canal na barra');
    await L.locator('.thcard').click(); await L.waitForTimeout(500);
    ok(await L.locator('#log .txt', { hasText: 'eu levo o baralho' }).count() === 1, 'abrir o tópico mostra as mensagens dele');
    await L.screenshot({ path: SP + '/g-thread.png' });
    await chan(L, 'chat').click(); await chan(P, 'chat').click(); await P.waitForTimeout(300);
  });
  await step('forum', async () => {
    await P.click('.catadd[data-add="text"]'); await P.locator('#chanTypeRow button[data-type="forum"]').click(); await P.fill('#chanNameInput', 'ideias'); await P.click('#chanSave'); await P.waitForTimeout(600);
    await chan(P, 'ideias').click(); await P.waitForTimeout(300);
    await P.click('#forumNew'); await P.fill('#thName', 'Noite de filmes'); await P.fill('#thText', 'Que tal sexta?'); await P.click('#thSave'); await P.waitForTimeout(700);
    await chan(L, 'ideias').click(); await L.waitForTimeout(400);
    ok(await L.locator('.fpost', { hasText: 'Noite de filmes' }).count() === 1, 'fórum: post aparece como cartão');
    await L.screenshot({ path: SP + '/g-forum.png' });
    await L.locator('.fpost').click(); await L.waitForTimeout(500);
    ok(await L.locator('#log .txt', { hasText: 'Que tal sexta?' }).count() === 1, 'fórum: abrir o post mostra a conversa');
    await chan(L, 'chat').click(); await chan(P, 'chat').click(); await P.waitForTimeout(300);
  });
  await step('emoji do servidor', async () => {
    await P.click('#srvBtn'); await P.click('#srvSettings'); await P.locator('#guildModal .gs-tab', { hasText: 'Emojis' }).click();
    await P.locator('#gsBody input[type=text]').fill('pedro_ok');
    const [fc] = await Promise.all([P.waitForEvent('filechooser'), P.locator('#gsBody button', { hasText: 'Escolher imagem' }).click()]);
    await fc.setFiles(__dirname + '/fixtures/red.png'); await P.waitForTimeout(800);
    ok(await P.locator('#guildModal .gs-emoji', { hasText: 'pedro_ok' }).count() === 1, 'enviar emoji do servidor');
    await P.click('#gsClose');
    await send(P, 'top :pedro_ok:');
    ok(await L.locator('#log img.cemoji').count() >= 1, 'emoji do servidor aparece na mensagem (:pedro_ok:)');
  });
  await step('figurinha', async () => {
    await P.click('#srvBtn'); await P.click('#srvSettings'); await P.locator('#guildModal .gs-tab', { hasText: 'Figurinhas' }).click();
    await P.locator('#gsBody input[type=text]').fill('azulao');
    const [fc] = await Promise.all([P.waitForEvent('filechooser'), P.locator('#gsBody button', { hasText: 'Escolher imagem' }).click()]);
    await fc.setFiles(__dirname + '/fixtures/blue.png'); await P.waitForTimeout(800);
    await P.click('#gsClose');
    await L.click('#stickerBtn'); await L.waitForTimeout(300); await L.locator('.stkgrid button').first().click(); await L.waitForTimeout(800);
    ok(await P.locator('#log .stk img[src^="data:"]').count() === 1, 'mandar figurinha do servidor');
  });
  await step('webhook', async () => {
    await P.click('#srvBtn'); await P.click('#srvSettings'); await P.locator('#guildModal .gs-tab', { hasText: 'Integrações' }).click();
    await P.locator('#gsBody input[type=text]').fill('Robo'); await P.locator('#gsBody button', { hasText: 'Novo webhook' }).click(); await P.waitForTimeout(600);
    const url = await P.evaluate(() => new Promise((ok) => window.ChatPedro.socket.emit('webhook:list', (l) => ok(l[0].url))));
    await P.click('#gsClose');
    const r = await fetch(URL + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'alerta do robo' }) });
    await L.waitForTimeout(500);
    ok(r.status === 204 && await L.locator('#log .line.msg', { hasText: 'alerta do robo' }).locator('.bottag').count() === 1, 'webhook manda mensagem com a etiqueta APP');
  });
  await step('previa de link', async () => {
    await send(P, 'olha isso http://127.0.0.1:3340/bolo');
    await L.waitForTimeout(1500);
    ok(await L.locator('.embed', { hasText: 'Receita de bolo' }).count() === 1, 'prévia de link com título e descrição');
  });
  await step('responder com mencao', async () => {
    await L.locator('#log .line.msg', { hasText: 'olha isso' }).hover();
    await L.locator('#log .line.msg', { hasText: 'olha isso' }).locator('button[aria-label="Responder"]').click();
    ok(await L.isVisible('#replyPing'), 'botão "@ ATIVADO" ao responder');
    await send(L, 'muito bom');
    await P.waitForTimeout(400);
    ok(await P.locator('#log .line.mentioned', { hasText: 'muito bom' }).count() === 1, 'resposta com @ ativado menciona o autor');
  });
  await step('boas-vindas e link personalizado', async () => {
    await P.click('#srvBtn'); await P.click('#srvSettings'); await P.locator('#guildModal .gs-tab', { hasText: 'Tela de boas-vindas' }).click();
    await P.locator('#gsBody textarea').nth(0).fill('Servidor da galera'); await P.locator('#gsBody textarea').nth(1).fill('Respeite todo mundo\nNada de spam');
    await P.locator('#gsBody button', { hasText: 'Salvar' }).click(); await P.waitForTimeout(300);
    await P.locator('#guildModal .gs-tab', { hasText: 'Link personalizado' }).click();
    await P.locator('#gsBody input[type=text]').fill('galera'); await P.locator('#gsBody button', { hasText: 'Salvar' }).click(); await P.waitForTimeout(600);
    await P.locator('#guildModal .gs-tab', { hasText: 'Descobrir' }).click();
    await P.locator('#guildModal .gs-toggle input').check(); await P.locator('#gsBody textarea').fill('A melhor galera'); await P.locator('#gsBody button', { hasText: 'Salvar' }).click(); await P.waitForTimeout(500);
    await P.locator('#guildModal .gs-tab', { hasText: 'Visão geral' }).click();
    const [fc] = await Promise.all([P.waitForEvent('filechooser'), P.locator('#gsBody button', { hasText: 'Enviar banner' }).click()]);
    await fc.setFiles(__dirname + '/fixtures/blue.png'); await P.waitForTimeout(800);
    await P.click('#gsClose');
    ok(await L.locator('#srvBtn.hasbanner').count() === 1, 'banner do servidor aparece para todos');
  });
  const M = await mk();
  await step('entrar pelo link personalizado', async () => {
    await signup(M, 'm@t.com', 'Maria');
    await M.goto(URL + '/convite/galera'); await M.waitForTimeout(800); await M.click('#invAccept'); await M.waitForTimeout(1500);
    ok(await M.isVisible('#welcomeModal') && await M.locator('#welRules li').count() === 2, 'tela de boas-vindas com as regras para quem entra');
    await M.screenshot({ path: SP + '/g-welcome.png' });
    await M.click('#welOk');
    await P.waitForTimeout(300);
    ok(await P.locator('.line.joinl .wave').count() >= 1, 'mensagem de entrada com botão "Dar oi"');
    await P.locator('.line.joinl .wave').last().click(); await M.waitForTimeout(500);
    ok(await M.locator('#log .txt', { hasText: 'Oi, @Maria' }).count() === 1, 'dar oi manda 👋');
  });
  await step('amigos', async () => {
    await L.click('#railHome'); await L.waitForTimeout(300);
    await L.locator('#hTabs button[data-t="add"]').click();
    await L.locator('.faddrow input').fill('Pedro'); await L.locator('.faddrow button').click(); await L.waitForTimeout(500);
    ok(await L.locator('.faddrow.ok').count() === 1, 'mandar pedido de amizade pelo apelido');
    await P.click('#railHome'); await P.waitForTimeout(500);
    await P.locator('#hTabs button[data-t="pending"]').click(); await P.waitForTimeout(300);
    await P.screenshot({ path: SP + '/g-friends.png' });
    await P.locator('.frow', { hasText: 'Lucas' }).locator('.fbtn.ok').click(); await P.waitForTimeout(500);
    await L.locator('#hTabs button[data-t="all"]').click(); await L.waitForTimeout(600);
    ok(await L.locator('.frow', { hasText: 'Pedro' }).count() === 1, 'aceitar pedido: os dois viram amigos');
    await P.click('#hClose'); await L.click('#hClose');
  });
  await step('descobrir e modelo', async () => {
    const N = await mk(); await signup(N, 'n@t.com', 'Nina');
    await N.fill('#createName', 'Clube'); await N.locator('.tpl[data-t="jogos"]').click(); await N.click('#createForm button[type=submit]'); await N.waitForTimeout(1500);
    ok(await N.locator('.chan.text', { hasText: 'dicas' }).count() === 1 && await N.locator('.chan.voice', { hasText: 'Lobby' }).count() === 1, 'criar servidor a partir do modelo "Jogos"');
    await N.click('#railDisc'); await N.waitForTimeout(800);
    await N.screenshot({ path: SP + '/g-discover.png' });
    ok(await N.locator('.dcard', { hasText: 'Galera' }).count() === 1, 'Descobrir lista o servidor público');
    await N.locator('.dcard', { hasText: 'Galera' }).locator('button').click(); await N.waitForTimeout(1800);
    ok((await N.textContent('#serverName')).includes('Galera'), 'entrar pelo Descobrir sem convite');
    // aviso de mencao em outro servidor
    if (await N.isVisible('#welcomeModal')) await N.click('#welOk');
    await N.locator('#railList .srv[title="Clube"]').click(); await N.waitForTimeout(1800);
    await send(P, 'oi @Nina');
    await N.waitForTimeout(600);
    ok(await N.locator('#railList .srv .srvbadge').count() === 1, 'menção em outro servidor aparece na barra');
  });
  await step('palco', async () => {
    await P.click('.catadd[data-add="voice"]'); await P.fill('#chanNameInput', 'Palco'); await P.check('#chanStage'); await P.click('#chanSave'); await P.waitForTimeout(600);
    await L.locator('.chan.voice', { hasText: 'Palco' }).click(); await L.waitForTimeout(1500);
    ok(await L.isVisible('#handBtn'), 'palco: plateia tem o botão de levantar a mão');
    await L.click('#micBtn'); await L.waitForTimeout(300);
    ok(await L.locator('#micBtn.off').count() === 1, 'palco: plateia não liga o microfone');
    await L.click('#handBtn'); await L.waitForTimeout(400);
    ok(await P.locator('.vpeople li', { hasText: 'Lukinhas' }).locator('.tags .ic').count() >= 1, 'mão levantada aparece para a moderação');
    await L.click('#vpLeave');
  });
  console.log('erros:', errs.map((e) => e.split('\n').slice(0, 3).join(' | '))); await b.close(); process.exit(0);
})().catch(e => { console.error(e.message.split('\n')[0]); process.exit(1); });

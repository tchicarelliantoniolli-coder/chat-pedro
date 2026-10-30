const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('ERRO ' + name + ': ' + e.message.split('\n')[0]); } };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errs = [];
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1440, height: 820 }, permissions: ['microphone'] }); const p = await c.newPage(); p.setDefaultTimeout(6000); p.on('pageerror', e => errs.push(e.stack)); return p; };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };
  const send = async (p, t) => { await p.fill('#input', t); await p.press('#input', 'Enter'); await p.waitForTimeout(300); };
  const P = await mk(); await signup(P, 'p@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1300);
  await P.click('#srvBtn'); await P.click('#invMake'); await P.waitForTimeout(300); const link = await P.inputValue('#invLink'); await P.click('#srvClose');
  const L = await mk(); await signup(L, 'l@t.com', 'Lucas'); await L.goto(link); await L.waitForTimeout(800); await L.click('#invAccept'); await L.waitForTimeout(1300);
  const chan = (p, n) => p.locator('.chan.text', { hasText: n });

  await step('criar canal', async () => {
    await P.click('.catadd[data-add="text"]'); await P.fill('#chanNameInput', 'Memes Top'); await P.fill('#chanTopicInput', 'só meme bom'); await P.click('#chanSave'); await P.waitForTimeout(700);
    ok(await chan(L, 'memes-top').count() === 1, 'canal de texto criado aparece para todos (nome vira memes-top)');
  });
  await step('nao lidas', async () => {
    await chan(P, 'memes-top').click(); await P.waitForTimeout(400);
    await send(P, 'primeiro meme @Lucas');
    ok(await L.locator('.chan.text.unread', { hasText: 'memes-top' }).count() === 1 && await chan(L, 'memes-top').locator('.cbadge').count() === 1, 'canal fica em negrito + contador de menção para quem não está nele');
    ok((await P.textContent('#chanTopic')).includes('só meme bom'), 'tópico do canal no cabeçalho');
    await chan(L, 'memes-top').click(); await L.waitForTimeout(500);
    ok(await L.locator('#log .txt', { hasText: 'primeiro meme' }).count() === 1 && await L.locator('.chan.text.unread', { hasText: 'memes-top' }).count() === 0, 'abrir o canal carrega o histórico e limpa a não lida');
    await chan(L, 'chat').click(); await L.waitForTimeout(400);
    ok(await L.locator('#log .txt', { hasText: 'primeiro meme' }).count() === 0, 'mensagens separadas por canal');
  });
  await step('enquete', async () => {
    await chan(P, 'chat').click(); await P.waitForTimeout(300);
    await P.click('#photoBtn'); await P.locator('#ctxMenu .mitem', { hasText: 'Criar enquete' }).click();
    await P.fill('#pollQ', 'Qual jogo?'); const ins = P.locator('#pollOpts input'); await ins.nth(0).fill('Truco'); await ins.nth(1).fill('Poker'); await P.click('#pollSend'); await P.waitForTimeout(600);
    await L.locator('.popt', { hasText: 'Truco' }).click(); await L.waitForTimeout(500);
    ok((await P.locator('.popt', { hasText: 'Truco' }).locator('.pc').textContent()).includes('1'), 'enquete: criar e votar (voto aparece para todos)');
    await L.locator('.popt', { hasText: 'Poker' }).click(); await L.waitForTimeout(500);
    ok((await P.locator('.popt', { hasText: 'Truco' }).locator('.pc').textContent()).includes('0'), 'enquete de uma resposta troca o voto');
  });
  await step('arquivo', async () => {
    const [fc] = await Promise.all([P.waitForEvent('filechooser'), (async () => { await P.click('#photoBtn'); await P.locator('#ctxMenu .mitem', { hasText: 'Enviar arquivo' }).click(); })()]);
    await fc.setFiles({ name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('ola mundo') }); await P.waitForTimeout(900);
    ok(await L.locator('.filecard', { hasText: 'notas.txt' }).count() === 1, 'enviar arquivo (cartão com nome e tamanho)');
  });
  await step('reacao emoji', async () => {
    await send(L, 'reage aqui');
    const line = P.locator('#log .line.msg', { hasText: 'reage aqui' }); await line.hover();
    await line.locator('button[aria-label="Reagir"]').click(); await P.click('.pk-more'); await P.waitForTimeout(300);
    ok(await P.isVisible('#emojiPicker'), 'seletor de emojis completo abre');
    await P.screenshot({ path: SP + '/f-emoji.png' });
    await P.fill('#emojiSearch', 'pizza'); await P.waitForTimeout(200); await P.press('#emojiSearch', 'Enter'); await P.waitForTimeout(500);
    ok(await L.locator('#log .line.msg', { hasText: 'reage aqui' }).locator('.rx', { hasText: '🍕' }).count() === 1, 'reagir com qualquer emoji (busca "pizza")');
    await P.screenshot({ path: SP + '/f-chat.png' });
  });
  await step('encaminhar e menu', async () => {
    await P.locator('#log .line.msg', { hasText: 'reage aqui' }).click({ button: 'right' }); await P.waitForTimeout(200);
    ok(await P.isVisible('#ctxMenu'), 'menu de contexto com botão direito na mensagem');
    await P.screenshot({ path: SP + '/f-menu.png' });
    await P.locator('#ctxMenu .mitem', { hasText: 'Encaminhar' }).click(); await P.locator('#pickList .pickitem', { hasText: 'memes-top' }).click(); await P.waitForTimeout(500);
    await chan(L, 'memes-top').click(); await L.waitForTimeout(500);
    ok(await L.locator('#log .fwd').count() === 1, 'encaminhar mensagem para outro canal');
    await chan(L, 'chat').click(); await L.waitForTimeout(300);
  });
  await step('slash e markdown', async () => {
    await send(P, '/shrug'); await send(P, '# Titulo\n- item\n-# pequeno\nvai em #memes-top');
    ok(await L.locator('#log .txt', { hasText: '¯\\_(ツ)_/¯' }).count() === 1, 'comando /shrug');
    ok(await L.locator('.mdh.h1').count() === 1 && await L.locator('.mdli').count() === 1 && await L.locator('.mdsub').count() === 1 && await L.locator('.chanchip').count() === 1, 'markdown: título, lista, subtexto e #canal');
  });
  await step('eventos', async () => {
    await P.click('#eventsBtn'); await P.click('#evNew summary'); await P.fill('#evName', 'Noite do truco');
    await P.fill('#evWhen', '2030-01-01T20:00'); await P.click('#evCreate'); await P.waitForTimeout(500);
    await P.screenshot({ path: SP + '/f-events.png' }); await P.click('#evClose');
    ok(await L.locator('#eventsCount').isVisible(), 'evento criado aparece com contador para os outros');
  });
  await step('automod', async () => {
    await P.click('#srvBtn'); await P.waitForTimeout(200);
    await P.click('#srvMod');
    await P.waitForTimeout(300); await P.locator('#automodBox summary').click(); await P.fill('#automodWords', 'palavrao'); await P.click('#automodSave'); await P.waitForTimeout(400);
    await P.screenshot({ path: SP + '/f-mod.png' });
    await P.keyboard.press('Escape'); await P.keyboard.press('Escape'); await P.waitForTimeout(200);
    await send(L, 'isso é um palavrao');
    ok(await P.locator('#log .txt', { hasText: 'isso é um palavrao' }).count() === 0, 'AutoMod bloqueia palavra proibida');
  });
  await step('DM', async () => {
    await L.locator('#people li', { hasText: 'Pedro' }).click(); await L.waitForTimeout(300); await L.screenshot({ path: SP + '/f-pop.png' });
    await L.locator('#popout button', { hasText: 'Mandar mensagem' }).click(); await L.waitForTimeout(1500);
    await send(L, 'oi no privado');
    await P.waitForTimeout(800);
    ok(await P.locator('.srv.dmsrv').count() === 1, 'mensagem direta aparece na barra do Pedro');
    await P.locator('.srv.dmsrv').click(); await P.waitForTimeout(1500);
    ok(await P.locator('#log .txt', { hasText: 'oi no privado' }).count() === 1, 'DM: conversa privada entre os dois');
    await P.screenshot({ path: SP + '/f-dm.png' });
  });
  await step('ctrl+k', async () => {
    await P.keyboard.press('Control+k'); await P.waitForTimeout(200); ok(await P.isVisible('#switcher'), 'Ctrl+K abre o alternador rápido'); await P.keyboard.press('Escape');
  });
  console.log('erros:', errs); await b.close();
})().catch(e => { console.error(e.message.split('\n')[0]); process.exit(1); });

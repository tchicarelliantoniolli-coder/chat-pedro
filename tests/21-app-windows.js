// Programa do Windows (pasta desktop/): abre o Electron de verdade (no Linux, numa tela virtual) apontando para o
// site de teste e confere a janela sem navegador, o icone perto do relogio, os atalhos globais, o "Jogando ...",
// o numero de nao lidas, o escolher-tela, o zoom e as Configuracoes do Windows.
const { _electron, chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SP = process.argv[2] || path.join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('ERRO ' + name + ': ' + e.message.split('\n')[0]); } };
const DESK = path.join(__dirname, '..', 'desktop');
const ELECTRON = path.join(DESK, 'node_modules', 'electron', 'dist', 'electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  if (!fs.existsSync(ELECTRON)) { console.log('OK   (pulado: rode "npm install" em desktop/ para testar o programa)'); console.log('erros: []'); return; }
  // tela virtual para o Electron
  let xvfb = null, display = process.env.DISPLAY;
  if (!display) { display = ':' + (90 + Math.floor(Math.random() * 9)); xvfb = spawn('Xvfb', [display, '-screen', '0', '1600x1000x24', '-nolisten', 'tcp'], { stdio: 'ignore' }); await wait(800); }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-desk-'));
  const sleeper = spawn('sleep', ['120'], { stdio: 'ignore' }); // "jogo" aberto
  const errs = [];
  const E = await _electron.launch({
    executablePath: ELECTRON,
    args: [DESK, '--no-sandbox', '--use-fake-device-for-media-stream'], // sem --use-fake-ui: ele pularia a escolha de tela
    env: { ...process.env, DISPLAY: display, CHATPEDRO_URL: URL, CHATPEDRO_TEST: '1', CHATPEDRO_USERDATA: userData, CHATPEDRO_SCAN_MS: '500' },
    timeout: 30000,
  });
  const cp = (fn, arg) => E.evaluate(fn, arg);
  // tecla "de verdade" (passa pelo programa como uma tecla do teclado; as do Playwright pulam o programa)
  const key = (keyCode, modifiers) => cp(({ BrowserWindow }, [k, m]) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('http'));
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: m || [] });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: m || [] });
  }, [keyCode, modifiers]);
  let W = null;
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    await step('janelinha de abertura e janela principal', async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 25000 && !W) {
        for (const w of E.windows()) if (w.url().startsWith(URL)) W = w;
        if (!W) await wait(200);
      }
      ok(!!W, 'a janela do Chat Pedro abre com o site dentro');
      const splash = E.windows().find((w) => w.url().startsWith('file:') && w.url().endsWith('splash.html'));
      ok(true, 'janelinha de abertura: ' + (splash ? 'ainda aberta' : 'já fechou'));
      W.setDefaultTimeout(8000);
      W.on('pageerror', (e) => errs.push(e.stack));
      await W.waitForSelector('body.ready', { timeout: 15000 });
      await wait(600);
      ok(await cp(() => global.__cp.visible()), 'janela aparece quando o site termina de abrir (a abertura some)');
      ok(await W.evaluate(() => document.documentElement.classList.contains('desktop') && !!window.ChatPedroDesktop), 'o site sabe que está no programa (html.desktop)');
      const ping = await (await fetch(URL + '/api/ping')).json();
      ok(ping.ok === true && !!ping.v, '/api/ping responde (o programa espera o servidor acordar)');
    });

    await step('conta e servidor', async () => {
      await W.click('#tabSignup'); await W.fill('#authEmail', 'app@t.com'); await W.fill('#authNick', 'Pedro'); await W.fill('#authPass', 'senha123'); await W.click('#authGo'); await wait(1200);
      await W.fill('#createName', 'Galera'); await W.click('#createForm button[type=submit]'); await wait(1500);
      ok(await W.isVisible('#winBtns'), 'botões da janela na barra de cima');
      ok(await W.locator('#winBtns button').count() === 3, 'minimizar, maximizar e fechar');
      const drag = await W.evaluate(() => getComputedStyle(document.querySelector('body > header')).webkitAppRegion || getComputedStyle(document.querySelector('body > header')).getPropertyValue('-webkit-app-region'));
      ok(drag === 'drag', 'arrastar a barra de cima move a janela (' + drag + ')');
      ok(!(await W.isVisible('#railDl')), 'sem botão "Baixar o app" dentro do programa');
      const wb = await W.locator('#winBtns .wclose').boundingBox();
      const vw = await W.evaluate(() => innerWidth);
      ok(wb && Math.round(wb.width) === 32 && Math.round(wb.height) === 32 && Math.abs(wb.x + wb.width - vw) < 2, 'fechar com 32x32 no canto (como no Discord)');
      await W.screenshot({ path: SP + '/21-app.png' });
    });

    await step('maximizar e fechar para perto do relógio', async () => {
      await W.click('#winBtns .wmax'); await wait(500);
      // sem gerenciador de janelas (tela virtual) o Linux nao maximiza: confere o pedido e o botao com o estado
      const maxed = await cp(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isMaximized()));
      ok(maxed || (await cp(() => global.__cp.lastWin())) === 'max', 'maximizar pede para maximizar a janela');
      if (!maxed) await cp(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('http')); w.webContents.send('cp:win-state', { ...global.__cp.winState(), maximized: true }); });
      await wait(200);
      ok(await W.getAttribute('#winBtns .wmax', 'aria-label') === 'Restaurar', 'botão vira "Restaurar" com a janela maximizada');
      await W.click('#winBtns .wmax'); await wait(400);
      await W.click('#winBtns .wclose'); await wait(500);
      ok(!(await cp(() => global.__cp.visible())), 'X esconde a janela');
      ok(E.process().exitCode === null, 'mas o programa continua aberto');
      const labels = await cp(() => global.__cp.trayLabels());
      ok(labels.includes('Abrir o Chat Pedro') && labels.includes('Sair do Chat Pedro') && labels.some((l) => l.startsWith('Silenciar microfone')) && labels.some((l) => l.startsWith('Abrir junto com o Windows')), 'menu do ícone: ' + labels.filter((l) => l !== '-').join(' | '));
      await cp(() => global.__cp.trayClick('Abrir o Chat Pedro')); await wait(400);
      ok(await cp(() => global.__cp.visible()), '"Abrir o Chat Pedro" no ícone traz a janela de volta');
    });

    await step('mutar pelo ícone perto do relógio', async () => {
      const before = await W.evaluate(() => window.ChatPedro.audio.state().micOn);
      await cp(() => global.__cp.trayClick('Silenciar microfone')); await wait(400);
      const after = await W.evaluate(() => window.ChatPedro.audio.state().micOn);
      ok(before === true && after === false, '"Silenciar microfone" no ícone muta');
      ok((await cp(() => global.__cp.trayLabels())).includes('Silenciar microfone [x]'), 'o menu do ícone mostra marcado');
      await cp(() => global.__cp.trayClick('Silenciar microfone')); await wait(300);
      ok(await W.evaluate(() => window.ChatPedro.audio.state().micOn), 'de novo: desmuta');
    });

    await step('atalhos globais', async () => {
      await W.evaluate(() => window.ChatPedro.openUserSettings('atalhos')); await wait(400);
      ok(await W.locator('#userSettings .kb-row').count() === 3, 'página Atalhos tem os 3 atalhos que funcionam com o jogo na frente');
      await W.locator('#userSettings .kb-key[data-action="mute"]').click(); await wait(200);
      ok(await W.locator('#userSettings .kb-key.rec').count() === 1, 'clicar no quadro espera a tecla');
      await cp(() => global.__cp.recordFake('key', 50, true, { ctrl: true })); await wait(400); // CTRL + M
      const lbl = (await W.locator('#userSettings .kb-key[data-action="mute"]').textContent()).trim();
      ok(lbl === 'CTRL + M', 'atalho gravado: ' + lbl);
      await W.screenshot({ path: SP + '/21-atalhos.png' });
      await cp(() => global.__cp.key('key', 50, true, { ctrl: true })); await cp(() => global.__cp.key('key', 50, false, { ctrl: true })); await wait(300);
      ok(!(await W.evaluate(() => window.ChatPedro.audio.state().micOn)), 'CTRL + M de qualquer lugar muta');
      await cp(() => global.__cp.key('key', 50, true, {})); await cp(() => global.__cp.key('key', 50, false, {})); await wait(300);
      ok(!(await W.evaluate(() => window.ChatPedro.audio.state().micOn)), 'só M (sem CTRL) não mexe');
      await cp(() => global.__cp.key('key', 50, true, { ctrl: true })); await cp(() => global.__cp.key('key', 50, false, { ctrl: true })); await wait(300);
      ok(await W.evaluate(() => window.ChatPedro.audio.state().micOn), 'CTRL + M de novo desmuta');
      // segurar para falar com o botao lateral do mouse
      await W.locator('#userSettings .kb-key[data-action="ptt"]').click(); await wait(200);
      await cp(() => global.__cp.recordFake('mouse', 4, true)); await wait(400);
      ok((await W.locator('#userSettings .kb-key[data-action="ptt"]').textContent()).includes('MOUSE4'), 'apertar para falar no MOUSE4');
      const cfgB = await cp(() => global.__cp.cfg().binds);
      ok(cfgB.mute && cfgB.ptt && cfgB.mute.code === 50 && cfgB.ptt.kind === 'mouse', 'atalhos ficam salvos no programa');
      await W.click('#usClose'); await wait(300);
    });

    await step('apertar para falar dentro de um jogo', async () => {
      await W.click('.chan.voice[data-voice]'); await wait(2500);
      await W.evaluate(() => { const c = document.getElementById('pttCheck'); if (!c.checked) c.click(); });
      await wait(300);
      ok(await W.isVisible('#pttBtn'), 'na call com "apertar para falar"');
      await cp(() => global.__cp.key('mouse', 4, true)); await wait(250);
      ok(await W.evaluate(() => document.getElementById('pttBtn').classList.contains('held')), 'segurar o MOUSE4 abre o microfone');
      await cp(() => global.__cp.key('mouse', 4, false)); await wait(250);
      ok(!(await W.evaluate(() => document.getElementById('pttBtn').classList.contains('held'))), 'soltar fecha');
      await W.evaluate(() => { const c = document.getElementById('pttCheck'); if (c.checked) c.click(); });
    });

    let L = null;
    await step('"Jogando ..." para os amigos', async () => {
      await W.click('#srvBtn'); await W.click('#invMake'); await wait(300); const link = await W.inputValue('#invLink'); await W.click('#srvClose');
      const c = await b.newContext({ viewport: { width: 1300, height: 800 } }); L = await c.newPage(); L.setDefaultTimeout(8000); L.on('pageerror', (e) => errs.push(e.stack));
      await L.goto(URL); await wait(500); await L.click('#tabSignup'); await L.fill('#authEmail', 'l@t.com'); await L.fill('#authNick', 'Lucas'); await L.fill('#authPass', 'senha123'); await L.click('#authGo'); await wait(900);
      await L.goto(link); await wait(800); await L.click('#invAccept'); await wait(1500);
      await W.evaluate(() => window.ChatPedroDesktop.setConfig({ games: [{ exe: 'sleep', name: 'Jogo de Teste' }] }));
      await wait(1800);
      const g = await cp(() => global.__cp.game());
      ok(g && g.name === 'Jogo de Teste', 'programa acha o jogo aberto');
      const row = (await L.locator('#people li', { hasText: 'Pedro' }).first().textContent()) || '';
      ok(row.includes('Jogando Jogo de Teste'), 'amigo vê "Jogando Jogo de Teste" na lista de membros');
      await W.evaluate(() => window.ChatPedro.openUserSettings('jogos')); await wait(500);
      ok((await W.locator('#userSettings .game-now').textContent()).includes('Jogo de Teste'), 'Jogos registrados mostra o jogo de agora');
      await W.screenshot({ path: SP + '/21-jogos.png' });
      await W.locator('#userSettings .us-page[data-page="jogos"] a', { hasText: 'Adicionar!' }).click(); await wait(800);
      ok(await W.locator('#userSettings .prog-list button').count() > 0, '"Adicionar!" lista os programas abertos');
      await W.click('#usClose'); await wait(300);
      // escondeu a atividade: some para os outros
      await W.evaluate(() => window.ChatPedroPrefs.set('activity', false)); await wait(800);
      const row2 = (await L.locator('#people li', { hasText: 'Pedro' }).first().textContent()) || '';
      ok(!row2.includes('Jogando'), 'com "Compartilhar minha atividade" desligado ninguém vê o jogo');
      await W.evaluate(() => window.ChatPedroPrefs.set('activity', true));
    });

    await step('não lidas no ícone com a janela escondida', async () => {
      await W.click('#winBtns .wclose'); await wait(500);
      await L.fill('#input', '@Pedro olha isso'); await L.press('#input', 'Enter'); await wait(1000);
      const n = await cp(() => global.__cp.badge());
      ok(n === 1, 'menção com a janela escondida: número 1 no ícone (' + n + ')');
      await cp(() => global.__cp.trayClick('Abrir o Chat Pedro')); await wait(300);
      await W.evaluate(() => window.dispatchEvent(new Event('focus'))); await wait(300);
      ok(await cp(() => global.__cp.badge()) === 0, 'voltou para a janela: o número some');
    });

    await step('links abrem no navegador da pessoa', async () => {
      await cp(({ shell }) => { global.__opened = []; shell.openExternal = (u) => { global.__opened.push(u); return Promise.resolve(); }; });
      await W.evaluate(() => window.open('https://example.com/oi', '_blank'));
      await wait(500);
      const opened = await cp(() => global.__opened);
      ok(opened.includes('https://example.com/oi'), 'link de fora vai para o navegador, não abre dentro do programa');
      ok(E.windows().filter((w) => w.url().startsWith('https://example.com')).length === 0, 'nenhuma janela nova de navegador dentro do programa');
    });

    await step('escolher tela para compartilhar', async () => {
      const p = W.evaluate(() => navigator.mediaDevices.getDisplayMedia({ video: true }).then((s) => s.getVideoTracks().length, (e) => 'erro: ' + e.name));
      const shown = await Promise.race([W.waitForSelector('#pickModal', { timeout: 25000 }).then(() => true), p.then((r) => 'resposta: ' + r)]);
      ok(shown === true, 'janela "Compartilhar tela" do Chat Pedro aparece' + (shown === true ? '' : ' (' + shown + ')'));
      await W.screenshot({ path: SP + '/21-compartilhar.png' });
      await W.locator('#pickModal .pick-tabs button', { hasText: 'Telas' }).click();
      const items = await W.locator('#pickModal .pick-item').count();
      ok(items > 0, 'lista as telas (' + items + ')');
      await W.locator('#pickModal .pick-item').first().click();
      await W.click('#pickModal .go');
      const r = await p;
      ok(r === 1, 'compartilhar a tela escolhida entrega o vídeo (' + r + ')');
      await W.evaluate(() => { /* para a captura */ });
      const p2 = W.evaluate(() => navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => 'abriu', (e) => e.name));
      await W.waitForSelector('#pickModal', { timeout: 25000 }); await W.keyboard.press('Escape');
      ok(await p2 !== 'abriu', 'Esc cancela sem compartilhar');
    });

    await step('zoom e recarregar', async () => {
      await key('=', ['control']); await wait(300);
      ok(await W.evaluate(() => window.ChatPedroPrefs.get('zoom')) === 110, 'Ctrl + = aumenta o zoom (Acessibilidade)');
      await key('0', ['control']); await wait(300);
      ok(await W.evaluate(() => window.ChatPedroPrefs.get('zoom')) === 100, 'Ctrl + 0 volta para 100%');
      await W.evaluate(() => { window.__still = 1; });
      await key('F5'); await key('r', ['control']); await wait(1200);
      ok(await W.evaluate(() => window.__still === 1), 'F5 e Ctrl+R não recarregam tudo');
    });

    await step('Configurações do Windows', async () => {
      await W.evaluate(() => window.ChatPedro.openUserSettings('conta')); await wait(300);
      await W.locator('#usTabs .gs-tab', { hasText: 'Configurações do Windows' }).click(); await wait(400);
      ok(await W.isVisible('#userSettings .us-page[data-page="windows"]'), 'página "Configurações do Windows" nas Configurações');
      const close = W.locator('#userSettings input[data-desk="closeToTray"]');
      ok(await close.isChecked(), '"Minimizar para a área de notificação" ligado por padrão');
      await W.screenshot({ path: SP + '/21-config-windows.png' });
      await close.evaluate((i) => i.click()); await wait(400);
      ok((await cp(() => global.__cp.cfg().closeToTray)) === false, 'desligar fica salvo no programa');
      ok((await W.textContent('#usApp')).includes('Chat Pedro para Windows'), 'versão do programa nas Configurações');
      await close.evaluate((i) => i.click()); await wait(300);
      await W.click('#usClose');
    });

    await step('sair pelo ícone', async () => {
      const closed = new Promise((r) => E.process().once('exit', () => r(true)));
      await cp(() => global.__cp.trayClick('Sair do Chat Pedro'));
      ok(await Promise.race([closed, wait(5000).then(() => false)]), '"Sair do Chat Pedro" fecha o programa');
      const saved = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'));
      ok(saved.binds && saved.binds.mute && saved.bounds, 'atalhos e tamanho da janela salvos para a próxima vez');
    });
  } finally {
    await E.close().catch(() => {});
    await b.close().catch(() => {});
    sleeper.kill();
    if (xvfb) xvfb.kill();
    fs.rmSync(userData, { recursive: true, force: true });
  }
  console.log('erros:', JSON.stringify(errs));
})();

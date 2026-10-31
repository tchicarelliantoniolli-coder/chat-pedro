// Supressao de ruido com IA (no lugar do Krisp do Discord): liga sozinha na call, janelinha do botao de onda
// (liga/desliga, teste do microfone), opcoes nas Configuracoes de voz e a voz continua chegando para os outros.
const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('ERRO ' + name + ': ' + e.message.split('\n')[0]); } };
(async () => {
  // o microfone falso toca fala com barulho de ventilador e teclado (fala do Open Speech Repository, uso livre)
  const FALA = require('path').join(__dirname, 'fixtures', 'fala-com-ruido.wav');
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + FALA, '--autoplay-policy=no-user-gesture-required'] }); const errs = [];
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['microphone', 'camera'] }); const p = await c.newPage(); p.setDefaultTimeout(8000); p.on('pageerror', e => errs.push(e.stack)); return p; };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };
  const P = await mk(); await signup(P, 'p@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1300);
  await P.click('#srvBtn'); await P.click('#invMake'); await P.waitForTimeout(300); const link = await P.inputValue('#invLink'); await P.click('#srvClose');
  const L = await mk(); await signup(L, 'l@t.com', 'Lucas'); await L.goto(link); await L.waitForTimeout(800); await L.click('#invAccept'); await L.waitForTimeout(1300);
  // som que chega da outra pessoa
  const heard = (p) => p.evaluate(async () => {
    const a = [...document.querySelectorAll('audio')].find((x) => x.srcObject && x.srcObject.getAudioTracks().length && !x.srcObject.getVideoTracks().length);
    if (!a) return -1;
    const c = new AudioContext(); const an = c.createAnalyser(); an.fftSize = 2048; c.createMediaStreamSource(a.srcObject).connect(an);
    let max = 0; const buf = new Float32Array(2048);
    for (let i = 0; i < 25; i++) { await new Promise((r) => setTimeout(r, 80)); an.getFloatTimeDomainData(buf); for (const v of buf) max = Math.max(max, Math.abs(v)); }
    c.close(); return max;
  });

  await step('na call', async () => {
    const r = await P.request.get(URL + '/vendor/ruido/gtcrn.wasm');
    ok(r.ok() && (r.headers()['content-type'] || '').includes('wasm'), 'o site entrega o arquivo da IA (' + r.headers()['content-type'] + ')');
    await P.locator('.chan.voice').first().click(); await L.locator('.chan.voice').first().click(); await P.waitForTimeout(3000);
    ok(await P.evaluate(() => window.ChatPedro.audio.noiseActive()), 'supressão de ruído com IA ligada sozinha na call');
    ok(await P.locator('#vpNoise.on').count() === 1, 'botão de onda aceso no "Voz conectada"');
    const lv = await heard(L); ok(lv > 0.01, 'a voz passa pela IA e chega para o outro: ' + lv.toFixed(3));
  });
  await step('janelinha', async () => {
    await P.click('#vpNoise'); await P.waitForTimeout(300);
    ok(await P.locator('#upPop.unoise .unrow', { hasText: 'Supressão de ruído' }).count() === 1, 'botão de onda abre a janelinha "Supressão de ruído"');
    await P.screenshot({ path: SP + '/k-janelinha.png' });
    await P.locator('#upPop.unoise .unbtn').click(); await P.waitForTimeout(1200);
    const w = await P.evaluate(() => parseFloat(document.querySelector('#upPop .unmeter i').style.width) || 0);
    ok(await P.locator('#upPop .unbtn.stop', { hasText: 'Parar' }).count() === 1 && w > 0, 'Teste do microfone mostra o nível da voz: ' + w + '%');
    await P.locator('#upPop.unoise .utog').click(); await P.waitForTimeout(1500);
    ok(!(await P.evaluate(() => window.ChatPedro.audio.noiseActive())) && await P.locator('#vpNoise:not(.on)').count() === 1, 'desligar na janelinha tira a IA');
    const lv = await heard(L); ok(lv > 0.01, 'sem a IA a voz continua chegando: ' + lv.toFixed(3));
    await P.keyboard.press('Escape'); await P.mouse.click(700, 650); await P.waitForTimeout(300);
    ok(await P.locator('#upPop').isHidden(), 'clicar fora fecha a janelinha');
  });
  await step('configuracoes', async () => {
    await P.evaluate(() => window.ChatPedro.openUserSettings('voz')); await P.waitForTimeout(800);
    ok(await P.locator('#noiseRadio input[value=padrao]').isChecked(), 'Configurações de voz mostram "Padrão" depois de desligar');
    await P.locator('#noiseRadio label', { hasText: 'Inteligência artificial' }).click(); await P.waitForTimeout(1500);
    ok(await P.evaluate(() => window.ChatPedro.audio.noiseActive()) && await P.locator('#vpNoise.on').count() === 1, 'escolher "Inteligência artificial" religa a IA');
    await P.screenshot({ path: SP + '/k-configuracoes.png' });
    await P.locator('#noiseRadio label', { hasText: 'Nenhuma' }).click(); await P.waitForTimeout(1200);
    ok(!(await P.evaluate(() => window.ChatPedro.audio.noiseActive())), '"Nenhuma" desliga tudo');
    const lv = await heard(L); ok(lv > 0.01, 'com "Nenhuma" a voz chega: ' + lv.toFixed(3));
    await P.locator('#noiseRadio label', { hasText: 'Inteligência artificial' }).click(); await P.waitForTimeout(800);
    await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  });
  await step('lembra a escolha', async () => {
    await P.reload(); await P.waitForTimeout(2500);
    await P.locator('.chan.voice').first().click(); await P.waitForTimeout(2500);
    ok(await P.evaluate(() => window.ChatPedro.audio.noiseActive()), 'depois de recarregar a página a IA continua ligada');
  });
  console.log('erros:', errs.map((e) => e.split('\n').slice(0, 3).join(' | '))); await b.close(); process.exit(0);
})().catch(e => { console.error(e.message.split('\n')[0]); process.exit(1); });

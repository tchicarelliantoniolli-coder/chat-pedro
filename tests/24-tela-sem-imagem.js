// Tela compartilhada que nao chega (antes: quadro preto para sempre). Quem assiste ve "Carregando a tela..." e,
// sem imagem em alguns segundos, pede para quem compartilha mandar de novo; a imagem aparece sozinha.
// Confere tambem o limite do video (720p, ate 2,5 Mbps, baixa a resolucao em vez de travar com internet fraca).
const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('ERRO ' + name + ': ' + e.message.split('\n')[0]); } };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errs = [];
  const mk = async (init) => {
    const c = await b.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['microphone', 'camera'] }); const p = await c.newPage();
    p.setDefaultTimeout(10000); p.on('pageerror', e => errs.push(e.stack));
    await p.addInitScript(() => { const R = window.RTCPeerConnection; window.__pcs = []; window.RTCPeerConnection = function (...a) { const pc = new R(...a); window.__pcs.push(pc); return pc; }; window.RTCPeerConnection.prototype = R.prototype; });
    if (init) await p.addInitScript(init);
    return p;
  };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };
  const screen = (p) => p.evaluate(() => { const t = document.querySelector('#tiles .tile.screen'); const v = t && t.querySelector('video'); return t ? { w: v ? v.videoWidth : 0, loading: t.classList.contains('loading') } : null; });

  // Pedro: a primeira imagem da tela "se perde no caminho" (o video vai vazio), como numa internet ruim
  const P = await mk(() => {
    const add = RTCPeerConnection.prototype.addTrack;
    RTCPeerConnection.prototype.addTrack = function (t, ...s) {
      const sd = add.call(this, t, ...s);
      if (t.kind === 'video' && window.__perde && !window.__perdeu) { window.__perdeu = true; sd.replaceTrack(null); }
      return sd;
    };
  });
  await signup(P, 'p@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1300);
  await P.click('#srvBtn'); await P.click('#invMake'); await P.waitForTimeout(300); const link = await P.inputValue('#invLink'); await P.click('#srvClose');
  const L = await mk(); await signup(L, 'l@t.com', 'Lucas'); await L.goto(link); await L.waitForTimeout(800); await L.click('#invAccept'); await L.waitForTimeout(1300);
  for (const p of [P, L]) { await p.locator('.chan.voice').first().click(); await p.waitForTimeout(1500); }

  await step('tela que nao chega se recupera', async () => {
    await P.evaluate(() => { window.__perde = true; });
    await P.click('#screenBtn');
    await L.waitForTimeout(2500);
    const s1 = await screen(L);
    ok(s1 && s1.w === 0 && s1.loading, 'sem imagem: aparece "Carregando a tela..." e nao um quadro preto ' + JSON.stringify(s1));
    await L.screenshot({ path: SP + '/24-carregando.png' });
    let s2 = null;
    for (let i = 0; i < 30; i++) { s2 = await screen(L); if (s2 && s2.w > 0) break; await L.waitForTimeout(500); }
    ok(s2 && s2.w > 0, 'pediu de novo sozinho e a tela apareceu ' + JSON.stringify(s2));
    await L.waitForTimeout(1200);
    ok(!(await screen(L)).loading, 'o aviso some quando a imagem chega');
  });

  await step('tela sem imagem no computador de quem compartilha', async () => {
    await P.click('#screenBtn'); await P.waitForTimeout(800); // para
    // a proxima tela nao gera nenhuma imagem (como janela minimizada ou jogo em tela cheia)
    await P.evaluate(() => { navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; return c.captureStream(0); }; });
    await P.click('#screenBtn');
    let msg = '';
    for (let i = 0; i < 40; i++) { msg = await L.evaluate(() => { const t = document.querySelector('#tiles .tile.screen.loading'); return t ? t.dataset.msg : ''; }); if (/sem imagem no próprio computador/.test(msg)) break; await L.waitForTimeout(500); }
    ok(/sem imagem no próprio computador/.test(msg), 'quem assiste ve o motivo: ' + msg);
    await L.screenshot({ path: SP + '/24-motivo.png' });
    ok(await P.locator('text=Sua tela não está gerando imagem').count() > 0, 'quem compartilha recebe o aviso');
    await P.click('#screenBtn'); await P.waitForTimeout(500);
    await P.evaluate(() => { delete navigator.mediaDevices.getDisplayMedia; });
    await P.click('#screenBtn'); await P.waitForTimeout(2500); // volta ao normal para o proximo passo
  });

  await step('limite do video', async () => {
    const enc = await P.evaluate(async () => {
      const pc = window.__pcs.find((x) => x.connectionState === 'connected');
      const sd = pc.getSenders().find((x) => x.track && x.track.kind === 'video');
      const ps = sd.getParameters();
      return { max: ps.encodings[0] && ps.encodings[0].maxBitrate, pref: ps.degradationPreference, h: sd.track.getSettings().height };
    });
    ok(enc.max === 2500000, 'tela vai com no maximo 2,5 Mbps (' + enc.max + ')');
    ok(enc.pref === 'balanced', 'com internet fraca baixa a resolucao em vez de travar (' + enc.pref + ')');
    ok(enc.h <= 720, 'tela em ate 720p, como no Discord (' + enc.h + 'p)');
  });

  console.log('erros: ' + JSON.stringify(errs));
  await b.close();
})();

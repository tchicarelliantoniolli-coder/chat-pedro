// Compartilhar a tela na call: aparece para todo mundo, para, volta, junto com a camera, para quem entra depois
// e com duas pessoas compartilhando ao mesmo tempo.
const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('ERRO ' + name + ': ' + e.message.split('\n')[0]); } };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errs = [];
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['microphone', 'camera'] }); const p = await c.newPage(); p.setDefaultTimeout(8000); p.on('pageerror', e => errs.push(e.stack)); return p; };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };
  // quadros de tela que estao mostrando imagem de verdade (o video tem tamanho)
  const screens = (p) => p.evaluate(() => [...document.querySelectorAll('#tiles .tile.screen')].map((t) => { const v = t.querySelector('video'); return { title: t.title || t.textContent, w: v ? v.videoWidth : 0, playing: !!v && !v.paused }; }));
  const live = async (p, n) => { for (let i = 0; i < 30; i++) { const s = await screens(p); if (s.filter((x) => x.w > 0 && x.playing).length === n) return s; await p.waitForTimeout(300); } return screens(p); };
  const P = await mk(); await signup(P, 'p@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1300);
  await P.click('#srvBtn'); await P.click('#invMake'); await P.waitForTimeout(300); const link = await P.inputValue('#invLink'); await P.click('#srvClose');
  const L = await mk(); await signup(L, 'l@t.com', 'Lucas'); await L.goto(link); await L.waitForTimeout(800); await L.click('#invAccept'); await L.waitForTimeout(1300);
  const M = await mk(); await signup(M, 'm@t.com', 'Maria'); await M.goto(link); await M.waitForTimeout(800); await M.click('#invAccept'); await M.waitForTimeout(1300);
  for (const p of [P, L, M]) { await p.locator('.chan.voice').first().click(); await p.waitForTimeout(1500); }
  await P.waitForTimeout(1500);

  await step('compartilhar', async () => {
    await P.click('#screenBtn');
    let s = await live(L, 1); ok(s.filter((x) => x.w > 0).length === 1, 'Lucas vê a tela do Pedro: ' + JSON.stringify(s));
    s = await live(M, 1); ok(s.filter((x) => x.w > 0).length === 1, 'Maria vê a tela do Pedro: ' + JSON.stringify(s));
    s = await live(P, 1); ok(s.filter((x) => x.w > 0).length === 1, 'Pedro vê a própria tela: ' + JSON.stringify(s));
    ok(await L.locator('#tiles .tile.screen.focus').count() === 1, 'a tela compartilhada vira o quadro grande sozinha');
    ok(await P.locator('#tiles .tile.focus').count() === 0, 'quem compartilha continua vendo a grade');
    const snd = await L.evaluate(async () => { await new Promise((r) => setTimeout(r, 1000)); const a = [...document.querySelectorAll('audio')].filter((x) => x.srcObject); return { tela: a.filter((x) => x.srcObject.getVideoTracks().length && x.srcObject.getAudioTracks().length && !x.paused).length, voz: a.filter((x) => !x.srcObject.getVideoTracks().length && x.srcObject.getAudioTracks().length && !x.paused).length }; });
    ok(snd.tela === 1 && snd.voz === 2, 'o som da tela chega separado da voz: ' + JSON.stringify(snd));
    await L.screenshot({ path: SP + '/t-tela.png' });
    await P.click('#screenBtn'); await L.waitForTimeout(1500);
    ok((await screens(L)).length === 0 && (await screens(M)).length === 0, 'parar de compartilhar some para todos');
    await P.click('#screenBtn');
    s = await live(L, 1); ok(s.filter((x) => x.w > 0).length === 1, 'compartilhar de novo aparece de novo: ' + JSON.stringify(s));
  });
  await step('camera junto', async () => {
    await P.click('#camBtn'); await L.waitForTimeout(2500);
    const s = await live(L, 1);
    const cams = await L.evaluate(() => [...document.querySelectorAll('#tiles .tile:not(.screen) video')].filter((v) => v.videoWidth > 0).length);
    ok(s.filter((x) => x.w > 0).length === 1 && cams === 1, 'câmera e tela ao mesmo tempo: tela ' + JSON.stringify(s) + ' câmeras ' + cams);
    await P.click('#camBtn'); await L.waitForTimeout(1500);
    ok((await live(L, 1)).filter((x) => x.w > 0).length === 1, 'desligar a câmera não derruba a tela');
  });
  await step('quem entra depois', async () => {
    await M.click('#leaveBtn'); await M.waitForTimeout(800);
    await M.locator('.chan.voice').first().click();
    const s = await live(M, 1); ok(s.filter((x) => x.w > 0).length === 1, 'quem entra depois vê a tela: ' + JSON.stringify(s));
  });
  await step('dois compartilhando', async () => {
    await L.click('#screenBtn');
    const s = await live(M, 2); ok(s.filter((x) => x.w > 0).length === 2, 'duas telas ao mesmo tempo: ' + JSON.stringify(s));
    await M.screenshot({ path: SP + '/t-duas.png' });
    const pedro = M.locator('.vpeople li', { hasText: 'Pedro' }).locator('.live.click');
    await pedro.click(); await M.waitForTimeout(400);
    ok(await M.locator('#tiles .tile.screen.focus .label', { hasText: 'Tela de Pedro' }).count() === 1, 'clicar no AO VIVO mostra aquela tela grande');
  });
  await step('quem compartilha sai', async () => {
    await P.click('#leaveBtn'); await M.waitForTimeout(1500);
    const s = await screens(M); ok(s.length === 1, 'quem sai leva a tela junto: ' + JSON.stringify(s));
  });
  console.log('erros:', errs.map((e) => e.split('\n').slice(0, 3).join(' | '))); await b.close(); process.exit(0);
})().catch(e => { console.error(e.message.split('\n')[0]); process.exit(1); });

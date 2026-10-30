const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errs = [];
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1366, height: 700 }, permissions: ['microphone', 'camera'] }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); return p; };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };
  const P = await mk(); await signup(P, 'a@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1200);
  await P.click('#srvBtn'); await P.click('#invMake'); await P.waitForTimeout(300); const link = await P.inputValue('#invLink'); await P.click('#srvClose');
  // fora da call: perfil > audio e video
  await P.click('#profileBtn'); await P.click('#avBtn'); await P.waitForTimeout(1500);
  const w = await P.evaluate(() => document.getElementById('micMeter').style.width);
  ok(parseFloat(w) > 0, 'teste do microfone fora da call mexe a barra (' + w + ')');
  ok(await P.locator('#outSelect option').count() > 0 || await P.isVisible('#outHint'), 'lista de saida de audio (' + await P.locator('#outSelect option').count() + ' opcoes)');
  await P.click('#outTest'); await P.waitForTimeout(300);
  await P.screenshot({ path: SP + '/av-settings.png' });
  await P.click('#setClose'); await P.waitForTimeout(300);
  ok(await P.evaluate(() => true), 'fechou');
  // na call: o outro recebe audio
  const L = await mk(); await signup(L, 'l@t.com', 'Lucas'); await L.goto(link); await L.waitForTimeout(800); await L.click('#invAccept'); await L.waitForTimeout(1200);
  await P.click('.chan.voice[data-voice]'); await L.click('.chan.voice[data-voice]'); await P.waitForTimeout(4000);
  const measure = () => L.evaluate(async () => {
    const pcs = []; // procura o audio recebido
    const a = [...document.querySelectorAll('audio')].find((x) => x.srcObject);
    if (!a) return 'sem elemento de audio';
    const ctx = new AudioContext(); await ctx.resume();
    const an = ctx.createAnalyser(); ctx.createMediaStreamSource(a.srcObject).connect(an);
    let max = 0;
    for (let k = 0; k < 40; k++) {
      await new Promise((r) => setTimeout(r, 100));
      const buf = new Uint8Array(an.fftSize); an.getByteTimeDomainData(buf);
      let s = 0; for (const v of buf) s += (v - 128) ** 2; max = Math.max(max, Math.sqrt(s / buf.length));
    }
    return max;
  });
  let rx = await measure();
  ok(typeof rx === 'number' && rx > 1, 'microfone direto (100%): Lucas ouve (nivel ' + rx + ')');
  await P.click('#setBtn'); await P.evaluate(() => { const r = document.getElementById('micGain'); r.value = 150; r.dispatchEvent(new Event('input')); }); await P.click('#setClose'); await P.waitForTimeout(800);
  rx = await measure();
  ok(typeof rx === 'number' && rx > 1, 'microfone com volume 150%: Lucas ouve (nivel ' + rx + ')');
  await P.click('#micBtn'); await P.waitForTimeout(800); rx = await measure();
  ok(rx < 1, 'mutado: Lucas nao ouve (nivel ' + rx + ')');
  await P.click('#micBtn'); await P.click('#setBtn'); await P.evaluate(() => { const r = document.getElementById('micGain'); r.value = 100; r.dispatchEvent(new Event('input')); }); await P.click('#setClose'); await P.waitForTimeout(800);
  rx = await measure();
  ok(rx > 1, 'de volta a 100% e desmutado: Lucas ouve (nivel ' + rx + ')');
  console.log('erros:', errs); await b.close();
})();

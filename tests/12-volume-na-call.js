const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errs = [];
  const mk = async (touch) => { const c = await b.newContext({ viewport: touch ? { width: 390, height: 800 } : { width: 1366, height: 700 }, permissions: ['microphone', 'camera'], hasTouch: !!touch, isMobile: !!touch }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); return p; };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };
  const P = await mk(); await signup(P, 'a@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1200);
  await P.click('#srvBtn'); await P.click('#invMake'); await P.waitForTimeout(300); const link = await P.inputValue('#invLink'); await P.click('#srvClose');
  const L = await mk(); await signup(L, 'l@t.com', 'Lucas'); await L.goto(link); await L.waitForTimeout(800); await L.click('#invAccept'); await L.waitForTimeout(1200);
  await P.click('.chan.voice[data-voice]'); await L.click('.chan.voice[data-voice]'); await P.waitForTimeout(4000);
  // o que o Pedro ouve do Lucas: o <audio> que nao esta mudo
  const level = () => P.evaluate(async () => {
    const a = [...document.querySelectorAll('audio')].find((x) => x.srcObject && !x.muted && x.srcObject.getAudioTracks().length);
    if (!a) return -1;
    const ctx = new AudioContext(); await ctx.resume();
    const an = ctx.createAnalyser(); an.fftSize = 2048; ctx.createMediaStreamSource(a.srcObject).connect(an);
    const d = new Float32Array(an.fftSize); let max = 0;
    for (let k = 0; k < 30; k++) { await new Promise((r) => setTimeout(r, 50)); an.getFloatTimeDomainData(d); for (const v of d) max = Math.max(max, Math.abs(v)); }
    ctx.close(); return max;
  });
  const base = await level();
  ok(base > 0.01, 'ouvindo o Lucas a 100% (' + base.toFixed(3) + ')');
  // botao direito no Lucas na lista do canal de voz: menu igual ao do Discord
  await P.click('.vpeople li:has-text("Lucas")', { button: 'right' }); await P.waitForTimeout(300);
  ok(await P.isVisible('#ctxMenu .uvol') && (await P.textContent('#ctxMenu')).includes('Volume do usuário'), 'menu com "Volume do usuário"');
  ok(await P.inputValue('#ctxMenu .uvr input') === '100' && await P.getAttribute('#ctxMenu .uvr input', 'max') === '200', 'barra vai de 0 a 200%, comeca em 100%');
  await P.fill('#ctxMenu .uvr input', '200'); await P.waitForTimeout(300);
  await P.screenshot({ path: SP + '/vol-menu.png' });
  ok(await P.textContent('#ctxMenu .uvt') === '200%', 'mostra a porcentagem em cima da barra');
  const loud = await level();
  ok(loud > base * 1.5, 'a 200% o som fica mais alto (' + base.toFixed(3) + ' -> ' + loud.toFixed(3) + ')');
  await P.fill('#ctxMenu .uvr input', '30'); await P.waitForTimeout(300);
  // abaixo de 100% quem abaixa e o proprio <audio> (o volume dele)
  const vol30 = await P.evaluate(() => { const a = [...document.querySelectorAll('audio')].find((x) => x.srcObject && !x.muted && x.srcObject.getAudioTracks().length); return a ? a.volume : -1; });
  ok(Math.abs(vol30 - 0.3) < 0.01, 'a 30% o som sai em 30% (' + vol30 + ')');
  ok(await P.evaluate(() => localStorage.getItem('cp-vol-lucas')) === '30', 'volume fica guardado');
  // silenciar so para mim
  await P.click('#ctxMenu .mcheck'); await P.waitForTimeout(300);
  ok(await P.evaluate(() => ![...document.querySelectorAll('audio')].some((x) => x.srcObject && !x.muted && x.srcObject.getAudioTracks().length)), 'Silenciar: para de ouvir o Lucas');
  ok(await P.isVisible('.vpeople li:has-text("Lucas") .lmute'), 'icone de silenciado por voce na lista');
  await P.click('#ctxMenu .mcheck'); await P.waitForTimeout(300);
  ok(await level() > 0, 'tirar o Silenciar volta o som');
  await P.click('#ctxMenu .mitem:has-text("Redefinir volume")'); await P.waitForTimeout(300);
  ok(await P.inputValue('#ctxMenu .uvr input') === '100', 'Redefinir volume volta para 100%');
  await P.keyboard.press('Escape'); await P.mouse.click(5, 5); await P.waitForTimeout(200);
  // o mesmo menu no quadro da pessoa na call
  await P.click('#tiles .tile:has-text("Lucas")', { button: 'right' }); await P.waitForTimeout(300);
  ok(await P.isVisible('#ctxMenu .uvol'), 'botao direito no quadro da call tambem abre o menu');
  await P.screenshot({ path: SP + '/vol-menu-quadro.png' });
  await P.mouse.click(5, 5);
  // celular: segurar o dedo abre o menu
  const M = await mk(true); await signup(M, 'm@t.com', 'Maria'); await M.goto(link); await M.waitForTimeout(800); await M.click('#invAccept'); await M.waitForTimeout(1200);
  await M.tap('#railBtn'); await M.waitForTimeout(300); await M.tap('.chan.voice[data-voice]'); await M.waitForTimeout(3000);
  const tile = await M.locator('#tiles .tile:has-text("Lucas")').boundingBox();
  if (tile) {
    const cdp = await M.context().newCDPSession(M);
    const pt = { x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] }); await M.waitForTimeout(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await M.waitForTimeout(300);
    ok(await M.isVisible('#ctxMenu .uvol'), 'no celular, segurar o dedo abre o menu');
    await M.screenshot({ path: SP + '/vol-menu-celular.png' });
  } else ok(false, 'quadro do Lucas no celular');
  console.log('erros:', errs); await b.close();
})().catch(e => { console.error(e); process.exit(1); });

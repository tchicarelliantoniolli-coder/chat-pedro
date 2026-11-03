// env: MEDIA_CACHE_MB=0
// Memoria do servidor: fotos, audios e arquivos NAO ficam guardados na memoria do servidor (o plano gratis do
// Render tem pouca). Ficam so no banco e o servidor busca quando alguem precisa. Aqui o cache e zero para
// provar que tudo vem do banco: quem entra depois ve a foto, encaminhar foto funciona e, se a foto some do
// banco, ela some da tela tambem (antes ela continuava na memoria).
const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
const H = { apikey: 'sb_secret_teste', Authorization: 'Bearer sb_secret_teste' };
const kv = async () => (await fetch('http://localhost:3330/rest/v1/chat_kv?select=key,value', { headers: H })).json();
(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1366, height: 760 } }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); return p; };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };
  const loaded = (p) => p.evaluate(() => [...document.querySelectorAll('#log img:not(.cemoji)')].filter((i) => (i.getAttribute('src') || '').startsWith('data:image/')).length);
  const P = await mk(); await signup(P, 'p@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1500);
  const photo = await P.evaluate(() => { const cv = document.createElement('canvas'); cv.width = cv.height = 120; const x = cv.getContext('2d'); x.fillStyle = '#e33'; x.fillRect(0, 0, 120, 120); x.fillStyle = '#33e'; x.fillRect(30, 30, 60, 60); return cv.toDataURL('image/webp', 0.9); });
  await P.evaluate((d) => window.ChatPedro.socket.emit('image', d, undefined, 'chat'), photo); await P.waitForTimeout(2500);
  const media = (await kv()).filter((r) => /:media:\d+$/.test(r.key));
  ok(media.length === 1 && media[0].value === photo, 'a foto foi salva no banco');
  ok(await loaded(P) === 1, 'quem mandou ve a foto na hora');
  // quem entra depois: a foto vem do banco (o servidor nao guardou na memoria)
  await P.click('#srvBtn'); await P.click('#invMake'); await P.waitForTimeout(300); const link = await P.inputValue('#invLink'); await P.click('#srvClose');
  const L = await mk(); await signup(L, 'l@t.com', 'Lucas'); await L.goto(link); await L.waitForTimeout(800); await L.click('#invAccept'); await L.waitForTimeout(2000);
  ok(await loaded(L) === 1, 'quem entra depois ve a foto (buscada no banco)');
  // encaminhar a foto tambem busca no banco
  const id = Number(media[0].key.split(':').pop());
  await P.evaluate((id) => window.ChatPedro.socket.emit('forward', { id, to: 'chat' }), id); await P.waitForTimeout(2500);
  ok(await loaded(L) === 2, 'encaminhar foto funciona: ' + await loaded(L) + ' fotos na tela de quem recebe');
  ok((await kv()).filter((r) => /:media:\d+$/.test(r.key)).length === 2, 'a foto encaminhada tambem foi salva no banco');
  // a primeira foto some do banco: o servidor nao tem copia na memoria, entao ela some da tela
  await fetch('http://localhost:3330/rest/v1/chat_kv?key=eq.' + encodeURIComponent(media[0].key), { method: 'DELETE', headers: H });
  await L.reload(); await L.waitForTimeout(2500);
  ok(await loaded(L) === 1, 'foto apagada do banco nao volta da memoria do servidor: ' + await loaded(L) + ' foto na tela');
  ok((await L.textContent('#log')).includes('não está mais guardada'), 'aparece "foto que não está mais guardada"');
  await L.screenshot({ path: SP + '/memoria.png' });
  console.log('erros:', errs); await b.close();
})().catch(e => { console.error(e); process.exit(1); });

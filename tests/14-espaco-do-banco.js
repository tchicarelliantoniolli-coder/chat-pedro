// env: STORAGE_LIMIT_MB=0.4 STORAGE_TARGET_MB=0.25 FAXINA_FIRST_MS=1500 FAXINA_MS=2000
// Espaco do banco: fotos viram WebP leve, arquivos nao sao salvos duas vezes e a faxina apaga as midias
// mais antigas quando o chat passa do limite (aqui o limite e minusculo so para o teste).
const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
const kv = async () => (await fetch('http://localhost:3330/rest/v1/chat_kv?select=key,value', { headers: { apikey: 'sb_secret_teste', Authorization: 'Bearer sb_secret_teste' } })).json();
(async () => {
  const b = await chromium.launch(); const errs = [];
  const c = await b.newContext({ viewport: { width: 1366, height: 700 } }); const P = await c.newPage(); P.on('pageerror', e => errs.push(e.message));
  await P.goto(URL); await P.waitForTimeout(500); await P.click('#tabSignup'); await P.fill('#authEmail', 'Pedro@T.com'); await P.fill('#authNick', 'Pedro'); await P.fill('#authPass', 'senha123'); await P.click('#authGo'); await P.waitForTimeout(900);
  ok(await P.isVisible('#createName'), 'e-mail com maiuscula: cria a conta e entra direto');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1500);
  // foto grande (3000x2000, cheia de detalhe) feita na hora
  const png = await P.evaluate(() => { const cv = document.createElement('canvas'); cv.width = 3000; cv.height = 2000; const x = cv.getContext('2d'); for (let i = 0; i < 6000; i++) { x.fillStyle = 'hsl(' + (i * 37 % 360) + ',70%,' + (30 + i % 50) + '%)'; x.fillRect(Math.random() * 3000, Math.random() * 2000, 40 + Math.random() * 120, 40 + Math.random() * 120); } return cv.toDataURL('image/png').split(',')[1]; });
  const buf = Buffer.from(png, 'base64');
  await P.setInputFiles('#file', { name: 'grande.png', mimeType: 'image/png', buffer: buf }); await P.waitForTimeout(1500);
  const rows = await kv();
  const media = rows.filter((r) => /:media:/.test(r.key));
  ok(media.length === 1 && media[0].value.startsWith('data:image/webp'), 'foto vai em WebP: ' + (media[0] ? media[0].value.slice(0, 20) : 'nada'));
  ok(media.length === 1 && media[0].value.length < 1024 * 1024, 'foto de ' + Math.round(buf.length / 1024) + ' KB chegou com ' + Math.round((media[0] || { value: '' }).value.length / 1024) + ' KB (no maximo 1 MB)');
  // arquivo: so uma copia no banco (antes ia tambem dentro do historico)
  await P.evaluate(() => window.ChatPedro.socket.emit('file', { name: 'nota.txt', size: 2000, data: 'data:text/plain;base64,' + btoa('x'.repeat(2000)) }, undefined, 'chat'));
  await P.waitForTimeout(2500);
  const hist = (await kv()).find((r) => r.key.endsWith(':history'));
  ok(hist && !hist.value.includes(btoa('x'.repeat(30))), 'arquivo nao fica guardado dentro do historico (so uma copia)');
  // enche o chat com fotos pesadas: a faxina apaga as mais antigas e o texto fica
  await P.fill('#input', 'mensagem de texto que nao pode sumir'); await P.press('#input', 'Enter');
  const noise = await P.evaluate(() => { const out = []; for (let n = 0; n < 6; n++) { const cv = document.createElement('canvas'); cv.width = cv.height = 260; const x = cv.getContext('2d'); const d = x.createImageData(260, 260); for (let i = 0; i < d.data.length; i++) d.data[i] = (Math.random() * 256) | 0; x.putImageData(d, 0, 0); out.push(cv.toDataURL('image/webp', 0.9)); } return out; });
  for (const d of noise) { await P.evaluate((d) => window.ChatPedro.socket.emit('image', d, undefined, 'chat'), d); await P.waitForTimeout(250); }
  await P.waitForTimeout(5000);
  const after = (await kv());
  const total = after.reduce((n, r) => n + Buffer.byteLength(r.value || ''), 0);
  const left = after.filter((r) => /:media:/.test(r.key)).length;
  // mandou 8 midias (1 foto + 1 arquivo + 6 fotos pesadas): a faxina ja pode ter passado no meio do envio
  ok(left < 8 && total <= 0.4 * 1024 * 1024, 'faxina apagou midias antigas: 8 enviadas, ' + left + ' guardadas (chat com ' + Math.round(total / 1024) + ' KB)');
  ok(!after.some((r) => r.key.endsWith(':media:1')), 'a primeira foto (a mais antiga) foi a que saiu');
  const imgs = await P.locator('#log img:not(.cemoji)').count();
  ok(imgs === left - 1 || imgs <= left, 'fotos apagadas somem da tela tambem (' + imgs + ' na tela)');
  ok((await P.textContent('#log')).includes('mensagem de texto que nao pode sumir'), 'mensagem de texto continua');
  await P.screenshot({ path: SP + '/faxina.png' });
  console.log('erros:', errs); await b.close();
})().catch(e => { console.error(e); process.exit(1); });

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
  const P = await mk();
  // cada pessoa abre UMA conexao em tempo real (o chat e o painel adm dividem a mesma)
  const ws = []; P.on('websocket', (w) => { if (w.url().includes('/socket.io/')) ws.push(w); });
  await signup(P, 'p@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1500);
  const polls = []; P.on('request', (r) => { if (r.url().includes('transport=polling')) polls.push(r.url()); });
  ws.length = 0; await P.reload(); await P.waitForTimeout(2500);
  ok(polls.length === 0, 'a conexao comeca direto pelo WebSocket (sem pedidos de "polling" antes): ' + polls.length);
  ok(ws.filter((w) => !w.isClosed()).length === 1, 'uma conexao so com o servidor por pessoa: ' + ws.filter((w) => !w.isClosed()).length + ' abertas');
  // arquivos do site com a versao no endereco: o navegador guarda e nao pergunta de novo a cada visita
  const scripts = await P.evaluate(() => [...document.scripts].map((s) => s.getAttribute('src')).filter((s) => s && s.startsWith('/')));
  ok(scripts.length >= 12 && scripts.every((s) => /\?v=[0-9a-f]{12}$/.test(s)), 'scripts com a versao no endereco: ' + scripts.slice(0, 3).join(' '));
  const cc = (await fetch(URL + (scripts.find((s) => s.startsWith('/boot.js')) || '/boot.js'))).headers.get('cache-control') || '';
  ok(/immutable/.test(cc) && /max-age=31536000/.test(cc), 'script com versao fica guardado no navegador: ' + cc);
  const page = await fetch(URL + '/s/qualquer'); const pcc = page.headers.get('cache-control') || '';
  ok(/no-cache/.test(pcc) && (await page.text()).includes('/boot.js?v='), 'a pagina em si e sempre conferida (para pegar versao nova): ' + pcc);
  ok((await fetch(URL + '/sw.js')).headers.get('cache-control') !== cc, 'arquivo sem versao continua sendo conferido');
  // aviso de versao nova continua chegando pelo canal unico: recarrega sozinho e a mensagem escrita volta
  await P.fill('#input', 'rascunho que nao pode sumir');
  const reloaded = P.waitForEvent('load', { timeout: 8000 }).then(() => true, () => false);
  await P.evaluate(() => window.ChatPedroAdmSocket.listeners('site:version').forEach((f) => f('versao-nova')));
  ok(await reloaded, 'versao nova do site: a pagina recarrega sozinha');
  await P.waitForTimeout(2500);
  ok(await P.inputValue('#input') === 'rascunho que nao pode sumir', 'o texto da caixa de mensagem volta depois de recarregar');
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
  // controles do Supabase falso (so para os testes)
  const fake = async (q) => (await fetch('http://localhost:3330/__test' + (q ? '?' + q : ''), { headers: H })).json();
  const id2 = Number((await kv()).find((r) => /:media:\d+$/.test(r.key)).key.split(':').pop());
  const ask = (p, id) => p.evaluate((id) => new Promise((r) => { const t0 = performance.now(); window.ChatPedro.socket.emit('media', id, (src) => r({ ms: performance.now() - t0, ok: typeof src === 'string', src: src === false ? 'false' : src === null ? 'null' : 'texto' })); }), id);
  // 6 pedidos da mesma foto ao mesmo tempo: uma leitura so no banco
  await fake('leiturasMidia=0&leituraLentaMs=500');
  await L.evaluate((id) => Promise.all([1, 2, 3, 4, 5, 6].map(() => new Promise((r) => window.ChatPedro.socket.emit('media', id, r)))), id2);
  await fake('leituraLentaMs=0');
  ok((await fake()).leiturasMidia === 1, 'a mesma foto pedida 6 vezes juntas vira 1 leitura no banco: ' + (await fake()).leiturasMidia);
  // gravacao lenta no banco (foto nova grande chegando): as fotos que ja estao salvas nao ficam esperando ela
  await fake('gravacaoLentaMs=3000');
  await P.evaluate((d) => window.ChatPedro.socket.emit('image', d, undefined, 'chat'), photo); await P.waitForTimeout(300);
  const slow = await ask(L, id2);
  ok(slow.ok && slow.ms < 1500, 'foto antiga chega sem esperar a gravacao lenta de outra: ' + Math.round(slow.ms) + ' ms');
  await fake('gravacaoLentaMs=0'); await P.waitForTimeout(3500);
  // o banco falha na hora: a foto NAO vira "nao esta mais guardada"; o navegador tenta de novo e ela aparece
  await fake('falhaMidia=1');
  ok((await ask(L, id2)).src === 'false', 'falha do banco responde diferente de "foto apagada"');
  await L.reload(); await L.waitForTimeout(2500);
  ok(!(await L.textContent('#log')).includes('não está mais guardada') && await loaded(L) === 0, 'com o banco falhando a foto espera (nao diz que sumiu)');
  await P.evaluate((id) => window.ChatPedro.socket.emit('forward', { id, to: 'chat' }), id2); await P.waitForTimeout(1500);
  ok((await P.textContent('body')).includes('Não deu para encaminhar agora'), 'encaminhar com o banco falhando avisa quem encaminhou');
  await fake('falhaMidia=0'); await L.waitForTimeout(5000);
  ok(await loaded(L) >= 1, 'quando o banco volta a foto aparece sozinha: ' + await loaded(L) + ' na tela');
  // banido nao entra, mesmo que ainda conste como membro (as checagens da conexao agora vao juntas ao banco)
  const sid = await P.evaluate(() => location.pathname.split('/').pop());
  const lid = await L.evaluate(() => window.ChatPedroAuth.api('/api/me').then((r) => r.user.id));
  await P.evaluate((id) => window.ChatPedro.socket.emit('admin:ban', { id, minutes: 0 }), lid); await P.waitForTimeout(1500);
  await fetch('http://localhost:3330/rest/v1/server_members', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify([{ server_id: sid, user_id: lid, role: 'member' }]) });
  await L.goto(URL + '/s/' + sid); await L.waitForTimeout(2500);
  ok((await L.textContent('body')).includes('Você está banido desse servidor.'), 'banido nao consegue entrar no servidor');
  await fetch('http://localhost:3330/rest/v1/server_bans?user_id=eq.' + lid, { method: 'DELETE', headers: H });
  // rede que bloqueia WebSocket: cai no "polling" e o chat funciona igual
  // (o WebSocket da erro ao abrir, como numa rede que barra)
  const B = await mk();
  await B.addInitScript(() => { const W = window.WebSocket; window.WebSocket = function (url, p) { if (!String(url).includes('/socket.io/')) return new W(url, p); const f = new EventTarget(); f.readyState = 0; f.send = () => {}; f.close = () => {}; setTimeout(() => { f.readyState = 3; const e = new Event('error'); f.onerror && f.onerror(e); f.dispatchEvent(e); const c = new CloseEvent('close', { code: 1006 }); f.onclose && f.onclose(c); f.dispatchEvent(c); }, 50); return f; }; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); });
  await B.goto(URL); await B.waitForTimeout(500); await B.fill('#authEmail', 'l@t.com'); await B.fill('#authPass', 'senha123'); await B.click('#authGo'); await B.waitForTimeout(4000);
  await B.fill('#input', 'mensagem sem websocket'); await B.press('#input', 'Enter'); await P.waitForTimeout(1500);
  ok(await P.locator('#log .txt', { hasText: 'mensagem sem websocket' }).count() === 1, 'sem WebSocket o chat funciona pelo polling');
  // rede que segura o WebSocket (nem abre nem da erro): depois do tempo limite cai no polling
  const Z = await mk();
  await Z.addInitScript(() => { const W = window.WebSocket; window.WebSocket = function (url, p) { if (!String(url).includes('/socket.io/')) return new W(url, p); const f = new EventTarget(); f.readyState = 0; f.send = () => {}; f.close = () => {}; return f; }; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); });
  await Z.goto(URL); await Z.waitForTimeout(500); await Z.fill('#authEmail', 'l@t.com'); await Z.fill('#authPass', 'senha123'); await Z.click('#authGo');
  await Z.waitForFunction(() => window.ChatPedro.socket.connected, null, { timeout: 45000 }).catch(() => {});
  await Z.fill('#input', 'mensagem com websocket travado'); await Z.press('#input', 'Enter'); await P.waitForTimeout(1500);
  ok(await P.locator('#log .txt', { hasText: 'mensagem com websocket travado' }).count() === 1, 'WebSocket travado: o chat conecta pelo polling');
  console.log('erros:', errs); await b.close();
})().catch(e => { console.error(e); process.exit(1); });

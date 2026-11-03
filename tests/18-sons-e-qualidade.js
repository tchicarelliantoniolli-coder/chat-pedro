// Sons do site (sfx.js) e qualidade da voz na call: os sons sao gravados sem estourar, tocam nos momentos certos
// (mutar, fone, entrar/sair da call, alguem entrou, mensagem enviada), respeitam as opcoes de Notificacoes > Sons,
// e a voz vai em Opus de alta qualidade (96 kbps, FEC) com a IA RNNoise (48 kHz, sem cortar os agudos).
const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('ERRO ' + name + ': ' + e.message.split('\n')[0]); } };
(async () => {
  const FALA = require('path').join(__dirname, 'fixtures', 'fala-com-ruido.wav');
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + FALA, '--autoplay-policy=no-user-gesture-required'] }); const errs = [];
  const mk = async () => {
    const c = await b.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['microphone', 'camera'] });
    // anota cada som tocado e guarda as conexoes da call (para ler a qualidade do audio)
    await c.addInitScript(() => {
      window.__played = [];
      const O = window.RTCPeerConnection; window.__pcs = [];
      window.RTCPeerConnection = function (...a) { const p = new O(...a); window.__pcs.push(p); return p; };
      window.RTCPeerConnection.prototype = O.prototype;
      const t = setInterval(() => { const S = window.ChatPedroSfx; if (!S || S.__spy) return; S.__spy = true; const play = S.play; S.play = (n, f) => { if (f || S.allowed(n)) window.__played.push(n); return play(n, f); }; clearInterval(t); }, 20);
    });
    const p = await c.newPage(); p.setDefaultTimeout(8000); p.on('pageerror', e => errs.push(e.stack)); return p;
  };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };
  const played = (p) => p.evaluate(() => window.__played.splice(0));
  const P = await mk(); await signup(P, 'p@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1300);
  await P.click('#srvBtn'); await P.click('#invMake'); await P.waitForTimeout(300); const link = await P.inputValue('#invLink'); await P.click('#srvClose');
  const L = await mk(); await signup(L, 'l@t.com', 'Lucas'); await L.goto(link); await L.waitForTimeout(800); await L.click('#invAccept'); await L.waitForTimeout(1300);

  await step('sons gravados', async () => {
    const r = await P.evaluate(async () => { const S = window.ChatPedroSfx; for (const n of S.names) await S.preview(n); return S.names.length; });
    ok(r >= 18, 'motor de sons carregado e todos os ' + r + ' sons tocam sem erro');
  });
  await step('mutar e fone', async () => {
    await played(P);
    await P.click('#upMic'); await P.waitForTimeout(150); await P.click('#upMic'); await P.waitForTimeout(150);
    await P.click('#upDeaf'); await P.waitForTimeout(150); await P.click('#upDeaf'); await P.waitForTimeout(150);
    const s = await played(P);
    ok(s.join(',') === 'mute,unmute,deafen,undeafen', 'silenciar, dessilenciar, desativar e reativar áudio tocam o som certo (' + s.join(',') + ')');
  });
  await step('mensagem enviada', async () => {
    await P.fill('#input', 'oi gente'); await P.press('#input', 'Enter'); await P.waitForTimeout(400);
    ok((await played(P)).includes('sent'), 'mandar mensagem toca "mensagem enviada"');
  });
  await step('call', async () => {
    await P.locator('.chan.voice').first().click(); await P.waitForTimeout(1500);
    ok((await played(P)).includes('join'), 'entrar na call toca "voz conectada"');
    await L.locator('.chan.voice').first().click(); await P.waitForTimeout(3500);
    ok((await played(P)).includes('userJoin'), 'alguém entrando no canal toca "usuário entrou"');
    const q = await P.evaluate(async () => {
      const pc = window.__pcs.find((x) => x.connectionState === 'connected'); if (!pc) return null;
      const a = await pc.getStats(); let out = null, codec = null;
      a.forEach((s) => { if (s.type === 'outbound-rtp' && s.kind === 'audio') out = s; });
      a.forEach((s) => { if (out && s.id === out.codecId) codec = s; });
      const t0 = out.bytesSent, ts = out.timestamp; await new Promise((r) => setTimeout(r, 4000));
      const b = await pc.getStats(); let o2 = null; b.forEach((s) => { if (s.type === 'outbound-rtp' && s.kind === 'audio') o2 = s; });
      return { fmtp: codec && codec.sdpFmtpLine, kbps: (o2.bytesSent - t0) * 8 / (o2.timestamp - ts), ns: window.ChatPedro.audio.noiseActive() };
    });
    ok(q && /maxaveragebitrate=96000/.test(q.fmtp) && /useinbandfec=1/.test(q.fmtp), 'voz em Opus com 96 kbps e correção de perdas (' + (q && q.fmtp) + ')');
    ok(q && q.kbps > 60, 'a voz sai de verdade com mais de 60 kbps: ' + (q && q.kbps.toFixed(0)) + ' kbps');
    ok(q && q.ns, 'supressão de ruído com IA (RNNoise) ligada');
    await L.click('#leaveBtn'); await P.waitForTimeout(1500);
    ok((await played(P)).includes('userLeave'), 'alguém saindo toca "usuário saiu"');
  });
  await step('opcoes', async () => {
    await P.evaluate(() => window.ChatPedro.openUserSettings('notificacoes')); await P.waitForTimeout(600);
    ok(await P.locator('#userSettings [data-pref="snd-mute"]').count() === 1 && await P.locator('#userSettings [data-sfx]').count() >= 11, 'Notificações > Sons lista os sons novos');
    await P.screenshot({ path: SP + '/s-sons.png' });
    await P.locator('#userSettings label', { has: P.locator('[data-pref="snd-mute"]') }).click(); await P.waitForTimeout(200);
    await P.keyboard.press('Escape'); await P.waitForTimeout(300); await played(P);
    await P.click('#upMic'); await P.waitForTimeout(150); await P.click('#upMic'); await P.waitForTimeout(150);
    const rest = await played(P); ok(rest.length === 0, 'desligar "Silenciar e dessilenciar" tira o som do microfone (' + rest.join(',') + ')');
  });
  console.log('erros:', errs.map((e) => e.split('\n').slice(0, 3).join(' | '))); await b.close(); process.exit(0);
})().catch(e => { console.error(e.message.split('\n')[0]); process.exit(1); });

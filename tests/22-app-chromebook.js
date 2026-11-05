// App instalavel (Chromebook, Android, Chrome/Edge no computador): manifesto e icones, o Chrome aceita instalar,
// botao "Instalar o app" na barra de servidores, numero de nao lidas no icone do app e tela "Sem conexao".
const { chromium } = require('playwright');
const SP = process.argv[2] || require('path').join(__dirname, 'out'), URL = 'http://localhost:3331';
const ok = (c, msg) => console.log((c ? 'OK   ' : 'FALHA') + ' ' + msg);
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('ERRO ' + name + ': ' + e.message.split('\n')[0]); } };
(async () => {
  const b = await chromium.launch(); const errs = [];
  // Chromebook: tela 1366x768 e o navegador do ChromeOS
  const UA = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const mk = async (init) => {
    const c = await b.newContext({ viewport: { width: 1366, height: 768 }, userAgent: UA }); const p = await c.newPage();
    p.setDefaultTimeout(10000); p.on('pageerror', e => errs.push(e.stack));
    if (init) await p.addInitScript(init);
    return p;
  };
  const signup = async (p, email, nick) => { await p.goto(URL); await p.waitForTimeout(500); await p.click('#tabSignup'); await p.fill('#authEmail', email); await p.fill('#authNick', nick); await p.fill('#authPass', 'senha123'); await p.click('#authGo'); await p.waitForTimeout(900); };

  await step('manifesto e icones', async () => {
    const r = await fetch(URL + '/manifest.webmanifest');
    ok(r.ok && /manifest\+json/.test(r.headers.get('content-type') || ''), 'manifesto servido como manifest+json');
    const m = await r.json();
    ok(m.name === 'Chat Pedro' && m.display === 'standalone' && m.start_url === '/', 'manifesto: nome, janela propria e pagina inicial');
    for (const ic of m.icons) {
      const x = await fetch(URL + ic.src); const buf = Buffer.from(await x.arrayBuffer());
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
      ok(x.ok && ic.sizes === w + 'x' + h, 'icone ' + ic.src + ' existe e tem ' + ic.sizes);
    }
    ok(m.icons.some((i) => i.purpose === 'maskable'), 'tem icone mascaravel (Android/ChromeOS recortam o icone)');
  });

  const P = await mk();
  await signup(P, 'p@t.com', 'Pedro');
  await P.fill('#createName', 'Galera'); await P.click('#createForm button[type=submit]'); await P.waitForTimeout(1500);

  await step('o Chrome aceita instalar', async () => {
    const cdp = await P.context().newCDPSession(P);
    const man = await cdp.send('Page.getAppManifest');
    ok(man.url.endsWith('/manifest.webmanifest') && !(man.errors || []).length, 'pagina aponta para o manifesto, sem erros (' + JSON.stringify(man.errors) + ')');
    await P.evaluate(() => navigator.serviceWorker.ready);
    const inst = await cdp.send('Page.getInstallabilityErrors');
    ok(!inst.installabilityErrors.length, 'nada impede a instalacao (' + JSON.stringify(inst.installabilityErrors.map((e) => e.errorId)) + ')');
  });

  await step('botao Instalar o app', async () => {
    ok(!(await P.isVisible('#railInstall')), 'sem o navegador oferecer, o botao fica escondido');
    await P.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      window.__prompted = 0;
      e.prompt = () => { window.__prompted++; return Promise.resolve(); };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
      window.__defaulted = e.defaultPrevented;
    });
    ok(await P.evaluate(() => window.__defaulted), 'a faixa automatica do navegador nao aparece (o botao fica na barra)');
    ok(await P.isVisible('#railInstall'), 'botao "Instalar o app" aparece na barra de servidores');
    ok(!(await P.isVisible('#railDl')), 'botao do instalador do Windows nao aparece no Chromebook');
    await P.screenshot({ path: SP + '/22-instalar.png' });
    await P.click('#railInstall'); await P.waitForTimeout(200);
    ok(await P.evaluate(() => window.__prompted) === 1, 'clicar abre a janela de instalacao do navegador');
    ok(!(await P.isVisible('#railInstall')), 'depois de instalar o botao some');
  });

  await step('numero no icone do app', async () => {
    // app instalado: a janela abre em "standalone"; o icone do app recebe o numero (navigator.setAppBadge)
    const A = await mk(() => {
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/display-mode: standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q));
      window.__badge = [];
      navigator.setAppBadge = (n) => { window.__badge.push(n); return Promise.resolve(); };
      navigator.clearAppBadge = () => { window.__badge.push(0); return Promise.resolve(); };
    });
    await A.goto(URL + '/'); await A.waitForTimeout(1500);
    ok(await A.evaluate(() => document.documentElement.classList.contains('pwa')), 'app instalado e reconhecido (html.pwa)');
    await A.evaluate(() => {
      window.ChatPedro.onAlert({ mentioned: true, dm: false, away: true, busy: false });
      window.ChatPedro.onAlert({ mentioned: false, dm: true, away: true, busy: false });
      window.ChatPedro.onAlert({ mentioned: false, dm: false, away: true, busy: false }); // mensagem comum: nao conta
      window.ChatPedro.onAlert({ mentioned: false, dm: true, away: true, busy: true }); // Nao perturbe: nao conta
    });
    ok(await A.evaluate(() => window.__badge.at(-1)) === 2, 'mencao e mensagem direta com o app em segundo plano: numero 2 no icone');
    await A.evaluate(() => window.dispatchEvent(new Event('focus')));
    ok(await A.evaluate(() => window.__badge.at(-1)) === 0, 'voltar para o app limpa o numero');
    await A.context().close();
  });

  await step('tela sem conexao', async () => {
    await P.evaluate(() => navigator.serviceWorker.ready);
    await P.reload(); await P.waitForTimeout(800); // a pagina passa a ser controlada pelo service worker
    ok(await P.evaluate(() => !!navigator.serviceWorker.controller), 'service worker cuidando da pagina');
    await P.context().setOffline(true);
    await P.goto(URL + '/').catch(() => {});
    await P.waitForTimeout(500);
    ok(/Sem conexão/.test(await P.textContent('body').catch(() => '')), 'sem internet aparece "Sem conexão" do Chat Pedro (nao o erro do navegador)');
    await P.screenshot({ path: SP + '/22-sem-conexao.png' });
    await P.context().setOffline(false);
    await P.locator('#rail').waitFor({ state: 'attached', timeout: 13000 }).catch(() => {});
    ok(await P.locator('#rail').count() === 1, 'internet voltou: o Chat Pedro abre sozinho');
  });

  console.log('erros: ' + JSON.stringify(errs));
  await b.close();
})();

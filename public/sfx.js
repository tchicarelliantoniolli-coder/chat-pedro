// Sons do Chat Pedro (mensagem, mencao, mutar, ensurdecer, entrar e sair da call, tela, apertar para falar,
// atividades...). Mesmos momentos em que o Discord toca som, mas os sons sao NOSSOS: feitos aqui no navegador,
// sem nenhum arquivo de audio (os do Discord sao dele). Cada som e "gravado" uma vez em 48 kHz estereo
// (OfflineAudioContext) com notas suaves (marimba, sino, vidro), ataque sem estalo e um pouco de eco de sala;
// depois so toca o resultado pronto, sem pesar nada.
//   window.ChatPedroSfx.play("message")  ->  toca se a pessoa deixou esse som ligado
//   window.ChatPedroSfx.bus()            ->  saida com o eco de sala (o ring.js usa para os toques de chamada)
(() => {
  const SR = 48000;
  const AC = window.AudioContext || window.webkitAudioContext;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const app = () => window.ChatPedro || {};
  const P = (k) => (window.ChatPedroPrefs ? window.ChatPedroPrefs.get(k) : true);
  const st = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } } };
  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // ---------- instrumentos ----------
  // envelope sem estalo: sobe em poucos milissegundos e cai como uma nota de verdade
  // devolve quando a nota acaba de verdade (ja em silencio): o oscilador so para depois disso, sem estalo
  function env(c, g, t, vol, attack, decay) {
    const top = t + attack, end = top + decay * 7; // e^-7: -60 dB
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, top);
    g.gain.exponentialRampToValueAtTime(Math.max(1e-6, vol * 0.0009), end);
    g.gain.linearRampToValueAtTime(0, end + 0.006);
    c.__end = Math.max(c.__end || 0, end + 0.01);
    return end + 0.01;
  }
  function osc(c, type, f, t) {
    const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.start(t); (c.__osc = c.__osc || []).push(o); return o;
  }
  function panTo(c, out, pan) {
    if (!pan || !c.createStereoPanner) return out;
    const p = c.createStereoPanner(); p.pan.value = pan; p.connect(out); return p;
  }
  // marimba: fundamental redonda + parciais de madeira (4x e 10x) que somem rapido
  function marimba(c, out, t, midi, { vol = 0.5, len = 0.5, pan = 0 } = {}) {
    const f = hz(midi), dst = panTo(c, out, pan);
    for (const [mult, part, dec] of [[1, 1, len / 3], [4, 0.22, len / 14], [10, 0.05, len / 30]]) {
      if (f * mult > 18000) continue;
      const g = c.createGain(); env(c, g, t, vol * part, 0.003, dec);
      osc(c, "sine", f * mult, t).connect(g).connect(dst);
    }
  }
  // sino de vidro (FM): brilho que abre e fecha, como um "plim"
  function glass(c, out, t, midi, { vol = 0.3, len = 0.8, ratio = 3.5, index = 1.6, pan = 0 } = {}) {
    const f = hz(midi), dst = panTo(c, out, pan);
    const car = osc(c, "sine", f, t), mod = osc(c, "sine", f * ratio, t);
    const mg = c.createGain();
    mg.gain.setValueAtTime(f * index, t); mg.gain.setTargetAtTime(0, t, len / 5);
    mod.connect(mg).connect(car.frequency);
    const g = c.createGain(); env(c, g, t, vol, 0.004, len / 3.2);
    car.connect(g).connect(dst);
  }
  // nota macia (sine + um pouco de 2a harmonica, filtrada): fundo dos acordes
  function soft(c, out, t, midi, { vol = 0.25, len = 0.6, attack = 0.015, pan = 0, glide = 0 } = {}) {
    const f = hz(midi), dst = panTo(c, out, pan);
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = Math.min(16000, f * 6); lp.Q.value = 0.3;
    const g = c.createGain(); env(c, g, t, vol, attack, len / 3);
    for (const [mult, part] of [[1, 1], [2, 0.18]]) {
      const o = osc(c, "sine", f * mult, t);
      if (glide) { o.frequency.setValueAtTime(f * mult * Math.pow(2, glide / 12), t); o.frequency.exponentialRampToValueAtTime(f * mult, t + 0.06); }
      const pg = c.createGain(); pg.gain.value = part; o.connect(pg).connect(lp);
    }
    lp.connect(g).connect(dst);
  }
  // "toc" curtinho com a altura escorregando (mutar, apertar para falar, enviar)
  function blip(c, out, t, f1, f2, { vol = 0.35, len = 0.09, pan = 0 } = {}) {
    const dst = panTo(c, out, pan);
    const o = osc(c, "sine", f1, t);
    o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + len * 0.7);
    const o2 = osc(c, "triangle", f1 * 2, t);
    o2.frequency.setValueAtTime(f1 * 2, t); o2.frequency.exponentialRampToValueAtTime(f2 * 2, t + len * 0.7);
    const g = c.createGain(); env(c, g, t, vol, 0.002, len / 2.5);
    const g2 = c.createGain(); env(c, g2, t, vol * 0.12, 0.002, len / 4);
    o.connect(g).connect(dst); o2.connect(g2).connect(dst);
  }

  // ---------- os sons (melodias nossas, em re maior) ----------
  // cada um: [duracao aproximada em segundos, quanto de eco (0 a 1), funcao que toca as notas]
  const D5 = 74, E5 = 76, Fs5 = 78, A5 = 81, B5 = 83, D6 = 86, E6 = 88, Fs6 = 90, A6 = 93, B6 = 95, D7 = 98, A4 = 69, D4 = 62, Fs4 = 66;
  const SOUNDS = {
    // mensagem (DM, canal com aviso): duas gotas de marimba subindo
    message: [0.7, 0.22, (c, o, t) => { marimba(c, o, t, A5, { vol: 0.42 }); marimba(c, o, t + 0.085, E6, { vol: 0.4 }); glass(c, o, t + 0.085, E6 + 12, { vol: 0.05, len: 0.5 }); }],
    // mencao: tres notas com sino por cima (chama mais atencao)
    mention: [0.9, 0.25, (c, o, t) => { [Fs6, A6, D7].forEach((n, i) => { glass(c, o, t + i * 0.075, n, { vol: 0.2, len: 0.7, ratio: 2, index: 1.2 }); marimba(c, o, t + i * 0.075, n - 12, { vol: 0.3 }); }); }],
    // mutar / desmutar: "toc" descendo / subindo
    mute: [0.35, 0.12, (c, o, t) => { blip(c, o, t, 900, 700, { vol: 0.3 }); blip(c, o, t + 0.07, 640, 470, { vol: 0.28 }); }],
    unmute: [0.35, 0.12, (c, o, t) => { blip(c, o, t, 470, 640, { vol: 0.28 }); blip(c, o, t + 0.07, 700, 900, { vol: 0.3 }); }],
    // ensurdecer / reativar audio: tres notas, mais grave que o mudo
    deafen: [0.6, 0.15, (c, o, t) => { [A5, E5, A4].forEach((n, i) => soft(c, o, t + i * 0.06, n, { vol: 0.28, len: 0.25, attack: 0.004 })); }],
    undeafen: [0.6, 0.15, (c, o, t) => { [A4, E5, A5].forEach((n, i) => soft(c, o, t + i * 0.06, n, { vol: 0.28, len: 0.25, attack: 0.004 })); }],
    // voce entrou na call (voz conectada) / saiu (desconectado)
    join: [1.2, 0.3, (c, o, t) => { [D5, Fs5, A5, D6].forEach((n, i) => marimba(c, o, t + i * 0.07, n, { vol: 0.32, len: 0.7, pan: -0.15 + i * 0.1 })); glass(c, o, t + 0.21, D7, { vol: 0.08, len: 0.9, ratio: 2 }); soft(c, o, t, D4, { vol: 0.12, len: 0.9, attack: 0.04 }); }],
    leave: [1.0, 0.28, (c, o, t) => { [D6, A5, Fs5, D5].forEach((n, i) => marimba(c, o, t + i * 0.075, n, { vol: 0.3, len: 0.6, pan: 0.15 - i * 0.1 })); soft(c, o, t + 0.2, D4, { vol: 0.1, len: 0.7, attack: 0.05 }); }],
    // outra pessoa entrou / saiu do seu canal de voz
    userJoin: [0.8, 0.25, (c, o, t) => { marimba(c, o, t, Fs5, { vol: 0.32, pan: -0.1 }); marimba(c, o, t + 0.09, B5, { vol: 0.32, pan: 0.1 }); glass(c, o, t + 0.09, B6, { vol: 0.05 }); }],
    userLeave: [0.8, 0.25, (c, o, t) => { marimba(c, o, t, B5, { vol: 0.3, pan: 0.1 }); marimba(c, o, t + 0.09, Fs5, { vol: 0.3, pan: -0.1 }); }],
    // tela compartilhada comecou / terminou (sua ou de alguem do canal)
    streamStart: [1.1, 0.32, (c, o, t) => { [D6, E6, A6, D7].forEach((n, i) => glass(c, o, t + i * 0.05, n, { vol: 0.13, len: 0.8, ratio: 2.01, index: 0.8, pan: -0.2 + i * 0.13 })); soft(c, o, t, A4, { vol: 0.12, len: 0.8, attack: 0.03 }); }],
    streamEnd: [1.0, 0.3, (c, o, t) => { [D7, A6, E6, D6].forEach((n, i) => glass(c, o, t + i * 0.055, n, { vol: 0.12, len: 0.7, ratio: 2.01, index: 0.8, pan: 0.2 - i * 0.13 })); }],
    // apertar para falar: liga / solta
    pttOn: [0.2, 0.05, (c, o, t) => blip(c, o, t, 1100, 1400, { vol: 0.55, len: 0.06 })],
    pttOff: [0.2, 0.05, (c, o, t) => blip(c, o, t, 1100, 850, { vol: 0.5, len: 0.06 })],
    // atividade (poker, truco, Mesa do Blefe, YouTube junto) comecou
    activity: [1.2, 0.32, (c, o, t) => { [A5, D6, Fs6, A6, D7].forEach((n, i) => glass(c, o, t + i * 0.045, n, { vol: 0.12, len: 0.7, ratio: 3, index: 1, pan: -0.25 + i * 0.12 })); marimba(c, o, t, D5, { vol: 0.25, len: 0.8 }); }],
    // mensagem enviada e reacao: bem baixinhos, so para a tela nao ficar "muda"
    sent: [0.25, 0.08, (c, o, t) => blip(c, o, t, 520, 860, { vol: 0.3, len: 0.07 })],
    react: [0.3, 0.1, (c, o, t) => { blip(c, o, t, 900, 1300, { vol: 0.3, len: 0.06 }); marimba(c, o, t + 0.03, E6 + 12, { vol: 0.08, len: 0.25 }); }],
    // botao "Testar" da saida de som (Voz e video)
    test: [1.3, 0.3, (c, o, t) => { [D5, A5, Fs6].forEach((n, i) => marimba(c, o, t + i * 0.12, n, { vol: 0.35, len: 0.8 })); soft(c, o, t + 0.36, D6, { vol: 0.15, len: 0.9, attack: 0.03 }); }],
  };

  // ---------- quando cada som pode tocar ----------
  // grupo -> chave da preferencia (Notificacoes > Sons)
  const PREF = {
    message: "snd-dm", mention: "snd-mention", mute: "snd-mute", unmute: "snd-mute", deafen: "snd-deafen", undeafen: "snd-deafen",
    join: "snd-voice", leave: "snd-voice", userJoin: "snd-user", userLeave: "snd-user", streamStart: "snd-stream", streamEnd: "snd-stream",
    pttOn: "snd-ptt", pttOff: "snd-ptt", activity: "snd-activity", sent: "snd-sent", react: "snd-react",
  };
  const NOTIF = new Set(["message", "mention"]);      // avisos: param com "Desativar todos" e em "Não perturbe"
  const ALWAYS = new Set(["mute", "unmute", "deafen", "undeafen", "test"]); // tocam mesmo com o fone desativado (como no Discord)
  function allowed(name) {
    const a = app();
    if (PREF[name] && !P(PREF[name])) return false;
    if (ALWAYS.has(name)) return true;
    if (a.isDeaf && a.isDeaf()) return false;
    if (NOTIF.has(name) && (P("mute") || a.myStatus === "ocupado")) return false;
    return true;
  }

  // ---------- tocar ----------
  let ctx = null, master = null, bus = null;
  const cache = new Map(); // nome -> AudioBuffer (ou a promessa enquanto grava)
  function live() {
    if (!AC) return null;
    if (!ctx) {
      try { ctx = new AC({ latencyHint: "interactive", sampleRate: SR }); } catch { try { ctx = new AC(); } catch { return null; } }
      const out = st.get("cp-out");
      if (out && ctx.setSinkId) ctx.setSinkId(out).catch(() => {});
      master = ctx.createGain(); master.connect(ctx.destination);
    }
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    master.gain.value = Math.min(1, Number(st.get("cp-master") || 100) / 100) * 0.9;
    return ctx;
  }
  // eco de sala feito na hora: ruido que se apaga, um pouco diferente em cada ouvido
  // (calculado uma vez so e reaproveitado por todos os sons)
  const irCache = new Map();
  function impulse(c, secs, decay) {
    const key = secs + ":" + decay + ":" + c.sampleRate, n = Math.floor(c.sampleRate * secs), b = c.createBuffer(2, n, c.sampleRate);
    const done = irCache.get(key);
    if (done) { b.copyToChannel(done[0], 0); b.copyToChannel(done[1], 1); return b; }
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < n; i++) {
        const k = i / n; lp += ((Math.random() * 2 - 1) - lp) * (0.55 - 0.4 * k); // vai ficando mais abafado no fim
        d[i] = lp * Math.pow(1 - k, decay) * (i < c.sampleRate * 0.008 ? i / (c.sampleRate * 0.008) : 1);
      }
    }
    irCache.set(key, [b.getChannelData(0).slice(), b.getChannelData(1).slice()]);
    return b;
  }
  function render(name) {
    if (cache.has(name)) return cache.get(name);
    const def = SOUNDS[name];
    if (!def || !OAC) return null;
    const [, wet, play] = def;
    const job = (async () => {
      // primeiro descobre quando a ultima nota termina (ensaio sem gravar), depois grava com o eco inteiro
      const probe = new OAC(2, 1, SR); play(probe, probe.createGain(), 0.005);
      const c = new OAC(2, Math.ceil(SR * ((probe.__end || 1) + (wet > 0 ? 0.95 : 0.02))), SR);
      const dry = c.createGain(), comp = c.createDynamicsCompressor();
      comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.12;
      dry.connect(comp);
      if (wet > 0) {
        const rv = c.createConvolver(); rv.buffer = impulse(c, 0.9, 3.2);
        const send = c.createGain(); send.gain.value = wet;
        dry.connect(send).connect(rv).connect(comp);
      }
      comp.connect(c.destination);
      play(c, dry, 0.005);
      for (const o of c.__osc || []) o.stop(c.__end);
      const buf = await c.startRendering();
      cache.set(name, buf);
      return buf;
    })().catch(() => { cache.delete(name); return null; });
    cache.set(name, job);
    return job;
  }
  async function play(name, force) {
    if (!SOUNDS[name] || (!force && !allowed(name))) return;
    const c = live(); if (!c) return;
    let buf = cache.get(name);
    if (!buf || buf instanceof Promise) buf = await render(name);
    if (!buf) return;
    const s = c.createBufferSource(); s.buffer = buf; s.connect(master); s.start();
  }
  // grava os sons depois do primeiro toque na pagina, um por vez e so quando o navegador esta parado
  // (sem atrapalhar a digitacao ou a rolagem): o primeiro "plim" ja sai na hora
  let warmed = false;
  const idle = window.requestIdleCallback ? (fn) => requestIdleCallback(fn, { timeout: 3000 }) : (fn) => setTimeout(fn, 200);
  const warm = () => {
    live();
    if (warmed) return; warmed = true;
    const names = Object.keys(SOUNDS); let i = 0;
    const next = () => { if (i >= names.length) return; const r = render(names[i++]); Promise.resolve(r).then(() => idle(next)); };
    idle(next);
  };
  addEventListener("pointerdown", warm, { capture: true, passive: true });
  addEventListener("keydown", warm, { capture: true, passive: true });

  window.ChatPedroSfx = {
    play,
    preview: (name) => play(name, true),
    allowed, // se esse som pode tocar agora (opcoes, "Nao perturbe", fone desativado)
    names: Object.keys(SOUNDS),
    // saida com eco de sala para quem toca notas ao vivo (toques de chamada)
    bus() {
      const c = live(); if (!c) return null;
      if (!bus) {
        bus = c.createGain();
        const rv = c.createConvolver(); rv.buffer = impulse(c, 1.2, 3);
        const send = c.createGain(); send.gain.value = 0.28;
        bus.connect(master); bus.connect(send).connect(rv).connect(master);
      }
      return bus;
    },
    ctx: () => live(),
    // troca de saida de som / volume geral (Voz e video)
    setSink(id) { if (ctx && ctx.setSinkId) ctx.setSinkId(id || "").catch(() => {}); },
  };
})();

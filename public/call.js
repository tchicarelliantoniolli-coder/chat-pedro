// Chamada de voz e video estilo Discord.
// Cada pessoa se conecta direto com cada outra (WebRTC em malha); o servidor so repassa os sinais.
(() => {
  const $ = (id) => document.getElementById(id);
  const app = window.ChatPedro;
  const { socket, avatar, setNote, store } = app;
  // STUN padrao; se o servidor tiver TURN configurado (variaveis TURN_* no Render), ele manda a lista completa
  const ICE_DEFAULT = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  const iceConfig = () => ({ iceServers: app.ice && app.ice.length ? app.ice : ICE_DEFAULT });
  const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

  let members = [];        // quem esta na chamada (vem do servidor)
  let inCall = false;
  const peers = new Map(); // socket.id -> { pc, polite, makingOffer, ignoreOffer, streams, audio, senders }
  const focused = new Set();

  // Estado local
  let ctx = null;               // AudioContext
  let micRaw = null;            // stream do microfone
  let micSource = null, micGain = null, micDest = null, micAnalyser = null;
  let camStream = null, screenStream = null;
  let micOn = true, deaf = false;
  const prefs = {
    micId: store.get("cp-mic") || "",
    camId: store.get("cp-cam") || "",
    micGain: Number(store.get("cp-micgain") || 100),
    ptt: store.get("cp-ptt") === "on",
    master: Number(store.get("cp-master") || 100),
    outId: store.get("cp-out") || "",
  };
  const canPickOutput = "setSinkId" in HTMLMediaElement.prototype;
  let micBlocked = false; // o navegador negou o microfone da ultima vez
  let preview = false;    // microfone ligado so para testar (fora da call)
  const volumeOf = (nick) => Number(store.get("cp-vol-" + nick.toLowerCase()) || 100);

  // ---------- botoes ----------
  // o botao mostra o estado: icone riscado/vermelho = desligado, fundo aceso = ligado
  const btn = (id, ic, label, cls) => { setIcon($(id), ic, label); $(id).classList.remove("on", "off"); if (cls) $(id).classList.add(cls); };
  function refreshButtons() {
    // desligado fica vermelho; ligado mostra ON
    btn("micBtn", micOn ? "mic" : "mic-off", !micOn ? "Ligar o microfone" : prefs.ptt ? "Microfone no modo segurar para falar" : "Desligar o microfone", micOn ? "" : "off");
    btn("deafBtn", deaf ? "headphones-off" : "headphones", deaf ? "Voltar a ouvir a call" : "Parar de ouvir a call", deaf ? "off" : "");
    btn("camBtn", camStream ? "video" : "video-off", camStream ? "Desligar a câmera" : "Ligar a câmera", camStream ? "on" : "");
    btn("screenBtn", "monitor", screenStream ? "Parar de compartilhar a tela" : "Compartilhar a tela", screenStream ? "on" : "");
    $("screenBtn").hidden = !canShareScreen;
    $("pttBtn").hidden = !(inCall && prefs.ptt);
    const min = $("call").classList.contains("min");
    setIcon($("minBtn"), min ? "chevron-down" : "chevron-up", min ? "Mostrar os vídeos" : "Esconder os vídeos");
    // botao grande da call ao lado do nome do servidor
    const n = members.length, cb = $("callBtn");
    const txt = (cls, t) => { const s = document.createElement("span"); s.className = cls; s.textContent = t; return s; };
    cb.replaceChildren(icon("headphones"), ...(inCall ? [txt("", "Na call")] : [txt("long", "Entrar na call"), txt("short", "Call")]));
    if (n) cb.append(txt("cnt", n));
    cb.classList.toggle("in", inCall);
    cb.classList.toggle("busy", !inCall && n > 0); // tem gente conversando: o numero pulsa
    const label = inCall ? "Você está na call com " + n + (n === 1 ? " pessoa" : " pessoas") + ". Clique para ver" : n ? "Entrar na call (" + n + " dentro)" : "Entrar na call";
    cb.title = label; cb.setAttribute("aria-label", label);
    cb.hidden = !app.nick;
  }

  // ---------- audio local ----------
  async function startMic() {
    if (micRaw) micRaw.getTracks().forEach((t) => t.stop());
    micRaw = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: prefs.micId ? { ideal: prefs.micId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (micSource) micSource.disconnect();
    micSource = ctx.createMediaStreamSource(micRaw);
    micSource.connect(micGain);
    micSource.connect(micAnalyser);
  }

  function buildAudioGraph() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    // audio do navegador pausado = os outros nao ouvem nada; garante que esta rodando
    ctx.resume().catch(() => {});
    if (prefs.outId && ctx.setSinkId) ctx.setSinkId(prefs.outId).catch(() => {});
    micGain = ctx.createGain();
    micGain.gain.value = prefs.micGain / 100;
    micDest = ctx.createMediaStreamDestination(); // o que os outros ouvem, ja com o volume aplicado
    micGain.connect(micDest);
    micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 512;
  }
  // Com o volume em 100% o microfone vai direto para a call (o jeito mais confiavel);
  // com outro volume ele passa pelo ajuste do navegador
  const rawTrack = () => micRaw && micRaw.getAudioTracks()[0];
  const useRaw = () => prefs.micGain === 100 || !micDest;
  const micTrack = () => (useRaw() ? rawTrack() : micDest.stream.getAudioTracks()[0]) || null;
  const micStream = () => (useRaw() ? micRaw : micDest.stream);
  // troca o som enviado para todo mundo sem refazer a conexao
  function syncMicTrack() {
    const t = micTrack();
    for (const p of peers.values()) {
      if (p.micSender) { if (p.micSender.track !== t) p.micSender.replaceTrack(t).catch(() => {}); }
      else if (t) p.micSender = p.pc.addTrack(t, micStream());
    }
    applyMic();
  }

  function level(analyser) {
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += (v - 128) * (v - 128);
    return Math.sqrt(sum / buf.length) / 128;
  }

  // ---------- conexoes com os outros ----------
  function localTracks() {
    const out = [];
    if (micTrack()) out.push([micTrack(), micStream()]);
    if (camStream) out.push([camStream.getVideoTracks()[0], camStream]);
    if (screenStream) out.push([screenStream.getVideoTracks()[0], screenStream]);
    return out;
  }

  function getPeer(id) {
    let p = peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection(iceConfig());
    p = { pc, polite: socket.id < id, makingOffer: false, ignoreOffer: false, streams: {}, audio: null, senders: new Map(), analyser: null };
    peers.set(id, p);
    for (const [track, stream] of localTracks()) {
      const sender = pc.addTrack(track, stream);
      p.senders.set(track.id, sender);
      if (track.kind === "audio") p.micSender = sender;
    }

    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        socket.emit("call:signal", { to: id, description: pc.localDescription });
      } catch (e) { console.warn(e); } finally { p.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) socket.emit("call:signal", { to: id, candidate }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") pc.restartIce(); };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] || new MediaStream([track]);
      p.streams[stream.id] = stream;
      if (track.kind === "audio") attachAudio(id, p, stream);
      stream.onremovetrack = () => renderTiles();
      track.onunmute = () => renderTiles();
      renderTiles();
    };
    return p;
  }

  function attachAudio(id, p, stream) {
    if (!p.audio) {
      p.audio = new Audio();
      p.audio.autoplay = true;
      document.body.append(p.audio);
    }
    p.audio.srcObject = stream;
    if (canPickOutput && prefs.outId) p.audio.setSinkId(prefs.outId).catch(() => {});
    applyVolume(id);
    p.audio.play().catch(() => {});
    if (ctx) {
      try {
        p.analyser = ctx.createAnalyser();
        p.analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(p.analyser);
      } catch { p.analyser = null; }
    }
  }

  function applyVolume(id) {
    const p = peers.get(id), m = members.find((x) => x.id === id);
    if (!p || !p.audio || !m) return;
    p.audio.volume = Math.min(1, (volumeOf(m.nick) / 100) * (prefs.master / 100));
    p.audio.muted = deaf;
  }

  function closePeer(id) {
    const p = peers.get(id);
    if (!p) return;
    p.pc.close();
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    peers.delete(id);
  }

  socket.on("call:signal", async ({ from, description, candidate }) => {
    if (!inCall) return;
    const p = getPeer(from), pc = p.pc;
    try {
      if (description) {
        const collision = description.type === "offer" && (p.makingOffer || pc.signalingState !== "stable");
        p.ignoreOffer = !p.polite && collision;
        if (p.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (description.type === "offer") {
          await pc.setLocalDescription();
          socket.emit("call:signal", { to: from, description: pc.localDescription });
        }
      } else if (candidate) {
        try { await pc.addIceCandidate(candidate); } catch (e) { if (!p.ignoreOffer) throw e; }
      }
    } catch (e) { console.warn(e); }
  });

  function addTrackToAll(track, stream) {
    for (const p of peers.values()) p.senders.set(track.id, p.pc.addTrack(track, stream));
  }
  function removeTrackFromAll(track) {
    for (const p of peers.values()) {
      const s = p.senders.get(track.id);
      if (s) { try { p.pc.removeTrack(s); } catch {} p.senders.delete(track.id); }
    }
  }

  // ---------- entrar / sair ----------
  const myState = () => ({ mic: micOn, deaf, cam: camStream ? camStream.id : null, screen: screenStream ? screenStream.id : null });
  const sendState = () => { if (inCall) socket.emit("call:state", myState()); };

  let joining = false;
  async function join() {
    if (inCall || joining || !app.nick) return;
    joining = true;
    try { await doJoin(); } finally { joining = false; }
  }
  async function doJoin() {
    if (!window.RTCPeerConnection || !navigator.mediaDevices) { setNote("ERRO: seu navegador não suporta chamadas. Tente o Chrome.", true); return; }
    if (preview) stopPreview();
    if (micBlocked) { micOn = true; micBlocked = false; } // da outra vez nao deu; tenta ligado de novo
    buildAudioGraph();
    try { await startMic(); }
    catch { micOn = false; micBlocked = true; setNote("Sem acesso ao microfone. Você entrou mudo; libere o microfone no navegador (no cadeado ao lado do endereço) para falar.", true); }
    applyMic();
    await new Promise((done) => socket.timeout(10000).emit("call:join", myState(), (err, res) => {
      done();
      if (err) res = null; // o servidor nao respondeu
      if (!res || !res.ok) { setNote("ERRO: não deu para entrar na chamada.", true); cleanup(); return; }
      inCall = true;
      applyMic();
      syncWatch();
      $("call").hidden = false;
      $("call").classList.remove("min");
      for (const id of res.others) getPeer(id); // quem entra chama quem ja esta
      refreshButtons();
      renderTiles();
      fillDevices();
    }));
  }

  function cleanup() {
    setPtt(false);
    $("sfxBar").hidden = true; $("watchForm").hidden = true;
    setTimeout(syncWatch, 0); // inCall ja vai estar falso: esconde o video
    for (const id of [...peers.keys()]) closePeer(id);
    for (const s of [micRaw, camStream, screenStream]) if (s) s.getTracks().forEach((t) => t.stop());
    micRaw = camStream = screenStream = null;
    if (ctx) ctx.close().catch(() => {});
    ctx = micSource = micGain = micDest = micAnalyser = null;
    inCall = false;
    focused.clear();
    $("call").hidden = true;
    $("settings").hidden = true;
  }

  function leave() {
    if (!inCall) return;
    socket.emit("call:leave");
    cleanup();
    refreshButtons();
    renderSidebar();
  }

  // Se a conexao com o servidor cair, a chamada acaba; e preciso entrar de novo.
  socket.on("disconnect", () => { if (inCall) { cleanup(); refreshButtons(); setNote("A conexão caiu e você saiu da chamada. Entre de novo.", true); } });

  // ---------- controles ----------
  async function toggleCam() {
    if (camStream) {
      removeTrackFromAll(camStream.getVideoTracks()[0]);
      camStream.getTracks().forEach((t) => t.stop());
      camStream = null;
    } else {
      try {
        camStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: prefs.camId ? { ideal: prefs.camId } : undefined, width: { ideal: 640 }, height: { ideal: 360 } },
        });
      } catch { setNote("ERRO: sem acesso a câmera. Libere a câmera no navegador.", true); return; }
      if (!inCall) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; return; } // saiu da call enquanto esperava
      camStream.getVideoTracks()[0].onended = () => { if (camStream) toggleCam(); }; // camera desconectada
      addTrackToAll(camStream.getVideoTracks()[0], camStream);
      fillDevices();
    }
    sendState(); refreshButtons(); renderTiles();
  }

  async function toggleScreen() {
    if (screenStream) return stopScreen();
    try { screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false }); }
    catch { return; } // a pessoa cancelou
    if (!inCall) { screenStream.getTracks().forEach((t) => t.stop()); screenStream = null; return; }
    const track = screenStream.getVideoTracks()[0];
    track.onended = stopScreen; // "Parar compartilhamento" do proprio navegador
    addTrackToAll(track, screenStream);
    sendState(); refreshButtons(); renderTiles();
  }
  function stopScreen() {
    if (!screenStream) return;
    removeTrackFromAll(screenStream.getVideoTracks()[0]);
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
    sendState(); refreshButtons(); renderTiles();
  }

  function toggleMic() {
    if (!micRaw) { setNote("Sem acesso ao microfone. Libere o microfone no navegador e entre de novo.", true); return; }
    micOn = !micOn;
    if (!micOn && deaf) {} // mutar nao mexe no fone
    if (micOn && deaf) { deaf = false; for (const id of peers.keys()) applyVolume(id); } // como no Discord: ligar o mic tira o modo surdo
    applyMic();
    sendState(); refreshButtons(); renderTiles();
  }
  function toggleDeaf() {
    deaf = !deaf;
    if (deaf && micOn) { micOn = false; applyMic(); } // como no Discord: surdo tambem muta
    for (const id of peers.keys()) applyVolume(id);
    sendState(); refreshButtons(); renderTiles();
  }

  // ---------- configuracoes ----------
  async function fillDevices() {
    let devices = [];
    try { devices = await navigator.mediaDevices.enumerateDevices(); } catch {}
    const fill = (sel, kind, current, fallback) => {
      const list = devices.filter((d) => d.kind === kind);
      sel.replaceChildren();
      list.forEach((d, i) => {
        const o = document.createElement("option");
        o.value = d.deviceId; o.textContent = d.label || fallback + " " + (i + 1);
        sel.append(o);
      });
      if (!list.length) { const o = document.createElement("option"); o.textContent = "nenhum encontrado"; sel.append(o); }
      if (current && list.some((d) => d.deviceId === current)) sel.value = current;
    };
    fill($("micSelect"), "audioinput", micRaw && micRaw.getAudioTracks()[0].getSettings().deviceId || prefs.micId, "Microfone");
    fill($("camSelect"), "videoinput", camStream && camStream.getVideoTracks()[0].getSettings().deviceId || prefs.camId, "Câmera");
    fill($("outSelect"), "audiooutput", prefs.outId || "default", "Saída");
    $("outSelect").hidden = !canPickOutput;
    $("outHint").hidden = canPickOutput;
  }

  // ---------- saida de audio ----------
  $("outSelect").addEventListener("change", (e) => {
    prefs.outId = e.target.value; store.set("cp-out", prefs.outId);
    for (const p of peers.values()) if (p.audio) p.audio.setSinkId(prefs.outId).catch(() => {});
    if (ctx && ctx.setSinkId) ctx.setSinkId(prefs.outId).catch(() => {});
  });
  // som de teste: um bipe curto na saida escolhida
  function beepUrl() {
    const rate = 22050, n = Math.floor(rate * 0.5), buf = new DataView(new ArrayBuffer(44 + n * 2));
    const str = (o, t) => { for (let i = 0; i < t.length; i++) buf.setUint8(o + i, t.charCodeAt(i)); };
    str(0, "RIFF"); buf.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt "); buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
    buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true); str(36, "data"); buf.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const t = i / rate, f = t < 0.25 ? 660 : 880, env = Math.min(1, (0.5 - t) * 8, t * 50);
      buf.setInt16(44 + i * 2, Math.sign(Math.sin(2 * Math.PI * f * t)) * 6000 * env, true);
    }
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }
  $("outTest").addEventListener("click", async () => {
    const a = new Audio(beepUrl());
    a.volume = prefs.master / 100;
    if (canPickOutput && prefs.outId) await a.setSinkId(prefs.outId).catch(() => {});
    a.play().catch(() => setNote("Não deu para tocar o som de teste.", true));
  });

  // ---------- testar o microfone fora da call ----------
  async function openSettings() {
    $("settings").hidden = false;
    lastHeard = Date.now();
    if (!inCall && !preview && navigator.mediaDevices) {
      preview = true;
      buildAudioGraph();
      try { await startMic(); } catch { $("micHint").textContent = "Sem acesso ao microfone: libere no cadeado ao lado do endereço."; $("micHint").className = "hint warn"; }
    }
    fillDevices();
  }
  function stopPreview() {
    preview = false;
    if (micRaw) micRaw.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close().catch(() => {});
    micRaw = null; ctx = micSource = micGain = micDest = micAnalyser = null;
  }
  // fechou a janela (pelo X, clicando fora ou ESC): desliga o teste
  new MutationObserver(() => { if ($("settings").hidden && preview) stopPreview(); }).observe($("settings"), { attributes: true, attributeFilter: ["hidden"] });
  app.openAV = openSettings;
  // o navegador pode pausar o audio ate a pessoa clicar em algo: retoma no primeiro clique ou tecla
  for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, () => { if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {}); }, true);

  $("micSelect").addEventListener("change", async (e) => {
    prefs.micId = e.target.value; store.set("cp-mic", prefs.micId);
    if (!inCall && !preview) return;
    lastHeard = Date.now();
    try { await startMic(); syncMicTrack(); }
    catch { setNote("ERRO: não deu para usar esse microfone.", true); }
  });
  $("camSelect").addEventListener("change", async (e) => {
    prefs.camId = e.target.value; store.set("cp-cam", prefs.camId);
    if (!camStream) return;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: prefs.camId }, width: { ideal: 640 }, height: { ideal: 360 } } });
      const oldTrack = camStream.getVideoTracks()[0], newTrack = fresh.getVideoTracks()[0];
      for (const p of peers.values()) {
        const s = p.senders.get(oldTrack.id);
        if (s) { await s.replaceTrack(newTrack); p.senders.delete(oldTrack.id); p.senders.set(newTrack.id, s); }
      }
      camStream.removeTrack(oldTrack); oldTrack.stop(); camStream.addTrack(newTrack);
      renderTiles();
    } catch { setNote("ERRO: não deu para usar essa câmera.", true); }
  });
  $("micGain").value = prefs.micGain;
  $("micGainVal").textContent = prefs.micGain + "%";
  $("micGain").addEventListener("input", (e) => {
    prefs.micGain = Number(e.target.value); store.set("cp-micgain", prefs.micGain);
    $("micGainVal").textContent = prefs.micGain + "%";
    if (micGain) micGain.gain.value = prefs.micGain / 100;
    syncMicTrack(); // 100% vai direto; outro valor passa pelo ajuste
  });
  $("master").value = prefs.master;
  $("masterVal").textContent = prefs.master + "%";
  $("master").addEventListener("input", (e) => {
    prefs.master = Number(e.target.value); store.set("cp-master", prefs.master);
    $("masterVal").textContent = prefs.master + "%";
    for (const id of peers.keys()) applyVolume(id);
  });

  // ---------- desenho ----------
  const tiles = new Map(); // chave -> elemento
  function videoTile(key, stream, opts) {
    let el = tiles.get(key);
    if (!el) {
      el = document.createElement("div");
      el.className = "tile";
      el.addEventListener("click", (e) => {
        if (e.target.closest(".vol, .full") || isFull(el)) return;
        focused.has(key) ? focused.delete(key) : focused.add(key);
        el.classList.toggle("focus", focused.has(key));
      });
      el.addEventListener("dblclick", (e) => { if (!e.target.closest(".vol, .full")) toggleFull(el); });
      const fb = document.createElement("button");
      fb.type = "button"; fb.className = "ib sm full"; setIcon(fb, "maximize", "Tela cheia");
      fb.addEventListener("click", (e) => { e.stopPropagation(); toggleFull(el); });
      el.append(fb);
      tiles.set(key, el);
    }
    el.classList.toggle("screen", !!opts.screen);
    el.classList.toggle("focus", focused.has(key));
    el.dataset.member = opts.id;
    // midia: video se tiver, senao o avatar grande
    let video = el.querySelector("video");
    const hasVideo = stream && stream.getVideoTracks().some((t) => t.readyState === "live");
    if (hasVideo) {
      el.querySelector(".av")?.remove();
      if (!video) { video = document.createElement("video"); video.autoplay = true; video.playsInline = true; video.muted = true; el.prepend(video); }
      if (video.srcObject !== stream) video.srcObject = stream;
      video.classList.toggle("mirror", !!opts.mirror);
    } else {
      video?.remove();
      const old = el.querySelector(".av");
      if (!old || old.dataset.nick !== opts.nick.toLowerCase()) { old?.remove(); el.prepend(avatar(opts.nick, true)); }
    }
    // nome e mudo
    let label = el.querySelector(".label");
    if (!label) { label = document.createElement("div"); label.className = "label"; el.append(label); }
    label.replaceChildren();
    const n = document.createElement("span"); n.className = "n"; n.textContent = opts.title; label.append(n);
    if (!opts.screen && opts.muted) { const f = document.createElement("span"); f.className = "flag"; f.textContent = opts.deaf ? "SURDO" : "MUDO"; label.append(f); }
    // volume de cada pessoa (so nos outros, no quadro principal)
    let vol = el.querySelector(".vol");
    if (opts.volume) {
      if (!vol) {
        vol = document.createElement("label"); vol.className = "vol";
        const t = document.createElement("span");
        const r = document.createElement("input"); r.type = "range"; r.min = 0; r.max = 100; r.step = 5;
        r.setAttribute("aria-label", "Volume de " + opts.nick);
        r.addEventListener("input", () => {
          const nk = el.dataset.nick;
          store.set("cp-vol-" + nk, r.value); t.textContent = "VOL " + r.value + "%";
          applyVolume(el.dataset.member);
        });
        vol.append(t, r); el.append(vol);
      }
      el.dataset.nick = opts.nick.toLowerCase();
      const v = volumeOf(opts.nick);
      vol.querySelector("input").value = v;
      vol.querySelector("span").textContent = "VOL " + v + "%";
    } else vol?.remove();
    return el;
  }

  // Tela cheia: usa a do navegador; onde ela nao existe (iPhone), o quadro cobre a pagina
  const fullEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const isFull = (el) => fullEl() === el || el.classList.contains("theater");
  function toggleFull(el) {
    if (fullEl() === el) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    if (el.classList.contains("theater")) { el.classList.remove("theater"); syncFullButtons(); return; }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    const theater = () => { el.classList.add("theater"); syncFullButtons(); };
    if (!req) return theater();
    try { const r = req.call(el); if (r && r.catch) r.catch(theater); } catch { theater(); }
  }
  function syncFullButtons() {
    for (const el of tiles.values()) {
      const b = el.querySelector(".full");
      if (b) setIcon(b, isFull(el) ? "minimize" : "maximize", isFull(el) ? "Sair da tela cheia" : "Tela cheia");
    }
  }
  document.addEventListener("fullscreenchange", syncFullButtons);
  document.addEventListener("webkitfullscreenchange", syncFullButtons);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") for (const el of tiles.values()) if (el.classList.contains("theater")) { el.classList.remove("theater"); syncFullButtons(); }
  });

  function renderTiles() {
    if (!inCall) return;
    const want = [];
    for (const m of members) {
      const me = m.id === socket.id;
      const p = peers.get(m.id);
      const cam = me ? camStream : p && m.cam ? p.streams[m.cam] : null;
      const scr = me ? screenStream : p && m.screen ? p.streams[m.screen] : null;
      const muted = !m.mic || m.deaf;
      want.push(videoTile(m.id + ":main", cam, {
        id: m.id, nick: m.nick, title: m.nick + (me ? " (você)" : ""), mirror: me, muted, deaf: m.deaf, volume: !me,
      }));
      if (scr) want.push(videoTile(m.id + ":screen", scr, { id: m.id, nick: m.nick, title: "Tela de " + m.nick + (me ? " (você)" : ""), screen: true }));
    }
    for (const [key, el] of tiles) if (!want.includes(el)) { el.remove(); tiles.delete(key); focused.delete(key); }
    // so mexe na ordem quando ela muda de verdade: tirar um quadro da pagina fecha a tela cheia dele
    const box = $("tiles"), cur = [...box.children];
    if (cur.length !== want.length || cur.some((el, i) => el !== want[i])) box.replaceChildren(...want);
    for (const v of box.querySelectorAll("video")) if (v.paused) v.play().catch(() => {});
    syncFullButtons();
  }

  function renderSidebar() {
    $("callTitle").textContent = "NA CALL " + members.length;
    $("callSect").hidden = !members.length;
    const ul = $("callPeople");
    ul.replaceChildren();
    for (const m of members) {
      const li = document.createElement("li");
      li.dataset.member = m.id;
      const name = document.createElement("span"); name.className = "name"; name.textContent = m.nick;
      const tags = [];
      if (m.deaf) tags.push("surdo"); else if (!m.mic) tags.push("mudo");
      if (m.cam) tags.push("cam");
      if (m.screen) tags.push("ao vivo");
      const t = document.createElement("span"); t.className = "tags"; t.textContent = tags.join(" · ");
      li.append(avatar(m.nick), name, t);
      ul.append(li);
    }
    app.callNicks = new Set(members.map((m) => m.nick));
    app.renderPeople();
  }

  socket.on("call:members", (list) => {
    members = Array.isArray(list) ? list : [];
    if (inCall) {
      const ids = new Set(members.map((m) => m.id));
      for (const id of [...peers.keys()]) if (!ids.has(id)) closePeer(id);
      for (const id of peers.keys()) applyVolume(id);
    }
    renderSidebar(); refreshButtons(); renderTiles();
  });

  // Indicador de quem esta falando (borda verde), como no Discord
  let lastHeard = 0;
  setInterval(() => {
    // barra de teste e dica do microfone (na call ou testando)
    if (!$("settings").hidden && micAnalyser) {
      const lv = level(micAnalyser) * (prefs.micGain / 100);
      $("micMeter").style.width = Math.min(100, lv * 400) + "%";
      if (lv > 0.02) lastHeard = Date.now();
      const hint = $("micHint");
      let text = "Fale e veja a barra se mexer.", warn = false;
      if (ctx && ctx.state !== "running") { text = "O som do navegador está pausado: clique em qualquer lugar da página."; warn = true; }
      else if (inCall && prefs.ptt && !pttHeld) text = "Apertar para falar está ligado: os outros só te ouvem enquanto você segura ESPAÇO.";
      else if (inCall && !micOn) { text = "Seu microfone está desligado na call: clique no microfone da barra para ligar."; warn = true; }
      else if (prefs.micGain === 0) { text = "O volume do microfone está em 0%."; warn = true; }
      else if (!rawTrack() || rawTrack().readyState === "ended") { text = "O microfone parou de funcionar. Escolha ele de novo na lista."; warn = true; }
      else if (rawTrack().muted) { text = "O sistema está mandando silêncio: o microfone está mutado no fone (botão ou haste levantada) ou nas configurações de som do Windows."; warn = true; }
      else if (Date.now() - lastHeard > 4000) { text = "Não estou ouvindo nada de \"" + rawTrack().label + "\". Confira se o microfone do fone não está mutado e teste a opção \"Padrão\" da lista."; warn = true; }
      if (hint.textContent !== text) { hint.textContent = text; hint.className = "hint" + (warn ? " warn" : ""); }
    }
    if (!inCall) return;
    const speaking = new Set();
    if (micAnalyser && micLive() && level(micAnalyser) * (prefs.micGain / 100) > 0.04) speaking.add(socket.id);
    for (const [id, p] of peers) if (p.analyser && level(p.analyser) > 0.04) speaking.add(id);
    document.querySelectorAll("#tiles .tile").forEach((el) => el.classList.toggle("speaking", !el.classList.contains("screen") && speaking.has(el.dataset.member)));
    document.querySelectorAll("#callPeople li").forEach((li) => li.classList.toggle("speaking", speaking.has(li.dataset.member)));
  }, 120);

  // ---------- apertar para falar ----------
  let pttHeld = false;
  const micLive = () => micOn && (!prefs.ptt || pttHeld);
  function applyMic() {
    const t = micTrack();
    if (rawTrack() && t !== rawTrack()) rawTrack().enabled = true; // o ajuste de volume precisa do som cru ligado
    if (t) t.enabled = micLive();
  }
  function setPtt(held) {
    if (pttHeld === held) return;
    pttHeld = held;
    $("pttBtn").classList.toggle("held", held);
    applyMic();
  }
  const typingTarget = (t) => t && (t.closest("input, textarea, select, [contenteditable]") !== null);
  document.addEventListener("keydown", (e) => {
    if (!inCall || !prefs.ptt || e.code !== "Space" || typingTarget(e.target)) return;
    e.preventDefault();
    setPtt(true);
  });
  document.addEventListener("keyup", (e) => { if (e.code === "Space") setPtt(false); });
  window.addEventListener("blur", () => setPtt(false));
  const ptt = $("pttBtn");
  ptt.addEventListener("pointerdown", (e) => { e.preventDefault(); ptt.setPointerCapture(e.pointerId); setPtt(true); });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) ptt.addEventListener(ev, () => setPtt(false));
  $("pttCheck").checked = prefs.ptt;
  $("pttCheck").addEventListener("change", (e) => {
    prefs.ptt = e.target.checked; store.set("cp-ptt", prefs.ptt ? "on" : "off");
    setPtt(false); applyMic(); refreshButtons();
  });

  // ---------- soundboard: sons 8-bit feitos na hora, tocam para todo mundo da call ----------
  const SFX_LABEL = { buzina: "Buzina", ihhh: "Ihhh", risada: "Risada", aplausos: "Aplausos", tambor: "Ba dum tss", erro: "Erro" };
  $("sfxBar").replaceChildren(...Object.entries(SFX_LABEL).map(([k, label]) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "cmd"; b.textContent = label;
    b.addEventListener("click", () => socket.emit("call:sfx", k));
    return b;
  }));
  $("sfxBtn").addEventListener("click", () => { $("sfxBar").hidden = !$("sfxBar").hidden; });
  function playSfx(name) {
    if (!ctx || deaf) return;
    const out = ctx.createGain();
    out.gain.value = 0.18 * (prefs.master / 100);
    out.connect(ctx.destination);
    const t0 = ctx.currentTime;
    const tone = (type, f0, f1, start, dur, vol = 1) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t0 + start);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + start + dur);
      g.gain.setValueAtTime(vol, t0 + start); g.gain.exponentialRampToValueAtTime(0.001, t0 + start + dur);
      o.connect(g).connect(out); o.start(t0 + start); o.stop(t0 + start + dur + 0.02);
    };
    const noise = (start, dur, vol = 1, hp = 0) => {
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf;
      g.gain.setValueAtTime(vol, t0 + start); g.gain.exponentialRampToValueAtTime(0.001, t0 + start + dur);
      let node = src;
      if (hp) { const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp; node.connect(f); node = f; }
      node.connect(g).connect(out); src.start(t0 + start);
    };
    if (name === "buzina") { tone("sawtooth", 440, 440, 0, 0.35); tone("sawtooth", 554, 554, 0, 0.35); tone("sawtooth", 440, 440, 0.4, 0.5); tone("sawtooth", 554, 554, 0.4, 0.5); }
    else if (name === "ihhh") tone("square", 950, 260, 0, 0.9, 0.8);
    else if (name === "risada") for (let i = 0; i < 6; i++) tone("square", 620 - i * 30, 480 - i * 30, i * 0.14, 0.11, 0.8);
    else if (name === "aplausos") for (let i = 0; i < 14; i++) noise(i * 0.09 + Math.random() * 0.04, 0.08, 0.5, 1200);
    else if (name === "tambor") { tone("sine", 160, 60, 0, 0.18); tone("sine", 120, 50, 0.22, 0.2); noise(0.45, 0.5, 0.6, 6000); }
    else if (name === "erro") { tone("square", 330, 330, 0, 0.18, 0.7); tone("square", 220, 220, 0.2, 0.35, 0.7); }
  }
  socket.on("call:sfx", ({ name, nick }) => {
    if (!inCall) return;
    playSfx(name);
    setNote("♪ " + nick + " tocou " + (SFX_LABEL[name] || name));
  });

  // ---------- assistir junto (YouTube sincronizado) ----------
  let watchState = null, player = null, playerVid = null, suppressUntil = 0, ytReady = null;
  const watchOffset = () => (watchState ? watchState.localOffset : 0);
  const expectedPos = () => !watchState ? 0 : watchState.playing ? watchState.pos + (Date.now() - watchOffset() - watchState.at) / 1000 : watchState.pos;
  function loadYT() {
    if (ytReady) return ytReady;
    ytReady = new Promise((ok) => {
      if (window.YT && window.YT.Player) return ok();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); ok(); };
      const sc = document.createElement("script"); sc.src = "https://www.youtube.com/iframe_api"; document.head.append(sc);
    });
    return ytReady;
  }
  socket.on("watch:state", (w) => {
    watchState = w ? { ...w, localOffset: Date.now() - w.now } : null;
    syncWatch();
  });
  async function syncWatch() {
    const box = $("watch");
    if (!inCall || !watchState) { box.hidden = true; if (player) { try { player.destroy(); } catch {} player = null; playerVid = null; $("ytBox").replaceChildren(Object.assign(document.createElement("div"), { id: "ytPlayer" })); } return; }
    box.hidden = false;
    $("watchInfo").textContent = (watchState.playing ? "assistindo junto" : "pausado") + " | colocado por " + watchState.by;
    setIcon($("watchToggle"), watchState.playing ? "pause" : "play", watchState.playing ? "Pausar" : "Tocar");
    await loadYT();
    if (!watchState) return;
    if (!player) {
      playerVid = watchState.id;
      suppressUntil = Date.now() + 2500;
      player = new YT.Player("ytPlayer", {
        videoId: watchState.id,
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, start: Math.floor(expectedPos()) },
        events: { onReady: applyWatch, onStateChange: onLocalChange },
      });
      return;
    }
    if (playerVid !== watchState.id) { playerVid = watchState.id; suppressUntil = Date.now() + 2500; player.loadVideoById(watchState.id, expectedPos()); }
    applyWatch();
  }
  function applyWatch() {
    if (!player || !player.getCurrentTime || !watchState) return;
    suppressUntil = Date.now() + 1200;
    const want = expectedPos();
    if (Math.abs(player.getCurrentTime() - want) > 1.5) player.seekTo(want, true);
    if (watchState.playing) player.playVideo(); else player.pauseVideo();
    player.setVolume(prefs.master);
    if (deaf) player.mute(); else player.unMute();
  }
  // a pessoa mexeu no proprio player (play, pause ou pulou): avisa todo mundo
  function onLocalChange(e) {
    if (!watchState || Date.now() < suppressUntil) return;
    const cur = player.getCurrentTime();
    if (e.data === YT.PlayerState.PLAYING && (!watchState.playing || Math.abs(cur - expectedPos()) > 2)) socket.emit("watch:control", { action: "play", pos: cur });
    else if (e.data === YT.PlayerState.PAUSED && watchState.playing) socket.emit("watch:control", { action: "pause", pos: cur });
  }
  setInterval(() => { // corrige quem atrasou ou adiantou
    if (player && watchState && watchState.playing && player.getCurrentTime && Math.abs(player.getCurrentTime() - expectedPos()) > 2.5) applyWatch();
  }, 3000);
  $("watchBtn").addEventListener("click", () => { $("watchForm").hidden = !$("watchForm").hidden; if (!$("watchForm").hidden) $("watchUrl").focus(); });
  $("watchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const url = $("watchUrl").value.trim();
    if (!url) return;
    socket.emit("watch:set", url);
    $("watchUrl").value = ""; $("watchForm").hidden = true;
  });
  $("watchToggle").addEventListener("click", () => {
    if (!watchState) return;
    const pos = player && player.getCurrentTime ? player.getCurrentTime() : expectedPos();
    socket.emit("watch:control", { action: watchState.playing ? "pause" : "play", pos });
  });
  $("watchStop").addEventListener("click", () => socket.emit("watch:stop"));

  $("callBtn").addEventListener("click", () => {
    if (!inCall) return join();
    $("call").classList.toggle("min", false);
    $("call").scrollIntoView({ block: "nearest" });
  });
  $("leaveBtn").addEventListener("click", leave);
  $("micBtn").addEventListener("click", toggleMic);
  $("deafBtn").addEventListener("click", toggleDeaf);
  $("camBtn").addEventListener("click", toggleCam);
  $("screenBtn").addEventListener("click", toggleScreen);
  $("minBtn").addEventListener("click", () => { $("call").classList.toggle("min"); refreshButtons(); });
  $("setBtn").addEventListener("click", openSettings);
  $("setClose").addEventListener("click", () => { $("settings").hidden = true; });
  $("settings").addEventListener("click", (e) => { if (e.target === $("settings")) $("settings").hidden = true; });
  window.addEventListener("beforeunload", () => { if (inCall) socket.emit("call:leave"); });

  app.onJoin = () => { refreshButtons(); renderSidebar(); };
  refreshButtons();
  renderSidebar();
})();

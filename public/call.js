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

  let members = [];        // quem esta no MEU canal de voz
  let allMembers = [];     // todo mundo em qualquer canal de voz do servidor
  let myCh = null;         // canal de voz em que estou
  const voiceName = (ch) => { const el = document.querySelector('.chan.voice[data-voice="' + ch + '"] .vn'); return el ? el.textContent : "Call"; };
  const firstVoice = () => { const el = document.querySelector(".chan.voice[data-voice]"); return el ? el.dataset.voice : null; };
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
    simple: store.get("cp-simplemic") === "on",
    outId: store.get("cp-out") || "",
    sens: Number(store.get("cp-sens") || 0), // sensibilidade de entrada (0 = automatica, sempre passa)
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
    btn("micBtn", micOn ? "umic" : "umic-off", !micOn ? "Dessilenciar" : prefs.ptt ? "Microfone no modo segurar para falar" : "Silenciar", micOn ? "" : "off");
    $("micBtn").parentElement.classList.toggle("off", !micOn);
    btn("deafBtn", deaf ? "uhead-off" : "uhead", deaf ? "Reativar áudio" : "Desativar áudio", deaf ? "off" : "");
    btn("camBtn", camStream ? "ucam" : "ucam-off", camStream ? "Desligar câmera" : "Ligar câmera", camStream ? "on" : "");
    btn("screenBtn", "uscreen", screenStream ? "Parar de compartilhar" : "Compartilhar sua tela", screenStream ? "on" : "");
    $("screenBtn").hidden = !canShareScreen;
    // painel "Voz conectada": camera, tela e atividades (iguais aos da call)
    btn("vpCam", camStream ? "ucam" : "ucam-off", camStream ? "Desligar câmera" : "Ligar câmera", camStream ? "on" : "");
    btn("vpScreen", "uscreen", screenStream ? "Parar de compartilhar" : "Compartilhar sua tela", screenStream ? "on" : "");
    $("vpScreen").hidden = !canShareScreen;
    $("vpNoise").classList.toggle("on", !prefs.simple);
    setIcon($("vpNoise"), "wave", prefs.simple ? "Supressão de ruído: desligada" : "Supressão de ruído: ligada");
    if (app.renderMe) app.renderMe();
    // conversa privada: alguem ja esta na chamada -> o telefone do topo fica verde
    const ringing = !inCall && allMembers.length > 0;
    $("dmCallBtn").classList.toggle("ring", ringing);
    setIcon($("dmCallBtn"), "uphone", inCall ? "Mostrar a chamada" : ringing ? "Entrar na chamada" : "Iniciar chamada de voz");
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
    // canais de voz na barra da esquerda (como no Discord) e o painel "Voz conectada"
    document.querySelectorAll(".chan.voice[data-voice]").forEach((vc) => {
      const here = inCall && vc.dataset.voice === myCh;
      const cnt = allMembers.filter((m) => m.ch === vc.dataset.voice).length;
      vc.classList.toggle("in", here);
      const vj = vc.querySelector(".vj");
      if (vj) vj.textContent = here ? "você está aqui" : cnt ? cnt + (cnt === 1 ? " pessoa" : " pessoas") + " · entrar" : "entrar";
      vc.title = here ? "Mostrar a call" : "Entrar em " + vc.querySelector(".vn").textContent;
    });
    $("voicePanel").hidden = !inCall;
    const me = meInCall(), stage = inCall && isStageCh(myCh);
    $("handBtn").hidden = !stage || !me;
    if (stage && me) {
      const lab = me.speaker ? "Descer do palco" : me.hand ? "Baixar a mão" : "Levantar a mão";
      setIcon($("handBtn"), me.speaker ? "log-out" : "hand", lab);
      $("handBtn").classList.toggle("on", !!me.hand);
    }
    $("vpWhere").textContent = voiceName(myCh) + " / " + n + (n === 1 ? " pessoa" : " pessoas");
    // microfone e fone do painel do usuario, embaixo da barra
    setIcon($("upMic"), micOn ? "umic" : "umic-off", micOn ? "Silenciar" : "Dessilenciar");
    $("upMic").classList.toggle("off", !micOn);
    $("upMic").parentElement.classList.toggle("off", !micOn);
    setIcon($("upDeaf"), deaf ? "uhead-off" : "uhead", deaf ? "Reativar áudio" : "Desativar áudio");
    $("upDeaf").classList.toggle("off", deaf);
    $("upDeaf").parentElement.classList.toggle("off", deaf);
  }

  // ---------- audio local ----------
  async function startMic() {
    if (micRaw) micRaw.getTracks().forEach((t) => t.stop());
    const filters = !prefs.simple;
    const want = (id) => ({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: filters, noiseSuppression: filters, autoGainControl: filters } });
    // usa exatamente o microfone escolhido (antes o navegador podia pegar outro, como o DroidCam);
    // se ele sumiu, cai no padrao
    try { micRaw = await navigator.mediaDevices.getUserMedia(want(prefs.micId)); }
    catch (e) { if (!prefs.micId || e.name === "NotAllowedError") throw e; micRaw = await navigator.mediaDevices.getUserMedia(want("")); }
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
  // com a sensibilidade ligada o som passa pelo ajuste (o microfone cru continua ouvindo para abrir o portao)
  const useRaw = () => (prefs.micGain === 100 && !prefs.sens) || !micDest;
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
    // caiu: tenta de novo (ate 3 vezes); se nao voltar, avisa (a internet de alguem bloqueia a ligacao direta)
    p.fails = 0;
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") p.fails = 0;
      if (pc.connectionState !== "failed") return;
      if (++p.fails <= 3) { pc.restartIce(); return; }
      const m = members.find((x) => x.id === id);
      setNote("Não deu para conectar com " + (m ? m.nick : "uma pessoa") + ": a internet de um de vocês bloqueia a ligação direta, então a voz, a câmera e a tela dela não chegam. Saiam e entrem de novo na call.", true);
    };
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
  async function join(ch) {
    if (inCall || joining || !app.nick) return;
    myCh = ch || firstVoice();
    if (!myCh) return;
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
    await new Promise((done) => socket.timeout(10000).emit("call:join", { ...myState(), ch: myCh }, (err, res) => {
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
    $("watchForm").hidden = true;
    setTimeout(syncWatch, 0); // inCall ja vai estar falso: esconde o video
    for (const id of [...peers.keys()]) closePeer(id);
    for (const s of [micRaw, camStream, screenStream]) if (s) s.getTracks().forEach((t) => t.stop());
    micRaw = camStream = screenStream = null;
    if (ctx) ctx.close().catch(() => {});
    ctx = micSource = micGain = micDest = micAnalyser = null;
    inCall = false; myCh = null; members = [];
    focused.clear();
    $("call").hidden = true;
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
    if (!camStream && stageBlocked()) return;
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
    if (stageBlocked()) return;
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

  // ---------- palco: so oradores falam ----------
  const chanOf = (id) => (app.channels || []).find((c) => c.id === id);
  const isStageCh = (id) => !!(chanOf(id) || {}).stage;
  const meInCall = () => allMembers.find((m) => m.id === socket.id);
  const audience = () => inCall && isStageCh(myCh) && !(meInCall() || {}).speaker;
  function stageBlocked() {
    if (!audience()) return false;
    setNote("Você está na plateia. Levante a mão para pedir para falar.", true);
    return true;
  }
  $("handBtn").addEventListener("click", () => {
    const me = meInCall();
    if (!me) return;
    if (me.speaker) socket.emit("stage:speaker", { sid: socket.id, on: false });
    else socket.emit("stage:hand", !me.hand);
  });
  function toggleMic() {
    if (!inCall) { micOn = !micOn; if (micOn) deaf = false; refreshButtons(); return; } // fora da call: so guarda a escolha
    if (!micOn && stageBlocked()) return;
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
    // mostra na lista o microfone que esta sendo usado de verdade (procura tambem pelo nome)
    let micNow = micRaw && micRaw.getAudioTracks()[0];
    let micId = micNow ? micNow.getSettings().deviceId : prefs.micId;
    if (micNow && !devices.some((d) => d.kind === "audioinput" && d.deviceId === micId)) {
      const byName = devices.find((d) => d.kind === "audioinput" && d.label === micNow.label && d.deviceId !== "default" && d.deviceId !== "communications");
      if (byName) micId = byName.deviceId;
    }
    fill($("micSelect"), "audioinput", micId, "Microfone");
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
  // abre Configuracoes de usuario > Voz e video (settings.js); avShown roda quando a pagina aparece
  function openSettings() { if (app.openUserSettings) app.openUserSettings("voz"); else avShown(); }
  async function avShown() {
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
  app.onAVShown = avShown;
  // menus das setinhas do microfone e do fone (settings.js)
  app.audio = {
    prefs,
    canPickOutput: () => canPickOutput,
    micNow: () => { const t = micRaw && micRaw.getAudioTracks()[0]; return t ? t.getSettings().deviceId : prefs.micId; },
    pick(selId, id) {
      const sel = $(selId);
      if (![...sel.options].some((o) => o.value === id)) { const o = document.createElement("option"); o.value = id; o.textContent = id; sel.append(o); }
      sel.value = id; sel.dispatchEvent(new Event("change"));
    },
    setRange(id, v) { const r = $(id); r.value = v; r.dispatchEvent(new Event("input")); },
  };
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
  // sensibilidade de entrada: a marca na barra mostra o volume minimo para o microfone abrir
  const showSens = () => {
    $("sensRange").value = prefs.sens;
    $("sensVal").textContent = prefs.sens ? prefs.sens * 4 + "%" : "automática";
    $("sensMark").hidden = !prefs.sens;
    $("sensMark").style.left = Math.min(100, (prefs.sens / 250) * 400) + "%";
  };
  showSens();
  $("sensRange").addEventListener("input", (e) => {
    const was = !!prefs.sens;
    prefs.sens = Number(e.target.value); store.set("cp-sens", prefs.sens);
    showSens();
    if (was !== !!prefs.sens && inCall) syncMicTrack(); // troca entre o som cru e o ajustado
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
    el.querySelector(".mbadge")?.remove();
    if (!opts.screen && opts.muted) {
      const f = document.createElement("span"); f.className = "flag"; f.title = opts.deaf ? "Sem áudio" : "Mudo"; f.append(icon(opts.deaf ? "uhead-off" : "umic-off")); label.append(f);
      // na call so com avatares: bolinha vermelha no canto da foto
      const b = document.createElement("span"); b.className = "mbadge"; b.title = f.title; b.append(icon(opts.deaf ? "uhead-off" : "umic-off")); el.append(b);
    }
    el.title = opts.screen ? "" : opts.title;
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

  // alguns navegadores mudam o nome do video no caminho: se a tela nao for achada pelo nome,
  // usa o video que chegou dessa pessoa e que nao e a camera
  const otherVideo = (p, camId) => Object.values(p.streams).find((s) => s.id !== camId && s.getVideoTracks().some((t) => t.readyState === "live")) || null;

  function renderTiles() {
    if (!inCall) return;
    const want = [];
    for (const m of members) {
      const me = m.id === socket.id;
      const p = peers.get(m.id);
      const cam = me ? camStream : p && m.cam ? p.streams[m.cam] : null;
      const scr = me ? screenStream : p && m.screen ? p.streams[m.screen] || otherVideo(p, m.cam) : null;
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
    box.classList.toggle("avmode", !want.some((el) => el.querySelector("video")));
    for (const v of box.querySelectorAll("video")) if (v.paused) v.play().catch(() => {});
    syncFullButtons();
  }

  function renderSidebar() {
    document.querySelectorAll("ul.vpeople[data-vp]").forEach((ul) => {
    ul.replaceChildren();
    const stage = isStageCh(ul.dataset.vp);
    // no palco: oradores primeiro, depois a plateia
    const list = allMembers.filter((x) => x.ch === ul.dataset.vp).sort((a, b) => (stage ? (b.speaker ? 1 : 0) - (a.speaker ? 1 : 0) : 0));
    let lastGroup = null;
    for (const m of list) {
      if (stage) {
        const g = m.speaker ? "Oradores" : "Plateia";
        if (g !== lastGroup) { const h = document.createElement("li"); h.className = "vgrp"; h.textContent = g + " — " + list.filter((x) => !!x.speaker === !!m.speaker).length; ul.append(h); lastGroup = g; }
      }
      const li = document.createElement("li");
      li.dataset.member = m.id;
      if (stage && !m.speaker) li.classList.add("aud");
      const name = document.createElement("span"); name.className = "name"; name.textContent = app.dispName ? app.dispName(m.nick) : m.nick;
      const tags = [];
      if (m.deaf) tags.push("surdo"); else if (!m.mic) tags.push("mudo");
      if (m.cam) tags.push("cam");
      if (m.screen) tags.push("ao vivo");
      const t = document.createElement("span"); t.className = "tags";
      if (m.deaf) t.append(icon("headphones-off")); else if (!m.mic) t.append(icon("mic-off"));
      if (m.cam) t.append(icon("video"));
      if (m.screen) { const live = document.createElement("b"); live.className = "live"; live.textContent = "AO VIVO"; t.append(live); }
      if (stage && m.hand) { t.append(icon("hand")); tags.push("levantou a mão"); }
      t.title = tags.join(" · ");
      li.append(avatar(m.nick), name, t);
      // a moderacao convida para o palco ou manda para a plateia
      if (stage && app.can && app.can("members")) {
        li.classList.add("click");
        li.addEventListener("click", (e) => {
          e.stopPropagation();
          app.showMenu([m.speaker ? ["Mover para a plateia", "users", () => socket.emit("stage:speaker", { sid: m.id, on: false })] : ["Convidar para falar", "mic", () => socket.emit("stage:speaker", { sid: m.id, on: true })]], e.clientX, e.clientY);
        });
      }
      ul.append(li);
    }
    });
    refreshButtons();
    app.callNicks = new Set(allMembers.map((m) => m.nick));
    app.renderPeople();
  }

  socket.on("call:members", (list) => {
    const wasAudience = audience();
    allMembers = Array.isArray(list) ? list : [];
    // plateia do palco fica muda (e sem camera/tela); virar orador libera
    if (inCall && audience()) {
      if (micOn) { micOn = false; applyMic(); }
      if (camStream) toggleCam();
      if (screenStream) stopScreen();
    } else if (inCall && wasAudience && isStageCh(myCh)) setNote("Você agora é orador no palco. Ligue o microfone para falar.");
    members = inCall && myCh ? allMembers.filter((m) => m.ch === myCh) : [];
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
    if (prefs.sens && micAnalyser) {
      const loud = level(micAnalyser) * (prefs.micGain / 100) > prefs.sens / 250;
      if (loud) gateUntil = Date.now() + 350;
      const open = Date.now() < gateUntil;
      if (open !== gateOpen) { gateOpen = open; applyMic(); }
    } else if (!gateOpen) { gateOpen = true; applyMic(); }
    const speaking = new Set();
    if (micAnalyser && micLive() && level(micAnalyser) * (prefs.micGain / 100) > 0.04) speaking.add(socket.id);
    for (const [id, p] of peers) if (p.analyser && level(p.analyser) > 0.04) speaking.add(id);
    document.querySelectorAll("#tiles .tile").forEach((el) => el.classList.toggle("speaking", !el.classList.contains("screen") && speaking.has(el.dataset.member)));
    document.querySelectorAll(".vpeople li").forEach((li) => li.classList.toggle("speaking", speaking.has(li.dataset.member)));
  }, 120);

  // ---------- apertar para falar ----------
  let pttHeld = false, gateOpen = true, gateUntil = 0;
  const micLive = () => micOn && (!prefs.ptt || pttHeld) && (!prefs.sens || gateOpen);
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
  $("simpleMic").checked = prefs.simple;
  $("simpleMic").addEventListener("change", async (e) => {
    prefs.simple = e.target.checked; store.set("cp-simplemic", prefs.simple ? "on" : "off");
    if (!inCall && !preview) return;
    lastHeard = Date.now();
    try { await startMic(); syncMicTrack(); } catch { setNote("ERRO: não deu para usar esse microfone.", true); }
  });

  // ---------- diagnostico: testa o microfone de jeitos diferentes e mostra o que chega ----------
  async function measureStream(stream, ms) {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    await c.resume().catch(() => {});
    const an = c.createAnalyser(); an.fftSize = 512;
    c.createMediaStreamSource(stream).connect(an);
    let max = 0;
    const end = Date.now() + ms;
    while (Date.now() < end) { await new Promise((r) => setTimeout(r, 100)); max = Math.max(max, level(an)); }
    const state = c.state;
    c.close().catch(() => {});
    return { max, state };
  }
  const pct = (v) => Math.round(v * 1000) / 10 + "%";
  $("micDiag").addEventListener("click", async () => {
    const out = $("diagOut"), lines = [];
    const show = () => { out.hidden = false; out.textContent = lines.join("\n"); };
    const btn = $("micDiag"); btn.disabled = true;
    lines.push("FALE SEM PARAR durante o teste (uns 9 segundos)...", ""); show();
    lines.push("Navegador: " + navigator.userAgent.replace(/^.*\) /, ""));
    if (ctx) lines.push("Som do site: " + ctx.state + (inCall ? " (na call)" : " (teste)"));
    const t = rawTrack();
    if (t) lines.push("Microfone em uso: " + t.label + " | ligado: " + t.enabled + " | mudo pelo sistema: " + t.muted + " | estado: " + t.readyState);
    lines.push("Mic na call: " + (micOn ? "ligado" : "DESLIGADO") + " | apertar para falar: " + (prefs.ptt ? "SIM" : "não") + " | volume: " + prefs.micGain + "%");
    show();
    const tests = [
      ["1. Padrão do Windows, sem filtros", { audio: true }],
      ["2. Microfone escolhido, sem filtros", { audio: { deviceId: ($("micSelect").value || prefs.micId) ? { exact: $("micSelect").value || prefs.micId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }],
      ["3. Microfone escolhido, com filtros", { audio: { deviceId: ($("micSelect").value || prefs.micId) ? { exact: $("micSelect").value || prefs.micId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }],
    ];
    const res = [];
    const chosenId = $("micSelect").value || prefs.micId;
    let chosenLabel = "";
    for (const [name, c] of tests) {
      try {
        const st = await navigator.mediaDevices.getUserMedia(c);
        const tr = st.getAudioTracks()[0];
        if (c === tests[1][1]) chosenLabel = tr.label;
        const m = await measureStream(st, 3000);
        lines.push(name + ": " + (m.max > 0.01 ? "OUVIU (" + pct(m.max) + ")" : "SILÊNCIO (" + pct(m.max) + ")") + " | " + tr.label + (tr.muted ? " | mudo pelo sistema" : ""));
        res.push(m.max > 0.01);
        st.getTracks().forEach((x) => x.stop());
      } catch (e) { lines.push(name + ": ERRO " + e.name + " " + e.message); res.push(false); }
      show();
    }
    // o que esta saindo de verdade para cada pessoa da call
    for (const [id, p] of peers) {
      try {
        const stats = await p.pc.getStats();
        let sent = 0, lvl = null;
        stats.forEach((r) => {
          if (r.type === "outbound-rtp" && r.kind === "audio") sent += r.bytesSent || 0;
          if (r.type === "media-source" && r.kind === "audio" && r.audioLevel !== undefined) lvl = r.audioLevel;
        });
        const m = members.find((x) => x.id === id);
        lines.push("Enviando para " + (m ? m.nick : "?") + ": " + Math.round(sent / 1024) + " KB" + (lvl !== null ? " | nível " + pct(lvl) : "") + " | conexão: " + p.pc.connectionState);
      } catch {}
    }
    lines.push("");
    if (!res.some(Boolean)) lines.push("RESULTADO: o navegador não recebe som de nenhum jeito. O problema está no fone, no Windows ou na permissão do navegador, não no site. Teste em outro navegador (Chrome) ou em outro site de teste de microfone.");
    else if (res[1] && t && chosenLabel && t.label !== chosenLabel) {
      lines.push("RESULTADO: a call estava usando \"" + t.label + "\", mas quem funciona é \"" + chosenLabel + "\". Troquei para ele. Fale de novo e veja a barra.");
      try { prefs.micId = chosenId; store.set("cp-mic", chosenId); await startMic(); syncMicTrack(); fillDevices(); } catch {}
    }
    else if (res[1] && !res[2]) { lines.push("RESULTADO: o microfone funciona SEM filtros. Liguei a opção \"Microfone sem filtros\" para você."); if (!prefs.simple) $("simpleMic").click(); }
    else if (res[0] && !res[1]) lines.push("RESULTADO: o padrão do Windows funciona, mas o microfone escolhido não. Escolha \"Padrão\" na lista de entrada.");
    else lines.push("RESULTADO: o microfone chega no navegador. Se mesmo assim ninguém te ouve, me mande um print deste texto.");
    show();
    btn.disabled = false;
  });

  $("pttCheck").checked = prefs.ptt;
  $("pttCheck").addEventListener("change", (e) => {
    prefs.ptt = e.target.checked; store.set("cp-ptt", prefs.ptt ? "on" : "off");
    setPtt(false); applyMic(); refreshButtons();
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
    if (!inCall || !watchState || (watchState.ch && watchState.ch !== myCh)) { box.hidden = true; if (player) { try { player.destroy(); } catch {} player = null; playerVid = null; $("ytBox").replaceChildren(Object.assign(document.createElement("div"), { id: "ytPlayer" })); } return; }
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
  $("watchBtn").addEventListener("click", (e) => { e.stopPropagation(); actsMenu($("watchBtn")); });
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
    if (!inCall) return join(firstVoice());
    $("call").classList.toggle("min", false);
    $("call").scrollIntoView({ block: "nearest" });
  });
  $("leaveBtn").addEventListener("click", leave);
  $("vpLeave").addEventListener("click", leave);
  // clicar num canal de voz: entra; se ja esta em outro, muda para este; se e o seu, mostra a call
  document.addEventListener("click", async (e) => {
    const vc = e.target.closest(".chan.voice[data-voice]");
    if (!vc || e.target.closest(".cgear")) return;
    document.body.classList.remove("railopen");
    const ch = vc.dataset.voice;
    if (inCall && myCh === ch) { $("call").classList.toggle("min", false); refreshButtons(); return; }
    if (inCall) leave();
    join(ch);
  });
  $("upMic").addEventListener("click", toggleMic);
  $("upDeaf").addEventListener("click", toggleDeaf);
  $("micBtn").addEventListener("click", toggleMic);
  $("deafBtn").addEventListener("click", toggleDeaf);
  $("camBtn").addEventListener("click", toggleCam);
  $("screenBtn").addEventListener("click", toggleScreen);
  $("minBtn").addEventListener("click", () => { $("call").classList.toggle("min"); refreshButtons(); });

  // Arrastar a borda de baixo muda a altura da call; fica guardado no navegador
  const callEl = $("call");
  // no minimo cabe uma fileira de fotos e a barra de botoes
  const minH = () => ((callEl.querySelector(".ctray") || {}).offsetHeight || 64) + 104;
  const maxH = () => Math.max(minH(), (callEl.parentElement ? callEl.parentElement.clientHeight : innerHeight) - 160);
  const setCallH = (h) => {
    if (!h) { callEl.style.height = ""; callEl.classList.remove("sized"); return; }
    callEl.style.height = Math.round(Math.min(maxH(), Math.max(minH(), h))) + "px";
    callEl.classList.add("sized");
  };
  setCallH(Number(store.get("cp-callh")) || 0);
  $("callResize").addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY, startH = callEl.getBoundingClientRect().height;
    callEl.classList.add("resizing"); document.body.classList.add("call-resizing");
    const move = (ev) => setCallH(startH + ev.clientY - startY);
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      callEl.classList.remove("resizing"); document.body.classList.remove("call-resizing");
      store.set("cp-callh", parseInt(callEl.style.height) || "");
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  });
  $("callResize").addEventListener("dblclick", () => { setCallH(0); store.set("cp-callh", ""); });
  addEventListener("resize", () => { if (callEl.classList.contains("sized")) setCallH(parseInt(callEl.style.height)); });
  // "..." da call: configuracoes, esconder os videos e apertar para falar
  $("moreBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const r = $("moreBtn").getBoundingClientRect(), min = $("call").classList.contains("min");
    app.showMenu([
      ["Configurações de voz e vídeo", "ugear", openSettings],
      [min ? "Mostrar os vídeos" : "Esconder os vídeos", min ? "chevron-down" : "chevron-up", () => $("minBtn").click()],
      [prefs.ptt ? "Desligar \"apertar para falar\"" : "Ligar \"apertar para falar\"", "hand", () => $("pttCheck").click()],
    ], r.left, r.bottom + 6);
  });
  // atividades: assistir YouTube junto (na call), poker e truco
  function actsMenu(anchor, up) {
    const r = anchor.getBoundingClientRect();
    const items = [
      inCall ? ["Assistir YouTube junto", "play", () => { $("watchForm").hidden = !$("watchForm").hidden; if (!$("watchForm").hidden) $("watchUrl").focus(); }] : null,
      ["Poker", "spade", () => $("actOpen").click()],
      ["Truco", "club", () => $("trOpen").click()],
    ];
    app.showMenu(items, r.left, up ? r.top - 8 - items.filter(Boolean).length * 40 : r.bottom + 6);
  }
  app.actsMenu = actsMenu;
  $("micMenuBtn").addEventListener("click", (e) => { e.stopPropagation(); if (app.openDeviceMenu) app.openDeviceMenu($("micMenuBtn"), "audioinput"); });
  $("vpCam").addEventListener("click", () => $("camBtn").click());
  $("vpScreen").addEventListener("click", () => $("screenBtn").click());
  $("vpAct").addEventListener("click", (e) => { e.stopPropagation(); actsMenu($("vpAct"), true); });
  $("vpNoise").addEventListener("click", () => { $("simpleMic").click(); setTimeout(refreshButtons, 50); });
  // conversa privada: ligar e ligar com video pelo topo (como no Discord)
  $("dmCallBtn").addEventListener("click", () => { if (!inCall) join(firstVoice()); else { $("call").classList.remove("min"); refreshButtons(); } });
  $("dmVideoBtn").addEventListener("click", async () => { if (!inCall) await join(firstVoice()); if (inCall && !camStream) toggleCam(); });
  window.addEventListener("beforeunload", () => { if (inCall) socket.emit("call:leave"); });

  app.onJoin = () => { refreshButtons(); renderSidebar(); };
  app.renderVoice = renderSidebar;
  app.isDeaf = () => deaf;
  app.inCall = () => inCall;
  refreshButtons();
  renderSidebar();
})();

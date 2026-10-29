// Chamada de voz e video estilo Discord.
// Cada pessoa se conecta direto com cada outra (WebRTC em malha); o servidor so repassa os sinais.
(() => {
  const $ = (id) => document.getElementById(id);
  const app = window.ChatPedro;
  const { socket, avatar, setNote, store } = app;
  const ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };
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
    master: Number(store.get("cp-master") || 100),
  };
  const volumeOf = (nick) => Number(store.get("cp-vol-" + nick.toLowerCase()) || 100);

  // ---------- botoes ----------
  const btn = (id, text, off) => { $(id).textContent = text; $(id).classList.toggle("off", !!off); };
  function refreshButtons() {
    // desligado fica vermelho; ligado mostra ON
    btn("micBtn", micOn ? "[MIC]" : "[MIC OFF]", !micOn);
    btn("deafBtn", deaf ? "[FONE OFF]" : "[FONE]", deaf);
    btn("camBtn", camStream ? "[CAM ON]" : "[CAM]", false);
    btn("screenBtn", screenStream ? "[TELA ON]" : "[TELA]", false);
    $("screenBtn").hidden = !canShareScreen;
    $("minBtn").textContent = $("call").classList.contains("min") ? "[+]" : "[-]";
    $("minBtn").title = $("call").classList.contains("min") ? "Mostrar os videos" : "Esconder os videos";
    const n = members.length;
    $("callBtn").textContent = n ? "[CALL " + n + "]" : "[CALL]";
    $("joinBtn").hidden = inCall || !app.nick;
    $("callBtn").hidden = !app.nick;
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
    micGain = ctx.createGain();
    micGain.gain.value = prefs.micGain / 100;
    micDest = ctx.createMediaStreamDestination(); // o que os outros ouvem, ja com o volume aplicado
    micGain.connect(micDest);
    micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 512;
  }
  const micTrack = () => micDest && micDest.stream.getAudioTracks()[0];

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
    if (micTrack()) out.push([micTrack(), micDest.stream]);
    if (camStream) out.push([camStream.getVideoTracks()[0], camStream]);
    if (screenStream) out.push([screenStream.getVideoTracks()[0], screenStream]);
    return out;
  }

  function getPeer(id) {
    let p = peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection(ICE);
    p = { pc, polite: socket.id < id, makingOffer: false, ignoreOffer: false, streams: {}, audio: null, senders: new Map(), analyser: null };
    peers.set(id, p);
    for (const [track, stream] of localTracks()) p.senders.set(track.id, pc.addTrack(track, stream));

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

  async function join() {
    if (inCall || !app.nick) return;
    if (!window.RTCPeerConnection || !navigator.mediaDevices) { setNote("ERRO: seu navegador nao suporta chamadas. Tente o Chrome.", true); return; }
    buildAudioGraph();
    try { await startMic(); }
    catch { micOn = false; setNote("Sem acesso ao microfone. Voce entrou mudo; libere o microfone no navegador para falar.", true); }
    if (micTrack()) micTrack().enabled = micOn;
    socket.emit("call:join", myState(), (res) => {
      if (!res || !res.ok) { setNote("ERRO: nao deu para entrar na chamada.", true); cleanup(); return; }
      inCall = true;
      $("call").hidden = false;
      $("call").classList.remove("min");
      for (const id of res.others) getPeer(id); // quem entra chama quem ja esta
      refreshButtons();
      renderTiles();
      fillDevices();
    });
  }

  function cleanup() {
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
  socket.on("disconnect", () => { if (inCall) { cleanup(); refreshButtons(); setNote("A conexao caiu e voce saiu da chamada. Entre de novo.", true); } });

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
      } catch { setNote("ERRO: sem acesso a camera. Libere a camera no navegador.", true); return; }
      addTrackToAll(camStream.getVideoTracks()[0], camStream);
      fillDevices();
    }
    sendState(); refreshButtons(); renderTiles();
  }

  async function toggleScreen() {
    if (screenStream) return stopScreen();
    try { screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false }); }
    catch { return; } // a pessoa cancelou
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
    micTrack().enabled = micOn;
    sendState(); refreshButtons(); renderTiles();
  }
  function toggleDeaf() {
    deaf = !deaf;
    if (deaf && micOn && micTrack()) { micOn = false; micTrack().enabled = false; } // como no Discord: surdo tambem muta
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
    fill($("camSelect"), "videoinput", camStream && camStream.getVideoTracks()[0].getSettings().deviceId || prefs.camId, "Camera");
  }

  $("micSelect").addEventListener("change", async (e) => {
    prefs.micId = e.target.value; store.set("cp-mic", prefs.micId);
    if (!inCall) return;
    try { await startMic(); micTrack().enabled = micOn; } // o som enviado passa pelo mesmo ganho, sem renegociar
    catch { setNote("ERRO: nao deu para usar esse microfone.", true); }
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
    } catch { setNote("ERRO: nao deu para usar essa camera.", true); }
  });
  $("micGain").value = prefs.micGain;
  $("micGainVal").textContent = prefs.micGain + "%";
  $("micGain").addEventListener("input", (e) => {
    prefs.micGain = Number(e.target.value); store.set("cp-micgain", prefs.micGain);
    $("micGainVal").textContent = prefs.micGain + "%";
    if (micGain) micGain.gain.value = prefs.micGain / 100;
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
      fb.type = "button"; fb.className = "cmd full"; fb.textContent = "[TELA CHEIA]";
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
      if (b) b.textContent = isFull(el) ? "[SAIR DA TELA CHEIA]" : "[TELA CHEIA]";
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
        id: m.id, nick: m.nick, title: m.nick + (me ? " (voce)" : ""), mirror: me, muted, deaf: m.deaf, volume: !me,
      }));
      if (scr) want.push(videoTile(m.id + ":screen", scr, { id: m.id, nick: m.nick, title: "Tela de " + m.nick + (me ? " (voce)" : ""), screen: true }));
    }
    for (const [key, el] of tiles) if (!want.includes(el)) { el.remove(); tiles.delete(key); focused.delete(key); }
    // so mexe na ordem quando ela muda de verdade: tirar um quadro da pagina fecha a tela cheia dele
    const box = $("tiles"), cur = [...box.children];
    if (cur.length !== want.length || cur.some((el, i) => el !== want[i])) box.replaceChildren(...want);
    for (const v of box.querySelectorAll("video")) if (v.paused) v.play().catch(() => {});
    syncFullButtons();
  }

  function renderSidebar() {
    $("callTitle").textContent = "CALL " + members.length;
    const ul = $("callPeople");
    ul.replaceChildren();
    if (!members.length) {
      const li = document.createElement("li");
      li.style.color = "var(--dim)"; li.textContent = "vazia";
      ul.append(li);
    }
    for (const m of members) {
      const li = document.createElement("li");
      li.dataset.member = m.id;
      const name = document.createElement("span"); name.className = "name"; name.textContent = m.nick;
      const tags = [];
      if (m.deaf) tags.push("surdo"); else if (!m.mic) tags.push("mudo");
      if (m.cam) tags.push("cam");
      if (m.screen) tags.push("ao vivo");
      const t = document.createElement("span"); t.className = "tags"; t.textContent = tags.length ? "[" + tags.join("|") + "]" : "";
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
  setInterval(() => {
    if (!inCall) return;
    const speaking = new Set();
    if (micAnalyser && micOn && level(micAnalyser) * (prefs.micGain / 100) > 0.04) speaking.add(socket.id);
    for (const [id, p] of peers) if (p.analyser && level(p.analyser) > 0.04) speaking.add(id);
    document.querySelectorAll("#tiles .tile").forEach((el) => el.classList.toggle("speaking", !el.classList.contains("screen") && speaking.has(el.dataset.member)));
    document.querySelectorAll("#callPeople li").forEach((li) => li.classList.toggle("speaking", speaking.has(li.dataset.member)));
    if (!$("settings").hidden && micAnalyser) $("micMeter").style.width = Math.min(100, level(micAnalyser) * 400 * (prefs.micGain / 100)) + "%";
  }, 120);

  $("callBtn").addEventListener("click", () => {
    if (!inCall) return join();
    $("call").classList.toggle("min", false);
    $("call").scrollIntoView({ block: "nearest" });
  });
  $("joinBtn").addEventListener("click", () => { document.body.classList.remove("drawer"); join(); });
  $("leaveBtn").addEventListener("click", leave);
  $("micBtn").addEventListener("click", toggleMic);
  $("deafBtn").addEventListener("click", toggleDeaf);
  $("camBtn").addEventListener("click", toggleCam);
  $("screenBtn").addEventListener("click", toggleScreen);
  $("minBtn").addEventListener("click", () => { $("call").classList.toggle("min"); refreshButtons(); });
  $("setBtn").addEventListener("click", () => { fillDevices(); $("settings").hidden = false; });
  $("setClose").addEventListener("click", () => { $("settings").hidden = true; });
  $("settings").addEventListener("click", (e) => { if (e.target === $("settings")) $("settings").hidden = true; });
  window.addEventListener("beforeunload", () => { if (inCall) socket.emit("call:leave"); });

  app.onJoin = () => { refreshButtons(); renderSidebar(); };
  refreshButtons();
  renderSidebar();
})();

// Mesa do Blefe (lado do navegador): um porao com uma mesa redonda em 3D e bonecos com a foto de
// perfil de cada um. O servidor cuida das regras; aqui so desenha, anima e manda as jogadas.
// A biblioteca 3D (three.js) so e baixada quando a pessoa abre a mesa.
(() => {
  const $ = (id) => document.getElementById(id);
  const app = window.ChatPedro;
  const { socket, setNote, store } = app;
  const SUIT = { h: "♥", d: "♦", s: "♠", c: "♣", J: "★" };
  const SUIT_NAME = { h: "Copas", d: "Ouros", s: "Espadas", c: "Paus", J: "Coringa" };
  const RED = { h: true, d: true };
  const COLORS = ["#c0392b", "#2e86de", "#27ae60", "#8e44ad", "#e67e22", "#16a085", "#d4ac0d", "#7f8c8d", "#e84393", "#2d3436"];
  const HATS = [["none", "Sem chapéu"], ["cartola", "Cartola"], ["bone", "Boné"], ["festa", "Chapéu de festa"], ["coroa", "Coroa"], ["cowboy", "Chapéu de caubói"]];
  const EMOTES = [["apontar", "👉", "Apontar (clique num boneco para apontar para ele)"], ["rir", "😂", "Rir"], ["bater", "✊", "Bater na mesa"], ["ombros", "🤷", "Dar de ombros"], ["suar", "😰", "Suar frio"], ["joinha", "👍", "Joinha"]];
  const SEAT_R = 1.72, TABLE_Y = 0.78;

  let st = null, clockSkew = 0, lastEnds = 0, lastTick = -1;
  const selected = new Set();
  let sound = store.get("chatpedro-blefesom") !== "off";
  let look = (() => { try { const l = JSON.parse(store.get("chatpedro-blefe-look") || "null"); if (l && COLORS.includes(l.color)) return l; } catch {} return { color: COLORS[Math.floor(Math.random() * COLORS.length)], hat: "none" }; })();
  const autoLite = matchMedia("(pointer: coarse)").matches || (navigator.deviceMemory || 8) <= 4 || (navigator.hardwareConcurrency || 8) <= 4;
  let lite = store.get("chatpedro-blefe-leve") ? store.get("chatpedro-blefe-leve") === "on" : autoLite;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const open = () => !$("blefe").hidden;
  const seated = () => st && st.me >= 0;
  const inGame = () => st && !["empty", "lobby"].includes(st.stage);
  const nameOf = (i) => (st && st.seats[i] && st.seats[i].nick) || "lugar vazio";
  function done(r) { if (r && !r.ok) setNote("ERRO: " + r.error, true); }

  // ---------- sons (feitos na hora, sem arquivos) ----------
  let actx = null;
  const ac = () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); return actx; } catch { return null; } };
  function tone(notes) {
    const a = sound && ac(); if (!a) return;
    let t = a.currentTime;
    for (const [freq, dur, type, vol] of notes) {
      const o = a.createOscillator(), g = a.createGain();
      o.type = type || "square"; o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur);
      t += dur * 0.9;
    }
  }
  function noise(dur, vol, lowpass) {
    const a = sound && ac(); if (!a) return;
    const n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
    const src = a.createBufferSource(), g = a.createGain(), f = a.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = lowpass || 4000;
    src.buffer = buf; g.gain.value = vol;
    src.connect(f).connect(g).connect(a.destination); src.start();
  }
  const SFX = {
    card: () => noise(0.08, 0.25, 6000),
    turn: () => tone([[880, 0.08], [1320, 0.12]]),
    doubt: () => tone([[300, 0.1, "sawtooth"], [450, 0.1, "sawtooth"], [700, 0.25, "sawtooth"]]),
    flip: () => noise(0.05, 0.2, 8000),
    beat: () => tone([[55, 0.12, "sine", 0.4], [50, 0.16, "sine", 0.3]]),
    click: () => { tone([[2400, 0.03, "square", 0.08]]); noise(0.03, 0.3, 9000); },
    bang: () => { noise(0.9, 1.2, 1800); tone([[90, 0.4, "sine", 0.5]]); },
    win: () => tone([[523, 0.12], [659, 0.12], [784, 0.12], [1046, 0.4]]),
    thud: () => { noise(0.12, 0.7, 400); tone([[70, 0.12, "sine", 0.4]]); },
    pop: () => tone([[700, 0.04], [900, 0.05]]),
  };
  let beatTimer = null;
  const stopBeat = () => { clearInterval(beatTimer); beatTimer = null; };

  // ---------- 3D ----------
  let THREE = null, R = null, loading = null, failed = false;
  async function ensure3D() {
    if (R || failed) return R;
    if (!loading) loading = (async () => {
      try {
        THREE = await import("/vendor/three/three.module.min.js");
        build();
      } catch (e) {
        failed = true;
        console.warn("Mesa do Blefe sem 3D:", e);
      }
    })();
    await loading;
    return R;
  }

  const texCache = new Map();
  function canvasTex(w, h, draw) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = lite ? 1 : 4;
    return t;
  }
  const cached = (k, fn) => { if (!texCache.has(k)) texCache.set(k, fn()); return texCache.get(k); };
  function rr(x, X, Y, W, H, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); }

  const cardBack = () => cached("back", () => canvasTex(128, 180, (x, w, h) => {
    x.fillStyle = "#f2ead8"; rr(x, 0, 0, w, h, 12); x.fill();
    x.fillStyle = "#5b1a2a"; rr(x, 8, 8, w - 16, h - 16, 8); x.fill();
    x.strokeStyle = "rgba(230, 190, 110, 0.55)"; x.lineWidth = 2;
    for (let i = -h; i < w + h; i += 16) { x.beginPath(); x.moveTo(i, 8); x.lineTo(i + h, h - 8); x.stroke(); x.beginPath(); x.moveTo(i + h, 8); x.lineTo(i, h - 8); x.stroke(); }
    x.fillStyle = "#5b1a2a"; x.beginPath(); x.arc(w / 2, h / 2, 30, 0, 7); x.fill();
    x.strokeStyle = "#e6be6e"; x.lineWidth = 3; x.stroke();
    x.fillStyle = "#e6be6e"; x.font = "bold 36px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("?", w / 2, h / 2 + 2);
  }));
  const cardFace = (code) => cached("card:" + code, () => canvasTex(128, 180, (x, w, h) => {
    x.fillStyle = "#f6f1e4"; rr(x, 0, 0, w, h, 12); x.fill();
    x.textAlign = "center"; x.textBaseline = "middle";
    if (code === "J") {
      const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#5b2c83"); g.addColorStop(1, "#b0306a");
      x.fillStyle = g; rr(x, 8, 8, w - 16, h - 16, 8); x.fill();
      x.fillStyle = "#ffd84d"; x.font = "bold 84px sans-serif"; x.fillText("★", w / 2, h / 2 - 8);
      x.font = "bold 17px sans-serif"; x.fillText("CORINGA", w / 2, h - 30);
      return;
    }
    x.fillStyle = RED[code] ? "#c62828" : "#1b1b1b";
    x.font = "bold 96px serif"; x.fillText(SUIT[code], w / 2, h / 2 + 6);
    x.font = "bold 28px serif"; x.fillText(SUIT[code], 22, 26); x.save(); x.translate(w - 22, h - 26); x.rotate(Math.PI); x.fillText(SUIT[code], 0, 0); x.restore();
  }));
  const suitToken = (code) => cached("token:" + code, () => canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = "#f2ead8"; x.beginPath(); x.arc(w / 2, h / 2, 124, 0, 7); x.fill();
    x.strokeStyle = "#e6be6e"; x.lineWidth = 10; x.stroke();
    x.fillStyle = RED[code] ? "#c62828" : "#1b1b1b"; x.font = "bold 170px serif"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(SUIT[code] || "?", w / 2, h / 2 + 12);
  }));
  const flashTex = () => cached("flash", () => canvasTex(128, 128, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,230,1)"); g.addColorStop(0.3, "rgba(255,200,80,0.9)"); g.addColorStop(1, "rgba(255,120,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, w, w);
  }));
  function woodTex(dark, light, planks) {
    return cached("wood:" + dark + planks, () => {
      const t = canvasTex(256, 256, (x, w, h) => {
        x.fillStyle = dark; x.fillRect(0, 0, w, h);
        for (let i = 0; i < 900; i++) { x.fillStyle = Math.random() < 0.5 ? light : "rgba(0,0,0,0.25)"; x.globalAlpha = 0.18; x.fillRect(Math.random() * w, Math.random() * h, 40 + Math.random() * 80, 1 + Math.random() * 2); }
        x.globalAlpha = 1; x.fillStyle = "rgba(0,0,0,0.55)";
        for (let i = 0; i <= planks; i++) x.fillRect(0, (i * h) / planks, w, 2);
      });
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    });
  }
  const brickTex = () => cached("brick", () => {
    const t = canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = "#1c1410"; x.fillRect(0, 0, w, h);
      for (let r = 0; r < 8; r++) for (let c = -1; c < 4; c++) {
        const bx = c * 72 + (r % 2 ? 36 : 0), by = r * 32;
        const v = 60 + Math.random() * 30;
        x.fillStyle = "rgb(" + (v + 25) + "," + (v * 0.55) + "," + (v * 0.4) + ")";
        x.fillRect(bx + 3, by + 3, 66, 26);
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 2);
    return t;
  });

  // Rosto do boneco: a foto de perfil numa bola de pele (ou a letra do nome, como no chat)
  const SKIN = "#e7b48f";
  const faceCache = new Map();
  function faceTex(nick, gray) {
    const sp = app.avatar(nick);
    const img = sp.querySelector("img");
    const src = img ? img.src : "letter:" + sp.textContent + sp.style.background;
    const key = nick.toLowerCase() + (gray ? ":g" : "");
    const hit = faceCache.get(key);
    if (hit && hit.src === src) return hit.tex;
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const x = c.getContext("2d");
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const paint = (image) => {
      x.fillStyle = SKIN; x.fillRect(0, 0, 256, 256);
      x.save(); x.beginPath(); x.arc(128, 128, 118, 0, 7); x.clip();
      if (image) {
        const s = Math.min(image.width, image.height);
        x.drawImage(image, (image.width - s) / 2, (image.height - s) / 2, s, s, 10, 10, 236, 236);
      } else {
        x.fillStyle = sp.style.background || "#5865f2"; x.fillRect(0, 0, 256, 256);
        x.fillStyle = "#fff"; x.font = "bold 130px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(sp.textContent || "?", 128, 138);
      }
      x.restore();
      x.strokeStyle = "rgba(0,0,0,0.35)"; x.lineWidth = 6; x.beginPath(); x.arc(128, 128, 118, 0, 7); x.stroke();
      if (gray) {
        const d = x.getImageData(0, 0, 256, 256), p = d.data;
        for (let i = 0; i < p.length; i += 4) { const v = p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11; p[i] = p[i + 1] = p[i + 2] = v * 0.9 + 20; }
        x.putImageData(d, 0, 0);
      }
      tex.needsUpdate = true;
    };
    paint(null);
    if (img) { const im = new Image(); im.onload = () => paint(im); im.src = src; }
    if (hit) hit.tex.dispose();
    faceCache.set(key, { src, tex });
    return tex;
  }

  function labelTex(lines, color) {
    return canvasTex(512, 128, (x, w, h) => {
      x.font = "bold 46px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      const tw = Math.min(w - 8, Math.max(...lines.map((l, i) => x.measureText(l).width * (i ? 0.75 : 1))) + 44);
      x.fillStyle = "rgba(10,10,12,0.72)"; rr(x, (w - tw) / 2, 4, tw, h - 8, 26); x.fill();
      if (color) { x.strokeStyle = color; x.lineWidth = 5; x.stroke(); }
      x.fillStyle = "#fff";
      if (lines.length === 1) x.fillText(lines[0], w / 2, h / 2 + 2, w - 40);
      else { x.fillText(lines[0], w / 2, 44, w - 40); x.font = "bold 32px sans-serif"; x.fillStyle = "#ffd84d"; x.fillText(lines[1], w / 2, 96, w - 40); }
    });
  }
  function bubbleTex(text) {
    return canvasTex(512, 160, (x, w, h) => {
      x.font = "bold 54px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      const tw = Math.min(w - 8, x.measureText(text).width + 60);
      x.fillStyle = "#fff"; rr(x, (w - tw) / 2, 6, tw, 110, 40); x.fill();
      x.beginPath(); x.moveTo(w / 2 - 18, 112); x.lineTo(w / 2, 150); x.lineTo(w / 2 + 18, 112); x.fill();
      x.fillStyle = "#111"; x.fillText(text, w / 2, 62, w - 50);
    });
  }

  // ---------- cena ----------
  function build() {
    const stage = $("blStage");
    const renderer = new THREE.WebGLRenderer({ antialias: !lite, powerPreference: "low-power" });
    renderer.setPixelRatio(lite ? 1 : Math.min(devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = !lite;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = "bl-canvas";
    stage.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0807);
    scene.fog = new THREE.Fog(0x0b0807, 5.5, 12);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.03, 40);
    camera.rotation.order = "YXZ";
    scene.add(camera);

    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
    const M = {
      floor: std({ map: (() => { const t = woodTex("#2b1c12", "#5a3a22", 8).clone(); t.repeat.set(5, 5); t.needsUpdate = true; return t; })() }),
      wall: std({ map: brickTex() }),
      wood: std({ map: woodTex("#4a2c17", "#7a4a26", 3), color: 0xcfa27a }),
      darkWood: std({ color: 0x2a170c }),
      felt: std({ color: 0x3e0d16, roughness: 1 }),
      rim: std({ color: 0x3a2010, roughness: 0.5 }),
      metal: std({ color: 0x3b3d42, metalness: 0.85, roughness: 0.35 }),
      grip: std({ color: 0x6b3b1d, roughness: 0.6 }),
      skin: std({ color: SKIN, roughness: 0.7 }),
      pants: std({ color: 0x23252b }),
      shoe: std({ color: 0x111111 }),
      mouth: std({ color: 0x4a0e12, roughness: 0.4 }),
      arrow: new THREE.MeshBasicMaterial({ color: 0xffd84d }),
      arrowRed: new THREE.MeshBasicMaterial({ color: 0xff4444 }),
      shade: std({ color: 0x1f3a2a, side: THREE.DoubleSide, metalness: 0.4, roughness: 0.5 }),
      bulb: new THREE.MeshBasicMaterial({ color: 0xfff1c4 }),
      bottle: std({ color: 0x2f6b3a, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 }),
      ghost: std({ color: 0xdfe8ff, transparent: true, opacity: 0.55, emissive: 0x334466, depthWrite: false }),
      sweat: new THREE.MeshBasicMaterial({ color: 0x8fd3ff }),
      hit: new THREE.MeshBasicMaterial({ visible: false }),
      back: new THREE.MeshStandardMaterial({ map: cardBack(), roughness: 0.6 }),
    };
    const mesh = (geo, mat, shadow) => { const m = new THREE.Mesh(geo, mat); if (shadow) { m.castShadow = true; m.receiveShadow = true; } return m; };

    // porao: chao de tabua, paredes de tijolo, barris e uma prateleira com garrafas
    const floor = mesh(new THREE.PlaneGeometry(14, 14), M.floor); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const room = mesh(new THREE.BoxGeometry(12, 4.2, 12), M.wall); room.material = M.wall.clone(); room.material.side = THREE.BackSide; room.position.y = 2.1; scene.add(room);
    const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.05, lite ? 10 : 18);
    const hoopGeo = new THREE.TorusGeometry(0.43, 0.025, 6, lite ? 12 : 20);
    for (const [bx, bz] of [[-4.2, -3.6], [-3.4, -4.4], [4.5, 3.9], [4.3, -4.2]]) {
      const b = mesh(barrelGeo, M.wood, true); b.position.set(bx, 0.52, bz); scene.add(b);
      for (const hy of [0.2, 0.84]) { const h = mesh(hoopGeo, M.metal); h.rotation.x = Math.PI / 2; h.position.set(bx, hy, bz); scene.add(h); }
    }
    const crate = mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), M.wood, true); crate.position.set(-4.6, 0.4, 3.8); crate.rotation.y = 0.4; scene.add(crate);
    const shelf = mesh(new THREE.BoxGeometry(3, 0.08, 0.4), M.darkWood); shelf.position.set(0, 1.7, -5.75); scene.add(shelf);
    const bottleGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.32, 8);
    for (let i = 0; i < 9; i++) { const b = mesh(bottleGeo, M.bottle); b.position.set(-1.3 + i * 0.32, 1.9, -5.7); scene.add(b); }

    // mesa redonda com feltro vinho
    const table = new THREE.Group(); scene.add(table);
    const top = mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.08, lite ? 28 : 48), M.rim, true); top.position.y = TABLE_Y - 0.04; table.add(top);
    const felt = mesh(new THREE.CircleGeometry(1.13, lite ? 28 : 48), M.felt); felt.rotation.x = -Math.PI / 2; felt.position.y = TABLE_Y + 0.001; felt.receiveShadow = true; table.add(felt);
    const leg = mesh(new THREE.CylinderGeometry(0.12, 0.16, TABLE_Y - 0.08, 12), M.darkWood, true); leg.position.y = (TABLE_Y - 0.08) / 2; table.add(leg);
    const foot = mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.06, 20), M.darkWood, true); foot.position.y = 0.03; table.add(foot);

    // ficha no meio da mesa mostrando o naipe da rodada (gira devagar)
    const token = new THREE.Group(); token.position.y = TABLE_Y + 0.2; table.add(token);
    const tokenMat = new THREE.MeshStandardMaterial({ map: suitToken("?"), roughness: 0.5, side: THREE.DoubleSide });
    const tokenFace = mesh(new THREE.CircleGeometry(0.15, 32), tokenMat); token.add(tokenFace);
    const tokenRim = mesh(new THREE.TorusGeometry(0.15, 0.012, 6, 32), M.metal); token.add(tokenRim);
    const tokenStand = mesh(new THREE.CylinderGeometry(0.01, 0.04, 0.06, 8), M.metal); tokenStand.position.y = -0.17; token.add(tokenStand);

    // lampada pendurada: a unica luz forte (e a que faz sombra)
    const lampY = 2.55;
    const cable = mesh(new THREE.CylinderGeometry(0.008, 0.008, 4.2 - lampY, 4), M.shoe); cable.position.y = lampY + (4.2 - lampY) / 2; scene.add(cable);
    const shade = mesh(new THREE.ConeGeometry(0.42, 0.3, 24, 1, true), M.shade); shade.position.y = lampY; scene.add(shade);
    const bulb = mesh(new THREE.SphereGeometry(0.07, 12, 8), M.bulb); bulb.position.y = lampY - 0.12; scene.add(bulb);
    const spot = new THREE.SpotLight(0xffc98a, 16, 0, 1.0, 0.6, 1.2);
    spot.position.set(0, lampY - 0.1, 0); spot.target.position.set(0, 0, 0);
    spot.castShadow = !lite; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0005;
    scene.add(spot, spot.target);
    const fill = new THREE.PointLight(0xffa860, 4, 9, 1.4); fill.position.set(0, 2.3, 0); scene.add(fill);
    scene.add(new THREE.HemisphereLight(0x6a5646, 0x0b0705, 1.1));
    const flash = new THREE.PointLight(0xffd27a, 0, 6, 1.5); scene.add(flash);
    const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex(), transparent: true, depthWrite: false, opacity: 0 })); flashSprite.scale.set(0.5, 0.5, 1); scene.add(flashSprite);

    const G = {
      card: new THREE.PlaneGeometry(0.16, 0.23),
      smallCard: new THREE.PlaneGeometry(0.075, 0.105),
      handCard: new THREE.PlaneGeometry(0.07, 0.1),
      body: new THREE.CylinderGeometry(0.2, 0.27, 0.56, lite ? 10 : 16),
      head: new THREE.SphereGeometry(0.27, lite ? 16 : 28, lite ? 12 : 20),
      face: new THREE.SphereGeometry(0.274, lite ? 16 : 28, lite ? 12 : 20, Math.PI / 2 - 0.82, 1.64, Math.PI / 2 - 0.86, 1.36),
      mouth: new THREE.SphereGeometry(1, 12, 8),
      arm: new THREE.CylinderGeometry(0.055, 0.05, 0.42, 8),
      hand: new THREE.SphereGeometry(0.065, 10, 8),
      thigh: new THREE.CylinderGeometry(0.08, 0.08, 0.4, 8),
      shin: new THREE.CylinderGeometry(0.07, 0.07, 0.45, 8),
      shoe: new THREE.BoxGeometry(0.12, 0.08, 0.22),
      seat: new THREE.BoxGeometry(0.56, 0.06, 0.5),
      back: new THREE.BoxGeometry(0.56, 0.62, 0.05),
      chairLeg: new THREE.BoxGeometry(0.05, 0.47, 0.05),
      arrow: new THREE.ConeGeometry(0.07, 0.16, 12),
      hit: new THREE.BoxGeometry(0.7, 1.9, 0.7),
      ghostBody: new THREE.ConeGeometry(0.3, 0.7, 16, 1, true),
      sweat: new THREE.SphereGeometry(0.022, 6, 5),
    };
    G.arm.translate(0, -0.21, 0); // o braco gira pelo ombro
    G.shin.translate(0, -0.225, 0);

    function makeGun() {
      const g = new THREE.Group();
      const barrel = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.2, 8), M.metal, true); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.035, 0.12); g.add(barrel);
      const drum = mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.06, 6), M.metal, true); drum.rotation.x = Math.PI / 2; drum.position.set(0, 0.025, 0); g.add(drum);
      const frame = mesh(new THREE.BoxGeometry(0.035, 0.05, 0.12), M.metal, true); frame.position.set(0, 0.035, -0.02); g.add(frame);
      const grip = mesh(new THREE.BoxGeometry(0.035, 0.11, 0.05), M.grip, true); grip.rotation.x = -0.35; grip.position.set(0, -0.04, -0.08); g.add(grip);
      const guard = mesh(new THREE.TorusGeometry(0.022, 0.005, 4, 10, Math.PI), M.metal); guard.rotation.set(0, Math.PI / 2, Math.PI); guard.position.set(0, -0.005, -0.02); g.add(guard);
      g.userData.drum = drum;
      return g;
    }

    const HAT = {
      cartola: () => { const g = new THREE.Group(); const m = std({ color: 0x151515 }); const b = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 20), m); const c = mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 20), m); c.position.y = 0.15; const band = mesh(new THREE.CylinderGeometry(0.183, 0.183, 0.05, 20), std({ color: 0x8b1a1a })); band.position.y = 0.04; g.add(b, c, band); g.position.y = 0.22; return g; },
      bone: (color) => { const g = new THREE.Group(); const m = std({ color }); const c = mesh(new THREE.SphereGeometry(0.28, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m); const v = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20, 1, false, -Math.PI / 2, Math.PI), m); v.position.set(0, 0, 0.2); g.add(c, v); g.position.y = 0.06; return g; },
      festa: () => { const g = new THREE.Group(); const c = mesh(new THREE.ConeGeometry(0.13, 0.36, 16), std({ color: 0xff4fa3 })); c.position.y = 0.18; const p = mesh(new THREE.SphereGeometry(0.04, 8, 6), std({ color: 0xffe14d })); p.position.y = 0.37; g.add(c, p); g.position.y = 0.2; g.rotation.z = 0.15; return g; },
      coroa: () => { const g = new THREE.Group(); const m = std({ color: 0xf1c232, metalness: 0.8, roughness: 0.3 }); const r = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 16, 1, true), m); r.material = m.clone(); r.material.side = THREE.DoubleSide; g.add(r); for (let i = 0; i < 6; i++) { const s = mesh(new THREE.ConeGeometry(0.035, 0.1, 6), m); const a = (i / 6) * Math.PI * 2; s.position.set(Math.sin(a) * 0.16, 0.08, Math.cos(a) * 0.16); g.add(s); } g.position.y = 0.24; return g; },
      cowboy: () => { const g = new THREE.Group(); const m = std({ color: 0x7a4e2a }); const b = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.02, 24), m); b.scale.z = 0.85; const c = mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.2, 16), m); c.position.y = 0.1; const band = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 16), std({ color: 0x2a1a0e })); band.position.y = 0.03; g.add(b, c, band); g.position.y = 0.2; g.rotation.x = -0.08; return g; },
    };

    // um boneco por lugar (6 lugares fixos)
    function makeDoll(seat) {
      const d = { seat, root: new THREE.Group(), rig: new THREE.Group(), person: null, nick: null, look: null, alive: true, fall: 0, fallTarget: 0, gunP: 0, gunTarget: 0, arms: { l: [-1, 0, 0.15], r: [-1, 0, -0.15] }, armT: null, bubble: null, bubbleUntil: 0, sweatUntil: 0, laughUntil: 0, shakeUntil: 0, target: new THREE.Vector3(), ready: false };
      scene.add(d.root);
      d.root.add(d.rig);
      // cadeira
      const chair = new THREE.Group(); d.chair = chair; d.rig.add(chair);
      const seatM = mesh(G.seat, M.wood, true); seatM.position.y = 0.48; chair.add(seatM);
      const back = mesh(G.back, M.wood, true); back.position.set(0, 0.8, -0.24); back.rotation.x = -0.08; chair.add(back);
      for (const [lx, lz] of [[-0.24, -0.21], [0.24, -0.21], [-0.24, 0.21], [0.24, 0.21]]) { const l = mesh(G.chairLeg, M.darkWood, true); l.position.set(lx, 0.235, lz); chair.add(l); }
      // corpo
      const person = new THREE.Group(); d.personG = person; d.rig.add(person);
      d.shirt = std({ color: 0x888888 });
      const body = mesh(G.body, d.shirt, true); body.position.y = 0.8; person.add(body); d.body = body;
      for (const side of [-1, 1]) {
        const th = mesh(G.thigh, M.pants, true); th.rotation.x = Math.PI / 2; th.position.set(side * 0.11, 0.56, 0.16); person.add(th);
        const sh = mesh(G.shin, M.pants, true); sh.position.set(side * 0.11, 0.56, 0.34); person.add(sh);
        const shoe = mesh(G.shoe, M.shoe, true); shoe.position.set(side * 0.11, 0.06, 0.38); person.add(shoe);
      }
      const head = new THREE.Group(); head.position.y = 1.36; person.add(head); d.head = head;
      head.add(mesh(G.head, M.skin, true));
      d.faceMat = new THREE.MeshStandardMaterial({ roughness: 0.75 });
      head.add(mesh(G.face, d.faceMat));
      d.mouth = mesh(G.mouth, M.mouth); d.mouth.scale.set(0.06, 0.02, 0.02); d.mouth.position.set(0, -0.19, 0.19); d.mouth.rotation.x = 0.6; head.add(d.mouth);
      d.hatSlot = new THREE.Group(); head.add(d.hatSlot);
      d.armG = {};
      for (const [k, side] of [["l", -1], ["r", 1]]) {
        const sh = new THREE.Group(); sh.position.set(side * 0.27, 1.02, 0); person.add(sh);
        const arm = mesh(G.arm, d.shirt, true); sh.add(arm);
        const hand = mesh(G.hand, M.skin, true); hand.position.y = -0.44; sh.add(hand);
        d.armG[k] = sh;
      }
      // cartas na mao do boneco (de costas para os outros)
      d.fan = new THREE.Group(); d.fan.position.set(0, 0.97, 0.42); d.fan.rotation.x = -0.5; person.add(d.fan);
      // revolver: deitado na mesa ou apontado para a cabeca
      d.gun = makeGun(); d.rig.add(d.gun);
      // seta de quem joga
      d.arrow = mesh(G.arrow, M.arrow); d.arrow.rotation.x = Math.PI; d.arrow.visible = false; d.root.add(d.arrow);
      // nome em cima da cabeca
      d.label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false })); d.label.scale.set(1.1, 0.275, 1); d.label.position.y = 2.06; d.root.add(d.label);
      d.bubbleS = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false })); d.bubbleS.scale.set(1.1, 0.34, 1); d.bubbleS.position.y = 2.42; d.bubbleS.visible = false; d.root.add(d.bubbleS);
      // fantasminha (quem levou o tiro)
      d.ghost = new THREE.Group(); d.ghost.visible = false; d.root.add(d.ghost);
      const gh = mesh(G.head, M.ghost); gh.scale.setScalar(0.9); d.ghost.add(gh);
      d.ghostFace = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.8, depthWrite: false, roughness: 0.8 });
      const gf = mesh(G.face, d.ghostFace); gf.scale.setScalar(0.9); d.ghost.add(gf);
      const gb = mesh(G.ghostBody, M.ghost); gb.position.y = -0.4; gb.rotation.x = Math.PI; d.ghost.add(gb);
      d.sweat = [];
      for (let i = 0; i < 4; i++) { const s = mesh(G.sweat, M.sweat); s.visible = false; head.add(s); d.sweat.push(s); }
      // caixa invisivel para clicar no boneco
      d.hit = mesh(G.hit, M.hit); d.hit.position.y = 0.95; d.hit.userData.seat = seat; d.root.add(d.hit);
      return d;
    }

    const dolls = [0, 1, 2, 3, 4, 5].map(makeDoll);
    const pile = [];       // cartas no meio da mesa
    const flying = [];     // cartas voando para o meio
    const handCards = [];  // as minhas cartas (presas na camera)
    const handG = new THREE.Group(); camera.add(handG);
    const confetti = [];

    R = { renderer, scene, camera, M, G, dolls, pile, flying, handCards, handG, token, tokenMat, flash, flashSprite, spot, mesh, HAT, confetti };
    const ro = new ResizeObserver(resize); ro.observe(stage); resize();
    bindPointer();
  }

  function resize() {
    if (!R) return;
    const st0 = $("blStage"), w = st0.clientWidth || 1, h = st0.clientHeight || 1;
    R.renderer.setSize(w, h, false);
    R.camera.aspect = w / h;
    // angulo de visao: garante uns 76 graus na horizontal (celular em pe tambem ve a mesa toda)
    R.camera.fov = clamp((2 * Math.atan(Math.tan((76 * Math.PI) / 360) / (w / h)) * 180) / Math.PI, 50, 84);
    R.camera.updateProjectionMatrix();
    layoutHand();
  }

  // ---------- posicoes ----------
  function order() {
    if (!st || ["empty", "lobby"].includes(st.stage)) return [0, 1, 2, 3, 4, 5];
    return st.seats.map((s, i) => (s && s.inGame ? i : -1)).filter((i) => i >= 0);
  }
  function seatAngle(i) {
    const ord = order(), n = ord.length || 1;
    const base = Math.max(0, ord.indexOf(st && st.me));
    const k = (ord.indexOf(i) - base + n) % n;
    return (k / n) * Math.PI * 2;
  }
  const dollPos = (i, r = SEAT_R) => { const a = seatAngle(i); return new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r); };

  // ---------- desenhar o estado ----------
  function sync3D() {
    if (!R || !st) return;
    const lobby = ["empty", "lobby"].includes(st.stage);
    const ord = order();
    R.dolls.forEach((d, i) => {
      const s = st.seats[i];
      const show = st.stage !== "empty" && (lobby || ord.includes(i));
      d.root.visible = show;
      if (!show) return;
      const p = dollPos(i);
      d.target.copy(p);
      if (!d.ready) { d.root.position.copy(p); d.ready = true; }
      const hasP = !!(s && s.nick);
      d.personG.visible = hasP && i !== st.me;
      d.chair.visible = i !== st.me || !seated();
      d.gun.visible = !lobby && hasP && i !== st.me;
      d.hit.userData.empty = !hasP;
      if (hasP) {
        if (d.nick !== s.nick || d.faceMat.map !== faceTex(s.nick, false)) { d.nick = s.nick; d.faceMat.map = faceTex(s.nick, false); d.faceMat.needsUpdate = true; d.ghostFace.map = faceTex(s.nick, true); d.ghostFace.needsUpdate = true; }
        const lk = s.look || {};
        if (!d.look || d.look.color !== lk.color || d.look.hat !== lk.hat) {
          d.look = { ...lk };
          d.shirt.color.set(lk.color || "#888888");
          d.hatSlot.clear();
          if (R.HAT[lk.hat]) d.hatSlot.add(R.HAT[lk.hat](lk.color));
        }
        const alive = !inGame() || s.alive;
        if (alive && !d.alive) { d.fall = d.fallTarget = 0; }
        if (!alive && d.alive && !d.dying) { d.fall = d.fallTarget = 1; } // ja estava morto (entrou depois)
        d.alive = alive;
        d.ghost.visible = !alive && d.fall >= 0.98 && i !== st.me;
        d.faceMat.map = faceTex(s.nick, !alive); d.faceMat.needsUpdate = true;
        // cartas na mao
        const n = inGame() && alive ? s.cards : 0;
        if (d.fan.children.length !== n) {
          d.fan.clear();
          for (let k = 0; k < n; k++) { const c = R.mesh(R.G.smallCard, R.M.back); c.position.set((k - (n - 1) / 2) * 0.045, Math.abs(k - (n - 1) / 2) * -0.008, k * 0.002); c.rotation.z = -(k - (n - 1) / 2) * 0.15; c.material = R.M.back; d.fan.add(c); }
        }
        const lines = [s.nick + (s.online || !inGame() ? "" : " (fora)")];
        if (inGame()) lines.push(!alive ? "fora do jogo" : "🔫 " + s.pulls + "/" + st.chambers + (s.cards ? "   🂠 " + s.cards : "   salvo"));
        else if (s.wins) lines.push("🏆 " + s.wins + (s.wins === 1 ? " vitória" : " vitórias"));
        const key = lines.join("|") + (st.toPlay === i);
        if (d.labelKey !== key) {
          d.labelKey = key;
          if (d.label.material.map) d.label.material.map.dispose();
          d.label.material.map = labelTex(lines, st.toPlay === i ? "#ffd84d" : null);
          d.label.material.needsUpdate = true;
        }
      } else { d.nick = null; d.look = null; d.labelKey = null; d.label.material.map = null; d.ghost.visible = false; d.fan.clear(); }
      d.label.visible = hasP && i !== st.me;
      const myTurnArrow = (st.stage === "playing" && st.toPlay === i) || (st.stage === "trigger" && st.shot && st.shot.seat === i);
      d.arrow.visible = myTurnArrow && i !== st.me;
      d.arrow.material = st.stage === "trigger" ? R.M.arrowRed : R.M.arrow;
      d.gunTarget = st.stage === "trigger" && st.shot && st.shot.seat === i ? 1 : st.stage === "shot" && st.shot && st.shot.seat === i && st.shot.result === "click" ? 1 : 0;
    });
    // naipe da mesa
    const tok = inGame() && st.suit ? st.suit : "?";
    if (R.tokenKey !== tok) { R.tokenKey = tok; R.tokenMat.map = suitToken(tok); R.tokenMat.needsUpdate = true; }
    R.token.visible = inGame();
    syncPile();
    syncHand();
    syncReveal();
  }

  // cartas no meio da mesa
  function pileSpot() {
    const a = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.4;
    return { x: Math.sin(a) * r, z: Math.cos(a) * r, rz: Math.random() * Math.PI * 2 };
  }
  function makeCard() {
    const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
    const front = R.mesh(R.G.card, new THREE.MeshStandardMaterial({ map: cardBack(), roughness: 0.6 }));
    const back = R.mesh(R.G.card, R.M.back); back.rotation.y = Math.PI;
    front.castShadow = back.castShadow = !lite;
    inner.add(front, back);
    g.userData = { inner, front };
    return g;
  }
  function placeOnPile(c, k) {
    const s = c.userData.spot || (c.userData.spot = pileSpot());
    c.position.set(s.x, TABLE_Y + 0.004 + k * 0.0015, s.z);
    c.rotation.set(-Math.PI / 2, 0, s.rz);
    c.userData.inner.rotation.set(0, Math.PI, 0); // de costas
  }
  function syncPile() {
    const target = inGame() && st.stage !== "gameOver" ? st.pile : 0;
    const have = R.pile.length + R.flying.length;
    if (target === 0 || have > target) {
      for (const c of [...R.pile, ...R.flying.map((f) => f.card)]) R.scene.remove(c);
      R.pile.length = 0; R.flying.length = 0; R.revealed = null;
    }
    while (R.pile.length + R.flying.length < target) { const c = makeCard(); placeOnPile(c, R.pile.length); R.scene.add(c); R.pile.push(c); }
  }
  function throwCards(seat, count) {
    if (!R) return;
    const from = dollPos(seat, SEAT_R - 0.6); from.y = TABLE_Y + 0.25;
    for (let k = 0; k < count; k++) {
      const c = makeCard(); c.position.copy(from); R.scene.add(c);
      R.flying.push({ card: c, from: from.clone(), t0: performance.now() + k * 120, dur: 520 });
    }
  }

  // as cartas de quem foi desafiado sobem e viram para todo mundo ver
  function syncReveal() {
    const rv = st.reveal;
    if (!rv) { if (R.revealed) { R.revealed = null; for (const [k, c] of R.pile.entries()) { c.scale.setScalar(1); placeOnPile(c, k); } } return; }
    const key = st.roundNo + ":" + st.pile;
    if (R.revealed && R.revealed.key === key) return;
    const cards = R.pile.slice(-rv.cards.length);
    R.revealed = { key, cards, t0: performance.now(), truth: rv.truth, codes: rv.cards };
    cards.forEach((c, k) => {
      c.userData.front.material.map = cardFace(rv.cards[k]); c.userData.front.material.needsUpdate = true;
      c.userData.from = c.position.clone(); c.userData.fromRot = c.rotation.clone();
    });
  }

  // minhas cartas: na frente da camera, clicaveis
  function syncHand() {
    const mine = seated() && inGame() && st.seats[st.me] && st.seats[st.me].alive ? st.hand : [];
    const key = mine.join("");
    if (R.handKey !== key) {
      R.handKey = key;
      R.handG.clear(); R.handCards.length = 0;
      for (const s of [...selected]) if (s >= mine.length) selected.delete(s);
      mine.forEach((code, k) => {
        const c = R.mesh(R.G.handCard, new THREE.MeshBasicMaterial({ map: cardFace(code), transparent: true }));
        c.userData = { k, code, lift: 0 };
        R.handG.add(c); R.handCards.push(c);
      });
      layoutHand();
    }
  }
  function layoutHand() {
    if (!R) return;
    const n = R.handCards.length;
    const halfW = Math.tan((R.camera.fov * Math.PI) / 360) * 0.42 * R.camera.aspect;
    const scale = Math.min(1.25, Math.max(0.7, halfW / 0.32));
    const gap = Math.min(0.085 * scale, (halfW * 1.7) / Math.max(n, 1));
    const halfH = Math.tan((R.camera.fov * Math.PI) / 360) * 0.42;
    R.handCards.forEach((c, k) => {
      c.scale.setScalar(scale);
      c.userData.base = new THREE.Vector3((k - (n - 1) / 2) * gap, -halfH + 0.07 * scale, -0.42);
      c.rotation.z = -(k - (n - 1) / 2) * 0.06;
    });
  }

  // ---------- camera e cliques ----------
  const view = { yaw: 0, pitch: 0, orbit: 0, drag: null, shake: 0 };
  let hover = null;
  function bindPointer() {
    const cv = R.renderer.domElement;
    const ray = new THREE.Raycaster(), v2 = new THREE.Vector2();
    const pickAt = (e) => {
      const r = cv.getBoundingClientRect();
      v2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v2, R.camera);
      const hc = ray.intersectObjects(R.handCards, false)[0];
      if (hc) return { card: hc.object };
      const hits = ray.intersectObjects(R.dolls.filter((d) => d.root.visible).map((d) => d.hit), false);
      if (hits[0]) return { seat: hits[0].object.userData.seat, empty: hits[0].object.userData.empty };
      return null;
    };
    cv.addEventListener("pointerdown", (e) => { view.drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }; });
    cv.addEventListener("pointermove", (e) => {
      if (view.drag && view.drag.id === e.pointerId && (e.buttons || e.pointerType === "touch")) {
        const dx = e.clientX - view.drag.x, dy = e.clientY - view.drag.y;
        view.drag.moved += Math.abs(dx) + Math.abs(dy);
        view.drag.x = e.clientX; view.drag.y = e.clientY;
        if (view.drag.moved > 6) {
          if (seated() && !myDead()) { view.yaw = clamp(view.yaw - dx * 0.004, -1.3, 1.3); view.pitch = clamp(view.pitch - dy * 0.003, -0.55, 0.45); }
          else { view.orbit -= dx * 0.006; view.pitch = clamp(view.pitch - dy * 0.003, -0.3, 0.4); }
        }
        return;
      }
      const p = pickAt(e);
      hover = p && p.card ? p.card : null;
      cv.style.cursor = p && (p.card || (p.empty && !seated() && st.stage === "lobby") || (!p.empty && seated() && p.seat !== st.me)) ? "pointer" : "grab";
    });
    const up = (e) => {
      const d = view.drag; view.drag = null;
      if (!d || d.moved > 6) return;
      const p = pickAt(e);
      if (!p) return;
      if (p.card) return toggleCard(p.card.userData.k);
      if (p.empty && !seated() && st.stage === "lobby") return socket.emit("blefe:sit", { seat: p.seat, look }, done);
      if (!p.empty && seated() && p.seat !== st.me) socket.emit("blefe:emote", { type: "apontar", to: p.seat });
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", () => { view.drag = null; });
    cv.addEventListener("pointerleave", () => { hover = null; });
    cv.addEventListener("dblclick", () => { view.yaw = 0; view.pitch = 0; });
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const myDead = () => seated() && inGame() && st.seats[st.me] && !st.seats[st.me].alive;

  function toggleCard(k) {
    if (!inGame() || st.stage !== "playing" || st.mustDoubt) return;
    if (selected.has(k)) selected.delete(k);
    else if (selected.size < st.maxPlay) selected.add(k);
    else { setNote("No máximo " + st.maxPlay + " cartas por vez."); return; }
    SFX.pop();
    renderActions();
  }

  // ---------- animacao (uma vez por quadro) ----------
  let lastT = performance.now();
  function frame() {
    const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000), t = now / 1000;
    lastT = now;
    const { camera, dolls } = R;
    // camera
    if (seated() && st.stage !== "empty" && !myDead()) {
      const p = dollPos(st.me, SEAT_R + 0.1);
      const a = seatAngle(st.me);
      camera.position.set(p.x, 1.62, p.z);
      camera.rotation.y = a + view.yaw;
      camera.rotation.x = -0.42 + view.pitch;
    } else {
      if (!view.drag) view.orbit += dt * 0.05;
      const a = view.orbit + (seated() ? seatAngle(st.me) : 0);
      camera.position.set(Math.sin(a) * 3.4, 2.6, Math.cos(a) * 3.4);
      camera.rotation.y = a;
      camera.rotation.x = -0.46 + view.pitch;
    }
    if (view.shake > 0) { view.shake -= dt; camera.position.x += (Math.random() - 0.5) * 0.06; camera.position.y += (Math.random() - 0.5) * 0.06; }
    R.handG.visible = seated() && !myDead();

    // bonecos
    const speaking = app.speakingNicks || new Set();
    dolls.forEach((d) => {
      if (!d.root.visible) return;
      d.root.position.lerp(d.target, Math.min(1, dt * 4));
      d.root.lookAt(0, 0, 0);
      // queda (tiro): vai para tras com cadeira e tudo
      if (d.fall < d.fallTarget) { d.fall = Math.min(d.fallTarget, d.fall + dt * 2.2); if (d.fall >= 1) { d.dying = false; sync3D(); } }
      d.rig.rotation.x = -easeOut(d.fall) * 1.38;
      d.rig.position.y = 0;
      const alive = d.fall === 0;
      // respirar, rir, tremer
      const breath = Math.sin(t * 2 + d.seat) * 0.012;
      d.body.scale.set(1 + breath, 1 - breath, 1 + breath);
      d.head.position.y = 1.36 + breath * 0.5 + (now < d.laughUntil ? Math.abs(Math.sin(t * 22)) * 0.04 : 0);
      d.head.rotation.z = now < d.laughUntil ? Math.sin(t * 11) * 0.12 : 0;
      const focus = st.stage === "trigger" && st.shot ? st.shot.seat : st.toPlay;
      let yaw = 0;
      if (alive && focus >= 0 && focus !== d.seat) {
        const fp = focus === st.me && seated() ? camera.position : dolls[focus].root.position;
        const lp = d.root.worldToLocal(fp.clone());
        yaw = clamp(Math.atan2(lp.x, lp.z), -1.1, 1.1);
      }
      d.head.rotation.y += (yaw - d.head.rotation.y) * Math.min(1, dt * 4);
      d.personG.position.x = now < d.shakeUntil ? Math.sin(t * 60) * 0.012 : 0;
      // boca mexe quando a pessoa fala na call
      const talk = alive && d.nick && speaking.has(d.nick);
      d.mouth.scale.y += ((talk ? 0.02 + Math.abs(Math.sin(t * 17)) * 0.045 : 0.018) - d.mouth.scale.y) * Math.min(1, dt * 18);
      // suor
      d.sweat.forEach((s, k) => {
        s.visible = now < d.sweatUntil;
        if (!s.visible) return;
        const ph = (t * 0.9 + k * 0.25) % 1;
        s.position.set((k % 2 ? 1 : -1) * (0.2 + k * 0.02), 0.12 - ph * 0.3, 0.12);
      });
      // bracos
      const tgt = d.armT && now < d.armT.until ? d.armT.pose : poseFor(d);
      for (const k of ["l", "r"]) {
        const a = d.armG[k].rotation, p = tgt[k];
        a.x += (p[0] - a.x) * Math.min(1, dt * 9); a.y += (p[1] - a.y) * Math.min(1, dt * 9); a.z += (p[2] - a.z) * Math.min(1, dt * 9);
      }
      d.fan.visible = alive && !(d.armT && now < d.armT.until && d.armT.hideFan);
      // revolver
      d.gunP += (d.gunTarget - d.gunP) * Math.min(1, dt * 5);
      const g = d.gun, q = easeInOut(d.gunP);
      g.position.set(lerp(0.3, 0.42, q), lerp(TABLE_Y + 0.025, 1.38, q), lerp(SEAT_R - 1.15 - 0.1, 0.02, q));
      g.rotation.set(lerp(0, 0, q), lerp(2.6, -Math.PI / 2, q), lerp(Math.PI / 2, 0, q));
      // seta
      d.arrow.position.y = 2.32 + Math.sin(t * 5) * 0.05;
      d.arrow.rotation.y = t * 2;
      // fantasma
      if (d.ghost.visible) { d.ghost.position.set(0, 1.75 + Math.sin(t * 2 + d.seat) * 0.1, -0.3); d.ghost.rotation.y = Math.sin(t + d.seat) * 0.3; }
      // balao
      d.bubbleS.visible = now < d.bubbleUntil;
    });

    // cartas voando para o meio
    for (let k = R.flying.length - 1; k >= 0; k--) {
      const f = R.flying[k];
      const p = clamp((now - f.t0) / f.dur, 0, 1);
      if (p <= 0) continue;
      const s = f.card.userData.spot || (f.card.userData.spot = pileSpot());
      const e = easeOut(p);
      f.card.position.set(lerp(f.from.x, s.x, e), lerp(f.from.y, TABLE_Y + 0.004 + R.pile.length * 0.0015, e) + Math.sin(p * Math.PI) * 0.25, lerp(f.from.z, s.z, e));
      f.card.rotation.set(-Math.PI / 2 * e, 0, s.rz * e + (1 - e) * 4);
      f.card.userData.inner.rotation.y = Math.PI;
      if (p >= 1) { R.flying.splice(k, 1); placeOnPile(f.card, R.pile.length); R.pile.push(f.card); }
    }

    // cartas reveladas: sobem, viram para a camera e mostram a verdade
    if (R.revealed) {
      const rv = R.revealed, p = clamp((now - rv.t0) / 700, 0, 1), flipP = clamp((now - rv.t0 - 650) / 450, 0, 1);
      const n = rv.cards.length;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(R.camera.quaternion); right.y = 0; right.normalize();
      const toward = new THREE.Vector3(R.camera.position.x, 0, R.camera.position.z).normalize().multiplyScalar(0.5);
      rv.cards.forEach((c, k) => {
        const dest = right.clone().multiplyScalar((k - (n - 1) / 2) * 0.32).add(toward); dest.y = TABLE_Y + 0.5;
        c.scale.setScalar(1 + easeOut(p) * 0.7);
        c.position.lerpVectors(c.userData.from, dest, easeOut(p));
        const look = new THREE.Vector3(R.camera.position.x, dest.y, R.camera.position.z);
        if (p >= 1) c.lookAt(look);
        else { c.rotation.set(lerp(c.userData.fromRot.x, 0, p), c.rotation.y, lerp(c.userData.fromRot.z, 0, p)); }
        c.userData.inner.rotation.y = Math.PI * (1 - easeInOut(flipP));
        const bad = flipP >= 1 && !(rv.codes[k] === st.suit || rv.codes[k] === "J");
        c.userData.front.material.color.set(bad ? 0xff9a9a : 0xffffff);
      });
      if (flipP >= 1 && !rv.flipped) { rv.flipped = true; SFX.flip(); }
    }

    // minhas cartas: sobem quando passa o mouse e mais ainda quando escolhidas
    R.handCards.forEach((c) => {
      const sel = selected.has(c.userData.k), want = sel ? 0.04 : hover === c ? 0.018 : 0;
      c.userData.lift += (want - c.userData.lift) * Math.min(1, dt * 14);
      if (c.userData.base) c.position.set(c.userData.base.x, c.userData.base.y + c.userData.lift, c.userData.base.z + (sel ? 0.01 : 0));
      c.material.color.set(sel ? 0xfff2a8 : 0xffffff);
    });

    // ficha gira, clarão do tiro some
    R.token.rotation.y = t * 0.6;
    R.flash.intensity = Math.max(0, R.flash.intensity - dt * 60);
    R.flashSprite.material.opacity = Math.max(0, R.flashSprite.material.opacity - dt * 6);
    // confete de quem ganhou
    for (let k = R.confetti.length - 1; k >= 0; k--) {
      const c = R.confetti[k];
      c.userData.v.y -= dt * 2.5;
      c.position.addScaledVector(c.userData.v, dt);
      c.rotation.x += dt * 6; c.rotation.y += dt * 4;
      if (c.position.y < 0) { R.scene.remove(c); R.confetti.splice(k, 1); }
    }
    R.renderer.render(R.scene, R.camera);
  }
  const lerp = (a, b, p) => a + (b - a) * p;
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

  // pose dos bracos: segurando as cartas, ou com o revolver na cabeca
  function poseFor(d) {
    if (d.fall > 0) return { l: [-2.6, 0, 0.3], r: [-2.6, 0, -0.3] };
    if (d.gunTarget > 0.5) return { l: [-0.9, 0, 0.12], r: [-2.75, 0, 0.55] };
    return { l: [-1.05, 0, 0.18], r: [-1.05, 0, -0.18] };
  }

  function emote(seat, type, to) {
    const d = R && R.dolls[seat];
    const now = performance.now();
    if (type === "rir") { bubble(seat, "KKKKKKK"); if (d) d.laughUntil = now + 1600; }
    else if (type === "ombros") { bubble(seat, "¯\\_(ツ)_/¯"); if (d) d.armT = { until: now + 1400, pose: { l: [-0.4, 0, 0.9], r: [-0.4, 0, -0.9] } }; }
    else if (type === "suar") { bubble(seat, "😰"); if (d) { d.sweatUntil = now + 2600; d.shakeUntil = now + 900; } }
    else if (type === "joinha") { bubble(seat, "👍"); if (d) d.armT = { until: now + 1400, pose: { l: [-1.05, 0, 0.18], r: [-2.9, 0, -0.2] } }; }
    else if (type === "bater") {
      SFX.thud(); bubble(seat, "!!!");
      if (d) { d.armT = { until: now + 260, pose: { l: [-2.2, 0, 0.1], r: [-2.2, 0, -0.1] }, hideFan: true }; setTimeout(() => { d.armT = { until: performance.now() + 500, pose: { l: [-1.25, 0, 0.1], r: [-1.25, 0, -0.1] }, hideFan: true }; R.pile.forEach((c) => { c.position.y += 0.03; }); setTimeout(() => R.pile.forEach((c, k) => placeOnPile(c, k)), 120); }, 250); }
    } else if (type === "apontar") {
      const tn = to >= 0 ? nameOf(to) : null;
      bubble(seat, tn ? "Olha o " + tn + "!" : "👉");
      if (d) {
        let yaw = 0;
        if (to >= 0 && R.dolls[to].root.visible) {
          const from = d.root.position, tp = R.dolls[to].root.position;
          const local = d.root.worldToLocal(tp.clone()); yaw = Math.atan2(local.x, local.z);
          void from;
        }
        d.armT = { until: now + 1800, pose: { l: [-1.05, 0, 0.18], r: [-1.55, yaw, 0] } };
      }
    }
  }

  function bubble(seat, text) {
    if (!R) return;
    const d = R.dolls[seat]; if (!d) return;
    if (d.bubbleS.material.map) d.bubbleS.material.map.dispose();
    d.bubbleS.material.map = bubbleTex(text); d.bubbleS.material.needsUpdate = true;
    d.bubbleUntil = performance.now() + 2600;
    if (seat === st.me && seated()) { const b = el("div", "bl-mybubble", text); $("blStage").append(b); setTimeout(() => b.remove(), 2600); }
  }

  function bang(seat) {
    if (!R) return;
    const d = R.dolls[seat];
    const gp = new THREE.Vector3(); d.gun.getWorldPosition(gp);
    R.flash.position.copy(gp); R.flash.intensity = 40;
    R.flashSprite.position.copy(gp); R.flashSprite.material.opacity = 1;
    view.shake = 0.45;
    d.dying = true; d.gunTarget = 0;
    setTimeout(() => { d.fallTarget = 1; }, 120);
  }

  function confettiAt(seat) {
    if (!R) return;
    const p = seat >= 0 ? R.dolls[seat].root.position : new THREE.Vector3();
    const geo = new THREE.PlaneGeometry(0.04, 0.025);
    const cols = [0xffd84d, 0xff4fa3, 0x4fc3ff, 0x6bff8a, 0xffffff];
    for (let i = 0; i < (lite ? 60 : 140); i++) {
      const c = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide }));
      c.position.set(p.x, 2.2, p.z);
      c.userData.v = new THREE.Vector3((Math.random() - 0.5) * 2.4, 1 + Math.random() * 2.2, (Math.random() - 0.5) * 2.4);
      R.scene.add(c); R.confetti.push(c);
    }
  }

  // ---------- loop: so desenha com a mesa aberta e a aba visivel ----------
  function loop(on) {
    if (!R) return;
    R.renderer.setAnimationLoop(on ? frame : null);
  }
  document.addEventListener("visibilitychange", () => loop(open() && !document.hidden));

  // ---------- interface (botoes e textos por cima do 3D) ----------
  function render() {
    if (!st) return;
    $("blInfo").textContent = st.stage === "empty" ? "" : (st.hostNick ? "mesa de " + st.hostNick : "") + (inGame() ? "  ·  rodada " + st.roundNo : "");
    renderHud();
    renderActions();
    renderEmotes();
    renderBar();
    renderDomHand();
    const log = $("blLog");
    log.replaceChildren(...st.log.map((l) => el("div", "", l)));
    log.scrollTop = log.scrollHeight;
    sync3D();
  }

  function renderHud() {
    const hud = $("blHud"); hud.replaceChildren();
    const msg = $("blMsg"); msg.replaceChildren(); msg.hidden = true;
    const say = (t, sub) => { msg.hidden = false; msg.append(el("b", "", t)); if (sub) msg.append(el("span", "", sub)); };
    if (failed) say("Seu aparelho não conseguiu abrir o 3D.", "Dá para jogar mesmo assim com os botões aqui embaixo.");
    else if (!R) say("Arrumando a mesa…");
    if (st.stage === "empty") { if (R || failed) say("Ninguém abriu a Mesa do Blefe ainda.", app.nick ? "Clique em \"Abrir mesa\" aqui embaixo." : "Escolha um apelido para jogar."); return; }
    if (st.stage === "lobby") {
      const n = st.seats.filter(Boolean).length;
      hud.append(el("div", "bl-chip", n + " de 6 sentados"));
      if (!seated()) say("Clique numa cadeira vazia para sentar", "ou use os botões aqui embaixo");
      else if (n < 2) say("Esperando mais gente sentar…", "chame a galera: de 2 a 6 jogadores");
      return;
    }
    if (st.suit) {
      const s = el("div", "bl-suit" + (RED[st.suit] ? " red" : ""));
      s.append(el("i", "", SUIT[st.suit]), el("span", "", "Mesa de " + SUIT_NAME[st.suit]));
      hud.append(s);
    }
    hud.append(el("div", "bl-chip", "Na mesa: " + st.pile + (st.pile === 1 ? " carta" : " cartas")));
    if (st.last) hud.append(el("div", "bl-chip", nameOf(st.last.seat) + " jogou " + st.last.count + " dizendo " + SUIT[st.suit]));
    if (st.stage === "gameOver") say(st.winner !== null ? (st.winner === st.me ? "VOCÊ VENCEU!" : nameOf(st.winner) + " venceu!") : "Fim de jogo", "o último vivo na mesa ganha");
    if (myDead() && st.stage !== "gameOver") hud.append(el("div", "bl-chip dead", "Você virou fantasma: assista até o fim"));
  }

  function bigBtn(text, cls, fn, title) { const b = el("button", "big " + (cls || ""), text); b.type = "button"; if (title) b.title = title; b.addEventListener("click", fn); return b; }

  function renderActions() {
    const box = $("blActions"); box.replaceChildren();
    if (!st || !inGame()) return;
    const clock = () => { const c = el("span", "tr-clock"); c.id = "blClock"; box.append(c); };
    if (st.stage === "playing") {
      clock();
      if (st.toPlay === st.me) {
        if (st.mustDoubt) {
          box.append(el("span", "msg", "Só você ainda tem cartas: tem que duvidar!"));
        } else {
          const n = selected.size;
          box.append(el("span", "msg", n ? "" : "SUA VEZ: escolha de 1 a " + st.maxPlay + " cartas"));
          const b = bigBtn(n ? "Jogar " + n + (n === 1 ? " carta" : " cartas") + " como " + SUIT[st.suit] : "Jogar", "", () => {
            socket.emit("blefe:play", [...selected], done); selected.clear();
          }, "As cartas vão viradas: você diz que são todas de " + SUIT_NAME[st.suit]);
          b.disabled = !n;
          box.append(b);
        }
        if (st.canDoubt) box.append(bigBtn("DUVIDO!", "truco", () => socket.emit("blefe:doubt", done), "Acha que " + nameOf(st.last.seat) + " mentiu? Se errar, quem atira é você."));
      } else box.append(el("span", "msg", "vez de " + nameOf(st.toPlay)));
    } else if (st.stage === "reveal" && st.reveal) {
      box.append(el("span", "msg", nameOf(st.reveal.by) + " duvidou de " + nameOf(st.reveal.seat) + "… virando as cartas"));
    } else if (st.stage === "trigger" && st.shot) {
      clock();
      const s = st.seats[st.shot.seat];
      if (st.shot.seat === st.me) {
        box.append(el("span", "msg", "Você já puxou " + s.pulls + " de " + st.chambers + " vezes."));
        box.append(bigBtn("PUXAR O GATILHO", "no", () => socket.emit("blefe:pull", done)));
      } else box.append(el("span", "msg", nameOf(st.shot.seat) + " está com o revólver na cabeça… (" + s.pulls + " de " + st.chambers + ")"));
    } else if (st.stage === "shot" && st.shot) {
      box.append(el("span", "msg", st.shot.result === "bang" ? "BANG! " + nameOf(st.shot.seat) + " está fora." : "Clique… " + nameOf(st.shot.seat) + " escapou!"));
    } else if (st.stage === "roundEnd") box.append(el("span", "msg", "Embaralhando para a próxima rodada…"));
  }

  function renderEmotes() {
    const box = $("blEmotes"); box.replaceChildren();
    if (!seated() || st.stage === "empty") return;
    for (const [type, icon, title] of EMOTES) {
      const b = el("button", "ib bl-emo", icon); b.type = "button"; b.title = title; b.setAttribute("aria-label", title);
      b.addEventListener("click", () => socket.emit("blefe:emote", { type, to: type === "apontar" && st.last ? st.last.seat : -1 }));
      box.append(b);
    }
  }

  function renderBar() {
    const bar = $("blBar"); bar.replaceChildren();
    const cmd = (text, fn, cls) => { const b = el("button", "cmd" + (cls ? " " + cls : ""), text); b.type = "button"; b.addEventListener("click", fn); return b; };
    if (st.stage === "empty") { if (app.nick) bar.append(cmd("Abrir mesa", () => socket.emit("blefe:create", look, done), "on")); }
    else {
      if (st.stage === "lobby" && !seated()) {
        const free = st.seats.findIndex((s) => !s);
        if (free >= 0 && app.nick) bar.append(cmd("Sentar", () => socket.emit("blefe:sit", { seat: free, look }, done), "on"));
      }
      if (!seated() && inGame()) {
        const vacant = st.seats.findIndex((s) => s && s.inGame && s.alive && !s.online);
        if (vacant >= 0 && app.nick) bar.append(cmd("Assumir lugar vazio", () => socket.emit("blefe:sit", { seat: vacant, look }, done), "on"));
      }
      if (st.isHost && (st.stage === "lobby" || st.stage === "gameOver")) {
        const n = st.seats.filter((s) => s && s.online).length;
        bar.append(cmd(st.stage === "gameOver" ? "Nova partida" : n >= 2 ? "Começar (" + n + " jogadores)" : "Começar (falta gente)", () => socket.emit("blefe:start", done), n >= 2 ? "on" : ""));
      }
      if (seated()) bar.append(cmd("Levantar", () => socket.emit("blefe:stand", done)));
      if (st.isHost || st.isAdmin) bar.append(cmd("Fechar mesa", () => socket.emit("blefe:close", done)));
    }
    bar.append(cmd("Meu boneco", openLook));
    bar.append(el("span", "spacer"));
    const log = $("blLog");
    bar.append(cmd(log.hidden ? "Histórico" : "Esconder histórico", () => { log.hidden = !log.hidden; renderBar(); log.scrollTop = log.scrollHeight; }));
  }

  // sem 3D (aparelho sem WebGL): as cartas viram botoes
  function renderDomHand() {
    const box = $("blHandDom"); box.replaceChildren();
    box.hidden = !failed;
    if (!failed || !seated() || !inGame()) return;
    st.hand.forEach((code, k) => {
      const b = el("button", "tcard" + (RED[code] ? " red" : "") + (selected.has(k) ? " sel" : ""), SUIT[code]); b.type = "button";
      b.addEventListener("click", () => { toggleCard(k); renderDomHand(); });
      box.append(b);
    });
  }

  // personalizar o boneco: cor da roupa e chapeu
  function openLook() {
    const box = $("blLook");
    if (!box.hidden) { box.hidden = true; return; }
    box.replaceChildren();
    box.append(el("b", "", "Meu boneco"), el("small", "", "O rosto é a sua foto de perfil."));
    const cols = el("div", "bl-cols");
    for (const c of COLORS) {
      const b = el("button", "bl-col" + (look.color === c ? " on" : "")); b.type = "button"; b.style.background = c; b.setAttribute("aria-label", "Cor " + c);
      b.addEventListener("click", () => { look.color = c; saveLook(); openLook(); openLook(); });
      cols.append(b);
    }
    const hats = el("div", "bl-hats");
    for (const [h, name] of HATS) {
      const b = el("button", "cmd" + (look.hat === h ? " on" : ""), name); b.type = "button";
      b.addEventListener("click", () => { look.hat = h; saveLook(); openLook(); openLook(); });
      hats.append(b);
    }
    const close = el("button", "cmd", "Pronto"); close.type = "button"; close.addEventListener("click", () => { box.hidden = true; });
    box.append(el("span", "lbl", "Cor da roupa"), cols, el("span", "lbl", "Chapéu"), hats, close);
    box.hidden = false;
  }
  function saveLook() { store.set("chatpedro-blefe-look", JSON.stringify(look)); if (seated()) socket.emit("blefe:look", look, done); }

  // relogio
  setInterval(() => {
    const bar = $("blTimebar");
    const acting = st && (st.stage === "playing" || st.stage === "trigger");
    if (!st || !open() || !acting) { bar.hidden = true; return; }
    const left = Math.max(0, st.turnEndsAt - (Date.now() + clockSkew));
    const secs = Math.ceil(left / 1000), low = secs <= 5;
    bar.hidden = false;
    bar.firstChild.style.width = Math.min(100, (left / st.turnMs) * 100) + "%";
    bar.firstChild.classList.toggle("low", low);
    const c = $("blClock"); if (c) { c.textContent = secs + "s"; c.classList.toggle("low", low); }
    const mine = (st.stage === "playing" && st.toPlay === st.me) || (st.stage === "trigger" && st.shot && st.shot.seat === st.me);
    if (mine && low && secs > 0 && secs !== lastTick) { lastTick = secs; tone([[1200, 0.05]]); }
  }, 200);

  function shout(text, cls, sub) {
    const s = el("div", "bl-shout " + (cls || ""), text);
    if (sub) s.append(el("small", "", sub));
    $("blStage").querySelector(".bl-shout")?.remove();
    $("blStage").append(s);
    setTimeout(() => s.remove(), 1800);
  }

  // ---------- eventos do servidor ----------
  socket.on("blefe:event", (e) => {
    if (!st) return;
    const vis = open();
    if (e.type === "play") { SFX.card(); if (vis) throwCards(e.seat, e.count); return; }
    if (e.type === "round") { SFX.pop(); if (vis) shout("Mesa de " + SUIT_NAME[e.suit], RED[e.suit] ? "red" : "", SUIT[e.suit]); return; }
    if (e.type === "safe") { if (vis) bubble(e.seat, "Tô salvo!"); return; }
    if (e.type === "doubt") { SFX.doubt(); if (vis) { bubble(e.seat, "DUVIDO!"); shout("DUVIDO!", "", nameOf(e.seat) + " não acreditou em " + nameOf(e.target)); } return; }
    if (e.type === "aim") {
      stopBeat(); SFX.beat(); beatTimer = setInterval(SFX.beat, 800);
      if (vis && R) { R.dolls[e.seat].sweatUntil = performance.now() + 9000; R.dolls[e.seat].shakeUntil = performance.now() + 9000; }
      if (!vis && e.seat === st.me) setNote("Mesa do Blefe: puxe o gatilho!", true);
      return;
    }
    if (e.type === "click") {
      stopBeat(); SFX.click();
      if (vis) { if (R) { R.dolls[e.seat].sweatUntil = 0; R.dolls[e.seat].shakeUntil = 0; } bubble(e.seat, "Ufa…"); shout("CLIQUE", "ok", nameOf(e.seat) + " escapou"); }
      return;
    }
    if (e.type === "bang") { stopBeat(); SFX.bang(); if (vis) { bang(e.seat); shout("BANG!", "run", nameOf(e.seat) + " está fora"); } return; }
    if (e.type === "win") { SFX.win(); if (vis) { confettiAt(e.seat); shout(e.seat === st.me ? "VOCÊ VENCEU!" : e.seat !== null ? nameOf(e.seat) + " VENCEU!" : "FIM!", "ok"); } return; }
    if (e.type === "emote") { if (vis) emote(e.seat, e.emote, e.to); return; }
    if (e.type === "start") { if (R) R.dolls.forEach((d) => { d.fall = d.fallTarget = 0; d.dying = false; }); return; }
  });

  socket.on("blefe:state", (s) => {
    const wasMine = st && st.stage === "playing" && st.toPlay === st.me;
    if (st && (st.roundNo !== s.roundNo || s.stage !== "playing")) selected.clear();
    st = s;
    clockSkew = s.serverNow - Date.now();
    if (s.turnEndsAt !== lastEnds) { lastEnds = s.turnEndsAt; lastTick = -1; }
    if (s.stage !== "trigger") stopBeat();
    const mine = s.stage === "playing" && s.toPlay === s.me && s.me >= 0;
    if (mine && !wasMine) { SFX.turn(); if (!open()) setNote("Mesa do Blefe: sua vez!"); }
    sidebar();
    if (open()) render();
  });

  function sidebar() {
    const n = st.seats.filter((x) => x && x.nick).length;
    $("blTags").textContent = st.stage === "empty" ? "sem mesa" : st.stage === "lobby" ? n + "/6 na mesa" : n + " jogando";
    $("blOpen").classList.toggle("on", st.stage !== "empty");
    app.blefeNicks = new Set(st.seats.filter((x) => x && x.nick && x.online).map((x) => x.nick.toLowerCase()));
    if (app.renderPeople) app.renderPeople();
  }

  async function show() {
    $("blefe").hidden = false;
    $("activity").hidden = true; $("truco").hidden = true; // um jogo aberto por vez
    document.body.classList.remove("drawer");
    if (st) render();
    await ensure3D();
    if (!open()) return;
    resize();
    if (st) render();
    loop(!document.hidden);
  }
  function hide() { $("blefe").hidden = true; $("blLook").hidden = true; loop(false); stopBeat(); }
  $("blOpen").addEventListener("click", show);
  $("blClose").addEventListener("click", hide);
  // outro jogo abriu por cima: para de desenhar
  new MutationObserver(() => { if ($("blefe").hidden) loop(false); }).observe($("blefe"), { attributes: true, attributeFilter: ["hidden"] });
  const soundIcon = () => setIcon($("blSound"), sound ? "volume" : "volume-off", sound ? "Desligar os sons" : "Ligar os sons");
  soundIcon();
  $("blSound").addEventListener("click", () => { sound = !sound; store.set("chatpedro-blefesom", sound ? "on" : "off"); soundIcon(); if (sound) SFX.pop(); });
  const liteBtn = () => { $("blLite").classList.toggle("on", lite); $("blLite").title = lite ? "Modo leve ligado (clique para desligar)" : "Modo leve: menos efeitos, para aparelho fraco"; };
  liteBtn();
  $("blLite").addEventListener("click", () => {
    lite = !lite; store.set("chatpedro-blefe-leve", lite ? "on" : "off"); liteBtn();
    setNote(lite ? "Modo leve ligado. Recarregando a mesa…" : "Modo leve desligado. Recarregando a mesa…");
    // o 3D e montado de novo com a qualidade nova
    if (R) { loop(false); R.renderer.dispose(); R.renderer.domElement.remove(); R = null; loading = null; texCache.clear(); faceCache.clear(); if (open()) show(); }
  });
  app.blefe = { get state() { return st; }, get ready() { return !!R; }, get failed() { return failed; }, pick: toggleCard };
})();

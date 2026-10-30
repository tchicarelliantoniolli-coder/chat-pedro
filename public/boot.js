// Entrada no site: login (e-mail e senha), lista de servidores, convites e menu do servidor.
// So depois de tudo certo a conexao em tempo real liga, ja dentro de um servidor.
(() => {
  const $ = (id) => document.getElementById(id);
  const app = window.ChatPedro;
  const { socket, store } = app;
  let sb = null, session = null, me = null, profile = null, servers = [], current = null, mode = "login";

  const gmsg = (t) => { $("gMsg").textContent = t || ""; };
  const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  const currentServer = () => servers.find((x) => x.id === current);
  // foto do servidor, ou as iniciais numa cor fixa
  function paintIcon(el, srv) {
    el.replaceChildren();
    if (srv.icon) { const img = document.createElement("img"); img.alt = ""; img.src = srv.icon; el.append(img); el.style.background = ""; }
    else { el.textContent = initials(srv.name); el.style.background = "hsl(" + hue(srv.id) + " 65% 55%)"; }
  }

  async function api(path, { method = "GET", body } = {}) {
    if (sb) { const { data } = await sb.auth.getSession(); session = data.session; }
    const r = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", ...(session ? { Authorization: "Bearer " + session.access_token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || "Deu erro. Tente de novo."); e.status = r.status; throw e; }
    return j;
  }

  window.ChatPedroAuth = {
    api,
    paintIcon,
    goServer: (id) => goServer(id),
    get me() { return me; },
    get profile() { return profile; },
    get current() { return current; },
    refreshServers: () => refreshServers(),
    handshake: () => ({ token: session && session.access_token, server: current }),
    onMe(m) {
      const srv = currentServer();
      if (srv && !srv.dm) { srv.name = m.server.name; srv.icon = m.server.icon || null; }
      if (srv) srv.role = m.role;
      renderRail();
      renderServerMenu();
    },
    async updateProfile(patch) {
      const r = await api("/api/me", { method: "PATCH", body: patch });
      profile = r.profile;
      app.setColor(profile.color);
      return profile;
    },
    fillProfileForm() {
      $("profEmail").dataset.email = me ? me.email : "";
      $("nickInput").value = profile ? profile.nick : "";
      $("statusTextInput").value = profile && profile.status_text ? profile.status_text : "";
      $("bioInput").value = profile && profile.bio ? profile.bio : "";
      fillExtras();
    },
    // conversa privada: o nome mostrado e o da outra pessoa
    peerName: () => { const srv = currentServer(); return srv && srv.dm ? srv.name : null; },
    serverList: () => servers.slice(),
    async openDm(userId) {
      try { const r = await api("/api/dm", { method: "POST", body: { userId } }); goServer(r.server.id); }
      catch (err) { app.setNote(err.message, true); }
    },
    // Configuracoes > Minha conta: confere a senha e apaga a conta
    async deleteAccount(pw) {
      const { error } = await sb.auth.signInWithPassword({ email: me.email, password: pw || "" });
      if (error) throw new Error("Senha errada.");
      await api("/api/me", { method: "DELETE" });
      await sb.auth.signOut().catch(() => {});
      store.set("chatpedro-server", ""); location.href = "/";
    },
    // Configuracoes > Dispositivos: desconecta a conta dos outros aparelhos
    async signOutOthers() {
      const { error } = await sb.auth.signOut({ scope: "others" });
      if (error) throw new Error(error.message);
    },
    // Configuracoes > Dados e privacidade
    async exportData() {
      const [meData, friends] = await Promise.all([api("/api/me"), api("/api/friends").catch(() => null)]);
      return { conta: meData.user, perfil: meData.profile, servidores: meData.servers, amigos: friends, gerado_em: new Date().toISOString() };
    },
    async changePassword(pw) {
      if (!pw || pw.length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw new Error(error.message);
    },
  };

  // ---------- telas de entrada ----------
  function showGate(which) {
    document.body.classList.add("ready", "gate");
    for (const id of ["gAuth", "gHome", "gInvite", "gMfa"]) $(id).hidden = id !== which;
  }
  function hideGate() { document.body.classList.remove("gate"); document.body.classList.add("ready"); }

  function setMode(m) {
    mode = m;
    $("tabLogin").setAttribute("aria-pressed", String(m === "login"));
    $("tabSignup").setAttribute("aria-pressed", String(m === "signup"));
    $("nickRow").hidden = m !== "signup";
    $("authNick").required = m === "signup";
    $("authEmail").closest("label").hidden = m === "newpass";
    $("authEmail").required = m !== "newpass";
    $("authPass").autocomplete = m === "login" ? "current-password" : "new-password";
    $("authPass").closest("label").firstChild.textContent = m === "newpass" ? "Senha nova " : "Senha ";
    $("authGo").textContent = { login: "Entrar", signup: "Criar conta", newpass: "Salvar senha nova" }[m];
    $("forgotBtn").hidden = m !== "login";
    $("tabLogin").parentElement.hidden = m === "newpass";
  }

  function showAuth(message) {
    setMode(mode === "newpass" ? "newpass" : mode);
    showGate("gAuth");
    if (/^\/convite\//.test(location.pathname) && !message) message = "Entre ou crie uma conta para aceitar o convite.";
    gmsg(message);
  }

  $("tabLogin").addEventListener("click", () => { setMode("login"); gmsg(""); });
  $("tabSignup").addEventListener("click", () => { setMode("signup"); gmsg(""); });

  const authErr = (m) => (/invalid login/i.test(m) ? "E-mail ou senha errados." : /email not confirmed/i.test(m) ? "Esse e-mail ainda não foi confirmado." : /rate|too many/i.test(m) ? "Muitas tentativas. Espere um pouco." : m);

  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("authEmail").value.trim(), password = $("authPass").value, nick = $("authNick").value.trim();
    $("authGo").disabled = true; gmsg("");
    try {
      if (mode === "newpass") {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw new Error(error.message);
        setMode("login");
        gmsg("Senha trocada!");
        return afterLogin();
      }
      if (mode === "signup") await api("/api/signup", { method: "POST", body: { email, password, nick } });
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(authErr(error.message));
      session = data.session;
      await afterLogin();
    } catch (err) {
      gmsg(err.message);
    } finally {
      $("authGo").disabled = false;
    }
  });

  $("forgotBtn").addEventListener("click", async () => {
    const email = $("authEmail").value.trim();
    if (!email) return gmsg("Escreva seu e-mail no campo acima e clique de novo.");
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/" });
    gmsg(error ? authErr(error.message) : "Se esse e-mail tiver conta, chega um link para criar uma senha nova. Olhe também o spam.");
  });

  // ---------- verificacao em 2 etapas ----------
  async function needsCode() {
    try {
      const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      return !!data && data.nextLevel === "aal2" && data.currentLevel !== "aal2";
    } catch { return false; }
  }
  $("mfaForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    gmsg("");
    try {
      const { data: f } = await sb.auth.mfa.listFactors();
      const factor = f && f.totp && f.totp[0];
      if (!factor) throw new Error("Nenhum autenticador encontrado.");
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: $("mfaCode").value.trim() });
      if (error) throw new Error("Código errado. Confira o app e tente de novo.");
      const { data } = await sb.auth.getSession(); session = data.session;
      $("mfaCode").value = "";
      afterLogin();
    } catch (err) { gmsg(err.message); }
  });

  // ---------- depois do login: para qual servidor ir ----------
  async function afterLogin() {
    if (await needsCode()) { showGate("gMfa"); setTimeout(() => $("mfaCode").focus(), 50); return; }
    try {
      const r = await api("/api/me");
      me = r.user; profile = r.profile; servers = r.servers;
      app.setColor(profile.color);
    } catch (e) {
      if (e.status === 401 || e.status === 404) { await sb.auth.signOut().catch(() => {}); return showAuth(e.message); }
      showGate("gAuth"); return gmsg(e.message);
    }
    renderRail();
    const inv = location.pathname.match(/^\/convite\/([A-Za-z0-9_-]+)/);
    if (inv) return showInvite(inv[1]);
    const sm = location.pathname.match(/^\/s\/([0-9a-f-]{36})/i);
    let target = sm && servers.some((x) => x.id === sm[1]) ? sm[1] : null;
    if (!target) {
      const last = store.get("chatpedro-server");
      target = (servers.find((x) => x.id === last) || servers[0] || {}).id;
    }
    if (!target) { if (sm) gmsg("Você não está nesse servidor. Peça um convite."); return showHome(false); }
    enterServer(target);
  }

  function enterServer(id) {
    current = id;
    store.set("chatpedro-server", id);
    if (location.pathname !== "/s/" + id) history.replaceState(null, "", "/s/" + id);
    renderRail();
    renderServerMenu();
    hideGate();
    socket.connect();
  }
  const goServer = (id) => { location.href = "/s/" + id; }; // trocar de servidor recarrega a pagina (sai da call e dos jogos)

  // ---------- sem servidor: criar um ou entrar com convite ----------
  function showHome(canGoBack) {
    $("homeBack").hidden = !canGoBack;
    showGate("gHome");
    if (!canGoBack && !$("gMsg").textContent) gmsg("");
  }
  $("homeBack").addEventListener("click", () => { gmsg(""); hideGate(); });
  $("createForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("createName").value.trim();
    if (!name) return gmsg("Dê um nome para o servidor.");
    const template = ($("tplPick").querySelector(".tpl.on") || {}).dataset?.t || "";
    try { const r = await api("/api/servers", { method: "POST", body: { name, template } }); goServer(r.server.id); }
    catch (err) { gmsg(err.message); }
  });
  $("tplPick").addEventListener("click", (e) => {
    const b = e.target.closest(".tpl"); if (!b) return;
    $("tplPick").querySelectorAll(".tpl").forEach((x) => x.classList.toggle("on", x === b));
  });
  $("joinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("joinCode").value.trim();
    const code = (v.match(/convite\/([A-Za-z0-9_-]+)/) || v.match(/^([A-Za-z0-9_-]{3,32})$/) || [])[1];
    if (!code) return gmsg("Cole o link inteiro do convite (ou só o código do final).");
    location.href = "/convite/" + code;
  });
  const logout = async () => { await sb.auth.signOut().catch(() => {}); store.set("chatpedro-server", ""); location.href = "/"; };
  $("homeLogout").addEventListener("click", logout);
  $("mfaLogout").addEventListener("click", logout);
  $("logoutBtn").addEventListener("click", logout);

  // ---------- convite ----------
  async function showInvite(code) {
    showGate("gInvite");
    gmsg("");
    $("invName").textContent = "...";
    $("invInfo").textContent = "";
    try {
      const r = await api("/api/invites/" + code);
      $("invName").textContent = r.server.name;
      paintIcon($("invIcon"), r.server);
      $("invInfo").textContent = r.members + (r.members === 1 ? " membro" : " membros") + (r.already ? " | você já está nele" : "");
      $("invAccept").textContent = r.already ? "Ir para o servidor" : "Entrar no servidor";
      $("invAccept").hidden = false;
      $("invAccept").onclick = async () => {
        try { const a = await api("/api/invites/" + code + "/accept", { method: "POST" }); goServer(a.server.id); }
        catch (err) { gmsg(err.message); }
      };
    } catch (err) {
      $("invName").textContent = "Convite inválido";
      $("invAccept").hidden = true;
      gmsg(err.message);
    }
  }
  $("invSkip").addEventListener("click", () => { location.href = "/"; });

  // ---------- barra de servidores ----------
  // barra da esquerda: primeiro as conversas privadas (fotos redondas), depois os servidores
  function renderRail() {
    const btn = (s) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "srv" + (s.id === current ? " on" : "") + (s.dm ? " dmsrv" : "");
      paintIcon(b, s);
      const n = dmUnread.get(s.id) || (srvUnread.get(s.id) || {}).mentions;
      if (n) { const d = document.createElement("span"); d.className = "srvbadge"; d.textContent = n > 99 ? "99+" : String(n); b.append(d); }
      if (s.id !== current && (dmUnread.get(s.id) || srvUnread.has(s.id))) b.classList.add("unread");
      b.title = s.dm ? "Conversa com " + s.name : s.name;
      b.setAttribute("aria-label", b.title);
      b.addEventListener("click", () => { if (s.id !== current) goServer(s.id); else document.body.classList.remove("railopen"); });
      return b;
    };
    const dms = servers.filter((s) => s.dm), srvs = servers.filter((s) => !s.dm);
    const sep = document.createElement("span"); sep.className = "railsep";
    $("railList").replaceChildren(...dms.map(btn), ...(dms.length && srvs.length ? [sep] : []), ...srvs.map(btn));
  }
  $("railAdd").addEventListener("click", () => { document.body.classList.remove("railopen"); gmsg(""); showHome(!!current); });
  $("railBtn").addEventListener("click", (e) => { e.stopPropagation(); document.body.classList.toggle("railopen"); });
  document.addEventListener("click", (e) => {
    if (document.body.classList.contains("railopen") && !$("rail").contains(e.target) && !$("side").contains(e.target)) document.body.classList.remove("railopen");
  });

  // ---------- menu do servidor: convidar, renomear, moderar, sair, apagar ----------
  function renderServerMenu() {
    const srv = currentServer();
    if (!srv) return;
    const mod = srv.role === "owner" || srv.role === "admin";
    const can = (p) => (app.can ? app.can(p) : mod);
    $("srvTitle").textContent = srv.name;
    $("srvRole").textContent = srv.role === "owner" ? "você é o dono" : srv.role === "admin" ? "você é ADM" : "você é membro";
    paintIcon($("srvIcon"), srv);
    paintIcon($("headIcon"), srv);
    paintIcon($("topIcon"), srv);
    $("topName").textContent = srv.name;
    $("srvIconDel").hidden = !srv.icon;
    $("srvRenameBox").hidden = !mod;
    $("srvMod").hidden = !(can("members") || can("ban") || can("server"));
    $("srvLeave").hidden = srv.role === "owner" && !srv.dm;
    $("srvDelete").hidden = srv.role !== "owner" || !!srv.dm;
    $("srvNewChan").hidden = !can("channels") || !!srv.dm;
    $("srvInvites").hidden = !mod || !!srv.dm;
    if (srv.dm) { $("invSect").hidden = true; $("srvRenameBox").hidden = true; $("srvMod").hidden = true; $("srvRole").textContent = "conversa privada"; $("srvLeave").querySelector("span").textContent = "Fechar conversa"; }
    else $("invSect").hidden = false;
  }
  $("srvNewChan").addEventListener("click", () => { $("srvModal").hidden = true; document.querySelector('.catadd[data-add="text"]').click(); });
  // convites ativos: ver e cancelar
  $("srvInvites").addEventListener("click", async () => {
    const box = $("invListBox");
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false; box.textContent = "carregando...";
    try {
      const r = await api("/api/servers/" + current + "/invites");
      box.replaceChildren(...(r.invites.length ? r.invites.map((iv) => {
        const row = document.createElement("div"); row.className = "invrow2";
        const t = document.createElement("span"); t.textContent = iv.code + " · por " + iv.by + " · " + iv.uses + (iv.uses === 1 ? " uso" : " usos") + " · " + (iv.expires_at ? "vence " + new Date(iv.expires_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "não vence");
        const del = document.createElement("button"); del.type = "button"; del.className = "cmd danger"; del.textContent = "Cancelar";
        del.addEventListener("click", async () => { try { await api("/api/servers/" + current + "/invites/" + iv.code, { method: "DELETE" }); row.remove(); } catch (err) { $("srvMsg").textContent = err.message; } });
        row.append(t, del); return row;
      }) : [Object.assign(document.createElement("span"), { className: "lbl2", textContent: "Nenhum convite ativo." })]));
    } catch (err) { box.textContent = err.message; }
  });
  $("srvBtn").addEventListener("click", () => {
    const srv = currentServer();
    if (!srv) return;
    $("srvMsg").textContent = ""; $("invOut").hidden = true; $("srvNameInput").value = srv.name;
    renderServerMenu();
    $("srvModal").hidden = false;
  });
  $("srvClose").addEventListener("click", () => { $("srvModal").hidden = true; });
  $("srvModal").addEventListener("click", (e) => { if (e.target === $("srvModal")) $("srvModal").hidden = true; });
  $("invMake").addEventListener("click", async () => {
    try {
      const r = await api("/api/servers/" + current + "/invites", { method: "POST", body: { hours: Number($("invHours").value) } });
      $("invLink").value = location.origin + "/convite/" + r.code;
      $("invOut").hidden = false;
      $("invLink").select();
    } catch (err) { $("srvMsg").textContent = err.message; }
  });
  $("invCopy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("invLink").value);
      setIcon($("invCopy"), "check", "Copiado!", "copiado");
      setTimeout(() => setIcon($("invCopy"), "copy", "Copiar o link"), 1500);
    }
    catch { $("invLink").select(); $("srvMsg").textContent = "Aperte Ctrl+C para copiar."; }
  });
  $("srvRename").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/api/servers/" + current, { method: "PATCH", body: { name: $("srvNameInput").value } }); $("srvMsg").textContent = "";
      const b = $("srvRename").querySelector("button"); b.textContent = "Salvo!"; setTimeout(() => { b.textContent = "Salvar nome"; }, 1500); }
    catch (err) { $("srvMsg").textContent = err.message; }
  });
  // foto do servidor: recorta o meio em quadrado e reduz para 96x96
  async function serverIconData(file) {
    const src = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(file); });
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
    const side = Math.min(img.width, img.height), c = document.createElement("canvas");
    c.width = c.height = 96;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, 96, 96);
    g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 96, 96);
    return c.toDataURL("image/jpeg", 0.85);
  }
  const saveIcon = async (icon) => {
    try { await api("/api/servers/" + current, { method: "PATCH", body: { icon } }); $("srvMsg").textContent = ""; }
    catch (err) { $("srvMsg").textContent = err.message; }
  };
  $("srvIconBtn").addEventListener("click", () => $("srvIconFile").click());
  $("srvIconFile").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f || !f.type.startsWith("image/")) return;
    try { await saveIcon(await serverIconData(f)); } catch { $("srvMsg").textContent = "Não deu para usar essa foto. Tente outra."; }
  });
  $("srvIconDel").addEventListener("click", () => saveIcon(null));
  $("srvMod").addEventListener("click", () => { $("srvModal").hidden = true; app.openMod(); });
  // sair e apagar pedem um segundo clique
  function twoStep(btn, label, fn) {
    let armed = false;
    btn.addEventListener("click", async () => {
      const t = btn.querySelector("span") || btn;
      if (!armed) { armed = true; t.textContent = "Certeza? Clique de novo"; btn.classList.add("armed"); setTimeout(() => { armed = false; t.textContent = label; btn.classList.remove("armed"); }, 4000); return; }
      try { await fn(); } catch (err) { $("srvMsg").textContent = err.message; }
    });
  }
  twoStep($("srvLeave"), "Sair do servidor", async () => {
    await api("/api/servers/" + current + "/leave", { method: "POST" });
    store.set("chatpedro-server", ""); location.href = "/";
  });
  twoStep($("srvDelete"), "Apagar servidor", async () => {
    await api("/api/servers/" + current, { method: "DELETE" });
    store.set("chatpedro-server", ""); location.href = "/";
  });

  // ---------- perfil ----------
  $("nickForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await window.ChatPedroAuth.updateProfile({ nick: $("nickInput").value }); $("profMsg").textContent = ""; app.setNote("Apelido trocado."); }
    catch (err) { $("profMsg").textContent = err.message; }
  });

  $("statusTextForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await window.ChatPedroAuth.updateProfile({ status_text: $("statusTextInput").value }); $("profMsg").textContent = ""; app.setNote("Status salvo."); }
    catch (err) { $("profMsg").textContent = err.message; }
  });

  const DECOS = [["", "Nenhuma"], ["fogo", "Fogo"], ["neon", "Neon"], ["arco-iris", "Arco-íris"], ["ouro", "Ouro"], ["gelo", "Gelo"], ["coracoes", "Corações"]];
  let conns = [];
  function fillExtras() {
    if (!profile) return;
    $("bannerColor").value = profile.banner || "#5865f2";
    $("decoPick").replaceChildren(...DECOS.map(([k, label]) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "deco" + ((profile.decoration || "") === k ? " on" : "");
      const av = document.createElement("span"); av.className = "pres" + (k ? " deco-" + k : ""); av.append(app.avatar(profile.nick, true));
      b.append(av, document.createTextNode(label));
      b.addEventListener("click", async () => { try { await window.ChatPedroAuth.updateProfile({ decoration: k }); fillExtras(); } catch (err) { $("profMsg").textContent = err.message; } });
      return b;
    }));
    conns = Array.isArray(profile.connections) ? profile.connections.slice() : [];
    renderConns();
    const CONN = window.ChatPedro_CONN || {};
    if (!$("connType").options.length) for (const [k, [label]] of Object.entries(CONN)) { const o = document.createElement("option"); o.value = k; o.textContent = label; $("connType").append(o); }
    $("streamerMode").checked = document.body.classList.contains("streamer");
    mfaState();
  }
  function renderConns() {
    const CONN = window.ChatPedro_CONN || {};
    $("connList").replaceChildren(...conns.map((c, i) => {
      const r = document.createElement("div"); r.className = "connrow";
      const a = document.createElement("span"); a.className = "cn"; a.textContent = (CONN[c.type] || [c.type])[0];
      const v = document.createElement("span"); v.className = "cv"; v.textContent = c.name;
      const x = document.createElement("button"); x.type = "button"; x.className = "ib sm"; x.title = "Tirar"; x.append(app.icon("x"));
      x.addEventListener("click", async () => { conns.splice(i, 1); await saveConns(); });
      r.append(a, v, x); return r;
    }));
  }
  async function saveConns() {
    try { await window.ChatPedroAuth.updateProfile({ connections: conns }); conns = (profile.connections || []).slice(); renderConns(); $("profMsg").textContent = ""; }
    catch (err) { $("profMsg").textContent = err.message; }
  }
  $("connAdd").addEventListener("click", async () => {
    const name = $("connName").value.trim();
    if (!name) return;
    conns = conns.filter((c) => c.type !== $("connType").value);
    conns.push({ type: $("connType").value, name });
    $("connName").value = "";
    await saveConns();
  });
  $("bannerSave").addEventListener("click", async () => { try { await window.ChatPedroAuth.updateProfile({ banner: $("bannerColor").value }); app.setNote("Banner do perfil salvo."); } catch (err) { $("profMsg").textContent = err.message; } });
  $("bannerReset").addEventListener("click", async () => { try { await window.ChatPedroAuth.updateProfile({ banner: null }); fillExtras(); } catch (err) { $("profMsg").textContent = err.message; } });
  // modo streamer: esconde e-mail, convites e o texto das notificacoes
  if (store.get("chatpedro-streamer") === "on") document.body.classList.add("streamer");
  $("streamerMode").addEventListener("change", () => {
    document.body.classList.toggle("streamer", $("streamerMode").checked);
    store.set("chatpedro-streamer", $("streamerMode").checked ? "on" : "");
  });
  // verificacao em 2 etapas (TOTP do Supabase): QR code no app autenticador e um codigo para confirmar
  let enrolling = null;
  async function mfaState() {
    try {
      const { data } = await sb.auth.mfa.listFactors();
      const on = !!(data && data.totp && data.totp.length);
      $("mfaState").textContent = on ? "Ativada: entrar pede o código do app autenticador." : "Proteja a conta com um código do celular além da senha.";
      $("mfaOn").hidden = on; $("mfaOff").hidden = !on;
    } catch { $("mfaOn").hidden = false; $("mfaOff").hidden = true; }
  }
  $("mfaOn").addEventListener("click", async () => {
    try {
      // tira tentativas antigas que ficaram pela metade
      const { data: list } = await sb.auth.mfa.listFactors();
      for (const f of (list && list.all) || []) if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
      const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Chat Pedro " + Date.now() });
      if (error) throw error;
      enrolling = data.id;
      $("mfaQr").src = data.totp.qr_code;
      $("mfaSecret").textContent = data.totp.secret;
      $("mfaSetup").hidden = false;
      $("mfaVerifyCode").focus();
    } catch (err) { $("profMsg").textContent = "Não deu para ativar: " + (err.message || err); }
  });
  $("mfaVerify").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: enrolling, code: $("mfaVerifyCode").value.trim() });
      if (error) throw new Error("Código errado. Confira o app.");
      const { data } = await sb.auth.getSession(); session = data.session;
      $("mfaSetup").hidden = true; $("mfaVerifyCode").value = "";
      app.setNote("Verificação em 2 etapas ativada!");
      mfaState();
    } catch (err) { $("profMsg").textContent = err.message; }
  });
  let mfaOffArmed = false;
  $("mfaOff").addEventListener("click", async () => {
    if (!mfaOffArmed) { mfaOffArmed = true; $("mfaOff").textContent = "Certeza? Clique de novo"; setTimeout(() => { mfaOffArmed = false; $("mfaOff").textContent = "Desativar"; }, 4000); return; }
    try {
      const { data } = await sb.auth.mfa.listFactors();
      for (const f of (data && data.all) || []) { const { error } = await sb.auth.mfa.unenroll({ factorId: f.id }); if (error) throw error; }
      await sb.auth.refreshSession().catch(() => {});
      app.setNote("Verificação em 2 etapas desativada.");
      mfaState();
    } catch (err) { $("profMsg").textContent = "Não deu para desativar: " + (err.message || err); }
  });

  // ---------- conexao em tempo real ----------
  let retried = false;
  socket.on("connect", () => { retried = false; });
  socket.on("connect_error", async (err) => {
    if (err.message === "login") {
      // token velho (aba dormindo): tenta renovar uma vez antes de pedir login de novo
      if (!retried) {
        retried = true;
        const { data } = await sb.auth.refreshSession().catch(() => ({ data: {} }));
        if (data && data.session) { session = data.session; return socket.connect(); }
      }
      await sb.auth.signOut().catch(() => {});
      return showAuth("Sua sessão acabou. Entre de novo.");
    }
    if (err.message === "nao_membro" || err.message === "banido") {
      servers = servers.filter((x) => x.id !== current);
      current = null; store.set("chatpedro-server", "");
      history.replaceState(null, "", "/");
      renderRail();
      gmsg(err.message === "banido" ? "Você está banido desse servidor." : "Você não está mais nesse servidor.");
      return showHome(false);
    }
    if (err.message === "codigo") { showGate("gMfa"); return; }
    if (err.message === "sem_banco") { showGate("gAuth"); return gmsg("O site ainda não foi ligado ao banco (falta SUPABASE_SECRET_KEY no Render)."); }
    app.setNote("Não deu para conectar. Tentando de novo...", true);
    // erro do proprio servidor: tenta de novo; queda de rede o socket.io ja tenta sozinho
    if (!socket.active) setTimeout(() => socket.connect(), 3000);
  });
  // mensagens diretas que chegam enquanto voce esta em outro servidor: bolinha vermelha na barra
  const dmUnread = new Map(); // id da conversa -> quantas
  const srvUnread = new Map(); // id do servidor -> { mentions }
  socket.on("srv:ping", (p) => {
    if (!p || p.server === current) return;
    const u = srvUnread.get(p.server) || { mentions: 0 };
    if (p.mention) { u.mentions++; app.dmAlert({ nick: "Menção em outro servidor", text: (servers.find((x) => x.id === p.server) || {}).name || "" }); }
    srvUnread.set(p.server, u);
    renderRail();
  });
  async function refreshServers() {
    try { const r = await api("/api/me"); servers = r.servers; renderRail(); } catch {}
  }
  socket.on("dm:new", () => refreshServers());
  socket.on("dm:ping", async (p) => {
    if (!p || p.server === current) return;
    dmUnread.set(p.server, (dmUnread.get(p.server) || 0) + 1);
    if (!servers.some((x) => x.id === p.server)) await refreshServers(); else renderRail();
    app.dmAlert(p);
  });
  socket.on("server:removed", (reason) => {
    socket.disconnect();
    servers = servers.filter((x) => x.id !== current);
    current = null; store.set("chatpedro-server", "");
    history.replaceState(null, "", "/");
    renderRail();
    gmsg(reason);
    showHome(false);
  });

  // ---------- comeco ----------
  (async () => {
    setMode("login");
    let cfg;
    try { cfg = await (await fetch("/api/config")).json(); }
    catch { showGate("gAuth"); return gmsg("Não deu para falar com o servidor. Recarregue a página."); }
    if (!window.supabase) { showGate("gAuth"); return gmsg("Não deu para carregar o login. Recarregue a página."); }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    sb.auth.onAuthStateChange((event, s) => {
      session = s;
      if (event === "PASSWORD_RECOVERY") { setMode("newpass"); showAuth("Escolha uma senha nova."); }
    });
    if (!cfg.ready) { showGate("gAuth"); return gmsg("O site ainda não foi ligado ao banco (falta SUPABASE_SECRET_KEY no Render)."); }
    const { data } = await sb.auth.getSession();
    session = data.session;
    if (mode === "newpass") return;
    if (!session) return showAuth();
    afterLogin();
  })();
})();

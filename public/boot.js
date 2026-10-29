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
    handshake: () => ({ token: session && session.access_token, server: current }),
    onMe(m) {
      const srv = currentServer();
      if (srv) { srv.name = m.server.name; srv.role = m.role; }
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
      $("profEmail").textContent = me ? "Conta: " + me.email : "";
      $("nickInput").value = profile ? profile.nick : "";
    },
  };

  // ---------- telas de entrada ----------
  function showGate(which) {
    document.body.classList.add("ready", "gate");
    for (const id of ["gAuth", "gHome", "gInvite"]) $(id).hidden = id !== which;
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

  // ---------- depois do login: para qual servidor ir ----------
  async function afterLogin() {
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
    if (!name) return gmsg("De um nome para o servidor.");
    try { const r = await api("/api/servers", { method: "POST", body: { name } }); goServer(r.server.id); }
    catch (err) { gmsg(err.message); }
  });
  $("joinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("joinCode").value.trim();
    const code = (v.match(/convite\/([A-Za-z0-9_-]+)/) || v.match(/^([A-Za-z0-9_-]{6,20})$/) || [])[1];
    if (!code) return gmsg("Cole o link inteiro do convite (ou só o código do final).");
    location.href = "/convite/" + code;
  });
  const logout = async () => { await sb.auth.signOut().catch(() => {}); store.set("chatpedro-server", ""); location.href = "/"; };
  $("homeLogout").addEventListener("click", logout);
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
  function renderRail() {
    $("railList").replaceChildren(...servers.map((s) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "srv" + (s.id === current ? " on" : "");
      b.textContent = initials(s.name);
      b.title = s.name;
      b.setAttribute("aria-label", "Servidor " + s.name);
      b.style.background = "hsl(" + hue(s.id) + " 65% 55%)";
      b.addEventListener("click", () => { if (s.id !== current) goServer(s.id); else document.body.classList.remove("railopen"); });
      return b;
    }));
  }
  $("railAdd").addEventListener("click", () => { document.body.classList.remove("railopen"); gmsg(""); showHome(!!current); });
  $("railBtn").addEventListener("click", (e) => { e.stopPropagation(); document.body.classList.toggle("railopen"); });
  document.addEventListener("click", (e) => {
    if (document.body.classList.contains("railopen") && !$("rail").contains(e.target)) document.body.classList.remove("railopen");
  });

  // ---------- menu do servidor: convidar, renomear, moderar, sair, apagar ----------
  function renderServerMenu() {
    const srv = currentServer();
    if (!srv) return;
    const mod = srv.role === "owner" || srv.role === "admin";
    $("srvTitle").textContent = srv.name;
    $("srvRenameBox").hidden = !mod;
    $("srvMod").hidden = !mod;
    $("srvLeave").hidden = srv.role === "owner";
    $("srvDelete").hidden = srv.role !== "owner";
  }
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
    try { await navigator.clipboard.writeText($("invLink").value); $("invCopy").textContent = "Copiado!"; setTimeout(() => { $("invCopy").textContent = "Copiar"; }, 1500); }
    catch { $("invLink").select(); $("srvMsg").textContent = "Aperte Ctrl+C para copiar."; }
  });
  $("srvRename").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/api/servers/" + current, { method: "PATCH", body: { name: $("srvNameInput").value } }); $("srvMsg").textContent = ""; }
    catch (err) { $("srvMsg").textContent = err.message; }
  });
  $("srvMod").addEventListener("click", () => { $("srvModal").hidden = true; app.openMod(); });
  // sair e apagar pedem um segundo clique
  function twoStep(btn, label, fn) {
    let armed = false;
    btn.addEventListener("click", async () => {
      if (!armed) { armed = true; btn.textContent = "Certeza? clique de novo"; setTimeout(() => { armed = false; btn.textContent = label; }, 4000); return; }
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
    if (err.message === "sem_banco") { showGate("gAuth"); return gmsg("O site ainda não foi ligado ao banco (falta SUPABASE_SECRET_KEY no Render)."); }
    app.setNote("Não deu para conectar. Tentando de novo...", true);
    setTimeout(() => socket.connect(), 3000);
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

// Inicio (como no Discord): amigos (online, todos, pendentes, adicionar), conversas diretas,
// DM em grupo e o Descobrir com os servidores publicos. Abre por cima do servidor sem sair da call.
(() => {
  const app = window.ChatPedro, auth = window.ChatPedroAuth;
  const { socket } = app;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const button = (cls, text, fn) => { const b = el("button", cls, text); b.type = "button"; if (fn) b.addEventListener("click", fn); return b; };
  const STATUS = { online: "Online", ausente: "Ausente", ocupado: "Não perturbe", offline: "Offline" };

  let friends = [], tab = "online", loaded = false;

  // ---------- abrir e fechar ----------
  function openHome() {
    document.body.classList.remove("disc", "railopen");
    document.body.classList.add("home");
    $("homeView").hidden = false; $("discView").hidden = true;
    renderDms(); load();
  }
  function closeAll() {
    document.body.classList.remove("home", "disc");
    $("homeView").hidden = true; $("discView").hidden = true;
  }
  $("railHome").addEventListener("click", () => (document.body.classList.contains("home") ? closeAll() : openHome()));
  $("hClose").addEventListener("click", closeAll);
  $("railDisc").addEventListener("click", () => (document.body.classList.contains("disc") ? closeAll() : openDisc()));
  $("discClose").addEventListener("click", closeAll);
  // sem servidor aberto, o inicio fica como tela principal
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (document.body.classList.contains("home") || document.body.classList.contains("disc")) && !document.querySelector(".modal:not([hidden])")) closeAll(); });

  // ---------- conversas diretas na coluna da esquerda ----------
  function renderDms() {
    const list = auth.serverList().filter((s) => s.dm);
    $("hDms").replaceChildren(...list.map((s) => {
      const b = button("chan dmrow", "", () => auth.goServer(s.id));
      const ic = el("span", "srvicon dmav"); auth.paintIcon(ic, s);
      b.append(ic, el("span", "vn", s.name));
      if (s.group) b.append(el("small", "dmsub", "grupo"));
      return b;
    }));
    if (!list.length) $("hDms").append(el("p", "hempty", "Nenhuma conversa ainda."));
  }

  // ---------- dentro de uma conversa privada: a coluna da esquerda lista as conversas (como no Discord) ----------
  function renderDmSide() {
    const list = auth.serverList().filter((s) => s.dm);
    $("dmList").replaceChildren(...list.map((s) => {
      const b = button("chan dmrow" + (s.id === auth.current ? " on" : ""), "", () => { if (s.id !== auth.current) auth.goServer(s.id); });
      const ic = el("span", "srvicon dmav"); auth.paintIcon(ic, s);
      const t = el("span", "dmt"); t.append(el("span", "vn", s.name));
      if (s.group) t.append(el("small", "dmsub", "grupo"));
      b.append(ic, t);
      return b;
    }));
  }
  app.renderDmSide = renderDmSide;
  renderDmSide();

  // ---------- amigos ----------
  async function load() {
    try { const r = await auth.api("/api/friends"); friends = r.friends || []; loaded = true; }
    catch (err) { app.setNote(err.message, true); }
    const n = friends.filter((f) => f.kind === "incoming").length;
    $("hReqCount").hidden = !n; $("hReqCount").textContent = String(n);
    if (tab !== "add") render(); // na aba de adicionar, nao apaga a confirmacao do pedido
  }
  socket.on("friends:update", (p) => {
    if (p && p.from) app.setNote(p.accepted ? p.from + " aceitou seu pedido de amizade!" : p.from + " mandou um pedido de amizade.");
    if (document.body.classList.contains("home")) load();
    else auth.api("/api/friends").then((r) => { friends = r.friends || []; const n = friends.filter((f) => f.kind === "incoming").length; $("hReqCount").hidden = !n; $("hReqCount").textContent = String(n); }).catch(() => {});
  });
  // status dos amigos muda o tempo todo: atualiza de vez em quando enquanto a tela esta aberta
  setInterval(() => { if (document.body.classList.contains("home") && tab !== "add") load(); }, 30000);

  $("hTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    tab = b.dataset.t;
    $("hTabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    render();
  });
  $("hFriends").addEventListener("click", () => { tab = "online"; $("hTabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.t === "online")); render(); });

  function friendRow(f) {
    const row = el("div", "frow");
    const av = el("span", "pres" + (f.status === "ausente" || f.status === "ocupado" ? " " + f.status : f.status === "offline" ? " none" : ""));
    av.append(avatarOf(f));
    const t = el("span", "ftxt"); t.append(el("b", "", f.nick), el("small", "", f.kind === "incoming" ? "Pedido de amizade recebido" : f.kind === "outgoing" ? "Pedido de amizade enviado" : f.text || STATUS[f.status] || "Offline"));
    const acts = el("span", "facts");
    const act = (ic, label, fn, cls) => { const b = button("fbtn" + (cls ? " " + cls : ""), "", (e) => { e.stopPropagation(); fn(); }); b.append(app.icon(ic)); b.title = label; b.setAttribute("aria-label", label); acts.append(b); };
    if (f.kind === "friend") {
      act("message", "Mandar mensagem", () => auth.openDm(f.id));
      act("dots", "Mais", () => { const r = acts.getBoundingClientRect(); app.showMenu([["Desfazer amizade", "x", () => remove(f), true]], r.right - 200, r.bottom); });
    } else if (f.kind === "incoming") {
      act("check", "Aceitar", async () => { try { await auth.api("/api/friends/" + f.id + "/accept", { method: "POST" }); load(); } catch (err) { app.setNote(err.message, true); } }, "ok");
      act("x", "Recusar", () => remove(f), "no");
    } else act("x", "Cancelar pedido", () => remove(f), "no");
    row.append(av, t, acts);
    if (f.kind === "friend") row.addEventListener("click", () => auth.openDm(f.id));
    return row;
  }
  // foto de quem nao esta no servidor aberto (o avatar do app so conhece os membros dele)
  function avatarOf(f) {
    const a = el("span", "av big");
    if (f.avatar) { const img = el("img"); img.src = f.avatar; img.alt = ""; a.append(img); }
    else { a.textContent = (f.nick[0] || "?").toUpperCase(); let h = 0; for (const c of f.nick) h = (h * 31 + c.charCodeAt(0)) % 360; a.style.background = "hsl(" + h + " 45% 45%)"; }
    return a;
  }
  async function remove(f) {
    try { await auth.api("/api/friends/" + f.id, { method: "DELETE" }); load(); } catch (err) { app.setNote(err.message, true); }
  }

  function render() {
    const body = $("hBody"); body.replaceChildren();
    if (tab === "add") return renderAdd(body);
    const list = tab === "online" ? friends.filter((f) => f.kind === "friend" && f.status !== "offline")
      : tab === "all" ? friends.filter((f) => f.kind === "friend")
      : friends.filter((f) => f.kind !== "friend");
    const search = el("input", "fsearch"); search.type = "search"; search.placeholder = "Buscar";
    const listBox = el("div", "flist");
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const shown = list.filter((f) => !q || f.nick.toLowerCase().includes(q));
      listBox.replaceChildren(el("div", "fcount", ({ online: "ONLINE", all: "TODOS OS AMIGOS", pending: "PENDENTE" })[tab] + " — " + shown.length), ...shown.map(friendRow));
      if (!loaded) listBox.append(el("p", "hempty", "carregando..."));
      else if (!shown.length) {
        const e = el("div", "fempty");
        const ic = el("span", "big"); ic.append(app.icon(tab === "pending" ? "user-plus" : "users"));
        e.append(ic, el("span", "sys", tab === "pending" ? "Não há pedidos de amizade pendentes." : tab === "online" ? "Ninguém por perto para jogar com o Wumpus... digo, com você." : "Você ainda não tem amigos aqui. Que tal adicionar alguém?"));
        listBox.append(e);
      }
    };
    search.addEventListener("input", draw);
    body.append(search, listBox);
    draw();
  }
  function renderAdd(body) {
    const box = el("div", "fadd");
    box.append(el("h2", "", "ADICIONAR AMIGO"), el("p", "", "Você pode adicionar amigos com o apelido deles no Chat Pedro."));
    const form = el("form", "faddrow");
    const inp = el("input"); inp.type = "text"; inp.maxLength = 20; inp.placeholder = "Você pode adicionar amigos com o apelido deles."; inp.setAttribute("aria-label", "Apelido");
    const go = el("button", "cmd big", "Enviar pedido de amizade"); go.type = "submit"; go.disabled = true;
    inp.addEventListener("input", () => { go.disabled = !inp.value.trim(); form.classList.remove("ok", "bad"); msg.textContent = ""; });
    const msg = el("p", "faddmsg");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const r = await auth.api("/api/friends", { method: "POST", body: { nick: inp.value } });
        form.classList.add("ok"); msg.textContent = r.accepted ? "Agora você e " + r.nick + " são amigos!" : "Pronto! Seu pedido de amizade para " + r.nick + " foi enviado.";
        inp.value = ""; go.disabled = true; load();
      } catch (err) { form.classList.add("bad"); msg.textContent = err.message; }
    });
    form.append(inp, go);
    box.append(form, msg);
    body.append(box);
    setTimeout(() => inp.focus(), 0);
  }

  // ---------- DM em grupo (ate 9 amigos) ----------
  $("hNewGroup").addEventListener("click", async () => {
    if (!loaded) await load();
    const mine = friends.filter((f) => f.kind === "friend");
    if (!mine.length) { app.setNote("Adicione amigos primeiro para criar um grupo.", true); return; }
    const chosen = new Set();
    $("pickTitle").textContent = "Selecionar amigos (até 9)";
    const list = $("pickList");
    const create = button("cmd big", "Criar DM em grupo", async () => {
      if (!chosen.size) return;
      try { const r = await auth.api("/api/dm", { method: "POST", body: { userIds: [...chosen] } }); auth.goServer(r.server.id); }
      catch (err) { app.setNote(err.message, true); }
    });
    list.replaceChildren(...mine.map((f) => {
      const b = button("pickitem", "", () => {
        if (chosen.has(f.id)) chosen.delete(f.id); else if (chosen.size < 9) chosen.add(f.id);
        b.classList.toggle("sel", chosen.has(f.id));
        create.textContent = chosen.size > 1 ? "Criar DM em grupo (" + chosen.size + ")" : chosen.size ? "Criar DM" : "Criar DM em grupo";
      });
      b.append(avatarOf(f), el("span", "", f.nick));
      return b;
    }), create);
    $("pickModal").hidden = false;
  });

  // ---------- encontrar conversa (Ctrl+K do inicio) ----------
  $("hFind").addEventListener("click", () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true })));

  // ---------- Descobrir ----------
  let discTimer = null;
  function openDisc() {
    document.body.classList.remove("home", "railopen");
    document.body.classList.add("disc");
    $("discView").hidden = false; $("homeView").hidden = true;
    loadDisc();
  }
  async function loadDisc() {
    const box = $("discList");
    box.replaceChildren(el("p", "hempty", "carregando..."));
    try {
      const r = await auth.api("/api/discover?q=" + encodeURIComponent($("discSearch").value.trim()));
      box.replaceChildren(...r.servers.map((s) => {
        const card = el("div", "dcard");
        const ban = el("div", "dban"); let h = 0; for (const c of s.id) h = (h * 31 + c.charCodeAt(0)) % 360; ban.style.background = "linear-gradient(135deg, hsl(" + h + " 60% 45%), hsl(" + ((h + 50) % 360) + " 60% 35%))";
        const ic = el("span", "srvicon dic"); auth.paintIcon(ic, s);
        const t = el("div", "dtxt");
        t.append(el("b", "", s.name), el("p", "", s.description || "Um servidor do Chat Pedro."));
        const foot = el("div", "dfoot");
        foot.append(el("span", "don", s.online + " online"), el("span", "dmem", s.members + (s.members === 1 ? " membro" : " membros")));
        const go = button("cmd big", s.joined ? "Ir para o servidor" : "Entrar", async () => {
          try { const j = await auth.api("/api/servers/" + s.id + "/join", { method: "POST" }); auth.goServer(j.server.id); }
          catch (err) { app.setNote(err.message, true); }
        });
        card.append(ban, ic, t, foot, go);
        return card;
      }));
      if (!r.servers.length) box.replaceChildren(el("p", "hempty", "Nenhum servidor público ainda. Donos podem abrir o seu em Configurações do servidor > Descobrir."));
    } catch (err) { box.replaceChildren(el("p", "hempty", err.message)); }
  }
  $("discSearch").addEventListener("input", () => { clearTimeout(discTimer); discTimer = setTimeout(loadDisc, 300); });

  window.ChatPedroHome = { open: openHome, close: closeAll, disc: openDisc };
})();

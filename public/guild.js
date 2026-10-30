// Configuracoes do servidor (tela cheia, como no Discord): visao geral, cargos, emojis, figurinhas,
// tela de boas-vindas, Descobrir, link personalizado e integracoes (webhooks).
(() => {
  const app = window.ChatPedro;
  const { socket } = app;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const button = (cls, text, fn) => { const b = el("button", cls, text); b.type = "button"; if (fn) b.addEventListener("click", fn); return b; };

  const PERM_LABELS = [
    ["channels", "Gerenciar canais", "Criar, editar e apagar canais."],
    ["messages", "Gerenciar mensagens", "Apagar mensagens dos outros, limpar canal, ignorar o modo lento e postar em canais de anúncios."],
    ["members", "Moderar membros", "Silenciar, expulsar e mudar o apelido dos membros."],
    ["ban", "Banir membros", "Banir e desbanir pessoas do servidor."],
    ["server", "Gerenciar servidor", "AutoMod, emojis, figurinhas, banner, boas-vindas, Descobrir, link e webhooks."],
    ["roles", "Gerenciar cargos", "Criar cargos e dar ou tirar cargos dos membros."],
    ["everyone", "Mencionar @everyone e @here", "Avisar todo mundo do servidor de uma vez."],
  ];
  const ROLE_COLORS = ["#1abc9c", "#2ecc71", "#3498db", "#9b59b6", "#e91e63", "#f1c40f", "#e67e22", "#e74c3c", "#95a5a6", "#607d8b", "#11806a", "#1f8b4c", "#206694", "#71368a", "#ad1457", "#c27c0e", "#a84300", "#992d22"];

  // ---------- janela ----------
  const modal = el("div", "modal gsettings"); modal.id = "guildModal"; modal.hidden = true;
  modal.innerHTML = '<div class="gs-wrap" role="dialog" aria-label="Configurações do servidor"><nav class="gs-nav"><div class="gs-navin"><b class="gs-srv" id="gsSrv"></b><div id="gsTabs"></div></div></nav><main class="gs-main"><div class="gs-in" id="gsBody"></div><button type="button" class="gs-x" id="gsClose" title="Fechar (Esc)" aria-label="Fechar"></button></main></div>';
  document.body.append(modal);
  $("gsClose").append(app.icon("x"), el("span", "", "ESC"));
  const close = () => { modal.hidden = true; };
  $("gsClose").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) close(); });

  const TABS = [
    ["geral", "Visão geral", "server"], ["cargos", "Cargos", "roles"], ["emojis", "Emojis", "server"], ["figurinhas", "Figurinhas", "server"],
    ["-", "COMUNIDADE"], ["boasvindas", "Tela de boas-vindas", "server"], ["descobrir", "Descobrir", "server"], ["link", "Link personalizado", "server"],
    ["-", "APPS"], ["webhooks", "Integrações", "server"],
  ];
  let tab = "geral";
  function renderTabs() {
    const box = $("gsTabs"); box.replaceChildren();
    for (const [id, label, perm] of TABS) {
      if (id === "-") { box.append(el("div", "gs-h", label)); continue; }
      if (!app.can(perm)) continue;
      const b = button("gs-tab" + (tab === id ? " on" : ""), label, () => { tab = id; render(); });
      box.append(b);
    }
  }
  function open(which) {
    if (!app.can("server") && !app.can("roles")) return;
    tab = which || (app.can("server") ? "geral" : "cargos");
    $("srvModal").hidden = true;
    modal.hidden = false;
    render();
  }
  function render() {
    if (modal.hidden) return;
    $("gsSrv").textContent = $("serverName").textContent;
    renderTabs();
    const body = $("gsBody"); body.replaceChildren();
    ({ geral, cargos, emojis, figurinhas, boasvindas, descobrir, link, webhooks }[tab] || geral)(body);
  }
  app.onGuild = () => render();

  // ---------- imagens: reduz no navegador antes de mandar ----------
  const readFile = (f) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(f); });
  const loadImg = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
  async function shrink(file, maxW, maxH, crop, maxBytes) {
    const img = await loadImg(await readFile(file));
    let sw = img.width, sh = img.height, sx = 0, sy = 0;
    if (crop) { const r = maxW / maxH; if (sw / sh > r) { sw = sh * r; sx = (img.width - sw) / 2; } else { sh = sw / r; sy = (img.height - sh) / 2; } }
    const scale = Math.min(1, maxW / sw, maxH / sh);
    const c = el("canvas"); c.width = Math.max(1, Math.round(sw * scale)); c.height = Math.max(1, Math.round(sh * scale));
    c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    // png/webp mantem o fundo transparente (emoji e figurinha); se ficar grande, vai de webp com menos qualidade
    for (const q of [0.92, 0.8, 0.65, 0.5]) {
      const d = c.toDataURL("image/webp", q);
      if (d.startsWith("data:image/webp") && d.length <= maxBytes) return d;
    }
    const png = c.toDataURL("image/png");
    if (png.length <= maxBytes) return png;
    const jpg = c.toDataURL("image/jpeg", 0.7);
    if (jpg.length <= maxBytes) return jpg;
    throw new Error("grande demais");
  }
  const pickFile = (cb) => { const i = el("input"); i.type = "file"; i.accept = "image/png,image/jpeg,image/webp,image/gif"; i.addEventListener("change", () => { if (i.files[0]) cb(i.files[0]); }); i.click(); };

  const head = (body, title, sub) => { body.append(el("h2", "gs-title", title)); if (sub) body.append(el("p", "gs-sub", sub)); };

  // ---------- visao geral: banner ----------
  function geral(body) {
    head(body, "Visão geral do servidor", "Nome e foto ficam no menu do servidor. Aqui você muda o banner, a imagem grande no topo da lista de canais.");
    const card = el("div", "gs-card");
    const prev = el("div", "gs-banner"); prev.id = "gsBannerPrev";
    const bg = $("srvBtn").style.backgroundImage;
    if (bg) prev.style.backgroundImage = bg; else prev.append(el("span", "", "Sem banner"));
    const row = el("div", "gs-row");
    row.append(
      button("cmd big", "Enviar banner", () => pickFile(async (f) => { try { socket.emit("banner:set", await shrink(f, 960, 540, true, 300 * 1024)); app.setNote("Banner salvo."); setTimeout(render, 400); } catch { app.setNote("Não deu para usar essa imagem.", true); } })),
      button("cmd danger", "Remover banner", () => { socket.emit("banner:set", null); setTimeout(render, 400); }),
    );
    card.append(el("b", "gs-label", "BANNER DO SERVIDOR"), prev, row, el("p", "gs-hint", "Recomendado: 960x540 (16:9). A imagem é cortada no meio."));
    body.append(card);
    const more = el("div", "gs-card");
    more.append(el("b", "gs-label", "MAIS OPÇÕES"));
    const r2 = el("div", "gs-row");
    if (app.can("members") || app.can("ban") || app.can("server")) r2.append(button("cmd", "Moderação e AutoMod", () => { close(); app.openMod(); }));
    more.append(r2);
    body.append(more);
  }

  // ---------- cargos ----------
  let editing = null;
  function cargos(body) {
    const g = app.guild;
    if (editing) return roleEditor(body, editing);
    head(body, "Cargos", "Use cargos para organizar os membros e dar permissões. O cargo mais acima define a cor do nome.");
    body.append(button("cmd big", "Criar cargo", () => { editing = { name: "novo cargo", color: ROLE_COLORS[g.roles.length % ROLE_COLORS.length], perms: [], hoist: false }; render(); }));
    const list = el("div", "gs-list");
    if (!g.roles.length) list.append(el("p", "gs-hint", "Nenhum cargo ainda. Dono e ADM continuam existindo e têm todas as permissões."));
    g.roles.forEach((r, i) => {
      const row = el("div", "gs-rrow");
      const dot = el("span", "rdot"); dot.style.background = r.color || "#b5bac1";
      const count = Object.values(g.memberRoles).filter((l) => l.includes(r.id)).length;
      const name = el("span", "gs-rname", r.name);
      const info = el("span", "gs-rinfo", count + (count === 1 ? " membro" : " membros"));
      const up = button("ib sm", "", () => socket.emit("role:move", { id: r.id, dir: -1 })); up.append(app.icon("chevron-down")); up.classList.add("flip"); up.title = "Subir"; up.disabled = i === 0;
      const dn = button("ib sm", "", () => socket.emit("role:move", { id: r.id, dir: 1 })); dn.append(app.icon("chevron-down")); dn.title = "Descer"; dn.disabled = i === g.roles.length - 1;
      const ed = button("ib sm", "", () => { editing = { ...r, perms: [...r.perms] }; render(); }); ed.append(app.icon("edit")); ed.title = "Editar";
      row.append(dot, name, info, up, dn, ed);
      list.append(row);
    });
    body.append(list);
  }
  function roleEditor(body, r) {
    head(body, r.id ? "Editar cargo — " + r.name : "Criar cargo");
    body.append(button("cmd", "‹ Voltar", () => { editing = null; render(); }));
    const card = el("div", "gs-card");
    const name = el("input"); name.type = "text"; name.maxLength = 32; name.value = r.name;
    name.addEventListener("input", () => { r.name = name.value; });
    const lab = el("label", "gs-field"); lab.append(el("b", "gs-label", "NOME DO CARGO"), name);
    const sw = el("div", "gs-swatches");
    for (const c of ROLE_COLORS) {
      const b = button("sw" + (r.color === c ? " on" : ""), "", () => { r.color = c; sw.querySelectorAll(".sw").forEach((x) => x.classList.toggle("on", x === b)); });
      b.style.background = c; b.title = c; sw.append(b);
    }
    const custom = el("input"); custom.type = "color"; custom.value = r.color || "#99aab5"; custom.title = "Outra cor";
    custom.addEventListener("input", () => { r.color = custom.value; sw.querySelectorAll(".sw").forEach((x) => x.classList.remove("on")); });
    sw.append(custom);
    const lab2 = el("div", "gs-field"); lab2.append(el("b", "gs-label", "COR DO CARGO"), sw);
    const hoist = el("label", "gs-toggle"); const hc = el("input"); hc.type = "checkbox"; hc.checked = !!r.hoist; hc.addEventListener("change", () => { r.hoist = hc.checked; });
    hoist.append(el("span", "", "Mostrar separado na lista de membros"), hc);
    card.append(lab, lab2, hoist);
    body.append(card);
    const perms = el("div", "gs-card");
    perms.append(el("b", "gs-label", "PERMISSÕES"));
    for (const [k, label, desc] of PERM_LABELS) {
      if (k === "roles" && app.members.find((m) => m.id === app.myUid)?.role !== "owner") continue;
      const row = el("label", "gs-perm");
      const t = el("span", "gs-ptxt"); t.append(el("b", "", label), el("small", "", desc));
      const c = el("input"); c.type = "checkbox"; c.checked = r.perms.includes(k);
      c.addEventListener("change", () => { r.perms = c.checked ? [...r.perms, k] : r.perms.filter((x) => x !== k); });
      row.append(t, c); perms.append(row);
    }
    body.append(perms);
    // quem tem o cargo
    if (r.id) {
      const mem = el("div", "gs-card");
      mem.append(el("b", "gs-label", "MEMBROS COM ESTE CARGO"));
      const g = app.guild;
      const has = app.members.filter((m) => (g.memberRoles[m.id] || []).includes(r.id));
      const list = el("div", "gs-chips");
      for (const m of has) { const c = el("span", "rpill rm", app.dispName(m.nick)); c.title = "Clique para tirar"; c.addEventListener("click", () => socket.emit("role:assign", { uid: m.id, role: r.id, on: false })); list.append(c); }
      const add = button("rpill add", "+ Adicionar membro", (e) => {
        const rr = e.currentTarget.getBoundingClientRect();
        const opts = app.members.filter((m) => m.role === "member" && !has.includes(m)).map((m) => [app.dispName(m.nick), "user-plus", () => socket.emit("role:assign", { uid: m.id, role: r.id, on: true })]);
        if (opts.length) app.showMenu(opts, rr.left, rr.bottom + 4); else app.setNote("Todos os membros já têm esse cargo (dono e ADM não precisam).");
      });
      list.append(add);
      mem.append(list);
      body.append(mem);
    }
    const row = el("div", "gs-row gs-save");
    if (r.id) {
      let armed = false;
      const del = button("cmd danger", "Apagar cargo", () => {
        if (!armed) { armed = true; del.textContent = "Certeza? Clique de novo"; setTimeout(() => { armed = false; del.textContent = "Apagar cargo"; }, 3000); return; }
        socket.emit("role:delete", r.id); editing = null; render();
      });
      row.append(del);
    }
    row.append(button("cmd big", "Salvar alterações", () => { socket.emit("role:save", r); editing = null; app.setNote("Cargo salvo."); }));
    body.append(row);
  }

  // ---------- emojis ----------
  function emojis(body) {
    const g = app.guild;
    head(body, "Emojis", "Emojis do servidor podem ser usados por todo mundo aqui com :nome: e nas reações. Até 50.");
    const card = el("div", "gs-card");
    card.append(el("b", "gs-label", "ENVIAR EMOJI"));
    const name = el("input"); name.type = "text"; name.maxLength = 32; name.placeholder = "nome_do_emoji";
    const row = el("div", "gs-row");
    row.append(name, button("cmd big", "Escolher imagem", () => {
      const n = (name.value || "").replace(/[^A-Za-z0-9_]/g, "");
      if (n.length < 2) return app.setNote("Dê um nome com 2 letras ou mais (letras, números e _).", true);
      pickFile(async (f) => { try { socket.emit("emoji:add", { name: n, data: await shrink(f, 64, 64, false, 16 * 1024) }); name.value = ""; } catch { app.setNote("Não deu para usar essa imagem.", true); } });
    }));
    card.append(row, el("p", "gs-hint", "A imagem é reduzida para 64x64. PNG com fundo transparente fica melhor."));
    body.append(card);
    const list = el("div", "gs-grid");
    for (const e of g.emojis) {
      const it = el("div", "gs-emoji");
      const img = el("img"); img.src = e.src; img.alt = e.name;
      const del = button("ib sm", "", () => socket.emit("emoji:delete", e.id)); del.append(app.icon("trash")); del.title = "Apagar";
      it.append(img, el("span", "", ":" + e.name + ":"), del);
      list.append(it);
    }
    if (!g.emojis.length) list.append(el("p", "gs-hint", "Nenhum emoji ainda."));
    body.append(el("b", "gs-label", "EMOJIS — " + g.emojis.length + " DE 50"), list);
  }

  // ---------- figurinhas ----------
  function figurinhas(body) {
    const g = app.guild;
    head(body, "Figurinhas", "Figurinhas aparecem no botão de figurinha da caixa de mensagem. Até 30.");
    const card = el("div", "gs-card");
    const name = el("input"); name.type = "text"; name.maxLength = 30; name.placeholder = "nome da figurinha";
    const row = el("div", "gs-row");
    row.append(name, button("cmd big", "Escolher imagem", () => {
      if (!name.value.trim()) return app.setNote("Dê um nome para a figurinha.", true);
      pickFile(async (f) => { try { socket.emit("sticker:add", { name: name.value, data: await shrink(f, 320, 320, false, 160 * 1024) }); name.value = ""; } catch { app.setNote("Não deu para usar essa imagem.", true); } });
    }));
    card.append(el("b", "gs-label", "ENVIAR FIGURINHA"), row, el("p", "gs-hint", "Reduzida para no máximo 320x320. GIFs viram imagem parada."));
    body.append(card);
    const list = el("div", "gs-grid big");
    for (const st of g.stickers) {
      const it = el("div", "gs-emoji big");
      const img = el("img"); img.alt = st.name;
      socket.emit("sticker:get", st.id, (src) => { if (src) img.src = src; });
      const del = button("ib sm", "", () => socket.emit("sticker:delete", st.id)); del.append(app.icon("trash")); del.title = "Apagar";
      it.append(img, el("span", "", st.name), del);
      list.append(it);
    }
    if (!g.stickers.length) list.append(el("p", "gs-hint", "Nenhuma figurinha ainda."));
    body.append(el("b", "gs-label", "FIGURINHAS — " + g.stickers.length + " DE 30"), list);
  }

  // ---------- tela de boas-vindas ----------
  function boasvindas(body) {
    const w = app.guild.welcome || { desc: "", rules: [] };
    head(body, "Tela de boas-vindas", "Quem entra no servidor vê esta tela uma vez, com a descrição e as regras, e precisa concordar.");
    const card = el("div", "gs-card");
    const desc = el("textarea"); desc.rows = 3; desc.maxLength = 500; desc.value = w.desc || ""; desc.placeholder = "Do que este servidor trata?";
    const rules = el("textarea"); rules.rows = 6; rules.value = (w.rules || []).join("\n"); rules.placeholder = "Uma regra por linha (até 10)\nEx.: Respeite todo mundo";
    const l1 = el("label", "gs-field"); l1.append(el("b", "gs-label", "DESCRIÇÃO"), desc);
    const l2 = el("label", "gs-field"); l2.append(el("b", "gs-label", "REGRAS"), rules);
    card.append(l1, l2);
    body.append(card);
    const row = el("div", "gs-row gs-save");
    row.append(
      button("cmd", "Ver como fica", () => { app.store.set("chatpedro-welcome-" + app.serverId + "-" + app.myUid, ""); app.setNote("Recarregue a página para ver a tela de boas-vindas."); }),
      button("cmd big", "Salvar", () => { socket.emit("welcome:set", { desc: desc.value, rules: rules.value.split("\n") }); app.setNote("Tela de boas-vindas salva."); }),
    );
    body.append(row);
  }

  // ---------- Descobrir ----------
  function descobrir(body) {
    const g = app.guild;
    head(body, "Descobrir", "Servidores públicos aparecem na bússola da barra da esquerda. Qualquer pessoa com conta pode entrar sem convite.");
    const card = el("div", "gs-card");
    const t = el("label", "gs-toggle"); const c = el("input"); c.type = "checkbox"; c.checked = !!g.isPublic;
    t.append(el("span", "", "Mostrar este servidor no Descobrir"), c);
    const desc = el("textarea"); desc.rows = 3; desc.maxLength = 300; desc.value = g.description || ""; desc.placeholder = "Uma frase que convença a galera a entrar";
    const l = el("label", "gs-field"); l.append(el("b", "gs-label", "DESCRIÇÃO NO DESCOBRIR"), desc);
    card.append(t, l);
    body.append(card);
    const row = el("div", "gs-row gs-save");
    row.append(button("cmd big", "Salvar", () => { socket.emit("discover:set", { isPublic: c.checked, description: desc.value }); app.setNote("Salvo."); }));
    body.append(row);
  }

  // ---------- link personalizado ----------
  function link(body) {
    const g = app.guild;
    head(body, "Link personalizado", "Um convite fácil de lembrar que nunca vence, como " + location.host + "/convite/galera.");
    const card = el("div", "gs-card");
    const pre = el("span", "gs-pre", location.host + "/convite/");
    const inp = el("input"); inp.type = "text"; inp.maxLength = 32; inp.value = g.vanity || ""; inp.placeholder = "seu-link";
    const row = el("div", "gs-row gs-vanity"); row.append(pre, inp);
    card.append(el("b", "gs-label", "LINK DO CONVITE"), row);
    if (g.vanity) {
      const full = location.origin + "/convite/" + g.vanity;
      const r2 = el("div", "gs-row");
      r2.append(el("code", "", full), button("cmd", "Copiar", () => navigator.clipboard.writeText(full).then(() => app.setNote("Link copiado.")).catch(() => {})));
      card.append(r2);
    }
    body.append(card);
    const save = el("div", "gs-row gs-save");
    save.append(button("cmd big", "Salvar", () => socket.emit("vanity:set", inp.value)));
    body.append(save);
  }

  // ---------- webhooks ----------
  function webhooks(body) {
    head(body, "Integrações: webhooks", "Um webhook é um link secreto que deixa outros programas (bots, alertas, planilhas) mandarem mensagem num canal.");
    const card = el("div", "gs-card");
    const name = el("input"); name.type = "text"; name.maxLength = 20; name.placeholder = "Nome (ex.: Avisos)";
    const sel = el("select");
    for (const c of app.channels.filter((x) => x.type === "text")) { const o = el("option", "", "#" + c.name); o.value = c.id; sel.append(o); }
    const row = el("div", "gs-row"); row.append(name, sel, button("cmd big", "Novo webhook", () => socket.emit("webhook:create", { name: name.value, ch: sel.value })));
    card.append(el("b", "gs-label", "CRIAR"), row);
    body.append(card);
    const list = el("div", "gs-list"); list.append(el("p", "gs-hint", "carregando..."));
    body.append(list);
    socket.emit("webhook:list", (hooks) => {
      list.replaceChildren();
      if (!hooks || !hooks.length) return list.append(el("p", "gs-hint", "Nenhum webhook."));
      for (const h of hooks) {
        const ch = app.channels.find((c) => c.id === h.ch);
        const r = el("div", "gs-rrow");
        const url = location.origin + h.url;
        r.append(el("span", "gs-rname", h.name), el("span", "gs-rinfo", ch ? "#" + ch.name : "canal apagado"),
          button("cmd", "Copiar URL", () => navigator.clipboard.writeText(url).then(() => app.setNote("URL do webhook copiada. Não mostre para ninguém!")).catch(() => prompt("URL do webhook:", url))),
          button("cmd danger", "Apagar", () => socket.emit("webhook:delete", h.id)));
        list.append(r);
      }
      const ex = el("pre", "codeblock"); ex.textContent = 'curl -X POST -H "Content-Type: application/json" \\\n  -d \'{"content": "Olá do webhook!", "username": "Robô"}\' \\\n  URL_DO_WEBHOOK';
      list.append(el("b", "gs-label", "COMO USAR"), ex);
    });
  }
  socket.on("webhooks:changed", () => { if (tab === "webhooks") render(); });

  // ---------- botao no menu do servidor ----------
  const entry = button("mrow", "", () => open());
  entry.id = "srvSettings";
  entry.append(app.icon("settings"), el("span", "", "Configurações do servidor"), app.icon("chevron-right"));
  $("srvMod").before(entry);
  const sync = () => { entry.hidden = app.isDm || !(app.can("server") || app.can("roles")); };
  socket.on("me", () => setTimeout(sync, 0));
  app.openGuildSettings = open;
})();

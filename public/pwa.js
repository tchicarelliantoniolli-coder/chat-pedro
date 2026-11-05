// Chat Pedro como app instalado (Chromebook, Android, Chrome/Edge no computador): o site vira um app com icone
// proprio e janela so dele (public/manifest.webmanifest + public/sw.js). Aqui ficam:
// - o botao "Instalar o app" na barra de servidores (#railInstall), que aparece quando o navegador deixa instalar;
// - o numero de nao lidas no icone do app (mencao ou mensagem direta com o app em segundo plano).
// No programa do Windows nao faz nada (ele ja tem o seu, em desktop.js).
(() => {
  if (window.ChatPedroDesktop) return;
  const root = document.documentElement;
  const installed = () => matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches || navigator.standalone === true;
  if (installed()) root.classList.add("pwa");

  // ---------- instalar ----------
  let promptEv = null;
  const btn = document.getElementById("railInstall");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // sem a faixa automatica do navegador: o botao fica na barra, como o "Baixar apps" do Discord
    promptEv = e;
    root.classList.add("can-install");
  });
  window.addEventListener("appinstalled", () => { promptEv = null; root.classList.remove("can-install"); });
  if (btn) btn.addEventListener("click", async () => {
    if (!promptEv) return;
    const ev = promptEv;
    try {
      await ev.prompt();
      const r = await ev.userChoice;
      if (r && r.outcome === "accepted") { promptEv = null; root.classList.remove("can-install"); }
    } catch {}
  });

  // ---------- numero de nao lidas no icone do app ----------
  if (!installed() || !("setAppBadge" in navigator)) return;
  const app = window.ChatPedro;
  if (!app) return;
  let unread = 0;
  const setBadge = (n) => {
    unread = n;
    try { (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch {}
  };
  const prev = app.onAlert;
  app.onAlert = (a) => {
    if (prev) prev(a);
    if (!a || !a.away || !(a.mentioned || a.dm)) return;
    if (a.busy && !a.mentioned) return; // "Nao perturbe"
    setBadge(unread + 1);
  };
  const back = () => { if (unread && !document.hidden) setBadge(0); };
  document.addEventListener("visibilitychange", back);
  window.addEventListener("focus", back);
  setBadge(0);
})();

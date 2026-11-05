// Service worker minimo: mostra o aviso do adm fora da aba (Android exige isso), a tela "Sem conexao" do app instalado
// e para trazer o Chat Pedro para frente quando a pessoa clica no aviso.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const tab = all.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) return tab.focus();
    return self.clients.openWindow("/");
  })());
});

// App instalado (Chromebook etc.): sem internet, em vez da pagina de erro do navegador aparece um aviso do
// Chat Pedro que tenta de novo sozinho quando a conexao volta. So mexe na abertura de paginas; o resto passa direto.
const OFFLINE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chat Pedro</title><meta name="theme-color" content="#121214"><style>
html,body{height:100%;margin:0;background:#121214;color:#dfdfe2;font:500 16px "gg sans","Noto Sans",system-ui,sans-serif}
main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:16px;box-sizing:border-box}
h1{margin:8px 0 0;font-size:20px;color:#fbfbfb}p{margin:0;color:#96979e;font-size:14px}
button{margin-top:8px;background:#5865f2;color:#fff;border:0;border-radius:8px;padding:10px 18px;font:inherit;font-size:14px;cursor:pointer}
button:hover{background:#4654c0}</style></head><body><main><svg width="72" height="72" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="18" fill="#5865f2"/><path d="M14 17a5 5 0 0 1 5-5h26a5 5 0 0 1 5 5v18a5 5 0 0 1-5 5H29l-10 8v-8a5 5 0 0 1-5-5z" fill="#fff"/><g fill="#5865f2"><circle cx="23" cy="26" r="3"/><circle cx="32" cy="26" r="3"/><circle cx="41" cy="26" r="3"/></g></svg>
<h1>Sem conexão</h1><p>O Chat Pedro volta sozinho quando a internet voltar.</p>
<button type="button" onclick="location.reload()">Tentar de novo</button></main>
<script>addEventListener("online",()=>location.reload());setInterval(()=>{if(navigator.onLine)fetch("/api/ping",{cache:"no-store"}).then(r=>{if(r.ok)location.reload()}).catch(()=>{})},10000)</script></body></html>`;
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});

// Service worker minimo: so serve para mostrar o aviso do adm fora da aba (Android exige isso)
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

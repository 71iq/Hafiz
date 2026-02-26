/*! coi-serviceworker v0.1.7 - Guido Zuidhof, licensed under MIT */
if (typeof window === "undefined") {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener("fetch", (e) => {
    if (e.request.cache === "only-if-cached" && e.request.mode !== "same-origin") return;
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res.status === 0) return res;
        const headers = new Headers(res.headers);
        headers.set("Cross-Origin-Embedder-Policy", "credentialless");
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      })
    );
  });
} else {
  (async () => {
    if (window.crossOriginIsolated !== false) return;
    const reg = await navigator.serviceWorker.register(window.document.currentScript.src);
    if (reg.active && !navigator.serviceWorker.controller) {
      window.location.reload();
    } else if (!reg.active) {
      // Wait for the service worker to be activated, then reload
      const sw = reg.installing || reg.waiting;
      sw.addEventListener("statechange", () => {
        if (sw.state === "activated") window.location.reload();
      });
    }
  })();
}

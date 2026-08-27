// 網路優先策略：先抓最新，離線才回退快取。每次調整資源時請一併更新 CACHE 版本字串。
const CACHE = "smart-scheduler-v94";
const ASSETS = ["./", "./index.html", "./admin26.html", "./css/main.css", "./js/admin.js", "./js/staff.js", "./js/cloud.js", "./js/update.js", "./js/firebase-config.js", "./manifest.json", "./icons/icon-192.svg", "./icons/icon-512.svg"];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 只處理「本站同源」的 GET；Firebase／Firestore 等跨網域請求完全不攔截，交給瀏覽器與 SDK 自行處理。
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  // cache:"no-cache" → 略過瀏覽器 HTTP 快取、一律向伺服器驗證，確保拿到最新版（沒改就回 304，很快）；離線時退回快取
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); return res; })
      .catch(() => caches.match(e.request))
  );
});

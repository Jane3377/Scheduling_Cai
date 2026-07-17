// 開發／測試階段採「網路優先」策略，確保每次都能載入最新版程式碼；
// 離線時才回退到快取。每次調整資源時請一併更新 CACHE 版本字串。
const CACHE = "smart-scheduler-v05";
const ASSETS = ["./", "./index.html", "./admin26.html", "./css/main.css", "./js/admin.js", "./js/staff.js", "./manifest.json", "./icons/icon-192.svg", "./icons/icon-512.svg"];

self.addEventListener("install", e => {
  self.skipWaiting(); // 新版安裝後立即進入 waiting → 直接接手
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()) // 立即控制所有頁面
  );
});

// 網路優先：先抓最新，成功就順便更新快取；失敗（離線）才用快取。
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

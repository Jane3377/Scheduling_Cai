/* ===================================================================
 *  自動更新：偵測到新版就自動套用、免手動清快取
 *
 *  原理：
 *  - Service Worker 採「網路優先」，只要有網路一律抓最新，快取只是離線備援。
 *  - 每次改版時 sw.js 的版本字串會變 → 瀏覽器偵測到新版 SW → 立即接手
 *    （sw.js 內已 skipWaiting + clients.claim）→ 這裡收到 controllerchange
 *    事件就自動重新整理，讓使用者無感地換到最新版。
 *  - 另外定期＋每次回到前景時主動檢查更新，長時間掛著的 App 也抓得到。
 * =================================================================== */
(function () {
  if (!("serviceWorker" in navigator)) return;

  // 頁面載入時是否「已被舊版 SW 控制」：是→之後換手代表更新；否→首次安裝，不用重載
  var hadController = !!navigator.serviceWorker.controller;
  var refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (!hadController || refreshing) return; // 首次安裝不重載、且只重載一次避免迴圈
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.register("./sw.js").then(function (reg) {
    var check = function () { reg.update().catch(function () {}); };
    check();                                   // 一載入就先查一次
    setInterval(check, 60 * 1000);             // 每分鐘查一次
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) check();           // 回到前景（開 App）就查最新
    });
    window.addEventListener("online", check);  // 恢復連線時查一次
  }).catch(function () {});
})();

/* ===================================================================
 *  採購雞肉管理（獨立頁）
 *  - 上傳門市「餐點銷售」Excel → 換算當日生雞腿／排／翅消耗 → 月曆顯示
 *  - 記錄實際叫貨（依使用日期，預設次營業日）
 *  - 月曆的公休／國定假日「唯讀沿用」排班系統（scheduler/main.settings）
 *  - 資料存 Firestore 同一個 scheduler 集合、但獨立文件 poultry_YYYY-MM：
 *      { days:{ 'YYYY-MM-DD':{ sales:{品項:數量}, parts:{leg,fil,wing}, order:{leg,fil,wing}, uploadedAt, orderAt } }, updatedAt }
 *    完全不碰 scheduler/main 與 shifts_/avail_，不影響排班。
 *  - PIN 與排班後台同一組（scheduler/main.data.settings.adminPin，共用 sessionStorage）。
 * =================================================================== */
(function () {
  "use strict";
  const COLL = "scheduler", MAIN = "main";
  // 部位對照（炸／烤同一批生雞，相加計算）；可在「部位對照設定」覆寫，存 poultry_config.parts
  const DEFAULT_MAP = {
    "2": { leg: 1, fil: 1, wing: 0 },
    "3": { leg: 1, fil: 1, wing: 1 },
    "5": { leg: 1, fil: 2, wing: 2 },
    "9": { leg: 3, fil: 3, wing: 3 },
    wing: { leg: 0, fil: 0, wing: 6 },
  };
  const PIECES = ["2", "3", "5", "9", "wing"];
  const PIECE_LABEL = { "2": "2 塊", "3": "3 塊", "5": "5 塊", "9": "9 塊", wing: "6塊雞翅" };
  let partMap = JSON.parse(JSON.stringify(DEFAULT_MAP));   // 目前生效的對照（預設＝DEFAULT_MAP，載入設定後覆寫）
  // 採購換算：每個部位的批發代號與「每支約幾公克」；可在「部位對照設定 ②」覆寫，存 poultry_config.purchase
  const DEFAULT_PURCHASE = { leg: { code: "D5", g: 120 }, fil: { code: "TS4", g: 150 }, wing: { code: "W6", g: 100 } };
  const PARTS3 = ["leg", "fil", "wing"];
  const PART_LABEL = { leg: "雞腿", fil: "雞排", wing: "雞翅" };
  const PART_EMO = { leg: "🍗", fil: "🥩", wing: "🪽" };
  let purchase = JSON.parse(JSON.stringify(DEFAULT_PURCHASE));
  const DOW = "日一二三四五六";
  const ITEM_ORDER = ["9塊炸雞", "9塊烤雞", "5塊炸雞", "5塊烤雞", "3塊炸雞", "3塊烤雞", "2塊炸雞", "2塊烤雞", "6塊炸雞翅", "6塊烤雞翅"];
  // iDelivery 報表捷徑（店家自己的後台；只是帶今天日期開啟，仍需在該站登入／輸入驗證碼）
  const IDELIVERY_BASE = "https://admin.idelivery.com.tw/admin/store/reports/v3/sales_detail";
  const STORE_ID = "10661";

  let db = null, mainRef = null, monthUnsub = null;
  const settings = { closedDays: [1], holidays: [], nationalHolidays: [], adminPin: "1234", storeName: "蔡叔叔比薩屋" };
  let mainLoaded = false;
  let viewYM = null;      // 目前顯示的月份 'YYYY-MM'
  let days = {};          // date → 記錄（目前顯示月份）
  let lastParse = null;   // 上傳解析暫存
  // 第二階段：次營業日叫貨建議
  const PRED_WINDOW = 35; // 取樣範圍：近 35 天同日型
  let predUnsubs = [], configUnsub = null, predMonthData = {}, predDays = {}, bufferFactor = 1.0;
  let partsHistory = [];  // 部位對照表版本紀錄 [{date:'YYYY-MM-DD', map:{...}}]（日期升冪，最後一筆＝目前）

  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, "0");
  const toKey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parseKey = (k) => new Date(k + "T00:00:00");
  const todayKey = () => toKey(new Date());
  const ymOf = (k) => k.slice(0, 7);
  const fmtFull = (k) => { const d = parseKey(k); return `${d.getMonth() + 1} / ${pad(d.getDate())}（${DOW[d.getDay()]}）`; };

  /* ---------- 日曆（唯讀沿用排班設定） ---------- */
  function isClosed(k) {
    if ((settings.holidays || []).some((h) => h.date === k)) return true;      // 特定休息日（臨時公休）
    return (settings.closedDays || []).includes(parseKey(k).getDay());         // 每週固定公休
  }
  function isTempRest(k) { return (settings.holidays || []).some((h) => h.date === k); }
  function closedLabel(k) { const h = (settings.holidays || []).find((x) => x.date === k); return (h && (h.note || "").trim()) || (isTempRest(k) ? "臨時公休" : "公休"); }
  function natHoliday(k) { const h = (settings.nationalHolidays || []).find((x) => x.date === k); return h ? (h.name || "國定假日") : ""; }
  function nextBusinessDay(fromKey) {
    const d = parseKey(fromKey);
    for (let i = 0; i < 120; i++) { d.setDate(d.getDate() + 1); const k = toKey(d); if (!isClosed(k)) return k; }
    return toKey(d);
  }
  function prevBusinessDay(fromKey) {
    const d = parseKey(fromKey);
    for (let i = 0; i < 120; i++) { d.setDate(d.getDate() - 1); const k = toKey(d); if (!isClosed(k)) return k; }
    return toKey(d);
  }
  function dateMinus(k, n) { const d = parseKey(k); d.setDate(d.getDate() - n); return toKey(d); }
  // 以台灣時區（UTC+8）判斷「現在」的日期與小時，避免裝置時區設定錯誤導致誤判
  function taipeiNow() {
    try {
      const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(new Date());
      const g = (t) => (p.find((x) => x.type === t) || {}).value;
      return { key: `${g("year")}-${g("month")}-${g("day")}`, hour: Number(g("hour")) % 24 };
    } catch (e) { const d = new Date(); return { key: toKey(d), hour: d.getHours() }; }
  }
  const REPORT_CUTOFF_HOUR = 21; // 店家 20:00 打烊，留 1 小時緩衝；過 21:00 且當天有營業 → 預設帶當天，否則帶前一個營業日
  // 銷售報表預設日期：{ key, today }
  function reportTarget() {
    const tw = taipeiNow();
    if (tw.hour >= REPORT_CUTOFF_HOUR && !isClosed(tw.key)) return { key: tw.key, today: true };
    return { key: prevBusinessDay(tw.key), today: false };
  }
  const fmtReportDate = (k) => { const d = parseKey(k); return `${d.getMonth() + 1}/${pad(d.getDate())}（週${DOW[d.getDay()]}）`; };
  function addMonthYM(ym, n) { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  const fmtBuf = (v) => (Math.round(v * 10) / 10).toFixed(1);
  /* ---------- 採購換算（隻 ↔ 公斤） ---------- */
  const purG = (part) => (purchase[part] && Number(purchase[part].g)) || DEFAULT_PURCHASE[part].g;
  const purCode = (part) => (purchase[part] && purchase[part].code) || DEFAULT_PURCHASE[part].code;
  // 隻 → 建議公斤（四捨五入；需求>0 時至少 1 公斤，避免算成 0）
  const kgSuggest = (pieces, part) => { const p = Number(pieces) || 0; if (p <= 0) return 0; return Math.max(1, Math.round((p * purG(part)) / 1000)); };
  // 公斤 → 隻（無條件捨去，保守不高估庫存）
  const kgToPieces = (kg, part) => { const k = Number(kg) || 0, g = purG(part); return k <= 0 || g <= 0 ? 0 : Math.floor((k * 1000) / g); };
  // 日型分組：公休(null，不推估) / 假日(六日＋國定) / 週五 / 平日(其餘)
  function dayGroup(k) {
    if (isClosed(k)) return null;
    if (natHoliday(k)) return "假日";
    const dow = parseKey(k).getDay();
    if (dow === 0 || dow === 6) return "假日";
    if (dow === 5) return "週五";
    return "平日";
  }
  // 推估某日叫貨量：同日型、近 PRED_WINDOW 天內「有上傳消耗」的日子平均 × 緩衝
  function predict(targetKey) {
    const g = dayGroup(targetKey);
    if (!g) return { group: null };
    const todayK = todayKey(), start = dateMinus(todayK, PRED_WINDOW);
    let sum = { leg: 0, fil: 0, wing: 0 }, n = 0;
    Object.keys(predDays).forEach((k) => {
      if (k > todayK || k < start) return;            // 僅取近 35 天內的實際日
      if (dayGroup(k) !== g) return;                   // 同日型
      const rec = predDays[k];
      if (!(rec && rec.parts && rec.sales && Object.keys(rec.sales).length)) return; // 需有實際消耗
      sum.leg += rec.parts.leg; sum.fil += rec.parts.fil; sum.wing += rec.parts.wing; n++;
    });
    if (!n) return { group: g, n: 0 };
    const avg = { leg: sum.leg / n, fil: sum.fil / n, wing: sum.wing / n };
    const rec = { leg: Math.round(avg.leg * bufferFactor), fil: Math.round(avg.fil * bufferFactor), wing: Math.round(avg.wing * bufferFactor) };
    return { group: g, n, buf: bufferFactor, avg: { leg: Math.round(avg.leg), fil: Math.round(avg.fil), wing: Math.round(avg.wing) }, rec };
  }

  /* ---------- 部位換算 ---------- */
  const emptyParts = () => ({ leg: 0, fil: 0, wing: 0 });
  const pieceOfLabel = (label) => { if (/翅/.test(label)) return "wing"; const m = String(label).match(/(\d+)\s*塊/); return m ? m[1] : null; };
  function partsFromSales(sales) {
    const p = emptyParts();
    Object.keys(sales || {}).forEach((label) => {
      const u = partMap[pieceOfLabel(label)]; if (!u) return;
      const q = Number(sales[label]) || 0;
      p.leg += q * u.leg; p.fil += q * u.fil; p.wing += q * u.wing;
    });
    return p;
  }

  /* ---------- 解析 Excel ---------- */
  function classify(name) {
    name = String(name || "");
    const fried = name.includes("薄皮炸雞"), baked = name.includes("鮮嫩烤雞");
    if (!fried && !baked) return null;
    const kind = fried ? "炸" : "烤";
    if (name.includes("翅")) return { piece: "wing", label: `6塊${kind}雞翅` }; // 先判斷「翅」
    const m = name.match(/(\d+)\s*塊/); if (!m) return null;
    const n = Number(m[1]); if (![2, 3, 5, 9].includes(n)) return null;
    return { piece: String(n), label: `${n}塊${kind}雞` };
  }
  function parseWorkbook(buf) {
    let wb;
    try { wb = XLSX.read(buf, { type: "array" }); } catch (e) { return { error: "無法讀取這個檔案，請確認是 Excel 檔。" }; }
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { error: "檔案裡沒有工作表。" };
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    // 日期：前幾列找 YYYY/MM/DD（統計期間）
    let date = null;
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      const m = (rows[i] || []).map((x) => String(x)).join(" ").match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (m) { date = `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`; break; }
    }
    // 表頭列：同時有「餐點名稱」與「銷售數量」（合計欄，非單售／套餐）
    let hr = -1, nameCol = -1, qtyCol = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const r = rows[i] || [];
      const nc = r.findIndex((c) => String(c).trim() === "餐點名稱");
      const qc = r.findIndex((c) => String(c).trim() === "銷售數量");
      if (nc >= 0 && qc >= 0) { hr = i; nameCol = nc; qtyCol = qc; break; }
    }
    if (!date) return { error: "讀不到統計日期，請確認是門市『餐點銷售』Excel。" };
    if (hr < 0) return { error: "找不到『餐點名稱／銷售數量』欄位，請確認是門市『餐點銷售』Excel。" };
    const sales = {};
    for (let i = hr + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = r[nameCol]; if (!name) continue;
      const cl = classify(name); if (!cl) continue;
      const qty = Number(r[qtyCol]) || 0; if (qty <= 0) continue;
      sales[cl.label] = (sales[cl.label] || 0) + qty;
    }
    if (!Object.keys(sales).length) return { error: "這份檔案找不到雞肉品項（薄皮炸雞／鮮嫩烤雞）。", date };
    return { date, sales, parts: partsFromSales(sales) };
  }

  /* ---------- 同步狀態燈 ---------- */
  function setBadge(s) {
    const el = $("ckSync"); if (!el) return;
    const map = { init: ["◌ 初始化", "init"], connecting: ["◌ 連線中", "connecting"], saving: ["↻ 儲存中", "saving"], synced: ["✓ 已同步", "synced"], offline: ["⚠ 離線", "offline"], error: ["⚠ 連線異常", "error"], local: ["● 本機模式", "local"] };
    const [txt, cls] = map[s] || map.init;
    el.textContent = txt; el.className = "sync-badge " + cls;
  }

  /* ---------- 月曆 ---------- */
  const monthRefOf = (ym) => db.collection(COLL).doc("poultry_" + ym);
  function watchMonth(ym) {
    viewYM = ym;
    if (monthUnsub) { monthUnsub(); monthUnsub = null; }
    days = {};
    if (!db) { render(); return; }
    setBadge("connecting");
    monthUnsub = monthRefOf(ym).onSnapshot({ includeMetadataChanges: true }, (snap) => {
      const d = snap.data(); days = (d && d.days) || {};
      setBadge(snap.metadata.hasPendingWrites ? "saving" : (snap.metadata.fromCache ? "offline" : "synced"));
      render();
    }, (err) => { console.error(err); setBadge("error"); });
  }
  function partLines(p) {
    return `<span class="ck-parts"><span class="ck-line"><i>腿</i><b class="ck-leg">${p.leg}</b></span><span class="ck-line"><i>排</i><b class="ck-fil">${p.fil}</b></span><span class="ck-line"><i>翅</i><b class="ck-wing">${p.wing}</b></span></span>`;
  }
  function render() {
    if (!viewYM) return;
    const [y, m] = viewYM.split("-").map(Number);
    const lbl = $("ckMonthLabel"); if (lbl) lbl.textContent = `${y} 年 ${m} 月`;
    const first = new Date(y, m - 1, 1), dim = new Date(y, m, 0).getDate();
    const startDow = (first.getDay() + 6) % 7;      // 週一起始
    const tk = todayKey();
    let html = "";
    for (let i = 0; i < startDow; i++) html += `<div class="employee-cal-day ck-out"></div>`;
    for (let dd = 1; dd <= dim; dd++) {
      const k = `${viewYM}-${pad(dd)}`;
      const rec = days[k] || {};
      const hasSales = !!(rec.sales && Object.keys(rec.sales).length && rec.parts);
      const hasOrder = !!rec.order;
      const dow = parseKey(k).getDay();
      const redNum = (dow === 0 || dow === 6 || !!natHoliday(k));    // 假日／國定假日：日期數字深紅
      const numHtml = `<span class="day-number${redNum ? " ck-red" : ""}">${dd}</span>`;
      const mark = hasOrder ? `<span class="ck-ord-mark" title="已記錄叫貨">📝</span>` : "";
      let cls = "employee-cal-day", inner = numHtml, disabled = "";
      if (isClosed(k)) { cls += " ck-rest"; disabled = "disabled"; inner += `<span class="ck-tag">${closedLabel(k)}</span>`; }   // 公休／臨時公休：灰底＋標示
      else if (hasSales) { cls += " available"; inner = numHtml + mark + partLines(rec.parts); }                               // 已上傳消耗：綠底
      else if (hasOrder) { cls += " ck-order"; inner = numHtml + mark + `<span class="ck-tag ck-ord-tag">已排叫貨</span>` + partLines(rec.order); } // 已排叫貨：黃底
      else { if (k === tk) cls += " ck-today"; inner = numHtml; }                                                              // 營業日／未上傳／今天：只有日期，無標記
      html += `<button type="button" class="${cls}" data-date="${k}" ${disabled}>${inner}</button>`;
    }
    const grid = $("ckGrid"); if (!grid) return;
    grid.innerHTML = html;
    grid.querySelectorAll("button[data-date]:not([disabled])").forEach((b) => b.addEventListener("click", () => openDetail(b.dataset.date)));
  }

  /* ---------- 共用：部位三格、明細表 ---------- */
  function statTiles(p) {
    return `<div class="ck-parts-grid">
      <div class="ck-stat leg"><span>🍗 雞腿</span><strong>${p.leg}</strong></div>
      <div class="ck-stat fil"><span>🥩 雞排</span><strong>${p.fil}</strong></div>
      <div class="ck-stat wing"><span>🪽 雞翅</span><strong>${p.wing}</strong></div></div>`;
  }
  // map：這天上傳當下用的對照表（凍結歷史）；沒存的舊資料回退 DEFAULT_MAP（當時對照表尚不可編輯）。合計用已存的 parts，不即時重算。
  function itemTable(sales, parts, map) {
    const mp = map || DEFAULT_MAP;
    const labels = Object.keys(sales).sort((a, b) => { const ia = ITEM_ORDER.indexOf(a), ib = ITEM_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    let rows = "";
    labels.forEach((l) => {
      const u = mp[pieceOfLabel(l)] || emptyParts(), q = sales[l];
      const meal = l.includes("2塊") ? `<small style="color:var(--muted)">（套餐）</small>` : "";
      rows += `<tr><td>${l}${meal}</td><td>${q}</td><td>${q * u.leg}</td><td>${q * u.fil}</td><td>${q * u.wing}</td></tr>`;
    });
    const t = parts || emptyParts();
    rows += `<tr class="sum"><td>合計</td><td>—</td><td>${t.leg}</td><td>${t.fil}</td><td>${t.wing}</td></tr>`;
    return `<table class="ck-items"><thead><tr><th>品項</th><th>數量</th><th>腿</th><th>排</th><th>翅</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  /* ---------- 彈窗：顯示／隱藏 ---------- */
  function show(id) { $(id).classList.remove("hidden"); }
  function hide(id) { $(id).classList.add("hidden"); }

  /* ---------- 上傳銷售 ---------- */
  function openReport() {
    const t = reportTarget();
    const ds = t.key.replace(/-/g, "/");
    const period = t.today ? "real_time" : "day"; // 當天用即時、前一個營業日用整日結算
    const url = `${IDELIVERY_BASE}?start_time=${encodeURIComponent(ds)}&end_time=${encodeURIComponent(ds)}&period=${period}&store_ids%5B0%5D=${STORE_ID}`;
    window.open(url, "_blank", "noopener");
  }
  function openUpload() {
    lastParse = null;
    $("ckFile").value = "";
    $("uploadResult").innerHTML = "";
    $("uploadDrop").classList.remove("hidden");
    const rd = $("ckReportDate"); if (rd) rd.textContent = fmtReportDate(reportTarget().key);
    show("uploadBackdrop");
  }
  function onFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const res = parseWorkbook(new Uint8Array(e.target.result));
      if (res.error) { $("uploadResult").innerHTML = `<div class="ck-err">⚠ ${res.error}</div>`; return; }
      lastParse = res;
      saveSales(res, () => {
        $("uploadDrop").classList.add("hidden");
        $("uploadResult").innerHTML =
          `<div class="ck-datehead">已解析並儲存：<b>${res.date.replace(/-/g, " / ")}</b></div>` +
          statTiles(res.parts) +
          itemTable(res.sales, res.parts, partMap) +
          `<div class="ck-saved">✓ 已儲存到雲端（${res.date} 覆蓋更新）・共 ${Object.keys(res.sales).length} 個雞肉品項</div>` +
          `<div class="modal-actions"><button class="ghost-btn" id="uploadAgain">再上傳別天</button><button class="primary-btn" id="uploadDone">完成</button></div>`;
        $("uploadAgain").onclick = openUpload;
        $("uploadDone").onclick = () => hide("uploadBackdrop");
      });
    };
    reader.readAsArrayBuffer(file);
  }
  // 目前對照表是否已自訂（與預設不同）→ 只有自訂時才需要逐日存 map，省資料
  function mapIsCustom() { return PIECES.some((pc) => ["leg", "fil", "wing"].some((k) => (partMap[pc] || {})[k] !== DEFAULT_MAP[pc][k])); }
  function saveSales(res, done) {
    if (!db) { done && done(); return; }
    const ym = ymOf(res.date);
    // 只有自訂對照表才存當天 map；用預設時不存（並清掉可能殘留的舊 map）
    const dayRec = { sales: res.sales, parts: res.parts, uploadedAt: Date.now() };
    dayRec.map = mapIsCustom() ? JSON.parse(JSON.stringify(partMap)) : firebase.firestore.FieldValue.delete();
    monthRefOf(ym).set({ days: { [res.date]: dayRec }, updatedAt: Date.now() }, { merge: true })
      .then(() => { if (ym !== viewYM) watchMonth(ym); done && done(); })
      .catch((err) => { console.error(err); $("uploadResult").innerHTML += `<div class="ck-err">⚠ 儲存失敗：${err.message || err}</div>`; });
  }

  /* ---------- 記錄叫貨 ---------- */
  // rec：該天的完整紀錄（含 order 隻數、orderKg 公斤）；可為 null（全新）
  function openOrder(dateKey, rec) {
    const k = dateKey || nextBusinessDay(todayKey());
    $("orderDate").value = k;
    const o = rec && rec.order, kg = rec && rec.orderKg;
    // ① 預估需求（隻）
    $("orderLeg").value = o ? o.leg : "";
    $("orderFil").value = o ? o.fil : "";
    $("orderWing").value = o ? o.wing : "";
    // ② 實際下單（公斤）：有存就用；否則由①估；都沒有就留空
    if (kg) { $("orderKgleg").value = kg.leg; $("orderKgfil").value = kg.fil; $("orderKgwing").value = kg.wing; }
    else if (o) { $("orderKgleg").value = kgSuggest(o.leg, "leg"); $("orderKgfil").value = kgSuggest(o.fil, "fil"); $("orderKgwing").value = kgSuggest(o.wing, "wing"); }
    else { $("orderKgleg").value = ""; $("orderKgfil").value = ""; $("orderKgwing").value = ""; }
    renderKgLabels();
    updateWillSave();
    updateOrderHint();
    renderSuggestion(k);
    show("orderBackdrop");
  }
  function renderKgLabels() { PARTS3.forEach((p) => { const el = $(`lblKg${p}`); if (el) el.textContent = purCode(p); }); }
  // ① 改變 → 自動帶入建議公斤（四捨五入）
  function recalcKg() {
    PARTS3.forEach((p) => {
      const src = { leg: "orderLeg", fil: "orderFil", wing: "orderWing" }[p];
      const v = $(src).value;
      $(`orderKg${p}`).value = (v !== "" && Number(v) > 0) ? kgSuggest(v, p) : "";
    });
    updateWillSave();
  }
  // ② 公斤 → 顯示「將記錄 ≈ 幾隻」
  function updateWillSave() {
    const read = (p) => Number($(`orderKg${p}`).value) || 0;
    const data = { leg: read("leg"), fil: read("fil"), wing: read("wing") };
    const box = $("willSave");
    if (!(data.leg || data.fil || data.wing)) { box.classList.add("hidden"); return; }
    $("wsText").innerHTML = PARTS3.map((p) => `${PART_EMO[p]} ${data[p]}公斤 ≈ <b class="ck-${p}">${kgToPieces(data[p], p)}</b> 隻`).join("　");
    box.classList.remove("hidden");
  }
  function updateOrderHint() {
    const def = nextBusinessDay(todayKey());
    $("orderHint").textContent = `預設帶入「次營業日」＝ ${def.slice(5).replace("-", "/")}（今天 ${todayKey().slice(5).replace("-", "/")} 的下一個營業日，已跳過公休）；可自行修改。`;
  }
  function saveOrder() {
    const k = $("orderDate").value;
    if (!k) { alert("請選擇使用日期"); return; }
    const kg = { leg: Number($("orderKgleg").value) || 0, fil: Number($("orderKgfil").value) || 0, wing: Number($("orderKgwing").value) || 0 };
    const order = { leg: kgToPieces(kg.leg, "leg"), fil: kgToPieces(kg.fil, "fil"), wing: kgToPieces(kg.wing, "wing") };
    if (!db) { hide("orderBackdrop"); return; }
    const ym = ymOf(k);
    // 三個公斤都 0 → 視為「未叫貨」：清掉這天的叫貨紀錄（月曆不顯示 📝、明細顯示 —）
    const allZero = kg.leg === 0 && kg.fil === 0 && kg.wing === 0;
    const DEL = firebase.firestore.FieldValue.delete();
    const payload = allZero
      ? { days: { [k]: { order: DEL, orderAt: DEL, orderKg: DEL } }, updatedAt: Date.now() }
      : { days: { [k]: { order: order, orderKg: kg, orderAt: Date.now() } }, updatedAt: Date.now() };
    monthRefOf(ym).set(payload, { merge: true })
      .then(() => { hide("orderBackdrop"); if (ym !== viewYM) watchMonth(ym); })
      .catch((err) => { console.error(err); alert("儲存失敗：" + (err.message || err)); });
  }

  /* ---------- 點某天：明細／對比 ---------- */
  function cell(obj, k) { return obj ? `<td>${obj[k]}</td>` : `<td class="ck-muted">—</td>`; }
  function diffCell(v) { const c = v < 0 ? "var(--danger)" : v > 0 ? "var(--ok)" : "var(--muted)"; return `<td style="color:${c};font-weight:800">${v > 0 ? "+" : ""}${v}</td>`; }
  function openDetail(k) {
    const rec = days[k] || {};
    const hasSales = !!(rec.sales && Object.keys(rec.sales).length && rec.parts);
    const hasOrder = !!rec.order;
    $("detailTitle").textContent = fmtFull(k);
    let html = "";
    const nat = natHoliday(k);
    if (nat) html += `<div class="ck-holi-line">📌 國定假日：${nat}</div>`;
    if (hasSales || hasOrder) {
      const o = rec.order || null, u = hasSales ? rec.parts : null;
      html += `<div class="cmp-h">叫貨 vs 實際消耗</div>`;
      html += `<table class="ck-items" style="margin-bottom:6px"><thead><tr><th></th><th>🍗 腿</th><th>🥩 排</th><th>🪽 翅</th></tr></thead><tbody>`;
      html += `<tr><td>實際叫貨</td>${cell(o, "leg")}${cell(o, "fil")}${cell(o, "wing")}</tr>`;
      html += `<tr><td>實際消耗</td>${cell(u, "leg")}${cell(u, "fil")}${cell(u, "wing")}</tr>`;
      if (o && u) html += `<tr class="sum"><td>差額（叫−用）</td>${diffCell(o.leg - u.leg)}${diffCell(o.fil - u.fil)}${diffCell(o.wing - u.wing)}</tr>`;
      html += `</tbody></table>`;
      const kg = rec.orderKg;
      if (kg) html += `<div class="ck-kgline">📦 當天下單公斤：${PARTS3.map((p) => `${PART_EMO[p]} ${kg[p]}`).join("　")}（公斤）</div>`;
      if (!o) html += `<div class="hint" style="margin:-2px 2px 12px">這天尚未記錄叫貨。</div>`;
      else if (!u) html += `<div class="hint" style="margin:-2px 2px 12px">這天尚未上傳銷售，無法比對消耗。</div>`;
      else html += `<div class="hint" style="margin:-2px 2px 12px">負數＝叫貨不夠用；正數＝有剩。供調整下次叫貨參考。</div>`;
    }
    if (hasSales) html += `<div class="cmp-h">當日銷售明細（換算消耗）</div>` + itemTable(rec.sales, rec.parts, rec.map);
    else html += `<div class="empty-state">這天尚未上傳銷售。</div>`;
    $("detailBody").innerHTML = html;
    $("detailEditOrder").onclick = () => { hide("detailBackdrop"); openOrder(k, rec); };
    show("detailBackdrop");
  }

  /* ---------- PIN 閘門（與排班後台同一組） ---------- */
  function enterApp() { hide("pinGate"); show("app"); }
  function tryUnlock() {
    const ref = settings.adminPin || "1234";
    if (($("pinInput").value || "").trim() === ref) { try { sessionStorage.setItem("adminUnlocked", "1"); } catch (e) {} enterApp(); $("pinError").textContent = ""; }
    else { $("pinError").textContent = "PIN 碼錯誤，請再試一次"; $("pinInput").value = ""; }
  }

  /* ---------- 月份切換 ---------- */
  function shiftMonth(n) {
    const [y, m] = viewYM.split("-").map(Number);
    const d = new Date(y, m - 1 + n, 1);
    watchMonth(d.getFullYear() + "-" + pad(d.getMonth() + 1));
  }

  /* ---------- 次營業日叫貨建議（第二階段） ---------- */
  function orderOpen() { return !$("orderBackdrop").classList.contains("hidden"); }
  function watchPredMonths() {
    predUnsubs.forEach((u) => u && u()); predUnsubs = []; predMonthData = {};
    if (!db) return;
    const tm = ymOf(todayKey());
    [tm, addMonthYM(tm, -1)].forEach((ym) => {
      const u = monthRefOf(ym).onSnapshot((snap) => {
        const d = snap.data(); predMonthData[ym] = (d && d.days) || {};
        predDays = {}; Object.values(predMonthData).forEach((m) => Object.assign(predDays, m));
        refreshHint(); if (orderOpen()) renderSuggestion($("orderDate").value);
      }, (err) => console.error("pred snapshot", err));
      predUnsubs.push(u);
    });
  }
  const configRef = () => db.collection(COLL).doc("poultry_config");
  function applyConfig(d) {
    bufferFactor = (d && typeof d.bufferFactor === "number" && d.bufferFactor > 0) ? d.bufferFactor : 1.0;
    partMap = JSON.parse(JSON.stringify(DEFAULT_MAP));
    if (d && d.parts && typeof d.parts === "object") {
      PIECES.forEach((pc) => { const v = d.parts[pc]; if (v && typeof v === "object") partMap[pc] = { leg: Number(v.leg) || 0, fil: Number(v.fil) || 0, wing: Number(v.wing) || 0 }; });
    }
    purchase = JSON.parse(JSON.stringify(DEFAULT_PURCHASE));
    if (d && d.purchase && typeof d.purchase === "object") {
      PARTS3.forEach((p) => { const v = d.purchase[p]; if (v && typeof v === "object") purchase[p] = { code: String(v.code || DEFAULT_PURCHASE[p].code), g: Number(v.g) || DEFAULT_PURCHASE[p].g }; });
    }
    partsHistory = (d && Array.isArray(d.partsHistory)) ? d.partsHistory.slice().sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
  }
  const mapEq = (a, b) => PIECES.every((pc) => ["leg", "fil", "wing"].every((k) => ((a[pc] || {})[k] || 0) === ((b[pc] || {})[k] || 0)));
  function watchConfig() {
    if (!db) return;
    configUnsub = configRef().onSnapshot((snap) => {
      applyConfig(snap.data());
      render(); refreshHint(); if (orderOpen()) { renderKgLabels(); renderSuggestion($("orderDate").value); updateWillSave(); }
    }, (err) => console.error("config snapshot", err));
  }
  function saveBuffer(v) {
    bufferFactor = v;
    if (db) configRef().set({ bufferFactor: v, updatedAt: Date.now() }, { merge: true }).catch((e) => console.error(e));
  }
  // 找「上個同型日」已記錄的叫貨（目標日之前、同日型、最近一天）
  function lastSameTypeOrder(targetKey) {
    const g = dayGroup(targetKey); if (!g) return null;
    let best = null;
    Object.keys(predDays).forEach((k) => {
      if (k >= targetKey) return;
      if (dayGroup(k) !== g) return;
      const o = predDays[k] && predDays[k].order; if (!o) return;
      if (!best || k > best.date) best = { date: k, order: o };
    });
    return best;
  }
  function fillOrder(o) { $("orderLeg").value = o.leg; $("orderFil").value = o.fil; $("orderWing").value = o.wing; recalcKg(); }
  function renderSuggestion(k) {
    const box = $("sugBlock"); if (!box || !k) return;
    const p = predict(k);
    if (p.group === null) { box.classList.add("hidden"); return; }   // 公休不顯示建議
    box.classList.remove("hidden");
    const sel = $("sugBuffer"); if (sel) sel.value = fmtBuf(bufferFactor);
    // 系統建議
    if (!p.n) {
      $("sugNums").classList.add("hidden"); $("sugApply").classList.add("hidden"); $("sugClar").classList.add("hidden"); $("sugNote").classList.add("hidden");
      $("sugBasis").textContent = `${p.group}·資料累積中，多上傳幾天就會自動推估`;
    } else {
      $("sugNums").classList.remove("hidden"); $("sugApply").classList.remove("hidden"); $("sugClar").classList.remove("hidden"); $("sugNote").classList.remove("hidden");
      $("sugLeg").textContent = p.rec.leg; $("sugFil").textContent = p.rec.fil; $("sugWing").textContent = p.rec.wing;
      $("sugBasis").textContent = `近一月 ${p.n} 個「${p.group}」平均 × 緩衝 ${fmtBuf(p.buf)}`;
      $("sugApply").onclick = () => fillOrder(p.rec);
    }
    // 上個同型日叫貨
    const last = lastSameTypeOrder(k), li = $("lastItem"), lr = $("lastRow"), lc = $("lastClar");
    if (last) {
      li.classList.remove("hidden"); lr.classList.remove("hidden"); lc.classList.remove("hidden");
      $("lastTag").textContent = `🕑 上個${p.group}（${last.date.slice(5).replace("-", "/")}）`;
      lc.textContent = `「上個${p.group}」＝上次實際採購量`;
      $("lastLeg").textContent = last.order.leg; $("lastFil").textContent = last.order.fil; $("lastWing").textContent = last.order.wing;
      $("lastApply").onclick = () => fillOrder(last.order);
    } else {
      li.classList.add("hidden"); lr.classList.add("hidden"); lc.classList.add("hidden");
    }
  }
  function refreshHint() {
    const el = $("ckHint"); if (!el) return;
    const k = nextBusinessDay(todayKey()), d = parseKey(k), p = predict(k);
    const head = `🔮 次營業日 ${d.getMonth() + 1}/${pad(d.getDate())}（${DOW[d.getDay()]}${p.group ? "·" + p.group : ""}）`;
    if (!p.group) el.innerHTML = `${head}：公休`;
    else if (!p.n) el.innerHTML = `${head}：建議叫貨資料累積中 ›`;
    else el.innerHTML = `${head} 建議：<b class="ck-leg">腿 ${p.rec.leg}</b>　<b class="ck-fil">排 ${p.rec.fil}</b>　<b class="ck-wing">翅 ${p.rec.wing}</b> ›`;
  }

  /* ---------- 匯出 CSV（選月份、每日彙總） ---------- */
  function csvEscape(v) { v = String(v == null ? "" : v); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
  function triggerDownload(blob, name) { const a = document.createElement("a"), url = URL.createObjectURL(blob); a.href = url; a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0); }
  function downloadCSV(name, rows) { const csv = "﻿" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n"); triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8;" }), name); }
  function openCsv() { $("csvMonth").value = viewYM; show("csvBackdrop"); }
  function doCsvExport() {
    const ym = $("csvMonth").value; if (!ym) { alert("請選擇月份"); return; }
    if (!db) { alert("尚未連線，無法匯出。"); return; }
    monthRefOf(ym).get().then((snap) => {
      const data = (snap.data() && snap.data().days) || {};
      const [y, m] = ym.split("-").map(Number), dim = new Date(y, m, 0).getDate();
      const rows = [["日期", "星期", "日型", "狀態", "消耗腿", "消耗排", "消耗翅", "叫貨腿", "叫貨排", "叫貨翅", "叫貨腿kg", "叫貨排kg", "叫貨翅kg", "差額腿", "差額排", "差額翅"]];
      for (let dd = 1; dd <= dim; dd++) {
        const k = `${ym}-${pad(dd)}`, rec = data[k] || {}, d = parseKey(k), star = DOW[d.getDay()];
        if (isClosed(k)) { rows.push([k, star, "", closedLabel(k), "", "", "", "", "", "", "", "", "", "", "", ""]); continue; }
        const g = dayGroup(k) || "";
        const u = (rec.sales && Object.keys(rec.sales).length && rec.parts) ? rec.parts : null;
        const o = rec.order || null, okg = rec.orderKg || null;
        const df = (u && o) ? { leg: o.leg - u.leg, fil: o.fil - u.fil, wing: o.wing - u.wing } : null;
        rows.push([k, star, g, "營業", u ? u.leg : "", u ? u.fil : "", u ? u.wing : "", o ? o.leg : "", o ? o.fil : "", o ? o.wing : "", okg ? okg.leg : "", okg ? okg.fil : "", okg ? okg.wing : "", df ? df.leg : "", df ? df.fil : "", df ? df.wing : ""]);
      }
      downloadCSV(`${settings.storeName || "採購雞肉"}_採購雞肉_${ym}.csv`, rows);
      hide("csvBackdrop");
    }).catch((err) => { console.error(err); alert("匯出失敗：" + (err.message || err)); });
  }

  /* ---------- 部位對照設定 ---------- */
  function fillPartsInputs(map) { PIECES.forEach((pc) => ["leg", "fil", "wing"].forEach((part) => { const el = $(`pm_${pc}_${part}`); if (el) el.value = (map[pc] && map[pc][part] != null) ? map[pc][part] : 0; })); }
  function fillPurchaseInputs(pur) { PARTS3.forEach((p) => { const c = $(`pu_${p}_code`), g = $(`pu_${p}_g`); if (c) c.value = (pur[p] && pur[p].code != null) ? pur[p].code : ""; if (g) g.value = (pur[p] && pur[p].g != null) ? pur[p].g : ""; }); }
  function readPurchaseInputs() { const pur = {}; PARTS3.forEach((p) => { pur[p] = { code: (($(`pu_${p}_code`).value) || "").trim() || DEFAULT_PURCHASE[p].code, g: Number($(`pu_${p}_g`).value) || DEFAULT_PURCHASE[p].g }; }); return pur; }
  const purEq = (a, b) => PARTS3.every((p) => (a[p] || {}).code === (b[p] || {}).code && Number((a[p] || {}).g) === Number((b[p] || {}).g));
  function openParts() { fillPartsInputs(partMap); fillPurchaseInputs(purchase); renderPmHist(); show("partsBackdrop"); }
  function resetParts() { fillPartsInputs(DEFAULT_MAP); fillPurchaseInputs(DEFAULT_PURCHASE); }
  function saveParts() {
    const parts = {};
    PIECES.forEach((pc) => { parts[pc] = { leg: Number($(`pm_${pc}_leg`).value) || 0, fil: Number($(`pm_${pc}_fil`).value) || 0, wing: Number($(`pm_${pc}_wing`).value) || 0 }; });
    const purch = readPurchaseInputs();
    if (mapEq(parts, partMap) && purEq(purch, purchase)) { hide("partsBackdrop"); return; }   // 都沒變動 → 不確認、不記版本
    if (!confirm("確定要修改設定嗎？\n\n之後上傳／叫貨都會改用新的設定換算；\n已存的歷史數字不受影響。")) return;
    if (!db) { hide("partsBackdrop"); return; }
    const today = todayKey();
    const hist = partsHistory.filter((v) => v.date !== today);  // 當天去重
    hist.push({ date: today, map: parts, purchase: purch });
    hist.sort((a, b) => (a.date < b.date ? -1 : 1));
    configRef().set({ parts, purchase: purch, partsHistory: hist, updatedAt: Date.now() }, { merge: true }).then(() => hide("partsBackdrop")).catch((err) => { console.error(err); alert("儲存失敗：" + (err.message || err)); });
  }
  // 設定版本紀錄（唯讀查看 ①份數對照＋②採購換算）；最底下永遠保留「系統預設值（最初）」
  function renderPmHist() {
    const box = $("pmHistList"); if (!box) return;
    const asc = partsHistory.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    let html = "";
    for (let i = asc.length - 1; i >= 0; i--) {
      const v = asc[i], latest = (i === asc.length - 1);
      html += `<button type="button" class="pm-ver" data-idx="${i}"><span class="d">${v.date.replace(/-/g, "/")} 起版本</span>${latest ? `<span class="now">目前版本</span>` : ""}<span class="arrow">›</span></button>`;
    }
    // 永遠保留的「系統預設值（最初）」
    const baseCurrent = (asc.length === 0);
    html += `<button type="button" class="pm-ver pm-ver-base" data-idx="-1"><span class="d">📦 系統預設值</span>${baseCurrent ? `<span class="now">目前使用中</span>` : `<span class="org">最初</span>`}<span class="arrow">›</span></button>`;
    box.innerHTML = html;
    box.querySelectorAll("button[data-idx]").forEach((b) => b.addEventListener("click", () => openPmVer(asc, Number(b.dataset.idx))));
  }
  function openPmVer(asc, i) {
    const base = (i < 0), ds = (x) => x.replace(/-/g, "/");
    const v = base ? { date: null, map: DEFAULT_MAP, purchase: DEFAULT_PURCHASE } : asc[i];
    const next = base ? null : asc[i + 1];
    $("pmVerTitle").textContent = base ? "系統預設值（最初）" : `設定版本 · ${ds(v.date)} 起`;
    $("pmVerRange").textContent = base
      ? (asc.length ? `系統最初的預設值，沿用到 ${ds(asc[0].date)} 第一次修改` : "系統預設值（目前使用中）")
      : (next ? `此版自 ${ds(v.date)} 起套用，到 ${ds(next.date)} 改版` : `此版自 ${ds(v.date)} 起套用（目前仍在使用）`);
    const pur = v.purchase || DEFAULT_PURCHASE;
    const mapRows = PIECES.map((pc) => { const u = v.map[pc] || { leg: 0, fil: 0, wing: 0 }; return `<tr><td>${PIECE_LABEL[pc]}</td><td>${u.leg}</td><td>${u.fil}</td><td>${u.wing}</td></tr>`; }).join("");
    const purRows = PARTS3.map((p) => { const u = pur[p] || DEFAULT_PURCHASE[p]; return `<tr><td>${PART_EMO[p]} ${PART_LABEL[p]}</td><td>${u.code}</td><td>${u.g} 克</td></tr>`; }).join("");
    $("pmVerBody").innerHTML =
      `<div class="pm-ver-sub">① 份數 → 部位</div><table class="pm"><thead><tr><th>品項</th><th>🍗 腿</th><th>🥩 排</th><th>🪽 翅</th></tr></thead><tbody>${mapRows}</tbody></table>` +
      `<div class="pm-ver-sub">② 採購換算</div><table class="pm"><thead><tr><th>部位</th><th>代號</th><th>每支約</th></tr></thead><tbody>${purRows}</tbody></table>`;
    show("pmVerBackdrop");
  }

  /* ---------- 備份／還原（整包 JSON 匯出匯入） ---------- */
  function openBackup() { show("backupBackdrop"); }
  function doBackupExport() {
    if (!db) { alert("尚未連線，無法備份。"); return; }
    const FP = firebase.firestore.FieldPath.documentId();
    db.collection(COLL).where(FP, ">=", "poultry_").where(FP, "<", "poultry`").get().then((qs) => {
      const out = { type: "poultry-backup", version: 1, exportedAt: new Date().toISOString(), config: null, months: {} };
      qs.forEach((doc) => {
        const id = doc.id, data = doc.data() || {};
        if (id === "poultry_config") out.config = { bufferFactor: data.bufferFactor, parts: data.parts, purchase: data.purchase, partsHistory: data.partsHistory };
        else out.months[id.slice("poultry_".length)] = { days: data.days || {} };
      });
      triggerDownload(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }), `${settings.storeName || "採購雞肉"}_雞肉備份_${todayKey()}.json`);
    }).catch((err) => { console.error(err); alert("備份失敗：" + (err.message || err)); });
  }
  function onBackupFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      let data; try { data = JSON.parse(e.target.result); } catch (x) { alert("這不是有效的備份檔（JSON 解析失敗）。"); return; }
      if (!data || data.type !== "poultry-backup" || !data.months) { alert("這不是採購雞肉的備份檔。"); return; }
      const n = Object.keys(data.months).length;
      if (!confirm(`將匯入 ${n} 個月份的資料${data.config ? "＋設定" : ""}，並覆蓋目前的雞肉資料。確定匯入？`)) return;
      doBackupImport(data);
    };
    reader.readAsText(file);
    $("backupFile").value = "";
  }
  function doBackupImport(data) {
    if (!db) { alert("尚未連線。"); return; }
    const writes = [];
    Object.keys(data.months).forEach((ym) => { if (/^\d{4}-\d{2}$/.test(ym)) writes.push({ ref: monthRefOf(ym), data: { days: data.months[ym].days || {}, updatedAt: Date.now() } }); });
    if (data.config) { const c = { updatedAt: Date.now() }; if (typeof data.config.bufferFactor === "number") c.bufferFactor = data.config.bufferFactor; if (data.config.parts) c.parts = data.config.parts; if (data.config.purchase) c.purchase = data.config.purchase; if (Array.isArray(data.config.partsHistory)) c.partsHistory = data.config.partsHistory; writes.push({ ref: configRef(), data: c }); }
    let i = 0;
    (function next() {
      if (i >= writes.length) { hide("backupBackdrop"); alert("匯入完成。"); watchMonth(viewYM); return; }
      const batch = db.batch(), chunk = writes.slice(i, i + 400); chunk.forEach((w) => batch.set(w.ref, w.data)); i += chunk.length;
      batch.commit().then(next).catch((err) => { console.error(err); alert("匯入失敗：" + (err.message || err)); });
    })();
  }

  /* ---------- 啟動 ---------- */
  function wire() {
    $("pinSubmit").onclick = tryUnlock;
    $("pinInput").addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });
    $("ckUploadBtn").onclick = openUpload;
    $("ckOrderBtn").onclick = () => openOrder(null, null);
    $("ckOpenReport").onclick = openReport;
    $("orderDate").addEventListener("change", () => renderSuggestion($("orderDate").value));
    $("sugBuffer").addEventListener("change", (e) => { saveBuffer(Number(e.target.value) || 1.0); renderSuggestion($("orderDate").value); });
    // ① 預估需求（隻）改變 → 自動換算公斤；② 公斤改變 → 更新「將記錄」
    ["orderLeg", "orderFil", "orderWing"].forEach((id) => $(id).addEventListener("input", recalcKg));
    ["orderKgleg", "orderKgfil", "orderKgwing"].forEach((id) => $(id).addEventListener("input", updateWillSave));
    $("ckHint").onclick = () => { const k = nextBusinessDay(todayKey()); openOrder(k, predDays[k] || null); };
    // 月曆下方工具：匯出 CSV／備份還原／部位對照
    $("ckExportCsvBtn").onclick = openCsv;
    $("csvDownload").onclick = doCsvExport;
    $("ckBackupBtn").onclick = openBackup;
    $("backupExport").onclick = doBackupExport;
    $("backupImport").onclick = () => $("backupFile").click();
    $("backupFile").addEventListener("change", (e) => onBackupFile(e.target.files[0]));
    $("ckGuideBtn").onclick = () => show("guideBackdrop");
    $("ckPartsBtn").onclick = openParts;
    $("partsReset").onclick = resetParts;
    $("partsSave").onclick = saveParts;
    $("ckPrevMonth").onclick = () => shiftMonth(-1);
    $("ckNextMonth").onclick = () => shiftMonth(1);
    $("uploadDrop").onclick = () => $("ckFile").click();
    $("ckFile").addEventListener("change", (e) => onFile(e.target.files[0]));
    $("orderSave").onclick = saveOrder;
    // 彈窗關閉（X、背景、取消）
    document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => hide(b.getAttribute("data-close"))));
    document.querySelectorAll(".modal-backdrop").forEach((bd) => bd.addEventListener("click", (e) => { if (e.target === bd) hide(bd.id); }));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".modal-backdrop:not(.hidden)").forEach((bd) => hide(bd.id)); });
  }
  function init() {
    wire();
    try { if (sessionStorage.getItem("adminUnlocked") === "1") enterApp(); } catch (e) {}
    viewYM = ymOf(todayKey());
    const haveCfg = typeof firebase !== "undefined" && typeof firebaseConfig !== "undefined" && firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId;
    if (!haveCfg || !window.firebase) { setBadge("local"); render(); return; }
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    mainRef = db.collection(COLL).doc(MAIN);
    setBadge("connecting");
    // 先完成匿名登入，再掛上所有 Firestore 監聽。
    // （首次把 PWA 加到主畫面時尚無快取的登入權杖，若在登入完成前就監聽，
    //   會因安全規則 request.auth != null 被拒 → 顯示「連線異常」；等登入完成才連線即可避免。）
    const start = () => {
      mainRef.onSnapshot((snap) => {
        const d = snap.data(), s = (d && d.data && d.data.settings) || {};
        settings.closedDays = s.closedDays || settings.closedDays;
        settings.holidays = s.holidays || [];
        settings.nationalHolidays = s.nationalHolidays || [];
        settings.adminPin = s.adminPin || "1234";
        settings.storeName = s.storeName || settings.storeName;
        mainLoaded = true;
        render(); refreshHint(); if (orderOpen()) renderSuggestion($("orderDate").value);
      }, (err) => console.error("main snapshot", err));
      watchMonth(viewYM);
      watchPredMonths();
      watchConfig();
    };
    if (firebase.auth) {
      firebase.auth().signInAnonymously().then(start).catch((e) => { console.warn("匿名登入失敗，仍嘗試連線：", e); start(); });
    } else {
      start();
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

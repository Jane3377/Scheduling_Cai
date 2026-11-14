/* ===================================================================
 *  採購雞肉管理(獨立頁)
 *  - 上傳門市「餐點銷售」Excel → 換算當日生雞腿／排／翅消耗 → 月曆顯示
 *  - 記錄實際叫貨(依使用日期，預設次營業日)
 *  - 月曆的公休／國定假日「唯讀沿用」排班系統(scheduler/main.settings)
 *  - 資料存 Firestore 同一個 scheduler 集合、但獨立文件 poultry_YYYY-MM：
 *      { days:{ 'YYYY-MM-DD':{ sales:{品項:數量}, parts:{leg,fil,wing}, order:{leg,fil,wing}, uploadedAt, orderAt } }, updatedAt }
 *    完全不碰 scheduler/main 與 shifts_/avail_，不影響排班。
 *  - PIN 與排班後台同一組(scheduler/main.data.settings.adminPin，共用 sessionStorage)。
 * =================================================================== */
(function () {
  "use strict";
  const COLL = "scheduler", MAIN = "main";
  // 部位對照(炸／烤同一批生雞，相加計算)；可在「部位對照設定」覆寫，存 poultry_config.parts
  const DEFAULT_MAP = {
    "2": { leg: 1, fil: 1, wing: 0 },
    "3": { leg: 1, fil: 1, wing: 1 },
    "5": { leg: 1, fil: 2, wing: 2 },
    "9": { leg: 3, fil: 3, wing: 3 },
    wing: { leg: 0, fil: 0, wing: 6 },
  };
  const PIECES = ["2", "3", "5", "9", "wing"];
  const PIECE_LABEL = { "2": "2 塊", "3": "3 塊", "5": "5 塊", "9": "9 塊", wing: "6塊雞翅" };
  let partMap = JSON.parse(JSON.stringify(DEFAULT_MAP));   // 目前生效的對照(預設＝DEFAULT_MAP，載入設定後覆寫)
  // 採購換算：每個部位的批發代號與「每支約幾公克」；可在「部位對照設定 ②」覆寫，存 poultry_config.purchase
  const DEFAULT_PURCHASE = { leg: { code: "D5", g: 120 }, fil: { code: "TS4", g: 150 }, wing: { code: "W6", g: 100 } };
  const PARTS3 = ["leg", "fil", "wing"];
  const PART_LABEL = { leg: "雞腿", fil: "雞排", wing: "雞翅" };
  const PART_EMO = { leg: "🍗", fil: "🥩", wing: "🪽" };
  let purchase = JSON.parse(JSON.stringify(DEFAULT_PURCHASE));
  const DOW = "日一二三四五六";
  const ITEM_ORDER = ["9塊炸雞", "9塊烤雞", "5塊炸雞", "5塊烤雞", "3塊炸雞", "3塊烤雞", "2塊炸雞", "2塊烤雞", "6塊炸雞翅", "6塊烤雞翅"];
  // iDelivery 報表捷徑(店家自己的後台；只是帶今天日期開啟，仍需在該站登入／輸入驗證碼)
  const IDELIVERY_BASE = "https://admin.idelivery.com.tw/admin/store/reports/v3/sales_detail";
  const STORE_ID = "10661";

  let db = null, mainRef = null, monthUnsub = null;
  const settings = { closedDays: [1], holidays: [], nationalHolidays: [], adminPin: "1234", storeName: "蔡叔叔比薩屋" };
  let mainLoaded = false;
  let viewYM = null;      // 目前顯示的月份 'YYYY-MM'
  let days = {};          // date → 記錄(目前顯示月份)
  let lastParse = null;   // 上傳解析暫存
  // 第二階段：次營業日叫貨建議
  const WINDOW_OPTIONS = [14, 21, 28, 35, 42, 49, 56, 60]; // 回算天數可選值(每 7 天一階，上限 60)
  const EST_METHODS = ["avg", "median", "weighted", "max"];
  const METHOD_LABEL = { avg: "平均", median: "中位數", weighted: "近期加權", max: "同型日最大" }; // 推估方式標籤
  let predWindow = 35, estMethod = "avg"; // 可在「推估設定」調整，存 poultry_config
  // 批發商(可多家)：每家各自「每週固定休(0=日…6=六)＋臨時休市日」，並指定一家為預設
  // 存 poultry_config.suppliers / defaultSupplier；舊版單一 supplierOff 會自動遷移成「A 廠商」
  const DEFAULT_SUPPLIERS = [{ id: "a", name: "A 廠商", weekdays: [0], dates: [] }];
  let suppliers = JSON.parse(JSON.stringify(DEFAULT_SUPPLIERS));
  let defaultSupplier = "a";
  // 推算引擎目前用「預設廠商」的休息日(Batch 1 沿用；之後每張叫貨單可自選廠商)
  let supplierOff = { weekdays: [0], dates: [] };
  const defSupplier = () => suppliers.find((s) => s.id === defaultSupplier) || suppliers[0];
  const newSupId = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  function cleanSupplier(s) {
    return {
      id: String((s && s.id) || newSupId()),
      name: String((s && s.name) || "廠商"),
      weekdays: (s && Array.isArray(s.weekdays)) ? s.weekdays.filter((n) => n >= 0 && n <= 6) : [],
      dates: (s && Array.isArray(s.dates)) ? s.dates.filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date)).map((x) => ({ date: x.date, note: (x.note || "").toString() })) : [],
    };
  }
  let predUnsubs = [], configUnsub = null, predMonthData = {}, predDays = {}, bufferFactor = 1.0;
  let stockUnsubs = [], stockDays = {};  // 員工端盤點庫存(poultry_stock_YYYY-MM)
  let orderUnsubs = [], orderMonthData = {}, orderDays = {}, orderForm = null;  // 叫貨單(poultry_order_YYYY-MM，以下單日為 key)
  let reminderChecked = false;  // 每日提醒：本次載入是否已檢查過
  let partsHistory = [];  // 部位對照表版本紀錄 [{date:'YYYY-MM-DD', map:{...}}](日期升冪，最後一筆＝目前)
  // 比薩餅皮：四類(t=厚片/鬆厚、s=薄片/薄脆)。推估公式與比薩參數定義都在 js/dough-core.js(後台、員工頁共用同一份)
  const DC = window.DoughCore;
  const { DOUGH_TYPES, DOUGH_LABEL, DEFAULT_PIZZA } = DC;
  let pizzaCfg = JSON.parse(JSON.stringify(DEFAULT_PIZZA));
  let pizzaHistory = [];  // 比薩參數版本紀錄 [{date, pizza:{...}}](升冪，最後一筆＝目前)

  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, "0");
  const toKey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parseKey = (k) => new Date(k + "T00:00:00");
  const todayKey = () => toKey(new Date());
  const ymOf = (k) => k.slice(0, 7);
  const fmtFull = (k) => { const d = parseKey(k); return `${d.getMonth() + 1} / ${pad(d.getDate())}(${DOW[d.getDay()]})`; };

  /* ---------- 日曆(唯讀沿用排班設定) ---------- */
  function isClosed(k) {
    if ((settings.holidays || []).some((h) => h.date === k)) return true;      // 特定休息日(臨時公休)
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
  /* ---------- 叫貨時程引擎(批發商休息 ＋ 店家營業 推算下單／到貨／使用) ---------- */
  // 批發商是否上班：非每週固定休、非臨時休市日
  function supplierOpen(k) {
    if ((supplierOff.weekdays || []).includes(parseKey(k).getDay())) return false;
    if ((supplierOff.dates || []).some((x) => x.date === k)) return false;
    return true;
  }
  const prevDay = (k) => { const d = parseKey(k); d.setDate(d.getDate() - 1); return toKey(d); };
  // 有效到貨日：店家營業、批發商上班，且「前一天批發商也上班」(嚴格 D+1：前一天才能下單)
  function validDelivery(k) { return !isClosed(k) && supplierOpen(k) && supplierOpen(prevDay(k)); }
  // 某使用日的「到貨日」＝該日之前、最近一個「有效到貨日」(至少留 1 天醃製)
  function deliveryDayFor(useKey) {
    const d = parseKey(useKey);
    for (let i = 0; i < 21; i++) { d.setDate(d.getDate() - 1); const k = toKey(d); if (validDelivery(k)) return k; }
    return null;
  }
  // 某使用日的「下單日」＝到貨日的前一天(嚴格 D 下單、D+1 到貨)
  function orderDayFor(useKey) { const del = deliveryDayFor(useKey); return del ? prevDay(del) : null; }
  // 某下單日會涵蓋哪些使用日(往後掃，使用日的下單日剛好等於它)
  function coveredUseDays(orderKey) {
    const out = [], d = parseKey(orderKey);
    for (let i = 1; i <= 10; i++) { d.setDate(d.getDate() + 1); const k = toKey(d); if (isClosed(k)) continue; if (orderDayFor(k) === orderKey) out.push(k); }
    return out;
  }
  // 從今天起，最近一個下單日所要備的第一個使用日(記錄叫貨預設用)
  function nextCoveredUse() {
    const d = parseKey(todayKey());
    for (let i = 0; i < 14; i++) { const k = toKey(d); const u = coveredUseDays(k); if (u.length) return u[0]; d.setDate(d.getDate() + 1); }
    return nextBusinessDay(todayKey());
  }
  const mdw = (k) => { const d = parseKey(k); return `${d.getMonth() + 1}/${pad(d.getDate())}(${DOW[d.getDay()]})`; };
  function dateMinus(k, n) { const d = parseKey(k); d.setDate(d.getDate() - n); return toKey(d); }
  // 以台灣時區(UTC+8)判斷「現在」的日期與小時，避免裝置時區設定錯誤導致誤判
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
  const fmtReportDate = (k) => { const d = parseKey(k); return `${d.getMonth() + 1}/${pad(d.getDate())}(週${DOW[d.getDay()]})`; };
  function addMonthYM(ym, n) { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  const fmtBuf = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const fmtPct = (v) => Math.round((Number(v) - 1) * 100); // 多備比例：1.2 → 20
  /* ---------- 採購換算(隻 ↔ 公斤) ---------- */
  const purG = (part) => (purchase[part] && Number(purchase[part].g)) || DEFAULT_PURCHASE[part].g;
  const purCode = (part) => (purchase[part] && purchase[part].code) || DEFAULT_PURCHASE[part].code;
  // 隻 → 建議公斤(四捨五入；需求>0 時至少 1 公斤，避免算成 0)
  const kgSuggest = (pieces, part) => { const p = Number(pieces) || 0; if (p <= 0) return 0; return Math.max(1, Math.round((p * purG(part)) / 1000)); };
  // 公斤 → 隻(無條件捨去，保守不高估庫存)
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
  /* 推估方式(各部位獨立；傳入陣列為「舊→新」排序)：
     - 平均：算術平均
     - 中位數：取中間值(不受偶發爆量/超冷清影響)
     - 近期加權：最新權重最高，每往前一次少一級(最新 N、次新 N−1…最舊 1)的加權平均
     - 同型日最大：取最高值(保守、幾乎不缺貨) */
  const estMean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const estMedian = (a) => { const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const estWeighted = (a) => { let sw = 0, sv = 0; a.forEach((x, i) => { const w = i + 1; sw += w; sv += w * x; }); return sw ? sv / sw : 0; };
  const estMax = (a) => a.reduce((m, x) => Math.max(m, x), 0);
  const ESTIMATORS = { avg: estMean, median: estMedian, weighted: estWeighted, max: estMax };
  // 推估某日叫貨量：同日型、回算視窗內「有上傳消耗」的日子，依推估方式計算 × 緩衝
  function predict(targetKey) {
    const g = dayGroup(targetKey);
    if (!g) return { group: null };
    const todayK = todayKey(), start = dateMinus(todayK, predWindow);
    const samples = [];
    Object.keys(predDays).forEach((k) => {
      if (k > todayK || k < start) return;            // 僅取回算視窗內的實際日
      if (dayGroup(k) !== g) return;                   // 同日型
      const rec = predDays[k];
      if (!(rec && rec.parts && rec.sales && Object.keys(rec.sales).length)) return; // 需有實際消耗
      samples.push({ date: k, parts: rec.parts });
    });
    const n = samples.length;
    if (!n) return { group: g, n: 0 };
    samples.sort((a, b) => (a.date < b.date ? -1 : 1));  // 舊 → 新
    const fn = ESTIMATORS[estMethod] || estMean;
    const base = {}; PARTS3.forEach((p) => { base[p] = fn(samples.map((s) => Number(s.parts[p]) || 0)); });
    const rec = { leg: Math.round(base.leg * bufferFactor), fil: Math.round(base.fil * bufferFactor), wing: Math.round(base.wing * bufferFactor) };
    return { group: g, n, buf: bufferFactor, method: estMethod, avg: { leg: Math.round(base.leg), fil: Math.round(base.fil), wing: Math.round(base.wing) }, rec };
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
  // 餅皮分類 → 四類 key(t=厚/鬆厚、s=薄/薄脆；鬆厚＝厚片、薄脆＝薄片)
  function doughKey(cat, name) {
    if (String(cat).trim() !== "餅皮") return null;
    const n = String(name);
    const size = n.includes("12吋") ? "12" : (n.includes("9吋") ? "9" : null);
    const thick = n.includes("鬆厚") ? "t" : (n.includes("薄脆") ? "s" : null);
    return (size && thick) ? thick + size : null;
  }
  function parseWorkbook(buf) {
    let wb;
    try { wb = XLSX.read(buf, { type: "array" }); } catch (e) { return { error: "無法讀取這個檔案，請確認是 Excel 檔。" }; }
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { error: "檔案裡沒有工作表。" };
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    // 日期：前幾列找 YYYY/MM/DD(統計期間)
    let date = null;
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      const m = (rows[i] || []).map((x) => String(x)).join(" ").match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (m) { date = `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`; break; }
    }
    // 表頭列：同時有「餐點名稱」與「銷售數量」(合計欄，非單售／套餐)
    let hr = -1, nameCol = -1, qtyCol = -1, catCol = -1, amtCol = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const r = rows[i] || [];
      const nc = r.findIndex((c) => String(c).trim() === "餐點名稱");
      const qc = r.findIndex((c) => String(c).trim() === "銷售數量");
      if (nc >= 0 && qc >= 0) {
        hr = i; nameCol = nc; qtyCol = qc;
        catCol = r.findIndex((c) => String(c).trim() === "分類名稱");
        amtCol = r.findIndex((c) => String(c).trim() === "銷售總額");
        break;
      }
    }
    if (!date) return { error: "讀不到統計日期，請確認是門市『餐點銷售』Excel。" };
    if (hr < 0) return { error: "找不到『餐點名稱／銷售數量』欄位，請確認是門市『餐點銷售』Excel。" };
    const sales = {};
    const summary = { total: 0, pizza9: 0, pizza12: 0, pizza9amt: 0, pizza12amt: 0 };
    const dough = { t9: 0, s9: 0, t12: 0, s12: 0 };
    for (let i = hr + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = r[nameCol]; if (!name) continue;
      const cat = catCol >= 0 ? String(r[catCol]).trim() : "";
      const qty = Number(r[qtyCol]) || 0;
      const amt = amtCol >= 0 ? (Number(r[amtCol]) || 0) : 0;
      // 全店營業額(加總各列銷售總額)
      summary.total += amt;
      // 9吋／12吋比薩數量與金額(算均價用)
      if (cat === "9吋比薩") { summary.pizza9 += qty; summary.pizza9amt += amt; }
      else if (cat === "12吋比薩") { summary.pizza12 += qty; summary.pizza12amt += amt; }
      // 餅皮四類(實際賣出)
      const dk = doughKey(cat, name); if (dk) dough[dk] += qty;
      // 雞肉品項
      const cl = classify(name); if (cl && qty > 0) sales[cl.label] = (sales[cl.label] || 0) + qty;
    }
    if (!Object.keys(sales).length) return { error: "這份檔案找不到雞肉品項(薄皮炸雞／鮮嫩烤雞)。", date };
    summary.total = Math.round(summary.total);
    summary.pizza9amt = Math.round(summary.pizza9amt); summary.pizza12amt = Math.round(summary.pizza12amt);
    return { date, sales, parts: partsFromSales(sales), summary, dough };
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
  // 主頁置頂：最新盤點庫存
  function renderStockTop() {
    const el = $("ckStockTop"); if (!el) return;
    const s = currentStock();
    el.classList.remove("hidden");
    if (!s) { el.innerHTML = `📦 ⚠ ${STOCK_NONE_MSG}(不當作庫存 0)`; return; }
    el.innerHTML = `📦 目前庫存　<b class="ck-leg big">腿${s.leg}</b>　<b class="ck-fil big">排${s.fil}</b>　<b class="ck-wing big">翅${s.wing}</b>　<small>(${mdw(s.date)}${s.byName ? " " + s.byName : ""} 盤點)</small>`;
  }
  let calMode = "use";   // "use"＝使用月曆；"order"＝叫貨月曆
  function render() {
    renderHome();
    renderStockTop();
    if (!viewYM) return;
    const [y, m] = viewYM.split("-").map(Number);
    const lbl = $("ckMonthLabel"); if (lbl) lbl.textContent = `${y} 年 ${m} 月`;
    const grid = $("ckGrid"); if (!grid) return;
    const first = new Date(y, m - 1, 1), dim = new Date(y, m, 0).getDate();
    const startDow = (first.getDay() + 6) % 7;      // 週一起始
    let html = "";
    for (let i = 0; i < startDow; i++) html += `<div class="employee-cal-day ck-out"></div>`;
    const cellFn = calMode === "order" ? orderCell : calMode === "dough" ? doughCell : useCell;
    for (let dd = 1; dd <= dim; dd++) { const k = `${viewYM}-${pad(dd)}`; html += cellFn(k, dd); }
    grid.innerHTML = html;
    const clickFn = calMode === "order" ? openOrderForm : calMode === "dough" ? openDoughDetail : openDetail;
    grid.querySelectorAll("button[data-date]:not([disabled])").forEach((b) => b.addEventListener("click", () => clickFn(b.dataset.date)));
    const lg = $("ckLegend"); if (lg) lg.innerHTML =
      calMode === "order" ? `<span><i class="legend-dot" style="background:#2f7d52"></i>已到貨</span><span><i class="legend-dot" style="background:#2a5aa0"></i>已訂購</span><span><i class="legend-dot" style="background:#e0a884"></i>建議訂購</span><span><i class="legend-dot closed"></i>公休(週一等仍可下單)</span><span>🚚休市＝批發商臨時休市</span>`
      : calMode === "dough" ? `<span><i class="legend-dot available"></i>製作量</span><span><i class="legend-dot" style="background:#d9d3cd"></i>只有賣出(未記錄剩餘)</span><span><i class="legend-dot" style="background:#e0a884"></i>推估建議</span><span><i class="legend-dot closed"></i>公休</span>`
      : `<span><i class="legend-dot available"></i>已上傳銷售</span><span><i class="legend-dot" style="background:#ecd98f"></i>已排訂購</span><span><i class="legend-dot closed"></i>公休</span><span>📝 已訂購</span>`;
    const t = $("ckCalTitle"); if (t) t.textContent =
      calMode === "order" ? "每天＝這天訂了什麼(點下單日開訂購單)"
      : calMode === "dough" ? "有剩餘盤點的日子顯示 9吋／12吋 製作合計，沒記錄剩餘只顯示賣出(灰)；今天還沒上傳則顯示預估(點看明細與推估依據)"
      : "每天＝用多少；已上傳日顯示實際消耗，未來日顯示供應狀態";
    applyCalChrome();
  }
  function useCell(k, dd) {
    const rec = days[k] || {};
    const hasSales = !!(rec.sales && Object.keys(rec.sales).length && rec.parts);
    const hasOrder = !!rec.order;
    const dow = parseKey(k).getDay();
    const redNum = (dow === 0 || dow === 6 || !!natHoliday(k));
    const numHtml = `<span class="day-number${redNum ? " ck-red" : ""}">${dd}</span>`;
    const sr = rec.supplyRef, srOrder = sr ? orderForDay(sr.od) : null, st = srOrder ? orderStatus(srOrder) : null;
    const mark = hasOrder ? `<span class="ck-ord-mark" title="已訂購">📝</span>` : "";
    let cls = "employee-cal-day", inner = numHtml, disabled = "";
    if (isClosed(k)) { cls += " ck-rest"; disabled = "disabled"; inner += `<span class="ck-tag">${closedLabel(k)}</span>`; }
    else if (hasSales) { cls += " available"; inner = numHtml + mark + partLines(rec.parts); }
    else if (hasOrder) { cls += " ck-order"; inner = numHtml + mark + `<span class="ck-tag ck-ord-tag">${st ? STATUS_LABEL[st] : "已排訂購"}</span>` + partLines(rec.order); }
    else { if (k === todayKey()) cls += " ck-today"; inner = numHtml; }
    return `<button type="button" class="${cls}" data-date="${k}" ${disabled}>${inner}</button>`;
  }
  // 預設批發商的臨時休市日(每週固定休不顯示在月曆)
  function supTempOff(k) { return (supplierOff.dates || []).find((x) => x.date === k) || null; }
  // 訂購月曆：下單日照批發商上班推算(店家公休也可能是下單日，例如週一)；批發商臨時休市顯示 🚚休市，仍可手動下單(可改訂他家)
  function orderCell(k, dd) {
    const dow = parseKey(k).getDay();
    const redNum = (dow === 0 || dow === 6 || !!natHoliday(k));
    const numHtml = `<span class="day-number${redNum ? " ck-red" : ""}">${dd}</span>`;
    const closed = isClosed(k), o = orderForDay(k), off = supTempOff(k), t = todayKey(), future = k >= t;
    const covered = !off && coveredUseDays(k).length > 0;
    const sup = defSupplier(), offTxt = off ? `${sup ? sup.name : "批發商"}休市${off.note ? "・" + off.note : ""}` : "";
    const offTag = off ? `<span class="ck-supoff" title="${esc(offTxt)}">🚚休市</span>` : "";
    const closedTag = closed ? `<span class="ck-tag">${closedLabel(k)}</span>` : "";
    if (!o && !(future && (covered || off))) {
      if (closed) return `<div class="employee-cal-day ck-rest">${numHtml}${closedTag}${offTag}</div>`;
      return `<button type="button" class="employee-cal-day ck-ordcell${k === t ? " ck-today" : ""}" data-date="${k}" disabled>${numHtml}${offTag}</button>`;
    }
    let cls = "employee-cal-day ck-ordcell" + (closed ? " ck-rest" : ""), inner = numHtml + closedTag + offTag;
    if (o) { const st = orderStatus(o); inner += `<span class="ck-po ${STATUS_CLS[st]}">${esc(o.supplierName || "廠商")}<i>${STATUS_LABEL[st]}</i></span>`; }
    else if (covered) {
      if (k === t) { cls += " ck-today"; inner += `<span class="ck-po ck-posugg">建議下單</span>`; }
      else inner += `<span class="ck-pocan">可下單</span>`;
    } else { if (k === t) cls += " ck-today"; inner += `<span class="ck-pocan">可改訂他家</span>`; }
    return `<button type="button" class="${cls}" data-date="${k}" title="${esc(offTxt)}">${inner}</button>`;
  }
  // 餅皮月曆：每格顯示建議做多少(有製作量資料則顯示實際製作量)；格式＝9吋 厚/薄、12吋 厚/薄
  function doughLines(o, est) {
    return `<span class="ck-dough${est ? " est" : ""}">` +
      `<span class="cd-line"><i>9</i><b>${o.t9}</b><s>/</s><b>${o.s9}</b></span>` +
      `<span class="cd-line"><i>12</i><b>${o.t12}</b><s>/</s><b>${o.s12}</b></span></span>`;
  }
  const doughSum = (o) => o ? (Number(o.t9) || 0) + (Number(o.s9) || 0) + (Number(o.t12) || 0) + (Number(o.s12) || 0) : 0;
  // 月曆格只顯示 9吋／12吋 合計(厚薄明細在點開的明細裡)
  function doughTotals(o, est) {
    const n9 = (Number(o.t9) || 0) + (Number(o.s9) || 0), n12 = (Number(o.t12) || 0) + (Number(o.s12) || 0);
    // 與使用月曆相同的「標籤＋數字」排版（ck-parts/ck-line），手機窄格也不壓線
    return `<span class="ck-parts ck-dparts${est ? " est" : ""}"><span class="ck-line"><i>9</i><b>${n9}</b></span><span class="ck-line"><i>12</i><b>${n12}</b></span></span>`;
  }
  function doughCell(k, dd) {
    const dow = parseKey(k).getDay(), redNum = (dow === 0 || dow === 6 || !!natHoliday(k));
    const numHtml = `<span class="day-number${redNum ? " ck-red" : ""}">${dd}</span>`;
    if (isClosed(k)) return `<div class="employee-cal-day ck-rest">${numHtml}<span class="ck-tag">${closedLabel(k)}</span></div>`;
    const sold = doughSold(k);   // 已有銷售(報表已上傳)
    let cls = "employee-cal-day ck-dcell", inner = numHtml;
    if (sold) {                                                                         // 有剩餘盤點→製作合計；沒有→只顯示賣出(灰)
      const made = doughMade(k);
      if (made) { cls += " available"; inner += doughTotals(made, false); }
      else { cls += " ck-dsold"; inner += doughTotals(sold, false); }
    }
    else if (k === todayKey()) {                                                        // 當天營業、尚無銷售 → 預估
      const p = predictDough(k); cls += " ck-today";
      inner += (doughSum(p.rec) > 0 ? doughTotals(p.rec, true) : `<span class="cd-empty">—</span>`);
    }                                                                                   // 其餘營業日：只留日期
    return `<button type="button" class="${cls}" data-date="${k}">${inner}</button>`;
  }
  let lastChickenMode = "use";
  function setCalMode(mode) {
    calMode = mode;
    if (mode === "use" || mode === "order") lastChickenMode = mode;
    render();
  }
  // 第一層分類：雞肉管理(使用/訂購)↔ 餅皮管理(餅皮月曆)
  function setCalCat(cat) {
    calMode = (cat === "dough") ? "dough" : lastChickenMode;
    render();
  }
  // 依目前 calMode 顯示／隱藏：分類切換、子切換(使用/訂購)、兩個推估提示、庫存條
  function applyCalChrome() {
    const dough = (calMode === "dough");
    const setDisp = (id, show) => { const el = $(id); if (el) el.style.display = show ? "" : "none"; };
    setDisp("ckCalSwitch", !dough);
    setDisp("ckHint", !dough);
    setDisp("ckDoughBtn", dough);
    setDisp("ckStockTop", !dough);
    document.querySelectorAll("#ckCatSwitch button").forEach((b) => b.classList.toggle("on", (b.dataset.cat === "dough") === dough));
    document.querySelectorAll("#ckCalSwitch button").forEach((b) => b.classList.toggle("on", b.dataset.mode === calMode));
  }

  /* ---------- 共用：部位三格、明細表 ---------- */
  function statTiles(p) {
    return `<div class="ck-parts-grid">
      <div class="ck-stat leg"><span>🍗 雞腿</span><strong>${p.leg}</strong></div>
      <div class="ck-stat fil"><span>🥩 雞排</span><strong>${p.fil}</strong></div>
      <div class="ck-stat wing"><span>🪽 雞翅</span><strong>${p.wing}</strong></div></div>`;
  }
  // map：這天上傳當下用的對照表(凍結歷史)；沒存的舊資料回退 DEFAULT_MAP(當時對照表尚不可編輯)。合計用已存的 parts，不即時重算。
  function itemTable(sales, parts, map) {
    const mp = map || DEFAULT_MAP;
    const labels = Object.keys(sales).sort((a, b) => { const ia = ITEM_ORDER.indexOf(a), ib = ITEM_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    let rows = "";
    labels.forEach((l) => {
      const u = mp[pieceOfLabel(l)] || emptyParts(), q = sales[l];
      const meal = l.includes("2塊") ? `<small style="color:var(--muted)">(套餐)</small>` : "";
      rows += `<tr><td>${l}${meal}</td><td>${q}</td><td>${q * u.leg}</td><td>${q * u.fil}</td><td>${q * u.wing}</td></tr>`;
    });
    const t = parts || emptyParts();
    rows += `<tr class="sum"><td>合計</td><td>—</td><td>${t.leg}</td><td>${t.fil}</td><td>${t.wing}</td></tr>`;
    return `<table class="ck-items"><thead><tr><th>品項</th><th>數量</th><th>腿</th><th>排</th><th>翅</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // 上傳後顯示的全店摘要(營業額＋比薩數量＋餅皮四類)
  function summaryLine(s, d) {
    if (!s) return "";
    const p9 = s.pizza9 || 0, p12 = s.pizza12 || 0;
    const avg9 = p9 ? Math.round((s.pizza9amt || 0) / p9) : 0, avg12 = p12 ? Math.round((s.pizza12amt || 0) / p12) : 0;
    const dough = d ? `　🍕 餅皮 9吋 厚${d.t9 || 0}/薄${d.s9 || 0}・12吋 厚${d.t12 || 0}/薄${d.s12 || 0}` : "";
    return `<div class="ck-sumline">💰 全店營業額 <b>$${(s.total || 0).toLocaleString()}</b>　🍕 9吋 <b>${p9}</b>(均價 $${avg9})・12吋 <b>${p12}</b>(均價 $${avg12})${dough}</div>`;
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
          summaryLine(res.summary, res.dough) +
          itemTable(res.sales, res.parts, partMap) +
          `<div class="ck-saved">✓ 已儲存到雲端(${res.date} 覆蓋更新)・共 ${Object.keys(res.sales).length} 個雞肉品項</div>` +
          `<div class="modal-actions"><button class="ghost-btn" id="uploadAgain">再上傳別天</button><button class="primary-btn" id="uploadDone">完成</button></div>`;
        $("uploadAgain").onclick = openUpload;
        $("uploadDone").onclick = () => hide("uploadBackdrop");
      });
    };
    reader.readAsArrayBuffer(file);
  }
  // 目前對照表是否已自訂(與預設不同)→ 只有自訂時才需要逐日存 map，省資料
  function mapIsCustom() { return PIECES.some((pc) => ["leg", "fil", "wing"].some((k) => (partMap[pc] || {})[k] !== DEFAULT_MAP[pc][k])); }
  function saveSales(res, done) {
    if (!db) { done && done(); return; }
    const ym = ymOf(res.date);
    // 只有自訂對照表才存當天 map；用預設時不存(並清掉可能殘留的舊 map)
    const dayRec = { sales: res.sales, parts: res.parts, uploadedAt: Date.now() };
    dayRec.map = mapIsCustom() ? JSON.parse(JSON.stringify(partMap)) : firebase.firestore.FieldValue.delete();
    if (res.summary) dayRec.summary = res.summary;   // 全店營業額＋9吋/12吋比薩數量・金額
    if (res.dough) dayRec.dough = res.dough;         // 餅皮四類實際賣出(9厚/9薄/12厚/12薄)
    monthRefOf(ym).set({ days: { [res.date]: dayRec }, updatedAt: Date.now() }, { merge: true })
      .then(() => { if (ym !== viewYM) watchMonth(ym); done && done(); })
      .catch((err) => { console.error(err); $("uploadResult").innerHTML += `<div class="ck-err">⚠ 儲存失敗：${err.message || err}</div>`; });
  }

  /* ---------- 記錄叫貨(叫貨單：批發商＋到貨日＋使用日＋狀態流程) ---------- */
  const numsHTML = (o) => `<i>腿</i><b class="ck-leg">${o.leg}</b> <i>排</i><b class="ck-fil">${o.fil}</b> <i>翅</i><b class="ck-wing">${o.wing}</b>`;
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return toKey(d); };
  const STATUS_LABEL = { draft: "待訂購", ordered: "已訂購", arrived: "已到貨" };
  const STATUS_CLS = { draft: "st-wait", ordered: "st-sent", arrived: "st-arr" };
  function orderStatus(o) { if (!o) return null; if (o.status === "ordered") return (o.deliveryDay && o.deliveryDay <= todayKey()) ? "arrived" : "ordered"; return "draft"; }
  const orderRefOf = (ym) => db.collection(COLL).doc("poultry_order_" + ym);
  const orderForDay = (od) => orderDays[od] || null;
  function watchOrderMonths() {
    orderUnsubs.forEach((u) => u && u()); orderUnsubs = []; orderMonthData = {};
    if (!db) return;
    const tm = ymOf(todayKey());
    [addMonthYM(tm, 1), tm, addMonthYM(tm, -1), addMonthYM(tm, -2)].forEach((ym) => {
      const u = orderRefOf(ym).onSnapshot((snap) => {
        const d = snap.data(); orderMonthData[ym] = (d && d.orders) || {};
        orderDays = {}; Object.values(orderMonthData).forEach((m) => Object.assign(orderDays, m));
        render(); refreshHint(); if (orderOpen() && orderForm) renderOrderForm();
      }, (err) => console.error("order snapshot", err));
      orderUnsubs.push(u);
    });
  }
  // 指定廠商的休息日(暫時套入推算引擎)
  function supplierOffOf(supId) { const s = suppliers.find((x) => x.id === supId) || defSupplier(); return { weekdays: s.weekdays, dates: s.dates }; }
  function withSupplierOff(off, fn) { const saved = supplierOff; supplierOff = off; try { return fn(); } finally { supplierOff = saved; } }
  // 到貨日選項：下單 +1/+2，需店家營業且該廠商有送貨
  function deliveryOptions(orderDay, supId) {
    return withSupplierOff(supplierOffOf(supId), () => {
      const out = [];
      [[1, "隔天"], [2, "後天"]].forEach(([n, lab]) => { const k = addDays(orderDay, n); if (!isClosed(k) && supplierOpen(k)) out.push({ key: k, label: `${mdw(k)}・${lab}` }); });
      return out;
    });
  }
  // 可選使用日：到貨隔天起(醃 1 天)、店家營業、下單日起 2 週內
  function candidateUseDays(orderDay, deliveryDay) {
    const out = [], end = addDays(orderDay, 14); let k = addDays(deliveryDay, 1);
    while (k <= end) { if (!isClosed(k)) out.push(k); k = addDays(k, 1); }
    return out;
  }
  // 依某廠商的休息日，用叫貨時程引擎算「預設」到貨日＋使用日(與批發商設定的推算一致)；這天不是該廠商的下單日 → null
  function engineDefaults(orderDay, supId) {
    return withSupplierOff(supplierOffOf(supId), () => {
      const uds = coveredUseDays(orderDay);
      return uds.length ? { del: deliveryDayFor(uds[0]), uds } : null;
    });
  }
  // 套用預設(僅預設，之後仍可自己改到貨日、使用日)；引擎算不出時退回「最近可到貨日＋其後 2 個營業日」
  function applyOrderDefaults(f) {
    const e = engineDefaults(f.orderDay, f.supplier);
    if (e) { f.deliveryDay = e.del; f.useDays = e.uds.slice(); }
    else {
      const dOpts = deliveryOptions(f.orderDay, f.supplier);
      f.deliveryDay = dOpts[0] ? dOpts[0].key : addDays(f.orderDay, 1);
      f.useDays = candidateUseDays(f.orderDay, f.deliveryDay).slice(0, 2);
    }
    f.useDays.forEach((u) => { if (!f.perDay[u]) { const p = predict(u); f.perDay[u] = (p.n && p.rec) ? Object.assign({}, p.rec) : { leg: 0, fil: 0, wing: 0 }; } });
    f.expanded = f.useDays[0] || null;
  }
  // 預設下單日：今天是下單日就用今天，否則抓最近的下單日
  function defaultOrderDay() { const t = todayKey(); if (coveredUseDays(t).length) return t; const u = nextCoveredUse(); return orderDayFor(u) || t; }
  function openOrderForm(orderDay, existing) {
    const od = orderDay || defaultOrderDay();
    if (!existing) existing = orderForDay(od);
    if (existing) {
      orderForm = { orderDay: od, supplier: existing.supplier || defaultSupplier, deliveryDay: existing.deliveryDay || addDays(od, 1), useDays: (existing.useDays || []).slice(), perDay: JSON.parse(JSON.stringify(existing.perDay || {})), deductStock: existing.deductStock != null && existing.deductStock !== false, kg: existing.orderKg ? Object.assign({}, existing.orderKg) : null, expanded: (existing.useDays || [])[0] || null, exists: true };
    } else {
      // 預設廠商這天不能下單(例如臨時休市)→ 改用第一家這天可下單的廠商
      let sup = defaultSupplier;
      if (!engineDefaults(od, sup)) { const alt = suppliers.find((x) => engineDefaults(od, x.id)); if (alt) sup = alt.id; }
      orderForm = { orderDay: od, supplier: sup, deliveryDay: null, useDays: [], perDay: {}, deductStock: true, kg: null, expanded: null, exists: false };
      applyOrderDefaults(orderForm);
    }
    renderOrderForm(); show("orderBackdrop");
  }
  function renderKgLabels() { PARTS3.forEach((p) => { const el = $(`lblKg${p}`); if (el) el.textContent = purCode(p); }); }
  function renderStock() {
    const el = $("stockLine"); if (!el) return;
    const s = currentStock();
    el.classList.remove("hidden");
    if (!s) { el.innerHTML = `📦 ⚠ ${STOCK_NONE_MSG}(本單不扣庫存)`; return; }
    el.innerHTML = `📦 目前庫存(${mdw(s.date)}${s.byName ? " " + s.byName : ""} 盤點)：<b class="ck-leg">腿${s.leg}</b> <b class="ck-fil">排${s.fil}</b> <b class="ck-wing">翅${s.wing}</b>`;
  }
  function recomputeUseDays() {
    const f = orderForm, cand = candidateUseDays(f.orderDay, f.deliveryDay);
    f.useDays = f.useDays.filter((u) => cand.includes(u));
    if (!f.useDays.length) f.useDays = cand.slice(0, 2);
    f.useDays.forEach((u) => { if (!f.perDay[u]) { const p = predict(u); f.perDay[u] = (p.n && p.rec) ? Object.assign({}, p.rec) : { leg: 0, fil: 0, wing: 0 }; } });
    if (!f.useDays.includes(f.expanded)) f.expanded = f.useDays[0] || null;
  }
  function orderTotals() {
    const f = orderForm, sum = { leg: 0, fil: 0, wing: 0 };
    f.useDays.forEach((u) => { const r = f.perDay[u] || {}; sum.leg += Number(r.leg) || 0; sum.fil += Number(r.fil) || 0; sum.wing += Number(r.wing) || 0; });
    const s = f.deductStock ? currentStock(f.orderDay) : null;
    const stock = s ? { leg: s.leg, fil: s.fil, wing: s.wing } : null;
    const net = stock ? { leg: Math.max(0, sum.leg - stock.leg), fil: Math.max(0, sum.fil - stock.fil), wing: Math.max(0, sum.wing - stock.wing) } : { leg: sum.leg, fil: sum.fil, wing: sum.wing };
    return { sum, stock, net, stockRec: s };
  }
  function renderOrderForm() {
    const f = orderForm; if (!f) return;
    const st = f.exists ? (orderStatus(orderForDay(f.orderDay)) || "draft") : "draft";
    f.locked = f.exists && (st === "ordered" || st === "arrived");   // 已訂購/已到貨：僅供檢視
    const chip = $("ordStatus"); if (chip) { chip.textContent = STATUS_LABEL[st]; chip.className = "ord-status " + STATUS_CLS[st]; }
    // 選的廠商這天不是它的下單日(例如臨時休市)→ 提醒到貨日、使用日只是參考，請自行確認
    const hs = $("ordHeadSub"), supObj = suppliers.find((x) => x.id === f.supplier);
    if (hs) { const warn = !f.locked && !engineDefaults(f.orderDay, f.supplier); hs.textContent = warn ? `⚠ ${supObj ? supObj.name : "此廠商"}這天休息或無法隔天送達，到貨日、使用日請自行確認` : ""; hs.classList.toggle("ord-warn", warn); }
    const od = $("ordOrderDay"); if (od) od.textContent = mdw(f.orderDay);
    $("ordSupplier").innerHTML = suppliers.map((s) => `<option value="${s.id}"${s.id === f.supplier ? " selected" : ""}>${esc(s.name)}</option>`).join("");
    const dOpts = deliveryOptions(f.orderDay, f.supplier);
    if (!f.locked && !dOpts.some((o) => o.key === f.deliveryDay)) { f.deliveryDay = dOpts[0] ? dOpts[0].key : addDays(f.orderDay, 1); recomputeUseDays(); }
    $("ordDelivery").innerHTML = (dOpts.length ? dOpts : [{ key: f.deliveryDay, label: mdw(f.deliveryDay) }]).map((o) => `<option value="${o.key}"${o.key === f.deliveryDay ? " selected" : ""}>${o.label}</option>`).join("");
    $("ordUseBtn").innerHTML = f.useDays.length ? `${f.useDays.map((u) => mdw(u)).join("、")}　<span class="cnt">${f.useDays.length} 天</span>` : "請選使用日 ▾";
    // 鎖定：停用所有輸入、換掉底部按鈕
    $("ordSupplier").disabled = f.locked; $("ordDelivery").disabled = f.locked; $("ordUseBtn").disabled = f.locked;
    PARTS3.forEach((p) => { const el = $(`orderKg${p}`); if (el) el.disabled = f.locked; });
    const lb = $("ordLockBanner"); if (lb) lb.classList.toggle("hidden", !f.locked);
    const acts = $("ordActions"); if (acts) acts.classList.toggle("hidden", f.locked);
    const delBtn = $("ordDeleteBtn"); if (delBtn) delBtn.classList.toggle("hidden", !f.exists || f.locked);
    const closeBtn = $("ordCloseBtn"); if (closeBtn) closeBtn.classList.toggle("hidden", !f.locked);
    renderOrderRows();
    renderOrderSum();
    renderKgLabels();
  }
  // 日型標籤(顯示用)：平日／週五／週六／週日／國定假日／公休
  function dayTypeLabel(k) {
    if (isClosed(k)) return "公休";
    if (natHoliday(k)) return "國定假日";
    const d = parseKey(k).getDay();
    return d === 0 ? "週日" : d === 6 ? "週六" : d === 5 ? "週五" : "平日";
  }
  function refLine(tag, pill, o, fillKey) {
    return `<div class="oref-row"><span class="oref-tag">${tag}${pill ? `<span class="oref-pill">${pill}</span>` : ""}</span><span class="oref-n">${numsHTML(o)}</span><button type="button" class="oref-fill" data-fill="${fillKey}">帶入</button></div>`;
  }
  function renderOrderRows() {
    const f = orderForm, box = $("ordRows"); if (!box) return;
    box.innerHTML = f.useDays.map((u, idx) => {
      const r = f.perDay[u] || { leg: 0, fil: 0, wing: 0 };
      const open = f.expanded === u, p = predict(u), last = lastSameTypeOrder(u);
      let exp = "";
      if (open) {
        let rows = "";
        if (p.n && p.rec) rows += refLine("📊 平均銷售", dayTypeLabel(u), p.rec, `sug:${u}`);
        else rows += `<div class="oref-empty">📊 平均銷售：${dayTypeLabel(u)}・資料累積中</div>`;
        if (last) rows += refLine(`🕑 上次 ${mdw(last.date)}`, "", last.order, `last:${u}`);
        exp = `<div class="oref">${rows}</div>`;
      }
      const dis = f.locked ? " disabled" : "";
      return `<div class="od-row${open ? " open" : ""}">
        <div class="od-main">
          <button type="button" class="od-rhd" data-exp="${u}"><span class="od-ar">${open ? "⌃" : "⌄"}</span>${mdw(u)}<span class="od-dow">${dayTypeLabel(u)}</span>${idx === 0 ? '<span class="od-first">第一天</span>' : ""}</button>
          <input class="input od-in ck-leg" inputmode="numeric" data-pd="${u}" data-k="leg" value="${r.leg}"${dis}>
          <input class="input od-in ck-fil" inputmode="numeric" data-pd="${u}" data-k="fil" value="${r.fil}"${dis}>
          <input class="input od-in ck-wing" inputmode="numeric" data-pd="${u}" data-k="wing" value="${r.wing}"${dis}>
        </div>
        ${exp}
      </div>`;
    }).join("");
    box.querySelectorAll("button[data-exp]").forEach((b) => b.onclick = () => { f.expanded = (f.expanded === b.dataset.exp) ? null : b.dataset.exp; renderOrderRows(); });
    if (f.locked) return;
    box.querySelectorAll("input[data-pd]").forEach((inp) => inp.oninput = () => { const u = inp.dataset.pd; (f.perDay[u] = f.perDay[u] || { leg: 0, fil: 0, wing: 0 })[inp.dataset.k] = Number(inp.value) || 0; f.kg = null; renderOrderSum(); });
    box.querySelectorAll("button[data-fill]").forEach((b) => b.onclick = () => { const [kind, u] = b.dataset.fill.split(":"); const p = predict(u), last = lastSameTypeOrder(u); const src = kind === "sug" ? (p.rec || {}) : (last ? last.order : {}); f.perDay[u] = { leg: src.leg || 0, fil: src.fil || 0, wing: src.wing || 0 }; f.kg = null; renderOrderRows(); renderOrderSum(); });
  }
  function renderOrderSum() {
    const f = orderForm, { sum, net } = orderTotals(), s = currentStock(f.orderDay);
    let html = `<div class="os-row os-sum"><span class="os-k">合計需求(隻)</span><span class="os-c ck-leg">${sum.leg}</span><span class="os-c ck-fil">${sum.fil}</span><span class="os-c ck-wing">${sum.wing}</span></div>`;
    if (s) html += `<div class="os-row os-stk"><span class="os-k"><label class="os-ck"><input type="checkbox" id="ordDeduct"${f.deductStock ? " checked" : ""}${f.locked ? " disabled" : ""}> 扣除目前庫存</label></span>` + (f.deductStock ? `<span class="os-c">−${s.leg}</span><span class="os-c">−${s.fil}</span><span class="os-c">−${s.wing}</span>` : `<span class="os-c ck-muted">—</span><span class="os-c ck-muted">—</span><span class="os-c ck-muted">—</span>`) + `</div>`;
    else html += `<div class="os-row os-stk os-nostk"><span class="os-k">扣除目前庫存</span><span class="os-c ck-muted">—</span><span class="os-c ck-muted">—</span><span class="os-c ck-muted">—</span></div>`;
    html += `<div class="os-row os-net"><span class="os-k">最終訂購量(隻)</span><span class="os-c ck-leg">${net.leg}</span><span class="os-c ck-fil">${net.fil}</span><span class="os-c ck-wing">${net.wing}</span></div>`;
    $("ordSumTbl").innerHTML = html;
    const dc = $("ordDeduct"); if (dc) dc.onchange = () => { f.deductStock = dc.checked; f.kg = null; renderOrderSum(); };
    $("ordStockNote").textContent = s ? (f.deductStock ? `庫存只在「第一個使用日」扣(${mdw(s.date)} 盤點)；可取消勾選` : "") : `⚠ ${STOCK_NONE_MSG}，本單不扣庫存(不當作 0)。`;
    if (!f.kg) PARTS3.forEach((p) => { $(`orderKg${p}`).value = net[p] > 0 ? kgSuggest(net[p], p) : 0; });
    else PARTS3.forEach((p) => { $(`orderKg${p}`).value = f.kg[p] != null ? f.kg[p] : 0; });
  }
  function saveOrderForm(confirmed) {
    const f = orderForm; if (!f || f.locked) return;
    if (!f.useDays.length) { alert("請選擇至少一個使用日"); return; }
    if (!db) { hide("orderBackdrop"); return; }
    const { net, stockRec } = orderTotals();
    const kg = { leg: Number($("orderKgleg").value) || 0, fil: Number($("orderKgfil").value) || 0, wing: Number($("orderKgwing").value) || 0 };
    const sup = suppliers.find((s) => s.id === f.supplier) || defSupplier();
    const perDay = {}; f.useDays.forEach((u) => { const r = f.perDay[u] || {}; perDay[u] = { leg: Number(r.leg) || 0, fil: Number(r.fil) || 0, wing: Number(r.wing) || 0 }; });
    const ordYm = ymOf(f.orderDay), prev = orderForDay(f.orderDay);
    const order = { supplier: f.supplier, supplierName: sup.name, orderDay: f.orderDay, deliveryDay: f.deliveryDay, useDays: f.useDays.slice(), perDay: perDay, deductStock: (f.deductStock && stockRec) ? { leg: stockRec.leg, fil: stockRec.fil, wing: stockRec.wing } : null, totalPieces: net, orderKg: kg, status: confirmed ? "ordered" : "draft", createdAt: (prev && prev.createdAt) || Date.now(), updatedAt: Date.now() };
    if (confirmed) order.orderedAt = Date.now();
    const DEL = firebase.firestore.FieldValue.delete();
    const writes = [{ ref: orderRefOf(ordYm), data: { orders: { [f.orderDay]: order }, updatedAt: Date.now() } }];
    const dayPatch = {}, put = (ym, day, obj) => { (dayPatch[ym] = dayPatch[ym] || {})[day] = obj; };
    f.useDays.forEach((u) => put(ymOf(u), u, { order: perDay[u], orderKg: kg, supplyRef: { ym: ordYm, od: f.orderDay } }));
    if (prev && Array.isArray(prev.useDays)) prev.useDays.filter((u) => !f.useDays.includes(u)).forEach((u) => put(ymOf(u), u, { order: DEL, orderKg: DEL, supplyRef: DEL }));
    Object.keys(dayPatch).forEach((ym) => writes.push({ ref: monthRefOf(ym), data: { days: dayPatch[ym], updatedAt: Date.now() } }));
    Promise.all(writes.map((w) => w.ref.set(w.data, { merge: true })))
      .then(() => { hide("orderBackdrop"); Object.keys(dayPatch).forEach((ym) => { if (ym !== viewYM) watchMonth(viewYM); }); })
      .catch((err) => { console.error(err); alert("儲存失敗：" + (err.message || err)); });
  }
  function deleteOrderForm() {
    const f = orderForm; if (!f || f.locked || !db) { hide("orderBackdrop"); return; }
    const prev = orderForDay(f.orderDay); if (!prev) { hide("orderBackdrop"); return; }
    if (!window.confirm("確定刪除這張訂單？涵蓋的使用日訂購紀錄也會一併清除。")) return;
    const ordYm = ymOf(f.orderDay), DEL = firebase.firestore.FieldValue.delete();
    const writes = [{ ref: orderRefOf(ordYm), data: { orders: { [f.orderDay]: DEL }, updatedAt: Date.now() } }];
    const dayPatch = {};
    (prev.useDays || []).forEach((u) => { (dayPatch[ymOf(u)] = dayPatch[ymOf(u)] || {})[u] = { order: DEL, orderKg: DEL, supplyRef: DEL }; });
    Object.keys(dayPatch).forEach((ym) => writes.push({ ref: monthRefOf(ym), data: { days: dayPatch[ym], updatedAt: Date.now() } }));
    Promise.all(writes.map((w) => w.ref.set(w.data, { merge: true }))).then(() => hide("orderBackdrop")).catch((e) => { console.error(e); alert("刪除失敗：" + (e.message || e)); });
  }
  /* 使用日多選面板 */
  function openUsePicker() {
    if (orderForm && orderForm.locked) return;
    const f = orderForm, cand = candidateUseDays(f.orderDay, f.deliveryDay), box = $("useDayList");
    box.innerHTML = cand.length ? cand.map((u) => { const on = f.useDays.includes(u); return `<label class="ud-opt${on ? " on" : ""}"><input type="checkbox" data-ud="${u}"${on ? " checked" : ""}><span class="ud-box"></span><span class="ud-d">${mdw(u)}</span></label>`; }).join("") : `<div class="sup-empty">沒有可選的使用日。</div>`;
    const sync = () => {
      const chosen = Array.from(box.querySelectorAll("input[data-ud]:checked")).map((i) => i.dataset.ud);
      $("useDayCnt").textContent = chosen.length;
      box.querySelectorAll("input[data-ud]").forEach((i) => { const over = chosen.length >= 4 && !i.checked; i.disabled = over; const lab = i.closest(".ud-opt"); lab.classList.toggle("off", over); lab.classList.toggle("on", i.checked); });
    };
    box.querySelectorAll("input[data-ud]").forEach((i) => i.onchange = sync);
    sync(); show("useDayBackdrop");
  }
  function confirmUsePicker() {
    const chosen = Array.from($("useDayList").querySelectorAll("input[data-ud]:checked")).map((i) => i.dataset.ud).sort();
    const f = orderForm; f.useDays = chosen.slice(0, 4);
    f.useDays.forEach((u) => { if (!f.perDay[u]) { const p = predict(u); f.perDay[u] = (p.n && p.rec) ? Object.assign({}, p.rec) : { leg: 0, fil: 0, wing: 0 }; } });
    if (!f.useDays.includes(f.expanded)) f.expanded = f.useDays[0] || null;
    f.kg = null; hide("useDayBackdrop"); renderOrderForm();
  }

  /* ---------- 點某天：明細／對比 ---------- */
  function cell(obj, k) { return obj ? `<td>${obj[k]}</td>` : `<td class="ck-muted">—</td>`; }
  function diffCell(v) { const c = v < 0 ? "var(--danger)" : v > 0 ? "var(--ok)" : "var(--muted)"; return `<td style="color:${c};font-weight:800">${v > 0 ? "+" : ""}${v}</td>`; }
  function openDetail(k) {
    const rec = days[k] || {};
    const hasSales = !!(rec.sales && Object.keys(rec.sales).length && rec.parts);
    const o = rec.order || null, u = hasSales ? rec.parts : null;
    const p = predict(k), est = (p.n && p.rec) ? p.rec : null;
    const isBiz = !isClosed(k);
    $("detailTitle").textContent = fmtFull(k);
    let html = "";
    const nat = natHoliday(k);
    if (nat) html += `<div class="ck-holi-line">📌 國定假日：${nat}</div>`;
    if (isBiz && (est || o || u)) {
      html += `<div class="cmp-h">預估 vs 訂購 vs 實際賣</div>`;
      html += `<table class="ck-items" style="margin-bottom:6px"><thead><tr><th></th><th>🍗 腿</th><th>🥩 排</th><th>🪽 翅</th></tr></thead><tbody>`;
      html += `<tr><td>預估</td>${cell(est, "leg")}${cell(est, "fil")}${cell(est, "wing")}</tr>`;
      html += `<tr><td>訂購量</td>${cell(o, "leg")}${cell(o, "fil")}${cell(o, "wing")}</tr>`;
      html += `<tr><td>實際賣</td>${cell(u, "leg")}${cell(u, "fil")}${cell(u, "wing")}</tr>`;
      if (o && u) html += `<tr class="sum"><td>差額(叫−賣)</td>${diffCell(o.leg - u.leg)}${diffCell(o.fil - u.fil)}${diffCell(o.wing - u.wing)}</tr>`;
      html += `</tbody></table>`;
      // 供應來源：這天的貨來自哪一張叫貨單
      const sr = rec.supplyRef, so = sr ? orderForDay(sr.od) : null;
      if (sr) { const st = so ? orderStatus(so) : null; html += `<div class="ck-srcline">📦 這天的貨來自 <b>${mdw(sr.od)} 訂購</b>${st ? `(${STATUS_LABEL[st]})` : ""}<button type="button" class="ck-srcbtn" id="detailGoOrder">看這批 ›</button></div>`; }
      const kg = rec.orderKg;
      if (kg) html += `<div class="ck-kgline">📦 當天訂購公斤：${PARTS3.map((pp) => `${PART_EMO[pp]} ${kg[pp]}`).join("　")}(公斤)</div>`;
      if (!o) html += `<div class="hint" style="margin:-2px 2px 12px">這天尚未訂購。</div>`;
      else if (!u) html += `<div class="hint" style="margin:-2px 2px 12px">這天尚未上傳銷售，無法比對。</div>`;
      else html += `<div class="hint" style="margin:-2px 2px 12px">差額＝訂購量−實際賣：正＝有剩(可能浪費)、負＝不夠。</div>`;
    }
    if (hasSales) html += `<div class="cmp-h">當日銷售明細(換算消耗)</div>` + itemTable(rec.sales, rec.parts, rec.map);
    else if (isBiz) html += `<div class="empty-state">這天尚未上傳銷售。</div>`;
    $("detailBody").innerHTML = html;
    const go = $("detailGoOrder"); if (go) go.onclick = () => { hide("detailBackdrop"); const sr = rec.supplyRef; openOrderForm(sr ? sr.od : (orderDayFor(k) || k)); };
    $("detailEditOrder").onclick = () => { hide("detailBackdrop"); const sr = rec.supplyRef; openOrderForm(sr ? sr.od : (orderDayFor(k) || k)); };
    show("detailBackdrop");
  }

  /* ---------- PIN 閘門(與排班後台同一組) ---------- */
  function enterApp() { hide("pinGate"); show("app"); switchView("home"); }
  /* ---------- App Shell：四大頁切換 ---------- */
  const VIEWS = ["home", "calendar", "records", "settings"];
  function switchView(v) {
    if (!VIEWS.includes(v)) v = "home";
    VIEWS.forEach((k) => { const el = $("view" + k.charAt(0).toUpperCase() + k.slice(1)); if (el) el.classList.toggle("hidden", k !== v); });
    document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    if (v === "home") renderHome();
    else if (v === "records") openRecords();
    else if (v === "calendar") render();
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  /* ---------- 首頁：今日建議(訂購雞肉＋餅皮製作) ---------- */
  function renderHome() {
    const box = $("homeCards"); if (!box) return;
    let html = "";
    // 今天是否為下單日 → 訂購雞肉建議
    if (coveredUseDays(todayKey()).length) {
      const c = reminderOrderCalc();
      html += `<button type="button" class="today-card" data-home="order">
        <div class="tc-h"><span class="tc-ic">🍗</span><div class="tc-t"><b>訂購雞肉</b><small>${mdw(c.del)} 到貨 · 使用 ${c.uses.map(mdw).join("、") || "—"}</small></div><span class="tc-ar">›</span></div>
        <div class="tc-nums"><span><i>腿</i><b class="ck-leg">${c.net.leg}</b></span><span><i>排</i><b class="ck-fil">${c.net.fil}</b></span><span><i>翅</i><b class="ck-wing">${c.net.wing}</b></span></div>
      </button>`;
    } else {
      html += `<div class="today-card muted"><div class="tc-h"><span class="tc-ic">🍗</span><div class="tc-t"><b>訂購雞肉</b><small>今天不是下單日</small></div></div></div>`;
    }
    // 餅皮製作(今天)
    const today = todayKey(), pd = predictDough(today);
    if (pd.group) {
      html += `<button type="button" class="today-card" data-home="dough">
        <div class="tc-h"><span class="tc-ic">🍕</span><div class="tc-t"><b>餅皮製作</b><small>${mdw(today)}</small></div><span class="tc-ar">›</span></div>
        <div class="tc-dough">9吋 厚<b>${pd.rec.t9}</b>／薄<b>${pd.rec.s9}</b> · 12吋 厚<b>${pd.rec.t12}</b>／薄<b>${pd.rec.s12}</b></div>
      </button>`;
    } else {
      html += `<div class="today-card muted"><div class="tc-h"><span class="tc-ic">🍕</span><div class="tc-t"><b>餅皮製作</b><small>今天公休</small></div></div></div>`;
    }
    box.innerHTML = html;
    const o = box.querySelector('[data-home="order"]'); if (o) o.onclick = () => openOrderForm(todayKey());
    const d = box.querySelector('[data-home="dough"]'); if (d) d.onclick = () => openDough();
  }
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

  /* ---------- 次營業日叫貨建議(第二階段) ---------- */
  function orderOpen() { return !$("orderBackdrop").classList.contains("hidden"); }
  function watchPredMonths() {
    predUnsubs.forEach((u) => u && u()); predUnsubs = []; predMonthData = {};
    if (!db) return;
    const tm = ymOf(todayKey());
    [tm, addMonthYM(tm, -1), addMonthYM(tm, -2)].forEach((ym) => {
      const u = monthRefOf(ym).onSnapshot((snap) => {
        const d = snap.data(); predMonthData[ym] = (d && d.days) || {};
        predDays = {}; Object.values(predMonthData).forEach((m) => Object.assign(predDays, m));
        refreshHint(); if (orderOpen()) renderOrderForm();
      }, (err) => console.error("pred snapshot", err));
      predUnsubs.push(u);
    });
  }
  // 員工端盤點庫存：訂閱本月＋前兩月(涵蓋「目前庫存」會用到的近期日)
  const stockRefOf = (ym) => db.collection(COLL).doc("poultry_stock_" + ym);
  function watchStockMonths() {
    stockUnsubs.forEach((u) => u && u()); stockUnsubs = []; stockDays = {};
    if (!db) return;
    const tm = ymOf(todayKey());
    [tm, addMonthYM(tm, -1), addMonthYM(tm, -2)].forEach((ym) => {
      const u = stockRefOf(ym).onSnapshot((snap) => {
        const d = snap.data(), days = (d && d.days) || {};
        Object.keys(days).forEach((k) => { stockDays[k] = days[k]; });
        renderStockTop();
        if (orderOpen()) renderOrderForm();
      }, (err) => console.error("stock snapshot", err));
      stockUnsubs.push(u);
    });
  }
  // 目前庫存＝今天(含)以前、最近一筆盤點(往下一個營業日累積顯示)
  // 最近 n 個營業日(含今天，若今天營業)：新→舊
  function recentBizDays(n, fromKey) {
    const out = [], d = parseKey(fromKey || todayKey());
    for (let i = 0; i < 90 && out.length < n; i++) { const k = toKey(d); if (!isClosed(k)) out.push(k); d.setDate(d.getDate() - 1); }
    return out;
  }
  // 目前庫存＝以 refDay(預設今天；訂購單用該單的下單日)往回「近 3 個營業日內」最新的剩餘雞肉紀錄；
  // 超過 3 營業日的舊紀錄不採用(回傳 null，不當成 0)
  function currentStock(refDay) {
    const t = refDay || todayKey(), win = recentBizDays(3, t);
    const cutoff = win.length ? win[win.length - 1] : t;   // 3 個營業日前(含)
    const keys = Object.keys(stockDays).filter((k) => k <= t && k >= cutoff && hasChickenRec(stockDays[k])).sort();
    if (!keys.length) return null;
    const k = keys[keys.length - 1], r = stockDays[k];
    return { date: k, leg: Number(r.leg) || 0, fil: Number(r.fil) || 0, wing: Number(r.wing) || 0, byName: r.byName || "" };
  }
  const STOCK_NONE_MSG = "未紀錄近 3 個營業日剩餘雞肉";
  const configRef = () => db.collection(COLL).doc("poultry_config");
  function applyConfig(d) {
    bufferFactor = (d && typeof d.bufferFactor === "number" && d.bufferFactor > 0) ? d.bufferFactor : 1.0;
    predWindow = (d && WINDOW_OPTIONS.includes(d.predWindow)) ? d.predWindow : 35;
    estMethod = (d && EST_METHODS.includes(d.estMethod)) ? d.estMethod : "avg";
    // 批發商清單：優先讀新版 suppliers；沒有就從舊版 supplierOff 遷移；再沒有就用預設
    suppliers = [];
    if (d && Array.isArray(d.suppliers) && d.suppliers.length) {
      d.suppliers.forEach((s) => { if (s && typeof s === "object") suppliers.push(cleanSupplier(s)); });
    }
    if (!suppliers.length) {
      if (d && d.supplierOff && typeof d.supplierOff === "object") {
        suppliers = [cleanSupplier({ id: "a", name: "A 廠商", weekdays: d.supplierOff.weekdays, dates: d.supplierOff.dates })];
      } else {
        suppliers = JSON.parse(JSON.stringify(DEFAULT_SUPPLIERS));
      }
    }
    defaultSupplier = (d && d.defaultSupplier && suppliers.some((s) => s.id === d.defaultSupplier)) ? d.defaultSupplier : suppliers[0].id;
    const def = defSupplier();
    supplierOff = { weekdays: def.weekdays.slice(), dates: def.dates.map((x) => ({ date: x.date, note: x.note })) };
    partMap = JSON.parse(JSON.stringify(DEFAULT_MAP));
    if (d && d.parts && typeof d.parts === "object") {
      PIECES.forEach((pc) => { const v = d.parts[pc]; if (v && typeof v === "object") partMap[pc] = { leg: Number(v.leg) || 0, fil: Number(v.fil) || 0, wing: Number(v.wing) || 0 }; });
    }
    purchase = JSON.parse(JSON.stringify(DEFAULT_PURCHASE));
    if (d && d.purchase && typeof d.purchase === "object") {
      PARTS3.forEach((p) => { const v = d.purchase[p]; if (v && typeof v === "object") purchase[p] = { code: String(v.code || DEFAULT_PURCHASE[p].code), g: Number(v.g) || DEFAULT_PURCHASE[p].g }; });
    }
    partsHistory = (d && Array.isArray(d.partsHistory)) ? d.partsHistory.slice().sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
    pizzaCfg = DC.normalizePizza(d && d.pizza);
    pizzaHistory = (d && Array.isArray(d.pizzaHistory)) ? d.pizzaHistory.slice().sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
  }
  // 餅皮推估的資料環境(交給共用核心 DoughCore 計算)
  const doughCtx = () => ({ reports: predDays, stock: stockDays, cfg: pizzaCfg, today: todayKey(), isClosed, natHoliday });
  const resolvePizza = (cfg) => DC.resolvePizza(cfg || pizzaCfg, doughCtx());
  const pizzaFloor = (cfg) => DC.pizzaFloor(cfg || pizzaCfg, doughCtx());
  const pizzaAuto = () => DC.autoStats(doughCtx());   // 近 4 週假日自動比例/均價
  const mapEq = (a, b) => PIECES.every((pc) => ["leg", "fil", "wing"].every((k) => ((a[pc] || {})[k] || 0) === ((b[pc] || {})[k] || 0)));
  function watchConfig() {
    if (!db) return;
    configUnsub = configRef().onSnapshot((snap) => {
      applyConfig(snap.data());
      render(); refreshHint(); if (orderOpen()) renderOrderForm();
    }, (err) => console.error("config snapshot", err));
  }
  /* ---------- 推估設定(緩衝倍率／回算天數／推估方式) ---------- */
  function openPredSet() {
    $("psBuffer").value = Number(bufferFactor).toFixed(2);   // 對應 1.00 / 1.05 / … / 1.30
    $("psWindow").value = String(predWindow);
    $("psMethod").value = estMethod;
    show("predBackdrop");
  }
  function savePredSet() {
    let buf = Number($("psBuffer").value) || 1.0; if (!(buf >= 1 && buf <= 1.3)) buf = 1.0;
    const win = WINDOW_OPTIONS.includes(Number($("psWindow").value)) ? Number($("psWindow").value) : 35;
    const m = EST_METHODS.includes($("psMethod").value) ? $("psMethod").value : "avg";
    bufferFactor = buf; predWindow = win; estMethod = m;
    hide("predBackdrop");
    render(); refreshHint(); if (orderOpen()) renderOrderForm();
    if (db) configRef().set({ bufferFactor: buf, predWindow: win, estMethod: m, updatedAt: Date.now() }, { merge: true }).catch((e) => { console.error(e); alert("儲存失敗：" + (e.message || e)); });
  }
  /* ---------- 批發商設定(可多家＋選預設) ---------- */
  let supDraft = null;  // { suppliers:[{id,name,weekdays,dates}], defaultId }
  const WD_NAMES = ["日", "一", "二", "三", "四", "五", "六"];
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  function openSupSet() {
    supDraft = { suppliers: suppliers.map(cleanSupplier), defaultId: defaultSupplier };
    if (!supDraft.suppliers.some((s) => s.id === supDraft.defaultId) && supDraft.suppliers[0]) supDraft.defaultId = supDraft.suppliers[0].id;
    renderSupList(); renderSupPrev();
    show("supBackdrop");
  }
  function supCardHTML(s) {
    const isDef = s.id === supDraft.defaultId, canDel = supDraft.suppliers.length > 1;
    const week = WD_NAMES.map((nm, i) => `<button type="button" class="wd${s.weekdays.includes(i) ? " off" : ""}" data-sw="${s.id}" data-w="${i}">${nm}${s.weekdays.includes(i) ? "✓" : ""}</button>`).join("");
    const ds = s.dates.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const dates = ds.length
      ? ds.map((x) => `<div class="sup-drow">${mdw(x.date)}${x.note ? " · " + esc(x.note) : ""}<button type="button" class="x" data-sd="${s.id}" data-d="${x.date}">✕</button></div>`).join("")
      : `<div class="sup-empty">目前沒有臨時休市日。</div>`;
    return `<div class="sup-card${isDef ? " def" : ""}" data-card="${s.id}">
      <div class="sup-chd">
        <input class="input sup-name" data-sn="${s.id}" value="${esc(s.name)}" placeholder="廠商名稱" autocomplete="off">
        ${isDef ? `<span class="sup-defbadge">預設</span>` : `<button type="button" class="sup-setdef" data-setdef="${s.id}">設為預設</button>`}
        ${canDel ? `<button type="button" class="sup-del" data-del="${s.id}" title="刪除廠商">🗑</button>` : ""}
      </div>
      <div class="sup-sub">每週固定休(點週幾切換休／送)</div>
      <div class="sup-week">${week}</div>
      <div class="sup-sub">臨時休市日(畜牧休市等)</div>
      <div class="sup-dlist">${dates}</div>
      <div class="sup-add">
        <input class="input" type="date" data-nd="${s.id}">
        <input class="input" data-nn="${s.id}" placeholder="原因(選填)" autocomplete="off">
        <button type="button" class="secondary-btn" data-add="${s.id}">＋ 新增</button>
      </div>
    </div>`;
  }
  function renderSupList() {
    const box = $("supList"); if (!box) return;
    box.innerHTML = supDraft.suppliers.map(supCardHTML).join("");
    const sup = (id) => supDraft.suppliers.find((x) => x.id === id);
    box.querySelectorAll("input[data-sn]").forEach((inp) => inp.oninput = () => { const s = sup(inp.dataset.sn); if (s) s.name = inp.value; });
    box.querySelectorAll("button[data-sw]").forEach((b) => b.onclick = () => { const s = sup(b.dataset.sw); if (!s) return; const w = Number(b.dataset.w), i = s.weekdays.indexOf(w); if (i >= 0) s.weekdays.splice(i, 1); else s.weekdays.push(w); renderSupList(); renderSupPrev(); });
    box.querySelectorAll("button[data-setdef]").forEach((b) => b.onclick = () => { supDraft.defaultId = b.dataset.setdef; renderSupList(); renderSupPrev(); });
    box.querySelectorAll("button[data-del]").forEach((b) => b.onclick = () => { if (supDraft.suppliers.length <= 1) return; supDraft.suppliers = supDraft.suppliers.filter((x) => x.id !== b.dataset.del); if (!sup(supDraft.defaultId)) supDraft.defaultId = supDraft.suppliers[0].id; renderSupList(); renderSupPrev(); });
    box.querySelectorAll("button[data-sd]").forEach((b) => b.onclick = () => { const s = sup(b.dataset.sd); if (!s) return; s.dates = s.dates.filter((x) => x.date !== b.dataset.d); renderSupList(); renderSupPrev(); });
    box.querySelectorAll("button[data-add]").forEach((b) => b.onclick = () => {
      const id = b.dataset.add, s = sup(id); if (!s) return;
      const card = box.querySelector(`[data-card="${id}"]`);
      const dt = card.querySelector(`input[data-nd="${id}"]`).value; if (!dt) { alert("請選日期"); return; }
      const nn = (card.querySelector(`input[data-nn="${id}"]`).value || "").trim();
      if (!s.dates.some((x) => x.date === dt)) s.dates.push({ date: dt, note: nn });
      renderSupList(); renderSupPrev();
    });
  }
  function addSupplier() {
    const used = supDraft.suppliers.map((s) => s.name);
    const name = ["A 廠商", "B 廠商", "C 廠商", "D 廠商"].find((n) => !used.includes(n)) || ("廠商" + (supDraft.suppliers.length + 1));
    supDraft.suppliers.push({ id: newSupId(), name: name, weekdays: [], dates: [] });
    renderSupList(); renderSupPrev();
  }
  function renderSupPrev() {
    const def = supDraft.suppliers.find((s) => s.id === supDraft.defaultId) || supDraft.suppliers[0];
    const saved = supplierOff; supplierOff = { weekdays: def.weekdays, dates: def.dates };  // 暫套「預設廠商」推算
    try {
      const t = parseKey(todayKey()), mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7));
      const lines = [], d = new Date(mon);
      for (let i = 0; i < 7; i++) { const k = toKey(d), u = coveredUseDays(k); if (u.length) lines.push(`${DOW[d.getDay()]}<b>→</b><span class="u">${u.map((x) => DOW[parseKey(x).getDay()]).join("＋")}</span>`); d.setDate(d.getDate() + 1); }
      $("supPrev").innerHTML = `<h4>📅 以預設廠商「${esc(def.name)}」推算：下單日 → 使用日</h4><div class="pl">${lines.length ? lines.join("　·　") : "(這週沒有可下單日)"}</div>`;
    } finally { supplierOff = saved; }
  }
  function saveSupSet() {
    supDraft.suppliers.forEach((s, i) => { if (!s.name.trim()) s.name = "廠商" + (i + 1); s.weekdays = s.weekdays.slice().sort((a, b) => a - b); });
    suppliers = supDraft.suppliers.map(cleanSupplier);
    defaultSupplier = suppliers.some((s) => s.id === supDraft.defaultId) ? supDraft.defaultId : suppliers[0].id;
    const def = defSupplier();
    supplierOff = { weekdays: def.weekdays.slice(), dates: def.dates.map((x) => ({ date: x.date, note: x.note })) };
    hide("supBackdrop");
    render(); refreshHint(); if (orderOpen()) renderOrderForm();
    if (db) configRef().set({ suppliers: suppliers, defaultSupplier: defaultSupplier, supplierOff: supplierOff, updatedAt: Date.now() }, { merge: true }).catch((e) => { console.error(e); alert("儲存失敗：" + (e.message || e)); });
  }
  // 找「上個同型日」已記錄的叫貨(目標日之前、同日型、最近一天)
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
  function refreshHint() {
    const el = $("ckHint"); if (!el) return;
    const today = todayKey(), uses = coveredUseDays(today);
    if (!uses.length) { el.innerHTML = `🛈 今天不是下單日(批發商休或不需訂購)；點這裡仍可手動訂購 ›`; return; }
    const k = uses[0], d = parseKey(k), p = predict(k);
    const more = uses.length > 1 ? `(另含 ${uses.slice(1).map((x) => mdw(x)).join("、")})` : "";
    const head = `🔮 推估建議：今天下單 → 使用 ${d.getMonth() + 1}/${pad(d.getDate())}(${DOW[d.getDay()]}${p.group ? "·" + p.group : ""})${more}`;
    if (!p.group) { el.innerHTML = `${head} ›`; return; }
    if (!p.n) { el.innerHTML = `${head} 資料累積中 ›`; return; }
    if (uses.length > 1) {
      // 多使用日：直接給本批合計(扣庫存後要叫)，不用自己加總
      const sum = { leg: 0, fil: 0, wing: 0 };
      uses.forEach((u) => { const pu = predict(u); if (pu.n && pu.rec) { sum.leg += pu.rec.leg; sum.fil += pu.rec.fil; sum.wing += pu.rec.wing; } });
      const s = currentStock();
      const t = s ? { leg: Math.max(0, sum.leg - s.leg), fil: Math.max(0, sum.fil - s.fil), wing: Math.max(0, sum.wing - s.wing) } : sum;
      el.innerHTML = `${head}　<b>本批合計要叫</b> <b class="ck-leg">腿 ${t.leg}</b>　<b class="ck-fil">排 ${t.fil}</b>　<b class="ck-wing">翅 ${t.wing}</b>${s ? "(已扣庫存)" : ""} ›`;
    } else {
      el.innerHTML = `${head} <b class="ck-leg">腿 ${p.rec.leg}</b>　<b class="ck-fil">排 ${p.rec.fil}</b>　<b class="ck-wing">翅 ${p.rec.wing}</b> ›`;
    }
  }

  /* ---------- 主畫面每日提醒(叫貨＋上傳，一天最多 2 次) ---------- */
  // 以「今天的下單日」預設邏輯算出要叫的量(與叫貨單開啟時的預設一致)
  function reminderOrderCalc() {
    const od = todayKey(), dOpts = deliveryOptions(od, defaultSupplier);
    const del = dOpts[0] ? dOpts[0].key : addDays(od, 1);
    const uses = candidateUseDays(od, del).slice(0, 2);
    const sum = { leg: 0, fil: 0, wing: 0 };
    uses.forEach((u) => { const p = predict(u); if (p.n && p.rec) { sum.leg += p.rec.leg; sum.fil += p.rec.fil; sum.wing += p.rec.wing; } });
    const s = currentStock(), stock = s ? { leg: s.leg, fil: s.fil, wing: s.wing } : null;
    const net = stock ? { leg: Math.max(0, sum.leg - stock.leg), fil: Math.max(0, sum.fil - stock.fil), wing: Math.max(0, sum.wing - stock.wing) } : { leg: sum.leg, fil: sum.fil, wing: sum.wing };
    const kg = { leg: kgSuggest(net.leg, "leg"), fil: kgSuggest(net.fil, "fil"), wing: kgSuggest(net.wing, "wing") };
    return { od, del, uses, sum, stock, net, kg };
  }
  function reminderState() {
    const td = todayKey();
    const ord = orderForDay(td);
    const needOrder = coveredUseDays(td).length > 0 && !(ord && ord.status === "ordered");
    const tgt = reportTarget();
    const rec = days[tgt.key] || {};
    const uploaded = !!(rec.sales && Object.keys(rec.sales).length);
    return { needOrder, needUpload: !uploaded, tgt };
  }
  function renderReminder(st) {
    let html = "";
    if (st.needOrder) {
      const c = reminderOrderCalc();
      const stockRow = c.stock ? `<div class="rc-row stk"><span class="rc-k">扣目前庫存</span><span class="rc-v"><i>腿</i>−${c.stock.leg} <i>排</i>−${c.stock.fil} <i>翅</i>−${c.stock.wing}</span></div>` : "";
      html += `<div class="rm-task order">
        <div class="rm-th"><span class="rm-tt">今天要訂購</span><span class="rm-pill wait">待訂購</span></div>
        <div class="rm-sub">${mdw(c.del)} 到貨 → 供 <b>${c.uses.map(mdw).join("・") || "—"}</b></div>
        <div class="rm-calc">
          <div class="rc-row"><span class="rc-k">估要用</span><span class="rc-v">${numsHTML(c.sum)}</span></div>
          ${stockRow}
          <div class="rc-row need"><span class="rc-k">要叫(隻)</span><span class="rc-v">${numsHTML(c.net)}</span></div>
          <div class="rc-row kg"><span class="rc-k">≈ 公斤</span><span class="rc-v">D5 <b>${c.kg.leg}</b>　TS4 <b>${c.kg.fil}</b>　W6 <b>${c.kg.wing}</b></span></div>
        </div>
        <button type="button" class="rm-btn" id="remindOrderBtn">查看每天明細・確認訂購 ›</button>
      </div>`;
    }
    if (st.needUpload) {
      html += `<div class="rm-task">
        <div class="rm-th"><span class="rm-tt">上傳銷售報表</span><span class="rm-pill wait">待上傳</span></div>
        <div class="rm-sub">${st.tgt.today ? "今天" : "昨天"} <b>${fmtReportDate(st.tgt.key)}</b> 的銷售還沒上傳，上傳後推估更準。</div>
        <button type="button" class="rm-btn ghost" id="remindUploadBtn">＋ 上傳銷售報表</button>
      </div>`;
    }
    $("remindBody").innerHTML = html;
    $("remindDate").textContent = mdw(todayKey());
    const ob = $("remindOrderBtn"); if (ob) ob.onclick = () => { hide("remindBackdrop"); openOrderForm(todayKey()); };
    const ub = $("remindUploadBtn"); if (ub) ub.onclick = () => { hide("remindBackdrop"); openUpload(); };
  }
  function maybeShowReminder() {
    if (!$("remindBackdrop")) return;
    const st = reminderState();
    if (!st.needOrder && !st.needUpload) return;
    const key = "ckRemind_" + todayKey();
    let cnt = 0; try { cnt = Number(localStorage.getItem(key)) || 0; } catch (e) {}
    if (cnt >= 2) return;                       // 一天最多自動跳 2 次(叫貨、上傳多為不同人不同時段)
    try { localStorage.setItem(key, String(cnt + 1)); } catch (e) {}
    renderReminder(st); show("remindBackdrop");
  }

  /* ---------- 匯出 CSV(選月份、每日彙總) ---------- */
  function csvEscape(v) { v = String(v == null ? "" : v); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
  function triggerDownload(blob, name) { const a = document.createElement("a"), url = URL.createObjectURL(blob); a.href = url; a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0); }
  function downloadCSV(name, rows) { const csv = "﻿" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n"); triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8;" }), name); }
  /* ---------- 盤點填寫紀錄(員工每天打烊填的剩餘) ---------- */
  const fmtAt = (ms) => { if (!ms) return ""; const d = new Date(ms); return `${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  // 雞肉／餅皮各自提交中繼(相容舊合併紀錄)
  function recChickenBy(r) { if (r && r.chicken && r.chicken.at) return r.chicken; if (r && r.at && (r.leg != null || r.fil != null || r.wing != null)) return { byName: r.byName, at: r.at }; return null; }
  function recDoughBy(r) { if (r && r.dough && r.dough.at) return r.dough; if (r && r.at && (r.t9 != null || r.s9 != null || r.t12 != null || r.s12 != null)) return { byName: r.byName, at: r.at }; return null; }
  // 某筆盤點是否有填該部分(只填雞肉或只填餅皮時，另一部分不能當成 0)
  const hasChickenRec = (r) => !!r && (r.leg != null || r.fil != null || r.wing != null);
  const hasDoughRec = (r) => !!r && (r.t9 != null || r.s9 != null || r.t12 != null || r.s12 != null);
  function openRecords() {
    const keys = Object.keys(stockDays).sort((a, b) => (a < b ? 1 : -1)), tbl = $("recordsTbl");
    if (!tbl) return;
    if (!keys.length) { tbl.innerHTML = `<tbody><tr><td class="rec-empty">目前還沒有盤點紀錄。</td></tr></tbody>`; return; }
    const head = `<thead><tr class="grp"><th rowspan="2">日期</th><th rowspan="2">填寫人・時間</th><th colspan="3" class="sep">🍗 剩餘雞肉</th><th colspan="4" class="sep">🍕 剩餘餅皮</th><th rowspan="2" class="sep">更正</th></tr><tr class="sub"><th class="sep">腿</th><th>排</th><th>翅</th><th class="sep">9厚</th><th>9薄</th><th>12厚</th><th>12薄</th></tr></thead>`;
    const v = (r, key, has) => has ? (Number(r[key]) || 0) : `<span class="ck-muted">—</span>`;
    const body = keys.map((k) => {
      const r = stockDays[k] || {}, d = parseKey(k), hc = hasChickenRec(r), hd = hasDoughRec(r);
      const cb = recChickenBy(r), dbm = recDoughBy(r);
      const same = cb && dbm && cb.byName === dbm.byName && cb.at === dbm.at;
      const who = same ? `<b>${esc(cb.byName || "？")}</b><span class="rf-t">${fmtAt(cb.at)}</span>`
        : `${cb ? `<span class="rf-l">🍗 <b>${esc(cb.byName || "？")}</b> <span class="rf-t">${fmtAt(cb.at)}</span></span>` : ""}${dbm ? `<span class="rf-l">🍕 <b>${esc(dbm.byName || "？")}</b> <span class="rf-t">${fmtAt(dbm.at)}</span></span>` : ""}` || "—";
      const eds = r.edits || [], nFix = eds.filter((e) => e.type !== "add").length;
      const edTag = (eds.some((e) => e.type === "add") ? `<span class="rec-edited">回填</span>` : "") + (nFix ? `<span class="rec-edited">已更正${nFix}</span>` : "");
      return `<tr><td class="rd">${d.getMonth() + 1}/${pad(d.getDate())}(${DOW[d.getDay()]})${edTag}</td><td class="rw">${who}</td><td class="sep rl">${v(r, "leg", hc)}</td><td class="rf">${v(r, "fil", hc)}</td><td class="rwg">${v(r, "wing", hc)}</td><td class="sep rp">${v(r, "t9", hd)}</td><td class="rp">${v(r, "s9", hd)}</td><td class="rp">${v(r, "t12", hd)}</td><td class="rp">${v(r, "s12", hd)}</td><td class="sep"><button type="button" class="rec-edit" data-edit="${k}">✏️</button></td></tr>`;
    }).join("");
    tbl.innerHTML = head + `<tbody>${body}</tbody>`;
    tbl.querySelectorAll("button[data-edit]").forEach((b) => b.onclick = () => openStockEdit(b.dataset.edit));
  }
  /* ---------- 管理者新增／更正盤點(PIN 閘門＝管理者權限；保留修改紀錄) ---------- */
  let stockEditKey = null, stockEditMode = "edit", stockEditRec = null, seLoadSeq = 0;
  const SE_CHK = [["seLeg", "leg"], ["seFil", "fil"], ["seWing", "wing"]];
  const SE_DGH = [["seT9", "t9"], ["seS9", "s9"], ["seT12", "t12"], ["seS12", "s12"]];
  // 套用某天的紀錄到表單：已填的部分固定勾選；沒填的部分可勾選「補填」
  function seApply(k, r) {
    stockEditKey = k; stockEditRec = r || null;
    const hc = hasChickenRec(r), hd = hasDoughRec(r), any = !!r && (hc || hd);
    [...SE_CHK, ...SE_DGH].forEach(([id, key]) => { const el = $(id); if (el) el.value = (r && r[key] != null ? r[key] : ""); });
    const setPart = (cbId, has) => { const cb = $(cbId); cb.checked = has || !any; cb.disabled = has; };
    setPart("seChkOn", hc); setPart("seDghOn", hd);
    const add = stockEditMode === "add";
    $("seTitle").textContent = add ? "新增盤點紀錄" : `更正盤點 · ${mdw(k)}`;
    $("seSub").textContent = add ? "回填員工漏填的剩餘量；會保留紀錄" : "管理者更正；會保留修改紀錄";
    const note = $("seNote"), closedTxt = isClosed(k) ? "這天是公休日。" : "";
    note.textContent = (add && any) ? `${mdw(k)} 已經有紀錄，儲存會變成「更正」(保留修改紀錄)。${closedTxt}` : closedTxt;
    note.classList.toggle("hidden", !note.textContent);
    $("seSave").textContent = any ? "儲存更正" : "新增紀錄";
    seSyncParts(); renderStockEditHist(r);
  }
  function seSyncParts() {
    [["seChkOn", SE_CHK, "seChkBox"], ["seDghOn", SE_DGH, "seDghBox"]].forEach(([cbId, list, boxId]) => {
      const on = $(cbId).checked;
      list.forEach(([id]) => { const el = $(id); el.disabled = !on; if (on && el.value === "") el.value = 0; if (!on) el.value = ""; });
      $(boxId).classList.toggle("se-off", !on);
    });
  }
  // 讀某天的紀錄(月份可能不在目前訂閱範圍 → 直接向雲端讀，避免覆蓋到看不到的舊紀錄)
  function seLoadDate(k) {
    const seq = ++seLoadSeq;
    if (stockDays[k] || !db) { seApply(k, stockDays[k] || null); return; }
    $("seSave").disabled = true;
    stockRefOf(ymOf(k)).get().then((snap) => {
      if (seq !== seLoadSeq) return;
      const days = (snap.data() && snap.data().days) || {};
      seApply(k, days[k] || null);
    }).catch((err) => { console.error(err); alert("讀取這天的紀錄失敗：" + (err.message || err)); })
      .finally(() => { if (seq === seLoadSeq) $("seSave").disabled = false; });
  }
  function openStockEdit(k) {
    stockEditMode = "edit"; $("seDateRow").classList.add("hidden");
    seApply(k, stockDays[k] || null);
    show("stockEditBackdrop");
  }
  function openStockAdd() {
    stockEditMode = "add";
    const di = $("seDate"), t = todayKey();
    di.max = t; di.value = t; $("seDateRow").classList.remove("hidden");
    seLoadDate(t);
    show("stockEditBackdrop");
  }
  function renderStockEditHist(r) {
    const box = $("seHist"); if (!box) return;
    const cb = recChickenBy(r), dbm = recDoughBy(r), ed = (r && r.edits) || [];
    const nv = (o, keys) => (o && keys.some((k) => o[k] != null)) ? keys.map((k) => o[k] != null ? o[k] : 0).join("/") : "—";
    let html = `<div class="se-orig">原始填寫：${cb ? `🍗 ${esc(cb.byName || "？")} ${fmtAt(cb.at)}　` : ""}${dbm ? `🍕 ${esc(dbm.byName || "？")} ${fmtAt(dbm.at)}` : ""}${(!cb && !dbm) ? "—" : ""}</div>`;
    if (ed.length) html += `<div class="se-hist-h">修改紀錄(${ed.length})</div>` + ed.slice().reverse().map((e) => `<div class="se-hist-row">${fmtAt(e.at)}　<b>${esc(e.byName || "管理者")}</b>${e.type === "add" ? " 新增" : ""}　🍗 ${nv(e.after, ["leg", "fil", "wing"])}・🍕 ${nv(e.after, ["t9", "s9", "t12", "s12"])}</div>`).join("");
    box.innerHTML = html;
  }
  function saveStockEdit() {
    const k = stockEditKey; if (!k) { hide("stockEditBackdrop"); return; }
    if (k > todayKey()) { alert("不能新增未來日期的盤點。"); return; }
    const onC = $("seChkOn").checked, onD = $("seDghOn").checked;
    if (!onC && !onD) { alert("請至少勾選雞肉或餅皮其中一項。"); return; }
    if (!db) { hide("stockEditBackdrop"); return; }
    const prev = stockEditRec || {}, hadC = hasChickenRec(prev), hadD = hasDoughRec(prev), had = hadC || hadD;
    const num = (id) => Math.max(0, Math.floor(Number($(id).value) || 0));
    const pick = (o, list, has) => { const x = {}; list.forEach(([, key]) => x[key] = has ? (Number(o[key]) || 0) : null); return x; };
    const after = Object.assign(onC ? Object.fromEntries(SE_CHK.map(([id, key]) => [key, num(id)])) : pick(prev, SE_CHK, hadC),
                                onD ? Object.fromEntries(SE_DGH.map(([id, key]) => [key, num(id)])) : pick(prev, SE_DGH, hadD));
    const before = Object.assign(pick(prev, SE_CHK, hadC), pick(prev, SE_DGH, hadD));
    if (had && JSON.stringify(after) === JSON.stringify(before)) { hide("stockEditBackdrop"); return; }
    const now = Date.now(), meta = { byName: "管理者(回填)", at: now, backfill: true };
    const patch = {};
    if (onC) SE_CHK.forEach(([, key]) => patch[key] = after[key]);
    if (onD) SE_DGH.forEach(([, key]) => patch[key] = after[key]);
    if (onC && !hadC) patch.chicken = meta;          // 新補填的部分記錄回填者
    if (onD && !hadD) patch.dough = meta;
    if (!had) { patch.byName = meta.byName; patch.at = now; }
    patch.edits = ((prev.edits) || []).concat({ at: now, byName: "管理者", type: had ? "edit" : "add", before, after });
    stockRefOf(ymOf(k)).set({ days: { [k]: patch }, updatedAt: now }, { merge: true })
      .then(() => { hide("stockEditBackdrop"); openRecords(); })
      .catch((err) => { console.error(err); alert("儲存失敗：" + (err.message || err)); });
  }
  function doRecordsExport() {
    const keys = Object.keys(stockDays).sort();
    if (!keys.length) { alert("目前沒有盤點紀錄可匯出。"); return; }
    const rows = [["日期", "星期", "填寫人", "填寫時間", "剩餘腿", "剩餘排", "剩餘翅", "餅皮9厚", "餅皮9薄", "餅皮12厚", "餅皮12薄"]];
    keys.forEach((k) => { const r = stockDays[k] || {}, d = parseKey(k);
      const c = hasChickenRec(r), g = hasDoughRec(r), v = (key, has) => has ? (Number(r[key]) || 0) : "";   // 沒填的部分留空(不當 0)
      rows.push([k, DOW[d.getDay()], r.byName || "", r.at ? fmtAt(r.at) : "", v("leg", c), v("fil", c), v("wing", c), v("t9", g), v("s9", g), v("t12", g), v("s12", g)]);
    });
    downloadCSV(`盤點紀錄_${todayKey()}.csv`, rows);
  }
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
      downloadCSV(`${settings.storeName || "備料預估"}_雞肉明細_${ym}.csv`, rows);
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
  // 設定版本紀錄(唯讀查看 ①份數對照＋②採購換算)；最底下永遠保留「系統預設值(最初)」
  function renderPmHist() {
    const box = $("pmHistList"); if (!box) return;
    const asc = partsHistory.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    let html = "";
    for (let i = asc.length - 1; i >= 0; i--) {
      const v = asc[i], latest = (i === asc.length - 1);
      html += `<button type="button" class="pm-ver" data-idx="${i}"><span class="d">${v.date.replace(/-/g, "/")} 起版本</span>${latest ? `<span class="now">目前版本</span>` : ""}<span class="arrow">›</span></button>`;
    }
    // 永遠保留的「系統預設值(最初)」
    const baseCurrent = (asc.length === 0);
    html += `<button type="button" class="pm-ver pm-ver-base" data-idx="-1"><span class="d">📦 系統預設值</span>${baseCurrent ? `<span class="now">目前使用中</span>` : `<span class="org">最初</span>`}<span class="arrow">›</span></button>`;
    box.innerHTML = html;
    box.querySelectorAll("button[data-idx]").forEach((b) => b.addEventListener("click", () => openPmVer(asc, Number(b.dataset.idx))));
  }
  function openPmVer(asc, i) {
    const base = (i < 0), ds = (x) => x.replace(/-/g, "/");
    const v = base ? { date: null, map: DEFAULT_MAP, purchase: DEFAULT_PURCHASE } : asc[i];
    const next = base ? null : asc[i + 1];
    $("pmVerTitle").textContent = base ? "系統預設值(最初)" : `設定版本 · ${ds(v.date)} 起`;
    $("pmVerRange").textContent = base
      ? (asc.length ? `系統最初的預設值，沿用到 ${ds(asc[0].date)} 第一次修改` : "系統預設值(目前使用中)")
      : (next ? `此版自 ${ds(v.date)} 起套用，到 ${ds(next.date)} 改版` : `此版自 ${ds(v.date)} 起套用(目前仍在使用)`);
    const pur = v.purchase || DEFAULT_PURCHASE;
    const mapRows = PIECES.map((pc) => { const u = v.map[pc] || { leg: 0, fil: 0, wing: 0 }; return `<tr><td>${PIECE_LABEL[pc]}</td><td>${u.leg}</td><td>${u.fil}</td><td>${u.wing}</td></tr>`; }).join("");
    const purRows = PARTS3.map((p) => { const u = pur[p] || DEFAULT_PURCHASE[p]; return `<tr><td>${PART_EMO[p]} ${PART_LABEL[p]}</td><td>${u.code}</td><td>${u.g} 克</td></tr>`; }).join("");
    $("pmVerBody").innerHTML =
      `<div class="pm-ver-sub">① 份數 → 部位</div><table class="pm"><thead><tr><th>品項</th><th>🍗 腿</th><th>🥩 排</th><th>🪽 翅</th></tr></thead><tbody>${mapRows}</tbody></table>` +
      `<div class="pm-ver-sub">② 採購換算</div><table class="pm"><thead><tr><th>部位</th><th>代號</th><th>每支約</th></tr></thead><tbody>${purRows}</tbody></table>`;
    show("pmVerBackdrop");
  }

  /* ---------- 比薩參數設定(只有最低營業額手動；其餘比例/均價自動＋可進階覆寫；有版本紀錄) ---------- */
  const clampPct = (v, dflt) => { let n = Number(v); if (!isFinite(n)) n = dflt; return Math.min(100, Math.max(0, Math.round(n))); };
  // 可覆寫欄位(進階區)：key、單位、對應的自動估算來源
  const PZ_FIELDS = [
    { key: "pizzaShare", kind: "pct", label: "比薩佔全店" },
    { key: "share9", kind: "pct", label: "9吋佔比薩" },
    { key: "avg9", kind: "price", label: "9吋均價" },
    { key: "avg12", kind: "price", label: "12吋均價" },
    { key: "thick9", kind: "pct", label: "9吋厚片" },
    { key: "thick12", kind: "pct", label: "12吋厚片" },
  ];
  // 餅皮推估參考「近幾次同星期」(預設 2，限 1~8)
  const samplesOf = DC.samplesOf;
  const pzAutoOf = (c, key) => (c[key + "Auto"] === undefined ? true : !!c[key + "Auto"]);
  const pzLive = pizzaAuto;
  // 只比較「有意義」的差異：最低營業額、各欄位自動旗標；手動欄位才比數值(自動欄位數值只是備援，不算變更)
  function pizzaEq(a, b) {
    if (Number(a.minRevenue) !== Number(b.minRevenue)) return false;
    if (samplesOf(a) !== samplesOf(b)) return false;
    for (const f of PZ_FIELDS) {
      if (pzAutoOf(a, f.key) !== pzAutoOf(b, f.key)) return false;
      if (!pzAutoOf(a, f.key) && Number(a[f.key]) !== Number(b[f.key])) return false;
    }
    return true;
  }
  function fillPizzaInputs(c) {
    $("pz_minRev").value = c.minRevenue;
    $("pz_samples").value = samplesOf(c);
    PZ_FIELDS.forEach((f) => { $(`pz_${f.key}`).value = c[f.key]; $(`pz_${f.key}Auto`).checked = pzAutoOf(c, f.key); });
    syncPizzaAuto();
  }
  function readPizzaInputs() {
    const o = { minRevenue: Math.max(0, Number($("pz_minRev").value) || 0), doughSamples: samplesOf({ doughSamples: $("pz_samples").value }) };
    PZ_FIELDS.forEach((f) => {
      o[f.key] = f.kind === "pct" ? clampPct($(`pz_${f.key}`).value, DEFAULT_PIZZA[f.key]) : Math.max(0, Number($(`pz_${f.key}`).value) || 0);
      o[f.key + "Auto"] = $(`pz_${f.key}Auto`).checked;
    });
    return o;
  }
  // 勾「自動」時：欄位變灰、填入近期報表算出的值、hint 說明；取消勾選則可手動覆寫
  function syncPizzaAuto() {
    const live = pzLive();
    PZ_FIELDS.forEach((f) => {
      const auto = $(`pz_${f.key}Auto`).checked, inp = $(`pz_${f.key}`), hint = $(`pz_${f.key}_hint`), v = live[f.key];
      inp.disabled = auto; inp.classList.toggle("pz-auto", auto);
      if (auto && v != null && v > 0) inp.value = v;
      if (hint) { const u = f.kind === "price" ? "$" : "", s = f.kind === "pct" ? "%" : ""; hint.textContent = auto ? ((v != null && v > 0) ? `自動：近 4 週假日 ${u}${v}${s}` : "自動：近 4 週假日資料不足，暫用上方數字") : "手動覆寫中"; }
    });
    renderPizzaSummary(); renderPizzaPrev();
  }
  // 目前「生效」的比例(自動以近期報表計算的結果)，唯讀顯示讓業主核對
  function renderPizzaSummary() {
    const el = $("pzAutoSummary"); if (!el) return;
    const r = resolvePizza(readPizzaInputs()), a = pizzaAuto(), md = (k) => k.slice(5).replace("-", "/");
    const basis = a.enough ? `依近 4 週假日 <b>${a.n}</b> 天(${md(a.from)}～${md(a.to)})的報表計算`
      : `近 4 週假日只有 ${a.n} 天有報表(需 ${a.minDays} 天以上)，自動欄位暫用存檔數字`;
    el.innerHTML = `目前生效比例・${basis}<br>比薩佔全店 <b>${r.pizzaShare}%</b>　·　9吋/12吋 <b>${r.share9}/${100 - r.share9}%</b>　·　厚片 9吋 <b>${r.thick9}%</b>／12吋 <b>${r.thick12}%</b>　·　均價 <b>$${Math.round(r.avg9)}/$${Math.round(r.avg12)}</b>`;
  }
  function renderPizzaPrev() {
    const el = $("pzPrev"); if (!el) return;
    const c = readPizzaInputs(), f = pizzaFloor(c);
    el.innerHTML = `<h4>🍕 以此參數反推「六日／假日最少要備」</h4>
      <div class="pzp-line">目標營業額 <b>$${(c.minRevenue).toLocaleString()}</b> × 比薩 ${f.pizzaShare}% ＝ 比薩 <b>$${f.rev.toLocaleString()}</b></div>
      <div class="pzp-line">9吋 ${f.share9}%÷$${f.a9} ≈ <b>${f.n9}</b> 個　·　12吋 ${100 - f.share9}%÷$${f.a12} ≈ <b>${f.n12}</b> 個</div>
      <div class="pzp-grid">${DOUGH_TYPES.map((t) => `<div class="pzp-cell"><span>${DOUGH_LABEL[t]}</span><b>${f[t]}</b></div>`).join("")}</div>`;
  }
  function openPizza() { fillPizzaInputs(pizzaCfg); renderPzHist(); const adv = $("pzAdv"); if (adv) adv.open = false; show("pizzaBackdrop"); }
  function savePizza() {
    const c = readPizzaInputs();
    if (pizzaEq(c, pizzaCfg)) { hide("pizzaBackdrop"); return; }
    if (!confirm("確定要修改比薩參數嗎？\n\n之後餅皮推估會改用新參數；\n已存的歷史數字不受影響。")) return;
    if (!db) { pizzaCfg = c; hide("pizzaBackdrop"); return; }
    const today = todayKey();
    const hist = pizzaHistory.filter((v) => v.date !== today);
    hist.push({ date: today, pizza: c });
    hist.sort((a, b) => (a.date < b.date ? -1 : 1));
    configRef().set({ pizza: c, pizzaHistory: hist, updatedAt: Date.now() }, { merge: true })
      .then(() => hide("pizzaBackdrop"))
      .catch((err) => { console.error(err); alert("儲存失敗：" + (err.message || err)); });
  }
  // 比薩參數版本紀錄(唯讀查看)；最底下永遠保留「系統預設值(最初)」
  function renderPzHist() {
    const box = $("pzHistList"); if (!box) return;
    const asc = pizzaHistory.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    let html = "";
    for (let i = asc.length - 1; i >= 0; i--) {
      const v = asc[i], latest = (i === asc.length - 1);
      html += `<button type="button" class="pm-ver" data-idx="${i}"><span class="d">${v.date.replace(/-/g, "/")} 起版本</span>${latest ? `<span class="now">目前版本</span>` : ""}<span class="arrow">›</span></button>`;
    }
    html += `<button type="button" class="pm-ver pm-ver-base" data-idx="-1"><span class="d">📦 系統預設值</span>${asc.length === 0 ? `<span class="now">目前使用中</span>` : `<span class="org">最初</span>`}<span class="arrow">›</span></button>`;
    box.innerHTML = html;
    box.querySelectorAll("button[data-idx]").forEach((b) => b.addEventListener("click", () => openPzVer(asc, Number(b.dataset.idx))));
  }
  function openPzVer(asc, i) {
    const base = (i < 0), ds = (x) => x.replace(/-/g, "/");
    const v = base ? { date: null, pizza: DEFAULT_PIZZA } : asc[i];
    const next = base ? null : asc[i + 1];
    const c = v.pizza, f = pizzaFloor(c);
    $("pmVerTitle").textContent = base ? "比薩參數 · 系統預設值(最初)" : `比薩參數 · ${ds(v.date)} 起`;
    $("pmVerRange").textContent = base
      ? (asc.length ? `系統最初的預設值，沿用到 ${ds(asc[0].date)} 第一次修改` : "系統預設值(目前使用中)")
      : (next ? `此版自 ${ds(v.date)} 起套用，到 ${ds(next.date)} 改版` : `此版自 ${ds(v.date)} 起套用(目前仍在使用)`);
    const row = (k, val) => `<tr><td>${k}</td><td>${val}</td></tr>`;
    const fv = (key, u, s) => pzAutoOf(c, key) ? "自動(依報表)" : `${u || ""}${c[key]}${s || ""}`;
    $("pmVerBody").innerHTML =
      `<table class="pm"><tbody>` +
      row("推估參考近幾次同星期", `${samplesOf(c)} 次`) +
      row("六日／假日 最低營業額", `$${(Number(c.minRevenue) || 0).toLocaleString()}`) +
      row("比薩佔全店營業額", fv("pizzaShare", "", "%")) +
      row("9吋佔比薩營業額", fv("share9", "", "%")) +
      row("9吋均價", fv("avg9", "$", "")) +
      row("12吋均價", fv("avg12", "$", "")) +
      row("9吋 厚片比例", fv("thick9", "", "%")) +
      row("12吋 厚片比例", fv("thick12", "", "%")) +
      `</tbody></table>` +
      `<div class="pm-ver-sub">此版反推「六日／假日最少要備」</div>` +
      `<table class="pm"><thead><tr><th>9厚</th><th>9薄</th><th>12厚</th><th>12薄</th></tr></thead><tbody><tr><td>${f.t9}</td><td>${f.s9}</td><td>${f.t12}</td><td>${f.s12}</td></tr></tbody></table>`;
    show("pmVerBackdrop");
  }

  /* ---------- 餅皮推估 ＋ 管理者檢視 ---------- */
  // 某天「製作量」＝ 當天剩餘(盤點) ＋ 當天賣出(報表)；沒有剩餘盤點就不算(不顯示製作量)
  function doughMade(k) {
    const rep = predDays[k], sold = rep && rep.dough, left = doughLeft(k);
    if (!sold || !left) return null;
    const out = {};
    DOUGH_TYPES.forEach((t) => { out[t] = (Number(sold[t]) || 0) + (Number(left[t]) || 0); });
    return out;
  }
  function doughSold(k) { const r = predDays[k]; return (r && r.dough) ? r.dough : null; }
  function doughLeft(k) { const s = stockDays[k]; if (!hasDoughRec(s)) return null; const o = {}; DOUGH_TYPES.forEach((t) => o[t] = Number(s[t]) || 0); return o; }
  const doughTotal = (o) => o ? DOUGH_TYPES.reduce((s, t) => s + (Number(o[t]) || 0), 0) : 0;
  const doughPizzaRev = (o) => DC.doughPizzaRev(o, pizzaCfg, doughCtx());
  const predictDough = (k) => DC.predictDough(k, doughCtx());
  function doughCells(o) { return DOUGH_TYPES.map((t) => o ? `<td>${o[t]}</td>` : `<td class="ck-muted">—</td>`).join(""); }
  function nextOpenDays(fromKey, n) { const out = [], d = parseKey(fromKey); for (let i = 0; i < 40 && out.length < n; i++) { const k = toKey(d); if (!isClosed(k)) out.push(k); d.setDate(d.getDate() + 1); } return out; }
  // 近 14 天(含今天)有上傳餅皮銷售的日子，新→舊
  function recentDoughDays(days) {
    const todayK = todayKey(), d = parseKey(todayK); d.setDate(d.getDate() - (days - 1));
    const from = toKey(d);
    return Object.keys(predDays).filter((k) => k >= from && k <= todayK && predDays[k] && predDays[k].dough).sort((a, b) => (a < b ? 1 : -1));
  }
  // 推估 vs 實際賣(合計)：估少＝不夠用；估多超過 15%＝剩太多；其餘＝差不多
  const DOUGH_OVER_PCT = 15;
  function doughVerdict(recT, soldT) {
    const diff = recT - soldT;
    if (diff < 0) return { key: "short", text: "估少", diff };
    if (soldT > 0 && diff > soldT * DOUGH_OVER_PCT / 100) return { key: "over", text: "估多", diff };
    return { key: "ok", text: "差不多", diff };
  }
  const sizeTotals = (o) => o ? { n9: (Number(o.t9) || 0) + (Number(o.s9) || 0), n12: (Number(o.t12) || 0) + (Number(o.s12) || 0) } : null;
  function openDough() { renderDough(); show("doughBackdrop"); }
  function renderDough() {
    const up = nextOpenDays(todayKey(), 2);
    $("doughUpcoming").innerHTML = up.map((k) => {
      const p = predictDough(k), anyFloor = p.src && DOUGH_TYPES.some((t) => p.src[t] === "floor");
      const basis = !p.n ? `同星期資料累積中${p.floor ? "・暫用最低營業額反推" : ""}`
        : `依近 ${p.n} 個${p.sampleName}平均銷售${anyFloor ? "・已套最低營業額底線" : ""}${p.isWeekend ? `・預估比薩營業額約 $${doughPizzaRev(p.rec).rev.toLocaleString()}` : ""}`;
      return `<button type="button" class="dg-up" data-dgd="${k}">
        <div class="dg-up-h">${mdw(k)}<span class="dg-tag${p.isWeekend ? " wk" : ""}">${p.label}</span><span class="dg-up-more">看依據 ›</span></div>
        <div class="dg-up-nums">${DOUGH_TYPES.map((t) => `<span${p.src[t] === "floor" ? ` class="fl"` : ""}><i>${DOUGH_LABEL[t]}</i><b>${p.rec[t]}</b></span>`).join("")}</div>
        <div class="dg-up-note">${basis}</div>
      </button>`;
    }).join("");
    const recent = recentDoughDays(14);
    if (!recent.length) { $("doughAcc").innerHTML = ""; $("doughRecent").innerHTML = `<div class="rec-empty">近 14 天還沒有餅皮銷售資料；請先上傳含餅皮的銷售報表。</div>`; }
    else {
      const rows = recent.map((k) => { const p = predictDough(k), sT = doughTotal(doughSold(k)), rT = doughTotal(p.rec); return { k, p, sT, rT, v: doughVerdict(rT, sT) }; });
      const valid = rows.filter((r) => r.p.n > 0 || r.p.floor);   // 沒有任何依據的日子不列入準確度
      const cnt = { ok: 0, short: 0, over: 0 }; valid.forEach((r) => cnt[r.v.key]++);
      const avgDiff = valid.length ? Math.round(valid.reduce((s, r) => s + r.v.diff, 0) / valid.length) : 0;
      $("doughAcc").innerHTML = valid.length ? `
        <div class="dg-acc-grid">
          <div class="dg-acc ok"><b>${cnt.ok}</b><span>差不多</span></div>
          <div class="dg-acc short"><b>${cnt.short}</b><span>估少(不夠)</span></div>
          <div class="dg-acc over"><b>${cnt.over}</b><span>估多(>${DOUGH_OVER_PCT}%)</span></div>
        </div>
        <div class="dg-acc-sum">近 14 天 ${valid.length} 個營業日・平均每天 ${avgDiff >= 0 ? "估多" : "估少"} <b>${Math.abs(avgDiff)}</b> 個</div>` : "";
      $("doughRecent").innerHTML = rows.map((r) => {
        const left = doughLeft(r.k), lT = left ? doughTotal(left) : null, none = !(r.p.n > 0 || r.p.floor);
        return `<button type="button" class="dg-rrow" data-dgd="${r.k}">
          <span class="dg-rd">${mdw(r.k)}</span>
          <span class="dg-rm"><span>估 <b>${none ? "—" : r.rT}</b></span> · <span>賣 <b>${r.sT}</b></span> · <span>剩 <b>${lT != null ? lT : "—"}</b></span></span>
          <span class="dg-rdiff ${none ? "" : r.v.key}">${none ? "無依據" : `${r.v.text} ${r.v.diff > 0 ? "+" : ""}${r.v.diff}`}</span>
        </button>`;
      }).join("");
    }
    $("doughBody").querySelectorAll("button[data-dgd]").forEach((b) => b.onclick = () => openDoughDetail(b.dataset.dgd));
  }
  function openDoughDetail(k) {
    const p = predictDough(k), made = doughMade(k), sold = doughSold(k), left = doughLeft(k);
    $("doughDetTitle").textContent = fmtFull(k);
    if (!p.rec) { $("doughDetBody").innerHTML = `<div class="hint">這天公休。</div>`; show("doughDetBackdrop"); return; }
    const r = sizeTotals(p.rec), money = (v) => "$" + Math.round(v).toLocaleString();
    const cell = (o, t, hi) => o ? `<td${hi ? ` class="dg-hi"` : ""}>${o[t]}</td>` : `<td class="ck-muted">—</td>`;
    let html = `<div class="dg-sug">
      <div class="dg-sug-h">${p.label}・建議備</div>
      <div class="dg-sug-n"><span>9吋 <b>${r.n9}</b><small>厚${p.rec.t9} 薄${p.rec.s9}</small></span><span>12吋 <b>${r.n12}</b><small>厚${p.rec.t12} 薄${p.rec.s12}</small></span></div>
    </div>`;
    // ① 怎麼來的
    html += `<div class="dg-sec-h">① 怎麼來的</div>
      <table class="ck-items dg-basis"><thead><tr><th></th><th>9厚</th><th>9薄</th><th>12厚</th><th>12薄</th></tr></thead><tbody>
      <tr><td>近 ${p.n || p.N} 個${p.sampleName}平均銷售</td>${DOUGH_TYPES.map((t) => cell(p.avg, t, p.src[t] === "avg")).join("")}</tr>
      ${p.isWeekend ? `<tr><td>最低營業額 ${money(pizzaCfg.minRevenue || 0)} 反推</td>${DOUGH_TYPES.map((t) => cell(p.floor, t, p.src[t] === "floor")).join("")}</tr>` : ""}
      <tr class="sum"><td>✔ 建議</td>${DOUGH_TYPES.map((t) => `<td>${p.rec[t]}</td>`).join("")}</tr>
      </tbody></table>
      <div class="dg-explain">${!p.n ? `還沒有${p.sampleName}的銷售資料${p.isWeekend ? "，暫時只用最低營業額反推。" : "，無法推估。"}`
        : p.isWeekend ? "六日／假日：每一格取「平均銷售」與「最低營業額反推」較大的那個(底色標示採用哪個)。"
        : `平日：直接用近 ${p.n} 個${p.sampleName}的平均銷售量。`}${p.n && p.n < p.N ? `(設定參考 ${p.N} 次，目前只有 ${p.n} 次資料)` : ""}</div>`;
    // ② 預估比薩營業額＝個數×均價(均價取近 4 週假日)，對照「最低營業額×比薩佔比」；只在六日/假日顯示
    if (p.isWeekend) {
      const R = doughPizzaRev(p.rec), line = (x) => `9吋 ${x.n9}個×$${x.a9} ＋ 12吋 ${x.n12}個×$${x.a12}`;
      html += `<div class="dg-sec-h">② 預估比薩營業額</div>
        <div class="dg-rev"><b>${money(R.rev)}</b><span>依建議量：${line(R)}</span></div>
        <div class="dg-rev-sub">比薩約佔全店 ${R.share}%，換算全店約 <b>${money(R.store)}</b></div>`;
      if (p.isWeekend && p.floor) {
        const target = Math.round((Number(pizzaCfg.minRevenue) || 0) * R.share / 100);
        const A = p.avg ? doughPizzaRev(p.avg) : null;
        const item = (lbl, v, f) => `<div class="dg-rv"><div class="dg-rv-h"><span>${lbl}</span><b>${money(v)}</b></div><small>${f}</small></div>`;
        html += `<div class="dg-rvs">${A ? item("平均銷售的比薩營業額", A.rev, line(A)) : ""}${item("底線目標比薩營業額", target, `最低營業額 ${money(pizzaCfg.minRevenue || 0)} × 比薩 ${R.share}%`)}</div>`;
        if (A && A.rev < target) html += `<div class="dg-warn">⚠ 平常${p.sampleName}賣出的比薩營業額(${money(A.rev)})比底線目標 ${money(target)} 低，所以建議量是被底線撐高的；若常剩太多，可考慮調低最低營業額。</div>`;
      }
    }
    // ③ 參考的日子
    if (p.n) {
      html += `<div class="dg-sec-h">③ 參考的 ${p.n} 天</div>
        <table class="ck-items dg-samp"><thead><tr><th>日期</th><th>比薩營業額</th><th>賣9吋</th><th>賣12吋</th><th>剩餘</th></tr></thead><tbody>
        ${p.samples.map((x) => { const z = sizeTotals(x.sold); return `<tr><td>${mdw(x.date)}</td><td>${x.rev ? money(x.rev) : "—"}</td><td>${z.n9}</td><td>${z.n12}</td><td>${x.left ? doughTotal(x.left) : "—"}</td></tr>`; }).join("")}
        </tbody></table>`;
    }
    // 實際結果(已有銷售的日子)
    if (sold) {
      const diff = {}; DOUGH_TYPES.forEach((t) => diff[t] = p.rec[t] - (Number(sold[t]) || 0));
      const v = doughVerdict(doughTotal(p.rec), doughTotal(sold));
      html += `<div class="dg-sec-h">這天的實際結果 <span class="dg-rdiff ${v.key}">${v.text}</span></div>
        <table class="ck-items"><thead><tr><th></th><th>9厚</th><th>9薄</th><th>12厚</th><th>12薄</th></tr></thead><tbody>
        <tr><td>🔮 推估</td>${doughCells(p.rec)}</tr>
        <tr><td>實際賣</td>${doughCells(sold)}</tr>
        <tr><td>剩餘</td>${doughCells(left)}</tr>
        ${made ? `<tr><td>🍕 製作</td>${doughCells(made)}</tr>` : ""}
        <tr class="sum"><td>差額(估−賣)</td>${DOUGH_TYPES.map((t) => diffCell(diff[t])).join("")}</tr>
        </tbody></table>
        ${left ? "" : `<div class="hint" style="margin:8px 2px">這天沒有打烊剩餘盤點，所以不顯示製作量。</div>`}
        <div class="hint" style="margin:4px 2px">製作＝剩餘＋賣出；差額＝推估−實際賣(正＝估多、負＝估少)。</div>`;
    }
    $("doughDetBody").innerHTML = html;
    show("doughDetBackdrop");
  }

  /* ---------- 備份／還原(整包 JSON 匯出匯入) ---------- */
  function openBackup() { show("backupBackdrop"); }
  function doBackupExport() {
    if (!db) { alert("尚未連線，無法備份。"); return; }
    const FP = firebase.firestore.FieldPath.documentId();
    db.collection(COLL).where(FP, ">=", "poultry_").where(FP, "<", "poultry`").get().then((qs) => {
      const out = { type: "poultry-backup", version: 1, exportedAt: new Date().toISOString(), config: null, months: {}, stock: {} };
      qs.forEach((doc) => {
        const id = doc.id, data = doc.data() || {};
        if (id === "poultry_config") out.config = { bufferFactor: data.bufferFactor, predWindow: data.predWindow, estMethod: data.estMethod, supplierOff: data.supplierOff, suppliers: data.suppliers, defaultSupplier: data.defaultSupplier, parts: data.parts, purchase: data.purchase, partsHistory: data.partsHistory, pizza: data.pizza, pizzaHistory: data.pizzaHistory };
        else if (id.indexOf("poultry_stock_") === 0) out.stock[id.slice("poultry_stock_".length)] = { days: data.days || {} };
        else out.months[id.slice("poultry_".length)] = { days: data.days || {} };
      });
      triggerDownload(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }), `${settings.storeName || "備料預估"}_備料備份_${todayKey()}.json`);
    }).catch((err) => { console.error(err); alert("備份失敗：" + (err.message || err)); });
  }
  function onBackupFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      let data; try { data = JSON.parse(e.target.result); } catch (x) { alert("這不是有效的備份檔(JSON 解析失敗)。"); return; }
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
    if (data.stock) Object.keys(data.stock).forEach((ym) => { if (/^\d{4}-\d{2}$/.test(ym)) writes.push({ ref: stockRefOf(ym), data: { days: data.stock[ym].days || {}, updatedAt: Date.now() } }); });
    if (data.config) { const c = { updatedAt: Date.now() }; if (typeof data.config.bufferFactor === "number") c.bufferFactor = data.config.bufferFactor; if (WINDOW_OPTIONS.includes(data.config.predWindow)) c.predWindow = data.config.predWindow; if (EST_METHODS.includes(data.config.estMethod)) c.estMethod = data.config.estMethod; if (data.config.supplierOff && typeof data.config.supplierOff === "object") c.supplierOff = data.config.supplierOff; if (Array.isArray(data.config.suppliers)) c.suppliers = data.config.suppliers; if (typeof data.config.defaultSupplier === "string") c.defaultSupplier = data.config.defaultSupplier; if (data.config.parts) c.parts = data.config.parts; if (data.config.purchase) c.purchase = data.config.purchase; if (Array.isArray(data.config.partsHistory)) c.partsHistory = data.config.partsHistory; if (data.config.pizza && typeof data.config.pizza === "object") c.pizza = data.config.pizza; if (Array.isArray(data.config.pizzaHistory)) c.pizzaHistory = data.config.pizzaHistory; writes.push({ ref: configRef(), data: c }); }
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
    $("ckOrderBtn").onclick = () => openOrderForm(null);
    $("ckOpenReport").onclick = openReport;
    // 叫貨單：三個選擇器＋逐日表＋草稿/確認/刪除
    // 換廠商：到貨日、使用日改用該廠商的休息日重新帶預設(之後仍可自己改)
    $("ordSupplier").addEventListener("change", (e) => { orderForm.supplier = e.target.value; orderForm.kg = null; applyOrderDefaults(orderForm); renderOrderForm(); });
    $("ordDelivery").addEventListener("change", (e) => { orderForm.deliveryDay = e.target.value; orderForm.kg = null; recomputeUseDays(); renderOrderForm(); });
    $("ordUseBtn").onclick = openUsePicker;
    $("useDaySave").onclick = confirmUsePicker;
    $("ordDraftBtn").onclick = () => saveOrderForm(false);
    $("ordConfirmBtn").onclick = () => saveOrderForm(true);
    $("ordDeleteBtn").onclick = deleteOrderForm;
    // ② 公斤手動改 → 記為覆寫(不再自動蓋掉)
    ["orderKgleg", "orderKgfil", "orderKgwing"].forEach((id) => $(id).addEventListener("input", () => { if (orderForm) orderForm.kg = { leg: Number($("orderKgleg").value) || 0, fil: Number($("orderKgfil").value) || 0, wing: Number($("orderKgwing").value) || 0 }; }));
    $("ckHint").onclick = () => openOrderForm(null);
    $("ckDoughBtn").onclick = openDough;
    // 推估設定(工具列按鈕)
    $("ckPredBtn").onclick = openPredSet;
    $("psSave").onclick = savePredSet;
    $("ckSupBtn").onclick = openSupSet;
    $("supAddSupplierBtn").onclick = addSupplier;
    $("supSave").onclick = saveSupSet;
    // 月曆下方工具：匯出 CSV／備份還原／部位對照
    document.querySelectorAll("[data-view]").forEach((b) => b.onclick = () => switchView(b.dataset.view));
    $("recordsExport").onclick = doRecordsExport;
    $("seSave").onclick = saveStockEdit;
    $("seChkOn").onchange = seSyncParts; $("seDghOn").onchange = seSyncParts;
    $("seDate").onchange = () => { const v = $("seDate").value; if (v) seLoadDate(v); };
    $("recordsAdd").onclick = openStockAdd;
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
    // 比薩參數設定(最低營業額手動；其餘自動＋可進階覆寫)
    $("ckPizzaBtn").onclick = openPizza;
    $("pizzaSave").onclick = savePizza;
    PZ_FIELDS.forEach((f) => {
      $(`pz_${f.key}Auto`).addEventListener("change", syncPizzaAuto);
      $(`pz_${f.key}`).addEventListener("input", () => { renderPizzaSummary(); renderPizzaPrev(); });
    });
    $("pz_minRev").addEventListener("input", () => { renderPizzaSummary(); renderPizzaPrev(); });
    $("ckPrevMonth").onclick = () => shiftMonth(-1);
    $("ckNextMonth").onclick = () => shiftMonth(1);
    document.querySelectorAll("#ckCalSwitch button").forEach((b) => b.onclick = () => setCalMode(b.dataset.mode));
    document.querySelectorAll("#ckCatSwitch button").forEach((b) => b.onclick = () => setCalCat(b.dataset.cat));
    $("uploadDrop").onclick = () => $("ckFile").click();
    $("ckFile").addEventListener("change", (e) => onFile(e.target.files[0]));
    // 彈窗關閉(X、背景、取消)
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
    // (首次把 PWA 加到主畫面時尚無快取的登入權杖，若在登入完成前就監聽，
    //   會因安全規則 request.auth != null 被拒 → 顯示「連線異常」；等登入完成才連線即可避免。)
    const start = () => {
      mainRef.onSnapshot((snap) => {
        const d = snap.data(), s = (d && d.data && d.data.settings) || {};
        settings.closedDays = s.closedDays || settings.closedDays;
        settings.holidays = s.holidays || [];
        settings.nationalHolidays = s.nationalHolidays || [];
        settings.adminPin = s.adminPin || "1234";
        settings.storeName = s.storeName || settings.storeName;
        mainLoaded = true;
        render(); refreshHint(); if (orderOpen()) renderOrderForm();
      }, (err) => console.error("main snapshot", err));
      watchMonth(viewYM);
      watchPredMonths();
      watchStockMonths();
      watchOrderMonths();
      watchConfig();
      // 資料載入後跳一次每日提醒(若有待辦、且當天未達 2 次)
      setTimeout(() => { if (!reminderChecked) { reminderChecked = true; maybeShowReminder(); } }, 1400);
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

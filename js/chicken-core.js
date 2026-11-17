/* 雞肉推估／訂購共用核心
 * 後台(chicken.html)與員工頁(index.html)都載入這一份：推估公式、下單/到貨/使用日規則、扣剩餘、公斤換算只寫在這裡。
 * 全部是純計算，資料由呼叫端用 ctx 傳入：
 *   ctx = { reports: {日期: 報表日資料(含 parts/sales)}, stock: {日期: 盤點}, today: "YYYY-MM-DD",
 *           isClosed(日期) → bool, natHoliday(日期) → 名稱或 "",
 *           off: {weekdays:[], dates:[{date,note}]}(推算用的批發商休息日),
 *           pred: {bufferFactor, predWindow, estMethod}(目前設定), predHistory: [{date, pred}],
 *           purchase: {leg:{code,g}, fil:{…}, wing:{…}} }
 */
(function (root) {
  "use strict";
  const PARTS3 = ["leg", "fil", "wing"];
  const PART_NAME = { leg: "腿", fil: "排", wing: "翅" };
  const DEFAULT_PURCHASE = { leg: { code: "D5", g: 120 }, fil: { code: "TS4", g: 150 }, wing: { code: "W6", g: 100 } };
  const WINDOW_OPTIONS = [14, 21, 28, 35, 42, 49, 56, 60];
  const EST_METHODS = ["avg", "median", "weighted", "max"];
  const METHOD_LABEL = { avg: "平均", median: "中位數", weighted: "近期加權", max: "同型日最大" };
  const DEFAULT_SUPPLIERS = [{ id: "a", name: "A 廠商", weekdays: [0], dates: [] }];
  const DOW = "日一二三四五六";

  const pad = (n) => String(n).padStart(2, "0");
  const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return toKey(d); };
  const prevDay = (k) => addDays(k, -1);
  const mdw = (k) => { const d = parseKey(k); return `${d.getMonth() + 1}/${pad(d.getDate())}(${DOW[d.getDay()]})`; };

  /* ---------- 設定 ---------- */
  // 從 poultry_config 讀出推估需要的設定(與後台 applyConfig 相同的預設與遷移規則)
  function normalizeConfig(d) {
    const pred = {
      bufferFactor: (d && typeof d.bufferFactor === "number" && d.bufferFactor > 0) ? d.bufferFactor : 1.0,
      predWindow: (d && WINDOW_OPTIONS.includes(d.predWindow)) ? d.predWindow : 35,
      estMethod: (d && EST_METHODS.includes(d.estMethod)) ? d.estMethod : "avg",
    };
    const clean = (s) => ({ id: String((s && s.id) || "a"), name: String((s && s.name) || "廠商"), weekdays: Array.isArray(s && s.weekdays) ? s.weekdays.map(Number).filter((w) => w >= 0 && w <= 6) : [], dates: Array.isArray(s && s.dates) ? s.dates.filter((x) => x && x.date).map((x) => ({ date: String(x.date), note: String(x.note || "") })) : [] });
    let suppliers = [];
    if (d && Array.isArray(d.suppliers) && d.suppliers.length) d.suppliers.forEach((s) => { if (s && typeof s === "object") suppliers.push(clean(s)); });
    if (!suppliers.length) suppliers = (d && d.supplierOff && typeof d.supplierOff === "object") ? [clean({ id: "a", name: "A 廠商", weekdays: d.supplierOff.weekdays, dates: d.supplierOff.dates })] : JSON.parse(JSON.stringify(DEFAULT_SUPPLIERS));
    const defaultSupplier = (d && d.defaultSupplier && suppliers.some((s) => s.id === d.defaultSupplier)) ? d.defaultSupplier : suppliers[0].id;
    const purchase = JSON.parse(JSON.stringify(DEFAULT_PURCHASE));
    if (d && d.purchase && typeof d.purchase === "object") PARTS3.forEach((p) => { const v = d.purchase[p]; if (v && typeof v === "object") purchase[p] = { code: String(v.code || DEFAULT_PURCHASE[p].code), g: Number(v.g) || DEFAULT_PURCHASE[p].g }; });
    const predHistory = (d && Array.isArray(d.predHistory)) ? d.predHistory.filter((v) => v && v.pred).slice().sort((a, b) => ((a.date || "") < (b.date || "") ? -1 : 1)) : [];
    return { pred, suppliers, defaultSupplier, purchase, predHistory };
  }
  const supplierOffOf = (s) => ({ weekdays: (s && s.weekdays) || [], dates: (s && s.dates) || [] });

  /* ---------- 公斤換算 ---------- */
  const purG = (part, ctx) => (ctx.purchase && ctx.purchase[part] && Number(ctx.purchase[part].g)) || DEFAULT_PURCHASE[part].g;
  const purCode = (part, ctx) => (ctx.purchase && ctx.purchase[part] && ctx.purchase[part].code) || DEFAULT_PURCHASE[part].code;
  // 隻 → 建議公斤(四捨五入；需求>0 時至少 1 公斤)
  function kgSuggest(pieces, part, ctx) { const p = Number(pieces) || 0; if (p <= 0) return 0; return Math.max(1, Math.round((p * purG(part, ctx)) / 1000)); }
  // 公斤 → 隻(無條件捨去，保守不高估)
  function kgToPieces(kg, part, ctx) { const k = Number(kg) || 0, g = purG(part, ctx); return k <= 0 || g <= 0 ? 0 : Math.floor((k * 1000) / g); }

  /* ---------- 日型與推估 ---------- */
  // 公休 null／假日(六日＋國定)／週五／平日
  function dayGroup(k, ctx) {
    if (ctx.isClosed(k)) return null;
    if (ctx.natHoliday(k)) return "假日";
    const dow = parseKey(k).getDay();
    if (dow === 0 || dow === 6) return "假日";
    if (dow === 5) return "週五";
    return "平日";
  }
  const estMean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const estMedian = (a) => { const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const estWeighted = (a) => { let sw = 0, sv = 0; a.forEach((x, i) => { const w = i + 1; sw += w; sv += w * x; }); return sw ? sv / sw : 0; };
  const estMax = (a) => a.reduce((m, x) => Math.max(m, x), 0);
  const ESTIMATORS = { avg: estMean, median: estMedian, weighted: estWeighted, max: estMax };
  // 推估某使用日：同日型、回算天數內有上傳消耗的日子，依方式計算 × 多備，四捨五入。
  // asOf：只用 asOf 前一天以前、asOf 往回 N 天的資料；不給＝以今天為準(含今天)。P：參數版本；不給＝目前設定
  function predict(targetKey, asOf, P, ctx) {
    const g = dayGroup(targetKey, ctx);
    if (!g) return { group: null };
    const PP = P || ctx.pred, pw = PP.predWindow, bf = PP.bufferFactor, em = PP.estMethod;
    const ref = asOf || ctx.today, endK = asOf ? prevDay(asOf) : ref, start = addDays(ref, -pw);
    const samples = [];
    Object.keys(ctx.reports || {}).forEach((k) => {
      if (k > endK || k < start) return;
      if (dayGroup(k, ctx) !== g) return;
      const rec = ctx.reports[k];
      if (!(rec && rec.parts && rec.sales && Object.keys(rec.sales).length)) return;
      samples.push({ date: k, parts: rec.parts });
    });
    const n = samples.length;
    if (!n) return { group: g, n: 0, buf: bf, method: em, window: pw };
    samples.sort((a, b) => (a.date < b.date ? -1 : 1));
    const fn = ESTIMATORS[em] || estMean, base = {};
    PARTS3.forEach((p) => { base[p] = fn(samples.map((s) => Number(s.parts[p]) || 0)); });
    const rec = { leg: Math.round(base.leg * bf), fil: Math.round(base.fil * bf), wing: Math.round(base.wing * bf) };
    return { group: g, n, buf: bf, method: em, window: pw, avg: { leg: Math.round(base.leg), fil: Math.round(base.fil), wing: Math.round(base.wing) }, rec };
  }
  // 某天有效的推估參數版本(date "" ＝最初；沒有紀錄＝目前設定)
  function predAt(k, ctx) {
    const h = ctx.predHistory || [];
    if (!h.length) return ctx.pred;
    let v = h[0]; h.forEach((x) => { if ((x.date || "") <= k) v = x; });
    return v.pred;
  }
  // 訂購用的預估：下單日(今天或過去)→ 當天版本、只用下單日之前的資料；未來下單日 → 目前設定
  function predForOrder(u, od, ctx) { return (od && od <= ctx.today) ? predict(u, od, predAt(od, ctx), ctx) : predict(u, null, null, ctx); }
  const predLabel = (P) => `${METHOD_LABEL[P.estMethod] || P.estMethod}・近 ${P.predWindow} 天・多備 ×${P.bufferFactor}`;

  /* ---------- 下單／到貨／使用日 ---------- */
  function supplierOpen(k, ctx) {
    const off = ctx.off || {};
    if ((off.weekdays || []).includes(parseKey(k).getDay())) return false;
    if ((off.dates || []).some((x) => x.date === k)) return false;
    return true;
  }
  // 有效到貨日：店有營業、批發商上班，且前一天批發商也上班(前一天下單、隔天到)
  function validDelivery(k, ctx) { return !ctx.isClosed(k) && supplierOpen(k, ctx) && supplierOpen(prevDay(k), ctx); }
  // 使用日的到貨日＝之前最近一個有效到貨日(至少醃 1 天)
  function deliveryDayFor(useKey, ctx) {
    const d = parseKey(useKey);
    for (let i = 0; i < 21; i++) { d.setDate(d.getDate() - 1); const k = toKey(d); if (validDelivery(k, ctx)) return k; }
    return null;
  }
  function orderDayFor(useKey, ctx) { const del = deliveryDayFor(useKey, ctx); return del ? prevDay(del) : null; }
  // 某下單日涵蓋哪些使用日
  function coveredUseDays(orderKey, ctx) {
    const out = [], d = parseKey(orderKey);
    for (let i = 1; i <= 10; i++) { d.setDate(d.getDate() + 1); const k = toKey(d); if (ctx.isClosed(k)) continue; if (orderDayFor(k, ctx) === orderKey) out.push(k); }
    return out;
  }
  // 某廠商某天的預設：到貨日＋使用日；不是該廠商的下單日 → null
  function orderDefaults(orderDay, off, ctx) {
    const c = Object.assign({}, ctx, { off });
    const uds = coveredUseDays(orderDay, c);
    return uds.length ? { del: deliveryDayFor(uds[0], c), uds } : null;
  }
  const isTempOff = (k, off) => ((off && off.dates) || []).find((x) => x.date === k) || null;

  /* ---------- 打烊剩餘 ---------- */
  const hasChickenRec = (r) => !!r && (r.leg != null || r.fil != null || r.wing != null);
  // 最近 n 個營業日(含 fromKey，若營業)：新→舊
  function recentBizDays(n, fromKey, ctx) {
    const out = [], d = parseKey(fromKey || ctx.today);
    for (let i = 0; i < 90 && out.length < n; i++) { const k = toKey(d); if (!ctx.isClosed(k)) out.push(k); d.setDate(d.getDate() - 1); }
    return out;
  }
  // 以 refDay 往回近 3 個營業日內、最新一筆有填雞肉的盤點；沒有 → null(不當作 0)
  function currentStock(refDay, ctx) {
    const t = refDay || ctx.today, win = recentBizDays(3, t, ctx), cutoff = win.length ? win[win.length - 1] : t, st = ctx.stock || {};
    const keys = Object.keys(st).filter((k) => k <= t && k >= cutoff && hasChickenRec(st[k])).sort();
    if (!keys.length) return null;
    const k = keys[keys.length - 1], r = st[k];
    return { date: k, leg: Number(r.leg) || 0, fil: Number(r.fil) || 0, wing: Number(r.wing) || 0, byName: r.byName || "" };
  }

  /* ---------- 一張訂購單的預設內容(員工頁與後台首頁共用) ---------- */
  // 回傳 { od, del, uses, perDay{u:{leg,fil,wing}}, preds{u:predict結果}, sum, stock, net, kg } 或 null(不是下單日)
  function orderPlan(od, off, ctx) {
    const def = orderDefaults(od, off, ctx); if (!def) return null;
    const c = Object.assign({}, ctx, { off });
    const perDay = {}, preds = {}, sum = { leg: 0, fil: 0, wing: 0 };
    def.uds.forEach((u) => { const p = predForOrder(u, od, c); preds[u] = p; const r = (p.n && p.rec) ? p.rec : { leg: 0, fil: 0, wing: 0 }; perDay[u] = Object.assign({}, r); PARTS3.forEach((x) => sum[x] += r[x]); });
    const stock = od <= ctx.today ? currentStock(od, c) : null;
    const net = {}; PARTS3.forEach((x) => net[x] = Math.max(0, sum[x] - (stock ? stock[x] : 0)));
    const kg = {}; PARTS3.forEach((x) => kg[x] = net[x] > 0 ? kgSuggest(net[x], x, c) : 0);
    return { od, del: def.del, uses: def.uds, perDay, preds, sum, stock, net, kg };
  }

  root.ChickenCore = { PARTS3, PART_NAME, DEFAULT_PURCHASE, WINDOW_OPTIONS, EST_METHODS, METHOD_LABEL, DEFAULT_SUPPLIERS, mdw, parseKey, toKey, addDays, prevDay,
    normalizeConfig, supplierOffOf, purG, purCode, kgSuggest, kgToPieces, dayGroup, ESTIMATORS, predict, predAt, predForOrder, predLabel,
    supplierOpen, validDelivery, deliveryDayFor, orderDayFor, coveredUseDays, orderDefaults, isTempOff, hasChickenRec, recentBizDays, currentStock, orderPlan };
})(window);

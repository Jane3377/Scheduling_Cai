/* 餅皮推估共用核心
 * 後台(chicken.html)與員工頁(index.html)都載入這一份，推估公式只寫在這裡；改公式只改這個檔。
 * 全部是純計算，資料由呼叫端用 ctx 傳入：
 *   ctx = { reports: {日期: 報表日資料}, stock: {日期: 盤點}, cfg: 比薩參數, today: "YYYY-MM-DD",
 *           isClosed(日期) → bool, natHoliday(日期) → 國定假日名稱或 "" }
 */
(function (root) {
  "use strict";
  const DOUGH_TYPES = ["t9", "s9", "t12", "s12"];
  const DOUGH_LABEL = { t9: "9吋厚", s9: "9吋薄", t12: "12吋厚", s12: "12吋薄" };
  // 比薩參數：minRevenue 手動；doughSamples＝推估參考近幾次同星期；其餘比例/均價預設自動(近 4 週假日報表)，可手動覆寫
  const DEFAULT_PIZZA = { minRevenue: 100000, doughSamples: 2, pizzaShare: 60, pizzaShareAuto: true, share9: 50, share9Auto: true, avg9: 448, avg9Auto: true, avg12: 680, avg12Auto: true, thick9: 60, thick9Auto: true, thick12: 60, thick12Auto: true };
  const PIZZA_NUM_KEYS = ["minRevenue", "doughSamples", "pizzaShare", "share9", "avg9", "avg12", "thick9", "thick12"];
  const PIZZA_AUTO_KEYS = ["pizzaShareAuto", "share9Auto", "avg9Auto", "avg12Auto", "thick9Auto", "thick12Auto"];
  const AUTO_WEEKS = 4;      // 自動比例只看近 4 週
  const AUTO_MIN_DAYS = 4;   // 近 4 週假日少於 4 天有報表 → 資料不足，退回存檔值
  const DOW = "日一二三四五六";

  const pad = (n) => String(n).padStart(2, "0");
  const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return toKey(d); };
  const num = (v) => Number(v) || 0;

  // 從 Firestore 讀到的 pizza 物件 → 完整設定(缺的欄位用預設)
  function normalizePizza(raw) {
    const c = JSON.parse(JSON.stringify(DEFAULT_PIZZA));
    if (raw && typeof raw === "object") {
      PIZZA_NUM_KEYS.forEach((k) => { if (typeof raw[k] === "number" && isFinite(raw[k])) c[k] = raw[k]; });
      PIZZA_AUTO_KEYS.forEach((k) => { if (typeof raw[k] === "boolean") c[k] = raw[k]; });
    }
    return c;
  }
  function samplesOf(c) { const n = Math.round(Number(c && c.doughSamples)); return (isFinite(n) && n >= 1) ? Math.min(8, n) : DEFAULT_PIZZA.doughSamples; }
  const isAuto = (c, key) => (c[key + "Auto"] === undefined ? true : !!c[key + "Auto"]);
  // 假日＝週六、週日、國定假日
  function isHolidayLike(k, ctx) { const dow = parseKey(k).getDay(); return dow === 0 || dow === 6 || !!ctx.natHoliday(k); }

  // 自動比例/均價：近 4 週(不含今天)有營業的假日報表加總(金額總和÷數量總和，加權平均)
  function autoStats(ctx) {
    const to = addDays(ctx.today, -1), from = addDays(ctx.today, -AUTO_WEEKS * 7);
    const days = Object.keys(ctx.reports || {}).filter((k) => {
      const r = ctx.reports[k];
      return k >= from && k <= to && r && (r.summary || r.dough) && isHolidayLike(k, ctx);
    }).sort();
    let r9 = 0, r12 = 0, q9 = 0, q12 = 0, tot = 0, t9 = 0, s9 = 0, t12 = 0, s12 = 0;
    days.forEach((k) => {
      const s = ctx.reports[k].summary, d = ctx.reports[k].dough;
      if (s) { r9 += num(s.pizza9amt); r12 += num(s.pizza12amt); q9 += num(s.pizza9); q12 += num(s.pizza12); tot += num(s.total); }
      if (d) { t9 += num(d.t9); s9 += num(d.s9); t12 += num(d.t12); s12 += num(d.s12); }
    });
    const enough = days.length >= AUTO_MIN_DAYS, pr = r9 + r12, ok = (v) => (enough ? v : null);
    return {
      days, n: days.length, from: days[0] || null, to: days[days.length - 1] || null, enough, weeks: AUTO_WEEKS, minDays: AUTO_MIN_DAYS,
      pizzaShare: ok(tot > 0 ? Math.round(pr / tot * 100) : null),
      share9: ok(pr > 0 ? Math.round(r9 / pr * 100) : null),
      avg9: ok(q9 ? Math.round(r9 / q9) : null),
      avg12: ok(q12 ? Math.round(r12 / q12) : null),
      thick9: ok((t9 + s9) > 0 ? Math.round(t9 / (t9 + s9) * 100) : null),
      thick12: ok((t12 + s12) > 0 ? Math.round(t12 / (t12 + s12) * 100) : null),
    };
  }
  // 生效數值：自動欄位用近 4 週假日計算(算不出退回存檔值)，手動欄位用填的值
  function resolvePizza(cfg, ctx) {
    const c = cfg || ctx.cfg, live = autoStats(ctx);
    const pick = (key) => { const fb = num(c[key]); if (!isAuto(c, key)) return fb; const v = live[key]; return (v != null && v > 0) ? v : fb; };
    return { minRevenue: num(c.minRevenue), pizzaShare: pick("pizzaShare"), share9: pick("share9"), avg9: pick("avg9"), avg12: pick("avg12"), thick9: pick("thick9"), thick12: pick("thick12") };
  }
  // 由最低營業額反推四類餅皮最少要備：營業額 × 比薩佔比 → 分 9/12 → ÷均價 → ×厚薄比
  function pizzaFloor(cfg, ctx) {
    const c = resolvePizza(cfg, ctx);
    const rev = c.minRevenue * c.pizzaShare / 100, rev9 = rev * c.share9 / 100, rev12 = rev - rev9;
    const n9 = c.avg9 > 0 ? rev9 / c.avg9 : 0, n12 = c.avg12 > 0 ? rev12 / c.avg12 : 0;
    return { t9: Math.round(n9 * c.thick9 / 100), s9: Math.round(n9 * (100 - c.thick9) / 100), t12: Math.round(n12 * c.thick12 / 100), s12: Math.round(n12 * (100 - c.thick12) / 100), n9: Math.round(n9), n12: Math.round(n12), rev: Math.round(rev), a9: Math.round(c.avg9), a12: Math.round(c.avg12), pizzaShare: c.pizzaShare, share9: c.share9, thick9: c.thick9, thick12: c.thick12 };
  }
  // 由餅皮個數估比薩營業額：9吋個數×9吋均價＋12吋個數×12吋均價(均價/比薩佔比取生效值)
  function doughPizzaRev(o, cfg, ctx) {
    const c = resolvePizza(cfg, ctx), n9 = num(o.t9) + num(o.s9), n12 = num(o.t12) + num(o.s12);
    const a9 = Math.round(c.avg9), a12 = Math.round(c.avg12), rev = n9 * a9 + n12 * a12;
    return { n9, n12, a9, a12, rev, share: c.pizzaShare, store: c.pizzaShare > 0 ? Math.round(rev / (c.pizzaShare / 100)) : 0 };
  }
  // 餅皮推估：平日、假日都以「近 N 次同星期平均銷售量」為基準(N＝doughSamples，預設 2)；
  // 假日再與最低營業額反推取較大；國定假日營業＝用週日樣本；只用目標日之前(且不晚於今天)的資料。
  function predictDough(targetKey, ctx) {
    if (ctx.isClosed(targetKey)) return { group: null, rec: null };
    const reports = ctx.reports || {}, stock = ctx.stock || {};
    const nat = ctx.natHoliday(targetKey), dow = parseKey(targetKey).getDay();
    const isWeekend = (dow === 0 || dow === 6 || !!nat), sampleDow = nat ? 0 : dow;
    const N = samplesOf(ctx.cfg), samples = [];
    Object.keys(reports).forEach((k) => {
      if (k >= targetKey || k > ctx.today) return;
      if (parseKey(k).getDay() !== sampleDow) return;
      const r = reports[k], sold = r && r.dough;
      if (!sold) return;
      const s = r.summary, st = stock[k];
      let left = null; if (st && DOUGH_TYPES.some((t) => st[t] != null)) { left = {}; DOUGH_TYPES.forEach((t) => left[t] = num(st[t])); }
      samples.push({ date: k, sold, rev: s ? num(s.pizza9amt) + num(s.pizza12amt) : 0, left });
    });
    samples.sort((a, b) => (a.date < b.date ? 1 : -1));
    const recent = samples.slice(0, N);
    const avg = recent.length ? {} : null;
    if (avg) DOUGH_TYPES.forEach((t) => { avg[t] = Math.round(recent.reduce((s, x) => s + num(x.sold[t]), 0) / recent.length); });
    const floor = isWeekend ? pizzaFloor(ctx.cfg, ctx) : null;
    const rec = {}, src = {};
    DOUGH_TYPES.forEach((t) => {
      const a = avg ? avg[t] : 0, fl = floor ? floor[t] : 0;
      if (isWeekend && fl > a) { rec[t] = fl; src[t] = "floor"; }
      else { rec[t] = a; src[t] = avg ? "avg" : "none"; }
    });
    const label = nat ? ("國定假日·" + nat) : (dow === 0 ? "週日" : dow === 6 ? "週六" : "平日·週" + DOW[dow]);
    const sampleName = (nat || dow === 0) ? "週日" : "週" + DOW[dow];
    return { group: isWeekend ? "假日" : "平日", label, sampleName, isWeekend, nat: nat || "", sampleDow, N, n: recent.length, avg, floor, rec, src, samples: recent };
  }

  root.DoughCore = { DOUGH_TYPES, DOUGH_LABEL, DEFAULT_PIZZA, PIZZA_NUM_KEYS, PIZZA_AUTO_KEYS, AUTO_WEEKS, AUTO_MIN_DAYS, normalizePizza, samplesOf, isAuto, autoStats, resolvePizza, pizzaFloor, doughPizzaRev, predictDough };
})(window);

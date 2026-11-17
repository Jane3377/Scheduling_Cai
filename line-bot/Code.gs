/* =====================================================================
 *  蔡叔叔比薩屋：打烊剩餘 LINE 提醒(Google Apps Script)
 *
 *  做什麼：
 *   - 每天 20:00 檢查今天的打烊剩餘(雞肉、餅皮)，還沒填才發到 LINE 群組
 *   - 20:20 再檢查一次，還沒填就再追一次；之後不再發
 *   - 公休日不發；兩項都填好就不發
 *
 *  ⚠ 這份程式碼放在公開的 GitHub，所以「不能」寫任何金鑰。
 *    LINE 金鑰請放在 Apps Script →「專案設定」→「指令碼屬性」：
 *      LINE_TOKEN = (LINE Developers 的 Channel access token)
 *    群組 ID 會在機器人被邀進群組時自動記下(GROUP_ID)，不用手動填。
 *
 *  設定步驟見同資料夾的 README.md
 * ===================================================================== */

// ---- 一般設定(不是秘密，可以直接改) ----
const CONFIG = {
  // Firebase：與網站 js/firebase-config.js 相同(這兩個值本來就公開在網頁裡)
  FIREBASE_API_KEY: "AIzaSyAM2LscZBh9kW-oocrFT5YuZPJc0NKHW9s",
  FIREBASE_PROJECT_ID: "scheduling-cai",
  COLLECTION: "scheduler",
  // 員工頁「今日打烊剩餘」頁籤的網址(搬家後改這裡)
  STAFF_URL: "https://jane3377.github.io/Scheduling_Cai/index.html?go=stock",
  TIMEZONE: "Asia/Taipei",
  FIRST: "20:00",   // 第一次檢查／提醒
  FOLLOW: "20:20",  // 追蹤提醒
  END: "21:00",     // 超過這個時間就不再補發(例如程式當天太晚才啟用)
};

const DOW = "日一二三四五六";

/* ---------------- 每分鐘執行一次(由 setup() 建立的觸發器呼叫) ---------------- */
function tick() {
  const now = new Date();
  const hm = Utilities.formatDate(now, CONFIG.TIMEZONE, "HH:mm");
  if (hm < CONFIG.FIRST || hm >= CONFIG.END) return;          // 不在 20:00～21:00 → 什麼都不做(不讀 Firebase)
  const today = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy-MM-dd");

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    let st = JSON.parse(props.getProperty("STATE") || "{}");
    if (st.date !== today) st = { date: today, first: false, follow: false, done: false };
    if (st.done) return;

    // 這一分鐘要做哪一次：還沒做過 20:00 那次 → first；過了 20:20 還沒追 → follow
    let stage = null;
    if (hm >= CONFIG.FOLLOW && !st.follow) stage = "follow";      // 已過 20:20(含當天太晚啟用)→ 只發一次追蹤
    else if (!st.first) stage = "first";
    if (!stage) return;

    const s = checkDay(today);
    if (s.closed || (s.chicken && s.dough)) {
      st.done = true;                                              // 公休或都填好 → 今天不再檢查
    } else {
      pushLine(buildMessage(stage, today, s));
      st.first = true;
      if (stage === "follow") { st.follow = true; st.done = true; }
    }
    props.setProperty("STATE", JSON.stringify(st));
  } finally {
    lock.releaseLock();
  }
}

function buildMessage(stage, dk, s) {
  const miss = [];
  if (!s.chicken) miss.push("🍗 雞肉");
  if (!s.dough) miss.push("🍕 餅皮");
  const day = mdw(dk);
  if (stage === "first") {
    return `🔔 打烊囉！請填 ${day} 的打烊剩餘\n還沒填：${miss.join("、")}\n👉 ${CONFIG.STAFF_URL}`;
  }
  return `⚠️ 再提醒：${day} 的打烊剩餘還沒填\n還沒填：${miss.join("、")}\n明天訂雞肉、備餅皮會用到，請盡快填寫\n👉 ${CONFIG.STAFF_URL}`;
}

function mdw(dk) {
  const [y, m, d] = dk.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}/${d}(${DOW[w]})`;
}

/* ---------------- 讀 Firebase：今天剩餘填了沒、是不是公休 ---------------- */
// 判斷方式與員工頁相同(js/staff.js 的 chickenSub / doughSub / isClosedDay)
function checkDay(dk) {
  const stockDoc = fsGet(`poultry_stock_${dk.slice(0, 7)}`);
  const rec = (stockDoc && stockDoc.days && stockDoc.days[dk]) || null;
  const chicken = !!(rec && ((rec.chicken && rec.chicken.at) || (rec.at && (rec.leg != null || rec.fil != null || rec.wing != null))));
  const dough = !!(rec && ((rec.dough && rec.dough.at) || (rec.at && (rec.t9 != null || rec.s9 != null || rec.t12 != null || rec.s12 != null))));
  if (chicken && dough) return { closed: false, chicken, dough };
  // 有沒填的才需要看公休(省一次讀取)
  const main = fsGet("main");
  const settings = (main && main.data && main.data.settings) || {};
  const [y, m, d] = dk.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const closed = (settings.holidays || []).some((h) => h && h.date === dk) || (settings.closedDays || []).indexOf(dow) >= 0;
  return { closed, chicken, dough };
}

function fsGet(docId) {
  const url = `https://firestore.googleapis.com/v1/projects/${CONFIG.FIREBASE_PROJECT_ID}/databases/(default)/documents/${CONFIG.COLLECTION}/${encodeURIComponent(docId)}`;
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: "Bearer " + fbToken() }, muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code === 404) return null;
  if (code !== 200) throw new Error(`讀取 Firebase 失敗(${code})：${res.getContentText().slice(0, 300)}`);
  const doc = JSON.parse(res.getContentText());
  return fromFields(doc.fields || {});
}

// Firestore REST 的欄位格式 → 一般物件
function fromFields(fields) { const o = {}; Object.keys(fields).forEach((k) => { o[k] = fromValue(fields[k]); }); return o; }
function fromValue(v) {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return fromFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  return null;
}

// Firebase 匿名登入(與網站相同)；只登入一次，之後用 refresh token 換新的通行證，不會一直產生新帳號
function fbToken() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get("FB_ID_TOKEN");
  if (hit) return hit;
  const props = PropertiesService.getScriptProperties();
  const key = CONFIG.FIREBASE_API_KEY;
  let idToken = null;
  const refresh = props.getProperty("FB_REFRESH");
  if (refresh) {
    const r = UrlFetchApp.fetch(`https://securetoken.googleapis.com/v1/token?key=${key}`, {
      method: "post", contentType: "application/x-www-form-urlencoded",
      payload: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh)}`, muteHttpExceptions: true,
    });
    if (r.getResponseCode() === 200) { const j = JSON.parse(r.getContentText()); idToken = j.id_token; props.setProperty("FB_REFRESH", j.refresh_token); }
  }
  if (!idToken) {
    const r = UrlFetchApp.fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`, {
      method: "post", contentType: "application/json", payload: JSON.stringify({ returnSecureToken: true }), muteHttpExceptions: true,
    });
    if (r.getResponseCode() !== 200) throw new Error(`Firebase 匿名登入失敗(${r.getResponseCode()})：${r.getContentText().slice(0, 300)}`);
    const j = JSON.parse(r.getContentText());
    idToken = j.idToken; props.setProperty("FB_REFRESH", j.refreshToken);
  }
  cache.put("FB_ID_TOKEN", idToken, 50 * 60);   // 通行證 1 小時有效，快取 50 分鐘
  return idToken;
}

/* ---------------- LINE ---------------- */
function lineToken() {
  const t = PropertiesService.getScriptProperties().getProperty("LINE_TOKEN");
  if (!t) throw new Error("尚未設定 LINE_TOKEN：請到「專案設定 → 指令碼屬性」新增。");
  return t;
}

function pushLine(text) {
  const to = PropertiesService.getScriptProperties().getProperty("GROUP_ID");
  if (!to) throw new Error("還沒有群組 ID：請先把 LINE 官方帳號邀進員工群組。");
  const r = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "post", contentType: "application/json", headers: { Authorization: "Bearer " + lineToken() },
    payload: JSON.stringify({ to, messages: [{ type: "text", text }] }), muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) throw new Error(`LINE 發送失敗(${r.getResponseCode()})：${r.getContentText().slice(0, 300)}`);
}

function replyLine(replyToken, text) {
  UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
    method: "post", contentType: "application/json", headers: { Authorization: "Bearer " + lineToken() },
    payload: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }), muteHttpExceptions: true,
  });
}

// LINE Webhook：只處理「被邀進群組」，記下群組 ID；群組裡的其他訊息一律不讀、不存。
// Apps Script 讀不到 LINE 的簽章標頭，所以「第一次」記下群組後就鎖定，之後不會被改掉(要換群組請執行 resetGroup)。
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const props = PropertiesService.getScriptProperties();
    (body.events || []).forEach((ev) => {
      if (ev.type !== "join" || !ev.source || ev.source.type !== "group") return;
      const cur = props.getProperty("GROUP_ID");
      if (!cur) {
        props.setProperty("GROUP_ID", ev.source.groupId);
        replyLine(ev.replyToken, "✅ 已連結這個群組。\n每天 20:00 如果打烊剩餘還沒填，會在這裡提醒；20:20 再追一次。");
      } else if (cur !== ev.source.groupId) {
        replyLine(ev.replyToken, "這個提醒帳號已經連結到別的群組了，這裡不會收到提醒。");
      }
    });
  } catch (err) { console.error(err); }
  return ContentService.createTextOutput("OK");
}
function doGet() { return ContentService.createTextOutput("OK"); }

/* ---------------- 手動執行用(在編輯器上方選函式 → 執行) ---------------- */
// ① 第一次設定：建立「每分鐘」觸發器(重複執行也只會有一個)
function setup() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "tick").forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("tick").timeBased().everyMinutes(1).create();
  lineToken();
  console.log("✅ 已啟用：每天 %s 檢查，%s 追蹤。群組 ID：%s", CONFIG.FIRST, CONFIG.FOLLOW, PropertiesService.getScriptProperties().getProperty("GROUP_ID") || "(尚未連結，請把官方帳號邀進群組)");
}
// ② 只看今天的狀態，不發訊息(測試 Firebase 連線)
function testStatus() {
  const dk = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");
  const s = checkDay(dk);
  console.log("%s 公休=%s 雞肉已填=%s 餅皮已填=%s", mdw(dk), s.closed, s.chicken, s.dough);
  console.log("若現在是 20:00，會發：\n%s", (s.closed || (s.chicken && s.dough)) ? "(不發)" : buildMessage("first", dk, s));
}
// ③ 發一則測試訊息到群組(測試 LINE)
function testSend() { pushLine("🧪 測試訊息：打烊剩餘提醒已連線。"); console.log("已發送"); }
// ④ 停用提醒
function stopReminder() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "tick").forEach((t) => ScriptApp.deleteTrigger(t));
  console.log("已停用");
}
// ⑤ 換群組：清掉記住的群組 ID，再把官方帳號邀進新群組
function resetGroup() { PropertiesService.getScriptProperties().deleteProperty("GROUP_ID"); console.log("已清除群組 ID"); }

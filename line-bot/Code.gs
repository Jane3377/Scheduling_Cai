/* =====================================================================
 *  蔡叔叔比薩屋：打烊剩餘提醒文字(Google Apps Script)
 *
 *  給 iPhone「捷徑」用：管理者手機每天 20:00、20:20 自動呼叫這個網址，
 *  今天剩餘還沒填 → 回傳提醒文字，捷徑再用 LINE 發到員工群組(管理者本人發，不用官方帳號、不算則數)；
 *  已填好或公休 → 回傳空白，捷徑就不發。
 *
 *  呼叫方式：<網頁應用程式網址>?k=<密碼>&stage=first   (20:00)
 *           <網頁應用程式網址>?k=<密碼>&stage=follow  (20:20)
 *
 *  ⚠ 這份程式碼放在公開的 GitHub，所以不能寫密碼。
 *    密碼放在 Apps Script →「專案設定」→「指令碼屬性」：API_KEY = (自己取一串英數字)
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
};

const DOW = "日一二三四五六";

/* ---------------- 捷徑呼叫的網址 ---------------- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const key = PropertiesService.getScriptProperties().getProperty("API_KEY");
  if (!key) return text("尚未設定 API_KEY");
  if (p.k !== key) return text("密碼錯誤");
  const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");
  const s = checkDay(today);
  if (s.closed || (s.chicken && s.dough)) return text("");       // 公休或都填好 → 空白，捷徑不發
  return text(buildMessage(p.stage === "follow" ? "follow" : "first", today, s));
}
function text(t) { return ContentService.createTextOutput(t).setMimeType(ContentService.MimeType.TEXT); }

function buildMessage(stage, dk, s) {
  const miss = [], missVi = [];
  if (!s.chicken) { miss.push("🍗 雞肉"); missVi.push("gà"); }
  if (!s.dough) { miss.push("🍕 餅皮"); missVi.push("đế bánh"); }
  const day = mdw(dk), dayVi = dmVi(dk);
  // 中文在前、越南文一行在後(越南員工看得懂)；捷徑用「包含 打烊剩餘」判斷，中文字樣不可拿掉
  if (stage === "first") {
    return `🔔 打烊囉！請填 ${day} 的打烊剩餘\n還沒填：${miss.join("、")}\n🇻🇳 Đóng cửa rồi! Vui lòng điền số còn lại ngày ${dayVi}: ${missVi.join(", ")}\n👉 ${CONFIG.STAFF_URL}`;
  }
  return `⚠️ 再提醒：${day} 的打烊剩餘還沒填\n還沒填：${miss.join("、")}\n明天訂雞肉、備餅皮會用到，請盡快填寫\n🇻🇳 Nhắc lại: chưa điền số còn lại ngày ${dayVi}: ${missVi.join(", ")}. Vui lòng điền sớm!\n👉 ${CONFIG.STAFF_URL}`;
}
// 越南文日期：日/月，例如 19/11
function dmVi(dk) { const [, m, d] = dk.split("-").map(Number); return `${d}/${m}`; }

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

/* ---------------- 手動執行用(在編輯器上方選函式 → 執行) ---------------- */
// 只看今天的狀態(測試 Firebase 連線)；在「執行記錄」顯示捷徑會拿到的文字
function testStatus() {
  const dk = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");
  const s = checkDay(dk);
  console.log("%s 公休=%s 雞肉已填=%s 餅皮已填=%s", mdw(dk), s.closed, s.chicken, s.dough);
  console.log("20:00 捷徑會拿到：\n%s", (s.closed || (s.chicken && s.dough)) ? "(空白，不發)" : buildMessage("first", dk, s));
}

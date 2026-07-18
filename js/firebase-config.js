/* ===================================================================
 *  ⬇⬇⬇  Firebase 設定（只要改這個檔案就好）  ⬇⬇⬇
 *
 *  取得方式：
 *  1. 到 https://console.firebase.google.com 建立專案
 *  2. 專案設定（齒輪）→ 一般 → 你的應用程式 → 選「網頁 app（</>）」
 *  3. 複製 firebaseConfig 裡的內容，填到下面對應欄位
 *  4. 到 Firestore Database → 建立資料庫（可先選「測試模式」）
 *  5. 存檔、重新整理網站即可，其他檔案都不用動
 * =================================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyAM2LscZBh9kW-oocrFT5YuZPJc0NKHW9s",
  authDomain: "scheduling-cai.firebaseapp.com",
  projectId: "scheduling-cai",
  storageBucket: "scheduling-cai.firebasestorage.app",
  messagingSenderId: "177249470476",
  appId: "1:177249470476:web:30b4745b0a13e0c286c629"
};
/* ⬆⬆⬆  把上面 6 個引號中間填入你的值即可（沒填就會用「本機暫存」模式） ⬆⬆⬆ */

# 打烊剩餘 LINE 提醒：設定步驟

每天 **20:00** 檢查今天的打烊剩餘，雞肉或餅皮還沒填，就發到員工 LINE 群組。**20:20** 再檢查一次，還沒填就再追一次，之後不再發。

- 公休日不發。
- 兩項都填好就不發。
- 訊息只列出還沒填的項目。
- 連結直接開到員工頁的「今日打烊剩餘」。

```
🔔 打烊囉！請填 11/17(二) 的打烊剩餘
還沒填：🍗 雞肉、🍕 餅皮
👉 https://jane3377.github.io/Scheduling_Cai/index.html?go=stock
```

程式在 `Code.gs`，執行在 Google Apps Script 上。下面的步驟是**先用你自己的 LINE 和 Google 測試**，之後搬到業主帳號時，照「搬家」那一段做即可。

> LINE 和 Google 的畫面偶爾會改版，按鈕名稱可能和這裡寫的略有不同，找意思相近的即可。

---

## 一、建立 LINE 官方帳號（約 10 分鐘）

1. 到 **LINE Official Account Manager**（manager.line.biz），用你的 LINE 登入，建立一個新的官方帳號，例如「比薩屋提醒(測試)」。
2. 在官方帳號的設定裡：
   - **允許加入群組**：「帳號設定」→「功能切換」→「加入群組或多人聊天室」→ 選**接受邀請**。
   - **啟用 Messaging API**：「設定」→「Messaging API」→ 啟用。第一次啟用要建立一個「Provider」，名稱自取，例如「蔡叔叔比薩屋」。
3. 關掉自動回覆，避免它在群組亂回話：「回應設定」裡把**自動回應訊息**、**加入好友的歡迎訊息**關閉，**Webhook 打開**。
4. 到 **LINE Developers**（developers.line.biz）→ 剛才的 Provider → 這個官方帳號的 Channel：
   - 「Messaging API」分頁最下面的 **Channel access token** → 按「Issue」，複製這串金鑰。
   - **這串金鑰不要貼到聊天、GitHub 或任何公開的地方。**

## 二、建立 Google Apps Script（約 10 分鐘）

1. 到 **script.google.com**，按「新專案」，專案名稱改成「比薩屋剩餘提醒」。
2. 把預設的程式碼全部刪掉，貼上 `Code.gs` 的完整內容，按 💾 儲存。
3. 放金鑰：左邊 ⚙「專案設定」→ 最下面「指令碼屬性」→「新增指令碼屬性」：
   - 屬性：`LINE_TOKEN`
   - 值：剛才複製的 Channel access token
   - 按「儲存指令碼屬性」
4. 把時區設成台灣：同一頁「時區」選 **(GMT+08:00) 台北**。
5. 發布成網址，讓 LINE 可以通知它：
   - 右上「部署」→「新增部署作業」→ 齒輪選「**網頁應用程式**」
   - 執行身分：**我**
   - 誰可以存取：**所有人**
   - 按「部署」，第一次會要求授權，用你的 Google 帳號同意。畫面可能出現「Google 尚未驗證這個應用程式」，點「進階」→「前往…」即可，因為這是你自己寫的程式。
   - 複製「網頁應用程式網址」，結尾是 `/exec`。

## 三、把兩邊接起來

1. 回到 **LINE Developers** → Messaging API 分頁 → **Webhook URL** 貼上剛才的 `/exec` 網址，按「Update」，再把 **Use webhook** 打開。
   - 按「Verify」如果顯示錯誤，可以先不管，Apps Script 的網址會轉址，常常驗證不過但實際能用。用下一步實際測試。
2. 把官方帳號**邀進員工 LINE 群組**。測試時建議先開一個只有你自己的測試群組。
3. 群組裡出現「✅ 已連結這個群組」→ 成功。
   - 第一個邀請它的群組會被記住並鎖定。要換群組，先在 Apps Script 執行 `resetGroup`，再邀進新群組。

## 四、測試、啟用

在 Apps Script 編輯器上方的函式選單選好函式，再按「執行」：

| 函式 | 做什麼 |
|---|---|
| `testStatus` | 只讀 Firebase，在「執行記錄」顯示今天是否公休、雞肉／餅皮填了沒，以及 20:00 會發什麼。**不會發訊息** |
| `testSend` | 發一則測試訊息到群組，確認 LINE 通了 |
| `setup` | **正式啟用**：建立每分鐘一次的觸發器。執行一次即可 |
| `stopReminder` | 停用提醒 |
| `resetGroup` | 清除已連結的群組，用來換群組 |

建議順序：`testStatus` → `testSend` → `setup`。

## 常見問題

- **每分鐘執行會不會太多？**
  - 不在 20:00～21:00 時，程式只看時間就結束，不讀 Firebase、不發訊息。
  - 一天實際只讀 Firebase 1～4 次。Google 免費額度和 Firebase 免費額度都綽綽有餘。
- **出錯會怎樣？**
  - Apps Script 會寄信通知你，例如 LINE 金鑰失效或網路錯誤。
  - 「執行」頁面可以看每次的紀錄。
- **金鑰外洩怎麼辦？**
  - 到 LINE Developers 對 Channel access token 按「Reissue」，舊的立刻失效。
  - 再把新的貼回「指令碼屬性」的 `LINE_TOKEN`。
- **Firebase 讀取失敗（403）**
  - 確認 Firebase 的「Authentication → 登入方式」有開啟**匿名**。網站本來就在用，正常是開著的。
  - 如果在 Google Cloud 對 API 金鑰設了「網站限制」，Apps Script 會被擋，要放寬或另外建一把金鑰給它用。
- **LINE 免費則數**
  - 發到群組時，可能按群組人數計算則數。
  - 因為「沒填才發」，員工準時填就不會發。
  - 實際方案請看官方帳號後台的「帳務」說明。

## 搬家到業主帳號時要改的地方

1. 業主建立自己的 LINE 官方帳號，重做「一」。可以把你加為管理員，由你操作。
2. 業主用自己的 Google 帳號重做「二、三、四」，再把 Apps Script 共用給你編輯。
3. `Code.gs` 最上面 `CONFIG` 的三個值改成新的：
   - `FIREBASE_API_KEY`、`FIREBASE_PROJECT_ID`：跟網站 `js/firebase-config.js` 一樣
   - `STAFF_URL`：新的員工頁網址＋`?go=stock`
4. 測試完成後，在你自己的 Apps Script 執行 `stopReminder`，並刪掉你的測試官方帳號，避免兩邊同時發。

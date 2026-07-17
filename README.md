# 蔡叔叔智慧排班 v0.1

這是可直接部署到 GitHub Pages 的靜態原型。

## 已完成
- 主管總覽
- 員工管理
- 工作管理
- 月曆＋日時間軸排班
- 班次新增、修改、刪除
- 休息與計薪工時自動計算
- 可排時間、每週工時、重疊班次警告
- 員工編號登入
- 員工查看班表
- 員工填寫可排時間
- PWA 基本設定

## 資料儲存
目前使用 localStorage，只會保存在目前瀏覽器與裝置。正式版再串接 Firebase。

## GitHub Pages
1. 建立新的 GitHub repository。
2. 上傳本資料夾內所有檔案，不要只上傳外層資料夾。
3. Repository → Settings → Pages。
4. Source 選 Deploy from a branch。
5. Branch 選 main，資料夾選 /(root)。
6. 儲存後等待約 1～3 分鐘。

/* 員工專區 中文／越南文 切換
 * 翻譯範圍：登入、頁首、頁籤名稱、我的班表、填寫可上班時間、今日打烊剩餘(含提醒視窗與訊息)。
 * 餅皮推估、訂購雞肉維持中文。主管在後台輸入的內容(工作名稱、備註、國定假日名稱、填寫期間名稱)不翻譯。
 * 用法：t("中文原文", {變數}) → 目前語言的文字；字典沒有的就顯示中文。
 * 語言存在這支手機(localStorage)，下次打開直接是上次選的語言。
 */
(function (root) {
  "use strict";
  const KEY = "staffLang";
  let lang = "zh";
  try { if (localStorage.getItem(KEY) === "vi") lang = "vi"; } catch (e) {}

  const VI = {
    // 頁首／登入
    "員工班表系統": "Lịch làm việc nhân viên",
    "查看班表與填寫可上班時間": "Xem lịch làm và đăng ký giờ có thể làm",
    "輸入員工編號與 PIN 碼即可進入。": "Nhập mã nhân viên và mã PIN để vào.",
    "員工編號": "Mã nhân viên",
    "PIN碼(4位數)": "Mã PIN (4 số)",
    "進入員工專區": "Vào trang nhân viên",
    "找不到此員工編號，如有疑問請洽主管。": "Không tìm thấy mã nhân viên này. Nếu có thắc mắc, vui lòng hỏi quản lý.",
    "PIN 碼不正確，如有疑問請洽主管。": "Mã PIN không đúng. Nếu có thắc mắc, vui lòng hỏi quản lý.",
    "登出": "Đăng xuất",
    "{name}，你好": "Xin chào, {name}",
    "初始化": "Đang khởi động", "連線中": "Đang kết nối", "已同步": "Đã đồng bộ", "儲存中": "Đang lưu",
    "離線暫存": "Ngoại tuyến (lưu tạm)", "本機模式": "Chế độ máy", "雲端錯誤": "Lỗi đám mây",
    "尚未與雲端同步完成，這次沒有儲存。請等畫面上方顯示「● 已同步」後再試一次。": "Chưa đồng bộ xong nên lần này chưa lưu. Vui lòng chờ phía trên hiện 「● Đã đồng bộ」 rồi thử lại.",
    "目前無法連線雲端，這次沒有儲存，請確認網路後再試。": "Hiện không kết nối được, lần này chưa lưu. Vui lòng kiểm tra mạng rồi thử lại.",
    // 下一班／公布通知／填寫期間
    "下一班": "Ca tiếp theo",
    "目前尚未排班": "Hiện chưa có ca làm",
    "完成排班後會顯示在這裡。": "Ca làm sẽ hiện ở đây sau khi xếp lịch.",
    "未命名工作": "Công việc chưa đặt tên",
    "📢 班表已更新": "📢 Lịch làm đã cập nhật",
    "{ranges} 的班表已公布，記得查看並加入行事曆。": "Lịch làm {ranges} đã được công bố, nhớ xem và thêm vào lịch.",
    "知道了": "Đã hiểu",
    "{name}已開放填寫可上班時間囉": "{name}: đã mở đăng ký giờ có thể làm",
    "開放填寫：{a}～{b}": "Thời gian đăng ký: {a}～{b}",
    "可填日期：{a}～{b}": "Ngày được đăng ký: {a}～{b}",
    "目前尚未開放填寫": "Hiện chưa mở đăng ký",
    "下一次開放：{a}～{b}，填寫 {c}～{d} 的可上班時間。": "Lần mở tiếp theo: {a}～{b}, đăng ký giờ có thể làm cho {c}～{d}.",
    "請等待主管公告下一次填寫期間。": "Vui lòng chờ quản lý thông báo đợt đăng ký tiếp theo.",
    "目前非開放填寫期間，以下為你近三個月填寫的紀錄(僅供檢視，無法修改)。": "Hiện không trong thời gian đăng ký. Dưới đây là giờ bạn đã đăng ký trong 3 tháng gần đây (chỉ xem, không sửa được).",
    // 頁籤
    "我的班表": "Lịch làm của tôi",
    "填寫可上班時間": "Đăng ký giờ làm",
    "今日打烊剩餘": "Kiểm kê cuối ngày",
    // 我的班表
    "顯示即將到來與已結束(前後約三個月)，含備註。": "Hiển thị ca sắp tới và đã qua (khoảng 3 tháng), kèm ghi chú.",
    "列表": "Danh sách", "月曆": "Lịch tháng",
    "📅 加入行事曆": "📅 Thêm vào lịch",
    "Google 行事曆": "Google Lịch",
    "有班": "Có ca", "公休／無班": "Nghỉ / không có ca",
    "即將到來": "Sắp tới", "已結束": "Đã qua",
    "目前沒有即將到來的班表": "Chưa có ca sắp tới",
    "近三個月沒有已結束的班表": "Không có ca nào trong 3 tháng qua",
    "計薪 {h}": "Tính lương {h}",
    "{n} 小時": "{n} giờ",
    "休息 {br}(不計薪)": "Nghỉ {br} (không tính lương)",
    "備註：{note}": "Ghi chú: {note}",
    "公休": "Nghỉ",
    "這一天": "Ngày này",
    "本日店休(公休)": "Hôm nay quán nghỉ",
    "這天沒有排班": "Ngày này không có ca",
    "目前沒有即將到來的已公布班表可加入行事曆。": "Chưa có ca đã công bố sắp tới để thêm vào lịch.",
    "班": "Ca",
    // 填寫可上班時間
    "點日曆上的日期，填那天可以上班的時間；每週時間都差不多的話，用月曆下方「快速設定」一次套用整個月。": "Bấm vào ngày trên lịch để đăng ký giờ có thể làm ngày đó. Nếu mỗi tuần giờ giống nhau, dùng 「Cài đặt nhanh」 bên dưới lịch để áp dụng cả tháng.",
    "※ 填寫可上班時間僅為調查意願，實際排班依最後公布的班表為準。": "※ Đăng ký giờ chỉ để khảo sát nguyện vọng; lịch làm thực tế theo lịch được công bố cuối cùng.",
    "可上班": "Có thể làm", "不可排班": "Không thể làm", "尚未填寫": "Chưa đăng ký",
    "不可排": "Không làm", "可上班(預設)": "Có thể làm (mặc định)", "未填": "Chưa điền",
    "快速設定・每週時間都差不多的人先用這個": "Cài đặt nhanh – dùng nếu giờ mỗi tuần giống nhau",
    "每週": "Mỗi tuần vào", "可以上班": "có thể làm",
    "最早可上班": "Bắt đầu sớm nhất", "最晚可下班": "Về muộn nhất",
    "加第二時段(例如早班＋晚班)": "Thêm khung giờ thứ hai (vd: ca sáng + ca tối)",
    "第二段・最早可上班": "Khung 2 – bắt đầu sớm nhất", "第二段・最晚可下班": "Khung 2 – về muộn nhất",
    "一次套用(每週)為可上班": "Áp dụng (mỗi tuần): có thể làm",
    "改設為(每週)整天不可上班": "Đặt (mỗi tuần): cả ngày không thể làm",
    "先勾選上面的星期，再選時間，按下方按鈕一次套用整月。": "Chọn thứ ở trên, chọn giờ, rồi bấm nút bên dưới để áp dụng cả tháng.",
    "會把 {a}～{b} 的 {names} 設成 {time} 可上班，個別日之後還能改。": "Sẽ đặt {names} trong khoảng {a}～{b} là có thể làm {time}; từng ngày vẫn sửa được sau.",
    "店家公休日，無需填寫": "Ngày quán nghỉ, không cần điền",
    "請先勾選要套用的星期": "Vui lòng chọn thứ cần áp dụng trước",
    "最晚可下班必須晚於最早可上班": "Giờ về phải muộn hơn giờ bắt đầu",
    "第二時段的結束必須晚於開始": "Khung giờ thứ hai: giờ kết thúc phải muộn hơn giờ bắt đầu",
    "第一與第二時段不可重疊": "Khung giờ 1 và 2 không được trùng nhau",
    "結束時間必須晚於開始時間": "Giờ kết thúc phải muộn hơn giờ bắt đầu",
    "已設定 {n} 天可上班": "Đã đặt {n} ngày có thể làm",
    "已設定 {n} 天不可上班": "Đã đặt {n} ngày không thể làm",
    "已填寫": "Đã đăng ký", "預設可上班(未修改)": "Mặc định có thể làm (chưa sửa)",
    "✓ 整天可以": "✓ Làm cả ngày", "✗ 不能上班": "✗ Không thể làm",
    "或指定時段(只設這一天)": "Hoặc chọn khung giờ (chỉ ngày này)",
    "儲存這一天": "Lưu ngày này",
    "{d} 整天可上班，已儲存": "{d}: làm cả ngày, đã lưu",
    "{d} 設為不可上班，已儲存": "{d}: không thể làm, đã lưu",
    "{d} 已儲存": "{d}: đã lưu",
    // 今日打烊剩餘
    "📅 盤點日期：<b>{d}</b>(當日)": "📅 Ngày kiểm kê: <b>{d}</b> (hôm nay)",
    "🍗 剩餘雞肉(隻)": "🍗 Gà còn lại (miếng)",
    "🍕 剩餘餅皮(片)": "🍕 Đế bánh còn lại (cái)",
    "已提交": "Đã gửi",
    "尚未填寫||剩餘": "Chưa điền",
    "🍗 雞腿": "🍗 Đùi gà", "🥩 雞排": "🥩 Gà phi lê", "🪽 雞翅": "🪽 Cánh gà",
    "送出剩餘雞肉": "Gửi số gà còn lại", "送出剩餘餅皮": "Gửi số đế bánh còn lại",
    "厚片": "Đế dày", "薄片": "Đế mỏng", "9 吋": "9 inch", "12 吋": "12 inch",
    "ℹ️ 雞肉與餅皮": "ℹ️ Gà và đế bánh ", "獨立提交、互不影響": "gửi riêng, không ảnh hưởng nhau", "。": ".",
    "腿": "Đùi", "排": "Phi lê", "翅": "Cánh",
    "9吋": "9 inch", "12吋": "12 inch", "厚": "dày ", "薄": "mỏng ",
    "填寫人：": "Người điền: ",
    "已提交後不可重複填寫，如需更正請洽主管。": "Đã gửi thì không điền lại được. Nếu cần sửa, vui lòng báo quản lý.",
    "🍗 雞肉剩餘 已送出": "🍗 Đã gửi số gà còn lại",
    "🍕 餅皮剩餘 已送出": "🍕 Đã gửi số đế bánh còn lại",
    "尚未連線，請確認網路後再送出。": "Chưa kết nối, vui lòng kiểm tra mạng rồi gửi lại.",
    "雞肉剩餘今天已提交，不可重複填寫": "Hôm nay đã gửi số gà còn lại, không điền lại được",
    "餅皮剩餘今天已提交，不可重複填寫": "Hôm nay đã gửi số đế bánh còn lại, không điền lại được",
    "送出失敗：{e}": "Gửi thất bại: {e}",
    "你今天沒有排班": "Hôm nay bạn không có ca",
    "系統顯示你今天沒有上班。\n打烊剩餘一般由當天上班的同事填寫。\n確定要由你來填嗎？": "Hệ thống cho thấy hôm nay bạn không đi làm.\nSố còn lại cuối ngày thường do đồng nghiệp làm ca hôm đó điền.\nBạn chắc chắn muốn tự điền không?",
    "現在還沒打烊喔": "Bây giờ chưa đóng cửa",
    "這一頁是填「打烊後」剩下的雞肉和餅皮。\n現在還不到晚上 6 點，數量可能還會變動。\n確定現在就要填嗎？": "Trang này dùng để điền số gà và đế bánh còn lại 「sau khi đóng cửa」.\nBây giờ chưa tới 6 giờ tối, số lượng có thể còn thay đổi.\nBạn chắc chắn muốn điền ngay không?",
    "先不要": "Để sau", "確定要填寫": "Chắc chắn điền",
  };
  // 越南文星期：週一＝T2 … 週六＝T7、週日＝CN
  const DOW_VI = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

  function t(zh, vars) {
    // 同一句中文在不同地方意思不同時，用「中文||用途」區分；中文畫面只顯示 || 前面
    let s = (lang === "vi" && VI[zh] != null) ? VI[zh] : zh.split("||")[0];
    if (vars) Object.keys(vars).forEach((k) => { s = s.split("{" + k + "}").join(vars[k]); });
    return s;
  }
  // 頁面上寫死的中文(HTML)：只在指定區塊內，逐一替換字典裡有的文字；保留原文以便切回中文
  const STATIC_AREAS = ["#staffLoginCard", ".staff-portal-head", ".staff-main-tabs", "#mySchedulePanel", "#myDaySheetBackdrop", "#stockPanel", "#stockGuard", "#availabilityPanel"];
  function applyStatic() {
    STATIC_AREAS.forEach((sel) => document.querySelectorAll(sel).forEach((area) => {
      const w = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
      let n; while ((n = w.nextNode())) {
        if (n.__zh == null) { const raw = n.nodeValue, key = raw.trim(); if (!key || VI[key] == null) continue; n.__zh = raw; n.__key = key; }
        n.nodeValue = lang === "vi" ? n.__zh.replace(n.__key, VI[n.__key]) : n.__zh;
      }
    }));
    // 月曆星期列
    document.querySelectorAll("#mySchedulePanel .weekdays span, #availabilityPanel .weekdays span").forEach((sp, i) => {
      if (sp.__zh == null) sp.__zh = sp.textContent;
      sp.textContent = lang === "vi" ? DOW_VI[(i + 1) % 7] : sp.__zh;
    });
    // 頁首店名後面的系統名稱
    const bn = document.getElementById("staffBrandName");
    if (bn) { if (bn.__zh == null) bn.__zh = bn.textContent; bn.textContent = lang === "vi" ? bn.__zh.replace("員工班表系統", VI["員工班表系統"]) : bn.__zh; }
    const btn = document.getElementById("langBtn");
    if (btn) btn.textContent = lang === "vi" ? "中文" : "🇻🇳 Tiếng Việt";
    document.documentElement.lang = lang === "vi" ? "vi" : "zh-Hant";
  }
  const listeners = [];
  function setLang(l) {
    lang = l === "vi" ? "vi" : "zh";
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    applyStatic();
    listeners.forEach((f) => { try { f(lang); } catch (e) { console.error(e); } });
  }
  root.I18N = {
    t, setLang, applyStatic, DOW_VI,
    get lang() { return lang; },
    onChange(f) { listeners.push(f); },
  };
})(window);

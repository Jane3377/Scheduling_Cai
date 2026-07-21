
const STORAGE_KEY = "smartSchedulerV01";
// 12 種適合白色字體的深中色調
const COLORS = ["#b23b2e","#c0561f","#8a6d1f","#4f7a34","#2e7d52","#0f7d70","#1f6f8b","#2f5d9c","#4a4a94","#6f4a97","#9a3f68","#575f6e"];
const pad = n => String(n).padStart(2,"0");
const toDateKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today = new Date();
const todayKeyInit = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
const state = {
  view:"dashboard",
  calendarDate:new Date(today.getFullYear(),today.getMonth(),1),
  selectedDate:todayKeyInit,
  scheduleMode:"day",
  calendarExpanded:false,
  settingsTab:"store",
  demandWeekday:new Date().getDay(),
  hoursWeek:todayKeyInit,
  hoursMode:"week",           // week | month
  hoursSort:{key:"name",dir:1}, // key: name | total
  hoursType:"all",            // 身分類型篩選
  hoursSearch:"",
  hoursExpanded:null,         // 展開明細的員工 id
  availPage:"settings",
  availMode:"month",
  availCalDate:new Date(today.getFullYear(),today.getMonth(),1),
  availDate:todayKeyInit,
  availEmployeeId:null,
  data:null
};

// 預設為空白，讓店家直接 key in 正式資料
function defaultData(){
  return {
    employees:[], workTypes:[], availability:[], shifts:[],
    settings:{
      storeName:"", businessStart:"08:30", businessEnd:"21:00", timeStep:30,
      closedDays:[], breakStart:"14:30", breakEnd:"16:00", foreignDefaultLimit:20,
      defaultBreak:90, weekStartsOn:1, adminPin:"1234",
      dailyDemand:[], holidays:[], nationalHolidays:[], availabilityWindows:[]
    }
  };
}
function migrate(d){
  if(!d||!d.employees)return defaultData();
  d.employees.forEach(e=>{
    e.primaryWeekday=e.primaryWeekday||[];
    e.primaryWeekend=e.primaryWeekend||[];
    e.shiftClass=e.shiftClass||"一般";
    e.noBreak=e.noBreak||false;
    e.note=e.note||""; // 員工備註（例如勞健保註記）
    e.hourlyWage=Number(e.hourlyWage)||0; // 時薪（用於人力成本試算）
    if(e.employmentType==="兼職")e.employmentType="工讀"; // 舊類型對應
  });
  (d.workTypes||[]).forEach(w=>{
    if(w.applyBreak===undefined)w.applyBreak=Number(w.defaultBreak||0)>0; // 由舊的預設休息分鐘推導
    w.applyDays=w.applyDays||"all"; // all=不限、weekday=僅平日、weekend=僅假日
  });
  ((d.settings&&d.settings.dailyDemand)||[]).forEach(r=>{r.note=r.note||""});
  // 既有班次一律視為已公布（沿用先前行為，避免升級後員工端班表突然消失）；新建班次才是草稿
  (d.shifts||[]).forEach(s=>{if(s.published===undefined)s.published=true});
  return d;
}
function save(){Cloud.save(state.data);renderAll()}
function byId(id){return document.getElementById(id)}
function employee(id){return state.data.employees.find(x=>x.id===id)}
function worktype(id){return state.data.workTypes.find(x=>x.id===id)}
function isWeekendDay(wd){return wd===0||wd===6||wd===7} // 六、日、以及固定班次的「國定假日(7)」都算假日
// 固定班次分頁的標籤：7 = 國定假日
function dayLabel(wd){return wd===7?"國定假日":"星期"+"日一二三四五六"[wd]}
// 工作是否適用於某個星期（wd：0=日…6=六）。all=不限、weekday=僅平日、weekend=僅假日
function workAppliesOnWeekday(w,wd){const d=(w&&w.applyDays)||"all";return d==="all"||(d==="weekend"?isWeekendDay(wd):!isWeekendDay(wd))}
// 依實際日期判斷（含國定假日）。all=不限、weekday=僅平日、weekend=僅假日
function workAppliesOnDate(w,dateKey){const d=(w&&w.applyDays)||"all";return d==="all"||(d==="weekend"?isHolidayDate(dateKey):!isHolidayDate(dateKey))}
function worksForWeekday(wd,selectedId=""){return state.data.workTypes.filter(w=>w.active&&(workAppliesOnWeekday(w,wd)||w.id===selectedId))}
function worksForDate(dateKey,selectedId=""){return state.data.workTypes.filter(w=>w.active&&(workAppliesOnDate(w,dateKey)||w.id===selectedId))}
function mins(t){const [h,m]=t.split(":").map(Number);return h*60+m}
function settings(){
  const s=state.data.settings=state.data.settings||{};
  s.businessStart=s.businessStart||"08:30";
  s.businessEnd=s.businessEnd||"21:00";
  s.timeStep=Number(s.timeStep)||30;
  s.closedDays=s.closedDays||[];
  s.breakStart=s.breakStart||"14:30";
  s.breakEnd=s.breakEnd||"16:00";
  s.foreignDefaultLimit=s.foreignDefaultLimit==null?20:Number(s.foreignDefaultLimit);
  s.adminPin=s.adminPin||"1234";
  s.dailyDemand=s.dailyDemand||[];
  s.holidays=s.holidays||[];
  s.nationalHolidays=s.nationalHolidays||[];
  s.autoAvailableDates=s.autoAvailableDates||[]; // 持久保存的「預設全部可上班」日期，不隨區段增刪而消失
  s.autoPurgeDays=s.autoPurgeDays==null?365:Number(s.autoPurgeDays); // 超過幾天自動清除舊資料（0＝不清除），預設 365
  s.publishLog=s.publishLog||[]; // 班表公布紀錄（給員工端顯示「幾號～幾號已更新」）
  return s;
}
// 內建臺灣國定假日（僅供標示、參考用，可自行增刪；是否公休由店家自訂）
// 註：2027 農曆假日與補假為預估，正式日期以行政院公告為準。
const TW_HOLIDAYS=[
  ["2026-01-01","元旦"],["2026-02-16","除夕"],["2026-02-17","春節"],["2026-02-18","春節"],["2026-02-19","春節"],
  ["2026-02-28","和平紀念日"],["2026-04-04","兒童節"],["2026-04-05","清明節"],["2026-04-06","清明節補假"],
  ["2026-05-01","勞動節"],["2026-06-19","端午節"],["2026-09-25","中秋節"],["2026-09-28","教師節"],
  ["2026-10-10","國慶日"],["2026-10-25","臺灣光復節"],["2026-12-25","行憲紀念日"],
  ["2027-01-01","元旦"],["2027-02-05","除夕"],["2027-02-06","春節"],["2027-02-07","春節"],["2027-02-08","春節"],
  ["2027-02-28","和平紀念日"],["2027-03-01","和平紀念日補假"],["2027-04-04","兒童節"],["2027-04-05","清明節"],["2027-04-06","補假"],
  ["2027-05-01","勞動節"],["2027-06-09","端午節"],["2027-09-15","中秋節"],["2027-09-28","教師節"],
  ["2027-10-10","國慶日"],["2027-10-11","國慶日補假"],["2027-10-25","臺灣光復節"],["2027-12-25","行憲紀念日"]
];
function overlapMinutes(aS,aE,bS,bE){return Math.max(0,Math.min(aE,bE)-Math.max(aS,bS))}
// 自動休息：固定早班（員工班別免扣）優先；否則「工作設定為套用休息」且班次涵蓋店家休息時段時，依重疊時間扣除。
function breakForShift(s){
  const emp=s.employeeId?employee(s.employeeId):null;
  if(emp&&emp.noBreak)return 0; // 平日早班等固定早班人員：上班不扣休息
  const w=worktype(s.workTypeId);
  if(!w||!w.applyBreak)return 0;
  const cfg=settings();
  if(!cfg.breakStart||!cfg.breakEnd)return 0;
  return overlapMinutes(mins(s.start),mins(s.end),mins(cfg.breakStart),mins(cfg.breakEnd));
}
function durationHours(s){return Math.max(0,(mins(s.end)-mins(s.start)-breakForShift(s))/60)}
// 是否已填實際打卡時間
function shiftHasActual(s){return !!(s.actualStart&&s.actualEnd)}
// 實際工時：有填打卡時間就用打卡時間（同樣扣除休息），否則用表訂時間
function shiftActualHours(s){return shiftHasActual(s)?durationHours({...s,start:s.actualStart,end:s.actualEnd}):durationHours(s)}
function holidays(){return settings().holidays}
function nationalHolidays(){return settings().nationalHolidays}
function nationalHolidayName(dateKey){return (nationalHolidays().find(h=>h.date===dateKey)||{}).name||""}
function isClosedDay(dateKey){
  if(holidays().some(h=>h.date===dateKey))return true; // 特定休息日（臨時公休／設為公休的國定假日）
  return settings().closedDays.includes(new Date(dateKey+"T00:00:00").getDay()); // 每週固定公休
}
function closedReason(dateKey){
  const h=holidays().find(x=>x.date===dateKey);
  if(h)return h.note||"休息日";
  if(settings().closedDays.includes(new Date(dateKey+"T00:00:00").getDay()))return "每週公休";
  return "";
}
// 全站統一「假日」定義：週六、週日，或有標示的國定假日；其餘為平日。
function isHolidayDate(dateKey){const d=new Date(dateKey+"T00:00:00").getDay();if(d===0||d===6)return true;return !!nationalHolidayName(dateKey)}
function isWeekend(dateKey){return isHolidayDate(dateKey)}
function fmtHours(n){return Number.isInteger(n)?`${n} 小時`:`${n.toFixed(1)} 小時`}
function formatDate(key){const d=new Date(key+"T00:00:00");return `${d.getMonth()+1}/${d.getDate()}（${"日一二三四五六"[d.getDay()]}）`}
function weekRange(dateKey){
  const d=new Date(dateKey+"T00:00:00"), day=d.getDay(), diff=(day+6)%7;
  const start=new Date(d);start.setDate(d.getDate()-diff);const end=new Date(start);end.setDate(start.getDate()+6);
  return [toDateKey(start),toDateKey(end)]
}
function weeklyHours(employeeId,dateKey,excludeShiftId=null){
  const [a,b]=weekRange(dateKey);
  return state.data.shifts.filter(s=>s.employeeId===employeeId&&s.id!==excludeShiftId&&s.date>=a&&s.date<=b).reduce((n,s)=>n+durationHours(s),0)
}
function timeOptions(selected=""){
  const cfg=settings();
  const step=cfg.timeStep||30;
  const start=mins(cfg.businessStart||"08:30"),end=mins(cfg.businessEnd||"21:00");
  let out="";
  // 若目前選定值不在營業區間（例如既有班次），仍保留該選項避免遺失。
  if(selected&&(mins(selected)<start||mins(selected)>end))out+=`<option selected>${selected}</option>`;
  for(let m=start;m<=end;m+=step){const h=Math.floor(m/60)%24,t=`${pad(h)}:${pad(m%60)}`;out+=`<option ${t===selected?"selected":""}>${t}</option>`}
  return out
}
function uid(prefix){return prefix+Math.random().toString(36).slice(2,9)}

function setView(view){
  state.view=view;
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  byId(view+"View").classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  const meta={
    dashboard:["營運總覽","快速掌握本月排班與人力狀況"],
    employees:["員工管理","設定員工編號、可做工作與工時上限"],
    worktypes:["工作項目","設定工作名稱、顏色與休息規則"],
    schedule:["排班管理","以月曆與日時間軸快速完成排班"],
    hours:["工時統計","查看每位員工的計薪工時（可切週／月），並核對打卡"],
    availability:["可上班時間","開放員工填寫，並檢視每個人填寫的可上班時間"],
    storeSettings:["設定與維護","店名、上班時間、公休、休息時段與資料維護"],
  }[view];
  byId("pageTitle").textContent=meta[0];byId("pageSubtitle").textContent=meta[1];
  toggleSidebar(false);
  renderAll();
}
// 手機側欄開關（含背景遮罩）；force=false 強制關閉
function toggleSidebar(force){
  const sb=byId("sidebar"),bd=byId("sidebarBackdrop");if(!sb)return;
  const open=force===undefined?!sb.classList.contains("open"):force;
  sb.classList.toggle("open",open);
  if(bd)bd.classList.toggle("hidden",!open);
}
function applyBranding(){
  const name=(settings().storeName||"").trim();
  const full=name?`${name}排班管理系統`:"排班管理系統";
  const bn=byId("brandName");if(bn)bn.textContent=name||"排班管理系統";
  const bm=byId("brandMark");if(bm&&name)bm.textContent=name.slice(0,1);
  const pt=byId("pinTitle");if(pt)pt.textContent=full;
  const pbm=byId("pinBrandMark");if(pbm&&name)pbm.textContent=name.slice(0,1);
  document.title=`${full}｜主管後台`;
}
function syncAvailPage(){
  document.querySelectorAll("#availPageTabs .staff-tab").forEach(b=>b.classList.toggle("active",b.dataset.atab===state.availPage));
  byId("availSettingsPanel")?.classList.toggle("hidden",state.availPage!=="settings");
  byId("availOverviewPanel")?.classList.toggle("hidden",state.availPage!=="overview");
}
function syncSettingsTab(){
  document.querySelectorAll("#settingsTabs .staff-tab").forEach(b=>b.classList.toggle("active",b.dataset.sec===state.settingsTab));
  document.querySelectorAll("#storeSettingsView .settings-section").forEach(el=>el.classList.toggle("hidden",el.dataset.sec!==state.settingsTab));
}
function renderAll(){
  // 逐一保護：即使某個區塊出錯，也不讓整個畫面變空白
  [applyBranding,renderDashboard,renderEmployees,renderWorktypes,renderCalendar,renderSchedule,renderAvailabilityWindows,renderHours,renderAvailabilityOverview,syncAvailPage,renderStoreSettings,renderDemand,renderHolidays,renderNationalHolidays,renderMaintenance,syncSettingsTab]
    .forEach(fn=>{try{fn()}catch(err){console.error("render error:",fn.name,err)}});
}
function renderDashboard(){
  const todayKey=toDateKey(today);
  const fill=windowFillStatus(currentWindow());
  renderDashboardWeek(todayKey);
  byId("todayLabel").textContent=formatDate(todayKey);
  const selected=state.data.shifts.filter(s=>s.date===todayKey).sort((a,b)=>mins(a.start)-mins(b.start));
  byId("todayShifts").innerHTML=selected.length?selected.map(shiftListItem).join(""):`<div class="empty-state">今天尚未排班</div>`;
  const warns=[];
  if(fill&&fill.unfilled.length&&!fill.window.defaultAvailable)warns.push({t:`${fill.unfilled.length} 人尚未填寫可上班時間`,d:fill.unfilled.map(e=>e.name).join("、")});
  // 未指派員工的班次（只看今天以後，過去的不再提醒；附上日期方便找）
  const unassignedShifts=state.data.shifts.filter(s=>!s.employeeId&&s.date>=todayKey).sort((a,b)=>a.date.localeCompare(b.date));
  if(unassignedShifts.length){
    const dates=[...new Set(unassignedShifts.map(s=>formatDate(s.date)))];
    warns.push({t:`${unassignedShifts.length} 個班次尚未指派員工`,d:`日期：${dates.slice(0,5).join("、")}${dates.length>5?" 等":""}｜點此跳到該日排班指派`,go:unassignedShifts[0].date});
  }
  // 未公布的即將到來班次（員工看不到）
  const draftUpcoming=state.data.shifts.filter(s=>s.published===false&&s.date>=todayKey).sort((a,b)=>a.date.localeCompare(b.date));
  if(draftUpcoming.length){
    const dw=[...new Set(draftUpcoming.map(s=>formatDate(s.date)))];
    warns.push({t:`${draftUpcoming.length} 個班次尚未公布`,d:`日期：${dw.slice(0,5).join("、")}${dw.length>5?" 等":""}｜點此跳到該週按「公布本週」`,go:draftUpcoming[0].date});
  }
  selected.forEach(s=>{
    const e=employee(s.employeeId);if(!e)return; // 未指派的班次不在此提醒
    const a=state.data.availability.find(x=>x.employeeId===s.employeeId&&x.date===s.date);
    if(a&&!a.unavailable&&(s.start<a.start||s.end>a.end))warns.push({t:`${e.name} 的班次超出可上班時間`,d:"請於排班頁確認"});
    if(weeklyHours(e.id,s.date)>e.weeklyLimit)warns.push({t:`${e.name} 本週已超過 ${e.weeklyLimit} 小時`,d:"請於排班頁確認"});
  });
  state.data.employees.filter(e=>e.active&&e.employmentType==="外籍學生").forEach(e=>{
    const wh=weeklyHours(e.id,state.selectedDate);
    if(e.weeklyLimit&&wh>e.weeklyLimit)warns.push({t:`外籍學生 ${e.name} 本週 ${fmtHours(wh)}，超過 ${e.weeklyLimit} 小時上限`,d:"僅提醒，仍可排班"});
  });
  byId("dashboardWarnings").innerHTML=warns.length?warns.map(w=>{
    const inner=`<div class="list-icon">⚠</div><div class="list-main"><strong>${w.t}</strong><span>${w.d}</span></div>`;
    return w.go?`<button class="list-item list-item-link" onclick="gotoScheduleDay('${w.go}')">${inner}</button>`:`<div class="list-item">${inner}</div>`;
  }).join(""):`<div class="empty-state">目前沒有明顯衝突</div>`;
}
// 本週概況：一週七天的班次數與待處理標記，點某天跳到排班
function renderDashboardWeek(todayKey){
  const el=byId("dashboardWeek");if(!el)return;
  const [a,b]=weekRange(todayKey);
  const days=datesInRange(a,b);
  const lbl=byId("weekStripLabel");if(lbl)lbl.textContent=`${formatDate(a)} ～ ${formatDate(b)}`;
  el.innerHTML=days.map(d=>{
    const dd=new Date(d+"T00:00:00");
    const sh=state.data.shifts.filter(s=>s.date===d);
    const closed=isClosedDay(d);
    const drafts=sh.filter(s=>s.published===false).length;
    const unassigned=sh.filter(s=>!s.employeeId).length;
    const isToday=d===todayKey;
    const badge=closed?`<span class="ws-badge closed">公休</span>`:(sh.length?`<span class="ws-badge">${sh.length} 班</span>`:`<span class="ws-badge empty">－</span>`);
    const flags=[
      unassigned?`<span class="ws-flag warn">待指派 ${unassigned}</span>`:"",
      drafts?`<span class="ws-flag draft">未公布 ${drafts}</span>`:""
    ].join("");
    return `<button class="ws-day ${isToday?"today":""} ${closed?"closed":""}" onclick="gotoScheduleDay('${d}')">
      <span class="ws-dow">${"日一二三四五六"[dd.getDay()]}${isToday?"・今天":""}</span>
      <span class="ws-date">${dd.getMonth()+1}/${dd.getDate()}</span>
      ${badge}${flags}
    </button>`;
  }).join("");
}
function gotoScheduleDay(d){state.selectedDate=d;state.scheduleMode="day";setView("schedule");}
function shiftListItem(s){
  const e=employee(s.employeeId),w=worktype(s.workTypeId),c=w?.color||"#999";
  const sub=subWorkText(s),subTxt=sub?`＋${sub}`:"";
  return `<div class="list-item"><div class="list-icon" style="background:${c}22;color:${c}">●</div><div class="list-main"><strong>${e?e.name:"待指派"}｜${w?w.name:"（已刪除工作）"}${subTxt}</strong><span>${s.start}～${s.end}・計薪 ${fmtHours(durationHours(s))}</span></div></div>`
}
function renderEmployees(){
  const q=(byId("employeeSearch")?.value||"").trim().toLowerCase(),f=byId("employeeStatusFilter")?.value||"all";
  const rows=state.data.employees.filter(e=>(!q||e.name.toLowerCase().includes(q)||e.employeeNo.toLowerCase().includes(q))&&(f==="all"||(f==="active"&&e.active)||(f==="inactive"&&!e.active)));
  byId("employeesTable").innerHTML=rows.map(e=>{
    const works=e.allowedWorkTypeIds.map(id=>worktype(id)?.name).filter(Boolean).join("、")||"未設定";
    const pd=(e.primaryWeekday||[]).map(id=>worktype(id)?.name).filter(Boolean).join("、");
    const pw=(e.primaryWeekend||[]).map(id=>worktype(id)?.name).filter(Boolean).join("、");
    const primary=(pd||pw)?`<span class="cell-sub">主要 平日：${pd||"—"}／假日：${pw||"—"}</span>`:"";
    const typeBadge=e.employmentType==="外籍學生"?`<span class="badge warn">外籍學生</span>`:e.employmentType;
    const clsTag=(e.shiftClass&&e.shiftClass!=="一般")?`・${e.shiftClass}`:"";
    const noBreakTag=e.noBreak?` <span class="badge ok">免扣休息</span>`:"";
    const noteLine=(e.note||"").trim()?`<span class="cell-sub note-sub">📝 ${e.note.trim()}</span>`:"";
    return `<tr><td class="employee-name"><strong>${e.name}</strong><span>${typeBadge}${clsTag}${noBreakTag}</span>${noteLine}</td><td>${e.employeeNo}</td><td>${works}${primary}</td><td>${e.weeklyLimit?e.weeklyLimit+" 小時":"未設定"}</td><td><span class="badge ${e.active?"ok":"inactive"}">${e.active?"在職":"停用"}</span></td><td><div class="row-actions"><button class="text-btn" onclick="openEmployeeModal('${e.id}')">編輯</button></div></td></tr>`
  }).join("")||`<tr><td colspan="6"><div class="empty-state">找不到員工</div></td></tr>`;
}
function renderWorktypes(){
  const daysTag={all:"",weekday:`<span class="badge">僅平日</span>`,weekend:`<span class="badge">僅假日</span>`};
  byId("worktypesTable").innerHTML=state.data.workTypes.slice().sort((a,b)=>a.sort-b.sort).map(w=>{
    return `<tr><td class="work-cell"><span class="work-chip" style="background:${w.color}">${w.name}</span>${daysTag[w.applyDays||"all"]||""}</td><td>${w.applyBreak?"是（依店家休息時段扣除）":"否（全額計薪）"}</td><td><span class="badge ${w.active?"ok":"inactive"}">${w.active?"啟用":"停用"}</span></td><td><div class="row-actions"><button class="text-btn" onclick="openWorktypeModal('${w.id}')">編輯</button></div></td></tr>`
  }).join("")||`<tr><td colspan="4"><div class="empty-state">尚未建立工作</div></td></tr>`;
}
function calCell(day,refMonth){
  const key=toDateKey(day);
  const count=state.data.shifts.filter(s=>s.date===key).length;
  const closed=isClosedDay(key),nh=nationalHolidayName(key);
  const muted=refMonth!=null&&day.getMonth()!==refMonth;
  return `<button class="cal-day ${muted?"muted":""} ${closed?"closed":""} ${key===state.selectedDate?"selected":""} ${key===toDateKey(today)?"today":""}" ${closed?`disabled title="${closedReason(key)}"`:`onclick="selectDate('${key}')" ${nh?`title="${nh}"`:""}`}><span>${day.getDate()}</span>${closed?`<span class="cal-closed">休</span>`:(nh?`<span class="cal-holiday">${nh}</span>`:count?`<span class="cal-dot"></span>`:"")}</button>`;
}
function renderCalendar(){
  const grid=byId("calendarGrid");if(!grid)return;
  const tgl=byId("calToggleBtn");if(tgl)tgl.textContent=state.calendarExpanded?"收合月曆":"展開整月";
  let html="";
  if(state.calendarExpanded){
    const d=state.calendarDate,y=d.getFullYear(),m=d.getMonth();
    byId("calendarMonthLabel").textContent=`${y} 年 ${m+1} 月`;
    const first=new Date(y,m,1),start=new Date(y,m,1-((first.getDay()+6)%7));
    for(let i=0;i<42;i++){const day=new Date(start);day.setDate(start.getDate()+i);html+=calCell(day,m);}
  }else{
    // 收合：只顯示選定日期那一週（週一起）
    const a=new Date(state.selectedDate+"T00:00:00");
    byId("calendarMonthLabel").textContent=`${a.getFullYear()} 年 ${a.getMonth()+1} 月`;
    const [ws]=weekRange(state.selectedDate),start=new Date(ws+"T00:00:00");
    for(let i=0;i<7;i++){const day=new Date(start);day.setDate(start.getDate()+i);html+=calCell(day,null);}
  }
  grid.innerHTML=html;
}
/* ---------- 排班：直式時間軸（日／週） ---------- */
const SLOT_H=40;   // 每個時間間隔的像素高度
const HEAD_H=56;   // 欄位表頭高度
function timeAxis(){
  const cfg=settings();
  const startM=mins(cfg.businessStart),endM=mins(cfg.businessEnd),step=cfg.timeStep||30;
  const slots=Math.max(1,Math.round((endM-startM)/step));
  return {startM,endM,step,slots,total:endM-startM,height:Math.max(1,Math.round((endM-startM)/step))*SLOT_H};
}
function timeGutter(axis){
  let ticks="";
  for(let i=0;i<=axis.slots;i++){const t=axis.startM+i*axis.step;ticks+=`<div class="dg-tick" style="top:${i*SLOT_H}px">${pad(Math.floor(t/60))}:${pad(t%60)}</div>`}
  return `<div class="dg-gutter-wrap"><div class="dg-corner"></div><div class="dg-gutter" style="height:${axis.height}px">${ticks}</div></div>`;
}
// 將同一欄中時間重疊的班次分配到並排的「軌道」，避免互相遮住。
function layoutBlocks(shifts){
  const items=shifts.map(s=>({s,st:mins(s.start),en:mins(s.end)})).sort((a,b)=>a.st-b.st||a.en-b.en);
  const res=[];let cluster=[],clusterEnd=-1;
  const flush=()=>{
    const laneEnds=[];
    cluster.forEach(it=>{let lane=laneEnds.findIndex(e=>e<=it.st);if(lane===-1){lane=laneEnds.length;laneEnds.push(it.en)}else laneEnds[lane]=it.en;it.lane=lane});
    const lanes=laneEnds.length;
    cluster.forEach(it=>res.push({s:it.s,lane:it.lane,lanes}));
    cluster=[];clusterEnd=-1;
  };
  items.forEach(it=>{if(cluster.length&&it.st>=clusterEnd)flush();cluster.push(it);clusterEnd=Math.max(clusterEnd,it.en)});
  flush();
  return res;
}
function subWorkText(s){return (s.subWork||"").trim()}
function shiftBlock(s,axis,showWork,lane=0,lanes=1){
  const w=worktype(s.workTypeId),e=employee(s.employeeId);
  const top=((mins(s.start)-axis.startM)/axis.total)*axis.height;
  const h=Math.max(20,((mins(s.end)-mins(s.start))/axis.total)*axis.height);
  const width=100/lanes,left=lane*width;
  const sub=subWorkText(s),subTxt=sub?`＋${sub}`:"";
  const who=e?e.name:"待指派";
  const note=(s.note||"").trim();
  const draft=s.published===false; // 草稿：員工看不到
  const draftCls=draft?" is-draft":"";
  const draftTag=draft?"（草稿）":"";
  const tipAttr=(note||draft)?` title="${((draft?"未公布草稿 ":"")+note).replace(/"/g,'&quot;')}"`:"";
  const style=`top:${top}px;height:${h}px;left:calc(${left}% + 2px);width:calc(${width}% - 4px);background:${w?.color||'#888'}`;
  if(showWork){ // 週檢視：直式文字，先工作＋子工作、再員工，最後備註
    const txt=`${w?w.name:""}${subTxt}｜${who}${note?`｜📝${note}`:""}${draftTag}`;
    return `<button class="dg-block dg-block-vert ${e?"":"unassigned"}${draftCls}"${tipAttr} onclick="event.stopPropagation();openShiftModal('${s.id}')" style="${style}"><span class="dg-swap" onclick="openQuickAssign(event,'${s.id}')" title="快速換人">⇄</span><span class="dg-vert">${txt}</span></button>`;
  }
  const label=`${s.start}–${s.end}${subTxt}`;
  const noteLine=note?`<span class="dg-note">📝 ${note}</span>`:"";
  const draftLine=draft?`<span class="dg-draft">草稿・未公布</span>`:"";
  return `<button class="dg-block ${e?"":"unassigned"}${draftCls}"${tipAttr} onclick="event.stopPropagation();openShiftModal('${s.id}')" style="${style}"><span class="dg-swap" onclick="openQuickAssign(event,'${s.id}')" title="快速換人">⇄</span><strong>${who}</strong><span>${label}</span>${noteLine}${draftLine}</button>`;
}
function isNarrow(){return !!(window.matchMedia&&window.matchMedia("(max-width:760px)").matches);}
function renderSchedule(){
  const grid=byId("scheduleGrid");if(!grid)return;
  document.querySelectorAll("#schedModeTabs .seg-btn").forEach(b=>b.classList.toggle("active",b.dataset.smode===state.scheduleMode));
  const hint=byId("schedHint");if(hint)hint.textContent=isNarrow()?"點班次可編輯；用下方按鈕或每日的＋新增班次。":"點空白時段可新增班次，或在空白處上下拖曳框選時段直接帶入起訖時間；點色塊可編輯、右上角⇄可快速換人。灰色斜紋＝草稿（員工看不到）。";
  if(isNarrow()){renderScheduleList(grid);renderPublishBar();return;}
  const axis=timeAxis();
  if(state.scheduleMode==="week"){
    const [a,b]=weekRange(state.selectedDate),days=datesInRange(a,b);
    byId("selectedDateTitle").textContent=`${formatDate(a)} ～ ${formatDate(b)}`;
    const ws=state.data.shifts.filter(s=>s.date>=a&&s.date<=b);
    byId("selectedDateSummary").textContent=`本週 ${ws.length} 個班次・共 ${fmtHours(ws.reduce((n,s)=>n+durationHours(s),0))}`;
    const cols=days.map(key=>{
      const d=new Date(key+"T00:00:00"),closed=isClosedDay(key);
      const laid=layoutBlocks(state.data.shifts.filter(s=>s.date===key));
      const maxLanes=laid.reduce((m,b)=>Math.max(m,b.lanes),1);
      const cw=Math.max(68,maxLanes*56); // 依重疊班次數自動加寬（固定寬、不撐滿）
      const blocks=laid.map(b=>shiftBlock(b.s,axis,true,b.lane,b.lanes)).join("");
      return `<div class="dg-col" style="flex:0 0 ${cw}px;min-width:${cw}px"><div class="dg-col-head clickable ${key===state.selectedDate?"sel":""} ${key===toDateKey(today)?"today":""}" onclick="selectDate('${key}')"><strong>${d.getMonth()+1}/${d.getDate()}</strong><span>${"日一二三四五六"[d.getDay()]}</span></div><div class="dg-track ${closed?"closed":""}" data-date="${key}" style="height:${axis.height}px;--slot:${SLOT_H}px">${blocks}</div></div>`;
    }).join("");
    grid.innerHTML=`<div class="dg">${timeGutter(axis)}${cols}</div>`;
  }else{
    const nh=nationalHolidayName(state.selectedDate);
    byId("selectedDateTitle").textContent=formatDate(state.selectedDate)+(nh?`・${nh}`:"");
    const dayShifts=state.data.shifts.filter(s=>s.date===state.selectedDate);
    byId("selectedDateSummary").textContent=`${dayShifts.length} 個班次・共 ${fmtHours(dayShifts.reduce((n,s)=>n+durationHours(s),0))}`;
    const usedIds=new Set(dayShifts.map(s=>s.workTypeId)); // 已有班次的工作一律保留顯示
    const works=state.data.workTypes.filter(w=>w.active&&(workAppliesOnDate(w,state.selectedDate)||usedIds.has(w.id))).sort((a,b)=>a.sort-b.sort);
    const closed=isClosedDay(state.selectedDate);
    const cols=works.map(w=>{
      const shifts=dayShifts.filter(s=>s.workTypeId===w.id);
      const laid=layoutBlocks(shifts);
      const maxLanes=laid.reduce((m,b)=>Math.max(m,b.lanes),1);
      const cw=Math.max(100,maxLanes*96); // 同一工作多人同時上班時自動加寬（固定寬、不撐滿）
      const blocks=laid.map(b=>shiftBlock(b.s,axis,false,b.lane,b.lanes)).join("");
      return `<div class="dg-col" style="flex:0 0 ${cw}px;min-width:${cw}px"><div class="dg-col-head" style="border-top-color:${w.color}"><strong>${w.name}</strong><span>${shifts.length} 人</span></div><div class="dg-track ${closed?"closed":""}" data-date="${state.selectedDate}" data-work="${w.id}" style="height:${axis.height}px;--slot:${SLOT_H}px">${blocks}</div></div>`;
    }).join("");
    grid.innerHTML=`<div class="dg">${timeGutter(axis)}${cols||`<div class="empty-state">尚未設定任何工作</div>`}</div>`;
  }
  renderPublishBar();
  wireScheduleGrid(axis);
}
function wireScheduleGrid(axis){
  const fmtMin=m=>`${pad(Math.floor(m/60))}:${pad(m%60)}`;
  const yToMin=(track,clientY)=>{
    const rect=track.getBoundingClientRect();
    const frac=rect.height?Math.max(0,Math.min(1,(clientY-rect.top)/rect.height)):0;
    const m=axis.startM+Math.round((frac*axis.total)/axis.step)*axis.step;
    return Math.max(axis.startM,Math.min(m,axis.endM));
  };
  const addShiftAt=(track,startM,endM)=>{
    const date=track.dataset.date;
    if(isClosedDay(date)&&!confirm("這一天是公休日，確定要排班？"))return;
    const workId=track.dataset.work||worksForDate(date)[0]?.id||state.data.workTypes.find(w=>w.active)?.id||"";
    const prefill={date,workTypeId:workId,start:fmtMin(startM)};
    if(endM!=null)prefill.end=fmtMin(endM);
    openShiftModal(null,prefill);
  };
  document.querySelectorAll("#scheduleGrid .dg-track").forEach(track=>{
    // 點擊空白：沿用原本「起點＋預設時長」新增（含觸控裝置）
    track.addEventListener("click",ev=>{
      if(ev.target.closest(".dg-block"))return;
      if(track.__dragged){track.__dragged=false;return;} // 剛剛是拖曳框選，略過這次 click
      const m=Math.min(yToMin(track,ev.clientY),axis.endM-axis.step); // 保留至少一格
      addShiftAt(track,m,null);
    });
    // 滑鼠拖曳：在時間軸框選一段，放開後帶入起訖時間（觸控維持點擊新增，不進拖曳）
    track.addEventListener("pointerdown",ev=>{
      if(ev.pointerType!=="mouse"||ev.button!==0||ev.target.closest(".dg-block"))return;
      const startM=yToMin(track,ev.clientY);let curM=startM,moved=false;
      const sel=document.createElement("div");sel.className="dg-select";track.appendChild(sel);
      const draw=()=>{const a=Math.min(startM,curM),b=Math.max(startM,curM);sel.style.top=((a-axis.startM)/axis.total*axis.height)+"px";sel.style.height=Math.max(2,(b-a)/axis.total*axis.height)+"px";sel.textContent=`${fmtMin(a)}–${fmtMin(b)}`;};
      draw();
      const onMove=e=>{curM=yToMin(track,e.clientY);if(Math.abs(curM-startM)>=axis.step)moved=true;draw();};
      const onUp=()=>{
        document.removeEventListener("pointermove",onMove);document.removeEventListener("pointerup",onUp);
        sel.remove();
        if(!moved)return; // 沒拖動就當點擊，交給 click 處理
        track.__dragged=true; // 抑制放開後緊接著的 click
        let a=Math.min(startM,curM),b=Math.max(startM,curM);if(b-a<axis.step)b=a+axis.step;
        addShiftAt(track,a,b);
      };
      document.addEventListener("pointermove",onMove);document.addEventListener("pointerup",onUp);
      ev.preventDefault(); // 避免拖曳時反白選字
    });
  });
}
// 手機版排班：清單式（每日分段、點班次即可編輯），取代擠壓的時間軸
function scheduleListRow(s){
  const w=worktype(s.workTypeId),e=employee(s.employeeId);
  const sub=subWorkText(s),subTxt=sub?`＋${sub}`:"";
  const note=(s.note||"").trim();
  const draft=s.published===false;
  return `<button class="sl-shift ${draft?"draft":""} ${e?"":"unassigned"}" onclick="openShiftModal('${s.id}')">
    <span class="sl-time">${s.start}<i>${s.end}</i></span>
    <span class="sl-chip" style="background:${w?.color||'#888'}">${w?w.name:"（已刪除）"}${subTxt}</span>
    <span class="sl-main"><strong>${e?e.name:"待指派"}</strong>${note?`<span class="sl-note">📝 ${note}</span>`:""}${draft?`<span class="sl-draft">草稿・未公布</span>`:""}</span>
    <span class="sl-swap" onclick="openQuickAssign(event,'${s.id}')" title="快速換人">⇄</span>
    <span class="sl-go">✎</span>
  </button>`;
}
function renderScheduleList(grid){
  const isWeek=state.scheduleMode==="week";
  let days;
  if(isWeek){
    const [a,b]=weekRange(state.selectedDate);days=datesInRange(a,b);
    byId("selectedDateTitle").textContent=`${formatDate(a)} ～ ${formatDate(b)}`;
    const ws=state.data.shifts.filter(s=>s.date>=a&&s.date<=b);
    byId("selectedDateSummary").textContent=`本週 ${ws.length} 個班次・共 ${fmtHours(ws.reduce((n,s)=>n+durationHours(s),0))}`;
  }else{
    const nh=nationalHolidayName(state.selectedDate);
    byId("selectedDateTitle").textContent=formatDate(state.selectedDate)+(nh?`・${nh}`:"");
    const ds=state.data.shifts.filter(s=>s.date===state.selectedDate);
    byId("selectedDateSummary").textContent=`${ds.length} 個班次・共 ${fmtHours(ds.reduce((n,s)=>n+durationHours(s),0))}`;
    days=[state.selectedDate];
  }
  const sections=days.map(d=>{
    const dd=new Date(d+"T00:00:00"),closed=isClosedDay(d);
    const shifts=state.data.shifts.filter(s=>s.date===d).sort((a,b)=>mins(a.start)-mins(b.start));
    const head=isWeek?`<div class="sl-dayhead ${d===toDateKey(today)?"today":""}"><strong>${dd.getMonth()+1}/${dd.getDate()}（${"日一二三四五六"[dd.getDay()]}）</strong><span>${closed?"公休":shifts.length+" 班"}</span><button class="text-btn" onclick="openShiftModal(null,{date:'${d}'})">＋ 班次</button></div>`:"";
    const body=closed?`<div class="sl-empty">公休日</div>`:(shifts.length?shifts.map(scheduleListRow).join(""):`<div class="sl-empty">尚未排班</div>`);
    return `<div class="sl-day">${head}${body}</div>`;
  }).join("");
  const addBtn=isWeek?"":`<button class="primary-btn full" style="margin-top:12px" onclick="openShiftModal(null,{date:'${state.selectedDate}'})">＋ 新增班次</button>`;
  grid.innerHTML=`<div class="sched-list">${sections}${addBtn}</div>`;
}
function shiftSchedule(delta){
  const d=new Date(state.selectedDate+"T00:00:00");
  d.setDate(d.getDate()+delta*(state.scheduleMode==="week"?7:1));
  selectDate(toDateKey(d));
}
/* ---------- 匯出班表（Excel/CSV，週或月） ---------- */
function scheduleRows(mode){
  let start,end;
  if(mode==="week"){[start,end]=weekRange(state.selectedDate);}
  else{const d=new Date(state.selectedDate+"T00:00:00");start=toDateKey(new Date(d.getFullYear(),d.getMonth(),1));end=toDateKey(new Date(d.getFullYear(),d.getMonth()+1,0));}
  const days=datesInRange(start,end);
  const dayHead=k=>{const dd=new Date(k+"T00:00:00");return `${dd.getMonth()+1}/${dd.getDate()}(${"日一二三四五六"[dd.getDay()]})`};
  const cellFor=(k,eid)=>state.data.shifts.filter(s=>s.date===k&&s.employeeId===eid).sort((a,b)=>mins(a.start)-mins(b.start))
    .map(s=>{const w=worktype(s.workTypeId),sub=subWorkText(s),note=(s.note||"").trim();return `${w?w.name:""}${sub?`＋${sub}`:""} ${s.start}-${s.end}${note?`〔${note}〕`:""}`}).join(" / ");
  const rows=[["員工",...days.map(dayHead),"合計工時"]];
  state.data.employees.filter(e=>e.active).forEach(e=>{
    let total=0;
    const cells=days.map(k=>{state.data.shifts.filter(s=>s.date===k&&s.employeeId===e.id).forEach(s=>total+=durationHours(s));return cellFor(k,e.id)});
    rows.push([e.name,...cells,fmtNum(total)]);
  });
  // 待指派班次（若有）
  const unassigned=days.map(k=>state.data.shifts.filter(s=>s.date===k&&!s.employeeId).sort((a,b)=>mins(a.start)-mins(b.start)).map(s=>{const w=worktype(s.workTypeId);return `${w?w.name:""} ${s.start}-${s.end}`}).join(" / "));
  if(unassigned.some(x=>x))rows.push(["(待指派)",...unassigned,""]);
  return {rows,start,end};
}
function csvEscape(v){v=String(v==null?"":v);return /[",\n\r]/.test(v)?`"${v.replace(/"/g,'""')}"`:v}
/* ---------- 統一報表匯出（Excel 可開的 CSV，含 BOM、統一檔名） ---------- */
// 檔名格式：店名_報表類型_期間.csv
function reportFileName(type,period){const store=(settings().storeName||"報表").trim();return `${store}_${type}_${period}.csv`;}
// 共用：把 Blob 觸發成瀏覽器下載（建立暫時 anchor 並在稍後釋放 URL）
function triggerDownload(blob,filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
// rows 為二維陣列；統一輸出 UTF-8 BOM 的 CSV
function downloadCSV(filename,rows){
  const csv="﻿"+rows.map(r=>r.map(csvEscape).join(",")).join("\r\n");
  triggerDownload(new Blob([csv],{type:"text/csv;charset=utf-8;"}),filename);
}
function exportSchedule(mode){
  const {rows,start,end}=scheduleRows(mode);
  const period=mode==="week"?`${start}_至_${end}`:start.slice(0,7);
  downloadCSV(reportFileName(mode==="week"?"週班表":"月班表",period),rows);
}
// 列印友善的週班表：開新視窗、乾淨版面、A4 橫向、自動列印（可貼公佈欄）
function printWeekSchedule(){
  const [a,b]=weekRange(state.selectedDate);
  const days=datesInRange(a,b);
  const store=(settings().storeName||"").trim();
  // 只列出本週有排班的在職員工（沒排班的不顯示）
  const actives=state.data.employees.filter(e=>e.active&&state.data.shifts.some(s=>s.employeeId===e.id&&s.date>=a&&s.date<=b));
  const esc=s=>String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
  const dow="日一二三四五六";
  const usedWorks=[...new Set(state.data.shifts.filter(s=>s.date>=a&&s.date<=b).map(s=>s.workTypeId))].map(worktype).filter(Boolean);
  const cellFor=(d,eid)=>{
    const ss=state.data.shifts.filter(s=>s.date===d&&s.employeeId===eid).sort((x,y)=>mins(x.start)-mins(y.start));
    if(!ss.length)return `<span class="off">·</span>`;
    return ss.map(s=>{const w=worktype(s.workTypeId),sub=subWorkText(s),note=(s.note||"").trim();
      return `<div class="pc"><span class="dot" style="background:${w?w.color:'#888'}"></span><b>${esc(w?w.name:'')}${sub?'＋'+esc(sub):''}</b><span class="tm">${s.start}–${s.end}</span>${note?`<span class="nt">📝 ${esc(note)}</span>`:''}</div>`;
    }).join("");
  };
  const body=actives.map((e,i)=>{
    const tds=days.map(d=>isClosedDay(d)?`<td class="cl"><span class="off">公休</span></td>`:`<td>${cellFor(d,e.id)}</td>`).join("");
    return `<tr class="${i%2?'z':''}"><th class="emp">${esc(e.name)}</th>${tds}</tr>`;
  }).join("")||`<tr><td colspan="${days.length+1}" class="off" style="padding:24px">本週尚無排班</td></tr>`;
  const legend=usedWorks.length?`<div class="legend">${usedWorks.map(w=>`<span><i style="background:${w.color}"></i>${esc(w.name)}</span>`).join("")}</div>`:"";
  const html=`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${esc(store)} 週班表 ${a}~${b}</title>
  <style>
    @page{size:A4 landscape;margin:10mm}
    *{box-sizing:border-box}
    body{font-family:-apple-system,"PingFang TC","Noto Sans TC",sans-serif;color:#241f1c;margin:0;padding:14px}
    .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #b94b2f;padding-bottom:8px;margin-bottom:12px}
    .head h1{margin:0;font-size:22px}.head .rng{font-size:16px;color:#555;font-weight:700}
    .legend{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 10px;font-size:12px;color:#555}
    .legend i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:4px;vertical-align:-1px}
    table{width:100%;border-collapse:collapse;table-layout:fixed}
    th,td{border:1px solid #d8cfc8;padding:6px 7px;vertical-align:top;font-size:12px}
    thead th{background:#f6ece7;color:#8f3521;text-align:center;font-size:12.5px}
    thead .dw{display:block;font-size:11px;color:#a06a55;font-weight:400}
    tr.z td,tr.z th{background:#faf7f5}
    .emp{width:96px;text-align:left;background:#fff}.emp span{display:block;color:#888;font-weight:400;font-size:10.5px}
    .tot{width:52px;text-align:center;font-weight:700;background:#fff}
    td.cl{background:#f1eeec}
    .pc{margin-bottom:4px;line-height:1.35}
    .pc:last-child{margin-bottom:0}
    .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;vertical-align:0}
    .pc b{font-weight:700}.tm{display:block;color:#555;font-size:11px;margin-left:13px}
    .nt{display:block;color:#b94b2f;font-size:10.5px;margin-left:13px}
    .off{color:#bbb}
    .foot{margin-top:10px;font-size:11px;color:#888;display:flex;justify-content:space-between}
    @media print{.noprint{display:none}}
    .noprint{margin-top:14px;text-align:center}
    .noprint button{font-size:15px;padding:10px 22px;border-radius:10px;border:0;background:#b94b2f;color:#fff;cursor:pointer}
  </style></head><body>
    <div class="head"><h1>${esc(store||"週班表")}${store?"　週班表":""}</h1><div class="rng">${formatDate(a)} ～ ${formatDate(b)}</div></div>
    ${legend}
    <table>
      <thead><tr><th class="emp">員工</th>${days.map(d=>{const dd=new Date(d+"T00:00:00");return `<th>${dd.getMonth()+1}/${dd.getDate()}<span class="dw">星期${dow[dd.getDay()]}</span></th>`}).join("")}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    <div class="foot"><span>實際排班以最新公布的班表為準。</span><span>列印時間：${new Date().toLocaleString("zh-TW")}</span></div>
    <div class="noprint"><button onclick="window.print()">🖨 列印 / 另存 PDF</button></div>
  </body></html>`;
  const win=window.open("","_blank");
  if(!win){toast("瀏覽器阻擋了新視窗，請允許彈出視窗後再試。","error");return;}
  win.document.write(html);win.document.close();win.focus();
  setTimeout(()=>{try{win.print()}catch(e){}},400);
}
// 列印／存 PDF 的一頁式使用說明（給業主當紙本）
function printGuide(){
  const store=(settings().storeName||"蔡叔叔比薩屋").trim();
  const html=`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${store}排班系統 使用說明</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif;color:#2f2a26;margin:0;padding:26px 30px;line-height:1.55}
    h1{font-size:22px;margin:0 0 2px}
    .sub{color:#8a817b;font-size:13px;margin:0 0 16px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 22px}
    .box{border:1px solid #e6ddd6;border-radius:10px;padding:12px 14px;break-inside:avoid}
    .box h2{font-size:15px;margin:0 0 7px;color:#b94b2f}
    .box ol,.box ul{margin:0;padding-left:18px}
    .box li{font-size:12.5px;margin:3px 0}
    b{color:#2f2a26}
    .tip{grid-column:1/3;background:#fff6ef;border:1px solid #f0d9c9;border-radius:10px;padding:10px 14px;font-size:12.5px}
    .foot{margin-top:14px;color:#8a817b;font-size:11px;display:flex;justify-content:space-between}
    .noprint{margin-top:16px}
    .noprint button{font-size:14px;padding:9px 16px;border:0;border-radius:8px;background:#b94b2f;color:#fff;cursor:pointer}
    @media print{.noprint{display:none}body{padding:0}}
  </style></head><body>
    <h1>${store}｜智慧排班系統 使用說明</h1>
    <p class="sub">兩個入口：後台管理（主管，輸入 PIN）／員工班表系統（員工，輸入編號）。右上角狀態燈可確認資料是否已同步。</p>
    <div class="grid">
      <div class="box"><h2>🚀 第一次設定（只做一次）</h2><ol>
        <li><b>設定與維護→店家設定</b>：店名、營業與休息時段</li>
        <li><b>工作項目</b>：建立工作、顏色、平日/假日、是否扣休息</li>
        <li><b>員工管理</b>：編號、身份、時薪、可做工作、主要負責、勞健保備註</li>
        <li><b>國定假日</b>一鍵匯入；<b>特定休息日</b>設公休</li>
        <li><b>排班管理→固定班次設定</b>：建好每週固定的樣子</li>
      </ol></div>
      <div class="box"><h2>📅 每週怎麼排班</h2><ol>
        <li>可上班時間→<b>開放填下週/下個月</b>讓員工填</li>
        <li>排班管理按<b>套用固定班次</b>（自動排、補人、不重複）</li>
        <li>微調：空白處<b>拖曳框選</b>新增；班次上<b>⇄</b>換人</li>
        <li>按<b>公布本週</b>員工才看得到；可列印週班表</li>
      </ol></div>
      <div class="box"><h2>🔄 開放填可上班時間</h2><ul>
        <li>用「開放填下週/下個月」快捷，日期自動帶好</li>
        <li>勾「預設全部可上班」→ 只標記請假的人</li>
        <li>檢視與代填：主管可直接幫員工勾選</li>
      </ul></div>
      <div class="box"><h2>⏱ 對帳與報表</h2><ul>
        <li>工時統計：週/月、排序、篩選、搜尋、展開明細</li>
        <li>打卡對照：填實際上下班、打勾確認</li>
        <li>人力成本（時薪×工時）、下載 CSV 給會計</li>
      </ul></div>
      <div class="box"><h2>📱 員工怎麼用</h2><ul>
        <li>輸入員工編號登入</li>
        <li>我的班表：看班表、一鍵加入 iPhone／Google 行事曆</li>
        <li>填寫可上班時間：月曆勾選、快速設定整週</li>
      </ul></div>
      <div class="box"><h2>❓ 常見問題</h2><ul>
        <li><b>草稿/公布</b>：灰斜紋＝草稿，公布後員工才看到</li>
        <li><b>假日</b>：六日與國定假日算假日</li>
        <li><b>外籍工時</b>：超時會提醒但仍可排</li>
        <li><b>備份</b>：定期匯出完整備份保存</li>
      </ul></div>
      <div class="tip">💡 <b>總覽</b>會即時提醒「有班次沒排人 / 沒公布」，點提醒可直接跳到那一天處理。刪除、覆蓋等重要動作仍會跳出確認視窗。</div>
    </div>
    <div class="foot"><span>${store} 排班系統</span><span>列印時間：${new Date().toLocaleString("zh-TW")}</span></div>
    <div class="noprint"><button onclick="window.print()">🖨 列印 / 另存 PDF</button></div>
  </body></html>`;
  const win=window.open("","_blank");
  if(!win){toast("瀏覽器阻擋了新視窗，請允許彈出視窗後再試。","error");return;}
  win.document.write(html);win.document.close();win.focus();
  setTimeout(()=>{try{win.print()}catch(e){}},400);
}
// 統一的「下載 CSV」選擇器：先選週統計或月統計，再下載
function openCsvChooser(subtitle,onPick){
  openModal("下載 CSV",subtitle,`
    <div class="csv-choose">
      <button type="button" class="secondary-btn" data-pick="week">📅 週統計<span>目前選取日期所屬的那一週</span></button>
      <button type="button" class="secondary-btn" data-pick="month">🗓 月統計<span>目前選取日期所屬的整個月</span></button>
    </div>
    <div class="modal-actions"><button type="button" class="ghost-btn" onclick="closeModal()">取消</button></div>`);
  document.querySelectorAll(".csv-choose [data-pick]").forEach(b=>b.onclick=()=>{const m=b.dataset.pick;closeModal();onPick(m);});
}
// 工時統計匯出（週或月、依篩選與排序）
function exportHours(mode){
  const p=hoursPeriod(mode);
  const q=state.hoursSearch.trim().toLowerCase();
  const list=state.data.employees.filter(e=>e.active
    &&(state.hoursType==="all"||e.employmentType===state.hoursType)
    &&(!q||e.name.toLowerCase().includes(q)||(e.employeeNo||"").toLowerCase().includes(q)));
  const data=list.map(e=>{
    const ps=periodShifts(e.id,p.start,p.end);
    const sched=ps.reduce((n,s)=>n+durationHours(s),0);
    const actual=ps.reduce((n,s)=>n+shiftActualHours(s),0);
    return {e,sched,actual,diff:actual-sched,v:ps.filter(s=>s.verified).length,total:ps.length};
  });
  const {key,dir}=state.hoursSort;
  data.sort((a,b)=>key==="total"?(a.sched-b.sched)*dir:a.e.name.localeCompare(b.e.name,"zh-Hant")*dir);
  const rows=[["員工","員工編號","身分","每週上限","時薪","表訂工時","實際工時","差異","預估薪資","已核對"]];
  data.forEach(d=>{const wage=Number(d.e.hourlyWage)||0;rows.push([d.e.name,d.e.employeeNo,d.e.employmentType,d.e.weeklyLimit||"",wage||"",fmtNum(d.sched),fmtNum(d.actual),(d.diff>0?"+":"")+fmtNum(d.diff),wage?Math.round(d.sched*wage):"",`${d.v}/${d.total}`]);});
  const period=p.mode==="month"?p.start.slice(0,7):`${p.start}_至_${p.end}`;
  downloadCSV(reportFileName(p.mode==="month"?"月工時統計":"週工時統計",period),rows);
}
// 可上班時間匯出（週或月，以檢視中的日期／月份為準）
function exportAvailability(mode){
  let start,end,period;
  if(mode==="month"){const d=state.availCalDate;start=toDateKey(new Date(d.getFullYear(),d.getMonth(),1));end=toDateKey(new Date(d.getFullYear(),d.getMonth()+1,0));period=start.slice(0,7);}
  else{[start,end]=weekRange(state.availDate||toDateKey(today));period=`${start}_至_${end}`;}
  const days=datesInRange(start,end);
  const dayHead=k=>{const dd=new Date(k+"T00:00:00");return `${dd.getMonth()+1}/${dd.getDate()}(${"日一二三四五六"[dd.getDay()]})`};
  const rows=[["員工",...days.map(dayHead)]];
  state.data.employees.filter(e=>e.active).forEach(e=>{
    const cells=days.map(k=>{
      if(isClosedDay(k))return "公休";
      const a=effectiveAvail(e.id,k);
      if(!a)return "未填";
      if(a.unavailable)return "不可";
      return `${a.start}-${a.end}${a._default?"(預設)":""}`;
    });
    rows.push([e.name,...cells]);
  });
  downloadCSV(reportFileName("可上班時間",period),rows);
}


function getAvailabilityWindows(){
  state.data.settings=state.data.settings||{};
  state.data.settings.availabilityWindows=state.data.settings.availabilityWindows||[];
  return state.data.settings.availabilityWindows;
}
function windowStatus(w){
  const now=toDateKey(new Date());
  if(!w.enabled)return {label:"停用",cls:"inactive"};
  if(now<w.openStart)return {label:"尚未開放",cls:"warn"};
  if(now>w.openEnd)return {label:"已截止",cls:"inactive"};
  return {label:"開放中",cls:"ok"};
}
function renderAvailabilityWindows(){
  const el=byId("availabilityWindowCards");
  if(!el)return;
  const windows=getAvailabilityWindows().slice().sort((a,b)=>a.openStart.localeCompare(b.openStart));
  el.innerHTML=windows.length?windows.map(w=>{
    const st=windowStatus(w);
    return `<article class="window-card">
      <div class="window-card-head">
        <div>
          <span class="eyebrow">填寫區段</span>
          <h3>${w.name}</h3>
        </div>
        <span class="badge ${st.cls}">${st.label}</span>
      </div>
      <div class="window-flow">
        <div><span>開放填寫期間</span><strong>${formatDate(w.openStart)} ～ ${formatDate(w.openEnd)}</strong></div>
        <div class="flow-arrow">→</div>
        <div><span>可填寫排班日期</span><strong>${formatDate(w.targetStart)} ～ ${formatDate(w.targetEnd)}</strong></div>
      </div>
      ${w.defaultAvailable?`<p class="window-note">預設全部可上班：未特別標記的員工當作整天可上班，只需標記請假者。</p>`:""}
      ${w.note?`<p class="window-note">${w.note}</p>`:""}
      <div class="work-card-actions">
        <button class="secondary-btn" onclick="openAvailabilityWindowModal('${w.id}')">編輯設定</button>
      </div>
    </article>`
  }).join(""):`<div class="panel empty-state">尚未建立開放填寫區段</div>`;
}
// 一鍵開放：算好下週（週一～週日）的日期，開啟已填好的新增視窗，主管確認即可存
function openNextWeekWindow(){
  const [ts,te]=weekRange(addDays(toDateKey(today),7));
  const d1=new Date(ts+"T00:00:00"),d2=new Date(te+"T00:00:00");
  openAvailabilityWindowModal(null,{name:`下週可上班時間（${d1.getMonth()+1}/${d1.getDate()}–${d2.getMonth()+1}/${d2.getDate()}）`,openStart:toDateKey(today),openEnd:addDays(ts,-1),targetStart:ts,targetEnd:te});
}
// 一鍵開放：算好下個月整月的日期
function openNextMonthWindow(){
  const first=new Date(today.getFullYear(),today.getMonth()+1,1),last=new Date(today.getFullYear(),today.getMonth()+2,0);
  const ts=toDateKey(first),te=toDateKey(last);
  openAvailabilityWindowModal(null,{name:`${first.getMonth()+1}月可上班時間`,openStart:toDateKey(today),openEnd:addDays(ts,-1),targetStart:ts,targetEnd:te});
}
function openAvailabilityWindowModal(id=null,prefill=null){
  const windows=getAvailabilityWindows();
  const w=id?windows.find(x=>x.id===id):{
    id:uid("aw"),name:"",openStart:"",openEnd:"",targetStart:"",targetEnd:"",enabled:true,note:"",defaultAvailable:false,
    ...(prefill||{})
  };
  const tk=toDateKey(today);
  // 只有「新增」才限制最早今天；「編輯」既有區段不加 min，避免原本已開始（日期早於今天）的欄位被瀏覽器清成空白
  const minAttr=id?"":`min="${tk}"`;
  openModal(id?"編輯開放區段":"新增開放區段","設定員工可進入填寫的期間，以及實際要填寫的排班日期",`
    <div class="form-grid">
      <label class="field span-2"><span>區段名稱</span><input class="input" name="name" required value="${w.name}" placeholder="例如 8月上半月可上班時間"></label>
      <label class="field"><span>開放填寫起日</span><input class="input" type="date" name="openStart" ${minAttr} required value="${w.openStart}"></label>
      <label class="field"><span>開放填寫迄日</span><input class="input" type="date" name="openEnd" ${minAttr} required value="${w.openEnd}"></label>
      <label class="field"><span>可填寫排班起日</span><input class="input" type="date" name="targetStart" ${minAttr} required value="${w.targetStart}"></label>
      <label class="field"><span>可填寫排班迄日</span><input class="input" type="date" name="targetEnd" ${minAttr} required value="${w.targetEnd}"></label>
      <label class="field span-2"><span>員工提示文字</span><textarea name="note" rows="3" placeholder="例如：請於期限內完成填寫">${w.note||""}</textarea></label>
      <label class="check-row span-2"><input type="checkbox" name="enabled" ${w.enabled?"checked":""}> 啟用此填寫區段</label>
      <label class="check-row span-2"><input type="checkbox" name="defaultAvailable" ${w.defaultAvailable?"checked":""}> 預設全部員工整天可上班（只要標記少數請假的人即可）</label>
      <div class="modal-actions span-2">
        ${id?`<button type="button" class="danger-btn" onclick="deleteAvailabilityWindow('${w.id}')">刪除</button>`:""}
        <button type="button" class="ghost-btn" onclick="closeModal()">取消</button>
        <button class="primary-btn">儲存</button>
      </div>
    </div>`);
  byId("modalForm").onsubmit=ev=>{
    ev.preventDefault();
    const fd=new FormData(ev.target);
    const openStart=fd.get("openStart"),openEnd=fd.get("openEnd"),targetStart=fd.get("targetStart"),targetEnd=fd.get("targetEnd");
    if(!openStart||!openEnd||!targetStart||!targetEnd){toast("請完整填寫開放填寫期間與可填寫排班日期","error");return}
    // 新增時才要求最早今天；編輯既有區段（可能已開始）不強制，避免改一個日期就把其他日期擋掉
    if(!id&&openStart<tk){toast("開放填寫起日不可早於今天","error");return}
    if(openEnd<openStart){toast("開放填寫迄日不可早於起日","error");return}
    if(!id&&targetStart<tk){toast("可填寫排班起日不可早於今天","error");return}
    if(targetEnd<targetStart){toast("可填寫排班迄日不可早於起日","error");return}
    // 不同區段的「可填寫排班日期」不可重疊
    const clash=windows.find(x=>x.id!==w.id&&targetStart<=x.targetEnd&&targetEnd>=x.targetStart);
    if(clash){toast(`可填寫排班日期與區段「${clash.name}」重疊（${formatDate(clash.targetStart)}～${formatDate(clash.targetEnd)}），請調整日期不要衝突。`);return}
    Object.assign(w,{
      name:fd.get("name").trim(),
      openStart,openEnd,targetStart,targetEnd,
      enabled:fd.get("enabled")==="on",
      defaultAvailable:fd.get("defaultAvailable")==="on",
      note:fd.get("note").trim()
    });
    if(!id)windows.push(w);
    // 設「預設全部可上班」→ 立即把這段排班日期寫入持久清單（之後刪除/縮小區段都不會歸零）
    if(w.defaultAvailable)persistAutoAvailable(w.targetStart,w.targetEnd);
    save();closeModal()
  }
}
function deleteAvailabilityWindow(id){
  if(confirm("確定刪除這個開放填寫區段？")){
    state.data.settings.availabilityWindows=getAvailabilityWindows().filter(x=>x.id!==id);
    save();closeModal()
  }
}

function selectDate(key){state.selectedDate=key;const d=new Date(key+"T00:00:00");state.calendarDate=new Date(d.getFullYear(),d.getMonth(),1);renderAll()}
function openModal(title,subtitle,html){byId("modalTitle").textContent=title;byId("modalSubtitle").textContent=subtitle||"";byId("modalForm").innerHTML=html;byId("modalBackdrop").classList.remove("hidden")}
function closeModal(){byId("modalBackdrop").classList.add("hidden")}
/* ---------- 非阻斷式提示（Toast）：取代事後通知型 alert；重要/錯誤維持 10 秒且可暫停與手動關，不會一閃即過 ---------- */
function toastHost(){let h=byId("toastHost");if(!h){h=document.createElement("div");h.id="toastHost";h.className="toast-host";document.body.appendChild(h);}return h;}
function toast(msg,type="info",ms){
  const dur=ms!=null?ms:(type==="success"?4000:10000); // 重要/錯誤 10 秒，單純確認 4 秒
  const el=document.createElement("div");el.className="toast toast-"+type;el.dataset.dur=dur;
  el.innerHTML=`<span class="toast-msg"></span><button class="toast-close" type="button" aria-label="關閉">×</button><span class="toast-bar"></span>`;
  el.querySelector(".toast-msg").textContent=msg; // textContent：訊息內容不會被當成 HTML
  toastHost().appendChild(el);
  requestAnimationFrame(()=>el.classList.add("show"));
  const bar=el.querySelector(".toast-bar");
  let remaining=dur,start=0,timer=null;
  const dismiss=()=>{if(timer)clearTimeout(timer);el.classList.remove("show");el.classList.add("hide");setTimeout(()=>el.remove(),220);};
  const run=()=>{if(dur<=0)return;start=Date.now();bar.style.transition=`width ${remaining}ms linear`;requestAnimationFrame(()=>{bar.style.width="0%";});timer=setTimeout(dismiss,remaining);};
  const pause=()=>{if(dur<=0||!timer)return;clearTimeout(timer);timer=null;remaining=Math.max(0,remaining-(Date.now()-start));bar.style.transition="none";bar.style.width=(remaining/dur*100)+"%";};
  el.addEventListener("mouseenter",pause);el.addEventListener("mouseleave",run);
  el.addEventListener("touchstart",pause,{passive:true});el.addEventListener("touchend",run);
  el.querySelector(".toast-close").addEventListener("click",dismiss);
  run();
  return el;
}
function openEmployeeModal(id=null){
  const e=id?employee(id):{id:uid("e"),employeeNo:"",name:"",phone:"",employmentType:"正職",shiftClass:"一般",noBreak:false,allowedWorkTypeIds:[],primaryWeekday:[],primaryWeekend:[],weeklyLimit:40,dailyLimit:8,active:true,note:"",pinEnabled:false,pinHash:null};
  e.primaryWeekday=e.primaryWeekday||[];e.primaryWeekend=e.primaryWeekend||[];e.shiftClass=e.shiftClass||"一般";e.note=e.note||"";
  const types=["正職","工讀","外籍學生","其他"];
  const shiftClasses=["一般","平日早班","平日晚班","假日班","其他"];
  const foreignLimit=settings().foreignDefaultLimit;
  const workBoxes=(group,selected,filter)=>{
    const list=state.data.workTypes.filter(w=>w.active&&(!filter||filter(w)));
    if(!list.length)return `<span class="field-help">（尚無符合的工作）</span>`;
    return list.map(w=>`<label class="checkbox-card"><input type="checkbox" name="${group}" value="${w.id}" ${selected.includes(w.id)?"checked":""}>${w.name}</label>`).join("");
  };
  const isWeekdayWork=w=>(w.applyDays||"all")!=="weekend"; // 平日適用（不限或僅平日）
  const isWeekendWork=w=>(w.applyDays||"all")!=="weekday"; // 假日適用（不限或僅假日）
  openModal(id?"編輯員工":"新增員工","設定員工編號、可做工作、主要工作與工時限制",`
    <input type="hidden" name="id" value="${e.id}">
    <div class="form-grid">
      <label class="field"><span>姓名</span><input class="input" name="name" required value="${e.name}"></label>
      <label class="field"><span>員工編號</span><input class="input" name="employeeNo" required value="${e.employeeNo}"></label>
      <label class="field"><span>身分類型</span><select class="select" name="employmentType" id="empType">${types.map(x=>`<option ${x===e.employmentType?"selected":""}>${x}</option>`).join("")}</select></label>
      <label class="field"><span>班別</span><select class="select" name="shiftClass" id="empShiftClass">${shiftClasses.map(x=>`<option ${x===e.shiftClass?"selected":""}>${x}</option>`).join("")}</select></label>
      <label class="field"><span>每週計薪工時上限</span><input class="input" name="weeklyLimit" id="empWeeklyLimit" type="number" min="0" step=".5" value="${e.weeklyLimit}"><small class="field-help" id="empLimitHint">外籍學生預設 ${foreignLimit} 小時／週。</small></label>
      <label class="field"><span>時薪（元）</span><input class="input" name="hourlyWage" type="number" min="0" step="1" value="${e.hourlyWage||0}"><small class="field-help">用於工時統計的人力成本試算，選填。</small></label>
      <label class="check-row span-2"><input type="checkbox" name="noBreak" id="empNoBreak" ${e.noBreak?"checked":""}> 固定早班／上班不扣休息時間（選「平日早班」會自動勾選，可自行調整）</label>
      <label class="field span-2"><span>可以做的工作</span><div class="checkbox-grid">${workBoxes("works",e.allowedWorkTypeIds)}</div></label>
      <label class="field span-2"><span>主要工作・平日</span><div class="checkbox-grid">${workBoxes("primaryWeekday",e.primaryWeekday,isWeekdayWork)}</div><small class="field-help">只列出平日會出現的工作；排班時平日優先推薦負責這些工作的人（需同時在「可以做的工作」中）。</small></label>
      <label class="field span-2"><span>主要工作・假日（六日、國定假日）</span><div class="checkbox-grid">${workBoxes("primaryWeekend",e.primaryWeekend,isWeekendWork)}</div><small class="field-help">只列出假日會出現的工作；假日優先推薦負責這些工作的人。</small></label>
      <label class="field span-2"><span>備註</span><textarea class="input" name="note" rows="2" placeholder="例如 勞健保加保於本店／掛在他店、特殊注意事項">${e.note||""}</textarea><small class="field-help">內部備註，只有後台看得到（例如勞健保註記）。</small></label>
      <label class="check-row span-2"><input type="checkbox" name="active" ${e.active?"checked":""}> 在職並允許員工編號登入</label>
      <div class="modal-actions span-2">${id?`<button type="button" class="danger-btn" onclick="deleteEmployee('${e.id}')">刪除</button>`:""}<button type="button" class="ghost-btn" onclick="closeModal()">取消</button><button class="primary-btn">儲存</button></div>
    </div>`);
  const form=byId("modalForm");
  form.elements.employmentType.addEventListener("change",ev=>{
    if(ev.target.value==="外籍學生"){byId("empWeeklyLimit").value=foreignLimit;}
  });
  form.elements.shiftClass.addEventListener("change",ev=>{
    if(ev.target.value==="平日早班")byId("empNoBreak").checked=true; // 平日早班自動免扣休息
  });
  form.onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target),no=fd.get("employeeNo").trim().toUpperCase();if(state.data.employees.some(x=>x.employeeNo.toUpperCase()===no&&x.id!==e.id)){toast("員工編號不可重複","error");return}
    const works=fd.getAll("works");
    // 主要工作必須落在可做工作範圍內
    const primaryWeekday=fd.getAll("primaryWeekday").filter(w=>works.includes(w));
    const primaryWeekend=fd.getAll("primaryWeekend").filter(w=>works.includes(w));
    Object.assign(e,{name:fd.get("name").trim(),employeeNo:no,employmentType:fd.get("employmentType"),shiftClass:fd.get("shiftClass"),noBreak:fd.get("noBreak")==="on",weeklyLimit:Number(fd.get("weeklyLimit")||0),hourlyWage:Number(fd.get("hourlyWage")||0),allowedWorkTypeIds:works,primaryWeekday,primaryWeekend,note:(fd.get("note")||"").trim(),active:fd.get("active")==="on"});
    if(!id)state.data.employees.push(e);save();closeModal()
  }
}
function deleteEmployee(id){if(confirm("確定刪除這位員工？相關班次不會自動刪除。")){state.data.employees=state.data.employees.filter(x=>x.id!==id);save();closeModal()}}
function openWorktypeModal(id=null){
  const cfg=settings();
  const w=id?worktype(id):{id:uid("w"),name:"",color:COLORS[state.data.workTypes.length%COLORS.length],sort:state.data.workTypes.length+1,applyBreak:true,applyDays:"all",defaultBreak:90,prepDays:[],prepMinutes:0,active:true};
  const applyDaysOpts=[["all","不限（平日與假日都會出現）"],["weekday","僅平日（一～五）"],["weekend","僅假日（六、日）"]];
  openModal(id?"編輯工作":"新增工作","設定名稱、顏色與是否套用休息",`
  <input type="hidden" name="id" value="${w.id}">
  <div class="form-grid">
    <label class="field span-2"><span>工作名稱</span><input class="input" name="name" required value="${w.name}"></label>
    <div class="field span-2"><span>顏色</span>
      <div class="color-picker">
        <div class="color-swatches" id="workSwatches">${COLORS.map(c=>`<button type="button" class="swatch ${c.toLowerCase()===(w.color||"").toLowerCase()?"active":""}" style="background:${c}" data-color="${c}" aria-label="選擇顏色"></button>`).join("")}</div>
        <input type="color" name="color" id="workColor" value="${w.color}" title="自訂顏色">
      </div>
      <small class="field-help">顏色會顯示在「排班管理」時間軸的班次色塊，方便一眼分辨不同工作。</small>
    </div>
    <label class="field span-2"><span>出現日</span><select class="select" name="applyDays">${applyDaysOpts.map(([v,t])=>`<option value="${v}" ${v===(w.applyDays||"all")?"selected":""}>${t}</option>`).join("")}</select><small class="field-help">設「僅假日」的工作，平日排班與固定班次設定就不會列出來，例如假日限定的組合。</small></label>
    <label class="check-row span-2"><input type="checkbox" name="applyBreak" ${w.applyBreak?"checked":""}> 套用店家休息時段（${cfg.breakStart}～${cfg.breakEnd}），班次涵蓋時自動扣除不計薪</label>
    <label class="check-row span-2"><input type="checkbox" name="active" ${w.active?"checked":""}> 啟用</label>
    <div class="modal-actions span-2">${id?`<button type="button" class="danger-btn" onclick="deleteWorktype('${w.id}')">刪除</button>`:""}<button type="button" class="ghost-btn" onclick="closeModal()">取消</button><button class="primary-btn">儲存</button></div>
  </div>`);
  const colorInput=byId("workColor");
  const markActive=val=>document.querySelectorAll("#workSwatches .swatch").forEach(s=>s.classList.toggle("active",s.dataset.color.toLowerCase()===val.toLowerCase()));
  document.querySelectorAll("#workSwatches .swatch").forEach(b=>b.onclick=()=>{colorInput.value=b.dataset.color;markActive(b.dataset.color)});
  colorInput.oninput=()=>markActive(colorInput.value);
  byId("modalForm").onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target);const applyBreak=fd.get("applyBreak")==="on";Object.assign(w,{name:fd.get("name").trim(),color:fd.get("color"),applyBreak,applyDays:fd.get("applyDays")||"all",defaultBreak:applyBreak?(w.defaultBreak||90):0,active:fd.get("active")==="on"});if(!id)state.data.workTypes.push(w);save();closeModal()}
}
function deleteWorktype(id){
  const shiftCount=state.data.shifts.filter(s=>s.workTypeId===id).length;
  const msg=shiftCount?`此工作已被 ${shiftCount} 個班次使用，刪除後這些班次會顯示「已刪除工作」（可自行改工作或刪除）。確定刪除？`:"確定刪除這個工作？";
  if(!confirm(msg))return;
  // 一併清除員工技能／主要工作與每日需求中的參照，避免殘留
  state.data.employees.forEach(e=>{
    e.allowedWorkTypeIds=(e.allowedWorkTypeIds||[]).filter(x=>x!==id);
    e.primaryWeekday=(e.primaryWeekday||[]).filter(x=>x!==id);
    e.primaryWeekend=(e.primaryWeekend||[]).filter(x=>x!==id);
  });
  settings().dailyDemand=getDemand().filter(r=>r.workTypeId!==id);
  state.data.workTypes=state.data.workTypes.filter(x=>x.id!==id);
  save();closeModal();
}
function isPrimaryWork(e,date,workTypeId){
  const list=isWeekend(date)?(e.primaryWeekend||[]):(e.primaryWeekday||[]);
  return list.includes(workTypeId);
}
function getEmployeeEligibility(e,date,start,end,workTypeId,excludeShiftId=null){
  const reasons=[];
  const a=effectiveAvail(e.id,date);
  const canDo=e.allowedWorkTypeIds.includes(workTypeId);
  const primary=isPrimaryWork(e,date,workTypeId);
  if(!canDo) reasons.push("未設定可做此工作");
  if(!a) reasons.push("尚未填可上班時間");
  else if(a.unavailable) reasons.push("當天不可排班");
  else if(start<a.start||end>a.end) reasons.push(`可排 ${a.start}～${a.end}`);
  const overlap=state.data.shifts.some(x=>x.id!==excludeShiftId&&x.employeeId===e.id&&x.date===date&&mins(start)<mins(x.end)&&mins(end)>mins(x.start));
  if(overlap) reasons.push("已有重疊班次");
  const already=weeklyHours(e.id,date,excludeShiftId);
  const projected=already+durationHours({workTypeId,employeeId:e.id,start,end});
  const foreign=e.employmentType==="外籍學生";
  if(e.weeklyLimit&&projected>e.weeklyLimit) reasons.push(`排入後 ${fmtHours(projected)}，超過每週 ${e.weeklyLimit} 小時${foreign?"（外籍上限）":""}`);
  const remaining=e.weeklyLimit?Math.max(0,e.weeklyLimit-already):999;
  // 推薦排序分數：主要工作 > 可做工作 > 剩餘工時多 > 有填可上班時間
  let score=0;
  if(primary) score+=1000;
  if(canDo) score+=200;
  score+=Math.min(remaining,100);
  if(a&&!a.unavailable) score+=50;
  return {eligible:reasons.length===0,reasons,availability:a,primary,canDo,score};
}
function employeeSelectOptions(date,start,end,workTypeId,selectedId="",excludeShiftId=null){
  const active=state.data.employees.filter(e=>e.active);
  const rows=active.map(e=>({e,...getEmployeeEligibility(e,date,start,end,workTypeId,excludeShiftId)}));
  rows.sort((a,b)=>b.score-a.score);
  const available=rows.filter(x=>x.eligible);
  const unavailable=rows.filter(x=>!x.eligible);
  const tag=x=>x.primary?"★主要負責 ":(x.canDo?"":"");
  const opt=x=>`<option value="${x.e.id}" ${x.e.id===selectedId?"selected":""}>${tag(x)}${x.e.name}（${x.e.employeeNo}）${x.eligible?"｜可排班":"｜"+x.reasons.join("、")}</option>`;
  let html="";
  if(available.length) html+=`<optgroup label="可排班員工（依主要負責、剩餘工時排序）">${available.map(opt).join("")}</optgroup>`;
  if(unavailable.length) html+=`<optgroup label="不可排班／需確認">${unavailable.map(opt).join("")}</optgroup>`;
  return html||`<option value="">目前沒有可選員工</option>`;
}
function openShiftModal(id=null,prefill=null){
  let defStart="09:00",defEnd="17:00";
  if(prefill&&prefill.start){
    defStart=prefill.start;
    if(prefill.end){ // 拖曳框選已帶入結束時間，直接採用
      defEnd=prefill.end;
    }else{
      const cfg=settings();
      const endM=Math.min(mins(defStart)+240,mins(cfg.businessEnd)); // 預設 4 小時，不超過最晚下班
      defEnd=`${pad(Math.floor(endM/60))}:${pad(endM%60)}`;
    }
  }
  const s=id?state.data.shifts.find(x=>x.id===id):{id:uid("s"),date:(prefill&&prefill.date)||state.selectedDate,employeeId:"",workTypeId:(prefill&&prefill.workTypeId)||state.data.workTypes.find(w=>w.active)?.id||"",start:defStart,end:defEnd,breakMinutes:0,note:"",subWork:(prefill&&prefill.subWork)||"",prepRole:false,status:"draft",published:false};
  openModal(id?"編輯班次":"新增班次","先設定日期、工作與時間，最後再選擇系統整理好的員工",`
  <div class="form-grid">
    <label class="field"><span>日期</span><input class="input" type="date" name="date" value="${s.date}"></label>
    <label class="field"><span>工作</span><select class="select" name="workTypeId" id="shiftWorkSelect">${worksForDate(s.date,s.workTypeId).map(w=>`<option value="${w.id}" ${w.id===s.workTypeId?"selected":""}>${w.name}</option>`).join("")}</select></label>
    <label class="field"><span>開始時間</span><select class="select" name="start">${timeOptions(s.start)}</select></label>
    <label class="field"><span>結束時間</span><select class="select" name="end">${timeOptions(s.end)}</select></label>
    <div class="field span-2"><span>休息與計薪</span><div class="calc-box" id="shiftCalc"></div></div>
    <label class="field span-2"><span>附加工作（子工作）</span><input class="input" name="subWork" value="${s.subWork||""}" placeholder="自行輸入，例如 備料、洗菜"><small class="field-help">主要工作外還要順便做的事，可自行輸入。只作標示，不列入缺人計算。</small></label>
    <label class="field span-2"><span>選擇員工</span><select class="select employee-smart-select" name="employeeId" id="shiftEmployeeSelect"></select><small class="field-help">名單會依主要負責、可做工作、可上班時間、重疊班次及每週工時自動排序分組。</small></label>
    <label class="field span-2"><span>備註</span><textarea name="note" rows="3">${s.note||""}</textarea></label>
    <div id="shiftWarnings" class="span-2"></div>
    <div class="modal-actions span-2">${id?`<button type="button" class="danger-btn" onclick="deleteShift('${s.id}')">刪除</button>`:""}<button type="button" class="ghost-btn" onclick="closeModal()">取消</button><button class="primary-btn" id="shiftSaveBtn">儲存班次</button></div>
  </div>`);
  const form=byId("modalForm");
  function refreshEmployeeOptions(){
    const fd=new FormData(form);
    const current=byId("shiftEmployeeSelect").value||s.employeeId;
    byId("shiftEmployeeSelect").innerHTML=employeeSelectOptions(fd.get("date"),fd.get("start"),fd.get("end"),fd.get("workTypeId"),current,id);
    if(!byId("shiftEmployeeSelect").value){
      const firstEligible=state.data.employees.find(e=>getEmployeeEligibility(e,fd.get("date"),fd.get("start"),fd.get("end"),fd.get("workTypeId"),id).eligible);
      if(firstEligible) byId("shiftEmployeeSelect").value=firstEligible.id;
    }
  }
  function updateCalc(){
    const fd=new FormData(form),wt=fd.get("workTypeId"),start=fd.get("start"),end=fd.get("end"),eid=fd.get("employeeId"),w=worktype(wt),emp=employee(eid);
    const cfg=settings();
    const shiftObj={workTypeId:wt,employeeId:eid,start,end};
    const brk=(mins(end)>mins(start))?breakForShift(shiftObj):0;
    const paid=durationHours(shiftObj);
    const reason=(emp&&emp.noBreak)?`${emp.name}為固定早班，不扣休息`:(w&&w.applyBreak?`套用休息時段 ${cfg.breakStart}～${cfg.breakEnd}`:"此工作不套用休息");
    byId("shiftCalc").innerHTML=`<span>${reason}</span><strong>自動扣除 ${brk} 分鐘・計薪 ${fmtHours(paid)}</strong>`;
  }
  function updateWarnings(){
    const fd=new FormData(form),eid=fd.get("employeeId"),date=fd.get("date"),start=fd.get("start"),end=fd.get("end"),e=employee(eid),warnings=[];
    if(mins(end)<=mins(start))warnings.push("結束時間必須晚於開始時間");
    if(isClosedDay(date))warnings.push("這一天是公休日，不建議排班");
    if(e){
      const result=getEmployeeEligibility(e,date,start,end,fd.get("workTypeId"),id);
      warnings.push(...result.reasons);
      const week=weeklyHours(eid,date,id)+durationHours({workTypeId:fd.get("workTypeId"),start,end});
      if(e.weeklyLimit&&week>e.weeklyLimit&&!warnings.some(x=>x.includes("每週")||x.includes("上限")))warnings.push(`排入後本週 ${fmtHours(week)}，超過上限 ${e.weeklyLimit} 小時`);
    }
    // 即時衝突警示：明顯提示但不阻擋，主管仍可儲存以保留例外彈性
    const box=byId("shiftWarnings"),btn=byId("shiftSaveBtn");
    if(warnings.length){
      box.innerHTML=`<div class="shift-conflicts"><div class="sc-head">⚠ 這個排班有 ${warnings.length} 項衝突（仍可儲存）</div><ul class="sc-list">${warnings.map(w=>`<li>${w}</li>`).join("")}</ul></div>`;
      if(btn)btn.textContent="仍要儲存班次";
    }else{
      box.innerHTML="";
      if(btn)btn.textContent="儲存班次";
    }
  }
  function refreshWorkOptions(){ // 換日期時，依平日／假日重新篩選可選工作
    const sel=byId("shiftWorkSelect");const cur=sel.value;const date=new FormData(form).get("date");
    const list=worksForDate(date,cur);
    sel.innerHTML=list.map(w=>`<option value="${w.id}" ${w.id===cur?"selected":""}>${w.name}</option>`).join("");
    if(!list.some(w=>w.id===cur))sel.value=list[0]?.id||"";
  }
  refreshEmployeeOptions();updateWarnings();updateCalc();
  form.elements.date.addEventListener("change",refreshWorkOptions);
  ["date","workTypeId","start","end"].forEach(name=>{
    form.elements[name].addEventListener("change",()=>{refreshEmployeeOptions();updateWarnings();updateCalc()});
  });
  form.elements.employeeId.addEventListener("change",()=>{updateWarnings();updateCalc()});
  form.onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target);if(!fd.get("employeeId")){toast("請選擇員工","error");return}
    if(isClosedDay(fd.get("date"))&&!confirm("這一天是公休日，確定仍要排班？")){return}
    Object.assign(s,{date:fd.get("date"),workTypeId:fd.get("workTypeId"),subWork:(fd.get("subWork")||"").trim(),employeeId:fd.get("employeeId"),start:fd.get("start"),end:fd.get("end"),breakMinutes:breakForShift({workTypeId:fd.get("workTypeId"),employeeId:fd.get("employeeId"),start:fd.get("start"),end:fd.get("end")}),note:fd.get("note").trim()});
    if(mins(s.end)<=mins(s.start)){toast("結束時間必須晚於開始時間","error");return}
    if(!id)state.data.shifts.push(s);state.selectedDate=s.date;save();closeModal()
  }
}
function deleteShift(id){if(confirm("確定刪除這個班次？")){state.data.shifts=state.data.shifts.filter(x=>x.id!==id);save();closeModal()}}
/* ---------- 就地快速換人：不開完整視窗，直接在班次上換指派員工 ---------- */
function closeQuickAssign(){const m=byId("quickAssign");if(m)m.remove();document.removeEventListener("click",quickAssignOutside,true);window.removeEventListener("scroll",closeQuickAssign,true);window.removeEventListener("resize",closeQuickAssign);}
function quickAssignOutside(ev){if(!ev.target.closest("#quickAssign"))closeQuickAssign();}
function openQuickAssign(ev,shiftId){
  ev.stopPropagation();ev.preventDefault();
  const s=state.data.shifts.find(x=>x.id===shiftId);if(!s)return;
  closeQuickAssign();
  const rows=state.data.employees.filter(e=>e.active).map(e=>({e,...getEmployeeEligibility(e,s.date,s.start,s.end,s.workTypeId,s.id)})).sort((a,b)=>b.score-a.score);
  const item=x=>`<button type="button" class="qa-item${x.eligible?"":" warn"}${x.e.id===s.employeeId?" cur":""}" onclick="quickAssignPick('${s.id}','${x.e.id}')"><span class="qa-name">${x.primary?"★ ":""}${x.e.name}</span><span class="qa-tag">${x.e.id===s.employeeId?"目前":(x.eligible?"可排":(x.reasons[0]||"需確認"))}</span></button>`;
  const menu=document.createElement("div");menu.className="quick-assign";menu.id="quickAssign";
  menu.innerHTML=`<div class="qa-head">換人指派・${s.start}–${s.end}</div><div class="qa-list">${rows.map(item).join("")||'<div class="qa-empty">沒有在職員工</div>'}</div><button type="button" class="qa-item qa-clear${s.employeeId?"":" cur"}" onclick="quickAssignPick('${s.id}','')">設為待指派</button>`;
  document.body.appendChild(menu);
  // 定位：貼齊觸發元素，超出視窗邊界時夾回可視範圍
  const r=(ev.currentTarget.closest(".dg-block,.sl-shift")||ev.currentTarget).getBoundingClientRect();
  const mw=menu.offsetWidth,mh=menu.offsetHeight,gap=6;
  let left=r.left,top=r.bottom+gap;
  if(left+mw>window.innerWidth-8)left=window.innerWidth-mw-8;
  if(left<8)left=8;
  if(top+mh>window.innerHeight-8)top=Math.max(8,r.top-mh-gap);
  menu.style.left=left+"px";menu.style.top=top+"px";
  setTimeout(()=>{document.addEventListener("click",quickAssignOutside,true);window.addEventListener("scroll",closeQuickAssign,true);window.addEventListener("resize",closeQuickAssign);},0);
}
function quickAssignPick(shiftId,empId){
  const s=state.data.shifts.find(x=>x.id===shiftId);if(!s)return;
  s.employeeId=empId;
  s.breakMinutes=breakForShift(s); // 換人後休息時段可能改變（例如固定早班免扣），一併重算
  closeQuickAssign();
  save();
}

/* ---------- 可上班時間填寫狀態 ---------- */
function currentWindow(){
  const windows=getAvailabilityWindows().filter(w=>w.enabled);
  if(!windows.length)return null;
  const now=toDateKey(new Date());
  // 優先：目前開放中；其次：即將開放；再者：最近截止
  const open=windows.filter(w=>now>=w.openStart&&now<=w.openEnd).sort((a,b)=>a.openEnd.localeCompare(b.openEnd));
  if(open.length)return open[0];
  const upcoming=windows.filter(w=>now<w.openStart).sort((a,b)=>a.openStart.localeCompare(b.openStart));
  if(upcoming.length)return upcoming[0];
  return windows.slice().sort((a,b)=>b.openEnd.localeCompare(a.openEnd))[0];
}
function datesInRange(startKey,endKey){
  const out=[];let d=new Date(startKey+"T00:00:00"),end=new Date(endKey+"T00:00:00");
  while(d<=end){out.push(toDateKey(d));d.setDate(d.getDate()+1)}
  return out;
}
// 找出包含某日期、且啟用中的填寫區段（用於「預設全部可上班」判斷）
function windowForDate(dateKey){
  return getAvailabilityWindows().filter(w=>w.enabled).find(w=>dateKey>=w.targetStart&&dateKey<=w.targetEnd);
}
// 某日是否套用「預設全部可上班」：目前有開放中的預設區段涵蓋，或已寫入持久清單（設過就保留，刪區段也不消失）
function isAutoAvailableDate(dateKey){
  if(isClosedDay(dateKey))return false;
  const w=windowForDate(dateKey);
  if(w&&w.defaultAvailable)return true;
  return (settings().autoAvailableDates||[]).includes(dateKey);
}
// 取得某員工某日的「實際」可上班狀態：優先用已填紀錄；否則若該日為「預設全部可上班」則視為整天可上班。
function effectiveAvail(employeeId,dateKey){
  const rec=state.data.availability.find(a=>a.employeeId===employeeId&&a.date===dateKey);
  if(rec)return rec;
  if(isAutoAvailableDate(dateKey)){
    return {employeeId,date:dateKey,unavailable:false,start:settings().businessStart,end:settings().businessEnd,_default:true};
  }
  return undefined;
}
// 某員工在某填寫區段是否「真的自己填過」（有非預設的紀錄）。預設值(_default)不算已填。
function hasFilled(employeeId,w){
  if(!w)return false;
  return state.data.availability.some(a=>a.employeeId===employeeId&&!a._default&&a.date>=w.targetStart&&a.date<=w.targetEnd);
}
// 把某區段的排班日期範圍寫入持久「預設可上班」清單（只增不減，不自動清理；舊資料由「資料清理」統一處理）
function persistAutoAvailable(targetStart,targetEnd){
  const cur=new Set(settings().autoAvailableDates||[]);
  datesInRange(targetStart,targetEnd).forEach(d=>{if(!isClosedDay(d))cur.add(d);});
  settings().autoAvailableDates=[...cur].sort();
}
function windowFillStatus(w){
  if(!w)return null;
  const actives=state.data.employees.filter(e=>e.active);
  const filled=actives.filter(e=>hasFilled(e.id,w));
  const unfilled=actives.filter(e=>!hasFilled(e.id,w));
  return {window:w,total:actives.length,filled,unfilled};
}

/* ---------- 店家設定 ---------- */
function renderStoreSettings(){
  const cfg=settings();
  const box=byId("storeSettingsForm");
  if(!box)return;
  const dayBoxes=[0,1,2,3,4,5,6].map(d=>`<label class="checkbox-card"><input type="checkbox" name="closedDays" value="${d}" ${cfg.closedDays.includes(d)?"checked":""}>星期${"日一二三四五六"[d]}</label>`).join("");
  box.innerHTML=`
    <div class="form-grid">
      <label class="field"><span>店名</span><input class="input" name="storeName" value="${cfg.storeName||""}"></label>
      <label class="field"><span>時間間隔（分鐘）</span><select class="select" name="timeStep">${[15,30,60].map(v=>`<option ${v===cfg.timeStep?"selected":""}>${v}</option>`).join("")}</select></label>
      <label class="field"><span>最早上班時間</span><input class="input" type="time" name="businessStart" value="${cfg.businessStart}"></label>
      <label class="field"><span>最晚下班時間</span><input class="input" type="time" name="businessEnd" value="${cfg.businessEnd}"></label>
      <label class="field"><span>休息開始時間</span><input class="input" type="time" name="breakStart" value="${cfg.breakStart}"></label>
      <label class="field"><span>休息結束時間</span><input class="input" type="time" name="breakEnd" value="${cfg.breakEnd}"></label>
      <label class="field"><span>外籍學生預設每週工時上限</span><input class="input" type="number" min="0" step="1" name="foreignDefaultLimit" value="${cfg.foreignDefaultLimit}"></label>
      <div class="field span-2"><span>每週公休日（可多選）</span><div class="checkbox-grid">${dayBoxes}</div></div>
      <div class="modal-actions span-2"><button class="primary-btn" type="submit">儲存店家設定</button></div>
    </div>`;
  box.onsubmit=ev=>{
    ev.preventDefault();const fd=new FormData(box);
    const bs=fd.get("businessStart"),be=fd.get("businessEnd");
    if(mins(be)<=mins(bs)){toast("最晚下班時間必須晚於最早上班時間","error");return}
    const brs=fd.get("breakStart"),bre=fd.get("breakEnd");
    if(mins(bre)<=mins(brs)){toast("休息結束時間必須晚於開始時間","error");return}
    Object.assign(cfg,{
      storeName:fd.get("storeName").trim(),
      timeStep:Number(fd.get("timeStep")),
      businessStart:bs,businessEnd:be,
      breakStart:brs,breakEnd:bre,
      foreignDefaultLimit:Number(fd.get("foreignDefaultLimit")||0),
      closedDays:fd.getAll("closedDays").map(Number)
    });
    save();toast("已儲存店家設定","success");
  };
}

/* ---------- 工時總覽（可選週／月、排序、篩選、展開明細、打卡核對） ---------- */
function shiftDayHours(employeeId,dateKey){
  return state.data.shifts.filter(s=>s.employeeId===employeeId&&s.date===dateKey).reduce((n,s)=>n+durationHours(s),0);
}
// 依模式（週／月）與錨點日期算出期間；不給 mode 時用目前檢視模式
function hoursPeriod(mode){
  mode=mode||state.hoursMode;
  if(mode==="month"){
    const d=new Date(state.hoursWeek+"T00:00:00"),y=d.getFullYear(),m=d.getMonth();
    const start=toDateKey(new Date(y,m,1)),end=toDateKey(new Date(y,m+1,0));
    return {start,end,label:`${y} 年 ${m+1} 月`,mode:"month"};
  }
  const [start,end]=weekRange(state.hoursWeek);
  return {start,end,label:`${formatDate(start)} ～ ${formatDate(end)}`,mode:"week"};
}
// 期間內某員工的班次
function periodShifts(eid,start,end){return state.data.shifts.filter(s=>s.employeeId===eid&&s.date>=start&&s.date<=end).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start))}
function renderHours(){
  const wrap=byId("hoursTable");if(!wrap)return;
  const p=hoursPeriod();
  const lbl=byId("hoursWeekLabel");if(lbl)lbl.textContent=p.label;
  // 模式 / 篩選 UI 狀態同步
  document.querySelectorAll("#hoursModeTabs .seg-btn").forEach(b=>b.classList.toggle("active",b.dataset.hmode===state.hoursMode));
  const resetBtn=byId("thisWeekBtn");if(resetBtn)resetBtn.textContent=state.hoursMode==="month"?"本月":"本週";
  const days=datesInRange(p.start,p.end);
  const weekMode=p.mode==="week";
  const showDaily=weekMode&&!isNarrow(); // 手機不顯示每日欄，避免橫向擠壓
  // 篩選＋搜尋
  const q=state.hoursSearch.trim().toLowerCase();
  let actives=state.data.employees.filter(e=>e.active
    &&(state.hoursType==="all"||e.employmentType===state.hoursType)
    &&(!q||e.name.toLowerCase().includes(q)||(e.employeeNo||"").toLowerCase().includes(q)));
  // 計算每位員工期間合計（表訂）與是否超過每週上限
  const rows=actives.map(e=>{
    const total=days.reduce((n,d)=>n+shiftDayHours(e.id,d),0);
    let overWeek=false;
    if(e.weeklyLimit){
      // 逐週檢查（月模式時可能跨多週）
      const seen=new Set();
      days.forEach(d=>{const wk=weekRange(d)[0];if(seen.has(wk))return;seen.add(wk);
        const wt=datesInRange(...weekRange(d)).reduce((n,x)=>n+shiftDayHours(e.id,x),0);
        if(wt>e.weeklyLimit)overWeek=true;
      });
    }
    return {e,total,overWeek};
  });
  // 排序
  const {key,dir}=state.hoursSort;
  rows.sort((a,b)=>key==="total"?(a.total-b.total)*dir:a.e.name.localeCompare(b.e.name,"zh-Hant")*dir);
  const sortArrow=k=>state.hoursSort.key===k?(state.hoursSort.dir>0?" ▲":" ▼"):"";
  const totalHead=weekMode?"本週合計 / 上限":"本月合計";
  const head=`<tr>
    <th class="hsort" onclick="hoursSortBy('name')">員工${sortArrow("name")}</th>
    ${showDaily?days.map(d=>{const dd=new Date(d+"T00:00:00");return `<th class="hcell">${dd.getMonth()+1}/${dd.getDate()}<span>${"日一二三四五六"[dd.getDay()]}</span></th>`}).join(""):""}
    <th class="hsort" onclick="hoursSortBy('total')">${totalHead}${sortArrow("total")}</th>
    <th>核對</th></tr>`;
  const body=rows.map(({e,total,overWeek})=>{
    const foreign=e.employmentType==="外籍學生";
    let cls="",note="";
    if(e.weeklyLimit){
      if(overWeek){cls="over";note=foreign?" ⚠外籍超時":" ⚠超時";}
      else if(weekMode&&total>=e.weeklyLimit*0.9){cls="near";note=" 接近上限";}
    }
    const ps=periodShifts(e.id,p.start,p.end);
    const vCount=ps.filter(s=>s.verified).length;
    const verifyCell=ps.length?`<span class="verify-chip ${vCount===ps.length?"done":""}">✓ ${vCount}/${ps.length}</span>`:`<span class="hmuted">–</span>`;
    const cells=showDaily?days.map(d=>{const h=shiftDayHours(e.id,d);return `<td class="hcell">${h?fmtNum(h):`<span class="hmuted">–</span>`}</td>`}).join(""):"";
    const wage=Number(e.hourlyWage)||0,cost=total*wage;
    const costLine=wage>0?`<span class="cell-sub cost-sub">≈ ${fmtMoney(cost)}</span>`:"";
    const totalCell=(weekMode?`<strong>${fmtNum(total)}</strong> / ${e.weeklyLimit||"—"}${note}`:`<strong>${fmtNum(total)}</strong>${note}`)+costLine;
    const expanded=state.hoursExpanded===e.id;
    const mainRow=`<tr class="hrow ${expanded?"open":""}" onclick="hoursToggle('${e.id}')">
      <td class="hname"><span class="hexp">${expanded?"▾":"▸"}</span><strong>${e.name}</strong>${foreign?`<span class="badge warn">外籍</span>`:`<span class="cell-sub">${e.employmentType}</span>`}</td>
      ${cells}<td class="htotal ${cls}">${totalCell}</td><td>${verifyCell}</td></tr>`;
    const colspan=showDaily?days.length+3:3;
    const detailRow=expanded?`<tr class="hours-detail-row"><td colspan="${colspan}">${hoursDetail(e,ps)}</td></tr>`:"";
    return mainRow+detailRow;
  }).join("");
  const totalCost=rows.reduce((n,{e,total})=>n+total*(Number(e.hourlyWage)||0),0);
  const withWage=rows.filter(r=>Number(r.e.hourlyWage)>0).length;
  const costSummary=withWage?`<div class="hours-cost-summary">本期預估人力成本 <strong>${fmtMoney(totalCost)}</strong>　<span>（依已設定時薪的 ${withWage} 位計算，表訂工時 × 時薪）</span></div>`:"";
  wrap.innerHTML=`${costSummary}<table class="hours-matrix"><thead>${head}</thead><tbody>${body||`<tr><td>找不到符合條件的員工</td></tr>`}</tbody></table>`;
}
function fmtMoney(n){return "$"+Math.round(n).toLocaleString("en-US")}
// 展開明細：逐筆班次表訂 vs 實際打卡，可編輯與核對
function hoursDetail(e,ps){
  if(!ps.length)return `<div class="empty-state">此期間沒有班次</div>`;
  let schedSum=0,actualSum=0;
  const items=ps.map(s=>{
    const w=worktype(s.workTypeId);
    const schedH=durationHours(s),actualH=shiftActualHours(s);
    schedSum+=schedH;actualSum+=actualH;
    const diff=actualH-schedH;
    const hasA=shiftHasActual(s);
    const diffTxt=hasA?`<span class="hd-diff ${diff>0.001?"pos":diff<-0.001?"neg":""}">${diff>0?"+":""}${fmtNum(diff)}h</span>`:`<span class="hmuted">—</span>`;
    return `<div class="hd-shift ${s.verified?"verified":""}" onclick="event.stopPropagation()">
      <div class="hd-date"><strong>${formatDate(s.date)}</strong><span>${w?w.name:"（已刪除工作）"}${(s.subWork||"").trim()?"＋"+s.subWork.trim():""}</span></div>
      <div class="hd-sched">表訂 ${s.start}–${s.end}<span>${fmtNum(schedH)}h</span></div>
      <div class="hd-actual">實際打卡
        <input type="time" value="${s.actualStart||""}" onchange="setShiftActual('${s.id}','actualStart',this.value)">
        <span>–</span>
        <input type="time" value="${s.actualEnd||""}" onchange="setShiftActual('${s.id}','actualEnd',this.value)">
        <span>${hasA?fmtNum(actualH)+"h":""}</span>
      </div>
      ${diffTxt}
      <label class="hd-verify"><input type="checkbox" ${s.verified?"checked":""} onchange="toggleShiftVerified('${s.id}')"> 已核對</label>
    </div>`;
  }).join("");
  const anyActual=ps.some(shiftHasActual);
  const totalDiff=actualSum-schedSum;
  const summary=`<div class="hd-summary">
    表訂合計 <b>${fmtNum(schedSum)}h</b>${anyActual?` ・ 實際合計 <b>${fmtNum(actualSum)}h</b> ・ 差異 <b class="${totalDiff>0.001?"pos":totalDiff<-0.001?"neg":""}">${totalDiff>0?"+":""}${fmtNum(totalDiff)}h</b>`:""} ・ 已核對 ${ps.filter(s=>s.verified).length}/${ps.length}
    <button class="ghost-btn small-btn" onclick="event.stopPropagation();verifyAll('${e.id}')">全部標記已核對</button>
  </div>`;
  return `<div class="hd-wrap">${items}${summary}</div>`;
}
function hoursSortBy(key){
  if(state.hoursSort.key===key)state.hoursSort.dir*=-1;
  else state.hoursSort={key,dir:key==="total"?-1:1};
  renderHours();
}
function hoursToggle(eid){state.hoursExpanded=state.hoursExpanded===eid?null:eid;renderHours();}
function setShiftActual(id,field,val){
  const s=state.data.shifts.find(x=>x.id===id);if(!s)return;
  if(val)s[field]=val; else delete s[field];
  save();
}
function toggleShiftVerified(id){const s=state.data.shifts.find(x=>x.id===id);if(!s)return;s.verified=!s.verified;save();}
function verifyAll(eid){
  const p=hoursPeriod();
  periodShifts(eid,p.start,p.end).forEach(s=>s.verified=true);
  save();
}
function fmtNum(n){return Number.isInteger(n)?String(n):n.toFixed(1)}

/* ---------- 可上班時間總覽（月曆／日期／員工） ---------- */
function renderAvailabilityOverview(){
  const root=byId("availabilityOverviewBody");if(!root)return;
  const w=currentWindow();
  document.querySelectorAll("#availModeTabs .staff-tab").forEach(b=>b.classList.toggle("active",b.dataset.mode===state.availMode));
  const summary=byId("availOverviewSummary");
  if(summary){
    if(w){
      const fill=windowFillStatus(w);
      if(w.defaultAvailable){
        summary.innerHTML=`<div class="info-banner"><div>
          <strong>目前開放：${w.name}｜排班日期 ${formatDate(w.targetStart)} ～ ${formatDate(w.targetEnd)}</strong>
          <span>此區段「預設全部可上班」——未自行填寫者一律視為整天可上班。</span>
          <span>目前已有 <b>${fill.filled.length}</b> 人自行登入填寫／修改（共 ${fill.total} 位在職員工）${fill.filled.length?`：${fill.filled.map(e=>e.name).join("、")}`:""}</span>
        </div></div>`;
      }else{
        summary.innerHTML=`<div class="info-banner"><div>
          <strong>目前開放：${w.name}｜填寫排班日期 ${formatDate(w.targetStart)} ～ ${formatDate(w.targetEnd)}</strong>
          <span>已填 ${fill.filled.length} 人・未填 ${fill.unfilled.length} 人（共 ${fill.total} 位在職員工）</span>
          ${fill.unfilled.length?`<span>未填：${fill.unfilled.map(e=>e.name).join("、")}</span>`:""}
        </div></div>`;
      }
    }else{
      summary.innerHTML=`<div class="info-banner"><div><strong>目前沒有開放中的填寫區段</strong><span>員工端暫時無法自行填寫；後台仍可在下方直接代填任何日期（例如員工提早告知的休假）。</span></div></div>`;
    }
  }
  // 後台不受開放區段限制，任何日期都可檢視／代填
  if(state.availMode==="month")root.innerHTML=availMonthView();
  else if(state.availMode==="date")root.innerHTML=availDateView();
  else root.innerHTML=availEmployeeView();
}
function availMonthView(){
  const d=state.availCalDate,y=d.getFullYear(),m=d.getMonth();
  const first=new Date(y,m,1),start=new Date(y,m,1-((first.getDay()+6)%7));
  const actives=state.data.employees.filter(e=>e.active);
  let cells="";
  for(let i=0;i<42;i++){
    const day=new Date(start);day.setDate(start.getDate()+i);const key=toDateKey(day);
    const closed=isClosedDay(key);
    const inMonth=day.getMonth()===m;
    const recs=actives.map(e=>effectiveAvail(e.id,key)).filter(Boolean);
    const yes=recs.filter(a=>!a.unavailable).length,off=recs.filter(a=>a.unavailable).length;
    const inWin=!!windowForDate(key);
    const badge=closed?`<div class="ov-closed">公休</div>`:`<div class="ov-count">${yes} 可排${off?`／${off} 休`:""}</div>`;
    const clickable=!closed;
    cells+=`<div class="ov-cell ${inMonth?"":"muted"} ${clickable?"clickable":"disabled"} ${inWin?"in-window":""}" ${clickable?`onclick="availOpenDate('${key}')"`:""}><div class="ov-day">${day.getDate()}</div>${badge}</div>`;
  }
  return `<div class="ov-cal-head"><button class="icon-btn" onclick="availMonthNav(-1)">‹</button><strong>${y} 年 ${m+1} 月</strong><button class="icon-btn" onclick="availMonthNav(1)">›</button></div>
    <div class="ov-cal-hint">點任一天可代填當天所有員工；淺色外框＝該日在開放區段內。</div>
    <div class="weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
    <div class="ov-grid">${cells}</div>`;
}
function availMonthNav(delta){state.availCalDate.setMonth(state.availCalDate.getMonth()+delta);renderAvailabilityOverview()}
function availDateView(){
  const dateKey=state.availDate||toDateKey(today);
  const actives=state.data.employees.filter(e=>e.active);
  const rows=actives.length?actives.map(e=>availQuickRow(e.id,dateKey,`<div class="list-icon">${e.name.slice(0,1)}</div>`,e.name,e.employmentType)).join(""):`<div class="empty-state">尚無在職員工</div>`;
  const inWin=windowForDate(dateKey);
  const winNote=inWin?`<span class="ov-hint">此日在開放區段「${inWin.name}」內</span>`:`<span class="ov-hint muted">此日未開放員工填寫，僅後台代填</span>`;
  return `<div class="ov-toolbar"><span>日期</span><input type="date" class="input" style="max-width:180px" value="${dateKey}" onchange="availPickDate(this.value)"><button class="ghost-btn small-btn" onclick="availAllForDate()">全部可上班</button>${winNote}</div><div class="stack-list panel">${rows}</div>`;
}
function availPickDate(v){if(v)state.availDate=v;renderAvailabilityOverview()}
function availEmployeeView(){
  const actives=state.data.employees.filter(e=>e.active);
  if(!state.availEmployeeId||!actives.some(e=>e.id===state.availEmployeeId))state.availEmployeeId=actives[0]?.id||null;
  const eid=state.availEmployeeId;
  const options=actives.map(e=>`<option value="${e.id}" ${e.id===eid?"selected":""}>${e.name}（${e.employeeNo}）</option>`).join("")||`<option>（尚無員工）</option>`;
  const d=state.availCalDate,y=d.getFullYear(),m=d.getMonth(),daysInMonth=new Date(y,m+1,0).getDate();
  const rows=[];
  for(let i=1;i<=daysInMonth;i++){
    const key=toDateKey(new Date(y,m,i));
    if(isClosedDay(key))continue; // 公休日不需填
    const sub=`${"日一二三四五六"[new Date(key+"T00:00:00").getDay()]}${isHolidayDate(key)?"・假日":""}`;
    rows.push(availQuickRow(eid,key,"",formatDate(key),sub));
  }
  return `<div class="ov-toolbar"><span>員工</span><select class="select" onchange="availPickEmployee(this.value)" style="max-width:200px">${options}</select>
    <button class="icon-btn" onclick="availMonthNav(-1)">‹</button><strong style="font-size:14px">${y} 年 ${m+1} 月</strong><button class="icon-btn" onclick="availMonthNav(1)">›</button>
    <button class="ghost-btn small-btn" onclick="availAllForEmployee()">整月全部可上班</button></div>
    <div class="stack-list panel">${rows.join("")||`<div class="empty-state">本月都是公休日</div>`}</div>`;
}
function availPickEmployee(v){state.availEmployeeId=v;renderAvailabilityOverview()}
// 快速勾選：整天可上班（沿用既有時間或店家營業時間）／整天不可排
function availQuickSet(employeeId,dateKey,type){
  const list=state.data.availability;
  let rec=list.find(x=>x.employeeId===employeeId&&x.date===dateKey);
  const bs=settings().businessStart,be=settings().businessEnd;
  // 再按一次同一狀態＝取消（改回未填）
  if(rec&&((type==="yes"&&!rec.unavailable)||(type==="no"&&rec.unavailable))){
    state.data.availability=list.filter(x=>x!==rec);save();return;
  }
  if(!rec){rec={id:uid("a"),employeeId,date:dateKey};list.push(rec)}
  Object.assign(rec,{unavailable:type==="no",start:rec.start||bs,end:rec.end||be});
  delete rec._default; // 主管明確設定 → 不再是「預設」
  save();
}
// 一列：左側資訊 + 狀態 + 快速勾選（可上班／整天不可／詳細時間）
function availQuickRow(employeeId,dateKey,iconHtml,title,sub){
  const a=effectiveAvail(employeeId,dateKey);
  const isYes=!!(a&&!a.unavailable),isNo=!!(a&&a.unavailable);
  const subTxt=isYes?`${a.start}～${a.end}${a._default?"（預設）":""}`:(isNo?"整天不可排":(sub||"未填"));
  const subCls=isYes?"ok":(isNo?"warn":"muted");
  return `<div class="list-item avail-row">${iconHtml}<div class="list-main"><strong>${title}</strong><span class="avail-sub ${subCls}">${subTxt}</span></div>
    <div class="avail-quick">
      <button class="qbtn yes ${isYes?"active":""}" onclick="availQuickSet('${employeeId}','${dateKey}','yes')">可上班</button>
      <button class="qbtn no ${isNo?"active":""}" onclick="availQuickSet('${employeeId}','${dateKey}','no')">整天不可</button>
      <button class="qbtn edit" onclick="openAvailEditModal('${employeeId}','${dateKey}')">詳細</button>
    </div></div>`;
}
// 一鍵：把某一天所有在職員工設為整天可上班
function availAllForDate(){
  const dateKey=state.availDate;if(!dateKey)return;
  const actives=state.data.employees.filter(e=>e.active);
  if(!actives.length)return;
  if(!confirm(`將 ${formatDate(dateKey)} 全部 ${actives.length} 位在職員工設為整天可上班？（原本設為不可排的也會改成可上班）`))return;
  const bs=settings().businessStart,be=settings().businessEnd;
  actives.forEach(e=>{
    let rec=state.data.availability.find(a=>a.employeeId===e.id&&a.date===dateKey);
    if(!rec){rec={id:uid("a"),employeeId:e.id,date:dateKey};state.data.availability.push(rec)}
    Object.assign(rec,{unavailable:false,start:bs,end:be});
  });
  save();
}
// 一鍵：把某位員工在「目前顯示的月份」每一天（排除公休）設為整天可上班
function availAllForEmployee(){
  const eid=state.availEmployeeId;if(!eid)return;
  const emp=employee(eid);
  const d=state.availCalDate,y=d.getFullYear(),m=d.getMonth();
  if(!confirm(`將 ${emp?emp.name:""} 在 ${y} 年 ${m+1} 月的每一天設為整天可上班？（原本設為不可排的也會改成可上班）`))return;
  const bs=settings().businessStart,be=settings().businessEnd,daysInMonth=new Date(y,m+1,0).getDate();
  for(let i=1;i<=daysInMonth;i++){
    const key=toDateKey(new Date(y,m,i));
    if(isClosedDay(key))continue;
    let rec=state.data.availability.find(a=>a.employeeId===eid&&a.date===key);
    if(!rec){rec={id:uid("a"),employeeId:eid,date:key};state.data.availability.push(rec)}
    Object.assign(rec,{unavailable:false,start:bs,end:be});
  }
  save();
}
// 老闆代填／修改員工可上班時間（詳細時間）
function openAvailEditModal(employeeId,dateKey){
  const emp=employee(employeeId);if(!emp)return;
  const a=effectiveAvail(employeeId,dateKey);
  const cur=a?(a.unavailable?"off":"on"):"none";
  const start=a?.start||settings().businessStart,end=a?.end||settings().businessEnd;
  const closedNote=isClosedDay(dateKey)?`<div class="field span-2"><small class="field-help">提醒：這一天是公休日。</small></div>`:"";
  openModal("代填可上班時間",`${emp.name}（${emp.employeeNo}）｜${formatDate(dateKey)}`,`
    <div class="form-grid">
      <label class="field span-2"><span>狀態</span><select class="select" name="st" id="avSt">
        <option value="on" ${cur==="on"?"selected":""}>可上班</option>
        <option value="off" ${cur==="off"?"selected":""}>整天不可排</option>
        <option value="none" ${cur==="none"?"selected":""}>清除（改為未填）</option>
      </select></label>
      <label class="field"><span>最早可上班</span><select class="select" name="start" id="avStart">${timeOptions(start)}</select></label>
      <label class="field"><span>最晚可下班</span><select class="select" name="end" id="avEnd">${timeOptions(end)}</select></label>
      ${closedNote}
      <div class="modal-actions span-2"><button type="button" class="ghost-btn" onclick="closeModal()">取消</button><button class="primary-btn">儲存</button></div>
    </div>`);
  const form=byId("modalForm"),stSel=byId("avSt");
  const syncDisabled=()=>{const on=stSel.value==="on";byId("avStart").disabled=!on;byId("avEnd").disabled=!on;};
  stSel.addEventListener("change",syncDisabled);syncDisabled();
  form.onsubmit=ev=>{ev.preventDefault();const st=stSel.value;
    let list=state.data.availability;
    if(st==="none"){state.data.availability=list.filter(x=>!(x.employeeId===employeeId&&x.date===dateKey));save();closeModal();return}
    const s=byId("avStart").value,e=byId("avEnd").value;
    if(st==="on"&&mins(e)<=mins(s)){toast("結束時間必須晚於開始時間","error");return}
    let rec=list.find(x=>x.employeeId===employeeId&&x.date===dateKey);
    if(!rec){rec={id:uid("a"),employeeId,date:dateKey};list.push(rec)}
    Object.assign(rec,{unavailable:st==="off",start:s,end:e});
    delete rec._default; // 主管明確設定 → 不再是「預設」
    save();closeModal();
  };
}
// 由月檢視點格子跳到當天的日檢視
function availOpenDate(dateKey){state.availMode="date";state.availDate=dateKey;renderAvailabilityOverview()}

/* ---------- 特定休息日（國定假日／臨時公休） ---------- */
function renderHolidays(){
  const el=byId("holidayList");if(!el)return;
  const list=holidays().slice().sort((a,b)=>a.date.localeCompare(b.date));
  el.innerHTML=list.length?list.map(h=>`<div class="demand-row"><div class="list-icon">休</div><div class="list-main"><strong>${formatDate(h.date)}</strong><span>${h.note||"整店休息"}</span></div><button class="text-btn" onclick="deleteHoliday('${h.date}')">刪除</button></div>`).join(""):`<div class="empty-state">尚未設定特定休息日</div>`;
}
function addHoliday(){
  const date=byId("holidayDate").value;
  if(!date){toast("請先選擇日期","error");return}
  const note=(byId("holidayNote").value||"").trim();
  const list=holidays();
  const existing=list.find(h=>h.date===date);
  if(existing)existing.note=note; else list.push({date,note});
  byId("holidayNote").value="";
  save();
}
function deleteHoliday(date){
  if(confirm("確定移除這個休息日？")){settings().holidays=holidays().filter(h=>h.date!==date);save()}
}

/* ---------- 國定假日（僅標示，是否公休由店家自訂） ---------- */
function renderNationalHolidays(){
  const el=byId("nationalHolidayList");if(!el)return;
  const list=nationalHolidays().slice().sort((a,b)=>a.date.localeCompare(b.date));
  el.innerHTML=list.length?list.map(h=>{
    const closed=holidays().some(x=>x.date===h.date);
    return `<div class="demand-row"><div class="list-icon nh-icon">假</div><div class="list-main"><strong>${formatDate(h.date)}｜${h.name}</strong><span>${closed?"已設為公休（當天休息）":"照常營業（僅標示假日）"}</span></div><div class="nh-actions"><button class="secondary-btn small-btn" onclick="toggleHolidayClosed('${h.date}','${h.name}')">${closed?"取消公休":"設為公休"}</button><button class="text-btn" onclick="deleteNationalHoliday('${h.date}')">移除</button></div></div>`;
  }).join(""):`<div class="empty-state">尚未匯入國定假日，可按上方「匯入台灣國定假日」。</div>`;
}
function importTaiwanHolidays(){
  const list=nationalHolidays();let added=0;
  TW_HOLIDAYS.forEach(([date,name])=>{if(!list.some(h=>h.date===date)){list.push({date,name});added++}});
  save();
  toast(`已匯入 ${added} 個臺灣國定假日（2026–2027），僅作標示。是否公休請在各假日按「設為公休」自行決定。`);
}
function addNationalHoliday(){
  const date=byId("nhDate").value;if(!date){toast("請先選擇日期","error");return}
  const name=(byId("nhName").value||"").trim();if(!name){toast("請輸入假日名稱","error");return}
  const list=nationalHolidays();const ex=list.find(h=>h.date===date);
  if(ex)ex.name=name;else list.push({date,name});
  byId("nhName").value="";save();
}
// 解析每行文字取出日期與名稱，支援 2028-01-01 / 2028/1/1 / 2028年1月1日 / 20280101 等格式
function parseHolidayLines(text){
  const out=[];
  (text||"").split(/\r?\n/).forEach(line=>{
    const t=line.trim();if(!t)return;
    let m=t.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/)||t.match(/(\d{4})(\d{2})(\d{2})/);
    if(!m)return;
    const date=`${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
    let name=t.replace(m[0],"");
    name=name.replace(/^[日\s,，、|\t]+/,"");                                   // 去開頭的「日」與分隔符（如 2028年1月1日）
    name=name.replace(/星期[一二三四五六日]|週[一二三四五六日]|[（(][一二三四五六日][）)]/g,""); // 去星期
    name=name.replace(/[（）()]/g,"").replace(/[,\t，、|]+/g," ").trim();
    if(!name)name="假日";
    out.push({date,name});
  });
  return out;
}
function importPastedHolidays(){
  const parsed=parseHolidayLines(byId("nhPasteText").value);
  if(!parsed.length){toast("找不到可辨識的日期，請確認每行含有日期，例如「2028-01-01 元旦」。","error");return}
  const list=nationalHolidays();let added=0,updated=0;
  parsed.forEach(({date,name})=>{const ex=list.find(h=>h.date===date);if(ex){ex.name=name;updated++}else{list.push({date,name});added++}});
  byId("nhPasteText").value="";save();
  toast(`已匯入 ${added} 筆、更新 ${updated} 筆假日。`);
}
function toggleHolidayClosed(date,name){
  const list=holidays();const i=list.findIndex(h=>h.date===date);
  if(i>=0)list.splice(i,1);else list.push({date,note:name});
  save();
}
function deleteNationalHoliday(date){
  settings().nationalHolidays=nationalHolidays().filter(h=>h.date!==date);save();
}

/* ---------- 每日需求模板 ---------- */
function getDemand(){return settings().dailyDemand}
function demandForWeekday(wd){return getDemand().filter(r=>r.weekday===wd).sort((a,b)=>mins(a.start)-mins(b.start))}
function renderDemand(){
  const tabs=byId("demandWeekTabs");if(!tabs)return;
  tabs.innerHTML=[1,2,3,4,5,6,0,7].map(d=>`<button type="button" class="seg-btn ${d===state.demandWeekday?"active":""}" data-dw="${d}">${dayLabel(d)}</button>`).join("");
  tabs.querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{state.demandWeekday=Number(b.dataset.dw);renderDemand()});
  const copyBtn=byId("copyDemandBtn");if(copyBtn)copyBtn.disabled=demandForWeekday(state.demandWeekday).length===0;
  const list=demandForWeekday(state.demandWeekday);
  byId("demandList").innerHTML=list.length?list.map(r=>{
    const w=worktype(r.workTypeId);const subTxt=(r.subWork||"").trim()?`＋${r.subWork.trim()}`:"";
    const noteTxt=(r.note||"").trim()?`<span class="demand-note">📝 ${r.note.trim()}</span>`:"";
    return `<div class="demand-row"><div class="list-icon" style="background:${w?.color||'#999'}22;color:${w?.color||'#999'}">●</div><div class="list-main"><strong>${w?.name||"未命名工作"}${subTxt}｜${r.count} 人</strong><span>${r.start}～${r.end}</span>${noteTxt}</div><button class="text-btn" onclick="openDemandModal('${r.id}')">編輯</button></div>`;
  }).join(""):`<div class="empty-state">${dayLabel(state.demandWeekday)}尚未設定固定班次${state.demandWeekday===7?"（落在平日的國定假日會套用這組）":""}</div>`;
}
function openDemandModal(id=null){
  const list=getDemand();
  const r=id?list.find(x=>x.id===id):{id:uid("dd"),weekday:state.demandWeekday,workTypeId:worksForWeekday(state.demandWeekday)[0]?.id||"",start:settings().businessStart,end:settings().businessEnd,count:1,subWork:"",note:""};
  const dayWorks=worksForWeekday(r.weekday,r.workTypeId);
  openModal(id?"編輯固定班次":"新增固定班次",`${dayLabel(r.weekday)}的固定人力`,`
    <div class="form-grid">
      <label class="field"><span>工作</span><select class="select" name="workTypeId">${dayWorks.map(w=>`<option value="${w.id}" ${w.id===r.workTypeId?"selected":""}>${w.name}</option>`).join("")}</select></label>
      <label class="field"><span>需要人數</span><input class="input" type="number" name="count" min="1" step="1" value="${r.count}"></label>
      <label class="field"><span>開始時間</span><select class="select" name="start">${timeOptions(r.start)}</select></label>
      <label class="field"><span>結束時間</span><select class="select" name="end">${timeOptions(r.end)}</select></label>
      <label class="field span-2"><span>附加工作（子工作，選填）</span><input class="input" name="subWork" value="${r.subWork||""}" placeholder="自行輸入，例如 備料"><small class="field-help">套用固定班次建立班次時會自動帶入，不用每次重打。</small></label>
      <label class="field span-2"><span>備註（選填）</span><input class="input" name="note" value="${(r.note||"").replace(/"/g,'&quot;')}" placeholder="例如 17:30 倒垃圾"><small class="field-help">套用固定班次時會帶到班次備註，並顯示在班表與匯出檔。</small></label>
      <div class="modal-actions span-2">${id?`<button type="button" class="danger-btn" onclick="deleteDemand('${r.id}')">刪除</button>`:""}<button type="button" class="ghost-btn" onclick="closeModal()">取消</button><button class="primary-btn">儲存</button></div>
    </div>`);
  byId("modalForm").onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target);const start=fd.get("start"),end=fd.get("end");
    if(mins(end)<=mins(start)){toast("結束時間必須晚於開始時間","error");return}
    Object.assign(r,{workTypeId:fd.get("workTypeId"),start,end,count:Math.max(1,Number(fd.get("count")||1)),subWork:(fd.get("subWork")||"").trim(),note:(fd.get("note")||"").trim()});
    if(!id)list.push(r);save();closeModal()};
}
function deleteDemand(id){if(confirm("確定刪除這筆需求？")){settings().dailyDemand=getDemand().filter(x=>x.id!==id);save();closeModal()}}
// 把某一天的需求整批複製到其他星期，省去逐日重設（平日大多相同，只有假日不同時特別方便）
function openCopyDemandModal(){
  const src=state.demandWeekday, srcRows=demandForWeekday(src);
  if(!srcRows.length){toast("這一天還沒有固定班次可以複製。");return}
  const others=[1,2,3,4,5,6,0,7].filter(d=>d!==src);
  const boxes=others.map(d=>`<label class="checkbox-card"><input type="checkbox" name="days" value="${d}"><span>${dayLabel(d)}</span></label>`).join("");
  openModal("複製固定班次",`把「${dayLabel(src)}」的 ${srcRows.length} 筆固定班次複製到其他天`,`
    <div class="form-grid">
      <div class="field span-2"><span>複製到（可多選）</span><div class="checkbox-grid">${boxes}</div></div>
      <label class="check-row span-2"><input type="checkbox" name="quickWeekdays"> 快速勾選：平日一～五</label>
      <div class="field span-2"><small class="field-help">勾選的星期原有需求會先清空，再貼上這一天的內容（含人數、時間、子工作與備註）。</small></div>
      <div class="modal-actions span-2"><button type="button" class="ghost-btn" onclick="closeModal()">取消</button><button class="primary-btn">複製</button></div>
    </div>`);
  const form=byId("modalForm");
  form.querySelector("[name=quickWeekdays]").addEventListener("change",ev=>{
    form.querySelectorAll("[name=days]").forEach(cb=>{if([1,2,3,4,5].includes(Number(cb.value)))cb.checked=ev.target.checked});
  });
  form.onsubmit=ev=>{ev.preventDefault();
    const targets=[...form.querySelectorAll("[name=days]:checked")].map(cb=>Number(cb.value));
    if(!targets.length){toast("請至少勾選一個要複製到的星期。","error");return}
    const all=getDemand().filter(r=>!targets.includes(r.weekday)); // 移除目標日原有需求
    targets.forEach(d=>srcRows.forEach(r=>all.push({...r,id:uid("dd"),weekday:d})));
    settings().dailyDemand=all;save();closeModal();
    toast(`已複製到 ${targets.map(dayLabel).join("、")}。`);
  };
}
// 選出最適合的員工（可排班、依主要負責與工時排序）
function bestEmployeeFor(date,start,end,workTypeId){
  const rows=state.data.employees.filter(e=>e.active).map(e=>({e,...getEmployeeEligibility(e,date,start,end,workTypeId)}));
  const ok=rows.filter(x=>x.eligible).sort((a,b)=>b.score-a.score);
  return ok[0]?.e.id||"";
}
function addDays(dateKey,n){const d=new Date(dateKey+"T00:00:00");d.setDate(d.getDate()+n);return toDateKey(d)}
// 把「上一週」整週班次複製到目前選取的這一週（同星期、同工作、同員工、同時段）
function copyLastWeek(){
  const [a,b]=weekRange(state.selectedDate);
  const prevA=addDays(a,-7),prevB=addDays(b,-7);
  const src=state.data.shifts.filter(s=>s.date>=prevA&&s.date<=prevB).sort((x,y)=>x.date.localeCompare(y.date));
  if(!src.length){toast(`上一週（${formatDate(prevA)}～${formatDate(prevB)}）沒有班次可以複製。`);return}
  const existing=state.data.shifts.filter(s=>s.date>=a&&s.date<=b).length;
  const msg=existing
    ? `本週（${formatDate(a)}～${formatDate(b)}）已有 ${existing} 個班次。\n將把上一週的 ${src.length} 個班次「加入」本週（不會刪除原有，之後可自行調整）。確定？`
    : `將上一週的 ${src.length} 個班次複製到本週（${formatDate(a)}～${formatDate(b)}）？`;
  if(!confirm(msg))return;
  src.forEach(s=>{
    const ns={...s,id:uid("s"),date:addDays(s.date,7),published:false}; // 複製過來先當草稿，確認後再公布
    ns.breakMinutes=breakForShift(ns);
    state.data.shifts.push(ns);
  });
  save();
  toast(`已複製 ${src.length} 個班次到本週。`);
}
// 公布本週：把本週所有班次設為已公布，員工端才看得到
function publishWeek(){
  const [a,b]=weekRange(state.selectedDate);
  const wsh=state.data.shifts.filter(s=>s.date>=a&&s.date<=b);
  if(!wsh.length){toast("本週沒有班次可公布。");return}
  const drafts=wsh.filter(s=>s.published===false);
  if(!drafts.length){toast("本週班次都已公布。");return}
  if(!confirm(`公布本週（${formatDate(a)}～${formatDate(b)}）？\n共 ${wsh.length} 個班次，其中 ${drafts.length} 個為新的／未公布。公布後員工就能在自己的班表看到。`))return;
  wsh.forEach(s=>s.published=true);
  // 記錄公布事件，供員工端顯示「幾號～幾號的班表已更新」
  const log=settings().publishLog;log.push({start:a,end:b,at:Date.now()});
  if(log.length>20)settings().publishLog=log.slice(-20);
  save();
  toast("已公布本週班表，員工現在可以看到了。","success");
}
// 取消公布本週：員工端暫時看不到（不刪除班次）
function unpublishWeek(){
  const [a,b]=weekRange(state.selectedDate);
  const wsh=state.data.shifts.filter(s=>s.date>=a&&s.date<=b);
  if(!wsh.length)return;
  if(!confirm(`取消公布本週（${formatDate(a)}～${formatDate(b)}）班表？\n取消後員工將暫時看不到本週班表（班次不會刪除，可再重新公布）。`))return;
  wsh.forEach(s=>s.published=false);save();
  toast("已取消公布本週班表。","success");
}
function renderPublishBar(){
  const el=byId("schedPublish");if(!el)return;
  const [a,b]=weekRange(state.selectedDate);
  const wsh=state.data.shifts.filter(s=>s.date>=a&&s.date<=b);
  if(!wsh.length){el.innerHTML="";return}
  const drafts=wsh.filter(s=>s.published===false).length;
  const allPub=drafts===0;
  el.innerHTML=`<span class="pub-badge ${allPub?"pub":"draft"}">${allPub?"● 本週已公布":`◍ ${drafts} 筆未公布`}</span>`
    +(allPub
      ? `<button class="ghost-btn small-btn" onclick="unpublishWeek()">取消公布</button>`
      : `<button class="primary-btn small-btn" onclick="publishWeek()">公布本週</button>`);
}
// 套用固定班次：
// 1) 國定假日（落在平日）自動套用「國定假日」那組模板，而不是看星期幾。
// 2) 就地更新：既有的待指派班次先補人（用最新可上班時間），只有真的不夠才補建，不會重複新增。
function applyDemand(dateKey){
  const isNH=!!nationalHolidayName(dateKey);
  // 國定假日優先套「國定假日」那組；若沒設定就退回當天星期的模板
  const useHoliday=isNH&&demandForWeekday(7).length>0;
  const wd=useHoliday?7:new Date(dateKey+"T00:00:00").getDay();
  const all=demandForWeekday(wd);
  if(!all.length){
    toast(`${dayLabel(wd)}尚未設定固定班次，請先按上方「固定班次設定」${isNH?"的「國定假日」分頁":""}建立。`);return;
  }
  const rows=all.filter(r=>workAppliesOnDate(worktype(r.workTypeId),dateKey));
  const skipped=all.length-rows.length;
  let created=0,assignedNow=0;
  rows.forEach(r=>{
    const match=s=>s.date===dateKey&&s.workTypeId===r.workTypeId&&s.start===r.start&&s.end===r.end;
    // 先把既有「待指派」的補上人（用最新可上班時間）
    state.data.shifts.filter(s=>match(s)&&!s.employeeId).forEach(s=>{
      const pick=bestEmployeeFor(dateKey,r.start,r.end,r.workTypeId);
      if(pick){s.employeeId=pick;s.breakMinutes=breakForShift(s);assignedNow++;}
    });
    // 只補建「還不夠」的數量（既有的含待指派都算數，不重複新增）
    const have=state.data.shifts.filter(match).length;
    for(let i=0;i<r.count-have;i++){
      const pick=bestEmployeeFor(dateKey,r.start,r.end,r.workTypeId);
      state.data.shifts.push({id:uid("s"),date:dateKey,workTypeId:r.workTypeId,employeeId:pick,start:r.start,end:r.end,breakMinutes:breakForShift({workTypeId:r.workTypeId,employeeId:pick,start:r.start,end:r.end}),note:(r.note||"").trim(),subWork:(r.subWork||"").trim(),prepRole:false,status:"draft",published:false});
      created++;
    }
  });
  // 套用後這些時段仍待指派的數量
  let unfilled=0;
  rows.forEach(r=>{unfilled+=state.data.shifts.filter(s=>s.date===dateKey&&s.workTypeId===r.workTypeId&&s.start===r.start&&s.end===r.end&&!s.employeeId).length;});
  const skipNote=skipped?`（${skipped} 筆因平日／假日限定不適用本日、已略過）`:"";
  if(!created&&!assignedNow){
    toast(`本日固定班次已建立且無可補指派的空缺，未變更。${unfilled?`目前仍有 ${unfilled} 個待指派。`:""}${skipNote}`);return;
  }
  save();
  const parts=[];
  if(created)parts.push(`新增 ${created} 個班次`);
  if(assignedNow)parts.push(`補指派 ${assignedNow} 人`);
  toast(`已套用${useHoliday?"國定假日":""}固定班次：${parts.join("、")}。${unfilled?`仍有 ${unfilled} 個待指派——可等可上班時間更新後再按一次「套用固定班次」自動補人（不會重複新增）。`:"皆已指派。"}${skipNote}`);
}

function onCloudData(data,info){
  if(info&&info.local)return; // 自己剛寫入的回音，畫面已即時更新
  state.data=migrate(data)||defaultData();
  if(autoPurge()>0){save();return;} // 自動清除舊資料；有清到就存回雲端（save 內含 renderAll）
  renderAll();
}
function updateSyncStatus(s){
  const el=byId("syncStatus");if(!el)return;
  const map={init:["◌","初始化"],connecting:["◌","連線中"],synced:["●","已同步"],saving:["◌","儲存中"],offline:["○","離線暫存"],local:["◍","本機模式"],error:["✕","雲端錯誤"]};
  const m=map[s]||map.local;el.className="sync-badge "+s;el.textContent=`${m[0]} ${m[1]}`;
  const isLocal=(s==="local");
  const nt=byId("sidebarNoteTitle"),nd=byId("sidebarNoteDesc");
  if(nt)nt.textContent=isLocal?"本機模式":"雲端同步版";
  if(nd)nd.textContent=isLocal?"資料僅存在此裝置瀏覽器":"資料儲存於雲端，多裝置即時同步";
}
function setupPinGate(){
  const gate=byId("pinGate");if(!gate)return;
  if(sessionStorage.getItem("adminUnlocked")==="1"){gate.classList.add("hidden");return;}
  const submit=()=>{
    const ref=(state.data&&state.data.settings&&state.data.settings.adminPin)||"1234";
    if(byId("pinInput").value.trim()===ref){sessionStorage.setItem("adminUnlocked","1");gate.classList.add("hidden");byId("pinError").textContent="";}
    else{byId("pinError").textContent="PIN 碼錯誤，請再試一次";byId("pinInput").value="";}
  };
  byId("pinSubmit").onclick=submit;
  byId("pinInput").addEventListener("keydown",e=>{if(e.key==="Enter")submit()});
}
function download(filename,text){
  triggerDownload(new Blob([text],{type:"application/json;charset=utf-8;"}),filename);
}
function exportBackup(kind){
  const store=(settings().storeName||"備份").trim();
  const payload={kind,exportedAt:new Date().toISOString(),items:state.data[kind]||[]};
  download(`${store}_${kind==="employees"?"員工":"工作"}備份_${toDateKey(new Date())}.json`,JSON.stringify(payload,null,2));
}
function importBackup(kind,file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const obj=JSON.parse(reader.result);
      const items=Array.isArray(obj)?obj:(obj.items||[]);
      if(!Array.isArray(items))throw new Error("bad");
      if(!confirm(`將以匯入的 ${items.length} 筆${kind==="employees"?"員工":"工作"}覆蓋目前資料，確定？`))return;
      state.data[kind]=items;save();toast("匯入完成。","success");
    }catch(e){toast("檔案格式不正確，請確認是本系統匯出的備份 JSON。","error");}
  };
  reader.readAsText(file);
}
function exportDemandBackup(){
  const store=(settings().storeName||"備份").trim();
  const payload={kind:"dailyDemand",exportedAt:new Date().toISOString(),items:getDemand()};
  download(`${store}_固定班次備份_${toDateKey(new Date())}.json`,JSON.stringify(payload,null,2));
}
function importDemandBackup(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const obj=JSON.parse(reader.result);
      const items=Array.isArray(obj)?obj:(obj.items||[]);
      if(!Array.isArray(items))throw new Error("bad");
      if(!confirm(`將以匯入的 ${items.length} 筆固定班次覆蓋目前設定，確定？`))return;
      settings().dailyDemand=items;save();toast("匯入完成。","success");
    }catch(e){toast("檔案格式不正確，請確認是本系統匯出的固定班次備份 JSON。","error");}
  };
  reader.readAsText(file);
}
// 完整備份：整份 data（員工、工作、班次、可上班、固定班次、設定）
function exportAll(){
  const store=(settings().storeName||"備份").trim();
  const payload={kind:"full",app:"tsai-scheduler",version:1,exportedAt:new Date().toISOString(),data:state.data};
  download(`${store}_完整備份_${toDateKey(new Date())}.json`,JSON.stringify(payload,null,2));
}
function importAll(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const obj=JSON.parse(reader.result);
      const d=obj&&obj.data?obj.data:obj; // 容許直接是 data 或包在 {data} 內
      if(!d||!Array.isArray(d.employees)||!Array.isArray(d.shifts))throw new Error("bad");
      if(!confirm(`將以此備份「完全覆蓋」目前所有資料（員工 ${d.employees.length}、工作 ${(d.workTypes||[]).length}、班次 ${d.shifts.length}）。\n此動作無法復原，確定還原？`))return;
      state.data=migrate(d);save();toast("完整備份已還原。","success");
    }catch(e){toast("檔案格式不正確，請確認是本系統匯出的「完整備份」JSON。","error");}
  };
  reader.readAsText(file);
}
// 清除「cutoff 日期之前」的舊資料：排班班次、可上班時間、預設可上班日期清單。回傳刪除筆數。
function purgeBefore(cutoff){
  const removed=state.data.shifts.filter(s=>s.date<cutoff).length
    +state.data.availability.filter(a=>a.date<cutoff).length;
  state.data.shifts=state.data.shifts.filter(s=>s.date>=cutoff);
  state.data.availability=state.data.availability.filter(a=>a.date>=cutoff);
  const s=settings();
  s.autoAvailableDates=(s.autoAvailableDates||[]).filter(d=>d>=cutoff);
  s.holidays=(s.holidays||[]).filter(h=>h.date>=cutoff); // 過去的特定休息日也一併清
  return removed;
}
// 立即清除 180 天前的舊資料（手動）
function purgeNow(){
  const days=180,cutoff=addDays(toDateKey(today),-days);
  const oldShifts=state.data.shifts.filter(s=>s.date<cutoff).length;
  const oldAvail=state.data.availability.filter(a=>a.date<cutoff).length;
  if(!oldShifts&&!oldAvail){toast(`目前沒有 ${days} 天前（${formatDate(cutoff)} 之前）的舊資料。`);return;}
  if(!confirm(`將永久刪除 ${formatDate(cutoff)} 之前的舊資料：\n・排班班次 ${oldShifts} 筆\n・可上班時間 ${oldAvail} 筆\n（工時是依班次即時計算，會一併清掉）\n\n此動作無法復原，建議先用上方「完整備份」匯出。確定清除？`))return;
  purgeBefore(cutoff);save();toast("已清除 180 天前的舊資料。");
}
// 開啟系統時依設定自動清除（回傳刪除筆數）
function autoPurge(){
  const days=Number(settings().autoPurgeDays||0);
  if(!(days>0))return 0;
  return purgeBefore(addDays(toDateKey(today),-days));
}
function renderMaintenance(){
  const inp=byId("autoPurgeInput");
  if(inp&&document.activeElement!==inp)inp.value=settings().autoPurgeDays;
}
function openFixedShiftModal(){const b=byId("fixedModalBackdrop");if(!b)return;b.classList.remove("hidden");renderDemand();}
function closeFixedShiftModal(){const b=byId("fixedModalBackdrop");if(b)b.classList.add("hidden");}
function init(){
  state.data=defaultData(); // 佔位，待雲端載入後覆蓋
  document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>setView(b.dataset.view));
  document.querySelectorAll("[data-view-target]").forEach(b=>b.onclick=()=>setView(b.dataset.viewTarget));
  document.querySelectorAll("[data-quick='add-shift']").forEach(b=>b.onclick=()=>openShiftModal());
  byId("schedAddBtn").onclick=()=>openShiftModal();
  byId("applyDemandBtn").onclick=()=>applyDemand(state.selectedDate);
  byId("copyLastWeekBtn").onclick=()=>copyLastWeek();
  byId("exportScheduleBtn").onclick=()=>openCsvChooser("要下載哪個範圍的班表？",m=>exportSchedule(m));
  byId("printWeekBtn").onclick=()=>printWeekSchedule();
  byId("addDemandBtn").onclick=()=>openDemandModal();
  byId("copyDemandBtn").onclick=()=>openCopyDemandModal();
  byId("fixedShiftBtn").onclick=()=>openFixedShiftModal();
  byId("fixedModalClose").onclick=()=>closeFixedShiftModal();
  byId("fixedModalBackdrop").onclick=e=>{if(e.target===byId("fixedModalBackdrop"))closeFixedShiftModal()};
  byId("exportDemandBtn").onclick=()=>exportDemandBackup();
  byId("importDemandBtn").onclick=()=>byId("importDemandFile").click();
  byId("importDemandFile").addEventListener("change",e=>{importDemandBackup(e.target.files[0]);e.target.value="";});
  byId("addHolidayBtn").onclick=addHoliday;
  byId("importHolidaysBtn").onclick=importTaiwanHolidays;
  byId("addNationalHolidayBtn").onclick=addNationalHoliday;
  byId("nhPasteBtn").onclick=importPastedHolidays;
  byId("schedPrev").onclick=()=>shiftSchedule(-1);
  byId("schedNext").onclick=()=>shiftSchedule(1);
  document.querySelectorAll("#schedModeTabs .seg-btn").forEach(b=>b.onclick=()=>{state.scheduleMode=b.dataset.smode;renderSchedule()});
  byId("menuBtn").onclick=()=>toggleSidebar();
  byId("sidebarBackdrop").onclick=()=>toggleSidebar(false);
  let _wasNarrow=isNarrow();
  window.addEventListener("resize",()=>{const n=isNarrow();if(n!==_wasNarrow){_wasNarrow=n;if(state.view==="schedule")renderSchedule();else if(state.view==="hours")renderHours();}});
  byId("modalCloseBtn").onclick=closeModal;byId("modalBackdrop").onclick=e=>{if(e.target===byId("modalBackdrop"))closeModal()};
  byId("addEmployeeBtn").onclick=()=>openEmployeeModal();byId("addWorktypeBtn").onclick=()=>openWorktypeModal();
  byId("addAvailabilityWindowBtn").onclick=()=>openAvailabilityWindowModal();
  byId("openNextWeekBtn")?.addEventListener("click",openNextWeekWindow);
  byId("openNextMonthBtn")?.addEventListener("click",openNextMonthWindow);
  byId("employeeSearch").oninput=renderEmployees;byId("employeeStatusFilter").onchange=renderEmployees;
  const calNav=dir=>{
    if(state.calendarExpanded){state.calendarDate.setMonth(state.calendarDate.getMonth()+dir);renderCalendar();}
    else{const d=new Date(state.selectedDate+"T00:00:00");d.setDate(d.getDate()+dir*7);selectDate(toDateKey(d));} // 收合時以「週」為單位
  };
  byId("prevMonthBtn").onclick=()=>calNav(-1);
  byId("nextMonthBtn").onclick=()=>calNav(1);
  byId("calToggleBtn").onclick=()=>{
    state.calendarExpanded=!state.calendarExpanded;
    if(state.calendarExpanded){const a=new Date(state.selectedDate+"T00:00:00");state.calendarDate=new Date(a.getFullYear(),a.getMonth(),1);}
    renderCalendar();
  };
  const shiftHours=delta=>{const d=new Date(state.hoursWeek+"T00:00:00");if(state.hoursMode==="month")d.setMonth(d.getMonth()+delta);else d.setDate(d.getDate()+delta*7);state.hoursWeek=toDateKey(d);syncHoursDateInput();renderHours()};
  const syncHoursDateInput=()=>{const inp=byId("hoursDateInput");if(inp)inp.value=state.hoursWeek;};
  byId("prevWeekBtn")?.addEventListener("click",()=>shiftHours(-1));
  byId("nextWeekBtn")?.addEventListener("click",()=>shiftHours(1));
  byId("thisWeekBtn")?.addEventListener("click",()=>{state.hoursWeek=toDateKey(new Date());syncHoursDateInput();renderHours()});
  byId("hoursDateInput")?.addEventListener("change",e=>{if(e.target.value){state.hoursWeek=e.target.value;renderHours()}});
  document.querySelectorAll("#hoursModeTabs .seg-btn").forEach(b=>b.addEventListener("click",()=>{state.hoursMode=b.dataset.hmode;state.hoursExpanded=null;renderHours()}));
  byId("hoursTypeFilter")?.addEventListener("change",e=>{state.hoursType=e.target.value;renderHours()});
  byId("hoursSearchInput")?.addEventListener("input",e=>{state.hoursSearch=e.target.value;renderHours()});
  byId("exportHoursBtn")?.addEventListener("click",()=>openCsvChooser("要下載哪個範圍的工時統計？",m=>exportHours(m)));
  byId("exportAvailBtn")?.addEventListener("click",()=>openCsvChooser("要下載哪個範圍的可上班時間？",m=>exportAvailability(m)));
  syncHoursDateInput();
  document.querySelectorAll("#availModeTabs .staff-tab").forEach(b=>b.onclick=()=>{state.availMode=b.dataset.mode;renderAvailabilityOverview()});
  document.querySelectorAll("#availPageTabs .staff-tab").forEach(b=>b.onclick=()=>{state.availPage=b.dataset.atab;syncAvailPage()});
  document.querySelectorAll("#settingsTabs .staff-tab").forEach(b=>b.onclick=()=>{state.settingsTab=b.dataset.sec;syncSettingsTab()});
  byId("printGuideBtn")?.addEventListener("click",printGuide);
  byId("resetDemoBtn").onclick=()=>{if(confirm("確定清空所有資料？此動作無法復原（建議先匯出備份）。")){state.data=defaultData();save()}};
  byId("pinChangeForm")?.addEventListener("submit",e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const cur=(fd.get("currentPin")||"").trim(),np=(fd.get("newPin")||"").trim(),cp=(fd.get("confirmPin")||"").trim();
    const ref=settings().adminPin||"1234";
    const msg=byId("pinChangeMsg");
    const bad=t=>{if(msg){msg.textContent=t;msg.className="span-2 form-error";}};
    if(cur!==ref)return bad("目前 PIN 碼不正確");
    if(!/^\d{4,}$/.test(np))return bad("新 PIN 碼請至少 4 位數字");
    if(np!==cp)return bad("兩次輸入的新 PIN 碼不一致");
    settings().adminPin=np;save();e.target.reset();
    if(msg){msg.textContent="✓ PIN 碼已更新，下次進入後台生效。";msg.className="span-2 success-note";}
  });
  byId("exportEmployeesBtn")?.addEventListener("click",()=>exportBackup("employees"));
  byId("importEmployeesBtn")?.addEventListener("click",()=>byId("importEmployeesFile").click());
  byId("importEmployeesFile")?.addEventListener("change",e=>{importBackup("employees",e.target.files[0]);e.target.value="";});
  byId("exportWorktypesBtn")?.addEventListener("click",()=>exportBackup("workTypes"));
  byId("importWorktypesBtn")?.addEventListener("click",()=>byId("importWorktypesFile").click());
  byId("importWorktypesFile")?.addEventListener("change",e=>{importBackup("workTypes",e.target.files[0]);e.target.value="";});
  byId("purgeNowBtn")?.addEventListener("click",purgeNow);
  byId("saveAutoPurgeBtn")?.addEventListener("click",()=>{
    const v=Math.max(0,Math.floor(Number(byId("autoPurgeInput").value)||0));
    settings().autoPurgeDays=v;save();
    toast(v>0?`已設定：超過 ${v} 天的舊資料會在開啟系統時自動清除。`:"已關閉自動清除（不會自動刪除舊資料）。");
  });
  byId("exportAllBtn")?.addEventListener("click",exportAll);
  byId("importAllBtn")?.addEventListener("click",()=>byId("importAllFile").click());
  byId("importAllFile")?.addEventListener("change",e=>{importAll(e.target.files[0]);e.target.value="";});
  setupPinGate();
  if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
  Cloud.init(onCloudData,updateSyncStatus);
}
window.openEmployeeModal=openEmployeeModal;window.deleteEmployee=deleteEmployee;window.openWorktypeModal=openWorktypeModal;window.deleteWorktype=deleteWorktype;window.openShiftModal=openShiftModal;window.deleteShift=deleteShift;window.closeModal=closeModal;window.selectDate=selectDate;
window.hoursSortBy=hoursSortBy;window.hoursToggle=hoursToggle;window.setShiftActual=setShiftActual;window.toggleShiftVerified=toggleShiftVerified;window.verifyAll=verifyAll;window.gotoScheduleDay=gotoScheduleDay;window.openQuickAssign=openQuickAssign;window.quickAssignPick=quickAssignPick;
document.addEventListener("DOMContentLoaded",init);

window.openAvailabilityWindowModal=openAvailabilityWindowModal;window.deleteAvailabilityWindow=deleteAvailabilityWindow;
window.availMonthNav=availMonthNav;window.availPickDate=availPickDate;window.availPickEmployee=availPickEmployee;window.openAvailEditModal=openAvailEditModal;window.availOpenDate=availOpenDate;window.availQuickSet=availQuickSet;window.availAllForDate=availAllForDate;window.availAllForEmployee=availAllForEmployee;
window.openDemandModal=openDemandModal;window.deleteDemand=deleteDemand;window.openCopyDemandModal=openCopyDemandModal;window.deleteHoliday=deleteHoliday;window.publishWeek=publishWeek;window.unpublishWeek=unpublishWeek;
window.toggleHolidayClosed=toggleHolidayClosed;window.deleteNationalHoliday=deleteNationalHoliday;


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
function isWeekendDay(wd){return wd===0||wd===6} // 六日為假日
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
    worktypes:["工作管理","設定工作名稱、顏色與休息規則"],
    schedule:["排班管理","以月曆與日時間軸快速完成排班"],
    hours:["工時總覽","查看每位員工每週的計薪工時"],
    availability:["可上班時間","開放員工填寫，並檢視每個人填寫的可上班時間"],
    storeSettings:["設定與維護","店名、上班時間、公休、休息時段與資料維護"],
  }[view];
  byId("pageTitle").textContent=meta[0];byId("pageSubtitle").textContent=meta[1];
  byId("sidebar").classList.remove("open");
  renderAll();
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
  [applyBranding,renderDashboard,renderEmployees,renderWorktypes,renderCalendar,renderSchedule,renderAvailabilityWindows,renderHours,renderAvailabilityOverview,syncAvailPage,renderStoreSettings,renderDemand,renderHolidays,renderNationalHolidays,syncSettingsTab]
    .forEach(fn=>{try{fn()}catch(err){console.error("render error:",fn.name,err)}});
}
function renderDashboard(){
  const todayKey=toDateKey(today);
  const active=state.data.employees.filter(e=>e.active).length, month=todayKey.slice(0,7);
  const shifts=state.data.shifts.filter(s=>s.date.startsWith(month));
  const hours=shifts.reduce((n,s)=>n+durationHours(s),0);
  const avail=state.data.availability.filter(a=>a.date.startsWith(month)).length;
  const fill=windowFillStatus(currentWindow());
  const monthNum=Number(month.slice(5));
  byId("dashboardStats").innerHTML=[
    ["在職員工",active,"可安排人力"],
    ["本月班次",shifts.length,`${monthNum} 月已建立`],
    ["本月計薪工時",fmtHours(hours),`${monthNum} 月依班次自動計算`],
    ["可上班時間填寫",fill?`${fill.filled.length}／${fill.total}`:avail+" 筆",fill?`${fill.unfilled.length} 人未填`:"員工提交紀錄"]
  ].map(x=>`<div class="stat-card"><span>${x[0]}</span><strong>${x[1]}</strong><small>${x[2]}</small></div>`).join("");
  byId("todayLabel").textContent=formatDate(todayKey);
  const selected=state.data.shifts.filter(s=>s.date===todayKey).sort((a,b)=>mins(a.start)-mins(b.start));
  byId("todayShifts").innerHTML=selected.length?selected.map(shiftListItem).join(""):`<div class="empty-state">今天尚未排班</div>`;
  const warns=[];
  if(fill&&fill.unfilled.length)warns.push({t:`${fill.unfilled.length} 人尚未填寫可上班時間`,d:fill.unfilled.map(e=>e.name).join("、")});
  // 固定班次缺額（未來 14 天）：只提醒「已經開始排、但還沒排滿」的日子，避免整批未排的未來日誤報
  const demandWarns=[];
  for(let i=0;i<14;i++){
    const d=new Date(today);d.setDate(d.getDate()+i);const key=toDateKey(d);
    if(isClosedDay(key))continue;
    if(!state.data.shifts.some(s=>s.date===key))continue; // 這天完全還沒排班就不算缺人
    demandGaps(key).forEach(r=>{
      if(r.gap>0&&workAppliesOnDate(worktype(r.workTypeId),key)){
        const w=worktype(r.workTypeId);
        demandWarns.push({t:`${formatDate(key)} 缺 ${r.gap} 位 ${w?.name||""}`,d:`固定班次需 ${r.count} 人・${r.start}～${r.end}`});
      }
    });
  }
  demandWarns.slice(0,6).forEach(x=>warns.push(x));
  // 未指派員工的班次（只看今天以後，過去的不再提醒；附上日期方便找）
  const unassignedShifts=state.data.shifts.filter(s=>!s.employeeId&&s.date>=todayKey).sort((a,b)=>a.date.localeCompare(b.date));
  if(unassignedShifts.length){
    const dates=[...new Set(unassignedShifts.map(s=>formatDate(s.date)))];
    warns.push({t:`${unassignedShifts.length} 個班次尚未指派員工`,d:`日期：${dates.slice(0,5).join("、")}${dates.length>5?" 等":""}｜請於排班頁點該班次指派`});
  }
  // 未公布的即將到來班次（員工看不到）
  const draftUpcoming=state.data.shifts.filter(s=>s.published===false&&s.date>=todayKey);
  if(draftUpcoming.length){
    const dw=[...new Set(draftUpcoming.map(s=>formatDate(s.date)))];
    warns.push({t:`${draftUpcoming.length} 個班次尚未公布`,d:`日期：${dw.slice(0,5).join("、")}${dw.length>5?" 等":""}｜員工看不到，請於排班頁按「公布本週」`});
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
  byId("dashboardWarnings").innerHTML=warns.length?warns.map(w=>`<div class="list-item"><div class="list-icon">⚠</div><div class="list-main"><strong>${w.t}</strong><span>${w.d}</span></div></div>`).join(""):`<div class="empty-state">目前沒有明顯衝突</div>`;
}
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
    return `<button class="dg-block dg-block-vert ${e?"":"unassigned"}${draftCls}"${tipAttr} onclick="event.stopPropagation();openShiftModal('${s.id}')" style="${style}"><span class="dg-vert">${txt}</span></button>`;
  }
  const label=`${s.start}–${s.end}${subTxt}`;
  const noteLine=note?`<span class="dg-note">📝 ${note}</span>`:"";
  const draftLine=draft?`<span class="dg-draft">草稿・未公布</span>`:"";
  return `<button class="dg-block ${e?"":"unassigned"}${draftCls}"${tipAttr} onclick="event.stopPropagation();openShiftModal('${s.id}')" style="${style}"><strong>${who}</strong><span>${label}</span>${noteLine}${draftLine}</button>`;
}
function renderSchedule(){
  const grid=byId("scheduleGrid");if(!grid)return;
  document.querySelectorAll("#schedModeTabs .seg-btn").forEach(b=>b.classList.toggle("active",b.dataset.smode===state.scheduleMode));
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
  document.querySelectorAll("#scheduleGrid .dg-track").forEach(track=>{
    track.addEventListener("click",ev=>{
      if(ev.target.closest(".dg-block"))return;
      const date=track.dataset.date;
      const rect=track.getBoundingClientRect();
      const frac=Math.max(0,Math.min(1,(ev.clientY-rect.top)/rect.height));
      let m=axis.startM+Math.round((frac*axis.total)/axis.step)*axis.step;
      m=Math.max(axis.startM,Math.min(m,axis.endM-axis.step)); // 保留至少一格
      const start=`${pad(Math.floor(m/60))}:${pad(m%60)}`;
      if(isClosedDay(date)&&!confirm("這一天是公休日，確定要排班？"))return;
      const workId=track.dataset.work||worksForDate(date)[0]?.id||state.data.workTypes.find(w=>w.active)?.id||"";
      openShiftModal(null,{date,workTypeId:workId,start});
    });
  });
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
function exportSchedule(mode){
  const {rows,start,end}=scheduleRows(mode);
  const csv="﻿"+rows.map(r=>r.map(csvEscape).join(",")).join("\r\n");
  const store=(settings().storeName||"班表").trim();
  const fname=mode==="week"?`${store}_週班表_${start}_至_${end}.csv`:`${store}_月班表_${start.slice(0,7)}.csv`;
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=fname;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
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
function openAvailabilityWindowModal(id=null){
  const windows=getAvailabilityWindows();
  const w=id?windows.find(x=>x.id===id):{
    id:uid("aw"),name:"",openStart:"",openEnd:"",targetStart:"",targetEnd:"",enabled:true,note:"",defaultAvailable:false
  };
  const tk=toDateKey(today);
  openModal(id?"編輯開放區段":"新增開放區段","設定員工可進入填寫的期間，以及實際要填寫的排班日期",`
    <div class="form-grid">
      <label class="field span-2"><span>區段名稱</span><input class="input" name="name" required value="${w.name}" placeholder="例如 8月上半月可上班時間"></label>
      <label class="field"><span>開放填寫起日</span><input class="input" type="date" name="openStart" min="${tk}" required value="${w.openStart}"></label>
      <label class="field"><span>開放填寫迄日</span><input class="input" type="date" name="openEnd" min="${tk}" required value="${w.openEnd}"></label>
      <label class="field"><span>可填寫排班起日</span><input class="input" type="date" name="targetStart" min="${tk}" required value="${w.targetStart}"></label>
      <label class="field"><span>可填寫排班迄日</span><input class="input" type="date" name="targetEnd" min="${tk}" required value="${w.targetEnd}"></label>
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
    if(openStart<tk){alert("開放填寫起日不可早於今天");return}
    if(openEnd<openStart){alert("開放填寫迄日不可早於起日");return}
    if(targetStart<tk){alert("可填寫排班起日不可早於今天");return}
    if(targetEnd<targetStart){alert("可填寫排班迄日不可早於起日");return}
    // 不同區段的「可填寫排班日期」不可重疊
    const clash=windows.find(x=>x.id!==w.id&&targetStart<=x.targetEnd&&targetEnd>=x.targetStart);
    if(clash){alert(`可填寫排班日期與區段「${clash.name}」重疊（${formatDate(clash.targetStart)}～${formatDate(clash.targetEnd)}），請調整日期不要衝突。`);return}
    Object.assign(w,{
      name:fd.get("name").trim(),
      openStart,openEnd,targetStart,targetEnd,
      enabled:fd.get("enabled")==="on",
      defaultAvailable:fd.get("defaultAvailable")==="on",
      note:fd.get("note").trim()
    });
    if(!id)windows.push(w);
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
      <label class="field span-2"><span>每週計薪工時上限</span><input class="input" name="weeklyLimit" id="empWeeklyLimit" type="number" min="0" step=".5" value="${e.weeklyLimit}"><small class="field-help" id="empLimitHint">外籍學生預設 ${foreignLimit} 小時／週。</small></label>
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
  form.onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target),no=fd.get("employeeNo").trim().toUpperCase();if(state.data.employees.some(x=>x.employeeNo.toUpperCase()===no&&x.id!==e.id)){alert("員工編號不可重複");return}
    const works=fd.getAll("works");
    // 主要工作必須落在可做工作範圍內
    const primaryWeekday=fd.getAll("primaryWeekday").filter(w=>works.includes(w));
    const primaryWeekend=fd.getAll("primaryWeekend").filter(w=>works.includes(w));
    Object.assign(e,{name:fd.get("name").trim(),employeeNo:no,employmentType:fd.get("employmentType"),shiftClass:fd.get("shiftClass"),noBreak:fd.get("noBreak")==="on",weeklyLimit:Number(fd.get("weeklyLimit")||0),allowedWorkTypeIds:works,primaryWeekday,primaryWeekend,note:(fd.get("note")||"").trim(),active:fd.get("active")==="on"});
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
    const cfg=settings();
    const endM=Math.min(mins(defStart)+240,mins(cfg.businessEnd)); // 預設 4 小時，不超過最晚下班
    defEnd=`${pad(Math.floor(endM/60))}:${pad(endM%60)}`;
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
    <div class="modal-actions span-2">${id?`<button type="button" class="danger-btn" onclick="deleteShift('${s.id}')">刪除</button>`:""}<button type="button" class="ghost-btn" onclick="closeModal()">取消</button><button class="primary-btn">儲存班次</button></div>
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
    byId("shiftWarnings").innerHTML=warnings.map(w=>`<div class="list-item"><div class="list-icon">⚠</div><div class="list-main"><strong>${w}</strong><span>第一版仍允許主管儲存，以保留例外彈性</span></div></div>`).join("")
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
  form.onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target);if(!fd.get("employeeId")){alert("請選擇員工");return}
    if(isClosedDay(fd.get("date"))&&!confirm("這一天是公休日，確定仍要排班？")){return}
    Object.assign(s,{date:fd.get("date"),workTypeId:fd.get("workTypeId"),subWork:(fd.get("subWork")||"").trim(),employeeId:fd.get("employeeId"),start:fd.get("start"),end:fd.get("end"),breakMinutes:breakForShift({workTypeId:fd.get("workTypeId"),employeeId:fd.get("employeeId"),start:fd.get("start"),end:fd.get("end")}),note:fd.get("note").trim()});
    if(mins(s.end)<=mins(s.start)){alert("結束時間必須晚於開始時間");return}
    if(!id)state.data.shifts.push(s);state.selectedDate=s.date;save();closeModal()
  }
}
function deleteShift(id){if(confirm("確定刪除這個班次？")){state.data.shifts=state.data.shifts.filter(x=>x.id!==id);save();closeModal()}}

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
// 取得某員工某日的「實際」可上班狀態：優先用已填紀錄；若該日所屬區段設定「預設全部可上班」且非公休，則視為整天可上班。
function effectiveAvail(employeeId,dateKey){
  const rec=state.data.availability.find(a=>a.employeeId===employeeId&&a.date===dateKey);
  if(rec)return rec;
  const w=windowForDate(dateKey);
  if(w&&w.defaultAvailable&&!isClosedDay(dateKey)){
    return {employeeId,date:dateKey,unavailable:false,start:settings().businessStart,end:settings().businessEnd,_default:true};
  }
  return undefined;
}
// 某員工在某填寫區段是否已填（有紀錄，或該區段設為預設全部可上班即視為已覆蓋）
function hasFilled(employeeId,w){
  if(!w)return false;
  if(w.defaultAvailable)return true;
  return state.data.availability.some(a=>a.employeeId===employeeId&&a.date>=w.targetStart&&a.date<=w.targetEnd);
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
    if(mins(be)<=mins(bs)){alert("最晚下班時間必須晚於最早上班時間");return}
    const brs=fd.get("breakStart"),bre=fd.get("breakEnd");
    if(mins(bre)<=mins(brs)){alert("休息結束時間必須晚於開始時間");return}
    Object.assign(cfg,{
      storeName:fd.get("storeName").trim(),
      timeStep:Number(fd.get("timeStep")),
      businessStart:bs,businessEnd:be,
      breakStart:brs,breakEnd:bre,
      foreignDefaultLimit:Number(fd.get("foreignDefaultLimit")||0),
      closedDays:fd.getAll("closedDays").map(Number)
    });
    save();alert("已儲存店家設定");
  };
}

/* ---------- 工時總覽（員工 × 一週七天矩陣） ---------- */
function shiftDayHours(employeeId,dateKey){
  return state.data.shifts.filter(s=>s.employeeId===employeeId&&s.date===dateKey).reduce((n,s)=>n+durationHours(s),0);
}
function renderHours(){
  const wrap=byId("hoursTable");if(!wrap)return;
  const [startKey,endKey]=weekRange(state.hoursWeek);
  const days=datesInRange(startKey,endKey);
  byId("hoursWeekLabel").textContent=`${formatDate(startKey)} ～ ${formatDate(endKey)}`;
  const actives=state.data.employees.filter(e=>e.active);
  const head=`<tr><th>員工</th>${days.map(d=>{const dd=new Date(d+"T00:00:00");return `<th class="hcell">${dd.getMonth()+1}/${dd.getDate()}<span>${"日一二三四五六"[dd.getDay()]}</span></th>`}).join("")}<th>本週合計 / 上限</th></tr>`;
  const body=actives.map(e=>{
    let total=0;
    const cells=days.map(d=>{const h=shiftDayHours(e.id,d);total+=h;return `<td class="hcell">${h?fmtNum(h):`<span class="hmuted">–</span>`}</td>`}).join("");
    const foreign=e.employmentType==="外籍學生";
    let cls="",note="";
    if(e.weeklyLimit){
      if(total>e.weeklyLimit){cls="over";note=foreign?" ⚠外籍超時":" ⚠超時";}
      else if(total>=e.weeklyLimit*0.9){cls="near";note=" 接近上限";}
    }
    return `<tr><td class="hname"><strong>${e.name}</strong>${foreign?`<span class="badge warn">外籍</span>`:`<span class="cell-sub">${e.employmentType}</span>`}</td>${cells}<td class="htotal ${cls}"><strong>${fmtNum(total)}</strong> / ${e.weeklyLimit||"—"}${note}</td></tr>`;
  }).join("");
  wrap.innerHTML=`<table class="hours-matrix"><thead>${head}</thead><tbody>${body||`<tr><td>尚無在職員工</td></tr>`}</tbody></table>`;
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
      summary.innerHTML=`<div class="info-banner"><div>
        <strong>目前開放：${w.name}｜填寫排班日期 ${formatDate(w.targetStart)} ～ ${formatDate(w.targetEnd)}</strong>
        <span>已填 ${fill.filled.length} 人・未填 ${fill.unfilled.length} 人（共 ${fill.total} 位在職員工）</span>
        ${fill.unfilled.length&&!w.defaultAvailable?`<span>未填：${fill.unfilled.map(e=>e.name).join("、")}</span>`:""}
      </div></div>`;
    }else{
      summary.innerHTML=`<div class="info-banner"><div><strong>目前沒有開放中的填寫區段</strong><span>員工端暫時無法自行填寫；後台仍可在下方直接代填任何日期（例如員工提早告知的休假）。</span></div></div>`;
    }
  }
  // 後台不受開放區段限制，任何日期都可檢視／代填
  if(state.availMode==="month")root.innerHTML=availMonthView();
  else if(state.availMode==="date")root.innerHTML=availDateView();
  else root.innerHTML=availEmployeeView();
}
function availAt(employeeId,dateKey){return state.data.availability.find(a=>a.employeeId===employeeId&&a.date===dateKey)}
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
    if(st==="on"&&mins(e)<=mins(s)){alert("結束時間必須晚於開始時間");return}
    let rec=list.find(x=>x.employeeId===employeeId&&x.date===dateKey);
    if(!rec){rec={id:uid("a"),employeeId,date:dateKey};list.push(rec)}
    Object.assign(rec,{unavailable:st==="off",start:s,end:e});
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
  if(!date){alert("請先選擇日期");return}
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
  alert(`已匯入 ${added} 個臺灣國定假日（2026–2027），僅作標示。是否公休請在各假日按「設為公休」自行決定。`);
}
function addNationalHoliday(){
  const date=byId("nhDate").value;if(!date){alert("請先選擇日期");return}
  const name=(byId("nhName").value||"").trim();if(!name){alert("請輸入假日名稱");return}
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
  if(!parsed.length){alert("找不到可辨識的日期，請確認每行含有日期，例如「2028-01-01 元旦」。");return}
  const list=nationalHolidays();let added=0,updated=0;
  parsed.forEach(({date,name})=>{const ex=list.find(h=>h.date===date);if(ex){ex.name=name;updated++}else{list.push({date,name});added++}});
  byId("nhPasteText").value="";save();
  alert(`已匯入 ${added} 筆、更新 ${updated} 筆假日。`);
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
  tabs.innerHTML=[1,2,3,4,5,6,0].map(d=>`<button type="button" class="seg-btn ${d===state.demandWeekday?"active":""}" data-dw="${d}">星期${"日一二三四五六"[d]}</button>`).join("");
  tabs.querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{state.demandWeekday=Number(b.dataset.dw);renderDemand()});
  const copyBtn=byId("copyDemandBtn");if(copyBtn)copyBtn.disabled=demandForWeekday(state.demandWeekday).length===0;
  const list=demandForWeekday(state.demandWeekday);
  byId("demandList").innerHTML=list.length?list.map(r=>{
    const w=worktype(r.workTypeId);const subTxt=(r.subWork||"").trim()?`＋${r.subWork.trim()}`:"";
    const noteTxt=(r.note||"").trim()?`<span class="demand-note">📝 ${r.note.trim()}</span>`:"";
    return `<div class="demand-row"><div class="list-icon" style="background:${w?.color||'#999'}22;color:${w?.color||'#999'}">●</div><div class="list-main"><strong>${w?.name||"未命名工作"}${subTxt}｜${r.count} 人</strong><span>${r.start}～${r.end}</span>${noteTxt}</div><button class="text-btn" onclick="openDemandModal('${r.id}')">編輯</button></div>`;
  }).join(""):`<div class="empty-state">星期${"日一二三四五六"[state.demandWeekday]}尚未設定固定班次</div>`;
}
function openDemandModal(id=null){
  const list=getDemand();
  const r=id?list.find(x=>x.id===id):{id:uid("dd"),weekday:state.demandWeekday,workTypeId:worksForWeekday(state.demandWeekday)[0]?.id||"",start:settings().businessStart,end:settings().businessEnd,count:1,subWork:"",note:""};
  const dayWorks=worksForWeekday(r.weekday,r.workTypeId);
  openModal(id?"編輯固定班次":"新增固定班次",`星期${"日一二三四五六"[r.weekday]}的固定人力`,`
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
    if(mins(end)<=mins(start)){alert("結束時間必須晚於開始時間");return}
    Object.assign(r,{workTypeId:fd.get("workTypeId"),start,end,count:Math.max(1,Number(fd.get("count")||1)),subWork:(fd.get("subWork")||"").trim(),note:(fd.get("note")||"").trim()});
    if(!id)list.push(r);save();closeModal()};
}
function deleteDemand(id){if(confirm("確定刪除這筆需求？")){settings().dailyDemand=getDemand().filter(x=>x.id!==id);save();closeModal()}}
// 把某一天的需求整批複製到其他星期，省去逐日重設（平日大多相同，只有假日不同時特別方便）
function openCopyDemandModal(){
  const src=state.demandWeekday, srcRows=demandForWeekday(src);
  if(!srcRows.length){alert("這一天還沒有固定班次可以複製。");return}
  const others=[1,2,3,4,5,6,0].filter(d=>d!==src);
  const boxes=others.map(d=>`<label class="checkbox-card"><input type="checkbox" name="days" value="${d}"><span>星期${"日一二三四五六"[d]}</span></label>`).join("");
  openModal("複製固定班次",`把「星期${"日一二三四五六"[src]}」的 ${srcRows.length} 筆固定班次複製到其他星期`,`
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
    if(!targets.length){alert("請至少勾選一個要複製到的星期。");return}
    const all=getDemand().filter(r=>!targets.includes(r.weekday)); // 移除目標日原有需求
    targets.forEach(d=>srcRows.forEach(r=>all.push({...r,id:uid("dd"),weekday:d})));
    settings().dailyDemand=all;save();closeModal();
    alert(`已複製到 ${targets.map(d=>"星期"+"日一二三四五六"[d]).join("、")}。`);
  };
}
// 選出最適合的員工（可排班、依主要負責與工時排序）
function bestEmployeeFor(date,start,end,workTypeId){
  const rows=state.data.employees.filter(e=>e.active).map(e=>({e,...getEmployeeEligibility(e,date,start,end,workTypeId)}));
  const ok=rows.filter(x=>x.eligible).sort((a,b)=>b.score-a.score);
  return ok[0]?.e.id||"";
}
// 對照某日需求與已排班次，回傳每筆需求的缺額
function demandGaps(dateKey){
  const wd=new Date(dateKey+"T00:00:00").getDay();
  return demandForWeekday(wd).map(r=>{
    const filled=state.data.shifts.filter(s=>s.date===dateKey&&s.workTypeId===r.workTypeId&&s.start===r.start&&s.end===r.end&&s.employeeId).length;
    return {...r,filled,gap:Math.max(0,r.count-filled)};
  });
}
function addDays(dateKey,n){const d=new Date(dateKey+"T00:00:00");d.setDate(d.getDate()+n);return toDateKey(d)}
// 把「上一週」整週班次複製到目前選取的這一週（同星期、同工作、同員工、同時段）
function copyLastWeek(){
  const [a,b]=weekRange(state.selectedDate);
  const prevA=addDays(a,-7),prevB=addDays(b,-7);
  const src=state.data.shifts.filter(s=>s.date>=prevA&&s.date<=prevB).sort((x,y)=>x.date.localeCompare(y.date));
  if(!src.length){alert(`上一週（${formatDate(prevA)}～${formatDate(prevB)}）沒有班次可以複製。`);return}
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
  alert(`已複製 ${src.length} 個班次到本週。`);
}
// 公布本週：把本週所有班次設為已公布，員工端才看得到
function publishWeek(){
  const [a,b]=weekRange(state.selectedDate);
  const wsh=state.data.shifts.filter(s=>s.date>=a&&s.date<=b);
  if(!wsh.length){alert("本週沒有班次可公布。");return}
  const drafts=wsh.filter(s=>s.published===false);
  if(!drafts.length){alert("本週班次都已公布。");return}
  if(!confirm(`公布本週（${formatDate(a)}～${formatDate(b)}）？\n共 ${wsh.length} 個班次，其中 ${drafts.length} 個為新的／未公布。公布後員工就能在自己的班表看到。`))return;
  wsh.forEach(s=>s.published=true);save();
  alert("已公布本週班表，員工現在可以看到了。");
}
// 取消公布本週：員工端暫時看不到（不刪除班次）
function unpublishWeek(){
  const [a,b]=weekRange(state.selectedDate);
  const wsh=state.data.shifts.filter(s=>s.date>=a&&s.date<=b);
  if(!wsh.length)return;
  if(!confirm(`取消公布本週（${formatDate(a)}～${formatDate(b)}）班表？\n取消後員工將暫時看不到本週班表（班次不會刪除，可再重新公布）。`))return;
  wsh.forEach(s=>s.published=false);save();
  alert("已取消公布本週班表。");
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
function applyDemand(dateKey){
  const allGaps=demandGaps(dateKey);
  if(!allGaps.length){alert(`星期${"日一二三四五六"[new Date(dateKey+"T00:00:00").getDay()]}尚未設定固定班次，請先按上方「固定班次設定」建立。`);return}
  // 依平日／假日規則過濾：只在假日出現的工作不會排進平日，反之亦然
  const gaps=allGaps.filter(r=>workAppliesOnDate(worktype(r.workTypeId),dateKey));
  const skipped=allGaps.length-gaps.length;
  let created=0,unfilled=0;
  gaps.forEach(r=>{
    for(let i=0;i<r.gap;i++){
      const pick=bestEmployeeFor(dateKey,r.start,r.end,r.workTypeId);
      const s={id:uid("s"),date:dateKey,workTypeId:r.workTypeId,employeeId:pick,start:r.start,end:r.end,breakMinutes:breakForShift({workTypeId:r.workTypeId,employeeId:pick,start:r.start,end:r.end}),note:(r.note||"").trim(),subWork:(r.subWork||"").trim(),prepRole:false,status:"draft",published:false};
      state.data.shifts.push(s);created++;if(!pick)unfilled++;
    }
  });
  const skipNote=skipped?`（${skipped} 筆因平日／假日限定不適用本日、已略過）`:"";
  if(!created){alert(`這一天的需求都已排滿，未新增班次。${skipNote}`);return}
  save();
  alert(`已依需求建立 ${created} 個班次${unfilled?`，其中 ${unfilled} 個找不到合適員工、需手動指派`:"，皆已自動指派最適人選"}。${skipNote}`);
}

function onCloudData(data,info){
  if(info&&info.local)return; // 自己剛寫入的回音，畫面已即時更新
  state.data=migrate(data)||defaultData();
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
  const blob=new Blob([text],{type:"application/json;charset=utf-8;"});const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
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
      state.data[kind]=items;save();alert("匯入完成。");
    }catch(e){alert("檔案格式不正確，請確認是本系統匯出的備份 JSON。");}
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
      settings().dailyDemand=items;save();alert("匯入完成。");
    }catch(e){alert("檔案格式不正確，請確認是本系統匯出的固定班次備份 JSON。");}
  };
  reader.readAsText(file);
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
  byId("exportWeekBtn").onclick=()=>exportSchedule("week");
  byId("exportMonthBtn").onclick=()=>exportSchedule("month");
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
  byId("menuBtn").onclick=()=>byId("sidebar").classList.toggle("open");
  byId("modalCloseBtn").onclick=closeModal;byId("modalBackdrop").onclick=e=>{if(e.target===byId("modalBackdrop"))closeModal()};
  byId("addEmployeeBtn").onclick=()=>openEmployeeModal();byId("addWorktypeBtn").onclick=()=>openWorktypeModal();
  byId("addAvailabilityWindowBtn").onclick=()=>openAvailabilityWindowModal();
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
  const shiftWeek=delta=>{const d=new Date(state.hoursWeek+"T00:00:00");d.setDate(d.getDate()+delta*7);state.hoursWeek=toDateKey(d);renderHours()};
  byId("prevWeekBtn")?.addEventListener("click",()=>shiftWeek(-1));
  byId("nextWeekBtn")?.addEventListener("click",()=>shiftWeek(1));
  byId("thisWeekBtn")?.addEventListener("click",()=>{state.hoursWeek=toDateKey(new Date());renderHours()});
  document.querySelectorAll("#availModeTabs .staff-tab").forEach(b=>b.onclick=()=>{state.availMode=b.dataset.mode;renderAvailabilityOverview()});
  document.querySelectorAll("#availPageTabs .staff-tab").forEach(b=>b.onclick=()=>{state.availPage=b.dataset.atab;syncAvailPage()});
  document.querySelectorAll("#settingsTabs .staff-tab").forEach(b=>b.onclick=()=>{state.settingsTab=b.dataset.sec;syncSettingsTab()});
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
  setupPinGate();
  if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
  Cloud.init(onCloudData,updateSyncStatus);
}
window.openEmployeeModal=openEmployeeModal;window.deleteEmployee=deleteEmployee;window.openWorktypeModal=openWorktypeModal;window.deleteWorktype=deleteWorktype;window.openShiftModal=openShiftModal;window.deleteShift=deleteShift;window.closeModal=closeModal;window.selectDate=selectDate;
document.addEventListener("DOMContentLoaded",init);

window.openAvailabilityWindowModal=openAvailabilityWindowModal;window.deleteAvailabilityWindow=deleteAvailabilityWindow;
window.availMonthNav=availMonthNav;window.availPickDate=availPickDate;window.availPickEmployee=availPickEmployee;window.openAvailEditModal=openAvailEditModal;window.availOpenDate=availOpenDate;window.availQuickSet=availQuickSet;window.availAllForDate=availAllForDate;window.availAllForEmployee=availAllForEmployee;
window.openDemandModal=openDemandModal;window.deleteDemand=deleteDemand;window.openCopyDemandModal=openCopyDemandModal;window.deleteHoliday=deleteHoliday;window.publishWeek=publishWeek;window.unpublishWeek=unpublishWeek;
window.toggleHolidayClosed=toggleHolidayClosed;window.deleteNationalHoliday=deleteNationalHoliday;

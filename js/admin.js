
const STORAGE_KEY = "smartSchedulerV01";
const COLORS = ["#b94b2f","#d9822b","#4d7c6f","#5d6e9c","#8f5fa2","#54714f","#9a6152"];
const pad = n => String(n).padStart(2,"0");
const toDateKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today = new Date();
const demoDate = new Date(2026,6,18);
const state = {
  view:"dashboard",
  calendarDate:new Date(2026,6,1),
  selectedDate:"2026-07-18",
  scheduleMode:"day",
  demandWeekday:6,
  hoursWeek:"2026-07-18",
  availPage:"settings",
  availMode:"month",
  availCalDate:new Date(2026,7,1),
  availDate:"2026-08-05",
  availEmployeeId:null,
  data:null
};

function defaultData(){
  return {
    employees:[
      {id:"e1",employeeNo:"A012",name:"青春",phone:"",employmentType:"正職",allowedWorkTypeIds:["w1","w2","w3"],primaryWeekday:["w3"],primaryWeekend:["w1"],weeklyLimit:40,dailyLimit:8,active:true,pinEnabled:false,pinHash:null},
      {id:"e2",employeeNo:"A018",name:"美蘭",phone:"",employmentType:"工讀",allowedWorkTypeIds:["w2","w3","w4"],primaryWeekday:["w2"],primaryWeekend:["w2"],weeklyLimit:20,dailyLimit:8,active:true,pinEnabled:false,pinHash:null},
      {id:"e3",employeeNo:"B005",name:"友福",phone:"",employmentType:"外籍學生",allowedWorkTypeIds:["w3","w4","w5"],primaryWeekday:[],primaryWeekend:["w5"],weeklyLimit:20,dailyLimit:8,active:true,pinEnabled:false,pinHash:null}
    ],
    workTypes:[
      {id:"w1",name:"餅皮",color:"#b94b2f",sort:1,applyBreak:false,defaultBreak:0,prepDays:[],prepMinutes:0,active:true},
      {id:"w2",name:"烤比薩",color:"#d9822b",sort:2,applyBreak:true,defaultBreak:90,prepDays:[],prepMinutes:0,active:true},
      {id:"w3",name:"備料",color:"#4d7c6f",sort:3,applyBreak:false,defaultBreak:0,prepDays:[],prepMinutes:0,active:true},
      {id:"w4",name:"收銀",color:"#5d6e9c",sort:4,applyBreak:true,defaultBreak:90,prepDays:[],prepMinutes:0,active:true},
      {id:"w5",name:"烤雞",color:"#8f5fa2",sort:5,applyBreak:true,defaultBreak:90,prepDays:[0,6],prepMinutes:30,active:true}
    ],
    availability:[
      {id:"a1",employeeId:"e1",date:"2026-07-18",unavailable:false,start:"08:00",end:"18:00"},
      {id:"a2",employeeId:"e2",date:"2026-07-18",unavailable:false,start:"16:00",end:"22:00"},
      {id:"a3",employeeId:"e3",date:"2026-07-18",unavailable:false,start:"10:00",end:"22:00"}
    ],
    shifts:[
      {id:"s1",date:"2026-07-18",employeeId:"e1",workTypeId:"w1",start:"08:30",end:"16:30",breakMinutes:0,note:"",prepRole:false,status:"draft"},
      {id:"s2",date:"2026-07-18",employeeId:"e2",workTypeId:"w2",start:"16:00",end:"22:00",breakMinutes:0,note:"",prepRole:false,status:"draft"},
      {id:"s3",date:"2026-07-18",employeeId:"e3",workTypeId:"w3",start:"09:30",end:"18:00",breakMinutes:90,note:"週六前置作業",prepRole:true,status:"draft"}
    ],
    settings:{
      storeName:"蔡叔叔比薩屋",
      businessStart:"08:30",
      businessEnd:"21:00",
      timeStep:30,
      closedDays:[1],
      breakStart:"14:30",
      breakEnd:"16:00",
      foreignDefaultLimit:20,
      defaultBreak:90,
      weekStartsOn:1,
      dailyDemand:[
        {id:"dd1",weekday:6,workTypeId:"w1",start:"08:30",end:"16:30",count:1},
        {id:"dd2",weekday:6,workTypeId:"w5",start:"09:00",end:"18:00",count:1},
        {id:"dd3",weekday:6,workTypeId:"w2",start:"11:00",end:"21:00",count:2}
      ],
      availabilityWindows:[
        {
          id:"aw1",
          name:"8月上半月可上班時間",
          openStart:"2026-07-17",
          openEnd:"2026-07-20",
          targetStart:"2026-08-01",
          targetEnd:"2026-08-15",
          enabled:true,
          note:"請於期限內完成填寫"
        }
      ]
    }
  }
}
function migrate(d){
  if(!d||!d.employees)return defaultData();
  d.employees.forEach(e=>{
    e.primaryWeekday=e.primaryWeekday||[];
    e.primaryWeekend=e.primaryWeekend||[];
    if(e.employmentType==="兼職")e.employmentType="工讀"; // 舊類型對應
  });
  (d.workTypes||[]).forEach(w=>{
    if(w.applyBreak===undefined)w.applyBreak=Number(w.defaultBreak||0)>0; // 由舊的預設休息分鐘推導
  });
  return d;
}
function load(){ try{return migrate(JSON.parse(localStorage.getItem(STORAGE_KEY)))||defaultData()}catch{return defaultData()} }
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state.data));renderAll()}
function byId(id){return document.getElementById(id)}
function employee(id){return state.data.employees.find(x=>x.id===id)}
function worktype(id){return state.data.workTypes.find(x=>x.id===id)}
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
  s.dailyDemand=s.dailyDemand||[];
  s.holidays=s.holidays||[];
  s.nationalHolidays=s.nationalHolidays||[];
  return s;
}
// 內建 2026 年臺灣國定假日（僅供標示、參考用，可自行增刪；是否公休由店家自訂）
const TW_HOLIDAYS_2026=[
  ["2026-01-01","元旦"],["2026-02-16","除夕"],["2026-02-17","春節"],["2026-02-18","春節"],["2026-02-19","春節"],
  ["2026-02-28","和平紀念日"],["2026-04-04","兒童節"],["2026-04-05","清明節"],["2026-04-06","清明節補假"],
  ["2026-05-01","勞動節"],["2026-06-19","端午節"],["2026-09-25","中秋節"],["2026-09-28","教師節"],
  ["2026-10-10","國慶日"],["2026-10-25","臺灣光復節"],["2026-12-25","行憲紀念日"]
];
function overlapMinutes(aS,aE,bS,bE){return Math.max(0,Math.min(aE,bE)-Math.max(aS,bS))}
// 自動休息：只有「工作設定為套用休息」且班次涵蓋店家休息時段時，才依重疊時間扣除。
function breakForShift(s){
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
function isWeekend(dateKey){const d=new Date(dateKey+"T00:00:00").getDay();return d===0||d===6}
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
    worktypes:["工作管理","設定工作、休息與前置作業規則"],
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
  document.title=`${full}｜主管後台`;
}
function syncAvailPage(){
  document.querySelectorAll("#availPageTabs .staff-tab").forEach(b=>b.classList.toggle("active",b.dataset.atab===state.availPage));
  byId("availSettingsPanel")?.classList.toggle("hidden",state.availPage!=="settings");
  byId("availOverviewPanel")?.classList.toggle("hidden",state.availPage!=="overview");
}
function renderAll(){applyBranding();renderDashboard();renderEmployees();renderWorktypes();renderCalendar();renderSchedule();renderAvailabilityWindows();renderHours();renderAvailabilityOverview();syncAvailPage();renderStoreSettings();renderDemand();renderHolidays();renderNationalHolidays()}
function renderDashboard(){
  const active=state.data.employees.filter(e=>e.active).length, month="2026-07";
  const shifts=state.data.shifts.filter(s=>s.date.startsWith(month));
  const hours=shifts.reduce((n,s)=>n+durationHours(s),0);
  const avail=state.data.availability.filter(a=>a.date.startsWith(month)).length;
  const fill=windowFillStatus(currentWindow());
  byId("dashboardStats").innerHTML=[
    ["在職員工",active,"可安排人力"],
    ["本月班次",shifts.length,"目前已建立"],
    ["本月計薪工時",fmtHours(hours),"依班次自動計算"],
    ["可上班時間填寫",fill?`${fill.filled.length}／${fill.total}`:avail+" 筆",fill?`${fill.unfilled.length} 人未填`:"員工提交紀錄"]
  ].map(x=>`<div class="stat-card"><span>${x[0]}</span><strong>${x[1]}</strong><small>${x[2]}</small></div>`).join("");
  byId("todayLabel").textContent=formatDate(state.selectedDate);
  const selected=state.data.shifts.filter(s=>s.date===state.selectedDate);
  byId("todayShifts").innerHTML=selected.length?selected.map(shiftListItem).join(""):`<div class="empty-state">這一天尚未排班</div>`;
  const warns=[];
  if(fill&&fill.unfilled.length)warns.push({t:`${fill.unfilled.length} 人尚未填寫可上班時間`,d:fill.unfilled.map(e=>e.name).join("、")});
  // 每日需求缺額（未來 14 天，依每日需求模板）
  const demandWarns=[];
  for(let i=0;i<14;i++){
    const d=new Date(today);d.setDate(d.getDate()+i);const key=toDateKey(d);
    if(isClosedDay(key))continue;
    demandGaps(key).forEach(r=>{if(r.gap>0){const w=worktype(r.workTypeId);demandWarns.push({t:`${formatDate(key)} 缺 ${r.gap} 位 ${w?.name||""}`,d:`需求 ${r.count} 人・${r.start}～${r.end}`})}});
  }
  demandWarns.slice(0,6).forEach(x=>warns.push(x));
  const unassigned=state.data.shifts.filter(s=>!s.employeeId&&s.date>=toDateKey(today)).length;
  if(unassigned)warns.push({t:`${unassigned} 個班次尚未指派員工`,d:"請於排班頁點該班次指派"});
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
  const e=employee(s.employeeId),w=worktype(s.workTypeId);
  return `<div class="list-item"><div class="list-icon" style="background:${w.color}22;color:${w.color}">●</div><div class="list-main"><strong>${e?e.name:"待指派"}｜${w.name}</strong><span>${s.start}～${s.end}・計薪 ${fmtHours(durationHours(s))}</span></div><span class="badge ${s.prepRole?"warn":""}">${s.prepRole?"前置":"一般"}</span></div>`
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
    return `<tr><td class="employee-name"><strong>${e.name}</strong><span>${typeBadge}</span></td><td>${e.employeeNo}</td><td>${works}${primary}</td><td>${e.weeklyLimit?e.weeklyLimit+" 小時":"未設定"}</td><td><span class="badge ${e.active?"ok":"inactive"}">${e.active?"在職":"停用"}</span></td><td><div class="row-actions"><button class="text-btn" onclick="openEmployeeModal('${e.id}')">編輯</button></div></td></tr>`
  }).join("")||`<tr><td colspan="6"><div class="empty-state">找不到員工</div></td></tr>`;
}
function renderWorktypes(){
  byId("worktypeCards").innerHTML=state.data.workTypes.sort((a,b)=>a.sort-b.sort).map(w=>{
    const dayNames=w.prepDays?.map(d=>"日一二三四五六"[d]).join("、")||"無";
    return `<article class="work-card"><div class="work-card-head"><div class="work-title"><span class="color-dot" style="background:${w.color}"></span><h3>${w.name}</h3></div><span class="badge ${w.active?"ok":"inactive"}">${w.active?"啟用":"停用"}</span></div><div class="work-meta"><span>套用休息：${w.applyBreak?"是（依店家休息時段扣除）":"否（工時全額計薪）"}</span><span>前置作業星期：${dayNames}</span><span>前置提早：${w.prepMinutes||0} 分鐘</span></div><div class="work-card-actions"><button class="secondary-btn" onclick="openWorktypeModal('${w.id}')">編輯設定</button></div></article>`
  }).join("");
}
function renderCalendar(){
  const d=state.calendarDate,y=d.getFullYear(),m=d.getMonth();
  byId("calendarMonthLabel").textContent=`${y} 年 ${m+1} 月`;
  const first=new Date(y,m,1),start=new Date(y,m,1-((first.getDay()+6)%7));
  let html="";
  for(let i=0;i<42;i++){const day=new Date(start);day.setDate(start.getDate()+i);const key=toDateKey(day);const count=state.data.shifts.filter(s=>s.date===key).length;const closed=isClosedDay(key);
    html+=`<button class="cal-day ${day.getMonth()!==m?"muted":""} ${closed?"closed":""} ${key===state.selectedDate?"selected":""} ${key===toDateKey(today)?"today":""}" ${closed?`disabled title="${closedReason(key)}"`:`onclick="selectDate('${key}')" ${nationalHolidayName(key)?`title="${nationalHolidayName(key)}"`:""}`}><span>${day.getDate()}</span>${closed?`<span class="cal-closed">休</span>`:(nationalHolidayName(key)?`<span class="cal-holiday">${nationalHolidayName(key)}</span>`:count?`<span class="cal-dot"></span>`:"")}</button>`
  }
  byId("calendarGrid").innerHTML=html;
}
/* ---------- 排班：直式時間軸（日／週） ---------- */
const SLOT_H=34;   // 每個時間間隔的像素高度
const HEAD_H=52;   // 欄位表頭高度
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
function shiftBlock(s,axis,showWork,lane=0,lanes=1){
  const w=worktype(s.workTypeId),e=employee(s.employeeId);
  const top=((mins(s.start)-axis.startM)/axis.total)*axis.height;
  const h=Math.max(20,((mins(s.end)-mins(s.start))/axis.total)*axis.height);
  const width=100/lanes,left=lane*width;
  const label=showWork&&w?`${w.name}・${s.start}`:`${s.start}–${s.end}`;
  const who=e?e.name:"待指派";
  return `<button class="dg-block ${e?"":"unassigned"}" onclick="event.stopPropagation();openShiftModal('${s.id}')" style="top:${top}px;height:${h}px;left:calc(${left}% + 2px);width:calc(${width}% - 4px);background:${w?.color||'#888'}"><strong>${who}</strong><span>${label}${s.prepRole?"・前置":""}</span></button>`;
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
      const blocks=layoutBlocks(state.data.shifts.filter(s=>s.date===key)).map(b=>shiftBlock(b.s,axis,true,b.lane,b.lanes)).join("");
      return `<div class="dg-col"><div class="dg-col-head clickable ${key===state.selectedDate?"sel":""} ${key===toDateKey(today)?"today":""}" onclick="selectDate('${key}')"><strong>${d.getMonth()+1}/${d.getDate()}</strong><span>${"日一二三四五六"[d.getDay()]}</span></div><div class="dg-track ${closed?"closed":""}" data-date="${key}" style="height:${axis.height}px;--slot:${SLOT_H}px">${blocks}</div></div>`;
    }).join("");
    grid.innerHTML=`<div class="dg">${timeGutter(axis)}${cols}</div>`;
  }else{
    const nh=nationalHolidayName(state.selectedDate);
    byId("selectedDateTitle").textContent=formatDate(state.selectedDate)+(nh?`・${nh}`:"");
    const dayShifts=state.data.shifts.filter(s=>s.date===state.selectedDate);
    byId("selectedDateSummary").textContent=`${dayShifts.length} 個班次・共 ${fmtHours(dayShifts.reduce((n,s)=>n+durationHours(s),0))}`;
    const works=state.data.workTypes.filter(w=>w.active).sort((a,b)=>a.sort-b.sort);
    const closed=isClosedDay(state.selectedDate);
    const cols=works.map(w=>{
      const shifts=dayShifts.filter(s=>s.workTypeId===w.id);
      const blocks=layoutBlocks(shifts).map(b=>shiftBlock(b.s,axis,false,b.lane,b.lanes)).join("");
      return `<div class="dg-col"><div class="dg-col-head" style="border-top-color:${w.color}"><strong>${w.name}</strong><span>${shifts.length} 人</span></div><div class="dg-track ${closed?"closed":""}" data-date="${state.selectedDate}" data-work="${w.id}" style="height:${axis.height}px;--slot:${SLOT_H}px">${blocks}</div></div>`;
    }).join("");
    grid.innerHTML=`<div class="dg">${timeGutter(axis)}${cols||`<div class="empty-state">尚未設定任何工作</div>`}</div>`;
  }
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
      const workId=track.dataset.work||state.data.workTypes.find(w=>w.active)?.id||"";
      openShiftModal(null,{date,workTypeId:workId,start});
    });
  });
}
function shiftSchedule(delta){
  const d=new Date(state.selectedDate+"T00:00:00");
  d.setDate(d.getDate()+delta*(state.scheduleMode==="week"?7:1));
  selectDate(toDateKey(d));
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
    id:uid("aw"),name:"",openStart:"",openEnd:"",targetStart:"",targetEnd:"",enabled:true,note:""
  };
  openModal(id?"編輯開放區段":"新增開放區段","設定員工可進入填寫的期間，以及實際要填寫的排班日期",`
    <div class="form-grid">
      <label class="field span-2"><span>區段名稱</span><input class="input" name="name" required value="${w.name}" placeholder="例如 8月上半月可上班時間"></label>
      <label class="field"><span>開放填寫起日</span><input class="input" type="date" name="openStart" required value="${w.openStart}"></label>
      <label class="field"><span>開放填寫迄日</span><input class="input" type="date" name="openEnd" required value="${w.openEnd}"></label>
      <label class="field"><span>可填寫排班起日</span><input class="input" type="date" name="targetStart" required value="${w.targetStart}"></label>
      <label class="field"><span>可填寫排班迄日</span><input class="input" type="date" name="targetEnd" required value="${w.targetEnd}"></label>
      <label class="field span-2"><span>員工提示文字</span><textarea name="note" rows="3" placeholder="例如：請於期限內完成填寫">${w.note||""}</textarea></label>
      <label class="check-row span-2"><input type="checkbox" name="enabled" ${w.enabled?"checked":""}> 啟用此填寫區段</label>
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
    if(openEnd<openStart){alert("開放填寫迄日不可早於起日");return}
    if(targetEnd<targetStart){alert("可填寫排班迄日不可早於起日");return}
    Object.assign(w,{
      name:fd.get("name").trim(),
      openStart,openEnd,targetStart,targetEnd,
      enabled:fd.get("enabled")==="on",
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
  const e=id?employee(id):{id:uid("e"),employeeNo:"",name:"",phone:"",employmentType:"正職",allowedWorkTypeIds:[],primaryWeekday:[],primaryWeekend:[],weeklyLimit:40,dailyLimit:8,active:true,pinEnabled:false,pinHash:null};
  e.primaryWeekday=e.primaryWeekday||[];e.primaryWeekend=e.primaryWeekend||[];
  const types=["正職","工讀","外籍學生","其他"];
  const foreignLimit=settings().foreignDefaultLimit;
  const workBoxes=(group,selected)=>state.data.workTypes.filter(w=>w.active).map(w=>`<label class="checkbox-card"><input type="checkbox" name="${group}" value="${w.id}" ${selected.includes(w.id)?"checked":""}>${w.name}</label>`).join("");
  openModal(id?"編輯員工":"新增員工","設定員工編號、可做工作、主要工作與工時限制",`
    <input type="hidden" name="id" value="${e.id}">
    <div class="form-grid">
      <label class="field"><span>姓名</span><input class="input" name="name" required value="${e.name}"></label>
      <label class="field"><span>員工編號</span><input class="input" name="employeeNo" required value="${e.employeeNo}"></label>
      <label class="field"><span>電話（選填）</span><input class="input" name="phone" value="${e.phone||""}"></label>
      <label class="field"><span>身分類型</span><select class="select" name="employmentType" id="empType">${types.map(x=>`<option ${x===e.employmentType?"selected":""}>${x}</option>`).join("")}</select></label>
      <label class="field span-2"><span>每週計薪工時上限</span><input class="input" name="weeklyLimit" id="empWeeklyLimit" type="number" min="0" step=".5" value="${e.weeklyLimit}"><small class="field-help" id="empLimitHint">外籍學生預設 ${foreignLimit} 小時／週，可自行修改。</small></label>
      <label class="field span-2"><span>可以做的工作</span><div class="checkbox-grid">${workBoxes("works",e.allowedWorkTypeIds)}</div></label>
      <label class="field span-2"><span>主要工作・平日</span><div class="checkbox-grid">${workBoxes("primaryWeekday",e.primaryWeekday)}</div><small class="field-help">AI／排班時，平日優先推薦負責這些工作的人（需同時在「可以做的工作」中）。</small></label>
      <label class="field span-2"><span>主要工作・假日（六日）</span><div class="checkbox-grid">${workBoxes("primaryWeekend",e.primaryWeekend)}</div><small class="field-help">六日優先推薦負責這些工作的人。</small></label>
      <label class="check-row span-2"><input type="checkbox" name="active" ${e.active?"checked":""}> 在職並允許員工編號登入</label>
      <div class="modal-actions span-2">${id?`<button type="button" class="danger-btn" onclick="deleteEmployee('${e.id}')">刪除</button>`:""}<button type="button" class="ghost-btn" onclick="closeModal()">取消</button><button class="primary-btn">儲存</button></div>
    </div>`);
  const form=byId("modalForm");
  form.elements.employmentType.addEventListener("change",ev=>{
    if(ev.target.value==="外籍學生"){byId("empWeeklyLimit").value=foreignLimit;}
  });
  form.onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target),no=fd.get("employeeNo").trim().toUpperCase();if(state.data.employees.some(x=>x.employeeNo.toUpperCase()===no&&x.id!==e.id)){alert("員工編號不可重複");return}
    const works=fd.getAll("works");
    // 主要工作必須落在可做工作範圍內
    const primaryWeekday=fd.getAll("primaryWeekday").filter(w=>works.includes(w));
    const primaryWeekend=fd.getAll("primaryWeekend").filter(w=>works.includes(w));
    Object.assign(e,{name:fd.get("name").trim(),employeeNo:no,phone:(fd.get("phone")||"").trim(),employmentType:fd.get("employmentType"),weeklyLimit:Number(fd.get("weeklyLimit")||0),allowedWorkTypeIds:works,primaryWeekday,primaryWeekend,active:fd.get("active")==="on"});
    if(!id)state.data.employees.push(e);save();closeModal()
  }
}
function deleteEmployee(id){if(confirm("確定刪除這位員工？相關班次不會自動刪除。")){state.data.employees=state.data.employees.filter(x=>x.id!==id);save();closeModal()}}
function openWorktypeModal(id=null){
  const cfg=settings();
  const w=id?worktype(id):{id:uid("w"),name:"",color:COLORS[state.data.workTypes.length%COLORS.length],sort:state.data.workTypes.length+1,applyBreak:true,defaultBreak:90,prepDays:[],prepMinutes:0,active:true};
  openModal(id?"編輯工作":"新增工作","設定是否套用休息與特定星期前置作業",`
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
    <label class="check-row span-2"><input type="checkbox" name="applyBreak" ${w.applyBreak?"checked":""}> 套用店家休息時段（${cfg.breakStart}～${cfg.breakEnd}），班次涵蓋時自動扣除不計薪</label>
    <label class="field span-2"><span>需要前置作業的星期</span><div class="checkbox-grid">${[0,1,2,3,4,5,6].map(d=>`<label class="checkbox-card"><input type="checkbox" name="prepDays" value="${d}" ${w.prepDays.includes(d)?"checked":""}>星期${"日一二三四五六"[d]}</label>`).join("")}</div></label>
    <label class="field span-2"><span>前置提早（分鐘）</span><input class="input" name="prepMinutes" type="number" min="0" step="30" value="${w.prepMinutes||0}"></label>
    <label class="check-row span-2"><input type="checkbox" name="active" ${w.active?"checked":""}> 啟用</label>
    <div class="modal-actions span-2">${id?`<button type="button" class="danger-btn" onclick="deleteWorktype('${w.id}')">刪除</button>`:""}<button type="button" class="ghost-btn" onclick="closeModal()">取消</button><button class="primary-btn">儲存</button></div>
  </div>`);
  const colorInput=byId("workColor");
  const markActive=val=>document.querySelectorAll("#workSwatches .swatch").forEach(s=>s.classList.toggle("active",s.dataset.color.toLowerCase()===val.toLowerCase()));
  document.querySelectorAll("#workSwatches .swatch").forEach(b=>b.onclick=()=>{colorInput.value=b.dataset.color;markActive(b.dataset.color)});
  colorInput.oninput=()=>markActive(colorInput.value);
  byId("modalForm").onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target);const applyBreak=fd.get("applyBreak")==="on";Object.assign(w,{name:fd.get("name").trim(),color:fd.get("color"),applyBreak,defaultBreak:applyBreak?(w.defaultBreak||90):0,prepMinutes:Number(fd.get("prepMinutes")||0),prepDays:fd.getAll("prepDays").map(Number),active:fd.get("active")==="on"});if(!id)state.data.workTypes.push(w);save();closeModal()}
}
function deleteWorktype(id){if(confirm("確定刪除這個工作？")){state.data.workTypes=state.data.workTypes.filter(x=>x.id!==id);save();closeModal()}}
function isPrimaryWork(e,date,workTypeId){
  const list=isWeekend(date)?(e.primaryWeekend||[]):(e.primaryWeekday||[]);
  return list.includes(workTypeId);
}
function getEmployeeEligibility(e,date,start,end,workTypeId,excludeShiftId=null){
  const reasons=[];
  const a=state.data.availability.find(x=>x.employeeId===e.id&&x.date===date);
  const canDo=e.allowedWorkTypeIds.includes(workTypeId);
  const primary=isPrimaryWork(e,date,workTypeId);
  if(!canDo) reasons.push("未設定可做此工作");
  if(!a) reasons.push("尚未填可上班時間");
  else if(a.unavailable) reasons.push("當天不可排班");
  else if(start<a.start||end>a.end) reasons.push(`可排 ${a.start}～${a.end}`);
  const overlap=state.data.shifts.some(x=>x.id!==excludeShiftId&&x.employeeId===e.id&&x.date===date&&mins(start)<mins(x.end)&&mins(end)>mins(x.start));
  if(overlap) reasons.push("已有重疊班次");
  const already=weeklyHours(e.id,date,excludeShiftId);
  const projected=already+durationHours({workTypeId,start,end});
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
  const s=id?state.data.shifts.find(x=>x.id===id):{id:uid("s"),date:(prefill&&prefill.date)||state.selectedDate,employeeId:"",workTypeId:(prefill&&prefill.workTypeId)||state.data.workTypes.find(w=>w.active)?.id||"",start:defStart,end:defEnd,breakMinutes:0,note:"",prepRole:false,status:"draft"};
  openModal(id?"編輯班次":"新增班次","先設定日期、工作與時間，最後再選擇系統整理好的員工",`
  <div class="form-grid">
    <label class="field"><span>日期</span><input class="input" type="date" name="date" value="${s.date}"></label>
    <label class="field"><span>工作</span><select class="select" name="workTypeId" id="shiftWorkSelect">${state.data.workTypes.filter(w=>w.active).map(w=>`<option value="${w.id}" ${w.id===s.workTypeId?"selected":""}>${w.name}</option>`).join("")}</select></label>
    <label class="field"><span>開始時間</span><select class="select" name="start">${timeOptions(s.start)}</select></label>
    <label class="field"><span>結束時間</span><select class="select" name="end">${timeOptions(s.end)}</select></label>
    <div class="field span-2"><span>休息與計薪</span><div class="calc-box" id="shiftCalc"></div></div>
    <label class="check-row"><input type="checkbox" name="prepRole" ${s.prepRole?"checked":""}> 此班次負責前置作業</label>
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
    const fd=new FormData(form),wt=fd.get("workTypeId"),start=fd.get("start"),end=fd.get("end"),w=worktype(wt);
    const cfg=settings();
    const brk=(mins(end)>mins(start))?breakForShift({workTypeId:wt,start,end}):0;
    const paid=durationHours({workTypeId:wt,start,end});
    const applies=w&&w.applyBreak;
    byId("shiftCalc").innerHTML=`<span>${applies?`套用休息時段 ${cfg.breakStart}～${cfg.breakEnd}`:"此工作不套用休息"}</span><strong>自動扣除 ${brk} 分鐘・計薪 ${fmtHours(paid)}</strong>`;
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
  refreshEmployeeOptions();updateWarnings();updateCalc();
  ["date","workTypeId","start","end"].forEach(name=>{
    form.elements[name].addEventListener("change",()=>{refreshEmployeeOptions();updateWarnings();updateCalc()});
  });
  form.elements.employeeId.addEventListener("change",updateWarnings);
  form.onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target);if(!fd.get("employeeId")){alert("請選擇員工");return}
    if(isClosedDay(fd.get("date"))&&!confirm("這一天是公休日，確定仍要排班？")){return}
    Object.assign(s,{date:fd.get("date"),workTypeId:fd.get("workTypeId"),employeeId:fd.get("employeeId"),start:fd.get("start"),end:fd.get("end"),breakMinutes:breakForShift({workTypeId:fd.get("workTypeId"),start:fd.get("start"),end:fd.get("end")}),prepRole:fd.get("prepRole")==="on",note:fd.get("note").trim()});
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
// 某員工在某填寫區段是否已填（在目標日期範圍內有任一筆可上班時間紀錄即視為已填）
function hasFilled(employeeId,w){
  if(!w)return false;
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
  const fill=windowFillStatus(w);
  const summary=byId("availOverviewSummary");
  if(summary){
    summary.innerHTML=w?`
      <div class="info-banner"><div class="list-icon">填</div><div>
        <strong>${w.name}｜可填寫 ${formatDate(w.targetStart)} ～ ${formatDate(w.targetEnd)}</strong>
        <span>已填 ${fill.filled.length} 人・未填 ${fill.unfilled.length} 人（共 ${fill.total} 位在職員工）</span>
        ${fill.unfilled.length?`<span>未填：${fill.unfilled.map(e=>e.name).join("、")}</span>`:""}
      </div></div>`:`<div class="empty-state">尚未建立開放填寫區段，請先到「開放設定」分頁新增。</div>`;
  }
  if(!w){root.innerHTML="";return}
  if(state.availMode==="month")root.innerHTML=availMonthView(w);
  else if(state.availMode==="date")root.innerHTML=availDateView(w);
  else root.innerHTML=availEmployeeView(w);
}
function availAt(employeeId,dateKey){return state.data.availability.find(a=>a.employeeId===employeeId&&a.date===dateKey)}
function availMonthView(w){
  const d=state.availCalDate,y=d.getFullYear(),m=d.getMonth();
  const first=new Date(y,m,1),start=new Date(y,m,1-((first.getDay()+6)%7));
  const actives=state.data.employees.filter(e=>e.active);
  let cells="";
  for(let i=0;i<42;i++){
    const day=new Date(start);day.setDate(start.getDate()+i);const key=toDateKey(day);
    const inTarget=key>=w.targetStart&&key<=w.targetEnd;
    const closed=isClosedDay(key);
    const recs=actives.map(e=>availAt(e.id,key)).filter(Boolean);
    const yes=recs.filter(a=>!a.unavailable).length;
    const badge=inTarget?(closed?`<div class="ov-closed">公休</div>`:`<div class="ov-count">${yes} 可排</div>`):"";
    cells+=`<div class="ov-cell ${day.getMonth()!==m?"muted":""} ${inTarget&&!closed?"":"disabled"}"><div class="ov-day">${day.getDate()}</div>${badge}</div>`;
  }
  return `<div class="ov-cal-head"><button class="icon-btn" onclick="availMonthNav(-1)">‹</button><strong>${y} 年 ${m+1} 月</strong><button class="icon-btn" onclick="availMonthNav(1)">›</button></div>
    <div class="weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
    <div class="ov-grid">${cells}</div>`;
}
function availMonthNav(delta){state.availCalDate.setMonth(state.availCalDate.getMonth()+delta);renderAvailabilityOverview()}
function availDateView(w){
  const days=datesInRange(w.targetStart,w.targetEnd);
  if(!days.includes(state.availDate))state.availDate=days[0];
  const options=days.map(d=>`<option value="${d}" ${d===state.availDate?"selected":""}>${formatDate(d)}</option>`).join("");
  const actives=state.data.employees.filter(e=>e.active);
  const rows=actives.map(e=>{
    const a=availAt(e.id,state.availDate);
    let status;
    if(!a)status=`<span class="badge inactive">未填</span>`;
    else if(a.unavailable)status=`<span class="badge warn">不可排</span>`;
    else status=`<span class="badge ok">${a.start}～${a.end}</span>`;
    return `<div class="list-item"><div class="list-icon">${e.name.slice(0,1)}</div><div class="list-main"><strong>${e.name}</strong><span>${e.employmentType}</span></div>${status}</div>`;
  }).join("");
  return `<div class="ov-toolbar"><span>選擇日期</span><select class="select" onchange="availPickDate(this.value)" style="max-width:220px">${options}</select></div><div class="stack-list panel">${rows}</div>`;
}
function availPickDate(v){state.availDate=v;renderAvailabilityOverview()}
function availEmployeeView(w){
  const actives=state.data.employees.filter(e=>e.active);
  if(!state.availEmployeeId||!actives.some(e=>e.id===state.availEmployeeId))state.availEmployeeId=actives[0]?.id||null;
  const options=actives.map(e=>`<option value="${e.id}" ${e.id===state.availEmployeeId?"selected":""}>${e.name}（${e.employeeNo}）</option>`).join("");
  const days=datesInRange(w.targetStart,w.targetEnd);
  const rows=days.map(d=>{
    const a=availAt(state.availEmployeeId,d);
    let status;
    if(!a)status=`<span class="badge inactive">未填</span>`;
    else if(a.unavailable)status=`<span class="badge warn">不可排</span>`;
    else status=`<span class="badge ok">${a.start}～${a.end}</span>`;
    return `<div class="list-item"><div class="list-main"><strong>${formatDate(d)}</strong></div>${status}</div>`;
  }).join("");
  const emp=employee(state.availEmployeeId);
  const filled=emp?hasFilled(emp.id,w):false;
  return `<div class="ov-toolbar"><span>選擇員工</span><select class="select" onchange="availPickEmployee(this.value)" style="max-width:260px">${options}</select>${emp?`<span class="badge ${filled?"ok":"inactive"}">${filled?"已填寫":"尚未填寫"}</span>`:""}</div><div class="stack-list panel">${rows}</div>`;
}
function availPickEmployee(v){state.availEmployeeId=v;renderAvailabilityOverview()}

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
  }).join(""):`<div class="empty-state">尚未匯入國定假日，可按上方「匯入 2026 國定假日」。</div>`;
}
function importTaiwanHolidays(){
  const list=nationalHolidays();let added=0;
  TW_HOLIDAYS_2026.forEach(([date,name])=>{if(!list.some(h=>h.date===date)){list.push({date,name});added++}});
  save();
  alert(`已匯入 ${added} 個 2026 年臺灣國定假日，僅作標示。是否公休請在各假日按「設為公休」自行決定。`);
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
  const list=demandForWeekday(state.demandWeekday);
  byId("demandList").innerHTML=list.length?list.map(r=>{
    const w=worktype(r.workTypeId);
    return `<div class="demand-row"><div class="list-icon" style="background:${w?.color||'#999'}22;color:${w?.color||'#999'}">●</div><div class="list-main"><strong>${w?.name||"未命名工作"}｜${r.count} 人</strong><span>${r.start}～${r.end}</span></div><button class="text-btn" onclick="openDemandModal('${r.id}')">編輯</button></div>`;
  }).join(""):`<div class="empty-state">星期${"日一二三四五六"[state.demandWeekday]}尚未設定需求</div>`;
}
function openDemandModal(id=null){
  const list=getDemand();
  const r=id?list.find(x=>x.id===id):{id:uid("dd"),weekday:state.demandWeekday,workTypeId:state.data.workTypes.find(w=>w.active)?.id||"",start:settings().businessStart,end:settings().businessEnd,count:1};
  openModal(id?"編輯每日需求":"新增每日需求",`星期${"日一二三四五六"[r.weekday]}的人力需求`,`
    <div class="form-grid">
      <label class="field"><span>工作</span><select class="select" name="workTypeId">${state.data.workTypes.filter(w=>w.active).map(w=>`<option value="${w.id}" ${w.id===r.workTypeId?"selected":""}>${w.name}</option>`).join("")}</select></label>
      <label class="field"><span>需要人數</span><input class="input" type="number" name="count" min="1" step="1" value="${r.count}"></label>
      <label class="field"><span>開始時間</span><select class="select" name="start">${timeOptions(r.start)}</select></label>
      <label class="field"><span>結束時間</span><select class="select" name="end">${timeOptions(r.end)}</select></label>
      <div class="modal-actions span-2">${id?`<button type="button" class="danger-btn" onclick="deleteDemand('${r.id}')">刪除</button>`:""}<button type="button" class="ghost-btn" onclick="closeModal()">取消</button><button class="primary-btn">儲存</button></div>
    </div>`);
  byId("modalForm").onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target);const start=fd.get("start"),end=fd.get("end");
    if(mins(end)<=mins(start)){alert("結束時間必須晚於開始時間");return}
    Object.assign(r,{workTypeId:fd.get("workTypeId"),start,end,count:Math.max(1,Number(fd.get("count")||1))});
    if(!id)list.push(r);save();closeModal()};
}
function deleteDemand(id){if(confirm("確定刪除這筆需求？")){settings().dailyDemand=getDemand().filter(x=>x.id!==id);save();closeModal()}}
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
function applyDemand(dateKey){
  const gaps=demandGaps(dateKey);
  if(!gaps.length){alert(`星期${"日一二三四五六"[new Date(dateKey+"T00:00:00").getDay()]}尚未設定每日需求，請先到「設定與維護 → 每日需求模板」建立。`);return}
  let created=0,unfilled=0;
  gaps.forEach(r=>{
    for(let i=0;i<r.gap;i++){
      const pick=bestEmployeeFor(dateKey,r.start,r.end,r.workTypeId);
      const s={id:uid("s"),date:dateKey,workTypeId:r.workTypeId,employeeId:pick,start:r.start,end:r.end,breakMinutes:breakForShift({workTypeId:r.workTypeId,start:r.start,end:r.end}),note:"",prepRole:false,status:"draft"};
      state.data.shifts.push(s);created++;if(!pick)unfilled++;
    }
  });
  if(!created){alert("這一天的需求都已排滿，未新增班次。");return}
  save();
  alert(`已依需求建立 ${created} 個班次${unfilled?`，其中 ${unfilled} 個找不到合適員工、需手動指派`:"，皆已自動指派最適人選"}。`);
}

function init(){
  state.data=load();
  document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>setView(b.dataset.view));
  document.querySelectorAll("[data-view-target]").forEach(b=>b.onclick=()=>setView(b.dataset.viewTarget));
  document.querySelectorAll("[data-quick='add-shift']").forEach(b=>b.onclick=()=>openShiftModal());
  byId("schedAddBtn").onclick=()=>openShiftModal();
  byId("applyDemandBtn").onclick=()=>applyDemand(state.selectedDate);
  byId("addDemandBtn").onclick=()=>openDemandModal();
  byId("addHolidayBtn").onclick=addHoliday;
  byId("importHolidaysBtn").onclick=importTaiwanHolidays;
  byId("schedPrev").onclick=()=>shiftSchedule(-1);
  byId("schedNext").onclick=()=>shiftSchedule(1);
  document.querySelectorAll("#schedModeTabs .seg-btn").forEach(b=>b.onclick=()=>{state.scheduleMode=b.dataset.smode;renderSchedule()});
  byId("menuBtn").onclick=()=>byId("sidebar").classList.toggle("open");
  byId("modalCloseBtn").onclick=closeModal;byId("modalBackdrop").onclick=e=>{if(e.target===byId("modalBackdrop"))closeModal()};
  byId("addEmployeeBtn").onclick=()=>openEmployeeModal();byId("addWorktypeBtn").onclick=()=>openWorktypeModal();
  byId("addAvailabilityWindowBtn").onclick=()=>openAvailabilityWindowModal();
  byId("employeeSearch").oninput=renderEmployees;byId("employeeStatusFilter").onchange=renderEmployees;
  byId("prevMonthBtn").onclick=()=>{state.calendarDate.setMonth(state.calendarDate.getMonth()-1);renderCalendar()};
  byId("nextMonthBtn").onclick=()=>{state.calendarDate.setMonth(state.calendarDate.getMonth()+1);renderCalendar()};
  const shiftWeek=delta=>{const d=new Date(state.hoursWeek+"T00:00:00");d.setDate(d.getDate()+delta*7);state.hoursWeek=toDateKey(d);renderHours()};
  byId("prevWeekBtn")?.addEventListener("click",()=>shiftWeek(-1));
  byId("nextWeekBtn")?.addEventListener("click",()=>shiftWeek(1));
  byId("thisWeekBtn")?.addEventListener("click",()=>{state.hoursWeek=toDateKey(new Date());renderHours()});
  document.querySelectorAll("#availModeTabs .staff-tab").forEach(b=>b.onclick=()=>{state.availMode=b.dataset.mode;renderAvailabilityOverview()});
  document.querySelectorAll("#availPageTabs .staff-tab").forEach(b=>b.onclick=()=>{state.availPage=b.dataset.atab;syncAvailPage()});
  byId("resetDemoBtn").onclick=()=>{if(confirm("確定重置為示範資料？")){state.data=defaultData();save()}};
  if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
  renderAll()
}
window.openEmployeeModal=openEmployeeModal;window.deleteEmployee=deleteEmployee;window.openWorktypeModal=openWorktypeModal;window.deleteWorktype=deleteWorktype;window.openShiftModal=openShiftModal;window.deleteShift=deleteShift;window.closeModal=closeModal;window.selectDate=selectDate;
document.addEventListener("DOMContentLoaded",init);

window.openAvailabilityWindowModal=openAvailabilityWindowModal;window.deleteAvailabilityWindow=deleteAvailabilityWindow;
window.availMonthNav=availMonthNav;window.availPickDate=availPickDate;window.availPickEmployee=availPickEmployee;
window.openDemandModal=openDemandModal;window.deleteDemand=deleteDemand;window.deleteHoliday=deleteHoliday;
window.toggleHolidayClosed=toggleHolidayClosed;window.deleteNationalHoliday=deleteNationalHoliday;


const STORAGE_KEY="smartSchedulerV01";
const pad=n=>String(n).padStart(2,"0");
const mins=t=>{const [h,m]=t.split(":").map(Number);return h*60+m};
const fmtHours=n=>Number.isInteger(n)?`${n} 小時`:`${n.toFixed(1)} 小時`;
const formatDate=key=>{const d=new Date(key+"T00:00:00");return `${d.getMonth()+1}/${d.getDate()}（${"日一二三四五六"[d.getDay()]}）`};
const toDateKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const byId=id=>document.getElementById(id);
const uid=p=>p+Math.random().toString(36).slice(2,9);
let data=null, staffEmployeeId=sessionStorage.getItem("smartSchedulerStaffId");
let activeWindow=null;
let calendarDate=new Date();
let selectedAvailabilityDate=null;
let availEditable=true;

function load(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY))}catch{return null}}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(data));renderStaff()}
function persist(){localStorage.setItem(STORAGE_KEY,JSON.stringify(data))}
function storeCfg(){return data?.settings||{}}
function bizStart(){return storeCfg().businessStart||"08:30"}
function bizEnd(){return storeCfg().businessEnd||"21:00"}
function bizStep(){return Number(storeCfg().timeStep)||30}
function timeOptions(selected=""){
  const s=mins(bizStart()),e=mins(bizEnd()),step=bizStep();
  let out="";
  if(selected&&(mins(selected)<s||mins(selected)>e))out+=`<option selected>${selected}</option>`;
  for(let m=s;m<=e;m+=step){const h=Math.floor(m/60)%24,t=`${pad(h)}:${pad(m%60)}`;out+=`<option ${t===selected?"selected":""}>${t}</option>`}
  return out
}
// 依「員工班別免扣休息」＞「工作是否套用休息」與店家休息時段，計算此班的休息（不計薪）
function shiftBreakMin(s){
  if(employee(s.employeeId)?.noBreak)return 0;
  const w=worktype(s.workTypeId);if(!w||!w.applyBreak)return 0;
  const bs=storeCfg().breakStart,be=storeCfg().breakEnd;if(!bs||!be)return 0;
  return Math.max(0,Math.min(mins(s.end),mins(be))-Math.max(mins(s.start),mins(bs)));
}
function shiftBreakLabel(s){
  if(employee(s.employeeId)?.noBreak)return "";
  const w=worktype(s.workTypeId);if(!w||!w.applyBreak)return "";
  const bs=storeCfg().breakStart,be=storeCfg().breakEnd;if(!bs||!be)return "";
  const st=Math.max(mins(s.start),mins(bs)),en=Math.min(mins(s.end),mins(be));
  if(en<=st)return "";
  return `${pad(Math.floor(st/60))}:${pad(st%60)}～${pad(Math.floor(en/60))}:${pad(en%60)}`;
}
function durationHours(s){return Math.max(0,(mins(s.end)-mins(s.start)-shiftBreakMin(s))/60)}
function employee(id){return data.employees.find(x=>x.id===id)}
function worktype(id){return data.workTypes.find(x=>x.id===id)}
function applyStaffBranding(){
  const name=(storeCfg().storeName||"").trim();
  const full=name?`${name} 員工班表系統`:"員工班表系統";
  const bn=byId("staffBrandName");if(bn)bn.textContent=full;
  const bm=byId("staffBrandMark");if(bm&&name)bm.textContent=name.slice(0,1);
  document.title=full;
}
function getWindows(){return data?.settings?.availabilityWindows||[]}
function getActiveWindow(){
  const today=toDateKey(new Date());
  return getWindows()
    .filter(w=>w.enabled&&today>=w.openStart&&today<=w.openEnd)
    .sort((a,b)=>a.openEnd.localeCompare(b.openEnd))[0]||null
}
function getNextWindow(){
  const today=toDateKey(new Date());
  return getWindows().filter(w=>w.enabled&&w.openStart>today).sort((a,b)=>a.openStart.localeCompare(b.openStart))[0]||null
}
function inTargetRange(date){return activeWindow&&date>=activeWindow.targetStart&&date<=activeWindow.targetEnd}
function closedDays(){return data?.settings?.closedDays||[]}
function holidayList(){return data?.settings?.holidays||[]}
function nhName(key){return (data?.settings?.nationalHolidays||[]).find(h=>h.date===key)?.name||""}
function isClosedDay(key){
  if(holidayList().some(h=>h.date===key))return true; // 特定休息日（國定假日／臨時公休）
  return closedDays().includes(new Date(key+"T00:00:00").getDay());
}
function canFill(key){return inTargetRange(key)&&!isClosedDay(key)}
function login(){
  const no=byId("staffNoInput").value.trim().toUpperCase();
  const e=data?.employees?.find(x=>x.active&&x.employeeNo.toUpperCase()===no);
  if(!e){byId("staffLoginError").textContent="找不到此員工編號，請確認後再試。";return}
  staffEmployeeId=e.id;sessionStorage.setItem("smartSchedulerStaffId",e.id);byId("staffLoginError").textContent="";renderStaff()
}
function logout(){
  staffEmployeeId=null;sessionStorage.removeItem("smartSchedulerStaffId");
  byId("staffPortal").classList.add("hidden");byId("staffLoginCard").classList.remove("hidden");byId("staffNoInput").value=""
}
function renderStaff(){
  if(!staffEmployeeId)return;
  const e=employee(staffEmployeeId);
  if(!e){logout();return}
  byId("staffLoginCard").classList.add("hidden");
  byId("staffPortal").classList.remove("hidden");
  applyStaffBranding();
  byId("staffWelcome").textContent=`${e.name}，你好`;

  const today=toDateKey(new Date());
  // 顯示前後約三個月的班表
  const lo=new Date();lo.setMonth(lo.getMonth()-3);const loKey=toDateKey(lo);
  const hi=new Date();hi.setMonth(hi.getMonth()+3);const hiKey=toDateKey(hi);
  const mine=data.shifts.filter(s=>s.employeeId===e.id&&s.date>=loKey&&s.date<=hiKey);
  const upcoming=mine.filter(s=>s.date>=today).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));
  const ended=mine.filter(s=>s.date<today).sort((a,b)=>(b.date+b.start).localeCompare(a.date+a.start));
  const next=upcoming[0];

  byId("nextShiftCard").innerHTML=next?`
    <div>
      <span class="eyebrow">下一班</span>
      <h2>${formatDate(next.date)}　${next.start}～${next.end}</h2>
      <p>${worktype(next.workTypeId)?.name||"未命名工作"}${next.note?`・${next.note}`:""}</p>
    </div>
    <div class="next-shift-time">${next.start}</div>
  `:`<div><span class="eyebrow">下一班</span><h2>目前尚未排班</h2><p>完成排班後會顯示在這裡。</p></div>`;

  const shiftItem=s=>{const w=worktype(s.workTypeId),c=w?.color||"#999",br=shiftBreakLabel(s);const subs=(s.subWorkTypeIds||[]).map(id=>worktype(id)?.name).filter(Boolean),subTxt=subs.length?`＋${subs.join("＋")}`:"";return `<div class="list-item"><div class="list-icon" style="background:${c}22;color:${c}">●</div><div class="list-main"><strong>${formatDate(s.date)}｜${w?.name||"未命名工作"}${subTxt}</strong><span>${s.start}～${s.end}・計薪 ${fmtHours(durationHours(s))}</span>${br?`<span class="shift-break">休息 ${br}（不計薪）</span>`:""}${s.note?`<span class="shift-note">備註：${s.note}</span>`:""}</div></div>`};
  const group=(title,arr,empty)=>`<div class="shift-group"><div class="shift-group-head">${title}<span>${arr.length}</span></div>${arr.length?arr.map(shiftItem).join(""):`<div class="empty-state">${empty}</div>`}</div>`;
  byId("staffShiftList").innerHTML=group("即將到來",upcoming,"目前沒有即將到來的班表")+group("已結束",ended,"近三個月沒有已結束的班表");

  activeWindow=getActiveWindow();
  const nextWindow=getNextWindow();
  const banner=byId("availabilityWindowBanner");
  const closed=byId("availabilityClosedMessage");
  const quickBlock=byId("quickWeekBlock");
  const editor=byId("selectedDayEditor");

  if(activeWindow){
    availEditable=true;
    banner.className="availability-window-banner open";
    banner.innerHTML=`<strong>${activeWindow.name}已開放填寫可上班時間囉</strong><span>開放填寫：${formatDate(activeWindow.openStart)}～${formatDate(activeWindow.openEnd)}</span><span>可填日期：${formatDate(activeWindow.targetStart)}～${formatDate(activeWindow.targetEnd)}</span>${activeWindow.note?`<small>${activeWindow.note}</small>`:""}`;
    closed.classList.add("hidden");
    quickBlock.classList.remove("hidden");editor.classList.remove("hidden");
    if(!selectedAvailabilityDate||!canFill(selectedAvailabilityDate)){
      // 預設選第一個非公休的可填日期
      let pick=activeWindow.targetStart;
      const end=new Date(activeWindow.targetEnd+"T00:00:00");
      for(let d=new Date(activeWindow.targetStart+"T00:00:00");d<=end;d.setDate(d.getDate()+1)){
        if(!isClosedDay(toDateKey(d))){pick=toDateKey(d);break}
      }
      selectedAvailabilityDate=pick;
      const d=new Date(selectedAvailabilityDate+"T00:00:00");
      calendarDate=new Date(d.getFullYear(),d.getMonth(),1);
    }
    renderAvailabilityCalendar();
    loadSelectedDay();
  }else{
    // 非開放期間：仍顯示月曆，供檢視近期填寫紀錄（唯讀）
    availEditable=false;
    banner.className="availability-window-banner closed";
    banner.innerHTML=nextWindow?`<strong>目前尚未開放填寫</strong><span>下一次開放：${formatDate(nextWindow.openStart)}～${formatDate(nextWindow.openEnd)}，填寫 ${formatDate(nextWindow.targetStart)}～${formatDate(nextWindow.targetEnd)} 的可上班時間。</span>`:`<strong>目前尚未開放填寫</strong><span>請等待主管公告下一次填寫期間。</span>`;
    closed.classList.remove("hidden");
    closed.innerHTML="目前非開放填寫期間，以下為你近三個月填寫的紀錄（僅供檢視，無法修改）。";
    quickBlock.classList.add("hidden");editor.classList.add("hidden");
    renderAvailabilityCalendar();
  }
}
function renderAvailabilityCalendar(){
  const editable=availEditable;
  const y=calendarDate.getFullYear(),m=calendarDate.getMonth();
  byId("staffCalendarMonthLabel").textContent=`${y} 年 ${m+1} 月`;
  const first=new Date(y,m,1),start=new Date(y,m,1-((first.getDay()+6)%7));
  let html="";
  for(let i=0;i<42;i++){
    const day=new Date(start);day.setDate(start.getDate()+i);
    const key=toDateKey(day),inMonth=day.getMonth()===m,closed=isClosedDay(key);
    const inRange=editable&&inTargetRange(key),allowed=editable&&inRange&&!closed;
    const record=data.availability.find(a=>a.employeeId===staffEmployeeId&&a.date===key);
    let cls="pending",summary="";
    if(closed&&(inRange||!editable)){cls="closed";summary="公休"}
    else if(record?.unavailable){cls="unavailable";summary="不可排"}
    else if(record){cls="available";summary=`${record.start}～${record.end}`}
    else if(inRange){summary="未填"}
    const showSummary=editable?inRange:(!!record||closed);
    const dim=editable&&!allowed;
    const clickAttr=allowed?`onclick="selectAvailabilityDate('${key}')"`:(editable?"disabled":"");
    const nh=closed?"":nhName(key);
    html+=`<button class="employee-cal-day ${!inMonth?"muted":""} ${dim?"disabled":""} ${(editable&&key===selectedAvailabilityDate)?"selected":""} ${cls}" ${clickAttr}>
      <span class="day-number">${day.getDate()}</span>
      ${nh?`<small class="emp-holiday">${nh}</small>`:""}
      ${showSummary?`<small>${summary}</small>`:""}
    </button>`
  }
  byId("staffAvailabilityCalendar").innerHTML=html;
}
function selectAvailabilityDate(key){
  if(!canFill(key))return;
  selectedAvailabilityDate=key;renderAvailabilityCalendar();loadSelectedDay()
}
function loadSelectedDay(){
  if(!selectedAvailabilityDate)return;
  byId("availabilitySelectedDateTitle").textContent=formatDate(selectedAvailabilityDate);
  const a=data.availability.find(x=>x.employeeId===staffEmployeeId&&x.date===selectedAvailabilityDate);
  const unavailable=!!a?.unavailable;
  byId("availabilityUnavailable").checked=unavailable;
  byId("availabilityStart").innerHTML=timeOptions(a?.start||bizStart());
  byId("availabilityEnd").innerHTML=timeOptions(a?.end||bizEnd());
  byId("availabilityStart").disabled=unavailable;
  byId("availabilityEnd").disabled=unavailable;
  const badge=byId("availabilityDayStatus");
  if(a?.unavailable){badge.textContent="不可排班";badge.className="badge warn"}
  else if(a){badge.textContent="已填寫";badge.className="badge ok"}
  else{badge.textContent="尚未填寫";badge.className="badge"}
}
function flashSaved(msg){byId("availabilitySaved").textContent=msg;setTimeout(()=>byId("availabilitySaved").textContent="",1600)}
function showToast(msg){
  let t=byId("staffToast");
  if(!t){t=document.createElement("div");t.id="staffToast";t.className="toast";document.body.appendChild(t)}
  t.textContent=msg;t.classList.add("show");
  clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove("show"),1900);
}
function upsertAvailability(key,fields){
  let a=data.availability.find(x=>x.employeeId===staffEmployeeId&&x.date===key);
  if(!a){a={id:uid("a"),employeeId:staffEmployeeId,date:key};data.availability.push(a)}
  Object.assign(a,fields);
}
// 單日快速：整天可上班（帶入店家最早上班~最晚下班）或整天不行
function quickDaySet(type){
  if(!selectedAvailabilityDate||!canFill(selectedAvailabilityDate))return;
  upsertAvailability(selectedAvailabilityDate,type==="yes"?{unavailable:false,start:bizStart(),end:bizEnd()}:{unavailable:true,start:bizStart(),end:bizEnd()});
  persist();renderAvailabilityCalendar();loadSelectedDay();flashSaved("已儲存");
}
function renderQuickWeekDays(){
  const el=byId("quickWeekDays");if(!el)return;
  el.innerHTML=[1,2,3,4,5,6,0].map(d=>`<button type="button" class="qw-day" data-d="${d}">${"日一二三四五六"[d]}</button>`).join("");
  el.querySelectorAll(".qw-day").forEach(b=>b.onclick=()=>b.classList.toggle("on"));
}
// 整週快速套用：把選定星期在本次可填範圍內的每一天設為可上班或不可上班
function quickWeekApply(type){
  if(!activeWindow)return;
  const days=[...document.querySelectorAll("#quickWeekDays .qw-day.on")].map(b=>Number(b.dataset.d));
  if(!days.length){alert("請先勾選要套用的星期");return}
  const start=byId("quickWeekStart").value,end=byId("quickWeekEnd").value;
  if(type==="available"&&mins(end)<=mins(start)){alert("最晚可下班必須晚於最早可上班");return}
  const endD=new Date(activeWindow.targetEnd+"T00:00:00");let count=0;
  for(let d=new Date(activeWindow.targetStart+"T00:00:00");d<=endD;d.setDate(d.getDate()+1)){
    const key=toDateKey(d);
    if(!canFill(key)||!days.includes(d.getDay()))continue;
    upsertAvailability(key,type==="available"?{unavailable:false,start,end}:{unavailable:true,start,end});
    count++;
  }
  persist();renderAvailabilityCalendar();loadSelectedDay();
  // 恢復每週預設：清除星期選取
  document.querySelectorAll("#quickWeekDays .qw-day.on").forEach(b=>b.classList.remove("on"));
  showToast(`已設定 ${count} 天${type==="available"?"可上班":"不可上班"}`);
}
function saveSelectedDay(){
  if(!activeWindow||!selectedAvailabilityDate||!canFill(selectedAvailabilityDate))return;
  const unavailable=byId("availabilityUnavailable").checked,start=byId("availabilityStart").value,end=byId("availabilityEnd").value;
  if(!unavailable&&mins(end)<=mins(start)){alert("結束時間必須晚於開始時間");return}
  let a=data.availability.find(x=>x.employeeId===staffEmployeeId&&x.date===selectedAvailabilityDate);
  if(!a){a={id:uid("a"),employeeId:staffEmployeeId,date:selectedAvailabilityDate};data.availability.push(a)}
  Object.assign(a,{unavailable,start,end});
  localStorage.setItem(STORAGE_KEY,JSON.stringify(data));
  byId("availabilitySaved").textContent="已儲存";
  setTimeout(()=>byId("availabilitySaved").textContent="",1600);
  renderAvailabilityCalendar();loadSelectedDay()
}
document.addEventListener("DOMContentLoaded",()=>{
  data=load();
  applyStaffBranding();
  if(!data){byId("staffLoginError").textContent="目前尚未建立示範資料，請先開啟主管後台 admin26.html。"}
  byId("staffLoginBtn").onclick=login;
  byId("staffNoInput").addEventListener("keydown",e=>{if(e.key==="Enter")login()});
  byId("staffLogoutBtn").onclick=logout;
  document.querySelectorAll(".staff-tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".staff-tab,.staff-tab-panel").forEach(x=>x.classList.remove("active"));b.classList.add("active");byId(b.dataset.staffTab+"Panel").classList.add("active")});
  byId("availabilityStart").innerHTML=timeOptions("16:00");
  byId("availabilityEnd").innerHTML=timeOptions("22:00");
  byId("availabilityUnavailable").onchange=e=>{byId("availabilityStart").disabled=e.target.checked;byId("availabilityEnd").disabled=e.target.checked};
  byId("saveAvailabilityBtn").onclick=saveSelectedDay;
  byId("staffPrevMonthBtn").onclick=()=>{calendarDate.setMonth(calendarDate.getMonth()-1);renderAvailabilityCalendar()};
  byId("staffNextMonthBtn").onclick=()=>{calendarDate.setMonth(calendarDate.getMonth()+1);renderAvailabilityCalendar()};
  renderQuickWeekDays();
  byId("quickWeekStart").innerHTML=timeOptions(bizStart());
  byId("quickWeekEnd").innerHTML=timeOptions(bizEnd());
  byId("quickDayYes").onclick=()=>quickDaySet("yes");
  byId("quickDayNo").onclick=()=>quickDaySet("no");
  byId("quickWeekAvailable").onclick=()=>quickWeekApply("available");
  byId("quickWeekUnavailable").onclick=()=>quickWeekApply("unavailable");
  if(staffEmployeeId)renderStaff();
});
window.selectAvailabilityDate=selectAvailabilityDate;

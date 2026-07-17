
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

function load(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY))}catch{return null}}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(data));renderStaff()}
function timeOptions(selected=""){
  let out="";for(let m=7*60;m<=24*60;m+=30){const h=Math.floor(m/60)%24,t=`${pad(h)}:${pad(m%60)}`;out+=`<option ${t===selected?"selected":""}>${t}</option>`}return out
}
function durationHours(s){return Math.max(0,(mins(s.end)-mins(s.start)-Number(s.breakMinutes||0))/60)}
function employee(id){return data.employees.find(x=>x.id===id)}
function worktype(id){return data.workTypes.find(x=>x.id===id)}
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
function isClosedDay(key){return closedDays().includes(new Date(key+"T00:00:00").getDay())}
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
  byId("staffWelcome").textContent=`${e.name}，你好`;

  const today=toDateKey(new Date());
  const shifts=data.shifts.filter(s=>s.employeeId===e.id).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));
  const futureShifts=shifts.filter(s=>s.date>=today);
  const next=futureShifts[0]||shifts[0];

  byId("nextShiftCard").innerHTML=next?`
    <div>
      <span class="eyebrow">下一班</span>
      <h2>${formatDate(next.date)}　${next.start}～${next.end}</h2>
      <p>${worktype(next.workTypeId)?.name||"未命名工作"}${next.note?`・${next.note}`:""}</p>
    </div>
    <div class="next-shift-time">${next.start}</div>
  `:`<div><span class="eyebrow">下一班</span><h2>目前尚未排班</h2><p>完成排班後會顯示在這裡。</p></div>`;

  byId("staffShiftList").innerHTML=shifts.length?shifts.map(s=>`<div class="list-item"><div class="list-icon" style="background:${worktype(s.workTypeId)?.color||"#999"}22;color:${worktype(s.workTypeId)?.color||"#999"}">●</div><div class="list-main"><strong>${formatDate(s.date)}｜${worktype(s.workTypeId)?.name||"未命名工作"}</strong><span>${s.start}～${s.end}</span></div></div>`).join(""):`<div class="empty-state">目前沒有班表</div>`;

  activeWindow=getActiveWindow();
  const nextWindow=getNextWindow();
  const banner=byId("availabilityWindowBanner");
  const closed=byId("availabilityClosedMessage");
  const area=byId("availabilityCalendarArea");

  if(activeWindow){
    banner.className="availability-window-banner open";
    banner.innerHTML=`<strong>${activeWindow.name}</strong><span>開放填寫：${formatDate(activeWindow.openStart)}～${formatDate(activeWindow.openEnd)}｜可填日期：${formatDate(activeWindow.targetStart)}～${formatDate(activeWindow.targetEnd)}</span>${activeWindow.note?`<small>${activeWindow.note}</small>`:""}`;
    closed.classList.add("hidden");area.classList.remove("hidden");
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
    banner.className="availability-window-banner closed";
    banner.innerHTML=nextWindow?`<strong>目前尚未開放填寫</strong><span>下一次開放：${formatDate(nextWindow.openStart)}～${formatDate(nextWindow.openEnd)}，填寫 ${formatDate(nextWindow.targetStart)}～${formatDate(nextWindow.targetEnd)} 的可排時間。</span>`:`<strong>目前尚未開放填寫</strong><span>請等待主管公告下一次填寫期間。</span>`;
    closed.classList.remove("hidden");area.classList.add("hidden");
    closed.innerHTML="目前不在可排時間填寫期間內，因此暫時無法新增或修改。";
  }
}
function renderAvailabilityCalendar(){
  if(!activeWindow)return;
  const y=calendarDate.getFullYear(),m=calendarDate.getMonth();
  byId("staffCalendarMonthLabel").textContent=`${y} 年 ${m+1} 月`;
  const first=new Date(y,m,1),start=new Date(y,m,1-first.getDay());
  let html="";
  for(let i=0;i<42;i++){
    const day=new Date(start);day.setDate(start.getDate()+i);
    const key=toDateKey(day),inMonth=day.getMonth()===m,inRange=inTargetRange(key),closed=isClosedDay(key),allowed=inRange&&!closed;
    const record=data.availability.find(a=>a.employeeId===staffEmployeeId&&a.date===key);
    let cls="pending",summary="";
    if(closed&&inRange){cls="closed";summary="公休"}
    else if(record?.unavailable){cls="unavailable";summary="不可排"}
    else if(record){cls="available";summary=`${record.start}起`}
    html+=`<button class="employee-cal-day ${!inMonth?"muted":""} ${!allowed?"disabled":""} ${key===selectedAvailabilityDate?"selected":""} ${cls}" ${allowed?`onclick="selectAvailabilityDate('${key}')"`:"disabled"}>
      <span class="day-number">${day.getDate()}</span>
      ${inRange?`<small>${summary||"未填"}</small>`:""}
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
  byId("availabilityStart").innerHTML=timeOptions(a?.start||"16:00");
  byId("availabilityEnd").innerHTML=timeOptions(a?.end||"22:00");
  byId("availabilityStart").disabled=unavailable;
  byId("availabilityEnd").disabled=unavailable;
  const badge=byId("availabilityDayStatus");
  if(a?.unavailable){badge.textContent="不可排班";badge.className="badge warn"}
  else if(a){badge.textContent="已填寫";badge.className="badge ok"}
  else{badge.textContent="尚未填寫";badge.className="badge"}
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
  if(staffEmployeeId)renderStaff();
});
window.selectAvailabilityDate=selectAvailabilityDate;

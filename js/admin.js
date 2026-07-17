
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
  data:null
};

function defaultData(){
  return {
    employees:[
      {id:"e1",employeeNo:"A012",name:"青春",phone:"",employmentType:"正職",allowedWorkTypeIds:["w1","w2"],weeklyLimit:40,dailyLimit:8,active:true,pinEnabled:false,pinHash:null},
      {id:"e2",employeeNo:"A018",name:"美蘭",phone:"",employmentType:"兼職",allowedWorkTypeIds:["w2","w3","w4"],weeklyLimit:20,dailyLimit:8,active:true,pinEnabled:false,pinHash:null},
      {id:"e3",employeeNo:"B005",name:"友福",phone:"",employmentType:"工讀",allowedWorkTypeIds:["w3","w4","w5"],weeklyLimit:20,dailyLimit:8,active:true,pinEnabled:false,pinHash:null}
    ],
    workTypes:[
      {id:"w1",name:"餅皮",color:"#b94b2f",sort:1,defaultBreak:0,prepDays:[],prepMinutes:0,active:true},
      {id:"w2",name:"烤比薩",color:"#d9822b",sort:2,defaultBreak:90,prepDays:[],prepMinutes:0,active:true},
      {id:"w3",name:"烤雞",color:"#4d7c6f",sort:3,defaultBreak:90,prepDays:[0,6],prepMinutes:30,active:true},
      {id:"w4",name:"收銀",color:"#5d6e9c",sort:4,defaultBreak:90,prepDays:[],prepMinutes:0,active:true},
      {id:"w5",name:"洗碗",color:"#8f5fa2",sort:5,defaultBreak:90,prepDays:[],prepMinutes:0,active:true}
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
    settings:{storeName:"蔡叔叔比薩屋",defaultBreak:90,weekStartsOn:1}
  }
}
function load(){ try{return JSON.parse(localStorage.getItem(STORAGE_KEY))||defaultData()}catch{return defaultData()} }
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state.data));renderAll()}
function byId(id){return document.getElementById(id)}
function employee(id){return state.data.employees.find(x=>x.id===id)}
function worktype(id){return state.data.workTypes.find(x=>x.id===id)}
function mins(t){const [h,m]=t.split(":").map(Number);return h*60+m}
function durationHours(s){return Math.max(0,(mins(s.end)-mins(s.start)-Number(s.breakMinutes||0))/60)}
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
  let out="";for(let m=7*60;m<=24*60;m+=30){const h=Math.floor(m/60)%24,t=`${pad(h)}:${pad(m%60)}`;out+=`<option ${t===selected?"selected":""}>${t}</option>`}return out
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
  }[view];
  byId("pageTitle").textContent=meta[0];byId("pageSubtitle").textContent=meta[1];
  byId("sidebar").classList.remove("open");
  renderAll();
}
function renderAll(){renderDashboard();renderEmployees();renderWorktypes();renderCalendar();renderTimeline()}
function renderDashboard(){
  const active=state.data.employees.filter(e=>e.active).length, month="2026-07";
  const shifts=state.data.shifts.filter(s=>s.date.startsWith(month));
  const hours=shifts.reduce((n,s)=>n+durationHours(s),0);
  const avail=state.data.availability.filter(a=>a.date.startsWith(month)).length;
  byId("dashboardStats").innerHTML=[
    ["在職員工",active,"可安排人力"],
    ["本月班次",shifts.length,"目前已建立"],
    ["本月計薪工時",fmtHours(hours),"依班次自動計算"],
    ["可排時間填寫",avail+" 筆","員工提交紀錄"]
  ].map(x=>`<div class="stat-card"><span>${x[0]}</span><strong>${x[1]}</strong><small>${x[2]}</small></div>`).join("");
  byId("todayLabel").textContent=formatDate(state.selectedDate);
  const selected=state.data.shifts.filter(s=>s.date===state.selectedDate);
  byId("todayShifts").innerHTML=selected.length?selected.map(shiftListItem).join(""):`<div class="empty-state">這一天尚未排班</div>`;
  const warns=[];
  selected.forEach(s=>{
    const e=employee(s.employeeId),a=state.data.availability.find(x=>x.employeeId===s.employeeId&&x.date===s.date);
    if(a&&!a.unavailable&&(s.start<a.start||s.end>a.end))warns.push(`${e.name} 的班次超出可排時間`);
    if(weeklyHours(e.id,s.date)>e.weeklyLimit)warns.push(`${e.name} 本週已超過 ${e.weeklyLimit} 小時`);
  });
  byId("dashboardWarnings").innerHTML=warns.length?warns.map(w=>`<div class="list-item"><div class="list-icon">⚠</div><div class="list-main"><strong>${w}</strong><span>請於排班頁確認</span></div></div>`).join(""):`<div class="empty-state">目前沒有明顯衝突</div>`;
}
function shiftListItem(s){
  const e=employee(s.employeeId),w=worktype(s.workTypeId);
  return `<div class="list-item"><div class="list-icon" style="background:${w.color}22;color:${w.color}">●</div><div class="list-main"><strong>${e.name}｜${w.name}</strong><span>${s.start}～${s.end}・計薪 ${fmtHours(durationHours(s))}</span></div><span class="badge ${s.prepRole?"warn":""}">${s.prepRole?"前置":"一般"}</span></div>`
}
function renderEmployees(){
  const q=(byId("employeeSearch")?.value||"").trim().toLowerCase(),f=byId("employeeStatusFilter")?.value||"all";
  const rows=state.data.employees.filter(e=>(!q||e.name.toLowerCase().includes(q)||e.employeeNo.toLowerCase().includes(q))&&(f==="all"||(f==="active"&&e.active)||(f==="inactive"&&!e.active)));
  byId("employeesTable").innerHTML=rows.map(e=>{
    const works=e.allowedWorkTypeIds.map(id=>worktype(id)?.name).filter(Boolean).join("、")||"未設定";
    return `<tr><td class="employee-name"><strong>${e.name}</strong><span>${e.employmentType}</span></td><td>${e.employeeNo}</td><td>${works}</td><td>${e.weeklyLimit?e.weeklyLimit+" 小時":"未設定"}</td><td><span class="badge ${e.active?"ok":"inactive"}">${e.active?"在職":"停用"}</span></td><td><div class="row-actions"><button class="text-btn" onclick="openEmployeeModal('${e.id}')">編輯</button></div></td></tr>`
  }).join("")||`<tr><td colspan="6"><div class="empty-state">找不到員工</div></td></tr>`;
}
function renderWorktypes(){
  byId("worktypeCards").innerHTML=state.data.workTypes.sort((a,b)=>a.sort-b.sort).map(w=>{
    const dayNames=w.prepDays?.map(d=>"日一二三四五六"[d]).join("、")||"無";
    return `<article class="work-card"><div class="work-card-head"><div class="work-title"><span class="color-dot" style="background:${w.color}"></span><h3>${w.name}</h3></div><span class="badge ${w.active?"ok":"inactive"}">${w.active?"啟用":"停用"}</span></div><div class="work-meta"><span>預設不計薪休息：${w.defaultBreak} 分鐘</span><span>前置作業星期：${dayNames}</span><span>前置提早：${w.prepMinutes||0} 分鐘</span></div><div class="work-card-actions"><button class="secondary-btn" onclick="openWorktypeModal('${w.id}')">編輯設定</button></div></article>`
  }).join("");
}
function renderCalendar(){
  const d=state.calendarDate,y=d.getFullYear(),m=d.getMonth();
  byId("calendarMonthLabel").textContent=`${y} 年 ${m+1} 月`;
  const first=new Date(y,m,1),start=new Date(y,m,1-first.getDay());
  let html="";
  for(let i=0;i<42;i++){const day=new Date(start);day.setDate(start.getDate()+i);const key=toDateKey(day);const count=state.data.shifts.filter(s=>s.date===key).length;
    html+=`<button class="cal-day ${day.getMonth()!==m?"muted":""} ${key===state.selectedDate?"selected":""} ${key===toDateKey(today)?"today":""}" onclick="selectDate('${key}')"><span>${day.getDate()}</span>${count?`<span class="cal-dot"></span>`:""}</button>`
  }
  byId("calendarGrid").innerHTML=html;
}
function renderTimeline(){
  byId("selectedDateTitle").textContent=formatDate(state.selectedDate);
  const dayShifts=state.data.shifts.filter(s=>s.date===state.selectedDate);
  byId("selectedDateSummary").textContent=`${dayShifts.length} 個班次・共 ${fmtHours(dayShifts.reduce((n,s)=>n+durationHours(s),0))}`;
  byId("timelineScale").innerHTML=`<span>工作</span>`+Array.from({length:16},(_,i)=>`<span>${pad(8+i)}</span>`).join("");
  const works=state.data.workTypes.filter(w=>w.active).sort((a,b)=>a.sort-b.sort);
  byId("timelineRows").innerHTML=works.map(w=>{
    const shifts=dayShifts.filter(s=>s.workTypeId===w.id);
    const bars=shifts.map(s=>{const left=((mins(s.start)-8*60)/(16*60))*100,width=((mins(s.end)-mins(s.start))/(16*60))*100,e=employee(s.employeeId);
      return `<button class="shift-bar" onclick="openShiftModal('${s.id}')" style="left:${Math.max(0,left)}%;width:${Math.max(5,width)}%;background:${w.color}"><strong>${e?.name||"未知"}</strong><span>${s.start}–${s.end}${s.prepRole?"・前置":""}</span></button>`
    }).join("");
    return `<div class="timeline-row"><div class="timeline-label"><strong>${w.name}</strong><span>${shifts.length} 人</span></div><div class="timeline-track">${bars}</div></div>`
  }).join("");
}

function selectDate(key){state.selectedDate=key;const d=new Date(key+"T00:00:00");state.calendarDate=new Date(d.getFullYear(),d.getMonth(),1);renderAll()}
function openModal(title,subtitle,html){byId("modalTitle").textContent=title;byId("modalSubtitle").textContent=subtitle||"";byId("modalForm").innerHTML=html;byId("modalBackdrop").classList.remove("hidden")}
function closeModal(){byId("modalBackdrop").classList.add("hidden")}
function openEmployeeModal(id=null){
  const e=id?employee(id):{id:uid("e"),employeeNo:"",name:"",phone:"",employmentType:"兼職",allowedWorkTypeIds:[],weeklyLimit:40,dailyLimit:8,active:true,pinEnabled:false,pinHash:null};
  openModal(id?"編輯員工":"新增員工","設定員工編號、可做工作與工時限制",`
    <input type="hidden" name="id" value="${e.id}">
    <div class="form-grid">
      <label class="field"><span>姓名</span><input class="input" name="name" required value="${e.name}"></label>
      <label class="field"><span>員工編號</span><input class="input" name="employeeNo" required value="${e.employeeNo}"></label>
      <label class="field"><span>身分類型</span><select class="select" name="employmentType">${["正職","兼職","工讀","其他"].map(x=>`<option ${x===e.employmentType?"selected":""}>${x}</option>`).join("")}</select></label>
      <label class="field"><span>每週計薪工時上限</span><input class="input" name="weeklyLimit" type="number" min="0" step=".5" value="${e.weeklyLimit}"></label>
      <label class="field span-2"><span>可以做的工作</span><div class="checkbox-grid">${state.data.workTypes.map(w=>`<label class="checkbox-card"><input type="checkbox" name="works" value="${w.id}" ${e.allowedWorkTypeIds.includes(w.id)?"checked":""}>${w.name}</label>`).join("")}</div></label>
      <label class="check-row span-2"><input type="checkbox" name="active" ${e.active?"checked":""}> 在職並允許員工編號登入</label>
      <div class="modal-actions span-2">${id?`<button type="button" class="danger-btn" onclick="deleteEmployee('${e.id}')">刪除</button>`:""}<button type="button" class="ghost-btn" onclick="closeModal()">取消</button><button class="primary-btn">儲存</button></div>
    </div>`);
  byId("modalForm").onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target),no=fd.get("employeeNo").trim().toUpperCase();if(state.data.employees.some(x=>x.employeeNo.toUpperCase()===no&&x.id!==e.id)){alert("員工編號不可重複");return}
    Object.assign(e,{name:fd.get("name").trim(),employeeNo:no,employmentType:fd.get("employmentType"),weeklyLimit:Number(fd.get("weeklyLimit")||0),allowedWorkTypeIds:fd.getAll("works"),active:fd.get("active")==="on"});
    if(!id)state.data.employees.push(e);save();closeModal()
  }
}
function deleteEmployee(id){if(confirm("確定刪除這位員工？相關班次不會自動刪除。")){state.data.employees=state.data.employees.filter(x=>x.id!==id);save();closeModal()}}
function openWorktypeModal(id=null){
  const w=id?worktype(id):{id:uid("w"),name:"",color:COLORS[state.data.workTypes.length%COLORS.length],sort:state.data.workTypes.length+1,defaultBreak:90,prepDays:[],prepMinutes:0,active:true};
  openModal(id?"編輯工作":"新增工作","設定預設休息與特定星期前置作業",`
  <input type="hidden" name="id" value="${w.id}">
  <div class="form-grid">
    <label class="field"><span>工作名稱</span><input class="input" name="name" required value="${w.name}"></label>
    <label class="field"><span>顏色</span><input class="input" name="color" type="color" value="${w.color}"></label>
    <label class="field"><span>預設不計薪休息（分鐘）</span><input class="input" name="defaultBreak" type="number" min="0" step="30" value="${w.defaultBreak}"></label>
    <label class="field"><span>前置提早（分鐘）</span><input class="input" name="prepMinutes" type="number" min="0" step="30" value="${w.prepMinutes||0}"></label>
    <label class="field span-2"><span>需要前置作業的星期</span><div class="checkbox-grid">${[0,1,2,3,4,5,6].map(d=>`<label class="checkbox-card"><input type="checkbox" name="prepDays" value="${d}" ${w.prepDays.includes(d)?"checked":""}>星期${"日一二三四五六"[d]}</label>`).join("")}</div></label>
    <label class="check-row span-2"><input type="checkbox" name="active" ${w.active?"checked":""}> 啟用</label>
    <div class="modal-actions span-2">${id?`<button type="button" class="danger-btn" onclick="deleteWorktype('${w.id}')">刪除</button>`:""}<button type="button" class="ghost-btn" onclick="closeModal()">取消</button><button class="primary-btn">儲存</button></div>
  </div>`);
  byId("modalForm").onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target);Object.assign(w,{name:fd.get("name").trim(),color:fd.get("color"),defaultBreak:Number(fd.get("defaultBreak")||0),prepMinutes:Number(fd.get("prepMinutes")||0),prepDays:fd.getAll("prepDays").map(Number),active:fd.get("active")==="on"});if(!id)state.data.workTypes.push(w);save();closeModal()}
}
function deleteWorktype(id){if(confirm("確定刪除這個工作？")){state.data.workTypes=state.data.workTypes.filter(x=>x.id!==id);save();closeModal()}}
function getEmployeeEligibility(e,date,start,end,workTypeId,excludeShiftId=null){
  const reasons=[];
  const a=state.data.availability.find(x=>x.employeeId===e.id&&x.date===date);
  if(!e.allowedWorkTypeIds.includes(workTypeId)) reasons.push("未設定可做此工作");
  if(!a) reasons.push("尚未填可排時間");
  else if(a.unavailable) reasons.push("當天不可排班");
  else if(start<a.start||end>a.end) reasons.push(`可排 ${a.start}～${a.end}`);
  const overlap=state.data.shifts.some(x=>x.id!==excludeShiftId&&x.employeeId===e.id&&x.date===date&&mins(start)<mins(x.end)&&mins(end)>mins(x.start));
  if(overlap) reasons.push("已有重疊班次");
  const temp={start,end,breakMinutes:0};
  const projected=weeklyHours(e.id,date,excludeShiftId)+durationHours(temp);
  if(e.weeklyLimit&&projected>e.weeklyLimit) reasons.push(`排入後超過每週 ${e.weeklyLimit} 小時`);
  return {eligible:reasons.length===0,reasons,availability:a};
}
function employeeSelectOptions(date,start,end,workTypeId,selectedId="",excludeShiftId=null){
  const active=state.data.employees.filter(e=>e.active);
  const rows=active.map(e=>({e,...getEmployeeEligibility(e,date,start,end,workTypeId,excludeShiftId)}));
  const available=rows.filter(x=>x.eligible);
  const unavailable=rows.filter(x=>!x.eligible);
  const opt=x=>`<option value="${x.e.id}" ${x.e.id===selectedId?"selected":""}>${x.e.name}（${x.e.employeeNo}）${x.eligible?"｜可排班":"｜"+x.reasons.join("、")}</option>`;
  let html="";
  if(available.length) html+=`<optgroup label="可排班員工">${available.map(opt).join("")}</optgroup>`;
  if(unavailable.length) html+=`<optgroup label="不可排班／需確認">${unavailable.map(opt).join("")}</optgroup>`;
  return html||`<option value="">目前沒有可選員工</option>`;
}
function openShiftModal(id=null){
  const s=id?state.data.shifts.find(x=>x.id===id):{id:uid("s"),date:state.selectedDate,employeeId:"",workTypeId:state.data.workTypes.find(w=>w.active)?.id||"",start:"09:00",end:"17:00",breakMinutes:0,note:"",prepRole:false,status:"draft"};
  const w=worktype(s.workTypeId);if(!id&&w)s.breakMinutes=w.defaultBreak;
  openModal(id?"編輯班次":"新增班次","先設定日期、工作與時間，最後再選擇系統整理好的員工",`
  <div class="form-grid">
    <label class="field"><span>日期</span><input class="input" type="date" name="date" value="${s.date}"></label>
    <label class="field"><span>工作</span><select class="select" name="workTypeId" id="shiftWorkSelect">${state.data.workTypes.filter(w=>w.active).map(w=>`<option value="${w.id}" ${w.id===s.workTypeId?"selected":""}>${w.name}</option>`).join("")}</select></label>
    <label class="field"><span>開始時間</span><select class="select" name="start">${timeOptions(s.start)}</select></label>
    <label class="field"><span>結束時間</span><select class="select" name="end">${timeOptions(s.end)}</select></label>
    <label class="field"><span>不計薪休息（分鐘）</span><input class="input" name="breakMinutes" type="number" min="0" step="30" value="${s.breakMinutes}"></label>
    <label class="check-row"><input type="checkbox" name="prepRole" ${s.prepRole?"checked":""}> 此班次負責前置作業</label>
    <label class="field span-2"><span>選擇員工</span><select class="select employee-smart-select" name="employeeId" id="shiftEmployeeSelect"></select><small class="field-help">名單會依可做工作、可排時間、重疊班次及每週工時自動分組。</small></label>
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
  function updateWarnings(){
    const fd=new FormData(form),eid=fd.get("employeeId"),date=fd.get("date"),start=fd.get("start"),end=fd.get("end"),br=Number(fd.get("breakMinutes")||0),e=employee(eid),warnings=[];
    if(mins(end)<=mins(start))warnings.push("結束時間必須晚於開始時間");
    if(e){
      const result=getEmployeeEligibility(e,date,start,end,fd.get("workTypeId"),id);
      warnings.push(...result.reasons);
      const temp={...s,start,end,breakMinutes:br};
      const week=weeklyHours(eid,date,id)+durationHours(temp);
      if(e.weeklyLimit&&week>e.weeklyLimit&&!warnings.some(x=>x.includes("每週")))warnings.push(`排入後本週 ${fmtHours(week)}，超過上限 ${e.weeklyLimit} 小時`);
    }
    byId("shiftWarnings").innerHTML=warnings.map(w=>`<div class="list-item"><div class="list-icon">⚠</div><div class="list-main"><strong>${w}</strong><span>第一版仍允許主管儲存，以保留例外彈性</span></div></div>`).join("")
  }
  refreshEmployeeOptions();updateWarnings();
  ["date","workTypeId","start","end"].forEach(name=>{
    form.elements[name].addEventListener("change",()=>{refreshEmployeeOptions();updateWarnings()});
  });
  form.elements.employeeId.addEventListener("change",updateWarnings);
  form.elements.breakMinutes.addEventListener("input",updateWarnings);
  form.onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target);if(!fd.get("employeeId")){alert("請選擇員工");return}
    Object.assign(s,{date:fd.get("date"),workTypeId:fd.get("workTypeId"),employeeId:fd.get("employeeId"),start:fd.get("start"),end:fd.get("end"),breakMinutes:Number(fd.get("breakMinutes")||0),prepRole:fd.get("prepRole")==="on",note:fd.get("note").trim()});
    if(mins(s.end)<=mins(s.start)){alert("結束時間必須晚於開始時間");return}
    if(!id)state.data.shifts.push(s);state.selectedDate=s.date;save();closeModal()
  }
}
function deleteShift(id){if(confirm("確定刪除這個班次？")){state.data.shifts=state.data.shifts.filter(x=>x.id!==id);save();closeModal()}}

function init(){
  state.data=load();
  document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>setView(b.dataset.view));
  document.querySelectorAll("[data-view-target]").forEach(b=>b.onclick=()=>setView(b.dataset.viewTarget));
  document.querySelectorAll("[data-quick='add-shift']").forEach(b=>b.onclick=()=>openShiftModal());
  byId("menuBtn").onclick=()=>byId("sidebar").classList.toggle("open");
  byId("modalCloseBtn").onclick=closeModal;byId("modalBackdrop").onclick=e=>{if(e.target===byId("modalBackdrop"))closeModal()};
  byId("addEmployeeBtn").onclick=()=>openEmployeeModal();byId("addWorktypeBtn").onclick=()=>openWorktypeModal();
  byId("employeeSearch").oninput=renderEmployees;byId("employeeStatusFilter").onchange=renderEmployees;
  byId("prevMonthBtn").onclick=()=>{state.calendarDate.setMonth(state.calendarDate.getMonth()-1);renderCalendar()};
  byId("nextMonthBtn").onclick=()=>{state.calendarDate.setMonth(state.calendarDate.getMonth()+1);renderCalendar()};
  byId("resetDemoBtn").onclick=()=>{if(confirm("確定重置為示範資料？")){state.data=defaultData();save()}};
  if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
  renderAll()
}
window.openEmployeeModal=openEmployeeModal;window.deleteEmployee=deleteEmployee;window.openWorktypeModal=openWorktypeModal;window.deleteWorktype=deleteWorktype;window.openShiftModal=openShiftModal;window.deleteShift=deleteShift;window.closeModal=closeModal;window.selectDate=selectDate;
document.addEventListener("DOMContentLoaded",init);

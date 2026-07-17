
const STORAGE_KEY="smartSchedulerV01";
const pad=n=>String(n).padStart(2,"0");
const mins=t=>{const [h,m]=t.split(":").map(Number);return h*60+m};
const fmtHours=n=>Number.isInteger(n)?`${n} 小時`:`${n.toFixed(1)} 小時`;
const formatDate=key=>{const d=new Date(key+"T00:00:00");return `${d.getMonth()+1}/${d.getDate()}（${"日一二三四五六"[d.getDay()]}）`};
const byId=id=>document.getElementById(id);
const uid=p=>p+Math.random().toString(36).slice(2,9);
let data=null, staffEmployeeId=sessionStorage.getItem("smartSchedulerStaffId");

function load(){
  try{return JSON.parse(localStorage.getItem(STORAGE_KEY))}catch{return null}
}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(data));renderStaff()}
function timeOptions(selected=""){
  let out="";for(let m=7*60;m<=24*60;m+=30){const h=Math.floor(m/60)%24,t=`${pad(h)}:${pad(m%60)}`;out+=`<option ${t===selected?"selected":""}>${t}</option>`}return out
}
function durationHours(s){return Math.max(0,(mins(s.end)-mins(s.start)-Number(s.breakMinutes||0))/60)}
function employee(id){return data.employees.find(x=>x.id===id)}
function worktype(id){return data.workTypes.find(x=>x.id===id)}
function renderStaff(){
  if(!staffEmployeeId)return;
  const e=employee(staffEmployeeId);
  if(!e){logout();return}
  byId("staffLoginCard").classList.add("hidden");
  byId("staffPortal").classList.remove("hidden");
  byId("staffWelcome").textContent=`${e.name}，你好`;
  const shifts=data.shifts.filter(s=>s.employeeId===e.id).sort((a,b)=>a.date.localeCompare(b.date));
  const total=shifts.reduce((n,s)=>n+durationHours(s),0);
  const next=shifts[0];
  byId("staffSummary").innerHTML=[
    ["近期班次",shifts.length+" 班","目前系統內的個人班表"],
    ["計薪工時",fmtHours(total),"依目前班次加總"],
    ["下一班",next?`${formatDate(next.date)} ${next.start}`:"尚未排班",next?worktype(next.workTypeId)?.name||"":"等待主管安排"]
  ].map(x=>`<div class="stat-card"><span>${x[0]}</span><strong>${x[1]}</strong><small>${x[2]}</small></div>`).join("");
  byId("staffShiftList").innerHTML=shifts.length?shifts.map(s=>`<div class="list-item"><div class="list-icon" style="background:${worktype(s.workTypeId)?.color||"#999"}22;color:${worktype(s.workTypeId)?.color||"#999"}">●</div><div class="list-main"><strong>${formatDate(s.date)}｜${worktype(s.workTypeId)?.name||"未命名工作"}</strong><span>${s.start}～${s.end}・計薪 ${fmtHours(durationHours(s))}</span></div></div>`).join(""):`<div class="empty-state">目前沒有班表</div>`;
  const av=data.availability.filter(a=>a.employeeId===e.id).sort((a,b)=>a.date.localeCompare(b.date));
  byId("availabilityList").innerHTML=av.length?av.map(a=>`<div class="list-item"><div class="list-icon">${a.unavailable?"休":"時"}</div><div class="list-main"><strong>${formatDate(a.date)}</strong><span>${a.unavailable?"整天不可排班":`${a.start}～${a.end}`}</span></div></div>`).join(""):`<div class="empty-state">尚未填寫可排時間</div>`;
}
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
document.addEventListener("DOMContentLoaded",()=>{
  data=load();
  if(!data){byId("staffLoginError").textContent="目前尚未建立示範資料，請先開啟主管後台 admin26.html。"}
  byId("staffLoginBtn").onclick=login;
  byId("staffNoInput").addEventListener("keydown",e=>{if(e.key==="Enter")login()});
  byId("staffLogoutBtn").onclick=logout;
  document.querySelectorAll(".staff-tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".staff-tab,.staff-tab-panel").forEach(x=>x.classList.remove("active"));b.classList.add("active");byId(b.dataset.staffTab+"Panel").classList.add("active")});
  byId("availabilityStart").innerHTML=timeOptions("16:00");
  byId("availabilityEnd").innerHTML=timeOptions("22:00");
  byId("availabilityDate").value=new Date().toISOString().slice(0,10);
  byId("availabilityUnavailable").onchange=e=>{byId("availabilityStart").disabled=e.target.checked;byId("availabilityEnd").disabled=e.target.checked};
  byId("saveAvailabilityBtn").onclick=()=>{
    if(!staffEmployeeId)return;
    const date=byId("availabilityDate").value,unavailable=byId("availabilityUnavailable").checked,start=byId("availabilityStart").value,end=byId("availabilityEnd").value;
    if(!date){alert("請選日期");return}
    if(!unavailable&&mins(end)<=mins(start)){alert("結束時間必須晚於開始時間");return}
    let a=data.availability.find(x=>x.employeeId===staffEmployeeId&&x.date===date);
    if(!a){a={id:uid("a"),employeeId:staffEmployeeId,date};data.availability.push(a)}
    Object.assign(a,{unavailable,start,end});save();byId("availabilitySaved").textContent="已儲存";
    setTimeout(()=>byId("availabilitySaved").textContent="",1600)
  };
  if(staffEmployeeId)renderStaff();
});

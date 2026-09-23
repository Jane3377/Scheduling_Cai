/* 雲端資料層（分月版，schemaVersion 2）
   ─────────────────────────────────────────────
   Firestore 集合 scheduler 底下的文件：
     main              核心資料：員工、工作項目、設定（固定班次、公休、開放填寫區間…）
     shifts_YYYY-MM    該月份的所有班次        { items:[…] }
     avail_YYYY-MM     該月份的所有可上班紀錄  { items:[…] }
     legacy_v1         從舊版（整包單一文件）搬家時留下的原始備份
   - 即時同步「前月＋本月＋次月」，其他月份用到時由 ensureMonths() 加入即時同步。
   - 對外仍提供合併後的單一 data 物件（shifts / availability 為扁平陣列），
     admin.js 與 staff.js 的畫面邏輯不必知道資料被分月存放。
   - 存檔時逐月比對，只寫「內容有變動」的月份文件，多份一次以 batch 原子寫入。
   - 尚未與雲端同步完成前拒絕寫入（回傳 ok:false），避免以不完整資料覆蓋雲端。
   - 只用 Firestore 作為單一資料來源，不寫入本機。 */
(function(){
  const COLL="scheduler", MAIN="main", LEGACY="legacy_v1", SCHEMA=2;
  const PREFIX={shifts:"shifts_",avail:"avail_"};
  const FIELD={shifts:"shifts",avail:"availability"};
  const KINDS=["shifts","avail"];

  let db=null, col=null, statusCb=null, dataCb=null, errorCb=null;
  let started=false, migrating=false, migrationFailed=false, lastStatus="init";
  let baseList=[];            // 啟動當下的「前月＋本月＋次月」文件 id（跨月不重算，避免就緒判斷卡住）
  let migratedStamp=null;     // 已搬家的舊版文件 updatedAt，避免同一份資料重複搬
  const docs={};                                  // 文件 id → 狀態
  const liveMonths={shifts:new Set(),avail:new Set()};
  const waiters=[];                               // {ids:[…], resolve}

  /* ---------- 小工具 ---------- */
  const clean=o=>o==null?o:JSON.parse(JSON.stringify(o));        // 深拷貝＋去掉 undefined（Firestore 不收）
  function stable(o){                                              // 鍵排序後的字串，用來比對內容是否相同
    if(o===null||typeof o!=="object")return JSON.stringify(o===undefined?null:o);
    if(Array.isArray(o))return "["+o.map(stable).join(",")+"]";
    return "{"+Object.keys(o).filter(k=>o[k]!==undefined).sort().map(k=>JSON.stringify(k)+":"+stable(o[k])).join(",")+"}";
  }
  const monthOf=d=>(typeof d==="string"&&/^\d{4}-\d{2}/.test(d))?d.slice(0,7):"none";
  function addMonth(key,n){const [y,m]=key.split("-").map(Number);const d=new Date(y,m-1+n,1);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");}
  function monthsBetween(a,b){
    if(!a||!b)return [];
    let s=monthOf(a),e=monthOf(b);if(s==="none"||e==="none")return [];if(s>e){const t=s;s=e;e=t;}
    const out=[];for(let k=s;k<=e&&out.length<60;k=addMonth(k,1))out.push(k);return out;
  }
  function groupByMonth(list){const g={};(list||[]).forEach(x=>{const m=monthOf(x&&x.date);(g[m]=g[m]||[]).push(x);});return g;}
  function thisMonth(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");}
  function resolveConfig(){
    const a=window.FIREBASE_CONFIG;
    if(a&&a.apiKey&&a.projectId)return a;
    try{ if(typeof firebaseConfig!=="undefined"&&firebaseConfig&&firebaseConfig.apiKey&&firebaseConfig.projectId)return firebaseConfig; }catch(e){}
    return a||{};
  }
  function setStatus(s){lastStatus=s;Cloud._status=s;if(statusCb)statusCb(s);}
  function report(msg){console.error(msg);if(errorCb)errorCb(msg);}

  /* ---------- 狀態判斷 ---------- */
  const isLegacyCore=r=>r&&r.exists&&!(r.raw&&r.raw.schemaVersion>=SCHEMA);
  function ready(){
    const c=docs[MAIN];
    if(!c||!c.synced||migrating||isLegacyCore(c))return false;
    return started&&baseList.every(id=>docs[id]&&(docs[id].synced||docs[id].error));
  }
  function allFirst(){return Object.values(docs).every(r=>r.first||r.error);}
  function updateStatus(){
    if(!db)return;
    if(migrating||!ready())return setStatus(lastStatus==="error"?"error":"connecting");
    const rs=Object.values(docs);
    if(rs.some(r=>r.pending))return setStatus("saving");
    if(rs.some(r=>r.cache))return setStatus("offline");
    setStatus("synced");
  }

  /* ---------- 組合成單一 data ---------- */
  function buildMerged(){
    const c=docs[MAIN];
    if(!c||!c.val)return null;
    const out=clean(c.val);delete out.shifts;delete out.availability;
    KINDS.forEach(k=>{
      out[FIELD[k]]=[];
      Object.values(docs).filter(r=>r.kind===k).sort((a,b)=>a.month.localeCompare(b.month))
        .forEach(r=>{(r.val||[]).forEach(x=>out[FIELD[k]].push(clean(x)));});
    });
    return out;
  }
  function emit(local){if(dataCb)dataCb(buildMerged(),{local:!!local,exists:!!(docs[MAIN]&&docs[MAIN].exists)});}
  function flushWaiters(){
    for(let i=waiters.length-1;i>=0;i--){
      const w=waiters[i];
      if(w.ids.every(id=>docs[id]&&(docs[id].synced||docs[id].error))){waiters.splice(i,1);w.resolve();}
    }
  }

  /* ---------- 訂閱 ---------- */
  function subscribe(id,kind,month){
    if(docs[id])return docs[id];
    const r={id,kind,month,val:kind==="core"?null:[],json:null,raw:null,exists:false,first:false,synced:false,pending:false,cache:true,error:false};
    docs[id]=r;
    r.unsub=col.doc(id).onSnapshot({includeMetadataChanges:true},function(snap){
      const m=snap.metadata;
      r.exists=snap.exists;r.first=true;r.pending=m.hasPendingWrites;r.cache=m.fromCache;
      if(!m.fromCache)r.synced=true;
      if(kind==="core"){r.raw=snap.exists?snap.data():null;r.val=r.raw?(r.raw.data||null):null;}
      else r.val=snap.exists?((snap.data()||{}).items||[]):[];
      r.json=stable(r.val);
      onDocChange(r,m);
    },function(err){
      r.error=true;r.first=true;
      report("讀取雲端資料失敗（"+id+"）："+(err&&err.message||err)+"。若剛更新版本，請確認 Firestore 規則允許 scheduler/{docId}。");
      setStatus("error");onDocChange(r,{hasPendingWrites:false,fromCache:false});
    });
    return r;
  }
  function subscribeLive(){KINDS.forEach(k=>liveMonths[k].forEach(m=>subscribe(PREFIX[k]+m,k,m)));}
  function onDocChange(r,meta){
    if(r.kind==="core"){
      if(isLegacyCore(r)){ // 舊版整包資料 → 搬家（只在收到伺服器資料時做）
        const stamp=(r.raw&&r.raw.updatedAt)||"none";
        if(!meta.fromCache&&!migrating&&!migrationFailed&&stamp!==migratedStamp)runMigration();
        updateStatus();return;
      }
      if(!started){
        started=true;
        const m0=thisMonth();baseList=[];
        [-1,0,1].forEach(n=>KINDS.forEach(k=>{const m=addMonth(m0,n);liveMonths[k].add(m);baseList.push(PREFIX[k]+m);}));
        subscribeLive();
      }
    }
    updateStatus();
    if(!started||migrating||!allFirst())return;
    if(!r.exists&&r.kind==="core"&&!r.val){ if(dataCb)dataCb(null,{local:false,exists:false}); flushWaiters(); return; }
    emit(meta.hasPendingWrites);
    flushWaiters();
  }

  /* ---------- 從舊版單一文件搬家到分月結構（原子交易，全部成功才切換） ---------- */
  function runMigration(){
    migrating=true;setStatus("connecting");
    const mainRef=col.doc(MAIN);let stamp=null;
    db.runTransaction(function(tx){
      return tx.get(mainRef).then(function(snap){
        if(!snap.exists)return "none";
        const raw=snap.data()||{};
        if(raw.schemaVersion>=SCHEMA)return "already";
        const legacy=raw.data||{};stamp=raw.updatedAt||"none";
        const plan=[];
        KINDS.forEach(k=>{const g=groupByMonth(legacy[FIELD[k]]);Object.keys(g).forEach(m=>plan.push({k,m,id:PREFIX[k]+m,items:g[m]}));});
        const reads=plan.map(p=>tx.get(col.doc(p.id)));
        reads.push(tx.get(col.doc(LEGACY)));
        return Promise.all(reads).then(function(snaps){
          const legSnap=snaps.pop();
          const now=Date.now();
          if(!legSnap.exists)tx.set(col.doc(LEGACY),{data:clean(legacy),savedAt:now,note:"v1 單一文件搬家前的原始資料"});
          plan.forEach(function(p,i){
            let items=clean(p.items);
            const ex=snaps[i];
            if(ex.exists){ // 已有分月文件（例如舊版裝置又寫回整包）→ 以雲端現有為準，只補缺少的
              const cur=(ex.data()||{}).items||[];const have=new Set(cur.map(x=>x&&x.id));
              items=cur.concat(items.filter(x=>!have.has(x&&x.id)));
            }
            tx.set(col.doc(p.id),{items:items,updatedAt:now});
          });
          const core=clean(legacy);delete core.shifts;delete core.availability;
          tx.set(mainRef,{data:core,schemaVersion:SCHEMA,updatedAt:now,migratedAt:now});
          return "done:"+plan.length;
        });
      });
    }).then(function(res){
      migrating=false;migratedStamp=stamp;console.info("資料搬移（分月）結果：",res);
      updateStatus(); // 新的 main 會經由即時同步送達，屆時開始載入各月份
    }).catch(function(e){
      migrating=false;migrationFailed=true;setStatus("error");
      report("資料搬移到分月格式失敗，雲端資料未做任何變更："+(e&&e.message||e)+"。請確認 Firestore 規則允許 scheduler/{docId}，修正後重新整理頁面。");
    });
  }

  /* ---------- 掃描所有月份文件（備份、清除用） ---------- */
  function scanAll(){
    const fp=firebase.firestore.FieldPath.documentId();
    return Promise.all(KINDS.map(k=>col.where(fp,">=",PREFIX[k]).where(fp,"<",PREFIX[k]+"").get())).then(function(res){
      const out={};
      KINDS.forEach(function(k,i){
        out[k]=res[i].docs.map(d=>{const id=d.id,r=docs[id];
          // 已即時同步的文件以本機最新內容為準（含尚未送達雲端的變更）
          return {id,month:id.slice(PREFIX[k].length),items:(r&&r.synced)?clean(r.val):((d.data()||{}).items||[])};});
        // 已訂閱但雲端還沒有的文件（剛建立）也補上
        Object.values(docs).filter(r=>r.kind===k&&r.synced&&(r.val||[]).length&&!out[k].some(x=>x.id===r.id))
          .forEach(r=>out[k].push({id:r.id,month:r.month,items:clean(r.val)}));
        out[k].sort((a,b)=>a.month.localeCompare(b.month));
      });
      return out;
    });
  }
  function commitOps(ops){ // 超過 450 筆就分批
    const chunks=[];for(let i=0;i<ops.length;i+=450)chunks.push(ops.slice(i,i+450));
    return chunks.reduce((p,ch)=>p.then(()=>{const b=db.batch();ch.forEach(o=>o.del?b.delete(o.ref):b.set(o.ref,o.val));return b.commit();}),Promise.resolve());
  }

  const Cloud={
    _status:"init",
    configured(){const c=resolveConfig();return !!(c.apiKey&&c.projectId);},
    online(){return !!db;},
    ready,
    monthsBetween,
    // onData(data,info)：首次載入與每次雲端變動時呼叫；info.local＝自己剛寫入的回音
    init(onData,onStatus,onError){
      dataCb=onData;statusCb=onStatus;errorCb=onError||null;
      if(!(this.configured()&&window.firebase)){setStatus("error");if(dataCb)dataCb(null,{local:false,exists:false});return;}
      try{
        if(!firebase.apps.length)firebase.initializeApp(resolveConfig());
        db=firebase.firestore();col=db.collection(COLL);
        setStatus("connecting");
        const start=function(){subscribe(MAIN,"core","");};
        // 先匿名登入再同步；登入失敗仍嘗試連線（相容尚未鎖定的規則）
        if(firebase.auth)firebase.auth().signInAnonymously().then(start).catch(function(e){console.warn("匿名登入失敗，仍嘗試連線：",e);start();});
        else start();
      }catch(e){
        report("Firebase 初始化失敗："+(e&&e.message||e));setStatus("error");if(dataCb)dataCb(null,{local:false,exists:false});
      }
    },
    // 確保這些月份已載入並即時同步；回傳 Promise（全部從伺服器取得後完成）
    ensureMonths(months,kinds){
      kinds=kinds||KINDS;const ids=[];
      (months||[]).forEach(m=>{if(!/^\d{4}-\d{2}$/.test(m))return;kinds.forEach(k=>{
        liveMonths[k].add(m);const id=PREFIX[k]+m;ids.push(id);
        if(started)subscribe(id,k,m);
      });});
      if(ids.every(id=>docs[id]&&(docs[id].synced||docs[id].error)))return Promise.resolve();
      return new Promise(res=>waiters.push({ids,resolve:res}));
    },
    // 目前雲端（含本機已送出）的合併資料副本；存檔被擋下時用來還原畫面
    snapshotData(){return buildMerged();},
    // 存檔：逐月比對，只寫有變動的文件。回傳 {ok, reason, writes}
    save(data){
      if(!db){setStatus("error");return {ok:false,reason:"offline"};}
      if(!ready()){updateStatus();return {ok:false,reason:"not-ready"};}
      const d=clean(data)||{};const now=Date.now();
      const core=Object.assign({},d);delete core.shifts;delete core.availability;
      const ops=[],merges=[];
      const c=docs[MAIN];const cj=stable(core);
      if(cj!==c.json){ops.push({ref:col.doc(MAIN),val:{data:core,schemaVersion:SCHEMA,updatedAt:now}});c.json=cj;c.val=core;}
      KINDS.forEach(k=>{
        const g=groupByMonth(d[FIELD[k]]);
        const months=new Set(Object.keys(g));
        Object.values(docs).forEach(r=>{if(r.kind===k)months.add(r.month);});
        months.forEach(m=>{
          const id=PREFIX[k]+m,items=g[m]||[],r=docs[id];
          if(r&&r.synced){
            const js=stable(items);
            if(js!==r.json){ops.push({ref:col.doc(id),val:{items,updatedAt:now}});r.json=js;r.val=clean(items);}
          }else if(items.length){ // 尚未載入的月份：與雲端現有內容合併後寫入，並開始即時同步
            merges.push({id,items});liveMonths[k].add(m);subscribe(id,k,m);
          }
        });
      });
      if(!ops.length&&!merges.length)return {ok:true,writes:0};
      setStatus("saving");
      const fail=e=>{setStatus("error");report("寫入雲端失敗："+(e&&e.message||e)+"。這次變更可能沒有存進雲端，請確認網路後再試。");};
      if(ops.length)commitOps(ops).then(updateStatus).catch(fail);
      merges.forEach(mg=>{
        const ref=col.doc(mg.id);
        db.runTransaction(tx=>tx.get(ref).then(s=>{
          const cur=s.exists?((s.data()||{}).items||[]):[];const mine=new Set(mg.items.map(x=>x&&x.id));
          tx.set(ref,{items:cur.filter(x=>!mine.has(x&&x.id)).concat(clean(mg.items)),updatedAt:now});
        })).then(updateStatus).catch(fail);
      });
      return {ok:true,writes:ops.length+merges.length};
    },
    // 完整備份：讀取所有月份 → 合併成與舊版相同格式的 data
    fetchAll(){
      if(!ready())return Promise.reject(new Error("not-ready"));
      return scanAll().then(all=>{
        const out=clean(docs[MAIN].val)||{};
        KINDS.forEach(k=>{out[FIELD[k]]=[];all[k].forEach(x=>x.items.forEach(it=>out[FIELD[k]].push(it)));});
        return out;
      });
    },
    // 還原：以 data 完全覆蓋雲端（核心＋所有月份；備份中沒有的月份一併刪除）
    replaceAll(data){
      if(!ready())return Promise.reject(new Error("not-ready"));
      const d=clean(data)||{};const now=Date.now();
      const core=Object.assign({},d);delete core.shifts;delete core.availability;
      return scanAll().then(all=>{
        const ops=[{ref:col.doc(MAIN),val:{data:core,schemaVersion:SCHEMA,updatedAt:now}}];
        KINDS.forEach(k=>{
          const g=groupByMonth(d[FIELD[k]]);
          Object.keys(g).forEach(m=>ops.push({ref:col.doc(PREFIX[k]+m),val:{items:g[m],updatedAt:now}}));
          all[k].forEach(x=>{if(!g[x.month])ops.push({ref:col.doc(x.id),del:true});});
        });
        return commitOps(ops);
      });
    },
    // 統計 cutoff（YYYY-MM-DD）之前的班次／可上班筆數（跨所有月份）
    countBefore(cutoff){
      if(!ready())return Promise.reject(new Error("not-ready"));
      return scanAll().then(all=>{const n={shifts:0,avail:0};KINDS.forEach(k=>all[k].forEach(x=>{n[k]+=x.items.filter(it=>(it&&it.date||"")<cutoff).length;}));return n;});
    },
    // 清除 cutoff 之前的舊資料：整個月都過期的文件直接刪除，跨界那個月只清過期的日子。回傳刪除筆數
    purgeBefore(cutoff){
      if(!ready())return Promise.reject(new Error("not-ready"));
      const cm=monthOf(cutoff);const now=Date.now();
      return scanAll().then(all=>{
        const ops=[];let removed=0;
        KINDS.forEach(k=>all[k].forEach(x=>{
          if(x.month==="none")return;
          if(x.month<cm){removed+=x.items.length;ops.push({ref:col.doc(x.id),del:true});}
          else if(x.month===cm){const keep=x.items.filter(it=>(it&&it.date||"")>=cutoff);
            if(keep.length!==x.items.length){removed+=x.items.length-keep.length;ops.push({ref:col.doc(x.id),val:{items:keep,updatedAt:now}});}}
        }));
        return commitOps(ops).then(()=>removed);
      });
    }
  };
  window.Cloud=Cloud;
})();

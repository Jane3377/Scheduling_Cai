/* 雲端資料層：有設定 Firebase 就用 Firestore 跨裝置同步；沒設定就退回本機暫存。
   admin.js 與 staff.js 都透過 window.Cloud 讀寫資料。 */
(function(){
  const STORAGE_KEY="smartSchedulerV01";
  const COLL="scheduler", DOC="main";
  let db=null, docRef=null, statusCb=null, dataCb=null;
  function localGet(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY))}catch{return null}}
  function localSet(d){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(d))}catch{}}
  function setStatus(s){Cloud._status=s;if(statusCb)statusCb(s);}
  const Cloud={
    _status:"init",
    // 是否已填入 Firebase 設定
    configured(){const c=window.FIREBASE_CONFIG||{};return !!(c.apiKey&&c.projectId);},
    online(){return !!docRef;},
    // onData(data, info) 會在首次載入與每次雲端更新時被呼叫；info.local 代表是自己剛寫入的回音
    init(onData,onStatus){
      dataCb=onData; statusCb=onStatus;
      if(this.configured()&&window.firebase){
        try{
          if(!firebase.apps.length)firebase.initializeApp(window.FIREBASE_CONFIG);
          db=firebase.firestore();
          docRef=db.collection(COLL).doc(DOC);
          setStatus("connecting");
          docRef.onSnapshot({includeMetadataChanges:true},function(snap){
            const m=snap.metadata;
            const d=snap.exists?(snap.data().data||null):null;
            if(snap.exists)localSet(d); // 保留一份離線副本
            setStatus(m.hasPendingWrites?"saving":(m.fromCache?"offline":"synced"));
            dataCb(d,{local:m.hasPendingWrites,exists:snap.exists});
          },function(err){console.error("Firestore error",err);setStatus("error");});
        }catch(e){
          console.error("Firebase 初始化失敗，改用本機暫存：",e);
          setStatus("error"); dataCb(localGet(),{local:false,exists:!!localGet()});
        }
      }else{
        // 未設定 Firebase → 本機暫存模式
        setStatus(this.configured()?"error":"local");
        dataCb(localGet(),{local:false,exists:!!localGet()});
      }
    },
    save(data){
      localSet(data); // 一律留一份本機副本（離線用）
      if(docRef){
        setStatus("saving");
        docRef.set({data:data,updatedAt:Date.now()}).then(function(){setStatus("synced");})
          .catch(function(e){console.error("寫入雲端失敗",e);setStatus("error");});
      }else{
        setStatus(this.configured()?"error":"local");
      }
    }
  };
  window.Cloud=Cloud;
})();

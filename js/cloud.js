/* 雲端資料層：只用 Firestore 作為單一資料來源（不寫入本機，避免跨裝置各留一份而不一致）。
   讀寫前先匿名登入（若主控台已啟用）；規則鎖定後可要求 request.auth != null。
   尚未與雲端同步前不允許寫入，避免以空白／舊資料覆蓋雲端。
   admin.js 與 staff.js 都透過 window.Cloud 讀寫資料。 */
(function(){
  const COLL="scheduler", DOC="main";
  let db=null, docRef=null, statusCb=null, dataCb=null, hasSynced=false;
  function setStatus(s){Cloud._status=s;if(statusCb)statusCb(s);}
  // 同時支援 window.FIREBASE_CONFIG 或 Firebase 主控台原本的 firebaseConfig 變數，避免貼錯格式
  function resolveConfig(){
    const a=window.FIREBASE_CONFIG;
    if(a&&a.apiKey&&a.projectId)return a;
    try{ if(typeof firebaseConfig!=="undefined"&&firebaseConfig&&firebaseConfig.apiKey&&firebaseConfig.projectId)return firebaseConfig; }catch(e){}
    return a||{};
  }
  const Cloud={
    _status:"init",
    // 是否已填入 Firebase 設定
    configured(){const c=resolveConfig();return !!(c.apiKey&&c.projectId);},
    online(){return !!docRef;},
    // 是否已從雲端伺服器取得過資料（用來判斷能不能安全寫入）
    ready(){return hasSynced;},
    // onData(data, info) 會在首次載入與每次雲端更新時被呼叫；info.local 代表是自己剛寫入的回音
    init(onData,onStatus){
      dataCb=onData; statusCb=onStatus;
      if(this.configured()&&window.firebase){
        try{
          if(!firebase.apps.length)firebase.initializeApp(resolveConfig());
          db=firebase.firestore();
          docRef=db.collection(COLL).doc(DOC);
          setStatus("connecting");
          const startSync=function(){
            docRef.onSnapshot({includeMetadataChanges:true},function(snap){
              const m=snap.metadata;
              if(!m.fromCache)hasSynced=true; // 收到伺服器（非快取）資料才算真正同步過
              const d=snap.exists?(snap.data().data||null):null;
              setStatus(m.hasPendingWrites?"saving":(m.fromCache?"offline":"synced"));
              dataCb(d,{local:m.hasPendingWrites,exists:snap.exists});
            },function(err){console.error("Firestore error",err);setStatus("error");});
          };
          // 先匿名登入再同步；若主控台尚未啟用匿名登入或登入失敗，仍嘗試連線（相容尚未鎖定的規則，不影響現況）
          if(firebase.auth){
            firebase.auth().signInAnonymously().then(startSync)
              .catch(function(e){console.warn("匿名登入失敗，仍嘗試連線：",e);startSync();});
          }else{
            startSync();
          }
        }catch(e){
          console.error("Firebase 初始化失敗：",e);
          setStatus("error"); dataCb(null,{local:false,exists:false});
        }
      }else{
        // 未設定 Firebase → 沒有雲端可用（不再退回本機暫存）
        setStatus("error"); dataCb(null,{local:false,exists:false});
      }
    },
    save(data){
      if(docRef&&hasSynced){
        setStatus("saving");
        docRef.set({data:data,updatedAt:Date.now()}).then(function(){setStatus("synced");})
          .catch(function(e){console.error("寫入雲端失敗",e);setStatus("error");});
      }else if(docRef&&!hasSynced){
        // 尚未與雲端同步 → 暫不寫入，避免以尚未載入的空白資料覆蓋雲端
        console.warn("尚未與雲端同步，暫不寫入以免覆蓋雲端資料");
        setStatus("connecting");
      }else{
        setStatus("error"); // 沒有雲端連線 → 不寫入任何地方
      }
    }
  };
  window.Cloud=Cloud;
})();

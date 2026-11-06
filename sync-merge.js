/* Entry-level sync for the single meal_log document.
   Local entries are never dropped, never duplicated, and never replaced
   by an older snapshot or by a cloud copy that does not contain them. */
(function(root, factory){
  var api = factory();
  if(typeof module==='object' && module.exports) module.exports = api;
  if(root) root.MealSync = api;
})(typeof globalThis!=='undefined' ? globalThis : this, function(){
  var LISTS = ['meals','workouts','sets'];

  function clone(v){
    if(v==null) return v;
    return JSON.parse(JSON.stringify(v));
  }
  function stable(v){
    if(typeof v==='undefined') return 'undefined';
    if(v===null || typeof v!=='object') return JSON.stringify(v);
    if(Array.isArray(v)) return '['+v.map(stable).join(',')+']';
    var keys=Object.keys(v).sort();
    return '{'+keys.map(function(k){ return JSON.stringify(k)+':'+stable(v[k]); }).join(',')+'}';
  }
  function same(a, b){ return stable(a)===stable(b); }
  function isObj(v){ return !!v && typeof v==='object' && !Array.isArray(v); }
  function ts(v){
    if(v==null || v==='') return null;
    var n=Date.parse(v);
    return isNaN(n) ? null : n;
  }
  function isNewer(a, b){
    var ta=ts(a), tb=ts(b);
    if(ta==null || tb==null) return false;
    return ta>tb;
  }
  function laterStamp(a, b){
    if(isNewer(a, b)) return a;
    if(isNewer(b, a)) return b;
    return a || b || null;
  }
  function asList(v){ return Array.isArray(v) ? v : []; }

  function indexById(list){
    var map={}, order=[];
    asList(list).forEach(function(item){
      if(!isObj(item) || item.id==null || item.id==='') return;
      var id=String(item.id);
      if(!map[id]) order.push(id);
      map[id]=item;
    });
    return {map:map, order:order};
  }

  function entryIds(doc){
    var ids=[];
    LISTS.forEach(function(key){
      indexById(doc && doc[key]).order.forEach(function(id){ ids.push(key+':'+id); });
    });
    return ids;
  }
  function missingLocalEntries(localDoc, candidateDoc){
    var have={};
    entryIds(candidateDoc).forEach(function(id){ have[id]=true; });
    return entryIds(localDoc).filter(function(id){ return !have[id]; });
  }
  function keepLocalEntries(localDoc, candidateDoc){
    var missing=missingLocalEntries(localDoc, candidateDoc);
    if(missing.length) return {ok:false, state:localDoc, missing:missing};
    return {ok:true, state:candidateDoc, missing:[]};
  }

  function multiset(arr){
    var m={};
    asList(arr).forEach(function(item){
      var k=stable(item);
      m[k]=(m[k]||0)+1;
    });
    return m;
  }
  function isSubset(small, big){
    var A=multiset(small), B=multiset(big), k;
    for(k in A) if((B[k]||0)<A[k]) return false;
    return true;
  }
  function mergePlainArray(base, local, server){
    var L=Array.isArray(local)?local:null;
    var S=Array.isArray(server)?server:null;
    if(!L) return clone(S||[]);
    if(!S) return clone(L);
    if(same(L, S)) return clone(L);
    if(Array.isArray(base)){
      if(same(base, L)) return clone(S);
      if(same(base, S)) return clone(L);
    }
    if(isSubset(S, L)) return clone(L);
    if(isSubset(L, S)) return clone(S);
    return clone(L);
  }
  function mergeValue(base, local, server){
    if(typeof local==='undefined' && typeof server==='undefined') return undefined;
    if(typeof local==='undefined') return clone(server);
    if(typeof server==='undefined') return clone(local);
    if(same(local, server)) return clone(local);
    if(Array.isArray(local) || Array.isArray(server)) return mergePlainArray(base, local, server);
    if(isObj(local) && isObj(server)) return mergeObj(isObj(base)?base:null, local, server);
    if(isObj(base) || typeof base!=='undefined'){
      if(same(base, local)) return clone(server);
      if(same(base, server)) return clone(local);
    }
    return clone(local);
  }
  function mergeObj(base, local, server){
    var keys={}, out={}, k;
    [base, local, server].forEach(function(o){
      if(!isObj(o)) return;
      Object.keys(o).forEach(function(key){ keys[key]=true; });
    });
    Object.keys(keys).forEach(function(key){
      var b=isObj(base)?base[key]:undefined;
      var l=isObj(local)?local[key]:undefined;
      var s=isObj(server)?server[key]:undefined;
      if(typeof l==='undefined' && typeof s==='undefined') return;
      var v=mergeValue(b, l, s);
      if(typeof v!=='undefined') out[key]=v;
    });
    return out;
  }
  function mergeEntry(base, local, server){
    if(!isObj(local)) return clone(isObj(server)?server:local);
    if(!isObj(server)) return clone(local);
    if(same(local, server)) return clone(local);
    if(isObj(base) && same(base, server)) return clone(local);
    if(isObj(base) && same(base, local)) return clone(server);
    return mergeObj(isObj(base)?base:null, local, server);
  }
  function tombSet(local, server){
    var out={};
    [local, server].forEach(function(doc){
      var list=doc && doc.meta && doc.meta.tombstones;
      asList(list).forEach(function(id){ if(id!=null && id!=='') out[String(id)]=true; });
    });
    return out;
  }
  function mergeEntries(baseList, localList, serverList, tombs){
    var B=indexById(baseList), L=indexById(localList), S=indexById(serverList);
    var seen={}, out=[];
    function push(id, item){
      if(seen[id] || !isObj(item) || item.id==null) return;
      seen[id]=true;
      var copy=clone(item);
      copy.id=item.id;
      out.push(copy);
    }
    L.order.forEach(function(id){
      if(S.map[id]) push(id, mergeEntry(B.map[id], L.map[id], S.map[id]));
      else push(id, L.map[id]);
    });
    S.order.forEach(function(id){
      if(seen[id]) return;
      if(!L.map[id] && tombs[id]) return;
      if(!L.map[id] && B.map[id] && same(B.map[id], S.map[id])) return;
      push(id, S.map[id]);
    });
    return out;
  }

  function mergeOuraDays(primary, secondary){
    var days={}, keys={};
    [primary, secondary].forEach(function(src){
      if(!isObj(src)) return;
      Object.keys(src).forEach(function(k){ keys[k]=true; });
    });
    Object.keys(keys).sort().forEach(function(day){
      var p=isObj(primary)?primary[day]:undefined;
      var s=isObj(secondary)?secondary[day]:undefined;
      if(isObj(p) && isObj(s)){
        var dayCopy=clone(p);
        Object.keys(s).forEach(function(k){
          if(dayCopy[k]==null && s[k]!=null) dayCopy[k]=clone(s[k]);
        });
        days[day]=dayCopy;
      } else days[day]=clone(isObj(p)?p:s);
    });
    return days;
  }
  function mergeOura(local, server){
    local=isObj(local)?local:{};
    server=isObj(server)?server:{};
    var preferServer=isNewer(server.lastSync, local.lastSync) || (ts(local.lastSync)==null && ts(server.lastSync)!=null);
    var primary=preferServer?server:local;
    var secondary=preferServer?local:server;
    var out=clone(primary);
    out.days=mergeOuraDays(primary.days, secondary.days);
    out.hr30=mergeDateMap(null, local.hr30, server.hr30, null, null, null);
    var stamp=preferServer ? (server.lastSync||local.lastSync) : (local.lastSync||server.lastSync);
    if(stamp) out.lastSync=stamp;
    return out;
  }
  function ouraDaySteps(oura, day){
    var d=oura && oura.days && oura.days[day];
    if(!isObj(d) || d.steps==null || d.steps==='') return null;
    return d.steps;
  }
  function mergeDateMap(base, local, server, key, localOura, serverOura){
    local=isObj(local)?local:{};
    server=isObj(server)?server:{};
    base=isObj(base)?base:null;
    var keys={}, out={};
    Object.keys(local).forEach(function(k){ keys[k]=true; });
    Object.keys(server).forEach(function(k){ keys[k]=true; });
    Object.keys(keys).forEach(function(day){
      var L=local[day], S=server[day], B=base?base[day]:undefined;
      if(typeof L==='undefined'){ if(typeof S!=='undefined') out[day]=clone(S); return; }
      if(typeof S==='undefined'){ out[day]=clone(L); return; }
      if(same(L, S)){ out[day]=clone(L); return; }
      if(base && same(B, L)){ out[day]=clone(S); return; }
      if(base && same(B, S)){ out[day]=clone(L); return; }
      if(key==='steps'){
        var lo=ouraDaySteps(localOura, day), so=ouraDaySteps(serverOura, day);
        var localManual=lo!=null && !same(L, lo);
        if(localManual){ out[day]=clone(L); return; }
        if(so!=null && !same(S, so) && lo!=null && same(L, lo)){ out[day]=clone(S); return; }
        if(isNewer(serverOura && serverOura.lastSync, localOura && localOura.lastSync) && so!=null){ out[day]=clone(so); return; }
      }
      out[day]=clone(L);
    });
    return out;
  }
  function isCustomFood(f){ return isObj(f) && f.custom && f.id!=null && f.id!==''; }

  function mergeDocument(base, local, server){
    base=isObj(base)?base:null;
    local=isObj(local)?local:{};
    server=isObj(server)?server:{};
    var tombs=tombSet(local, server);
    var out={};
    var seen={};
    function takeKey(key){ seen[key]=true; }
    LISTS.forEach(function(key){
      takeKey(key);
      out[key]=mergeEntries(base && base[key], local[key], server[key], tombs);
    });
    takeKey('foods');
    var custom=mergeEntries(
      (base&&base.foods||[]).filter(isCustomFood),
      asList(local.foods).filter(isCustomFood),
      asList(server.foods).filter(isCustomFood),
      tombs
    );
    var builtins=asList(local.foods).filter(function(f){ return isObj(f) && !f.custom; });
    if(!builtins.length) builtins=asList(server.foods).filter(function(f){ return isObj(f) && !f.custom; });
    out.foods=builtins.map(clone).concat(custom);
    takeKey('oura');
    out.oura=mergeOura(local.oura, server.oura);
    ['steps','weights','waist','bia','dayType','pinch'].forEach(function(key){
      takeKey(key);
      out[key]=mergeDateMap(base && base[key], local[key], server[key], key, local.oura, server.oura);
    });
    takeKey('settings');
    out.settings=mergeObj(base && base.settings, local.settings, server.settings);
    var stamp=laterStamp(local.settings && local.settings.updatedAt, server.settings && server.settings.updatedAt);
    if(stamp) out.settings.updatedAt=stamp;
    var rest={};
    [server, local, base||{}].forEach(function(src){
      if(!isObj(src)) return;
      Object.keys(src).forEach(function(key){ if(!seen[key] && key!=='meta') rest[key]=true; });
    });
    Object.keys(rest).forEach(function(key){
      out[key]=mergeValue(base && base[key], local[key], server[key]);
    });
    var live={};
    LISTS.forEach(function(key){
      indexById(out[key]).order.forEach(function(id){ live[id]=true; });
    });
    var meta=mergeObj(null, local.meta, server.meta);
    var tombList=[];
    Object.keys(tombs).forEach(function(id){ if(!live[id]) tombList.push(id); });
    tombList.sort();
    if(tombList.length) meta.tombstones=tombList;
    else delete meta.tombstones;
    var syncStamp=laterStamp(local.meta && local.meta.lastSync, server.meta && server.meta.lastSync);
    if(syncStamp) meta.lastSync=syncStamp;
    out.meta=meta;
    return {state:out};
  }

  function afterConflict(session, serverRow){
    session=session||{};
    var serverState=serverRow && isObj(serverRow.state) ? serverRow.state : {};
    var merged=mergeDocument(session.base, session.state, serverState).state;
    var check=keepLocalEntries(session.state, merged);
    if(!check.ok){
      return {
        state: session.state,
        base: session.base || null,
        updatedAt: session.updatedAt || null,
        dirty: true,
        ackedSync: session.ackedSync || null,
        dropped: check.missing
      };
    }
    return {
      state: merged,
      base: clone(serverState),
      updatedAt: (serverRow && serverRow.updated_at) || session.updatedAt || null,
      dirty: true,
      ackedSync: session.ackedSync || null,
      dropped: []
    };
  }
  function afterSave(session, serverRow, genMatches){
    session=session||{};
    var serverState=serverRow && isObj(serverRow.state) ? serverRow.state : null;
    var updated=(serverRow && serverRow.updated_at) || session.updatedAt || null;
    if(!genMatches){
      return {
        session:{
          state: session.state,
          base: serverState ? clone(serverState) : (session.base || null),
          updatedAt: updated,
          dirty: true,
          ackedSync: session.ackedSync || null
        },
        action:'retry'
      };
    }
    if(serverState && !keepLocalEntries(session.state, serverState).ok){
      var again=afterConflict(session, serverRow);
      return {session:again, action: again.dropped && again.dropped.length ? 'stop' : 'retry'};
    }
    return {
      session:{
        state: session.state,
        base: clone(session.state),
        updatedAt: updated,
        dirty: false,
        ackedSync: (serverState && serverState.meta && serverState.meta.lastSync) || session.ackedSync || null
      },
      action:'done'
    };
  }
  function onWriteMiss(session, serverRow, streak){
    streak=streak||0;
    if(!serverRow || !isObj(serverRow.state)) return {session:session, action:'keep', streak:streak};
    var next=afterConflict(session, serverRow);
    if(next.dropped && next.dropped.length) return {session:session, action:'stop', streak:streak, missing:next.dropped};
    var same=!!(session && session.updatedAt && serverRow.updated_at===session.updatedAt);
    var nextStreak=same ? streak+1 : 0;
    return {session:next, action: nextStreak>=2 ? 'unversioned' : 'retry', streak:nextStreak};
  }

  function legacyDirty(cache){
    if(!cache || !cache.state) return false;
    if(cache.dirty===true) return true;
    if(cache.dirty===false) return false;
    var s=cache.state;
    var edited=s.settings && s.settings.updatedAt;
    if(!edited) return false;
    var editedMs=Date.parse(edited);
    if(isNaN(editedMs)) return false;
    var synced=s.meta && s.meta.lastSync;
    if(synced){
      var syncedMs=Date.parse(synced);
      return !isNaN(syncedMs) && editedMs>syncedMs;
    }
    if(!cache.updated_at) return true;
    var baseMs=Date.parse(cache.updated_at);
    return !isNaN(baseMs) && editedMs>baseMs+2000;
  }
  function sessionFromCache(cache){
    if(!cache || !isObj(cache.state)) return null;
    return {
      state: clone(cache.state),
      base: isObj(cache.base) ? clone(cache.base) : null,
      updatedAt: cache.updated_at || null,
      dirty: legacyDirty(cache),
      ackedSync: cache.ackedSync || null
    };
  }
  function cacheFromSession(session){
    session=session||{};
    return {
      state: clone(session.state),
      base: isObj(session.base) ? clone(session.base) : null,
      updated_at: session.updatedAt || null,
      dirty: !!session.dirty,
      ackedSync: session.ackedSync || null
    };
  }
  function updatedAtFilter(base){
    return 'updated_at=eq.'+encodeURIComponent(String(base));
  }
  /* Oura's writer moves updated_at without moving meta.lastSync.
     A cloud row that lost entries but does not have a newer client stamp
     is a stale overwrite, not another device's save. */
  function staleServerDrop(localDoc, serverDoc, ackedSync){
    if(!missingLocalEntries(localDoc, serverDoc || {}).length) return false;
    var incoming=serverDoc && serverDoc.meta && serverDoc.meta.lastSync;
    var ours=ackedSync || (localDoc && localDoc.meta && localDoc.meta.lastSync);
    var ti=ts(incoming), to=ts(ours);
    if(ti!=null && to!=null && ti>to+1000) return false;
    return true;
  }

  return {
    clone: clone,
    mergeDocument: mergeDocument,
    afterConflict: afterConflict,
    afterSave: afterSave,
    onWriteMiss: onWriteMiss,
    sessionFromCache: sessionFromCache,
    cacheFromSession: cacheFromSession,
    updatedAtFilter: updatedAtFilter,
    staleServerDrop: staleServerDrop,
    entryIds: entryIds,
    missingLocalEntries: missingLocalEntries,
    keepLocalEntries: keepLocalEntries,
    legacyDirty: legacyDirty
  };
});

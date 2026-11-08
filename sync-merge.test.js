'use strict';
var fs = require('fs');
var path = require('path');
var Sync = require('./sync-merge.js');

var failed = 0;
function check(name, cond){
  if(cond){ console.log('PASS '+name); return; }
  failed++;
  console.error('FAIL '+name);
}
function ids(doc, key){
  return (doc && doc[key] || []).map(function(x){ return String(x.id); });
}
function eqIds(a, b){
  if(a.length!==b.length) return false;
  for(var i=0;i<a.length;i++) if(a[i]!==b[i]) return false;
  return true;
}
function wk(id, extra){
  var row={id:id, date:'2099-01-01', time:'06:30', type:'other', minutes:10};
  if(extra) Object.keys(extra).forEach(function(k){ row[k]=extra[k]; });
  return row;
}
function meal(id){
  return {id:id, date:'2099-01-01', slot:'早', items:[{name:'fixture', grams:1}]};
}
function doc(opts){
  opts=opts||{};
  return {
    meals: opts.meals || [],
    workouts: opts.workouts || [],
    sets: opts.sets || [],
    steps: opts.steps || {},
    oura: opts.oura || {days:{}, lastSync:null},
    weights: {},
    waist: {},
    bia: {},
    dayType: {},
    pinch: {},
    foods: opts.foods || [],
    settings: opts.settings || {activitySource:null, updatedAt:'2099-01-01T00:00:00.000Z'},
    meta: opts.meta || {lastSync:'2099-01-01T00:00:00.000Z'}
  };
}
function aligned(state, at){
  return {state:Sync.clone(state), base:Sync.clone(state), updatedAt:at, dirty:false, ackedSync:at};
}
function noInvent(local, server, out){
  ['meals','workouts','sets'].forEach(function(key){
    var allowed={};
    (local[key]||[]).concat(server[key]||[]).forEach(function(it){
      if(it && it.id!=null) allowed[String(it.id)]=true;
    });
    var seen={};
    (out[key]||[]).forEach(function(it){
      if(!allowed[String(it.id)]) throw new Error('invented '+key+' '+it.id);
      if(seen[String(it.id)]) throw new Error('duplicate '+key+' '+it.id);
      seen[String(it.id)]=true;
    });
  });
}

function MemoryServer(state, at){
  this.state=Sync.clone(state);
  this.updatedAt=at;
}
MemoryServer.prototype.row=function(){
  return {state:Sync.clone(this.state), updated_at:this.updatedAt};
};
MemoryServer.prototype.bump=function(mutate){
  var next=Sync.clone(this.state);
  mutate(next);
  this.state=next;
  this.updatedAt=new Date(Date.parse(this.updatedAt)+15000).toISOString();
};
MemoryServer.prototype.write=function(base, incoming, skipVersion){
  if(!skipVersion && base!==this.updatedAt) return {matched:false, row:this.row()};
  var stored=Sync.clone(incoming);
  if(!stored.meta || typeof stored.meta!=='object') stored.meta={};
  this.updatedAt=new Date(Date.parse(this.updatedAt)+1000).toISOString();
  stored.meta.lastSync=this.updatedAt;
  this.state=stored;
  return {matched:true, row:this.row()};
};

/* Mirrors index.html: conditional write, rebase on miss, keep every local entry, reload from cache. */
function pump(session, server){
  var streak=0, guard=0, skip=false;
  while(session.dirty && guard++<12){
    var attempt=server.write(session.updatedAt, session.state, skip);
    skip=false;
    if(attempt.matched){
      var saved=Sync.afterSave(session, attempt.row, true);
      if(!Sync.keepLocalEntries(session.state, saved.session.state).ok) throw new Error('save rolled local back');
      session=saved.session;
      streak=0;
      if(saved.action==='done') break;
      continue;
    }
    var miss=Sync.onWriteMiss(session, attempt.row, streak);
    if(miss.action==='stop' || miss.action==='keep') throw new Error('conflict did not merge: '+miss.action);
    if(!Sync.keepLocalEntries(session.state, miss.session.state).ok) throw new Error('conflict dropped local entries');
    session=miss.session;
    streak=miss.streak;
    if(miss.action==='unversioned') skip=true;
    session=Sync.sessionFromCache(Sync.cacheFromSession(session));
  }
  if(session.dirty) throw new Error('did not settle');
  return session;
}

(function severalInARow(){
  var origin=doc();
  var server=new MemoryServer(origin, '2099-01-01T00:00:00.000Z');
  var session=aligned(origin, server.updatedAt);
  ['a','b','c'].forEach(function(id){
    session.state.workouts.push(wk(id));
    session.dirty=true;
    session.state.settings.updatedAt=new Date(Date.parse(session.updatedAt)+1000).toISOString();
    server.bump(function(s){ s.oura.lastSync=server.updatedAt; s.oura.days['2099-01-02']={activeCal:20}; });
    session=pump(session, server);
  });
  check('1 several records added in a row all sync', eqIds(ids(server.state,'workouts'), ['a','b','c']) && !session.dirty);
})();

(function offlineThenReload(){
  var origin=doc();
  var server=new MemoryServer(origin, '2099-01-01T00:00:00.000Z');
  var session=aligned(origin, server.updatedAt);
  session.state.workouts.push(wk('off'));
  session.dirty=true;
  var networkUp=false;
  var cache=Sync.cacheFromSession(session);
  var reloaded=Sync.sessionFromCache(cache);
  check('4 unsynced local data survives reload', !!reloaded && reloaded.dirty && eqIds(ids(reloaded.state,'workouts'), ['off']));
  if(!networkUp){
    var still=Sync.sessionFromCache(Sync.cacheFromSession(reloaded));
    check('2 offline record still present before reconnect', eqIds(ids(still.state,'workouts'), ['off']) && still.dirty);
    reloaded=still;
  }
  server.bump(function(s){ s.oura.lastSync='2099-01-01T00:00:15.000Z'; });
  reloaded=pump(reloaded, server);
  check('2 offline record syncs after reconnect', eqIds(ids(server.state,'workouts'), ['off']) && !reloaded.dirty);
})();

(function twoDevices(){
  var origin=doc({meals:[meal('old')]});
  var server=new MemoryServer(origin, '2099-03-01T00:00:00.000Z');
  var phone=aligned(origin, server.updatedAt);
  var desk=aligned(origin, server.updatedAt);
  phone.state.workouts.push(wk('phone'));
  phone.dirty=true;
  desk.state.meals.push(meal('desk'));
  desk.dirty=true;
  var wrote=server.write(desk.updatedAt, desk.state, false);
  check('3 desktop write lands', wrote.matched);
  desk=Sync.afterSave(desk, wrote.row, true).session;
  var missed=server.write(phone.updatedAt, phone.state, false);
  check('3 phone hits version conflict', !missed.matched);
  var merged=Sync.onWriteMiss(phone, missed.row, 0);
  phone=merged.session;
  check('3 conflict keeps both devices entries',
    ids(phone.state,'workouts').indexOf('phone')>=0 &&
    ids(phone.state,'meals').indexOf('desk')>=0 &&
    ids(phone.state,'meals').indexOf('old')>=0);
  phone=pump(phone, server);
  check('3 both sides on server after merge',
    ids(server.state,'workouts').indexOf('phone')>=0 &&
    ids(server.state,'meals').indexOf('desk')>=0 &&
    ids(server.state,'meals').indexOf('old')>=0 &&
    !phone.dirty);
})();

(function threeEntriesNotRolledBack(){
  var early=doc({workouts:[wk('tm',{minutes:40})]});
  var local=doc({workouts:[wk('tm',{minutes:40}), wk('w1',{minutes:6, time:'07:13'}), wk('w2',{minutes:6, time:'07:18'})]});
  var cloud=doc({
    meals:[meal('cloud-meal')],
    workouts:[wk('yesterday',{date:'2098-12-31'})],
    oura:{lastSync:'2099-01-01T08:00:00.000Z', days:{'2099-01-01':{activeCal:40, steps:10}}}
  });
  var legacy=Sync.sessionFromCache({state:local, updated_at:'2099-01-01T00:00:00.000Z', dirty:true});
  check('legacy cache has no base snapshot', legacy.base===null);
  var out=Sync.mergeDocument(early, local, cloud).state;
  noInvent(local, cloud, out);
  check('stale one-entry snapshot cannot drop later entries', eqIds(ids(out,'workouts'), ['tm','w1','w2','yesterday']));
  check('stale cloud copy cannot replace local entries', ids(out,'workouts').indexOf('tm')>=0 && ids(out,'meals').indexOf('cloud-meal')>=0);
  var decided=Sync.onWriteMiss(legacy, {state:cloud, updated_at:'2099-01-01T08:00:00.000Z'}, 0);
  check('write miss keeps all three local entries', eqIds(ids(decided.session.state,'workouts'), ['tm','w1','w2','yesterday']));
  var partial={state:early, updated_at:'2099-01-01T09:00:00.000Z'};
  var saved=Sync.afterSave(decided.session, partial, false);
  check('older successful payload does not roll memory back', eqIds(ids(saved.session.state,'workouts'), ['tm','w1','w2','yesterday']) && saved.session.dirty);
  var reloaded=Sync.sessionFromCache(Sync.cacheFromSession(saved.session));
  check('three entries still there after reload', eqIds(ids(reloaded.state,'workouts'), ['tm','w1','w2','yesterday']) && reloaded.dirty);
})();

(function noDuplicatesOrInventions(){
  var local=doc({workouts:[wk('a'), wk('a'), wk('b')]});
  var server=doc({workouts:[wk('b'), wk('c')]});
  var out=Sync.mergeDocument(null, local, server).state;
  noInvent(local, server, out);
  check('same id is not duplicated', eqIds(ids(out,'workouts'), ['a','b','c']));
  var frozenL=JSON.stringify(local), frozenS=JSON.stringify(server);
  Sync.mergeDocument(null, local, server);
  check('merge does not mutate inputs', JSON.stringify(local)===frozenL && JSON.stringify(server)===frozenS);
})();

(function tombstoneDoesNotHideLiveLocal(){
  var local=doc({workouts:[wk('live')], meta:{lastSync:'2099-01-01T00:00:00.000Z', tombstones:['live','gone']}});
  var server=doc({workouts:[wk('gone'), wk('live')]});
  var out=Sync.mergeDocument(null, local, server).state;
  check('tombstone cannot remove an entry still on the phone', eqIds(ids(out,'workouts'), ['live']));
  var base=doc({workouts:[wk('gone')]});
  var deleted=doc({workouts:[], meta:{tombstones:['gone']}});
  var remote=doc({workouts:[wk('gone')]});
  var after=Sync.mergeDocument(base, deleted, remote).state;
  check('confirmed delete is not resurrected', ids(after,'workouts').indexOf('gone')<0);
})();

(function ouraNewerDoesNotDropWorkouts(){
  var local=doc({
    workouts:[wk('a'), wk('b'), wk('c')],
    oura:{lastSync:'2099-01-01T01:00:00.000Z', days:{'2099-01-01':{activeCal:1, steps:2}}},
    steps:{'2099-01-01':2}
  });
  var server=doc({
    workouts:[wk('server-only')],
    oura:{lastSync:'2099-01-01T02:00:00.000Z', days:{'2099-01-01':{activeCal:80, steps:9}, '2099-01-02':{activeCal:3}}},
    steps:{'2099-01-01':9}
  });
  var out=Sync.mergeDocument(null, local, server).state;
  check('newer oura kept and local workouts kept',
    eqIds(ids(out,'workouts'), ['a','b','c','server-only']) &&
    out.oura.days['2099-01-01'].activeCal===80 &&
    out.oura.days['2099-01-02'].activeCal===3);
  var newerLocal=doc({
    workouts:[wk('a')],
    oura:{lastSync:'2099-01-01T05:00:00.000Z', days:{'2099-01-01':{activeCal:70}}},
    steps:{'2099-01-01':70}
  });
  var olderCloud=doc({
    oura:{lastSync:'2099-01-01T01:00:00.000Z', days:{'2099-01-01':{activeCal:1}}},
    steps:{'2099-01-01':1}
  });
  var kept=Sync.mergeDocument(null, newerLocal, olderCloud).state;
  check('older cloud oura does not replace a newer local reading', kept.oura.days['2099-01-01'].activeCal===70 && ids(kept,'workouts').indexOf('a')>=0);
})();

(function manualStepsSurvive(){
  var local=doc({
    steps:{'2099-01-01':111},
    oura:{lastSync:'2099-01-01T01:00:00.000Z', days:{'2099-01-01':{steps:2}}}
  });
  var server=doc({
    steps:{'2099-01-01':9},
    oura:{lastSync:'2099-01-01T03:00:00.000Z', days:{'2099-01-01':{steps:9}}}
  });
  var out=Sync.mergeDocument(null, local, server).state;
  check('typed steps are not replaced by a newer oura mirror', out.steps['2099-01-01']===111);
})();

(function filterEncodesPlus(){
  var q=Sync.updatedAtFilter('2099-01-01T00:00:00.000000+00:00');
  check('version filter encodes plus sign', q.indexOf('%2B')>0 && q.indexOf('+')<0);
})();

(function staleOuraOverwrite(){
  var saved=doc({workouts:[wk('tm'), wk('w1'), wk('w2')], meta:{lastSync:'2099-05-01T00:00:00.000Z'}});
  var clobber=doc({workouts:[], oura:{lastSync:'2099-05-01T00:15:00.000Z', days:{}}, meta:{lastSync:'2099-04-01T00:00:00.000Z'}});
  check('stale cloud overwrite is not treated as a newer save', Sync.staleServerDrop(saved, clobber, saved.meta.lastSync));
  var other=doc({workouts:[wk('tm')], meta:{lastSync:'2099-05-02T00:00:00.000Z'}});
  check('newer client stamp may remove entries', !Sync.staleServerDrop(saved, other, saved.meta.lastSync));
  var restored=Sync.onWriteMiss({state:saved, base:saved, updatedAt:'2099-05-01T00:00:00.000Z', dirty:false, ackedSync:saved.meta.lastSync}, {state:clobber, updated_at:'2099-05-01T00:15:00.000Z'}, 0);
  check('stale overwrite merge puts the three entries back', eqIds(ids(restored.session.state,'workouts'), ['tm','w1','w2']));
})();

(function pageWiring(){
  var html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  check('page rebases through onWriteMiss', html.indexOf('MealSync.onWriteMiss')>=0);
  check('page does not stick on version conflict', !/conflictHold\s*=\s*true/.test(html));
  check('page version moved past the stuck build', html.indexOf("APP_VER = '20261030-0954'")<0 && /APP_VER = '20[0-9]{6}-[0-9]{4}'/.test(html));
  check('page loads sync-merge and a service worker', html.indexOf('sync-merge.js')>=0 && html.indexOf('serviceWorker')>=0);
})();

(function batchOfThreeThenConflict(){
  var origin=doc();
  var server=new MemoryServer(origin, '2099-04-01T00:00:00.000Z');
  var session=aligned(origin, server.updatedAt);
  session.state.workouts.push(wk('tm',{minutes:40}));
  session.state.workouts.push(wk('w1',{minutes:6}));
  session.state.workouts.push(wk('w2',{minutes:6}));
  session.dirty=true;
  var early=Sync.clone(session.state);
  early.workouts=early.workouts.slice(0,1);
  server.bump(function(s){ s.meals.push(meal('other-device')); s.oura.lastSync=server.updatedAt; });
  session.base=early;
  session=pump(session, server);
  check('batch of three survives conflict against one-entry base and cloud',
    eqIds(ids(server.state,'workouts'), ['tm','w1','w2']) &&
    ids(server.state,'meals').indexOf('other-device')>=0);
})();

function deadlineChecks(){
  var html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  check('full sync budget is 45s and poll stays 12s', Sync.FULL_SYNC_MS===45000 && Sync.POLL_MS===12000);
  check('full document reads and writes use the long budget',
    html.split('MealSync.FULL_SYNC_MS').length>=4 && html.indexOf('select=updated_at\').then')>=0);
  var hung=false;
  return Sync.withDeadline(60, function(signal){
    return new Promise(function(resolve){
      setTimeout(resolve, 5);
    }).then(function(){
      return new Promise(function(resolve, reject){
        if(signal) signal.addEventListener('abort', function(){ var e=new Error('aborted'); e.name='AbortError'; reject(e); });
      });
    });
  }).then(function(){
    hung=true;
    check('stalled body does not hang the sync', false);
  }, function(err){
    check('stalled body does not hang the sync', !hung && !!(err && err.timeout));
  }).then(function(){
    if(failed){
      console.error(failed+' check(s) failed');
      process.exit(1);
    }
    console.log('all sync checks passed');
  });
}
deadlineChecks();

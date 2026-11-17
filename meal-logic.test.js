'use strict';
var fs = require('fs');
var path = require('path');
var Logic = require('./meal-logic.js');

var failed = 0;
function check(name, cond){
  if(cond){ console.log('PASS '+name); return; }
  failed++;
  console.error('FAIL '+name);
}
function eq(a, b){ return JSON.stringify(a)===JSON.stringify(b); }

var LIVE = {
  dailyKcal:1800, restKcal:1800, proteinTarget:150, carbTarget:190,
  fatTarget:50, fiberTarget:30, restDays:'3,0'
};

function approvedSettings(){
  var s=JSON.parse(JSON.stringify(LIVE));
  Logic.seedApprovedPlan(s);
  return s;
}

(function boundaries(){
  var s=approvedSettings();
  var dates=['2026-11-16','2026-11-17','2026-11-30','2026-12-01','2026-12-15','2026-12-16'];
  var expect={
    '2026-11-16':{lower:1800, upper:1800, source:'baseline', kind:'point'},
    '2026-11-17':{lower:2000, upper:2100, source:'plan', kind:'range'},
    '2026-11-30':{lower:2000, upper:2100, source:'plan', kind:'range'},
    '2026-12-01':{lower:2300, upper:2400, source:'plan', kind:'range'},
    '2026-12-15':{lower:2300, upper:2400, source:'plan', kind:'range'},
    '2026-12-16':{lower:1800, upper:1800, source:'baseline', kind:'point'}
  };
  dates.forEach(function(d){
    ['gym','rest'].forEach(function(kind){
      var t=Logic.resolveTarget(s, d, kind==='rest');
      var e=expect[d];
      check(d+' '+kind+' target', t.lower===e.lower && t.upper===e.upper && t.source===e.source && t.kind===e.kind && t.label!=='2,050' && t.label!=='2,350');
      check(d+' '+kind+' not midpoint', t.lower!==2050 && t.upper!==2050 && t.lower!==2350);
    });
  });
  var nov17=Logic.resolveTarget(s, '2026-11-17', false);
  check('range label keeps both ends', nov17.label==='2,000–2,100');
  var dec16g=Logic.resolveTarget(s, '2026-12-16', false);
  var dec16r=Logic.resolveTarget(s, '2026-12-16', true);
  check('Dec 16 gym and rest both previous 1800', dec16g.lower===1800 && dec16g.upper===1800 && dec16r.lower===1800 && dec16r.upper===1800);
})();

(function timezone(){
  var s=approvedSettings();
  check('HK date before Nov 17 midnight', Logic.hkToday(new Date('2026-11-16T15:59:59.000Z'))==='2026-11-16');
  check('HK date at Nov 17 midnight', Logic.hkToday(new Date('2026-11-16T16:00:00.000Z'))==='2026-11-17');
  check('HK date before Dec 1', Logic.hkToday(new Date('2026-11-30T15:59:59.000Z'))==='2026-11-30');
  check('HK date at Dec 1', Logic.hkToday(new Date('2026-11-30T16:00:00.000Z'))==='2026-12-01');
  check('HK date before Dec 16', Logic.hkToday(new Date('2026-12-15T15:59:59.000Z'))==='2026-12-15');
  check('HK date at Dec 16', Logic.hkToday(new Date('2026-12-15T16:00:00.000Z'))==='2026-12-16');
  var before=Logic.resolveTarget(s, new Date('2026-11-16T15:59:59.000Z'), false);
  var after=Logic.resolveTarget(s, new Date('2026-11-16T16:00:00.000Z'), false);
  check('instant before HK midnight stays historical', before.lower===1800 && before.upper===1800 && before.source==='baseline');
  check('instant at HK midnight switches range', after.lower===2000 && after.upper===2100 && after.kind==='range');
  var dec15=Logic.resolveTarget(s, new Date('2026-12-15T15:59:59.000Z'), true);
  var dec16=Logic.resolveTarget(s, new Date('2026-12-15T16:00:00.000Z'), true);
  check('Dec 15 instant still in second window', dec15.lower===2300 && dec15.upper===2400);
  check('Dec 16 instant returns to 1800', dec16.lower===1800 && dec16.upper===1800 && dec16.source==='baseline');
  check('clock is Hong Kong', Logic.hkClock(new Date('2026-11-16T16:05:00.000Z'))==='00:05');
})();

(function noPlan(){
  var s=JSON.parse(JSON.stringify(LIVE));
  s.restKcal=1600;
  check('missing plan is fallback', !s.kcalPlan);
  var gym=Logic.resolveTarget(s, '2026-11-17', false);
  var rest=Logic.resolveTarget(s, '2026-11-18', true);
  check('no plan gym uses daily point', gym.lower===1800 && gym.upper===1800 && gym.kind==='point' && gym.source==='baseline');
  check('no plan rest uses rest point', rest.lower===1600 && rest.upper===1600 && rest.source==='baseline');
  var none=Logic.resolveTarget({restDays:'3,0'}, '2026-11-17', false);
  check('no numbers means no target', none.kind==='none' && none.lower==null && none.upper==null);
  var empty=JSON.parse(JSON.stringify(LIVE));
  empty.kcalPlan=[];
  var seeded=Logic.seedApprovedPlan(empty);
  check('empty plan is explicit and not reseeded', seeded.changed===false && empty.kcalPlan.length===0);
  check('empty plan resolves baseline', Logic.resolveTarget(empty, '2026-11-17', false).label==='1,800');
})();

(function gymRestOverride(){
  var s=JSON.parse(JSON.stringify(LIVE));
  s.kcalPlan=[{
    id:'split', start:'2026-11-17', end:'2026-11-30', lower:2000, upper:2100,
    gym:{lower:2200, upper:2300}, rest:{lower:1700, upper:1800}
  }];
  var dayType={'2026-11-18':'gym'};
  check('Nov 18 is normally rest (Wed)', Logic.isRestDay('2026-11-18', s, {})===true);
  check('Nov 17 is gym Tuesday', Logic.isRestDay('2026-11-17', s, {})===false);
  var forced=Logic.targetFor(s, '2026-11-18', dayType);
  var natural=Logic.targetFor(s, '2026-11-18', {});
  var gym=Logic.targetFor(s, '2026-11-17', {});
  check('dayType gym override uses gym range', forced.lower===2200 && forced.upper===2300 && forced.dayType==='gym');
  check('natural rest uses rest range', natural.lower===1700 && natural.upper===1800 && natural.dayType==='rest');
  check('gym day uses gym override not shared midpoint', gym.lower===2200 && gym.upper===2300);
  check('historical date ignores override window', Logic.targetFor(s, '2026-11-16', {}).label==='1,800');
})();

(function invalid(){
  var low=Logic.validatePlan([{start:'2026-11-17', end:'2026-11-30', lower:2100, upper:2000}]);
  check('lower above upper rejected', low.ok===false && low.windows==null);
  var overlap=Logic.validatePlan([
    {start:'2026-11-17', end:'2026-11-30', lower:2000, upper:2100},
    {start:'2026-11-30', end:'2026-12-02', lower:2300, upper:2400}
  ]);
  check('inclusive overlap rejected', overlap.ok===false);
  var adjacent=Logic.validatePlan([
    {start:'2026-11-17', end:'2026-11-30', lower:2000, upper:2100},
    {start:'2026-12-01', end:'2026-12-15', lower:2300, upper:2400}
  ]);
  check('adjacent windows allowed', adjacent.ok===true && adjacent.windows.length===2);
  var badDate=Logic.validatePlan([{start:'2026-02-31', end:'2026-03-01', lower:1, upper:2}]);
  check('impossible date rejected', badDate.ok===false);
  var order=Logic.validatePlan([{start:'2026-12-02', end:'2026-12-01', lower:1, upper:2}]);
  check('end before start rejected', order.ok===false);
  var half=Logic.validatePlan([{start:'2026-11-17', end:'2026-11-30', lower:2000}]);
  check('missing upper rejected', half.ok===false);
  var text=Logic.validatePlan('2000-2100');
  check('non array rejected', text.ok===false);
  var kept=JSON.parse(JSON.stringify(LIVE));
  kept.kcalPlan=[{start:'2026-11-17', end:'2026-11-30', lower:2000, upper:2100}];
  var bad=Logic.applyPlanMutation(kept, {type:'set_kcal_plan', windows:[{start:'2026-11-17', end:'2026-11-10', lower:1, upper:2}]});
  check('invalid mutation does not replace plan', bad.ok===false && kept.kcalPlan[0].lower===2000);
  var sneaky=Logic.applyPlanMutation(kept, {type:'replace_state', meals:[], windows:[]});
  check('non plan command rejected', sneaky.ok===false && sneaky.settings===kept);
  var extra=Logic.applyPlanMutation(kept, {type:'set_kcal_plan', windows:[], meals:[{kcal:1}]});
  check('meal field on plan command rejected', extra.ok===false);
})();

(function persistence(){
  var originalMeals=[{id:'m1', date:'2026-11-01', items:[{name:'舊早餐', kcal:497, protein:42}]}];
  var before=JSON.parse(JSON.stringify(originalMeals));
  var settings=JSON.parse(JSON.stringify(LIVE));
  settings.journey={startWeight:80};
  settings.updatedAt='2026-11-01T00:00:00.000Z';
  var seeded=Logic.seedApprovedPlan(settings);
  check('seed once', seeded.changed===true && settings.kcalPlanSeed==='approved-2026-11');
  check('seed keeps standing 1800', settings.dailyKcal===1800 && settings.restKcal===1800);
  check('seed does not invent meals', eq(originalMeals, before));
  var again=Logic.seedApprovedPlan(settings);
  check('seed is idempotent', again.changed===false);
  var raw=JSON.parse(JSON.stringify(settings));
  check('round trip keeps both ends', raw.kcalPlan[0].lower===2000 && raw.kcalPlan[0].upper===2100 && raw.kcalPlan[1].lower===2300 && raw.kcalPlan[1].upper===2400);
  var legacy=JSON.parse(JSON.stringify(LIVE));
  legacy.workoutTypes=['跑步機'];
  legacy.goalKg=71;
  check('legacy settings still resolve old target', Logic.resolveTarget(legacy, '2026-11-16', false).label==='1,800');
  check('legacy Nov 17 also baseline before seed', Logic.resolveTarget(legacy, '2026-11-17', true).label==='1,800');
  var point=Logic.validatePlan([{start:'2026-01-01', end:'2026-01-02', kcal:1800}]);
  check('single stored number is a point range', point.ok===true && point.windows[0].lower===1800 && point.windows[0].upper===1800);
  var nested=Logic.validatePlan([{start:'2026-11-17', end:'2026-11-30', kcal:{lower:2000, upper:2100}}]);
  check('nested lower upper preserved', nested.ok===true && nested.windows[0].lower===2000 && nested.windows[0].upper===2100);
  var mutated=Logic.applyPlanMutation(legacy, {type:'set_kcal_plan', windows:Logic.APPROVED_WINDOWS});
  check('sanctioned mutation writes plan only', mutated.ok===true && mutated.changed===true && mutated.settings.dailyKcal===1800 && !mutated.settings.meals);
  check('same mutation is not a second change', Logic.applyPlanMutation(mutated.settings, {type:'set_kcal_plan', windows:Logic.APPROVED_WINDOWS}).changed===false);
})();

(function sharedTarget(){
  var s=approvedSettings();
  var days=['2026-11-16','2026-11-17','2026-11-30','2026-12-01','2026-12-15','2026-12-16'];
  var targets=days.map(function(d){ return Logic.targetFor(s, d, {}); });
  check('series caption shows both eras', Logic.rangeCaption(targets)==='1,800／2,000–2,100／2,300–2,400');
  var inside=Logic.intakeStanding(2050, targets[1]);
  check('2050 is inside 2000-2100', inside.status==='in' && inside.roomToUpper===50 && inside.gapToLower===0 && inside.label==='2,000–2,100');
  check('inside is not treated as the midpoint goal', inside.statusLine.indexOf('2,050')<0 && inside.roomToUpper!==0);
  var under=Logic.intakeStanding(497, targets[1]);
  check('under reports gap to floor and room to ceiling', under.status==='under' && under.gapToLower===1503 && under.roomToUpper===1603);
  var over=Logic.intakeStanding(2200, targets[1]);
  check('over is past the ceiling', over.status==='over' && over.overBy===100 && Logic.exceedsTarget(2200, targets[1])===true);
  check('ceiling itself is not over', Logic.exceedsTarget(2100, targets[1])===false && Logic.intakeStanding(2100, targets[1]).status==='in');
  var old=Logic.intakeStanding(1801, targets[0]);
  check('old date still uses 1800', targets[0].label==='1,800' && old.status==='over' && old.overBy===1);
  check('ring uses the ceiling not the midpoint', Math.abs(Logic.ringFraction(2000, targets[1])-(2000/2100))<1e-9);
  var view=Logic.scheduleView(s, '2026-11-17');
  check('schedule marks current window', view.ok && view.rows.filter(function(r){return r.active;})[0].id==='kcal-2026-11-17');
  check('schedule marks historical row on Nov 16', Logic.scheduleView(s, '2026-11-16').rows[0].active===true);
  check('schedule marks return row on Dec 16', Logic.scheduleView(s, '2026-12-16').rows[Logic.scheduleView(s, '2026-12-16').rows.length-1].active===true);
})();

(function syncCopy(){
  var load=Logic.syncStatus({phase:'load', hasState:false});
  check('loading', load.chip==='載入緊' && load.banner==='');
  var offDirty=Logic.syncStatus({online:false, dirty:true, hasState:true});
  check('offline pending is not called synced', offDirty.tone==='offline' && offDirty.chip.indexOf('未上傳')>=0 && offDirty.chip.indexOf('已同步')<0);
  var offClean=Logic.syncStatus({online:false, dirty:false, hasState:true, phase:'ok', when:'11:00'});
  check('offline clean says last sync', offClean.tone==='offline' && offClean.banner.indexOf('上次成功同步')>=0);
  var pending=Logic.syncStatus({online:true, dirty:true, hasState:true, phase:'pending'});
  check('pending names the local hold', pending.tone==='pending' && pending.chip==='有改動未上傳');
  var http=Logic.syncStatus({online:true, dirty:true, hasState:true, httpStatus:503});
  check('http error is not called offline', http.tone==='error' && http.banner.indexOf('HTTP 503')>=0 && http.chip.indexOf('離線')<0);
  var timeout=Logic.syncStatus({online:true, dirty:true, hasState:true, timeout:true});
  check('timeout copy', timeout.tone==='error' && timeout.chip.indexOf('逾時')>=0);
  var busy=Logic.syncStatus({online:true, dirty:true, busy:true, hasState:true, phase:'syncing'});
  check('uploading is not success', busy.tone==='busy' && busy.chip==='上傳緊' && busy.banner.indexOf('未完成')>=0);
  var merge=Logic.syncStatus({online:true, dirty:true, hasState:true, phase:'merging'});
  check('merge is explicit', merge.chip==='合併緊');
  var ok=Logic.syncStatus({online:true, dirty:false, hasState:true, phase:'ok', when:'09:41'});
  check('clean success', ok.tone==='ok' && ok.chip==='已同步 09:41' && ok.banner==='');
  var cached=Logic.syncStatus({online:true, dirty:false, hasState:true, phase:'cached'});
  check('checking cloud is not a finished sync', cached.tone==='busy' && cached.banner.indexOf('核對')>=0);
})();

(function pageWiring(){
  var html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  check('page loads meal-logic', html.indexOf('meal-logic.js')>=0 && html.indexOf('MealLogic.targetFor')>=0);
  check('page resolves intake with the shared standing', html.indexOf('MealLogic.intakeStanding')>=0 && html.indexOf('MealLogic.ringFraction')>=0);
  check('charts receive the dated targets', html.indexOf('targets:dayTargets')>=0);
  check('service worker shells the logic file', fs.readFileSync(path.join(__dirname,'sw.js'),'utf8').indexOf('meal-logic\\.js')>=0);
})();

if(failed){
  console.error(failed+' failed');
  process.exit(1);
}
console.log('all meal-logic tests passed');

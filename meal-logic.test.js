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

function baseSettings(){
  return JSON.parse(JSON.stringify(LIVE));
}

(function boundaries(){
  var s=baseSettings();
  ['2026-11-16','2026-11-17','2026-11-30','2026-12-01','2026-12-15','2026-12-16'].forEach(function(d){
    ['gym','rest'].forEach(function(kind){
      var t=Logic.resolveTarget(s, d, kind==='rest');
      check(d+' '+kind+' target stays 1800', t.lower===1800 && t.upper===1800 && t.source==='baseline' && t.kind==='point' && t.label==='1,800');
    });
  });
  check('Nov 17 assumption is exactly 2100', (function(){ var a=Logic.assumedIntakeFor(s,'2026-11-17'); return a && a.lower===2100 && a.upper===2100 && a.source==='default'; })());
  check('Nov 30 still inside first assumption', Logic.assumedIntakeFor(s,'2026-11-30').lower===2100 && Logic.assumedIntakeFor(s,'2026-11-30').upper===2100);
  check('Dec 1 travel assumption is exactly 2400', Logic.assumedIntakeFor(s,'2026-12-01').lower===2400 && Logic.assumedIntakeFor(s,'2026-12-15').upper===2400);
  check('Nov 16 and Dec 16 have no assumption', Logic.assumedIntakeFor(s,'2026-11-16')===null && Logic.assumedIntakeFor(s,'2026-12-16')===null);
})();

(function timezone(){
  var s=baseSettings();
  check('HK date before Nov 17 midnight', Logic.hkToday(new Date('2026-11-16T15:59:59.000Z'))==='2026-11-16');
  check('HK date at Nov 17 midnight', Logic.hkToday(new Date('2026-11-16T16:00:00.000Z'))==='2026-11-17');
  check('HK date before Dec 1', Logic.hkToday(new Date('2026-11-30T15:59:59.000Z'))==='2026-11-30');
  check('HK date at Dec 1', Logic.hkToday(new Date('2026-11-30T16:00:00.000Z'))==='2026-12-01');
  check('HK date before Dec 16', Logic.hkToday(new Date('2026-12-15T15:59:59.000Z'))==='2026-12-15');
  check('HK date at Dec 16', Logic.hkToday(new Date('2026-12-15T16:00:00.000Z'))==='2026-12-16');
  check('instant before HK midnight has no assumption', Logic.assumedIntakeFor(s, new Date('2026-11-16T15:59:59.000Z'))===null);
  check('instant at HK midnight starts assumption', Logic.assumedIntakeFor(s, new Date('2026-11-16T16:00:00.000Z')).lower===2100);
  check('Dec 15 instant still assumed travel intake', Logic.assumedIntakeFor(s, new Date('2026-12-15T15:59:59.000Z')).upper===2400);
  check('Dec 16 instant returns to actual intake', Logic.assumedIntakeFor(s, new Date('2026-12-15T16:00:00.000Z'))===null);
  check('targets do not switch at the boundary', Logic.resolveTarget(s, new Date('2026-11-16T16:00:00.000Z'), false).label==='1,800');
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
  check('retired target command does not replace plan', bad.ok===false && kept.kcalPlan[0].lower===2000);
  var sneaky=Logic.applyPlanMutation(kept, {type:'replace_state', meals:[], windows:[]});
  check('non plan command rejected', sneaky.ok===false && sneaky.settings===kept);
  var extra=Logic.applyPlanMutation(kept, {type:'set_assumed_day', date:'2026-11-17', lower:2000, upper:2100, meals:[{kcal:1}]});
  check('meal field on assumption command rejected', extra.ok===false && !kept.assumedDays);
})();

(function persistence(){
  var originalMeals=[{id:'m1', date:'2026-11-01', items:[{name:'舊早餐', kcal:497, protein:42}]}];
  var before=JSON.parse(JSON.stringify(originalMeals));
  var settings=JSON.parse(JSON.stringify(LIVE));
  settings.journey={startWeight:80};
  settings.updatedAt='2026-11-01T00:00:00.000Z';
  var seeded=Logic.seedApprovedPlan(settings);
  check('fresh settings are not given the old target seed', seeded.changed===false && !settings.kcalPlan);
  check('seed keeps standing 1800', settings.dailyKcal===1800 && settings.restKcal===1800);
  check('seed does not invent meals', eq(originalMeals, before));
  settings.kcalPlan=JSON.parse(JSON.stringify(Logic.APPROVED_WINDOWS));
  settings.kcalPlanSeed='approved-2026-11';
  settings.proteinTarget=150;
  var migrated=Logic.migrateKnownTargetSeed(settings);
  check('known seed is retired', migrated.changed===true && settings.kcalPlan.length===0 && settings.kcalPlanSeed==='retired-assumed-intake' && settings.proteinTarget===150 && settings.dailyKcal===1800);
  check('migration is idempotent', Logic.migrateKnownTargetSeed(settings).changed===false);
  var edited=JSON.parse(JSON.stringify(LIVE));
  edited.kcalPlanSeed='approved-2026-11';
  edited.kcalPlan=[{id:'kcal-2026-11-17', start:'2026-11-17', end:'2026-11-30', lower:1900, upper:2100}];
  check('edited seed is left alone', Logic.migrateKnownTargetSeed(edited).changed===false && edited.kcalPlan[0].lower===1900);
  var legacy=JSON.parse(JSON.stringify(LIVE));
  legacy.workoutTypes=['跑步機'];
  legacy.goalKg=71;
  check('legacy settings still resolve old target', Logic.resolveTarget(legacy, '2026-11-16', false).label==='1,800');
  check('legacy Nov 17 also baseline before seed', Logic.resolveTarget(legacy, '2026-11-17', true).label==='1,800');
  var point=Logic.validatePlan([{start:'2026-01-01', end:'2026-01-02', kcal:1800}]);
  check('single stored number is a point range', point.ok===true && point.windows[0].lower===1800 && point.windows[0].upper===1800);
  var nested=Logic.validatePlan([{start:'2026-11-17', end:'2026-11-30', kcal:{lower:2000, upper:2100}}]);
  check('nested lower upper preserved', nested.ok===true && nested.windows[0].lower===2000 && nested.windows[0].upper===2100);
  var mutated=Logic.applyPlanMutation(legacy, {type:'set_assumed_day', date:'2026-11-20', lower:1800, upper:1900});
  check('day override writes only that day', mutated.ok===true && mutated.settings.assumedDays['2026-11-20'].lower===1800 && mutated.settings.dailyKcal===1800 && !mutated.settings.meals);
  check('retired target command stays rejected', Logic.applyPlanMutation(mutated.settings, {type:'set_kcal_plan', windows:Logic.APPROVED_WINDOWS}).ok===false);
})();

(function assumedDeficit(){
  var s=baseSettings();
  function done(extra){
    var spec={date:'2026-11-18', today:'2026-11-20', settings:s, actualKcal:641, hasDiary:true, mode:'tdee', tdee:9999, bmr:1600, neatPct:10, activitySource:'oura'};
    Object.keys(extra||{}).forEach(function(k){ spec[k]=extra[k]; });
    return Logic.dayBalance(spec);
  }
  var nov=done({date:'2026-11-17', ouraTotal:2500, ouraActive:400, workoutKcal:300, stepsKcal:200, stepsAlreadyNet:true});
  check('intake is exactly 2100 and diary is not added', nov.usesAssumption && nov.actualKcal===641 && nov.assumption.lower===2100 && nov.assumption.upper===2100 && nov.balance.text==='赤字 400');
  check('completed Oura total is used once', nov.include && nov.status==='completed' && nov.expenditure.kcal===2500 && nov.expenditure.source==='oura-total' && nov.expenditure.measured===true && nov.point===400);
  check('Oura total does not add the same workouts or steps', nov.expenditure.kcal!==2500+400+300+200 && nov.expenditure.note.indexOf('唔再加')>=0);
  check('stored TDEE does not override that day', nov.expenditure.source!=='setting' && nov.expenditure.kcal!==9999);
  check('assumption has no invented macros', nov.assumption.protein==null && nov.assumption.carb==null && nov.assumption.fat==null);
  var activeOnly=done({ouraTotal:0, ouraActive:400, workoutKcal:300, stepsKcal:200});
  check('Oura active plus BMR drops duplicate workouts', activeOnly.expenditure.kcal===2000 && activeOnly.expenditure.source==='bmr-plus-oura-active' && activeOnly.status==='estimate' && activeOnly.balance.text==='盈餘 100');
  var quiet=done({ouraTotal:0, ouraActive:0, stepsKcal:0, workoutKcal:0});
  check('zero steps and exercise stay an estimate', quiet.expenditure.kcal===1760 && quiet.status==='estimate' && quiet.include && quiet.balance.text==='盈餘 340' && quiet.expenditure.note.indexOf('冇步數')>=0);
  var walk=done({ouraTotal:0, ouraActive:0, stepsKcal:100, workoutKcal:0, stepsAlreadyNet:true});
  var walkMore=done({ouraTotal:0, ouraActive:0, stepsKcal:400, workoutKcal:80, stepsAlreadyNet:true});
  check('more steps and exercise change the deficit', walk.expenditure.kcal===1860 && walk.point===1860-2100 && walkMore.expenditure.kcal===2240 && walkMore.point===140 && walkMore.point-walk.point===380);
  var gross=done({ouraTotal:0, ouraActive:0, stepsKcal:300, treadmillStepsKcal:120, workoutKcal:150, stepsAlreadyNet:false});
  check('treadmill steps are removed once', gross.expenditure.kcal===Math.round(1600+160+(300-120)+150) && gross.expenditure.kcal!==Math.round(1600+160+300+150));
  var noOura=done({ouraTotal:0, ouraActive:0, bmr:0, stepsKcal:180, workoutKcal:90, tdee:2200});
  check('missing Oura and BMR is not a zero or the stored TDEE', noOura.include===false && noOura.balance===null && noOura.status==='insufficient' && noOura.expenditure.kcal==null);
  var estimateSource=done({activitySource:'estimate', ouraTotal:3000, ouraActive:800, stepsKcal:100, workoutKcal:0, stepsAlreadyNet:true});
  check('estimate source ignores Oura instead of adding it', estimateSource.expenditure.source==='components' && estimateSource.expenditure.kcal===1860 && estimateSource.expenditure.kcal!==3000);
  var live=Logic.dayBalance({date:'2026-11-17', today:'2026-11-17', settings:s, actualKcal:641, hasDiary:true, tdee:2200, bmr:1600, ouraTotal:1900, ouraActive:280, workoutKcal:160, stepsKcal:90, activitySource:'oura'});
  check('today Oura total is a forecast not a finished day', live.status==='partial' && live.include===false && live.point==null && live.expenditure.source==='oura-total-forecast' && live.expenditure.measured===false && live.expenditure.forecast===true && live.expenditure.kcal===1900 && live.expenditure.soFar===280 && live.balance.text==='盈餘 200');
  var partial=Logic.dayBalance({date:'2026-11-17', today:'2026-11-17', settings:s, tdee:2200, bmr:1600, neatPct:10, ouraTotal:0, ouraActive:0, stepsKcal:100, workoutKcal:50, activitySource:'oura', actualKcal:10, hasDiary:true});
  check('today without Oura total is an unfinished estimate', partial.status==='partial' && partial.include===false && partial.expenditure.source==='partial-estimate' && partial.expenditure.kcal===1910 && partial.expenditure.note.indexOf('未完結')>=0);
  var later=Logic.dayBalance({date:'2026-12-08', today:'2026-11-17', settings:s, actualKcal:0, hasDiary:false, tdee:2200, bmr:1600, ouraTotal:3000, ouraActive:400});
  check('future day has no measured deficit', later.assumption.upper===2400 && later.status==='future' && later.include===false && later.balance===null && later.expenditure.kcal==null);
  var travel=done({date:'2026-12-08', today:'2026-12-20', ouraTotal:2200, ouraActive:100, workoutKcal:50, stepsKcal:40});
  check('travel surplus uses that day and is not zeroed', travel.assumption.lower===2400 && travel.balance.kind==='surplus' && travel.balance.text==='盈餘 200' && travel.include===true);
  check('Dec 1 and Dec 15 stay on 2400', done({date:'2026-12-01', today:'2026-12-20', ouraTotal:2600}).balance.text==='赤字 200' && done({date:'2026-12-15', today:'2026-12-20', ouraTotal:2400}).balance.text==='打和');
  var prior=Logic.dayBalance({date:'2026-11-16', today:'2026-11-20', settings:s, actualKcal:1700, hasDiary:true, mode:'tdee', tdee:1800, burn:0, ouraTotal:5000, ouraActive:400});
  check('16 Nov uses actual intake deficit', !prior.usesAssumption && prior.point===100 && prior.balance.text==='赤字 100');
  var after=Logic.dayBalance({date:'2026-12-16', today:'2026-12-20', settings:s, actualKcal:1700, hasDiary:true, mode:'tdee', tdee:1800, burn:200, ouraTotal:5000});
  check('16 Dec returns to actual diaries', !after.usesAssumption && after.point===300 && after.point!==5000-1700);
  check('blank prior day is not invented', Logic.dayBalance({date:'2026-11-10', today:'2026-11-20', settings:s, actualKcal:0, hasDiary:false, mode:'tdee', tdee:1800}).include===false);
  check('a day without today is not called complete', Logic.dayBalance({date:'2026-11-18', settings:s, ouraTotal:2500, bmr:1600, actualKcal:1, hasDiary:true}).include===false);
  var custom=baseSettings();
  custom.assumedDays={'2026-11-17':{useActual:true}};
  var used=Logic.dayBalance({date:'2026-11-17', today:'2026-11-20', settings:custom, actualKcal:641, hasDiary:true, mode:'tdee', tdee:2500, burn:0, ouraTotal:1900});
  check('explicit actual override does not add assumption', !used.usesAssumption && used.point===1859);
  custom.assumedDays={'2026-11-20':{lower:1800, upper:1900}};
  var own=Logic.dayBalance({date:'2026-11-20', today:'2026-11-21', settings:custom, actualKcal:50, hasDiary:true, mode:'tdee', tdee:2500, ouraTotal:2500, ouraActive:100, workoutKcal:80, stepsKcal:40, bmr:1600});
  check('explicit day range replaces default', own.assumption.source==='day' && own.balance.text==='赤字 600–700' && own.expenditure.kcal===2500);
  check('two different days do not share one burn', nov.point+travel.point===200);
  var sched=Logic.assumptionSchedule(s, '2026-11-17');
  check('schedule names the exact intake', sched.rows.filter(function(r){return r.active;})[0].label==='預設已攝取 2,100');
  check('goal ring against 1800 still sees actual overage', Logic.intakeStanding(1801, Logic.targetFor(s,'2026-11-16',{})).status==='over');
  var again=Logic.resolveExpenditure({date:'2026-11-18', today:'2026-11-20', activitySource:'oura', ouraTotal:2500, ouraActive:400, workoutKcal:300, stepsKcal:200, bmr:1600, tdee:9999});
  check('expenditure helper matches the day balance', again.kcal===nov.expenditure.kcal && again.source===nov.expenditure.source);
})();

(function sharedTarget(){
  var s=baseSettings();
  var goal=Logic.targetFor(s, '2026-11-17', {});
  check('standing target is not the assumption', goal.label==='1,800');
  check('assumption label is the single intake', Logic.assumedIntakeFor(s,'2026-11-17').label==='2,100' && Logic.assumedIntakeFor(s,'2026-12-01').label==='2,400');
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
  check('today, history, charts and report share diaryBalance', html.indexOf('function diaryBalance')>=0 && html.indexOf('function balanceOf')>=0 && html.split('diaryBalance(').length>=8);
  check('balance receives that day activity fields', html.indexOf('today:today()')>=0 && html.indexOf('ouraActive:')>=0 && html.indexOf('stepsKcal:')>=0 && html.indexOf('workoutKcal:')>=0 && html.indexOf('stepsAlreadyNet:true')>=0);
  check('page names 2100 and 2400', html.indexOf('2,100')>=0 && html.indexOf('2,400')>=0 && html.indexOf('2,000–2,100')<0 && html.indexOf('2,300–2,400')<0);
})();

if(failed){
  console.error(failed+' failed');
  process.exit(1);
}
console.log('all meal-logic tests passed');

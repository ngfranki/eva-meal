/* Assumed intake for deficit, standing calorie targets, and sync labels.
   Assumed intake never rewrites meals, macros, or diary totals. */
(function(root, factory){
  var api = factory();
  if(typeof module==='object' && module.exports) module.exports = api;
  if(root) root.MealLogic = api;
})(typeof globalThis!=='undefined' ? globalThis : this, function(){
  var HK = 'Asia/Hong_Kong';
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var SEED_ID = 'approved-2026-11';
  var MIGRATED_SEED = 'retired-assumed-intake';
  var APPROVED_WINDOWS = [
    {id:'kcal-2026-11-17', start:'2026-11-17', end:'2026-11-30', lower:2000, upper:2100},
    {id:'kcal-2026-12-01', start:'2026-12-01', end:'2026-12-15', lower:2300, upper:2400}
  ];
  var ASSUMED_DEFAULTS = [
    {id:'assume-2026-11-17', start:'2026-11-17', end:'2026-11-30', lower:2000, upper:2100},
    {id:'assume-2026-12-01', start:'2026-12-01', end:'2026-12-15', lower:2300, upper:2400}
  ];

  function pad(n){ return (n<10?'0':'')+n; }
  function clone(v){ return v==null ? v : JSON.parse(JSON.stringify(v)); }
  function isObj(v){ return !!v && typeof v==='object' && !Array.isArray(v); }

  function hkParts(now){
    var d = now instanceof Date ? now : new Date(now);
    if(!(d instanceof Date) || isNaN(d.getTime())) return null;
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: HK, hourCycle: 'h23',
      year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit'
    });
    var parts = {};
    fmt.formatToParts(d).forEach(function(p){ if(p.type!=='literal') parts[p.type]=p.value; });
    var hour = parts.hour==='24' ? '00' : parts.hour;
    return {date: parts.year+'-'+parts.month+'-'+parts.day, time: hour+':'+parts.minute};
  }
  function hkToday(now){ var p=hkParts(now==null?new Date():now); return p?p.date:null; }
  function hkClock(now){ var p=hkParts(now==null?new Date():now); return p?p.time:null; }

  function isDate(s){
    if(typeof s!=='string' || !DATE_RE.test(s)) return false;
    var p=s.split('-'), y=+p[0], m=+p[1], d=+p[2];
    var dt=new Date(Date.UTC(y, m-1, d));
    return dt.getUTCFullYear()===y && dt.getUTCMonth()===m-1 && dt.getUTCDate()===d;
  }
  function addDays(s, n){
    if(!isDate(s)) return null;
    var p=s.split('-');
    var dt=new Date(Date.UTC(+p[0], +p[1]-1, +p[2]));
    dt.setUTCDate(dt.getUTCDate()+n);
    return dt.getUTCFullYear()+'-'+pad(dt.getUTCMonth()+1)+'-'+pad(dt.getUTCDate());
  }
  function weekday(s){
    if(!isDate(s)) return null;
    var p=s.split('-');
    return new Date(Date.UTC(+p[0], +p[1]-1, +p[2])).getUTCDay();
  }
  function shortDate(s){
    if(!isDate(s)) return '';
    return (+s.slice(5,7))+'/'+(+s.slice(8));
  }
  function formatKcal(n){ return Number(n).toLocaleString('en-US'); }
  function formatRange(lower, upper){
    if(lower==null || upper==null) return '';
    if(lower===upper) return formatKcal(lower);
    return formatKcal(lower)+'–'+formatKcal(upper);
  }

  function kcalInt(v){
    if(typeof v==='string'){
      var t=v.trim();
      if(!/^\d+$/.test(t)) return null;
      v=+t;
    }
    if(typeof v!=='number' || !isFinite(v) || v<=0 || Math.round(v)!==v) return null;
    return v;
  }

  function readPair(raw, label){
    if(!isObj(raw)) return {error:label+'要有下限同上限'};
    var hasL=raw.lower!=null && raw.lower!=='';
    var hasU=raw.upper!=null && raw.upper!=='';
    if(!hasL && !hasU && raw.kcal!=null && typeof raw.kcal!=='object'){
      var point=kcalInt(raw.kcal);
      if(point==null) return {error:label+'要係正整數'};
      return {lower:point, upper:point};
    }
    if(isObj(raw.kcal) && !hasL && !hasU){
      hasL=raw.kcal.lower!=null && raw.kcal.lower!=='';
      hasU=raw.kcal.upper!=null && raw.kcal.upper!=='';
      raw={lower:raw.kcal.lower, upper:raw.kcal.upper};
    }
    if(!hasL || !hasU) return {error:label+'要同時填下限同上限'};
    var lower=kcalInt(raw.lower), upper=kcalInt(raw.upper);
    if(lower==null || upper==null) return {error:label+'要係正整數'};
    if(lower>upper) return {error:label+'下限唔可以大過上限'};
    return {lower:lower, upper:upper};
  }

  function optionalOverride(raw, key, label){
    var nested=isObj(raw[key]) ? raw[key] : null;
    var lk=key+'Lower', uk=key+'Upper';
    var flatL=raw[lk]!=null && raw[lk]!=='';
    var flatU=raw[uk]!=null && raw[uk]!=='';
    if(!nested && !flatL && !flatU) return {missing:true};
    var src=nested || {lower:raw[lk], upper:raw[uk]};
    var pair=readPair(src, label);
    if(pair.error) return pair;
    return {lower:pair.lower, upper:pair.upper};
  }

  function validatePlan(input){
    if(input==null) return {ok:true, windows:[], errors:[], unset:true};
    if(!Array.isArray(input)) return {ok:false, windows:null, errors:['分段目標要係清單']};
    var errors=[], windows=[];
    input.forEach(function(raw, index){
      var n=index+1;
      if(!isObj(raw)){ errors.push('第 '+n+' 段格式唔啱'); return; }
      var start=typeof raw.start==='string' ? raw.start.trim() : raw.start;
      var end=raw.end==null || raw.end==='' ? null : (typeof raw.end==='string' ? raw.end.trim() : raw.end);
      if(!isDate(start)) errors.push('第 '+n+' 段開始日期唔啱');
      if(end!=null && !isDate(end)) errors.push('第 '+n+' 段結束日期唔啱');
      if(isDate(start) && end && isDate(end) && end<start) errors.push('第 '+n+' 段結束早過開始');
      var base=readPair(raw, '第 '+n+' 段');
      if(base.error) errors.push(base.error);
      var gym=optionalOverride(raw, 'gym', '第 '+n+' 段運動日');
      var rest=optionalOverride(raw, 'rest', '第 '+n+' 段休息日');
      if(gym.error) errors.push(gym.error);
      if(rest.error) errors.push(rest.error);
      if(errors.length) return;
      var row={
        id: typeof raw.id==='string' && raw.id ? raw.id : ('kcal-'+start),
        start:start,
        end:end,
        lower:base.lower,
        upper:base.upper
      };
      if(!gym.missing) row.gym={lower:gym.lower, upper:gym.upper};
      if(!rest.missing) row.rest={lower:rest.lower, upper:rest.upper};
      windows.push(row);
    });
    if(errors.length) return {ok:false, windows:null, errors:errors};
    windows.sort(function(a,b){ return a.start<b.start ? -1 : (a.start>b.start ? 1 : (a.end||'9999-99-99')<(b.end||'9999-99-99') ? -1 : 1); });
    for(var i=1;i<windows.length;i++){
      var prev=windows[i-1], next=windows[i];
      if(prev.end==null || next.start<=prev.end){
        errors.push(shortDate(prev.start)+'–'+(prev.end?shortDate(prev.end):'之後')+' 同 '+shortDate(next.start)+' 重疊');
      }
    }
    if(errors.length) return {ok:false, windows:null, errors:errors};
    return {ok:true, windows:windows, errors:[]};
  }

  function baselineNumber(settings, isRest){
    var s=settings||{};
    var gym=kcalInt(s.dailyKcal);
    var rest=kcalInt(s.restKcal);
    if(isRest && rest!=null) return rest;
    return gym;
  }
  function baselineLabel(settings){
    var gym=baselineNumber(settings, false);
    var rest=baselineNumber(settings, true);
    if(gym==null && rest==null) return '未設定';
    if(gym!=null && rest!=null && gym===rest) return formatKcal(gym)+'（運動日同休息日）';
    return '運動日 '+(gym==null?'未設定':formatKcal(gym))+'／休息日 '+(rest==null?'未設定':formatKcal(rest));
  }

  function emptyTarget(date, isRest){
    return {date:date||null, lower:null, upper:null, kind:'none', source:'none', dayType:isRest?'rest':'gym', window:null, label:''};
  }
  function pack(lower, upper, date, isRest, source, win){
    if(lower==null || upper==null) return emptyTarget(date, isRest);
    return {
      date:date,
      lower:lower,
      upper:upper,
      kind: lower===upper ? 'point' : 'range',
      source:source,
      dayType:isRest?'rest':'gym',
      window: win ? {id:win.id, start:win.start, end:win.end} : null,
      label: formatRange(lower, upper)
    };
  }

  function civilDate(dateOrInstant){
    if(dateOrInstant instanceof Date) return hkToday(dateOrInstant);
    return dateOrInstant;
  }

  function resolveTarget(settings, dateOrInstant, isRest){
    var date=civilDate(dateOrInstant);
    if(!isDate(date)) return emptyTarget(date, !!isRest);
    var s=settings||{};
    var stored=s.kcalPlan;
    var validated = Array.isArray(stored) ? validatePlan(stored) : (stored==null ? {ok:true, windows:[]} : {ok:false, windows:null});
    var base=baselineNumber(s, !!isRest);
    if(!validated.ok) return pack(base, base, date, !!isRest, 'baseline', null);
    var hit=null;
    (validated.windows||[]).forEach(function(w){
      if(w.start<=date && (w.end==null || date<=w.end)) hit=w;
    });
    if(!hit) return pack(base, base, date, !!isRest, 'baseline', null);
    var range = !!isRest && hit.rest ? hit.rest : (!isRest && hit.gym ? hit.gym : {lower:hit.lower, upper:hit.upper});
    return pack(range.lower, range.upper, date, !!isRest, 'plan', hit);
  }

  function isRestDay(date, settings, dayType){
    if(!isDate(date)) return false;
    var ov=dayType && dayType[date];
    if(ov==='rest') return true;
    if(ov==='gym') return false;
    var dow=weekday(date);
    var rd=String((settings&&settings.restDays)||'').split(',').map(function(x){ return parseInt(x,10); });
    return rd.indexOf(dow)>=0;
  }
  function targetFor(settings, dateOrInstant, dayType){
    var date=civilDate(dateOrInstant);
    return resolveTarget(settings, date, isRestDay(date, settings, dayType));
  }

  function intakeStanding(intake, target){
    var kcal=Math.round(Number(intake)||0);
    if(!target || target.lower==null || target.upper==null){
      return {status:'none', intake:kcal, lower:null, upper:null, gapToLower:null, roomToUpper:null, overBy:null, label:'', statusLine:'未設定目標', detail:''};
    }
    var lo=target.lower, hi=target.upper;
    var status = kcal<lo ? 'under' : (kcal>hi ? 'over' : 'in');
    var gap=Math.max(0, lo-kcal);
    var room=hi-kcal;
    var over=Math.max(0, kcal-hi);
    var statusLine, detail='';
    if(lo===hi){
      if(status==='over') statusLine='超出 '+formatKcal(over);
      else if(kcal===lo) statusLine='啱好目標';
      else statusLine='仲剩 '+formatKcal(room);
    } else if(status==='under'){
      statusLine='未到下限，仲差 '+formatKcal(gap);
      detail='上限仲剩 '+formatKcal(room);
    } else if(status==='over'){
      statusLine='超出上限 '+formatKcal(over);
    } else if(kcal===hi){
      statusLine='喺範圍內，去到上限';
    } else {
      statusLine='喺範圍內';
      detail='距上限仲剩 '+formatKcal(room);
    }
    return {status:status, intake:kcal, lower:lo, upper:hi, gapToLower:gap, roomToUpper:room, overBy:over, label:formatRange(lo, hi), statusLine:statusLine, detail:detail};
  }
  function exceedsTarget(intake, target){
    if(!target || target.upper==null) return false;
    return Number(intake)>target.upper;
  }
  function ringFraction(intake, target){
    if(!target || !target.upper) return 0;
    return Math.max(0, Number(intake)||0)/target.upper;
  }

  function kcalNum(v){
    if(typeof v==='string'){
      var t=v.trim();
      if(t==='' || isNaN(+t)) return null;
      v=+t;
    }
    if(typeof v!=='number' || !isFinite(v) || v<=0) return null;
    return v;
  }
  function windowOn(windows, date){
    var hit=null;
    (windows||[]).forEach(function(w){
      if(w && w.start<=date && (w.end==null || date<=w.end)) hit=w;
    });
    return hit;
  }
  function dayOverride(settings, date){
    var days=settings && settings.assumedDays;
    if(!isObj(days) || !isObj(days[date])) return null;
    var row=days[date];
    if(row.useActual===true) return {useActual:true};
    var pair=readPair(row, '呢日預設已攝取');
    if(pair.error) return {invalid:true, error:pair.error};
    return {lower:pair.lower, upper:pair.upper, source:'day'};
  }
  function assumedIntakeFor(settings, dateOrInstant){
    var date=civilDate(dateOrInstant);
    if(!isDate(date)) return null;
    var s=settings||{};
    var over=dayOverride(s, date);
    if(over && over.useActual) return null;
    if(over && over.lower!=null) return {date:date, lower:over.lower, upper:over.upper, source:'day', label:formatRange(over.lower, over.upper)};
    if(over && over.invalid) return null;
    var custom=s.assumedIntake, windows, source;
    if(Array.isArray(custom)){
      var checked=validatePlan(custom);
      if(!checked.ok) return null;
      windows=checked.windows;
      source='schedule';
    } else if(custom==null){
      windows=ASSUMED_DEFAULTS;
      source='default';
    } else return null;
    var hit=windowOn(windows, date);
    if(!hit) return null;
    return {date:date, lower:hit.lower, upper:hit.upper, source:source, start:hit.start, end:hit.end, id:hit.id, label:formatRange(hit.lower, hit.upper)};
  }
  function balanceFrom(tdee, intakeLower, intakeUpper){
    var lower=Math.round(tdee-intakeUpper);
    var upper=Math.round(tdee-intakeLower);
    if(lower>upper){ var swap=lower; lower=upper; upper=swap; }
    var kind, text;
    if(upper<0){
      kind='surplus';
      text='盈餘 '+formatKcal(-upper)+(lower===upper?'':'–'+formatKcal(-lower));
    } else if(lower>0){
      kind='deficit';
      text='赤字 '+formatKcal(lower)+(lower===upper?'':'–'+formatKcal(upper));
    } else if(lower===0 && upper===0){
      kind='even';
      text='打和';
    } else if(lower<0 && upper>0){
      kind='mixed';
      text='盈餘 '+formatKcal(-lower)+' 至 赤字 '+formatKcal(upper);
    } else if(lower===0){
      kind='deficit';
      text=upper===0?'打和':'赤字 0–'+formatKcal(upper);
    } else {
      kind='surplus';
      text='盈餘 0–'+formatKcal(-lower);
    }
    return {lower:lower, upper:upper, kind:kind, text:text};
  }
  function pointBalance(value){
    var n=Math.round(value);
    return balanceFrom(0, -n, -n);
  }
  function fullDayTdee(spec){
    spec=spec||{};
    var setting=kcalNum(spec.tdee);
    if(setting!=null){
      return {kcal:setting, source:'setting', measured:false, label:'設定嘅全日 TDEE', note:'設定嘅全日數，唔係截至而家量到嘅消耗。'};
    }
    var forecast=kcalNum(spec.ouraTotal);
    if(forecast!=null){
      return {kcal:forecast, source:'oura-forecast', measured:false, label:'Oura 全日總消耗預測', note:'全日預測，由日初已計入基礎代謝，唔係已經燒掉嘅量度。'};
    }
    var bmr=kcalNum(spec.bmr);
    if(bmr!=null){
      var pct=spec.neatPct==null || spec.neatPct==='' ? 0 : Number(spec.neatPct);
      if(!isFinite(pct)) pct=0;
      return {kcal:Math.round(bmr+bmr*pct/100), source:'bmr-baseline', measured:false, label:'BMR 加日常活動% 嘅全日基線', note:'未包括今日額外活動。未完結嘅活動消耗唔當全日 TDEE。'};
    }
    return {kcal:null, source:'missing', measured:false, label:'未有全日 TDEE', note:'冇設定 TDEE、BMR 或 Oura 全日預測，所以唔計赤字，亦唔當 0。'};
  }
  function actualPointDeficit(spec){
    var intake=+spec.actualKcal||0;
    var burn=+spec.burn||0;
    var bmr=+spec.bmr||0;
    if(spec.mode==='bmr' && bmr>0){
      var neat=spec.useOura ? 0 : bmr*((+spec.neatPct||0)/100);
      return bmr + neat + intake*0.10 + burn - intake;
    }
    var tdee=(+spec.tdee>0)?+spec.tdee:2300;
    return tdee + burn - intake;
  }
  function dayBalance(spec){
    spec=spec||{};
    var actual=Math.round(+spec.actualKcal||0);
    var assumption=assumedIntakeFor(spec.settings, spec.date);
    if(assumption){
      var tdee=fullDayTdee(spec);
      if(tdee.kcal==null){
        return {usesAssumption:true, include:false, actualKcal:actual, assumption:assumption, tdee:tdee, balance:null, point:null};
      }
      return {usesAssumption:true, include:true, actualKcal:actual, assumption:assumption, tdee:tdee, balance:balanceFrom(tdee.kcal, assumption.lower, assumption.upper), point:null};
    }
    if(!spec.hasDiary){
      return {usesAssumption:false, include:false, actualKcal:actual, assumption:null, tdee:null, balance:null, point:null};
    }
    var point=actualPointDeficit(spec);
    return {usesAssumption:false, include:true, actualKcal:actual, assumption:null, tdee:null, balance:pointBalance(point), point:Math.round(point)};
  }
  function assumptionSchedule(settings, date){
    var s=settings||{};
    var usingDefault=!Array.isArray(s.assumedIntake);
    var checked=usingDefault ? {ok:true, windows:ASSUMED_DEFAULTS} : validatePlan(s.assumedIntake);
    if(!checked.ok) return {ok:false, rows:[], summary:checked.errors.join(' ')};
    var rows=[];
    if(!checked.windows.length){
      return {ok:true, rows:[{id:'actual', when:'每一日', label:'用實際記錄計赤字', active:true}], summary:'冇預設已攝取，赤字用實際記錄。目標仍係原本 '+baselineLabel(s)};
    }
    var first=checked.windows[0].start;
    rows.push({id:'before', when:shortDate(first)+' 之前', label:'用實際記錄計赤字', active:isDate(date)&&date<first});
    checked.windows.forEach(function(w){
      var active=isDate(date) && w.start<=date && (w.end==null || date<=w.end);
      rows.push({id:w.id, when:shortDate(w.start)+'–'+(w.end?shortDate(w.end):'之後'), label:'預設已攝取 '+formatRange(w.lower, w.upper), active:active});
    });
    var last=checked.windows[checked.windows.length-1];
    if(last.end) rows.push({id:'after', when:shortDate(addDays(last.end,1))+' 起', label:'返實際記錄計赤字，目標仍係 '+baselineLabel(s), active:isDate(date)&&date>last.end});
    var summary=checked.windows.map(function(w){
      return shortDate(w.start)+'–'+(w.end?shortDate(w.end):'之後')+' 預設已攝取 '+formatRange(w.lower, w.upper);
    }).join('；')+'。其他日子用實際記錄。目標維持 '+baselineLabel(s)+'。';
    return {ok:true, rows:rows, summary:summary, usingDefault:usingDefault};
  }
  function migrateKnownTargetSeed(settings){
    if(!isObj(settings)) settings={};
    if(settings.kcalPlanSeed!==SEED_ID) return {changed:false, settings:settings};
    if(!sameWindows(settings.kcalPlan, APPROVED_WINDOWS)) return {changed:false, settings:settings};
    settings.kcalPlan=[];
    settings.kcalPlanSeed=MIGRATED_SEED;
    return {changed:true, settings:settings};
  }
  function seedApprovedPlan(settings){
    return migrateKnownTargetSeed(settings);
  }
  function validateDayAssumption(lower, upper){
    return readPair({lower:lower, upper:upper}, '呢日預設已攝取');
  }

  function sameWindows(a, b){
    var A=validatePlan(a||[]), B=validatePlan(b||[]);
    if(!A.ok || !B.ok) return false;
    return JSON.stringify(A.windows)===JSON.stringify(B.windows);
  }

  function applyPlanMutation(settings, action){
    var current=isObj(settings)?settings:{};
    if(!isObj(action)) return {ok:false, changed:false, errors:['未認可嘅指令'], settings:current};
    if(action.type==='set_kcal_plan') return {ok:false, changed:false, errors:['分段目標指令已停用，唔會改目標或餐單'], settings:current};
    if(action.type!=='set_assumed_day') return {ok:false, changed:false, errors:['未認可嘅指令'], settings:current};
    var allowed={type:1, date:1, useActual:1, clear:1, lower:1, upper:1};
    var extra=Object.keys(action).filter(function(k){ return !allowed[k]; });
    if(extra.length) return {ok:false, changed:false, errors:['指令含有唔受允許嘅欄位'], settings:current};
    if(!isDate(action.date)) return {ok:false, changed:false, errors:['日期唔啱'], settings:current};
    var next=clone(current);
    if(!isObj(next.assumedDays)) next.assumedDays={};
    if(action.useActual===true) next.assumedDays[action.date]={useActual:true};
    else if(action.clear===true) delete next.assumedDays[action.date];
    else {
      var pair=readPair(action, '呢日預設已攝取');
      if(pair.error) return {ok:false, changed:false, errors:[pair.error], settings:current};
      next.assumedDays[action.date]={lower:pair.lower, upper:pair.upper};
    }
    return {ok:true, changed:true, errors:[], settings:next};
  }

  function scheduleView(settings, date){
    var s=settings||{};
    var stored=Array.isArray(s.kcalPlan)?s.kcalPlan:(s.kcalPlan==null?[]:null);
    if(stored==null){
      return {ok:false, rows:[], summary:'分段目標未能讀取，暫用原本每日目標', baseline:baselineLabel(s)};
    }
    var checked=validatePlan(stored);
    var base=baselineLabel(s);
    if(!checked.ok){
      return {ok:false, rows:[], summary:checked.errors.join(' '), baseline:base, errors:checked.errors};
    }
    if(!checked.windows.length){
      return {ok:true, rows:[{id:'baseline', when:'每一日', label:'原本目標 '+base, active:true}], summary:'冇分段目標，用原本目標 '+base, baseline:base};
    }
    var rows=[];
    var first=checked.windows[0].start;
    rows.push({id:'before', when:shortDate(first)+' 之前', label:'原本目標 '+base, active:isDate(date)&&date<first});
    checked.windows.forEach(function(w){
      var when=shortDate(w.start)+'–'+(w.end?shortDate(w.end):'之後');
      var label=formatRange(w.lower, w.upper);
      if(w.gym||w.rest){
        label+='；運動日 '+(w.gym?formatRange(w.gym.lower, w.gym.upper):formatRange(w.lower, w.upper));
        label+='／休息日 '+(w.rest?formatRange(w.rest.lower, w.rest.upper):formatRange(w.lower, w.upper));
      }
      var active=isDate(date) && w.start<=date && (w.end==null || date<=w.end);
      rows.push({id:w.id, when:when, label:label, active:active});
    });
    var last=checked.windows[checked.windows.length-1];
    if(last.end){
      rows.push({id:'after', when:shortDate(addDays(last.end,1))+' 起', label:'返原本目標 '+base, active:isDate(date)&&date>last.end});
    }
    var summary=checked.windows.map(function(w){
      return shortDate(w.start)+'–'+(w.end?shortDate(w.end):'之後')+' '+formatRange(w.lower, w.upper);
    }).join('；')+'。其他日子用原本目標 '+base;
    return {ok:true, rows:rows, summary:summary, baseline:base};
  }

  function rangeCaption(targets){
    var labels=[];
    (targets||[]).forEach(function(t){
      var lb=t && t.label ? t.label : '—';
      if(labels.indexOf(lb)<0) labels.push(lb);
    });
    if(!labels.length) return '—';
    return labels.join('／');
  }

  function syncStatus(m){
    m=m||{};
    var when=m.when||'';
    if((m.phase==='load' || m.phase==='boot') && !m.hasState) return {tone:'busy', chip:'載入緊', banner:''};
    if(m.busy || m.phase==='syncing') return {tone:'busy', chip:'上傳緊', banner:m.dirty?'改動上傳緊，未完成。':''};
    if(m.phase==='merging') return {tone:'busy', chip:'合併緊', banner:'兩邊都有改動，合併緊，未完成前唔當已同步。'};
    if(m.online===false){
      if(m.dirty) return {tone:'offline', chip:'離線 · 未上傳', banner:'而家離線。呢部機嘅改動未上傳，有網會再試。'};
      return {tone:'offline', chip:'離線', banner:'而家離線，顯示上次成功同步嘅資料。'};
    }
    if(m.timeout && m.dirty) return {tone:'error', chip:'逾時 · 未上傳', banner:'上傳逾時。改動仲喺呢部機，會再試。'};
    if(m.httpStatus && m.dirty) return {tone:'error', chip:'上傳失敗 · 未上傳', banner:'伺服器回應 HTTP '+m.httpStatus+'。改動仲喺呢部機，會再試。'};
    if((m.phase==='retry' || m.phase==='error') && m.dirty) return {tone:'pending', chip:'未同步 · 再試緊', banner:'本地改動未上傳，會再試。'};
    if(m.dirty) return {tone:'pending', chip:'有改動未上傳', banner:'改動留喺呢部機，等緊上傳。'};
    if(m.phase==='empty') return {tone:'ok', chip:'未有雲端紀錄', banner:''};
    if(m.phase==='cached') return {tone:'busy', chip:'核對緊', banner:'顯示上次成功同步嘅資料，正在向雲端核對。'};
    return {tone:'ok', chip: when?('已同步 '+when):'已同步', banner:''};
  }

  return {
    HK: HK,
    SEED_ID: SEED_ID,
    MIGRATED_SEED: MIGRATED_SEED,
    APPROVED_WINDOWS: APPROVED_WINDOWS,
    ASSUMED_DEFAULTS: ASSUMED_DEFAULTS,
    hkToday: hkToday,
    hkClock: hkClock,
    isDate: isDate,
    addDays: addDays,
    weekday: weekday,
    shortDate: shortDate,
    formatRange: formatRange,
    validatePlan: validatePlan,
    baselineLabel: baselineLabel,
    resolveTarget: resolveTarget,
    isRestDay: isRestDay,
    targetFor: targetFor,
    intakeStanding: intakeStanding,
    exceedsTarget: exceedsTarget,
    ringFraction: ringFraction,
    seedApprovedPlan: seedApprovedPlan,
    migrateKnownTargetSeed: migrateKnownTargetSeed,
    assumedIntakeFor: assumedIntakeFor,
    fullDayTdee: fullDayTdee,
    balanceFrom: balanceFrom,
    dayBalance: dayBalance,
    assumptionSchedule: assumptionSchedule,
    validateDayAssumption: validateDayAssumption,
    actualPointDeficit: actualPointDeficit,
    sameWindows: sameWindows,
    applyPlanMutation: applyPlanMutation,
    scheduleView: scheduleView,
    rangeCaption: rangeCaption,
    syncStatus: syncStatus
  };
});

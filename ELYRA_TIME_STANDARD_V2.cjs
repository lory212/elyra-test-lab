'use strict';
/* ELYRA Time Standard V2: regression only. No writes to user saves or changes to C4 engine.
   Usage: node ELYRA_TIME_STANDARD_V2.cjs from repo root. */
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
const FILE = 'ELYRA_0_17_THREE_SLOTS_PLAYABLE_C4_SCHOOL_CLOCK_LAB.html';
const REPORT = path.join(__dirname,'artifacts','ELYRA_TIME_STANDARD_V2_REPORT.json');
const checks=[];
const t=(id,title,fn)=>{
  try { const evidence=fn(); checks.push({id,title,result:'PASS',evidence:evidence??null});console.log(`PASS ${id} — ${title}`); }
  catch(err){checks.push({id,title,result:'FAIL',error:err.stack||String(err)});console.error(`FAIL ${id} — ${title}: ${err.message}`);}
};
let e,html;
try {
 html=fs.readFileSync(path.join(__dirname,FILE),'utf8');
 const bundle=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(s=>s.includes('const modules=')&&s.includes("require('ui.mjs')"));
 assert.ok(bundle,'bundle from original game not present');
 const ctx={window:{},crypto:webcrypto,console};
 vm.runInNewContext(bundle.replace("require('ui.mjs');",''),ctx,{timeout:10000,filename:'elyra-c4-bundle.js'});
 e=ctx.window.__elyraLabEngine;
 assert.ok(e,'original ELYRA engine not exported');
} catch(err){checks.push({id:'BOOT',title:'Load original C4 embedded engine',result:'FAIL',error:String(err)});}
const nw=()=>e.createWorld(17);
const mm=w=>w.t%1440;
const school745=()=>{const w=nw();assert.equal(e.advance(w,40),40);e.perform(w,{type:'travel',to:'school'});assert.equal(mm(w),465);return w;};
const drive=(w,target)=>{
 let loops=0,calls=0;
 while(w.t<target&&loops++<500){
  const before=w.t;
  e.advance(w,target-w.t);
  if(w.call){e.answerCall(w,false);calls++;continue;}
  if(w.conversation||w.active)throw new Error('Unresolved decision or activity');
  if(w.t<=before)throw new Error(`No progress at ${w.t}`);
 }
 assert.equal(w.t,target,`Target time not reached (${w.t} vs ${target})`);
 return {calls,loops};
};
const dayJump=w=>{
 e.startTimeAdvance(w,1440);let k=0;
 while(w.timeAdvance?.status==='running'&&k++<350){
  const old=w.t;e.runTimeAdvance(w,{boundaries:128});
  if(w.timeAdvance?.status==='running'&&w.t<=old)throw new Error('Nonprogressive day jump');
 }
 assert.equal(w.timeAdvance?.status,'completed','day jump not completed');
};
if(e){
 t('CLOCK-01','Minutes are the sole integer clock unit',()=>{const w=nw();assert.equal(w.t,405);assert.ok(Number.isSafeInteger(w.t));return {t:w.t,time:e.timeText(w.t)};});
 t('CLOCK-02','Sexagesimal display at minute rollover 07:59 to 08:00',()=>{assert.equal(e.timeText(479),'07:59');assert.equal(e.timeText(480),'08:00');return {at479:e.timeText(479),at480:e.timeText(480)};});
 t('CLOCK-03','Day rollover 23:59 to 00:00 (representation)',()=>{assert.equal(e.timeText(1439),'23:59');assert.equal(e.timeText(1440),'00:00');assert.equal(e.timeText(1441),'00:01');return {before:'23:59',after:'00:00'};});
 t('CLOCK-04','Odd-minute actions are exact: 7, 13, 17',()=>{for(const [d,expected] of [[7,412],[13,418],[17,422]]){const w=nw();assert.equal(e.advance(w,d),d);assert.equal(w.t,expected);}return {durations:[7,13,17]};});
 t('CLOCK-05','No fractional, negative or infinite durations',()=>{for(const d of [-1,0.5,NaN,Infinity,-Infinity]){const w=nw();assert.throws(()=>e.advance(w,d),/Durata non valida/);assert.equal(w.t,405);}return {rejected:5};});
 t('CLOCK-06','Zero minutes cannot move time backwards',()=>{const w=nw();assert.equal(e.advance(w,0),0);assert.equal(w.t,405);return {time:405};});
 t('SCHOOL-01','07:45 school arrival is not class attendance',()=>{const w=school745();assert.equal(w.school.minutes,0);assert.ok(e.availableActions(w).some(a=>a.type==='wait'&&a.minutes===15));assert.ok(!e.availableActions(w).some(a=>a.type==='class'));return {at:'07:45',classMinutes:0};});
 t('SCHOOL-02','Direct school class action before 08:00 is blocked',()=>{const w=school745();assert.throws(()=>e.perform(w,{type:'class'}),/08:00/);assert.equal(mm(w),465);return {blockedAt:'07:45'};});
 t('SCHOOL-03','School begins exactly at 08:00',()=>{const w=school745();e.perform(w,{type:'wait',minutes:15});assert.equal(mm(w),480);assert.equal(w.school.minutes,0);e.perform(w,{type:'class'});assert.equal(mm(w),510);assert.equal(w.school.firstClass%1440,480);assert.equal(w.school.minutes,30);return {start:'08:00',end:'08:30'};});
 t('SCHOOL-04','Late attendance starts at arrival, never retroactively',()=>{const w=school745();e.perform(w,{type:'wait',minutes:30});e.perform(w,{type:'class'});assert.equal(mm(w),525);assert.equal(w.school.minutes,30);assert.equal(w.school.firstClass%1440,495);assert.equal(w.school.status,'late');return {start:'08:15',end:'08:45',minutes:30};});
 t('SCHOOL-05','Class cannot start after 13:00',()=>{const w=school745();drive(w,780);assert.ok(!e.availableActions(w).some(a=>a.type==='class'));assert.throws(()=>e.perform(w,{type:'class'}),/Lezioni iniziano|Lezioni non disponibili/);return {at:'13:00'};});
 t('SCHOOL-06','At 12:50 class is capped to 10 minutes',()=>{const w=school745();drive(w,770);const a=e.availableActions(w).find(a=>a.type==='class');assert.equal(a?.duration,10);e.perform(w,{type:'class'});assert.equal(mm(w),780);assert.equal(w.school.minutes,10);return {start:'12:50',end:'13:00',minutes:10};});
 t('ROUTE-01','Home to school walking route takes 20 minutes',()=>{const w=nw(),r=e.route(w,'home','school');assert.equal(r.duration,20);assert.equal(r.cost,0);e.advance(w,40);e.perform(w,{type:'travel',to:'school'});assert.equal(mm(w),465);assert.equal(w.actors.alex.place,'school');return {duration:20,arrive:'07:45'};});
 t('ROUTE-02','Odd 13-minute street-to-square walking segment is preserved',()=>{const w=nw();e.perform(w,{type:'travel',to:'street'});assert.equal(mm(w),410);const r=e.route(w,'street','square');assert.equal(r.duration,13);e.perform(w,{type:'travel',to:'square'});assert.equal(mm(w),423);assert.equal(w.actors.alex.place,'square');return {start:'06:50',end:'07:03',duration:13};});
 t('ACCESS-01','School building opens at 07:45 and closes at 16:00',()=>{const w=nw();assert.equal(e.placeAccess(w,'school','alex',464).ok,false);assert.equal(e.placeAccess(w,'school','alex',465).ok,true);assert.equal(e.placeAccess(w,'school','alex',959).ok,true);assert.equal(e.placeAccess(w,'school','alex',960).ok,false);return {opens:465,closes:960};});
 t('ACCESS-02','Store lunch closure and afternoon reopening are distinct',()=>{const w=nw();assert.equal(e.placeAccess(w,'shop','alex',779).ok,true);assert.equal(e.placeAccess(w,'shop','alex',780).ok,false);assert.equal(e.placeAccess(w,'shop','alex',839).ok,false);assert.equal(e.placeAccess(w,'shop','alex',840).ok,true);return {lunch:'13:00-14:00'};});
 t('BUS-01','Bus respects departure frequency and waiting time',()=>{const w=nw(),r=e.route(w,'stop_borgo','stop_centro','bus');assert.equal(r.departureAt,420);assert.equal(r.ride,8);assert.equal(r.duration,23);assert.equal(r.cost,150);return {request:'06:45',departure:'07:00',arrival:'07:08',duration:23};});
 t('BUS-02','Bus departure at 23:00 moves to next-day 06:00',()=>{const w=nw();w.t=1380;const r=e.route(w,'stop_borgo','stop_centro','bus');assert.equal(r.departureAt,1800);assert.equal(r.duration,428);assert.equal(r.ride,8);return {departureAt:1800,wait:420,ride:8};});
 t('DAY-01','Game engine crosses midnight with real event interruptions resolved',()=>{const w=nw();const first=drive(w,1439);assert.equal(e.timeText(w.t),'23:59');const next=drive(w,1440);assert.equal(w.t,1440);assert.equal(e.timeText(w.t),'00:00');return {callsResolved:first.calls+next.calls,t:w.t,day:Math.floor(w.t/1440)};});
 t('DAY-02','The player cannot skip NPC decision silently',()=>{const w=nw(),before=w.t;const moved=e.advance(w,300);assert.ok(w.call);assert.ok(moved>0&&moved<300);assert.equal(w.t,before+moved);assert.equal(e.advance(w,10),0);return {pauseAt:w.t,reason:w.call.reason};});
 t('AUTO-01','Manual early exit survives daily advance',()=>{const w=school745();e.perform(w,{type:'wait',minutes:15});e.perform(w,{type:'class'});e.perform(w,{type:'leaveClass'});e.perform(w,{type:'travel',to:'home'});dayJump(w);const record=w.schoolHistory.find(s=>s.day===0);assert.equal(record?.status,'early_exit');assert.equal(record?.minutes,30);return {status:record.status,minutes:record.minutes};});
 t('AUTO-02','Default school routine totals 300 minutes',()=>{const w=nw();dayJump(w);assert.equal(w.schoolHistory[0].minutes,300);return {minutes:300};});
 t('SAVE-01','Integer time persists across engine save/load at odd minute',()=>{const w=nw();e.advance(w,13);const restored=e.load(e.save(w));assert.equal(restored.t,418);assert.equal(e.timeText(restored.t),'06:58');return {t:418,clock:'06:58'};});
 t('ISOLATION-01','Two independent game worlds keep distinct clock states',()=>{const a=nw(),b=nw(),first=e.save(b);e.advance(a,17);assert.equal(a.t,422);assert.equal(e.save(b),first);return {a:a.t,b:b.t};});
}
const passed=checks.filter(x=>x.result==='PASS').length;
const report={suite:'ELYRA TIME STANDARD V2',source:FILE,method:'Original C4 engine extracted in Node.js VM. No game changes, no IndexedDB writes.',total:checks.length,passed,failed:checks.length-passed,checks,limitations:['This is not real Android, browser UI or IndexedDB verification','Not a complete software audit; checked selected school, journeys, schedules and time boundaries','Clock source is unmodified C4; next stage is wider cross-module time contract']};
fs.mkdirSync(path.dirname(REPORT),{recursive:true});fs.writeFileSync(REPORT,JSON.stringify(report,null,2));
console.log(`\nTime Standard V2: ${passed}/${checks.length} PASS; report: ${path.relative(__dirname,REPORT)}`);
if(passed!==checks.length)process.exitCode=1;

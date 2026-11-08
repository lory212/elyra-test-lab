'use strict';
// ELYRA CI V1: dependency-free, read-only tests against real ELYRA C4 embedded engine.
// `node ELYRA_CI_CORE_V1.cjs` from repository root.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const ROOT = __dirname;
const SOURCE = 'ELYRA_0_17_THREE_SLOTS_PLAYABLE_C4_SCHOOL_CLOCK_LAB.html';
const sourceFile = path.join(ROOT, SOURCE);
const reportPath = path.join(ROOT, 'artifacts', 'ELYRA_CI_CORE_V1_REPORT.json');
const checks = [];
const test = (id, title, fn) => {
  try {
    const detail = fn();
    checks.push({id, title, result:'PASS', detail: detail ?? null});
    process.stdout.write(`PASS ${id} — ${title}\n`);
  } catch (err) {
    checks.push({id, title, result:'FAIL', error:err.stack || String(err)});
    process.stderr.write(`FAIL ${id} — ${title}: ${err.message}\n`);
  }
};
let engine, html;
try {
  html = fs.readFileSync(sourceFile,'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
  const bundled = scripts.find(x=>x.includes('const modules=') && x.includes('require(\'ui.mjs\')'));
  assert.ok(bundled, 'C4 embedded game engine not found');
  const ctx={window:{},crypto:webcrypto,console};
  vm.runInNewContext(bundled.replace("require('ui.mjs');",''),ctx,{timeout:10000,filename:'elyra-c4-engine.js'});
  engine=ctx.window.__elyraLabEngine;
  assert.ok(engine, 'engine API not exposed');
} catch (err) {
  checks.push({id:'BOOT',title:'Load C4 game bundle',result:'FAIL',error:err.stack || String(err)});
}
if (engine) {
  const newWorld=()=>engine.createWorld(17);
  const arrive745=()=>{const w=newWorld();engine.advance(w,40);engine.perform(w,{type:'travel',to:'school'});assert.equal(w.t%1440,465);return w;};
  const dayJump=(w)=>{engine.startTimeAdvance(w,1440);let loops=0;while(w.timeAdvance?.status==='running' && loops++<240){const previous=w.t;engine.runTimeAdvance(w,{boundaries:128});if(previous===w.t && w.timeAdvance?.status==='running')throw Error('time advance stalled');}assert.equal(w.timeAdvance?.status,'completed');};
  test('SCOPE-01','C4 diagnostic and isolated DB are present',()=>{
    assert.ok(html.includes('elyra-school-clock-run'));
    assert.ok(html.includes('elyra_017_playable_slots_c4_school_clock'));
    return {source:SOURCE};
  });
  test('TIME-01A','07:45: arrival is separate from class attendance',()=>{
    const w=arrive745(),actions=engine.availableActions(w);
    assert.equal(w.school.minutes,0);
    assert.ok(actions.some(a=>a.type==='wait'&&a.minutes===15&&a.category==='Scuola'));
    assert.ok(!actions.some(a=>a.type==='class'));
    return {at:'07:45',classMinutes:0};
  });
  test('TIME-01B','07:45: direct class action is rejected',()=>{
    const w=arrive745();assert.throws(()=>engine.perform(w,{type:'class'}),/08:00/);assert.equal(w.school.minutes,0);return {blocked:true};
  });
  test('TIME-01C','08:00: bell and 08:30 class end are exact',()=>{
    const w=arrive745();engine.perform(w,{type:'wait',minutes:15});assert.equal(w.t%1440,480);assert.equal(w.school.minutes,0);
    engine.perform(w,{type:'class'});assert.equal(w.t%1440,510);assert.equal(w.school.minutes,30);assert.equal(w.school.firstClass%1440,480);return {classStarts:'08:00',classEnds:'08:30',classMinutes:30};
  });
  test('TIME-02','08:15 arrival: recorded as late and no retroactive minutes',()=>{
    const w=arrive745();engine.perform(w,{type:'wait',minutes:30});engine.perform(w,{type:'class'});
    assert.equal(w.t%1440,525);assert.equal(w.school.minutes,30);assert.equal(w.school.firstClass%1440,495);assert.equal(w.school.status,'late');return {at:'08:45',minutes:30};
  });
  test('TIME-03','Manual early exit is preserved across a full-day jump',()=>{
    const w=arrive745();engine.perform(w,{type:'wait',minutes:15});engine.perform(w,{type:'class'});engine.perform(w,{type:'leaveClass'});engine.perform(w,{type:'travel',to:'home'});
    assert.equal(w.school.status,'early_exit');assert.equal(w.school.minutes,30);dayJump(w);
    const history=w.schoolHistory.find(r=>r.day===0);
    assert.equal(history?.status,'early_exit');assert.equal(history?.minutes,30);
    return {archivedDay:0,status:history.status,minutes:history.minutes};
  });
  test('REG-01','Normal automatic schooling still completes 300 minutes',()=>{
    const w=newWorld();dayJump(w);assert.equal(w.schoolHistory[0].minutes,300);return {minutes:300};
  });
  test('SAVE-01','Engine serialization preserves exact scheduled start',()=>{
    const w=arrive745();engine.perform(w,{type:'wait',minutes:15});engine.perform(w,{type:'class'});
    const restored=engine.load(engine.save(w));assert.equal(restored.t,w.t);assert.equal(restored.school.minutes,30);assert.equal(restored.school.firstClass%1440,480);
    return {clock:'08:30',minutes:30};
  });
  test('SAVE-02','Independent game-world instances never share state',()=>{
    const a=newWorld(),b=newWorld();const originalB=engine.save(b);engine.advance(a,60);assert.equal(engine.save(b),originalB);return {separate:true};
  });
  test('TIME-PAUSE-01','Direct time advance stops for an unresolved NPC call',()=>{
    const w=newWorld(),start=w.t;
    const moved=engine.advance(w,300);
    assert.ok(w.call,'expected an unresolved call to pause time');
    assert.equal(w.t,start+moved);
    assert.ok(moved>0&&moved<300,'advance should pause before its target');
    assert.equal(engine.advance(w,30),0,'must not silently bypass pending choice');
    return {advancedMinutes:moved,at:w.t%1440,reason:w.call.reason};
  });
}
const passed=checks.filter(x=>x.result==='PASS').length;
const result={suite:'ELYRA CI CORE V1',source:SOURCE,scope:'Node VM, real embedded C4 engine; NOT UI/Android/IndexedDB certification; TIME-11 midnight boundary still untested',passed,failed:checks.length-passed,total:checks.length,checks};
fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(result,null,2));
console.log(`\nELYRA CI: ${passed}/${checks.length} PASS; report: ${path.relative(ROOT,reportPath)}`);
if(passed!==checks.length)process.exitCode=1;

'use strict';
// Static inventory of C4 embedded modules, for triage only; NOT a behavioral certification.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=__dirname, source='ELYRA_0_17_THREE_SLOTS_PLAYABLE_C4_SCHOOL_CLOCK_LAB.html';
const html=fs.readFileSync(path.join(root,source),'utf8');
const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(s=>s.includes('const modules='));
if(!script)throw Error('No embedded module bundle found');
const marker='const cache={};';if(script.split(marker).length!==2)throw Error('Ambiguous module bundle marker');
const sourceJs=script.replace(marker, 'window.__factories=modules;'+marker).replace("require('ui.mjs');",'');
const ctx={window:{},crypto:require('node:crypto').webcrypto,console};
vm.runInNewContext(sourceJs,ctx,{timeout:10000});
const factories=ctx.window.__factories;
const entries=Object.entries(factories).map(([name,fn])=>{
 const code=String(fn);
 const count=(rx)=>[...code.matchAll(rx)].length;
 const data={name,lines:code.split('\n').length,
    timeReads:count(/\b(?:w|world|W)\.t\b/g),
    directTimeWrites:count(/\b(?:w|world|W)\.t\s*(?:\+\+|--|\+=|-=|=(?!=|>))/g),
    schedulingTerms:count(/\b(?:nextAt|nextEvent|nextBoundary|deadline|schedule|startTimeAdvance|runTimeAdvance|queue|tick|advance)\b/g),
    minutesTerms:count(/\b(?:minute|minutes|duration|DAY|1440|480|780)\b/gi)};
 data.priority=(data.directTimeWrites?'direct-time-write':data.schedulingTerms?'scheduler/routine':'review-if-connected');return data;
}).sort((a,b)=>b.directTimeWrites-a.directTimeWrites||b.schedulingTerms-a.schedulingTerms||b.timeReads-a.timeReads);
const output={kind:'STATIC_HEURISTIC',source,modules:entries.length,scope:'Embedded factory functions only; indirect writes, aliases and runtime behavior NOT fully detected',entries};
const folder=path.join(root,'artifacts');fs.mkdirSync(folder,{recursive:true});
fs.writeFileSync(path.join(folder,'ELYRA_TIMECORE_STATIC_AUDIT_V1.json'),JSON.stringify(output,null,2));
console.log('Modules:',entries.length,'Direct time write candidates:',entries.filter(x=>x.directTimeWrites).map(x=>`${x.name}(${x.directTimeWrites})`).join(', ')||'none');
console.log('First modules by static priority:');for(const it of entries.slice(0,12))console.log(it.name, 'writes',it.directTimeWrites,'scheduling',it.schedulingTerms,'reads',it.timeReads);

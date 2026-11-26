/* SPDX-License-Identifier: GPL-2.0-only */
'use strict';
// Offline, read-only SD input inspection. No RPC, activation or SD writes.
const path=require('node:path');
const {collectMods}=require('./backend/lib/mods.cjs');
const {indexExeFs}=require('./backend/lib/pfs.cjs');
const {readSource}=require('./backend/lib/sources.cjs');
const {decodeNso}=require('./backend/lib/exefs.cjs');
const {check}=require('./backend/lib/common.cjs');
async function inspectEntry(titleId,entry,globalPatches,gameName=null){
 const report={titleId,...(gameName?{game:gameName}:{}),romfsBytes:entry.romfsImage?.size??null,exefs:[],warnings:[]};
 if(entry.romfsImage){
  const h=await readSource(entry.romfsImage,0,80);
  check(h.readBigUInt64LE(0)===80n,'Invalid RomFS header size');
  const size=BigInt(entry.romfsImage.size);
  for(let i=1;i<9;i+=2){const off=h.readBigUInt64LE(i*8),n=h.readBigUInt64LE((i+1)*8);check(off>=80n&&off<=size&&n<=size-off,'RomFS metadata exceeds image');}
  check(h.readBigUInt64LE(72)>=80n&&h.readBigUInt64LE(72)<=size,'Invalid RomFS data offset');
  report.warnings.push('RomFS: header and bounds verified.');
 }
 const rows=entry.exefsImage?await indexExeFs(entry.exefsImage):[];
 const entries=new Map(rows.map(r=>[r.name,r]));
 for(const r of entry.exefs)entries.set(r.path.slice(1),{name:r.path.slice(1),size:r.size,source:r,sourceOffset:0});
 for(const n of entry.stubs)if(!entry.exefs.some(r=>r.path.slice(1)===n))entries.delete(n);
 if(entry.exefsImage||entry.exefs.length||entry.stubs.length){
  for(const n of ['main','main.npdm'])check(entries.has(n),'ExeFS incomplete: missing '+n);
  for(const r of entries.values()){
   check(r.size<=512*1024*1024,'ExeFS file exceeds offline inspection limit: '+r.name);
   const raw=await readSource(r.source,r.sourceOffset,r.size);
   if(r.name==='main.npdm')check(raw.length>=128&&raw.toString('ascii',0,4)==='META','Invalid main.npdm');
   else{const nso=decodeNso(raw);report.exefs.push({name:r.name,size:r.size,buildId:nso.buildId});}
  }
  report.warnings.push('ExeFS structure verified.');
 }else report.warnings.push('No ExeFS replacement: RomFS-only configuration.');
 if(entry.patches.length||globalPatches.length)report.warnings.push('IPS patches present.');
 return report;
}
async function inspect(root){
 const plan=collectMods(root),games=[];
 for(const g of plan.games){
  if(g.profiles&&g.profiles.length){
   for(const profile of g.profiles)games.push(await inspectEntry(g.titleId,profile,plan.patches,profile.name));
  }else{
   games.push(await inspectEntry(g.titleId,g,plan.patches));
  }
 }
 return {schema:1,readOnly:true,games};
}
if(require.main===module){
 const root=process.argv[2];
 if(!root){console.error('Usage: node check-sd.cjs /path/to/SD/ns2jb-modloader');process.exitCode=1;}
 else inspect(path.resolve(root)).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error('CHECK FAILED: '+e.message);process.exitCode=1;});
}
module.exports={inspect};

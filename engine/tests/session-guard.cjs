/* SPDX-License-Identifier: GPL-2.0-only */
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {checkSession}=require('../session-guard.cjs'),{options}=require('../launch-backend.cjs');
const parent=fs.mkdtempSync(path.join(os.tmpdir(),'ns2-guard-')),run=path.join(parent,'switch2-test');fs.mkdirSync(path.join(run,'switch2','ro'),{recursive:true});
const write=(p,v)=>fs.writeFileSync(path.join(run,p),JSON.stringify(v));
try{
 write('result.json',{verified:true,rpc:{state:'listening'}});write('connection.json',{port:12345,addresses:{session:'switch2-test'}});
 write('switch2/fs-execution-current.json',{verified:true,file:'proof.json'});write('proof.json',{verified:true,session:'switch2-test'});
 assert.equal(checkSession(run),run);
 write('switch2/ro/hen-startup.json',{pid:99});assert.throws(()=>checkSession(run),/avvio HEN/);fs.unlinkSync(path.join(run,'switch2/ro/hen-startup.json'));
 write('result.json',{verified:true,completed:true,rpc:{state:'listening'}});assert.throws(()=>checkSession(run),/4\/4/);
 write('result.json',{verified:true,rpc:{state:'listening'}});write('connection.json',{port:12345,addresses:{session:'other'}});assert.throws(()=>checkSession(run),/Identita/);
 assert.throws(()=>options(['--run-dir',run,'--title','bad']),/Title ID/);
 assert.throws(()=>options(['--keep-rpc']),/Usage/);
 assert.equal(options(['--run-dir',run]).title,null);
 assert.equal(options(['--run-dir',run,'--title','0400000000001000']).title,'0400000000001000');
 console.log('PASS session identity, same-boot proof, HEN-marker refusal, completed-session refusal, bounded CLI options (multi-host); no RPC or mutation performed');
}finally{fs.rmSync(parent,{recursive:true,force:true});}

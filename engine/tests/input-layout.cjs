/* SPDX-License-Identifier: GPL-2.0-only */
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {collectMods}=require('../backend/lib/mods.cjs');const root=fs.mkdtempSync(path.join(os.tmpdir(),'ns2-layout-'));
try{const folder=path.join(root,'contents','0400000000001000');fs.mkdirSync(folder,{recursive:true});
 fs.writeFileSync(path.join(folder,'romfs.bin'),Buffer.alloc(80));fs.writeFileSync(path.join(folder,'exefs.nsp'),Buffer.from('PFS0'));
 fs.writeFileSync(path.join(folder,'romfs.bin.export-state'),Buffer.alloc(56));fs.writeFileSync(path.join(folder,'romfs.bin.sha256'),'hash  romfs.bin\n');
 assert.throws(()=>collectMods(root),/Unsupported component/);
 const meta=path.join(root,'preserved-export-metadata');fs.mkdirSync(meta);
 for(const name of ['romfs.bin.export-state','romfs.bin.sha256'])fs.renameSync(path.join(folder,name),path.join(meta,name));
 const plan=collectMods(root);assert.equal(plan.games.length,1);assert(plan.games[0].romfsImage);assert(plan.games[0].exefsImage);
 assert(fs.existsSync(path.join(meta,'romfs.bin.export-state')));assert(fs.existsSync(path.join(meta,'romfs.bin.sha256')));
 console.log('PASS real upstream collector rejects export companions in title folder and accepts preserved metadata outside it with both backup images');
}finally{fs.rmSync(root,{recursive:true,force:true});}

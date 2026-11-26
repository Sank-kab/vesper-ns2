/* SPDX-License-Identifier: GPL-2.0-only */
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {collectMods}=require('../backend/lib/mods.cjs');
const {selectGames}=require('../backend/lib/game-selector.cjs');
const {plan}=require('../backend/lib/lazy-context.cjs');
const {inspect}=require('../check-sd.cjs');
const {options}=require('../launch-backend.cjs');
const prepara=require('../prepare-game.cjs');

async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ns2-multigame-'));
 try{
  const host1=path.join(root,'contents','0400000000001000');
  const host2=path.join(root,'contents','0400111122220000');
  const g1=path.join(host1,'games','game-one');
  const g2=path.join(host1,'games','game-two');
  const g3=path.join(host2,'games','game-three');
  fs.mkdirSync(path.join(g1,'exefs_patches'),{recursive:true});
  fs.mkdirSync(g2,{recursive:true});
  fs.mkdirSync(g3,{recursive:true});

  const rom=Buffer.alloc(80);rom.writeBigUInt64LE(80n);
  for(let i=1;i<10;i++)rom.writeBigUInt64LE(i%2===1?80n:0n,i*8);
  const nso=Buffer.alloc(256);nso.write('NSO0');
  const npdm=Buffer.alloc(128);npdm.write('META');
  const payload=Buffer.concat([nso,npdm]);
  const names=Buffer.from('main\0main.npdm\0');
  const pfs=Buffer.alloc(16+48+names.length);
  pfs.write('PFS0');pfs.writeUInt32LE(2,4);pfs.writeUInt32LE(names.length,8);
  pfs.writeBigUInt64LE(256n,24);pfs.writeBigUInt64LE(256n,40);pfs.writeBigUInt64LE(128n,48);pfs.writeUInt32LE(5,56);
  names.copy(pfs,64);
  const exefsNsp=Buffer.concat([pfs,payload]);

  fs.writeFileSync(path.join(g1,'romfs.bin'),rom);
  fs.writeFileSync(path.join(g1,'exefs.nsp'),exefsNsp);
  fs.writeFileSync(path.join(g1,'exefs_patches','1643a838814f9c10c696f930ed681e7fa3fb9af8000000000000000000000000.ips32'),Buffer.from('IPS32EEOF'));
  fs.writeFileSync(path.join(g2,'romfs.bin'),rom);
  fs.writeFileSync(path.join(g2,'exefs.nsp'),exefsNsp);
  fs.writeFileSync(path.join(g3,'romfs.bin'),rom);
  fs.writeFileSync(path.join(g3,'exefs.nsp'),exefsNsp);

  // 1) Offline inspection validates all games across multiple hosts
  const report=await inspect(root);
  assert.equal(report.games.length,3);
  assert.deepEqual(report.games.map(g=>g.game),['game-one','game-two','game-three']);

  // 2) CLI --game & --title options
  assert.equal(options(['--game','game-one']).game,'game-one');
  assert.equal(options([]).title,null);
  assert.throws(()=>options(['--game']),/valid/);

  // 3) Multi-host auto-filter by --game name
  const c1=collectMods(root);
  for(const g of c1.games)for(const p of g.profiles){p.romfsImage.sdPath='/sd/'+g.titleId+'/'+p.name+'/romfs.bin';p.exefsImage.sdPath='/sd/'+g.titleId+'/'+p.name+'/exefs.nsp';for(const patch of p.patches)patch.sdPath='/sd/'+g.titleId+'/'+p.name+'/'+patch.path;}
  await selectGames(c1,{game:'game-one'});
  assert.equal(c1.games.length,1);
  assert.equal(c1.games[0].titleId,'0400000000001000');
  assert.equal(c1.games[0].selectedGame,'game-one');
  const p1=plan(c1,'switch2-test');
  assert.equal(p1.lazyGames[0].files.find(f=>f.name==='romfs.bin').sdPath,'/sd/0400000000001000/game-one/romfs.bin');

  // 4) Interactive multi-host selection (host #1 = 0400000000001000, game #2 = game-two)
  const c2=collectMods(root);
  const answers=['1','2'];
  await selectGames(c2,{prompt:async()=>answers.shift()});
  assert.equal(c2.games.length,1);
  assert.equal(c2.games[0].titleId,'0400000000001000');
  assert.equal(c2.games[0].selectedGame,'game-two');

  // 5) prepare-game host policy check (synthetic NPDM parses cleanly)
  const synth=Buffer.alloc(0x120);synth.write('META',0);synth.writeUInt32LE(0x80,0x70);synth.writeUInt32LE(0x40,0x74);synth.write('ACI0',0x80);synth.writeBigUInt64LE(0x0400000000001000n,0x90);assert.equal(prepara.readNpdmProgramId(synth),'0400000000001000');

  // 6) Reject unknown game name clearly
  const c3=collectMods(root);
  await assert.rejects(()=>selectGames(c3,{titles:['0400000000001000'],game:'inesistente'}),/not found/);

  console.log('PASS multi-host + multi-game discovery, offline inspection, --game auto-host routing, interactive selection, and prepara-gioco policy parsing');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

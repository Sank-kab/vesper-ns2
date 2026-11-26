'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {inspect}=require('../check-sd.cjs');
async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ns2-check-')),dir=path.join(root,'contents','0400000000001000');
 try{
  fs.mkdirSync(dir,{recursive:true});const h=Buffer.alloc(80);h.writeBigUInt64LE(80n);for(let i=1;i<10;i++)h.writeBigUInt64LE(i%2===1?80n:0n,i*8);fs.writeFileSync(path.join(dir,'romfs.bin'),h);
  assert.equal((await inspect(root)).games[0].exefs.length,0);
  fs.writeFileSync(path.join(dir,'romfs-vecchia.bin'),h);await assert.rejects(inspect(root),/Unsupported component/);fs.unlinkSync(path.join(dir,'romfs-vecchia.bin'));
  h.writeBigUInt64LE(81n,8);fs.writeFileSync(path.join(dir,'romfs.bin'),h);await assert.rejects(inspect(root),/metadata exceeds/);h.writeBigUInt64LE(80n,8);fs.writeFileSync(path.join(dir,'romfs.bin'),h);
  const ex=path.join(dir,'exefs');fs.mkdirSync(ex);const nso=Buffer.alloc(256);nso.write('NSO0');fs.writeFileSync(path.join(ex,'main'),nso);await assert.rejects(inspect(root),/missing main.npdm/);
  const npdm=Buffer.alloc(128);npdm.write('META');fs.writeFileSync(path.join(ex,'main.npdm'),npdm);assert.equal((await inspect(root)).games[0].exefs[0].name,'main');
  nso.writeUInt32LE(257,16);fs.writeFileSync(path.join(ex,'main'),nso);await assert.rejects(inspect(root),/extent exceeds/);
  fs.rmSync(ex,{recursive:true});fs.writeFileSync(path.join(dir,'exefs.nsp'),Buffer.from('not a pfs archive'));await assert.rejects(inspect(root),/PFS0/);
  const payload=Buffer.concat([Buffer.from(nso.fill(0)),npdm]);payload.write('NSO0');const names=Buffer.from('main\0main.npdm\0');const pfs=Buffer.alloc(16+48+names.length);pfs.write('PFS0');pfs.writeUInt32LE(2,4);pfs.writeUInt32LE(names.length,8);pfs.writeBigUInt64LE(256n,24);pfs.writeBigUInt64LE(256n,40);pfs.writeBigUInt64LE(128n,48);pfs.writeUInt32LE(5,56);names.copy(pfs,64);fs.writeFileSync(path.join(dir,'exefs.nsp'),Buffer.concat([pfs,payload]));assert.equal((await inspect(root)).games[0].exefs.length,1);
  pfs.writeBigUInt64LE(1n,40);fs.writeFileSync(path.join(dir,'exefs.nsp'),Buffer.concat([pfs,payload]));await assert.rejects(inspect(root),/Overlapping/);
  console.log('PASS offline inputs: RomFS bounds, unsupported backup, ExeFS completeness, invalid NSO, valid PFS0, invalid PFS0 and overlapping files');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

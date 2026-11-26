#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-2.0-only */
'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const readline=require('node:readline');
const {execFileSync}=require('node:child_process');
const {decodeZbic}=require('./backend/lib/zbic.cjs');
const {inspect}=require('./check-sd.cjs');

const ROOT=__dirname;
const POLICIES_DIR=path.join(ROOT,'host-policies');
const HOSTS_JSON=path.join(POLICIES_DIR,'hosts.json');
const MERGE_ROMFS=path.join(ROOT,'tools','merge_romfs.py');
function resolveNupPaths(){
 const envVenv=process.env.NS2_NUP_VENV&&process.env.NS2_NUP_VENV.trim();
 const defaultVenv=path.join(os.homedir(),'.ns2-game-loader','nup-venv');
 for(const venv of [envVenv,defaultVenv].filter(Boolean)){
  const bin=path.join(venv,'bin','nup'),py=path.join(venv,'bin','python');
  if(fs.existsSync(bin)&&fs.existsSync(py))return{nupBin:bin,nupPy:py};
 }
 return{nupBin:'nup',nupPy:'python3'};
}
const {nupBin:NUP_BIN,nupPy:NUP_PY}=resolveNupPaths();
const DEFAULT_OUT_BASE=path.join(os.homedir(),'.ns2-game-loader','ready');

const USAGE=`Usage:
  ns2-prepare <file.nup> <game-name> [--host HOST_ID] [--sd /mnt/d] [--out DIR] [--no-auto-patch]
  ns2-prepare --add-host <host.nup | main.npdm> [--host-name "Host Name"]
  ns2-prepare --list-hosts

Examples:
  ns2-prepare "/mnt/c/Games/Game.nup" my-game
  ns2-prepare "/mnt/c/Games/Game.nup" my-game --host 0400000000001000 --sd /mnt/d
  ns2-prepare --add-host "/mnt/c/Games/Host.nup" --host-name "Host Game"`;

function fail(msg){throw Error(msg);}
function loadHostNames(){try{return JSON.parse(fs.readFileSync(HOSTS_JSON,'utf8'));}catch{return {};}}
function saveHostNames(obj){fs.mkdirSync(POLICIES_DIR,{recursive:true});fs.writeFileSync(HOSTS_JSON,JSON.stringify(obj,null,2)+'\n');}

function readNpdmProgramId(buf){
 if(buf.length<0x80||buf.toString('ascii',0,4)!=='META')fail('Invalid main.npdm (missing META header).');
 const at=buf.readUInt32LE(0x70),size=buf.readUInt32LE(0x74);
 if(at<0x80||size<0x20||at+size>buf.length||buf.toString('ascii',at,at+4)!=='ACI0')fail('Invalid main.npdm (missing ACI0 section).');
 return buf.readBigUInt64LE(at+0x10).toString(16).padStart(16,'0');
}

function listHostPolicies(){
 fs.mkdirSync(POLICIES_DIR,{recursive:true});
 const names=loadHostNames();
 return fs.readdirSync(POLICIES_DIR)
  .filter(f=>/^0[14][0-9a-f]{14}\.npdm$/i.test(f))
  .sort()
  .map(f=>{const id=f.slice(0,16).toLowerCase();return{id,name:names[id]||null,file:path.join(POLICIES_DIR,f)};});
}

function askLine(q){
 return new Promise((resolve,reject)=>{
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  rl.on('SIGINT',()=>{rl.close();reject(Error('Cancelled.'));});
  rl.question(q,ans=>{rl.close();resolve(ans);});
 });
}

function decompressLz4Block(src,expectedSize){
 const out=Buffer.alloc(expectedSize);
 let i=0,o=0,n=src.length;
 while(i<n){
  const tok=src[i++];
  let ll=tok>>4;
  if(ll===15){let b=255;while(b===255){b=src[i++];ll+=b;}}
  src.copy(out,o,i,i+ll);i+=ll;o+=ll;
  if(i>=n)break;
  const off=src[i]|(src[i+1]<<8);i+=2;
  let ml=(tok&15)+4;
  if(ml===19){let b=255;while(b===255){b=src[i++];ml+=b;}}
  for(let k=0;k<ml;k++){out[o]=out[o-off];o++;}
 }
 return out.subarray(0,o);
}

function readNsoRodata(file){
 const d=fs.readFileSync(file);
 if(d.length<0x100||d.toString('ascii',0,4)!=='NSO0')fail('Invalid NSO: '+file);
 const flags=d.readUInt32LE(12);
 const roff=d.readUInt32LE(0x20),rsize=d.readUInt32LE(0x28),rcomp=d.readUInt32LE(0x64);
 const buildId=d.subarray(0x40,0x60).toString('hex');
 const dynstrOff=d.readUInt32LE(0x90),dynstrSize=d.readUInt32LE(0x94);
 const dynsymOff=d.readUInt32LE(0x98),dynsymSize=d.readUInt32LE(0x9c);
 let ro;
 if(flags&0x40)ro=decodeZbic(d.subarray(roff,roff+rcomp),rsize);
 else if(flags&2)ro=decompressLz4Block(d.subarray(roff,roff+rcomp),rsize);
 else ro=d.subarray(roff,roff+rsize);
 return{buildId,ro,dynstrOff,dynstrSize,dynsymOff,dynsymSize};
}

function detectTempStoragePatch(exefsDir){
 const mainFile=path.join(exefsDir,'main'),sdkFile=path.join(exefsDir,'sdk');
 if(!fs.existsSync(mainFile)||!fs.existsSync(sdkFile))return null;
 const mainInfo=readNsoRodata(mainFile);
 const sym='_ZN2nn2fs21MountTemporaryStorageEPKc';
 if(!mainInfo.ro.toString('latin1').includes(sym))return null;
 const sdkInfo=readNsoRodata(sdkFile);
 for(let off=sdkInfo.dynsymOff;off+24<=sdkInfo.dynsymOff+sdkInfo.dynsymSize;off+=24){
  const nameIdx=sdkInfo.ro.readUInt32LE(off);
  const val=Number(sdkInfo.ro.readBigUInt64LE(off+8));
  const start=sdkInfo.dynstrOff+nameIdx;
  const end=sdkInfo.ro.indexOf(0,start);
  if(end<0)continue;
  const name=sdkInfo.ro.subarray(start,end).toString('utf8');
  if(name===sym&&val>0){
   const ipsOffset=val+0x100;
   const code=Buffer.alloc(8);
   code.writeUInt32LE(0x52800000,0); // mov w0, #0
   code.writeUInt32LE(0xd65f03c0,4); // ret
   const header=Buffer.alloc(11);
   header.write('IPS32',0,'ascii');
   header.writeUInt32BE(ipsOffset,5);
   header.writeUInt16BE(code.length,9);
   const bytes=Buffer.concat([header,code,Buffer.from('EEOF','ascii')]);
   return{buildId:sdkInfo.buildId,vaddr:val,ipsOffset,bytes};
  }
 }
 return null;
}

function packExefsNsp(exefsDir,hostPolicyFile,outputFile){
 const policy=fs.readFileSync(hostPolicyFile);
 const hostId=readNpdmProgramId(policy);
 const targetNpdm=path.join(exefsDir,'main.npdm');
 if(fs.existsSync(targetNpdm)){
  const targetId=readNpdmProgramId(fs.readFileSync(targetNpdm));
  if(targetId===hostId)fail('Target and host share the same Title ID ('+hostId+')!');
 }
 const rawFiles=fs.readdirSync(exefsDir).filter(f=>f!=='main.npdm'&&fs.statSync(path.join(exefsDir,f)).isFile());
 const order=name=>name==='rtld'?0:name==='main'?1:name.startsWith('subsdk')?2:name==='sdk'?3:4;
 const nsoNames=rawFiles.sort((a,b)=>order(a)-order(b)||a.localeCompare(b));
 if(!nsoNames.includes('main'))fail('Incomplete ExeFS: missing main.');
 const entries=[];
 for(const name of nsoNames){
  const file=path.join(exefsDir,name),st=fs.statSync(file);
  const fd=fs.openSync(file,'r'),magic=Buffer.alloc(4);
  try{fs.readSync(fd,magic,0,4,0);}finally{fs.closeSync(fd);}
  if(magic.toString('ascii')!=='NSO0')fail('Non-NSO file in exefs/: '+name);
  entries.push({name,file,size:st.size});
 }
 entries.push({name:'main.npdm',file:hostPolicyFile,size:policy.length});
 const strings=Buffer.from(entries.map(e=>e.name+'\0').join(''));
 const header=Buffer.alloc(16+entries.length*24+strings.length);
 header.write('PFS0',0,'ascii');
 header.writeUInt32LE(entries.length,4);
 header.writeUInt32LE(strings.length,8);
 let cursor=0,nameAt=0;
 entries.forEach((e,i)=>{
  const at=16+i*24;
  header.writeBigUInt64LE(BigInt(cursor),at);
  header.writeBigUInt64LE(BigInt(e.size),at+8);
  header.writeUInt32LE(nameAt,at+16);
  cursor+=e.size;nameAt+=Buffer.byteLength(e.name)+1;
 });
 strings.copy(header,16+entries.length*24);
 fs.mkdirSync(path.dirname(outputFile),{recursive:true});
 const fd=fs.openSync(outputFile,'w');
 try{
  fs.writeSync(fd,header);
  const chunk=Buffer.alloc(4*1024*1024);
  for(const e of entries){
   const rfd=fs.openSync(e.file,'r');
   try{
    let n;while((n=fs.readSync(rfd,chunk,0,chunk.length,null))>0)fs.writeSync(fd,chunk,0,n);
   }finally{fs.closeSync(rfd);}
  }
 }finally{fs.closeSync(fd);}
 return{hostId,modules:entries.map(e=>e.name),size:fs.statSync(outputFile).size};
}

function parseNupPackages(nupFile){
 let info;
 try{info=execFileSync(NUP_BIN,['info',nupFile],{encoding:'utf8'});}
 catch(err){
  if(err&&err.code==='ENOENT')fail('nup tool not found in WSL. Click "Install nup" in the Setup Guide tab, or run: python3 -m venv ~/.ns2-game-loader/nup-venv && ~/.ns2-game-loader/nup-venv/bin/pip install nup');
  throw err;
 }
 const pkgs=[];
 for(const line of info.split(/\r?\n/)){
  const m=line.match(/^\s*\[(\d+)\]\s+(\S+)\s+([0-9A-Fa-f]{16})/);
  if(m)pkgs.push({index:Number(m[1]),kind:m[2].toLowerCase(),titleId:m[3].toLowerCase()});
 }
 if(!pkgs.length)fail('No packages found inside '+nupFile);
 return pkgs;
}

function extractBaseOnlyRomfs(nupFile,baseIdx,updateIdx,destDir){
 const py=`
import sys, pathlib
from nup.reader import NupReader
nup_file, base_idx, upd_idx, dest = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), pathlib.Path(sys.argv[4])
dest.mkdir(parents=True, exist_ok=True)
with NupReader(nup_file) as r:
    base_pkg = r.packages[base_idx]
    upd_pkg = r.packages[upd_idx]
    upd_paths = {n.path for n in upd_pkg.files if n.path.startswith('romfs/')}
    base_only = [n for n in base_pkg.files if n.path.startswith('romfs/') and n.path not in upd_paths]
    print(f'Base-only files to merge: {len(base_only)}')
    for n in base_only:
        rel = n.path[len('romfs/'):]
        out = dest / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open('wb') as f:
            for chunk in r.iter_file_data(n):
                f.write(chunk)
`;
 execFileSync(NUP_PY,['-c',py,nupFile,String(baseIdx),String(updateIdx),destDir],{stdio:'inherit'});
}

async function addHost(sourcePath,hostName){
 sourcePath=path.resolve(sourcePath);
 if(!fs.existsSync(sourcePath))fail('File not found: '+sourcePath);
 let npdmBuf;
 const tmpDir=fs.mkdtempSync(path.join(os.tmpdir(),'ns2-host-'));
 try{
  if(/\.nup$/i.test(sourcePath)){
   const pkgs=parseNupPackages(sourcePath);
   const chosen=pkgs.find(p=>p.kind==='update')||pkgs.find(p=>p.kind==='base')||pkgs[0];
   console.log('Extracting main.npdm from package ['+chosen.index+'] '+chosen.kind+'...');
   execFileSync(NUP_BIN,['extract','--package',String(chosen.index),'--subtree','exefs',sourcePath,tmpDir],{stdio:'inherit'});
   const npdmFile=path.join(tmpDir,'main.npdm');
   const altFile=path.join(tmpDir,'exefs','main.npdm');
   const found=fs.existsSync(npdmFile)?npdmFile:fs.existsSync(altFile)?altFile:null;
   if(!found)fail('main.npdm not found inside '+sourcePath);
   npdmBuf=fs.readFileSync(found);
  }else{
   npdmBuf=fs.readFileSync(sourcePath);
  }
  const hostId=readNpdmProgramId(npdmBuf);
  fs.mkdirSync(POLICIES_DIR,{recursive:true});
  const dest=path.join(POLICIES_DIR,hostId+'.npdm');
  fs.writeFileSync(dest,npdmBuf);
  if(hostName){const names=loadHostNames();names[hostId]=hostName;saveHostNames(names);}
  console.log('Host registered successfully!');
  console.log('  Title ID: '+hostId+(hostName?' ('+hostName+')':''));
  console.log('  Policy:   '+dest);
 }finally{fs.rmSync(tmpDir,{recursive:true,force:true});}
}

function parseArgs(argv){
 const o={mode:'prepare',nup:null,name:null,host:null,hostName:null,sd:null,out:null,autoPatch:true};
 const pos=[];
 for(let i=0;i<argv.length;i++){
  const a=argv[i];
  if(a==='--help'||a==='-h'){o.mode='help';return o;}
  else if(a==='--list-hosts'){o.mode='list-hosts';return o;}
  else if(a==='--add-host'){o.mode='add-host';o.nup=argv[++i];}
  else if(a==='--host'){o.host=argv[++i];}
  else if(a==='--host-name'){o.hostName=argv[++i];}
  else if(a==='--sd'){o.sd=argv[++i];}
  else if(a==='--out'){o.out=argv[++i];}
  else if(a==='--no-auto-patch'){o.autoPatch=false;}
  else if(a.startsWith('--'))fail('Unknown option: '+a+'\n\n'+USAGE);
  else pos.push(a);
 }
 if(o.mode==='prepare'){o.nup=pos[0];o.name=pos[1];}
 return o;
}

async function chooseHostPolicy(hostOpt){
 const policies=listHostPolicies();
 if(!policies.length)fail('No host game registered in '+POLICIES_DIR+'. Run: ns2-prepare --add-host <host.nup>');
 if(hostOpt){
  const needle=hostOpt.toLowerCase();
  const found=policies.find(p=>p.id===needle||(p.name&&p.name.toLowerCase()===needle));
  if(!found)fail('Host "'+hostOpt+'" not found. Registered hosts: '+policies.map(p=>p.id+(p.name?' ('+p.name+')':'')).join(', '));
  return found;
 }
 if(policies.length===1)return policies[0];
 if(!process.stdin.isTTY)fail('Multiple host games registered. Pass --host <TITLE_ID>.');
 console.log('\nAvailable host games:');
 policies.forEach((p,i)=>console.log('  '+(i+1)+') '+p.id+(p.name?' ('+p.name+')':'')));
 while(true){
  const ans=String(await askLine('Choose host game (1-'+policies.length+'): ')).trim();
  const idx=Number(ans)-1;
  if(/^\d+$/.test(ans)&&idx>=0&&idx<policies.length)return policies[idx];
  console.log('Invalid choice.');
 }
}

async function main(argv=process.argv.slice(2)){
 const o=parseArgs(argv);
 if(o.mode==='help'){console.log(USAGE);return;}
 if(o.mode==='list-hosts'){
  const policies=listHostPolicies();
  if(!policies.length)console.log('No host registered.');
  else policies.forEach(p=>console.log(p.id+(p.name?'  '+p.name:'')+'  ['+p.file+']'));
  return;
 }
 if(o.mode==='add-host'){
  if(!o.nup)fail('Specify a .nup or main.npdm path after --add-host.');
  await addHost(o.nup,o.hostName);
  return;
 }
 if(!o.nup||!o.name)fail(USAGE);
 if(!/^[A-Za-z0-9._-]+$/.test(o.name))fail('Game name may only contain letters, digits, dots, hyphens, or underscores.');
 const nupFile=path.resolve(o.nup);
 if(!fs.existsSync(nupFile))fail('NUP file not found: '+nupFile);
 const host=await chooseHostPolicy(o.host);
 console.log('Selected host: '+host.id+(host.name?' ('+host.name+')':''));

 const outDir=o.out
  ? path.resolve(o.out)
  : o.sd
   ? path.join(path.resolve(o.sd),'ns2jb-modloader','contents',host.id,'games',o.name)
   : path.join(DEFAULT_OUT_BASE,host.id,'games',o.name);
 if(fs.existsSync(outDir))fail('Destination folder already exists: '+outDir+' (remove it or choose another name).');

 const pkgs=parseNupPackages(nupFile);
 const basePkg=pkgs.find(p=>p.kind==='base')||pkgs[0];
 const updatePkg=pkgs.find(p=>p.kind==='update')||null;
 const codePkg=updatePkg||basePkg;
 console.log('NUP packages found: '+pkgs.map(p=>'['+p.index+'] '+p.kind+' ('+p.titleId+')').join(', '));

 const tmpDir=fs.mkdtempSync(path.join(os.tmpdir(),'ns2-prep-'));
 try{
  // 1) Extract ExeFS
  const exefsTmp=path.join(tmpDir,'exefs-extract');
  console.log('\n[1/4] Extracting ExeFS from package ['+codePkg.index+'] '+codePkg.kind+'...');
  execFileSync(NUP_BIN,['extract','--package',String(codePkg.index),'--subtree','exefs',nupFile,exefsTmp],{stdio:'inherit'});
  const exefsDir=fs.existsSync(path.join(exefsTmp,'main'))?exefsTmp:path.join(exefsTmp,'exefs');

  // 2) Pack exefs.nsp + detect MountTemporaryStorage patch
  fs.mkdirSync(outDir,{recursive:true});
  console.log('\n[2/4] Packing exefs.nsp for host '+host.id+'...');
  const exefsOut=path.join(outDir,'exefs.nsp');
  const packed=packExefsNsp(exefsDir,host.file,exefsOut);
  console.log('      Packed modules: '+packed.modules.join(', ')+' ('+(packed.size/1024/1024).toFixed(1)+' MB)');

  if(o.autoPatch){
   const patch=detectTempStoragePatch(exefsDir);
   if(patch){
    const patchDir=path.join(outDir,'exefs_patches');
    fs.mkdirSync(patchDir,{recursive:true});
    const patchFile=path.join(patchDir,patch.buildId+'.ips32');
    fs.writeFileSync(patchFile,patch.bytes);
    console.log('      [AUTO-PATCH] Detected MountTemporaryStorage! Generated 23 B patch: exefs_patches/'+patch.buildId+'.ips32');
   }else{
    console.log('      No MountTemporaryStorage import in main (no patch needed).');
   }
  }

  // 3) Extract & build romfs.bin
  console.log('\n[3/4] Extracting and building romfs.bin (may take a few minutes)...');
  const mainRomfsTmp=path.join(tmpDir,'romfs-main');
  const baseOnlyTmp=path.join(tmpDir,'romfs-base-only');
  fs.mkdirSync(baseOnlyTmp,{recursive:true});
  execFileSync(NUP_BIN,['extract','--package',String(codePkg.index),'--subtree','romfs',nupFile,mainRomfsTmp],{stdio:'inherit'});
  const mainRomfsDir=fs.existsSync(path.join(mainRomfsTmp,'romfs'))?path.join(mainRomfsTmp,'romfs'):mainRomfsTmp;
  if(updatePkg&&basePkg&&updatePkg.index!==basePkg.index){
   console.log('      Base and update detected: extracting base-only files...');
   extractBaseOnlyRomfs(nupFile,basePkg.index,updatePkg.index,baseOnlyTmp);
  }
  const romfsOut=path.join(outDir,'romfs.bin');
  execFileSync('python3',[MERGE_ROMFS,'--update',mainRomfsDir,'--base-only',baseOnlyTmp,'--image',romfsOut,'build'],{stdio:'inherit'});

  // 4) Offline sanity check
  console.log('\n[4/4] Verifying generated package offline...');
  const checkRoot=path.join(tmpDir,'check-root');
  const linkDir=path.join(checkRoot,'contents',host.id,'games');
  fs.mkdirSync(linkDir,{recursive:true});
  const stagingCheck=path.join(linkDir,o.name);
  // Inspect directly using temp layout with tiny copy-free check via controlla-sd
  const fakeRoot=o.sd?path.join(path.resolve(o.sd),'ns2jb-modloader'):null;
  if(fakeRoot){
   await inspect(fakeRoot);
  }else{
   // Create a minimal check root with hardlinks so no copying occurs (same filesystem)
   fs.mkdirSync(stagingCheck,{recursive:true});
   for(const item of ['exefs.nsp','romfs.bin']){
    try{fs.linkSync(path.join(outDir,item),path.join(stagingCheck,item));}catch{}
   }
   if(fs.existsSync(path.join(stagingCheck,'exefs.nsp')))await inspect(checkRoot);
  }

  console.log('\nREADY! Game prepared at:\n  '+outDir);
  if(!o.sd){
   console.log('\nTo copy onto microSD mounted at /mnt/d:');
   console.log('  mkdir -p /mnt/d/ns2jb-modloader/contents/'+host.id+'/games && cp -r "'+outDir+'" /mnt/d/ns2jb-modloader/contents/'+host.id+'/games/');
  }
 }catch(e){
  fs.rmSync(outDir,{recursive:true,force:true});
  throw e;
 }finally{
  fs.rmSync(tmpDir,{recursive:true,force:true});
 }
}
module.exports={main,parseArgs,readNpdmProgramId,detectTempStoragePatch,packExefsNsp};
if(require.main===module)main().catch(e=>{console.error('ERROR: '+e.message);process.exitCode=1;});

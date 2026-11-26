'use strict';
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const {check}=require('./common.cjs');
const {applyProfile}=require('./mods.cjs');

function loadHostNames(){
 try{
  const file=path.resolve(__dirname,'../../host-policies/hosts.json');
  if(fs.existsSync(file))return JSON.parse(fs.readFileSync(file,'utf8'));
 }catch{}
 return {};
}
function hostLabel(titleId,names=loadHostNames()){
 const label=names[titleId.toLowerCase()];
 return label?titleId+' ('+label+')':titleId;
}
function formatSize(bytes){
 if(bytes>=1024**3)return (bytes/1024**3).toFixed(2)+' GB';
 if(bytes>=1024**2)return (bytes/1024**2).toFixed(1)+' MB';
 if(bytes>=1024)return (bytes/1024).toFixed(1)+' KB';
 return bytes+' B';
}
function summarizeProfile(p){
 const parts=[];
 if(p.exefsImage)parts.push('exefs.nsp ('+formatSize(p.exefsImage.size)+')');
 if(p.exefs.length)parts.push(p.exefs.length+' ExeFS files');
 if(p.romfsImage)parts.push('romfs.bin ('+formatSize(p.romfsImage.size)+')');
 const romfsFiles=p.romfs.filter(f=>f.type==='file').length;
 if(romfsFiles)parts.push(romfsFiles+' RomFS files');
 if(p.patches.length)parts.push(p.patches.length+' IPS patch'+(p.patches.length===1?'':'es'));
 return parts.length?parts.join(', '):'empty';
}
function askLine(question){
 return new Promise((resolve,reject)=>{
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  rl.on('SIGINT',()=>{rl.close();reject(Error('Selection cancelled by user.'));});
  rl.question(question,answer=>{rl.close();resolve(answer);});
 });
}
async function selectHosts(collection,{titles=[],game=null,prompt=null,interactive=Boolean((process.stdin.isTTY&&process.stdout.isTTY)||process.env.NS2_INTERACTIVE==='1')}={}){
 if(titles.length||collection.games.length<=1)return collection;
 if(game){
  const needle=game.trim().toLowerCase();
  const matching=collection.games.filter(g=>(g.profiles||[]).some(p=>p.name.toLowerCase()===needle));
  if(matching.length===1){collection.games=matching;return collection;}
 }
 if(!prompt&&!interactive)return collection;
 const names=loadHostNames();
 console.log('\nHost titles found on SD:');
 collection.games.forEach((g,i)=>{
  const count=(g.profiles||[]).length;
  const info=count?count+' game'+(count===1?'':'s')+' in games/':'direct layout';
  console.log('  '+(i+1)+') '+hostLabel(g.titleId,names)+' ['+info+']');
 });
 console.log('  '+(collection.games.length+1)+') All hosts together');
 const ask=prompt||askLine;
 let chosen=null;
 while(!chosen){
  const raw=String(await ask('Choose which host to use (1-'+(collection.games.length+1)+'): ')).trim();
  if(/^\d+$/.test(raw)){
   const idx=Number(raw)-1;
   if(idx>=0&&idx<collection.games.length)chosen=[collection.games[idx]];
   else if(idx===collection.games.length)chosen=collection.games;
  }else{
   const byId=collection.games.find(g=>g.titleId.toLowerCase()===raw.toLowerCase());
   if(byId)chosen=[byId];
  }
  if(!chosen)console.log('Invalid choice. Enter a number between 1 and '+(collection.games.length+1)+'.');
 }
 collection.games=chosen;
 return collection;
}
async function selectGames(collection,{titles=[],game=null,prompt=null,interactive=Boolean((process.stdin.isTTY&&process.stdout.isTTY)||process.env.NS2_INTERACTIVE==='1')}={}){
 await selectHosts(collection,{titles,game,prompt,interactive});
 const names=loadHostNames();
 for(const g of collection.games){
  const label=hostLabel(g.titleId,names);
  const profiles=g.profiles||[];
  if(!profiles.length){
   if(game)throw Error('No games/ folder found on SD for host '+label+'. Place games under SD:/ns2jb-modloader/contents/'+g.titleId+'/games/<name>/');
   continue;
  }
  if(game){
   const needle=game.trim().toLowerCase();
   const found=profiles.find(p=>p.name.toLowerCase()===needle);
   check(found,'Game "'+game+'" not found for host '+label+'. Available games: '+profiles.map(p=>p.name).join(', '));
   applyProfile(g,found);
   console.log('Selected game for '+label+': '+found.name+' ['+summarizeProfile(found)+']');
   continue;
  }
  if(profiles.length===1){
   applyProfile(g,profiles[0]);
   console.log('Game found for '+label+': '+profiles[0].name+' ['+summarizeProfile(profiles[0])+'] (auto-selected)');
   continue;
  }
  const listNames=profiles.map(p=>p.name).join(', ');
  if(!prompt&&!interactive)throw Error('Found '+profiles.length+' games for host '+label+' ('+listNames+'). Run interactively or pass --game <name>.');
  console.log('\nAvailable games on SD for host '+label+':');
  profiles.forEach((p,i)=>console.log('  '+(i+1)+') '+p.name+' ['+summarizeProfile(p)+']'));
  const ask=prompt||askLine;
  let chosen=null;
  while(!chosen){
   const raw=String(await ask('Choose which game to launch (1-'+profiles.length+' or name): ')).trim();
   if(/^\d+$/.test(raw)){
    const idx=Number(raw)-1;
    if(idx>=0&&idx<profiles.length)chosen=profiles[idx];
   }else{
    chosen=profiles.find(p=>p.name.toLowerCase()===raw.toLowerCase())||null;
   }
   if(!chosen)console.log('Invalid choice. Enter a number between 1 and '+profiles.length+' or one of: '+listNames);
  }
  applyProfile(g,chosen);
  console.log('Selected game: '+chosen.name+' ['+summarizeProfile(chosen)+']\n');
 }
 return collection;
}
module.exports={selectGames,selectHosts,summarizeProfile,loadHostNames,hostLabel};

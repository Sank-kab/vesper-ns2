#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-2.0-only */
'use strict';
const {checkSession}=require('./session-guard.cjs');
function options(args){
 let run,title=null,game=null;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--run-dir')run=args[++i];
  else if(args[i]==='--title')title=args[++i];
  else if(args[i]==='--game')game=args[++i];
  else throw Error('Usage: node launch-backend.cjs [--game GAME_NAME] [--title HOST_TITLE_ID] [--run-dir "/path/to/runs/switch2-SESSION"]');
 }
 if(title!==null&&!/^0[14][0-9a-f]{14}$/i.test(title))throw Error('A valid 16-hex Title ID is required.');
 if(game!==null&&(!game||game.startsWith('--')))throw Error('Specify a valid game name after --game.');
 return{run,title:title?title.toLowerCase():null,game};
}
async function main(args=process.argv.slice(2)){
 const input=options(args),run=input.run?checkSession(input.run):await require('./backend/lib/find-session.cjs').findSession(checkSession);
 require('./backend/lib/native/artifacts.cjs').artifacts();
 console.log('Verified RPC session selected. Installing backend'+(input.title?' for host '+input.title:' (auto-detecting hosts on SD)')+(input.game?' (game: '+input.game+')':'')+'.');
 const installArgs=['--sd','--run-dir',run,'--runtime-trace'];
 if(input.title)installArgs.push('--title',input.title);
 if(input.game)installArgs.push('--game',input.game);
 await require('./backend/install.cjs').main(installArgs);
}
module.exports={main,options};
if(require.main===module)main().catch(e=>{console.error('LAUNCH STOPPED: '+e.message);process.exitCode=1;});

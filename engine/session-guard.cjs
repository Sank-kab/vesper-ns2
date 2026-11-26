/* SPDX-License-Identifier: GPL-2.0-only */
'use strict';
const fs=require('node:fs'),path=require('node:path');
function checkSession(directory){
 const run=path.resolve(directory);
 const marker=path.join(run,'switch2','ro','hen-startup.json');
 if(fs.existsSync(marker))throw Error('Questa sessione contiene un avvio HEN. Serve un nuovo boot RPC standard, non hen.cjs. Nessun backend installato.');
 const result=JSON.parse(fs.readFileSync(path.join(run,'result.json'),'utf8'));
 if(!result.verified||result.rpc?.state!=='listening'||result.completed)throw Error('La sessione non risulta RPC 4/4 in ascolto.');
 const connection=JSON.parse(fs.readFileSync(path.join(run,'connection.json'),'utf8'));
 if(!Number.isInteger(connection.port)||connection.port<1||connection.port>65535||connection.addresses?.session!==path.basename(run))throw Error('Identita della connessione RPC non valida.');
 // Upstream also checks the same-boot proof, kernel RO identity and native FS ABI.
 require('./backend/install.cjs').verifiedRun(run);
 return run;
}
module.exports={checkSession};

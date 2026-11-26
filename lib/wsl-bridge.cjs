'use strict';
const {spawn, execFile} = require('node:child_process');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {loadConfig, BUNDLED_ENGINE_WIN} = require('./config.cjs');

const WSL_NODE_EXPORT = 'if [ -d "$HOME/.nvm/versions/node" ]; then export PATH="$HOME/.nvm/versions/node/$(ls -1 $HOME/.nvm/versions/node 2>/dev/null | sort -V | tail -n 1)/bin:$PATH"; fi';
const NS2JB_PID_FILE = '/tmp/ns2-gl-rpc.pid';
const BACKEND_PID_FILE = '/tmp/ns2-gl-backend.pid';
const PREPARE_PID_FILE = '/tmp/ns2-gl-prepare.pid';
const NS2JB_REPO_URL = 'https://gitlab.com/kurumuz/ns2jb.git';

function winToWslPath(winPath) {
  const resolved = path.resolve(winPath);
  const m = resolved.match(/^([A-Za-z]):\\(.*)$/);
  if (!m) return resolved.replace(/\\/g, '/');
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}

function wslToUncPath(wslPath, distro = null) {
  const d = (distro || loadConfig().wslDistro || 'Ubuntu').trim();
  return `\\\\wsl.localhost\\${d}${wslPath.replace(/\//g, '\\')}`;
}

function wslArgs(bashCmd, distro = null) {
  const d = (distro !== null ? distro : loadConfig().wslDistro).trim();
  const base = d ? ['-d', d, '--'] : ['--'];
  return [...base, 'bash', '-c', `${WSL_NODE_EXPORT}; ${bashCmd}`];
}

function expandWslDir(dir) {
  const safe = String(dir || '').trim();
  if (safe === '~') return '"$HOME"';
  if (safe.startsWith('~/')) return `"$HOME/${safe.slice(2).replace(/"/g, '\\"')}"`;
  return `'${safe.replace(/'/g, "'\\''")}'`;
}

function resolveBackendDir(cfg) {
  if (cfg.backendDir && cfg.backendDir.trim()) return expandWslDir(cfg.backendDir.trim());
  return expandWslDir(winToWslPath(BUNDLED_ENGINE_WIN));
}

function nupEnvPrefix(cfg) {
  if (!cfg.nupVenv || !cfg.nupVenv.trim()) return '';
  return `NS2_NUP_VENV=${expandWslDir(cfg.nupVenv.trim())} `;
}

function getLocalIPv4s() {
  const ips = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const addr of list || []) {
      if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.')) {
        ips.push({name, address: addr.address});
      }
    }
  }
  return ips;
}

function runWslCommand(bashCmd, timeout = 30000, distro = null) {
  return new Promise((resolve, reject) => {
    execFile(
      'wsl.exe',
      wslArgs(bashCmd, distro),
      {windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024},
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || stdout || err.message || '').trim();
          return reject(new Error(msg));
        }
        resolve(String(stdout || ''));
      }
    );
  });
}

function copyFileAsync(src, dst, label, onProgress) {
  return new Promise((resolve, reject) => {
    const total = fs.statSync(src).size;
    let copied = 0;
    let lastPct = -1;
    onProgress(`Copying to microSD: ${label} (${(total / 1024 / 1024).toFixed(1)} MB)...`);
    const rs = fs.createReadStream(src, {highWaterMark: 4 * 1024 * 1024});
    const ws = fs.createWriteStream(dst);
    rs.on('data', chunk => {
      copied += chunk.length;
      if (total > 50 * 1024 * 1024) {
        const pct = Math.floor((copied / total) * 100);
        if (pct >= lastPct + 10) {
          lastPct = pct;
          onProgress(`  ${label}: ${pct}% (${(copied / 1024 / 1024 / 1024).toFixed(2)} / ${(total / 1024 / 1024 / 1024).toFixed(2)} GB)`);
        }
      }
    });
    rs.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    rs.pipe(ws);
  });
}

async function copyDirAsync(srcDir, destDir, onProgress) {
  fs.mkdirSync(destDir, {recursive: true});
  const entries = fs.readdirSync(srcDir, {withFileTypes: true});
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirAsync(src, dst, onProgress);
    } else if (entry.isFile()) {
      await copyFileAsync(src, dst, entry.name, onProgress);
    }
  }
}

class WslBridge extends EventEmitter {
  constructor() {
    super();
    this.ns2jb = {proc: null, vector: 'smilebasic', status: 'stopped', stageKey: 'idle', stageExtra: null, ip: null, session: null, smileBasicHint: null, logs: []};
    this.backend = {proc: null, status: 'idle', prompt: null, lastReady: false, logs: []};
    this.prepare = {proc: null, copying: false, status: 'idle', logs: [], lastOutput: null};
  }

  _pushLog(bucket, stream, text) {
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    for (const line of lines) {
      if (!line) continue;
      const entry = {ts: new Date().toLocaleTimeString(), stream, line};
      this[bucket].logs.push(entry);
      if (this[bucket].logs.length > 400) this[bucket].logs.shift();
      this.emit('log', {bucket, ...entry});
      this._inspectLine(bucket, line);
    }
  }

  _inspectLine(bucket, line) {
    if (bucket === 'ns2jb') {
      if (/V=START\(/i.test(line) || /LOAD\s+"/i.test(line)) {
        this.ns2jb.smileBasicHint = line.trim();
        this.ns2jb.stageKey = 'waitingSmileBasic';
        this.emit('state');
      }
      const sessMatch = line.match(/(switch2-[A-Za-z0-9]+)/);
      if (sessMatch) this.ns2jb.session = sessMatch[1];
      if (/RPC.*listening|listening.*RPC|FS 4\/4|Ready for RPC/i.test(line)) {
        this.ns2jb.status = 'ready';
        this.ns2jb.stageKey = 'rpcReady';
        this.emit('state');
      }
    } else if (bucket === 'backend') {
      if (/^\s*(\d+)\)\s+(.+)$/.test(line)) {
        const m = line.match(/^\s*(\d+)\)\s+(.+)$/);
        if (!this.backend.prompt) this.backend.prompt = {question: '', options: []};
        this.backend.prompt.options.push({value: m[1], label: m[2].trim()});
        this.emit('state');
      } else if (/(Choose which (game|host)|Scegli quale (gioco|host))/i.test(line)) {
        if (!this.backend.prompt) this.backend.prompt = {question: '', options: []};
        this.backend.prompt.question = line.trim();
        this.emit('state');
      } else if (/READY\s+—/i.test(line)) {
        this.backend.prompt = null;
        this.backend.lastReady = true;
        this.backend.status = 'ready';
        this.emit('state');
      }
    } else if (bucket === 'prepare') {
      const m = line.match(/^\s+(\/.+\/ready\/.+)$/);
      if (m) this.prepare.lastOutput = m[1].trim();
    }
  }

  getState() {
    return {
      ns2jb: {
        vector: this.ns2jb.vector,
        status: this.ns2jb.status,
        stageKey: this.ns2jb.stageKey,
        stageExtra: this.ns2jb.stageExtra,
        ip: this.ns2jb.ip,
        session: this.ns2jb.session,
        smileBasicHint: this.ns2jb.smileBasicHint,
        logs: this.ns2jb.logs.slice(-120)
      },
      backend: {
        status: this.backend.status,
        prompt: this.backend.prompt,
        lastReady: this.backend.lastReady,
        logs: this.backend.logs.slice(-120)
      },
      prepare: {
        status: this.prepare.status,
        lastOutput: this.prepare.lastOutput,
        logs: this.prepare.logs.slice(-120)
      }
    };
  }

  async testConnection(cfg = loadConfig()) {
    const nsDir = expandWslDir(cfg.ns2jbDir);
    const civDir = expandWslDir(cfg.civ7Dir);
    const bkDir = resolveBackendDir(cfg);
    const nupCheck = cfg.nupVenv && cfg.nupVenv.trim()
      ? `[ -x ${expandWslDir(cfg.nupVenv.trim())}/bin/nup ]`
      : '[ -x "$HOME/.ns2-game-loader/nup-venv/bin/nup" ] || command -v nup >/dev/null 2>&1';
    const script = [
      'printf "DISTRO=%s\n" "${WSL_DISTRO_NAME:-unknown}"',
      'printf "NODE="; node --version 2>/dev/null || echo missing',
      'printf "GIT="; git --version 2>/dev/null || echo missing',
      'printf "PYTHON="; python3 --version 2>/dev/null || echo missing',
      `[ -f ${nsDir}/run.cjs ] && echo NS2JB=ok || echo NS2JB=missing`,
      `[ -d ${civDir} ] && echo CIV7=ok || echo CIV7=missing`,
      `[ -f ${bkDir}/launch-backend.cjs ] && echo BACKEND=ok || echo BACKEND=missing`,
      `[ -f ${bkDir}/prepare-game.cjs ] && echo PREPARE=ok || echo PREPARE=missing`,
      `(${nupCheck}) && echo NUP=ok || echo NUP=missing`
    ].join('; ');
    const out = await runWslCommand(script, 15000, cfg.wslDistro);
    const res = {};
    for (const line of out.split(/\r?\n/)) {
      const idx = line.indexOf('=');
      if (idx > 0) res[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    const nodeVer = res.NODE || 'missing';
    const nodeMajor = Number((nodeVer.match(/^v(\d+)/) || [])[1] || 0);
    return {
      ok: Boolean(nodeMajor >= 22 && res.NS2JB === 'ok' && res.BACKEND === 'ok'),
      distro: res.DISTRO || cfg.wslDistro || 'default',
      node: nodeVer,
      nodeOk: nodeMajor >= 22,
      git: res.GIT && res.GIT !== 'missing' ? res.GIT : 'missing',
      python: res.PYTHON && res.PYTHON !== 'missing' ? res.PYTHON : 'missing',
      ns2jb: res.NS2JB === 'ok',
      civ7: res.CIV7 === 'ok',
      backend: res.BACKEND === 'ok',
      bundledBackend: !cfg.backendDir || !cfg.backendDir.trim(),
      prepare: res.PREPARE === 'ok',
      nup: res.NUP === 'ok'
    };
  }

  async cloneNs2jb(cfg = loadConfig()) {
    const nsDir = expandWslDir(cfg.ns2jbDir);
    const cmd = `if [ -f ${nsDir}/run.cjs ]; then echo "ns2jb already exists at ${cfg.ns2jbDir}"; else git clone ${NS2JB_REPO_URL} ${nsDir}; fi`;
    const out = await runWslCommand(cmd, 120000, cfg.wslDistro);
    return out.trim() || `Cloned ns2jb into ${cfg.ns2jbDir}`;
  }

  async installNup(cfg = loadConfig()) {
    const venvDir = cfg.nupVenv && cfg.nupVenv.trim()
      ? expandWslDir(cfg.nupVenv.trim())
      : '"$HOME/.ns2-game-loader/nup-venv"';
    const cmd = `mkdir -p "$HOME/.ns2-game-loader" && ([ -x ${venvDir}/bin/pip ] || python3 -m venv ${venvDir}) && ${venvDir}/bin/pip install --upgrade nup`;
    const out = await runWslCommand(cmd, 180000, cfg.wslDistro);
    return out.trim() || 'Installed nup in WSL';
  }

  async listHosts() {
    const cfg = loadConfig();
    const bkDir = resolveBackendDir(cfg);
    const out = await runWslCommand(`node ${bkDir}/prepare-game.cjs --list-hosts`, 30000, cfg.wslDistro);
    const hosts = [];
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^(0[14][0-9a-f]{14})\s*(.*?)\s*\[(.+)\]$/i);
      if (m) hosts.push({id: m[1].toLowerCase(), name: m[2].trim() || null, file: m[3].trim()});
    }
    return hosts;
  }

  async addHost(winPath, hostName) {
    const cfg = loadConfig();
    const bkDir = resolveBackendDir(cfg);
    const wslPath = winToWslPath(winPath);
    const args = ['--add-host', wslPath];
    if (hostName && hostName.trim()) args.push('--host-name', hostName.trim());
    const escaped = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
    const out = await runWslCommand(`${nupEnvPrefix(cfg)}node ${bkDir}/prepare-game.cjs ${escaped}`, 120000, cfg.wslDistro);
    return out.trim();
  }

  startNs2jb({ip = null, vector = 'smilebasic'} = {}) {
    if (this.ns2jb.proc) throw new Error('Exploit RPC host is already running.');
    const cfg = loadConfig();
    const isCiv = vector === 'civ7';
    const targetDir = expandWslDir(isCiv ? cfg.civ7Dir : cfg.ns2jbDir);

    this.ns2jb.logs = [];
    this.ns2jb.vector = isCiv ? 'civ7' : 'smilebasic';
    this.ns2jb.status = 'starting';
    this.ns2jb.stageKey = 'starting';
    this.ns2jb.stageExtra = null;
    this.ns2jb.ip = ip || null;
    this.ns2jb.session = null;
    this.ns2jb.smileBasicHint = null;
    this.backend.lastReady = false;
    if (!this.backend.proc) this.backend.status = 'idle';
    this.emit('state');

    const ipArg = ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip.trim()) ? ` ${ip.trim()}` : '';
    const launchCmd = isCiv
      ? `${cfg.civ7Cmd || 'node run.cjs --rpc'}${ipArg}`
      : `env -u NS2_RO_IMAGE node run.cjs --rpc${ipArg}`;
    const cmd = `cd ${targetDir} && echo $$ > ${NS2JB_PID_FILE} && exec ${launchCmd}`;
    if (isCiv) {
      this._pushLog('ns2jb', 'info', '[UNTESTED] Starting experimental Civilization VII (CivSwitchFS) vector...');
    }
    const proc = spawn('wsl.exe', wslArgs(cmd, cfg.wslDistro), {windowsHide: true});
    this.ns2jb.proc = proc;

    proc.stdout.on('data', d => this._pushLog('ns2jb', 'stdout', d));
    proc.stderr.on('data', d => this._pushLog('ns2jb', 'stderr', d));
    proc.on('error', err => {
      this._pushLog('ns2jb', 'stderr', 'Process error: ' + err.message);
    });
    proc.on('close', code => {
      this.ns2jb.proc = null;
      this.ns2jb.status = 'stopped';
      this.ns2jb.smileBasicHint = null;
      this.ns2jb.session = null;
      this.ns2jb.stageKey = code === 0 ? 'stoppedClean' : 'stoppedCode';
      this.ns2jb.stageExtra = code;
      this._pushLog('ns2jb', 'info', `--- Exploit RPC host exited (code ${code}) ---`);
      this.emit('state');
    });
  }

  async stopNs2jb() {
    if (!this.ns2jb.proc) return;
    this.ns2jb.status = 'stopping';
    this.ns2jb.stageKey = 'stopping';
    this.emit('state');
    this._pushLog('ns2jb', 'info', 'Sending clean SIGINT for safe cleanup...');
    try {
      const out = await runWslCommand(`if [ -f ${NS2JB_PID_FILE} ]; then kill -INT "$(cat ${NS2JB_PID_FILE})" 2>/dev/null && echo sent || echo missing; else echo missing; fi`, 5000);
      if (out.trim() !== 'sent' && this.ns2jb.proc) this.ns2jb.proc.kill();
    } catch {
      if (this.ns2jb.proc) this.ns2jb.proc.kill();
    }
  }

  sendNs2jbInput(text) {
    if (!this.ns2jb.proc) throw new Error('Exploit RPC host is not running.');
    this.ns2jb.proc.stdin.write(String(text) + '\n');
    this._pushLog('ns2jb', 'stdin', `> ${text}`);
  }

  startBackend({title = null, game = null} = {}) {
    if (this.backend.proc) throw new Error('Backend is already running.');
    const cfg = loadConfig();
    const bkDir = resolveBackendDir(cfg);
    this.backend.logs = [];
    this.backend.status = 'running';
    this.backend.prompt = null;
    this.backend.lastReady = false;
    this.emit('state');

    const args = [];
    if (title && /^0[14][0-9a-f]{14}$/i.test(title.trim())) args.push('--title', title.trim().toLowerCase());
    if (game && game.trim()) args.push('--game', game.trim());
    const escaped = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
    const cmd = `cd ${bkDir} && echo $$ > ${BACKEND_PID_FILE} && exec env NS2_INTERACTIVE=1 node launch-backend.cjs ${escaped}`;
    const proc = spawn('wsl.exe', wslArgs(cmd, cfg.wslDistro), {windowsHide: true});
    this.backend.proc = proc;

    proc.stdout.on('data', d => {
      const text = String(d);
      this._pushLog('backend', 'stdout', text);
      if (/(Choose which (game|host)|Scegli quale (gioco|host))/i.test(text) && !text.endsWith('\n')) {
        if (!this.backend.prompt) this.backend.prompt = {question: '', options: []};
        this.backend.prompt.question = text.trim().split('\n').pop();
        this.emit('state');
      }
    });
    proc.stderr.on('data', d => this._pushLog('backend', 'stderr', d));
    proc.on('error', err => this._pushLog('backend', 'stderr', 'Process error: ' + err.message));
    proc.on('close', code => {
      this.backend.proc = null;
      this.backend.prompt = null;
      this.backend.status = code === 0 ? (this.backend.lastReady ? 'ready' : 'done') : 'error';
      this._pushLog('backend', 'info', `--- Backend exited (code ${code}) ---`);
      this.emit('state');
    });
  }

  sendBackendInput(text) {
    if (!this.backend.proc) throw new Error('Backend is not running.');
    this.backend.prompt = null;
    this.emit('state');
    this.backend.proc.stdin.write(String(text) + '\n');
    this._pushLog('backend', 'stdin', `> ${text}`);
  }

  async stopBackend() {
    if (!this.backend.proc) return;
    try {
      await runWslCommand(`if [ -f ${BACKEND_PID_FILE} ]; then kill -INT "$(cat ${BACKEND_PID_FILE})" 2>/dev/null || true; fi`, 5000);
    } catch {}
  }

  startPrepare({nupPath, gameName, hostId = null, autoPatch = true, copyToSdDrive = null}) {
    if (this.prepare.proc || this.prepare.copying) throw new Error('A game preparation task is already running.');
    if (!nupPath || !gameName) throw new Error('Specify both a .nup file and a game name.');
    if (!/^[A-Za-z0-9._-]+$/.test(gameName)) throw new Error('Invalid game name (use letters, digits, -, _, . only).');

    const cfg = loadConfig();
    const bkDir = resolveBackendDir(cfg);
    this.prepare.logs = [];
    this.prepare.status = 'running';
    this.prepare.lastOutput = null;
    this.emit('state');

    const wslNup = winToWslPath(nupPath);
    const args = [wslNup, gameName];
    if (hostId) args.push('--host', hostId);
    if (!autoPatch) args.push('--no-auto-patch');
    const escaped = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
    const cmd = `echo $$ > ${PREPARE_PID_FILE} && exec env ${nupEnvPrefix(cfg)}node ${bkDir}/prepare-game.cjs ${escaped}`;
    const proc = spawn('wsl.exe', wslArgs(cmd, cfg.wslDistro), {windowsHide: true});
    this.prepare.proc = proc;

    proc.stdout.on('data', d => this._pushLog('prepare', 'stdout', d));
    proc.stderr.on('data', d => this._pushLog('prepare', 'stderr', d));
    proc.on('error', err => this._pushLog('prepare', 'stderr', 'Process error: ' + err.message));
    proc.on('close', async code => {
      this.prepare.proc = null;
      if (code === 0 && copyToSdDrive && this.prepare.lastOutput) {
        const cleanDrive = copyToSdDrive.replace(/[^A-Za-z]/g, '').toUpperCase();
        const m = this.prepare.lastOutput.match(/\/ready\/(0[14][0-9a-f]{14})\/games\/([^/]+)$/i);
        if (m && fs.existsSync(`${cleanDrive}:\\`)) {
          this.prepare.copying = true;
          try {
            let distroName = (cfg.wslDistro || '').trim();
            if (!distroName) {
              distroName = (await runWslCommand('printf "%s" "${WSL_DISTRO_NAME:-Ubuntu}"', 5000, '')).trim() || 'Ubuntu';
            }
            const uncSrc = wslToUncPath(this.prepare.lastOutput, distroName);
            const sdDest = `${cleanDrive}:\\ns2jb-modloader\\contents\\${m[1]}\\games\\${m[2]}`;
            this._pushLog('prepare', 'info', `Copying directly to microSD (${sdDest})...`);
            await copyDirAsync(uncSrc, sdDest, msg => this._pushLog('prepare', 'info', msg));
            this._pushLog('prepare', 'info', 'Copy to microSD complete! Cleaning temporary ready/ folder...');
            runWslCommand(`rm -rf '${this.prepare.lastOutput.replace(/'/g, "'\\''")}'`).catch(() => {});
            this.prepare.status = 'done';
          } catch (err) {
            this._pushLog('prepare', 'stderr', 'SD copy error: ' + err.message);
            this.prepare.status = 'error';
          } finally {
            this.prepare.copying = false;
            this.emit('state');
          }
          return;
        }
      }
      this.prepare.status = code === 0 ? 'done' : 'error';
      this._pushLog('prepare', 'info', `--- Preparation finished (code ${code}) ---`);
      this.emit('state');
    });
  }

  async stopPrepare() {
    if (!this.prepare.proc) return;
    try {
      await runWslCommand(`if [ -f ${PREPARE_PID_FILE} ]; then kill -TERM "$(cat ${PREPARE_PID_FILE})" 2>/dev/null || true; fi`, 5000);
    } catch {}
  }

  async stopAll() {
    await Promise.allSettled([this.stopNs2jb(), this.stopBackend(), this.stopPrepare()]);
  }
}

module.exports = {WslBridge, winToWslPath, wslToUncPath, getLocalIPv4s, runWslCommand, NS2JB_REPO_URL};

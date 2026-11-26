'use strict';
const fs = require('node:fs');
const path = require('node:path');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'last-sd.json');

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '0 B';
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' GB';
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function listCandidateDrives() {
  const drives = [];
  for (let code = 68; code <= 90; code++) { // D: through Z:
    const letter = String.fromCharCode(code);
    const root = `${letter}:\\`;
    try {
      if (fs.existsSync(root)) {
        const hasModloader = fs.existsSync(path.join(root, 'ns2jb-modloader'));
        drives.push({letter, root, hasModloader});
      }
    } catch {}
  }
  return drives;
}

function checkRomfsHeader(filePath) {
  const st = fs.statSync(filePath);
  if (st.size < 80) return {ok: false, size: st.size, error: 'File troppo piccolo per un header RomFS'};
  const fd = fs.openSync(filePath, 'r');
  const h = Buffer.alloc(80);
  try { fs.readSync(fd, h, 0, 80, 0); } finally { fs.closeSync(fd); }
  if (h.readBigUInt64LE(0) !== 80n) return {ok: false, size: st.size, error: 'Header RomFS non valido (size != 80)'};
  const total = BigInt(st.size);
  for (let i = 1; i < 9; i += 2) {
    const off = h.readBigUInt64LE(i * 8);
    const len = h.readBigUInt64LE((i + 1) * 8);
    if (off < 80n || off > total || len > total - off) {
      return {ok: false, size: st.size, error: 'Metadati RomFS fuori dai limiti del file'};
    }
  }
  return {ok: true, size: st.size, sizeHuman: formatSize(st.size)};
}

function checkExefsNsp(filePath) {
  const st = fs.statSync(filePath);
  if (st.size < 16) return {ok: false, size: st.size, error: 'File exefs.nsp troppo piccolo'};
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    if (head.toString('ascii', 0, 4) !== 'PFS0') return {ok: false, size: st.size, error: 'Magic PFS0 non valido'};
    const count = head.readUInt32LE(4);
    const strSize = head.readUInt32LE(8);
    if (count === 0 || count > 64 || strSize > 65536) return {ok: false, size: st.size, error: 'Header PFS0 anomalo'};
    const table = Buffer.alloc(count * 24 + strSize);
    fs.readSync(fd, table, 0, table.length, 16);
    const strStart = count * 24;
    const names = [];
    for (let i = 0; i < count; i++) {
      const nameOff = table.readUInt32LE(i * 24 + 16);
      const end = table.indexOf(0, strStart + nameOff);
      if (end < 0) continue;
      names.push(table.subarray(strStart + nameOff, end).toString('utf8'));
    }
    const ok = names.includes('main') && names.includes('main.npdm');
    return {
      ok,
      size: st.size,
      sizeHuman: formatSize(st.size),
      modules: names,
      ...(ok ? {} : {error: 'ExeFS incompleto (manca main o main.npdm)'})
    };
  } finally {
    fs.closeSync(fd);
  }
}

function inspectGameDir(dirPath, name) {
  const exefsNsp = path.join(dirPath, 'exefs.nsp');
  const romfsBin = path.join(dirPath, 'romfs.bin');
  const patchesDir = path.join(dirPath, 'exefs_patches');
  const exefs = fs.existsSync(exefsNsp) ? checkExefsNsp(exefsNsp) : null;
  const romfs = fs.existsSync(romfsBin) ? checkRomfsHeader(romfsBin) : null;
  const patches = [];
  if (fs.existsSync(patchesDir) && fs.statSync(patchesDir).isDirectory()) {
    for (const f of fs.readdirSync(patchesDir).sort()) {
      if (/\.(ips|ips32|pchtxt)$/i.test(f)) {
        const st = fs.statSync(path.join(patchesDir, f));
        patches.push({name: f, size: st.size});
      }
    }
  }
  const issues = [];
  if (exefs && !exefs.ok) issues.push(exefs.error);
  if (romfs && !romfs.ok) issues.push(romfs.error);
  if (!exefs && !romfs && !patches.length) issues.push('Cartella gioco vuota');
  return {
    name,
    path: dirPath,
    exefs,
    romfs,
    patches,
    ok: issues.length === 0,
    issues
  };
}

function saveCache(scan) {
  try {
    fs.mkdirSync(CACHE_DIR, {recursive: true});
    fs.writeFileSync(CACHE_FILE, JSON.stringify({...scan, cachedAt: new Date().toISOString()}, null, 2) + '\n');
  } catch {}
}

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {}
  return null;
}

function scanSdDrive(preferredLetter = null, hostNames = {}) {
  const drives = listCandidateDrives();
  let chosen = null;
  if (preferredLetter) {
    const clean = preferredLetter.replace(/[^A-Za-z]/g, '').toUpperCase();
    chosen = drives.find(d => d.letter === clean) || null;
  }
  if (!chosen) chosen = drives.find(d => d.hasModloader) || drives.find(d => d.letter === 'D') || null;
  if (!chosen || !chosen.hasModloader) {
    const cached = loadCache();
    return {
      mounted: false,
      drives,
      drive: chosen ? chosen.letter : null,
      hosts: cached ? cached.hosts : [],
      fromCache: Boolean(cached),
      cachedAt: cached ? cached.cachedAt : null
    };
  }
  const contentsDir = path.join(chosen.root, 'ns2jb-modloader', 'contents');
  const hosts = [];
  if (fs.existsSync(contentsDir)) {
    for (const entry of fs.readdirSync(contentsDir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || !/^0[14][0-9a-f]{14}$/i.test(entry.name)) continue;
      const titleId = entry.name.toLowerCase();
      const hostDir = path.join(contentsDir, entry.name);
      const gamesDir = path.join(hostDir, 'games');
      const games = [];
      if (fs.existsSync(gamesDir) && fs.statSync(gamesDir).isDirectory()) {
        for (const sub of fs.readdirSync(gamesDir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
          if (!sub.isDirectory() || sub.name.startsWith('.')) continue;
          games.push(inspectGameDir(path.join(gamesDir, sub.name), sub.name));
        }
      }
      // Also check direct legacy layout if present
      if (fs.existsSync(path.join(hostDir, 'exefs.nsp')) || fs.existsSync(path.join(hostDir, 'romfs.bin'))) {
        games.unshift(inspectGameDir(hostDir, games.length ? 'default' : '(diretto)'));
      }
      hosts.push({
        titleId,
        hostName: hostNames[titleId] || null,
        path: hostDir,
        games
      });
    }
  }
  const result = {
    mounted: true,
    drives,
    drive: chosen.letter,
    modloaderRoot: path.join(chosen.root, 'ns2jb-modloader'),
    hosts,
    fromCache: false,
    cachedAt: null
  };
  saveCache(result);
  return result;
}

module.exports = {scanSdDrive, listCandidateDrives, loadCache, formatSize};

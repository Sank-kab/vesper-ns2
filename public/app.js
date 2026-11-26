'use strict';

const savedLang = localStorage.getItem('ns2_gl_lang');
const browserLang = (navigator.language || 'en').slice(0, 2).toLowerCase();
const initialLang = (savedLang && window.NS2_I18N[savedLang])
  ? savedLang
  : (window.NS2_I18N[browserLang] ? browserLang : 'en');

const state = {
  lang: initialLang,
  activeLog: 'ns2jb',
  selectedGame: null,
  sd: null,
  hosts: [],
  ips: [],
  serverState: null,
  logs: {ns2jb: [], backend: [], prepare: []}
};

const $ = id => document.getElementById(id);

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function t(key, vars = {}) {
  const dict = window.NS2_I18N[state.lang] || window.NS2_I18N.en;
  let str = dict[key] !== undefined ? dict[key] : (window.NS2_I18N.en[key] || key);
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}

function updateCiv7Warning() {
  const isCiv = $('exploit-vector').value === 'civ7';
  $('civ7-warn-box').classList.toggle('hidden', !isCiv);
}

function applyLanguage() {
  document.documentElement.lang = state.lang;
  $('lang-select').value = state.lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  updateCiv7Warning();
  renderIpSelect();
  renderHosts();
  renderSdViews();
  if (state.serverState) renderServerState(state.serverState);
  renderLaunchLog();
  renderPrepareLog();
}

$('lang-select').addEventListener('change', e => {
  state.lang = e.target.value;
  localStorage.setItem('ns2_gl_lang', state.lang);
  applyLanguage();
});

$('exploit-vector').addEventListener('change', updateCiv7Warning);

function showToast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 4200);
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: {'Content-Type': 'application/json'},
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Navigation tabs
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// Log tabs
document.querySelectorAll('.log-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.log-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.activeLog = btn.dataset.log;
    renderLaunchLog();
  });
});

function formatLogLines(lines, fallbackKey = 'logEmpty') {
  if (!lines.length) return t(fallbackKey);
  return lines.map(l => `[${l.ts}] ${l.line}`).join('\n');
}

function renderLaunchLog() {
  const el = $('launch-log-view');
  el.textContent = formatLogLines(state.logs[state.activeLog] || []);
  el.scrollTop = el.scrollHeight;
}

function renderPrepareLog() {
  const el = $('prepare-log-view');
  el.textContent = formatLogLines(state.logs.prepare || [], 'prepInitialLog');
  el.scrollTop = el.scrollHeight;
}

function renderIpSelect() {
  const ipSel = $('ns2jb-ip');
  const prevIp = ipSel.value;
  ipSel.innerHTML = `<option value="">${esc(t('ipAuto'))}</option>`;
  for (const ip of state.ips || []) {
    const opt = document.createElement('option');
    opt.value = ip.address;
    opt.textContent = `${ip.address} (${ip.name})`;
    if (ip.address === prevIp) opt.selected = true;
    ipSel.appendChild(opt);
  }
}

function stageText(ns) {
  const map = {
    idle: 'stageIdle',
    starting: 'stageStarting',
    waitingSmileBasic: 'stageWaitingSmileBasic',
    rpcReady: 'stageRpcReady',
    stopping: 'stageStopping',
    stoppedClean: 'stageStoppedClean',
    stoppedCode: 'stageStoppedCode'
  };
  const key = map[ns.stageKey] || 'stageIdle';
  return t(key, {code: ns.stageExtra ?? ''});
}

function renderServerState(s) {
  state.serverState = s;

  const nsRunning = s.ns2jb.status === 'starting' || s.ns2jb.status === 'ready' || s.ns2jb.status === 'stopping';
  $('btn-start-ns2jb').disabled = nsRunning;
  $('btn-stop-ns2jb').disabled = !nsRunning;
  $('exploit-vector').disabled = nsRunning;
  $('ns2jb-stdin-row').classList.toggle('hidden', !nsRunning);

  const nsPill = $('pill-ns2jb');
  const dotNs = $('dot-ns2jb');
  nsPill.className = 'pill';
  dotNs.className = 'dot';
  if (s.ns2jb.status === 'ready') {
    nsPill.textContent = t('pillRpcReady');
    nsPill.classList.add('green');
    dotNs.classList.add('green');
  } else if (s.ns2jb.status === 'starting') {
    nsPill.textContent = t('pillStarting');
    nsPill.classList.add('cyan');
    dotNs.classList.add('cyan');
  } else if (s.ns2jb.status === 'stopping') {
    nsPill.textContent = t('pillStopping');
    nsPill.classList.add('coral');
    dotNs.classList.add('amber');
  } else {
    nsPill.textContent = t('pillStopped');
  }
  $('sidebar-ns2jb').textContent = stageText(s.ns2jb);

  if (nsRunning && s.ns2jb.smileBasicHint) {
    $('smilebasic-box').classList.remove('hidden');
    $('smilebasic-cmd').textContent = s.ns2jb.smileBasicHint;
  } else {
    $('smilebasic-box').classList.add('hidden');
  }

  const bkRunning = s.backend.status === 'running';
  $('btn-start-backend').disabled = bkRunning;
  $('btn-start-backend-live').disabled = bkRunning;
  $('btn-stop-backend').classList.toggle('hidden', !bkRunning);

  const bkPill = $('pill-backend');
  bkPill.className = 'pill';
  if (s.backend.status === 'ready') {
    bkPill.textContent = t('pillInstalled');
    bkPill.classList.add('green');
  } else if (bkRunning) {
    bkPill.textContent = t('pillInstalling');
    bkPill.classList.add('cyan');
  } else if (s.backend.status === 'error') {
    bkPill.textContent = t('pillError');
    bkPill.classList.add('coral');
  } else {
    bkPill.textContent = t('pillReady');
  }
  $('ready-banner').classList.toggle('hidden', !s.backend.lastReady);

  const pBox = $('backend-prompt-box');
  if (bkRunning && s.backend.prompt && (s.backend.prompt.options.length || s.backend.prompt.question)) {
    pBox.classList.remove('hidden');
    $('backend-prompt-q').textContent = s.backend.prompt.question || t('promptFallback');
    const optEl = $('backend-prompt-options');
    optEl.innerHTML = '';
    for (const opt of s.backend.prompt.options) {
      const b = document.createElement('button');
      b.className = 'btn primary small-btn';
      b.textContent = `${opt.value}) ${opt.label}`;
      b.addEventListener('click', () => {
        api('/api/backend/stdin', {method: 'POST', body: JSON.stringify({text: opt.value})})
          .catch(e => showToast(e.message, true));
      });
      optEl.appendChild(b);
    }
  } else {
    pBox.classList.add('hidden');
  }

  const prRunning = s.prepare.status === 'running';
  $('btn-start-prepare').disabled = prRunning;
  $('btn-stop-prepare').classList.toggle('hidden', !prRunning);
  const prPill = $('pill-prepare');
  prPill.className = 'pill';
  if (prRunning) {
    prPill.textContent = t('pillWorking');
    prPill.classList.add('cyan');
  } else if (s.prepare.status === 'done') {
    prPill.textContent = t('pillDone');
    prPill.classList.add('green');
  } else if (s.prepare.status === 'error') {
    prPill.textContent = t('pillError');
    prPill.classList.add('coral');
  } else {
    prPill.textContent = t('pillIdle');
  }
}

function renderSdViews() {
  const sd = state.sd;
  if (!sd) return;

  const dotSd = $('dot-sd');
  dotSd.className = 'dot';
  if (sd.mounted) {
    dotSd.classList.add('green');
    $('sidebar-sd').textContent = t('sdConnected', {drive: sd.drive});
    $('prep-sd-label').textContent = `${sd.drive}:`;
  } else {
    dotSd.classList.add('amber');
    $('sidebar-sd').textContent = sd.fromCache ? t('sdCached') : t('sdNotInserted');
    $('prep-sd-label').textContent = `D: (${t('sdNotInsertedShort')})`;
  }

  const driveSel = $('sd-drive-select');
  driveSel.innerHTML = '';
  const drives = sd.drives && sd.drives.length ? sd.drives : [{letter: 'D', hasModloader: false}];
  for (const d of drives) {
    const opt = document.createElement('option');
    opt.value = d.letter;
    opt.textContent = `${d.letter}:` + (d.hasModloader ? ' (modloader)' : '');
    if (d.letter === sd.drive) opt.selected = true;
    driveSel.appendChild(opt);
  }

  const picker = $('launch-games-list');
  picker.innerHTML = '';
  const allGames = [];
  for (const h of sd.hosts || []) {
    for (const g of h.games || []) {
      allGames.push({host: h, game: g});
    }
  }
  if (!allGames.length) {
    state.selectedGame = null;
    picker.innerHTML = `<div class="empty-note">${t('noCachedGames')}</div>`;
  } else {
    const stillValid = state.selectedGame && allGames.some(
      x => x.host.titleId === state.selectedGame.titleId && x.game.name === state.selectedGame.name
    );
    if (!stillValid) {
      state.selectedGame = {titleId: allGames[0].host.titleId, name: allGames[0].game.name};
    }
    for (const {host, game} of allGames) {
      const tile = document.createElement('div');
      const isSel = state.selectedGame && state.selectedGame.titleId === host.titleId && state.selectedGame.name === game.name;
      tile.className = 'game-tile' + (isSel ? ' selected' : '');
      const romStr = game.romfs ? game.romfs.sizeHuman : t('missingLabel');
      const patchBadge = game.patches && game.patches.length ? `<span class="tag patch">${game.patches.length} ${esc(t('patchShort'))}</span>` : '';
      const hostTag = host.hostName || host.titleId;
      tile.innerHTML = `
        <div class="game-tile-name"><span>${esc(game.name)}</span>${patchBadge}</div>
        <div class="game-tile-meta">${esc(t('hostLabelPrefix'))}: ${esc(hostTag)}</div>
        <div class="game-tile-meta">RomFS: ${esc(romStr)}</div>
      `;
      tile.addEventListener('click', () => {
        state.selectedGame = {titleId: host.titleId, name: game.name};
        renderSdViews();
      });
      picker.appendChild(tile);
    }
  }

  $('sd-status-text').textContent = sd.mounted
    ? t('sdDetectedAt', {drive: sd.drive})
    : (sd.fromCache ? t('sdCacheNote', {date: new Date(sd.cachedAt).toLocaleString()}) : t('sdMissingNote'));

  const container = $('sd-hosts-container');
  container.innerHTML = '';
  if (!sd.hosts || !sd.hosts.length) {
    container.innerHTML = `<div class="empty-note">${t('noSdHosts')}</div>`;
  } else {
    for (const h of sd.hosts) {
      const box = document.createElement('div');
      box.className = 'sd-host-group';
      const openBtn = sd.mounted ? `<button class="btn ghost small-btn" data-open="${esc(h.path)}">${esc(t('btnOpenFolder'))}</button>` : '';
      box.innerHTML = `
        <div class="sd-host-header">
          <div><strong>${esc(h.hostName || t('hostFallback'))}</strong> <code>${esc(h.titleId)}</code></div>
          ${openBtn}
        </div>
        <div class="games-picker">
          ${(h.games || []).map(g => `
            <div class="game-tile">
              <div class="game-tile-name">
                <span>${esc(g.name)}</span>
                <span class="tag ${g.ok ? 'ok' : 'err'}">${esc(g.ok ? t('statusOk') : t('statusErr'))}</span>
              </div>
              <div class="game-tile-meta">ExeFS: ${esc(g.exefs ? g.exefs.sizeHuman : t('missingLabel'))}</div>
              <div class="game-tile-meta">RomFS: ${esc(g.romfs ? g.romfs.sizeHuman : t('missingLabel'))}</div>
              <div class="game-tile-meta">${esc(t('patchesLabel'))}: ${g.patches ? g.patches.length : 0}</div>
              ${g.issues && g.issues.length ? `<div class="game-tile-meta" style="color:#ff8590">${esc(g.issues.join(', '))}</div>` : ''}
            </div>
          `).join('')}
        </div>
      `;
      container.appendChild(box);
    }
    container.querySelectorAll('[data-open]').forEach(btn => {
      btn.addEventListener('click', () => {
        api('/api/open-folder', {method: 'POST', body: JSON.stringify({path: btn.dataset.open})});
      });
    });
  }
}

function renderHosts() {
  const sel = $('prep-host');
  sel.innerHTML = '';
  const list = $('registered-hosts-list');
  list.innerHTML = '';
  for (const h of state.hosts) {
    const opt = document.createElement('option');
    opt.value = h.id;
    opt.textContent = h.name ? `${h.name} (${h.id})` : h.id;
    sel.appendChild(opt);

    const chip = document.createElement('div');
    chip.className = 'host-chip';
    chip.innerHTML = `<code>${esc(h.id)}</code>${esc(h.name || t('unnamedHost'))}`;
    list.appendChild(chip);
  }
}

async function refreshAll() {
  const [stR, hostsR, sdR, cfgR] = await Promise.allSettled([
    api('/api/state'),
    api('/api/hosts'),
    api('/api/sd/scan'),
    api('/api/config')
  ]);
  if (hostsR.status === 'fulfilled') state.hosts = hostsR.value.hosts || [];
  if (sdR.status === 'fulfilled') state.sd = sdR.value;
  if (stR.status === 'fulfilled') {
    const st = stR.value;
    state.ips = st.ips || [];
    state.logs.ns2jb = st.ns2jb.logs || [];
    state.logs.backend = st.backend.logs || [];
    state.logs.prepare = st.prepare.logs || [];
    state.serverState = st;
  }
  if (cfgR.status === 'fulfilled' && cfgR.value.config) {
    const c = cfgR.value.config;
    $('cfg-distro').value = c.wslDistro || '';
    $('cfg-ns2jb').value = c.ns2jbDir || '';
    $('cfg-civ7').value = c.civ7Dir || '';
    $('cfg-civ7-cmd').value = c.civ7Cmd || '';
    $('cfg-backend').value = c.backendDir || '';
    $('cfg-nup').value = c.nupVenv || '';
  }
  applyLanguage();
}

// SSE Live Stream
const ev = new EventSource('/api/events');
ev.addEventListener('state', e => renderServerState(JSON.parse(e.data)));
ev.addEventListener('log', e => {
  const entry = JSON.parse(e.data);
  if (!state.logs[entry.bucket]) state.logs[entry.bucket] = [];
  state.logs[entry.bucket].push(entry);
  if (state.logs[entry.bucket].length > 400) state.logs[entry.bucket].shift();
  if (entry.bucket === 'prepare') renderPrepareLog();
  else if (entry.bucket === state.activeLog) renderLaunchLog();
});

$('btn-refresh-launch').addEventListener('click', refreshAll);
$('btn-clear-log').addEventListener('click', () => {
  state.logs[state.activeLog] = [];
  renderLaunchLog();
});

$('btn-start-ns2jb').addEventListener('click', async () => {
  try {
    state.activeLog = 'ns2jb';
    document.querySelectorAll('.log-tab').forEach(b => b.classList.toggle('active', b.dataset.log === 'ns2jb'));
    state.logs.ns2jb = [];
    renderLaunchLog();
    await api('/api/ns2jb/start', {
      method: 'POST',
      body: JSON.stringify({ip: $('ns2jb-ip').value, vector: $('exploit-vector').value})
    });
    showToast(t('toastNs2jbStarted'));
  } catch (e) { showToast(e.message, true); }
});

$('btn-stop-ns2jb').addEventListener('click', async () => {
  try {
    await api('/api/ns2jb/stop', {method: 'POST'});
    showToast(t('toastNs2jbStopping'));
  } catch (e) { showToast(e.message, true); }
});

async function submitNs2jbStdin() {
  const inp = $('ns2jb-stdin-input');
  if (!inp.value.trim()) return;
  try {
    await api('/api/ns2jb/stdin', {method: 'POST', body: JSON.stringify({text: inp.value.trim()})});
    inp.value = '';
  } catch (e) { showToast(e.message, true); }
}
$('btn-ns2jb-stdin').addEventListener('click', submitNs2jbStdin);
$('ns2jb-stdin-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitNs2jbStdin(); });

$('btn-start-backend').addEventListener('click', async () => {
  try {
    state.activeLog = 'backend';
    document.querySelectorAll('.log-tab').forEach(b => b.classList.toggle('active', b.dataset.log === 'backend'));
    state.logs.backend = [];
    renderLaunchLog();
    const sel = state.selectedGame;
    const payload = sel && sel.name !== '(diretto)' ? {title: sel.titleId, game: sel.name} : (sel ? {title: sel.titleId} : {});
    await api('/api/backend/start', {method: 'POST', body: JSON.stringify(payload)});
    showToast(t('toastBackendStarted'));
  } catch (e) { showToast(e.message, true); }
});

$('btn-start-backend-live').addEventListener('click', async () => {
  try {
    state.activeLog = 'backend';
    document.querySelectorAll('.log-tab').forEach(b => b.classList.toggle('active', b.dataset.log === 'backend'));
    state.logs.backend = [];
    renderLaunchLog();
    await api('/api/backend/start', {method: 'POST', body: JSON.stringify({})});
    showToast(t('toastBackendLive'));
  } catch (e) { showToast(e.message, true); }
});

$('btn-stop-backend').addEventListener('click', async () => {
  try { await api('/api/backend/stop', {method: 'POST'}); } catch (e) { showToast(e.message, true); }
});

$('btn-browse-nup').addEventListener('click', async () => {
  try {
    const res = await api('/api/dialog/file', {method: 'POST', body: JSON.stringify({kind: 'nup'})});
    if (res.path) {
      $('prep-nup').value = res.path;
      if (!$('prep-name').value.trim()) {
        const stem = res.path.split(/[\\/]/).pop().replace(/\.nup$/i, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
        $('prep-name').value = stem;
      }
    }
  } catch (e) { showToast(e.message, true); }
});

$('btn-start-prepare').addEventListener('click', async () => {
  const nupPath = $('prep-nup').value.trim();
  const gameName = $('prep-name').value.trim();
  const hostId = $('prep-host').value || null;
  const autoPatch = $('prep-autopatch').checked;
  const copyToSdDrive = $('prep-copy-sd').checked ? (state.sd && state.sd.mounted ? state.sd.drive : 'D') : null;
  if (!nupPath || !gameName) return showToast(t('toastPrepMissing'), true);
  try {
    state.logs.prepare = [];
    renderPrepareLog();
    await api('/api/prepare/start', {
      method: 'POST',
      body: JSON.stringify({nupPath, gameName, hostId, autoPatch, copyToSdDrive})
    });
    showToast(t('toastPrepStarted'));
  } catch (e) { showToast(e.message, true); }
});

$('btn-stop-prepare').addEventListener('click', async () => {
  try { await api('/api/prepare/stop', {method: 'POST'}); } catch (e) { showToast(e.message, true); }
});

$('btn-rescan-sd').addEventListener('click', async () => {
  try {
    const drive = $('sd-drive-select').value;
    state.sd = await api('/api/sd/scan?drive=' + encodeURIComponent(drive));
    renderSdViews();
    showToast(state.sd.mounted ? t('toastSdScanned', {drive: state.sd.drive}) : t('toastSdNotFound'), !state.sd.mounted);
  } catch (e) { showToast(e.message, true); }
});

$('btn-browse-host').addEventListener('click', async () => {
  try {
    const res = await api('/api/dialog/file', {method: 'POST', body: JSON.stringify({kind: 'host'})});
    if (res.path) $('host-file').value = res.path;
  } catch (e) { showToast(e.message, true); }
});

$('btn-add-host').addEventListener('click', async () => {
  const filePath = $('host-file').value.trim();
  const hostName = $('host-name').value.trim();
  if (!filePath) return showToast(t('toastHostMissing'), true);
  try {
    $('add-host-feedback').textContent = t('toastHostRegistering');
    const res = await api('/api/hosts/add', {method: 'POST', body: JSON.stringify({path: filePath, name: hostName})});
    state.hosts = res.hosts || [];
    renderHosts();
    $('host-file').value = '';
    $('host-name').value = '';
    $('add-host-feedback').textContent = t('toastHostAdded');
    showToast(t('toastHostAdded'));
  } catch (e) {
    $('add-host-feedback').textContent = '';
    showToast(e.message, true);
  }
});

function readConfigForm() {
  return {
    wslDistro: $('cfg-distro').value.trim(),
    ns2jbDir: $('cfg-ns2jb').value.trim(),
    civ7Dir: $('cfg-civ7').value.trim(),
    civ7Cmd: $('cfg-civ7-cmd').value.trim(),
    backendDir: $('cfg-backend').value.trim(),
    nupVenv: $('cfg-nup').value.trim()
  };
}

function renderEnvChecklist(r) {
  const grid = $('setup-env-grid');
  const items = [
    {title: 'WSL', sub: r.distro, cls: 'ok', tag: 'OK'},
    {title: 'Node.js (WSL)', sub: r.node, cls: r.nodeOk ? 'ok' : 'err', tag: r.nodeOk ? 'OK' : '22+ req'},
    {title: 'ns2jb (SmileBASIC)', sub: r.ns2jb ? 'run.cjs found' : 'Not installed', cls: r.ns2jb ? 'ok' : 'err', tag: r.ns2jb ? 'OK' : 'Missing'},
    {title: 'Civ VII (Untested)', sub: r.civ7 ? 'Folder found' : 'Optional / Untested', cls: r.civ7 ? 'ok' : 'warn', tag: r.civ7 ? 'Found' : 'Optional'},
    {title: 'Backend Engine', sub: r.bundledBackend ? 'Bundled (ready)' : 'Custom path', cls: r.backend ? 'ok' : 'err', tag: r.backend ? 'OK' : 'Missing'},
    {title: 'Python + nup', sub: r.nup ? r.python : 'Optional (.nup only)', cls: r.nup ? 'ok' : 'warn', tag: r.nup ? 'OK' : 'Optional'}
  ];
  grid.innerHTML = items.map(it => `
    <div class="env-item ${it.cls}">
      <div>
        <div class="env-item-title">${esc(it.title)}</div>
        <div class="env-item-sub">${esc(it.sub)}</div>
      </div>
      <span class="tag ${it.cls === 'ok' ? 'ok' : (it.cls === 'err' ? 'err' : '')}">${esc(it.tag)}</span>
    </div>
  `).join('');
}

async function runEnvCheck() {
  try {
    const r = await api('/api/config/test-wsl', {method: 'POST', body: JSON.stringify(readConfigForm())});
    renderEnvChecklist(r);
    return r;
  } catch (e) {
    $('setup-env-grid').innerHTML = `<div class="empty-note" style="color:#ff8590">${esc(e.message)}</div>`;
    throw e;
  }
}

$('btn-setup-check').addEventListener('click', () => {
  runEnvCheck().catch(e => showToast(e.message, true));
});

$('btn-setup-clone').addEventListener('click', async () => {
  try {
    $('btn-setup-clone').disabled = true;
    $('setup-action-status').textContent = t('toastCloneRunning');
    showToast(t('toastCloneRunning'));
    const res = await api('/api/setup/clone-ns2jb', {method: 'POST', body: JSON.stringify(readConfigForm())});
    if (res.test) renderEnvChecklist(res.test);
    $('setup-action-status').textContent = t('toastCloneDone');
    showToast(t('toastCloneDone'));
  } catch (e) {
    $('setup-action-status').textContent = '';
    showToast(e.message, true);
  } finally {
    $('btn-setup-clone').disabled = false;
  }
});

$('btn-setup-nup').addEventListener('click', async () => {
  try {
    $('btn-setup-nup').disabled = true;
    $('setup-action-status').textContent = t('toastNupRunning');
    showToast(t('toastNupRunning'));
    const res = await api('/api/setup/install-nup', {method: 'POST', body: JSON.stringify(readConfigForm())});
    if (res.test) renderEnvChecklist(res.test);
    $('setup-action-status').textContent = t('toastNupDone');
    showToast(t('toastNupDone'));
  } catch (e) {
    $('setup-action-status').textContent = '';
    showToast(e.message, true);
  } finally {
    $('btn-setup-nup').disabled = false;
  }
});

$('btn-save-config').addEventListener('click', async () => {
  try {
    await api('/api/config', {method: 'POST', body: JSON.stringify(readConfigForm())});
    showToast(t('toastConfigSaved'));
    refreshAll();
  } catch (e) { showToast(e.message, true); }
});

$('btn-test-wsl').addEventListener('click', async () => {
  const box = $('wsl-test-result');
  box.className = 'wsl-test-box';
  box.textContent = '...';
  try {
    const r = await runEnvCheck();
    box.className = 'wsl-test-box ' + (r.ok ? 'ok' : 'err');
    box.innerHTML = [
      `<strong>WSL Distro:</strong> ${esc(r.distro)}`,
      `<strong>Node.js:</strong> ${esc(r.node)}`,
      `<strong>ns2jb (SmileBASIC):</strong> ${r.ns2jb ? 'OK' : 'Missing'}`,
      `<strong>Civ VII (Untested):</strong> ${r.civ7 ? 'Folder found' : 'Not configured (optional)'}`,
      `<strong>Backend Engine:</strong> ${r.backend ? (r.bundledBackend ? 'OK (Bundled)' : 'OK (Custom)') : 'Missing'}`,
      `<strong>nup tool (optional):</strong> ${r.nup ? 'OK' : 'Not installed'}`
    ].join('<br/>');
  } catch (e) {
    box.className = 'wsl-test-box err';
    box.textContent = e.message;
  }
});

$('btn-shutdown-server').addEventListener('click', async () => {
  try {
    await api('/api/shutdown', {method: 'POST'});
    showToast(t('toastServerStopped'));
    setTimeout(() => window.close(), 600);
  } catch (e) { showToast(e.message, true); }
});

applyLanguage();
refreshAll().then(() => runEnvCheck().catch(() => {}));

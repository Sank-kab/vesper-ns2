'use strict';
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = path.join(__dirname, '..', 'config.local.json');
const BUNDLED_ENGINE_WIN = path.join(__dirname, '..', 'engine');

const DEFAULTS = {
  wslDistro: '',
  ns2jbDir: '~/ns2jb',
  civ7Dir: '~/civ7-fs',
  civ7Cmd: 'node engine/run.cjs',
  backendDir: '',
  nupVenv: ''
};

function sanitize(raw = {}) {
  return {
    wslDistro: typeof raw.wslDistro === 'string' ? raw.wslDistro.trim() : DEFAULTS.wslDistro,
    ns2jbDir: typeof raw.ns2jbDir === 'string' && raw.ns2jbDir.trim() ? raw.ns2jbDir.trim() : DEFAULTS.ns2jbDir,
    civ7Dir: typeof raw.civ7Dir === 'string' && raw.civ7Dir.trim() ? raw.civ7Dir.trim() : DEFAULTS.civ7Dir,
    civ7Cmd: typeof raw.civ7Cmd === 'string' && raw.civ7Cmd.trim() ? raw.civ7Cmd.trim() : DEFAULTS.civ7Cmd,
    backendDir: typeof raw.backendDir === 'string' ? raw.backendDir.trim() : DEFAULTS.backendDir,
    nupVenv: typeof raw.nupVenv === 'string' ? raw.nupVenv.trim() : DEFAULTS.nupVenv
  };
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return sanitize(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
    }
  } catch {}
  return {...DEFAULTS};
}

function saveConfig(next) {
  const clean = sanitize(next);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(clean, null, 2) + '\n', 'utf8');
  return clean;
}

module.exports = {loadConfig, saveConfig, DEFAULTS, CONFIG_FILE, BUNDLED_ENGINE_WIN};

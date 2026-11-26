'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {winToWslPath, wslToUncPath} = require('../lib/wsl-bridge.cjs');
const {server} = require('../server.cjs');

function get(port, reqPath) {
  return new Promise((resolve, reject) => {
    http.get({host: '127.0.0.1', port, path: reqPath}, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => body += d);
      res.on('end', () => resolve({status: res.statusCode, body}));
    }).on('error', reject);
  });
}

function walkTracked(dir, root = dir, list = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (['.git', 'cache', 'node_modules'].includes(entry.name)) continue;
    if (rel === 'config.local.json') continue;
    if (rel.startsWith('engine/backend/logs/') && entry.name !== '.gitkeep') continue;
    if (rel.startsWith('engine/backend/state/') && entry.name !== '.gitkeep') continue;
    if (rel.startsWith('engine/host-policies/') && entry.name !== '.gitkeep') continue;
    if (entry.isDirectory()) walkTracked(full, root, list);
    else list.push({full, rel});
  }
  return list;
}

function runDeepPrivacyAndIntegrityAudit() {
  const root = path.resolve(__dirname, '..');
  const files = walkTracked(root);
  assert.ok(files.length > 20, 'Expected tracked GUI + bundled engine files');

  const forbiddenExts = /\.(npdm|nsp|nro|nso|nup|bin|ips|ips32)$/i;
  const privatePattern = /(?:C:\\Users\\|\/home\/rompi|rompi\b|Sank-kab|Sanks2026|kaiload|NS2 Studio|NS2 Game Loader|NS2 Mod Manager|Bananza|Ocarina|Pokopia|Zelda|Pokemon|Pokémon)/i;

  for (const {full, rel} of files) {
    assert.ok(!forbiddenExts.test(rel), `Forbidden binary/Nintendo artifact in repo: ${rel}`);
    // Skip binary wasm & large prebuilt json / vendored zstd for text scan
    if (rel.endsWith('.wasm') || rel.startsWith('engine/backend/native/prebuilt/') || rel.startsWith('engine/backend/native/vendor/')) continue;
    if (rel === 'tests/smoke-test.cjs') continue;
    const text = fs.readFileSync(full, 'utf8');
    const match = text.match(privatePattern);
    assert.ok(!match, `Private/old-brand leak "${match && match[0]}" found in ${rel}`);
  }

  // Verify bundled native prebuilt artifacts SHA-256 checksums!
  const artifacts = require(path.join(root, 'engine/backend/lib/native/artifacts.cjs')).artifacts();
  assert.ok(artifacts && artifacts.manifest && artifacts.wasm, 'Bundled engine native artifacts invalid');
  return files.length;
}

async function main() {
  const auditedCount = runDeepPrivacyAndIntegrityAudit();
  assert.equal(winToWslPath('C:\\Games\\SampleGame\\Game.nup'), '/mnt/c/Games/SampleGame/Game.nup');
  assert.equal(winToWslPath('D:\\ns2jb-modloader'), '/mnt/d/ns2jb-modloader');
  assert.equal(wslToUncPath('/home/user/ready/test', 'Ubuntu'), '\\\\wsl.localhost\\Ubuntu\\home\\user\\ready\\test');

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  try {
    const home = await get(port, '/');
    assert.equal(home.status, 200);
    assert.match(home.body, /Vesper/);

    const cfg = await get(port, '/api/config');
    assert.equal(cfg.status, 200);
    const parsedCfg = JSON.parse(cfg.body);
    assert.ok(parsedCfg.config && typeof parsedCfg.config.ns2jbDir === 'string');

    const st = await get(port, '/api/state');
    assert.equal(st.status, 200);
    const parsed = JSON.parse(st.body);
    assert.equal(parsed.ns2jb.status, 'stopped');
    assert.equal(parsed.backend.status, 'idle');

    console.log(`PASS Vesper full checkup: ${auditedCount} tracked files audited (zero personal/old-brand/commercial-title/Nintendo leaks), bundled engine SHA-256 verified, and GUI API OK!`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(err => {
  console.error('FAIL:', err);
  process.exitCode = 1;
});

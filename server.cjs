'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {loadConfig, saveConfig} = require('./lib/config.cjs');
const {WslBridge, getLocalIPv4s} = require('./lib/wsl-bridge.cjs');
const {scanSdDrive} = require('./lib/sd-inspector.cjs');
const {pickFile, openInExplorer} = require('./lib/win-dialogs.cjs');

const PORT = Number(process.env.NS2_GUI_PORT || 47821);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

const bridge = new WslBridge();
const sseClients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { sseClients.delete(res); }
  }
}

bridge.on('log', entry => broadcast('log', entry));
bridge.on('state', () => broadcast('state', bridge.getState()));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 256 * 1024) reject(new Error('Request body too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(body);
}

async function getHostNameMap() {
  try {
    const hosts = await bridge.listHosts();
    return Object.fromEntries(hosts.map(h => [h.id, h.name]));
  } catch {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      res.write(`event: state\ndata: ${JSON.stringify(bridge.getState())}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (pathname === '/api/state' && req.method === 'GET') {
      return sendJson(res, 200, {
        ...bridge.getState(),
        ips: getLocalIPv4s()
      });
    }

    if (pathname === '/api/config' && req.method === 'GET') {
      return sendJson(res, 200, {config: loadConfig()});
    }

    if (pathname === '/api/config' && req.method === 'POST') {
      const body = await readBody(req);
      const saved = saveConfig(body);
      return sendJson(res, 200, {ok: true, config: saved});
    }

    if (pathname === '/api/config/test-wsl' && req.method === 'POST') {
      const body = await readBody(req);
      const cfg = body && body.ns2jbDir ? body : loadConfig();
      const result = await bridge.testConnection(cfg);
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/setup/clone-ns2jb' && req.method === 'POST') {
      const body = await readBody(req);
      const cfg = body && body.ns2jbDir ? {...loadConfig(), ...body} : loadConfig();
      const output = await bridge.cloneNs2jb(cfg);
      const test = await bridge.testConnection(cfg);
      return sendJson(res, 200, {ok: true, output, test});
    }

    if (pathname === '/api/setup/install-nup' && req.method === 'POST') {
      const body = await readBody(req);
      const cfg = body && body.ns2jbDir ? {...loadConfig(), ...body} : loadConfig();
      const output = await bridge.installNup(cfg);
      const test = await bridge.testConnection(cfg);
      return sendJson(res, 200, {ok: true, output, test});
    }

    if (pathname === '/api/hosts' && req.method === 'GET') {
      const hosts = await bridge.listHosts();
      return sendJson(res, 200, {hosts});
    }

    if (pathname === '/api/hosts/add' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.path) return sendJson(res, 400, {error: 'Missing file path'});
      const output = await bridge.addHost(body.path, body.name || '');
      const hosts = await bridge.listHosts();
      return sendJson(res, 200, {ok: true, output, hosts});
    }

    if (pathname === '/api/sd/scan' && req.method === 'GET') {
      const drive = url.searchParams.get('drive') || null;
      const hostNames = await getHostNameMap();
      const scan = scanSdDrive(drive, hostNames);
      return sendJson(res, 200, scan);
    }

    if (pathname === '/api/ns2jb/start' && req.method === 'POST') {
      const body = await readBody(req);
      bridge.startNs2jb({ip: body.ip || null, vector: body.vector || 'smilebasic'});
      return sendJson(res, 200, {ok: true});
    }

    if (pathname === '/api/ns2jb/stop' && req.method === 'POST') {
      await bridge.stopNs2jb();
      return sendJson(res, 200, {ok: true});
    }

    if (pathname === '/api/ns2jb/stdin' && req.method === 'POST') {
      const body = await readBody(req);
      bridge.sendNs2jbInput(body.text ?? '');
      return sendJson(res, 200, {ok: true});
    }

    if (pathname === '/api/backend/start' && req.method === 'POST') {
      const body = await readBody(req);
      bridge.startBackend({title: body.title || null, game: body.game || null});
      return sendJson(res, 200, {ok: true});
    }

    if (pathname === '/api/backend/stdin' && req.method === 'POST') {
      const body = await readBody(req);
      bridge.sendBackendInput(body.text ?? '');
      return sendJson(res, 200, {ok: true});
    }

    if (pathname === '/api/backend/stop' && req.method === 'POST') {
      await bridge.stopBackend();
      return sendJson(res, 200, {ok: true});
    }

    if (pathname === '/api/prepare/start' && req.method === 'POST') {
      const body = await readBody(req);
      bridge.startPrepare({
        nupPath: body.nupPath,
        gameName: body.gameName,
        hostId: body.hostId || null,
        autoPatch: body.autoPatch !== false,
        copyToSdDrive: body.copyToSdDrive || null
      });
      return sendJson(res, 200, {ok: true});
    }

    if (pathname === '/api/prepare/stop' && req.method === 'POST') {
      await bridge.stopPrepare();
      return sendJson(res, 200, {ok: true});
    }

    if (pathname === '/api/dialog/file' && req.method === 'POST') {
      const body = await readBody(req);
      const kind = body.kind || 'nup';
      const filter = kind === 'host'
        ? 'Host Game (*.nup;*.npdm)|*.nup;*.npdm|All files (*.*)|*.*'
        : 'NUP Package (*.nup)|*.nup|All files (*.*)|*.*';
      const title = kind === 'host' ? 'Select Host Game .nup or main.npdm' : 'Select Game .nup Package';
      const selected = await pickFile({title, filter});
      return sendJson(res, 200, {path: selected});
    }

    if (pathname === '/api/open-folder' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.path && fs.existsSync(body.path)) openInExplorer(body.path);
      return sendJson(res, 200, {ok: true});
    }

    if (pathname === '/api/shutdown' && req.method === 'POST') {
      sendJson(res, 200, {ok: true});
      for (const client of sseClients) { try { client.end(); } catch {} }
      sseClients.clear();
      await bridge.stopAll();
      setTimeout(() => {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 500).unref();
      }, 150);
      return;
    }

    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(PUBLIC_DIR, rel);
    if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      return res.end('Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store'});
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    sendJson(res, 500, {error: err.message || String(err)});
  }
});

if (require.main === module) {
  process.on('uncaughtException', err => console.error('[uncaughtException]', err));
  process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Vesper running on http://127.0.0.1:${PORT}`);
  });
}

module.exports = {server, PORT};

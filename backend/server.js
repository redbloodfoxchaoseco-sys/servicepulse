/* ServicePulse backend — telemetry collector for the Android (and desktop) apps.
 *
 * Zero-dependency Node HTTP server.
 * Receives device telemetry snapshots, stores them (JSON file), and serves
 * device lists + history for dashboards and the apps themselves.
 *
 * Endpoints (all under /api/v1):
 *   GET  /health                 -> { ok, uptimeS, devices }
 *   POST /telemetry              -> ingest a snapshot (see API.md)
 *   GET  /devices                -> registered devices + latest snapshot
 *   GET  /devices/:id/history    -> recent snapshots (?limit=N, max 500)
 *
 * Auth: if the BACKEND_KEY env var is set, requests must send
 *       X-API-Key: <key> (except /health).
 *
 * Storage: data/telemetry.json — last 500 snapshots per device.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3210', 10);
const API_KEY = process.env.BACKEND_KEY || '';
const MAX_PER_DEVICE = 500;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'telemetry.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------------- storage ---------------- */

let store = { devices: {} }; // { deviceId: { info, history: [...] } }
let saveTimer = null;

function loadStore() {
  try {
    store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!store.devices) store = { devices: {} };
  } catch {
    store = { devices: {} };
  }
}

function saveStore() {
  // throttled write-behind
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(store));
      fs.renameSync(tmp, DATA_FILE);
    } catch (err) {
      console.error('save failed:', err.message);
    }
  }, 250);
}

/* ---------------- helpers ---------------- */

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-API-Key'
  });
  res.end(data);
}

function authorized(req) {
  if (!API_KEY) return true;
  const key = req.headers['x-api-key'] || '';
  return key === API_KEY;
}

function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

function str(v, max) {
  if (typeof v !== 'string') return null;
  return v.slice(0, max || 120);
}

/* ---------------- ingest ---------------- */

function ingest(body) {
  const deviceId = str(body.deviceId, 64);
  if (!deviceId || !/^[A-Za-z0-9._-]{1,64}$/.test(deviceId)) {
    return { error: 'deviceId is required (1-64 chars: A-Z a-z 0-9 . _ -)' };
  }
  const d = body.device || {};
  const snapshot = {
    ts: Date.now(),
    cpu: num(body.cpu),
    memUsed: num(body.memUsed),
    memTotal: num(body.memTotal),
    storageFree: num(body.storageFree),
    storageTotal: num(body.storageTotal),
    networkConnected: typeof body.networkConnected === 'boolean' ? body.networkConnected : null,
    networkType: str(body.networkType, 24)
  };
  const info = {
    model: str(d.model, 120),
    manufacturer: str(d.manufacturer, 120),
    platform: str(d.platform, 24) || 'unknown',
    osVersion: str(d.osVersion, 60),
    name: str(body.deviceName, 80)
  };

  const dev = store.devices[deviceId] || { info, history: [] };
  dev.info = info;
  dev.history.push(snapshot);
  if (dev.history.length > MAX_PER_DEVICE) dev.history.shift();
  store.devices[deviceId] = dev;
  saveStore();

  return { ok: true, stored: 1, total: dev.history.length };
}

/* ---------------- routing ---------------- */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean); // ['api','v1', ...] or files

  if (req.method === 'OPTIONS') return send(res, 204, {});

  /* API routes */
  if (parts[0] === 'api' && parts[1] === 'v1') {
    const route = parts.slice(2).join('/');

    if (route === 'health' && req.method === 'GET') {
      return send(res, 200, {
        ok: true,
        service: 'servicepulse-backend',
        version: '1.0.0',
        uptimeS: Math.round(process.uptime()),
        devices: Object.keys(store.devices).length
      });
    }

    if (!authorized(req)) return send(res, 401, { error: 'invalid or missing X-API-Key' });

    if (route === 'telemetry' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          const result = ingest(JSON.parse(raw || '{}'));
          if (result.error) return send(res, 400, result);
          return send(res, 201, result);
        } catch {
          return send(res, 400, { error: 'invalid JSON body' });
        }
      });
      return;
    }

    if (route === 'devices' && req.method === 'GET') {
      const devices = Object.entries(store.devices).map(([id, d]) => ({
        deviceId: id,
        info: d.info,
        lastSeen: d.history.length ? d.history[d.history.length - 1].ts : null,
        latest: d.history.length ? d.history[d.history.length - 1] : null,
        samples: d.history.length
      }));
      devices.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
      return send(res, 200, { devices });
    }

    const m = route.match(/^devices\/([A-Za-z0-9._-]+)\/history$/);
    if (m && req.method === 'GET') {
      const dev = store.devices[m[1]];
      if (!dev) return send(res, 404, { error: 'unknown deviceId' });
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '60', 10) || 60, MAX_PER_DEVICE);
      const history = dev.history.slice(-limit);
      return send(res, 200, { deviceId: m[1], info: dev.info, count: history.length, history });
    }

    return send(res, 404, { error: 'not found' });
  }

  /* static files from public/ (for standalone use) */
  if (req.method === 'GET') {
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    file = file.replace(/\.\./g, '');
    const abs = path.join(PUBLIC_DIR, file);
    if (!abs.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
    fs.readFile(abs, (err, data) => {
      if (err) return send(res, 404, { error: 'not found' });
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[path.extname(abs)] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }

  return send(res, 404, { error: 'not found' });
});

loadStore();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`ServicePulse backend listening on :${PORT} (auth ${API_KEY ? 'enabled' : 'open'})`);
});

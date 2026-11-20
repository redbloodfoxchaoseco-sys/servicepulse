'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const PORT = 3399;
const KEY = 'test-key';
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-test-'));

let child;

function startServer() {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(PORT), BACKEND_KEY: KEY, DATA_DIR: dataDir, MDNS: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const timer = setTimeout(() => reject(new Error('server did not start')), 5000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('error', reject);
  });
}

test.before(startServer);
test.after(() => {
  if (child) child.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('/health is public and reports the service', async () => {
  const res = await fetch(`${BASE}/api/v1/health`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.service, 'servicepulse-backend');
});

test('/info exposes discovery metadata without auth', async () => {
  const res = await fetch(`${BASE}/api/v1/info`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.api, '/api/v1');
  assert.strictEqual(body.authRequired, true);
});

test('telemetry rejects missing or wrong API key', async () => {
  const res = await fetch(`${BASE}/api/v1/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'phone-1', cpu: 10 })
  });
  assert.strictEqual(res.status, 401);
});

test('telemetry ingests a snapshot and it appears in /devices', async () => {
  const post = await fetch(`${BASE}/api/v1/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
    body: JSON.stringify({
      deviceId: 'phone-1',
      deviceName: 'Pixel',
      cpu: 24.5,
      memUsed: 2e9,
      memTotal: 8e9,
      networkConnected: true,
      networkType: 'wifi',
      device: { model: 'Pixel 7', manufacturer: 'Google', platform: 'android', osVersion: '14' }
    })
  });
  assert.strictEqual(post.status, 201);
  const stored = await post.json();
  assert.strictEqual(stored.ok, true);

  const list = await (await fetch(`${BASE}/api/v1/devices`, { headers: { 'X-API-Key': KEY } })).json();
  const dev = list.devices.find((d) => d.deviceId === 'phone-1');
  assert.ok(dev, 'device should be listed');
  assert.strictEqual(dev.latest.cpu, 24.5);
  assert.strictEqual(dev.info.model, 'Pixel 7');
});

test('history returns samples and rejects unknown devices', async () => {
  for (let i = 0; i < 3; i++) {
    await fetch(`${BASE}/api/v1/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
      body: JSON.stringify({ deviceId: 'phone-1', cpu: i })
    });
  }
  const hist = await (await fetch(`${BASE}/api/v1/devices/phone-1/history?limit=2`, {
    headers: { 'X-API-Key': KEY }
  })).json();
  assert.strictEqual(hist.count, 2);
  assert.strictEqual(hist.history[1].cpu, 2);

  const missing = await fetch(`${BASE}/api/v1/devices/nope/history`, { headers: { 'X-API-Key': KEY } });
  assert.strictEqual(missing.status, 404);
});

test('telemetry validates the deviceId format', async () => {
  const res = await fetch(`${BASE}/api/v1/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
    body: JSON.stringify({ deviceId: 'bad id!', cpu: 1 })
  });
  assert.strictEqual(res.status, 400);
});

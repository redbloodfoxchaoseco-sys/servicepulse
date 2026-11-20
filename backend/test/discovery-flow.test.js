'use strict';

/* End-to-end discovery flow, exactly what a companion client does:
 *   1. browse mDNS for _servicepulse._tcp
 *   2. resolve SRV -> host + port, read TXT for the API path
 *   3. call GET /api/v1/info on the discovered address
 */

const test = require('node:test');
const assert = require('node:assert');
const dgram = require('node:dgram');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { encodeName, decodeName } = require('../mdns');

const PORT = 3401;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-disc-'));

function queryPacket(name, qtype) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(qtype, 0);
  tail.writeUInt16BE(0x8001, 2);
  return Buffer.concat([head, encodeName(name), tail]);
}

function browse(timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      sock.close();
      reject(new Error('no mDNS answer'));
    }, timeoutMs);

    sock.on('message', (msg) => {
      const qd = msg.readUInt16BE(4);
      const an = msg.readUInt16BE(6);
      let offset = 12;
      for (let i = 0; i < qd; i++) offset = decodeName(msg, offset).offset + 4;
      const records = [];
      for (let i = 0; i < an; i++) {
        const { name, offset: after } = decodeName(msg, offset);
        const type = msg.readUInt16BE(after);
        const rdlen = msg.readUInt16BE(after + 8);
        const rdStart = after + 10;
        records.push({ name, type, rdStart, rdlen });
        offset = rdStart + rdlen;
      }
      const srv = records.find((r) => r.type === 33);
      const a = records.find((r) => r.type === 1);
      if (!srv || !a) return;

      const port = msg.readUInt16BE(srv.rdStart + 4);
      const host = Array.from(msg.subarray(a.rdStart, a.rdStart + 4)).join('.');
      clearTimeout(timer);
      sock.close();
      resolve({ host: host === '127.0.0.1' ? '127.0.0.1' : host, port });
    });

    sock.send(queryPacket('_servicepulse._tcp.local', 12), 5353, '127.0.0.1');
  });
}

test('a client can discover the backend and call its API', async (t) => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, MDNS_NAME: 'Discovery Test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 6000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('mDNS: advertising')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => reject(new Error('server exited ' + code)));
  });

  const found = await browse();
  assert.strictEqual(found.port, PORT);

  const base = `http://${found.host}:${found.port}`;
  const info = await (await fetch(`${base}/api/v1/info`)).json();
  assert.strictEqual(info.service, 'servicepulse-backend');
  assert.strictEqual(info.api, '/api/v1');
  assert.strictEqual(info.authRequired, false);

  const health = await (await fetch(`${BASE}/api/v1/health`)).json();
  assert.strictEqual(health.ok, true);
});

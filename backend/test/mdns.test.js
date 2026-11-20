'use strict';

const test = require('node:test');
const assert = require('node:assert');
const dgram = require('node:dgram');
const { createResponder, encodeName, decodeName } = require('../mdns');

/* Minimal DNS query encoder for the test client. */
function query(name, qtype) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(0, 0);
  head.writeUInt16BE(0, 2);
  head.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(qtype, 0);
  tail.writeUInt16BE(0x8001, 2); // QU: request unicast reply
  return Buffer.concat([head, encodeName(name), tail]);
}

function parse(buf) {
  const an = buf.readUInt16BE(6);
  const out = [];
  let offset = 12;
  const qd = buf.readUInt16BE(4);
  for (let i = 0; i < qd; i++) {
    offset = decodeName(buf, offset).offset + 4;
  }
  for (let i = 0; i < an; i++) {
    const { name, offset: afterName } = decodeName(buf, offset);
    const type = buf.readUInt16BE(afterName);
    const ttl = buf.readUInt32BE(afterName + 4);
    const rdlen = buf.readUInt16BE(afterName + 8);
    const rdStart = afterName + 10;
    let data = null;
    if (type === 12) data = decodeName(buf, rdStart).name;
    if (type === 1) data = Array.from(buf.subarray(rdStart, rdStart + 4)).join('.');
    if (type === 33) {
      data = { port: buf.readUInt16BE(rdStart + 4), target: decodeName(buf, rdStart + 6).name };
    }
    if (type === 16) {
      const pairs = {};
      let p = rdStart;
      while (p < rdStart + rdlen) {
        const len = buf[p];
        if (!len) break;
        const str = buf.toString('utf8', p + 1, p + 1 + len);
        const eq = str.indexOf('=');
        pairs[str.slice(0, eq)] = str.slice(eq + 1);
        p += 1 + len;
      }
      data = pairs;
    }
    out.push({ name, type, ttl, data });
    offset = rdStart + rdlen;
  }
  return out;
}

test('responds to a PTR query with PTR, SRV, TXT and A records', async () => {
  const responder = createResponder({ port: 4321, instance: 'ALBA Test', address: '192.168.1.50' });
  await responder.start();

  const client = dgram.createSocket('udp4');
  const reply = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no mDNS reply')), 3000);
    client.on('message', (msg) => {
      clearTimeout(timer);
      resolve(parse(msg));
    });
    client.send(query('_servicepulse._tcp.local', 12), 5353, '127.0.0.1', (err) => {
      if (err) reject(err);
    });
  });
  client.close();

  const types = reply.map((r) => r.type).sort();
  assert.deepStrictEqual(types, [1, 12, 16, 33], 'expected A, PTR, TXT, SRV');

  const ptr = reply.find((r) => r.type === 12);
  assert.strictEqual(ptr.data, 'ALBA-Test._servicepulse._tcp.local');

  const srv = reply.find((r) => r.type === 33);
  assert.strictEqual(srv.data.port, 4321);

  const txt = reply.find((r) => r.type === 16);
  assert.strictEqual(txt.data.api, '/api/v1');
  assert.strictEqual(txt.data.v, '1');

  const a = reply.find((r) => r.type === 1);
  assert.strictEqual(a.data, '192.168.1.50');

  responder.stop();
});

test('ignores queries for unrelated service types', async () => {
  const responder = createResponder({ port: 4321, instance: 'ALBA Test' });
  await responder.start();

  const client = dgram.createSocket('udp4');
  let got = false;
  client.on('message', () => { got = true; });
  client.send(query('_ipp._tcp.local', 12), 5353, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 700));
  client.close();
  responder.stop();

  assert.strictEqual(got, false);
});

test('name codec round-trips', () => {
  const buf = encodeName('ServicePulse on host._servicepulse._tcp.local');
  const { name } = decodeName(buf, 0);
  assert.strictEqual(name, 'ServicePulse on host._servicepulse._tcp.local');
});

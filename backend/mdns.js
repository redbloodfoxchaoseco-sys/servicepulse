/* ServicePulse mDNS responder — zero-dependency DNS-SD advertisement.
 *
 * Advertises the backend on the local network so clients (the ALBA companion
 * app, the Android app, or any Bonjour/Avahi browser) can find it without a
 * hard-coded IP address.
 *
 * Service type: _servicepulse._tcp.local
 * Instance:     "ServicePulse on <host>" (configurable with MDNS_NAME)
 * TXT records:  v=1 api=/api/v1 path=/ name=<instance>
 *
 * Records published:
 *   PTR  _servicepulse._tcp.local        -> <instance>._servicepulse._tcp.local
 *   SRV  <instance>._servicepulse._tcp.local -> <host>.local:<PORT>
 *   TXT  <instance>._servicepulse._tcp.local -> key/values above
 *   A    <host>.local                    -> LAN IPv4 address
 *
 * Behaviour follows RFC 6762 closely enough for real clients:
 *   - listens on 224.0.0.251:5353 and joins the group,
 *   - answers multicast queries from other hosts,
 *   - answers unicast queries directly to the sender (QU bit or source port
 *     other than 5353, which is how test harnesses and some clients probe),
 *   - announces on start and re-announces every TTL/2 seconds.
 *
 * Disable with MDNS=0 (useful in containers without multicast).
 */
'use strict';

const dgram = require('dgram');
const os = require('os');

const MDNS_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;
const TTL = 120; // seconds

const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_SRV = 33;
const TYPE_ANY = 255;

/* ---------------- name encoding ---------------- */

function encodeName(name) {
  const labels = String(name).replace(/\.$/, '').split('.').filter(Boolean);
  const parts = [];
  for (const label of labels) {
    const buf = Buffer.from(label, 'utf8');
    if (buf.length > 63) throw new Error('label too long: ' + label);
    parts.push(Buffer.from([buf.length]), buf);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function decodeName(buf, offset) {
  const labels = [];
  let jumped = false;
  let end = offset;
  let hops = 0;
  while (offset < buf.length) {
    const len = buf[offset];
    if (len === 0) {
      if (!jumped) end = offset + 1;
      return { name: labels.join('.'), offset: end };
    }
    if ((len & 0xc0) === 0xc0) {
      const ptr = ((len & 0x3f) << 8) | buf[offset + 1];
      if (!jumped) end = offset + 2;
      jumped = true;
      offset = ptr;
      if (++hops > 20) throw new Error('compression loop');
      continue;
    }
    labels.push(buf.toString('utf8', offset + 1, offset + 1 + len));
    offset += 1 + len;
  }
  if (!jumped) end = offset;
  return { name: labels.join('.'), offset: end };
}

/* ---------------- record builders ---------------- */

function header(flags, qd, an) {
  const b = Buffer.alloc(12);
  b.writeUInt16BE(0, 0); // id 0 for mDNS responses
  b.writeUInt16BE(flags, 2);
  b.writeUInt16BE(qd, 4);
  b.writeUInt16BE(an, 6);
  b.writeUInt16BE(0, 8);
  b.writeUInt16BE(0, 10);
  return b;
}

function record(name, type, rdata, { flush = true, ttl = TTL } = {}) {
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(flush ? 0x8001 : 0x0001, 2);
  head.writeUInt32BE(ttl, 4);
  head.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([encodeName(name), head, rdata]);
}

function txtRdata(pairs) {
  const chunks = [];
  for (const [k, v] of Object.entries(pairs)) {
    const s = Buffer.from(`${k}=${v}`.slice(0, 255), 'utf8');
    chunks.push(Buffer.from([s.length]), s);
  }
  if (!chunks.length) chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

function srvRdata(port, target) {
  const head = Buffer.alloc(6);
  head.writeUInt16BE(0, 0); // priority
  head.writeUInt16BE(0, 2); // weight
  head.writeUInt16BE(port, 4);
  return Buffer.concat([head, encodeName(target)]);
}

/* ---------------- environment helpers ---------------- */

function lanAddress() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      candidates.push({ name, address: a.address });
    }
  }
  const preferred = candidates.find((c) => /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(c.address));
  return (preferred || candidates[0] || { address: '127.0.0.1' }).address;
}

function hostLabel() {
  return (os.hostname() || 'servicepulse')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'servicepulse';
}

/* ---------------- responder ---------------- */

function createResponder(options = {}) {
  const port = options.port || 3210;
  const apiPath = options.apiPath || '/api/v1';
  const type = options.type || '_servicepulse._tcp.local';
  const host = options.host || `${hostLabel()}.local`;
  const instance = options.instance || `ServicePulse on ${hostLabel()}`;
  const instanceFqdn = `${String(instance).replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'ServicePulse'}.${type}`;
  const address = options.address || lanAddress();
  const txt = {
    v: '1',
    api: apiPath,
    path: '/',
    name: instance,
    ...(options.txt || {})
  };

  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let timer = null;
  let announceTimer = null;
  let started = false;

  function ptr() {
    return record(type, TYPE_PTR, encodeName(instanceFqdn), { flush: false });
  }
  function srv() {
    return record(instanceFqdn, TYPE_SRV, srvRdata(port, host));
  }
  function txtRec() {
    return record(instanceFqdn, TYPE_TXT, txtRdata(txt));
  }
  function aRec() {
    const b = Buffer.alloc(4);
    address.split('.').forEach((n, i) => b.writeUInt8(parseInt(n, 10) & 0xff, i));
    return record(host, TYPE_A, b);
  }

  function answersFor(name, qtype) {
    const lower = name.toLowerCase().replace(/\.$/, '');
    const out = [];
    const wantsType = qtype === TYPE_ANY;

    if (lower === type.toLowerCase()) {
      if (wantsType || qtype === TYPE_PTR) out.push(ptr());
    } else if (lower === instanceFqdn.toLowerCase()) {
      if (wantsType || qtype === TYPE_SRV) out.push(srv());
      if (wantsType || qtype === TYPE_TXT) out.push(txtRec());
    } else if (lower === host.toLowerCase()) {
      if (wantsType || qtype === TYPE_A) out.push(aRec());
    }
    // Any answer to a service browse should include the full record set so the
    // client can resolve without a second round trip.
    if (out.length && lower === type.toLowerCase()) {
      out.push(srv(), txtRec(), aRec());
    }
    return out;
  }

  function handleQuery(msg, rinfo) {
    if (msg.length < 12) return;
    const flags = msg.readUInt16BE(2);
    if (flags & 0x8000) return; // response, ignore
    const qd = msg.readUInt16BE(4);
    if (!qd) return;

    let offset = 12;
    const questions = [];
    for (let i = 0; i < qd && offset < msg.length; i++) {
      const { name, offset: next } = decodeName(msg, offset);
      offset = next;
      if (offset + 4 > msg.length) break;
      const qtype = msg.readUInt16BE(offset);
      const qclass = msg.readUInt16BE(offset + 2);
      offset += 4;
      questions.push({ name, qtype, unicast: (qclass & 0x8000) !== 0 });
    }

    const answers = [];
    for (const q of questions) answers.push(...answersFor(q.name, q.qtype));
    if (!answers.length) return;
    if (answers.length > 40) answers.length = 40;

    const unique = [];
    const seen = new Set();
    for (const rec of answers) {
      const key = rec.slice(0, 2).toString('hex') + rec.length;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(rec);
    }

    const packet = Buffer.concat([header(0x8400, 0, unique.length), ...unique]);
    const unicast = rinfo.port !== MDNS_PORT || questions.some((q) => q.unicast);
    const target = unicast ? rinfo.port : MDNS_PORT;
    const dest = unicast ? rinfo.address : MDNS_ADDR;
    socket.send(packet, target, dest, () => {});
  }

  function announce() {
    if (!started) return;
    const packet = Buffer.concat([header(0x8400, 0, 4), ptr(), srv(), txtRec(), aRec()]);
    socket.send(packet, MDNS_PORT, MDNS_ADDR, () => {});
  }

  function start() {
    if (started) return Promise.resolve(info());
    started = true;
    return new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(MDNS_PORT, () => {
        socket.removeListener('error', reject);
        try {
          socket.setMulticastTTL(255);
          socket.addMembership(MDNS_ADDR);
        } catch {
          // containers without multicast: unicast queries still work
        }
        socket.on('message', handleQuery);
        socket.on('error', (err) => console.error('mdns:', err.message));
        announce();
        announceTimer = setTimeout(announce, 1000);
        if (announceTimer.unref) announceTimer.unref();
        timer = setInterval(announce, (TTL / 2) * 1000);
        if (timer.unref) timer.unref();
        resolve(info());
      });
    });
  }

  function stop() {
    if (!started) return;
    started = false;
    clearInterval(timer);
    clearTimeout(announceTimer);
    socket.removeAllListeners('message');
    try {
      socket.dropMembership(MDNS_ADDR);
    } catch {}
    socket.close();
  }

  function info() {
    return { service: type, instance: instanceFqdn, port, address, host, txt, disabled: false };
  }

  return { start, stop, info };
}

module.exports = { createResponder, encodeName, decodeName, lanAddress, hostLabel };

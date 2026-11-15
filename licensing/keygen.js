#!/usr/bin/env node
/**
 * ServicePulse licensing toolkit (zero dependencies, Node.js 16+).
 *
 *   node licensing/keygen.js init
 *       Generates the ECDSA P-256 keypair. Writes:
 *         licensing/private_key.pem   (SECRET — gitignored, keep safe!)
 *         licensing/public-jwk.json   (public key, embedded in the app)
 *
 *   node licensing/keygen.js issue --name "Jane Doe" --email jane@example.com [--days 365] [--tier pro]
 *       Signs a license and prints the license key (base64url(payload).base64url(sig)).
 *       --days 0 = lifetime.
 *
 *   node licensing/keygen.js verify <license-key>
 *       Verifies a key against the public key (same check the app performs).
 *
 * The app embeds only the PUBLIC key; the private key never ships. Licenses
 * are signed offline and verified on-device with WebCrypto (ECDSA P-256).
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const PRIV = path.join(DIR, 'private_key.pem');
const PUB = path.join(DIR, 'public-jwk.json');
const PRODUCT = 'servicepulse';

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function fromB64url(s) { return Buffer.from(s, 'base64url'); }

function init() {
  if (fs.existsSync(PRIV)) {
    console.error('private_key.pem already exists — refusing to overwrite.');
    process.exit(1);
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  fs.writeFileSync(PRIV, privateKey.export({ type: 'sec1', format: 'pem' }), { mode: 0o600 });
  const jwk = publicKey.export({ format: 'jwk' });
  fs.writeFileSync(PUB, JSON.stringify(jwk, null, 2) + '\n');
  console.log('Keypair generated.');
  console.log('  private (keep secret!):', PRIV);
  console.log('  public  (embed in app):', PUB);
}

function issue(opts) {
  if (!fs.existsSync(PRIV)) { console.error('Run `init` first.'); process.exit(1); }
  const priv = crypto.createPrivateKey(fs.readFileSync(PRIV, 'utf8'));
  const days = Number(opts.days || 0);
  const payload = {
    product: PRODUCT,
    name: opts.name || 'Supporter',
    email: opts.email || undefined,
    tier: opts.tier || 'pro',
    issued: new Date().toISOString().slice(0, 10),
    expires: days > 0 ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) : 'lifetime',
  };
  const data = Buffer.from(JSON.stringify(payload));
  /* ieee-p1363 = raw r||s encoding, matching WebCrypto in the app. */
  const sig = crypto.sign('sha256', data, { key: priv, dsaEncoding: 'ieee-p1363' });
  const key = b64url(data) + '.' + b64url(sig);
  console.log('License key:');
  console.log(key);
  console.log('\nPayload:', JSON.stringify(payload));
}

async function verify(key) {
  const pub = crypto.createPublicKey({ key: JSON.parse(fs.readFileSync(PUB, 'utf8')), format: 'jwk' });
  const [d, s] = String(key).trim().split('.');
  if (!d || !s) { console.error('INVALID: malformed key'); process.exit(1); }
  const ok = crypto.verify('sha256', fromB64url(d), { key: pub, dsaEncoding: 'ieee-p1363' }, fromB64url(s));
  if (!ok) { console.error('INVALID: signature check failed'); process.exit(1); }
  const payload = JSON.parse(fromB64url(d).toString('utf8'));
  console.log('VALID. Payload:', JSON.stringify(payload, null, 2));
  if (payload.expires !== 'lifetime' && new Date(payload.expires) < new Date()) {
    console.error('WARNING: license is expired.');
  }
}

const [, , cmd, ...rest] = process.argv;
const opts = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) opts[rest[i].slice(2)] = rest[++i];
}
if (cmd === 'init') init();
else if (cmd === 'issue') issue(opts);
else if (cmd === 'verify') verify(rest.find(a => !a.startsWith('--')));
else {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[1].trim());
}

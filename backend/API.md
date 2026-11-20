# ServicePulse Backend API

Telemetry collector for the ServicePulse Android (Capacitor) and desktop (Electron) apps.
Zero-dependency Node.js server (`node server.js`, env `PORT` default 3210).

## Authentication

Optional. Set `BACKEND_KEY=<secret>` when starting the server; clients must then send
`X-API-Key: <secret>` on every request except `/health` and `/info`.

## Endpoints

### GET /api/v1/health

```json
{ "ok": true, "service": "servicepulse-backend", "version": "1.0.0", "uptimeS": 120, "devices": 2 }
```

### GET /api/v1/info

Public discovery handshake: no API key required. Clients call this to confirm
they reached ServicePulse and to learn whether a key will be needed.

```json
{
  "service": "servicepulse-backend",
  "version": "1.0.0",
  "api": "/api/v1",
  "name": "ServicePulse on studio",
  "host": "studio",
  "authRequired": true,
  "discovery": {
    "service": "_servicepulse._tcp.local",
    "instance": "ServicePulse-on-studio._servicepulse._tcp.local",
    "port": 3210,
    "address": "192.168.1.42",
    "host": "studio.local",
    "txt": { "v": "1", "api": "/api/v1", "path": "/", "name": "ServicePulse on studio" }
  }
}
```

### POST /api/v1/telemetry

Ingest one snapshot. `deviceId` is required (1–64 chars of `A-Z a-z 0-9 . _ -`).
All other fields are optional; unknown fields are ignored.

```json
{
  "deviceId": "pixel-8-pro",
  "deviceName": "My Phone",
  "device": {
    "model": "Pixel 8 Pro",
    "manufacturer": "Google",
    "platform": "android",
    "osVersion": "16"
  },
  "cpu": 23.4,
  "memUsed": 4215640064,
  "memTotal": 8589934592,
  "storageFree": 24536678400,
  "storageTotal": 107374182400,
  "networkConnected": true,
  "networkType": "wifi"
}
```

Response `201`:

```json
{ "ok": true, "stored": 1, "total": 42 }
```

Errors: `400` (bad body / invalid deviceId), `401` (bad API key).

### GET /api/v1/devices

```json
{
  "devices": [
    {
      "deviceId": "pixel-8-pro",
      "info": { "model": "Pixel 8 Pro", "manufacturer": "Google", "platform": "android", "osVersion": "16", "name": "My Phone" },
      "lastSeen": 1731643200000,
      "latest": { "ts": 1731643200000, "cpu": 23.4, "memUsed": 4215640064, "memTotal": 8589934592, "storageFree": 24536678400, "storageTotal": 107374182400, "networkConnected": true, "networkType": "wifi" },
      "samples": 42
    }
  ]
}
```

### GET /api/v1/devices/:deviceId/history?limit=60

Up to 500 most recent snapshots (default 60):

```json
{ "deviceId": "pixel-8-pro", "info": { ... }, "count": 60, "history": [ { ...snapshot } ] }
```

## Storage

`data/telemetry.json` — last 500 snapshots per device, written with throttled
atomic writes (temp file + rename).

## Client usage (Android / Capacitor)

The Android app posts via the native `CapacitorHttp` bridge (no CORS constraints):

```js
const { CapacitorHttp } = window.Capacitor.Plugins;
await CapacitorHttp.request({
  method: 'POST',
  url: 'https://your-backend-host/api/v1/telemetry',
  headers: { 'Content-Type': 'application/json' },
  data: { ... }
});
```


## mDNS / DNS-SD advertisement

The server announces itself on the LAN so clients can find it without a
configured address (see `backend/mdns.js`):

| Record | Value |
|---|---|
| PTR | `_servicepulse._tcp.local` → `<instance>._servicepulse._tcp.local` |
| SRV | instance → `<hostname>.local:<PORT>` |
| TXT | `v=1`, `api=/api/v1`, `path=/`, `name=<instance>` |
| A | `<hostname>.local` → LAN IPv4 |

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `MDNS` | `1` | set to `0` to disable advertisement |
| `MDNS_NAME` | `ServicePulse on <hostname>` | instance name shown to clients |
| `DATA_DIR` | `backend/data` | where telemetry is stored |
| `BACKEND_KEY` | unset | enables `X-API-Key` authentication |
| `PORT` | `3210` | HTTP port, also advertised over mDNS |

Tested against the Android `NsdManager` browse → resolve → HTTP flow in
`backend/test/discovery-flow.test.js`.

# Copilot instructions — ServicePulse

You are the maintenance agent for this repository. Follow these rules for every
issue assigned to you.

## Repository map

- `app/` — the shared web UI. This is the ONLY place UI code is edited.
- `electron/` — Windows desktop app (Electron main process + preload).
- `android/` — Android app (Capacitor config + generated native project).
- `electron/app/` and `android/www/` are build artifacts produced by
  `node scripts/sync-web.js`. NEVER edit them directly; edit `app/` and re-run
  the sync script, then commit both the source and the synced copies together.
- `MAINTENANCE.md` — the maintenance protocol this repo runs on.

## Protocols

1. Security fixes: prefer the minimal version bump that satisfies the advisory
   range from npm audit / OSV.dev. Never jump major versions for a patch-level
   CVE unless the advisory requires it.
2. After any dependency change: run `npm ci` (not `npm install`) in the affected
   directory so `package-lock.json` stays reproducible.
3. After any UI change: run `node scripts/sync-web.js` and commit the synced
   output.
4. Verify with `node --check` on every JavaScript file you touched.
5. Keep commits small and reference the issue number in the PR description.

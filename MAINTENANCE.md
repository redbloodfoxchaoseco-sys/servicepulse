# ServicePulse — Maintenance Protocol Cycle

This repository runs an automated maintenance and security-update cycle built on
**certified vulnerability databases** and **GitHub Copilot**.

## Certified data sources

| Database | Operator | Used by |
|---|---|---|
| [GitHub Advisory Database](https://github.com/advisories) (CVEs + GitHub Security Advisories) | GitHub | `npm audit`, Dependabot |
| [OSV.dev](https://osv.dev) — open, aggregated vulnerability database (NVD/CVE, GHSA, and more) | Google / OpenSSF | `osv-scanner` |
| Dependabot update intelligence | GitHub | version bump PRs |

## The weekly cycle

```
      Monday 06:00 UTC                 Monday 07:00 UTC
   ┌────────────────────┐          ┌────────────────────────┐
   │  Security audit    │          │  Maintenance cycle     │
   │  (.github/         │          │  (.github/workflows/   │
   │   workflows/       │          │   maintenance.yml)     │
   │   security-        │          │                        │
   │   audit.yml)       │          │  1. npm ci (reproducible)
   ├────────────────────┤          │  2. npm audit fix (safe)
   │ npm audit  → GHSA  │          │  3. UI sync check      │
   │ osv-scanner→ OSV   │          │  4. JS syntax checks   │
   └─────────┬──────────┘          │  5. Android APK build  │
             │                     │  6. APK artifact upload │
             │ findings            └───────────┬────────────┘
             ▼                                 │ failure
   ┌────────────────────┐                     ▼
   │ GitHub issue,      │           ┌────────────────────┐
   │ assigned to        │           │ GitHub issue,      │
   │ Copilot coding     │           │ assigned to        │
   │ agent              │           │ Copilot coding     │
   └─────────┬──────────┘           │ agent              │
             │                                └─────────┬─────────┘
             ▼                                          ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Copilot drafts a fix PR (rules in .github/              │
   │  copilot-instructions.md) → human review → merge         │
   └──────────────────────────────────────────────────────────┘
```

### 1. Continuous dependency updates — Dependabot

`.github/dependabot.yml` watches both npm ecosystems (`electron/`, `android/`)
and the GitHub Actions workflows, opening version-bump PRs weekly.

### 2. Security audit — every Monday 06:00 UTC

`.github/workflows/security-audit.yml` runs:

- `npm audit --audit-level=high` in both packages → **GitHub Advisory Database**
- `google/osv-scanner-action` over the whole repo → **OSV.dev**

If either finds known vulnerabilities, the workflow opens a GitHub issue with
the full reports and **assigns it to the Copilot coding agent**
(`--assignee copilot-swe-agent`), which drafts remediation PRs.

### 3. Maintenance cycle — every Monday 07:00 UTC

`.github/workflows/maintenance.yml` verifies the project is healthy end to end:

1. `npm ci` in both packages (reproducible installs from lockfiles)
2. `npm audit fix` — only safe, non-breaking security patches
3. Sync check: `node scripts/sync-web.js` + `git diff --exit-code` guarantees
   `electron/app/` and `android/www/` match `app/`
4. `node --check` on all shipped JavaScript
5. Full Android debug APK build (JDK 17 + Gradle)
6. Fresh APK uploaded as a workflow artifact

Any failure opens an issue assigned to the Copilot coding agent.

### 4. Copilot coding agent

The agent follows the rules in `.github/copilot-instructions.md`:

- edit `app/` only, then re-run the sync script
- minimal version bumps that satisfy the advisory range
- `npm ci` (never `npm install`) to keep lockfiles reproducible
- verify with `node --check` before opening a PR

### 5. Human review

Copilot and Dependabot PRs are always reviewed by a human before merging —
automation drafts, humans approve.

## Running the cycle manually

Both workflows accept `workflow_dispatch`, so you can trigger an audit or a
maintenance run on demand from the Actions tab.

## Enabling Copilot on your repo

The issue-assignment integration requires GitHub Copilot coding agent to be
enabled for the repository (Settings → Copilot → allow Copilot to be assigned
issues/PRs). Without it, the issues are still created — you simply fix them
yourself instead of Copilot drafting the PR.

## Backend (telemetry service)

`backend/` is a zero-dependency Node.js telemetry service:

- Android apps POST device snapshots to `POST /api/v1/telemetry` (see `backend/API.md`).
- Dashboard: `GET /api/v1/devices`, `GET /api/v1/devices/:id/history`, `GET /api/v1/health`.
- Data is stored in `backend/data/devices.json` (gitignored).
- Optional API key: set `BACKEND_KEY` env and send it as the `X-API-Key` header.

Run locally:

```bash
cd backend && node server.js   # listens on PORT (default 3210)
```

In the Android app, open the sync gear in the top bar, enable sync, and point it at
the deployed backend URL (no trailing slash).

#!/usr/bin/env bash
# Build the ServicePulse Windows installer (NSIS, Metro UI).
#
# Requirements: makensis (NSIS >= 3.08), unzip, node/npm, jq optional.
#
# Usage:  ./installer/build.sh [stage-dir] [electron-win32-zip]
#
# The script stages a runnable Electron win32 app folder
# (ServicePulse.exe + resources/app), then compiles the NSIS installer.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="${1:-/tmp/sp-stage}"
ELECTRON_ZIP="${2:-/tmp/electron-win.zip}"
APP="$STAGE/app"

echo "==> Staging Electron win32 runtime"
rm -rf "$STAGE"
mkdir -p "$APP"
unzip -q -o "$ELECTRON_ZIP" -d "$APP"
mv "$APP/electron.exe" "$APP/ServicePulse.exe"
rm -rf "$APP/resources/default_app.asar"

echo "==> Staging ServicePulse app files"
R="$APP/resources/app"
mkdir -p "$R/app"
cp "$ROOT/electron/main.js" "$ROOT/electron/preload.js" "$R/"
cp "$ROOT/app/index.html" "$ROOT/app/app.js" "$ROOT/app/styles.css" "$R/app/"
cp "$ROOT/installer/assets/app.ico" "$APP/app.ico"
node -e "const p=require('$ROOT/electron/package.json'); delete p.devDependencies; delete p.scripts; delete p.build; require('fs').writeFileSync('$R/package.json', JSON.stringify(p,null,2)+'\n')"

echo "==> Installing production dependencies (systeminformation)"
(cd "$R" && npm install --omit=dev --no-package-lock --ignore-scripts --no-audit --no-fund >/dev/null)

echo "==> Compiling NSIS installer"
cd "$ROOT/installer"
makensis -V2 -DSTAGE_DIR="$APP" installer.nsi

echo "==> Done: $(ls -la ServicePulse-Setup-*.exe)"

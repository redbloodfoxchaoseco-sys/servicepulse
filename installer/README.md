# ServicePulse Windows installer (Metro UI)

NSIS installer with a Metro-style UI for the Electron build.

## Files

- `installer.nsi` — NSIS script (custom nsDialogs pages: welcome, directory, progress, finish, plus a styled uninstaller)
- `assets/banner-*.bmp` — Metro-blue banners (title baked into the image for maximum compatibility)
- `assets/app.ico` — app icon (also used for shortcuts)
- `build.sh` — stages the Electron win32 runtime + app files and compiles the installer

## Build

```bash
# prerequisites: nsis (makensis), unzip, node/npm
curl -sL -o /tmp/electron-win.zip https://github.com/electron/electron/releases/download/v45.3.2/electron-v45.3.2-win32-x64.zip
bash installer/build.sh            # stages to /tmp/sp-stage and compiles
```

Output: `ServicePulse-Setup-1.0.0.exe`.

## Design notes

- Windows 8 "Metro" language: flat #0078D3 banner, white surfaces, Segoe UI,
  Metro-blue progress bar, no gradients or 3D chrome.
- Title text is rendered into the banner bitmaps (not overlaid) so it displays
  identically on every Windows version and DPI setting.
- All runtime paths use backslashes — NSIS's `LoadAndSetImage` does not accept
  forward slashes.
- Per-user install (`$LOCALAPPDATA\Programs`), `RequestExecutionLevel user`,
  no UAC prompt, no .NET or VC++ dependencies.
- Verified end-to-end under Wine (Xvfb + xdotool click-through).

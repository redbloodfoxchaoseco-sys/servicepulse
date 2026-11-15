/* ServicePulse — Electron main process (Windows desktop).
 * Secure by default: contextIsolation on, nodeIntegration off, sandbox on,
 * all system access brokered through ipcMain.handle + contextBridge.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const si = require('systeminformation');

let mainWindow = null;
let cpuInfoCache = null;

async function cpuInfo() {
  if (!cpuInfoCache) {
    try {
      cpuInfoCache = await si.cpu();
    } catch {
      cpuInfoCache = { manufacturer: 'CPU', brand: '', cores: null };
    }
  }
  return cpuInfoCache;
}

function fmtUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(d + 'd');
  if (h) parts.push(h + 'h');
  parts.push(m + 'm');
  return parts.join(' ');
}

ipcMain.handle('sys:overview', async () => {
  const [load, mem, os, time, cpu] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.osInfo(),
    si.time(),
    cpuInfo()
  ]);
  return {
    platform: process.platform,
    platformName: os.distro || os.platform,
    cpuModel: ((cpu.manufacturer || '') + ' ' + (cpu.brand || '')).trim(),
    cores: load.cpus ? load.cpus.length : cpu.cores,
    cpuLoad: load.currentLoad,
    memTotal: mem.total,
    memUsed: mem.active != null ? mem.active : mem.used,
    memFree: mem.free,
    uptimeText: fmtUptime(time.uptime)
  };
});

ipcMain.handle('sys:processes', async () => {
  const procs = await si.processes();
  return procs.list
    .map((p) => ({ pid: p.pid, name: p.name, cpu: p.cpu || 0, mem: p.mem * 1024 * 1024 }))
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, 80);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 480,
    minHeight: 520,
    backgroundColor: '#0e1218',
    title: 'ServicePulse',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.SP_SYNC) {
    mainWindow.loadURL('file://' + path.join(__dirname, 'app', 'index.html') + '#sync');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  /* Test harness: SP_SHOT=/path.png captures the window and exits (CI / QA). */
  if (process.env.SP_SHOT) {
    mainWindow.webContents.once('did-finish-load', () => {
      const delay = parseInt(process.env.SP_SHOT_DELAY || '2500', 10);
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          require('fs').writeFileSync(process.env.SP_SHOT, image.toPNG());
          console.log('SP_SHOT saved:', process.env.SP_SHOT);
        } catch (err) {
          console.error('SP_SHOT failed:', err);
        }
        app.quit();
      }, 2500);
    });
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

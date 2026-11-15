/* ServicePulse — shared renderer.
 * Adapts to its host:
 *  - Electron (Windows desktop): real CPU / memory / process list via IPC.
 *  - Capacitor (Android): device, memory, storage, network via Capacitor plugins.
 *  - Plain browser: simulated demo data so the UI can be previewed anywhere.
 */
(function () {
  'use strict';

  var REFRESH_MS = 3000;
  var BURST_MS = 400;      /* fast initial sampling so the chart fills quickly */
  var BURST_SAMPLES = 24;
  var HISTORY_LEN = 60;

  var state = {
    paused: false,
    sortKey: 'cpu',
    sortDir: 'desc',
    filter: '',
    snapshot: null,
    history: [],
    provider: null
  };

  /* ---------------- providers ---------------- */

  var platformNames = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' };

  var electronProvider = {
    label: 'Desktop · Electron',
    hint: 'live IPC data',
    init: function () {
      if (!window.electronAPI) return false;
      var p = window.electronAPI.platform || '';
      this.label = (platformNames[p] || 'Desktop') + ' · Electron';
      state.footerPlatform = 'Electron ' + p;
      return true;
    },
    poll: function () {
      return Promise.all([
        window.electronAPI.overview(),
        window.electronAPI.processes()
      ]).then(function (r) {
        var o = r[0];
        var procs = r[1] || [];
        return {
          cpu: o.cpuLoad,
          cpuDetail: o.cpuModel + ' · ' + o.cores + ' cores',
          memUsed: o.memUsed,
          memTotal: o.memTotal,
          memDetail: o.memDetail,
          network: null,
          host: o.platformName,
          hostDetail: 'uptime ' + o.uptimeText,
          hostExtra: o.memFree != null ? fmtBytes(o.memFree) + ' free' : null,
          processes: procs,
          device: null
        };
      });
    }
  };

  var capacitorProvider = {
    label: 'Android · Capacitor',
    hint: 'device sensors via plugins',
    init: function () {
      if (!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return false;
      this.plugins = (window.Capacitor.Plugins || {});
      if (!this.plugins.Device || !this.plugins.Network) return false;
      var self = this;
      this.plugins.Network.addListener && this.plugins.Network.addListener('networkStatusChange', function () {
        self.refresh && self.refresh();
      });
      state.footerPlatform = 'Capacitor Android';
      return true;
    },
    poll: function () {
      var Device = this.plugins.Device;
      var Network = this.plugins.Network;
      return Promise.all([Device.getInfo(), Network.getStatus()]).then(function (r) {
        var d = r[0];
        var n = r[1];
        var memUsed = typeof d.memUsed === 'number' ? d.memUsed : null;
        var memTotal = memUsed != null && d.diskTotal ? null : null; /* Android exposes used, not total RAM, via this API */
        var diskFree = typeof d.diskFree === 'number' ? d.diskFree : null;
        var diskTotal = typeof d.diskTotal === 'number' ? d.diskTotal : null;
        return {
          cpu: null,
          cpuDetail: null,
          memUsed: memUsed,
          memTotal: null,
          memDetail: memUsed != null ? 'RAM in use' : null,
          network: { connected: !!n.connected, type: n.connectionType },
          host: (d.manufacturer || '') + ' ' + (d.model || ''),
          hostDetail: 'Android ' + (d.osVersion || '?'),
          processes: null,
          device: {
            Model: d.model || '—',
            Manufacturer: d.manufacturer || '—',
            'Android version': d.osVersion || '—',
            Platform: d.platform || 'android',
            Virtual: d.isVirtual ? 'yes' : 'no',
            'Storage free': diskFree != null ? fmtBytes(diskFree) : '—',
            'Storage total': diskTotal != null ? fmtBytes(diskTotal) : '—',
            'Network type': n.connectionType || '—'
          }
        };
      });
    }
  };

  var demoProvider = {
    label: 'Browser · demo data',
    hint: 'simulated samples',
    init: function () { state.footerPlatform = 'browser preview'; return true; },
    poll: function () {
      var demoNames = [
        'systemd', 'explorer.exe', 'svchost.exe', 'chrome.exe', 'code.exe',
        'MsMpEng.exe', 'sqlservr.exe', 'nginx', 'docker-desktop', 'node.exe',
        'SearchIndexer.exe', 'spoolsv.exe', 'sshd', 'postgres', 'redis-server'
      ];
      var procs = demoNames.map(function (name, i) {
        var cpu = clamp(gauss(8 - i * 0.5, 4), 0, 96);
        return {
          pid: 1000 + i * 37 + Math.floor(Math.random() * 9),
          name: name,
          cpu: cpu,
          mem: clamp(gauss(320 - i * 18, 90), 12, 4096) * 1024 * 1024 /* bytes */
        };
      });
      return Promise.resolve({
        cpu: clamp(gauss(34, 14), 2, 98),
        cpuDetail: 'Demo CPU · 8 cores',
        memUsed: 6.1e9 + gauss(0, 6e8),
        memTotal: 16e9,
        memDetail: 'demo RAM',
        network: { connected: true, type: 'wifi' },
        host: 'Demo Workstation',
        hostDetail: 'simulated telemetry',
        processes: procs,
        device: null
      });
    }
  };

  /* ---------------- helpers ---------------- */

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function gauss(mean, sd) {
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function fmtBytes(bytes) {
    if (bytes == null || isNaN(bytes)) return '—';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    var v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 || i < 2 ? 0 : 1) + ' ' + units[i];
  }

  function fmtPct(v) { return v == null ? '—' : v.toFixed(1); }

  function el(id) { return document.getElementById(id); }

  function meterClass(pct) {
    if (pct == null) return '';
    if (pct >= 85) return 'crit';
    if (pct >= 60) return 'warn';
    return '';
  }

  function statusFor(cpu) {
    if (cpu >= 50) return { cls: 'crit', text: 'critical' };
    if (cpu >= 20) return { cls: 'warn', text: 'elevated' };
    return { cls: 'ok', text: 'healthy' };
  }

  /* ---------------- rendering ---------------- */

  function render(snapshot) {
    state.snapshot = snapshot;

    el('platform-label').textContent = state.provider.label;
    el('footer-platform').textContent = state.footerPlatform || state.provider.label;
    el('footer-hint').textContent = state.provider.hint || '';

    /* CPU card */
    if (snapshot.cpu != null) {
      el('cpu-value').textContent = fmtPct(snapshot.cpu);
      el('cpu-sub').textContent = snapshot.cpuDetail || '';
      setMeter('cpu-meter', snapshot.cpu);
      pushHistory(snapshot.cpu);
      drawChart();
    } else {
      el('stat-cpu').style.display = 'none';
    }

    /* Memory card */
    if (snapshot.memUsed != null) {
      var usedGB = snapshot.memUsed / 1e9;
      var totalGB = snapshot.memTotal ? snapshot.memTotal / 1e9 : null;
      el('mem-value').textContent = totalGB ? usedGB.toFixed(1) + ' / ' + totalGB.toFixed(1) : fmtBytes(snapshot.memUsed);
      el('mem-sub').textContent = snapshot.memDetail || '';
      if (snapshot.memTotal) setMeter('mem-meter', (snapshot.memUsed / snapshot.memTotal) * 100);
      if (snapshot.cpu == null) { /* on Android, chart memory instead of CPU */
        pushHistory(snapshot.memTotal ? (snapshot.memUsed / snapshot.memTotal) * 100 : null);
        drawChart();
        el('chart-title').textContent = 'Memory history';
      }
    } else {
      el('stat-mem').style.display = 'none';
    }

    /* Network card */
    if (snapshot.network) {
      el('net-value').textContent = snapshot.network.connected ? 'Online' : 'Offline';
      el('net-sub').textContent = snapshot.network.type || '';
      setMeter('net-meter', snapshot.network.connected ? 100 : 0);
      el('net-meter').className = 'meter-fill ' + (snapshot.network.connected ? '' : 'crit');
    } else {
      el('stat-net').style.display = 'none';
    }

    /* Host card */
    el('host-value').textContent = snapshot.host || '—';
    el('host-sub').textContent = snapshot.hostDetail || '';
    el('host-detail').textContent = snapshot.hostExtra || snapshot.cpuDetail || '';

    /* Processes table (desktop) or device details (Android) */
    if (snapshot.processes) {
      el('process-section').hidden = false;
      renderTable();
    } else {
      el('process-section').hidden = true;
    }

    if (snapshot.device) {
      el('device-section').hidden = false;
      renderDevice(snapshot.device);
    } else {
      el('device-section').hidden = true;
    }

    el('updated').textContent = 'updated ' + new Date().toLocaleTimeString();
  }

  function setMeter(id, pct) {
    var m = el(id);
    m.style.width = clamp(pct, 0, 100).toFixed(1) + '%';
    m.className = 'meter-fill ' + meterClass(pct);
  }

  function pushHistory(value) {
    if (value == null) return;
    state.history.push(value);
    if (state.history.length > HISTORY_LEN) state.history.shift();
  }

  function renderTable() {
    var rows = (state.snapshot.processes || []).slice();
    var f = state.filter.trim().toLowerCase();
    if (f) rows = rows.filter(function (p) { return p.name.toLowerCase().indexOf(f) !== -1 || String(p.pid).indexOf(f) !== -1; });

    var key = state.sortKey;
    var dir = state.sortDir === 'asc' ? 1 : -1;
    rows.sort(function (a, b) {
      var va = a[key], vb = b[key];
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return ((va || 0) - (vb || 0)) * dir;
    });

    document.querySelectorAll('.services-table th[data-sort]').forEach(function (th) {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.getAttribute('data-sort') === key) th.classList.add(state.sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    });

    var tbody = el('service-rows');
    tbody.innerHTML = '';
    var frag = document.createDocumentFragment();
    rows.forEach(function (p) {
      var st = statusFor(p.cpu);
      var tr = document.createElement('tr');

      var tdName = document.createElement('td');
      tdName.className = 'svc-name';
      tdName.textContent = p.name;
      tdName.title = p.name;

      var tdPid = document.createElement('td');
      tdPid.className = 'num';
      tdPid.textContent = p.pid;

      var tdCpu = document.createElement('td');
      tdCpu.className = 'num';
      tdCpu.textContent = p.cpu.toFixed(1) + '%';

      var tdMem = document.createElement('td');
      tdMem.className = 'num';
      tdMem.textContent = fmtBytes(p.mem);

      var tdSt = document.createElement('td');
      var pill = document.createElement('span');
      pill.className = 'pill pill-' + st.cls;
      pill.textContent = st.text;
      tdSt.appendChild(pill);

      tr.append(tdName, tdPid, tdCpu, tdMem, tdSt);
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
    el('empty-state').hidden = rows.length > 0;
  }

  function renderDevice(device) {
    var grid = el('detail-grid');
    grid.innerHTML = '';
    Object.keys(device).forEach(function (k) {
      var wrap = document.createElement('div');
      var dt = document.createElement('dt');
      dt.textContent = k;
      var dd = document.createElement('dd');
      dd.textContent = device[k];
      wrap.append(dt, dd);
      grid.appendChild(wrap);
    });
    el('device-meta').textContent = state.provider.label;
  }

  /* ---------------- chart ---------------- */

  function drawChart() {
    var canvas = el('chart');
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || canvas.width;
    var h = 140;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var pad = 6;
    var data = state.history;
    if (data.length < 1) return;

    var css = getComputedStyle(document.documentElement);
    var accent = css.getPropertyValue('--accent').trim() || '#3ecf9e';
    var grid = css.getPropertyValue('--divider').trim() || '#1d2532';

    /* grid lines at 25/50/75/100% */
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    [25, 50, 75, 100].forEach(function (pct) {
      var y = pad + (1 - pct / 100) * (h - pad * 2);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    });

    /* Until the history buffer is full, the line grows from the left
       across the full width; once full it scrolls right-anchored. */
    var full = data.length >= HISTORY_LEN;
    var x0 = 0;
    var step = full ? w / (HISTORY_LEN - 1) : w / Math.max(data.length - 1, 1);

    /* area fill */
    ctx.beginPath();
    data.forEach(function (v, i) {
      var x = x0 + i * step;
      var y = pad + (1 - clamp(v, 0, 100) / 100) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    var lastX = x0 + (data.length - 1) * step;
    ctx.lineTo(lastX, h);
    ctx.lineTo(x0, h);
    ctx.closePath();
    ctx.fillStyle = css.getPropertyValue('--chart-fill').trim() || 'rgba(62, 207, 158, 0.10)';
    ctx.fill();

    /* line */
    ctx.beginPath();
    data.forEach(function (v, i) {
      var x = x0 + i * step;
      var y = pad + (1 - clamp(v, 0, 100) / 100) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    /* live dot (clamped so it never clips at the right edge) */
    var lastV = data[data.length - 1];
    var lx = Math.min(lastX, w - 5);
    var ly = pad + (1 - clamp(lastV, 0, 100) / 100) * (h - pad * 2);
    ctx.beginPath();
    ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
  }

  /* ---------------- theme toggle ---------------- */

  var SUN_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>';
  var MOON_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var btn = el('theme-btn');
    btn.innerHTML = theme === 'dark' ? SUN_ICON : MOON_ICON;
    btn.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode');
    btn.title = 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode';
  }

  function initTheme() {
    /* In-memory preference; initial value follows the system color scheme. */
    var theme = 'dark';
    try {
      if (window.matchMedia('(prefers-color-scheme: light)').matches) theme = 'light';
    } catch (e) { /* keep default */ }
    applyTheme(theme);
    el('theme-btn').addEventListener('click', function () {
      theme = theme === 'dark' ? 'light' : 'dark';
      applyTheme(theme);
      drawChart();
    });
  }

  /* ---------------- polling loop ---------------- */

  function tick() {
    if (state.paused) return;
    state.provider.poll().then(render).catch(function (err) {
      el('updated').textContent = 'error: ' + (err && err.message ? err.message : err);
    });
  }

  function schedule() {
    var delay = state.history.length < BURST_SAMPLES ? BURST_MS : REFRESH_MS;
    state.timer = window.setTimeout(function () {
      if (!state.paused) tick();
      schedule();
    }, delay);
  }

  function start() {
    var providers = [electronProvider, capacitorProvider, demoProvider];
    for (var i = 0; i < providers.length; i++) {
      try {
        if (providers[i].init()) { state.provider = providers[i]; break; }
      } catch (e) { /* provider unavailable, try next */ }
    }
    if (!state.provider) state.provider = demoProvider;

    capacitorProvider.refresh = tick;
    initTheme();

    /* controls */
    el('pause-btn').addEventListener('click', function () {
      state.paused = !state.paused;
      this.setAttribute('aria-pressed', String(state.paused));
      el('pause-label').textContent = state.paused ? 'Resume' : 'Pause';
      document.querySelector('.dot').className = state.paused ? 'dot dot-paused' : 'dot dot-live';
      if (state.paused) {
        window.clearTimeout(state.timer);
      } else {
        tick();
        schedule();
      }
    });

    el('search').addEventListener('input', function () {
      state.filter = this.value;
      if (state.snapshot && state.snapshot.processes) renderTable();
    });

    document.querySelectorAll('.services-table th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (state.sortKey === k) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = k;
          state.sortDir = k === 'name' ? 'asc' : 'desc';
        }
        if (state.snapshot && state.snapshot.processes) renderTable();
      });
    });

    window.addEventListener('resize', drawChart);

    tick();
    schedule();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

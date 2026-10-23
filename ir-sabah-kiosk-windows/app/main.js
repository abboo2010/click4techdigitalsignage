/* IR@Sabah Kiosk - Windows wrapper for https://drchandranir.info/kiosk
 *
 * - Opens the kiosk fullscreen (no title bar, no taskbar, no browser banner).
 * - Hidden exit: tap the bottom-left corner once -> password box (with its own
 *   on-screen keyboard) -> correct password closes the app.
 * - Backup exit: Ctrl+Alt+X opens the same password box from a keyboard.
 * - Settings live in kiosk-config.json next to the .exe (edit with Notepad,
 *   no rebuild needed): url, exitPassword, debugShowHotspot.
 * - The site itself returns to its splash screen after 90s of no touches,
 *   so no separate screensaver is needed here.
 *
 * Overlay windows use inline data: URLs (not loadFile) on purpose: loading
 * local .html files out of app.asar rendered raw source on the original PC.
 */
const { app, BrowserWindow, globalShortcut, ipcMain, screen, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

app.disableHardwareAcceleration();

/* ---------- config + log ---------- */
const exeDir = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..');
const CONFIG_PATH = process.env.KIOSK_CONFIG || path.join(exeDir, 'kiosk-config.json');   // env override is for testing only
const LOG_PATH = path.join(exeDir, 'kiosk-debug.log');
const DEFAULTS = { url: 'https://drchandranir.info/kiosk', exitPassword: 'CHANGE-ME', debugShowHotspot: false };

function log(msg) {
  try { fs.appendFileSync(LOG_PATH, new Date().toISOString() + '  ' + msg + '\n'); } catch (e) {}
}
try { if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 512 * 1024) fs.writeFileSync(LOG_PATH, ''); } catch (e) {}

function loadConfig() {
  let cfg = Object.assign({}, DEFAULTS);
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (typeof raw.url === 'string' && /^https?:\/\//i.test(raw.url)) cfg.url = raw.url;
    if (typeof raw.exitPassword === 'string' && raw.exitPassword.length) cfg.exitPassword = raw.exitPassword;
    if (typeof raw.debugShowHotspot === 'boolean') cfg.debugShowHotspot = raw.debugShowHotspot;
  } catch (e) { log('config read failed, using defaults: ' + e.message); }
  return cfg;
}
let cfg = DEFAULTS;

/* ---------- state ---------- */
let mainWindow = null, hotspot = null, prompt = null;
let quitting = false, retryTimer = null, promptTimer = null;
let failCount = 0, lockedUntil = 0;

if (!app.requestSingleInstanceLock()) { app.exit(0); }
app.on('second-instance', () => { if (mainWindow) { mainWindow.show(); enforce(); } });

function scaleFactor() {
  const b = screen.getPrimaryDisplay().bounds;
  return Math.max(1, Math.round(Math.min(b.width / 1920, b.height / 1080) * 100) / 100);
}

/* ---------- main kiosk window ---------- */
function createMain() {
  const b = screen.getPrimaryDisplay().bounds;
  mainWindow = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    fullscreen: true, kiosk: true, frame: false, show: false,
    backgroundColor: '#0a2647', autoHideMenuBar: true, title: 'IR@Sabah Kiosk',
    webPreferences: { devTools: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, spellcheck: false }
  });
  Menu.setApplicationMenu(null);
  mainWindow.once('ready-to-show', () => { mainWindow.show(); enforce(); log('main window shown'); });
  mainWindow.on('close', (e) => { if (!quitting) e.preventDefault(); });
  mainWindow.on('focus', raiseOverlays);
  mainWindow.on('enter-full-screen', raiseOverlays);
  mainWindow.on('leave-full-screen', () => { if (!quitting) setTimeout(enforce, 200); });

  const wc = mainWindow.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => {
    try {
      if (url.startsWith('data:')) return;
      if (new URL(url).origin !== new URL(cfg.url).origin) e.preventDefault();
    } catch (err) { e.preventDefault(); }
  });
  wc.on('context-menu', (e) => e.preventDefault());
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = (input.key || '').toLowerCase();
    const blocked = k === 'f11' || k === 'f12' || (input.alt && k === 'f4') ||
      (input.control && ['w', 'n', 'p', 'o', 's', 'u'].includes(k)) ||
      (input.control && input.shift && ['i', 'j', 'c'].includes(k));
    if (blocked) e.preventDefault();
  });
  wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    log('load failed: ' + code + ' ' + desc);
    showOffline();
  });
  wc.on('render-process-gone', (e, d) => { log('renderer gone: ' + d.reason); setTimeout(loadSite, 1500); });
  mainWindow.on('unresponsive', () => { log('window unresponsive, reloading'); loadSite(); });

  loadSite();
}

function loadSite() {
  clearTimeout(retryTimer);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadURL(cfg.url).catch(() => {});
}
function showOffline() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const html = '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0a2647;color:#fff;font-family:Segoe UI,Arial,sans-serif;text-align:center">' +
    '<div><div style="font-size:42px;font-weight:700;color:#e2bc6c">IR@SABAH</div><div style="margin-top:14px;font-size:22px;color:#9fb0c8">Connecting&hellip;</div></div></body>';
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
  clearTimeout(retryTimer);
  retryTimer = setTimeout(loadSite, 10000);
}

/* Re-assert kiosk mode: some Windows setups leave the taskbar visible otherwise */
function enforce() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const b = screen.getPrimaryDisplay().bounds;
  mainWindow.setBounds(b);
  mainWindow.setFullScreen(true);
  mainWindow.setKiosk(true);
  raiseOverlays();
}

function raiseOverlays() {
  [hotspot, prompt].forEach((w) => {
    if (w && !w.isDestroyed() && w.isVisible()) { w.setAlwaysOnTop(true, 'screen-saver'); w.moveTop(); }
  });
}

/* ---------- hidden hotspot (bottom-left) ---------- */
function createHotspot() {
  const b = screen.getPrimaryDisplay().bounds;
  const size = Math.round(90 * scaleFactor());   // matches the menu gap the site leaves in that corner
  hotspot = new BrowserWindow({
    x: b.x, y: b.y + b.height - size, width: size, height: size,
    frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true,
    alwaysOnTop: true, show: false, hasShadow: false, focusable: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }   // sandbox:false is required for require('electron') in data: pages
  });
  hotspot.setAlwaysOnTop(true, 'screen-saver');
  const border = cfg.debugShowHotspot ? 'border:3px solid red;box-sizing:border-box;' : '';
  // alpha 1% (not 0): fully transparent pixels let clicks fall through on Windows
  const html = '<body style="margin:0;width:100vw;height:100vh;overflow:hidden;background:rgba(255,255,255,0.01);' + border + '">' +
    '<script>const {ipcRenderer}=require("electron");let last=0;' +
    'function hit(t){const n=Date.now();ipcRenderer.send("hotspot-event",t);if(n-last>400){last=n;ipcRenderer.send("hotspot-click");}}' +
    '["pointerdown","mousedown","touchstart","click"].forEach(t=>document.addEventListener(t,()=>hit(t),true));</script></body>';
  hotspot.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  hotspot.once('ready-to-show', () => { hotspot.showInactive(); raiseOverlays(); log('hotspot ready ' + size + 'px'); });
}
ipcMain.on('hotspot-event', (e, t) => log('hotspot event: ' + t));
ipcMain.on('hotspot-click', () => openPrompt());

/* ---------- password prompt with on-screen keyboard ---------- */
function promptHtml() {
  return '<!doctype html><meta charset="utf-8"><body>' +
  '<style>' +
  '*{box-sizing:border-box;-webkit-user-select:none;user-select:none}' +
  'body{margin:0;background:#0b1e38;color:#fff;font-family:"Segoe UI",Arial,sans-serif;padding:22px 26px;border:2px solid #d4a94a;height:100vh;overflow:hidden}' +
  'h2{margin:0 0 4px;font-size:24px}p{margin:0 0 12px;font-size:14px;color:#9fb0c8}' +
  '#pw{width:100%;padding:12px 14px;font-size:22px;border-radius:10px;border:2px solid #2b4268;background:#0a2647;color:#fff;outline:none;letter-spacing:2px;-webkit-user-select:text;user-select:text}' +
  '#pw:focus{border-color:#d4a94a}#err{height:22px;margin:6px 0;font-size:14px;color:#ff8a8a}' +
  '.row{display:flex;gap:6px;justify-content:center;margin-bottom:6px}' +
  '.k{flex:1;max-width:64px;height:48px;border:none;border-radius:8px;background:#1b3358;color:#fff;font-size:20px;font-weight:600;cursor:pointer}' +
  '.k:active{background:#2b4a7e}.k.w{max-width:104px;font-size:15px}.k.on{background:#d4a94a;color:#081b36}' +
  '.act{display:flex;gap:10px;margin-top:8px}.act button{flex:1;height:50px;border:none;border-radius:10px;font-size:18px;font-weight:700;cursor:pointer}' +
  '#cancel{background:#1b3358;color:#fff}#ok{background:#d4a94a;color:#081b36}' +
  '</style>' +
  '<h2>Exit kiosk</h2><p>Enter the exit password to close the app.</p>' +
  '<input id="pw" type="password" inputmode="none" autocomplete="off" spellcheck="false" autofocus>' +
  '<div id="err"></div><div id="kb"></div>' +
  '<div class="act"><button id="cancel">Cancel</button><button id="ok">Exit</button></div>' +
  '<script>(' + promptPageScript.toString() + ')()</script></body>';
}

/* Runs inside the password window (it has require() because nodeIntegration is on) */
function promptPageScript() {
  const { ipcRenderer } = require('electron');
  const pw = document.getElementById('pw'), err = document.getElementById('err');
  let shift = false, sym = false;
  const L = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const S = ['!@#$%^&*()', '-_=+[]{};:', '\'"<>,.?/|\\', '~`'];
  function render() {
    const kb = document.getElementById('kb');
    kb.innerHTML = '';
    const rows = sym ? S : L.map((r, i) => (i && shift ? r.toUpperCase() : r));
    rows.forEach((r) => {
      const d = document.createElement('div'); d.className = 'row';
      Array.from(r).forEach((c) => {
        const b = document.createElement('button'); b.className = 'k'; b.textContent = c;
        b.onclick = () => { err.textContent = ''; pw.value += c; if (shift && !sym) { shift = false; render(); } };
        d.appendChild(b);
      });
      kb.appendChild(d);
    });
    const d = document.createElement('div'); d.className = 'row';
    const mk = (t, cls, fn) => { const b = document.createElement('button'); b.className = 'k w' + (cls ? ' ' + cls : ''); b.textContent = t; b.onclick = fn; d.appendChild(b); };
    mk('Shift', shift && !sym ? 'on' : '', () => { sym = false; shift = !shift; render(); });
    mk(sym ? 'ABC' : '@#!', sym ? 'on' : '', () => { sym = !sym; render(); });
    mk('\u232b', '', () => { pw.value = pw.value.slice(0, -1); });
    mk('Clear', '', () => { pw.value = ''; });
    kb.appendChild(d);
  }
  render();
  function submit() { ipcRenderer.send('prompt-submit', pw.value); }
  document.getElementById('ok').onclick = submit;
  document.getElementById('cancel').onclick = () => ipcRenderer.send('prompt-cancel');
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') ipcRenderer.send('prompt-cancel'); });
  ipcRenderer.on('prompt-result', (e, ok, msg) => { err.textContent = ok ? '' : msg; if (!ok) pw.value = ''; });
  ipcRenderer.on('prompt-reset', () => { pw.value = ''; err.textContent = ''; shift = false; sym = false; render(); pw.focus(); });
}

function openPrompt() {
  if (prompt && !prompt.isDestroyed()) { prompt.show(); prompt.webContents.send('prompt-reset'); armPromptTimer(); raiseOverlays(); return; }
  const f = scaleFactor();
  const w = Math.round(700 * f), h = Math.round(560 * f);
  const b = screen.getPrimaryDisplay().bounds;
  prompt = new BrowserWindow({
    x: Math.round(b.x + (b.width - w) / 2), y: Math.round(b.y + (b.height - h) / 2), width: w, height: h,
    frame: false, resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    backgroundColor: '#0b1e38',
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, zoomFactor: f }
  });
  prompt.setAlwaysOnTop(true, 'screen-saver');
  prompt.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(promptHtml()));
  prompt.once('ready-to-show', () => { prompt.show(); prompt.focus(); raiseOverlays(); armPromptTimer(); log('password prompt opened'); });
  prompt.on('closed', () => { prompt = null; clearTimeout(promptTimer); });
}
function armPromptTimer() { clearTimeout(promptTimer); promptTimer = setTimeout(closePrompt, 30000); }   // never leave it open
function closePrompt() { clearTimeout(promptTimer); if (prompt && !prompt.isDestroyed()) prompt.hide(); }

ipcMain.on('prompt-cancel', () => { log('prompt cancelled'); closePrompt(); });
ipcMain.on('prompt-submit', (e, pw) => {
  armPromptTimer();
  const now = Date.now();
  if (now < lockedUntil) { e.sender.send('prompt-result', false, 'Too many attempts. Try again in ' + Math.ceil((lockedUntil - now) / 1000) + 's.'); return; }
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  const ok = crypto.timingSafeEqual(h(pw), h(cfg.exitPassword));
  log('password attempt: ' + (ok ? 'correct' : 'wrong'));
  if (ok) { failCount = 0; quitApp(); return; }
  failCount++;
  if (failCount >= 5) { failCount = 0; lockedUntil = Date.now() + 30000; e.sender.send('prompt-result', false, 'Too many attempts. Locked for 30s.'); }
  else e.sender.send('prompt-result', false, 'Wrong password.');
});

function quitApp() {
  quitting = true;
  log('exit password accepted, quitting');
  try { globalShortcut.unregisterAll(); } catch (e) {}
  setTimeout(() => app.exit(0), 150);
}

/* ---------- start ---------- */
app.whenReady().then(() => {
  cfg = loadConfig();
  log('start, url=' + cfg.url);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'fullscreen'));
  createMain();
  createHotspot();
  try { globalShortcut.register('Control+Alt+X', () => { log('Ctrl+Alt+X'); openPrompt(); }); } catch (e) { log('shortcut failed: ' + e.message); }
  screen.on('display-metrics-changed', () => { if (!quitting) enforce(); });
  setInterval(raiseOverlays, 3000);
});
app.on('window-all-closed', () => { /* stay running: only the password exits */ });

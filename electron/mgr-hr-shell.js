'use strict';
/**
 * Shop POS Manager & Supervisor Portal — live Windows shell.
 * Loads Railway mgr-hr-app so every deploy reaches this PC automatically.
 */
const { app, BrowserWindow, Menu } = require('electron');

const BASE = (process.env.SHOP_POS_SYNC_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const APP_URL = `${BASE}/mgr-hr-app.html`;
const ENV_URL = `${BASE}/js/env.js`;

let mainWindow = null;
let knownDeploy = '';
let pollTimer = null;
let loadWatchdog = null;

function offlineHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Manager & Supervisor Portal</title>
<style>
  body { font-family: Segoe UI, sans-serif; background:#14213d; color:#e2e8f0; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
  .card { max-width:420px; padding:28px; background:#1b2a4a; border-radius:16px; text-align:center; }
  h1 { margin:0 0 8px; font-size:22px; }
  p { color:#94a3b8; line-height:1.45; }
  button { margin-top:12px; background:#c41e3a; color:#fff; border:0; border-radius:10px; padding:10px 16px; font-weight:700; cursor:pointer; }
</style></head>
<body><div class="card">
  <h1>Manager &amp; Supervisor Portal</h1>
  <p>This app needs the internet so it can load the latest HR portal changes from your shop.</p>
  <p>Sign in with your assigned manager/supervisor account (or Admin credentials).</p>
  <button onclick="location.href='${APP_URL}'">Retry</button>
</div></body></html>`;
}

function showOffline() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlineHtml())}`).catch(() => {});
  if (!mainWindow.isVisible()) mainWindow.show();
}

async function readDeployVersion() {
  const res = await fetch(`${ENV_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not read deploy version (${res.status})`);
  const text = await res.text();
  const m = String(text).match(/__SHOP_POS_DEPLOY__\s*=\s*"([^"]+)"/);
  return m ? m[1] : '';
}

async function applyLiveUpdate(force) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const ver = await readDeployVersion();
    if (!ver) return;
    if (!knownDeploy) {
      knownDeploy = ver;
      if (force) mainWindow.webContents.reloadIgnoringCache();
      return;
    }
    if (force || ver !== knownDeploy) {
      knownDeploy = ver;
      mainWindow.webContents.reloadIgnoringCache();
    }
  } catch (_) { /* keep current page */ }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'Manager & Supervisor Portal',
    autoHideMenuBar: true,
    backgroundColor: '#14213d',
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:shoppos-mgr-hr'
    }
  });

  // Admin / managers recording conversations — grant mic without extra OS prompts where possible
  try {
    mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      if (permission === 'media' || permission === 'microphone' || permission === 'audioCapture') {
        callback(true);
        return;
      }
      callback(false);
    });
    mainWindow.webContents.session.setPermissionCheckHandler((_wc, permission) => {
      return permission === 'media' || permission === 'microphone' || permission === 'audioCapture';
    });
  } catch (_) { /* ignore */ }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Manager Portal',
      submenu: [
        { label: 'Reload latest changes', accelerator: 'CmdOrCtrl+R', click: () => applyLiveUpdate(true) },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }
  ]));

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain) return;
    console.warn('[mgr-hr] did-fail-load', code, desc, url);
    showOffline();
  });

  if (loadWatchdog) clearTimeout(loadWatchdog);
  loadWatchdog = setTimeout(() => {
    try {
      const u = mainWindow?.webContents?.getURL?.() || '';
      if (!u || u === 'about:blank') showOffline();
    } catch (_) { showOffline(); }
  }, 20000);

  mainWindow.webContents.on('did-finish-load', () => {
    if (loadWatchdog) {
      clearTimeout(loadWatchdog);
      loadWatchdog = null;
    }
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
  });

  mainWindow.loadURL(APP_URL).catch(() => showOffline());
  pollTimer = setInterval(() => applyLiveUpdate(false), 45000);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(createWindow);
  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.on('window-all-closed', () => {
    if (pollTimer) clearInterval(pollTimer);
    if (loadWatchdog) clearTimeout(loadWatchdog);
    if (process.platform !== 'darwin') app.quit();
  });
}

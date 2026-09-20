'use strict';
/**
 * Shop POS Staff Portal — live Windows shell.
 */
const { app, BrowserWindow, Menu } = require('electron');

const BASE = (process.env.SHOP_POS_SYNC_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const APP_URL = `${BASE}/staff-app.html`;
const ENV_URL = `${BASE}/js/env.js`;

let mainWindow = null;
let knownDeploy = '';
let pollTimer = null;

function offlineHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Staff Portal</title>
<style>
  body { font-family: Segoe UI, sans-serif; background:#0f172a; color:#e2e8f0; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
  .card { max-width:420px; padding:28px; background:#1e293b; border-radius:16px; text-align:center; }
  h1 { margin:0 0 8px; font-size:22px; }
  p { color:#94a3b8; line-height:1.45; }
  button { margin-top:12px; background:#2563eb; color:#fff; border:0; border-radius:10px; padding:10px 16px; font-weight:700; cursor:pointer; }
</style></head>
<body><div class="card">
  <h1>Staff Portal</h1>
  <p>This app needs the internet so it can load the latest Staff Portal changes from your shop.</p>
  <button onclick="location.href='${APP_URL}'">Retry</button>
</div></body></html>`;
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
    width: 1100,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Staff Portal',
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:shoppos-staff'
    }
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Staff',
      submenu: [
        { label: 'Reload latest changes', accelerator: 'CmdOrCtrl+R', click: () => applyLiveUpdate(true) },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }
  ]));

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('did-fail-load', (_e, _code, _desc, _url, isMainFrame) => {
    if (!isMainFrame || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlineHtml())}`);
  });
  mainWindow.on('focus', () => { applyLiveUpdate(false); });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(APP_URL);
  applyLiveUpdate(false);
}

app.whenReady().then(() => {
  createWindow();
  pollTimer = setInterval(() => applyLiveUpdate(false), 30000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (pollTimer) clearInterval(pollTimer);
  if (process.platform !== 'darwin') app.quit();
});

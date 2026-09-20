'use strict';
/**
 * Menu & Promo Studio — live Windows shell.
 * Loads Railway /studio/ so login + permissions stay server-side.
 */
const { app, BrowserWindow, Menu } = require('electron');

const BASE = (process.env.SHOP_POS_SYNC_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const APP_URL = `${BASE}/studio/`;
const ENV_URL = `${BASE}/js/env.js`;

let mainWindow = null;
let knownDeploy = '';
let pollTimer = null;

function offlineHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Menu & Promo Studio</title>
<style>
  body { font-family: Segoe UI, sans-serif; background:#020617; color:#e2e8f0; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
  .card { max-width:420px; padding:28px; background:#0f172a; border-radius:16px; text-align:center; border:1px solid rgba(255,255,255,.1); }
  h1 { margin:0 0 8px; font-size:22px; }
  p { color:#94a3b8; line-height:1.45; }
  button { margin-top:12px; background:#ef4444; color:#fff; border:0; border-radius:10px; padding:10px 16px; font-weight:700; cursor:pointer; }
</style></head>
<body><div class="card">
  <h1>Menu &amp; Promo Studio</h1>
  <p>This app needs the internet so it can verify your staff login and permissions on the shop server.</p>
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
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: 'Menu & Promo Studio',
    autoHideMenuBar: true,
    backgroundColor: '#020617',
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:shoppos-studio'
    }
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Studio',
      submenu: [
        { label: 'Reload latest changes', accelerator: 'CmdOrCtrl+R', click: () => applyLiveUpdate(true) },
        { label: 'Open in browser', click: () => require('electron').shell.openExternal(APP_URL) },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }
  ]));

  mainWindow.loadURL(APP_URL).catch(() => {
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlineHtml())}`);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  pollTimer = setInterval(() => applyLiveUpdate(false), 60000);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });
app.on('before-quit', () => { if (pollTimer) clearInterval(pollTimer); });

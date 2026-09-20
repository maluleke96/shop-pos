'use strict';
/**
 * Shop POS Referral & Commission — live Windows shell.
 * Loads Admin (same credentials) so Referral & Commission deploys reach this PC automatically.
 */
const { app, BrowserWindow, Menu } = require('electron');

const BASE = (process.env.SHOP_POS_SYNC_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
// Load index with mode via sessionStorage bootstrap page (no ?query — more reliable)
const APP_URL = `${BASE}/referral-commission-app.html`;
const ENV_URL = `${BASE}/js/env.js`;

let mainWindow = null;
let knownDeploy = '';
let pollTimer = null;
let loadWatchdog = null;

function offlineHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Referral Commission</title>
<style>
  body { font-family: Segoe UI, sans-serif; background:#0f2744; color:#e2e8f0; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
  .card { max-width:420px; padding:28px; background:#16365c; border-radius:16px; text-align:center; }
  h1 { margin:0 0 8px; font-size:22px; }
  p { color:#94a3b8; line-height:1.45; }
  button { margin-top:12px; background:#0d9488; color:#fff; border:0; border-radius:10px; padding:10px 16px; font-weight:700; cursor:pointer; }
</style></head>
<body><div class="card">
  <h1>Referral Commission</h1>
  <p>This app needs the internet so it can load the latest Referral &amp; Commission changes from your shop.</p>
  <p>Sign in with owner / manager / supervisor credentials.</p>
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
  } catch (_) {
    /* stay on the current page if the check fails */
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'Referral Commission',
    autoHideMenuBar: true,
    backgroundColor: '#0f2744',
    show: true, // show immediately — never wait forever on ready-to-show
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:shoppos-referral-commission'
    }
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Referral Commission',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => applyLiveUpdate(true) },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }
  ]));

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain) return;
    console.warn('[referral-commission] did-fail-load', code, desc, url);
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
  // Focus existing instance instead of silent quit feeling like "won't open"
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

'use strict';
/** Thin Windows window that opens one live shop URL. */
const { app, BrowserWindow } = require('electron');

const base = (process.env.SHOP_POS_SYNC_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const livePath = process.env.SHOP_POS_LIVE_PATH || '/';
const title = process.env.SHOP_POS_WINDOW_TITLE || 'Shop POS';
const url = base + (livePath.startsWith('/') ? livePath : `/${livePath}`);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title,
    autoHideMenuBar: true,
    backgroundColor: '#0f2744',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  win.loadURL(url);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

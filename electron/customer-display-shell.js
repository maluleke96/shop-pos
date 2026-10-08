'use strict';
const { app, BrowserWindow } = require('electron');
const BASE = (process.env.SHOP_POS_SYNC_URL || process.env.SHOP_POS_LAB_URL || 'https://shoppos-lab-production.up.railway.app').replace(/\/$/, '');
const APP_URL = `${BASE}/customer-display.html`;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 720, fullscreen: true, kiosk: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.loadURL(APP_URL);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

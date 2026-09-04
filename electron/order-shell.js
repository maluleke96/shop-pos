'use strict';
const { app, BrowserWindow } = require('electron');
const url = (process.env.SHOP_POS_SYNC_URL || "https://chisafood.up.railway.app").replace(/\/$/, '') + '/order/';

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 860,
    minWidth: 360,
    minHeight: 600,
    title: "Online Ordering",
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  win.loadURL(url);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

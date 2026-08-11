const { BrowserWindow, screen, app: electronApp } = require('electron');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

let kitchenWindow = null;
let customerWindow = null;

function getPrintersFromWindow(mainWindow) {
  if (!mainWindow) return Promise.resolve([]);
  try {
    if (mainWindow.webContents.getPrintersAsync) {
      return mainWindow.webContents.getPrintersAsync();
    }
    return Promise.resolve(mainWindow.webContents.getPrinters() || []);
  } catch {
    return Promise.resolve([]);
  }
}

function mergePrintSettings(settings, overrides = {}, localDevice = {}) {
  const ps = settings?.printer_settings || {};
  const ds = { ...(settings?.device_settings || {}), ...localDevice };
  return {
    receiptPrinter: overrides.receiptPrinter || ps.receipt_printer || ds.receipt_printer || '',
    kitchenPrinter: overrides.kitchenPrinter || ps.kitchen_printer || ds.kitchen_printer || '',
    invoicePrinter: ps.invoice_printer || '',
    barcodePrinter: ps.barcode_printer || ps.receipt_printer || ds.receipt_printer || '',
    paperSize: overrides.paperSize || ps.paper_size || ds.paper_size || '80mm',
    silent: overrides.silent ?? ps.silent_print ?? true,
    copies: ps.copies || 1,
    kitchenAuto: ps.kitchen_auto !== false,
    receiptConnection: ps.receipt_connection || ds.receipt_connection || 'usb',
    kitchenConnection: ps.kitchen_connection || ds.kitchen_connection || 'usb',
    printDuplicate: !!ps.print_duplicate
  };
}

function printerStatus(name, printers) {
  if (!name) return { online: false, message: 'No printer selected' };
  const found = (printers || []).some(p => p.name === name);
  return found
    ? { online: true, message: 'Ready — detected on this computer' }
    : { online: false, message: 'Not found — check USB/B Bluetooth connection' };
}

function classifyPrinterConnection(printer) {
  const name = (printer.name || '').toLowerCase();
  const desc = (printer.description || printer.displayName || '').toLowerCase();
  const opts = JSON.stringify(printer.options || {}).toLowerCase();
  const combined = `${name} ${desc} ${opts}`;
  if (/bluetooth|bt:|rfcomm|bth|ble/i.test(combined)) return 'bluetooth';
  if (/\\\\|http:|https:|ipp:|tcp|network|wi-fi|wifi|port.*\d+\.\d+\.\d+\.\d+|(\d{1,3}\.){3}\d{1,3}/i.test(combined)) return 'network';
  if (/usb|dot4|local port|nul:|com\d/i.test(combined)) return 'usb';
  if (printer.isLocal !== false && !/pdf|xps|onenote|fax|microsoft print/i.test(combined)) return 'usb';
  return 'network';
}

function enrichPrinters(printers) {
  return (printers || []).map(p => ({
    name: p.name,
    displayName: p.displayName || p.name,
    description: p.description || '',
    isDefault: !!p.isDefault,
    status: p.status || 0,
    connectionType: classifyPrinterConnection(p)
  }));
}

function filterPrintersByConnection(printers, connection) {
  const enriched = enrichPrinters(printers);
  if (!connection || connection === 'all') return enriched;
  return enriched.filter(p => p.connectionType === connection);
}

async function openPreviewWindow(html, title = 'Print Preview') {
  const previewWin = new BrowserWindow({
    width: 480,
    height: 720,
    title,
    webPreferences: { nodeIntegration: false }
  });
  await previewWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return previewWin;
}

async function connectPrinter(connection, options = {}, mainWindow) {
  const { ip, printerName } = options;
  if (connection === 'bluetooth') {
    const { shell } = require('electron');
    await shell.openExternal('ms-settings:bluetooth');
    const printers = await getPrintersFromWindow(mainWindow);
    const bt = filterPrintersByConnection(printers, 'bluetooth');
    if (bt.length) {
      return { success: true, message: 'Bluetooth printer detected on this device', printers: bt, selected: bt[0].name };
    }
    return {
      success: true,
      paired: false,
      message: 'Pair your printer in Windows Bluetooth settings, then click Connect again to detect it.',
      printers: bt
    };
  }
  if (connection === 'network') {
    if (!ip) throw new Error('Enter the printer IP address first');
    const portName = `ShopPOS_${String(ip).replace(/\./g, '_')}`;
    const safeIp = String(ip).replace(/[^0-9.]/g, '');
    const safePort = portName.replace(/'/g, "''");
    try {
      await execAsync(
        `powershell -NoProfile -Command "$port='${safePort}'; $ip='${safeIp}'; if(-not (Get-PrinterPort -Name $port -ErrorAction SilentlyContinue)){ Add-PrinterPort -Name $port -PrinterHostIPAddress $ip -PortNumber 9100 }; 'OK'"`,
        { timeout: 30000 }
      );
    } catch (err) {
      throw new Error(`Could not add network port: ${err.message}. Add the printer manually in Windows Settings → Printers.`);
    }
    const printers = await getPrintersFromWindow(mainWindow);
    const net = filterPrintersByConnection(printers, 'network');
    const match = printerName
      ? net.find(p => p.name === printerName)
      : net.find(p => (p.name + p.description).includes(safeIp)) || net[0];
    return {
      success: true,
      message: `Network port configured for ${safeIp}:9100`,
      printers: net,
      selected: match?.name || null,
      ip: safeIp
    };
  }
  const printers = await getPrintersFromWindow(mainWindow);
  const usb = filterPrintersByConnection(printers, 'usb');
  if (!usb.length) {
    return { success: false, error: 'No USB printer found. Plug in the printer, turn it on, then try again.' };
  }
  const pick = printerName && usb.find(p => p.name === printerName) ? printerName : usb[0].name;
  return { success: true, message: 'USB printer detected', printers: usb, selected: pick };
}

async function printHtml(html, options = {}) {
  const {
    deviceName,
    silent = false,
    copies = 1,
    paperSize = '80mm'
  } = options;

  const width = paperSize === '58mm' ? '58mm' : paperSize === 'A4' ? '210mm' : '80mm';
  const wrapped = html.includes('<html')
    ? html.replace('</head>', `<style>@page{size:${paperSize === 'A4' ? 'A4' : width} auto;margin:0} body{max-width:${width}!important}</style></head>`)
    : html;

  const printWin = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false } });
  await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(wrapped)}`);

  for (let i = 0; i < copies; i++) {
    await new Promise((resolve, reject) => {
      printWin.webContents.print({
        silent: !!silent,
        printBackground: true,
        deviceName: deviceName || undefined
      }, (success, failureReason) => {
        if (!success && failureReason) reject(new Error(failureReason));
        else resolve();
      });
    });
  }
  if (options.printDuplicate) {
    await new Promise((resolve, reject) => {
      printWin.webContents.print({
        silent: !!silent,
        printBackground: true,
        deviceName: deviceName || undefined
      }, (success, failureReason) => {
        if (!success && failureReason) reject(new Error(failureReason));
        else resolve();
      });
    });
  }
  printWin.close();
  return { success: true };
}

async function openCashDrawer(deviceName) {
  if (!deviceName) throw new Error('No receipt printer configured');
  const kick = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]);
  const tmp = path.join(electronApp.getPath('temp'), `drawer-kick-${Date.now()}.bin`);
  fs.writeFileSync(tmp, kick);
  const safeName = deviceName.replace(/'/g, "''");
  const safeTmp = tmp.replace(/\\/g, '/').replace(/'/g, "''");
  try {
    await execAsync(`powershell -NoProfile -Command "$p=Get-Printer -Name '${safeName}' -ErrorAction SilentlyContinue; if(-not $p){throw 'Printer not found'}; $port=$p.PortName; if($port -match '^USB|^COM|^LPT'){ [System.IO.File]::WriteAllBytes('${safeTmp}', [byte[]](27,112,0,25,250)); cmd /c copy /b '${safeTmp}' \\\\$env:COMPUTERNAME\\$port 2>$null; if($LASTEXITCODE -ne 0){ [System.IO.File]::WriteAllBytes(('\\\\.\\'+$port), [byte[]](27,112,0,25,250)) } } else { throw 'Port not supported' }"`, { timeout: 12000 });
    return { success: true };
  } catch (err) {
    await printHtml('<html><body style="font-size:8px">.</body></html>', { deviceName, silent: true });
    return { success: true, fallback: true, message: err.message };
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function buildBarcodeLabel(product, settings) {
  const s = settings || {};
  const name = product.name || 'Product';
  const code = product.barcode || product.sku || String(product.id || '');
  const price = s.currency ? `${s.currency}${Number(product.selling_price || 0).toFixed(2)}` : Number(product.selling_price || 0).toFixed(2);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page{size:50mm 30mm;margin:2mm} body{font-family:Arial,sans-serif;margin:0;padding:4px;text-align:center}
    .name{font-size:11px;font-weight:bold;margin-bottom:4px;max-height:24px;overflow:hidden}
    .code{font-family:'Courier New',monospace;font-size:22px;font-weight:bold;letter-spacing:2px;margin:6px 0}
    .price{font-size:14px;font-weight:bold}
    .shop{font-size:9px;color:#555;margin-top:4px}
  </style></head><body>
    <div class="name">${name}</div>
    <div class="code">${code}</div>
    <div class="price">${price}</div>
    <div class="shop">${s.shop_name || 'Shop POS'}</div>
  </body></html>`;
}

async function printBarcodeLabel(product, settings, localDevice = {}) {
  const ps = settings?.printer_settings || {};
  const ds = { ...(settings?.device_settings || {}), ...localDevice };
  const deviceName = ps.barcode_printer || ds.receipt_printer || ps.receipt_printer;
  if (!deviceName) throw new Error('No barcode or receipt printer configured');
  const html = buildBarcodeLabel(product, settings);
  await printHtml(html, { deviceName, silent: true, paperSize: '58mm' });
  return { success: true, printer: deviceName };
}

function openKitchenDisplay(parentWindow, preloadPath, htmlPath) {
  if (kitchenWindow && !kitchenWindow.isDestroyed()) {
    kitchenWindow.focus();
    return kitchenWindow;
  }

  const displays = screen.getAllDisplays();
  const external = displays.length > 1 ? displays[1] : displays[0];
  const bounds = external.bounds;

  const width = Math.min(1280, Math.max(960, Math.round(bounds.width * 0.85)));
  const height = Math.min(900, Math.max(640, Math.round(bounds.height * 0.85)));
  const x = bounds.x + Math.round((bounds.width - width) / 2);
  const y = bounds.y + Math.round((bounds.height - height) / 2);

  kitchenWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 800,
    minHeight: 500,
    fullscreen: false,
    fullscreenable: true,
    title: 'Kitchen Display',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  kitchenWindow.loadFile(htmlPath);
  kitchenWindow.once('ready-to-show', () => kitchenWindow.show());
  kitchenWindow.on('closed', () => { kitchenWindow = null; });
  return kitchenWindow;
}

function closeKitchenDisplay() {
  if (kitchenWindow && !kitchenWindow.isDestroyed()) {
    kitchenWindow.close();
    kitchenWindow = null;
  }
}

function refreshKitchenDisplay() {
  if (kitchenWindow && !kitchenWindow.isDestroyed()) {
    kitchenWindow.webContents.send('kitchen:refresh');
  }
  if (customerWindow && !customerWindow.isDestroyed()) {
    customerWindow.webContents.send('kitchen:refresh');
  }
}

function openCustomerDisplay(parentWindow, preloadPath, htmlPath) {
  if (customerWindow && !customerWindow.isDestroyed()) {
    customerWindow.focus();
    return customerWindow;
  }

  const displays = screen.getAllDisplays();
  // Prefer a second screen so the board can sit on the customer-facing monitor
  const external = displays.length > 1 ? displays[1] : displays[0];
  const bounds = external.bounds;
  const width = Math.min(1400, Math.max(960, Math.round(bounds.width * 0.9)));
  const height = Math.min(900, Math.max(640, Math.round(bounds.height * 0.85)));
  const x = bounds.x + Math.round((bounds.width - width) / 2);
  const y = bounds.y + Math.round((bounds.height - height) / 2);

  customerWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 800,
    minHeight: 500,
    fullscreen: false,
    fullscreenable: true,
    title: 'Customer Order Display',
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  customerWindow.loadFile(htmlPath);
  customerWindow.once('ready-to-show', () => customerWindow.show());
  customerWindow.on('closed', () => { customerWindow = null; });
  return customerWindow;
}

function closeCustomerDisplay() {
  if (customerWindow && !customerWindow.isDestroyed()) {
    customerWindow.close();
    customerWindow = null;
  }
}

function refreshCustomerDisplay() {
  refreshKitchenDisplay();
}

module.exports = {
  getPrintersFromWindow,
  mergePrintSettings,
  printerStatus,
  enrichPrinters,
  filterPrintersByConnection,
  classifyPrinterConnection,
  connectPrinter,
  printHtml,
  openPreviewWindow,
  openKitchenDisplay,
  closeKitchenDisplay,
  refreshKitchenDisplay,
  openCustomerDisplay,
  closeCustomerDisplay,
  refreshCustomerDisplay,
  openCashDrawer,
  buildBarcodeLabel,
  printBarcodeLabel
};

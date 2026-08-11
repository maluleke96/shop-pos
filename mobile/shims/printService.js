let kitchenWindow = null;
const KITCHEN_CHANNEL = 'shoppos-kitchen';

function isCapacitorNative() {
  return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
}

function mergePrintSettings(settings, overrides = {}, localDevice = {}) {
  const ps = settings?.printer_settings || {};
  const ds = { ...(settings?.device_settings || {}), ...localDevice };
  return {
    receiptPrinter: overrides.receiptPrinter || ps.receipt_printer || ds.receipt_printer || 'System Print',
    kitchenPrinter: overrides.kitchenPrinter || ps.kitchen_printer || ds.kitchen_printer || 'System Print',
    invoicePrinter: ps.invoice_printer || 'System Print',
    barcodePrinter: ps.barcode_printer || ps.receipt_printer || ds.receipt_printer || 'System Print',
    paperSize: overrides.paperSize || ps.paper_size || ds.paper_size || '80mm',
    silent: false,
    copies: ps.copies || 1,
    kitchenAuto: ps.kitchen_auto !== false,
    receiptConnection: ps.receipt_connection || ds.receipt_connection || 'usb',
    kitchenConnection: ps.kitchen_connection || ds.kitchen_connection || 'usb',
    printDuplicate: !!ps.print_duplicate
  };
}

function systemPrinters() {
  return [{
    name: 'System Print',
    displayName: 'Android System Print',
    description: 'Opens the device print dialog',
    isDefault: true,
    status: 0,
    connectionType: 'system'
  }];
}

function getPrintersFromWindow() {
  return Promise.resolve(systemPrinters());
}

function enrichPrinters(printers) {
  return printers?.length ? printers : systemPrinters();
}

function filterPrintersByConnection(printers, connection) {
  const list = enrichPrinters(printers);
  if (!connection || connection === 'all') return list;
  if (connection === 'usb' || connection === 'network' || connection === 'bluetooth') {
    return [{ ...list[0], connectionType: connection, displayName: `${connection.toUpperCase()} via Android Print` }];
  }
  return list;
}

function printerStatus(name) {
  if (!name || name === 'System Print') {
    return { online: true, message: 'Ready — uses Android system print dialog' };
  }
  return { online: true, message: 'Print via Android when completing a sale' };
}

function wrapHtml(html, paperSize) {
  const width = paperSize === '58mm' ? '58mm' : paperSize === 'A4' ? '210mm' : '80mm';
  const pageSize = paperSize === 'A4' ? 'A4' : width;
  if (html.includes('<html')) {
    return html.replace('</head>', `<style>@page{size:${pageSize} auto;margin:0} body{max-width:${width}!important}</style></head>`);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page{size:${pageSize} auto;margin:0} body{font-family:Arial,sans-serif;margin:0;padding:8px;max-width:${width}}
  </style></head><body>${html}</body></html>`;
}

function printHtmlOnce(html) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0';
    document.body.appendChild(iframe);
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument || win.document;
    doc.open();
    doc.write(html);
    doc.close();
    const runPrint = () => {
      setTimeout(() => {
        try {
          win.focus();
          win.print();
          setTimeout(() => {
            document.body.removeChild(iframe);
            resolve();
          }, 500);
        } catch (err) {
          document.body.removeChild(iframe);
          reject(err);
        }
      }, 250);
    };
    if (doc.readyState === 'complete') runPrint();
    else iframe.onload = runPrint;
  });
}

async function shareHtmlForPrint(html, title) {
  const capFiles = require('../capacitorFiles');
  const safeTitle = String(title || 'receipt').replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `${safeTitle}.html`;
  const bytes = new TextEncoder().encode(html);
  await capFiles.saveAndShare(filename, bytes);
}

async function printHtml(html, options = {}) {
  const { copies = 1, paperSize = '80mm', printDuplicate = false } = options;
  const wrapped = wrapHtml(html, paperSize);
  if (isCapacitorNative()) {
    await openPreviewWindow(wrapped, 'Print Receipt');
    return { success: true };
  }
  for (let i = 0; i < copies; i++) await printHtmlOnce(wrapped);
  if (printDuplicate) await printHtmlOnce(wrapped);
  return { success: true };
}

async function openPreviewWindow(html, title = 'Print Preview') {
  const overlay = document.createElement('div');
  overlay.id = 'mobile-print-preview';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;flex-direction:column;padding:12px';
  const shareBtn = isCapacitorNative()
    ? '<button type="button" id="mob-print-share" class="btn btn-ghost" style="padding:8px 14px;border:1px solid #ccc;border-radius:8px;background:#fff">Share / Save</button>'
    : '';
  overlay.innerHTML = `<div style="background:var(--bg,#fff);border-radius:12px;flex:1;display:flex;flex-direction:column;overflow:hidden;max-width:100%">
    <div style="padding:12px 16px;border-bottom:1px solid var(--border,#ddd);display:flex;justify-content:space-between;align-items:center;gap:8px">
      <strong style="font-size:15px">${title}</strong>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" id="mob-print-go" class="btn btn-primary" style="padding:8px 14px;border:none;border-radius:8px;background:#2563eb;color:#fff;font-weight:600">Print</button>
        ${shareBtn}
        <button type="button" id="mob-print-close" class="btn btn-ghost" style="padding:8px 14px;border:1px solid #ccc;border-radius:8px;background:#fff">Close</button>
      </div>
    </div>
    <iframe id="mob-print-frame" style="flex:1;border:0;width:100%;min-height:0;background:#fff"></iframe>
  </div>`;
  document.body.appendChild(overlay);
  const frame = overlay.querySelector('#mob-print-frame');
  const doc = frame.contentDocument || frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  overlay.querySelector('#mob-print-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#mob-print-go').addEventListener('click', () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (_) {}
  });
  overlay.querySelector('#mob-print-share')?.addEventListener('click', () => {
    shareHtmlForPrint(html, title).catch(err => alert(err.message || 'Could not share'));
  });
  return overlay;
}

async function connectPrinter(connection, options = {}) {
  if (connection === 'bluetooth') {
    return {
      success: true,
      paired: false,
      message: 'Pair your Bluetooth printer in Android Settings → Connected devices. Printing uses the system print dialog.',
      printers: filterPrintersByConnection(null, 'bluetooth'),
      selected: 'System Print'
    };
  }
  if (connection === 'network') {
    const ip = options.ip || '';
    return {
      success: true,
      message: ip
        ? `Configure network printer ${ip} in your Android print service, then print from Shop POS.`
        : 'Enter printer IP in Admin, or add the printer in Android Settings → Printing.',
      printers: filterPrintersByConnection(null, 'network'),
      selected: 'System Print',
      ip
    };
  }
  return {
    success: true,
    message: 'USB and network printers are available through the Android print dialog when you print a receipt.',
    printers: filterPrintersByConnection(null, 'usb'),
    selected: 'System Print'
  };
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

async function printBarcodeLabel(product, settings) {
  const html = buildBarcodeLabel(product, settings);
  await printHtml(html, { paperSize: '58mm' });
  return { success: true, printer: 'System Print' };
}

async function openCashDrawer() {
  return {
    success: false,
    error: 'Cash drawer kick requires a USB receipt printer on Windows. Open the drawer manually on Android.'
  };
}

let customerWindow = null;

function openKitchenDisplay() {
  if (kitchenWindow && !kitchenWindow.closed) {
    kitchenWindow.focus();
    return kitchenWindow;
  }
  kitchenWindow = window.open('kitchen-display.html', 'kitchenDisplay', 'noopener,noreferrer,width=1200,height=800,menubar=no,toolbar=no,location=no,status=no');
  return kitchenWindow;
}

function closeKitchenDisplay() {
  if (kitchenWindow && !kitchenWindow.closed) kitchenWindow.close();
  kitchenWindow = null;
}

function refreshKitchenDisplay() {
  try {
    const bc = new BroadcastChannel(KITCHEN_CHANNEL);
    bc.postMessage({ type: 'refresh' });
    bc.close();
  } catch (_) {}
  if (kitchenWindow && !kitchenWindow.closed) {
    try { kitchenWindow.postMessage({ type: 'kitchen:refresh' }, '*'); } catch (_) {}
  }
  if (customerWindow && !customerWindow.closed) {
    try { customerWindow.postMessage({ type: 'kitchen:refresh' }, '*'); } catch (_) {}
  }
}

function openCustomerDisplay() {
  if (customerWindow && !customerWindow.closed) {
    customerWindow.focus();
    return customerWindow;
  }
  customerWindow = window.open('customer-display.html', 'customerDisplay', 'noopener,noreferrer,width=1280,height=800,menubar=no,toolbar=no,location=no,status=no');
  return customerWindow;
}

function closeCustomerDisplay() {
  if (customerWindow && !customerWindow.closed) customerWindow.close();
  customerWindow = null;
}

function refreshCustomerDisplay() {
  refreshKitchenDisplay();
}

module.exports = {
  mergePrintSettings,
  printHtml,
  openPreviewWindow,
  getPrintersFromWindow,
  enrichPrinters,
  filterPrintersByConnection,
  printerStatus,
  connectPrinter,
  buildBarcodeLabel,
  printBarcodeLabel,
  openCashDrawer,
  openKitchenDisplay,
  closeKitchenDisplay,
  refreshKitchenDisplay,
  openCustomerDisplay,
  closeCustomerDisplay,
  refreshCustomerDisplay
};

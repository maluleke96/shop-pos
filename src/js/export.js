async function ensurePosAPI() {
  if (window.posAPI) return;
  await new Promise(resolve => {
    if (window.posAPI) return resolve();
    window.addEventListener('posAPIReady', resolve, { once: true });
  });
}

function sanitizePdfData(headers, rows) {
  const safeHeaders = (headers || []).map(h => (h == null ? '' : String(h)));
  const safeRows = (rows || []).map(r => (Array.isArray(r) ? r : []).map(c => (c == null ? '' : String(c))));
  return { safeHeaders, safeRows };
}

function isMobileExport() {
  return !!(window.__SHOP_POS_MOBILE__ || window.Capacitor?.isNativePlatform?.());
}

const Export = {
  toExcel: async (filename, sheets) => {
    try {
      await ensurePosAPI();
      const r = window.API?.exportExcel
        ? await API.exportExcel(filename, sheets)
        : await window.posAPI.export_excel(filename, sheets);
      if (r?.success === false) Utils.toast(r.error || 'Excel export failed', 'error');
      else if (r?.cancelled) return r;
      else Utils.toast(r?.path ? 'Excel saved' : 'Excel exported', 'success');
      return r;
    } catch (err) {
      Utils.toast(err.message || 'Excel export failed', 'error');
      throw err;
    }
  },
  toPDF: async (filename, title, headers, rows, company) => {
    try {
      await ensurePosAPI();
      const { safeHeaders, safeRows } = sanitizePdfData(headers, rows);
      if (!safeHeaders.length) throw new Error('Report has no columns to export');
      const r = window.API?.exportPDF
        ? await API.exportPDF(filename, title, safeHeaders, safeRows, company || {})
        : await window.posAPI.export_pdf(filename, title, safeHeaders, safeRows, company || {});
      if (r?.success === false) Utils.toast(r.error || 'PDF export failed', 'error');
      else if (r?.cancelled) return r;
      else if (isMobileExport()) {
        Utils.toast(r?.path ? `PDF saved: ${r.path} — use share sheet to save to Downloads` : 'PDF saved — use share sheet to save to Downloads', 'success');
      } else {
        Utils.toast(r?.path ? `PDF saved: ${r.path}` : 'PDF exported', 'success');
      }
      return r;
    } catch (err) {
      console.error('PDF export error:', err);
      Utils.toast(err.message || 'PDF export failed', 'error');
      throw err;
    }
  },
  print: async (title, headers, rows, company) => {
    try {
      await ensurePosAPI();
      const { safeHeaders, safeRows } = sanitizePdfData(headers, rows);
      const r = window.API?.exportPrint
        ? await API.exportPrint(title, safeHeaders, safeRows, company || {})
        : await window.posAPI.export_print(title, safeHeaders, safeRows, company || {});
      const a4 =
        (typeof App !== 'undefined' && App?.settings?.printer_settings?.invoice_printer) ||
        (typeof Utils !== 'undefined' && Utils.getLocalDeviceSettings?.()?.invoice_printer) ||
        '';
      if (r?.success === false) Utils.toast(r.error || 'Print failed', 'error');
      else if (r?.preview || r?.fallback) {
        Utils.toast(a4
          ? `Could not reach ${a4} — opened print dialog`
          : 'No A4 printer connected — opened dialog. Set one in Admin → Printer Setup → A4 Printer',
          a4 ? 'info' : 'warning');
      } else if (r?.success) Utils.toast((r?.printer || a4) ? `Sent to A4 printer: ${r.printer || a4}` : 'Print sent', 'success');
      return r;
    } catch (err) {
      Utils.toast(err.message || 'Print failed', 'error');
      throw err;
    }
  }
};
window.Export = Export;

const Utils = {
  formatMoney(amount, currency) {
    const s = (typeof App !== 'undefined' && App?.settings) ? App.settings : {};
    const cur = currency || s.currency || 'R';
    let dec = Number(s.decimal_places);
    if (!Number.isFinite(dec) || dec < 2) dec = 2;
    dec = 2;
    const sep = s.thousands_sep && s.thousands_sep !== '.' ? String(s.thousands_sep) : '';
    const pos = s.currency_position || 'before';
    const num = Number(amount);
    const val = Number.isFinite(num) ? num : 0;
    const fixed = Math.abs(val).toFixed(dec);
    const [intPart, frac = ''] = fixed.split('.');
    const withSep = sep ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep) : intPart;
    let body = dec > 0 ? `${withSep}.${frac}` : withSep;
    if (val < 0) body = `-${body}`;
    return pos === 'after' ? `${body}${cur}` : `${cur}${body}`;
  },

  formatPriceAdjustment(price, currency = 'R') {
    const n = Number(price) || 0;
    if (n === 0) return '';
    const abs = Utils.formatMoney(Math.abs(n), currency);
    return n > 0 ? `(+${abs})` : `(-${abs})`;
  },

  /** Tax totals from shelf/cart gross (prices are tax-inclusive when VAT is enabled). */
  calcTaxTotals(grossAmount, settings, discount = 0) {
    const gross = Math.max(0, Number(grossAmount) || 0);
    const disc = Math.max(0, Number(discount) || 0);
    const afterDiscount = Math.round(Math.max(0, gross - disc) * 100) / 100;
    if (!settings?.tax_enabled) {
      return { subtotalExcl: afterDiscount, tax: 0, total: afterDiscount, taxRate: 0 };
    }
    const taxRate = Number(settings.tax_rate) || 0;
    const inclusive = settings.tax_inclusive !== false && settings.tax_inclusive !== 0 && settings.tax_inclusive !== '0';
    if (!inclusive) {
      const tax = taxRate ? Math.round(afterDiscount * taxRate / 100 * 100) / 100 : 0;
      return { subtotalExcl: afterDiscount, tax, total: Math.round((afterDiscount + tax) * 100) / 100, taxRate };
    }
    const tax = taxRate ? Math.round((afterDiscount - afterDiscount / (1 + taxRate / 100)) * 100) / 100 : 0;
    return { subtotalExcl: Math.round((afterDiscount - tax) * 100) / 100, tax, total: afterDiscount, taxRate };
  },

  formatDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d);
    const fmt = (typeof App !== 'undefined' && App?.settings?.date_format) || 'DD MMM YYYY';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    if (fmt === 'YYYY-MM-DD') return `${y}-${m}-${day}`;
    if (fmt === 'MM/DD/YYYY') return `${m}/${day}/${y}`;
    if (fmt === 'DD/MM/YYYY') return `${day}/${m}/${y}`;
    return dt.toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
  },

  formatDateTime(d) {
    if (!d) return '—';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d);
    const hour12 = (typeof App !== 'undefined' && App?.settings?.time_format) === '12h';
    return `${Utils.formatDate(d)} ${dt.toLocaleTimeString(hour12 ? 'en-US' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12 })}`;
  },

  today() {
    return new Date().toLocaleDateString('en-CA');
  },

  daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toLocaleDateString('en-CA');
  },

  monthStart() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  },

  weekStart() {
    const d = new Date();
    const day = d.getDay(); // 0 Sun … 6 Sat
    const diff = day === 0 ? -6 : 1 - day; // Monday
    d.setDate(d.getDate() + diff);
    return d.toLocaleDateString('en-CA');
  },

  calcTaxInclusive(grossTotal, discount, taxRatePct, taxEnabled) {
    const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const afterDiscount = round2(Math.max(0, (Number(grossTotal) || 0) - Math.max(0, Number(discount) || 0)));
    if (!taxEnabled) return { subtotal: afterDiscount, tax_amount: 0, total: afterDiscount };
    const rate = Number(taxRatePct) || 0;
    if (!rate) return { subtotal: afterDiscount, tax_amount: 0, total: afterDiscount };
    const taxSettings = (typeof App !== 'undefined' && App?.settings) ? App.settings : {};
    const inclusive = taxSettings.tax_inclusive !== false && taxSettings.tax_inclusive !== 0 && taxSettings.tax_inclusive !== '0';
    if (!inclusive) {
      const tax_amount = round2(afterDiscount * rate / 100);
      return { subtotal: afterDiscount, tax_amount, total: round2(afterDiscount + tax_amount) };
    }
    const tax_amount = round2(afterDiscount - afterDiscount / (1 + rate / 100));
    return { subtotal: round2(afterDiscount - tax_amount), tax_amount, total: afterDiscount };
  },

  itemTaxBreakdown(unitPriceIncl, quantity, taxRatePct, taxEnabled) {
    const lineTotal = (Number(unitPriceIncl) || 0) * (Number(quantity) || 1);
    if (!taxEnabled) return { excl: lineTotal, tax: 0, incl: lineTotal };
    const rate = Number(taxRatePct) || 0;
    if (!rate) return { excl: lineTotal, tax: 0, incl: lineTotal };
    const tax = lineTotal - lineTotal / (1 + rate / 100);
    return { excl: lineTotal - tax, tax, incl: lineTotal };
  },

  dateFilterHTML(id = 'date-filter', from = null, to = null) {
    const f = from || Utils.monthStart();
    const t = to || Utils.today();
    return `<div class="date-filter" id="${id}">
      <label>From</label><input type="date" class="df-from" value="${f}">
      <label>To</label><input type="date" class="df-to" value="${t}">
      <button type="button" class="btn btn-sm btn-primary df-apply">Apply</button>
      <button type="button" class="btn btn-sm btn-ghost df-today">Today</button>
      <button type="button" class="btn btn-sm btn-ghost df-week">This Week</button>
      <button type="button" class="btn btn-sm btn-ghost df-month">This Month</button>
    </div>`;
  },

  bindDateFilter(container, onApply) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) return;
    const apply = () => onApply(el.querySelector('.df-from').value, el.querySelector('.df-to').value);
    el.querySelector('.df-apply')?.addEventListener('click', apply);
    el.querySelector('.df-today')?.addEventListener('click', () => {
      el.querySelector('.df-from').value = Utils.today();
      el.querySelector('.df-to').value = Utils.today();
      apply();
    });
    el.querySelector('.df-yesterday')?.addEventListener('click', () => {
      el.querySelector('.df-from').value = Utils.daysAgo(1);
      el.querySelector('.df-to').value = Utils.daysAgo(1);
      apply();
    });
    el.querySelector('.df-week')?.addEventListener('click', () => {
      el.querySelector('.df-from').value = Utils.weekStart();
      el.querySelector('.df-to').value = Utils.today();
      apply();
    });
    el.querySelector('.df-lastweek')?.addEventListener('click', () => {
      const d = new Date();
      d.setDate(d.getDate() - d.getDay() - 7);
      const start = d.toLocaleDateString('en-CA');
      d.setDate(d.getDate() + 6);
      el.querySelector('.df-from').value = start;
      el.querySelector('.df-to').value = d.toLocaleDateString('en-CA');
      apply();
    });
    el.querySelector('.df-month')?.addEventListener('click', () => {
      el.querySelector('.df-from').value = Utils.monthStart();
      el.querySelector('.df-to').value = Utils.today();
      apply();
    });
    el.querySelector('.df-lastmonth')?.addEventListener('click', () => {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      el.querySelector('.df-from').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      d.setMonth(d.getMonth() + 1);
      d.setDate(0);
      el.querySelector('.df-to').value = d.toLocaleDateString('en-CA');
      apply();
    });
    el.querySelector('.df-year')?.addEventListener('click', () => {
      const y = new Date().getFullYear();
      el.querySelector('.df-from').value = `${y}-01-01`;
      el.querySelector('.df-to').value = Utils.today();
      apply();
    });
  },

  extendedDateFilterHTML(id = 'date-filter', from = null, to = null) {
    const f = from || Utils.monthStart();
    const t = to || Utils.today();
    return `<div class="date-filter" id="${id}">
      <label>From</label><input type="date" class="df-from" value="${f}">
      <label>To</label><input type="date" class="df-to" value="${t}">
      <button type="button" class="btn btn-sm btn-primary df-apply">Apply</button>
      <button type="button" class="btn btn-sm btn-ghost df-today">Today</button>
      <button type="button" class="btn btn-sm btn-ghost df-yesterday">Yesterday</button>
      <button type="button" class="btn btn-sm btn-ghost df-week">This Week</button>
      <button type="button" class="btn btn-sm btn-ghost df-lastweek">Last Week</button>
      <button type="button" class="btn btn-sm btn-ghost df-month">This Month</button>
      <button type="button" class="btn btn-sm btn-ghost df-lastmonth">Last Month</button>
      <button type="button" class="btn btn-sm btn-ghost df-year">This Year</button>
    </div>`;
  },

  companyInfo(settings) {
    return {
      shop_name: settings?.shop_name || 'Shop POS',
      address: settings?.address || '',
      phone: settings?.phone || '',
      email: settings?.email || '',
      vat_number: settings?.vat_number || ''
    };
  },

  toast(msg, type = 'info') {
    if (window.__SHOP_POS_APP_MODE__ === 'pos') return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  },

  /** Short popup — works on POS too (2–3 s). */
  briefNotice(msg, type = 'info', ms = 2600) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast brief-notice ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 280);
    }, Math.max(1500, ms - 280));
  },

  showModal(title, bodyHtml, footerHtml = '', options = {}) {
    const overlay = document.getElementById('modal-overlay');
    // Never replace a blocking modal (e.g. open-shift) unless explicitly forced.
    if (!options.force && overlay?.dataset.noDismiss === '1' && !options.noDismiss) {
      return false;
    }
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-footer').innerHTML = footerHtml;
    overlay.classList.remove('hidden');
    overlay.dataset.noDismiss = options.noDismiss ? '1' : '0';
    const closeBtn = document.getElementById('modal-close');
    if (closeBtn) closeBtn.style.display = options.noDismiss ? 'none' : '';
    return true;
  },

  hideModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay?.dataset.noDismiss === '1') return;
    overlay.classList.add('hidden');
    overlay.dataset.noDismiss = '0';
    const closeBtn = document.getElementById('modal-close');
    if (closeBtn) closeBtn.style.display = '';
  },

  forceHideModal() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.dataset.noDismiss = '0';
    const closeBtn = document.getElementById('modal-close');
    if (closeBtn) closeBtn.style.display = '';
  },

  roleTag(role) {
    return `<span class="tag tag-${role}">${role}</span>`;
  },

  stockTag(qty, min) {
    if (qty <= 0) return '<span class="tag tag-out">Out</span>';
    if (qty <= min) return '<span class="tag tag-low">Low</span>';
    return '<span class="tag tag-ok">OK</span>';
  },

  canAccess(user, page) {
    if (!user) return false;
    // Delivery Department portal — admin panel (delivery section) only
    if (typeof window !== 'undefined' && window.__SHOP_POS_APP_MODE__ === 'delivery') {
      if (user.role === 'delivery_manager') return page === 'admin';
      if (['owner', 'manager', 'supervisor'].includes(user.role)) return page === 'admin' || page === 'dashboard';
      return false;
    }
    // POS-only installer: till screen only — no sidebar pages, no cash-up/ops
    if (typeof window !== 'undefined' && window.__SHOP_POS_APP_MODE__ === 'pos') {
      return page === 'pos' && ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager'].includes(user.role);
    }
    if (page === 'admin') return Utils.canAccessAdmin(user);
    if (user.role === 'owner') return true;
    if (user.role === 'marketing_agent') return page === 'marketing' || page === 'document-hub';
    const pagePermMap = {
      dashboard: 'view_reports', pos: 'sell', staff: 'staff_portal', products: 'products', categories: 'products',
      stock: 'manage_stock', customers: 'customers', suppliers: 'suppliers', expenses: 'view_reports',
      returns: 'refunds', quotes: 'quotes', layby: 'layby', giftcards: 'gift_cards', marketing: 'products',
      'document-hub': 'operations', whatsapp: 'whatsapp', operations: 'operations', restaurant: 'kitchen', 'purchase-orders': 'suppliers',
      reports: 'reports', audit: 'view_reports', bookkeeping: 'bookkeeping', admin: 'system_settings', users: 'system_settings',
      settings: 'system_settings', recipe: 'recipe'
    };
    if (user.role === 'assistant_manager') {
      const perm = pagePermMap[page];
      return perm ? Utils.hasPermission(user, perm) : false;
    }
    const perm = pagePermMap[page];
    if (perm && Utils.hasPermission(user, perm)) return true;
    // staff / returns never fall through to role page lists — admin must grant staff_portal / refunds
    if (page === 'staff' || page === 'returns') return false;
    const managerPages = ['dashboard', 'admin', 'pos', 'products', 'categories', 'stock', 'customers', 'suppliers', 'expenses', 'quotes', 'layby', 'giftcards', 'marketing', 'document-hub', 'whatsapp', 'operations', 'restaurant', 'recipe', 'purchase-orders', 'reports', 'bookkeeping', 'audit', 'settings', 'users'];
    const cashierPages = ['pos'];
    const supervisorPages = ['admin', 'pos', 'operations', 'layby', 'giftcards', 'quotes'];
    if (user.role === 'manager') return managerPages.includes(page);
    if (user.role === 'supervisor') return supervisorPages.includes(page);
    if (user.role === 'cashier') return cashierPages.includes(page);
    return false;
  },

  /** Owner-only admin sidebar sections — hidden from manager/supervisor search & nav */
  adminOwnerOnlySections: new Set([
    'backup', 'payroll', 'database', 'developer', 'automation',
    'customfields', 'formats', 'importexport', 'device', 'customer-rewards',
    'analytics'
  ]),

  /** Sections managers/supervisors should always see when they have admin access */
  adminManagerSections: new Set([
    'overview', 'staffhr', 'staffportal', 'hrcontracts', 'recruitment', 'marketing-mgmt', 'employee-of-month', 'opscompliance', 'combos',
    'quotes', 'approvals', 'recipe', 'tax', 'tax-hub', 'cashiers', 'branches',
    'mobile-app', 'business-manager', 'business-modules', 'digital-signage', 'online-orders', 'hr-workspace', 'hr-approvals', 'accounting-workspace',
    'delivery-dept', 'deliveries', 'loyalty', 'discounts', 'payments', 'inventory', 'shifts', 'operating', 'cashdrawer', 'customize', 'onaccount',
    'printer', 'receipt', 'security', 'permissions', 'sales-targets', 'top-customers',
    'salesmgmt', 'pos-menu', 'saleexplorer', 'soldproducts', 'returnsmgmt', 'activity', 'exceptions', 'alerts', 'dailyclose', 'discount-report'
  ]),

  canAccessAdmin(user) {
    if (!user) return false;
    if (user.role === 'owner') return true;
    if (user.role === 'manager') return true;
    if (user.role === 'supervisor') return true;
    if (user.role === 'delivery_manager') return true;
    if (user.role === 'assistant_manager') return Utils.hasPermission(user, 'system_settings');
    return false;
  },

  canAccessAdminSection(user, sectionId) {
    if (!Utils.canAccessAdmin(user)) return false;
    if (user.role === 'delivery_manager') {
      return ['delivery-dept', 'deliveries', 'online-orders'].includes(sectionId);
    }
    if (user.role === 'owner') return true;
    if (sectionId === 'permissions' && user.role === 'manager') return true;
    if (user.role === 'supervisor') {
      return Utils.adminManagerSections.has(sectionId);
    }
    if (Utils.adminManagerSections.has(sectionId)) return true;
    return !Utils.adminOwnerOnlySections.has(sectionId);
  },

  roleDefaults: {
    owner: { sell: true, void_sales: true, refunds: true, discounts: true, change_prices: true, view_reports: true, manage_stock: true, system_settings: true, customers: true, suppliers: true, gift_cards: true, cash_up: true, products: true, reports: true, operations: true, kitchen: true, quotes: true, layby: true, delete_sales: true, bookkeeping: true, staff_portal: true },
    manager: { sell: true, void_sales: true, refunds: true, discounts: true, change_prices: true, view_reports: true, manage_stock: true, customers: true, suppliers: true, gift_cards: true, cash_up: true, products: true, reports: true, operations: true, kitchen: true, quotes: true, layby: true, owner_salary: true, owner_salary_only: false, bookkeeping: true, staff_portal: false, delivery: true, expense_capture: true },
    supervisor: { sell: true, void_sales: true, refunds: true, discounts: true, cash_up: true, operations: true, kitchen: true, gift_cards: true, layby: true, quotes: true, staff_portal: false, delivery: true },
    assistant_manager: {
      sell: true, void_sales: true, refunds: true, discounts: true, cash_up: true, operations: true,
      kitchen: true, gift_cards: true, layby: true, quotes: true, view_reports: true, customers: true, products: true, staff_portal: false, delivery: true
    },
    marketing_agent: {},
    delivery_manager: { delivery: true, view_reports: true, manage_stock: false, sell: false },
    cashier: { sell: true, refunds: false, owner_salary: false, owner_salary_only: false, staff_portal: false, delivery: true }
  },

  normalizePhone(phone) {
    if (!phone) return '';
    let digits = String(phone).replace(/\D/g, '');
    if (digits.startsWith('27') && digits.length >= 11) digits = digits.slice(2);
    if (digits.startsWith('0')) digits = digits.slice(1);
    return digits.slice(-9);
  },

  phonesMatch(a, b) {
    const na = Utils.normalizePhone(a);
    const nb = Utils.normalizePhone(b);
    return !!(na && nb && na.length >= 9 && na === nb);
  },

  hasPermission(user, key) {
    if (!user) return false;
    if (user.role === 'owner') return true;
    let perms = user.permissions;
    if (typeof perms === 'string') {
      try { perms = JSON.parse(perms); } catch { perms = {}; }
    }
    if (perms && Object.prototype.hasOwnProperty.call(perms, key)) return !!perms[key];
    return !!(Utils.roleDefaults[user.role] || {})[key];
  },

  getCashoutWhatsAppPhone(settings) {
    const ws = settings?.whatsapp_settings;
    let parsed = ws;
    if (typeof ws === 'string') {
      try { parsed = JSON.parse(ws); } catch { parsed = {}; }
    }
    return String(parsed?.cashout_whatsapp_phone || settings?.phone || '').trim();
  },

  openWhatsApp(phone, message) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return false;
    const num = digits.startsWith('0') ? `27${digits.slice(1)}` : digits;
    const url = `https://wa.me/${num}?text=${encodeURIComponent(message || '')}`;
    if (window.API?.openExternal) API.openExternal(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  },

  async deliverWhatsApp(result, fallbackPhone, fallbackMessage) {
    const data = result?.data || result || {};
    if (result && result.success === false) {
      if (fallbackPhone) {
        Utils.openWhatsApp(fallbackPhone, fallbackMessage || '');
        Utils.toast('WhatsApp opened — tap Send in the chat', 'success');
        return { success: true, fallback: true };
      }
      Utils.toast(result.error || 'WhatsApp failed', 'error');
      return result;
    }
    if (data.via === 'cloud_api' || (data.status === 'sent' && !data.url)) {
      Utils.toast('Sent via WhatsApp', 'success');
      return result || { success: true };
    }
    const urls = data.url ? [data.url] : (Array.isArray(data.urls) ? data.urls.map((u) => (typeof u === 'string' ? u : u?.url)).filter(Boolean) : []);
    if (urls.length) {
      for (const url of urls.slice(0, 10)) {
        if (window.API?.openExternal) await API.openExternal(url);
        else window.open(url, '_blank', 'noopener,noreferrer');
      }
      if (data.id && (window.App?.user || result?.user)) {
        try { await API.markWhatsAppOpened(data.id, window.App?.user); } catch (_) { /* ignore */ }
      }
      Utils.toast(urls.length > 1 ? `Opened ${Math.min(urls.length, 10)} WhatsApp chat(s)` : 'WhatsApp opened — tap Send in the chat', 'success');
      return result || { success: true };
    }
    if (fallbackPhone) {
      Utils.openWhatsApp(fallbackPhone, fallbackMessage || '');
      Utils.toast('WhatsApp opened — tap Send in the chat', 'success');
      return { success: true, fallback: true };
    }
    Utils.toast('WhatsApp message prepared', 'success');
    return result || { success: true };
  },

  async savePdfBuffer(filename, buf) {
    if (!buf?.success) {
      Utils.toast(buf?.error || 'Could not build PDF', 'error');
      return false;
    }
    let bytes = buf.data;
    if (bytes && typeof bytes === 'object' && bytes.data && !(bytes instanceof Uint8Array) && !Array.isArray(bytes) && bytes.type !== 'Buffer') {
      bytes = bytes.data;
    }
    try {
      if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
      else if (bytes?.type === 'Buffer' && Array.isArray(bytes.data)) bytes = new Uint8Array(bytes.data);
      else if (Array.isArray(bytes)) bytes = new Uint8Array(bytes);
      else if (!(bytes instanceof Uint8Array) && bytes != null) bytes = new Uint8Array(bytes);
    } catch (err) {
      Utils.toast(err.message || 'Invalid PDF data', 'error');
      return false;
    }
    if (!bytes || !bytes.byteLength) {
      Utils.toast('PDF was empty — nothing to save', 'error');
      return false;
    }
    const saved = await API.saveFile(filename, [{ name: 'PDF', extensions: ['pdf'] }], bytes);
    if (saved?.cancelled) return false;
    if (saved && saved.success === false) {
      Utils.toast(saved.error || 'Could not save PDF', 'error');
      return false;
    }
    Utils.toast(saved?.path ? `PDF saved: ${saved.path}` : 'PDF saved', 'success');
    return true;
  },

  /**
   * Send a PDF (or A4 HTML) to the Admin-configured A4 printer (USB / Bluetooth / network).
   * Does not affect thermal receipt/kitchen printers.
   */
  async printToA4(bufferOrHtml, filename = 'document.pdf') {
    const configured =
      (typeof App !== 'undefined' && App?.settings?.printer_settings?.invoice_printer) ||
      Utils.getLocalDeviceSettings()?.invoice_printer ||
      '';

    try {
      let result;
      if (typeof bufferOrHtml === 'string') {
        result = typeof API.printA4 === 'function'
          ? await API.printA4(bufferOrHtml)
          : { success: false, error: 'A4 print not available' };
      } else {
        let bytes = bufferOrHtml;
        if (bytes && typeof bytes === 'object' && bytes.data && !(bytes instanceof Uint8Array) && !Array.isArray(bytes) && bytes.type !== 'Buffer') {
          bytes = bytes.data;
        }
        if (bytes?.success === false) {
          Utils.toast(bytes.error || 'Could not build PDF', 'error');
          return bytes;
        }
        if (bytes?.success && bytes.data != null) bytes = bytes.data;
        if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
        else if (bytes?.type === 'Buffer' && Array.isArray(bytes.data)) bytes = new Uint8Array(bytes.data);
        else if (Array.isArray(bytes)) bytes = new Uint8Array(bytes);

        if (!bytes || !(bytes.byteLength || bytes.length)) {
          Utils.toast('Nothing to print', 'error');
          return { success: false, error: 'Empty document' };
        }
        result = typeof API.printPdf === 'function'
          ? await API.printPdf(bytes, filename)
          : await API.openPdf(bytes, filename);
      }

      if (result?.success === false) {
        Utils.toast(result.error || 'Print failed', 'error');
        return result;
      }
      if (result?.fallback || result?.preview) {
        const hint = configured
          ? 'Opened preview — use Print in the viewer if needed'
          : 'No A4 printer set — open Admin → Printer Setup → A4 Printer (USB/Bluetooth), connect & Save';
        Utils.toast(hint, configured ? 'info' : 'error');
        return result;
      }
      const name = result?.printer || configured;
      Utils.toast(name ? `Sent to A4 printer: ${name}` : 'Sent to A4 printer', 'success');
      return result;
    } catch (err) {
      Utils.toast(err.message || 'Print failed', 'error');
      return { success: false, error: err.message || String(err) };
    }
  },

  expenseCategories: ['rent', 'transport', 'electricity', 'salary', 'fuel', 'maintenance', 'other'],
  paymentTypes: ['cash', 'card', 'eft', 'mobile', 'account', 'giftcard', 'other'],
  paymentLabels: { cash: 'Cash', card: 'Card', eft: 'EFT', mobile: 'Mobile Money', account: 'On Account', giftcard: 'Gift Card', other: 'Other' },
  returnReasons: ['Wrong Item', 'Customer Changed Mind', 'Expired Product', 'Damaged Product', 'Incorrect Price', 'Duplicate Sale', 'Defective Product', 'Other'],
  businessTypes: ['retail', 'restaurant', 'grocery', 'pharmacy', 'clothing', 'hardware', 'spaza', 'supermarket'],
  units: ['each', 'piece', 'kg', 'g', 'litre', 'ml', 'box', 'bottle', 'packet', 'dozen'],
  stockUnitTypes: {
    piece: { label: 'Piece / Unit', units: ['piece', 'each', 'unit', 'whole', 'half', 'quarter', 'slice', 'loaf'] },
    weight: { label: 'Weight', units: ['g', 'kg'] },
    volume: { label: 'Volume', units: ['ml', 'L', 'litre'] },
    length: { label: 'Length', units: ['mm', 'cm', 'm'] },
    pack: { label: 'Pack / Box', units: ['pack', 'box', 'carton', 'case'] },
    bundle: { label: 'Bundle', units: ['bundle', 'set', 'multipack'] },
    portion: { label: 'Portion', units: ['portion', 'serving'] }
  },

  getUnitsForType(type) {
    return Utils.stockUnitTypes[type]?.units || Utils.units;
  },

  getAllStockUnits() {
    const set = new Set(Utils.units);
    Object.values(Utils.stockUnitTypes).forEach(t => t.units.forEach(u => set.add(u)));
    return [...set];
  },

  formatPurchaseUnit(qty, label, unit) {
    const q = qty != null && qty !== '' ? qty : 1;
    const parts = [q];
    if (label) parts.push(label);
    else if (unit) parts.push(unit);
    return parts.join(' ');
  },

  fileUrl(filePath) {
    if (!filePath) return '';
    const p = String(filePath);
    if (p.startsWith('mobile://') || p.startsWith('data:')) return p;
    const norm = p.replace(/\\/g, '/');
    if (norm.startsWith('file://')) return norm;
    return /^[a-zA-Z]:/.test(norm) ? `file:///${norm}` : `file://${norm.startsWith('/') ? norm : `/${norm}`}`;
  },

  _imageUrlCache: new Map(),

  syncBaseUrl() {
    const cfg = window.__EXPENSE_CONFIG__ || window.__DRIVER_CONFIG__ || window.__ORDER_CONFIG__ || {};
    const env = window.__SHOP_POS_ENV__ || {};
    return String(
      cfg.apiBase || env.SHOP_POS_SYNC_URL || env.SHOP_POS_CLOUD_URL || env.SHOP_POS_PUBLIC_URL || 'https://chisafood.up.railway.app'
    ).replace(/\/$/, '');
  },

  isCloudPos() {
    return !!(typeof window !== 'undefined' && window.__SHOP_POS_CLOUD__);
  },

  isNativePos() {
    return !!(window.__SHOP_POS_MOBILE__ || window.__SHOP_POS_LOCAL_INSTALLER__ || window.Capacitor?.isNativePlatform?.());
  },

  productImageUrl(product) {
    if (!product?.id) return '';
    const path = String(product.picture_path || product.image_path || '');
    if (path.startsWith('data:')) return path;
    if (path.startsWith('mobile-asset://') || path.startsWith('mobile-doc://')) return '';
    if (Utils.isCloudPos()) return `/api/product-image/${product.id}`;
    if (Utils.isNativePos() && typeof navigator !== 'undefined' && navigator.onLine !== false) {
      return `${Utils.syncBaseUrl()}/api/product-image/${product.id}`;
    }
    return '';
  },

  categoryImageUrl(category) {
    const path = String(category?.image_path || '');
    if (!path) return '';
    if (path.startsWith('data:')) return path;
    if (Utils.isCloudPos()) return `/api/app-image?p=${encodeURIComponent(path)}`;
    if (Utils.isNativePos() && typeof navigator !== 'undefined' && navigator.onLine !== false) {
      return `${Utils.syncBaseUrl()}/api/app-image?p=${encodeURIComponent(path)}`;
    }
    return '';
  },

  comboImageUrl(combo) {
    if (!combo?.id) return '';
    const path = String(combo.image_path || combo.picture_path || '');
    if (path.startsWith('data:')) return path;
    if (Utils.isCloudPos()) return `/api/combo-image/${combo.id}`;
    if (Utils.isNativePos() && typeof navigator !== 'undefined' && navigator.onLine !== false) {
      return `${Utils.syncBaseUrl()}/api/combo-image/${combo.id}`;
    }
    return '';
  },

  comboImageAttr(combo) {
    if (!combo) return '';
    const cloudUrl = Utils.comboImageUrl(combo);
    if (cloudUrl) return `src="${cloudUrl}" data-combo-id="${combo.id}" data-image-loaded="1"`;
    return Utils.cachedImageAttr(combo.image_path || combo.picture_path);
  },

  productImageAttr(product) {
    if (!product) return '';
    const cloudUrl = Utils.productImageUrl(product);
    const path = product.picture_path || product.image_path || '';
    if (cloudUrl) {
      return `src="${cloudUrl}" data-product-id="${product.id}" data-image-loaded="1"`;
    }
    if (!path) return '';
    return `${Utils.cachedImageAttr(path)} data-product-id="${product.id}"`;
  },

  categoryImageAttr(category) {
    if (!category) return '';
    const cloudUrl = Utils.categoryImageUrl(category);
    if (cloudUrl) return `src="${cloudUrl}" data-image-loaded="1"`;
    return Utils.cachedImageAttr(category.image_path);
  },

  async resolveImageUrl(filePath, opts = {}) {
    if (!filePath && !opts?.productId) return '';
    const key = String(filePath || '');
    if (key && Utils._imageUrlCache.has(key)) return Utils._imageUrlCache.get(key);
    if (key.startsWith('data:')) return key;
    if (opts?.productId) {
      const cloud = Utils.productImageUrl({ id: opts.productId, picture_path: key });
      if (cloud) {
        if (key) Utils._imageUrlCache.set(key, cloud);
        return cloud;
      }
    }
    if (key) {
      const data = await API.getImageDataUrl(key);
      if (data?.success && data.dataUrl) {
        Utils._imageUrlCache.set(key, data.dataUrl);
        return data.dataUrl;
      }
      if (Utils.isCloudPos()) {
        const appImg = `/api/app-image?p=${encodeURIComponent(key)}`;
        Utils._imageUrlCache.set(key, appImg);
        return appImg;
      }
      if (Utils.isNativePos() && typeof navigator !== 'undefined' && navigator.onLine !== false) {
        const appImg = `${Utils.syncBaseUrl()}/api/app-image?p=${encodeURIComponent(key)}`;
        Utils._imageUrlCache.set(key, appImg);
        return appImg;
      }
      const fallback = Utils.fileUrl(key);
      Utils._imageUrlCache.set(key, fallback);
      return fallback;
    }
    return '';
  },

  async hydrateImages(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const imgs = [...scope.querySelectorAll('img[data-image-path], img[data-product-id]')];
    const pending = [];
    for (const img of imgs) {
      if (img.dataset.imageLoaded === '1') continue;
      const productId = img.dataset.productId;
      if (productId) {
        const cloud = Utils.productImageUrl({ id: productId, picture_path: img.dataset.imagePath || '' });
        if (cloud) {
          img.src = cloud;
          img.dataset.imageLoaded = '1';
          continue;
        }
      }
      const path = img.dataset.imagePath;
      if (!path) continue;
      if (Utils._imageUrlCache.has(path)) {
        img.src = Utils._imageUrlCache.get(path);
        img.dataset.imageLoaded = '1';
      } else {
        pending.push(img);
      }
    }
    const chunkSize = 16;
    for (let i = 0; i < pending.length; i += chunkSize) {
      const chunk = pending.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (img) => {
        const path = img.dataset.imagePath;
        if (!path || img.dataset.imageLoaded === '1') return;
        const src = await Utils.resolveImageUrl(path, { productId: img.dataset.productId });
        if (src) {
          img.src = src;
          img.dataset.imageLoaded = '1';
        }
      }));
    }
  },

  cachedImageAttr(filePath) {
    if (!filePath) return '';
    const key = String(filePath);
    if (Utils._imageUrlCache.has(key)) {
      return `src="${Utils._imageUrlCache.get(key)}" data-image-path="${key}" data-image-loaded="1"`;
    }
    return `data-image-path="${key}"`;
  },

  async setImagePreview(container, filePath, imgStyle = 'max-height:100px;border-radius:8px;border:1px solid var(--border)') {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el || !filePath) return;
    const src = await Utils.resolveImageUrl(filePath);
    el.innerHTML = `<img src="${src}" style="${imgStyle}">`;
  },

  loyaltyPointValue(settings) {
    const ls = settings?.loyalty_settings || {};
    return Number(ls.point_value) > 0 ? Number(ls.point_value) : 1;
  },

  loyaltyPointsValue(points, settings, currency = 'R') {
    const val = Math.floor(points || 0) * this.loyaltyPointValue(settings);
    return { amount: val, formatted: this.formatMoney(val, currency) };
  },

  loyaltyMaxRedeemPoints(total, customerPoints, settings) {
    const pv = this.loyaltyPointValue(settings);
    const avail = Math.floor(Number(customerPoints) || 0);
    const maxByTotal = Math.floor((Number(total) || 0) / pv);
    return Math.max(0, Math.min(avail, maxByTotal));
  },

  loyaltyRedeemDiscount(points, settings) {
    return Math.floor(points || 0) * this.loyaltyPointValue(settings);
  },

  loyaltyPreviewPoints(total, settings) {
    const ls = settings?.loyalty_settings || {};
    if (ls.enabled === false || !total) return 0;
    const spend = Number(ls.spend_amount) > 0 ? Number(ls.spend_amount) : 10;
    const earned = Number(ls.points_earned) > 0 ? Number(ls.points_earned) : 1;
    const min = Number(ls.min_sale_total) || 0;
    if (total < min) return 0;
    return Math.floor((total / spend) * earned);
  },

  itemTypes: ['retail', 'food', 'drink', 'combo', 'side', 'grocery', 'service'],

  getDeviceId() {
    let id = localStorage.getItem('shoppos_device_id');
    if (!id) {
      id = `POS-${Date.now().toString(36).toUpperCase()}`;
      localStorage.setItem('shoppos_device_id', id);
    }
    return id;
  },

  getLocalDeviceSettings() {
    try { return JSON.parse(localStorage.getItem('shoppos_device_settings') || '{}'); } catch { return {}; }
  },

  saveLocalDeviceSettings(data) {
    const merged = { ...Utils.getLocalDeviceSettings(), ...data, device_id: Utils.getDeviceId() };
    localStorage.setItem('shoppos_device_settings', JSON.stringify(merged));
    if (API.saveDeviceSettings) API.saveDeviceSettings(merged).catch(() => {});
    return merged;
  },

  mergeDeviceSettings(settings) {
    const global = settings?.device_settings || {};
    const local = Utils.getLocalDeviceSettings();
    return { ...global, ...local, device_id: Utils.getDeviceId() };
  },

  printerStatusBadge(status) {
    if (!status) return '<span class="tag tag-low">Unknown</span>';
    return status.online
      ? `<span class="tag tag-ok">● Online</span> <span class="muted">${status.message}</span>`
      : `<span class="tag tag-out">● Offline</span> <span class="muted">${status.message}</span>`;
  },

  escHtml(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  customerPickerHTML(prefix = 'cust') {
    return `<div class="field"><label>Customer</label>
      <div class="customer-picker-wrap" style="position:relative">
        <input type="search" id="${prefix}-search" placeholder="Search name or phone…" autocomplete="off">
        <input type="hidden" id="${prefix}-id">
        <div id="${prefix}-dropdown" class="search-dropdown hidden" style="position:absolute;top:100%;left:0;right:0;z-index:50;max-height:180px;overflow:auto;background:var(--bg);border:1px solid var(--border);border-radius:8px"></div>
      </div>
      <small class="muted" id="${prefix}-selected">Optional — link gift card to a customer</small></div>`;
  },

  bindCustomerPicker(prefix, customers, preset = null) {
    const input = document.getElementById(`${prefix}-search`);
    const hidden = document.getElementById(`${prefix}-id`);
    const dropdown = document.getElementById(`${prefix}-dropdown`);
    const selectedEl = document.getElementById(`${prefix}-selected`);
    if (!input || !hidden || !dropdown) return;

    const list = customers || [];
    let selected = preset || null;

    const applySelection = (c) => {
      selected = c;
      hidden.value = c?.id || '';
      input.value = c ? `${c.name}${c.phone ? ` (${c.phone})` : ''}` : '';
      if (selectedEl) {
        selectedEl.textContent = c
          ? `Selected: ${c.name}${c.phone ? ` · ${c.phone}` : ''}`
          : 'Optional — link gift card to a customer';
      }
      dropdown.classList.add('hidden');
    };

    if (preset) applySelection(preset);

    const showResults = (matches) => {
      if (!matches.length) {
        dropdown.innerHTML = '<div class="search-item muted" style="padding:10px">No customers found</div>';
      } else {
        dropdown.innerHTML = matches.slice(0, 12).map(c =>
          `<div class="search-item" data-id="${c.id}" style="padding:10px;cursor:pointer;border-bottom:1px solid var(--border)">
            <strong>${Utils.escHtml(c.name)}</strong>${c.phone ? `<br><small>${Utils.escHtml(c.phone)}</small>` : ''}
          </div>`).join('');
        dropdown.querySelectorAll('[data-id]').forEach(el => {
          el.addEventListener('click', () => {
            const c = list.find(x => x.id == el.dataset.id);
            if (c) applySelection(c);
          });
        });
      }
      dropdown.classList.remove('hidden');
    };

    input.oninput = () => {
      const q = input.value.trim().toLowerCase();
      if (!q) {
        dropdown.classList.add('hidden');
        selected = null;
        hidden.value = '';
        if (selectedEl) selectedEl.textContent = 'Optional — link gift card to a customer';
        return;
      }
      const matches = list.filter(c =>
        c.name.toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.email || '').toLowerCase().includes(q)
      );
      showResults(matches);
    };

    input.onfocus = () => {
      if (input.value.trim()) input.oninput();
    };

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.customer-picker-wrap')) dropdown.classList.add('hidden');
    });

    return {
      getSelected: () => selected,
      setSelected: applySelection,
      clear: () => applySelection(null)
    };
  },

  async sendGiftCardWhatsApp(app, { phone, customerName, code, amount, customerId }) {
    if (!phone) return { success: false, error: 'No phone number' };
    const currency = app.settings?.currency || 'R';
    const waRes = await API.sendWhatsAppMessage({
      phone,
      customer_id: customerId || null,
      recipient_type: 'customer',
      recipient_name: customerName || 'Customer',
      customer_name: customerName || 'Customer',
      branch: app.settings?.shop_name,
      message_type: 'gift_card',
      template_slug: 'gift_card',
      body: `Hello! Your gift card from ${app.settings?.shop_name || 'our shop'} is ready.\nCode: ${code}\nValue: ${Utils.formatMoney(amount, currency)}\nPresent this code at checkout.`,
      gift_card_code: code,
      gift_card_value: Utils.formatMoney(amount, currency),
      voucher_code: code
    }, app.user);
    await Utils.deliverWhatsApp(waRes, phone, `Hello! Your gift card from ${app.settings?.shop_name || 'our shop'} is ready.\nCode: ${code}\nValue: ${Utils.formatMoney(amount, currency)}\nPresent this code at checkout.`);
    return waRes.success === false && !phone ? waRes : { success: true, ...(waRes || {}) };
  },

  async sendQuoteWhatsApp(app, quote) {
    const phone = quote?.customer_phone;
    if (!phone) return { success: false, error: 'No customer phone on this quote' };
    const currency = app.settings?.currency || 'R';
    const quoteLines = Receipt.buildQuoteWhatsAppLines(quote, app.settings);
    const validUntilLine = quote.valid_until ? `Valid until: ${Utils.formatDate(quote.valid_until)}` : '';
    const waRes = await API.sendWhatsAppMessage({
      phone,
      customer_id: quote.customer_id || null,
      recipient_type: 'customer',
      recipient_name: quote.customer_name || 'Customer',
      customer_name: quote.customer_name || 'Customer',
      branch: app.settings?.shop_name,
      message_type: 'quotation',
      template_slug: 'quotation',
      order_number: quote.quote_number,
      total_purchase: quote.total,
      quote_lines: quoteLines,
      valid_until_line: validUntilLine,
      date: quote.valid_until || Utils.today()
    }, app.user);
    await Utils.deliverWhatsApp(waRes, phone, `Hi ${quote.customer_name || 'Customer'}, quotation ${quote.quote_number || ''} from ${app.settings?.shop_name || 'us'}.`);
    return waRes.success === false ? waRes : { success: true, ...(waRes || {}) };
  },

  async sendPayslipWhatsApp(app, payrollRow, employee) {
    const phone = employee?.phone;
    if (!phone) return { success: false, error: 'No phone number on employee record — ask admin to add your phone' };
    const currency = app.settings?.currency || 'R';
    const period = `${payrollRow.period_start} – ${payrollRow.period_end}`;
    const lines = [
      `Hi ${employee.full_name},`,
      '',
      `*Payslip — ${period}*`,
      `Shop: ${app.settings?.shop_name || 'Management'}`,
      '',
      `Gross pay: ${Utils.formatMoney(payrollRow.gross_salary || 0, currency)}`,
      payrollRow.paye != null ? `PAYE: ${Utils.formatMoney(payrollRow.paye || 0, currency)}` : null,
      payrollRow.uif_employee != null ? `UIF (employee): ${Utils.formatMoney(payrollRow.uif_employee || 0, currency)}` : null,
      payrollRow.pension_employee != null ? `Pension: ${Utils.formatMoney(payrollRow.pension_employee || 0, currency)}` : null,
      payrollRow.medical_employee != null ? `Medical aid: ${Utils.formatMoney(payrollRow.medical_employee || 0, currency)}` : null,
      payrollRow.other_deductions != null ? `Other deductions: ${Utils.formatMoney(payrollRow.other_deductions || 0, currency)}` : null,
      `*Net pay: ${Utils.formatMoney(payrollRow.net_salary, currency)}*`,
      payrollRow.status ? `Status: ${payrollRow.status}` : null,
      '',
      'Download your full PDF payslip from the Staff Portal or ask HR for a printed copy.'
    ].filter(Boolean);
    const message = lines.join('\n');
    if (['owner', 'manager', 'supervisor', 'assistant_manager'].includes(app.user?.role)) {
      const waRes = await API.sendWhatsAppMessage({
        phone,
        employee_id: employee.id,
        recipient_type: 'employee',
        recipient_name: employee.full_name,
        employee_name: employee.full_name,
        branch: app.settings?.shop_name,
        message_type: 'payslip',
        template_slug: 'payslip',
        pay_period: period,
        gross_pay: payrollRow.gross_salary,
        paye_amount: payrollRow.paye,
        uif_amount: payrollRow.uif_employee,
        net_pay: payrollRow.net_salary
      }, app.user);
      await Utils.deliverWhatsApp(waRes, phone, message);
      return { success: true };
    }
    Utils.openWhatsApp(phone, message);
    return { success: true };
  },

  async sendLeaveWhatsApp(app, leave, employee) {
    if (leave.status !== 'approved') return { success: false, error: 'Only approved leave can be shared' };
    const phone = employee?.phone;
    if (!phone) return { success: false, error: 'No phone number on employee record' };
    const period = `${leave.start_date} – ${leave.end_date || leave.start_date}`;
    const message = `Hi ${employee.full_name}, your ${leave.leave_type} leave has been APPROVED.\n\nPeriod: ${period}\nDays: ${leave.days}\n\n— ${app.settings?.shop_name || 'Management'}`;
    if (['owner', 'manager', 'supervisor', 'assistant_manager'].includes(app.user?.role)) {
      const waRes = await API.sendWhatsAppMessage({
        phone,
        employee_id: employee.id,
        recipient_type: 'employee',
        recipient_name: employee.full_name,
        employee_name: employee.full_name,
        branch: app.settings?.shop_name,
        message_type: 'leave_approval',
        template_slug: 'leave_approval',
        leave_type: leave.leave_type,
        pay_period: period,
        days: leave.days,
        date: leave.start_date
      }, app.user);
      await Utils.deliverWhatsApp(waRes, phone, message);
      return { success: true };
    }
    Utils.openWhatsApp(phone, message);
    return { success: true };
  },

  async sendDisciplinaryWhatsApp(app, record, employee) {
    const phone = employee?.phone;
    if (!phone) return { success: false, error: 'No phone number on employee record' };
    const reason = `${record.record_type}: ${(record.description || '').slice(0, 120)}`;
    const waRes = await API.sendWhatsAppMessage({
      phone,
      employee_id: employee.id,
      recipient_type: 'employee',
      recipient_name: employee.full_name,
      employee_name: employee.full_name,
      branch: app.settings?.shop_name,
      message_type: 'warning',
      template_slug: 'warning',
      warning_reason: reason,
      date: record.incident_date
    }, app.user);
    await Utils.deliverWhatsApp(waRes, phone, `Hi ${employee.full_name}, ${reason}\n\n— ${app.settings?.shop_name || 'Management'}`);
    if (waRes?.success !== false || phone) {
      try { await API.markStaffDisciplinaryWa(record.id); } catch (_) { /* ignore */ }
    }
    return waRes?.success === false && !phone ? waRes : { success: true };
  },

  isNative() {
    return !!(window.Capacitor?.isNativePlatform?.() || window.__SHOP_POS_MOBILE__);
  },

  getCameraPlugin() {
    return window.Capacitor?.Plugins?.Camera || null;
  },

  async captureProofPhoto() {
    const Camera = Utils.getCameraPlugin();
    if (Utils.isNative() && Camera?.getPhoto) {
      try {
        if (Camera.requestPermissions) {
          const perm = await Camera.requestPermissions({ permissions: ['camera'] });
          if (perm.camera !== 'granted' && perm.camera !== 'limited') {
            throw new Error('Camera permission denied');
          }
        }
        const photo = await Camera.getPhoto({
          quality: 85,
          allowEditing: false,
          resultType: 'dataUrl',
          source: 'camera',
          direction: 'rear',
          saveToGallery: false,
          correctOrientation: true
        });
        return photo?.dataUrl || (photo?.base64String ? `data:image/jpeg;base64,${photo.base64String}` : null);
      } catch (err) {
        throw new Error(err.message || 'Camera unavailable');
      }
    }
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return reject(new Error('No photo selected'));
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read photo'));
        reader.readAsDataURL(file);
      };
      input.click();
    });
  },

  async pickProofImage() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return reject(new Error('No image selected'));
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read image'));
        reader.readAsDataURL(file);
      };
      input.click();
    });
  },

  _loadedScripts: new Set(),

  loadScript(src) {
    const base = String(src).split('?')[0];
    const ver = window.__SHOP_POS_DEPLOY__ || '';
    const busted = ver ? `${base}?v=${encodeURIComponent(ver)}` : base;
    if (this._loadedScripts.has(busted)) return Promise.resolve();
    const existing = document.querySelector(`script[src="${busted}"]`)
      || document.querySelector(`script[src="${base}"]`)
      || document.querySelector(`script[src$="/${base}"]`);
    if (existing && !ver) {
      this._loadedScripts.add(busted);
      return Promise.resolve();
    }
    if (existing && ver) {
      existing.remove();
      this._loadedScripts.delete(base);
      this._loadedScripts.delete(busted);
    }
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = busted;
      s.onload = () => { this._loadedScripts.add(busted); resolve(); };
      s.onerror = () => reject(new Error(`Failed to load ${busted}`));
      document.body.appendChild(s);
    });
  },

  /** Remove cached script and load fresh (for feature modules like HR workspace). */
  reloadScript(src) {
    const base = String(src).split('?')[0];
    document.querySelectorAll('script[src]').forEach((el) => {
      const href = el.getAttribute('src') || '';
      if (href === base || href.startsWith(`${base}?`) || href.endsWith(`/${base}`) || href.includes(`/${base}?`)) {
        el.remove();
      }
    });
    for (const key of [...this._loadedScripts]) {
      if (key === base || key.startsWith(`${base}?`)) this._loadedScripts.delete(key);
    }
    if (base.includes('hr-app.js')) delete window.HrApp;
    const busted = `${base}?v=${Date.now()}`;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = busted;
      s.onload = () => { this._loadedScripts.add(busted); resolve(); };
      s.onerror = () => reject(new Error(`Failed to load ${busted}`));
      document.body.appendChild(s);
    });
  },

  _loadedStyles: new Set(),

  reloadStylesheet(href) {
    const base = String(href).split('?')[0];
    document.querySelectorAll('link[rel="stylesheet"]').forEach((el) => {
      const h = el.getAttribute('href') || '';
      if (h === base || h.startsWith(`${base}?`) || h.endsWith(`/${base}`)) el.remove();
    });
    for (const key of [...this._loadedStyles]) {
      if (key === base || key.startsWith(`${base}?`)) this._loadedStyles.delete(key);
    }
    const busted = `${base}?v=${Date.now()}`;
    return new Promise((resolve, reject) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = busted;
      l.onload = () => { this._loadedStyles.add(busted); resolve(); };
      l.onerror = () => reject(new Error(`Failed to load ${busted}`));
      document.head.appendChild(l);
    });
  },

  loadStylesheet(href) {
    if (this._loadedStyles.has(href)) return Promise.resolve();
    const existing = document.querySelector(`link[href="${href}"]`)
      || document.querySelector(`link[href$="/${href}"]`);
    if (existing) {
      this._loadedStyles.add(href);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.onload = () => { this._loadedStyles.add(href); resolve(); };
      l.onerror = () => reject(new Error(`Failed to load ${href}`));
      document.head.appendChild(l);
    });
  },

  pageSkeleton(rows = 4) {
    return `<div class="page-skeleton" style="padding:16px">${Array.from({ length: rows }, () =>
      `<div style="height:14px;background:var(--border);border-radius:6px;margin-bottom:10px;opacity:0.5"></div>`).join('')}
      <p class="muted" style="font-size:13px;margin-top:8px">Loading…</p></div>`;
  },

  sessionCacheGet(key) {
    try {
      const raw = sessionStorage.getItem(`spcache_${key}`);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry?.exp || entry.exp < Date.now()) {
        sessionStorage.removeItem(`spcache_${key}`);
        return null;
      }
      return entry.data;
    } catch { return null; }
  },

  sessionCacheSet(key, data, ttlMs = 300000) {
    try {
      sessionStorage.setItem(`spcache_${key}`, JSON.stringify({ data, exp: Date.now() + ttlMs }));
    } catch { /* quota */ }
  },

  sessionCacheClear(prefix) {
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k?.startsWith(`spcache_${prefix || ''}`)) sessionStorage.removeItem(k);
      }
    } catch { /* ignore */ }
  }
};

window.Utils = Utils;

document.getElementById('modal-close').addEventListener('click', Utils.hideModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget && e.currentTarget.dataset.noDismiss !== '1') Utils.hideModal();
});

function decodeRpcValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if (typeof value.__shoppos_b64 === 'string') {
    try {
      const bin = atob(value.__shoppos_b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch (_) {
      return new Uint8Array(0);
    }
  }
  if (Array.isArray(value)) return value.map(decodeRpcValue);
  const out = {};
  for (const k of Object.keys(value)) out[k] = decodeRpcValue(value[k]);
  return out;
}

const invoke = async (channel, ...args) => {
  if (!window.posAPI) {
    await new Promise(resolve => {
      if (window.posAPI) return resolve();
      window.addEventListener('posAPIReady', resolve, { once: true });
      setTimeout(resolve, 2500);
    });
  }
  if (!window.posAPI) {
    return { success: false, error: 'App API not ready - restart Shop POS' };
  }
  const key = String(channel).replace(/[:.]/g, '_');
  const fn = window.posAPI[key];
  if (typeof fn !== 'function') {
    console.error('[API] Missing handler:', channel, '->', key);
    return { success: false, error: 'Feature unavailable (' + channel + '). Update/reinstall the app.' };
  }
  try {
    const result = await fn(...args);
    const decoded = result && typeof result === 'object' ? decodeRpcValue(result) : result;
    // Cloud RPC often wraps as { success, data }. Login may be { success, user }.
    if (decoded && typeof decoded === 'object' && Object.prototype.hasOwnProperty.call(decoded, 'success')) {
      if (window.__SHOP_POS_CLOUD__) return decoded;
      // Installer / local: keep { success, user } and { success, data } as-is
      return decoded;
    }
    return decoded;
  } catch (err) {
    console.error('[API]', channel, err);
    return { success: false, error: (err && err.message) || String(err) };
  }
};

function whenPosAPIReady(fn) {
  if (window.posAPI) return fn();
  window.addEventListener('posAPIReady', fn, { once: true });
}

function isCloudBrowser() {
  return typeof window !== 'undefined' && !!window.__SHOP_POS_CLOUD__;
}

function downloadBlob(filename, bytes, mime) {
  let buf = bytes;
  if (buf instanceof ArrayBuffer) buf = new Uint8Array(buf);
  else if (buf?.type === 'Buffer' && Array.isArray(buf.data)) buf = new Uint8Array(buf.data);
  else if (Array.isArray(buf)) buf = new Uint8Array(buf);
  else if (!(buf instanceof Uint8Array) && buf != null) {
    try { buf = new Uint8Array(buf); } catch (_) { buf = new Uint8Array(0); }
  }
  if (!buf || !buf.byteLength) throw new Error('File was empty — nothing to save');
  const blob = new Blob([buf], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  return { success: true, path: filename };
}

function printHtmlBrowser(html, title) {
  const w = window.open('', '_blank', 'noopener,noreferrer');
  if (!w) return { success: false, error: 'Pop-up blocked. Allow pop-ups to print.' };
  const doc = html && String(html).includes('<html')
    ? String(html)
    : `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title || 'Print'}</title></head><body>${html || ''}</body></html>`;
  w.document.open();
  w.document.write(doc);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 250);
  return { success: true, preview: true };
}

function pickFileBrowser(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept || '*/*';
    input.style.cssText = 'position:fixed;top:-100px;opacity:0';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return resolve({ success: false, cancelled: true });
      const reader = new FileReader();
      reader.onload = () => resolve({
        success: true,
        path: reader.result,
        dataUrl: reader.result,
        fileName: file.name,
        name: file.name,
        is_image: /^image\//.test(file.type)
      });
      reader.onerror = () => resolve({ success: false, error: 'Could not read file' });
      reader.readAsDataURL(file);
    }, { once: true });
    input.click();
  });
}

const API = {
  quitApp: () => invoke('app:quit'),
  onAppCloseBlocked: (cb) => whenPosAPIReady(() => window.posAPI.onAppCloseBlocked(cb)),
  login: (u, p, pin) => invoke('auth:login', u, p, pin),
  logout: () => invoke('auth:logout'),
  seedInstallerAccount: (payload) => invoke('auth:seedInstallerAccount', payload),
  hasRecoverySecret: () => invoke('auth:hasRecovery'),
  getRecoveryStatus: () => invoke('auth:getRecoveryStatus'),
  verifyRecoveryPhrase: (secret) => invoke('auth:recoverVerify', secret),
  resetPasswordViaRecovery: (secret, username, newPassword) => invoke('auth:recoverReset', secret, username, newPassword),
  setRecoverySecret: (secret, actor) => invoke('auth:setRecoverySecret', secret, actor),
  factoryResetBusiness: (secret, confirmText, actor) => invoke('auth:factoryReset', secret, confirmText, actor),
  clearOperationalData: (password, actor, categories) => invoke('auth:clearOperationalData', password, actor, categories),
  listClearDataCategories: () => invoke('auth:listClearDataCategories'),
  getUsers: (actor) => invoke('auth:getUsers', actor),
  createUser: (data, actor) => invoke('auth:createUser', data, actor),
  updateUser: (id, data, actor) => invoke('auth:updateUser', id, data, actor),
  deleteUser: (id, actor) => invoke('auth:deleteUser', id, actor),
  permanentlyDeleteUser: (id, confirmUsername, actor) => invoke('auth:permanentlyDeleteUser', id, confirmUsername, actor),
  verifyUserSession: (userId) => invoke('auth:verifySession', userId),

  getSettings: () => invoke('settings:get'),
  getSettingsParsed: () => invoke('settings:getParsed'),
  saveSettings: (data, actor) => invoke('settings:save', data, actor),
  saveJsonSetting: (key, value, actor) => invoke('settings:saveJson', key, value, actor),
  submitSettingsRequest: (data, actor) => invoke('settings:submitRequest', data, actor),
  getPendingSettingsRequests: () => invoke('settings:getPendingRequests'),
  getSettingsRequestHistory: (limit) => invoke('settings:getRequestHistory', limit),
  approveSettingsRequest: (id, actor) => invoke('settings:approveRequest', id, actor),
  rejectSettingsRequest: (id, notes, actor) => invoke('settings:rejectRequest', id, notes, actor),
  updateSettingsRequest: (id, data, actor) => invoke('settings:updateRequest', id, data, actor),
  deleteSettingsRequest: (id, actor) => invoke('settings:deleteRequest', id, actor),
  completeSetup: (data) => invoke('settings:completeSetup', data),
  detectExistingBusiness: () => invoke('settings:detectExistingBusiness'),
  adoptExistingBusiness: () => invoke('settings:adoptExistingBusiness'),

  getCategories: (filters) => invoke('categories:get', filters || {}),
  saveCategory: (data, actor) => invoke('categories:save', data, actor),
  deleteCategory: (id, actor) => invoke('categories:delete', id, actor),

  getProducts: (filters) => invoke('products:get', filters),
  getProduct: (id) => invoke('products:getOne', id),
  getProductByBarcode: (barcode) => invoke('products:getByBarcode', barcode),
  calcRecipeMetrics: (data) => invoke('products:calcRecipe', data),
  saveProduct: (data, actor) => invoke('products:save', data, actor),
  deleteProduct: (id, actor) => invoke('products:delete', id, actor),
  importProducts: (rows, actor) => invoke('products:import', rows, actor),

  adjustStock: (productId, qty, type, notes, actor) => invoke('stock:adjust', productId, qty, type, notes, actor),
  getStockHistory: (productId) => invoke('stock:history', productId),

  completeSale: (data, actor) => invoke('sales:complete', data, actor),
  getSale: (id) => invoke('sales:get', id),
  getSaleByReceipt: (num) => invoke('sales:getByReceipt', num),
  holdOrder: (name, cart, actor) => invoke('sales:hold', name, cart, actor),
  getHeldOrders: () => invoke('sales:getHeld'),
  deleteHeldOrder: (id, actor) => invoke('sales:deleteHeld', id, actor),

  processReturn: (data, actor) => invoke('returns:process', data, actor),
  getReturns: (filters) => invoke('returns:get', filters),

  getExpenses: (filters) => invoke('expenses:get', filters),
  saveExpense: (data, actor) => invoke('expenses:save', data, actor),
  deleteExpense: (id, actor) => invoke('expenses:delete', id, actor),

  getCustomers: (search) => invoke('customers:get', search),
  getCustomer: (id) => invoke('customers:getOne', id),
  saveCustomer: (data, actor) => invoke('customers:save', data, actor),
  deleteCustomer: (id, actor) => invoke('customers:delete', id, actor),
  getCustomerHistory: (id) => invoke('customers:history', id),

  getSuppliers: (search) => invoke('suppliers:get', search),
  saveSupplier: (data, actor) => invoke('suppliers:save', data, actor),
  paySupplier: (supplierId, data, actor) => invoke('suppliers:pay', supplierId, data, actor),
  getSupplierPayments: (supplierId) => invoke('suppliers:payments', supplierId),

  getPurchaseOrders: () => invoke('po:get'),
  getPurchaseOrder: (id) => invoke('po:getDetail', id),
  savePurchaseOrder: (data, actor) => invoke('po:save', data, actor),
  receivePurchaseOrder: (id, actor) => invoke('po:receive', id, actor),
  receivePurchaseOrderPartial: (id, items, actor) => invoke('po:receivePartial', id, items, actor),
  deletePurchaseOrder: (id, actor) => invoke('po:delete', id, actor),
  updatePurchaseOrder: (id, data, actor) => invoke('po:update', id, data, actor),

  getDashboardStats: (from, to, actor) => invoke('dashboard:stats', from, to, actor),
  getInventoryStats: () => invoke('inventory:stats'),
  getSalesAnalytics: (from, to) => invoke('analytics:sales', from, to),
  getSalesReport: (from, to) => invoke('reports:sales', from, to),
  getProfitReport: (from, to) => invoke('reports:profit', from, to),
  getCashierReport: (from, to) => invoke('reports:cashier', from, to),
  getProductReport: (from, to) => invoke('reports:product', from, to),
  getStockReport: () => invoke('reports:stock'),
  getExpenseReport: (from, to) => invoke('reports:expenses', from, to),
  getHourlyReport: (from, to) => invoke('reports:hourly', from, to),
  getCategoryReport: (from, to) => invoke('reports:category', from, to),
  getBrandReport: (from, to) => invoke('reports:brand', from, to),
  getPaymentReport: (from, to) => invoke('reports:payments', from, to),
  getEmployeeReport: (from, to) => invoke('reports:employee', from, to),
  getDiscountReport: (from, to) => invoke('reports:discounts', from, to),
  getVoidReport: (from, to) => invoke('reports:voids', from, to),
  getMovementReport: (from, to) => invoke('reports:movements', from, to),
  getProfitDashboard: (from, to) => invoke('reports:profitDash', from, to),
  getGiftCardReport: (from, to) => invoke('reports:giftcards', from, to),
  getLaybyReport: (from, to) => invoke('reports:layby', from, to),
  getQuotesReport: (from, to) => invoke('reports:quotes', from, to),
  getOnAccountReport: (from, to) => invoke('reports:onaccount', from, to),
  getCashUpReport: (from, to) => invoke('reports:cashup', from, to),
  logOperatingEvent: (type, user) => invoke('operating:log', type, user),
  getOperatingLogReport: (from, to) => invoke('reports:operating', from, to),

  openShift: (float, actor) => invoke('shifts:open', float, actor),
  recordCashDrop: (data, actor) => invoke('shifts:cashDrop', data, actor),
  getCashDrops: (filters) => invoke('shifts:cashDrops', filters || {}),
  confirmCashDrop: (id, actor) => invoke('shifts:confirmCashDrop', id, actor),
  closeShift: (id, data, actor) => invoke('shifts:close', id, data, actor),
  getShiftClosePreview: (id, actor) => invoke('shifts:closePreview', id, actor),
  getShifts: (limit) => invoke('shifts:get', limit),
  getAllOpenShifts: (actor) => invoke('shifts:getOpenAll', actor),
  forceCloseShift: (id, data, actor) => invoke('shifts:forceClose', id, data, actor),
  updateShift: (id, data, actor) => invoke('shifts:update', id, data, actor),
  deleteShift: (id, actor) => invoke('shifts:delete', id, actor),
  getOpenShift: (actor) => invoke('shifts:current', actor),
  getSalesTargets: () => invoke('settings:getSalesTargets'),
  saveSalesTargets: (data, actor) => invoke('settings:saveSalesTargets', data, actor),
  getShiftSettings: () => invoke('settings:getShiftSettings'),
  enforceCashoutDeadlines: () => invoke('settings:enforceCashoutDeadlines'),
  saveShiftSettings: (data, actor) => invoke('settings:saveShiftSettings', data, actor),

  getAuditLog: (filters) => invoke('audit:get', filters),
  getNotifications: (actor) => invoke('notifications:get', actor),
  markNotificationRead: (id) => invoke('notifications:read', id),
  markAllNotificationsRead: (actor) => invoke('notifications:readAll', actor),
  createTestNotification: () => invoke('notifications:createTest'),
  refreshPaymentDueNotifications: () => invoke('notifications:refreshPaymentDue'),
  ensureDemoNotificationSound: () => invoke('notifications:ensureDemoSound'),

  globalSearch: (q) => invoke('search:global', q),
  getPrinters: () => invoke('printers:list'),
  getPrintersByConnection: (connection) => invoke('printers:listByConnection', connection),
  connectPrinter: (connection, options) => invoke('printers:connect', connection, options),

  backupCreate: (actor) => invoke('backup:create', actor),
  backupRestore: (actor) => invoke('backup:restore', actor),
  backupRestoreSetup: () => invoke('backup:restoreSetup'),
  backupExport: (actor) => invoke('backup:export', actor),
  getBackupInfo: () => invoke('backup:getInfo'),
  getDeviceSettings: () => invoke('deviceSettings:get'),
  saveDeviceSettings: (data) => invoke('deviceSettings:save', data),
  printPreview: (html, title) => isCloudBrowser()
    ? Promise.resolve(printHtmlBrowser(html, title))
    : invoke('print:preview', html, title),
  printReceipt: (html, opts) => isCloudBrowser()
    ? Promise.resolve(printHtmlBrowser(html, 'Receipt'))
    : invoke('print:receipt', html, opts),
  printKitchen: (html, opts) => isCloudBrowser()
    ? Promise.resolve(printHtmlBrowser(html, 'Kitchen'))
    : invoke('print:kitchen', html, opts),
  printA4: (html, opts) => isCloudBrowser()
    ? Promise.resolve(printHtmlBrowser(html, 'Document'))
    : invoke('print:a4', html, opts || {}),
  openCashDrawer: () => invoke('print:openDrawer'),
  printBarcodeLabel: (product) => invoke('print:barcode', product),
  getPrinterStatus: (names) => invoke('printers:status', names),
  openKitchenDisplay: () => {
    if (typeof window !== 'undefined') {
      window.open('kitchen-display.html', 'shoppos-kitchen', 'noopener,noreferrer,width=1200,height=800');
      return Promise.resolve({ success: true });
    }
    return invoke('kitchen:openDisplay');
  },
  closeKitchenDisplay: () => invoke('kitchen:closeDisplay'),
  refreshKitchenDisplay: () => invoke('kitchen:refreshDisplay'),
  openCustomerDisplay: () => {
    if (isCloudBrowser() && typeof window !== 'undefined') {
      window.open('customer-display.html', 'shoppos-customer', 'noopener,noreferrer,width=1280,height=800');
      return Promise.resolve({ success: true });
    }
    return invoke('customer:openDisplay');
  },
  closeCustomerDisplay: () => invoke('customer:closeDisplay'),
  refreshCustomerDisplay: () => invoke('customer:refreshDisplay'),
  saveFile: async (name, filters, buffer) => {
    if (isCloudBrowser()) {
      try {
        const mime = String(name || '').toLowerCase().endsWith('.pdf')
          ? 'application/pdf'
          : String(name || '').toLowerCase().endsWith('.xlsx')
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'application/octet-stream';
        return downloadBlob(name, buffer, mime);
      } catch (err) {
        return { success: false, error: err.message || String(err) };
      }
    }
    return invoke('file:save', name, filters, buffer);
  },
  openPdf: async (buffer, filename) => {
    if (isCloudBrowser()) {
      try { return downloadBlob(filename || 'document.pdf', buffer, 'application/pdf'); }
      catch (err) { return { success: false, error: err.message || String(err) }; }
    }
    return invoke('file:openPdf', buffer, filename);
  },
  printPdf: async (buffer, filename) => {
    if (isCloudBrowser()) {
      try {
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || []);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const w = window.open(url, '_blank', 'noopener,noreferrer');
        if (!w) return downloadBlob(filename || 'document.pdf', bytes, 'application/pdf');
        return { success: true, preview: true };
      } catch (err) {
        return { success: false, error: err.message || String(err) };
      }
    }
    return invoke('file:printPdf', buffer, filename);
  },
  openPath: (filePath) => invoke('file:openPath', filePath),
  openExternal: async (url) => {
    if (!url) return { success: false, error: 'No URL' };
    const viaApi = await invoke('file:openExternal', String(url));
    if (viaApi?.success) return viaApi;
    try {
      window.open(String(url), '_blank', 'noopener,noreferrer');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  },
  selectDocument: (prefix) => isCloudBrowser()
    ? pickFileBrowser('.pdf,image/*,.png,.jpg,.jpeg,.webp,.doc,.docx')
    : invoke('file:selectDocument', prefix),
  persistMobileDocument: (path) => invoke('file:persistMobileDocument', path),
  selectImage: (prefix) => isCloudBrowser()
    ? pickFileBrowser('image/*')
    : invoke('file:selectImage', prefix),
  getImageDataUrl: async (filePath) => {
    const r = await invoke('file:getImageDataUrl', filePath);
    if (!r || typeof r !== 'object') return r;
    // Normalize: backend returns dataUrl; some UI still reads .data
    const url = r.dataUrl || r.data || null;
    if (r.success && url) return { ...r, dataUrl: url, data: url };
    return r;
  },
  exportPDF: async (filename, title, headers, rows, company) => {
    const r = await invoke('export:pdf', filename, title, headers, rows, company);
    if (isCloudBrowser() && r?.success !== false && (r?.data instanceof Uint8Array || r?.data?.byteLength)) {
      try { return downloadBlob(filename || 'report.pdf', r.data, 'application/pdf'); }
      catch (err) { return { success: false, error: err.message || String(err) }; }
    }
    return r;
  },
  exportExcel: async (filename, sheets) => {
    const r = await invoke('export:excel', filename, sheets);
    if (isCloudBrowser() && r?.success !== false && (r?.data instanceof Uint8Array || r?.data?.byteLength)) {
      try {
        return downloadBlob(
          filename || 'export.xlsx',
          r.data,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
      } catch (err) { return { success: false, error: err.message || String(err) }; }
    }
    return r;
  },
  exportPrint: async (title, headers, rows, company) => {
    const r = await invoke('export:print', title, headers, rows, company);
    if (isCloudBrowser()) {
      const html = (typeof r?.data === 'string' && r.data.includes('<')) ? r.data : (r?.html || r?.data?.html);
      if (html) return printHtmlBrowser(html, title);
    }
    return r;
  },
  printReport: (title, headers, rows, company) => invoke('export:print', title, headers, rows, company),

  getDatabaseHealth: () => invoke('db:health'),
  optimizeDatabase: () => invoke('db:optimize'),
  repairDatabase: () => invoke('db:repair'),
  resetDemoData: (actor) => invoke('db:resetDemo', actor),
  archiveRecords: (days) => invoke('db:archive', days),
  recalculateStock: () => invoke('db:recalcStock'),
  getSystemLogs: (limit) => invoke('db:logs', limit),

  getQuotes: (f) => invoke('quotes:get', f),
  getQuote: (id) => invoke('quotes:getOne', id),
  saveQuote: (data, actor) => invoke('quotes:save', data, actor),
  convertQuote: (id, actor, paymentOpts) => invoke('quotes:convert', id, actor, paymentOpts),
  deleteQuote: (id, actor) => invoke('quotes:delete', id, actor),
  markQuoteConverted: (id, saleId, actor) => invoke('quotes:markConverted', id, saleId, actor),
  reactivateQuote: (id, actor) => invoke('quotes:reactivate', id, actor),
  getQuotePdf: (id) => invoke('quotes:pdf', id),

  verifyBookkeepingPassword: (password) => invoke('auth:verifyBookkeepingPassword', password),
  setBookkeepingPassword: (password, actor) => invoke('auth:setBookkeepingPassword', password, actor),

  selectAudio: (prefix) => isCloudBrowser()
    ? pickFileBrowser('audio/*')
    : invoke('file:selectAudio', prefix),
  getAudioDataUrl: (filePath) => invoke('file:getAudioDataUrl', filePath),

  getLaybyes: (f) => invoke('layby:get', f),
  getLayby: (id) => invoke('layby:getOne', id),
  createLayby: (data, actor) => invoke('layby:create', data, actor),
  payLayby: (id, amount, type, actor) => invoke('layby:pay', id, amount, type, actor),
  refundLayby: (id, actor) => invoke('layby:refund', id, actor),
  getLaybySettings: (actor) => invoke('layby:getSettings', actor),
  saveLaybySettings: (data, actor) => invoke('layby:saveSettings', data, actor),

  getGiftCards: (s) => invoke('giftcards:get', s),
  createGiftCard: (data, actor) => invoke('giftcards:create', data, actor),
  updateGiftCard: (id, data, actor) => invoke('giftcards:update', id, data, actor),
  deleteGiftCard: (id, actor) => invoke('giftcards:delete', id, actor),
  checkGiftCard: (code) => invoke('giftcards:check', code),
  approveGiftCard: (id, actor) => invoke('giftcards:approve', id, actor),
  rejectGiftCard: (id, notes, actor) => invoke('giftcards:reject', id, notes, actor),
  getGiftCardSettings: (actor) => invoke('giftcards:getSettings', actor),
  saveGiftCardSettings: (data, actor) => invoke('giftcards:saveSettings', data, actor),
  copyImageToClipboard: (filePath) => invoke('file:copyImageToClipboard', filePath),
  shareNativeFile: (filePath, title) => invoke('file:shareNative', filePath, title),

  getLoyaltyHistory: (id) => invoke('loyalty:history', id),
  getCreditLedger: (id) => invoke('credit:ledger', id),
  payCustomerCredit: (id, amount, notes, actor) => invoke('credit:pay', id, amount, notes, actor),

  getStockCounts: () => invoke('stockcount:get'),
  getStockCount: (id) => invoke('stockcount:getOne', id),
  createStockCount: (notes, actor) => invoke('stockcount:create', notes, actor),
  updateStockCountLine: (lineId, qty) => invoke('stockcount:updateLine', lineId, qty),
  completeStockCount: (id, actor) => invoke('stockcount:complete', id, actor),

  getWasteRecords: (from, to, filters) => invoke('waste:get', from, to, filters),
  recordWaste: (data, actor) => invoke('waste:record', data, actor),
  approveWaste: (id, notes, actor) => invoke('waste:approve', id, notes, actor),
  rejectWaste: (id, notes, actor) => invoke('waste:reject', id, notes, actor),
  returnWasteToStock: (id, actor) => invoke('waste:returnStock', id, actor),

  getCashUps: (limitOrFilters) => invoke('cashup:get', limitOrFilters),
  getCashUp: (id) => invoke('cashup:getOne', id),
  getCashUpByShift: (shiftId) => invoke('cashup:byShift', shiftId),
  createCashUp: (shiftId, data, actor) => invoke('cashup:create', shiftId, data, actor),
  approveCashUp: (id, notes, actor) => invoke('cashup:approve', id, notes, actor),
  updateCashUp: (id, data, actor) => invoke('cashup:update', id, data, actor),
  deleteCashUp: (id, actor) => invoke('cashup:delete', id, actor),
  getCashUpSummary: (from, to) => invoke('cashup:summary', from, to),
  getCashUpPdf: (id) => invoke('cashup:pdf', id),

  getAutomationRules: () => invoke('automation:get'),
  saveAutomationRule: (data) => invoke('automation:save', data),
  deleteAutomationRule: (id) => invoke('automation:delete', id),

  getCustomFields: (type) => invoke('customfields:get', type),
  saveCustomField: (data) => invoke('customfields:save', data),
  deleteCustomField: (id) => invoke('customfields:delete', id),
  getCustomFieldValues: (type, entityId) => invoke('customfields:values', type, entityId),
  saveCustomFieldValues: (type, entityId, values, actor) => invoke('customfields:saveValues', type, entityId, values, actor),

  getTables: () => invoke('tables:get'),
  saveTable: (data, actor) => invoke('tables:save', data, actor),
  deleteTable: (id, actor) => invoke('tables:delete', id, actor),
  getOrderTypeReport: (from, to) => invoke('reports:orderTypes', from, to),
  runStartupTasks: () => invoke('store:runStartupTasks'),
  getEmployeeOfMonthScores: (monthYear, actor) => invoke('employeeOfMonth:getScores', monthYear, actor),
  getEmployeeOfMonthRecord: (monthYear, actor) => invoke('employeeOfMonth:getRecord', monthYear, actor),
  saveEmployeeOfMonth: (data, actor) => invoke('employeeOfMonth:save', data, actor),
  generateEmployeeOfMonthCertificate: (monthYear, actor) => invoke('employeeOfMonth:certificate', monthYear, actor),
  notifyEmployeeOfMonthWhatsApp: (monthYear, actor) => invoke('employeeOfMonth:notifyWhatsApp', monthYear, actor),
  sendEmployeeOfMonthCertificateWhatsApp: (employeeId, actor) => invoke('employeeOfMonth:sendCertificateWhatsApp', employeeId, actor),
  getEmployeeOfMonthHistory: (filters, actor) => invoke('employeeOfMonth:getHistory', filters, actor),
  deleteEmployeeOfMonth: (id, actor) => invoke('employeeOfMonth:delete', id, actor),
  getStaffPortalFeed: (employeeId) => invoke('staff:getPortalFeed', employeeId),
  saveKdsNotificationSound: (path, actor) => invoke('settings:saveKdsSound', path, actor),
  getKitchenOrders: (status) => invoke('kitchen:get', status),
  updateKitchenStatus: (id, status, actor) => invoke('kitchen:status', id, status, actor),
  createKitchenOrder: (data, actor) => invoke('kitchen:create', data, actor),

  getDeveloperInfo: (actor) => invoke('dev:info', actor),
  activateLicense: (key, actor) => invoke('dev:activate', key, actor),
  resetTrial: (actor) => invoke('dev:resetTrial', actor),

  getSalesList: (f) => invoke('audit:salesList', f),
  searchSales: (f) => invoke('audit:searchSales', f),
  voidSale: (id, reason, actor, supervisorCode) => invoke('audit:voidSale', id, reason, actor, supervisorCode),
  generateSupervisorCode: (actor, purpose) => invoke('security:generateCode', actor, purpose),
  getTodaySupervisorCode: (actor, purpose) => invoke('security:getTodayCode', actor, purpose),
  verifySupervisorCode: (code, purpose) => invoke('security:verifyCode', code, purpose),
  getSoldProductsReport: (from, to) => invoke('audit:soldProducts', from, to),
  getLowPerformanceProducts: (days) => invoke('audit:lowPerformance', days),
  getReturnDetail: (id) => invoke('audit:returnDetail', id),
  getReturnsList: (f) => invoke('audit:returnsList', f),
  getPriceHistory: (limit) => invoke('audit:priceHistory', limit),
  getActivityTimeline: (from, to) => invoke('audit:timeline', from, to),
  getExceptionReport: (from, to) => invoke('audit:exceptions', from, to),
  getAdminAlerts: () => invoke('audit:alerts'),
  getAdminDashboard: (from, to) => invoke('audit:dashboard', from, to),
  getDailyClosingReport: (date) => invoke('audit:dailyClosing', date),
  getCustomerPurchaseSummary: (id) => invoke('audit:customerSummary', id),
  getTopCustomers: (from, to, limit) => invoke('audit:topCustomers', from, to, limit),
  getReturnReasonsReport: (from, to) => invoke('audit:returnReasons', from, to),
  reopenReturn: (id, actor) => invoke('audit:reopenReturn', id, actor),
  verifyManagerPin: (pin) => invoke('auth:verifyManagerPin', pin),

  getEmployees: (filters, actor) => invoke('staff:getEmployees', filters, actor),
  getEmployee: (id) => invoke('staff:getEmployee', id),
  getEmployeeByUserId: (userId) => invoke('staff:getEmployeeByUserId', userId),
  saveEmployee: (data, actor) => invoke('staff:saveEmployee', data, actor),
  deleteEmployee: (id, actor) => invoke('staff:deleteEmployee', id, actor),
  staffLogin: (code, pin) => invoke('staff:login', code, pin),
  adminOpenStaffPortal: (employeeId, actor) => invoke('staff:adminOpen', employeeId, actor),
  staffLogout: () => invoke('staff:logout'),
  validateEmployeeLinks: (data) => invoke('staff:validateLinks', data),
  saveStaffSelfie: (data) => invoke('staff:saveSelfie', data),
  getStaffSelfies: (filters, actor) => invoke('staff:getSelfies', filters, actor),
  getStaffSelfie: (id, actor) => invoke('staff:getSelfie', id, actor),
  updateStaffSelfie: (id, photoData, notes, actor) => invoke('staff:updateSelfie', id, photoData, notes, actor),
  deleteStaffSelfie: (id, actor) => invoke('staff:deleteSelfie', id, actor),
  staffClock: (employeeId, action, auth) => invoke('staff:clock', employeeId, action, auth),
  getStaffAttendance: (filters) => invoke('staff:getAttendance', filters),
  getStaffTodayAttendance: (id) => invoke('staff:getTodayAttendance', id),
  getStaffAttendanceSummary: (employeeId, from, to) => invoke('staff:getAttendanceSummary', employeeId, from, to),
  createStaffAttendance: (data, actor) => invoke('staff:createAttendance', data, actor),
  deleteStaffAttendance: (id, actor) => invoke('staff:deleteAttendance', id, actor),
  addAttendancePenalty: (data, actor) => invoke('staff:addAttendancePenalty', data, actor),
  getAttendancePenalties: (filters, actor) => invoke('staff:getAttendancePenalties', filters, actor),
  cancelAttendancePenalty: (id, actor) => invoke('staff:cancelAttendancePenalty', id, actor),
  getStaffLeave: (id) => invoke('staff:getLeave', id),
  getAllStaffLeave: (status) => invoke('staff:getAllLeave', status),
  saveStaffLeave: (data, actor) => invoke('staff:saveLeave', data, actor),
  approveStaffLeave: (id, actor, approve) => invoke('staff:approveLeave', id, actor, approve),
  getStaffLeavePdf: (id) => invoke('staff:leavePdf', id),
  submitStaffLeaveProof: (leaveId, employeeId, imageData, actor) => invoke('staff:submitLeaveProof', leaveId, employeeId, imageData, actor),
  confirmStaffLeaveProof: (leaveId, actor) => invoke('staff:confirmLeaveProof', leaveId, actor),
  getPendingStaffLeaveProofs: () => invoke('staff:getPendingLeaveProofs'),
  getStaffLeaveBalance: (id) => invoke('staff:getLeaveBalance', id),
  getStaffLeavePolicy: (employeeId) => invoke('staff:getLeavePolicy', employeeId),
  getStaffPayroll: (id, actor) => invoke('staff:getPayroll', id, actor),
  generateStaffPayroll: (start, end, ids, actor) => invoke('staff:generatePayroll', start, end, ids, actor),
  payStaffSalary: (id, method, actor) => invoke('staff:paySalary', id, method, actor),
  getPayrollDashboard: (filters, actor) => invoke('staff:getPayrollDashboard', filters, actor),
  previewStaffPayroll: (start, end, filters, actor) => invoke('staff:previewPayroll', start, end, filters, actor),
  getMissedClockOutInbox: (filters, actor) => invoke('staff:getMissedClockOutInbox', filters, actor),
  resolveMissedClockOut: (id, action, actor) => invoke('staff:resolveMissedClockOut', id, action, actor),
  saveEmployeeWorkSchedule: (employeeId, schedule, actor) => invoke('staff:saveWorkSchedule', employeeId, schedule, actor),
  saveHrDocument: (data, actor) => invoke('staff:saveHrDocument', data, actor),
  getHrDocuments: (employeeId, actor) => invoke('staff:getHrDocuments', employeeId, actor),
  getHrDocument: (id, actor) => invoke('staff:getHrDocument', id, actor),
  buildHrDocumentHtml: (data, actor) => invoke('staff:buildHrDocumentHtml', data, actor),
  updateStaffAttendance: (id, data, actor) => invoke('staff:updateAttendance', id, data, actor),
  getStaffSchedules: (from, to, empId) => invoke('staff:getSchedules', from, to, empId),
  saveStaffSchedule: (data, actor) => invoke('staff:saveSchedule', data, actor),
  deleteStaffSchedule: (id, actor) => invoke('staff:deleteSchedule', id, actor),
  autoGenerateStaffShifts: (weekStart, templates, employeeIds, employeeOverrides, actor, options) => invoke('staff:autoShifts', weekStart, templates, employeeIds, employeeOverrides, actor, options || {}),
  getStaffDocuments: (id) => invoke('staff:getDocuments', id),
  saveStaffDocument: (data, actor) => invoke('staff:saveDocument', data, actor),
  getStaffDisciplinary: (id) => invoke('staff:getDisciplinary', id),
  saveStaffDisciplinary: (data, actor) => invoke('staff:saveDisciplinary', data, actor),
  respondStaffDisciplinary: (id, employeeId, response) => invoke('staff:respondDisciplinary', id, employeeId, response),
  getAllStaffDisciplinary: (filters, actor) => invoke('staff:getAllDisciplinary', filters, actor),
  getStaffDisciplinaryPdf: (id, copyType) => invoke('staff:disciplinaryPdf', id, copyType),
  markStaffDisciplinaryWa: (id) => invoke('staff:markDisciplinaryWa', id),
  getCustomerPhoneReport: (filters) => invoke('staff:getCustomerPhoneReport', filters),
  getCustomerPhoneReportPdf: (filters) => invoke('staff:customerPhoneReportPdf', filters),
  getStaffPerformance: (id, from, to) => invoke('staff:getPerformance', id, from, to),
  getStaffNotifications: () => invoke('staff:getNotifications'),
  getStaffPayslipPdf: (id) => invoke('staff:payslipPdf', id),
  getStaffSchedulePdf: (from, to) => invoke('staff:schedulePdf', from, to),
  getStaffSchedulePrintHtml: (from, to) => invoke('staff:schedulePrintHtml', from, to),
  getStaffReportPdf: (type, data) => invoke('staff:reportPdf', type, data),
  getStaffLoginEvents: (filters) => invoke('staff:getLoginEvents', filters),
  recordLogout: (user) => invoke('staff:recordLogout', user),
  validateOnAccount: (customerId, amount) => invoke('staff:validateAccount', customerId, amount),

  getHrEvalCategories: () => invoke('hr:getEvalCategories'),
  populateHrContract: (employeeId, templateId, actor) => invoke('hr:populateContract', employeeId, templateId, actor),
  fillHrContractBody: (data, actor) => invoke('hr:fillContractBody', data, actor),
  getContractTemplates: (actor) => invoke('hr:getContractTemplates', actor),
  saveContractTemplate: (data, actor) => invoke('hr:saveContractTemplate', data, actor),
  deleteContractTemplate: (id, actor) => invoke('hr:deleteContractTemplate', id, actor),
  getHrContracts: (filters, actor) => invoke('hr:getContracts', filters, actor),
  getHrContract: (id, actor) => invoke('hr:getContract', id, actor),
  saveHrContract: (data, actor) => invoke('hr:saveContract', data, actor),
  signHrContract: (contractId, role, sig, actor) => invoke('hr:signContract', contractId, role, sig, actor),
  getHrContractPdf: (id, actor) => invoke('hr:contractPdf', id, actor),
  openHrContractResign: (id, opensAt, closesAt, actor) => invoke('hr:openContractResign', id, opensAt, closesAt, actor),
  attachHrContractDoc: (contractId, filePath, fileName, actor) => invoke('hr:attachContractDoc', contractId, filePath, fileName, actor),
  getHrContractsForEmployee: (employeeId, actor) => invoke('hr:getContractsForEmployee', employeeId, actor),
  listSalaryClaims: (filters, actor) => invoke('salaryClaims:list', filters, actor),
  getSalaryClaim: (id, actor) => invoke('salaryClaims:get', id, actor),
  saveSalaryClaim: (data, actor) => invoke('salaryClaims:save', data, actor),
  deleteSalaryClaim: (id, actor) => invoke('salaryClaims:delete', id, actor),
  claimSalary: (id, notes, actor) => invoke('salaryClaims:claim', id, notes, actor),
  approveSalaryClaim: (id, notes, actor) => invoke('salaryClaims:approve', id, notes, actor),
  rejectSalaryClaim: (id, notes, actor) => invoke('salaryClaims:reject', id, notes, actor),
  markSalaryClaimPaid: (id, actor) => invoke('salaryClaims:markPaid', id, actor),
  getSalaryClaimPdf: (id, actor) => invoke('salaryClaims:pdf', id, actor),
  createSalaryClaimsFromPayroll: (start, end, deadline, paymentDate, opensAt, actor) =>
    invoke('salaryClaims:fromPayroll', start, end, deadline, paymentDate, opensAt, actor),
  getProbations: (filters, actor) => invoke('hr:getProbations', filters, actor),
  getProbation: (id, actor) => invoke('hr:getProbation', id, actor),
  saveProbation: (data, actor) => invoke('hr:saveProbation', data, actor),
  deleteProbation: (id, actor) => invoke('hr:deleteProbation', id, actor),
  getProbationDecisionRules: (actor) => invoke('hr:getDecisionRules', actor),
  saveProbationDecisionRule: (data, actor) => invoke('hr:saveDecisionRule', data, actor),
  saveProbationEvaluation: (data, actor) => invoke('hr:saveDailyEvaluation', data, actor),
  getProbationEvaluationHistory: (filters, actor) => invoke('hr:getEvaluationHistory', filters, actor),
  getProbationRecommendation: (probationId, actor) => invoke('hr:getRecommendation', probationId, actor),
  finalProbationDecision: (probationId, decision, reason, extendDays, actor) => invoke('hr:finalProbationDecision', probationId, decision, reason, extendDays, actor),
  getProbationDashboard: (filters, actor) => invoke('hr:getProbationDashboard', filters, actor),
  getProbationPdf: (id, actor) => invoke('hr:probationPdf', id, actor),
  getProbationEvalReportPdf: (id, actor) => invoke('hr:evaluationReportPdf', id, actor),
  getProbationLetterPdf: (id, decision, actor) => invoke('hr:probationLetterPdf', id, decision, actor),
  getEmployeePersonnelFile: (employeeId, actor) => invoke('hr:getPersonnelFile', employeeId, actor),

  getHrTrainingTemplates: (type, actor) => invoke('hrTraining:getTemplates', type, actor),
  saveHrTrainingTemplate: (data, actor) => invoke('hrTraining:saveTemplate', data, actor),
  deleteHrTrainingTemplate: (id, actor) => invoke('hrTraining:deleteTemplate', id, actor),
  getHrTrainingRecords: (filters, actor) => invoke('hrTraining:getRecords', filters, actor),
  saveHrTrainingRecord: (data, actor) => invoke('hrTraining:saveRecord', data, actor),
  deleteHrTrainingRecord: (id, actor) => invoke('hrTraining:deleteRecord', id, actor),
  saveHrTrainingEvaluation: (recordId, data, actor) => invoke('hrTraining:saveEvaluation', recordId, data, actor),
  getHrTrainingEvalPdf: (id, actor) => invoke('hrTraining:evalPdf', id, actor),
  getHrStaffSubmissions: (filters, actor) => invoke('hrTraining:getSubmissions', filters, actor),
  assignHrStaffTemplate: (data, actor) => invoke('hrTraining:assignTemplate', data, actor),
  submitHrStaffForm: (data, actor) => invoke('hrTraining:submitForm', data, actor),
  reviewHrStaffSubmission: (id, decision, notes, actor) => invoke('hrTraining:reviewSubmission', id, decision, notes, actor),
  updateHrStaffSubmission: (id, data, actor) => invoke('hrTraining:updateSubmission', id, data, actor),
  deleteHrStaffSubmission: (id, actor) => invoke('hrTraining:deleteSubmission', id, actor),
  attachHrSubmissionDoc: (submissionId, filePath, actor) => invoke('hrTraining:attachDoc', submissionId, filePath, actor),

  getJobPostings: (filters, actor) => invoke('jobs:getPostings', filters, actor),
  saveJobPosting: (data, actor) => invoke('jobs:savePosting', data, actor),
  approveJobPosting: (id, actor) => invoke('jobs:approvePosting', id, actor),
  closeJobPosting: (id, actor) => invoke('jobs:closePosting', id, actor),
  deleteJobPosting: (id, actor) => invoke('jobs:deletePosting', id, actor),
  getJobCandidates: (filters, actor) => invoke('jobs:getCandidates', filters, actor),
  getJobCandidate: (id, actor) => invoke('jobs:getCandidate', id, actor),
  saveJobCandidate: (data, actor) => invoke('jobs:saveCandidate', data, actor),
  requestEmployCandidate: (id, actor) => invoke('jobs:requestEmploy', id, actor),
  decideJobCandidate: (id, decision, notes, actor) => invoke('jobs:decideCandidate', id, decision, notes, actor),
  attachJobCandidateCv: (candidateId, filePath, actor) => invoke('jobs:attachCv', candidateId, filePath, actor),
  attachJobCandidatePicture: (candidateId, filePath, actor) => invoke('jobs:attachPic', candidateId, filePath, actor),
  scheduleJobInterview: (data, actor) => invoke('jobs:scheduleInterview', data, actor),
  sendJobCandidateWhatsApp: (id, messageType, actor, body) => invoke('jobs:waCandidate', id, messageType, actor, body),
  sendJobInterviewWhatsAppBulk: (ids, actor, body) => invoke('jobs:waInterviewBulk', ids, actor, body),
  createJobInterviewDoc: (id, actor) => invoke('jobs:interviewDoc', id, actor),
  uploadJobInterviewResult: (id, filePath, actor) => invoke('jobs:uploadInterviewResult', id, filePath, actor),
  approveJobInterview: (id, decision, notes, actor) => invoke('jobs:approveInterview', id, decision, notes, actor),
  getRecruitmentSettings: (actor) => invoke('jobs:getSettings', actor),
  saveRecruitmentSettings: (data, actor) => invoke('jobs:saveSettings', data, actor),

  getPayrollSettings: () => invoke('payroll:getSettings'),
  savePayrollSettings: (data, actor) => invoke('payroll:saveSettings', data, actor),
  getSalaryAdvances: (filters) => invoke('payroll:getAdvances', filters),
  issueSalaryAdvance: (data, actor) => invoke('payroll:issueAdvance', data, actor),
  getEmployeeLoans: (filters) => invoke('payroll:getLoans', filters),
  saveEmployeeLoan: (data, actor) => invoke('payroll:saveLoan', data, actor),
  settleEmployeeLoan: (id, actor) => invoke('payroll:settleLoan', id, actor),
  getDamageCosts: (filters) => invoke('payroll:getDamageCosts', filters),
  saveDamageCost: (data, actor) => invoke('payroll:saveDamageCost', data, actor),
  approveDamageCost: (id, actor) => invoke('payroll:approveDamageCost', id, actor),
  getComplianceSubmissions: (type) => invoke('payroll:getComplianceSubmissions', type),
  saveComplianceSubmission: (data, actor) => invoke('payroll:saveComplianceSubmission', data, actor),
  getComplianceCertificates: () => invoke('payroll:getComplianceCertificates'),
  saveComplianceCertificate: (data) => invoke('payroll:saveComplianceCertificate', data),
  deleteComplianceCertificate: (id) => invoke('payroll:deleteComplianceCertificate', id),
  getComplianceReminders: () => invoke('payroll:getComplianceReminders'),
  getPayrollReport: (from, to) => invoke('payroll:getReport', from, to),
  getPayrollStatutoryReport: (type, from, to) => invoke('payroll:getStatutoryReport', type, from, to),
  getPayrollCompliancePdf: (type, from, to) => invoke('payroll:compliancePdf', type, from, to),

  syncOwnerSalary: () => invoke('ownerSalary:sync'),
  getOwnerSalaryProfile: () => invoke('ownerSalary:getProfile'),
  saveOwnerSalaryProfile: (data, actor) => invoke('ownerSalary:saveProfile', data, actor),
  deleteOwnerSalaryProfile: (actor) => invoke('ownerSalary:deleteProfile', actor),
  getOwnerSalaryPeriods: (profileId, filters) => invoke('ownerSalary:getPeriods', profileId, filters),
  getOwnerSalaryPayments: (profileId) => invoke('ownerSalary:getPayments', profileId),
  payOwnerSalary: (data, actor) => invoke('ownerSalary:pay', data, actor),
  getOwnerSalaryNotifications: () => invoke('ownerSalary:getNotifications'),
  getOwnerSalaryReport: (type, from, to) => invoke('ownerSalary:getReport', type, from, to),
  getOwnerSalaryPayslipPdf: (periodId) => invoke('ownerSalary:payslipPdf', periodId),
  getOwnerSalaryReportPdf: (type, from, to) => invoke('ownerSalary:reportPdf', type, from, to),
  getOwnerDraws: (filters) => invoke('ownerSalary:getDraws', filters),
  addOwnerDraw: (data, actor) => invoke('ownerSalary:addDraw', data, actor),
  deleteOwnerDraw: (id, actor) => invoke('ownerSalary:deleteDraw', id, actor),

  getBookkeepingSettings: () => invoke('bookkeeping:getSettings'),
  saveBookkeepingSettings: (data, actor) => invoke('bookkeeping:saveSettings', data, actor),
  syncBookkeeping: (from, to) => invoke('bookkeeping:sync', from, to),
  getFinancialDashboard: (from, to) => invoke('bookkeeping:dashboard', from, to),
  searchLedger: (filters) => invoke('bookkeeping:search', filters),
  getBookkeepingIncome: (filters) => invoke('bookkeeping:getIncome', filters),
  saveBookkeepingIncome: (data, actor) => invoke('bookkeeping:saveIncome', data, actor),
  deleteBookkeepingIncome: (id, actor) => invoke('bookkeeping:deleteIncome', id, actor),
  getBankTransactions: (filters) => invoke('bookkeeping:getBank', filters),
  saveBankTransaction: (data, actor) => invoke('bookkeeping:saveBank', data, actor),
  getCashBook: (from, to) => invoke('bookkeeping:cashBook', from, to),
  getBankBook: (from, to) => invoke('bookkeeping:bankBook', from, to),
  getPayrollAccounting: (from, to) => invoke('bookkeeping:payrollAccounting', from, to),
  getTaxSummary: (from, to) => invoke('bookkeeping:taxSummary', from, to),
  getFinancialReport: (type, from, to) => invoke('bookkeeping:report', type, from, to),
  getBusinessPerformance: (from, to) => invoke('bookkeeping:performance', from, to),
  getBudgets: (month) => invoke('bookkeeping:getBudgets', month),
  saveBudget: (data, actor) => invoke('bookkeeping:saveBudget', data, actor),
  deleteBudget: (id, actor) => invoke('bookkeeping:deleteBudget', id, actor),
  getBudgetVsActual: (month) => invoke('bookkeeping:budgetVsActual', month),
  getFinancialDocuments: (filters) => invoke('bookkeeping:getDocuments', filters),
  saveFinancialDocument: (data, actor) => invoke('bookkeeping:saveDocument', data, actor),
  deleteFinancialDocument: (id, actor) => invoke('bookkeeping:deleteDocument', id, actor),
  getFinancialAuditTrail: (filters) => invoke('bookkeeping:auditTrail', filters),
  getFinancialNotifications: () => invoke('bookkeeping:notifications'),
  getBookkeepingCategories: () => invoke('bookkeeping:categories'),
  getFinancialReportPdf: (type, from, to) => invoke('bookkeeping:reportPdf', type, from, to),

  getDonations: (filters) => invoke('donations:get', filters),
  getDonation: (id) => invoke('donations:getOne', id),
  saveDonation: (data, actor) => invoke('donations:save', data, actor),
  deleteDonation: (id, actor) => invoke('donations:delete', id, actor),
  uploadDonationDoc: (donationId, doc, actor) => invoke('donations:uploadDoc', donationId, doc, actor),
  getDonationDoc: (id) => invoke('donations:getDoc', id),
  submitDonation: (id, actor) => invoke('donations:submit', id, actor),
  approveDonation: (id, data, actor) => invoke('donations:approve', id, data, actor),
  getDonationsDashboard: (filters) => invoke('donations:dashboard', filters),
  getDonationsReport: (filters) => invoke('donations:report', filters),
  getDonationsReportPdf: (filters) => invoke('donations:reportPdf', filters),
  getDonationsReportExcel: (filters) => invoke('donations:reportExcel', filters),
  getDonationTypes: () => invoke('donations:types'),

  getCompanyRules: (filters) => invoke('ops:getRules', filters),
  getCompanyRule: (id) => invoke('ops:getRule', id),
  saveCompanyRule: (data, actor) => invoke('ops:saveRule', data, actor),
  archiveCompanyRule: (id, actor) => invoke('ops:archiveRule', id, actor),
  getCompanyRulePdf: (id) => invoke('ops:rulePdf', id),
  getAllCompanyRulesPdf: () => invoke('ops:allRulesPdf'),
  getOpeningChecklistTemplates: () => invoke('ops:openingTemplates'),
  getClosingChecklistTemplates: () => invoke('ops:closingTemplates'),
  saveOpeningChecklistTemplate: (data, actor) => invoke('ops:saveOpeningTemplate', data, actor),
  saveClosingChecklistTemplate: (data, actor) => invoke('ops:saveClosingTemplate', data, actor),
  deleteOpeningChecklistTemplate: (id, actor) => invoke('ops:deleteOpeningTemplate', id, actor),
  deleteClosingChecklistTemplate: (id, actor) => invoke('ops:deleteClosingTemplate', id, actor),
  getChecklistRuns: (filters) => invoke('ops:getChecklistRuns', filters),
  getChecklistRun: (id) => invoke('ops:getChecklistRun', id),
  startChecklistRun: (data, actor) => invoke('ops:startChecklist', data, actor),
  completeChecklistItem: (itemId, data, actor) => invoke('ops:completeChecklistItem', itemId, data, actor),
  finishChecklistRun: (runId, actor) => invoke('ops:finishChecklist', runId, actor),
  submitChecklistRun: (runId, actor) => invoke('ops:submitChecklist', runId, actor),
  confirmChecklistRun: (runId, data, actor) => invoke('ops:confirmChecklist', runId, data, actor),
  reopenChecklistRun: (runId, actor) => invoke('ops:reopenChecklist', runId, actor),
  adminUpdateChecklistRun: (runId, data, actor) => invoke('ops:adminUpdateChecklist', runId, data, actor),
  deleteChecklistRun: (runId, actor) => invoke('ops:deleteChecklist', runId, actor),
  getPendingChecklistSubmissions: () => invoke('ops:pendingChecklists'),
  getAdminSignature: () => invoke('ops:getAdminSignature'),
  saveAdminSignature: (path, actor) => invoke('ops:saveAdminSignature', path, actor),
  getChecklistSettings: () => invoke('ops:getChecklistSettings'),
  saveChecklistSettings: (data, actor) => invoke('ops:saveChecklistSettings', data, actor),
  getChecklistWarnings: (filters) => invoke('ops:checklistWarnings', filters),
  getStaffChecklistWarnings: (userId, employeeId) => invoke('ops:staffChecklistWarnings', userId, employeeId),
  ackChecklistWarning: (id, actor) => invoke('ops:ackChecklistWarning', id, actor),
  getChecklistReportPdf: (runId) => invoke('ops:checklistPdf', runId),
  getNonSellingProducts: (filters) => invoke('ops:nonSellingProducts', filters),
  getNonSellingProductsExcel: (filters) => invoke('ops:nonSellingExcel', filters),
  getNonSellingProductsPdf: (filters) => invoke('ops:nonSellingPdf', filters),
  markProductPromo: (productId, data, actor) => invoke('ops:markProductPromo', productId, data, actor),
  getComplianceDashboard: () => invoke('ops:dashboard'),
  proposeProductPromo: (productId, data, actor) => invoke('ops:proposePromo', productId, data, actor),
  getPendingPromoRequests: () => invoke('ops:pendingPromos'),
  getPromoRequestHistory: (filters) => invoke('ops:promoHistory', filters),
  approvePromoRequest: (id, actor) => invoke('ops:approvePromo', id, actor),
  rejectPromoRequest: (id, notes, actor) => invoke('ops:rejectPromo', id, notes, actor),
  cancelPromoRequest: (id, actor) => invoke('ops:cancelPromo', id, actor),
  deletePromoRequest: (id, actor) => invoke('ops:deletePromo', id, actor),
  getPromoSalesLog: (filters) => invoke('ops:promoSalesLog', filters),
  syncPromoStatuses: () => invoke('ops:syncPromoStatuses'),

  getCombos: (filters) => invoke('combos:get', filters),
  getActiveCombos: (filters) => invoke('combos:getActive', filters),
  getCombo: (id) => invoke('combos:getOne', id),
  saveCombo: (data, actor) => invoke('combos:save', data, actor),
  setComboStatus: (id, status, actor) => invoke('combos:setStatus', id, status, actor),
  approveCombo: (id, actor) => invoke('combos:approve', id, actor),
  rejectCombo: (id, notes, actor) => invoke('combos:reject', id, notes, actor),
  deleteCombo: (id, actor) => invoke('combos:delete', id, actor),
  calcComboPrices: (items, pricingType, discountValue) => invoke('combos:calcPrices', items, pricingType, discountValue),
  getComboReport: (filters) => invoke('combos:report', filters),
  getComboReportPdf: (filters) => invoke('combos:reportPdf', filters),
  getComboReportExcel: (filters) => invoke('combos:reportExcel', filters),

  recipeLogin: (username, password, pin) => invoke('recipe:login', username, password, pin),
  recipeSessionFromPos: (actor) => invoke('recipe:sessionFromPos', actor),
  recipeCreateRestockPo: (data, actor) => invoke('recipe:createRestockPo', data, actor),
  recipePrepBoard: (actor) => invoke('recipe:prepBoard', actor),
  recipeFoodCostAlerts: (actor, opts) => invoke('recipe:foodCostAlerts', actor, opts),
  recipePosSubs: (ingredientId, actor) => invoke('recipe:posSubs', ingredientId, actor),
  recipeExportBundle: (actor) => invoke('recipe:exportBundle', actor),
  recipeImportBundle: (bundle, actor) => invoke('recipe:importBundle', bundle, actor),
  recipeAccessList: (actor) => invoke('recipe:accessList', actor),
  recipeListUsers: (actor) => invoke('recipe:listUsers', actor),
  recipeSetAccess: (data, actor) => invoke('recipe:setAccess', data, actor),
  recipeRemoveAccess: (userId, actor) => invoke('recipe:removeAccess', userId, actor),
  recipeIngredients: (filters, actor) => invoke('recipe:ingredients', filters, actor),
  recipeIngredient: (id, actor) => invoke('recipe:ingredient', id, actor),
  recipeList: (filters, actor) => invoke('recipe:list', filters, actor),
  recipeGet: (id, actor) => invoke('recipe:get', id, actor),
  recipeSave: (data, actor) => invoke('recipe:save', data, actor),
  recipeSubmit: (id, actor) => invoke('recipe:submit', id, actor),
  recipeApprove: (id, actor) => invoke('recipe:approve', id, actor),
  recipeReject: (id, notes, actor) => invoke('recipe:reject', id, notes, actor),
  recipeArchive: (id, actor) => invoke('recipe:archive', id, actor),
  recipeDelete: (id, actor) => invoke('recipe:delete', id, actor),
  recipeCreateProduct: (id, data, actor) => invoke('recipe:createProduct', id, data, actor),
  recipeCalcCosting: (items, opts, actor) => invoke('recipe:calcCosting', items, opts, actor),
  recipeCapacity: (id, actor) => invoke('recipe:capacity', id, actor),
  recipePlanProduction: (data, actor) => invoke('recipe:planProduction', data, actor),
  recipeCompleteProduction: (data, actor) => invoke('recipe:completeProduction', data, actor),
  recipeBatches: (filters, actor) => invoke('recipe:batches', filters, actor),
  recipeRestock: (id, qty, actor) => invoke('recipe:restock', id, qty, actor),
  recipeWasteList: (filters, actor) => invoke('recipe:wasteList', filters, actor),
  recipeWasteRecord: (data, actor) => invoke('recipe:wasteRecord', data, actor),
  recipeWasteApprove: (id, actor) => invoke('recipe:wasteApprove', id, actor),
  recipeWasteReject: (id, actor) => invoke('recipe:wasteReject', id, actor),
  recipeWasteUpdate: (id, data, actor) => invoke('recipe:wasteUpdate', id, data, actor),
  recipeWasteDelete: (id, actor) => invoke('recipe:wasteDelete', id, actor),
  recipeProductionMeals: (actor) => invoke('recipe:productionMeals', actor),
  recipeIngredientStockHistory: (filters, actor) => invoke('recipe:ingredientStockHistory', filters, actor),
  recipeProfitsLosses: (filters, actor) => invoke('recipe:profitsLosses', filters, actor),
  recipeListPurchaseOrders: (filters, actor) => invoke('recipe:listPurchaseOrders', filters, actor),
  recipeEnsureMealProfile: (productId, actor) => invoke('recipe:ensureMealProfile', productId, actor),
  recipePromos: (actor) => invoke('recipe:promos', actor),
  recipePromoSave: (data, actor) => invoke('recipe:promoSave', data, actor),
  recipeDashboard: (actor) => invoke('recipe:dashboard', actor),
  recipeReports: (type, filters, actor) => invoke('recipe:reports', type, filters, actor),
  recipeAi: (actor) => invoke('recipe:ai', actor),
  recipeApplySuggestedPrice: (data, actor) => invoke('recipe:applySuggestedPrice', data, actor),
  recipeActivity: (limit, actor) => invoke('recipe:activity', limit, actor),
  recipeBestSellers: (period, actor) => invoke('recipe:bestSellers', period, actor),
  recipeSetAvailableToday: (ids, actor) => invoke('recipe:setAvailableToday', ids, actor),
  recipeRequestSub: (data, actor) => invoke('recipe:requestSub', data, actor),
  recipeListSubs: (filters, actor) => invoke('recipe:listSubs', filters, actor),
  recipeApproveSub: (id, actor) => invoke('recipe:approveSub', id, actor),
  recipeRejectSub: (id, actor) => invoke('recipe:rejectSub', id, actor),
  recipeForecast: (days, actor) => invoke('recipe:forecast', days, actor),
  recipeMealProducts: (filters, actor) => invoke('recipe:mealProducts', filters, actor),
  recipeGetMeal: (id, actor) => invoke('recipe:getMeal', id, actor),
  recipeSaveMeal: (data, actor) => invoke('recipe:saveMeal', data, actor),
  recipeRestockIngredient: (data, actor) => invoke('recipe:restockIngredient', data, actor),
  recipeEnsureIngredient: (data, actor) => invoke('recipe:ensureIngredient', data, actor),
  recipeUpdateIngredient: (data, actor) => invoke('recipe:updateIngredient', data, actor),
  recipeDeleteIngredient: (id, actor) => invoke('recipe:deleteIngredient', id, actor),
  recipeRestockPlan: (targetMeals, actor) => invoke('recipe:restockPlan', targetMeals, actor),
  recipeSetPosMenuFlags: (data, actor) => invoke('recipe:setPosMenuFlags', data, actor),
  recipeRestockList: (actor) => invoke('recipe:restockList', actor),
  saveOtherSellItem: (data, actor) => invoke('products:saveOtherSell', data, actor),
  suggestSellPrice: (cost, pct) => invoke('products:suggestPrice', cost, pct),
  recipeProductionAvailability: (productId, actor) => invoke('recipe:productionAvailability', productId, actor),
  recipeProductionDashboard: (actor) => invoke('recipe:productionDashboard', actor),
  recipeRefreshProduction: (actor) => invoke('recipe:refreshProduction', actor),
  recipeProductRestock: (productId, targetQty, actor) => invoke('recipe:productRestock', productId, targetQty, actor),

  getFlyers: (filters) => invoke('flyers:get', filters),
  getFlyer: (id) => invoke('flyers:getOne', id),
  saveFlyer: (data, actor) => invoke('flyers:save', data, actor),
  deleteFlyer: (id, actor) => invoke('flyers:delete', id, actor),
  duplicateFlyer: (id, actor) => invoke('flyers:duplicate', id, actor),
  getFlyerTemplates: () => invoke('flyers:templates'),
  saveFlyerTemplate: (data, actor) => invoke('flyers:saveTemplate', data, actor),
  getFlyerPdf: (id, sizeOverride) => invoke('flyers:pdf', id, sizeOverride || null),
  applyFlyerPosPrices: (id, actor) => invoke('flyers:applyPosPrices', id, actor),
  restoreFlyerPrices: (id, actor) => invoke('flyers:restorePrices', id, actor),
  submitFlyerApproval: (id, actor) => invoke('flyers:submitApproval', id, actor),
  approveFlyer: (id, actor) => invoke('flyers:approve', id, actor),
  rejectFlyer: (id, actor, notes) => invoke('flyers:reject', id, actor, notes),
  getFlyerAnalytics: (id) => invoke('flyers:analytics', id),
  getSmartPromotionSuggestions: (filters, actor) => invoke('flyers:smartSuggestions', filters, actor),
  bulkUpdateFlyerPrices: (id, updates, actor) => invoke('flyers:bulkPrices', id, updates, actor),
  recordFlyerEvent: (id, eventType) => invoke('flyers:recordEvent', id, eventType),
  getBrandKit: () => invoke('flyers:brandKit'),
  saveBrandKit: (data, actor) => invoke('flyers:saveBrandKit', data, actor),
  goLiveFlyer: (id, actor) => invoke('flyers:goLive', id, actor),
  endCampaign: (id, actor) => invoke('flyers:endCampaign', id, actor),
  getActiveCampaigns: (branchId) => invoke('flyers:activeCampaigns', branchId),
  getCampaignDashboard: () => invoke('flyers:dashboard'),
  shareFlyerCampaign: (id, options, actor) => invoke('flyers:share', id, options, actor),

  mktAgents: (f, actor) => invoke('mkt:agents', f, actor),
  mktSaveAgent: (userId, data, actor) => invoke('mkt:saveAgent', userId, data, actor),
  mktSetAgentStatus: (id, status, actor) => invoke('mkt:setAgentStatus', id, status, actor),
  mktIssueToken: (id, hours, deviceId, actor) => invoke('mkt:issueToken', id, hours, deviceId, actor),
  mktRevokeToken: (tokenId, actor) => invoke('mkt:revokeToken', tokenId, actor),
  mktListTokens: (agentId, actor) => invoke('mkt:listTokens', agentId, actor),
  mktLoginToken: (token, deviceId) => invoke('mkt:loginToken', token, deviceId),
  mktDashboard: (actor) => invoke('mkt:dashboard', actor),
  mktAdminSummary: (f, actor) => invoke('mkt:adminSummary', f, actor),
  mktScorecard: (agentId, actor) => invoke('mkt:scorecard', agentId, actor),
  mktTasks: (f, actor) => invoke('mkt:tasks', f, actor),
  mktSaveTask: (data, actor) => invoke('mkt:saveTask', data, actor),
  mktCustomers: (f, actor) => invoke('mkt:customers', f, actor),
  mktSaveCustomer: (data, actor) => invoke('mkt:saveCustomer', data, actor),
  mktConvertCustomer: (id, total, actor) => invoke('mkt:convertCustomer', id, total, actor),
  mktRecruitmentStats: (f, actor) => invoke('mkt:recruitmentStats', f, actor),
  mktCampaigns: (f, actor) => invoke('mkt:campaigns', f, actor),
  mktSaveCampaign: (data, actor) => invoke('mkt:saveCampaign', data, actor),
  mktSubmitCampaign: (id, actor) => invoke('mkt:submitCampaign', id, actor),
  mktApproveCampaign: (id, approve, notes, actor) => invoke('mkt:approveCampaign', id, approve, notes, actor),
  mktMenus: (f, actor) => invoke('mkt:menus', f, actor),
  mktGetMenu: (id, actor) => invoke('mkt:getMenu', id, actor),
  mktSaveMenu: (data, actor) => invoke('mkt:saveMenu', data, actor),
  mktSubmitMenu: (id, actor) => invoke('mkt:submitMenu', id, actor),
  mktReviewMenu: (id, approve, notes, actor) => invoke('mkt:reviewMenu', id, approve, notes, actor),
  mktUpdateMenuPrices: (id, actor) => invoke('mkt:updateMenuPrices', id, actor),
  mktMsgTemplates: () => invoke('mkt:msgTemplates'),
  mktMessages: (f, actor) => invoke('mkt:messages', f, actor),
  mktSaveMessage: (data, actor) => invoke('mkt:saveMessage', data, actor),
  mktSaveReport: (data, actor) => invoke('mkt:saveReport', data, actor),
  mktReports: (f, actor) => invoke('mkt:reports', f, actor),
  mktRespondReport: (id, response, actor) => invoke('mkt:respondReport', id, response, actor),
  mktSaveFeedback: (data, actor) => invoke('mkt:saveFeedback', data, actor),
  mktFeedback: (f, actor) => invoke('mkt:feedback', f, actor),
  mktMedia: (actor) => invoke('mkt:media', actor),
  mktSaveMedia: (data, actor) => invoke('mkt:saveMedia', data, actor),
  mktSetMediaStatus: (id, status, actor) => invoke('mkt:setMediaStatus', id, status, actor),
  mktNotifications: (actor) => invoke('mkt:notifications', actor),
  mktReadNotification: (id, actor) => invoke('mkt:readNotification', id, actor),
  mktSyncStatus: () => invoke('mkt:syncStatus'),
  mktProcessSync: (actor) => invoke('mkt:processSync', actor),
  mktSyncConflicts: (actor) => invoke('mkt:syncConflicts', actor),
  mktResolveConflict: (id, keep, actor) => invoke('mkt:resolveConflict', id, keep, actor),
  mktAudit: (f, actor) => invoke('mkt:audit', f, actor),
  mktProducts: (f, actor) => invoke('mkt:products', f, actor),
  mktBrandKit: (actor) => invoke('mkt:brandKit', actor),
  mktProductCards: (ids) => invoke('mkt:productCards', ids),
  mktDigitalMenu: (slug, actor) => invoke('mkt:digitalMenu', slug, actor),
  mktMenuPrintHtml: (id, actor) => invoke('mkt:menuPrintHtml', id, actor),
  mktMenuTemplates: (actor) => invoke('mkt:menuTemplates', actor),
  mktSaveMenuTemplate: (data, actor) => invoke('mkt:saveMenuTemplate', data, actor),

  getWhatsAppTemplates: (filters) => invoke('whatsapp:getTemplates', filters),
  getWhatsAppTemplate: (id) => invoke('whatsapp:getTemplate', id),
  saveWhatsAppTemplate: (data, actor) => invoke('whatsapp:saveTemplate', data, actor),
  deleteWhatsAppTemplate: (id, actor) => invoke('whatsapp:deleteTemplate', id, actor),
  getWhatsAppMessages: (filters) => invoke('whatsapp:getMessages', filters),
  sendWhatsAppMessage: (data, actor) => invoke('whatsapp:send', data, actor),
  markWhatsAppOpened: (id, actor) => invoke('whatsapp:markOpened', id, actor),
  getWhatsAppAudience: (filter) => invoke('whatsapp:getAudience', filter),
  getWhatsAppCampaigns: (filters) => invoke('whatsapp:getCampaigns', filters),
  getWhatsAppCampaign: (id) => invoke('whatsapp:getCampaign', id),
  saveWhatsAppCampaign: (data, actor) => invoke('whatsapp:saveCampaign', data, actor),
  deleteWhatsAppCampaign: (id, actor) => invoke('whatsapp:deleteCampaign', id, actor),
  sendWhatsAppCampaign: (id, actor) => invoke('whatsapp:sendCampaign', id, actor),
  getWhatsAppSettings: () => invoke('whatsapp:getSettings'),
  saveWhatsAppSettings: (data, actor) => invoke('whatsapp:saveSettings', data, actor),

  getDocuments: (filters) => invoke('documentHub:get', filters),
  getDocument: (id) => invoke('documentHub:getOne', id),
  saveDocument: (data, actor) => invoke('documentHub:save', data, actor),
  deleteDocument: (id, actor) => invoke('documentHub:delete', id, actor),
  shareDocument: (id, options, actor) => invoke('documentHub:share', id, options, actor),
  exportDocumentStatus: (id, actor) => invoke('documentHub:exportStatus', id, actor),
  processScheduledDocuments: () => invoke('documentHub:processScheduled'),
  syncFlyerToHub: (flyerId, options) => invoke('documentHub:syncFlyer', flyerId, options),

  getCustomerRewardRules: () => invoke('rewards:getRules'),
  saveCustomerRewardRule: (data, actor) => invoke('rewards:saveRule', data, actor),
  deleteCustomerRewardRule: (id, actor) => invoke('rewards:deleteRule', id, actor),

  getBranches: () => invoke('branches:get'),
  getActiveBranch: () => invoke('branches:getActive'),
  saveBranch: (data) => invoke('branches:save', data),
  setActiveBranch: (branchId) => invoke('branches:setActive', branchId),
  getSyncStatus: () => ({ success: true, data: { enabled: false, registered: false, removed: true, mode: (window.__SHOP_POS_CLOUD__ ? 'cloud' : 'local') } }),
  saveSyncSettings: async () => ({ success: false, error: 'Sync hub removed — local tills stay on this device; set SHOP_POS_RPC_URL for cloud' }),
  registerSyncDevice: async () => ({ success: false, error: 'Sync hub removed' }),
  syncNow: async () => ({ success: true, data: { pushed: 0, newOrders: 0 } }),
  publishProductsToHub: async () => ({ success: false, error: 'Sync hub removed' }),
  syncBranchesToHub: async () => ({ success: false, error: 'Sync hub removed' }),
  getOnlineOrdersLocal: async () => ({ success: true, data: [] }),
  updateOnlineOrderStatus: async () => ({ success: false, error: 'Online ordering removed' }),
  acceptOnlineOrderAsSale: async () => ({ success: false, error: 'Online ordering removed' })
};

window.API = API;

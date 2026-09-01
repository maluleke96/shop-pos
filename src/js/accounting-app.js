/**
 * Accounting & Bookkeeping Panel — central ledger UI
 * Export: window.AccountingApp
 */
const AccountingApp = {
  view: 'login',
  section: 'dashboard',
  user: null,
  container: null,
  app: null,
  filters: { from: '', to: '', branchId: '', range: 'month' },
  loginError: '',
  loginLockout: '',
  _cache: {},
  _exportCache: {},
  _delegated: false,
  _navOpen: false,

  NAV: [
    ['Dashboard', [['dashboard', 'Dashboard']]],
    ['Sales', [
      ['invoices', 'Invoices'], ['receipts', 'Receipts'], ['credit-notes', 'Credit Notes'],
      ['refunds', 'Refunds'], ['customer-payments', 'Customer Payments']
    ]],
    ['Purchases', [
      ['purchase-orders', 'Purchase Orders'], ['supplier-bills', 'Supplier Bills'],
      ['supplier-payments', 'Supplier Payments'], ['debit-notes', 'Debit Notes']
    ]],
    ['Banking', [
      ['bank-accounts', 'Bank Accounts'], ['bank-transactions', 'Bank Transactions'],
      ['bank-reconciliation', 'Bank Reconciliation']
    ]],
    ['Cash', [['cashbook', 'Cashbook'], ['cash-up', 'Cash Up'], ['petty-cash', 'Petty Cash']]],
    ['Inventory', [
      ['stock-value', 'Stock Value'], ['stock-movement', 'Stock Movement'],
      ['cogs', 'Cost of Goods Sold'], ['stock-adjustments', 'Stock Adjustments']
    ]],
    ['Expenses', [
      ['expenses', 'Expenses'], ['recurring-expenses', 'Recurring Expenses'],
      ['expense-approvals', 'Expense Approvals']
    ]],
    ['Customers', [
      ['receivable', 'Receivable'], ['customer-statements', 'Customer Statements'],
      ['ar-aging', 'AR Aging']
    ]],
    ['Suppliers', [
      ['payable', 'Payable'], ['supplier-statements', 'Supplier Statements'],
      ['ap-aging', 'AP Aging']
    ]],
    ['Accounting', [
      ['chart-of-accounts', 'Chart of Accounts'], ['general-ledger', 'General Ledger'],
      ['journals', 'Journals'], ['trial-balance', 'Trial Balance'], ['periods', 'Periods']
    ]],
    ['Assets', [['asset-register', 'Asset Register'], ['depreciation', 'Depreciation']]],
    ['Tax', [['vat-tax', 'VAT / Tax'], ['tax-reports', 'Tax Reports']]],
    ['Finance', [
      ['other-income', 'Other Income'], ['loans', 'Loans'], ['owner-equity', 'Owner Equity']
    ]],
    ['Payroll', [
      ['payroll-employees', 'Employees'], ['payroll-runs', 'Payroll Runs'],
      ['payroll-liabilities', 'Payroll Liabilities']
    ]],
    ['Reports', [
      ['pnl', 'Profit & Loss'], ['balance-sheet', 'Balance Sheet'], ['cash-flow', 'Cash Flow'],
      ['report-sales', 'Sales Report'], ['report-purchases', 'Purchases Report'],
      ['report-expenses', 'Expenses Report'], ['report-stock', 'Stock Report'],
      ['financial-reports', 'Financial Reports']
    ]],
    ['Documents', [['all-documents', 'All Documents'], ['ocr-capture', 'OCR Capture']]],
    ['Reconciliation', [['reconciliation', 'Reconciliation']]],
    ['Approvals', [['approvals', 'Approvals']]],
    ['Audit', [['audit-log', 'Audit Log']]],
    ['Integrations', [['integrations', 'Integrations']]],
    ['Administration', [['users-permissions', 'Users & Permissions'], ['settings', 'Settings']]]
  ],

  SECTION_META: {
    dashboard: ['Dashboard', 'Financial overview, KPIs and quick actions.'],
    invoices: ['Invoices', 'Customer sales invoices — draft, post and track payment.'],
    receipts: ['Receipts', 'Point-of-sale and manual customer receipts.'],
    'credit-notes': ['Credit Notes', 'Credits issued against customer invoices.'],
    refunds: ['Refunds', 'Customer refund transactions.'],
    'customer-payments': ['Customer Payments', 'Receipts allocated to open invoices.'],
    'purchase-orders': ['Purchase Orders', 'Supplier purchase orders before billing.'],
    'supplier-bills': ['Supplier Bills', 'Accounts payable bills from suppliers.'],
    'supplier-payments': ['Supplier Payments', 'Payments made to suppliers.'],
    'debit-notes': ['Debit Notes', 'Debit adjustments on supplier accounts.'],
    'bank-accounts': ['Bank Accounts', 'Linked bank and merchant accounts.'],
    'bank-transactions': ['Bank Transactions', 'Imported and manual bank lines.'],
    'bank-reconciliation': ['Bank Reconciliation', 'Match bank lines to ledger entries.'],
    cashbook: ['Cashbook', 'Daily cash movements in and out.'],
    'cash-up': ['Cash Up', 'Till cash-up reconciliation vs POS.'],
    'petty-cash': ['Petty Cash', 'Petty cash float and reimbursements.'],
    'stock-value': ['Stock Value', 'Inventory valuation at cost and retail.'],
    'stock-movement': ['Stock Movement', 'Stock in, out and transfers.'],
    cogs: ['Cost of Goods Sold', 'COGS by period and category.'],
    'stock-adjustments': ['Stock Adjustments', 'Write-offs, shrinkage and corrections.'],
    expenses: ['Expenses', 'Operating expenses and bills.'],
    'recurring-expenses': ['Recurring Expenses', 'Scheduled repeating expenses.'],
    'expense-approvals': ['Expense Approvals', 'Expenses awaiting manager approval.'],
    receivable: ['Accounts Receivable', 'Outstanding customer balances.'],
    'customer-statements': ['Customer Statements', 'Generate and send customer statements.'],
    'ar-aging': ['AR Aging', 'Receivables ageing by bucket.'],
    payable: ['Accounts Payable', 'Outstanding supplier balances.'],
    'supplier-statements': ['Supplier Statements', 'Supplier account activity.'],
    'ap-aging': ['AP Aging', 'Payables ageing by bucket.'],
    'chart-of-accounts': ['Chart of Accounts', 'Account codes, types and balances.'],
    'general-ledger': ['General Ledger', 'Posted ledger lines by account.'],
    journals: ['Journals', 'Manual journal entries — draft, post, reverse.'],
    'trial-balance': ['Trial Balance', 'Debit and credit trial balance.'],
    periods: ['Accounting Periods', 'Open, close periods and year-end.'],
    'asset-register': ['Asset Register', 'Fixed assets and carrying values.'],
    depreciation: ['Depreciation', 'Depreciation runs and schedules.'],
    'vat-tax': ['VAT / Tax', 'Tax rates, codes and configuration.'],
    'tax-reports': ['Tax Reports', 'VAT and tax summary returns.'],
    'other-income': ['Other Income', 'Non-sales income — grants, interest, misc receipts.'],
    loans: ['Loans', 'Business loans and repayment tracking.'],
    'owner-equity': ['Owner Equity', 'Capital contributions, drawings and owner loans.'],
    'payroll-employees': ['Payroll Employees', 'Staff on payroll for accounting.'],
    'payroll-runs': ['Payroll Runs', 'Processed payroll batches.'],
    'payroll-liabilities': ['Payroll Liabilities', 'PAYE, UIF and other liabilities.'],
    pnl: ['Profit & Loss', 'Income statement for the selected period.'],
    'balance-sheet': ['Balance Sheet', 'Assets, liabilities and equity snapshot.'],
    'cash-flow': ['Cash Flow', 'Operating, investing and financing cash flows.'],
    'report-sales': ['Sales Report', 'Sales breakdown by product, branch and period.'],
    'report-purchases': ['Purchases Report', 'Purchases by supplier and category.'],
    'report-expenses': ['Expenses Report', 'Expense analysis by account and branch.'],
    'report-stock': ['Stock Report', 'Stock valuation and movement summary.'],
    'financial-reports': ['Financial Reports', 'Packaged financial report exports.'],
    'all-documents': ['All Documents', 'Invoices, bills, receipts and attachments.'],
    'ocr-capture': ['OCR Capture', 'Scan and confirm supplier documents.'],
    reconciliation: ['Reconciliation', 'Cross-module reconciliation workspace.'],
    approvals: ['Approvals', 'Pending financial approvals queue.'],
    'audit-log': ['Audit Log', 'Privileged accounting actions and changes.'],
    integrations: ['Integrations', 'Sync errors and integration retries.'],
    'users-permissions': ['Users & Permissions', 'Accounting module access control.'],
    settings: ['Settings', 'Accounting basis, currency, numbering and defaults.']
  },

  LIST_CFG: {
    invoices: { api: 'accInvoices', save: 'accSaveInvoice', post: 'accPostInvoice', type: 'invoice', cols: ['Date', 'Number', 'Customer', 'Amount', 'Status'], newLabel: 'New Invoice' },
    receipts: { api: 'accInvoices', save: 'accSaveInvoice', type: 'receipt', cols: ['Date', 'Number', 'Customer', 'Amount', 'Status'], newLabel: 'New Receipt' },
    'credit-notes': { api: 'accCreditNotes', save: 'accSaveCreditNote', post: 'accPostCreditNote', type: 'credit_note', cols: ['Date', 'Number', 'Customer', 'Amount', 'Status'], newLabel: 'New Credit Note' },
    refunds: { api: 'accRefunds', save: 'accSavePayment', type: 'refund', cols: ['Date', 'Reference', 'Customer', 'Amount', 'Status'], newLabel: 'New Refund' },
    'customer-payments': { api: 'accPayments', save: 'accSavePayment', type: 'customer', cols: ['Date', 'Reference', 'Customer', 'Amount', 'Status'], newLabel: 'Record Payment' },
    'purchase-orders': { api: 'accPurchaseOrders', save: 'accSaveBill', type: 'purchase_order', cols: ['Date', 'PO #', 'Supplier', 'Amount', 'Status'], newLabel: 'New PO' },
    'supplier-bills': { api: 'accBills', save: 'accSaveBill', post: 'accPostBill', type: 'bill', cols: ['Date', 'Bill #', 'Supplier', 'Amount', 'Status'], newLabel: 'New Bill' },
    'supplier-payments': { api: 'accPayments', save: 'accSavePayment', type: 'supplier', cols: ['Date', 'Reference', 'Supplier', 'Amount', 'Status'], newLabel: 'Pay Supplier' },
    'debit-notes': { api: 'accDebitNotes', save: 'accSaveDebitNote', post: 'accPostDebitNote', type: 'debit_note', cols: ['Date', 'Number', 'Supplier', 'Amount', 'Status'], newLabel: 'New Debit Note' },
    'bank-transactions': { api: 'accBankTxns', save: 'accSaveBankTxn', cols: ['Date', 'Account', 'Description', 'Amount', 'Status'], newLabel: 'Add Transaction' },
    expenses: { api: 'accExpenses', save: 'accRecordExpense', type: 'expense', cols: ['Date', 'Reference', 'Category', 'Amount', 'Status'], newLabel: 'New Expense' },
    'recurring-expenses': { api: 'accRecurring', save: 'accSaveRecurring', type: 'recurring', cols: ['Name', 'Frequency', 'Next Date', 'Amount', 'Status'], newLabel: 'Add Recurring' },
    'stock-adjustments': { api: 'accStockAdjustments', save: 'accRecordStockAdjustment', cols: ['Date', 'Product', 'Change', 'New stock', 'By'], newLabel: 'Adjust Stock' },
    'other-income': { api: 'accOtherIncome', save: 'accSaveOtherIncome', cols: ['Date', 'Type', 'Description', 'Amount', 'Status'], newLabel: 'Record Income' },
    loans: { api: 'accLoans', save: 'accSaveLoan', cols: ['Lender', 'Principal', 'Outstanding', 'Status', ''], newLabel: 'Add Loan' },
    'all-documents': { api: 'accDocuments', save: 'accSaveDocument', cols: ['Date', 'Type', 'Reference', 'Party', 'Amount'], newLabel: 'Upload Document' }
  },

  NEW_TXN: [
    ['invoice', 'Invoice', 'txn-invoice'],
    ['expense', 'Expense', 'txn-expense'],
    ['payment', 'Payment', 'txn-payment'],
    ['bill', 'Supplier Bill', 'txn-bill'],
    ['receipt', 'Customer Receipt', 'txn-receipt'],
    ['journal', 'Journal', 'txn-journal'],
    ['stock', 'Stock Adjustment', 'txn-stock'],
    ['bank', 'Bank Transaction', 'txn-bank'],
    ['credit', 'Credit Note', 'txn-credit'],
    ['debit', 'Debit Note', 'txn-debit']
  ],

  /* ─── Infrastructure ─────────────────────────────────────────────────── */

  ensureCss() {
    const href = 'css/accounting-command.css';
    if (typeof Utils !== 'undefined' && typeof Utils.loadStylesheet === 'function') {
      Utils.loadStylesheet(href).catch(() => {});
      return;
    }
    if (document.querySelector(`link[href="${href}"]`) || document.querySelector(`link[href$="/${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  },

  esc(v) {
    return (typeof Utils !== 'undefined' && Utils.escHtml) ? Utils.escHtml(v) : String(v ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  },

  money(n) {
    const c = this.app?.settings?.currency || 'R';
    return (typeof Utils !== 'undefined' && Utils.formatMoney) ? Utils.formatMoney(Number(n) || 0, c) : `${c}${(Number(n) || 0).toFixed(2)}`;
  },

  toast(msg, type) {
    if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(msg, type || 'info');
    else console.log(`[${type || 'info'}]`, msg);
  },

  today() {
    return (typeof Utils !== 'undefined' && Utils.today) ? Utils.today() : new Date().toLocaleDateString('en-CA');
  },

  monthStart() {
    if (typeof Utils !== 'undefined' && Utils.monthStart) return Utils.monthStart();
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  },

  quarterStart() {
    const d = new Date();
    const q = Math.floor(d.getMonth() / 3) * 3;
    return `${d.getFullYear()}-${String(q + 1).padStart(2, '0')}-01`;
  },

  yearStart() {
    return `${new Date().getFullYear()}-01-01`;
  },

  weekStart() {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toLocaleDateString('en-CA');
  },

  filterScope(extra = {}) {
    const f = { ...extra };
    if (this.filters.from) f.from = this.filters.from;
    if (this.filters.to) f.to = this.filters.to;
    if (this.filters.branchId) f.branch_id = parseInt(this.filters.branchId, 10);
    return f;
  },

  async apiCall(method, arg1, ...rest) {
    if (typeof API === 'undefined' || typeof API[method] !== 'function') return null;
    const noActor = new Set(['accLogin', 'accLogout', 'accSettings', 'accGetJournal', 'accGetInvoice']);
    const actor = this.user;
    const fallback = `${method} failed`;

    if (arg1 && typeof arg1 === 'object' && !Array.isArray(arg1)) {
      const scope = arg1;
      const from = scope.from || this.filters.from || this.monthStart();
      const to = scope.to || this.filters.to || this.today();
      const asOf = scope.as_of || scope.to || this.today();

      if (scope.id != null && !scope.lines && !scope.metric && !scope.customer_id && !scope.supplier_id) {
        if (method === 'accGetJournal') return this.apiOk(API.accGetJournal(scope.id), fallback);
        if (method === 'accGetStatement') return this.apiOk(API.accGetStatement(scope.id, actor), fallback);
        if (method === 'accReverseJournal') return this.apiOk(API.accReverseJournal(scope.id, actor), fallback);
        if (method === 'accPostInvoice' || method === 'accPostBill' || method === 'accPostCreditNote') {
          return this.apiOk(API[method](scope.id, actor), fallback);
        }
        if (method === 'accClosePeriod' || method === 'accReopenPeriod' || method === 'accLockPeriod') {
          return this.apiOk(API[method](scope.id, actor), fallback);
        }
        if (method === 'accRetryIntegration') return this.apiOk(API.accRetryIntegration(scope.id, actor), fallback);
        if (method === 'accMatchBankStmt') return this.apiOk(API.accMatchBankStmt(scope.id, scope.txn_id || null, actor), fallback);
        if (method === 'accPostJournal') return this.apiOk(API.accPublishJournal(scope.id, actor), fallback);
        if (method === 'accDecideApproval') {
          return this.apiOk(API.accDecideApproval(scope.id, scope.decision, scope.notes || '', actor), fallback);
        }
        if (method === 'accConfirmOcr') {
          return this.apiOk(API.accConfirmOcr(scope.id, { confirmed: scope.confirmed }, actor), fallback);
        }
      }

      if (method === 'accDrillDown') {
        return this.apiOk(API.accDrillDown(scope.metric || 'revenue', from, to, actor), fallback);
      }
      if (method === 'accCustomerStatement') {
        const id = scope.customer_id || scope.id;
        return this.apiOk(API.accCustomerStatement(id, from, to, actor), fallback);
      }
      if (method === 'accSupplierStatement') {
        const id = scope.supplier_id || scope.id;
        return this.apiOk(API.accSupplierStatement(id, from, to, actor), fallback);
      }
      if (method === 'accProfitLoss' || method === 'accCashFlow' || method === 'accTaxSummary') {
        return this.apiOk(API[method](from, to, actor), fallback);
      }
      if (method === 'accParseBankStmt') {
        return this.apiOk(API.accParseBankStmt(scope.text, scope.filename, scope.format, actor), fallback);
      }
      if (method === 'accSaveStatement') {
        return this.apiOk(API.accSaveStatement(scope, actor), fallback);
      }
      if (method === 'accStatements') {
        return this.apiOk(API.accStatements(scope, actor), fallback);
      }
      if (method === 'accTrialBalance' || method === 'accBalanceSheet' || method === 'accAgingAr' || method === 'accAgingAp' || method === 'accRunDepreciation') {
        return this.apiOk(API[method](asOf, actor), fallback);
      }
      const actorOnly = new Set([
        'accAssets', 'accTaxRates', 'accBankAccounts', 'accAccounts', 'accPeriods',
        'accRefunds', 'accPurchaseOrders', 'accRecurring', 'accPettyCash', 'accIntegrations',
        'accSyncMissing', 'accYearEnd'
      ]);
      if (actorOnly.has(method)) return this.apiOk(API[method](actor), fallback);
      return this.apiOk(API[method](scope, actor), fallback);
    }

    const callArgs = (method.startsWith('acc') && !noActor.has(method)) ? [arg1, ...rest, actor] : [arg1, ...rest];
    return this.apiOk(API[method](...callArgs), fallback);
  },

  async apiOk(promise, fallbackMsg) {
    let r;
    try {
      r = await promise;
    } catch (err) {
      this.toast(err?.message || fallbackMsg || 'Request failed', 'error');
      return null;
    }
    if (!r || r.success === false) {
      this.toast((r && (r.error || r.message)) || fallbackMsg || 'Request failed', 'error');
      return null;
    }
    return r.data !== undefined ? r.data : r;
  },

  async listApi(method, scope, msg) {
    const d = await this.apiCall(method, scope || this.filterScope());
    return Array.isArray(d) ? d : (Array.isArray(d?.rows) ? d.rows : (Array.isArray(d?.items) ? d.items : []));
  },

  val(id) { return (document.getElementById(id)?.value ?? '').trim(); },
  numVal(id, fb = 0) { const n = parseFloat(document.getElementById(id)?.value); return Number.isFinite(n) ? n : fb; },
  chk(id) { return !!document.getElementById(id)?.checked; },

  clearCache() { this._cache = {}; },

  companyInfo() {
    const s = this.app?.settings || {};
    return {
      name: s.business_name || s.company_name || s.shop_name || 'Business',
      address: s.address || s.business_address || '',
      phone: s.phone || s.business_phone || '',
      email: s.email || ''
    };
  },

  cacheExport(key, title, headers, rows) {
    this._exportCache[key || this.section] = { title, headers, rows: rows || [] };
  },

  exportBtns(key) {
    const k = key || this.section;
    return this.btn('Print', `print-${k}`) + this.btn('PDF', `export-${k}`);
  },

  async exportSection(key, mode) {
    const cache = this._exportCache[key || this.section];
    if (!cache?.rows?.length) {
      this.toast('Nothing to export — refresh the section first', 'warning');
      return;
    }
    if (typeof Export === 'undefined') {
      this.toast('Export module not loaded', 'error');
      return;
    }
    const title = cache.title || this.SECTION_META[this.section]?.[0] || 'Report';
    const filename = `${String(key || this.section).replace(/-/g, '_')}_${this.today()}`;
    try {
      if (mode === 'print') await Export.print(title, cache.headers, cache.rows, this.companyInfo());
      else await Export.toPDF(filename, title, cache.headers, cache.rows, this.companyInfo());
    } catch (_) { /* toast shown in Export */ }
  },

  pnlLines(data) {
    if (!data) return [];
    if (data.lines?.length) return data.lines;
    const lines = [];
    const push = (name, amount) => { if (amount) lines.push({ name, amount }); };
    push('Revenue', data.revenue);
    (data.accounts || []).filter((a) => a.type === 'income' && a.period_amount).forEach((a) => push(a.name, a.period_amount));
    push('Cost of Goods Sold', data.cogs);
    (data.accounts || []).filter((a) => a.type === 'cogs' && a.period_amount).forEach((a) => push(a.name, a.period_amount));
    push('Gross Profit', data.gross_profit);
    (data.accounts || []).filter((a) => a.type === 'expense' && a.period_amount).forEach((a) => push(a.name, a.period_amount));
    push('Net Profit', data.net_profit);
    return lines.filter((l) => l.amount != null && Math.abs(Number(l.amount)) >= 0.005);
  },

  balanceSheetSections(data) {
    if (!data) return [];
    if (data.sections?.length) return data.sections;
    return [
      { title: 'Assets', rows: (data.assets || []).map((a) => ({ name: `${a.code} — ${a.name}`, amount: a.balance })) },
      { title: 'Liabilities', rows: (data.liabilities || []).map((a) => ({ name: `${a.code} — ${a.name}`, amount: a.balance })) },
      { title: 'Equity', rows: (data.equity || []).map((a) => ({ name: `${a.code} — ${a.name}`, amount: a.balance })) }
    ];
  },

  cashFlowLines(data) {
    if (!data) return [];
    if (data.lines?.length) return data.lines;
    return [
      { category: 'Operating activities', inflow: data.operating > 0 ? data.operating : 0, outflow: data.operating < 0 ? Math.abs(data.operating) : 0, net: data.operating },
      { category: 'Investing activities', inflow: data.investing > 0 ? data.investing : 0, outflow: data.investing < 0 ? Math.abs(data.investing) : 0, net: data.investing },
      { category: 'Financing activities', inflow: data.financing > 0 ? data.financing : 0, outflow: data.financing < 0 ? Math.abs(data.financing) : 0, net: data.financing },
      { category: 'Net change in cash', inflow: data.net_change > 0 ? data.net_change : 0, outflow: data.net_change < 0 ? Math.abs(data.net_change) : 0, net: data.net_change },
      { category: 'Opening cash', inflow: data.opening_cash, outflow: 0, net: data.opening_cash },
      { category: 'Closing cash', inflow: data.closing_cash, outflow: 0, net: data.closing_cash }
    ];
  },

  agingBuckets(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (data.buckets?.length) return data.buckets;
    return [
      { bucket: 'Current', count: (data.rows || []).filter((r) => r.bucket === 'current').length, amount: data.current },
      { bucket: '1–30 days', count: (data.rows || []).filter((r) => r.bucket === 'd30').length, amount: data.d30 },
      { bucket: '31–60 days', count: (data.rows || []).filter((r) => r.bucket === 'd60').length, amount: data.d60 },
      { bucket: '61–90 days', count: (data.rows || []).filter((r) => r.bucket === 'd90').length, amount: data.d90 },
      { bucket: '90+ days', count: (data.rows || []).filter((r) => r.bucket === 'd120').length, amount: data.d120 }
    ];
  },

  groupAgingByParty(data, partyField) {
    const rows = data?.rows || (Array.isArray(data) ? data : []);
    const map = {};
    rows.forEach((r) => {
      const key = r[partyField] || r.customer_name || r.supplier_name || r.name || 'Unknown';
      if (!map[key]) map[key] = { name: key, current: 0, days_30: 0, days_60: 0, days_90: 0, total: 0 };
      const amt = Number(r.balance ?? r.amount ?? 0);
      const b = r.bucket || 'current';
      if (b === 'current') map[key].current += amt;
      else if (b === 'd30') map[key].days_30 += amt;
      else if (b === 'd60') map[key].days_60 += amt;
      else map[key].days_90 += amt;
      map[key].total += amt;
    });
    return Object.values(map);
  },

  shortNum(n) {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return String(Math.round(v * 100) / 100);
  },

  tag(text, cls) {
    return `<span class="acc-tag ${cls || ''}">${this.esc(text ?? '—')}</span>`;
  },

  statusTag(status) {
    const s = String(status || '').toLowerCase();
    const map = {
      posted: 'ok', paid: 'ok', approved: 'ok', active: 'ok', reconciled: 'ok', closed: 'ok',
      draft: 'muted', pending: 'warn', awaiting: 'warn', overdue: 'bad',
      rejected: 'bad', cancelled: 'bad', reversed: 'bad', void: 'bad'
    };
    return this.tag(status || '—', map[s] || 'info');
  },

  kpi(label, value, sub, cls, metric) {
    const click = metric ? ` data-acc-act="drill" data-metric="${this.esc(metric)}"` : '';
    return `<div class="acc-kpi ${cls || ''}${metric ? ' clickable' : ''}"${click}>
      <span class="acc-kpi-label">${this.esc(label)}</span>
      <span class="acc-kpi-value">${this.esc(value)}</span>
      ${sub ? `<span class="acc-kpi-sub">${this.esc(sub)}</span>` : ''}
    </div>`;
  },

  sectionHead(actionsHtml) {
    const [title, sub] = this.SECTION_META[this.section] || ['Accounting', ''];
    return `<div class="acc-section-head"><div>
      <h3 class="acc-page-title">${this.esc(title)}</h3>
      ${sub ? `<p class="acc-page-sub">${this.esc(sub)}</p>` : ''}
    </div>${actionsHtml ? `<div class="acc-actions">${actionsHtml}</div>` : ''}</div>`;
  },

  panel(title, bodyHtml, actionsHtml, flush) {
    return `<div class="acc-panel">
      ${title ? `<div class="acc-panel-h"><h4>${this.esc(title)}</h4>${actionsHtml ? `<div class="acc-actions">${actionsHtml}</div>` : ''}</div>` : ''}
      <div class="acc-panel-b${flush ? ' flush' : ''}">${bodyHtml}</div>
    </div>`;
  },

  table(headers, rowsHtml, emptyMsg) {
    if (!rowsHtml) return `<div class="acc-empty">${this.esc(emptyMsg || 'Nothing here yet')}</div>`;
    return `<div class="table-wrap acc-table"><table>
      <thead><tr>${headers.map((h) => `<th>${this.esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>`;
  },

  btn(label, act, data, cls) {
    const attrs = Object.entries(data || {}).map(([k, v]) => `data-${k}="${this.esc(v)}"`).join(' ');
    return `<button type="button" class="btn btn-sm ${cls || 'btn-ghost'}" data-acc-act="${this.esc(act)}" ${attrs}>${this.esc(label)}</button>`;
  },

  rowBtns(html) { return `<div class="acc-rowbtns">${html}</div>`; },

  fld(id, label, opts = {}) {
    const { type = 'text', value = '', options = null, rows = 0, full = false, attrs = '', placeholder = '', hint = '' } = opts;
    const cls = `field${full ? ' full' : ''}`;
    let input;
    if (options) {
      input = `<select id="${id}" ${attrs}>${options.map(([v, l]) =>
        `<option value="${this.esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${this.esc(l)}</option>`).join('')}</select>`;
    } else if (rows) {
      input = `<textarea id="${id}" rows="${rows}" placeholder="${this.esc(placeholder)}" ${attrs}>${this.esc(value)}</textarea>`;
    } else if (type === 'checkbox') {
      return `<div class="${cls}"><label><input type="checkbox" id="${id}" ${value ? 'checked' : ''} ${attrs}> ${this.esc(label)}</label></div>`;
    } else {
      input = `<input type="${type}" id="${id}" value="${this.esc(value)}" placeholder="${this.esc(placeholder)}" ${attrs}>`;
    }
    return `<div class="${cls}"><label>${this.esc(label)}</label>${input}${hint ? `<small class="muted">${this.esc(hint)}</small>` : ''}</div>`;
  },

  grid(fields) { return `<div class="form-grid">${fields.join('')}</div>`; },

  chart(rows, labelFn, valueFn) {
    if (!rows.length) return '<div class="acc-empty">No data for this period</div>';
    const vals = rows.map((r) => Number(valueFn(r)) || 0);
    const max = Math.max(...vals, 1);
    return `<div class="acc-chart">${rows.map((r, i) => `
      <div class="acc-bar-col">
        <span class="acc-bar-val">${this.esc(this.shortNum(vals[i]))}</span>
        <div class="acc-bar" style="height:${Math.max(2, Math.round((vals[i] / max) * 100))}%"></div>
        <span class="acc-bar-label">${this.esc(labelFn(r))}</span>
      </div>`).join('')}</div>`;
  },

  openForm(title, bodyHtml, onSave, saveLabel = 'Save') {
    if (typeof Utils?.showModal === 'function') {
      Utils.showModal(title, bodyHtml, `
        <button type="button" class="btn btn-ghost" id="acc-modal-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="acc-modal-save">${this.esc(saveLabel)}</button>`);
      document.getElementById('acc-modal-cancel')?.addEventListener('click', () => Utils.hideModal());
      const btn = document.getElementById('acc-modal-save');
      btn?.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const ok = await onSave();
          if (ok === false) return;
          Utils.hideModal();
          await this.refreshSection();
        } catch (err) {
          this.toast(err?.message || 'Save failed', 'error');
        } finally { btn.disabled = false; }
      });
      return;
    }
    const host = document.getElementById('acc-inline-form');
    if (host) {
      host.innerHTML = `<div class="acc-panel"><div class="acc-panel-h"><h4>${this.esc(title)}</h4></div>
        <div class="acc-panel-b">${bodyHtml}
        <div class="acc-actions" style="margin-top:12px">
          <button type="button" class="btn btn-ghost btn-sm" id="acc-inline-cancel">Cancel</button>
          <button type="button" class="btn btn-primary btn-sm" id="acc-inline-save">${this.esc(saveLabel)}</button>
        </div></div></div>`;
      document.getElementById('acc-inline-cancel')?.addEventListener('click', () => { host.innerHTML = ''; });
      document.getElementById('acc-inline-save')?.addEventListener('click', async () => {
        const ok = await onSave();
        if (ok !== false) { host.innerHTML = ''; await this.refreshSection(); }
      });
    }
  },

  openInfo(title, bodyHtml) {
    if (typeof Utils?.showModal === 'function') {
      Utils.showModal(title, bodyHtml, '<button type="button" class="btn btn-primary" id="acc-modal-close">Close</button>');
      document.getElementById('acc-modal-close')?.addEventListener('click', () => Utils.hideModal());
    } else {
      this.toast(title, 'info');
    }
  },

  navHtml() {
    return this.NAV.map(([group, items]) => `
      <div class="acc-nav-group">${this.esc(group)}</div>
      ${items.map(([id, label]) => `<button type="button" class="acc-nav-btn ${this.section === id ? 'active' : ''}"
        data-acc-act="nav" data-section="${id}"><span class="acc-nav-dot"></span><span>${this.esc(label)}</span></button>`).join('')}`).join('');
  },

  /* ─── Lifecycle ──────────────────────────────────────────────────────── */

  async render(root, parentApp) {
    this.container = root || this.container;
    this.app = parentApp || this.app;
    if (!this.container) return;
    this.ensureCss();
    if (!this.filters.from) this.filters.from = this.monthStart();
    if (!this.filters.to) this.filters.to = this.today();
    if (this.view === 'login' && !this.user) {
      this.renderLogin();
      return;
    }
    this.view = 'app';
    await this.renderShell();
  },

  renderLogin() {
    this.container.innerHTML = `<div class="acc-root acc-login-wrap">
      <div class="acc-login-card">
        <div class="acc-brand-mark">AC</div>
        <p class="acc-login-eyebrow">Accounting &amp; Bookkeeping</p>
        <h1>Bookkeeping &amp; Finance</h1>
        <p class="acc-login-sub">Sign in to manage invoices, expenses, banking, reports and your chart of accounts.</p>
        ${this.loginLockout ? `<div class="acc-login-lockout">${this.esc(this.loginLockout)}</div>` : ''}
        ${this.loginError ? `<div class="acc-login-error">${this.esc(this.loginError)}</div>` : ''}
        ${this.grid([
          this.fld('acc-login-user', 'Username', { placeholder: 'Your username', full: true }),
          this.fld('acc-login-pass', 'Password', { type: 'password', placeholder: '••••••••', full: true })
        ])}
        <div class="acc-login-actions">
          <button type="button" class="btn btn-primary btn-block" data-acc-act="login-submit">Sign In</button>
          <button type="button" class="btn btn-ghost btn-block" data-acc-act="login-forgot">Forgot password</button>
        </div>
      </div>
    </div>`;
    this.bindActions();
    document.getElementById('acc-login-pass')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.doLogin();
    });
  },

  async doLogin() {
    const username = this.val('acc-login-user');
    const password = this.val('acc-login-pass');
    this.loginError = '';
    this.loginLockout = '';
    if (!username || !password) {
      this.loginError = 'Enter username and password.';
      this.renderLogin();
      return;
    }
    let r;
    try {
      r = typeof API !== 'undefined' && API.accLogin ? await API.accLogin(username, password) : null;
    } catch (err) {
      this.loginError = err?.message || 'Login failed';
      this.renderLogin();
      return;
    }
    if (!r) {
      this.loginError = 'Accounting login is not available yet.';
      this.renderLogin();
      return;
    }
    if (r.locked || r.lockout) {
      this.loginLockout = r.message || r.error || 'Account locked. Try again later or contact the owner.';
      this.renderLogin();
      return;
    }
    if (r.success === false) {
      this.loginError = r.error || r.message || 'Invalid username or password.';
      this.renderLogin();
      return;
    }
    this.user = r.data || r.user || r;
    this.view = 'app';
    this.toast(`Welcome, ${this.user.full_name || this.user.username || 'User'}`, 'success');
    try {
      const sync = await this.apiCall('accSyncMissing');
      if (sync?.synced > 0) this.toast(`Synced ${sync.synced} historical records into accounting`, 'info');
    } catch (_) { /* non-blocking */ }
    await this.renderShell();
  },

  async renderShell() {
    const name = this.user?.full_name || this.user?.username || 'User';
    this.container.innerHTML = `<div class="acc-root">
      <div class="acc-shell${this._navOpen ? ' acc-nav-open' : ''}">
        <div class="acc-sidebar-backdrop" data-acc-act="nav-close"></div>
        <aside class="acc-sidebar">
          <div class="acc-brand">
            <div class="acc-brand-mark">AC</div>
            <div class="acc-brand-text"><strong>Accounting</strong><small>Bookkeeping &amp; Finance</small></div>
          </div>
          <nav class="acc-nav" id="acc-nav">${this.navHtml()}</nav>
        </aside>
        <div class="acc-main-wrap">
          <header class="acc-topbar">
            <button type="button" class="btn btn-ghost btn-sm acc-menu-toggle" data-acc-act="nav-toggle">☰</button>
            <span class="acc-topbar-brand">Accounting</span>
            <div class="acc-search-wrap field">
              <label for="acc-global-search">Search</label>
              <input type="search" id="acc-global-search" placeholder="Accounts, invoices, journals…">
            </div>
            <div class="acc-dropdown-wrap" id="acc-new-txn-wrap">
              <button type="button" class="btn btn-primary btn-sm" data-acc-act="new-txn-toggle">+ NEW TRANSACTION ▾</button>
              <div class="acc-dropdown-menu">
                ${this.NEW_TXN.map(([, label, act]) =>
                  `<button type="button" class="acc-dropdown-item" data-acc-act="${act}">${this.esc(label)}</button>`).join('')}
              </div>
            </div>
            <div class="acc-topbar-spacer"></div>
            <span class="acc-user-chip"><span class="acc-user-dot"></span>${this.esc(name)}</span>
            <button type="button" class="btn btn-ghost btn-sm" data-acc-act="close">Close</button>
          </header>
          <main class="acc-main" id="acc-body"><p class="muted">Loading…</p></main>
        </div>
      </div>
    </div>`;
    this.bindActions();
    document.getElementById('acc-global-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.doGlobalSearch(this.val('acc-global-search'));
    });
    await this.refreshSection();
  },

  bindActions() {
    if (this._delegated) return;
    this._delegated = true;
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest?.('[data-acc-act]');
      if (!btn) return;
      const inRoot = !!btn.closest('.acc-root');
      const inModal = !!btn.closest('#modal-overlay');
      if (!inRoot && !inModal) return;
      const act = btn.dataset.accAct || '';
      let fn = this.ACT[act];
      if (!fn) {
        if (act.startsWith('export-')) fn = () => this.exportSection(act.slice(7), 'pdf');
        else if (act.startsWith('print-')) fn = () => this.exportSection(act.slice(6), 'print');
      }
      if (!fn) return;
      e.preventDefault();
      const wasDisabled = btn.disabled;
      btn.disabled = true;
      try { await fn.call(this, { ...btn.dataset }, btn); }
      catch (err) { this.toast(err?.message || 'Action failed', 'error'); }
      finally { if (!wasDisabled && btn.isConnected) btn.disabled = false; }
    });
  },

  async refreshSection() {
    const nav = document.getElementById('acc-nav');
    if (nav) nav.innerHTML = this.navHtml();
    await this.renderSection();
  },

  closeApp() {
    this._navOpen = false;
    if (typeof this.app?.closeAccounting === 'function') {
      this.app.closeAccounting();
      return;
    }
    this.user = null;
    this.view = 'login';
    this.render(this.container, this.app);
  },

  setRange(preset) {
    this.filters.range = preset;
    const t = this.today();
    if (preset === 'today') { this.filters.from = t; this.filters.to = t; }
    else if (preset === 'week') { this.filters.from = this.weekStart(); this.filters.to = t; }
    else if (preset === 'month') { this.filters.from = this.monthStart(); this.filters.to = t; }
    else if (preset === 'quarter') { this.filters.from = this.quarterStart(); this.filters.to = t; }
    else if (preset === 'year') { this.filters.from = this.yearStart(); this.filters.to = t; }
    this.clearCache();
    this.refreshSection();
  },

  rangeBarHtml() {
    const presets = [['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year'], ['custom', 'Custom']];
    return `<div class="acc-range-bar">${presets.map(([k, l]) =>
      `<button type="button" class="acc-range-btn ${this.filters.range === k ? 'active' : ''}" data-acc-act="range" data-preset="${k}">${l}</button>`).join('')}
      ${this.filters.range === 'custom' ? `<span style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-left:8px">
        ${this.fld('acc-f-from', 'From', { type: 'date', value: this.filters.from })}
        ${this.fld('acc-f-to', 'To', { type: 'date', value: this.filters.to })}
        ${this.btn('Apply', 'apply-range', {}, 'btn-primary')}
      </span>` : ''}</div>`;
  },

  filterBarHtml(extraFields = '') {
    return `<div class="acc-filter-bar">
      ${this.fld('acc-filter-branch', 'Branch', { value: this.filters.branchId, options: [['', 'All branches']] })}
      ${this.fld('acc-filter-from', 'From', { type: 'date', value: this.filters.from })}
      ${this.fld('acc-filter-to', 'To', { type: 'date', value: this.filters.to })}
      ${extraFields}
      ${this.btn('Apply', 'apply-filters', {}, 'btn-primary')}
      ${this.btn('Reset', 'reset-filters')}
    </div>`;
  },

  rowFromItem(item, cfg) {
    if (this.section === 'stock-adjustments') {
      const d = item.created_at || item.date || '—';
      const product = item.product_name || item.name || '—';
      const change = item.movement_type === 'remove' ? `-${item.quantity}` : `+${item.quantity}`;
      const id = item.id || '';
      return `<tr>
        <td>${this.esc(String(d).slice(0, 16))}</td>
        <td>${this.esc(product)}</td>
        <td>${this.esc(change)}</td>
        <td>${item.new_stock != null ? this.esc(String(item.new_stock)) : '—'}</td>
        <td>${this.esc(item.user_name || '—')}</td>
        <td></td>
      </tr>`;
    }
    const d = item.date || item.created_at || item.doc_date || '—';
    const num = item.number || item.reference || item.code || item.id || '—';
    const party = item.customer_name || item.supplier_name || item.party || item.name || '—';
    const amt = item.amount ?? item.total ?? item.balance ?? 0;
    const st = item.status || '—';
    const id = item.id || '';
    let actions = '';
    if (cfg.post && item.status === 'draft') actions += this.btn('Post', 'post-doc', { id, section: this.section });
    if (cfg.save) actions += this.btn('Edit', 'edit-doc', { id, section: this.section });
    if (this.section === 'all-documents' && id) actions += this.btn('Download', 'download-doc', { id });
    return `<tr>
      <td>${this.esc(String(d).slice(0, 10))}</td>
      <td><span class="acc-code">${this.esc(num)}</span></td>
      <td>${this.esc(party)}</td>
      <td>${this.money(amt)}</td>
      <td>${this.statusTag(st)}</td>
      <td>${actions ? this.rowBtns(actions) : ''}</td>
    </tr>`;
  },

  async renderSection() {
    const body = document.getElementById('acc-body');
    if (!body) return;
    const meta = this.SECTION_META[this.section] || ['Accounting', ''];
    body.innerHTML = `<p class="muted">Loading ${this.esc(meta[0])}…</p>`;
    const map = {
      dashboard: 'renderDashboard',
      'chart-of-accounts': 'renderChartOfAccounts',
      'general-ledger': 'renderGeneralLedger',
      journals: 'renderJournals',
      'trial-balance': 'renderTrialBalance',
      periods: 'renderPeriods',
      pnl: 'renderPnl',
      'balance-sheet': 'renderBalanceSheet',
      'cash-flow': 'renderCashFlow',
      'bank-accounts': 'renderBankAccounts',
      'bank-reconciliation': 'renderBankReconciliation',
      cashbook: 'renderCashbook',
      'cash-up': 'renderCashUp',
      'petty-cash': 'renderPettyCash',
      receivable: 'renderReceivable',
      payable: 'renderPayable',
      'customer-statements': 'renderCustomerStatements',
      'supplier-statements': 'renderSupplierStatements',
      'ar-aging': 'renderArAging',
      'ap-aging': 'renderApAging',
      'stock-value': 'renderStockValue',
      'stock-movement': 'renderStockMovement',
      cogs: 'renderCogs',
      'expense-approvals': 'renderExpenseApprovals',
      'vat-tax': 'renderVatTax',
      'tax-reports': 'renderTaxReports',
      'report-sales': 'renderReportSales',
      'report-purchases': 'renderReportPurchases',
      'report-expenses': 'renderReportExpenses',
      'report-stock': 'renderReportStock',
      'financial-reports': 'renderFinancialReports',
      'asset-register': 'renderAssetRegister',
      depreciation: 'renderDepreciation',
      'ocr-capture': 'renderOcrCapture',
      'other-income': 'renderOtherIncome',
      loans: 'renderLoans',
      'owner-equity': 'renderOwnerEquity',
      reconciliation: 'renderReconciliation',
      approvals: 'renderApprovals',
      'audit-log': 'renderAuditLog',
      integrations: 'renderIntegrations',
      'users-permissions': 'renderUsersPermissions',
      settings: 'renderSettings',
      'payroll-employees': 'renderPayrollSummary',
      'payroll-runs': 'renderPayrollSummary',
      'payroll-liabilities': 'renderPayrollSummary'
    };
    const fn = this.LIST_CFG[this.section] ? 'renderGenericList' : (this[map[this.section]] || 'renderDashboard');
    try {
      if (typeof fn === 'string') await this[fn].call(this, body);
      else await fn.call(this, body);
    } catch (err) {
      body.innerHTML = `${this.sectionHead('')}<p class="error-msg">${this.esc(err?.message || 'Failed to load section')}</p>`;
    }
  },

  async renderGenericList(el) {
    const cfg = this.LIST_CFG[this.section];
    if (!cfg) { el.innerHTML = this.sectionHead('') + '<div class="acc-empty">Section not configured.</div>'; return; }
    const scope = this.filterScope(cfg.type ? { type: cfg.type } : {});
    const rows = cfg.api ? await this.listApi(cfg.api, scope, 'Could not load list') : [];
    const headers = [...cfg.cols, ''];
    const tbody = rows.map((r) => this.rowFromItem(r, cfg)).join('');
    const exportHeaders = cfg.cols;
    const exportRows = rows.map((r) => [
      String(r.date || r.created_at || r.doc_date || '').slice(0, 10),
      r.number || r.reference || r.code || r.id || '—',
      r.customer_name || r.supplier_name || r.party || r.name || '—',
      String(r.amount ?? r.total ?? r.balance ?? 0),
      r.status || '—'
    ]);
    const title = this.SECTION_META[this.section]?.[0] || cfg.newLabel || this.section;
    this.cacheExport(this.section, title, exportHeaders, exportRows);
    el.innerHTML = `
      ${this.sectionHead(`${cfg.newLabel && cfg.save ? this.btn(cfg.newLabel, 'new-doc', { section: this.section }, 'btn-primary') : ''}${this.exportBtns(this.section)}${this.btn('Refresh', 'refresh')}`)}
      <div id="acc-inline-form"></div>
      ${this.filterBarHtml()}
      ${this.panel('', this.table(headers, tbody, 'No records for this period'), '', true)}`;
  },

  async renderDashboard(el) {
    const scope = this.filterScope();
    const [dash, health] = await Promise.all([
      this.apiCall('accDashboard', scope),
      this.apiCall('accFinancialHealth', scope)
    ]);
    const kpis = dash?.kpis || dash?.cards || [];
    const charts = dash?.charts || {};
    const salesChart = (charts.sales || dash?.sales_by_day || []).map((r) => ({
      label: r.label || r.day || r.date,
      value: r.value ?? r.revenue ?? r.amount ?? r.total
    }));
    const expChart = charts.expenses || dash?.expenses_by_category || [];

    const kpiHtml = kpis.length ? kpis.map((k) =>
      this.kpi(k.label, k.format === 'money' ? this.money(k.value) : String(k.value ?? 0), k.hint || k.sub, k.tone || 'accent', k.metric || k.key)).join('')
      : [
        this.kpi('Revenue', this.money(dash?.revenue ?? dash?.pnl?.revenue ?? dash?.today_sales), 'Sales this period', 'accent', 'revenue'),
        this.kpi('Expenses', this.money(dash?.expenses ?? dash?.pnl?.expenses ?? dash?.today_expenses), 'Operating costs', 'warn', 'expenses'),
        this.kpi('Net Profit', this.money(dash?.net_profit ?? dash?.pnl?.net_profit), 'After tax', 'good', 'net_profit'),
        this.kpi('Cash', this.money(dash?.cash ?? dash?.bank_balance), 'Bank + till', 'slate', 'cash'),
        this.kpi('Receivable', this.money(dash?.receivable ?? dash?.ar_outstanding), 'Outstanding AR', 'info', 'receivable'),
        this.kpi('Payable', this.money(dash?.payable ?? dash?.ap_outstanding), 'Outstanding AP', 'info', 'payable')
      ].join('');

    const healthHtml = health ? `<div class="acc-health-strip">
      <div class="acc-health-score"><div class="acc-health-ring">${this.esc(health.score ?? Math.round(health.gross_margin || 0))}</div>
        <div><strong>${this.esc(health.label || 'Financial Health')}</strong><br><small class="muted">${this.esc(health.summary || `Gross margin ${health.gross_margin || 0}% · Net margin ${health.net_margin || 0}%`)}</small></div></div>
      <div class="acc-health-items">${(health.items || Object.entries(health.indicators || {}).map(([k, v]) => ({ label: k, value: v, tone: v }))).map((i) =>
        `<span class="acc-health-pill ${this.esc(i.tone || i.value || '')}">${this.esc(i.label)}: ${this.esc(i.value)}</span>`).join('')}</div>
    </div>` : '';

    el.innerHTML = `
      ${this.sectionHead(`${this.btn('New Invoice', 'txn-invoice', {}, 'btn-primary')}${this.btn('New Expense', 'txn-expense')}${this.btn('Journal', 'txn-journal')}`)}
      ${this.rangeBarHtml()}
      ${healthHtml}
      <div class="acc-quick-actions">
        ${this.btn('Invoices', 'nav', { section: 'invoices' })}${this.btn('Bills', 'nav', { section: 'supplier-bills' })}
        ${this.btn('Bank Rec', 'nav', { section: 'bank-reconciliation' })}${this.btn('Trial Balance', 'nav', { section: 'trial-balance' })}
        ${this.btn('P&amp;L', 'nav', { section: 'pnl' })}${this.btn('Approvals', 'nav', { section: 'approvals' })}
      </div>
      <div class="acc-kpis">${kpiHtml}</div>
      <div class="acc-grid-2">
        ${this.panel('Sales trend', this.chart(
          Array.isArray(salesChart) ? salesChart : [],
          (r) => String(r.label || r.date || '').slice(0, 8),
          (r) => r.value ?? r.amount ?? r.total
        ))}
        ${this.panel('Expenses', this.chart(
          Array.isArray(expChart) ? expChart : [],
          (r) => String(r.label || r.category || '').slice(0, 10),
          (r) => r.value ?? r.amount ?? r.total
        ))}
      </div>`;
  },

  async renderChartOfAccounts(el) {
    const rows = await this.listApi('accAccounts', this.filterScope());
    el.innerHTML = `
      ${this.sectionHead(this.btn('New Account', 'new-account', {}, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      <div id="acc-inline-form"></div>
      ${this.filterBarHtml(this.fld('acc-filter-type', 'Type', { options: [['', 'All'], ['asset', 'Asset'], ['liability', 'Liability'], ['equity', 'Equity'], ['income', 'Income'], ['expense', 'Expense']] }))}
      ${this.panel('', this.table(['Code', 'Name', 'Type', 'Balance', ''],
        rows.map((a) => `<tr>
          <td><span class="acc-code">${this.esc(a.code)}</span></td>
          <td>${this.esc(a.name)}</td>
          <td>${this.tag(a.type, 'info')}</td>
          <td>${this.money(a.balance)}</td>
          <td>${this.rowBtns(this.btn('Edit', 'edit-account', { id: a.id }))}</td>
        </tr>`).join(''), 'No accounts yet'), '', true)}`;
  },

  async renderGeneralLedger(el) {
    const accountId = document.getElementById('acc-gl-account')?.value || '';
    const scope = this.filterScope(accountId ? { account_id: parseInt(accountId, 10) } : {});
    const accounts = await this.listApi('accAccounts', {});
    const data = await this.apiCall('accLedger', scope);
    const rows = data?.lines || data?.rows || (Array.isArray(data) ? data : []);
    const exportRows = rows.map((l) => [
      String(l.journal_date || l.date || '').slice(0, 10),
      l.reference || l.journal_number || '—',
      l.account_name || l.account_code || '—',
      l.debit ? String(l.debit) : '',
      l.credit ? String(l.credit) : '',
      String(l.running_balance ?? l.balance ?? '')
    ]);
    this.cacheExport('general-ledger', 'General Ledger', ['Date', 'Reference', 'Account', 'Debit', 'Credit', 'Balance'], exportRows);
    el.innerHTML = `
      ${this.sectionHead(this.exportBtns('general-ledger') + this.btn('Refresh', 'refresh'))}
      ${this.filterBarHtml(this.fld('acc-gl-account', 'Account', { value: accountId, options: [['', 'All accounts'], ...accounts.map((a) => [a.id, `${a.code} — ${a.name}`])] }))}
      ${this.panel('', this.table(['Date', 'Reference', 'Account', 'Debit', 'Credit', 'Balance'],
        rows.map((l) => `<tr>
          <td>${this.esc(String(l.date || '').slice(0, 10))}</td>
          <td>${this.esc(l.reference || '—')}</td>
          <td>${this.esc(l.account_name || l.account_code || '—')}</td>
          <td>${l.debit ? this.money(l.debit) : '—'}</td>
          <td>${l.credit ? this.money(l.credit) : '—'}</td>
          <td>${this.money(l.running_balance ?? l.balance)}</td>
        </tr>`).join(''), 'No ledger lines'), '', true)}`;
  },

  async renderJournals(el) {
    const rows = await this.listApi('accJournals', this.filterScope());
    el.innerHTML = `
      ${this.sectionHead(this.btn('New Journal', 'txn-journal', {}, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      <div id="acc-inline-form"></div>
      ${this.filterBarHtml()}
      ${this.panel('', this.table(['Date', 'Reference', 'Description', 'Amount', 'Status', ''],
        rows.map((j) => `<tr>
          <td>${this.esc(String(j.date || j.created_at || '').slice(0, 10))}</td>
          <td><span class="acc-code">${this.esc(j.reference || j.number || j.id)}</span></td>
          <td class="acc-truncate">${this.esc(j.description || j.memo || '—')}</td>
          <td>${this.money(j.amount ?? j.total)}</td>
          <td>${this.statusTag(j.status)}</td>
          <td>${this.rowBtns([
            this.btn('View', 'view-journal', { id: j.id }),
            j.status === 'draft' ? this.btn('Post', 'post-journal', { id: j.id }) : '',
            j.status === 'posted' ? this.btn('Reverse', 'reverse-journal', { id: j.id }) : ''
          ].join(''))}</td>
        </tr>`).join(''), 'No journals'), '', true)}`;
  },

  async renderTrialBalance(el) {
    const data = await this.apiCall('accTrialBalance', this.filterScope());
    const rows = data?.rows || data?.accounts || (Array.isArray(data) ? data : []);
    const exportRows = rows.map((r) => [r.code, r.name, String(r.debit || 0), String(r.credit || 0)]);
    this.cacheExport('trial-balance', 'Trial Balance', ['Code', 'Account', 'Debit', 'Credit'], exportRows);
    el.innerHTML = `
      ${this.sectionHead(this.exportBtns('trial-balance') + this.btn('Refresh', 'refresh'))}
      ${this.filterBarHtml()}
      ${this.panel('', this.table(['Code', 'Account', 'Debit', 'Credit'],
        rows.map((r) => `<tr>
          <td><span class="acc-code">${this.esc(r.code)}</span></td>
          <td>${this.esc(r.name)}</td>
          <td>${this.money(r.debit)}</td>
          <td>${this.money(r.credit)}</td>
        </tr>`).join(''), 'No trial balance data'), '', true)}
      ${data ? `<div class="acc-note">Total debits ${this.money(data.total_debit)} · credits ${this.money(data.total_credit)}</div>` : ''}`;
  },

  async renderPeriods(el) {
    const rows = await this.listApi('accPeriods', {});
    el.innerHTML = `
      ${this.sectionHead(this.btn('Year End', 'year-end') + this.btn('Refresh', 'refresh'))}
      ${this.panel('', this.table(['Period', 'Start', 'End', 'Status', ''],
        rows.map((p) => `<tr>
          <td>${this.esc(p.name || p.period)}</td>
          <td>${this.esc(p.start_date || p.from)}</td>
          <td>${this.esc(p.end_date || p.to)}</td>
          <td>${this.statusTag(p.status)}</td>
          <td>${p.status === 'open' ? this.rowBtns(this.btn('Close', 'close-period', { id: p.id })) : ''}</td>
        </tr>`).join(''), 'No periods configured'), '', true)}`;
  },

  async renderPnl(el) {
    const data = await this.apiCall('accProfitLoss', this.filterScope());
    const rows = this.pnlLines(data);
    const exportRows = rows.map((r) => [r.name || r.account, String(r.amount ?? 0)]);
    this.cacheExport('pnl', 'Profit & Loss', ['Account', 'Amount'], exportRows);
    el.innerHTML = `
      ${this.sectionHead(this.exportBtns('pnl') + this.btn('Refresh', 'refresh'))}
      ${this.rangeBarHtml()}${this.filterBarHtml()}
      ${this.panel('Profit & Loss', this.table(['Account', 'Amount'],
        rows.map((r) => `<tr><td>${this.esc(r.name || r.account)}</td><td>${this.money(r.amount)}</td></tr>`).join(''),
        'No P&amp;L data') + (data?.net_profit != null ? `<div class="acc-note" style="margin:12px 14px">Net profit: <strong>${this.money(data.net_profit)}</strong></div>` : ''))}`;
  },

  async renderBalanceSheet(el) {
    const data = await this.apiCall('accBalanceSheet', this.filterScope());
    const sections = this.balanceSheetSections(data);
    const exportRows = sections.flatMap((s) => (s.rows || []).map((r) => [s.title, r.name, String(r.amount ?? 0)]));
    this.cacheExport('balance-sheet', 'Balance Sheet', ['Section', 'Account', 'Amount'], exportRows);
    el.innerHTML = `
      ${this.sectionHead(this.exportBtns('balance-sheet') + this.btn('Refresh', 'refresh'))}
      ${this.filterBarHtml()}
      ${sections.map((s) => this.panel(s.title || 'Section', this.table(['Account', 'Amount'],
        (s.rows || []).map((r) => `<tr><td>${this.esc(r.name)}</td><td>${this.money(r.amount)}</td></tr>`).join(''),
        'No data'))).join('')}`;
  },

  async renderCashFlow(el) {
    const data = await this.apiCall('accCashFlow', this.filterScope());
    const rows = this.cashFlowLines(data);
    const exportRows = rows.map((r) => [
      r.category || r.name,
      String(r.inflow || 0),
      String(r.outflow || 0),
      String(r.net ?? ((r.inflow || 0) - (r.outflow || 0)))
    ]);
    this.cacheExport('cash-flow', 'Cash Flow Statement', ['Category', 'Inflow', 'Outflow', 'Net'], exportRows);
    el.innerHTML = `
      ${this.sectionHead(this.exportBtns('cash-flow') + this.btn('Refresh', 'refresh'))}
      ${this.rangeBarHtml()}${this.filterBarHtml()}
      ${this.panel('Cash Flow Statement', this.table(['Category', 'Inflow', 'Outflow', 'Net'],
        rows.map((r) => `<tr>
          <td>${this.esc(r.category || r.name)}</td>
          <td>${this.money(r.inflow)}</td>
          <td>${this.money(r.outflow)}</td>
          <td>${this.money(r.net ?? ((r.inflow || 0) - (r.outflow || 0)))}</td>
        </tr>`).join(''), 'No cash flow data'))}`;
  },

  async renderBankAccounts(el) {
    const rows = await this.listApi('accBankAccounts', this.filterScope());
    el.innerHTML = `
      ${this.sectionHead(this.btn('Add Account', 'new-bank-account', {}, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      <div id="acc-inline-form"></div>
      ${this.panel('', this.table(['Bank', 'Account', 'Currency', 'Balance', ''],
        rows.map((b) => `<tr>
          <td>${this.esc(b.bank_name || b.name)}</td>
          <td><span class="acc-code">${this.esc(b.account_number || b.number || '—')}</span></td>
          <td>${this.esc(b.currency || 'ZAR')}</td>
          <td>${this.money(b.current_balance ?? b.balance)}</td>
          <td>${this.rowBtns(this.btn('Transactions', 'nav', { section: 'bank-transactions' }))}</td>
        </tr>`).join(''), 'No bank accounts'), '', true)}`;
  },

  async renderBankReconciliation(el) {
    const data = await this.apiCall('accBankStmtLines', this.filterScope({ status: 'unmatched' }));
    const unmatched = data?.lines || data?.rows || (Array.isArray(data) ? data : []);
    el.innerHTML = `
      ${this.sectionHead(this.btn('Import Statement', 'import-bank-stmt', {}, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      ${this.filterBarHtml()}
      ${this.panel('Unmatched lines', this.table(['Date', 'Description', 'Amount', 'Suggested match', ''],
        unmatched.map((l) => `<tr>
          <td>${this.esc(String(l.date || '').slice(0, 10))}</td>
          <td>${this.esc(l.description)}</td>
          <td>${this.money(l.amount)}</td>
          <td>${this.esc(l.suggested || '—')}</td>
          <td>${this.rowBtns(this.btn('Match', 'reconcile-line', { id: l.id }))}</td>
        </tr>`).join(''), 'All lines reconciled'), '', true)}
      ${data?.summary ? `<div class="acc-note">Statement balance ${this.money(data.summary.statement)} · Ledger ${this.money(data.summary.ledger)} · Difference ${this.money(data.summary.difference)}</div>` : ''}`;
  },

  async renderCashbook(el) {
    const rows = await this.listApi('accCashTxns', this.filterScope());
    el.innerHTML = `
      ${this.sectionHead(this.btn('Add Entry', 'new-cashbook', {}, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      <div id="acc-inline-form"></div>
      ${this.filterBarHtml()}
      ${this.panel('', this.table(['Date', 'Reference', 'Description', 'In', 'Out', 'Balance'],
        rows.map((r) => `<tr>
          <td>${this.esc(String(r.txn_date || r.date || '').slice(0, 10))}</td>
          <td>${this.esc(r.reference || '—')}</td>
          <td>${this.esc(r.description || '—')}</td>
          <td>${(r.direction === 'in' || r.inflow) ? this.money(r.amount || r.inflow) : '—'}</td>
          <td>${(r.direction === 'out' || r.outflow) ? this.money(r.amount || r.outflow) : '—'}</td>
          <td>${this.money(r.balance)}</td>
        </tr>`).join(''), 'No cashbook entries'), '', true)}`;
  },

  async renderCashUp(el) {
    const data = await this.apiCall('accListCashupFinance', this.filterScope());
    const rows = data?.sessions || data?.rows || (Array.isArray(data) ? data : []);
    el.innerHTML = `
      ${this.sectionHead(this.btn('Refresh', 'refresh'))}
      ${this.filterBarHtml()}
      ${this.panel('', this.table(['Date', 'Branch', 'Expected', 'Counted', 'Variance', 'Status'],
        rows.map((r) => `<tr>
          <td>${this.esc(String(r.date || '').slice(0, 10))}</td>
          <td>${this.esc(r.branch_name || r.branch || '—')}</td>
          <td>${this.money(r.expected)}</td>
          <td>${this.money(r.counted)}</td>
          <td>${this.money(r.variance)}</td>
          <td>${this.statusTag(r.status)}</td>
        </tr>`).join(''), 'No cash-up records'), '', true)}`;
  },

  async renderPettyCash(el) {
    const rows = await this.listApi('accPettyCash', this.filterScope());
    el.innerHTML = `
      ${this.sectionHead(this.btn('New Claim', 'new-petty', {}, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      <div id="acc-inline-form"></div>
      ${this.filterBarHtml()}
      ${this.panel('', this.table(['Date', 'Employee', 'Purpose', 'Amount', 'Status'],
        rows.map((r) => `<tr>
          <td>${this.esc(String(r.date || '').slice(0, 10))}</td>
          <td>${this.esc(r.employee || r.party || '—')}</td>
          <td>${this.esc(r.description || r.purpose || '—')}</td>
          <td>${this.money(r.amount)}</td>
          <td>${this.statusTag(r.status)}</td>
        </tr>`).join(''), 'No petty cash entries'), '', true)}`;
  },

  async renderReceivable(el) {
    const data = await this.apiCall('accAgingAr', this.filterScope());
    const rows = this.groupAgingByParty(data, 'customer_name');
    const exportRows = rows.map((r) => [
      r.name, String(r.current), String(r.days_30), String(r.days_60), String(r.days_90), String(r.total)
    ]);
    this.cacheExport('receivable', 'Accounts Receivable', ['Customer', 'Current', '30 days', '60 days', '90+', 'Total'], exportRows);
    el.innerHTML = `
      ${this.sectionHead(this.exportBtns('receivable') + this.btn('Refresh', 'refresh'))}
      ${this.filterBarHtml()}
      ${this.panel('', this.table(['Customer', 'Current', '30 days', '60 days', '90+', 'Total'],
        rows.map((r) => `<tr>
          <td>${this.esc(r.customer_name || r.name)}</td>
          <td>${this.money(r.current)}</td>
          <td>${this.money(r.days_30)}</td>
          <td>${this.money(r.days_60)}</td>
          <td>${this.money(r.days_90)}</td>
          <td><strong>${this.money(r.total)}</strong></td>
        </tr>`).join(''), 'No receivable balances'), '', true)}`;
  },

  async renderPayable(el) {
    const data = await this.apiCall('accAgingAp', this.filterScope());
    const rows = this.groupAgingByParty(data, 'supplier_name');
    const exportRows = rows.map((r) => [
      r.name, String(r.current), String(r.days_30), String(r.days_60), String(r.days_90), String(r.total)
    ]);
    this.cacheExport('payable', 'Accounts Payable', ['Supplier', 'Current', '30 days', '60 days', '90+', 'Total'], exportRows);
    el.innerHTML = `
      ${this.sectionHead(this.exportBtns('payable') + this.btn('Refresh', 'refresh'))}
      ${this.filterBarHtml()}
      ${this.panel('', this.table(['Supplier', 'Current', '30 days', '60 days', '90+', 'Total'],
        rows.map((r) => `<tr>
          <td>${this.esc(r.supplier_name || r.name)}</td>
          <td>${this.money(r.current)}</td>
          <td>${this.money(r.days_30)}</td>
          <td>${this.money(r.days_60)}</td>
          <td>${this.money(r.days_90)}</td>
          <td><strong>${this.money(r.total)}</strong></td>
        </tr>`).join(''), 'No payable balances'), '', true)}`;
  },

  async renderCustomerStatements(el) {
    const history = await this.listApi('accStatements', { party_type: 'customer' });
    const rows = Array.isArray(history) ? history : (history?.rows || []);
    el.innerHTML = `
      ${this.sectionHead(this.btn('Generate', 'gen-customer-stmt', {}, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      <div id="acc-inline-form"></div>
      ${this.filterBarHtml(this.fld('acc-stmt-customer', 'Customer ID', { placeholder: 'Customer ID' }))}
      ${this.panel('Saved statements', this.table(['Date', 'Customer', 'Period', 'Closing', ''],
        rows.map((s) => `<tr>
          <td>${this.esc(String(s.created_at || '').slice(0, 10))}</td>
          <td>${this.esc(s.party_name || s.party_id)}</td>
          <td>${this.esc(String(s.from_date || '').slice(0, 10))} — ${this.esc(String(s.to_date || '').slice(0, 10))}</td>
          <td>${this.money(s.closing_balance)}</td>
          <td>${this.rowBtns(this.btn('View', 'view-stmt', { id: s.id }))}</td>
        </tr>`).join(''), 'No saved statements yet — generate one above'), '', true)}`;
  },

  async renderSupplierStatements(el) {
    const history = await this.listApi('accStatements', { party_type: 'supplier' });
    const rows = Array.isArray(history) ? history : (history?.rows || []);
    el.innerHTML = `
      ${this.sectionHead(this.btn('Generate', 'gen-supplier-stmt', {}, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      <div id="acc-inline-form"></div>
      ${this.filterBarHtml(this.fld('acc-stmt-supplier', 'Supplier ID', { placeholder: 'Supplier ID' }))}
      ${this.panel('Saved statements', this.table(['Date', 'Supplier', 'Period', 'Closing', ''],
        rows.map((s) => `<tr>
          <td>${this.esc(String(s.created_at || '').slice(0, 10))}</td>
          <td>${this.esc(s.party_name || s.party_id)}</td>
          <td>${this.esc(String(s.from_date || '').slice(0, 10))} — ${this.esc(String(s.to_date || '').slice(0, 10))}</td>
          <td>${this.money(s.closing_balance)}</td>
          <td>${this.rowBtns(this.btn('View', 'view-stmt', { id: s.id }))}</td>
        </tr>`).join(''), 'No saved statements yet'), '', true)}`;
  },

  async renderArAging(el) {
    const data = await this.apiCall('accAgingAr', this.filterScope());
    const rows = this.agingBuckets(data);
    const exportRows = rows.map((r) => [r.bucket || r.label, String(r.count || 0), String(r.amount || 0)]);
    this.cacheExport('ar-aging', 'AR Ageing', ['Bucket', 'Count', 'Amount'], exportRows);
    el.innerHTML = `
      ${this.sectionHead(this.exportBtns('ar-aging') + this.btn('Refresh', 'refresh'))}
      ${this.filterBarHtml()}
      ${this.panel('', this.table(['Bucket', 'Count', 'Amount'],
        rows.map((r) => `<tr><td>${this.esc(r.bucket || r.label)}</td><td>${this.esc(r.count || 0)}</td><td>${this.money(r.amount)}</td></tr>`).join(''),
        'No AR ageing data'), '', true)}`;
  },

  async renderApAging(el) {
    const data = await this.apiCall('accAgingAp', this.filterScope());
    const rows = this.agingBuckets(data);
    const exportRows = rows.map((r) => [r.bucket || r.label, String(r.count || 0), String(r.amount || 0)]);
    this.cacheExport('ap-aging', 'AP Ageing', ['Bucket', 'Count', 'Amount'], exportRows);
    el.innerHTML = `
      ${this.sectionHead(this.exportBtns('ap-aging') + this.btn('Refresh', 'refresh'))}
      ${this.filterBarHtml()}
      ${this.panel('', this.table(['Bucket', 'Count', 'Amount'],
        rows.map((r) => `<tr><td>${this.esc(r.bucket || r.label)}</td><td>${this.esc(r.count || 0)}</td><td>${this.money(r.amount)}</td></tr>`).join(''),
        'No AP ageing data'), '', true)}`;
  },

  async renderStockValue(el) {
    const data = await this.apiCall('accDrillDown', { ...this.filterScope(), metric: 'stock_value' });
    const rows = data?.rows || data?.items || [];
    const exportRows = rows.map((r) => [r.name || r.product, String(r.qty), String(r.unit_cost || 0), String(r.value || 0)]);
    this.cacheExport('stock-value', 'Stock Valuation', ['Product', 'Qty', 'Unit cost', 'Value'], exportRows);
    el.innerHTML = `
      ${this.sectionHead(this.exportBtns('stock-value') + this.btn('Refresh', 'refresh'))}
      ${this.filterBarHtml()}
      <div class="acc-kpis">${this.kpi('Total value', this.money(data?.total), 'At cost', 'accent')}${this.kpi('SKU count', String(data?.count || rows.length), 'Active products')}</div>
      ${this.panel('', this.table(['Product', 'Qty', 'Unit cost', 'Value'],
        rows.map((r) => `<tr><td>${this.esc(r.name || r.product)}</td><td>${this.esc(r.qty)}</td><td>${this.money(r.unit_cost)}</td><td>${this.money(r.value)}</td></tr>`).join(''),
        'No stock valuation'), '', true)}`;
  },

  async renderStockMovement(el) {
    const rows = await this.listApi('accDocuments', this.filterScope({ type: 'stock_movement' }));
    el.innerHTML = `
      ${this.sectionHead(this.btn('Refresh', 'refresh'))}
      ${this.filterBarHtml()}
      ${this.panel('', this.table(['Date', 'Product', 'Type', 'Qty', 'Reference'],
        rows.map((r) => `<tr>
          <td>${this.esc(String(r.date || '').slice(0, 10))}</td>
          <td>${this.esc(r.product_name || r.product || '—')}</td>
          <td>${this.tag(r.movement_type || r.type, 'info')}</td>
          <td>${this.esc(r.qty)}</td>
          <td>${this.esc(r.reference || '—')}</td>
        </tr>`).join(''), 'No stock movements'), '', true)}`;
  },

  async renderCogs(el) {
    const data = await this.apiCall('accProfitLoss', this.filterScope());
    const rows = (data?.accounts || []).filter((a) => a.type === 'cogs' && a.period_amount);
    const exportRows = rows.map((r) => [r.name || r.category, String(r.period_amount ?? r.amount ?? 0)]);
    this.cacheExport('cogs', 'Cost of Goods Sold', ['Category', 'Amount'], exportRows);
    el.innerHTML = `
      ${this.sectionHead(this.exportBtns('cogs') + this.btn('Refresh', 'refresh'))}
      ${this.rangeBarHtml()}${this.filterBarHtml()}
      ${this.panel('', this.table(['Category', 'Amount'],
        rows.map((r) => `<tr><td>${this.esc(r.name || r.category)}</td><td>${this.money(r.period_amount ?? r.amount)}</td></tr>`).join(''),
        'No COGS data'), '', true)}`;
  },

  async renderExpenseApprovals(el) {
    const rows = await this.listApi('accApprovals', this.filterScope({ type: 'expense' }));
    el.innerHTML = `
      ${this.sectionHead(this.btn('Refresh', 'refresh'))}
      ${this.filterBarHtml()}
      ${this.panel('', this.table(['Date', 'Employee', 'Category', 'Amount', 'Status', ''],
        rows.map((r) => `<tr>
          <td>${this.esc(String(r.date || '').slice(0, 10))}</td>
          <td>${this.esc(r.employee || r.submitted_by || '—')}</td>
          <td>${this.esc(r.category || '—')}</td>
          <td>${this.money(r.amount)}</td>
          <td><span class="acc-approval-pill ${this.esc(String(r.status || 'pending').toLowerCase())}">${this.esc(r.status || 'pending')}</span></td>
          <td>${r.status === 'pending' ? this.rowBtns(this.btn('Approve', 'approve', { id: r.id }) + this.btn('Reject', 'reject', { id: r.id })) : ''}</td>
        </tr>`).join(''), 'No pending expense approvals'), '', true)}`;
  },

  async renderVatTax(el) {
    const rows = await this.listApi('accTaxRates', {});
    el.innerHTML = `
      ${this.sectionHead(this.btn('Add Rate', 'new-tax-rate', {}, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      <div id="acc-inline-form"></div>
      ${this.panel('', this.table(['Code', 'Name', 'Rate %', 'Type', 'Status'],
        rows.map((r) => `<tr>
          <td><span class="acc-code">${this.esc(r.code)}</span></td>
          <td>${this.esc(r.name)}</td>
          <td>${this.esc(r.rate)}%</td>
          <td>${this.tag(r.type || 'VAT', 'info')}</td>
          <td>${this.statusTag(r.status || 'active')}</td>
        </tr>`).join(''), 'No tax rates configured'), '', true)}`;
  },

  async renderTaxReports(el) {
    const data = await this.apiCall('accTaxSummary', this.filterScope());
    const rows = data?.lines || data?.rows || [
      { code: 'Output VAT', taxable: '—', tax: data?.output_vat },
      { code: 'Input VAT', taxable: '—', tax: data?.input_vat },
      { code: 'VAT Payable', taxable: '—', tax: data?.vat_payable }
    ];
    const exportRows = rows.map((r) => [r.code || r.name, String(r.taxable ?? '—'), String(r.tax ?? 0)]);
    this.cacheExport('tax-reports', 'Tax Summary', ['Tax code', 'Taxable', 'Tax amount'], exportRows);
    el.innerHTML = `
      ${this.sectionHead(this.exportBtns('tax-reports') + this.btn('Refresh', 'refresh'))}
      ${this.rangeBarHtml()}${this.filterBarHtml()}
      ${this.panel('', this.table(['Tax code', 'Taxable', 'Tax amount'],
        rows.map((r) => `<tr><td>${this.esc(r.code || r.name)}</td><td>${this.money(r.taxable)}</td><td>${this.money(r.tax)}</td></tr>`).join(''),
        'No tax summary'), '', true)}
      ${data?.total_tax != null ? `<div class="acc-note">Total tax: <strong>${this.money(data.total_tax)}</strong></div>` : ''}`;
  },

  async renderReportSales(el) {
    const data = await this.apiCall('accDrillDown', { ...this.filterScope(), metric: 'sales_report' });
    const rows = data?.rows || [];
    const exportRows = rows.map((r) => [
      r.label || r.name || r.day,
      String(r.count ?? r.qty ?? 0),
      String(r.amount ?? r.revenue ?? 0),
      String(r.tax ?? 0)
    ]);
    this.cacheExport('report-sales', 'Sales Report', ['Period', 'Count', 'Revenue', 'Tax'], exportRows);
    el.innerHTML = `${this.sectionHead(this.exportBtns('report-sales') + this.btn('Refresh', 'refresh'))}${this.rangeBarHtml()}${this.filterBarHtml()}
      ${this.panel('', this.table(['Period', 'Sales', 'Revenue', 'Tax'],
        rows.map((r) => `<tr><td>${this.esc(r.label || r.day || r.name)}</td><td>${this.esc(r.count ?? r.qty ?? 0)}</td><td>${this.money(r.amount ?? r.revenue)}</td><td>${this.money(r.tax)}</td></tr>`).join(''),
        'No sales report data'), '', true)}`;
  },

  async renderReportPurchases(el) {
    const data = await this.apiCall('accDrillDown', { ...this.filterScope(), metric: 'purchases_report' });
    const rows = data?.rows || [];
    const exportRows = rows.map((r) => [r.party || r.supplier || r.label, String(r.count ?? 1), String(r.amount ?? 0)]);
    this.cacheExport('report-purchases', 'Purchases Report', ['Supplier', 'Bills', 'Amount'], exportRows);
    el.innerHTML = `${this.sectionHead(this.exportBtns('report-purchases') + this.btn('Refresh', 'refresh'))}${this.rangeBarHtml()}${this.filterBarHtml()}
      ${this.panel('', this.table(['Supplier / Bill', 'Reference', 'Amount'],
        rows.map((r) => `<tr><td>${this.esc(r.party || r.supplier || r.label)}</td><td>${this.esc(r.label || r.bill_number || '—')}</td><td>${this.money(r.amount)}</td></tr>`).join(''),
        'No purchases report'), '', true)}`;
  },

  async renderReportExpenses(el) {
    const rows = await this.listApi('accExpenses', this.filterScope());
    const grouped = this.groupBy(rows, 'category');
    const exportRows = grouped.map(([cat, items]) => [
      cat, String(items.length), String(items.reduce((s, i) => s + (Number(i.amount) || 0), 0))
    ]);
    this.cacheExport('report-expenses', 'Expenses Report', ['Category', 'Count', 'Amount'], exportRows);
    el.innerHTML = `${this.sectionHead(this.exportBtns('report-expenses') + this.btn('Refresh', 'refresh'))}${this.rangeBarHtml()}${this.filterBarHtml()}
      ${this.panel('', this.table(['Category', 'Count', 'Amount'],
        this.groupBy(rows, 'category').map(([cat, items]) => `<tr><td>${this.esc(cat)}</td><td>${items.length}</td><td>${this.money(items.reduce((s, i) => s + (Number(i.amount) || 0), 0))}</td></tr>`).join(''),
        'No expenses in period'), '', true)}`;
  },

  async renderReportStock(el) {
    await this.renderStockValue(el);
  },

  async renderFinancialReports(el) {
    el.innerHTML = `
      ${this.sectionHead('')}
      <div class="acc-grid-2">
        ${this.panel('Standard reports', `<div class="acc-quick-actions" style="margin:0">
          ${this.btn('Profit & Loss', 'nav', { section: 'pnl' }, 'btn-primary')}
          ${this.btn('Balance Sheet', 'nav', { section: 'balance-sheet' })}
          ${this.btn('Cash Flow', 'nav', { section: 'cash-flow' })}
          ${this.btn('Trial Balance', 'nav', { section: 'trial-balance' })}
        </div>`)}
        ${this.panel('Operational reports', `<div class="acc-quick-actions" style="margin:0">
          ${this.btn('Sales', 'nav', { section: 'report-sales' })}
          ${this.btn('Purchases', 'nav', { section: 'report-purchases' })}
          ${this.btn('Expenses', 'nav', { section: 'report-expenses' })}
          ${this.btn('Stock', 'nav', { section: 'report-stock' })}
        </div>`)}
      </div>`;
  },

  async renderAssetRegister(el) {
    const rows = await this.listApi('accAssets', this.filterScope());
    el.innerHTML = `
      ${this.sectionHead(this.btn('Add Asset', 'new-asset', {}, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      <div id="acc-inline-form"></div>
      ${this.panel('', this.table(['Code', 'Name', 'Purchase date', 'Cost', 'Book value', 'Status'],
        rows.map((a) => `<tr>
          <td><span class="acc-code">${this.esc(a.code || a.id)}</span></td>
          <td>${this.esc(a.name)}</td>
          <td>${this.esc(String(a.purchase_date || '').slice(0, 10))}</td>
          <td>${this.money(a.cost)}</td>
          <td>${this.money(a.book_value)}</td>
          <td>${this.statusTag(a.status || 'active')}</td>
        </tr>`).join(''), 'No assets registered'), '', true)}`;
  },

  async renderDepreciation(el) {
    const rows = await this.listApi('accAssets', this.filterScope({ view: 'depreciation' }));
    el.innerHTML = `
      ${this.sectionHead(this.btn('Run Depreciation', 'run-depreciation', {}, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      ${this.filterBarHtml()}
      ${this.panel('', this.table(['Asset', 'Method', 'Monthly', 'Accumulated', 'NBV'],
        rows.map((a) => `<tr>
          <td>${this.esc(a.name)}</td>
          <td>${this.esc(a.method || 'straight_line')}</td>
          <td>${this.money(a.monthly_depreciation)}</td>
          <td>${this.money(a.accumulated_depreciation)}</td>
          <td>${this.money(a.book_value)}</td>
        </tr>`).join(''), 'No depreciation schedules'), '', true)}`;
  },

  async renderOcrCapture(el) {
    const rows = await this.listApi('accDocuments', this.filterScope({ status: 'ocr_pending' }));
    el.innerHTML = `
      ${this.sectionHead(this.btn('Upload scan', 'upload-doc', {}, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      <div id="acc-inline-form"></div>
      ${this.panel('', this.table(['Uploaded', 'Supplier', 'Amount', 'Confidence', ''],
        rows.map((d) => `<tr>
          <td>${this.esc(String(d.created_at || d.date || '').slice(0, 10))}</td>
          <td>${this.esc(d.supplier_name || d.party || '—')}</td>
          <td>${this.money(d.amount)}</td>
          <td>${d.confidence ? `${this.esc(d.confidence)}%` : '—'}</td>
          <td>${this.rowBtns(this.btn('Confirm', 'confirm-ocr', { id: d.id }) + this.btn('Reject', 'reject-ocr', { id: d.id }))}</td>
        </tr>`).join(''), 'No documents awaiting OCR review'), '', true)}`;
  },

  async renderOtherIncome(el) {
    const rows = await this.listApi('accOtherIncome', this.filterScope());
    el.innerHTML = `
      ${this.sectionHead(this.btn('Record Income', 'new-other-income', {}, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      <div id="acc-inline-form"></div>
      ${this.filterBarHtml()}
      ${this.panel('', this.table(['Date', 'Type', 'Description', 'Amount', ''],
        rows.map((r) => `<tr>
          <td>${this.esc(String(r.income_date || r.date || '').slice(0, 10))}</td>
          <td>${this.tag(r.income_type || 'other', 'info')}</td>
          <td>${this.esc(r.description || '—')}</td>
          <td>${this.money(r.amount)}</td>
          <td></td>
        </tr>`).join(''), 'No other income recorded'), '', true)}`;
  },

  async renderLoans(el) {
    const rows = await this.listApi('accLoans', this.filterScope());
    el.innerHTML = `
      ${this.sectionHead(this.btn('Add Loan', 'new-loan', {}, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      <div id="acc-inline-form"></div>
      ${this.panel('', this.table(['Lender', 'Principal', 'Outstanding', 'Rate', 'Status', ''],
        rows.map((r) => `<tr>
          <td>${this.esc(r.lender || '—')}</td>
          <td>${this.money(r.principal)}</td>
          <td>${this.money(r.outstanding_balance)}</td>
          <td>${r.interest_rate != null ? `${this.esc(r.interest_rate)}%` : '—'}</td>
          <td>${this.statusTag(r.status || 'active')}</td>
          <td>${this.rowBtns(this.btn('Payment', 'loan-payment', { id: r.id }))}</td>
        </tr>`).join(''), 'No loans registered'), '', true)}`;
  },

  async renderOwnerEquity(el) {
    const rows = await this.listApi('accOwnerTxns', this.filterScope());
    el.innerHTML = `
      ${this.sectionHead(this.btn('Record Transaction', 'new-owner-txn', {}, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      <div id="acc-inline-form"></div>
      ${this.panel('', this.table(['Date', 'Type', 'Description', 'Amount', ''],
        rows.map((r) => `<tr>
          <td>${this.esc(String(r.txn_date || r.date || '').slice(0, 10))}</td>
          <td>${this.tag(r.txn_type || 'capital', 'info')}</td>
          <td>${this.esc(r.description || '—')}</td>
          <td>${this.money(r.amount)}</td>
          <td></td>
        </tr>`).join(''), 'No owner equity transactions'), '', true)}`;
  },

  async renderReconciliation(el) {
    const data = await this.apiCall('accReconcileCentre', this.filterScope());
    const tasks = data?.tasks || (data?.items || []).map((i) => ({
      level: i.status === 'bad' ? 'bad' : (i.status === 'warn' ? 'warn' : 'info'),
      message: `${i.area}: ${i.detail}`,
      section: i.area === 'Bank' ? 'bank-reconciliation' : (i.area === 'POS sync' ? 'integrations' : (i.area === 'Approvals' ? 'approvals' : 'trial-balance'))
    }));
    el.innerHTML = `
      ${this.sectionHead(this.btn('Bank Rec', 'nav', { section: 'bank-reconciliation' }, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      <div class="acc-kpis">
        ${this.kpi('Bank unmatched', String(data?.bank_unmatched || 0), 'Lines to match', 'warn')}
        ${this.kpi('AR open', this.money(data?.ar_open), 'Customer invoices', 'info')}
        ${this.kpi('AP open', this.money(data?.ap_open), 'Supplier bills', 'info')}
        ${this.kpi('Stock variance', this.money(data?.stock_variance), 'Count vs system', 'slate')}
      </div>
      ${this.panel('Reconciliation tasks', tasks.map((t) =>
        `<div class="acc-alert ${this.esc(t.level || 'info')}"><span>${this.esc(t.message)}</span>${t.section ? this.btn('Open', 'nav', { section: t.section }) : ''}</div>`).join('') || '<div class="acc-empty">All reconciliations up to date.</div>')}`;
  },

  async renderApprovals(el) {
    const rows = await this.listApi('accApprovals', this.filterScope());
    el.innerHTML = `
      ${this.sectionHead(this.btn('Refresh', 'refresh'))}
      ${this.filterBarHtml()}
      ${this.panel('', this.table(['Date', 'Type', 'Reference', 'Amount', 'Submitted by', 'Status', ''],
        rows.map((r) => `<tr>
          <td>${this.esc(String(r.date || r.created_at || '').slice(0, 10))}</td>
          <td>${this.tag(r.type, 'info')}</td>
          <td>${this.esc(r.reference || r.id)}</td>
          <td>${this.money(r.amount)}</td>
          <td>${this.esc(r.submitted_by || '—')}</td>
          <td><span class="acc-approval-pill ${this.esc(String(r.status || 'pending').toLowerCase())}">${this.esc(r.status || 'pending')}</span></td>
          <td>${r.status === 'pending' ? this.rowBtns(this.btn('Approve', 'approve', { id: r.id }) + this.btn('Reject', 'reject', { id: r.id })) : ''}</td>
        </tr>`).join(''), 'No approvals in queue'), '', true)}`;
  },

  async renderPayrollSummary(el) {
    const data = await this.apiCall('accPayroll') || {};
    const runs = Array.isArray(data.records) ? data.records : (Array.isArray(data.runs) ? data.runs : []);
    const liabilities = data.month_totals || {};
    const section = this.section;
    let body = '';
    if (section === 'payroll-employees') {
      body = this.table(['Code', 'Employee', 'Period', 'Gross', 'Net', 'Status'],
        runs.map((e) => `<tr><td>${this.esc(e.employee_code || '—')}</td><td>${this.esc(e.full_name || e.employee_name)}</td>
          <td>${this.esc(String(e.period_end || e.period || '').slice(0, 10))}</td>
          <td>${this.money(e.gross_salary || e.gross)}</td><td>${this.money(e.net_salary || e.net)}</td><td>${this.tag(e.status || 'active')}</td></tr>`).join(''),
        'No payroll employees — run payroll in HR workspace');
    } else if (section === 'payroll-liabilities') {
      body = this.panel('This month', `<p>PAYE: ${this.money(liabilities.paye)} · UIF: ${this.money(liabilities.uif)} · SDL: ${this.money(liabilities.sdl)}</p>
        <p>Paid net: ${this.money(liabilities.paid_net)}</p>`);
    } else {
      body = this.table(['Period', 'Employee', 'Gross', 'Net', 'Status', ''],
        runs.map((r) => `<tr><td>${this.esc(String(r.period_end || r.pay_period || '').slice(0, 10))}</td><td>${this.esc(r.full_name || r.employee_name)}</td>
          <td>${this.money(r.gross_salary || r.gross)}</td><td>${this.money(r.net_salary || r.net)}</td><td>${this.tag(r.status || 'draft')}</td>
          <td>${r.status === 'paid' ? this.rowBtns(this.btn('Post', 'post-payroll', { id: r.id })) : ''}</td></tr>`).join(''),
        'No payroll runs — generate payroll in HR workspace');
    }
    el.innerHTML = `${this.sectionHead(this.btn('Open HR Workspace', 'open-hr', {}, 'btn-primary') + this.btn('Sync integrations', 'sync-missing', {}, 'btn-ghost'))}
      <p class="muted">Payroll is managed in HR. Posted payroll journals appear here and in the general ledger.</p>
      ${this.panel('', body, '', true)}`;
  },

  async renderAuditLog(el) {
    const rows = await this.listApi('accAudit', this.filterScope());
    el.innerHTML = `
      ${this.sectionHead(this.btn('Refresh', 'refresh'))}
      ${this.filterBarHtml()}
      ${this.panel('', this.table(['When', 'User', 'Action', 'Entity', 'Detail'],
        rows.map((r) => `<tr>
          <td>${this.esc(String(r.created_at || r.when || '').slice(0, 19).replace('T', ' '))}</td>
          <td>${this.esc(r.user_name || r.user || '—')}</td>
          <td>${this.tag(r.action, 'muted')}</td>
          <td>${this.esc(r.entity_type || r.entity || '—')}</td>
          <td class="acc-truncate">${this.esc(r.detail || r.summary || '—')}</td>
        </tr>`).join(''), 'No audit entries'), '', true)}`;
  },

  async renderIntegrations(el) {
    const rows = await this.listApi('accIntegrations', this.filterScope());
    el.innerHTML = `
      ${this.sectionHead(this.btn('Refresh', 'refresh'))}
      ${this.panel('', this.table(['When', 'Integration', 'Error', ''],
        rows.map((r) => `<tr>
          <td>${this.esc(String(r.created_at || '').slice(0, 19).replace('T', ' '))}</td>
          <td>${this.esc(r.integration || r.source || '—')}</td>
          <td class="acc-truncate">${this.esc(r.error || r.message)}</td>
          <td>${this.rowBtns(this.btn('Retry', 'retry-integration', { id: r.id }))}</td>
        </tr>`).join(''), 'No integration errors'), '', true)}`;
  },

  async renderUsersPermissions(el) {
    const settings = await this.apiCall('accSettings') || {};
    const users = settings.users || settings.accounting_users || [];
    el.innerHTML = `
      ${this.sectionHead(this.btn('Add user', 'new-acc-user', {}, 'btn-primary') + this.btn('Refresh', 'refresh'))}
      <div id="acc-inline-form"></div>
      ${this.panel('', this.table(['Username', 'Name', 'Role', 'Status', ''],
        (Array.isArray(users) ? users : []).map((u) => `<tr>
          <td>${this.esc(u.username)}</td>
          <td>${this.esc(u.full_name || u.name)}</td>
          <td>${this.tag(u.role, 'info')}</td>
          <td>${this.statusTag(u.is_active === 0 || u.is_active === false ? 'inactive' : (u.status || 'active'))}</td>
          <td>${this.rowBtns(this.btn('Edit', 'edit-acc-user', { id: u.id }))}</td>
        </tr>`).join(''), 'No accounting users configured'), '', true)}`;
  },

  async renderSettings(el) {
    const s = await this.apiCall('accSettings') || {};
    el.innerHTML = `
      ${this.sectionHead(this.btn('Save settings', 'save-settings', {}, 'btn-primary'))}
      ${this.panel('General', this.grid([
        this.fld('acc-set-basis', 'Accounting basis', { value: s.accounting_basis || 'accrual', options: [['accrual', 'Accrual'], ['cash', 'Cash']] }),
        this.fld('acc-set-currency', 'Currency', { value: s.currency || 'ZAR' }),
        this.fld('acc-set-fy-start', 'Financial year start month', { type: 'number', value: s.fy_start_month || 3, attrs: 'min="1" max="12"' }),
        this.fld('acc-set-vat', 'VAT registered', { type: 'checkbox', value: !!s.vat_registered }),
        this.fld('acc-set-vat-no', 'VAT number', { value: s.vat_number || '' }),
        this.fld('acc-set-inv-prefix', 'Invoice prefix', { value: s.invoice_prefix || 'INV-' }),
        this.fld('acc-set-bill-prefix', 'Bill prefix', { value: s.bill_prefix || 'BILL-' })
      ]))}`;
  },

  groupBy(rows, key) {
    const map = new Map();
    rows.forEach((r) => {
      const k = r[key] || 'Other';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    return [...map.entries()];
  },

  async doGlobalSearch(q) {
    if (!q) return;
    const data = await this.apiCall('accSearch', q);
    const flat = [];
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      Object.entries(data).forEach(([type, list]) => {
        (list || []).forEach((r) => flat.push({
          type: r.kind || type.replace(/s$/, ''),
          id: r.id,
          label: r.ref || r.name || r.description,
          amount: r.total ?? r.amount
        }));
      });
    }
    const rows = flat.length ? flat : (data?.results || data?.rows || (Array.isArray(data) ? data : []));
    this.openInfo(`Search: ${q}`, rows.length ? `<div class="acc-drill-list">${rows.map((r) =>
      `<div class="acc-drill-row" data-acc-act="search-open" data-type="${this.esc(r.type)}" data-id="${this.esc(r.id)}">
        <span>${this.esc(r.label || r.title || r.reference)}</span><span>${this.money(r.amount)}</span>
      </div>`).join('')}</div>` : '<div class="acc-empty">No results found.</div>');
  },

  async showDrillDown(metric) {
    const data = await this.apiCall('accDrillDown', { metric, ...this.filterScope() });
    if (!data) return;
    const rows = data.rows || data.items || data.breakdown || [];
    this.openInfo(data.title || metric, `
      ${data.summary ? `<div class="acc-note">${this.esc(data.summary)}</div>` : ''}
      <div class="acc-drill-list">${rows.map((r) =>
        `<div class="acc-drill-row" data-acc-act="drill-child" data-metric="${this.esc(r.metric || metric)}" data-key="${this.esc(r.key || r.id)}">
          <span>${this.esc(r.label || r.name)}</span><strong>${this.money(r.amount ?? r.value)}</strong>
        </div>`).join('') || '<div class="acc-empty">No breakdown available.</div>'}
      </div>`);
  },

  /* ─── Transaction forms ──────────────────────────────────────────────── */

  formInvoice(type = 'invoice') {
    return this.grid([
      this.fld('acc-txn-date', 'Date', { type: 'date', value: this.today() }),
      this.fld('acc-txn-party', type.includes('supplier') ? 'Supplier' : 'Customer', { placeholder: 'Name or ID' }),
      this.fld('acc-txn-ref', 'Reference', { placeholder: 'Optional' }),
      this.fld('acc-txn-amount', 'Amount', { type: 'number', value: '0', attrs: 'step="0.01" min="0"' }),
      this.fld('acc-txn-memo', 'Notes', { rows: 2, full: true })
    ]);
  },

  formPayment(type = 'customer') {
    return this.grid([
      this.fld('acc-txn-date', 'Date', { type: 'date', value: this.today() }),
      this.fld('acc-txn-party', type === 'supplier' ? 'Supplier' : 'Customer', {}),
      this.fld('acc-txn-ref', 'Reference', {}),
      this.fld('acc-txn-amount', 'Amount', { type: 'number', attrs: 'step="0.01" min="0"' }),
      this.fld('acc-txn-method', 'Method', { options: [['cash', 'Cash'], ['card', 'Card'], ['eft', 'EFT'], ['other', 'Other']] })
    ]);
  },

  formJournal() {
    return this.grid([
      this.fld('acc-jnl-date', 'Date', { type: 'date', value: this.today() }),
      this.fld('acc-jnl-ref', 'Reference', {}),
      this.fld('acc-jnl-memo', 'Description', { rows: 2, full: true }),
      this.fld('acc-jnl-debit-acct', 'Debit account code', {}),
      this.fld('acc-jnl-credit-acct', 'Credit account code', {}),
      this.fld('acc-jnl-amount', 'Amount', { type: 'number', attrs: 'step="0.01" min="0"' })
    ]);
  },

  formBankTxn() {
    return this.grid([
      this.fld('acc-btx-date', 'Date', { type: 'date', value: this.today() }),
      this.fld('acc-btx-account', 'Bank account ID', {}),
      this.fld('acc-btx-desc', 'Description', {}),
      this.fld('acc-btx-amount', 'Amount', { type: 'number', attrs: 'step="0.01"' }),
      this.fld('acc-btx-type', 'Type', { options: [['deposit', 'Deposit'], ['withdrawal', 'Withdrawal'], ['fee', 'Fee']] })
    ]);
  },

  formAccount(edit) {
    return this.grid([
      this.fld('acc-acct-code', 'Code', { value: edit?.code || '' }),
      this.fld('acc-acct-name', 'Name', { value: edit?.name || '' }),
      this.fld('acc-acct-type', 'Type', { value: edit?.type || 'expense', options: [['asset', 'Asset'], ['liability', 'Liability'], ['equity', 'Equity'], ['income', 'Income'], ['expense', 'Expense']] }),
      this.fld('acc-acct-desc', 'Description', { rows: 2, value: edit?.description || '', full: true })
    ]);
  },

  ACT: {
    'login-submit': function () { return this.doLogin(); },
    'login-forgot': function () { this.toast('Contact the business owner to reset your accounting password.', 'info'); },
    close: function () { this.closeApp(); },
    'nav-toggle': function () {
      this._navOpen = !this._navOpen;
      document.querySelector('.acc-shell')?.classList.toggle('acc-nav-open', this._navOpen);
    },
    'nav-close': function () {
      this._navOpen = false;
      document.querySelector('.acc-shell')?.classList.remove('acc-nav-open');
    },
    nav: function (d) {
      if (d.section) {
        this.section = d.section;
        this._navOpen = false;
        document.querySelector('.acc-shell')?.classList.remove('acc-nav-open');
        this.refreshSection();
      }
    },
    refresh: function () { return this.refreshSection(); },
    range: function (d) {
      if (d.preset === 'custom') { this.filters.range = 'custom'; this.refreshSection(); return; }
      this.setRange(d.preset);
    },
    'apply-range': function () {
      this.filters.from = this.val('acc-f-from') || this.filters.from;
      this.filters.to = this.val('acc-f-to') || this.filters.to;
      this.clearCache();
      this.refreshSection();
    },
    'apply-filters': function () {
      this.filters.branchId = this.val('acc-filter-branch') || '';
      this.filters.from = this.val('acc-filter-from') || this.filters.from;
      this.filters.to = this.val('acc-filter-to') || this.filters.to;
      this.clearCache();
      this.refreshSection();
    },
    'reset-filters': function () {
      this.filters = { from: this.monthStart(), to: this.today(), branchId: '', range: 'month' };
      this.clearCache();
      this.refreshSection();
    },
    'new-txn-toggle': function (_, btn) {
      const wrap = btn?.closest('.acc-dropdown-wrap');
      wrap?.classList.toggle('open');
    },
    drill: function (d) { return this.showDrillDown(d.metric); },
    'drill-child': function (d) { return this.showDrillDown(d.metric || d.key); },
    'search-open': function (d) {
      Utils?.hideModal?.();
      if (d.type && this.SECTION_META[d.type]) { this.section = d.type; this.refreshSection(); }
    },
    'txn-invoice': function () {
      this.openForm('New Invoice', this.formInvoice('invoice'), async () => {
        const payload = { type: 'invoice', date: this.val('acc-txn-date'), customer: this.val('acc-txn-party'), reference: this.val('acc-txn-ref'), amount: this.numVal('acc-txn-amount'), notes: this.val('acc-txn-memo') };
        const r = await this.apiCall('accSaveInvoice', payload);
        if (r == null) return false;
        this.toast('Invoice saved', 'success');
        return true;
      }, 'Save Invoice');
    },
    'txn-expense': function () {
      this.openForm('New Expense', this.formPayment('expense'), async () => {
        const payload = { type: 'expense', date: this.val('acc-txn-date'), category: this.val('acc-txn-party'), reference: this.val('acc-txn-ref'), amount: this.numVal('acc-txn-amount'), method: this.val('acc-txn-method') };
        const r = await this.apiCall('accRecordExpense', payload);
        if (r == null) return false;
        this.toast('Expense recorded', 'success');
        return true;
      }, 'Save Expense');
    },
    'txn-payment': function () {
      this.openForm('Record Payment', this.formPayment('customer'), async () => {
        const payload = { type: 'customer', date: this.val('acc-txn-date'), party: this.val('acc-txn-party'), reference: this.val('acc-txn-ref'), amount: this.numVal('acc-txn-amount'), method: this.val('acc-txn-method') };
        const r = await this.apiCall('accSavePayment', payload);
        if (r == null) return false;
        this.toast('Payment saved', 'success');
        return true;
      }, 'Save Payment');
    },
    'txn-bill': function () {
      this.openForm('New Supplier Bill', this.formInvoice('supplier'), async () => {
        const payload = { type: 'bill', date: this.val('acc-txn-date'), supplier: this.val('acc-txn-party'), reference: this.val('acc-txn-ref'), amount: this.numVal('acc-txn-amount'), notes: this.val('acc-txn-memo') };
        const r = await this.apiCall('accSaveBill', payload);
        if (r == null) return false;
        this.toast('Bill saved', 'success');
        return true;
      }, 'Save Bill');
    },
    'txn-receipt': function () {
      this.openForm('Customer Receipt', this.formPayment('customer'), async () => {
        const payload = { type: 'receipt', date: this.val('acc-txn-date'), customer: this.val('acc-txn-party'), reference: this.val('acc-txn-ref'), amount: this.numVal('acc-txn-amount'), method: this.val('acc-txn-method') };
        const r = await this.apiCall('accSavePayment', payload);
        if (r == null) return false;
        this.toast('Receipt saved', 'success');
        return true;
      }, 'Save Receipt');
    },
    'txn-journal': function () {
      this.openForm('New Journal', this.formJournal(), async () => {
        const payload = { date: this.val('acc-jnl-date'), reference: this.val('acc-jnl-ref'), description: this.val('acc-jnl-memo'), lines: [
          { account_code: this.val('acc-jnl-debit-acct'), debit: this.numVal('acc-jnl-amount') },
          { account_code: this.val('acc-jnl-credit-acct'), credit: this.numVal('acc-jnl-amount') }
        ] };
        const r = await this.apiCall('accPostJournal', payload);
        if (r == null) return false;
        this.toast('Journal saved', 'success');
        return true;
      }, 'Save Journal');
    },
    'txn-stock': async function () {
      let prodList = [];
      try {
        const r = await API.getProducts?.({});
        prodList = Array.isArray(r?.data) ? r.data : (Array.isArray(r) ? r : []);
      } catch (_) { /* ignore */ }
      const prodOptions = prodList.slice(0, 300).map((p) => [String(p.id), `${p.name}${p.barcode ? ` (${p.barcode})` : ''}`]);
      this.openForm('Stock Adjustment', this.grid([
        this.fld('acc-stk-product', 'Product', { options: [['', 'Select product…'], ...prodOptions] }),
        this.fld('acc-stk-direction', 'Direction', { options: [['add', 'Add stock'], ['remove', 'Remove stock'], ['set', 'Set absolute quantity']] }),
        this.fld('acc-stk-qty', 'Quantity', { type: 'number', attrs: 'step="1" min="0"' }),
        this.fld('acc-stk-reason', 'Reason', { rows: 2, full: true })
      ]), async () => {
        const productId = parseInt(this.val('acc-stk-product'), 10);
        if (!productId) { this.toast('Select a product', 'error'); return false; }
        const direction = this.val('acc-stk-direction') || 'add';
        const qty = this.numVal('acc-stk-qty');
        if (!qty && direction !== 'set') { this.toast('Enter a quantity', 'error'); return false; }
        const r = await this.apiCall('accRecordStockAdjustment', {
          product_id: productId,
          qty,
          direction,
          reason: this.val('acc-stk-reason') || 'Accounting stock adjustment'
        });
        if (r == null) return false;
        this.toast(`Stock updated — new qty: ${r.new_stock}`, 'success');
        return true;
      }, 'Save Adjustment');
    },
    'txn-bank': function () {
      this.openForm('Bank Transaction', this.formBankTxn(), async () => {
        const payload = { date: this.val('acc-btx-date'), bank_account_id: this.val('acc-btx-account'), description: this.val('acc-btx-desc'), amount: this.numVal('acc-btx-amount'), type: this.val('acc-btx-type') };
        const r = await this.apiCall('accSaveBankTxn', payload);
        if (r == null) return false;
        this.toast('Bank transaction saved', 'success');
        return true;
      }, 'Save Transaction');
    },
    'txn-credit': function () {
      this.openForm('Credit Note', this.formInvoice('credit'), async () => {
        const payload = {
          note_date: this.val('acc-txn-date'),
          customer_id: parseInt(this.val('acc-txn-party'), 10) || null,
          customer_name: this.val('acc-txn-party'),
          reason: this.val('acc-txn-memo') || this.val('acc-txn-ref'),
          total: this.numVal('acc-txn-amount'),
          tax_total: 0
        };
        const r = await this.apiCall('accSaveCreditNote', payload);
        if (r == null) return false;
        this.toast('Credit note saved', 'success');
        return true;
      }, 'Save Credit Note');
    },
    'txn-debit': function () {
      this.openForm('Debit Note', this.formInvoice('debit'), async () => {
        const payload = {
          note_date: this.val('acc-txn-date'),
          supplier_id: parseInt(this.val('acc-txn-party'), 10) || null,
          supplier_name: this.val('acc-txn-party'),
          reason: this.val('acc-txn-memo') || this.val('acc-txn-ref'),
          total: this.numVal('acc-txn-amount'),
          tax_total: 0
        };
        const r = await this.apiCall('accSaveDebitNote', payload);
        if (r == null) return false;
        this.toast('Debit note saved', 'success');
        return true;
      }, 'Save Debit Note');
    },
    'new-doc': function (d) {
      const cfg = this.LIST_CFG[d.section || this.section];
      if (!cfg?.save) { this.toast('Create not available for this section', 'info'); return; }
      const type = cfg.type || this.section;
      if (type === 'credit_note') return this.ACT['txn-credit'].call(this);
      if (type === 'debit_note') return this.ACT['txn-debit'].call(this);
      if (type.includes('invoice') || type === 'receipt') return this.ACT['txn-invoice'].call(this);
      if (type === 'bill' || type === 'purchase_order') return this.ACT['txn-bill'].call(this);
      if (type === 'expense' || type === 'recurring') return this.ACT['txn-expense'].call(this);
      if (type.includes('payment') || type === 'customer' || type === 'supplier' || type === 'refund') return this.ACT['txn-payment'].call(this);
      if (type === 'stock_adjustment') return this.ACT['txn-stock'].call(this);
      this.openForm(cfg.newLabel || 'New record', this.formInvoice(type), async () => {
        const r = await this.apiCall(cfg.save, { type, date: this.val('acc-txn-date'), amount: this.numVal('acc-txn-amount'), reference: this.val('acc-txn-ref') });
        if (r == null) return false;
        this.toast('Saved', 'success');
        return true;
      });
    },
    'new-account': function () {
      this.openForm('New Account', this.formAccount(), async () => {
        const payload = { code: this.val('acc-acct-code'), name: this.val('acc-acct-name'), type: this.val('acc-acct-type'), description: this.val('acc-acct-desc') };
        const r = await this.apiCall('accSaveAccount', payload);
        if (r == null) return false;
        this.toast('Account saved', 'success');
        return true;
      });
    },
    'edit-account': async function (d) {
      const accounts = await this.listApi('accAccounts', {});
      const edit = accounts.find((a) => String(a.id) === String(d.id));
      this.openForm('Edit Account', this.formAccount(edit), async () => {
        const payload = { id: d.id, code: this.val('acc-acct-code'), name: this.val('acc-acct-name'), type: this.val('acc-acct-type'), description: this.val('acc-acct-desc') };
        const r = await this.apiCall('accSaveAccount', payload);
        if (r == null) return false;
        this.toast('Account updated', 'success');
        return true;
      });
    },
    'post-doc': async function (d) {
      const sec = d.section || this.section;
      const cfg = this.LIST_CFG[sec];
      if (!cfg?.post) return;
      const r = await this.apiCall(cfg.post, { id: d.id });
      if (r != null) { this.toast('Posted', 'success'); this.refreshSection(); }
    },
    'post-journal': async function (d) {
      const r = await this.apiCall('accPostJournal', { id: d.id });
      if (r != null) { this.toast('Journal posted', 'success'); this.refreshSection(); }
    },
    'reverse-journal': async function (d) {
      const r = await this.apiCall('accReverseJournal', { id: d.id });
      if (r != null) { this.toast('Journal reversed', 'success'); this.refreshSection(); }
    },
    'view-journal': async function (d) {
      const j = await this.apiCall('accGetJournal', { id: d.id });
      if (!j) return;
      const lines = j.lines || [];
      this.openInfo(`Journal ${j.reference || j.id}`, this.table(['Account', 'Debit', 'Credit'],
        lines.map((l) => `<tr><td>${this.esc(l.account_name || l.account_code)}</td><td>${this.money(l.debit)}</td><td>${this.money(l.credit)}</td></tr>`).join(''),
        'No lines'));
    },
    approve: async function (d) {
      const r = await this.apiCall('accDecideApproval', { id: d.id, decision: 'approved' });
      if (r != null) { this.toast('Approved', 'success'); this.refreshSection(); }
    },
    reject: async function (d) {
      const r = await this.apiCall('accDecideApproval', { id: d.id, decision: 'rejected' });
      if (r != null) { this.toast('Rejected', 'success'); this.refreshSection(); }
    },
    'confirm-ocr': async function (d) {
      const r = await this.apiCall('accConfirmOcr', { id: d.id, confirmed: true });
      if (r != null) { this.toast('OCR confirmed', 'success'); this.refreshSection(); }
    },
    'reject-ocr': async function (d) {
      const r = await this.apiCall('accConfirmOcr', { id: d.id, confirmed: false });
      if (r != null) { this.toast('Document rejected', 'success'); this.refreshSection(); }
    },
    'retry-integration': async function (d) {
      const r = await this.apiCall('accRetryIntegration', { id: d.id });
      if (r != null) { this.toast('Retry queued', 'success'); this.refreshSection(); }
    },
    'open-hr': async function () {
      await this.app?.openHr?.({ fromApp: true, skipLogin: true });
    },
    'post-payroll': async function (d) {
      if (!API.hrPostPayrollAccounting) return this.toast('HR payroll API unavailable', 'error');
      const r = await API.hrPostPayrollAccounting(d.id, this.app?.user || this.user);
      if (r?.success === false) return this.toast(r.error || 'Post failed', 'error');
      this.toast('Payroll posted to accounting', 'success');
      this.refreshSection();
    },
    'sync-missing': async function () {
      const r = await this.apiCall('accSyncMissing');
      if (r != null) this.toast('Integration sync complete', 'success');
      this.refreshSection();
    },
    'download-doc': async function (d) {
      const file = await this.apiCall('accGetDocumentFile', { id: d.id });
      if (!file?.file_base64) return this.toast('Download failed', 'error');
      const mime = file.mime_type || 'application/octet-stream';
      const name = (file.title || `document-${d.id}`).replace(/[^\w.\-]+/g, '_');
      const blob = new Blob([Uint8Array.from(atob(file.file_base64), (c) => c.charCodeAt(0))], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      this.toast('Download started', 'success');
    },
    'new-other-income': function () {
      this.openForm('Record Other Income', `
        ${this.fld('acc-txn-date', 'Date', { type: 'date', value: new Date().toISOString().slice(0, 10) })}
        ${this.fld('acc-txn-type', 'Type', { value: 'other' })}
        ${this.fld('acc-txn-memo', 'Description')}
        ${this.fld('acc-txn-amount', 'Amount', { type: 'number' })}
        ${this.fld('acc-txn-method', 'Payment method', { value: 'cash' })}`, async () => {
        const r = await this.apiCall('accSaveOtherIncome', {
          income_date: this.val('acc-txn-date'),
          income_type: this.val('acc-txn-type') || 'other',
          description: this.val('acc-txn-memo'),
          amount: this.numVal('acc-txn-amount'),
          payment_method: this.val('acc-txn-method') || 'cash'
        });
        if (r == null) return false;
        this.toast('Income recorded', 'success');
        return true;
      });
    },
    'new-loan': function () {
      this.openForm('Add Loan', `
        ${this.fld('acc-loan-lender', 'Lender')}
        ${this.fld('acc-loan-principal', 'Principal', { type: 'number' })}
        ${this.fld('acc-loan-rate', 'Interest rate %', { type: 'number' })}
        ${this.fld('acc-loan-term', 'Term (months)', { type: 'number' })}
        ${this.fld('acc-loan-installment', 'Monthly installment', { type: 'number' })}`, async () => {
        const r = await this.apiCall('accSaveLoan', {
          lender: this.val('acc-loan-lender'),
          principal: this.numVal('acc-loan-principal'),
          interest_rate: this.numVal('acc-loan-rate'),
          term_months: parseInt(this.val('acc-loan-term'), 10) || null,
          installment_amount: this.numVal('acc-loan-installment')
        });
        if (r == null) return false;
        this.toast('Loan saved', 'success');
        return true;
      });
    },
    'loan-payment': function (d) {
      this.openForm('Record Loan Payment', `
        ${this.fld('acc-loan-pay-date', 'Date', { type: 'date', value: new Date().toISOString().slice(0, 10) })}
        ${this.fld('acc-loan-pay-principal', 'Principal portion', { type: 'number' })}
        ${this.fld('acc-loan-pay-interest', 'Interest portion', { type: 'number' })}
        ${this.fld('acc-loan-pay-method', 'Payment method', { value: 'eft' })}`, async () => {
        const r = await this.apiCall('accLoanPayment', {
          loan_id: d.id,
          payment_date: this.val('acc-loan-pay-date'),
          principal_amount: this.numVal('acc-loan-pay-principal'),
          interest_amount: this.numVal('acc-loan-pay-interest'),
          payment_method: this.val('acc-loan-pay-method') || 'eft'
        });
        if (r == null) return false;
        this.toast('Loan payment recorded', 'success');
        return true;
      });
    },
    'new-owner-txn': function () {
      this.openForm('Owner Equity Transaction', `
        ${this.fld('acc-owner-date', 'Date', { type: 'date', value: new Date().toISOString().slice(0, 10) })}
        ${this.fld('acc-owner-type', 'Type', { options: [['capital', 'Capital injection'], ['drawing', 'Drawing'], ['loan_to_owner', 'Loan to owner']] })}
        ${this.fld('acc-owner-desc', 'Description')}
        ${this.fld('acc-owner-amount', 'Amount', { type: 'number' })}
        ${this.fld('acc-owner-method', 'Payment method', { value: 'cash' })}`, async () => {
        const r = await this.apiCall('accSaveOwnerTxn', {
          txn_date: this.val('acc-owner-date'),
          txn_type: this.val('acc-owner-type') || 'capital',
          description: this.val('acc-owner-desc'),
          amount: this.numVal('acc-owner-amount'),
          payment_method: this.val('acc-owner-method') || 'cash'
        });
        if (r == null) return false;
        this.toast('Owner transaction saved', 'success');
        return true;
      });
    },
    'close-period': async function (d) {
      const r = await this.apiCall('accClosePeriod', { id: d.id });
      if (r != null) { this.toast('Period closed', 'success'); this.refreshSection(); }
    },
    'year-end': async function () {
      const r = await this.apiCall('accYearEnd');
      if (r != null) { this.toast('Year-end processed', 'success'); this.refreshSection(); }
    },
    'import-bank-stmt': async function () {
      const accounts = await this.apiCall('accBankAccounts', {});
      const acctList = Array.isArray(accounts) ? accounts : (accounts?.rows || []);
      const options = acctList.map((a) => [String(a.id), `${a.name || 'Account'} #${a.account_number || a.id}`]);
      this.openForm('Import Bank Statement', `
        ${this.grid([
          this.fld('acc-import-account', 'Bank account', { type: 'select', options: options.length ? options : [['1', 'Main account']] }),
          '<div class="field full"><label>Statement file (CSV / OFX)</label><input type="file" id="acc-import-file-input" accept=".csv,.ofx,.qfx,.txt"></div>'
        ])}
        <p class="muted" style="margin-top:8px">Upload a bank export. Lines are parsed for preview, then imported as unmatched statement lines.</p>
      `, async () => {
        const fileInput = document.getElementById('acc-import-file-input');
        const file = fileInput?.files?.[0];
        const bankId = parseInt(this.val('acc-import-account'), 10);
        if (!bankId) { this.toast('Select a bank account', 'error'); return false; }
        if (!file) { this.toast('Choose a CSV or OFX file', 'error'); return false; }
        const text = await file.text();
        const parsed = await this.apiCall('accParseBankStmt', { text, filename: file.name });
        const lines = parsed?.lines || [];
        if (!lines.length) { this.toast('No transactions found in file', 'error'); return false; }
        const preview = lines.slice(0, 5).map((l) => `${l.line_date}: ${l.description} ${this.money(l.amount)}`).join('\n');
        if (!window.confirm(`Import ${lines.length} line(s)?\n\nPreview:\n${preview}`)) return false;
        const r = await this.apiOk(API.accImportBankStmt(bankId, lines, this.user), 'Import failed');
        if (r == null) return false;
        this.toast(`Imported ${r.imported || lines.length} line(s)`, 'success');
        return true;
      }, 'Import');
    },
    'reconcile-line': function (d) {
      this.openForm('Match Bank Line', this.grid([
        this.fld('acc-match-txn', 'Bank transaction ID', { placeholder: 'Ledger bank txn to match', value: d.suggested_txn_id || '' }),
        `<p class="muted">Line #${this.esc(d.id)} · ${this.money(d.amount)} · ${this.esc(d.description || '')}</p>`
      ]), async () => {
        const txnId = parseInt(this.val('acc-match-txn'), 10) || null;
        const r = await this.apiCall('accMatchBankStmt', { id: d.id, txn_id: txnId });
        if (r == null) return false;
        this.toast('Line matched', 'success');
        this.refreshSection();
        return true;
      }, 'Match');
    },
    'save-settings': async function () {
      const payload = {
        accounting_basis: this.val('acc-set-basis'),
        currency: this.val('acc-set-currency'),
        fy_start_month: parseInt(this.val('acc-set-fy-start'), 10),
        vat_registered: this.chk('acc-set-vat'),
        vat_number: this.val('acc-set-vat-no'),
        invoice_prefix: this.val('acc-set-inv-prefix'),
        bill_prefix: this.val('acc-set-bill-prefix')
      };
      const r = await this.apiCall('accSaveSettings', payload);
      if (r != null) this.toast('Settings saved', 'success');
    },
    'gen-customer-stmt': async function () {
      const id = this.val('acc-stmt-customer');
      if (!id) { this.toast('Enter a customer ID', 'error'); return; }
      const r = await this.apiCall('accCustomerStatement', { customer_id: id, ...this.filterScope() });
      if (!r) return;
      await this.apiCall('accSaveStatement', { party_type: 'customer', party_id: parseInt(id, 10), statement: r });
      const rows = [
        ...(r.invoices || []).map((i) => [String(i.invoice_date || '').slice(0, 10), i.invoice_number || i.id, 'Invoice', String(i.total || 0)]),
        ...(r.payments || []).map((p) => [String(p.payment_date || '').slice(0, 10), p.reference || p.id, 'Payment', `-${p.amount || 0}`])
      ];
      this.cacheExport('customer-statements', `Customer Statement — ${r.customer?.name || id}`, ['Date', 'Reference', 'Type', 'Amount'], rows);
      const html = `<div class="acc-note">Opening: ${this.money(r.opening_balance)} · Closing: <strong>${this.money(r.closing_balance)}</strong></div>
        ${this.table(['Date', 'Reference', 'Type', 'Amount'], rows.map((row) => `<tr>${row.map((c) => `<td>${this.esc(c)}</td>`).join('')}</tr>`).join(''), 'No transactions')}
        <div class="acc-quick-actions" style="margin-top:12px">${this.btn('Print', 'print-customer-statements')}${this.btn('Save PDF', 'export-customer-statements', {}, 'btn-primary')}</div>`;
      this.openInfo('Customer Statement', html);
      this.refreshSection();
    },
    'gen-supplier-stmt': async function () {
      const id = this.val('acc-stmt-supplier');
      if (!id) { this.toast('Enter a supplier ID', 'error'); return; }
      const r = await this.apiCall('accSupplierStatement', { supplier_id: id, ...this.filterScope() });
      if (!r) return;
      await this.apiCall('accSaveStatement', { party_type: 'supplier', party_id: parseInt(id, 10), statement: r });
      const rows = [
        ...(r.bills || []).map((b) => [String(b.bill_date || '').slice(0, 10), b.bill_number || b.id, 'Bill', String(b.total || 0)]),
        ...(r.payments || []).map((p) => [String(p.payment_date || '').slice(0, 10), p.reference || p.id, 'Payment', `-${p.amount || 0}`])
      ];
      this.cacheExport('supplier-statements', `Supplier Statement — ${r.supplier?.name || id}`, ['Date', 'Reference', 'Type', 'Amount'], rows);
      const html = `<div class="acc-note">Closing balance: <strong>${this.money(r.closing_balance)}</strong></div>
        ${this.table(['Date', 'Reference', 'Type', 'Amount'], rows.map((row) => `<tr>${row.map((c) => `<td>${this.esc(c)}</td>`).join('')}</tr>`).join(''), 'No transactions')}
        <div class="acc-quick-actions" style="margin-top:12px">${this.btn('Print', 'print-supplier-statements')}${this.btn('Save PDF', 'export-supplier-statements', {}, 'btn-primary')}</div>`;
      this.openInfo('Supplier Statement', html);
      this.refreshSection();
    },
    'view-stmt': async function (d) {
      const r = await this.apiCall('accGetStatement', { id: d.id });
      if (!r) return;
      let stmt = r.statement;
      if (!stmt && r.statement_json) {
        try { stmt = JSON.parse(r.statement_json); } catch (_) { stmt = {}; }
      }
      stmt = stmt || {};
      const rows = [
        ...(stmt.invoices || stmt.bills || []).map((i) => [String((i.invoice_date || i.bill_date || '').slice(0, 10)), i.invoice_number || i.bill_number || i.id, stmt.bills ? 'Bill' : 'Invoice', String(i.total || 0)]),
        ...(stmt.payments || []).map((p) => [String(p.payment_date || '').slice(0, 10), p.reference || p.id, 'Payment', `-${p.amount || 0}`])
      ];
      const html = `<div class="acc-note">${this.esc(r.party_name || '')} · ${this.esc(String(r.from_date || '').slice(0, 10))} — ${this.esc(String(r.to_date || '').slice(0, 10))} · Closing <strong>${this.money(r.closing_balance)}</strong></div>
        ${this.table(['Date', 'Reference', 'Type', 'Amount'], rows.map((row) => `<tr>${row.map((c) => `<td>${this.esc(c)}</td>`).join('')}</tr>`).join(''), 'No lines')}`;
      this.openInfo('Saved Statement', html);
    },
    'new-bank-account': function () {
      this.openForm('Add Bank Account', this.grid([
        this.fld('acc-bank-name', 'Account name', {}),
        this.fld('acc-bank-inst', 'Bank name', {}),
        this.fld('acc-bank-number', 'Account number', {}),
        this.fld('acc-bank-opening', 'Opening balance', { type: 'number', attrs: 'step="0.01" value="0"' })
      ]), async () => {
        const r = await this.apiCall('accSaveBankAccount', {
          name: this.val('acc-bank-name'),
          bank_name: this.val('acc-bank-inst'),
          account_number: this.val('acc-bank-number'),
          opening_balance: this.numVal('acc-bank-opening'),
          account_type: 'cheque'
        });
        if (r == null) return false;
        this.toast('Bank account added', 'success');
        return true;
      });
    },
    'new-cashbook': function () {
      this.openForm('Cashbook Entry', this.grid([
        this.fld('acc-cb-date', 'Date', { type: 'date', value: this.today() }),
        this.fld('acc-cb-desc', 'Description', {}),
        this.fld('acc-cb-in', 'Money in', { type: 'number', attrs: 'step="0.01" min="0"' }),
        this.fld('acc-cb-out', 'Money out', { type: 'number', attrs: 'step="0.01" min="0"' })
      ]), async () => {
        const r = await this.apiCall('accSaveCashTxn', { action: 'create', date: this.val('acc-cb-date'), description: this.val('acc-cb-desc'), inflow: this.numVal('acc-cb-in'), outflow: this.numVal('acc-cb-out') });
        if (r == null) return false;
        this.toast('Entry added', 'success');
        return true;
      });
    },
    'new-petty': function () {
      this.ACT['txn-expense'].call(this);
    },
    'new-asset': function () {
      this.openForm('Add Asset', this.grid([
        this.fld('acc-asset-code', 'Asset code', {}),
        this.fld('acc-asset-name', 'Name', {}),
        this.fld('acc-asset-cost', 'Purchase cost', { type: 'number', attrs: 'step="0.01" min="0"' }),
        this.fld('acc-asset-date', 'Purchase date', { type: 'date', value: this.today() })
      ]), async () => {
        const r = await this.apiCall('accSaveAsset', { code: this.val('acc-asset-code'), name: this.val('acc-asset-name'), cost: this.numVal('acc-asset-cost'), purchase_date: this.val('acc-asset-date') });
        if (r == null) return false;
        this.toast('Asset added', 'success');
        return true;
      });
    },
    'run-depreciation': async function () {
      const r = await this.apiCall('accRunDepreciation', this.filterScope());
      if (r != null) { this.toast('Depreciation run complete', 'success'); this.refreshSection(); }
    },
    'new-tax-rate': function () {
      this.openForm('Add Tax Rate', this.grid([
        this.fld('acc-tax-code', 'Code', { value: 'VAT' }),
        this.fld('acc-tax-name', 'Name', { value: 'Standard VAT' }),
        this.fld('acc-tax-rate', 'Rate %', { type: 'number', value: '15', attrs: 'step="0.01" min="0"' })
      ]), async () => {
        const r = await this.apiCall('accSaveTaxRate', { code: this.val('acc-tax-code'), name: this.val('acc-tax-name'), rate: this.numVal('acc-tax-rate') });
        if (r == null) return false;
        this.toast('Tax rate saved', 'success');
        return true;
      });
    },
    'upload-doc': function () {
      this.openForm('Upload Document', `
        ${this.grid([
          this.fld('acc-doc-title', 'Title', {}),
          this.fld('acc-doc-type', 'Category', { options: [['bill', 'Supplier bill'], ['invoice', 'Invoice'], ['receipt', 'Receipt'], ['other', 'Other']] }),
          this.fld('acc-doc-number', 'Document number', {}),
          this.fld('acc-doc-issue', 'Issue date', { type: 'date' }),
          this.fld('acc-doc-expiry', 'Expiry date', { type: 'date' }),
          '<div class="field full"><label>File</label><input type="file" id="acc-doc-file-input" accept=".pdf,.png,.jpg,.jpeg,.csv,.txt,.ofx"></div>'
        ])}
        <p class="muted">Text/CSV files are auto-parsed for supplier, date, invoice number and amount. Images/PDFs require manual review unless Tesseract is installed.</p>
      `, async () => {
        const fileInput = document.getElementById('acc-doc-file-input');
        const file = fileInput?.files?.[0];
        if (!file) { this.toast('Choose a file', 'error'); return false; }
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const r = await this.apiCall('accSaveDocument', {
          title: this.val('acc-doc-title') || file.name,
          category: this.val('acc-doc-type'),
          document_number: this.val('acc-doc-number'),
          issue_date: this.val('acc-doc-issue'),
          expiry_date: this.val('acc-doc-expiry'),
          filename: file.name,
          mime_type: file.type,
          file_base64: btoa(binary)
        });
        if (r == null) return false;
        this.toast(r.ocr_status === 'ocr_pending' ? 'Document uploaded — review OCR extraction' : 'Document uploaded', 'success');
        return true;
      }, 'Upload');
    },
    'new-acc-user': function () {
      this.openForm('Add Accounting User', this.grid([
        this.fld('acc-user-name', 'Username', {}),
        this.fld('acc-user-full', 'Full name', {}),
        this.fld('acc-user-role', 'Role', { options: [['bookkeeper', 'Bookkeeper'], ['accountant', 'Accountant'], ['viewer', 'Viewer']] })
      ]), async () => {
        const r = await this.apiCall('accSaveSettings', { action: 'add_user', username: this.val('acc-user-name'), full_name: this.val('acc-user-full'), role: this.val('acc-user-role') });
        if (r == null) return false;
        this.toast('User added', 'success');
        return true;
      });
    }
  }
};

window.AccountingApp = AccountingApp;

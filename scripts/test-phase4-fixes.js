/**
 * Phase 4 verification: accounting menu QA, OCR, permissions, sync reflush.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
require('../lib/load-env').loadProjectEnv(ROOT);

async function main() {
  process.env.SHOP_POS_LOCAL_INSTALLER = '1';
  process.env.SHOP_POS_DATA = path.join(os.homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared');
  delete process.env.DATABASE_URL;
  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();
  const db = dbMod.getDb();
  const session = require('../electron/services/session');
  const acc = require('../electron/services/accounting-platform');
  const central = require('../electron/services/accounting-central');
  const ocr = require('../electron/services/ocr-engine');
  const { hasUserPermission } = require('../electron/services/authz');
  acc.ensureReady();

  const owner = db.prepare("SELECT * FROM users WHERE role='owner' LIMIT 1").get();
  const manager = db.prepare("SELECT * FROM users WHERE role='manager' LIMIT 1").get();
  session.setUserSession(owner);
  const actor = { id: owner.id, role: owner.role, username: owner.username, full_name: owner.full_name };
  const scope = { from: '2026-01-01', to: '2026-12-31' };
  const results = [];

  function ok(name, pass, extra = {}) {
    results.push({ test: name, pass: !!pass, ...extra });
  }

  // 1. Accounting Command Centre — every menu section backend
  const menuChecks = [
    ['dashboard', () => acc.getDashboard(scope, actor)],
    ['financial_health', () => acc.getFinancialHealth(scope, actor)],
    ['chart_of_accounts', () => acc.listAccounts({}, actor)],
    ['general_ledger', () => acc.listLedger(scope, actor)],
    ['journals', () => acc.listJournals(scope, actor)],
    ['trial_balance', () => acc.trialBalance(scope.to, actor)],
    ['periods', () => acc.listPeriods(actor)],
    ['invoices', () => acc.listInvoices(scope, actor)],
    ['credit_notes', () => acc.listCreditNotes(scope, actor)],
    ['debit_notes', () => acc.listDebitNotes(actor)],
    ['refunds', () => acc.listRefunds(actor)],
    ['payments', () => acc.listPayments(scope, actor)],
    ['bills', () => acc.listBills(scope, actor)],
    ['purchase_orders', () => acc.listPurchaseOrders(actor)],
    ['bank_accounts', () => acc.listBankAccounts(actor)],
    ['bank_txns', () => acc.listBankTxns(scope, actor)],
    ['bank_stmt_lines', () => acc.listBankStatementLines({ status: 'unmatched' }, actor)],
    ['cash_accounts', () => acc.listCashAccounts(actor)],
    ['cash_txns', () => acc.listCashTxns(scope, actor)],
    ['petty_cash', () => acc.listPettyCash(actor)],
    ['cashup_finance', () => acc.listCashupFinance(scope, actor)],
    ['expenses', () => acc.listAccExpenses(scope, actor)],
    ['recurring', () => acc.listRecurring(actor)],
    ['ar_aging', () => acc.arAging(scope.to, actor)],
    ['ap_aging', () => acc.apAging(scope.to, actor)],
    ['statements', () => acc.listStatementHistory({ party_type: 'customer' }, actor)],
    ['stock_value', () => acc.stockValueReport(actor)],
    ['stock_adjustments', () => require('../electron/services/store').listStockAdjustments({ limit: 5 })],
    ['other_income', () => acc.listOtherIncome(actor)],
    ['loans', () => acc.listLoans(actor)],
    ['owner_equity', () => acc.listOwnerTxns(actor)],
    ['assets', () => acc.listAssets(actor)],
    ['tax_summary', () => acc.taxSummary(scope.from, scope.to, actor)],
    ['pnl', () => acc.profitAndLoss(scope.from, scope.to, actor)],
    ['balance_sheet', () => acc.balanceSheet(scope.to, actor)],
    ['cash_flow', () => acc.cashFlow(scope.from, scope.to, actor)],
    ['sales_report', () => acc.salesReport(scope.from, scope.to, actor)],
    ['purchase_report', () => acc.purchaseReport(scope.from, scope.to, actor)],
    ['expense_report', () => acc.expenseReport(scope.from, scope.to, actor)],
    ['drill_stock', () => acc.drillDown('stock_value', scope.from, scope.to, actor)],
    ['documents', () => acc.listDocuments({}, actor)],
    ['ocr_pending', () => acc.listDocuments({ ocr_status: 'ocr_pending' }, actor)],
    ['reconcile_centre', () => acc.listReconcileCentre(actor)],
    ['approvals', () => acc.listApprovals(scope, actor)],
    ['audit_log', () => acc.listAudit(scope, actor)],
    ['integrations', () => acc.listIntegrationErrors({}, actor)],
    ['payroll', () => acc.listPayrollSummary(actor)],
    ['settings', () => acc.getSettings()],
    ['search', () => acc.globalSearch('cash', actor)]
  ];

  let menuPass = 0;
  const menuFails = [];
  for (const [name, fn] of menuChecks) {
    try {
      const data = fn();
      const okData = data != null;
      if (okData) menuPass++;
      else menuFails.push(name);
    } catch (e) {
      menuFails.push(`${name}: ${e.message}`);
    }
  }
  ok('accounting_menu_qa', menuFails.length === 0, { passed: menuPass, total: menuChecks.length, fails: menuFails.slice(0, 8) });

  // 2. OCR text extraction
  try {
    const sample = `TAX INVOICE\nInvoice No: INV-PH4-001\nFrom: Test Supplier Ltd\nDate: 2026-08-30\nTotal: R 250.00\nVAT: R 32.61`;
    const extracted = acc.extractOcrFromText(sample);
    ok('ocr_text_extract', extracted.confidence >= 60 && extracted.total === 250, {
      invoice_number: extracted.invoice_number,
      confidence: extracted.confidence,
      tesseract: ocr.tesseractStatus()
    });
  } catch (e) {
    ok('ocr_text_extract', false, { error: e.message });
  }

  // 3. OCR document upload + process
  try {
    const txt = 'Invoice No: OCR-DOC-99\nFrom: Phase4 Supplier\nDate: 2026-08-30\nTotal: R 99.00';
    const doc = acc.saveDocument({
      title: 'Phase4 OCR test',
      category: 'supplier_invoice',
      filename: 'phase4-invoice.txt',
      file_base64: Buffer.from(txt).toString('base64'),
      mime_type: 'text/plain'
    }, actor);
    if (!doc?.id) throw new Error('Document save returned no id');
    const processed = acc.processOcrDocument(doc.id, actor);
    ok('ocr_document_flow', (processed.extracted?.total === 99 || processed.extracted?.confidence >= 40), { doc_id: doc.id });
    try { db.prepare('DELETE FROM acc_documents WHERE id=?').run(doc.id); } catch (_) { /* */ }
  } catch (e) {
    ok('ocr_document_flow', false, { error: e.message });
  }

  // 4. Permissions — manager without bookkeeping blocked on cloud
  try {
    process.env.SHOP_POS_CLOUD = '1';
    const blockedMgr = { ...manager, permissions: JSON.stringify({ bookkeeping: false }) };
    let denied = false;
    try { acc.listJournals({}, blockedMgr); } catch (e) { denied = /bookkeeping/i.test(e.message); }
    session.setUserSession(owner);
    ok('cloud_bookkeeping_gate', denied);
    delete process.env.SHOP_POS_CLOUD;
  } catch (e) {
    delete process.env.SHOP_POS_CLOUD;
    ok('cloud_bookkeeping_gate', false, { error: e.message });
  }

  // 5. Auditor read-only
  try {
    const auditor = { id: owner.id, role: 'auditor', username: 'auditor', full_name: 'Auditor' };
    let blocked = false;
    try { acc.saveAccount({ code: '9999', name: 'Test', type: 'expense' }, auditor); } catch (e) { blocked = /read-only/i.test(e.message); }
    ok('auditor_write_blocked', blocked);
  } catch (e) {
    ok('auditor_write_blocked', false, { error: e.message });
  }

  // 6. Manager default bookkeeping permission
  ok('manager_bookkeeping_default', manager ? hasUserPermission(manager, 'bookkeeping') : true);

  // 7. Sync outbox reflush
  try {
    const sale = db.prepare('SELECT id FROM sales ORDER BY id DESC LIMIT 1').get();
    if (!sale) throw new Error('No sale for reflush test');
    const payload = JSON.stringify({ hook: 'postFromSale', local_id: sale.id, args: [sale.id] });
    db.prepare(`INSERT INTO sync_outbox (entity_type, entity_id, payload, error, created_at)
      VALUES ('acc_integrate', ?, ?, 'phase4 test error', datetime('now'))`).run(sale.id, payload);
    const row = db.prepare(`SELECT id FROM sync_outbox WHERE error='phase4 test error' ORDER BY id DESC LIMIT 1`).get();
    const { requeued } = central.requeueFailedIntegrations();
    const after = db.prepare('SELECT error, payload FROM sync_outbox WHERE id=?').get(row.id);
    db.prepare('DELETE FROM sync_outbox WHERE id=?').run(row.id);
    ok('sync_reflush', requeued >= 1 && !after?.error, { requeued, payload_updated: !!after?.payload });
  } catch (e) {
    ok('sync_reflush', false, { error: e.message });
  }

  // 8. Online payment methods still available
  try {
    const online = require('../electron/services/online-ordering');
    const methods = online.getOnlinePaymentMethods('collection');
    ok('online_payment_methods', methods.some((m) => m.id === 'card') && methods.length >= 4);
  } catch (e) {
    ok('online_payment_methods', false, { error: e.message });
  }

  const allPass = results.every((r) => r.pass);
  const report = {
    all_pass: allPass,
    phase: 4,
    at: new Date().toISOString(),
    summary: {
      pass: results.filter((r) => r.pass).length,
      fail: results.filter((r) => !r.pass).length,
      total: results.length
    },
    results
  };
  const outPath = path.join(ROOT, 'scripts', 'phase4-audit-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

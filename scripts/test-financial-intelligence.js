/**
 * Financial Intelligence checks against a throwaway SQLite file.
 * Does not read or write Chisa, Lab, or any configured Postgres database.
 * Test-only sales/expenses/employees are seeded in the temp DB on fixed past dates so every
 * expected figure can be verified by hand.
 */
const fs = require('fs');
const path = require('path');

const DB_KEYS = [
  'SHOP_POS_DATABASE_URL', 'DATABASE_URL',
  'SHOP_POS_DB_HOST', 'SUPABASE_DB_HOST', 'PGHOST',
  'SHOP_POS_DB_PASSWORD', 'SUPABASE_DB_PASSWORD', 'PGPASSWORD',
  'SHOP_POS_DB_USER', 'SUPABASE_DB_USER', 'PGUSER',
  'SHOP_POS_DB_NAME', 'SUPABASE_DB_NAME', 'PGDATABASE',
  'SHOP_POS_DB_PORT', 'SUPABASE_DB_PORT', 'PGPORT'
];
DB_KEYS.forEach((k) => { delete process.env[k]; });
['SHOP_POS_AI_API_KEY', 'OPENAI_API_KEY'].forEach((k) => { delete process.env[k]; });

const dataDir = path.join(__dirname, '..', `.tmp-fin-sqlite-${process.pid}`);
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
process.on('exit', () => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* best effort */ } });
process.env.SHOP_POS_LOCAL_INSTALLER = '1';
process.env.SHOP_POS_DATA = dataDir;

const failures = [];
function check(name, cond, extra) {
  if (cond) console.log('PASS', name);
  else {
    failures.push(name);
    console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600));
  }
}
function throws(fn) {
  try { fn(); return null; } catch (err) { return err.message || String(err); }
}
async function throwsAsync(fn) {
  try { await fn(); return null; } catch (err) { return err.message || String(err); }
}
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) < eps;

(async () => {
  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();
  const db = dbMod.getDb();
  const session = require('../electron/services/session');
  const fin = require('../electron/services/financial-intelligence');
  fin.ensureSchema();

  db.prepare("UPDATE shop_settings SET shop_name = 'FIN Test Shop', phone = '0110000000', address = '1 Test Street' WHERE id = 1").run();
  try { db.prepare("UPDATE shop_settings SET vat_number = '4000000000' WHERE id = 1").run(); } catch (_) { /* column optional */ }
  try { db.prepare("INSERT INTO branches (id, name, code) VALUES (2, 'Second Branch', 'SEC')").run(); } catch (_) { /* exists */ }

  const mkUser = (username, role, perms = '{}') => {
    db.prepare('INSERT INTO users (username, password_hash, full_name, role, is_active, permissions) VALUES (?,?,?,?,1,?)').run(username, 'x', `${username} name`, role, perms);
    return db.prepare('SELECT id, username, full_name, role, is_active, permissions FROM users WHERE username = ?').get(username);
  };
  const owner = mkUser('finowner', 'owner');
  const manager = mkUser('finmgr', 'manager');
  const supervisor = mkUser('finsup', 'supervisor');
  const as = (u) => { session.setUserSession(u); return u; };

  db.prepare("INSERT INTO categories (name) VALUES ('FinFood')").run();
  const cat = db.prepare("SELECT id FROM categories WHERE name = 'FinFood'").get().id;
  const addP = (name, price, cost) => {
    db.prepare('INSERT INTO products (name, category_id, selling_price, buying_price, stock_quantity) VALUES (?,?,?,?,100)').run(name, cat, price, cost);
    return db.prepare('SELECT id FROM products WHERE name = ?').get(name).id;
  };
  const steak = addP('Test Steak', 55, 25);
  const chips = addP('Test Chips', 20, 0);
  const pie = addP('Test Pie', 33.33, 10);
  addP('Test Unsold Wrap', 40, 15);

  let rn = 0;
  const hasSaleBranch = (() => { try { db.prepare('SELECT branch_id FROM sales WHERE 1=0').all(); return true; } catch (_) { return false; } })();
  const sale = (at, branchId, items) => {
    const total = Math.round(items.reduce((a, it) => a + it.price * it.qty, 0) * 100) / 100;
    rn += 1;
    const cols = ['receipt_number', 'user_id', 'subtotal', 'discount', 'total', 'amount_paid', 'status', 'created_at'];
    const vals = [`FIN-${rn}`, owner.id, total, 0, total, total, 'completed', at];
    if (hasSaleBranch) { cols.push('branch_id'); vals.push(branchId); }
    db.prepare(`INSERT INTO sales (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
    const id = db.prepare('SELECT id FROM sales WHERE receipt_number = ?').get(`FIN-${rn}`).id;
    for (const it of items) {
      db.prepare('INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, buying_price, total) VALUES (?,?,?,?,?,?,?)')
        .run(id, it.id, it.name, it.qty, it.price, it.cost, Math.round(it.price * it.qty * 100) / 100);
    }
    try { db.prepare('INSERT INTO sale_payments (sale_id, payment_type, amount) VALUES (?,?,?)').run(id, 'cash', total); } catch (_) { /* optional */ }
    return id;
  };

  // 10:00 UTC stays on the same calendar day in any timezone from UTC-10 to UTC+13.
  const steakSale = sale('2024-02-10 10:00:00', 1, [{ id: steak, name: 'Test Steak', price: 55, cost: 25, qty: 10 }]);
  const chipsSale = sale('2024-02-20 10:00:00', 2, [{ id: chips, name: 'Test Chips', price: 20, cost: 0, qty: 5 }]);
  sale('2024-01-15 10:00:00', 1, [{ id: pie, name: 'Test Pie', price: 33.33, cost: 10, qty: 3 }]);
  sale('2023-06-05 10:00:00', 1, [{ id: steak, name: 'Test Steak', price: 50, cost: 25, qty: 2 }]);
  db.prepare("INSERT INTO sales (receipt_number, user_id, subtotal, discount, total, amount_paid, status, created_at) VALUES ('FIN-VOID', ?, 999, 0, 999, 999, 'voided', '2024-02-11 10:00:00')").run(owner.id);

  db.prepare("INSERT INTO returns (sale_id, receipt_number, user_id, return_type, reason, total_refund, created_at) VALUES (?, 'FIN-2', ?, 'refund', 'test', 20, '2024-02-20 11:00:00')").run(chipsSale, owner.id);
  try { db.prepare("UPDATE returns SET status = 'completed' WHERE sale_id = ?").run(chipsSale); } catch (_) { /* status column optional */ }

  const hasExpBranch = (() => { try { db.prepare('SELECT branch_id FROM expenses WHERE 1=0').all(); return true; } catch (_) { return false; } })();
  const expense = (category, amount, date, branchId) => {
    if (hasExpBranch) db.prepare('INSERT INTO expenses (category, amount, expense_date, branch_id, user_id) VALUES (?,?,?,?,?)').run(category, amount, date, branchId, owner.id);
    else db.prepare('INSERT INTO expenses (category, amount, expense_date, user_id) VALUES (?,?,?,?)').run(category, amount, date, owner.id);
  };
  expense('rent', 1000, '2024-02-01', 1);
  expense('electricity', 300, '2024-02-15', 1);

  db.prepare("INSERT INTO employees (employee_code, full_name, position, status, salary_type, basic_salary, allowances) VALUES ('FE1', 'Test Cook', 'Cook', 'Active', 'Monthly', 5000, 500)").run();
  db.prepare("INSERT INTO employees (employee_code, full_name, position, status, salary_type, basic_salary, allowances) VALUES ('FE2', 'Test Former', 'Cleaner', 'Terminated', 'Monthly', 3000, 0)").run();
  const cookId = db.prepare("SELECT id FROM employees WHERE employee_code = 'FE1'").get().id;

  const FEB = { from: '2024-02-01', to: '2024-02-29' };

  // ── Permissions ──
  as(supervisor);
  check('supervisor without fin_view is denied', !!throws(() => fin.meta(supervisor)));
  as(manager);
  check('manager can view (role default fin_view)', !throws(() => fin.meta(manager)));
  check('manager cannot manage allocations', !!throws(() => fin.saveCategory({ name: 'X', pct: 5 }, manager)));
  check('manager cannot set a rate directly', !!throws(() => fin.setRate(1, { pct: 5 }, manager)));
  check('manager cannot view salaries', !!throws(() => fin.employees({}, manager)));
  as(owner);
  const m0 = fin.meta(owner);
  check('owner has every permission', Object.values(m0.permissions).every(Boolean), m0.permissions);
  check('meta lists data years 2023-2024', JSON.stringify(m0.years) === '[2023,2024]', m0.years);

  // ── No-data states ──
  const empty = fin.daily({ preset: 'custom', date: '2024-03-03' }, owner);
  check('empty day shows NO DATA message', empty.empty_message === 'NO DATA AVAILABLE FOR THIS PERIOD' && empty.summary.orders === 0, empty.empty_message);
  const noCats = fin.periodSummary(FEB, owner);
  check('no categories → everything unallocated', near(noCats.summary.unallocated, 630) && noCats.summary.allocated_costs === 0, noCats.summary);

  // ── Allocation categories ──
  const eff = '2020-01-01';
  const cStock = fin.saveCategory({ name: 'Stock', kind: 'stock', pct: 40, effective_from: eff }, owner);
  const cSal = fin.saveCategory({ name: 'Salaries', kind: 'salary', pct: 25, effective_from: eff }, owner);
  fin.saveCategory({ name: 'Rent', kind: 'rent', pct: 10, effective_from: eff }, owner);
  fin.saveCategory({ name: 'Owner', kind: 'owner', pct: 15, effective_from: eff }, owner);
  check('four categories created', fin.listCategories().length === 4);
  check('category audit written', !!db.prepare("SELECT id FROM audit_log WHERE action = 'financial_category_created'").get());

  // ── Sales retrieval + allocation maths (Feb 2024: 550 + 100 − 20 refund = 630) ──
  const feb = fin.periodSummary(FEB, owner);
  const s = feb.summary;
  check('gross sales 650 (voided sale excluded)', near(s.gross_sales, 650), s.gross_sales);
  check('refunds 20', near(s.refunds, 20), s.refunds);
  check('net sales 630', near(s.net_sales, 630), s.net_sales);
  check('orders 2 / quantity 15', s.orders === 2 && s.quantity === 15, { o: s.orders, q: s.quantity });
  const amt = (name) => s.allocations.find((a) => a.name === name)?.amount;
  check('stock 40% = 252', near(amt('Stock'), 252), amt('Stock'));
  check('salaries 25% = 157.50', near(amt('Salaries'), 157.5), amt('Salaries'));
  check('rent 10% = 63', near(amt('Rent'), 63));
  check('owner 15% = 94.50', near(s.owner_allocation, 94.5));
  check('allocated costs exclude owner = 472.50', near(s.allocated_costs, 472.5), s.allocated_costs);
  check('operating contribution = 157.50', near(s.operating_contribution, 157.5), s.operating_contribution);
  check('unallocated amount (10%) = 63', near(s.unallocated, 63), s.unallocated);
  check('recorded stock cost = 250 (steak 10 × 25)', near(s.actual.recorded_stock_cost, 250), s.actual.recorded_stock_cost);
  check('expenses 1300 by category', near(s.actual.expenses, 1300) && s.actual.expenses_by_category.length === 2, s.actual);
  check('validation 90% → unallocated message', feb.validation[0].total_pct === 90 && !feb.validation[0].exceeds, feb.validation);

  // ── >100% warning ──
  const cMkt = fin.saveCategory({ name: 'Marketing', kind: 'marketing', pct: 20, effective_from: eff }, owner);
  const v110 = fin.validateTotals(fin.listCategories());
  check('exceeding 100% shows the exact warning', v110[0].exceeds && v110[0].message === 'Allocation percentages exceed 100%. Please review your configuration.', v110);
  fin.setCategoryActive(cMkt.id, false, eff, owner);
  check('deactivated category drops out of totals', fin.validateTotals(fin.listCategories())[0].total_pct === 90);

  // ── Dated rate changes keep history ──
  fin.setRate(cSal.id, { pct: 30, effective_from: '2024-02-15', note: 'test' }, owner);
  const feb2 = fin.periodSummary(FEB, owner).summary;
  const sal2 = feb2.allocations.find((a) => a.name === 'Salaries').amount;
  check('rate change applies from its date only (137.50 + 24 = 161.50)', near(sal2, 161.5), sal2);
  const jan = fin.periodSummary({ from: '2024-01-01', to: '2024-01-31' }, owner).summary;
  check('earlier month keeps the old rate (99.99 × 25%)', near(jan.allocations.find((a) => a.name === 'Salaries').amount, 25.0), jan.allocations);
  check('decimal accuracy: 3 × 33.33 = 99.99', near(jan.net_sales, 99.99, 0.0001), jan.net_sales);
  check('past rate cannot be removed', !!throws(() => fin.deleteRate(fin.listCategories().find((c) => c.id === cSal.id).history[0].id, owner)));
  check('rate change audited', !!db.prepare("SELECT id FROM audit_log WHERE action = 'financial_allocation_pct_changed'").get());
  fin.setRate(cSal.id, { pct: 25, effective_from: '2024-02-15', note: 'revert' }, owner);

  // ── Daily + drill-down ──
  const d10 = fin.daily({ preset: 'custom', date: '2024-02-10' }, owner);
  check('daily: Steak R55 × 10 = R550', near(d10.summary.net_sales, 550) && d10.products[0]?.name === 'Test Steak' && d10.products[0].quantity === 10 && near(d10.products[0].revenue, 550), d10.products);
  check('daily: payment methods', d10.payments.length === 0 || near(d10.payments[0].amount, 550), d10.payments);
  const list = fin.salesList({ date: '2024-02-10' }, owner);
  check('drill-down lists the sale', list.sales.length === 1 && list.sales[0].id === steakSale, list.sales);
  const det = fin.saleDetail(steakSale, owner);
  check('sale detail shows items', det.items.length === 1 && det.items[0].quantity === 10, det.items);

  // ── Monthly: every calendar day ──
  const mFeb24 = fin.monthly({ year: 2024, month: 2 }, owner);
  check('Feb 2024 has 29 days', mFeb24.days.length === 29 && mFeb24.days_in_month === 29);
  check('Feb 2023 has 28 days', fin.monthly({ year: 2023, month: 2 }, owner).days.length === 28);
  check('Apr 2024 has 30 days', fin.monthly({ year: 2024, month: 4 }, owner).days.length === 30);
  check('Jan 2024 has 31 days', fin.monthly({ year: 2024, month: 1 }, owner).days.length === 31);
  check('zero-sales days flagged', mFeb24.days.filter((d) => d.no_sales).length === 27 && mFeb24.days[0].no_sales === true);
  check('month total = 630', near(mFeb24.total.net_sales, 630), mFeb24.total.net_sales);
  check('day rows sum to the month total', near(mFeb24.days.reduce((a, d) => a + d.net_sales, 0), mFeb24.total.net_sales));

  // ── Annual + history ──
  const y24 = fin.annual({ year: 2024 }, owner);
  check('annual has 12 months', y24.months.length === 12);
  check('months without data flagged NO DATA', y24.months.filter((m) => m.no_data).length === 10, y24.months.map((m) => m.no_data));
  check('year total = 729.99', near(y24.total.net_sales, 729.99), y24.total.net_sales);
  const h = fin.history({}, owner);
  check('history lists 2023 and 2024', h.years.map((y) => y.year).join() === '2023,2024');
  check('all-years total = 829.99', near(h.total.net_sales, 829.99), h.total.net_sales);

  // ── Branches ──
  const br = fin.branchPerformance(FEB, owner);
  const b1 = br.branches.find((b) => b.branch_id === 1); const b2 = br.branches.find((b) => b.branch_id === 2);
  if (hasSaleBranch) {
    check('branch 1 net 550', near(b1?.net_sales, 550), b1);
    check('branch 2 net 80 (refund applied to its branch)', near(b2?.net_sales, 80), b2);
    const only2 = fin.daily({ preset: 'custom', date: '2024-02-20', branch_id: 2 }, owner);
    check('branch filter isolates branch 2', near(only2.summary.net_sales, 80), only2.summary.net_sales);
  }

  // ── Products ──
  const p = fin.products(FEB, owner);
  const ps = p.products.find((x) => x.name === 'Test Steak');
  check('product revenue & price', ps && near(ps.revenue, 550) && near(ps.price, 55) && ps.quantity === 10, ps);
  check('product stock allocation shared by revenue (252 × 550/650)', near(ps.allocated_stock, 252 * 550 / 650, 0.011), ps.allocated_stock);
  check('chips without cost show insufficient cost', p.products.find((x) => x.name === 'Test Chips').recorded_stock_cost === null);
  check('unsold active product listed', p.not_sold.some((x) => x.name === 'Test Unsold Wrap'));

  // ── Employees & affordability ──
  const emp = fin.employees({ ...FEB }, owner);
  check('active employee included, terminated excluded', emp.included_count === 1 && near(emp.monthly_total, 5500), emp);
  fin.savePlannedWorker({ name: 'Planned Waiter', salary: 2500, frequency: 'monthly' }, owner);
  const af = fin.affordability({ ...FEB }, owner);
  check('required = 8000 for one full month', near(af.required_for_period, 8000) && af.months_in_period === 1, af);
  check('salary allocation 157.50', near(af.salary_allocation, 157.5), af.salary_allocation);
  check('shortfall & coverage', af.status === 'shortfall' && near(af.shortfall, 7842.5) && af.coverage_pct === 2, af);
  check('additional revenue needed = 31370', near(af.additional_revenue_needed, 31370), af.additional_revenue_needed);
  check('additional units needed = 724', af.additional_units_needed === 724, af.additional_units_needed);
  const sc = fin.affordability({ ...FEB, workers: 2, salary: 2500 }, owner);
  check('scenario: 2 workers × R2500 = 5000', near(sc.required_for_period, 5000) && sc.scenario.workers === 2, sc);
  check('weekly → monthly equivalent', near(fin.monthlyEquivalent(1000, 'weekly', fin.getSettings()).monthly, 1000 * 52 / 12));
  fin.setEmployeeIncluded(cookId, false, owner);
  check('excluding an employee removes them', fin.employees({}, owner).included_count === 1 && near(fin.employees({}, owner).monthly_total, 2500));
  fin.setEmployeeIncluded(cookId, true, owner);
  check('employee include/exclude audited', !!db.prepare("SELECT id FROM audit_log WHERE action = 'financial_employee_excluded'").get());

  // ── Break-even ──
  const be = fin.breakEven({}, owner);
  check('break-even reports insufficient data when recent months are empty', be.insufficient.length > 0 && be.actual_basis === null, be.insufficient);
  const bSteak = be.products.find((x) => x.name === 'Test Steak');
  check('product break-even: Steak margin 30, units = ceil(8000/30) = 267', bSteak && near(bSteak.unit_margin, 30) && bSteak.units_to_cover_fixed === 267, bSteak);
  check('product without cost → insufficient message', be.products.find((x) => x.name === 'Test Chips').note === 'Insufficient data to calculate product-level break-even.');

  // ── Dashboard ──
  const dash = fin.dashboard({}, owner);
  check('dashboard loads with validation and allocation list', Array.isArray(dash.validation) && dash.allocation.length === 4, dash.allocation);

  // ── AI advisor ──
  as(owner);
  const ai1 = await fin.aiAsk('How much did I make this month?', {}, owner);
  check('AI: separates facts / analysis / recommendations', Array.isArray(ai1.facts) && Array.isArray(ai1.analysis) && Array.isArray(ai1.recommendations) && ai1.engine === 'rule_based');
  check('AI: no data this month → insufficient, nothing invented', ai1.insufficient.some((x) => /INSUFFICIENT DATA/.test(x)) && ai1.facts.every((f) => !/R[1-9]/.test(f.text) || /R0\.00/.test(f.text)), ai1);
  const ai2 = await fin.aiAsk('What happens if I change my salaries allocation from 25% to 28%?', {}, owner);
  const recIdx = ai2.recommendations.findIndex((r) => r.action);
  check('AI: allocation scenario proposes an approvable change', recIdx >= 0 && ai2.recommendations[recIdx].action.pct === 28, ai2);
  check('AI: nothing changed before approval', fin.listCategories().find((c) => c.id === cSal.id).current_pct === 25);
  as(manager);
  check('AI: manager cannot approve', !!throws(() => fin.aiApprove(ai2.id, recIdx, manager)));
  const aiMgr = await fin.aiAsk('Can I afford two workers at R2500?', {}, manager);
  check('AI: salary facts hidden without fin_salaries', aiMgr.facts.every((f) => f.topic !== 'salary') && aiMgr.insufficient.some((x) => /permission/.test(x)), aiMgr);
  as(owner);
  const aiOwn = await fin.aiAsk('Can I afford two workers at R2500?', {}, owner);
  check('AI: owner gets salary facts for the scenario', aiOwn.facts.some((f) => f.topic === 'salary' && /2 workers/.test(f.text)), aiOwn.facts);
  fin.aiApprove(ai2.id, recIdx, owner);
  check('AI: approval applies the change', fin.listCategories().find((c) => c.id === cSal.id).current_pct === 28);
  check('AI: approval audited', !!db.prepare("SELECT id FROM audit_log WHERE action = 'financial_ai_change_approved'").get());
  check('AI: questions logged', fin.aiHistory(10, owner).length === 4);

  // ── Reports ──
  const rep = await fin.generateReport('monthly', { year: 2024, month: 2 }, owner);
  check('report has reference and company details', /^FIN-\d{8}-\d{4}$/.test(rep.reference) && rep.company.name === 'FIN Test Shop', { ref: rep.reference, c: rep.company });
  const daily = rep.sections.find((x) => x.title === 'Daily breakdown');
  check('monthly report lists 29 days + MONTH TOTAL', daily.table.rows.length === 30 && daily.table.rows[29][0] === 'MONTH TOTAL' && daily.table.rows[0][2] === '0 sales / No sales', daily.table.rows[0]);
  for (const t of ['daily', 'annual', 'historical', 'branch', 'product', 'allocation', 'salary', 'breakeven', 'ai']) {
    const err = await throwsAsync(() => fin.generateReport(t, t === 'annual' ? { year: 2024 } : (t === 'daily' ? { preset: 'custom', date: '2024-02-10' } : { ...FEB }), owner));
    check(`report type ${t} generates`, !err, err);
  }
  const pdf = fin.exportReport(rep.id, 'pdf', owner);
  check('PDF export is a real PDF', Buffer.from(pdf.base64, 'base64').subarray(0, 4).toString() === '%PDF' && pdf.bytes > 1000, pdf.bytes);
  const xlsx = fin.exportReport(rep.id, 'xlsx', owner);
  check('Excel export is a real XLSX (zip)', Buffer.from(xlsx.base64, 'base64').subarray(0, 2).toString() === 'PK', xlsx.bytes);
  const txt = fin.reportSummaryText(rep.id, owner);
  check('WhatsApp summary text', /FIN Test Shop/.test(txt.text) && /Net sales: R630[.,]00/.test(txt.text), txt.text);
  const reports = fin.listReports(50, owner);
  check('report history kept (10 reports)', reports.length === 10 && reports.find((r) => r.id === rep.id).export_count === 2, reports.length);
  check('report export/share audited', !!db.prepare("SELECT id FROM audit_log WHERE action = 'financial_report_exported'").get() && !!db.prepare("SELECT id FROM audit_log WHERE action = 'financial_report_shared'").get());
  as(manager);
  check('manager cannot generate salary report', !!(await throwsAsync(() => fin.generateReport('salary', FEB, manager))));
  check('manager can generate a monthly report', !(await throwsAsync(() => fin.generateReport('monthly', { year: 2024, month: 2 }, manager))));
  as(owner);

  // ── Settings ──
  fin.saveSettings({ exclude_tax: true, work_days_per_month: 22 }, owner);
  check('settings saved', fin.getSettings().exclude_tax === true && fin.getSettings().work_days_per_month === 22);
  check('invalid setting rejected', !!throws(() => fin.saveSettings({ work_days_per_month: 40 }, owner)));
  check('financial audit log readable', fin.listAudit(200, owner).length >= 10);

  // ── No mock data: fresh schema has no seeded financial rows ──
  check('no seeded categories beyond the test ones', fin.listCategories().every((c) => ['Stock', 'Salaries', 'Rent', 'Owner', 'Marketing'].includes(c.name)));

  console.log(`\n${failures.length ? `FAILED ${failures.length}` : 'ALL PASSED'}`);
  if (failures.length) { console.log(failures.join('\n')); process.exit(1); }
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });

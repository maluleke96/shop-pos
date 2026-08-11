const path = require('path');
process.chdir(path.join(__dirname, '..'));

async function main() {
  const { initDatabase, getDb, closeDatabase } = require('../electron/database/db');
  const staff = require('../electron/services/staff');
  await initDatabase();
  const db = getDb();

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
  const required = ['employees', 'employee_attendance', 'employee_leave', 'employee_payroll', 'customer_credit_ledger'];
  const missing = required.filter(t => !tables.includes(t));
  if (missing.length) throw new Error('Missing tables: ' + missing.join(', '));

  const settings = db.prepare('SELECT payment_settings, account_settings, loyalty_settings FROM shop_settings WHERE id=1').get();
  const custCols = db.prepare('PRAGMA table_info(customers)').all().map(c => c.name);
  if (!custCols.includes('allow_on_account')) throw new Error('customers.allow_on_account missing');
  if (!custCols.includes('credit_limit')) throw new Error('customers.credit_limit missing');

  const emp = staff.saveEmployee({ full_name: 'Test Worker', pin: '9999' }, 1);
  staff.verifyEmployeeCodePin(emp.employee_code, '9999');
  const att = staff.clockActionVerified(emp.id, 'clock_in');
  if (!att.clock_in) throw new Error('clock_in failed');
  staff.deleteEmployee(emp.id);

  const val = staff.validateOnAccount(null, 100, { enabled: true, require_allowlist: true });
  if (val.ok) throw new Error('validateOnAccount should fail without customer');

  console.log('ALL_CHECKS_PASSED');
  console.log(JSON.stringify({
    tables: required.length,
    payment_settings_column: settings.payment_settings !== undefined,
    account_settings_column: settings.account_settings !== undefined,
    employee_test: emp.employee_code
  }));
  closeDatabase();
}

main().catch(err => {
  console.error('VERIFY_FAILED:', err.message);
  process.exit(1);
});

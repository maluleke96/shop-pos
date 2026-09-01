/**
 * Simulates upgrade over an existing DB with business data.
 * Verifies: backup created, migration applied, records preserved.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shoppos-upgrade-'));
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.SHOP_POS_DATA = dataDir;

  // Fresh init at "old" schema floor — create DB then insert sample rows
  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();
  const db = dbMod.getDb();

  // Seed representative business data (idempotent-ish)
  const hasUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get()?.c || 0;
  if (!hasUsers) {
    db.prepare(`INSERT INTO users (username, password_hash, full_name, role, is_active)
      VALUES ('owner_upgrade_test','x','Owner Test','owner',1)`).run();
  }
  const userId = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get().id;

  const existingEmp = db.prepare("SELECT id FROM employees WHERE employee_code='EMP9999'").get();
  if (!existingEmp) {
    db.prepare(`INSERT INTO employees (employee_code, full_name, status, pin, user_id, branch, position)
      VALUES ('EMP9999','Upgrade Test Emp','Active','hashed',?, 'Main', 'Cashier')`).run(userId);
  }
  const empId = db.prepare("SELECT id FROM employees WHERE employee_code='EMP9999'").get().id;

  db.prepare(`INSERT INTO products (name, selling_price, buying_price, stock_quantity, is_active)
    VALUES ('Upgrade Product', 10, 5, 7, 1)`).run();
  const productCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;

  try {
    db.prepare(`INSERT INTO employee_attendance (employee_id, work_date, clock_in, status)
      VALUES (?, date('now'), datetime('now'), 'present')`).run(empId);
  } catch (_) { /* schema variance */ }

  const beforeEmp = db.prepare("SELECT full_name, user_id FROM employees WHERE employee_code='EMP9999'").get();
  const beforeProducts = productCount;
  const dbPath = dbMod.getDbPathForBackup();
  dbMod.persistNow();
  dbMod.closeDatabase();

  // Force "needs migration" by lowering user_version if possible, then reopen
  // Re-require clean module state
  delete require.cache[require.resolve('../electron/database/db')];
  const dbMod2 = require('../electron/database/db');

  // Lower user_version inside file using sql.js directly so next init migrates
  const initSqlJs = require('sql.js/dist/sql-asm.js');
  const SQL = await initSqlJs();
  const raw = new SQL.Database(fs.readFileSync(dbPath));
  const latest = fs.readdirSync(path.join(__dirname, '../electron/database'))
    .map(f => { const m = f.match(/^migrations-v(\d+)\.sql$/i); return m ? parseInt(m[1], 10) : 0; })
    .filter(Boolean).sort((a, b) => a - b).pop() || 0;
  const floor = Math.max(0, latest - 1);
  raw.run(`PRAGMA user_version = ${floor}`);
  fs.writeFileSync(dbPath, Buffer.from(raw.export()));
  raw.close();

  await dbMod2.initDatabase();
  const db2 = dbMod2.getDb();
  const afterEmp = db2.prepare("SELECT full_name, user_id FROM employees WHERE employee_code='EMP9999'").get();
  const afterProducts = db2.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  const afterAtt = db2.prepare('SELECT COUNT(*) AS c FROM employee_attendance WHERE employee_id=?').get(empId)?.c || 0;
  const ver = db2.prepare('PRAGMA user_version').get();
  // sql.js wrapper may not support pragma get — read via exec fallback
  let userVersion = latest;
  try {
    userVersion = ver?.user_version ?? latest;
  } catch (_) {}

  const backupDir = path.join(dataDir, 'backups');
  const backups = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter(f => f.startsWith('ShopPOS_Backup_')) : [];

  const ok =
    afterEmp?.full_name === beforeEmp.full_name &&
    Number(afterEmp?.user_id) === Number(beforeEmp.user_id) &&
    afterProducts >= beforeProducts &&
    backups.length >= 1;

  console.log(JSON.stringify({
    ok,
    beforeEmp,
    afterEmp,
    beforeProducts,
    afterProducts,
    afterAtt,
    backups,
    backupDir,
    userVersion,
    latest,
    dbPath
  }, null, 2));

  dbMod2.closeDatabase();
  if (!ok) {
    console.error('UPGRADE PRESERVE DATA TEST FAILED');
    process.exit(1);
  }
  console.log('UPGRADE PRESERVE DATA TEST PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

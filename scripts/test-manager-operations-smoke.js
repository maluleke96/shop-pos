/**
 * Lab smoke test — Manager Operations module (no Chisa / no production).
 * Run: node scripts/test-manager-operations-smoke.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-smoke-'));
process.env.SHOP_POS_DATA = tmpDir;
process.env.SHOP_POS_DATA_DIR = tmpDir;
process.env.ENTITLEMENTS_ENFORCE = 'false';
process.env.PLATFORM_CONTROL_ENABLED = process.env.PLATFORM_CONTROL_ENABLED || '0';
delete process.env.DATABASE_URL;
delete process.env.SHOP_POS_DATABASE_URL;

async function main() {
  const { initDatabase, getDb } = require('../electron/database/db');
  await initDatabase();

  // Ensure a user exists for FK-ish references
  try {
    getDb().prepare(`
      INSERT INTO users (username, password_hash, full_name, role, is_active)
      VALUES ('mo_owner', ?, 'MO Owner', 'owner', 1)
    `).run('$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUV');
  } catch (_) { /* may already exist / schema differs */ }

  const owner = getDb().prepare("SELECT * FROM users WHERE role='owner' LIMIT 1").get()
    || { id: 1, username: 'mo_owner', full_name: 'MO Owner', role: 'owner' };

  const mo = require('../electron/services/manager-operations');
  mo.ensureSchema();
  mo.seedDefaults(owner);

  const gen = mo.generateDailyTasks(null, owner, null);
  console.log('generateDailyTasks', gen);

  const tasks = mo.listTasks({ admin_view: true }, owner);
  console.log('tasks today', tasks.length);
  if (!tasks.length) throw new Error('Expected seeded daily tasks');

  const sales = mo.getSalesSummary(null);
  console.log('sales summary', { target: sales.target, sales: sales.sales, read_only: sales.read_only });
  if (sales.read_only !== true) throw new Error('Sales must be read-only');

  const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  // Prefer a non-checklist task first if possible; else complete checklist
  let done = false;
  for (const task of tasks) {
    try {
      mo.startTask(task.id, owner);
      const fresh = mo.getTask(task.id, owner);
      for (const item of (fresh.checklist || [])) {
        if (item.is_required && !item.completed) {
          mo.completeChecklistItem(item.id, {}, owner);
        }
      }
      mo.completeTask(task.id, {
        notes: 'smoke',
        photo_data_url: fresh.photo_mode === 'required' ? tiny : null
      }, owner);
      done = true;
      console.log('completed task', task.id, task.title);
      break;
    } catch (e) {
      console.warn('skip task', task.id, e.message);
    }
  }
  if (!done) throw new Error('Could not complete any task');

  const incident = mo.reportIncident({
    category: 'Stock problem',
    description: 'Chicken stock low',
    priority: 'high',
    requires_owner: true,
    photo_data_url: tiny
  }, owner);
  console.log('incident', incident.id);

  const dash = mo.ownerDashboard();
  console.log('dashboard', dash.tasks);

  const report = mo.submitDailyReport({ manager_comments: 'Smoke test day OK' }, owner);
  console.log('report', report.id, report.work_date);

  const msg = mo.ownerRespond(report.id, 'Please check chicken stock tomorrow morning.', owner);
  const mgr = { id: owner.id, username: 'am', full_name: 'Assistant', role: 'assistant_manager' };
  mo.acknowledgeOwnerMessage(msg.id, mgr);

  const taskCount = getDb().prepare('SELECT COUNT(*) AS c FROM mo_daily_tasks').get().c;
  const reportCount = getDb().prepare('SELECT COUNT(*) AS c FROM mo_daily_reports').get().c;
  const evidenceCount = getDb().prepare('SELECT COUNT(*) AS c FROM mo_evidence').get().c;
  if (!(taskCount > 0 && reportCount > 0 && evidenceCount > 0)) {
    throw new Error('Expected persisted tasks/reports/evidence');
  }
  console.log('retention ok', { taskCount, reportCount, evidenceCount });

  // Catalog contains module
  const catalogPath = path.join(__dirname, '../electron/platform-catalog/MODULE-CATALOG.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const mod = (catalog.modules || []).find((m) => m.id === 'mod.manager_operations');
  if (!mod) throw new Error('mod.manager_operations missing from MODULE-CATALOG');
  console.log('catalog', mod.name, 'sellable_addon=', mod.sellable_addon);

  console.log('SMOKE OK — Manager Operations');
}

main().catch((err) => {
  console.error('SMOKE FAIL', err);
  process.exit(1);
});

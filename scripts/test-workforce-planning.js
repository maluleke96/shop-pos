/**
 * Workforce planning: staffing, intelligent shifts, locks, rewards.
 * Usage: node scripts/test-workforce-planning.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'workforce-'));
  process.env.SHOP_POS_DATA = tmp;
  process.env.SHOP_POS_LOCAL_INSTALLER = '1';
  process.env.ENTITLEMENTS_ENFORCE = 'false';
  delete process.env.DATABASE_URL;
  delete process.env.SHOP_POS_DATABASE_URL;

  await require('../electron/database/db').initDatabase();
  const db = require('../electron/database/db').getDb();
  const staff = require('../electron/services/staff');
  const wf = require('../electron/services/workforce-planning');
  const actor = { role: 'system', id: 0 };

  const mkEmp = (name, code, days, position) => {
    const id = db.prepare(`INSERT INTO employees (employee_code, full_name, position, branch, status, basic_salary, salary_type, work_schedule)
      VALUES (?,?,?,?, 'Active', ?, 'Monthly', ?)`).run(code, name, position, 'Maungani', 5000, JSON.stringify({
      pay_type: 'monthly',
      monthly_salary: 1200,
      expected_days_per_week: days,
      work_days: Array.from({ length: days }, (_, i) => i),
      max_days_per_week: days,
      shift_start: '08:00',
      shift_end: '17:00',
      hours_per_week: 40
    })).lastInsertRowid;
    return id;
  };

  const a = mkEmp('Worker A', 'WA1', 4, 'Cook');
  const b = mkEmp('Worker B', 'WB1', 5, 'Cashier');
  const c = mkEmp('Worker C', 'WC1', 3, 'Braai');
  const d = mkEmp('Worker D', 'WD1', 6, 'Supervisor');

  wf.saveStaffingRequirements([
    { day_of_week: 0, min_workers: 1, target_workers: 1, classification: 'normal' },
    { day_of_week: 1, min_workers: 1, target_workers: 1, classification: 'normal' },
    { day_of_week: 2, min_workers: 2, target_workers: 2, classification: 'normal' },
    { day_of_week: 3, min_workers: 3, target_workers: 3, classification: 'busy', role_requirements: { cook: 1 } },
    { day_of_week: 4, min_workers: 3, target_workers: 3, classification: 'busy' },
    { day_of_week: 5, min_workers: 4, target_workers: 4, classification: 'very_busy' },
    { day_of_week: 6, min_workers: 2, target_workers: 2, classification: 'normal' }
  ], actor);

  const monday = (() => {
    const d0 = new Date();
    const day = d0.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d0.setDate(d0.getDate() + diff);
    return d0.toLocaleDateString('en-CA');
  })();

  const gen = wf.generateIntelligentShifts(monday, [a, b, c, d], {}, { days: 7, publish: false }, actor);
  assert(gen.created.length > 0, 'no shifts created');
  const workA = gen.created.filter((s) => Number(s.employee_id) === Number(a) && !s.is_rest_day);
  assert(workA.length <= 4, `Worker A got ${workA.length} days (max 4)`);
  const workB = gen.created.filter((s) => Number(s.employee_id) === Number(b) && !s.is_rest_day);
  assert(workB.length <= 5, `Worker B got ${workB.length} days (max 5)`);

  const one = gen.created.find((s) => s.id && !s.is_rest_day);
  assert(one, 'need a working shift to lock');
  wf.setScheduleLock(one.id, true, actor);
  const locked = db.prepare('SELECT is_locked FROM employee_schedules WHERE id = ?').get(one.id);
  assert(Number(locked.is_locked) === 1, 'lock failed');
  const regen = wf.generateIntelligentShifts(monday, [a, b, c, d], {}, { days: 7, publish: false }, actor);
  assert(regen.preserved_locked >= 1, 'locked shift was not preserved');
  const still = db.prepare('SELECT id, is_locked FROM employee_schedules WHERE id = ?').get(one.id);
  assert(still && Number(still.is_locked) === 1, 'locked shift disappeared on regenerate');

  let blocked = false;
  try {
    staff.saveSchedule({
      id: one.id,
      employee_id: one.employee_id,
      shift_date: one.shift_date,
      shift_name: 'Changed',
      start_time: '09:00',
      end_time: '18:00',
      is_rest_day: 0
    }, actor);
  } catch (err) {
    blocked = /locked/i.test(err.message);
  }
  assert(blocked, 'locked shift allowed edit without unlock');

  const fourWeek = wf.generateIntelligentShifts(monday, [a, b, c, d], {}, { days: 28, publish: false }, actor);
  assert(fourWeek.created.length > gen.created.length, 'four-week generate did not create a longer schedule');
  assert(db.prepare('SELECT id FROM employee_schedules WHERE id = ?').get(one.id), 'locked shift lost during four-week generate');

  wf.publishSchedules(monday, fourWeek.period.end, [a, b, c, d], actor);
  const pub = db.prepare(`SELECT COUNT(*) AS n FROM employee_schedules WHERE employee_id = ? AND COALESCE(is_published,0) = 1`).get(a);
  assert(Number(pub.n) > 0, 'publish failed');

  const cover = wf.coverageReport(monday, monday);
  assert(cover[0] && cover[0].required_target >= 1, 'coverage report missing');

  wf.saveRewardRules({
    enabled: true,
    require_approval: true,
    target: 2000,
    tiers: [
      { min: 2000, max: 2999.99, amount: 20 },
      { min: 3000, max: null, amount: 50 }
    ]
  }, actor);
  const day = monday;
  db.prepare(`INSERT INTO sales (receipt_number, user_id, subtotal, total, amount_paid, status, created_at)
    VALUES (?,?,?,?,?, 'completed', ?)`).run('R-WF-1', 1, 2500, 2500, 2500, `${day}T12:00:00.000Z`);
  // Attendance makes staff eligible even if busy-day priority left Monday thin
  for (const eid of [a, b, c, d]) {
    db.prepare(`INSERT INTO employee_attendance (employee_id, work_date, clock_in, clock_out, hours_worked, status)
      VALUES (?,?,?,?,?, 'present')`).run(eid, day, `${day}T08:00:00.000Z`, `${day}T17:00:00.000Z`, 8);
  }
  const reward = wf.calculateDayRewards(day, actor, { sales_total: 2500, force: true });
  assert(reward.reward_amount === 20, `tier amount wrong: ${reward.reward_amount}`);
  assert((reward.rewards || []).length >= 1, 'no rewards created');
  const again = wf.calculateDayRewards(day, actor, { sales_total: 2500, force: true });
  const keys = new Set((again.rewards || []).map((r) => r.calc_key));
  assert(keys.size === (again.rewards || []).length, 'duplicate reward rows');

  const hourlyId = db.prepare(`INSERT INTO employees (employee_code, full_name, status, basic_salary, salary_type, work_schedule)
    VALUES (?,?, 'Active', 0, 'Hourly', ?)`).run('WH1', 'Hourly Worker', JSON.stringify({
    pay_type: 'hourly', hourly_rate: 25, expected_hours_per_day: 8, expected_days_per_week: 5,
    work_days: [0, 1, 2, 3, 4], shift_start: '08:00', shift_end: '16:00'
  })).lastInsertRowid;
  const dailyId = db.prepare(`INSERT INTO employees (employee_code, full_name, status, basic_salary, salary_type, work_schedule)
    VALUES (?,?, 'Active', 0, 'Daily', ?)`).run('WDY1', 'Daily Worker', JSON.stringify({
    pay_type: 'daily', daily_wage: 150, expected_hours_per_day: 8, expected_days_per_week: 4,
    work_days: [0, 1, 2, 3], shift_start: '08:00', shift_end: '16:00'
  })).lastInsertRowid;
  db.prepare(`INSERT INTO employee_attendance (employee_id, work_date, clock_in, clock_out, hours_worked, status)
    VALUES (?,?,?,?,?, 'present')`).run(hourlyId, day, `${day}T08:00:00.000Z`, `${day}T16:00:00.000Z`, 8);
  db.prepare(`INSERT INTO employee_attendance (employee_id, work_date, clock_in, clock_out, hours_worked, status)
    VALUES (?,?,?,?,?, 'present')`).run(dailyId, day, `${day}T08:00:00.000Z`, `${day}T16:00:00.000Z`, 8);
  const att = require('../electron/services/attendance-payroll');
  const hPay = att.calculateEmployeePeriodPayroll(hourlyId, day, day);
  assert(Math.abs(Number(hPay.totals.normal_pay) - 200) < 0.02, `hourly pay ${hPay.totals.normal_pay}`);
  const dPay = att.calculateEmployeePeriodPayroll(dailyId, day, day);
  // daily rate via hourly equivalent in day calc — daily_wage / hours * hours worked
  assert(Number(dPay.totals.normal_pay) > 0, 'daily pay missing');

  console.log('WORKFORCE_PLANNING_OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

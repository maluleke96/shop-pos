const fs = require('fs');
const path = require('path');
const { jsPDF } = require('jspdf');
const { getDb, getDbPathForBackup } = require('../database/db');
const { assertUserActor } = require('./authz');

function requireEomRole(actor) {
  assertUserActor(actor, ['owner', 'manager', 'supervisor']);
}

function monthYearFromDate(d = new Date()) {
  return d.toLocaleDateString('en-CA').slice(0, 7);
}

function monthBounds(monthYear) {
  const [y, m] = monthYear.split('-').map(Number);
  const from = `${monthYear}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${monthYear}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

function computeEmployeeScores(monthYear) {
  const db = getDb();
  const { from, to } = monthBounds(monthYear);
  const employees = db.prepare(`SELECT e.id, e.full_name, e.user_id FROM employees e WHERE e.status = 'Active'`).all();
  const maxSales = Math.max(1, ...employees.map(e => {
    if (!e.user_id) return 0;
    return db.prepare(`
      SELECT COALESCE(SUM(total), 0) as v FROM sales
      WHERE user_id = ? AND status = 'completed' AND date(created_at) BETWEEN date(?) AND date(?)
    `).get(e.user_id, from, to)?.v || 0;
  }));

  const scores = employees.map(emp => {
    let salesScore = 0;
    let salesTotal = 0;
    let salesCount = 0;
    if (emp.user_id) {
      const rev = db.prepare(`
        SELECT COALESCE(SUM(total), 0) as v, COUNT(*) as c FROM sales
        WHERE user_id = ? AND status = 'completed' AND date(created_at) BETWEEN date(?) AND date(?)
      `).get(emp.user_id, from, to);
      salesTotal = Number(rev?.v) || 0;
      salesCount = Number(rev?.c) || 0;
      salesScore = Math.min(100, (salesTotal / maxSales) * 100);
    }

    const shiftCount = emp.user_id ? db.prepare(`
      SELECT COUNT(*) as c FROM shifts
      WHERE user_id = ? AND date(opened_at) BETWEEN date(?) AND date(?)
    `).get(emp.user_id, from, to)?.c || 0 : 0;
    const shiftScore = Math.min(100, shiftCount * 8);

    let checklistDone = 0;
    let checklistTotal = 0;
    let checklistFailed = 0;
    let attendanceDays = 0;
    let scheduledDays = 0;
    try {
      checklistDone = db.prepare(`
        SELECT COUNT(*) as c FROM daily_checklist_items dci
        JOIN daily_checklist_runs dcr ON dcr.id = dci.run_id
        WHERE dcr.employee_id = ?
          AND date(dcr.run_date) BETWEEN date(?) AND date(?)
          AND dcr.status != 'failed'
          AND (dci.item_status = 'done' OR (dci.item_status IS NULL AND dci.completed = 1))
      `).get(emp.id, from, to)?.c || 0;
      checklistTotal = db.prepare(`
        SELECT COUNT(*) as c FROM daily_checklist_items dci
        JOIN daily_checklist_runs dcr ON dcr.id = dci.run_id
        WHERE dcr.employee_id = ?
          AND date(dcr.run_date) BETWEEN date(?) AND date(?)
          AND dcr.status != 'failed'
      `).get(emp.id, from, to)?.c || 0;
      checklistFailed = db.prepare(`
        SELECT COUNT(*) as c FROM daily_checklist_runs
        WHERE employee_id = ? AND status = 'failed'
          AND date(run_date) BETWEEN date(?) AND date(?)
      `).get(emp.id, from, to)?.c || 0;
    } catch (_) { /* checklist tables may be absent on older DBs */ }
    // Completion ratio, then penalize each missed/failed deadline heavily for EOM
    const baseChecklist = checklistTotal ? (checklistDone / checklistTotal) * 100 : (checklistFailed ? 0 : 50);
    const checklistScore = Math.max(0, Math.min(100, baseChecklist - (checklistFailed * 20)));

    try {
      attendanceDays = db.prepare(`
        SELECT COUNT(*) as c FROM employee_attendance
        WHERE employee_id = ? AND clock_in IS NOT NULL
          AND date(work_date) BETWEEN date(?) AND date(?)
      `).get(emp.id, from, to)?.c || 0;
      scheduledDays = db.prepare(`
        SELECT COUNT(*) as c FROM employee_schedules
        WHERE employee_id = ? AND is_rest_day = 0
          AND date(shift_date) BETWEEN date(?) AND date(?)
      `).get(emp.id, from, to)?.c || 0;
    } catch (_) { /* attendance tables optional */ }
    const attendanceScore = scheduledDays
      ? Math.min(100, (attendanceDays / scheduledDays) * 100)
      : Math.min(100, attendanceDays * 10);

    const total = salesScore * 0.4 + shiftScore * 0.2 + checklistScore * 0.2 + attendanceScore * 0.2;

    try {
      db.prepare(`
        INSERT INTO employee_of_month_scores (employee_id, month_year, sales_score, shift_score, checklist_score, attendance_score, total_score,
          sales_total, sales_count, shifts_attended, checklist_done, checklist_total, checklist_failed, attendance_days, scheduled_days)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(employee_id, month_year) DO UPDATE SET
          sales_score=excluded.sales_score, shift_score=excluded.shift_score,
          checklist_score=excluded.checklist_score, attendance_score=excluded.attendance_score,
          total_score=excluded.total_score,
          sales_total=excluded.sales_total, sales_count=excluded.sales_count,
          shifts_attended=excluded.shifts_attended, checklist_done=excluded.checklist_done,
          checklist_total=excluded.checklist_total, checklist_failed=excluded.checklist_failed,
          attendance_days=excluded.attendance_days, scheduled_days=excluded.scheduled_days
      `).run(emp.id, monthYear, salesScore, shiftScore, checklistScore, attendanceScore, total,
        salesTotal, salesCount, shiftCount, checklistDone, checklistTotal, checklistFailed, attendanceDays, scheduledDays);
    } catch (_) {
      try {
        db.prepare(`
          INSERT INTO employee_of_month_scores (employee_id, month_year, sales_score, shift_score, checklist_score, attendance_score, total_score)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(employee_id, month_year) DO UPDATE SET
            sales_score=excluded.sales_score, shift_score=excluded.shift_score,
            checklist_score=excluded.checklist_score, attendance_score=excluded.attendance_score,
            total_score=excluded.total_score
        `).run(emp.id, monthYear, salesScore, shiftScore, checklistScore, attendanceScore, total);
      } catch (__) { /* scores table may not exist until migration */ }
    }

    return {
      employee_id: emp.id,
      full_name: emp.full_name,
      sales_total: Math.round(salesTotal * 100) / 100,
      sales_count: salesCount,
      shifts_attended: shiftCount,
      checklist_done: checklistDone,
      checklist_total: checklistTotal,
      checklist_failed: checklistFailed,
      attendance_days: attendanceDays,
      scheduled_days: scheduledDays,
      sales_score: Math.round(salesScore),
      shift_score: Math.round(shiftScore),
      checklist_score: Math.round(checklistScore),
      attendance_score: Math.round(attendanceScore),
      total_score: Math.round(total * 10) / 10
    };
  });

  return scores.sort((a, b) => b.total_score - a.total_score);
}

function getScores(monthYear) {
  const my = monthYear || monthYearFromDate();
  try {
    const rows = getDb().prepare(`
      SELECT s.*, e.full_name FROM employee_of_month_scores s
      JOIN employees e ON e.id = s.employee_id
      WHERE s.month_year = ? ORDER BY s.total_score DESC
    `).all(my);
    if (rows.length) return { month_year: my, scores: rows, suggested: rows[0] || null };
  } catch (_) { /* table may not exist until migration v42 */ }
  const computed = computeEmployeeScores(my);
  return { month_year: my, scores: computed, suggested: computed[0] || null };
}

function getRecord(monthYear) {
  const my = monthYear || monthYearFromDate();
  try {
    return getDb().prepare(`
      SELECT eom.*, e.full_name, e.phone FROM employee_of_month eom
      JOIN employees e ON e.id = eom.employee_id WHERE eom.month_year = ?
    `).get(my) || null;
  } catch (_) {
    return null;
  }
}

function getAllRecords(filters = {}) {
  const db = getDb();
  let sql = `
    SELECT eom.*, e.full_name, e.phone FROM employee_of_month eom
    JOIN employees e ON e.id = eom.employee_id WHERE 1=1`;
  const params = [];
  if (filters.from) { sql += ' AND eom.month_year >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND eom.month_year <= ?'; params.push(filters.to); }
  sql += ' ORDER BY eom.month_year DESC, eom.id DESC';
  const limit = filters.limit ? Math.min(Number(filters.limit), 500) : 200;
  sql += ` LIMIT ${limit}`;
  try {
    return db.prepare(sql).all(...params);
  } catch (_) {
    return [];
  }
}

function resolvePhoto(data, existing, employeeId) {
  if (data.photo_path?.trim()) return data.photo_path.trim();
  if (existing?.photo_path) return existing.photo_path;
  try {
    const emp = getDb().prepare('SELECT photo_path FROM employees WHERE id = ?').get(employeeId);
    return emp?.photo_path || null;
  } catch (_) {
    return null;
  }
}

function nextMonthYear(monthYear) {
  const [y, m] = String(monthYear).split('-').map(Number);
  const d = new Date(y, m, 1);
  return d.toLocaleDateString('en-CA').slice(0, 7);
}

function applyBonusDeltaToPayroll(employeeId, monthYear, bonusDelta) {
  if (!bonusDelta) return;
  const db = getDb();
  const { from, to } = monthBounds(monthYear);
  let payroll = db.prepare(`
    SELECT * FROM employee_payroll WHERE employee_id = ? AND period_start = ? AND period_end = ?
  `).get(employeeId, from, to);
  if (!payroll) {
    const staff = require('./staff');
    const generated = staff.generatePayroll(from, to, [employeeId]);
    payroll = generated[0];
  }
  if (!payroll) return;
  const newBonus = (Number(payroll.bonus) || 0) + bonusDelta;
  db.prepare(`
    UPDATE employee_payroll SET bonus = ?, net_salary = net_salary + ?, gross_salary = gross_salary + ?
    WHERE id = ?
  `).run(newBonus, bonusDelta, bonusDelta, payroll.id);
}

function isEomDisplayActive(record) {
  if (!record) return false;
  if (record.is_active === 0 || record.is_active === false) return false;
  if (record.display_until) {
    const today = new Date().toLocaleDateString('en-CA');
    if (record.display_until < today) return false;
  }
  return true;
}

function expireInactiveAwards() {
  const db = getDb();
  const today = new Date().toLocaleDateString('en-CA');
  try {
    db.prepare(`
      UPDATE employee_of_month SET is_active = 0
      WHERE COALESCE(is_active, 1) = 1 AND display_until IS NOT NULL AND display_until < ?
    `).run(today);
  } catch (_) { /* columns may be missing on older DBs */ }
}

function maybeAutoSelectNext(actor) {
  expireInactiveAwards();
  let eomSettings = { auto_select: true };
  try {
    const raw = getDb().prepare('SELECT eom_settings FROM shop_settings WHERE id = 1').get()?.eom_settings;
    if (raw) eomSettings = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) { /* ignore */ }
  if (eomSettings.auto_select === false) return null;
  const my = monthYearFromDate();
  const current = getRecord(my);
  if (current && isEomDisplayActive(current)) return current;
  // Only auto-rotate when an award existed and ended — never invent the first award
  if (!current || isEomDisplayActive(current)) return null;
  const { suggested } = getScores(my);
  if (!suggested?.employee_id) return null;
  if (suggested.employee_id === current.employee_id) return null;
  try {
    const lastDay = monthBounds(my).to;
    return saveRecord({
      month_year: my,
      employee_id: suggested.employee_id,
      score: suggested.total_score,
      bonus_amount: 0,
      display_until: lastDay,
      is_active: 1,
      notes: 'Auto-selected after previous award ended',
      auto_whatsapp: false
    }, actor || { id: null, username: 'system', role: 'owner' });
  } catch (_) {
    return null;
  }
}

function postPortalFeed(employeeId, record, photo) {
  const db = getDb();
  try {
    db.prepare(`
      DELETE FROM employee_portal_feed
      WHERE employee_id = ? AND feed_type = 'employee_of_month' AND ref_id = ?
    `).run(employeeId, record.id);
    db.prepare(`
      INSERT INTO employee_portal_feed (employee_id, feed_type, title, message, photo_path, ref_id, is_read)
      VALUES (?, 'employee_of_month', ?, ?, ?, ?, 0)
    `).run(
      employeeId,
      '🏆 Employee of the Month',
      `Congratulations! You have been awarded Employee of the Month for ${record.month_year}.`,
      photo,
      record.id
    );
  } catch (_) { /* portal feed table may not exist until migration v45 */ }
}

function saveRecord(data, actor) {
  if (actor?.username !== 'system') requireEomRole(actor);
  const db = getDb();
  const my = data.month_year || monthYearFromDate();
  const existing = getRecord(my);
  const prevBonus = existing ? Number(existing.bonus_amount) || 0 : 0;
  const prevBonusMonth = existing?.bonus_payroll_month || nextMonthYear(my);

  let employeeId = data.employee_id;
  if (!employeeId) {
    const { suggested } = getScores(my);
    employeeId = suggested?.employee_id;
    if (!employeeId) throw new Error('Select an employee or ensure scores are computed');
  }

  const photo = resolvePhoto(data, existing, employeeId);
  const bonus = Number(data.bonus_amount) || 0;
  const bonusDelta = bonus - prevBonus;
  const bonusPayrollMonth = data.bonus_payroll_month || nextMonthYear(my);
  const displayUntil = data.display_until || monthBounds(my).to;
  const isActive = data.is_active === 0 || data.is_active === false ? 0 : 1;

  if (existing?.id) {
    try {
      db.prepare(`
        UPDATE employee_of_month SET employee_id=?, score=?, photo_path=?, bonus_amount=?, notes=?, created_by=?,
          is_active=?, display_until=?, bonus_payroll_month=?
        WHERE id=?
      `).run(employeeId, Number(data.score) || 0, photo, bonus, data.notes || null, actor?.id || null,
        isActive, displayUntil, bonusPayrollMonth, existing.id);
    } catch (_) {
      db.prepare(`
        UPDATE employee_of_month SET employee_id=?, score=?, photo_path=?, bonus_amount=?, notes=?, created_by=?
        WHERE id=?
      `).run(employeeId, Number(data.score) || 0, photo, bonus, data.notes || null, actor?.id || null, existing.id);
    }
  } else {
    try {
      db.prepare(`
        INSERT INTO employee_of_month (employee_id, month_year, score, photo_path, bonus_amount, notes, created_by,
          is_active, display_until, bonus_payroll_month)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(employeeId, my, Number(data.score) || 0, photo, bonus, data.notes || null, actor?.id || null,
        isActive, displayUntil, bonusPayrollMonth);
    } catch (_) {
      db.prepare(`
        INSERT INTO employee_of_month (employee_id, month_year, score, photo_path, bonus_amount, notes, created_by)
        VALUES (?,?,?,?,?,?,?)
      `).run(employeeId, my, Number(data.score) || 0, photo, bonus, data.notes || null, actor?.id || null);
    }
  }

  if (bonusDelta !== 0) {
    // Bonus applies to next month's salary only (not the award month)
    if (prevBonus && prevBonusMonth && prevBonusMonth !== bonusPayrollMonth) {
      applyBonusDeltaToPayroll(employeeId, prevBonusMonth, -prevBonus);
      applyBonusDeltaToPayroll(employeeId, bonusPayrollMonth, bonus);
    } else {
      applyBonusDeltaToPayroll(employeeId, bonusPayrollMonth, bonusDelta);
    }
  }

  let record = getRecord(my);
  const shop = db.prepare('SELECT shop_name FROM shop_settings WHERE id = 1').get();
  if (photo && fs.existsSync(photo)) {
    buildCertificatePdf(record, shop?.shop_name);
    record = getRecord(my);
  } else if (record) {
    buildCertificatePdf(record, shop?.shop_name);
    record = getRecord(my);
  }

  if (record) {
    postPortalFeed(employeeId, record, photo);
    const emp = db.prepare('SELECT phone, full_name FROM employees WHERE id = ?').get(employeeId);
    if (emp?.phone?.trim() && data.auto_whatsapp !== false) {
      try {
        sendEomWhatsApp(record, actor);
      } catch (_) { /* optional auto-send */ }
    }
  }

  db.prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actor?.id || null, actor?.username || 'system', 'eom_award', 'employee_of_month', record?.id,
      JSON.stringify({ month_year: my, employee_id: employeeId, bonus }));

  return record;
}

function getAssetsDir() {
  const dir = path.join(path.dirname(getDbPathForBackup()), 'assets', 'employee-of-month');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function imageFormatFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'PNG';
  if (ext === '.webp') return 'WEBP';
  return 'JPEG';
}

function buildCertificatePdf(record, shopName) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setDrawColor(180, 140, 60);
  doc.setLineWidth(2);
  doc.rect(10, 10, w - 20, h - 20);
  doc.rect(14, 14, w - 28, h - 28);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.text('Employee of the Month', w / 2, 40, { align: 'center' });
  doc.setFontSize(16);
  doc.setFont('helvetica', 'normal');
  doc.text(shopName || 'Shop POS', w / 2, 52, { align: 'center' });

  let nameY = 85;
  if (record.photo_path && fs.existsSync(record.photo_path)) {
    try {
      const imgData = fs.readFileSync(record.photo_path);
      const format = imageFormatFromPath(record.photo_path);
      const imgUri = `data:image/${format.toLowerCase()};base64,${imgData.toString('base64')}`;
      const imgW = 40;
      const imgH = 40;
      doc.addImage(imgUri, format, w / 2 - imgW / 2, 58, imgW, imgH);
      nameY = 108;
    } catch (_) { /* skip photo if unreadable */ }
  }

  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(record.full_name || 'Employee', w / 2, nameY, { align: 'center' });
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text(`Awarded for ${record.month_year}`, w / 2, nameY + 13, { align: 'center' });
  if (record.score) doc.text(`Performance score: ${record.score}`, w / 2, nameY + 25, { align: 'center' });
  try {
    const scoreRow = getDb().prepare(`
      SELECT * FROM employee_of_month_scores WHERE employee_id = ? AND month_year = ?
    `).get(record.employee_id, record.month_year);
    if (scoreRow) {
      doc.setFontSize(10);
      const lines = [
        `Sales: ${scoreRow.sales_total != null ? scoreRow.sales_total : '—'} (${scoreRow.sales_count || 0} transactions)`,
        `Shifts attended: ${scoreRow.shifts_attended ?? '—'}`,
        `Checklists: ${scoreRow.checklist_done ?? 0}/${scoreRow.checklist_total ?? 0}`,
        `Attendance: ${scoreRow.attendance_days ?? 0}/${scoreRow.scheduled_days ?? 0} days`
      ];
      let y = nameY + 38;
      for (const line of lines) {
        doc.text(line, w / 2, y, { align: 'center' });
        y += 6;
      }
    }
  } catch (_) { /* scores optional */ }
  doc.setFontSize(11);
  doc.text('Congratulations on your outstanding contribution!', w / 2, nameY + 40, { align: 'center' });
  const filePath = path.join(getAssetsDir(), `eom-${record.month_year}-${record.employee_id}.pdf`);
  fs.writeFileSync(filePath, require('./pdf-bytes').pdfBytes(doc));
  getDb().prepare('UPDATE employee_of_month SET certificate_path=? WHERE id=?').run(filePath, record.id);
  return filePath;
}

function generateCertificate(monthYear, actor) {
  requireEomRole(actor);
  const record = getRecord(monthYear);
  if (!record) throw new Error('No Employee of the Month record for this period');
  const shop = getDb().prepare('SELECT shop_name FROM shop_settings WHERE id = 1').get();
  return buildCertificatePdf(record, shop?.shop_name);
}

function sendEomWhatsApp(record, actor) {
  if (!record) throw new Error('No Employee of the Month record for this period');
  const db = getDb();
  const emp = db.prepare('SELECT phone, full_name FROM employees WHERE id = ?').get(record.employee_id);
  const phone = emp?.phone?.trim();
  if (!phone) throw new Error('Employee has no phone number — add one in Staff profile');

  const whatsappSvc = require('./whatsapp');
  const shop = db.prepare('SELECT shop_name FROM shop_settings WHERE id = 1').get();
  const shopName = shop?.shop_name || 'our team';
  const message = [
    '🏆 *Employee of the Month*',
    `Period: ${record.month_year}`,
    '',
    `Congratulations ${record.full_name || emp.full_name}!`,
    '',
    `Thank you for your outstanding contribution to ${shopName}.`,
    record.score ? `Performance score: ${record.score}` : null,
    record.bonus_amount ? `Bonus: ${record.bonus_amount}` : null,
    '',
    'Well done! 🎉'
  ].filter(Boolean).join('\n');

  const result = whatsappSvc.sendMessage({
    phone,
    employee_id: record.employee_id,
    recipient_type: 'employee',
    recipient_name: record.full_name || emp.full_name,
    message_type: 'employee_of_month',
    body: message
  }, actor);

  db.prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actor?.id || null, actor?.username || 'system', 'eom_whatsapp_send', 'employee_of_month', record.id,
      JSON.stringify({ month_year: record.month_year, phone }));

  return result;
}

function notifyWhatsApp(monthYear, actor) {
  requireEomRole(actor);
  const record = getRecord(monthYear);
  if (!record) throw new Error('Save the Employee of the Month award before sending to WhatsApp');
  return sendEomWhatsApp(record, actor);
}

function sendSelfCertificateWhatsApp(employeeId, actor) {
  const { assertEmployeeActor, assertUserActor, getEmployeeSession } = require('./authz');
  const db = getDb();
  let actorEmployeeId = null;
  const empSess = getEmployeeSession();
  if (empSess?.employee_id != null) {
    actorEmployeeId = Number(empSess.employee_id);
  } else if (actor?.id) {
    const user = assertUserActor(actor, []);
    actorEmployeeId = db.prepare('SELECT id FROM employees WHERE user_id = ? AND status = ?').get(user.id, 'Active')?.id || null;
  } else {
    throw new Error('Authentication required');
  }
  if (!actorEmployeeId || Number(actorEmployeeId) !== Number(employeeId)) {
    throw new Error('You can only send your own Employee of the Month certificate');
  }
  const record = db.prepare(`
    SELECT eom.*, e.full_name, e.phone FROM employee_of_month eom
    JOIN employees e ON e.id = eom.employee_id
    WHERE eom.employee_id = ?
    ORDER BY eom.month_year DESC LIMIT 1
  `).get(employeeId);
  if (!record) throw new Error('No Employee of the Month award found for your profile');
  if (!record.phone?.trim()) throw new Error('Add your phone number in your employee profile first');
  if (!record.certificate_path || !fs.existsSync(record.certificate_path)) {
    const shop = db.prepare('SELECT shop_name FROM shop_settings WHERE id = 1').get();
    buildCertificatePdf(record, shop?.shop_name);
    const refreshed = getRecord(record.month_year);
    if (refreshed) Object.assign(record, refreshed);
  }
  return sendEomWhatsApp(record, actor);
}

function deleteRecord(id, actor) {
  requireEomRole(actor);
  const db = getDb();
  const record = db.prepare(`
    SELECT eom.*, e.full_name FROM employee_of_month eom
    JOIN employees e ON e.id = eom.employee_id WHERE eom.id = ?
  `).get(id);
  if (!record) throw new Error('Record not found');

  const bonus = Number(record.bonus_amount) || 0;
  if (bonus !== 0) {
    applyBonusDeltaToPayroll(record.employee_id, record.bonus_payroll_month || nextMonthYear(record.month_year), -bonus);
  }

  try {
    db.prepare(`DELETE FROM employee_portal_feed WHERE feed_type = 'employee_of_month' AND ref_id = ?`).run(id);
  } catch (_) { /* table may not exist */ }

  db.prepare('DELETE FROM employee_of_month WHERE id = ?').run(id);

  if (record.certificate_path && fs.existsSync(record.certificate_path)) {
    try { fs.unlinkSync(record.certificate_path); } catch (_) { /* ignore */ }
  }

  db.prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actor?.id || null, actor?.username || 'system', 'eom_delete', 'employee_of_month', id,
      JSON.stringify({ month_year: record.month_year, employee_id: record.employee_id }));

  return true;
}

function getPortalFeed(employeeId) {
  const db = getDb();
  const items = [];
  try {
    items.push(...db.prepare(`
      SELECT * FROM employee_portal_feed
      WHERE employee_id = ? ORDER BY created_at DESC LIMIT 20
    `).all(employeeId));
  } catch (_) { /* table may not exist */ }

  expireInactiveAwards();
  let current = getRecord(monthYearFromDate());
  if (!isEomDisplayActive(current)) {
    maybeAutoSelectNext(null);
    current = getRecord(monthYearFromDate());
  }
  if (current && isEomDisplayActive(current) && current.employee_id === employeeId) {
    const already = items.some(i => i.feed_type === 'employee_of_month' && i.ref_id === current.id);
    if (!already) {
      items.unshift({
        id: null,
        employee_id: employeeId,
        feed_type: 'employee_of_month',
        title: '🏆 Employee of the Month',
        message: `Congratulations! You are Employee of the Month for ${current.month_year}.`,
        photo_path: current.photo_path,
        ref_id: current.id,
        is_read: 0,
        created_at: current.created_at
      });
    }
  } else {
    // Remove expired EOM feed items so staff portal stops showing them
    items.forEach((it, idx) => {
      if (it.feed_type === 'employee_of_month' && (!current || !isEomDisplayActive(current) || it.ref_id !== current?.id)) {
        items[idx] = null;
      }
    });
  }

  return items.filter(Boolean);
}

/** Recompute month scores after a checklist deadline failure (affects EOM ranking). */
function recordChecklistFailure(employeeId, runDate, runType, reason) {
  if (!employeeId) return null;
  const my = String(runDate || monthYearFromDate()).slice(0, 7);
  try {
    computeEmployeeScores(my);
  } catch (_) { /* ignore */ }
  try {
    getDb().prepare(`
      INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details)
      VALUES (NULL, 'system', 'eom_checklist_fail', 'employee', ?, ?)
    `).run(employeeId, JSON.stringify({ run_date: runDate, run_type: runType, reason: reason || null, month_year: my }));
  } catch (_) { /* audit optional */ }
  return getScores(my);
}

module.exports = {
  monthYearFromDate,
  nextMonthYear,
  computeEmployeeScores,
  getScores,
  getRecord,
  getAllRecords,
  resolvePhoto,
  saveRecord,
  generateCertificate,
  sendEomWhatsApp,
  notifyWhatsApp,
  sendSelfCertificateWhatsApp,
  deleteRecord,
  getPortalFeed,
  isEomDisplayActive,
  expireInactiveAwards,
  maybeAutoSelectNext,
  recordChecklistFailure
};

const fs = require('fs');
const path = require('path');
const { getDb } = require('../database/db');
const { buildPdfBuffer } = require('./export');
const { jsPDF } = require('jspdf');
require('jspdf-autotable');
const whatsapp = require('./whatsapp');
const adminOverride = require('./admin-override');

const OPENING_DEADLINE = '11:00';
const CLOSING_DEADLINE = '22:00';

const DEFAULT_CHECKLIST_SETTINGS = {
  morning_deadline: OPENING_DEADLINE,
  closing_deadline: CLOSING_DEADLINE,
  morning_checkbox_interval_minutes: 0,
  closing_checkbox_interval_minutes: 0
};

function getChecklistSettings() {
  const row = getDb().prepare('SELECT checklist_settings FROM shop_settings WHERE id = 1').get() || {};
  const parsed = parseJson(row.checklist_settings, {});
  return {
    morning_deadline: parsed.morning_deadline || OPENING_DEADLINE,
    closing_deadline: parsed.closing_deadline || CLOSING_DEADLINE,
    morning_checkbox_interval_minutes: Math.max(0, Number(parsed.morning_checkbox_interval_minutes) || 0),
    closing_checkbox_interval_minutes: Math.max(0, Number(parsed.closing_checkbox_interval_minutes) || 0)
  };
}

function saveChecklistSettings(data, actor) {
  requireRole(actor, ['owner', 'manager']);
  const current = getChecklistSettings();
  const merged = {
    morning_deadline: data.morning_deadline || current.morning_deadline,
    closing_deadline: data.closing_deadline || current.closing_deadline,
    morning_checkbox_interval_minutes: data.morning_checkbox_interval_minutes != null
      ? Math.max(0, Number(data.morning_checkbox_interval_minutes) || 0)
      : current.morning_checkbox_interval_minutes,
    closing_checkbox_interval_minutes: data.closing_checkbox_interval_minutes != null
      ? Math.max(0, Number(data.closing_checkbox_interval_minutes) || 0)
      : current.closing_checkbox_interval_minutes
  };
  getDb().prepare(`UPDATE shop_settings SET checklist_settings = ?, updated_at = datetime('now') WHERE id = 1`)
    .run(JSON.stringify(merged));
  audit(actor?.id, actor?.username, 'save_checklist_settings', 'shop_settings', 1, merged);
  return merged;
}

function checkboxIntervalMinutesForRun(run) {
  const s = getChecklistSettings();
  if (run?.run_type === 'closing') return s.closing_checkbox_interval_minutes;
  return s.morning_checkbox_interval_minutes;
}

function getChecklistDeadlines() {
  const s = getChecklistSettings();
  return { opening: s.morning_deadline, closing: s.closing_deadline };
}

function audit(actorId, actorName, action, entityType, entityId, details) {
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId || null, actorName || 'system', action, entityType, entityId || null, details ? JSON.stringify(details) : null);
}

function addNotification(type, title, message, opts = {}) {
  try {
    const store = require('./store');
    const actionPage = opts.action_page
      || (type === 'compliance' || type === 'checklist_overdue' || type === 'checklist_reminder'
        ? 'admin:opscompliance'
        : null);
    store.addNotification(type, title, message, {
      ...opts,
      action_page: actionPage,
      audience_roles: opts.audience_roles || ['owner', 'manager', 'assistant_manager', 'supervisor']
    });
  } catch (_) {
    const db = getDb();
    const existing = db.prepare(
      'SELECT id FROM notifications WHERE type = ? AND message = ? AND is_read = 0 AND date(created_at) = date(\'now\')'
    ).get(type, message);
    if (!existing) {
      db.prepare('INSERT INTO notifications (type, title, message) VALUES (?, ?, ?)').run(type, title, message);
    }
  }
}

function requireRole(actor, roles) {
  const { assertUserActor } = require('./authz');
  return assertUserActor(actor, roles);
}

function asId(val) {
  if (val == null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function sameId(a, b) {
  const na = asId(a);
  const nb = asId(b);
  return na != null && nb != null && na === nb;
}

function resolveActorEmployeeId(actor) {
  if (!actor) return null;
  const fromActor = asId(actor.employee_id);
  if (fromActor != null) return fromActor;
  if (!actor.id) return null;
  const emp = getDb().prepare('SELECT id FROM employees WHERE user_id = ? AND status = ?').get(actor.id, 'Active');
  return asId(emp?.id);
}

/** Templates visible to a worker: unassigned ("any worker") or assigned to them. */
function templatesForEmployee(allTemplates, employeeId) {
  const empId = asId(employeeId);
  if (empId == null) return allTemplates.filter(t => !asId(t.assigned_employee_id));
  return allTemplates.filter(t => {
    const assigned = asId(t.assigned_employee_id);
    return assigned == null || assigned === empId;
  });
}

function canDoChecklist(actor) {
  try {
    const empSess = require('./session').getEmployeeSession?.();
    if (empSess?.employee_id != null) {
      if (!actor?.employee_id || sameId(actor.employee_id, empSess.employee_id)) return true;
    }
  } catch (_) { /* ignore */ }
  try {
    const u = require('./authz').assertUserActor(actor, null);
    if (['owner', 'manager', 'assistant_manager', 'supervisor'].includes(u.role)) return true;
    // Staff portal passes employee_id after PIN login; assertUserActor strips it from the returned user.
    if (asId(actor?.employee_id)) {
      const emp = getDb().prepare('SELECT id FROM employees WHERE id = ? AND status = ?').get(asId(actor.employee_id), 'Active');
      if (emp) return true;
    }
    return !!resolveActorEmployeeId(actor) || !!resolveActorEmployeeId(u);
  } catch {
    // Standalone Staff Portal: PIN session / employee actor without POS user login
    if (asId(actor?.employee_id)) {
      const emp = getDb().prepare('SELECT id FROM employees WHERE id = ? AND status = ?').get(asId(actor.employee_id), 'Active');
      if (emp) return true;
    }
    try {
      require('./authz').assertEmployeeActor(actor, actor?.employee_id);
      return true;
    } catch (_) {
      return false;
    }
  }
}

function deadlineForRunType(runType) {
  const d = getChecklistDeadlines();
  return runType === 'closing' ? d.closing : d.opening;
}

function isPastChecklistDeadline(runType, runDate) {
  const todayStr = today();
  if (runDate && runDate < todayStr) return true;
  if (runDate && runDate > todayStr) return false;
  return timePast(deadlineForRunType(runType));
}

function markChecklistRunFailed(runId, reason, actor) {
  const db = getDb();
  const run = db.prepare('SELECT * FROM daily_checklist_runs WHERE id = ?').get(runId);
  if (!run) return null;
  if (['submitted', 'confirmed', 'failed'].includes(run.status)) return getChecklistRun(runId);
  db.prepare(`
    UPDATE daily_checklist_runs
    SET status='failed', failed_at=datetime('now'), failure_reason=?, completed_at=datetime('now')
    WHERE id=?`).run(reason || 'Not submitted by deadline', runId);
  addNotification('compliance', `${run.run_type} checklist failed`,
    `${run.run_date}: ${run.run_type} routine marked failed — ${reason || 'deadline missed'}.`);
  audit(actor?.id || null, actor?.username || 'system', 'fail_checklist', 'checklist_run', runId, { reason });
  try {
    const eom = require('./employee-of-month');
    if (typeof eom.recordChecklistFailure === 'function' && run.employee_id) {
      eom.recordChecklistFailure(run.employee_id, run.run_date, run.run_type, reason);
    }
  } catch (_) { /* EOM optional */ }
  return getChecklistRun(runId);
}

function requireChecklistActor(actor) {
  if (!canDoChecklist(actor)) {
    throw new Error('Link your user account to an employee profile to complete checklists');
  }
}

function itemIsDone(item) {
  if (item?.item_status) return item.item_status === 'done';
  return !!item?.completed;
}

function itemIsResolved(item) {
  if (item?.item_status) return item.item_status === 'done' || item.item_status === 'skipped';
  return !!item?.completed;
}

function parseJson(val, fallback = []) {
  if (!val) return fallback;
  try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return fallback; }
}

function today() {
  return new Date().toLocaleDateString('en-CA');
}

function nowTimeHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function timeAt(deadlineHHMM) {
  return nowTimeHHMM() === deadlineHHMM;
}

function timePast(deadlineHHMM) {
  return nowTimeHHMM() >= deadlineHHMM;
}

function nextRuleNumber() {
  const count = getDb().prepare('SELECT COUNT(*) AS c FROM company_rules').get().c || 0;
  return `RULE-${String(count + 1).padStart(4, '0')}`;
}

function getShopPdfSettings() {
  return getDb().prepare(`
    SELECT shop_name, address, phone, email, logo_path, currency, admin_signature_path
    FROM shop_settings WHERE id = 1`).get() || {};
}

function readImageBase64(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const ext = path.extname(filePath).toLowerCase();
    const fmt = ext === '.png' ? 'PNG' : 'JPEG';
    return { data: fs.readFileSync(filePath).toString('base64'), format: fmt };
  } catch {
    return null;
  }
}

function drawPdfLetterhead(doc, shop, title, subtitle) {
  let y = 16;
  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  doc.text(shop.shop_name || 'Company', 105, y, { align: 'center' });
  y += 8;
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  const meta = [shop.address, shop.phone ? `Tel: ${shop.phone}` : null, shop.email].filter(Boolean);
  meta.forEach(line => { doc.text(line, 105, y, { align: 'center' }); y += 4; });
  y += 4;
  doc.setDrawColor(180);
  doc.line(14, y, 196, y);
  y += 10;
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text(title, 14, y);
  y += 7;
  if (subtitle) {
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(subtitle, 14, y);
    y += 6;
  }
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, y);
  doc.setTextColor(0);
  return y + 8;
}

function addPdfSignatureBlock(doc, startY, shop) {
  let y = startY + 12;
  if (y > 235) { doc.addPage(); y = 24; }
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('AUTHORISATION', 14, y);
  y += 10;
  doc.setFont(undefined, 'normal');

  const sigImg = readImageBase64(shop.admin_signature_path);
  doc.text('Administrator', 14, y);
  doc.text('Supervisor', 110, y);
  y += 4;
  const lineY = y + 18;
  if (sigImg) {
    try { doc.addImage(sigImg.data, sigImg.format, 14, y, 52, 18); } catch (_) {
      doc.line(14, lineY, 66, lineY);
    }
  } else {
    doc.line(14, lineY, 66, lineY);
  }
  doc.line(110, lineY, 172, lineY);
  y = lineY + 6;
  doc.setFontSize(8);
  doc.text('Signature', 14, y);
  doc.text('Signature', 110, y);
  y += 10;
  doc.setFontSize(10);
  doc.text(`Date: ${new Date().toLocaleDateString()}`, 14, y);
  return y + 8;
}

function pdfToBuffer(doc) {
  return Buffer.from(doc.output('arraybuffer'));
}

function getRequiredIncompleteItems(run) {
  const tplTable = run.run_type === 'opening' ? 'opening_checklist_templates' : 'closing_checklist_templates';
  return run.items.filter(i => {
    const tpl = i.template_id
      ? getDb().prepare(`SELECT is_required FROM ${tplTable} WHERE id = ?`).get(i.template_id)
      : { is_required: 1 };
    return tpl?.is_required && !itemIsDone(i);
  });
}

function enrichChecklistRun(run) {
  if (!run) return null;
  const db = getDb();
  let submittedByName = null;
  let confirmedByName = null;
  if (run.submitted_by) {
    const u = db.prepare('SELECT full_name, username FROM users WHERE id = ?').get(run.submitted_by);
    submittedByName = u?.full_name || u?.username || null;
  }
  if (run.confirmed_by) {
    const u = db.prepare('SELECT full_name, username FROM users WHERE id = ?').get(run.confirmed_by);
    confirmedByName = u?.full_name || u?.username || null;
  }
  return {
    ...run,
    items: run.items || [],
    report: parseJson(run.report_json, {}),
    submitted_by_name: submittedByName,
    confirmed_by_name: confirmedByName
  };
}

// ─── Company Rules ───────────────────────────────────────────────────────────

function getRules(filters = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM company_rules WHERE 1=1';
  const params = [];
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters.category) { sql += ' AND category = ?'; params.push(filters.category); }
  if (filters.search) {
    sql += ' AND (title LIKE ? OR description LIKE ? OR rule_number LIKE ?)';
    const q = `%${filters.search}%`;
    params.push(q, q, q);
  }
  sql += ' ORDER BY effective_date DESC, id DESC';
  return db.prepare(sql).all(...params).map(r => ({ ...r, attachments: parseJson(r.attachments_json) }));
}

function getRule(id) {
  const row = getDb().prepare('SELECT * FROM company_rules WHERE id = ?').get(id);
  if (!row) return null;
  const history = getDb().prepare('SELECT * FROM company_rule_history WHERE rule_id = ? ORDER BY created_at DESC').all(id);
  return { ...row, attachments: parseJson(row.attachments_json), history };
}

function saveRule(data, actor) {
  requireRole(actor, ['owner', 'manager']);
  const db = getDb();
  const payload = {
    title: data.title, category: data.category || null, description: data.description || null,
    effective_date: data.effective_date || today(),
    status: data.status || 'active',
    attachments_json: JSON.stringify(data.attachments || [])
  };
  if (data.id) {
    const prev = getRule(data.id);
    const version = (prev?.version || 1) + (data.bump_version ? 1 : 0);
    db.prepare(`
      UPDATE company_rules SET title=?, category=?, description=?, effective_date=?, version=?, status=?,
        attachments_json=?, updated_at=datetime('now') WHERE id=?`).run(
      payload.title, payload.category, payload.description, payload.effective_date, version,
      payload.status, payload.attachments_json, data.id
    );
    db.prepare(`
      INSERT INTO company_rule_history (rule_id, action, previous_json, new_json, user_id, username)
      VALUES (?,?,?,?,?,?)`).run(
      data.id, 'update', JSON.stringify(prev), JSON.stringify(payload), actor?.id, actor?.username
    );
    audit(actor?.id, actor?.username, 'update_rule', 'company_rule', data.id, { title: payload.title });
    return getRule(data.id);
  }
  const num = nextRuleNumber();
  const r = db.prepare(`
    INSERT INTO company_rules (rule_number, title, category, description, effective_date, version, status, attachments_json, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    num, payload.title, payload.category, payload.description, payload.effective_date, 1,
    payload.status, payload.attachments_json, actor?.id
  );
  db.prepare(`
    INSERT INTO company_rule_history (rule_id, action, new_json, user_id, username) VALUES (?,?,?,?,?)`).run(
    r.lastInsertRowid, 'create', JSON.stringify(payload), actor?.id, actor?.username
  );
  audit(actor?.id, actor?.username, 'create_rule', 'company_rule', r.lastInsertRowid, { rule_number: num });
  return getRule(r.lastInsertRowid);
}

function archiveRule(id, actor) {
  requireRole(actor, ['owner', 'manager']);
  const prev = getRule(id);
  getDb().prepare('UPDATE company_rules SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run('archived', id);
  getDb().prepare(`
    INSERT INTO company_rule_history (rule_id, action, previous_json, user_id, username) VALUES (?,?,?,?,?)`).run(
    id, 'archive', JSON.stringify(prev), actor?.id, actor?.username
  );
  audit(actor?.id, actor?.username, 'archive_rule', 'company_rule', id, null);
  return getRule(id);
}

function buildRulePdf(id, shopName) {
  const rule = getRule(id);
  if (!rule) throw new Error('Rule not found');
  const shop = getShopPdfSettings();
  if (shopName) shop.shop_name = shopName;
  const doc = new jsPDF();
  let y = drawPdfLetterhead(doc, shop, 'COMPANY RULE / POLICY', `${rule.rule_number} — ${rule.title}`);
  doc.setFontSize(10);
  doc.text(`Category: ${rule.category || 'General'}  |  Effective: ${rule.effective_date || '—'}  |  Version ${rule.version}`, 14, y);
  y += 10;
  doc.setFont(undefined, 'bold');
  doc.text('1. Purpose', 14, y);
  y += 6;
  doc.setFont(undefined, 'normal');
  const titleLines = doc.splitTextToSize(rule.title, 180);
  doc.text(titleLines, 14, y);
  y += titleLines.length * 5 + 4;
  doc.setFont(undefined, 'bold');
  doc.text('2. Rule', 14, y);
  y += 6;
  doc.setFont(undefined, 'normal');
  const descLines = doc.splitTextToSize(rule.description || 'No description provided.', 180);
  descLines.forEach(line => {
    if (y > 260) { doc.addPage(); y = 20; }
    doc.text(line, 14, y);
    y += 5;
  });
  y += 6;
  doc.setFont(undefined, 'bold');
  doc.text('3. Compliance', 14, y);
  y += 6;
  doc.setFont(undefined, 'normal');
  doc.text('All staff must read, understand, and comply with this rule. Non-compliance may result in disciplinary action.', 14, y, { maxWidth: 180 });
  addPdfSignatureBlock(doc, y + 14, shop);
  return pdfToBuffer(doc);
}

function buildAllRulesPdf(shopName) {
  const rules = getRules({ status: 'active' });
  const shop = getShopPdfSettings();
  if (shopName) shop.shop_name = shopName;
  const doc = new jsPDF();
  let y = drawPdfLetterhead(doc, shop, 'COMPANY RULES & REGULATIONS', 'Official business rules — all staff must comply');
  doc.setFontSize(10);
  doc.text('The following numbered rules form part of the operating policies of this business.', 14, y, { maxWidth: 180 });
  y += 12;
  rules.forEach((rule, idx) => {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFont(undefined, 'bold');
    doc.text(`${idx + 1}. ${rule.rule_number} — ${rule.title}`, 14, y);
    y += 5;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.text(`${rule.category || 'General'} · Effective ${rule.effective_date || '—'} · v${rule.version}`, 14, y);
    doc.setTextColor(0);
    y += 5;
    const lines = doc.splitTextToSize(rule.description || '—', 176);
    lines.forEach(line => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.text(line, 18, y);
      y += 4.5;
    });
    y += 6;
    doc.setFontSize(10);
  });
  addPdfSignatureBlock(doc, y, shop);
  return pdfToBuffer(doc);
}

function saveAdminSignature(signaturePath, actor) {
  requireRole(actor, ['owner']);
  getDb().prepare(`UPDATE shop_settings SET admin_signature_path = ?, updated_at = datetime('now') WHERE id = 1`)
    .run(signaturePath || null);
  audit(actor?.id, actor?.username, 'save_admin_signature', 'shop_settings', 1, { path: signaturePath });
  return { admin_signature_path: signaturePath };
}

function getAdminSignature() {
  const row = getDb().prepare('SELECT admin_signature_path FROM shop_settings WHERE id = 1').get();
  return { admin_signature_path: row?.admin_signature_path || null };
}

// ─── Checklist Templates ─────────────────────────────────────────────────────

function getOpeningTemplates() {
  return getDb().prepare(`
    SELECT t.*, e.full_name AS assigned_employee_name
    FROM opening_checklist_templates t
    LEFT JOIN employees e ON e.id = t.assigned_employee_id
    WHERE t.is_active = 1 ORDER BY t.sort_order, t.id
  `).all();
}

function getClosingTemplates() {
  return getDb().prepare(`
    SELECT t.*, e.full_name AS assigned_employee_name
    FROM closing_checklist_templates t
    LEFT JOIN employees e ON e.id = t.assigned_employee_id
    WHERE t.is_active = 1 ORDER BY t.sort_order, t.id
  `).all();
}

function saveOpeningTemplate(data, actor) {
  requireRole(actor, ['owner', 'manager']);
  const db = getDb();
  if (data.id) {
    const existing = db.prepare('SELECT * FROM opening_checklist_templates WHERE id = ?').get(data.id);
    if (!existing) throw new Error('Template not found');
    if (adminOverride.isOwner(actor) && existing.created_by && existing.created_by !== actor?.id) {
      const overrideMeta = adminOverride.assertCanModify(actor, existing.created_by, { override_reason: actor?.override_reason });
      adminOverride.logAdminOverride(actor, 'admin_override_update_checklist_template', 'opening_checklist_template', data.id, {
        reason: overrideMeta.reason,
        record_owner_id: existing.created_by,
        task_name: data.task_name
      });
    }
    db.prepare('UPDATE opening_checklist_templates SET task_name=?, sort_order=?, is_required=?, is_active=?, assigned_employee_id=? WHERE id=?').run(
      data.task_name, data.sort_order ?? 0, data.is_required ? 1 : 0, data.is_active !== false ? 1 : 0,
      asId(data.assigned_employee_id), data.id
    );
    return db.prepare('SELECT * FROM opening_checklist_templates WHERE id = ?').get(data.id);
  }
  const r = db.prepare('INSERT INTO opening_checklist_templates (task_name, sort_order, is_required, is_active, created_by, assigned_employee_id) VALUES (?,?,?,?,?,?)').run(
    data.task_name, data.sort_order ?? 0, data.is_required !== false ? 1 : 0, 1, actor?.id || null,
    asId(data.assigned_employee_id)
  );
  return db.prepare('SELECT * FROM opening_checklist_templates WHERE id = ?').get(r.lastInsertRowid);
}

function saveClosingTemplate(data, actor) {
  requireRole(actor, ['owner', 'manager']);
  const db = getDb();
  if (data.id) {
    const existing = db.prepare('SELECT * FROM closing_checklist_templates WHERE id = ?').get(data.id);
    if (!existing) throw new Error('Template not found');
    if (adminOverride.isOwner(actor) && existing.created_by && existing.created_by !== actor?.id) {
      const overrideMeta = adminOverride.assertCanModify(actor, existing.created_by, { override_reason: actor?.override_reason });
      adminOverride.logAdminOverride(actor, 'admin_override_update_checklist_template', 'closing_checklist_template', data.id, {
        reason: overrideMeta.reason,
        record_owner_id: existing.created_by,
        task_name: data.task_name
      });
    }
    db.prepare('UPDATE closing_checklist_templates SET task_name=?, sort_order=?, is_required=?, is_active=?, assigned_employee_id=? WHERE id=?').run(
      data.task_name, data.sort_order ?? 0, data.is_required ? 1 : 0, data.is_active !== false ? 1 : 0,
      asId(data.assigned_employee_id), data.id
    );
    return db.prepare('SELECT * FROM closing_checklist_templates WHERE id = ?').get(data.id);
  }
  const r = db.prepare('INSERT INTO closing_checklist_templates (task_name, sort_order, is_required, is_active, created_by, assigned_employee_id) VALUES (?,?,?,?,?,?)').run(
    data.task_name, data.sort_order ?? 0, data.is_required !== false ? 1 : 0, 1, actor?.id || null,
    asId(data.assigned_employee_id)
  );
  return db.prepare('SELECT * FROM closing_checklist_templates WHERE id = ?').get(r.lastInsertRowid);
}

function deleteOpeningTemplate(id, actor) {
  requireRole(actor, ['owner', 'manager']);
  const existing = getDb().prepare('SELECT * FROM opening_checklist_templates WHERE id = ?').get(id);
  if (!existing) throw new Error('Template not found');
  if (adminOverride.isOwner(actor) && existing.created_by && existing.created_by !== actor?.id) {
    const overrideMeta = adminOverride.assertCanModify(actor, existing.created_by, { override_reason: actor?.override_reason });
    adminOverride.logAdminOverride(actor, 'admin_override_delete_checklist_template', 'opening_checklist_template', id, {
      reason: overrideMeta.reason,
      record_owner_id: existing.created_by,
      task_name: existing.task_name
    });
  }
  getDb().prepare('UPDATE opening_checklist_templates SET is_active = 0 WHERE id = ?').run(id);
  return true;
}

function deleteClosingTemplate(id, actor) {
  requireRole(actor, ['owner', 'manager']);
  const existing = getDb().prepare('SELECT * FROM closing_checklist_templates WHERE id = ?').get(id);
  if (!existing) throw new Error('Template not found');
  if (adminOverride.isOwner(actor) && existing.created_by && existing.created_by !== actor?.id) {
    const overrideMeta = adminOverride.assertCanModify(actor, existing.created_by, { override_reason: actor?.override_reason });
    adminOverride.logAdminOverride(actor, 'admin_override_delete_checklist_template', 'closing_checklist_template', id, {
      reason: overrideMeta.reason,
      record_owner_id: existing.created_by,
      task_name: existing.task_name
    });
  }
  getDb().prepare('UPDATE closing_checklist_templates SET is_active = 0 WHERE id = ?').run(id);
  return true;
}

// ─── Checklist Runs ──────────────────────────────────────────────────────────

function getChecklistRuns(filters = {}) {
  const db = getDb();
  let sql = `
    SELECT r.*, e.full_name AS employee_name
    FROM daily_checklist_runs r
    LEFT JOIN employees e ON e.id = r.employee_id
    WHERE 1=1`;
  const params = [];
  if (filters.run_type) { sql += ' AND r.run_type = ?'; params.push(filters.run_type); }
  if (filters.run_date) { sql += ' AND r.run_date = ?'; params.push(filters.run_date); }
  if (filters.status) { sql += ' AND r.status = ?'; params.push(filters.status); }
  if (filters.employee_id != null && filters.employee_id !== '') {
    sql += ' AND r.employee_id = ?';
    params.push(asId(filters.employee_id));
  }
  if (filters.from) { sql += ' AND date(r.run_date) >= date(?)'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(r.run_date) <= date(?)'; params.push(filters.to); }
  sql += ' ORDER BY r.run_date DESC, r.id DESC LIMIT 100';
  return db.prepare(sql).all(...params);
}

function getChecklistRun(id) {
  const run = getDb().prepare(`
    SELECT r.*, e.full_name AS employee_name
    FROM daily_checklist_runs r
    LEFT JOIN employees e ON e.id = r.employee_id
    WHERE r.id = ?
  `).get(id);
  if (!run) return null;
  const items = getDb().prepare('SELECT * FROM daily_checklist_items WHERE run_id = ? ORDER BY id').all(id);
  return enrichChecklistRun({ ...run, items });
}

function getPendingChecklistSubmissions() {
  return getChecklistRuns({ status: 'submitted' }).map(r => enrichChecklistRun({ ...r, items: getDb().prepare('SELECT * FROM daily_checklist_items WHERE run_id = ? ORDER BY id').all(r.id) }));
}

function resolveChecklistUser(actor, data) {
  try {
    const user = require('./authz').assertUserActor(actor, []);
    return {
      user,
      isManager: ['owner', 'manager', 'assistant_manager', 'supervisor'].includes(user.role)
    };
  } catch (_) {
    const emp = require('./authz').assertEmployeeActor(actor, data?.employee_id || actor?.employee_id);
    return { user: emp, isManager: false };
  }
}

function startChecklistRun(data, actor) {
  requireChecklistActor(actor);
  const runType = data.run_type;
  if (!['opening', 'closing'].includes(runType)) throw new Error('Invalid run type');
  const runDate = data.run_date || today();
  const { user, isManager } = resolveChecklistUser(actor, data);
  const employeeId = asId(data.employee_id) || resolveActorEmployeeId(actor) || asId(user.employee_id);
  const branchId = asId(data.branch_id);
  const allTemplates = runType === 'opening' ? getOpeningTemplates() : getClosingTemplates();
  let templates;
  if (employeeId != null) {
    templates = templatesForEmployee(allTemplates, employeeId);
  } else if (isManager) {
    // Manager "general" run: only unassigned tasks. Prefer starting with a worker selected
    // when every task is assigned to someone.
    templates = templatesForEmployee(allTemplates, null);
  } else {
    throw new Error('Employee profile required to start a checklist run');
  }
  if (!templates.length) {
    if (employeeId != null) {
      throw new Error('No checklist tasks are assigned to you for this routine. Ask admin to assign morning/closing tasks to your name.');
    }
    throw new Error('No unassigned checklist tasks. Select a worker (or assign tasks to “Any worker”) to start this routine.');
  }
  const db = getDb();
  // Prefer IS for NULL-safe match when branch/employee are unset.
  const existing = db.prepare(`
    SELECT id, status FROM daily_checklist_runs
    WHERE run_type = ? AND run_date = ? AND branch_id IS ? AND employee_id IS ? AND status != ?
    ORDER BY id DESC LIMIT 1
  `).get(runType, runDate, branchId, employeeId, 'cancelled');
  if (existing) {
    // Allow a fresh start if a prior failed shell had no tasks / deadline not yet past
    if (existing.status === 'failed' && !isPastChecklistDeadline(runType, runDate)) {
      db.prepare(`
        UPDATE daily_checklist_runs SET status='in_progress', failed_at=NULL, failure_reason=NULL,
          completed_at=NULL WHERE id=?`).run(existing.id);
      const items = db.prepare('SELECT COUNT(*) AS c FROM daily_checklist_items WHERE run_id=?').get(existing.id)?.c || 0;
      if (!items) {
        templates.forEach(t => {
          db.prepare(`
            INSERT INTO daily_checklist_items (run_id, template_id, task_name, completed, item_status, employee_name)
            VALUES (?,?,?,?, 'pending', ?)`).run(existing.id, t.id, t.task_name, 0,
            (employeeId != null ? db.prepare('SELECT full_name FROM employees WHERE id = ?').get(employeeId)?.full_name : null)
              || actor?.full_name || actor?.username || '');
        });
      }
      return getChecklistRun(existing.id);
    }
    return getChecklistRun(existing.id);
  }

  const emp = employeeId != null ? db.prepare('SELECT full_name FROM employees WHERE id = ?').get(employeeId) : null;
  const empName = emp?.full_name || actor?.full_name || actor?.username || '';
  const r = db.prepare(`
    INSERT INTO daily_checklist_runs (run_type, run_date, branch_id, employee_id, status)
    VALUES (?,?,?,?, 'in_progress')`).run(runType, runDate, branchId, employeeId);
  const runId = r.lastInsertRowid;
  templates.forEach(t => {
    db.prepare(`
      INSERT INTO daily_checklist_items (run_id, template_id, task_name, completed, item_status, employee_name)
      VALUES (?,?,?,?, 'pending', ?)`).run(runId, t.id, t.task_name, 0, empName);
  });
  audit(actor?.id, actor?.username, 'start_checklist', 'checklist_run', runId, { run_type: runType, employee_id: employeeId });
  return getChecklistRun(runId);
}

function completeChecklistItem(itemId, data, actor) {
  requireChecklistActor(actor);
  const db = getDb();
  const item = db.prepare('SELECT * FROM daily_checklist_items WHERE id = ?').get(itemId);
  if (!item) throw new Error('Item not found');
  const run = db.prepare('SELECT * FROM daily_checklist_runs WHERE id = ?').get(item.run_id);
  const userRole = require('./authz').loadUserById(actor?.id)?.role;
  const isAdminEditor = ['owner', 'manager', 'supervisor'].includes(userRole) && data?.admin_edit;
  if ((run?.status === 'submitted' || run?.status === 'confirmed') && !isAdminEditor) {
    throw new Error('Checklist already submitted — cannot edit items');
  }
  const actorEmployeeId = resolveActorEmployeeId(actor);
  if (actorEmployeeId && run?.employee_id && !sameId(run.employee_id, actorEmployeeId)
      && !['owner', 'manager', 'assistant_manager', 'supervisor'].includes(userRole)) {
    throw new Error('You can only update tasks on your own checklist run');
  }
  let itemStatus = 'pending';
  if (data.item_status === 'done' || data.item_status === 'skipped') {
    itemStatus = data.item_status;
  } else if (data.completed === false) {
    itemStatus = 'skipped';
  } else if (data.completed) {
    itemStatus = 'done';
  }
  // Enforce admin-set interval between checkbox ticks (staff/ops — not admin edits)
  if (!isAdminEditor && itemStatus === 'done') {
    const intervalMin = checkboxIntervalMinutesForRun(run);
    if (intervalMin > 0) {
      const last = db.prepare(`
        SELECT completed_at FROM daily_checklist_items
        WHERE run_id = ? AND id != ? AND item_status = 'done' AND completed_at IS NOT NULL
        ORDER BY completed_at DESC LIMIT 1`).get(item.run_id, itemId);
      if (last?.completed_at) {
        const elapsedMs = Date.now() - new Date(last.completed_at).getTime();
        const needMs = intervalMin * 60 * 1000;
        if (elapsedMs < needMs) {
          const waitSec = Math.ceil((needMs - elapsedMs) / 1000);
          const waitMin = Math.ceil(waitSec / 60);
          throw new Error(`Wait ${waitMin} min between task checkboxes (admin interval: ${intervalMin} min). Try again in ${waitSec}s.`);
        }
      }
    }
  }
  const completed = itemStatus === 'done' ? 1 : 0;
  db.prepare(`
    UPDATE daily_checklist_items SET completed=?, item_status=?, comments=?, completed_at=datetime('now'), employee_name=? WHERE id=?`).run(
    completed, itemStatus, data.comments || null, actor?.full_name || actor?.username || '', itemId
  );
  return db.prepare('SELECT * FROM daily_checklist_items WHERE id = ?').get(itemId);
}

function submitChecklistRun(runId, actor) {
  requireChecklistActor(actor);
  const run = getChecklistRun(runId);
  if (!run) throw new Error('Run not found');
  const actorEmployeeId = resolveActorEmployeeId(actor) || asId(actor?.employee_id);
  const userRole = require('./authz').loadUserById(actor?.id)?.role;
  const isMgr = ['owner', 'manager', 'assistant_manager', 'supervisor'].includes(userRole);
  if (actorEmployeeId && run.employee_id && !sameId(run.employee_id, actorEmployeeId) && !isMgr) {
    throw new Error('You can only submit your own checklist run');
  }
  if (run.status === 'submitted') throw new Error('Already submitted to admin');
  if (run.status === 'confirmed') throw new Error('Already confirmed by admin');
  if (run.status === 'failed') {
    throw new Error(run.failure_reason || 'This task list failed — deadline passed. It counts against Employee of the Month.');
  }
  if (!isMgr && isPastChecklistDeadline(run.run_type, run.run_date)) {
    const deadline = deadlineForRunType(run.run_type);
    const reason = `Not submitted by deadline (${deadline})`;
    markChecklistRunFailed(runId, reason, actor);
    throw new Error(`Deadline ${deadline} has passed. Submit failed and was recorded against Employee of the Month scoring.`);
  }
  const unresolved = run.items.filter(i => !itemIsResolved(i));
  if (unresolved.length) {
    throw new Error(`Tick each assigned task checkbox before submitting: ${unresolved.map(i => i.task_name).join(', ')}`);
  }
  const requiredIncomplete = getRequiredIncompleteItems(run);
  if (requiredIncomplete.length) {
    throw new Error(`Complete all required tasks first: ${requiredIncomplete.map(i => i.task_name).join(', ')}`);
  }
  const report = {
    total: run.items.length,
    completed: run.items.filter(i => itemIsDone(i)).length,
    skipped: run.items.filter(i => i.item_status === 'skipped').length,
    required_incomplete: []
  };
  getDb().prepare(`
    UPDATE daily_checklist_runs SET status='submitted', submitted_at=datetime('now'), submitted_by=?,
      completed_at=datetime('now'), report_json=?, failed_at=NULL, failure_reason=NULL WHERE id=?`).run(
    actor?.id || null, JSON.stringify(report), runId
  );
  const submitter = actor?.full_name || actor?.username || 'staff';
  addNotification('compliance', `${run.run_type} checklist submitted`,
    `${run.run_date}: ${run.run_type} routine submitted by ${submitter} — awaiting admin confirmation.`);
  audit(actor?.id, actor?.username, 'submit_checklist', 'checklist_run', runId, report);
  return getChecklistRun(runId);
}

function confirmChecklistRun(runId, data, actor) {
  requireRole(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  const run = getChecklistRun(runId);
  if (!run) throw new Error('Run not found');
  if (!['submitted', 'in_progress', 'failed'].includes(run.status)) {
    throw new Error('Only submitted, in-progress, or failed checklists can be confirmed');
  }
  getDb().prepare(`
    UPDATE daily_checklist_runs SET status='confirmed', confirmed_by=?, confirmed_at=datetime('now'), admin_notes=?,
      failed_at=NULL, failure_reason=NULL WHERE id=?`).run(
    actor?.id || null, data?.admin_notes || null, runId
  );
  addNotification('compliance', `${run.run_type} checklist confirmed`,
    `${run.run_date}: Admin confirmed the ${run.run_type} routine.${data?.admin_notes ? ` Notes: ${data.admin_notes}` : ''}`);
  audit(actor?.id, actor?.username, 'confirm_checklist', 'checklist_run', runId, { admin_notes: data?.admin_notes });
  return getChecklistRun(runId);
}

function reopenChecklistRun(runId, actor) {
  requireRole(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  const run = getChecklistRun(runId);
  if (!run) throw new Error('Run not found');
  if (!['submitted', 'confirmed', 'failed'].includes(run.status)) {
    throw new Error('Only submitted, confirmed, or failed records can be reopened for edit');
  }
  getDb().prepare(`
    UPDATE daily_checklist_runs SET status='in_progress', confirmed_by=NULL, confirmed_at=NULL,
      submitted_at=NULL, submitted_by=NULL, failed_at=NULL, failure_reason=NULL WHERE id=?`).run(runId);
  audit(actor?.id, actor?.username, 'reopen_checklist', 'checklist_run', runId, null);
  return getChecklistRun(runId);
}

function adminUpdateChecklistRun(runId, data, actor) {
  requireRole(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  const run = getChecklistRun(runId);
  if (!run) throw new Error('Run not found');
  const items = data?.items || [];
  for (const upd of items) {
    if (!upd?.id) continue;
    completeChecklistItem(upd.id, {
      item_status: upd.item_status || (upd.completed ? 'done' : 'pending'),
      comments: upd.comments || '',
      admin_edit: true
    }, actor);
  }
  if (data?.admin_notes != null) {
    getDb().prepare('UPDATE daily_checklist_runs SET admin_notes=? WHERE id=?').run(data.admin_notes || null, runId);
  }
  if (data?.status === 'confirmed') {
    return confirmChecklistRun(runId, { admin_notes: data.admin_notes }, actor);
  }
  if (data?.status === 'submitted') {
    getDb().prepare(`
      UPDATE daily_checklist_runs SET status='submitted', submitted_at=datetime('now'), submitted_by=?,
        failed_at=NULL, failure_reason=NULL WHERE id=?`)
      .run(actor?.id || null, runId);
  }
  audit(actor?.id, actor?.username, 'admin_edit_checklist', 'checklist_run', runId, { item_count: items.length });
  return getChecklistRun(runId);
}

function deleteChecklistRun(runId, actor) {
  requireRole(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  const run = getChecklistRun(runId);
  if (!run) throw new Error('Run not found');
  const db = getDb();
  db.prepare('DELETE FROM daily_checklist_items WHERE run_id = ?').run(runId);
  db.prepare('DELETE FROM daily_checklist_runs WHERE id = ?').run(runId);
  audit(actor?.id, actor?.username, 'delete_checklist', 'checklist_run', runId, {
    run_type: run.run_type, run_date: run.run_date, status: run.status
  });
  return true;
}

function finishChecklistRun(runId, actor) {
  return submitChecklistRun(runId, actor);
}

function buildChecklistReportPdf(runId, shopName) {
  const run = getChecklistRun(runId);
  if (!run) throw new Error('Run not found');
  const shop = getShopPdfSettings();
  if (shopName) shop.shop_name = shopName;
  const label = run.run_type === 'opening' ? 'Morning Opening Routine' : 'Closing Routine';
  const doc = new jsPDF();
  let y = drawPdfLetterhead(doc, shop, `${label.toUpperCase()} — CHECKLIST REPORT`, `Date: ${run.run_date}  |  Status: ${run.status}`);
  doc.setFontSize(10);
  if (run.submitted_at) doc.text(`Submitted: ${run.submitted_at}${run.submitted_by_name ? ` by ${run.submitted_by_name}` : ''}`, 14, y);
  y += run.submitted_at ? 6 : 0;
  if (run.confirmed_at) doc.text(`Confirmed: ${run.confirmed_at}${run.confirmed_by_name ? ` by ${run.confirmed_by_name}` : ''}`, 14, y);
  y += run.confirmed_at ? 6 : 0;
  if (run.admin_notes) {
    const noteLines = doc.splitTextToSize(`Admin notes: ${run.admin_notes}`, 180);
    doc.text(noteLines, 14, y);
    y += noteLines.length * 5 + 4;
  }
  doc.autoTable({
    startY: y + 2,
    head: [['#', 'Task', 'Status', 'Comments', 'Completed By']],
    body: run.items.map((i, idx) => {
      let status = 'Pending';
      if (i.item_status === 'done' || (!i.item_status && i.completed)) status = 'Done';
      else if (i.item_status === 'skipped') status = 'Not Done';
      return [String(idx + 1), i.task_name, status, i.comments || '—', i.employee_name || '—'];
    }),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [37, 99, 235] }
  });
  const finalY = doc.lastAutoTable?.finalY || y + 40;
  addPdfSignatureBlock(doc, finalY, shop);
  return pdfToBuffer(doc);
}

// ─── Non-selling products ────────────────────────────────────────────────────

function getNonSellingProducts(filters = {}) {
  const db = getDb();
  const days = parseInt(filters.days, 10) || 30;
  const from = filters.from || new Date(Date.now() - days * 86400000).toLocaleDateString('en-CA');
  const to = filters.to || today();
  const branchId = filters.branch_id;
  const todayStr = today();

  let sql = `
    SELECT p.*, c.name AS category_name,
      (SELECT MAX(date(s.created_at)) FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE si.product_id = p.id AND s.status = 'completed') AS last_sold
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.is_active = 1 AND p.item_type != 'service'`;
  const params = [];
  if (filters.category_id) { sql += ' AND p.category_id = ?'; params.push(filters.category_id); }
  if (filters.supplier_id) { sql += ' AND p.supplier_id = ?'; params.push(filters.supplier_id); }
  if (branchId) { sql += ' AND (p.branch_id IS NULL OR p.branch_id = ?)'; params.push(branchId); }
  sql += ` AND p.id NOT IN (
    SELECT DISTINCT si.product_id FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.status = 'completed' AND date(s.created_at) BETWEEN date(?) AND date(?)
  ) ORDER BY p.name`;
  params.push(from, to);
  return db.prepare(sql).all(...params).map(p => {
    const last = p.last_sold;
    let daysWithout = days;
    if (last) {
      daysWithout = Math.max(0, Math.floor((new Date(todayStr) - new Date(last)) / 86400000));
    }
    const stockVal = (Number(p.stock_quantity) || 0) * (Number(p.selling_price) || 0);
    return { ...p, days_without_sale: last ? daysWithout : null, stock_value: Math.round(stockVal * 100) / 100 };
  });
}

function exportNonSellingExcel(filters = {}) {
  const { buildExcelBuffer } = require('./export');
  const rows = getNonSellingProducts(filters);
  return buildExcelBuffer([{
    name: 'Non-Selling',
    data: rows.map(p => ({
      Product: p.name,
      SKU: p.sku || p.barcode || '',
      Category: p.category_name || '',
      Stock: p.stock_quantity,
      'Stock Value': p.stock_value,
      'Last Sale': p.last_sold || 'Never',
      'Days No Sale': p.days_without_sale ?? '',
      Price: p.selling_price
    }))
  }]);
}

function exportNonSellingPdf(filters, shopName, currency) {
  const rows = getNonSellingProducts(filters);
  const shop = getShopPdfSettings();
  if (shopName) shop.shop_name = shopName;
  const periodDays = filters.days || 30;
  const doc = new jsPDF();
  let y = drawPdfLetterhead(doc, shop, 'NON-SELLING PRODUCTS REPORT',
    `Products with no sales in the last ${periodDays} days`);
  const headers = ['Product', 'SKU', 'Category', 'Stock', 'Value', 'Last Sale', 'Days'];
  const data = rows.map(p => [
    p.name, p.sku || '—', p.category_name || '—', String(p.stock_quantity ?? 0),
    `${currency || shop.currency || 'R'}${Number(p.stock_value || 0).toFixed(2)}`, p.last_sold || 'Never',
    p.days_without_sale != null ? String(p.days_without_sale) : '—'
  ]);
  doc.autoTable({
    startY: y,
    head: [headers],
    body: data,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [37, 99, 235] }
  });
  const finalY = doc.lastAutoTable?.finalY || y + 40;
  addPdfSignatureBlock(doc, finalY, shop);
  return pdfToBuffer(doc);
}

function markProductPromo(productId, data, actor) {
  requireRole(actor, ['owner', 'manager']);
  getDb().prepare('UPDATE products SET promo_flag = ?, promo_notes = ? WHERE id = ?').run(
    data.promo_flag ? 1 : 0, data.promo_notes || null, productId
  );
  audit(actor?.id, actor?.username, 'mark_product_promo', 'product', productId, data);
  return getDb().prepare('SELECT id, name, promo_flag, promo_notes FROM products WHERE id = ?').get(productId);
}

// ─── Compliance warnings ───────────────────────────────────────────────────────

function getChecklistWarnings(filters = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM compliance_checklist_warnings WHERE 1=1';
  const params = [];
  if (filters.run_date) { sql += ' AND run_date = ?'; params.push(filters.run_date); }
  if (filters.manager_user_id) { sql += ' AND manager_user_id = ?'; params.push(filters.manager_user_id); }
  if (filters.acknowledged != null) { sql += ' AND acknowledged = ?'; params.push(filters.acknowledged ? 1 : 0); }
  sql += ' ORDER BY created_at DESC LIMIT 100';
  return db.prepare(sql).all(...params);
}

function getStaffPortalChecklistWarnings(userId) {
  if (!userId) return [];
  const db = getDb();
  const user = db.prepare('SELECT id, role, full_name, username, phone FROM users WHERE id = ?').get(userId);
  if (!user || !['owner', 'manager', 'assistant_manager', 'supervisor'].includes(user.role)) return [];
  return db.prepare(`
    SELECT * FROM compliance_checklist_warnings
    WHERE manager_user_id = ? AND acknowledged = 0
    ORDER BY created_at DESC LIMIT 20`).all(userId);
}

function acknowledgeChecklistWarning(warningId, actor) {
  getDb().prepare('UPDATE compliance_checklist_warnings SET acknowledged = 1 WHERE id = ?').run(warningId);
  audit(actor?.id, actor?.username, 'ack_checklist_warning', 'compliance_warning', warningId, null);
  return getDb().prepare('SELECT * FROM compliance_checklist_warnings WHERE id = ?').get(warningId);
}

function findManagersForWarning() {
  const db = getDb();
  return db.prepare(`
    SELECT u.id, u.full_name, u.username, u.role, e.phone
    FROM users u
    LEFT JOIN employees e ON e.user_id = u.id AND e.status = 'Active'
    WHERE u.is_active = 1 AND u.role IN ('owner', 'manager', 'assistant_manager', 'supervisor')
    ORDER BY CASE u.role WHEN 'manager' THEN 0 WHEN 'assistant_manager' THEN 1 ELSE 2 END, u.id`).all();
}

function recordChecklistWarning(runType, runDate, runId, manager, message, waResult) {
  const db = getDb();
  const existing = db.prepare(`
    SELECT id FROM compliance_checklist_warnings
    WHERE run_type = ? AND run_date = ? AND warning_type = 'not_submitted' AND manager_user_id = ?`).get(
    runType, runDate, manager.id
  );
  if (existing) return existing;
  const r = db.prepare(`
    INSERT INTO compliance_checklist_warnings (run_type, run_date, run_id, manager_user_id, manager_name, warning_type, message, whatsapp_url, whatsapp_body)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    runType, runDate, runId || null, manager.id, manager.full_name || manager.username,
    'not_submitted', message, waResult?.url || null, waResult?.body || null
  );
  return { id: r.lastInsertRowid };
}

function buildChecklistOverdueMessage(runType, runDate, manager, shop) {
  const tpl = whatsapp.getTemplateBySlug('checklist_overdue');
  const checklistLabel = runType === 'opening' ? 'Morning Opening' : 'Closing';
  const vars = whatsapp.buildVars({
    employee_name: manager.full_name || manager.username,
    branch: shop.shop_name,
    date: runDate,
    checklist_type: checklistLabel,
    phone: manager.phone
  });
  const body = tpl
    ? whatsapp.renderTemplate(tpl.body, vars)
    : `Hi ${manager.full_name || manager.username}, reminder: ${checklistLabel} checklist for ${runDate} at ${shop.shop_name} was not submitted. Please complete it in Operations → Daily Routines.`;
  let url = null;
  if (manager.phone) {
    try { url = whatsapp.buildWaUrl(manager.phone, body); } catch (_) { /* no phone */ }
  }
  return { body, url };
}

function ensureChecklistReminderNotifications() {
  const db = getDb();
  const todayStr = today();
  const deadlines = getChecklistDeadlines();
  const managers = findManagersForWarning();
  if (!managers.length) return;

  const checks = [
    { run_type: 'opening', deadline: deadlines.opening, label: 'Morning Opening' },
    { run_type: 'closing', deadline: deadlines.closing, label: 'Closing' }
  ];

  for (const chk of checks) {
    if (!timeAt(chk.deadline)) continue;
    const runs = db.prepare(`
      SELECT * FROM daily_checklist_runs WHERE run_type = ? AND run_date = ? AND status != 'cancelled'
    `).all(chk.run_type, todayStr);
    const done = runs.some(r => r.status === 'submitted' || r.status === 'confirmed');
    if (done) continue;
    for (const manager of managers) {
      const msg = `${chk.label} checklist is due now (${chk.deadline}). Please complete and submit in Operations.`;
      addNotification('checklist_reminder', `${chk.label} Checklist Due`, msg);
    }
  }
}

function ensureChecklistDeadlineWarnings() {
  const db = getDb();
  const todayStr = today();
  const shop = getShopPdfSettings();
  const managers = findManagersForWarning();
  if (!managers.length) return;

  const deadlines = getChecklistDeadlines();
  const checks = [
    { run_type: 'opening', deadline: deadlines.opening, label: 'Morning Opening' },
    { run_type: 'closing', deadline: deadlines.closing, label: 'Closing' }
  ];

  for (const chk of checks) {
    if (!timePast(chk.deadline)) continue;
    const runs = db.prepare(`
      SELECT * FROM daily_checklist_runs WHERE run_type = ? AND run_date = ? AND status != 'cancelled'
    `).all(chk.run_type, todayStr);
    const ok = runs.some(r => r.status === 'submitted' || r.status === 'confirmed');
    if (ok) continue;

    // Mark every unfinished worker run as failed — impacts Employee of the Month
    const unfinished = runs.filter(r => r.status === 'in_progress' || r.status === 'failed');
    for (const run of unfinished) {
      if (run.status !== 'failed') {
        markChecklistRunFailed(run.id, `Not submitted by deadline (${chk.deadline})`, { username: 'system' });
      }
    }
    // Also fail assigned workers who never started a run
    try {
      const tplTable = chk.run_type === 'opening' ? 'opening_checklist_templates' : 'closing_checklist_templates';
      const assigned = db.prepare(`
        SELECT DISTINCT assigned_employee_id AS id FROM ${tplTable}
        WHERE is_active = 1 AND assigned_employee_id IS NOT NULL
      `).all();
      for (const row of assigned) {
        const hasOk = db.prepare(`
          SELECT id FROM daily_checklist_runs
          WHERE run_type=? AND run_date=? AND employee_id=? AND status IN ('submitted','confirmed')
        `).get(chk.run_type, todayStr, row.id);
        if (hasOk) continue;
        const existing = db.prepare(`
          SELECT id, status FROM daily_checklist_runs
          WHERE run_type=? AND run_date=? AND employee_id=? AND status != 'cancelled'
          ORDER BY id DESC LIMIT 1
        `).get(chk.run_type, todayStr, row.id);
        if (existing?.status === 'failed') continue;
        if (existing) {
          markChecklistRunFailed(existing.id, `Not submitted by deadline (${chk.deadline})`, { username: 'system' });
        } else {
          const ins = db.prepare(`
            INSERT INTO daily_checklist_runs (run_type, run_date, employee_id, status, failed_at, failure_reason, completed_at)
            VALUES (?,?,?,'failed',datetime('now'),?,datetime('now'))
          `).run(chk.run_type, todayStr, row.id, `Not submitted by deadline (${chk.deadline})`);
          try {
            require('./employee-of-month').recordChecklistFailure?.(
              row.id, todayStr, chk.run_type, `Not submitted by deadline (${chk.deadline})`
            );
          } catch (_) { /* optional */ }
          audit(null, 'system', 'fail_checklist', 'checklist_run', ins.lastInsertRowid, { reason: 'never_started' });
        }
      }
    } catch (_) { /* templates may lack assigned_employee_id on old DBs */ }

    const inProgress = runs.find(r => r.status === 'in_progress' || r.status === 'failed');
    for (const manager of managers) {
      const msg = `${chk.label} checklist for ${todayStr} was not submitted by ${chk.deadline}. Failures were recorded for Employee of the Month.`;
      addNotification('checklist_overdue', `${chk.label} Checklist Overdue`, msg);
      const wa = buildChecklistOverdueMessage(chk.run_type, todayStr, manager, shop);
      recordChecklistWarning(chk.run_type, todayStr, inProgress?.id || null, manager, msg, wa);
      if (manager.phone && wa.url) {
        try {
          whatsapp.sendMessage({
            phone: manager.phone,
            body: wa.body,
            template_slug: 'checklist_overdue',
            message_type: 'checklist_overdue',
            recipient_type: 'employee',
            recipient_id: manager.id,
            recipient_name: manager.full_name || manager.username,
            employee_name: manager.full_name || manager.username,
            date: todayStr,
            checklist_type: chk.label,
            branch: shop.shop_name
          }, { id: null, username: 'system', role: 'owner', full_name: 'System' });
        } catch (_) { /* log-only fallback */ }
      }
    }
  }
}

function getComplianceDashboard() {
  const db = getDb();
  const todayStr = today();
  const openingToday = db.prepare('SELECT * FROM daily_checklist_runs WHERE run_type = ? AND run_date = ?').all('opening', todayStr);
  const closingToday = db.prepare('SELECT * FROM daily_checklist_runs WHERE run_type = ? AND run_date = ?').all('closing', todayStr);
  const activeRules = db.prepare('SELECT COUNT(*) AS c FROM company_rules WHERE status = ?').get('active').c;
  const nonSelling30 = getNonSellingProducts({ days: 30 }).length;
  const pendingSubmissions = db.prepare(`SELECT COUNT(*) AS c FROM daily_checklist_runs WHERE status = 'submitted'`).get().c;
  const recentWarnings = getChecklistWarnings({ run_date: todayStr });
  return {
    openingToday, closingToday, activeRules, nonSelling30, today: todayStr,
    pendingSubmissions, recentWarnings,
    adminSignature: getAdminSignature()
  };
}

module.exports = {
  getRules, getRule, saveRule, archiveRule, buildRulePdf, buildAllRulesPdf,
  saveAdminSignature, getAdminSignature,
  getOpeningTemplates, getClosingTemplates, saveOpeningTemplate, saveClosingTemplate,
  deleteOpeningTemplate, deleteClosingTemplate,
  getChecklistRuns, getChecklistRun, getPendingChecklistSubmissions,
  startChecklistRun, completeChecklistItem, submitChecklistRun, confirmChecklistRun, finishChecklistRun,
  reopenChecklistRun, adminUpdateChecklistRun, deleteChecklistRun,
  buildChecklistReportPdf, getNonSellingProducts, markProductPromo, getComplianceDashboard,
  exportNonSellingExcel, exportNonSellingPdf,
  getChecklistWarnings, getStaffPortalChecklistWarnings, acknowledgeChecklistWarning,
  ensureChecklistDeadlineWarnings, ensureChecklistReminderNotifications,
  getChecklistSettings, saveChecklistSettings, getChecklistDeadlines
};

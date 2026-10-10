const USER_PERM_KEYS = [
  'sell', 'void_sales', 'refunds', 'discounts', 'change_prices', 'view_reports', 'manage_stock',
  'customers', 'suppliers', 'gift_cards', 'cash_up', 'products', 'reports', 'operations',
  'delete_sales', 'system_settings', 'kitchen', 'quotes', 'layby', 'owner_salary', 'owner_salary_only',
  'expense_capture', 'ops_devices', 'ops_device_use',
  'request_backdated_order', 'authorize_backdated_order', 'view_backdated_orders',
  'correct_backdated_order', 'void_backdated_order',
  'mkt_view', 'mkt_campaign_create', 'mkt_campaign_edit', 'mkt_campaign_approve', 'mkt_campaign_send',
  'mkt_promotions', 'mkt_analytics', 'mkt_budget', 'mkt_ai', 'mkt_settings',
  'fin_view', 'fin_manage', 'fin_salaries', 'fin_reports', 'fin_ai',
  'studio_menu_builder', 'studio_promo_video',
  'radio_studio_access', 'radio_dashboard', 'radio_live_mic', 'radio_music', 'radio_playlists',
  'radio_announcements', 'radio_mixer', 'radio_sfx', 'radio_calls', 'radio_audience',
  'radio_broadcast', 'radio_social', 'radio_schedule', 'radio_promotions', 'radio_analytics', 'radio_settings'
];
const USER_PERM_LABELS = {
  sell: 'Make sales on POS', void_sales: 'Void sales (with supervisor code)', refunds: 'Process returns',
  discounts: 'Apply discounts', change_prices: 'Change prices', view_reports: 'View reports',
  manage_stock: 'Manage stock', customers: 'Manage customers', suppliers: 'Manage suppliers',
  gift_cards: 'Manage gift cards', cash_up: 'Cash-up operations', products: 'Manage products',
  reports: 'Full reports access', operations: 'Stock count & waste', delete_sales: 'Delete sales records',
  system_settings: 'System / admin settings', kitchen: 'Kitchen display', quotes: 'Quotes & lay-bye', layby: 'Lay-bye',
  owner_salary: 'Owner salary — pay & view under Staff tab',
  owner_salary_only: 'Staff tab — Owner Salary only (hide employee portal)',
  expense_capture: 'Capture expenses (Admin + mobile Expenses app)',
  ops_devices: 'Admin — Ops Devices registry (pair KDS/CDS, revoke)',
  ops_device_use: 'Open Kiosk / Kitchen / Drive-Thru / Customer Display apps',
  request_backdated_order: 'Request missed / backdated order (needs manager auth)',
  authorize_backdated_order: 'Authorize missed / backdated orders',
  view_backdated_orders: 'View backdated orders dashboard',
  correct_backdated_order: 'Correct a backdated order (creates adjustment)',
  void_backdated_order: 'Void a backdated order',
  mkt_view: 'Marketing — View Marketing Center',
  mkt_campaign_create: 'Marketing — Create campaigns',
  mkt_campaign_edit: 'Marketing — Edit campaigns',
  mkt_campaign_approve: 'Marketing — Approve campaigns',
  mkt_campaign_send: 'Marketing — Send / launch campaigns',
  mkt_promotions: 'Marketing — Manage promotions',
  mkt_analytics: 'Marketing — View analytics',
  mkt_budget: 'Marketing — Manage budget & costs',
  mkt_ai: 'Marketing — Use AI Marketing Assistant',
  mkt_settings: 'Marketing — Manage marketing settings',
  fin_view: 'Financial — View Financial Intelligence',
  fin_manage: 'Financial — Manage allocations, planned positions & settings',
  fin_salaries: 'Financial — Employees & salaries',
  fin_reports: 'Financial — Generate, export & share reports',
  fin_ai: 'Financial — Use AI Financial Advisor',
  studio_menu_builder: 'Studio — Menu Builder Access',
  studio_promo_video: 'Studio — Promo Video Builder Access',
  radio_studio_access: 'Radio Studio Access',
  radio_dashboard: 'Radio — Dashboard',
  radio_live_mic: 'Radio — Live Microphone',
  radio_music: 'Radio — Music Library',
  radio_playlists: 'Radio — Playlists',
  radio_announcements: 'Radio — Voice Announcements',
  radio_mixer: 'Radio — Audio Mixer',
  radio_sfx: 'Radio — Sound Effects',
  radio_calls: 'Radio — Live Calls',
  radio_audience: 'Radio — Audience Chat',
  radio_broadcast: 'Radio — Live Broadcast',
  radio_social: 'Radio — Social Broadcasting',
  radio_schedule: 'Radio — Schedule',
  radio_promotions: 'Radio — Promotions',
  radio_analytics: 'Radio — Analytics',
  radio_settings: 'Radio — Settings'
};

const STUDIO_PERM_KEYS = ['studio_menu_builder', 'studio_promo_video'];
const RADIO_PERM_KEYS = [
  'radio_studio_access', 'radio_dashboard', 'radio_live_mic', 'radio_music', 'radio_playlists',
  'radio_announcements', 'radio_mixer', 'radio_sfx', 'radio_calls', 'radio_audience',
  'radio_broadcast', 'radio_social', 'radio_schedule', 'radio_promotions', 'radio_analytics', 'radio_settings'
];
const GENERAL_PERM_KEYS = USER_PERM_KEYS.filter((k) => !STUDIO_PERM_KEYS.includes(k) && !RADIO_PERM_KEYS.includes(k));
const STAFF_MODULES = [
  ['pos', 'POS'],
  ['admin', 'Admin'],
  ['kitchen', 'Kitchen'],
  ['drive_thru', 'Drive-Thru'],
  ['kiosk', 'Kiosk'],
  ['customer_display', 'Customer display'],
  ['delivery', 'Delivery'],
  ['expenses', 'Expenses'],
  ['marketing', 'Marketing'],
  ['radio', 'Radio'],
  ['recipe', 'Recipe'],
  ['staff_portal', 'Staff portal'],
  ['signage', 'Digital signage'],
  ['hr', 'Staff & HR']
];

function whenText(value) {
  if (!value) return '—';
  try { return Utils.formatDateTime(value); } catch (_) { return String(value); }
}

function histText(u) {
  const hist = u.history || {};
  return Object.entries(hist).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${n} ${String(k).replace(/_/g, ' ')}`).join(', ') || 'No records yet';
}

function staffStatus(u) {
  const s = String(u.access_status || (u.is_active ? 'ACTIVE' : 'INACTIVE')).toUpperCase();
  const cls = s === 'ACTIVE' ? 'tag-ok' : (s === 'BLOCKED' || s === 'DELETED' || s === 'TERMINATED' ? 'tag-out' : 'tag');
  return `<span class="tag ${cls}">${Utils.escHtml(s)}</span>`;
}

function staffModules(u) {
  let mods = u.modules;
  if (!mods) {
    try { mods = JSON.parse(u.modules_json || '[]'); } catch (_) { mods = []; }
  }
  return Array.isArray(mods) && mods.length ? mods.join(', ') : '—';
}

function staffActions(u, app) {
  const owner = app.user?.role === 'owner';
  const canDeactivate = owner || app.user?.role === 'manager';
  const self = u.id === app.user.id;
  const status = String(u.access_status || (u.is_active ? 'ACTIVE' : 'INACTIVE')).toUpperCase();
  return `<td class="actions" style="white-space:normal;min-width:220px">
    <button class="btn btn-sm btn-ghost" data-act="view" data-id="${u.id}">View</button>
    ${status !== 'DELETED' ? `<button class="btn btn-sm btn-ghost" data-act="edit" data-id="${u.id}">Edit</button>` : ''}
    ${status !== 'DELETED' ? `<button class="btn btn-sm btn-ghost" data-act="permissions" data-id="${u.id}">Permissions</button>` : ''}
    ${owner && !self && status === 'ACTIVE' ? `<button class="btn btn-sm btn-warning" data-act="block" data-id="${u.id}">Block</button>` : ''}
    ${owner && !self && status === 'BLOCKED' ? `<button class="btn btn-sm btn-primary" data-act="unblock" data-id="${u.id}">Unblock</button>` : ''}
    ${canDeactivate && !self && status === 'ACTIVE' ? `<button class="btn btn-sm btn-warning" data-act="deactivate" data-id="${u.id}">Deactivate</button>` : ''}
    ${owner && !self && !['DELETED', 'TERMINATED'].includes(status) ? `<button class="btn btn-sm btn-ghost" data-act="terminate" data-id="${u.id}">Terminate</button>` : ''}
    ${owner && !self && (status === 'INACTIVE' || status === 'TERMINATED') ? `<button class="btn btn-sm btn-primary" data-act="unblock" data-id="${u.id}">Restore</button>` : ''}
    ${owner && !self && status !== 'DELETED' ? `<button class="btn btn-sm btn-danger" data-act="delete" data-id="${u.id}">Delete</button>` : ''}
    <button class="btn btn-sm btn-ghost" data-act="history" data-id="${u.id}">View History</button>
    ${owner ? `<button class="btn btn-sm btn-ghost" data-act="transfer" data-id="${u.id}">Transfer Records</button>` : ''}
    ${owner && !self ? `<button class="btn btn-sm btn-ghost" data-act="logout" data-id="${u.id}">Force Logout</button>` : ''}
  </td>`;
}

function renderUserTableRows(users, app) {
  return users.map((u) => `<tr>
      <td>${Utils.escHtml(u.full_name)}</td>
      <td>${Utils.escHtml(u.staff_code || '—')}</td>
      <td>${Utils.roleTag(u.role)}</td>
      <td>${Utils.escHtml(u.branch_name || '—')}</td>
      <td>${staffStatus(u)}</td>
      <td>${Utils.escHtml(staffModules(u))}</td>
      <td>${Utils.escHtml(u.pos_terminal || '—')}</td>
      <td class="muted">${Utils.escHtml(whenText(u.last_login))}</td>
      <td class="muted">${Utils.escHtml(histText(u))}</td>
      ${staffActions(u, app)}</tr>`).join('');
}

function renderBlockedRows(users, app) {
  return users.map((u) => `<tr>
      <td>${Utils.escHtml(u.full_name)}</td>
      <td>${Utils.escHtml(u.staff_code || '—')}</td>
      <td>${Utils.roleTag(u.role)}</td>
      <td>${Utils.escHtml(u.branch_name || '—')}</td>
      <td>${Utils.escHtml(whenText(u.blocked_at))}</td>
      <td>${Utils.escHtml(u.blocked_by_name || '—')}</td>
      <td>${Utils.escHtml(u.block_reason || '—')}</td>
      <td class="muted">${Utils.escHtml(whenText(u.last_login))}</td>
      ${staffActions(u, app)}</tr>`).join('');
}

function renderArchiveRows(users, app) {
  return users.map((u) => `<tr>
      <td>${Utils.escHtml(u.full_name)}</td>
      <td>${Utils.escHtml(u.staff_code || '—')}</td>
      <td>${Utils.roleTag(u.role)}</td>
      <td>${Utils.escHtml(u.branch_name || '—')}</td>
      <td>${Utils.escHtml(u.deleted_by_name || '—')}</td>
      <td>${Utils.escHtml(whenText(u.deleted_at))}</td>
      <td>${Utils.escHtml(u.delete_reason || '—')}</td>
      <td>${u.transfer?.mode === 'transfer' ? Utils.escHtml(u.transfer.to_name || 'Main Admin') : 'Original employee'}</td>
      ${staffActions(u, app)}</tr>`).join('');
}

const UsersPage = {
  async render(el, app) {
    this.app = app;
    this._el = el;
    const view = this.view || 'active';
    el.innerHTML = `<div class="page-toolbar"><h3>Staff</h3></div><p class="muted">Loading staff profiles…</p>`;
    const res = await API.staffCommand({ action: 'board' }, app.user);
    if (!res.success) {
      el.innerHTML = `<div class="page-toolbar"><h3>Staff</h3></div><p class="error-msg">${Utils.escHtml(res.error || 'Could not load staff')}</p>`;
      return;
    }
    const board = res.data || {};
    this.users = board.users || [];
    const branchId = this.branchFilter ? Number(this.branchFilter) : 0;
    const inBranch = (u) => !branchId || Number(u.branch_id) === branchId;
    const branchName = this.branchFilterName || this.users.find((u) => Number(u.branch_id) === branchId)?.branch_name || '';
    const tabs = [
      ['active', 'Active'],
      ['blocked', `Blocked users (${(board.blocked || []).filter(inBranch).length})`],
      ['archive', `Deleted staff archive (${(board.archived || []).filter(inBranch).length})`],
      ['transferred', `Transferred records (${(board.transfers || []).length})`]
    ];
    const tabBtn = tabs.map(([id, label]) =>
      `<button class="btn btn-sm ${view === id ? 'btn-primary' : 'btn-ghost'}" data-view="${id}">${label}</button>`
    ).join(' ');
    const head = `<tr><th>Employee</th><th>Staff ID</th><th>Role</th><th>Branch</th><th>Status</th><th>Modules</th><th>POS</th><th>Last login</th><th>Historical records</th><th>Actions</th></tr>`;
    let body = '';
    if (view === 'blocked') {
      const rows = (board.blocked || []).filter(inBranch);
      body = `<h4>Blocked users</h4>
        <p class="muted">A blocked person is signed out of POS and every module. The message they see is ACCOUNT BLOCKED BY ADMIN. Their sales and other history stay on the original record.</p>
        <div class="card"><div class="table-wrap"><table>
          <thead><tr><th>Employee</th><th>Staff ID</th><th>Role</th><th>Branch</th><th>Blocked date</th><th>Blocked by</th><th>Reason</th><th>Last login</th><th>Actions</th></tr></thead>
          <tbody>${renderBlockedRows(rows, app) || '<tr><td colspan="9" class="muted">No blocked users</td></tr>'}</tbody>
        </table></div></div>`;
    } else if (view === 'archive') {
      const rows = (board.archived || []).filter(inBranch);
      body = `<h4>Deleted staff archive</h4>
        <p class="muted">These people cannot sign in. Deleting a profile does not delete sales, expenses, stock or audit history.</p>
        <div class="card"><div class="table-wrap"><table>
          <thead><tr><th>Employee</th><th>Staff ID</th><th>Original role</th><th>Original branch</th><th>Deleted by</th><th>Deleted date</th><th>Reason</th><th>Current owner</th><th>Actions</th></tr></thead>
          <tbody>${renderArchiveRows(rows, app) || '<tr><td colspan="9" class="muted">No deleted staff</td></tr>'}</tbody>
        </table></div></div>`;
    } else if (view === 'transferred') {
      const rows = (board.transfers || []).map((t) => {
        let counts = {};
        try { counts = JSON.parse(t.counts_json || '{}'); } catch (_) { counts = {}; }
        const summary = Object.entries(counts).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(', ') || 'None';
        return `<tr>
          <td>${Utils.escHtml(t.from_name_snapshot || '')} — ${Utils.escHtml(t.from_staff_code || '')}</td>
          <td>${Utils.escHtml(t.to_name_snapshot || 'Main Admin')}</td>
          <td>${Utils.escHtml(t.transferred_at ? Utils.formatDateTime(t.transferred_at) : '—')}</td>
          <td>${Utils.escHtml(t.transferred_by_name || '—')}</td>
          <td>${Utils.escHtml(t.reason || '—')}</td>
          <td>${Utils.escHtml(t.mode === 'transfer' ? 'Transferred to Main Admin' : 'Preserved with original employee')}</td>
          <td>${Utils.escHtml(summary)}</td>
          <td><button class="btn btn-sm btn-ghost" data-act="history" data-id="${t.from_user_id}">View History</button></td>
        </tr>`;
      }).join('');
      body = `<h4>Transferred records</h4>
        <p class="muted">Current ownership can sit with the Main Admin. Originally performed by stays the employee who did the work. Sales are not rewritten.</p>
        <div class="card"><div class="table-wrap"><table>
          <thead><tr><th>Originally performed by</th><th>Current owner</th><th>When</th><th>Transferred by</th><th>Reason</th><th>Mode</th><th>Records</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8" class="muted">No transfers yet</td></tr>'}</tbody>
        </table></div></div>`;
    } else {
      const active = this.users.filter((u) => String(u.access_status || 'ACTIVE').toUpperCase() === 'ACTIVE' && inBranch(u));
      const resting = this.users.filter((u) => ['INACTIVE', 'TERMINATED'].includes(String(u.access_status || '').toUpperCase()) && inBranch(u));
      body = `<h4>Staff profiles</h4>
        <p class="muted">One profile per person, used by POS and every module. Only the Main Admin creates logins. Blocking removes access everywhere. Deleting a profile does not delete sales or other history.</p>
        <div class="card"><div class="table-wrap"><table><thead>${head}</thead><tbody>
          ${renderUserTableRows(active, app) || '<tr><td colspan="10" class="muted">No active staff</td></tr>'}
        </tbody></table></div></div>
        <h4 style="margin-top:16px">Inactive and terminated</h4>
        <div class="card"><div class="table-wrap"><table><thead>${head}</thead><tbody>
          ${renderUserTableRows(resting, app) || '<tr><td colspan="10" class="muted">No inactive or terminated staff</td></tr>'}
        </tbody></table></div></div>`;
    }
    const purge = app.user?.role === 'owner' ? `<div class="card" style="margin-top:16px"><div class="card-body">
      <h4 style="margin-top:0">Permanently remove one historical record</h4>
      <p class="error-msg">This action permanently removes historical business data and cannot be undone. It does not delete a staff profile, and it does not run when you block or archive someone.</p>
      <div class="form-grid">
        <div class="field"><label>Record type</label>
          <select id="purge-table">
            <option value="sales">Sale</option>
            <option value="returns">Refund</option>
            <option value="expenses">Expense</option>
            <option value="stock_movements">Stock movement</option>
            <option value="waste_records">Wastage</option>
            <option value="purchase_orders">Purchase order</option>
          </select></div>
        <div class="field"><label>Record ID</label><input id="purge-id" inputmode="numeric" placeholder="Numeric id"></div>
        <div class="field"><label>Reason</label><input id="purge-reason" placeholder="Why this record must be removed"></div>
        <div class="field"><label>Main Admin password</label><input type="password" id="purge-password" autocomplete="current-password"></div>
      </div>
      <button type="button" class="btn btn-danger" id="purge-record" style="margin-top:8px">Permanently remove this record</button>
    </div></div>` : '';
    const branchNote = branchId
      ? `<p class="muted">Showing staff for <strong>${Utils.escHtml(branchName || 'this branch')}</strong>. <button type="button" class="btn btn-sm btn-ghost" id="staff-all-branches">Show every branch</button></p>`
      : '';
    el.innerHTML = `<div class="page-toolbar"><h3>Staff</h3>
      ${app.user?.role === 'owner' ? '<button class="btn btn-primary" id="add-user">+ Create staff profile</button>' : ''}
      </div>
      ${branchNote}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px">${tabBtn}</div>
      ${body}
      ${purge}`;
    document.getElementById('add-user')?.addEventListener('click', () => this.showForm(null, () => this.render(el, app)));
    document.getElementById('staff-all-branches')?.addEventListener('click', () => {
      this.branchFilter = 0;
      this.branchFilterName = '';
      this.render(el, app);
    });
    document.getElementById('purge-record')?.addEventListener('click', () => this.purgeRecord(() => this.render(el, app)));
    el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
      this.view = b.dataset.view;
      this.render(el, app);
    }));
    el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const user = this.users.find((u) => u.id == b.dataset.id) || { id: Number(b.dataset.id) };
      this.onStaffAction(b.dataset.act, user, () => this.render(el, app));
    }));
  },

  async onStaffAction(act, user, onDone) {
    if (!user?.id) return;
    if (act === 'edit' || act === 'permissions') return this.showForm(this.users.find((u) => u.id == user.id) || user, onDone);
    if (act === 'view' || act === 'history') return this.showHistory(user);
    if (act === 'block') return this.blockUser(user, onDone);
    if (act === 'terminate') return this.terminateUser(user, onDone);
    if (act === 'unblock') return this.runCommand({ action: 'unblock', userId: user.id, reason: 'Restored by Main Admin' }, 'Access restored', onDone);
    if (act === 'deactivate') return this.deactivateUser(user, onDone);
    if (act === 'delete') return this.archiveUser(user, onDone);
    if (act === 'transfer') return this.transferUser(user, onDone);
    if (act === 'logout') return this.runCommand({ action: 'logout', userId: user.id }, 'Signed out on every device', onDone);
  },

  async runCommand(payload, okText, onDone) {
    const r = await API.staffCommand(payload, this.app.user);
    if (!r.success) return Utils.toast(r.error || 'Could not update staff', 'error');
    Utils.toast(okText, 'success');
    if (onDone) onDone();
  },

  async terminateUser(user, onDone) {
    const reason = prompt(`Terminate ${user.full_name}? They will be signed out. Historical records stay.\n\nReason`);
    if (!reason || !reason.trim()) return Utils.toast('A reason is required', 'error');
    return this.runCommand({ action: 'terminate', userId: user.id, reason: reason.trim() }, 'Staff terminated. History kept.', onDone);
  },

  async purgeRecord(onDone) {
    const table = document.getElementById('purge-table')?.value;
    const recordId = Number(document.getElementById('purge-id')?.value);
    const reason = document.getElementById('purge-reason')?.value.trim();
    const password = document.getElementById('purge-password')?.value;
    if (!recordId) return Utils.toast('Enter the record id', 'error');
    if (!reason) return Utils.toast('A reason is required', 'error');
    if (!password) return Utils.toast('Enter the Main Admin password', 'error');
    const ok = confirm('This action permanently removes historical business data and cannot be undone.');
    if (!ok) return;
    return this.runCommand({ action: 'purge', table, recordId, reason, password }, 'Historical record removed', onDone);
  },

  async blockUser(user, onDone) {
    const ok = confirm('Blocking this user will immediately revoke access to all modules, branches and POS terminals. Their historical business records will remain preserved.');
    if (!ok) return;
    const reason = prompt('Reason for blocking (optional)') || '';
    return this.runCommand({ action: 'block', userId: user.id, reason }, 'ACCOUNT BLOCKED BY ADMIN', onDone);
  },

  async archiveUser(user, onDone) {
    const modePick = prompt('Deleting this person will remove their active user identity and access from the operational system. Historical records will be preserved. You must choose how historical ownership will be handled.\n\nType PRESERVE to keep “Originally performed by: ' + user.full_name + '”.\nType TRANSFER to set current ownership to the Main Admin and keep the original employee.');
    if (modePick == null) return;
    const mode = String(modePick).trim().toUpperCase() === 'TRANSFER' ? 'transfer' : (String(modePick).trim().toUpperCase() === 'PRESERVE' ? 'preserve' : '');
    if (!mode) return Utils.toast('Type PRESERVE or TRANSFER', 'error');
    const reason = prompt('Reason');
    if (!reason || !reason.trim()) return Utils.toast('A reason is required', 'error');
    const password = prompt('Main Admin password');
    if (!password) return;
    const typed = prompt(`Type the username "${user.username}" to confirm`);
    if (typed == null || typed.trim() !== user.username) return Utils.toast('Username did not match — cancelled', 'error');
    return this.runCommand({
      action: 'archive', userId: user.id, mode, reason: reason.trim(), password, confirmUsername: typed.trim()
    }, mode === 'transfer' ? 'Archived. History transferred. Original employee kept.' : 'Archived. History kept under the original employee.', onDone);
  },

  async transferUser(user, onDone) {
    const reason = prompt('Transfer historical ownership to the Main Admin? The original employee stays on every record.\n\nReason');
    if (!reason || !reason.trim()) return;
    const password = prompt('Main Admin password');
    if (!password) return;
    return this.runCommand({ action: 'transfer', userId: user.id, reason: reason.trim(), password }, 'Ownership transferred. Original employee kept.', onDone);
  },

  async showHistory(user) {
    const r = await API.staffCommand({ action: 'profile', userId: user.id }, this.app.user);
    if (!r.success) return Utils.toast(r.error || 'Could not load history', 'error');
    const p = r.data?.user || user;
    const events = r.data?.events || [];
    const hist = p.history || {};
    const histHtml = Object.entries(hist).map(([k, n]) => `<li>${Utils.escHtml(k.replace(/_/g, ' '))}: ${n}</li>`).join('');
    const evHtml = events.map((e) => `<li>${Utils.escHtml(e.created_at || '')} — ${Utils.escHtml(e.action)} ${e.from_status ? `(${Utils.escHtml(e.from_status)} → ${Utils.escHtml(e.to_status || '')})` : ''} by ${Utils.escHtml(e.actor_name || '')}${e.reason ? ` — ${Utils.escHtml(e.reason)}` : ''}</li>`).join('');
    const transfer = p.transfer;
    Utils.showModal(`${p.full_name || 'Staff'} — ${p.staff_code || ''}`, `
      <p><strong>Status:</strong> ${Utils.escHtml(p.access_status || '')}</p>
      <p><strong>Role:</strong> ${Utils.escHtml(p.role || '')} · <strong>Branch:</strong> ${Utils.escHtml(p.branch_name || '—')} · <strong>POS:</strong> ${Utils.escHtml(p.pos_terminal || '—')}</p>
      <p><strong>Modules:</strong> ${Utils.escHtml(staffModules(p))} · <strong>Last login:</strong> ${Utils.escHtml(whenText(p.last_login))}</p>
      ${p.deleted_at ? `<p><strong>Deleted by:</strong> ${Utils.escHtml(p.deleted_by_name || '')} · ${Utils.escHtml(p.deleted_at)}<br>${Utils.escHtml(p.delete_reason || '')}</p>` : ''}
      ${p.blocked_at ? `<p><strong>Blocked by:</strong> ${Utils.escHtml(p.blocked_by_name || '')} · ${Utils.escHtml(p.block_reason || '')}</p>` : ''}
      ${transfer ? `<p><strong>Current owner:</strong> ${Utils.escHtml(transfer.to_name || '')}<br><strong>Originally performed by:</strong> ${Utils.escHtml(p.full_name || '')}<br>Transferred by ${Utils.escHtml(transfer.by_name || '')} · ${Utils.escHtml(transfer.at || '')}<br>${Utils.escHtml(transfer.reason || '')}</p>` : ''}
      <h4>Historical activity</h4><ul>${histHtml || '<li>None</li>'}</ul>
      <h4>Timeline</h4><ul>${evHtml || '<li>No status changes yet</li>'}</ul>`);
  },

  async showForm(user = null, onSaved) {
    const app = this.app;
    const branchesRes = await API.getBranches();
    const branches = branchesRes.data || [];
    let perms = {};
    if (user?.permissions) {
      try { perms = JSON.parse(user.permissions); } catch { perms = {}; }
    }
    const selectedModules = new Set(Array.isArray(user?.modules) ? user.modules : []);
    const showPerms = !user || ['assistant_manager', 'manager', 'cashier', 'supervisor'].includes(user.role);
    const canGrantRecipe = app.user?.role === 'owner';
    const editingOwner = user?.role === 'owner';
    let recipeAccess = null;
    if (canGrantRecipe && user?.id && !editingOwner) {
      try {
        const ar = await API.recipeAccessList(app.user);
        if (ar.success) recipeAccess = (ar.data || []).find(a => a.user_id === user.id) || null;
      } catch (_) { /* ignore */ }
    }

    Utils.showModal(user ? `Edit User — ${user.full_name}` : 'Add User', `
      <div class="form-grid">
        <div class="field"><label>Full Name *</label><input id="uf-name" value="${user?.full_name || ''}"></div>
        <div class="field"><label>Username *</label><input id="uf-username" value="${user?.username || ''}" autocomplete="off"></div>
        <div class="field"><label>Password ${user ? '(leave blank to keep)' : '*'}</label><input type="password" id="uf-password" autocomplete="new-password"></div>
        <div class="field"><label>PIN ${user?.has_pin ? '(leave blank to keep)' : '(optional)'}${user?.role === 'manager' || user?.role === 'owner' || user?.role === 'supervisor' ? ' — POS approval' : ''}</label>
          <input type="password" id="uf-pin" maxlength="6" inputmode="numeric" placeholder="6-digit PIN"></div>
        <div class="field"><label>Role</label>
          <select id="uf-role">
            ${app.user?.role === 'owner' ? `<option value="owner" ${user?.role === 'owner' ? 'selected' : ''}>Owner</option>` : ''}
            <option value="manager" ${user?.role === 'manager' ? 'selected' : ''}>Manager</option>
            <option value="assistant_manager" ${user?.role === 'assistant_manager' ? 'selected' : ''}>Assistant Manager</option>
            <option value="supervisor" ${user?.role === 'supervisor' ? 'selected' : ''}>Supervisor</option>
            <option value="delivery_manager" ${user?.role === 'delivery_manager' ? 'selected' : ''}>Delivery Department</option>
            <option value="referral_agent" ${user?.role === 'referral_agent' ? 'selected' : ''}>Referral Agent</option>
            <option value="cashier" ${user?.role === 'cashier' ? 'selected' : ''}>Cashier</option>
          </select></div>
        <div class="field"><label>Branch ${['manager', 'supervisor', 'cashier', 'assistant_manager', 'delivery_manager'].includes(user?.role) || !user ? '*' : ''}</label>
          <select id="uf-branch">
            <option value="">— ${user?.role === 'delivery_manager' || (!user) ? 'All branches / shared' : 'Select branch'} —</option>
            ${branches.map(b => `<option value="${b.id}" ${(user?.branch_id == b.id || (!user && Number(this.branchFilter) === Number(b.id))) ? 'selected' : ''}>${b.name}</option>`).join('')}
          </select>
          <small class="muted">1 manager + 1 supervisor per branch. Many cashiers allowed. The same branch list is used by Admin → Branches.</small>
        </div>
        <div class="field"><label>POS terminal</label>
          <input id="uf-pos" value="${Utils.escHtml(user?.pos_terminal || '')}" placeholder="e.g. Front Counter 1"></div>
        <div class="field full"><label>Modules</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:4px">
            ${STAFF_MODULES.map(([id, label]) => `<label style="font-size:13px"><input type="checkbox" class="uf-mod" value="${id}" ${selectedModules.has(id) ? 'checked' : ''}> ${label}</label>`).join('')}
          </div>
        </div>
        ${user ? `<div class="field full"><label><input type="checkbox" id="uf-active" ${user.is_active ? 'checked' : ''}> Active — can sign in</label></div>
        ${user.has_pin ? '<div class="field full"><label><input type="checkbox" id="uf-clear-pin"> Clear PIN</label></div>' : ''}` : ''}
        ${showPerms ? `<div class="field full" id="uf-perms-wrap"><label>Permissions <span class="muted">(optional — overrides role defaults)</span></label>
          <div style="max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;margin-top:4px">
            ${GENERAL_PERM_KEYS.map(k => `<label style="display:block;padding:3px 0;font-size:13px"><input type="checkbox" class="uf-perm" data-key="${k}" ${perms[k] ? 'checked' : ''}> ${USER_PERM_LABELS[k] || k.replace(/_/g, ' ')}</label>`).join('')}
          </div></div>` : ''}
        ${showPerms ? `<div class="field full" id="uf-studio-wrap" style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
          <label style="font-weight:600">Studio Access</label>
          <p class="muted" style="margin:4px 0 8px;font-size:12px">Controls the Windows &amp; Android Menu &amp; Promo Studio app. Owner always has full access. Turning OFF revokes active Studio sessions.</p>
          ${STUDIO_PERM_KEYS.map(k => `<label style="display:block;padding:4px 0;font-size:13px"><input type="checkbox" class="uf-perm" data-key="${k}" ${perms[k] ? 'checked' : ''}> ${USER_PERM_LABELS[k]}</label>`).join('')}
        </div>` : ''}
        ${showPerms ? `<div class="field full" id="uf-radio-wrap" style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
          <label style="font-weight:600">📻 Radio Studio Access</label>
          <p class="muted" style="margin:4px 0 8px;font-size:12px">Shop Radio — separate from Menu/Promo Studio. Owner always has full access. Turning Radio Studio Access OFF revokes active Radio sessions.</p>
          ${RADIO_PERM_KEYS.map(k => `<label style="display:block;padding:4px 0;font-size:13px"><input type="checkbox" class="uf-perm" data-key="${k}" ${perms[k] ? 'checked' : ''}> ${USER_PERM_LABELS[k]}</label>`).join('')}
        </div>` : ''}
        ${canGrantRecipe && editingOwner ? `<div class="field full" style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
          <label style="font-weight:600">Recipe &amp; Production Management System</label>
          <p class="muted" style="margin:4px 0 0;font-size:12px">Owner / Admin is not granted access here. Sign in with this username and password on the Recipe login screen.</p>
        </div>` : ''}
        ${canGrantRecipe && !editingOwner ? `<div class="field full" id="uf-recipe-wrap" style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
          <label style="font-weight:600">Recipe &amp; Production Management System</label>
          <p class="muted" style="margin:4px 0 8px;font-size:12px">Grant only for non-owner staff. Owner / Admin uses their POS username and password — no grant needed.</p>
          <label style="display:block;margin-bottom:8px"><input type="checkbox" id="uf-recipe-enabled" ${recipeAccess?.enabled ? 'checked' : ''}> Allow login to Recipe &amp; Production System</label>
          <div class="field"><label>Recipe Role</label>
            <select id="uf-recipe-role">
              <option value="administrator" ${recipeAccess?.recipe_role === 'administrator' ? 'selected' : ''}>Administrator</option>
              <option value="production_manager" ${recipeAccess?.recipe_role === 'production_manager' ? 'selected' : ''}>Production Manager</option>
              <option value="kitchen_manager" ${recipeAccess?.recipe_role === 'kitchen_manager' ? 'selected' : ''}>Kitchen Manager</option>
              <option value="supervisor" ${recipeAccess?.recipe_role === 'supervisor' ? 'selected' : ''}>Supervisor</option>
              <option value="viewer" ${!recipeAccess || recipeAccess?.recipe_role === 'viewer' ? 'selected' : ''}>Viewer</option>
            </select>
          </div>
        </div>` : ''}
      </div>`,
      `${user && user.id !== app.user?.id ? '<button class="btn btn-danger" id="delete-user">Delete user</button>' : ''}
      <button class="btn btn-primary" id="save-user">Save User</button>`);

    const syncRecipeGrantVisibility = () => {
      const wrap = document.getElementById('uf-recipe-wrap');
      if (!wrap) return;
      const role = document.getElementById('uf-role')?.value;
      wrap.style.display = role === 'owner' ? 'none' : '';
    };
    document.getElementById('uf-role')?.addEventListener('change', syncRecipeGrantVisibility);
    syncRecipeGrantVisibility();

    document.getElementById('delete-user')?.addEventListener('click', () => {
      this.permanentlyDeleteUser(user, () => {
        Utils.hideModal();
        if (onSaved) onSaved();
      });
    });
    document.getElementById('save-user').addEventListener('click', async () => {
      const data = {
        full_name: document.getElementById('uf-name').value.trim(),
        username: document.getElementById('uf-username').value.trim(),
        role: document.getElementById('uf-role').value,
        branch_id: parseInt(document.getElementById('uf-branch').value, 10) || null,
        pos_terminal: document.getElementById('uf-pos')?.value.trim() || '',
        modules: [...document.querySelectorAll('.uf-mod:checked')].map((c) => c.value)
      };
      const password = document.getElementById('uf-password').value;
      const pin = document.getElementById('uf-pin').value;
      if (password) data.password = password;
      if (pin) data.pin = pin;
      const p = {};
      document.querySelectorAll('.uf-perm').forEach(c => { p[c.dataset.key] = c.checked; });
      if (document.querySelectorAll('.uf-perm').length) data.permissions = p;
      if (user) {
        const activeEl = document.getElementById('uf-active');
        if (activeEl) data.is_active = activeEl.checked;
        if (document.getElementById('uf-clear-pin')?.checked) data.clear_pin = true;
      }
      if (!data.full_name) return Utils.toast('Name required', 'error');
      if (!data.username) return Utils.toast('Username required', 'error');
      if (!user && !password) return Utils.toast('Password required for new users', 'error');
      const r = user
        ? await API.updateUser(user.id, data, app.user)
        : await API.createUser({ ...data, password }, app.user);
      if (!r.success) return Utils.toast(r.error || 'Save failed', 'error');

      const recipeEnabledEl = document.getElementById('uf-recipe-enabled');
      if (canGrantRecipe && recipeEnabledEl && data.role !== 'owner') {
        const uid = user?.id || (typeof r.data === 'number' ? r.data : (r.data?.id || r.data?.user?.id));
        if (uid) {
          if (recipeEnabledEl.checked) {
            const ar = await API.recipeSetAccess({
              user_id: uid,
              recipe_role: document.getElementById('uf-recipe-role').value,
              enabled: true
            }, app.user);
            if (!ar.success) Utils.toast(ar.error || 'User saved but Recipe access failed', 'error');
          } else if (recipeAccess?.enabled || recipeAccess) {
            await API.recipeRemoveAccess(uid, app.user);
          }
        }
      }

      Utils.hideModal();
      Utils.toast(user ? 'User updated' : 'User created', 'success');
      if (onSaved) onSaved();
    });
  },

  async deactivateUser(user, onDone) {
    if (!user) return;
    if (!confirm(`Deactivate "${user.full_name}" (${user.username})?\n\nThey will no longer be able to log in. You can restore or permanently delete them later.`)) return;
    const r = await API.deleteUser(user.id, this.app.user);
    if (!r.success) return Utils.toast(r.error || 'Deactivate failed', 'error');
    Utils.toast('User deactivated', 'success');
    if (onDone) onDone();
  },

  async permanentlyDeleteUser(user, onDone) {
    return this.archiveUser(user, onDone);
  }
};
window.UsersPage = UsersPage;

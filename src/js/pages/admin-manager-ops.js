// Admin — Manager Operations & Daily Tasks (professional control panel)
(function () {
  if (!window.AdminPage) return;

  const money = (n, c) => {
    const cur = c || 'R';
    return `${cur}${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  };
  const esc = (s) => (typeof Utils !== 'undefined' && Utils.escHtml)
    ? Utils.escHtml(s)
    : String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const statusLabel = (st) => {
    const s = String(st || '').toLowerCase();
    if (s === 'verified') return 'Verified';
    if (s === 'completed') return 'Completed';
    if (s === 'in_progress') return 'In progress';
    if (s === 'overdue') return 'Overdue';
    return 'Not started';
  };
  const statusClass = (st) => {
    const s = String(st || '').toLowerCase();
    if (s === 'verified' || s === 'completed') return 'tag-ok';
    if (s === 'in_progress') return 'tag-warn';
    if (s === 'overdue') return 'tag-danger';
    return '';
  };

  const AdminManagerOpsPage = {
    tab: 'dashboard',

    async render(el, admin) {
      this.admin = admin;
      this.app = admin.app;
      const origin = (typeof location !== 'undefined' && location.origin) ? location.origin : '';
      const staffLink = `${origin}/manager-ops/`;
      const tabs = [
        ['dashboard', 'Overview'],
        ['tasks', 'Daily Tasks'],
        ['access', 'Staff Access'],
        ['templates', 'Task Templates'],
        ['checklists', 'Checklists'],
        ['reports', 'Reports'],
        ['incidents', 'Incidents'],
        ['sales', 'Sales'],
        ['attendance', 'Attendance'],
        ['settings', 'Settings']
      ];
      el.innerHTML = `<div class="admin-section mo-admin">
        <div class="mo-admin-hero">
          <div>
            <div class="mo-admin-kicker">Restaurant operations</div>
            <h3 style="margin:4px 0 6px">Manager Operations &amp; Daily Tasks</h3>
            <p class="muted" style="margin:0;max-width:52ch">Daily duties, checklists, photo evidence, and owner reports — powered by live POS sales and Admin Sales Targets. Linked to Staff HR, Staff Portal, and Employee of the Month. Owners and managers sign in with the same Admin password.</p>
          </div>
          <div class="mo-admin-actions">
            <a class="btn btn-primary" href="/manager-ops/" target="_blank" rel="noopener">Open Manager App</a>
            <button type="button" class="btn btn-ghost" id="mo-copy-link">Copy staff link</button>
            <button type="button" class="btn btn-ghost" id="mo-gen-tasks">Generate today&apos;s tasks</button>
          </div>
        </div>

        <div class="mo-admin-link-card">
          <div>
            <strong>Staff link</strong>
            <p class="muted" style="margin:4px 0 0">Share this URL with people you approve under <strong>Staff Access</strong>. They sign in with their existing username and password — no separate account.</p>
          </div>
          <div class="mo-admin-link-row">
            <input class="form-input" id="mo-staff-link" readonly value="${esc(staffLink)}">
            <button type="button" class="btn btn-primary" id="mo-copy-link-2">Copy</button>
          </div>
        </div>

        <div class="form-tabs mo-admin-tabs" id="mo-tabs">${tabs.map(([id, label]) =>
          `<button type="button" class="form-tab ${this.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`
        ).join('')}</div>
        <div id="mo-content"><p class="muted">Loading…</p></div>
      </div>
      <style>
        .mo-admin-hero{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-start;margin-bottom:16px}
        .mo-admin-kicker{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#64748b)}
        .mo-admin-actions{display:flex;gap:8px;flex-wrap:wrap}
        .mo-admin-link-card{display:flex;flex-direction:column;gap:10px;padding:14px 16px;margin-bottom:16px;border:1px solid var(--border,#e2e8f0);border-radius:12px;background:linear-gradient(180deg,rgba(37,99,235,.06),transparent)}
        .mo-admin-link-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
        .mo-admin-link-row .form-input{flex:1;min-width:220px;font-family:ui-monospace,Consolas,monospace;font-size:13px}
        .mo-stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
        .mo-stat{padding:14px;border:1px solid var(--border,#e2e8f0);border-radius:12px;background:var(--bg-card,var(--bg,#fff))}
        .mo-stat .muted{font-size:12px;margin-bottom:4px}
        .mo-stat strong{font-size:1.25rem}
      </style>`;

      const copyLink = async () => {
        try {
          await navigator.clipboard.writeText(staffLink);
          Utils.toast('Staff link copied', 'success');
        } catch (_) {
          const inp = el.querySelector('#mo-staff-link');
          inp?.select?.();
          try { document.execCommand('copy'); Utils.toast('Staff link copied', 'success'); }
          catch (__) { Utils.toast(staffLink, 'info'); }
        }
      };
      el.querySelector('#mo-copy-link')?.addEventListener('click', copyLink);
      el.querySelector('#mo-copy-link-2')?.addEventListener('click', copyLink);
      el.querySelector('#mo-tabs')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab]');
        if (!btn) return;
        this.tab = btn.dataset.tab;
        this.render(el, admin);
      });
      el.querySelector('#mo-gen-tasks')?.addEventListener('click', async () => {
        const r = await API.moGenerateTasks({}, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Failed', 'error');
        Utils.toast(`Created ${r.data?.created || 0} tasks`, 'success');
        this.render(el, admin);
      });

      const content = el.querySelector('#mo-content');
      const map = {
        dashboard: () => this.renderDashboard(content),
        tasks: () => this.renderTasks(content),
        access: () => this.renderAccess(content),
        templates: () => this.renderTemplates(content),
        checklists: () => this.renderChecklists(content),
        reports: () => this.renderReports(content),
        incidents: () => this.renderIncidents(content),
        sales: () => this.renderSales(content),
        attendance: () => this.renderAttendance(content),
        settings: () => this.renderSettings(content)
      };
      await (map[this.tab] || map.dashboard)();
    },

    async renderDashboard(el) {
      const r = await API.moDashboard({});
      if (!r.success) {
        el.innerHTML = `<div class="card"><div class="card-body"><p class="error-msg">${esc(r.error || 'Unable to load dashboard')}</p>
          <p class="muted">If you see a SQL / syntax error, refresh after the latest deploy. Owners can still open the Manager App with their Admin password.</p></div></div>`;
        return;
      }
      const d = r.data || {};
      const s = d.sales || {};
      const t = d.tasks || {};
      el.innerHTML = `<div class="mo-stat-grid">
          <div class="mo-stat"><div class="muted">Sales today</div><strong>${money(s.sales, s.currency)}</strong></div>
          <div class="mo-stat"><div class="muted">Target</div><strong>${money(s.target, s.currency)}</strong></div>
          <div class="mo-stat"><div class="muted">Progress</div><strong>${s.progress || 0}%</strong></div>
          <div class="mo-stat"><div class="muted">Tasks done</div><strong>${t.completed || 0}/${t.total || 0}</strong></div>
          <div class="mo-stat"><div class="muted">Outstanding</div><strong>${d.outstanding || 0}</strong></div>
          <div class="mo-stat"><div class="muted">Incidents</div><strong>${(d.incidents || []).length}</strong></div>
        </div>
        <div class="card" style="margin-top:16px"><div class="card-body">
          <h4 style="margin-top:0">Today at a glance</h4>
          <p class="muted" style="margin:0">Primary duties: <strong>${d.primary_done ? 'Complete' : 'In progress'}</strong>
            · Report: <strong>${d.report ? 'Submitted' : 'Not yet submitted'}</strong>
            · Shop: <strong>${esc(d.shop_name || '—')}</strong></p>
        </div></div>`;
    },

    async renderTasks(el) {
      const [tasksRes, peopleRes, checkRes] = await Promise.all([
        API.moListTasks({ admin_view: true }, this.app.user),
        API.moListPeople(this.app.user),
        API.moChecklists()
      ]);
      if (!tasksRes.success) {
        el.innerHTML = `<p class="error-msg">${esc(tasksRes.error || 'Could not load tasks')}</p>`;
        return;
      }
      const rows = tasksRes.data || [];
      const people = peopleRes.success ? (peopleRes.data || []) : [];
      const checklists = checkRes.success ? (checkRes.data || []) : [];
      const peopleOpts = people.map((p) =>
        `<option value="${p.id}">${esc(p.full_name || p.username)} (${esc(p.role)})</option>`
      ).join('');
      el.innerHTML = `<div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
          <div><h4 style="margin:0">Daily tasks</h4>
            <p class="muted" style="margin:4px 0 0">${rows.length} task(s) — create and assign people + a responsible manager</p></div>
          <button type="button" class="btn btn-ghost" id="mo-refresh-tasks">Refresh</button>
        </div>

        <div class="mo-create-task" style="padding:12px;border:1px solid var(--border,#e2e8f0);border-radius:10px;margin-bottom:16px;background:rgba(37,99,235,.04)">
          <strong>Create &amp; assign a task</strong>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-top:10px">
            <input class="form-input" id="mo-new-title" placeholder="Task name (e.g. Opening Checklist)">
            <select class="form-input" id="mo-new-cat">
              <option value="opening">Opening</option><option value="sales">Sales</option>
              <option value="marketing">Marketing</option><option value="kitchen">Kitchen</option>
              <option value="customers">Customers</option><option value="stock">Stock</option>
              <option value="closing">Closing</option><option value="attendance">Attendance</option>
              <option value="general">General</option>
            </select>
            <select class="form-input" id="mo-new-assignee"><option value="">Assign to person…</option>${peopleOpts}</select>
            <select class="form-input" id="mo-new-manager"><option value="">Responsible manager…</option>${peopleOpts}</select>
            <select class="form-input" id="mo-new-check"><option value="">Checklist (optional)</option>
              ${checklists.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
          </div>
          <button type="button" class="btn btn-primary" id="mo-create-task" style="margin-top:10px">Create task</button>
        </div>

        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Task</th><th>Category</th><th>Assigned to</th><th>Manager</th><th>Due</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows.map((t) => `<tr data-id="${t.id}">
            <td><strong>${esc(t.title)}</strong>${t.is_primary ? ' <span class="muted">· primary</span>' : ''}</td>
            <td>${esc(t.category)}</td>
            <td>${esc(t.assigned_user_name || t.assigned_role || '—')}</td>
            <td>${esc(t.manager_user_name || '—')}</td>
            <td>${esc((t.due_at || '').slice(11, 16) || '—')}</td>
            <td><span class="tag ${statusClass(t.status)}">${statusLabel(t.status)}</span></td>
            <td><button type="button" class="btn btn-ghost btn-sm mo-reassign" data-id="${t.id}">Assign</button></td>
          </tr>`).join('') || '<tr><td colspan="7" class="muted">No tasks yet — create one above or Generate today\'s tasks</td></tr>'}
          </tbody></table></div>
      </div></div>`;
      el.querySelector('#mo-refresh-tasks')?.addEventListener('click', () => this.renderTasks(el));
      el.querySelector('#mo-create-task')?.addEventListener('click', async () => {
        const title = el.querySelector('#mo-new-title')?.value?.trim();
        if (!title) return Utils.toast('Enter a task name', 'error');
        const payload = {
          title,
          category: el.querySelector('#mo-new-cat')?.value,
          assigned_user_id: Number(el.querySelector('#mo-new-assignee')?.value) || null,
          manager_user_id: Number(el.querySelector('#mo-new-manager')?.value) || null,
          checklist_template_id: Number(el.querySelector('#mo-new-check')?.value) || null,
          is_primary: true
        };
        const out = await API.moCreateTask(payload, this.app.user);
        if (!out.success) return Utils.toast(out.error || 'Create failed', 'error');
        Utils.toast('Task created & assigned', 'success');
        this.renderTasks(el);
      });
      el.querySelectorAll('.mo-reassign').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.id);
          const row = btn.closest('tr');
          if (!row || row.nextElementSibling?.classList?.contains('mo-assign-row')) return;
          const tr = document.createElement('tr');
          tr.className = 'mo-assign-row';
          tr.innerHTML = `<td colspan="7">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 0">
              <span class="muted">Assign #${id}:</span>
              <select class="form-input mo-asg-u" style="min-width:160px"><option value="">Person…</option>${peopleOpts}</select>
              <select class="form-input mo-asg-m" style="min-width:160px"><option value="">Manager…</option>${peopleOpts}</select>
              <button type="button" class="btn btn-primary btn-sm mo-asg-save">Save</button>
              <button type="button" class="btn btn-ghost btn-sm mo-asg-cancel">Cancel</button>
            </div></td>`;
          row.after(tr);
          tr.querySelector('.mo-asg-cancel').onclick = () => tr.remove();
          tr.querySelector('.mo-asg-save').onclick = async () => {
            const out = await API.moAssignTask(id, {
              assigned_user_id: Number(tr.querySelector('.mo-asg-u').value) || null,
              manager_user_id: Number(tr.querySelector('.mo-asg-m').value) || null
            }, this.app.user);
            if (!out.success) return Utils.toast(out.error || 'Assign failed', 'error');
            Utils.toast('Assignment saved', 'success');
            this.renderTasks(el);
          };
        });
      });
    },

    async renderAccess(el) {
      el.innerHTML = `<p class="muted">Loading staff access…</p>`;
      const [accessRes, setRes] = await Promise.all([
        API.moListAccess(this.app.user),
        API.moGetSettings()
      ]);
      if (!accessRes.success) {
        el.innerHTML = `<div class="card"><div class="card-body">
          <p class="error-msg">${esc(accessRes.error || 'Could not load staff list')}</p>
          <p class="muted">Only owners and managers can manage who signs into Manager Operations.</p>
        </div></div>`;
        return;
      }
      const people = accessRes.data || [];
      const settings = setRes.success ? (setRes.data || {}) : {};
      const allowed = new Set((settings.allowed_user_ids || []).map(Number));
      el.innerHTML = `<div class="card"><div class="card-body">
        <h4 style="margin-top:0">Who can open Manager Operations</h4>
        <p class="muted">Owners and managers always have access with their <strong>same Admin / POS password</strong>. Tick other staff below to grant access, then save.</p>
        <div class="table-wrap" style="margin-top:12px"><table class="data-table">
          <thead><tr><th></th><th>Name</th><th>Username</th><th>Role</th><th>Access</th></tr></thead>
          <tbody>${people.map((p) => {
            const checked = p.always_allowed || allowed.has(Number(p.id)) || p.allowed;
            return `<tr>
              <td>${p.always_allowed
                ? '<input type="checkbox" checked disabled title="Always allowed">'
                : `<input type="checkbox" class="mo-access-cb" value="${p.id}" ${checked ? 'checked' : ''}>`}</td>
              <td><strong>${esc(p.full_name || '—')}</strong></td>
              <td class="mono">${esc(p.username)}</td>
              <td>${esc(p.role)}</td>
              <td>${p.always_allowed ? '<span class="tag tag-ok">Always (owner/manager)</span>' : (checked ? '<span class="tag tag-ok">Granted</span>' : '<span class="muted">No access</span>')}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="5" class="muted">No users found</td></tr>'}
          </tbody></table></div>
        <button type="button" class="btn btn-primary" id="mo-save-access" style="margin-top:14px">Save staff access</button>
      </div></div>`;
      el.querySelector('#mo-save-access')?.addEventListener('click', async () => {
        const ids = [...el.querySelectorAll('.mo-access-cb:checked')].map((cb) => Number(cb.value));
        const out = await API.moSaveSettings({ allowed_user_ids: ids }, this.app.user);
        if (!out.success) return Utils.toast(out.error || 'Save failed', 'error');
        Utils.toast('Staff access saved', 'success');
        this.renderAccess(el);
      });
    },

    async renderTemplates(el) {
      const r = await API.moTemplates();
      const rows = r.success ? (r.data || []) : [];
      el.innerHTML = `<div class="card"><div class="card-body">
        <h4 style="margin-top:0">Task templates</h4>
        <p class="muted">Templates drive daily task generation from operating hours.</p>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Name</th><th>Category</th><th>Role</th><th>Photo</th><th>Active</th></tr></thead>
          <tbody>${rows.map((t) => `<tr>
            <td>${esc(t.name)}</td><td>${esc(t.category)}</td><td>${esc(t.assigned_role)}</td>
            <td>${esc(t.photo_mode)}</td><td>${t.is_active ? 'Yes' : 'No'}</td>
          </tr>`).join('') || '<tr><td colspan="5" class="muted">No templates — generate tasks once to seed defaults</td></tr>'}
          </tbody></table></div>
      </div></div>`;
    },

    async renderChecklists(el) {
      const r = await API.moChecklists();
      const rows = r.success ? (r.data || []) : [];
      el.innerHTML = `<div class="card"><div class="card-body">
        <h4 style="margin-top:0">Checklists</h4>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Name</th><th>Category</th><th>Role</th><th>Items</th></tr></thead>
          <tbody>${rows.map((c) => `<tr>
            <td>${esc(c.name)}</td><td>${esc(c.category)}</td><td>${esc(c.assigned_role)}</td>
            <td>${(c.items || []).length}</td>
          </tr>`).join('') || '<tr><td colspan="4" class="muted">No checklists yet</td></tr>'}
          </tbody></table></div>
      </div></div>`;
    },

    async renderReports(el) {
      const r = await API.moListReports({});
      const rows = r.success ? (r.data || []) : [];
      el.innerHTML = `<div class="card"><div class="card-body">
        <h4 style="margin-top:0">Manager reports</h4>
        <p class="muted">Printable professional reports with sales targets, tasks, incidents, and attendance.</p>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Date</th><th>Submitted by</th><th>Sales</th><th>Tasks</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows.map((x) => `<tr>
            <td>${esc(x.work_date)}</td>
            <td>${esc(x.submitted_by_name || '—')}</td>
            <td>${money(x.sales_amount)}</td>
            <td>${x.tasks_completed || 0}/${x.tasks_total || 0}</td>
            <td>${esc(x.status)}</td>
            <td><button type="button" class="btn btn-primary btn-sm mo-print-report" data-id="${x.id}">Print PDF</button></td>
          </tr>`).join('') || '<tr><td colspan="6" class="muted">No reports yet</td></tr>'}
          </tbody></table></div>
      </div></div>`;
      el.querySelectorAll('.mo-print-report').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const out = await API.moReportPdf(Number(btn.dataset.id), this.app.user);
          if (!out.success) return Utils.toast(out.error || 'PDF failed', 'error');
          const d = out.data || {};
          if (!d.base64) return Utils.toast('No PDF data', 'error');
          const a = document.createElement('a');
          a.href = `data:application/pdf;base64,${d.base64}`;
          a.download = d.filename || 'manager-ops-report.pdf';
          a.click();
          Utils.toast('Report downloaded', 'success');
        });
      });
    },

    async renderIncidents(el) {
      const r = await API.moListIncidents({});
      const rows = r.success ? (r.data || []) : [];
      el.innerHTML = `<div class="card"><div class="card-body">
        <h4 style="margin-top:0">Reported problems</h4>
        <p class="muted">Sent from Manager Operations — review and resolve here. Linked to your Admin notifications.</p>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>When</th><th>Category</th><th>Priority</th><th>Reported by</th><th>Description</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows.map((i) => `<tr class="${i.status === 'open' ? 'mo-inc-open' : ''}">
            <td>${esc((i.created_at || i.work_date || '').slice(0, 16))}</td>
            <td><strong>${esc(i.category)}</strong></td>
            <td><span class="tag ${i.priority === 'urgent' || i.priority === 'high' ? 'tag-danger' : ''}">${esc(i.priority)}</span></td>
            <td>${esc(i.reported_by_name || '—')}</td>
            <td style="max-width:280px">${esc(i.description)}</td>
            <td>${esc(i.status)}</td>
            <td>${i.status === 'open'
              ? `<button type="button" class="btn btn-primary btn-sm mo-resolve-inc" data-id="${i.id}">Resolve</button>`
              : '<span class="muted">Done</span>'}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="muted">No incidents</td></tr>'}
          </tbody></table></div>
      </div></div>
      <style>.mo-inc-open td{background:rgba(239,68,68,.06)}</style>`;
      el.querySelectorAll('.mo-resolve-inc').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const notes = prompt('Resolution notes (optional):') || '';
          const out = await API.moResolveIncident(Number(btn.dataset.id), { notes, status: 'resolved' }, this.app.user);
          if (!out.success) return Utils.toast(out.error || 'Failed', 'error');
          Utils.toast('Incident resolved', 'success');
          this.renderIncidents(el);
        });
      });
      rows.filter((i) => i.status === 'open' && !i.owner_seen_at).forEach((i) => {
        API.moMarkIncidentSeen(i.id, this.app.user).catch(() => {});
      });
    },

    async renderSales(el) {
      const r = await API.moSales();
      const s = r.success ? (r.data || {}) : {};
      if (!r.success) {
        el.innerHTML = `<p class="error-msg">${esc(r.error || 'Could not load sales')}</p>`;
        return;
      }
      const products = s.products || [];
      el.innerHTML = `<div class="card"><div class="card-body">
        <h4 style="margin-top:0">Sales monitoring</h4>
        <p class="muted">Live from POS totals and <strong>Admin → Sales Targets</strong>${s.override_active ? ' (MO override active)' : ''}. Read-only here.</p>
        <div class="mo-stat-grid" style="margin-top:12px">
          <div class="mo-stat"><div class="muted">Daily target</div><strong>${money(s.target, s.currency)}</strong></div>
          <div class="mo-stat"><div class="muted">Sales today</div><strong>${money(s.sales, s.currency)}</strong></div>
          <div class="mo-stat"><div class="muted">Remaining</div><strong>${money(s.remaining, s.currency)}</strong></div>
          <div class="mo-stat"><div class="muted">Progress</div><strong>${s.progress || 0}%</strong></div>
          <div class="mo-stat"><div class="muted">Orders</div><strong>${s.order_count || 0}</strong></div>
        </div>
        <h4 style="margin:20px 0 8px">Product / item targets</h4>
        <p class="muted" style="margin-top:0">${s.product_targets_active ? 'Active product targets from Admin Sales Targets' : 'No product targets set in Admin Sales Targets'}</p>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Product</th><th>Target qty</th><th>Sold</th><th>Remaining</th><th>Target value</th><th>Sold value</th></tr></thead>
          <tbody>${products.map((p) => `<tr>
            <td>${esc(p.name || p.product_name || ('#' + p.product_id))}</td>
            <td>${p.target_qty || 0}</td>
            <td>${p.sold_qty || 0}</td>
            <td>${p.remaining_qty || 0}</td>
            <td>${money(p.target_value, s.currency)}</td>
            <td>${money(p.sold_value, s.currency)}</td>
          </tr>`).join('') || '<tr><td colspan="6" class="muted">Set item targets under Admin → Sales Targets</td></tr>'}
          </tbody></table></div>
      </div></div>`;
    },

    async renderAttendance(el) {
      const r = await API.moAttendance();
      const rows = r.success ? (r.data || []) : [];
      el.innerHTML = `<div class="card"><div class="card-body">
        <h4 style="margin-top:0">Staff attendance</h4>
        <p class="muted">Pulled live from Staff HR / Staff Portal attendance — same records as Admin Staff.</p>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>In</th><th>Out</th></tr></thead>
          <tbody>${rows.map((a) => `<tr>
            <td>${esc(a.name)}</td>
            <td>${esc(a.role || '—')}</td>
            <td>${esc(a.status)}${a.late ? ' (late)' : ''}</td>
            <td>${esc(a.clock_in || '—')}</td>
            <td>${esc(a.clock_out || '—')}</td>
          </tr>`).join('') || '<tr><td colspan="5" class="muted">No staff records</td></tr>'}
          </tbody></table></div>
      </div></div>`;
    },

    async renderSettings(el) {
      const r = await API.moGetSettings();
      const s = r.success ? (r.data || {}) : {};
      el.innerHTML = `<div class="card"><div class="card-body" style="max-width:520px">
        <h4 style="margin-top:0">Settings</h4>
        <label>Sales target override (optional — leave blank to use POS targets)</label>
        <input class="form-input" id="mo-target" type="number" value="${s.daily_sales_target_override != null ? s.daily_sales_target_override : ''}">
        <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" id="mo-auto" ${s.auto_generate_tasks !== 0 ? 'checked' : ''}> Auto-generate daily tasks from operating hours</label>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="mo-nrep" ${s.notify_owner_on_report !== 0 ? 'checked' : ''}> Notify owner on report</label>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="mo-nurg" ${s.notify_owner_on_urgent !== 0 ? 'checked' : ''}> Notify owner on urgent problems</label>
        <p class="muted" style="margin-top:14px">Staff who may open the Manager App are managed under the <strong>Staff Access</strong> tab.</p>
        <button class="btn btn-primary" id="mo-save-set" style="margin-top:8px">Save settings</button>
      </div></div>`;
      el.querySelector('#mo-save-set')?.addEventListener('click', async () => {
        const payload = {
          daily_sales_target_override: el.querySelector('#mo-target').value === '' ? null : Number(el.querySelector('#mo-target').value),
          auto_generate_tasks: el.querySelector('#mo-auto').checked,
          notify_owner_on_report: el.querySelector('#mo-nrep').checked,
          notify_owner_on_urgent: el.querySelector('#mo-nurg').checked
        };
        const out = await API.moSaveSettings(payload, this.app.user);
        if (!out.success) return Utils.toast(out.error, 'error');
        Utils.toast('Settings saved', 'success');
      });
    }
  };

  window.AdminManagerOpsPage = AdminManagerOpsPage;
  AdminPage.renderManagerOps = function (el) {
    return AdminManagerOpsPage.render(el, this);
  };
})();

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
    _cache: {},
    _cacheAt: {},
    _inflight: {},

    async cached(key, loader, ttlMs = 45000) {
      const now = Date.now();
      if (this._cache[key] != null && (now - (this._cacheAt[key] || 0)) < ttlMs) return this._cache[key];
      if (this._inflight[key]) return this._inflight[key];
      this._inflight[key] = Promise.resolve().then(loader).then((val) => {
        this._cache[key] = val;
        this._cacheAt[key] = Date.now();
        delete this._inflight[key];
        return val;
      }).catch((err) => {
        delete this._inflight[key];
        throw err;
      });
      return this._inflight[key];
    },

    bust(...keys) {
      for (const k of keys) {
        delete this._cache[k];
        delete this._cacheAt[k];
        delete this._inflight[k];
      }
    },

    prefetch() {
      // Warm common tabs in background so clicks feel instant
      const u = this.app?.user;
      this.cached('people', () => API.moListPeople(u), 60000).catch(() => {});
      this.cached('tasks', () => API.moListTasks({ admin_view: true }, u), 20000).catch(() => {});
      this.cached('checklists', () => API.moChecklists(), 30000).catch(() => {});
      this.cached('templates', () => API.moTemplates(), 30000).catch(() => {});
      this.cached('dashboard', () => API.moDashboard({}), 20000).catch(() => {});
    },

    content() {
      return this._root?.querySelector('#mo-content');
    },

    go(tab) {
      this.tab = tab;
      const tabsEl = this._root?.querySelector('#mo-tabs');
      tabsEl?.querySelectorAll('[data-tab]')?.forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === tab);
      });
      return this.showTab(tab);
    },

    async showTab(tab) {
      const content = this.content();
      if (!content) return;
      // Only flash Loading when we have no warm cache for this tab
      const warm = {
        dashboard: 'dashboard',
        assign: 'tasks',
        tasks: 'tasks',
        checklists: 'checklists',
        templates: 'templates',
        access: 'people'
      };
      const cacheKey = warm[tab];
      if (!cacheKey || this._cache[cacheKey] == null) {
        content.innerHTML = `<p class="muted" style="padding:8px 0">Loading…</p>`;
      }
      const map = {
        dashboard: () => this.renderDashboard(content),
        assign: () => this.renderAssign(content),
        tasks: () => this.renderTasks(content),
        access: () => this.renderAccess(content),
        templates: () => this.renderTemplates(content),
        checklists: () => this.renderChecklists(content),
        notifications: () => this.renderNotifications(content),
        reports: () => this.renderReports(content),
        incidents: () => this.renderIncidents(content),
        sales: () => this.renderSales(content),
        attendance: () => this.renderAttendance(content),
        settings: () => this.renderSettings(content)
      };
      await (map[tab] || map.dashboard)();
    },

    async render(el, admin) {
      this.admin = admin;
      this.app = admin.app;
      this._root = el;
      const origin = (typeof location !== 'undefined' && location.origin) ? location.origin : '';
      const staffLink = `${origin}/manager-ops/`;
      const tabs = [
        ['dashboard', 'Overview'],
        ['assign', 'Assign Staff'],
        ['tasks', 'Daily Tasks'],
        ['templates', 'Task Templates'],
        ['checklists', 'Checklists'],
        ['access', 'Who Can Login'],
        ['notifications', 'Notifications'],
        ['reports', 'Reports'],
        ['incidents', 'Incidents'],
        ['sales', 'Sales'],
        ['attendance', 'Attendance'],
        ['settings', 'Settings']
      ];

      // Fast path: shell already built — only swap tab content
      if (el.querySelector('.mo-admin') && el.querySelector('#mo-content')) {
        await this.go(this.tab);
        return;
      }

      el.innerHTML = `<div class="admin-section mo-admin">
        <div class="mo-admin-hero">
          <div>
            <div class="mo-admin-kicker">Restaurant operations</div>
            <h3 style="margin:4px 0 6px">Manager Operations &amp; Daily Tasks</h3>
            <p class="muted" style="margin:0;max-width:56ch">Use <strong>Assign Staff</strong> for workers. Edit your own lists under <strong>Checklists</strong>. Connected to POS, Sales Targets, Staff Portal, HR attendance, and reports.</p>
          </div>
          <div class="mo-admin-actions">
            <button type="button" class="btn btn-primary" id="mo-goto-assign">Assign Staff</button>
            <a class="btn btn-ghost" href="/manager-ops/" target="_blank" rel="noopener">Open Manager App</a>
            <button type="button" class="btn btn-ghost" id="mo-copy-link">Copy staff link</button>
            <button type="button" class="btn btn-ghost" id="mo-gen-tasks">Generate today&apos;s tasks</button>
          </div>
        </div>
        <div class="mo-admin-link-card">
          <div>
            <strong>Quick guide</strong>
            <ol class="muted" style="margin:8px 0 0;padding-left:18px;max-width:70ch">
              <li><strong>Generate today&apos;s tasks</strong> — creates today&apos;s duties</li>
              <li><strong>Assign Staff</strong> — click a worker, tick tasks, Save &amp; notify</li>
              <li><strong>Checklists</strong> — add your own name, category, and item lines</li>
            </ol>
          </div>
          <div class="mo-admin-link-row">
            <input class="form-input" id="mo-staff-link" readonly value="${esc(staffLink)}">
            <button type="button" class="btn btn-primary" id="mo-copy-link-2">Copy staff link</button>
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
        .mo-assign-layout{display:grid;grid-template-columns:minmax(200px,280px) 1fr;gap:16px;align-items:start}
        @media(max-width:800px){.mo-assign-layout{grid-template-columns:1fr}}
        .mo-staff-list{border:1px solid var(--border,#e2e8f0);border-radius:12px;overflow:hidden;background:var(--bg-card,var(--bg,#fff));max-height:70vh;overflow-y:auto}
        .mo-staff-list button{display:block;width:100%;text-align:left;padding:12px 14px;border:0;border-bottom:1px solid var(--border,#e2e8f0);background:transparent;cursor:pointer;font:inherit}
        .mo-staff-list button:last-child{border-bottom:0}
        .mo-staff-list button.active{background:rgba(37,99,235,.1);font-weight:700}
        .mo-staff-list .muted{font-size:12px}
        .mo-assign-panel{border:1px solid var(--border,#e2e8f0);border-radius:12px;padding:16px;background:var(--bg-card,var(--bg,#fff))}
        .mo-task-pick{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border,#e2e8f0)}
        .mo-task-pick:last-child{border-bottom:0}
        .mo-cl-editor{padding:14px;border:1px solid var(--border,#e2e8f0);border-radius:12px;margin:12px 0;background:rgba(16,185,129,.06)}
        .mo-cl-card{border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:12px;margin-bottom:10px}
      </style>`;

      const copyLink = async () => {
        try {
          await navigator.clipboard.writeText(staffLink);
          Utils.toast('Staff link copied', 'success');
        } catch (_) {
          el.querySelector('#mo-staff-link')?.select?.();
          try { document.execCommand('copy'); Utils.toast('Staff link copied', 'success'); }
          catch (__) { Utils.toast(staffLink, 'info'); }
        }
      };
      el.querySelector('#mo-copy-link')?.addEventListener('click', copyLink);
      el.querySelector('#mo-copy-link-2')?.addEventListener('click', copyLink);
      el.querySelector('#mo-goto-assign')?.addEventListener('click', () => this.go('assign'));
      el.querySelector('#mo-tabs')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab]');
        if (!btn) return;
        this.go(btn.dataset.tab);
      });
      el.querySelector('#mo-gen-tasks')?.addEventListener('click', async () => {
        const btn = el.querySelector('#mo-gen-tasks');
        if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
        try {
          const r = await API.moGenerateTasks({}, this.app.user);
          if (!r.success) return Utils.toast(r.error || 'Failed', 'error');
          const d = r.data || {};
          Utils.toast(d.message || `Created ${d.created || 0} tasks`, d.created ? 'success' : 'info');
          this.bust('tasks');
          await this.go('assign');
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = "Generate today's tasks"; }
        }
      });

      this.prefetch();
      await this.showTab(this.tab);
    },

    pickPhoto() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'environment';
        input.onchange = () => {
          const file = input.files && input.files[0];
          if (!file) return resolve(null);
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        };
        input.click();
      });
    },

    async renderDashboard(el) {
      const r = await this.cached('dashboard', () => API.moDashboard({}), 20000);
      if (!r.success) {
        el.innerHTML = `<div class="card"><div class="card-body"><p class="error-msg">${esc(r.error || 'Unable to load dashboard')}</p>
          <p class="muted">If you see a SQL / syntax error, refresh after the latest deploy. Owners can still open the Manager App with their Admin password.</p></div></div>`;
        return;
      }
      const d = r.data || {};
      const s = d.sales || {};
      const t = d.tasks || {};
      el.innerHTML = `<div class="mo-stat-grid">
          <div class="mo-stat"><div class="muted">Sales today (POS)</div><strong>${money(s.sales, s.currency)}</strong></div>
          <div class="mo-stat"><div class="muted">Target (Sales Targets)</div><strong>${money(s.target, s.currency)}</strong></div>
          <div class="mo-stat"><div class="muted">Progress</div><strong>${s.progress || 0}%</strong></div>
          <div class="mo-stat"><div class="muted">Tasks done</div><strong>${t.completed || 0}/${t.total || 0}</strong></div>
          <div class="mo-stat"><div class="muted">Outstanding</div><strong>${d.outstanding || 0}</strong></div>
          <div class="mo-stat"><div class="muted">Incidents</div><strong>${(d.incidents || []).length}</strong></div>
        </div>
        <div class="card" style="margin-top:16px"><div class="card-body">
          <h4 style="margin-top:0">What do you want to do?</h4>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <button type="button" class="btn btn-primary" id="mo-dash-assign">1. Assign tasks to staff</button>
            <button type="button" class="btn btn-ghost" id="mo-dash-check">2. Edit / add checklists</button>
            <button type="button" class="btn btn-ghost" id="mo-dash-tpl">3. Edit task templates</button>
            <button type="button" class="btn btn-ghost" id="mo-dash-login">4. Who can login to the app</button>
          </div>
          <p class="muted" style="margin:14px 0 0"><strong>Note:</strong> <em>Who Can Login</em> is only permission to open Manager Ops — it is not attendance.
            Attendance is under the Attendance tab (from Staff HR / Staff Portal).</p>
          <p class="muted" style="margin:8px 0 0">Primary duties: <strong>${d.primary_done ? 'Complete' : 'In progress'}</strong>
            · Report: <strong>${d.report ? 'Submitted' : 'Not yet submitted'}</strong>
            · Shop: <strong>${esc(d.shop_name || '—')}</strong></p>
        </div></div>`;
      el.querySelector('#mo-dash-assign')?.addEventListener('click', () => this.go('assign'));
      el.querySelector('#mo-dash-check')?.addEventListener('click', () => this.go('checklists'));
      el.querySelector('#mo-dash-tpl')?.addEventListener('click', () => this.go('templates'));
      el.querySelector('#mo-dash-login')?.addEventListener('click', () => this.go('access'));
    },

    async renderAssign(el) {
      this._assignUserId = this._assignUserId || null;
      const [tasksRes, peopleRes] = await Promise.all([
        this.cached('tasks', () => API.moListTasks({ admin_view: true }, this.app.user), 20000),
        this.cached('people', () => API.moListPeople(this.app.user), 60000)
      ]);
      if (!peopleRes.success) {
        el.innerHTML = `<p class="error-msg">${esc(peopleRes.error || 'Could not load staff')}</p>`;
        return;
      }
      const people = peopleRes.data || [];
      const tasks = tasksRes.success ? (tasksRes.data || []) : [];
      if (!this._assignUserId && people[0]) this._assignUserId = Number(people[0].id);
      const selected = people.find((p) => Number(p.id) === Number(this._assignUserId)) || people[0];
      const sid = selected ? Number(selected.id) : null;
      const theirs = tasks.filter((t) => Number(t.assigned_user_id) === sid);
      const unassigned = tasks.filter((t) => !t.assigned_user_id);
      const others = tasks.filter((t) => t.assigned_user_id && Number(t.assigned_user_id) !== sid);

      el.innerHTML = `<div class="card"><div class="card-body">
        <h4 style="margin-top:0">Assign Staff</h4>
        <p class="muted" style="margin-top:0">Click a person → tick tasks → <strong>Save &amp; notify</strong> (Manager Ops app + Staff Portal + WhatsApp).</p>
        ${!tasks.length ? `<p class="error-msg">No tasks for today yet. Click <strong>Generate today's tasks</strong> at the top first.</p>` : ''}
        <div class="mo-assign-layout" style="margin-top:14px">
          <div class="mo-staff-list" id="mo-staff-list">
            ${people.map((p) => {
              const n = tasks.filter((t) => Number(t.assigned_user_id) === Number(p.id)).length;
              const done = tasks.filter((t) => Number(t.assigned_user_id) === Number(p.id) && ['completed', 'verified'].includes(t.status)).length;
              return `<button type="button" class="${Number(p.id) === sid ? 'active' : ''}" data-uid="${p.id}">
                <div>${esc(p.full_name || p.username)}</div>
                <div class="muted">${esc(p.role)} · ${done}/${n} done</div>
              </button>`;
            }).join('') || '<p class="muted" style="padding:12px">No staff users found</p>'}
          </div>
          <div class="mo-assign-panel">
            ${selected ? `
              <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">
                <div>
                  <h4 style="margin:0">${esc(selected.full_name || selected.username)}</h4>
                  <p class="muted" style="margin:4px 0 0">${esc(selected.role)}${selected.linked_to_hr ? ' · linked to Staff HR' : ''}</p>
                </div>
                <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="mo-asg-wa" checked> Notify WhatsApp + portal</label>
              </div>
              <h5 style="margin:16px 0 6px">Already assigned</h5>
              ${theirs.length ? theirs.map((t) => `
                <div class="mo-task-pick">
                  <div style="flex:1"><strong>${esc(t.title)}</strong>
                    <div class="muted">${esc(t.category)} · <span class="tag ${statusClass(t.status)}">${statusLabel(t.status)}</span></div></div>
                  <button type="button" class="btn btn-ghost btn-sm mo-unassign" data-id="${t.id}">Remove</button>
                </div>`).join('') : '<p class="muted">None yet — tick tasks below</p>'}
              <h5 style="margin:18px 0 6px">Give them these tasks</h5>
              <div id="mo-pick-list">
                ${[...unassigned, ...others].map((t) => `
                  <label class="mo-task-pick">
                    <input type="checkbox" class="mo-pick-task" value="${t.id}">
                    <div style="flex:1"><strong>${esc(t.title)}</strong>
                      <div class="muted">${esc(t.category)}${t.assigned_user_name ? ` · currently: ${esc(t.assigned_user_name)}` : ' · unassigned'}</div></div>
                  </label>`).join('') || '<p class="muted">No other tasks available</p>'}
              </div>
              <button type="button" class="btn btn-primary" id="mo-assign-save" style="margin-top:14px">Save &amp; notify ${esc(selected.full_name || selected.username)}</button>
            ` : '<p class="muted">Select a staff member</p>'}
          </div>
        </div>
      </div></div>`;

      el.querySelectorAll('#mo-staff-list button[data-uid]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this._assignUserId = Number(btn.dataset.uid);
          this.renderAssign(el);
        });
      });
      el.querySelectorAll('.mo-unassign').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const out = await API.moAssignTask(Number(btn.dataset.id), {
            assigned_user_id: null,
            notify_whatsapp: false
          }, this.app.user);
          if (!out.success) { btn.disabled = false; return Utils.toast(out.error || 'Failed', 'error'); }
          this.bust('tasks');
          Utils.toast('Assignment removed', 'success');
          this.renderAssign(el);
        });
      });
      el.querySelector('#mo-assign-save')?.addEventListener('click', async () => {
        const ids = [...el.querySelectorAll('.mo-pick-task:checked')].map((cb) => Number(cb.value));
        if (!ids.length) return Utils.toast('Tick at least one task to assign', 'error');
        if (!sid) return;
        const saveBtn = el.querySelector('#mo-assign-save');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
        const out = await API.moAssignMany({
          task_ids: ids,
          assigned_user_id: sid,
          notify_whatsapp: !!el.querySelector('#mo-asg-wa')?.checked
        }, this.app.user);
        if (!out.success) {
          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = `Save & notify ${selected.full_name || selected.username}`; }
          return Utils.toast(out.error || 'Assign failed', 'error');
        }
        this.bust('tasks');
        Utils.toast(`Assigned ${out.data?.assigned || ids.length} task(s) — portal + WhatsApp notified`, 'success');
        this.renderAssign(el);
      });
    },

    async renderTasks(el) {
      const [tasksRes, peopleRes, checkRes] = await Promise.all([
        this.cached('tasks', () => API.moListTasks({ admin_view: true }, this.app.user), 20000),
        this.cached('people', () => API.moListPeople(this.app.user), 60000),
        this.cached('checklists', () => API.moChecklists(), 30000)
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
      const catHints = [...new Set([
        'opening', 'sales', 'marketing', 'kitchen', 'customers', 'stock', 'closing', 'attendance', 'general',
        ...checklists.map((c) => c.category).filter(Boolean)
      ])];
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
            <input class="form-input" id="mo-new-cat" list="mo-new-cat-list" placeholder="Category (type your own)" value="opening">
            <datalist id="mo-new-cat-list">${catHints.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
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
            <td style="white-space:nowrap">
              <button type="button" class="btn btn-ghost btn-sm mo-reassign" data-id="${t.id}">Assign</button>
              ${!['completed', 'verified'].includes(String(t.status || ''))
                ? `<button type="button" class="btn btn-primary btn-sm mo-admin-done" data-id="${t.id}" data-photo="${esc(t.photo_mode || 'none')}">Complete</button>`
                : ''}
            </td>
          </tr>`).join('') || '<tr><td colspan="7" class="muted">No tasks yet — create one above or Generate today\'s tasks</td></tr>'}
          </tbody></table></div>
      </div></div>`;
      el.querySelector('#mo-refresh-tasks')?.addEventListener('click', () => {
        this.bust('tasks');
        this.renderTasks(el);
      });
      el.querySelector('#mo-create-task')?.addEventListener('click', async () => {
        const title = el.querySelector('#mo-new-title')?.value?.trim();
        if (!title) return Utils.toast('Enter a task name', 'error');
        const btn = el.querySelector('#mo-create-task');
        if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
        const payload = {
          title,
          category: (el.querySelector('#mo-new-cat')?.value || '').trim() || 'general',
          assigned_user_id: Number(el.querySelector('#mo-new-assignee')?.value) || null,
          manager_user_id: Number(el.querySelector('#mo-new-manager')?.value) || null,
          checklist_template_id: Number(el.querySelector('#mo-new-check')?.value) || null,
          is_primary: true,
          notify_whatsapp: true
        };
        const out = await API.moCreateTask(payload, this.app.user);
        if (btn) { btn.disabled = false; btn.textContent = 'Create task'; }
        if (!out.success) return Utils.toast(out.error || 'Create failed', 'error');
        this.bust('tasks', 'dashboard');
        Utils.toast('Task created — staff notified (portal + WhatsApp if phone on file)', 'success');
        this.renderTasks(el);
      });
      el.querySelectorAll('.mo-reassign').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = Number(btn.dataset.id);
          const row = btn.closest('tr');
          if (!row || row.nextElementSibling?.classList?.contains('mo-assign-row')) return;
          const tr = document.createElement('tr');
          tr.className = 'mo-assign-row';
          tr.innerHTML = `<td colspan="7">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 0">
              <span class="muted">Assign to staff:</span>
              <select class="form-input mo-asg-u" style="min-width:180px"><option value="">Select person…</option>${peopleOpts}</select>
              <select class="form-input mo-asg-m" style="min-width:180px"><option value="">Responsible manager…</option>${peopleOpts}</select>
              <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" class="mo-asg-wa" checked> WhatsApp + portal</label>
              <button type="button" class="btn btn-primary btn-sm mo-asg-save">Save &amp; notify</button>
              <button type="button" class="btn btn-ghost btn-sm mo-asg-cancel">Cancel</button>
            </div></td>`;
          row.after(tr);
          tr.querySelector('.mo-asg-cancel').onclick = () => tr.remove();
          tr.querySelector('.mo-asg-save').onclick = async () => {
            const uid = Number(tr.querySelector('.mo-asg-u').value) || null;
            if (!uid) return Utils.toast('Select a person to assign', 'error');
            const out = await API.moAssignTask(id, {
              assigned_user_id: uid,
              manager_user_id: Number(tr.querySelector('.mo-asg-m').value) || null,
              notify_whatsapp: !!tr.querySelector('.mo-asg-wa')?.checked
            }, this.app.user);
            if (!out.success) return Utils.toast(out.error || 'Assign failed', 'error');
            Utils.toast('Assigned — appears in Manager Ops app + Staff Portal', 'success');
            this.renderTasks(el);
          };
        });
      });
      el.querySelectorAll('.mo-admin-done').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.id);
          const needPhoto = btn.dataset.photo === 'required';
          let photo = null;
          const ask = needPhoto || confirm('Take / attach a photo as evidence for this completion?');
          if (ask) {
            photo = await this.pickPhoto();
            if (needPhoto && !photo) return Utils.toast('Photo is required for this task', 'error');
          }
          const notes = prompt('Optional note for this completion:') || '';
          const out = await API.moAdminComplete(id, {
            photo_data_url: photo,
            notes,
            require_photo: needPhoto
          }, this.app.user);
          if (!out.success) return Utils.toast(out.error || 'Complete failed', 'error');
          Utils.toast('Marked complete', 'success');
          this.renderTasks(el);
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
        <h4 style="margin-top:0">Who can open the Manager Ops app</h4>
        <p class="muted">This is <strong>not attendance</strong> and not task assignment. Tick people who may sign into <code>/manager-ops/</code> with their Admin/POS password.
          Owners and managers always have access. To <strong>give someone a task</strong>, use the <strong>Assign Staff</strong> tab instead.</p>
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
      const [tplRes, peopleRes] = await Promise.all([
        this.cached('templates', () => API.moTemplates(), 30000),
        this.cached('people', () => API.moListPeople(this.app.user), 60000)
      ]);
      const rows = tplRes.success ? (tplRes.data || []) : [];
      const people = peopleRes.success ? (peopleRes.data || []) : [];
      const peopleOpts = people.map((p) =>
        `<option value="${p.id}">${esc(p.full_name || p.username)}</option>`
      ).join('');
      const cats = [...new Set(['opening', 'sales', 'marketing', 'kitchen', 'customers', 'stock', 'closing', 'attendance', 'general',
        ...rows.map((t) => t.category).filter(Boolean)])];
      el.innerHTML = `<div class="card"><div class="card-body">
        <h4 style="margin-top:0">Task templates</h4>
        <p class="muted">These drive <strong>Generate today's tasks</strong>. Set a default staff person and responsible manager per template.</p>

        <div style="padding:14px;border:1px solid var(--border,#e2e8f0);border-radius:12px;margin:14px 0;background:linear-gradient(180deg,rgba(37,99,235,.05),transparent)">
          <strong>Add template</strong>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px">
            <input class="form-input" id="mo-tpl-name" placeholder="Template name *">
            <input class="form-input" id="mo-tpl-cat" list="mo-tpl-cat-list" placeholder="Category (type your own)" value="opening">
            <datalist id="mo-tpl-cat-list">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
            <select class="form-input" id="mo-tpl-role">
              <option value="assistant_manager">Assistant manager</option>
              <option value="manager">Manager</option>
              <option value="supervisor">Supervisor</option>
              <option value="kitchen">Kitchen</option>
              <option value="cashier">Cashier</option>
              <option value="staff">Staff</option>
            </select>
            <select class="form-input" id="mo-tpl-photo">
              <option value="none">Photo: none</option>
              <option value="optional">Photo: optional</option>
              <option value="required">Photo: required</option>
            </select>
            <select class="form-input" id="mo-tpl-user"><option value="">Default assignee…</option>${peopleOpts}</select>
            <select class="form-input" id="mo-tpl-mgr"><option value="">Default manager…</option>${peopleOpts}</select>
          </div>
          <button type="button" class="btn btn-primary" id="mo-tpl-save" style="margin-top:10px">Save template</button>
        </div>

        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Name</th><th>Category</th><th>Role</th><th>Assignee</th><th>Manager</th><th>Photo</th><th>Active</th><th></th></tr></thead>
          <tbody>${rows.map((t) => `<tr>
            <td><strong>${esc(t.name)}</strong></td>
            <td>${esc(t.category)}</td>
            <td>${esc(t.assigned_role)}</td>
            <td>${esc(people.find((p) => Number(p.id) === Number(t.default_assigned_user_id))?.full_name || '—')}</td>
            <td>${esc(people.find((p) => Number(p.id) === Number(t.manager_user_id))?.full_name || '—')}</td>
            <td>${esc(t.photo_mode)}</td>
            <td>${t.is_active ? 'Yes' : 'No'}</td>
            <td><button type="button" class="btn btn-ghost btn-sm mo-tpl-edit" data-id="${t.id}">Edit</button></td>
          </tr>`).join('') || '<tr><td colspan="8" class="muted">No templates yet</td></tr>'}
          </tbody></table></div>
      </div></div>`;
      el.querySelector('#mo-tpl-save')?.addEventListener('click', async () => {
        const name = el.querySelector('#mo-tpl-name')?.value?.trim();
        if (!name) return Utils.toast('Enter a template name', 'error');
        const btn = el.querySelector('#mo-tpl-save');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
        const out = await API.moSaveTemplate({
          name,
          category: (el.querySelector('#mo-tpl-cat')?.value || '').trim() || 'general',
          assigned_role: el.querySelector('#mo-tpl-role')?.value,
          photo_mode: el.querySelector('#mo-tpl-photo')?.value,
          default_assigned_user_id: Number(el.querySelector('#mo-tpl-user')?.value) || null,
          manager_user_id: Number(el.querySelector('#mo-tpl-mgr')?.value) || null,
          is_primary: true,
          is_required: true,
          is_active: true
        }, this.app.user);
        if (btn) { btn.disabled = false; btn.textContent = 'Save template'; }
        if (!out.success) return Utils.toast(out.error || 'Save failed', 'error');
        this.bust('templates');
        Utils.toast('Template saved', 'success');
        this.renderTemplates(el);
      });
      el.querySelectorAll('.mo-tpl-edit').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const t = rows.find((x) => Number(x.id) === Number(btn.dataset.id));
          if (!t) return;
          const name = prompt('Template name', t.name);
          if (name == null || !String(name).trim()) return;
          const category = prompt('Category (type your own)', t.category || 'general');
          if (category == null) return;
          btn.disabled = true;
          const out = await API.moSaveTemplate({
            id: t.id,
            name: String(name).trim(),
            category: String(category).trim() || 'general',
            assigned_role: t.assigned_role,
            photo_mode: t.photo_mode,
            default_assigned_user_id: t.default_assigned_user_id,
            manager_user_id: t.manager_user_id,
            is_primary: !!t.is_primary,
            is_required: t.is_required !== 0,
            is_active: t.is_active !== 0,
            sort_order: t.sort_order,
            schedule_offset_minutes: t.schedule_offset_minutes,
            schedule_anchor: t.schedule_anchor
          }, this.app.user);
          btn.disabled = false;
          if (!out.success) return Utils.toast(out.error || 'Update failed', 'error');
          this.bust('templates');
          Utils.toast('Template updated', 'success');
          this.renderTemplates(el);
        });
      });
    },

    async renderChecklists(el) {
      const r = await this.cached('checklists', () => API.moChecklists(), 30000);
      const rows = r.success ? (r.data || []) : [];
      const editingId = this._editChecklistId || null;
      const editing = rows.find((c) => Number(c.id) === Number(editingId)) || null;
      const catHints = [...new Set([
        'opening', 'sales', 'marketing', 'kitchen', 'customers', 'stock', 'closing', 'attendance', 'general',
        ...rows.map((c) => c.category).filter(Boolean)
      ])];

      el.innerHTML = `<div class="card"><div class="card-body">
        <h4 style="margin-top:0">Checklists</h4>
        <p class="muted">Write your own name, your own category, and your item lines. They appear in the Manager Ops app when linked to a task.</p>

        <div class="mo-cl-editor" id="mo-cl-form">
          <strong id="mo-cl-form-title">${editing ? 'Edit checklist' : 'Add checklist'}</strong>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
            <div>
              <label class="muted">Checklist name *</label>
              <input class="form-input" id="mo-cl-name" placeholder="e.g. My Morning Open" value="${esc(editing?.name || '')}">
            </div>
            <div>
              <label class="muted">Category (type your own — e.g. opening, sales)</label>
              <input class="form-input" id="mo-cl-cat" list="mo-cl-cat-list" placeholder="Type any category you want"
                value="${esc(editing?.category || '')}">
              <datalist id="mo-cl-cat-list">
                ${catHints.map((c) => `<option value="${esc(c)}">`).join('')}
              </datalist>
            </div>
          </div>
          <label class="muted" style="display:block;margin-top:10px">Checklist items — one line each (headings / steps)</label>
          <textarea class="form-input" id="mo-cl-items" rows="8" placeholder="Shop opened on time&#10;Kitchen ready&#10;POS working&#10;Write any item you want…">${esc(
            editing ? (editing.items || []).map((it) => it.label || it).join('\n') : ''
          )}</textarea>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <button type="button" class="btn btn-primary" id="mo-cl-save">${editing ? 'Save changes' : 'Add checklist'}</button>
            ${editing ? '<button type="button" class="btn btn-ghost" id="mo-cl-cancel">Cancel edit</button>' : ''}
          </div>
        </div>

        <div id="mo-cl-list">
          ${rows.map((c) => `
            <div class="mo-cl-card" data-id="${c.id}">
              <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">
                <div>
                  <strong>${esc(c.name)}</strong>
                  <span class="muted"> · ${esc(c.category || 'general')} · ${(c.items || []).length} items</span>
                </div>
                <button type="button" class="btn btn-primary btn-sm mo-cl-edit" data-id="${c.id}">Edit items</button>
              </div>
              <ul style="margin:8px 0 0;padding-left:18px;color:var(--muted,#64748b);font-size:13px">
                ${(c.items || []).map((it) => `<li>${esc(it.label || it)}</li>`).join('') || '<li>No items</li>'}
              </ul>
            </div>`).join('') || '<p class="muted">No checklists yet — add one above</p>'}
        </div>
      </div></div>`;

      const fillEditor = (c) => {
        const titleEl = el.querySelector('#mo-cl-form-title');
        const nameEl = el.querySelector('#mo-cl-name');
        const catEl = el.querySelector('#mo-cl-cat');
        const itemsEl = el.querySelector('#mo-cl-items');
        const saveBtn = el.querySelector('#mo-cl-save');
        if (titleEl) titleEl.textContent = c ? 'Edit checklist' : 'Add checklist';
        if (nameEl) nameEl.value = c?.name || '';
        if (catEl) catEl.value = c?.category || '';
        if (itemsEl) itemsEl.value = c ? (c.items || []).map((it) => it.label || it).join('\n') : '';
        if (saveBtn) saveBtn.textContent = c ? 'Save changes' : 'Add checklist';
        let cancel = el.querySelector('#mo-cl-cancel');
        if (c && !cancel) {
          cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'btn btn-ghost';
          cancel.id = 'mo-cl-cancel';
          cancel.textContent = 'Cancel edit';
          saveBtn?.parentElement?.appendChild(cancel);
          cancel.addEventListener('click', () => {
            this._editChecklistId = null;
            fillEditor(null);
          });
        } else if (!c && cancel) {
          cancel.remove();
        } else if (cancel) {
          cancel.onclick = () => {
            this._editChecklistId = null;
            fillEditor(null);
          };
        }
        el.querySelector('#mo-cl-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        nameEl?.focus();
      };

      const saveBtn = el.querySelector('#mo-cl-save');
      saveBtn?.addEventListener('click', async () => {
        const name = el.querySelector('#mo-cl-name')?.value?.trim();
        const category = el.querySelector('#mo-cl-cat')?.value?.trim() || 'general';
        const items = String(el.querySelector('#mo-cl-items')?.value || '')
          .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (!name) return Utils.toast('Enter a checklist name', 'error');
        if (!items.length) return Utils.toast('Add at least one item line', 'error');
        const editId = this._editChecklistId;
        const prev = editId ? rows.find((c) => Number(c.id) === Number(editId)) : null;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        const payload = {
          id: prev ? prev.id : undefined,
          name,
          category,
          assigned_role: prev?.assigned_role || 'assistant_manager',
          code: prev?.code || null,
          items,
          is_active: true,
          sort_order: prev?.sort_order || 0
        };
        const out = await API.moSaveChecklist(payload, this.app.user);
        saveBtn.disabled = false;
        saveBtn.textContent = prev ? 'Save changes' : 'Add checklist';
        if (!out.success) return Utils.toast(out.error || 'Save failed', 'error');
        this._editChecklistId = null;
        this.bust('checklists');
        Utils.toast(prev ? 'Checklist updated' : 'Checklist added', 'success');
        this.renderChecklists(el);
      });

      el.querySelector('#mo-cl-cancel')?.addEventListener('click', () => {
        this._editChecklistId = null;
        fillEditor(null);
      });

      el.querySelectorAll('.mo-cl-edit').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = Number(btn.dataset.id);
          const c = rows.find((x) => Number(x.id) === id);
          if (!c) return;
          this._editChecklistId = id;
          // Instant — no network round-trip, just fill the editor
          fillEditor(c);
        });
      });
    },

    async renderNotifications(el) {
      const r = await API.moListNotifications({}, this.app.user);
      const rows = r.success ? (r.data || []) : [];
      el.innerHTML = `<div class="card"><div class="card-body">
        <h4 style="margin-top:0">Task notifications</h4>
        <p class="muted">Log of portal, in-app, and WhatsApp notifications sent when tasks are assigned.</p>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>When</th><th>Channel</th><th>Task</th><th>User</th><th>Status</th><th>Message</th></tr></thead>
          <tbody>${rows.map((n) => `<tr>
            <td>${esc((n.created_at || '').slice(0, 16))}</td>
            <td><span class="tag">${esc(n.channel)}</span></td>
            <td>#${n.task_id || '—'}</td>
            <td>${n.user_id || '—'}</td>
            <td>${esc(n.status)}</td>
            <td style="max-width:280px">${esc(n.message || n.title || '')}</td>
          </tr>`).join('') || '<tr><td colspan="6" class="muted">No notifications yet — assign a task to staff to see entries here</td></tr>'}
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

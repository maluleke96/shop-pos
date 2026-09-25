// Admin — Manager Operations & Daily Tasks
(function () {
  if (!window.AdminPage) return;

  const money = (n, c) => {
    const cur = c || 'R';
    return `${cur}${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  };

  const AdminManagerOpsPage = {
    tab: 'dashboard',

    async render(el, admin) {
      this.admin = admin;
      this.app = admin.app;
      const origin = (typeof location !== 'undefined' && location.origin) ? location.origin : '';
      const staffLink = `${origin}/manager-ops/`;
      const tabs = [
        ['dashboard', 'Manager Dashboard'],
        ['tasks', 'Daily Tasks'],
        ['templates', 'Task Templates'],
        ['checklists', 'Checklists'],
        ['reports', 'Manager Reports'],
        ['incidents', 'Incidents & Problems'],
        ['evidence', 'Photo Evidence'],
        ['sales', 'Sales Monitoring'],
        ['attendance', 'Staff Assignments'],
        ['notifications', 'Notifications'],
        ['settings', 'Settings']
      ];
      el.innerHTML = `<div class="admin-section">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px">
          <div>
            <h3>Manager Operations & Daily Tasks</h3>
            <p class="muted">Daily duties, checklists, evidence, sales progress (from POS), and owner reports.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a class="btn btn-primary" href="/manager-ops/" target="_blank" rel="noopener">Open Mobile App</a>
            <button type="button" class="btn btn-ghost" id="mo-copy-link">Copy staff link</button>
            <button type="button" class="btn btn-ghost" id="mo-gen-tasks">Generate today's tasks</button>
          </div>
        </div>
        <div class="card" style="margin-bottom:14px;border:1px solid var(--border);background:var(--bg-secondary,#f8fafc)">
          <div class="card-body" style="padding:12px 14px">
            <strong>Staff access link</strong>
            <p class="muted" style="margin:6px 0 8px">Create a manager / supervisor / assistant manager in <strong>Users</strong> (or Cashiers &amp; Managers), then send them this link. They sign in with that username and password — no separate registration form.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <input class="form-input" id="mo-staff-link" readonly value="${Utils.escHtml(staffLink)}" style="flex:1;min-width:220px;font-family:ui-monospace,monospace;font-size:13px">
              <button type="button" class="btn btn-primary" id="mo-copy-link-2">Copy link</button>
              <a class="btn btn-ghost" href="/manager-ops/" target="_blank" rel="noopener">Open</a>
            </div>
          </div>
        </div>
        <div class="form-tabs" id="mo-tabs">${tabs.map(([id, label]) =>
          `<button type="button" class="form-tab ${this.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
        <div id="mo-content"><p class="muted">Loading…</p></div>
      </div>`;
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
        templates: () => this.renderTemplates(content),
        checklists: () => this.renderChecklists(content),
        reports: () => this.renderReports(content),
        incidents: () => this.renderIncidents(content),
        evidence: () => this.renderEvidence(content),
        sales: () => this.renderSales(content),
        attendance: () => this.renderAttendance(content),
        notifications: () => this.renderNotifications(content),
        settings: () => this.renderSettings(content)
      };
      await (map[this.tab] || map.dashboard)();
    },

    async renderDashboard(el) {
      const r = await API.moDashboard({});
      if (!r.success) {
        el.innerHTML = `<p class="muted">${r.error || 'Unable to load dashboard'}</p>`;
        return;
      }
      const d = r.data || {};
      const s = d.sales || {};
      const t = d.tasks || {};
      const by = t.by_category || {};
      el.innerHTML = `
        <div class="card"><div class="card-body">
          <h4>Today's Shop Report — ${d.work_date || ''}</h4>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:12px">
            <div><div class="muted">Sales</div><strong>${money(s.sales, s.currency)} / ${money(s.target, s.currency)}</strong><div class="muted">${s.progress || 0}%</div></div>
            <div><div class="muted">Tasks</div><strong>${t.completed || 0}/${t.total || 0}</strong></div>
            <div><div class="muted">Overdue</div><strong>${t.overdue || 0}</strong></div>
            <div><div class="muted">Problems</div><strong>${d.incidents?.total || 0}</strong></div>
            <div><div class="muted">Complaints</div><strong>${d.incidents?.complaints || 0}</strong></div>
            <div><div class="muted">Photos</div><strong>${d.photos || 0}</strong></div>
            <div><div class="muted">Outstanding</div><strong>${d.outstanding || 0}</strong></div>
          </div>
          <div style="margin-top:16px;display:flex;flex-wrap:wrap;gap:8px">
            ${Object.entries(by).map(([k, v]) => `<span class="badge">${k}: ${v.completed}/${v.total}</span>`).join('') || '<span class="muted">No tasks yet</span>'}
          </div>
          ${d.report ? `<p style="margin-top:12px">Latest report submitted ${d.report.submitted_at || ''} by ${d.report.submitted_by_name || '—'}</p>` : '<p class="muted" style="margin-top:12px">No daily report submitted yet.</p>'}
        </div></div>`;
    },

    async renderTasks(el) {
      const r = await API.moListTasks({ admin_view: true }, this.app.user);
      if (!r.success) { el.innerHTML = `<p class="muted">${r.error}</p>`; return; }
      const rows = r.data || [];
      el.innerHTML = `<div class="card"><div class="card-body">
        <table class="data-table"><thead><tr><th>Task</th><th>Role</th><th>Status</th><th>Due</th><th></th></tr></thead>
        <tbody>${rows.map((t) => `<tr>
          <td>${Utils.escapeHtml?.(t.title) || t.title}${t.overdue ? ' <span style="color:#b91c1c">⚠️ Overdue</span>' : ''}</td>
          <td>${t.assigned_role || '—'}</td>
          <td>${t.status}</td>
          <td>${t.due_at || '—'}</td>
          <td>${t.status === 'completed' && t.verification_required
            ? `<button class="btn btn-sm btn-primary" data-verify="${t.id}">Verify</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">No tasks</td></tr>'}</tbody></table>
      </div></div>`;
      el.querySelectorAll('[data-verify]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const res = await API.moVerifyTask(Number(btn.dataset.verify), {}, this.app.user);
          if (!res.success) return Utils.toast(res.error, 'error');
          Utils.toast('Verified', 'success');
          this.renderTasks(el);
        });
      });
    },

    async renderTemplates(el) {
      const r = await API.moTemplates();
      const rows = r.success ? (r.data || []) : [];
      el.innerHTML = `<div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;margin-bottom:12px">
          <h4>Task Templates</h4>
          <button class="btn btn-primary btn-sm" id="mo-add-tpl">Add template</button>
        </div>
        <table class="data-table"><thead><tr><th>Name</th><th>Role</th><th>Photo</th><th>Schedule</th><th>Active</th></tr></thead>
        <tbody>${rows.map((t) => `<tr>
          <td>${t.name}<div class="muted">${t.category}</div></td>
          <td>${t.assigned_role}</td>
          <td>${t.photo_mode}</td>
          <td>${t.schedule_anchor || 'open'} ${t.schedule_offset_minutes != null ? `(${t.schedule_offset_minutes}m)` : ''}</td>
          <td>${t.is_active ? 'Yes' : 'No'}</td>
        </tr>`).join('')}</tbody></table>
      </div></div>`;
      el.querySelector('#mo-add-tpl')?.addEventListener('click', async () => {
        const name = prompt('Template name');
        if (!name) return;
        const role = prompt('Assigned role (assistant_manager / kitchen / manager)', 'assistant_manager') || 'assistant_manager';
        const res = await API.moSaveTemplate({ name, assigned_role: role, category: 'general', photo_mode: 'optional' }, this.app.user);
        if (!res.success) return Utils.toast(res.error, 'error');
        this.renderTemplates(el);
      });
    },

    async renderChecklists(el) {
      const r = await API.moChecklists();
      const rows = r.success ? (r.data || []) : [];
      el.innerHTML = `<div class="card"><div class="card-body">
        ${rows.map((c) => `<div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border)">
          <strong>${c.name}</strong> <span class="muted">(${c.assigned_role})</span>
          <ul>${(c.items || []).map((i) => `<li>${i.label}${i.is_required ? '' : ' (optional)'}</li>`).join('')}</ul>
        </div>`).join('') || '<p class="muted">No checklists</p>'}
      </div></div>`;
    },

    async renderReports(el) {
      const r = await API.moListReports({});
      const rows = r.success ? (r.data || []) : [];
      el.innerHTML = `<div class="card"><div class="card-body" id="mo-reports-list">
        ${rows.map((rep) => `<div class="card" style="margin-bottom:10px"><div class="card-body">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <div><strong>${rep.work_date}</strong> — ${money(rep.sales_amount)} / ${money(rep.sales_target)}
              <div class="muted">Tasks ${rep.tasks_completed}/${rep.tasks_total} · by ${rep.submitted_by_name || '—'}</div></div>
            <button class="btn btn-sm btn-ghost" data-report="${rep.id}">Open</button>
          </div>
        </div></div>`).join('') || '<p class="muted">No reports yet</p>'}
      </div></div>
      <div id="mo-report-detail"></div>`;
      el.querySelectorAll('[data-report]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const res = await API.moGetReport(Number(btn.dataset.report), this.app.user);
          if (!res.success) return Utils.toast(res.error, 'error');
          const rep = res.data;
          const detail = el.querySelector('#mo-report-detail');
          detail.innerHTML = `<div class="card"><div class="card-body">
            <h4>Daily Manager Report — ${rep.work_date}</h4>
            <pre style="white-space:pre-wrap;font-family:inherit">${Utils.escapeHtml?.(JSON.stringify(rep.report || rep, null, 2)) || JSON.stringify(rep.report || rep, null, 2)}</pre>
            <div style="margin-top:12px">
              <label>Owner comment</label>
              <textarea id="mo-owner-msg" class="form-input" rows="3" placeholder="Please check the chicken stock tomorrow morning."></textarea>
              <button class="btn btn-primary" id="mo-send-owner" style="margin-top:8px">Send to manager</button>
            </div>
            <div style="margin-top:12px">${(rep.messages || []).map((m) => `<div class="muted">${m.created_at}: ${m.message}</div>`).join('')}</div>
          </div></div>`;
          detail.querySelector('#mo-send-owner')?.addEventListener('click', async () => {
            const msg = detail.querySelector('#mo-owner-msg')?.value;
            const out = await API.moOwnerRespond(rep.id, msg, this.app.user);
            if (!out.success) return Utils.toast(out.error, 'error');
            Utils.toast('Message sent', 'success');
            btn.click();
          });
        });
      });
    },

    async renderIncidents(el) {
      const r = await API.moListIncidents({});
      const rows = r.success ? (r.data || []) : [];
      el.innerHTML = `<div class="card"><div class="card-body">
        <table class="data-table"><thead><tr><th>Date</th><th>Category</th><th>Priority</th><th>Description</th><th>Owner</th></tr></thead>
        <tbody>${rows.map((i) => `<tr>
          <td>${i.work_date}</td><td>${i.category}</td><td>${i.priority}</td>
          <td>${i.description}</td><td>${i.requires_owner ? 'YES' : 'No'}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">No incidents</td></tr>'}</tbody></table>
      </div></div>`;
    },

    async renderEvidence(el) {
      const tasks = await API.moListTasks({ admin_view: true }, this.app.user);
      const withEv = (tasks.success ? tasks.data : []).filter((t) => (t.evidence || []).length);
      el.innerHTML = `<div class="card"><div class="card-body">
        <p class="muted">Evidence is stored securely (shop/task/user/date). Open a photo only after authentication — no public URLs.</p>
        ${withEv.map((t) => `<div style="margin-bottom:12px"><strong>${t.title}</strong>
          ${(t.evidence || []).map((e) => `<button class="btn btn-sm btn-ghost" data-ev="${e.id}">View #${e.id}</button>`).join('')}
        </div>`).join('') || '<p class="muted">No evidence today</p>'}
        <div id="mo-ev-view"></div>
      </div></div>`;
      el.querySelectorAll('[data-ev]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const res = await API.moEvidence(Number(btn.dataset.ev), this.app.user);
          if (!res.success) return Utils.toast(res.error, 'error');
          const box = el.querySelector('#mo-ev-view');
          box.innerHTML = res.data?.data_url
            ? `<img src="${res.data.data_url}" alt="Evidence" style="max-width:100%;max-height:360px;border-radius:8px">`
            : '<p class="muted">Unable to load image</p>';
        });
      });
    },

    async renderSales(el) {
      const r = await API.moSales(null);
      const s = r.success ? r.data : {};
      el.innerHTML = `<div class="card"><div class="card-body">
        <h4>Sales Monitoring (live from POS)</h4>
        <p class="muted">Read-only. Figures cannot be edited from Manager Operations.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:12px">
          <div><div class="muted">Target</div><strong>${money(s.target, s.currency)}</strong></div>
          <div><div class="muted">Sales</div><strong>${money(s.sales, s.currency)}</strong></div>
          <div><div class="muted">Remaining</div><strong>${money(s.remaining, s.currency)}</strong></div>
          <div><div class="muted">Progress</div><strong>${s.progress || 0}%</strong></div>
          <div><div class="muted">Orders</div><strong>${s.order_count || 0}</strong></div>
        </div>
      </div></div>`;
    },

    async renderAttendance(el) {
      const r = await API.moAttendance();
      const rows = r.success ? (r.data || []) : [];
      el.innerHTML = `<div class="card"><div class="card-body">
        <p class="muted">From existing staff attendance — no separate employee database.</p>
        <table class="data-table"><thead><tr><th>Name</th><th>Status</th><th>In</th><th>Out</th></tr></thead>
        <tbody>${rows.map((a) => `<tr><td>${a.name}</td><td>${a.status}${a.late ? ' (late)' : ''}</td><td>${a.clock_in || '—'}</td><td>${a.clock_out || '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No staff records</td></tr>'}</tbody></table>
      </div></div>`;
    },

    async renderNotifications(el) {
      el.innerHTML = `<div class="card"><div class="card-body">
        <p>Uses the existing notification hub:</p>
        <ul>
          <li>Manager: tasks remaining</li>
          <li>Owner: daily report submitted</li>
          <li>Owner: urgent problem reported</li>
          <li>Manager: owner message</li>
        </ul>
        <p class="muted">Configure delivery channels in Communication Center / notification settings.</p>
      </div></div>`;
    },

    async renderSettings(el) {
      const r = await API.moGetSettings();
      const s = r.success ? (r.data || {}) : {};
      el.innerHTML = `<div class="card"><div class="card-body" style="max-width:480px">
        <label>Sales target override (optional — leave blank to use POS targets)</label>
        <input class="form-input" id="mo-target" type="number" value="${s.daily_sales_target_override != null ? s.daily_sales_target_override : ''}">
        <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" id="mo-auto" ${s.auto_generate_tasks !== 0 ? 'checked' : ''}> Auto-generate daily tasks from operating hours</label>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="mo-nrep" ${s.notify_owner_on_report !== 0 ? 'checked' : ''}> Notify owner on report</label>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="mo-nurg" ${s.notify_owner_on_urgent !== 0 ? 'checked' : ''}> Notify owner on urgent problems</label>
        <button class="btn btn-primary" id="mo-save-set" style="margin-top:16px">Save settings</button>
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

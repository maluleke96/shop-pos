// Admin — Operations & Compliance
(function () {
  if (!window.AdminPage) return;

  const RULE_CATEGORIES = [
    'General Policy', 'Health & Safety', 'Food Safety & Hygiene', 'Cash Handling',
    'Customer Service', 'Dress Code & Appearance', 'Opening Procedures', 'Closing Procedures',
    'Stock & Inventory', 'POS Operations', 'HR & Conduct', 'Disciplinary',
    'Emergency Procedures', 'Security', 'Cleaning & Maintenance'
  ];

  async function pdfAction(getBuf, filename, mode) {
    const r = await getBuf();
    if (!r.success) return Utils.toast(r.error || 'PDF failed', 'error');
    if (mode === 'print') await API.openPdf(r.data, filename);
    else await API.saveFile(filename, [{ name: 'PDF', extensions: ['pdf'] }], r.data);
  }

  const origRenderSection = AdminPage.renderSection.bind(AdminPage);
  AdminPage.renderSection = async function (el) {
    if (this.section === 'opscompliance') return AdminOpsPage.render(el, this);
    AdminPage.toggleOpsComplianceLayout?.(false);
    return origRenderSection(el);
  };

  const AdminOpsPage = {
    async render(el, admin) {
      this.admin = admin;
      this.app = admin.app;
      this.tab = this.tab || 'rules';
      AdminPage.toggleOpsComplianceLayout?.(true);
      const tabs = [
        ['rules', 'Company Rules'],
        ['opening', 'Morning Opening Routine'],
        ['closing', 'Closing Routine']
      ];
      el.innerHTML = `<div class="admin-section admin-ops-only-page"><div style="margin-bottom:12px">
        <button type="button" class="btn btn-ghost btn-sm" id="ops-back-admin">← Back to Admin</button></div>
        <h3>Operations & Compliance</h3>
        <p class="muted">Company rules, morning opening and closing checklists with signed PDFs.</p>
        <div class="card" style="margin:12px 0"><div class="card-body" id="ops-signature-panel"><p class="muted">Loading signature…</p></div></div>
        <div class="form-tabs" id="ops-main-tabs">${tabs.map(([id, label]) =>
          `<button type="button" class="form-tab ${this.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
        <div id="ops-main-content"><p class="muted">Loading…</p></div></div>`;
      document.getElementById('ops-back-admin')?.addEventListener('click', () => {
        admin.section = 'overview';
        AdminPage.toggleOpsComplianceLayout?.(false);
        document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.section === 'overview'));
        AdminPage.renderSection(document.getElementById('admin-content'));
      });
      el.querySelector('#ops-main-tabs').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab]');
        if (!btn) return;
        this.tab = btn.dataset.tab;
        this.render(el, admin);
      });
      await this.renderSignaturePanel(document.getElementById('ops-signature-panel'));
      const content = document.getElementById('ops-main-content');
      const renderers = {
        rules: () => this.renderRules(content),
        opening: () => this.renderChecklist(content, 'opening'),
        closing: () => this.renderChecklist(content, 'closing')
      };
      await (renderers[this.tab] || renderers.rules)();
    },

    async renderSignaturePanel(el) {
      const sigRes = await API.getAdminSignature();
      const sigPath = sigRes.data?.admin_signature_path || this.admin.settings?.admin_signature_path;
      const isOwner = this.app.user?.role === 'owner';
      el.innerHTML = `<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <div><strong>Admin Signature</strong><br><small class="muted">Embedded on rules, checklist & compliance PDFs</small></div>
        ${sigPath ? `<img data-image-path="${String(sigPath).replace(/"/g, '')}" alt="Admin signature" style="max-height:48px;border:1px solid var(--border);padding:4px;border-radius:4px">` : '<span class="muted">No signature uploaded</span>'}
        ${isOwner ? `<button class="btn btn-ghost btn-sm" id="ops-upload-sig">Upload Signature</button>
          ${sigPath ? '<button class="btn btn-ghost btn-sm" id="ops-clear-sig">Remove</button>' : ''}` : ''}
      </div>`;
      if (sigPath) Utils.hydrateImages(el);
      if (!isOwner) return;
      document.getElementById('ops-upload-sig')?.addEventListener('click', async () => {
        const r = await API.selectImage('admin-signature');
        if (!r.success) return;
        await API.saveAdminSignature(r.path, this.app.user);
        await API.saveSettings({ admin_signature_path: r.path }, this.app.user);
        Utils.toast('Admin signature saved', 'success');
        this.render(document.getElementById('admin-content'), this.admin);
      });
      document.getElementById('ops-clear-sig')?.addEventListener('click', async () => {
        if (!confirm('Remove admin signature?')) return;
        await API.saveAdminSignature(null, this.app.user);
        await API.saveSettings({ admin_signature_path: null }, this.app.user);
        Utils.toast('Signature removed', 'success');
        this.render(document.getElementById('admin-content'), this.admin);
      });
    },

    async renderRules(el) {
      this._ruleSearch = this._ruleSearch || '';
      this._ruleCat = this._ruleCat || '';
      const res = await API.getCompanyRules({ search: this._ruleSearch || undefined, category: this._ruleCat || undefined });
      const rules = res.data || [];
      el.innerHTML = `<div style="margin:12px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-primary" id="ops-new-rule">+ New Rule</button>
        <button class="btn btn-ghost" id="ops-all-rules-pdf">Export PDF</button>
        <button class="btn btn-ghost" id="ops-all-rules-print">Print</button>
        <input id="ops-rule-search" placeholder="Search rules…" value="${this._ruleSearch}" style="min-width:160px">
        <select id="ops-rule-cat"><option value="">All categories</option>
          ${RULE_CATEGORIES.map(c => `<option value="${c}" ${this._ruleCat === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Number</th><th>Title</th><th>Category</th><th>Effective</th><th>Version</th><th>Status</th><th></th></tr></thead>
        <tbody>${rules.map(r => `<tr>
          <td>${r.rule_number}</td><td>${r.title}</td><td>${r.category || '—'}</td>
          <td>${r.effective_date || '—'}</td><td>v${r.version}</td><td>${r.status}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-ghost ops-rule-view" data-id="${r.id}">View</button>
            <button class="btn btn-sm btn-ghost ops-rule-history" data-id="${r.id}">History</button>
            <button class="btn btn-sm btn-ghost ops-rule-pdf" data-id="${r.id}">PDF</button>
            <button class="btn btn-sm btn-ghost ops-rule-print" data-id="${r.id}">Print</button>
            <button class="btn btn-sm btn-danger ops-rule-del" data-id="${r.id}">Delete</button>
          </td></tr>`).join('') || '<tr><td colspan="7" class="muted">No rules yet</td></tr>'}
        </tbody></table></div>`;

      document.getElementById('ops-new-rule').addEventListener('click', () => this.showRuleForm());
      document.getElementById('ops-all-rules-pdf').addEventListener('click', () =>
        pdfAction(() => API.getAllCompanyRulesPdf(), 'company-rules.pdf', 'save'));
      document.getElementById('ops-all-rules-print').addEventListener('click', () =>
        pdfAction(() => API.getAllCompanyRulesPdf(), 'company-rules.pdf', 'print'));
      document.getElementById('ops-rule-search').addEventListener('input', (e) => {
        this._ruleSearch = e.target.value.trim();
        this.renderRules(el);
      });
      document.getElementById('ops-rule-cat').addEventListener('change', (e) => {
        this._ruleCat = e.target.value;
        this.renderRules(el);
      });
      el.querySelectorAll('.ops-rule-view').forEach(b => b.addEventListener('click', async () => {
        const r = await API.getCompanyRule(parseInt(b.dataset.id, 10));
        if (r.success) this.showRuleForm(r.data);
      }));
      el.querySelectorAll('.ops-rule-history').forEach(b => b.addEventListener('click', async () => {
        const r = await API.getCompanyRule(parseInt(b.dataset.id, 10));
        if (!r.success) return;
        const hist = r.data.history || [];
        Utils.showModal(`Rule History — ${r.data.rule_number}`, `
          <div class="table-wrap"><table><thead><tr><th>When</th><th>Action</th><th>By</th></tr></thead>
          <tbody>${hist.map(h => `<tr><td>${h.created_at || '—'}</td><td>${h.action}</td><td>${h.username || '—'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No history</td></tr>'}
          </tbody></table></div>`, '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
      }));
      el.querySelectorAll('.ops-rule-pdf').forEach(b => b.addEventListener('click', () =>
        pdfAction(() => API.getCompanyRulePdf(parseInt(b.dataset.id, 10)), `rule-${b.dataset.id}.pdf`, 'save')));
      el.querySelectorAll('.ops-rule-print').forEach(b => b.addEventListener('click', () =>
        pdfAction(() => API.getCompanyRulePdf(parseInt(b.dataset.id, 10)), `rule-${b.dataset.id}.pdf`, 'print')));
      el.querySelectorAll('.ops-rule-del').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Archive this rule?')) return;
        await API.archiveCompanyRule(parseInt(b.dataset.id, 10), this.app.user);
        Utils.toast('Rule archived', 'success');
        this.renderRules(el);
      }));
    },

    showRuleForm(rule = null) {
      const r = rule || {};
      Utils.showModal(rule ? `Rule ${r.rule_number}` : 'New Company Rule', `
        <div class="form-grid">
          <div class="field"><label>Title *</label><input id="rule-title" value="${r.title || ''}"></div>
          <div class="field"><label>Category</label><select id="rule-cat"><option value="">— Select —</option>
            ${RULE_CATEGORIES.map(c => `<option value="${c}" ${r.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select></div>
          <div class="field"><label>Effective Date</label><input type="date" id="rule-date" value="${r.effective_date || Utils.today()}"></div>
          <div class="field full"><label>Description</label><textarea id="rule-desc" rows="5">${r.description || ''}</textarea></div>
        </div>`,
        `<button class="btn btn-primary" id="rule-save">Save</button>
         ${rule && r.status === 'active' ? '<button class="btn btn-warning" id="rule-archive">Archive</button>' : ''}`);
      document.getElementById('rule-save').addEventListener('click', async () => {
        const data = {
          id: r.id, title: document.getElementById('rule-title').value.trim(),
          category: document.getElementById('rule-cat').value,
          effective_date: document.getElementById('rule-date').value,
          description: document.getElementById('rule-desc').value.trim(),
          bump_version: !!r.id
        };
        if (!data.title) return Utils.toast('Title required', 'error');
        const res = await API.saveCompanyRule(data, this.app.user);
        if (!res.success) return Utils.toast(res.error, 'error');
        Utils.hideModal(); Utils.toast('Rule saved', 'success');
        this.render(document.getElementById('admin-content'), this.admin);
      });
      document.getElementById('rule-archive')?.addEventListener('click', async () => {
        await API.archiveCompanyRule(r.id, this.app.user);
        Utils.hideModal(); Utils.toast('Rule archived', 'success');
        this.render(document.getElementById('admin-content'), this.admin);
      });
    },

    async renderChecklist(el, type) {
      const label = type === 'opening' ? 'Morning Opening Routine' : 'Closing Routine';
      const tplFn = type === 'opening' ? API.getOpeningChecklistTemplates : API.getClosingChecklistTemplates;
      const [tplRes, settingsRes, empsRes] = await Promise.all([
        tplFn(), API.getChecklistSettings(), API.getEmployees({ status: 'Active' })
      ]);
      const templates = tplRes.data || [];
      const employees = empsRes.data || [];
      const empOpts = (selected) => `<option value="">— Any worker —</option>${employees.map(e =>
        `<option value="${e.id}" ${String(selected) === String(e.id) ? 'selected' : ''}>${e.full_name}</option>`).join('')}`;
      const chkSettings = settingsRes.data || {};
      const deadlineKey = type === 'opening' ? 'morning_deadline' : 'closing_deadline';
      const intervalKey = type === 'opening' ? 'morning_checkbox_interval_minutes' : 'closing_checkbox_interval_minutes';
      const deadlineVal = chkSettings[deadlineKey] || (type === 'opening' ? '11:00' : '22:00');
      const intervalVal = chkSettings[intervalKey] ?? 0;
      el.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="card-body">
        <h4>Deadline &amp; Checkbox Interval</h4>
        <p class="muted">Set the daily reminder deadline and how many minutes staff must wait between ticking each task checkbox.</p>
        <div class="form-grid" style="max-width:420px">
          <div class="field"><label>${type === 'opening' ? 'Morning' : 'Closing'} deadline (HH:MM)</label>
            <input type="time" id="chk-deadline" value="${deadlineVal}"></div>
          <div class="field"><label>Minutes between checkboxes</label>
            <input type="number" id="chk-interval" min="0" step="1" value="${intervalVal}">
            <small class="muted">0 = no wait — staff can tick tasks one after another</small></div>
        </div>
        <button class="btn btn-primary btn-sm" id="chk-save-deadline" style="margin-top:8px">Save Settings</button>
      </div></div>
      <h4>${label} — Template Tasks</h4>
      <p class="muted">Add the tasks workers must tick as checkboxes. Assign each task to a worker — they see only their tasks in Staff Portal / Operations and tick them off (not Done/Not Done buttons).</p>
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <button class="btn btn-primary" id="chk-add-tpl">+ Add Task</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Task</th><th>Assigned To</th><th>Required</th><th></th></tr></thead>
        <tbody>${templates.map(t => `<tr>
          <td>${t.sort_order}</td><td>${t.task_name}</td>
          <td>${t.assigned_employee_name || (t.assigned_employee_id ? `<span class="muted">Worker #${t.assigned_employee_id}</span>` : '<span class="muted">Any worker</span>')}</td>
          <td>${t.is_required ? 'Yes' : 'No'}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-ghost tpl-edit" data-id="${t.id}" data-name="${Utils.escHtml(t.task_name)}" data-req="${t.is_required ? 1 : 0}" data-order="${t.sort_order}" data-owner="${t.created_by || ''}" data-emp="${t.assigned_employee_id || ''}">Edit</button>
            <button class="btn btn-sm btn-danger tpl-del" data-id="${t.id}" data-name="${Utils.escHtml(t.task_name)}" data-owner="${t.created_by || ''}">Delete</button>
          </td></tr>`).join('')}
        </tbody></table></div>`;

      await this.renderSubmittedRecords(el, type);

      document.getElementById('chk-save-deadline')?.addEventListener('click', async () => {
        const val = document.getElementById('chk-deadline').value;
        if (!val) return Utils.toast('Set a deadline time', 'error');
        const interval = parseInt(document.getElementById('chk-interval')?.value, 10) || 0;
        const payload = type === 'opening'
          ? { morning_deadline: val, morning_checkbox_interval_minutes: interval }
          : { closing_deadline: val, closing_checkbox_interval_minutes: interval };
        const r = await API.saveChecklistSettings(payload, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Deadline and checkbox interval saved', 'success');
      });

      document.getElementById('chk-add-tpl').addEventListener('click', () => {
        Utils.showModal('Add Checklist Task', `
          <div class="field"><label>Task Name</label><input id="tpl-name"></div>
          <div class="field"><label>Assign to Worker</label><select id="tpl-emp">${empOpts('')}</select></div>
          <div class="field"><label><input type="checkbox" id="tpl-req" checked> Required</label></div>`,
          '<button class="btn btn-primary" id="tpl-save">Save</button>');
        document.getElementById('tpl-save').addEventListener('click', async () => {
          const name = document.getElementById('tpl-name').value.trim();
          if (!name) return Utils.toast('Task name required', 'error');
          const empVal = document.getElementById('tpl-emp').value;
          const fn = type === 'opening' ? API.saveOpeningChecklistTemplate : API.saveClosingChecklistTemplate;
          await fn({
            task_name: name,
            is_required: document.getElementById('tpl-req').checked,
            sort_order: templates.length + 1,
            assigned_employee_id: empVal ? parseInt(empVal, 10) : null
          }, this.app.user);
          Utils.hideModal(); this.renderChecklist(el, type);
        });
      });
      const saveTplFn = type === 'opening' ? API.saveOpeningChecklistTemplate : API.saveClosingChecklistTemplate;
      const delTplFn = type === 'opening' ? API.deleteOpeningChecklistTemplate : API.deleteClosingChecklistTemplate;
      el.querySelectorAll('.tpl-edit').forEach(b => b.addEventListener('click', async () => {
        let actor = this.app.user;
        if (AdminOverride.needsOverrideReason(this.app.user, b.dataset.owner)) {
          const guard = await AdminOverride.guardAction(this.app.user, 'Edit Checklist Task', b.dataset.owner);
          if (!guard.ok) return;
          actor = AdminOverride.actorWithOverride(this.app.user, guard.override_reason);
        }
        Utils.showModal('Edit Checklist Task', `
          <div class="field"><label>Task Name</label><input id="tpl-name" value="${b.dataset.name || ''}"></div>
          <div class="field"><label>Assign to Worker</label><select id="tpl-emp">${empOpts(b.dataset.emp || '')}</select></div>
          <div class="field"><label>Sort Order</label><input type="number" id="tpl-order" value="${b.dataset.order || 0}"></div>
          <div class="field"><label><input type="checkbox" id="tpl-req" ${b.dataset.req === '1' ? 'checked' : ''}> Required</label></div>`,
          '<button class="btn btn-primary" id="tpl-save">Save</button>');
        document.getElementById('tpl-save').addEventListener('click', async () => {
          const name = document.getElementById('tpl-name').value.trim();
          if (!name) return Utils.toast('Task name required', 'error');
          const empVal = document.getElementById('tpl-emp').value;
          const r = await saveTplFn({
            id: parseInt(b.dataset.id, 10),
            task_name: name,
            sort_order: parseInt(document.getElementById('tpl-order').value, 10) || 0,
            is_required: document.getElementById('tpl-req').checked,
            assigned_employee_id: empVal ? parseInt(empVal, 10) : null
          }, actor);
          if (!r.success) return Utils.toast(r.error, 'error');
          Utils.hideModal();
          this.renderChecklist(el, type);
        });
      }));
      el.querySelectorAll('.tpl-del').forEach(b => b.addEventListener('click', async () => {
        let actor = this.app.user;
        if (AdminOverride.needsOverrideReason(this.app.user, b.dataset.owner)) {
          const guard = await AdminOverride.guardAction(this.app.user, 'Delete Checklist Task', b.dataset.owner);
          if (!guard.ok) return;
          actor = AdminOverride.actorWithOverride(this.app.user, guard.override_reason);
        }
        if (!confirm(`Remove template task "${b.dataset.name}"?`)) return;
        const r = await delTplFn(parseInt(b.dataset.id, 10), actor);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Template task removed', 'success');
        this.renderChecklist(el, type);
      }));
    },

    async renderSubmittedRecords(el, type) {
      this._chkFrom = this._chkFrom || Utils.today().slice(0, 7) + '-01';
      this._chkTo = this._chkTo || Utils.today();
      const runsRes = await API.getChecklistRuns({
        run_type: type,
        from: this._chkFrom,
        to: this._chkTo
      });
      const runs = (runsRes.data || []).filter(r => r.status !== 'cancelled');
      const isAdmin = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(this.app.user?.role);

      const section = document.createElement('div');
      section.innerHTML = `
        <h4 style="margin-top:24px">Submitted Records</h4>
        <p class="muted">Confirm, edit, or delete checklist runs. Filter by date, export PDF, or print. Failed = missed deadline (counts against Employee of the Month).</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:12px 0">
          <div class="field"><label>From</label><input type="date" id="chk-rec-from" value="${this._chkFrom}"></div>
          <div class="field"><label>To</label><input type="date" id="chk-rec-to" value="${this._chkTo}"></div>
          <button class="btn btn-primary btn-sm" id="chk-rec-filter">Filter</button>
        </div>
        <div class="table-wrap"><table class="table-compact">
          <thead><tr><th>Date</th><th>Worker</th><th>Status</th><th>Submitted</th><th>Confirmed</th><th></th></tr></thead>
          <tbody>${runs.map(r => `<tr>
            <td>${r.run_date}</td>
            <td>${r.employee_name || '—'}</td>
            <td><span class="tag">${r.status}</span>${r.failure_reason ? `<br><small class="muted">${Utils.escHtml(r.failure_reason)}</small>` : ''}</td>
            <td>${r.submitted_at ? Utils.formatDateTime(r.submitted_at) : '—'}</td>
            <td>${r.confirmed_at ? Utils.formatDateTime(r.confirmed_at) : '—'}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm btn-ghost chk-run-pdf" data-id="${r.id}">PDF</button>
              <button class="btn btn-sm btn-ghost chk-run-print" data-id="${r.id}">Print</button>
              ${isAdmin && ['submitted', 'in_progress', 'failed'].includes(r.status) ? `<button class="btn btn-sm btn-success chk-run-confirm" data-id="${r.id}">Confirm</button>` : ''}
              ${isAdmin ? `<button class="btn btn-sm btn-ghost chk-run-edit" data-id="${r.id}">Edit</button>
                <button class="btn btn-sm btn-danger chk-run-del" data-id="${r.id}">Delete</button>` : ''}
            </td></tr>`).join('')
            || '<tr><td colspan="6" class="muted">No records in this period</td></tr>'}
          </tbody>
        </table></div>`;
      el.appendChild(section);

      section.querySelector('#chk-rec-filter')?.addEventListener('click', () => {
        this._chkFrom = section.querySelector('#chk-rec-from').value;
        this._chkTo = section.querySelector('#chk-rec-to').value;
        this.renderChecklist(el, type);
      });

      const pdfRun = async (id) => {
        const r = await API.getChecklistReportPdf(id);
        if (!r.success) return Utils.toast(r.error || 'PDF failed', 'error');
        return r;
      };

      section.querySelectorAll('.chk-run-pdf').forEach(b => b.addEventListener('click', async () => {
        const r = await pdfRun(parseInt(b.dataset.id, 10));
        if (r?.success) await API.saveFile(`checklist-${b.dataset.id}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], r.data);
      }));
      section.querySelectorAll('.chk-run-print').forEach(b => b.addEventListener('click', async () => {
        const r = await pdfRun(parseInt(b.dataset.id, 10));
        if (r?.success) await API.openPdf(r.data, `checklist-${b.dataset.id}.pdf`);
      }));
      section.querySelectorAll('.chk-run-confirm').forEach(b => b.addEventListener('click', async () => {
        const id = parseInt(b.dataset.id, 10);
        Utils.showModal('Confirm Checklist', `
          <p class="muted">Confirm this ${type === 'opening' ? 'morning' : 'closing'} record for admin sign-off.</p>
          <div class="field"><label>Admin notes (optional)</label><input id="chk-confirm-notes" placeholder="Notes"></div>`,
          '<button class="btn btn-success" id="chk-confirm-go">Confirm</button>');
        document.getElementById('chk-confirm-go')?.addEventListener('click', async () => {
          const notes = document.getElementById('chk-confirm-notes')?.value.trim() || '';
          const r = await API.confirmChecklistRun(id, { admin_notes: notes }, this.app.user);
          if (!r.success) return Utils.toast(r.error || 'Confirm failed', 'error');
          Utils.hideModal();
          Utils.toast('Checklist confirmed', 'success');
          this.renderChecklist(el, type);
        });
      }));
      section.querySelectorAll('.chk-run-edit').forEach(b => b.addEventListener('click', async () => {
        const id = parseInt(b.dataset.id, 10);
        const runRes = await API.getChecklistRun(id);
        if (!runRes.success || !runRes.data) return Utils.toast(runRes.error || 'Could not load record', 'error');
        const run = runRes.data;
        if (['submitted', 'confirmed', 'failed'].includes(run.status)) {
          const re = await API.reopenChecklistRun(id, this.app.user);
          if (!re.success) return Utils.toast(re.error, 'error');
        }
        const fresh = (await API.getChecklistRun(id)).data || run;
        Utils.showModal(`Edit ${type === 'opening' ? 'Morning' : 'Closing'} Record — ${fresh.run_date}`, `
          <p class="muted">Update task checkboxes, then save or confirm.</p>
          <div class="field"><label>Admin notes</label><input id="chk-edit-notes" value="${Utils.escHtml(fresh.admin_notes || '')}"></div>
          ${(fresh.items || []).map(i => {
            const done = i.item_status === 'done' || (!i.item_status && i.completed);
            return `<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
              <input type="checkbox" class="chk-edit-item" data-id="${i.id}" ${done ? 'checked' : ''} style="width:18px;height:18px">
              <span style="flex:1">${Utils.escHtml(i.task_name)}</span>
            </label>`;
          }).join('')}`,
          `<button class="btn btn-primary" id="chk-edit-save">Save</button>
           <button class="btn btn-success" id="chk-edit-confirm">Save &amp; Confirm</button>`);
        const collectItems = () => [...document.querySelectorAll('.chk-edit-item')].map(cb => ({
          id: parseInt(cb.dataset.id, 10),
          item_status: cb.checked ? 'done' : 'pending'
        }));
        document.getElementById('chk-edit-save')?.addEventListener('click', async () => {
          const r = await API.adminUpdateChecklistRun(id, {
            items: collectItems(),
            admin_notes: document.getElementById('chk-edit-notes')?.value.trim() || '',
            status: 'in_progress'
          }, this.app.user);
          if (!r.success) return Utils.toast(r.error, 'error');
          Utils.hideModal();
          Utils.toast('Record updated', 'success');
          this.renderChecklist(el, type);
        });
        document.getElementById('chk-edit-confirm')?.addEventListener('click', async () => {
          const r = await API.adminUpdateChecklistRun(id, {
            items: collectItems(),
            admin_notes: document.getElementById('chk-edit-notes')?.value.trim() || '',
            status: 'confirmed'
          }, this.app.user);
          if (!r.success) return Utils.toast(r.error, 'error');
          Utils.hideModal();
          Utils.toast('Record saved and confirmed', 'success');
          this.renderChecklist(el, type);
        });
      }));
      section.querySelectorAll('.chk-run-del').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this checklist record permanently?')) return;
        const r = await API.deleteChecklistRun(parseInt(b.dataset.id, 10), this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Record deleted', 'success');
        this.renderChecklist(el, type);
      }));
    }
  };
})();

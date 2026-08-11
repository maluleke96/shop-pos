// Admin — Contracts & Probation
(function () {
  if (!window.AdminPage) return;

  if (!AdminPage.sections.some(s => s.id === 'hrcontracts')) {
    AdminPage.sections.splice(4, 0, { id: 'hrcontracts', label: '📄 Contracts & Probation', icon: 'hrcontracts' });
  }

  const AdminHrPage = {
    async render(el, admin) {
      this.admin = admin;
      this.app = admin.app;
      this.tab = this.tab || 'training';
      const tabs = [
        ['training', 'Training'], ['probation', 'Probation'], ['contracts', 'Employment Contracts'],
        ['templates', 'Training & Probation Forms'], ['contract-templates', 'Contract Templates'],
        ['evaluations', 'Probation Evaluations'], ['submissions', 'Staff Submissions']
      ];
      el.innerHTML = `<div class="admin-section"><h3>Contracts & Probation</h3>
        <p class="muted">Train staff with daily evaluations, move passed trainees into probation, then issue employment contracts after probation.</p>
        <div class="form-tabs" id="hr-main-tabs">${tabs.map(([id, label]) =>
          `<button type="button" class="form-tab ${this.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
        <div id="hr-main-content"><p class="muted">Loading…</p></div></div>`;
      el.querySelector('#hr-main-tabs').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab]');
        if (!btn) return;
        this.tab = btn.dataset.tab;
        this.render(el, admin);
      });
      const content = document.getElementById('hr-main-content');
      const renderers = {
        training: () => this.renderTraining(content),
        contracts: () => this.renderContracts(content),
        templates: () => this.renderHrTemplates(content),
        'contract-templates': () => this.renderTemplates(content),
        probation: () => this.renderProbation(content),
        evaluations: () => this.renderEvaluations(content),
        submissions: () => this.renderSubmissions(content)
      };
      await (renderers[this.tab] || renderers.training)();
      if (this.tab === 'probation' && this._probationEmployeeId) {
        const empsRes = await API.getEmployees({ status: 'Active' });
        this.showProbationForm(null, empsRes.data || [], this._probationEmployeeId);
        this._probationEmployeeId = null;
      }
    },

    async renderContracts(el) {
      const [contractsRes, empsRes, tplRes] = await Promise.all([
        API.getHrContracts({}, this.app.user),
        API.getEmployees({ status: 'Active' }),
        API.getContractTemplates(this.app.user)
      ]);
      const contracts = contractsRes.data || [];
      const emps = empsRes.data || [];
      const templates = tplRes.data || [];
      el.innerHTML = `<div style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap">
        <button class="btn btn-primary" id="hr-new-contract">+ New Contract</button></div>
        <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Position</th><th>Status</th><th>Created</th><th></th></tr></thead>
        <tbody>${contracts.map(c => `<tr>
          <td><strong>${c.employee_name}</strong><br><small>${c.employee_code || ''}</small></td>
          <td>${c.emp_position || '—'}</td>
          <td><span class="tag">${c.status}</span></td>
          <td>${Utils.formatDateTime(c.created_at)}</td>
          <td><button class="btn btn-sm btn-ghost hr-edit-contract" data-id="${c.id}">Edit</button>
            <button class="btn btn-sm btn-ghost hr-pdf-contract" data-id="${c.id}">PDF</button></td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">No contracts yet</td></tr>'}
        </tbody></table></div>`;
      document.getElementById('hr-new-contract').addEventListener('click', () => this.showContractBuilder(null, emps, templates));
      el.querySelectorAll('.hr-edit-contract').forEach(b => b.addEventListener('click', async () => {
        const r = await API.getHrContract(parseInt(b.dataset.id, 10), this.app.user);
        if (r.data) this.showContractBuilder(r.data, emps, templates);
      }));
      el.querySelectorAll('.hr-pdf-contract').forEach(b => b.addEventListener('click', async () => {
        const buf = await API.getHrContractPdf(parseInt(b.dataset.id, 10), this.app.user);
        if (buf.success) await API.saveFile(`contract-${b.dataset.id}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], buf.data);
        else Utils.toast(buf.error || 'PDF failed', 'error');
      }));
    },

    async renderTraining(el) {
      const [recRes, empRes, tplRes] = await Promise.all([
        API.getHrTrainingRecords({}, this.app.user),
        API.getEmployees({ status: 'Active' }),
        API.getHrTrainingTemplates('training', this.app.user)
      ]);
      const records = recRes.data || [];
      const emps = empRes.data || [];
      const templates = tplRes.data || [];
      const isAdmin = ['owner', 'manager'].includes(this.app.user?.role);
      el.innerHTML = `<button class="btn btn-primary" id="hr-new-training" style="margin:12px 0">+ Training Record</button>
        <p class="muted" style="margin-bottom:8px">Professional training records. Admin can edit/delete. Evaluations can be saved as PDF, printed, or sent on WhatsApp.</p>
        <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Start</th><th>Expiry</th><th>Status</th><th>Evaluations</th><th></th></tr></thead>
        <tbody>${records.map(r => `<tr>
          <td><strong>${r.employee_name}</strong></td>
          <td>${r.start_date}</td>
          <td>${r.expiry_date || '—'}</td>
          <td><span class="tag">${r.status}</span></td>
          <td>${(r.evaluations || []).length}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-ghost hr-eval-training" data-id="${r.id}">Add Evaluation</button>
            <button class="btn btn-sm btn-ghost hr-eval-pdf" data-id="${r.id}">Eval PDF</button>
            <button class="btn btn-sm btn-ghost hr-eval-print" data-id="${r.id}">Print</button>
            <button class="btn btn-sm btn-ghost hr-eval-wa" data-id="${r.id}" data-eid="${r.employee_id}">WhatsApp</button>
            ${isAdmin ? `<button class="btn btn-sm btn-ghost hr-edit-training" data-id="${r.id}">Edit</button>
            <button class="btn btn-sm btn-danger hr-del-training" data-id="${r.id}">Delete</button>` : ''}
            ${r.status === 'active' ? `<button class="btn btn-sm btn-primary hr-pass-probation" data-id="${r.id}">Pass → Probation</button>
            <button class="btn btn-sm btn-warning hr-term-training" data-id="${r.id}">Terminate</button>
            <button class="btn btn-sm btn-ghost hr-extend-training" data-id="${r.id}">Extend</button>` : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No training records</td></tr>'}
        </tbody></table></div>`;
      const openTrainingForm = (rec) => {
        Utils.showModal(rec ? 'Edit Training Record' : 'New Training Record', `
          <div class="form-grid">
            <div class="field"><label>Employee</label><select id="tr-emp">${emps.map(e => `<option value="${e.id}" ${rec?.employee_id == e.id ? 'selected' : ''}>${e.full_name}</option>`).join('')}</select></div>
            <div class="field"><label>Template</label><select id="tr-tpl"><option value="">—</option>${templates.map(t => `<option value="${t.id}" ${rec?.template_id == t.id ? 'selected' : ''}>${t.title}</option>`).join('')}</select></div>
            <div class="field"><label>Start Date</label><input type="date" id="tr-start" value="${rec?.start_date || Utils.today()}"></div>
            <div class="field"><label>Expiry Date</label><input type="date" id="tr-expiry" value="${rec?.expiry_date || ''}"></div>
            <div class="field"><label>Status</label><select id="tr-status">
              ${['active', 'passed', 'terminated', 'extended'].map(s => `<option value="${s}" ${rec?.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select></div>
          </div>`, '<button class="btn btn-primary" id="tr-save">Save</button>');
        document.getElementById('tr-save').addEventListener('click', async () => {
          const r = await API.saveHrTrainingRecord({
            id: rec?.id,
            employee_id: parseInt(document.getElementById('tr-emp').value, 10),
            template_id: document.getElementById('tr-tpl').value ? parseInt(document.getElementById('tr-tpl').value, 10) : null,
            start_date: document.getElementById('tr-start').value,
            expiry_date: document.getElementById('tr-expiry').value || null,
            status: document.getElementById('tr-status').value || 'active',
            evaluations: rec?.evaluations || []
          }, this.app.user);
          if (!r.success) return Utils.toast(r.error, 'error');
          Utils.hideModal();
          this.renderTraining(el);
        });
      };
      document.getElementById('hr-new-training')?.addEventListener('click', () => openTrainingForm(null));
      el.querySelectorAll('.hr-edit-training').forEach(b => b.addEventListener('click', () => {
        openTrainingForm(records.find(x => x.id == b.dataset.id));
      }));
      el.querySelectorAll('.hr-del-training').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this training record?')) return;
        const r = await API.deleteHrTrainingRecord(parseInt(b.dataset.id, 10), this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Training record deleted', 'success');
        this.renderTraining(el);
      }));
      el.querySelectorAll('.hr-eval-training').forEach(b => b.addEventListener('click', () => {
        const rec = records.find(x => x.id == b.dataset.id);
        Utils.showModal('Daily Training Evaluation', `
          <div class="field"><label>Checklist items completed today</label>
            <textarea id="tr-eval-items" rows="4" placeholder="One item per line"></textarea></div>
          <div class="field"><label>Notes</label><textarea id="tr-eval-notes" rows="2"></textarea></div>`,
          '<button class="btn btn-primary" id="tr-eval-save">Save</button>');
        document.getElementById('tr-eval-save').addEventListener('click', async () => {
          const items = document.getElementById('tr-eval-items').value.split('\n').map(s => s.trim()).filter(Boolean);
          const r = await API.saveHrTrainingEvaluation(parseInt(b.dataset.id, 10), {
            items: items.map(t => ({ task: t, done: true })),
            notes: document.getElementById('tr-eval-notes').value.trim()
          }, this.app.user);
          if (!r.success) return Utils.toast(r.error, 'error');
          Utils.hideModal();
          Utils.toast('Evaluation saved', 'success');
          this.renderTraining(el);
        });
      }));
      el.querySelectorAll('.hr-eval-pdf').forEach(b => b.addEventListener('click', async () => {
        const buf = await API.getHrTrainingEvalPdf(parseInt(b.dataset.id, 10), this.app.user);
        if (!buf.success) return Utils.toast(buf.error || 'PDF failed', 'error');
        await API.saveFile(`training-eval-${b.dataset.id}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], buf.data);
        Utils.toast('Evaluation PDF saved', 'success');
      }));
      el.querySelectorAll('.hr-eval-print').forEach(b => b.addEventListener('click', () => {
        const rec = records.find(x => x.id == b.dataset.id);
        if (!rec) return;
        const evals = rec.evaluations || [];
        Export.print(`Training Evaluation — ${rec.employee_name}`,
          ['Date', 'Notes', 'Items'],
          evals.map(ev => [ev.date || '—', ev.notes || '—', (ev.items || []).map(it => typeof it === 'string' ? it : it.task).join('; ')]),
          Utils.companyInfo(this.admin.settings || this.app.settings));
      }));
      el.querySelectorAll('.hr-eval-wa').forEach(b => b.addEventListener('click', async () => {
        const rec = records.find(x => x.id == b.dataset.id);
        const empRes = await API.getEmployee(parseInt(b.dataset.eid, 10));
        const phone = empRes.data?.phone;
        if (!phone) return Utils.toast('No phone on employee / applicant profile', 'error');
        const evals = (rec?.evaluations || []).slice(-3);
        const msg = `Training evaluation — ${rec?.employee_name || ''}\nStatus: ${rec?.status}\n` +
          evals.map(ev => `${ev.date || ''}: ${ev.notes || ''} (${(ev.items || []).length} items)`).join('\n');
        const wa = await API.sendWhatsAppMessage({
          phone, recipient_name: rec?.employee_name, message_type: 'training_eval', body: msg
        }, this.app.user);
        if (wa.success && wa.data?.url) window.open(wa.data.url, '_blank');
        else Utils.openWhatsApp(phone, msg);
      }));
      const setTrainingStatus = async (rec, status, extra = {}) => {
        const r = await API.saveHrTrainingRecord({
          id: rec.id, employee_id: rec.employee_id, start_date: rec.start_date,
          expiry_date: extra.expiry_date || rec.expiry_date, template_id: rec.template_id,
          status, evaluations: rec.evaluations || []
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        const empRes = await API.getEmployee(rec.employee_id);
        const phone = empRes.data?.phone;
        const msg = `Training result — ${rec.employee_name}\nOutcome: ${status.toUpperCase()}\nStart: ${rec.start_date}\nExpiry: ${extra.expiry_date || rec.expiry_date || '—'}`;
        if (phone) {
          const wa = await API.sendWhatsAppMessage({
            phone, recipient_name: rec.employee_name, message_type: 'training_result', body: msg
          }, this.app.user);
          if (wa.success && wa.data?.url) window.open(wa.data.url, '_blank');
          else Utils.openWhatsApp(phone, msg);
        }
        Utils.toast(`Training marked ${status}` + (phone ? ' — WhatsApp opened' : ''), 'success');
        if (status === 'passed') {
          this._probationEmployeeId = rec.employee_id;
          this.tab = 'probation';
          this.render(document.getElementById('admin-content'), this.admin);
        } else this.renderTraining(el);
      };
      el.querySelectorAll('.hr-pass-probation').forEach(b => b.addEventListener('click', async () => {
        const rec = records.find(x => x.id == b.dataset.id);
        if (rec) await setTrainingStatus(rec, 'passed');
      }));
      el.querySelectorAll('.hr-term-training').forEach(b => b.addEventListener('click', async () => {
        const rec = records.find(x => x.id == b.dataset.id);
        if (rec && confirm('Terminate this training?')) await setTrainingStatus(rec, 'terminated');
      }));
      el.querySelectorAll('.hr-extend-training').forEach(b => b.addEventListener('click', async () => {
        const rec = records.find(x => x.id == b.dataset.id);
        if (!rec) return;
        const days = parseInt(prompt('Extend by how many days?', '14') || '0', 10);
        if (!days) return;
        const base = new Date((rec.expiry_date || rec.start_date || Utils.today()) + 'T12:00:00');
        base.setDate(base.getDate() + days);
        await setTrainingStatus(rec, 'extended', { expiry_date: base.toLocaleDateString('en-CA') });
      }));
    },

    async renderHrTemplates(el) {
      const isAdmin = ['owner', 'manager'].includes(this.app.user?.role);
      const res = await API.getHrTrainingTemplates(null, this.app.user);
      const templates = res.data || [];
      el.innerHTML = `${isAdmin ? '<button class="btn btn-primary" id="hr-new-hr-tpl" style="margin:12px 0">+ Template</button>' : ''}
        <p class="muted" style="margin-bottom:8px">${isAdmin
          ? 'Edit the Chisanyama Connection training and probation agreements. Assign them to a manager/supervisor to fill for new staff.'
          : 'View training and probation templates. Admin assigns forms to you to fill for new staff.'}</p>
        <div class="table-wrap"><table><thead><tr><th>Type</th><th>Title</th><th></th></tr></thead>
        <tbody>${templates.map(t => `<tr><td><span class="tag">${t.type}</span></td><td>${t.title}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-ghost hr-view-hr-tpl" data-id="${t.id}">View</button>
            ${isAdmin ? `<button class="btn btn-sm btn-ghost hr-edit-hr-tpl" data-id="${t.id}">Edit</button>
            <button class="btn btn-sm btn-danger hr-del-hr-tpl" data-id="${t.id}">Delete</button>` : ''}
          </td></tr>`).join('')
          || '<tr><td colspan="3" class="muted">No HR templates — restart the app to load defaults</td></tr>'}
        </tbody></table></div>`;
      if (isAdmin) document.getElementById('hr-new-hr-tpl')?.addEventListener('click', () => this.showHrTemplateForm());
      el.querySelectorAll('.hr-view-hr-tpl, .hr-edit-hr-tpl').forEach(b => {
        const t = templates.find(x => x.id == b.dataset.id);
        if (t) b.addEventListener('click', () => this.showHrTemplateForm(t, !b.classList.contains('hr-edit-hr-tpl')));
      });
      el.querySelectorAll('.hr-del-hr-tpl').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete template?')) return;
        await API.deleteHrTrainingTemplate(parseInt(b.dataset.id, 10), this.app.user);
        this.renderHrTemplates(el);
      }));
    },

    showHrTemplateForm(tpl, readOnly) {
      const isAdmin = ['owner', 'manager'].includes(this.app.user?.role);
      if (readOnly || !isAdmin) {
        Utils.showModal(tpl?.title || 'HR Template', `
          <pre style="white-space:pre-wrap;font-size:12px;max-height:420px;overflow:auto;background:var(--bg-secondary);padding:12px;border-radius:8px">${Utils.escHtml(tpl?.body || '')}</pre>`,
          '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
        return;
      }
      Utils.showModal(tpl ? 'Edit HR Template' : 'New HR Template', `
        <div class="form-grid">
          <div class="field"><label>Type</label><select id="ht-type">
            ${['training', 'probation', 'employment'].map(t => `<option value="${t}" ${tpl?.type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select></div>
          <div class="field full"><label>Title</label><input id="ht-title" value="${Utils.escHtml(tpl?.title || '')}"></div>
          <div class="field full"><label>Body</label><textarea id="ht-body" rows="16" style="font-family:monospace;font-size:12px">${tpl?.body || ''}</textarea></div>
        </div>`, '<button class="btn btn-primary" id="ht-save">Save</button>');
      document.getElementById('ht-save').addEventListener('click', async () => {
        const r = await API.saveHrTrainingTemplate({
          id: tpl?.id, type: document.getElementById('ht-type').value,
          title: document.getElementById('ht-title').value.trim(),
          body: document.getElementById('ht-body').value
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        this.tab = 'templates';
        this.render(document.getElementById('admin-content'), this.admin);
      });
    },

    async renderSubmissions(el) {
      const isAdmin = ['owner', 'manager'].includes(this.app.user?.role);
      const canFill = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(this.app.user?.role);
      const [subRes, empRes, tplRes, usersRes] = await Promise.all([
        API.getHrStaffSubmissions({}, this.app.user),
        API.getEmployees({ status: 'Active' }),
        API.getHrTrainingTemplates(null, this.app.user),
        API.getUsers(this.app.user)
      ]);
      const subs = subRes.data || [];
      const emps = empRes.data || [];
      const templates = tplRes.data || [];
      const assignees = (usersRes.data || []).filter(u => ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(u.role));
      const pendingFill = (s) => s.status === 'pending' && !s.submitted_at;
      el.innerHTML = `${isAdmin ? `<div style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap">
        <button class="btn btn-primary" id="hr-assign-tpl">Assign to Manager to Fill</button></div>
        <p class="muted" style="margin-bottom:8px">Assign a training or probation template to a manager/supervisor. They fill it in and upload the CV — then you approve here.</p>` : `<p class="muted" style="margin-bottom:12px">Forms assigned to you to complete for new staff. Fill in the details, upload CV/documents, then submit to admin.</p>`}
        <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Type</th><th>Template</th><th>Assigned To</th><th>Status</th><th></th></tr></thead>
        <tbody>${subs.map(s => `<tr>
          <td><strong>${s.employee_name}</strong><br><small>${s.employee_code || ''}</small></td>
          <td>${s.template_type}</td>
          <td>${s.template_title || '—'}</td>
          <td>${s.assigned_to_name || 'Any manager'}</td>
          <td><span class="tag">${s.submitted_at ? 'Submitted' : 'Awaiting fill'}</span><br><small>${s.status}</small></td>
          <td style="white-space:nowrap">
            ${canFill && pendingFill(s) ? `<button class="btn btn-sm btn-primary hr-sub-fill" data-id="${s.id}">Fill & Submit</button>` : ''}
            ${isAdmin && s.submitted_at && s.status === 'pending' ? `<button class="btn btn-sm btn-success hr-sub-approve" data-id="${s.id}">Approve</button>
            <button class="btn btn-sm btn-danger hr-sub-reject" data-id="${s.id}">Reject</button>` : ''}
            <button class="btn btn-sm btn-ghost hr-sub-view" data-id="${s.id}">View</button>
            ${isAdmin ? `<button class="btn btn-sm btn-ghost hr-sub-edit" data-id="${s.id}">Edit</button>
            <button class="btn btn-sm btn-danger hr-sub-del" data-id="${s.id}">Delete</button>` : ''}
            <button class="btn btn-sm btn-ghost hr-sub-pdf" data-id="${s.id}">PDF/Print</button>
            <button class="btn btn-sm btn-ghost hr-sub-wa" data-id="${s.id}">WhatsApp</button>
          </td></tr>`).join('') || `<tr><td colspan="6" class="muted">${isAdmin ? 'No submissions yet — assign a template to a manager' : 'No forms assigned to you yet'}</td></tr>`}
        </tbody></table></div>`;
      document.getElementById('hr-assign-tpl')?.addEventListener('click', () => {
        Utils.showModal('Assign Template to Manager', `
          <div class="field"><label>New Staff / Employee *</label><select id="as-emp">${emps.map(e => `<option value="${e.id}">${e.full_name}</option>`).join('')}</select></div>
          <div class="field"><label>Template *</label><select id="as-tpl">${templates.map(t => `<option value="${t.id}" data-type="${t.type}">${t.type}: ${t.title}</option>`).join('')}</select></div>
          <div class="field"><label>Assign to Manager/Supervisor *</label><select id="as-mgr">${assignees.map(u => `<option value="${u.id}">${u.full_name} (${u.role})</option>`).join('')}</select></div>
          <div class="field"><label>Branch</label><input id="as-branch" placeholder="Branch name"></div>
          <div class="field"><label>Notes for manager</label><textarea id="as-notes" rows="2"></textarea></div>`,
          '<button class="btn btn-primary" id="as-save">Assign</button>');
        document.getElementById('as-save').addEventListener('click', async () => {
          const tplOpt = document.getElementById('as-tpl').selectedOptions[0];
          const r = await API.assignHrStaffTemplate({
            employee_id: parseInt(document.getElementById('as-emp').value, 10),
            template_id: parseInt(document.getElementById('as-tpl').value, 10),
            template_type: tplOpt?.dataset.type,
            assigned_to_user_id: parseInt(document.getElementById('as-mgr').value, 10),
            branch: document.getElementById('as-branch').value.trim(),
            notes: document.getElementById('as-notes').value.trim()
          }, this.app.user);
          if (!r.success) return Utils.toast(r.error, 'error');
          Utils.hideModal();
          Utils.toast('Assigned to manager — they can fill it under Staff Submissions', 'success');
          this.renderSubmissions(el);
        });
      });
      el.querySelectorAll('.hr-sub-fill').forEach(b => b.addEventListener('click', () => {
        const s = subs.find(x => x.id == b.dataset.id);
        if (s) this.showFillSubmissionForm(s, el);
      }));
      el.querySelectorAll('.hr-sub-approve').forEach(b => b.addEventListener('click', async () => {
        const r = await API.reviewHrStaffSubmission(parseInt(b.dataset.id, 10), 'approved', '', this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Submission approved', 'success');
        this.renderSubmissions(el);
      }));
      el.querySelectorAll('.hr-sub-reject').forEach(b => b.addEventListener('click', async () => {
        const notes = prompt('Rejection reason (optional):') || '';
        const r = await API.reviewHrStaffSubmission(parseInt(b.dataset.id, 10), 'rejected', notes, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        this.renderSubmissions(el);
      }));
      el.querySelectorAll('.hr-sub-view').forEach(b => b.addEventListener('click', () => {
        const s = subs.find(x => x.id == b.dataset.id);
        if (!s) return;
        const filled = s.filled_data || {};
        const docs = s.doc_paths || [];
        Utils.showModal(`Submission — ${s.employee_name}`, `
          <p><strong>Type:</strong> ${s.template_type} · <strong>Status:</strong> ${s.status}
            ${s.submitted_at ? `<br><strong>Submitted:</strong> ${Utils.formatDateTime(s.submitted_at)} by ${s.submitted_by_name || '—'}` : ''}</p>
          <pre style="white-space:pre-wrap;font-size:12px;max-height:180px;overflow:auto;background:var(--bg-secondary);padding:10px;border-radius:8px">${Utils.escHtml(filled.completed_form || filled.employee_response || filled.template_body || JSON.stringify(filled, null, 2))}</pre>
          ${docs.length ? `<p><strong>Documents / CV:</strong></p><ul>${docs.map(d => `<li><button class="btn btn-sm btn-ghost hr-open-doc" data-path="${Utils.escHtml(d)}">Open ${d.split(/[/\\]/).pop()}</button></li>`).join('')}</ul>` : '<p class="muted">No documents uploaded</p>'}`,
          '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
        document.querySelectorAll('.hr-open-doc').forEach(ob => ob.addEventListener('click', () => API.openPath(ob.dataset.path)));
      }));
      el.querySelectorAll('.hr-sub-edit').forEach(b => b.addEventListener('click', () => {
        const s = subs.find(x => x.id == b.dataset.id);
        if (s) this.showFillSubmissionForm(s, el, true);
      }));
      el.querySelectorAll('.hr-sub-del').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this staff submission?')) return;
        const r = await API.deleteHrStaffSubmission(parseInt(b.dataset.id, 10), this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Submission deleted', 'success');
        this.renderSubmissions(el);
      }));
      el.querySelectorAll('.hr-sub-pdf').forEach(b => b.addEventListener('click', () => {
        const s = subs.find(x => x.id == b.dataset.id);
        if (!s) return;
        const filled = s.filled_data || {};
        Export.print(`${s.template_type} — ${s.employee_name}`,
          ['Field', 'Value'],
          [
            ['Employee', s.employee_name],
            ['Type', s.template_type],
            ['Status', s.status],
            ['Phone', filled.phone || '—'],
            ['Position', filled.position || '—'],
            ['Branch', filled.branch || '—'],
            ['Trainer', filled.trainer || '—'],
            ['Agreement', (filled.completed_form || '').slice(0, 500)]
          ],
          Utils.companyInfo(this.admin.settings || this.app.settings));
      }));
      el.querySelectorAll('.hr-sub-wa').forEach(b => b.addEventListener('click', async () => {
        const s = subs.find(x => x.id == b.dataset.id);
        if (!s) return;
        const filled = s.filled_data || {};
        const empRes = await API.getEmployee(s.employee_id);
        const phone = filled.phone || empRes.data?.phone;
        if (!phone) return Utils.toast('No phone on submission / employee', 'error');
        const msg = `${s.template_type} form — ${s.employee_name}\nStatus: ${s.status}\nPosition: ${filled.position || '—'}\nTrainer: ${filled.trainer || '—'}\nBranch: ${filled.branch || '—'}`;
        const wa = await API.sendWhatsAppMessage({
          phone, recipient_name: s.employee_name, message_type: 'hr_submission', body: msg
        }, this.app.user);
        if (wa.success && wa.data?.url) window.open(wa.data.url, '_blank');
        else Utils.openWhatsApp(phone, msg);
      }));
    },

    showFillSubmissionForm(sub, listEl, adminEdit) {
      const filled = sub.filled_data || {};
      const docs = sub.doc_paths || [];
      this._fillDocPaths = [...docs];
      const typeLabel = sub.template_type === 'probation' ? 'Probation Employment Agreement' : 'Employee Training Agreement';
      Utils.showModal(`${adminEdit ? 'Edit' : 'Professional'} ${typeLabel}`, `
        <p class="muted" style="font-size:13px">Complete all professional fields, review the full agreement, attach supporting documents, then submit to admin for approval.</p>
        <h4 style="margin:8px 0 4px">1. Employee particulars</h4>
        <div class="form-grid">
          <div class="field"><label>Full legal name *</label><input id="ff-name" value="${Utils.escHtml(filled.employee_name || sub.employee_name || '')}"></div>
          <div class="field"><label>ID / Passport number *</label><input id="ff-id" value="${Utils.escHtml(filled.id_number || '')}"></div>
          <div class="field"><label>Phone *</label><input id="ff-phone" value="${Utils.escHtml(filled.phone || '')}"></div>
          <div class="field"><label>Email</label><input id="ff-email" value="${Utils.escHtml(filled.email || '')}"></div>
          <div class="field full"><label>Residential address *</label><input id="ff-address" value="${Utils.escHtml(filled.address || '')}"></div>
          <div class="field"><label>Position / role *</label><input id="ff-position" value="${Utils.escHtml(filled.position || '')}"></div>
          <div class="field"><label>Department</label><input id="ff-dept" value="${Utils.escHtml(filled.department || '')}"></div>
          <div class="field"><label>Branch / site *</label><input id="ff-branch" value="${Utils.escHtml(filled.branch || '')}"></div>
          <div class="field"><label>Employment type</label><select id="ff-etype">
            ${['Permanent', 'Part-Time', 'Casual', 'Contract', 'Trainee'].map(t =>
              `<option ${filled.employment_type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select></div>
        </div>
        <h4 style="margin:16px 0 4px">2. Agreement period</h4>
        <div class="form-grid">
          <div class="field"><label>Start date *</label><input type="date" id="ff-start" value="${filled.start_date || Utils.today()}"></div>
          <div class="field"><label>End / review date</label><input type="date" id="ff-end" value="${filled.end_date || ''}"></div>
          <div class="field"><label>Trainer / Supervisor *</label><input id="ff-trainer" value="${Utils.escHtml(filled.trainer || this.app.user?.full_name || '')}"></div>
          <div class="field"><label>Witness name</label><input id="ff-witness" value="${Utils.escHtml(filled.witness || '')}"></div>
        </div>
        <h4 style="margin:16px 0 4px">3. Agreement terms</h4>
        <div class="field full"><label>Full agreement text (edit placeholders with real details) *</label>
          <textarea id="ff-agreement" rows="12" style="font-family:Georgia,serif;font-size:12px;line-height:1.45">${filled.completed_form || filled.template_body || ''}</textarea></div>
        <div class="field full"><label>Manager notes for admin</label><textarea id="ff-notes" rows="2">${Utils.escHtml(filled.manager_notes || '')}</textarea></div>
        <div class="field full"><label><input type="checkbox" id="ff-ack"> I confirm particulars are accurate and the employee has been briefed on these terms</label></div>
        <div style="margin-top:12px">
          <button type="button" class="btn btn-sm btn-ghost" id="ff-upload-cv">Upload CV / Document</button>
          <div id="ff-docs" class="muted" style="margin-top:8px;font-size:12px">${docs.length ? docs.map(d => d.split(/[/\\]/).pop()).join(', ') : 'No documents yet — CV required before submit'}</div>
        </div>`,
        `<button class="btn btn-primary" id="ff-submit">${adminEdit ? 'Save Changes' : 'Submit to Admin'}</button>`);
      document.getElementById('ff-upload-cv')?.addEventListener('click', async () => {
        const pick = await API.selectDocument('doc');
        if (!pick.success || !pick.path) return;
        const r = await API.attachHrSubmissionDoc(sub.id, pick.path, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        this._fillDocPaths = r.data?.doc_paths || this._fillDocPaths.concat([pick.path]);
        document.getElementById('ff-docs').textContent = this._fillDocPaths.map(d => d.split(/[/\\]/).pop()).join(', ') || 'No documents';
        Utils.toast('Document attached', 'success');
      });
      document.getElementById('ff-submit')?.addEventListener('click', async () => {
        const agreement = document.getElementById('ff-agreement').value.trim();
        const name = document.getElementById('ff-name').value.trim();
        const idNum = document.getElementById('ff-id').value.trim();
        const phone = document.getElementById('ff-phone').value.trim();
        const address = document.getElementById('ff-address').value.trim();
        const position = document.getElementById('ff-position').value.trim();
        const branch = document.getElementById('ff-branch').value.trim();
        const trainer = document.getElementById('ff-trainer').value.trim();
        if (!name || !idNum || !phone || !address || !position || !branch || !trainer) {
          return Utils.toast('Complete all required professional fields', 'error');
        }
        if (!agreement) return Utils.toast('Complete the agreement text', 'error');
        if (!adminEdit && !document.getElementById('ff-ack')?.checked) return Utils.toast('Confirm acknowledgement before submit', 'error');
        const filled_data = {
          employee_name: name,
          id_number: idNum,
          phone,
          email: document.getElementById('ff-email').value.trim(),
          address,
          position,
          department: document.getElementById('ff-dept').value.trim(),
          branch,
          employment_type: document.getElementById('ff-etype').value,
          start_date: document.getElementById('ff-start').value,
          end_date: document.getElementById('ff-end').value,
          trainer,
          witness: document.getElementById('ff-witness').value.trim(),
          manager_notes: document.getElementById('ff-notes').value.trim(),
          completed_form: agreement,
          form_version: 'professional_v1'
        };
        const r = adminEdit
          ? await API.updateHrStaffSubmission(sub.id, { filled_data }, this.app.user)
          : await API.submitHrStaffForm({ id: sub.id, require_cv: true, filled_data }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast(adminEdit ? 'Submission updated' : 'Professional form submitted to admin for approval', 'success');
        this.renderSubmissions(listEl);
      });
    },

    async renderTemplates(el) {
      const res = await API.getContractTemplates(this.app.user);
      const templates = res.data || [];
      el.innerHTML = `<button class="btn btn-primary" id="hr-new-template" style="margin:12px 0">+ New Template</button>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Position</th><th>Default</th><th></th></tr></thead>
        <tbody>${templates.map(t => `<tr><td>${t.name}</td><td>${t.position || '—'}</td>
          <td>${t.is_default ? '✓' : ''}</td>
          <td><button class="btn btn-sm btn-ghost hr-edit-tpl" data-id="${t.id}">Edit</button>
          <button class="btn btn-sm btn-danger hr-del-tpl" data-id="${t.id}">Delete</button></td></tr>`).join('')
          || '<tr><td colspan="4" class="muted">No templates</td></tr>'}</tbody></table></div>`;
      document.getElementById('hr-new-template').addEventListener('click', () => this.showTemplateForm());
      el.querySelectorAll('.hr-edit-tpl').forEach(b => b.addEventListener('click', () => {
        const t = templates.find(x => x.id == b.dataset.id);
        if (t) this.showTemplateForm(t);
      }));
      el.querySelectorAll('.hr-del-tpl').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this template?')) return;
        await API.deleteContractTemplate(parseInt(b.dataset.id, 10), this.app.user);
        this.renderTemplates(el);
      }));
    },

    async renderProbation(el) {
      const [probRes, empsRes] = await Promise.all([
        API.getProbations({}, this.app.user),
        API.getEmployees({ status: 'Active' })
      ]);
      const probations = probRes.data || [];
      const emps = empsRes.data || [];
      const isAdmin = ['owner', 'manager'].includes(this.app.user?.role);
      el.innerHTML = `<button class="btn btn-primary" id="hr-new-prob" style="margin:12px 0">+ Setup Probation</button>
        <p class="muted" style="margin-bottom:8px">Admin can edit/delete probation. Final results (pass / terminate / extend) go to the applicant WhatsApp and can be saved as PDF or printed.</p>
        <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Period</th><th>Manager</th><th>Status</th><th></th></tr></thead>
        <tbody>${probations.map(p => `<tr>
          <td><strong>${p.employee_name}</strong></td>
          <td>${p.start_date} → ${p.end_date}<br><small>${p.duration_days} days</small></td>
          <td>${p.manager_name || '—'}</td>
          <td><span class="tag">${p.status}</span></td>
          <td style="white-space:nowrap"><button class="btn btn-sm btn-ghost hr-rec-prob" data-id="${p.id}">Recommendation</button>
            <button class="btn btn-sm btn-ghost hr-pdf-prob" data-id="${p.id}">PDF</button>
            <button class="btn btn-sm btn-ghost hr-print-prob" data-id="${p.id}">Print</button>
            <button class="btn btn-sm btn-primary hr-decide-prob" data-id="${p.id}">Decision</button>
            ${isAdmin ? `<button class="btn btn-sm btn-ghost hr-edit-prob" data-id="${p.id}">Edit</button>
            <button class="btn btn-sm btn-danger hr-del-prob" data-id="${p.id}">Delete</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">No probation records</td></tr>'}
        </tbody></table></div>`;
      document.getElementById('hr-new-prob').addEventListener('click', () => this.showProbationForm(null, emps));
      el.querySelectorAll('.hr-edit-prob').forEach(b => b.addEventListener('click', () => {
        const p = probations.find(x => x.id == b.dataset.id);
        if (p) this.showProbationForm(p, emps);
      }));
      el.querySelectorAll('.hr-del-prob').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this probation record and its evaluations?')) return;
        const r = await API.deleteProbation(parseInt(b.dataset.id, 10), this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Probation deleted', 'success');
        this.renderProbation(el);
      }));
      el.querySelectorAll('.hr-rec-prob').forEach(b => b.addEventListener('click', () => this.showRecommendation(parseInt(b.dataset.id, 10))));
      el.querySelectorAll('.hr-pdf-prob').forEach(b => b.addEventListener('click', async () => {
        const buf = await API.getProbationPdf(parseInt(b.dataset.id, 10), this.app.user);
        if (buf.success) await API.saveFile(`probation-${b.dataset.id}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], buf.data);
      }));
      el.querySelectorAll('.hr-print-prob').forEach(b => b.addEventListener('click', () => {
        const p = probations.find(x => x.id == b.dataset.id);
        if (!p) return;
        Export.print(`Probation — ${p.employee_name}`, ['Field', 'Value'], [
          ['Employee', p.employee_name], ['Start', p.start_date], ['End', p.end_date],
          ['Days', String(p.duration_days)], ['Manager', p.manager_name || '—'], ['Status', p.status]
        ], Utils.companyInfo(this.admin.settings || this.app.settings));
      }));
      el.querySelectorAll('.hr-decide-prob').forEach(b => b.addEventListener('click', () => this.showFinalDecision(parseInt(b.dataset.id, 10))));
    },

    async renderEvaluations(el) {
      const [probRes, catsRes] = await Promise.all([
        API.getProbations({ status: 'active' }, this.app.user),
        API.getHrEvalCategories()
      ]);
      const probations = probRes.data || [];
      const categories = catsRes.data || [];
      const selPid = this._evalProbationId || probations[0]?.id || '';
      const filters = { probation_id: selPid || undefined, from: Utils.daysAgo(30), to: Utils.today() };
      const histRes = selPid ? await API.getProbationEvaluationHistory(filters, this.app.user) : { data: [] };
      const history = histRes.data || [];
      el.innerHTML = `<div class="form-grid" style="margin-top:12px">
        <div class="field"><label>Probation</label>
          <select id="hr-eval-prob">${probations.map(p => `<option value="${p.id}" ${p.id == selPid ? 'selected' : ''}>${p.employee_name}</option>`).join('') || '<option value="">No active probations</option>'}</select></div>
        <div class="field"><label>Evaluation Date</label><input type="date" id="hr-eval-date" value="${Utils.today()}"></div>
      </div>
      <div id="hr-eval-scores" style="margin-top:12px"></div>
      <div class="field"><label>Comments</label><textarea id="hr-eval-comments" rows="3"></textarea></div>
      <button class="btn btn-primary" id="hr-save-eval">Save Evaluation</button>
      <h4 style="margin-top:24px">Evaluation History</h4>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Score</th><th>Comments</th><th></th></tr></thead>
      <tbody>${history.map(h => `<tr><td>${h.eval_date}</td><td>${Number(h.overall_score).toFixed(2)}</td><td>${h.comments || '—'}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-sm btn-ghost hr-hist-pdf" data-id="${h.id}">PDF</button>
          <button class="btn btn-sm btn-ghost hr-hist-print" data-id="${h.id}">Print</button>
          <button class="btn btn-sm btn-ghost hr-hist-wa" data-id="${h.id}" data-eid="${h.employee_id || ''}">WhatsApp</button>
        </td></tr>`).join('')
        || '<tr><td colspan="4" class="muted">No evaluations yet</td></tr>'}</tbody></table></div>`;
      const scoresEl = document.getElementById('hr-eval-scores');
      const renderScores = () => {
        scoresEl.innerHTML = `<div class="form-grid">${categories.map(cat =>
          `<div class="field"><label>${cat} (1–5)</label><input type="number" class="hr-score" data-cat="${cat}" min="1" max="5" step="1" value="3"></div>`).join('')}</div>`;
      };
      renderScores();
      document.getElementById('hr-eval-prob')?.addEventListener('change', async () => {
        this._evalProbationId = parseInt(document.getElementById('hr-eval-prob').value, 10);
        this.renderEvaluations(el);
      });
      document.getElementById('hr-save-eval')?.addEventListener('click', async () => {
        const pid = parseInt(document.getElementById('hr-eval-prob').value, 10);
        const prob = probations.find(p => p.id === pid);
        if (!prob) return Utils.toast('Select a probation', 'error');
        const scores = {};
        document.querySelectorAll('.hr-score').forEach(inp => { scores[inp.dataset.cat] = parseInt(inp.value, 10) || 0; });
        const r = await API.saveProbationEvaluation({
          probation_id: pid, employee_id: prob.employee_id, eval_date: document.getElementById('hr-eval-date').value,
          scores, comments: document.getElementById('hr-eval-comments').value.trim()
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Could not save', 'error');
        Utils.toast('Evaluation saved', 'success');
        this.renderEvaluations(el);
      });
      el.querySelectorAll('.hr-hist-pdf').forEach(b => b.addEventListener('click', async () => {
        const buf = await API.getProbationEvalReportPdf(parseInt(b.dataset.id, 10), this.app.user);
        if (!buf.success) return Utils.toast(buf.error || 'PDF failed', 'error');
        await API.saveFile(`probation-eval-${b.dataset.id}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], buf.data);
      }));
      el.querySelectorAll('.hr-hist-print').forEach(b => b.addEventListener('click', () => {
        const h = history.find(x => x.id == b.dataset.id);
        if (!h) return;
        Export.print(`Probation Evaluation ${h.eval_date}`, ['Field', 'Value'], [
          ['Date', h.eval_date], ['Score', Number(h.overall_score).toFixed(2)], ['Comments', h.comments || '—']
        ], Utils.companyInfo(this.admin.settings || this.app.settings));
      }));
      el.querySelectorAll('.hr-hist-wa').forEach(b => b.addEventListener('click', async () => {
        const h = history.find(x => x.id == b.dataset.id);
        const eid = h?.employee_id || probations.find(p => p.id == selPid)?.employee_id;
        if (!h || !eid) return;
        const empRes = await API.getEmployee(eid);
        const phone = empRes.data?.phone;
        if (!phone) return Utils.toast('No phone on employee profile', 'error');
        const msg = `Probation evaluation ${h.eval_date}\nScore: ${Number(h.overall_score).toFixed(2)}\n${h.comments || ''}`;
        const wa = await API.sendWhatsAppMessage({
          phone, recipient_name: empRes.data?.full_name, message_type: 'probation_eval', body: msg
        }, this.app.user);
        if (wa.success && wa.data?.url) window.open(wa.data.url, '_blank');
        else Utils.openWhatsApp(phone, msg);
      }));
    },

    async renderPersonnel(el) {
      const empsRes = await API.getEmployees({ status: 'Active' });
      const emps = empsRes.data || [];
      el.innerHTML = `<div class="field" style="max-width:320px;margin-top:12px"><label>Employee</label>
        <select id="hr-pf-emp">${emps.map(e => `<option value="${e.id}">${e.full_name} (${e.employee_code})</option>`).join('')}</select></div>
        <button class="btn btn-primary" id="hr-load-pf" style="margin-top:8px">Load Digital File</button>
        <div id="hr-pf-content" style="margin-top:16px"></div>`;
      document.getElementById('hr-load-pf').addEventListener('click', async () => {
        const eid = parseInt(document.getElementById('hr-pf-emp').value, 10);
        const r = await API.getEmployeePersonnelFile(eid, this.app.user);
        const pf = r.data;
        if (!pf) return Utils.toast('Not found', 'error');
        document.getElementById('hr-pf-content').innerHTML = `
          <div class="card"><div class="card-body">
            <h4>${pf.employee.full_name}</h4>
            <p>${pf.employee.position || ''} · ${pf.employee.branch || ''} · ${pf.employee.employee_number || pf.employee.employee_code || ''}</p>
            <h5 style="margin-top:16px">Contracts (${(pf.contracts || []).length})</h5>
            ${(pf.contracts || []).map(c => `<div class="muted">${c.status} — ${Utils.formatDateTime(c.created_at)}</div>`).join('') || '<p class="muted">None</p>'}
            <h5 style="margin-top:12px">Probations (${(pf.probations || []).length})</h5>
            ${(pf.probations || []).map(p => `<div class="muted">${p.status}: ${p.start_date} – ${p.end_date}</div>`).join('') || '<p class="muted">None</p>'}
            <h5 style="margin-top:12px">HR Documents (${(pf.hr_documents || []).length})</h5>
            ${(pf.hr_documents || []).map(d => `<div class="muted">${d.document_type}: ${d.title}</div>`).join('') || '<p class="muted">None</p>'}
            <h5 style="margin-top:12px">Evaluations (${(pf.evaluations || []).length})</h5>
            ${(pf.evaluations || []).slice(0, 10).map(e => `<div class="muted">${e.eval_date}: ${Number(e.overall_score).toFixed(2)}</div>`).join('') || '<p class="muted">None</p>'}
          </div></div>`;
      });
    },

    showSignaturePad(role, contractId, onDone) {
      Utils.showModal(`Sign as ${role}`, `
        <p class="muted">Draw signature below or upload an image.</p>
        <canvas id="sig-canvas" width="480" height="120" style="border:1px solid var(--border);border-radius:8px;touch-action:none;width:100%;max-width:480px;background:#fff"></canvas>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-ghost btn-sm" id="sig-clear">Clear</button>
          <input type="file" id="sig-upload" accept="image/*" style="max-width:200px">
        </div>`,
        '<button type="button" class="btn btn-primary" id="sig-save">Save Signature</button>');
      const canvas = document.getElementById('sig-canvas');
      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      let drawing = false;
      const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        const t = e.touches ? e.touches[0] : e;
        return { x: (t.clientX - r.left) * (canvas.width / r.width), y: (t.clientY - r.top) * (canvas.height / r.height) };
      };
      const start = (e) => { drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); };
      const move = (e) => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); };
      const end = () => { drawing = false; };
      canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move);
      canvas.addEventListener('mouseup', end); canvas.addEventListener('mouseleave', end);
      canvas.addEventListener('touchstart', start, { passive: false }); canvas.addEventListener('touchmove', move, { passive: false });
      canvas.addEventListener('touchend', end);
      document.getElementById('sig-clear').addEventListener('click', () => ctx.clearRect(0, 0, canvas.width, canvas.height));
      document.getElementById('sig-upload').addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const img = new Image();
        img.onload = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
        img.src = URL.createObjectURL(file);
      });
      document.getElementById('sig-save').addEventListener('click', async () => {
        const data = canvas.toDataURL('image/png');
        const r = await API.signHrContract(contractId, role, data, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Sign failed', 'error');
        Utils.hideModal();
        Utils.toast('Signature saved', 'success');
        if (onDone) onDone(r.data);
      });
    },

    showContractBuilder(contract, emps, templates) {
      const c = contract || {};
      const data = c.contract_data || {};
      const d = data;
      const days = d.working_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
      const dayChk = (day) => days.map(x => String(x).toLowerCase()).includes(day.toLowerCase()) ? 'checked' : '';
      Utils.showModal(contract ? 'Edit Contract' : 'Contract Builder', `
        <div class="form-tabs" id="cb-tabs"><button type="button" class="form-tab active" data-cbt="fields">Fields</button>
          <button type="button" class="form-tab" data-cbt="preview">Preview</button></div>
        <div id="cb-fields-pane">
        <div class="form-grid" style="margin-top:12px">
          <div class="field"><label>Employee *</label>
            <select id="cb-emp">${emps.map(e => `<option value="${e.id}" ${(c.employee_id || data.employee_id) == e.id ? 'selected' : ''}>${e.full_name}</option>`).join('')}</select></div>
          <div class="field"><label>Template</label>
            <select id="cb-tpl"><option value="">— Custom —</option>${templates.map(t => `<option value="${t.id}" ${c.template_id == t.id ? 'selected' : ''}>${t.name}</option>`).join('')}</select></div>
          <div class="field"><label>Full Name</label><input id="cb-name" value="${d.employee_name || ''}"></div>
          <div class="field"><label>ID/Passport</label><input id="cb-id" value="${d.id_number || ''}"></div>
          <div class="field"><label>Employee Number</label><input id="cb-enum" value="${d.employee_number || ''}"></div>
          <div class="field"><label>Phone</label><input id="cb-phone" value="${d.phone || ''}"></div>
          <div class="field"><label>Email</label><input id="cb-email" value="${d.email || ''}"></div>
          <div class="field full"><label>Residential Address</label><input id="cb-address" value="${d.address || ''}"></div>
          <div class="field"><label>Position</label><input id="cb-position" value="${d.position || ''}"></div>
          <div class="field"><label>Department</label><input id="cb-dept" value="${d.department || ''}"></div>
          <div class="field"><label>Branch</label><input id="cb-branch" value="${d.branch || ''}"></div>
          <div class="field"><label>Reports To</label><input id="cb-reports" value="${d.reports_to || ''}"></div>
          <div class="field"><label>Employment Type</label>
            <select id="cb-etype"><option>Permanent</option><option>Fixed-Term</option><option>Temporary</option><option>Casual</option><option>Part-Time</option></select></div>
          <div class="field"><label>Start Date</label><input type="date" id="cb-start" value="${d.start_date || Utils.today()}"></div>
          <div class="field"><label>End Date (if fixed-term)</label><input type="date" id="cb-end" value="${d.end_date || ''}"></div>
          <div class="field"><label>Probation Period</label>
            <select id="cb-prob"><option>Two Weeks</option><option>One Month</option><option>Two Months</option><option selected>Three Months</option><option>Other</option></select></div>
          <div class="field"><label>Shift Start</label><input id="cb-shift-start" value="${d.shift_start || '08:00'}"></div>
          <div class="field"><label>Shift End</label><input id="cb-shift-end" value="${d.shift_end || '17:00'}"></div>
          <div class="field"><label>Break (minutes)</label><input type="number" id="cb-break" value="${d.break_minutes || 30}"></div>
          <div class="field full"><label>Working Days</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px">${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day =>
              `<label><input type="checkbox" class="cb-day" value="${day}" ${dayChk(day)}> ${day.slice(0,3)}</label>`).join('')}</div></div>
          <div class="field"><label>Salary Type</label>
            <select id="cb-stype"><option>Monthly</option><option>Weekly</option><option>Daily</option><option>Hourly</option></select></div>
          <div class="field"><label>Salary (${this.admin.settings?.currency || 'R'})</label><input type="number" id="cb-salary" step="0.01" value="${d.basic_salary || 0}"></div>
          <div class="field"><label>Payment Method</label>
            <select id="cb-paymeth"><option>Bank Transfer</option><option>Cash</option><option>Other</option></select></div>
          <div class="field"><label>Payment Date</label><input id="cb-paydate" value="${d.payment_date || '25th of each month'}"></div>
          <div class="field full"><label>Additional Clauses</label>
            <textarea id="cb-clauses" rows="3" placeholder="One clause per line">${(d.clauses || []).map(x => typeof x === 'string' ? x : x.text || '').join('\n')}</textarea></div>
        </div></div>
        <div id="cb-preview-pane" class="hidden" style="margin-top:12px;max-height:420px;overflow:auto;border:1px solid var(--border);padding:12px;border-radius:8px;background:#fff;color:#111;font-size:13px;white-space:pre-wrap"></div>
        ${contract ? `<div style="margin-top:12px"><strong>Signatures</strong>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
            ${['employee', 'manager', 'admin', 'witness'].map(r => `<button type="button" class="btn btn-sm btn-ghost cb-sign" data-role="${r}">Sign: ${r}</button>`).join('')}
          </div></div>` : ''}`,
        '<button type="button" class="btn btn-primary" id="cb-save">Save Contract</button><button type="button" class="btn btn-ghost" id="cb-populate">Auto-fill from Employee</button>');
      document.getElementById('cb-etype').value = d.employment_type || 'Permanent';
      document.getElementById('cb-prob').value = d.probation_period || 'Three Months';
      document.getElementById('cb-stype').value = d.salary_type || 'Monthly';
      document.getElementById('cb-paymeth').value = d.payment_method || 'Bank Transfer';
      const collectData = () => {
        const workingDays = [...document.querySelectorAll('.cb-day:checked')].map(x => x.value);
        const clauseLines = document.getElementById('cb-clauses').value.split('\n').map(s => s.trim()).filter(Boolean);
        return {
          ...data,
          employee_id: parseInt(document.getElementById('cb-emp').value, 10),
          employee_name: document.getElementById('cb-name').value.trim(),
          id_number: document.getElementById('cb-id').value.trim(),
          employee_number: document.getElementById('cb-enum').value.trim(),
          phone: document.getElementById('cb-phone').value.trim(),
          email: document.getElementById('cb-email').value.trim(),
          address: document.getElementById('cb-address').value.trim(),
          position: document.getElementById('cb-position').value.trim(),
          department: document.getElementById('cb-dept').value.trim(),
          branch: document.getElementById('cb-branch').value.trim(),
          reports_to: document.getElementById('cb-reports').value.trim(),
          employment_type: document.getElementById('cb-etype').value,
          start_date: document.getElementById('cb-start').value,
          end_date: document.getElementById('cb-end').value,
          probation_period: document.getElementById('cb-prob').value,
          shift_start: document.getElementById('cb-shift-start').value.trim(),
          shift_end: document.getElementById('cb-shift-end').value.trim(),
          break_minutes: document.getElementById('cb-break').value,
          working_days: workingDays,
          salary_type: document.getElementById('cb-stype').value,
          basic_salary: parseFloat(document.getElementById('cb-salary').value) || 0,
          salary_amount: parseFloat(document.getElementById('cb-salary').value) || 0,
          payment_method: document.getElementById('cb-paymeth').value,
          payment_date: document.getElementById('cb-paydate').value.trim(),
          clauses: clauseLines,
          custom_clauses: clauseLines.map((t, i) => `\n### Additional Clause ${i + 1}\n${t}`).join('\n'),
          currency: this.admin.settings?.currency || 'R',
          business_name: this.admin.settings?.shop_name || 'Chisanyama Connection'
        };
      };
      const refreshPreview = async () => {
        const cd = collectData();
        const tplId = document.getElementById('cb-tpl').value;
        const tpl = templates.find(t => t.id == tplId);
        cd.body_template = tpl?.body_template || cd.body_template;
        const r = await API.fillHrContractBody(cd, this.app.user);
        document.getElementById('cb-preview-pane').textContent = r.success === false ? (r.error || 'Preview failed') : (r.data || '');
      };
      document.querySelectorAll('#cb-tabs [data-cbt]').forEach(btn => btn.addEventListener('click', async () => {
        document.querySelectorAll('#cb-tabs .form-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        const isPreview = btn.dataset.cbt === 'preview';
        document.getElementById('cb-fields-pane').classList.toggle('hidden', isPreview);
        document.getElementById('cb-preview-pane').classList.toggle('hidden', !isPreview);
        if (isPreview) await refreshPreview();
      }));
      document.getElementById('cb-populate').addEventListener('click', async () => {
        const eid = parseInt(document.getElementById('cb-emp').value, 10);
        const tid = document.getElementById('cb-tpl').value ? parseInt(document.getElementById('cb-tpl').value, 10) : null;
        const r = await API.populateHrContract(eid, tid, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        const d2 = r.data;
        document.getElementById('cb-name').value = d2.employee_name || '';
        document.getElementById('cb-id').value = d2.id_number || '';
        document.getElementById('cb-enum').value = d2.employee_number || '';
        document.getElementById('cb-phone').value = d2.phone || '';
        document.getElementById('cb-email').value = d2.email || '';
        document.getElementById('cb-address').value = d2.address || '';
        document.getElementById('cb-position').value = d2.position || '';
        document.getElementById('cb-dept').value = d2.department || '';
        document.getElementById('cb-branch').value = d2.branch || '';
        document.getElementById('cb-reports').value = d2.reports_to || '';
        document.getElementById('cb-etype').value = d2.employment_type || 'Permanent';
        document.getElementById('cb-start').value = d2.start_date || Utils.today();
        document.getElementById('cb-salary').value = d2.basic_salary || 0;
        document.getElementById('cb-shift-start').value = d2.shift_start || '08:00';
        document.getElementById('cb-shift-end').value = d2.shift_end || '17:00';
        document.getElementById('cb-break').value = d2.break_minutes || 30;
        document.getElementById('cb-stype').value = d2.salary_type || 'Monthly';
        document.getElementById('cb-paymeth').value = d2.payment_method || 'Bank Transfer';
        document.getElementById('cb-paydate').value = d2.payment_date || '';
        document.getElementById('cb-prob').value = d2.probation_period || 'Three Months';
        Utils.toast('Fields populated from employee', 'success');
      });
      document.querySelectorAll('.cb-sign').forEach(b => b.addEventListener('click', () => {
        this.showSignaturePad(b.dataset.role, contract.id, () => this.render(document.getElementById('admin-content'), this.admin));
      }));
      document.getElementById('cb-save').addEventListener('click', async () => {
        const contractData = collectData();
        const tplId = document.getElementById('cb-tpl').value ? parseInt(document.getElementById('cb-tpl').value, 10) : null;
        const tpl = templates.find(t => t.id == tplId);
        contractData.body_template = tpl?.body_template || contractData.body_template;
        const fill = await API.fillHrContractBody(contractData, this.app.user);
        if (fill.data) contractData.filled_body = fill.data;
        const r = await API.saveHrContract({
          id: c.id, employee_id: contractData.employee_id,
          template_id: tplId,
          contract_data: contractData, status: c.status || 'draft'
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Save failed', 'error');
        Utils.hideModal();
        Utils.toast('Contract saved', 'success');
        this.tab = 'contracts';
        this.render(document.getElementById('admin-content'), this.admin);
      });
    },

    showTemplateForm(tpl) {
      const body = tpl?.body_template || '';
      const clauses = tpl ? (JSON.parse(tpl.clauses_json || '[]')).map(c => typeof c === 'string' ? c : c.text || c.title || '').join('\n') : '';
      const LOADING_PLACEHOLDER = '';
      Utils.showModal(tpl ? 'Edit Template' : 'New Template', `
        <div class="form-grid">
          <div class="field"><label>Name *</label><input id="tpl-name" value="${tpl?.name || 'Chisanyama Connection Employment Contract'}"></div>
          <div class="field"><label>Position</label><input id="tpl-position" value="${tpl?.position || ''}"></div>
          <div class="field full"><label><input type="checkbox" id="tpl-default" ${tpl?.is_default || !tpl ? 'checked' : ''}> Default template</label></div>
          <div class="field full"><label>Contract Body <span class="muted">({{employee_name}}, {{id_number}}, {{position}}, {{branch}}, {{start_date}}, {{currency}}{{salary_amount}}, etc.)</span></label>
            <textarea id="tpl-body" rows="18" style="font-family:monospace;font-size:12px" placeholder="Click Load Chisanyama Default or paste contract text…">${body || LOADING_PLACEHOLDER}</textarea></div>
          <div class="field full"><label>Extra Clauses (one per line)</label><textarea id="tpl-clauses" rows="4">${clauses}</textarea></div>
        </div>`,
        '<button type="button" class="btn btn-primary" id="tpl-save">Save Template</button><button type="button" class="btn btn-ghost" id="tpl-load-default">Load Chisanyama Default</button>');
      const fillDefaultIfEmpty = (text) => {
        const el = document.getElementById('tpl-body');
        if (!el || !text) return;
        const cur = el.value.trim();
        if (!cur || cur === 'Loading default template…') el.value = text;
      };
      API.getContractTemplates(this.app.user).then(r => {
        const def = (r.data || []).find(t => t.is_default) || (r.data || [])[0];
        if (!tpl?.body_template && def?.body_template) fillDefaultIfEmpty(def.body_template);
      });
      document.getElementById('tpl-load-default').addEventListener('click', async () => {
        const r = await API.getContractTemplates(this.app.user);
        const def = (r.data || []).find(t => t.is_default) || (r.data || [])[0];
        if (def?.body_template) document.getElementById('tpl-body').value = def.body_template;
        else Utils.toast('Restart the app once to seed the default template', 'info');
      });
      if (tpl?.body_template) document.getElementById('tpl-body').value = tpl.body_template;
      document.getElementById('tpl-save').addEventListener('click', async () => {
        const name = document.getElementById('tpl-name').value.trim();
        if (!name) return Utils.toast('Name required', 'error');
        const bodyText = document.getElementById('tpl-body').value.trim();
        if (!bodyText || bodyText === 'Loading default template…') {
          return Utils.toast('Contract body is required — load the Chisanyama default or paste text', 'error');
        }
        const clauseLines = document.getElementById('tpl-clauses').value.split('\n').map(s => s.trim()).filter(Boolean);
        const r = await API.saveContractTemplate({
          id: tpl?.id, name, position: document.getElementById('tpl-position').value.trim(),
          body_template: bodyText,
          clauses: clauseLines, is_default: document.getElementById('tpl-default').checked
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast('Template saved', 'success');
        this.tab = 'contract-templates';
        this.render(document.getElementById('admin-content'), this.admin);
      });
    },

    showProbationForm(prob, emps, preSelectedEmployeeId) {
      const selEmp = prob?.employee_id || preSelectedEmployeeId;
      Utils.showModal(prob ? 'Edit Probation' : 'Setup Probation', `
        <div class="form-grid">
          <div class="field"><label>Employee *</label>
            <select id="pb-emp">${emps.map(e => `<option value="${e.id}" ${selEmp == e.id ? 'selected' : ''}>${e.full_name}</option>`).join('')}</select></div>
          <div class="field"><label>Manager</label>
            <select id="pb-mgr"><option value="">—</option>${emps.map(e => `<option value="${e.id}" ${prob?.manager_id == e.id ? 'selected' : ''}>${e.full_name}</option>`).join('')}</select></div>
          <div class="field"><label>Start Date</label><input type="date" id="pb-start" value="${prob?.start_date || Utils.today()}"></div>
          <div class="field"><label>Duration (days)</label><input type="number" id="pb-days" value="${prob?.duration_days || 90}" min="1"></div>
          ${prob ? `<div class="field"><label>Status</label><select id="pb-status">
            ${['active', 'confirmed', 'extended', 'terminated'].map(s => `<option value="${s}" ${prob.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select></div>` : ''}
        </div>`,
        '<button type="button" class="btn btn-primary" id="pb-save">Save Probation</button>');
      document.getElementById('pb-save').addEventListener('click', async () => {
        const days = parseInt(document.getElementById('pb-days').value, 10) || 90;
        const start = document.getElementById('pb-start').value;
        const end = new Date(start + 'T12:00:00'); end.setDate(end.getDate() + days);
        const r = await API.saveProbation({
          id: prob?.id,
          employee_id: parseInt(document.getElementById('pb-emp').value, 10),
          manager_id: document.getElementById('pb-mgr').value ? parseInt(document.getElementById('pb-mgr').value, 10) : null,
          start_date: start, duration_days: days, end_date: end.toLocaleDateString('en-CA'),
          status: document.getElementById('pb-status')?.value || prob?.status || 'active'
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast('Probation saved', 'success');
        this.tab = 'probation';
        this.render(document.getElementById('admin-content'), this.admin);
      });
    },

    async showRecommendation(probationId) {
      const r = await API.getProbationRecommendation(probationId, this.app.user);
      const rec = r.data;
      if (!rec) return Utils.toast('Not found', 'error');
      Utils.showModal('Probation Recommendation', `
        <p><strong>Recommendation:</strong> <span class="tag">${rec.recommendation.toUpperCase()}</span></p>
        <p>Average score: <strong>${rec.avg_overall_score}</strong> · Work quality: <strong>${rec.avg_work_quality}</strong></p>
        <p>Attendance: <strong>${rec.attendance.pct}%</strong> · Late: ${rec.attendance.late} · Absences: ${rec.attendance.absences}</p>
        <p>Evaluations: ${rec.evaluation_count} · Missed (recent): ${rec.missed_evaluations.length}</p>
        <ul>${Object.entries(rec.checks).map(([k, v]) => `<li>${k.replace(/_/g, ' ')}: ${v ? '✓ Pass' : '✗ Fail'}</li>`).join('')}</ul>`,
        '<button type="button" class="btn btn-primary" id="rec-close">Close</button>');
      document.getElementById('rec-close').addEventListener('click', Utils.hideModal);
    },

    showFinalDecision(probationId) {
      Utils.showModal('Final Probation Decision', `
        <div class="field"><label>Decision</label>
          <select id="fd-decision"><option value="confirm">Confirm employment</option>
            <option value="extend">Extend probation</option><option value="terminate">Terminate</option></select></div>
        <div class="field" id="fd-extend-wrap" style="display:none"><label>Extend by (days)</label><input type="number" id="fd-extend" value="30"></div>
        <div class="field"><label>Reason / Notes</label><textarea id="fd-reason" rows="3"></textarea></div>`,
        '<button type="button" class="btn btn-primary" id="fd-save">Record Decision</button>');
      document.getElementById('fd-decision').addEventListener('change', (e) => {
        document.getElementById('fd-extend-wrap').style.display = e.target.value === 'extend' ? '' : 'none';
      });
      document.getElementById('fd-save').addEventListener('click', async () => {
        const decision = document.getElementById('fd-decision').value;
        const reason = document.getElementById('fd-reason').value.trim();
        const r = await API.finalProbationDecision(probationId, decision, reason,
          parseInt(document.getElementById('fd-extend').value, 10) || 30, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast('Decision recorded' + (decision === 'confirm' ? ' — contract draft created' : ''), 'success');
        const buf = await API.getProbationLetterPdf(probationId, decision, this.app.user);
        if (buf.success) {
          await API.saveFile(`probation-letter-${probationId}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], buf.data);
        }
        try {
          const probRes = await API.getProbation(probationId, this.app.user);
          const empId = probRes.data?.employee_id;
          const empRes = empId ? await API.getEmployee(empId) : null;
          const phone = empRes?.data?.phone;
          const label = decision === 'confirm' ? 'PASSED / CONFIRMED' : decision === 'extend' ? 'EXTENDED' : 'TERMINATED';
          const msg = `Probation result — ${empRes?.data?.full_name || ''}\nOutcome: ${label}\n${reason ? `Notes: ${reason}\n` : ''}Please collect your letter from HR.`;
          if (phone) {
            const wa = await API.sendWhatsAppMessage({
              phone, recipient_name: empRes.data.full_name, message_type: 'probation_result', body: msg
            }, this.app.user);
            if (wa.success && wa.data?.url) window.open(wa.data.url, '_blank');
            else Utils.openWhatsApp(phone, msg);
          }
          Export.print(`Probation Decision — ${empRes?.data?.full_name || probationId}`,
            ['Field', 'Value'],
            [['Outcome', label], ['Reason', reason || '—']],
            Utils.companyInfo(this.admin.settings || this.app.settings));
        } catch (_) { /* ignore share errors */ }
        this.render(document.getElementById('admin-content'), this.admin);
      });
    }
  };

  window.AdminHrPage = AdminHrPage;
})();

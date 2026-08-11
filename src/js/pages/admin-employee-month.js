// Admin — Employee of the Month
(function () {
  if (!window.AdminPage) return;

  AdminPage.sections.splice(6, 0, { id: 'employee-of-month', label: '🏆 Employee of Month', icon: 'employee-of-month' });
  if (AdminPage.sections.filter(s => s.id === 'employee-of-month').length > 1) {
    AdminPage.sections = AdminPage.sections.filter((s, i, arr) =>
      s.id !== 'employee-of-month' || arr.findIndex(x => x.id === 'employee-of-month') === i);
  }

  const AdminEmployeeMonthPage = {
    monthYear: null,
    tab: 'award',
    historyFrom: null,
    historyTo: null,

    currentMonthYear() {
      return new Date().toLocaleDateString('en-CA').slice(0, 7);
    },

    async previewPhoto(path) {
      const preview = document.getElementById('eom-photo-preview');
      if (!preview) return;
      if (!path?.trim()) {
        preview.innerHTML = '<p class="muted">No photo selected — employee profile photo will be used if available</p>';
        return;
      }
      const r = await API.getImageDataUrl(path.trim());
      const url = r?.dataUrl || r?.data;
      if (r?.success && url) {
        preview.innerHTML = `<img src="${url}" alt="Winner photo" style="max-width:160px;max-height:160px;border-radius:8px;border:1px solid var(--border)">`;
      } else {
        preview.innerHTML = '<p class="muted">Could not preview photo</p>';
      }
    },

    async renderHistory(el) {
      const from = this.historyFrom || '';
      const to = this.historyTo || '';
      const histRes = await API.getEmployeeOfMonthHistory({ from: from || undefined, to: to || undefined }, this.app.user);
      const records = histRes.data || [];
      const currency = this.admin.settings?.currency || 'R';

      el.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
          <div class="field"><label>From month</label><input type="month" id="eom-hist-from" value="${from}"></div>
          <div class="field"><label>To month</label><input type="month" id="eom-hist-to" value="${to}"></div>
          <button class="btn btn-primary btn-sm" id="eom-hist-filter">Filter</button>
        </div>
        <div class="table-wrap"><table class="table-compact">
          <thead><tr><th>Month</th><th>Employee</th><th>Score</th><th>Bonus</th><th>Phone</th><th></th></tr></thead>
          <tbody>${records.map(r => `<tr>
            <td>${r.month_year}</td>
            <td>${r.full_name}</td>
            <td>${r.score ?? '—'}</td>
            <td>${r.bonus_amount ? Utils.formatMoney(r.bonus_amount, currency) : '—'}</td>
            <td>${r.phone || '—'}</td>
            <td style="white-space:nowrap">
              ${r.certificate_path ? `<button class="btn btn-sm btn-ghost eom-hist-pdf" data-my="${r.month_year}">PDF</button>
                <button class="btn btn-sm btn-ghost eom-hist-print" data-my="${r.month_year}">Print</button>` : ''}
              <button class="btn btn-sm btn-success eom-hist-wa" data-my="${r.month_year}" ${!r.phone ? 'disabled title="No phone on file"' : ''}>WhatsApp</button>
              <button class="btn btn-sm btn-danger eom-hist-del" data-id="${r.id}" data-name="${Utils.escHtml(r.full_name)}" data-my="${r.month_year}">Delete</button>
            </td></tr>`).join('')
            || '<tr><td colspan="6" class="muted">No awards yet</td></tr>'}
          </tbody>
        </table></div>`;

      document.getElementById('eom-hist-filter')?.addEventListener('click', () => {
        this.historyFrom = document.getElementById('eom-hist-from').value;
        this.historyTo = document.getElementById('eom-hist-to').value;
        this.renderHistory(el);
      });

      const openCert = async (monthYear) => {
        let path = records.find(x => x.month_year === monthYear)?.certificate_path;
        if (!path) {
          const gen = await API.generateEmployeeOfMonthCertificate(monthYear, this.app.user);
          if (!gen.success) return Utils.toast(gen.error, 'error');
          path = gen.data;
        }
        await API.openPath(path);
      };

      el.querySelectorAll('.eom-hist-pdf').forEach(b => b.addEventListener('click', () => openCert(b.dataset.my)));
      el.querySelectorAll('.eom-hist-print').forEach(b => b.addEventListener('click', () => openCert(b.dataset.my)));
      el.querySelectorAll('.eom-hist-wa').forEach(b => b.addEventListener('click', async () => {
        const r = await API.notifyEmployeeOfMonthWhatsApp(b.dataset.my, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        if (r.data?.url) window.open(r.data.url, '_blank');
        Utils.toast('WhatsApp prepared for employee', 'success');
      }));
      el.querySelectorAll('.eom-hist-del').forEach(b => b.addEventListener('click', async () => {
        if (!confirm(`Delete Employee of Month award for ${b.dataset.name} (${b.dataset.my})?`)) return;
        const r = await API.deleteEmployeeOfMonth(parseInt(b.dataset.id, 10), this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Award deleted', 'success');
        this.renderHistory(el);
      }));
    },

    async renderAward(el, admin, contentEl) {
      const currency = admin.settings?.currency || 'R';
      const [scoresRes, recordRes, empRes] = await Promise.all([
        API.getEmployeeOfMonthScores(this.monthYear, this.app.user),
        API.getEmployeeOfMonthRecord(this.monthYear, this.app.user),
        API.getEmployees({ status: 'Active' })
      ]);
      if (!scoresRes.success && !empRes.success) {
        contentEl.innerHTML = `<p class="muted" style="color:var(--danger)">${scoresRes.error || empRes.error || 'Could not load employee scores'}</p>`;
        return;
      }
      const scores = scoresRes.data?.scores || scoresRes.data || [];
      const suggested = scoresRes.data?.suggested || scores[0];
      const record = recordRes.data;
      const employees = empRes.data || [];
      const selectedId = record?.employee_id || suggested?.employee_id;
      const selectedEmp = employees.find(e => e.id == selectedId);

      contentEl.innerHTML = `
        ${suggested ? `<div class="card" style="margin-bottom:16px;border:2px solid var(--primary);background:var(--surface-alt, rgba(99,102,241,0.06))">
          <div class="card-body" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <div style="font-size:28px">🏆</div>
            <div style="flex:1;min-width:200px">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:var(--primary);font-weight:600">System Selected Winner</div>
              <div style="font-size:22px;font-weight:700;margin-top:4px">${suggested.full_name}</div>
              <div class="muted" style="margin-top:4px">Score ${suggested.total_score ?? '—'} · sales ${suggested.sales_score ?? '—'} · shifts ${suggested.shift_score ?? '—'} · checklist ${suggested.checklist_score ?? '—'} · attendance ${suggested.attendance_score ?? '—'}</div>
            </div>
          </div></div>` : ''}
        <div class="card" style="margin-bottom:16px"><div class="card-header"><h4>Scores</h4></div>
        <div class="table-wrap"><table class="table-compact"><thead><tr><th>Employee</th><th>Sales</th><th>Shifts</th><th>Checklist</th><th>Att.</th><th>Total</th></tr></thead>
        <tbody>${scores.map(s => `<tr${s.employee_id == selectedId ? ' style="background:var(--surface-alt, rgba(99,102,241,0.06))"' : ''}>
          <td>${s.full_name}</td><td>${s.sales_score ?? '—'}</td><td>${s.shift_score ?? '—'}</td>
          <td>${s.checklist_score ?? '—'}</td><td>${s.attendance_score ?? '—'}</td><td><strong>${s.total_score ?? '—'}</strong></td></tr>`).join('')
          || '<tr><td colspan="6" class="muted">No active employees</td></tr>'}
        </tbody></table></div></div>
        <div class="card"><div class="card-body"><h4>Confirm Winner</h4>
        <div class="form-grid">
          <div class="field"><label>Employee *</label>
            <select id="eom-employee">${employees.map(e =>
              `<option value="${e.id}" ${selectedId == e.id ? 'selected' : ''}>${e.full_name}${e.phone ? ` (${e.phone})` : ''}</option>`).join('')}
            </select></div>
          <div class="field"><label>Score</label><input type="number" id="eom-score" step="0.1" value="${record?.score ?? suggested?.total_score ?? ''}"></div>
          <div class="field"><label>Bonus (${currency}) — next month's salary only</label><input type="number" id="eom-bonus" step="0.01" value="${record?.bonus_amount ?? ''}"></div>
          <div class="field"><label>Show on Staff Portal until</label><input type="date" id="eom-until" value="${record?.display_until || ''}"></div>
          <div class="field full"><label><input type="checkbox" id="eom-active" ${record?.is_active !== 0 ? 'checked' : ''}> Active (on = show on staff portal; off = hidden)</label></div>
          <div class="field full"><label><input type="checkbox" id="eom-auto" ${admin.settings?.eom_settings?.auto_select !== false ? 'checked' : ''}> Auto-select another employee when display ends</label></div>
          <div class="field full"><label>Winner photo</label>
            <div id="eom-photo-preview" style="margin-bottom:8px"></div>
            <input id="eom-photo" value="${record?.photo_path || ''}" placeholder="EOM upload — or uses employee profile photo">
            <button type="button" class="btn btn-sm btn-ghost" id="eom-pick-photo" style="margin-top:6px">Choose Photo</button>
            ${selectedEmp?.photo_path && !record?.photo_path ? `<p class="muted" style="font-size:12px;margin-top:4px">Profile photo on file for selected employee</p>` : ''}
          </div>
          <div class="field full"><label>Notes</label><textarea id="eom-notes" rows="2">${record?.notes || ''}</textarea></div>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" id="eom-save">Confirm &amp; Award</button>
          <button class="btn btn-success" id="eom-whatsapp">Send to Staff WhatsApp</button>
          ${record?.certificate_path ? `<button class="btn btn-ghost" id="eom-open-cert">Open Certificate</button>` : ''}
        </div>
        ${record?.certificate_path ? `<p class="muted" style="margin-top:8px">Certificate ready · staff portal notification posted</p>` : ''}
        </div></div>`;

      const initialPhoto = record?.photo_path || selectedEmp?.photo_path || '';
      await this.previewPhoto(initialPhoto);

      document.getElementById('eom-employee')?.addEventListener('change', async (e) => {
        const emp = employees.find(x => x.id == e.target.value);
        const photoInput = document.getElementById('eom-photo');
        if (!photoInput.value.trim() && emp?.photo_path) await this.previewPhoto(emp.photo_path);
      });
      document.getElementById('eom-photo')?.addEventListener('input', (e) => this.previewPhoto(e.target.value));
      document.getElementById('eom-pick-photo')?.addEventListener('click', async () => {
        const pick = await API.selectDocument('doc');
        if (pick.success && pick.path) {
          document.getElementById('eom-photo').value = pick.path;
          await this.previewPhoto(pick.path);
        }
      });

      document.getElementById('eom-save')?.addEventListener('click', async () => {
        const autoSelect = document.getElementById('eom-auto')?.checked !== false;
        await API.saveJsonSetting('eom_settings', { auto_select: autoSelect }, this.app.user);
        if (admin.settings) admin.settings.eom_settings = { auto_select: autoSelect };
        const r = await API.saveEmployeeOfMonth({
          month_year: this.monthYear,
          employee_id: parseInt(document.getElementById('eom-employee').value, 10),
          score: parseFloat(document.getElementById('eom-score').value) || 0,
          bonus_amount: parseFloat(document.getElementById('eom-bonus').value) || 0,
          display_until: document.getElementById('eom-until')?.value || null,
          is_active: document.getElementById('eom-active')?.checked ? 1 : 0,
          photo_path: document.getElementById('eom-photo').value.trim() || null,
          notes: document.getElementById('eom-notes').value.trim()
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Winner saved — bonus on next month payroll; portal shows until end date if active', 'success');
        this.render(el, admin);
      });

      document.getElementById('eom-whatsapp')?.addEventListener('click', async () => {
        const r = await API.notifyEmployeeOfMonthWhatsApp(this.monthYear, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        if (r.data?.url) window.open(r.data.url, '_blank');
        Utils.toast('WhatsApp prepared — send to employee phone', 'success');
      });

      document.getElementById('eom-open-cert')?.addEventListener('click', async () => {
        const path = record?.certificate_path;
        if (path) await API.openPath(path);
      });
    },

    async render(el, admin) {
      this.admin = admin;
      this.app = admin.app;
      this.monthYear = this.monthYear || this.currentMonthYear();
      this.tab = this.tab || 'award';

      el.innerHTML = `<div class="admin-section"><h3>Employee of the Month</h3>
        <p class="muted">Confirm the winner, set an end date for Staff Portal display, toggle active on/off, and apply a one-time bonus to the <strong>next month's</strong> salary only. When the end date passes, the portal stops showing them and can auto-select the next top scorer.</p>
        <div class="form-tabs" id="eom-tabs">
          <button type="button" class="form-tab ${this.tab === 'award' ? 'active' : ''}" data-tab="award">Current Award</button>
          <button type="button" class="form-tab ${this.tab === 'history' ? 'active' : ''}" data-tab="history">History</button>
        </div>
        <div id="eom-tab-panel"></div></div>`;

      document.getElementById('eom-tabs')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab]');
        if (!btn) return;
        this.tab = btn.dataset.tab;
        this.render(el, admin);
      });

      const panel = document.getElementById('eom-tab-panel');
      if (this.tab === 'history') {
        panel.innerHTML = Utils.pageSkeleton(4);
        return this.renderHistory(panel);
      }

      panel.innerHTML = `<div class="form-grid" style="margin:12px 0;max-width:360px">
        <div class="field"><label>Month</label><input type="month" id="eom-month" value="${this.monthYear}"></div>
      </div>
      <div id="eom-content">${Utils.pageSkeleton(6)}</div>`;

      document.getElementById('eom-month')?.addEventListener('change', (e) => {
        this.monthYear = e.target.value;
        this.render(el, admin);
      });

      try {
        await this.renderAward(el, admin, document.getElementById('eom-content'));
      } catch (err) {
        console.error('Employee of month render failed:', err);
        const content = document.getElementById('eom-content');
        if (content) content.innerHTML = `<p class="muted" style="color:var(--danger)">${err.message || 'Could not load Employee of the Month'}</p>`;
      }
    }
  };

  window.AdminEmployeeMonthPage = AdminEmployeeMonthPage;
})();

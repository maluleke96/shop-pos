const OperationsPage = {
  tab: 'cashup',

  async render(el, app) {
    this.app = app;
    if (this.tab === 'opening' || this.tab === 'closing') this.tab = 'cashup';
    el.innerHTML = `<div class="page-toolbar"><h3>Operations</h3></div>
      <div class="admin-tabs">
        <button class="admin-tab ${this.tab==='cashup'?'active':''}" data-tab="cashup">Cash-Up</button>
        <button class="admin-tab ${this.tab==='stockcount'?'active':''}" data-tab="stockcount">Stock Count</button>
        <button class="admin-tab ${this.tab==='waste'?'active':''}" data-tab="waste">Waste / Damaged</button>
      </div>
      <p class="muted" style="margin:8px 0 0">Morning and closing routines are completed in the Staff Portal. Approve cash-outs below.</p>
      <div id="ops-content"></div>`;

    el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
      this.tab = b.dataset.tab;
      this.render(el, app);
    }));
    await this.renderTab(document.getElementById('ops-content'));
  },

  async renderTab(el) {
    if (this.tab === 'cashup') return this.renderCashUp(el);
    if (this.tab === 'stockcount') return this.renderStockCount(el);
    if (this.tab === 'waste') return this.renderWaste(el);
    return this.renderCashUp(el);
  },

  async afterStockCountRender() {
    if (this.pendingOpenId) {
      const id = this.pendingOpenId;
      this.pendingOpenId = null;
      await this.openCount(id);
    }
  },

  async resolveChecklistEmployeeId() {
    const empsRes = await API.getEmployees({ status: 'Active' });
    const linked = (empsRes.data || []).find(e => e.user_id === this.app.user?.id);
    return linked ? parseInt(linked.id, 10) : null;
  },

  async renderDailyRoutine(el, type) {
    const label = type === 'opening' ? 'Morning Opening Routine' : 'Closing Routine';
    const [runsRes, settingsRes, empsRes] = await Promise.all([
      API.getChecklistRuns({ run_type: type, run_date: Utils.today() }),
      API.getChecklistSettings(),
      API.getEmployees({ status: 'Active' })
    ]);
    const deadlines = settingsRes.data || {};
    const deadline = type === 'opening' ? (deadlines.morning_deadline || '11:00') : (deadlines.closing_deadline || '22:00');
    const runs = (runsRes.data || []).filter(r => r.status !== 'cancelled');
    const linkedEmpId = (empsRes.data || []).find(e => e.user_id === this.app.user?.id)?.id;
    this._opsChecklistEmpId = this._opsChecklistEmpId ?? (linkedEmpId ? parseInt(linkedEmpId, 10) : null);
    let activeRun = this._routineRun?.run_type === type && this._routineRun?.run_date === Utils.today() ? this._routineRun : null;
    if (!activeRun && this._opsChecklistEmpId) {
      const mine = runs.find(r => r.employee_id === this._opsChecklistEmpId && r.status === 'in_progress');
      if (mine) {
        const r = await API.getChecklistRun(mine.id);
        if (r.success) activeRun = r.data;
      }
    }
    if (!activeRun && runs.length === 1) {
      const r = await API.getChecklistRun(runs[0].id);
      if (r.success) activeRun = r.data;
    }
    const emps = empsRes.data || [];
    const empPicker = emps.length && !linkedEmpId ? `<div class="field" style="max-width:280px;margin-bottom:12px"><label>Worker checklist for</label>
      <select id="ops-chk-emp"><option value="">General / unassigned tasks</option>
      ${emps.map(e => `<option value="${e.id}" ${this._opsChecklistEmpId == e.id ? 'selected' : ''}>${e.full_name}</option>`).join('')}
      </select></div>` : '';
    const canEdit = activeRun && activeRun.status === 'in_progress';
    const canSubmit = canEdit;
    el.innerHTML = `<div class="card" style="margin-top:16px"><div class="card-body">
      <h4>${label}</h4>
      <p class="muted">Tick each assigned task, then submit to admin for confirmation. Deadline: ${deadline}.</p>
      ${empPicker}
      <div style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap">
        ${!activeRun || activeRun.status === 'confirmed' ? `<button class="btn btn-primary" id="routine-start">Start Today's Run</button>` : ''}
        ${canSubmit ? `<button class="btn btn-success" id="routine-submit">Submit to Admin</button>` : ''}
        ${activeRun ? `<button class="btn btn-ghost" id="routine-pdf">Export PDF</button>
          <button class="btn btn-ghost" id="routine-print">Print</button>
          <button class="btn btn-ghost" id="routine-wa">Share WhatsApp</button>` : ''}
      </div>
      ${activeRun ? `<p><strong>Status:</strong> ${activeRun.status}
        ${activeRun.submitted_at ? ` · Submitted ${Utils.formatDateTime(activeRun.submitted_at)}` : ''}
        ${activeRun.confirmed_at ? ` · Confirmed ${Utils.formatDateTime(activeRun.confirmed_at)}` : ''}</p>
        ${activeRun.admin_notes ? `<p class="muted">Admin: ${activeRun.admin_notes}</p>` : ''}
        ${(activeRun.items || []).map(i => {
          const done = i.item_status === 'done' || (!i.item_status && i.completed);
          const locked = activeRun.status === 'submitted' || activeRun.status === 'confirmed';
          return `<label style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:${canEdit && !locked ? 'pointer' : 'default'}">
            <input type="checkbox" class="routine-check" data-id="${i.id}" ${done ? 'checked' : ''} ${!canEdit || locked || done ? 'disabled' : ''} style="width:18px;height:18px;accent-color:var(--success)">
            <span style="flex:1;min-width:160px">${i.task_name}</span>
            ${done ? `<small class="muted">${i.employee_name || '—'}${i.comments ? ` · ${i.comments}` : ''}</small>` : ''}
          </label>`;
        }).join('')}` : '<p class="muted">No routine started for today.</p>'}
    </div></div>`;

    document.getElementById('ops-chk-emp')?.addEventListener('change', (e) => {
      this._opsChecklistEmpId = e.target.value ? parseInt(e.target.value, 10) : null;
      this._routineRun = null;
      this.renderDailyRoutine(el, type);
    });
    document.getElementById('routine-start')?.addEventListener('click', async () => {
      const payload = { run_type: type };
      if (this._opsChecklistEmpId) payload.employee_id = this._opsChecklistEmpId;
      const r = await API.startChecklistRun(payload, this.app.user);
      if (r.success) { this._routineRun = r.data; this.renderDailyRoutine(el, type); }
      else Utils.toast(r.error, 'error');
    });
    document.getElementById('routine-submit')?.addEventListener('click', async () => {
      const r = await API.submitChecklistRun(activeRun.id, this.app.user);
      if (r.success) {
        Utils.toast('Submitted to admin', 'success');
        this._routineRun = r.data;
        this.renderDailyRoutine(el, type);
      } else Utils.toast(r.error, 'error');
    });
    const pdfFn = async () => {
      const r = await API.getChecklistReportPdf(activeRun.id);
      if (!r.success) return Utils.toast(r.error, 'error');
      return r;
    };
    document.getElementById('routine-pdf')?.addEventListener('click', async () => {
      const r = await pdfFn();
      if (r?.success) await API.saveFile(`${type}-routine-${Utils.today()}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], r.data);
    });
    document.getElementById('routine-print')?.addEventListener('click', async () => {
      const r = await pdfFn();
      if (r?.success) await API.openPdf(r.data, `${type}-routine.pdf`);
    });
    document.getElementById('routine-wa')?.addEventListener('click', async () => {
      const phone = this.app.user?.phone || this.app.settings?.phone;
      if (!phone) return Utils.toast('Add your phone number to your user profile to share', 'error');
      const label = type === 'opening' ? 'Morning Opening' : 'Closing';
      const done = (activeRun.items || []).filter(i => i.item_status === 'done' || (!i.item_status && i.completed)).length;
      const total = (activeRun.items || []).length;
      const r = await API.sendWhatsAppMessage({
        phone,
        recipient_name: this.app.user?.full_name || 'Supervisor',
        message_type: 'checklist',
        body: `${label} routine submitted — ${activeRun.run_date}\nStatus: ${activeRun.status}\nCompleted: ${done}/${total} tasks`
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      window.open(r.data.url, '_blank');
    });
    el.querySelectorAll('.routine-check').forEach(cb => cb.addEventListener('change', async () => {
      if (!cb.checked) { cb.checked = true; return; }
      await API.completeChecklistItem(parseInt(cb.dataset.id, 10), { item_status: 'done', comments: '' }, this.app.user);
      this._routineRun = null;
      this.renderDailyRoutine(el, type);
    }));
  },

  async renderCashUp(el) {
    const currency = this.app.settings?.currency || 'R';
    this._cuFrom = this._cuFrom || Utils.daysAgo(30);
    this._cuTo = this._cuTo || Utils.today();
    const canApprove = ['owner', 'manager', 'assistant_manager', 'supervisor'].includes(this.app.user?.role);
    const [summaryRes, cashupsRes, dropsRes] = await Promise.all([
      API.getCashUpSummary(this._cuFrom, this._cuTo),
      API.getCashUps({ from: this._cuFrom, to: this._cuTo, limit: 500 }),
      API.getCashDrops({ from: this._cuFrom, to: this._cuTo })
    ]);
    const s = summaryRes.data || {};
    const cashups = cashupsRes.data || [];
    const cashDrops = dropsRes.data || [];
    const pendingDrops = cashDrops.filter(d => d.status === 'pending');
    const pending = cashups.filter(c => !c.manager_approved);

    // Per cashier/user shortage totals for filtered dates (short = actual < expected)
    const byUser = {};
    for (const c of cashups) {
      const key = c.user_id != null ? String(c.user_id) : (c.user_name || 'unknown');
      if (!byUser[key]) {
        byUser[key] = {
          user_id: c.user_id,
          user_name: c.user_name || '—',
          sessions: 0,
          expected: 0,
          actual: 0,
          net_diff: 0,
          short_total: 0,
          over_total: 0,
          short_count: 0
        };
      }
      const row = byUser[key];
      const diff = Number(c.difference) || 0;
      row.sessions += 1;
      row.expected += Number(c.expected_cash) || 0;
      row.actual += Number(c.actual_cash) || 0;
      row.net_diff += diff;
      if (diff < 0) {
        row.short_total += Math.abs(diff);
        row.short_count += 1;
      } else if (diff > 0) {
        row.over_total += diff;
      }
    }
    const userShortages = Object.values(byUser).sort((a, b) => b.short_total - a.short_total || a.user_name.localeCompare(b.user_name));
    const totalShort = userShortages.reduce((sum, u) => sum + u.short_total, 0);
    const totalOver = userShortages.reduce((sum, u) => sum + u.over_total, 0);

    el.innerHTML = `<div class="stats-grid" style="margin-top:16px">
      <div class="stat-card primary"><div class="label">Sales (range)</div><div class="value">${Utils.formatMoney(s.sales?.total||0, currency)}</div></div>
      <div class="stat-card"><div class="label">Cash</div><div class="value">${Utils.formatMoney(s.cash?.total||0, currency)}</div></div>
      <div class="stat-card warning"><div class="label">Pending approval</div><div class="value">${pending.length}</div></div>
      <div class="stat-card danger"><div class="label">Total short (filtered)</div><div class="value">${Utils.formatMoney(totalShort, currency)}</div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-body">
      <h4>Shortage by cashier / user</h4>
      <p class="muted">Totals for <strong>${this._cuFrom}</strong> to <strong>${this._cuTo}</strong>. Short = cash counted less than expected. Over = more than expected.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Cashier / User</th><th>Cash-outs</th><th>Expected</th><th>Actual</th><th>Short</th><th>Over</th><th>Net difference</th></tr></thead>
        <tbody>${userShortages.map(u => `<tr>
          <td><strong>${Utils.escHtml(u.user_name)}</strong>${u.short_count ? `<br><small class="muted">${u.short_count} short cash-out(s)</small>` : ''}</td>
          <td>${u.sessions}</td>
          <td>${Utils.formatMoney(u.expected, currency)}</td>
          <td>${Utils.formatMoney(u.actual, currency)}</td>
          <td style="color:${u.short_total > 0 ? 'var(--danger)' : 'inherit'};font-weight:${u.short_total > 0 ? '600' : 'normal'}">${Utils.formatMoney(u.short_total, currency)}</td>
          <td style="color:${u.over_total > 0 ? 'var(--success)' : 'inherit'}">${Utils.formatMoney(u.over_total, currency)}</td>
          <td style="color:${u.net_diff < 0 ? 'var(--danger)' : u.net_diff > 0 ? 'var(--success)' : 'inherit'}">${Utils.formatMoney(u.net_diff, currency)}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="muted">No cash-outs in this date range</td></tr>'}
        </tbody>
        ${userShortages.length ? `<tfoot><tr>
          <td><strong>Total</strong></td>
          <td>${cashups.length}</td>
          <td>${Utils.formatMoney(userShortages.reduce((n, u) => n + u.expected, 0), currency)}</td>
          <td>${Utils.formatMoney(userShortages.reduce((n, u) => n + u.actual, 0), currency)}</td>
          <td style="color:var(--danger);font-weight:600">${Utils.formatMoney(totalShort, currency)}</td>
          <td style="color:var(--success)">${Utils.formatMoney(totalOver, currency)}</td>
          <td>${Utils.formatMoney(userShortages.reduce((n, u) => n + u.net_diff, 0), currency)}</td>
        </tr></tfoot>` : ''}
      </table></div>
    </div></div>
    <div class="card" style="margin-top:16px"><div class="card-body">
      <h4>Cash-Up Review &amp; Approval</h4>
      <p class="muted">Cash-ups are saved when a shift is cashed out and stay <strong>Pending</strong> until you approve. Use Approve on each row.</p>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin:12px 0">
        <div class="field" style="margin:0"><label>From</label><input type="date" id="cu-from" value="${this._cuFrom}"></div>
        <div class="field" style="margin:0"><label>To</label><input type="date" id="cu-to" value="${this._cuTo}"></div>
        <button class="btn btn-primary btn-sm" id="cu-filter">Filter</button>
        <button class="btn btn-ghost btn-sm" id="cu-report-pdf">📄 PDF Report</button>
        <button class="btn btn-ghost btn-sm" id="cu-report-print">🖨️ Print Report</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Cashier</th><th>Expected</th><th>Actual</th><th>Short / Diff</th><th>Status</th><th></th></tr></thead>
        <tbody>${cashups.map(c => {
          const diff = Number(c.difference) || 0;
          const shortLabel = diff < 0
            ? `Short ${Utils.formatMoney(Math.abs(diff), currency)}`
            : diff > 0
              ? `Over ${Utils.formatMoney(diff, currency)}`
              : Utils.formatMoney(0, currency);
          return `<tr>
          <td>${Utils.formatDateTime(c.created_at)}</td>
          <td>${c.user_name || '—'}</td>
          <td>${Utils.formatMoney(c.expected_cash, currency)}</td>
          <td>${Utils.formatMoney(c.actual_cash, currency)}</td>
          <td style="color:${diff < 0 ? 'var(--danger)' : diff > 0 ? 'var(--success)' : 'inherit'};font-weight:${diff !== 0 ? '600' : 'normal'}">${shortLabel}</td>
          <td>${c.manager_approved
            ? `<span class="tag" style="background:var(--success)">Approved</span>${c.approved_by_name ? `<br><small class="muted">${c.approved_by_name}</small>` : ''}`
            : '<span class="tag" style="background:var(--warning)">Pending</span>'}</td>
          <td style="white-space:nowrap">
            ${canApprove && !c.manager_approved ? `<button class="btn btn-sm btn-success cu-approve" data-id="${c.id}">Approve</button>` : ''}
            <button class="btn btn-sm btn-ghost cu-pdf" data-id="${c.id}">PDF</button>
            <button class="btn btn-sm btn-ghost cu-print" data-id="${c.id}">Print</button>
            <button class="btn btn-sm btn-ghost cu-wa" data-id="${c.id}">WhatsApp</button>
          </td></tr>`;
        }).join('') || '<tr><td colspan="7" class="muted">No cash-ups in this date range</td></tr>'}
        </tbody></table></div>
    </div></div>
    <div class="card" style="margin-top:16px"><div class="card-body">
      <h4>Cash Sent to Admin (drops) ${pendingDrops.length ? `<span class="tag" style="background:var(--warning)">${pendingDrops.length} pending</span>` : ''}</h4>
      <p class="muted">Cashiers send small amounts to admin/safe with photo proof during the shift until cash-out.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Cashier</th><th>Amount</th><th>Notes</th><th>Proof</th><th>Status</th><th></th></tr></thead>
        <tbody>${cashDrops.map(d => `<tr>
          <td>${Utils.formatDateTime(d.created_at)}</td>
          <td>${d.user_name || '—'}</td>
          <td>${Utils.formatMoney(d.amount, currency)}</td>
          <td>${Utils.escHtml(d.notes || '—')}</td>
          <td>${d.proof_path ? `<img data-image-path="${d.proof_path}" alt="proof" class="cd-proof-thumb" style="width:40px;height:40px;object-fit:cover;border-radius:6px;cursor:pointer">` : '—'}</td>
          <td><span class="tag">${d.status}</span></td>
          <td>${canApprove && d.status === 'pending' ? `<button class="btn btn-sm btn-success cd-confirm" data-id="${d.id}">Confirm received</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="muted">No cash drops in this range</td></tr>'}
        </tbody></table></div>
    </div></div>`;

    document.getElementById('cu-filter')?.addEventListener('click', () => {
      this._cuFrom = document.getElementById('cu-from').value || this._cuFrom;
      this._cuTo = document.getElementById('cu-to').value || this._cuTo;
      this.renderCashUp(el);
    });
    el.querySelectorAll('.cd-confirm').forEach(b => b.addEventListener('click', async () => {
      const r = await API.confirmCashDrop(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Confirm failed', 'error');
      Utils.toast('Cash drop confirmed', 'success');
      this.renderCashUp(el);
    }));
    el.querySelectorAll('.cd-proof-thumb').forEach(img => {
      const p = img.getAttribute('data-image-path');
      if (!p) return;
      API.getImageDataUrl(p).then(r => {
        if (r.success && (r.data || r.dataUrl)) img.src = r.data || r.dataUrl;
      }).catch(() => {});
      img.addEventListener('click', () => {
        if (img.src) window.open(img.src, '_blank');
      });
    });
    const exportReport = async (mode) => {
      const company = { ...Utils.companyInfo(this.app.settings), dateRange: `${this._cuFrom} to ${this._cuTo}` };
      const shortHeaders = ['Cashier / User', 'Cash-outs', 'Expected', 'Actual', 'Short', 'Over', 'Net difference'];
      const shortRows = userShortages.map(u => [
        u.user_name,
        String(u.sessions),
        Utils.formatMoney(u.expected, currency),
        Utils.formatMoney(u.actual, currency),
        Utils.formatMoney(u.short_total, currency),
        Utils.formatMoney(u.over_total, currency),
        Utils.formatMoney(u.net_diff, currency)
      ]);
      shortRows.push([
        'TOTAL', String(cashups.length),
        Utils.formatMoney(userShortages.reduce((n, u) => n + u.expected, 0), currency),
        Utils.formatMoney(userShortages.reduce((n, u) => n + u.actual, 0), currency),
        Utils.formatMoney(totalShort, currency),
        Utils.formatMoney(totalOver, currency),
        Utils.formatMoney(userShortages.reduce((n, u) => n + u.net_diff, 0), currency)
      ]);
      const headers = ['Date', 'Cashier', 'Expected', 'Actual', 'Short / Diff', 'Status', 'Approved by'];
      const rows = cashups.map(c => {
        const diff = Number(c.difference) || 0;
        const shortLabel = diff < 0 ? `Short ${Utils.formatMoney(Math.abs(diff), currency)}`
          : diff > 0 ? `Over ${Utils.formatMoney(diff, currency)}` : Utils.formatMoney(0, currency);
        return [
          Utils.formatDateTime(c.created_at),
          c.user_name || '—',
          Utils.formatMoney(c.expected_cash, currency),
          Utils.formatMoney(c.actual_cash, currency),
          shortLabel,
          c.manager_approved ? 'Approved' : 'Pending',
          c.approved_by_name || '—'
        ];
      });
      const titleShort = `Cashier Shortages ${this._cuFrom} – ${this._cuTo}`;
      const title = `Cash-Up Report ${this._cuFrom} – ${this._cuTo}`;
      if (mode === 'pdf') {
        await Export.toPDF(`cashier-shortages-${this._cuFrom}-${this._cuTo}.pdf`, titleShort, shortHeaders, shortRows, company);
        await Export.toPDF(`cashup-report-${this._cuFrom}-${this._cuTo}.pdf`, title, headers, rows, company);
        Utils.toast('PDF reports ready (shortages + detail)', 'success');
      } else {
        Export.print(titleShort, shortHeaders, shortRows, company);
        Export.print(title, headers, rows, company);
      }
    };
    document.getElementById('cu-report-pdf')?.addEventListener('click', () => exportReport('pdf'));
    document.getElementById('cu-report-print')?.addEventListener('click', () => exportReport('print'));
    el.querySelectorAll('.cu-approve').forEach(b => b.addEventListener('click', async () => {
      if (!canApprove) return Utils.toast('You do not have permission to approve cash-ups', 'error');
      const id = parseInt(b.dataset.id, 10);
      const row = cashups.find(c => c.id === id);
      Utils.showModal('Approve Cash-Up', `
        <p>Approve cash-out for <strong>${row?.user_name || 'cashier'}</strong>?</p>
        <p class="muted">Expected ${Utils.formatMoney(row?.expected_cash, currency)} · Actual ${Utils.formatMoney(row?.actual_cash, currency)} · Diff ${Utils.formatMoney(row?.difference, currency)}</p>
        <div class="field"><label>Approval notes (optional)</label><input id="cu-approve-notes" placeholder="Notes"></div>`,
        '<button class="btn btn-success" id="cu-approve-go">Approve</button>');
      document.getElementById('cu-approve-go')?.addEventListener('click', async () => {
        const notes = document.getElementById('cu-approve-notes')?.value.trim() || '';
        const btn = document.getElementById('cu-approve-go');
        if (btn) btn.disabled = true;
        const r = await API.approveCashUp(id, notes, this.app.user);
        if (btn) btn.disabled = false;
        if (!r.success) return Utils.toast(r.error || 'Approve failed — check you are logged in as manager/owner', 'error');
        Utils.hideModal();
        Utils.toast('Cash-up approved', 'success');
        this.renderCashUp(el);
      });
    }));
    el.querySelectorAll('.cu-pdf').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getCashUpPdf(parseInt(b.dataset.id, 10));
      if (!r.success) return Utils.toast(r.error, 'error');
      await API.saveFile(`cashout-${b.dataset.id}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], r.data);
    }));
    el.querySelectorAll('.cu-print').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getCashUpPdf(parseInt(b.dataset.id, 10));
      if (!r.success) return Utils.toast(r.error, 'error');
      await API.openPdf(r.data, `cashout-${b.dataset.id}.pdf`);
    }));
    el.querySelectorAll('.cu-wa').forEach(b => b.addEventListener('click', async () => {
      const c = cashups.find(x => x.id === parseInt(b.dataset.id, 10));
      if (!c) return;
      const adminPhone = Utils.getCashoutWhatsAppPhone(this.app.settings);
      if (!adminPhone) return Utils.toast('Cashout WhatsApp number not configured — set it in Admin → Shift Management', 'error');
      const msg = `Cash-out — ${c.user_name || 'Cashier'}\nExpected: ${Utils.formatMoney(c.expected_cash, currency)}\nActual: ${Utils.formatMoney(c.actual_cash, currency)}\nDiff: ${Utils.formatMoney(c.difference, currency)}\nStatus: ${c.manager_approved ? 'Approved' : 'Pending approval'}`;
      const r = await API.sendWhatsAppMessage({ phone: adminPhone, recipient_name: 'Admin', message_type: 'cashout', body: msg }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      window.open(r.data.url, '_blank');
    }));
  },

  async renderWaste(el) {
    const from = this._wasteFrom || Utils.monthStart();
    const to = this._wasteTo || Utils.today();
    this._wasteFrom = from;
    this._wasteTo = to;
    const canApprove = ['owner', 'manager', 'assistant_manager', 'supervisor'].includes(this.app.user?.role);
    const [wasteRes, prodRes] = await Promise.all([
      API.getWasteRecords(from, to),
      API.getProducts({ ingredients_only: true })
    ]);
    const records = wasteRes.data || [];
    const products = prodRes.data || [];
    const currency = this.app.settings?.currency || 'R';
    this._wastePhotos = this._wastePhotos || [];

    el.innerHTML = `<div class="card" style="margin-top:16px"><div class="card-body">
      <h4>Record Waste / Damaged Ingredients</h4>
      <p class="muted">Choose ingredients only. Upload 1–2 photos, submit for admin review. Stock is removed only after approval. Approved waste can be returned to stock.</p>
      <div class="form-grid">
        <div class="field"><label>Ingredient</label><select id="w-product">${products.length
          ? products.map(p => `<option value="${p.id}">${p.name} (stock: ${p.stock_quantity ?? 0})</option>`).join('')
          : '<option value="">No ingredients in inventory — add via Recipe / Inventory</option>'}</select></div>
        <div class="field"><label>Quantity</label><input type="number" id="w-qty" step="0.01" min="0.01" value="1"></div>
        <div class="field"><label>Reason</label><select id="w-reason">
          <option>Broken</option><option>Expired</option><option>Lost</option><option>Spoiled</option><option>Damaged</option><option>Other</option></select></div>
        <div class="field full"><label>Notes</label><input id="w-notes"></div>
        <div class="field full"><label>Photos (1–2 required)</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <button type="button" class="btn btn-ghost btn-sm" id="w-add-photo">📷 Add Photo</button>
            <span id="w-photo-count" class="muted">${(this._wastePhotos || []).length}/2</span>
          </div>
          <div id="w-photo-previews" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"></div>
        </div>
      </div>
      <button class="btn btn-warning" id="save-waste" style="margin-top:12px">Submit for Approval</button>
    </div></div>
    <div class="card" style="margin-top:16px"><div class="card-body">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-bottom:12px">
        <div class="field" style="margin:0"><label>From</label><input type="date" id="w-from" value="${from}"></div>
        <div class="field" style="margin:0"><label>To</label><input type="date" id="w-to" value="${to}"></div>
        <button class="btn btn-primary btn-sm" id="w-filter">Filter</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Product</th><th>Qty</th><th>Reason</th><th>Cost</th><th>Photos</th><th>Status</th><th></th></tr></thead>
        <tbody>${records.map(w => {
          const st = w.status || 'approved';
          const photos = [w.photo_path_1, w.photo_path_2].filter(Boolean);
          return `<tr><td>${Utils.formatDateTime(w.created_at)}</td><td>${w.product_name}</td>
          <td>${w.quantity}</td><td>${w.reason}</td><td>${Utils.formatMoney(w.cost_value, currency)}</td>
          <td>${photos.length ? photos.map((p, i) => `<button class="btn btn-sm btn-ghost w-view-photo" data-idx="${records.indexOf(w)}" data-pi="${i}">📷${i + 1}</button>`).join(' ') : '—'}</td>
          <td>${st === 'approved' ? '<span class="tag" style="background:var(--success)">Approved</span>'
            : st === 'rejected' ? '<span class="tag" style="background:var(--danger)">Rejected</span>'
            : '<span class="tag" style="background:var(--warning)">Pending</span>'}</td>
          <td style="white-space:nowrap">
            ${canApprove && st === 'pending' ? `
              <button class="btn btn-sm btn-success w-approve" data-id="${w.id}">Approve</button>
              <button class="btn btn-sm btn-danger w-reject" data-id="${w.id}">Reject</button>` : ''}
            ${canApprove && st === 'approved' && !w.returned_to_stock ? `
              <button class="btn btn-sm btn-primary w-return" data-id="${w.id}">Return to Stock</button>` : ''}
            ${w.returned_to_stock ? '<span class="tag tag-ok">Returned</span>' : ''}
          </td></tr>`;
        }).join('') || '<tr><td colspan="8" class="muted">No records</td></tr>'}
      </tbody></table></div>
    </div></div>`;

    const refreshPhotoUi = async () => {
      const count = document.getElementById('w-photo-count');
      if (count) count.textContent = `${this._wastePhotos.length}/2`;
      const host = document.getElementById('w-photo-previews');
      if (!host) return;
      const parts = [];
      for (let i = 0; i < this._wastePhotos.length; i++) {
        const p = this._wastePhotos[i];
        let thumb = '';
        try {
          const img = await API.getImageDataUrl(p);
          if (img.success) thumb = `<img src="${img.dataUrl}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">`;
        } catch (_) {}
        parts.push(`<div style="position:relative">${thumb || `<span class="muted">Photo ${i + 1}</span>`}
          <button type="button" class="btn btn-sm btn-ghost w-rm-photo" data-idx="${i}" style="position:absolute;top:-6px;right:-6px">✕</button></div>`);
      }
      host.innerHTML = parts.join('');
      host.querySelectorAll('.w-rm-photo').forEach(b => b.addEventListener('click', () => {
        this._wastePhotos.splice(parseInt(b.dataset.idx, 10), 1);
        refreshPhotoUi();
      }));
    };
    refreshPhotoUi();

    document.getElementById('w-add-photo')?.addEventListener('click', async () => {
      if (this._wastePhotos.length >= 2) return Utils.toast('Maximum 2 photos', 'error');
      const r = await API.selectImage('waste');
      if (!r.success) {
        if (!r.cancelled) Utils.toast(r.error || 'Could not add photo', 'error');
        return;
      }
      this._wastePhotos.push(r.path);
      refreshPhotoUi();
    });
    document.getElementById('w-filter')?.addEventListener('click', () => {
      this._wasteFrom = document.getElementById('w-from').value || from;
      this._wasteTo = document.getElementById('w-to').value || to;
      this.renderWaste(el);
    });
    document.getElementById('save-waste').addEventListener('click', async () => {
      if (!products.length) return Utils.toast('Add ingredients in inventory first', 'error');
      if (this._wastePhotos.length < 1) return Utils.toast('Add at least one photo', 'error');
      const pid = parseInt(document.getElementById('w-product').value, 10);
      if (!pid) return Utils.toast('Select an ingredient', 'error');
      const r = await API.recordWaste({
        product_id: pid,
        quantity: parseFloat(document.getElementById('w-qty').value),
        reason: document.getElementById('w-reason').value,
        notes: document.getElementById('w-notes').value.trim(),
        photo_path_1: this._wastePhotos[0] || null,
        photo_path_2: this._wastePhotos[1] || null
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      this._wastePhotos = [];
      Utils.toast('Submitted for admin approval', 'success');
      this.render(document.getElementById('page-content'), this.app);
    });
    el.querySelectorAll('.w-view-photo').forEach(b => b.addEventListener('click', async () => {
      const w = records[parseInt(b.dataset.idx, 10)];
      const path = Number(b.dataset.pi) === 0 ? w?.photo_path_1 : w?.photo_path_2;
      if (path) await API.openPath(path);
    }));
    el.querySelectorAll('.w-approve').forEach(b => b.addEventListener('click', async () => {
      const r = await API.approveWaste(parseInt(b.dataset.id, 10), '', this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Approve failed', 'error');
      Utils.toast('Approved — stock removed', 'success');
      this.renderWaste(el);
    }));
    el.querySelectorAll('.w-reject').forEach(b => b.addEventListener('click', async () => {
      const notes = prompt('Rejection reason:') || '';
      if (!notes.trim()) return Utils.toast('Rejection reason required', 'error');
      const r = await API.rejectWaste(parseInt(b.dataset.id, 10), notes, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Reject failed', 'error');
      Utils.toast('Rejected', 'success');
      this.renderWaste(el);
    }));
    el.querySelectorAll('.w-return').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Return this waste quantity back into ingredient stock?')) return;
      const r = await API.returnWasteToStock(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Return failed', 'error');
      Utils.toast('Returned to stock', 'success');
      this.renderWaste(el);
    }));
  },

  async renderStockCount(el) {
    const res = await API.getStockCounts();
    const counts = res.data || [];
    el.innerHTML = `<div style="margin:16px 0">
        <button class="btn btn-primary" id="new-count">Start Stock Count</button>
        <p class="muted" style="margin-top:8px">Each count records who started it. Open a row for full product lines, differences, and completion.</p>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Count #</th><th>Started by</th><th>Status</th><th>Started</th><th>Completed</th><th></th></tr></thead>
        <tbody>${counts.map(c => `<tr>
          <td><strong>${c.count_number}</strong></td>
          <td>${c.user_name || '—'}</td>
          <td><span class="tag">${c.status}</span></td>
          <td>${Utils.formatDateTime(c.created_at)}</td>
          <td>${c.completed_at ? Utils.formatDateTime(c.completed_at) : '—'}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-primary open-count" data-id="${c.id}">${c.status === 'open' ? 'Continue' : 'View details'}</button>
          </td></tr>`).join('') || '<tr><td colspan="6" class="muted">No counts yet</td></tr>'}
        </tbody></table></div></div>`;

    document.getElementById('new-count').addEventListener('click', async () => {
      Utils.showModal('Start Stock Count', `
        <p class="muted">Creates a full product count for <strong>${this.app.user?.full_name || 'you'}</strong>. You can leave notes for managers.</p>
        <div class="field"><label>Notes (optional)</label><input id="sc-notes" placeholder="e.g. Monthly fridge count"></div>`,
        '<button class="btn btn-primary" id="sc-start-go">Start Count</button>');
      document.getElementById('sc-start-go')?.addEventListener('click', async () => {
        const notes = document.getElementById('sc-notes')?.value.trim() || '';
        const r = await API.createStockCount(notes, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast(`Count ${r.data.countNumber} started by ${r.data.user_name || this.app.user?.full_name || 'you'}`, 'success');
        this.renderStockCount(el);
        this.openCount(r.data.id);
      });
    });
    el.querySelectorAll('.open-count').forEach(b => b.addEventListener('click', () => this.openCount(parseInt(b.dataset.id, 10))));
    await this.afterStockCountRender();
  },

  async openCount(id) {
    const r = await API.getStockCount(id);
    if (!r.success || !r.data) return Utils.toast(r.error || 'Could not load stock count', 'error');
    const count = r.data;
    const lines = count.lines || [];
    const diffs = lines.filter(l => Number(l.difference) !== 0).length;
    const canEdit = count.status === 'open';
    Utils.showModal(`Stock Count — ${count.count_number}`, `
      <div style="margin-bottom:12px;padding:10px;background:var(--bg-secondary);border-radius:8px;font-size:13px">
        <strong>Started by:</strong> ${count.user_name || '—'} ·
        <strong>Status:</strong> ${count.status} ·
        <strong>Started:</strong> ${Utils.formatDateTime(count.created_at)}
        ${count.completed_at ? ` · <strong>Completed:</strong> ${Utils.formatDateTime(count.completed_at)}` : ''}
        ${count.notes ? `<br><strong>Notes:</strong> ${Utils.escHtml(count.notes)}` : ''}
        <br><strong>Lines:</strong> ${lines.length} · <strong>Differences:</strong> ${diffs}
      </div>
      <div class="table-wrap" style="max-height:400px;overflow:auto"><table>
        <thead><tr><th>Product</th><th>System</th><th>Counted</th><th>Diff</th></tr></thead>
        <tbody>${lines.map(l => `<tr><td>${l.product_name}</td><td>${l.system_qty}</td>
          <td>${canEdit
            ? `<input type="number" class="count-line" data-id="${l.id}" value="${l.counted_qty}" step="0.01" style="width:80px">`
            : l.counted_qty}</td>
          <td style="color:${Number(l.difference) !== 0 ? 'var(--danger)' : 'inherit'}">${l.difference}</td></tr>`).join('')}
        </tbody></table></div>`,
      canEdit
        ? '<button class="btn btn-success" id="complete-count">Complete &amp; Adjust Stock</button>'
        : '<button class="btn btn-ghost" id="close-count-view">Close</button>');
    document.getElementById('close-count-view')?.addEventListener('click', Utils.hideModal);
    document.querySelectorAll('.count-line').forEach(inp => inp.addEventListener('change', async () => {
      await API.updateStockCountLine(parseInt(inp.dataset.id, 10), parseFloat(inp.value));
    }));
    document.getElementById('complete-count')?.addEventListener('click', async () => {
      const r2 = await API.completeStockCount(id, this.app.user);
      if (!r2.success) return Utils.toast(r2.error, 'error');
      Utils.hideModal();
      Utils.toast(`Count complete. ${r2.data.adjusted} products adjusted.`, 'success');
      this.render(document.getElementById('page-content'), this.app);
    });
  }
};
window.OperationsPage = OperationsPage;

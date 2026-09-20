const AuditPage = {
  from: null,
  to: null,

  async render(el, app) {
    this.app = app;
    this._host = el;
    this.el = el;
    this.from = this.from || Utils.monthStart();
    this.to = this.to || Utils.today();
    el.innerHTML = `<div class="page-toolbar"><h3>Audit Log</h3></div><p class="muted">Loading…</p>`;
    await this.loadLogs(el);
  },

  async loadLogs(el) {
    el = el || this.el;
    if (!el) return;
    let logs = [];
    try {
      const res = await API.getAuditLog({ from: this.from, to: this.to, limit: 1000 });
      if (res.success === false) {
        el.innerHTML = `<div class="page-toolbar"><h3>Audit Log</h3></div>
          <p class="error-msg">${Utils.escHtml(res.error || 'Could not load audit log')}</p>
          <button type="button" class="btn btn-primary" id="audit-retry">Retry</button>`;
        document.getElementById('audit-retry')?.addEventListener('click', () => this.loadLogs(el));
        return;
      }
      logs = Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      el.innerHTML = `<div class="page-toolbar"><h3>Audit Log</h3></div>
        <p class="error-msg">${Utils.escHtml(err.message || 'Could not load audit log')}</p>
        <button type="button" class="btn btn-primary" id="audit-retry">Retry</button>`;
      document.getElementById('audit-retry')?.addEventListener('click', () => this.loadLogs(el));
      return;
    }

    el.innerHTML = `
      <div class="page-toolbar"><h3>Audit Log</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost" id="audit-print">Print</button>
          <button class="btn btn-primary" id="audit-pdf">Download PDF</button>
        </div>
      </div>
      <p class="muted" style="margin:0 0 8px;font-size:13px">${logs.length} event(s) from ${Utils.formatDate(this.from)} to ${Utils.formatDate(this.to)}</p>
      ${Utils.dateFilterHTML('audit-filter', this.from, this.to)}
      <div class="card"><div class="table-wrap"><table id="audit-table">
        <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th></tr></thead>
        <tbody>${logs.map(l => `<tr>
          <td>${Utils.formatDateTime(l.created_at)}</td>
          <td><strong>${Utils.escHtml(l.username || '—')}</strong></td>
          <td>${Utils.escHtml(String(l.action || '').replace(/_/g, ' '))}</td>
          <td><small class="muted">${Utils.escHtml(l.details || `${l.entity_type || ''} #${l.entity_id || ''}`)}</small></td>
        </tr>`).join('') || '<tr><td colspan="4" class="muted">No activity in this date range</td></tr>'}
        </tbody></table></div></div>`;

    Utils.bindDateFilter('audit-filter', async (from, to) => {
      this.from = from;
      this.to = to;
      await this.loadLogs(el);
    });

    document.getElementById('audit-print')?.addEventListener('click', () => {
      const headers = ['Time', 'User', 'Action', 'Details'];
      const rows = logs.map(l => [
        Utils.formatDateTime(l.created_at),
        l.username || '—',
        String(l.action || '').replace(/_/g, ' '),
        l.details || `${l.entity_type || ''} #${l.entity_id || ''}`
      ]);
      Export.print('Audit Log', headers, rows, {
        ...Utils.companyInfo(this.app.settings),
        dateRange: `${Utils.formatDate(this.from)} — ${Utils.formatDate(this.to)}`
      });
    });

    document.getElementById('audit-pdf')?.addEventListener('click', async () => {
      const headers = ['Time', 'User', 'Action', 'Details'];
      const rows = logs.map(l => [
        Utils.formatDateTime(l.created_at),
        l.username || '—',
        String(l.action || '').replace(/_/g, ' '),
        l.details || `${l.entity_type || ''} #${l.entity_id || ''}`
      ]);
      await Export.toPDF(`audit-log-${this.from}.pdf`, 'Audit Log', headers, rows, {
        ...Utils.companyInfo(this.app.settings),
        dateRange: `${Utils.formatDate(this.from)} — ${Utils.formatDate(this.to)}`
      });
      Utils.toast('Audit log PDF saved', 'success');
    });
  }
};
window.AuditPage = AuditPage;

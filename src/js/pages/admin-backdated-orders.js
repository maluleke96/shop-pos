// Admin → Backdated Orders dashboard
(function () {
  const money = (n, c) => (typeof Utils !== 'undefined' && Utils.formatMoney)
    ? Utils.formatMoney(n, c)
    : `${c || 'R'}${Number(n || 0).toFixed(2)}`;
  const esc = (s) => (typeof Utils !== 'undefined' && Utils.escHtml)
    ? Utils.escHtml(s)
    : String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function fmtDt(v) {
    if (!v) return '—';
    if (typeof Utils !== 'undefined' && Utils.formatDateTime) return Utils.formatDateTime(v);
    const s = String(v).replace('T', ' ');
    return s.length > 16 ? s.slice(0, 16) : s;
  }

  const BackdatedOrdersPage = {
    filters: {},

    async render(el, app) {
      this.app = app;
      this.currency = app?.settings?.currency || 'R';
      if (!el) return;
      if (!Utils.canViewBackdatedOrdersAdmin(app.user)) {
        el.innerHTML = `<div class="admin-section"><h3>Backdated Orders</h3><p class="muted">You do not have permission to view backdated orders.</p></div>`;
        return;
      }
      el.innerHTML = `<div class="admin-section"><h3>Backdated Orders</h3><p class="muted">Loading…</p></div>`;
      try {
        const [sumRes, listRes] = await Promise.all([
          API.backdatedOrdersSummary({}, app.user),
          API.listBackdatedOrders({ entered_from: this.weekFrom(), limit: 100 }, app.user)
        ]);
        if (sumRes.success === false) throw new Error(sumRes.error || 'Summary failed');
        if (listRes.success === false) throw new Error(listRes.error || 'List failed');
        this._summary = sumRes.data || sumRes;
        this._rows = listRes.data || listRes || [];
        this.paint(el);
      } catch (e) {
        el.innerHTML = `<div class="admin-section"><h3>Backdated Orders</h3><p class="error-msg">${esc(e.message || e)}</p></div>`;
      }
    },

    weekFrom() {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      return d.toLocaleDateString('en-CA');
    },

    today() {
      return new Date().toLocaleDateString('en-CA');
    },

    openSlip(saleId) {
      const id = parseInt(saleId, 10);
      if (!id) return;
      if (typeof AdminPage !== 'undefined' && typeof AdminPage.showSaleDetail === 'function') {
        return AdminPage.showSaleDetail(id);
      }
      Utils.toast('Sale detail unavailable', 'error');
    },

    paint(el) {
      const s = this._summary || {};
      const rows = this._rows || [];
      const cur = this.currency;
      const today = this.today();
      el.innerHTML = `
        <div class="admin-section">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
            <div>
              <h3 style="margin:0">Backdated Orders</h3>
              <p class="muted" style="margin:6px 0 0">Orders entered later than the actual sale time. Click an order/receipt to open the full slip (print, PDF, send).</p>
            </div>
            <button type="button" class="btn btn-ghost" id="bd-admin-refresh">Refresh</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:16px 0">
            <div class="card" style="padding:12px"><div class="muted" style="font-size:12px">Entered today</div><strong>${s.today?.count || 0}</strong><div class="muted">${money(s.today?.total, cur)}</div></div>
            <div class="card" style="padding:12px"><div class="muted" style="font-size:12px">This week</div><strong>${s.week?.count || 0}</strong><div class="muted">${money(s.week?.total, cur)}</div></div>
            <div class="card" style="padding:12px"><div class="muted" style="font-size:12px">This month</div><strong>${s.month?.count || 0}</strong><div class="muted">${money(s.month?.total, cur)}</div></div>
          </div>
          <div class="card"><div class="card-body">
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:end">
              <div class="field" style="margin:0"><label>Entered from</label><input type="date" id="bd-f-from" value="${esc(this.filters.entered_from || this.weekFrom())}"></div>
              <div class="field" style="margin:0"><label>Entered to</label><input type="date" id="bd-f-to" value="${esc(this.filters.entered_to || today)}"></div>
              <button type="button" class="btn btn-primary" id="bd-f-apply">Filter</button>
              <button type="button" class="btn btn-ghost" id="bd-f-today">Entered today</button>
            </div>
            <div class="table-wrap"><table>
              <thead><tr>
                <th>Order / Receipt</th><th>Sale date</th><th>Entered</th><th>Amount</th>
                <th>Entered by</th><th>Authorized by</th><th>Branch</th><th>Reason</th>
              </tr></thead>
              <tbody>
                ${rows.length ? rows.map((r) => `
                  <tr>
                    <td>
                      <button type="button" class="btn btn-link bd-open-slip" data-id="${r.id}"
                        style="padding:0;border:0;background:none;color:var(--primary,#2563eb);font-weight:700;cursor:pointer;text-align:left;text-decoration:underline">
                        ${esc(r.receipt_number || r.order_number || '#' + r.id)}
                      </button>
                      ${r.order_number && r.receipt_number && r.order_number !== r.receipt_number
                        ? `<div class="muted" style="font-size:11px">Order ${esc(r.order_number)}</div>` : ''}
                      <span class="tag tag-warn" style="margin-left:4px">Backdated</span>
                    </td>
                    <td>${esc(fmtDt(r.sale_datetime))}</td>
                    <td>${esc(fmtDt(r.created_at))}</td>
                    <td>${money(r.total, cur)}</td>
                    <td>${esc(r.entered_by_name || r.cashier_name || '—')}</td>
                    <td>${esc(r.authorized_by_name || '—')}</td>
                    <td>${esc(r.branch_id || '—')}</td>
                    <td style="max-width:220px">${esc(r.backdated_reason || '—')}</td>
                  </tr>`).join('') : `<tr><td colspan="8" class="muted">No backdated orders in this range</td></tr>`}
              </tbody>
            </table></div>
          </div></div>
        </div>`;
      el.querySelector('#bd-admin-refresh')?.addEventListener('click', () => this.render(el, this.app));
      el.querySelectorAll('.bd-open-slip').forEach((btn) => {
        btn.addEventListener('click', () => this.openSlip(btn.dataset.id));
      });
      el.querySelector('#bd-f-apply')?.addEventListener('click', async () => {
        this.filters.entered_from = el.querySelector('#bd-f-from')?.value;
        this.filters.entered_to = el.querySelector('#bd-f-to')?.value;
        const listRes = await API.listBackdatedOrders({
          entered_from: this.filters.entered_from,
          entered_to: this.filters.entered_to,
          limit: 200
        }, this.app.user);
        this._rows = listRes.data || listRes || [];
        this.paint(el);
      });
      el.querySelector('#bd-f-today')?.addEventListener('click', async () => {
        this.filters.entered_from = today;
        this.filters.entered_to = today;
        const listRes = await API.listBackdatedOrders({ entered_from: today, entered_to: today, limit: 200 }, this.app.user);
        this._rows = listRes.data || listRes || [];
        this.paint(el);
      });
    }
  };

  window.BackdatedOrdersPage = BackdatedOrdersPage;
  if (typeof AdminPage !== 'undefined') {
    AdminPage.renderBackdatedOrders = function (el) {
      return BackdatedOrdersPage.render(el, AdminPage.app || window.App);
    };
  }
})();

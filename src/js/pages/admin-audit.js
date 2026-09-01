// Admin Sales Management, Audit & Business Health Dashboard
(function () {
  if (!window.AdminPage) return;

  const auditSections = [
    { id: 'overview', label: '🏠 Business Dashboard' },
    { id: 'salesmgmt', label: '💰 Sales Management' },
    { id: 'saleexplorer', label: '🔍 Sales Explorer' },
    { id: 'soldproducts', label: '📦 Sold Products' },
    { id: 'returnsmgmt', label: '↩️ Returns' },
    { id: 'activity', label: '📋 Activity Log' },
    { id: 'exceptions', label: '⚠️ Exceptions' },
    { id: 'alerts', label: '🔔 Alerts Center' },
    { id: 'dailyclose', label: '📊 Daily Closing' },
    { id: 'discount-report', label: '💸 Discount Report' }
  ];

  // Put audit sections first (idempotent on extender reload)
  if (!AdminPage.sections.some((s) => s.id === 'salesmgmt')) {
    AdminPage.sections = auditSections.concat(AdminPage.sections.filter(s => s.id !== 'overview'));
  }

  const origRenderSection = AdminPage.renderSection.bind(AdminPage);
  AdminPage.renderSection = async function (el) {
    const auditRenderers = {
      overview: () => this.renderBusinessDashboard(el),
      salesmgmt: () => this.renderSalesManagement(el),
      saleexplorer: () => this.renderSalesExplorer(el),
      soldproducts: () => this.renderSoldProducts(el),
      returnsmgmt: () => this.renderReturnsMgmt(el),
      activity: () => this.renderActivityLog(el),
      exceptions: () => this.renderExceptions(el),
      alerts: () => this.renderAlertsCenter(el),
      dailyclose: () => this.renderDailyClosing(el),
      'discount-report': () => this.renderDiscountReport(el)
    };
    if (auditRenderers[this.section]) {
      el.innerHTML = '<p class="muted">Loading…</p>';
      return auditRenderers[this.section]();
    }
    return origRenderSection(el);
  };

  AdminPage._liveTimer = null;

  AdminPage.renderBusinessDashboard = async function (el, from, to) {
    const rangeFrom = from || Utils.today();
    const rangeTo = to || Utils.today();
    const isToday = rangeFrom === Utils.today() && rangeTo === Utils.today();
    const periodLabel = isToday ? 'Today' : `${Utils.formatDate(rangeFrom)} – ${Utils.formatDate(rangeTo)}`;
    el.innerHTML = `<div class="admin-section"><h3>Business Health Dashboard</h3>
      ${Utils.dateFilterHTML('biz-dash-filter', rangeFrom, rangeTo)}
      <p class="muted">Loading dashboard…</p></div>`;
    Utils.bindDateFilter('biz-dash-filter', (f, t) => this.renderBusinessDashboard(el, f, t));

    const res = await API.getAdminDashboard(rangeFrom, rangeTo);
    if (!res.success) {
      el.innerHTML = `<div class="admin-section"><h3>Business Health Dashboard</h3>
        ${Utils.dateFilterHTML('biz-dash-filter', rangeFrom, rangeTo)}
        <p style="color:var(--danger)">${res.error || 'Could not load dashboard data'}</p>
        <button class="btn btn-primary" id="dash-retry">Retry</button></div>`;
      Utils.bindDateFilter('biz-dash-filter', (f, t) => this.renderBusinessDashboard(el, f, t));
      document.getElementById('dash-retry')?.addEventListener('click', () => this.renderBusinessDashboard(el, rangeFrom, rangeTo));
      return;
    }
    const d = res.data || {};
    const currency = this.settings.currency || 'R';
    const alertNav = { inventory: ['products'], shifts: ['staffhr'], returns: ['returnsmgmt'], backup: ['backup'], po: ['purchase-orders'], leave: ['staffhr'] };
    el.innerHTML = `<div class="admin-section"><h3>Business Health Dashboard</h3>
      ${Utils.dateFilterHTML('biz-dash-filter', rangeFrom, rangeTo)}
      ${(d.alerts || []).map((a, i) => `<div class="alert-banner alert-${a.level} dash-alert" data-action="${a.action || ''}" style="padding:10px 14px;margin-bottom:8px;border-radius:8px;cursor:${a.action ? 'pointer' : 'default'};background:${a.level==='red'?'#fef2f2':'#fffbeb'};border:1px solid ${a.level==='red'?'#fecaca':'#fde68a'}">${a.level==='red'?'🔴':'🟡'} ${a.message}</div>`).join('')}
      ${d.pendingLeave > 0 ? `<div class="alert-banner dash-alert" data-action="leave" style="padding:10px 14px;margin-bottom:8px;border-radius:8px;cursor:pointer;background:#eff6ff;border:1px solid #bfdbfe">📋 ${d.pendingLeave} leave request(s) pending approval</div>` : ''}
      <div class="stats-grid" style="margin-top:12px">
        <div class="stat-card primary"><div class="label">${isToday ? "Today's Sales" : 'Period Sales'}</div><div class="value">${Utils.formatMoney(d.today?.sales||0,currency)}</div><small>${d.today?.orders||0} orders · ${periodLabel}</small></div>
        <div class="stat-card"><div class="label">Yesterday</div><div class="value">${Utils.formatMoney(d.yesterday?.sales||0,currency)}</div></div>
        <div class="stat-card"><div class="label">This Month</div><div class="value">${Utils.formatMoney(d.month?.sales||0,currency)}</div></div>
        <div class="stat-card success"><div class="label">${isToday ? 'Gross Profit Today' : 'Gross Profit'}</div><div class="value">${Utils.formatMoney(d.today?.grossProfit||0,currency)}</div></div>
        <div class="stat-card"><div class="label">${isToday ? 'Net Profit Today' : 'Net Profit'}</div><div class="value">${Utils.formatMoney(d.today?.netProfit||0,currency)}</div></div>
        <div class="stat-card"><div class="label">Products Sold</div><div class="value">${d.today?.items||0}</div></div>
        <div class="stat-card"><div class="label">Avg Order</div><div class="value">${Utils.formatMoney(d.today?.avgOrder||0,currency)}</div></div>
        <div class="stat-card warning"><div class="label">${isToday ? 'Refunds Today' : 'Refunds'}</div><div class="value">${Utils.formatMoney(d.today?.refunds||0,currency)}</div></div>
        <div class="stat-card"><div class="label">${isToday ? 'Discounts Today' : 'Discounts'}</div><div class="value">${Utils.formatMoney(d.today?.discounts||0,currency)}</div></div>
        <div class="stat-card"><div class="label">Inventory Value</div><div class="value">${Utils.formatMoney(d.inventoryValue||0,currency)}</div></div>
        <div class="stat-card"><div class="label">Open Shifts</div><div class="value">${d.openShifts||0}</div></div>
        <div class="stat-card"><div class="label">Closed Today</div><div class="value">${d.closedShifts||0}</div></div>
        <div class="stat-card warning"><div class="label">Pending Leave</div><div class="value">${d.pendingLeave||0}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div class="card"><div class="card-header"><h3>🔴 Live Sales Monitor</h3></div><div class="card-body" id="live-sales-feed" style="max-height:280px;overflow-y:auto">
          ${this.renderLiveFeed(d.recentSales, currency, isToday)}
        </div></div>
        <div class="card"><div class="card-header"><h3>Recent Activity</h3></div><div class="card-body" style="max-height:280px;overflow-y:auto">
          ${(d.recentActivity||[]).map(e => `<div style="padding:6px 0;border-bottom:1px solid var(--border)"><small class="muted">${Utils.formatDateTime(e.time)}</small><br><strong>${e.user||'System'}</strong> — ${e.action} ${e.detail?`<small>${typeof e.detail==='string'?e.detail:''}</small>`:''}</div>`).join('')||'<p class="muted">No activity</p>'}
        </div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:16px">
        <div class="card"><div class="card-header"><h3>Top 10 Products${isToday ? ' Today' : ''}</h3></div><div class="card-body">
          ${(d.topProducts||[]).map((p,i)=>`<div style="padding:4px 0">${i+1}. ${p.product_name} — ${p.qty} sold (${Utils.formatMoney(p.revenue,currency)})</div>`).join('')||'<p class="muted">No sales yet</p>'}
        </div></div>
        <div class="card"><div class="card-header"><h3>Payment Methods</h3></div><div class="card-body">
          ${(d.paymentBreakdown||[]).map(p=>`<div style="padding:4px 0">${Utils.paymentLabels?.[p.payment_type]||p.payment_type}: ${Utils.formatMoney(p.total,currency)}</div>`).join('')||'<p class="muted">—</p>'}
        </div></div>
        <div class="card"><div class="card-header"><h3>Cashier Performance</h3></div><div class="card-body">
          ${(d.cashierPerf||[]).map(c=>`<div style="padding:4px 0">${c.full_name}: ${c.orders} orders — ${Utils.formatMoney(c.revenue,currency)}</div>`).join('')||'<p class="muted">—</p>'}
        </div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div class="card"><div class="card-header"><h3>Low Stock</h3></div><div class="card-body">
          ${(d.lowStock||[]).map(p=>`<div style="padding:4px 0;color:var(--warning)">${p.name}: ${p.stock_quantity} (min ${p.min_stock})</div>`).join('')||'<p class="muted">All good</p>'}
        </div></div>
        <div class="card"><div class="card-header"><h3>Out of Stock</h3></div><div class="card-body">
          ${(d.outOfStock||[]).map(p=>`<div style="padding:4px 0;color:var(--danger)">${p.name}</div>`).join('')||'<p class="muted">None</p>'}
        </div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-header"><h3>${isToday ? 'Hourly Sales Today' : 'Sales Trend'}</h3></div><div class="card-body">
        ${isToday
          ? `<div style="display:flex;flex-wrap:wrap;gap:8px">${(d.hourlySales||[]).map(h=>`<div style="padding:8px 12px;background:var(--bg-secondary);border-radius:8px"><strong>${h.hour}:00</strong><br>${Utils.formatMoney(h.total,currency)}</div>`).join('')||'<p class="muted">No data</p>'}</div>`
          : this.renderSalesChart(d.salesGraph || [], currency)}
        </div></div>
      ${isToday ? `<div class="card" style="margin-top:16px"><div class="card-header"><h3>Sales Trend (Selected Period)</h3></div><div class="card-body">
        ${this.renderSalesChart(d.salesGraph || [], currency)}
      </div></div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div class="card"><div class="card-header"><h3>Top Categories${isToday ? ' Today' : ''}</h3></div><div class="card-body">
          ${(d.topCategories||[]).map(c=>`<div style="padding:4px 0">${c.category_name}: ${Utils.formatMoney(c.revenue,currency)} (${c.qty} sold)</div>`).join('')||'<p class="muted">No data</p>'}
        </div></div>
        <div class="card"><div class="card-header"><h3>Most Returned (30 days)</h3></div><div class="card-body">
          ${(d.mostReturned||[]).map(p=>`<div style="padding:4px 0">${p.product_name}: ${p.qty} returns (${Utils.formatMoney(p.refund_total,currency)})</div>`).join('')||'<p class="muted">No returns</p>'}
        </div></div>
      </div>
    </div>`;

    el.querySelectorAll('.dash-alert').forEach(banner => {
      banner.addEventListener('click', () => {
        const action = banner.dataset.action;
        if (action === 'leave' || action === 'shifts') {
          this.section = 'staffhr';
          this.staffTab = action === 'shifts' ? 'shifts' : 'leave';
          document.querySelectorAll('.admin-nav-btn').forEach(n => n.classList.toggle('active', n.dataset.section === 'staffhr'));
          return this.renderSection(document.getElementById('admin-content'));
        }
        const page = alertNav[action];
        if (page?.[0] && ['products', 'purchase-orders'].includes(page[0])) {
          return this.app.navigate(page[0]);
        }
        if (page?.[0]) {
          this.section = page[0];
          document.querySelectorAll('.admin-nav-btn').forEach(n => n.classList.toggle('active', n.dataset.section === page[0]));
          return this.renderSection(document.getElementById('admin-content'));
        }
      });
    });

    Utils.bindDateFilter('biz-dash-filter', (f, t) => this.renderBusinessDashboard(el, f, t));

    clearInterval(this._liveTimer);
    this._liveTimer = setInterval(async () => {
      const feed = document.getElementById('live-sales-feed');
      if (!feed) { clearInterval(this._liveTimer); return; }
      const r = await API.getSalesList({ from: rangeFrom, to: rangeTo, limit: 15 });
      feed.innerHTML = this.renderLiveFeed(r.data || [], currency, isToday);
    }, 15000);
  };

  AdminPage.renderSalesChart = function (data, currency) {
    if (!data.length) return '<p class="muted">No sales data yet</p>';
    const max = Math.max(...data.map(d => d.total), 1);
    return `<div style="display:flex;align-items:flex-end;gap:4px;height:120px;padding-top:8px">
      ${data.slice(-14).map(d => {
        const h = Math.max(4, (d.total / max) * 100);
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
          <div style="width:100%;background:var(--primary);border-radius:4px 4px 0 0;height:${h}px" title="${Utils.formatMoney(d.total,currency)}"></div>
          <small style="font-size:9px;transform:rotate(-45deg);white-space:nowrap">${d.day?.slice(5)||''}</small>
        </div>`;
      }).join('')}
    </div>`;
  };

  AdminPage.renderLiveFeed = function (sales, currency, isToday) {
    return (sales || []).map(s => {
      const time = s.created_at ? new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const items = s.item_summary || '—';
      return `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
        <strong>${time}</strong> — ${items}<br>
        ${Utils.formatMoney(s.total, currency)} · ${s.primary_payment || s.payment_methods || '—'} · ${s.cashier_name || '—'}
        ${s.customer_name ? ` · ${s.customer_name}` : ''}
        <small class="muted"> (${s.receipt_number})</small>
      </div>`;
    }).join('') || `<p class="muted">No sales yet${isToday ? ' today' : ' in this period'}</p>`;
  };

  AdminPage.renderSalesManagement = async function (el) {
    const from = Utils.today(); const to = Utils.today();
    el.innerHTML = `<div class="admin-section"><h3>Sales Management</h3>
      ${Utils.dateFilterHTML('sales-mgmt-filter', from, to)}
      <div style="margin:12px 0;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="sales-mgmt-pdf">📄 Save PDF Report</button>
        <button class="btn btn-ghost" id="sales-mgmt-print">🖨️ Print</button>
      </div>
      <div id="sales-mgmt-table" style="margin-top:16px"><p class="muted">Loading…</p></div></div>`;

    let lastSales = [];
    let lastFrom = from;
    let lastTo = to;

    const load = async (f, t) => {
      lastFrom = f; lastTo = t;
      const res = await API.getSalesList({ from: f, to: t, limit: 500 });
      const sales = res.data || [];
      lastSales = sales;
      const currency = this.settings.currency || 'R';
      document.getElementById('sales-mgmt-table').innerHTML = `<div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Order #</th><th>Receipt</th><th>Date</th><th>Time</th><th>Cashier</th><th>Customer</th><th>Type</th><th>Payment</th><th>Gift Card</th><th>Loyalty Pts</th><th>Total</th><th>Discount</th><th>Tax</th><th>Status</th><th></th></tr></thead>
        <tbody>${sales.map(s => {
          const dt = s.created_at ? new Date(s.created_at) : null;
          const gc = Number(s.gift_card_amount) || 0;
          const lp = Number(s.loyalty_points_redeemed) || 0;
          const otype = s.order_type ? ({ delivery: 'Delivery', takeaway: 'Takeaway', sit_in: 'Sit-in', online: 'Online Order' }[s.order_type] || s.order_type) : 'Walk-in';
          const typeExtra = s.order_type === 'delivery' && s.delivery_address
            ? ` · ${s.delivery_address}`
            : (s.table_name ? ` · ${s.table_name}` : '');
          return `<tr class="${s.status==='void'||s.status==='voided'?'row-void':''}">
          <td><strong>${s.order_number || '—'}</strong></td>
          <td>${s.receipt_number}</td>
          <td>${dt ? Utils.formatDate(s.created_at) : '—'}</td>
          <td>${dt ? dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
          <td>${s.cashier_name||'—'}</td>
          <td>${s.customer_name||'Walk-in'}</td>
          <td title="${(s.delivery_address || s.table_name || '').replace(/"/g, '&quot;')}">${otype}${typeExtra}</td>
          <td>${s.primary_payment||s.payment_methods||'—'}</td>
          <td>${gc ? Utils.formatMoney(gc,currency) : '—'}</td>
          <td>${lp ? lp + ' pts' : '—'}</td>
          <td>${Utils.formatMoney(s.total,currency)}</td>
          <td>${Utils.formatMoney(s.discount||0,currency)}</td>
          <td>${Utils.formatMoney(s.tax_amount||0,currency)}</td>
          <td><span class="tag ${s.status==='void'||s.status==='voided'?'tag-danger':s.status==='completed'?'tag-ok':''}">${s.status||'completed'}</span></td>
          <td><button class="btn btn-sm btn-ghost view-sale" data-id="${s.id}">View</button>
            <button class="btn btn-sm btn-ghost reprint-sale" data-id="${s.id}">Print</button>
            <button class="btn btn-sm btn-ghost invoice-sale" data-id="${s.id}">Invoice</button>
            <button class="btn btn-sm btn-ghost download-sale" data-id="${s.id}">PDF</button>
            ${s.status==='completed' && this.app.user?.role === 'owner' ? `<button class="btn btn-sm btn-ghost refund-sale" data-id="${s.id}">Refund</button>
            <button class="btn btn-sm btn-ghost void-sale" data-id="${s.id}">Void</button>`:''}
          </td></tr>`;
        }).join('')||'<tr><td colspan="15" class="muted">No sales found</td></tr>'}
        </tbody>
        <tfoot><tr style="font-weight:700;background:var(--bg-alt, #f5f5f5)">
          <td colspan="10">Totals (${sales.length} sale${sales.length === 1 ? '' : 's'})</td>
          <td>${Utils.formatMoney(sales.reduce((n,s)=>n+Number(s.total||0),0),currency)}</td>
          <td>${Utils.formatMoney(sales.reduce((n,s)=>n+Number(s.discount||0),0),currency)}</td>
          <td>${Utils.formatMoney(sales.reduce((n,s)=>n+Number(s.tax_amount||0),0),currency)}</td>
          <td colspan="2"></td>
        </tr></tfoot></table></div>
        <p class="muted" style="padding:12px">${sales.length} sale(s) — gift card and loyalty redemptions shown when used on POS.</p></div>`;

      el.querySelectorAll('.view-sale').forEach(b => b.addEventListener('click', () => this.showSaleDetail(parseInt(b.dataset.id))));
      el.querySelectorAll('.reprint-sale').forEach(b => b.addEventListener('click', async () => {
        const r = await API.getSale(parseInt(b.dataset.id));
        if (r.data) await Receipt.print(r.data, this.settings);
      }));
      el.querySelectorAll('.invoice-sale').forEach(b => b.addEventListener('click', async () => {
        const r = await API.getSale(parseInt(b.dataset.id));
        if (r.data) await Receipt.print(r.data, this.settings, 'INVOICE');
      }));
      el.querySelectorAll('.download-sale').forEach(b => b.addEventListener('click', async () => {
        const r = await API.getSale(parseInt(b.dataset.id));
        if (r.data) await Receipt.downloadPdf(r.data, this.settings);
      }));
      el.querySelectorAll('.refund-sale').forEach(b => b.addEventListener('click', () => {
        this.app.navigate('returns');
      }));
      el.querySelectorAll('.void-sale').forEach(b => b.addEventListener('click', () => {
        Utils.showModal('Void Sale', '<div class="field"><label>Reason (required)</label><textarea id="void-reason" rows="3"></textarea></div>',
          '<button class="btn btn-danger" id="confirm-void">Void Sale</button>');
        document.getElementById('confirm-void').addEventListener('click', async () => {
          const reason = document.getElementById('void-reason').value.trim();
          if (!reason) return Utils.toast('Reason required', 'error');
          const r = await API.voidSale(parseInt(b.dataset.id), reason, this.app.user);
          if (!r.success) return Utils.toast(r.error, 'error');
          Utils.hideModal(); Utils.toast('Sale voided', 'success'); load(f, t);
        });
      }));
    };
    Utils.bindDateFilter('sales-mgmt-filter', load);
    document.getElementById('sales-mgmt-pdf')?.addEventListener('click', async () => {
      const currency = this.settings.currency || 'R';
      const headers = ['Order #', 'Receipt', 'Date', 'Time', 'Cashier', 'Customer', 'Type', 'Payment', 'Total', 'Discount', 'Tax', 'Status'];
      const rows = lastSales.map((s) => {
        const dt = s.created_at ? new Date(s.created_at) : null;
        const otype = s.order_type ? ({ delivery: 'Delivery', takeaway: 'Takeaway', sit_in: 'Sit-in', online: 'Online' }[s.order_type] || s.order_type) : 'Walk-in';
        return [
          s.order_number || '',
          s.receipt_number || '',
          dt ? Utils.formatDate(s.created_at) : '',
          dt ? dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
          s.cashier_name || '',
          s.customer_name || 'Walk-in',
          otype,
          s.primary_payment || s.payment_methods || '',
          Utils.formatMoney(s.total, currency),
          Utils.formatMoney(s.discount || 0, currency),
          Utils.formatMoney(s.tax_amount || 0, currency),
          s.status || ''
        ];
      });
      const totalSales = lastSales.reduce((n, s) => n + Number(s.total || 0), 0);
      rows.push(['', '', '', '', '', '', 'TOTALS', `${lastSales.length} sales`, Utils.formatMoney(totalSales, currency), '', '', '']);
      const title = `Sales Report ${lastFrom} to ${lastTo} — saved ${new Date().toLocaleString()}`;
      if (typeof Export?.toPDF === 'function') {
        await Export.toPDF(`sales-report-${lastFrom}-${lastTo}.pdf`, title, headers, rows, {
          shop_name: this.settings?.shop_name,
          logo_path: this.settings?.logo_path
        });
      } else {
        Utils.toast('PDF export not available', 'error');
      }
    });
    document.getElementById('sales-mgmt-print')?.addEventListener('click', () => {
      const currency = this.settings.currency || 'R';
      const totalSales = lastSales.reduce((n, s) => n + Number(s.total || 0), 0);
      const html = `<h2>${Utils.escHtml(this.settings?.shop_name || 'Shop')} — Sales Report</h2>
        <p>Period: ${lastFrom} to ${lastTo} · Generated: ${new Date().toLocaleString()} · ${lastSales.length} sales · Total ${Utils.formatMoney(totalSales, currency)}</p>
        <table border="1" cellpadding="5" style="border-collapse:collapse;width:100%;font-size:11px">
        <tr><th>Receipt</th><th>Date</th><th>Cashier</th><th>Customer</th><th>Total</th><th>Tax</th><th>Status</th></tr>
        ${lastSales.map((s) => `<tr><td>${Utils.escHtml(s.receipt_number)}</td><td>${Utils.formatDateTime(s.created_at)}</td><td>${Utils.escHtml(s.cashier_name || '')}</td><td>${Utils.escHtml(s.customer_name || 'Walk-in')}</td><td>${Utils.formatMoney(s.total, currency)}</td><td>${Utils.formatMoney(s.tax_amount || 0, currency)}</td><td>${Utils.escHtml(s.status)}</td></tr>`).join('')}
        </table>`;
      if (typeof Export?.print === 'function') Export.print(html, 'Sales Report');
      else window.print();
    });
    load(from, to);
  };

  AdminPage.showSaleDetail = async function (saleId) {
    const res = await API.getSale(saleId);
    if (!res.success) return Utils.toast(res.error || 'Could not load sale', 'error');
    const s = res.data;
    if (!s) return Utils.toast('Sale not found', 'error');
    const currency = this.settings.currency || 'R';
    const otype = s.order_type ? ({ delivery: 'Delivery', takeaway: 'Takeaway', sit_in: 'Sit-in', online: 'Online Order' }[s.order_type] || s.order_type) : 'Walk-in';
    Utils.showModal(`Receipt ${s.receipt_number}`, `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div><strong>Order #</strong><br>${s.order_number || '—'}</div>
        <div><strong>Receipt</strong><br>${s.receipt_number}</div>
        <div><strong>Date</strong><br>${Utils.formatDateTime(s.created_at)}</div>
        <div><strong>Cashier</strong><br>${s.cashier_name||'—'}</div>
        <div><strong>Customer</strong><br>${s.customer_name||'Walk-in Customer'}</div>
        <div><strong>Order type</strong><br>${otype}${s.table_name ? ` · Table ${s.table_name}` : ''}</div>
        ${s.delivery_address ? `<div class="full" style="grid-column:1/-1"><strong>Delivery address</strong><br>${s.delivery_address}</div>` : ''}
        <div><strong>Status</strong><br>${s.status||'completed'}${s.void_reason?` (${s.void_reason})`:''}</div>
        ${s.notes ? `<div class="full" style="grid-column:1/-1"><strong>Notes</strong><br>${s.notes}</div>` : ''}
      </div>
      <h4>Items Purchased</h4>
      <table style="width:100%;margin:8px 0"><tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr>
      ${(s.items||[]).map(i=>`<tr><td>${i.product_name}</td><td>${i.quantity}</td><td>${Utils.formatMoney(i.unit_price,currency)}</td><td>${Utils.formatMoney(i.total,currency)}</td></tr>`).join('')}
      </table>
      <div style="margin-top:12px">
        <div>Subtotal: ${Utils.formatMoney(s.subtotal,currency)}</div>
        <div>Discount: ${Utils.formatMoney(s.discount||0,currency)}</div>
        <div>Tax: ${Utils.formatMoney(s.tax_amount||0,currency)}</div>
        <div><strong>Total: ${Utils.formatMoney(s.total,currency)}</strong></div>
        <div>Paid: ${Utils.formatMoney(s.amount_paid,currency)}</div>
        <div>Change: ${Utils.formatMoney(s.change_amount||0,currency)}</div>
        <div>Payment: ${(s.payments||[]).map(p=>`${p.payment_type} ${Utils.formatMoney(p.amount,currency)}`).join(', ')}</div>
        ${s.gift_card_amount ? `<div>Gift Card Used: ${Utils.formatMoney(s.gift_card_amount,currency)}</div>` : ''}
        ${s.loyalty_points_redeemed ? `<div>Loyalty Redeemed: ${s.loyalty_points_redeemed} pts</div>` : ''}
        ${s.loyalty_points_earned ? `<div>Loyalty Earned: ${s.loyalty_points_earned} pts</div>` : ''}
      </div>`,
      `<button class="btn btn-primary" id="sd-print">Print Receipt</button>
       <button class="btn btn-ghost" id="sd-invoice">Print Invoice</button>
       <button class="btn btn-ghost" id="sd-reprint">Reprint</button>
       <button class="btn btn-ghost" id="sd-download">Download PDF</button>
       ${s.status==='completed'?`<button class="btn btn-warning" id="sd-refund">Refund</button>`:''}`);
    document.getElementById('sd-print')?.addEventListener('click', () => Receipt.print(s, this.settings));
    document.getElementById('sd-invoice')?.addEventListener('click', () => Receipt.print(s, this.settings, 'INVOICE'));
    document.getElementById('sd-reprint')?.addEventListener('click', () => Receipt.print(s, this.settings));
    document.getElementById('sd-download')?.addEventListener('click', () => Receipt.downloadPdf(s, this.settings));
    document.getElementById('sd-refund')?.addEventListener('click', () => { Utils.hideModal(); this.app.navigate('returns'); });
  };

  AdminPage.renderSalesExplorer = async function (el) {
    el.innerHTML = `<div class="admin-section"><h3>Sales Explorer</h3>
      <p class="muted">Search any sale by receipt, product, cashier, payment, date or amount.</p>
      <div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label>Receipt Number</label><input id="se-receipt"></div>
        <div class="field"><label>Product Name</label><input id="se-product"></div>
        <div class="field"><label>Customer Name</label><input id="se-customer"></div>
        <div class="field"><label>Cashier Name</label><input id="se-cashier"></div>
        <div class="field"><label>Payment Method</label><select id="se-payment"><option value="">All</option>${Utils.paymentTypes.map(t=>`<option value="${t}">${Utils.paymentLabels[t]}</option>`).join('')}</select></div>
        <div class="field"><label>From Date</label><input type="date" id="se-from" value="${Utils.monthStart()}"></div>
        <div class="field"><label>To Date</label><input type="date" id="se-to" value="${Utils.today()}"></div>
        <div class="field"><label>From Time</label><input type="time" id="se-time-from"></div>
        <div class="field"><label>To Time</label><input type="time" id="se-time-to"></div>
        <div class="field"><label>Min Amount</label><input type="number" id="se-min" step="0.01"></div>
        <div class="field"><label>Max Amount</label><input type="number" id="se-max" step="0.01"></div>
        <div class="field"><label>Status</label><select id="se-status"><option value="">All</option><option value="completed">Completed</option><option value="void">Void</option></select></div>
      </div>
      <button class="btn btn-primary" id="se-search" style="margin-top:12px">Search</button>
      </div></div><div id="se-results" style="margin-top:16px"></div></div>`;

    document.getElementById('se-search').addEventListener('click', async () => {
      const filters = {
        receipt: document.getElementById('se-receipt').value.trim(),
        product: document.getElementById('se-product').value.trim(),
        customer: document.getElementById('se-customer').value.trim(),
        cashier: document.getElementById('se-cashier').value.trim(),
        payment_type: document.getElementById('se-payment').value,
        from: document.getElementById('se-from').value,
        to: document.getElementById('se-to').value,
        time_from: document.getElementById('se-time-from').value || undefined,
        time_to: document.getElementById('se-time-to').value || undefined,
        min_amount: parseFloat(document.getElementById('se-min').value) || undefined,
        max_amount: parseFloat(document.getElementById('se-max').value) || undefined,
        status: document.getElementById('se-status').value || undefined,
        limit: 200
      };
      const res = await API.searchSales(filters);
      const sales = res.data || [];
      const currency = this.settings.currency || 'R';
      document.getElementById('se-results').innerHTML = `<div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Receipt</th><th>Date</th><th>Cashier</th><th>Customer</th><th>Payment</th><th>Total</th><th>Status</th><th></th></tr></thead>
        <tbody>${sales.map(s=>`<tr><td>${s.receipt_number}</td><td>${Utils.formatDateTime(s.created_at)}</td><td>${s.cashier_name||'—'}</td>
          <td>${s.customer_name||'Walk-in'}</td><td>${s.primary_payment||'—'}</td><td>${Utils.formatMoney(s.total,currency)}</td><td>${s.status}</td>
          <td><button class="btn btn-sm view-sale-exp" data-id="${s.id}">View</button></td></tr>`).join('')||'<tr><td colspan="8" class="muted">No results</td></tr>'}
        </tbody></table></div><p class="muted" style="padding:12px">${sales.length} result(s)</p></div>`;
      document.querySelectorAll('.view-sale-exp').forEach(b => b.addEventListener('click', () => this.showSaleDetail(parseInt(b.dataset.id))));
    });
  };

  AdminPage.renderSoldProducts = async function (el) {
    el.innerHTML = `<div class="admin-section"><h3>Sold Products Report</h3>
      ${Utils.dateFilterHTML('sold-prod-filter')}
      <div style="margin:12px 0;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="sold-pdf">📄 Save PDF</button>
        <button class="btn btn-ghost" id="sold-print">🖨️ Print</button>
      </div>
      <div id="sold-prod-content" style="margin-top:16px"></div></div>`;
    let lastProducts = [];
    let lastFrom = Utils.monthStart();
    let lastTo = Utils.today();
    const currency = this.settings.currency || 'R';
    const load = async (from, to) => {
      lastFrom = from; lastTo = to;
      const [prodRes, lowRes] = await Promise.all([API.getSoldProductsReport(from, to), API.getLowPerformanceProducts(30)]);
      const products = prodRes.data || [];
      lastProducts = products;
      const lowPerf = lowRes.data || [];
      document.getElementById('sold-prod-content').innerHTML = `
        <div class="card"><div class="table-wrap"><table>
          <thead><tr><th>Product</th><th>Qty Sold</th><th>Revenue</th><th>Profit</th></tr></thead>
          <tbody>${products.map(p=>`<tr><td>${p.product_name}</td><td>${p.qty_sold}</td>
            <td>${Utils.formatMoney(p.revenue,currency)}</td><td>${Utils.formatMoney(p.profit,currency)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No data</td></tr>'}
          </tbody></table></div></div>
        <div class="card" style="margin-top:16px"><div class="card-header"><h3>Low Performance Products (30 days)</h3></div><div class="card-body">
          ${lowPerf.map(p=>`<div style="padding:8px 0;border-bottom:1px solid var(--border)">
            <strong>${p.name}</strong> — Stock: ${p.stock_quantity} — Last sold: ${p.last_sold?Utils.formatDate(p.last_sold):'Never'}
            <br><small class="muted">Recommendation: Create promotion</small></div>`).join('')||'<p class="muted">All products selling well</p>'}
        </div></div>`;
    };
    const exportRows = () => lastProducts.map(p => [
      p.product_name, String(p.qty_sold), Utils.formatMoney(p.revenue, currency), Utils.formatMoney(p.profit, currency)
    ]);
    document.getElementById('sold-pdf')?.addEventListener('click', async () => {
      await Export.toPDF(`sold-products-${lastFrom}-${lastTo}.pdf`, `Sold Products ${lastFrom} – ${lastTo}`,
        ['Product', 'Qty Sold', 'Revenue', 'Profit'], exportRows(),
        { ...Utils.companyInfo(this.settings), dateRange: `${lastFrom} to ${lastTo}` });
      Utils.toast('PDF saved', 'success');
    });
    document.getElementById('sold-print')?.addEventListener('click', () => {
      Export.print(`Sold Products ${lastFrom} – ${lastTo}`, ['Product', 'Qty Sold', 'Revenue', 'Profit'], exportRows(),
        { ...Utils.companyInfo(this.settings), dateRange: `${lastFrom} to ${lastTo}` });
    });
    Utils.bindDateFilter('sold-prod-filter', load);
    load(Utils.monthStart(), Utils.today());
  };

  AdminPage.renderReturnsMgmt = async function (el) {
    const [listRes, reasonsRes] = await Promise.all([
      API.getReturnsList({ from: Utils.monthStart(), to: Utils.today(), limit: 200 }),
      API.getReturnReasonsReport(Utils.monthStart(), Utils.today())
    ]);
    const returns = listRes.data || [];
    const reasons = reasonsRes.data || [];
    const currency = this.settings.currency || 'R';
    el.innerHTML = `<div class="admin-section"><h3>Returns Management</h3>
      <p class="muted">Every return is recorded permanently — nothing disappears.</p>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><h3>Return Reasons (This Month)</h3></div><div class="card-body">
        ${reasons.map(r=>`<div style="padding:4px 0">${r.reason}: ${r.count} times (${Utils.formatMoney(r.total_refund,currency)})</div>`).join('')||'<p class="muted">No returns this month</p>'}
      </div></div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Return #</th><th>Receipt</th><th>Date</th><th>Reason</th><th>Refund</th><th>Cashier</th><th>Approved By</th><th>Status</th><th></th></tr></thead>
        <tbody>${returns.map(r=>`<tr>
          <td>${r.return_number||'—'}</td><td>${r.receipt_number||'—'}</td>
          <td>${Utils.formatDateTime(r.created_at)}</td><td>${r.reason||'—'}</td>
          <td>${Utils.formatMoney(r.total_refund,currency)}</td><td>${r.user_name||'—'}</td>
          <td>${r.approved_by_name||'—'}</td><td>${r.status||'completed'}</td>
          <td><button class="btn btn-sm view-ret" data-id="${r.id}">View</button></td></tr>`).join('')||'<tr><td colspan="9" class="muted">No returns</td></tr>'}
        </tbody></table></div></div></div>`;
    el.querySelectorAll('.view-ret').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getReturnDetail(parseInt(b.dataset.id));
      const ret = r.data;
      Utils.showModal(`Return ${ret.return_number||ret.id}`, `
        <p><strong>Original Receipt:</strong> ${ret.receipt_number}</p>
        <p><strong>Reason:</strong> ${ret.reason}</p>
        <p><strong>Refund:</strong> ${Utils.formatMoney(ret.total_refund,currency)} via ${ret.refund_method||'cash'}</p>
        <p><strong>Return to stock:</strong> ${ret.return_to_stock?'Yes':'No'} ${ret.stock_reason?`(${ret.stock_reason})`:''}</p>
        <p><strong>Status:</strong> ${ret.status||'completed'}</p>
        <h4>Items Returned</h4>
        <ul>${(ret.items||[]).map(i=>`<li>${i.product_name} × ${i.quantity} — ${Utils.formatMoney(i.total,currency)}</li>`).join('')}</ul>`,
        `<button class="btn btn-primary" id="print-ret">Print Return Receipt</button>
         <button class="btn btn-ghost" id="pdf-ret">Download PDF</button>
         ${ret.status==='completed'?`<button class="btn btn-warning" id="reopen-ret">Reopen Return</button>`:''}`);
      document.getElementById('print-ret')?.addEventListener('click', () => {
        Export.print(`Return ${ret.return_number}`, ['Item','Qty','Total'],
          (ret.items||[]).map(i => [i.product_name, String(i.quantity), Utils.formatMoney(i.total, currency)]),
          Utils.companyInfo(this.settings));
      });
      document.getElementById('pdf-ret')?.addEventListener('click', async () => {
        await Export.toPDF(`Return-${ret.return_number||ret.id}.pdf`, `Return ${ret.return_number}`,
          ['Item','Qty','Total'], (ret.items||[]).map(i => [i.product_name, String(i.quantity), Utils.formatMoney(i.total, currency)]),
          Utils.companyInfo(this.settings));
        Utils.toast('Return PDF saved', 'success');
      });
      document.getElementById('reopen-ret')?.addEventListener('click', async () => {
        const res = await API.reopenReturn(ret.id, this.app.user);
        if (!res.success) return Utils.toast(res.error, 'error');
        Utils.hideModal();
        Utils.toast('Return reopened', 'success');
        this.renderReturnsMgmt(el);
      });
    }));
  };

  AdminPage.renderActivityLog = async function (el) {
    el.innerHTML = `<div class="admin-section"><h3>Activity Log & Audit Trail</h3>
      ${Utils.dateFilterHTML('activity-filter')}
      <div id="activity-content" style="margin-top:16px"></div></div>`;
    const load = async (from, to) => {
      const [timelineRes, auditRes, priceRes, stockRes] = await Promise.all([
        API.getActivityTimeline(from, to), API.getAuditLog(100), API.getPriceHistory(50), API.getMovementReport(from, to)
      ]);
      document.getElementById('activity-content').innerHTML = `
        <div class="card"><div class="card-header"><h3>Daily Timeline</h3></div><div class="card-body" style="max-height:400px;overflow-y:auto">
          ${(timelineRes.data||[]).map(e=>`<div style="padding:8px 0;border-bottom:1px solid var(--border)">
            <strong>${Utils.formatDateTime(e.time)}</strong> — ${e.user||'System'}: ${e.action}
            ${e.detail?`<br><small class="muted">${typeof e.detail==='string'?e.detail.slice(0,120):JSON.stringify(e.detail).slice(0,120)}</small>`:''}
          </div>`).join('')||'<p class="muted">No activity</p>'}
        </div></div>
        <div class="card" style="margin-top:16px"><div class="card-header"><h3>Price Change History</h3></div><div class="card-body">
          ${(priceRes.data||[]).map(p=>`<div style="padding:4px 0">${p.product_name}: ${Utils.formatMoney(p.old_price,this.settings.currency)} → ${Utils.formatMoney(p.new_price,this.settings.currency)} by ${p.changed_by_name||'—'} (${Utils.formatDateTime(p.created_at)})</div>`).join('')||'<p class="muted">No price changes</p>'}
        </div></div>
        <div class="card" style="margin-top:16px"><div class="card-header"><h3>Stock Movement History</h3></div><div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Qty</th><th>Notes</th><th>User</th></tr></thead>
          <tbody>${(stockRes.data||[]).slice(0,50).map(m=>`<tr><td>${Utils.formatDateTime(m.created_at)}</td><td>${m.product_name}</td>
            <td>${m.movement_type}</td><td>${m.quantity}</td><td>${m.notes||'—'}</td><td>${m.user_name||'—'}</td></tr>`).join('')||'<tr><td colspan="6" class="muted">No movements</td></tr>'}
          </tbody></table></div></div>`;
    };
    Utils.bindDateFilter('activity-filter', load);
    load(Utils.today(), Utils.today());
  };

  AdminPage.renderExceptions = async function (el) {
    el.innerHTML = `<div class="admin-section"><h3>Exception Report</h3>
      ${Utils.dateFilterHTML('exc-filter')}
      <div id="exc-content" style="margin-top:16px"></div></div>`;
    const load = async (from, to) => {
      const res = await API.getExceptionReport(from, to);
      const e = res.data || {};
      const currency = this.settings.currency || 'R';
      document.getElementById('exc-content').innerHTML = `
        <div class="card"><div class="card-header"><h3>High Discounts (&gt;20%)</h3></div><div class="card-body">
          ${(e.highDiscounts||[]).map(s=>`<div>${s.receipt_number}: discount ${Utils.formatMoney(s.discount,currency)} on ${Utils.formatMoney(s.total,currency)}</div>`).join('')||'<p class="muted">None</p>'}
        </div></div>
        <div class="card" style="margin-top:12px"><div class="card-header"><h3>Voided Sales</h3></div><div class="card-body">
          ${(e.voidedSales||[]).map(s=>`<div>${s.receipt_number}: ${Utils.formatMoney(s.total,currency)} — ${s.void_reason||'—'}</div>`).join('')||'<p class="muted">None</p>'}
        </div></div>
        <div class="card" style="margin-top:12px"><div class="card-header"><h3>Large Refunds</h3></div><div class="card-body">
          ${(e.largeRefunds||[]).map(r=>`<div>${r.return_number||r.receipt_number}: ${Utils.formatMoney(r.total_refund,currency)} — ${r.reason} (${r.user_name})</div>`).join('')||'<p class="muted">None</p>'}
        </div></div>
        <div class="card" style="margin-top:12px"><div class="card-header"><h3>Negative Stock</h3></div><div class="card-body">
          ${(e.negativeStock||[]).map(p=>`<div style="color:var(--danger)">${p.name}: ${p.stock_quantity}</div>`).join('')||'<p class="muted">None</p>'}
        </div></div>`;
    };
    Utils.bindDateFilter('exc-filter', load);
    load(Utils.monthStart(), Utils.today());
  };

  AdminPage.renderAlertsCenter = async function (el) {
    const res = await API.getAdminAlerts();
    const alerts = res.data || [];
    const actionBtn = (a) => {
      const map = {
        inventory: ['Stock', 'stock'],
        shifts: ['Shifts', 'admin-staff'],
        returns: ['Returns', 'returns'],
        po: ['Purchase Orders', 'purchase-orders'],
        backup: ['Backup', 'backup']
      };
      const m = map[a.action];
      if (!m) return '';
      return `<button class="btn btn-sm btn-primary alert-go" data-page="${m[1]}">${m[0]}</button>`;
    };
    el.innerHTML = `<div class="admin-section"><h3>Alerts & Action Center</h3>
      <p class="muted">Issues that need your attention right now.</p>
      <div style="margin-top:16px">
        ${alerts.length ? alerts.map(a => `<div class="card" style="margin-bottom:8px;border-color:${a.level === 'red' ? 'var(--danger)' : 'var(--warning)'}">
          <div class="card-body" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
            <div style="display:flex;align-items:center;gap:12px">
              <span style="font-size:24px">${a.level === 'red' ? '🔴' : '🟡'}</span>
              <div><strong>${a.message}</strong></div>
            </div>
            ${actionBtn(a)}
          </div></div>`).join('') : '<div class="card"><div class="card-body"><p style="color:var(--success)">✅ All clear — no alerts at this time.</p></div></div>'}
      </div></div>`;
    el.querySelectorAll('.alert-go').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.page === 'admin-staff') {
        this.app.navigateToAdminSection?.('staffhr', 'shifts') || this.app.navigate('admin');
        return;
      }
      if (b.dataset.page === 'backup') {
        this.app.navigateToAdminSection?.('backup') || this.app.navigate('admin');
        return;
      }
      this.app.navigate(b.dataset.page);
    }));
  };

  AdminPage.renderDailyClosing = async function (el) {
    el.innerHTML = `<div class="admin-section"><h3>Daily Closing Report (Z-Read)</h3>
      <div class="field" style="max-width:200px"><label>Date</label><input type="date" id="close-date" value="${Utils.today()}"></div>
      <button class="btn btn-primary" id="load-close" style="margin-top:8px">Generate Report</button>
      <div id="close-content" style="margin-top:16px"></div></div>`;

    const load = async () => {
      const date = document.getElementById('close-date').value;
      const res = await API.getDailyClosingReport(date);
      const r = res.data || {};
      const currency = this.settings.currency || 'R';
      const payTypes = (r.paymentsByType || []).map(p =>
        `<div class="stat-card"><div class="label">${(p.payment_type || 'other').toUpperCase()}</div><div class="value">${Utils.formatMoney(p.total, currency)}</div><small>${p.count} payments</small></div>`
      ).join('');
      const orderTypes = (r.byOrderType || []).map(o =>
        `<div style="padding:6px 0;border-bottom:1px solid var(--border)">${({ walk_in: 'Walk-in', delivery: 'Delivery', takeaway: 'Takeaway', sit_in: 'Sit-in', online: 'Online Order' }[o.order_type] || o.order_type)}: <strong>${Utils.formatMoney(o.total, currency)}</strong> (${o.count})</div>`
      ).join('');
      const salesRows = (r.sales || []).map(s => `<tr>
        <td>${s.order_number || '—'}</td><td>${s.receipt_number}</td>
        <td>${Utils.formatDateTime(s.created_at)}</td><td>${s.cashier_name || '—'}</td>
        <td>${s.customer_name || 'Walk-in'}</td>
        <td>${s.order_type || 'walk_in'}${s.table_name ? ` · ${s.table_name}` : ''}</td>
        <td>${s.payments || '—'}</td>
        <td>${Utils.formatMoney(s.total, currency)}</td>
        <td>${s.status}</td></tr>`).join('');
      document.getElementById('close-content').innerHTML = `<div class="card"><div class="card-body">
        <h4>Closing Report — ${Utils.formatDate(date)}</h4>
        <div class="stats-grid" style="margin-top:16px">
          <div class="stat-card"><div class="label">Opening Float</div><div class="value">${Utils.formatMoney(r.openingFloat,currency)}</div></div>
          <div class="stat-card primary"><div class="label">Total Sales</div><div class="value">${Utils.formatMoney(r.totalSales,currency)}</div><small>${r.orderCount} orders</small></div>
          ${payTypes}
          <div class="stat-card warning"><div class="label">Refunds</div><div class="value">${Utils.formatMoney(r.refunds,currency)}</div></div>
          <div class="stat-card"><div class="label">Discounts</div><div class="value">${Utils.formatMoney(r.discounts,currency)}</div></div>
          <div class="stat-card"><div class="label">Expenses</div><div class="value">${Utils.formatMoney(r.expenses,currency)}</div></div>
          <div class="stat-card success"><div class="label">Profit</div><div class="value">${Utils.formatMoney(r.profit,currency)}</div></div>
          <div class="stat-card"><div class="label">Expected Cash</div><div class="value">${Utils.formatMoney(r.expectedCash,currency)}</div></div>
          <div class="stat-card"><div class="label">Counted Cash</div><div class="value">${Utils.formatMoney(r.actualCash,currency)}</div></div>
          <div class="stat-card ${r.cashDifference!==0?'danger':''}"><div class="label">Cash Difference</div><div class="value">${Utils.formatMoney(r.cashDifference,currency)}</div></div>
        </div>
        <h4 style="margin-top:20px">Sales by order type</h4>
        ${orderTypes || '<p class="muted">No sales</p>'}
        <h4 style="margin-top:20px">All sales (${(r.sales || []).length})</h4>
        <div class="table-wrap"><table>
          <thead><tr><th>Order #</th><th>Receipt</th><th>Time</th><th>Cashier</th><th>Customer</th><th>Type</th><th>Payments</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>${salesRows || '<tr><td colspan="9" class="muted">No sales</td></tr>'}</tbody>
        </table></div>
        ${r.closedBy?`<p style="margin-top:16px">Closed by: ${r.closedBy} at ${Utils.formatDateTime(r.closedAt)}</p>`:'<p class="muted" style="margin-top:16px">Shift not yet closed for this date.</p>'}
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost" id="print-close">Print Report</button>
          <button class="btn btn-primary" id="pdf-close">Save PDF</button>
        </div>
      </div></div>`;
      const summaryRows = [
        ['Opening Float', Utils.formatMoney(r.openingFloat, currency)],
        ['Total Sales', Utils.formatMoney(r.totalSales, currency)],
        ...(r.paymentsByType || []).map(p => [String(p.payment_type || '').toUpperCase(), Utils.formatMoney(p.total, currency)]),
        ['Refunds', Utils.formatMoney(r.refunds, currency)],
        ['Discounts', Utils.formatMoney(r.discounts, currency)],
        ['Expenses', Utils.formatMoney(r.expenses, currency)],
        ['Profit', Utils.formatMoney(r.profit, currency)],
        ['Expected Cash', Utils.formatMoney(r.expectedCash, currency)],
        ['Counted Cash', Utils.formatMoney(r.actualCash, currency)],
        ['Difference', Utils.formatMoney(r.cashDifference, currency)]
      ];
      const detailHeaders = ['Order #', 'Receipt', 'Time', 'Cashier', 'Customer', 'Type', 'Payments', 'Total', 'Status'];
      const detailRows = (r.sales || []).map(s => [
        s.order_number || '—', s.receipt_number, Utils.formatDateTime(s.created_at), s.cashier_name || '—',
        s.customer_name || 'Walk-in', s.order_type || 'walk_in', s.payments || '—',
        Utils.formatMoney(s.total, currency), s.status
      ]);
      document.getElementById('print-close')?.addEventListener('click', () => {
        Export.print(`Daily Closing ${date}`, ['Item', 'Amount'], summaryRows, Utils.companyInfo(this.settings));
        if (detailRows.length) Export.print(`Sales ${date}`, detailHeaders, detailRows, Utils.companyInfo(this.settings));
      });
      document.getElementById('pdf-close')?.addEventListener('click', async () => {
        await Export.toPDF(`daily-closing-${date}.pdf`, `Daily Closing ${date}`, ['Item', 'Amount'], summaryRows, Utils.companyInfo(this.settings));
        if (detailRows.length) {
          await Export.toPDF(`daily-closing-sales-${date}.pdf`, `All Sales ${date}`, detailHeaders, detailRows, Utils.companyInfo(this.settings));
        }
        Utils.toast('PDF saved', 'success');
      });
    };
    document.getElementById('load-close').addEventListener('click', load);
    load();
  };

  AdminPage.renderDiscountReport = async function (el) {
    el.innerHTML = `<div class="admin-section"><h3>Discount Report</h3>
      <p class="muted">Track all discounts given — nothing is hidden.</p>
      <div id="disc-totals" style="margin-top:12px"><p class="muted">Loading…</p></div>
      ${Utils.dateFilterHTML('disc-filter')}
      <div style="margin:12px 0;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="disc-export-pdf">Export PDF</button>
        <button class="btn btn-ghost" id="disc-print">Print</button>
      </div>
      <div id="disc-content" style="margin-top:16px"></div></div>`;

    const currency = this.settings.currency || 'R';
    let lastRows = [];
    let lastFrom = Utils.monthStart();
    let lastTo = Utils.today();

    const loadTotals = async () => {
      const [today, week, month] = await Promise.all([
        API.getDiscountReport(Utils.today(), Utils.today()),
        API.getDiscountReport(Utils.daysAgo(7), Utils.today()),
        API.getDiscountReport(Utils.monthStart(), Utils.today())
      ]);
      const sum = (rows) => (rows?.data || rows || []).reduce((s, r) => s + (r.discount || 0), 0);
      document.getElementById('disc-totals').innerHTML = `<div class="stats-grid">
        <div class="stat-card"><div class="label">Today</div><div class="value">${Utils.formatMoney(sum(today), currency)}</div></div>
        <div class="stat-card"><div class="label">This Week</div><div class="value">${Utils.formatMoney(sum(week), currency)}</div></div>
        <div class="stat-card"><div class="label">This Month</div><div class="value">${Utils.formatMoney(sum(month), currency)}</div></div>
      </div>`;
    };

    const load = async (from, to) => {
      lastFrom = from;
      lastTo = to;
      const res = await API.getDiscountReport(from, to);
      const rows = res.data || [];
      lastRows = rows;
      document.getElementById('disc-content').innerHTML = `<div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Receipt</th><th>Date</th><th>Discount</th><th>Sale Total</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${r.receipt_number}</td><td>${Utils.formatDateTime(r.created_at)}</td>
          <td>${Utils.formatMoney(r.discount, currency)}</td><td>${Utils.formatMoney(r.total, currency)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No discounts</td></tr>'}
        </tbody></table></div></div>`;
    };

    document.getElementById('disc-export-pdf')?.addEventListener('click', async () => {
      const headers = ['Receipt', 'Date', 'Discount', 'Sale Total'];
      const rows = lastRows.map(r => [
        r.receipt_number,
        Utils.formatDateTime(r.created_at),
        Utils.formatMoney(r.discount, currency),
        Utils.formatMoney(r.total, currency)
      ]);
      await Export.toPDF(`discount-report-${lastFrom}.pdf`, `Discount Report ${lastFrom} – ${lastTo}`,
        headers, rows, Utils.companyInfo(this.settings));
    });
    document.getElementById('disc-print')?.addEventListener('click', () => {
      Export.print(`Discount Report ${lastFrom} – ${lastTo}`, ['Receipt', 'Date', 'Discount', 'Sale Total'],
        lastRows.map(r => [r.receipt_number, Utils.formatDateTime(r.created_at),
          Utils.formatMoney(r.discount, currency), Utils.formatMoney(r.total, currency)]),
        Utils.companyInfo(this.settings));
    });

    await loadTotals();
    Utils.bindDateFilter('disc-filter', load);
    await load(Utils.monthStart(), Utils.today());
  };
})();

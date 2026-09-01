const ReportsPage = {
  currentType: null,
  from: null,
  to: null,

  async render(el, app) {
    this.app = app;
    this.from = Utils.monthStart();
    this.to = Utils.today();
    el.innerHTML = `
      <div class="page-toolbar"><h3>Reports</h3></div>
      ${Utils.dateFilterHTML('report-filter', this.from, this.to)}
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));margin-top:16px">
        ${[
          { id: 'sales', label: 'Sales', icon: '💰' },
          { id: 'profit', label: 'Profit', icon: '📈' },
          { id: 'expenses', label: 'Expenses', icon: '💸' },
          { id: 'stock', label: 'Stock', icon: '📦' },
          { id: 'cashier', label: 'Cashier', icon: '👤' },
          { id: 'product', label: 'Products', icon: '🏷️' },
          { id: 'returns', label: 'Returns', icon: '↩️' },
          { id: 'hourly', label: 'Hourly Sales', icon: '⏰' },
          { id: 'category', label: 'Category Sales', icon: '📂' },
          { id: 'brand', label: 'Brand Sales', icon: '🏷️' },
          { id: 'payments', label: 'Payments', icon: '💳' },
          { id: 'employee', label: 'Employee Perf.', icon: '👤' },
          { id: 'discounts', label: 'Discounts', icon: '🏷️' },
          { id: 'voids', label: 'Void/Cancelled', icon: '❌' },
          { id: 'movements', label: 'Stock Movement', icon: '📋' },
          { id: 'profitdash', label: 'Profit Dashboard', icon: '📊' },
          { id: 'giftcards', label: 'Gift Cards', icon: '🎁' },
          { id: 'layby', label: 'Lay-Bye', icon: '📋' },
          { id: 'quotes', label: 'Quotes', icon: '📄' },
          { id: 'onaccount', label: 'On Account', icon: '📒' },
          { id: 'cashup', label: 'Cash-Up', icon: '💰' },
          { id: 'operating', label: 'Open/Close Log', icon: '🕐' },
          { id: 'auditlog', label: 'Audit Log', icon: '🔍' },
          { id: 'payroll', label: 'Payroll Summary', icon: '💼' },
          { id: 'shifts', label: 'Shift Schedule', icon: '📅' },
          { id: 'bookkeeping', label: 'Accounting', icon: '📒' }
        ].map(r => `<div class="card report-card" style="cursor:pointer;padding:20px;text-align:center" data-report="${r.id}">
          <div style="font-size:28px;margin-bottom:6px">${r.icon}</div><strong>${r.label}</strong></div>`).join('')}
      </div>
      <div id="report-output" style="margin-top:24px"></div>`;

    Utils.bindDateFilter('report-filter', (from, to) => {
      this.from = from; this.to = to;
      if (this.currentType) this.runReport(this.currentType);
    });

    el.querySelectorAll('[data-report]').forEach(card => {
      card.addEventListener('click', () => this.runReport(card.dataset.report));
    });
  },

  companyInfo() {
    return { ...Utils.companyInfo(this.app.settings), dateRange: `${Utils.formatDate(this.from)} — ${Utils.formatDate(this.to)}` };
  },

  async runReport(type) {
    this.currentType = type;
    const from = this.from;
    const to = this.to;
    const currency = this.app.settings?.currency || 'R';
    const output = document.getElementById('report-output');
    output.innerHTML = '<p>Loading…</p>';

    let data, headers, rows, title, filename;

    switch (type) {
      case 'sales': {
        const res = await API.getSalesReport(from, to);
        data = res.data || [];
        title = 'Sales Report';
        filename = `sales-report-${from}.pdf`;
        headers = ['Receipt', 'Date', 'Cashier', 'Total'];
        rows = data.map(s => [s.receipt_number, Utils.formatDateTime(s.created_at), s.cashier_name || '—', Utils.formatMoney(s.total, currency)]);
        break;
      }
      case 'profit': {
        const res = await API.getProfitReport(from, to);
        data = res.data || [];
        title = 'Profit Report';
        filename = `profit-report-${from}.pdf`;
        headers = ['Date', 'Revenue', 'Cost', 'Profit'];
        rows = data.map(d => [d.day, Utils.formatMoney(d.revenue, currency), Utils.formatMoney(d.cost, currency), Utils.formatMoney(d.profit, currency)]);
        break;
      }
      case 'expenses': {
        const res = await API.getExpenseReport(from, to);
        data = res.data || [];
        title = 'Expense Report';
        filename = `expense-report-${from}.pdf`;
        headers = ['Date', 'Category', 'Description', 'Amount'];
        rows = data.map(e => [e.expense_date, e.category, e.description || '—', Utils.formatMoney(e.amount, currency)]);
        break;
      }
      case 'stock': {
        const res = await API.getStockReport();
        data = res.data || [];
        title = 'Stock Report';
        filename = 'stock-report.pdf';
        headers = ['Product', 'Category', 'Qty', 'Min', 'Status', 'Value'];
        rows = data.map(p => [p.name, p.category_name || '—', String(p.stock_quantity), String(p.min_stock), p.status, Utils.formatMoney(p.stock_quantity * p.buying_price, currency)]);
        break;
      }
      case 'cashier': {
        const res = await API.getCashierReport(from, to);
        data = res.data || [];
        title = 'Cashier Report';
        filename = `cashier-report-${from}.pdf`;
        headers = ['Cashier', 'Username', 'Sales Count', 'Subtotal', 'Tax', 'Total'];
        rows = data.map(c => [
          c.full_name,
          c.username || '—',
          String(c.sales_count),
          Utils.formatMoney(c.subtotal || 0, currency),
          Utils.formatMoney(c.tax_total || 0, currency),
          Utils.formatMoney(c.total, currency)
        ]);
        break;
      }
      case 'product': {
        const res = await API.getProductReport(from, to);
        data = res.data || [];
        title = 'Product Report';
        filename = `product-report-${from}.pdf`;
        headers = ['Product', 'Qty Sold', 'Revenue'];
        rows = data.map(p => [p.product_name, String(p.qty), Utils.formatMoney(p.revenue, currency)]);
        break;
      }
      case 'returns': {
        const res = await API.getReturns({ from, to });
        data = res.data || [];
        title = 'Returns Report';
        filename = `returns-report-${from}.pdf`;
        headers = ['Date', 'Receipt', 'Type', 'Reason', 'Refund'];
        rows = data.map(r => [Utils.formatDateTime(r.created_at), r.receipt_number || '—', r.return_type, r.reason || '—', Utils.formatMoney(r.total_refund, currency)]);
        break;
      }
      case 'hourly': {
        const res = await API.getHourlyReport(from, to);
        data = res.data || [];
        title = 'Hourly Sales Report'; filename = `hourly-${from}.pdf`;
        headers = ['Hour', 'Transactions', 'Revenue'];
        rows = data.map(d => [d.hour + ':00', String(d.transactions), Utils.formatMoney(d.revenue, currency)]);
        break;
      }
      case 'category': {
        const res = await API.getCategoryReport(from, to);
        data = res.data || [];
        title = 'Category Sales Report'; filename = `category-${from}.pdf`;
        headers = ['Category', 'Qty', 'Revenue'];
        rows = data.map(d => [d.category || 'Uncategorised', String(d.qty), Utils.formatMoney(d.revenue, currency)]);
        break;
      }
      case 'brand': {
        const res = await API.getBrandReport(from, to);
        data = res.data || [];
        title = 'Brand Sales Report'; filename = `brand-${from}.pdf`;
        headers = ['Brand', 'Qty', 'Revenue'];
        rows = data.map(d => [d.brand, String(d.qty), Utils.formatMoney(d.revenue, currency)]);
        break;
      }
      case 'payments': {
        const res = await API.getPaymentReport(from, to);
        data = res.data || [];
        title = 'Payment Method Report'; filename = `payments-${from}.pdf`;
        headers = ['Method', 'Count', 'Total'];
        rows = data.map(d => [d.payment_type, String(d.count), Utils.formatMoney(d.total, currency)]);
        break;
      }
      case 'employee': {
        const res = await API.getEmployeeReport(from, to);
        data = res.data || [];
        title = 'Employee Performance'; filename = `employee-${from}.pdf`;
        headers = ['Employee', 'Sales', 'Revenue'];
        rows = data.map(d => [d.full_name, String(d.sales_count), Utils.formatMoney(d.revenue, currency)]);
        break;
      }
      case 'discounts': {
        const res = await API.getDiscountReport(from, to);
        data = res.data || [];
        title = 'Discount Report'; filename = `discounts-${from}.pdf`;
        headers = ['Receipt', 'Discount', 'Total', 'Date'];
        rows = data.map(d => [d.receipt_number, Utils.formatMoney(d.discount, currency), Utils.formatMoney(d.total, currency), Utils.formatDateTime(d.created_at)]);
        break;
      }
      case 'voids': {
        const res = await API.getVoidReport(from, to);
        data = res.data || [];
        title = 'Void / Cancelled Sales'; filename = `voids-${from}.pdf`;
        headers = ['Receipt', 'Total', 'Reason', 'Date'];
        rows = data.map(d => [d.receipt_number, Utils.formatMoney(d.total, currency), d.void_reason || '—', Utils.formatDateTime(d.created_at)]);
        break;
      }
      case 'movements': {
        const res = await API.getMovementReport(from, to);
        data = res.data || [];
        title = 'Stock Movement Report'; filename = `movements-${from}.pdf`;
        headers = ['Date', 'Product', 'Type', 'Qty', 'User'];
        rows = data.map(d => [Utils.formatDateTime(d.created_at), d.product_name, d.movement_type, String(d.quantity), d.user_name || '—']);
        break;
      }
      case 'profitdash': {
        const res = await API.getProfitDashboard(from, to);
        data = res.data || {};
        title = 'Profit Dashboard'; filename = `profit-dash-${from}.pdf`;
        headers = ['Metric', 'Value'];
        rows = [['Revenue', Utils.formatMoney(data.revenue, currency)], ['Cost', Utils.formatMoney(data.cost, currency)],
          ['Expenses', Utils.formatMoney(data.expenses, currency)], ['Profit', Utils.formatMoney(data.profit, currency)],
          ['Margin %', (Number(data.margin) || 0).toFixed(1) + '%']];
        break;
      }
      case 'giftcards': {
        const res = await API.getGiftCardReport(from, to);
        data = res.data || [];
        title = 'Gift Card Report'; filename = `giftcards-${from}.pdf`;
        headers = ['Code', 'Initial', 'Balance', 'Redeemed', 'Status', 'Created'];
        rows = data.map(g => [g.code, Utils.formatMoney(g.initial_value, currency), Utils.formatMoney(g.balance, currency), Utils.formatMoney(g.redeemed, currency), g.status, Utils.formatDateTime(g.created_at)]);
        break;
      }
      case 'layby': {
        const res = await API.getLaybyReport(from, to);
        data = res.data || [];
        title = 'Lay-Bye Report'; filename = `layby-${from}.pdf`;
        headers = ['Lay-Bye #', 'Customer', 'Total', 'Paid', 'Balance', 'Status', 'Date'];
        rows = data.map(l => [l.layby_number, l.customer_name || '—', Utils.formatMoney(l.total, currency), Utils.formatMoney(l.amount_paid, currency), Utils.formatMoney(l.balance, currency), l.status, Utils.formatDateTime(l.created_at)]);
        break;
      }
      case 'quotes': {
        const res = await API.getQuotesReport(from, to);
        data = res.data || [];
        title = 'Quotes Report'; filename = `quotes-${from}.pdf`;
        headers = ['Quote #', 'Customer', 'Total', 'Status', 'Date'];
        rows = data.map(q => [q.quote_number, q.customer_name || '—', Utils.formatMoney(q.total, currency), q.status, Utils.formatDateTime(q.created_at)]);
        break;
      }
      case 'onaccount': {
        const res = await API.getOnAccountReport(from, to);
        data = res.data || [];
        title = 'On Account Report'; filename = `onaccount-${from}.pdf`;
        headers = ['Customer', 'Phone', 'Balance', 'Charged', 'Paid'];
        rows = data.map(c => [c.name, c.phone || '—', Utils.formatMoney(c.balance, currency), Utils.formatMoney(c.charged, currency), Utils.formatMoney(c.paid, currency)]);
        break;
      }
      case 'cashup': {
        const res = await API.getCashUpReport(from, to);
        data = res.data || [];
        title = 'Cash-Up Report'; filename = `cashup-${from}.pdf`;
        headers = ['Date', 'User', 'Opening', 'Expected', 'Counted', 'Variance', 'Notes'];
        rows = data.map(c => [Utils.formatDateTime(c.created_at), c.user_name || '—', Utils.formatMoney(c.opening_cash, currency), Utils.formatMoney(c.expected_cash, currency), Utils.formatMoney(c.actual_cash, currency), Utils.formatMoney(c.variance, currency), c.notes || '—']);
        break;
      }
      case 'operating': {
        const res = await API.getOperatingLogReport(from, to);
        data = res.data || [];
        title = 'Shop Open / Close Log'; filename = `operating-${from}.pdf`;
        headers = ['Date & Time', 'Event', 'User', 'Full Name'];
        rows = data.map(e => [
          Utils.formatDateTime(e.event_at),
          e.event_type === 'open' ? 'Opened' : 'Closed',
          e.username || '—',
          e.full_name || '—'
        ]);
        break;
      }
      case 'auditlog': {
        const res = await API.getAuditLog({ from, to, limit: 2000 });
        data = res.data || [];
        title = 'Audit Log'; filename = `audit-${from}.pdf`;
        headers = ['Time', 'User', 'Action', 'Details'];
        rows = data.map(l => [
          Utils.formatDateTime(l.created_at), l.username || '—',
          l.action.replace(/_/g, ' '), l.details || `${l.entity_type || ''} #${l.entity_id || ''}`
        ]);
        break;
      }
      case 'payroll': {
        const res = await API.generateStaffPayroll(from, to, null, this.app.user);
        data = res.data || [];
        title = 'Payroll Summary'; filename = `payroll-${from}.pdf`;
        headers = ['Employee ID', 'Period', 'Net Salary', 'Status'];
        rows = data.map(p => [p.employee_id, `${p.period_start}–${p.period_end}`, Utils.formatMoney(p.net_salary, currency), p.status]);
        break;
      }
      case 'shifts': {
        const res = await API.getStaffSchedules(from, to);
        data = (res.data || []).filter(s => s.id && !s._from_work_schedule);
        title = 'Shift Schedule'; filename = `shifts-${from}.pdf`;
        headers = ['Date', 'Employee', 'Shift', 'Start', 'End'];
        rows = data.map(s => [s.shift_date, s.full_name, s.shift_name, s.start_time || '—', s.end_time || '—']);
        break;
      }
      case 'bookkeeping': {
        this.app.openAccounting({ fromApp: true, skipLogin: true });
        output.innerHTML = '<p class="muted">Opened Accounting Command Centre — official financial reports live there.</p>';
        return;
      }
    }

    const dateLabel = type === 'stock' ? 'Current snapshot' : `${Utils.formatDate(from)} — ${Utils.formatDate(to)}`;
    output.innerHTML = `
      <div class="card"><div class="card-header"><h3>${title} <small class="muted">(${dateLabel})</small></h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" id="export-excel">Download Excel</button>
          <button class="btn btn-ghost btn-sm" id="export-pdf">Download PDF</button>
          <button class="btn btn-primary btn-sm" id="print-report">Print</button>
          <button class="btn btn-success btn-sm" id="share-report">Share / Save</button>
        </div></div>
        <div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length}" class="muted">No data for this period</td></tr>`}
        </tbody></table></div></div>`;

    const company = this.companyInfo();
    document.getElementById('export-excel').addEventListener('click', async () => {
      await Export.toExcel(filename.replace('.pdf', '.xlsx'), [{ name: title, data: rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]]))) }]);
    });
    document.getElementById('export-pdf').addEventListener('click', async () => {
      await Export.toPDF(filename, title, headers, rows.map(r => r.map(String)), company);
    });
    document.getElementById('print-report').addEventListener('click', async () => {
      await Export.print(title, headers, rows.map(r => r.map(String)), company);
    });
    document.getElementById('share-report')?.addEventListener('click', async () => {
      // Same as PDF download on Android (opens native share sheet so you can Save to Files / WhatsApp)
      await Export.toPDF(filename, title, headers, rows.map(r => r.map(String)), company);
    });
  }
};
window.ReportsPage = ReportsPage;

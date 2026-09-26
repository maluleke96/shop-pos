// Expenses → Stock Batch & Yield
(function () {
  const money = (n, c) => (typeof Utils !== 'undefined' && Utils.formatMoney)
    ? Utils.formatMoney(n, c)
    : `${c || 'R'}${Number(n || 0).toFixed(2)}`;
  const esc = (s) => (typeof Utils !== 'undefined' && Utils.escHtml)
    ? Utils.escHtml(s)
    : String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const statusClass = (st) => {
    if (st === 'finished') return 'tag-ok';
    if (st === 'exceeded_expected_yield') return 'tag-warn';
    if (st === 'expected_yield_reached' || st === 'near_completion') return 'tag-warn';
    if (st === 'cancelled') return 'tag-danger';
    return '';
  };

  const StockBatchYieldPage = {
    filters: { status: 'open', q: '' },

    async render(panel, app) {
      this.app = app;
      this.currency = app?.settings?.currency || 'R';
      if (!panel) return;
      panel.innerHTML = `<p class="muted" style="padding:16px">Loading Stock Batch &amp; Yield…</p>`;
      try {
        const [dashRes, listRes, settingsRes, prodRes, branchRes] = await Promise.all([
          API.stockBatchDashboard(this.filters),
          API.stockBatchList({ ...this.filters, limit: 200 }),
          API.stockBatchSettings(),
          API.getProducts({}).catch(() => ({ data: [] })),
          (API.getBranches ? API.getBranches() : Promise.resolve({ data: [] })).catch(() => ({ data: [] }))
        ]);
        if (dashRes.success === false) throw new Error(dashRes.error || 'Failed to load dashboard');
        if (listRes.success === false) throw new Error(listRes.error || 'Failed to load batches');
        this._dash = dashRes.data || dashRes;
        this._rows = listRes.data || listRes || [];
        this._settings = (settingsRes.data || settingsRes) || {};
        this._products = prodRes.data || prodRes || [];
        this._branches = branchRes.data || branchRes || [];
        this.paint(panel);
      } catch (e) {
        panel.innerHTML = `<div class="card"><div class="card-body"><p class="error-msg">${esc(e.message || e)}</p></div></div>`;
      }
    },

    paint(panel) {
      const d = this._dash || {};
      const rows = this._rows || [];
      const cur = this.currency;
      panel.innerHTML = `
        <style>
          .sby-stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:12px 0 18px}
          .sby-stat{padding:12px 14px;border:1px solid var(--border,#e2e8f0);border-radius:12px;background:var(--bg-card,#fff)}
          .sby-stat .muted{font-size:12px;margin-bottom:4px}
          .sby-stat strong{font-size:1.15rem}
          .sby-bar{height:10px;background:var(--border,#e2e8f0);border-radius:999px;overflow:hidden;min-width:80px}
          .sby-bar > i{display:block;height:100%;background:linear-gradient(90deg,#059669,#10b981);border-radius:999px}
          .sby-bar.over > i{background:linear-gradient(90deg,#d97706,#f59e0b);width:100%!important}
          .sby-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-bottom:12px}
          .sby-filters .field{margin:0;min-width:120px}
        </style>
        <div class="card"><div class="card-body">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
            <div>
              <h4 style="margin:0">Stock Batch &amp; Yield</h4>
              <p class="muted" style="margin:6px 0 0;max-width:70ch">Track purchases from buy → expected plates → POS sales → revenue, cost, profit, waste, and batch completion. Sales update batches automatically.</p>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button type="button" class="btn btn-ghost" id="sby-settings">FIFO settings</button>
              <button type="button" class="btn btn-ghost" id="sby-analysis">Yield analysis</button>
              <button type="button" class="btn btn-primary" id="sby-create">+ Create Stock Batch</button>
            </div>
          </div>
          <div class="sby-stat-grid">
            <div class="sby-stat"><div class="muted">Active Batches</div><strong>${d.active_batches || 0}</strong></div>
            <div class="sby-stat"><div class="muted">Total Purchase Cost</div><strong>${money(d.total_purchase_cost, cur)}</strong></div>
            <div class="sby-stat"><div class="muted">Revenue Generated</div><strong>${money(d.revenue_generated, cur)}</strong></div>
            <div class="sby-stat"><div class="muted">Est. Gross Profit</div><strong>${money(d.estimated_gross_profit, cur)}</strong></div>
            <div class="sby-stat"><div class="muted">Expected Portions</div><strong>${d.expected_portions || 0}</strong></div>
            <div class="sby-stat"><div class="muted">Portions Sold</div><strong>${d.portions_sold || 0}</strong></div>
            <div class="sby-stat"><div class="muted">Waste</div><strong>${d.waste || 0}</strong></div>
            <div class="sby-stat"><div class="muted">Near Completion</div><strong>${d.near_completion || 0}</strong></div>
            <div class="sby-stat"><div class="muted">Completed</div><strong>${d.completed_batches || 0}</strong></div>
          </div>
        </div></div>

        <div class="card" style="margin-top:14px"><div class="card-body">
          <div class="sby-filters">
            <div class="field"><label class="muted">Status</label>
              <select class="form-input" id="sby-f-status">
                <option value="open" ${this.filters.status === 'open' ? 'selected' : ''}>Open (active+)</option>
                <option value="" ${this.filters.status === '' ? 'selected' : ''}>All</option>
                <option value="active">Active</option>
                <option value="near_completion">Near Completion</option>
                <option value="expected_yield_reached">Expected Yield Reached</option>
                <option value="exceeded_expected_yield">Exceeded Expected Yield</option>
                <option value="finished">Finished</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div class="field" style="flex:1;min-width:180px"><label class="muted">Search batch / product</label>
              <input class="form-input" id="sby-f-q" placeholder="BB-… / Beef Bones" value="${esc(this.filters.q || '')}">
            </div>
            <button type="button" class="btn btn-ghost" id="sby-refresh">Refresh</button>
          </div>
          <div class="table-wrap"><table class="data-table">
            <thead><tr>
              <th>Batch</th><th>Product</th><th>Purchase Cost</th><th>Expected</th><th>Sold</th><th>Remaining</th>
              <th>Progress</th><th>Revenue</th><th>Profit</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              ${rows.map((b) => {
                const pct = Math.min(100, Number(b.progress_pct) || 0);
                const over = (Number(b.portions_sold) || 0) > (Number(b.expected_yield) || 0);
                return `<tr data-id="${b.id}">
                  <td><strong>${esc(b.batch_number)}</strong><div class="muted" style="font-size:11px">${esc(b.purchase_date || '')}${b.supplier_name ? ' · ' + esc(b.supplier_name) : ''}</div></td>
                  <td>${esc(b.stock_product_name)}<div class="muted" style="font-size:11px">→ ${esc(b.selling_product_name || '—')}</div></td>
                  <td>${money(b.purchase_cost, cur)}</td>
                  <td>${b.expected_yield}${b.actual_yield != null ? `<div class="muted" style="font-size:11px">Actual ${b.actual_yield}</div>` : ''}</td>
                  <td><strong>${b.portions_sold}</strong>${b.extra_yield > 0 ? `<div class="muted" style="font-size:11px">+${b.extra_yield} extra</div>` : ''}</td>
                  <td>${b.remaining}</td>
                  <td style="min-width:120px">
                    <div class="sby-bar ${over ? 'over' : ''}" title="${b.portions_sold} / ${b.expected_yield} = ${b.progress_pct}%">
                      <i style="width:${over ? 100 : pct}%"></i>
                    </div>
                    <div class="muted" style="font-size:11px;margin-top:2px">${b.portions_sold} / ${b.expected_yield} (${b.progress_pct}%)</div>
                  </td>
                  <td>${money(b.revenue, cur)}</td>
                  <td>${money(b.gross_profit, cur)}</td>
                  <td><span class="tag ${statusClass(b.status)}">${esc(b.status_label || b.status)}</span></td>
                  <td style="white-space:nowrap">
                    <button type="button" class="btn btn-ghost btn-sm sby-open" data-id="${b.id}">Open</button>
                  </td>
                </tr>`;
              }).join('') || '<tr><td colspan="11" class="muted">No batches yet — create one to start tracking</td></tr>'}
            </tbody>
          </table></div>
        </div></div>`;

      panel.querySelector('#sby-create')?.addEventListener('click', () => this.showCreateModal(panel));
      panel.querySelector('#sby-settings')?.addEventListener('click', () => this.showSettingsModal(panel));
      panel.querySelector('#sby-analysis')?.addEventListener('click', () => this.showAnalysisModal());
      panel.querySelector('#sby-refresh')?.addEventListener('click', () => {
        this.filters.status = panel.querySelector('#sby-f-status')?.value ?? 'open';
        this.filters.q = panel.querySelector('#sby-f-q')?.value?.trim() || '';
        this.render(panel, this.app);
      });
      panel.querySelectorAll('.sby-open').forEach((btn) => {
        btn.addEventListener('click', () => this.showBatchDetail(Number(btn.dataset.id), panel));
      });
    },

    async showCreateModal(panel) {
      const cur = this.currency;
      const products = this._products || [];
      const branches = this._branches || [];
      const productOpts = products.slice(0, 800).map((p) =>
        `<option value="${p.id}" data-price="${p.selling_price || 0}" data-unit="${esc(p.unit || p.stock_unit || '')}">${esc(p.name)}</option>`
      ).join('');
      Utils.showModal('Create Stock Batch', `
        <div class="form-grid">
          <div class="field"><label>Stock item purchased *</label>
            <input class="form-input" id="sby-stock-name" list="sby-stock-list" placeholder="e.g. Beef Bones">
            <datalist id="sby-stock-list">${products.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
            <input type="hidden" id="sby-stock-id">
          </div>
          <div class="field"><label>Or pick stock product</label>
            <select class="form-input" id="sby-stock-pick"><option value="">— optional link —</option>${productOpts}</select>
          </div>
          <div class="field"><label>Selling product (POS) *</label>
            <select class="form-input" id="sby-sell-id"><option value="">Select meal / product…</option>${productOpts}</select>
          </div>
          <div class="field"><label>Selling price *</label>
            <input class="form-input" type="number" step="0.01" min="0" id="sby-sell-price" placeholder="55">
          </div>
          <div class="field"><label>Purchase cost *</label>
            <input class="form-input" type="number" step="0.01" min="0" id="sby-cost" placeholder="300">
          </div>
          <div class="field"><label>Expected yield (plates) *</label>
            <input class="form-input" type="number" step="0.01" min="0.01" id="sby-yield" placeholder="30">
          </div>
          <div class="field"><label>Cost per expected portion</label>
            <input class="form-input" id="sby-cpp" readonly value="—">
          </div>
          <div class="field"><label>Purchase date</label>
            <input class="form-input" type="date" id="sby-date" value="${Utils.today ? Utils.today() : new Date().toLocaleDateString('en-CA')}">
          </div>
          <div class="field"><label>Supplier</label>
            <input class="form-input" id="sby-supplier" placeholder="Supplier name">
          </div>
          <div class="field"><label>Invoice / reference</label>
            <input class="form-input" id="sby-invoice" placeholder="INV-…">
          </div>
          <div class="field"><label>Qty purchased</label>
            <input class="form-input" type="number" step="0.001" min="0" id="sby-qty" value="1">
          </div>
          <div class="field"><label>Unit</label>
            <input class="form-input" id="sby-unit" placeholder="kg / box / pack" value="kg">
          </div>
          <div class="field"><label>Branch</label>
            <select class="form-input" id="sby-branch"><option value="">—</option>
              ${branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Storage / location</label>
            <input class="form-input" id="sby-storage" placeholder="Cold room / freezer">
          </div>
          <div class="field full"><label>Notes</label>
            <textarea class="form-input" id="sby-notes" rows="2"></textarea>
          </div>
          <div class="field full">
            <label style="display:flex;gap:8px;align-items:center">
              <input type="checkbox" id="sby-link-exp" checked>
              Also create Expenses purchase record (same amount — no duplicate money movement)
            </label>
          </div>
        </div>
        <p class="muted" id="sby-preview" style="margin-top:10px"></p>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>
          <button type="button" class="btn btn-primary" id="sby-save">Save batch</button>
        </div>
      `);

      const recalc = () => {
        const cost = Number(document.getElementById('sby-cost')?.value) || 0;
        const y = Number(document.getElementById('sby-yield')?.value) || 0;
        const price = Number(document.getElementById('sby-sell-price')?.value) || 0;
        const cpp = y > 0 ? cost / y : 0;
        const el = document.getElementById('sby-cpp');
        if (el) el.value = y > 0 ? money(cpp, cur) : '—';
        const prev = document.getElementById('sby-preview');
        if (prev) {
          prev.textContent = y > 0
            ? `Expected revenue ${money(y * price, cur)} · Cost/plate ${money(cpp, cur)} · Est. profit if full yield ${money((y * price) - cost, cur)}`
            : '';
        }
      };
      document.getElementById('sby-cost')?.addEventListener('input', recalc);
      document.getElementById('sby-yield')?.addEventListener('input', recalc);
      document.getElementById('sby-sell-price')?.addEventListener('input', recalc);
      document.getElementById('sby-sell-id')?.addEventListener('change', (e) => {
        const opt = e.target.selectedOptions?.[0];
        if (opt?.dataset?.price && !document.getElementById('sby-sell-price').value) {
          document.getElementById('sby-sell-price').value = opt.dataset.price;
          recalc();
        }
      });
      document.getElementById('sby-stock-pick')?.addEventListener('change', (e) => {
        const id = e.target.value;
        const p = products.find((x) => String(x.id) === String(id));
        if (p) {
          document.getElementById('sby-stock-name').value = p.name;
          document.getElementById('sby-stock-id').value = p.id;
          if (p.unit || p.stock_unit) document.getElementById('sby-unit').value = p.unit || p.stock_unit;
        }
      });
      recalc();

      document.getElementById('sby-save')?.addEventListener('click', async () => {
        const btn = document.getElementById('sby-save');
        const stockName = document.getElementById('sby-stock-name')?.value?.trim();
        const sellId = Number(document.getElementById('sby-sell-id')?.value);
        const cost = Number(document.getElementById('sby-cost')?.value);
        const yieldN = Number(document.getElementById('sby-yield')?.value);
        const price = Number(document.getElementById('sby-sell-price')?.value);
        if (!stockName) return Utils.toast('Enter stock item name', 'error');
        if (!sellId) return Utils.toast('Select selling product', 'error');
        if (!(cost >= 0) || Number.isNaN(cost)) return Utils.toast('Enter purchase cost', 'error');
        if (!(yieldN > 0)) return Utils.toast('Enter expected yield', 'error');
        if (!(price >= 0) || Number.isNaN(price)) return Utils.toast('Enter selling price', 'error');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
        const branchSel = document.getElementById('sby-branch');
        const out = await API.stockBatchCreate({
          stock_product_name: stockName,
          stock_product_id: Number(document.getElementById('sby-stock-id')?.value) || Number(document.getElementById('sby-stock-pick')?.value) || null,
          selling_product_id: sellId,
          purchase_cost: cost,
          expected_yield: yieldN,
          selling_price: price,
          purchase_date: document.getElementById('sby-date')?.value,
          supplier_name: document.getElementById('sby-supplier')?.value?.trim() || null,
          invoice_ref: document.getElementById('sby-invoice')?.value?.trim() || null,
          quantity_purchased: Number(document.getElementById('sby-qty')?.value) || 0,
          unit: document.getElementById('sby-unit')?.value?.trim() || 'kg',
          branch_id: Number(branchSel?.value) || null,
          branch_name: branchSel?.selectedOptions?.[0]?.textContent || null,
          storage_location: document.getElementById('sby-storage')?.value?.trim() || null,
          notes: document.getElementById('sby-notes')?.value?.trim() || null,
          skip_expense: !document.getElementById('sby-link-exp')?.checked
        }, this.app.user);
        if (btn) { btn.disabled = false; btn.textContent = 'Save batch'; }
        if (!out.success) return Utils.toast(out.error || 'Save failed', 'error');
        Utils.hideModal?.();
        Utils.toast(`Batch ${out.data?.batch_number || ''} created`, 'success');
        this.render(panel, this.app);
      });
    },

    async showBatchDetail(id, panel) {
      const res = await API.stockBatchGet(id);
      if (!res.success) return Utils.toast(res.error || 'Not found', 'error');
      const b = res.data;
      const evRes = await API.stockBatchEvents(id, 50);
      const events = evRes.success ? (evRes.data || []) : [];
      const cur = this.currency;
      const closed = b.status === 'finished' || b.status === 'cancelled';
      Utils.showModal(`${b.batch_number} — ${b.stock_product_name}`, `
        <div class="sby-stat-grid">
          <div class="sby-stat"><div class="muted">Purchase cost</div><strong>${money(b.purchase_cost, cur)}</strong></div>
          <div class="sby-stat"><div class="muted">Cost / portion</div><strong>${money(b.cost_per_portion, cur)}</strong></div>
          <div class="sby-stat"><div class="muted">Sold / Expected</div><strong>${b.portions_sold} / ${b.expected_yield}</strong></div>
          <div class="sby-stat"><div class="muted">Remaining</div><strong>${b.remaining}</strong></div>
          <div class="sby-stat"><div class="muted">Revenue</div><strong>${money(b.revenue, cur)}</strong></div>
          <div class="sby-stat"><div class="muted">Consumed cost</div><strong>${money(b.consumed_cost, cur)}</strong></div>
          <div class="sby-stat"><div class="muted">Gross profit</div><strong>${money(b.gross_profit, cur)}</strong></div>
          <div class="sby-stat"><div class="muted">Waste</div><strong>${b.portions_wasted}</strong></div>
        </div>
        <p><span class="tag ${statusClass(b.status)}">${esc(b.status_label)}</span>
          ${b.extra_yield > 0 ? ` · Extra yield: <strong>${b.extra_yield}</strong>` : ''}
          ${b.expense_id ? ` · Expense #${b.expense_id}` : ''}
          ${b.actual_yield != null ? ` · Actual yield: <strong>${b.actual_yield}</strong>` : ''}
        </p>
        <div class="sby-bar ${b.extra_yield > 0 ? 'over' : ''}" style="margin:8px 0 16px"><i style="width:${Math.min(100, b.progress_pct)}%"></i></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          ${!closed ? `<button type="button" class="btn btn-ghost btn-sm" id="sby-d-waste">Record Waste</button>` : ''}
          ${!closed ? `<button type="button" class="btn btn-ghost btn-sm" id="sby-d-actual">Set Actual Yield</button>` : ''}
          ${!closed ? `<button type="button" class="btn btn-primary btn-sm" id="sby-d-close">Close / Finish batch</button>` : ''}
          ${b.status === 'finished' ? `<button type="button" class="btn btn-ghost btn-sm" id="sby-d-reopen">Reopen</button>` : ''}
          ${!closed ? `<button type="button" class="btn btn-ghost btn-sm" id="sby-d-cancel">Cancel batch</button>` : ''}
        </div>
        <h5>Audit history</h5>
        <div class="table-wrap" style="max-height:220px;overflow:auto"><table class="data-table">
          <thead><tr><th>When</th><th>Action</th><th>Qty</th><th>User</th><th>Detail</th></tr></thead>
          <tbody>${events.map((e) => `<tr>
            <td>${esc((e.created_at || '').slice(0, 19))}</td>
            <td>${esc(e.action)}</td>
            <td>${e.quantity != null ? e.quantity : '—'}</td>
            <td>${esc(e.user_name || '—')}</td>
            <td class="muted" style="font-size:12px">${esc([e.reason, e.old_value && e.new_value ? `${e.old_value} → ${e.new_value}` : (e.new_value || '')].filter(Boolean).join(' · '))}</td>
          </tr>`).join('') || '<tr><td colspan="5" class="muted">No events</td></tr>'}
          </tbody>
        </table></div>
        <div style="display:flex;justify-content:flex-end;margin-top:12px">
          <button type="button" class="btn btn-ghost" data-modal-close>Close</button>
        </div>
      `);

      document.getElementById('sby-d-waste')?.addEventListener('click', async () => {
        const qty = prompt('Waste quantity (portions)', '1');
        if (qty == null) return;
        const reason = prompt('Reason', 'Spoiled') || 'Waste';
        const out = await API.stockBatchWaste(id, { quantity: Number(qty), reason }, this.app.user);
        if (!out.success) return Utils.toast(out.error || 'Failed', 'error');
        Utils.toast('Waste recorded', 'success');
        Utils.hideModal?.();
        this.render(panel, this.app);
      });
      document.getElementById('sby-d-actual')?.addEventListener('click', async () => {
        const y = prompt('Actual yield (portions produced)', String(b.actual_yield || b.expected_yield));
        if (y == null) return;
        const out = await API.stockBatchSetActualYield(id, Number(y), this.app.user);
        if (!out.success) return Utils.toast(out.error || 'Failed', 'error');
        Utils.toast('Actual yield saved', 'success');
        Utils.hideModal?.();
        this.render(panel, this.app);
      });
      document.getElementById('sby-d-close')?.addEventListener('click', async () => {
        if (!confirm('Mark this batch as Finished? It stays in history for reports.')) return;
        const out = await API.stockBatchClose(id, 'Manually closed', this.app.user);
        if (!out.success) return Utils.toast(out.error || 'Failed', 'error');
        Utils.toast('Batch finished', 'success');
        Utils.hideModal?.();
        this.render(panel, this.app);
      });
      document.getElementById('sby-d-reopen')?.addEventListener('click', async () => {
        const out = await API.stockBatchReopen(id, this.app.user);
        if (!out.success) return Utils.toast(out.error || 'Failed', 'error');
        Utils.toast('Batch reopened', 'success');
        Utils.hideModal?.();
        this.render(panel, this.app);
      });
      document.getElementById('sby-d-cancel')?.addEventListener('click', async () => {
        if (!confirm('Cancel this batch? It will not be deleted.')) return;
        const out = await API.stockBatchCancel(id, 'Cancelled', this.app.user);
        if (!out.success) return Utils.toast(out.error || 'Failed', 'error');
        Utils.toast('Batch cancelled', 'success');
        Utils.hideModal?.();
        this.render(panel, this.app);
      });
    },

    async showSettingsModal(panel) {
      const s = this._settings || {};
      Utils.showModal('Stock Batch settings', `
        <label style="display:flex;gap:8px;align-items:center;margin:10px 0">
          <input type="checkbox" id="sby-fifo" ${s.fifo_enabled !== false ? 'checked' : ''}>
          FIFO — consume oldest active batch first
        </label>
        <label style="display:flex;gap:8px;align-items:center;margin:10px 0">
          <input type="checkbox" id="sby-auto-exp" ${s.auto_link_expense !== false ? 'checked' : ''}>
          Auto-create Expenses purchase when creating a batch
        </label>
        <div class="field" style="margin-top:12px"><label>Near-completion %</label>
          <input class="form-input" type="number" id="sby-near" min="1" max="100" value="${s.near_completion_pct || 80}">
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>
          <button type="button" class="btn btn-primary" id="sby-save-set">Save</button>
        </div>
      `);
      document.getElementById('sby-save-set')?.addEventListener('click', async () => {
        const out = await API.stockBatchSaveSettings({
          fifo_enabled: !!document.getElementById('sby-fifo')?.checked,
          auto_link_expense: !!document.getElementById('sby-auto-exp')?.checked,
          near_completion_pct: Number(document.getElementById('sby-near')?.value) || 80
        }, this.app.user);
        if (!out.success) return Utils.toast(out.error || 'Failed', 'error');
        Utils.toast('Settings saved', 'success');
        Utils.hideModal?.();
        this.render(panel, this.app);
      });
    },

    async showAnalysisModal() {
      const res = await API.stockBatchProductAnalysis({});
      if (!res.success) return Utils.toast(res.error || 'Failed', 'error');
      const rows = res.data || [];
      const cur = this.currency;
      Utils.showModal('Product Yield Analysis', `
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Product</th><th>Batches</th><th>Avg expected</th><th>Avg actual</th><th>Avg cost/plate</th><th>Avg sell</th><th>Avg GP/plate</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td>${esc(r.selling_product_name)}</td>
            <td>${r.batches}</td>
            <td>${r.average_expected_yield}</td>
            <td>${r.average_actual_yield != null ? r.average_actual_yield : '—'}</td>
            <td>${money(r.average_cost_per_plate, cur)}</td>
            <td>${money(r.average_selling_price, cur)}</td>
            <td>${money(r.average_gross_profit_per_plate, cur)}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="muted">No data yet</td></tr>'}
          </tbody>
        </table></div>
        <div style="display:flex;justify-content:flex-end;margin-top:12px">
          <button type="button" class="btn btn-ghost" data-modal-close>Close</button>
        </div>
      `);
    }
  };

  window.StockBatchYieldPage = StockBatchYieldPage;
})();

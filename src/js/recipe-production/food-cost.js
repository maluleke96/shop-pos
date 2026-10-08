/**
 * Recipe & Production → Food Cost & Profitability.
 * All figures come from the server (rfc:* RPC) — recipes, ingredient purchase costs, POS sales,
 * production, waste and stock movements. What-if tools never change prices or recipes.
 */
(function () {
  const esc = (v) => Utils.escHtml(v == null ? '' : String(v));
  const NA = '<span class="rfc-na" title="Insufficient data">INSUFFICIENT DATA</span>';
  const TABS = [
    ['cards', 'Cost Cards'], ['sales', 'Sales Performance'], ['whatif', 'What-If'], ['production', 'Production Calculator'],
    ['variance', 'Expected vs Actual'], ['waste', 'Waste'], ['prices', 'Price Changes'], ['history', 'Cost History'],
    ['alerts', 'Alerts'], ['targets', 'Targets'], ['reports', 'Reports'], ['ai', 'AI Advisor']
  ];
  const PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This week'], ['last_week', 'Last week'], ['this_month', 'This month'], ['last_month', 'Last month'], ['this_year', 'This year'], ['custom', 'Custom range']];

  const Page = {
    app: null,
    el: null,
    tab: 'cards',
    meta: null,
    filters: { preset: 'this_month', from: '', to: '' },
    productId: null,
    lastReport: null,

    money(v) { return v == null ? NA : esc(this.app.money(v)); },
    pct(v) { return v == null ? NA : `${esc(v)}%`; },
    qty(v, unit) { return v == null ? NA : `${esc(v)}${unit ? ` ${esc(unit)}` : ''}`; },
    branchArgs() { return this.app.branchFilter(); },
    rangeArgs() {
      const f = this.filters;
      if (f.preset === 'custom') return { from: f.from, to: f.to || f.from };
      return { preset: f.preset };
    },
    args(extra = {}) { return { ...this.rangeArgs(), ...this.branchArgs(), ...extra }; },

    async render(el, app) {
      this.app = app;
      this.el = el;
      this.injectCss();
      el.innerHTML = '<p class="rp-muted">Loading food cost data…</p>';
      const res = await API.rfcMeta();
      if (!res?.success) {
        const msg = res?.error || 'Failed to load';
        el.innerHTML = `<div class="rp-panel"><p class="error-msg">${esc(msg)}</p>
          ${/cannot view food cost/i.test(msg) ? '<p class="rp-muted">Your recipe role can still use the Production Calculator.</p><div id="rfc-prod-only"></div>' : ''}</div>`;
        if (/cannot view food cost/i.test(msg)) await this.renderProductionOnly(el.querySelector('#rfc-prod-only'));
        return;
      }
      this.meta = res.data;
      if (!this.productId && this.meta.products.length) this.productId = this.meta.products[0].id;
      this.shell();
    },

    injectCss() {
      if (document.getElementById('rfc-css')) return;
      const s = document.createElement('style');
      s.id = 'rfc-css';
      s.textContent = `
        .rfc-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
        .rfc-tab{border:1px solid var(--border);background:var(--bg-card,#fff);border-radius:999px;padding:6px 12px;font-size:13px;cursor:pointer}
        .rfc-tab.active{background:#0f766e;color:#fff;border-color:#0f766e}
        .rfc-na{color:#b45309;font-weight:600;font-size:11px}
        .rfc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
        .rfc-card{border:1px solid var(--border);border-radius:12px;padding:12px;background:var(--bg-card,#fff)}
        .rfc-card h4{margin:0 0 6px;font-size:15px}
        .rfc-kv{display:grid;grid-template-columns:1fr auto;gap:2px 10px;font-size:13px}
        .rfc-kv span:nth-child(odd){color:var(--text-muted,#64748b)}
        .rfc-ok{color:#15803d;font-weight:600}.rfc-bad{color:#b91c1c;font-weight:600}
        .rfc-note{font-size:12px;color:var(--text-muted,#64748b);margin:6px 0}
        .rfc-flex{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
        .rfc-sec{margin:10px 0 4px;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#0f766e}
        .rfc-alert{padding:8px 10px;border-radius:8px;margin-bottom:6px;font-size:13px}
        .rfc-alert.warning{background:#fef3c7;border:1px solid #f59e0b}.rfc-alert.info{background:#e0f2fe;border:1px solid #38bdf8}
        .rfc-table-wrap{overflow-x:auto}
        .rfc-cmp td:nth-child(2),.rfc-cmp td:nth-child(3),.rfc-cmp td:nth-child(4){text-align:right}
      `;
      document.head.appendChild(s);
    },

    shell() {
      const presetOpts = PRESETS.map(([v, l]) => `<option value="${v}" ${this.filters.preset === v ? 'selected' : ''}>${l}</option>`).join('');
      this.el.innerHTML = `
        <p class="rp-muted" style="margin-top:0">Recipe cost, food cost %, gross contribution, sales, variance and waste — calculated from your recipes, ingredient purchase costs and POS sales.
          Food cost % = recipe cost ÷ selling price × 100. Gross contribution = selling price − recipe cost, <strong>before</strong> staff, rent and other operating expenses (it is not profit).</p>
        <div class="rp-toolbar">
          <label class="rp-muted">Period</label>
          <select id="rfc-preset">${presetOpts}</select>
          <span id="rfc-custom" style="display:${this.filters.preset === 'custom' ? 'inline-flex' : 'none'};gap:6px;align-items:center">
            <input type="date" id="rfc-from" value="${esc(this.filters.from)}"> <span class="rp-muted">to</span> <input type="date" id="rfc-to" value="${esc(this.filters.to)}">
          </span>
          <button type="button" class="btn btn-primary btn-sm" id="rfc-apply">Apply</button>
          <span class="rp-muted" style="margin-left:auto">Branch: use the selector at the top</span>
        </div>
        <div class="rfc-tabs">${TABS.map(([id, label]) => `<button type="button" class="rfc-tab ${this.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
        <div id="rfc-body"><p class="rp-muted">Loading…</p></div>`;
      const preset = this.el.querySelector('#rfc-preset');
      preset.onchange = () => { this.el.querySelector('#rfc-custom').style.display = preset.value === 'custom' ? 'inline-flex' : 'none'; };
      this.el.querySelector('#rfc-apply').onclick = () => {
        this.filters.preset = preset.value;
        this.filters.from = this.el.querySelector('#rfc-from').value;
        this.filters.to = this.el.querySelector('#rfc-to').value;
        if (this.filters.preset === 'custom' && !this.filters.from) return Utils.toast('Choose a start date', 'error');
        this.renderTab();
      };
      this.el.querySelectorAll('.rfc-tab').forEach((b) => b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        this.el.querySelectorAll('.rfc-tab').forEach((x) => x.classList.toggle('active', x === b));
        this.renderTab();
      }));
      this.renderTab();
    },

    body() { return this.el.querySelector('#rfc-body'); },
    fail(res) { this.body().innerHTML = `<p class="error-msg">${esc(res?.error || 'Failed to load')}</p>`; },
    productSelect(id = 'rfc-product') {
      return `<select id="${id}">${this.meta.products.map((p) => `<option value="${p.id}" ${Number(p.id) === Number(this.productId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
    },
    ingredientSelect(id, withBlank = true) {
      return `<select id="${id}">${withBlank ? '<option value="">— ingredient —</option>' : ''}${this.meta.ingredients.map((i) => `<option value="${i.id}">${esc(i.name)} (${esc(i.stock_unit)})</option>`).join('')}</select>`;
    },

    async renderTab() {
      if (!this.meta.products.length && !['ai', 'targets', 'alerts'].includes(this.tab)) {
        this.body().innerHTML = '<div class="rp-panel"><p>NO DATA AVAILABLE — no meals have recipe ingredient lines yet. Add ingredients to a meal in Recipe Builder.</p></div>';
        return;
      }
      this.body().innerHTML = '<p class="rp-muted">Loading…</p>';
      const fn = {
        cards: () => this.tabCards(), sales: () => this.tabSales(), whatif: () => this.tabWhatIf(), production: () => this.tabProduction(),
        variance: () => this.tabVariance(), waste: () => this.tabWaste(), prices: () => this.tabPrices(), history: () => this.tabHistory(),
        alerts: () => this.tabAlerts(), targets: () => this.tabTargets(), reports: () => this.tabReports(), ai: () => this.tabAi()
      }[this.tab];
      try { await fn(); } catch (err) { this.body().innerHTML = `<p class="error-msg">${esc(err.message || err)}</p>`; }
    },

    linesTable(lines) {
      return `<div class="rfc-table-wrap"><table class="rp-table"><thead><tr><th>Ingredient</th><th>Qty</th><th>Waste</th><th>Unit cost</th><th>Line cost</th><th>Share</th><th>Note</th></tr></thead><tbody>
        ${lines.map((l) => `<tr><td>${esc(l.name)}${l.optional ? ` <span class="rp-muted">(only with "${esc(l.option_name)}")</span>` : ''}</td>
          <td>${esc(l.quantity)} ${esc(l.unit)}</td><td>${l.waste_pct ? `${esc(l.waste_pct)}%` : '—'}</td>
          <td>${l.unit_cost ? `${esc(this.app.money(l.unit_cost))} / ${esc(l.stock_unit || '')}` : NA}</td>
          <td>${l.line_cost == null ? NA : esc(this.app.money(l.line_cost))}</td><td>${l.share_pct == null ? '—' : `${esc(l.share_pct)}%`}</td>
          <td class="rp-muted">${esc(l.issue || '')}</td></tr>`).join('')}</tbody></table></div>`;
    },

    statusHtml(list) {
      return (list || []).map((s) => `<div class="${s.ok ? 'rfc-ok' : 'rfc-bad'}" style="font-size:12px">${s.ok ? '✓' : '⚠'} ${esc(s.text)}</div>`).join('');
    },

    async tabCards() {
      const res = await API.rfcOverview(this.args());
      if (!res?.success) return this.fail(res);
      const d = res.data;
      const s = d.summary;
      this.body().innerHTML = `
        <div class="rp-cost-box" style="margin-bottom:12px">
          <div><div class="rp-muted">Recipes costed</div><strong>${s.complete} / ${s.recipes}</strong></div>
          <div><div class="rp-muted">Average food cost</div><strong>${this.pct(s.average_food_cost_pct)}</strong></div>
          <div><div class="rp-muted">Sold (${esc(d.range.label)})</div><strong>${esc(s.period_qty)}</strong></div>
          <div><div class="rp-muted">Revenue</div><strong>${this.money(s.period_revenue)}</strong></div>
          <div><div class="rp-muted">Recipe cost of sales</div><strong>${this.money(s.period_recipe_cost)}</strong></div>
          <div><div class="rp-muted">Gross contribution</div><strong>${this.money(s.period_contribution)}</strong></div>
        </div>
        <p class="rfc-note">${esc(d.price_note)}</p>
        <p class="rfc-note">${esc(d.allocation.note)}${d.allocation.configured ? ` Total applied: ${esc(d.allocation.total_pct)}% of price.` : ''}</p>
        <div class="rfc-cards">${d.cards.map((c) => `
          <div class="rfc-card">
            <h4>${esc(c.name)}</h4>
            <div class="rp-muted" style="font-size:12px;margin-bottom:6px">${esc(c.category || '')} · ${c.production_mode === 'make_to_stock' ? 'Made to stock' : 'Made to order'}</div>
            <div class="rfc-kv">
              <span>Selling price</span><strong>${this.money(c.selling_price)}</strong>
              <span>Recipe cost</span><strong>${this.money(c.recipe_cost)}</strong>
              <span>Food cost %</span><strong>${this.pct(c.food_cost_pct)}</strong>
              <span>Gross contribution / plate</span><strong>${this.money(c.gross_contribution)}</strong>
              ${c.contribution_after_allocations != null ? `<span>Est. after configured allocations</span><strong>${this.money(c.contribution_after_allocations)}</strong>` : ''}
              <span>Sold (${esc(d.range.label)})</span><strong>${esc(c.period.qty)}</strong>
              <span>Revenue</span><strong>${this.money(c.period.revenue)}</strong>
              <span>Contribution (period)</span><strong>${c.period.qty ? this.money(c.period.contribution) : '—'}</strong>
              ${c.costliest ? `<span>Costliest ingredient</span><strong>${esc(c.costliest.name)} (${esc(c.costliest.share_pct)}%)</strong>` : ''}
            </div>
            ${this.statusHtml(c.target_status)}
            ${c.complete ? '' : `<div class="rfc-bad" style="font-size:12px;margin-top:6px">${esc(c.issues[0] || 'Incomplete data')}</div>`}
            <div class="rfc-flex" style="margin-top:8px">
              <button type="button" class="btn btn-ghost btn-sm" data-detail="${c.product_id}">Details</button>
              <button type="button" class="btn btn-ghost btn-sm" data-whatif="${c.product_id}">What-If</button>
            </div>
          </div>`).join('')}</div>
        <div id="rfc-detail"></div>`;
      this.body().querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', () => this.showCard(Number(b.dataset.detail))));
      this.body().querySelectorAll('[data-whatif]').forEach((b) => b.addEventListener('click', () => { this.productId = Number(b.dataset.whatif); this.switchTab('whatif'); }));
    },

    switchTab(id) {
      this.tab = id;
      this.el.querySelectorAll('.rfc-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === id));
      this.renderTab();
    },

    async showCard(productId) {
      const box = this.body().querySelector('#rfc-detail');
      box.innerHTML = '<p class="rp-muted">Loading…</p>';
      const res = await API.rfcCostCard(productId, this.args());
      if (!res?.success) { box.innerHTML = `<p class="error-msg">${esc(res?.error)}</p>`; return; }
      const c = res.data;
      const sales = Object.entries(c.sales).map(([k, v]) => `<tr><td>${esc(v.label || { today: 'Today', this_week: 'This week', this_month: 'This month' }[k] || k)}</td><td>${esc(v.qty)}</td><td>${this.money(v.revenue)}</td><td>${v.qty ? this.money(v.recipe_cost) : '—'}</td><td>${v.qty ? this.money(v.contribution) : '—'}</td><td>${v.qty ? this.pct(v.food_cost_pct) : '—'}</td></tr>`).join('');
      box.innerHTML = `<div class="rp-panel" style="margin-top:14px">
        <h3>Meal Profitability — ${esc(c.name)}</h3>
        <div class="rp-cost-box">
          <div><div class="rp-muted">Selling price</div><strong>${this.money(c.selling_price)}</strong></div>
          <div><div class="rp-muted">Recipe cost</div><strong>${this.money(c.recipe_cost)}</strong></div>
          <div><div class="rp-muted">Food cost %</div><strong>${this.pct(c.food_cost_pct)}</strong></div>
          <div><div class="rp-muted">Gross contribution</div><strong>${this.money(c.gross_contribution)}</strong></div>
          ${c.contribution_after_allocations != null ? `<div><div class="rp-muted">After allocations</div><strong>${this.money(c.contribution_after_allocations)}</strong></div>` : ''}
        </div>
        <p class="rfc-note">${esc(c.price_source)}. Gross contribution is before staff, rent and other operating expenses.</p>
        ${c.allocation_lines?.length ? `<p class="rfc-note">Allocations (Financial Intelligence): ${c.allocation_lines.map((a) => `${esc(a.name)} ${esc(a.pct)}% = ${esc(this.app.money(a.amount))}`).join(' · ')}</p>` : ''}
        ${this.statusHtml(c.target_status)}
        <div class="rfc-sec">Ingredients</div>${this.linesTable(c.lines)}
        ${c.optional_lines?.length ? `<p class="rfc-note">Optional extras (added only when the customer selects them): ${c.optional_lines.map((o) => `${esc(o.name)} ${o.cost == null ? 'INSUFFICIENT DATA' : esc(this.app.money(o.cost))}`).join(' · ')}</p>` : ''}
        <div class="rfc-sec">POS sales</div>
        <table class="rp-table"><thead><tr><th>Period</th><th>Qty</th><th>Revenue</th><th>Recipe cost</th><th>Contribution</th><th>Food cost %</th></tr></thead><tbody>${sales}</tbody></table>
        <div class="rfc-sec">Recent cost history</div>
        ${c.history.length ? `<table class="rp-table"><thead><tr><th>Date</th><th>Recipe cost</th><th>Price</th><th>Food cost %</th></tr></thead><tbody>${c.history.map((h) => `<tr><td>${esc(h.date)}</td><td>${esc(this.app.money(h.recipe_cost))}${h.complete ? '' : ' (incomplete)'}</td><td>${esc(this.app.money(h.selling_price))}</td><td>${h.food_cost_pct == null ? '—' : `${esc(h.food_cost_pct)}%`}</td></tr>`).join('')}</tbody></table>` : '<p class="rp-muted">No history yet.</p>'}
      </div>`;
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    async tabSales() {
      const res = await API.rfcSales(this.args());
      if (!res?.success) return this.fail(res);
      const d = res.data;
      const row = (r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.qty)}</td><td>${esc(r.daily_average_qty)}${r.daily_target != null ? ` / ${esc(r.daily_target)} <span class="${r.daily_target_met ? 'rfc-ok' : 'rfc-bad'}">${r.daily_target_met ? '✓' : '⚠'}</span>` : ''}</td><td>${this.money(r.revenue)}</td><td>${this.money(r.recipe_cost)}</td><td>${this.pct(r.food_cost_pct)}</td><td>${this.money(r.contribution)}</td><td class="rp-muted" style="font-size:12px">${esc(r.cost_basis)}</td></tr>`;
      this.body().innerHTML = `
        <div class="rp-cost-box" style="margin-bottom:12px">
          <div><div class="rp-muted">Meals sold</div><strong>${esc(d.totals.qty)}</strong></div>
          <div><div class="rp-muted">Revenue</div><strong>${this.money(d.totals.revenue)}</strong></div>
          <div><div class="rp-muted">Recipe cost</div><strong>${this.money(d.totals.recipe_cost)}</strong></div>
          <div><div class="rp-muted">Food cost %</div><strong>${this.pct(d.totals.food_cost_pct)}</strong></div>
          <div><div class="rp-muted">Gross contribution</div><strong>${this.money(d.totals.contribution)}</strong></div>
        </div>
        <p class="rfc-note">${esc(d.range.label)} (${esc(d.range.from)} to ${esc(d.range.to)}). ${esc(d.note)}</p>
        ${d.rows.length ? `<div class="rfc-table-wrap"><table class="rp-table"><thead><tr><th>Meal</th><th>Qty sold</th><th>Per day / target</th><th>Revenue</th><th>Recipe cost</th><th>Food cost %</th><th>Contribution</th><th>Cost basis</th></tr></thead><tbody>${d.rows.map(row).join('')}</tbody></table></div>` : '<p>NO DATA AVAILABLE FOR THIS PERIOD</p>'}
        ${d.not_sold.length ? `<p class="rfc-note">Not sold in this period: ${d.not_sold.map((p) => esc(p.name)).join(', ')}</p>` : ''}`;
    },

    async tabWhatIf() {
      this.body().innerHTML = `<div class="rp-panel">
        <h3>What-If Simulator</h3>
        <p class="rfc-note">Simulation only — the POS price, recipe and ingredient costs are not changed.</p>
        <div class="rfc-flex"><label>Meal</label>${this.productSelect('rfc-wi-product')}
          <label>New selling price</label><input type="number" step="0.01" min="0" id="rfc-wi-price" placeholder="current" style="width:110px">
          <label>Quantity sold</label><input type="number" step="1" min="0" id="rfc-wi-qty" placeholder="this month" style="width:100px">
          <label>Contribution goal (R)</label><input type="number" step="1" min="0" id="rfc-wi-goal" style="width:100px"></div>
        <div class="rfc-sec">Ingredient cost change</div>
        <div class="rfc-flex">${this.ingredientSelect('rfc-wi-ing')}
          <select id="rfc-wi-mode"><option value="change">change by (R)</option><option value="unit_cost">new cost (R)</option><option value="change_pct">change by (%)</option></select>
          <input type="number" step="0.01" id="rfc-wi-val" style="width:100px">
          <label>per</label><select id="rfc-wi-unit"><option value="">stock unit</option><option>kg</option><option>g</option><option>l</option><option>ml</option><option>each</option></select></div>
        <div class="rfc-sec">Portion change</div>
        <div class="rfc-flex">${this.ingredientSelect('rfc-wi-ping')}
          <input type="number" step="0.001" min="0" id="rfc-wi-pqty" placeholder="new qty" style="width:100px">
          <select id="rfc-wi-punit"><option>g</option><option>kg</option><option>ml</option><option>l</option><option>each</option><option>portion</option></select></div>
        <div style="margin-top:10px"><button type="button" class="btn btn-primary" id="rfc-wi-run">Simulate</button></div>
        <div id="rfc-wi-out" style="margin-top:12px"></div></div>`;
      const b = this.body();
      b.querySelector('#rfc-wi-run').onclick = async () => {
        this.productId = Number(b.querySelector('#rfc-wi-product').value);
        const d = { product_id: this.productId, ...this.branchArgs(), price: b.querySelector('#rfc-wi-price').value, quantity: b.querySelector('#rfc-wi-qty').value, target_contribution: b.querySelector('#rfc-wi-goal').value };
        const ing = b.querySelector('#rfc-wi-ing').value; const val = b.querySelector('#rfc-wi-val').value;
        if (ing && val !== '') d.ingredient_costs = [{ ingredient_product_id: Number(ing), [b.querySelector('#rfc-wi-mode').value]: Number(val), unit: b.querySelector('#rfc-wi-unit').value || null }];
        const ping = b.querySelector('#rfc-wi-ping').value; const pq = b.querySelector('#rfc-wi-pqty').value;
        if (ping && pq !== '') d.portions = [{ ingredient_product_id: Number(ping), quantity: Number(pq), unit: b.querySelector('#rfc-wi-punit').value }];
        const res = await API.rfcWhatIf(d);
        const out = b.querySelector('#rfc-wi-out');
        if (!res?.success) { out.innerHTML = `<p class="error-msg">${esc(res?.error)}</p>`; return; }
        const r = res.data;
        const line = (label, k, fmt) => `<tr><td>${label}</td><td>${fmt(r.current[k])}</td><td>${fmt(r.simulation[k])}</td><td>${r.difference[k] == null ? '—' : fmt(r.difference[k])}</td></tr>`;
        const m = (v) => this.money(v); const p = (v) => this.pct(v);
        out.innerHTML = `<table class="rp-table rfc-cmp"><thead><tr><th>${esc(r.name)}</th><th>Current</th><th>Simulation</th><th>Difference</th></tr></thead><tbody>
          ${line('Selling price', 'selling_price', m)}${line('Recipe cost', 'recipe_cost', m)}${line('Food cost %', 'food_cost_pct', p)}${line('Gross contribution / plate', 'gross_contribution', m)}
          <tr><td>Est. after configured allocations</td><td>${r.current.contribution_after_allocations == null ? '—' : m(r.current.contribution_after_allocations)}</td><td>${r.simulation.contribution_after_allocations == null ? '—' : m(r.simulation.contribution_after_allocations)}</td><td></td></tr>
          ${line(`Total contribution (${esc(r.quantity)} plates, ${esc(r.quantity_basis)})`, 'total_contribution', m)}
          ${r.target_contribution != null ? `<tr><td>Plates for ${esc(this.app.money(r.target_contribution))} contribution</td><td>${r.current.plates_for_target ?? NA}</td><td>${r.simulation.plates_for_target ?? NA}</td><td></td></tr>` : ''}
          </tbody></table>
          ${r.issues.length ? `<div class="rfc-bad" style="font-size:12px;margin-top:6px">${r.issues.map(esc).join('<br>')}</div>` : ''}
          <p class="rfc-note">${esc(r.note)}</p>`;
      };
    },

    async tabProduction() { await this.renderProductionOnly(this.body()); },

    async renderProductionOnly(host) {
      if (!host) return;
      const products = this.meta?.products || [];
      if (!products.length) {
        const res = await API.recipeMealProducts?.({}, this.app.user);
        (res?.data || []).forEach((p) => products.push({ id: p.id, name: p.name }));
      }
      host.innerHTML = `<div class="rp-panel"><h3>Production Calculator</h3>
        <p class="rfc-note">Shows the ingredients and expected cost to produce a quantity. Nothing is deducted — record real batches in Production.</p>
        <div class="rfc-flex"><label>Meal</label><select id="rfc-pc-product">${products.map((p) => `<option value="${p.id}" ${Number(p.id) === Number(this.productId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
          <label>Quantity</label><input type="number" min="1" step="1" id="rfc-pc-qty" value="100" style="width:100px">
          <button type="button" class="btn btn-primary" id="rfc-pc-run">Calculate</button></div>
        <div id="rfc-pc-out" style="margin-top:12px"></div></div>`;
      host.querySelector('#rfc-pc-run').onclick = async () => {
        const pid = Number(host.querySelector('#rfc-pc-product').value);
        const res = await API.rfcProduction(pid, Number(host.querySelector('#rfc-pc-qty').value), this.branchArgs());
        const out = host.querySelector('#rfc-pc-out');
        if (!res?.success) { out.innerHTML = `<p class="error-msg">${esc(res?.error)}</p>`; return; }
        const r = res.data;
        const showCost = r.lines.some((l) => l.expected_cost !== undefined);
        out.innerHTML = `
          <div class="rp-cost-box"><div><div class="rp-muted">Produce</div><strong>${esc(r.quantity)} × ${esc(r.name)}</strong></div>
            ${showCost ? `<div><div class="rp-muted">Expected cost</div><strong>${this.money(r.expected_cost)}</strong></div><div><div class="rp-muted">Cost per portion</div><strong>${this.money(r.cost_per_portion)}</strong></div>` : ''}
            <div><div class="rp-muted">Stock (${esc(r.stock_scope)})</div><strong class="${r.can_produce ? 'rfc-ok' : 'rfc-bad'}">${r.can_produce ? 'Enough' : 'Shortfall'}</strong></div></div>
          <div class="rfc-table-wrap"><table class="rp-table"><thead><tr><th>Ingredient</th><th>Per portion</th><th>Required</th><th>In stock</th><th>Shortfall</th>${showCost ? '<th>Expected cost</th>' : ''}</tr></thead><tbody>
          ${r.lines.map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(l.per_portion)} ${esc(l.per_portion_unit)}${l.waste_pct ? ` +${esc(l.waste_pct)}%` : ''}</td><td>${this.qty(l.required_qty, l.stock_unit)}</td><td>${esc(l.in_stock)} ${esc(l.stock_unit)}</td><td class="${l.shortfall > 0 ? 'rfc-bad' : ''}">${l.shortfall == null ? NA : esc(l.shortfall)}</td>${showCost ? `<td>${this.money(l.expected_cost)}</td>` : ''}</tr>`).join('')}
          </tbody></table></div>
          ${r.issues.length ? `<div class="rfc-bad" style="font-size:12px">${r.issues.map(esc).join('<br>')}</div>` : ''}
          <p class="rfc-note">${esc(r.note)}</p>`;
      };
    },

    async tabVariance() {
      const res = await API.rfcVariance(this.args());
      if (!res?.success) return this.fail(res);
      const d = res.data;
      const cat = { above_expected: ['Above expected', 'rfc-bad'], below_expected: ['Below expected', 'rfc-bad'], within_tolerance: ['Within tolerance', 'rfc-ok'], no_expected_usage: ['No expected usage', 'rfc-bad'], insufficient_data: ['Insufficient data', 'rfc-na'] };
      this.body().innerHTML = `
        <p class="rfc-note">${esc(d.range.label)}: expected usage = recipe quantities × meals sold (made-to-order) + planned quantities of completed made-to-stock production. Actual usage = stock reductions recorded for the ingredient. ${d.tolerance_pct != null ? `Tolerance: ±${esc(d.tolerance_pct)}%.` : 'No tolerance set (Targets).'}</p>
        ${d.rows.length ? `<div class="rfc-table-wrap"><table class="rp-table"><thead><tr><th>Ingredient</th><th>Expected</th><th>Actual</th><th>Variance</th><th>Variance %</th><th>Variance cost</th><th>Status</th><th>Potential explanations</th></tr></thead><tbody>
          ${d.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.expected_qty)} ${esc(r.unit)}</td><td title="Sales ${esc(r.actual_breakdown.pos_sales)}, production ${esc(r.actual_breakdown.production)}, waste ${esc(r.actual_breakdown.waste)}, adjustments ${esc(r.actual_breakdown.adjustments)}, returns −${esc(r.actual_breakdown.returns)}">${esc(r.actual_qty)} ${esc(r.unit)}</td>
            <td>${r.variance_qty > 0 ? '+' : ''}${esc(r.variance_qty)}</td><td>${r.variance_pct == null ? '—' : `${r.variance_pct > 0 ? '+' : ''}${esc(r.variance_pct)}%`}</td><td>${r.variance_cost == null ? '—' : esc(this.app.money(r.variance_cost))}</td>
            <td class="${(cat[r.category] || [])[1] || ''}">${esc((cat[r.category] || [r.category])[0])}</td><td style="font-size:12px">${[...r.issues, ...r.potential_explanations].map(esc).join('<br>') || '—'}</td></tr>`).join('')}
          </tbody></table></div>` : '<p>NO DATA AVAILABLE FOR THIS PERIOD</p>'}
        <p class="rfc-note">${esc(d.note)}</p>`;
    },

    async tabWaste() {
      const res = await API.rfcWaste(this.args());
      if (!res?.success) return this.fail(res);
      const d = res.data;
      this.body().innerHTML = `
        <div class="rp-cost-box" style="margin-bottom:12px">
          <div><div class="rp-muted">Approved waste cost</div><strong>${this.money(d.totals.approved_cost)}</strong></div>
          <div><div class="rp-muted">Pending approval</div><strong>${this.money(d.totals.pending_cost)}</strong></div>
          <div><div class="rp-muted">Records</div><strong>${esc(d.totals.records)}</strong></div>
          ${d.totals.uncosted ? `<div><div class="rp-muted">Without cost</div><strong class="rfc-bad">${esc(d.totals.uncosted)}</strong></div>` : ''}
        </div>
        ${d.by_reason.length ? `<p class="rfc-note">By reason: ${d.by_reason.map((r) => `${esc(r.reason)} ${esc(this.app.money(r.cost))}`).join(' · ')}</p>` : ''}
        ${d.rows.length ? `<div class="rfc-table-wrap"><table class="rp-table"><thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>Cost</th><th>% of usage</th><th>Reason</th><th>Status</th><th>Branch</th></tr></thead><tbody>
          ${d.rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.name)} <span class="rp-muted">(${esc(r.kind)})</span></td><td>${esc(r.quantity)} ${esc(r.unit || '')}</td><td title="${esc(r.cost_basis)}">${this.money(r.cost)}</td><td>${r.waste_pct_of_usage == null ? '—' : `${esc(r.waste_pct_of_usage)}%`}</td><td>${esc(r.reason || r.waste_type)}</td><td>${esc(r.status)}</td><td>${esc(this.branchName(r.branch_id))}</td></tr>`).join('')}
          </tbody></table></div>` : '<p>NO DATA AVAILABLE FOR THIS PERIOD</p>'}
        <p class="rfc-note">${esc(d.note)}</p>`;
    },

    branchName(id) {
      if (id == null) return '—';
      return (this.app.branches || []).find((b) => Number(b.id) === Number(id))?.name || `Branch ${id}`;
    },

    async tabPrices() {
      const res = await API.rfcPriceChanges({ days: 90 });
      if (!res?.success) return this.fail(res);
      const d = res.data;
      this.body().innerHTML = `<p class="rfc-note">${esc(d.note)}</p>
        ${d.rows.length ? d.rows.map((r) => `<div class="rp-panel" style="margin-bottom:10px">
          <h4 style="margin:0 0 4px">${esc(r.name)}: ${esc(this.app.money(r.old_unit_cost))} → ${esc(this.app.money(r.new_unit_cost))} per ${esc(r.stock_unit)} <span class="${r.change_pct > 0 ? 'rfc-bad' : 'rfc-ok'}">(${r.change_pct > 0 ? '+' : ''}${esc(r.change_pct)}%)</span></h4>
          <div class="rp-muted" style="font-size:12px">${esc(r.changed_at)} · ${esc(r.source)}</div>
          ${r.affected.length ? `<table class="rp-table" style="margin-top:6px"><thead><tr><th>Recipe</th><th>Old cost</th><th>New cost</th><th>Change</th><th>Old food cost %</th><th>New food cost %</th></tr></thead><tbody>
            ${r.affected.map((a) => `<tr><td>${esc(a.name)}</td><td>${this.money(a.old_cost)}</td><td>${this.money(a.new_cost)}</td><td>${this.money(a.cost_change)}</td><td>${this.pct(a.old_food_cost_pct)}</td><td>${this.pct(a.new_food_cost_pct)}</td></tr>`).join('')}</tbody></table>` : '<p class="rp-muted">Not used in any recipe.</p>'}
        </div>`).join('') : '<p>No ingredient cost changes recorded in the last 90 days.</p>'}`;
    },

    async tabHistory() {
      this.body().innerHTML = `<div class="rfc-flex"><label>Meal</label>${this.productSelect('rfc-h-product')}</div><div id="rfc-h-out" style="margin-top:10px"></div>`;
      const sel = this.body().querySelector('#rfc-h-product');
      const load = async () => {
        this.productId = Number(sel.value);
        const res = await API.rfcHistory(this.productId);
        const out = this.body().querySelector('#rfc-h-out');
        if (!res?.success) { out.innerHTML = `<p class="error-msg">${esc(res?.error)}</p>`; return; }
        const d = res.data;
        out.innerHTML = `${d.rows.length ? `<table class="rp-table"><thead><tr><th>Date</th><th>Recipe cost</th><th>Selling price</th><th>Food cost %</th><th>Complete</th></tr></thead><tbody>
          ${d.rows.slice().reverse().map((h) => `<tr><td>${esc(h.date)}</td><td>${esc(this.app.money(h.recipe_cost))}</td><td>${esc(this.app.money(h.selling_price))}</td><td>${h.food_cost_pct == null ? '—' : `${esc(h.food_cost_pct)}%`}</td><td>${h.complete ? 'Yes' : '<span class="rfc-bad">No</span>'}</td></tr>`).join('')}</tbody></table>` : '<p>No history yet.</p>'}
          <p class="rfc-note">${esc(d.note)}</p>`;
      };
      sel.onchange = load;
      await load();
    },

    async tabAlerts() {
      const res = await API.rfcAlerts(this.branchArgs());
      if (!res?.success) return this.fail(res);
      const d = res.data;
      this.body().innerHTML = `${d.alerts.length ? d.alerts.map((a) => `<div class="rfc-alert ${esc(a.severity)}">${esc(a.text)}</div>`).join('') : '<p class="rfc-ok">No alerts.</p>'}<p class="rfc-note">${esc(d.note)}</p>`;
    },

    async tabTargets() {
      const res = await API.rfcTargets();
      if (!res?.success) return this.fail(res);
      const d = res.data;
      const can = this.meta.can_edit_targets;
      const field = (k, label, step = '0.1') => `<label style="display:flex;flex-direction:column;font-size:12px;gap:2px">${label}<input type="number" min="0" step="${step}" data-setting="${k}" value="${d.settings[k] ?? ''}" ${can ? '' : 'disabled'} style="width:160px"></label>`;
      this.body().innerHTML = `<div class="rp-panel"><h3>General targets</h3><p class="rfc-note">${esc(d.note)} Leave a field empty for "not set".</p>
        <div class="rfc-flex">${field('food_cost_target_pct', 'Food cost target %')}${field('contribution_target_per_plate', 'Contribution per plate (R)', '0.01')}${field('daily_sales_target_qty', 'Daily sales target (qty)', '1')}${field('monthly_sales_target_qty', 'Monthly sales target (qty)', '1')}</div>
        <div class="rfc-sec">Alert thresholds</div>
        <div class="rfc-flex">${field('ingredient_increase_alert_pct', 'Ingredient price increase %')}${field('recipe_cost_increase_alert_pct', 'Recipe cost increase %')}${field('consumption_variance_alert_pct', 'Usage variance tolerance %')}${field('waste_increase_alert_pct', 'Waste increase %')}</div>
        ${can ? '<div style="margin-top:10px"><button type="button" class="btn btn-primary" id="rfc-t-save">Save general targets</button></div>' : '<p class="rp-muted">Only recipe administrators can change targets.</p>'}</div>
        <div class="rp-panel" style="margin-top:12px"><h3>Per-meal targets</h3>
        <div class="rfc-table-wrap"><table class="rp-table"><thead><tr><th>Meal</th><th>Food cost %</th><th>Contribution (R)</th><th>Daily qty</th><th>Monthly qty</th><th></th></tr></thead><tbody>
        ${d.products.map((p) => `<tr data-pid="${p.product_id}"><td>${esc(p.name)}</td>
          ${['food_cost_target_pct', 'contribution_target', 'daily_qty_target', 'monthly_qty_target'].map((k) => `<td><input type="number" min="0" step="0.01" data-k="${k}" value="${p[k] ?? ''}" ${can ? '' : 'disabled'} style="width:90px"></td>`).join('')}
          <td>${can ? '<button type="button" class="btn btn-ghost btn-sm" data-save-p>Save</button>' : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
      if (!can) return;
      this.body().querySelector('#rfc-t-save').onclick = async () => {
        const settings = {};
        this.body().querySelectorAll('[data-setting]').forEach((i) => { settings[i.dataset.setting] = i.value === '' ? null : Number(i.value); });
        const r = await API.rfcSaveTargets({ settings });
        Utils.toast(r?.success ? 'Targets saved' : (r?.error || 'Save failed'), r?.success ? 'success' : 'error');
      };
      this.body().querySelectorAll('[data-save-p]').forEach((b) => b.addEventListener('click', async () => {
        const tr = b.closest('tr');
        const product = { product_id: Number(tr.dataset.pid) };
        tr.querySelectorAll('[data-k]').forEach((i) => { product[i.dataset.k] = i.value === '' ? null : Number(i.value); });
        const r = await API.rfcSaveTargets({ product });
        Utils.toast(r?.success ? 'Meal target saved' : (r?.error || 'Save failed'), r?.success ? 'success' : 'error');
      }));
    },

    async tabReports() {
      this.body().innerHTML = `<div class="rp-panel"><h3>Food cost reports</h3>
        <p class="rfc-note">Uses the selected period and branch. Download as CSV or PDF, or print on A4.</p>
        <div class="rfc-flex"><select id="rfc-r-type">${this.meta.reports.map((r) => `<option value="${r.id}">${esc(r.title)}</option>`).join('')}</select>
          <button type="button" class="btn btn-primary" id="rfc-r-run">Generate</button>
          <button type="button" class="btn btn-ghost" id="rfc-r-csv" disabled>CSV</button>
          <button type="button" class="btn btn-ghost" id="rfc-r-pdf" disabled>PDF</button>
          <button type="button" class="btn btn-ghost" id="rfc-r-print" disabled>Print</button></div>
        <div id="rfc-r-out" style="margin-top:12px"></div></div>`;
      const b = this.body();
      const setEnabled = (on) => ['#rfc-r-csv', '#rfc-r-pdf', '#rfc-r-print'].forEach((s) => { b.querySelector(s).disabled = !on; });
      const title = () => {
        const r = this.lastReport;
        const branch = this.app.branchId ? ` — ${this.branchName(this.app.branchId)}` : '';
        return `${r.title}${r.period ? ` — ${r.period.label}` : ''}${branch}`;
      };
      b.querySelector('#rfc-r-run').onclick = async () => {
        const res = await API.rfcReport(b.querySelector('#rfc-r-type').value, this.args());
        const out = b.querySelector('#rfc-r-out');
        if (!res?.success) { setEnabled(false); out.innerHTML = `<p class="error-msg">${esc(res?.error)}</p>`; return; }
        this.lastReport = res.data;
        setEnabled(res.data.rows.length > 0);
        out.innerHTML = res.data.rows.length ? `<div class="rfc-table-wrap"><table class="rp-table"><thead><tr>${res.data.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
          ${res.data.rows.slice(0, 300).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
          <p class="rfc-note">Generated ${esc(res.data.generated_at)} by ${esc(res.data.generated_by)}${res.data.rows.length > 300 ? ` — showing 300 of ${res.data.rows.length} rows (exports include all)` : ''}.</p>` : '<p>NO DATA AVAILABLE FOR THIS REPORT</p>';
      };
      b.querySelector('#rfc-r-csv').onclick = () => {
        const r = this.lastReport;
        this.app.exportCsv(`${r.type}-${Date.now()}.csv`, r.rows.map((row) => Object.fromEntries(r.headers.map((h, i) => [h, row[i]]))));
      };
      b.querySelector('#rfc-r-pdf').onclick = () => this.app.exportPdf(`${this.lastReport.type}-${Date.now()}.pdf`, title(), this.lastReport.headers, this.lastReport.rows);
      b.querySelector('#rfc-r-print').onclick = () => this.app.printDoc(title(), this.lastReport.headers, this.lastReport.rows);
    },

    async tabAi() {
      const examples = ['What does this meal cost to make?', 'How much do I make per plate?', 'What is the food cost % of this meal?', 'Which ingredient is the most expensive?',
        'Why did this meal cost increase?', 'Which ingredients increased in price?', 'Which meal has the highest food cost?', 'Which meal makes the highest contribution?',
        'What are my best sellers?', 'What are my worst sellers?', 'How many plates do I need to sell to make R1,000 contribution?', 'What happens if fish increases by R10 per kg?',
        'What happens if I reduce the portion from 500g to 400g?', 'Which recipes are affected if chicken price increases?', 'Which ingredients are used above expected?', 'What should I review?'];
      this.body().innerHTML = `<div class="rp-panel"><h3>AI Food Cost Advisor</h3>
        <p class="rfc-note">Answers use only your recipes, ingredient costs, POS sales, production, waste and stock records. Format: FACT → ANALYSIS → RECOMMENDATION. The advisor never changes anything.
          ${this.meta.ai_engine === 'rule_based' ? 'Running in rule-based mode (no AI model configured on the server).' : ''}</p>
        <div class="rfc-flex"><label>Meal</label>${this.productSelect('rfc-ai-product')}</div>
        <div class="rfc-flex" style="margin-top:8px"><input type="text" id="rfc-ai-q" maxlength="500" placeholder="Ask a question…" style="flex:1;min-width:240px"><button type="button" class="btn btn-primary" id="rfc-ai-ask">Ask</button></div>
        <div class="rfc-flex" style="margin-top:8px">${examples.map((q) => `<button type="button" class="btn btn-ghost btn-sm" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        <div id="rfc-ai-out" style="margin-top:12px"></div>
        <div class="rfc-sec">Recent questions</div><div id="rfc-ai-hist"></div></div>`;
      const b = this.body();
      const show = (r) => `<div class="rp-panel" style="margin-bottom:10px">
        <div class="rp-muted" style="font-size:12px">${esc(r.created_at || '')} · ${esc(r.engine)}</div><strong>${esc(r.question)}</strong>
        ${r.facts.length ? `<div class="rfc-sec">Fact</div><ul>${r.facts.map((f) => `<li>${esc(f.text)} <span class="rp-muted" style="font-size:11px">[${esc(f.source)}]</span></li>`).join('')}</ul>` : ''}
        ${r.insufficient.length ? `<div class="rfc-sec" style="color:#b45309">Insufficient data</div><ul>${r.insufficient.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${r.analysis.length ? `<div class="rfc-sec">Analysis</div><ul>${r.analysis.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${r.recommendations.length ? `<div class="rfc-sec">Recommendation</div><ul>${r.recommendations.map((x) => `<li>${esc(x.text || x)}</li>`).join('')}</ul>` : ''}
        ${r.approval_note ? `<p class="rfc-note">${esc(r.approval_note)}</p>` : ''}${r.engine_note ? `<p class="rfc-note">${esc(r.engine_note)}</p>` : ''}</div>`;
      const loadHist = async () => {
        const h = await API.rfcAiHistory(10);
        b.querySelector('#rfc-ai-hist').innerHTML = h?.success && h.data.length ? h.data.map(show).join('') : '<p class="rp-muted">None yet.</p>';
      };
      const ask = async (q) => {
        const out = b.querySelector('#rfc-ai-out');
        out.innerHTML = '<p class="rp-muted">Analysing…</p>';
        const res = await API.rfcAiAsk(q, { product_id: Number(b.querySelector('#rfc-ai-product').value), ...this.branchArgs() });
        if (!res?.success) { out.innerHTML = `<p class="error-msg">${esc(res?.error)}</p>`; return; }
        out.innerHTML = show(res.data);
        loadHist();
      };
      b.querySelector('#rfc-ai-ask').onclick = () => { const q = b.querySelector('#rfc-ai-q').value.trim(); if (q) ask(q); };
      b.querySelector('#rfc-ai-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') b.querySelector('#rfc-ai-ask').click(); });
      b.querySelectorAll('[data-q]').forEach((x) => x.addEventListener('click', () => { b.querySelector('#rfc-ai-q').value = x.dataset.q; ask(x.dataset.q); }));
      loadHist();
    }
  };

  window.RecipeFoodCostPage = Page;
})();

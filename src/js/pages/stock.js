const StockPage = {
  tab: 'stock',

  async render(el, app) {
    this.app = app;
    this._host = el;
    const canNonSelling = ['owner', 'manager', 'assistant_manager'].includes(app.user?.role);
    el.innerHTML = `
      <div class="page-toolbar"><h3>Stock Management</h3>
        <button class="btn btn-primary" id="adjust-stock" ${this.tab !== 'stock' ? 'style="display:none"' : ''}>Adjust Stock</button>
      </div>
      <div class="admin-tabs">
        <button class="admin-tab ${this.tab === 'stock' ? 'active' : ''}" data-tab="stock">Current Stock</button>
        <button class="admin-tab ${this.tab === 'movements' ? 'active' : ''}" data-tab="movements">Movements</button>
        <button class="admin-tab ${this.tab === 'waste' ? 'active' : ''}" data-tab="waste">Waste / Damaged</button>
        ${canNonSelling ? `<button class="admin-tab ${this.tab === 'nonselling' ? 'active' : ''}" data-tab="nonselling">Non-Selling Products</button>` : ''}
      </div>
      <div id="stock-tab-content">${Utils.pageSkeleton ? Utils.pageSkeleton(3) : '<p class="muted">Loading…</p>'}</div>`;

    el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
      this.tab = b.dataset.tab;
      this.render(el, app);
    }));

    const content = document.getElementById('stock-tab-content');
    try {
      if (this.tab === 'movements') return await this.renderMovements(content);
      if (this.tab === 'waste') return await this.renderWaste(content);
      if (this.tab === 'nonselling') return await this.renderNonSelling(content);
      return await this.renderStock(content);
    } catch (err) {
      content.innerHTML = `<p class="error-msg">${Utils.escHtml(err.message || 'Could not load')}</p>
        <button type="button" class="btn btn-primary" id="stk-retry">Retry</button>`;
      document.getElementById('stk-retry')?.addEventListener('click', () => this.render(el, app));
    }
  },

  async activate(el, app) {
    this.app = app;
    this._host = el;
    const tabEl = el?.querySelector?.('#stock-tab-content');
    if (tabEl && this.tab === 'stock' && this._stockItems?.length) {
      this.renderStock(tabEl);
      return;
    }
    return this.render(el, app);
  },

  async renderWaste(el) {
    el.innerHTML = Utils.pageSkeleton ? Utils.pageSkeleton(3) : '<p class="muted">Loading…</p>';
    const [stockRes, pendingRes] = await Promise.all([
      this._stockItems ? Promise.resolve({ data: this._stockItems }) : API.getStockReport().catch(() => ({ data: [] })),
      API.getWasteRecords(Utils.monthStart(), Utils.today(), { status: 'pending' }).catch(() => ({ data: [] }))
    ]);
    const items = (stockRes.data || this._stockItems || []).filter(p => p.name !== '__Property Damage__');
    this._stockItems = items;
    this._wasteProducts = items;
    this._wasteSelected = this._wasteSelected || null;
    const pending = pendingRes.data || [];
    this._wastePhotos = this._wastePhotos || [];
    const selLabel = this._wasteSelected
      ? `${Utils.escHtml(this._wasteSelected.name)} (${this._wasteSelected.stock_quantity ?? 0} ${this._wasteSelected.unit || ''})`
      : 'Search & select product / ingredient…';

    el.innerHTML = `<div class="card"><div class="card-body">
      <h4>Record waste / damaged stock</h4>
      <p class="muted">Submit with a photo for admin approval. Stock is deducted only after approval in Admin → Settings Approvals.</p>
      <div class="form-grid">
        <div class="field full"><label>Type</label>
          <select id="stk-waste-kind">
            <option value="ingredient">Product / Ingredient (deduct stock after approval)</option>
            <option value="property">Company property (no stock deduct)</option>
          </select></div>
        <div class="field full" id="stk-waste-prod-wrap"><label>Product / Ingredient</label>
          <input type="hidden" id="stk-waste-prod" value="${this._wasteSelected?.id || ''}">
          <button type="button" class="btn btn-ghost" id="stk-waste-pick" style="width:100%;justify-content:space-between;text-align:left">
            <span id="stk-waste-pick-lbl">${selLabel}</span>
            <span>🔍</span>
          </button>
          <p class="muted" style="margin:6px 0 0;font-size:12px">${items.length} items — tap to open search popup</p>
        </div>
        <div class="field full hidden" id="stk-waste-prop-wrap"><label>What was damaged?</label>
          <input id="stk-waste-prop" placeholder="e.g. Broken fridge shelf, damaged chair…"></div>
        <div class="field"><label>Quantity</label><input type="number" id="stk-waste-qty" step="0.001" min="0" value="1"></div>
        <div class="field"><label>Reason</label><input id="stk-waste-reason" placeholder="Spoiled, dropped, expired…"></div>
        <div class="field full"><label>Photo (required)</label>
          <button type="button" class="btn btn-ghost btn-sm" id="stk-waste-photo">📷 Add photo</button>
          <span id="stk-waste-photo-lbl" class="muted" style="margin-left:8px">${this._wastePhotos.length ? '1 photo' : 'None'}</span>
        </div>
      </div>
      <button type="button" class="btn btn-danger" id="stk-waste-save" style="margin-top:12px">Submit for approval</button>
    </div></div>
    <div class="card" style="margin-top:16px"><div class="card-body">
      <h4>Pending approvals (${pending.length})</h4>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>Reason</th><th>Status</th></tr></thead>
        <tbody>${pending.map(w => `<tr>
          <td>${Utils.formatDateTime(w.created_at)}</td>
          <td>${Utils.escHtml(w.product_name || w.property_name || '—')}</td>
          <td>${w.quantity}</td><td>${Utils.escHtml(w.reason || '')}</td>
          <td><span class="tag" style="background:var(--warning)">Pending</span></td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">No pending waste</td></tr>'}
      </tbody></table></div>
    </div></div>`;

    const syncKind = () => {
      const kind = document.getElementById('stk-waste-kind')?.value;
      document.getElementById('stk-waste-prod-wrap')?.classList.toggle('hidden', kind === 'property');
      document.getElementById('stk-waste-prop-wrap')?.classList.toggle('hidden', kind !== 'property');
    };
    document.getElementById('stk-waste-kind')?.addEventListener('change', syncKind);
    syncKind();

    document.getElementById('stk-waste-pick')?.addEventListener('click', () => {
      Utils.openProductSearchPicker({
        items: this._wasteProducts || [],
        title: 'Select product / ingredient',
        hint: 'Search and tap — stock deducts after Admin approval.',
        onPick: (row) => {
          this._wasteSelected = row;
          const hid = document.getElementById('stk-waste-prod');
          const lbl = document.getElementById('stk-waste-pick-lbl');
          if (hid) hid.value = row.id;
          if (lbl) lbl.textContent = `${row.name} (${row.stock_quantity ?? 0} ${row.unit || ''})`;
        }
      });
    });

    document.getElementById('stk-waste-photo')?.addEventListener('click', async () => {
      const r = await API.selectImage('waste');
      if (!r.success) {
        if (!r.cancelled) Utils.toast(r.error || 'Could not add photo', 'error');
        return;
      }
      this._wastePhotos = [r.path || r.dataUrl || r.data].filter(Boolean);
      const lbl = document.getElementById('stk-waste-photo-lbl');
      if (lbl) lbl.textContent = this._wastePhotos.length ? '1 photo' : 'None';
    });

    document.getElementById('stk-waste-save')?.addEventListener('click', async () => {
      const kind = document.getElementById('stk-waste-kind')?.value || 'ingredient';
      const productId = parseInt(document.getElementById('stk-waste-prod')?.value, 10);
      const propertyName = document.getElementById('stk-waste-prop')?.value.trim();
      const qty = parseFloat(document.getElementById('stk-waste-qty')?.value) || 0;
      const reason = document.getElementById('stk-waste-reason')?.value.trim() || 'Waste';
      if (!this._wastePhotos?.length) return Utils.toast('Add a photo first', 'error');
      const payload = {
        damage_kind: kind,
        reason,
        quantity: qty,
        photo_path_1: this._wastePhotos[0],
        photo_image: this._wastePhotos[0]
      };
      if (kind === 'property') {
        if (!propertyName) return Utils.toast('Describe the damaged property', 'error');
        payload.property_name = propertyName;
        payload.quantity = qty > 0 ? qty : 1;
      } else {
        if (!productId || !(qty > 0)) return Utils.toast('Select product and quantity', 'error');
        payload.product_id = productId;
      }
      const r = await API.recordWaste(payload, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Failed', 'error');
      this._wastePhotos = [];
      this._wasteSelected = null;
      Utils.toast('Submitted for admin approval', 'success');
      this.renderWaste(el);
    });
  },

  async renderStock(el) {
    const peek = window.DataCache?.peek?.('stockReport', []);
    const currency = this.app.settings?.currency || 'R';
    const paint = (items) => {
      this._stockItems = items;
      el.innerHTML = `<div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Product</th><th>Category</th><th>Qty</th><th>Min</th><th>Status</th><th>Value</th></tr></thead>
      <tbody>${items.map(p => `<tr>
        <td>${p.name}</td><td>${p.category_name || '—'}</td>
        <td>${p.stock_quantity} ${p.unit}</td><td>${p.min_stock}</td>
        <td>${Utils.stockTag(p.stock_quantity, p.min_stock)}</td>
        <td>${Utils.formatMoney(p.stock_quantity * p.buying_price, currency)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No products</td></tr>'}
      </tbody></table></div></div>`;
      document.getElementById('adjust-stock')?.addEventListener('click', () => this.showAdjustModal(items));
    };
    if (peek?.data) paint(peek.data || []);
    else el.innerHTML = Utils.pageSkeleton(4);
    try {
      const stockRes = await API.getStockReport();
      paint(stockRes.data || []);
      window.DataCache?.clearStaleBanner?.(this._host || el.parentElement);
    } catch (err) {
      if (!this._stockItems?.length) throw err;
      window.DataCache?.showStaleBanner?.(this._host || el.parentElement, 'Unable to refresh. Showing last updated data.');
    }
  },

  async renderMovements(el) {
    this._movFrom = this._movFrom || Utils.monthStart();
    this._movTo = this._movTo || Utils.today();
    const load = async () => {
      el.innerHTML = Utils.pageSkeleton ? Utils.pageSkeleton(3) : '<p class="muted">Loading…</p>';
      try {
        const histRes = await API.getStockHistory({ from: this._movFrom, to: this._movTo, limit: 1000 });
        const history = histRes.data || [];
        el.innerHTML = `${Utils.dateFilterHTML('stk-mov-filter', this._movFrom, this._movTo)}
          <p class="muted" style="margin:8px 0;font-size:13px">${history.length} movement(s)</p>
          <div class="card"><div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Qty</th><th>Before</th><th>After</th><th>By</th></tr></thead>
          <tbody>${history.map(h => `<tr>
            <td>${Utils.formatDateTime(h.created_at)}</td><td>${Utils.escHtml(h.product_name || '')}</td>
            <td>${Utils.escHtml(h.movement_type || '')}</td><td>${h.quantity}</td>
            <td>${h.previous_stock}</td><td>${h.new_stock}</td><td>${Utils.escHtml(h.user_name || '—')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No movements in this date range</td></tr>'}
          </tbody></table></div></div>`;
        Utils.bindDateFilter('stk-mov-filter', (f, t) => {
          this._movFrom = f;
          this._movTo = t;
          load();
        });
      } catch (err) {
        el.innerHTML = `<p class="error-msg">${Utils.escHtml(err.message || 'Could not load movements')}</p>
          <button type="button" class="btn btn-primary" id="stk-mov-retry">Retry</button>`;
        document.getElementById('stk-mov-retry')?.addEventListener('click', () => load());
      }
    };
    await load();
  },

  statusTag(status) {
    const map = {
      active: 'tag-ok', used: 'tag-warn', redeemed: 'tag-warn', expired: 'tag-warn', cancelled: 'tag-low'
    };
    const label = { active: 'Active', used: 'Used', redeemed: 'Used', expired: 'Expired', cancelled: 'Cancelled' }[status] || status;
    return `<span class="tag ${map[status] || ''}">${label}</span>`;
  },

  async renderNonSelling(el) {
    el.innerHTML = Utils.pageSkeleton ? Utils.pageSkeleton(3) : '<p class="muted">Loading…</p>';
    this._prodDays = this._prodDays || 30;
    const days = this._prodDays;
    const isOwner = this.app.user?.role === 'owner';
    const canPropose = ['manager', 'assistant_manager'].includes(this.app.user?.role);
    const filters = { days };
    let products = [], categories = [], branches = [], suppliers = [], customers = [];
    try {
      const [res, catRes, brRes, supRes, custRes] = await Promise.all([
        API.getNonSellingProducts(filters),
        API.getCategories().catch(() => ({ data: [] })),
        API.getBranches().catch(() => ({ data: [] })),
        API.getSuppliers('').catch(() => ({ data: [] })),
        API.getCustomers({}).catch(() => ({ data: [] }))
      ]);
      if (res.success === false) throw new Error(res.error || 'Could not load non-selling products');
      products = res.data || [];
      categories = catRes.data || [];
      branches = brRes.data || [];
      suppliers = supRes.data || [];
      customers = custRes.data || [];
    } catch (err) {
      el.innerHTML = `<p class="error-msg">${Utils.escHtml(err.message || 'Could not load')}</p>
        <button type="button" class="btn btn-primary" id="ns-retry">Retry</button>`;
      document.getElementById('ns-retry')?.addEventListener('click', () => this.renderNonSelling(el));
      return;
    }
    const currency = this.app.settings?.currency || 'R';

    el.innerHTML = `<p class="muted">Selling products with no sales in the selected period (ingredients are excluded). Owners can create a discount <strong>voucher code</strong> for POS / Order Online / Kiosk, or discontinue the item from online clearance &amp; gifts.</p>
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
        <label>Period</label>
        <select id="ns-days">${[7, 14, 30, 60, 90].map(d => `<option value="${d}" ${days === d ? 'selected' : ''}>${d} days</option>`).join('')}</select>
        ${isOwner ? `<button class="btn btn-sm btn-ghost" id="ns-pdf">Export PDF</button>
          <button class="btn btn-sm btn-ghost" id="ns-excel">Export Excel</button>
          <button class="btn btn-sm btn-ghost" id="ns-vouchers">View vouchers</button>` : ''}
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Price</th><th>Days No Sale</th><th>Promo</th><th></th></tr></thead>
        <tbody>${products.map(p => `<tr>
          <td>${Utils.escHtml(p.name)}</td><td>${Utils.escHtml(p.category_name || '—')}</td><td>${p.stock_quantity ?? 0}</td>
          <td>${Utils.formatMoney(p.selling_price, currency)}</td>
          <td>${p.days_without_sale != null ? p.days_without_sale : '—'}</td>
          <td>${p.promo_request_status ? `<span class="tag">${p.promo_request_status}</span>` : '—'}</td>
          <td style="white-space:nowrap">
            ${canPropose && (!p.promo_request_status || ['rejected', 'expired'].includes(p.promo_request_status))
              ? `<button class="btn btn-sm btn-primary ns-propose" data-id="${p.id}">Propose Promo</button>` : ''}
            ${isOwner ? `<button class="btn btn-sm btn-ghost ns-disc" data-id="${p.id}">Discount</button>
              <button class="btn btn-sm btn-danger ns-discont" data-id="${p.id}">Discontinue</button>` : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="7" class="muted">All selling products sold in selected period</td></tr>'}
        </tbody></table></div>`;

    const reload = () => this.renderNonSelling(el);
    document.getElementById('ns-days')?.addEventListener('change', (e) => {
      this._prodDays = parseInt(e.target.value, 10);
      reload();
    });
    document.getElementById('ns-pdf')?.addEventListener('click', async () => {
      await Utils.savePdfBuffer(`non-selling-${Utils.today()}.pdf`, await API.getNonSellingProductsPdf(filters));
    });
    document.getElementById('ns-excel')?.addEventListener('click', async () => {
      const r = await API.getNonSellingProductsExcel(filters);
      if (r.success) await API.saveFile(`non-selling-${Utils.today()}.xlsx`, [{ name: 'Excel', extensions: ['xlsx'] }], r.data);
    });
    document.getElementById('ns-vouchers')?.addEventListener('click', () => this.showVouchersList());
    el.querySelectorAll('.ns-propose').forEach(b => b.addEventListener('click', () => {
      const prod = products.find(p => p.id === parseInt(b.dataset.id, 10));
      if (prod) this.showProposePromoModal(prod, currency, reload);
    }));
    el.querySelectorAll('.ns-disc').forEach(b => b.addEventListener('click', () => {
      const prod = products.find(p => p.id === parseInt(b.dataset.id, 10));
      if (prod) this.showDiscountVoucherModal(prod, currency, customers, reload);
    }));
    el.querySelectorAll('.ns-discont').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Discontinue this product? It will be hidden from POS, Order Online clearance/specials, and gifts.')) return;
      const prod = products.find(p => p.id === parseInt(b.dataset.id, 10));
      if (!prod) return;
      const r = await API.saveProduct({
        id: prod.id,
        name: prod.name,
        is_active: 0,
        online_enabled: 0,
        show_on_pos: 0
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not discontinue', 'error');
      Utils.toast('Product discontinued — hidden from POS and online clearance/gifts', 'success');
      reload();
    }));
  },

  async showVouchersList() {
    const res = await API.listDiscountVouchers({ limit: 100 }).catch(() => ({ data: [] }));
    const rows = res.data || [];
    Utils.showModal('Discount vouchers', `
      <p class="muted">Codes created from Non-Selling → Discount. Work on POS, Order Online, and Kiosk.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Code</th><th>Discount</th><th>Product</th><th>Customer</th><th>Uses</th><th>Status</th></tr></thead>
        <tbody>${rows.map(v => `<tr>
          <td><code>${Utils.escHtml(v.code)}</code></td>
          <td>${v.discount_type === 'percent' ? `${v.discount_value}%` : Utils.formatMoney(v.discount_value, this.app.settings?.currency || 'R')}</td>
          <td>${Utils.escHtml(v.product_name || 'Any')}</td>
          <td>${Utils.escHtml(v.linked_customer_name || v.customer_name || 'Anyone')}</td>
          <td>${v.uses_count || 0}/${v.max_uses || 1}</td>
          <td>${Utils.escHtml(v.status || '')}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No vouchers yet</td></tr>'}
      </tbody></table></div>`,
      '<button class="btn btn-ghost" id="ns-v-close">Close</button>', { wide: true });
    document.getElementById('ns-v-close')?.addEventListener('click', () => Utils.hideModal());
  },

  async showDiscountVoucherModal(product, currency, customers, onSaved) {
    const custOpts = (customers || []).slice(0, 300).map(c =>
      `<option value="${c.id}">${Utils.escHtml(c.name)}${c.phone ? ` — ${Utils.escHtml(c.phone)}` : ''}</option>`).join('');
    const defaultCode = `SAVE${Math.round(Number(product.selling_price) || 10)}${String(product.id).slice(-3)}`.toUpperCase();
    Utils.showModal(`Discount voucher — ${product.name}`, `
      <p class="muted">Create a voucher code for this product. Customer can redeem it on <strong>POS</strong>, <strong>Order Online</strong>, and <strong>Kiosk</strong>. Code is saved in Admin audit / voucher list.</p>
      <div class="field"><label>Your voucher code *</label>
        <input id="ns-v-code" value="${Utils.escHtml(defaultCode)}" placeholder="e.g. CHICKEN20" style="text-transform:uppercase">
        <small class="muted">Write your own code — letters, numbers, . _ -</small></div>
      <div class="form-grid">
        <div class="field"><label>Discount type</label>
          <select id="ns-v-type"><option value="percent">Percent %</option><option value="amount">Fixed amount (${currency})</option></select></div>
        <div class="field"><label>Value *</label><input type="number" id="ns-v-val" min="0.01" step="0.01" value="10"></div>
        <div class="field"><label>Max uses</label><input type="number" id="ns-v-uses" min="1" step="1" value="1"></div>
        <div class="field"><label>Expires</label><input type="date" id="ns-v-exp"></div>
      </div>
      <div class="field"><label>Customer (optional)</label>
        <select id="ns-v-cust"><option value="">Anyone can use</option>${custOpts}</select>
        <small class="muted">Leave blank for a general voucher, or lock it to one customer.</small></div>
      <div class="field"><label>Notes</label><input id="ns-v-notes" placeholder="Non-selling discount for ${Utils.escHtml(product.name)}"></div>
      <p class="muted" style="font-size:12px">Also applies a temporary sale price on this product so it appears on clearance until the voucher expires (optional).</p>
      <label style="display:block;margin-top:8px"><input type="checkbox" id="ns-v-sale" checked> Also mark product on sale at discounted price</label>`,
      '<button class="btn btn-primary" id="ns-v-save">Create voucher</button>');
    document.getElementById('ns-v-save')?.addEventListener('click', async () => {
      const code = document.getElementById('ns-v-code')?.value.trim().toUpperCase();
      const discount_type = document.getElementById('ns-v-type')?.value || 'percent';
      const discount_value = parseFloat(document.getElementById('ns-v-val')?.value) || 0;
      const max_uses = parseInt(document.getElementById('ns-v-uses')?.value, 10) || 1;
      const expires_at = document.getElementById('ns-v-exp')?.value || null;
      const customer_id = document.getElementById('ns-v-cust')?.value || null;
      const notes = document.getElementById('ns-v-notes')?.value.trim() || `Discount voucher for ${product.name}`;
      const alsoSale = document.getElementById('ns-v-sale')?.checked;
      if (!code) return Utils.toast('Enter a voucher code', 'error');
      if (!(discount_value > 0)) return Utils.toast('Enter a discount value', 'error');
      const cust = (customers || []).find(c => String(c.id) === String(customer_id));
      const r = await API.createDiscountVoucher({
        code,
        discount_type,
        discount_value,
        product_id: product.id,
        customer_id: customer_id ? parseInt(customer_id, 10) : null,
        customer_name: cust?.name || null,
        max_uses,
        expires_at,
        notes
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not create voucher', 'error');
      if (alsoSale) {
        let newPrice = Number(product.selling_price) || 0;
        if (discount_type === 'percent') newPrice = Math.round(newPrice * (1 - discount_value / 100) * 100) / 100;
        else newPrice = Math.max(0, Math.round((newPrice - discount_value) * 100) / 100);
        if (newPrice > 0) {
          await API.saveProduct({
            id: product.id,
            name: product.name,
            selling_price: newPrice,
            stock_quantity: product.stock_quantity
          }, this.app.user).catch(() => {});
        }
      }
      Utils.hideModal();
      Utils.toast(`Voucher ${code} created — works on POS, Order Online & Kiosk`, 'success');
      if (onSaved) onSaved();
    });
  },

  showProposePromoModal(product, currency, onSaved) {
    const today = Utils.today();
    const defaultEnd = new Date(Date.now() + 14 * 86400000).toLocaleDateString('en-CA');
    Utils.showModal(`Propose Promo — ${product.name}`, `
      <p class="muted">Submit a temporary sale price for admin approval.</p>
      <div class="field"><label>Current price</label><input type="text" value="${Utils.formatMoney(product.selling_price, currency)}" disabled></div>
      <div class="field"><label>Proposed sale price *</label><input type="number" id="promo-price" step="0.01" min="0.01"></div>
      <div class="field"><label>Start date *</label><input type="date" id="promo-start" value="${today}"></div>
      <div class="field"><label>End date *</label><input type="date" id="promo-end" value="${defaultEnd}"></div>
      <div class="field"><label>Notes</label><textarea id="promo-notes" rows="2"></textarea></div>`,
      '<button class="btn btn-primary" id="promo-save">Submit for Approval</button>');
    document.getElementById('promo-save')?.addEventListener('click', async () => {
      const proposed_price = parseFloat(document.getElementById('promo-price').value);
      const start_date = document.getElementById('promo-start').value;
      const end_date = document.getElementById('promo-end').value;
      const notes = document.getElementById('promo-notes').value.trim();
      if (!proposed_price || proposed_price <= 0) return Utils.toast('Enter a valid sale price', 'error');
      if (!start_date || !end_date) return Utils.toast('Start and end dates are required', 'error');
      const r = await API.proposeProductPromo(product.id, { proposed_price, start_date, end_date, notes }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      Utils.toast('Promo submitted for admin approval', 'success');
      onSaved?.();
    });
  },

  showAdjustModal(products) {
    const opts = products.map(p => `<option value="${p.id}">${p.name} (${p.stock_quantity})</option>`).join('');
    Utils.showModal('Adjust Stock', `
      <div class="field"><label>Product</label><select id="sa-product">${opts}</select></div>
      <div class="field"><label>Type</label><select id="sa-type"><option value="add">Add Stock</option><option value="remove">Remove Stock</option><option value="adjust">Set Quantity</option></select></div>
      <div class="field"><label>Quantity</label><input type="number" id="sa-qty" min="0" step="0.01" value="1"></div>
      <p class="muted" id="sa-min-stock">Min stock: ${products[0] ? Number(products[0].min_stock || 0).toFixed(2) : '—'}</p>
      <div class="field"><label>Notes</label><input id="sa-notes" placeholder="Reason for adjustment"></div>`,
      '<button class="btn btn-primary" id="sa-save">Save</button>');
    const minEl = document.getElementById('sa-min-stock');
    const prodSel = document.getElementById('sa-product');
    const updateMin = () => {
      const p = products.find(x => String(x.id) === String(prodSel.value));
      if (minEl) minEl.textContent = `Min stock: ${Number(p?.min_stock || 0).toFixed(2)}`;
    };
    prodSel?.addEventListener('change', updateMin);
    document.getElementById('sa-save').addEventListener('click', async () => {
      const productId = parseInt(document.getElementById('sa-product').value);
      const type = document.getElementById('sa-type').value;
      const qty = Math.round((parseFloat(document.getElementById('sa-qty').value) || 0) * 100) / 100;
      const notes = document.getElementById('sa-notes').value;
      const r = type === 'adjust'
        ? await API.adjustStock(productId, qty, 'set', notes, this.app.user)
        : await API.adjustStock(productId, qty, type, notes, this.app.user);
      if (!r || r.success === false) return Utils.toast(r?.error || 'Stock update failed', 'error');
      const newStock = r.data?.new_stock;
      Utils.hideModal();
      this._stockItems = [];
      window.DataCache?.invalidate?.('products', 'stockReport', 'stockHistory', 'dashboard', 'pos');
      StockPage.render(this._host || document.querySelector('.page-host[data-page="stock"]') || document.querySelector('.page-host-active'), this.app);
      Utils.toast(newStock != null ? `Stock saved — now ${newStock} on hand` : 'Stock saved', 'success');
    });
  }
};
window.StockPage = StockPage;

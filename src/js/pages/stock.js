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
      <div id="stock-tab-content"></div>`;

    el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
      this.tab = b.dataset.tab;
      this.render(el, app);
    }));

    const content = document.getElementById('stock-tab-content');
    if (this.tab === 'movements') return this.renderMovements(content);
    if (this.tab === 'waste') return this.renderWaste(content);
    if (this.tab === 'nonselling') return this.renderNonSelling(content);
    return this.renderStock(content);
  },

  async activate(el, app) {
    return this.render(el, app);
  },

  async renderWaste(el) {
    const items = this._stockItems || (await API.getStockReport()).data || [];
    this._stockItems = items;
    el.innerHTML = `<div class="card"><div class="card-body">
      <h4>Record waste / damaged stock</h4>
      <p class="muted">Deducts from Inventory immediately (same stock Recipe Waste uses after approval — this is the quick Stock path).</p>
      <div class="form-grid">
        <div class="field"><label>Product / Ingredient</label>
          <select id="stk-waste-prod"><option value="">Select…</option>
            ${items.map(p => `<option value="${p.id}">${p.name} (${p.stock_quantity} ${p.unit || ''})</option>`).join('')}
          </select></div>
        <div class="field"><label>Quantity</label><input type="number" id="stk-waste-qty" step="0.001" min="0"></div>
        <div class="field full"><label>Reason</label><input id="stk-waste-reason" placeholder="Spoiled, dropped, expired…"></div>
      </div>
      <button type="button" class="btn btn-danger" id="stk-waste-save" style="margin-top:12px">Record waste</button>
    </div></div>`;
    document.getElementById('stk-waste-save')?.addEventListener('click', async () => {
      const productId = parseInt(document.getElementById('stk-waste-prod')?.value, 10);
      const qty = parseFloat(document.getElementById('stk-waste-qty')?.value) || 0;
      const reason = document.getElementById('stk-waste-reason')?.value.trim() || 'Waste';
      if (!productId || !(qty > 0)) return Utils.toast('Select product and quantity', 'error');
      const r = await API.adjustStock(productId, qty, 'remove', `Waste: ${reason}`, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Failed', 'error');
      // Also log in recipe waste for kitchen visibility (pending approval path optional)
      try {
        await API.recipeWasteRecord({
          waste_type: 'ingredient',
          product_id: productId,
          quantity: qty,
          reason
        }, this.app.user);
      } catch (_) { /* recipe access optional */ }
      Utils.toast('Waste recorded — stock updated', 'success');
      this._stockItems = [];
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
    const histRes = await API.getStockHistory();
    const history = histRes.data || [];
    el.innerHTML = `<div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Qty</th><th>Before</th><th>After</th><th>By</th></tr></thead>
      <tbody>${history.map(h => `<tr>
        <td>${Utils.formatDateTime(h.created_at)}</td><td>${h.product_name}</td>
        <td>${h.movement_type}</td><td>${h.quantity}</td>
        <td>${h.previous_stock}</td><td>${h.new_stock}</td><td>${h.user_name || '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No movements</td></tr>'}
      </tbody></table></div></div>`;
  },

  statusTag(status) {
    const map = {
      active: 'tag-ok', used: 'tag-warn', redeemed: 'tag-warn', expired: 'tag-warn', cancelled: 'tag-low'
    };
    const label = { active: 'Active', used: 'Used', redeemed: 'Used', expired: 'Expired', cancelled: 'Cancelled' }[status] || status;
    return `<span class="tag ${map[status] || ''}">${label}</span>`;
  },

  async renderNonSelling(el) {
    this._prodDays = this._prodDays || 30;
    const days = this._prodDays;
    const isOwner = this.app.user?.role === 'owner';
    const canPropose = ['manager', 'assistant_manager'].includes(this.app.user?.role);
    const filters = { days };
    const [res, catRes, brRes, supRes] = await Promise.all([
      API.getNonSellingProducts(filters),
      API.getCategories(),
      API.getBranches(),
      API.getSuppliers('')
    ]);
    const products = res.data || [];
    const categories = catRes.data || [];
    const branches = brRes.data || [];
    const suppliers = supRes.data || [];
    const currency = this.app.settings?.currency || 'R';

    el.innerHTML = `<p class="muted">Products with no sales in the selected period. Managers can propose promos; owners can apply discounts or discontinue items.</p>
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
        <label>Period</label>
        <select id="ns-days">${[7, 14, 30, 60, 90].map(d => `<option value="${d}" ${days === d ? 'selected' : ''}>${d} days</option>`).join('')}</select>
        ${isOwner ? `<button class="btn btn-sm btn-ghost" id="ns-pdf">Export PDF</button>
          <button class="btn btn-sm btn-ghost" id="ns-excel">Export Excel</button>` : ''}
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Price</th><th>Days No Sale</th><th>Promo</th><th></th></tr></thead>
        <tbody>${products.map(p => `<tr>
          <td>${p.name}</td><td>${p.category_name || '—'}</td><td>${p.stock_quantity ?? 0}</td>
          <td>${Utils.formatMoney(p.selling_price, currency)}</td>
          <td>${p.days_without_sale != null ? p.days_without_sale : '—'}</td>
          <td>${p.promo_request_status ? `<span class="tag">${p.promo_request_status}</span>` : '—'}</td>
          <td style="white-space:nowrap">
            ${canPropose && (!p.promo_request_status || ['rejected', 'expired'].includes(p.promo_request_status))
              ? `<button class="btn btn-sm btn-primary ns-propose" data-id="${p.id}">Propose Promo</button>` : ''}
            ${isOwner ? `<button class="btn btn-sm btn-ghost ns-disc" data-id="${p.id}">Discount</button>
              <button class="btn btn-sm btn-danger ns-discont" data-id="${p.id}">Discontinue</button>` : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="7" class="muted">All products sold in selected period</td></tr>'}
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
    el.querySelectorAll('.ns-propose').forEach(b => b.addEventListener('click', () => {
      const prod = products.find(p => p.id === parseInt(b.dataset.id, 10));
      if (prod) this.showProposePromoModal(prod, currency, reload);
    }));
    el.querySelectorAll('.ns-disc').forEach(b => b.addEventListener('click', async () => {
      const pct = prompt('Discount % to apply to selling price:', '10');
      if (pct == null) return;
      const prod = products.find(p => p.id === parseInt(b.dataset.id, 10));
      if (!prod) return;
      const newPrice = Math.round(prod.selling_price * (1 - parseFloat(pct) / 100) * 100) / 100;
      await API.saveProduct({
        id: prod.id,
        name: prod.name,
        selling_price: newPrice,
        stock_quantity: prod.stock_quantity
      }, this.app.user);
      Utils.toast(`Price updated to ${Utils.formatMoney(newPrice, currency)}`, 'success');
      reload();
    }));
    el.querySelectorAll('.ns-discont').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Discontinue this product? It will be hidden from POS.')) return;
      const prod = products.find(p => p.id === parseInt(b.dataset.id, 10));
      if (!prod) return;
      await API.saveProduct({ id: prod.id, name: prod.name, is_active: 0 }, this.app.user);
      Utils.toast('Product discontinued', 'success');
      reload();
    }));
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
      if (r?.success === false) return Utils.toast(r.error || 'Stock update failed', 'error');
      const min = r?.data?.min_stock;
      Utils.hideModal();
      StockPage.render(document.getElementById('page-content'), this.app);
      Utils.toast(min != null ? `Stock updated · min stock ${Number(min).toFixed(2)}` : 'Stock updated', 'success');
    });
  }
};
window.StockPage = StockPage;

const ProductsPage = {
  _cache: null,

  async render(el, app) {
    this.app = app;
    this._host = el;
    const currency = app.settings?.currency || 'R';

    const paint = () => {
      el.innerHTML = `
      <div class="page-toolbar">
        <input type="search" id="prod-search" placeholder="Search products…" style="padding:8px 14px;border:1.5px solid var(--border);border-radius:8px;width:260px">
        <button class="btn btn-primary" id="add-product">+ Add Product</button>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th></th><th>Name</th><th>Category</th><th>Price</th><th>Cost</th><th>Stock</th><th>Options</th><th>Status</th><th></th></tr></thead>
        <tbody id="prod-table">${this.renderRows(currency)}</tbody>
      </table></div></div>`;
      document.getElementById('add-product').addEventListener('click', () => this.showForm());
      document.getElementById('prod-search').addEventListener('input', (e) => {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => {
          const q = e.target.value.toLowerCase();
          const filtered = this.products.filter(p => p.name.toLowerCase().includes(q) || p.barcode?.includes(q));
          const table = document.getElementById('prod-table');
          table.innerHTML = this.renderRows(currency, filtered);
          this.bindTableEvents();
          Utils.hydrateImages(table);
        }, 180);
      });
      this.bindTableEvents();
      Utils.hydrateImages(el);
    };

    // Cache-first paint only when we have a non-empty product list (empty [] must not block refresh / hide errors)
    const mem = window.DataCache?.peek?.('products', [{}]);
    const fromMem = mem?.success !== false && Array.isArray(mem?.data) && mem.data.length
      ? { products: mem.data, categories: window.DataCache?.peek?.('categories', [{}])?.data || [], suppliers: window.DataCache?.peek?.('suppliers', [''])?.data || [] }
      : null;
    const fromSession = Utils.sessionCacheGet('products_page');
    const cached = fromMem || (Array.isArray(fromSession?.products) && fromSession.products.length ? fromSession : null);
    if (cached?.products?.length) {
      this.products = cached.products;
      this.categories = cached.categories || this.categories || [];
      this.suppliers = cached.suppliers || this.suppliers || [];
      paint();
    } else {
      el.innerHTML = `<div class="page-toolbar"><input type="search" id="prod-search" placeholder="Search products…" style="padding:8px 14px;border:1.5px solid var(--border);border-radius:8px;width:260px">
        <button class="btn btn-primary" id="add-product">+ Add Product</button></div>
      <div class="card"><div class="table-wrap">${Utils.pageSkeleton(5)}</div></div>`;
    }

    try {
      const [prodRes, catRes, supRes] = await Promise.all([
        API.getProducts({}),
        API.getCategories({}),
        API.getSuppliers()
      ]);
      if (prodRes && prodRes.success === false) {
        const msg = prodRes.error || 'Failed to load products';
        if (!this.products?.length) {
          el.innerHTML = `<div class="page-toolbar"><h3>Products</h3></div><p class="error-msg">${Utils.escHtml(msg)}</p>`;
          return;
        }
        window.DataCache?.showStaleBanner?.(el, `Unable to refresh. Showing last updated data. (${msg})`);
        return;
      }
      this.products = Array.isArray(prodRes?.data) ? prodRes.data : [];
      this.categories = Array.isArray(catRes?.data) ? catRes.data : (this.categories || []);
      this.suppliers = Array.isArray(supRes?.data) ? supRes.data : (this.suppliers || []);
      Utils.sessionCacheSet('products_page', {
        products: this.products,
        categories: this.categories,
        suppliers: this.suppliers
      });
      paint();
      window.DataCache?.clearStaleBanner?.(el);
    } catch (err) {
      if (!this.products?.length) {
        el.innerHTML = `<div class="page-toolbar"><h3>Products</h3></div><p class="error-msg">${Utils.escHtml(err?.message || 'Failed to load products')}</p>`;
        return;
      }
      window.DataCache?.showStaleBanner?.(el, 'Unable to refresh. Showing last updated data.');
    }
  },

  async activate(el, app) {
    return this.render(el, app);
  },

  renderRows(currency, items) {
    const list = items || this.products;
    return list.map(p => {
      const unit = p.stock_unit || p.unit || 'each';
      const optCount = (p.options?.length || 0) + (p.extras?.length || 0) + (p.removals?.length || 0);
      const optTag = optCount ? `<span class="tag tag-ok">${optCount} option${optCount !== 1 ? 's' : ''}</span>` : '—';
      return `<tr>
      <td>${p.picture_path ? `<img data-image-path="${p.picture_path}" class="prod-thumb">` : ''}</td>
      <td><strong>${p.name}</strong>${p.sku ? `<br><small class="muted">${p.sku}</small>` : ''}</td>
      <td>${p.category_name || '—'}</td>
      <td>${Utils.formatMoney(p.selling_price, currency)}</td>
      <td>${Utils.formatMoney(p.buying_price, currency)}</td>
      <td>${p.stock_quantity} ${unit}</td>
      <td>${optTag}</td>
      <td>${Utils.stockTag(p.stock_quantity, p.min_stock)}</td>
      <td class="actions">
        <button class="btn btn-sm btn-ghost label-prod" data-id="${p.id}" title="Print barcode label">🏷️</button>
        <button class="btn btn-sm btn-ghost edit-prod" data-id="${p.id}">Edit</button>
        <button class="btn btn-sm btn-ghost dup-prod" data-id="${p.id}">Duplicate</button>
        <button class="btn btn-sm btn-danger del-prod" data-id="${p.id}">Delete</button>
      </td></tr>`;
    }).join('') || '<tr><td colspan="9" class="muted">No products yet</td></tr>';
  },

  bindTableEvents() {
    document.querySelectorAll('.label-prod').forEach(b => b.addEventListener('click', async () => {
      const p = this.products.find(x => x.id == b.dataset.id);
      if (!p?.barcode && !p?.sku) return Utils.toast('Add a barcode or SKU first', 'error');
      const r = await API.printBarcodeLabel(p);
      Utils.toast(r.success ? 'Label sent to printer' : (r.error || 'Print failed'), r.success ? 'success' : 'error');
    }));
    document.querySelectorAll('.edit-prod').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getProduct(parseInt(b.dataset.id));
      if (!r.success) return Utils.toast(r.error || 'Could not load product', 'error');
      this.showForm(r.data);
    }));
    document.querySelectorAll('.dup-prod').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getProduct(parseInt(b.dataset.id));
      const p = r.success ? r.data : this.products.find(x => x.id == b.dataset.id);
      if (p) this.showForm({ ...p, id: null, name: p.name + ' (Copy)', barcode: null });
    }));
    document.querySelectorAll('.del-prod').forEach(b => b.addEventListener('click', async () => {
      if (confirm('Delete this product?')) {
        const r = await API.deleteProduct(parseInt(b.dataset.id), this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.sessionCacheClear('products_page');
        ProductsPage.render(document.getElementById('page-content'), this.app);
        Utils.toast('Product deleted', 'success');
      }
    }));
  },

  loadOptionGroups(product) {
    let meta = [];
    try { meta = JSON.parse(product?.option_groups_meta || '[]'); } catch { meta = []; }
    const options = (product?.modifiers || []).filter(m => m.modifier_type === 'option');
    const groups = {};
    for (const o of options) {
      const g = o.option_group || 'Choose one';
      if (!groups[g]) groups[g] = [];
      groups[g].push({ name: o.name, extra_price: o.extra_price || 0 });
    }
    const groupList = Object.entries(groups).map(([name, choices]) => {
      const m = meta.find(x => x.name === name) || {};
      return {
        name,
        choices: choices.length ? choices : [{ name: '', extra_price: 0 }],
        min_select: m.min_select ?? (m.is_required ? 1 : 0),
        max_select: m.max_select ?? 1,
        is_required: !!m.is_required
      };
    });
    this.editingRemovals = (product?.modifiers || []).filter(m => m.modifier_type === 'removal')
      .map(m => ({ name: m.name, reduce_amount: Math.abs(Number(m.extra_price) || 0) }));
    if (!this.editingRemovals?.length) this.editingRemovals = [{ name: '', reduce_amount: 0 }];
    this.editingExtras = (product?.modifiers || []).filter(m => m.modifier_type === 'extra')
      .map(m => ({ name: m.name, extra_price: m.extra_price || 0 }));
    return groupList.length ? groupList : [{ name: 'Choose one', choices: [{ name: '', extra_price: 0 }], min_select: 1, max_select: 1, is_required: false }];
  },

  syncModifiersFromDom() {
    document.querySelectorAll('.og-name').forEach(inp => {
      const gi = parseInt(inp.dataset.gi, 10);
      if (this.editingOptionGroups?.[gi]) this.editingOptionGroups[gi].name = inp.value;
    });
    document.querySelectorAll('.og-choice-name').forEach(inp => {
      const gi = parseInt(inp.dataset.gi, 10);
      const ci = parseInt(inp.dataset.ci, 10);
      if (this.editingOptionGroups?.[gi]?.choices?.[ci]) this.editingOptionGroups[gi].choices[ci].name = inp.value;
    });
    document.querySelectorAll('.og-choice-price').forEach(inp => {
      const gi = parseInt(inp.dataset.gi, 10);
      const ci = parseInt(inp.dataset.ci, 10);
      if (this.editingOptionGroups?.[gi]?.choices?.[ci]) this.editingOptionGroups[gi].choices[ci].extra_price = parseFloat(inp.value) || 0;
    });
    document.querySelectorAll('.og-min').forEach(inp => {
      const gi = parseInt(inp.dataset.gi, 10);
      if (this.editingOptionGroups?.[gi]) this.editingOptionGroups[gi].min_select = parseInt(inp.value, 10) || 0;
    });
    document.querySelectorAll('.og-max').forEach(inp => {
      const gi = parseInt(inp.dataset.gi, 10);
      if (this.editingOptionGroups?.[gi]) this.editingOptionGroups[gi].max_select = parseInt(inp.value, 10) || 1;
    });
    document.querySelectorAll('.og-req').forEach(inp => {
      const gi = parseInt(inp.dataset.gi, 10);
      if (this.editingOptionGroups?.[gi]) this.editingOptionGroups[gi].is_required = inp.checked;
    });
    document.querySelectorAll('.rm-name').forEach(inp => {
      const i = parseInt(inp.dataset.i, 10);
      if (this.editingRemovals?.[i]) this.editingRemovals[i].name = inp.value;
    });
    document.querySelectorAll('.rm-amt').forEach(inp => {
      const i = parseInt(inp.dataset.i, 10);
      if (this.editingRemovals?.[i]) this.editingRemovals[i].reduce_amount = parseFloat(inp.value) || 0;
    });
    document.querySelectorAll('.ex-name').forEach(inp => {
      const i = parseInt(inp.dataset.i, 10);
      if (this.editingExtras?.[i]) this.editingExtras[i].name = inp.value;
    });
    document.querySelectorAll('.ex-price').forEach(inp => {
      const i = parseInt(inp.dataset.i, 10);
      if (this.editingExtras?.[i]) this.editingExtras[i].extra_price = parseFloat(inp.value) || 0;
    });
  },

  flattenModifiers() {
    const mods = [];
    const meta = [];
    for (const g of this.editingOptionGroups || []) {
      const groupName = g.name?.trim() || 'Choose one';
      meta.push({
        name: groupName,
        min_select: parseInt(g.min_select, 10) || 0,
        max_select: Math.max(1, parseInt(g.max_select, 10) || 1),
        is_required: !!g.is_required
      });
      for (const c of g.choices || []) {
        if (!c.name?.trim()) continue;
        mods.push({ name: c.name.trim(), extra_price: parseFloat(c.extra_price) || 0, modifier_type: 'option', option_group: groupName });
      }
    }
    for (const r of this.editingRemovals || []) {
      if (!r.name?.trim()) continue;
      mods.push({ name: r.name.trim(), extra_price: -(Math.abs(parseFloat(r.reduce_amount) || 0)), modifier_type: 'removal' });
    }
    for (const e of this.editingExtras || []) {
      if (!e.name?.trim()) continue;
      mods.push({ name: e.name.trim(), extra_price: parseFloat(e.extra_price) || 0, modifier_type: 'extra' });
    }
    this._optionGroupsMeta = meta;
    return mods;
  },

  unitOptions(selected) {
    return Utils.getAllStockUnits().map(u => `<option value="${u}" ${selected === u ? 'selected' : ''}>${u}</option>`).join('');
  },

  async showForm(product = null) {
    this.editingProduct = product;
    this.picturePath = product?.picture_path || null;
    const cats = this.categories.map(c => `<option value="${c.id}" ${product?.category_id == c.id ? 'selected' : ''}>${c.name}</option>`).join('');
    const types = Utils.itemTypes.map(t => `<option value="${t}" ${product?.item_type === t ? 'selected' : ''}>${t}</option>`).join('');
    const stockUnit = product?.stock_unit || product?.unit || 'each';
    this.editingOptionGroups = this.loadOptionGroups(product);
    if (!this.editingExtras?.length) this.editingExtras = [{ name: '', extra_price: 0 }];
    const optionsStyle = product?.options_style || 'radio';

    Utils.showModal(product?.id ? 'Edit Product' : 'Add Product', `
      <div class="form-tabs">
        <button type="button" class="form-tab active" data-tab="basic">Basic</button>
        <button type="button" class="form-tab" data-tab="stock">Stock</button>
        <button type="button" class="form-tab" data-tab="options">Options & Extras</button>
        <button type="button" class="form-tab" data-tab="custom">Custom Fields</button>
      </div>
      <div id="tab-basic" class="tab-panel">
        <div class="form-grid">
          <div class="field"><label>Product Name *</label><input id="pf-name" value="${product?.name || ''}"></div>
          <div class="field"><label>Category</label><select id="pf-category"><option value="">—</option>${cats}</select></div>
          <div class="field"><label>Item Type</label><select id="pf-type">${types}</select></div>
          <div class="field"><label>SKU</label><input id="pf-sku" value="${product?.sku || ''}"></div>
          <div class="field"><label>Barcode</label><input id="pf-barcode" value="${product?.barcode || ''}"><button type="button" class="btn btn-sm btn-ghost" id="pf-gen-barcode" style="margin-top:4px">Auto-generate</button></div>
          <div class="field"><label>Selling Price *</label><input type="number" id="pf-price" step="0.01" min="0.01" value="${product?.selling_price || ''}"></div>
          <div class="field"><label>Cost Price</label><input type="number" id="pf-cost" step="0.01" value="${product?.buying_price || ''}"></div>
          <div class="field"><label>Status</label><select id="pf-status"><option value="1" ${product?.is_active !== 0 ? 'selected' : ''}>Active</option><option value="0" ${product?.is_active === 0 ? 'selected' : ''}>Inactive</option></select></div>
          <div class="field full"><label>Description</label><textarea id="pf-desc" rows="2">${product?.description || ''}</textarea></div>
          <div class="field full"><label>Product Photo</label>
            <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
              <button type="button" class="btn btn-primary" id="pf-image-btn">Upload Photo</button>
              <div id="pf-image-preview">${product?.picture_path ? '<span class="muted">Loading photo…</span>' : '<span class="muted">No photo yet</span>'}</div>
            </div></div>
        </div>
      </div>
      <div id="tab-stock" class="tab-panel hidden">
        <div class="form-grid">
          <div class="field"><label>Stock Quantity</label><input type="number" id="pf-stock" step="0.01" value="${product?.stock_quantity ?? 0}"></div>
          <div class="field"><label>Min Stock Alert</label><input type="number" id="pf-min" step="0.01" value="${product?.min_stock ?? 5}"></div>
          <div class="field"><label>Stock unit (how you count)</label><select id="pf-unit">${this.unitOptions(stockUnit)}</select></div>
        </div>
        <h4 style="margin:20px 0 8px">Packages (how you buy)</h4>
        <p class="muted" style="margin:0 0 12px;font-size:13px">Example: buy by <strong>Case</strong> of <strong>24</strong> bottles — stock stays in bottles. Restock 2 cases → +48 stock.</p>
        <div class="form-grid">
          <div class="field"><label>Package name</label>
            <input id="pf-pack-label" list="pf-pack-presets" placeholder="e.g. Case, Box, Carton, Pack" value="${product?.purchase_unit_label || ''}">
            <datalist id="pf-pack-presets">
              <option value="Case"><option value="Box"><option value="Carton"><option value="Pack"><option value="Bundle"><option value="Crate">
            </datalist>
          </div>
          <div class="field"><label>Contains (qty)</label>
            <input type="number" id="pf-pack-qty" step="0.001" min="0.001" value="${product?.purchase_unit_qty > 0 ? product.purchase_unit_qty : 1}">
          </div>
          <div class="field"><label>Of stock unit</label>
            <select id="pf-pack-of-unit">${this.unitOptions(stockUnit)}</select>
            <small class="muted">Usually same as stock unit above</small>
          </div>
          <div class="field"><label>Purchase unit code</label>
            <select id="pf-purchase-unit">${this.unitOptions(product?.purchase_unit || product?.purchase_unit_label || 'case')}</select>
            <small class="muted">Used when restocking / receiving</small>
          </div>
        </div>
        <h4 style="margin:20px 0 8px">Extra conversions</h4>
        <p class="muted" style="margin:0 0 8px;font-size:12px">Optional: e.g. 1 kg = 1000 g. Package above is saved as a conversion automatically.</p>
        <div id="pf-conv-list"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="pf-add-conv" style="margin-top:8px">+ Add conversion</button>
      </div>
      <div id="tab-options" class="tab-panel hidden">
        <p class="muted" style="margin-bottom:12px">Set option groups (e.g. sauce — pick 1 or 2, mandatory or not). Use <strong>Without / Remove</strong> to reduce price (e.g. Without pap −R10).</p>
        <div class="field"><label>How single-choice groups appear at POS</label>
          <select id="pf-options-style">
            <option value="radio" ${optionsStyle === 'radio' ? 'selected' : ''}>Radio buttons</option>
            <option value="dropdown" ${optionsStyle === 'dropdown' ? 'selected' : ''}>Dropdown</option>
          </select></div>
        <h4 style="margin:16px 0 8px">Option Groups</h4>
        <div id="opt-groups"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="add-opt-group">+ Add Option Group</button>
        <h4 style="margin:20px 0 8px">Without / Remove (reduces price)</h4>
        <p class="muted" style="font-size:12px;margin-bottom:8px">Example: "Without pap" reduces R10 from a R40 meal.</p>
        <div id="removal-list"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="add-removal" style="margin-top:8px">+ Add Without option</button>
        <h4 style="margin:20px 0 8px">Extras (add-on checkboxes)</h4>
        <div id="extra-list"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="add-extra" style="margin-top:8px">+ Add Extra</button>
      </div>
      <div id="tab-custom" class="tab-panel hidden">
        <p class="muted" style="margin-bottom:12px">Extra fields from Admin → Custom Fields. Leave blank if unused.</p>
        <div id="pf-custom-fields"><p class="muted">Loading…</p></div>
      </div>`,
      '<button type="button" class="btn btn-primary" id="save-prod">Save Product</button>');

    const renderOptionGroups = () => {
      const el = document.getElementById('opt-groups');
      if (!el) return;
      el.innerHTML = this.editingOptionGroups.map((g, gi) => `
        <div class="option-group-card" style="margin-bottom:12px;padding:12px;background:var(--bg-secondary);border-radius:8px">
          <div class="form-grid">
            <div class="field"><label>Group name</label><input class="og-name" data-gi="${gi}" value="${g.name}" placeholder="e.g. Sauce, Size"></div>
            <div class="field"><label>Min choices</label><input type="number" class="og-min" data-gi="${gi}" min="0" value="${g.min_select ?? 0}"></div>
            <div class="field"><label>Max choices</label><input type="number" class="og-max" data-gi="${gi}" min="1" value="${g.max_select ?? 1}"></div>
            <div class="field" style="display:flex;align-items:flex-end;padding-bottom:8px">
              <label><input type="checkbox" class="og-req" data-gi="${gi}" ${g.is_required ? 'checked' : ''}> Mandatory</label></div>
            <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn btn-sm btn-danger rm-og" data-gi="${gi}">Remove</button></div>
          </div>
          <div class="og-choices" data-gi="${gi}">${(g.choices || []).map((c, ci) => `
            <div class="form-grid" style="margin-top:8px">
              <div class="field"><label>Choice</label><input class="og-choice-name" data-gi="${gi}" data-ci="${ci}" value="${c.name}" placeholder="e.g. BBQ, Mild"></div>
              <div class="field"><label>Price adjust (+/−)</label><input type="number" class="og-choice-price" data-gi="${gi}" data-ci="${ci}" step="0.01" value="${c.extra_price || 0}"></div>
              <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn btn-sm btn-ghost rm-choice" data-gi="${gi}" data-ci="${ci}">×</button></div>
            </div>`).join('')}</div>
          <button type="button" class="btn btn-ghost btn-sm add-choice" data-gi="${gi}" style="margin-top:8px">+ Add choice</button>
        </div>`).join('');
      el.querySelectorAll('.og-name').forEach(inp => inp.addEventListener('input', () => { this.editingOptionGroups[inp.dataset.gi].name = inp.value; }));
      el.querySelectorAll('.og-choice-name').forEach(inp => inp.addEventListener('input', () => { this.editingOptionGroups[inp.dataset.gi].choices[inp.dataset.ci].name = inp.value; }));
      el.querySelectorAll('.og-choice-price').forEach(inp => inp.addEventListener('input', () => { this.editingOptionGroups[inp.dataset.gi].choices[inp.dataset.ci].extra_price = parseFloat(inp.value) || 0; }));
      el.querySelectorAll('.rm-og').forEach(b => b.addEventListener('click', () => { this.editingOptionGroups.splice(parseInt(b.dataset.gi), 1); renderOptionGroups(); }));
      el.querySelectorAll('.rm-choice').forEach(b => b.addEventListener('click', () => {
        this.editingOptionGroups[b.dataset.gi].choices.splice(parseInt(b.dataset.ci), 1);
        renderOptionGroups();
      }));
      el.querySelectorAll('.add-choice').forEach(b => b.addEventListener('click', () => {
        this.editingOptionGroups[b.dataset.gi].choices.push({ name: '', extra_price: 0 });
        renderOptionGroups();
      }));
    };

    const renderExtras = () => {
      const el = document.getElementById('extra-list');
      if (!el) return;
      el.innerHTML = this.editingExtras.map((e, i) => `
        <div class="form-grid" style="margin-bottom:8px">
          <div class="field"><label>Extra name</label><input class="ex-name" data-i="${i}" value="${e.name}" placeholder="e.g. Extra cheese"></div>
          <div class="field"><label>Extra price</label><input type="number" class="ex-price" data-i="${i}" step="0.01" value="${e.extra_price || 0}"></div>
          <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn btn-sm btn-danger rm-ex" data-i="${i}">×</button></div>
        </div>`).join('') || '<p class="muted">No extras yet</p>';
      el.querySelectorAll('.ex-name').forEach(inp => inp.addEventListener('input', () => { this.editingExtras[inp.dataset.i].name = inp.value; }));
      el.querySelectorAll('.ex-price').forEach(inp => inp.addEventListener('input', () => { this.editingExtras[inp.dataset.i].extra_price = parseFloat(inp.value) || 0; }));
      el.querySelectorAll('.rm-ex').forEach(b => b.addEventListener('click', () => { this.editingExtras.splice(parseInt(b.dataset.i), 1); renderExtras(); }));
    };

    const renderRemovals = () => {
      const el = document.getElementById('removal-list');
      if (!el) return;
      el.innerHTML = this.editingRemovals.map((r, i) => `
        <div class="form-grid" style="margin-bottom:8px">
          <div class="field"><label>Without / Remove</label><input class="rm-name" data-i="${i}" value="${r.name}" placeholder="e.g. Without pap"></div>
          <div class="field"><label>Reduce amount (R)</label><input type="number" class="rm-amt" data-i="${i}" step="0.01" min="0" value="${r.reduce_amount || 0}"></div>
          <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn btn-sm btn-danger rm-rm" data-i="${i}">×</button></div>
        </div>`).join('') || '<p class="muted">No removals yet</p>';
      el.querySelectorAll('.rm-name').forEach(inp => inp.addEventListener('input', () => { this.editingRemovals[inp.dataset.i].name = inp.value; }));
      el.querySelectorAll('.rm-amt').forEach(inp => inp.addEventListener('input', () => { this.editingRemovals[inp.dataset.i].reduce_amount = parseFloat(inp.value) || 0; }));
      el.querySelectorAll('.rm-rm').forEach(b => b.addEventListener('click', () => { this.editingRemovals.splice(parseInt(b.dataset.i), 1); renderRemovals(); }));
    };

    renderOptionGroups();
    renderRemovals();
    renderExtras();

    this.editingConversions = (product?.conversions || []).map(c => ({
      from_qty: Number(c.from_qty) > 0 ? Number(c.from_qty) : 1,
      from_unit: c.from_unit || '',
      to_qty: Number(c.to_qty) > 0 ? Number(c.to_qty) : 1,
      to_unit: c.to_unit || stockUnit,
      label: c.label || ''
    }));
    const renderConversions = () => {
      const el = document.getElementById('pf-conv-list');
      if (!el) return;
      el.innerHTML = this.editingConversions.map((c, i) => `
        <div class="form-grid" style="margin-bottom:8px;align-items:end">
          <div class="field"><label>From qty</label><input type="number" class="cv-from-qty" data-i="${i}" step="0.001" min="0.001" value="${c.from_qty}"></div>
          <div class="field"><label>From unit</label><input class="cv-from-unit" data-i="${i}" list="pf-unit-list" value="${c.from_unit}" placeholder="case"></div>
          <div class="field"><label>= To qty</label><input type="number" class="cv-to-qty" data-i="${i}" step="0.001" min="0.001" value="${c.to_qty}"></div>
          <div class="field"><label>To unit</label><input class="cv-to-unit" data-i="${i}" list="pf-unit-list" value="${c.to_unit}" placeholder="each"></div>
          <div class="field"><label>Label</label><input class="cv-label" data-i="${i}" value="${c.label || ''}" placeholder="optional"></div>
          <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn btn-sm btn-danger cv-rm" data-i="${i}">×</button></div>
        </div>`).join('') || '<p class="muted">No extra conversions</p>';
      if (!document.getElementById('pf-unit-list')) {
        const dl = document.createElement('datalist');
        dl.id = 'pf-unit-list';
        dl.innerHTML = Utils.getAllStockUnits().map(u => `<option value="${u}">`).join('');
        el.parentElement?.appendChild(dl);
      }
      el.querySelectorAll('.cv-from-qty').forEach(inp => inp.addEventListener('input', () => { this.editingConversions[inp.dataset.i].from_qty = parseFloat(inp.value) || 1; }));
      el.querySelectorAll('.cv-from-unit').forEach(inp => inp.addEventListener('input', () => { this.editingConversions[inp.dataset.i].from_unit = inp.value; }));
      el.querySelectorAll('.cv-to-qty').forEach(inp => inp.addEventListener('input', () => { this.editingConversions[inp.dataset.i].to_qty = parseFloat(inp.value) || 1; }));
      el.querySelectorAll('.cv-to-unit').forEach(inp => inp.addEventListener('input', () => { this.editingConversions[inp.dataset.i].to_unit = inp.value; }));
      el.querySelectorAll('.cv-label').forEach(inp => inp.addEventListener('input', () => { this.editingConversions[inp.dataset.i].label = inp.value; }));
      el.querySelectorAll('.cv-rm').forEach(b => b.addEventListener('click', () => {
        this.editingConversions.splice(parseInt(b.dataset.i, 10), 1);
        renderConversions();
      }));
    };
    renderConversions();
    document.getElementById('pf-add-conv')?.addEventListener('click', () => {
      const u = document.getElementById('pf-unit')?.value || 'each';
      this.editingConversions.push({ from_qty: 1, from_unit: 'case', to_qty: 24, to_unit: u, label: 'Case' });
      renderConversions();
    });
    const syncPackOfUnit = () => {
      const stock = document.getElementById('pf-unit')?.value;
      const ofUnit = document.getElementById('pf-pack-of-unit');
      if (stock && ofUnit && !ofUnit.dataset.touched) ofUnit.value = stock;
    };
    document.getElementById('pf-unit')?.addEventListener('change', syncPackOfUnit);
    document.getElementById('pf-pack-of-unit')?.addEventListener('change', (e) => { e.target.dataset.touched = '1'; });

    document.getElementById('add-opt-group')?.addEventListener('click', () => {
      this.editingOptionGroups.push({ name: 'Choose one', choices: [{ name: '', extra_price: 0 }], min_select: 1, max_select: 1, is_required: false });
      renderOptionGroups();
    });
    document.getElementById('add-removal')?.addEventListener('click', () => {
      this.editingRemovals.push({ name: '', reduce_amount: 0 });
      renderRemovals();
    });
    document.getElementById('add-extra')?.addEventListener('click', () => {
      this.editingExtras.push({ name: '', extra_price: 0 });
      renderExtras();
    });

    const formRoot = document.getElementById('modal-body') || document.querySelector('.modal-body') || document;
    formRoot.querySelectorAll('.form-tab').forEach(tab => tab.addEventListener('click', () => {
      formRoot.querySelectorAll('.form-tab').forEach(t => t.classList.remove('active'));
      formRoot.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      formRoot.querySelector('#tab-' + tab.dataset.tab)?.classList.remove('hidden');
    }));

    document.getElementById('pf-gen-barcode').addEventListener('click', () => {
      document.getElementById('pf-barcode').value = '8' + String(Date.now()).slice(-11);
    });

    document.getElementById('pf-image-btn').addEventListener('click', async () => {
      const r = await API.selectImage('product');
      if (r?.cancelled) return;
      if (!r?.success || !r.path) {
        Utils.toast(r?.error || 'Could not upload photo', 'error');
        return;
      }
      this.picturePath = r.path;
      await Utils.setImagePreview('pf-image-preview', r.path);
      Utils.toast('Photo uploaded', 'success');
    });

    document.getElementById('save-prod').addEventListener('click', () => this.saveProduct());

    this._customFields = [];
    try {
      const cfRes = product?.id
        ? await API.getCustomFieldValues('product', product.id)
        : await API.getCustomFields('product');
      this._customFields = cfRes.data || [];
    } catch (_) { this._customFields = []; }
    const cfEl = document.getElementById('pf-custom-fields');
    if (cfEl) {
      if (!this._customFields.length) {
        cfEl.innerHTML = '<p class="muted">No custom fields yet. Add them in Admin → Custom Fields.</p>';
      } else {
        cfEl.innerHTML = `<div class="form-grid">${this._customFields.map(f => {
          const id = f.field_id || f.id;
          const type = f.field_type === 'number' ? 'number' : f.field_type === 'date' ? 'date' : 'text';
          return `<div class="field"><label>${f.field_label || f.field_name}${f.is_required ? ' *' : ''}</label>
            <input id="cfv-${id}" data-field-id="${id}" type="${type}" value="${f.value || ''}"></div>`;
        }).join('')}</div>`;
      }
    }

    if (this.picturePath) await Utils.setImagePreview('pf-image-preview', this.picturePath);
  },

  async saveProduct() {
    const btn = document.getElementById('save-prod');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const unit = document.getElementById('pf-unit')?.value || 'each';
    const packLabel = (document.getElementById('pf-pack-label')?.value || '').trim();
    const packQty = parseFloat(document.getElementById('pf-pack-qty')?.value) || 1;
    const packOfUnit = document.getElementById('pf-pack-of-unit')?.value || unit;
    const purchaseUnit = document.getElementById('pf-purchase-unit')?.value || packLabel || unit;
    const conversions = [...(this.editingConversions || [])]
      .filter(c => c.from_unit?.trim() && c.to_unit?.trim() && Number(c.to_qty) > 0)
      .map(c => ({
        from_qty: Number(c.from_qty) > 0 ? Number(c.from_qty) : 1,
        from_unit: c.from_unit.trim(),
        to_qty: Number(c.to_qty),
        to_unit: c.to_unit.trim(),
        label: (c.label || '').trim() || null
      }));
    if (packLabel && packQty > 0) {
      const packUnitCode = (purchaseUnit || packLabel).toLowerCase();
      const exists = conversions.some(c =>
        String(c.from_unit).toLowerCase() === packUnitCode &&
        String(c.to_unit).toLowerCase() === String(packOfUnit).toLowerCase()
      );
      if (!exists) {
        conversions.unshift({
          from_qty: 1,
          from_unit: purchaseUnit || packLabel,
          to_qty: packQty,
          to_unit: packOfUnit,
          label: packLabel
        });
      }
    }
    const prev = this.editingProduct || {};
    this.syncModifiersFromDom();
    const modifiers = this.flattenModifiers();
    const data = {
      id: prev.id,
      name: document.getElementById('pf-name').value.trim(),
      category_id: parseInt(document.getElementById('pf-category').value) || null,
      item_type: document.getElementById('pf-type').value,
      selling_price: parseFloat(document.getElementById('pf-price').value),
      buying_price: parseFloat(document.getElementById('pf-cost').value) || 0,
      barcode: document.getElementById('pf-barcode').value.trim() || null,
      sku: document.getElementById('pf-sku').value.trim() || null,
      stock_quantity: parseFloat(document.getElementById('pf-stock').value) || 0,
      min_stock: parseFloat(document.getElementById('pf-min').value) || 5,
      unit,
      stock_unit: unit,
      purchase_unit: purchaseUnit || null,
      purchase_unit_qty: packQty > 0 ? packQty : 1,
      purchase_unit_label: packLabel || null,
      picture_path: this.picturePath,
      description: document.getElementById('pf-desc').value.trim(),
      is_active: parseInt(document.getElementById('pf-status').value),
      requires_options: !!(this._optionGroupsMeta || []).some(g => g.is_required),
      options_style: document.getElementById('pf-options-style')?.value || 'radio',
      option_groups_meta: this._optionGroupsMeta || [],
      modifiers,
      conversions
    };
    if (prev.recipe?.length) data.recipe = prev.recipe;

    if (!data.name) { Utils.toast('Product name is required', 'error'); btn.disabled = false; btn.textContent = 'Save Product'; return; }
    if (Number.isNaN(data.selling_price) || !data.selling_price || data.selling_price <= 0) {
      Utils.toast('Enter a valid selling price greater than 0', 'error');
      btn.disabled = false; btn.textContent = 'Save Product'; return;
    }

    try {
      const result = await API.saveProduct(data, this.app.user);
      if (!result.success) {
        Utils.toast(result.error || 'Failed to save product', 'error');
        btn.disabled = false;
        btn.textContent = 'Save Product';
        return;
      }
      const productId = result.data?.id || result.data || prev.id;
      if (productId && this._customFields?.length) {
        const values = {};
        this._customFields.forEach(f => {
          const id = f.field_id || f.id;
          const inp = document.getElementById(`cfv-${id}`);
          if (inp) values[id] = inp.value;
        });
        await API.saveCustomFieldValues('product', productId, values, this.app.user);
      }
      Utils.hideModal();
      Utils.sessionCacheClear('products_page');
      await ProductsPage.render(document.getElementById('page-content'), this.app);
      Utils.toast('Product saved successfully', 'success');
    } catch (err) {
      Utils.toast(err.message || 'Failed to save product', 'error');
      btn.disabled = false;
      btn.textContent = 'Save Product';
    }
  }
};
window.ProductsPage = ProductsPage;

const PurchaseOrdersPage = {
  async render(el, app) {
    this.app = app;
    const [poRes, supRes, prodRes] = await Promise.all([API.getPurchaseOrders(), API.getSuppliers(), API.getProducts()]);
    this.orders = poRes.data || [];
    this.suppliers = supRes.data || [];
    this.products = prodRes.data || [];
    const currency = app.settings?.currency || 'R';

    el.innerHTML = `
      <div class="page-toolbar"><h3>Purchase Orders</h3><button class="btn btn-primary" id="new-po">+ New Order</button></div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>PO #</th><th>Supplier</th><th>Total</th><th>Status</th><th>Date</th><th></th></tr></thead>
        <tbody>${this.orders.map(o => `<tr>
          <td><strong>${o.po_number}</strong></td><td>${o.supplier_name || '—'}</td>
          <td>${Utils.formatMoney(o.total, currency)}</td>
          <td><span class="tag ${o.status === 'received' ? 'tag-ok' : o.status === 'partial' ? 'tag-low' : 'tag-low'}">${o.status}</span></td>
          <td>${Utils.formatDate(o.created_at)}</td>
          <td>${o.status === 'pending' || o.status === 'partial' ? `
            <button class="btn btn-sm btn-success recv-po" data-id="${o.id}">Receive All</button>
            <button class="btn btn-sm btn-ghost partial-po" data-id="${o.id}">Partial</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No purchase orders</td></tr>'}
        </tbody></table></div></div>`;

    document.getElementById('new-po').addEventListener('click', () => this.showForm());
    document.querySelectorAll('.recv-po').forEach(b => b.addEventListener('click', async () => {
      const res = await API.receivePurchaseOrder(parseInt(b.dataset.id), app.user);
      if (!res.success) return Utils.toast(res.error || 'Receive failed', 'error');
      PurchaseOrdersPage.render(el, app);
      Utils.toast('Stock updated from PO', 'success');
    }));
    document.querySelectorAll('.partial-po').forEach(b => b.addEventListener('click', () =>
      this.showPartialReceive(parseInt(b.dataset.id))));
  },

  async showPartialReceive(poId) {
    const res = await API.getPurchaseOrder(poId);
    const po = res.data;
    if (!po) return Utils.toast('PO not found', 'error');
    const items = po.items || [];
    Utils.showModal(`Partial Receive — ${po.po_number}`, `
      <p class="muted">Enter quantity received now. Remaining goes to backorder.</p>
      ${items.map(item => {
        const remaining = item.quantity - (item.received_qty || 0);
        return remaining > 0 ? `<div class="field" style="display:flex;align-items:center;gap:12px">
          <label style="flex:1">${item.product_name}<br><small>Ordered: ${item.quantity}, Received: ${item.received_qty || 0}, Remaining: ${remaining}</small></label>
          <input type="number" class="partial-qty" data-item-id="${item.id}" min="0" max="${remaining}" value="${remaining}" style="width:80px">
        </div>` : '';
      }).join('') || '<p class="muted">All items already received</p>'}`,
      '<button class="btn btn-primary" id="save-partial">Receive Selected</button>');
    document.getElementById('save-partial')?.addEventListener('click', async () => {
      const receiveItems = [...document.querySelectorAll('.partial-qty')].map(inp => ({
        po_item_id: parseInt(inp.dataset.itemId),
        quantity: parseFloat(inp.value) || 0
      })).filter(i => i.quantity > 0);
      if (!receiveItems.length) return Utils.toast('Enter quantities', 'error');
      const res = await API.receivePurchaseOrderPartial(poId, receiveItems, this.app.user);
      if (!res.success) return Utils.toast(res.error || 'Partial receive failed', 'error');
      Utils.hideModal();
      PurchaseOrdersPage.render(document.getElementById('page-content'), this.app);
      Utils.toast('Partial receive recorded', 'success');
    });
  },

  showForm() {
    const supOpts = this.suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    const prodOpts = this.products.map(p => `<option value="${p.id}" data-price="${p.buying_price}">${p.name}</option>`).join('');
    Utils.showModal('New Purchase Order', `
      <div class="field"><label>Supplier</label><select id="po-supplier"><option value="">—</option>${supOpts}</select></div>
      <div class="field"><label>Product</label><select id="po-product">${prodOpts}</select></div>
      <div class="form-grid">
        <div class="field"><label>Quantity</label><input type="number" id="po-qty" value="1" min="1"></div>
        <div class="field"><label>Buying Price</label><input type="number" id="po-price" step="0.01"></div>
      </div>
      <div class="field"><label><input type="checkbox" id="po-receive"> Receive immediately (add to stock)</label></div>`,
      '<button class="btn btn-primary" id="save-po">Create Order</button>');

    document.getElementById('po-product').addEventListener('change', (e) => {
      const opt = e.target.selectedOptions[0];
      document.getElementById('po-price').value = opt?.dataset.price || 0;
    });
    document.getElementById('po-product').dispatchEvent(new Event('change'));

    document.getElementById('save-po').addEventListener('click', async () => {
      const prodSelect = document.getElementById('po-product');
      const prod = this.products.find(p => p.id == prodSelect.value);
      const qty = parseFloat(document.getElementById('po-qty').value) || 1;
      const price = parseFloat(document.getElementById('po-price').value) || 0;
      const res = await API.savePurchaseOrder({
        supplier_id: parseInt(document.getElementById('po-supplier').value) || null,
        status: document.getElementById('po-receive').checked ? 'received' : 'pending',
        items: [{ product_id: prod.id, product_name: prod.name, quantity: qty, buying_price: price, total: qty * price }]
      }, this.app.user);
      if (!res.success) return Utils.toast(res.error || 'Save failed', 'error');
      Utils.hideModal();
      PurchaseOrdersPage.render(document.getElementById('page-content'), this.app);
      Utils.toast('Purchase order created', 'success');
    });
  }
};
window.PurchaseOrdersPage = PurchaseOrdersPage;

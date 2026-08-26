const RestaurantPage = {
  tab: 'tables',

  async render(el, app) {
    this.app = app;
    if (this.tab !== 'kitchen') this.stopKitchenSync();
    el.innerHTML = `<div class="page-toolbar"><h3>Restaurant</h3></div>
      <div class="admin-tabs">
        <button class="admin-tab ${this.tab==='tables'?'active':''}" data-tab="tables">Tables</button>
        <button class="admin-tab ${this.tab==='kitchen'?'active':''}" data-tab="kitchen">Kitchen Display (KDS)</button>
        <button class="admin-tab ${this.tab==='reports'?'active':''}" data-tab="reports">Order Reports</button>
        <button class="admin-tab ${this.tab==='settings'?'active':''}" data-tab="settings">Settings</button>
      </div><div id="rest-content">${Utils.pageSkeleton()}</div>`;
    el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.render(el, app); }));
    const content = document.getElementById('rest-content');
    if (this.tab === 'tables') await this.renderTables(content);
    else if (this.tab === 'kitchen') await this.renderKitchen(content);
    else if (this.tab === 'reports') await this.renderReports(content);
    else if (this.tab === 'settings') await this.renderSettings(content);
  },

  async renderTables(el) {
    const res = await API.getTables();
    const tables = res.data || [];
    el.innerHTML = `<div style="margin:16px 0;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" id="add-table">+ Add Table</button>
    </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px">
        ${tables.map(t => `<div class="card table-card" style="text-align:center;padding:20px;border-color:${t.is_occupied ? 'var(--warning)' : t.status==='reserved' ? 'var(--primary)' : 'var(--border)'}">
          <div style="font-size:24px;font-weight:700">${t.table_number}</div>
          <div class="muted">${t.seats} seats</div>
          <div class="tag" style="margin-top:8px">${t.is_occupied ? 'occupied' : t.status}</div>
          ${t.waiter_name ? `<small>${t.waiter_name}</small>` : ''}
          <div style="margin-top:10px;display:flex;gap:4px;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-sm btn-ghost edit-table" data-id="${t.id}">Edit</button>
            <button class="btn btn-sm btn-ghost clear-table" data-id="${t.id}" ${!t.is_occupied && t.status === 'available' ? 'disabled' : ''}>Clear</button>
            <button class="btn btn-sm btn-danger del-table" data-id="${t.id}" ${t.is_occupied ? 'disabled' : ''}>Delete</button>
          </div>
        </div>`).join('') || '<p class="muted">No tables configured</p>'}
      </div>`;

    document.getElementById('add-table')?.addEventListener('click', () => this.showTableModal());
    el.querySelectorAll('.edit-table').forEach(b => b.addEventListener('click', async () => {
      const t = tables.find(x => x.id == b.dataset.id);
      if (t) this.showTableModal(t);
    }));
    el.querySelectorAll('.clear-table').forEach(b => b.addEventListener('click', async () => {
      const t = tables.find(x => x.id == b.dataset.id);
      if (!t) return;
      await API.saveTable({ ...t, status: 'available' }, this.app.user);
      Utils.toast(`Table ${t.table_number} cleared`, 'success');
      this.render(document.getElementById('page-content'), this.app);
    }));
    el.querySelectorAll('.del-table').forEach(b => b.addEventListener('click', async () => {
      const t = tables.find(x => x.id == b.dataset.id);
      if (!t || t.is_occupied) return Utils.toast('Clear the table first', 'error');
      if (!confirm(`Delete table ${t.table_number}?`)) return;
      const r = await API.deleteTable(t.id, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not delete table', 'error');
      Utils.toast(`Table ${t.table_number} deleted`, 'success');
      Utils.sessionCacheClear?.('tables');
      this.render(document.getElementById('page-content'), this.app);
    }));
  },

  showTableModal(existing) {
    const t = existing || {};
    Utils.showModal(existing ? 'Edit Table' : 'Add Table', `
      <div class="field"><label>Table Name / Number *</label><input id="t-num" value="${t.table_number || ''}"></div>
      <div class="field"><label>Seats</label><input type="number" id="t-seats" value="${t.seats || 4}"></div>
      <div class="field"><label>Status</label>
        <select id="t-status">
          ${['available', 'occupied', 'reserved'].map(s => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select></div>
      <div class="field"><label>Notes</label><input id="t-notes" value="${t.notes || ''}"></div>`,
      '<button class="btn btn-primary" id="save-table">Save</button>');
    document.getElementById('save-table').addEventListener('click', async () => {
      const num = document.getElementById('t-num').value.trim();
      if (!num) return Utils.toast('Table name is required', 'error');
      await API.saveTable({
        id: t.id,
        table_number: num,
        seats: parseInt(document.getElementById('t-seats').value, 10) || 4,
        status: document.getElementById('t-status').value,
        notes: document.getElementById('t-notes').value.trim()
      }, this.app.user);
      Utils.hideModal();
      Utils.sessionCacheClear('tables');
      this.render(document.getElementById('page-content'), this.app);
    });
  },

  stopKitchenSync() {
    if (this._kdsPoll) { clearInterval(this._kdsPoll); this._kdsPoll = null; }
    if (this._kdsChannel) { try { this._kdsChannel.close(); } catch (_) {} this._kdsChannel = null; }
  },

  async renderKitchen(el) {
    this.stopKitchenSync();
    const paint = async () => {
      if (this.tab !== 'kitchen' || !el.isConnected) return;
      const res = await API.getKitchenOrders('pending,preparing,ready,collection');
      const orders = (res.data || []).filter(o => ['pending', 'preparing', 'ready', 'collection'].includes(o.status));
      const statuses = ['pending', 'preparing', 'ready', 'collection'];
      el.innerHTML = `<div style="margin:12px 0;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="open-kds">Open Kitchen Display Window</button>
        <button class="btn btn-ghost" id="refresh-kds">Refresh</button>
      </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:16px">
        ${statuses.map(st => {
          const items = orders.filter(o => o.status === st);
          return `<div class="card"><div class="card-header"><h3>${st.toUpperCase()} (${items.length})</h3></div><div class="card-body">
            ${items.map(o => `<div style="padding:10px;border-bottom:1px solid var(--border)">
              <strong>${o.order_number}</strong> ${o.table_number ? `— Table ${o.table_number}` : ''}
              <ul style="margin:6px 0 0;padding-left:16px">${(o.items||[]).map(i => `<li>${i.quantity}x ${i.product_name}</li>`).join('')}</ul>
              <div style="margin-top:6px">
              ${st === 'pending' ? `<button class="btn btn-sm btn-ghost kot-advance" data-id="${o.id}" data-status="preparing">→ Start</button>` : ''}
              ${st === 'preparing' ? `<button class="btn btn-sm btn-ghost kot-advance" data-id="${o.id}" data-status="ready">→ Ready</button>` : ''}
              ${st === 'ready' ? `<button class="btn btn-sm btn-ghost kot-advance" data-id="${o.id}" data-status="collection">→ Collection</button>` : ''}
              <button class="btn btn-sm btn-success kot-done" data-id="${o.id}">Done</button></div>
            </div>`).join('') || '<p class="muted">None</p>'}
          </div></div>`;
        }).join('')}
      </div>`;
      document.getElementById('open-kds')?.addEventListener('click', async () => {
        const native = !!(window.Capacitor?.isNativePlatform?.() || window.__SHOP_POS_MOBILE__);
        if (native && window.App?.openInAppDisplay) {
          window.App.openInAppDisplay('kitchen');
          return;
        }
        const r = await API.openKitchenDisplay();
        Utils.toast(r.success ? 'Kitchen display opened' : (r.error || 'Failed'), r.success ? 'success' : 'error');
      });
      document.getElementById('refresh-kds')?.addEventListener('click', () => paint());
      el.querySelectorAll('.kot-advance, .kot-done').forEach(b => b.addEventListener('click', async () => {
        const id = parseInt(b.dataset.id, 10);
        const status = b.classList.contains('kot-done') ? 'completed' : b.dataset.status;
        const r = await API.updateKitchenStatus(id, status, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Could not update order', 'error');
        if (status === 'completed') {
          Utils.toast('Order done — removed from board', 'success');
          try {
            const bc = new BroadcastChannel('shoppos-kitchen');
            bc.postMessage({ type: 'refresh' });
            bc.close();
          } catch (_) {}
        }
        await paint();
      }));
    };
    await paint();

    try {
      this._kdsChannel = new BroadcastChannel('shoppos-kitchen');
      this._kdsChannel.onmessage = (e) => {
        if (e.data?.type === 'refresh' && this.tab === 'kitchen') paint();
      };
    } catch (_) {}
    this._kdsPoll = setInterval(() => {
      if (this.tab === 'kitchen' && el.isConnected) paint();
      else this.stopKitchenSync();
    }, 5000);
  },

  async renderReports(el) {
    const from = Utils.monthStart();
    const to = Utils.today();
    el.innerHTML = `<div class="card"><div class="card-body">
      ${Utils.dateFilterHTML('rest-order-filter')}
      <div id="rest-order-report" style="margin-top:16px">${Utils.pageSkeleton(3)}</div>
    </div></div>`;
    const load = async (f, t) => {
      const host = document.getElementById('rest-order-report');
      if (!host) return;
      try {
        const r = await API.getOrderTypeReport(f, t);
        if (!r.success) {
          host.innerHTML = `<p class="muted" style="color:var(--danger)">${r.error || 'Could not load order report'}</p>`;
          return;
        }
        const data = r.data || {};
        const currency = this.app.settings?.currency || 'R';
        const rows = data.by_type || [];
        host.innerHTML = `
        <div class="stats-grid" style="margin-bottom:16px">
          <div class="stat-card primary"><div class="label">Total Orders</div><div class="value">${data.totals?.orders || 0}</div></div>
          <div class="stat-card"><div class="label">Total Revenue</div><div class="value">${Utils.formatMoney(data.totals?.revenue || 0, currency)}</div></div>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Order Type</th><th>Orders</th><th>Revenue</th></tr></thead>
        <tbody>${rows.map(row => `<tr><td>${({ delivery: 'Delivery', takeaway: 'Takeaway', sit_in: 'Sit-in' }[row.order_type] || row.order_type)}</td>
          <td>${row.orders}</td><td>${Utils.formatMoney(row.revenue, currency)}</td></tr>`).join('')
          || '<tr><td colspan="3" class="muted">No sales in period</td></tr>'}
        </tbody></table></div>`;
      } catch (err) {
        host.innerHTML = `<p class="muted" style="color:var(--danger)">${err.message || 'Could not load order report'}</p>`;
      }
    };
    Utils.bindDateFilter('rest-order-filter', load);
    await load(from, to);
  },

  async renderSettings(el) {
    const soundPath = this.app.settings?.kds_notification_sound || '';
    el.innerHTML = `<div class="card"><div class="card-body"><h4>KDS Notification Sound</h4>
      <p class="muted">Plays when a new kitchen order arrives. Uses demo sound if none uploaded.</p>
      <div class="field"><label>Sound file path</label>
        <input id="kds-sound-path" value="${soundPath}" readonly>
        <button class="btn btn-sm btn-ghost" id="kds-pick-sound" style="margin-top:8px">Upload Sound</button>
      </div>
      <button class="btn btn-primary" id="kds-save-sound">Save</button></div></div>`;
    document.getElementById('kds-pick-sound')?.addEventListener('click', async () => {
      const pick = await API.selectDocument('doc');
      if (pick.success && pick.path) document.getElementById('kds-sound-path').value = pick.path;
    });
    document.getElementById('kds-save-sound')?.addEventListener('click', async () => {
      const path = document.getElementById('kds-sound-path').value.trim();
      const r = await API.saveKdsNotificationSound(path || null, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      this.app.settings = r.data;
      Utils.toast('KDS sound saved', 'success');
    });
  }
};
window.RestaurantPage = RestaurantPage;

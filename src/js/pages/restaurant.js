const RestaurantPage = {
  tab: 'tables',
  _host: null,

  async render(el, app) {
    this.app = app;
    this._host = el;
    if (this.tab !== 'kitchen' && this.tab !== 'customer') this.stopKitchenSync();
    el.innerHTML = `<div class="page-toolbar"><h3>Restaurant</h3>
      <p class="muted" style="margin:0;font-size:13px">Tables, kitchen workflow, and customer-facing order board</p></div>
      <div class="admin-tabs">
        <button class="admin-tab ${this.tab==='tables'?'active':''}" data-tab="tables">Tables</button>
        <button class="admin-tab ${this.tab==='kitchen'?'active':''}" data-tab="kitchen">Kitchen Display</button>
        <button class="admin-tab ${this.tab==='customer'?'active':''}" data-tab="customer">Customer Facing</button>
        <button class="admin-tab ${this.tab==='reports'?'active':''}" data-tab="reports">Order Reports</button>
        <button class="admin-tab ${this.tab==='settings'?'active':''}" data-tab="settings">Settings</button>
      </div><div id="rest-content">${Utils.pageSkeleton ? Utils.pageSkeleton() : '<p class="muted">Loading…</p>'}</div>`;
    el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
      this.tab = b.dataset.tab;
      this.render(el, app);
    }));
    const content = document.getElementById('rest-content');
    try {
      if (this.tab === 'tables') await this.renderTables(content);
      else if (this.tab === 'kitchen') await this.renderKitchen(content);
      else if (this.tab === 'customer') await this.renderCustomerFacing(content);
      else if (this.tab === 'reports') await this.renderReports(content);
      else if (this.tab === 'settings') await this.renderSettings(content);
    } catch (err) {
      if (content) {
        content.innerHTML = `<p class="error-msg">${Utils.escHtml(err.message || 'Could not load')}</p>
          <button type="button" class="btn btn-primary" id="rest-retry">Retry</button>`;
        document.getElementById('rest-retry')?.addEventListener('click', () => this.render(el, app));
      }
    }
  },

  _rerender() {
    if (this._host && this.app) return this.render(this._host, this.app);
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
      this._rerender();
    }));
    el.querySelectorAll('.del-table').forEach(b => b.addEventListener('click', async () => {
      const t = tables.find(x => x.id == b.dataset.id);
      if (!t || t.is_occupied) return Utils.toast('Clear the table first', 'error');
      if (!confirm(`Delete table ${t.table_number}?`)) return;
      const r = await API.deleteTable(t.id, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not delete table', 'error');
      Utils.toast(`Table ${t.table_number} deleted`, 'success');
      Utils.sessionCacheClear?.('tables');
      this._rerender();
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
      this._rerender();
    });
  },

  stopKitchenSync() {
    if (this._kdsPoll) { clearInterval(this._kdsPoll); this._kdsPoll = null; }
    if (this._kdsChannel) { try { this._kdsChannel.close(); } catch (_) {} this._kdsChannel = null; }
  },

  statusMeta(st) {
    return {
      pending: { title: 'NEW / QUEUED', hint: 'Tap Start when cooking begins', color: 'var(--warning)' },
      preparing: { title: 'PREPARING', hint: 'Tap Ready when plate is done', color: '#b45309' },
      ready: { title: 'READY', hint: 'Tap Collection when handed to counter', color: 'var(--primary)' },
      collection: { title: 'COLLECTION', hint: 'Tap Collected when customer has it', color: 'var(--success)' }
    }[st] || { title: st, hint: '', color: 'var(--border)' };
  },

  async advanceOrder(id, status) {
    const r = await API.updateKitchenStatus(id, status, this.app.user);
    if (!r.success) {
      Utils.toast(r.error || 'Could not update order', 'error');
      return false;
    }
    try {
      const bc = new BroadcastChannel('shoppos-kitchen');
      bc.postMessage({ type: 'refresh' });
      bc.close();
    } catch (_) { /* */ }
    try { await API.refreshKitchenDisplay?.(); } catch (_) { /* */ }
    try { await API.refreshCustomerDisplay?.(); } catch (_) { /* */ }
    return true;
  },

  async renderKitchen(el) {
    this.stopKitchenSync();
    const paint = async () => {
      if (this.tab !== 'kitchen' || !el.isConnected) return;
      const res = await API.getKitchenOrders('pending,preparing,ready,collection');
      const orders = (res.data || []).filter(o => ['pending', 'preparing', 'ready', 'collection'].includes(o.status));
      const statuses = ['pending', 'preparing', 'ready', 'collection'];
      el.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="card-body" style="padding:12px 16px">
        <strong>Kitchen workflow</strong>
        <p class="muted" style="margin:6px 0 0;font-size:13px">New → <em>Start</em> (Preparing) → <em>Ready</em> → <em>Collection</em> → <em>Collected</em>. Works with mouse or touchscreen. Open the full-screen window for a dedicated kitchen monitor.</p>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" id="open-kds">Open Kitchen Display Window</button>
          <button class="btn btn-ghost" id="open-cds-from-kds">Open Customer Board</button>
          <button class="btn btn-ghost" id="refresh-kds">Refresh</button>
        </div>
      </div></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">
        ${statuses.map(st => {
          const meta = this.statusMeta(st);
          const items = orders.filter(o => o.status === st);
          return `<div class="card" style="border-top:3px solid ${meta.color}"><div class="card-header"><h3 style="margin:0;font-size:14px;letter-spacing:0.04em">${meta.title} (${items.length})</h3>
            <small class="muted">${meta.hint}</small></div><div class="card-body" style="padding:8px">
            ${items.map(o => `<div class="kot-ticket" style="padding:12px;border-bottom:1px solid var(--border);touch-action:manipulation">
              <strong style="font-size:1.15rem">${Utils.escHtml(o.order_number)}</strong>
              ${o.table_number ? `<span class="muted"> · Table ${Utils.escHtml(String(o.table_number))}</span>` : ''}
              <ul style="margin:8px 0 0;padding-left:16px;font-size:13px">${(o.items||[]).map(i => `<li>${i.quantity}× ${Utils.escHtml(i.product_name)}</li>`).join('')}</ul>
              <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
              ${st === 'pending' ? `<button class="btn btn-sm btn-primary kot-advance" data-id="${o.id}" data-status="preparing">▶ Start cooking</button>` : ''}
              ${st === 'preparing' ? `<button class="btn btn-sm btn-primary kot-advance" data-id="${o.id}" data-status="ready">✓ Mark ready</button>` : ''}
              ${st === 'ready' ? `<button class="btn btn-sm btn-primary kot-advance" data-id="${o.id}" data-status="collection">→ Send to collection</button>` : ''}
              ${st === 'collection' ? `<button class="btn btn-sm btn-success kot-advance" data-id="${o.id}" data-status="completed">✓ Collected</button>` : ''}
              ${st !== 'collection' ? `<button class="btn btn-sm btn-ghost kot-advance" data-id="${o.id}" data-status="completed">Skip → Done</button>` : ''}
              </div>
            </div>`).join('') || '<p class="muted" style="padding:12px">None</p>'}
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
      document.getElementById('open-cds-from-kds')?.addEventListener('click', async () => {
        this.tab = 'customer';
        this._rerender();
      });
      document.getElementById('refresh-kds')?.addEventListener('click', () => paint());
      el.querySelectorAll('.kot-advance').forEach(b => b.addEventListener('click', async () => {
        const id = parseInt(b.dataset.id, 10);
        const status = b.dataset.status;
        b.disabled = true;
        const ok = await this.advanceOrder(id, status);
        if (ok && status === 'completed') Utils.toast('Order collected — removed from board', 'success');
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
      else if (this.tab !== 'customer') this.stopKitchenSync();
    }, 5000);
  },

  async renderCustomerFacing(el) {
    this.stopKitchenSync();
    el.innerHTML = `<div class="card"><div class="card-body">
      <h4 style="margin-top:0">Customer-facing order board</h4>
      <p class="muted">Opens a full-screen window for a second monitor or tablet facing customers. They see <strong>Preparing → Ready → Collection</strong>. Staff (or a tap on the ticket) mark <strong>Collected</strong>.</p>
      <ul class="muted" style="font-size:13px;line-height:1.6;margin:12px 0 16px;padding-left:18px">
        <li><strong>Kitchen Display</strong> — cooks advance tickets (Start / Ready / Collection).</li>
        <li><strong>Customer Facing</strong> — guests watch progress; no kitchen controls, only Collect when done.</li>
        <li>Works with mouse or touchscreen. Drag the window to the customer screen and press F11 for full screen.</li>
      </ul>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="open-cds">Open Customer Facing Window</button>
        <button class="btn btn-ghost" id="open-kds-from-cds">Open Kitchen Window</button>
        <button class="btn btn-ghost" id="refresh-cds-preview">Refresh preview</button>
      </div>
    </div></div>
    <div id="cds-preview" style="margin-top:16px">${Utils.pageSkeleton ? Utils.pageSkeleton(3) : ''}</div>`;

    const paintPreview = async () => {
      const host = document.getElementById('cds-preview');
      if (!host || this.tab !== 'customer') return;
      const res = await API.getKitchenOrders('preparing,ready,collection');
      const orders = (res.data || []).filter(o => ['preparing', 'ready', 'collection'].includes(o.status));
      const cols = ['preparing', 'ready', 'collection'];
      host.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px">
        ${cols.map(st => {
          const meta = this.statusMeta(st);
          const items = orders.filter(o => o.status === st);
          return `<div class="card" style="border-top:3px solid ${meta.color}"><div class="card-header"><h3 style="margin:0;font-size:13px">${meta.title} (${items.length})</h3></div>
            <div class="card-body" style="padding:8px;min-height:120px">
              ${items.map(o => `<div style="padding:10px;border-bottom:1px solid var(--border)">
                <strong>${Utils.escHtml(o.order_number)}</strong>
                ${st === 'collection' ? `<button class="btn btn-sm btn-success cds-collect" data-id="${o.id}" style="float:right">Collected</button>` : ''}
                <div class="muted" style="font-size:12px;margin-top:4px">${(o.items||[]).slice(0,3).map(i => `${i.quantity}× ${Utils.escHtml(i.product_name)}`).join(', ')}</div>
              </div>`).join('') || '<p class="muted" style="padding:8px">—</p>'}
            </div></div>`;
        }).join('')}
      </div>`;
      host.querySelectorAll('.cds-collect').forEach(b => b.addEventListener('click', async () => {
        await this.advanceOrder(parseInt(b.dataset.id, 10), 'completed');
        Utils.toast('Marked collected', 'success');
        paintPreview();
      }));
    };

    document.getElementById('open-cds')?.addEventListener('click', async () => {
      const native = !!(window.Capacitor?.isNativePlatform?.() || window.__SHOP_POS_MOBILE__);
      if (native && window.App?.openInAppDisplay) {
        window.App.openInAppDisplay('customer');
        return;
      }
      const r = await API.openCustomerDisplay();
      Utils.toast(r.success ? 'Customer board opened — drag to second screen' : (r.error || 'Failed'), r.success ? 'success' : 'error');
    });
    document.getElementById('open-kds-from-cds')?.addEventListener('click', async () => {
      const r = await API.openKitchenDisplay();
      Utils.toast(r.success ? 'Kitchen display opened' : (r.error || 'Failed'), r.success ? 'success' : 'error');
    });
    document.getElementById('refresh-cds-preview')?.addEventListener('click', () => paintPreview());
    await paintPreview();

    try {
      this._kdsChannel = new BroadcastChannel('shoppos-kitchen');
      this._kdsChannel.onmessage = (e) => {
        if (e.data?.type === 'refresh' && this.tab === 'customer') paintPreview();
      };
    } catch (_) {}
    this._kdsPoll = setInterval(() => {
      if (this.tab === 'customer' && el.isConnected) paintPreview();
      else if (this.tab !== 'kitchen') this.stopKitchenSync();
    }, 5000);
  },

  async renderReports(el) {
    const from = Utils.monthStart();
    const to = Utils.today();
    el.innerHTML = `<div class="card"><div class="card-body">
      ${Utils.dateFilterHTML('rest-order-filter')}
      <div id="rest-order-report" style="margin-top:16px">${Utils.pageSkeleton ? Utils.pageSkeleton(3) : ''}</div>
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
    const showCustomer = this.app.settings?.restaurant_settings?.show_customer_board !== false;
    el.innerHTML = `<div class="card"><div class="card-body"><h4>Display settings</h4>
      <div class="field"><label><input type="checkbox" id="rest-show-cds" ${showCustomer ? 'checked' : ''}> Enable customer-facing board (Preparing / Ready / Collection)</label></div>
      <h4 style="margin-top:20px">KDS notification sound</h4>
      <p class="muted">Plays when a new kitchen order arrives.</p>
      <div class="field"><label>Sound file path</label>
        <input id="kds-sound-path" value="${Utils.escHtml(soundPath)}" readonly>
        <button class="btn btn-sm btn-ghost" id="kds-pick-sound" style="margin-top:8px">Upload Sound</button>
      </div>
      <button class="btn btn-primary" id="kds-save-sound" style="margin-top:12px">Save settings</button></div></div>`;
    document.getElementById('kds-pick-sound')?.addEventListener('click', async () => {
      const pick = await API.selectDocument('doc');
      if (pick.success && pick.path) document.getElementById('kds-sound-path').value = pick.path;
    });
    document.getElementById('kds-save-sound')?.addEventListener('click', async () => {
      const path = document.getElementById('kds-sound-path').value.trim();
      const r = await API.saveKdsNotificationSound(path || null, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      const show = !!document.getElementById('rest-show-cds')?.checked;
      const rs = await API.saveJsonSetting?.('restaurant_settings', {
        ...(this.app.settings?.restaurant_settings || {}),
        show_customer_board: show
      }, this.app.user);
      this.app.settings = r.data || this.app.settings;
      if (rs?.success && rs.data) {
        this.app.settings = { ...this.app.settings, restaurant_settings: rs.data };
      } else if (this.app.settings) {
        this.app.settings.restaurant_settings = {
          ...(this.app.settings.restaurant_settings || {}),
          show_customer_board: show
        };
      }
      Utils.toast('Restaurant display settings saved', 'success');
    });
  }
};
window.RestaurantPage = RestaurantPage;

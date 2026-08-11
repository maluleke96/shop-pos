// Admin — Combos & Promotional Products
(function () {
  if (!window.AdminPage) return;

  const origRenderSection = AdminPage.renderSection.bind(AdminPage);
  AdminPage.renderSection = async function (el) {
    if (this.section === 'combos') return AdminCombosPage.render(el, this);
    return origRenderSection(el);
  };

  const AdminCombosPage = {
    async render(el, admin) {
      this.admin = admin;
      this.app = admin.app;
      this.tab = this.tab || 'list';
      const tabs = [
        ['list', 'Combos'],
        ['approvals', 'Combo Approvals'],
        ['promos', 'Promo Approvals'],
        ['recipe-promos', 'Recipe Promotions'],
        ['reports', 'Reports']
      ];
      el.innerHTML = `<div class="admin-section"><h3>Combos & Promotional Products</h3>
        <p class="muted">Managers and supervisors can create combos; admin must approve before they appear on POS. Recipe meal promotions are managed here too.</p>
        <div class="form-tabs">${tabs.map(([id, label]) =>
          `<button type="button" class="form-tab ${this.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
        <div id="combo-content"><p class="muted">Loading…</p></div></div>`;
      el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        this.render(el, admin);
      }));
      const content = document.getElementById('combo-content');
      if (this.tab === 'approvals') return this.renderComboApprovals(content);
      if (this.tab === 'promos') return this.renderPromoApprovals(content);
      if (this.tab === 'recipe-promos') return this.renderRecipePromos(content);
      if (this.tab === 'reports') return this.renderReports(content);
      return this.renderList(content);
    },

    async renderRecipePromos(el) {
      const currency = this.admin.settings?.currency || 'R';
      const res = await API.recipePromos(this.app.user);
      if (!res.success) {
        el.innerHTML = `<p class="muted">${res.error || 'Could not load recipe promotions. Open Recipe & Production if you need access.'}</p>
          <button class="btn btn-primary" id="combo-open-recipe">Open Recipe & Production</button>`;
        document.getElementById('combo-open-recipe')?.addEventListener('click', () => {
          this.app.openRecipeProduction({ fromApp: true });
        });
        return;
      }
      const promos = res.data || [];
      el.innerHTML = `<p class="muted">Recipe promotions apply to meal products on POS (same list as Recipe → Promotions).</p>
        <button class="btn btn-primary" id="combo-open-recipe" style="margin-bottom:12px">Manage in Recipe & Production</button>
        <div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Dates</th><th>Status</th></tr></thead>
          <tbody>${promos.map(p => `<tr>
            <td>${p.name}</td><td>${p.promo_type}</td>
            <td>${p.promo_type === 'percent' ? `${p.discount_value}%` : Utils.formatMoney(p.discount_value || 0, currency)}</td>
            <td>${p.start_date || '—'} → ${p.end_date || '—'}</td>
            <td><span class="tag">${p.status}</span></td>
          </tr>`).join('') || '<tr><td colspan="5" class="muted">No recipe promotions yet</td></tr>'}
          </tbody></table></div>`;
      document.getElementById('combo-open-recipe')?.addEventListener('click', () => {
        this.app.openRecipeProduction({ fromApp: true });
      });
    },

    async renderList(el) {
      const currency = this.admin.settings?.currency || 'R';
      const isOwner = this.app.user?.role === 'owner';
      const res = await API.getCombos({});
      const combos = res.data || [];
      el.innerHTML = `<button class="btn btn-primary" id="combo-new" style="margin-bottom:12px">+ New Combo</button>
        <div class="table-wrap"><table>
          <thead><tr><th>Code</th><th>Name</th><th>Normal</th><th>Final</th><th>Status</th><th>Approval</th><th>Items</th><th></th></tr></thead>
          <tbody>${combos.map(c => `<tr>
            <td>${c.combo_code}</td><td>${c.name}</td>
            <td>${Utils.formatMoney(c.normal_price, currency)}</td>
            <td>${Utils.formatMoney(c.final_price, currency)}</td>
            <td>${c.status}</td><td><span class="tag">${c.approval_status || 'approved'}</span></td><td>${(c.items || []).length}</td>
            <td><button class="btn btn-sm btn-ghost combo-edit" data-id="${c.id}">Edit</button>
            ${isOwner && c.status === 'active' ? `<button class="btn btn-sm btn-warning combo-deact" data-id="${c.id}">Deactivate</button>` : ''}
            ${isOwner && c.status !== 'active' && (c.approval_status || 'approved') === 'approved' ? `<button class="btn btn-sm btn-success combo-act" data-id="${c.id}">Activate</button>` : ''}
            </td></tr>`).join('') || '<tr><td colspan="8" class="muted">No combos yet</td></tr>'}
          </tbody></table></div>`;
      document.getElementById('combo-new').addEventListener('click', () => this.showForm());
      el.querySelectorAll('.combo-edit').forEach(b => b.addEventListener('click', async () => {
        const r = await API.getCombo(parseInt(b.dataset.id, 10));
        if (r.success) this.showForm(r.data);
      }));
      el.querySelectorAll('.combo-act').forEach(b => b.addEventListener('click', async () => {
        await API.setComboStatus(parseInt(b.dataset.id, 10), 'active', this.app.user);
        Utils.toast('Combo activated', 'success'); this.renderList(el);
      }));
      el.querySelectorAll('.combo-deact').forEach(b => b.addEventListener('click', async () => {
        await API.setComboStatus(parseInt(b.dataset.id, 10), 'inactive', this.app.user);
        Utils.toast('Combo deactivated', 'success'); this.renderList(el);
      }));
    },

    async renderComboApprovals(el) {
      const isOwner = this.app.user?.role === 'owner';
      const res = await API.getCombos({ approval_status: 'pending' });
      const pending = res.data || [];
      const currency = this.admin.settings?.currency || 'R';
      if (!isOwner) {
        el.innerHTML = `<p class="muted">Only the admin (owner) can approve combos for POS. Your submitted combos appear here as pending.</p>
          <div class="table-wrap"><table><thead><tr><th>Code</th><th>Name</th><th>Price</th><th>Status</th></tr></thead>
          <tbody>${pending.map(c => `<tr><td>${c.combo_code}</td><td>${c.name}</td>
            <td>${Utils.formatMoney(c.final_price, currency)}</td><td>pending</td></tr>`).join('')
            || '<tr><td colspan="4" class="muted">No pending combos</td></tr>'}</tbody></table></div>`;
        return;
      }
      el.innerHTML = `<h4>Pending Combo Approvals</h4>
        <p class="muted">Approve to publish on POS. Rejected combos stay as draft.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Code</th><th>Name</th><th>Price</th><th>Items</th><th></th></tr></thead>
          <tbody>${pending.map(c => `<tr>
            <td>${c.combo_code}</td><td>${c.name}</td>
            <td>${Utils.formatMoney(c.final_price, currency)}</td>
            <td>${(c.items || []).map(i => i.product_name).join(', ') || '—'}</td>
            <td>
              <button class="btn btn-sm btn-success combo-approve" data-id="${c.id}">Approve</button>
              <button class="btn btn-sm btn-danger combo-reject" data-id="${c.id}">Reject</button>
            </td></tr>`).join('') || '<tr><td colspan="5" class="muted">No pending combo approvals</td></tr>'}
          </tbody></table></div>`;
      el.querySelectorAll('.combo-approve').forEach(b => b.addEventListener('click', async () => {
        const r = await API.approveCombo(parseInt(b.dataset.id, 10), this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Combo approved and live on POS', 'success');
        this.renderComboApprovals(el);
      }));
      el.querySelectorAll('.combo-reject').forEach(b => b.addEventListener('click', async () => {
        const notes = prompt('Rejection reason (optional):') || '';
        const r = await API.rejectCombo(parseInt(b.dataset.id, 10), notes, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Combo rejected', 'success');
        this.renderComboApprovals(el);
      }));
    },

    async showForm(combo = null) {
      const c = combo || { items: [], pricing_type: 'fixed' };
      const prodRes = await API.getProducts({});
      const products = prodRes.data || [];
      const currency = this.admin.settings?.currency || 'R';
      const itemRows = (c.items || []).map((item, i) => `
        <div class="form-grid combo-item-row" data-idx="${i}">
          <div class="field"><label>Product</label><select class="ci-prod">${products.map(p =>
            `<option value="${p.id}" ${p.id == item.product_id ? 'selected' : ''}>${p.name}</option>`).join('')}</select></div>
          <div class="field"><label>Qty</label><input type="number" class="ci-qty" step="0.01" value="${item.quantity || 1}"></div>
        </div>`).join('') || `<div class="form-grid combo-item-row" data-idx="0">
          <div class="field"><label>Product</label><select class="ci-prod">${products.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
          <div class="field"><label>Qty</label><input type="number" class="ci-qty" step="0.01" value="1"></div></div>`;

      Utils.showModal(combo ? `Edit ${c.name}` : 'New Combo', `
        <div class="form-grid">
          <div class="field"><label>Name *</label><input id="cb-name" value="${c.name || ''}"></div>
          <div class="field"><label>Category Label</label><input id="cb-cat" value="${c.category || 'COMBOS'}"></div>
          <div class="field"><label>Pricing Type</label><select id="cb-ptype">
            ${['fixed', 'percent', 'fixed_discount'].map(t => `<option value="${t}" ${c.pricing_type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select></div>
          <div class="field"><label>Discount / Fixed Price</label><input type="number" id="cb-disc" step="0.01" value="${c.discount_value || c.final_price || 0}"></div>
          <div class="field"><label>Start Date</label><input type="date" id="cb-start" value="${c.start_date || ''}"></div>
          <div class="field"><label>End Date</label><input type="date" id="cb-end" value="${c.end_date || ''}"></div>
          <div class="field full"><label>Description</label><input id="cb-desc" value="${c.description || ''}"></div>
        </div>
        <h4 style="margin-top:16px">Components</h4>
        <div id="cb-items">${itemRows}</div>
        <button type="button" class="btn btn-ghost btn-sm" id="cb-add-item">+ Add Item</button>
        <p class="muted" id="cb-price-preview" style="margin-top:8px"></p>`,
        '<button class="btn btn-primary" id="cb-save">Save Combo</button>');

      const updatePreview = async () => {
        const items = [...document.querySelectorAll('.combo-item-row')].map(row => ({
          product_id: parseInt(row.querySelector('.ci-prod').value, 10),
          quantity: parseFloat(row.querySelector('.ci-qty').value) || 1
        }));
        const r = await API.calcComboPrices(items, document.getElementById('cb-ptype').value, parseFloat(document.getElementById('cb-disc').value) || 0);
        if (r.success) {
          document.getElementById('cb-price-preview').textContent =
            `Normal: ${Utils.formatMoney(r.data.normal_price, currency)} → Final: ${Utils.formatMoney(r.data.final_price, currency)}`;
        }
      };
      document.getElementById('cb-ptype').addEventListener('change', updatePreview);
      document.getElementById('cb-disc').addEventListener('input', updatePreview);
      document.querySelectorAll('.ci-prod, .ci-qty').forEach(el => el.addEventListener('change', updatePreview));
      updatePreview();

      document.getElementById('cb-add-item').addEventListener('click', () => {
        const container = document.getElementById('cb-items');
        const idx = container.querySelectorAll('.combo-item-row').length;
        const div = document.createElement('div');
        div.className = 'form-grid combo-item-row';
        div.dataset.idx = idx;
        div.innerHTML = `<div class="field"><label>Product</label><select class="ci-prod">${products.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
          <div class="field"><label>Qty</label><input type="number" class="ci-qty" step="0.01" value="1"></div>`;
        container.appendChild(div);
        div.querySelectorAll('.ci-prod, .ci-qty').forEach(el => el.addEventListener('change', updatePreview));
      });

      document.getElementById('cb-save').addEventListener('click', async () => {
        const items = [...document.querySelectorAll('.combo-item-row')].map(row => ({
          product_id: parseInt(row.querySelector('.ci-prod').value, 10),
          quantity: parseFloat(row.querySelector('.ci-qty').value) || 1
        }));
        const data = {
          id: c.id, name: document.getElementById('cb-name').value.trim(),
          category: document.getElementById('cb-cat').value.trim() || 'COMBOS',
          pricing_type: document.getElementById('cb-ptype').value,
          discount_value: parseFloat(document.getElementById('cb-disc').value) || 0,
          final_price: document.getElementById('cb-ptype').value === 'fixed' ? parseFloat(document.getElementById('cb-disc').value) || 0 : undefined,
          start_date: document.getElementById('cb-start').value || null,
          end_date: document.getElementById('cb-end').value || null,
          description: document.getElementById('cb-desc').value.trim(),
          items, status: c.status || 'draft'
        };
        if (!data.name || !items.length) return Utils.toast('Name and at least one item required', 'error');
        const r = await API.saveCombo(data, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast(this.app.user?.role === 'owner' ? 'Combo saved' : 'Combo submitted — waiting for admin approval', 'success');
        this.render(document.getElementById('admin-content'), this.admin);
      });
    },

    async renderPromoApprovals(el) {
      const isOwner = this.app.user?.role === 'owner';
      const [pendingRes, historyRes] = await Promise.all([
        API.getPendingPromoRequests(),
        API.getPromoRequestHistory({})
      ]);
      const pending = pendingRes.data || [];
      const history = historyRes.data || [];
      const currency = this.admin.settings?.currency || 'R';
      el.innerHTML = `<h4>Pending Promo Approvals</h4>
      <p class="muted">Review manager proposals from Stock → Non-Selling Products.${isOwner ? '' : ' Only the admin (owner) can approve.'}</p>
      <div class="table-wrap" style="margin-bottom:24px"><table>
        <thead><tr><th>Product</th><th>Original</th><th>Proposed</th><th>Dates</th><th>Proposed By</th><th></th></tr></thead>
        <tbody>${pending.map(r => `<tr>
          <td>${r.product_name}</td>
          <td>${Utils.formatMoney(r.original_price, currency)}</td>
          <td><strong>${Utils.formatMoney(r.proposed_price, currency)}</strong></td>
          <td>${r.start_date} → ${r.end_date}</td>
          <td>${r.proposed_by_name || '—'}</td>
          <td>${isOwner ? `
            <button class="btn btn-sm btn-success promo-approve" data-id="${r.id}">Approve</button>
            <button class="btn btn-sm btn-danger promo-reject" data-id="${r.id}">Reject</button>` : '<span class="muted">Pending</span>'}
          </td></tr>`).join('') || '<tr><td colspan="6" class="muted">No pending promo requests</td></tr>'}
        </tbody></table></div>
      <h4>Promo History</h4>
      <div class="table-wrap"><table>
        <thead><tr><th>Product</th><th>Status</th><th>Prices</th><th>Dates</th><th>Proposed By</th></tr></thead>
        <tbody>${history.slice(0, 50).map(r => `<tr>
          <td>${r.product_name}</td>
          <td><span class="tag">${r.display_status || r.status}</span></td>
          <td>${Utils.formatMoney(r.original_price, currency)} → ${Utils.formatMoney(r.proposed_price, currency)}</td>
          <td>${r.start_date} → ${r.end_date}</td>
          <td>${r.proposed_by_name || '—'}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">No promo history yet</td></tr>'}
        </tbody></table></div>`;
      if (!isOwner) return;
      el.querySelectorAll('.promo-approve').forEach(b => b.addEventListener('click', async () => {
        const r = await API.approvePromoRequest(parseInt(b.dataset.id, 10), this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Promo approved', 'success');
        this.renderPromoApprovals(el);
      }));
      el.querySelectorAll('.promo-reject').forEach(b => b.addEventListener('click', async () => {
        const reason = prompt('Rejection reason (optional):') || '';
        const r = await API.rejectPromoRequest(parseInt(b.dataset.id, 10), reason, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Promo rejected', 'success');
        this.renderPromoApprovals(el);
      }));
    },

    async renderReports(el) {
      const from = this._from || Utils.daysAgo(30);
      const to = this._to || Utils.today();
      const currency = this.admin.settings?.currency || 'R';
      const res = await API.getComboReport({ from, to });
      const report = res.data || {};
      el.innerHTML = `${Utils.extendedDateFilterHTML('combo-date', from, to)}
        <div class="stats-grid" style="margin-top:12px">
          <div class="stat-card"><div class="stat-value">${report.totals?.sold || 0}</div><div class="stat-label">Combos Sold</div></div>
          <div class="stat-card"><div class="stat-value">${Utils.formatMoney(report.totals?.revenue || 0, currency)}</div><div class="stat-label">Revenue</div></div>
          <div class="stat-card"><div class="stat-value">${Utils.formatMoney(report.totals?.profit || 0, currency)}</div><div class="stat-label">Est. Profit</div></div>
        </div>
        <div style="margin:12px 0;display:flex;gap:8px">
          <button class="btn btn-ghost" id="combo-rpt-pdf">Export PDF</button>
          <button class="btn btn-ghost" id="combo-rpt-xlsx">Export Excel</button>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Code</th><th>Name</th><th>Sold</th><th>Revenue</th><th>Profit</th></tr></thead>
          <tbody>${(report.combos || []).map(c => `<tr>
            <td>${c.combo_code}</td><td>${c.name}</td><td>${c.sold_count}</td>
            <td>${Utils.formatMoney(c.revenue, currency)}</td><td>${Utils.formatMoney(c.profit, currency)}</td>
          </tr>`).join('') || '<tr><td colspan="5" class="muted">No combo sales in period</td></tr>'}
          </tbody></table></div>`;
      Utils.bindDateFilter('combo-date', (f, t) => { this._from = f; this._to = t; this.renderReports(el); });
      document.getElementById('combo-rpt-pdf').addEventListener('click', async () => {
        const r = await API.getComboReportPdf({ from, to });
        if (r.success) await API.saveFile(`combo-report-${from}-${to}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], r.data);
      });
      document.getElementById('combo-rpt-xlsx').addEventListener('click', async () => {
        const r = await API.getComboReportExcel({ from, to });
        if (r.success) await API.saveFile(`combo-report-${from}-${to}.xlsx`, [{ name: 'Excel', extensions: ['xlsx'] }], r.data);
      });
    }
  };

  window.AdminCombosPage = AdminCombosPage;
})();

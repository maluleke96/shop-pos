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
      const existing = el.querySelector('#combo-content');
      if (!existing) {
        if (window.App?.ensurePageScripts) {
          await App.ensurePageScripts('admin');
        }
        el.innerHTML = `<div class="admin-section"><h3>Combos & Promotional Products</h3>
        <p class="muted">Managers and supervisors can create combos; admin must approve before they appear on POS. Recipe meal promotions are managed here too.</p>
        <div class="form-tabs" id="combo-tabs">${tabs.map(([id, label]) =>
          `<button type="button" class="form-tab ${this.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
        <div id="combo-content"><p class="muted">Loading…</p></div></div>`;
        el.querySelector('#combo-tabs')?.addEventListener('click', (e) => {
          const b = e.target.closest('[data-tab]');
          if (!b || b.dataset.tab === this.tab) return;
          this.tab = b.dataset.tab;
          el.querySelectorAll('#combo-tabs .form-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === this.tab));
          this.renderTabContent(document.getElementById('combo-content'));
        });
      } else {
        el.querySelectorAll('#combo-tabs .form-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === this.tab));
      }
      return this.renderTabContent(document.getElementById('combo-content'));
    },

    async renderTabContent(content) {
      if (!content) return;
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
      const res = await API.getCombos({ list_only: true });
      if (!res.success) {
        el.innerHTML = `<p class="error-msg">${Utils.escHtml(res.error || 'Could not load combos')}</p>`;
        return;
      }
      const combos = res.data || [];
      el.innerHTML = `<div class="combo-list-actions">
        <button class="btn btn-primary" id="combo-new">+ New Combo (from menu)</button>
        <button class="btn btn-primary btn-outline" id="combo-new-custom">+ Custom Combo (from scratch)</button>
      </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Code</th><th>Name</th><th>Normal</th><th>Final</th><th>Status</th><th>Approval</th><th>Items</th><th></th></tr></thead>
          <tbody>${combos.map(c => `<tr>
            <td>${c.combo_code}</td><td>${c.name}</td>
            <td>${Utils.formatMoney(c.normal_price, currency)}</td>
            <td>${Utils.formatMoney(c.final_price, currency)}</td>
            <td>${c.status}</td><td><span class="tag">${c.approval_status || 'approved'}</span></td><td>${c.item_count ?? (c.items || []).length}</td>
            <td><button class="btn btn-sm btn-ghost combo-view" data-id="${c.id}">View</button>
            <button class="btn btn-sm btn-ghost combo-edit" data-id="${c.id}">Edit</button>
            ${isOwner && c.status === 'active' ? `<button class="btn btn-sm btn-warning combo-deact" data-id="${c.id}">Deactivate</button>` : ''}
            ${isOwner && c.status !== 'active' && (c.approval_status || 'approved') === 'approved' ? `<button class="btn btn-sm btn-success combo-act" data-id="${c.id}">Activate</button>` : ''}
            ${isOwner ? `<button class="btn btn-sm btn-danger combo-del" data-id="${c.id}" data-name="${Utils.escHtml(c.name)}">Delete</button>` : ''}
            </td></tr>`).join('') || '<tr><td colspan="8" class="muted">No combos yet</td></tr>'}
          </tbody></table></div>`;
      document.getElementById('combo-new').addEventListener('click', () => this.showForm(null, { mode: 'standard' }));
      document.getElementById('combo-new-custom').addEventListener('click', () => this.showForm(null, { mode: 'custom' }));
      el.querySelectorAll('.combo-view').forEach(b => b.addEventListener('click', async () => {
        const r = await API.getCombo(parseInt(b.dataset.id, 10));
        if (r.success) this.showComboPoster(r.data);
      }));
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
      el.querySelectorAll('.combo-del').forEach(b => b.addEventListener('click', async () => {
        const name = b.dataset.name || 'this combo';
        if (!confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
        const r = await API.deleteCombo(parseInt(b.dataset.id, 10), this.app.user);
        if (r?.success === false) return Utils.toast(r.error || 'Could not delete combo', 'error');
        Utils.toast('Combo deleted', 'success');
        this.renderList(el);
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

    async comboImageSrc(pathOrId, isProduct) {
      if (!pathOrId) return null;
      const raw = String(pathOrId);
      if (raw.startsWith('data:')) return raw;
      if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/api/')) return raw;
      if (isProduct) return `/api/product-image/${pathOrId}`;
      const appUrl = `/api/app-image?p=${encodeURIComponent(raw)}`;
      try {
        const r = await API.getImageDataUrl(raw);
        return r?.dataUrl || r?.data || appUrl;
      } catch (_) { return appUrl; }
    },

    async resolveComboItemImage(i) {
      if (i.custom_image_path) {
        const src = String(i.custom_image_path);
        if (src.startsWith('data:')) return src;
        return this.comboImageSrc(src, false);
      }
      if (i.product_id) return `/api/product-image/${i.product_id}`;
      if (i.picture_path) {
        const src = String(i.picture_path);
        if (src.startsWith('data:')) return src;
        return this.comboImageSrc(src, false);
      }
      return null;
    },

    async showComboPoster(combo) {
      if (!window.PromoPoster && window.App?.ensurePageScripts) {
        await App.ensurePageScripts('admin');
      }
      if (!window.PromoPoster) return Utils.toast('Poster tool loading — try again', 'error');
      const currency = this.admin.settings?.currency || 'R';
      const shopName = this.admin.settings?.shop_name || 'Our Shop';
      let groupLink = '';
      try {
        const wa = await API.getWhatsAppSettings(this.app.user);
        groupLink = wa?.data?.business_group_link || wa?.data?.whatsapp_business_group_link || '';
      } catch (_) { /* optional */ }
      let branchLabel = 'All branches';
      if (combo.branch_id) {
        try {
          const br = await API.getBranches?.();
          const list = br?.data || br || [];
          const hit = list.find((b) => Number(b.id) === Number(combo.branch_id));
          if (hit) branchLabel = hit.name;
        } catch (_) { /* optional */ }
      }
      const items = combo.items || [];
      const itemImages = await Promise.all(items.map((i) => this.resolveComboItemImage(i)));
      const gallery = (combo.gallery_paths || []).filter(Boolean);
      const galleryUrls = (await Promise.all(gallery.map(async (g) => {
        if (String(g).startsWith('data:')) return g;
        return this.comboImageSrc(g, false);
      }))).filter(Boolean);
      let heroUrl = null;
      if (combo.image_path) {
        const raw = String(combo.image_path);
        heroUrl = raw.startsWith('data:') ? raw : await this.comboImageSrc(combo.image_path, false);
      }
      const posterSlots = [];
      const itemCount = Math.max(items.length, 1);
      for (let i = 0; i < itemCount; i++) {
        posterSlots.push(itemImages[i] || galleryUrls[i] || null);
      }
      galleryUrls.forEach((g) => {
        if (g && !posterSlots.includes(g)) posterSlots.push(g);
      });
      if (posterSlots.filter(Boolean).length === 0 && heroUrl) posterSlots.push(heroUrl);
      while (posterSlots.length < itemCount) posterSlots.push(null);
      const dateRange = combo.start_date && combo.end_date
        ? `${combo.start_date} — ${combo.end_date}`
        : (combo.start_date ? `From ${combo.start_date}` : (combo.end_date ? `Until ${combo.end_date}` : ''));
      const timeRange = combo.valid_time_start && combo.valid_time_end
        ? `${combo.valid_time_start} – ${combo.valid_time_end}`
        : '';
      const availability = [dateRange, timeRange].filter(Boolean).join(' · ');
      const msg = `🎁 *COMBO — ${shopName}*\n\n*${combo.name}*\nWas ${Number(combo.normal_price || 0).toFixed(2)} → Now *${Number(combo.final_price || 0).toFixed(2)}*\n${branchLabel}${availability ? `\n${availability}` : ''}\n\nIncludes: ${items.map((i) => i.product_name || i.custom_name).join(', ')}`;
      Utils.showModal('Building combo poster…', '<p class="muted">Preparing WhatsApp Status poster…</p>', '');
      try {
        const canvas = await PromoPoster.renderCombo({
          title: combo.name,
          wasPrice: combo.normal_price,
          nowPrice: combo.final_price,
          dateRange: availability || dateRange,
          shopName,
          shopAddress: this.admin.settings?.address || '',
          shopPhone: this.admin.settings?.phone || '',
          branchLabel,
          imageUrl: heroUrl || posterSlots.find(Boolean) || '',
          itemImages: posterSlots,
          itemCount,
          items: items.map((i) => ({ name: i.product_name || i.custom_name, qty: i.quantity })),
          description: combo.description || '',
          currency
        });
        Utils.hideModal();
        PromoPoster.showPreviewModal(canvas, {
          title: `Combo — ${combo.name}`,
          filename: `combo-${combo.combo_code || combo.id}.png`,
          groupLink,
          whatsappMessage: msg
        });
      } catch (err) {
        Utils.hideModal();
        Utils.toast(err.message || 'Could not build poster', 'error');
      }
    },

    async showForm(combo = null, opts = {}) {
      const c = combo || { items: [], pricing_type: 'fixed', show_on_pos: true, show_on_online: true };
      const isCustom = opts.mode === 'custom' || c.combo_kind === 'custom';
      const prodRes = await API.getProducts({ combo_picker: true });
      const products = prodRes.data || prodRes || [];
      const branchesRes = await API.getBranches?.().catch(() => ({ data: [] }));
      const branches = branchesRes?.data || branchesRes || [];
      const currency = this.admin.settings?.currency || 'R';
      this._comboGallery = Array.isArray(c.gallery_paths) ? [...c.gallery_paths] : [];
      this._comboHero = c.image_path || null;

      const prodThumb = (pid) => {
        if (!pid) return '<span class="combo-item-thumb ph">🍽️</span>';
        return `<img src="/api/product-image/${pid}" class="combo-item-thumb" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'combo-item-thumb ph',textContent:'🍽️'}))">`;
      };

      const standardItemRow = (item, i) => {
        const pid = item.product_id || products[0]?.id;
        const papHint = products.find((p) => String(p.id) === String(pid))?.has_pap_option;
        return `<div class="form-grid combo-item-row" data-idx="${i}">
          <div class="field combo-item-preview">${prodThumb(pid)}</div>
          <div class="field"><label>Product</label><select class="ci-prod">${products.map(p =>
            `<option value="${p.id}" ${String(p.id) === String(item.product_id) ? 'selected' : ''}>${p.name}${p.has_pap_option ? ' (pap option)' : ''}</option>`).join('')}</select></div>
          <div class="field"><label>Qty</label><input type="number" class="ci-qty" step="0.01" value="${item.quantity || 1}"></div>
          <div class="field combo-pap-field" style="min-width:150px"><label>Pap option</label>
            <label class="combo-pap-label">
              <input type="checkbox" class="ci-pap" ${item.allow_pap_choice ? 'checked' : ''} ${papHint ? '' : 'title="Product has no pap/removal modifiers"'}>
              With / without pap
            </label></div>
        </div>`;
      };

      const customItemRow = (item, i) => `<div class="form-grid combo-item-row combo-custom-row" data-idx="${i}">
          <div class="field combo-item-preview">${item.custom_image_path ? `<img src="${item.custom_image_path.startsWith('data:') ? item.custom_image_path : ''}" class="combo-item-thumb ci-custom-img" data-path="${Utils.escHtml(item.custom_image_path || '')}" alt="">` : '<span class="combo-item-thumb ph">📷</span>'}</div>
          <div class="field"><label>Item name</label><input class="ci-custom-name" value="${Utils.escHtml(item.custom_name || item.product_name || '')}" placeholder="e.g. Pap & wors"></div>
          <div class="field"><label>Qty</label><input type="number" class="ci-qty" step="0.01" value="${item.quantity || 1}"></div>
          <div class="field"><label>Photo</label>
            <div class="combo-photo-actions">
              <button type="button" class="btn btn-ghost btn-sm ci-upload">Upload</button>
              <button type="button" class="btn btn-ghost btn-sm ci-remove-photo" ${item.custom_image_path ? '' : 'hidden'}>Remove</button>
            </div></div>
        </div>`;

      const itemRows = (c.items || []).length
        ? (c.items || []).map((item, i) => isCustom ? customItemRow(item, i) : standardItemRow(item, i)).join('')
        : (isCustom ? customItemRow({}, 0) : standardItemRow({}, 0));

      const galleryThumbHtml = (g, i) =>
        `<span class="combo-gallery-slot" data-i="${i}">
          <img src="${g.startsWith('data:') ? g : ''}" class="combo-gallery-thumb" data-i="${i}" alt="">
          <button type="button" class="combo-img-remove" data-gallery-i="${i}" title="Remove photo">×</button>
        </span>`;

      const galleryHtml = this._comboGallery.map((g, i) => galleryThumbHtml(g, i)).join('');

      Utils.showModal(combo ? `Edit ${c.name}` : (isCustom ? 'Custom Combo (from scratch)' : 'New Combo'), `
        ${!combo ? `<div class="combo-mode-tabs">
          <button type="button" class="btn btn-sm ${!isCustom ? 'active' : 'btn-ghost'}" data-mode="standard">From menu products</button>
          <button type="button" class="btn btn-sm ${isCustom ? 'active' : 'btn-ghost'}" data-mode="custom">Custom from scratch</button>
        </div>` : ''}
        <div class="form-grid">
          <div class="field"><label>Name *</label><input id="cb-name" value="${Utils.escHtml(c.name || '')}"></div>
          <div class="field"><label>Category Label</label><input id="cb-cat" value="${Utils.escHtml(c.category || 'COMBOS')}"></div>
          ${isCustom ? `
          <div class="field"><label>Normal price (${currency})</label><input type="number" id="cb-normal" step="0.01" value="${c.normal_price || ''}"></div>
          <div class="field"><label>Sale price (${currency}) *</label><input type="number" id="cb-final" step="0.01" value="${c.final_price || ''}"></div>
          <div class="field"><label>Stock quantity</label><input type="number" id="cb-stock" min="0" step="1" value="${c.stock_quantity != null ? c.stock_quantity : ''}" placeholder="Unlimited if blank">
            <p class="muted" style="font-size:12px;margin:4px 0 0">How many of this custom combo can be sold.</p></div>
          ` : `
          <div class="field"><label>Pricing Type</label><select id="cb-ptype">
            ${['fixed', 'percent', 'fixed_discount'].map(t => `<option value="${t}" ${c.pricing_type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select></div>
          <div class="field"><label>Discount / Fixed Price</label><input type="number" id="cb-disc" step="0.01" value="${c.discount_value || c.final_price || 0}"></div>
          <p class="muted" style="font-size:12px;margin-top:4px">Standard combos use stock from included products automatically.</p>
          `}
          <div class="field"><label>Start Date</label><input type="date" id="cb-start" value="${c.start_date || ''}"></div>
          <div class="field"><label>End Date</label><input type="date" id="cb-end" value="${c.end_date || ''}"></div>
          <div class="field"><label>Branch</label><select id="cb-branch">
            <option value="">All branches</option>
            ${branches.map((b) => `<option value="${b.id}" ${String(c.branch_id) === String(b.id) ? 'selected' : ''}>${b.name}</option>`).join('')}
          </select></div>
          <div class="field full"><label>Show on</label>
            <label style="margin-right:16px"><input type="checkbox" id="cb-pos" ${c.show_on_pos !== 0 && c.show_on_pos !== false ? 'checked' : ''}> POS</label>
            <label><input type="checkbox" id="cb-online" ${c.show_on_online !== 0 && c.show_on_online !== false ? 'checked' : ''}> Online orders</label>
          </div>
          <div class="field full"><label>Description</label><textarea id="cb-desc" rows="2">${Utils.escHtml(c.description || '')}</textarea></div>
          <div class="field full"><label>Combo poster photo</label>
            <div class="combo-photo-actions">
              <button type="button" class="btn btn-ghost btn-sm" id="cb-hero-upload">Upload main photo</button>
              <button type="button" class="btn btn-ghost btn-sm" id="cb-hero-remove" ${this._comboHero ? '' : 'hidden'}>Remove</button>
            </div>
            <div id="cb-hero-preview" style="margin-top:6px"></div></div>
          <div class="field full"><label>Extra poster photos</label>
            <button type="button" class="btn btn-ghost btn-sm" id="cb-gallery-add">+ Add photo</button>
            <div class="combo-gallery-preview" id="cb-gallery">${galleryHtml}</div></div>
        </div>
        <h4 style="margin-top:16px">${isCustom ? 'What\'s included' : 'Components'}</h4>
        <div id="cb-items">${itemRows}</div>
        <button type="button" class="btn btn-ghost btn-sm" id="cb-add-item">+ Add Item</button>
        <p class="muted" id="cb-price-preview" style="margin-top:8px"></p>`,
        '<button class="btn btn-primary" id="cb-save">Save Combo</button>');

      document.querySelector('.modal')?.classList.add('modal-combo-form');
      const cleanupComboModal = () => document.querySelector('.modal')?.classList.remove('modal-combo-form');
      document.getElementById('cb-save')?.addEventListener('click', () => cleanupComboModal(), { once: true });
      document.getElementById('modal-close')?.addEventListener('click', cleanupComboModal, { once: true });

      const renderGallery = () => {
        const gal = document.getElementById('cb-gallery');
        if (!gal) return;
        gal.innerHTML = this._comboGallery.map((g, i) => galleryThumbHtml(g, i)).join('');
        gal.querySelectorAll('.combo-img-remove').forEach((btn) => {
          btn.addEventListener('click', () => {
            const idx = Number(btn.dataset.galleryI);
            if (!Number.isFinite(idx)) return;
            this._comboGallery.splice(idx, 1);
            renderGallery();
            hydrateGallery();
          });
        });
      };

      const renderHeroPreview = (url) => {
        const prev = document.getElementById('cb-hero-preview');
        const removeBtn = document.getElementById('cb-hero-remove');
        if (prev) {
          prev.innerHTML = url
            ? `<img src="${url}" style="max-height:64px;border-radius:8px;border:1px solid #e2e8f0">`
            : '';
        }
        if (removeBtn) removeBtn.hidden = !url;
      };

      const hydrateGallery = async () => {
        const gal = document.getElementById('cb-gallery');
        if (!gal) return;
        for (const img of gal.querySelectorAll('.combo-gallery-thumb')) {
          const i = Number(img.dataset.i);
          const path = this._comboGallery[i];
          if (path && !path.startsWith('data:')) {
            const url = await this.comboImageSrc(path, false);
            if (url) img.src = url;
          } else if (path) img.src = path;
        }
        if (this._comboHero) {
          const url = this._comboHero.startsWith('data:') ? this._comboHero : await this.comboImageSrc(this._comboHero, false);
          renderHeroPreview(url);
        } else {
          renderHeroPreview('');
        }
        for (const row of document.querySelectorAll('.combo-custom-row')) {
          const img = row.querySelector('.ci-custom-img');
          const path = row.dataset.imagePath || img?.dataset.path;
          if (path && !path.startsWith('data:') && img) {
            const url = await this.comboImageSrc(path, false);
            if (url) img.src = url;
          }
          if (path) row.dataset.imagePath = path;
        }
      };

      const collectItems = () => {
        if (isCustom) {
          return [...document.querySelectorAll('.combo-custom-row')].map((row, idx) => ({
            custom_name: row.querySelector('.ci-custom-name')?.value?.trim() || `Item ${idx + 1}`,
            custom_image_path: row.dataset.imagePath || row.querySelector('.ci-custom-img')?.dataset.path || null,
            quantity: parseFloat(row.querySelector('.ci-qty')?.value) || 1
          }));
        }
        return [...document.querySelectorAll('.combo-item-row:not(.combo-custom-row)')].map(row => ({
          product_id: parseInt(row.querySelector('.ci-prod')?.value, 10),
          quantity: parseFloat(row.querySelector('.ci-qty')?.value) || 1,
          allow_pap_choice: row.querySelector('.ci-pap')?.checked ? 1 : 0
        }));
      };

      const updatePreview = async () => {
        if (isCustom) {
          const n = parseFloat(document.getElementById('cb-normal')?.value) || 0;
          const f = parseFloat(document.getElementById('cb-final')?.value) || 0;
          document.getElementById('cb-price-preview').textContent =
            `Your price: ${Utils.formatMoney(f || n, currency)}${n && f && f < n ? ` (was ${Utils.formatMoney(n, currency)})` : ''}`;
          return;
        }
        const items = collectItems();
        const r = await API.calcComboPrices(items, document.getElementById('cb-ptype').value, parseFloat(document.getElementById('cb-disc').value) || 0);
        if (r.success) {
          document.getElementById('cb-price-preview').textContent =
            `Normal: ${Utils.formatMoney(r.data.normal_price, currency)} → Final: ${Utils.formatMoney(r.data.final_price, currency)}`;
        }
      };

      document.querySelectorAll('.combo-mode-tabs [data-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          Utils.hideModal();
          this.showForm(null, { mode: btn.dataset.mode });
        });
      });

      document.getElementById('cb-hero-upload')?.addEventListener('click', async () => {
        const r = await API.selectImage('combo-hero');
        if (r?.cancelled || !r?.success || !r.path) return;
        this._comboHero = r.path;
        renderHeroPreview(r.dataUrl || r.path);
      });

      document.getElementById('cb-hero-remove')?.addEventListener('click', () => {
        this._comboHero = null;
        renderHeroPreview('');
      });

      document.getElementById('cb-gallery-add')?.addEventListener('click', async () => {
        const r = await API.selectImage('combo-gallery');
        if (r?.cancelled || !r?.success || !r.path) return;
        this._comboGallery.push(r.path);
        renderGallery();
        hydrateGallery();
      });

      renderGallery();

      const bindRow = (row) => {
        row.querySelector('.ci-prod')?.addEventListener('change', (e) => {
          const preview = row.querySelector('.combo-item-preview');
          if (preview) preview.innerHTML = prodThumb(e.target.value);
          updatePreview();
        });
        row.querySelector('.ci-qty')?.addEventListener('change', updatePreview);
        row.querySelector('.ci-upload')?.addEventListener('click', async () => {
          const r = await API.selectImage('combo-item');
          if (r?.cancelled || !r?.success || !r.path) return;
          row.dataset.imagePath = r.path;
          const preview = row.querySelector('.combo-item-preview');
          if (preview) preview.innerHTML = `<img src="${r.dataUrl || r.path}" class="combo-item-thumb ci-custom-img" alt="">`;
          const removeBtn = row.querySelector('.ci-remove-photo');
          if (removeBtn) removeBtn.hidden = false;
        });
        row.querySelector('.ci-remove-photo')?.addEventListener('click', () => {
          delete row.dataset.imagePath;
          const preview = row.querySelector('.combo-item-preview');
          if (preview) preview.innerHTML = '<span class="combo-item-thumb ph">📷</span>';
          const removeBtn = row.querySelector('.ci-remove-photo');
          if (removeBtn) removeBtn.hidden = true;
        });
      };

      document.querySelectorAll('.combo-item-row').forEach(bindRow);
      if (!isCustom) {
        document.getElementById('cb-ptype')?.addEventListener('change', updatePreview);
        document.getElementById('cb-disc')?.addEventListener('input', updatePreview);
      } else {
        document.getElementById('cb-normal')?.addEventListener('input', updatePreview);
        document.getElementById('cb-final')?.addEventListener('input', updatePreview);
      }
      updatePreview();
      hydrateGallery();

      document.getElementById('cb-add-item').addEventListener('click', () => {
        const container = document.getElementById('cb-items');
        const idx = container.querySelectorAll('.combo-item-row').length;
        const div = document.createElement('div');
        if (isCustom) {
          div.className = 'form-grid combo-item-row combo-custom-row';
          div.dataset.idx = idx;
          div.innerHTML = `<div class="field combo-item-preview"><span class="combo-item-thumb ph">📷</span></div>
            <div class="field"><label>Item name</label><input class="ci-custom-name" placeholder="Item name"></div>
            <div class="field"><label>Qty</label><input type="number" class="ci-qty" step="0.01" value="1"></div>
            <div class="field"><label>Photo</label>
              <div class="combo-photo-actions">
                <button type="button" class="btn btn-ghost btn-sm ci-upload">Upload</button>
                <button type="button" class="btn btn-ghost btn-sm ci-remove-photo" hidden>Remove</button>
              </div></div>`;
        } else {
          div.className = 'form-grid combo-item-row';
          div.dataset.idx = idx;
          const firstPid = products[0]?.id || '';
          div.innerHTML = `<div class="field combo-item-preview">${prodThumb(firstPid)}</div>
            <div class="field"><label>Product</label><select class="ci-prod">${products.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
            <div class="field"><label>Qty</label><input type="number" class="ci-qty" step="0.01" value="1"></div>
            <div class="field" style="min-width:150px"><label>Pap option</label>
              <label class="combo-pap-label">
                <input type="checkbox" class="ci-pap"> With / without pap</label></div>`;
        }
        container.appendChild(div);
        bindRow(div);
      });

      document.getElementById('cb-save').addEventListener('click', async () => {
        const items = collectItems();
        const data = {
          id: c.id,
          combo_kind: isCustom ? 'custom' : 'standard',
          name: document.getElementById('cb-name').value.trim(),
          category: document.getElementById('cb-cat').value.trim() || 'COMBOS',
          pricing_type: isCustom ? 'fixed' : document.getElementById('cb-ptype').value,
          discount_value: isCustom ? 0 : (parseFloat(document.getElementById('cb-disc').value) || 0),
          normal_price: isCustom ? (parseFloat(document.getElementById('cb-normal')?.value) || 0) : undefined,
          final_price: isCustom ? (parseFloat(document.getElementById('cb-final')?.value) || 0) : (document.getElementById('cb-ptype')?.value === 'fixed' ? parseFloat(document.getElementById('cb-disc')?.value) || 0 : undefined),
          start_date: document.getElementById('cb-start').value || null,
          end_date: document.getElementById('cb-end').value || null,
          branch_id: document.getElementById('cb-branch')?.value ? parseInt(document.getElementById('cb-branch').value, 10) : null,
          show_on_pos: document.getElementById('cb-pos')?.checked ? 1 : 0,
          show_on_online: document.getElementById('cb-online')?.checked ? 1 : 0,
          description: document.getElementById('cb-desc').value.trim(),
          image_path: this._comboHero ?? null,
          gallery_paths: this._comboGallery || [],
          stock_quantity: isCustom ? (document.getElementById('cb-stock')?.value ?? '') : null,
          items,
          status: this.app.user?.role === 'owner' ? 'active' : (c.status || 'draft')
        };
        if (!data.name || !items.length) return Utils.toast('Name and at least one item required', 'error');
        if (isCustom && !data.final_price) return Utils.toast('Enter your combo sale price', 'error');
        const r = await API.saveCombo(data, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast(this.app.user?.role === 'owner' ? 'Combo saved' : 'Combo submitted — waiting for admin approval', 'success');
        this.render(document.getElementById('admin-content'), this.admin);
      });
    },

    async renderPromoApprovals(el) {
      const isOwner = this.app.user?.role === 'owner';
      const from = this._promoFrom || Utils.daysAgo(30);
      const to = this._promoTo || Utils.today();
      const [pendingRes, historyRes, salesRes] = await Promise.all([
        API.getPendingPromoRequests(),
        API.getPromoRequestHistory({}),
        API.getPromoSalesLog({ from, to }).catch(() => ({ data: [] }))
      ]);
      const pending = pendingRes.data || [];
      const history = historyRes.data || [];
      const salesLog = salesRes.data || [];
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
        </tbody></table></div>
      <h4 style="margin-top:24px">Promo Sales Report</h4>
      ${Utils.extendedDateFilterHTML('promo-sales-date', from, to)}
      <div style="margin:8px 0;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="promo-export-csv">Export CSV</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Product</th><th>Receipt</th><th>Qty</th><th>Unit</th><th>Total</th><th>Date</th></tr></thead>
        <tbody>${salesLog.slice(0, 100).map((r) => `<tr>
          <td>${Utils.escHtml(r.product_name || '—')}</td>
          <td>${Utils.escHtml(r.receipt_number || '—')}</td>
          <td>${r.quantity || 1}</td>
          <td>${Utils.formatMoney(r.unit_price, currency)}</td>
          <td>${Utils.formatMoney(r.line_total ?? r.total, currency)}</td>
          <td>${Utils.formatDateTime(r.sale_date || r.created_at)}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No promo sales in period</td></tr>'}
        </tbody></table></div>`;
      Utils.bindDateFilter('promo-sales-date', (f, t) => { this._promoFrom = f; this._promoTo = t; this.renderPromoApprovals(el); });
      document.getElementById('promo-export-csv')?.addEventListener('click', () => {
        const rows = [['Product', 'Receipt', 'Qty', 'Unit', 'Total', 'Date'],
          ...salesLog.map((r) => [
            r.product_name || '', r.receipt_number || '', r.quantity || 1,
            r.unit_price ?? '', r.line_total ?? r.total ?? '', r.sale_date || r.created_at || ''
          ])];
        const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = `promo-sales-${from}-${to}.csv`;
        a.click();
        Utils.toast('Promo report exported', 'success');
      });
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
          <thead><tr><th>Code</th><th>Name</th><th>Sold</th><th>Revenue</th><th>Profit</th><th></th></tr></thead>
          <tbody>${(report.combos || []).map(c => `<tr>
            <td>${c.combo_code}</td><td>${c.name}</td><td>${c.sold_count}</td>
            <td>${Utils.formatMoney(c.revenue, currency)}</td><td>${Utils.formatMoney(c.profit, currency)}</td>
            <td class="actions" style="white-space:nowrap">
              <button class="btn btn-sm btn-ghost combo-rpt-edit" data-id="${c.id || c.combo_id || ''}">Edit</button>
              <button class="btn btn-sm btn-danger combo-rpt-del" data-id="${c.id || c.combo_id || ''}" data-name="${Utils.escHtml(c.name || '')}">Delete</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="6" class="muted">No combo sales in period</td></tr>'}
          </tbody></table></div>`;
      Utils.bindDateFilter('combo-date', (f, t) => { this._from = f; this._to = t; this.renderReports(el); });
      el.querySelectorAll('.combo-rpt-edit').forEach((b) => {
        b.addEventListener('click', async () => {
          const id = Number(b.dataset.id);
          if (!id) return Utils.toast('Combo ID not found in report row', 'error');
          const r = await API.getCombo(id);
          if (!r.success) return Utils.toast(r.error || 'Could not load combo', 'error');
          this.tab = 'list';
          const shell = document.getElementById('admin-content');
          if (shell) await this.render(shell, this.admin);
          this.showForm(r.data);
        });
      });
      el.querySelectorAll('.combo-rpt-del').forEach((b) => {
        b.addEventListener('click', async () => {
          const id = Number(b.dataset.id);
          if (!id) return Utils.toast('Combo ID not found', 'error');
          if (!confirm(`Delete combo "${b.dataset.name || id}"?`)) return;
          const r = await API.deleteCombo(id, this.app.user);
          if (r?.success === false) return Utils.toast(r.error || 'Could not delete', 'error');
          Utils.toast('Combo deleted', 'success');
          this.renderReports(el);
        });
      });
      document.getElementById('combo-rpt-pdf').addEventListener('click', async () => {
        await Utils.savePdfBuffer(`combo-report-${from}-${to}.pdf`, await API.getComboReportPdf({ from, to }));
      });
      document.getElementById('combo-rpt-xlsx').addEventListener('click', async () => {
        const r = await API.getComboReportExcel({ from, to });
        if (r.success) await API.saveFile(`combo-report-${from}-${to}.xlsx`, [{ name: 'Excel', extensions: ['xlsx'] }], r.data);
      });
    }
  };

  window.AdminCombosPage = AdminCombosPage;
})();

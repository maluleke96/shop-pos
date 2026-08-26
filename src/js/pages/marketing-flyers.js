// Marketing — Flyer Campaign System
const MarketingFlyersPage = {
  tab: 'campaigns',
  view: 'list',
  step: 1,
  quickStep: 1,
  draft: null,
  products: [],
  categories: [],
  branches: [],
  templates: [],
  flyers: [],
  dashboard: null,
  brandKit: null,
  filters: { status: '', branch_id: '', date_from: '', date_to: '' },
  dragState: null,
  /** When set (e.g. Marketing Agent shell), keep studio inside that host instead of POS #page-content */
  hostEl: null,

  resolveRoot(el) {
    if (this.hostEl && this.hostEl.isConnected) return this.hostEl;
    if (el && el.isConnected) return el;
    return document.getElementById('page-content') || el;
  },

  FLYER_SIZES: {
    a4_portrait: { w: 210, h: 297, label: 'A4 Portrait' },
    a4_landscape: { w: 297, h: 210, label: 'A4 Landscape' },
    a3: { w: 297, h: 420, label: 'A3' },
    a2: { w: 420, h: 594, label: 'A2' },
    poster: { w: 420, h: 594, label: 'Poster' },
    social_square: { w: 1080, h: 1080, label: 'Social Square', px: true },
    instagram_post: { w: 1080, h: 1080, label: 'Instagram Post', px: true },
    tiktok: { w: 1080, h: 1920, label: 'TikTok', px: true },
    twitter: { w: 1200, h: 675, label: 'X / Twitter', px: true },
    facebook_cover: { w: 820, h: 312, label: 'Facebook Cover', px: true },
    instagram_story: { w: 1080, h: 1920, label: 'Instagram Story', px: true },
    whatsapp_status: { w: 1080, h: 1920, label: 'WhatsApp Status', px: true }
  },

  SOCIAL_EXPORT: {
    whatsapp_status: 'whatsapp_status',
    instagram: 'instagram_post',
    facebook: 'facebook_cover',
    tiktok: 'tiktok'
  },

  STATUS_LABELS: {
    draft: 'Draft', pending: 'Pending', approved: 'Approved', live: 'Live', ended: 'Ended'
  },

  GOAL_LABELS: {
    all: 'All channels', print: 'Print', whatsapp: 'WhatsApp', social: 'Social'
  },

  goalLabel(goal) {
    return this.GOAL_LABELS[goal] || goal || 'All channels';
  },

  goalOptions(selected) {
    return Object.entries(this.GOAL_LABELS).map(([k, v]) =>
      `<option value="${k}" ${selected === k ? 'selected' : ''}>${v}</option>`).join('');
  },

  emptyDraft(brandKit) {
    const kit = brandKit || this.brandKit || {};
    return {
      id: null, title: '', promotion_name: '', branch_id: null,
      start_date: Utils.today(), end_date: '', flyer_size: 'a4_portrait',
      status: 'draft', apply_pos_prices: false, approval_status: 'draft',
      campaign_goal: 'all', go_live_mode: 'both', auto_go_live: true,
      products: [], combos: [], canvas: {
        headline: '', background: kit.primary_color || '#e11d48',
        terms: kit.default_terms || 'Prices include VAT where applicable. While stocks last.',
        elements: [], useRetailLayout: true, templateId: 'birthday'
      },
      branding: { primary_color: kit.primary_color, secondary_color: kit.secondary_color, font_style: kit.font_style }
    };
  },

  calcPromoPrice(normal, promo) {
    const base = Number(normal) || 0;
    const type = promo?.promo_type || 'special';
    if (type === 'special') return Number(promo.special_price) || base;
    if (type === 'percent') return base * (1 - (Number(promo.discount_percent) || 0) / 100);
    if (type === 'fixed') return Math.max(0, base - (Number(promo.discount_amount) || 0));
    return base;
  },

  productImagePath(p) {
    return p?.picture_path || p?.image_path || p?.photo_path || '';
  },

  renderProductThumb(p) {
    const src = this.productImagePath(p);
    return src
      ? `<img data-image-path="${src}" class="fly-prod-thumb" alt="">`
      : `<span class="fly-prod-thumb fly-prod-thumb-empty">📦</span>`;
  },

  displayStatus(f) {
    return f.display_status || f.status || 'draft';
  },

  statusPill(status) {
    const cls = { draft: 'muted', pending: 'warning', approved: 'info', live: 'success', ended: 'muted' }[status] || 'muted';
    return `<span class="campaign-status-pill campaign-status-${status} tag tag-${cls}">${this.STATUS_LABELS[status] || status}</span>`;
  },

  canApprove(user) {
    return ['owner', 'manager'].includes(user?.role);
  },

  canGoLive(user) {
    return ['owner', 'manager'].includes(user?.role);
  },

  canEndCampaign(user) {
    return ['owner', 'manager'].includes(user?.role);
  },

  async render(el, app) {
    this.app = app;
    this.currency = app.settings?.currency || 'R';
    if (!['owner', 'manager', 'marketing_agent'].includes(app.user?.role)) {
      el.innerHTML = '<p class="muted">Marketing campaigns are available to owner, manager, and marketing agent.</p>';
      return;
    }
    if (this.view === 'quick') return this.renderQuickWizard(el);
    if (this.view === 'list') return this.renderLanding(el);
    if (!this.brandKit) {
      const kitRes = await API.getBrandKit().catch(() => ({ success: false }));
      this.brandKit = kitRes.success ? kitRes.data : null;
    }
    if (!this.draft) {
      this.draft = this.emptyDraft(this.brandKit);
      this.step = 1;
    }
    this.view = 'wizard';
    return this.renderWizard(el);
  },

  async renderLanding(el) {
    if (!this.branches.length) {
      const brRes = await API.getBranches();
      this.branches = brRes.data || [];
    }
    if (!this.brandKit) {
      const kitRes = await API.getBrandKit().catch(() => ({ success: false }));
      this.brandKit = kitRes.success ? kitRes.data : null;
    }
    if (!this.dashboard) {
      const dashRes = await API.getCampaignDashboard().catch(() => ({ success: false }));
      this.dashboard = dashRes.success ? dashRes.data : null;
    }

    el.innerHTML = `<div class="page-toolbar">
      <h3>Marketing Campaigns</h3>
    </div>
    <div class="campaign-tabs form-tabs" style="margin-bottom:16px">
      ${[['campaigns', 'Campaigns'], ['brand', 'Brand Kit']].map(([k, label]) =>
        `<button type="button" class="form-tab campaign-tab ${this.tab === k ? 'active' : ''}" data-tab="${k}">${label}</button>`).join('')}
    </div>
    <div id="campaign-tab-panel"></div>`;

    el.querySelectorAll('.campaign-tab').forEach(btn => btn.addEventListener('click', async () => {
      const next = btn.dataset.tab;
      if (this.tab === next && this.view === 'list') return;
      this.tab = next;
      el.querySelectorAll('.campaign-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === next));
      const panel = document.getElementById('campaign-tab-panel');
      panel.innerHTML = Utils.pageSkeleton(3);
      if (this.tab === 'campaigns') await this.renderCampaignsTab(panel);
      else if (this.tab === 'brand') await this.renderBrandKitTab(panel);
    }));

    if (this.tab === 'quick' || this.tab === 'studio') this.tab = 'campaigns';
    const panel = document.getElementById('campaign-tab-panel');
    if (this.tab === 'campaigns') await this.renderCampaignsTab(panel);
    else if (this.tab === 'brand') await this.renderBrandKitTab(panel);
  },

  showNewCampaignModal(el) {
    Utils.showModal('New Campaign', `
      <p class="muted">Choose how to create your promotion.</p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
        <button type="button" class="btn btn-primary" id="nc-quick">Quick Flyer — 3-step wizard</button>
        <button type="button" class="btn btn-ghost" id="nc-studio">Full Design Studio — advanced layout</button>
      </div>`, '');
    document.getElementById('nc-quick')?.addEventListener('click', () => {
      Utils.hideModal();
      this.draft = this.emptyDraft(this.brandKit);
      this.quickStep = 1;
      this.view = 'quick';
      const root = this.resolveRoot(el);
      this.render(root, this.app);
    });
    document.getElementById('nc-studio')?.addEventListener('click', async () => {
      Utils.hideModal();
      await Utils.loadScript('js/pages/marketing-flyers-studio.js').catch(() => {});
      this.draft = this.emptyDraft(this.brandKit);
      this.step = 1;
      this.view = 'wizard';
      const root = this.resolveRoot(el);
      this.render(root, this.app);
    });
  },

  renderCampaignActions(f, st) {
    const approval = f.approval_status || 'draft';
    const canSubmit = ['draft', 'rejected'].includes(approval) && st !== 'ended';
    const menuItems = [
      { action: 'share', label: 'Share' },
      { action: 'pdf', label: 'PDF' },
      { action: 'analytics', label: 'Analytics' },
      { action: 'dup', label: 'Duplicate' },
      { action: 'edit', label: 'Quick Edit' },
      { action: 'dochub', label: 'View in Document Hub' }
    ];
    if (canSubmit) menuItems.push({ action: 'submit', label: 'Submit' });
    if (this.canApprove(this.app.user) && st === 'pending') {
      menuItems.push({ action: 'approve', label: 'Approve', cls: 'success' });
      menuItems.push({ action: 'reject', label: 'Reject', cls: 'danger' });
    }
    menuItems.push({ action: 'del', label: 'Delete', cls: 'danger' });
    const menuHtml = menuItems.map(item =>
      `<button type="button" class="campaign-action-item fly-menu-action${item.cls ? ` text-${item.cls}` : ''}" data-id="${f.id}" data-action="${item.action}"${item.action === 'del' ? ` data-owner="${f.created_by || ''}" data-owner-name="${Utils.escHtml(f.created_by_name || '')}"` : ''}>${item.label}</button>`
    ).join('');
    return `<td class="campaign-actions">
      <button class="btn btn-sm btn-primary fly-design" data-id="${f.id}">Design</button>
      ${this.canGoLive(this.app.user) && st === 'approved' ? `<button class="btn btn-sm btn-success fly-golive" data-id="${f.id}">Go Live</button>` : ''}
      ${this.canEndCampaign(this.app.user) && st === 'live' ? `<button class="btn btn-sm btn-warning fly-end" data-id="${f.id}">End</button>` : ''}
      <div class="campaign-actions-menu">
        <button type="button" class="btn btn-sm btn-ghost campaign-actions-toggle" data-id="${f.id}">Actions ▾</button>
        <div class="campaign-actions-dropdown hidden" data-menu-id="${f.id}">${menuHtml}</div>
      </div>
    </td>`;
  },

  viewInDocumentHub(flyerId) {
    if (window.DocumentHubPage) DocumentHubPage.pendingFlyerId = flyerId;
    this.app.navigate('document-hub');
  },

  async renderCampaignsTab(el) {
    const filters = {};
    if (this.filters.branch_id) filters.branch_id = parseInt(this.filters.branch_id, 10);
    const flyRes = await API.getFlyers(filters);
    let flyers = flyRes.data || [];
    if (this.filters.status) flyers = flyers.filter(f => this.displayStatus(f) === this.filters.status);
    if (this.filters.date_from) flyers = flyers.filter(f => !f.start_date || f.start_date >= this.filters.date_from);
    if (this.filters.date_to) flyers = flyers.filter(f => !f.end_date || f.end_date <= this.filters.date_to);
    this.flyers = flyers;
    const dash = this.dashboard || {};
    const role = this.app.user?.role;

    el.innerHTML = `${dash.live != null ? `<div class="campaign-dash-cards">
      ${[['draft', dash.draft], ['pending', dash.pending], ['approved', dash.approved], ['live', dash.live], ['ended', dash.ended]].map(([k, n]) =>
        `<div class="campaign-dash-card"><span class="campaign-dash-num">${n || 0}</span><span class="campaign-dash-label">${this.STATUS_LABELS[k]}</span></div>`).join('')}
      <div class="campaign-dash-card campaign-dash-revenue"><span class="campaign-dash-num">${Utils.formatMoney(dash.total_live_revenue || 0, this.currency)}</span><span class="campaign-dash-label">Live Revenue</span></div>
    </div>` : ''}
    <div class="page-toolbar" style="margin-bottom:12px">
      <button class="btn btn-primary" id="campaign-new">+ New Campaign</button>
    </div>
    <div class="campaign-filters card" style="margin-bottom:12px"><div class="card-body" style="display:flex;flex-wrap:wrap;gap:10px;align-items:end">
      <div class="field"><label>Status</label><select id="cf-status">
        <option value="">All</option>
        ${Object.entries(this.STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${this.filters.status === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select></div>
      <div class="field"><label>Branch</label><select id="cf-branch"><option value="">All</option>
        ${this.branches.map(b => `<option value="${b.id}" ${String(this.filters.branch_id) === String(b.id) ? 'selected' : ''}>${b.name}</option>`).join('')}
      </select></div>
      <div class="field"><label>From</label><input type="date" id="cf-from" value="${this.filters.date_from || ''}"></div>
      <div class="field"><label>To</label><input type="date" id="cf-to" value="${this.filters.date_to || ''}"></div>
      <button class="btn btn-primary btn-sm" id="cf-apply">Filter</button>
    </div></div>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Title</th><th>Goal</th><th>Branch</th><th>Dates</th><th>Status</th><th></th></tr></thead>
      <tbody>${flyers.map(f => {
        const st = this.displayStatus(f);
        const branch = this.branches.find(b => b.id == f.branch_id);
        const agentHint = role === 'marketing_agent' && st === 'approved'
          ? '<br><small class="muted">Awaiting manager to go live</small>' : '';
        return `<tr>
          <td>${f.flyer_number || '—'}</td>
          <td><strong>${f.title}</strong>${f.promotion_name ? `<br><small class="muted">${f.promotion_name}</small>` : ''}</td>
          <td>${this.goalLabel(f.campaign_goal)}</td>
          <td>${branch?.name || 'All'}</td>
          <td>${f.start_date || '—'} → ${f.end_date || '—'}</td>
          <td>${this.statusPill(st)}${agentHint}</td>
          ${this.renderCampaignActions(f, st)}</tr>`;
      }).join('') || '<tr><td colspan="7" class="muted">No campaigns yet — click <strong>+ New Campaign</strong> to create a Quick Flyer or open the Design Studio</td></tr>'}
      </tbody></table></div>`;

    document.getElementById('campaign-new')?.addEventListener('click', () => this.showNewCampaignModal(el));

    document.getElementById('cf-apply')?.addEventListener('click', () => {
      this.filters.status = document.getElementById('cf-status').value;
      this.filters.branch_id = document.getElementById('cf-branch').value;
      this.filters.date_from = document.getElementById('cf-from').value;
      this.filters.date_to = document.getElementById('cf-to').value;
      this.renderCampaignsTab(el);
    });

    this.bindCampaignActions(el);
  },

  bindCampaignActions(el) {
    const root = this.resolveRoot(el);
    const closeMenus = () => el.querySelectorAll('.campaign-actions-dropdown').forEach(m => m.classList.add('hidden'));
    el.querySelectorAll('.campaign-actions-toggle').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = el.querySelector(`.campaign-actions-dropdown[data-menu-id="${btn.dataset.id}"]`);
      const wasHidden = menu?.classList.contains('hidden');
      closeMenus();
      if (wasHidden) menu?.classList.remove('hidden');
    }));
    if (!this._campaignMenuBound) {
      this._campaignMenuBound = true;
      document.addEventListener('click', closeMenus);
    }
    el.querySelectorAll('.fly-design').forEach(b => b.addEventListener('click', () => this.openFlyer(parseInt(b.dataset.id, 10), root, 2)));
    el.querySelectorAll('.fly-menu-action').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      closeMenus();
      const id = parseInt(b.dataset.id, 10);
      const action = b.dataset.action;
      if (action === 'edit') return this.openFlyer(id, root);
      if (action === 'dup') {
        const r = await API.duplicateFlyer(id, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Campaign duplicated', 'success');
        return this.render(root, this.app);
      }
      if (action === 'pdf') return this.downloadPdf(id);
      if (action === 'share') return this.showShareModal(id);
      if (action === 'analytics') return this.showAnalyticsPanel(id);
      if (action === 'dochub') return this.viewInDocumentHub(id);
      if (action === 'submit') {
        const r = await API.submitFlyerApproval(id, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Submitted for approval', 'success');
        return this.render(root, this.app);
      }
      if (action === 'approve') {
        const r = await API.approveFlyer(id, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Campaign approved', 'success');
        return this.render(root, this.app);
      }
      if (action === 'reject') {
        const notes = prompt('Rejection reason (optional):') || '';
        const r = await API.rejectFlyer(id, this.app.user, notes);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Campaign rejected', 'success');
        return this.render(root, this.app);
      }
      if (action === 'del') {
        let actor = this.app.user;
        const ownerId = b.dataset.owner ? parseInt(b.dataset.owner, 10) : null;
        if (AdminOverride.needsOverrideReason(this.app.user, ownerId)) {
          const guard = await AdminOverride.guardAction(this.app.user, 'Delete Campaign', ownerId, b.dataset.ownerName || '');
          if (!guard.ok) return;
          actor = AdminOverride.actorWithOverride(this.app.user, guard.override_reason);
        }
        if (!confirm('Delete this campaign?')) return;
        const r = await API.deleteFlyer(id, actor);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Deleted', 'success');
        return this.render(root, this.app);
      }
    }));
    el.querySelectorAll('.fly-golive').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Go live? Promo prices will apply to POS (max 2 live campaigns).')) return;
      const r = await API.goLiveFlyer(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Campaign is now live!', 'success');
      this.render(root, this.app);
    }));
    el.querySelectorAll('.fly-end').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('End this campaign and restore original POS prices?')) return;
      const r = await API.endCampaign(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Campaign ended', 'success');
      this.render(root, this.app);
    }));
  },

  async renderQuickFlyerTab(el) {
    el.innerHTML = `<div class="card"><div class="card-body">
      <h4 style="margin:0 0 8px">Quick Flyer Wizard</h4>
      <p class="muted">Create a promotion in 3 steps — name, products, template — then optionally open the full Design Studio.</p>
      <button class="btn btn-primary" id="quick-start">Start Quick Flyer</button>
    </div></div>`;
    document.getElementById('quick-start').addEventListener('click', () => {
      this.draft = this.emptyDraft(this.brandKit);
      this.quickStep = 1;
      this.view = 'quick';
      const root = this.resolveRoot(el);
      this.render(root, this.app);
    });
  },

  async renderQuickWizard(el) {
    const d = this.draft || this.emptyDraft(this.brandKit);
    this.draft = d;
    if (!this.branches.length) {
      const br = await API.getBranches();
      this.branches = br.data || [];
    }
    const steps = [['1', 'Details'], ['2', 'Products & Prices'], ['3', 'Template']];
    el.innerHTML = `<div class="page-toolbar">
      <button class="btn btn-ghost" id="quick-back">← Back</button>
      <h3>Quick Flyer — Step ${this.quickStep} of 3</h3>
    </div>
    <div class="form-tabs" style="margin-bottom:16px">${steps.map(([n, label]) =>
      `<span class="form-tab ${this.quickStep === parseInt(n, 10) ? 'active' : ''}">${label}</span>`).join('')}</div>
    <div id="quick-step-content"></div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:space-between">
      <button class="btn btn-ghost" id="quick-prev" ${this.quickStep <= 1 ? 'disabled' : ''}>Previous</button>
      <button class="btn btn-primary" id="quick-next">${this.quickStep >= 3 ? 'Save Draft' : 'Next'}</button>
    </div>`;

    document.getElementById('quick-back').addEventListener('click', () => {
      this.view = 'list';
      this.tab = 'campaigns';
      this.render(el, this.app);
    });
    document.getElementById('quick-prev').addEventListener('click', () => {
      this.syncQuickFromDom();
      this.quickStep = Math.max(1, this.quickStep - 1);
      this.renderQuickWizard(el);
    });
    document.getElementById('quick-next').addEventListener('click', async () => {
      this.syncQuickFromDom();
      if (this.quickStep >= 3) {
        await this.finishQuickFlyer(el);
        return;
      }
      if (this.quickStep === 1 && !d.title?.trim()) return Utils.toast('Campaign name is required', 'error');
      if (this.quickStep === 1 && !d.end_date) return Utils.toast('End date is required', 'error');
      this.quickStep++;
      this.renderQuickWizard(el);
    });

    const content = document.getElementById('quick-step-content');
    if (this.quickStep === 1) this.renderQuickStep1(content);
    else if (this.quickStep === 2) await this.renderQuickStep2(content);
    else await this.renderQuickStep3(content);
  },

  syncQuickFromDom() {
    const d = this.draft;
    if (!d) return;
    if (this.quickStep === 1) {
      d.title = document.getElementById('qf-title')?.value.trim() || d.title;
      d.promotion_name = document.getElementById('qf-promo')?.value.trim() || '';
      d.branch_id = parseInt(document.getElementById('qf-branch')?.value, 10) || null;
      d.start_date = document.getElementById('qf-start')?.value || d.start_date;
      d.end_date = document.getElementById('qf-end')?.value || '';
      d.campaign_goal = document.getElementById('qf-goal')?.value || 'all';
      d.go_live_mode = document.getElementById('qf-golive-mode')?.value || 'both';
      d.auto_go_live = document.getElementById('qf-auto-golive')?.checked !== false;
    } else if (this.quickStep === 2) {
      d.products.forEach((p, i) => {
        const row = document.querySelector(`.qf-price-row[data-idx="${i}"]`);
        if (!row) return;
        p.promo_type = row.querySelector('.fp-type')?.value || 'percent';
        p.discount_percent = parseFloat(row.querySelector('.fp-pct')?.value) || 10;
        p.special_price = parseFloat(row.querySelector('.fp-special')?.value) || p.normal_price;
      });
    } else if (this.quickStep === 3) {
      const tpl = document.querySelector('.qf-tpl.selected');
      if (tpl) {
        d.canvas.background = tpl.dataset.bg || d.canvas.background;
        d.canvas.headline = tpl.dataset.headline || d.title;
      }
    }
  },

  renderQuickStep1(el) {
    const d = this.draft;
    el.innerHTML = `<div class="form-grid">
      <div class="field"><label>Campaign Name *</label><input id="qf-title" value="${d.title || ''}" placeholder="Weekend Specials"></div>
      <div class="field"><label>Promotion Name</label><input id="qf-promo" value="${d.promotion_name || ''}"></div>
      <div class="field"><label>Branch</label><select id="qf-branch"><option value="">All Branches</option>
        ${this.branches.map(b => `<option value="${b.id}" ${d.branch_id == b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
      </select></div>
      <div class="field"><label>Campaign Goal</label><select id="qf-goal">${this.goalOptions(d.campaign_goal)}</select></div>
      <div class="field"><label>Start Date</label><input type="date" id="qf-start" value="${d.start_date || ''}"></div>
      <div class="field"><label>End Date *</label><input type="date" id="qf-end" value="${d.end_date || ''}"></div>
      <div class="field"><label>Go Live Mode</label><select id="qf-golive-mode">
        ${['both', 'auto', 'manual'].map(m => `<option value="${m}" ${d.go_live_mode === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select></div>
      <div class="field full"><label><input type="checkbox" id="qf-auto-golive" ${d.auto_go_live !== false ? 'checked' : ''}> Auto go-live when approved & start date reached</label></div>
    </div>`;
  },

  async renderQuickStep2(el) {
    const d = this.draft;
    if (!this.products.length || !this._quickCatalogLoaded) {
      const [prodRes, catRes, sugRes, comboRes] = await Promise.all([
        API.getProducts({ active_only: true }),
        API.getCategories(),
        API.getSmartPromotionSuggestions({ type: 'best_sellers', limit: 8 }, this.app.user).catch(() => ({ success: false })),
        API.getCombos({ active_only: true }).catch(() => ({ success: false }))
      ]);
      this.products = prodRes.data || [];
      this.categories = catRes.data || [];
      this.combos = comboRes.success ? (comboRes.data || []) : [];
      this._quickCatalogLoaded = true;
      const suggestions = sugRes.success ? (sugRes.data?.products || []) : [];
      if (!d.products.length && suggestions.length) {
        d.products = suggestions.slice(0, 6).map(p => ({ ...p, promo_type: 'percent', discount_percent: 10 }));
      }
    }
    el.innerHTML = `<div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-sm btn-ghost qf-tab-best" id="qf-suggest-best">Best Sellers</button>
      <button class="btn btn-sm btn-ghost qf-tab-clear" id="qf-suggest-clearance">Clearance</button>
      <button class="btn btn-sm btn-ghost qf-tab-new" id="qf-suggest-new">New Arrivals</button>
    </div>
    <div class="table-wrap" style="max-height:240px;overflow:auto;margin-bottom:12px"><table>
      <thead><tr><th></th><th>Product</th><th>Price</th><th>Add</th></tr></thead>
      <tbody>${this.products.slice(0, 50).map(p => `<tr>
        <td>${this.renderProductThumb(p)}</td>
        <td>${p.name}</td>
        <td>${Utils.formatMoney(p.selling_price, this.currency)}</td>
        <td><button class="btn btn-sm btn-ghost qf-add-prod" data-id="${p.id}">+</button></td>
      </tr>`).join('')}
      </tbody></table></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Selected</th><th>Normal</th><th>Promo</th><th>Special</th></tr></thead>
      <tbody>${d.products.map((p, i) => {
        const normal = Number(p.normal_price ?? p.selling_price) || 0;
        const special = this.calcPromoPrice(normal, p);
        return `<tr class="qf-price-row" data-idx="${i}">
          <td>${p.name || p.product_name}</td>
          <td>${Utils.formatMoney(normal, this.currency)}</td>
          <td><select class="fp-type"><option value="percent" ${p.promo_type === 'percent' ? 'selected' : ''}>% Off</option>
            <option value="special" ${p.promo_type === 'special' ? 'selected' : ''}>Special</option></select>
            <input type="number" class="fp-pct" step="1" value="${p.discount_percent || 10}" style="width:60px"></td>
          <td><input type="number" class="fp-special" step="0.01" value="${special.toFixed(2)}" style="width:80px"></td>
        </tr>`;
      }).join('') || '<tr><td colspan="4" class="muted">Add products above</td></tr>'}
      </tbody></table></div>
    <h4 style="margin:16px 0 8px">Combo Deals</h4>
    <div class="table-wrap" style="max-height:160px;overflow:auto;margin-bottom:12px"><table>
      <thead><tr><th>Combo</th><th>Price</th><th>Add</th></tr></thead>
      <tbody>${(this.combos || []).slice(0, 30).map(c => `<tr>
        <td>${c.name}</td>
        <td>${Utils.formatMoney(c.price || c.selling_price || 0, this.currency)}</td>
        <td><button class="btn btn-sm btn-ghost qf-add-combo" data-id="${c.id}">+</button></td>
      </tr>`).join('') || '<tr><td colspan="3" class="muted">No combos available</td></tr>'}
      </tbody></table></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Selected Combos</th><th>Price</th><th></th></tr></thead>
      <tbody>${(d.combos || []).map((c, i) => `<tr>
        <td>${c.name}</td>
        <td>${Utils.formatMoney(c.price || c.special_price || c.selling_price || 0, this.currency)}</td>
        <td><button class="btn btn-sm btn-danger qf-rm-combo" data-idx="${i}">Remove</button></td>
      </tr>`).join('') || '<tr><td colspan="3" class="muted">No combos selected</td></tr>'}
      </tbody></table></div>`;
    Utils.hydrateImages(el);

    const loadSuggest = async (type, activeBtn) => {
      el.querySelectorAll('[id^="qf-suggest-"]').forEach(b => b.classList.remove('active'));
      activeBtn?.classList.add('active');
      const r = await API.getSmartPromotionSuggestions({ type, limit: 8 }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      d.products = (r.data?.products || []).map(p => ({
        product_id: p.product_id || p.id,
        name: p.name || p.product_name,
        product_name: p.product_name || p.name,
        normal_price: p.normal_price ?? p.selling_price,
        selling_price: p.selling_price,
        promo_type: 'percent',
        discount_percent: r.data.suggested_discount_percent || 10,
        picture_path: p.picture_path || this.productImagePath(p)
      }));
      d.canvas.headline = r.data.headline || d.title;
      this.renderQuickStep2(el);
    };
    document.getElementById('qf-suggest-best')?.addEventListener('click', (e) => loadSuggest('best_sellers', e.currentTarget));
    document.getElementById('qf-suggest-clearance')?.addEventListener('click', (e) => loadSuggest('slow_movers', e.currentTarget));
    document.getElementById('qf-suggest-new')?.addEventListener('click', (e) => loadSuggest('new', e.currentTarget));
    el.querySelectorAll('.qf-add-prod').forEach(btn => btn.addEventListener('click', () => {
      const prod = this.products.find(p => p.id === parseInt(btn.dataset.id, 10));
      if (!prod || d.products.some(p => p.product_id === prod.id)) return;
      d.products.push({
        product_id: prod.id, name: prod.name, product_name: prod.name,
        normal_price: prod.selling_price, selling_price: prod.selling_price,
        promo_type: 'percent', discount_percent: 10,
        picture_path: this.productImagePath(prod)
      });
      this.renderQuickStep2(el);
    }));
    el.querySelectorAll('.qf-add-combo').forEach(btn => btn.addEventListener('click', () => {
      const combo = (this.combos || []).find(c => c.id === parseInt(btn.dataset.id, 10));
      if (!combo) return;
      if (!d.combos) d.combos = [];
      if (d.combos.some(c => c.combo_id === combo.id)) return;
      d.combos.push({
        combo_id: combo.id, name: combo.name,
        price: combo.price || combo.selling_price,
        selling_price: combo.price || combo.selling_price,
        combo_price_2: combo.price_2 || null,
        picture_path: combo.image_path || combo.picture_path || '',
        promo_type: 'special', special_price: combo.price || combo.selling_price
      });
      this.renderQuickStep2(el);
    }));
    el.querySelectorAll('.qf-rm-combo').forEach(btn => btn.addEventListener('click', () => {
      d.combos.splice(parseInt(btn.dataset.idx, 10), 1);
      this.renderQuickStep2(el);
    }));
  },

  async renderQuickStep3(el) {
    const d = this.draft;
    const tplRes = await API.getFlyerTemplates();
    this.templates = tplRes.data || [];
    const builtins = [
      { name: 'Weekend Specials', bg: '#2563eb', headline: 'WEEKEND SPECIALS' },
      { name: 'Clearance', bg: '#f59e0b', headline: 'CLEARANCE SALE' },
      { name: 'Birthday', bg: '#e11d48', headline: 'SPECIAL OFFERS' },
      { name: 'Chisanyama', bg: '#c2410c', headline: 'CHISANYAMA SPECIALS' }
    ];
    el.innerHTML = `<p class="muted">Pick a template — auto-layout will be applied when saved.</p>
    <div class="campaign-template-grid">${builtins.map((t, i) =>
      `<button type="button" class="qf-tpl campaign-tpl-card${i === 0 ? ' selected' : ''}" data-bg="${t.bg}" data-headline="${t.headline}" style="background:${t.bg}">
        <span>${t.name}</span></button>`).join('')}
    </div>
    <p class="muted" style="margin-top:12px">${d.products.length} products · Valid ${d.start_date || '—'} to ${d.end_date || '—'}</p>`;
    el.querySelectorAll('.qf-tpl').forEach(btn => btn.addEventListener('click', () => {
      el.querySelectorAll('.qf-tpl').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    }));
  },

  async finishQuickFlyer(el) {
    this.syncQuickFromDom();
    const d = this.draft;
    if (!d?.title?.trim()) return Utils.toast('Campaign name is required', 'error');
    if (!d.end_date) return Utils.toast('End date is required', 'error');
    if (!d.products?.length && !d.combos?.length) return Utils.toast('Add at least one product or combo', 'error');
    const kit = this.brandKit || {};
    const branding = d.branding || {
      primary_color: kit.primary_color || '#e11d48',
      secondary_color: kit.secondary_color || '#facc15',
      font_style: kit.font_style || 'Arial'
    };
    const products = d.products.map(p => ({
      ...p,
      product_id: p.product_id || p.id,
      product_name: p.product_name || p.name,
      normal_price: p.normal_price ?? p.selling_price,
      promo_type: p.promo_type || 'percent',
      discount_percent: p.discount_percent ?? 10
    }));
    const canvas = { ...(d.canvas || {}), combos: d.combos || d.canvas?.combos || [] };
    const payload = {
      title: d.title.trim(), promotion_name: d.promotion_name || null, branch_id: d.branch_id || null,
      start_date: d.start_date || Utils.today(), end_date: d.end_date, flyer_size: 'a4_portrait',
      status: 'draft', approval_status: 'draft', products, combos: d.combos || [], canvas, branding,
      campaign_goal: d.campaign_goal || 'all', go_live_mode: d.go_live_mode || 'both',
      auto_go_live: d.auto_go_live !== false
    };
    try {
      const r = await API.saveFlyer(payload, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not save flyer', 'error');
      const saved = r.data || {};
      const campaignId = saved.id ?? saved.campaign_id ?? d.id;
      if (!campaignId) {
        const listRes = await API.getFlyers({ search: d.title?.trim() });
        const match = (listRes.data || []).find(f => f.title === d.title?.trim());
        if (match?.id) {
          d.id = match.id;
          d.flyer_number = match.flyer_number;
        } else {
          return Utils.toast('Save failed — no campaign ID returned', 'error');
        }
      } else {
        d.id = campaignId;
        d.flyer_number = saved.flyer_number || d.flyer_number;
      }
      if (typeof this.generateFlyerLayout === 'function') {
        try {
          this.generateFlyerLayout(d, () => {});
          d.canvas.combos = d.combos || [];
          const r2 = await API.saveFlyer({ ...payload, id: d.id, canvas: d.canvas, products }, this.app.user);
          if (!r2.success) console.warn('Layout save:', r2.error);
        } catch (layoutErr) {
          console.warn('Flyer layout generation skipped:', layoutErr);
        }
      }
      Utils.showModal('Quick Flyer Saved', `
        <p>Campaign <strong>${Utils.escHtml(d.title)}</strong> saved as draft.</p>
        <p class="muted" style="margin-bottom:12px">Launch checklist — complete these next steps:</p>
        <ul style="margin:0 0 12px;padding-left:20px">
          <li>Print or download PDF</li>
          <li>Share on WhatsApp</li>
          <li>Submit for manager approval</li>
        </ul>`,
        `<button class="btn btn-primary" id="qf-check-pdf">Print PDF</button>
         <button class="btn btn-success" id="qf-check-wa">Share WhatsApp</button>
         <button class="btn btn-warning" id="qf-check-submit">Submit for Approval</button>
         <button class="btn btn-ghost" id="qf-open-studio">Design Studio</button>
         <button class="btn btn-ghost" id="qf-done">Back to Campaigns</button>`);
      document.getElementById('qf-check-pdf')?.addEventListener('click', async () => {
        await this.downloadPdf(d.id);
      });
      document.getElementById('qf-check-wa')?.addEventListener('click', () => {
        Utils.hideModal();
        this.showShareModal(d.id);
      });
      document.getElementById('qf-check-submit')?.addEventListener('click', async () => {
        const r = await API.submitFlyerApproval(d.id, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Submitted for approval', 'success');
        Utils.hideModal();
        this.view = 'list';
        this.tab = 'campaigns';
        this.draft = null;
        const root = this.resolveRoot(el);
        this.render(root, this.app);
      });
      document.getElementById('qf-open-studio')?.addEventListener('click', async () => {
        Utils.hideModal();
        await Utils.loadScript('js/pages/marketing-flyers-studio.js').catch(() => {});
        this.view = 'wizard';
        const root = this.resolveRoot(el);
        await this.openFlyer(d.id, root, 2);
      });
      document.getElementById('qf-done')?.addEventListener('click', () => {
        Utils.hideModal();
        this.view = 'list';
        this.tab = 'campaigns';
        this.quickStep = 1;
        this.draft = null;
        const root = this.resolveRoot(el);
        this.render(root, this.app);
      });
    } catch (err) {
      Utils.toast(err.message || 'Save failed', 'error');
    }
  },

  async renderBrandKitTab(el) {
    const r = await API.getBrandKit();
    const kit = r.success ? r.data : (this.brandKit || {});
    const shop = this.app.settings || {};
    const logoPath = kit.logo_path || shop.logo_path || '';
    el.innerHTML = `<div class="card"><div class="card-body">
      <h4 style="margin:0 0 12px">Brand Kit</h4>
      <p class="muted">Defaults applied to new Quick Flyers and campaigns.</p>
      <div class="field" style="margin-bottom:12px">
        <label>Logo Preview</label>
        <div id="bk-logo-preview">${logoPath
          ? `<img data-image-path="${logoPath}" class="campaign-brand-logo-preview" alt="Brand logo">`
          : '<div class="campaign-brand-logo-empty">No logo</div>'}</div>
      </div>
      <div class="form-grid">
        <div class="field"><label>Primary Color</label><input type="color" id="bk-primary" value="${kit.primary_color || '#e11d48'}"></div>
        <div class="field"><label>Secondary Color</label><input type="color" id="bk-secondary" value="${kit.secondary_color || '#facc15'}"></div>
        <div class="field"><label>Font Style</label><select id="bk-font">
          ${['Arial', 'Impact', 'Georgia', 'Verdana', 'Anton'].map(f => `<option ${kit.font_style === f ? 'selected' : ''}>${f}</option>`).join('')}
        </select></div>
        <div class="field full"><label>Footer Text</label><input id="bk-footer" value="${kit.footer_text || ''}" placeholder="Shop address line"></div>
        <div class="field full"><label>Default Terms</label><textarea id="bk-terms" rows="2">${kit.default_terms || ''}</textarea></div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="bk-import-shop">Import from Shop Settings</button>
        <button class="btn btn-primary" id="bk-save">Save Brand Kit</button>
      </div>
    </div></div>`;
    Utils.hydrateImages(el);
    let currentLogo = logoPath;
    document.getElementById('bk-import-shop')?.addEventListener('click', () => {
      const parts = [shop.address, shop.phone].filter(Boolean);
      document.getElementById('bk-footer').value = parts.join(' · ') || shop.shop_name || '';
      currentLogo = shop.logo_path || currentLogo;
      const preview = document.getElementById('bk-logo-preview');
      if (preview && currentLogo) {
        preview.innerHTML = `<img data-image-path="${currentLogo}" class="campaign-brand-logo-preview" alt="Brand logo">`;
        Utils.hydrateImages(preview);
      }
      Utils.toast('Imported shop name, address, phone, and logo', 'success');
    });
    document.getElementById('bk-save').addEventListener('click', async () => {
      const data = {
        primary_color: document.getElementById('bk-primary').value,
        secondary_color: document.getElementById('bk-secondary').value,
        font_style: document.getElementById('bk-font').value,
        footer_text: document.getElementById('bk-footer').value.trim(),
        default_terms: document.getElementById('bk-terms').value.trim(),
        logo_path: currentLogo || kit.logo_path || ''
      };
      const sr = await API.saveBrandKit(data, this.app.user);
      if (!sr.success) return Utils.toast(sr.error, 'error');
      this.brandKit = sr.data;
      Utils.toast('Brand kit saved', 'success');
    });
  },

  async showShareModal(flyerId) {
    const fRes = await API.getFlyer(flyerId);
    if (!fRes.success) return Utils.toast(fRes.error, 'error');
    const f = fRes.data;
    const shop = this.app.settings || {};
    const defaultMsg = `🔥 ${f.title}${f.promotion_name ? ` — ${f.promotion_name}` : ''}\n\nVisit ${shop.shop_name || 'us'} for special deals!${f.end_date ? `\nValid until ${f.end_date}` : ''}`;
    Utils.showModal(`Share — ${f.title}`, `
      <div class="campaign-share-modal">
        <div class="field"><label>Message</label><textarea id="share-msg" rows="4">${defaultMsg}</textarea>
          <button class="btn btn-sm btn-ghost" id="share-copy-msg" style="margin-top:4px">Copy Message</button></div>
        <div class="campaign-share-section"><h4>Print</h4>
          <button class="btn btn-ghost" id="share-pdf">Download PDF</button></div>
        <div class="campaign-share-section"><h4>Social Export</h4>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${Object.entries(this.SOCIAL_EXPORT).map(([label, size]) =>
              `<button class="btn btn-sm btn-ghost share-social" data-size="${size}">${label}</button>`).join('')}
          </div></div>
        <div class="campaign-share-section"><h4>WhatsApp</h4>
          <div class="field"><label>Phone (single)</label><input id="share-phone" placeholder="0821234567"></div>
          <div class="field"><label>Or pick from audience</label>
            <select id="share-audience" multiple size="4" style="width:100%"></select></div>
          <button class="btn btn-success" id="share-wa-send">Send WhatsApp</button>
        </div>
      </div>`,
      '<button class="btn btn-ghost" id="share-close">Close</button>');
    document.getElementById('share-pdf')?.addEventListener('click', () => this.downloadPdf(flyerId));
    document.getElementById('share-copy-msg')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(document.getElementById('share-msg').value);
      Utils.toast('Message copied', 'success');
    });
    document.getElementById('share-close')?.addEventListener('click', () => Utils.hideModal());
    document.querySelectorAll('.share-social').forEach(btn => btn.addEventListener('click', async () => {
      await this.downloadPdf(flyerId, btn.dataset.size);
      await API.recordFlyerEvent(flyerId, 'export');
      Utils.toast(`Exported ${btn.textContent} size`, 'success');
    }));
    try {
      const aud = await API.getWhatsAppAudience({ type: 'customers_with_phone' });
      const sel = document.getElementById('share-audience');
      if (sel && aud.success) {
        sel.innerHTML = (aud.data || []).slice(0, 100).map(c =>
          `<option value="${c.phone}">${c.name || c.phone}</option>`).join('');
      }
    } catch (_) {}
    document.getElementById('share-wa-send')?.addEventListener('click', async () => {
      const msg = document.getElementById('share-msg').value.trim();
      const phone = document.getElementById('share-phone').value.trim();
      const audSel = document.getElementById('share-audience');
      const phones = phone ? [phone] : Array.from(audSel?.selectedOptions || []).map(o => o.value).filter(Boolean);
      if (!phones.length) return Utils.toast('Enter a phone or select audience', 'error');
      const r = await API.shareFlyerCampaign(flyerId, { phones, message: msg, channel: 'whatsapp' }, this.app.user);
      await Utils.deliverWhatsApp(r);
    });
  },

  async showMyFlyersModal(el) {
    const flyRes = await API.getFlyers({});
    const flyers = flyRes.data || [];
    Utils.showModal('My Flyers', `
      <p class="muted">Open a saved flyer to continue editing.</p>
      <div class="table-wrap" style="max-height:320px;overflow:auto"><table>
        <thead><tr><th>Title</th><th>Dates</th><th>Status</th><th></th></tr></thead>
        <tbody>${flyers.map(f => `<tr>
          <td><strong>${f.title}</strong></td>
          <td>${f.start_date || '—'} → ${f.end_date || '—'}</td>
          <td>${this.statusPill(this.displayStatus(f))}</td>
          <td><button type="button" class="btn btn-sm btn-primary my-flyer-open" data-id="${f.id}">Open</button></td>
        </tr>`).join('') || '<tr><td colspan="4" class="muted">No saved flyers yet</td></tr>'}
        </tbody></table></div>`,
      '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
    document.querySelectorAll('.my-flyer-open').forEach(btn => btn.addEventListener('click', async () => {
      Utils.hideModal();
      const root = this.resolveRoot(el);
      await this.openFlyer(parseInt(btn.dataset.id, 10), root, 1);
    }));
  },

  async showAnalyticsPanel(flyerId) {
    const r = await API.getFlyerAnalytics(flyerId);
    if (!r.success) return Utils.toast(r.error, 'error');
    const a = r.data;
    Utils.showModal('Campaign Analytics', `
      <div class="campaign-analytics-grid">
        ${[['Views', a.views], ['Exports', a.exports], ['Prints', a.prints], ['Shares', a.shares], ['PDF Downloads', a.pdf_downloads],
          ['Promo Sales', a.promo_sales], ['Promo Revenue', Utils.formatMoney(a.promo_revenue || 0, this.currency)],
          ['Products', a.product_count]].map(([l, n]) =>
          `<div class="campaign-analytic"><span class="campaign-analytic-val">${n ?? 0}</span><span class="campaign-analytic-lbl">${l}</span></div>`).join('')}
      </div>`,
      '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
  },

  async openFlyer(id, el, startStep) {
    const r = await API.getFlyer(id);
    if (!r.success || !r.data) return Utils.toast(r.error || 'Campaign not found', 'error');
    const f = r.data;
    this.draft = {
      id: f.id, title: f.title, promotion_name: f.promotion_name, branch_id: f.branch_id,
      start_date: f.start_date, end_date: f.end_date, flyer_size: f.flyer_size || 'a4_portrait',
      status: f.status, apply_pos_prices: !!f.apply_pos_prices, approval_status: f.approval_status,
      campaign_goal: f.campaign_goal || 'all', go_live_mode: f.go_live_mode || 'both',
      auto_go_live: f.auto_go_live !== 0,
      products: (f.products || []).map(p => ({ ...p, promo_type: p.promo_type || 'special' })),
      combos: f.combos || f.canvas?.combos || [],
      canvas: { headline: '', background: '#e11d48', terms: 'Prices include VAT where applicable. While stocks last.', elements: [], ...(f.canvas || {}) },
      branding: f.branding || {}
    };
    this.step = startStep || 1;
    this.view = 'wizard';
    this.render(el, this.app);
  },

  async renderWizard(el) {
    const d = this.draft || this.emptyDraft(this.brandKit);
    this.draft = d;
    const studioLoaded = !!window.__FLYER_STUDIO_LOADED__;
    const steps = studioLoaded
      ? [['1', 'Select Products'], ['2', 'Design Flyer'], ['3', 'Preview & Print']]
      : [['1', 'Details'], ['2', 'Products'], ['3', 'Pricing'], ['4', 'Design Studio']];
    const maxStep = studioLoaded ? 3 : 4;

    if (studioLoaded) {
      el.innerHTML = `<div class="flyer-wizard-shell"><div id="fly-step-content"></div></div>`;
    } else {
      el.innerHTML = `<div class="page-toolbar">
        <button class="btn btn-ghost" id="fly-back">← Back to Campaigns</button>
        <h3>${d.id ? 'Edit Campaign' : 'New Campaign'} — Step ${this.step} of ${maxStep}</h3>
        <div>
          <button class="btn btn-ghost" id="fly-save-draft">Save Draft</button>
          ${this.step >= 2 ? `<button class="btn btn-primary" id="fly-goto-studio">Design Studio</button>` : ''}
          ${d.id && this.canGoLive(this.app.user) && d.approval_status === 'approved' && !d.apply_pos_prices ? `<button class="btn btn-success" id="fly-golive-wiz">Go Live</button>` : ''}
          ${d.id ? `<button class="btn btn-ghost" id="fly-share-wiz">Share</button>` : ''}
          ${d.id && ['draft', 'rejected'].includes(d.approval_status) ? `<button class="btn btn-warning" id="fly-submit-wiz">Submit</button>` : ''}
          ${d.id ? `<button class="btn btn-ghost" id="fly-pdf-wiz">PDF</button>` : ''}
        </div>
      </div>
      <div class="form-tabs" style="margin-bottom:16px">${steps.map(([n, label]) =>
        `<button type="button" class="form-tab ${this.step === parseInt(n, 10) ? 'active' : ''}" data-step="${n}">${label}</button>`).join('')}</div>
      <div id="fly-step-content"></div>
      <div style="margin-top:16px;display:flex;gap:8px;justify-content:space-between">
        <button class="btn btn-ghost" id="fly-prev" ${this.step <= 1 ? 'disabled' : ''}>Previous</button>
        <button class="btn btn-primary" id="fly-next">${this.step >= maxStep ? 'Finish & Save' : 'Next'}</button>
      </div>`;
    }

    document.getElementById('fly-back')?.addEventListener('click', () => {
      if (confirm('Start a new flyer? Unsaved changes will be lost.')) {
        this.draft = this.emptyDraft(this.brandKit);
        this.step = 1;
        this.render(el, this.app);
      }
    });
    document.getElementById('fly-save-draft')?.addEventListener('click', () => this.saveFlyer('draft', el));
    document.getElementById('fly-goto-studio')?.addEventListener('click', () => {
      this.syncStepFromDom?.();
      this.step = studioLoaded ? 2 : 4;
      this.renderWizard(el);
    });
    document.getElementById('fly-golive-wiz')?.addEventListener('click', async () => {
      const r = await API.goLiveFlyer(d.id, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Campaign is live!', 'success');
      this.draft.apply_pos_prices = true;
    });
    document.getElementById('fly-share-wiz')?.addEventListener('click', () => this.showShareModal(d.id));
    document.getElementById('fly-submit-wiz')?.addEventListener('click', async () => {
      if (!d.end_date) return Utils.toast('End date required before submit', 'error');
      const r = await API.submitFlyerApproval(d.id, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Submitted for approval', 'success');
      d.approval_status = 'pending';
    });
    document.getElementById('fly-pdf-wiz')?.addEventListener('click', () => this.downloadPdf(d.id));
    el.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
      this.syncStepFromDom();
      this.step = parseInt(b.dataset.step, 10);
      this.renderWizard(el);
    }));
    document.getElementById('fly-prev')?.addEventListener('click', () => {
      this.syncStepFromDom();
      this.step = Math.max(1, this.step - 1);
      this.renderWizard(el);
    });
    document.getElementById('fly-next')?.addEventListener('click', async () => {
      this.syncStepFromDom();
      if (this.step >= maxStep) {
        await this.saveFlyer('draft', el);
        return;
      }
      this.step++;
      this.renderWizard(el);
    });

    const content = document.getElementById('fly-step-content');
    if (studioLoaded) {
      await this.renderStep4(content);
    } else if (this.step === 1) await this.renderStep1(content);
    else if (this.step === 2) await this.renderStep2(content);
    else if (this.step === 3) this.renderStep3(content);
    else this.renderStep4(content);
  },

  syncStepFromDom() {
    const d = this.draft;
    if (!d) return;
    if (this.step === 1) {
      d.title = document.getElementById('fly-title')?.value.trim() || d.title;
      d.promotion_name = document.getElementById('fly-promo')?.value.trim() || '';
      d.branch_id = parseInt(document.getElementById('fly-branch')?.value, 10) || null;
      d.start_date = document.getElementById('fly-start')?.value || d.start_date;
      d.end_date = document.getElementById('fly-end')?.value || '';
      d.flyer_size = document.getElementById('fly-size')?.value || d.flyer_size;
      d.campaign_goal = document.getElementById('fly-goal')?.value || d.campaign_goal || 'all';
      d.apply_pos_prices = document.getElementById('fly-apply-pos')?.checked || false;
    } else if (this.step === 3) {
      d.products.forEach((p, i) => {
        const row = document.querySelector(`.fly-price-row[data-idx="${i}"]`);
        if (!row) return;
        p.promo_type = row.querySelector('.fp-type')?.value || 'special';
        p.special_price = parseFloat(row.querySelector('.fp-special')?.value) || 0;
        p.discount_percent = parseFloat(row.querySelector('.fp-pct')?.value) || 0;
        p.discount_amount = parseFloat(row.querySelector('.fp-fixed')?.value) || 0;
      });
    } else if (this.step === 4 || (window.__FLYER_STUDIO_LOADED__ && this.step <= 3)) {
      d.title = document.getElementById('fd-title')?.value.trim() || document.getElementById('fly-title')?.value.trim() || d.title;
      d.promotion_name = document.getElementById('fd-promo')?.value.trim() || d.promotion_name || '';
      d.branch_id = parseInt(document.getElementById('fd-branches')?.value || document.getElementById('fd-branch')?.value || document.getElementById('fly-branch')?.value, 10) || null;
      d.start_date = document.getElementById('fd-start')?.value || document.getElementById('fly-start')?.value || d.start_date;
      d.end_date = document.getElementById('fd-end')?.value || document.getElementById('fly-end')?.value || '';
      d.flyer_size = document.getElementById('fd-size')?.value || document.getElementById('fly-size')?.value || d.flyer_size;
      d.apply_pos_prices = document.getElementById('fd-apply-pos')?.checked ?? d.apply_pos_prices;
      d.canvas.headline = document.getElementById('fd-title')?.value.trim() || document.getElementById('fly-headline')?.value.trim() || d.title || d.canvas.headline;
      d.canvas.background = document.getElementById('fly-bg')?.value || document.getElementById('fd-bg-color')?.value || d.canvas.background;
      d.canvas.terms = document.getElementById('fly-terms')?.value.trim() || document.getElementById('fd-notes')?.value.trim() || d.canvas.terms;
    }
  },

  async renderStep1(el) {
    const d = this.draft;
    if (!this.branches.length) {
      const br = await API.getBranches();
      this.branches = br.data || [];
    }
    el.innerHTML = `<div class="form-grid">
      <div class="field"><label>Campaign Title *</label><input id="fly-title" value="${d.title || ''}" placeholder="March Specials"></div>
      <div class="field"><label>Promotion Name</label><input id="fly-promo" value="${d.promotion_name || ''}" placeholder="Birthday Specials"></div>
      <div class="field"><label>Branch</label><select id="fly-branch"><option value="">All Branches</option>
        ${this.branches.map(b => `<option value="${b.id}" ${d.branch_id == b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
      </select></div>
      <div class="field"><label>Goal</label><select id="fly-goal">${this.goalOptions(d.campaign_goal)}</select></div>
      <div class="field"><label>Flyer Size</label><select id="fly-size">
        ${Object.entries(this.FLYER_SIZES).map(([k, v]) => `<option value="${k}" ${d.flyer_size === k ? 'selected' : ''}>${v.label}</option>`).join('')}
      </select></div>
      <div class="field"><label>Start Date</label><input type="date" id="fly-start" value="${d.start_date || ''}"></div>
      <div class="field"><label>End Date *</label><input type="date" id="fly-end" value="${d.end_date || ''}"></div>
    </div>`;
  },

  async renderStep2(el) {
    const d = this.draft;
    const [prodRes, catRes] = await Promise.all([API.getProducts({ active_only: true }), API.getCategories()]);
    this.products = prodRes.data || [];
    this.categories = catRes.data || [];
    const selected = new Set(d.products.map(p => p.product_id));
    el.innerHTML = `<div class="form-grid" style="margin-bottom:12px">
      <div class="field"><label>Search</label><input id="fly-prod-search" placeholder="Search products…"></div>
      <div class="field"><label>Category</label><select id="fly-prod-cat"><option value="">All</option>
        ${this.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
      </select></div>
    </div>
    <div class="table-wrap" style="max-height:320px;overflow:auto"><table>
      <thead><tr><th></th><th></th><th>Product</th><th>Category</th><th>Price</th></tr></thead>
      <tbody id="fly-prod-list">${this.filterProducts('', '').map(p => `<tr class="fly-prod-row" data-id="${p.id}" data-cat="${p.category_id || ''}">
        <td><input type="checkbox" class="fly-prod-chk" ${selected.has(p.id) ? 'checked' : ''}></td>
        <td>${this.renderProductThumb(p)}</td>
        <td>${p.name}</td><td>${p.category_name || '—'}</td>
        <td>${Utils.formatMoney(p.selling_price, this.currency)}</td></tr>`).join('')}
      </tbody></table></div>
    <p class="muted" style="margin-top:8px">${d.products.length} product(s) selected</p>`;

    const filter = () => {
      const q = document.getElementById('fly-prod-search').value.trim().toLowerCase();
      const cat = document.getElementById('fly-prod-cat').value;
      document.querySelectorAll('.fly-prod-row').forEach(row => {
        const name = row.children[2].textContent.toLowerCase();
        row.style.display = (!q || name.includes(q)) && (!cat || row.dataset.cat === cat) ? '' : 'none';
      });
    };
    document.getElementById('fly-prod-search').addEventListener('input', filter);
    document.getElementById('fly-prod-cat').addEventListener('change', filter);
    el.querySelectorAll('.fly-prod-chk').forEach(chk => chk.addEventListener('change', () => {
      const row = chk.closest('.fly-prod-row');
      const pid = parseInt(row.dataset.id, 10);
      const prod = this.products.find(p => p.id === pid);
      if (!prod) return;
      if (chk.checked) {
        if (!d.products.some(p => p.product_id === pid)) {
          d.products.push({
            product_id: pid, name: prod.name, product_name: prod.name,
            category: prod.category_name, normal_price: prod.selling_price,
            selling_price: prod.selling_price, promo_type: 'special',
            special_price: prod.selling_price,
            picture_path: this.productImagePath(prod)
          });
        }
      } else {
        d.products = d.products.filter(p => p.product_id !== pid);
      }
      el.querySelector('.muted').textContent = `${d.products.length} product(s) selected`;
    }));
    Utils.hydrateImages(el);
  },

  filterProducts(q, catId) {
    q = (q || '').toLowerCase();
    return this.products.filter(p => {
      const matchQ = !q || p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q);
      const matchC = !catId || String(p.category_id) === String(catId);
      return matchQ && matchC;
    });
  },

  renderStep3(el) {
    const d = this.draft;
    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th></th><th>Product</th><th>Normal</th><th>Promo Type</th><th>Value</th><th>Special</th><th>SAVE</th></tr></thead>
      <tbody>${d.products.map((p, i) => {
        const normal = Number(p.normal_price ?? p.selling_price) || 0;
        const special = this.calcPromoPrice(normal, p);
        const save = Math.max(0, normal - special);
        return `<tr class="fly-price-row" data-idx="${i}">
          <td>${this.renderProductThumb(p)}</td>
          <td>${p.name || p.product_name}</td>
          <td>${Utils.formatMoney(normal, this.currency)}</td>
          <td><select class="fp-type">
            <option value="special" ${p.promo_type === 'special' ? 'selected' : ''}>Special Price</option>
            <option value="percent" ${p.promo_type === 'percent' ? 'selected' : ''}>% Off</option>
            <option value="fixed" ${p.promo_type === 'fixed' ? 'selected' : ''}>Fixed Off</option>
          </select></td>
          <td class="fp-val-cell">
            <input type="number" class="fp-special" step="0.01" value="${p.special_price ?? normal}" style="display:${p.promo_type === 'special' ? '' : 'none'}">
            <input type="number" class="fp-pct" step="0.1" value="${p.discount_percent || 0}" style="display:${p.promo_type === 'percent' ? '' : 'none'}">
            <input type="number" class="fp-fixed" step="0.01" value="${p.discount_amount || 0}" style="display:${p.promo_type === 'fixed' ? '' : 'none'}">
          </td>
          <td class="fp-result">${Utils.formatMoney(special, this.currency)}</td>
          <td class="fp-save" style="color:var(--success);font-weight:600">${save > 0 ? `SAVE ${Utils.formatMoney(save, this.currency)}` : '—'}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="7" class="muted">No products — go back to step 2</td></tr>'}
      </tbody></table></div>`;
    Utils.hydrateImages(el);
    const updateRow = (row) => {
      const i = parseInt(row.dataset.idx, 10);
      const p = d.products[i];
      const normal = Number(p.normal_price ?? p.selling_price) || 0;
      p.promo_type = row.querySelector('.fp-type').value;
      p.special_price = parseFloat(row.querySelector('.fp-special').value) || 0;
      p.discount_percent = parseFloat(row.querySelector('.fp-pct').value) || 0;
      p.discount_amount = parseFloat(row.querySelector('.fp-fixed').value) || 0;
      row.querySelector('.fp-special').style.display = p.promo_type === 'special' ? '' : 'none';
      row.querySelector('.fp-pct').style.display = p.promo_type === 'percent' ? '' : 'none';
      row.querySelector('.fp-fixed').style.display = p.promo_type === 'fixed' ? '' : 'none';
      const special = this.calcPromoPrice(normal, p);
      row.querySelector('.fp-result').textContent = Utils.formatMoney(special, this.currency);
    };
    el.querySelectorAll('.fly-price-row').forEach(row => {
      row.querySelector('.fp-type').addEventListener('change', () => updateRow(row));
      row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => updateRow(row)));
    });
  },

  async renderStep4(el) {
    el.innerHTML = `<div class="card"><div class="card-body"><p class="muted">Flyer Design Studio failed to load. Please restart the app.</p></div></div>`;
  },

  async saveFlyer(status, el) {
    this.syncStepFromDom();
    const d = this.draft;
    if (!d.title?.trim()) return Utils.toast('Title is required', 'error');
    if (d.canvas) {
      d.canvas.combos = d.combos || [];
      this.syncElementsToPage?.(d);
    }
    const payload = {
      id: d.id, title: d.title.trim(), promotion_name: d.promotion_name,
      branch_id: d.branch_id, start_date: d.start_date || null, end_date: d.end_date || null,
      flyer_size: d.flyer_size, status: status || d.status || 'draft',
      products: d.products, canvas: d.canvas, branding: d.branding,
      apply_pos_prices: d.apply_pos_prices,
      campaign_goal: d.campaign_goal, go_live_mode: d.go_live_mode, auto_go_live: d.auto_go_live
    };
    const r = await API.saveFlyer(payload, this.app.user);
    if (!r.success) return Utils.toast(r.error, 'error');
    const saved = r.data || {};
    d.id = saved.id ?? saved.campaign_id ?? d.id;
    d.flyer_number = saved.flyer_number || d.flyer_number;
    d.status = saved.status || status || d.status;
    d.combos = r.data.combos || d.combos || [];
    Utils.toast('Flyer saved', 'success');
    if (this.view === 'wizard') {
      this.render(el, this.app);
      return;
    }
    this.view = 'wizard';
    this.render(el, this.app);
  },

  async downloadPdf(id, sizeOverride) {
    if (!id) return Utils.toast('Save campaign first', 'error');
    const r = await API.getFlyerPdf(id, sizeOverride || null);
    if (!r.success) return Utils.toast(r.error, 'error');
    const buf = r.data;
    const bytes = buf instanceof Uint8Array ? buf : buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf);
    const f = this.flyers.find(x => x.id === id) || this.draft;
    const sizeSuffix = sizeOverride ? `-${sizeOverride}` : '';
    const name = `flyer-${f?.flyer_number || f?.title || id}${sizeSuffix}.pdf`.replace(/[^\w.-]+/g, '-');
    const saved = await API.saveFile(name, [{ name: 'PDF', extensions: ['pdf'] }], bytes);
    if (!saved.success) return Utils.toast(saved.error || 'PDF save failed', 'error');
    await API.recordFlyerEvent(id, 'pdf');
    Utils.toast(saved.path ? `PDF saved: ${saved.path}` : 'PDF exported', 'success');
  },

  async saveFlyerPdfToDevice(draft) {
    const id = draft?.id;
    if (!id) return { success: false, error: 'Save campaign first' };
    const r = await API.getFlyerPdf(id);
    if (!r.success) return r;
    const bytes = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data);
    const name = `flyer-${draft.flyer_number || draft.title || id}.pdf`.replace(/[^\w.-]+/g, '-');
    return API.saveFile(name, [{ name: 'PDF', extensions: ['pdf'] }], bytes);
  },

  buildPrintHtml() {
    const d = this.draft;
    const s = this.app.settings || {};
    const products = (d.products || []).map(p => {
      const normal = Number(p.normal_price ?? p.selling_price) || 0;
      const special = this.calcPromoPrice(normal, p);
      return `<div style="display:inline-block;width:30%;margin:1%;padding:12px;background:#facc15;border-radius:8px;vertical-align:top">
        <strong>${p.name || p.product_name}</strong><br>
        <small style="text-decoration:line-through">${this.currency}${normal.toFixed(2)}</small><br>
        <span style="font-size:22px;font-weight:800">${this.currency}${special.toFixed(2)}</span>
      </div>`;
    }).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${d.title}</title></head>
      <body style="margin:0;font-family:Arial,sans-serif">
        <div style="background:${d.canvas.background || '#e11d48'};color:#fff;padding:40px 20px;text-align:center;min-height:100vh">
          <h1 style="margin:0 0 8px;font-size:32px">${d.canvas.headline || d.title}</h1>
          <p style="margin:0 0 24px">${s.shop_name || ''}</p>
          <div style="text-align:left;margin:24px 0">${products}</div>
          <p style="font-size:12px;margin-top:40px">${d.canvas.terms || ''}</p>
        </div></body></html>`;
  },

  async printFlyer() {
    if (!this.draft?.id) return Utils.toast('Save the campaign first', 'error');
    this.syncStepFromDom?.();
    const html = this.buildPrintHtml();
    const title = this.draft.title || 'Flyer';
    try {
      const pr = await API.printA4(html);
      if (!pr.success) await API.printPreview(html, title);
      else Utils.toast('Sent to printer', 'success');
      await API.recordFlyerEvent(this.draft.id, 'print');
    } catch {
      await API.printPreview(html, title);
    }
  }
};
window.MarketingFlyersPage = MarketingFlyersPage;

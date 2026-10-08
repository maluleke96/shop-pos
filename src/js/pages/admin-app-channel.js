/**
 * Communication Center — App Notifications, Promotions & Ratings (extends base page).
 */
(function () {
  if (!window.AdminCommunicationCenterPage) {
    window.AdminCommunicationCenterPage = {};
  }
  const P = window.AdminCommunicationCenterPage;

  if (Array.isArray(P.TABS) && !P.TABS.some(([id]) => id === 'app-notifications')) {
    const idx = P.TABS.findIndex(([id]) => id === 'email');
    const at = idx >= 0 ? idx + 1 : P.TABS.length;
    P.TABS.splice(at, 0,
      ['app-notifications', '📱 App Notifications'],
      ['promotions', '🎯 Promotions'],
      ['ratings', '⭐ Ratings & Reviews']
    );
  }

  const APP_DEST = [
    ['home', 'Home'], ['promotions', 'Promotions'], ['product', 'Product'], ['menu', 'Menu'],
    ['loyalty', 'Loyalty'], ['order', 'Order'], ['branch', 'Branch'], ['custom', 'Custom URL']
  ];
  const APP_CATEGORIES = [
    ['special_offers', 'Special offers'], ['loyalty_rewards', 'Loyalty rewards'],
    ['new_products', 'New products'], ['branch_announcements', 'Branch announcements'],
    ['order_updates', 'Order updates']
  ];
  const APP_AUDIENCE = [
    ['all_app_users', 'All app users'],
    ['branch', 'Single branch (ordered at branch)'],
    ['branches', 'Multiple branches'],
    ['loyalty', 'Loyalty members'],
    ['purchased_product', 'Purchased a product'],
    ['ordered_period', 'Ordered within period (days)'],
    ['not_ordered_recently', 'Not ordered recently (days)'],
    ['segment', 'Segment (customer ID list)'],
    ['custom', 'Custom (customer ID list)']
  ];

  Object.assign(P, {
    _appSub: 'create',
    _ratingsTab: 'pending',
    _appCampaign: {},
    _appPromoDraft: {},
    _appAnalyticsId: null,
    _appAudiencePreview: null,
    _appAudiencePreviewKey: null,
    _appAuditRows: null,

    appSubNav(active, items) {
      return `<div class="cc-tabs cc-subtabs">${items.map(([id, label]) =>
        `<button type="button" class="cc-tab ${active === id ? 'active' : ''}" data-act="app-sub" data-sub="${id}">${this.esc(label)}</button>`
      ).join('')}</div>`;
    },

    appCampaignFormKey(root) {
      const data = this.readAppCampaignForm(root);
      return JSON.stringify(data);
    },

    readAppCampaignForm(root) {
      const g = (id) => root.querySelector(`#${id}`)?.value?.trim() ?? '';
      const img = root.querySelector('#app-c-img-preview')?.src || '';
      const audienceType = g('app-c-audience') || 'all_app_users';
      const daysRaw = g('app-c-days');
      const days = daysRaw ? Number(daysRaw) : null;
      const branchIdsRaw = g('app-c-branch-ids');
      const branchIds = branchIdsRaw
        ? branchIdsRaw.split(/[,;\s]+/).map((x) => Number(x.trim())).filter(Boolean)
        : [];
      const customRaw = g('app-c-custom-ids');
      const customIds = customRaw
        ? customRaw.split(/[,;\s]+/).map((x) => Number(x.trim())).filter(Boolean)
        : [];
      const audienceJson = {};
      if (audienceType === 'purchased_product') {
        const pid = g('app-c-product-id');
        if (pid) audienceJson.product_id = Number(pid);
      }
      if (audienceType === 'ordered_period') {
        audienceJson.days = days || 30;
      }
      if (audienceType === 'not_ordered_recently') {
        audienceJson.days = days || 60;
        audienceJson.inactive_days = days || 60;
      }
      if (audienceType === 'segment' || audienceType === 'custom') {
        audienceJson.web_customer_ids = customIds;
        audienceJson.ids = customIds;
      }
      if (audienceType === 'loyalty') audienceJson.min_points = 1;
      let audFallback = {};
      try {
        const raw = this._appCampaign?.audience_json;
        audFallback = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
      } catch (_) { audFallback = {}; }
      return {
        id: this._appCampaign.id || undefined,
        name: g('app-c-name'),
        title: g('app-c-title'),
        body: g('app-c-body'),
        image_url: img.startsWith('data:') ? img : (g('app-c-image-url') || img || null),
        button_text: g('app-c-button'),
        destination_type: g('app-c-dest-type') || 'home',
        destination_id: g('app-c-dest-id') || null,
        destination_url: g('app-c-dest-url') || null,
        category: g('app-c-category') || 'special_offers',
        audience_type: audienceType,
        audience_json: Object.keys(audienceJson).length ? audienceJson : audFallback,
        branch_id: g('app-c-branch') || null,
        branch_ids_json: branchIds.length ? branchIds : undefined,
        scheduled_at: g('app-c-scheduled') || null,
        status: 'draft'
      };
    },

    audienceSegmentsHelpHtml() {
      return `<div class="cc-card" style="margin-top:12px;padding:12px">
        <h4>Audience segments</h4>
        <ul class="cc-muted" style="margin:8px 0;padding-left:18px;font-size:13px">
          <li><strong>All app users</strong> — registered devices in the app channel.</li>
          <li><strong>Loyalty</strong> — customers with loyalty points.</li>
          <li><strong>Ordered within period</strong> — ordered in the last N days (default 30).</li>
          <li><strong>Not ordered recently</strong> — no order in the last N days (default 60).</li>
          <li><strong>Branch / branches</strong> — customers who ordered at selected branch(es).</li>
          <li><strong>Segment / Custom</strong> — explicit web customer ID lists (comma-separated).</li>
        </ul>
      </div>`;
    },

    compressCampaignImage(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            const maxW = 1200;
            let w = img.width;
            let h = img.height;
            if (w > maxW) {
              h = Math.round((h * maxW) / w);
              w = maxW;
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
          } catch (e) { reject(e); }
          URL.revokeObjectURL(url);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
        img.src = url;
      });
    },

    appCampaignCreateHtml(c) {
      c = c || this._appCampaign || {};
      let aud = {};
      try {
        const raw = c.audience_json;
        aud = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
      } catch (_) { aud = {}; }
      let branchIdsStr = '';
      try {
        const bj = c.branch_ids_json;
        const arr = bj ? (typeof bj === 'string' ? JSON.parse(bj) : bj) : [];
        branchIdsStr = Array.isArray(arr) ? arr.join(', ') : '';
      } catch (_) { /* */ }
      const customIds = (aud.web_customer_ids || aud.ids || []).join(', ');
      const audType = c.audience_type || 'all_app_users';
      const daysDefault = audType === 'not_ordered_recently' ? (aud.days || aud.inactive_days || 60) : (aud.days || 30);
      const sel = (opts, val) => opts.map(([v, l]) =>
        `<option value="${v}" ${String(val) === v ? 'selected' : ''}>${this.esc(l)}</option>`).join('');
      return `<div class="cc-card cc-form">
        <div class="cc-form-grid">
          <div class="cc-field"><label>Campaign name</label><input id="app-c-name" value="${this.esc(c.name || '')}"></div>
          <div class="cc-field"><label>Notification title</label><input id="app-c-title" value="${this.esc(c.title || '')}"></div>
          <div class="cc-field full"><label>Body</label><textarea id="app-c-body" rows="3">${this.esc(c.body || '')}</textarea></div>
          <div class="cc-field"><label>Image URL</label><input id="app-c-image-url" value="${this.esc(c.image_url && !String(c.image_url).startsWith('data:') ? c.image_url : '')}" placeholder="https://…"></div>
          <div class="cc-field"><label>Upload image</label><input type="file" accept="image/jpeg,image/png,image/webp" id="app-c-image-file" data-act="app-image-file"></div>
          <div class="cc-field full">${c.image_url ? `<img id="app-c-img-preview" src="${this.esc(c.image_url)}" alt="" style="max-height:120px;border-radius:8px">` : '<img id="app-c-img-preview" alt="" style="max-height:120px;display:none">'}</div>
          <div class="cc-field"><label>Button text</label><input id="app-c-button" value="${this.esc(c.button_text || '')}"></div>
          <div class="cc-field"><label>Destination</label><select id="app-c-dest-type">${sel(APP_DEST, c.destination_type || 'home')}</select></div>
          <div class="cc-field"><label>Destination ID</label><input id="app-c-dest-id" value="${this.esc(c.destination_id || '')}"></div>
          <div class="cc-field"><label>Custom URL</label><input id="app-c-dest-url" value="${this.esc(c.destination_url || '')}"></div>
          <div class="cc-field"><label>Category</label><select id="app-c-category">${sel(APP_CATEGORIES, c.category || 'special_offers')}</select></div>
          <div class="cc-field"><label>Audience</label><select id="app-c-audience">${sel(APP_AUDIENCE, c.audience_type || 'all_app_users')}</select></div>
          <div class="cc-field"><label>Branch ID (single branch audience)</label><input id="app-c-branch" value="${this.esc(c.branch_id || aud.branch_id || '')}"></div>
          <div class="cc-field"><label>Branch IDs (comma-separated)</label><input id="app-c-branch-ids" value="${this.esc(branchIdsStr)}" placeholder="1, 2, 3"></div>
          <div class="cc-field"><label>Product ID (purchased product)</label><input id="app-c-product-id" value="${this.esc(aud.product_id || '')}"></div>
          <div class="cc-field"><label>Days (ordered / inactive window)</label><input type="number" min="1" id="app-c-days" value="${this.esc(daysDefault)}"></div>
          <div class="cc-field full"><label>Customer IDs (segment / custom)</label><input id="app-c-custom-ids" value="${this.esc(customIds)}" placeholder="101, 102"></div>
          <div class="cc-field"><label>Schedule at</label><input type="datetime-local" id="app-c-scheduled" value="${this.esc((c.scheduled_at || '').replace(' ', 'T').slice(0, 16))}"></div>
        </div>
        ${this.audienceSegmentsHelpHtml()}
        <div id="app-c-audience-card"></div>
        <div class="cc-quick" style="margin-top:12px">
          <button type="button" class="btn btn-ghost btn-sm cc-btn" data-act="app-preview-audience">Preview Audience</button>
          <button type="button" class="btn btn-ghost btn-sm cc-btn" data-act="app-save-draft">Save Draft</button>
          <button type="button" class="btn btn-primary btn-sm cc-btn" data-act="app-schedule">Schedule</button>
          <button type="button" class="btn btn-primary btn-sm cc-btn" data-act="app-send-now">Send Now</button>
        </div>
      </div>`;
    },

    audiencePreviewCard(stats) {
      if (!stats) return '';
      return `<div class="cc-card" style="margin-top:12px;padding:12px">
        <h4>Campaign audience check</h4>
        <div class="cc-metrics">
          ${this.metric('Audience', stats.audience ?? 0)}
          ${this.metric('Eligible', stats.eligible ?? 0)}
          ${this.metric('Excluded', stats.excluded ?? 0)}
          ${this.metric('Marketing off', stats.marketing ?? stats.marketingExcluded ?? 0)}
        </div>
        ${stats.reasons_sample?.length ? `<p class="cc-muted">Sample exclusions: ${stats.reasons_sample.slice(0, 5).map((r) => this.esc(r.reason || r)).join(', ')}</p>` : ''}
      </div>`;
    },

    async viewAppNotifications() {
      this._appSub = this._appSub || 'create';
      const sub = this._appSub;
      const nav = this.appSubNav(sub, [
        ['create', 'Create Campaign'], ['scheduled', 'Scheduled'], ['sent', 'Sent'], ['analytics', 'Analytics']
      ]);
      const actor = this.actor();
      let body = '';

      if (sub === 'create') {
        body = this.appCampaignCreateHtml(this._appCampaign);
      } else if (sub === 'scheduled') {
        const list = await this.api(API.appNotifyListCampaigns({ status: 'scheduled' }, actor), 'Could not load campaigns') || [];
        const drafts = await this.api(API.appNotifyListCampaigns({ status: 'draft' }, actor), '') || [];
        const rows = [...list, ...drafts].map((r) => `<tr>
          <td>${this.esc(r.name)}</td><td>${this.statusDot(r.status)}</td>
          <td>${this.esc(r.scheduled_at || '—')}</td>
          <td>${this.esc(r.title || '')}</td>
          <td><button type="button" class="btn btn-ghost btn-xs cc-btn" data-act="app-cancel-campaign" data-id="${r.id}">Cancel</button></td>
        </tr>`).join('');
        body = this.panel('Scheduled & drafts', this.table(['Name', 'Status', 'When', 'Title', ''], rows, 'No scheduled campaigns'));
      } else if (sub === 'sent') {
        const list = await this.api(API.appNotifyListCampaigns({ status: 'sent' }, actor), 'Could not load sent') || [];
        const rows = list.map((r) => `<tr>
          <td>${this.esc(r.sent_at || r.updated_at || '')}</td>
          <td>${this.esc(r.name)}</td><td>${this.esc(r.delivered_count ?? '—')}</td>
          <td>${this.esc(r.eligible_count ?? '—')}</td>
          <td><button type="button" class="btn btn-ghost btn-xs cc-btn" data-act="app-analytics-pick" data-id="${r.id}">Analytics</button></td>
        </tr>`).join('');
        body = this.panel('Sent campaigns', this.table(['Sent', 'Name', 'Delivered', 'Eligible', ''], rows, 'No sent campaigns yet'));
      } else {
        const sent = await this.api(API.appNotifyListCampaigns({ status: 'sent' }, actor), '') || [];
        const opts = sent.map((c) => `<option value="${c.id}" ${String(this._appAnalyticsId) === String(c.id) ? 'selected' : ''}>${this.esc(c.name)} (#${c.id})</option>`).join('');
        let metrics = '<p class="cc-muted">Select a campaign to view metrics.</p>';
        if (this._appAnalyticsId) {
          const a = await this.api(API.appNotifyCampaignAnalytics(Number(this._appAnalyticsId), actor), 'Analytics failed');
          if (a) {
            const d = a.deliveries || {};
            const camp = a.campaign || {};
            const pct = (v) => (v != null && v !== '' ? `${(Number(v) * 100).toFixed(1)}%` : '—');
            metrics = `<div class="cc-metrics">
              ${this.metric('Delivered', d.delivered ?? camp.delivered_count ?? 0)}
              ${this.metric('Opened', a.opened_count ?? 0)}
              ${this.metric('Clicked', d.clicked ?? camp.clicked_count ?? 0)}
              ${this.metric('Orders', a.orders_count ?? camp.orders_count ?? 0)}
              ${this.metric('Revenue', camp.revenue_total != null ? camp.revenue_total : (a.revenue_total ?? '—'))}
              ${this.metric('Open rate', pct(a.open_rate))}
              ${this.metric('Click rate', pct(a.click_rate))}
              ${this.metric('Inbox rows', a.inbox ?? 0)}
              ${this.metric('Recipients', camp.recipients_count ?? '—')}
            </div>`;
          }
        }
        body = `<div class="cc-form"><label>Campaign</label>
          <select id="app-analytics-select" data-act="app-analytics-select">${opts || '<option value="">—</option>'}</select></div>
          ${this.panel('Campaign analytics', metrics)}`;
      }

      return `${nav}<div class="cc-grid" style="margin-top:12px">${body}</div>`;
    },

    promoFormHtml(p) {
      p = p || this._appPromoDraft || {};
      const sel = (opts, val) => opts.map(([v, l]) =>
        `<option value="${v}" ${String(val) === v ? 'selected' : ''}>${this.esc(l)}</option>`).join('');
      return `<div class="cc-card cc-form">
        <h4>${p.id ? 'Edit promotion' : 'New promotion'}</h4>
        <div class="cc-form-grid">
          <div class="cc-field"><label>Name</label><input id="app-p-name" value="${this.esc(p.name || '')}"></div>
          <div class="cc-field"><label>Product ID</label><input id="app-p-product" value="${this.esc(p.product_id || '')}"></div>
          <div class="cc-field"><label>Price</label><input id="app-p-price" type="number" step="0.01" value="${this.esc(p.price ?? '')}"></div>
          <div class="cc-field full"><label>Description</label><textarea id="app-p-desc" rows="2">${this.esc(p.description || '')}</textarea></div>
          <div class="cc-field"><label>Image URL</label><input id="app-p-image" value="${this.esc(p.image_url || '')}"></div>
          <div class="cc-field"><label>Branch ID</label><input id="app-p-branch" value="${this.esc(p.branch_id || '')}"></div>
          <div class="cc-field"><label>Start</label><input type="date" id="app-p-start" value="${this.esc((p.start_date || '').slice(0, 10))}"></div>
          <div class="cc-field"><label>End</label><input type="date" id="app-p-end" value="${this.esc((p.end_date || '').slice(0, 10))}"></div>
          <div class="cc-field full"><label>Terms</label><textarea id="app-p-terms" rows="2">${this.esc(p.terms || '')}</textarea></div>
          <div class="cc-field"><label>Button</label><input id="app-p-btn" value="${this.esc(p.button_text || 'ORDER NOW')}"></div>
          <div class="cc-field"><label>Destination</label><select id="app-p-dest">${sel(APP_DEST, p.destination_type || 'product')}</select></div>
          <div class="cc-field"><label>Dest. ID</label><input id="app-p-dest-id" value="${this.esc(p.destination_id || '')}"></div>
        </div>
        <div class="cc-quick" style="margin-top:10px">
          <button type="button" class="btn btn-ghost btn-sm cc-btn" data-act="app-promo-save">Save</button>
          ${p.id ? `<button type="button" class="btn btn-primary btn-sm cc-btn" data-act="app-promo-publish" data-id="${p.id}">Publish…</button>` : ''}
        </div>
      </div>`;
    },

    promoPublishModalHtml(id) {
      return `<div class="cc-card" id="app-promo-publish-modal" style="margin-top:12px;padding:12px;border:1px solid var(--cc-border,#333)">
        <h4>Publish promotion #${this.esc(id)}</h4>
        <div class="cc-checks">
          <label><input type="checkbox" id="app-pub-promotions" checked> Show in promotions</label>
          <label><input type="checkbox" id="app-pub-home"> Show on home</label>
          <label><input type="checkbox" id="app-pub-push"> Send push</label>
          <label><input type="checkbox" id="app-pub-inbox" checked> Add to inbox</label>
          <label><input type="checkbox" id="app-pub-branch"> Show on branch</label>
        </div>
        <div class="cc-quick" style="margin-top:10px">
          <button type="button" class="btn btn-primary btn-sm cc-btn" data-act="app-promo-publish-confirm" data-id="${id}">Publish</button>
          <button type="button" class="btn btn-ghost btn-sm cc-btn" data-act="app-promo-publish-cancel">Cancel</button>
        </div>
      </div>`;
    },

    readPromoForm(root) {
      const g = (id) => root.querySelector(`#${id}`)?.value?.trim() ?? '';
      return {
        id: this._appPromoDraft.id || undefined,
        name: g('app-p-name'),
        product_id: g('app-p-product') || null,
        price: g('app-p-price') ? Number(g('app-p-price')) : null,
        description: g('app-p-desc') || null,
        image_url: g('app-p-image') || null,
        branch_id: g('app-p-branch') || null,
        start_date: g('app-p-start') || null,
        end_date: g('app-p-end') || null,
        terms: g('app-p-terms') || null,
        button_text: g('app-p-btn') || 'ORDER NOW',
        destination_type: g('app-p-dest') || 'product',
        destination_id: g('app-p-dest-id') || null
      };
    },

    async viewPromotions() {
      const actor = this.actor();
      const list = await this.api(API.appNotifyListPromotions({}, actor), 'Could not load promotions') || [];
      const rows = list.map((r) => `<tr>
        <td>${this.esc(r.name)}</td><td>${this.statusDot(r.status)}</td>
        <td>${this.esc(r.price ?? '—')}</td>
        <td>${this.esc(r.start_date || '')} – ${this.esc(r.end_date || '')}</td>
        <td>
          <button type="button" class="btn btn-ghost btn-xs cc-btn" data-act="app-promo-edit" data-id="${r.id}">Edit</button>
          <button type="button" class="btn btn-ghost btn-xs cc-btn" data-act="app-promo-publish" data-id="${r.id}">Publish</button>
        </td>
      </tr>`).join('');
      const modal = this._appPromoPublishId ? this.promoPublishModalHtml(this._appPromoPublishId) : '';
      return `<div class="cc-grid">
        ${this.panel('Promotions', this.table(['Name', 'Status', 'Price', 'Dates', ''], rows, 'No promotions yet'))}
        ${this.promoFormHtml(this._appPromoDraft)}
        ${modal}
      </div>`;
    },

    async viewRatings() {
      const actor = this.actor();
      const overall = await this.api(API.appNotifyOverallRating(actor), 'Could not load rating') || {};
      const tab = this._ratingsTab || 'pending';
      const nav = this.appSubNav(tab, [
        ['pending', 'Pending'], ['approved', 'Approved'], ['hidden', 'Hidden'], ['reported', 'Reported'], ['audit', 'Audit log']
      ]);
      let body = '';
      if (tab === 'audit') {
        if (this._appAuditRows == null) {
          this._appAuditRows = await this.api(API.appNotifyAudit(50, actor), 'Could not load audit log') || [];
        }
        const auditRows = (this._appAuditRows || []).map((e) => `<tr>
          <td>${this.esc(String(e.created_at || '').slice(0, 19))}</td>
          <td>${this.esc(e.actor_name || '—')}</td>
          <td>${this.esc(e.action || '')}</td>
          <td>${this.esc(e.entity_type || '')}${e.entity_id != null ? ` #${e.entity_id}` : ''}</td>
        </tr>`).join('');
        body = this.panel('App channel audit', this.table(['When', 'Actor', 'Action', 'Entity'], auditRows, 'No audit entries yet'));
        body += `<div class="cc-quick" style="margin-top:8px"><button type="button" class="btn btn-ghost btn-sm cc-btn" data-act="app-audit-refresh">Refresh audit</button></div>`;
      } else {
        const list = await this.api(API.appNotifyListReviews({ status: tab }, actor), 'Could not load reviews') || [];
        const rows = list.map((r) => {
          const reply = r.admin_reply
            ? `<div class="cc-muted" style="font-size:12px;margin-top:4px"><strong>Admin reply:</strong> ${this.esc(r.admin_reply)}</div>`
            : '';
          return `<tr>
        <td>${'⭐'.repeat(Math.min(5, Number(r.rating) || 0))}</td>
        <td>${this.esc(r.customer_name || r.web_customer_id || '—')}</td>
        <td>${this.esc((r.review_text || r.comment || '').slice(0, 80))}${reply}</td>
        <td>${this.esc(r.created_at || '')}</td>
        <td class="cc-quick">
          ${tab === 'pending' ? `<button type="button" class="btn btn-ghost btn-xs cc-btn" data-act="app-review-approve" data-id="${r.id}">Approve</button>` : ''}
          ${tab !== 'hidden' ? `<button type="button" class="btn btn-ghost btn-xs cc-btn" data-act="app-review-hide" data-id="${r.id}">Hide</button>` : ''}
          <button type="button" class="btn btn-ghost btn-xs cc-btn" data-act="app-review-reply" data-id="${r.id}">Reply</button>
          <button type="button" class="btn btn-ghost btn-xs cc-btn" data-act="app-review-report" data-id="${r.id}">Report</button>
        </td>
      </tr>`;
        }).join('');
        body = this.panel('Reviews', this.table(['Rating', 'Customer', 'Comment', 'When', 'Actions'], rows, 'No reviews in this tab'));
      }

      const header = `<div class="cc-metrics" style="margin-bottom:12px">
        ${this.metric('Overall rating', overall.average != null ? `${overall.average} / 5` : '—', `${overall.count || 0} approved`)}
      </div>`;

      return `${header}${nav}<div style="margin-top:12px">${body}</div>`;
    },

    async appendAppDashboardMetrics(html) {
      const actor = this.actor();
      const d = await this.api(API.appNotifyDashboard(actor), 'App channel metrics unavailable');
      if (!d) return html;
      const block = `<div class="cc-grid" style="margin-bottom:14px">${this.panel('📱 Mobile app channel', `<div class="cc-metrics">
        ${this.metric('App users', d.app_users ?? 0)}
        ${this.metric('Active devices', d.active_devices ?? 0)}
        ${this.metric('Notifications enabled', d.notification_enabled ?? 0)}
        ${this.metric('Pending reviews', d.pending_reviews ?? 0, `${d.active_promotions ?? 0} promos · ${d.scheduled_campaigns ?? 0} scheduled`)}
      </div><div class="cc-quick" style="margin-top:8px">
        <button type="button" class="btn btn-ghost btn-sm" data-cc-act="goto" data-tab="app-notifications">App Notifications</button>
        <button type="button" class="btn btn-ghost btn-sm" data-cc-act="goto" data-tab="promotions">Promotions</button>
        <button type="button" class="btn btn-ghost btn-sm" data-cc-act="goto" data-tab="ratings">Reviews</button>
      </div>`)}</div>`;
      if (html.includes('cc-dash-layout')) {
        return html.replace('<div class="cc-dash-layout">', block + '<div class="cc-dash-layout">');
      }
      return block + html;
    },

    bindAppChannelActions(root) {
      if (!root || root.dataset.appChannelBound) return;
      root.dataset.appChannelBound = '1';

      root.addEventListener('change', (e) => {
        if (e.target.id === 'app-c-image-file' || e.target.matches('[data-act="app-image-file"]')) {
          const file = e.target.files?.[0];
          if (!file) return;
          this.compressCampaignImage(file).then((dataUrl) => {
            const img = root.querySelector('#app-c-img-preview');
            if (img) { img.src = dataUrl; img.style.display = 'block'; }
          }).catch(() => this.toast('Could not process image', 'error'));
        }
        if (e.target.id === 'app-analytics-select') {
          this._appAnalyticsId = e.target.value || null;
          this.renderTab();
        }
      });

      root.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn || !root.contains(btn)) return;
        const act = btn.dataset.act;
        const actor = this.actor();
        const id = btn.dataset.id;

        try {
          if (act === 'app-sub') {
            if (this.tab === 'app-notifications') this._appSub = btn.dataset.sub || 'create';
            else if (this.tab === 'ratings') this._ratingsTab = btn.dataset.sub || 'pending';
            await this.renderTab();
            return;
          }

          if (act === 'app-preview-audience') {
            const data = this.readAppCampaignForm(root);
            const stats = await this.api(API.appNotifyPreviewAudience(data, actor), 'Preview failed');
            this._appAudiencePreview = stats;
            this._appAudiencePreviewKey = this.appCampaignFormKey(root);
            const slot = root.querySelector('#app-c-audience-card');
            if (slot && stats) slot.innerHTML = this.audiencePreviewCard(stats);
            return;
          }

          if (act === 'app-audit-refresh') {
            this._appAuditRows = null;
            await this.renderTab();
            return;
          }

          if (act === 'app-save-draft') {
            const data = this.readAppCampaignForm(root);
            data.status = 'draft';
            const saved = await this.api(API.appNotifySaveCampaign(data, actor), 'Save failed');
            if (saved) {
              this._appCampaign = saved;
              this.toast('Draft saved', 'success');
            }
            return;
          }

          if (act === 'app-schedule') {
            const data = this.readAppCampaignForm(root);
            if (!data.scheduled_at) { this.toast('Set schedule date/time', 'error'); return; }
            data.status = 'draft';
            const saved = await this.api(API.appNotifySaveCampaign(data, actor), 'Save failed');
            if (!saved?.id) return;
            const r = await this.api(API.appNotifyScheduleCampaign(saved.id, data.scheduled_at.replace('T', ' '), actor), 'Schedule failed');
            if (r) { this.toast('Campaign scheduled', 'success'); this._appSub = 'scheduled'; await this.renderTab(); }
            return;
          }

          if (act === 'app-send-now') {
            const data = this.readAppCampaignForm(root);
            const formKey = this.appCampaignFormKey(root);
            let stats = this._appAudiencePreview;
            if (!stats || this._appAudiencePreviewKey !== formKey) {
              stats = await this.api(API.appNotifyPreviewAudience(data, actor), 'Preview audience before send');
              if (!stats) return;
              this._appAudiencePreview = stats;
              this._appAudiencePreviewKey = formKey;
            }
            const eligible = Number(stats.eligible ?? 0);
            if (eligible <= 0) {
              this.toast('No eligible recipients — adjust audience or category preferences', 'error');
              const slot = root.querySelector('#app-c-audience-card');
              if (slot) slot.innerHTML = this.audiencePreviewCard(stats);
              return;
            }
            const excluded = Number(stats.excluded ?? stats.marketing ?? 0);
            if (!confirm(`Send now?\nEligible: ${eligible}\nExcluded: ${excluded}\nAudience size: ${stats.audience ?? '—'}`)) return;
            const saved = await this.api(API.appNotifySaveCampaign(data, actor), 'Save failed');
            if (!saved?.id) return;
            const r = await this.api(API.appNotifySendCampaign(saved.id, actor), 'Send failed');
            if (r) {
              this.toast('Campaign sent', 'success');
              this._appCampaign = {};
              this._appAudiencePreview = null;
              this._appSub = 'sent';
              await this.renderTab();
            }
            return;
          }

          if (act === 'app-cancel-campaign') {
            if (!confirm('Cancel this campaign?')) return;
            const r = await this.api(API.appNotifyCancelCampaign(Number(id), actor), 'Cancel failed');
            if (r) { this.toast('Cancelled', 'success'); await this.renderTab(); }
            return;
          }

          if (act === 'app-analytics-pick') {
            this._appAnalyticsId = id;
            this._appSub = 'analytics';
            await this.renderTab();
            return;
          }

          if (act === 'app-promo-save') {
            const data = this.readPromoForm(root);
            const saved = await this.api(API.appNotifySavePromotion(data, actor), 'Save promotion failed');
            if (saved) {
              this._appPromoDraft = saved;
              this.toast('Promotion saved', 'success');
              await this.renderTab();
            }
            return;
          }

          if (act === 'app-promo-edit') {
            const actor2 = this.actor();
            const all = await this.api(API.appNotifyListPromotions({}, actor2), '') || [];
            const row = all.find((x) => String(x.id) === String(id));
            if (row) { this._appPromoDraft = row; await this.renderTab(); }
            return;
          }

          if (act === 'app-promo-publish') {
            this._appPromoPublishId = id;
            await this.renderTab();
            return;
          }

          if (act === 'app-promo-publish-cancel') {
            this._appPromoPublishId = null;
            await this.renderTab();
            return;
          }

          if (act === 'app-promo-publish-confirm') {
            const opts = {
              show_in_promotions: root.querySelector('#app-pub-promotions')?.checked,
              show_on_home: root.querySelector('#app-pub-home')?.checked,
              send_push: root.querySelector('#app-pub-push')?.checked,
              add_to_inbox: root.querySelector('#app-pub-inbox')?.checked,
              show_on_branch: root.querySelector('#app-pub-branch')?.checked
            };
            const r = await this.api(API.appNotifyPublishPromotion(Number(id), opts, actor), 'Publish failed');
            if (r) {
              this._appPromoPublishId = null;
              this.toast('Promotion published', 'success');
              await this.renderTab();
            }
            return;
          }

          if (act === 'app-review-approve') {
            const r = await this.api(API.appNotifyModerateReview(Number(id), 'approve', null, actor), 'Approve failed');
            if (r) { this.toast('Approved', 'success'); await this.renderTab(); }
            return;
          }

          if (act === 'app-review-hide') {
            const r = await this.api(API.appNotifyModerateReview(Number(id), 'hide', null, actor), 'Hide failed');
            if (r) { this.toast('Hidden', 'success'); await this.renderTab(); }
            return;
          }

          if (act === 'app-review-report') {
            const reason = prompt('Report reason (optional):') ?? '';
            const r = await this.api(API.appNotifyModerateReview(Number(id), 'report', reason || null, actor), 'Report failed');
            if (r) { this.toast('Reported', 'success'); await this.renderTab(); }
            return;
          }

          if (act === 'app-review-reply') {
            const reply = prompt('Admin reply:');
            if (reply == null || !reply.trim()) return;
            const r = await this.api(API.appNotifyReplyReview(Number(id), reply.trim(), actor), 'Reply failed');
            if (r) { this.toast('Reply saved', 'success'); await this.renderTab(); }
            return;
          }
        } catch (err) {
          this.toast(err?.message || 'Action failed', 'error');
        }
      });
    }
  });

  const _origRenderTab = P.renderTab;
  P.renderTab = async function () {
    if (['app-notifications', 'promotions', 'ratings'].includes(this.tab)) {
      const body = document.getElementById('cc-body');
      if (!body) return;
      body.innerHTML = `<p class="cc-muted">Loading…</p>`;
      try {
        let html = '';
        if (this.tab === 'app-notifications') html = await this.viewAppNotifications();
        else if (this.tab === 'promotions') html = await this.viewPromotions();
        else html = await this.viewRatings();
        body.innerHTML = html;
        this.bindAppChannelActions?.(body);
      } catch (e) {
        body.innerHTML = `<p class="cc-error">${this.esc(e.message)}</p>`;
      }
      return;
    }
    if (typeof _origRenderTab === 'function') return _origRenderTab.call(this);
  };

  const _origViewDashboard = P.viewDashboard;
  if (typeof _origViewDashboard === 'function') {
    P.viewDashboard = async function () {
      const html = await _origViewDashboard.call(this);
      return this.appendAppDashboardMetrics(html);
    };
  }
})();

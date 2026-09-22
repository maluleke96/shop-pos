/**
 * Admin → Communication Center
 * Dark themed outbound messaging hub for the shop.
 */
window.AdminCommunicationCenterPage = {
  el: null,
  app: null,
  tab: 'dashboard',
  _cache: {},
  historyFilters: { q: '', channel: '', status: '', from: '', to: '' },
  compose: {
    channels: ['whatsapp'],
    audience: 'all_eligible',
    branch_id: '',
    body: '',
    subject: '',
    name: '',
    scheduled_at: '',
    recipient_phone: '',
    recipient_name: '',
    media_url: ''
  },

  TABS: [
    ['dashboard', 'Dashboard'],
    ['notifications', 'Notifications'],
    ['whatsapp', 'WhatsApp'],
    ['sms', 'SMS'],
    ['email', 'Email'],
    ['social', 'Social'],
    ['customers', 'Customers'],
    ['campaigns', 'Campaigns'],
    ['automation', 'Automation'],
    ['templates', 'Templates'],
    ['scheduled', 'Scheduled'],
    ['media', 'Media'],
    ['history', 'History'],
    ['failed', 'Failed'],
    ['connections', 'Connections'],
    ['settings', 'Settings']
  ],

  CHANNELS: ['whatsapp', 'sms', 'email', 'inapp', 'facebook', 'instagram', 'tiktok', 'youtube', 'x'],
  MSG_CHANNELS: ['whatsapp', 'sms', 'email', 'inapp'],
  SOCIAL_CHANNELS: ['facebook', 'instagram', 'tiktok', 'youtube', 'x'],
  AUDIENCE_TYPES: [
    ['all_eligible', 'All eligible'],
    ['loyalty', 'Loyalty members'],
    ['recent', 'Recent (30 days)'],
    ['inactive', 'Inactive (60+ days)'],
    ['branch', 'By branch']
  ],

  actor() {
    return this.app?.user || (typeof App !== 'undefined' && App.user) || null;
  },

  esc(v) {
    return (typeof Utils !== 'undefined' && Utils.escHtml)
      ? Utils.escHtml(v)
      : String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  toast(msg, type) {
    if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(msg, type || 'info');
  },

  async api(promise, errMsg) {
    let r;
    try {
      r = await promise;
    } catch (e) {
      this.toast(e?.message || errMsg || 'Request failed', 'error');
      return null;
    }
    if (!r || r.success === false) {
      this.toast((r && r.error) || errMsg || 'Request failed', 'error');
      return null;
    }
    return r.data !== undefined ? r.data : r;
  },

  ensureCss() {
    if (document.getElementById('cc-dept-css')) return;
    const l = document.createElement('link');
    l.id = 'cc-dept-css';
    l.rel = 'stylesheet';
    l.href = 'css/communication-center.css';
    document.head.appendChild(l);
  },

  parseJson(v, fb) {
    if (v == null || v === '') return fb;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return fb; }
  },

  statusClass(status) {
    const s = String(status || '').toLowerCase();
    if (['connected', 'sent', 'delivered', 'ok', 'active', 'queued', 'sending'].includes(s)) return 'ok';
    if (['needs_attention', 'pending', 'retrying', 'processing', 'scheduled', 'draft'].includes(s)) return 'warn';
    if (['disconnected', 'failed', 'cancelled', 'error'].includes(s)) return 'bad';
    return 'muted';
  },

  statusDot(status) {
    const cls = this.statusClass(status);
    return `<span class="cc-status ${cls}">${this.esc(status || '—')}</span>`;
  },

  secretField(id, value, placeholder) {
    const configured = !!(value && String(value).includes('••')) || (value && String(value).length > 0 && String(value) === '••••configured');
    const ph = configured || (value && String(value).includes('••')) ? '••••configured' : (placeholder || '');
    return `<input type="password" id="${id}" autocomplete="new-password" placeholder="${this.esc(ph)}" value="">`;
  },

  readSecret(id) {
    const el = document.getElementById(id);
    if (!el) return undefined;
    const v = el.value.trim();
    if (!v || v.includes('••')) return undefined;
    return v;
  },

  async render(el, app) {
    this.el = el;
    this.app = app || this.app;
    this.ensureCss();
    el.innerHTML = `<div class="cc-root"><div class="cc-shell">
      <div class="cc-header">
        <div>
          <h2>Communication Center</h2>
          <p class="cc-sub">Outbound WhatsApp, SMS, Email, Social &amp; in-app</p>
        </div>
        <div class="cc-header-actions">
          <button type="button" class="btn btn-primary btn-sm" data-cc-act="goto" data-tab="dashboard" data-focus="compose">Create Message</button>
          <button type="button" class="btn btn-ghost btn-sm" data-cc-act="process-queue">Process Queue</button>
        </div>
      </div>
      <nav class="cc-tabs" id="cc-tabs" aria-label="Communication Center tabs"></nav>
      <div class="cc-body" id="cc-body"><p class="cc-muted">Loading…</p></div>
    </div></div>`;
    this.paintTabs();
    this.bind();
    await this.renderTab();
  },

  paintTabs() {
    const nav = document.getElementById('cc-tabs');
    if (!nav) return;
    nav.innerHTML = this.TABS.map(([id, label]) =>
      `<button type="button" class="cc-tab ${this.tab === id ? 'active' : ''}" data-cc-act="nav" data-tab="${id}">${this.esc(label)}</button>`
    ).join('');
  },

  bind() {
    if (this._bound) return;
    this._bound = true;
    this.el?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-cc-act]');
      if (!btn || !this.el.contains(btn)) return;
      const act = btn.dataset.ccAct;
      try {
        if (act === 'nav' || act === 'goto') {
          this.tab = btn.dataset.tab || 'dashboard';
          this.paintTabs();
          await this.renderTab();
          if (btn.dataset.focus === 'compose') {
            document.getElementById('cc-compose-body')?.focus();
          }
          return;
        }
        await this.handleAction(act, btn.dataset, btn);
      } catch (err) {
        this.toast(err?.message || 'Action failed', 'error');
      }
    });
  },

  async handleAction(act, ds) {
    const actor = this.actor();
    switch (act) {
      case 'process-queue': {
        const r = await this.api(API.ccProcessQueue(actor), 'Queue process failed');
        if (r) {
          this.toast(`Processed ${r.processed != null ? r.processed : 0} job(s)`, 'success');
          await this.renderTab();
        }
        break;
      }
      case 'retry': {
        const r = await this.api(API.ccRetry(Number(ds.id), actor), 'Retry failed');
        if (r) { this.toast('Queued for retry', 'success'); await this.renderTab(); }
        break;
      }
      case 'cancel': {
        const r = await this.api(API.ccCancel(Number(ds.id), actor), 'Cancel failed');
        if (r) { this.toast('Cancelled', 'success'); await this.renderTab(); }
        break;
      }
      case 'send-now': {
        const r = await this.api(API.ccSendNow(Number(ds.id), actor), 'Send now failed');
        if (r) { this.toast('Sending now', 'success'); await this.renderTab(); }
        break;
      }
      case 'save-event':
        await this.saveEventType(ds.key, ds.sid);
        break;
      case 'save-connection':
        await this.saveConnectionForm(ds.channel);
        break;
      case 'preview-audience':
        await this.previewAudience(ds.source || 'compose');
        break;
      case 'compose-send':
        await this.submitCompose(ds.mode || 'now');
        break;
      case 'campaign-send':
        await this.submitCampaign();
        break;
      case 'save-automation':
        await this.saveAutomationForm();
        break;
      case 'toggle-auto': {
        const enabled = ds.enabled === '1' || ds.enabled === 'true';
        const r = await this.api(API.ccSetAutomationEnabled(Number(ds.id), !enabled, actor), 'Could not update automation');
        if (r) { this.toast(!enabled ? 'Automation enabled' : 'Automation disabled', 'success'); await this.renderTab(); }
        break;
      }
      case 'save-template':
        await this.saveTemplateForm();
        break;
      case 'edit-template':
        this.fillTemplateForm(Number(ds.id));
        break;
      case 'new-template':
        this.clearTemplateForm();
        break;
      case 'save-branch':
        await this.saveBranchForm(Number(ds.branchId));
        break;
      case 'save-settings':
        await this.saveSettingsForm();
        break;
      case 'history-filter':
        this.historyFilters = {
          q: document.getElementById('cc-hist-q')?.value.trim() || '',
          channel: document.getElementById('cc-hist-channel')?.value || '',
          status: document.getElementById('cc-hist-status')?.value || '',
          from: document.getElementById('cc-hist-from')?.value || '',
          to: document.getElementById('cc-hist-to')?.value || ''
        };
        await this.renderTab();
        break;
      case 'open-share':
        window.CCSharePublish?.open({ title: '', body: '', mediaUrl: '', sourceModule: 'communication-center', app: this.app });
        break;
      default:
        break;
    }
  },

  async renderTab() {
    const body = document.getElementById('cc-body');
    if (!body) return;
    body.innerHTML = `<p class="cc-muted">Loading ${this.esc(this.tab)}…</p>`;
    try {
      let html = '';
      switch (this.tab) {
        case 'dashboard': html = await this.viewDashboard(); break;
        case 'notifications': html = await this.viewNotifications(); break;
        case 'whatsapp': html = await this.viewChannelConnection('whatsapp'); break;
        case 'sms': html = await this.viewChannelConnection('sms'); break;
        case 'email': html = await this.viewChannelConnection('email'); break;
        case 'social': html = await this.viewSocial(); break;
        case 'customers': html = await this.viewCustomers(); break;
        case 'campaigns': html = await this.viewCampaigns(); break;
        case 'automation': html = await this.viewAutomation(); break;
        case 'templates': html = await this.viewTemplates(); break;
        case 'scheduled': html = await this.viewScheduled(); break;
        case 'media': html = await this.viewMedia(); break;
        case 'history': html = await this.viewHistory(); break;
        case 'failed': html = await this.viewFailed(); break;
        case 'connections': html = await this.viewConnections(); break;
        case 'settings': html = await this.viewSettings(); break;
        default: html = `<p class="cc-error">Unknown tab</p>`;
      }
      body.innerHTML = html;
    } catch (err) {
      body.innerHTML = `<p class="cc-error">${this.esc(err.message || 'Failed to load')}</p>`;
    }
  },

  metric(label, value, sub) {
    return `<div class="cc-metric">
      <span class="cc-metric-label">${this.esc(label)}</span>
      <span class="cc-metric-value">${this.esc(value)}</span>
      ${sub != null ? `<span class="cc-metric-sub">${this.esc(sub)}</span>` : ''}
    </div>`;
  },

  panel(title, bodyHtml, actionsHtml) {
    return `<div class="cc-panel">
      <div class="cc-panel-h"><h4>${this.esc(title)}</h4>${actionsHtml || ''}</div>
      <div class="cc-panel-b">${bodyHtml}</div>
    </div>`;
  },

  table(headers, rowsHtml, empty) {
    if (!rowsHtml) return `<div class="cc-empty">${this.esc(empty || 'No records')}</div>`;
    return `<div class="cc-table-wrap"><table class="cc-table">
      <thead><tr>${headers.map((h) => `<th>${this.esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>`;
  },

  /* ─── Dashboard ─────────────────────────────────────────────────────── */

  async viewDashboard() {
    const actor = this.actor();
    const dash = await this.api(API.ccDashboard(actor), 'Could not load dashboard') || {};
    this._cache.dashboard = dash;
    const t = dash.totals || {};
    const recent = dash.recent || [];
    const conns = dash.connections || [];
    const series = dash.overview_7d || [];

    const maxDay = Math.max(1, ...series.map((d) =>
      Number(d.whatsapp || 0) + Number(d.sms || 0) + Number(d.email || 0)
      + Number(d.facebook || 0) + Number(d.instagram || 0) + Number(d.tiktok || 0)
    ));

    const chart = series.length ? `<div class="cc-chart">
      ${series.map((d) => {
        const wa = Number(d.whatsapp || 0);
        const sms = Number(d.sms || 0);
        const email = Number(d.email || 0);
        const social = Number(d.facebook || 0) + Number(d.instagram || 0) + Number(d.tiktok || 0);
        const total = wa + sms + email + social;
        const h = (n) => Math.max(0, Math.round((n / maxDay) * 100));
        const label = String(d.date || '').slice(5);
        return `<div class="cc-bar-col">
          <span class="cc-bar-val">${total}</span>
          <div class="cc-bar-stack">
            <div class="cc-bar-seg whatsapp" style="height:${h(wa)}%"></div>
            <div class="cc-bar-seg sms" style="height:${h(sms)}%"></div>
            <div class="cc-bar-seg email" style="height:${h(email)}%"></div>
            <div class="cc-bar-seg social" style="height:${h(social)}%"></div>
          </div>
          <span class="cc-bar-label">${this.esc(label)}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="cc-legend">
      <span class="lg-wa">WhatsApp</span><span class="lg-sms">SMS</span>
      <span class="lg-email">Email</span><span class="lg-social">Social</span>
    </div>` : `<div class="cc-empty">No chart data yet</div>`;

    const recentRows = recent.map((r) => `<tr>
      <td>${this.esc(r.created_at || '')}</td>
      <td>${this.esc(r.event_key || '—')}</td>
      <td>${this.esc(r.recipient_name || r.recipient_type || '—')}</td>
      <td>${this.esc(r.channel || '')}</td>
      <td>${this.statusDot(r.status)}</td>
      <td>${this.esc((r.body || '').slice(0, 60))}${(r.body || '').length > 60 ? '…' : ''}</td>
    </tr>`).join('');

    const connList = conns.length ? `<div class="cc-conn-list">${conns.map((c) => `
      <div class="cc-conn-row">
        <div><strong>${this.esc(c.channel)}</strong>
          <small>${this.esc(c.provider || c.last_checked_at || '')}</small></div>
        ${this.statusDot(c.status)}
      </div>`).join('')}</div>` : `<div class="cc-empty">No connections</div>`;

    return `
      <div class="cc-metrics">
        ${this.metric('WhatsApp today', t.whatsapp ?? 0, 'Sent / delivered')}
        ${this.metric('SMS today', t.sms ?? 0)}
        ${this.metric('Email today', t.email ?? 0)}
        ${this.metric('Notifications', t.inapp ?? 0, 'In-app')}
        ${this.metric('Social today', t.social ?? 0)}
      </div>
      <div class="cc-grid" style="margin-bottom:14px">
        ${this.panel('Quick actions', `<div class="cc-quick">
          <button type="button" class="btn btn-primary btn-sm" data-cc-act="goto" data-tab="dashboard" data-focus="compose">Create Message</button>
          <button type="button" class="btn btn-ghost btn-sm" data-cc-act="goto" data-tab="campaigns">Run Campaign</button>
          <button type="button" class="btn btn-ghost btn-sm" data-cc-act="goto" data-tab="scheduled">Schedule</button>
          <button type="button" class="btn btn-ghost btn-sm" data-cc-act="goto" data-tab="templates">Templates</button>
          <button type="button" class="btn btn-ghost btn-sm" data-cc-act="goto" data-tab="automation">Automation</button>
          <button type="button" class="btn btn-ghost btn-sm" data-cc-act="open-share">Share / Publish</button>
        </div>`)}
      </div>
      <div class="cc-dash-layout">
        <div class="cc-grid">
          ${this.panel('Last 7 days', chart)}
          ${this.panel('Recent activity', this.table(
            ['When', 'Event', 'Recipient', 'Channel', 'Status', 'Preview'],
            recentRows,
            'No recent messages'
          ))}
        </div>
        <div class="cc-grid">
          ${this.panel('API connections', connList, `<button type="button" class="btn btn-ghost btn-sm" data-cc-act="goto" data-tab="connections">Manage</button>`)}
          ${this.panel('Create Message / Share', this.composeFormHtml())}
        </div>
      </div>`;
  },

  composeFormHtml(prefix = 'cc-compose') {
    const c = this.compose;
    return `<div class="cc-form-grid">
      <div class="cc-field full"><label>Name / subject</label>
        <input id="${prefix}-name" value="${this.esc(c.name)}" placeholder="Campaign or message name"></div>
      <div class="cc-field full"><label>Subject (email)</label>
        <input id="${prefix}-subject" value="${this.esc(c.subject)}" placeholder="Optional email subject"></div>
      <div class="cc-field full"><label>Message body</label>
        <textarea id="${prefix}-body" rows="4" placeholder="Write your message…">${this.esc(c.body)}</textarea></div>
      <div class="cc-field full"><label>Channels</label>
        <div class="cc-checks" id="${prefix}-channels">
          ${this.MSG_CHANNELS.map((ch) => `
            <label><input type="checkbox" value="${ch}" ${c.channels.includes(ch) ? 'checked' : ''}> ${this.esc(ch)}</label>`).join('')}
          ${this.SOCIAL_CHANNELS.map((ch) => `
            <label><input type="checkbox" value="${ch}" ${c.channels.includes(ch) ? 'checked' : ''}> ${this.esc(ch)}</label>`).join('')}
        </div>
      </div>
      <div class="cc-field"><label>Audience</label>
        <select id="${prefix}-audience">
          ${this.AUDIENCE_TYPES.map(([v, l]) => `<option value="${v}" ${c.audience === v ? 'selected' : ''}>${this.esc(l)}</option>`).join('')}
          <option value="manual" ${c.audience === 'manual' ? 'selected' : ''}>Single recipient</option>
        </select>
      </div>
      <div class="cc-field"><label>Branch ID (if by branch)</label>
        <input id="${prefix}-branch" value="${this.esc(c.branch_id)}" placeholder="Branch id"></div>
      <div class="cc-field"><label>Recipient phone (manual)</label>
        <input id="${prefix}-phone" value="${this.esc(c.recipient_phone)}" placeholder="+27…"></div>
      <div class="cc-field"><label>Recipient name</label>
        <input id="${prefix}-rname" value="${this.esc(c.recipient_name)}"></div>
      <div class="cc-field"><label>Media URL</label>
        <input id="${prefix}-media" value="${this.esc(c.media_url)}" placeholder="https://…"></div>
      <div class="cc-field"><label>Schedule at</label>
        <input type="datetime-local" id="${prefix}-when" value="${this.esc(c.scheduled_at)}"></div>
    </div>
    <div class="cc-actions">
      <button type="button" class="btn btn-primary btn-sm" data-cc-act="compose-send" data-mode="now">Send Now</button>
      <button type="button" class="btn btn-ghost btn-sm" data-cc-act="compose-send" data-mode="schedule">Schedule</button>
      <button type="button" class="btn btn-ghost btn-sm" data-cc-act="compose-send" data-mode="draft">Draft</button>
      <button type="button" class="btn btn-ghost btn-sm" data-cc-act="preview-audience">Preview audience</button>
      <span id="${prefix}-preview" class="cc-muted" style="align-self:center"></span>
    </div>`;
  },

  readCompose(prefix = 'cc-compose') {
    const checks = [...(document.getElementById(`${prefix}-channels`)?.querySelectorAll('input:checked') || [])]
      .map((i) => i.value);
    return {
      name: document.getElementById(`${prefix}-name`)?.value.trim() || '',
      subject: document.getElementById(`${prefix}-subject`)?.value.trim() || '',
      body: document.getElementById(`${prefix}-body`)?.value || '',
      channels: checks.length ? checks : ['whatsapp'],
      audience: document.getElementById(`${prefix}-audience`)?.value || 'all_eligible',
      branch_id: document.getElementById(`${prefix}-branch`)?.value.trim() || '',
      recipient_phone: document.getElementById(`${prefix}-phone`)?.value.trim() || '',
      recipient_name: document.getElementById(`${prefix}-rname`)?.value.trim() || '',
      media_url: document.getElementById(`${prefix}-media`)?.value.trim() || '',
      scheduled_at: document.getElementById(`${prefix}-when`)?.value || ''
    };
  },

  audiencePayload(c) {
    if (c.audience === 'manual') {
      return { type: 'manual', phone: c.recipient_phone, name: c.recipient_name, email: null };
    }
    const a = { type: c.audience || 'all_eligible' };
    if (c.audience === 'branch' && c.branch_id) a.branch_id = Number(c.branch_id);
    return a;
  },

  async previewAudience(source = 'compose') {
    const actor = this.actor();
    let audience;
    let previewEl;
    if (source === 'campaign') {
      const type = document.getElementById('cc-camp-aud')?.value || 'all_eligible';
      const branch_id = document.getElementById('cc-camp-branch')?.value.trim();
      audience = { type };
      if (type === 'branch' && branch_id) audience.branch_id = Number(branch_id);
      previewEl = document.getElementById('cc-camp-preview');
    } else {
      const c = this.readCompose();
      this.compose = { ...this.compose, ...c };
      audience = this.audiencePayload(c);
      previewEl = document.getElementById('cc-compose-preview');
    }
    const count = await this.api(API.ccPreviewAudience(audience, actor), 'Preview failed');
    const n = (count && typeof count === 'object' && count.count != null) ? count.count : count;
    if (previewEl) previewEl.textContent = `Audience ≈ ${n != null ? n : '—'} recipients`;
    this.toast(`Audience preview: ${n != null ? n : 0}`, 'info');
  },

  async submitCompose(mode) {
    const c = this.readCompose();
    this.compose = { ...this.compose, ...c };
    if (!c.body.trim() && mode !== 'draft') {
      this.toast('Message body is required', 'error');
      return;
    }
    const actor = this.actor();
    const audience = this.audiencePayload(c);
    let r;
    if (c.audience === 'manual' || mode === 'draft') {
      r = await this.api(API.ccCreateMessage({
        name: c.name || c.subject || 'Message',
        subject: c.subject,
        body: c.body,
        channels: c.channels,
        mode,
        scheduled_at: mode === 'schedule' ? this.toSqlDatetime(c.scheduled_at) : null,
        recipient_phone: c.recipient_phone,
        recipient_name: c.recipient_name,
        media_url: c.media_url || null,
        audience,
        source_module: 'communication-center'
      }, actor), 'Could not create message');
    } else {
      r = await this.api(API.ccSharePublish({
        title: c.name || c.subject || 'Message',
        subject: c.subject,
        body: c.body,
        channels: c.channels,
        mode,
        scheduled_at: mode === 'schedule' ? this.toSqlDatetime(c.scheduled_at) : null,
        media_url: c.media_url || null,
        audience,
        source_module: 'communication-center'
      }, actor), 'Could not send message');
    }
    if (r) {
      this.toast(mode === 'draft' ? 'Draft saved' : (mode === 'schedule' ? 'Scheduled' : `Queued ${r.queued != null ? r.queued : ''}`), 'success');
      await this.renderTab();
    }
  },

  toSqlDatetime(v) {
    if (!v) return null;
    // datetime-local → "YYYY-MM-DD HH:MM:SS"
    if (v.includes('T')) return v.replace('T', ' ') + (v.length === 16 ? ':00' : '');
    return v;
  },

  /* ─── Notifications / event types ───────────────────────────────────── */

  async viewNotifications() {
    const actor = this.actor();
    const events = await this.api(API.ccEventTypes(actor), 'Could not load event types') || [];
    const channelOpts = this.MSG_CHANNELS.concat(this.SOCIAL_CHANNELS);

    const rows = (Array.isArray(events) ? events : []).map((ev, idx) => {
      const chans = this.parseJson(ev.default_channels_json, []);
      const key = ev.event_key || '';
      const sid = `ev${idx}`;
      return `<tr data-event-key="${this.esc(key)}">
        <td><strong>${this.esc(ev.label || key)}</strong><br>
          <small class="cc-muted">${this.esc(key)} · ${this.esc(ev.category || '')}</small></td>
        <td>
          <div class="cc-checks" id="cc-ev-ch-${sid}" data-event-key="${this.esc(key)}">
            ${channelOpts.map((ch) => `
              <label><input type="checkbox" value="${ch}" ${chans.includes(ch) ? 'checked' : ''}> ${this.esc(ch)}</label>`).join('')}
          </div>
        </td>
        <td>
          <label class="cc-checks"><input type="checkbox" id="cc-ev-en-${sid}" ${Number(ev.enabled) ? 'checked' : ''}> Enabled</label>
        </td>
        <td>
          <button type="button" class="btn btn-primary btn-sm" data-cc-act="save-event" data-key="${this.esc(key)}" data-sid="${sid}">Save</button>
        </td>
      </tr>`;
    }).join('');

    return this.panel('Notification event types',
      `<p class="cc-note">Toggle default channels per system event. Changes apply to future emits.</p>
      ${this.table(['Event', 'Default channels', 'Enabled', ''], rows, 'No event types')}`
    );
  },

  async saveEventType(eventKey, sid) {
    const wrap = sid
      ? document.getElementById(`cc-ev-ch-${sid}`)
      : document.querySelector(`[data-event-key="${CSS.escape ? CSS.escape(eventKey) : eventKey}"].cc-checks`);
    const channels = [...(wrap?.querySelectorAll('input:checked') || [])].map((i) => i.value);
    const enabled = sid
      ? !!document.getElementById(`cc-ev-en-${sid}`)?.checked
      : true;
    const r = await this.api(API.ccSaveEventType({
      event_key: eventKey,
      default_channels: channels,
      enabled
    }, this.actor()), 'Save event failed');
    if (r) this.toast('Event type saved', 'success');
  },

  /* ─── Channel connection forms ──────────────────────────────────────── */

  findConn(list, channel) {
    return (list || []).find((c) => c.channel === channel) || { channel, status: 'disconnected', config: {} };
  },

  async viewChannelConnection(channel) {
    const actor = this.actor();
    const [conns, settings] = await Promise.all([
      this.api(API.ccConnections(actor), 'Could not load connections'),
      this.api(API.ccSettings(actor), 'Could not load settings')
    ]);
    const conn = this.findConn(conns || [], channel);
    const cfg = conn.config || {};
    const sms = settings?.sms || {};
    const email = settings?.email || {};

    let fields = '';
    if (channel === 'whatsapp') {
      fields = `
        <div class="cc-field"><label>Phone number ID</label>
          <input id="cc-conn-phone_number_id" value="${this.esc(cfg.phone_number_id || '')}"></div>
        <div class="cc-field"><label>Business account ID</label>
          <input id="cc-conn-business_account_id" value="${this.esc(cfg.business_account_id || '')}"></div>
        <div class="cc-field"><label>Default branch phone</label>
          <input id="cc-conn-default_branch_phone" value="${this.esc(cfg.default_branch_phone || '')}"></div>
        <div class="cc-field full"><label>Cloud API key</label>
          ${this.secretField('cc-conn-api_key', cfg.cloud_api ? '••••configured' : '', 'Paste API key')}</div>`;
    } else if (channel === 'sms') {
      fields = `
        <div class="cc-field"><label>Provider</label>
          <input id="cc-conn-provider" value="${this.esc(conn.provider || sms.provider || '')}" placeholder="e.g. twilio"></div>
        <div class="cc-field"><label>From number</label>
          <input id="cc-conn-from" value="${this.esc(cfg.from || sms.from || '')}"></div>
        <div class="cc-field full"><label>API URL</label>
          <input id="cc-conn-api_url" value="${this.esc(cfg.api_url || sms.api_url || '')}" placeholder="https://…"></div>
        <div class="cc-field full"><label>API key</label>
          ${this.secretField('cc-conn-api_key', sms.api_key || cfg.api_key, 'API key')}</div>`;
    } else if (channel === 'email') {
      fields = `
        <div class="cc-field"><label>Provider</label>
          <input id="cc-conn-provider" value="${this.esc(conn.provider || email.provider || '')}" placeholder="e.g. sendgrid"></div>
        <div class="cc-field"><label>From address</label>
          <input id="cc-conn-from" value="${this.esc(cfg.from || email.from || '')}"></div>
        <div class="cc-field full"><label>API URL</label>
          <input id="cc-conn-api_url" value="${this.esc(cfg.api_url || email.api_url || '')}"></div>
        <div class="cc-field"><label>API key</label>
          ${this.secretField('cc-conn-api_key', email.api_key || cfg.api_key, 'API key')}</div>
        <div class="cc-field"><label>SMTP password</label>
          ${this.secretField('cc-conn-smtp_pass', email.smtp_pass || cfg.smtp_pass, 'SMTP password')}</div>`;
    }

    return this.panel(`${channel.charAt(0).toUpperCase() + channel.slice(1)} connection`,
      `<p class="cc-note">Status: ${this.statusDot(conn.status)}. Secrets are never shown after save — leave blank to keep existing, or re-enter to replace.</p>
      <div class="cc-form-grid">${fields}</div>
      <div class="cc-actions">
        <button type="button" class="btn btn-primary btn-sm" data-cc-act="save-connection" data-channel="${this.esc(channel)}">Save connection</button>
      </div>`
    );
  },

  async viewSocial() {
    const actor = this.actor();
    const conns = await this.api(API.ccConnections(actor), 'Could not load connections') || [];
    const blocks = this.SOCIAL_CHANNELS.map((channel) => {
      const conn = this.findConn(conns, channel);
      const cfg = conn.config || {};
      const hasToken = !!(cfg.access_token || cfg.has_token);
      return `<div class="cc-panel" style="margin-bottom:12px">
        <div class="cc-panel-h">
          <h4>${this.esc(channel)}</h4>
          ${this.statusDot(conn.status)}
        </div>
        <div class="cc-panel-b">
          <div class="cc-form-grid">
            <div class="cc-field"><label>Provider</label>
              <input id="cc-soc-${channel}-provider" value="${this.esc(conn.provider || '')}" placeholder="meta / tiktok / …"></div>
            <div class="cc-field"><label>Publish URL</label>
              <input id="cc-soc-${channel}-publish_url" value="${this.esc(cfg.publish_url || '')}"></div>
            <div class="cc-field"><label>Client ID</label>
              <input id="cc-soc-${channel}-client_id" value="${this.esc(cfg.client_id || '')}"></div>
            <div class="cc-field"><label>Access token</label>
              ${this.secretField(`cc-soc-${channel}-access_token`, hasToken ? '••••configured' : '', 'Access token')}</div>
            <div class="cc-field"><label>Client secret</label>
              ${this.secretField(`cc-soc-${channel}-client_secret`, cfg.client_secret ? '••••configured' : '', 'Client secret')}</div>
          </div>
          <div class="cc-actions">
            <button type="button" class="btn btn-primary btn-sm" data-cc-act="save-connection" data-channel="${channel}">Save ${this.esc(channel)}</button>
          </div>
        </div>
      </div>`;
    }).join('');
    return `<p class="cc-note">Connect social publishers. OAuth approval may be required by each platform. Tokens are masked after save.</p>${blocks}`;
  },

  async saveConnectionForm(channel) {
    const actor = this.actor();
    let provider = document.getElementById('cc-conn-provider')?.value.trim();
    const config = {};

    if (this.SOCIAL_CHANNELS.includes(channel)) {
      provider = document.getElementById(`cc-soc-${channel}-provider`)?.value.trim() || provider;
      const publish_url = document.getElementById(`cc-soc-${channel}-publish_url`)?.value.trim();
      const client_id = document.getElementById(`cc-soc-${channel}-client_id`)?.value.trim();
      if (publish_url) config.publish_url = publish_url;
      if (client_id) config.client_id = client_id;
      const tok = this.readSecret(`cc-soc-${channel}-access_token`);
      const sec = this.readSecret(`cc-soc-${channel}-client_secret`);
      if (tok) config.access_token = tok;
      if (sec) config.client_secret = sec;
    } else {
      ['phone_number_id', 'business_account_id', 'default_branch_phone', 'from', 'api_url'].forEach((k) => {
        const el = document.getElementById(`cc-conn-${k}`);
        if (el && el.value.trim()) config[k] = el.value.trim();
      });
      const apiKey = this.readSecret('cc-conn-api_key');
      const smtp = this.readSecret('cc-conn-smtp_pass');
      if (apiKey) config.api_key = apiKey;
      if (smtp) config.smtp_pass = smtp;
    }

    const r = await this.api(API.ccSaveConnection({ channel, provider: provider || null, config }, actor), 'Save connection failed');
    if (r) {
      this.toast(`${channel} connection saved`, 'success');
      await this.renderTab();
    }
  },

  /* ─── Customers / branches ──────────────────────────────────────────── */

  async viewCustomers() {
    const actor = this.actor();
    const branches = await this.api(API.ccBranches(actor), 'Could not load branches') || [];
    const rows = (Array.isArray(branches) ? branches : []).map((b) => {
      const d = b.destination || {};
      return `<tr>
        <td><strong>${this.esc(b.name || '')}</strong><br><small class="cc-muted">#${b.id} ${this.esc(b.code || '')}</small></td>
        <td><input id="cc-br-${b.id}-wa" value="${this.esc(d.whatsapp_phone || '')}" placeholder="WhatsApp phone"></td>
        <td><input id="cc-br-${b.id}-sms" value="${this.esc(d.sms_phone || '')}" placeholder="SMS phone"></td>
        <td><input id="cc-br-${b.id}-email" value="${this.esc(d.email || '')}" placeholder="Email"></td>
        <td><input id="cc-br-${b.id}-mgr" value="${this.esc(d.manager_user_id || '')}" placeholder="Manager user id" style="width:90px"></td>
        <td>
          <label class="cc-checks"><input type="checkbox" id="cc-br-${b.id}-no" ${d.notify_new_order == null || Number(d.notify_new_order) ? 'checked' : ''}> Orders</label>
          <label class="cc-checks"><input type="checkbox" id="cc-br-${b.id}-nc" ${d.notify_cancel == null || Number(d.notify_cancel) ? 'checked' : ''}> Cancel</label>
          <label class="cc-checks"><input type="checkbox" id="cc-br-${b.id}-ns" ${d.notify_stock == null || Number(d.notify_stock) ? 'checked' : ''}> Stock</label>
        </td>
        <td><button type="button" class="btn btn-primary btn-sm" data-cc-act="save-branch" data-branch-id="${b.id}">Save</button></td>
      </tr>`;
    }).join('');

    return `
      ${this.panel('Branch destinations',
        `<p class="cc-note">Where shop / branch alerts are delivered. Customer marketing prefs live on each customer record (opt-in / opt-out) and are respected for non-transactional sends.</p>
        ${this.table(['Branch', 'WhatsApp', 'SMS', 'Email', 'Manager', 'Notify', ''], rows, 'No branches')}`
      )}
      ${this.panel('Customer preferences note',
        `<p class="cc-note">Marketing WhatsApp / SMS / Email and promotions flags are stored in customer prefs. Transactional messages (orders, auth, payments) always send regardless of marketing opt-out. Use History filters to audit deliveries per customer phone.</p>
         <div class="cc-actions">
           <button type="button" class="btn btn-ghost btn-sm" data-cc-act="goto" data-tab="history">Open history</button>
         </div>`
      )}`;
  },

  async saveBranchForm(branchId) {
    const id = branchId;
    const r = await this.api(API.ccSaveBranch({
      branch_id: id,
      whatsapp_phone: document.getElementById(`cc-br-${id}-wa`)?.value.trim() || null,
      sms_phone: document.getElementById(`cc-br-${id}-sms`)?.value.trim() || null,
      email: document.getElementById(`cc-br-${id}-email`)?.value.trim() || null,
      manager_user_id: document.getElementById(`cc-br-${id}-mgr`)?.value.trim()
        ? Number(document.getElementById(`cc-br-${id}-mgr`).value) : null,
      notify_new_order: !!document.getElementById(`cc-br-${id}-no`)?.checked,
      notify_cancel: !!document.getElementById(`cc-br-${id}-nc`)?.checked,
      notify_stock: !!document.getElementById(`cc-br-${id}-ns`)?.checked
    }, this.actor()), 'Save branch failed');
    if (r) this.toast('Branch destinations saved', 'success');
  },

  /* ─── Campaigns ─────────────────────────────────────────────────────── */

  async viewCampaigns() {
    const actor = this.actor();
    const list = await this.api(API.ccCampaigns(actor), 'Could not load campaigns') || [];
    const rows = (Array.isArray(list) ? list : []).map((c) => {
      const chans = this.parseJson(c.channels_json, []);
      const aud = this.parseJson(c.audience_json, {});
      return `<tr>
        <td><strong>${this.esc(c.name || '')}</strong><br><small class="cc-muted">#${c.id}</small></td>
        <td>${this.esc((chans || []).join(', '))}</td>
        <td>${this.esc(aud.type || '—')}</td>
        <td>${this.esc(c.recipient_count ?? '—')}</td>
        <td>${this.statusDot(c.status)}</td>
        <td>${this.esc(c.scheduled_at || c.created_at || '')}</td>
      </tr>`;
    }).join('');

    return `
      ${this.panel('Create campaign', `
        <div class="cc-form-grid">
          <div class="cc-field"><label>Campaign name</label>
            <input id="cc-camp-name" placeholder="Weekend special"></div>
          <div class="cc-field"><label>Audience</label>
            <select id="cc-camp-aud">
              ${this.AUDIENCE_TYPES.map(([v, l]) => `<option value="${v}">${this.esc(l)}</option>`).join('')}
            </select>
          </div>
          <div class="cc-field"><label>Branch ID</label>
            <input id="cc-camp-branch" placeholder="Required for branch audience"></div>
          <div class="cc-field"><label>Channels</label>
            <div class="cc-checks" id="cc-camp-channels">
              ${['whatsapp', 'sms', 'email'].map((ch) => `
                <label><input type="checkbox" value="${ch}" ${ch === 'whatsapp' ? 'checked' : ''}> ${this.esc(ch)}</label>`).join('')}
            </div>
          </div>
          <div class="cc-field full"><label>Message</label>
            <textarea id="cc-camp-body" rows="4" placeholder="Hi {{customer_name}}…"></textarea></div>
          <div class="cc-field"><label>Media URL</label>
            <input id="cc-camp-media"></div>
          <div class="cc-field"><label>Schedule (optional)</label>
            <input type="datetime-local" id="cc-camp-when"></div>
        </div>
        <div class="cc-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-cc-act="preview-audience" data-source="campaign">Preview count</button>
          <button type="button" class="btn btn-primary btn-sm" data-cc-act="campaign-send">Send campaign</button>
          <span id="cc-camp-preview" class="cc-muted"></span>
        </div>
      `)}
      ${this.panel('Campaigns', this.table(
        ['Name', 'Channels', 'Audience', 'Recipients', 'Status', 'When'],
        rows,
        'No campaigns yet'
      ))}`;
  },

  async submitCampaign() {
    const actor = this.actor();
    const name = document.getElementById('cc-camp-name')?.value.trim() || 'Campaign';
    const body = document.getElementById('cc-camp-body')?.value || '';
    const type = document.getElementById('cc-camp-aud')?.value || 'all_eligible';
    const branch_id = document.getElementById('cc-camp-branch')?.value.trim();
    const when = document.getElementById('cc-camp-when')?.value;
    const media_url = document.getElementById('cc-camp-media')?.value.trim() || null;
    const channels = [...(document.getElementById('cc-camp-channels')?.querySelectorAll('input:checked') || [])]
      .map((i) => i.value);
    if (!body.trim()) { this.toast('Campaign message required', 'error'); return; }
    if (type === 'branch' && !branch_id) { this.toast('Branch ID required', 'error'); return; }

    const audience = { type };
    if (type === 'branch') audience.branch_id = Number(branch_id);

    // Preview count display when user used that button on campaigns — also support here
    const previewEl = document.getElementById('cc-camp-preview');
    if (previewEl && !previewEl.textContent) {
      const count = await this.api(API.ccPreviewAudience(audience, actor), 'Preview failed');
      const n = (count && typeof count === 'object' && count.count != null) ? count.count : count;
      if (previewEl) previewEl.textContent = `≈ ${n != null ? n : 0} recipients`;
    }

    const mode = when ? 'schedule' : 'now';
    const r = await this.api(API.ccSharePublish({
      title: name,
      body,
      channels: channels.length ? channels : ['whatsapp'],
      audience,
      media_url,
      mode,
      scheduled_at: when ? this.toSqlDatetime(when) : null,
      source_module: 'campaigns'
    }, actor), 'Campaign send failed');
    if (r) {
      this.toast(`Campaign queued (${r.queued != null ? r.queued : 0})`, 'success');
      await this.renderTab();
    }
  },

  /* ─── Automation ────────────────────────────────────────────────────── */

  async viewAutomation() {
    const actor = this.actor();
    const [autos, events] = await Promise.all([
      this.api(API.ccAutomations(actor), 'Could not load automations'),
      this.api(API.ccEventTypes(actor), 'Could not load events')
    ]);
    const eventOpts = (Array.isArray(events) ? events : []).map((e) =>
      `<option value="${this.esc(e.event_key)}">${this.esc(e.label || e.event_key)}</option>`
    ).join('');

    const rows = (Array.isArray(autos) ? autos : []).map((a) => {
      const actions = this.parseJson(a.actions_json, []);
      const act0 = Array.isArray(actions) ? actions[0] : actions;
      return `<tr>
        <td><strong>${this.esc(a.name || '')}</strong><br><small class="cc-muted">#${a.id}</small></td>
        <td>${this.esc(a.event_key || '')}</td>
        <td>${this.esc(act0?.event_key || act0?.body || JSON.stringify(act0 || {}).slice(0, 40))}</td>
        <td>${this.statusDot(Number(a.enabled) ? 'active' : 'disabled')}</td>
        <td>${this.esc(a.last_fired_at || '—')} · ${this.esc(a.fire_count || 0)} fires</td>
        <td>
          <button type="button" class="btn btn-sm ${Number(a.enabled) ? 'btn-ghost' : 'btn-primary'}"
            data-cc-act="toggle-auto" data-id="${a.id}" data-enabled="${Number(a.enabled)}">
            ${Number(a.enabled) ? 'Disable' : 'Enable'}
          </button>
        </td>
      </tr>`;
    }).join('');

    return `
      ${this.panel('Create automation (WHEN → THEN)', `
        <p class="cc-note">Automations are enable/disable only — they are never deleted from this screen.</p>
        <div class="cc-form-grid">
          <div class="cc-field"><label>Name</label><input id="cc-auto-name" placeholder="Notify owner on low stock"></div>
          <div class="cc-field"><label>WHEN event</label>
            <select id="cc-auto-when">${eventOpts}</select></div>
          <div class="cc-field"><label>THEN action event</label>
            <select id="cc-auto-then">${eventOpts}</select></div>
          <div class="cc-field"><label>THEN channels</label>
            <div class="cc-checks" id="cc-auto-channels">
              ${this.MSG_CHANNELS.map((ch) => `
                <label><input type="checkbox" value="${ch}" ${ch === 'whatsapp' || ch === 'inapp' ? 'checked' : ''}> ${this.esc(ch)}</label>`).join('')}
            </div>
          </div>
          <div class="cc-field full"><label>Optional body override</label>
            <textarea id="cc-auto-body" rows="3" placeholder="Leave blank to use template / event default"></textarea></div>
          <div class="cc-field"><label>Min order total (condition)</label>
            <input id="cc-auto-min" type="number" step="0.01" placeholder="Optional"></div>
        </div>
        <div class="cc-actions">
          <button type="button" class="btn btn-primary btn-sm" data-cc-act="save-automation">Save automation</button>
        </div>
      `)}
      ${this.panel('Automations', this.table(
        ['Name', 'WHEN', 'THEN', 'Status', 'Activity', ''],
        rows,
        'No automations yet'
      ))}`;
  },

  async saveAutomationForm() {
    const actor = this.actor();
    const name = document.getElementById('cc-auto-name')?.value.trim() || 'Automation';
    const event_key = document.getElementById('cc-auto-when')?.value;
    const thenKey = document.getElementById('cc-auto-then')?.value;
    const body = document.getElementById('cc-auto-body')?.value || undefined;
    const min = document.getElementById('cc-auto-min')?.value;
    const channels = [...(document.getElementById('cc-auto-channels')?.querySelectorAll('input:checked') || [])]
      .map((i) => i.value);
    if (!event_key) { this.toast('WHEN event required', 'error'); return; }
    const condition = {};
    if (min !== '' && min != null) condition.min_total = Number(min);
    const actions = [{ event_key: thenKey || event_key, channels: channels.length ? channels : ['whatsapp'], body }];
    const r = await this.api(API.ccSaveAutomation({
      name, event_key, condition, actions, enabled: true
    }, actor), 'Save automation failed');
    if (r) {
      this.toast('Automation saved', 'success');
      await this.renderTab();
    }
  },

  /* ─── Templates ─────────────────────────────────────────────────────── */

  async viewTemplates() {
    const actor = this.actor();
    const list = await this.api(API.ccTemplates(actor), 'Could not load templates') || [];
    this._cache.templates = Array.isArray(list) ? list : [];
    const rows = this._cache.templates.map((t) => `<tr>
      <td><strong>${this.esc(t.name || '')}</strong><br><small class="cc-muted">${this.esc(t.slug || '')}</small></td>
      <td>${this.esc(t.category || '')}</td>
      <td>${this.esc(t.channel || 'any')}</td>
      <td>${this.esc((t.body || '').slice(0, 80))}${(t.body || '').length > 80 ? '…' : ''}</td>
      <td>${this.statusDot(Number(t.enabled) ? 'active' : 'disabled')}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-cc-act="edit-template" data-id="${t.id}">Edit</button></td>
    </tr>`).join('');

    return `
      ${this.panel('Template editor', `
        <input type="hidden" id="cc-tpl-id" value="">
        <div class="cc-form-grid">
          <div class="cc-field"><label>Name</label><input id="cc-tpl-name"></div>
          <div class="cc-field"><label>Slug</label><input id="cc-tpl-slug" placeholder="auto if empty"></div>
          <div class="cc-field"><label>Category</label><input id="cc-tpl-cat" value="general"></div>
          <div class="cc-field"><label>Channel</label>
            <select id="cc-tpl-channel">
              <option value="any">any</option>
              ${this.MSG_CHANNELS.map((c) => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="cc-field full"><label>Subject</label><input id="cc-tpl-subject"></div>
          <div class="cc-field full"><label>Body</label>
            <textarea id="cc-tpl-body" rows="5" placeholder="Use {{placeholders}}"></textarea></div>
          <div class="cc-field"><label class="cc-checks"><input type="checkbox" id="cc-tpl-enabled" checked> Enabled</label></div>
        </div>
        <div class="cc-actions">
          <button type="button" class="btn btn-primary btn-sm" data-cc-act="save-template">Save template</button>
          <button type="button" class="btn btn-ghost btn-sm" data-cc-act="new-template">New</button>
        </div>
      `)}
      ${this.panel('Templates', this.table(
        ['Name', 'Category', 'Channel', 'Preview', 'Status', ''],
        rows,
        'No templates'
      ))}`;
  },

  fillTemplateForm(id) {
    const t = (this._cache.templates || []).find((x) => Number(x.id) === Number(id));
    if (!t) return;
    document.getElementById('cc-tpl-id').value = t.id;
    document.getElementById('cc-tpl-name').value = t.name || '';
    document.getElementById('cc-tpl-slug').value = t.slug || '';
    document.getElementById('cc-tpl-cat').value = t.category || 'general';
    document.getElementById('cc-tpl-channel').value = t.channel || 'any';
    document.getElementById('cc-tpl-subject').value = t.subject || '';
    document.getElementById('cc-tpl-body').value = t.body || '';
    document.getElementById('cc-tpl-enabled').checked = !!Number(t.enabled);
    document.getElementById('cc-tpl-name')?.focus();
  },

  clearTemplateForm() {
    ['cc-tpl-id', 'cc-tpl-name', 'cc-tpl-slug', 'cc-tpl-subject', 'cc-tpl-body'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const cat = document.getElementById('cc-tpl-cat');
    if (cat) cat.value = 'general';
    const ch = document.getElementById('cc-tpl-channel');
    if (ch) ch.value = 'any';
    const en = document.getElementById('cc-tpl-enabled');
    if (en) en.checked = true;
  },

  async saveTemplateForm() {
    const actor = this.actor();
    const id = document.getElementById('cc-tpl-id')?.value;
    const data = {
      name: document.getElementById('cc-tpl-name')?.value.trim(),
      slug: document.getElementById('cc-tpl-slug')?.value.trim() || undefined,
      category: document.getElementById('cc-tpl-cat')?.value.trim() || 'general',
      channel: document.getElementById('cc-tpl-channel')?.value || 'any',
      subject: document.getElementById('cc-tpl-subject')?.value.trim() || null,
      body: document.getElementById('cc-tpl-body')?.value || '',
      enabled: !!document.getElementById('cc-tpl-enabled')?.checked
    };
    if (!data.name) { this.toast('Template name required', 'error'); return; }
    if (id) data.id = Number(id);
    const r = await this.api(API.ccSaveTemplate(data, actor), 'Save template failed');
    if (r) {
      this.toast('Template saved', 'success');
      await this.renderTab();
    }
  },

  /* ─── Scheduled / History / Failed / Media / Connections / Settings ─── */

  async viewScheduled() {
    const list = await this.api(API.ccScheduled(this.actor()), 'Could not load scheduled') || [];
    const rows = (Array.isArray(list) ? list : []).map((r) => `<tr>
      <td>${this.esc(r.scheduled_at || '')}</td>
      <td>${this.esc(r.channel || '')}</td>
      <td>${this.esc(r.recipient_name || r.recipient_address || '')}</td>
      <td>${this.esc((r.body || '').slice(0, 60))}</td>
      <td>${this.statusDot(r.status)}</td>
      <td>
        <button type="button" class="btn btn-primary btn-sm" data-cc-act="send-now" data-id="${r.id}">Send now</button>
        <button type="button" class="btn btn-danger btn-sm" data-cc-act="cancel" data-id="${r.id}">Cancel</button>
      </td>
    </tr>`).join('');
    return this.panel('Scheduled messages', this.table(
      ['When', 'Channel', 'Recipient', 'Preview', 'Status', ''],
      rows,
      'Nothing scheduled'
    ));
  },

  async viewHistory() {
    const f = this.historyFilters;
    const list = await this.api(API.ccHistory({
      q: f.q || undefined,
      channel: f.channel || undefined,
      status: f.status || undefined,
      from: f.from || undefined,
      to: f.to || undefined,
      limit: 200
    }, this.actor()), 'Could not load history') || [];

    const rows = (Array.isArray(list) ? list : []).map((r) => `<tr>
      <td>${this.esc(r.created_at || '')}</td>
      <td>${this.esc(r.event_key || '')}</td>
      <td>${this.esc(r.channel || '')}</td>
      <td>${this.esc(r.recipient_name || '')}<br><small class="cc-muted">${this.esc(r.recipient_address || '')}</small></td>
      <td>${this.statusDot(r.status)}</td>
      <td>${this.esc((r.body || '').slice(0, 50))}</td>
      <td>${this.esc(r.last_error || '')}</td>
    </tr>`).join('');

    return `
      <div class="cc-filters">
        <div class="cc-field"><label>Search</label><input id="cc-hist-q" value="${this.esc(f.q)}"></div>
        <div class="cc-field"><label>Channel</label>
          <select id="cc-hist-channel">
            <option value="">All</option>
            ${this.CHANNELS.map((c) => `<option value="${c}" ${f.channel === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="cc-field"><label>Status</label>
          <select id="cc-hist-status">
            <option value="">All</option>
            ${['pending', 'processing', 'sent', 'delivered', 'failed', 'cancelled', 'retrying'].map((s) =>
              `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="cc-field"><label>From</label><input type="date" id="cc-hist-from" value="${this.esc(f.from)}"></div>
        <div class="cc-field"><label>To</label><input type="date" id="cc-hist-to" value="${this.esc(f.to)}"></div>
        <button type="button" class="btn btn-primary btn-sm" data-cc-act="history-filter">Apply</button>
      </div>
      ${this.panel('Message history', this.table(
        ['When', 'Event', 'Channel', 'Recipient', 'Status', 'Preview', 'Error'],
        rows,
        'No history'
      ))}`;
  },

  async viewFailed() {
    const list = await this.api(API.ccFailed(this.actor()), 'Could not load failed') || [];
    const rows = (Array.isArray(list) ? list : []).map((r) => `<tr>
      <td>${this.esc(r.created_at || '')}</td>
      <td>${this.esc(r.channel || '')}</td>
      <td>${this.esc(r.recipient_name || r.recipient_address || '')}</td>
      <td>${this.esc(r.last_error || 'Failed')}</td>
      <td>${this.esc(r.attempts || 0)} / ${this.esc(r.max_attempts || 3)}</td>
      <td><button type="button" class="btn btn-primary btn-sm" data-cc-act="retry" data-id="${r.id}">Retry</button></td>
    </tr>`).join('');
    return this.panel('Failed deliveries', this.table(
      ['When', 'Channel', 'Recipient', 'Error', 'Attempts', ''],
      rows,
      'No failed messages'
    ));
  },

  async viewMedia() {
    const list = await this.api(API.ccMedia(this.actor()), 'Could not load media') || [];
    const items = (Array.isArray(list) ? list : []);
    if (!items.length) {
      return this.panel('Media library', `<div class="cc-empty">No media yet — share from builders to add assets</div>`);
    }
    return this.panel('Media library', `<div class="cc-media-grid">${items.map((m) => `
      <div class="cc-media-card">
        <div class="cc-media-thumb">${m.public_url
          ? `<img src="${this.esc(m.public_url)}" alt="">`
          : this.esc(m.kind || 'file')}</div>
        <div class="cc-media-meta">
          <strong>${this.esc(m.title || 'Media')}</strong>
          <small>${this.esc(m.source_module || '')} · #${m.id}</small>
        </div>
      </div>`).join('')}</div>`);
  },

  async viewConnections() {
    const list = await this.api(API.ccConnections(this.actor()), 'Could not load connections') || [];
    const rows = (Array.isArray(list) ? list : []).map((c) => `<tr>
      <td><strong>${this.esc(c.channel)}</strong></td>
      <td>${this.esc(c.provider || '—')}</td>
      <td>${this.statusDot(c.status)}</td>
      <td>${this.esc(c.last_error || '')}</td>
      <td>${this.esc(c.last_checked_at || c.updated_at || '')}</td>
      <td>
        <button type="button" class="btn btn-ghost btn-sm" data-cc-act="goto"
          data-tab="${this.SOCIAL_CHANNELS.includes(c.channel) ? 'social' : (['whatsapp', 'sms', 'email'].includes(c.channel) ? c.channel : 'settings')}">
          Configure
        </button>
      </td>
    </tr>`).join('');
    return this.panel('All API connections', this.table(
      ['Channel', 'Provider', 'Status', 'Last error', 'Checked', ''],
      rows,
      'No connections'
    ));
  },

  async viewSettings() {
    const s = await this.api(API.ccSettings(this.actor()), 'Could not load settings') || {};
    const recovery = s.recovery || {};
    const channels = recovery.channels || ['whatsapp', 'sms', 'email'];
    const fallback = s.fallback_order || recovery.fallback_order || ['whatsapp', 'sms', 'email', 'inapp'];
    const bridge = s.bridge_inapp !== false;

    return this.panel('Communication settings', `
      <p class="cc-note">Recovery channels for password / verification codes. Bridge pushes selected in-app POS alerts through Communication Center.</p>
      <div class="cc-form-grid">
        <div class="cc-field full"><label>Recovery channels</label>
          <div class="cc-checks" id="cc-set-recovery">
            ${['whatsapp', 'sms', 'email'].map((ch) => `
              <label><input type="checkbox" value="${ch}" ${channels.includes(ch) ? 'checked' : ''}> ${this.esc(ch)}</label>`).join('')}
          </div>
        </div>
        <div class="cc-field full">
          <div class="cc-toggle-row">
            <div>
              <strong>Bridge in-app alerts</strong>
              <div class="cc-muted" style="font-size:12px">Forward stock / sales / cash alerts via WhatsApp</div>
            </div>
            <label class="cc-checks"><input type="checkbox" id="cc-set-bridge" ${bridge ? 'checked' : ''}> Enabled</label>
          </div>
        </div>
        <div class="cc-field full"><label>Fallback order (comma-separated)</label>
          <input id="cc-set-fallback" value="${this.esc((fallback || []).join(', '))}" placeholder="whatsapp, sms, email, inapp"></div>
        <div class="cc-field"><label>Recovery code expiry (minutes)</label>
          <input type="number" id="cc-set-expiry" value="${this.esc(recovery.expiry_minutes || 10)}"></div>
      </div>
      <div class="cc-actions">
        <button type="button" class="btn btn-primary btn-sm" data-cc-act="save-settings">Save settings</button>
        <button type="button" class="btn btn-ghost btn-sm" data-cc-act="process-queue">Process queue now</button>
      </div>
    `);
  },

  async saveSettingsForm() {
    const actor = this.actor();
    const channels = [...(document.getElementById('cc-set-recovery')?.querySelectorAll('input:checked') || [])]
      .map((i) => i.value);
    const fallbackRaw = document.getElementById('cc-set-fallback')?.value || '';
    const fallback_order = fallbackRaw.split(',').map((s) => s.trim()).filter(Boolean);
    const bridge_inapp = !!document.getElementById('cc-set-bridge')?.checked;
    const expiry_minutes = Number(document.getElementById('cc-set-expiry')?.value || 10);
    const r = await this.api(API.ccSaveSettings({
      recovery: { channels, expiry_minutes, fallback_order },
      bridge_inapp,
      fallback_order
    }, actor), 'Save settings failed');
    if (r) {
      this.toast('Settings saved', 'success');
      await this.renderTab();
    }
  }
};

/**
 * Reusable Share / Publish modal — callable from builders and Communication Center.
 */
window.CCSharePublish = {
  open({ title = '', body = '', mediaUrl = '', sourceModule = 'builder', app = null } = {}) {
    const actor = app?.user || (typeof App !== 'undefined' && App.user) || null;
    const esc = (v) => (typeof Utils !== 'undefined' && Utils.escHtml)
      ? Utils.escHtml(v)
      : String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const channels = ['whatsapp', 'sms', 'email', 'facebook', 'instagram', 'tiktok', 'youtube', 'x'];
    const audiences = [
      ['all_eligible', 'All eligible'],
      ['loyalty', 'Loyalty'],
      ['recent', 'Recent'],
      ['inactive', 'Inactive'],
      ['branch', 'Branch']
    ];

    const bodyHtml = `<div class="cc-share-form">
      <div class="cc-field"><label>Title</label>
        <input id="cc-share-title" value="${esc(title)}"></div>
      <div class="cc-field"><label>Message</label>
        <textarea id="cc-share-body" rows="4">${esc(body)}</textarea></div>
      <div class="cc-field"><label>Media URL</label>
        <input id="cc-share-media" value="${esc(mediaUrl || '')}"></div>
      <div class="cc-field"><label>Channels</label>
        <div class="cc-checks" id="cc-share-channels">
          ${channels.map((ch) => `<label style="margin-right:10px"><input type="checkbox" value="${ch}" ${ch === 'whatsapp' ? 'checked' : ''}> ${esc(ch)}</label>`).join('')}
        </div>
      </div>
      <div class="cc-field"><label>Audience</label>
        <select id="cc-share-aud">${audiences.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
      </div>
      <div class="cc-field"><label>Branch ID (if branch audience)</label>
        <input id="cc-share-branch"></div>
      <div class="cc-field"><label>Schedule (optional)</label>
        <input type="datetime-local" id="cc-share-when"></div>
      <div class="cc-field"><label>Mode</label>
        <select id="cc-share-mode">
          <option value="now">Send now</option>
          <option value="schedule">Schedule</option>
          <option value="draft">Draft</option>
        </select>
      </div>
    </div>`;

    const footer = `
      <button type="button" class="btn btn-ghost" id="cc-share-cancel">Cancel</button>
      <button type="button" class="btn btn-primary" id="cc-share-go">Publish</button>`;

    if (typeof Utils !== 'undefined' && Utils.showModal) {
      Utils.showModal('Share / Publish', bodyHtml, footer, { wide: true });
    } else {
      return;
    }

    document.getElementById('cc-share-cancel')?.addEventListener('click', () => Utils.hideModal());
    document.getElementById('cc-share-go')?.addEventListener('click', async () => {
      const modeSel = document.getElementById('cc-share-mode')?.value || 'now';
      const when = document.getElementById('cc-share-when')?.value;
      const audType = document.getElementById('cc-share-aud')?.value || 'all_eligible';
      const branchId = document.getElementById('cc-share-branch')?.value.trim();
      const chans = [...(document.getElementById('cc-share-channels')?.querySelectorAll('input:checked') || [])]
        .map((i) => i.value);
      const audience = { type: audType };
      if (audType === 'branch' && branchId) audience.branch_id = Number(branchId);
      let mode = modeSel;
      if (mode === 'now' && when) mode = 'schedule';

      const payload = {
        title: document.getElementById('cc-share-title')?.value.trim() || 'Share',
        body: document.getElementById('cc-share-body')?.value || '',
        media_url: document.getElementById('cc-share-media')?.value.trim() || null,
        channels: chans.length ? chans : ['whatsapp'],
        audience,
        mode,
        scheduled_at: when ? String(when).replace('T', ' ') + (when.length === 16 ? ':00' : '') : null,
        source_module: sourceModule || 'builder'
      };

      try {
        const r = await API.ccSharePublish(payload, actor);
        if (!r || r.success === false) {
          Utils.toast((r && r.error) || 'Share failed', 'error');
          return;
        }
        Utils.toast('Published / queued', 'success');
        Utils.hideModal();
      } catch (err) {
        Utils.toast(err?.message || 'Share failed', 'error');
      }
    });
  }
};

/**
 * Admin → Communication Center
 * Dark themed outbound messaging hub for the shop.
 */
window.AdminCommunicationCenterPage = {
  el: null,
  app: null,
  tab: 'control',
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
    ['dashboard', 'Overview'],
    ['control', 'Control'],
    ['otp', 'OTP'],
    ['whatsapp', 'WhatsApp'],
    ['sms', 'SMS'],
    ['email', 'Email'],
    ['templates', 'Templates'],
    ['scheduled', 'Scheduled'],
    ['reminders', 'Reminders'],
    ['notifications', 'Notifications'],
    ['customers', 'Customers'],
    ['campaigns', 'Campaigns'],
    ['broadcasts', 'Broadcasts'],
    ['automation', 'Automation'],
    ['social', 'Social Media'],
    ['media', 'Media'],
    ['history', 'Message log'],
    ['deliveries', 'Delivery status'],
    ['failed', 'Failed'],
    ['webhooks', 'Webhooks'],
    ['limits', 'Limits & Costs'],
    ['connections', 'Connections'],
    ['permissions', 'Permissions'],
    ['audit', 'Audit'],
    ['settings', 'Settings']
  ],
  OTP_MODES: [
    ['sms', 'SMS only'],
    ['whatsapp', 'WhatsApp only'],
    ['email', 'Email only'],
    ['sms_whatsapp', 'SMS + WhatsApp'],
    ['sms_email', 'SMS + Email'],
    ['whatsapp_email', 'WhatsApp + Email'],
    ['all', 'SMS + WhatsApp + Email']
  ],
  CATEGORY_LABELS: {
    transaction: 'Transactional (orders, payments, delivery)',
    points: 'Loyalty points notifications',
    reminder: 'Reminders',
    marketing: 'Marketing / promotions',
    scheduled: 'Scheduled messages',
    internal: 'Staff & owner alerts'
  },

  CHANNELS: ['whatsapp', 'sms', 'email', 'inapp', 'facebook', 'instagram', 'tiktok', 'youtube', 'x', 'linkedin'],
  MSG_CHANNELS: ['whatsapp', 'sms', 'email', 'inapp'],
  SOCIAL_CHANNELS: ['facebook', 'instagram', 'tiktok', 'youtube', 'x', 'linkedin'],
  SOCIAL_LABELS: { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', x: 'X (Twitter)', linkedin: 'LinkedIn' },
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
    if (['needs_attention', 'pending', 'retrying', 'processing', 'scheduled', 'draft', 'held'].includes(s)) return 'warn';
    if (['disconnected', 'failed', 'cancelled', 'error', 'blocked'].includes(s)) return 'bad';
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
    if (this.el !== el) this._bound = false;
    this.el = el;
    this.app = app || this.app;
    this.adminPage = app && typeof app.renderSection === 'function' ? app : (window.AdminPage || this.adminPage);
    this.ensureCss();
    let fromMkt = null;
    try {
      const raw = sessionStorage.getItem('shoppos_marketing_handoff');
      const d = raw ? JSON.parse(raw) : null;
      if (d && d.from === 'marketing-center' && d.section === 'communication-center') {
        sessionStorage.removeItem('shoppos_marketing_handoff');
        if (Date.now() - Number(d.at || 0) <= 15 * 60 * 1000) {
          fromMkt = d;
          if (d.tab && this.TABS.some(([id]) => id === d.tab)) this.tab = d.tab;
        }
      }
    } catch (_) { /* */ }
    el.innerHTML = `<div class="cc-root"><div class="cc-shell">
      ${fromMkt ? `<div class="cc-note" id="cc-mkt-banner" style="display:flex;justify-content:space-between;gap:8px;margin-bottom:8px">
        <span>📈 Opened from Marketing Center. Marketing campaigns and content are delivered here, with consent, opt-outs and limits applied.</span>
        <a href="#" id="cc-mkt-back" style="color:inherit;font-weight:600;white-space:nowrap">← Back to Marketing</a></div>` : ''}
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
    const back = el.querySelector('#cc-mkt-back');
    if (back) {
      back.onclick = (e) => {
        e.preventDefault();
        const a = this.adminPage;
        if (!a) return;
        a.section = 'marketing-center';
        document.querySelectorAll('.admin-nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.section === 'marketing-center'));
        a.renderSection(document.getElementById('admin-content'));
      };
    }
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
      case 'emergency': {
        const on = ds.on === '1';
        const msg = on
          ? 'EMERGENCY OFF: stop ALL outgoing SMS, WhatsApp and Email immediately? Waiting messages are held until you release or cancel them.'
          : 'Turn outgoing messaging back ON? Held messages stay held until you release them.';
        if (!window.confirm(msg)) break;
        const r = await this.api(API.ccSetEmergency(on, actor), 'Could not change emergency switch');
        if (r) { this.toast(on ? 'Emergency OFF is active — all sending stopped' : 'Messaging is back ON', on ? 'warning' : 'success'); await this.renderTab(); }
        break;
      }
      case 'release-held':
      case 'cancel-held': {
        const cancel = act === 'cancel-held';
        if (!window.confirm(cancel ? 'Cancel all held messages? They will not be sent.' : 'Release all held messages so they are sent now?')) break;
        const r = await this.api(API.ccReleaseHeld({ cancel }, actor), 'Could not update held messages');
        if (r) { this.toast(`${r.count} message(s) ${cancel ? 'cancelled' : 'released'}`, 'success'); await this.renderTab(); }
        break;
      }
      case 'resume-channel': {
        const r = await this.api(API.ccResumeChannel(ds.channel, actor), 'Could not resume channel');
        if (r) { this.toast(`${ds.channel} resumed`, 'success'); await this.renderTab(); }
        break;
      }
      case 'save-control': await this.saveControlForm(); break;
      case 'save-otp': await this.saveOtpForm(); break;
      case 'save-limits': await this.saveLimitsForm(); break;
      case 'save-email-provider': await this.saveEmailProviderForm(); break;
      case 'test-send': await this.submitTestSend(ds.channel); break;
      case 'ctpl-edit': this.fillChannelTemplate(Number(ds.id)); break;
      case 'ctpl-new': this.fillChannelTemplate(0); break;
      case 'ctpl-save': await this.saveChannelTemplateForm(); break;
      case 'ctpl-preview': await this.previewChannelTemplate(ds.channel); break;
      case 'sched-review': await this.reviewSchedule(); break;
      case 'sched-confirm': {
        const r = await this.api(API.ccConfirmSchedule(Number(ds.id), actor), 'Could not confirm');
        if (r) { this.toast('Scheduled message confirmed', 'success'); await this.renderTab(); }
        break;
      }
      case 'sched-cancel': {
        if (!window.confirm('Cancel this scheduled message?')) break;
        const r = await this.api(API.ccCancelSchedule(Number(ds.id), actor), 'Could not cancel');
        if (r) { this.toast('Scheduled message cancelled', 'success'); await this.renderTab(); }
        break;
      }
      case 'sched-open': {
        const r = await this.api(API.ccScheduleConfirmation(Number(ds.id), actor), 'Could not load');
        if (r) this.showScheduleConfirmation(r);
        break;
      }
      case 'rem-save': await this.saveReminderForm(); break;
      case 'rem-toggle': {
        const r = await this.api(API.ccSetReminderEnabled(Number(ds.id), ds.enabled !== '1', actor), 'Could not update reminder');
        if (r) { this.toast(ds.enabled !== '1' ? 'Reminder enabled' : 'Reminder paused', 'success'); await this.renderTab(); }
        break;
      }
      case 'prefs-load': await this.loadPrefs(); break;
      case 'prefs-save': await this.savePrefsForm(); break;
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
        case 'control': html = await this.viewControl(); break;
        case 'otp': html = await this.viewOtp(); break;
        case 'limits': html = await this.viewLimits(); break;
        case 'reminders': html = await this.viewReminders(); break;
        case 'deliveries': html = await this.viewDeliveries(); break;
        case 'audit': html = await this.viewAudit(); break;
        case 'dashboard': html = await this.viewDashboard(); break;
        case 'notifications': html = await this.viewNotifications(); break;
        case 'whatsapp': html = await this.viewProviderChannel('whatsapp'); break;
        case 'sms': html = await this.viewProviderChannel('sms'); break;
        case 'email': html = await this.viewProviderChannel('email'); break;
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
        case 'broadcasts': html = await this.viewBroadcasts(); break;
        case 'webhooks': html = await this.viewWebhooks(); break;
        case 'permissions': html = await this.viewPermissions(); break;
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

  /* ─── Control / OTP / Providers / Limits ─────────────────────────── */

  toggle(id, label, on, sub) {
    return `<div class="cc-toggle-row"><div><strong>${this.esc(label)}</strong>${sub ? `<div class="cc-muted" style="font-size:12px">${sub}</div>` : ''}</div>
      <label class="cc-checks"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> ON</label></div>`;
  },

  envList(names) {
    return (names || []).length ? names.map((n) => `<code>${this.esc(n)}</code>`).join(' ') : '<span class="cc-muted">none</span>';
  },

  async viewControl() {
    const d = await this.api(API.ccControlDashboard(this.actor()), 'Could not load controls');
    if (!d) return '<p class="cc-error">Could not load controls</p>';
    this._cache.control = d.control;
    const c = d.control;
    const p = d.providers;
    const u = d.usage?.channels || {};
    const emergency = c.emergency_off
      ? `<div class="cc-panel" style="border:2px solid #dc2626;background:rgba(220,38,38,.12)"><div class="cc-panel-b">
          <h3 style="margin:0 0 6px;color:#dc2626">EMERGENCY OFF is active — no SMS, WhatsApp or Email is being sent</h3>
          <p class="cc-muted">Since ${this.esc(c.emergency_changed_at || '')} ${c.emergency_changed_by ? `by ${this.esc(c.emergency_changed_by)}` : ''}${c.emergency_allow_otp ? ' · verification codes still allowed' : ''}</p>
          <button type="button" class="btn btn-primary btn-sm" data-cc-act="emergency" data-on="0">Turn messaging back ON</button>
        </div></div>`
      : `<div class="cc-panel"><div class="cc-panel-b" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div><strong>Messaging is ON</strong><div class="cc-muted" style="font-size:12px">Emergency OFF stops every outgoing SMS, WhatsApp and Email immediately.</div></div>
          <button type="button" class="btn btn-danger" data-cc-act="emergency" data-on="1">EMERGENCY OFF</button>
        </div></div>`;
    const ready = (ch) => {
      if (p[ch]?.ready) return this.statusDot('connected');
      const why = ch === 'sms' && p.sms?.spec_ready === false ? 'UNVERIFIED — pending official API specification' : 'not configured';
      return `<span class="cc-error">${why}</span>`;
    };
    const chRow = (ch, label) => `
      ${this.toggle(`ctl-ch-${ch}`, `${label}`, c.channels[ch], `Provider: ${ready(ch)} · sent today ${this.esc(u[ch]?.sent_today ?? 0)}${c.paused?.[ch] ? ` · <span class="cc-error">PAUSED: ${this.esc(c.paused[ch].reason)}</span> <button type="button" class="btn btn-ghost btn-sm" data-cc-act="resume-channel" data-channel="${ch}">Resume</button>` : ''}`)}`;
    const alerts = (d.alerts || []).map((a) => `<tr><td>${this.esc(a.created_at)}</td><td>${this.esc(a.channel || '')}</td><td>${this.esc(a.message || '')}</td><td>${a.resolved_at ? 'resolved' : '<strong>open</strong>'}</td></tr>`).join('');
    return `
      ${emergency}
      ${d.held ? this.panel(`${d.held} message(s) held`, `<p class="cc-note">Held by Emergency OFF, a paused channel or a rate limit.</p>
        <div class="cc-actions"><button type="button" class="btn btn-primary btn-sm" data-cc-act="release-held">Release (send now)</button>
        <button type="button" class="btn btn-danger btn-sm" data-cc-act="cancel-held">Cancel all held</button></div>`) : ''}
      <div class="cc-grid-2">
        ${this.panel('Channels', `
          ${chRow('whatsapp', 'WhatsApp')}
          ${chRow('sms', 'SMS (Vodacom)')}
          ${chRow('email', 'Email')}
          ${this.toggle('ctl-otp', 'Verification codes (OTP)', c.otp_enabled, 'Independent of marketing switches. Channels are chosen on the OTP tab.')}
          ${this.toggle('ctl-emergency-otp', 'Allow OTP during Emergency OFF', c.emergency_allow_otp, 'If ON, customers can still receive verification codes while everything else is stopped.')}
        `)}
        ${this.panel('Message types', `
          ${Object.entries(this.CATEGORY_LABELS).map(([k, l]) => this.toggle(`ctl-cat-${k}`, l, c.categories[k])).join('')}
          ${this.toggle('ctl-window', 'Respect legal marketing hours', c.marketing_window?.enabled, 'Mon–Fri 08:00–20:00, Sat 09:00–13:00, never Sundays or public holidays (marketing and scheduled messages wait for the next allowed time).')}
        `)}
      </div>
      ${this.panel('Loyalty points notifications', `
        <p class="cc-note">When "Loyalty points notifications" is ON, customers get one message per sale that earned points (never twice for the same sale).</p>
        <div class="cc-form-grid">
          <div class="cc-field"><label>Send by</label><div class="cc-checks" id="ctl-points-ch">
            ${['whatsapp', 'sms', 'email'].map((ch) => `<label><input type="checkbox" value="${ch}" ${(c.points.channels || []).includes(ch) ? 'checked' : ''}> ${ch}</label>`).join('')}
          </div></div>
          <div class="cc-field"><label>If that fails, try</label>
            <select id="ctl-points-fb">${['none', 'whatsapp', 'sms', 'email'].map((ch) => `<option value="${ch}" ${c.points.fallback === ch ? 'selected' : ''}>${ch}</option>`).join('')}</select></div>
        </div>`)}
      <div class="cc-actions"><button type="button" class="btn btn-primary" data-cc-act="save-control">Save controls</button></div>
      ${this.panel('Channel alerts', this.table(['When', 'Channel', 'Alert', 'Status'], alerts, 'No alerts'))}`;
  },

  async saveControlForm() {
    const chk = (id) => !!document.getElementById(id)?.checked;
    const categories = {};
    Object.keys(this.CATEGORY_LABELS).forEach((k) => { categories[k] = chk(`ctl-cat-${k}`); });
    const data = {
      channels: { whatsapp: chk('ctl-ch-whatsapp'), sms: chk('ctl-ch-sms'), email: chk('ctl-ch-email') },
      otp_enabled: chk('ctl-otp'),
      emergency_allow_otp: chk('ctl-emergency-otp'),
      categories,
      marketing_window: { enabled: chk('ctl-window') },
      points: {
        channels: [...(document.getElementById('ctl-points-ch')?.querySelectorAll('input:checked') || [])].map((i) => i.value),
        fallback: document.getElementById('ctl-points-fb')?.value || 'none'
      }
    };
    const r = await this.api(API.ccSaveControl(data, this.actor()), 'Could not save controls');
    if (r) { this.toast('Controls saved', 'success'); await this.renderTab(); }
  },

  async viewOtp() {
    const actor = this.actor();
    const [d, events] = await Promise.all([
      this.api(API.ccControlDashboard(actor), 'Could not load OTP settings'),
      this.api(API.ccOtpEvents({ limit: 100 }, actor), 'Could not load OTP log')
    ]);
    if (!d) return '<p class="cc-error">Could not load OTP settings</p>';
    const o = d.control.otp;
    const s = d.otp || {};
    const num = (id, label, v, min, max) => `<div class="cc-field"><label>${this.esc(label)}</label><input type="number" id="${id}" value="${this.esc(v)}" min="${min}" max="${max}"></div>`;
    const rows = (Array.isArray(events) ? events : []).map((e) => `<tr><td>${this.esc(e.created_at)}</td><td>${this.esc(e.purpose || '')}</td><td>${this.esc(e.subject_masked || '')}</td><td>${this.statusDot(e.event)}</td><td>${this.esc(e.channel || '')}</td><td>${this.esc(e.detail || '')}</td><td>${this.esc(e.ip || '')}</td></tr>`).join('');
    return `
      <div class="cc-metrics">
        ${this.metric('Codes issued (24h)', s.issued_24h ?? 0)}
        ${this.metric('Delivered (24h)', s.sent_24h ?? 0)}
        ${this.metric('Send failures (24h)', s.send_failed_24h ?? 0)}
        ${this.metric('Verified (24h)', s.verified_24h ?? 0)}
        ${this.metric('Wrong codes (24h)', s.verify_failed_24h ?? 0)}
        ${this.metric('Blocked by limits (24h)', s.blocked_24h ?? 0)}
      </div>
      ${this.panel('Verification code (OTP) delivery', `
        <p class="cc-note">Used for Phone Access sign-in, online registration and password recovery. Codes are stored only as a keyed hash, work once, and expire.</p>
        <div class="cc-form-grid">
          <div class="cc-field"><label>Send codes by</label>
            <select id="otp-mode">${this.OTP_MODES.map(([v, l]) => `<option value="${v}" ${o.mode === v ? 'selected' : ''}>${this.esc(l)}</option>`).join('')}</select></div>
          <div class="cc-field"><label>Fallback channel (used if every chosen channel fails)</label>
            <select id="otp-fallback">${['none', 'whatsapp', 'sms', 'email'].map((v) => `<option value="${v}" ${o.fallback === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          ${num('otp-expiry', 'Code expires after (minutes)', o.expiry_minutes, 2, 30)}
          ${num('otp-attempts', 'Wrong attempts allowed', o.max_attempts, 1, 10)}
          ${num('otp-cooldown', 'Wait before resending (seconds)', o.resend_cooldown_seconds, 15, 900)}
          ${num('otp-th', 'Max codes per phone/email per hour', o.per_target_hour, 1, 50)}
          ${num('otp-td', 'Max codes per phone/email per day', o.per_target_day, 1, 200)}
          ${num('otp-ih', 'Max codes per device/IP per hour', o.per_ip_hour, 1, 500)}
          ${num('otp-id', 'Max codes per device/IP per day', o.per_ip_day, 1, 5000)}
          <div class="cc-field full"><label class="cc-checks"><input type="checkbox" id="otp-walink" ${o.allow_wa_link_fallback ? 'checked' : ''}>
            Legacy: if nothing could be delivered, let the customer open WhatsApp with the code pre-filled (less secure — anyone holding the phone screen sees the code)</label></div>
        </div>
        <div class="cc-actions"><button type="button" class="btn btn-primary btn-sm" data-cc-act="save-otp">Save OTP settings</button></div>
      `)}
      ${this.panel('OTP security log (masked)', this.table(['When', 'Purpose', 'To', 'Event', 'Channel', 'Detail', 'IP'], rows, 'No OTP activity yet'))}`;
  },

  async saveOtpForm() {
    const n = (id) => Number(document.getElementById(id)?.value);
    const data = {
      otp: {
        mode: document.getElementById('otp-mode')?.value,
        fallback: document.getElementById('otp-fallback')?.value,
        expiry_minutes: n('otp-expiry'),
        max_attempts: n('otp-attempts'),
        resend_cooldown_seconds: n('otp-cooldown'),
        per_target_hour: n('otp-th'),
        per_target_day: n('otp-td'),
        per_ip_hour: n('otp-ih'),
        per_ip_day: n('otp-id'),
        allow_wa_link_fallback: !!document.getElementById('otp-walink')?.checked
      }
    };
    const r = await this.api(API.ccSaveControl(data, this.actor()), 'Could not save OTP settings');
    if (r) { this.toast('OTP settings saved', 'success'); await this.renderTab(); }
  },

  testSendHtml(channel) {
    return `<div class="cc-form-grid">
      <div class="cc-field"><label>Send a real test ${channel === 'email' ? 'email' : 'message'} to</label>
        <input id="test-${channel}-to" placeholder="${channel === 'email' ? 'you@example.com' : '0821234567'}"></div>
      <div class="cc-field full"><label>Text</label><input id="test-${channel}-text" placeholder="Test message"></div>
    </div>
    <div class="cc-actions"><button type="button" class="btn btn-primary btn-sm" data-cc-act="test-send" data-channel="${channel}">Send test</button></div>
    <div id="test-${channel}-result"></div>`;
  },

  async submitTestSend(channel) {
    const to = document.getElementById(`test-${channel}-to`)?.value.trim();
    const text = document.getElementById(`test-${channel}-text`)?.value.trim();
    const out = document.getElementById(`test-${channel}-result`);
    const r = await this.api(API.ccTestSend({ channel, to, text }, this.actor()), 'Test send failed');
    if (!r || !out) return;
    out.innerHTML = r.ok
      ? `<p class="cc-note">Accepted by ${this.esc(r.provider)}${r.used_fallback ? ' (fallback provider)' : ''}${r.external_id ? ` · id ${this.esc(r.external_id)}` : ''}. Check the recipient actually received it.</p>`
      : `<p class="cc-error">Not sent: ${this.esc(r.error || 'unknown error')}</p>`;
  },

  async viewProviderChannel(channel) {
    const d = await this.api(API.ccControlDashboard(this.actor()), 'Could not load provider status');
    if (!d) return '<p class="cc-error">Could not load provider status</p>';
    const p = d.providers[channel] || {};
    const secretsNote = '<p class="cc-note">Keys and passwords are never entered here. They are added only as server environment variables (Railway → Variables) and are never shown, stored in the database, or sent to the browser.</p>';
    if (channel === 'sms') {
      const unverified = p.spec_ready === false;
      return this.panel('SMS — Vodacom', `
        ${secretsNote}
        <p>Status: ${unverified ? '<strong>UNVERIFIED — pending official API specification</strong> (SMS sending stays disabled)' : this.statusDot(p.ready ? 'connected' : 'disconnected')}</p>
        <p class="${unverified ? 'cc-error' : 'cc-note'}">${this.esc(p.note || '')}</p>
        <p>Server environment variable names (values are entered only in Railway → Variables, never here): ${this.envList(['VODACOM_SMS_BASE_URL', 'VODACOM_SMS_CLIENT_ID', 'VODACOM_SMS_CLIENT_SECRET', 'VODACOM_SMS_SENDER'])}</p>
        <p>Not set yet: ${this.envList(p.env_missing)}</p>
        ${this.testSendHtml('sms')}`);
    }
    if (channel === 'whatsapp') {
      return this.panel('WhatsApp — Meta Cloud API', `
        ${secretsNote}
        <p>Status: ${this.statusDot(p.ready ? 'connected' : 'disconnected')} · access token: <strong>${this.esc(p.token_source)}</strong> · phone number ID: ${p.phone_number_id_set ? 'set' : '<strong>missing</strong>'}</p>
        <p>OTP authentication template: <strong>${this.esc(p.otp_template || 'not set')}</strong></p>
        ${p.note ? `<p class="cc-note">${this.esc(p.note)}</p>` : ''}
        <p>Environment variables not set: ${this.envList(p.env_missing)}</p>
        <p class="cc-muted" style="font-size:12px">Delivery receipts: point the Meta webhook to <code>/api/webhooks/whatsapp</code> and set <code>WHATSAPP_WEBHOOK_VERIFY_TOKEN</code> and <code>WHATSAPP_APP_SECRET</code>. Until then messages show "sent" (accepted by Meta), not "delivered".</p>
        ${this.testSendHtml('whatsapp')}`);
    }
    const e = p;
    const opt = (v, cur) => ['smtp', 'api', 'none'].map((x) => `<option value="${x}" ${cur === x ? 'selected' : ''}>${x === 'api' ? 'Email API service' : x.toUpperCase()}</option>`).join('');
    return this.panel('Email — SMTP and Email API', `
      ${secretsNote}
      <p>Status: ${this.statusDot(e.ready ? 'connected' : 'disconnected')}</p>
      <p>SMTP: ${e.smtp?.configured ? this.statusDot('connected') : this.statusDot('disconnected')} · missing ${this.envList(e.smtp?.env_missing)}</p>
      <p>Email API (${this.esc(e.api?.provider || 'SendGrid / Brevo / Mailgun / Resend')}): ${e.api?.configured ? this.statusDot('connected') : this.statusDot('disconnected')} · missing ${this.envList(e.api?.env_missing)}</p>
      ${e.note ? `<p class="cc-error">${this.esc(e.note)}</p>` : ''}
      <div class="cc-form-grid">
        <div class="cc-field"><label>Primary provider</label><select id="em-primary">${opt('p', e.primary).replace('<option value="none"', '<option disabled value="none"')}</select></div>
        <div class="cc-field"><label>Fallback provider</label><select id="em-fallback">${opt('f', e.fallback || 'none')}</select></div>
        <div class="cc-field"><label>From name</label><input id="em-from-name" value="${this.esc(e.from_name || '')}"></div>
        <div class="cc-field"><label>From email</label><input id="em-from-email" value="${this.esc(e.from_email || '')}"></div>
        <div class="cc-field"><label>Reply-to email</label><input id="em-reply" value="${this.esc(d.control.email?.reply_to || '')}"></div>
      </div>
      <div class="cc-actions"><button type="button" class="btn btn-primary btn-sm" data-cc-act="save-email-provider">Save email settings</button></div>
      ${this.testSendHtml('email')}`);
  },

  async saveEmailProviderForm() {
    const v = (id) => document.getElementById(id)?.value || '';
    const r = await this.api(API.ccSaveControl({
      email: { primary: v('em-primary'), fallback: v('em-fallback'), from_name: v('em-from-name').trim(), from_email: v('em-from-email').trim(), reply_to: v('em-reply').trim() }
    }, this.actor()), 'Could not save email settings');
    if (r) { this.toast('Email settings saved', 'success'); await this.renderTab(); }
  },

  async viewLimits() {
    const d = await this.api(API.ccControlDashboard(this.actor()), 'Could not load limits');
    if (!d) return '<p class="cc-error">Could not load limits</p>';
    const c = d.control;
    const u = d.usage?.channels || {};
    const rows = ['whatsapp', 'sms', 'email'].map((ch) => `<tr>
      <td><strong>${ch}</strong>${u[ch]?.paused ? `<br><small class="cc-error">paused</small>` : ''}</td>
      <td><input type="number" id="lim-${ch}-h" value="${this.esc(c.limits[ch].hour)}" min="1" style="width:90px"></td>
      <td><input type="number" id="lim-${ch}-d" value="${this.esc(c.limits[ch].day)}" min="1" style="width:100px"></td>
      <td><input type="number" id="lim-${ch}-c" value="${this.esc(c.costs[ch])}" min="0" step="0.01" style="width:90px"></td>
      <td>${this.esc(u[ch]?.sent_last_hour ?? 0)}</td>
      <td>${this.esc(u[ch]?.sent_today ?? 0)} · R${this.esc((u[ch]?.cost_today ?? 0).toFixed ? u[ch].cost_today.toFixed(2) : u[ch]?.cost_today)}</td>
      <td>${this.esc(u[ch]?.sent_month ?? 0)} · R${this.esc((u[ch]?.cost_month ?? 0).toFixed ? u[ch].cost_month.toFixed(2) : u[ch]?.cost_month)}</td>
      <td>${this.esc(u[ch]?.failed_today ?? 0)}</td>
    </tr>`).join('');
    return `
      ${this.panel('Sending limits, usage and cost', `
        <p class="cc-note">Costs are your own rates per message (Vodacom / Meta / email provider) and are used only for the estimates below.</p>
        ${this.table(['Channel', 'Max / hour', 'Max / day', 'Cost per message (R)', 'Last hour', 'Today', 'This month', 'Failed today'], rows)}
        ${this.toggle('lim-autopause', 'Auto-pause a channel when a limit is reached', c.auto_pause, 'The owner gets an alert; messages are held until the channel is resumed.')}
        <div class="cc-form-grid">
          <div class="cc-field"><label>Retry attempts</label><input type="number" id="lim-retry" value="${this.esc(c.retry.max_attempts)}" min="1" max="10"></div>
          <div class="cc-field"><label>Wait between retries (seconds, grows each attempt)</label><input type="number" id="lim-backoff" value="${this.esc(c.retry.backoff_seconds)}" min="5" max="3600"></div>
        </div>
        <div class="cc-actions"><button type="button" class="btn btn-primary btn-sm" data-cc-act="save-limits">Save limits</button></div>
      `)}`;
  },

  async saveLimitsForm() {
    const n = (id) => Number(document.getElementById(id)?.value);
    const limits = {};
    const costs = {};
    ['whatsapp', 'sms', 'email'].forEach((ch) => {
      limits[ch] = { hour: n(`lim-${ch}-h`), day: n(`lim-${ch}-d`) };
      costs[ch] = n(`lim-${ch}-c`);
    });
    const r = await this.api(API.ccSaveControl({
      limits, costs, auto_pause: !!document.getElementById('lim-autopause')?.checked,
      retry: { max_attempts: n('lim-retry'), backoff_seconds: n('lim-backoff') }
    }, this.actor()), 'Could not save limits');
    if (r) { this.toast('Limits saved', 'success'); await this.renderTab(); }
  },

  async viewDeliveries() {
    const list = await this.api(API.ccAttempts(300, this.actor()), 'Could not load delivery attempts') || [];
    const rows = (Array.isArray(list) ? list : []).map((a) => `<tr>
      <td>${this.esc(a.created_at)}</td><td>${this.esc(a.channel)}</td><td>${this.esc(a.provider || '')}</td>
      <td>${this.esc(a.recipient_masked || '')}</td><td>${this.statusDot(a.status)}</td>
      <td>${this.esc(a.error || '')}</td><td>${this.esc(a.queue_id || '')}${a.otp_request_id ? ` / OTP ${this.esc(a.otp_request_id)}` : ''}</td>
    </tr>`).join('');
    return this.panel('Provider delivery attempts (recipients masked)', this.table(['When', 'Channel', 'Provider', 'To', 'Result', 'Error', 'Message'], rows, 'No delivery attempts yet'));
  },

  async viewAudit() {
    const list = await this.api(API.ccAuditLog(300, this.actor()), 'Could not load audit log') || [];
    const rows = (Array.isArray(list) ? list : []).map((a) => `<tr>
      <td>${this.esc(a.created_at)}</td><td>${this.esc(a.actor_name || '')}</td><td>${this.esc(a.action)}</td>
      <td>${this.esc(a.entity_type || '')} ${this.esc(a.entity_id || '')}</td>
      <td><small style="word-break:break-all">${this.esc(String(a.details_json || '').slice(0, 400))}</small></td>
    </tr>`).join('');
    return this.panel('Communication audit trail (who changed what)', this.table(['When', 'User', 'Action', 'Item', 'Details'], rows, 'No audit records'));
  },

  async viewSocial() {
    const actor = this.actor();
    const conns = await this.api(API.ccConnections(actor), 'Could not load connections') || [];
    const blocks = this.SOCIAL_CHANNELS.map((channel) => {
      const conn = this.findConn(conns, channel);
      const cfg = conn.config || {};
      const hasToken = !!(cfg.access_token || cfg.has_token);
      const label = this.socialStatusLabel(conn, cfg, hasToken);
      return `<div class="cc-panel" style="margin-bottom:12px">
        <div class="cc-panel-h">
          <h4>${this.esc(this.SOCIAL_LABELS[channel] || channel)}</h4>
          <span class="cc-status ${label === 'CONNECTED' ? 'ok' : label === 'DISABLED' ? 'bad' : 'warn'}"><strong>${label}</strong></span>
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
    return `<p class="cc-note">Connect social publishers: Facebook, Instagram, X, TikTok, YouTube and LinkedIn. Each platform requires its own app approval / OAuth token and a publish URL; until both are saved the channel shows PENDING CONFIGURATION and nothing is posted. Tokens are masked after save.</p>${blocks}`;
  },

  socialStatusLabel(conn, cfg, hasToken) {
    const s = String(conn?.status || '').toLowerCase();
    if (s === 'disabled') return 'DISABLED';
    if (s === 'connected' && hasToken && cfg.publish_url) return 'CONNECTED';
    if (hasToken || cfg.publish_url || conn?.provider || cfg.client_id) return 'PENDING CONFIGURATION';
    return 'NOT CONFIGURED';
  },

  async viewBroadcasts() {
    const list = await this.api(API.ccCampaigns(this.actor()), 'Could not load broadcasts') || [];
    const all = Array.isArray(list) ? list : [];
    const sent = all.filter((c) => String(c.status || '') !== 'draft');
    const drafts = all.filter((c) => String(c.status || '') === 'draft');
    const row = (c) => {
      const chans = this.parseJson(c.channels_json, []);
      const aud = this.parseJson(c.audience_json, {});
      const fromMkt = /^\[Marketing\]/.test(String(c.name || ''));
      return `<tr>
        <td><strong>${this.esc(c.name || '')}</strong>${fromMkt ? ' <span class="cc-status warn">from Marketing</span>' : ''}<br><small class="cc-muted">#${c.id}</small></td>
        <td>${this.esc((chans || []).join(', ') || '—')}</td>
        <td>${this.esc(aud.type || '—')}</td>
        <td>${this.esc(c.recipient_count ?? '—')}</td>
        <td>${this.statusDot(c.status)}</td>
        <td>${this.esc(c.scheduled_at || c.created_at || '')}</td>
      </tr>`;
    };
    const head = ['Broadcast', 'Channels', 'Audience', 'Recipients', 'Status', 'When'];
    return `<p class="cc-note">A broadcast is one message sent to a whole audience (all eligible customers, loyalty members, recent, inactive or a branch). Consent, opt-outs, quiet hours, limits and duplicate protection always apply.</p>
      <div class="cc-actions" style="margin-bottom:10px"><button type="button" class="btn btn-primary btn-sm" data-cc-act="goto" data-tab="campaigns">New broadcast</button>
        <button type="button" class="btn btn-ghost btn-sm" data-cc-act="goto" data-tab="scheduled">Scheduled broadcasts</button></div>
      ${this.panel(`Sent / scheduled broadcasts (${sent.length})`, this.table(head, sent.map(row).join(''), 'No broadcasts sent yet'))}
      ${this.panel(`Drafts awaiting review (${drafts.length})`, this.table(head, drafts.map(row).join(''), 'No drafts. Content sent from Marketing → Content Studio appears here as a draft.'))}`;
  },

  async viewWebhooks() {
    const w = await this.api(API.ccWebhooks(), 'Could not load webhook status');
    if (!w) return '<p class="cc-error">Could not load webhook status (owner or manager only).</p>';
    const yn = (v) => (v == null ? '—' : v ? '<span class="cc-status ok">set</span>' : '<span class="cc-status bad">not set</span>');
    const rows = (w.endpoints || []).map((e) => `<tr>
      <td><strong>${this.esc(e.name)}</strong><br><small class="cc-muted">${this.esc(e.purpose || '')}</small></td>
      <td>${this.esc(e.method || '')}</td>
      <td>${e.callback_url ? `<code>${this.esc(e.callback_url)}</code>` : '<span class="cc-muted">not exposed</span>'}</td>
      <td>${yn(e.verify_token_set)}</td>
      <td>${yn(e.app_secret_set)}</td>
    </tr>`).join('');
    const counts = Object.entries(w.whatsapp_status_counts || {}).map(([k, v]) => this.metric(k, v)).join('');
    return `${this.panel('Webhook endpoints', `
        <p class="cc-note">Set these in the provider's developer console. Verify tokens and secrets are server environment variables (<code>WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>, <code>WHATSAPP_APP_SECRET</code>) and are never shown here.</p>
        ${this.table(['Endpoint', 'Method', 'Callback URL', 'Verify token', 'App secret (signature check)'], rows, 'No webhook endpoints')}`)}
      ${this.panel('WhatsApp message status (from queue)', `<div class="cc-metrics">${counts || '<div class="cc-empty">No WhatsApp messages yet</div>'}</div>
        <p class="cc-muted">${this.esc(w.note || '')}</p>`)}`;
  },

  async viewPermissions() {
    const p = await this.api(API.ccPermissions(), 'Could not load permissions');
    if (!p) return '<p class="cc-error">Could not load permissions (owner or manager only).</p>';
    const roles = p.roles || [];
    const rows = (p.rows || []).map((r) => `<tr><td>${this.esc(r.action)}</td>${roles.map((role) => `<td style="text-align:center">${(r.roles || []).includes(role) ? '✔' : '—'}</td>`).join('')}</tr>`).join('');
    return this.panel('Who can do what in the Communication Center', `
      ${this.table(['Action', ...roles.map((r) => r.charAt(0).toUpperCase() + r.slice(1))], rows, 'No permission data')}
      <p class="cc-note">${this.esc(p.secrets_note || '')}</p>
      <p class="cc-muted">${this.esc(p.marketing_note || '')}</p>`);
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
      ${this.panel('Customer communication preferences',
        `<p class="cc-note">Look up a customer by cellphone. Security messages (verification codes) are always allowed. Marketing opt-out also happens automatically when a customer uses the unsubscribe link in a marketing message.</p>
         <div class="cc-form-grid">
           <div class="cc-field"><label>Customer cellphone</label><input id="cc-pref-phone" placeholder="e.g. 0821234567"></div>
           <div class="cc-field"><label>&nbsp;</label><button type="button" class="btn btn-ghost btn-sm" data-cc-act="prefs-load">Load</button></div>
         </div>
         <div id="cc-pref-box"></div>`
      )}`;
  },

  async loadPrefs() {
    const phone = document.getElementById('cc-pref-phone')?.value.trim();
    if (!phone) { this.toast('Enter a cellphone number', 'error'); return; }
    const p = await this.api(API.ccCustomerPrefs({ phone }, this.actor()), 'Could not load preferences');
    if (!p) return;
    const labels = [['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['marketing', 'Marketing'],
      ['loyalty', 'Loyalty points'], ['reminders', 'Reminders'], ['transactional', 'Orders & payments']];
    const box = document.getElementById('cc-pref-box');
    if (!box) return;
    box.innerHTML = `<div class="cc-checks" id="cc-pref-flags">
        ${labels.map(([k, l]) => `<label><input type="checkbox" value="${k}" ${Number(p[k]) ? 'checked' : ''}> ${this.esc(l)}</label>`).join('')}
        <label><input type="checkbox" checked disabled> Security (always on)</label>
      </div>
      ${p.opted_out_at ? `<p class="cc-note">Marketing opt-out since ${this.esc(p.opted_out_at)}</p>` : ''}
      <div class="cc-actions"><button type="button" class="btn btn-primary btn-sm" data-cc-act="prefs-save">Save preferences</button></div>`;
    this._prefPhone = phone;
  },

  async savePrefsForm() {
    const data = { phone: this._prefPhone };
    document.querySelectorAll('#cc-pref-flags input[value]').forEach((i) => { data[i.value] = i.checked; });
    const r = await this.api(API.ccSaveCustomerPrefs(data, this.actor()), 'Could not save preferences');
    if (r) this.toast('Preferences saved', 'success');
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

  TEMPLATE_VARS: ['customer_name', 'shop_name', 'branch_name', 'product_name', 'points_earned', 'points_balance',
    'order_number', 'order_total', 'shop_phone', 'shop_address', 'order_link', 'date', 'time', 'website'],

  async viewTemplates() {
    const list = await this.api(API.ccChannelTemplates(this.actor()), 'Could not load templates') || [];
    this._cache.templates = Array.isArray(list) ? list : [];
    const rows = this._cache.templates.map((t) => `<tr>
      <td><strong>${this.esc(t.name || '')}</strong><br><small class="cc-muted">${this.esc(t.category || '')}</small></td>
      <td>${this.esc((t.body || '').slice(0, 70))}${(t.body || '').length > 70 ? '…' : ''}</td>
      <td>${t.sms_body ? 'yes' : '—'}</td>
      <td>${t.email_subject || t.email_html ? 'yes' : '—'}</td>
      <td>${t.wa_template_name ? `${this.esc(t.wa_template_name)} ${this.statusDot(t.wa_approval_status || 'not_submitted')}` : '—'}</td>
      <td>${this.statusDot(Number(t.enabled) ? 'active' : 'disabled')}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-cc-act="ctpl-edit" data-id="${t.id}">Edit</button></td>
    </tr>`).join('');
    return `
      ${this.panel('Template editor', `
        <p class="cc-note">Variables: ${this.TEMPLATE_VARS.map((v) => `<code>{${v}}</code>`).join(' ')}. Shop and branch details are filled in automatically; a message is blocked if a detail it needs is missing.</p>
        <input type="hidden" id="ct-id" value="">
        <div class="cc-form-grid">
          <div class="cc-field"><label>Name</label><input id="ct-name"></div>
          <div class="cc-field"><label>Category</label>
            <select id="ct-category">${['marketing', 'loyalty', 'orders', 'payments', 'delivery', 'reminder', 'general'].map((c) => `<option value="${c}">${c}</option>`).join('')}</select></div>
          <div class="cc-field full"><label>WhatsApp / general message</label><textarea id="ct-body" rows="3"></textarea></div>
          <div class="cc-field full"><label>SMS text (keep short — 160 characters is 1 SMS)</label><textarea id="ct-sms" rows="2"></textarea></div>
          <div class="cc-field full"><label>Email subject</label><input id="ct-email-subject"></div>
          <div class="cc-field full"><label>Email HTML (optional)</label><textarea id="ct-email-html" rows="3"></textarea></div>
          <div class="cc-field full"><label>Email plain text</label><textarea id="ct-email-text" rows="3"></textarea></div>
          <div class="cc-field"><label>Approved WhatsApp template name (Meta)</label><input id="ct-wa-name" placeholder="optional"></div>
          <div class="cc-field"><label>WhatsApp template language</label><input id="ct-wa-lang" value="en"></div>
          <div class="cc-field"><label>WhatsApp variables in order ({{1}}, {{2}} …)</label><input id="ct-wa-vars" placeholder="customer_name, points_earned"></div>
          <div class="cc-field"><label>Meta approval status</label>
            <select id="ct-wa-status">${['not_submitted', 'pending', 'approved', 'rejected'].map((s) => `<option value="${s}">${s}</option>`).join('')}</select></div>
          <div class="cc-field"><label class="cc-checks"><input type="checkbox" id="ct-enabled" checked> Enabled</label></div>
        </div>
        <div class="cc-actions">
          <button type="button" class="btn btn-primary btn-sm" data-cc-act="ctpl-save">Save template</button>
          <button type="button" class="btn btn-ghost btn-sm" data-cc-act="ctpl-new">New</button>
          <button type="button" class="btn btn-ghost btn-sm" data-cc-act="ctpl-preview" data-channel="whatsapp">Preview WhatsApp</button>
          <button type="button" class="btn btn-ghost btn-sm" data-cc-act="ctpl-preview" data-channel="sms">Preview SMS</button>
          <button type="button" class="btn btn-ghost btn-sm" data-cc-act="ctpl-preview" data-channel="email">Preview Email</button>
        </div>
        <pre id="ct-preview" style="white-space:pre-wrap"></pre>
      `)}
      ${this.panel('Templates', this.table(['Name', 'Message', 'SMS', 'Email', 'WhatsApp template', 'Status', ''], rows, 'No templates'))}`;
  },

  fillChannelTemplate(id) {
    const t = (this._cache.templates || []).find((x) => Number(x.id) === Number(id)) || {};
    const set = (k, v) => { const el = document.getElementById(k); if (el) el.value = v ?? ''; };
    set('ct-id', t.id || '');
    set('ct-name', t.name || '');
    set('ct-category', t.category || 'marketing');
    set('ct-body', t.body || '');
    set('ct-sms', t.sms_body || '');
    set('ct-email-subject', t.email_subject || t.subject || '');
    set('ct-email-html', t.email_html || '');
    set('ct-email-text', t.email_text || '');
    set('ct-wa-name', t.wa_template_name || '');
    set('ct-wa-lang', t.wa_language || 'en');
    set('ct-wa-vars', (this.parseJson(t.wa_variables_json, []) || []).join(', '));
    set('ct-wa-status', t.wa_approval_status || 'not_submitted');
    const en = document.getElementById('ct-enabled');
    if (en) en.checked = t.id ? !!Number(t.enabled) : true;
    document.getElementById('ct-name')?.focus();
  },

  readChannelTemplate() {
    const v = (k) => document.getElementById(k)?.value || '';
    return {
      id: v('ct-id') ? Number(v('ct-id')) : undefined,
      name: v('ct-name').trim(),
      category: v('ct-category'),
      body: v('ct-body'),
      sms_body: v('ct-sms'),
      email_subject: v('ct-email-subject'),
      email_html: v('ct-email-html'),
      email_text: v('ct-email-text'),
      wa_template_name: v('ct-wa-name').trim(),
      wa_language: v('ct-wa-lang').trim() || 'en',
      wa_variables: v('ct-wa-vars').split(',').map((s) => s.trim()).filter(Boolean),
      wa_approval_status: v('ct-wa-status'),
      enabled: !!document.getElementById('ct-enabled')?.checked
    };
  },

  async saveChannelTemplateForm() {
    const r = await this.api(API.ccSaveChannelTemplate(this.readChannelTemplate(), this.actor()), 'Save template failed');
    if (r) { this.toast('Template saved', 'success'); await this.renderTab(); }
  },

  async previewChannelTemplate(channel) {
    const t = this.readChannelTemplate();
    const body = channel === 'sms' ? (t.sms_body || t.body) : channel === 'email' ? (t.email_text || t.body) : t.body;
    const r = await this.api(API.ccPreviewTemplate({ body, channel }, this.actor()), 'Preview failed');
    const out = document.getElementById('ct-preview');
    if (r && out) {
      out.textContent = `${channel.toUpperCase()}${r.sms_segments ? ` (${r.sms_segments} SMS)` : ''}:\n${r.text}${(r.missing || []).length ? `\n\nMissing shop details: ${r.missing.join(', ')}` : ''}`;
    }
  },

  /* ─── Scheduled / History / Failed / Media / Connections / Settings ─── */

  async viewScheduled() {
    const actor = this.actor();
    const [list, schedules, templates, branches] = await Promise.all([
      this.api(API.ccScheduled(actor), 'Could not load scheduled'),
      this.api(API.ccSchedules(actor), 'Could not load scheduled messages'),
      this.api(API.ccChannelTemplates(actor), 'Could not load templates'),
      this.api(API.ccBranches(actor), 'Could not load branches')
    ]);
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
    const sRows = (Array.isArray(schedules) ? schedules : []).map((s) => `<tr>
      <td><strong>${this.esc(s.name)}</strong></td>
      <td>${this.esc(s.send_at_local || '')}</td>
      <td>${this.esc((s.channels || []).join(', '))}</td>
      <td>${this.esc(s.recipient_count || 0)}${s.queued_count ? ` / queued ${this.esc(s.queued_count)}` : ''}</td>
      <td>${this.statusDot(s.status)}${s.error ? `<br><small class="cc-error">${this.esc(s.error)}</small>` : ''}</td>
      <td>
        ${s.status === 'draft' ? `<button type="button" class="btn btn-primary btn-sm" data-cc-act="sched-open" data-id="${s.id}">Review &amp; confirm</button>` : ''}
        ${['draft', 'scheduled'].includes(s.status) ? `<button type="button" class="btn btn-danger btn-sm" data-cc-act="sched-cancel" data-id="${s.id}">Cancel</button>` : ''}
      </td>
    </tr>`).join('');
    return `
      ${this.panel('Schedule a message', `
        ${this.messageFormHtml('sched', templates, branches)}
        <div class="cc-field"><label>Send at (South African time)</label><input type="datetime-local" id="sched-at"></div>
        <div class="cc-field"><label>Type</label>
          <select id="sched-category">
            <option value="scheduled">Marketing / announcement</option>
            <option value="reminder">Reminder</option>
            <option value="transaction">Service notice</option>
          </select></div>
        <div class="cc-actions"><button type="button" class="btn btn-primary btn-sm" data-cc-act="sched-review">Review before scheduling</button></div>
        <div id="sched-confirm-box"></div>
      `)}
      ${this.panel('Scheduled messages', this.table(['Name', 'Send at', 'Channels', 'Recipients', 'Status', ''], sRows, 'No scheduled messages'))}
      ${this.panel('Queued messages waiting for a time', this.table(['When', 'Channel', 'Recipient', 'Preview', 'Status', ''], rows, 'Nothing waiting'))}`;
  },

  messageFormHtml(prefix, templates, branches) {
    const tpls = Array.isArray(templates) ? templates : [];
    const brs = Array.isArray(branches) ? branches : [];
    return `<div class="cc-form-grid">
      <div class="cc-field"><label>Name</label><input id="${prefix}-name" placeholder="e.g. Weekend special"></div>
      <div class="cc-field"><label>Template</label>
        <select id="${prefix}-template"><option value="">— Type my own message —</option>
          ${tpls.filter((t) => Number(t.enabled)).map((t) => `<option value="${t.id}">${this.esc(t.name)} (${this.esc(t.category || '')})</option>`).join('')}
        </select></div>
      <div class="cc-field full"><label>Message (used when no template is chosen; variables like {customer_name} {shop_name} are allowed)</label>
        <textarea id="${prefix}-body" rows="3"></textarea></div>
      <div class="cc-field"><label>Channels</label>
        <div class="cc-checks" id="${prefix}-channels">
          ${['whatsapp', 'sms', 'email'].map((c) => `<label><input type="checkbox" value="${c}" ${c === 'whatsapp' ? 'checked' : ''}> ${c}</label>`).join('')}
        </div></div>
      <div class="cc-field"><label>Audience</label>
        <select id="${prefix}-audience">${this.AUDIENCE_TYPES.map(([v, l]) => `<option value="${v}">${this.esc(l)}</option>`).join('')}</select></div>
      <div class="cc-field"><label>Branch</label>
        <select id="${prefix}-branch"><option value="">All branches</option>
          ${brs.map((b) => `<option value="${b.id}">${this.esc(b.name)}</option>`).join('')}</select></div>
    </div>`;
  },

  readMessageForm(prefix) {
    const val = (id) => document.getElementById(`${prefix}-${id}`)?.value || '';
    const branch = val('branch');
    const audienceType = val('audience') || 'all_eligible';
    return {
      name: val('name').trim(),
      template_id: val('template') ? Number(val('template')) : null,
      body: val('body').trim(),
      channels: [...(document.getElementById(`${prefix}-channels`)?.querySelectorAll('input:checked') || [])].map((i) => i.value),
      audience: audienceType === 'branch' && branch ? { type: 'branch', branch_id: Number(branch) } : { type: audienceType },
      branch_id: branch ? Number(branch) : null
    };
  },

  async reviewSchedule() {
    const data = this.readMessageForm('sched');
    data.send_at_local = document.getElementById('sched-at')?.value || '';
    data.category = document.getElementById('sched-category')?.value || 'scheduled';
    const r = await this.api(API.ccSaveSchedule(data, this.actor()), 'Could not prepare schedule');
    if (r) this.showScheduleConfirmation(r);
  },

  showScheduleConfirmation(c) {
    const box = document.getElementById('sched-confirm-box');
    if (!box) return;
    const reach = Object.entries(c.reach_by_channel || {}).map(([ch, n]) => `${ch}: ${n}`).join(' · ');
    box.innerHTML = `<div class="cc-panel" style="margin-top:12px;border:2px solid #f59e0b">
      <div class="cc-panel-h"><h4>Please confirm before this is scheduled</h4></div>
      <div class="cc-panel-b">
        <p><strong>${this.esc(c.schedule?.name || '')}</strong></p>
        <p>Recipients: <strong>${this.esc(c.recipient_count)}</strong> (${this.esc(reach)})</p>
        <p>Channels: <strong>${this.esc((c.channels || []).join(', '))}</strong></p>
        <p>Send at: <strong>${this.esc(c.send_at_local)}</strong> (South African time)</p>
        <p>Sample message:</p><pre style="white-space:pre-wrap">${this.esc(c.sample?.text || '')}</pre>
        ${(c.sample?.missing || []).length ? `<p class="cc-error">Missing shop details: ${this.esc(c.sample.missing.join(', '))} — fix before confirming.</p>` : ''}
        ${c.marketing_window_note ? `<p class="cc-note">${this.esc(c.marketing_window_note)}</p>` : ''}
        <div class="cc-actions">
          <button type="button" class="btn btn-primary btn-sm" data-cc-act="sched-confirm" data-id="${c.schedule?.id}">Confirm schedule</button>
          <button type="button" class="btn btn-ghost btn-sm" data-cc-act="sched-cancel" data-id="${c.schedule?.id}">Discard</button>
        </div>
      </div></div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  async viewReminders() {
    const actor = this.actor();
    const [list, templates, branches] = await Promise.all([
      this.api(API.ccReminders(actor), 'Could not load reminders'),
      this.api(API.ccChannelTemplates(actor), 'Could not load templates'),
      this.api(API.ccBranches(actor), 'Could not load branches')
    ]);
    const rows = (Array.isArray(list) ? list : []).map((r) => `<tr>
      <td><strong>${this.esc(r.name)}</strong></td>
      <td>${this.esc(r.repeat)}</td>
      <td>${this.esc(r.next_run_local || '—')}</td>
      <td>${this.esc((r.channels || []).join(', '))}</td>
      <td>${this.esc(r.run_count || 0)}</td>
      <td>${this.statusDot(Number(r.enabled) ? 'active' : 'paused')}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-cc-act="rem-toggle" data-id="${r.id}" data-enabled="${Number(r.enabled) ? 1 : 0}">${Number(r.enabled) ? 'Pause' : 'Enable'}</button></td>
    </tr>`).join('');
    return `
      ${this.panel('New reminder', `
        ${this.messageFormHtml('rem', templates, branches)}
        <div class="cc-form-grid">
          <div class="cc-field"><label>First send (South African time)</label><input type="datetime-local" id="rem-at"></div>
          <div class="cc-field"><label>Repeat</label>
            <select id="rem-repeat"><option value="once">Once</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
        </div>
        <div class="cc-actions"><button type="button" class="btn btn-primary btn-sm" data-cc-act="rem-save">Save reminder</button></div>
      `)}
      ${this.panel('Reminders', this.table(['Name', 'Repeat', 'Next send', 'Channels', 'Sent runs', 'Status', ''], rows, 'No reminders'))}`;
  },

  async saveReminderForm() {
    const data = this.readMessageForm('rem');
    data.next_run_local = document.getElementById('rem-at')?.value || '';
    data.repeat = document.getElementById('rem-repeat')?.value || 'once';
    const r = await this.api(API.ccSaveReminder(data, this.actor()), 'Could not save reminder');
    if (r) { this.toast('Reminder saved', 'success'); await this.renderTab(); }
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
            ${['pending', 'processing', 'sent', 'delivered', 'failed', 'cancelled', 'retrying', 'held', 'blocked'].map((s) =>
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

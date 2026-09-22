/**
 * Manager & Supervisor HR / Disciplinary Portal
 */
window.MgrHrPortal = {
  view: 'dashboard',
  caseTab: 'details',
  app: null,
  ctx: null,
  dash: null,
  cases: [],
  selectedCase: null,
  staffFilter: '',
  navOpen: false,
  evidenceFiles: [],
  reportDraft: null,
  recordings: [],
  selectedRecording: null,
  _recorder: null,
  _recChunks: [],
  _recStream: null,
  _recStartedAt: 0,
  _recTimer: null,
  _speechRec: null,
  _liveTranscript: '',
  _preselectEmp: '',

  NAV: [
    ['dashboard', 'Dashboard', '▦'],
    ['staff', 'My Staff', '👤'],
    ['report', 'Report Incident', '⚠'],
    ['recording', 'Recording', '🎙'],
    ['cases', 'Disciplinary Cases', '📁'],
    ['warnings', 'Warnings', '⚑'],
    ['responses', 'Staff Responses', '💬'],
    ['performance', 'Performance Issues', '📈'],
    ['costs', 'Cost/Damage Reports', '💰'],
    ['meetings', 'Meetings/Hearings', '🗓'],
    ['notifications', 'Notifications', '🔔'],
    ['history', 'Case History', '⏱']
  ],

  actor() { return this.app?.user || (typeof App !== 'undefined' && App.user) || null; },
  esc(v) {
    return (typeof Utils !== 'undefined' && Utils.escHtml)
      ? Utils.escHtml(v)
      : String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  money(n) {
    const c = this.app?.settings?.currency || 'R';
    return (typeof Utils !== 'undefined' && Utils.formatMoney) ? Utils.formatMoney(Number(n) || 0, c) : `${c}${(Number(n) || 0).toFixed(2)}`;
  },
  toast(msg, type) { if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(msg, type || 'info'); },
  async api(promise, errMsg) {
    let r;
    try { r = await promise; } catch (e) { this.toast(e?.message || errMsg || 'Request failed', 'error'); return null; }
    if (!r || r.success === false) { this.toast((r && r.error) || errMsg || 'Request failed', 'error'); return null; }
    return r.data !== undefined ? r.data : r;
  },
  statusLabel(status) {
    const map = {
      REPORTED: 'Reported',
      UNDER_REVIEW: 'Under Review',
      EMPLOYEE_RESPONSE_REQUESTED: 'Awaiting Response',
      EMPLOYEE_RESPONDED: 'Employee Responded',
      MANAGER_RECOMMENDATION: 'Recommendation',
      ADMIN_REVIEW: 'Admin Review',
      DECISION: 'Decision',
      CLOSED: 'Closed'
    };
    return map[String(status || '')] || String(status || '').replace(/_/g, ' ');
  },
  badge(status) {
    const s = String(status || '');
    const map = {
      REPORTED: 'warn', UNDER_REVIEW: 'info', EMPLOYEE_RESPONSE_REQUESTED: 'warn',
      EMPLOYEE_RESPONDED: 'ok', MANAGER_RECOMMENDATION: 'info', ADMIN_REVIEW: 'info',
      DECISION: 'ok', CLOSED: 'muted'
    };
    return `<span class="mgrhr-badge mgrhr-badge-${map[s] || 'muted'}">${this.esc(this.statusLabel(s))}</span>`;
  },
  initials(name) {
    return String(name || 'M').split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || 'M';
  },
  greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
  },

  async open(app, opts = {}) {
    this.app = app || this.app;
    this.view = opts.view || 'dashboard';
    this.navOpen = false;
    await this.render(opts.container || document.getElementById('mgr-hr-root'));
  },

  async render(root) {
    this.container = root || this.container;
    if (!this.container) return;
    // Paint shell immediately so login feels instant
    this.container.innerHTML = `<div class="mgrhr-shell"><div class="mgrhr-workspace"><header class="mgrhr-top"><strong>Manager &amp; Supervisor Portal</strong></header>
      <main class="mgrhr-main"><p class="muted" style="padding:24px">Opening…</p></main></div></div>`;
    const ctx = await this.api(API.mgrHrPortalContext(this.actor()), 'Could not open portal');
    if (!ctx) {
      this.container.innerHTML = `<div class="mgrhr-shell"><div class="mgrhr-workspace"><div class="mgrhr-main">
        <div class="mgrhr-card"><p>Access denied. Ask Admin to assign Manager/Supervisor Portal access under Staff &amp; HR — or sign in with Admin / owner credentials (Admin Access needs no assignment).</p>
        <button type="button" class="mgrhr-btn-ghost" id="mgrhr-back">Back</button></div></div></div></div>`;
      document.getElementById('mgrhr-back')?.addEventListener('click', () => this.close());
      return;
    }
    this.ctx = ctx;
    // First paint with whatever we already have, then load data
    this.paint();
    await this.refreshAndPaint({ light: true });
  },

  async refreshAndPaint(opts = {}) {
    const light = !!opts.light;
    const needRecordings = !light || this.view === 'recording' || this.view === 'meetings';
    const needNotes = !light || this.view === 'notifications' || this.view === 'dashboard';
    const tasks = [
      this.api(API.mgrHrDashboard(this.actor()), 'Dashboard failed'),
      this.api(API.mgrHrListCases({ limit: light ? 80 : 200 }, this.actor()), 'Cases failed')
    ];
    if (needNotes) tasks.push(this.api(API.mgrHrListNotifications(null, this.actor()), 'Notifications failed'));
    else tasks.push(Promise.resolve(this.notes || []));
    if (needRecordings) tasks.push(this.api(API.mgrHrListRecordings({}, this.actor()), 'Recordings failed'));
    else tasks.push(Promise.resolve(this.recordings || []));
    const [dash, cases, notes, recordings] = await Promise.all(tasks);
    this.dash = dash || { counts: {} };
    this.cases = cases || [];
    this.notes = notes || this.notes || [];
    this.recordings = recordings || this.recordings || [];
    this.paint();
  },

  /** Instant nav — paint from cache, refresh in background when needed */
  goView(viewId) {
    if (this.view === 'report') this.captureReportDraft();
    this.view = viewId;
    this.selectedCase = null;
    this.selectedRecording = null;
    this.caseTab = 'details';
    this.navOpen = false;
    this.paint();
    if (viewId === 'recording' || viewId === 'meetings') {
      if (!this.recordings?.length) this.refreshAndPaint({ light: false }).catch(() => {});
    } else if (viewId === 'notifications' && !this.notes?.length) {
      this.refreshAndPaint({ light: false }).catch(() => {});
    }
  },

  paint() {
    const adminBanner = this.ctx?.admin_access
      ? `<div class="mgrhr-admin-banner">Admin Access — unrestricted across branches · actions are audited</div>`
      : '';
    const roleLabel = this.ctx?.admin_access ? 'Admin' : (this.ctx?.mode || this.ctx?.assignment?.portal_role || 'Supervisor');
    const name = this.actor()?.full_name || 'Manager';
    const unread = (this.notes || []).filter((n) => !Number(n.is_read)).length;
    const shop = this.app?.settings?.shop_name || 'Shop POS';
    const body = this.renderView();

    this.container.innerHTML = `<div class="mgrhr-shell ${this.navOpen ? 'mgrhr-nav-open' : ''}">
      ${adminBanner}
      <div class="mgrhr-backdrop" id="mgrhr-backdrop"></div>
      <aside class="mgrhr-sidebar">
        <div class="mgrhr-brand">
          <div class="mgrhr-brand-mark">CC</div>
          <div><strong>${this.esc(shop)}</strong><span>Manager &amp; Supervisor Portal</span></div>
        </div>
        ${this.NAV.map(([id, label, ico]) => {
          const badge = id === 'notifications' && unread
            ? `<span class="mgrhr-nav-badge">${unread > 9 ? '9+' : unread}</span>` : '';
          return `<button type="button" class="mgrhr-nav-btn ${this.view === id ? 'active' : ''}" data-mgrhr-view="${id}">
            <span class="mgrhr-nav-ico">${ico}</span>${this.esc(label)}${badge}</button>`;
        }).join('')}
      </aside>
      <div class="mgrhr-workspace">
        <header class="mgrhr-top">
          <div class="mgrhr-top-left">
            <button type="button" class="mgrhr-menu-toggle" id="mgrhr-menu" aria-label="Menu">☰</button>
            <div>
              <strong>${this.esc(this.viewTitle())}</strong>
              <span class="muted">${this.esc(roleLabel)} portal</span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <div class="mgrhr-user-chip">
              <div class="mgrhr-avatar">${this.esc(this.initials(name))}</div>
              <div class="mgrhr-user-meta">
                <strong style="font-size:13px;display:block">${this.esc(name)}</strong>
                <span class="muted" style="font-size:11px">${this.esc(roleLabel)}</span>
              </div>
            </div>
            <button type="button" class="mgrhr-btn-close" id="mgrhr-logout">Close</button>
          </div>
        </header>
        <main class="mgrhr-main">${body}</main>
      </div>
    </div>`;

    document.getElementById('mgrhr-logout')?.addEventListener('click', () => this.close());
    document.getElementById('mgrhr-menu')?.addEventListener('click', () => {
      this.navOpen = !this.navOpen;
      this.container.querySelector('.mgrhr-shell')?.classList.toggle('mgrhr-nav-open', this.navOpen);
    });
    document.getElementById('mgrhr-backdrop')?.addEventListener('click', () => {
      this.navOpen = false;
      this.container.querySelector('.mgrhr-shell')?.classList.remove('mgrhr-nav-open');
    });
    this.container.querySelectorAll('[data-mgrhr-view]').forEach((b) => {
      b.addEventListener('click', () => this.goView(b.dataset.mgrhrView));
    });
    this.bindViewActions();
  },

  viewTitle() {
    const row = this.NAV.find((n) => n[0] === this.view);
    return row ? row[1] : 'Dashboard';
  },

  renderView() {
    switch (this.view) {
      case 'staff': return this.viewStaff();
      case 'report': return this.viewReport();
      case 'recording': return this.viewRecording();
      case 'cases': return this.viewCases();
      case 'warnings': return this.viewWarnings();
      case 'responses': return this.viewResponses();
      case 'performance': return this.viewPerformance();
      case 'costs': return this.viewCosts();
      case 'meetings': return this.viewMeetings();
      case 'notifications': return this.viewNotes();
      case 'history': return this.viewHistory();
      default: return this.viewDashboard();
    }
  },

  viewDashboard() {
    const c = this.dash?.counts || {};
    const first = String(this.actor()?.full_name || 'Manager').split(/\s+/)[0];
    return `<p class="mgrhr-hello"><span>${this.esc(this.greeting())},</span>${this.esc(first)}</p>
      <div class="mgrhr-kpis">
        <div class="mgrhr-kpi mgrhr-kpi-open"><span>Open Cases</span><strong>${c.open || 0}</strong></div>
        <div class="mgrhr-kpi mgrhr-kpi-pending"><span>Pending Responses</span><strong>${c.pending_responses || 0}</strong></div>
        <div class="mgrhr-kpi mgrhr-kpi-recent"><span>Recent Incidents</span><strong>${(this.dash?.recent || []).length || c.total || 0}</strong></div>
        <div class="mgrhr-kpi mgrhr-kpi-warn"><span>Warnings</span><strong>${c.warnings || 0}</strong></div>
      </div>
      <div class="mgrhr-quick">
        <button type="button" class="qa-report" data-mgrhr-view="report">Report Incident</button>
        <button type="button" class="qa-cases" data-mgrhr-view="cases">Disciplinary Cases</button>
      </div>
      <div class="mgrhr-card"><h3>Recent Cases</h3>${this.caseTable(this.dash?.recent || this.cases.slice(0, 10))}</div>
      <div class="mgrhr-card"><h3>Cases requiring action</h3>${this.caseTable(this.dash?.needing_action || [])}</div>`;
  },

  viewStaff() {
    const q = String(this.staffFilter || '').toLowerCase();
    let rows = this.ctx?.employees || [];
    if (q) rows = rows.filter((e) => `${e.full_name} ${e.position} ${e.branch}`.toLowerCase().includes(q));
    return `<div class="mgrhr-card"><h3>My Staff</h3>
      <p class="muted" style="margin-top:0">Only employees assigned to you by Admin.</p>
      <div class="mgrhr-toolbar">
        <input type="search" id="mh-staff-q" placeholder="Search staff…" value="${this.esc(this.staffFilter || '')}" style="flex:1;min-width:160px">
      </div>
      <div class="table-wrap"><table class="data-table"><thead><tr>
        <th>Name</th><th>Position</th><th>Branch</th><th>Status</th><th></th>
      </tr></thead><tbody>
        ${rows.map((e) => `<tr>
          <td><strong>${this.esc(e.full_name)}</strong><div class="muted" style="font-size:11px">${this.esc(e.employee_code || '')}</div></td>
          <td>${this.esc(e.position || '')}</td>
          <td>${this.esc(e.branch || this.ctx?.assignment?.branch_name || '')}</td>
          <td><span class="mgrhr-badge mgrhr-badge-ok">${this.esc(e.status || 'Active')}</span></td>
          <td><button type="button" class="btn btn-sm btn-ghost" data-mh-report-emp="${e.id}">Report</button></td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">No staff assigned</td></tr>'}
      </tbody></table></div></div>`;
  },

  captureReportDraft() {
    if (this.view !== 'report') return;
    this.reportDraft = {
      employee_id: document.getElementById('mh-emp')?.value || '',
      branch_id: document.getElementById('mh-branch')?.value || '',
      incident_date: document.getElementById('mh-date')?.value || '',
      incident_time: document.getElementById('mh-time')?.value || '',
      incident_type: document.getElementById('mh-type')?.value || '',
      severity: document.getElementById('mh-sev')?.value || 'medium',
      title: document.getElementById('mh-title')?.value || '',
      description: document.getElementById('mh-desc')?.value || '',
      what_happened: document.getElementById('mh-what')?.value || '',
      witnesses: document.getElementById('mh-wit')?.value || '',
      reported_loss: document.getElementById('mh-loss')?.value || '0',
      recommended_recovery: document.getElementById('mh-recov')?.value || '0',
      recommended_action: document.getElementById('mh-action')?.value || '',
      additional_notes: document.getElementById('mh-notes')?.value || '',
      decision_taken: document.getElementById('mh-decision')?.value || '',
      request_employee_response: !!document.getElementById('mh-ask')?.checked
    };
  },

  attachListHtml() {
    const files = this.evidenceFiles || [];
    if (!files.length) {
      return '<p class="muted" style="margin:0;font-size:13px;grid-column:1/-1">No attachments yet. Upload or take as many photos as you need.</p>';
    }
    return files.map((f, i) => `<div class="mgrhr-attach-item">
      ${f.is_image && f.dataUrl ? `<img src="${f.dataUrl}" alt="">` : '<div style="height:72px;display:grid;place-items:center;font-size:22px">📄</div>'}
      <span>${this.esc(f.name || ('Attachment ' + (i + 1)))}</span>
      <button type="button" class="btn btn-sm btn-ghost mh-attach-rm" data-i="${i}">Remove</button>
    </div>`).join('');
  },

  refreshAttachListOnly() {
    const list = document.getElementById('mh-attach-list');
    if (list) list.innerHTML = this.attachListHtml();
    this.container.querySelectorAll('.mh-attach-rm').forEach((b) => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        this.evidenceFiles = (this.evidenceFiles || []).filter((_, idx) => idx !== i);
        this.refreshAttachListOnly();
      });
    });
  },

  viewReport() {
    const emps = this.ctx?.employees || [];
    const branches = this.ctx?.branches || [];
    const types = this.ctx?.incident_types || [];
    const d = this.reportDraft || {};
    const preEmp = d.employee_id || this._preselectEmp || '';
    const defaultBranch = d.branch_id || this.ctx?.assignment?.branch_id || '';
    const dateVal = d.incident_date || new Date().toISOString().slice(0, 10);
    const sev = d.severity || 'medium';
    const ask = d.request_employee_response !== false;
    return `<div class="mgrhr-card"><h3>Report Incident / Wrongdoing</h3>
      <p class="muted" style="margin-top:0">You are reporting an incident. Your recommendation is not the final HR decision. Photos stay small on this form — add as many as you need.</p>
      <div class="form-grid">
        <div class="field"><label>Employee *</label>
          <select id="mh-emp">${emps.map((e) => `<option value="${e.id}" ${String(e.id) === String(preEmp) ? 'selected' : ''}>${this.esc(e.full_name)}</option>`).join('')}</select></div>
        <div class="field"><label>Branch</label>
          <select id="mh-branch"><option value="">—</option>${branches.map((b) => `<option value="${b.id}" ${String(b.id) === String(defaultBranch) ? 'selected' : ''}>${this.esc(b.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Date *</label><input type="date" id="mh-date" value="${this.esc(dateVal)}"></div>
        <div class="field"><label>Time</label><input type="time" id="mh-time" value="${this.esc(d.incident_time || '')}"></div>
        <div class="field"><label>Incident type *</label>
          <select id="mh-type">${types.map((t) => `<option ${d.incident_type === t ? 'selected' : ''}>${this.esc(t)}</option>`).join('')}</select></div>
        <div class="field"><label>Severity</label>
          <select id="mh-sev">
            ${['low', 'medium', 'high', 'critical'].map((s) => `<option value="${s}" ${sev === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
          </select></div>
        <div class="field full"><label>Title</label><input id="mh-title" placeholder="Short title" value="${this.esc(d.title || '')}"></div>
        <div class="field full"><label>Description *</label><textarea id="mh-desc" rows="3" placeholder="Describe the incident clearly…">${this.esc(d.description || '')}</textarea></div>
        <div class="field full"><label>What happened</label><textarea id="mh-what" rows="3">${this.esc(d.what_happened || '')}</textarea></div>
        <div class="field full"><label>Witnesses</label><input id="mh-wit" placeholder="Name / role" value="${this.esc(d.witnesses || '')}"></div>
        <div class="field"><label>Estimated cost / damage (R)</label><input type="text" inputmode="decimal" id="mh-loss" value="${this.esc(d.reported_loss || '0')}"></div>
        <div class="field"><label>Recommended recovery (R)</label><input type="text" inputmode="decimal" id="mh-recov" value="${this.esc(d.recommended_recovery || '0')}">
          <small class="muted">Not deducted automatically</small></div>
        <div class="field full"><label>Recommended action</label>
          <select id="mh-action">
            <option value="">Select…</option>
            ${['Verbal counselling', 'Written Warning', 'Final Warning', 'Training required', 'Hearing recommended', 'Other']
    .map((o) => `<option ${d.recommended_action === o ? 'selected' : ''}>${o}</option>`).join('')}
          </select></div>
        <div class="field full"><label>Decision taken</label>
          <textarea id="mh-decision" rows="3" placeholder="Write the decision that was taken…">${this.esc(d.decision_taken || '')}</textarea></div>
        <div class="field full"><label>Additional notes</label><textarea id="mh-notes" rows="2">${this.esc(d.additional_notes || '')}</textarea></div>
        <div class="field full"><label>Attachments (add many photos / files)</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <button type="button" class="mgrhr-btn-primary" id="mh-attach-file">Upload photo / file</button>
            <button type="button" class="mgrhr-btn-ghost" id="mh-attach-camera">Take photo (rear camera)</button>
          </div>
          <div id="mh-attach-list" class="mgrhr-attach-list">${this.attachListHtml()}</div>
        </div>
        <div class="field full"><label><input type="checkbox" id="mh-ask" ${ask ? 'checked' : ''}> Request employee response in Staff Portal</label></div>
      </div>
      <div class="mgrhr-form-actions">
        <button type="button" class="mgrhr-btn-primary" id="mh-submit">Submit Report</button>
        <button type="button" class="mgrhr-btn-ghost" data-mgrhr-view="dashboard">Cancel</button>
      </div>
    </div>`;
  },

  async addEvidenceFromDataUrl(dataUrl, name, isImage) {
    if (!dataUrl) return;
    this.captureReportDraft();
    let url = dataUrl;
    if (String(dataUrl).startsWith('data:image')) {
      try {
        url = await this.compressDataUrl(dataUrl, 960, 0.65);
      } catch (_) { /* keep original */ }
    }
    if (!Array.isArray(this.evidenceFiles)) this.evidenceFiles = [];
    if (this.evidenceFiles.length >= 40) return this.toast('Maximum 40 attachments', 'error');
    this.evidenceFiles.push({
      name: name || (isImage ? `photo-${Date.now()}.jpg` : `file-${Date.now()}`),
      dataUrl: url,
      is_image: !!isImage
    });
    // Only refresh thumbnails — do not rebuild the whole form (that was wiping typed fields)
    this.refreshAttachListOnly();
  },

  compressDataUrl(dataUrl, maxW, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / (img.width || maxW));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('compress failed'));
      img.src = dataUrl;
    });
  },

  caseTable(rows) {
    if (!rows?.length) return '<p class="muted">None</p>';
    return `<div class="table-wrap"><table class="data-table"><thead><tr>
      <th>Case No.</th><th>Employee</th><th>Incident Type</th><th>Date</th><th>Status</th><th></th>
    </tr></thead><tbody>${rows.map((c) => `<tr>
      <td><strong>${this.esc(c.case_number)}</strong></td>
      <td>${this.esc(c.employee_name || '')}</td>
      <td>${this.esc(c.incident_type)}</td>
      <td>${this.esc(String(c.incident_date || c.created_at || '').slice(0, 10))}</td>
      <td>${this.badge(c.status)}</td>
      <td><button type="button" class="btn btn-sm btn-primary" data-mh-open="${c.id}">View</button></td>
    </tr>`).join('')}</tbody></table></div>`;
  },

  viewCases() {
    if (this.selectedCase) return this.viewCaseDetail(this.selectedCase);
    return `<div class="mgrhr-card"><h3>Disciplinary Cases</h3>${this.caseTable(this.cases)}</div>`;
  },

  viewWarnings() {
    const rows = (this.cases || []).filter((c) => c.warning_id);
    return `<div class="mgrhr-card"><h3>Warnings</h3>${this.caseTable(rows)}</div>`;
  },

  viewResponses() {
    const rows = (this.cases || []).filter((c) =>
      c.has_response || ['EMPLOYEE_RESPONDED', 'MANAGER_RECOMMENDATION', 'ADMIN_REVIEW', 'DECISION', 'CLOSED'].includes(c.status));
    if (!rows.length) {
      return `<div class="mgrhr-card"><h3>Staff Responses</h3><p class="muted">No employee replies yet. When a worker submits a response from Staff Portal, it appears here.</p></div>`;
    }
    return `<div class="mgrhr-card"><h3>Staff Responses</h3>
      <p class="muted">Full replies are on each case under <strong>Employee Response</strong>.</p>
      <div class="table-wrap"><table class="data-table"><thead><tr>
        <th>Case</th><th>Employee</th><th>Status</th><th>Reply</th><th></th>
      </tr></thead><tbody>
        ${rows.map((c) => `<tr>
          <td><strong>${this.esc(c.case_number)}</strong></td>
          <td>${this.esc(c.employee_name || '')}</td>
          <td>${this.badge(c.status)}</td>
          <td><small>${this.esc(String(c.last_response_preview || 'Open case for full reply').slice(0, 140))}</small>
            ${c.last_response_agree ? `<div class="muted" style="font-size:11px">${this.esc(c.last_response_agree)}</div>` : ''}</td>
          <td><button type="button" class="btn btn-sm btn-primary" data-mh-open="${c.id}">View reply</button></td>
        </tr>`).join('')}
      </tbody></table></div>
    </div>`;
  },

  viewPerformance() {
    const rows = (this.cases || []).filter((c) => /performance|late|absence|instruction/i.test(String(c.incident_type || '')));
    return `<div class="mgrhr-card"><h3>Performance Issues</h3>${this.caseTable(rows)}</div>`;
  },

  viewMeetings() {
    const rows = (this.cases || []).filter((c) =>
      /hearing|meeting/i.test(String(c.recommended_action || '')) || ['ADMIN_REVIEW', 'MANAGER_RECOMMENDATION'].includes(c.status));
    return `<div class="mgrhr-card"><h3>Meetings / Hearings</h3>
      <p class="muted">Cases that may require a hearing or formal meeting. Use the <strong>Recording</strong> tab to capture conversations.</p>
      ${this.caseTable(rows)}</div>`;
  },

  viewRecording() {
    if (this.selectedRecording) return this.viewRecordingDetail(this.selectedRecording);
    const recording = !!this._recorder;
    const secs = this._recStartedAt ? Math.floor((Date.now() - this._recStartedAt) / 1000) : 0;
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    return `<div class="mgrhr-card"><h3>Recording</h3>
      <p class="muted" style="margin-top:0">Start a conversation or hearing recording. Enter who it is between, then Start / Stop. Audio is sent to Admin with AI summary and suggested decision.</p>
      <div class="form-grid">
        <div class="field"><label>Type</label>
          <select id="mh-rec-type">
            <option value="conversation">Conversation</option>
            <option value="hearing">Hearing</option>
          </select></div>
        <div class="field"><label>Title (optional)</label><input id="mh-rec-title" placeholder="e.g. Performance discussion"></div>
        <div class="field"><label>Between (person 1) *</label><input id="mh-rec-a" placeholder="Name / role"></div>
        <div class="field"><label>And (person 2) *</label><input id="mh-rec-b" placeholder="Name / role"></div>
        <div class="field full">
          <div class="mgrhr-rec-status ${recording ? '' : 'idle'}" id="mh-rec-status">
            ${recording ? '<span class="mgrhr-rec-dot"></span> Recording…' : 'Ready'}
            <span id="mh-rec-timer">${mm}:${ss}</span>
          </div>
        </div>
        <div class="field full"><label>Live / notes transcript</label>
          <textarea id="mh-rec-transcript" rows="5" placeholder="Speech notes appear here while recording (if supported). You can also type the conversation…">${this.esc(this._liveTranscript || '')}</textarea>
        </div>
      </div>
      <div class="mgrhr-form-actions" style="margin-top:12px">
        ${recording
    ? '<button type="button" class="btn btn-danger" id="mh-rec-stop">Stop &amp; save recording</button>'
    : '<button type="button" class="mgrhr-btn-primary" id="mh-rec-start">Start recording</button>'}
      </div>
    </div>
    <div class="mgrhr-card" style="margin-top:14px"><h3>Saved recordings</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr>
        <th>No.</th><th>Between</th><th>Type</th><th>AI</th><th>When</th><th></th>
      </tr></thead><tbody>
        ${(this.recordings || []).map((r) => `<tr>
          <td><strong>${this.esc(r.recording_number)}</strong></td>
          <td>${this.esc(r.party_a || '')} · ${this.esc(r.party_b || '')}</td>
          <td>${this.esc(r.conversation_type || '')}</td>
          <td>${this.esc(r.ai_status || 'pending')}</td>
          <td>${this.esc(String(r.created_at || '').slice(0, 16))}</td>
          <td><button type="button" class="btn btn-sm btn-primary" data-mh-open-rec="${r.id}">Open</button></td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No recordings yet</td></tr>'}
      </tbody></table></div>
    </div>`;
  },

  viewRecordingDetail(r) {
    const admin = this.ctx?.admin_access || ['owner', 'manager', 'assistant_manager', 'admin'].includes(String(this.actor()?.role || '').toLowerCase());
    const points = Array.isArray(r.ai_key_points) ? r.ai_key_points : [];
    return `<div class="mgrhr-card">
      <button type="button" class="mgrhr-btn-ghost btn-sm" id="mh-back-recs">← Back</button>
      <h3 style="margin-top:12px">${this.esc(r.recording_number)} · ${this.esc(r.title || '')}</h3>
      <div class="mgrhr-summary-bar">
        <div><strong>Between</strong>${this.esc(r.party_a || '')} and ${this.esc(r.party_b || '')}</div>
        <div><strong>Type</strong>${this.esc(r.conversation_type || '')}</div>
        <div><strong>Recorded by</strong>${this.esc(r.recorded_by_name || '')}</div>
        <div><strong>When</strong>${this.esc(r.created_at || '')}</div>
        <div><strong>AI</strong>${this.esc(r.ai_status || '')}</div>
      </div>
      ${r.audio_data ? `<div style="margin:12px 0"><audio controls src="${r.audio_data}" style="width:100%;max-width:520px"></audio></div>` : '<p class="muted">Audio not loaded</p>'}
      <div class="mgrhr-tabs">
        <button type="button" class="mgrhr-tab active">Original</button>
        <button type="button" class="mgrhr-tab">AI</button>
      </div>
      <h4>Original transcript</h4>
      <div class="mgrhr-a4-doc" id="mh-rec-doc-original">
        <h2>${this.esc(this.app?.settings?.shop_name || 'Company')}</h2>
        <div class="mgrhr-a4-meta">${this.esc(r.conversation_type === 'hearing' ? 'Hearing' : 'Conversation')} between
          <strong>${this.esc(r.party_a || '')}</strong> and <strong>${this.esc(r.party_b || '')}</strong></div>
        ${(String(r.transcript_original || '—').split(/\n+/).filter(Boolean).map((p) => `<p>${this.esc(p)}</p>`).join('') || '<p>—</p>')}
        <div class="mgrhr-a4-foot">Date &amp; time: ${this.esc(r.created_at || '')} · Duration ${this.esc(r.duration_seconds || 0)}s</div>
      </div>
      <h4 style="margin-top:18px">AI summary &amp; points</h4>
      <div class="mgrhr-a4-doc">
        ${(String(r.transcript_summary || 'Run AI analysis to generate a summary.').split(/\n+/).filter(Boolean).map((p) => `<p>${this.esc(p)}</p>`).join(''))}
        ${points.length ? `<ul>${points.map((p) => `<li>${this.esc(p)}</li>`).join('')}</ul>` : ''}
        <p><strong>Suggested decision:</strong> ${this.esc(r.ai_suggested_decision || '—')}</p>
        <div class="mgrhr-a4-foot">Date &amp; time: ${this.esc(r.created_at || '')}</div>
      </div>
      <div class="field" style="margin-top:14px"><label>Decision taken</label>
        <textarea id="mh-rec-decision" rows="3" placeholder="Write the decision taken…">${this.esc(r.final_decision || '')}</textarea></div>
      ${admin ? `<div class="field"><label>Highlight phrases (comma-separated — shown marked on PDF)</label>
        <input id="mh-rec-highlights" value="${this.esc((r.admin_highlights || []).map((h) => h.text || h).join(', '))}"></div>` : ''}
      <div class="mgrhr-actions">
        <button type="button" class="mgrhr-btn-primary" id="mh-rec-ai">Run / refresh AI</button>
        <button type="button" class="mgrhr-btn-ghost" id="mh-rec-save-decision">Save decision</button>
        <button type="button" class="mgrhr-btn-ghost" id="mh-rec-print">Print AI &amp; transcript PDF</button>
        <button type="button" class="mgrhr-btn-ghost" id="mh-rec-save-pdf">Save PDF</button>
        <button type="button" class="btn btn-success" id="mh-rec-wa">WhatsApp summary</button>
        ${r.audio_data ? '<button type="button" class="mgrhr-btn-ghost" id="mh-rec-download">Download audio</button>' : ''}
        ${admin ? '<button type="button" class="btn btn-danger" id="mh-rec-delete">Delete</button>' : ''}
      </div>
    </div>`;
  },

  viewCosts() {
    const rows = (this.cases || []).filter((c) => Number(c.reported_loss) > 0 || Number(c.recommended_recovery) > 0);
    return `<div class="mgrhr-card"><h3>Cost / Damage Reports</h3>
      <p class="muted">Reported loss is not an automatic salary deduction. Admin must approve recovery separately.</p>
      <div class="table-wrap"><table class="data-table"><thead><tr>
        <th>Case</th><th>Employee</th><th>Reported loss</th><th>Recommended</th><th>Approved</th><th>Payroll deducted</th><th></th>
      </tr></thead><tbody>
        ${rows.map((c) => `<tr>
          <td>${this.esc(c.case_number)}</td><td>${this.esc(c.employee_name || '')}</td>
          <td>${this.money(c.reported_loss)}</td><td>${this.money(c.recommended_recovery)}</td>
          <td>${this.money(c.approved_recovery)}</td><td>${this.money(c.actual_payroll_deduction)}</td>
          <td><button type="button" class="btn btn-sm btn-ghost" data-mh-open="${c.id}">View</button></td>
        </tr>`).join('') || '<tr><td colspan="7" class="muted">No cost reports</td></tr>'}
      </tbody></table></div></div>`;
  },

  viewNotes() {
    return `<div class="mgrhr-card"><h3>Notifications</h3>
      <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px">
        ${(this.notes || []).map((n) => `<li class="mgrhr-note ${Number(n.is_read) ? '' : 'new'}">
          <strong>${this.esc(n.title)}</strong>
          <div>${this.esc(n.message || '')}</div>
          <small class="muted">${this.esc(String(n.created_at || '').slice(0, 16))}</small>
        </li>`).join('') || '<li class="muted">No notifications</li>'}
      </ul></div>`;
  },

  viewHistory() {
    return `<div class="mgrhr-card"><h3>Case History</h3>${this.caseTable(this.cases)}</div>`;
  },

  viewCaseDetail(c) {
    const admin = this.ctx?.admin_access || ['owner', 'manager', 'assistant_manager', 'admin'].includes(String(this.actor()?.role || '').toLowerCase());
    const canWarn = this.ctx?.can_create_warnings;
    const tab = this.caseTab || 'details';
    const tabs = [
      ['details', 'Details'],
      ['history', 'Status History'],
      ['response', 'Employee Response'],
      ['attachments', 'Attachments'],
      ['recommend', 'Recommendations']
    ];
    let panel = '';
    if (tab === 'history') {
      panel = `<ul class="mgrhr-timeline">${(c.events || []).map((e) => `<li>
        <strong>${this.esc(e.action)}</strong> ${e.previous_status ? `${this.esc(this.statusLabel(e.previous_status))} → ${this.esc(this.statusLabel(e.new_status))}` : ''}
        <div>${this.esc(e.notes || '')}</div>
        <small class="muted">${this.esc(e.actor_name || '')} · ${this.esc(String(e.created_at || '').slice(0, 16))}</small>
      </li>`).join('') || '<li class="muted">No history yet</li>'}</ul>`;
    } else if (tab === 'response') {
      panel = (c.responses || []).map((r) => `<div class="mgrhr-note"><strong>Employee reply v${r.version}</strong>
        ${r.agree_disagree ? ` · <span class="tag">${this.esc(r.agree_disagree)}</span>` : ''}
        <p style="white-space:pre-wrap;margin:8px 0 0">${this.esc(r.response_text || '')}</p>
        ${r.explanation ? `<p style="white-space:pre-wrap"><em>Further details:</em> ${this.esc(r.explanation)}</p>` : ''}
        ${r.supporting_info ? `<p style="white-space:pre-wrap"><em>Supporting info:</em> ${this.esc(r.supporting_info)}</p>` : ''}
        <small class="muted">${this.esc(String(r.submitted_at || '').slice(0, 16))} · locked</small></div>`).join('')
        || '<p class="muted">No employee response yet — use “Request employee response” so they can reply in Staff Portal.</p>';
    } else if (tab === 'attachments') {
      const paths = c.evidence_paths || [];
      panel = paths.length
        ? `<div class="mgrhr-attach-list">${paths.map((p, i) => {
          const isImg = typeof p === 'string' && /^data:image\//i.test(p);
          return `<div class="mgrhr-attach-item">${isImg ? `<img src="${p}" alt="Evidence ${i + 1}">` : ''}
            <span>${isImg ? `Photo ${i + 1}` : this.esc(String(p).slice(0, 80))}</span></div>`;
        }).join('')}</div>`
        : '<p class="muted">No attachments on this case yet.</p>';
    } else if (tab === 'recommend') {
      panel = (c.recommendations || []).map((r) => `<div class="mgrhr-note">
        <strong>${this.esc(r.recommended_by_name || 'Manager')}</strong>
        <p>${this.esc(r.recommendation_text || '')}</p>
        ${r.recommended_recovery_amount ? `<small>Recovery: ${this.money(r.recommended_recovery_amount)}</small>` : ''}
      </div>`).join('') || `<p>${this.esc(c.recommended_action || 'No recommendations yet')}</p>`;
    } else {
      panel = `<div class="mgrhr-detail">
        <div class="full"><strong>Incident details</strong><p>${this.esc(c.description || '')}</p></div>
        <div class="full"><strong>What happened</strong><p>${this.esc(c.what_happened || '—')}</p></div>
        <div><strong>Witnesses</strong><p>${this.esc(c.witnesses || '—')}</p></div>
        <div><strong>Recommended action</strong><p>${this.esc(c.recommended_action || '—')}</p></div>
        ${c.decision_taken ? `<div class="full"><strong>Decision taken</strong><p>${this.esc(c.decision_taken)}</p></div>` : ''}
        ${c.cost ? `<div class="full"><strong>Costs</strong><p>Reported ${this.money(c.cost.reported_loss)} · Recommended recovery ${this.money(c.cost.recommended_recovery)} · Approved ${this.money(c.cost.approved_recovery)} · Payroll deducted ${this.money(c.cost.actual_payroll_deduction)}</p></div>` : ''}
        ${c.final_decision ? `<div class="full"><strong>Final decision</strong><p>${this.esc(c.final_decision)}</p><p>${this.esc(c.final_decision_notes || '')}</p></div>` : ''}
      </div>`;
    }

    return `<div class="mgrhr-card">
      <button type="button" class="mgrhr-btn-ghost btn-sm" id="mh-back-cases">← Back</button>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px">
        <h3 style="margin:0">${this.esc(c.case_number)}</h3>
        ${this.badge(c.status)}
      </div>
      <div class="mgrhr-summary-bar">
        <div><strong>Employee</strong>${this.esc(c.employee_name || '')}</div>
        <div><strong>Branch</strong>${this.esc(c.branch_name || '—')}</div>
        <div><strong>Reported by</strong>${this.esc(c.reporter_name || '')}</div>
        <div><strong>Date</strong>${this.esc(c.incident_date || '')} ${this.esc(c.incident_time || '')}</div>
        <div><strong>Severity</strong>${this.esc(c.severity || '')}</div>
        <div><strong>Type</strong>${this.esc(c.incident_type || '')}</div>
      </div>
      <div class="mgrhr-tabs">${tabs.map(([id, label]) =>
        `<button type="button" class="mgrhr-tab ${tab === id ? 'active' : ''}" data-mh-tab="${id}">${label}</button>`
      ).join('')}</div>
      ${panel}
      <div class="mgrhr-actions">
        <button type="button" class="mgrhr-btn-ghost" data-mh-status="UNDER_REVIEW">Mark under review</button>
        <button type="button" class="mgrhr-btn-ghost" data-mh-status="EMPLOYEE_RESPONSE_REQUESTED">Request employee response</button>
        <button type="button" class="mgrhr-btn-primary" id="mh-recommend">Add recommendation</button>
        ${canWarn ? '<button type="button" class="btn btn-warning" id="mh-warn">Issue warning</button>' : ''}
        ${admin ? '<button type="button" class="btn btn-success" id="mh-decide">Finalise decision</button>' : ''}
        ${admin ? '<button type="button" class="mgrhr-btn-ghost" data-mh-status="CLOSED">Close case</button>' : ''}
        ${admin ? '<button type="button" class="btn btn-danger" id="mh-case-delete">Delete case</button>' : ''}
        <button type="button" class="mgrhr-btn-ghost" id="mh-case-print">Print / PDF</button>
        <button type="button" class="mgrhr-btn-ghost" id="mh-case-save">Save PDF</button>
        <button type="button" class="btn btn-success" id="mh-case-wa">WhatsApp worker</button>
      </div>
    </div>`;
  },

  bindViewActions() {
    this.container.querySelectorAll('.mgrhr-quick [data-mgrhr-view], .mgrhr-form-actions [data-mgrhr-view]').forEach((b) => {
      b.addEventListener('click', () => this.goView(b.dataset.mgrhrView));
    });
    document.getElementById('mh-staff-q')?.addEventListener('input', (e) => {
      this.staffFilter = e.target.value || '';
      this.paint();
    });
    this.container.querySelectorAll('[data-mh-report-emp]').forEach((b) => {
      b.addEventListener('click', () => {
        this._preselectEmp = b.dataset.mhReportEmp;
        this.goView('report');
      });
    });
    this.container.querySelectorAll('[data-mh-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        this.caseTab = b.dataset.mhTab;
        this.paint();
      });
    });
    this.container.querySelectorAll('[data-mh-open]').forEach((b) => {
      b.addEventListener('click', async () => {
        const detail = await this.api(API.mgrHrGetCase(Number(b.dataset.mhOpen), this.actor()), 'Could not load case');
        if (!detail) return;
        this.selectedCase = detail;
        this.caseTab = (this.view === 'responses' || detail.has_response || (detail.responses || []).length) ? 'response' : 'details';
        this.view = 'cases';
        this.paint();
      });
    });
    document.getElementById('mh-back-cases')?.addEventListener('click', () => {
      this.selectedCase = null;
      this.paint();
    });
    document.getElementById('mh-submit')?.addEventListener('click', async () => {
      const btn = document.getElementById('mh-submit');
      this.captureReportDraft();
      const payload = {
        employee_id: document.getElementById('mh-emp')?.value,
        branch_id: document.getElementById('mh-branch')?.value || null,
        incident_date: document.getElementById('mh-date')?.value,
        incident_time: document.getElementById('mh-time')?.value,
        incident_type: document.getElementById('mh-type')?.value,
        severity: document.getElementById('mh-sev')?.value,
        title: document.getElementById('mh-title')?.value,
        description: document.getElementById('mh-desc')?.value,
        what_happened: document.getElementById('mh-what')?.value,
        witnesses: document.getElementById('mh-wit')?.value,
        reported_loss: document.getElementById('mh-loss')?.value,
        recommended_recovery: document.getElementById('mh-recov')?.value,
        recommended_action: document.getElementById('mh-action')?.value,
        additional_notes: document.getElementById('mh-notes')?.value,
        decision_taken: document.getElementById('mh-decision')?.value,
        request_employee_response: !!document.getElementById('mh-ask')?.checked,
        evidence_paths: (this.evidenceFiles || []).map((f) => f.dataUrl || f.path).filter(Boolean)
      };
      if (!payload.employee_id) return this.toast('Select an employee', 'error');
      if (!payload.incident_type) return this.toast('Select an incident type', 'error');
      if (!payload.description?.trim()) return this.toast('Enter a description', 'error');
      if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
      try {
        const created = await this.api(API.mgrHrCreateCase(payload, this.actor()), 'Could not create case');
        if (!created) return;
        this._preselectEmp = '';
        this.reportDraft = null;
        this.evidenceFiles = [];
        this.toast(`Case ${created.case_number} created`, 'success');
        this.selectedCase = created;
        this.view = 'cases';
        await this.refreshAndPaint();
      } finally {
        if (btn && this.view === 'report') { btn.disabled = false; btn.textContent = 'Submit Report'; }
      }
    });
    document.getElementById('mh-attach-file')?.addEventListener('click', async () => {
      try {
        this.captureReportDraft();
        const pick = await API.selectDocument('mgr-hr-evidence');
        if (!pick || pick.success === false || pick.cancelled) return;
        const dataUrl = pick.dataUrl || pick.path;
        if (!dataUrl) return this.toast('Could not read file', 'error');
        const isImage = !!pick.is_image || /^data:image\//i.test(String(dataUrl)) || /\.(jpe?g|png|webp|gif)$/i.test(pick.name || pick.fileName || '');
        await this.addEvidenceFromDataUrl(dataUrl, pick.name || pick.fileName || 'attachment', isImage);
      } catch (err) {
        this.toast(err.message || 'Upload cancelled', 'error');
      }
    });
    document.getElementById('mh-attach-camera')?.addEventListener('click', async () => {
      try {
        this.captureReportDraft();
        const dataUrl = await Utils.captureProofPhoto();
        if (!dataUrl) return this.toast('No photo captured', 'error');
        await this.addEvidenceFromDataUrl(dataUrl, `camera-${Date.now()}.jpg`, true);
      } catch (err) {
        this.toast(err.message || 'Camera unavailable', 'error');
      }
    });
    this.container.querySelectorAll('.mh-attach-rm').forEach((b) => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        this.evidenceFiles = (this.evidenceFiles || []).filter((_, idx) => idx !== i);
        this.refreshAttachListOnly();
      });
    });
    this.bindRecordingActions();
    this.container.querySelectorAll('[data-mh-status]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!this.selectedCase) return;
        const updated = await this.api(
          API.mgrHrUpdateStatus(this.selectedCase.id, b.dataset.mhStatus, '', this.actor()),
          'Could not update status'
        );
        if (updated) { this.selectedCase = updated; this.toast('Status updated', 'success'); this.paint(); }
      });
    });
    document.getElementById('mh-recommend')?.addEventListener('click', async () => {
      const text = prompt('Your recommendation (not final HR decision):');
      if (!text) return;
      const recovery = prompt('Recommended recovery amount (R, 0 if none):', '0');
      const updated = await this.api(API.mgrHrAddRecommendation(this.selectedCase.id, {
        recommendation_text: text,
        recommended_recovery_amount: recovery
      }, this.actor()), 'Could not save recommendation');
      if (updated) { this.selectedCase = updated; this.toast('Recommendation submitted', 'success'); this.paint(); }
    });
    document.getElementById('mh-warn')?.addEventListener('click', async () => {
      if (!confirm('Create a formal warning linked to this case? Employee will see it in Staff Portal.')) return;
      const updated = await this.api(API.mgrHrCreateWarning(this.selectedCase.id, {
        record_type: 'Warning'
      }, this.actor()), 'Could not create warning');
      if (updated) { this.selectedCase = updated; this.toast('Warning created', 'success'); this.paint(); }
    });
    document.getElementById('mh-decide')?.addEventListener('click', () => this.openFinaliseDecisionModal());
    document.getElementById('mh-case-delete')?.addEventListener('click', async () => {
      if (!this.selectedCase) return;
      if (!confirm(`Delete case ${this.selectedCase.case_number} permanently? This cannot be undone.`)) return;
      const r = await this.api(API.mgrHrDeleteCase(this.selectedCase.id, this.actor()), 'Could not delete case');
      if (!r) return;
      this.selectedCase = null;
      this.toast('Case deleted', 'success');
      await this.refreshAndPaint();
    });
    document.getElementById('mh-case-print')?.addEventListener('click', () => this.printOrSaveCase('print'));
    document.getElementById('mh-case-save')?.addEventListener('click', () => this.printOrSaveCase('save'));
    document.getElementById('mh-case-wa')?.addEventListener('click', () => this.whatsappCase());
  },

  openFinaliseDecisionModal() {
    if (!this.selectedCase) return;
    const c = this.selectedCase;
    Utils.showModal(`Finalise decision — ${c.case_number}`, `
      <p class="muted">This records the final Admin/HR decision on the case and notifies the employee.</p>
      <div class="field"><label>Final decision *</label>
        <textarea id="mh-final-decision" rows="3" placeholder="e.g. Written warning issued / No further action…" style="width:100%">${this.esc(c.final_decision || '')}</textarea></div>
      <div class="field"><label>Decision notes</label>
        <textarea id="mh-final-notes" rows="2" placeholder="Optional notes" style="width:100%">${this.esc(c.final_decision_notes || '')}</textarea></div>
      <div class="field"><label>Approved recovery (R) — not auto-deducted from salary</label>
        <input id="mh-final-recovery" type="number" min="0" step="0.01" value="${Number(c.cost?.approved_recovery || c.approved_recovery || 0)}"></div>
      <div class="field"><label><input type="checkbox" id="mh-final-close" checked> Close case after decision</label></div>
    `, '<button class="btn btn-ghost" id="mh-final-cancel">Cancel</button><button class="btn btn-success" id="mh-final-save">Save decision</button>');
    document.getElementById('mh-final-cancel')?.addEventListener('click', () => Utils.hideModal());
    document.getElementById('mh-final-save')?.addEventListener('click', async () => {
      const decision = document.getElementById('mh-final-decision')?.value.trim() || '';
      if (!decision) return this.toast('Enter the final decision', 'error');
      const notes = document.getElementById('mh-final-notes')?.value.trim() || '';
      const approved = document.getElementById('mh-final-recovery')?.value || '0';
      const close = !!document.getElementById('mh-final-close')?.checked;
      const updated = await this.api(API.mgrHrAdminDecide(c.id, {
        final_decision: decision,
        final_decision_notes: notes,
        approved_recovery: approved,
        close
      }, this.actor()), 'Could not finalise decision');
      if (!updated) return;
      Utils.hideModal();
      this.selectedCase = updated;
      this.toast('Decision recorded', 'success');
      await this.refreshAndPaint();
    });
  },

  async printOrSaveCase(mode = 'print') {
    if (!this.selectedCase) return;
    const doc = await this.api(API.mgrHrCaseDocumentHtml(this.selectedCase.id, this.actor()), 'Could not build case PDF');
    const html = doc?.html;
    if (!html) return this.toast('Could not build document', 'error');
    const name = `${this.selectedCase.case_number || 'case'}.pdf`;
    if (mode === 'save') {
      if (typeof Utils.saveHtmlDocument === 'function') await Utils.saveHtmlDocument(html, name);
      else if (typeof Utils.htmlToPdfDownload === 'function') await Utils.htmlToPdfDownload(html, name);
      else {
        const blob = new Blob([html], { type: 'text/html' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name.replace(/\.pdf$/i, '.html');
        a.click();
        this.toast('Saved HTML document — use Print / PDF for a printer copy', 'success');
      }
      return;
    }
    if (Utils.printToA4) await Utils.printToA4(html, name);
    else {
      const w = window.open('', '_blank');
      if (w) { w.document.write(html); w.document.close(); w.print(); }
    }
  },

  async whatsappCase() {
    if (!this.selectedCase) return;
    const c = this.selectedCase;
    let phone = c.employee_phone || '';
    if (!phone) {
      phone = prompt('Employee WhatsApp number (e.g. 0821234567):', '') || '';
    }
    if (!phone) return this.toast('No phone on employee record — add it in Staff & HR, or enter a number', 'error');
    const shop = this.app?.settings?.shop_name || 'Management';
    const last = (c.responses || [])[(c.responses || []).length - 1];
    const msg = [
      `Dear ${c.employee_name || 'colleague'},`,
      '',
      `This is an official case notice from ${shop}.`,
      `Case: ${c.case_number}`,
      `Type: ${c.incident_type || 'HR matter'}`,
      `Date: ${c.incident_date || '—'}`,
      '',
      `Details: ${(c.description || c.what_happened || '').slice(0, 400)}`,
      c.final_decision ? `\nDecision: ${c.final_decision}` : '',
      last?.response_text ? `\nYour recorded response: "${String(last.response_text).slice(0, 200)}"` : '\nPlease open Staff Portal if a response is required.',
      '',
      `Kind regards,\n${shop}`
    ].filter(Boolean).join('\n');
    if (Utils.openWhatsApp) Utils.openWhatsApp(phone, msg);
    else window.open(`https://wa.me/${String(phone).replace(/\D/g, '').replace(/^0/, '27')}?text=${encodeURIComponent(msg)}`, '_blank');
  },

  bindRecordingActions() {
    document.getElementById('mh-back-recs')?.addEventListener('click', () => {
      this.selectedRecording = null;
      this.paint();
    });
    this.container.querySelectorAll('[data-mh-open-rec]').forEach((b) => {
      b.addEventListener('click', async () => {
        const detail = await this.api(API.mgrHrGetRecording(Number(b.dataset.mhOpenRec), this.actor()), 'Could not load recording');
        if (!detail) return;
        this.selectedRecording = detail;
        this.view = 'recording';
        this.paint();
      });
    });
    document.getElementById('mh-rec-start')?.addEventListener('click', () => this.startRecording());
    document.getElementById('mh-rec-stop')?.addEventListener('click', () => this.stopAndSaveRecording());
    document.getElementById('mh-rec-ai')?.addEventListener('click', async () => {
      if (!this.selectedRecording) return;
      const transcript = document.getElementById('mh-rec-transcript')?.value;
      const updated = await this.api(API.mgrHrAnalyzeRecording(this.selectedRecording.id, {
        transcript_original: this.selectedRecording.transcript_original
      }, this.actor()), 'AI analysis failed');
      if (!updated) return;
      this.selectedRecording = updated;
      this.toast('AI analysis ready', 'success');
      this.paint();
    });
    document.getElementById('mh-rec-save-decision')?.addEventListener('click', async () => {
      if (!this.selectedRecording) return;
      const final_decision = document.getElementById('mh-rec-decision')?.value || '';
      const highlightsRaw = document.getElementById('mh-rec-highlights')?.value || '';
      const admin_highlights = highlightsRaw.split(',').map((s) => s.trim()).filter(Boolean).map((text) => ({ text }));
      const updated = await this.api(API.mgrHrUpdateRecording(this.selectedRecording.id, {
        final_decision, admin_highlights
      }, this.actor()), 'Could not save');
      if (!updated) return;
      this.selectedRecording = updated;
      this.toast('Decision saved', 'success');
      this.paint();
    });
    document.getElementById('mh-rec-print')?.addEventListener('click', async () => {
      if (!this.selectedRecording) return;
      const doc = await this.api(API.mgrHrRecordingDocumentHtml(this.selectedRecording.id, this.actor()), 'Could not build document');
      if (!doc?.html) return;
      if (typeof Utils !== 'undefined' && Utils.printToA4) await Utils.printToA4(doc.html, `${this.selectedRecording.recording_number}.pdf`);
      else {
        const w = window.open('', '_blank');
        if (w) { w.document.write(doc.html); w.document.close(); w.print(); }
      }
    });
    document.getElementById('mh-rec-save-pdf')?.addEventListener('click', async () => {
      if (!this.selectedRecording) return;
      const doc = await this.api(API.mgrHrRecordingDocumentHtml(this.selectedRecording.id, this.actor()), 'Could not build document');
      if (!doc?.html) return;
      const name = `${this.selectedRecording.recording_number || 'recording'}.html`;
      const blob = new Blob([doc.html], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      this.toast('Document saved — open and Print to PDF if needed', 'success');
    });
    document.getElementById('mh-rec-wa')?.addEventListener('click', () => {
      if (!this.selectedRecording) return;
      const r = this.selectedRecording;
      const phone = prompt('WhatsApp number to send AI summary:', '') || '';
      if (!phone) return;
      const shop = this.app?.settings?.shop_name || 'Management';
      const points = Array.isArray(r.ai_key_points) ? r.ai_key_points : [];
      const msg = [
        `${shop} — Recording ${r.recording_number}`,
        `Between ${r.party_a || ''} and ${r.party_b || ''}`,
        '',
        'AI summary:',
        r.transcript_summary || '(Run AI first)',
        points.length ? `\nKey points:\n- ${points.join('\n- ')}` : '',
        r.ai_suggested_decision ? `\nSuggested decision: ${r.ai_suggested_decision}` : '',
        r.final_decision ? `\nDecision taken: ${r.final_decision}` : ''
      ].filter(Boolean).join('\n');
      if (Utils.openWhatsApp) Utils.openWhatsApp(phone, msg);
      else window.open(`https://wa.me/${String(phone).replace(/\D/g, '').replace(/^0/, '27')}?text=${encodeURIComponent(msg)}`, '_blank');
    });
    document.getElementById('mh-rec-download')?.addEventListener('click', () => {
      const audio = this.selectedRecording?.audio_data;
      if (!audio) return;
      const a = document.createElement('a');
      a.href = audio;
      a.download = `${this.selectedRecording.recording_number || 'recording'}.webm`;
      a.click();
    });
    document.getElementById('mh-rec-delete')?.addEventListener('click', async () => {
      if (!this.selectedRecording || !confirm('Delete this recording permanently?')) return;
      const r = await this.api(API.mgrHrDeleteRecording(this.selectedRecording.id, this.actor()), 'Delete failed');
      if (!r) return;
      this.selectedRecording = null;
      this.toast('Recording deleted', 'success');
      await this.refreshAndPaint();
    });
  },

  async startRecording() {
    const partyA = document.getElementById('mh-rec-a')?.value?.trim();
    const partyB = document.getElementById('mh-rec-b')?.value?.trim();
    if (!partyA || !partyB) return this.toast('Enter both people in the conversation', 'error');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this._recStream = stream;
      this._recChunks = [];
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
      this._recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      this._recorder.ondataavailable = (e) => { if (e.data?.size) this._recChunks.push(e.data); };
      this._recorder.start(1000);
      this._recStartedAt = Date.now();
      this._liveTranscript = document.getElementById('mh-rec-transcript')?.value || '';
      this._recDraft = {
        party_a: partyA,
        party_b: partyB,
        title: document.getElementById('mh-rec-title')?.value || '',
        conversation_type: document.getElementById('mh-rec-type')?.value || 'conversation'
      };
      this.startSpeechNotes();
      const actions = document.querySelector('.mgrhr-form-actions');
      if (actions) {
        actions.innerHTML = '<button type="button" class="btn btn-danger" id="mh-rec-stop">Stop &amp; save recording</button>';
        document.getElementById('mh-rec-stop')?.addEventListener('click', () => this.stopAndSaveRecording());
      }
      const status = document.getElementById('mh-rec-status');
      if (status) {
        status.classList.remove('idle');
        status.innerHTML = '<span class="mgrhr-rec-dot"></span> Recording… <span id="mh-rec-timer">00:00</span>';
      }
      this._recTimer = setInterval(() => {
        const el = document.getElementById('mh-rec-timer');
        if (!el || !this._recStartedAt) return;
        const secs = Math.floor((Date.now() - this._recStartedAt) / 1000);
        el.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
      }, 500);
    } catch (err) {
      this.toast(err.message || 'Microphone permission required', 'error');
    }
  },

  startSpeechNotes() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try {
      this._speechRec?.stop();
    } catch (_) { /* */ }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let chunk = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        chunk += ev.results[i][0].transcript;
      }
      const base = this._liveTranscript || '';
      const ta = document.getElementById('mh-rec-transcript');
      if (ta) ta.value = `${base} ${chunk}`.trim();
    };
    rec.onerror = () => { /* ignore */ };
    try { rec.start(); this._speechRec = rec; } catch (_) { /* */ }
  },

  async stopAndSaveRecording() {
    const partyA = (document.getElementById('mh-rec-a')?.value || this._recDraft?.party_a || '').trim();
    const partyB = (document.getElementById('mh-rec-b')?.value || this._recDraft?.party_b || '').trim();
    const title = (document.getElementById('mh-rec-title')?.value || this._recDraft?.title || '').trim();
    const conversation_type = document.getElementById('mh-rec-type')?.value || this._recDraft?.conversation_type || 'conversation';
    const transcript = document.getElementById('mh-rec-transcript')?.value?.trim() || '';
    if (!this._recorder) return;

    const duration = this._recStartedAt ? Math.floor((Date.now() - this._recStartedAt) / 1000) : 0;
    clearInterval(this._recTimer);
    this._recTimer = null;
    try { this._speechRec?.stop(); } catch (_) { /* */ }
    this._speechRec = null;

    const blob = await new Promise((resolve) => {
      this._recorder.onstop = () => resolve(new Blob(this._recChunks, { type: this._recorder.mimeType || 'audio/webm' }));
      try { this._recorder.stop(); } catch (_) { resolve(new Blob(this._recChunks, { type: 'audio/webm' })); }
    });
    this._recStream?.getTracks?.().forEach((t) => t.stop());
    this._recorder = null;
    this._recStream = null;
    this._recStartedAt = 0;

    const audio_data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    this.toast('Saving recording…', 'info');
    const created = await this.api(API.mgrHrCreateRecording({
      party_a: partyA,
      party_b: partyB,
      title,
      conversation_type,
      transcript_original: transcript,
      audio_data,
      audio_mime: blob.type || 'audio/webm',
      duration_seconds: duration
    }, this.actor()), 'Could not save recording');
    if (!created) {
      this.paint();
      return;
    }
    this._liveTranscript = '';
    this.toast(`Recording ${created.recording_number} saved — sent to admin`, 'success');
    if (transcript) {
      const analyzed = await this.api(API.mgrHrAnalyzeRecording(created.id, {
        transcript_original: transcript
      }, this.actor()), 'AI analysis failed');
      this.selectedRecording = analyzed || created;
    } else {
      this.selectedRecording = created;
    }
    this.view = 'recording';
    await this.refreshAndPaint();
  },

  close() {
    try { this._recorder?.stop(); } catch (_) { /* */ }
    this._recStream?.getTracks?.().forEach((t) => t.stop());
    clearInterval(this._recTimer);
    if (typeof App !== 'undefined' && App.closeMgrHrPortal) App.closeMgrHrPortal();
    else if (typeof App !== 'undefined') App.showScreen?.('login');
  }
};

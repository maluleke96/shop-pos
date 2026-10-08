/**
 * Admin → Order SLA & Live Control
 * Live order timers, SLA settings, order timeline, performance reports, kiosk health and
 * performance incidents. Every figure comes from the sla:* RPC layer (real orders only);
 * empty periods show INSUFFICIENT DATA instead of zeros.
 */
window.AdminOrderSlaPage = {
  el: null,
  admin: null,
  tab: 'live',
  meta: null,
  branches: [],
  filters: { branch_id: '', from: '', to: '', order_type: '', source: '', station: '' },
  live: null,
  liveFetchedAt: 0,
  _tick: null,
  _poll: null,

  TABS: [
    ['live', 'Live Control'],
    ['report', 'SLA & Performance'],
    ['daily', 'Daily Orders'],
    ['kiosk', 'Kiosks'],
    ['incidents', 'Incidents'],
    ['settings', 'Settings']
  ],
  TYPE_LABELS: { delivery: 'Delivery', takeaway: 'Takeaway', dine_in: 'Seating / dine-in', drive_thru: 'Drive-through', kiosk: 'Kiosk', online: 'Online' },
  STAGE_LABELS: { accept: 'Acceptance', kitchen: 'Preparation', pack: 'Packing', handover: 'Handover', delivery: 'Delivery' },
  STATE_ICON: { on_time: '🟢', warning: '🟡', overdue: '🔴', critical: '⚫', new: '🔵', completed: '✅', cancelled: '✖', failed: '❗' },

  esc(v) {
    return (typeof Utils !== 'undefined' && Utils.escHtml)
      ? Utils.escHtml(v)
      : String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  toast(msg, type) { if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(msg, type || 'info'); },
  R(v) { return v == null || v === '' ? '—' : `R${Number(v).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; },
  n(v) { return v == null || v === '' ? '—' : Number(v).toLocaleString('en-ZA'); },
  min(v) { return v == null ? '—' : `${v} min`; },
  label(s) { return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); },
  dt(v) {
    if (!v) return '—';
    const s = String(v);
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-ZA', { hour12: false });
  },
  clock(sec) {
    const t = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(t / 3600);
    const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
    const s = String(t % 60).padStart(2, '0');
    return h ? `${h}:${m}:${s}` : `${m}:${s}`;
  },

  async api(promise, errMsg) {
    let r;
    try { r = await promise; } catch (e) { this.toast(e?.message || errMsg || 'Request failed', 'error'); return null; }
    if (!r || r.success === false) { this.toast((r && r.error) || errMsg || 'Request failed', 'error'); return null; }
    return r.data !== undefined ? r.data : r;
  },

  ensureCss() {
    if (document.getElementById('sla-css')) return;
    const s = document.createElement('style');
    s.id = 'sla-css';
    s.textContent = `
      .sla-root{padding:14px;color:var(--text,#0f172a)}
      .sla-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px}
      .sla-head h2{margin:0;font-size:1.35rem}
      .sla-tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--border,#e2e8f0);margin-bottom:12px}
      .sla-tab{border:0;background:none;padding:8px 10px;border-radius:8px 8px 0 0;cursor:pointer;font-weight:600;color:var(--muted,#64748b)}
      .sla-tab.active{background:var(--primary,#2563eb);color:#fff}
      .sla-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:12px}
      .sla-card{border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:10px;background:var(--card,#fff)}
      .sla-card b{display:block;font-size:1.4rem}
      .sla-card span{font-size:.8rem;color:var(--muted,#64748b)}
      .sla-table{width:100%;border-collapse:collapse;font-size:.88rem;margin-bottom:14px}
      .sla-table th,.sla-table td{padding:6px 8px;border-bottom:1px solid var(--border,#e2e8f0);text-align:left;vertical-align:top}
      .sla-table th{font-size:.75rem;text-transform:uppercase;color:var(--muted,#64748b)}
      .sla-chip{display:inline-block;padding:2px 8px;border-radius:999px;font-weight:700;font-size:.75rem;white-space:nowrap}
      .sla-on_time{background:#dcfce7;color:#166534}.sla-warning{background:#fef9c3;color:#854d0e}
      .sla-overdue{background:#fee2e2;color:#991b1b}.sla-critical{background:#111827;color:#fff}
      .sla-new{background:#dbeafe;color:#1e40af}.sla-completed,.sla-cancelled{background:#e2e8f0;color:#334155}
      .sla-failed{background:#fee2e2;color:#991b1b}
      .sla-timer{font-family:ui-monospace,Consolas,monospace;font-weight:700}
      .sla-muted{color:var(--muted,#64748b);font-size:.85rem}
      .sla-insufficient{padding:18px;border:1px dashed var(--border,#cbd5e1);border-radius:10px;text-align:center;font-weight:700;color:var(--muted,#64748b)}
      .sla-banner{padding:10px 12px;border-radius:10px;background:#fff7ed;border:1px solid #fed7aa;font-weight:700;margin-bottom:12px}
      .sla-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-bottom:12px}
      .sla-filters label{display:flex;flex-direction:column;font-size:.75rem;color:var(--muted,#64748b);gap:2px}
      .sla-filters input,.sla-filters select,.sla-form input,.sla-form select,.sla-form textarea{padding:6px 8px;border:1px solid var(--border,#cbd5e1);border-radius:8px}
      .sla-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:12px}
      .sla-form label{display:flex;flex-direction:column;font-size:.8rem;gap:3px}
      .sla-btn{padding:4px 9px;border-radius:7px;border:1px solid var(--border,#cbd5e1);background:var(--card,#fff);cursor:pointer;font-size:.8rem}
      .sla-btn.primary{background:var(--primary,#2563eb);color:#fff;border-color:transparent}
      .sla-events{list-style:none;padding:0;margin:0}
      .sla-events li{padding:6px 0;border-bottom:1px solid var(--border,#e2e8f0);font-size:.86rem}
      .sla-h3{margin:16px 0 8px;font-size:1.05rem}
    `;
    document.head.appendChild(s);
  },

  async render(el, adminPage) {
    this.el = el;
    this.admin = adminPage;
    this.ensureCss();
    el.innerHTML = `
      <div class="sla-root">
        <div class="sla-head">
          <h2>⏱️ Order SLA & Live Control</h2>
          <label class="sla-muted">Branch <select id="sla-branch"><option value="">All branches</option></select></label>
        </div>
        <div class="sla-tabs">${this.TABS.map(([id, l]) => `<button class="sla-tab ${id === this.tab ? 'active' : ''}" data-tab="${id}">${l}</button>`).join('')}</div>
        <div id="sla-body"><p class="sla-muted">Loading…</p></div>
      </div>`;
    el.querySelectorAll('.sla-tab').forEach((b) => b.addEventListener('click', () => this.go(b.dataset.tab)));
    const [meta, br] = await Promise.all([this.api(API.slaMeta()), API.getBranches?.().catch(() => null)]);
    if (!meta) {
      this.body().innerHTML = '<div class="sla-insufficient">Order SLA could not load. You may not have permission to view it.</div>';
      return;
    }
    this.meta = meta;
    const brList = Array.isArray(br) ? br : (br?.data || []);
    this.branches = Array.isArray(brList) ? brList : [];
    const sel = el.querySelector('#sla-branch');
    sel.innerHTML = '<option value="">All branches</option>' + this.branches.map((b) => `<option value="${b.id}">${this.esc(b.name)}</option>`).join('');
    sel.value = this.filters.branch_id;
    sel.addEventListener('change', () => { this.filters.branch_id = sel.value; this.renderTab(); });
    this.startTimers();
    await this.renderTab();
  },

  body() { return this.el?.querySelector('#sla-body'); },
  alive() { return !!(this.el && document.body.contains(this.el)); },

  go(tab) {
    this.tab = tab;
    this.el.querySelectorAll('.sla-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    return this.renderTab();
  },

  f(extra) {
    const o = { ...this.filters, ...(extra || {}) };
    for (const k of Object.keys(o)) if (o[k] === '' || o[k] == null) delete o[k];
    return o;
  },

  startTimers() {
    clearInterval(this._tick);
    clearInterval(this._poll);
    this._tick = setInterval(() => {
      if (!this.alive()) { clearInterval(this._tick); clearInterval(this._poll); return; }
      this.tickTimers();
    }, 1000);
    this._poll = setInterval(() => {
      if (!this.alive() || document.hidden || this.tab !== 'live') return;
      this.loadLive(true);
    }, 15000);
  },

  tickTimers() {
    if (!this.liveFetchedAt) return;
    const extra = (Date.now() - this.liveFetchedAt) / 1000;
    this.el.querySelectorAll('[data-sla-elapsed]').forEach((node) => {
      const base = Number(node.dataset.slaElapsed) || 0;
      const target = Number(node.dataset.slaTarget) || 0;
      const running = node.dataset.slaRunning === '1';
      node.textContent = `${this.clock(base + (running ? extra : 0))} / ${this.clock(target * 60)}`;
    });
  },

  chip(state, label) {
    const st = state || 'new';
    return `<span class="sla-chip sla-${this.esc(st)}">${this.STATE_ICON[st] || ''} ${this.esc(label || this.label(st).toUpperCase())}</span>`;
  },

  timerCell(o) {
    if (!o.timer_text) return '—';
    const running = !o.completed_at && !o.paused && o.state !== 'cancelled';
    return `<span class="sla-timer" data-sla-elapsed="${o.elapsed_seconds || 0}" data-sla-target="${o.target_minutes || 0}" data-sla-running="${running ? 1 : 0}">${this.esc(o.timer_text)}</span>${o.paused ? ' <span class="sla-muted">⏸ paused</span>' : ''}`;
  },

  insufficient(msg) { return `<div class="sla-insufficient">INSUFFICIENT DATA${msg ? ` — ${this.esc(msg)}` : ''}</div>`; },

  async renderTab() {
    const body = this.body();
    if (!body) return;
    body.innerHTML = '<p class="sla-muted">Loading…</p>';
    try {
      if (this.tab === 'live') return await this.loadLive(false);
      if (this.tab === 'report') return await this.renderReport(body);
      if (this.tab === 'daily') return await this.renderDaily(body);
      if (this.tab === 'kiosk') return await this.renderKiosk(body);
      if (this.tab === 'incidents') return await this.renderIncidents(body);
      if (this.tab === 'settings') return await this.renderSettings(body);
    } catch (err) {
      body.innerHTML = `<div class="sla-insufficient">${this.esc(err?.message || 'Could not load')}</div>`;
    }
    return null;
  },

  // ─── Live control ─────────────────────────────────────────────────────────

  async loadLive(silent) {
    const data = silent
      ? await API.slaLive(this.f({ from: undefined, to: undefined })).then((r) => (r && r.success !== false ? (r.data !== undefined ? r.data : r) : null)).catch(() => null)
      : await this.api(API.slaLive(this.f({ from: undefined, to: undefined })));
    if (!data || this.tab !== 'live' || !this.alive()) return;
    this.live = data;
    this.liveFetchedAt = Date.now();
    this.renderLive(this.body());
  },

  renderLive(body) {
    const d = this.live || {};
    const c = d.counts || {};
    const orders = d.orders || [];
    const stations = d.stations || [];
    const top = stations[0];
    body.innerHTML = `
      ${d.enabled === false ? '<div class="sla-banner">Order SLA tracking is switched off in Settings.</div>' : ''}
      <div class="sla-cards">
        <div class="sla-card"><b>${this.n(c.active || 0)}</b><span>Active orders</span></div>
        <div class="sla-card"><b>${this.n(c.new || 0)}</b><span>🔵 New</span></div>
        <div class="sla-card"><b>${this.n(c.on_time || 0)}</b><span>🟢 On time</span></div>
        <div class="sla-card"><b>${this.n(c.warning || 0)}</b><span>🟡 Warning</span></div>
        <div class="sla-card"><b>${this.n(c.overdue || 0)}</b><span>🔴 Overdue</span></div>
        <div class="sla-card"><b>${this.n(c.critical || 0)}</b><span>⚫ Critical</span></div>
      </div>
      ${top ? `<div class="sla-banner">Busiest station now: ${this.esc(this.label(top.station).toUpperCase())} — ${top.active} active order(s)</div>` : ''}
      ${stations.length ? `<div class="sla-muted" style="margin-bottom:8px">${stations.map((s) => `${this.esc(this.label(s.station))}: <b>${s.active}</b>`).join(' · ')}</div>` : ''}
      ${orders.length ? `
      <table class="sla-table">
        <thead><tr><th>Order</th><th>Source / type</th><th>Status</th><th>Timer</th><th>Stage</th><th>Responsible</th><th>State</th><th></th></tr></thead>
        <tbody>${orders.map((o) => `
          <tr>
            <td><b>${this.esc(o.order_number || `#${o.id}`)}</b><div class="sla-muted">${this.dt(o.created_at)}</div></td>
            <td>${this.esc(this.label(o.source))}<div class="sla-muted">${this.esc(this.TYPE_LABELS[o.order_type] || o.order_type)}</div></td>
            <td>${this.esc(this.label(o.status))}</td>
            <td>${this.timerCell(o)}</td>
            <td>${o.stage ? `${this.esc(this.STAGE_LABELS[o.stage] || o.stage)}${o.stage_timer_text ? `<div class="sla-muted sla-timer">${this.esc(o.stage_timer_text)}</div>` : ''}` : '—'}${o.station ? `<div class="sla-muted">${this.esc(this.label(o.station))}</div>` : ''}</td>
            <td>${this.esc(o.responsible || o.driver_name || '—')}</td>
            <td>${this.chip(o.state, o.state_label)}${o.needs_reason ? '<div class="sla-muted">reason needed</div>' : ''}${o.delay_reason ? `<div class="sla-muted">${this.esc(this.label(o.delay_reason))}</div>` : ''}</td>
            <td style="white-space:nowrap">
              <button class="sla-btn" data-act="timeline" data-id="${o.id}">Timeline</button>
              <button class="sla-btn" data-act="reason" data-id="${o.id}" data-stage="${o.stage === 'delivery' ? 'delivery' : 'kitchen'}">Delay reason</button>
              <button class="sla-btn" data-act="exception" data-id="${o.id}">Exception</button>
              ${o.paused ? `<button class="sla-btn" data-act="resume" data-id="${o.id}">Resume</button>` : `<button class="sla-btn" data-act="pause" data-id="${o.id}">Pause</button>`}
            </td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="sla-insufficient">No active orders right now.</div>'}
      <p class="sla-muted">Timers tick every second; status refreshes every 15 seconds. Generated ${this.dt(d.generated_at)}.</p>`;
    this.bindOrderActions(body);
  },

  bindOrderActions(root) {
    root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const id = Number(b.dataset.id);
      const act = b.dataset.act;
      if (act === 'timeline') return this.openTimeline(id);
      if (act === 'reason') return this.openDelayReason(id, b.dataset.stage);
      if (act === 'exception') return this.openException(id);
      if (act === 'pause') return this.openPause(id);
      if (act === 'resume') return this.doResume(id);
      return null;
    }));
  },

  afterAction() {
    if (this.tab === 'live') this.loadLive(true);
  },

  openDelayReason(id, stage) {
    const list = stage === 'delivery' ? (this.meta?.delivery_reasons || []) : (this.meta?.kitchen_reasons || []);
    Utils.showModal('Record delay reason', `
      <div class="sla-form" style="grid-template-columns:1fr">
        <label>Stage <select id="sla-r-stage"><option value="kitchen" ${stage !== 'delivery' ? 'selected' : ''}>Kitchen / preparation</option><option value="delivery" ${stage === 'delivery' ? 'selected' : ''}>Delivery</option></select></label>
        <label>Reason <select id="sla-r-reason">${list.map((r) => `<option value="${r}">${this.esc(this.label(r))}</option>`).join('')}</select></label>
        <label>Explanation (required for "Other") <textarea id="sla-r-note" rows="3"></textarea></label>
      </div>`, '<button class="btn btn-primary" id="sla-r-save">Save reason</button>');
    const stageSel = document.getElementById('sla-r-stage');
    stageSel.addEventListener('change', () => {
      const l = stageSel.value === 'delivery' ? (this.meta?.delivery_reasons || []) : (this.meta?.kitchen_reasons || []);
      document.getElementById('sla-r-reason').innerHTML = l.map((r) => `<option value="${r}">${this.esc(this.label(r))}</option>`).join('');
    });
    document.getElementById('sla-r-save').addEventListener('click', async () => {
      const r = await this.api(API.slaDelayReason(id, {
        stage: stageSel.value, reason: document.getElementById('sla-r-reason').value, note: document.getElementById('sla-r-note').value
      }));
      if (!r) return;
      Utils.hideModal();
      this.toast('Delay reason recorded', 'success');
      this.afterAction();
    });
  },

  openException(id) {
    const list = this.meta?.exception_types || [];
    Utils.showModal('Approve SLA exception', `
      <p class="sla-muted">The original SLA stays on record. Only owners/managers (per Settings) can approve.</p>
      <div class="sla-form" style="grid-template-columns:1fr">
        <label>Exception type <select id="sla-x-type">${list.map((r) => `<option value="${r}">${this.esc(this.label(r))}</option>`).join('')}</select></label>
        <label>New SLA target in minutes (optional) <input id="sla-x-target" type="number" min="1" step="1"></label>
        <label>Why is this a legitimate exception? <textarea id="sla-x-note" rows="3"></textarea></label>
      </div>`, '<button class="btn btn-primary" id="sla-x-save">Approve exception</button>');
    document.getElementById('sla-x-save').addEventListener('click', async () => {
      const t = document.getElementById('sla-x-target').value;
      const r = await this.api(API.slaException(id, {
        type: document.getElementById('sla-x-type').value, note: document.getElementById('sla-x-note').value,
        new_target_minutes: t ? Number(t) : null
      }));
      if (!r) return;
      Utils.hideModal();
      this.toast('Exception recorded', 'success');
      this.afterAction();
    });
  },

  openPause(id) {
    Utils.showModal('Pause order timer', `
      <p class="sla-muted">Pauses are recorded with your name, the reason, and start/end times.</p>
      <div class="sla-form" style="grid-template-columns:1fr">
        <label>Reason <textarea id="sla-p-reason" rows="3"></textarea></label>
      </div>`, '<button class="btn btn-primary" id="sla-p-save">Pause timer</button>');
    document.getElementById('sla-p-save').addEventListener('click', async () => {
      const r = await this.api(API.slaPause(id, document.getElementById('sla-p-reason').value));
      if (!r) return;
      Utils.hideModal();
      this.toast('Timer paused', 'success');
      this.afterAction();
    });
  },

  async doResume(id) {
    const r = await this.api(API.slaResume(id));
    if (!r) return;
    this.toast('Timer resumed', 'success');
    this.afterAction();
  },

  async openTimeline(id) {
    const d = await this.api(API.slaTimeline({ id }));
    if (!d) return;
    const o = d.order || {};
    const integ = d.integration || {};
    const yes = (v) => (v ? '✅' : (v === null || v === undefined ? '—' : '❌'));
    const stages = (d.stages || []).filter((s) => s.minutes != null);
    Utils.showModal(`Order ${o.order_number || `#${o.id}`} — timeline`, `
      <div class="sla-cards">
        <div class="sla-card"><span>Timer</span><b class="sla-timer" style="font-size:1.1rem">${this.esc(o.timer_text)}</b></div>
        <div class="sla-card"><span>State</span><div>${this.chip(o.state, o.state_label)}</div></div>
        <div class="sla-card"><span>Source / type</span><b style="font-size:1rem">${this.esc(this.label(o.source))} · ${this.esc(this.TYPE_LABELS[o.order_type] || o.order_type)}</b></div>
        <div class="sla-card"><span>SLA target</span><b style="font-size:1rem">${o.target_minutes} min${o.original_target_minutes != null && Number(o.original_target_minutes) !== Number(o.target_minutes) ? ` (original ${o.original_target_minutes})` : ''}</b></div>
      </div>
      ${stages.length ? `<table class="sla-table"><thead><tr><th>Stage</th><th>Time</th><th>Target</th><th>Over</th></tr></thead><tbody>
        ${stages.map((s) => `<tr><td>${this.esc(this.STAGE_LABELS[s.stage] || s.stage)}</td><td>${s.minutes} min</td><td>${s.target} min</td><td>${s.over > 0 ? `<b style="color:#b91c1c">+${s.over} min</b>` : '—'}</td></tr>`).join('')}
      </tbody></table>` : ''}
      ${o.delay_reason ? `<p><b>Delay reason:</b> ${this.esc(this.label(o.delay_reason))}${o.delay_note ? ` — ${this.esc(o.delay_note)}` : ''} <span class="sla-muted">(${this.esc(o.delay_by_name || '')})</span></p>` : ''}
      ${o.exception_type ? `<p><b>Exception:</b> ${this.esc(this.label(o.exception_type))} — ${this.esc(o.exception_note || '')} <span class="sla-muted">(${this.esc(o.exception_by_name || '')})</span></p>` : ''}
      <h4 class="sla-h3">Events</h4>
      <ul class="sla-events">${(d.events || []).map((e) => `<li><b>${this.dt(e.occurred_at)}</b> · ${this.esc(this.label(e.event_type))}${e.to_status ? ` → ${this.esc(this.label(e.to_status))}` : ''}${e.from_status ? ` <span class="sla-muted">(from ${this.esc(this.label(e.from_status))})</span>` : ''}${e.actor_name ? ` · ${this.esc(e.actor_name)}${e.actor_role ? ` (${this.esc(e.actor_role)})` : ''}` : ''}${e.source_module ? ` <span class="sla-muted">[${this.esc(e.source_module)}]</span>` : ''}${e.note ? `<div class="sla-muted">${this.esc(e.note)}</div>` : ''}</li>`).join('') || '<li class="sla-muted">No events.</li>'}</ul>
      <h4 class="sla-h3">System integration (real records)</h4>
      <p class="sla-muted">Sale ${yes(integ.sale)} · Kitchen ${yes(integ.kitchen)} · Payment ${yes(integ.payment ? integ.payment.recorded : null)} · Stock ${integ.stock ? `${integ.stock.movements} movement(s)` : '—'} · Accounting ${integ.accounting ? yes(integ.accounting.posted) : '—'} · Loyalty ${integ.loyalty ? `${integ.loyalty.transactions ?? '—'} txn` : 'no customer'}</p>
      ${Array.isArray(d.incidents) && d.incidents.length ? `<h4 class="sla-h3">Performance incidents (internal)</h4>
        <ul class="sla-events">${d.incidents.map((i) => `<li>#${i.id} · ${this.esc(i.employee_name || 'Unassigned')} · ${this.esc(this.label(i.stage))} · ${this.esc(i.status)}${i.level ? ` · Level ${i.level}` : ''}</li>`).join('')}</ul>` : ''}
    `, '', { wide: true });
  },

  // ─── SLA & performance report ─────────────────────────────────────────────

  filterBar(extra = '') {
    const f = this.filters;
    const types = this.meta?.order_types || [];
    return `<div class="sla-filters">
      <label>From <input type="date" id="sla-f-from" value="${this.esc(f.from)}"></label>
      <label>To <input type="date" id="sla-f-to" value="${this.esc(f.to)}"></label>
      <label>Order type <select id="sla-f-type"><option value="">All</option>${types.map((t) => `<option value="${t}" ${f.order_type === t ? 'selected' : ''}>${this.esc(this.TYPE_LABELS[t] || t)}</option>`).join('')}</select></label>
      <label>Channel <select id="sla-f-source"><option value="">All</option>${['pos', 'online', 'kiosk', 'drive_thru', 'phone'].map((t) => `<option value="${t}" ${f.source === t ? 'selected' : ''}>${this.esc(this.label(t))}</option>`).join('')}</select></label>
      <label>Station <input id="sla-f-station" value="${this.esc(f.station)}" placeholder="e.g. kitchen" size="10"></label>
      ${extra}
      <button class="sla-btn primary" id="sla-f-go">Apply</button>
    </div>`;
  },

  bindFilters(root) {
    root.querySelector('#sla-f-go')?.addEventListener('click', () => {
      this.filters.from = root.querySelector('#sla-f-from').value;
      this.filters.to = root.querySelector('#sla-f-to').value;
      this.filters.order_type = root.querySelector('#sla-f-type').value;
      this.filters.source = root.querySelector('#sla-f-source').value;
      this.filters.station = root.querySelector('#sla-f-station').value.trim();
      this.renderTab();
    });
  },

  groupTable(title, rows, keyLabel) {
    if (!rows || !rows.length) return '';
    return `<h4 class="sla-h3">${this.esc(title)}</h4>
      <table class="sla-table"><thead><tr><th>${this.esc(keyLabel)}</th><th>Orders</th><th>On time</th><th>Late</th><th>Critical</th><th>Compliance</th><th>Avg completion</th><th>Avg prep</th><th>Avg delivery</th><th>Avg delay</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${this.esc(this.TYPE_LABELS[r.key] || this.label(r.key))}</td><td>${r.total_orders}</td><td>${r.on_time}</td><td>${r.late}</td><td>${r.critical}</td><td>${r.compliance_pct != null ? `${r.compliance_pct}%` : '—'}</td><td>${this.min(r.avg_completion_min)}</td><td>${this.min(r.avg_preparation_min)}</td><td>${this.min(r.avg_delivery_min)}</td><td>${this.min(r.avg_delay_min)}</td></tr>`).join('')}</tbody></table>`;
  },

  summaryCards(s) {
    return `<div class="sla-cards">
      <div class="sla-card"><b>${this.n(s.total_orders)}</b><span>Orders measured</span></div>
      <div class="sla-card"><b>${s.compliance_pct != null ? `${s.compliance_pct}%` : '—'}</b><span>SLA compliance</span></div>
      <div class="sla-card"><b>${this.n(s.on_time)}</b><span>On time</span></div>
      <div class="sla-card"><b>${this.n(s.late)}</b><span>Late</span></div>
      <div class="sla-card"><b>${this.n(s.critical)}</b><span>Critical</span></div>
      <div class="sla-card"><b>${this.n(s.exceptions)}</b><span>Approved exceptions</span></div>
      <div class="sla-card"><b>${this.min(s.avg_acceptance_min)}</b><span>Avg acceptance</span></div>
      <div class="sla-card"><b>${this.min(s.avg_preparation_min)}</b><span>Avg preparation</span></div>
      <div class="sla-card"><b>${this.min(s.avg_handover_min)}</b><span>Avg handover</span></div>
      <div class="sla-card"><b>${this.min(s.avg_delivery_min)}</b><span>Avg delivery</span></div>
      <div class="sla-card"><b>${this.min(s.avg_completion_min)}</b><span>Avg completion</span></div>
      <div class="sla-card"><b>${this.min(s.avg_delay_min)}</b><span>Avg delay (late orders)</span></div>
      <div class="sla-card"><b>${this.n(s.missing_reasons)}</b><span>Late without reason</span></div>
    </div>`;
  },

  async renderReport(body) {
    const d = await this.api(API.slaReport(this.f()));
    if (!d) { body.innerHTML = this.insufficient('could not load report'); return; }
    const s = d.summary || {};
    body.innerHTML = `${this.filterBar()}
      <p class="sla-muted">Period ${this.esc(d.from)} → ${this.esc(d.to)} · completed, tracked orders only</p>
      ${s.insufficient_data ? this.insufficient('no completed orders with timers in this period') : `
        ${s.main_bottleneck ? `<div class="sla-banner">MAIN BOTTLENECK: ${this.esc((this.STAGE_LABELS[s.main_bottleneck] || s.main_bottleneck).toUpperCase())} — ${s.stage_delay_minutes[s.main_bottleneck]} min over target across late orders</div>` : ''}
        ${this.summaryCards(s)}
        ${s.delay_reasons?.length ? `<h4 class="sla-h3">Delay reasons</h4><p>${s.delay_reasons.map((r) => `${this.esc(this.label(r.reason))}: <b>${r.count}</b>`).join(' · ')}</p>` : ''}
        ${this.groupTable('By order type', d.by_type, 'Type')}
        ${this.groupTable('By channel', d.by_source, 'Channel')}
        ${this.groupTable('By branch', d.by_branch, 'Branch')}
        ${this.groupTable('By station', d.by_station, 'Station')}
        ${this.groupTable('By employee', d.by_employee, 'Employee')}
        ${this.groupTable('By driver', d.by_driver, 'Driver')}
        ${d.late_orders?.length ? `<h4 class="sla-h3">Late orders</h4>
          <table class="sla-table"><thead><tr><th>Order</th><th>Type</th><th>Total / target</th><th>Delay</th><th>Over by stage</th><th>Reason</th><th></th></tr></thead><tbody>
          ${d.late_orders.map((o) => `<tr><td>${this.esc(o.order_number || `#${o.id}`)}<div class="sla-muted">${this.dt(o.created_at)}</div></td><td>${this.esc(this.TYPE_LABELS[o.order_type] || o.order_type)}</td><td>${o.total_minutes} / ${o.target_minutes} min</td><td>${this.chip(o.final_status)} +${o.delay_minutes} min</td><td>${(o.stage_over || []).map((x) => `${this.esc(this.STAGE_LABELS[x.stage] || x.stage)} +${x.over}`).join(', ') || '—'}</td><td>${o.exception_type ? `Exception: ${this.esc(this.label(o.exception_type))}` : this.esc(this.label(o.delay_reason) || '—')}</td><td><button class="sla-btn" data-act="timeline" data-id="${o.id}">Timeline</button></td></tr>`).join('')}
          </tbody></table>` : ''}
      `}`;
    this.bindFilters(body);
    this.bindOrderActions(body);
  },

  // ─── Daily order report ───────────────────────────────────────────────────

  async renderDaily(body) {
    const d = await this.api(API.slaDailyReport(this.f()));
    if (!d) { body.innerHTML = this.insufficient('could not load report'); return; }
    const ch = Object.entries(d.channels || {}).filter(([, v]) => v.orders > 0);
    const ty = Object.entries(d.types || {}).filter(([, v]) => v.orders > 0);
    const s = d.sla || {};
    body.innerHTML = `${this.filterBar()}
      <p class="sla-muted">Period ${this.esc(d.from)} → ${this.esc(d.to)} · completed sales</p>
      ${d.insufficient_data ? this.insufficient('no completed sales in this period') : `
        <div class="sla-cards">
          <div class="sla-card"><b>${this.n(d.total_orders)}</b><span>Total orders</span></div>
          <div class="sla-card"><b>${this.R(d.total_sales)}</b><span>Total sales</span></div>
          <div class="sla-card"><b>${s.compliance_pct != null ? `${s.compliance_pct}%` : '—'}</b><span>SLA compliance</span></div>
          <div class="sla-card"><b>${this.n(s.late)}</b><span>Late orders</span></div>
          <div class="sla-card"><b>${this.min(s.avg_preparation_min)}</b><span>Avg prep time</span></div>
          <div class="sla-card"><b>${this.min(s.avg_delivery_min)}</b><span>Avg delivery time</span></div>
        </div>
        <h4 class="sla-h3">By channel</h4>
        <table class="sla-table"><thead><tr><th>Channel</th><th>Orders</th><th>Sales</th></tr></thead><tbody>
          ${ch.map(([k, v]) => `<tr><td>${this.esc(this.label(k))}</td><td>${v.orders}</td><td>${this.R(v.sales)}</td></tr>`).join('')}
        </tbody></table>
        <h4 class="sla-h3">By order type</h4>
        <table class="sla-table"><thead><tr><th>Type</th><th>Orders</th><th>Sales</th></tr></thead><tbody>
          ${ty.map(([k, v]) => `<tr><td>${this.esc(this.TYPE_LABELS[k] || k)}</td><td>${v.orders}</td><td>${this.R(v.sales)}</td></tr>`).join('')}
        </tbody></table>
        ${s.insufficient_data ? '<p class="sla-muted">SLA timing: INSUFFICIENT DATA for this period (timers start recording from this release).</p>' : ''}
      `}`;
    this.bindFilters(body);
  },

  // ─── Kiosks ───────────────────────────────────────────────────────────────

  async renderKiosk(body) {
    const [health, rep, errs] = await Promise.all([
      this.api(API.slaKioskHealth({})),
      this.api(API.slaKioskReport(this.f())),
      this.api(API.slaKioskErrors({ limit: 50 }))
    ]);
    const devices = health?.devices || [];
    const statusChip = (st) => {
      const map = { online: ['on_time', '🟢 ONLINE'], unstable: ['warning', '🟡 UNSTABLE'], offline: ['overdue', '🔴 OFFLINE'] };
      const [cls, txt] = map[st] || ['new', this.label(st || 'unknown').toUpperCase()];
      return `<span class="sla-chip sla-${cls}">${txt}</span>`;
    };
    const kiosks = rep?.kiosks || [];
    body.innerHTML = `
      <h4 class="sla-h3">Kiosk health monitor</h4>
      ${devices.length ? `<table class="sla-table"><thead><tr><th>Kiosk</th><th>Status</th><th>Latency</th><th>Last heartbeat</th><th>Version</th><th>Orders today</th><th>Failed txns</th><th>Pending sync</th><th>Errors today</th></tr></thead><tbody>
        ${devices.map((k) => `<tr><td><b>${this.esc(k.name || k.device_code)}</b><div class="sla-muted">${this.esc(k.location || '')}</div></td><td>${statusChip(k.status)}${k.error_state ? `<div class="sla-muted">${this.esc(k.error_state)}</div>` : ''}</td><td>${k.latency_ms != null ? `${k.latency_ms} ms` : '—'}</td><td>${this.dt(k.last_heartbeat)}${k.seconds_since_heartbeat != null ? `<div class="sla-muted">${this.clock(k.seconds_since_heartbeat)} ago</div>` : ''}</td><td>${this.esc(k.app_version || '—')}</td><td>${k.orders_today}</td><td>${k.failed_transactions}</td><td>${k.pending_sync || 0}</td><td>${k.errors_today}${k.error_breakdown?.length ? `<div class="sla-muted">${k.error_breakdown.map((e) => `${this.esc(this.label(e.type))}: ${e.count}`).join(', ')}</div>` : ''}</td></tr>`).join('')}
      </tbody></table>` : this.insufficient('no paired kiosks')}
      <h4 class="sla-h3">Kiosk report</h4>
      ${this.filterBar()}
      ${!rep || rep.insufficient_data ? this.insufficient('no kiosk orders in this period') : `
        <table class="sla-table"><thead><tr><th>Kiosk</th><th>Orders</th><th>Revenue</th><th>Avg order</th><th>Avg transaction</th><th>Cancelled</th><th>Failed</th><th>Payment failures</th><th>Sync failures</th><th>Synced after offline</th><th>Downtime</th><th>SLA compliance</th></tr></thead><tbody>
          ${kiosks.map((k) => `<tr><td>${this.esc(k.name)}</td><td>${k.orders}</td><td>${this.R(k.revenue)}</td><td>${this.R(k.avg_order_value)}</td><td>${k.avg_transaction_seconds != null ? `${k.avg_transaction_seconds}s` : '—'}</td><td>${k.cancelled_orders}</td><td>${k.failed_orders}</td><td>${k.payment_failures}</td><td>${k.sync_failures}</td><td>${k.offline_synced_orders}</td><td>${k.downtime_minutes != null ? `${k.downtime_minutes} min` : '—'}</td><td>${k.sla_compliance_pct != null ? `${k.sla_compliance_pct}%` : '—'}</td></tr>`).join('')}
        </tbody></table>`}
      <h4 class="sla-h3">Recent kiosk errors</h4>
      ${errs && errs.length ? `<table class="sla-table"><thead><tr><th>When</th><th>Kiosk</th><th>Type</th><th>Message</th><th>Version</th></tr></thead><tbody>
        ${errs.map((e) => `<tr><td>${this.dt(e.created_at)}</td><td>${this.esc(e.device_name || e.device_id || '—')}</td><td>${this.esc(this.label(e.error_type))}</td><td>${this.esc(e.message || '')}</td><td>${this.esc(e.app_version || '—')}</td></tr>`).join('')}
      </tbody></table>` : '<p class="sla-muted">No kiosk errors recorded.</p>'}`;
    this.bindFilters(body);
  },

  // ─── Incidents ────────────────────────────────────────────────────────────

  async renderIncidents(body) {
    const st = this.incStatus || '';
    const rows = await this.api(API.slaIncidents(this.f({ status: st, from: undefined, to: undefined, order_type: undefined, source: undefined, station: undefined })));
    const list = rows || [];
    body.innerHTML = `
      <p class="sla-muted">Internal performance records. Never shown to customers. Adjustments need manager approval and then a different person's payroll approval; payroll itself is never changed here.</p>
      <div class="sla-filters"><label>Status <select id="sla-inc-st">${['', 'open', 'explained', 'actioned', 'closed', 'closed_exception'].map((s) => `<option value="${s}" ${s === st ? 'selected' : ''}>${s ? this.label(s) : 'All'}</option>`).join('')}</select></label></div>
      ${list.length ? `<table class="sla-table"><thead><tr><th>#</th><th>Employee</th><th>Order</th><th>Stage</th><th>Delay</th><th>Level</th><th>Status</th><th>Adjustment</th><th></th></tr></thead><tbody>
        ${list.map((i) => `<tr><td>${i.id}</td><td>${this.esc(i.employee_name || 'Unassigned')}</td><td>${this.esc(i.order_number || '')}<div class="sla-muted">${this.dt(i.created_at)}</div></td><td>${this.esc(this.STAGE_LABELS[i.stage] || i.stage || '—')}</td><td>${i.delay_minutes != null ? `+${i.delay_minutes} min` : '—'}${i.delay_reason ? `<div class="sla-muted">${this.esc(this.label(i.delay_reason))}</div>` : ''}</td><td>${i.level ? `${i.level} · ${this.esc(i.level_label)}` : '—'}</td><td>${this.esc(this.label(i.status))}</td><td>${i.adjustment_status && i.adjustment_status !== 'none' ? `${this.esc(this.label(i.adjustment_status))} ${this.R(i.adjustment_amount)}` : '—'}</td><td style="white-space:nowrap"><button class="sla-btn" data-inc="${i.id}">Review</button><button class="sla-btn" data-act="timeline" data-id="${i.order_sla_id}">Timeline</button></td></tr>`).join('')}
      </tbody></table>` : this.insufficient('no performance incidents')}`;
    body.querySelector('#sla-inc-st').addEventListener('change', (e) => { this.incStatus = e.target.value; this.renderTab(); });
    body.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', () => this.openIncident(list.find((x) => Number(x.id) === Number(b.dataset.inc)))));
    this.bindOrderActions(body);
  },

  openIncident(i) {
    if (!i) return;
    const levels = this.meta?.incident_levels || {};
    const adj = i.adjustment_status && i.adjustment_status !== 'none' ? i.adjustment_status : null;
    Utils.showModal(`Performance incident #${i.id}`, `
      <p><b>${this.esc(i.employee_name || 'Unassigned')}</b> · order ${this.esc(i.order_number || '')} · ${this.esc(this.STAGE_LABELS[i.stage] || i.stage || '')}${i.delay_minutes != null ? ` · +${i.delay_minutes} min` : ''}</p>
      <p class="sla-muted">${this.esc(this.label(i.incident_type || 'sla_breach'))}${i.target_minutes ? ` · order took ${i.total_minutes} of ${i.target_minutes} min` : ''}</p>
      <div class="sla-form" style="grid-template-columns:1fr 1fr">
        <label style="grid-column:1/-1">Employee explanation <textarea id="sla-i-emp" rows="2">${this.esc(i.employee_explanation || '')}</textarea></label>
        <label style="grid-column:1/-1">Manager explanation <textarea id="sla-i-mgr" rows="2">${this.esc(i.manager_explanation || '')}</textarea></label>
        <label>Level <select id="sla-i-level"><option value="">— none —</option>${Object.entries(levels).map(([k, v]) => `<option value="${k}" ${Number(i.level) === Number(k) ? 'selected' : ''}>${k} · ${this.esc(v)}</option>`).join('')}</select></label>
        <label>Status <select id="sla-i-status">${['open', 'explained', 'actioned', 'closed'].map((s) => `<option value="${s}" ${i.status === s ? 'selected' : ''}>${this.label(s)}</option>`).join('')}</select></label>
        <label style="grid-column:1/-1">Action taken <textarea id="sla-i-action" rows="2">${this.esc(i.action_taken || '')}</textarea></label>
        <label>Follow-up date <input type="date" id="sla-i-follow" value="${this.esc(i.follow_up_date || '')}"></label>
      </div>
      <h4 class="sla-h3">Payout adjustment (approval workflow)</h4>
      <p class="sla-muted">Status: ${adj ? this.esc(this.label(adj)) : 'none'}${i.adjustment_amount ? ` · ${this.R(i.adjustment_amount)} · ${this.esc(i.adjustment_reason || '')}` : ''}${i.manager_approved_by ? ` · manager: ${this.esc(i.manager_approved_by)}` : ''}${i.payroll_approved_by ? ` · payroll: ${this.esc(i.payroll_approved_by)}` : ''}</p>
      ${!adj || adj === 'rejected' ? `<div class="sla-form" style="grid-template-columns:1fr 2fr">
        <label>Amount <input type="number" id="sla-a-amt" min="0" step="0.01"></label>
        <label>Reason <input id="sla-a-reason"></label>
      </div><button class="sla-btn" id="sla-a-request">Request adjustment</button>` : ''}
      ${adj === 'requested' ? '<button class="sla-btn" id="sla-a-mgr">Manager approve</button> <button class="sla-btn" id="sla-a-reject">Reject</button>' : ''}
      ${adj === 'manager_approved' ? '<button class="sla-btn" id="sla-a-payroll">Payroll approve (owner)</button> <button class="sla-btn" id="sla-a-reject">Reject</button>' : ''}
    `, '<button class="btn btn-primary" id="sla-i-save">Save incident</button>', { wide: true });
    const done = (msg) => { Utils.hideModal(); this.toast(msg, 'success'); this.renderTab(); };
    document.getElementById('sla-i-save').addEventListener('click', async () => {
      const lv = document.getElementById('sla-i-level').value;
      const r = await this.api(API.slaUpdateIncident(i.id, {
        employee_explanation: document.getElementById('sla-i-emp').value,
        manager_explanation: document.getElementById('sla-i-mgr').value,
        level: lv ? Number(lv) : undefined,
        status: document.getElementById('sla-i-status').value,
        action_taken: document.getElementById('sla-i-action').value,
        follow_up_date: document.getElementById('sla-i-follow').value
      }));
      if (r) done('Incident saved');
    });
    document.getElementById('sla-a-request')?.addEventListener('click', async () => {
      const r = await this.api(API.slaAdjustment(i.id, 'request', { amount: Number(document.getElementById('sla-a-amt').value), reason: document.getElementById('sla-a-reason').value }));
      if (r) done('Adjustment requested');
    });
    document.getElementById('sla-a-mgr')?.addEventListener('click', async () => { if (await this.api(API.slaAdjustment(i.id, 'manager_approve', {}))) done('Approved by manager'); });
    document.getElementById('sla-a-payroll')?.addEventListener('click', async () => { if (await this.api(API.slaAdjustment(i.id, 'payroll_approve', {}))) done('Approved for payroll'); });
    document.getElementById('sla-a-reject')?.addEventListener('click', async () => {
      const reason = window.prompt('Reason for rejecting this adjustment?') || '';
      if (await this.api(API.slaAdjustment(i.id, 'reject', { reason }))) done('Adjustment rejected');
    });
  },

  // ─── Settings ─────────────────────────────────────────────────────────────

  async renderSettings(body) {
    const s = await this.api(API.slaSettings());
    if (!s) { body.innerHTML = this.insufficient('could not load settings'); return; }
    const num = (id, v, step = 1) => `<input type="number" min="1" step="${step}" id="${id}" value="${this.esc(v)}">`;
    const roleBoxes = (name, list) => ['owner', 'manager', 'assistant_manager', 'supervisor'].map((r) => `<label style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" name="${name}" value="${r}" ${list.includes(r) ? 'checked' : ''} ${r === 'owner' ? 'disabled' : ''}> ${this.label(r)}</label>`).join('');
    body.innerHTML = `
      <div class="sla-form">
        <label style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" id="sla-s-enabled" ${s.enabled ? 'checked' : ''}> SLA tracking enabled</label>
        <label style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" id="sla-s-escalate" ${s.escalate ? 'checked' : ''}> Escalate via Communication Center</label>
        <label style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" id="sla-s-incidents" ${s.create_incidents ? 'checked' : ''}> Open performance incidents for late orders</label>
      </div>
      <h4 class="sla-h3">Total SLA per order type (minutes)</h4>
      <div class="sla-form">${Object.keys(this.TYPE_LABELS).map((t) => `<label>${this.TYPE_LABELS[t]} ${num(`sla-t-${t}`, s.targets[t])}</label>`).join('')}</div>
      <h4 class="sla-h3">Stage SLA (minutes)</h4>
      <div class="sla-form">${Object.keys(this.STAGE_LABELS).map((st) => `<label>${this.STAGE_LABELS[st]} ${num(`sla-st-${st}`, s.stages[st])}</label>`).join('')}</div>
      <h4 class="sla-h3">Alert thresholds (% of SLA used)</h4>
      <div class="sla-form">
        <label>Warning ${num('sla-th-warning', s.thresholds.warning)}</label>
        <label>Supervisor alert ${num('sla-th-supervisor', s.thresholds.supervisor)}</label>
        <label>SLA breach ${num('sla-th-breach', s.thresholds.breach)}</label>
        <label>Manager escalation ${num('sla-th-escalation', s.thresholds.escalation)}</label>
        <label>Critical ${num('sla-th-critical', s.thresholds.critical)}</label>
      </div>
      <h4 class="sla-h3">Other</h4>
      <div class="sla-form">
        <label>Counter sales without kitchen auto-complete after (min) ${num('sla-o-counter', s.counter_sale_complete_minutes)}</label>
        <label>Ignore timers for offline sales synced after (hours) ${num('sla-o-latesync', s.late_sync_hours)}</label>
        <label>Kiosk offline alert after (min) ${num('sla-o-kiosk', s.kiosk_offline_minutes)}</label>
      </div>
      <h4 class="sla-h3">Who may pause timers</h4>
      <div class="sla-form">${roleBoxes('sla-pause-role', s.pause_roles || [])}</div>
      <h4 class="sla-h3">Who may approve SLA exceptions</h4>
      <div class="sla-form">${roleBoxes('sla-exc-role', s.exception_roles || [])}</div>
      <button class="sla-btn primary" id="sla-s-save">Save settings</button>`;
    body.querySelector('#sla-s-save').addEventListener('click', async () => {
      const v = (id) => Number(body.querySelector(`#${id}`).value);
      const roles = (name) => ['owner', ...[...body.querySelectorAll(`input[name="${name}"]:checked`)].map((x) => x.value).filter((r) => r !== 'owner')];
      const payload = {
        enabled: body.querySelector('#sla-s-enabled').checked,
        escalate: body.querySelector('#sla-s-escalate').checked,
        create_incidents: body.querySelector('#sla-s-incidents').checked,
        targets: Object.fromEntries(Object.keys(this.TYPE_LABELS).map((t) => [t, v(`sla-t-${t}`)])),
        stages: Object.fromEntries(Object.keys(this.STAGE_LABELS).map((st) => [st, v(`sla-st-${st}`)])),
        thresholds: { warning: v('sla-th-warning'), supervisor: v('sla-th-supervisor'), breach: v('sla-th-breach'), escalation: v('sla-th-escalation'), critical: v('sla-th-critical') },
        counter_sale_complete_minutes: v('sla-o-counter'),
        late_sync_hours: v('sla-o-latesync'),
        kiosk_offline_minutes: v('sla-o-kiosk'),
        pause_roles: roles('sla-pause-role'),
        exception_roles: roles('sla-exc-role')
      };
      const r = await this.api(API.slaSaveSettings(payload));
      if (r) { this.toast('Order SLA settings saved', 'success'); this.renderTab(); }
    });
  }
};

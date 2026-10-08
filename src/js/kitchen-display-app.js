const KDS = {
  orders: [],
  knownIds: new Set(),
  selectedIds: new Set(),
  sessionUser: null,
  overdueAlerted: new Set(),
  lastOverdueSoundAt: 0,
  kdsAlert: { enabled: true, volume: 0.85, repeat_sec: 60 },
  deviceMode: false,
  audio: null,

  async init() {
    document.getElementById('mobile-loading')?.remove();
    if (window.OpsDisplayClient) OpsDisplayClient.deviceType = 'kds';
    const hasDevice = window.OpsDisplayClient?.getToken?.();
    if (!hasDevice && !window.posAPI) {
      const paired = await this.ensureDevicePairing();
      if (!paired && window.DisplayAuth) {
        try { await DisplayAuth.requireSession('Kitchen Display'); } catch (_) { /* */ }
      }
    }
    this.deviceMode = !!OpsDisplayClient?.getToken?.();
    if (window.DisplayAuth) {
      try {
        this.sessionUser = await DisplayAuth.requireSession('Kitchen Display');
      } catch (_) { /* ignore */ }
    }
    if (!this.sessionUser) this.sessionUser = window.App?.user || null;
    this.renderSessionUser();
    if (this.deviceMode) {
      try {
        const cfg = await OpsDisplayClient.loadConfig();
        if (cfg?.kds_alert) Object.assign(this.kdsAlert, cfg.kds_alert);
      } catch (_) { /* */ }
      OpsDisplayClient.heartbeat({ app_version: 'kds-web 2026.10.7' }).catch(() => {});
      setInterval(() => OpsDisplayClient.heartbeat({ app_version: 'kds-web 2026.10.7' }).catch(() => {}), 30000);
    }
    this.tickClock();
    this.ensureSlaCss();
    setInterval(() => { this.tickClock(); this.tickSla(); }, 1000);
    try {
      const bc = new BroadcastChannel('shoppos-kitchen');
      bc.onmessage = (e) => { if (e.data?.type === 'refresh') this.load(); };
    } catch (_) {}
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'kitchen:refresh') this.load();
    });
    await this.load();
    setInterval(() => this.load(), 5000);
    if (window.posAPI?.onKitchenRefresh) {
      window.posAPI.onKitchenRefresh(() => this.load());
    }
  },

  tickClock() {
    const el = document.getElementById('kds-clock');
    if (el) el.textContent = new Date().toLocaleString('en-ZA');
  },

  renderSessionUser() {
    const el = document.getElementById('kds-user');
    if (!el) return;
    const u = this.sessionUser || window.App?.user;
    el.textContent = u ? `Signed in: ${u.full_name || u.username} (${u.role || 'staff'})` : 'Device mode — no staff sign-in';
  },

  renderToolbar() {
    const bar = document.getElementById('kds-toolbar');
    if (!bar) return;
    if (!this.orders.length) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
    bar.classList.remove('hidden');
    const n = this.selectedIds.size;
    bar.innerHTML = `
      <label style="font-size:13px;color:#94a3b8"><input type="checkbox" id="kds-sel-all" ${n === this.orders.length ? 'checked' : ''}> Select all (${this.orders.length})</label>
      <button type="button" class="btn btn-primary" id="kds-bulk-start" ${n ? '' : 'disabled'}>Start cooking (${n || 0})</button>
      <button type="button" class="btn" id="kds-bulk-clear" ${n ? '' : 'disabled'}>Clear selected (${n || 0})</button>
      <button type="button" class="btn" id="kds-bulk-clear-all">Clear all…</button>`;
    bar.querySelector('#kds-sel-all')?.addEventListener('change', (e) => {
      if (e.target.checked) this.orders.forEach((o) => this.selectedIds.add(o.id));
      else this.selectedIds.clear();
      this.render();
    });
    bar.querySelector('#kds-bulk-start')?.addEventListener('click', () => this.bulkAction('preparing'));
    bar.querySelector('#kds-bulk-clear')?.addEventListener('click', () => this.bulkAction('completed', true));
    bar.querySelector('#kds-bulk-clear-all')?.addEventListener('click', () => {
      this.orders.forEach((o) => this.selectedIds.add(o.id));
      this.bulkAction('completed', true);
    });
  },

  askClearReason(title) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'kds-reason-overlay';
      const label = (v) => String(v).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      wrap.innerHTML = `<div class="kds-reason-box">
        <h3>${title || 'Clear orders'}</h3>
        <div>Reason (optional — shown in Admin audit)</div>
        <div class="kds-reason-grid">${this.KITCHEN_REASONS.map((r) => `<button type="button" data-r="${r}">${label(r)}</button>`).join('')}</div>
        <textarea rows="2" placeholder="Write a reason or skip"></textarea>
        <div class="kds-reason-actions"><button type="button" data-skip>Skip</button><button type="button" data-ok style="background:#2563eb;color:#fff;border:0;padding:8px 14px;border-radius:8px">Apply</button></div>
      </div>`;
      let picked = null;
      wrap.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
        picked = b.dataset.r;
        wrap.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('sel', x === b));
      }));
      const close = (val) => { wrap.remove(); resolve(val); };
      wrap.querySelector('[data-skip]').addEventListener('click', () => close({ skipped: true }));
      wrap.querySelector('[data-ok]').addEventListener('click', () => {
        const note = wrap.querySelector('textarea').value.trim();
        close({ reason: picked || 'other', note, skipped: !picked && !note });
      });
      document.body.appendChild(wrap);
    });
  },

  async bulkAction(status, askReason) {
    const ids = [...this.selectedIds];
    if (!ids.length) return;
    const actor = this.sessionUser || window.App?.user || null;
    let meta = { action: status === 'completed' ? 'kds_clear' : 'kds_bulk_start' };
    if (askReason) {
      const pick = await this.askClearReason(status === 'completed' ? 'Clear selected orders' : 'Bulk update');
      if (!pick) return;
      meta = { ...meta, ...pick };
    }
    let r;
    try {
      if (this.deviceMode && OpsDisplayClient?.getToken?.()) {
        r = await OpsDisplayClient.call('opsDisplay:bulkKitchenStatus', [
          OpsDisplayClient.getToken(), ids, status, meta || {}
        ]);
      } else {
        if (!actor?.id) {
          alert('Sign in before clearing or updating orders.');
          return;
        }
        r = await API.bulkUpdateKitchenStatus(ids, status, meta, actor);
      }
    } catch (ex) {
      alert(ex.message || 'Could not update orders — sign in and try again.');
      return;
    }
    if (r && r.success === false) {
      alert(r.error || 'Kitchen update failed');
    }
    this.selectedIds.clear();
    await this.load();
  },

  SLA_ICON: { on_time: '🟢', warning: '🟡', overdue: '🔴', critical: '⚫', new: '🔵' },
  KITCHEN_REASONS: ['stock_shortage', 'equipment_problem', 'staff_shortage', 'large_order', 're_cooking', 'wrong_preparation',
    'customer_modification', 'system_issue', 'other'],

  ensureSlaCss() {
    if (document.getElementById('kds-sla-css')) return;
    const s = document.createElement('style');
    s.id = 'kds-sla-css';
    s.textContent = `
      .kds-sla{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0 6px;font-weight:700}
      .kds-sla-timer{font-family:ui-monospace,Consolas,monospace;font-size:1.05rem}
      .kds-sla-chip{padding:2px 8px;border-radius:999px;font-size:.75rem}
      .kds-sla-on_time,.kds-sla-new{background:#dcfce7;color:#166534}
      .kds-sla-warning{background:#fef9c3;color:#854d0e}
      .kds-sla-overdue{background:#fee2e2;color:#991b1b}
      .kds-sla-critical{background:#111827;color:#fff}
      .order-card.sla-overdue{box-shadow:0 0 0 3px #ef4444 inset}
      .order-card.sla-critical{box-shadow:0 0 0 4px #111827 inset}
      .kds-sla-sub{font-size:.75rem;opacity:.8;font-weight:600}
      .kds-reason-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999}
      .kds-reason-box{background:#fff;color:#111;border-radius:12px;padding:16px;max-width:420px;width:92%}
      .kds-reason-box h3{margin:0 0 8px}
      .kds-reason-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0}
      .kds-reason-grid button{padding:10px 6px;border-radius:8px;border:1px solid #cbd5e1;background:#f8fafc;cursor:pointer;font-weight:600}
      .kds-reason-grid button.sel{background:#2563eb;color:#fff;border-color:#2563eb}
      .kds-reason-box textarea{width:100%;box-sizing:border-box;margin:6px 0}
      .kds-reason-actions{display:flex;gap:8px;justify-content:flex-end}
    `;
    document.head.appendChild(s);
  },

  slaClock(sec) {
    const t = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(t / 3600);
    const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
    const s = String(t % 60).padStart(2, '0');
    return h ? `${h}:${m}:${s}` : `${m}:${s}`;
  },

  tickSla() {
    if (!this.loadedAt) return;
    const extra = (Date.now() - this.loadedAt) / 1000;
    document.querySelectorAll('[data-kds-elapsed]').forEach((n) => {
      const base = Number(n.dataset.kdsElapsed) || 0;
      const running = n.dataset.kdsRunning === '1';
      n.textContent = `${this.slaClock(base + (running ? extra : 0))} / ${this.slaClock((Number(n.dataset.kdsTarget) || 0) * 60)}`;
    });
    const now = Date.now();
    const repeatMs = Math.max(15000, (Number(this.kdsAlert.repeat_sec) || 60) * 1000);
    for (const o of this.orders) {
      const st = o.sla?.state;
      if ((st === 'overdue' || st === 'critical') && this.kdsAlert.enabled !== false) {
        if (!this.overdueAlerted.has(o.id)) this.overdueAlerted.add(o.id);
        if (now - this.lastOverdueSoundAt >= repeatMs) {
          this.lastOverdueSoundAt = now;
          this.playNewOrderSound().catch(() => {});
        }
      }
    }
  },

  async ensureDevicePairing() {
    const host = document.getElementById('kds-pair');
    if (!host) return false;
    host.innerHTML = `<div class="pair-card"><h2>Kitchen Display</h2><p class="muted">Approve in Admin → Business Modules → Ops Devices</p>
      <div class="pair-code" id="kds-pair-code">······</div><p id="kds-pair-msg" class="muted">Requesting…</p></div>`;
    document.getElementById('orders')?.classList.add('hidden');
    try {
      const r = await OpsDisplayClient.requestPairing('kds');
      document.getElementById('kds-pair-code').textContent = r.pairing_code;
      return await new Promise((resolve) => {
        const poll = setInterval(async () => {
          try {
            const st = await OpsDisplayClient.pairingStatus(r.pairing_code);
            if (st.status === 'approved' && st.device_token) {
              clearInterval(poll);
              OpsDisplayClient.setToken(st.device_token);
              host.innerHTML = '';
              document.getElementById('orders')?.classList.remove('hidden');
              resolve(true);
            } else if (st.status === 'expired') { clearInterval(poll); resolve(false); }
          } catch (_) { /* */ }
        }, 3000);
      });
    } catch (_) { return false; }
  },

  slaStrip(o) {
    const s = o.sla;
    if (!s) return '';
    const running = !s.completed && !s.paused;
    const label = (v) => String(v || '').replace(/_/g, ' ');
    return `<div class="kds-sla">
      <span class="kds-sla-timer" data-kds-elapsed="${s.elapsed_seconds || 0}" data-kds-target="${s.target_minutes || 0}" data-kds-running="${running ? 1 : 0}">${s.timer_text}</span>
      <span class="kds-sla-chip kds-sla-${s.state}">${this.SLA_ICON[s.state] || ''} ${s.state_label}</span>
      ${s.paused ? '<span class="kds-sla-sub">⏸ paused</span>' : ''}
      <span class="kds-sla-sub">${label(s.source).toUpperCase()} · ${label(s.order_type)}${s.stage_timer_text ? ` · stage ${s.stage_timer_text}` : ''}</span>
    </div>`;
  },

  askDelayReason(order) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'kds-reason-overlay';
      const label = (v) => String(v).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      wrap.innerHTML = `<div class="kds-reason-box">
        <h3>Order ${order.order_number} is late</h3>
        <div>Why was it delayed?</div>
        <div class="kds-reason-grid">${this.KITCHEN_REASONS.map((r) => `<button type="button" data-r="${r}">${label(r)}</button>`).join('')}</div>
        <textarea rows="2" placeholder="Explanation (required for Other)"></textarea>
        <div class="kds-reason-actions"><button type="button" data-skip>Skip</button><button type="button" data-ok style="background:#2563eb;color:#fff;border:0;padding:8px 14px;border-radius:8px">Save</button></div>
      </div>`;
      let picked = null;
      wrap.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
        picked = b.dataset.r;
        wrap.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('sel', x === b));
      }));
      const close = (val) => { wrap.remove(); resolve(val); };
      wrap.querySelector('[data-skip]').addEventListener('click', () => close(null));
      wrap.querySelector('[data-ok]').addEventListener('click', () => {
        const note = wrap.querySelector('textarea').value.trim();
        if (!picked) return;
        if (picked === 'other' && note.length < 3) { wrap.querySelector('textarea').focus(); return; }
        close({ reason: picked, note });
      });
      document.body.appendChild(wrap);
    });
  },

  async playNewOrderSound() {
    try {
      const settings = await API.getSettingsParsed();
      const path = settings.data?.kds_notification_sound
        || settings.data?.notification_settings?.sound_path;
      if (path) {
        const r = await API.getAudioDataUrl(path);
        const url = r?.success ? r.dataUrl : Utils.fileUrl(path);
        if (!this.audio) this.audio = new Audio();
        this.audio.src = url;
        this.audio.volume = Number(this.kdsAlert.volume) || 0.85;
        await this.audio.play();
        return;
      }
    } catch (_) { /* fallback beep */ }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 660;
      gain.gain.value = 0.25;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(() => { try { osc.stop(); } catch { /* ignore */ } }, 400);
    } catch (_) {}
  },

  async load() {
    try {
      let incoming;
      if (this.deviceMode) {
        incoming = await OpsDisplayClient.loadOrders('pending,preparing,ready,collection');
      } else {
        const res = await API.getKitchenOrders('pending,preparing,ready,collection');
        incoming = res?.data || res || [];
      }
      const active = (Array.isArray(incoming) ? incoming : []).filter(o => !['done', 'completed', 'cancelled'].includes(o.status));
      const newOnes = active.filter(o => !this.knownIds.has(o.id));
      if (newOnes.length && this.knownIds.size) await this.playNewOrderSound();
      this.orders = active;
      this.loadedAt = Date.now();
      this.knownIds = new Set(active.map(o => o.id));
      this.render();
    } catch (err) {
      const el = document.getElementById('orders');
      if (el && !this.orders.length) {
        el.innerHTML = `<div class="empty">Could not load kitchen orders.<br><small>${(err && err.message) || 'Check login and connection.'}</small></div>`;
      }
    }
  },

  elapsed(createdAt) {
    if (!createdAt) return '';
    const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  },

  render() {
    this.renderToolbar();
    const el = document.getElementById('orders');
    if (!el) return;
    if (!this.orders.length) {
      el.innerHTML = '<div class="empty">No active kitchen orders</div>';
      return;
    }
    el.innerHTML = this.orders.map(o => `
      <article class="order-card ${o.status || 'pending'}${o.sla ? ` sla-${o.sla.state}` : ''}" data-id="${o.id}">
        <header class="order-head">
          <div class="order-num"><label><input type="checkbox" class="kds-sel" data-sel-id="${o.id}" ${this.selectedIds.has(o.id) ? 'checked' : ''}> ${o.order_number}</label></div>
          <span class="order-badge ${o.status || 'pending'}">${(o.status || 'pending').toUpperCase()}</span>
        </header>
        ${this.slaStrip(o)}
        <div class="order-meta">${this.elapsed(o.created_at)} · ${o.station || 'kitchen'}${o.table_number ? ` · Table ${o.table_number}` : ''}</div>
        <ul class="order-items">${(o.items || []).map(i =>
          `<li><span class="qty">${i.quantity}×</span> ${i.product_name}${i.modifiers ? ` <em>(${i.modifiers})</em>` : ''}${i.notes ? ` <small class="allergen">${i.notes}</small>` : ''}</li>`).join('')}</ul>
        <footer class="order-actions">
          ${o.status === 'pending' ? `<button class="btn btn-start" data-id="${o.id}" data-action="preparing">Start cooking</button>` : ''}
          ${o.status === 'preparing' ? `<button class="btn btn-ready" data-id="${o.id}" data-action="ready">Mark ready</button>` : ''}
          ${o.status === 'ready' ? `<button class="btn btn-ready" data-id="${o.id}" data-action="collection">To collection</button>` : ''}
          ${o.status === 'collection' ? `<button class="btn btn-done" data-id="${o.id}" data-action="completed">Collected ✓</button>` : ''}
          ${o.status !== 'collection' ? `<button class="btn btn-done" data-id="${o.id}" data-action="completed" style="opacity:0.75">Done</button>` : ''}
        </footer>
      </article>`).join('');

    el.querySelectorAll('[data-sel-id]').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        const id = Number(e.target.dataset.selId);
        if (e.target.checked) this.selectedIds.add(id);
        else this.selectedIds.delete(id);
        this.renderToolbar();
      });
    });
    el.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const action = btn.dataset.action;
        const actor = this.sessionUser || window.App?.user || window.parent?.App?.user || null;
        const order = this.orders.find(o => o.id === id);
        if (order?.sla?.needs_reason && ['ready', 'collection', 'completed', 'done'].includes(action) && API.slaDelayReason) {
          const pick = await this.askDelayReason(order);
          if (pick) {
            try { await API.slaDelayReason(order.sla.id, { stage: 'kitchen', reason: pick.reason, note: pick.note }); } catch (_) { /* never block the kitchen */ }
          }
        }
        let r;
        if (this.deviceMode && OpsDisplayClient?.getToken?.()) {
          r = await OpsDisplayClient.call('opsDisplay:bulkKitchenStatus', [
            OpsDisplayClient.getToken(), [id], action, {}
          ]);
        } else {
          r = await API.updateKitchenStatus(id, action, actor);
        }
        if (r && r.success === false) {
          console.warn('Kitchen status update failed', r.error);
          await this.load();
          return;
        }
        if (action === 'completed' || action === 'done') {
          this.orders = this.orders.filter(o => o.id !== id);
          this.knownIds.delete(id);
          btn.closest('.order-card')?.remove();
          if (!this.orders.length) el.innerHTML = '<div class="empty">No active kitchen orders</div>';
          try {
            const bc = new BroadcastChannel('shoppos-kitchen');
            bc.postMessage({ type: 'refresh' });
            bc.close();
          } catch (_) {}
          return;
        }
        await this.load();
      });
    });
  }
};

document.addEventListener('DOMContentLoaded', () => KDS.init());

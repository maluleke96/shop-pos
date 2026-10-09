const DriveThruApp = {
  user: null, catalog: null, order: null, categoryId: null, paymentMethod: 'card', voucherCode: '', voucherDiscount: 0,

  esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },
  money(n) { return `R${Number(n || 0).toFixed(2)}`; },

  productImageUrl(p) {
    if (!p?.has_image || !p?.image_url) return null;
    const station = localStorage.getItem('dt_station_token') || '';
    const base = (window.__DRIVE_THRU_CONFIG__?.apiBase || window.location.origin || '').replace(/\/$/, '');
    const path = String(p.image_url).startsWith('http') ? p.image_url : `${base}${p.image_url}`;
    return `${path}?token=${encodeURIComponent(station)}`;
  },

  async init() {
    DriveThruAudio.init().catch(() => {});
    const station = localStorage.getItem('dt_station_token');
    const portal = localStorage.getItem('dt_portal_token');
    if (station && portal) {
      try {
        await DriveThruAPI.stationLogin();
        await this.loadCatalog();
        this.showApp();
        this.startHeartbeat();
        return;
      } catch (_) {
        localStorage.removeItem('dt_portal_token');
      }
    }
    if (localStorage.getItem('dt_station_token')) {
      try {
        await this.loadCatalog();
        this.showApp();
        this.startHeartbeat();
        return;
      } catch (_) {
        localStorage.removeItem('dt_station_token');
      }
    }
    this.showPairing();
  },

  showLogin() {
    document.getElementById('station-setup')?.classList.add('hidden');
    document.getElementById('app')?.classList.add('hidden');
    document.getElementById('login-screen')?.classList.remove('hidden');
    const btn = document.getElementById('dt-login-btn');
    if (btn) btn.onclick = () => this.login();
    const pair = document.getElementById('dt-show-pair');
    if (pair) pair.onclick = () => this.showPairing();
  },

  showPairing() {
    document.getElementById('login-screen')?.classList.add('hidden');
    document.getElementById('station-setup')?.classList.remove('hidden');
    const btn = document.getElementById('station-connect-btn');
    if (btn) btn.onclick = () => this.connectStation();
    this.startPairing();
  },

  async startPairing() {
    if (this._pairTimer) clearInterval(this._pairTimer);
    const codeEl = document.getElementById('pair-code');
    const msgEl = document.getElementById('pair-msg');
    try {
      const r = await DriveThruAPI.requestPairing({ platform: navigator.platform || '' });
      if (codeEl) codeEl.textContent = r.pairing_code || '------';
      if (msgEl) msgEl.textContent = 'Approve this code in Admin → Business Modules → Drive-Thru.';
      this._pairTimer = setInterval(async () => {
        try {
          const st = await DriveThruAPI.pairingStatus(r.pairing_code);
          if (st.status === 'approved' && st.station_token) {
            clearInterval(this._pairTimer);
            localStorage.setItem('dt_station_token', st.station_token);
            if (msgEl) msgEl.textContent = 'Paired. Opening the station…';
            try {
              if (localStorage.getItem('dt_portal_token')) await DriveThruAPI.stationLogin();
              await this.loadCatalog();
              document.getElementById('station-setup')?.classList.add('hidden');
              document.getElementById('login-screen')?.classList.add('hidden');
              this.showApp();
              this.startHeartbeat();
            } catch (err) {
              this.showLogin();
              const loginErr = document.getElementById('login-err');
              if (loginErr) loginErr.textContent = err.message || 'Station paired. Sign in with your Admin password to open the lane.';
            }
          } else if (st.status === 'expired' || st.status === 'rejected') {
            clearInterval(this._pairTimer);
            if (msgEl) msgEl.textContent = `Pairing ${st.status}. Refresh to get a new code.`;
          }
        } catch (_) { /* keep polling */ }
      }, 3000);
    } catch (e) {
      if (msgEl) msgEl.textContent = e.message || 'Could not request a pairing code';
    }
  },

  async login() {
    try {
      const r = await DriveThruAPI.login(document.getElementById('dt-user').value.trim(), document.getElementById('dt-pass').value);
      localStorage.setItem('dt_portal_token', r.token);
      localStorage.setItem('dt_user', JSON.stringify(r.user));
      this.user = r.user;
      if (!localStorage.getItem('dt_station_token')) {
        this.showPairing();
        return;
      }
      await this.connectStation(localStorage.getItem('dt_station_token'));
    } catch (e) { document.getElementById('login-err').textContent = e.message; }
  },

  async connectStation(token) {
    const tok = String(token || document.getElementById('station-token')?.value || '').trim();
    if (!tok) return;
    if (!localStorage.getItem('dt_portal_token')) {
      localStorage.setItem('dt_station_token', tok);
      this.showLogin();
      return;
    }
    try {
      localStorage.setItem('dt_station_token', tok);
      await DriveThruAPI.stationLogin();
      await this.loadCatalog();
      document.getElementById('station-setup')?.classList.add('hidden');
      document.getElementById('login-screen')?.classList.add('hidden');
      this.showApp();
      this.startHeartbeat();
    } catch (e) {
      const msg = e.message || 'Could not connect station';
      const err = document.getElementById('pair-msg') || document.getElementById('login-err');
      if (err) err.textContent = msg;
      else alert(msg);
    }
  },

  async loadCatalog() {
    this.catalog = await DriveThruAPI.catalog();
    if (!this.categoryId && this.catalog.categories?.length) this.categoryId = this.catalog.categories[0].id;
    const methods = this.catalog.payment_methods || ['cash', 'card'];
    if (!methods.includes(this.paymentMethod)) this.paymentMethod = methods[0] || 'cash';
  },

  startHeartbeat() {
    setInterval(async () => {
      try {
        await DriveThruAPI.stationHeartbeat({ audio_status: DriveThruAudio.getStatusReport(), online: navigator.onLine });
      } catch (_) { DriveThruAudio.status.mic = 'NETWORK ERROR'; }
    }, 15000);
  },

  showApp() {
    document.getElementById('station-setup')?.classList.add('hidden');
    document.getElementById('login-screen')?.classList.add('hidden');
    document.getElementById('app')?.classList.remove('hidden');
    this.render();
  },

  products() {
    const prods = this.catalog?.products || [];
    if (!this.categoryId) return prods;
    return prods.filter((p) => p.category_id === this.categoryId);
  },

  async render() {
    const app = document.getElementById('app');
    const items = this.order?.items || [];
    const total = items.reduce((s, i) => s + (i.total || i.unit_price * i.quantity), 0);
    const audio = DriveThruAudio;
    const devices = DriveThruAudio.devices || { inputs: [], outputs: [] };
    if (!DriveThruAudio.devices && !DriveThruAudio._devicesLoading) {
      DriveThruAudio._devicesLoading = true;
      DriveThruAudio.refreshDevices()
        .then(() => { if (document.getElementById('app') && !document.getElementById('app').classList.contains('hidden')) this.render(); })
        .catch(() => {})
        .finally(() => { DriveThruAudio._devicesLoading = false; });
    }

    const signedIn = !!localStorage.getItem('dt_portal_token');
    app.innerHTML = `<div class="dt-header">
      <div><strong>${this.esc(this.catalog?.station?.name || 'Drive-Thru')}</strong> · ${this.esc(this.user?.full_name || (signedIn ? '' : 'Not signed in'))}</div>
      <div>${signedIn ? '' : '<button type="button" data-act="staff-login" style="padding:8px 12px;border:none;border-radius:8px;background:#334155;color:#fff;cursor:pointer">Sign in</button> '}${this.order ? `Order #${this.order.id} · ${this.order.status}` : 'No active order'}</div></div>
      <div class="dt-layout">
        <div class="panel"><h3>Menu</h3>
          <div class="dt-cats">${(this.catalog?.categories || []).map((c) => `<button type="button" class="dt-cat ${c.id === this.categoryId ? 'active' : ''}" data-cat="${c.id}">${this.esc(c.name)}</button>`).join('')}</div>
          <div class="dt-menu-grid">${this.products().map((p) => {
            const img = this.productImageUrl(p);
            return `<button type="button" class="product-btn dt-product-btn" data-pid="${p.id}" ${p.available ? '' : 'disabled'}>
              ${img ? `<img class="dt-product-thumb" src="${this.esc(img)}" alt="" loading="eager" decoding="async">` : '<span class="dt-product-thumb"></span>'}
              <span class="dt-product-name">${this.esc(p.name)} <small>${this.money(p.selling_price)}</small></span></button>`;
          }).join('')}</div></div>
        <div class="panel"><h3>Current Order</h3>
          ${items.map((it, i) => `<div class="order-line"><span>${it.quantity}× ${this.esc(it.product_name)}</span><span>${this.money(it.total || it.unit_price * it.quantity)}</span></div>`).join('') || '<p class="muted">Start order or add items</p>'}
          <p style="font-size:20px;margin-top:12px"><strong>Total: ${this.money(Math.max(0, total - this.voucherDiscount))}</strong></p>
          <div style="display:flex;gap:8px;margin-top:8px">
            <input id="dt-voucher" placeholder="Voucher" value="${this.esc(this.voucherCode)}" style="flex:1;padding:8px">
            <button type="button" class="btn-gray" data-act="apply-voucher">Apply</button>
          </div>
          <p class="muted" style="font-size:12px;margin-top:6px">Payment: ${this.esc((this.catalog?.payment_methods || []).join(', ') || 'cash, card')}</p>
          <textarea id="order-notes" placeholder="Order notes" style="width:100%;margin-top:8px;padding:8px;background:#0f172a;color:#fff;border:1px solid #334155;border-radius:6px">${this.esc(this.order?.notes || '')}</textarea>
          <div class="dt-actions">
            ${!this.order ? '<button class="btn-green" data-act="start">New Vehicle</button>' : ''}
            ${this.order ? '<button class="btn-blue" data-act="confirm">Confirm</button>' : ''}
            ${this.order && this.order.status === 'confirmed' ? '<button class="btn-green" data-act="pay">Take Payment</button>' : ''}
            ${this.order && ['paid','preparing'].includes(this.order.status) ? '<button class="btn-blue" data-act="ready">Mark Ready</button>' : ''}
            ${this.order && this.order.status === 'ready' ? '<button class="btn-green" data-act="collected">Collected</button>' : ''}
            ${this.order ? '<button class="btn-red" data-act="cancel">Cancel</button>' : ''}
          </div>
          <p id="order-err" class="err"></p></div>
        <div class="panel audio-panel"><h3>Audio (separate from Signage)</h3>
          <div>${['mic','speaker'].map((k) => `<span class="status-pill ${audio.status[k]?.includes('ERROR') || audio.status[k]?.includes('REQUIRED') ? 'status-error' : audio.status[k]?.includes('MUTED') ? 'status-warn' : 'status-ready'}">${audio.status[k] || k}</span>`).join('')}</div>
          <label style="font-size:12px;margin-top:12px;display:block">Microphone</label>
          <select id="mic-select">${devices.inputs.map((d) => `<option value="${d.deviceId}" ${d.deviceId === audio.micDeviceId ? 'selected' : ''}>${this.esc(d.label || 'Mic')}</option>`).join('')}</select>
          <div class="level-bar"><div class="level-fill" id="mic-level"></div></div>
          <label style="font-size:12px;display:block">Speaker</label>
          <select id="spk-select">${devices.outputs.map((d) => `<option value="${d.deviceId}" ${d.deviceId === audio.speakerDeviceId ? 'selected' : ''}>${this.esc(d.label || 'Speaker')}</option>`).join('')}</select>
          <label>Volume <input type="range" id="spk-vol" min="0" max="1" step="0.05" value="${audio.speakerVolume}"></label>
          <button class="ptt-btn ptt-idle" id="ptt-btn">🎤 Hold to Talk (Push-to-Talk)</button>
          <button class="btn-gray" data-act="test-mic" style="width:100%;padding:10px;margin:4px 0">Test Microphone</button>
          <button class="btn-gray" data-act="test-spk" style="width:100%;padding:10px">Test Speaker</button>
        </div>
      </div>`;

    document.getElementById('mic-select')?.addEventListener('change', async (e) => {
      DriveThruAudio.micDeviceId = e.target.value;
      await DriveThruAudio.selectMic(e.target.value);
      DriveThruAPI.saveAudioConfig({ mic_device_id: e.target.value }).catch(() => {});
      this.render();
    });
    document.getElementById('spk-select')?.addEventListener('change', (e) => {
      DriveThruAudio.speakerDeviceId = e.target.value;
      DriveThruAPI.saveAudioConfig({ speaker_device_id: e.target.value }).catch(() => {});
    });
    document.getElementById('spk-vol')?.addEventListener('input', (e) => { DriveThruAudio.speakerVolume = Number(e.target.value); });

    const ptt = document.getElementById('ptt-btn');
    if (ptt) {
      const start = async () => { ptt.className = 'ptt-btn ptt-active'; ptt.textContent = '🔴 Speaking…'; await DriveThruAudio.startPTT(); };
      const stop = () => { ptt.className = 'ptt-btn ptt-idle'; ptt.textContent = '🎤 Hold to Talk (Push-to-Talk)'; DriveThruAudio.stopPTT(); };
      ptt.addEventListener('mousedown', start);
      ptt.addEventListener('mouseup', stop);
      ptt.addEventListener('mouseleave', stop);
      ptt.addEventListener('touchstart', (e) => { e.preventDefault(); start(); });
      ptt.addEventListener('touchend', stop);
    }

    app.onclick = async (e) => {
      const err = document.getElementById('order-err');
      try {
        if (e.target.closest('[data-cat]')) { this.categoryId = Number(e.target.closest('[data-cat]').dataset.cat); this.render(); return; }
        if (e.target.closest('[data-pid]')) { await this.addProduct(Number(e.target.closest('[data-pid]').dataset.pid)); return; }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'staff-login') { this.showLogin(); return; }
        if (act === 'start') {
          if (!localStorage.getItem('dt_portal_token')) {
            this.showLogin();
            const loginErr = document.getElementById('login-err');
            if (loginErr) loginErr.textContent = 'Sign in with your Admin password to open a vehicle.';
            return;
          }
          this.order = await DriveThruAPI.startOrder();
          this.render();
        }
        if (act === 'confirm') {
          await this.saveOrder();
          this.order = await DriveThruAPI.confirmOrder(this.order.id);
          this.render();
        }
        if (act === 'apply-voucher') {
          const code = document.getElementById('dt-voucher')?.value.trim();
          if (!code) { this.voucherCode = ''; this.voucherDiscount = 0; this.render(); return; }
          try {
            const r = await DriveThruAPI.validateVoucher(code, { subtotal: total, items: this.order?.items || [] });
            if (!r.ok) throw new Error(r.error || 'Invalid voucher');
            this.voucherCode = r.code || code;
            this.voucherDiscount = Number(r.discount) || 0;
            this.render();
          } catch (ex) { if (err) err.textContent = ex.message; }
          return;
        }
        if (act === 'pay') {
          await this.saveOrder();
          const methods = this.catalog?.payment_methods || ['cash', 'card'];
          const pick = methods.length > 1
            ? await this.pickPaymentMethod(methods)
            : (methods[0] || 'card');
          if (!pick) return;
          this.order = await DriveThruAPI.takePayment(this.order.id, {
            payment_method: pick,
            voucher_code: this.voucherCode || undefined,
            client_request_id: `dt-${this.order.id}`
          });
          this.voucherCode = ''; this.voucherDiscount = 0;
          this.render();
        }
        if (act === 'ready') { this.order = await DriveThruAPI.markReady(this.order.id); this.render(); }
        if (act === 'collected') { this.order = await DriveThruAPI.markCollected(this.order.id); this.order = null; this.render(); }
        if (act === 'cancel') {
          if (!confirm('Cancel order?')) return;
          await DriveThruAPI.cancelOrder(this.order.id, 'Staff cancelled');
          this.order = null; this.render();
        }
        if (act === 'test-mic') { await DriveThruAudio.selectMic(DriveThruAudio.micDeviceId || document.getElementById('mic-select')?.value); alert('Mic status: ' + DriveThruAudio.status.mic); }
        if (act === 'test-spk') { const ok = await DriveThruAudio.testSpeaker(); alert(ok ? 'Speaker test played' : 'Speaker error'); this.render(); }
      } catch (ex) { if (err) err.textContent = ex.message; }
    };
  },

  async addProduct(pid) {
    if (!this.order) this.order = await DriveThruAPI.startOrder();
    const p = (this.catalog.products || []).find((x) => x.id === pid);
    if (!p?.available) return;
    const items = [...(this.order.items || []), { product_id: p.id, quantity: 1, modifiers: [] }];
    this.order = await DriveThruAPI.updateOrder(this.order.id, { items, notes: document.getElementById('order-notes')?.value });
    this.render();
  },

  pickPaymentMethod(methods) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal';
      wrap.innerHTML = `<div class="modal-inner"><h3>Payment method</h3>
        ${methods.map((m) => `<button type="button" class="pay-btn" data-m="${m}">${m.toUpperCase()}</button>`).join('')}
        <button type="button" class="btn-gray" data-cancel style="margin-top:12px;width:100%">Cancel</button></div>`;
      document.body.appendChild(wrap);
      wrap.onclick = (e) => {
        if (e.target.closest('[data-cancel]')) { wrap.remove(); resolve(null); return; }
        const b = e.target.closest('[data-m]');
        if (b) { wrap.remove(); resolve(b.dataset.m); }
      };
    });
  },

  async saveOrder() {
    const items = (this.order?.items || []).map((it) => ({ product_id: it.product_id, quantity: it.quantity, modifiers: it.modifiers || [] }));
    this.order = await DriveThruAPI.updateOrder(this.order.id, { items, notes: document.getElementById('order-notes')?.value || '' });
  }
};

DriveThruApp.init();

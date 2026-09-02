const DriveThruApp = {
  user: null, catalog: null, order: null, categoryId: null,

  esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },
  money(n) { return `R${Number(n || 0).toFixed(2)}`; },

  async init() {
    await DriveThruAudio.init();
    if (localStorage.getItem('dt_portal_token') && localStorage.getItem('dt_station_token')) {
      try {
        await DriveThruAPI.stationLogin();
        await this.loadCatalog();
        this.showApp();
        this.startHeartbeat();
        return;
      } catch (_) { localStorage.clear(); }
    }
    if (localStorage.getItem('dt_portal_token')) {
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('station-setup').classList.remove('hidden');
      document.getElementById('station-connect-btn').onclick = () => this.connectStation();
      return;
    }
    document.getElementById('dt-login-btn').onclick = () => this.login();
  },

  async login() {
    try {
      const r = await DriveThruAPI.login(document.getElementById('dt-user').value.trim(), document.getElementById('dt-pass').value);
      localStorage.setItem('dt_portal_token', r.token);
      localStorage.setItem('dt_user', JSON.stringify(r.user));
      this.user = r.user;
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('station-setup').classList.remove('hidden');
      document.getElementById('station-connect-btn').onclick = () => this.connectStation();
    } catch (e) { document.getElementById('login-err').textContent = e.message; }
  },

  async connectStation() {
    const tok = document.getElementById('station-token').value.trim();
    if (!tok) return;
    try {
      localStorage.setItem('dt_station_token', tok);
      await DriveThruAPI.stationLogin();
      await this.loadCatalog();
      document.getElementById('station-setup').classList.add('hidden');
      this.showApp();
      this.startHeartbeat();
    } catch (e) {
      alert(e.message || 'Could not connect station');
    }
  },

  async loadCatalog() {
    this.catalog = await DriveThruAPI.catalog();
    if (!this.categoryId && this.catalog.categories?.length) this.categoryId = this.catalog.categories[0].id;
  },

  startHeartbeat() {
    setInterval(async () => {
      try {
        await DriveThruAPI.stationHeartbeat({ audio_status: DriveThruAudio.getStatusReport(), online: navigator.onLine });
      } catch (_) { DriveThruAudio.status.mic = 'NETWORK ERROR'; }
    }, 15000);
  },

  showApp() {
    document.getElementById('app').classList.remove('hidden');
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
    const devices = await DriveThruAudio.refreshDevices().catch(() => ({ inputs: [], outputs: [] }));

    app.innerHTML = `<div class="dt-header">
      <div><strong>${this.esc(this.catalog?.station?.name || 'Drive-Thru')}</strong> · ${this.esc(this.user?.full_name || '')}</div>
      <div>${this.order ? `Order #${this.order.id} · ${this.order.status}` : 'No active order'}</div></div>
      <div class="dt-layout">
        <div class="panel"><h3>Menu</h3>
          ${(this.catalog?.categories || []).map((c) => `<button class="product-btn ${c.id === this.categoryId ? 'style="outline:2px solid #22c55e"' : ''}" data-cat="${c.id}">${this.esc(c.name)}</button>`).join('')}
          <hr style="margin:12px 0;border-color:#334155">
          ${this.products().map((p) => `<button class="product-btn" data-pid="${p.id}" ${p.available ? '' : 'disabled'}>
            ${this.esc(p.name)} <small>${this.money(p.selling_price)}</small></button>`).join('')}</div>
        <div class="panel"><h3>Current Order</h3>
          ${items.map((it, i) => `<div class="order-line"><span>${it.quantity}× ${this.esc(it.product_name)}</span><span>${this.money(it.total || it.unit_price * it.quantity)}</span></div>`).join('') || '<p class="muted">Start order or add items</p>'}
          <p style="font-size:20px;margin-top:12px"><strong>Total: ${this.money(total)}</strong></p>
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
        if (act === 'start') { this.order = await DriveThruAPI.startOrder(); this.render(); }
        if (act === 'confirm') {
          await this.saveOrder();
          this.order = await DriveThruAPI.confirmOrder(this.order.id);
          this.render();
        }
        if (act === 'pay') {
          await this.saveOrder();
          this.order = await DriveThruAPI.takePayment(this.order.id, { payment_method: 'card', client_request_id: `dt-${this.order.id}-${Date.now()}` });
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

  async saveOrder() {
    const items = (this.order?.items || []).map((it) => ({ product_id: it.product_id, quantity: it.quantity, modifiers: it.modifiers || [] }));
    this.order = await DriveThruAPI.updateOrder(this.order.id, { items, notes: document.getElementById('order-notes')?.value || '' });
  }
};

DriveThruApp.init();

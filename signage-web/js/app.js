const SignageApp = {
  view: 'login', tab: 'dashboard', dash: null, user: null,

  esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },
  toast(m, t) { const e = document.createElement('div'); e.className = `toast ${t === 'error' ? 'error' : ''}`; e.textContent = m; document.getElementById('toast-root').appendChild(e); setTimeout(() => e.remove(), 3500); },

  async init() {
    if (localStorage.getItem('signage_token')) {
      try { this.dash = await SignageAPI.dashboard(); this.user = JSON.parse(localStorage.getItem('signage_user') || '{}'); this.view = 'main'; } catch (_) {
        localStorage.removeItem('signage_token'); this.view = 'login';
      }
    }
    this.render();
  },

  async refresh() { this.dash = await SignageAPI.dashboard(); this.render(); },

  render() {
    const app = document.getElementById('app');
    if (this.view === 'login') {
      app.innerHTML = `<div class="portal-card"><h1>Digital Signage Centre</h1><p class="muted">Shop TVs, menus, media, music & announcements</p>
        <label>Username<input id="sg-user"></label><label>Password<input id="sg-pass" type="password"></label>
        <button class="btn" data-act="login">Sign in</button>
        <p class="muted" style="margin-top:12px"><a href="/signage-player/" target="_blank">Open TV Player</a></p></div>`;
    } else {
      const s = this.dash?.screens || {};
      app.innerHTML = `<div class="portal-card"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div><h1>Digital Signage</h1><p class="muted">${this.esc(this.user?.full_name)} · ${this.esc(this.user?.role)}</p></div>
        <div><a class="btn secondary" href="/signage-player/" target="_blank">TV Player</a> <button class="btn secondary" data-act="logout">Logout</button></div></div>
        <div class="stat-grid">
          <div class="stat"><span class="muted">Screens</span><b>${s.total || 0}</b></div>
          <div class="stat"><span class="muted">Online</span><b style="color:#86efac">${s.online || 0}</b></div>
          <div class="stat"><span class="muted">Offline</span><b style="color:#fca5a5">${s.offline || 0}</b></div>
          <div class="stat"><span class="muted">Media</span><b>${this.dash?.content?.total || 0}</b></div>
        </div></div>
        <div class="signage-nav">${['dashboard','screens','media','playlists','menus','publish','announce'].map((t) =>
          `<button class="${this.tab === t ? 'active' : ''}" data-tab="${t}">${t}</button>`).join('')}</div>
        <div id="sg-body"></div>`;
      this.renderTab();
    }
    this.bind();
  },

  renderTab() {
    const body = document.getElementById('sg-body');
    if (!body) return;
    if (this.tab === 'dashboard') return this.tabDashboard(body);
    if (this.tab === 'screens') return this.tabScreens(body);
    if (this.tab === 'media') return this.tabMedia(body);
    if (this.tab === 'playlists') return this.tabPlaylists(body);
    if (this.tab === 'menus') return this.tabMenus(body);
    if (this.tab === 'publish') return this.tabPublish(body);
    if (this.tab === 'announce') return this.tabAnnounce(body);
  },

  tabDashboard(body) {
    const devs = this.dash?.devices || [];
    body.innerHTML = `<div class="portal-card"><h2>Screen status</h2>
      ${devs.map((d) => `<div class="screen-card ${d.status}"><strong>${this.esc(d.name)}</strong> — ${this.esc(d.status)}
        <br><span class="muted">${this.esc(d.location || '')} · Playlist: ${this.esc(d.current_playlist_name || '—')} · Heartbeat: ${this.esc(d.last_heartbeat || 'never')}</span></div>`).join('') || '<p class="muted">No screens paired yet. Open TV Player and add a screen.</p>'}</div>`;
  },

  async tabScreens(body) {
    body.innerHTML = '<p class="muted">Loading pairings…</p>';
    const pending = await SignageAPI.pendingPairings().catch(() => []);
    const devs = this.dash?.devices || [];
    body.innerHTML = `<div class="portal-card"><h2>Add screen</h2>
      ${(pending || []).map((p) => {
        const meta = typeof p.device_meta === 'string' ? JSON.parse(p.device_meta || '{}') : (p.device_meta || {});
        return `<div class="screen-card"><strong>Code: ${this.esc(p.pairing_code)}</strong> — ${this.esc(meta.platform || meta.device_name || 'Unknown device')}
          <div style="margin-top:8px"><button class="btn" data-act="approve" data-code="${p.pairing_code}">Approve</button>
          <button class="btn secondary" data-act="reject" data-code="${p.pairing_code}">Reject</button></div></div>`;
      }).join('') || '<p class="muted">No pending pairing codes. Start the TV Player to get a code.</p>'}
      <h2 style="margin-top:16px">Paired screens</h2>
      ${devs.map((d) => `<div class="screen-card ${d.status}"><strong>${this.esc(d.name)}</strong>
        <button class="btn secondary" data-act="sync" data-id="${d.id}">Sync</button>
        <button class="btn secondary" data-act="revoke" data-id="${d.id}">Revoke</button></div>`).join('')}</div>`;
  },

  tabMedia(body) {
    body.innerHTML = `<div class="portal-card"><h2>Upload media</h2>
      <input type="file" id="sg-file" accept="image/*,video/*,audio/*" multiple>
      <select id="sg-cat"><option value="general">General</option><option value="food">Food</option><option value="promo">Promotion</option><option value="music">Music</option></select>
      <h2 style="margin-top:16px">Library</h2>
      <div id="sg-media-list" class="muted">Loading…</div></div>`;
    this.loadMediaList();
    document.getElementById('sg-file')?.addEventListener('change', (e) => this.uploadFiles(e.target.files));
  },

  async loadMediaList() {
    const list = document.getElementById('sg-media-list');
    if (!list) return;
    const items = await SignageAPI.listMedia();
    list.innerHTML = (items || []).map((m) => `<div>${this.esc(m.title)} <span class="badge">${m.media_type}</span> ${Math.round((m.file_size || 0)/1024)}KB</div>`).join('') || 'No media yet';
  },

  async uploadFiles(files) {
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          await SignageAPI.uploadMedia({ title: file.name, filename: file.name, file_data: reader.result, category: document.getElementById('sg-cat')?.value, mime_type: file.type });
          this.toast(`Uploaded ${file.name}`, 'success');
          this.loadMediaList();
        } catch (e) { this.toast(e.message, 'error'); }
      };
      reader.readAsDataURL(file);
    }
  },

  tabPlaylists(body) {
    const pls = this.dash?.playlists || [];
    body.innerHTML = `<div class="portal-card"><button class="btn" data-act="new-playlist">New playlist</button>
      <ul style="margin-top:12px">${pls.map((p) => `<li>${this.esc(p.name)} (v${p.version})</li>`).join('') || '<li class="muted">No playlists</li>'}</ul></div>`;
  },

  tabMenus(body) {
    body.innerHTML = `<div class="portal-card"><button class="btn" data-act="new-menu">New menu</button>
      <button class="btn secondary" data-act="sync-menu">Sync menu from POS products</button>
      <div id="sg-menus" class="muted" style="margin-top:12px">Loading…</div></div>`;
    SignageAPI.listMenus().then((menus) => {
      document.getElementById('sg-menus').innerHTML = (menus || []).map((m) => `<div>${this.esc(m.name)} v${m.version} <button class="btn secondary" data-act="sync-menu-id" data-id="${m.id}">Sync POS</button></div>`).join('') || 'No menus';
    });
  },

  tabPublish(body) {
    const pls = this.dash?.playlists || [];
    const groups = this.dash?.groups || [];
    body.innerHTML = `<div class="portal-card"><h2>Publish to screens</h2>
      <label>Playlist<select id="pub-pl">${pls.map((p) => `<option value="${p.id}">${this.esc(p.name)}</option>`).join('')}</select></label>
      <label>Target<select id="pub-target"><option value="all">All screens</option>${groups.map((g) => `<option value="group:${g.id}">${this.esc(g.name)}</option>`).join('')}</select></label>
      <button class="btn" data-act="publish">PUBLISH TO SCREENS</button>
      <p class="muted">Validates media files exist before publishing. Offline screens are marked separately.</p></div>`;
  },

  tabAnnounce(body) {
    body.innerHTML = `<div class="portal-card"><h2>Voice announcement</h2>
      <textarea id="ann-text" placeholder="Today's special is half chicken and chips for R90."></textarea>
      <button class="btn" data-act="ai-voice">Generate AI voice</button>
      <button class="btn secondary" data-act="save-ann">Save announcement</button>
      <button class="btn warn" data-act="play-ann">PLAY NOW</button>
      <p class="muted">Music ducking is handled on the player. AI voice requires server API key.</p></div>`;
  },

  bind() {
    document.getElementById('app').onclick = async (e) => {
      const btn = e.target.closest('[data-act]');
      const tab = e.target.closest('[data-tab]');
      if (tab) { this.tab = tab.dataset.tab; document.querySelectorAll('.signage-nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === this.tab)); this.renderTab(); return; }
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'login') {
        try {
          const r = await SignageAPI.login(document.getElementById('sg-user').value.trim(), document.getElementById('sg-pass').value);
          localStorage.setItem('signage_token', r.token);
          localStorage.setItem('signage_user', JSON.stringify(r.user));
          this.user = r.user; await this.refresh(); this.view = 'main'; this.render();
        } catch (err) { this.toast(err.message, 'error'); }
      }
      if (act === 'logout') { await SignageAPI.logout().catch(() => {}); localStorage.clear(); this.view = 'login'; this.render(); }
      if (act === 'approve') {
        const name = prompt('Screen name:', 'Counter TV');
        if (!name) return;
        try { await SignageAPI.approvePairing(btn.dataset.code, { name, location: prompt('Location:') || '' }); this.toast('Screen approved', 'success'); await this.refresh(); this.tab = 'screens'; this.render(); } catch (err) { this.toast(err.message, 'error'); }
      }
      if (act === 'reject') { await SignageAPI.rejectPairing(btn.dataset.code); this.toast('Rejected'); this.tabScreens(document.getElementById('sg-body')); }
      if (act === 'sync') { await SignageAPI.remoteCommand(Number(btn.dataset.id), 'sync', {}); this.toast('Sync queued'); }
      if (act === 'revoke') { if (confirm('Revoke this device?')) { await SignageAPI.revokeDevice(Number(btn.dataset.id)); await this.refresh(); this.render(); } }
      if (act === 'new-playlist') {
        const name = prompt('Playlist name:'); if (!name) return;
        const media = await SignageAPI.listMedia();
        const pick = prompt(`Enter media IDs comma-separated (available: ${media.map((m) => m.id).join(',')})`);
        const items = (pick || '').split(',').filter(Boolean).map((id) => ({ item_type: 'media', media_id: Number(id), duration_seconds: 8 }));
        await SignageAPI.savePlaylist({ name, items }); this.toast('Playlist saved'); await this.refresh(); this.render();
      }
      if (act === 'new-menu') {
        const name = prompt('Menu name:'); if (!name) return;
        await SignageAPI.saveMenu({ name, title_text: name, items: [] }); this.toast('Menu created'); this.tab = 'menus'; this.render();
      }
      if (act === 'sync-menu' || act === 'sync-menu-id') {
        const menus = await SignageAPI.listMenus();
        const id = act === 'sync-menu-id' ? Number(btn.dataset.id) : menus[0]?.id;
        if (!id) return this.toast('Create a menu first', 'error');
        await SignageAPI.syncMenuFromProducts(id); this.toast('Synced from POS'); this.render();
      }
      if (act === 'publish') {
        const playlist_id = Number(document.getElementById('pub-pl')?.value);
        const target = document.getElementById('pub-target')?.value || 'all';
        let target_type = 'all'; let target_ids = [];
        if (target.startsWith('group:')) { target_type = 'group'; target_ids = [Number(target.split(':')[1])]; }
        if (!confirm('Publish to screens?')) return;
        try {
          const r = await SignageAPI.publish({ playlist_id, target_type, target_ids, name: 'Publication' });
          this.toast(`Published: ${r.status} (${(r.devices || []).length} screens)`, r.status === 'failed' ? 'error' : 'success');
        } catch (err) { this.toast(err.message, 'error'); }
      }
      if (act === 'ai-voice') {
        const text = document.getElementById('ann-text')?.value;
        if (!text) return;
        try {
          const r = await SignageAPI.generateAiVoice(text);
          if (r.status === 'NOT_IMPLEMENTED') this.toast(r.message, 'error');
          else { this._lastAudioMediaId = r.media_id; this.toast('AI voice generated'); }
        } catch (err) { this.toast(err.message, 'error'); }
      }
      if (act === 'save-ann') {
        const text = document.getElementById('ann-text')?.value;
        const r = await SignageAPI.saveAnnouncement({ title: 'Announcement', text_content: text, audio_media_id: this._lastAudioMediaId, target_type: 'all' });
        this._lastAnnId = r.id; this.toast('Saved');
      }
      if (act === 'play-ann' && this._lastAnnId) {
        await SignageAPI.playNowAnnouncement(this._lastAnnId);
        this.toast('Announcement sent to screens');
      }
    };
  }
};
SignageApp.init();

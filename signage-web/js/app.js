const SignageApp = {
  view: 'login', tab: 'dashboard', dash: null, user: null,
  _editPlaylist: null, _editMusic: null, _previewTimer: null, _dragIdx: null,

  esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },
  toast(m, t) { const e = document.createElement('div'); e.className = `toast ${t === 'error' ? 'error' : ''}`; e.textContent = m; document.getElementById('toast-root').appendChild(e); setTimeout(() => e.remove(), 3500); },

  tabs() {
    return ['dashboard', 'screens', 'media', 'playlists', 'menus', 'music', 'schedules', 'groups', 'publish', 'emergency', 'announce', 'audit', 'tests'];
  },

  async init() {
    this.view = 'login';
    this.render();
    if (localStorage.getItem('signage_token')) {
      try {
        this.dash = await SignageAPI.dashboard();
        this.user = JSON.parse(localStorage.getItem('signage_user') || '{}');
        this.view = 'main';
        this.render();
      } catch (_) {
        localStorage.removeItem('signage_token');
        this.view = 'login';
        this.render();
      }
    }
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
        <div class="signage-nav">${this.tabs().map((t) =>
          `<button class="${this.tab === t ? 'active' : ''}" data-tab="${t}">${t}</button>`).join('')}</div>
        <div id="sg-body"></div><div id="sg-modal" class="sg-modal hidden"></div>`;
      this.renderTab();
    }
    this.bind();
  },

  renderTab() {
    const body = document.getElementById('sg-body');
    if (!body) return;
    const fn = {
      dashboard: 'tabDashboard', screens: 'tabScreens', media: 'tabMedia', playlists: 'tabPlaylists',
      menus: 'tabMenus', music: 'tabMusic', schedules: 'tabSchedules', groups: 'tabGroups',
      publish: 'tabPublish', emergency: 'tabEmergency', announce: 'tabAnnounce', audit: 'tabAudit', tests: 'tabTests'
    }[this.tab];
    if (fn && this[fn]) this[fn](body);
  },

  tabDashboard(body) {
    const devs = this.dash?.devices || [];
    body.innerHTML = `<div class="portal-card"><h2>Screen status</h2>
      ${devs.map((d) => `<div class="screen-card ${d.status}"><strong>${this.esc(d.name)}</strong> — ${this.esc(d.status)}
        <br><span class="muted">${this.esc(d.location || '')} · ${this.esc(d.current_playlist_name || '—')} · ${this.esc(d.last_heartbeat || 'never')}</span>
        <button class="btn secondary" data-act="diag" data-id="${d.id}">Diagnostics</button></div>`).join('') || '<p class="muted">No screens paired yet.</p>'}</div>`;
  },

  async tabScreens(body) {
    body.innerHTML = '<p class="muted">Loading…</p>';
    const pending = await SignageAPI.pendingPairings().catch(() => []);
    const devs = await SignageAPI.listDevices().catch(() => this.dash?.devices || []);
    const groups = await SignageAPI.listScreenGroups().catch(() => []);
    body.innerHTML = `<div class="portal-card"><h2>Pending pairing</h2>
      ${(pending || []).map((p) => {
        const meta = typeof p.device_meta === 'string' ? JSON.parse(p.device_meta || '{}') : (p.device_meta || {});
        return `<div class="screen-card"><strong>Code: ${this.esc(p.pairing_code)}</strong> — ${this.esc(meta.platform || 'Unknown')}
          <div style="margin-top:8px"><button class="btn" data-act="approve" data-code="${p.pairing_code}">Approve</button>
          <button class="btn secondary" data-act="reject" data-code="${p.pairing_code}">Reject</button></div></div>`;
      }).join('') || '<p class="muted">No pending codes.</p>'}
      <h2 style="margin-top:16px">Paired screens</h2>
      ${devs.map((d) => `<div class="screen-card ${d.status}"><strong>${this.esc(d.name)}</strong> (${this.esc(d.location || '')})
        <select data-act="set-group" data-id="${d.id}"><option value="">No group</option>
          ${groups.map((g) => `<option value="${g.id}" ${d.group_id == g.id ? 'selected' : ''}>${this.esc(g.name)}</option>`).join('')}</select>
        <button class="btn secondary" data-act="sync" data-id="${d.id}">Sync</button>
        <button class="btn secondary" data-act="reload" data-id="${d.id}">Reload</button>
        <button class="btn secondary" data-act="diag" data-id="${d.id}">Diagnostics</button>
        <button class="btn secondary" data-act="revoke" data-id="${d.id}">Revoke</button></div>`).join('')}</div>`;
  },

  tabMedia(body) {
    body.innerHTML = `<div class="portal-card"><h2>Upload media</h2>
      <input type="file" id="sg-file" accept="image/*,video/*,audio/*" multiple>
      <select id="sg-cat"><option value="general">General</option><option value="food">Food</option><option value="promo">Promotion</option><option value="music">Music</option></select>
      <input type="search" id="sg-media-q" placeholder="Search…">
      <h2 style="margin-top:16px">Library</h2><div id="sg-media-list" class="media-grid muted">Loading…</div></div>`;
    this.loadMediaList();
    document.getElementById('sg-file')?.addEventListener('change', (e) => this.uploadFiles(e.target.files));
    document.getElementById('sg-media-q')?.addEventListener('input', () => this.loadMediaList());
  },

  async loadMediaList() {
    const list = document.getElementById('sg-media-list');
    if (!list) return;
    const q = document.getElementById('sg-media-q')?.value || '';
    const items = await SignageAPI.listMedia(q ? { q } : {});
    const tok = SignageAPI.token();
    list.innerHTML = (items || []).map((m) => `<div class="media-card" draggable="true" data-media-id="${m.id}" data-media-type="${m.media_type}">
      ${m.media_type === 'image' ? `<img src="/signage-media/${m.id}?token=${encodeURIComponent(tok)}" alt="">` : `<div class="media-icon">${m.media_type}</div>`}
      <div class="media-title">${this.esc(m.title)}</div>
      <div class="media-actions">
        ${m.media_type === 'video' ? `<button class="btn secondary" data-act="thumb" data-id="${m.id}">Thumb</button>` : ''}
        <button class="btn secondary" data-act="del-media" data-id="${m.id}">Delete</button></div></div>`).join('') || 'No media yet';
    list.querySelectorAll('[draggable]').forEach((el) => {
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('media-id', el.dataset.mediaId); });
    });
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

  async tabPlaylists(body) {
    const pls = this.dash?.playlists || [];
    if (!this._editPlaylist) {
      body.innerHTML = `<div class="portal-card"><button class="btn" data-act="new-playlist">New playlist</button>
        <ul class="pl-list">${pls.map((p) => `<li><span>${this.esc(p.name)} (v${p.version})</span>
          <button class="btn secondary" data-act="edit-pl" data-id="${p.id}">Edit</button>
          <button class="btn secondary" data-act="preview-pl" data-id="${p.id}">Preview</button></li>`).join('') || '<li class="muted">No playlists</li>'}</ul></div>`;
      return;
    }
    const pl = this._editPlaylist;
    const media = await SignageAPI.listMedia();
    const menus = await SignageAPI.listMenus();
    body.innerHTML = `<div class="portal-card"><h2>Edit: ${this.esc(pl.name)}</h2>
      <label>Name<input id="pl-name" value="${this.esc(pl.name)}"></label>
      <label><input type="checkbox" id="pl-shuffle" ${pl.shuffle ? 'checked' : ''}> Shuffle</label>
      <div class="grid-2"><div><h3>Available media</h3><div id="pl-pool" class="drop-zone">
        ${media.map((m) => `<div class="pl-item" draggable="true" data-drag-type="media" data-id="${m.id}">${this.esc(m.title)} <span class="badge">${m.media_type}</span></div>`).join('')}
      </div></div>
      <div><h3>Playlist (drag to reorder)</h3><div id="pl-items" class="drop-zone playlist-builder">
        ${(pl.items || []).map((it, i) => this.playlistItemHtml(it, i)).join('')}
      </div></div></div>
      <div style="margin-top:12px"><button class="btn" data-act="save-pl">Save playlist</button>
      <button class="btn secondary" data-act="preview-pl" data-id="${pl.id || ''}">Preview</button>
      <button class="btn secondary" data-act="cancel-pl">Cancel</button>
      <button class="btn secondary" data-act="add-menu-pl">Add menu slide</button></div></div>`;
    this.bindPlaylistDnD();
  },

  playlistItemHtml(it, i) {
    const label = it.menu_name || it.media_title || `Item ${i + 1}`;
    return `<div class="pl-item" draggable="true" data-drag-type="playlist" data-idx="${i}">
      <span class="drag-handle">☰</span> ${this.esc(label)}
      <input type="number" min="3" max="120" value="${it.duration_seconds || 8}" data-field="dur" data-idx="${i}" style="width:60px"> sec
      <button data-act="rm-pl-item" data-idx="${i}">×</button></div>`;
  },

  bindPlaylistDnD() {
    const pool = document.getElementById('pl-pool');
    const items = document.getElementById('pl-items');
    [pool, items].forEach((zone) => {
      if (!zone) return;
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault(); zone.classList.remove('drag-over');
        const type = e.dataTransfer.getData('drag-type') || e.target.closest('[data-drag-type]')?.dataset.dragType;
        const mediaId = e.dataTransfer.getData('media-id');
        if (mediaId && zone.id === 'pl-items') {
          this._editPlaylist.items = this._editPlaylist.items || [];
          this._editPlaylist.items.push({ item_type: 'media', media_id: Number(mediaId), duration_seconds: 8, media_title: `Media #${mediaId}` });
          this.tabPlaylists(document.getElementById('sg-body'));
        }
        const fromIdx = e.dataTransfer.getData('from-idx');
        if (fromIdx !== '' && zone.id === 'pl-items') {
          const arr = this._editPlaylist.items;
          const [moved] = arr.splice(Number(fromIdx), 1);
          const target = e.target.closest('[data-idx]');
          const toIdx = target ? Number(target.dataset.idx) : arr.length;
          arr.splice(toIdx, 0, moved);
          this.tabPlaylists(document.getElementById('sg-body'));
        }
      });
    });
    document.querySelectorAll('#pl-pool .pl-item, #pl-items .pl-item').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('drag-type', el.dataset.dragType);
        if (el.dataset.id) e.dataTransfer.setData('media-id', el.dataset.id);
        if (el.dataset.idx != null) e.dataTransfer.setData('from-idx', el.dataset.idx);
      });
    });
  },

  async tabMenus(body) {
    body.innerHTML = `<div class="portal-card"><button class="btn" data-act="new-menu">New menu</button>
      <button class="btn secondary" data-act="sync-menu">Sync from POS</button><div id="sg-menus" class="muted" style="margin-top:12px">Loading…</div></div>`;
    const menus = await SignageAPI.listMenus();
    document.getElementById('sg-menus').innerHTML = (menus || []).map((m) =>
      `<div>${this.esc(m.name)} v${m.version} <button class="btn secondary" data-act="sync-menu-id" data-id="${m.id}">Sync POS</button></div>`).join('') || 'No menus';
  },

  async tabMusic(body) {
    const apls = await SignageAPI.listAudioPlaylists().catch(() => []);
    const media = (await SignageAPI.listMedia({ media_type: 'audio' })).concat(await SignageAPI.listMedia());
    const audioMedia = media.filter((m) => m.media_type === 'audio');
    body.innerHTML = `<div class="portal-card"><h2>Music Centre</h2>
      <p class="muted">Music plays independently from visual playlists on each screen.</p>
      <button class="btn" data-act="new-music-pl">New music playlist</button>
      <ul>${apls.map((a) => `<li>${this.esc(a.name)} (${(a.items || []).length} tracks)
        <button class="btn secondary" data-act="edit-music" data-id="${a.id}">Edit</button></li>`).join('') || '<li class="muted">No music playlists</li>'}</ul>
      ${this._editMusic ? `<h3>Edit: ${this.esc(this._editMusic.name)}</h3>
        <label>Name<input id="music-name" value="${this.esc(this._editMusic.name)}"></label>
        <div class="drop-zone" id="music-tracks">${(this._editMusic.items || []).map((it, i) =>
          `<div class="pl-item" data-idx="${i}">Track media #${it.media_id || it} <button data-act="rm-music" data-idx="${i}">×</button></div>`).join('')}</div>
        <select id="music-add">${audioMedia.map((m) => `<option value="${m.id}">${this.esc(m.title)}</option>`).join('')}</select>
        <button class="btn secondary" data-act="add-music-track">Add track</button>
        <button class="btn" data-act="save-music">Save</button>` : ''}</div>`;
  },

  async tabSchedules(body) {
    const schedules = await SignageAPI.listSchedules();
    const pls = this.dash?.playlists || [];
    const devs = this.dash?.devices || [];
    const groups = this.dash?.groups || [];
    body.innerHTML = `<div class="portal-card"><h2>Schedules</h2>
      <div class="grid-2"><div>
        <h3>Create / edit schedule</h3>
        <label>Name<input id="sch-name"></label>
        <label>Playlist<select id="sch-pl">${pls.map((p) => `<option value="${p.id}">${this.esc(p.name)}</option>`).join('')}</select></label>
        <label>Target<select id="sch-target"><option value="all">All screens</option>
          ${groups.map((g) => `<option value="group:${g.id}">Group: ${this.esc(g.name)}</option>`).join('')}
          ${devs.map((d) => `<option value="device:${d.id}">TV: ${this.esc(d.name)}</option>`).join('')}
        </select></label>
        <label>Days<input id="sch-days" placeholder="mon,tue,wed,thu,fri,sat,sun" value="mon,tue,wed,thu,fri,sat,sun"></label>
        <label>Start time<input type="time" id="sch-start" value="08:00"></label>
        <label>End time<input type="time" id="sch-end" value="12:00"></label>
        <label>Start date<input type="date" id="sch-start-date"></label>
        <label>End date<input type="date" id="sch-end-date"></label>
        <label>Priority<select id="sch-priority"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
        <button class="btn" data-act="save-schedule">Save schedule</button>
      </div><div><h3>Active schedules</h3>
        ${schedules.map((s) => `<div class="screen-card"><strong>${this.esc(s.name)}</strong> ${s.start_time}–${s.end_time} · ${s.priority}
          <button class="btn secondary" data-act="del-schedule" data-id="${s.id}">Delete</button></div>`).join('') || '<p class="muted">No schedules yet</p>'}
      </div></div></div>`;
  },

  async tabGroups(body) {
    const groups = await SignageAPI.listScreenGroups();
    body.innerHTML = `<div class="portal-card"><h2>Screen groups</h2>
      <label>Group name<input id="grp-name"></label><button class="btn" data-act="save-group">Create group</button>
      <ul style="margin-top:12px">${groups.map((g) => `<li>${this.esc(g.name)} — ${g.device_count || 0} screens</li>`).join('') || '<li class="muted">No groups</li>'}</ul></div>`;
  },

  tabPublish(body) {
    const pls = this.dash?.playlists || [];
    const groups = this.dash?.groups || [];
    const devs = this.dash?.devices || [];
    body.innerHTML = `<div class="portal-card"><h2>Publish to screens</h2>
      <label>Playlist<select id="pub-pl">${pls.map((p) => `<option value="${p.id}">${this.esc(p.name)}</option>`).join('')}</select></label>
      <label>Target type<select id="pub-target-type">
        <option value="all">All TVs</option><option value="group">Screen group</option><option value="devices">Selected TVs</option>
      </select></label>
      <div id="pub-target-detail">
        <select id="pub-group" class="hidden">${groups.map((g) => `<option value="${g.id}">${this.esc(g.name)}</option>`).join('')}</select>
        <div id="pub-devices">${devs.map((d) => `<label><input type="checkbox" value="${d.id}"> ${this.esc(d.name)}</label>`).join('')}</div>
      </div>
      <button class="btn secondary" data-act="preview-pub-pl">Preview</button>
      <button class="btn" data-act="publish">PUBLISH TO SCREENS</button></div>`;
    document.getElementById('pub-target-type')?.addEventListener('change', (e) => {
      const v = e.target.value;
      document.getElementById('pub-group')?.classList.toggle('hidden', v !== 'group');
      document.getElementById('pub-devices')?.classList.toggle('hidden', v !== 'devices');
    });
  },

  tabEmergency(body) {
    const pls = this.dash?.playlists || [];
    const groups = this.dash?.groups || [];
    const devs = this.dash?.devices || [];
    body.innerHTML = `<div class="portal-card warn-card"><h2>⚠ Emergency override</h2>
      <p class="muted">Immediately overrides normal content. Auto-resumes when cancelled or expired.</p>
      <label>Emergency playlist<select id="em-pl">${pls.map((p) => `<option value="${p.id}">${this.esc(p.name)}</option>`).join('')}</select></label>
      <label>Target<select id="em-target"><option value="all">All screens</option>
        ${groups.map((g) => `<option value="group:${g.id}">Group: ${this.esc(g.name)}</option>`).join('')}
        ${devs.map((d) => `<option value="device:${d.id}">TV: ${this.esc(d.name)}</option>`).join('')}
      </select></label>
      <label>Duration (minutes)<input type="number" id="em-mins" value="15" min="1"></label>
      <button class="btn warn" data-act="emergency-publish">PUBLISH EMERGENCY</button>
      <button class="btn secondary" data-act="emergency-cancel">Cancel all emergencies</button></div>`;
  },

  tabAnnounce(body) {
    body.innerHTML = `<div class="portal-card"><h2>Voice Announcement Centre</h2>
      <textarea id="ann-text" placeholder="Today's special is half chicken and chips for R90."></textarea>
      <label>Target<select id="ann-target"><option value="all">All screens</option></select></label>
      <button class="btn" data-act="ai-voice">Generate AI voice</button>
      <button class="btn secondary" data-act="save-ann">Save</button>
      <button class="btn warn" data-act="play-ann">PLAY NOW</button>
      <p class="muted">Music ducks automatically and resumes same track/position on player.</p></div>`;
  },

  async tabAudit(body) {
    body.innerHTML = '<p class="muted">Loading audit log…</p>';
    const logs = await SignageAPI.listAuditLogs(100);
    body.innerHTML = `<div class="portal-card"><h2>Audit log</h2>
      <table class="audit-table"><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th></tr>
      ${(logs || []).map((l) => `<tr><td>${this.esc(l.created_at)}</td><td>${this.esc(l.user_name)}</td>
        <td>${this.esc(l.action)}</td><td>${this.esc(l.details_json || '')}</td></tr>`).join('')}
      </table></div>`;
  },

  async tabTests(body) {
    body.innerHTML = '<p class="muted">Running signage test suite…</p>';
    try {
      const r = await SignageAPI.runTests();
      body.innerHTML = `<div class="portal-card"><h2>Automated tests</h2>
        <p>Passed: <b>${r.passed}</b> · Failed: <b>${r.failed}</b> · Warnings: <b>${r.warnings}</b></p>
        <table class="audit-table"><tr><th>Test</th><th>Status</th><th>Message</th><th>ms</th></tr>
        ${(r.results || []).map((t) => `<tr class="test-${t.status}"><td>${this.esc(t.label)}</td><td>${t.status}</td>
          <td>${this.esc(t.message)}</td><td>${t.duration_ms}</td></tr>`).join('')}
        </table><button class="btn secondary" data-act="rerun-tests">Re-run</button></div>`;
    } catch (e) {
      body.innerHTML = `<div class="portal-card"><p class="error">Tests failed: ${this.esc(e.message)}</p></div>`;
    }
  },

  async showPreview(playlistId) {
    const modal = document.getElementById('sg-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.innerHTML = `<div class="sg-modal-inner"><h2>Preview</h2><div id="preview-stage" class="preview-stage"></div>
      <button class="btn secondary" data-act="close-preview">Close</button>
      <button class="btn" data-act="confirm-publish">Publish</button></div>`;
    const manifest = await SignageAPI.previewPlaylist(playlistId);
    const items = manifest.playlist?.items || [];
    const tok = SignageAPI.token();
    let idx = 0;
    const stage = document.getElementById('preview-stage');
    const ctx = {
      defaultTransition: 'fade', orientation: 'landscape',
      resolveUrl: (url) => `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(tok)}`
    };
    const show = async () => {
      if (!items.length) { stage.innerHTML = '<p>Empty playlist</p>'; return; }
      const result = await SignageRenderer.showItem(stage, items[idx], ctx);
      clearTimeout(this._previewTimer);
      if (result.type === 'video' && result.element) result.element.onended = () => { idx = (idx + 1) % items.length; show(); };
      else this._previewTimer = setTimeout(() => { idx = (idx + 1) % items.length; show(); }, result.duration_ms || 8000);
    };
    show();
  },

  async showDiagnostics(deviceId) {
    const d = await SignageAPI.getDeviceDiagnostics(deviceId);
    const modal = document.getElementById('sg-modal');
    modal.classList.remove('hidden');
    modal.innerHTML = `<div class="sg-modal-inner"><h2>Diagnostics: ${this.esc(d.device?.name)}</h2>
      <pre>${this.esc(JSON.stringify(d, null, 2))}</pre>
      <button class="btn secondary" data-act="close-preview">Close</button></div>`;
  },

  bind() {
    document.getElementById('app')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      const tab = e.target.closest('[data-tab]');
      if (tab) { this.tab = tab.dataset.tab; document.querySelectorAll('.signage-nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === this.tab)); this.renderTab(); return; }
      if (!btn) return;
      const act = btn.dataset.act;
      try {
        if (act === 'login') {
          const r = await SignageAPI.login(document.getElementById('sg-user').value.trim(), document.getElementById('sg-pass').value);
          localStorage.setItem('signage_token', r.token);
          localStorage.setItem('signage_user', JSON.stringify(r.user));
          this.user = r.user; await this.refresh(); this.view = 'main'; this.render();
        } else if (act === 'logout') { await SignageAPI.logout().catch(() => {}); localStorage.removeItem('signage_token'); this.view = 'login'; this.render(); }
        else if (act === 'approve') {
          const name = prompt('Screen name:', 'Counter TV'); if (!name) return;
          await SignageAPI.approvePairing(btn.dataset.code, { name, location: prompt('Location:') || '' });
          this.toast('Approved', 'success'); await this.refresh(); this.tab = 'screens'; this.render();
        } else if (act === 'reject') { await SignageAPI.rejectPairing(btn.dataset.code); this.toast('Rejected'); this.renderTab(); }
        else if (act === 'sync') { await SignageAPI.remoteCommand(Number(btn.dataset.id), 'sync', {}); this.toast('Sync queued'); }
        else if (act === 'reload') { await SignageAPI.remoteCommand(Number(btn.dataset.id), 'reload', {}); this.toast('Reload queued'); }
        else if (act === 'revoke') { if (confirm('Revoke device?')) { await SignageAPI.revokeDevice(Number(btn.dataset.id)); await this.refresh(); this.render(); } }
        else if (act === 'diag') { await this.showDiagnostics(Number(btn.dataset.id)); }
        else if (act === 'new-playlist') { this._editPlaylist = { name: 'New Playlist', items: [], shuffle: false }; this.renderTab(); }
        else if (act === 'edit-pl') {
          this._editPlaylist = await SignageAPI.getPlaylist(Number(btn.dataset.id));
          this.renderTab();
        } else if (act === 'cancel-pl') { this._editPlaylist = null; this.renderTab(); }
        else if (act === 'save-pl') {
          const items = (this._editPlaylist.items || []).map((it, i) => {
            const dur = document.querySelector(`[data-field="dur"][data-idx="${i}"]`);
            return { ...it, duration_seconds: Number(dur?.value) || it.duration_seconds || 8 };
          });
          await SignageAPI.savePlaylist({ id: this._editPlaylist.id, name: document.getElementById('pl-name')?.value || this._editPlaylist.name, shuffle: document.getElementById('pl-shuffle')?.checked, items });
          this._editPlaylist = null; this.toast('Saved', 'success'); await this.refresh(); this.render();
        } else if (act === 'rm-pl-item') {
          this._editPlaylist.items.splice(Number(btn.dataset.idx), 1); this.renderTab();
        } else if (act === 'add-menu-pl') {
          const menus = await SignageAPI.listMenus();
          const id = menus[0]?.id; if (!id) return this.toast('Create a menu first', 'error');
          this._editPlaylist.items.push({ item_type: 'menu', menu_id: id, duration_seconds: 15, menu_name: menus[0].name });
          this.renderTab();
        } else if (act === 'preview-pl' || act === 'preview-pub-pl') {
          const id = Number(btn.dataset.id) || Number(document.getElementById('pub-pl')?.value);
          if (id) await this.showPreview(id);
        } else if (act === 'close-preview') { clearTimeout(this._previewTimer); document.getElementById('sg-modal')?.classList.add('hidden'); }
        else if (act === 'confirm-publish') { document.getElementById('sg-modal')?.classList.add('hidden'); this.tab = 'publish'; this.render(); }
        else if (act === 'publish') {
          const playlist_id = Number(document.getElementById('pub-pl')?.value);
          const tt = document.getElementById('pub-target-type')?.value || 'all';
          let target_type = 'all'; let target_ids = [];
          if (tt === 'group') { target_type = 'group'; target_ids = [Number(document.getElementById('pub-group')?.value)]; }
          if (tt === 'devices') {
            target_type = 'devices';
            target_ids = [...document.querySelectorAll('#pub-devices input:checked')].map((c) => Number(c.value));
          }
          if (!confirm('Publish to screens?')) return;
          const r = await SignageAPI.publish({ playlist_id, target_type, target_ids, name: 'Publication' });
          this.toast(`Published: ${r.status}`, r.status === 'failed' ? 'error' : 'success');
        } else if (act === 'save-schedule') {
          const target = document.getElementById('sch-target')?.value || 'all';
          let target_type = 'all'; let target_id = null;
          if (target.startsWith('group:')) { target_type = 'group'; target_id = Number(target.split(':')[1]); }
          if (target.startsWith('device:')) { target_type = 'device'; target_id = Number(target.split(':')[1]); }
          const r = await SignageAPI.saveSchedule({
            name: document.getElementById('sch-name')?.value,
            playlist_id: Number(document.getElementById('sch-pl')?.value),
            target_type, target_id,
            day_of_week: document.getElementById('sch-days')?.value,
            start_time: document.getElementById('sch-start')?.value,
            end_time: document.getElementById('sch-end')?.value,
            start_date: document.getElementById('sch-start-date')?.value || null,
            end_date: document.getElementById('sch-end-date')?.value || null,
            priority: document.getElementById('sch-priority')?.value
          });
          if (r.conflicts?.length && !confirm(`Conflicts with: ${r.conflicts.map((c) => c.name).join(', ')}. Save anyway?`)) return;
          if (r.success === false) return this.toast(r.message || 'Conflict', 'error');
          this.toast('Schedule saved', 'success'); this.renderTab();
        } else if (act === 'del-schedule') { await SignageAPI.deleteSchedule(Number(btn.dataset.id)); this.renderTab(); }
        else if (act === 'save-group') {
          await SignageAPI.saveScreenGroup({ name: document.getElementById('grp-name')?.value });
          this.toast('Group created'); await this.refresh(); this.renderTab();
        } else if (act === 'emergency-publish') {
          const target = document.getElementById('em-target')?.value || 'all';
          let target_type = 'all'; let target_ids = [];
          if (target.startsWith('group:')) { target_type = 'group'; target_ids = [Number(target.split(':')[1])]; }
          if (target.startsWith('device:')) { target_type = 'devices'; target_ids = [Number(target.split(':')[1])]; }
          if (!confirm('Publish EMERGENCY content?')) return;
          await SignageAPI.publishEmergency({ playlist_id: Number(document.getElementById('em-pl')?.value), target_type, target_ids, duration_minutes: Number(document.getElementById('em-mins')?.value) || 15 });
          this.toast('Emergency published', 'success');
        } else if (act === 'emergency-cancel') {
          await SignageAPI.cancelEmergency('all', []);
          this.toast('Emergency cancelled');
        } else if (act === 'new-menu') {
          const name = prompt('Menu name:'); if (!name) return;
          await SignageAPI.saveMenu({ name, title_text: name, items: [] }); this.toast('Created'); this.renderTab();
        } else if (act === 'sync-menu' || act === 'sync-menu-id') {
          const menus = await SignageAPI.listMenus();
          const id = act === 'sync-menu-id' ? Number(btn.dataset.id) : menus[0]?.id;
          if (!id) return this.toast('Create menu first', 'error');
          await SignageAPI.syncMenuFromProducts(id); this.toast('Synced');
        } else if (act === 'del-media') { if (confirm('Delete?')) { await SignageAPI.deleteMedia(Number(btn.dataset.id)); this.loadMediaList(); } }
        else if (act === 'thumb') { const r = await SignageAPI.tryThumbnail(Number(btn.dataset.id)); this.toast(r.message || (r.success ? 'Done' : 'Failed'), r.success ? 'success' : 'error'); }
        else if (act === 'ai-voice') {
          const text = document.getElementById('ann-text')?.value; if (!text) return;
          const r = await SignageAPI.generateAiVoice(text);
          if (r.status === 'NOT_IMPLEMENTED') this.toast(r.message, 'error');
          else { this._lastAudioMediaId = r.media_id; this.toast('AI voice ready'); }
        } else if (act === 'save-ann') {
          const r = await SignageAPI.saveAnnouncement({ title: 'Announcement', text_content: document.getElementById('ann-text')?.value, audio_media_id: this._lastAudioMediaId, target_type: 'all' });
          this._lastAnnId = r.id; this.toast('Saved');
        } else if (act === 'play-ann' && this._lastAnnId) {
          await SignageAPI.playNowAnnouncement(this._lastAnnId);
          this.toast('Announcement sent');
        } else if (act === 'new-music-pl') { this._editMusic = { name: 'Music Playlist', items: [] }; this.renderTab(); }
        else if (act === 'edit-music') {
          const apls = await SignageAPI.listAudioPlaylists();
          this._editMusic = apls.find((a) => a.id === Number(btn.dataset.id)) || { items: [] };
          this.renderTab();
        } else if (act === 'add-music-track') {
          this._editMusic.items = this._editMusic.items || [];
          this._editMusic.items.push(Number(document.getElementById('music-add')?.value));
          this.renderTab();
        } else if (act === 'rm-music') { this._editMusic.items.splice(Number(btn.dataset.idx), 1); this.renderTab(); }
        else if (act === 'save-music') {
          await SignageAPI.saveAudioPlaylist({ id: this._editMusic.id, name: document.getElementById('music-name')?.value, items: this._editMusic.items.map((i) => i.media_id || i) });
          this._editMusic = null; this.toast('Music playlist saved'); this.renderTab();
        } else if (act === 'rerun-tests') { this.tab = 'tests'; this.renderTab(); }
      } catch (err) { this.toast(err.message, 'error'); }
    });

    document.getElementById('app')?.addEventListener('change', async (e) => {
      const sel = e.target.closest('[data-act="set-group"]');
      if (!sel) return;
      await SignageAPI.saveDevice({ id: Number(sel.dataset.id), group_id: sel.value ? Number(sel.value) : null, name: this.dash?.devices?.find((d) => d.id == sel.dataset.id)?.name || 'Screen' });
      this.toast('Group updated');
    });
  }
};
SignageApp.init();

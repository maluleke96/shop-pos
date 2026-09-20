/* Simple Radio Studio — music file to listeners + mic voice via WebRTC */
const RadioStudio = {
  view: 'login',
  user: null,
  access: {},
  snap: null,
  error: '',
  busy: false,
  panel: 'music',
  _poll: 0,
  _livePoll: 0,
  _built: false,
  _peers: new Map(),
  _micStream: null,
  _ctx: null,
  _micGain: null,
  _analyser: null,
  _speaking: false,
  _meterRaf: 0,
  _localPaused: false,
  _voiceRec: null,
  _voiceTimer: 0,
  _voiceBusy: false,

  init() {
    try { this.user = JSON.parse(localStorage.getItem('radio_studio_user') || 'null'); } catch (_) { this.user = null; }
    if (RadioStudioAPI.token() && this.user) {
      this.view = 'console';
      this.bootstrap();
    } else this.renderLogin();
  },

  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  },

  fmtDur(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n <= 0) return '—';
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  },

  toast(msg, type) {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast${type === 'error' ? ' error' : ''}`;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  },

  origin() { return (location.origin || '').replace(/\/$/, ''); },
  mediaUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.origin()}${path.startsWith('/') ? path : `/${path}`}`;
  },

  can(k) {
    if (this.access?.any === false) return false;
    return !!this.access?.[k];
  },

  isLive() {
    return !!Number(this.snap?.broadcast?.go_live) || this.snap?.station?.station?.status === 'live';
  },

  async bootstrap() {
    try {
      this.snap = await RadioStudioAPI.snapshot();
      this.user = this.snap.user || this.user;
      this.access = this.snap.access || {};
      localStorage.setItem('radio_studio_user', JSON.stringify(this.user));
      this.view = 'console';
      this.error = '';
      this.buildShell();
      this.paint();
      this.startPoll();
    } catch (err) {
      this.forceLogin(err.message);
    }
  },

  startPoll() {
    if (this._poll) clearInterval(this._poll);
    this._poll = setInterval(async () => {
      try {
        await RadioStudioAPI.check();
        this.snap = await RadioStudioAPI.snapshot();
        this.access = this.snap.access || this.access;
        this.paint();
      } catch (err) {
        this.forceLogin(err.message);
      }
    }, 4000);
  },

  forceLogin(msg) {
    this.stopMicAndPeers();
    RadioStudioAPI.setToken('');
    localStorage.removeItem('radio_studio_user');
    this.view = 'login';
    this._built = false;
    this.error = msg || '';
    this.renderLogin();
  },

  renderLogin() {
    document.getElementById('app').innerHTML = `
      <div class="login-wrap">
        <div class="card">
          <div class="brand">
            <div style="font-size:2rem">🎙️</div>
            <h1>Radio Studio</h1>
            <p>Sign in with your staff account</p>
          </div>
          <label>Username</label>
          <input id="rs-user" autocomplete="username">
          <label>Password</label>
          <input id="rs-pass" type="password" autocomplete="current-password">
          ${this.error ? `<div class="error">${this.esc(this.error)}</div>` : ''}
          <button class="btn btn-primary btn-block" id="rs-login" ${this.busy ? 'disabled' : ''}>
            ${this.busy ? 'Signing in…' : 'Open Studio'}
          </button>
        </div>
      </div>`;
    document.getElementById('rs-login')?.addEventListener('click', () => this.login());
    document.getElementById('rs-pass')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.login(); });
  },

  async login() {
    const u = document.getElementById('rs-user')?.value?.trim();
    const p = document.getElementById('rs-pass')?.value || '';
    if (!u || !p) { this.error = 'Enter username and password.'; this.renderLogin(); return; }
    this.busy = true; this.error = ''; this.renderLogin();
    try {
      const data = await RadioStudioAPI.login(u, p);
      RadioStudioAPI.setToken(data.token);
      this.user = data.user;
      this.access = data.access || {};
      localStorage.setItem('radio_studio_user', JSON.stringify(this.user));
      await this.bootstrap();
    } catch (err) {
      this.error = err.message || 'Login failed';
      this.busy = false;
      this.renderLogin();
      const el = document.getElementById('rs-user');
      if (el) el.value = u;
    }
  },

  async logout() {
    try { await RadioStudioAPI.logout(); } catch (_) { /* */ }
    this.forceLogin('');
  },

  buildShell() {
    document.getElementById('app').innerHTML = `
      <div class="easy-shell">
        <header class="easy-top">
          <div>
            <div class="easy-brand" id="rs-station-name">Connection Radio</div>
            <div class="muted" id="rs-op-line">Operator</div>
          </div>
          <div class="row">
            <span class="pill" id="rs-live-pill"><span class="dot"></span><span id="rs-live-text">OFF AIR</span></span>
            <span class="pill live"><span class="dot"></span><span id="rs-listeners">0 listening</span></span>
            <button class="btn btn-ghost btn-sm" id="rs-logout">Sign out</button>
          </div>
        </header>

        <section class="easy-player card">
          <div class="easy-now">
            <div class="easy-art">🎵</div>
            <div style="min-width:0;flex:1">
              <div class="muted" style="font-size:11px;letter-spacing:.08em" id="rs-np-kind">NOW PLAYING</div>
              <div class="easy-title" id="rs-np-title">Nothing playing</div>
              <div class="muted" id="rs-np-artist"></div>
              <div class="muted" id="rs-np-time" style="margin-top:4px"></div>
            </div>
          </div>
          <div class="meter"><span id="rs-meter"></span></div>
          <audio id="rs-music" preload="auto"></audio>
          <audio id="rs-advert" preload="auto"></audio>
          <div class="easy-controls">
            <button class="btn btn-primary easy-big" id="rs-play">▶ Play</button>
            <button class="btn btn-ghost easy-big" id="rs-pause">⏸ Pause</button>
            <button class="btn btn-ghost easy-big" id="rs-stop">⏹ Stop</button>
            <button class="btn btn-ghost easy-big" id="rs-next">⏭ Next</button>
            <button class="btn btn-live easy-big" id="rs-golive">🔴 GO LIVE</button>
            <button class="btn btn-ok easy-big" id="rs-mic">🎙️ Talk</button>
          </div>
          <p class="muted" id="rs-hint" style="margin:10px 0 0;text-align:center">
            Play a song → listeners hear it. Press <strong>Talk</strong> so they also hear your voice (music lowers).
          </p>
        </section>

        <div class="easy-tabs">
          <button type="button" class="easy-tab active" data-panel="music">Music</button>
          <button type="button" class="easy-tab" data-panel="playlist">Playlist</button>
          <button type="button" class="easy-tab" data-panel="ads">Adverts</button>
          <button type="button" class="easy-tab" data-panel="chat">Chat <span id="rs-chat-n"></span></button>
          <button type="button" class="easy-tab" data-panel="calls">Calls <span id="rs-call-n"></span></button>
        </div>

        <section class="card easy-panel" id="rs-panel"></section>
      </div>`;

    document.getElementById('rs-logout')?.addEventListener('click', () => this.logout());
    document.getElementById('rs-play')?.addEventListener('click', () => this.playMusic());
    document.getElementById('rs-pause')?.addEventListener('click', () => this.pauseMusic());
    document.getElementById('rs-stop')?.addEventListener('click', () => this.stopMusic());
    document.getElementById('rs-next')?.addEventListener('click', () => this.nextTrack());
    document.getElementById('rs-golive')?.addEventListener('click', () => this.toggleLive());
    document.getElementById('rs-mic')?.addEventListener('click', () => this.toggleMic());
    document.getElementById('rs-music')?.addEventListener('ended', () => this.onTrackEnded());
    document.getElementById('rs-music')?.addEventListener('timeupdate', () => this.paintTime());
    document.getElementById('rs-advert')?.addEventListener('ended', async () => {
      try {
        this.snap = await RadioStudioAPI.clearAdvert();
        const m = document.getElementById('rs-music');
        if (m) m.volume = 1;
        this.paint();
      } catch (_) { /* */ }
    });
    document.querySelectorAll('.easy-tab').forEach((b) => {
      b.addEventListener('click', () => {
        this.panel = b.dataset.panel;
        document.querySelectorAll('.easy-tab').forEach((x) => x.classList.toggle('active', x === b));
        this.paintPanel(true);
      });
    });
    this._built = true;
  },

  paint() {
    if (!this._built) return;
    const st = this.snap?.station?.station || {};
    const np = this.snap?.station?.now_playing || {};
    const advert = this.snap?.station?.advert;
    const live = this.isLive();
    const listeners = Number(this.snap?.analytics?.listeners_now || this.snap?.station?.listeners || 0);
    const op = this.user?.full_name || this.user?.username || 'Operator';
    const state = this.snap?.broadcast?.playback_state || 'stopped';

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('rs-station-name', st.name || 'Connection Radio');
    set('rs-op-line', `Host: ${op}`);
    if (advert?.title) {
      set('rs-np-kind', 'ADVERT ON AIR');
      set('rs-np-title', advert.title);
      set('rs-np-artist', np.title ? `Music under: ${np.title}` : '');
    } else {
      set('rs-np-kind', state === 'paused' ? 'PAUSED' : 'NOW PLAYING');
      set('rs-np-title', np.title || 'Nothing playing yet — pick a song');
      set('rs-np-artist', np.artist || st.programme_title || '');
    }
    set('rs-listeners', `${listeners} listening`);
    set('rs-live-text', live ? 'ON AIR' : 'OFF AIR');
    document.getElementById('rs-live-pill')?.classList.toggle('air', live);
    const gl = document.getElementById('rs-golive');
    if (gl) gl.textContent = live ? '⏹ END LIVE' : '🔴 GO LIVE';
    const mic = document.getElementById('rs-mic');
    if (mic) mic.textContent = this._micStream ? '🎙️ Mic ON' : '🎙️ Talk';
    set('rs-chat-n', (this.snap?.chat || []).length ? `(${(this.snap.chat || []).length})` : '');
    set('rs-call-n', (this.snap?.calls || []).length ? `(${(this.snap.calls || []).length})` : '');

    this.syncMusicSrc(false);
    this.paintTime();
    this.paintPanel(false);
  },

  paintTime() {
    const a = document.getElementById('rs-music');
    const el = document.getElementById('rs-np-time');
    if (!a || !el) return;
    const cur = this.fmtDur(a.currentTime);
    const tot = this.fmtDur(a.duration || this.snap?.station?.now_playing?.duration_sec);
    el.textContent = a.src ? `${cur} / ${tot}` : '';
  },

  syncMusicSrc(autoplay) {
    const a = document.getElementById('rs-music');
    const url = this.mediaUrl(this.snap?.station?.now_playing?.audio_url || this.snap?.station?.station?.play_url);
    if (!a || !url) return;
    if (a.dataset.src !== url) {
      a.dataset.src = url;
      a.src = url;
      a.load();
      if (autoplay && !this._localPaused) a.play().catch(() => {});
    } else if (autoplay && !this._localPaused) {
      a.play().catch(() => {});
    }
  },

  paintPanel(force) {
    const host = document.getElementById('rs-panel');
    if (!host) return;
    if (this.panel === 'music') this.paintMusic(host, force);
    else if (this.panel === 'playlist') this.paintPlaylist(host, force);
    else if (this.panel === 'ads') this.paintAds(host, force);
    else if (this.panel === 'chat') this.paintChat(host, force);
    else this.paintCalls(host, force);
  },

  paintMusic(host, force) {
    const tracks = this.snap?.tracks || [];
    const key = `music-${tracks.length}-${tracks[0]?.id || 0}`;
    if (!force && host.dataset.key === key) return;
    host.dataset.key = key;
    const playingId = this.snap?.station?.now_playing?.track_id;
    host.innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:10px">
        <h3 class="section-title" style="margin:0">Song list</h3>
        <div class="row">
          <input type="file" id="rs-file" accept="audio/*" class="hidden">
          <button class="btn btn-primary btn-sm" id="rs-upload">⬆ Upload song</button>
        </div>
      </div>
      <div class="list easy-list">
        ${tracks.map((t) => `
          <div class="item ${playingId === t.id ? 'playing' : ''}">
            <div style="min-width:0">
              <strong>${playingId === t.id ? '▶ ' : ''}${this.esc(t.title)}</strong>
              <div class="meta">${this.esc(t.artist || '')} · ${this.fmtDur(t.duration_sec)}${t.audio_url ? '' : ' · no file'}</div>
            </div>
            <button class="btn btn-primary btn-sm rs-play-one" data-id="${t.id}" ${t.audio_url ? '' : 'disabled'}>Play</button>
          </div>`).join('') || '<p class="muted">Upload a song to get started.</p>'}
      </div>`;
    document.getElementById('rs-upload')?.addEventListener('click', () => document.getElementById('rs-file')?.click());
    document.getElementById('rs-file')?.addEventListener('change', (e) => this.uploadTrack(e.target.files?.[0]));
    host.querySelectorAll('.rs-play-one').forEach((b) => b.addEventListener('click', () => this.playTrackId(Number(b.dataset.id))));
  },

  paintPlaylist(host, force) {
    const pls = this.snap?.playlists || [];
    const key = `pl-${pls.length}-${pls[0]?.id || 0}`;
    if (!force && host.dataset.key === key) return;
    host.dataset.key = key;
    host.innerHTML = `
      <h3 class="section-title">Playlists</h3>
      <div class="row" style="margin-bottom:10px">
        <input id="rs-pl-name" placeholder="Playlist name" style="flex:1">
        <button class="btn btn-primary btn-sm" id="rs-pl-create">Create empty</button>
      </div>
      <div class="row" style="margin-bottom:10px">
        <input type="file" id="rs-pl-files" accept="audio/*" multiple>
        <button class="btn btn-gold btn-sm" id="rs-pl-upload">⬆ Upload songs → new playlist &amp; play</button>
      </div>
      <p class="muted">Select many songs at once. They upload into a playlist and can play for a long time, one after another.</p>
      <div class="list easy-list">
        ${pls.map((pl) => {
          const items = pl.items || [];
          const total = items.reduce((s, t) => s + (Number(t.duration_sec) || 0), 0);
          return `
          <div class="item" style="flex-direction:column;align-items:stretch;gap:8px">
            <div class="row" style="justify-content:space-between">
              <strong>${this.esc(pl.name)}</strong>
              <button class="btn btn-primary btn-sm rs-pl-play" data-id="${pl.id}">▶ Play playlist</button>
            </div>
            <div class="meta">${items.length} songs · total ${this.fmtDur(total)}</div>
            <div class="muted">${items.map((t) => `${this.esc(t.title)} (${this.fmtDur(t.duration_sec)})`).join(' → ') || 'Empty'}</div>
          </div>`;
        }).join('') || '<p class="muted">No playlists yet — upload a batch above.</p>'}
      </div>`;
    document.getElementById('rs-pl-create')?.addEventListener('click', async () => {
      try {
        this.snap = await RadioStudioAPI.savePlaylist({ name: document.getElementById('rs-pl-name')?.value || 'Show playlist' });
        this.paint();
      } catch (err) { this.toast(err.message, 'error'); }
    });
    document.getElementById('rs-pl-upload')?.addEventListener('click', () => this.uploadPlaylistBatch());
    host.querySelectorAll('.rs-pl-play').forEach((b) => b.addEventListener('click', async () => {
      try {
        this.snap = await RadioStudioAPI.playPlaylist(Number(b.dataset.id));
        this._localPaused = false;
        this.syncMusicSrc(true);
        this.toast('Playlist on air');
        this.paint();
      } catch (err) { this.toast(err.message, 'error'); }
    }));
  },

  async uploadPlaylistBatch() {
    const files = [...(document.getElementById('rs-pl-files')?.files || [])];
    if (!files.length) return this.toast('Choose one or more songs', 'error');
    const name = document.getElementById('rs-pl-name')?.value || `Playlist ${new Date().toLocaleString()}`;
    try {
      this.toast(`Uploading ${files.length} songs…`);
      this.snap = await RadioStudioAPI.savePlaylist({ name });
      const pl = this.snap.playlists?.[0];
      const ids = [];
      for (const file of files) {
        const duration_sec = await RadioStudioAPI.probeDuration(file);
        const dataUrl = await RadioStudioAPI.readFileAsDataUrl(file);
        this.snap = await RadioStudioAPI.addTrack({
          title: file.name.replace(/\.[^.]+$/, ''),
          filename: file.name,
          file_data: dataUrl,
          duration_sec
        });
        const neu = this.snap.tracks?.[0];
        if (neu) ids.push(neu.id);
      }
      if (pl && ids.length) {
        this.snap = await RadioStudioAPI.savePlaylist({ id: pl.id, name, track_ids: ids });
        this.snap = await RadioStudioAPI.playPlaylist(pl.id);
        this._localPaused = false;
        this.syncMusicSrc(true);
      }
      this.toast('Playlist uploaded and playing');
      this.panel = 'playlist';
      this.paint();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  paintAds(host, force) {
    const anns = (this.snap?.announcements || []).filter((a) => a.audio_url || a.media_id);
    host.dataset.key = `ads-${anns.length}-${Date.now()}`;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const localDefault = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    host.innerHTML = `
      <h3 class="section-title">Adverts</h3>
      <p class="muted">Play now, or schedule exact date + hour:minute:second. Choose lower music or stop music completely.</p>
      <label>Advert name</label>
      <input id="rs-ad-title" placeholder="Lunch special">
      <label>Audio file</label>
      <input type="file" id="rs-ad-file" accept="audio/*">
      <label>When music is under the advert</label>
      <select id="rs-ad-music-mode">
        <option value="duck">Lower music</option>
        <option value="stop">Stop music completely</option>
      </select>
      <div class="row" style="margin-top:10px">
        <button class="btn btn-gold btn-sm" id="rs-ad-now">Play advert now</button>
      </div>
      <h3 class="section-title" style="margin-top:16px">Schedule advert (exact time)</h3>
      <label>Play at (local time)</label>
      <input id="rs-ad-when" type="datetime-local" step="1" value="${localDefault}">
      <button class="btn btn-primary btn-sm" style="margin-top:10px" id="rs-ad-sched">Schedule advert</button>
      <div class="list easy-list" style="margin-top:12px" id="rs-ad-jobs"></div>
      <div class="list easy-list" style="margin-top:12px">
        ${anns.map((a) => `
          <div class="item">
            <div><strong>${this.esc(a.title)}</strong><div class="meta">${this.fmtDur(a.duration_sec)}</div></div>
            <button class="btn btn-gold btn-sm rs-ad-play" data-id="${a.id}">Play now</button>
          </div>`).join('') || ''}
      </div>`;
    document.getElementById('rs-ad-now')?.addEventListener('click', () => this.uploadAdvert(false));
    document.getElementById('rs-ad-sched')?.addEventListener('click', () => this.uploadAdvert(true));
    host.querySelectorAll('.rs-ad-play').forEach((b) => b.addEventListener('click', async () => {
      try {
        const mode = document.getElementById('rs-ad-music-mode')?.value || 'duck';
        this.snap = await RadioStudioAPI.playAdvert({ announcement_id: Number(b.dataset.id), music_mode: mode, duck: 0.12 });
        await this.playAdvertLocal();
        this.paint();
      } catch (err) { this.toast(err.message, 'error'); }
    }));
    this.refreshAdvertJobs();
  },

  async refreshAdvertJobs() {
    const box = document.getElementById('rs-ad-jobs');
    if (!box) return;
    try {
      const res = await RadioStudioAPI.listAdvertJobs();
      const jobs = res.jobs || [];
      box.innerHTML = jobs.length
        ? jobs.map((j) => `
          <div class="item">
            <div><strong>${this.esc(j.title)}</strong>
              <div class="meta">${this.esc(j.run_at)} · ${this.esc(j.music_mode)} · ${this.esc(j.status)}</div>
            </div>
          </div>`).join('')
        : '<p class="muted">No scheduled adverts yet.</p>';
    } catch (_) { /* */ }
  },

  async uploadAdvert(schedule) {
    const file = document.getElementById('rs-ad-file')?.files?.[0];
    if (!file) return this.toast('Choose an advert audio file', 'error');
    const title = document.getElementById('rs-ad-title')?.value || file.name;
    const mode = document.getElementById('rs-ad-music-mode')?.value || 'duck';
    try {
      const duration_sec = await RadioStudioAPI.probeDuration(file);
      const dataUrl = await RadioStudioAPI.readFileAsDataUrl(file);
      if (schedule) {
        const local = document.getElementById('rs-ad-when')?.value;
        if (!local) return this.toast('Pick date and time', 'error');
        // Convert local wall-clock (with seconds) → UTC for server datetime('now') compare
        const localFull = local.length === 16 ? `${local}:00` : local;
        const asUtc = new Date(localFull);
        if (Number.isNaN(asUtc.getTime())) return this.toast('Invalid schedule time', 'error');
        const run_at = asUtc.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
        this.snap = await RadioStudioAPI.scheduleAdvert({
          title, filename: file.name, file_data: dataUrl, duration_sec,
          run_at,
          music_mode: mode,
          duck_level: 0.12
        });
        this.toast(`Advert scheduled for ${localFull}`);
      } else {
        this.snap = await RadioStudioAPI.playAdvert({
          title, filename: file.name, file_data: dataUrl, duration_sec, music_mode: mode, duck: 0.12
        });
        await this.playAdvertLocal();
        this.toast(mode === 'stop' ? 'Advert on — music stopped' : 'Advert on — music lowered');
      }
      this.paint();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  paintChat(host, force) {
    const chat = this.snap?.chat || [];
    const key = `chat-${chat.length}-${chat[chat.length - 1]?.id || 0}`;
    host.dataset.key = key;
    host.innerHTML = `
      <h3 class="section-title">Listener messages</h3>
      <div class="chat-log easy-chat" id="rs-chat-log">
        ${chat.filter((m) => !m.hidden).map((m) => `
          <div class="chat-msg ${m.is_staff ? 'staff' : ''}">
            <strong>${this.esc(m.author_name)}</strong>: ${this.esc(m.body)}
          </div>`).join('') || '<p class="muted">No messages yet.</p>'}
      </div>
      <div class="row">
        <input id="rs-reply" placeholder="Reply to listeners…" style="flex:1">
        <button class="btn btn-primary btn-sm" id="rs-send">Send</button>
      </div>`;
    const log = document.getElementById('rs-chat-log');
    if (log) log.scrollTop = log.scrollHeight;
    document.getElementById('rs-send')?.addEventListener('click', async () => {
      try {
        this.snap = await RadioStudioAPI.staffChatReply(document.getElementById('rs-reply')?.value);
        this.paint();
      } catch (err) { this.toast(err.message, 'error'); }
    });
  },

  paintCalls(host, force) {
    const tel = this.snap?.telephony || {};
    const calls = this.snap?.calls || [];
    const key = `calls-${calls.length}-${tel.configured ? 1 : 0}`;
    if (!force && host.dataset.key === key) return;
    host.dataset.key = key;
    if (!tel.configured) {
      host.innerHTML = `<h3 class="section-title">Calls</h3>
        <p>Calling service not configured — connect a provider in Admin Radio Settings.</p>
        <p class="muted">Listeners can still text in Chat.</p>`;
      return;
    }
    host.innerHTML = `
      <h3 class="section-title">Incoming calls</h3>
      <div class="list easy-list">
        ${calls.map((c) => `
          <div class="item" style="flex-direction:column;align-items:stretch;gap:8px">
            <div><strong>${this.esc(c.caller_label || c.caller_phone || 'Caller')}</strong>
              <div class="meta">${this.esc(c.status)}${c.on_air ? ' · ON AIR' : ''}</div>
            </div>
            <div class="row">
              <button class="btn btn-ghost btn-sm rs-c-priv" data-id="${c.id}">Answer privately</button>
              <button class="btn btn-ok btn-sm rs-c-air" data-id="${c.id}">Put on air</button>
              <button class="btn btn-live btn-sm rs-c-end" data-id="${c.id}">End</button>
            </div>
          </div>`).join('') || '<p class="muted">No calls right now.</p>'}
      </div>`;
    host.querySelectorAll('.rs-c-priv').forEach((b) => b.addEventListener('click', async () => {
      try {
        this.snap = await RadioStudioAPI.upsertCall({ id: Number(b.dataset.id), status: 'private', private_answer: true, on_air: false });
        this.paint();
      } catch (err) { this.toast(err.message, 'error'); }
    }));
    host.querySelectorAll('.rs-c-air').forEach((b) => b.addEventListener('click', async () => {
      try {
        this.snap = await RadioStudioAPI.upsertCall({ id: Number(b.dataset.id), status: 'on_air', on_air: true, private_answer: false });
        this.paint();
      } catch (err) { this.toast(err.message, 'error'); }
    }));
    host.querySelectorAll('.rs-c-end').forEach((b) => b.addEventListener('click', async () => {
      try {
        this.snap = await RadioStudioAPI.upsertCall({ id: Number(b.dataset.id), status: 'ended', on_air: false });
        this.paint();
      } catch (err) { this.toast(err.message, 'error'); }
    }));
  },

  async uploadTrack(file) {
    if (!file) return;
    try {
      const title = prompt('Song name', file.name.replace(/\.[^.]+$/, '')) || file.name;
      const duration_sec = await RadioStudioAPI.probeDuration(file);
      const dataUrl = await RadioStudioAPI.readFileAsDataUrl(file);
      this.snap = await RadioStudioAPI.addTrack({ title, filename: file.name, file_data: dataUrl, duration_sec });
      // Also add to first playlist if exists
      const pl = this.snap?.playlists?.[0];
      if (pl) {
        const ids = (pl.items || []).map((x) => x.id);
        const neu = this.snap.tracks?.[0];
        if (neu) ids.push(neu.id);
        this.snap = await RadioStudioAPI.savePlaylist({ id: pl.id, track_ids: ids });
      }
      this.toast('Song uploaded');
      this.paint();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async playTrackId(id) {
    try {
      this._localPaused = false;
      this.snap = await RadioStudioAPI.playTrack(id, { go_live: true });
      await RadioStudioAPI.setPlaybackState('playing');
      this.snap = await RadioStudioAPI.snapshot();
      this.syncMusicSrc(true);
      this.paint();
      this.toast('Playing for listeners');
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async playMusic() {
    const a = document.getElementById('rs-music');
    if (a?.src && this._localPaused) {
      this._localPaused = false;
      await a.play().catch((e) => this.toast(e.message, 'error'));
      try {
        await RadioStudioAPI.setPlaybackState('playing');
        this.snap = await RadioStudioAPI.snapshot();
        this.paint();
      } catch (_) { /* */ }
      return;
    }
    const tracks = this.snap?.tracks || [];
    const npId = this.snap?.station?.now_playing?.track_id;
    if (npId) {
      this._localPaused = false;
      this.syncMusicSrc(true);
      await RadioStudioAPI.setPlaybackState('playing').catch(() => {});
      return;
    }
    const first = tracks.find((t) => t.audio_url);
    if (!first) return this.toast('Upload a song first', 'error');
    await this.playTrackId(first.id);
  },

  async pauseMusic() {
    const a = document.getElementById('rs-music');
    if (a) a.pause();
    this._localPaused = true;
    try {
      await RadioStudioAPI.setPlaybackState('paused');
      this.snap = await RadioStudioAPI.snapshot();
      this.paint();
      this.toast('Paused for listeners');
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async stopMusic() {
    const a = document.getElementById('rs-music');
    if (a) { a.pause(); a.currentTime = 0; }
    this._localPaused = true;
    try {
      await RadioStudioAPI.setPlaybackState('stopped');
      this.snap = await RadioStudioAPI.snapshot();
      this.paint();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async nextTrack() {
    try {
      this._localPaused = false;
      this.snap = await RadioStudioAPI.advanceQueue();
      await RadioStudioAPI.setPlaybackState('playing');
      this.snap = await RadioStudioAPI.snapshot();
      this.syncMusicSrc(true);
      this.paint();
    } catch (_) {
      const tracks = this.snap?.tracks || [];
      const cur = this.snap?.station?.now_playing?.track_id;
      const idx = tracks.findIndex((t) => t.id === cur);
      const next = tracks[idx + 1] || tracks[0];
      if (next) await this.playTrackId(next.id);
      else this.toast('No next song', 'error');
    }
  },

  async onTrackEnded() {
    await this.nextTrack();
  },

  async playAdvertLocal() {
    const adv = this.snap?.station?.advert;
    const url = this.mediaUrl(adv?.audio_url);
    const a = document.getElementById('rs-advert');
    const m = document.getElementById('rs-music');
    if (adv?.music_mode === 'stop') {
      if (m) { m.pause(); m.volume = 0; }
    } else if (m) {
      m.volume = Number(adv?.duck) || 0.12;
    }
    if (a && url) {
      a.src = url;
      a.volume = 1;
      await a.play().catch(() => {});
    }
  },

  async toggleLive() {
    try {
      const on = !this.isLive();
      this.snap = await RadioStudioAPI.setGoLive(on);
      if (on) this.toast('ON AIR — listeners can hear your songs');
      else {
        this.stopMicAndPeers();
        this.toast('Off air');
      }
      this.paint();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async toggleMic() {
    if (this._micStream) {
      this.stopMicOnly();
      this.toast('Mic off — music back up');
      this.paint();
      return;
    }
    try {
      if (!this.isLive()) {
        this.snap = await RadioStudioAPI.setGoLive(true);
      }
      await this.startMicOnly();
      this.toast('LIVE TALK ON — your voice is going to listeners (loud)');
      this.paint();
    } catch (err) { this.toast(err.message || 'Mic blocked', 'error'); }
  },

  async startMicOnly() {
    // Record raw mic (reliable), boost locally for monitor; listeners get max volume + extra gain
    this._micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    });
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this._ctx.state === 'suspended') await this._ctx.resume();
    const micSrc = this._ctx.createMediaStreamSource(this._micStream);
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 256;
    micSrc.connect(this._analyser);
    // Loud local monitor so DJ hears themselves
    this._micGain = this._ctx.createGain();
    this._micGain.gain.value = 2.2;
    micSrc.connect(this._micGain);
    this._micGain.connect(this._ctx.destination);

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
    // Record the original mic stream (not WebAudio dest — avoids silent clips)
    const recordStream = this._micStream;

    const uploadClip = async (blob, mimeType) => {
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
        const res = await RadioStudioAPI.pushVoiceChunk({
          file_data: dataUrl,
          filename: 'voice.webm',
          duck: 0.08,
          music_volume: 0.08
        });
        const el = document.getElementById('rs-listeners');
        if (el && res?.listeners != null) el.textContent = `${res.listeners} listening`;
        const m = document.getElementById('rs-music');
        if (m) m.volume = 0.08;
      } catch (err) {
        this.toast(err.message || 'Voice upload failed', 'error');
      }
    };

    const shootClip = () => {
      if (!this._micStream) return;
      let rec;
      try {
        rec = mime
          ? new MediaRecorder(recordStream, { mimeType: mime, audioBitsPerSecond: 192000 })
          : new MediaRecorder(recordStream);
      } catch (_) {
        return;
      }
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        if (!chunks.length) return;
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        if (blob.size < 400) return;
        // Do not block the next clip if upload is slow
        uploadClip(blob, rec.mimeType);
      };
      try { rec.start(); } catch (_) { return; }
      setTimeout(() => {
        try { if (rec.state === 'recording') rec.stop(); } catch (_) { /* */ }
      }, 1100);
    };

    await RadioStudioAPI.setMicDuck({ mic_active: true, duck_level: 0.08, music_volume: 0.08 });
    const m = document.getElementById('rs-music');
    if (m) m.volume = 0.08;
    this.meterLoop();
    shootClip();
    this._voiceTimer = setInterval(shootClip, 1150);
  },

  stopMicOnly() {
    if (this._voiceTimer) { clearInterval(this._voiceTimer); this._voiceTimer = 0; }
    if (this._micStream) {
      this._micStream.getTracks().forEach((t) => t.stop());
      this._micStream = null;
    }
    this._analyser = null;
    this._speaking = false;
    this._micGain = null;
    if (this._ctx) {
      try { this._ctx.close(); } catch (_) { /* */ }
      this._ctx = null;
    }
    const m = document.getElementById('rs-music');
    if (m) m.volume = 1;
    RadioStudioAPI.stopVoice().catch(() => {});
    RadioStudioAPI.setMicDuck({ mic_active: false, duck_level: 1, music_volume: 0.85 }).catch(() => {});
  },

  meterLoop() {
    if (!this._analyser) return;
    const data = new Uint8Array(this._analyser.frequencyBinCount);
    const tick = () => {
      if (!this._analyser) return;
      this._analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length / 255;
      const meter = document.getElementById('rs-meter');
      if (meter) meter.style.width = `${Math.min(100, Math.round(avg * 180))}%`;
      this._meterRaf = requestAnimationFrame(tick);
    };
    this._meterRaf = requestAnimationFrame(tick);
  },

  startLivePeerLoop() { /* voice uses HTTP chunks now */ },

  async syncLivePeers() { /* no-op */ },

  async createOfferForPeer() { /* no-op */ },

  stopMicAndPeers() {
    if (this._livePoll) { clearInterval(this._livePoll); this._livePoll = 0; }
    this.stopMicOnly();
    if (this._meterRaf) cancelAnimationFrame(this._meterRaf);
  }
};

document.addEventListener('DOMContentLoaded', () => RadioStudio.init());

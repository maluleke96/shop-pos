/**
 * Digital Signage Player — pairing, offline cache, SSE + polling, music ducking with resume.
 */
const Player = {
  rpcUrl: () => (window.__SIGNAGE_PLAYER_CONFIG__?.rpcUrl || '/rpc').replace(/\/$/, ''),
  deviceToken: localStorage.getItem('signage_device_token') || '',
  manifest: null,
  itemIndex: 0,
  musicIndex: 0,
  musicVolume: 0.8,
  duckVolume: 0.25,
  duckFadeMs: 800,
  timer: null,
  db: null,
  eventSource: null,
  playing: false,
  musicPlaylistId: null,
  lastOnline: Date.now(),
  announceBusy: false,

  async rpc(method, args = []) {
    const res = await fetch(this.rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error(json.error || 'RPC failed');
    return json.data != null ? json.data : json;
  },

  async init() {
    await this.openDb();
    const saved = JSON.parse(localStorage.getItem('signage_playback') || '{}');
    this.itemIndex = saved.itemIndex || 0;
    this.musicIndex = saved.musicIndex || 0;
    if (this.deviceToken) {
      try {
        await this.sync();
        this.hidePair();
        this.startPlayback();
        this.startLoops();
        return;
      } catch (_) {
        const cached = await this.loadCachedManifest();
        if (cached) {
          this.manifest = cached;
          this.hidePair();
          this.startPlayback();
          this.toastStatus('Offline — cached content');
          this.startLoops();
          return;
        }
      }
    }
    await this.startPairing();
  },

  savePlaybackState() {
    localStorage.setItem('signage_playback', JSON.stringify({
      itemIndex: this.itemIndex,
      musicIndex: this.musicIndex,
      musicTime: document.getElementById('music')?.currentTime || 0
    }));
  },

  openDb() {
    return new Promise((resolve) => {
      const req = indexedDB.open('signage_player_v1', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('media'); req.result.createObjectStore('meta'); };
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror = () => resolve();
    });
  },

  idbGet(key) {
    return new Promise((resolve) => {
      if (!this.db) return resolve(null);
      const tx = this.db.transaction('meta', 'readonly');
      const r = tx.objectStore('meta').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    });
  },

  idbSet(key, val) {
    if (!this.db) return;
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(val, key);
  },

  async loadCachedManifest() { return this.idbGet('manifest'); },

  hidePair() { document.getElementById('pair').style.display = 'none'; },

  async startPairing() {
    const meta = { platform: navigator.platform, user_agent: navigator.userAgent, screen: `${screen.width}x${screen.height}` };
    const r = await this.rpc('signage:requestPairing', [meta]);
    document.getElementById('pair-code').textContent = r.pairing_code;
    const poll = setInterval(async () => {
      try {
        const st = await this.rpc('signage:pairingStatus', [r.pairing_code]);
        if (st.status === 'approved' && st.device_token) {
          clearInterval(poll);
          this.deviceToken = st.device_token;
          localStorage.setItem('signage_device_token', st.device_token);
          document.getElementById('pair-msg').textContent = 'Connected!';
          await this.sync();
          this.hidePair();
          this.startPlayback();
          this.startLoops();
        }
        if (st.status === 'rejected' || st.status === 'expired') {
          clearInterval(poll);
          document.getElementById('pair-msg').textContent = st.status;
        }
      } catch (_) { /* keep polling */ }
    }, 3000);
  },

  manifestChanged(prev, next) {
    if (!prev) return true;
    return prev.command_version !== next.command_version
      || prev.playlist?.id !== next.playlist?.id
      || prev.content_source !== next.content_source
      || prev.audio_playlist?.id !== next.audio_playlist?.id;
  },

  async sync() {
    const prev = this.manifest;
    this.manifest = await this.rpc('signage:manifest', [this.deviceToken]);
    this.idbSet('manifest', this.manifest);
    const s = this.manifest.settings || {};
    this.duckVolume = (Number(s.ducking_volume) || 25) / 100;
    this.duckFadeMs = Number(s.duck_fade_ms) || 800;
    this.musicVolume = (Number(this.manifest.device?.music_volume) || 80) / 100;
    this.updateEmergencyBanner();
    await this.cacheMedia();
    if (this.manifestChanged(prev, this.manifest)) {
      this.itemIndex = 0;
      this.startPlayback();
      this.refreshMusic();
    }
    this.lastOnline = Date.now();
    this.toastStatus(`${this.manifest.content_source || 'assigned'} · online`);
  },

  updateEmergencyBanner() {
    const el = document.getElementById('emergency-banner');
    if (!el) return;
    if (this.manifest?.content_source === 'emergency') {
      el.style.display = 'block';
      el.textContent = '⚠ EMERGENCY CONTENT ACTIVE';
    } else el.style.display = 'none';
  },

  async cacheMedia() {
    const urls = [];
    (this.manifest.playlist?.items || []).forEach((it) => { if (it.media?.url) urls.push(it.media.url); });
    (this.manifest.audio_playlist?.tracks || []).forEach((t) => { if (t.url) urls.push(t.url); });
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (res.ok && this.db) {
          const blob = await res.blob();
          const tx = this.db.transaction('media', 'readwrite');
          tx.objectStore('media').put(blob, url);
        }
      } catch (_) { /* offline skip */ }
    }
  },

  async mediaUrl(url) {
    if (!this.db) return url;
    return new Promise((resolve) => {
      const tx = this.db.transaction('media', 'readonly');
      const r = tx.objectStore('media').get(url);
      r.onsuccess = () => resolve(r.result ? URL.createObjectURL(r.result) : url);
      r.onerror = () => resolve(url);
    });
  },

  connectSSE() {
    if (!this.deviceToken || typeof EventSource === 'undefined') return;
    try { this.eventSource?.close(); } catch (_) { /* */ }
    const url = `/signage-sse/${encodeURIComponent(this.deviceToken)}`;
    this.eventSource = new EventSource(url);
    this.eventSource.addEventListener('command', () => this.pollCommands().catch(() => {}));
    this.eventSource.addEventListener('update', () => this.sync().catch(() => {}));
    this.eventSource.onerror = () => {
      try { this.eventSource?.close(); } catch (_) { /* */ }
      setTimeout(() => this.connectSSE(), 15000);
    };
  },

  startLoops() {
    const interval = (this.manifest?.settings?.heartbeat_interval_sec || 30) * 1000;
    setInterval(() => this.heartbeat().catch(() => {}), interval);
    setInterval(() => this.pollCommands().catch(() => {}), 5000);
    setInterval(() => this.sync().catch(async () => {
      const staleMin = this.manifest?.settings?.offline_stale_minutes || 5;
      const stale = Date.now() - this.lastOnline > staleMin * 60000;
      this.toastStatus(stale ? 'Offline (stale)' : 'Reconnecting…');
      const cached = await this.loadCachedManifest();
      if (cached) this.manifest = cached;
    }), 60000);
    this.connectSSE();
    this.refreshMusic();
  },

  async heartbeat() {
    const music = document.getElementById('music');
    await this.rpc('signage:heartbeat', [this.deviceToken, {
      player_version: 'web-2.0',
      current_music_track: music.src ? `${this.musicIndex}:${Math.floor(music.currentTime)}` : '',
      storage: { cached: !!this.db },
      network: { online: navigator.onLine },
      content_source: this.manifest?.content_source
    }]);
    this.lastOnline = Date.now();
    this.toastStatus(navigator.onLine ? `Online · ${this.manifest?.content_source || ''}` : 'Offline');
  },

  async pollCommands() {
    const cmds = await this.rpc('signage:getCommands', [this.deviceToken]);
    for (const c of cmds || []) {
      try {
        if (c.command === 'sync') await this.sync();
        else if (c.command === 'play_announcement') await this.playAnnouncement(c.payload);
        else if (c.command === 'pause') { clearTimeout(this.timer); document.querySelector('#stage video')?.pause(); }
        else if (c.command === 'play') this.startPlayback();
        else if (c.command === 'reload') location.reload();
        await this.rpc('signage:ackCommand', [this.deviceToken, c.id, 'ok']);
      } catch (err) {
        await this.rpc('signage:ackCommand', [this.deviceToken, c.id, 'fail']).catch(() => {});
      }
    }
  },

  refreshMusic() {
    const ap = this.manifest?.audio_playlist;
    if (!ap?.tracks?.length) return;
    if (this.musicPlaylistId === ap.id && !document.getElementById('music').paused) return;
    this.musicPlaylistId = ap.id;
    this.startMusic();
  },

  startMusic() {
    const tracks = this.manifest?.audio_playlist?.tracks || [];
    if (!tracks.length) return;
    const saved = JSON.parse(localStorage.getItem('signage_playback') || '{}');
    const startIdx = saved.musicIndex || 0;
    const startTime = saved.musicTime || 0;
    this.playMusicTrack(startIdx, startTime);
  },

  async playMusicTrack(idx, seekTo = 0) {
    const tracks = this.manifest?.audio_playlist?.tracks || [];
    if (!tracks.length) return;
    this.musicIndex = ((idx % tracks.length) + tracks.length) % tracks.length;
    const t = tracks[this.musicIndex];
    const music = document.getElementById('music');
    music.loop = false;
    music.src = await this.mediaUrl(t.url);
    music.volume = this.musicVolume;
    music.onloadedmetadata = () => {
      if (seekTo > 0 && seekTo < music.duration) music.currentTime = seekTo;
    };
    music.onended = () => {
      if (!this.announceBusy) this.playMusicTrack(this.musicIndex + 1, 0);
    };
    if (!this.announceBusy) music.play().catch(() => {});
    this.savePlaybackState();
  },

  fadeVolumePromise(el, from, to, ms) {
    return new Promise((resolve) => {
      const steps = 20;
      const step = (to - from) / steps;
      let v = from;
      let i = 0;
      const t = setInterval(() => {
        v += step;
        el.volume = Math.max(0, Math.min(1, v));
        if (++i >= steps) { clearInterval(t); el.volume = to; resolve(); }
      }, ms / steps);
    });
  },

  async playAnnouncement(payload) {
    if (!payload?.audio_media_id || this.announceBusy) return;
    this.announceBusy = true;
    const music = document.getElementById('music');
    const ann = document.getElementById('announce');
    const savedTime = music.currentTime || 0;
    const wasPlaying = !music.paused && !!music.src;
    const savedIdx = this.musicIndex;

    await this.fadeVolumePromise(music, music.volume, this.duckVolume, this.duckFadeMs);
    if (wasPlaying) music.pause();

    const url = `/signage-media/${payload.audio_media_id}?token=${encodeURIComponent(this.deviceToken)}`;
    const src = await this.mediaUrl(url);
    ann.src = src;
    ann.volume = (Number(payload.volume) || 100) / 100;

    await new Promise((resolve) => {
      ann.onended = resolve;
      ann.onerror = resolve;
      ann.play().catch(resolve);
    });

    music.currentTime = savedTime;
    this.musicIndex = savedIdx;
    await this.fadeVolumePromise(music, music.volume, this.musicVolume, this.duckFadeMs);
    if (wasPlaying) music.play().catch(() => {});
    this.announceBusy = false;
    this.savePlaybackState();
  },

  startPlayback() {
    clearTimeout(this.timer);
    this.playing = true;
    const items = this.manifest?.playlist?.items || [];
    if (!items.length) {
      document.getElementById('stage').innerHTML = '<p style="padding:40px;color:#aaa">No playlist assigned</p>';
      return;
    }
    if (this.itemIndex >= items.length) this.itemIndex = 0;
    this.showItem(items[this.itemIndex]);
  },

  async showItem(item) {
    const stage = document.getElementById('stage');
    const ctx = {
      defaultTransition: this.manifest?.settings?.default_transition || 'fade',
      orientation: this.manifest?.device?.orientation || 'landscape',
      resolveUrl: (url) => this.mediaUrl(url)
    };
    try {
      const result = await SignageRenderer.showItem(stage, item, ctx);
      this.savePlaybackState();
      if (result.type === 'video' && result.element) {
        result.element.onended = () => this.nextItem();
        result.element.onerror = () => this.nextItem();
      } else if (result.type === 'timed') {
        this.timer = setTimeout(() => this.nextItem(), result.duration_ms);
      }
    } catch (_) {
      stage.innerHTML = '<p style="padding:40px;color:#f88">Playback error — skipping</p>';
      this.timer = setTimeout(() => this.nextItem(), 3000);
    }
  },

  nextItem() {
    const items = this.manifest?.playlist?.items || [];
    if (!items.length) return;
    this.itemIndex = (this.itemIndex + 1) % items.length;
    if (this.manifest.playlist?.shuffle && this.itemIndex === 0) {
      this.itemIndex = Math.floor(Math.random() * items.length);
    }
    this.showItem(items[this.itemIndex]);
  },

  toastStatus(msg) { document.getElementById('status').textContent = msg; }
};

Player.init();

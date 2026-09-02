/**
 * Digital Signage Player — pairing, offline cache, playlist, music ducking, heartbeat.
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

  async rpc(method, args = []) {
    const res = await fetch(this.rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error(json.error || 'RPC failed');
    return json.data != null ? json.data : json;
  },

  async init() {
    await this.openDb();
    if (this.deviceToken) {
      try { await this.sync(); this.hidePair(); this.startPlayback(); this.startLoops(); return; } catch (_) {
        const cached = await this.loadCachedManifest();
        if (cached) { this.manifest = cached; this.hidePair(); this.startPlayback(); this.toastStatus('Offline — cached content'); return; }
      }
    }
    await this.startPairing();
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

  async loadCachedManifest() {
    return this.idbGet('manifest');
  },

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

  async sync() {
    this.manifest = await this.rpc('signage:manifest', [this.deviceToken]);
    this.idbSet('manifest', this.manifest);
    const s = this.manifest.settings || {};
    this.duckVolume = (Number(s.ducking_volume) || 25) / 100;
    this.duckFadeMs = Number(s.duck_fade_ms) || 800;
    this.musicVolume = (Number(this.manifest.device?.music_volume) || 80) / 100;
    await this.cacheMedia();
  },

  async cacheMedia() {
    const urls = [];
    (this.manifest.playlist?.items || []).forEach((it) => { if (it.media?.url) urls.push(it.media.url); });
    (this.manifest.audio_playlist?.tracks || []).forEach((t) => { if (t.url) urls.push(t.url); });
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const blob = await res.blob();
          if (this.db) {
            const tx = this.db.transaction('media', 'readwrite');
            tx.objectStore('media').put(blob, url);
          }
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

  startLoops() {
    const interval = (this.manifest?.settings?.heartbeat_interval_sec || 30) * 1000;
    setInterval(() => this.heartbeat().catch(() => {}), interval);
    setInterval(() => this.pollCommands().catch(() => {}), 5000);
    setInterval(() => this.sync().catch(async () => {
      const cached = await this.loadCachedManifest();
      if (cached) this.manifest = cached;
    }), 60000);
    this.startMusic();
  },

  async heartbeat() {
    const music = document.getElementById('music');
    await this.rpc('signage:heartbeat', [this.deviceToken, {
      player_version: 'web-1.0',
      current_music_track: music.src ? 'playing' : '',
      storage: { cached: !!this.db },
      network: { online: navigator.onLine }
    }]);
    this.toastStatus(navigator.onLine ? 'Online' : 'Offline');
  },

  async pollCommands() {
    const cmds = await this.rpc('signage:getCommands', [this.deviceToken]);
    for (const c of cmds || []) {
      if (c.command === 'sync') await this.sync().catch(() => {});
      if (c.command === 'play_announcement') await this.playAnnouncement(c.payload);
      if (c.command === 'pause') document.querySelector('#stage video')?.pause();
      if (c.command === 'play') this.startPlayback();
      await this.rpc('signage:ackCommand', [this.deviceToken, c.id, 'ok']);
    }
  },

  startMusic() {
    const tracks = this.manifest?.audio_playlist?.tracks || [];
    if (!tracks.length) return;
    const playTrack = async (idx) => {
      this.musicIndex = idx % tracks.length;
      const t = tracks[this.musicIndex];
      const music = document.getElementById('music');
      music.src = await this.mediaUrl(t.url);
      music.volume = this.musicVolume;
      music.play().catch(() => {});
      music.onended = () => playTrack(this.musicIndex + 1);
    };
    playTrack(0);
  },

  fadeVolume(el, from, to, ms) {
    const steps = 20; const step = (to - from) / steps; let v = from; let i = 0;
    const t = setInterval(() => {
      v += step; el.volume = Math.max(0, Math.min(1, v));
      if (++i >= steps) { clearInterval(t); el.volume = to; }
    }, ms / steps);
  },

  async playAnnouncement(payload) {
    const music = document.getElementById('music');
    const ann = document.getElementById('announce');
    if (!payload?.audio_media_id) return;
    const url = `/signage-media/${payload.audio_media_id}?token=${encodeURIComponent(this.deviceToken)}`;
    const src = await this.mediaUrl(url);
    this.fadeVolume(music, music.volume, this.duckVolume, this.duckFadeMs);
    ann.src = src;
    ann.volume = (Number(payload.volume) || 100) / 100;
    ann.onended = () => this.fadeVolume(music, music.volume, this.musicVolume, this.duckFadeMs);
    ann.play().catch(() => {});
  },

  startPlayback() {
    clearTimeout(this.timer);
    const items = this.manifest?.playlist?.items || [];
    if (!items.length) {
      document.getElementById('stage').innerHTML = '<p style="padding:40px">No playlist assigned</p>';
      return;
    }
    this.showItem(items[this.itemIndex % items.length]);
  },

  async showItem(item) {
    const stage = document.getElementById('stage');
    const dur = (Number(item.duration_seconds) || 8) * 1000;
    if (item.item_type === 'menu' && item.menu) {
      const m = item.menu;
      stage.innerHTML = `<div id="menu-slide"><h1>${m.title_text || m.name}</h1>
        ${(m.items || []).map((i) => `<div class="menu-item"><span>${i.name}</span><span>R${Number(i.price).toFixed(0)}</span></div>`).join('')}</div>`;
    } else if (item.media) {
      const url = await this.mediaUrl(item.media.url);
      if (item.media.media_type === 'video') {
        stage.innerHTML = `<video id="vid" src="${url}" autoplay ${item.use_video_audio ? '' : 'muted'} style="max-width:100%;max-height:100%"></video>`;
        const v = document.getElementById('vid');
        if (item.use_video_audio) v.volume = (Number(item.video_volume) || 100) / 100;
        v.onended = () => this.nextItem();
        return;
      }
      stage.innerHTML = `<img src="${url}" alt="">`;
    }
    this.timer = setTimeout(() => this.nextItem(), dur);
  },

  nextItem() {
    const items = this.manifest?.playlist?.items || [];
    if (!items.length) return;
    this.itemIndex = (this.itemIndex + 1) % items.length;
    if (this.manifest.playlist?.shuffle && this.itemIndex === 0) this.itemIndex = Math.floor(Math.random() * items.length);
    this.showItem(items[this.itemIndex]);
  },

  toastStatus(msg) { document.getElementById('status').textContent = msg; }
};

Player.init();

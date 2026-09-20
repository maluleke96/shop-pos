/* Public radio — music via reliable file URL; voice overlay via WebRTC when mic is on */
const RadioPublic = {
  data: null,
  listening: false,
  chatAfter: 0,
  nick: localStorage.getItem('radio_nick') || '',
  sessionKey: localStorage.getItem('radio_listen_key') || '',
  _chat: [],
  _built: false,
  _pc: null,
  _usingVoice: false,
  _baseMusicVol: 0.95,
  _voiceSeq: 0,
  _voiceQueue: [],
  _voicePlaying: false,
  pollTimer: 0,
  chatTimer: 0,
  pingTimer: 0,
  voiceTimer: 0,
  liveTimer: 0,

  init() {
    if (!this.sessionKey) {
      this.sessionKey = `rl_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
      localStorage.setItem('radio_listen_key', this.sessionKey);
    }
    this.buildShell();
    this.refresh();
    // Count this device as soon as the page is open
    this.pingListener(true);
    this.pollTimer = setInterval(() => this.refresh(true), 3000);
    this.chatTimer = setInterval(() => this.pullChat(), 3500);
    this.pingTimer = setInterval(() => this.pingListener(true), 10000);
    this.voiceTimer = setInterval(() => this.pullVoice(), 900);
  },

  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  },

  origin() {
    return (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file:'))
      ? location.origin.replace(/\/$/, '')
      : String((window.__RADIO_CONFIG__ || {}).apiBase || '').replace(/\/$/, '');
  },

  mediaUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.origin()}${path.startsWith('/') ? path : `/${path}`}`;
  },

  buildShell() {
    document.getElementById('app').innerHTML = `
      <div class="easy-public">
        <header class="easy-pub-top">
          <div class="rx-brand">
            <div class="rx-flame">🔥</div>
            <div>
              <h1 id="rx-name">Connection Radio</h1>
              <p class="tag" id="rx-status-line">Loading…</p>
            </div>
          </div>
        </header>

        <main class="easy-pub-main">
          <div class="easy-pub-card">
            <div class="easy-live-row">
              <span class="pill-live pill-off" id="rx-live-pill"><span class="dot"></span><span id="rx-live-label">OFF AIR</span></span>
              <span class="listeners" id="rx-listeners">0 listening</span>
            </div>
            <p class="muted" id="rx-operator" style="margin:0 0 12px"></p>
            <div class="easy-pub-now">
              <div class="rx-art" id="rx-art">🎵</div>
              <div style="min-width:0">
                <div class="muted" style="font-size:11px;letter-spacing:.1em" id="rx-np-kind">NOW PLAYING</div>
                <strong id="rx-np-title">Stand by…</strong>
                <div class="meta" id="rx-np-sub"></div>
              </div>
            </div>
            <button type="button" class="btn btn-listen easy-listen" id="btn-listen">▶ LISTEN LIVE</button>
            <label class="vol-row">Volume <input type="range" id="rx-vol" min="0" max="100" value="90"></label>
            <audio id="radio-audio" playsinline preload="auto"></audio>
            <audio id="radio-advert" playsinline preload="auto"></audio>
            <audio id="radio-voice" playsinline></audio>
            <p class="muted" id="rx-help" style="text-align:center;margin:10px 0 0">Tap Listen when the studio is on air.</p>
          </div>

          <div class="easy-pub-card" id="chat">
            <h2>Chat with the studio</h2>
            <div class="chat-log" id="chat-log"></div>
            <form class="chat-form" id="chat-form">
              <input id="chat-nick" placeholder="Your name" maxlength="40" value="${this.esc(this.nick)}" autocomplete="nickname">
              <input id="chat-body" placeholder="Say something…" maxlength="400" autocomplete="off">
              <button class="btn btn-listen" type="submit">Send</button>
            </form>
          </div>

          <div class="easy-pub-card" id="call">
            <h2>Call the studio</h2>
            <button class="btn btn-call" type="button" id="btn-call">📞 CALL US LIVE</button>
            <p class="muted" id="rx-call-help" style="margin-top:8px"></p>
          </div>

          <div class="easy-pub-card" id="order">
            <a class="btn btn-ghost" style="width:100%" id="rx-order" href="/order/" target="_blank" rel="noopener">🍽️ Order Food</a>
          </div>
        </main>
      </div>`;

    document.getElementById('btn-listen')?.addEventListener('click', () => this.toggleListen());
    document.getElementById('btn-call')?.addEventListener('click', () => this.requestCall());
    document.getElementById('rx-vol')?.addEventListener('input', (e) => {
      this._baseMusicVol = Number(e.target.value) / 100;
      this.applyVolumes();
    });
    document.getElementById('chat-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.sendChat();
    });
    document.getElementById('radio-advert')?.addEventListener('ended', () => {
      this.applyVolumes();
    });
    this._built = true;
  },

  async refresh(silent) {
    try {
      this.data = await RadioAPI.status();
      this.paintStatus();
      if (this.listening) await this.ensurePlayback();
      if (!silent) await this.pullChat(true);
    } catch (err) {
      if (!silent && this._built) {
        const help = document.getElementById('rx-help');
        if (help) help.textContent = err.message || 'Radio unavailable';
      }
    }
  },

  paintStatus() {
    if (!this._built || !this.data) return;
    const st = this.data.station || {};
    const np = this.data.now_playing || {};
    const adv = this.data.advert;
    const live = st.status === 'live';
    const listeners = Number(this.data.listeners || 0);
    const op = this.data.operator?.name;
    const tel = this.data.telephony || {};
    const bc = this.data.broadcast || {};

    const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    set('rx-name', st.name || 'Chisanyama Connection Radio');
    set('rx-status-line', live ? 'Live from the studio' : 'Off air — check back soon');
    set('rx-live-label', live ? '🔴 LIVE NOW' : 'OFF AIR');
    set('rx-listeners', `${listeners} listening`);
    set('rx-operator', op ? `On air host: ${op}` : (live ? 'Studio is live' : ''));
    if (adv?.title) {
      set('rx-np-kind', 'ADVERT');
      set('rx-np-title', adv.title);
      set('rx-np-sub', np.title ? `Under: ${np.title}` : '');
    } else {
      set('rx-np-kind', 'NOW PLAYING');
      set('rx-np-title', np.title || (live ? 'Live show' : 'Stand by…'));
      set('rx-np-sub', np.artist || st.programme_title || '');
    }
    document.getElementById('rx-live-pill')?.classList.toggle('pill-off', !live);

    const btn = document.getElementById('btn-listen');
    if (btn) btn.textContent = this.listening ? '⏸ Pause' : '▶ LISTEN LIVE';

    const callBtn = document.getElementById('btn-call');
    const callHelp = document.getElementById('rx-call-help');
    if (tel.configured) {
      if (callBtn) { callBtn.disabled = false; callBtn.onclick = () => this.requestCall(); callBtn.textContent = '📞 CALL US LIVE'; }
      if (callHelp) callHelp.textContent = 'Studio answers privately first, then may put you on air.';
    } else if (st.call_phone) {
      if (callBtn) {
        callBtn.disabled = false;
        callBtn.textContent = `☎️ Call ${st.call_phone}`;
        callBtn.onclick = () => { location.href = `tel:${st.call_phone}`; };
      }
      if (callHelp) callHelp.textContent = 'On-air calling not set up — this dials the studio phone.';
    } else {
      if (callBtn) { callBtn.disabled = true; callBtn.textContent = 'Calling not set up yet'; }
      if (callHelp) callHelp.textContent = tel.message || '';
    }

    const order = document.getElementById('rx-order');
    if (order && this.data.shop?.order_url) order.href = this.data.shop.order_url;
    document.title = `${st.name || 'Connection Radio'} · ${live ? 'LIVE' : 'Radio'}`;
    this.applyVolumes();
  },

  applyVolumes() {
    const music = document.getElementById('radio-audio');
    const advert = document.getElementById('radio-advert');
    const voice = document.getElementById('radio-voice');
    const bc = this.data?.broadcast || {};
    const mode = this.data?.advert?.music_mode;
    const hasAdvert = !!(this.data?.advert?.audio_url);
    const voiceLive = !!(bc.voice_live || bc.mic_active || this._voicePlaying || this._voiceQueue.length);
    let musicFactor = 1;
    if (mode === 'stop' && hasAdvert) musicFactor = 0;
    else if (hasAdvert || voiceLive) musicFactor = Number(this.data?.advert?.duck ?? bc.duck_level ?? 0.12);
    if (music) {
      music.volume = Math.max(0, Math.min(1, this._baseMusicVol * musicFactor));
      if (mode === 'stop' && hasAdvert && this.listening) music.pause();
    }
    if (advert) advert.volume = 1;
    if (voice) voice.volume = 1;
  },

  async pingListener() {
    try {
      const res = await RadioAPI.listenerPing(this.sessionKey, { user_agent: navigator.userAgent });
      const el = document.getElementById('rx-listeners');
      if (el && res?.listeners != null) el.textContent = `${res.listeners} listening`;
      if (this.data) this.data.listeners = res.listeners;
    } catch (_) { /* */ }
  },

  async pullVoice() {
    if (!this.listening) return;
    try {
      const res = await RadioAPI.voiceChunks(this._voiceSeq);
      if (!res) return;
      if (res.duck_level != null && this.data?.broadcast) {
        this.data.broadcast.duck_level = res.duck_level;
        this.data.broadcast.voice_live = res.voice_live;
        this.data.broadcast.mic_active = res.voice_live;
        this.applyVolumes();
      }
      for (const c of res.chunks || []) {
        if (c.seq > this._voiceSeq) {
          this._voiceSeq = c.seq;
          this._voiceQueue.push(this.mediaUrl(c.audio_url));
        }
      }
      this.drainVoiceQueue();
    } catch (_) { /* */ }
  },

  drainVoiceQueue() {
    if (this._voicePlaying || !this._voiceQueue.length) return;
    const url = this._voiceQueue.shift();
    const voice = document.getElementById('radio-voice');
    if (!voice || !url) return;
    this._voicePlaying = true;
    voice.srcObject = null;
    voice.src = url;
    voice.volume = 1;
    voice.onended = () => {
      this._voicePlaying = false;
      this.drainVoiceQueue();
    };
    voice.onerror = () => {
      this._voicePlaying = false;
      this.drainVoiceQueue();
    };
    const playLoud = async () => {
      try {
        if (!this._voiceCtx) {
          this._voiceCtx = new (window.AudioContext || window.webkitAudioContext)();
          this._voiceSrcNode = this._voiceCtx.createMediaElementSource(voice);
          this._voiceBoost = this._voiceCtx.createGain();
          this._voiceBoost.gain.value = 2.6; // strong voice for listeners
          this._voiceSrcNode.connect(this._voiceBoost);
          this._voiceBoost.connect(this._voiceCtx.destination);
        }
        if (this._voiceCtx.state === 'suspended') await this._voiceCtx.resume();
        if (this._voiceBoost) this._voiceBoost.gain.value = 2.6;
      } catch (_) { /* fall back to element volume */ }
      await voice.play();
    };
    playLoud().catch(() => {
      this._voicePlaying = false;
      this.drainVoiceQueue();
    });
    const help = document.getElementById('rx-help');
    if (help) help.textContent = 'Live voice from studio (loud)';
    this.applyVolumes();
  },

  async pullChat(reset) {
    try {
      if (reset) this.chatAfter = 0;
      const res = await RadioAPI.chatList(this.chatAfter);
      const msgs = res.messages || [];
      if (reset) this._chat = msgs;
      else if (msgs.length) this._chat = (this._chat || []).concat(msgs);
      if (msgs.length) this.chatAfter = msgs[msgs.length - 1].id;
      this.paintChat();
    } catch (_) { /* */ }
  },

  paintChat() {
    const log = document.getElementById('chat-log');
    if (!log) return;
    const msgs = this._chat || [];
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.innerHTML = msgs.length
      ? msgs.map((m) => `
        <div class="chat-msg ${m.is_staff ? 'staff' : ''}">
          <span class="who">${this.esc(m.author_name)}</span>${this.esc(m.body)}
        </div>`).join('')
      : '<p class="muted">Say hello — the studio sees your messages.</p>';
    if (atBottom) log.scrollTop = log.scrollHeight;
  },

  async toggleListen() {
    if (this.listening) {
      this.listening = false;
      ['radio-audio', 'radio-advert', 'radio-voice'].forEach((id) => {
        const a = document.getElementById(id);
        if (a) a.pause();
      });
      this._voiceQueue = [];
      this._voicePlaying = false;
      this.paintStatus();
      return;
    }
    this.listening = true;
    this._baseMusicVol = Number(document.getElementById('rx-vol')?.value || 95) / 100;
    this.paintStatus();
    await this.ensurePlayback();
    await this.pingListener();
  },

  async ensurePlayback() {
    const st = this.data?.station || {};
    const np = this.data?.now_playing || {};
    const bc = this.data?.broadcast || {};
    const advert = this.data?.advert;
    const playUrl = this.mediaUrl(st.play_url || np.audio_url || st.stream_url || '');
    const music = document.getElementById('radio-audio');
    const advertEl = document.getElementById('radio-advert');
    const help = document.getElementById('rx-help');

    if (music && playUrl) {
      if (music.dataset.src !== playUrl) {
        music.dataset.src = playUrl;
        music.src = playUrl;
        music.load();
      }
      if (bc.playback_state === 'paused' || advert?.music_mode === 'stop') {
        music.pause();
      } else if (this.listening && bc.playback_state !== 'stopped') {
        try {
          await music.play();
          if (help && !this._voicePlaying) help.textContent = 'You are listening.';
        } catch (_) {
          if (help) help.textContent = 'Tap Listen again if sound did not start.';
        }
      }
    } else if (help && this.listening) {
      help.textContent = st.status === 'live'
        ? 'Studio is live — waiting for a song or voice.'
        : 'Station is off air.';
    }

    if (advertEl) {
      const advUrl = this.mediaUrl(advert?.audio_url || '');
      if (advUrl) {
        if (advertEl.dataset.src !== advUrl) {
          advertEl.dataset.src = advUrl;
          advertEl.src = advUrl;
          advertEl.load();
        }
        if (this.listening) {
          try { await advertEl.play(); } catch (_) { /* */ }
        }
      } else {
        advertEl.pause();
        advertEl.removeAttribute('src');
        advertEl.dataset.src = '';
      }
    }

    this.applyVolumes();
    await this.pullVoice();
  },

  async requestCall() {
    const name = prompt('Your name', this.nick || 'Listener');
    if (name == null) return;
    const phone = prompt('Your number (optional)', '') || '';
    try {
      await RadioAPI.requestCall({ caller_name: name, caller_phone: phone });
      alert('Call sent to the studio. Please wait.');
    } catch (err) {
      alert(err.message || 'Calling unavailable');
    }
  },

  async sendChat() {
    const nickEl = document.getElementById('chat-nick');
    const bodyEl = document.getElementById('chat-body');
    const name = String(nickEl?.value || '').trim() || 'Listener';
    const body = String(bodyEl?.value || '').trim();
    if (!body) return;
    this.nick = name;
    localStorage.setItem('radio_nick', name);
    try {
      await RadioAPI.chatPost({ author_name: name, body, author_key: name.toLowerCase() });
      if (bodyEl) bodyEl.value = '';
      await this.pullChat();
    } catch (err) {
      alert(err.message || 'Could not send');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => RadioPublic.init());

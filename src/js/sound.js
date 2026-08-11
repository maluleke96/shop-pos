const SoundService = {
  audio: null,
  synthTimer: null,
  playing: false,
  _testTimer: null,
  _audioCtx: null,

  isEnabled(settings) {
    const ns = settings?.notification_settings || {};
    return ns.sound_enabled !== false;
  },

  async resolveUrl(settings) {
    const path = settings?.notification_settings?.sound_path;
    if (!path) return null;
    try {
      const r = await API.getAudioDataUrl(path);
      if (r?.success && r.dataUrl) return r.dataUrl;
    } catch { /* fallback */ }
    return Utils.fileUrl(path);
  },

  async ensureAudioContext() {
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._audioCtx.state === 'suspended') {
      await this._audioCtx.resume();
    }
    return this._audioCtx;
  },

  async startSynthLoop() {
    try {
      const ctx = await this.ensureAudioContext();
      const playBeep = () => {
        if (!this.playing) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.value = 0.2;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        setTimeout(() => { try { osc.stop(); } catch { /* ignore */ } }, 450);
      };
      playBeep();
      if (this.synthTimer) clearInterval(this.synthTimer);
      this.synthTimer = setInterval(playBeep, 1100);
    } catch { /* no audio */ }
  },

  async startAlert(settings) {
    if (this.playing || !this.isEnabled(settings)) return;
    this.playing = true;
    const url = await this.resolveUrl(settings);
    if (url) {
      this.audio = new Audio(url);
      this.audio.loop = true;
      try {
        await this.audio.play();
      } catch {
        await this.startSynthLoop();
      }
    } else {
      await this.startSynthLoop();
    }
  },

  stopAlert() {
    this.playing = false;
    if (this._testTimer) {
      clearTimeout(this._testTimer);
      this._testTimer = null;
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    if (this.synthTimer) {
      clearInterval(this.synthTimer);
      this.synthTimer = null;
    }
  },

  async playOnce(settings) {
    if (!this.isEnabled(settings)) return;
    const url = await this.resolveUrl(settings);
    if (url) {
      const a = new Audio(url);
      try {
        await a.play();
      } catch {
        this.playing = true;
        await this.startSynthLoop();
        setTimeout(() => this.stopAlert(), 1500);
      }
    } else {
      this.playing = true;
      await this.startSynthLoop();
      setTimeout(() => this.stopAlert(), 1500);
    }
  },

  /** Preview alert sound (user click satisfies autoplay policy). */
  async testAlert(settings, opts = {}) {
    const { durationMs = 8000 } = opts;
    this.stopAlert();
    if (!this.isEnabled(settings)) throw new Error('Alert sounds are disabled');
    await API.ensureDemoNotificationSound?.().catch(() => {});
    const refreshed = await API.getSettingsParsed?.().catch(() => null);
    const activeSettings = refreshed?.success ? refreshed.data : settings;
    await this.startAlert(activeSettings);
    if (!this.playing) throw new Error('Could not start audio — check volume and sound settings');
    if (durationMs > 0) {
      this._testTimer = setTimeout(() => this.stopAlert(), durationMs);
    }
  }
};
window.SoundService = SoundService;

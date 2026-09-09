/** Shared order notification sound — per-panel upload or demo tone */
window.PanelSound = {
  audio: null,
  synthTimer: null,
  playing: false,
  enabled: true,
  panel: 'manager',

  DEMO_FREQ: {
    pos: 880, admin: 660, driver: 520, manager: 740,
    online: 990, delivery: 600, staff: 700, recipe: 800
  },

  setPanel(panel) {
    if (panel) this.panel = String(panel);
  },

  setEnabled(on) {
    this.enabled = on !== false;
    if (!this.enabled) this.stop();
  },

  _soundUrl() {
    const p = encodeURIComponent(this.panel || 'manager');
    return `/api/notification-sound?panel=${p}&t=${Date.now()}`;
  },

  _demoFreq() {
    return this.DEMO_FREQ[this.panel] || 740;
  },

  async startLoop() {
    if (!this.enabled || this.playing) return;
    this.playing = true;
    this.audio = new Audio(this._soundUrl());
    this.audio.loop = true;
    try {
      await this.audio.play();
    } catch (_) {
      await this._startSynthLoop();
    }
  },

  async playOnce() {
    if (!this.enabled) return;
    this.stop();
    const a = new Audio(this._soundUrl());
    try {
      await a.play();
    } catch (_) {
      this.playing = true;
      await this._startSynthLoop();
      setTimeout(() => this.stop(), 1500);
    }
  },

  async _startSynthLoop() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const freq = this._demoFreq();
      const beep = () => {
        if (!this.playing) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.value = 0.18;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        setTimeout(() => { try { osc.stop(); } catch (_) { /* */ } }, 400);
      };
      beep();
      if (this.synthTimer) clearInterval(this.synthTimer);
      this.synthTimer = setInterval(beep, 1100);
    } catch (_) { /* no audio */ }
  },

  stop() {
    this.playing = false;
    if (this.audio) {
      try { this.audio.pause(); this.audio.currentTime = 0; } catch (_) { /* */ }
      this.audio = null;
    }
    if (this.synthTimer) {
      clearInterval(this.synthTimer);
      this.synthTimer = null;
    }
  },

  syncPending(hasPending) {
    if (!this.enabled) { this.stop(); return; }
    if (hasPending) this.startLoop();
    else this.stop();
  }
};

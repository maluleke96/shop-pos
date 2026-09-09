/**
 * Panel notification dedup + permission + background sound gating.
 * Persists seen/handled keys locally and syncs acks to server (cross-device).
 */
window.PanelNotify = {
  panel: 'manager',
  _acked: new Set(),
  _deviceId: null,
  _rpc: null,
  _loggedIn: () => true,
  _loaded: false,

  PANELS: ['pos', 'admin', 'driver', 'manager', 'online', 'delivery', 'staff', 'recipe'],

  init(opts = {}) {
    this.panel = opts.panel || this.panel;
    this._rpc = opts.rpc || null;
    this._loggedIn = opts.loggedIn || (() => true);
    if (window.PanelSound) PanelSound.setPanel(this.panel);
    this._deviceId = this.getDeviceId();
    this._loadLocalAcks();
    if (this._rpc) this.refreshAcks().catch(() => {});
    if (opts.requestPermission !== false) this.requestPermission();
    this._loaded = true;
  },

  getDeviceId() {
    const key = `shoppos_device_${this.panel}`;
    let id = localStorage.getItem(key);
    if (!id) {
      id = `d_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(key, id);
    }
    return id;
  },

  _localKey() {
    return `shoppos_acks_${this.panel}`;
  },

  _loadLocalAcks() {
    try {
      const raw = localStorage.getItem(this._localKey());
      const arr = raw ? JSON.parse(raw) : [];
      (arr || []).forEach((k) => this._acked.add(String(k)));
    } catch (_) { /* */ }
  },

  _saveLocalAcks() {
    try {
      localStorage.setItem(this._localKey(), JSON.stringify([...this._acked].slice(-800)));
    } catch (_) { /* */ }
  },

  async refreshAcks() {
    if (!this._rpc) return;
    try {
      const keys = await this._rpc('notifications:listAcked', [this.panel, 800]);
      (keys || []).forEach((k) => this._acked.add(String(k)));
      this._saveLocalAcks();
    } catch (_) { /* offline */ }
  },

  isAcked(eventKey) {
    return this._acked.has(String(eventKey));
  },

  filterUnacked(items, keyFn) {
    return (items || []).filter((item) => !this.isAcked(keyFn(item)));
  },

  async ack(eventKey, ackType) {
    const key = String(eventKey);
    if (!key) return;
    this._acked.add(key);
    this._saveLocalAcks();
    if (this._rpc) {
      try {
        await this._rpc('notifications:ackEvent', [this.panel, key, {
          device_id: this._deviceId,
          ack_type: ackType || 'handled'
        }]);
      } catch (_) { /* queued locally */ }
    }
  },

  async ackMany(eventKeys, ackType) {
    for (const k of eventKeys || []) await this.ack(k, ackType);
  },

  shouldPlaySound() {
    if (!this._loggedIn()) {
      window.PanelSound?.stop();
      return false;
    }
    return true;
  },

  /** Play looping alert for unacked pending items; stops when none or logged out. */
  syncPendingAlert(items, keyFn, soundEnabled) {
    if (!window.PanelSound) return;
    PanelSound.setPanel(this.panel);
    PanelSound.setEnabled(soundEnabled !== false && this.shouldPlaySound());
    const pending = this.filterUnacked(items, keyFn);
    const hasPending = pending.length > 0;
    if (!this.shouldPlaySound()) {
      PanelSound.stop();
      return { pending: [], hasPending: false };
    }
    PanelSound.syncPending(hasPending);
    return { pending, hasPending };
  },

  async requestPermission() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (_) { /* */ }
    }
  },

  notifyBrowser(title, body, tag) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!this.shouldPlaySound()) return;
    try {
      new Notification(title, { body, tag: tag || `${this.panel}-${Date.now()}` });
    } catch (_) { /* */ }
  },

  onLogout() {
    window.PanelSound?.stop();
  },

  soundOffKey(panel) {
    return `panel_sound_off_${panel || this.panel}`;
  },

  isSoundEnabled(panel) {
    try { return localStorage.getItem(this.soundOffKey(panel)) !== '1'; }
    catch (_) { return true; }
  },

  setSoundEnabled(panel, on) {
    const p = panel || this.panel;
    try {
      if (on) localStorage.removeItem(this.soundOffKey(p));
      else localStorage.setItem(this.soundOffKey(p), '1');
    } catch (_) { /* */ }
    if (p === this.panel && window.PanelSound) {
      PanelSound.setEnabled(!!on);
      if (!on) PanelSound.stop();
    }
  },

  bindSoundToggle(checkbox, panel) {
    if (!checkbox) return;
    const p = panel || this.panel;
    checkbox.checked = this.isSoundEnabled(p);
    checkbox.addEventListener('change', () => {
      this.setSoundEnabled(p, checkbox.checked);
    });
  },

  /** HTML for a compact sound on/off toggle (bind with bindSoundToggle after insert). */
  soundToggleHtml(panel, opts = {}) {
    const id = opts.id || `pn-sound-${panel}`;
    const label = opts.label || 'Notification sounds';
    const checked = this.isSoundEnabled(panel) ? 'checked' : '';
    const cls = opts.className || 'pn-sound-toggle';
    return `<label class="${cls}"><input type="checkbox" id="${id}" ${checked}><span>${label}</span></label>`;
  }
};

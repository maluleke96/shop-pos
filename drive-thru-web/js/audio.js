/**
 * Drive-Thru Audio — separate from Signage. Real MediaDevices API + push-to-talk.
 * Mic is muted by default; only transmits while PTT button is held.
 */
const DriveThruAudio = {
  micStream: null, audioContext: null, analyser: null, monitorTimer: null,
  micDeviceId: '', speakerDeviceId: '', micVolume: 1, speakerVolume: 1,
  pttActive: false, muted: true,
  status: { mic: 'BROWSER PERMISSION REQUIRED', speaker: 'SPEAKER READY', permission: 'unknown' },

  async init() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.status.mic = 'MICROPHONE ERROR';
      this.status.permission = 'unsupported';
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      this.status.permission = 'granted';
      await this.refreshDevices();
    } catch (e) {
      this.status.mic = e.name === 'NotAllowedError' ? 'BROWSER PERMISSION REQUIRED' : 'MICROPHONE ERROR';
      this.status.permission = 'denied';
    }
    window.addEventListener('blur', () => this.stopPTT());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stopPTT(); });
  },

  async refreshDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: devices.filter((d) => d.kind === 'audioinput'),
      outputs: devices.filter((d) => d.kind === 'audiooutput')
    };
  },

  async selectMic(deviceId) {
    this.micDeviceId = deviceId || '';
    if (this.micStream) { this.micStream.getTracks().forEach((t) => t.stop()); this.micStream = null; }
    try {
      const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
      this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.micStream.getAudioTracks().forEach((t) => { t.enabled = false; });
      this.muted = true;
      this.pttActive = false;
      this.audioContext = this.audioContext || new (window.AudioContext || window.webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(this.micStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      this.status.mic = 'MIC MUTED (PTT)';
      this.startLevelMonitor();
      return true;
    } catch (e) {
      this.status.mic = 'MICROPHONE ERROR';
      return false;
    }
  },

  startLevelMonitor() {
    clearInterval(this.monitorTimer);
    this.monitorTimer = setInterval(() => {
      if (!this.analyser) return;
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const el = document.getElementById('mic-level');
      if (el) {
        el.style.width = `${Math.min(100, avg * (this.pttActive && !this.muted ? 1.5 : 0.3))}%`;
        el.classList.toggle('ptt-live', this.pttActive && !this.muted);
      }
    }, 100);
  },

  setMuted(muted) {
    this.muted = muted;
    if (this.micStream) this.micStream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    if (!this.micStream) {
      this.status.mic = 'MICROPHONE ERROR';
    } else if (this.pttActive && !muted) {
      this.status.mic = 'MIC LIVE — SPEAKING';
    } else if (muted) {
      this.status.mic = 'MIC MUTED (PTT)';
    } else {
      this.status.mic = 'MIC READY';
    }
  },

  async testSpeaker() {
    try {
      this.audioContext = this.audioContext || new (window.AudioContext || window.webkitAudioContext)();
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      gain.gain.value = 0.15 * this.speakerVolume;
      osc.connect(gain);
      const dest = this.audioContext.createMediaStreamDestination();
      gain.connect(dest);
      osc.frequency.value = 440;
      osc.start();
      const audio = new Audio();
      if (this.speakerDeviceId && audio.setSinkId) await audio.setSinkId(this.speakerDeviceId);
      audio.srcObject = dest.stream;
      audio.volume = this.speakerVolume;
      await audio.play();
      setTimeout(() => { osc.stop(); audio.pause(); }, 500);
      this.status.speaker = 'SPEAKER READY';
      return true;
    } catch (e) {
      this.status.speaker = 'SPEAKER ERROR';
      return false;
    }
  },

  async startPTT() {
    if (this.pttActive) return;
    if (!this.micStream) await this.selectMic(this.micDeviceId);
    if (!this.micStream) return;
    this.pttActive = true;
    this.setMuted(false);
  },

  stopPTT() {
    if (!this.pttActive && this.muted) return;
    this.pttActive = false;
    this.setMuted(true);
  },

  getStatusReport() {
    return {
      ...this.status,
      mic_device_id: this.micDeviceId,
      speaker_device_id: this.speakerDeviceId,
      ptt_active: this.pttActive,
      mic_transmitting: this.pttActive && !this.muted
    };
  },

  destroy() {
    this.stopPTT();
    clearInterval(this.monitorTimer);
    if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
    if (this.audioContext) this.audioContext.close().catch(() => {});
  }
};
window.DriveThruAudio = DriveThruAudio;

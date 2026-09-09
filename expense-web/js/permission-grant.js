/** Supervisor approval flow — photo + voice recording when granting expense access. */
const ExpensePermissionGrant = {
  _stream: null,
  _recorder: null,
  _audioChunks: [],
  _photoDataUrl: '',
  _audioDataUrl: '',

  esc(s) {
    return String(s || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  },

  stopCamera() {
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
  },

  async capturePhoto() {
    this.stopCamera();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 480, height: 480 },
      audio: false
    });
    this._stream = stream;
    const video = document.getElementById('epg-video');
    if (video) {
      video.srcObject = stream;
      await video.play();
    }
  },

  snapPhoto() {
    const video = document.getElementById('epg-video');
    const canvas = document.getElementById('epg-canvas');
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    this._photoDataUrl = canvas.toDataURL('image/jpeg', 0.82);
    this.stopCamera();
    const preview = document.getElementById('epg-photo-preview');
    const wrap = document.getElementById('epg-video-wrap');
    if (preview) {
      preview.src = this._photoDataUrl;
      preview.classList.remove('hidden');
    }
    if (wrap) wrap.classList.add('hidden');
    document.getElementById('epg-photo-status')?.classList.remove('hidden');
  },

  async startRecording() {
    this._audioChunks = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this._recorder = new MediaRecorder(stream);
    this._recorder.ondataavailable = (e) => { if (e.data.size) this._audioChunks.push(e.data); };
    this._recorder.start(500);
    this._recordStart = Date.now();
    const btn = document.getElementById('epg-record-btn');
    if (btn) {
      btn.textContent = 'Stop recording';
      btn.dataset.recording = '1';
    }
    document.getElementById('epg-record-status')?.classList.remove('hidden');
  },

  async stopRecording() {
    if (!this._recorder || this._recorder.state === 'inactive') return;
    return new Promise((resolve, reject) => {
      this._recorder.onstop = () => {
        try {
          const blob = new Blob(this._audioChunks, { type: this._recorder.mimeType || 'audio/webm' });
          const reader = new FileReader();
          reader.onloadend = () => {
            this._audioDataUrl = reader.result;
            this._recorder.stream.getTracks().forEach((t) => t.stop());
            this._recorder = null;
            const secs = Math.round((Date.now() - (this._recordStart || Date.now())) / 1000);
            const st = document.getElementById('epg-record-status');
            if (st) st.textContent = `Recording saved (${secs}s)`;
            resolve(secs);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        } catch (e) { reject(e); }
      };
      this._recorder.stop();
    });
  },

  render(granteeUsername) {
    return `
      <div class="grant-card">
        <h3 style="margin:0 0 8px">Supervisor permission required</h3>
        <p class="muted" style="margin:0 0 16px;line-height:1.45">
          <strong>${this.esc(granteeUsername)}</strong> does not have expense capture permission yet.
          A supervisor or manager must approve access. We will save your photo, voice statement, name, and role.
        </p>
        <div class="field">
          <label>Supervisor username</label>
          <input id="epg-approver-user" autocomplete="username" placeholder="Manager username">
        </div>
        <div class="field">
          <label>Supervisor password</label>
          <input id="epg-approver-pass" type="password" autocomplete="current-password">
        </div>
        <p class="section-label" style="margin-top:16px">Your photo</p>
        <div id="epg-video-wrap" class="grant-video-wrap">
          <video id="epg-video" playsinline muted></video>
          <button type="button" class="btn btn-ghost" id="epg-start-camera">Open camera</button>
          <button type="button" class="btn btn-primary" id="epg-snap-photo">Take photo</button>
        </div>
        <img id="epg-photo-preview" class="grant-photo-preview hidden" alt="Supervisor photo">
        <canvas id="epg-canvas" class="hidden"></canvas>
        <p id="epg-photo-status" class="muted hidden" style="font-size:0.85rem">Photo captured ✓</p>
        <p class="section-label" style="margin-top:16px">Voice statement</p>
        <p class="muted" style="margin:0 0 8px;font-size:0.85rem">Say clearly: "I authorize ${this.esc(granteeUsername)} to capture expenses."</p>
        <button type="button" class="btn btn-ghost" id="epg-record-btn">Start recording</button>
        <p id="epg-record-status" class="muted hidden" style="font-size:0.85rem;margin-top:8px"></p>
        <div style="display:flex;gap:8px;margin-top:20px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="epg-submit">Grant permission & sign in worker</button>
          <button type="button" class="btn btn-ghost" id="epg-cancel">Cancel</button>
        </div>
      </div>`;
  },

  bind(root, granteeUsername, granteePassword, onSuccess, onCancel) {
    this._photoDataUrl = '';
    this._audioDataUrl = '';
    root.querySelector('#epg-start-camera')?.addEventListener('click', () => {
      this.capturePhoto().catch((e) => ExpenseApp.toast(e.message || 'Camera unavailable', 'error'));
    });
    root.querySelector('#epg-snap-photo')?.addEventListener('click', () => this.snapPhoto());
    root.querySelector('#epg-record-btn')?.addEventListener('click', async () => {
      const btn = root.querySelector('#epg-record-btn');
      if (btn?.dataset.recording === '1') {
        btn.disabled = true;
        try {
          await this.stopRecording();
        } catch (e) {
          ExpenseApp.toast(e.message || 'Recording failed', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Re-record';
          btn.dataset.recording = '0';
        }
        return;
      }
      try {
        await this.startRecording();
      } catch (e) {
        ExpenseApp.toast(e.message || 'Microphone unavailable', 'error');
      }
    });
    root.querySelector('#epg-cancel')?.addEventListener('click', () => {
      this.stopCamera();
      onCancel?.();
    });
    root.querySelector('#epg-submit')?.addEventListener('click', async () => {
      const approver_username = root.querySelector('#epg-approver-user')?.value?.trim();
      const approver_password = root.querySelector('#epg-approver-pass')?.value || '';
      if (!approver_username || !approver_password) {
        return ExpenseApp.toast('Enter supervisor username and password', 'error');
      }
      if (!this._photoDataUrl) return ExpenseApp.toast('Take your photo first', 'error');
      if (!this._audioDataUrl) return ExpenseApp.toast('Record your voice statement first', 'error');
      const btn = root.querySelector('#epg-submit');
      btn.disabled = true;
      btn.textContent = 'Saving approval…';
      try {
        const device = {
          device_name: navigator.userAgent?.slice(0, 80) || 'phone',
          platform: /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'ios' : 'android'
        };
        const res = await ExpenseAPI.grantAccess({
          grantee_username: granteeUsername,
          grantee_password: granteePassword,
          approver_username,
          approver_password,
          photo_data: this._photoDataUrl,
          audio_data: this._audioDataUrl,
          device
        });
        this.stopCamera();
        onSuccess?.(res);
      } catch (e) {
        ExpenseApp.toast(e.message || 'Could not grant permission', 'error');
        btn.disabled = false;
        btn.textContent = 'Grant permission & sign in worker';
      }
    });
  }
};

window.ExpensePermissionGrant = ExpensePermissionGrant;

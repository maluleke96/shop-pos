/** Shared staff login selfie capture — live camera only (front first, no gallery). */
const StaffSelfieCapture = {
  _stream: null,
  _capturing: false,

  isNative() {
    return !!(window.Capacitor?.isNativePlatform?.() || window.__SHOP_POS_MOBILE__);
  },

  getCameraPlugin() {
    return window.Capacitor?.Plugins?.Camera || null;
  },

  selfieRequired() {
    return !!(window.App?.settings?.staff_portal_settings?.require_login_selfie);
  },

  stopCamera() {
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
  },

  ensureStaffPortalScreen() {
    try {
      if (typeof App?.showScreen === 'function') App.showScreen('staff-portal');
      document.getElementById('screen-staff-portal')?.classList.remove('hidden');
      document.getElementById('mobile-loading')?.remove();
    } catch (_) { /* ignore */ }
  },

  async requestNativeCameraPermission() {
    const Camera = this.getCameraPlugin();
    if (!Camera?.requestPermissions) return true;
    try {
      const result = await Camera.requestPermissions({ permissions: ['camera'] });
      return result.camera === 'granted' || result.camera === 'limited';
    } catch {
      return false;
    }
  },

  async dataUrlFromWebPath(webPath) {
    if (!webPath) return null;
    try {
      const resp = await fetch(webPath);
      const blob = await resp.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read photo'));
        reader.readAsDataURL(blob);
      });
    } catch (_) {
      return null;
    }
  },

  normalizePhotoData(photo) {
    if (!photo) return null;
    if (typeof photo === 'string' && photo.startsWith('data:image')) return photo;
    if (photo?.dataUrl && String(photo.dataUrl).startsWith('data:')) return photo.dataUrl;
    if (photo?.base64String) {
      const fmt = String(photo.format || 'jpeg').toLowerCase().replace('jpg', 'jpeg');
      const mime = fmt === 'png' ? 'png' : 'jpeg';
      return `data:image/${mime};base64,${photo.base64String}`;
    }
    return null;
  },

  nativeCameraOptions(direction) {
    return {
      quality: 80,
      allowEditing: false,
      resultType: 'base64',
      source: 'camera',
      direction,
      saveToGallery: false,
      correctOrientation: true,
      promptLabelHeader: 'Take selfie',
      promptLabelCancel: 'Cancel',
      promptLabelPhoto: '',
      promptLabelPicture: 'Take selfie',
      width: 720,
      height: 720
    };
  },

  async captureNativePhoto() {
    const Camera = this.getCameraPlugin();
    if (!Camera?.getPhoto) return null;
    const allowed = await this.requestNativeCameraPermission();
    if (!allowed) throw new Error('Camera permission denied');

    const tryDirection = async (direction) => {
      try {
        return await Camera.getPhoto(this.nativeCameraOptions(direction));
      } catch (_) {
        return Camera.getPhoto({
          ...this.nativeCameraOptions(direction),
          resultType: 'uri',
          width: 720
        });
      }
    };

    let photo;
    try {
      photo = await tryDirection('front');
    } catch (frontErr) {
      try {
        photo = await tryDirection('rear');
      } catch (rearErr) {
        throw new Error(rearErr.message || frontErr.message || 'Camera unavailable');
      }
    }

    const fromFields = this.normalizePhotoData(photo);
    if (fromFields) return fromFields;
    if (photo?.webPath) {
      const fromPath = await this.dataUrlFromWebPath(photo.webPath);
      if (fromPath) return fromPath;
    }
    return null;
  },

  async captureNativeSelfie() {
    return this.captureNativePhoto();
  },

  async openWebCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera is not available in this browser');
    }
    const attempts = [
      { video: { facingMode: { exact: 'user' }, width: { ideal: 720 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: { facingMode: { ideal: 'user' } }, audio: false },
      { video: true, audio: false }
    ];
    let lastErr;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Could not open camera');
  },

  promptForAction(employee, eventType, opts = {}) {
    return new Promise((resolve, reject) => {
      const overlay = document.createElement('div');
      overlay.className = 'staff-action-selfie-overlay';
      const panel = document.createElement('div');
      panel.className = 'staff-action-selfie-panel';
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        this.stopCamera();
        overlay.remove();
        if (ok) resolve(true);
        else reject(new Error('Selfie cancelled'));
      };
      const titles = {
        break_start: 'Start break — take a selfie to confirm',
        break_end: 'End break — take a selfie to confirm',
        clock_out: 'Clock out — take a selfie to confirm',
        clock_in: 'Clock in — take a selfie to confirm'
      };
      const confirmLabels = {
        clock_in: 'Confirm clock in',
        break_start: 'Confirm start break',
        break_end: 'Confirm end break',
        clock_out: 'Confirm clock out'
      };
      this.render(panel, employee, () => finish(true), {
        pin: opts.pin,
        eventType,
        heading: titles[eventType] || 'Take a selfie',
        confirmLabel: confirmLabels[eventType] || 'Save photo & continue',
        hideSkip: true,
        onCancel: () => finish(false)
      });
    });
  },

  async render(container, employee, onComplete, opts = {}) {
    const loginPin = opts.pin || null;
    const eventType = opts.eventType || 'login';
    const heading = opts.heading || '📸 Verification Selfie';
    const confirmLabel = opts.confirmLabel || 'Continue to Portal';
    const hideSkip = !!opts.hideSkip;
    this.stopCamera();
    this._capturing = false;
    this.ensureStaffPortalScreen();
    if (!container) return;
    const required = hideSkip || this.selfieRequired();
    const name = Utils.escHtml(employee?.full_name || 'Employee');
    container._selfiePhoto = null;

    const paintShell = () => {
      container.innerHTML = `<div class="staff-gate card" style="max-width:480px;margin:24px auto;padding:24px;text-align:center">
        <h2>${Utils.escHtml(heading)}</h2>
        <p class="muted">Hi <strong>${name}</strong> — ${required ? 'a live selfie is required.' : 'take a live selfie to open the staff portal.'}</p>
        <div id="selfie-preview-wrap" style="margin:16px 0;min-height:220px;display:flex;align-items:center;justify-content:center;background:#111;border-radius:12px;overflow:hidden">
          <video id="selfie-video" autoplay playsinline muted webkit-playsinline style="width:100%;max-width:360px;border-radius:12px;background:#111;display:none;transform:scaleX(-1)"></video>
          <img id="selfie-preview" alt="Selfie preview" style="width:100%;max-width:360px;border-radius:12px;display:none;object-fit:cover;transform:scaleX(-1)">
          <canvas id="selfie-canvas" style="display:none"></canvas>
          <p id="selfie-placeholder" class="muted" style="padding:24px;color:#ddd">Opening front camera…</p>
        </div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px">
          <button type="button" class="btn btn-primary" id="selfie-start-cam">Open Camera</button>
          <button type="button" class="btn btn-success" id="selfie-snap" style="display:none">Take Selfie</button>
          <button type="button" class="btn btn-ghost" id="selfie-retake" style="display:none">Retake</button>
        </div>
        <button type="button" class="btn btn-primary btn-lg" id="selfie-confirm" style="width:100%;margin-top:16px;display:none">${Utils.escHtml(confirmLabel)}</button>
        ${required ? '' : `<button type="button" class="btn btn-ghost btn-sm" id="selfie-skip" style="width:100%;margin-top:10px">Continue without selfie</button>`}
        ${opts.onCancel ? `<button type="button" class="btn btn-ghost btn-sm" id="selfie-cancel" style="width:100%;margin-top:8px">Cancel</button>` : ''}
        <p class="muted" style="font-size:12px;margin-top:12px">Front camera opens first. Gallery / photos are not allowed.</p>
      </div>`;
    };

    paintShell();

    const els = () => ({
      video: document.getElementById('selfie-video'),
      preview: document.getElementById('selfie-preview'),
      canvas: document.getElementById('selfie-canvas'),
      snapBtn: document.getElementById('selfie-snap'),
      confirmBtn: document.getElementById('selfie-confirm'),
      startBtn: document.getElementById('selfie-start-cam'),
      retakeBtn: document.getElementById('selfie-retake'),
      skipBtn: document.getElementById('selfie-skip'),
      cancelBtn: document.getElementById('selfie-cancel'),
      placeholder: document.getElementById('selfie-placeholder')
    });

    const currentPhoto = () => container._selfiePhoto || null;

    const finish = (emp) => {
      this.stopCamera();
      this.ensureStaffPortalScreen();
      if (onComplete) onComplete(emp || employee);
    };

    const showPhoto = (dataUrl) => {
      this.ensureStaffPortalScreen();
      if (!dataUrl) {
        Utils.toast('No selfie captured — open the camera again', 'error');
        return;
      }
      if (!document.getElementById('selfie-preview') || !container.contains(document.getElementById('selfie-preview'))) {
        paintShell();
        bindControls();
      }
      container._selfiePhoto = dataUrl;
      this.stopCamera();
      const { video, preview, snapBtn, confirmBtn, startBtn, retakeBtn, placeholder } = els();
      if (video) {
        video.style.display = 'none';
        video.srcObject = null;
      }
      if (placeholder) {
        placeholder.style.display = 'none';
        placeholder.textContent = 'Selfie captured';
      }
      if (preview) {
        preview.onload = () => { preview.style.display = 'block'; };
        preview.onerror = () => {
          preview.style.display = 'none';
          if (placeholder) {
            placeholder.style.display = 'block';
            placeholder.textContent = 'Selfie captured — confirm below';
          }
        };
        preview.src = dataUrl;
        preview.style.display = 'block';
      }
      if (snapBtn) snapBtn.style.display = 'none';
      if (startBtn) startBtn.style.display = 'none';
      if (retakeBtn) retakeBtn.style.display = 'inline-flex';
      if (confirmBtn) {
        confirmBtn.style.display = 'block';
        confirmBtn.disabled = false;
        confirmBtn.textContent = confirmLabel;
      }
    };

    const startWebPreview = async () => {
      this.stopCamera();
      this._stream = await this.openWebCamera();
      const { video, preview, snapBtn, startBtn, placeholder } = els();
      if (placeholder) placeholder.style.display = 'none';
      if (preview) preview.style.display = 'none';
      if (video) {
        video.setAttribute('playsinline', 'true');
        video.setAttribute('webkit-playsinline', 'true');
        video.muted = true;
        video.srcObject = this._stream;
        video.style.display = 'block';
        try { await video.play(); } catch (_) { /* autoplay may need the tap */ }
      }
      if (snapBtn) snapBtn.style.display = 'inline-flex';
      if (startBtn) {
        startBtn.textContent = 'Re-open Camera';
        startBtn.style.display = 'inline-flex';
      }
    };

    const bindControls = () => {
      const { snapBtn, confirmBtn, startBtn, retakeBtn, skipBtn } = els();
      const useNativeCamera = this.isNative() && !!this.getCameraPlugin();

      startBtn?.addEventListener('click', async () => {
        if (this._capturing) return;
        if (useNativeCamera) {
          this._capturing = true;
          startBtn.disabled = true;
          startBtn.textContent = 'Opening camera…';
          try {
            const dataUrl = await this.captureNativePhoto();
            this.ensureStaffPortalScreen();
            if (!dataUrl) throw new Error('No photo captured');
            showPhoto(dataUrl);
          } catch (err) {
            this.ensureStaffPortalScreen();
            if (!document.getElementById('selfie-start-cam')) {
              paintShell();
              bindControls();
            }
            Utils.toast(err.message || 'Allow camera access, then try again', 'error');
            const again = els().startBtn;
            if (again) {
              again.disabled = false;
              again.textContent = 'Open Camera';
              again.style.display = 'inline-flex';
            }
          } finally {
            this._capturing = false;
            const again = els().startBtn;
            if (again && !currentPhoto()) {
              again.disabled = false;
              again.textContent = 'Open Camera';
            }
          }
          return;
        }
        try {
          await startWebPreview();
        } catch (err) {
          Utils.toast(err.message || 'Allow camera access, then try again', 'error');
        }
      });

      snapBtn?.addEventListener('click', () => {
        const v = els().video;
        const c = els().canvas;
        if (!v || !c) return;
        const w = v.videoWidth || 640;
        const h = v.videoHeight || 480;
        if (!w || !h) return Utils.toast('Camera is still starting — wait a second', 'error');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(v, 0, 0);
        showPhoto(c.toDataURL('image/jpeg', 0.85));
      });

      retakeBtn?.addEventListener('click', () => {
        container._selfiePhoto = null;
        paintShell();
        bindControls();
        if (!useNativeCamera) startWebPreview().catch(() => {});
      });

      skipBtn?.addEventListener('click', () => {
        if (this.selfieRequired() || hideSkip) return Utils.toast('Admin requires a verification selfie', 'error');
        finish(employee);
      });

      els().cancelBtn?.addEventListener('click', () => {
        this.stopCamera();
        if (typeof opts.onCancel === 'function') opts.onCancel();
      });

      confirmBtn?.addEventListener('click', async () => {
        const photoData = currentPhoto();
        if (!photoData) return Utils.toast('Take a selfie with the camera first', 'error');
        const btn = els().confirmBtn;
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Saving…';
        }
        try {
          const r = await API.saveStaffSelfie({
            employee_id: employee.id,
            employee_name: employee.full_name,
            photo_data: photoData,
            pin: loginPin || undefined,
            event_type: eventType,
            device_info: JSON.stringify({
              event_type: eventType,
              ua: navigator.userAgent?.slice(0, 200) || ''
            })
          });
          if (!r.success) {
            if (btn) {
              btn.disabled = false;
              btn.textContent = confirmLabel;
            }
            const authErr = /auth|session|login|pin/i.test(String(r.error || ''));
            if (!this.selfieRequired()) {
              Utils.toast((r.error || 'Could not save selfie') + ' — continuing without saving', 'error');
              return finish(employee);
            }
            return Utils.toast(authErr ? 'Session expired — go back and sign in again, then retake your selfie' : (r.error || 'Could not save selfie'), 'error');
          }
          const done = {
            clock_in: 'Photo saved — confirming clock in',
            break_start: 'Photo saved — confirming start break',
            break_end: 'Photo saved — confirming end break',
            clock_out: 'Photo saved — confirming clock out'
          }[eventType] || 'Verification complete';
          Utils.toast(done, 'success');
          finish(employee);
        } catch (err) {
            if (btn) {
              btn.disabled = false;
              btn.textContent = confirmLabel;
            }
            if (!this.selfieRequired() && !hideSkip) {
            Utils.toast((err.message || 'Could not save selfie') + ' — continuing without saving', 'error');
            return finish(employee);
          }
          Utils.toast(err.message || 'Could not save selfie', 'error');
        }
      });
    };

    bindControls();
    const useNativeCamera = this.isNative() && !!this.getCameraPlugin();
    if (!useNativeCamera) {
      startWebPreview().catch((err) => {
        const ph = els().placeholder;
        if (ph) ph.textContent = err.message || 'Tap Open Camera to start the front camera.';
      });
    } else {
      const ph = els().placeholder;
      if (ph) ph.textContent = 'Tap Open Camera — front selfie opens first.';
    }
  }
};

window.StaffSelfieCapture = StaffSelfieCapture;

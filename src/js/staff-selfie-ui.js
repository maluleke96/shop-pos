/** Shared staff login selfie capture (camera / file upload) */
const StaffSelfieCapture = {
  _stream: null,
  _capturing: false,

  isNative() {
    return !!(window.Capacitor?.isNativePlatform?.() || window.__SHOP_POS_MOBILE__);
  },

  getCameraPlugin() {
    return window.Capacitor?.Plugins?.Camera || null;
  },

  stopCamera() {
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
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

  async captureNativeSelfie() {
    const Camera = this.getCameraPlugin();
    if (!Camera?.getPhoto) return null;
    const allowed = await this.requestNativeCameraPermission();
    if (!allowed) throw new Error('Camera permission denied');

    // Base64 is more reliable than dataUrl on Android Capacitor (avoids blank WebView returns).
    let photo;
    try {
      photo = await Camera.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: 'base64',
        source: 'camera',
        direction: 'front',
        saveToGallery: false,
        correctOrientation: true,
        width: 480,
        height: 480
      });
    } catch (err) {
      // Fallback: uri / webPath then convert
      try {
        photo = await Camera.getPhoto({
          quality: 70,
          allowEditing: false,
          resultType: 'uri',
          source: 'camera',
          direction: 'front',
          saveToGallery: false,
          correctOrientation: true,
          width: 480
        });
      } catch (err2) {
        throw new Error(err2.message || err.message || 'Camera unavailable');
      }
    }

    if (photo?.base64String) {
      const fmt = String(photo.format || 'jpeg').toLowerCase();
      const mime = fmt === 'png' ? 'png' : 'jpeg';
      return `data:image/${mime};base64,${photo.base64String}`;
    }
    if (photo?.dataUrl) return photo.dataUrl;
    if (photo?.webPath) {
      const fromPath = await this.dataUrlFromWebPath(photo.webPath);
      if (fromPath) return fromPath;
    }
    return null;
  },

  async render(container, employee, onComplete) {
    this.stopCamera();
    this._capturing = false;
    this.ensureStaffPortalScreen();
    if (!container) return;

    const paintShell = () => {
      container.innerHTML = `<div class="staff-gate card" style="max-width:480px;margin:24px auto;padding:24px;text-align:center">
        <h2>📸 Verification Selfie</h2>
        <p class="muted">Hi <strong>${employee.full_name}</strong> — take a selfie to open the staff portal.</p>
        <div id="selfie-preview-wrap" style="margin:16px 0;min-height:180px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.04);border-radius:12px">
          <video id="selfie-video" autoplay playsinline muted style="width:100%;max-width:360px;border-radius:12px;background:#111;display:none"></video>
          <img id="selfie-preview" alt="Selfie preview" style="width:100%;max-width:360px;border-radius:12px;display:none;object-fit:cover">
          <canvas id="selfie-canvas" style="display:none"></canvas>
          <p id="selfie-placeholder" class="muted" style="padding:24px">Tap <strong>Open Camera</strong> to take your verification photo.</p>
        </div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px">
          <button type="button" class="btn btn-primary" id="selfie-start-cam">Open Camera</button>
          <button type="button" class="btn btn-success" id="selfie-snap" style="display:none">Take Selfie</button>
          <button type="button" class="btn btn-ghost" id="selfie-retake" style="display:none">Retake</button>
        </div>
        <button type="button" class="btn btn-primary btn-lg" id="selfie-confirm" style="width:100%;margin-top:16px;display:none">Continue to Portal</button>
        <p class="muted" style="font-size:12px;margin-top:12px">Your photo is saved for attendance verification.</p>
      </div>`;
    };

    paintShell();

    let photoData = null;
    const els = () => ({
      video: document.getElementById('selfie-video'),
      preview: document.getElementById('selfie-preview'),
      canvas: document.getElementById('selfie-canvas'),
      snapBtn: document.getElementById('selfie-snap'),
      confirmBtn: document.getElementById('selfie-confirm'),
      startBtn: document.getElementById('selfie-start-cam'),
      retakeBtn: document.getElementById('selfie-retake'),
      placeholder: document.getElementById('selfie-placeholder')
    });

    const showPhoto = (dataUrl) => {
      this.ensureStaffPortalScreen();
      // If Android wiped the selfie UI while the camera was open, rebuild it.
      if (!document.getElementById('selfie-preview') || !container.contains(document.getElementById('selfie-preview'))) {
        paintShell();
        bindControls();
      }
      const { video, preview, snapBtn, confirmBtn, startBtn, retakeBtn, placeholder } = els();
      photoData = dataUrl;
      this.stopCamera();
      if (video) {
        video.style.display = 'none';
        video.srcObject = null;
      }
      if (placeholder) placeholder.style.display = 'none';
      if (preview) {
        preview.onload = () => { preview.style.display = 'block'; };
        preview.onerror = () => {
          Utils.toast('Could not display photo — please retake', 'error');
          photoData = null;
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
        confirmBtn.textContent = 'Continue to Portal';
      }
    };

    const bindControls = () => {
      const { video, preview, canvas, snapBtn, confirmBtn, startBtn, retakeBtn } = els();
      const useNativeCamera = this.isNative() && !!this.getCameraPlugin();

      startBtn?.addEventListener('click', async () => {
        if (this._capturing) return;
        if (useNativeCamera) {
          this._capturing = true;
          startBtn.disabled = true;
          startBtn.textContent = 'Opening camera…';
          try {
            const dataUrl = await this.captureNativeSelfie();
            this.ensureStaffPortalScreen();
            if (!dataUrl) throw new Error('No photo captured');
            showPhoto(dataUrl);
          } catch (err) {
            this.ensureStaffPortalScreen();
            // Rebuild shell if camera activity left a blank root
            if (!document.getElementById('selfie-start-cam')) {
              paintShell();
              bindControls();
            }
            Utils.toast(err.message || 'Camera unavailable — allow camera access and try again', 'error');
            const again = els().startBtn;
            if (again) {
              again.disabled = false;
              again.textContent = 'Open Camera';
              again.style.display = 'inline-flex';
            }
          } finally {
            this._capturing = false;
            const again = els().startBtn;
            if (again && !photoData) {
              again.disabled = false;
              again.textContent = 'Open Camera';
            }
          }
          return;
        }
        try {
          this._stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
          });
          const v = els().video;
          const ph = els().placeholder;
          if (ph) ph.style.display = 'none';
          if (v) {
            v.srcObject = this._stream;
            v.style.display = 'block';
            await v.play();
          }
          if (preview) preview.style.display = 'none';
          if (snapBtn) snapBtn.style.display = 'inline-flex';
        } catch (err) {
          Utils.toast('Camera unavailable — please allow camera access and try again', 'error');
        }
      });

      snapBtn?.addEventListener('click', () => {
        const v = els().video;
        const c = els().canvas;
        if (!v || !c) return;
        c.width = v.videoWidth || 640;
        c.height = v.videoHeight || 480;
        c.getContext('2d').drawImage(v, 0, 0);
        showPhoto(c.toDataURL('image/jpeg', 0.85));
      });

      retakeBtn?.addEventListener('click', () => {
        photoData = null;
        paintShell();
        bindControls();
      });

      confirmBtn?.addEventListener('click', async () => {
        if (!photoData) return Utils.toast('Take or upload a selfie first', 'error');
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
            device_info: navigator.userAgent?.slice(0, 200) || ''
          });
          if (!r.success) {
            if (btn) {
              btn.disabled = false;
              btn.textContent = 'Continue to Portal';
            }
            return Utils.toast(r.error || 'Could not save selfie', 'error');
          }
          this.stopCamera();
          Utils.toast('Verification complete', 'success');
          this.ensureStaffPortalScreen();
          if (onComplete) onComplete(employee);
        } catch (err) {
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Continue to Portal';
          }
          Utils.toast(err.message || 'Could not save selfie', 'error');
        }
      });
    };

    bindControls();
    // Do NOT auto-open the native camera — on Android that often returns to a blank WebView.
  }
};

window.StaffSelfieCapture = StaffSelfieCapture;

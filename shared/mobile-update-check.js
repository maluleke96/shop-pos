/**
 * Remote update checker for installed Android apps.
 * When you deploy a newer version online, phones show a professional update popup
 * and download the latest APK from your shop server — no need to visit in person.
 */
(function () {
  const DEFAULT_CLOUD = 'https://chisafood.up.railway.app';
  const CHECK_INTERVAL_MS = 15 * 60 * 1000;
  const SNOOZE_MS = 4 * 60 * 60 * 1000;

  function isNative() {
    try {
      if (window.Capacitor?.isNativePlatform?.()) return true;
    } catch (_) { /* ignore */ }
    return !!(window.__SHOP_POS_MOBILE__ || window.__SHOP_POS_LOCAL_INSTALLER__);
  }

  function apiBase() {
    const cfg = window.__EXPENSE_CONFIG__ || window.__DRIVER_CONFIG__ || window.__ORDER_CONFIG__ || window.__MANAGER_CONFIG__ || {};
    const env = window.__SHOP_POS_ENV__ || {};
    return String(
      cfg.apiBase || env.SHOP_POS_SYNC_URL || env.SHOP_POS_CLOUD_URL || env.SHOP_POS_PUBLIC_URL || DEFAULT_CLOUD
    ).replace(/\/$/, '');
  }

  async function getCurrentVersion() {
    try {
      const App = window.Capacitor?.Plugins?.App;
      if (App?.getInfo) {
        const info = await App.getInfo();
        const build = parseInt(String(info.build || '').replace(/\D/g, ''), 10) || 0;
        return { appId: info.id, versionName: info.version || '0', versionCode: build };
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  function loadSnooze() {
    try {
      const raw = JSON.parse(localStorage.getItem('shoppos_update_snooze') || '{}');
      if (raw.version && Date.now() - (raw.at || 0) < SNOOZE_MS) return raw.version;
    } catch (_) { /* ignore */ }
    return null;
  }

  function saveSnooze(version) {
    localStorage.setItem('shoppos_update_snooze', JSON.stringify({ version, at: Date.now() }));
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function injectStyles() {
    if (document.getElementById('shoppos-update-styles')) return;
    const style = document.createElement('style');
    style.id = 'shoppos-update-styles';
    style.textContent = `
      .sp-update-overlay {
        position: fixed; inset: 0; z-index: 2147483646;
        display: flex; align-items: center; justify-content: center;
        padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
        background: rgba(8, 12, 24, 0.92);
        backdrop-filter: blur(8px);
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        animation: spUpdateFadeIn 0.35s ease;
      }
      @keyframes spUpdateFadeIn { from { opacity: 0; } to { opacity: 1; } }
      .sp-update-card {
        width: 100%; max-width: 400px;
        background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
        border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 20px;
        box-shadow: 0 24px 64px rgba(0,0,0,0.45);
        color: #f8fafc;
        overflow: hidden;
      }
      .sp-update-hero {
        padding: 28px 24px 20px;
        text-align: center;
        background: linear-gradient(135deg, rgba(37,99,235,0.25), rgba(99,102,241,0.15));
        border-bottom: 1px solid rgba(148,163,184,0.15);
      }
      .sp-update-logo {
        width: 64px; height: 64px; border-radius: 16px;
        object-fit: cover; background: #334155;
        margin: 0 auto 14px; display: block;
        box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      }
      .sp-update-logo-fallback {
        width: 64px; height: 64px; border-radius: 16px;
        margin: 0 auto 14px; display: flex; align-items: center; justify-content: center;
        background: linear-gradient(135deg, #2563eb, #6366f1);
        font-size: 28px; box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      }
      .sp-update-hero h2 {
        margin: 0 0 6px; font-size: 1.35rem; font-weight: 700; letter-spacing: -0.02em;
      }
      .sp-update-hero p { margin: 0; color: #cbd5e1; font-size: 0.92rem; line-height: 1.45; }
      .sp-update-body { padding: 20px 24px 24px; }
      .sp-update-versions {
        display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center;
        margin-bottom: 16px;
      }
      .sp-update-ver {
        background: rgba(15,23,42,0.8); border: 1px solid rgba(148,163,184,0.2);
        border-radius: 12px; padding: 10px 12px; text-align: center;
      }
      .sp-update-ver small { display: block; color: #94a3b8; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
      .sp-update-ver strong { font-size: 1rem; color: #f1f5f9; }
      .sp-update-arrow { color: #60a5fa; font-size: 1.2rem; text-align: center; }
      .sp-update-notes {
        background: rgba(30,41,59,0.9); border-radius: 12px; padding: 12px 14px;
        margin-bottom: 18px; font-size: 0.88rem; line-height: 1.5; color: #cbd5e1;
        border-left: 3px solid #3b82f6;
      }
      .sp-update-steps {
        font-size: 0.82rem; color: #94a3b8; line-height: 1.45; margin: 0 0 18px;
        padding: 0; list-style: none;
      }
      .sp-update-steps li { padding: 4px 0 4px 22px; position: relative; }
      .sp-update-steps li::before {
        content: counter(step); counter-increment: step;
        position: absolute; left: 0; top: 4px;
        width: 16px; height: 16px; border-radius: 50%;
        background: #334155; color: #e2e8f0; font-size: 0.65rem;
        display: flex; align-items: center; justify-content: center;
      }
      .sp-update-steps { counter-reset: step; }
      .sp-update-btn-primary {
        width: 100%; padding: 15px 18px; border: none; border-radius: 12px;
        background: linear-gradient(135deg, #2563eb, #4f46e5);
        color: #fff; font-size: 1rem; font-weight: 700; cursor: pointer;
        box-shadow: 0 8px 24px rgba(37,99,235,0.35);
        margin-bottom: 10px;
      }
      .sp-update-btn-primary:disabled { opacity: 0.65; cursor: wait; }
      .sp-update-btn-primary:active { transform: scale(0.98); }
      .sp-update-btn-ghost {
        width: 100%; padding: 12px; border: 1px solid rgba(148,163,184,0.35);
        border-radius: 12px; background: transparent; color: #94a3b8;
        font-size: 0.9rem; cursor: pointer;
      }
      .sp-update-status {
        text-align: center; font-size: 0.85rem; color: #93c5fd;
        margin: 0 0 12px; min-height: 1.2em;
      }
      .sp-update-status.error { color: #fca5a5; }
      .sp-update-fallback {
        text-align: center; font-size: 0.82rem; margin-top: 12px;
      }
      .sp-update-fallback a { color: #60a5fa; font-weight: 600; }
      .sp-update-required {
        text-align: center; font-size: 0.78rem; color: #fbbf24; margin-top: 12px;
      }
      body.sp-update-blocked { overflow: hidden !important; }
    `;
    document.head.appendChild(style);
  }

  function setUpdateStatus(msg, isError) {
    const el = document.getElementById('shoppos-update-status');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }

  function nativeDownloadBridge() {
    try {
      return window.ShopPosAndroid || null;
    } catch (_) {
      return null;
    }
  }

  function bindNativeDownloadEvents() {
    if (window.MobileUpdateCheck._nativeEventsBound) return;
    window.MobileUpdateCheck._nativeEventsBound = true;
    window.addEventListener('shoppos-apk-download-started', () => {
      setUpdateStatus('Downloading… watch for the notification at the top of your screen.');
      const btn = document.getElementById('shoppos-update-download');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Downloading…';
      }
    });
    window.addEventListener('shoppos-apk-download-complete', () => {
      setUpdateStatus('Download complete — tap the notification, or tap Install now below.');
      const btn = document.getElementById('shoppos-update-download');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Install now';
        btn.dataset.mode = 'install';
      }
    });
    window.addEventListener('shoppos-apk-download-error', (e) => {
      setUpdateStatus((e.detail && e.detail.message) || 'Download failed — try again.', true);
      const btn = document.getElementById('shoppos-update-download');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Install update now';
        btn.dataset.mode = 'download';
      }
    });
  }

  async function openDownload(apkUrl, fileName) {
    const url = String(apkUrl || '').trim();
    if (!url) {
      setUpdateStatus('Download link missing — ask admin to upload the APK.', true);
      return;
    }
    const btn = document.getElementById('shoppos-update-download');
    if (btn?.dataset.mode === 'install') {
      try {
        nativeDownloadBridge()?.installDownloadedUpdate?.();
        setUpdateStatus('Opening installer — tap Install to replace the old app.');
      } catch (_) {
        setUpdateStatus('Could not open installer — tap the download notification instead.', true);
      }
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Starting download…';
      btn.dataset.mode = 'download';
    }
    setUpdateStatus('Starting download…');

    try {
      const bridge = nativeDownloadBridge();
      if (bridge?.downloadUpdate) {
        bindNativeDownloadEvents();
        try {
          localStorage.setItem('shoppos_pending_update_version', window.MobileUpdateCheck._targetVersion || '');
        } catch (_) { /* ignore */ }
        bridge.downloadUpdate(url, fileName || 'ShopPOS-update.apk');
        return;
      }
      if (window.Capacitor?.isNativePlatform?.()) {
        setUpdateStatus('Opening system download…');
        window.location.href = url;
        setTimeout(() => {
          setUpdateStatus('Check your notifications — tap the download when it finishes.');
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Install update now';
          }
        }, 1500);
        return;
      }
    } catch (err) {
      console.warn('[MobileUpdateCheck] native download', err);
    }

    try {
      setUpdateStatus('Downloading…');
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName || url.split('/').pop() || 'ShopPOS-update.apk';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        a.remove();
      }, 2000);
      setUpdateStatus('Download started.');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Install update now';
      }
      return;
    } catch (err) {
      console.warn('[MobileUpdateCheck] blob download', err);
    }

    try {
      window.open(url, '_blank');
      setUpdateStatus('If nothing happened, use the manual link below.', true);
    } catch (_) {
      setUpdateStatus('Could not start download — use the manual link below.', true);
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Install update now';
    }
  }

  function showUpdateModal(remote, cur) {
    if (document.getElementById('shoppos-update-overlay')) return;
    injectStyles();
    const force = remote.force === true;
    const base = apiBase();
    const apkUrl = remote.apkUrl || `${base}/downloads/${remote.apkFile || ''}`;
    const overlay = document.createElement('div');
    overlay.id = 'shoppos-update-overlay';
    overlay.className = 'sp-update-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="sp-update-card">
        <div class="sp-update-hero">
          <img class="sp-update-logo" src="${base}/api/logo" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="sp-update-logo-fallback" style="display:none">⬆</div>
          <h2>Software update available</h2>
          <p>A new version of <strong>${esc(remote.label || 'Shop POS')}</strong> is ready. Please update to continue with the latest features and fixes.</p>
        </div>
        <div class="sp-update-body">
          <div class="sp-update-versions">
            <div class="sp-update-ver"><small>Installed</small><strong>v${esc(cur.versionName)}</strong></div>
            <div class="sp-update-arrow">→</div>
            <div class="sp-update-ver"><small>Latest</small><strong>v${esc(remote.versionName)}</strong></div>
          </div>
          ${remote.notes ? `<div class="sp-update-notes">${esc(remote.notes)}</div>` : ''}
          <ol class="sp-update-steps">
            <li>Tap <strong>Install update now</strong> — the update downloads</li>
            <li>When the <strong>notification</strong> appears, tap it (or tap <strong>Install now</strong>)</li>
            <li>Tap <strong>Install</strong> — Android replaces the old app automatically</li>
            <li>When finished, tap <strong>Open</strong> to use the updated app</li>
          </ol>
          <p class="sp-update-status" id="shoppos-update-status"></p>
          <button type="button" class="sp-update-btn-primary" id="shoppos-update-download">Install update now</button>
          ${force ? '' : '<button type="button" class="sp-update-btn-ghost" id="shoppos-update-later">Remind me in 4 hours</button>'}
          <p class="sp-update-fallback"><a href="${esc(apkUrl)}" id="shoppos-update-manual-link">Tap here if the button does nothing</a></p>
          ${force ? '<p class="sp-update-required">This update is required before you can use the app.</p>' : ''}
        </div>
      </div>`;
    document.body.classList.add('sp-update-blocked');
    document.body.appendChild(overlay);

    const downloadBtn = document.getElementById('shoppos-update-download');
    downloadBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDownload(apkUrl, remote.apkFile || 'ShopPOS-update.apk');
    });

    document.getElementById('shoppos-update-manual-link')?.addEventListener('click', (e) => {
      if (!window.Capacitor?.isNativePlatform?.()) return;
      e.preventDefault();
      openDownload(apkUrl, remote.apkFile || 'ShopPOS-update.apk');
    });

    if (!force) {
      document.getElementById('shoppos-update-later')?.addEventListener('click', () => {
        saveSnooze(remote.versionName);
        document.body.classList.remove('sp-update-blocked');
        overlay.remove();
      });
    }
  }

  async function check(force) {
    if (!isNative()) return false;
    if (navigator.onLine === false) return false;
    if (window.MobileUpdateCheck._checking) return false;
    window.MobileUpdateCheck._checking = true;
    try {
      const cur = await getCurrentVersion();
      if (!cur?.appId) return false;
      const res = await fetch(`${apiBase()}/api/mobile-releases.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return false;
      const manifest = await res.json();
      const remote = manifest[cur.appId];
      if (!remote) return false;
      const remoteCode = Number(remote.versionCode) || 0;
      if (remoteCode <= (Number(cur.versionCode) || 0)) return false;
      const snoozed = loadSnooze();
      if (!force && !remote.force && snoozed === remote.versionName) return false;
      window.MobileUpdateCheck._targetVersion = remote.versionName || '';
      showUpdateModal(remote, cur);
      return true;
    } catch (_) {
      return false;
    } finally {
      window.MobileUpdateCheck._checking = false;
    }
  }

  window.MobileUpdateCheck = {
    _checking: false,
    _interval: null,
    isNative,
    apiBase,
    check,
    openDownload,
    async maybeShowOpenAfterUpdate() {
      if (!isNative()) return;
      try {
        const pending = localStorage.getItem('shoppos_pending_update_version');
        if (!pending) return;
        const cur = await getCurrentVersion();
        if (!cur?.versionName || cur.versionName !== pending) return;
        localStorage.removeItem('shoppos_pending_update_version');
        const overlay = document.getElementById('shoppos-update-overlay');
        if (overlay) overlay.remove();
        document.body.classList.remove('sp-update-blocked');
        injectStyles();
        const done = document.createElement('div');
        done.id = 'shoppos-update-overlay';
        done.className = 'sp-update-overlay';
        done.innerHTML = `<div class="sp-update-card"><div class="sp-update-hero">
          <div class="sp-update-logo-fallback">✓</div>
          <h2>Update installed</h2>
          <p>Your app was updated to <strong>v${esc(cur.versionName)}</strong>.</p>
        </div><div class="sp-update-body">
          <button type="button" class="sp-update-btn-primary" id="shoppos-update-open">Open</button>
        </div></div>`;
        document.body.appendChild(done);
        document.getElementById('shoppos-update-open')?.addEventListener('click', () => {
          done.remove();
          window.location.reload();
        });
      } catch (_) { /* ignore */ }
    },

    init() {
      if (!isNative()) return;
      injectStyles();
      bindNativeDownloadEvents();
      this.maybeShowOpenAfterUpdate();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.maybeShowOpenAfterUpdate();
      });
      const run = () => check(false);
      if (navigator.onLine !== false) {
        setTimeout(run, 800);
        setTimeout(run, 3500);
      }
      window.addEventListener('online', () => check(true));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine !== false) check(true);
      });
      if (window.MobileUpdateCheck._interval) clearInterval(window.MobileUpdateCheck._interval);
      window.MobileUpdateCheck._interval = setInterval(() => {
        if (navigator.onLine !== false) check(false);
      }, CHECK_INTERVAL_MS);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.MobileUpdateCheck.init());
  } else {
    window.MobileUpdateCheck.init();
  }
})();

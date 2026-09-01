/**
 * Connection indicator — Admin corner pill + POS till badge (Local till / Cloud linked).
 */
(function () {
  const ID = 'shoppos-conn-status';

  function ensureEl() {
    let el = document.getElementById(ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = ID;
    el.className = 'conn-status conn-online';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="conn-dot"></span><span class="conn-text">Online</span>';
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  function isPosKiosk() {
    return window.__SHOP_POS_APP_MODE__ === 'pos';
  }

  function dataMode() {
    if (window.__SHOP_POS_CLOUD__) return 'cloud';
    if (window.__SHOP_POS_LOCAL_INSTALLER__) return 'local';
    return 'local';
  }

  function posHint(mode) {
    if (mode === 'cloud') {
      return 'Connected to the cloud shop — online website orders appear on this till.';
    }
    return 'Data is saved on this PC. Sales sync to the cloud when online. Website orders need Cloud POS or Admin → Online Orders.';
  }

  function ensurePosBadge() {
    let badge = document.getElementById('pos-conn-badge');
    if (badge) return badge;
    const bar = document.getElementById('pos-shift-bar');
    if (bar) {
      badge = document.createElement('span');
      badge.id = 'pos-conn-badge';
      badge.className = 'pos-conn-badge';
      badge.setAttribute('role', 'status');
      badge.setAttribute('aria-live', 'polite');
      bar.insertBefore(badge, bar.firstChild);
      return badge;
    }
    if (!isPosKiosk()) return null;
    badge = document.createElement('span');
    badge.id = 'pos-conn-badge';
    badge.className = 'pos-conn-badge pos-conn-badge-floating';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    (document.body || document.documentElement).appendChild(badge);
    return badge;
  }

  function setPos(state, detail) {
    const badge = ensurePosBadge();
    if (!badge) return;
    const mode = dataMode();
    badge.classList.remove('pos-conn-cloud', 'pos-conn-local', 'pos-conn-online', 'pos-conn-offline', 'pos-conn-syncing');
    badge.classList.add(mode === 'cloud' ? 'pos-conn-cloud' : 'pos-conn-local');
    if (state === 'offline') badge.classList.add('pos-conn-offline');
    else if (state === 'syncing') badge.classList.add('pos-conn-syncing');
    else badge.classList.add('pos-conn-online');
    badge.title = posHint(mode);
    if (state === 'offline') {
      badge.textContent = '⚠ Offline';
      badge.style.display = '';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  }

  function set(state, detail) {
    if (isPosKiosk()) {
      setPos(state, detail);
      const el = document.getElementById(ID);
      if (el) el.classList.add('conn-hidden');
      return;
    }
    const el = ensureEl();
    const text = el.querySelector('.conn-text');
    el.classList.remove('conn-online', 'conn-offline', 'conn-syncing', 'conn-hidden');
    if (state === 'hidden') {
      el.classList.add('conn-hidden');
      return;
    }
    if (state === 'offline') {
      el.classList.add('conn-offline');
      if (text) text.textContent = detail || 'Offline';
      return;
    }
    if (state === 'syncing') {
      el.classList.add('conn-syncing');
      if (text) text.textContent = detail || 'Syncing…';
      return;
    }
    el.classList.add('conn-online');
    if (text) text.textContent = detail || 'Online';
  }

  function refreshPosBadge() {
    if (!isPosKiosk()) return;
    const state = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online';
    setPos(state);
  }

  function boot() {
    if (isPosKiosk()) {
      const el = ensureEl();
      el.classList.add('conn-hidden');
      refreshPosBadge();
      window.addEventListener('online', () => setPos('online', 'Back online'));
      window.addEventListener('offline', () => setPos('offline', 'Offline'));
      return;
    }
    ensureEl();
    set(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online');
    window.addEventListener('online', () => set('online', 'Back online'));
    window.addEventListener('offline', () => set('offline', 'Offline'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.ShopPosConnection = { set, setPos, refreshPosBadge, ensureEl, dataMode };
})();

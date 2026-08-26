/**
 * Corner online / offline / syncing indicator — never blocks the whole screen.
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

  function set(state, detail) {
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

  function boot() {
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

  window.ShopPosConnection = { set, ensureEl };
})();

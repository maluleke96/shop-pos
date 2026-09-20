/** Restrict leaving a panel via browser back — logout required. */
(function () {
  let active = false;
  let suspended = false;
  function bind(onLogout) {
    if (active) return;
    active = true;
    try { history.pushState({ panelGuard: true }, '', location.href); } catch (_) { /* */ }
    window.addEventListener('popstate', () => {
      if (!active || suspended) return;
      try { history.pushState({ panelGuard: true }, '', location.href); } catch (_) { /* */ }
      if (confirm('Leave this app? You must log out first.')) {
        active = false;
        if (typeof onLogout === 'function') onLogout();
      }
    });
  }
  function unbind() { active = false; }
  function suspend(ms = 20000) {
    suspended = true;
    if (ms) setTimeout(() => { suspended = false; }, ms);
  }
  function resume() { suspended = false; }
  window.PanelExitGuard = { bind, unbind, suspend, resume };
})();

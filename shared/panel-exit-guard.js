/** Restrict leaving a panel via browser back — logout required. */
(function () {
  let active = false;
  function bind(onLogout) {
    if (active) return;
    active = true;
    try { history.pushState({ panelGuard: true }, '', location.href); } catch (_) { /* */ }
    window.addEventListener('beforeunload', (e) => {
      if (!active) return;
      e.preventDefault();
      e.returnValue = 'Log out to leave this app.';
    });
    window.addEventListener('popstate', () => {
      if (!active) return;
      try { history.pushState({ panelGuard: true }, '', location.href); } catch (_) { /* */ }
      if (confirm('Leave this app? You must log out first.')) {
        active = false;
        if (typeof onLogout === 'function') onLogout();
      }
    });
  }
  function unbind() { active = false; }
  window.PanelExitGuard = { bind, unbind };
})();

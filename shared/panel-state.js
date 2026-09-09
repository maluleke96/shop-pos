/** Persist panel UI state across refresh (same tab). */
(function (root) {
  const PanelState = {
    save(key, data) {
      try { sessionStorage.setItem(key, JSON.stringify({ ...data, ts: Date.now() })); } catch (_) { /* ignore */ }
    },
    load(key, maxAgeMs = 86400000) {
      try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        const o = JSON.parse(raw);
        if (maxAgeMs && o.ts && Date.now() - o.ts > maxAgeMs) return null;
        return o;
      } catch (_) { return null; }
    },
    patch(key, partial, maxAgeMs) {
      const cur = this.load(key, maxAgeMs) || {};
      this.save(key, { ...cur, ...partial });
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PanelState;
  else root.PanelState = PanelState;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : {});

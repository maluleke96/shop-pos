function load() {
  try { return JSON.parse(localStorage.getItem('device-settings') || '{}'); } catch { return {}; }
}
function save(data) {
  const merged = { ...load(), ...data };
  localStorage.setItem('device-settings', JSON.stringify(merged));
  return merged;
}
function clear() { localStorage.removeItem('device-settings'); }
module.exports = { load, save, clear };

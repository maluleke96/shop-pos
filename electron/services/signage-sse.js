/** In-memory SSE hub for signage device push (polling remains fallback). */
const deviceChannels = new Map();

function subscribeDevice(deviceId, res) {
  const id = Number(deviceId);
  if (!deviceChannels.has(id)) deviceChannels.set(id, new Set());
  deviceChannels.get(id).add(res);
  res.on('close', () => {
    deviceChannels.get(id)?.delete(res);
  });
}

function notifyDevice(deviceId, event = 'update', data = {}) {
  const set = deviceChannels.get(Number(deviceId));
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify({ ...data, ts: Date.now() })}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch (_) { /* */ }
  }
}

function notifyAllDevices(deviceIds, event, data) {
  for (const id of deviceIds) notifyDevice(id, event, data);
}

module.exports = { subscribeDevice, notifyDevice, notifyAllDevices };

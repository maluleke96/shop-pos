/** Cross-platform PDF bytes (works in Electron Node and Capacitor browser bundle — no Buffer). */
function pdfBytes(doc) {
  const ab = doc.output('arraybuffer');
  return ab instanceof ArrayBuffer ? new Uint8Array(ab) : new Uint8Array(ab || []);
}

function toUint8(data) {
  if (!data) return new Uint8Array(0);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(data);
  if (data?.type === 'Buffer' && Array.isArray(data.data)) return new Uint8Array(data.data);
  if (data?.data && (data.data instanceof ArrayBuffer || Array.isArray(data.data) || data.data instanceof Uint8Array)) {
    return toUint8(data.data);
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(data)) return new Uint8Array(data);
  try { return new Uint8Array(data); } catch (_) { return new Uint8Array(0); }
}

module.exports = { pdfBytes, toUint8 };

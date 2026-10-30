/** Cross-platform PDF bytes (works in Electron Node and Capacitor browser bundle — no Buffer). */
function pdfBytes(doc) {
  const ab = doc.output('arraybuffer');
  return ab instanceof ArrayBuffer ? new Uint8Array(ab) : new Uint8Array(ab || []);
}

function decodeB64ToUint8(b64) {
  if (typeof b64 !== 'string' || !b64) return new Uint8Array(0);
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const bin = typeof atob === 'function' ? atob(b64) : '';
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Normalize any RPC/IPC PDF/Excel payload to Uint8Array.
 * Never silently coerces unknown objects to a 0-byte array (that caused empty downloads).
 */
function toUint8(data) {
  if (data == null) return new Uint8Array(0);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(data);
  if (typeof data === 'string') {
    // raw base64 (no data: prefix)
    if (/^[A-Za-z0-9+/=\s]+$/.test(data) && data.replace(/\s/g, '').length >= 8) {
      return decodeB64ToUint8(data.replace(/\s/g, ''));
    }
    return new Uint8Array(0);
  }
  if (typeof data === 'object') {
    if (typeof data.__shoppos_b64 === 'string') return decodeB64ToUint8(data.__shoppos_b64);
    if (data.type === 'Buffer' && Array.isArray(data.data)) return new Uint8Array(data.data);
    if (data.data && (data.data instanceof ArrayBuffer || Array.isArray(data.data) || data.data instanceof Uint8Array || typeof data.data === 'string' || data.data?.__shoppos_b64)) {
      return toUint8(data.data);
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(data)) return new Uint8Array(data);
    // JSON'd TypedArray as numeric-key map { "0": 37, "1": 80, ... }
    const keys = Object.keys(data);
    if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
      const len = Math.max(...keys.map(Number)) + 1;
      const out = new Uint8Array(len);
      for (const k of keys) out[Number(k)] = Number(data[k]) & 255;
      return out;
    }
    throw new Error('Unrecognized binary file payload');
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(data)) return new Uint8Array(data);
  throw new Error('Unrecognized binary file payload');
}

module.exports = { pdfBytes, toUint8, decodeB64ToUint8 };

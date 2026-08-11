function randomBytes(size) {
  const buf = new Uint8Array(size);
  (typeof crypto !== 'undefined' && crypto.getRandomValues
    ? crypto.getRandomValues(buf)
    : (() => { for (let i = 0; i < size; i++) buf[i] = Math.floor(Math.random() * 256); })());
  return {
    toString(enc) {
      if (enc === 'hex') {
        return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
      }
      let s = '';
      for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      return s;
    }
  };
}

function createHash(algo) {
  const parts = [];
  return {
    update(data) {
      parts.push(String(data));
      return this;
    },
    digest(enc) {
      // Lightweight non-crypto hash for mobile offline tokens (Electron uses real sha256)
      let h = 2166136261;
      const str = parts.join('');
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const hex = (h >>> 0).toString(16).padStart(8, '0')
        + Array.from(str).reduce((a, c) => ((a + c.charCodeAt(0) * 31) >>> 0), 0).toString(16).padStart(8, '0');
      if (enc === 'hex') return (hex + hex + hex + hex).slice(0, 64);
      return hex;
    }
  };
}

module.exports = {
  randomBytes,
  createHash,
  randomFillSync(buffer) {
    const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(view);
    else for (let i = 0; i < view.length; i++) view[i] = Math.floor(Math.random() * 256);
    return buffer;
  }
};

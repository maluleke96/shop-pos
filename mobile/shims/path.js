module.exports = {
  join(...parts) {
    return parts.filter(Boolean).join('/').replace(/\\/g, '/');
  },
  resolve(...parts) {
    return parts.filter(Boolean).join('/').replace(/\\/g, '/');
  },
  dirname(p) {
    const s = String(p).replace(/\\/g, '/');
    const i = s.lastIndexOf('/');
    return i <= 0 ? '.' : s.slice(0, i);
  },
  basename(p, ext) {
    let name = String(p).replace(/\\/g, '/').split('/').pop() || '';
    if (ext && name.endsWith(ext)) name = name.slice(0, -ext.length);
    return name;
  }
};

const memoryFiles = {};

module.exports = {
  existsSync(p) { return p in memoryFiles; },
  readFileSync(p, enc) {
    if (!(p in memoryFiles)) throw new Error('ENOENT: ' + p);
    const v = memoryFiles[p];
    return enc === 'utf8' ? v : v;
  },
  writeFileSync(p, data) { memoryFiles[p] = data; },
  mkdirSync() {},
  copyFileSync(src, dest) { memoryFiles[dest] = memoryFiles[src]; },
  unlinkSync(p) { delete memoryFiles[p]; },
  statSync() { return { size: 1024 * 1024 }; },
  _memoryFiles: memoryFiles
};

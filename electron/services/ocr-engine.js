/**
 * Optional OCR text extraction — Tesseract CLI when installed, otherwise empty text.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

let cachedTesseract = undefined;

function findTesseract() {
  if (cachedTesseract !== undefined) return cachedTesseract;
  const candidates = process.platform === 'win32'
    ? [
      'tesseract',
      'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
      'C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe'
    ]
    : ['tesseract', '/usr/bin/tesseract', '/usr/local/bin/tesseract'];
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'pipe', timeout: 5000 });
      cachedTesseract = bin;
      return bin;
    } catch (_) { /* try next */ }
  }
  cachedTesseract = null;
  return null;
}

function isImagePath(filePath, mime) {
  const ext = String(filePath || '').toLowerCase();
  if (/\.(png|jpe?g|gif|bmp|tif{1,2}|webp)$/.test(ext)) return true;
  return /^image\//.test(String(mime || ''));
}

function isPdfPath(filePath, mime) {
  const ext = String(filePath || '').toLowerCase();
  if (ext.endsWith('.pdf')) return true;
  return String(mime || '').includes('pdf');
}

function extractWithTesseract(filePath, lang = 'eng') {
  const bin = findTesseract();
  if (!bin) return { text: '', engine: 'none', available: false };
  const outBase = path.join(os.tmpdir(), `shoppos-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    execFileSync(bin, [filePath, outBase, '-l', lang], { timeout: 90000, stdio: 'pipe' });
    const txtPath = `${outBase}.txt`;
    const text = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8') : '';
    try { fs.unlinkSync(txtPath); } catch (_) { /* */ }
    return { text, engine: 'tesseract', available: true };
  } catch (err) {
    return { text: '', engine: 'tesseract', available: true, error: err.message };
  }
}

function extractTextFromFile(filePath, mime) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { text: '', engine: 'none', available: !!findTesseract() };
  }
  if (isImagePath(filePath, mime) || isPdfPath(filePath, mime)) {
    return extractWithTesseract(filePath);
  }
  return { text: '', engine: 'none', available: !!findTesseract() };
}

function tesseractStatus() {
  const bin = findTesseract();
  return { installed: !!bin, path: bin };
}

module.exports = {
  findTesseract,
  extractTextFromFile,
  extractWithTesseract,
  tesseractStatus,
  isImagePath,
  isPdfPath
};

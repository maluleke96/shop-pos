const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const version = pkg.version || '1.0.0';
const apkName = `ShopPOS-android-v${version}.apk`;

const candidates = [
  path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
  path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug-unsigned.apk')
];

const src = candidates.find(p => fs.existsSync(p));
if (!src) {
  console.error('APK not found. Run gradlew assembleDebug first.');
  process.exit(1);
}

// Validate ZIP/APK magic — corrupt copies cause "package appears to be invalid"
const fd = fs.openSync(src, 'r');
const magic = Buffer.alloc(4);
fs.readSync(fd, magic, 0, 4, 0);
fs.closeSync(fd);
if (magic[0] !== 0x50 || magic[1] !== 0x4b) {
  console.error('APK is not a valid ZIP/APK (bad magic). Rebuild required:', src);
  process.exit(1);
}
const st = fs.statSync(src);
if (st.size < 500 * 1024) {
  console.error('APK is suspiciously small:', st.size, 'bytes');
  process.exit(1);
}

const destDir = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'ShopPOS');
fs.mkdirSync(destDir, { recursive: true });
const dest = path.join(destDir, apkName);
fs.copyFileSync(src, dest);

// Also keep a stable name for easy find
const stable = path.join(destDir, 'ShopPOS-android-latest.apk');
fs.copyFileSync(src, stable);

console.log('Copied APK to', dest);
console.log('Also', stable);
console.log(`Size ${Math.round(st.size / 1024 / 1024)} MB · package com.shoppos.offline`);

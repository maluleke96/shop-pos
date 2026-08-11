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

const destDir = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'ShopPOS');
fs.mkdirSync(destDir, { recursive: true });
const dest = path.join(destDir, apkName);
fs.copyFileSync(src, dest);
console.log('Copied APK to', dest);

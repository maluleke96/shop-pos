/**
 * Copy main Shop POS Windows installers into ~/Downloads/ShopPOS/
 * (Only top-level dist portable/setup — not every cloud portal build.)
 */
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const version = pkg.version || '1.0.0';
const dist = path.join(__dirname, '..');
const destDir = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'ShopPOS');
fs.mkdirSync(destDir, { recursive: true });

const wanted = [
  {
    srcs: [
      path.join(dist, 'dist', 'ShopPOS-Portable-x64.exe'),
      path.join(dist, 'dist', 'ShopPOS-Portable.exe')
    ],
    dest: `ShopPOS-Portable-x64-v${version}.exe`
  },
  {
    srcs: [
      path.join(dist, 'dist', 'Shop POS Setup x64.exe'),
      path.join(dist, 'dist', 'Shop POS Setup.exe')
    ],
    dest: `ShopPOS-Setup-x64-v${version}.exe`
  },
  {
    srcs: [path.join(dist, 'dist', 'ShopPOS-Portable-arm64.exe')],
    dest: `ShopPOS-Portable-arm64-v${version}.exe`
  },
  {
    srcs: [path.join(dist, 'dist', 'Shop POS Setup arm64.exe')],
    dest: `ShopPOS-Setup-arm64-v${version}.exe`
  }
];

let copied = 0;
for (const item of wanted) {
  const src = item.srcs.find((p) => fs.existsSync(p));
  if (!src) continue;
  const dest = path.join(destDir, item.dest);
  fs.copyFileSync(src, dest);
  const st = fs.statSync(dest);
  if (st.size < 1024 * 1024) {
    console.warn('Skip suspiciously small:', dest);
    continue;
  }
  console.log('Copied', dest, `(${Math.round(st.size / 1024 / 1024)} MB)`);
  copied += 1;
}

if (!copied) {
  console.error('No main Shop POS Windows installers found in dist/. Run npm run build:portable first.');
  process.exit(1);
}
console.log(`Done — ${copied} main installer(s) in ${destDir}`);

/**
 * Package complete editable Shop POS source for download (no secrets / no huge binaries).
 * Output: Downloads/ShopPOS/ShopPOS-Source-Complete-v{version}.zip
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version || '1.0.0';
const destDir = path.join(os.homedir(), 'Downloads', 'ShopPOS');
const staging = path.join(root, 'dist', 'source-package', 'shop-pos');
const zipPath = path.join(destDir, `ShopPOS-Source-Complete-v${version}.zip`);

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  '.tools',
  '.git',
  'cloud-data',
  'data',
  'test-db-tmp',
  'coverage',
  '.netlify',
  'build',
  '.gradle',
  'release',
  'captures'
]);

const SKIP_FILE_NAMES = new Set([
  '.env',
  '.env.local',
  'link-auth-report.json'
]);

const SKIP_EXT = new Set(['.db', '.db-wal', '.db-shm', '.log', '.apk', '.exe', '.map']);

function shouldSkip(name, fullPath, isDir) {
  if (SKIP_DIR_NAMES.has(name)) return true;
  if (SKIP_FILE_NAMES.has(name)) return true;
  if (!isDir) {
    const ext = path.extname(name).toLowerCase();
    if (SKIP_EXT.has(ext)) return true;
    if (/\.jks$/i.test(name) || /keystore/i.test(name)) return true;
  }
  // Skip bulky Android build outputs but keep source
  const rel = path.relative(root, fullPath).replace(/\\/g, '/');
  if (rel.startsWith('android/app/build')) return true;
  if (rel.startsWith('android/build')) return true;
  if (rel.startsWith('android/.gradle')) return true;
  if (rel.startsWith('www/') && name === 'mobile-api.bundle.js') return false;
  return false;
}

function rimraf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const s = path.join(from, name);
    const d = path.join(to, name);
    let st;
    try {
      st = fs.lstatSync(s);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (shouldSkip(name, s, st.isDirectory())) continue;
    if (st.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

rimraf(path.join(root, 'dist', 'source-package'));
fs.mkdirSync(destDir, { recursive: true });
copyTree(root, staging);

// Ensure critical docs / templates exist in package
const mustHave = [
  '.env.example',
  'SOURCE-CODE-OWNERSHIP.md',
  'supabase/COMPLETE_SUPABASE_SETUP.sql',
  'supabase/EXECUTION_ORDER.md',
  'netlify.toml',
  'netlify/functions/rpc.js',
  'package.json',
  'src/index.html',
  'src/js/supabase-bootstrap.js',
  'src/js/offline-queue.js',
  'electron/main.js',
  'mobile/handlers.js'
];
for (const rel of mustHave) {
  const p = path.join(staging, rel);
  if (!fs.existsSync(p)) {
    console.error('Missing required file in package:', rel);
    process.exit(1);
  }
}

// Refresh .gitignore inside package
const gi = `node_modules/
dist/
.tools/
data/
*.db
*.db-wal
*.db-shm
.env
.env.local
.env.*.local
link-auth-report.json
.DS_Store
android/app/build/
android/build/
android/.gradle/
.www-cache/
*.log
.idea/
.vscode/*.code-workspace
`;
fs.writeFileSync(path.join(staging, '.gitignore'), gi);

// START HERE for owners
fs.writeFileSync(
  path.join(staging, 'START-HERE.txt'),
  `Shop POS — Complete Source v${version}

1. Open this "shop-pos" folder in Visual Studio Code.
2. Read SOURCE-CODE-OWNERSHIP.md
3. npm install
4. copy .env.example .env  (then add YOUR Supabase keys — never share them)
5. Follow supabase/EXECUTION_ORDER.md
6. Push to YOUR GitHub → deploy to YOUR Netlify

This zip does NOT contain private keys or node_modules.
`
);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

const ps = `Compress-Archive -Path '${staging.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);

const st = fs.statSync(zipPath);
console.log('Source package:', zipPath);
console.log('Size MB:', (st.size / 1024 / 1024).toFixed(1));

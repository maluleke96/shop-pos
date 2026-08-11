/**
 * Package editable Railway-ready Shop POS source into Downloads.
 * Output: Downloads/ShopPOS/ShopPOS-Railway-Supabase-Source-v{version}.zip
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version || '1.0.0';
const destDir = path.join(os.homedir(), 'Downloads', 'ShopPOS');
const stagingRoot = path.join(root, 'dist', 'railway-package');
const staging = path.join(stagingRoot, 'shop-pos');
const zipPath = path.join(destDir, `ShopPOS-Railway-Supabase-Source-v${version}.zip`);

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

const SKIP_FILE_NAMES = new Set(['.env', '.env.local', 'link-auth-report.json']);
const SKIP_EXT = new Set(['.db', '.db-wal', '.db-shm', '.log', '.apk', '.exe', '.map']);

function shouldSkip(name, fullPath, isDir) {
  if (SKIP_DIR_NAMES.has(name)) return true;
  if (SKIP_FILE_NAMES.has(name)) return true;
  if (!isDir) {
    const ext = path.extname(name).toLowerCase();
    if (SKIP_EXT.has(ext)) return true;
    if (/\.jks$/i.test(name) || /keystore/i.test(name)) return true;
  }
  const rel = path.relative(root, fullPath).replace(/\\/g, '/');
  if (rel.startsWith('android/app/build')) return true;
  if (rel.startsWith('android/build')) return true;
  if (rel.startsWith('android/.gradle')) return true;
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

rimraf(stagingRoot);
copyTree(root, staging);

// Ensure templates exist in package
const envExample = path.join(root, '.env.example');
if (fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, path.join(staging, '.env.example'));
}

const readme = `# Shop POS — Railway + Supabase (editable source)

## Open in VS Code
1. Unzip this folder
2. Open the \`shop-pos\` folder in Visual Studio Code
3. Copy \`.env.example\` → \`.env\` and fill in your Supabase values
4. Run: \`npm install\` then \`npm run start:web\`
5. Open http://localhost:3000

## Full guide
See **RAILWAY-SETUP.md** in this folder.

## Deploy
Push to GitHub and connect Railway, or use \`railway up\`.
Start command: \`node server.js\`

Do not commit \`.env\`. Database password stays on Railway only.
`;
fs.writeFileSync(path.join(staging, 'README-RAILWAY.md'), readme, 'utf8');

fs.mkdirSync(destDir, { recursive: true });
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

const ps = `
Compress-Archive -Path '${staging.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force
`;
const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(1);
}
console.log('Created', zipPath);
console.log('Size MB', (fs.statSync(zipPath).size / 1024 / 1024).toFixed(2));

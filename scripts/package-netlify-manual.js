/**
 * Build a Netlify manual-deploy folder (no GitHub required).
 * Output:
 *   Downloads/ShopPOS/ShopPOS-Netlify-Manual-Deploy/
 *   Downloads/ShopPOS/ShopPOS-Netlify-Manual-Deploy.zip
 *
 * Deploy (after filling .env):
 *   cd ShopPOS-Netlify-Manual-Deploy
 *   npm install
 *   npx netlify deploy --prod --dir=publish --functions=netlify/functions
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const destDir = path.join(os.homedir(), 'Downloads', 'ShopPOS');
const outRoot = path.join(destDir, 'ShopPOS-Netlify-Manual-Deploy');
const zipPath = path.join(destDir, 'ShopPOS-Netlify-Manual-Deploy.zip');

function rimraf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(from, to, skip = new Set()) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (skip.has(name)) continue;
    const s = path.join(from, name);
    const d = path.join(to, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d, skip);
    else fs.copyFileSync(s, d);
  }
}

rimraf(outRoot);
fs.mkdirSync(outRoot, { recursive: true });

// Static site at publish/ (index.html at publish root)
copyDir(path.join(root, 'src'), path.join(outRoot, 'publish'));

// Functions + server code the RPC needs
copyDir(path.join(root, 'netlify'), path.join(outRoot, 'netlify'));
copyDir(path.join(root, 'electron'), path.join(outRoot, 'electron'), new Set(['node_modules']));
copyDir(path.join(root, 'mobile'), path.join(outRoot, 'mobile'), new Set(['node_modules']));

// Minimal package.json for function deps + netlify CLI
const pkg = {
  name: 'shop-pos-netlify-manual',
  private: true,
  version: require(path.join(root, 'package.json')).version,
  description: 'Manual Netlify deploy (no GitHub) — static UI + /rpc function',
  dependencies: {
    bcryptjs: require(path.join(root, 'package.json')).dependencies.bcryptjs || '^2.4.3',
    pg: require(path.join(root, 'package.json')).dependencies.pg || '^8.13.0',
    'sql.js': require(path.join(root, 'package.json')).dependencies['sql.js'] || '^1.12.0',
    jspdf: require(path.join(root, 'package.json')).dependencies.jspdf || '^2.5.2',
    'jspdf-autotable': require(path.join(root, 'package.json')).dependencies['jspdf-autotable'] || '^3.8.4',
    xlsx: require(path.join(root, 'package.json')).dependencies.xlsx || '^0.18.5'
  },
  scripts: {
    deploy: 'node scripts/deploy-netlify.js'
  }
};
fs.writeFileSync(path.join(outRoot, 'package.json'), JSON.stringify(pkg, null, 2));

fs.mkdirSync(path.join(outRoot, 'scripts'), { recursive: true });
fs.copyFileSync(
  path.join(root, 'scripts', 'netlify-build-env.js'),
  path.join(outRoot, 'scripts', 'netlify-build-env.js')
);

// Adapt build-env to write into publish/js/env.js
fs.writeFileSync(
  path.join(outRoot, 'scripts', 'write-publish-env.js'),
  `const fs = require('fs');
const path = require('path');
const url = process.env.SHOP_POS_SUPABASE_URL || process.env.SUPABASE_URL || '';
const anon = process.env.SHOP_POS_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const rpc = process.env.SHOP_POS_RPC_URL || process.env.RPC_URL || '';
const out = path.join(__dirname, '..', 'publish', 'js', 'env.js');
fs.writeFileSync(out, \`/* generated */\\nwindow.__SHOP_POS_ENV__ = {
  SUPABASE_URL: \${JSON.stringify(url)},
  SUPABASE_ANON_KEY: \${JSON.stringify(anon)},
  SHOP_POS_SUPABASE_URL: \${JSON.stringify(url)},
  SHOP_POS_SUPABASE_ANON_KEY: \${JSON.stringify(anon)},
  RPC_URL: \${JSON.stringify(rpc)},
  SHOP_POS_RPC_URL: \${JSON.stringify(rpc)}
};
window.__SHOP_POS_USE_SUPABASE__ = \${url && anon ? 'true' : '!!rpc || true'};
\`);
console.log('Wrote', out);
`
);

fs.writeFileSync(
  path.join(outRoot, 'scripts', 'deploy-netlify.js'),
  `/**
 * Deploy to Netlify WITHOUT GitHub.
 * Requires: npm i -g netlify-cli   OR uses npx
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');

// Load .env if present
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\\r?\\n/)) {
    const m = line.match(/^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*)\\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

if (!process.env.SHOP_POS_DATABASE_URL && !process.env.DATABASE_URL) {
  console.error('Missing SHOP_POS_DATABASE_URL in .env');
  process.exit(1);
}
if (!process.env.SHOP_POS_SUPABASE_URL || !process.env.SHOP_POS_SUPABASE_ANON_KEY) {
  console.error('Missing SHOP_POS_SUPABASE_URL / SHOP_POS_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

// Same-origin RPC after deploy
if (!process.env.SHOP_POS_RPC_URL) process.env.SHOP_POS_RPC_URL = '';

require('./write-publish-env.js');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log('\\nDeploying to Netlify (no GitHub)…\\n');
run('npx', ['--yes', 'netlify-cli', 'deploy', '--prod', '--dir=publish', '--functions=netlify/functions']);
console.log('\\nDone. In Netlify → Site settings → Environment variables, also set:');
console.log('  SHOP_POS_DATABASE_URL, SHOP_POS_SUPABASE_URL, SHOP_POS_SUPABASE_ANON_KEY');
console.log('Then redeploy once so the function can read them.\\n');
`
);

fs.writeFileSync(
  path.join(outRoot, 'netlify.toml'),
  `[build]
  publish = "publish"
  functions = "netlify/functions"

[functions]
  node_bundler = "nft"
  included_files = ["electron/**", "mobile/**", "package.json", "node_modules/pg/**", "node_modules/bcryptjs/**", "node_modules/sql.js/**"]

[[redirects]]
  from = "/rpc"
  to = "/.netlify/functions/rpc"
  status = 200
  force = true

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
`
);

fs.copyFileSync(path.join(root, '.env.example'), path.join(outRoot, '.env.example'));

fs.writeFileSync(
  path.join(outRoot, 'README-DEPLOY.txt'),
  `Shop POS — Netlify WITHOUT GitHub
=================================

IMPORTANT
---------
Dragging a ZIP onto Netlify's website only uploads static HTML/CSS/JS.
It does NOT deploy the /rpc backend function your POS needs.

This folder is the correct way to use Netlify with NO GitHub:
use Netlify CLI from your PC (one-time login).

STEPS
-----
1. Create Supabase project
2. Run supabase/COMPLETE_SUPABASE_SETUP.sql (from the full source zip)
3. Import your data (see full source EXECUTION_ORDER.md)
4. In THIS folder:
     copy .env.example .env
     edit .env with your Supabase URL, anon key, DATABASE_URL
5. npm install
6. In Netlify site UI: create a site (or use CLI login), then set Environment variables:
     SHOP_POS_DATABASE_URL
     SHOP_POS_SUPABASE_URL
     SHOP_POS_SUPABASE_ANON_KEY
7. Deploy (no GitHub):
     npm run deploy
   or double-click DEPLOY.bat
8. Open your Netlify URL and log in

If you ONLY drag-drop publish/ as a zip:
  - Homepage will load
  - Login/POS will NOT work (no /rpc function)
`
);

fs.writeFileSync(
  path.join(outRoot, 'DEPLOY.bat'),
  `@echo off
cd /d "%~dp0"
echo Installing dependencies...
call npm install
echo.
echo Deploying to Netlify (browser may open to log in once)...
call npm run deploy
pause
`
);

// Zip the folder
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
const ps = `Compress-Archive -Path '${outRoot.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);

console.log('Folder:', outRoot);
console.log('Zip:', zipPath);

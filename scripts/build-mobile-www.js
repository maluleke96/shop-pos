const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');
const src = path.join(root, 'src');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const sf = path.join(from, ent.name);
    const df = path.join(to, ent.name);
    if (ent.isDirectory()) copyDir(sf, df);
    else fs.copyFileSync(sf, df);
  }
}

function shim(name) {
  return path.join(root, 'mobile', 'shims', name);
}

require('./build-sql-bundle');

if (fs.existsSync(www)) fs.rmSync(www, { recursive: true, force: true });
copyDir(src, www);
fs.mkdirSync(path.join(www, 'js'), { recursive: true });
fs.mkdirSync(path.join(www, 'wasm'), { recursive: true });

const wasmSrc = path.join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
if (fs.existsSync(wasmSrc)) {
  fs.copyFileSync(wasmSrc, path.join(www, 'wasm', 'sql-wasm.wasm'));
}

/** Core scripts only — page modules load on demand (Android speed). */
const CORE_SCRIPTS = [
  'js/sound.js',
  'js/mobile-api.bundle.js',
  'js/api.js',
  'js/utils.js',
  'js/admin-override.js',
  'js/payment-ui.js',
  'js/printer-ui.js',
  'js/receipt.js',
  'js/export.js',
  'js/staff-selfie-ui.js',
  'js/app.js'
];

function rewriteIndexScripts(htmlPath) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  html = html.replace(
    /content="default-src[^"]+"/,
    "content=\"default-src 'self' capacitor: ionic: https://localhost http://localhost data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: file: https:; connect-src 'self' https://localhost http://localhost capacitor: ionic: data: blob:\""
  );
  const loading = `<div id="mobile-loading" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#f0f4f8;z-index:99999;flex-direction:column;gap:12px;font-family:system-ui,sans-serif"><div style="font-size:48px">🏪</div><p style="margin:0;color:#334">Loading Shop POS…</p><small style="color:#667;margin-top:4px">Optimized for Android — starting…</small></div>`;
  if (!html.includes('id="mobile-loading"')) {
    html = html.replace('<body>', `<body>\n  ${loading}`);
  }
  // Replace the entire script block before </body> with core-only scripts
  const coreTags = CORE_SCRIPTS.map(s => `  <script src="${s}"></script>`).join('\n');
  html = html.replace(
    /(?:\s*<script src="js\/[^"]+"><\/script>)+(\s*)<\/body>/i,
    `\n${coreTags}\n$1</body>`
  );
  // Ensure mobile bundle is present if replace missed
  if (!html.includes('mobile-api.bundle.js')) {
    html = html.replace(
      '<script src="js/api.js"></script>',
      '<script src="js/mobile-api.bundle.js"></script>\n  <script src="js/api.js"></script>'
    );
  }
  fs.writeFileSync(htmlPath, html);
}

rewriteIndexScripts(path.join(www, 'index.html'));

function patchStandaloneDisplay(fileName, loadingText, bg) {
  const filePath = path.join(www, fileName);
  if (!fs.existsSync(filePath)) return;
  let html = fs.readFileSync(filePath, 'utf8');
  if (!html.includes('mobile-api.bundle.js')) {
    html = html.replace(
      '<script src="js/api.js"></script>',
      '<script src="js/mobile-api.bundle.js"></script>\n  <script src="js/api.js"></script>'
    );
    const loading = `<div id="mobile-loading" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:${bg};z-index:99999;color:#eee">${loadingText}</div>`;
    html = html.replace('<body>', `<body>\n  ${loading}`);
    fs.writeFileSync(filePath, html);
  }
}
patchStandaloneDisplay('kitchen-display.html', 'Loading kitchen display…', '#1a1a2e');
patchStandaloneDisplay('customer-display.html', 'Loading customer board…', '#0b1220');

esbuild.build({
  entryPoints: [path.join(root, 'mobile', 'bootstrap.js')],
  bundle: true,
  outfile: path.join(www, 'js', 'mobile-api.bundle.js'),
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  treeShaking: true,
  alias: {
    electron: shim('electron.js'),
    fs: shim('fs.js'),
    path: shim('path.js'),
    child_process: shim('child_process.js'),
    'node:fs': shim('fs.js'),
    crypto: shim('crypto.js'),
    'node:crypto': shim('crypto.js'),
    async_hooks: shim('async_hooks.js'),
    'node:async_hooks': shim('async_hooks.js')
  },
  plugins: [{
    name: 'mobile-shims',
    setup(build) {
      build.onResolve({ filter: /\/database\/db$/ }, () => ({ path: path.join(root, 'mobile', 'db.js') }));
      build.onResolve({ filter: /electron[\\/]+services[\\/]+deviceSettings\.js$/ }, () => ({ path: shim('deviceSettings.js') }));
      build.onResolve({ filter: /electron[\\/]+services[\\/]+printService\.js$/ }, () => ({ path: shim('printService.js') }));
    }
  }],
  logLevel: 'info'
}).then(() => {
  const size = fs.statSync(path.join(www, 'js', 'mobile-api.bundle.js')).size;
  console.log('Mobile www build complete:', www);
  console.log('mobile-api.bundle.js size:', (size / (1024 * 1024)).toFixed(2), 'MB (minified)');
}).catch(err => {
  console.error(err);
  process.exit(1);
});

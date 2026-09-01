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
  'js/app-mode-bake.js',
  'js/app-mode.js',
  'js/sound.js',
  'js/mobile-api.bundle.js',
  'js/api.js',
  'js/utils.js',
  'js/data-cache.js',
  'js/admin-override.js',
  'js/payment-ui.js',
  'js/printer-ui.js',
  'js/receipt.js',
  'js/export.js',
  'js/staff-selfie-ui.js',
  'js/offline-queue.js',
  'js/connection-status.js',
  'js/installer-sync.js',
  'js/app.js'
];

function rewriteIndexScripts(htmlPath) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  html = html.replace(
    /content="default-src[^"]+"/,
    "content=\"default-src 'self' capacitor: ionic: https://localhost http://localhost data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: file: https:; connect-src 'self' https: http://localhost https://localhost capacitor: ionic: data: blob:\""
  );
  const loading = `<div id="mobile-loading" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#f0f4f8;z-index:99999;flex-direction:column;gap:12px;font-family:system-ui,sans-serif"><div style="font-size:48px">🏪</div><p style="margin:0;color:#334">Loading Shop POS…</p><small style="color:#667;margin-top:4px">Optimized for Android — starting…</small></div>`;
  if (!html.includes('id="mobile-loading"')) {
    html = html.replace('<body>', `<body>\n  ${loading}`);
  }
  // Preload hints for cloud desktop are fine, but do not preload app.js ahead of mobile-api
  html = html.replace(/<link rel="preload" href="js\/app\.js" as="script">\s*/i, '');
  html = html.replace(/<link rel="preload" href="js\/api\.js" as="script">\s*/i, '');
  // Replace the entire script block before </body> with core-only scripts.
  // Must match both <script src=...> and <script defer src=...> (src/index.html uses defer).
  const coreTags = CORE_SCRIPTS.map(s => `  <script src="${s}"></script>`).join('\n');
  const before = html;
  html = html.replace(
    /(?:\s*<script(?:\s+defer|\s+async)*\s+src="js\/[^"]+"\s*><\/script>)+(\s*)<\/body>/i,
    `\n${coreTags}\n$1</body>`
  );
  // Strip cloud boot scripts that would bypass local SQL recovery on Android
  html = html.replace(/\s*<script(?:\s+defer|\s+async)*\s+src="js\/env\.js"\s*><\/script>/gi, '');
  html = html.replace(/\s*<script(?:\s+defer|\s+async)*\s+src="js\/supabase-bootstrap\.js"\s*><\/script>/gi, '');

  if (!html.includes('mobile-api.bundle.js')) {
    // Hard fallback: inject core block before </body>
    if (!html.includes('</body>')) {
      throw new Error('build-mobile-www: index.html has no </body> — cannot inject mobile-api.bundle.js');
    }
    html = html.replace(/<\/body>/i, `${coreTags}\n</body>`);
  }
  // Never ship Android www that still boots cloud-only env without local posAPI
  if (!html.includes('mobile-api.bundle.js')) {
    throw new Error('build-mobile-www: FAILED to inject mobile-api.bundle.js — Android would show Register Shop on update');
  }
  if (html.includes('supabase-bootstrap.js') || html.includes('js/env.js')) {
    console.warn('build-mobile-www: stripping leftover cloud scripts from', htmlPath);
    html = html.replace(/\s*<script[^>]*src="js\/env\.js"[^>]*><\/script>/gi, '');
    html = html.replace(/\s*<script[^>]*src="js\/supabase-bootstrap\.js"[^>]*><\/script>/gi, '');
  }
  if (before === html && !html.includes('mobile-api.bundle.js')) {
    throw new Error('build-mobile-www: script rewrite made no changes');
  }
  fs.writeFileSync(htmlPath, html);
  console.log('Android index scripts rewritten → local mobile-api.bundle.js (no cloud env boot)');
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
    'node:async_hooks': shim('async_hooks.js'),
    os: shim('os.js'),
    'node:os': shim('os.js'),
    worker_threads: shim('worker_threads.js'),
    'node:worker_threads': shim('worker_threads.js')
  },
  plugins: [{
    name: 'mobile-shims',
    setup(build) {
      const redirect = (filter, target) => {
        build.onResolve({ filter }, (args) => {
          if (/mobile[\/\\]db\.js$/i.test(args.path) || args.path.includes(`${path.sep}mobile${path.sep}db`)) {
            return null;
          }
          return { path: target };
        });
      };
      redirect(/database[\/\\]db(\.js)?$/, path.join(root, 'mobile', 'db.js'));
      redirect(/pg-db(\.js)?$/, shim('pg-db.js'));
      redirect(/pg-connection(\.js)?$/, shim('pg-connection.js'));
      redirect(/deviceSettings(\.js)?$/, shim('deviceSettings.js'));
      redirect(/printService(\.js)?$/, shim('printService.js'));
    }
  }],
  logLevel: 'info'
}).then(() => {
  const outFile = path.join(www, 'js', 'mobile-api.bundle.js');
  const size = fs.statSync(outFile).size;
  console.log('Mobile www build complete:', www);
  console.log('mobile-api.bundle.js size:', (size / (1024 * 1024)).toFixed(2), 'MB (minified)');

  // Fail the build if the browser bundle still contains unguarded process.env access.
  // Guarded patterns like typeof process<"u"&&process.env (minified) are OK.
  const code = fs.readFileSync(outFile, 'utf8');
  const unguarded = [];
  const re = /process\.env(?:\.[A-Za-z0-9_]+|\[)/g;
  let m;
  while ((m = re.exec(code))) {
    const start = Math.max(0, m.index - 96);
    const ctx = code.slice(start, m.index + m[0].length + 8);
    // Allow only when preceded by a typeof process check nearby
    if (!/typeof process/.test(ctx)) {
      unguarded.push(ctx.replace(/\s+/g, ' '));
    }
  }
  if (unguarded.length) {
    console.error('FATAL: mobile-api.bundle.js contains unguarded process.env (browser will throw):');
    unguarded.slice(0, 5).forEach((u) => console.error(' ', u));
    process.exit(1);
  }
  console.log('Browser safety check OK: no unguarded process.env in mobile-api.bundle.js');
}).catch(err => {
  console.error(err);
  process.exit(1);
});

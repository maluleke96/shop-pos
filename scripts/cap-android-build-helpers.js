/**
 * Shared Capacitor Android build helpers (cloud-shell + ops installers).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function defaultCloudUrl() {
  return (process.env.SHOP_POS_CLOUD_URL || process.env.SHOP_POS_PUBLIC_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
}

function xmlEscape(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function patchStringsXml(root, appName, appId) {
  const p = path.join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
  const xml = `<?xml version='1.0' encoding='utf-8'?>\n<resources>
    <string name="app_name">${xmlEscape(appName)}</string>
    <string name="title_activity_main">${xmlEscape(appName)}</string>
    <string name="package_name">${appId}</string>
    <string name="custom_url_scheme">${appId}</string>
</resources>\n`;
  fs.writeFileSync(p, xml, 'utf8');
}

function patchBuildGradle(root, appId) {
  const p = path.join(root, 'android', 'app', 'build.gradle');
  let g = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  if (!/namespace\s+"com\.shoppos\.offline"/.test(g)) {
    g = g.replace(/namespace\s+"[^"]+"/, 'namespace "com.shoppos.offline"');
  }
  g = g.replace(/applicationId\s+"[^"]+"/, `applicationId "${appId}"`);
  try {
    const ver = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '2.10.28';
    const base = parseInt(String(ver).replace(/\D/g, '') || '21028', 10);
    const code = String(base + Math.floor(Date.now() / 1000) % 100000);
    g = g.replace(/versionCode\s+\d+/, `versionCode ${code}`);
    g = g.replace(/versionName\s+"[^"]+"/, `versionName "${ver}"`);
  } catch (_) { /* ignore */ }
  fs.writeFileSync(p, g, 'utf8');
}

function findApk(root) {
  const dir = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug');
  for (const n of ['app-debug.apk', 'app-debug-unsigned.apk']) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('APK not found after assembleDebug');
}

function gradleEnv(root) {
  const env = { ...process.env };
  const jdk = path.join(root, '.tools', 'jdk-17');
  if (fs.existsSync(jdk)) env.JAVA_HOME = jdk;
  if (env.GRADLE_USER_HOME && /cursor-sandbox-cache/i.test(env.GRADLE_USER_HOME)) {
    env.GRADLE_USER_HOME = path.join(os.homedir(), '.gradle-shoppos');
  }
  return env;
}

function run(cmd, args, opts = {}) {
  const useShell = opts.shell != null ? opts.shell : (cmd === 'npx' || cmd === 'npm');
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    stdio: 'inherit',
    shell: useShell,
    env: opts.env || process.env
  });
  if (r.status !== 0) throw new Error(`Failed: ${cmd} ${args.join(' ')}`);
}

function cloudHost(cloudUrl) {
  try { return new URL(cloudUrl).hostname; } catch (_) { return 'chisafood.up.railway.app'; }
}

/** Live URL opened in WebView (no ?query on server.url — use bootstrap HTML when needed). */
function resolveCapacitorServerUrl(app, cloudUrl) {
  const id = app.id || '';
  if (id === 'admin') return `${cloudUrl}/admin-app.html`;
  if (id === 'referral-commission') return `${cloudUrl}/referral-commission-app.html`;
  if (id === 'referral') return `${cloudUrl}/referral-app.html`;
  if (id === 'mgr-hr') return `${cloudUrl}/mgr-hr-app.html`;
  if (id === 'communication-center') return `${cloudUrl}/communication-center-app.html`;
  if (id === 'radio') return `${cloudUrl}/radio-app.html`;
  return `${cloudUrl}${String(app.serverPath || '/').split('?')[0]}`;
}

function resolveLiveEntry(app, cloudUrl) {
  return resolveCapacitorServerUrl(app, cloudUrl);
}

function ensureWwwBootstrap(root, app, cloudUrl) {
  const www = path.join(root, 'www');
  fs.mkdirSync(www, { recursive: true });
  const target = resolveLiveEntry(app, cloudUrl);
  fs.writeFileSync(path.join(www, 'index.html'), `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<style>body{font-family:system-ui;background:#0f2744;color:#e2e8f0;text-align:center;padding:32px}a{color:#5eead4}</style>
</head>
<body>
<p>Loading ${xmlEscape(app.appName)}…</p>
<p style="font-size:12px;opacity:.7">Needs internet to reach your shop cloud.</p>
<p><a href="${target}">Open ${xmlEscape(app.appName)}</a></p>
<script>location.replace(${JSON.stringify(target)});</script>
</body></html>`, 'utf8');
}

/**
 * Build one cloud-shell APK with distinct applicationId + live server.url.
 */
function buildCloudShellApp(root, cloudUrl, app, destRoot, opts = {}) {
  const live = resolveCapacitorServerUrl(app, cloudUrl);
  console.log(`\n========== Cloud shell: ${app.appName} → ${live} ==========`);
  ensureWwwBootstrap(root, app, cloudUrl);
  const cfgSrc = path.join(root, 'capacitor-apps', app.config);
  const cfg = JSON.parse(fs.readFileSync(cfgSrc, 'utf8'));
  const host = cloudHost(cloudUrl);
  cfg.server = {
    url: live,
    cleartext: false,
    allowNavigation: [host, `*.${host.split('.').slice(-2).join('.')}`, '*.up.railway.app', 'chisafood.up.railway.app']
  };
  cfg.android = { ...(cfg.android || {}), allowMixedContent: true };
  fs.writeFileSync(path.join(root, 'capacitor.config.json'), JSON.stringify(cfg, null, 2));
  patchStringsXml(root, app.appName, cfg.appId);
  patchBuildGradle(root, cfg.appId);
  run('npx', ['cap', 'sync', 'android'], { cwd: root });
  const androidDir = path.join(root, 'android');
  if (process.platform === 'win32') {
    run('cmd.exe', ['/c', 'gradlew.bat', 'assembleDebug'], { cwd: androidDir, shell: false, env: gradleEnv(root) });
  } else {
    run('./gradlew', ['assembleDebug'], { cwd: androidDir, shell: false, env: gradleEnv(root) });
  }
  fs.mkdirSync(destRoot, { recursive: true });
  const dest = path.join(destRoot, app.apkName);
  fs.copyFileSync(findApk(root), dest);
  if (opts.extraDest) {
    fs.mkdirSync(opts.extraDest, { recursive: true });
    fs.copyFileSync(dest, path.join(opts.extraDest, app.apkName));
    if (opts.extraDestLatestName) {
      fs.copyFileSync(dest, path.join(opts.extraDest, opts.extraDestLatestName));
    }
    if (opts.readmeText) {
      fs.writeFileSync(path.join(opts.extraDest, 'README.txt'), opts.readmeText, 'utf8');
    }
  }
  const mb = (fs.statSync(dest).size / (1024 * 1024)).toFixed(1);
  console.log(`✓ ${app.apkName} (${mb} MB) — package ${cfg.appId}`);
  return dest;
}

module.exports = {
  defaultCloudUrl,
  patchStringsXml,
  patchBuildGradle,
  findApk,
  gradleEnv,
  run,
  resolveLiveEntry,
  resolveCapacitorServerUrl,
  ensureWwwBootstrap,
  buildCloudShellApp,
  cloudHost
};

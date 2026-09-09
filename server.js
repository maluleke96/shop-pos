/**
 * Shop POS — Railway / local web server
 * Serves the existing UI from src/ and POST /rpc → Supabase Postgres.
 *
 * Start:
 *   node server.js
 *   npm run start:web
 *
 * Env: see .env.example (SHOP_POS_DB_* or SHOP_POS_DATABASE_URL)
 */
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname);
process.chdir(ROOT);

process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err?.message || err);
});

const CUSTOMER_WEB = path.join(ROOT, 'customer-web');
const MANAGER_WEB = path.join(ROOT, 'manager-web');
const REFERRAL_WEB = path.join(ROOT, 'referral-web');
const DRIVER_WEB = path.join(ROOT, 'driver-web');
const EXPENSE_WEB = path.join(ROOT, 'expense-web');
const INVESTOR_WEB = path.join(ROOT, 'investor-web');
const RELEASE_WEB = path.join(ROOT, 'release-web');
const MEETING_WEB = path.join(ROOT, 'meeting-web');
const SIGNAGE_WEB = path.join(ROOT, 'signage-web');
const SIGNAGE_PLAYER = path.join(ROOT, 'signage-player');
const KIOSK_WEB = path.join(ROOT, 'kiosk-web');
const DRIVE_THRU_WEB = path.join(ROOT, 'drive-thru-web');
const COMMUNICATION_WEB = path.join(ROOT, 'communication-web');

const { loadProjectEnv } = require('./lib/load-env');
loadProjectEnv(ROOT);

const { getPublicUrl, getRpcUrl } = require('./lib/public-url');

const { bootRpc, handleRpcPost } = require('./lib/rpc-app');

const PORT = Number(process.env.PORT || process.env.SHOP_POS_PORT || 3000);
const SRC = path.join(ROOT, 'src');
const SHARED = path.join(ROOT, 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8'
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token, X-Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': 'X-Session-Token'
  };
}

function writeJson(res, status, obj, extraHeaders) {
  const headers = {
    ...corsHeaders(),
    'Content-Type': 'application/json',
    ...(extraHeaders || {})
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(obj));
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent((reqPath || '/').split('?')[0]);
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(root, cleaned);
  if (!full.startsWith(root)) return null;
  return full;
}

function serveManagerWeb(req, res) {
  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/manager') urlPath = '/';
  else if (urlPath.startsWith('/manager/')) urlPath = urlPath.slice('/manager'.length);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = safeJoin(MANAGER_WEB, urlPath);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      const index = path.join(MANAGER_WEB, 'index.html');
      return fs.readFile(index, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() });
        res.end(buf);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (e2, buf) => {
      if (e2) { res.writeHead(500); return res.end('Read error'); }
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': (ext === '.html' || ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=3600',
        ...corsHeaders()
      });
      res.end(buf);
    });
  });
}

function syncManagerWebConfig() {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || '';
  const apiBase = (
    process.env.SHOP_POS_PUBLIC_URL ||
    process.env.SHOP_POS_SYNC_URL ||
    (railwayDomain ? `https://${railwayDomain}` : '') ||
    'https://chisafood.up.railway.app'
  ).replace(/\/$/, '');
  const rpc = (
    process.env.SHOP_POS_PUBLIC_RPC_URL ||
    process.env.SHOP_POS_RPC_URL ||
    `${apiBase}/rpc`
  ).replace(/\/$/, '');
  const out = `window.__MANAGER_CONFIG__ = {
  rpcUrl: ${JSON.stringify(rpc)},
  apiBase: ${JSON.stringify(apiBase)},
  managerPath: "/manager/"
};
`;
  try {
    fs.mkdirSync(path.join(MANAGER_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(MANAGER_WEB, 'js', 'config.js'), out, 'utf8');
  } catch (e) {
    console.warn('[manager-web] config write failed:', e.message);
  }
}

function syncReferralWebConfig() {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || '';
  const apiBase = (
    process.env.SHOP_POS_PUBLIC_URL ||
    process.env.SHOP_POS_SYNC_URL ||
    (railwayDomain ? `https://${railwayDomain}` : '') ||
    'https://chisafood.up.railway.app'
  ).replace(/\/$/, '');
  const rpc = (
    process.env.SHOP_POS_PUBLIC_RPC_URL ||
    process.env.SHOP_POS_RPC_URL ||
    `${apiBase}/rpc`
  ).replace(/\/$/, '');
  const out = `window.__REFERRAL_CONFIG__ = {
  rpcUrl: ${JSON.stringify(rpc)},
  apiBase: ${JSON.stringify(apiBase)},
  referralPath: "/r/"
};
`;
  try {
    fs.mkdirSync(path.join(REFERRAL_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(REFERRAL_WEB, 'js', 'config.js'), out, 'utf8');
  } catch (e) {
    console.warn('[referral-web] config write failed:', e.message);
  }
}

function syncExpenseWebConfig() {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || '';
  const apiBase = (
    process.env.SHOP_POS_PUBLIC_URL ||
    process.env.SHOP_POS_SYNC_URL ||
    (railwayDomain ? `https://${railwayDomain}` : '') ||
    'https://chisafood.up.railway.app'
  ).replace(/\/$/, '');
  const rpc = (
    process.env.SHOP_POS_PUBLIC_RPC_URL ||
    process.env.SHOP_POS_RPC_URL ||
    `${apiBase}/rpc`
  ).replace(/\/$/, '');
  const out = `window.__EXPENSE_CONFIG__ = {
  rpcUrl: ${JSON.stringify(rpc)},
  apiBase: ${JSON.stringify(apiBase)},
  expensePath: "/expenses/"
};
`;
  try {
    fs.mkdirSync(path.join(EXPENSE_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(EXPENSE_WEB, 'js', 'config.js'), out, 'utf8');
  } catch (e) {
    console.warn('[expense-web] config write failed:', e.message);
  }
}

function serveExpenseWeb(req, res) {
  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/expenses') urlPath = '/';
  else if (urlPath.startsWith('/expenses/')) urlPath = urlPath.slice('/expenses'.length);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = safeJoin(EXPENSE_WEB, urlPath);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      const index = path.join(EXPENSE_WEB, 'index.html');
      return fs.readFile(index, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() });
        res.end(buf);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (e2, buf) => {
      if (e2) { res.writeHead(500); return res.end('Read error'); }
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': (ext === '.html' || ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=3600',
        ...corsHeaders()
      });
      res.end(buf);
    });
  });
}

function syncDriverWebConfig() {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || '';
  const apiBase = (
    process.env.SHOP_POS_PUBLIC_URL ||
    process.env.SHOP_POS_SYNC_URL ||
    (railwayDomain ? `https://${railwayDomain}` : '') ||
    'https://chisafood.up.railway.app'
  ).replace(/\/$/, '');
  const rpc = (
    process.env.SHOP_POS_PUBLIC_RPC_URL ||
    process.env.SHOP_POS_RPC_URL ||
    `${apiBase}/rpc`
  ).replace(/\/$/, '');
  const out = `window.__DRIVER_CONFIG__ = {
  rpcUrl: ${JSON.stringify(rpc)},
  apiBase: ${JSON.stringify(apiBase)},
  driverPath: "/driver/"
};
`;
  try {
    fs.mkdirSync(path.join(DRIVER_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(DRIVER_WEB, 'js', 'config.js'), out, 'utf8');
  } catch (e) {
    console.warn('[driver-web] config write failed:', e.message);
  }
}

function portalConfig(windowName, portalPath) {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || '';
  const apiBase = (
    process.env.SHOP_POS_PUBLIC_URL ||
    process.env.SHOP_POS_SYNC_URL ||
    (railwayDomain ? `https://${railwayDomain}` : '') ||
    'https://chisafood.up.railway.app'
  ).replace(/\/$/, '');
  const rpc = (
    process.env.SHOP_POS_PUBLIC_RPC_URL ||
    process.env.SHOP_POS_RPC_URL ||
    `${apiBase}/rpc`
  ).replace(/\/$/, '');
  return `window.${windowName} = {
  rpcUrl: ${JSON.stringify(rpc)},
  apiBase: ${JSON.stringify(apiBase)},
  portalPath: ${JSON.stringify(portalPath)}
};
`;
}

function syncInvestorWebConfig() {
  try {
    fs.mkdirSync(path.join(INVESTOR_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(INVESTOR_WEB, 'js', 'config.js'), portalConfig('__INVESTOR_CONFIG__', '/investor/'), 'utf8');
  } catch (e) { console.warn('[investor-web] config write failed:', e.message); }
}

function syncReleaseWebConfig() {
  try {
    fs.mkdirSync(path.join(RELEASE_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(RELEASE_WEB, 'js', 'config.js'), portalConfig('__RELEASE_CONFIG__', '/release/'), 'utf8');
  } catch (e) { console.warn('[release-web] config write failed:', e.message); }
}

function syncMeetingWebConfig() {
  try {
    fs.mkdirSync(path.join(MEETING_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(MEETING_WEB, 'js', 'config.js'), portalConfig('__MEETING_CONFIG__', '/meeting/'), 'utf8');
  } catch (e) { console.warn('[meeting-web] config write failed:', e.message); }
}

function syncSignageWebConfig() {
  try {
    fs.mkdirSync(path.join(SIGNAGE_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(SIGNAGE_WEB, 'js', 'config.js'), portalConfig('__SIGNAGE_CONFIG__', '/signage/'), 'utf8');
    fs.mkdirSync(path.join(SIGNAGE_PLAYER, 'js'), { recursive: true });
    fs.writeFileSync(path.join(SIGNAGE_PLAYER, 'js', 'config.js'), portalConfig('__SIGNAGE_PLAYER_CONFIG__', '/signage-player/'), 'utf8');
  } catch (e) { console.warn('[signage-web] config write failed:', e.message); }
}

function syncKioskWebConfig() {
  try {
    fs.mkdirSync(path.join(KIOSK_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(KIOSK_WEB, 'js', 'config.js'), portalConfig('__KIOSK_CONFIG__', '/kiosk/'), 'utf8');
  } catch (e) { console.warn('[kiosk-web] config write failed:', e.message); }
}

function syncDriveThruWebConfig() {
  try {
    fs.mkdirSync(path.join(DRIVE_THRU_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(DRIVE_THRU_WEB, 'js', 'config.js'), portalConfig('__DRIVE_THRU_CONFIG__', '/drive-thru/'), 'utf8');
  } catch (e) { console.warn('[drive-thru-web] config write failed:', e.message); }
}

function syncCommunicationWebConfig() {
  try {
    fs.mkdirSync(path.join(COMMUNICATION_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(COMMUNICATION_WEB, 'js', 'config.js'), portalConfig('__COMM_CONFIG__', '/communications/'), 'utf8');
  } catch (e) { console.warn('[communication-web] config write failed:', e.message); }
}

function servePortalWeb(req, res, baseDir, mount) {
  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath === mount) urlPath = '/';
  else if (urlPath.startsWith(mount + '/')) urlPath = urlPath.slice(mount.length);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = safeJoin(baseDir, urlPath);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      const index = path.join(baseDir, 'index.html');
      return fs.readFile(index, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() });
        res.end(buf);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (e2, buf) => {
      if (e2) { res.writeHead(500); return res.end('Read error'); }
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': (ext === '.html' || ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=3600',
        ...corsHeaders()
      });
      res.end(buf);
    });
  });
}

function serveDriverWeb(req, res) {
  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/driver') urlPath = '/';
  else if (urlPath.startsWith('/driver/')) urlPath = urlPath.slice('/driver'.length);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = safeJoin(DRIVER_WEB, urlPath);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      const index = path.join(DRIVER_WEB, 'index.html');
      return fs.readFile(index, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() });
        res.end(buf);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (e2, buf) => {
      if (e2) { res.writeHead(500); return res.end('Read error'); }
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': (ext === '.html' || ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=3600',
        ...corsHeaders()
      });
      res.end(buf);
    });
  });
}

function serveTrackingWeb(req, res) {
  const token = (req.url || '/').split('?')[0].replace(/^\/track\/?/, '').trim();
  const filePath = path.join(DRIVER_WEB, 'track.html');
  fs.readFile(filePath, (e2, buf) => {
    if (e2) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() });
    res.end(buf);
  });
}

function serveReferralWeb(req, res) {
  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/r') urlPath = '/r/';
  if (!urlPath.startsWith('/r/')) {
    res.writeHead(404);
    return res.end('Not found');
  }
  urlPath = urlPath.slice(2) || '/';
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = safeJoin(REFERRAL_WEB, urlPath);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      const index = path.join(REFERRAL_WEB, 'index.html');
      return fs.readFile(index, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() });
        res.end(buf);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (e2, buf) => {
      if (e2) { res.writeHead(500); return res.end('Read error'); }
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': (ext === '.html' || ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=3600',
        ...corsHeaders()
      });
      res.end(buf);
    });
  });
}

function serveCustomerWeb(req, res) {
  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath.startsWith('/order')) urlPath = urlPath.slice(6) || '/';
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = safeJoin(CUSTOMER_WEB, urlPath);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      const index = path.join(CUSTOMER_WEB, 'index.html');
      return fs.readFile(index, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() });
        res.end(buf);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (e2, buf) => {
      if (e2) { res.writeHead(500); return res.end('Read error'); }
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': (ext === '.html' || ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=3600',
        ...corsHeaders()
      });
      res.end(buf);
    });
  });
}

function serveShared(req, res) {
  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath.startsWith('/shared/')) urlPath = urlPath.slice('/shared'.length);
  if (urlPath === '/' || !urlPath) urlPath = '/panel-brand.js';
  const filePath = safeJoin(SHARED, urlPath);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/javascript; charset=utf-8';
    fs.readFile(filePath, (e2, buf) => {
      if (e2) { res.writeHead(500); return res.end('Read error'); }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...corsHeaders() });
      res.end(buf);
    });
  });
}

function serveStatic(req, res) {
  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = safeJoin(SRC, urlPath);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // SPA-ish fallback for unknown paths → index.html (keeps deep links usable)
      const index = path.join(SRC, 'index.html');
      return fs.readFile(index, (e2, buf) => {
        if (e2) {
          res.writeHead(404);
          return res.end('Not found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() });
        res.end(buf);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const cache =
      ext === '.html' || ext === '.js'
        ? 'no-cache'
        : 'public, max-age=86400';
    fs.readFile(filePath, (e2, buf) => {
      if (e2) {
        res.writeHead(500);
        return res.end('Read error');
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, ...corsHeaders() });
      res.end(buf);
    });
  });
}

/**
 * Inject public-only env into src/js/env.js at boot (Railway variables).
 * Never writes DB password or service role into the frontend.
 */
function syncOrderWebConfig() {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || '';
  const apiBase = (
    process.env.SHOP_POS_PUBLIC_URL ||
    process.env.SHOP_POS_SYNC_URL ||
    (railwayDomain ? `https://${railwayDomain}` : '') ||
    'https://chisafood.up.railway.app'
  ).replace(/\/$/, '');
  const rpc = (
    process.env.SHOP_POS_PUBLIC_RPC_URL ||
    process.env.SHOP_POS_RPC_URL ||
    `${apiBase}/rpc`
  ).replace(/\/$/, '');
  const supabaseUrl = process.env.SHOP_POS_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const out = `/* Auto-synced at server start — Railway + Supabase */
window.__ORDER_CONFIG__ = {
  rpcUrl: ${JSON.stringify(rpc)},
  apiBase: ${JSON.stringify(apiBase)},
  orderPath: "/order/",
  supabaseUrl: ${JSON.stringify(supabaseUrl)},
  connected: "railway-supabase-pos"
};
`;
  try {
    fs.mkdirSync(path.join(CUSTOMER_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(CUSTOMER_WEB, 'js', 'config.js'), out, 'utf8');
    console.log('[order-web] config → RPC', rpc);
  } catch (e) {
    console.warn('[order-web] config write failed:', e.message);
  }
}

function syncPublicEnvJs() {
  const url =
    process.env.SHOP_POS_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    '';
  const anon =
    process.env.SHOP_POS_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    '';
  const rpc =
    process.env.SHOP_POS_PUBLIC_RPC_URL ||
    process.env.SHOP_POS_RPC_URL ||
    process.env.RPC_URL ||
    '';
  let deployVersion = '';
  try {
    deployVersion = fs.readFileSync(path.join(__dirname, 'deploy-version.txt'), 'utf8').trim();
  } catch (_) { /* optional */ }

  if (!url && !anon && !deployVersion) return;

  const out = `/* Auto-synced public env at server start — no secrets */
window.__SHOP_POS_ENV__ = {
  SUPABASE_URL: ${JSON.stringify(url)},
  SUPABASE_ANON_KEY: ${JSON.stringify(anon)},
  SHOP_POS_SUPABASE_URL: ${JSON.stringify(url)},
  SHOP_POS_SUPABASE_ANON_KEY: ${JSON.stringify(anon)},
  RPC_URL: ${JSON.stringify(rpc)},
  SHOP_POS_RPC_URL: ${JSON.stringify(rpc)}
};
window.__SHOP_POS_USE_SUPABASE__ = true;
window.__SHOP_POS_DEPLOY__ = ${JSON.stringify(deployVersion)};
`;
  try {
    fs.writeFileSync(path.join(SRC, 'js', 'env.js'), out, 'utf8');
    console.log('[env] synced public src/js/env.js');
  } catch (e) {
    console.warn('[env] could not write env.js:', e.message);
  }
}

async function main() {
  syncOrderWebConfig();
  syncManagerWebConfig();
  syncReferralWebConfig();
  syncDriverWebConfig();
  syncExpenseWebConfig();
  syncInvestorWebConfig();
  syncReleaseWebConfig();
  syncMeetingWebConfig();
  syncSignageWebConfig();
  syncKioskWebConfig();
  syncDriveThruWebConfig();
  syncCommunicationWebConfig();
  syncPublicEnvJs();

  console.log('Connecting to Supabase Postgres…');
  const rpc = await bootRpc();
  try {
    const { getDb } = require('./electron/database/db');
    const { ensureAccSchema } = require('./electron/database/ensure-pg-schema');
    const { ensurePgMigrations } = require('./electron/database/ensure-pg-migrations');
    const db = getDb();
    const migrations = ensurePgMigrations(db);
    const accounting = ensureAccSchema(db);
    console.log('[DB] Accounting bootstrap:', JSON.stringify({ migrations, accounting }));
  } catch (e) {
    console.error('[DB] Accounting bootstrap failed:', e.message || e);
  }
  console.log(`RPC ready — ${Object.keys(rpc.handlers).length} handlers`);

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      return res.end();
    }

    const urlPath = (req.url || '/').split('?')[0];

    if (urlPath === '/health') {
      const base = getPublicUrl();
      return writeJson(res, 200, {
        ok: true,
        service: 'shop-pos-railway',
        backend: 'postgres',
        public_url: base,
        handlers: Object.keys(rpc.handlers).length,
        customer_ordering: `${base}/order/`,
        portals: `${base}/portals.html`
      });
    }

    if (urlPath === '/api/mobile-releases.json') {
      try {
        const manifestPath = path.join(ROOT, 'mobile-releases.json');
        if (!fs.existsSync(manifestPath)) {
          require('./scripts/write-mobile-releases.js').writeMobileReleases();
        }
        const body = fs.readFileSync(manifestPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders() });
        return res.end(body);
      } catch (e) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: e.message || 'Could not load releases' }));
      }
    }

    if (urlPath === '/api/mobile-apk-status') {
      try {
        const { listStatus } = require('./lib/mobile-apk-store');
        return writeJson(res, 200, { success: true, data: listStatus() });
      } catch (e) {
        return writeJson(res, 500, { success: false, error: e.message || 'Could not read APK status' });
      }
    }

    if (urlPath.startsWith('/communication/webhooks/') && req.method === 'POST') {
      const provider = urlPath.split('/').pop() || 'unknown';
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        let payload = {};
        try { payload = JSON.parse(raw); } catch { payload = { raw }; }
        const comm = require('./electron/services/communication-centre');
        const result = comm.handleWebhook(provider, payload);
        return writeJson(res, 200, { success: true, data: result });
      } catch (e) {
        return writeJson(res, 500, { success: false, error: e.message || 'Webhook failed' });
      }
    }

    if (urlPath === '/api/admin/mobile-apk-upload' && req.method === 'POST') {
      const token = String(req.headers['x-session-token'] || '');
      const snap = token && rpc.sessions.has(token) ? rpc.sessions.get(token) : null;
      const user = snap?.userSession;
      if (!user || !['owner', 'manager'].includes(user.role)) {
        res.writeHead(403);
        return res.end('Owner or manager sign-in required');
      }
      const fileName = String(req.headers['x-apk-filename'] || '');
      const { isAllowedFileName, saveApk } = require('./lib/mobile-apk-store');
      if (!isAllowedFileName(fileName)) {
        res.writeHead(400);
        return res.end('Invalid APK file name');
      }
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const buf = Buffer.concat(chunks);
        const info = saveApk(fileName, buf);
        return writeJson(res, 200, { success: true, data: info });
      } catch (e) {
        return writeJson(res, 400, { success: false, error: e.message || 'Upload failed' });
      }
    }

    if (urlPath.startsWith('/downloads/')) {
      const fileName = path.basename(urlPath);
      if (!/^ShopPOS-[-A-Za-z0-9_.]+\.apk$/i.test(fileName)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }
      const { resolveApkPath } = require('./lib/mobile-apk-store');
      const apkPath = resolveApkPath(fileName);
      if (!apkPath) {
        res.writeHead(404);
        return res.end('APK not uploaded yet — open Admin → Security → Android app installers and upload the latest APK.');
      }
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'public, max-age=300',
        ...corsHeaders()
      });
      return fs.createReadStream(apkPath).pipe(res);
    }

    if (urlPath.startsWith('/api/expense-grant-photo/')) {
      const grantId = urlPath.replace('/api/expense-grant-photo/', '').split('?')[0];
      try {
        const { getGrantPhoto } = require('./lib/expense-permission-grants');
        const file = getGrantPhoto(Number(grantId));
        return fs.readFile(file.path, (err, buf) => {
          if (err) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'private, max-age=3600', ...corsHeaders() });
          res.end(buf);
        });
      } catch (e) {
        res.writeHead(404);
        return res.end(String(e.message || 'Not found'));
      }
    }

    if (urlPath.startsWith('/api/expense-grant-recording/')) {
      const grantId = urlPath.replace('/api/expense-grant-recording/', '').split('?')[0];
      try {
        const { getGrantRecording } = require('./lib/expense-permission-grants');
        const file = getGrantRecording(Number(grantId));
        return fs.readFile(file.path, (err, buf) => {
          if (err) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'private, max-age=3600', ...corsHeaders() });
          res.end(buf);
        });
      } catch (e) {
        res.writeHead(404);
        return res.end(String(e.message || 'Not found'));
      }
    }

    if (urlPath === '/api/logo') {
      try {
        const { getShopLogo } = require('./lib/product-images');
        const file = getShopLogo();
        if (file.buffer) {
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=300', ...corsHeaders() });
          return res.end(file.buffer);
        }
        return fs.readFile(file.path, (err, buf) => {
          if (err) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=300', ...corsHeaders() });
          res.end(buf);
        });
      } catch (e) {
        res.writeHead(404);
        return res.end('Logo not available');
      }
    }

    if (urlPath === '/api/notification-sound') {
      try {
        const q = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).searchParams;
        const panel = q.get('panel') || '';
        const { getNotificationSound } = require('./lib/product-images');
        const file = getNotificationSound(panel);
        if (file.buffer) {
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=60', ...corsHeaders() });
          return res.end(file.buffer);
        }
        return fs.readFile(file.path, (err, buf) => {
          if (err) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=60', ...corsHeaders() });
          res.end(buf);
        });
      } catch (e) {
        res.writeHead(404);
        return res.end('Sound not available');
      }
    }

    if (urlPath.startsWith('/api/driver-doc/')) {
      const parts = urlPath.replace('/api/driver-doc/', '').split('/').filter(Boolean);
      const driverId = parts[0];
      const docKey = parts[1];
      try {
        const { getDriverDocument } = require('./lib/driver-documents');
        const file = getDriverDocument(driverId, docKey);
        return fs.readFile(file.path, (err, buf) => {
          if (err) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'private, max-age=3600', ...corsHeaders() });
          res.end(buf);
        });
      } catch (e) {
        res.writeHead(404);
        return res.end('Not found');
      }
    }

    if (urlPath.startsWith('/api/expense-invoice/')) {
      const expenseId = urlPath.replace('/api/expense-invoice/', '').split('?')[0];
      try {
        const { getExpenseInvoice } = require('./lib/expense-documents');
        const file = getExpenseInvoice(expenseId);
        return fs.readFile(file.path, (err, buf) => {
          if (err) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'private, max-age=3600', ...corsHeaders() });
          res.end(buf);
        });
      } catch (e) {
        res.writeHead(404);
        return res.end('Not found');
      }
    }

    if (urlPath.startsWith('/api/product-image/')) {
      const productId = urlPath.replace('/api/product-image/', '').split('?')[0];
      try {
        const { getProductImage } = require('./lib/product-images');
        const file = getProductImage(Number(productId));
        if (file.buffer) {
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=3600', ...corsHeaders() });
          return res.end(file.buffer);
        }
        return fs.readFile(file.path, (err, buf) => {
          if (err) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=3600', ...corsHeaders() });
          res.end(buf);
        });
      } catch (e) {
        res.writeHead(e.message === 'Product not found' || e.message === 'Image not available' ? 404 : 500);
        return res.end(String(e.message || 'Error'));
      }
    }

    if (urlPath.startsWith('/api/combo-image/')) {
      const comboId = urlPath.replace('/api/combo-image/', '').split('?')[0];
      try {
        const { getComboImage } = require('./lib/product-images');
        const file = getComboImage(Number(comboId));
        if (file.buffer) {
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=3600', ...corsHeaders() });
          return res.end(file.buffer);
        }
        return fs.readFile(file.path, (err, buf) => {
          if (err) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=3600', ...corsHeaders() });
          res.end(buf);
        });
      } catch (e) {
        res.writeHead(e.message === 'Combo not found' || e.message === 'Image not available' ? 404 : 500);
        return res.end(String(e.message || 'Error'));
      }
    }

    if (urlPath.startsWith('/api/app-image')) {
      const q = (req.url || '').split('?')[1] || '';
      const p = new URLSearchParams(q).get('p');
      try {
        const { getAppImage } = require('./lib/product-images');
        const file = getAppImage(p);
        if (file.buffer) {
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=3600', ...corsHeaders() });
          return res.end(file.buffer);
        }
        return fs.readFile(file.path, (err, buf) => {
          if (err) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=3600', ...corsHeaders() });
          res.end(buf);
        });
      } catch (e) {
        res.writeHead(e.message === 'Image not available' ? 404 : 500);
        return res.end(String(e.message || 'Error'));
      }
    }

    if (urlPath.startsWith('/signage-media/')) {
      const mediaId = urlPath.replace('/signage-media/', '').split('?')[0];
      const q = (req.url || '').split('?')[1] || '';
      const token = new URLSearchParams(q).get('token');
      try {
        const signage = require('./electron/services/signage-platform');
        let file;
        try { file = signage.getMediaFile(Number(mediaId), token, true); }
        catch (_) { file = signage.getMediaFile(Number(mediaId), token, false); }
        return fs.readFile(file.path, (err, buf) => {
          if (err) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'private, max-age=3600', ...corsHeaders() });
          res.end(buf);
        });
      } catch (e) {
        res.writeHead(403);
        return res.end(String(e.message || 'Forbidden'));
      }
    }

    if (urlPath.startsWith('/kiosk-media/product/')) {
      const productId = urlPath.replace('/kiosk-media/product/', '').split('?')[0];
      const q = (req.url || '').split('?')[1] || '';
      const token = new URLSearchParams(q).get('token');
      try {
        const kiosk = require('./electron/services/kiosk-platform');
        const file = kiosk.getKioskProductImage(Number(productId), token);
        if (file.buffer) {
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'private, max-age=3600', ...corsHeaders() });
          return res.end(file.buffer);
        }
        return fs.readFile(file.path, (err, buf) => {
          if (err) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'private, max-age=3600', ...corsHeaders() });
          res.end(buf);
        });
      } catch (e) {
        res.writeHead(e.message === 'Image not available' ? 404 : 403);
        return res.end(String(e.message || 'Forbidden'));
      }
    }

    if (urlPath.startsWith('/signage-sse/')) {
      const deviceToken = decodeURIComponent(urlPath.replace('/signage-sse/', '').split('?')[0]);
      try {
        const signage = require('./electron/services/signage-platform');
        const sse = require('./electron/services/signage-sse');
        const deviceId = signage.resolveDeviceIdFromToken(deviceToken);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          ...corsHeaders()
        });
        res.write(': connected\n\n');
        sse.subscribeDevice(deviceId, res);
        return;
      } catch (e) {
        res.writeHead(403);
        return res.end(String(e.message || 'Forbidden'));
      }
    }

    if (urlPath === '/rpc') {
      if (req.method === 'GET') {
        return writeJson(res, 200, {
          ok: true,
          service: 'shop-pos-rpc',
          backend: 'postgres',
          handlers: Object.keys(rpc.handlers).length
        });
      }
      if (req.method !== 'POST') {
        return writeJson(res, 405, { success: false, error: 'Method Not Allowed' });
      }

      const chunks = [];
      for await (const c of req) chunks.push(c);
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        return writeJson(res, 400, { success: false, error: 'Invalid JSON' });
      }

      const idem = req.headers['x-idempotency-key'];
      if (idem && !body.clientRequestId) body.clientRequestId = String(idem);

      const result = await handleRpcPost({
        handlers: rpc.handlers,
        session: rpc.session,
        persistNow: rpc.persistNow,
        sessions: rpc.sessions,
        body,
        sessionTokenHeader: req.headers['x-session-token'] || ''
      });
      return writeJson(res, result.status, result.json, result.headers);
    }

    // Customer ordering website (PWA)
    if (urlPath === '/order') {
      res.writeHead(301, { Location: '/order/', ...corsHeaders() });
      return res.end();
    }
    if (urlPath.startsWith('/order/')) {
      return serveCustomerWeb(req, res);
    }

    if (urlPath === '/manager' || urlPath.startsWith('/manager/')) {
      return serveManagerWeb(req, res);
    }

    if (urlPath === '/r' || urlPath.startsWith('/r/')) {
      return serveReferralWeb(req, res);
    }

    if (urlPath === '/driver' || urlPath.startsWith('/driver/')) {
      return serveDriverWeb(req, res);
    }

    if (urlPath === '/expenses' || urlPath.startsWith('/expenses/')) {
      return serveExpenseWeb(req, res);
    }

    if (urlPath === '/investor' || urlPath.startsWith('/investor/')) {
      return servePortalWeb(req, res, INVESTOR_WEB, '/investor');
    }

    if (urlPath === '/release' || urlPath.startsWith('/release/')) {
      return servePortalWeb(req, res, RELEASE_WEB, '/release');
    }

    if (urlPath === '/meeting' || urlPath.startsWith('/meeting/')) {
      return servePortalWeb(req, res, MEETING_WEB, '/meeting');
    }

    if (urlPath === '/signage' || urlPath.startsWith('/signage/')) {
      return servePortalWeb(req, res, SIGNAGE_WEB, '/signage');
    }

    if (urlPath === '/signage-player' || urlPath.startsWith('/signage-player/')) {
      return servePortalWeb(req, res, SIGNAGE_PLAYER, '/signage-player');
    }

    if (urlPath === '/kiosk' || urlPath.startsWith('/kiosk/')) {
      return servePortalWeb(req, res, KIOSK_WEB, '/kiosk');
    }

    if (urlPath === '/drive-thru' || urlPath.startsWith('/drive-thru/')) {
      return servePortalWeb(req, res, DRIVE_THRU_WEB, '/drive-thru');
    }

    if (urlPath === '/communications' || urlPath.startsWith('/communications/')) {
      return servePortalWeb(req, res, COMMUNICATION_WEB, '/communications');
    }

    if (urlPath === '/track' || urlPath.startsWith('/track/')) {
      return serveTrackingWeb(req, res);
    }

    if (urlPath.startsWith('/shared/')) {
      return serveShared(req, res);
    }

    // Static UI
    serveStatic(req, res);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log(`Shop POS online → http://0.0.0.0:${PORT}`);
    console.log(`  UI:     http://localhost:${PORT}/`);
    console.log(`  RPC:    http://localhost:${PORT}/rpc`);
    console.log(`  Order:   http://localhost:${PORT}/order/`);
    console.log(`  Manager: http://localhost:${PORT}/manager/`);
    console.log(`  Referral: http://localhost:${PORT}/r/CODE`);
    console.log(`  Driver:   http://localhost:${PORT}/driver/`);
    console.log(`  Expenses: http://localhost:${PORT}/expenses/`);
    console.log(`  Investor: http://localhost:${PORT}/investor/`);
    console.log(`  Release:  http://localhost:${PORT}/release/`);
    console.log(`  Meeting:  http://localhost:${PORT}/meeting/`);
    console.log(`  Signage:  http://localhost:${PORT}/signage/`);
    console.log(`  Player:   http://localhost:${PORT}/signage-player/`);
    console.log(`  Kiosk:    http://localhost:${PORT}/kiosk/`);
    console.log(`  Drive-Thru: http://localhost:${PORT}/drive-thru/`);
    console.log(`  Communication Centre: http://localhost:${PORT}/communications/`);
    console.log(`  Track:    http://localhost:${PORT}/track/TOKEN`);
    console.log('');
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

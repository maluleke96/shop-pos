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
const DRIVER_WEB = path.join(ROOT, 'driver-web');
const EXPENSE_WEB = path.join(ROOT, 'expense-web');
const MANAGER_OPS_WEB = path.join(ROOT, 'manager-ops-web');
const STUDIO_WEB = path.join(ROOT, 'studio-web');
const RADIO_WEB = path.join(ROOT, 'radio-web');
const RADIO_STUDIO_WEB = path.join(ROOT, 'radio-studio-web');
const INVESTOR_WEB = path.join(ROOT, 'investor-web');
const RELEASE_WEB = path.join(ROOT, 'release-web');
const MEETING_WEB = path.join(ROOT, 'meeting-web');
const SIGNAGE_WEB = path.join(ROOT, 'signage-web');
const SIGNAGE_PLAYER = path.join(ROOT, 'signage-player');
const KIOSK_WEB = path.join(ROOT, 'kiosk-web');
const DRIVE_THRU_WEB = path.join(ROOT, 'drive-thru-web');
const PLATFORM_WEB = path.join(ROOT, 'platform-web');
const { loadProjectEnv } = require('./lib/load-env');
loadProjectEnv(ROOT);

const { getPublicUrl, getRpcUrl } = require('./lib/public-url');

const { bootRpc, handleRpcPost } = require('./lib/rpc-app');

const PORT = Number(process.env.PORT || process.env.SHOP_POS_PORT || 3000);
const SRC = path.join(ROOT, 'src');
const SHARED = path.join(ROOT, 'shared');

/**
 * Decode HTML/text buffers that may have been saved as UTF-16 (Windows notepad)
 * or prefixed with mangled BOM bytes. Always returns a clean UTF-8 string.
 */
function decodeTextBuffer(buf) {
  if (!buf || !buf.length) return '';
  // UTF-16 LE BOM
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString('utf16le');
  }
  // UTF-16 BE BOM
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.alloc(buf.length - 2);
    for (let i = 2; i + 1 < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    return swapped.toString('utf16le');
  }
  // Mangled BOM (EF BF BD ×2) then UTF-16 LE payload — seen after bad PowerShell writes
  if (
    buf.length >= 8 &&
    buf[0] === 0xef && buf[1] === 0xbf && buf[2] === 0xbd &&
    buf[3] === 0xef && buf[4] === 0xbf && buf[5] === 0xbd &&
    buf[6] === 0x3c && buf[7] === 0x00
  ) {
    return buf.slice(6).toString('utf16le');
  }
  // UTF-16 LE without BOM: ASCII tag with nulls between chars (<!DOCTYPE / <html)
  if (
    buf.length >= 8 &&
    buf[1] === 0x00 && buf[3] === 0x00 && buf[5] === 0x00 &&
    ((buf[0] === 0x3c && buf[2] === 0x21) || (buf[0] === 0x3c && buf[2] === 0x68))
  ) {
    return buf.toString('utf16le');
  }
  return buf.toString('utf8');
}

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
        const html = injectDeployCacheBust(buf.toString('utf8'), readDeployVersion());
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() });
        res.end(html);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (e2, buf) => {
      if (e2) { res.writeHead(500); return res.end('Read error'); }
      let body = buf;
      if (ext === '.html') {
        body = Buffer.from(injectDeployCacheBust(buf.toString('utf8'), readDeployVersion()), 'utf8');
      }
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': (ext === '.html' || ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=3600',
        ...corsHeaders()
      });
      res.end(body);
    });
  });
}

function syncManagerWebConfig() {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || '';
  const apiBase = (
    process.env.SHOP_POS_PUBLIC_URL ||
    process.env.SHOP_POS_SYNC_URL ||
    (railwayDomain ? `https://${railwayDomain}` : '') ||
    ''
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

function syncExpenseWebConfig() {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || '';
  const apiBase = (
    process.env.SHOP_POS_PUBLIC_URL ||
    process.env.SHOP_POS_SYNC_URL ||
    (railwayDomain ? `https://${railwayDomain}` : '') ||
    ''
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

function syncManagerOpsWebConfig() {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || '';
  const apiBase = (
    process.env.SHOP_POS_PUBLIC_URL ||
    process.env.SHOP_POS_SYNC_URL ||
    (railwayDomain ? `https://${railwayDomain}` : '') ||
    ''
  ).replace(/\/$/, '');
  const rpc = (
    process.env.SHOP_POS_PUBLIC_RPC_URL ||
    process.env.SHOP_POS_RPC_URL ||
    `${apiBase}/rpc`
  ).replace(/\/$/, '');
  const out = `window.__MANAGER_OPS_CONFIG__ = {
  rpcUrl: ${JSON.stringify(rpc)},
  apiBase: ${JSON.stringify(apiBase)},
  managerOpsPath: "/manager-ops/"
};
`;
  try {
    fs.mkdirSync(path.join(MANAGER_OPS_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(MANAGER_OPS_WEB, 'js', 'config.js'), out, 'utf8');
  } catch (e) {
    console.warn('[manager-ops-web] config write failed:', e.message);
  }
}

function syncStudioWebConfig() {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || '';
  const apiBase = (
    process.env.SHOP_POS_PUBLIC_URL ||
    process.env.SHOP_POS_SYNC_URL ||
    (railwayDomain ? `https://${railwayDomain}` : '') ||
    ''
  ).replace(/\/$/, '');
  const rpc = (
    process.env.SHOP_POS_PUBLIC_RPC_URL ||
    process.env.SHOP_POS_RPC_URL ||
    `${apiBase}/rpc`
  ).replace(/\/$/, '');
  const out = `window.__STUDIO_CONFIG__ = {
  rpcUrl: ${JSON.stringify(rpc)},
  apiBase: ${JSON.stringify(apiBase)},
  studioPath: "/studio/"
};
`;
  try {
    fs.mkdirSync(path.join(STUDIO_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(STUDIO_WEB, 'js', 'config.js'), out, 'utf8');
  } catch (e) {
    console.warn('[studio-web] config write failed:', e.message);
  }
}

function syncRadioWebConfigs() {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || '';
  const apiBase = (
    process.env.SHOP_POS_PUBLIC_URL ||
    process.env.SHOP_POS_SYNC_URL ||
    (railwayDomain ? `https://${railwayDomain}` : '') ||
    ''
  ).replace(/\/$/, '');
  const rpc = (
    process.env.SHOP_POS_PUBLIC_RPC_URL ||
    process.env.SHOP_POS_RPC_URL ||
    `${apiBase}/rpc`
  ).replace(/\/$/, '');
  try {
    fs.mkdirSync(path.join(RADIO_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(RADIO_WEB, 'js', 'config.js'), `window.__RADIO_CONFIG__ = {
  rpcUrl: ${JSON.stringify(rpc)},
  apiBase: ${JSON.stringify(apiBase)},
  radioPath: "/radio/"
};
`, 'utf8');
  } catch (e) {
    console.warn('[radio-web] config write failed:', e.message);
  }
  try {
    fs.mkdirSync(path.join(RADIO_STUDIO_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(RADIO_STUDIO_WEB, 'js', 'config.js'), `window.__RADIO_STUDIO_CONFIG__ = {
  rpcUrl: ${JSON.stringify(rpc)},
  apiBase: ${JSON.stringify(apiBase)},
  studioPath: "/radio-studio/"
};
`, 'utf8');
  } catch (e) {
    console.warn('[radio-studio-web] config write failed:', e.message);
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
  const sendHtml = (buf) => {
    const html = injectPanelCacheBust(buf.toString('utf8'), readDeployVersion());
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders() });
    res.end(html);
  };
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      const index = path.join(EXPENSE_WEB, 'index.html');
      return fs.readFile(index, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        sendHtml(buf);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (e2, buf) => {
      if (e2) { res.writeHead(500); return res.end('Read error'); }
      if (ext === '.html') return sendHtml(buf);
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': (ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=3600',
        ...corsHeaders()
      });
      res.end(buf);
    });
  });
}

function serveManagerOpsWeb(req, res) {
  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/manager-ops') urlPath = '/';
  else if (urlPath.startsWith('/manager-ops/')) urlPath = urlPath.slice('/manager-ops'.length);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = safeJoin(MANAGER_OPS_WEB, urlPath);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  const sendHtml = (buf) => {
    const html = injectPanelCacheBust(buf.toString('utf8'), readDeployVersion());
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders() });
    res.end(html);
  };
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      const index = path.join(MANAGER_OPS_WEB, 'index.html');
      return fs.readFile(index, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        sendHtml(buf);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (e2, buf) => {
      if (e2) { res.writeHead(500); return res.end('Read error'); }
      if (ext === '.html') return sendHtml(buf);
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': (ext === '.js' || ext === '.css' || ext === '.webmanifest') ? 'no-cache' : 'public, max-age=3600',
        ...corsHeaders()
      });
      res.end(buf);
    });
  });
}

function serveStudioWeb(req, res) {
  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/studio') urlPath = '/';
  else if (urlPath.startsWith('/studio/')) urlPath = urlPath.slice('/studio'.length);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = safeJoin(STUDIO_WEB, urlPath);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  const sendHtml = (buf) => {
    const html = injectPanelCacheBust(buf.toString('utf8'), readDeployVersion());
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders() });
    res.end(html);
  };
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      const index = path.join(STUDIO_WEB, 'index.html');
      return fs.readFile(index, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        sendHtml(buf);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (e2, buf) => {
      if (e2) { res.writeHead(500); return res.end('Read error'); }
      if (ext === '.html') return sendHtml(buf);
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': (ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=3600',
        ...corsHeaders()
      });
      res.end(buf);
    });
  });
}

/** Public listener site: /radio/ or /radio/:slug/ */
function serveRadioWeb(req, res) {
  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/radio') urlPath = '/';
  else if (urlPath.startsWith('/radio/')) urlPath = urlPath.slice('/radio'.length);
  // Strip optional station slug segment when requesting assets or root
  // /main → /  ;  /main/css/x → /css/x  ;  /css/x stays
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  else {
    const parts = urlPath.split('/').filter(Boolean);
    const assetExt = /\.(js|css|png|jpg|jpeg|svg|ico|webp|woff2?|map)$/i;
    if (parts.length >= 1 && !assetExt.test(parts[0]) && parts[0] !== 'js' && parts[0] !== 'css') {
      // first segment is slug
      urlPath = '/' + parts.slice(1).join('/');
      if (urlPath === '/') urlPath = '/index.html';
    }
  }
  const filePath = safeJoin(RADIO_WEB, urlPath);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  const sendHtml = (buf) => {
    const html = injectPanelCacheBust(buf.toString('utf8'), readDeployVersion());
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders() });
    res.end(html);
  };
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      const index = path.join(RADIO_WEB, 'index.html');
      return fs.readFile(index, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        sendHtml(buf);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (e2, buf) => {
      if (e2) { res.writeHead(500); return res.end('Read error'); }
      if (ext === '.html') return sendHtml(buf);
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': (ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=3600',
        ...corsHeaders()
      });
      res.end(buf);
    });
  });
}

function serveRadioStudioWeb(req, res) {
  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/radio-studio') urlPath = '/';
  else if (urlPath.startsWith('/radio-studio/')) urlPath = urlPath.slice('/radio-studio'.length);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = safeJoin(RADIO_STUDIO_WEB, urlPath);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  const sendHtml = (buf) => {
    const html = injectPanelCacheBust(buf.toString('utf8'), readDeployVersion());
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders() });
    res.end(html);
  };
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      const index = path.join(RADIO_STUDIO_WEB, 'index.html');
      return fs.readFile(index, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        sendHtml(buf);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (e2, buf) => {
      if (e2) { res.writeHead(500); return res.end('Read error'); }
      if (ext === '.html') return sendHtml(buf);
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': (ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=3600',
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
    ''
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
    ''
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

function syncPlatformWebConfig() {
  try {
    fs.mkdirSync(path.join(PLATFORM_WEB, 'js'), { recursive: true });
    fs.writeFileSync(path.join(PLATFORM_WEB, 'js', 'config.js'), portalConfig('__PLATFORM_CONFIG__', '/platform/'), 'utf8');
  } catch (e) { console.warn('[platform-web] config write failed:', e.message); }
}

function platformControlEnabled() {
  const s = String(process.env.PLATFORM_CONTROL_ENABLED || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/** Phase 4: reject portal/API mounts when module entitlement is OFF (lab only). */
function denyIfNotEntitled(res, urlPath) {
  try {
    const entitlements = require('./electron/services/entitlements');
    const gate = entitlements.assertHttpMountAllowed(urlPath);
    if (gate && gate.allowed === false) {
      const err = gate.error || {};
      writeJson(res, err.status || 403, {
        success: false,
        error: err.message || 'FEATURE_NOT_INCLUDED',
        code: err.code || 'FEATURE_NOT_INCLUDED',
        module_id: err.module_id || null
      });
      return true;
    }
  } catch (_) { /* */ }
  return false;
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

function serveCustomerWeb(req, res) {
  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath.startsWith('/order')) urlPath = urlPath.slice(6) || '/';
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = safeJoin(CUSTOMER_WEB, urlPath);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  const sendHtml = (buf) => {
    const html = injectPanelCacheBust(buf.toString('utf8'), readDeployVersion());
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders() });
    res.end(html);
  };
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      const index = path.join(CUSTOMER_WEB, 'index.html');
      return fs.readFile(index, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        sendHtml(buf);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (e2, buf) => {
      if (e2) { res.writeHead(500); return res.end('Read error'); }
      if (ext === '.html') return sendHtml(buf);
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': (ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=3600',
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

function readDeployVersion() {
  try {
    return fs.readFileSync(path.join(__dirname, 'deploy-version.txt'), 'utf8').trim();
  } catch (_) {
    return '';
  }
}

/** Bust browser cache for core bundles that change every deploy. */
function injectDeployCacheBust(html, deployVersion) {
  if (!deployVersion || !html) return html;
  const q = `?v=${encodeURIComponent(deployVersion)}`;
  return html
    .replace(
      /(<script defer src="js\/(?:utils|data-cache|offline-store|supabase-bootstrap|api|app)\.js)">/g,
      `$1${q}">`
    )
    .replace(
      /(<script src="(?:js\/app\.js|\/shared\/panel-notify\.js|\/shared\/panel-sound\.js)">)/g,
      (m) => (m.includes('?v=') ? m : m.replace('.js">', `.js${q}">`))
    );
}

/** Bust cache for panel HTML (Expenses / Manager / Driver) script and CSS tags. */
function injectPanelCacheBust(html, deployVersion) {
  if (!deployVersion || !html) return html;
  const q = `?v=${encodeURIComponent(deployVersion)}`;
  return html.replace(
    /((?:src|href)=")((?:\/shared\/|shared\/|js\/|css\/)[^"?]+\.(?:js|css))(")/g,
    (_, a, url, c) => `${a}${url}${q}${c}`
  );
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
        const html = injectDeployCacheBust(decodeTextBuffer(buf), readDeployVersion());
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() });
        res.end(html);
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
      let body = buf;
      if (ext === '.html') {
        body = Buffer.from(injectDeployCacheBust(decodeTextBuffer(buf), readDeployVersion()), 'utf8');
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, ...corsHeaders() });
      res.end(body);
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
    ''
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
  syncDriverWebConfig();
  syncExpenseWebConfig();
  syncManagerOpsWebConfig();
  syncStudioWebConfig();
  syncRadioWebConfigs();
  syncInvestorWebConfig();
  syncReleaseWebConfig();
  syncMeetingWebConfig();
  syncSignageWebConfig();
  syncKioskWebConfig();
  syncDriveThruWebConfig();
  syncPlatformWebConfig();
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
    try {
      const store = require('./electron/services/store');
      store.runStartupTasks();
      console.log('[DB] Startup tasks completed (loyalty backfill, reminders, etc.)');
    } catch (e) {
      console.warn('[DB] Startup tasks:', e.message || e);
    }
    try {
      require('./electron/services/payment-gateway').ensurePaymentGatewaySchema();
      console.log('[DB] Payment gateway schema ready');
    } catch (e) {
      console.warn('[DB] Payment gateway schema:', e.message || e);
    }
    try {
      const storage = require('./electron/services/system-storage');
      storage.ensureSchema();
      // Deferred lightweight snapshot — does not block boot or POS traffic
      setTimeout(() => {
        storage.recordStorageSnapshot().then((r) => {
          if (r?.success) console.log('[DB] Storage snapshot:', r.database_size_pretty);
        }).catch((err) => console.warn('[DB] Storage snapshot:', err.message || err));
      }, 45000);
      setInterval(() => {
        storage.recordStorageSnapshot().catch((err) =>
          console.warn('[DB] Storage snapshot:', err.message || err));
      }, 6 * 60 * 60 * 1000); // every 6 hours
      console.log('[DB] Storage monitor schema ready');
    } catch (e) {
      console.warn('[DB] Storage monitor:', e.message || e);
    }
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
        shop_key: process.env.SHOP_ENTITLEMENT_KEY || null,
        handlers: Object.keys(rpc.handlers).length,
        customer_ordering: `${base}/order/`,
        portals: `${base}/portals.html`,
        whatsapp_webhook: `${base}/api/webhooks/whatsapp`
      });
    }

    // Meta WhatsApp Cloud API webhooks (GET verify + POST events)
    if (urlPath === '/api/webhooks/whatsapp') {
      try {
        const entitlements = require('./electron/services/entitlements');
        if (entitlements.enforcementEnabled() && !entitlements.isModuleEnabled('mod.communication')) {
          return writeJson(res, 403, { success: false, error: 'FEATURE_NOT_INCLUDED', code: 'FEATURE_NOT_INCLUDED' });
        }
      } catch (_) { /* */ }
      const waHook = require('./electron/services/whatsapp-webhook');
      if (req.method === 'GET') {
        const q = Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams.entries());
        const result = waHook.handleVerify(q);
        res.writeHead(result.status, {
          'Content-Type': result.contentType || 'text/plain; charset=utf-8',
          ...corsHeaders()
        });
        return res.end(result.body);
      }
      if (req.method === 'POST') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const rawBody = Buffer.concat(chunks);
        try {
          const result = waHook.handleEvent(rawBody, req.headers);
          return writeJson(res, result.status || 200, result.body || { success: true });
        } catch (e) {
          console.error('[webhook] whatsapp:', e.message || e);
          // Still 200 so Meta does not storm retries on handler bugs after ack path
          return writeJson(res, 200, { success: true });
        }
      }
      res.writeHead(405, corsHeaders());
      return res.end('Method Not Allowed');
    }

    // Payment gateway webhooks (raw body required for signature verification)
    if (urlPath.startsWith('/api/webhooks/payments/') && req.method === 'POST') {
      const provider = decodeURIComponent(urlPath.replace('/api/webhooks/payments/', '').split('/')[0] || '');
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const rawBody = Buffer.concat(chunks);
      try {
        const payGw = require('./electron/services/payment-gateway');
        const result = await payGw.processWebhook(provider, rawBody, req.headers);
        return writeJson(res, result.status || 200, result.body || { success: true });
      } catch (e) {
        console.error('[webhook] payment:', e.message || e);
        return writeJson(res, 500, { success: false, error: 'Webhook handler error' });
      }
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
        const send = (buf) => {
          res.writeHead(200, { 'Content-Type': file.mime || 'image/jpeg', 'Cache-Control': 'private, max-age=3600', ...corsHeaders() });
          res.end(buf);
        };
        if (file.buffer) return send(file.buffer);
        return fs.readFile(file.path, (err, buf) => {
          if (err) { res.writeHead(404); return res.end('Not found'); }
          send(buf);
        });
      } catch (e) {
        res.writeHead(404);
        return res.end('Not found');
      }
    }

    const PUBLIC_IMAGE_CACHE = 'public, max-age=86400, stale-while-revalidate=604800';

    if (urlPath.startsWith('/api/product-image/')) {
      const productId = urlPath.replace('/api/product-image/', '').split('?')[0];
      try {
        const { getProductImage } = require('./lib/product-images');
        const file = getProductImage(Number(productId));
        res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': PUBLIC_IMAGE_CACHE, ...corsHeaders() });
        return res.end(file.buffer);
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
        res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': PUBLIC_IMAGE_CACHE, ...corsHeaders() });
        return res.end(file.buffer);
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
        res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': PUBLIC_IMAGE_CACHE, ...corsHeaders() });
        return res.end(file.buffer);
      } catch (e) {
        res.writeHead(e.message === 'Image not available' ? 404 : 500);
        return res.end(String(e.message || 'Error'));
      }
    }

    if (urlPath.startsWith('/signage-media/')) {
      if (denyIfNotEntitled(res, '/signage-media')) return;
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

    if (urlPath.startsWith('/radio-media/')) {
      const mediaId = urlPath.replace('/radio-media/', '').split('?')[0];
      const q = (req.url || '').split('?')[1] || '';
      const token = new URLSearchParams(q).get('token');
      try {
        const radio = require('./electron/services/radio-platform');
        const file = radio.getMediaFile(Number(mediaId), token);
        const stat = fs.statSync(file.path);
        const total = stat.size;
        const mime = file.mime || 'audio/mpeg';
        const range = req.headers.range;
        const cors = corsHeaders();
        if (range) {
          const m = String(range).match(/bytes=(\d*)-(\d*)/);
          let start = m && m[1] ? parseInt(m[1], 10) : 0;
          let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
          if (Number.isNaN(start)) start = 0;
          if (Number.isNaN(end) || end >= total) end = total - 1;
          if (start >= total || start > end) {
            res.writeHead(416, { 'Content-Range': `bytes */${total}`, ...cors });
            return res.end();
          }
          const chunkSize = end - start + 1;
          res.writeHead(206, {
            'Content-Type': mime,
            'Content-Length': chunkSize,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=3600',
            ...cors
          });
          return fs.createReadStream(file.path, { start, end }).pipe(res);
        }
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Length': total,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=3600',
          ...cors
        });
        return fs.createReadStream(file.path).pipe(res);
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
      if (denyIfNotEntitled(res, '/signage-sse')) return;
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

    if (urlPath === '/apply' || urlPath.startsWith('/apply/')) {
      const applyFile = path.join(SRC, 'apply.html');
      return fs.readFile(applyFile, (e2, buf) => {
        if (e2) {
          res.writeHead(404);
          return res.end('Apply page not found');
        }
        const html = injectPanelCacheBust(buf.toString('utf8'), readDeployVersion());
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders() });
        res.end(html);
      });
    }

    // Customer ordering website (PWA)
    if (urlPath === '/order') {
      if (denyIfNotEntitled(res, '/order')) return;
      res.writeHead(301, { Location: '/order/', ...corsHeaders() });
      return res.end();
    }
    if (urlPath.startsWith('/order/')) {
      if (denyIfNotEntitled(res, '/order')) return;
      return serveCustomerWeb(req, res);
    }

    if (urlPath === '/manager' || urlPath.startsWith('/manager/')) {
      if (denyIfNotEntitled(res, '/manager')) return;
      return serveManagerWeb(req, res);
    }

    if (urlPath === '/driver' || urlPath.startsWith('/driver/')) {
      if (denyIfNotEntitled(res, '/driver')) return;
      return serveDriverWeb(req, res);
    }

    if (urlPath === '/expenses' || urlPath.startsWith('/expenses/')) {
      if (denyIfNotEntitled(res, '/expenses')) return;
      return serveExpenseWeb(req, res);
    }

    if (urlPath === '/manager-ops' || urlPath.startsWith('/manager-ops/')) {
      if (denyIfNotEntitled(res, '/manager-ops')) return;
      return serveManagerOpsWeb(req, res);
    }

    if (urlPath === '/studio' || urlPath.startsWith('/studio/')) {
      if (denyIfNotEntitled(res, '/studio')) return;
      return serveStudioWeb(req, res);
    }

    if (urlPath === '/radio-studio' || urlPath.startsWith('/radio-studio/')) {
      if (denyIfNotEntitled(res, '/radio-studio')) return;
      return serveRadioStudioWeb(req, res);
    }

    if (urlPath === '/radio' || urlPath.startsWith('/radio/')) {
      if (denyIfNotEntitled(res, '/radio')) return;
      return serveRadioWeb(req, res);
    }

    if (urlPath === '/investor' || urlPath.startsWith('/investor/')) {
      if (denyIfNotEntitled(res, '/investor')) return;
      return servePortalWeb(req, res, INVESTOR_WEB, '/investor');
    }

    if (urlPath === '/release' || urlPath.startsWith('/release/')) {
      if (denyIfNotEntitled(res, '/release')) return;
      return servePortalWeb(req, res, RELEASE_WEB, '/release');
    }

    if (urlPath === '/meeting' || urlPath.startsWith('/meeting/')) {
      if (denyIfNotEntitled(res, '/meeting')) return;
      return servePortalWeb(req, res, MEETING_WEB, '/meeting');
    }

    if (urlPath === '/signage' || urlPath.startsWith('/signage/')) {
      if (denyIfNotEntitled(res, '/signage')) return;
      return servePortalWeb(req, res, SIGNAGE_WEB, '/signage');
    }

    if (urlPath === '/signage-player' || urlPath.startsWith('/signage-player/')) {
      if (denyIfNotEntitled(res, '/signage-player')) return;
      return servePortalWeb(req, res, SIGNAGE_PLAYER, '/signage-player');
    }

    if (urlPath === '/kiosk' || urlPath.startsWith('/kiosk/')) {
      if (denyIfNotEntitled(res, '/kiosk')) return;
      return servePortalWeb(req, res, KIOSK_WEB, '/kiosk');
    }

    if (urlPath === '/drive-thru' || urlPath.startsWith('/drive-thru/')) {
      if (denyIfNotEntitled(res, '/drive-thru')) return;
      return servePortalWeb(req, res, DRIVE_THRU_WEB, '/drive-thru');
    }

    if (urlPath === '/platform' || urlPath.startsWith('/platform/')) {
      if (!platformControlEnabled()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders() });
        return res.end('Platform Control is not enabled on this deployment');
      }
      return servePortalWeb(req, res, PLATFORM_WEB, '/platform');
    }

    if (urlPath === '/activate' || urlPath.startsWith('/activate/')) {
      const activateFile = path.join(PLATFORM_WEB, 'activate.html');
      if (fs.existsSync(activateFile)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() });
        return res.end(fs.readFileSync(activateFile));
      }
    }

    if (urlPath === '/register-shop' || urlPath.startsWith('/register-shop/')) {
      if (!platformControlEnabled()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders() });
        return res.end('Shop registration is not enabled on this deployment');
      }
      const regFile = path.join(PLATFORM_WEB, 'register-shop.html');
      if (fs.existsSync(regFile)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() });
        return res.end(fs.readFileSync(regFile));
      }
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
    console.log(`  Driver:   http://localhost:${PORT}/driver/`);
    console.log(`  Expenses: http://localhost:${PORT}/expenses/`);
    console.log(`  Manager Ops: http://localhost:${PORT}/manager-ops/`);
    console.log(`  Studio:   http://localhost:${PORT}/studio/`);
    console.log(`  Radio:    http://localhost:${PORT}/radio/main/`);
    console.log(`  Radio Studio: http://localhost:${PORT}/radio-studio/`);
    console.log(`  Investor: http://localhost:${PORT}/investor/`);
    console.log(`  Release:  http://localhost:${PORT}/release/`);
    console.log(`  Meeting:  http://localhost:${PORT}/meeting/`);
    console.log(`  Signage:  http://localhost:${PORT}/signage/`);
    console.log(`  Player:   http://localhost:${PORT}/signage-player/`);
    console.log(`  Kiosk:    http://localhost:${PORT}/kiosk/`);
    console.log(`  Drive-Thru: http://localhost:${PORT}/drive-thru/`);
    console.log(`  Platform: http://localhost:${PORT}/platform/`);
    console.log(`  Register: http://localhost:${PORT}/register-shop`);
    console.log(`  Track:    http://localhost:${PORT}/track/TOKEN`);
    console.log('');
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

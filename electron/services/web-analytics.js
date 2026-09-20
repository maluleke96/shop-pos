/**
 * Privacy-safe website visitor analytics for the customer order site.
 * Anonymous visitors stay anonymous. Customer identity is attached only
 * after login / order, and marketing follow-up requires marketing consent.
 */
const { getDb } = require('../database/db');

const EVENT_TYPES = new Set([
  'page_view', 'view_menu', 'view_product', 'view_special', 'add_to_cart',
  'start_checkout', 'complete_order', 'abandon_cart', 'heartbeat'
]);
const PAGE_KEYS = new Set([
  'home', 'menu', 'product', 'specials', 'cart', 'checkout', 'confirmed',
  'login', 'register', 'account', 'orders', 'order-detail', 'branches',
  'contact', 'forgot', 'welcome'
]);
const ACTIVE_MS = 2 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 80;
const _rate = new Map();

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }

function isPgCloud() {
  try {
    return !!(process.env.SHOP_POS_DATABASE_URL || process.env.DATABASE_URL);
  } catch (_) { return false; }
}

function nowIso() { return new Date().toISOString(); }

function clampText(v, max) {
  const s = String(v == null ? '' : v).trim();
  return s ? s.slice(0, max) : null;
}

function isPg() { return isPgCloud(); }

function ensureWebAnalyticsSchema() {
  const sqlite = `
    CREATE TABLE IF NOT EXISTS web_visitor_sessions (
      id TEXT PRIMARY KEY,
      visitor_key TEXT,
      customer_id INTEGER,
      customer_label TEXT,
      marketing_consent INTEGER DEFAULT 0,
      analytics_consent INTEGER DEFAULT 1,
      device_type TEXT,
      browser TEXT,
      platform TEXT,
      source TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_content TEXT,
      landing_page TEXT,
      started_at TEXT,
      last_seen_at TEXT,
      page_count INTEGER DEFAULT 0,
      duration_sec INTEGER DEFAULT 0,
      bounced INTEGER DEFAULT 0,
      converted INTEGER DEFAULT 0,
      order_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS web_visitor_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      visitor_key TEXT,
      customer_id INTEGER,
      event_type TEXT,
      page TEXT,
      page_label TEXT,
      product_id TEXT,
      product_name TEXT,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_web_vis_sess_seen ON web_visitor_sessions(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_web_vis_sess_start ON web_visitor_sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_web_vis_evt_created ON web_visitor_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_web_vis_evt_type ON web_visitor_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_web_vis_evt_sess ON web_visitor_events(session_id);
  `;
  const pg = `
    CREATE TABLE IF NOT EXISTS web_visitor_sessions (
      id TEXT PRIMARY KEY,
      visitor_key TEXT,
      customer_id INTEGER,
      customer_label TEXT,
      marketing_consent INTEGER DEFAULT 0,
      analytics_consent INTEGER DEFAULT 1,
      device_type TEXT,
      browser TEXT,
      platform TEXT,
      source TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_content TEXT,
      landing_page TEXT,
      started_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ,
      page_count INTEGER DEFAULT 0,
      duration_sec INTEGER DEFAULT 0,
      bounced INTEGER DEFAULT 0,
      converted INTEGER DEFAULT 0,
      order_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS web_visitor_events (
      id SERIAL PRIMARY KEY,
      session_id TEXT,
      visitor_key TEXT,
      customer_id INTEGER,
      event_type TEXT,
      page TEXT,
      page_label TEXT,
      product_id TEXT,
      product_name TEXT,
      created_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_web_vis_sess_seen ON web_visitor_sessions(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_web_vis_sess_start ON web_visitor_sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_web_vis_evt_created ON web_visitor_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_web_vis_evt_type ON web_visitor_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_web_vis_evt_sess ON web_visitor_events(session_id);
  `;
  try {
    getDb().exec(isPg() ? pg : sqlite);
  } catch (err) {
    const msg = String(err.message || err);
    if (!/already exists/i.test(msg)) {
      try { getDb().exec(isPg() ? sqlite : pg); } catch (_) { /* */ }
    }
  }
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_web_vis_sess_seen ON web_visitor_sessions(last_seen_at)',
    'CREATE INDEX IF NOT EXISTS idx_web_vis_sess_start ON web_visitor_sessions(started_at)',
    'CREATE INDEX IF NOT EXISTS idx_web_vis_evt_created ON web_visitor_events(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_web_vis_evt_type ON web_visitor_events(event_type)',
    'CREATE INDEX IF NOT EXISTS idx_web_vis_evt_sess ON web_visitor_events(session_id)'
  ];
  for (const sql of indexes) {
    try { getDb().exec(sql); } catch (_) { /* */ }
  }
}

function allowRate(sessionId) {
  const now = Date.now();
  const key = String(sessionId || 'anon');
  const row = _rate.get(key) || { t: now, n: 0 };
  if (now - row.t > RATE_WINDOW_MS) {
    _rate.set(key, { t: now, n: 1 });
    return true;
  }
  row.n += 1;
  _rate.set(key, row);
  if (_rate.size > 2000) {
    for (const [k, v] of _rate) {
      if (now - v.t > RATE_WINDOW_MS) _rate.delete(k);
    }
  }
  return row.n <= RATE_MAX;
}

function parseDevice(ua) {
  const s = String(ua || '');
  const tablet = /iPad|Tablet|Android(?!.*Mobile)/i.test(s);
  const mobile = /Mobi|iPhone|Android/i.test(s);
  const type = tablet ? 'tablet' : (mobile ? 'mobile' : 'desktop');
  let browser = 'Other';
  if (/Edg\//.test(s)) browser = 'Edge';
  else if (/Chrome\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s) && !/Chrome/.test(s)) browser = 'Safari';
  else if (/Firefox\//.test(s)) browser = 'Firefox';
  let platform = 'Other';
  if (/Windows/i.test(s)) platform = 'Windows';
  else if (/Mac OS/i.test(s)) platform = 'macOS';
  else if (/Android/i.test(s)) platform = 'Android';
  else if (/iPhone|iPad/i.test(s)) platform = 'iOS';
  return { type, browser, platform };
}

function parseSource(referrerHost, utm) {
  const u = String(utm?.source || utm?.utm_source || '').toLowerCase();
  if (u) {
    if (/facebook|fb/.test(u)) return 'facebook';
    if (/instagram|ig/.test(u)) return 'instagram';
    if (/whatsapp|wa/.test(u)) return 'whatsapp';
    if (/google|bing|yahoo/.test(u)) return 'google';
    return 'campaign';
  }
  const ref = String(referrerHost || '').toLowerCase();
  if (!ref) return 'direct';
  if (/google\.|bing\.|yahoo\./.test(ref)) return 'google';
  if (/facebook|fb\./.test(ref)) return 'facebook';
  if (/instagram/.test(ref)) return 'instagram';
  if (/whatsapp|wa\.me/.test(ref)) return 'whatsapp';
  return 'other';
}

function resolveCustomer(token) {
  if (!token) return null;
  try {
    const web = require('./online-ordering');
    const acct = web.getCustomerAccount(token);
    const profile = acct?.profile || acct;
    if (!profile?.id) return null;
    const first = String(profile.first_name || '').trim();
    const last = String(profile.last_name || '').trim();
    const label = first ? (last ? `${first} ${last.charAt(0)}.` : first) : 'Customer';
    return {
      id: Number(profile.id),
      label,
      marketing_consent: profile.marketing_opt_in !== 0 && profile.marketing_opt_in !== false && profile.marketing_opt_in !== '0'
    };
  } catch (_) {
    return null;
  }
}

function validSessionId(id) {
  return /^ws_[a-zA-Z0-9_-]{8,48}$/.test(String(id || ''));
}
function validVisitorKey(id) {
  return /^vk_[a-zA-Z0-9_-]{8,48}$/.test(String(id || ''));
}

function trackEvents(payload = {}, meta = {}) {
  ensureWebAnalyticsSchema();
  if (payload.analytics_consent === false) return { accepted: 0, reason: 'no_consent' };
  const sessionId = String(payload.session_id || '');
  if (!validSessionId(sessionId)) throw new Error('Invalid session');
  if (!allowRate(sessionId)) return { accepted: 0, reason: 'rate_limited' };
  const visitorKey = validVisitorKey(payload.visitor_key) ? payload.visitor_key : null;
  const events = Array.isArray(payload.events) ? payload.events.slice(0, 40) : [];
  if (!events.length) return { accepted: 0 };
  const customer = resolveCustomer(payload.token);
  const uaDevice = parseDevice(meta.userAgent || payload.user_agent);
  const utm = payload.utm || {};
  const source = parseSource(payload.referrer_host, {
    source: utm.source || utm.utm_source
  });
  const now = nowIso();
  let sess = dbGet('SELECT * FROM web_visitor_sessions WHERE id = ?', [sessionId]);
  const marketingConsent = customer?.marketing_consent
    ? 1
    : (payload.marketing_consent === true ? 1 : 0);
  if (!sess) {
    dbRun(`INSERT INTO web_visitor_sessions (
      id, visitor_key, customer_id, customer_label, marketing_consent, analytics_consent,
      device_type, browser, platform, source, utm_source, utm_medium, utm_campaign, utm_content,
      landing_page, started_at, last_seen_at, page_count, duration_sec, bounced, converted
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,1,0)`, [
      sessionId, visitorKey, customer?.id || null, customer?.label || null, marketingConsent, 1,
      clampText(payload.device?.type || uaDevice.type, 20),
      clampText(payload.device?.browser || uaDevice.browser, 30),
      clampText(payload.device?.platform || uaDevice.platform, 30),
      source,
      clampText(utm.source || utm.utm_source, 80),
      clampText(utm.medium || utm.utm_medium, 80),
      clampText(utm.campaign || utm.utm_campaign, 80),
      clampText(utm.content || utm.utm_content, 80),
      clampText(payload.landing_page, 40) || 'home',
      now, now
    ]);
    sess = dbGet('SELECT * FROM web_visitor_sessions WHERE id = ?', [sessionId]);
  } else if (customer?.id && !sess.customer_id) {
    dbRun('UPDATE web_visitor_sessions SET customer_id=?, customer_label=?, marketing_consent=? WHERE id=?',
      [customer.id, customer.label, marketingConsent, sessionId]);
  }

  let pageAdds = 0;
  let converted = Number(sess.converted || 0);
  let orderId = sess.order_id || null;
  for (const raw of events) {
    const type = String(raw.type || raw.event_type || '').toLowerCase();
    if (!EVENT_TYPES.has(type)) continue;
    const page = PAGE_KEYS.has(String(raw.page || '')) ? String(raw.page) : 'home';
    if (type === 'page_view') pageAdds += 1;
    if (type === 'complete_order') {
      converted = 1;
      orderId = raw.order_id || orderId;
    }
    dbRun(`INSERT INTO web_visitor_events
      (session_id, visitor_key, customer_id, event_type, page, page_label, product_id, product_name, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`, [
      sessionId, visitorKey, customer?.id || sess.customer_id || null, type, page,
      clampText(raw.page_label || page, 80),
      clampText(raw.product_id, 40),
      clampText(raw.product_name, 80),
      now
    ]);
  }
  const started = Date.parse(sess.started_at || now) || Date.now();
  const duration = Math.max(0, Math.round((Date.now() - started) / 1000));
  const pageCount = Number(sess.page_count || 0) + pageAdds;
  const bounced = pageCount <= 1 && !converted ? 1 : 0;
  dbRun(`UPDATE web_visitor_sessions SET last_seen_at=?, page_count=?, duration_sec=?, bounced=?, converted=?, order_id=?
    WHERE id=?`, [now, pageCount, duration, bounced, converted, orderId, sessionId]);
  return { accepted: events.length, session_id: sessionId };
}

function rangeBounds(filters = {}) {
  const today = new Date().toLocaleDateString('en-CA');
  let from = String(filters.from || today).slice(0, 10);
  let to = String(filters.to || today).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) to = today;
  if (from > to) { const t = from; from = to; to = t; }
  return {
    from,
    to,
    start: `${from}T00:00:00.000`,
    end: `${to}T23:59:59.999`
  };
}

function previousRange(bounds) {
  const fromD = new Date(`${bounds.from}T00:00:00`);
  const toD = new Date(`${bounds.to}T23:59:59`);
  const days = Math.max(1, Math.round((toD - fromD) / 86400000) + 1);
  const prevTo = new Date(fromD);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));
  const from = prevFrom.toLocaleDateString('en-CA');
  const to = prevTo.toLocaleDateString('en-CA');
  return { from, to, start: `${from}T00:00:00.000`, end: `${to}T23:59:59.999` };
}

function countSessions(start, end) {
  return Number(dbGet(`SELECT COUNT(*) AS c FROM web_visitor_sessions WHERE started_at >= ? AND started_at <= ?`, [start, end])?.c || 0);
}

function uniqueVisitors(start, end) {
  return Number(dbGet(`SELECT COUNT(DISTINCT visitor_key) AS c FROM web_visitor_sessions
    WHERE started_at >= ? AND started_at <= ? AND visitor_key IS NOT NULL`, [start, end])?.c || 0);
}

function eventVisitors(type, start, end) {
  return Number(dbGet(`SELECT COUNT(DISTINCT session_id) AS c FROM web_visitor_events
    WHERE event_type = ? AND created_at >= ? AND created_at <= ?`, [type, start, end])?.c || 0);
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function guestLabel(sess) {
  if (sess.customer_id && sess.customer_label) return sess.customer_label;
  const key = String(sess.visitor_key || sess.session_id || sess.id || 'guest');
  return `Guest · ${key.slice(-4)}`;
}

function getVisitorOverview(filters = {}) {
  ensureWebAnalyticsSchema();
  const b = rangeBounds(filters);
  const today = new Date().toLocaleDateString('en-CA');
  const weekFrom = new Date();
  weekFrom.setDate(weekFrom.getDate() - 6);
  const monthFrom = new Date();
  monthFrom.setDate(1);
  const todayB = rangeBounds({ from: today, to: today });
  const weekB = rangeBounds({ from: weekFrom.toLocaleDateString('en-CA'), to: today });
  const monthB = rangeBounds({ from: monthFrom.toLocaleDateString('en-CA'), to: today });
  const activeSince = new Date(Date.now() - ACTIVE_MS).toISOString();
  const sessions = countSessions(b.start, b.end);
  const unique = uniqueVisitors(b.start, b.end);
  const returning = Number(dbGet(`SELECT COUNT(*) AS c FROM (
      SELECT visitor_key FROM web_visitor_sessions
      WHERE started_at >= ? AND started_at <= ? AND visitor_key IS NOT NULL
      GROUP BY visitor_key HAVING COUNT(*) > 1
    ) t`, [b.start, b.end])?.c || 0);
  const avg = dbGet(`SELECT AVG(duration_sec) AS d, AVG(CASE WHEN bounced=1 THEN 1.0 ELSE 0 END) AS bounce
    FROM web_visitor_sessions WHERE started_at >= ? AND started_at <= ?`, [b.start, b.end]);
  const totalVisits = Number(dbGet('SELECT COUNT(*) AS c FROM web_visitor_sessions')?.c || 0);
  return {
    range: { from: b.from, to: b.to },
    visitors_today: countSessions(todayB.start, todayB.end),
    unique_today: uniqueVisitors(todayB.start, todayB.end),
    returning_visitors: returning,
    visitors_week: countSessions(weekB.start, weekB.end),
    visitors_month: countSessions(monthB.start, monthB.end),
    active_now: Number(dbGet('SELECT COUNT(*) AS c FROM web_visitor_sessions WHERE last_seen_at >= ?', [activeSince])?.c || 0),
    total_visits: totalVisits,
    visitors_period: sessions,
    unique_period: unique,
    avg_session_sec: Math.round(Number(avg?.d || 0)),
    bounce_rate: Math.round(Number(avg?.bounce || 0) * 1000) / 10
  };
}

function getVisitorActivity(filters = {}) {
  ensureWebAnalyticsSchema();
  const b = rangeBounds(filters);
  const limit = Math.min(200, Number(filters.limit) || 80);
  const rows = dbAll(`SELECT e.created_at, e.session_id, e.visitor_key, e.customer_id, e.event_type, e.page, e.page_label,
      e.product_name, s.device_type, s.source, s.duration_sec, s.customer_label, s.marketing_consent
    FROM web_visitor_events e
    LEFT JOIN web_visitor_sessions s ON s.id = e.session_id
    WHERE e.created_at >= ? AND e.created_at <= ? AND e.event_type != 'heartbeat'
    ORDER BY e.created_at DESC LIMIT ?`, [b.start, b.end, limit]);
  return rows.map((r) => ({
    created_at: r.created_at,
    session_id: r.session_id,
    visitor: guestLabel(r),
    page: r.page_label || r.page,
    product: r.product_name || null,
    device: r.device_type || '—',
    source: r.source || 'direct',
    action: r.event_type,
    duration_sec: r.duration_sec || 0
  }));
}

function getPageAnalysis(filters = {}) {
  ensureWebAnalyticsSchema();
  const b = rangeBounds(filters);
  const pages = dbAll(`SELECT page, COUNT(*) AS views, COUNT(DISTINCT session_id) AS uniques,
      COUNT(DISTINCT CASE WHEN event_type = 'complete_order' THEN session_id END) AS orders
    FROM web_visitor_events
    WHERE created_at >= ? AND created_at <= ? AND event_type = 'page_view'
    GROUP BY page ORDER BY views DESC`, [b.start, b.end]);
  const avgTimes = dbAll(`SELECT landing_page AS page, AVG(duration_sec) AS avg_sec
    FROM web_visitor_sessions WHERE started_at >= ? AND started_at <= ?
    GROUP BY landing_page`, [b.start, b.end]);
  const avgMap = Object.fromEntries(avgTimes.map((r) => [r.page, Math.round(Number(r.avg_sec || 0))]));
  return pages.map((p) => ({
    page: p.page,
    views: Number(p.views || 0),
    unique_visitors: Number(p.uniques || 0),
    avg_time_sec: avgMap[p.page] || 0,
    conversion: pct(Number(p.orders || 0), Number(p.uniques || 0))
  }));
}

function getFunnel(filters = {}) {
  ensureWebAnalyticsSchema();
  const b = rangeBounds(filters);
  const visitors = countSessions(b.start, b.end);
  const stages = [
    { key: 'visitors', label: 'Website Visitors', count: visitors },
    { key: 'view_menu', label: 'Viewed Menu', count: eventVisitors('view_menu', b.start, b.end) },
    { key: 'view_product', label: 'Viewed Product', count: eventVisitors('view_product', b.start, b.end) },
    { key: 'add_to_cart', label: 'Added to Cart', count: eventVisitors('add_to_cart', b.start, b.end) },
    { key: 'start_checkout', label: 'Started Checkout', count: eventVisitors('start_checkout', b.start, b.end) },
    { key: 'complete_order', label: 'Completed Order', count: eventVisitors('complete_order', b.start, b.end) }
  ];
  return stages.map((s, i) => ({
    ...s,
    pct_of_visitors: pct(s.count, visitors),
    drop_from_prev: i === 0 ? 0 : pct(Math.max(0, stages[i - 1].count - s.count), stages[i - 1].count || 1)
  }));
}

function getTrafficSources(filters = {}) {
  ensureWebAnalyticsSchema();
  const b = rangeBounds(filters);
  return dbAll(`SELECT COALESCE(source, 'direct') AS source, COUNT(*) AS visitors,
      SUM(converted) AS orders
    FROM web_visitor_sessions WHERE started_at >= ? AND started_at <= ?
    GROUP BY COALESCE(source, 'direct') ORDER BY visitors DESC`, [b.start, b.end])
    .map((r) => ({
      source: r.source,
      visitors: Number(r.visitors || 0),
      orders: Number(r.orders || 0),
      conversion: pct(Number(r.orders || 0), Number(r.visitors || 0))
    }));
}

function getDeviceAnalysis(filters = {}) {
  ensureWebAnalyticsSchema();
  const b = rangeBounds(filters);
  const devices = dbAll(`SELECT COALESCE(device_type, 'desktop') AS device, COUNT(*) AS visitors
    FROM web_visitor_sessions WHERE started_at >= ? AND started_at <= ?
    GROUP BY COALESCE(device_type, 'desktop')`, [b.start, b.end]);
  const browsers = dbAll(`SELECT COALESCE(browser, 'Other') AS browser, COALESCE(platform, 'Other') AS platform, COUNT(*) AS visitors
    FROM web_visitor_sessions WHERE started_at >= ? AND started_at <= ?
    GROUP BY COALESCE(browser, 'Other'), COALESCE(platform, 'Other')
    ORDER BY visitors DESC LIMIT 8`, [b.start, b.end]);
  const total = devices.reduce((n, d) => n + Number(d.visitors || 0), 0);
  return {
    devices: devices.map((d) => ({
      device: d.device,
      visitors: Number(d.visitors || 0),
      pct: pct(Number(d.visitors || 0), total)
    })),
    browsers
  };
}

function getLiveActivity() {
  ensureWebAnalyticsSchema();
  const rows = dbAll(`SELECT e.created_at, e.event_type, e.page, e.page_label, e.product_name,
      e.session_id, e.visitor_key, e.customer_id, s.customer_label
    FROM web_visitor_events e
    LEFT JOIN web_visitor_sessions s ON s.id = e.session_id
    WHERE e.event_type != 'heartbeat'
    ORDER BY e.created_at DESC LIMIT 25`);
  return rows.map((r) => ({
    created_at: r.created_at,
    who: guestLabel(r),
    kind: r.customer_id ? 'Customer' : 'Guest',
    page: r.page_label || r.page,
    action: r.event_type,
    product: r.product_name || null
  }));
}

function getPurchaseOpportunities(filters = {}) {
  ensureWebAnalyticsSchema();
  const b = rangeBounds(filters);
  const viewedProduct = eventVisitors('view_product', b.start, b.end);
  const viewedSpecial = eventVisitors('view_special', b.start, b.end);
  const added = eventVisitors('add_to_cart', b.start, b.end);
  const checkout = eventVisitors('start_checkout', b.start, b.end);
  const ordered = eventVisitors('complete_order', b.start, b.end);
  const identifiable = dbAll(`SELECT DISTINCT s.customer_id, s.customer_label, s.visitor_key
    FROM web_visitor_sessions s
    WHERE s.started_at >= ? AND s.started_at <= ?
      AND s.customer_id IS NOT NULL AND s.marketing_consent = 1 AND s.converted = 0
      AND EXISTS (
        SELECT 1 FROM web_visitor_events e
        WHERE e.session_id = s.id AND e.event_type IN ('view_product','view_special','add_to_cart','start_checkout')
      )
    LIMIT 80`, [b.start, b.end]);
  return {
    viewed_products_no_order: Math.max(0, viewedProduct - ordered),
    viewed_specials_no_order: Math.max(0, viewedSpecial - ordered),
    added_cart_no_order: Math.max(0, added - ordered),
    started_checkout_no_order: Math.max(0, checkout - ordered),
    identifiable_followup: identifiable.map((r) => ({
      customer_id: r.customer_id,
      name: r.customer_label,
      visitor: guestLabel(r)
    }))
  };
}

function getSalesComparison(filters = {}) {
  ensureWebAnalyticsSchema();
  const b = rangeBounds(filters);
  const prev = previousRange(b);
  const loadOrders = (start, end) => {
    try {
      const row = dbGet(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
        FROM online_orders_local
        WHERE order_source = 'ONLINE' AND status NOT IN ('rejected','cancelled')
          AND created_at >= ? AND created_at <= ?`, [start, end]);
      const n = Number(row?.orders || 0);
      const revenue = Number(row?.revenue || 0);
      return { orders: n, revenue, avg_order: n ? Math.round((revenue / n) * 100) / 100 : 0 };
    } catch (_) {
      return { orders: 0, revenue: 0, avg_order: 0 };
    }
  };
  const orders = loadOrders(b.start, b.end);
  const prevOrders = loadOrders(prev.start, prev.end);
  const visitors = countSessions(b.start, b.end);
  const prevVisitors = countSessions(prev.start, prev.end);
  const completed = eventVisitors('complete_order', b.start, b.end);
  const prevCompleted = eventVisitors('complete_order', prev.start, prev.end);
  const conversion = pct(completed || orders.orders || 0, visitors);
  const prevConversion = pct(prevCompleted || prevOrders.orders || 0, prevVisitors);
  return {
    visitors,
    online_orders: Number(orders.orders || 0),
    conversion,
    revenue: Number(orders.revenue || 0),
    avg_order: Number(orders.avg_order || 0),
    previous: {
      from: prev.from,
      to: prev.to,
      visitors: prevVisitors,
      online_orders: Number(prevOrders.orders || 0),
      conversion: prevConversion,
      revenue: Number(prevOrders.revenue || 0)
    },
    traffic_change: prevVisitors ? Math.round(((visitors - prevVisitors) / prevVisitors) * 1000) / 10 : 0,
    conversion_change: Math.round((conversion - prevConversion) * 10) / 10
  };
}

function buildInsights(funnel, sales, devices, sources) {
  const tips = [];
  if (sales.visitors && sales.previous.visitors) {
    const t = sales.traffic_change;
    const c = sales.conversion_change;
    if (t > 10 && c < -2) {
      tips.push(`Website traffic increased ${Math.abs(t)}% versus the previous period, but order conversion dropped ${Math.abs(c)} points. Check checkout, delivery fees, and promotion pricing.`);
    } else if (t < -10) {
      tips.push(`Website traffic is down ${Math.abs(t)}% versus the previous period. Review campaign links, WhatsApp posts, and Google visibility.`);
    } else if (c > 2) {
      tips.push(`Order conversion improved ${c} points versus the previous period. Current conversion is ${sales.conversion}%.`);
    }
  }
  const mobile = (devices.devices || []).find((d) => d.device === 'mobile');
  if (mobile && mobile.pct >= 70) {
    tips.push(`${mobile.pct}% of visitors are on phones. Most customers are using mobile — keep the menu and checkout thumb-friendly.`);
  }
  const drop = [...(funnel || [])].slice(1).sort((a, b) => b.drop_from_prev - a.drop_from_prev)[0];
  if (drop && drop.drop_from_prev >= 40) {
    tips.push(`Biggest drop-off is before “${drop.label}” (${drop.drop_from_prev}% left the previous step).`);
  }
  const campaign = (sources || []).find((s) => s.source === 'campaign' || s.source === 'facebook' || s.source === 'instagram');
  if (campaign && campaign.visitors >= 10 && campaign.conversion < 5) {
    tips.push(`${campaign.source} brought ${campaign.visitors} visitors but only ${campaign.conversion}% ordered. The promotion is getting attention — checkout or offer value may be the problem.`);
  }
  if (!tips.length) {
    tips.push('Keep watching this dashboard as real website visits arrive. Figures update from live Order Online tracking — not demo numbers.');
  }
  return tips.slice(0, 4);
}

function getVisitorDashboard(filters = {}, actor) {
  if (actor) {
    const { assertUserActor } = require('./authz');
    assertUserActor(actor, ['owner', 'manager', 'supervisor']);
  }
  ensureWebAnalyticsSchema();
  const overview = getVisitorOverview(filters);
  const activity = getVisitorActivity(filters);
  const pages = getPageAnalysis(filters);
  const funnel = getFunnel(filters);
  const sources = getTrafficSources(filters);
  const devices = getDeviceAnalysis(filters);
  const live = getLiveActivity();
  const opportunities = getPurchaseOpportunities(filters);
  const sales = getSalesComparison(filters);
  return {
    overview,
    activity,
    pages,
    funnel,
    sources,
    devices,
    live,
    opportunities,
    sales,
    insights: buildInsights(funnel, sales, devices, sources)
  };
}

function listOnlineCustomers(filters = {}, actor) {
  if (actor) {
    const { assertUserActor } = require('./authz');
    assertUserActor(actor, ['owner', 'manager', 'supervisor']);
  }
  try {
    return dbAll(`SELECT wc.id, wc.first_name, wc.last_name, wc.email, wc.phone, wc.created_at, wc.marketing_opt_in,
        (SELECT COUNT(*) FROM online_orders_local o
          WHERE o.web_customer_id = wc.id AND o.status NOT IN ('rejected','cancelled')) AS orders,
        (SELECT COALESCE(SUM(total),0) FROM online_orders_local o
          WHERE o.web_customer_id = wc.id AND o.status NOT IN ('rejected','cancelled')) AS spent
      FROM web_customers wc
      WHERE wc.is_active = 1
      ORDER BY wc.id DESC
      LIMIT 200`);
  } catch (_) {
    return [];
  }
}

module.exports = {
  ensureWebAnalyticsSchema,
  trackEvents,
  getVisitorDashboard,
  getPurchaseOpportunities,
  listOnlineCustomers
};

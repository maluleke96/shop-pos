/**
 * Live Railway probe — referral agents + product stock (read-only unless --write).
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
require('../lib/load-env').loadProjectEnv(ROOT);

const BASE = (process.env.SMOKE_URL || 'https://peaceful-motivation-production-7dd2.up.railway.app').replace(/\/$/, '');
const WRITE = process.argv.includes('--write');

async function rpc(method, args = [], headers = {}) {
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ method, args })
  });
  return { status: res.status, json: await res.json() };
}

async function probeDb() {
  process.env.SHOP_POS_CLOUD = '1';
  const { initDatabase, getDb } = require('../electron/database/db');
  await initDatabase();
  const db = getDb();
  const out = { agents: [], products: [], branchStockRows: 0, migrations: [] };
  try {
    out.agents = db.prepare(`
      SELECT id, full_name, status, referral_code, agent_code
      FROM mkt_referral_agents ORDER BY id DESC LIMIT 15
    `).all();
  } catch (e) {
    out.agentsError = e.message;
  }
  try {
    out.products = db.prepare(`
      SELECT p.id, p.name, p.stock_quantity, bs.quantity AS branch_qty, bs.branch_id
      FROM products p
      LEFT JOIN branch_stock bs ON bs.product_id = p.id
      WHERE p.is_active = 1
      ORDER BY p.id LIMIT 5
    `).all();
  } catch (e) {
    out.productsError = e.message;
  }
  try {
    out.branchStockRows = Number(db.prepare('SELECT COUNT(*) AS c FROM branch_stock').get()?.c) || 0;
  } catch (_) { /* */ }
  try {
    out.migrations = db.prepare('SELECT name FROM pg_schema_migrations ORDER BY name').all().map((r) => r.name);
  } catch (_) { /* */ }
  return out;
}

async function probePublicAgents(agents) {
  const results = [];
  for (const a of agents.slice(0, 5)) {
    for (const code of [a.referral_code, a.agent_code].filter(Boolean)) {
      const pub = await rpc('mktp:publicAgent', [code]);
      results.push({
        agent_id: a.id,
        status: a.status,
        code,
        code_type: code === a.referral_code ? 'referral_code' : 'agent_code',
        success: pub.json?.success,
        error: pub.json?.error || null,
        name: pub.json?.data?.full_name || null
      });
    }
  }
  return results;
}

async function probeStockWrite(agents, dbInfo) {
  const user = process.env.SMOKE_USER;
  const pass = process.env.SMOKE_PASS;
  if (!user || !pass) return { skipped: 'Set SMOKE_USER and SMOKE_PASS in .env for stock write test' };

  const login = await rpc('auth:login', [user, pass]);
  if (!login.json?.success) return { skipped: 'login failed', error: login.json?.error };

  const actor = login.json.data?.user;
  const token = login.json.data?.token;
  const headers = token ? { 'x-session-token': token } : {};
  const product = (dbInfo.products || [])[0];
  if (!product) return { skipped: 'no products' };

  const before = Number(product.stock_quantity);
  const target = before + 7;
  const save = await rpc('products:save', [{
    id: product.id,
    name: product.name,
    selling_price: product.selling_price || 10,
    stock_quantity: target
  }, actor], headers);
  const afterGet = await rpc('products:getOne', [product.id], headers);
  const report = await rpc('reports:stock', [], headers);
  const reportRow = (report.json?.data || []).find((p) => p.id === product.id);

  await rpc('products:save', [{
    id: product.id,
    name: product.name,
    selling_price: product.selling_price || 10,
    stock_quantity: before
  }, actor], headers);

  return {
    product_id: product.id,
    before,
    target,
    save_ok: save.json?.success,
    save_error: save.json?.error,
    get_one_qty: afterGet.json?.data?.stock_quantity,
    report_qty: reportRow?.stock_quantity,
    branch_qty_db: product.branch_qty
  };
}

(async () => {
  const report = { url: BASE, at: new Date().toISOString(), checks: {} };

  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  report.checks.health = health;

  const refHtml = await fetch(`${BASE}/r/TEST`).then((r) => ({ status: r.status, ok: r.ok }));
  report.checks.referral_page = refHtml;

  report.checks.db = await probeDb();
  report.checks.public_agents = await probePublicAgents(report.checks.db.agents || []);

  if (WRITE) {
    report.checks.stock_write = await probeStockWrite(null, report.checks.db);
  }

  const deployed = await fetch(`${BASE}/`).then((r) => r.text()).catch(() => '');
  report.checks.has_syncProductBranchStock = deployed.includes('syncProductBranchStock'); // unlikely in bundle
  report.checks.js_data_cache_version = (deployed.match(/_invalidateGen/) || []).length > 0 ? 'maybe_new' : 'old_or_bundled';

  console.log(JSON.stringify(report, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

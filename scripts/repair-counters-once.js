/**
 * One-shot: repair receipt_counter / order_counter corrupted by JS string-concat
 * (node-pg returns bigint as string → "35"+1 → "351").
 */
const { loadProjectEnv } = require('../lib/load-env');
loadProjectEnv();
const { Client } = require('pg');

/** Prefer sane suffixes; skip string-concat corruption (base + many trailing 1s). */
function maxSuffix(rows, field) {
  let max = 0;
  const samples = [];
  for (const row of rows) {
    const raw = String(row[field] || '');
    const m = raw.match(/(\d+)\s*$/);
    if (!m) continue;
    const digits = m[1];
    samples.push(raw);
    // e.g. 35 → 351 → 3511 → 35111… from `"35"+1` under node-pg string bigints
    if (digits.length > 6) continue;
    if (/1{3,}$/.test(digits) && digits.length >= 4) continue;
    const v = Number(digits);
    if (Number.isFinite(v) && v >= 0) max = Math.max(max, Math.floor(v));
  }
  return { max, samples: samples.slice(0, 15) };
}

(async () => {
  const url = process.env.SHOP_POS_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('No SHOP_POS_DATABASE_URL');
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const beforeR = await c.query('SELECT last_number::text AS n FROM receipt_counter WHERE id = 1');
  const beforeO = await c.query('SELECT last_number::text AS n FROM order_counter WHERE id = 1');
  console.log('before receipt', beforeR.rows[0]?.n);
  console.log('before order', beforeO.rows[0]?.n);

  const sales = await c.query(
    'SELECT receipt_number, order_number FROM sales ORDER BY id DESC LIMIT 500'
  );
  const receipt = maxSuffix(sales.rows, 'receipt_number');
  const order = maxSuffix(sales.rows, 'order_number');
  console.log('sample receipts', receipt.samples);
  console.log('sample orders', order.samples);
  console.log('sane max from sales: receipt=', receipt.max, 'order=', order.max);

  await c.query('UPDATE receipt_counter SET last_number = $1 WHERE id = 1', [receipt.max]);
  await c.query('UPDATE order_counter SET last_number = $1 WHERE id = 1', [order.max]);

  const afterR = await c.query('SELECT last_number::text AS n FROM receipt_counter WHERE id = 1');
  const afterO = await c.query('SELECT last_number::text AS n FROM order_counter WHERE id = 1');
  console.log('after receipt', afterR.rows[0]?.n);
  console.log('after order', afterO.rows[0]?.n);
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

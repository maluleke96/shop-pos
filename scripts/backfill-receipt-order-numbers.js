/**
 * Backfill existing sales so receipt_number === order_number and counters
 * continue from the highest used number — without deleting any sales.
 *
 * Usage (local sql.js / SHOP_POS_DATA):
 *   node scripts/backfill-receipt-order-numbers.js
 *
 * Usage (Postgres URL):
 *   set SHOP_POS_DATABASE_URL=postgres://...
 *   node scripts/backfill-receipt-order-numbers.js
 *
 * Safe: only UPDATEs order_number to match receipt_number when they differ
 * (or when order_number is blank). Then sets receipt_counter.last_number
 * to max numeric suffix found on sales.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

function coerce(raw) {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'bigint') return Number(raw);
  const s = String(raw).trim();
  if (!/^\d+$/.test(s) || s.length > 15) return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function maxSuffixFromRows(rows, col) {
  let max = 0;
  for (const r of rows) {
    const m = String(r[col] || '').match(/(\d+)\s*$/);
    if (!m) continue;
    const digits = m[1];
    if (digits.length > 8) continue;
    if (/1{4,}$/.test(digits) && digits.length >= 5) continue;
    max = Math.max(max, coerce(digits));
  }
  return max;
}

async function main() {
  const dry = process.argv.includes('--dry');
  if (!process.env.SHOP_POS_DATA && !process.env.SHOP_POS_DATABASE_URL && !process.env.DATABASE_URL) {
    // Prefer existing shop data dir if present; else temp for smoke
    const homeData = path.join(os.homedir(), 'AppData', 'Roaming', 'shop-pos');
    if (fs.existsSync(homeData)) process.env.SHOP_POS_DATA = homeData;
  }

  await require('../electron/database/db').initDatabase();
  const db = require('../electron/database/db').getDb();

  // Ensure counter table
  try {
    db.prepare(`CREATE TABLE IF NOT EXISTS receipt_counter (
      id INTEGER PRIMARY KEY CHECK (id = 1), last_number INTEGER DEFAULT 0)`).run();
    db.prepare('INSERT OR IGNORE INTO receipt_counter (id, last_number) VALUES (1, 0)').run();
  } catch (_) { /* */ }

  const mismatched = db.prepare(`
    SELECT id, receipt_number, order_number, status, created_at
    FROM sales
    WHERE receipt_number IS NOT NULL AND receipt_number != ''
      AND (
        order_number IS NULL OR order_number = ''
        OR order_number != receipt_number
      )
    ORDER BY id ASC
  `).all();

  console.log(`[backfill] mismatched rows: ${mismatched.length}`);
  if (dry) {
    console.log(mismatched.slice(0, 20));
    console.log(mismatched.length > 20 ? `… +${mismatched.length - 20} more` : '');
  } else {
    const upd = db.prepare(`UPDATE sales SET order_number = receipt_number WHERE id = ?`);
    let n = 0;
    const txn = db.transaction((rows) => {
      for (const row of rows) {
        upd.run(row.id);
        n += 1;
      }
    });
    txn(mismatched);
    console.log(`[backfill] updated order_number = receipt_number on ${n} sales`);
  }

  // Also fix blank receipt_number by copying from order_number when receipt empty
  const blankReceipt = db.prepare(`
    SELECT id, receipt_number, order_number FROM sales
    WHERE (receipt_number IS NULL OR receipt_number = '')
      AND order_number IS NOT NULL AND order_number != ''
  `).all();
  console.log(`[backfill] blank receipt with order: ${blankReceipt.length}`);
  if (!dry && blankReceipt.length) {
    const updR = db.prepare(`UPDATE sales SET receipt_number = order_number WHERE id = ?`);
    const txnR = db.transaction((rows) => {
      for (const row of rows) updR.run(row.id);
    });
    txnR(blankReceipt);
    console.log(`[backfill] filled receipt_number from order_number on ${blankReceipt.length} sales`);
  }

  // Duplicate all-0001 style: assign unique sequential numbers from max+1 without deleting
  // Only when many sales share the exact same receipt_number
  const dups = db.prepare(`
    SELECT receipt_number, COUNT(*) AS c FROM sales
    WHERE receipt_number IS NOT NULL AND receipt_number != ''
    GROUP BY receipt_number HAVING COUNT(*) > 1
    ORDER BY c DESC LIMIT 50
  `).all();
  console.log(`[backfill] duplicate receipt groups: ${dups.length}`);
  if (dups.length) console.log(dups.slice(0, 10));

  if (!dry && dups.length) {
    const settingsRow = db.prepare('SELECT * FROM shop_settings WHERE id = 1').get() || {};
    let prefix = 'RCP';
    let pad = 5;
    let includeDate = true;
    try {
      const rd = JSON.parse(settingsRow.receipt_design || '{}');
      prefix = (rd.receipt_prefix || 'RCP').trim() || 'RCP';
      pad = Math.max(1, Math.min(12, parseInt(rd.receipt_number_pad, 10) || 5));
      includeDate = rd.receipt_include_date !== false;
    } catch (_) { /* */ }

    let floor = 0;
    const allNums = db.prepare('SELECT receipt_number, order_number FROM sales').all();
    floor = Math.max(maxSuffixFromRows(allNums, 'receipt_number'), maxSuffixFromRows(allNums, 'order_number'));

    for (const g of dups) {
      const rows = db.prepare(
        `SELECT id, receipt_number, created_at FROM sales WHERE receipt_number = ? ORDER BY id ASC`
      ).all(g.receipt_number);
      // Keep the oldest (first id) as-is; renumber the rest
      for (let i = 1; i < rows.length; i++) {
        floor += 1;
        const datePart = includeDate
          ? String(rows[i].created_at || '').slice(0, 10).replace(/-/g, '') || new Date().toLocaleDateString('en-CA').replace(/-/g, '')
          : null;
        const numPart = String(floor).padStart(pad, '0');
        const next = datePart ? `${prefix}-${datePart}-${numPart}` : `${prefix}-${numPart}`;
        db.prepare(`UPDATE sales SET receipt_number = ?, order_number = ? WHERE id = ?`).run(next, next, rows[i].id);
        console.log(`[backfill] sale ${rows[i].id}: ${g.receipt_number} → ${next}`);
      }
    }
  }

  // Sync counter to max used
  const all = db.prepare('SELECT receipt_number, order_number FROM sales').all();
  const maxUsed = Math.max(maxSuffixFromRows(all, 'receipt_number'), maxSuffixFromRows(all, 'order_number'));
  const before = db.prepare('SELECT last_number FROM receipt_counter WHERE id = 1').get();
  const current = coerce(before?.last_number);
  const setTo = Math.max(current, maxUsed);
  if (!dry) {
    db.prepare('UPDATE receipt_counter SET last_number = ? WHERE id = 1').run(setTo);
  }
  console.log(`[backfill] receipt_counter ${current} → ${setTo} (maxUsed=${maxUsed})${dry ? ' [dry]' : ''}`);
  console.log('[backfill] DONE — no sales deleted');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

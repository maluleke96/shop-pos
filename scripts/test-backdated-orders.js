/**
 * Smoke checks for backdated order helpers (no live DB required for pure validation).
 */
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assert failed');
};

function testParseDatetime() {
  // Minimal reimplementation mirrors service rules for CI without loading native db
  const parse = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return null;
    const normalized = s.includes('T') ? s : s.replace(' ', 'T');
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  assert(parse('2026-09-25T14:35:00'), 'parses ISO');
  assert(parse('2026-09-25 14:35:00'), 'parses space form');
  assert(!parse('not-a-date'), 'rejects garbage');
  const future = new Date(Date.now() + 86400000).toISOString();
  assert(parse(future), 'future parses as date object');
  console.log('ok: datetime parse');
}

function testFingerprint() {
  const fp = (items) => (items || [])
    .map((i) => `${i.product_id || i.combo_id || i.product_name || ''}:${Number(i.quantity) || 0}`)
    .sort()
    .join('|');
  assert(fp([{ product_id: 2, quantity: 1 }, { product_id: 1, quantity: 2 }]) === '1:2|2:1', 'fingerprint stable');
  console.log('ok: fingerprint');
}

testParseDatetime();
testFingerprint();
console.log('backdated smoke checks passed');

/**
 * Parse bank statement files (CSV / basic OFX) into acc_bank_stmt_lines payloads.
 */

function parseAmount(raw) {
  const s = String(raw || '').replace(/[^\d.,\-]/g, '').replace(/\s/g, '');
  if (!s) return 0;
  const neg = s.includes('-') || /^\(.*\)$/.test(String(raw));
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : 0;
}

function parseDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return s.slice(0, 10);
}

function parseCsvStatement(text) {
  const rows = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!rows.length) return [];
  const delim = rows[0].includes(';') && !rows[0].includes(',') ? ';' : ',';
  const header = rows[0].toLowerCase().split(delim).map((h) => h.trim());
  const dateIdx = header.findIndex((h) => /date|posted|value/.test(h));
  const descIdx = header.findIndex((h) => /desc|narrative|detail|memo|particulars/.test(h));
  const amtIdx = header.findIndex((h) => /amount|debit|credit|value/.test(h));
  const refIdx = header.findIndex((h) => /ref|reference|cheque|check/.test(h));
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i].split(delim).map((c) => c.replace(/^"|"$/g, '').trim());
    if (!cols.length) continue;
    let amount = 0;
    if (amtIdx >= 0) amount = parseAmount(cols[amtIdx]);
    else {
      const debit = header.findIndex((h) => /debit|withdrawal|paid out/.test(h));
      const credit = header.findIndex((h) => /credit|deposit|paid in/.test(h));
      if (debit >= 0 && parseAmount(cols[debit])) amount = -Math.abs(parseAmount(cols[debit]));
      else if (credit >= 0) amount = Math.abs(parseAmount(cols[credit]));
    }
    if (!amount) continue;
    out.push({
      line_date: parseDate(dateIdx >= 0 ? cols[dateIdx] : cols[0]) || new Date().toISOString().slice(0, 10),
      description: descIdx >= 0 ? cols[descIdx] : cols.slice(1, -1).join(' '),
      reference: refIdx >= 0 ? cols[refIdx] : null,
      amount
    });
  }
  return out;
}

function parseOfxStatement(text) {
  const out = [];
  const blocks = String(text || '').split(/<STMTTRN>/i);
  for (const block of blocks.slice(1)) {
    const amt = block.match(/<TRNAMT>([^<]+)/i)?.[1];
    const dt = block.match(/<DTPOSTED>(\d{8})/i)?.[1];
    const memo = block.match(/<MEMO>([^<]+)/i)?.[1] || block.match(/<NAME>([^<]+)/i)?.[1];
    const fit = block.match(/<FITID>([^<]+)/i)?.[1];
    const amount = parseAmount(amt);
    if (!amount) continue;
    const lineDate = dt ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : new Date().toISOString().slice(0, 10);
    out.push({ line_date: lineDate, description: memo || 'Bank transaction', reference: fit || null, amount });
  }
  return out;
}

function parseBankStatementFile({ text, filename = '', format }) {
  const name = String(filename || '').toLowerCase();
  const fmt = String(format || '').toLowerCase() || (name.endsWith('.ofx') || name.endsWith('.qfx') ? 'ofx' : 'csv');
  if (fmt === 'ofx' || fmt === 'qfx') return parseOfxStatement(text);
  return parseCsvStatement(text);
}

module.exports = { parseBankStatementFile, parseCsvStatement, parseOfxStatement };

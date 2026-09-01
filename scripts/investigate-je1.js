const initSqlJs = require('sql.js/dist/sql-asm.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared', 'shop-pos.db');

initSqlJs().then((SQL) => {
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const q = (sql) => {
    const r = db.exec(sql);
    if (!r[0]) return [];
    return r[0].values.map((v) => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]])));
  };

  const receipt = 'RCP-20260826-00002';
  const journal = q(`SELECT * FROM acc_journals WHERE journal_number='JE-00001' OR reference='${receipt}'`)[0];
  const orphanedLines = q(`SELECT l.*, a.code, a.name AS account_name FROM acc_journal_lines l
    LEFT JOIN acc_accounts a ON a.id = l.account_id
    WHERE l.description LIKE '%${receipt}%' OR (l.journal_id = 0 AND l.description LIKE '%00002%')`);
  const sale = q(`SELECT * FROM sales WHERE receipt_number='${receipt}'`)[0];
  const items = sale ? q(`SELECT si.*, p.buying_price FROM sale_items si LEFT JOIN products p ON p.id=si.product_id WHERE sale_id=${sale.id}`) : [];
  const payments = sale ? q(`SELECT * FROM sale_payments WHERE sale_id=${sale.id}`) : [];
  const online = q(`SELECT * FROM online_orders_local WHERE order_number='ORD-20260826-0002'`);

  const cogs = items.reduce((s, it) => s + Number(it.quantity) * Number(it.buying_price || 0), 0);
  const saleTotal = Number(sale?.total || 0);
  const journalTotal = Number(journal?.total_debit || 0);

  console.log(JSON.stringify({
    summary: {
      receipt,
      sale_amount: saleTotal,
      journal_header_total: journalTotal,
      explanation: journalTotal === saleTotal + cogs
        ? 'R190 is total debits/credits (R130 sale + R60 COGS), not the sale amount'
        : 'Amount relationship needs review',
      cogs,
      paid_amount: payments.reduce((s, p) => s + Number(p.amount), 0),
      delivery_fee_in_sale: null,
      journal_lines_orphaned: orphanedLines.every((l) => l.journal_id === 0),
      migrate_recommendation: 'Rebuild from sale snapshot at R130; do not use R190 as sale amount'
    },
    journal,
    orphaned_lines: orphanedLines,
    sale,
    items,
    payments,
    online_orders: online
  }, null, 2));
});

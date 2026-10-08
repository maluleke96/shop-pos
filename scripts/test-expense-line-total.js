#!/usr/bin/env node
const { normalizeLineItems, lineItemsTotal } = require('../lib/expense-line-items');

const rows = normalizeLineItems([
  { name: 'Fish', quantity: 10, unit: 'each', price: 52 },
  { name: 'Oil', quantity: 2, unit: 'L', price: 120 }
]);
const total = lineItemsTotal(rows);
const fish = rows.find((r) => r.name === 'Fish');
if (!fish || fish.amount !== 52 || fish.unit_price !== 5.2) {
  console.error('FAIL fish line', fish);
  process.exit(1);
}
if (total !== 172) {
  console.error('FAIL total', total);
  process.exit(1);
}
console.log('PASS expense line total mode — price field is line total, unit derived');

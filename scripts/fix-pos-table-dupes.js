const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'src', 'js', 'pages', 'pos.js');
let s = fs.readFileSync(p, 'utf8');

s = s.replace(
  /\},\r?\n    Utils\.showModal\('Held Orders'/,
  "},\r\n\r\n  async showHeldOrders() {\r\n    Utils.showModal('Held Orders'"
);

const dupRe = /\r?\n  async showTablePicker\(opts = \{\}\) \{\r?\n    const required = !!opts\.required;\r?\n    const onSelected = typeof opts\.onSelected === 'function' \? opts\.onSelected : null;\r?\n    const res = await API\.getTables\(\);/;
const m = s.match(dupRe);
if (!m) {
  console.error('dup table picker not found');
  process.exit(1);
}
const dupStart = m.index;
const afterDup = s.indexOf('\n  updateTableLabel() {', dupStart);
if (afterDup < 0) {
  console.error('updateTableLabel after dup not found');
  process.exit(1);
}
s = s.slice(0, dupStart) + s.slice(afterDup);

fs.writeFileSync(p, s);
console.log('fixed', {
  hasHeld: /async showHeldOrders\(\)/.test(s),
  tablePickers: (s.match(/async showTablePicker/g) || []).length,
  freePickers: (s.match(/async showFreeTablePicker/g) || []).length
});

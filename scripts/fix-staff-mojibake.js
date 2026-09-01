const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'src', 'js', 'pages', 'staff.js');
let s = fs.readFileSync(file, 'utf8');

// Show samples
for (const needle of ['Staff Portal', 'Employee Portal', 'Checklist', "Today's Assigned", 'Upload']) {
  const i = s.indexOf(needle);
  if (i >= 0) console.log(needle, '=>', JSON.stringify(s.slice(Math.max(0, i - 12), i + needle.length)));
}

// Replace any non-ascii run immediately before known English labels with ''
const labels = [
  'Staff Portal',
  'Employee Portal',
  'Recruitment',
  'Owner Salary',
  'Checklist Compliance Warnings',
  "Today's Assigned Tasks",
  'Upload',
  'Take Photo'
];
for (const label of labels) {
  const re = new RegExp(`[\\u0080-\\uFFFF\\u00A0-\\uFFFF]{1,12}\\s*(?=${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'g');
  s = s.replace(re, '');
}

// Avatar placeholders that are only mojibake emoji
s = s.replace(/>[\u0080-\uFFFF]{1,8}<\/div>/g, (m) => {
  if (/[A-Za-z0-9]/.test(m)) return m;
  return '></div>';
});
s = s.replace(/textContent = '[\u0080-\uFFFF]{1,8}'/g, "textContent = ''");
s = s.replace(/font-size:48px">[\u0080-\uFFFF]{1,8}</g, 'font-size:48px"><');

// Broken quotes introduced earlier
s = s.replace(/HR APIs " supports/g, 'HR APIs — supports');
s = s.replace(/<strong>Admin view<\/strong> " you are/g, '<strong>Admin view</strong> — you are');

fs.writeFileSync(file, s, 'utf8');
const left = (s.match(/ðŸ|â€|â†|Â·|âœ|âš|ï¸/g) || []).length;
console.log('remaining markers', left);
for (const needle of ['Staff Portal', 'Employee Portal', 'Checklist', "Today's Assigned"]) {
  const i = s.indexOf(needle);
  if (i >= 0) console.log('after', needle, '=>', JSON.stringify(s.slice(Math.max(0, i - 8), i + needle.length)));
}

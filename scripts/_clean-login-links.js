const fs = require('fs');
const path = require('path');
const os = require('os');
const src = path.join(os.tmpdir(), 'index-head.html');
let html = fs.readFileSync(src, 'utf8');
const ids = [
  'login-register-agent',
  'login-open-accounting',
  'login-open-hr',
  'login-open-staff',
  'welcome-staff',
  'welcome-hr',
  'welcome-accounting',
  'welcome-referral'
];
for (const id of ids) {
  const re = new RegExp(`\\s*<button[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/button>`, 'gi');
  html = html.replace(re, '');
}
fs.writeFileSync(path.join(__dirname, '..', 'src', 'index-login-clean.html'), html);
console.log('login-register-agent left?', /login-register-agent/.test(html));
console.log('login-open-hr left?', /login-open-hr/.test(html));

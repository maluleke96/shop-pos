/**
 * Capacitor Android: when building www for mobile, prefer Supabase if env is set.
 * Called from scripts that assemble mobile www — copies env from process into src/js/env.js style file.
 */
const fs = require('fs');
const path = require('path');

const url = process.env.SHOP_POS_SUPABASE_URL || process.env.SUPABASE_URL || '';
const anon = process.env.SHOP_POS_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const out = path.join(__dirname, '..', 'src', 'js', 'env.js');

const body = `/* Generated for Capacitor / local — do not commit secrets */
(function () {
  window.__SHOP_POS_ENV__ = {
    SUPABASE_URL: ${JSON.stringify(url)},
    SUPABASE_ANON_KEY: ${JSON.stringify(anon)},
    SHOP_POS_SUPABASE_URL: ${JSON.stringify(url)},
    SHOP_POS_SUPABASE_ANON_KEY: ${JSON.stringify(anon)}
  };
  window.__SHOP_POS_USE_SUPABASE__ = ${url && anon ? 'true' : 'false'};
})();
`;

fs.writeFileSync(out, body);
console.log('Android/web env written:', url ? 'Supabase configured' : 'Supabase NOT configured');

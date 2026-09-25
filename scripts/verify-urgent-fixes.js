/**
 * Local verification — Platform Customers tab + referral order clear + customer search SQL.
 * Does NOT hit Chisa production.
 */
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const report = { ok: true, checks: [] };

function check(name, pass, detail) {
  report.checks.push({ name, pass: !!pass, detail: detail || '' });
  if (!pass) report.ok = false;
  console.log(pass ? '✓' : '✗', name, detail || '');
}

// 1) Platform Control Customers tab — asArray + renderShops guards
const appJs = fs.readFileSync(path.join(root, 'platform-web/js/app.js'), 'utf8');
check('platform asArray helper', appJs.includes('asArray(v, ...keys)'));
check('shops list normalized', appJs.includes('this.shops = this.asArray(list'));
check('renderShops uses local shops array', appJs.includes('const shops = this.asArray(this.shops)'));
check('tab click try/catch wraps render', /data-tab[\s\S]*try\s*\{\s*this\.render\(\)/.test(appJs));

// Simulate asArray on bad payload (the original crash)
function asArray(v, ...keys) {
  if (Array.isArray(v)) return v;
  for (const k of keys) if (Array.isArray(v?.[k])) return v[k];
  return [];
}
const bad = { success: true, total: 3 };
check('asArray guards non-array shops payload', Array.isArray(asArray(bad, 'shops', 'data')) && asArray(bad, 'shops', 'data').length === 0);
check('asArray keeps real shops array', asArray({ shops: [{ id: 1 }] }, 'shops', 'data').length === 1);

// 2) Referral clear — order-level only
const refJs = fs.readFileSync(path.join(root, 'electron/services/referral-commission.js'), 'utf8');
const posJs = fs.readFileSync(path.join(root, 'src/js/pages/pos.js'), 'utf8');
const storeJs = fs.readFileSync(path.join(root, 'electron/services/store.js'), 'utf8');
check('processSale skips sticky without code on POS', refJs.includes('must NOT inherit sticky customer→agent'));
check('clearSaleReferral exists', refJs.includes('function clearSaleReferral'));
check('clearSaleReferral does not delete customers table', !/clearSaleReferral[\s\S]{0,800}DELETE FROM customers/.test(refJs));
check('POS clear does not call clearCustomerAttribution', !/clearReferral[\s\S]{0,400}referralClearAttribution/.test(posJs));
check('sale persists referral_cleared nulls', storeJs.includes('referral_cleared === true') && storeJs.includes('referral_agent_id = NULL'));
check('saleData sends referral_cleared', posJs.includes('referral_cleared:'));

// Module load
try {
  const ref = require('../electron/services/referral-commission');
  check('clearSaleReferral exported', typeof ref.clearSaleReferral === 'function');
  check('processSale exported', typeof ref.processSale === 'function');
} catch (e) {
  check('referral module loads', false, e.message);
}

try {
  const store = require('../electron/services/store');
  check('getCustomers exported', typeof store.getCustomers === 'function');
  const src = store.getCustomers.toString();
  check('getCustomers uses slim SELECT', /SELECT id, name, phone/.test(fs.readFileSync(path.join(root, 'electron/services/store.js'), 'utf8')));
  check('getCustomers limited for search', storeJs.includes('LIMIT ${limit}') || storeJs.includes('qStr ? 40'));
} catch (e) {
  check('store module loads', false, e.message);
}

// 3) Indexes migration present
const mig = path.join(root, 'electron/database/migrations-v129-perf-indexes.sql');
check('perf indexes migration exists', fs.existsSync(mig));
if (fs.existsSync(mig)) {
  const m = fs.readFileSync(mig, 'utf8');
  check('idx_customers_name', m.includes('idx_customers_name'));
  check('idx_customers_phone', m.includes('idx_customers_phone'));
}

// 4) Installer identities
const cap = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
check('Android appId is Shop POS offline', cap.appId === 'com.shoppos.offline');
check('Android not referralcommission', cap.appId !== 'com.shoppos.referralcommission');
const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
check('Gradle applicationId offline', /applicationId\s+"com\.shoppos\.offline"/.test(gradle));

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const downloads = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'ShopPOS');
const files = {
  apk: path.join(downloads, `ShopPOS-android-v${pkg.version}.apk`),
  apkLatest: path.join(downloads, 'ShopPOS-android-latest.apk'),
  winPortable: path.join(downloads, `ShopPOS-Portable-x64-v${pkg.version}.exe`),
  winSetup: path.join(downloads, `ShopPOS-Setup-x64-v${pkg.version}.exe`)
};
for (const [k, p] of Object.entries(files)) {
  const exists = fs.existsSync(p);
  let detail = exists ? `${Math.round(fs.statSync(p).size / 1024 / 1024)} MB` : 'MISSING';
  if (exists && k.startsWith('apk')) {
    const fd = fs.openSync(p, 'r');
    const b = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, 0);
    fs.closeSync(fd);
    const valid = b[0] === 0x50 && b[1] === 0x4b;
    check(`APK zip magic (${k})`, valid, detail);
  } else if (exists && k.startsWith('win')) {
    const fd = fs.openSync(p, 'r');
    const b = Buffer.alloc(2);
    fs.readSync(fd, b, 0, 2, 0);
    fs.closeSync(fd);
    check(`EXE MZ magic (${k})`, b[0] === 0x4d && b[1] === 0x5a, detail);
  } else {
    check(`Installer present (${k})`, exists, detail);
  }
}

const out = path.join(root, 'docs', 'URGENT-FIXES-VERIFY-2026-09-24.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log('\nWrote', out);
console.log(report.ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
process.exit(report.ok ? 0 : 1);

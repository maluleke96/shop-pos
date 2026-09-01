/**
 * Simulates: old local shop → "update" (new code) → must NOT require Register.
 * Also verifies build-mobile-www injects mobile-api and strips cloud boot scripts.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

async function testAdoptExistingBusiness() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shoppos-adopt-'));
  process.env.SHOP_POS_DATA = path.join(tmp, 'data');
  fs.mkdirSync(process.env.SHOP_POS_DATA, { recursive: true });

  // Fresh module load
  Object.keys(require.cache).forEach((k) => {
    if (k.includes('shop-pos') && (k.includes('database') || k.includes('services'))) {
      delete require.cache[k];
    }
  });

  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();
  const store = require('../electron/services/store');
  const db = dbMod.getDb();

  // Seed like an old shop with setup_complete accidentally 0
  db.prepare(`UPDATE shop_settings SET shop_name=?, setup_complete=0 WHERE id=1`).run('Happy Test Shop');
  db.prepare(`INSERT INTO users (username, password_hash, full_name, role, is_active)
    VALUES ('owner','hash','Owner','owner',1)`).run();
  db.prepare(`INSERT INTO products (name, selling_price, buying_price, stock_quantity, is_active)
    VALUES ('Bread', 12, 5, 20, 1)`).run();

  const before = store.detectExistingBusiness();
  if (!before.exists) throw new Error('detectExistingBusiness failed to see seeded shop');
  if (before.setup_complete) throw new Error('expected setup_complete=0 before adopt');

  const adopted = store.adoptExistingBusiness();
  if (!adopted.adopted && !adopted.setup_complete) {
    throw new Error('adoptExistingBusiness did not configure shop');
  }

  const settings = store.getSettingsParsed();
  if (!Number(settings.setup_complete)) {
    throw new Error('setup_complete still 0 after adopt — would show Register');
  }

  // completeSetup must refuse over existing shop
  let blocked = false;
  try {
    store.completeSetup({
      shop_name: 'New Evil Shop',
      owner_username: 'hacker',
      owner_password: 'password1',
      recovery_secret: 'secretphrase',
      recovery_secret_confirm: 'secretphrase'
    });
  } catch (err) {
    blocked = /already has a shop|Login/i.test(err.message);
  }
  if (!blocked) throw new Error('completeSetup should refuse when business exists');

  const afterName = store.getSettings().shop_name;
  if (afterName !== 'Happy Test Shop') {
    throw new Error('shop name changed unexpectedly: ' + afterName);
  }

  dbMod.closeDatabase();
  console.log('ADOPT/EXISTING BUSINESS TEST PASSED', {
    business_id: adopted.business_id || store.ensureBusinessId(),
    shop_name: afterName,
    counts: before.counts
  });
}

function testMobileWwwRewrite() {
  execSync('node scripts/build-mobile-www.js', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });
  const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
  if (!html.includes('mobile-api.bundle.js')) {
    throw new Error('www/index.html missing mobile-api.bundle.js');
  }
  if (html.includes('js/env.js') || html.includes('supabase-bootstrap.js')) {
    throw new Error('www/index.html still boots cloud env/supabase — would show Register on update');
  }
  if (html.includes('script defer src="js/app.js"') && !html.includes('mobile-api.bundle.js')) {
    throw new Error('defer scripts not rewritten');
  }
  // Core local boot order (script tags only — ignore <link rel=preload>)
  const scriptBlock = (html.match(/<script[\s\S]*<\/body>/i) || [''])[0];
  const apiIdx = scriptBlock.indexOf('mobile-api.bundle.js');
  const appIdx = scriptBlock.indexOf('src="js/app.js"');
  if (apiIdx < 0 || appIdx < 0 || apiIdx > appIdx) {
    throw new Error('mobile-api.bundle.js must load before app.js');
  }
  console.log('MOBILE WWW REWRITE TEST PASSED');
}

async function main() {
  await testAdoptExistingBusiness();
  testMobileWwwRewrite();
  console.log('\nALL ANDROID UPDATE SAFETY TESTS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

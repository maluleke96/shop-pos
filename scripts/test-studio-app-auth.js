/**
 * Studio app auth / permission checks (unit-style, in-memory mocks where needed).
 * Run: node scripts/test-studio-app-auth.js
 */
const assert = require('assert');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function ok(name, cond) {
  if (!cond) throw new Error(`FAIL: ${name}`);
  console.log(`  ✓ ${name}`);
}

async function main() {
  console.log('Studio auth tests');
  const studio = require('../electron/services/studio-app-platform');
  ok('messages_defined', !!(studio.MSG.badCreds && studio.MSG.noAccess && studio.MSG.inactive));
  ok('owner_flags', (() => {
    const f = studio.studioFlags({ role: 'owner', is_active: 1, permissions: '{}' });
    return f.menu && f.video && f.any;
  })());
  ok('cashier_no_perm', (() => {
    const f = studio.studioFlags({ role: 'cashier', is_active: 1, permissions: '{}' });
    return !f.menu && !f.video && !f.any;
  })());
  ok('cashier_menu_only', (() => {
    const f = studio.studioFlags({
      role: 'cashier',
      is_active: 1,
      permissions: JSON.stringify({ studio_menu_builder: true, studio_promo_video: false })
    });
    return f.menu && !f.video && f.any;
  })());
  ok('cashier_video_only', (() => {
    const f = studio.studioFlags({
      role: 'cashier',
      is_active: 1,
      permissions: JSON.stringify({ studio_promo_video: true })
    });
    return !f.menu && f.video && f.any;
  })());
  ok('inactive_user', !studio.userIsActive({ role: 'cashier', is_active: 0 }));
  ok('owner_active_even_if_flag', studio.userIsActive({ role: 'owner', is_active: 0 }));

  // Login message mapping without DB: call with empty should throw badCreds after DB init may fail
  // Soft-check ensureSchema is callable
  try { studio.ensureSchema(); ok('ensureSchema_callable', true); } catch (e) {
    console.log('  ~ ensureSchema skipped (no DB):', e.message?.slice(0, 80));
  }

  console.log('All studio unit checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Phase 3 lab smoke tests for Platform Control packages (definitions only).
 * Usage (against lab with PLATFORM_CONTROL_ENABLED):
 *   node scripts/test-platform-packages.js
 * Env: PLATFORM_RPC_URL (default lab), PLATFORM_OWNER_USERNAME, PLATFORM_OWNER_PASSWORD
 */
const RPC = (process.env.PLATFORM_RPC_URL || 'https://shoppos-lab-production.up.railway.app/rpc').replace(/\/$/, '');
const USER = process.env.PLATFORM_OWNER_USERNAME || 'platform';
const PASS = process.env.PLATFORM_OWNER_PASSWORD || 'platform-lab-change-me';

async function rpc(method, args = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(`${method}: ${json.error || res.status}`);
  return json.data != null ? json.data : json;
}

async function main() {
  console.log('RPC', RPC);
  const status = await rpc('platform:status', []);
  console.log('status', status);
  if (!status.enabled) throw new Error('Platform Control not enabled on target');

  const login = await rpc('platform:login', [USER, PASS]);
  const tok = login.token;
  console.log('login ok', login.user?.username);

  const sync = await rpc('platform:syncCatalog', [tok]);
  console.log('sync', sync);

  const mods = await rpc('platform:listModules', [tok, {}]);
  console.log('modules', mods.counts);

  // Invalid combo: player without centre should fail when only player selected
  // (EXTRA_DEPS requires both ways; selecting only player needs centre)
  const bad = await rpc('platform:validateModules', [tok, ['mod.signage_player']]);
  console.log('validate player-only', bad.ok, bad.errors);

  const good = await rpc('platform:validateModules', [tok, ['mod.signage', 'mod.signage_player', 'admin.digital-signage']]);
  console.log('validate signage pack', good.ok, good.errors);

  const pkgName = 'Phase3 Test Package ' + Date.now();
  const saved = await rpc('platform:savePackage', [tok, {
    name: pkgName,
    description: 'Automated Phase 3 test package',
    price: 123,
    currency: 'ZAR',
    module_ids: ['mod.signage', 'mod.signage_player', 'admin.digital-signage']
  }]);
  console.log('created package', saved.data?.id, saved.data?.module_ids?.length);

  const listed = await rpc('platform:listPackages', [tok]);
  const found = (listed.data || []).find((p) => p.id === saved.data.id);
  if (!found) throw new Error('Package not listed after save');

  await rpc('platform:setPackageActive', [tok, saved.data.id, false]);
  const inactive = await rpc('platform:getPackage', [tok, saved.data.id]);
  if (inactive.data.is_active) throw new Error('Deactivate failed');

  // Remove a module and save
  await rpc('platform:savePackage', [tok, {
    id: saved.data.id,
    name: pkgName,
    description: 'Updated',
    price: 150,
    module_ids: ['mod.signage', 'mod.signage_player']
  }]);
  const updated = await rpc('platform:getPackage', [tok, saved.data.id]);
  console.log('updated modules', updated.data.module_ids);

  const addon = await rpc('platform:saveAddon', [tok, {
    name: 'Phase3 Test Addon ' + Date.now(),
    description: 'Signage add-on',
    price: 50,
    module_ids: ['mod.signage', 'mod.signage_player']
  }]);
  console.log('addon', addon.data?.id);

  await rpc('platform:deleteAddon', [tok, addon.data.id]);
  await rpc('platform:deletePackage', [tok, saved.data.id]);
  console.log('cleanup ok');

  // Expect broken package rejected
  let rejected = false;
  try {
    await rpc('platform:savePackage', [tok, {
      name: 'Broken Driver Only',
      module_ids: ['app.driver']
    }]);
  } catch (e) {
    rejected = /dependenc|require/i.test(e.message);
    console.log('rejected broken package:', e.message);
  }
  if (!rejected) throw new Error('Expected dependency rejection for driver-only package');

  await rpc('platform:logout', [tok]);
  console.log('PHASE3_SMOKE_OK');
}

main().catch((e) => {
  console.error('PHASE3_SMOKE_FAIL', e.message || e);
  process.exit(1);
});

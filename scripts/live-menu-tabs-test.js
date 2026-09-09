/** Live test: online menu + highlight tabs after menu-highlights fix */
const BASE = process.env.LIVE_URL || 'https://chisafood.up.railway.app';

async function rpc(method, args, token) {
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Session-Token': token } : {})
    },
    body: JSON.stringify({ method, args })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `${method} HTTP ${res.status}`);
  }
  return json.data != null ? json.data : json;
}

async function main() {
  const branches = await rpc('web:getBranches', []);
  const branchId = branches?.[0]?.id || 1;
  console.log('Branch:', branchId, branches?.[0]?.name);

  const menu = await rpc('web:getMenu', [branchId, {}]);
  console.log('Menu tabs:', (menu.menu_tabs || []).map((t) => `${t.name}(${t.count ?? 0})`).join(', '));
  console.log('Products:', (menu.products || []).length);

  for (const tab of (menu.menu_tabs || []).slice(0, 4)) {
    const filtered = await rpc('web:getMenu', [branchId, { category_id: tab.id }]);
    console.log(`Tab ${tab.id}: ${(filtered.products || []).length} products`);
  }

  const tabs = ['__available_today', '__new_arrival', '__best_seller', '__today_special'];
  for (const id of tabs) {
    try {
      const r = await rpc('web:getMenu', [branchId, { category_id: id }]);
      console.log(`OK ${id}: ${(r.products || []).length} items`);
    } catch (e) {
      console.error(`FAIL ${id}:`, e.message);
      process.exitCode = 1;
    }
  }
  console.log('All menu tab tests passed.');
}

main().catch((e) => {
  console.error('Menu test failed:', e.message);
  process.exit(1);
});

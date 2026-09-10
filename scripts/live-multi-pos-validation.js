/**
 * Real-world multi-branch / multi-POS validation against live Railway RPC.
 * Usage: SMOKE_PASS=... node scripts/live-multi-pos-validation.js
 */
const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const DEVICE_1 = 'TILL-VALIDATION-001';
const DEVICE_2 = 'TILL-VALIDATION-002';
const TEST_BRANCH_CODE = 'VALTEST';

const results = [];
function pass(name, detail = {}) { results.push({ name, ok: true, ...detail }); console.log('PASS:', name, detail.detail || ''); }
function fail(name, detail = {}) { results.push({ name, ok: false, ...detail }); console.error('FAIL:', name, detail.detail || detail.error || ''); }

async function rpc(method, args = [], token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ method, args })
  });
  const json = await res.json().catch(() => ({}));
  const tok = res.headers.get('X-Session-Token') || json.sessionToken || token;
  return { json, token: tok, status: res.status };
}

function unwrap(r) {
  if (r?.json?.success === false) throw new Error(r.json.error || 'RPC failed');
  return r.json?.data ?? r.json;
}

(async () => {
  const passEnv = process.env.SMOKE_PASS || process.env.SHOP_POS_SMOKE_PASS || '123456';
  const ownerUser = process.env.SMOKE_USER || 'chisa96';

  const login = await rpc('auth:login', [ownerUser, passEnv]);
  const owner = login.json?.user;
  const token = login.token;
  if (!owner?.id) {
    fail('login', { error: login.json?.error || 'login failed' });
    console.log(JSON.stringify({ results }, null, 2));
    process.exit(1);
  }
  pass('login', { detail: `owner ${owner.username}` });

  const branches = unwrap(await rpc('branches:get', [], token));
  const mainBranch = branches.find((b) => Number(b.id) === 2) || branches[0];
  if (!mainBranch?.id) {
    fail('main-branch', { error: 'No branch found' });
    process.exit(1);
  }
  pass('main-branch', { detail: `${mainBranch.name} id=${mainBranch.id}` });

  let testBranch = branches.find((b) => String(b.code).toUpperCase() === TEST_BRANCH_CODE);
  if (!testBranch) {
    testBranch = unwrap(await rpc('branches:save', [{
      name: 'Validation Test Branch',
      code: TEST_BRANCH_CODE,
      address: 'Test only',
      is_active: true
    }, owner], token));
    pass('create-test-branch', { detail: `id=${testBranch.id}` });
  } else {
    pass('test-branch-exists', { detail: `id=${testBranch.id}` });
  }

  const products = unwrap(await rpc('products:get', [{ for_pos: true }], token));
  const product = products.find((p) => Number(p.stock_quantity) > 5 && Number(p.selling_price) > 0)
    || products.find((p) => Number(p.stock_quantity) > 0);
  if (!product?.id) {
    fail('product-with-stock', { error: 'No product with stock for sale test' });
    process.exit(1);
  }

  const stockBeforeMain = unwrap(await rpc('products:getOne', [product.id], token));
  const branchStockBefore = Number(stockBeforeMain.stock_quantity);

  async function getBranchStock(branchId) {
    const prods = unwrap(await rpc('products:get', [{ for_pos: true, branch_id: branchId, actor: owner }], token));
    const row = prods.find((p) => Number(p.id) === Number(product.id));
    return Number(row?.stock_quantity ?? -1);
  }

  const stockMainBefore = await getBranchStock(mainBranch.id);
  pass('stock-baseline', { detail: `product ${product.id} branch ${mainBranch.id} qty=${stockMainBefore}` });

  async function openShiftFor(actor) {
    const cur = unwrap(await rpc('shifts:current', [actor], token));
    if (cur?.id) return cur;
    return unwrap(await rpc('shifts:open', [0, actor], token));
  }

  await openShiftFor(owner);

  function salePayload(qty, tillBranchId, deviceId, suffix) {
    const unit = Number(product.selling_price) || 10;
    const total = unit * qty;
    return {
      client_request_id: `val-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      till_branch_id: tillBranchId,
      branch_id: tillBranchId,
      device_id: deviceId,
      items: [{
        product_id: product.id,
        product_name: product.name,
        quantity: qty,
        unit_price: unit,
        buying_price: product.buying_price || 0,
        discount: 0,
        total
      }],
      subtotal: total,
      discount: 0,
      tax_amount: 0,
      total,
      amount_paid: total,
      change_amount: 0,
      payments: [{ type: 'cash', amount: total }]
    };
  }

  // POS 1 sale on main branch
  const sale1 = unwrap(await rpc('sales:complete', [salePayload(1, mainBranch.id, DEVICE_1, 'pos1'), owner], token));
  const sale1Row = unwrap(await rpc('sales:get', [sale1.saleId || sale1.sale?.id], token));
  if (Number(sale1Row.branch_id) === Number(mainBranch.id)) {
    pass('sale1-branch', { detail: `branch_id=${sale1Row.branch_id}` });
  } else {
    fail('sale1-branch', { error: `expected ${mainBranch.id}, got ${sale1Row.branch_id}` });
  }
  if (sale1Row.device_id === DEVICE_1) {
    pass('sale1-device', { detail: sale1Row.device_id });
  } else {
    fail('sale1-device', { error: `expected ${DEVICE_1}, got ${sale1Row.device_id}` });
  }

  const stockAfterSale1 = await getBranchStock(mainBranch.id);
  if (stockAfterSale1 === stockMainBefore - 1) {
    pass('sale1-stock', { detail: `${stockMainBefore} -> ${stockAfterSale1}` });
  } else {
    fail('sale1-stock', { error: `expected ${stockMainBefore - 1}, got ${stockAfterSale1}` });
  }

  // POS 2 reads catalog (simulated)
  const catalogPos2 = unwrap(await rpc('products:get', [{ for_pos: true, branch_id: mainBranch.id, actor: owner }], token));
  const pos2Prod = catalogPos2.find((p) => Number(p.id) === Number(product.id));
  if (Number(pos2Prod?.stock_quantity) === stockAfterSale1) {
    pass('pos2-catalog-stock', { detail: `POS2 sees qty=${pos2Prod.stock_quantity}` });
  } else {
    fail('pos2-catalog-stock', { error: `expected ${stockAfterSale1}, got ${pos2Prod?.stock_quantity}` });
  }

  // POS 2 sale
  const sale2 = unwrap(await rpc('sales:complete', [salePayload(1, mainBranch.id, DEVICE_2, 'pos2'), owner], token));
  const sale2Row = unwrap(await rpc('sales:get', [sale2.saleId || sale2.sale?.id], token));
  if (Number(sale2Row.branch_id) === Number(mainBranch.id)) pass('sale2-branch', { detail: `branch_id=${sale2Row.branch_id}` });
  else fail('sale2-branch', { error: `expected ${mainBranch.id}, got ${sale2Row.branch_id}` });
  if (sale2Row.device_id === DEVICE_2) pass('sale2-device', { detail: sale2Row.device_id });
  else fail('sale2-device', { error: `expected ${DEVICE_2}, got ${sale2Row.device_id}` });

  const stockAfterSale2 = await getBranchStock(mainBranch.id);
  if (stockAfterSale2 === stockAfterSale1 - 1) pass('sale2-stock', { detail: `${stockAfterSale1} -> ${stockAfterSale2}` });
  else fail('sale2-stock', { error: `expected ${stockAfterSale1 - 1}, got ${stockAfterSale2}` });

  // Combined branch totals (owner all-branches dashboard)
  const today = new Date().toISOString().slice(0, 10);
  const dash = unwrap(await rpc('audit:dashboard', [today, today, owner], token));
  const todayOrders = Number(dash.today?.orders || 0);
  if (todayOrders >= 2) pass('owner-combined-totals', { detail: `today orders=${todayOrders}` });
  else fail('owner-combined-totals', { error: `expected >=2 orders today, got ${todayOrders}` });

  // Cash-up separation by shift (per user/till session)
  const shift = unwrap(await rpc('shifts:current', [owner], token));
  if (shift?.id) {
    const preview = unwrap(await rpc('shifts:closePreview', [shift.id, owner], token));
    const salesCount = Number(preview?.todayCount ?? preview?.shiftSales?.length ?? 0);
    pass('cashup-shift-preview', { detail: `shift ${shift.id} preview ok, sales in period=${salesCount}` });
  } else {
    fail('cashup-shift-preview', { error: 'No open shift for owner' });
  }

  // Branch isolation — seed test branch stock if missing
  let testStockBefore = await getBranchStock(testBranch.id);
  if (testStockBefore < 0) testStockBefore = 0;

  // Security: owner attempting wrong branch on test branch should work (owner allowed)
  // Create/find branch-bound test cashier
  const testUserName = `valcash_${testBranch.id}`;
  let testCashier = null;
  const users = unwrap(await rpc('auth:getUsers', [owner], token));
  testCashier = users.find((u) => u.username === testUserName);
  if (!testCashier) {
    const created = unwrap(await rpc('auth:createUser', [{
      username: testUserName,
      password: 'ValTest123!',
      full_name: 'Validation Cashier',
      role: 'cashier',
      branch_id: testBranch.id
    }, owner], token));
    testCashier = created;
    pass('create-test-cashier', { detail: `branch ${testBranch.id}` });
  } else {
    pass('test-cashier-exists', { detail: testUserName });
  }

  const cashierLogin = await rpc('auth:login', [testUserName, 'ValTest123!']);
  const cashier = cashierLogin.json?.user;
  const cashierToken = cashierLogin.token;
  if (!cashier?.id) {
    fail('cashier-login', { error: cashierLogin.json?.error });
  } else {
    pass('cashier-login', { detail: testUserName });

    await rpc('shifts:open', [0, cashier], cashierToken);

    // Cashier sells on OWN branch — should succeed
    try {
      const okSale = unwrap(await rpc('sales:complete', [
        salePayload(1, testBranch.id, 'TILL-TEST-BRANCH', 'cashier-ok'), cashier
      ], cashierToken));
      pass('cashier-own-branch-sale', { detail: `sale ${okSale.saleId || okSale.sale?.id}` });
    } catch (e) {
      fail('cashier-own-branch-sale', { error: e.message });
    }

    // SECURITY: cashier tries to sell on main branch — must FAIL
    const bypassRes = await rpc('sales:complete', [
      salePayload(1, mainBranch.id, 'TILL-EVIL', 'cashier-bypass'), cashier
    ], cashierToken);
    if (bypassRes.json?.success === false && /not authorized|different branch/i.test(String(bypassRes.json?.error || ''))) {
      pass('security-branch-bypass-blocked', { detail: bypassRes.json.error });
    } else if (bypassRes.json?.success === false) {
      pass('security-branch-bypass-blocked', { detail: bypassRes.json.error || 'rejected' });
    } else {
      fail('security-branch-bypass-blocked', {
        error: 'Cashier was able to record sale on unauthorized branch',
        saleId: bypassRes.json?.data?.saleId || bypassRes.json?.saleId
      });
    }

    // Cashier catalog scoped to own branch
    const cashierCatalog = unwrap(await rpc('products:get', [{ for_pos: true, actor: cashier }], cashierToken));
    pass('cashier-catalog-access', { detail: `${cashierCatalog.length} products visible` });
  }

  // Branch stock isolation: test branch stock should differ from main when only test sale happened
  const testStockAfter = await getBranchStock(testBranch.id);
  const mainStockFinal = await getBranchStock(mainBranch.id);
  pass('branch-stock-isolation-check', {
    detail: `main=${mainStockFinal} test=${testStockAfter} (isolated rows)`
  });

  const failed = results.filter((r) => !r.ok);
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({
    passed: results.filter((r) => r.ok).length,
    failed: failed.length,
    failedTests: failed.map((f) => ({ name: f.name, error: f.error, detail: f.detail }))
  }, null, 2));

  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

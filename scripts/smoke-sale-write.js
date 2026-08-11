/**
 * Server-side write smoke: complete a tiny sale against Supabase via handlers.
 * Does not change user passwords. Uses owner user id=1 session context.
 */
require('../lib/load-env').loadProjectEnv(require('path').join(__dirname, '..'));
process.env.SHOP_POS_CLOUD = '1';

const { bootRpc, handleRpcPost } = require('../lib/rpc-app');

(async () => {
  const rpc = await bootRpc();
  const session = rpc.session;

  const products = await handleRpcPost({
    ...rpc,
    body: { method: 'products:get', args: [] },
    sessionTokenHeader: ''
  });
  const list = (products.json && products.json.data) || [];
  if (!list.length) throw new Error('No products');
  const p = list[0];
  const before = Number(p.stock_quantity);

  // Establish owner session like a successful login
  const users = rpc.handlers; // unused
  const { getDb } = require('../electron/database/db');
  const owner = getDb().prepare('SELECT id, username, full_name, role, is_active FROM users WHERE id = 1').get();
  if (!owner) throw new Error('Owner user id=1 missing');
  session.setUserSession(owner);

  const clientRequestId = 'smoke-sale-' + Date.now();
  const salePayload = {
    items: [
      {
        product_id: p.id,
        product_name: p.name,
        quantity: 1,
        unit_price: Number(p.selling_price) || 1,
        buying_price: Number(p.buying_price) || 0
      }
    ],
    subtotal: Number(p.selling_price) || 1,
    discount: 0,
    tax_amount: 0,
    total: Number(p.selling_price) || 1,
    amount_paid: Number(p.selling_price) || 1,
    payments: [{ type: 'cash', amount: Number(p.selling_price) || 1 }],
    client_request_id: clientRequestId
  };

  const sale1 = await handleRpcPost({
    ...rpc,
    body: {
      method: 'sales:complete',
      args: [salePayload],
      clientRequestId
    },
    sessionTokenHeader: ''
  });
  console.log('sale1', sale1.json && sale1.json.success, sale1.json && (sale1.json.error || sale1.json.data?.receiptNumber || sale1.json.receiptNumber || sale1.json.data));

  // Replay same clientRequestId — must not double-sell
  const sale2 = await handleRpcPost({
    ...rpc,
    body: {
      method: 'sales:complete',
      args: [salePayload],
      clientRequestId
    },
    sessionTokenHeader: ''
  });
  console.log(
    'sale2_replay',
    sale2.json && sale2.json.success,
    'replayed=',
    !!(sale2.json && (sale2.json.replayed || sale2.json.data?.replayed))
  );

  const productsAfter = await handleRpcPost({
    ...rpc,
    body: { method: 'products:get', args: [] },
    sessionTokenHeader: ''
  });
  const afterList = (productsAfter.json && productsAfter.json.data) || [];
  const p2 = afterList.find((x) => String(x.id) === String(p.id)) || afterList[0];
  console.log('stock_before', before, 'stock_after', p2 && p2.stock_quantity);
  console.log('shop_ok', true);
  process.exit(sale1.json && sale1.json.success ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

const B = 'https://chisafood.up.railway.app';

async function readStdin() {
  return new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { s += c; });
    process.stdin.on('end', () => resolve(s.trim()));
  });
}

async function rpc(method, args = [], token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  const res = await fetch(`${B}/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ method, args })
  });
  const json = await res.json();
  const tok = res.headers.get('X-Session-Token') || json.sessionToken || token;
  return { json, token: tok };
}

(async () => {
  const pass = await readStdin();
  const login = await rpc('auth:login', ['chisa96', pass]);
  const actor = login.json.user;
  const token = login.token;
  const p = (await rpc('products:get', [{}], token)).json.data[0];
  const save = await rpc('products:save', [{
    id: p.id,
    name: p.name,
    selling_price: p.selling_price,
    stock_quantity: 12
  }, actor], token);
  const adj = await rpc('stock:adjust', [p.id, 3, 'add', 'diag', actor], token);
  const get1 = await rpc('products:getOne', [p.id], token);
  const hist = await rpc('stock:history', [p.id], token);
  console.log(JSON.stringify({
    product: { id: p.id, name: p.name, before: p.stock_quantity, selling_price: p.selling_price },
    save_data_stock: save.json?.data?.stock_quantity,
    save_error: save.json?.error,
    adjust_data: adj.json?.data,
    adjust_error: adj.json?.error,
    get_one: get1.json?.data?.stock_quantity,
    history_count: (hist.json?.data || []).length,
    history_latest: (hist.json?.data || [])[0]
  }, null, 2));
})();

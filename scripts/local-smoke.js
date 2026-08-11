const http = require('http');

function post(path, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 3000,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...(token ? { 'X-Session-Token': token } : {})
        }
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(buf);
          } catch {
            json = { raw: buf };
          }
          resolve({
            status: res.statusCode,
            token: res.headers['x-session-token'] || (json && json.sessionToken) || token,
            json
          });
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: '127.0.0.1', port: 3000, path }, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, body: buf.slice(0, 200) }));
      })
      .on('error', reject);
  });
}

(async () => {
  const health = await get('/health');
  console.log('health', health.status, health.body);
  const index = await get('/');
  console.log('index', index.status, index.body.includes('Shop POS') || index.body.includes('<!DOCTYPE'));

  const user = process.env.SMOKE_USER || 'chisa96';
  const pass = process.env.SMOKE_PASS || process.env.SHOP_POS_DB_PASSWORD || '';
  if (!pass) {
    console.log('No SMOKE_PASS — skip login');
    process.exit(0);
  }

  require('../lib/load-env').loadProjectEnv(require('path').join(__dirname, '..'));
  const password = process.env.SMOKE_PASS || process.env.SHOP_POS_DB_PASSWORD;

  const login = await post('/rpc', { method: 'auth:login', args: [user, password] });
  console.log('login', login.status, login.json && login.json.success, login.json && (login.json.error || login.json.data?.username || login.json.data?.user?.username));
  if (!login.json || !login.json.success) {
    // try without assuming DB password is POS password
    console.log('Login with DB password failed (expected if different). Set SMOKE_PASS to POS password.');
    process.exit(0);
  }
  const token = login.token;
  const settings = await post('/rpc', { method: 'settings:getParsed', args: [] }, token);
  console.log('settings', settings.json && settings.json.success, settings.json && settings.json.data && settings.json.data.shop_name);
  const products = await post('/rpc', { method: 'products:get', args: [] }, token);
  const plist = (products.json && products.json.data) || [];
  console.log('products', products.json && products.json.success, Array.isArray(plist) ? plist.length : typeof plist);

  // Tiny stock read
  const stock = await post('/rpc', { method: 'products:get', args: [] }, token);
  const first = ((stock.json && stock.json.data) || [])[0];
  if (first) {
    console.log('first_product', first.name, 'stock', first.stock_quantity, 'price', first.selling_price);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

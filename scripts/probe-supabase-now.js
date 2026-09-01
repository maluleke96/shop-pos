const { loadProjectEnv } = require('../lib/load-env');
loadProjectEnv();
const { Client } = require('pg');

function redact(u) {
  return String(u || '').replace(/:([^:@/]+)@/, ':***@');
}

(async () => {
  const url = process.env.SHOP_POS_DATABASE_URL || process.env.DATABASE_URL || '';
  console.log('URL', redact(url));
  console.log('SUPABASE', process.env.SHOP_POS_SUPABASE_URL || process.env.SUPABASE_URL || '');

  const base = process.env.SHOP_POS_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.SHOP_POS_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  if (base) {
    try {
      const r = await fetch(base + '/rest/v1/', {
        headers: { apikey: key, Authorization: 'Bearer ' + key }
      });
      console.log('API', r.status, (await r.text()).slice(0, 120));
    } catch (e) {
      console.log('API FAIL', e.cause?.code || e.code || '', e.message);
    }
  }

  if (!url) {
    console.log('NO DATABASE URL');
    return;
  }

  const c = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });
  try {
    await c.connect();
    const r = await c.query(
      "select current_user as u, current_database() as db, (select shop_name from shop_settings where id=1) as shop"
    );
    console.log('DB OK', r.rows[0]);
    await c.end();
  } catch (e) {
    console.log('DB FAIL', e.code || '', String(e.message).slice(0, 220));
  }
})();

const path = require('path');
const os = require('os');
const bcrypt = require('bcryptjs');

process.env.SHOP_POS_LOCAL_INSTALLER = '1';
process.env.SHOP_POS_DATA = path.join(os.tmpdir(), 'mktp3-' + Date.now());

(async () => {
  const db = require('../electron/database/db');
  await db.initDatabase();
  const m = require('../electron/services/marketing-platform');
  const raw = db.getDb();
  raw.prepare(
    'INSERT INTO users (username,password_hash,full_name,role,is_active) VALUES (?,?,?,?,1)'
  ).run('owner', bcrypt.hashSync('x', 8), 'Owner', 'owner');
  const a = raw.prepare("SELECT * FROM users WHERE role='owner' LIMIT 1").get();
  require('../electron/services/session').setUserSession(a);
  m.bootstrap();
  const biz = m.listBusinesses()[0];
  const r = raw.prepare(`
    INSERT INTO mkt_campaigns_v2 (uid, business_id, name, status, created_by)
    VALUES (?,?,?,?,?)`).run('uid1', biz.id, 'Direct Insert', 'draft', a.id);
  console.log('direct insert', r);
  console.log('select', raw.prepare('SELECT * FROM mkt_campaigns_v2').all());
  console.log('getCampaignV2', m.getCampaignV2(r.lastInsertRowid));
  try {
    const camp = m.saveCampaignV2({ name: 'Via Save', business_id: biz.id, status: 'draft' }, a);
    console.log('via save', camp);
  } catch (e) {
    console.error('via save error', e);
  }
  db.closeDatabase();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

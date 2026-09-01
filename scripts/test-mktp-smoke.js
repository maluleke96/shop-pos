const path = require('path');
const os = require('os');
const bcrypt = require('bcryptjs');

process.env.SHOP_POS_LOCAL_INSTALLER = '1';
process.env.SHOP_POS_DATA = path.join(os.tmpdir(), 'mktp-' + Date.now());

(async () => {
  const db = require('../electron/database/db');
  await db.initDatabase();
  const m = require('../electron/services/marketing-platform');
  const raw = db.getDb();
  try {
    raw.prepare(
      'INSERT INTO users (username,password_hash,full_name,role,is_active) VALUES (?,?,?,?,1)'
    ).run('owner', bcrypt.hashSync('x', 8), 'Owner', 'owner');
  } catch (e) {
    console.log('user seed note:', e.message);
  }
  const a = raw.prepare("SELECT * FROM users WHERE role='owner' LIMIT 1").get();
  require('../electron/services/session').setUserSession(a);
  m.ensurePlatformReady();
  const biz = m.listBusinesses({}, a);
  console.log('businesses', biz.length, biz[0] && biz[0].name);
  const dash = m.getCommandCentreDashboard({}, a);
  console.log('dashboard ok', !!dash.totals || !!dash.kpis || Object.keys(dash).length);
  const camp = m.saveCampaignV2({
    name: 'Weekend Braai Special',
    business_id: biz[0].id,
    status: 'draft',
    description: 'Test campaign'
  }, a);
  console.log('campaign', camp.id || camp?.campaign?.id, camp.name || camp?.campaign?.name);
  const campId = camp.id || camp?.campaign?.id;
  m.generateCampaignAssets(campId, a);
  console.log('assets ok');
  const app = m.applyAsReferralAgent({
    full_name: 'Happy Agent',
    phone: '0820000001',
    agreement_accepted: true,
    business_id: biz[0].id
  });
  const appId = app.id || app?.agent?.id;
  console.log('application', appId, app.status || app?.agent?.status);
  const approved = m.approveReferralAgent(appId, {}, a);
  console.log('approved', approved.agent_code || approved?.agent?.agent_code, approved.referral_code || approved?.agent?.referral_code);
  const promo = m.savePromotion({ name: '10% Off', promo_type: 'percent', discount_value: 10, business_id: biz[0].id, status: 'active' }, a);
  console.log('promo', promo.id || promo?.promotion?.id);
  console.log('ALL SMOKE TESTS PASSED');
  db.closeDatabase();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

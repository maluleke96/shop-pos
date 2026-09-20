/* Smoke test Communication Center — run: node scripts/smoke-communication-center.js */
const path = require('path');
const fs = require('fs');
const os = require('os');

async function main() {
  process.chdir(path.join(__dirname, '..'));
  const tmpDir = path.join(os.tmpdir(), `cc-smoke-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  process.env.SHOP_POS_DATA = tmpDir;
  delete process.env.SHOP_POS_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.SHOP_POS_CLOUD;

  const { initDatabase, closeDatabase } = require('../electron/database/db');
  await initDatabase();
  const cc = require('../electron/services/communication-center');
  cc.ensureSchema();

  const dash = cc.dashboard();
  if (!dash?.totals) throw new Error('dashboard missing totals');
  console.log('OK dashboard connections', (dash.connections || []).length);

  const events = cc.listEventTypes();
  if (events.length < 10) throw new Error('expected seeded event types');
  console.log('OK event types', events.length);

  const templates = cc.listTemplates();
  if (templates.length < 3) throw new Error('expected seeded templates');
  console.log('OK templates', templates.length);

  const emitted = cc.emit('manual.message', {
    customer_name: 'Test',
    customer_phone: '0820000000'
  }, {
    channels: ['inapp'],
    recipients: ['owner'],
    body: 'CC smoke test',
    transactional: true,
    source_module: 'smoke'
  });
  if (!emitted.queued) throw new Error('emit did not queue');
  console.log('OK emit queued', emitted.queued);

  await cc.processQueue(10);
  const hist = cc.listHistory({ limit: 5 });
  if (!hist.length) throw new Error('history empty after process');
  console.log('OK queue processed', hist[0].status, hist[0].channel);

  const auto = cc.saveAutomation({
    name: 'Smoke automation',
    event_key: 'order.new',
    actions: [{ channels: ['inapp'], recipients: ['owner'], body: 'Auto' }],
    enabled: true
  }, { id: 1, username: 'smoke' });
  cc.setAutomationEnabled(auto.id, false, { id: 1 });
  const a2 = cc.listAutomations().find((x) => x.id === auto.id);
  if (Number(a2.enabled) !== 0) throw new Error('automation disable failed');
  console.log('OK automation toggle');

  const tpl = cc.saveTemplate({
    name: 'Smoke Tpl',
    slug: `cc_smoke_${Date.now()}`,
    body: 'Hi {{customer_name}}'
  }, { id: 1 });
  if (!tpl?.id) throw new Error('template save failed');
  console.log('OK template');

  const sett = cc.saveSettings({
    recovery: { channels: ['whatsapp', 'sms', 'email'], expiry_minutes: 10 },
    bridge_inapp: true
  }, { id: 1 });
  if (!sett.recovery?.channels?.includes('sms')) throw new Error('settings save failed');
  console.log('OK settings');

  const draft = cc.sharePublish({
    title: 'Smoke Promo',
    body: 'Buy chips',
    channels: ['whatsapp'],
    audience: { type: 'manual', phone: '0821111111', name: 'A' },
    mode: 'draft'
  }, { id: 1, username: 'smoke' });
  if (draft.status !== 'draft') throw new Error('share draft failed');
  console.log('OK share draft', draft.campaign_id);

  const ui = fs.readFileSync(path.join(__dirname, '../src/js/pages/admin-communication-center.js'), 'utf8');
  const tabs = [
    'dashboard', 'notifications', 'whatsapp', 'sms', 'email', 'social', 'customers',
    'campaigns', 'automation', 'templates', 'scheduled', 'media', 'history', 'failed',
    'connections', 'settings'
  ];
  for (const t of tabs) {
    if (!ui.includes(`'${t}'`)) throw new Error(`UI missing tab ${t}`);
  }
  if (!ui.includes('CCSharePublish')) throw new Error('CCSharePublish missing');
  console.log('OK UI tabs', tabs.length);

  const handlers = fs.readFileSync(path.join(__dirname, '../mobile/handlers.js'), 'utf8');
  if (!handlers.includes("add('cc:dashboard'")) throw new Error('handlers missing cc:dashboard');
  console.log('OK handlers');

  const admin = fs.readFileSync(path.join(__dirname, '../src/js/pages/admin.js'), 'utf8');
  if (!admin.includes("id: 'communication-center'")) throw new Error('sidebar missing');
  console.log('OK sidebar');

  const builders = [
    ['menu-builder', 'mb-cc-share'],
    ['promo-video', 'pvb-cc-share'],
    ['promo-poster', 'pp-cc-share']
  ];
  for (const [label, marker] of builders) {
    const files = {
      'menu-builder': 'src/js/pages/admin-menu-builder.js',
      'promo-video': 'src/js/pages/admin-promo-video-builder.js',
      'promo-poster': 'src/js/promo-poster.js'
    };
    const txt = fs.readFileSync(files[label], 'utf8');
    if (!txt.includes(marker)) throw new Error(`${label} missing ${marker}`);
  }
  console.log('OK builder share buttons');

  console.log('SMOKE_OK');
  try { closeDatabase(); } catch (_) { /* */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* */ }
  process.exit(0);
}

main().catch((err) => {
  console.error('SMOKE_FAIL', err);
  process.exit(1);
});

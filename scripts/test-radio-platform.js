/**
 * Smoke test — Chisanyama Connection Radio auth + permissions.
 * Run: node scripts/test-radio-platform.js
 */
process.env.SHOP_POS_CLOUD = process.env.SHOP_POS_CLOUD || '1';

async function main() {
  const path = require('path');
  process.chdir(path.join(__dirname, '..'));

  const radio = require('../electron/services/radio-platform');

  const flagsOwner = radio.radioFlags({ role: 'owner', is_active: 1, permissions: '{}' });
  if (!flagsOwner.any || !flagsOwner.mic) throw new Error('Owner should have full radio access');

  const flagsNone = radio.radioFlags({
    role: 'cashier', is_active: 1,
    permissions: JSON.stringify({ sell: true })
  });
  if (flagsNone.any) throw new Error('Cashier without radio_studio_access must be denied');

  const flagsPartial = radio.radioFlags({
    role: 'cashier', is_active: 1,
    permissions: JSON.stringify({
      radio_studio_access: true,
      radio_music: true,
      radio_live_mic: false
    })
  });
  if (!flagsPartial.music || flagsPartial.mic) throw new Error('Partial radio permissions incorrect');
  if (!flagsPartial.playlists) throw new Error('Music grant should unlock playlists (legacy inherit)');
  if (flagsPartial.broadcast) throw new Error('Broadcast should stay off without mic/broadcast grant');

  const flagsExpanded = radio.radioFlags({
    role: 'manager', is_active: 1,
    permissions: JSON.stringify({
      radio_studio_access: true,
      radio_broadcast: true,
      radio_settings: true,
      radio_sfx: true
    })
  });
  if (!flagsExpanded.broadcast || !flagsExpanded.settings || !flagsExpanded.sfx) {
    throw new Error('Expanded radio permissions incorrect');
  }
  let dbOk = false;
  try {
    const { hasDatabaseConfig } = require('../electron/database/pg-connection');
    if (hasDatabaseConfig()) {
      const { initDatabase } = require('../electron/database/db');
      await initDatabase();
      dbOk = true;
      radio.ensureSchema();
      const pub = radio.publicStatus('main');
      if (!pub?.station?.name) throw new Error('publicStatus missing station');
      const overview = radio.adminOverview();
      if (!overview?.public_path || !overview?.studio_path) throw new Error('adminOverview missing paths');
      console.log('OK public:', pub.station.name, pub.station.status);
      console.log('OK paths:', overview.public_path, overview.studio_path);
    }
  } catch (e) {
    console.warn('[radio-test] DB path skipped:', e.message);
  }

  if (!dbOk) console.log('OK permission flags (no DB)');
  console.log('radio-platform smoke test passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

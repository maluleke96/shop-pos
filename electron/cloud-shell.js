/**
 * Thin launcher for local Windows apps (Admin / Staff / Marketing / Recipe).
 * Uses the full Electron + SQLite stack so the till works offline.
 * When online, installer-sync.js pushes queued changes to Railway.
 */
process.env.SHOP_POS_LOCAL_INSTALLER = '1';
if (!process.env.SHOP_POS_SYNC_URL) {
  process.env.SHOP_POS_SYNC_URL = 'https://peaceful-motivation-production-7dd2.up.railway.app';
}
require('./main.js');

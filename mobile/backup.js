const { App } = require('@capacitor/app');
const capFiles = require('./capacitorFiles');

const LAST_AUTO_KEY = 'shoppos_last_auto_backup_date';
let schedulerStarted = false;

async function runDailyBackup(store, { force = false } = {}) {
  if (!capFiles.isNative()) return { skipped: true, reason: 'not_native' };

  const settings = store.getSettingsParsed();
  const bs = settings?.backup_settings || {};
  if (!bs.auto_backup && !force) return { skipped: true, reason: 'disabled' };

  const today = capFiles.todayKey();
  if (!force && localStorage.getItem(LAST_AUTO_KEY) === today) {
    const exists = await capFiles.fileExists(`${capFiles.BACKUP_DIR}/${capFiles.backupFilename(today)}`);
    if (exists) return { skipped: true, reason: 'already_done' };
  }

  const { exportDatabaseBytes } = require('./db');
  const bytes = exportDatabaseBytes();
  const name = capFiles.backupFilename(today);
  const result = await capFiles.saveSilent(name, new Uint8Array(bytes));

  if (result.success) {
    localStorage.setItem(LAST_AUTO_KEY, today);
    store.saveSettings({ last_backup: new Date().toISOString() }, null, 'system');
    return {
      success: true,
      path: result.path,
      filename: name,
      automatic: !force
    };
  }
  return result;
}

function scheduleDailyBackup(store) {
  if (schedulerStarted || !capFiles.isNative()) return;
  schedulerStarted = true;

  const tick = () => {
    runDailyBackup(store).catch(err => console.warn('[Auto backup]', err.message));
  };

  tick();
  setInterval(tick, 60 * 60 * 1000);

  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) tick();
  }).catch(() => {});
}

function getBackupInfo(store) {
  const settings = store.getSettings();
  const parsed = store.getSettingsParsed();
  return {
    folder: capFiles.isNative() ? capFiles.getBackupFolderDisplay() : 'Default (AppData)',
    data_folder: capFiles.isNative() ? capFiles.getDataFolderDisplay() : null,
    last_backup: settings?.last_backup || null,
    auto_backup: !!parsed?.backup_settings?.auto_backup,
    last_auto_date: localStorage.getItem(LAST_AUTO_KEY),
    update_safe: true
  };
}

module.exports = { runDailyBackup, scheduleDailyBackup, getBackupInfo };

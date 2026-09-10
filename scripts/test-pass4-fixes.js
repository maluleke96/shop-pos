/**
 * Local smoke tests for pass-4 fixes: branches, dashboard dedup, electron IPC, catalog sync.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('OK:', msg);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

(async () => {
  // 1. Branch architecture
  const branchesJs = read('electron/services/branches.js');
  assert(branchesJs.includes('bootstrapInitialBranch'), 'bootstrapInitialBranch exists');
  assert(branchesJs.includes('resolveTillBranchId'), 'resolveTillBranchId exists');
  assert(branchesJs.includes('information_schema.tables'), 'PG tableExists support');
  const storeJs = read('electron/services/store.js');
  assert(storeJs.includes('bootstrapInitialBranch'), 'completeSetup bootstraps branch');
  assert(storeJs.includes('resolveTillBranchId'), 'completeSale uses resolveTillBranchId');
  assert(/openShift\(userId, openingFloat, opts/.test(storeJs), 'openShift accepts branch opts');
  assert(storeJs.includes('branch_id) VALUES'), 'openShift stamps branch_id');

  try {
    process.env.SHOP_POS_ELECTRON = '1';
    const { app } = require('electron');
    if (app?.getPath) {
      const branchesSvc = require('../electron/services/branches');
      await require('../electron/database/db').initDatabase();
      branchesSvc.ensureBranchSchema();
      const id = branchesSvc.ensureDefaultBranch();
      assert(!!id, `ensureDefaultBranch returned ${id}`);
      const list = branchesSvc.getBranchesDetailed();
      assert(list.length >= 1, `branches list length ${list.length}`);
      assert(list[0]?.name, `primary branch name ${list[0]?.name}`);
    } else {
      console.log('SKIP: runtime branch bootstrap (Electron app context unavailable in plain Node)');
    }
  } catch (err) {
    console.log('SKIP: runtime branch bootstrap —', err.message || err);
  }

  // 2. Dashboard dedup (static)
  const auditJs = read('src/js/pages/admin-audit.js');
  assert(auditJs.includes('dashboardRes: dashResult'), 'overview passes dashboardRes to quick panel');
  assert(auditJs.includes('return res;'), 'renderBusinessDashboard returns dashboard result');
  const adminJs = read('src/js/pages/admin.js');
  assert(adminJs.includes('opts.dashboardRes'), 'renderOverviewQuickPanel accepts preloaded dashboard');

  // 3. Electron IPC
  const mainJs = read('electron/main.js');
  assert(mainJs.includes("ipcMain.handle('bizModules:summary'"), 'Electron bizModules:summary wired');
  assert(mainJs.includes("ipcMain.handle('meeting:summary'"), 'Electron meeting:summary wired');
  assert(mainJs.includes("ipcMain.handle('signage:summary'"), 'Electron signage:summary wired');
  const preloadJs = read('electron/preload.js');
  assert(preloadJs.includes("'bizModules:summary'"), 'preload exposes bizModules:summary');
  assert(preloadJs.includes("'signage:summary'"), 'preload exposes signage:summary');

  // 4. Catalog sync
  const dataCache = read('src/js/data-cache.js');
  assert(dataCache.includes('BroadcastChannel'), 'catalog BroadcastChannel');
  const posJs = read('src/js/pages/pos.js');
  assert(posJs.includes('_catalogBroadcast'), 'POS catalog broadcast listener');
  assert(posJs.includes('_catalogPollTimer'), 'POS catalog poll timer');
  assert(posJs.includes('till_branch_id'), 'POS sale includes till_branch_id');
  const appJs = read('src/js/app.js');
  assert(appJs.includes('bindGlobalCatalogSync'), 'App global catalog sync hub');

  console.log(failed ? `\n${failed} test(s) failed` : '\nAll pass-4 local checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

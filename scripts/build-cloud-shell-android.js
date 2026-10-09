/**
 * Build Android APKs that load the LIVE cloud UI (same as browser).
 * Single source of truth — no bundled SQLite snapshots.
 *
 * Usage: node scripts/build-cloud-shell-android.js [pos|staff|...|kiosk|kitchen|all]
 */
const fs = require('fs');
const path = require('path');
const { defaultCloudUrl, buildCloudShellApp } = require('./cap-android-build-helpers');

const root = path.join(__dirname, '..');
const cloudUrl = defaultCloudUrl();
const destRoot = process.env.SHOP_POS_APK_DEST || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'ShopPOS-Installers', 'Android');
const moDestRoot = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'Manager-Operations');
const opsDestRoot = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'ShopPOS-Ops-Installers', 'Android');

const APPS = [
  { id: 'admin', config: 'capacitor.admin.json', apkName: 'ShopPOS-Admin.apk', appName: 'Shop POS Admin', serverPath: '/admin-app.html' },
  { id: 'pos', config: 'capacitor.pos.json', apkName: 'ShopPOS-POS.apk', appName: 'Shop POS', serverPath: '/pos-app.html' },
  { id: 'staff', config: 'capacitor.staff.json', apkName: 'ShopPOS-StaffPortal.apk', appName: 'Staff Portal', serverPath: '/staff-app.html' },
  { id: 'recipe', config: 'capacitor.recipe.json', apkName: 'ShopPOS-Recipe.apk', appName: 'Recipe & Production', serverPath: '/recipe-app.html' },
  { id: 'expense', config: 'capacitor.expense.json', apkName: 'ShopPOS-Expenses.apk', appName: 'Expenses', serverPath: '/expenses/' },
  { id: 'studio', config: 'capacitor.studio.json', apkName: 'ShopPOS-Studio.apk', appName: 'Menu & Promo Studio', serverPath: '/studio/' },
  { id: 'driver', config: 'capacitor.driver.json', apkName: 'ShopPOS-Driver.apk', appName: 'Driver App', serverPath: '/driver/' },
  { id: 'delivery', config: 'capacitor.delivery.json', apkName: 'ShopPOS-DeliveryDepartment.apk', appName: 'Delivery Department', serverPath: '/delivery-app.html' },
  { id: 'manager', config: 'capacitor.manager.json', apkName: 'ShopPOS-Manager.apk', appName: 'Business Manager', serverPath: '/manager/' },
  {
    id: 'manager-ops',
    config: 'capacitor.manager-ops.json',
    apkName: 'ShopPOS-ManagerOperations.apk',
    appName: 'Manager Operations',
    serverPath: '/manager-ops/',
    buildOpts: () => ({
      extraDest: moDestRoot,
      extraDestLatestName: 'ShopPOS-ManagerOperations-latest.apk',
      readmeText: `Manager Operations — Android installer
=====================================
Install ShopPOS-ManagerOperations.apk on your Android phone.

Live portal: ${cloudUrl}/manager-ops/

Sign in with the same username and password as Admin / POS (owner or manager).

Built: ${new Date().toISOString()}
`
    })
  },
  { id: 'order', config: 'capacitor.order.json', apkName: 'ShopPOS-OnlineOrdering.apk', appName: 'Online Ordering', serverPath: '/order/' },
  { id: 'referral', config: 'capacitor.referral.json', apkName: 'ShopPOS-ReferralAgent.apk', appName: 'Referral Agent', serverPath: '/referral-app.html' },
  { id: 'referral-commission', config: 'capacitor.referral-commission.json', apkName: 'ShopPOS-ReferralCommission.apk', appName: 'Referral Commission', serverPath: '/referral-commission-app.html' },
  { id: 'mgr-hr', config: 'capacitor.mgr-hr.json', apkName: 'ShopPOS-ManagerSupervisorPortal.apk', appName: 'Mgr Supervisor Portal', serverPath: '/mgr-hr-app.html' },
  { id: 'kiosk', config: 'capacitor.kiosk.json', apkName: 'ShopPOS-Kiosk.apk', appName: 'Shop POS Kiosk', serverPath: '/kiosk/', destRoot: opsDestRoot },
  { id: 'drive-thru', config: 'capacitor.drive-thru.json', apkName: 'ShopPOS-Drive-Thru.apk', appName: 'Drive-Thru', serverPath: '/drive-thru/', destRoot: opsDestRoot },
  { id: 'kitchen', config: 'capacitor.kitchen.json', apkName: 'ShopPOS-Kitchen-Display.apk', appName: 'Kitchen Display', serverPath: '/kitchen-display.html', destRoot: opsDestRoot },
  { id: 'customer-display', config: 'capacitor.customer-display.json', apkName: 'ShopPOS-Customer-Order-Display.apk', appName: 'Customer Order Display', serverPath: '/customer-display.html', destRoot: opsDestRoot },
  { id: 'radio', config: 'capacitor.radio.json', apkName: 'ShopPOS-Radio.apk', appName: 'Shop Radio', serverPath: '/radio-app.html' },
  { id: 'communication', config: 'capacitor.communication.json', apkName: 'ShopPOS-CommunicationCenter.apk', appName: 'Communication Center', serverPath: '/communication-center-app.html' },
  { id: 'marketing', config: 'capacitor.marketing.json', apkName: 'ShopPOS-MarketingCenter.apk', appName: 'Marketing Center', serverPath: '/marketing-center-app.html' },
  { id: 'platform', config: 'capacitor.platform.json', apkName: 'ShopPOS-PlatformControl.apk', appName: 'Platform Control', serverPath: '/platform/' }
];

function buildApp(app) {
  const out = app.destRoot || destRoot;
  const opts = typeof app.buildOpts === 'function' ? app.buildOpts() : {};
  buildCloudShellApp(root, cloudUrl, app, out, opts);
  if (app.destRoot === opsDestRoot && out === opsDestRoot) {
    fs.copyFileSync(path.join(out, app.apkName), path.join(destRoot, app.apkName));
  }
  if (app.id === 'manager-ops') {
    console.log(`✓ Also copied to ${moDestRoot}`);
  }
}

function main() {
  const arg = (process.argv[2] || 'all').trim().toLowerCase();
  const list = arg === 'all' ? APPS : APPS.filter((a) => a.id === arg);
  if (!list.length) {
    console.error('Unknown app:', arg);
    console.error('Usage: node scripts/build-cloud-shell-android.js [pos|staff|recipe|expense|studio|driver|delivery|manager|manager-ops|order|referral|referral-commission|mgr-hr|kiosk|drive-thru|kitchen|customer-display|radio|communication|marketing|platform|admin|all]');
    process.exit(1);
  }

  console.log('Cloud URL (same as browser):', cloudUrl);
  console.log('Each APK gets its own Android package name (no cross-app “Update” installs).\n');
  for (const app of list) {
    buildApp(app);
  }
}

if (require.main === module) {
  main();
}

module.exports = { APPS, buildApp, cloudUrl };

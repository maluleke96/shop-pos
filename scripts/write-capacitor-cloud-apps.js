/**
 * Write Capacitor configs for installable Android apps that open the Railway cloud UI.
 * Build each with: npx cap sync android (after copying the matching config to capacitor.config.json)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cloudUrl =
  process.env.SHOP_POS_CLOUD_URL ||
  'https://peaceful-motivation-production-7dd2.up.railway.app';

const apps = [
  { mode: 'admin', appId: 'com.shoppos.admin', appName: 'Shop POS Admin', entry: 'admin-app.html' },
  { mode: 'pos', appId: 'com.shoppos.pos', appName: 'Shop POS', entry: 'pos-app.html' },
  { mode: 'staff', appId: 'com.shoppos.staff', appName: 'Staff Portal', entry: 'staff-app.html' },
  { mode: 'marketing', appId: 'com.shoppos.marketing', appName: 'Marketing Agent', entry: 'marketing-app.html' },
  { mode: 'recipe', appId: 'com.shoppos.recipe', appName: 'Recipe Production', entry: 'recipe-app.html' }
];

const outDir = path.join(root, 'capacitor-apps');
fs.mkdirSync(outDir, { recursive: true });

for (const a of apps) {
  const cfg = {
    appId: a.appId,
    appName: a.appName,
    webDir: 'www',
    android: {
      allowMixedContent: true
    }
  };
  const p = path.join(outDir, `capacitor.${a.mode}.json`);
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  console.log('Wrote', p);
}

fs.writeFileSync(
  path.join(outDir, 'README.txt'),
  `Shop POS — Android local-first apps
==============================
Each JSON file is a Capacitor config. APKs use the on-device database
and sync to Railway when the phone is online.

Live sync target: ${cloudUrl}

The browser URL stays online-only.
`
);

console.log('Android cloud app configs ready in capacitor-apps/');

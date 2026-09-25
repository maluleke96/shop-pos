/**
 * Restore main Shop POS Capacitor / Gradle identity before APK build.
 * (Other portal scripts overwrite capacitor.config.json — never leave referral/commission config.)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version || '2.10.34';
const versionCode = Number(String(version).replace(/\D/g, '')) || 21034;

const cfg = {
  appId: 'com.shoppos.offline',
  appName: 'Shop POS',
  webDir: 'www',
  android: { allowMixedContent: true }
};
fs.writeFileSync(path.join(root, 'capacitor.config.json'), JSON.stringify(cfg, null, 2) + '\n');

const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
let g = fs.readFileSync(gradlePath, 'utf8').replace(/^\uFEFF/, '');
if (!/namespace\s+"com\.shoppos\.offline"/.test(g)) {
  g = g.replace(/namespace\s+"[^"]+"/, 'namespace "com.shoppos.offline"');
}
g = g.replace(/applicationId\s+"[^"]+"/, 'applicationId "com.shoppos.offline"');
g = g.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
g = g.replace(/versionName\s+"[^"]+"/, `versionName "${version}"`);
fs.writeFileSync(gradlePath, g);

const stringsPath = path.join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
const strings = `<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">Shop POS</string>
    <string name="title_activity_main">Shop POS</string>
    <string name="package_name">com.shoppos.offline</string>
    <string name="custom_url_scheme">com.shoppos.offline</string>
</resources>
`;
fs.writeFileSync(stringsPath, strings);
console.log('Prepared main Shop POS Android identity:', cfg.appId, version);

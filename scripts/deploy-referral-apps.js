/**
 * Deploy Referral & Commission + Referral Agent to Railway, then rebuild
 * Windows live shells + Android Referral Agent APK when requested.
 *
 * Usage:
 *   node scripts/deploy-referral-apps.js
 *   node scripts/deploy-referral-apps.js --windows
 *   node scripts/deploy-referral-apps.js --android
 *   node scripts/deploy-referral-apps.js --windows --android
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const stamp = `deploy-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-referral-payout-schedule-custom-v2.10.98`;
const args = new Set(process.argv.slice(2));

function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`);
  // railway is a .cmd shim on Windows — needs shell; node scripts must not use shell (spaces in path)
  const { shell: shellOpt, ...rest } = opts;
  const needShell = shellOpt != null ? shellOpt : (cmd === 'railway');
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', ...rest, shell: needShell });
  if (r.status !== 0) process.exit(r.status || 1);
}

fs.writeFileSync(path.join(root, 'deploy-version.txt'), stamp, 'utf8');
console.log(`Deploy stamp: ${stamp}`);

run('railway', ['up', '--service', 'peaceful-motivation', '-d']);

if (args.has('--windows') || args.has('--all')) {
  run(process.execPath, [path.join('scripts', 'rebuild-referral-windows.js')]);
}
if (args.has('--android') || args.has('--all')) {
  run(process.execPath, [path.join('scripts', 'build-cloud-shell-android.js'), 'referral']);
  run(process.execPath, [path.join('scripts', 'build-cloud-shell-android.js'), 'referral-commission']);
}

console.log('\nDone. Live site will pick up the new stamp shortly.');
console.log('Referral Agent: https://chisafood.up.railway.app/referral-app.html');
console.log('Referral & Commission: https://chisafood.up.railway.app/referral-commission-app.html');
console.log('Windows installers: Downloads\\\\ShopPOS-Installers\\\\Referral-Agent and Referral-Commission');
console.log('Android APKs: Downloads\\\\ShopPOS-Installers\\\\Android');

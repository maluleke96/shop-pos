/**
 * Deploy Manager & Supervisor Portal to Railway, then optionally rebuild installers.
 *
 * Usage:
 *   node scripts/deploy-mgr-hr.js
 *   node scripts/deploy-mgr-hr.js --windows --android
 *   node scripts/deploy-mgr-hr.js --all
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const stamp = `deploy-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-mgr-hr-recording-photos-submit-v3`;
const args = new Set(process.argv.slice(2));

function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`);
  const { shell: shellOpt, ...rest } = opts;
  const needShell = shellOpt != null ? shellOpt : (cmd === 'railway');
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', ...rest, shell: needShell });
  if (r.status !== 0) process.exit(r.status || 1);
}

fs.writeFileSync(path.join(root, 'deploy-version.txt'), stamp, 'utf8');
console.log(`Deploy stamp: ${stamp}`);

run('railway', ['up', '--service', 'peaceful-motivation', '-d']);

if (args.has('--windows') || args.has('--all')) {
  run(process.execPath, [path.join('scripts', 'build-mgr-hr-installers.js'), '--windows']);
}
if (args.has('--android') || args.has('--all')) {
  run(process.execPath, [path.join('scripts', 'build-mgr-hr-installers.js'), '--android']);
}

console.log('\nDone. Live portal: https://chisafood.up.railway.app/mgr-hr-app.html');
console.log('Windows: Downloads\\\\ShopPOS-Installers\\\\Manager-Supervisor-Portal');
console.log('Android: Downloads\\\\ShopPOS-Installers\\\\Android\\\\ShopPOS-ManagerSupervisorPortal.apk');

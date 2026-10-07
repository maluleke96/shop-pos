/**
 * Deploy Shop POS to Chisa Food production AND SaaS lab together.
 * Usage: node scripts/deploy-chisa-and-lab.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const stamp = `deploy-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-ops-kiosk-signage-salary-v2`;

function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`);
  const needShell = opts.shell != null ? opts.shell : cmd === 'railway';
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', ...opts, shell: needShell });
  if (r.status !== 0) process.exit(r.status || 1);
}

const CHISA_PROJECT = '0296f469-4b4e-4b3f-99fb-063b03535e39';
const LAB_PROJECT = '29f9f353-950f-4331-82d7-faa2565d3da1';

fs.writeFileSync(path.join(root, 'deploy-version.txt'), stamp, 'utf8');
console.log(`Deploy stamp: ${stamp}`);

run('railway', ['link', '--project', CHISA_PROJECT, '--service', 'peaceful-motivation', '--environment', 'production']);
run('railway', ['up', '--service', 'peaceful-motivation', '-d']);
run('railway', ['link', '--project', LAB_PROJECT, '--service', 'shoppos-lab', '--environment', 'production']);
run('railway', ['up', '--service', 'shoppos-lab', '-d']);
run('railway', ['link', '--project', CHISA_PROJECT, '--service', 'peaceful-motivation', '--environment', 'production']);

console.log('\nDone.');
console.log('Chisa: https://chisafood.up.railway.app/?page=admin&section=order-sla');
console.log('Lab:   https://shoppos-lab-production.up.railway.app/?page=admin&section=order-sla');

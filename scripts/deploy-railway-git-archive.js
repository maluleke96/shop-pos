/**
 * Deploy to Railway without 413 errors: upload git-tracked files only (~53MB), not local android/node_modules.
 * Usage: node scripts/deploy-railway-git-archive.js [lab|chisa|both]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const target = (process.argv[2] || 'both').toLowerCase();

const CHISA = { project: '0296f469-4b4e-4b3f-99fb-063b03535e39', service: 'peaceful-motivation' };
const LAB = { project: '29f9f353-950f-4331-82d7-faa2565d3da1', service: 'shoppos-lab' };

function run(cmd, args, cwd) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: cmd === 'railway' });
  if (r.status !== 0) process.exit(r.status || 1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shoppos-railway-'));
const zip = path.join(tmp, 'src.zip');
const appDir = path.join(tmp, 'app');
fs.mkdirSync(appDir);

run('git', ['-C', root, 'archive', 'HEAD', '-o', zip]);
run('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${zip.replace(/'/g, "''")}' -DestinationPath '${appDir.replace(/'/g, "''")}' -Force`]);

const stamp = `deploy-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-archive-v1`;
fs.writeFileSync(path.join(appDir, 'deploy-version.txt'), stamp, 'utf8');
console.log('Deploy stamp:', stamp, 'from commit', spawnSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim());

function deployOne(cfg) {
  run('railway', ['link', '--project', cfg.project, '--service', cfg.service, '--environment', 'production'], appDir);
  run('railway', ['up', '--service', cfg.service, '-d'], appDir);
}

if (target === 'lab' || target === 'both') deployOne(LAB);
if (target === 'chisa' || target === 'both') deployOne(CHISA);

console.log('\nDone (git archive upload — no android/node_modules).');

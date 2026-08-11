const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const downloads = path.join(require('os').homedir(), 'Downloads', 'ShopPOS-Code');
const staging = path.join(downloads, 'shop-pos');
const zipPath = path.join(downloads, 'ShopPOS-Source-Code.zip');

const skipDirs = new Set(['node_modules', 'dist', 'data', '.git']);
const skipFiles = new Set(['.DS_Store']);

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (skipDirs.has(name)) continue;
    const srcPath = path.join(src, name);
    const destPath = path.join(dest, name);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (!skipFiles.has(name) && !name.endsWith('.db')) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
fs.mkdirSync(downloads, { recursive: true });

copyDir(projectRoot, staging);

const readme = `# Shop POS Source Code

Open the **shop-pos** folder in Visual Studio Code.

## Setup
1. Open terminal in VS Code
2. Run: npm install
3. Run: npm start   (or double-click START.bat)

See README-VSCODE.md inside shop-pos for full details.
`;
fs.writeFileSync(path.join(downloads, 'HOW-TO-OPEN.txt'), readme);

const zipResult = spawnSync('powershell', [
  '-NoProfile', '-Command',
  `Compress-Archive -Path '${downloads.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`
], { stdio: 'inherit' });

if (zipResult.status !== 0) process.exit(zipResult.status || 1);

console.log('\nSource code ZIP:', zipPath);
console.log('Source folder:', downloads);
console.log('Updated Downloads/ShopPOS-Code');

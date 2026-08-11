const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const androidDir = path.join(root, 'android');
const bundledJdk = path.join(root, '.tools', 'jdk-17');

const env = { ...process.env };
if (fs.existsSync(bundledJdk)) {
  env.JAVA_HOME = bundledJdk;
  console.log('Using bundled JDK:', bundledJdk);
} else if (!env.JAVA_HOME) {
  console.warn('Warning: JAVA_HOME not set and bundled JDK not found at .tools/jdk-17');
}

// Cursor sandbox GRADLE_USER_HOME can serve incomplete Material AARs and break resource linking
if (env.GRADLE_USER_HOME && /cursor-sandbox-cache/i.test(env.GRADLE_USER_HOME)) {
  const stableHome = path.join(require('os').homedir(), '.gradle-shoppos');
  fs.mkdirSync(stableHome, { recursive: true });
  env.GRADLE_USER_HOME = stableHome;
  console.log('Using stable GRADLE_USER_HOME:', stableHome);
}

const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const result = spawnSync(gradle, ['assembleDebug'], {
  cwd: androidDir,
  env,
  shell: true,
  stdio: 'inherit'
});

process.exit(result.status ?? 1);

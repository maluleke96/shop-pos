/* Auto-includes all SQL migrations for mobile db */
const fs = require('fs');
const path = require('path');

const dbDir = path.join(__dirname, '..', 'electron', 'database');
const base = ['schema.sql', 'migrations.sql'];
const numbered = fs.readdirSync(dbDir)
  .filter(f => /^migrations-v\d+\.sql$/i.test(f))
  .map(f => ({ f, n: parseInt(f.match(/v(\d+)/i)[1], 10) }))
  .filter(x => Number.isFinite(x.n))
  .sort((a, b) => a.n - b.n)
  .map(x => x.f);

const files = [...base, ...numbered];
const missing = files.filter(f => !fs.existsSync(path.join(dbDir, f)));
if (missing.length) {
  console.error('Missing SQL files:', missing.join(', '));
  process.exit(1);
}

const SQL_FILES = files.map(f => fs.readFileSync(path.join(dbDir, f), 'utf8'));
const SQL_NAMES = files.slice();

const out = `// Generated — do not edit
module.exports = {
  SQL_FILES: ${JSON.stringify(SQL_FILES)},
  SQL_NAMES: ${JSON.stringify(SQL_NAMES)}
};
`;
fs.writeFileSync(path.join(__dirname, '..', 'mobile', 'sql-bundle.js'), out);
console.log('Generated mobile/sql-bundle.js with', files.length, 'files (through', numbered[numbered.length - 1] || 'base', ')');

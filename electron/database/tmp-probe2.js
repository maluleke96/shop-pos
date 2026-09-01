const initSqlJs = require('sql.js/dist/sql-asm.js');

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
  db.run('INSERT INTO t (name) VALUES (?)', ['a']);
  console.log('exec last_insert_rowid:', JSON.stringify(db.exec('SELECT last_insert_rowid() AS id')));
  console.log('getRowsModified:', db.getRowsModified());
  console.log('exec rows:', JSON.stringify(db.exec('SELECT * FROM t')));
  const s = db.prepare('SELECT last_insert_rowid() AS id');
  s.step();
  console.log('prepare last_insert_rowid:', JSON.stringify(s.getAsObject()));
  s.free();
})();

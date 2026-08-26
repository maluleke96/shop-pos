module.exports = {
  init: async () => {},
  getDb: () => { throw new Error('Postgres is not available on Android'); },
  prepare: () => ({ get: () => null, all: () => [], run: () => ({}) }),
  exec: () => {},
  close: () => {}
};

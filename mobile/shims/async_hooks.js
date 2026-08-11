/** Browser shim — AsyncLocalStorage is Node-only; mobile uses module-level sessions. */
class AsyncLocalStorage {
  getStore() {
    return null;
  }

  run(_store, fn) {
    return fn();
  }
}

module.exports = { AsyncLocalStorage };

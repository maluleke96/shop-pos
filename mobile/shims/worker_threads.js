class Worker {
  constructor() {
    throw new Error('worker_threads is not available on Android');
  }
}
module.exports = { Worker, isMainThread: true, parentPort: null, workerData: null };

/**
 * Per-request context (client IP / device) for rate limits that must not trust the request body.
 */
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function clientIpFromReq(req) {
  const fwd = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || String(req?.socket?.remoteAddress || '').replace(/^::ffff:/, '') || '';
}

function run(ctx, fn) {
  return storage.run(ctx || {}, fn);
}

function get() {
  return storage.getStore() || {};
}

module.exports = { run, get, clientIpFromReq };

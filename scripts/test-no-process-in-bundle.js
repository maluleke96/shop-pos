/**
 * Load mobile-api.bundle.js in a fake browser global WITHOUT Node `process`.
 * Fails if ReferenceError: process is not defined (or similar) is thrown at evaluate time.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bundlePath = path.join(__dirname, '..', 'www', 'js', 'mobile-api.bundle.js');
if (!fs.existsSync(bundlePath)) {
  console.error('Bundle missing — run npm run build:mobile-www first');
  process.exit(1);
}

const code = fs.readFileSync(bundlePath, 'utf8');
if (/process\.env\.SHOP_POS_CLOUD/.test(code) && !/typeof process/.test(code.slice(code.indexOf('SHOP_POS_CLOUD') - 60, code.indexOf('SHOP_POS_CLOUD')))) {
  // Soft note — build script already fails hard on unguarded process.env
  console.warn('Note: SHOP_POS_CLOUD still mentioned in bundle');
}

const document = {
  getElementById: () => ({
    style: { display: '' },
    querySelector: () => ({ textContent: '' })
  }),
  documentElement: { classList: { add() {} } },
  body: { classList: { add() {} } },
  addEventListener() {}
};

const sandbox = {
  window: {
    document,
    addEventListener() {},
    dispatchEvent() {},
    Capacitor: { isNativePlatform: () => false }
  },
  document,
  navigator: { userAgent: 'ShopPOS-Test' },
  location: { href: 'https://localhost/' },
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  URL,
  Blob,
  TextEncoder,
  TextDecoder,
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  // Intentionally NO process
};
sandbox.window.window = sandbox.window;
sandbox.globalThis = sandbox.window;
sandbox.self = sandbox.window;

try {
  vm.runInNewContext(code, sandbox, { filename: 'mobile-api.bundle.js', timeout: 10000 });
  console.log('PROCESS-FREE BUNDLE EVAL PASSED (no ReferenceError for process)');
} catch (err) {
  if (/process is not defined/i.test(err.message)) {
    console.error('FAILED: process is not defined still thrown by mobile-api.bundle.js');
    console.error(err.stack);
    process.exit(1);
  }
  // Other errors (missing Capacitor plugins, sql wasm path, etc.) may occur after process fix —
  // only fail hard on process ReferenceError at this stage.
  if (err instanceof ReferenceError) {
    console.error('FAILED ReferenceError:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
  console.log('Bundle evaluated; non-process error (acceptable for this check):', err.message);
}

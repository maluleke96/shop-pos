/** Browser-safe process.env for Capacitor APK bundles. */
const proc = typeof globalThis !== 'undefined' ? globalThis.process : undefined;
if (!proc || typeof proc !== 'object') {
  globalThis.process = { env: {} };
} else if (!proc.env || typeof proc.env !== 'object') {
  proc.env = {};
}

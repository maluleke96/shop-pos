/** Quick: encodeRpcPayload + toUint8 + normalize must not invent empty files. */
const assert = require('assert');
const { toUint8 } = require('../electron/services/pdf-bytes');

// Simulate encodeBinaryDeep path from rpc-app
function binaryToB64Envelope(value) {
  if (Buffer.isBuffer(value)) return { __shoppos_b64: value.toString('base64') };
  if (value instanceof Uint8Array) return { __shoppos_b64: Buffer.from(value).toString('base64') };
  return null;
}
function encodeBinaryDeep(value, ancestors) {
  if (value == null || typeof value !== 'object') return value;
  const wrapped = binaryToB64Envelope(value);
  if (wrapped) return wrapped;
  if (!ancestors) ancestors = new WeakSet();
  if (ancestors.has(value)) return null;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((v) => encodeBinaryDeep(v, ancestors));
    if (value.type === 'Buffer' && Array.isArray(value.data)) {
      return { __shoppos_b64: Buffer.from(value.data).toString('base64') };
    }
    const out = {};
    for (const k of Object.keys(value)) out[k] = encodeBinaryDeep(value[k], ancestors);
    return out;
  } finally {
    ancestors.delete(value);
  }
}

const pdf = Buffer.from('%PDF-1.4 hello');
const encoded = encodeBinaryDeep({ success: true, data: pdf });
assert.ok(encoded.data.__shoppos_b64, 'must wrap buffer as b64');
const wire = JSON.parse(JSON.stringify(encoded));
assert.ok(wire.data.__shoppos_b64, 'survives JSON');
const back = toUint8(wire.data);
assert.ok(back.byteLength > 0, 'roundtrip non-empty');
assert.equal(Buffer.from(back).toString('utf8'), '%PDF-1.4 hello');

let threw = false;
try { toUint8({ weird: true }); } catch (_) { threw = true; }
assert.ok(threw, 'unknown shape must throw');

// Shared modifier refs must survive (Customise options used to become null)
const mod = { id: 1, name: 'HOT', modifier_type: 'option' };
const shared = encodeBinaryDeep({ modifiers: [mod], options: [mod], removals: [mod] });
assert.equal(shared.options[0]?.name, 'HOT', 'shared options must not be null');
assert.equal(shared.removals[0]?.name, 'HOT', 'shared removals must not be null');
assert.equal(shared.modifiers[0]?.name, 'HOT');

console.log('EXPORT_BYTES_OK');

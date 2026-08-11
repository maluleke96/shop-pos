const bcrypt = require('bcryptjs');

function hashPin(pin) {
  if (pin == null || pin === '') return null;
  return bcrypt.hashSync(String(pin), 10);
}

function isHashedPin(stored) {
  return !!stored && String(stored).startsWith('$2');
}

/**
 * Verify PIN. Legacy plaintext matches are accepted once so callers can re-hash.
 * Prefer verifyPinWithUpgrade when a DB row can be updated.
 */
function verifyPin(stored, input) {
  if (!stored) return input == null || input === '';
  if (input == null || input === '') return false;
  const s = String(stored);
  if (isHashedPin(s)) return bcrypt.compareSync(String(input), s);
  return s === String(input);
}

/** Returns { ok, needsUpgrade, hash } — when needsUpgrade, persist hash to replace plaintext. */
function verifyPinWithUpgrade(stored, input) {
  const ok = verifyPin(stored, input);
  if (!ok) return { ok: false, needsUpgrade: false, hash: null };
  if (stored && !isHashedPin(stored) && input != null && input !== '') {
    return { ok: true, needsUpgrade: true, hash: hashPin(input) };
  }
  return { ok: true, needsUpgrade: false, hash: null };
}

module.exports = { hashPin, verifyPin, verifyPinWithUpgrade, isHashedPin };

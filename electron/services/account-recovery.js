/**
 * Account recovery helpers.
 * The private phrase is NEVER stored, logged, or returned — only a bcrypt hash.
 */
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;
const RECOVERY_MAX_ATTEMPTS = 5;
const RECOVERY_LOCKOUT_MS = 15 * 60 * 1000;
const GENERIC_FAIL = 'Recovery verification failed. Please try again.';
const MIN_PHRASE_LEN = 8;
const MIN_PASSWORD_LEN = 6;

/** Valid bcrypt hash of a dummy string — used so missing-hash compares still take bcrypt time. */
const DUMMY_HASH = '$2a$12$9kTviQOjwdRvpZuaUGPNJuOlRpea2VKD2V2hiNlnIxwGtnalDVT7C';

const SECRET_KEYS = [
  'recovery_secret_hash',
  'recovery_secret',
  'recovery_phrase',
  'recovery_secret_confirm',
  'bookkeeping_password_hash',
  'bookkeeping_password',
  'password',
  'password_hash',
  'new_password',
  'pin'
];

function hashPhrase(secret) {
  const phrase = String(secret || '').trim();
  if (phrase.length < MIN_PHRASE_LEN) {
    throw new Error(`Private recovery phrase must be at least ${MIN_PHRASE_LEN} characters`);
  }
  return bcrypt.hashSync(phrase, BCRYPT_ROUNDS);
}

function comparePhrase(secret, hash) {
  const phrase = String(secret || '').trim();
  const target = hash && String(hash).startsWith('$2') ? String(hash) : DUMMY_HASH;
  try {
    return bcrypt.compareSync(phrase, target);
  } catch (_) {
    return false;
  }
}

function sanitizeSecurityForClient(sec) {
  const security = { ...(sec || {}) };
  const configured = !!security.recovery_secret_hash;
  const lastChanged = security.recovery_changed_at || null;
  for (const k of SECRET_KEYS) delete security[k];
  delete security.recovery_failed_attempts;
  delete security.recovery_lock_until;
  security.recovery_configured = configured;
  security.recovery_changed_at = lastChanged;
  return security;
}

function mergeSecurityPreserveSecrets(raw, incoming) {
  const current = { ...(raw || {}) };
  const next = { ...(incoming || {}) };
  for (const k of SECRET_KEYS) delete next[k];
  delete next.recovery_failed_attempts;
  delete next.recovery_lock_until;
  return {
    ...current,
    ...next,
    recovery_secret_hash: current.recovery_secret_hash || null,
    bookkeeping_password_hash: current.bookkeeping_password_hash || null,
    recovery_changed_at: current.recovery_changed_at || null,
    recovery_failed_attempts: current.recovery_failed_attempts || 0,
    recovery_lock_until: current.recovery_lock_until || null
  };
}

function sanitizeAuditDetails(details) {
  if (details == null) return null;
  if (typeof details !== 'object') {
    const text = String(details);
    if (/recovery|phrase|password|secret|hash|pin/i.test(text) && text.length > 40) return '[redacted]';
    return details;
  }
  const copy = Array.isArray(details) ? details.map(sanitizeAuditDetails) : { ...details };
  if (Array.isArray(copy)) return copy;
  for (const k of Object.keys(copy)) {
    const lk = k.toLowerCase();
    if (SECRET_KEYS.includes(lk) || lk.includes('secret') || lk.includes('password') || lk.includes('phrase') || lk.includes('hash') || lk === 'pin') {
      delete copy[k];
      continue;
    }
    if (lk === 'security_settings') {
      let parsed = copy[k];
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { parsed = {}; }
      }
      if (parsed && typeof parsed === 'object') {
        copy[k] = sanitizeSecurityForClient(parsed);
      }
    }
  }
  return copy;
}

function stripSecretsFromError(err) {
  const msg = err && err.message ? String(err.message) : String(err || GENERIC_FAIL);
  if (/\$2[aby]\$/.test(msg) || /recovery_secret/i.test(msg)) return GENERIC_FAIL;
  return msg;
}

module.exports = {
  BCRYPT_ROUNDS,
  RECOVERY_MAX_ATTEMPTS,
  RECOVERY_LOCKOUT_MS,
  GENERIC_FAIL,
  MIN_PHRASE_LEN,
  MIN_PASSWORD_LEN,
  DUMMY_HASH,
  hashPhrase,
  comparePhrase,
  sanitizeSecurityForClient,
  mergeSecurityPreserveSecrets,
  sanitizeAuditDetails,
  stripSecretsFromError
};

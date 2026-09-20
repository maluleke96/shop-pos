/**
 * Encrypt payment gateway secrets at rest. Never log plaintext secrets.
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

function secretKeyBytes() {
  const raw = String(
    process.env.PAYMENT_SECRETS_KEY ||
    process.env.SHOP_POS_PAYMENT_SECRETS_KEY ||
    process.env.SHOP_POS_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'shop-pos-local-payment-secrets'
  );
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptSecret(plain) {
  const text = String(plain || '');
  if (!text) return null;
  if (text.startsWith(PREFIX)) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, secretKeyBytes(), iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, enc].map((b) => b.toString('base64url')).join('.');
}

function decryptSecret(stored) {
  const text = String(stored || '');
  if (!text) return '';
  if (!text.startsWith(PREFIX)) return text;
  try {
    const parts = text.slice(PREFIX.length).split('.');
    if (parts.length !== 3) return '';
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const data = Buffer.from(dataB64, 'base64url');
    const decipher = crypto.createDecipheriv(ALGO, secretKeyBytes(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (_) {
    return '';
  }
}

function maskSecret(value) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

function hasSecret(stored) {
  return !!(stored && String(stored).trim());
}

module.exports = {
  encryptSecret,
  decryptSecret,
  maskSecret,
  hasSecret
};

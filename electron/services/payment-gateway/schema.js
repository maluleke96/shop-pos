const { getDb } = require('../../database/db');

function isPgCloud() {
  try {
    return !!(process.env.SHOP_POS_DATABASE_URL || process.env.DATABASE_URL);
  } catch (_) {
    return false;
  }
}

function ensurePaymentGatewaySchema() {
  const db = getDb();
  const pg = isPgCloud();
  const idCol = pg ? 'id SERIAL PRIMARY KEY' : 'id INTEGER PRIMARY KEY AUTOINCREMENT';
  const nowDefault = pg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_gateways (
      ${idCol},
      provider TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      test_mode INTEGER NOT NULL DEFAULT 1,
      public_key TEXT,
      secret_key_enc TEXT,
      webhook_secret_enc TEXT,
      currency TEXT NOT NULL DEFAULT 'ZAR',
      webhook_id TEXT,
      last_successful_connection_at TEXT,
      last_webhook_at TEXT,
      last_error TEXT,
      status_message TEXT,
      extra_json TEXT,
      created_at ${nowDefault},
      updated_at ${nowDefault}
    );

    CREATE TABLE IF NOT EXISTS payment_transactions (
      ${idCol},
      order_id INTEGER,
      order_number TEXT,
      customer_name TEXT,
      customer_email TEXT,
      web_customer_id INTEGER,
      branch_id INTEGER,
      gateway_provider TEXT NOT NULL,
      gateway_checkout_id TEXT,
      gateway_payment_id TEXT,
      gateway_transaction_id TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'ZAR',
      status TEXT NOT NULL DEFAULT 'PENDING',
      refund_status TEXT,
      refunded_amount REAL DEFAULT 0,
      failure_reason TEXT,
      idempotency_key TEXT,
      metadata_json TEXT,
      gateway_response_json TEXT,
      accounting_posted INTEGER NOT NULL DEFAULT 0,
      paid_at TEXT,
      created_at ${nowDefault},
      updated_at ${nowDefault}
    );

    CREATE TABLE IF NOT EXISTS payment_webhook_events (
      ${idCol},
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_type TEXT,
      payload_json TEXT,
      processed INTEGER NOT NULL DEFAULT 0,
      created_at ${nowDefault},
      UNIQUE(provider, event_id)
    );
  `);

  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_pay_txn_order ON payment_transactions(order_id)');
  } catch (_) { /* */ }
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_pay_txn_status ON payment_transactions(status)');
  } catch (_) { /* */ }
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_pay_txn_gateway_checkout ON payment_transactions(gateway_checkout_id)');
  } catch (_) { /* */ }
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_pay_txn_gateway_payment ON payment_transactions(gateway_payment_id)');
  } catch (_) { /* */ }
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_txn_idem ON payment_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL');
  } catch (_) { /* */ }

  // Seed Yoco row if missing
  try {
    const existing = db.prepare('SELECT id FROM payment_gateways WHERE provider = ?').get('yoco');
    if (!existing) {
      db.prepare(`INSERT INTO payment_gateways (provider, name, enabled, test_mode, currency, status_message)
        VALUES (?, ?, 0, 1, 'ZAR', ?)`).run('yoco', 'Yoco', 'Not configured');
    }
  } catch (_) { /* */ }
}

module.exports = {
  ensurePaymentGatewaySchema,
  isPgCloud
};

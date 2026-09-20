const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');

function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('27')) return d;
  if (d.startsWith('0')) return '27' + d.slice(1);
  return d;
}

function phonesMatch(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  return na === nb || na.endsWith(nb.slice(-9)) || nb.endsWith(na.slice(-9));
}

function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 4) return '****';
  return `${'*'.repeat(Math.max(0, d.length - 4))}${d.slice(-4)}`;
}

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function nowPlusMin(mins) {
  return new Date(Date.now() + mins * 60000).toISOString().replace('T', ' ').slice(0, 19);
}

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function genericOk() {
  return {
    success: true,
    message: 'If we find your account, a reset code will be sent to your WhatsApp shortly.'
  };
}

function sendRecoveryWhatsApp(phone, body, opts = {}) {
  const whatsapp = require('./whatsapp');
  let url = null;
  try { url = whatsapp.buildWaUrl(phone, body); } catch (_) { /* */ }
  if (!url && phone) {
    try { url = `https://wa.me/${String(phone).replace(/\D/g, '')}?text=${encodeURIComponent(body)}`; } catch (_) { /* */ }
  }
  try {
    const r = whatsapp.sendMessage({
      phone,
      body,
      message_type: opts.message_type || 'password_recovery',
      recipient_type: opts.recipient_type || 'staff',
      otp_code: opts.otp_code || null
    });
    // sendMessage is async — never rely on its return for the open-WhatsApp UX
    if (r && typeof r.then === 'function') {
      r.catch(() => { /* fire-and-forget API send */ });
    }
    return { sent: true, url: (r && r.url) || url || null };
  } catch (err) {
    try {
      return { sent: false, url: url || whatsapp.buildWaUrl(phone, body), error: err.message };
    } catch (_) {
      return { sent: false, url, error: err.message };
    }
  }
}

function isPgCloud() {
  try {
    return !!(process.env.DATABASE_URL || process.env.SHOP_POS_DATABASE_URL);
  } catch (_) {
    return false;
  }
}

function ensureReferralResetSchema() {
  const sqliteSql = `
    CREATE TABLE IF NOT EXISTS referral_password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      contact TEXT,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ref_pw_reset_agent ON referral_password_resets(agent_id);
  `;
  const pgSql = `
    CREATE TABLE IF NOT EXISTS referral_password_resets (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER NOT NULL,
      contact TEXT,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ref_pw_reset_agent ON referral_password_resets(agent_id);
  `;
  try {
    getDb().exec(isPgCloud() ? pgSql : sqliteSql);
  } catch (err) {
    const msg = String(err.message || err);
    if (!/already exists/i.test(msg)) {
      try { getDb().exec(isPgCloud() ? sqliteSql : pgSql); } catch (_) { /* */ }
    }
  }
}

function recoverDriverPassword(identifier) {
  const id = String(identifier || '').trim();
  if (!id) throw new Error('Enter your phone number or driver code');
  const driver = getDb().prepare('SELECT * FROM delivery_drivers WHERE phone=? OR email=? OR driver_code=? LIMIT 1').get(id, id, id);
  if (!driver || driver.status !== 'active') return genericOk();
  const phone = driver.phone?.trim();
  if (!phone) throw new Error('No phone on file — contact the shop administrator');
  const temp = genCode();
  getDb().prepare("UPDATE delivery_drivers SET password_hash=?, updated_at=datetime('now') WHERE id=?").run(bcrypt.hashSync(temp, 10), driver.id);
  const shopName = getDb().prepare('SELECT shop_name FROM shop_settings WHERE id=1').get()?.shop_name || 'Shop';
  const wa = sendRecoveryWhatsApp(
    phone,
    shopName + ' Driver App — temporary password: ' + temp + '\n\nSign in and change your password. Do not share this message.'
  );
  return {
    success: true,
    message: wa.sent ? 'Temporary password sent to your WhatsApp.' : 'Open WhatsApp to receive your temporary password.',
    whatsapp_url: wa.url || null
  };
}

function findReferralAgent(identifier) {
  const id = String(identifier || '').trim();
  if (!id) return null;
  const db = getDb();
  const byKey = db.prepare(
    `SELECT * FROM referral_agents
     WHERE LOWER(COALESCE(username,''))=LOWER(?)
        OR LOWER(COALESCE(email,''))=LOWER(?)
        OR LOWER(COALESCE(referral_code,''))=LOWER(?)
        OR phone=?
     LIMIT 1`
  ).get(id, id, id, id);
  if (byKey) return byKey;
  let rows = [];
  try {
    rows = db.prepare(`SELECT * FROM referral_agents WHERE phone IS NOT NULL AND TRIM(phone) != ''`).all() || [];
  } catch (_) {
    try { rows = db.prepare(`SELECT * FROM referral_agents WHERE phone IS NOT NULL AND phone!=''`).all() || []; } catch (__) { rows = []; }
  }
  return rows.find((r) => phonesMatch(r.phone, id)) || null;
}

/**
 * Step 1 (Order Online style): phone → WhatsApp 6-digit code (does NOT change password yet).
 */
function sendReferralAgentResetCode(identifier) {
  ensureReferralResetSchema();
  const id = String(identifier || '').trim();
  if (!id) throw new Error('Enter your WhatsApp / mobile number');
  const agent = findReferralAgent(id);
  const status = String(agent?.status || '').toUpperCase();
  if (!agent || !['APPROVED', 'ACTIVE'].includes(status)) return genericOk();

  const phone = agent.phone?.trim();
  if (!phone) throw new Error('No phone on file — contact the shop administrator');

  const code = genCode();
  const db = getDb();
  try { db.prepare('DELETE FROM referral_password_resets WHERE agent_id=?').run(agent.id); } catch (_) { /* */ }
  db.prepare(
    `INSERT INTO referral_password_resets (agent_id, contact, code_hash, expires_at, created_at) VALUES (?,?,?,?,?)`
  ).run(agent.id, phone, bcrypt.hashSync(code, 10), nowPlusMin(15), nowIso());

  const shopName = db.prepare('SELECT shop_name FROM shop_settings WHERE id=1').get()?.shop_name || 'Shop';
  const body = `${shopName} — Your Referral Agent password reset code is: ${code}\n\nEnter this code on the Referral Agent portal, then type your new password. Valid for 15 minutes.\n\nUsername: ${agent.username || '—'}\nDo not share this code.`;
  const wa = sendRecoveryWhatsApp(phone, body, { message_type: 'password_reset', otp_code: code });
  // Always return a wa.me link (Order Online style) so the agent can open WhatsApp and send the code to themselves.
  let whatsappUrl = wa.url || null;
  if (!whatsappUrl) {
    try { whatsappUrl = require('./whatsapp').buildWaUrl(phone, body); } catch (_) { /* */ }
  }
  return {
    success: true,
    sent: true,
    via: 'whatsapp_open',
    whatsapp_url: whatsappUrl,
    phone_masked: maskPhone(phone),
    username_hint: agent.username || null,
    message: `Open WhatsApp for ${maskPhone(phone)}, tap Send to get your 6-digit code, then enter it here.`
  };
}

/**
 * Step 2: code + new password → update agent + users login.
 */
function resetReferralAgentPassword(data = {}) {
  ensureReferralResetSchema();
  const login = String(data.phone || data.identifier || data.login || '').trim();
  const code = String(data.code || data.verification_code || '').trim();
  const password = String(data.password || data.new_password || '');
  if (!login) throw new Error('Enter your WhatsApp / mobile number');
  if (code.length < 4) throw new Error('Enter the reset code');
  if (password.length < 6) throw new Error('New password must be at least 6 characters');

  const agent = findReferralAgent(login);
  if (!agent) throw new Error('No referral agent found for that number');
  const status = String(agent.status || '').toUpperCase();
  if (!['APPROVED', 'ACTIVE'].includes(status)) throw new Error('Only approved agents can reset their password');

  const db = getDb();
  const reset = db.prepare(
    `SELECT * FROM referral_password_resets WHERE agent_id=? AND expires_at > ? ORDER BY id DESC LIMIT 1`
  ).get(agent.id, nowIso());
  if (!reset) throw new Error('Reset code expired — request a new code');
  if (!bcrypt.compareSync(code, reset.code_hash)) throw new Error('Incorrect reset code');

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`UPDATE referral_agents SET password_hash=?, updated_at=datetime('now') WHERE id=?`).run(hash, agent.id);
  try {
    require('./referral-commission').ensureAgentUserAccount({ ...agent, password_hash: hash });
  } catch (_) {
    if (agent.user_id) {
      db.prepare(`UPDATE users SET password_hash=?, pin=NULL, role='referral_agent', is_active=1 WHERE id=?`).run(hash, agent.user_id);
    } else if (agent.username) {
      const existing = db.prepare(`SELECT id FROM users WHERE LOWER(username)=LOWER(?)`).get(agent.username);
      if (existing) {
        db.prepare(`UPDATE users SET password_hash=?, pin=NULL, role='referral_agent', is_active=1 WHERE id=?`).run(hash, existing.id);
        db.prepare(`UPDATE referral_agents SET user_id=? WHERE id=?`).run(existing.id, agent.id);
      } else {
        const ins = db.prepare(
          `INSERT INTO users (username, password_hash, full_name, role, is_active, created_at) VALUES (?,?,?,?,1,?)`
        ).run(agent.username, hash, agent.full_name || agent.username, 'referral_agent', nowIso());
        db.prepare(`UPDATE referral_agents SET user_id=? WHERE id=?`).run(ins.lastInsertRowid, agent.id);
      }
    }
  }
  db.prepare('DELETE FROM referral_password_resets WHERE agent_id=?').run(agent.id);
  return {
    success: true,
    username: agent.username,
    message: 'Password updated. You can sign in with your username and new password.'
  };
}

/** Legacy alias — now starts OTP flow (phone/username). */
function recoverReferralAgentPassword(identifier) {
  return sendReferralAgentResetCode(identifier);
}

/**
 * Recover owner / manager / assistant_manager password via WhatsApp.
 */
function recoverAdminPassword(identifier) {
  const id = String(identifier || '').trim();
  if (!id) throw new Error('Enter your username, phone, or email');
  const db = getDb();
  let user = db.prepare(
    `SELECT * FROM users WHERE LOWER(COALESCE(username,''))=LOWER(?) LIMIT 1`
  ).get(id);

  let phone = '';
  if (user) {
    try { phone = String(user.phone || '').trim(); } catch (_) { phone = ''; }
  }

  if (!user || !phone) {
    let emp = null;
    try {
      emp = db.prepare(
        `SELECT e.*, u.id AS uid
         FROM employees e
         LEFT JOIN users u ON (e.user_id IS NOT NULL AND u.id=e.user_id) OR LOWER(u.username)=LOWER(e.employee_code)
         WHERE e.phone=? OR LOWER(COALESCE(e.email,''))=LOWER(?)
         LIMIT 1`
      ).get(id, id);
    } catch (_) {
      try {
        emp = db.prepare(`SELECT * FROM employees WHERE phone=? OR LOWER(COALESCE(email,''))=LOWER(?) LIMIT 1`).get(id, id);
      } catch (_) { emp = null; }
    }
    if (!user && emp?.uid) user = db.prepare('SELECT * FROM users WHERE id=?').get(emp.uid);
    if (!phone && emp?.phone) phone = String(emp.phone).trim();
  }

  if (!user) {
    const rows = db.prepare(`SELECT * FROM users WHERE role IN ('owner','manager','assistant_manager')`).all();
    for (const u of rows) {
      try {
        const emp = db.prepare(
          `SELECT phone FROM employees WHERE user_id=? OR LOWER(employee_code)=LOWER(?) LIMIT 1`
        ).get(u.id, u.username);
        if (emp?.phone && (phonesMatch(emp.phone, id) || String(u.username || '').toLowerCase() === id.toLowerCase())) {
          user = u;
          phone = String(emp.phone).trim();
          break;
        }
      } catch (_) { /* ignore */ }
    }
  }

  if (!user || !['owner', 'manager', 'assistant_manager'].includes(String(user.role || ''))) {
    return genericOk();
  }
  if (Number(user.is_active) === 0) return genericOk();
  if (!phone && user.role === 'owner') {
    try {
      phone = String(db.prepare('SELECT phone FROM shop_settings WHERE id=1').get()?.phone || '').trim();
    } catch (_) { phone = ''; }
  }
  if (!phone) throw new Error('No WhatsApp number on file for this admin account');

  const temp = genCode();
  db.prepare(`UPDATE users SET password_hash=?, pin=NULL WHERE id=?`).run(bcrypt.hashSync(temp, 10), user.id);
  const shopName = db.prepare('SELECT shop_name FROM shop_settings WHERE id=1').get()?.shop_name || 'Shop';
  const wa = sendRecoveryWhatsApp(
    phone,
    shopName + ' Admin — temporary password: ' + temp + '\nUsername: ' + (user.username || '—') + '\n\nSign in and change your password. Do not share this message.'
  );
  return {
    success: true,
    message: wa.sent ? 'Temporary password sent to your WhatsApp.' : 'Open WhatsApp to receive your temporary password.',
    whatsapp_url: wa.url || null,
    username: user.username
  };
}

module.exports = {
  recoverDriverPassword,
  recoverReferralAgentPassword,
  sendReferralAgentResetCode,
  resetReferralAgentPassword,
  recoverAdminPassword
};

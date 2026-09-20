/**
 * One-shot repair: sync / reset a referral agent login password on Railway.
 *
 * Usage (from shop-pos, linked to peaceful-motivation):
 *   railway run --service peaceful-motivation node scripts/repair-referral-agent-login.js AP
 *   railway run --service peaceful-motivation node scripts/repair-referral-agent-login.js AP --set-password=1234t6
 *
 * Without --set-password it only prints non-secret diagnostics and syncs the users row
 * from the existing agent password_hash (if any).
 */
process.env.SHOP_POS_CLOUD = '1';

const username = String(process.argv[2] || '').trim();
const setArg = process.argv.find((a) => a.startsWith('--set-password='));
const newPassword = setArg ? setArg.slice('--set-password='.length) : null;

if (!username) {
  console.error('Usage: node scripts/repair-referral-agent-login.js <username> [--set-password=...]');
  process.exit(1);
}

async function main() {
  const { initDatabase, getDb } = require('../electron/database/db');
  await initDatabase();
  const ref = require('../electron/services/referral-commission');
  ref.ensureSchema();
  const db = getDb();
  const agent = db.prepare(
    `SELECT id, username, status, user_id, phone, email, full_name,
            CASE WHEN password_hash IS NULL OR TRIM(password_hash)='' THEN 0 ELSE 1 END AS has_password
     FROM referral_agents WHERE LOWER(COALESCE(username,''))=LOWER(?) LIMIT 1`
  ).get(username);

  if (!agent) {
    console.log(JSON.stringify({ ok: false, error: 'agent_not_found', username }, null, 2));
    process.exit(2);
  }

  const linked = agent.user_id
    ? db.prepare('SELECT id, username, role, is_active FROM users WHERE id=?').get(agent.user_id)
    : db.prepare('SELECT id, username, role, is_active FROM users WHERE LOWER(username)=LOWER(?)').get(agent.username);

  console.log(JSON.stringify({
    ok: true,
    agent: {
      id: agent.id,
      username: agent.username,
      status: agent.status,
      user_id: agent.user_id,
      has_password: !!agent.has_password,
      phone_present: !!(agent.phone && String(agent.phone).trim()),
      full_name: agent.full_name
    },
    linked_user: linked || null
  }, null, 2));

  if (newPassword) {
    if (String(newPassword).length < 6) throw new Error('Password must be at least 6 characters');
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(String(newPassword), 10);
    db.prepare(`UPDATE referral_agents SET password_hash=?, updated_at=datetime('now') WHERE id=?`).run(hash, agent.id);
    const refreshed = db.prepare('SELECT * FROM referral_agents WHERE id=?').get(agent.id);
    ref.ensureAgentUserAccount(refreshed);
    console.log(JSON.stringify({ repaired: true, username: agent.username, action: 'password_set_and_user_synced' }));
  } else if (agent.has_password) {
    const refreshed = db.prepare('SELECT * FROM referral_agents WHERE id=?').get(agent.id);
    ref.ensureAgentUserAccount(refreshed);
    console.log(JSON.stringify({ repaired: true, username: agent.username, action: 'user_synced_from_existing_hash' }));
  } else {
    console.log(JSON.stringify({ repaired: false, reason: 'no_password_on_file_use_--set-password' }));
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

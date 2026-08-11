/**
 * After SQLite → Supabase data import, create Auth users and link profiles.
 *
 * Usage (LOCAL ONLY — needs service role):
 *   $env:SUPABASE_URL="https://xxx.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="..."
 *   node scripts/link-auth-users.js ./export
 *
 * Creates auth users as {username}@legacy.local with a temporary password
 * written ONLY to link-auth-report.json (do not commit that file).
 * Users must change password on first login.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const exportDir = process.argv[2] || './export';
  const url = process.env.SUPABASE_URL || process.env.SHOP_POS_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const usersPath = path.join(exportDir, 'users.json');
  if (!fs.existsSync(usersPath)) {
    console.error('Missing', usersPath);
    process.exit(1);
  }
  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const report = { createdAt: new Date().toISOString(), users: [] };

  for (const u of users) {
    const username = String(u.username || '').trim();
    if (!username) continue;
    const email = `${username.toLowerCase()}@legacy.local`;
    const tempPassword = crypto.randomBytes(9).toString('base64url') + 'Aa1!';
    const entry = { legacy_user_id: u.id, username, email, role: u.role, tempPassword: null, status: '' };

    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { legacy_user_id: u.id, username, role: u.role }
    });

    if (createErr) {
      // Maybe already exists — try list by email
      entry.status = `create_failed: ${createErr.message}`;
      report.users.push(entry);
      continue;
    }

    const authId = created.user.id;
    entry.tempPassword = tempPassword;
    entry.auth_id = authId;

    const { error: profErr } = await sb.from('profiles').upsert({
      id: authId,
      legacy_user_id: u.id,
      username,
      full_name: u.full_name || username,
      role: u.role || 'cashier',
      is_active: u.is_active == null ? true : !!u.is_active,
      permissions: typeof u.permissions === 'string' ? JSON.parse(u.permissions || '{}') : (u.permissions || {}),
      pin_hash: u.pin || null
    });

    entry.status = profErr ? `profile_failed: ${profErr.message}` : 'ok';
    report.users.push(entry);
    console.log(entry.status, username, email);
  }

  const out = path.join(exportDir, 'link-auth-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log('Wrote', out, '— keep private; contains temporary passwords');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Resolve Postgres connection for Supabase / Netlify.
 * Accepts either a full URI or discrete host/port/user/password/database.
 */
function encodePwd(p) {
  return encodeURIComponent(String(p || ''));
}

function buildDatabaseUrlFromParts() {
  const host =
    process.env.SHOP_POS_DB_HOST ||
    process.env.SUPABASE_DB_HOST ||
    process.env.PGHOST ||
    '';
  const port =
    process.env.SHOP_POS_DB_PORT ||
    process.env.SUPABASE_DB_PORT ||
    process.env.PGPORT ||
    '5432';
  const database =
    process.env.SHOP_POS_DB_NAME ||
    process.env.SUPABASE_DB_NAME ||
    process.env.PGDATABASE ||
    'postgres';
  const user =
    process.env.SHOP_POS_DB_USER ||
    process.env.SUPABASE_DB_USER ||
    process.env.PGUSER ||
    'postgres';
  const password =
    process.env.SHOP_POS_DB_PASSWORD ||
    process.env.SUPABASE_DB_PASSWORD ||
    process.env.PGPASSWORD ||
    '';

  if (!host || !password) return '';

  // Direct Supabase DB host (db.<ref>.supabase.co:5432)
  return `postgresql://${encodeURIComponent(user)}:${encodePwd(password)}@${host}:${port}/${database}`;
}

function databaseUrl() {
  const direct =
    (process.env.SHOP_POS_DATABASE_URL || process.env.DATABASE_URL || '').trim();
  if (direct) {
    if (direct.startsWith('http://') || direct.startsWith('https://')) {
      throw new Error(
        'SHOP_POS_DATABASE_URL must be a postgresql:// URI (or use SHOP_POS_DB_HOST + SHOP_POS_DB_PASSWORD), not an https:// API URL'
      );
    }
    return direct;
  }
  return buildDatabaseUrlFromParts();
}

function hasDatabaseConfig() {
  try {
    return !!databaseUrl();
  } catch (_) {
    return false;
  }
}

function missingDatabaseConfigMessage() {
  return [
    'Database not configured. Either set:',
    '  SHOP_POS_DATABASE_URL=postgresql://user:password@host:5432/postgres',
    'OR set discrete vars:',
    '  SHOP_POS_DB_HOST=db.xxxxx.supabase.co',
    '  SHOP_POS_DB_PORT=5432',
    '  SHOP_POS_DB_NAME=postgres',
    '  SHOP_POS_DB_USER=postgres',
    '  SHOP_POS_DB_PASSWORD=<your database password>',
    '(DATABASE_URL is an accepted alias for SHOP_POS_DATABASE_URL)'
  ].join('\n');
}

module.exports = {
  databaseUrl,
  hasDatabaseConfig,
  missingDatabaseConfigMessage,
  buildDatabaseUrlFromParts
};

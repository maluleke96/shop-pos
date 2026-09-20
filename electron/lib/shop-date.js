/** Shop-local calendar helpers (default: Africa/Johannesburg). */
const SHOP_TZ = String(process.env.SHOP_TIMEZONE || 'Africa/Johannesburg').replace(/'/g, "''");

function localDateStr(d = new Date()) {
  return d.toLocaleDateString('en-CA');
}

function localDatePrefix(d = new Date()) {
  return localDateStr(d).replace(/-/g, '');
}

/** SQL fragment: extract local calendar date from a timestamp column (SQLite + Postgres via pg-db rewrite). */
function sqlLocalDate(col) {
  return `date(${col}, 'localtime')`;
}

/** WHERE clause + params for filtering rows to a local calendar day range. */
function sqlLocalDateRange(col, dateFrom, dateTo) {
  return {
    sql: `${sqlLocalDate(col)} >= date(?) AND ${sqlLocalDate(col)} <= date(?)`,
    params: [dateFrom, dateTo || dateFrom]
  };
}

module.exports = {
  SHOP_TZ,
  localDateStr,
  localDatePrefix,
  sqlLocalDate,
  sqlLocalDateRange
};

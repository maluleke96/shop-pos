/**
 * Admin System Health — Database & Storage Monitor
 * Server-side only. Never returns credentials or connection strings.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDb, isPgMode, getDbPathForBackup, getDbDir } = require('../database/db');

const DEFAULT_THRESHOLDS = { warning: 70, high: 80, critical: 90 };
const SNAPSHOT_MIN_INTERVAL_MS = 15 * 60 * 1000; // at most every 15 minutes when sampling
let _lastAutoSnapshotAt = 0;
let _schemaReady = false;

function nowIso() {
  return new Date().toISOString();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function ensureSchema() {
  if (_schemaReady) return;
  const db = getDb();
  try {
    if (isPgMode()) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS system_storage_metrics (
          id BIGSERIAL PRIMARY KEY,
          recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          database_size_bytes BIGINT,
          volume_used_bytes BIGINT,
          volume_total_bytes BIGINT,
          table_count INTEGER,
          index_size_bytes BIGINT,
          toast_size_bytes BIGINT,
          engine TEXT,
          database_name TEXT,
          notes TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_system_storage_metrics_recorded
          ON system_storage_metrics (recorded_at DESC);
      `);
    } else {
      db.exec(`
        CREATE TABLE IF NOT EXISTS system_storage_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recorded_at TEXT NOT NULL,
          database_size_bytes INTEGER,
          volume_used_bytes INTEGER,
          volume_total_bytes INTEGER,
          table_count INTEGER,
          index_size_bytes INTEGER,
          toast_size_bytes INTEGER,
          engine TEXT,
          database_name TEXT,
          notes TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_system_storage_metrics_recorded
          ON system_storage_metrics (recorded_at);
      `);
    }
    _schemaReady = true;
  } catch (err) {
    console.warn('[system-storage] ensureSchema:', err.message || err);
  }
}

function getThresholds() {
  try {
    const raw = getDb().prepare(
      `SELECT value FROM shop_settings_kv WHERE key = 'storage_monitor_thresholds' LIMIT 1`
    ).get()?.value;
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        warning: num(parsed.warning) || DEFAULT_THRESHOLDS.warning,
        high: num(parsed.high) || DEFAULT_THRESHOLDS.high,
        critical: num(parsed.critical) || DEFAULT_THRESHOLDS.critical
      };
    }
  } catch (_) { /* table may not exist */ }
  try {
    const row = getDb().prepare('SELECT storage_monitor_thresholds FROM shop_settings WHERE id = 1').get();
    if (row?.storage_monitor_thresholds) {
      const parsed = typeof row.storage_monitor_thresholds === 'string'
        ? JSON.parse(row.storage_monitor_thresholds)
        : row.storage_monitor_thresholds;
      return {
        warning: num(parsed.warning) || DEFAULT_THRESHOLDS.warning,
        high: num(parsed.high) || DEFAULT_THRESHOLDS.high,
        critical: num(parsed.critical) || DEFAULT_THRESHOLDS.critical
      };
    }
  } catch (_) { /* column may not exist */ }
  return { ...DEFAULT_THRESHOLDS };
}

function formatBytes(bytes) {
  const b = num(bytes);
  if (b <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = i === 0 ? 0 : (i === 1 ? 0 : 2);
  return `${v.toFixed(digits)} ${units[i]}`;
}

function statusFromPercent(pct, thresholds) {
  const p = num(pct);
  if (p >= thresholds.critical) return { level: 'critical', label: 'Critical', emoji: '🔴' };
  if (p >= thresholds.high) return { level: 'high', label: 'High', emoji: '🔴' };
  if (p >= thresholds.warning) return { level: 'warning', label: 'Warning', emoji: '🟠' };
  return { level: 'normal', label: 'Healthy', emoji: '🟢' };
}

function alertMessages(pct, thresholds) {
  const p = num(pct);
  const alerts = [];
  if (p >= thresholds.critical) {
    alerts.push({
      level: 'critical',
      title: 'CRITICAL',
      message: `PostgreSQL storage has reached ${Math.round(p)}%. Immediate action may be required.`
    });
  } else if (p >= thresholds.high) {
    alerts.push({
      level: 'high',
      title: 'HIGH',
      message: `PostgreSQL storage has reached ${Math.round(p)}%. Consider reviewing large tables and storage allocation.`
    });
  } else if (p >= thresholds.warning) {
    alerts.push({
      level: 'warning',
      title: 'WARNING',
      message: `PostgreSQL storage has reached ${Math.round(p)}% of the monitored capacity.`
    });
  }
  return alerts;
}

function safeError(err) {
  const msg = String(err?.message || err || 'Unknown error');
  if (/password|credential|connection string|DATABASE_URL|token|secret/i.test(msg)) {
    return 'Storage information temporarily unavailable.';
  }
  return msg.slice(0, 180);
}

/** Optional Railway GraphQL volume metrics — only if env is configured. Never invent values. */
async function fetchRailwayVolumeMetrics() {
  const token = (process.env.RAILWAY_API_TOKEN || process.env.RAILWAY_TOKEN || '').trim();
  const volumeId = (process.env.RAILWAY_VOLUME_ID || process.env.SHOP_POS_RAILWAY_VOLUME_ID || '').trim();
  if (!token || !volumeId) {
    return {
      available: false,
      reason: 'Railway volume metrics unavailable from application',
      detail: 'Set RAILWAY_API_TOKEN and RAILWAY_VOLUME_ID (PostgreSQL volume) as server env vars to enable.'
    };
  }
  try {
    const res = await fetch('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        query: `query Volume($id: String!) {
          volume(id: $id) {
            id
            name
            volumeInstances {
              edges {
                node {
                  currentSizeMB
                  sizeMB
                  state
                }
              }
            }
          }
        }`,
        variables: { id: volumeId }
      })
    });
    if (!res.ok) {
      return {
        available: false,
        reason: 'Railway volume metrics unavailable from application',
        detail: `Railway API returned HTTP ${res.status}`
      };
    }
    const json = await res.json();
    if (json.errors?.length) {
      return {
        available: false,
        reason: 'Railway volume metrics unavailable from application',
        detail: 'Railway API rejected the volume query (check volume id / token scope).'
      };
    }
    const edges = json?.data?.volume?.volumeInstances?.edges || [];
    const node = edges[0]?.node;
    if (!node) {
      return {
        available: false,
        reason: 'Railway volume metrics unavailable from application',
        detail: 'No volume instance returned for the configured volume id.'
      };
    }
    const usedMb = num(node.currentSizeMB);
    const totalMb = num(node.sizeMB);
    if (totalMb <= 0 && usedMb <= 0) {
      return {
        available: false,
        reason: 'Railway volume metrics unavailable from application',
        detail: 'Railway returned empty size fields for this volume.'
      };
    }
    const usedBytes = Math.round(usedMb * 1024 * 1024);
    const totalBytes = Math.round(totalMb * 1024 * 1024);
    const freeBytes = Math.max(0, totalBytes - usedBytes);
    const percent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : null;
    return {
      available: true,
      used_bytes: usedBytes,
      total_bytes: totalBytes,
      free_bytes: freeBytes,
      percent_used: percent,
      used_pretty: formatBytes(usedBytes),
      total_pretty: formatBytes(totalBytes),
      free_pretty: formatBytes(freeBytes),
      source: 'railway_api'
    };
  } catch (err) {
    return {
      available: false,
      reason: 'Railway volume metrics unavailable from application',
      detail: safeError(err)
    };
  }
}

function collectPostgresStats() {
  const db = getDb();
  const meta = db.prepare(`
    SELECT current_database() AS database_name,
           pg_database_size(current_database()) AS database_size_bytes
  `).get();

  const breakdown = db.prepare(`
    SELECT
      COALESCE(SUM(pg_relation_size(c.oid)), 0) AS tables_bytes,
      COALESCE(SUM(pg_indexes_size(c.oid)), 0) AS indexes_bytes,
      COALESCE(SUM(pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - pg_indexes_size(c.oid)), 0) AS other_bytes,
      COALESCE(SUM(pg_total_relation_size(c.oid)), 0) AS total_relations_bytes,
      COUNT(*)::int AS table_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  `).get();

  const indexCount = db.prepare(`
    SELECT COUNT(*)::int AS c
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'i'
  `).get()?.c || 0;

  const tables = db.prepare(`
    SELECT
      c.relname AS table_name,
      pg_relation_size(c.oid) AS table_bytes,
      pg_indexes_size(c.oid) AS index_bytes,
      pg_total_relation_size(c.oid) AS total_bytes,
      pg_size_pretty(pg_relation_size(c.oid)) AS table_pretty,
      pg_size_pretty(pg_indexes_size(c.oid)) AS index_pretty,
      pg_size_pretty(pg_total_relation_size(c.oid)) AS total_pretty
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
  `).all() || [];

  return {
    engine: 'postgres',
    database_name: meta?.database_name || null,
    database_size_bytes: num(meta?.database_size_bytes),
    table_count: num(breakdown?.table_count),
    index_count: num(indexCount),
    breakdown: {
      tables_bytes: num(breakdown?.tables_bytes),
      indexes_bytes: num(breakdown?.indexes_bytes),
      other_bytes: Math.max(0, num(breakdown?.other_bytes)),
      tables_pretty: formatBytes(breakdown?.tables_bytes),
      indexes_pretty: formatBytes(breakdown?.indexes_bytes),
      other_pretty: formatBytes(Math.max(0, num(breakdown?.other_bytes)))
    },
    index_size_bytes: num(breakdown?.indexes_bytes),
    tables: tables.map((t) => ({
      table_name: t.table_name,
      table_bytes: num(t.table_bytes),
      index_bytes: num(t.index_bytes),
      total_bytes: num(t.total_bytes),
      table_pretty: t.table_pretty || formatBytes(t.table_bytes),
      index_pretty: t.index_pretty || formatBytes(t.index_bytes),
      total_pretty: t.total_pretty || formatBytes(t.total_bytes)
    }))
  };
}

function collectSqliteStats() {
  const db = getDb();
  const dbPath = getDbPathForBackup();
  let database_size_bytes = 0;
  if (dbPath && fs.existsSync(dbPath)) {
    database_size_bytes = fs.statSync(dbPath).size;
  }
  const tableRows = db.prepare(
    `SELECT name AS table_name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  ).all() || [];

  // SQLite has no reliable per-table byte size without dbstat; report row counts only
  const tables = tableRows.map((t) => {
    let rows = null;
    try {
      rows = db.prepare(`SELECT COUNT(*) AS c FROM "${String(t.table_name).replace(/"/g, '""')}"`).get()?.c;
    } catch (_) { rows = null; }
    return {
      table_name: t.table_name,
      table_bytes: null,
      index_bytes: null,
      total_bytes: null,
      row_count: rows != null ? num(rows) : null,
      table_pretty: 'Unavailable',
      index_pretty: 'Unavailable',
      total_pretty: 'Unavailable'
    };
  });

  let index_count = 0;
  try {
    index_count = db.prepare(
      `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'`
    ).get()?.c || 0;
  } catch (_) { /* ignore */ }

  return {
    engine: 'sqlite',
    database_name: dbPath ? path.basename(dbPath) : 'shop-pos.db',
    database_size_bytes,
    table_count: tables.length,
    index_count: num(index_count),
    breakdown: {
      tables_bytes: null,
      indexes_bytes: null,
      other_bytes: null,
      tables_pretty: 'Unavailable',
      indexes_pretty: 'Unavailable',
      other_pretty: 'Unavailable'
    },
    index_size_bytes: null,
    tables,
    note: 'Per-table byte sizes are unavailable on SQLite without dbstat. Showing file size and row counts only.'
  };
}

function growthFromHistory(history, databaseSizeBytes) {
  if (!Array.isArray(history) || !history.length) {
    return {
      previous_size_bytes: null,
      growth_7d_bytes: null,
      growth_30d_bytes: null,
      avg_daily_growth_bytes: null,
      insufficient_data: true
    };
  }
  const now = Date.now();
  const sorted = [...history].sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
  const previous = sorted[sorted.length - 1];
  const findNear = (daysAgo) => {
    const target = now - daysAgo * 86400000;
    let best = null;
    let bestDiff = Infinity;
    for (const row of sorted) {
      const t = new Date(row.recorded_at).getTime();
      if (!Number.isFinite(t)) continue;
      const diff = Math.abs(t - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = row;
      }
    }
    // require within 2 days of target to avoid misleading deltas
    if (best && bestDiff <= 2 * 86400000) return best;
    return null;
  };
  const d7 = findNear(7);
  const d30 = findNear(30);
  const first = sorted[0];
  const spanDays = Math.max(
    1,
    (now - new Date(first.recorded_at).getTime()) / 86400000
  );
  const totalGrowth = databaseSizeBytes - num(first.database_size_bytes);
  const avgDaily = sorted.length >= 2 ? totalGrowth / spanDays : null;

  return {
    previous_size_bytes: previous ? num(previous.database_size_bytes) : null,
    previous_size_pretty: previous ? formatBytes(previous.database_size_bytes) : null,
    growth_7d_bytes: d7 ? databaseSizeBytes - num(d7.database_size_bytes) : null,
    growth_7d_pretty: d7 ? formatBytes(databaseSizeBytes - num(d7.database_size_bytes)) : null,
    growth_30d_bytes: d30 ? databaseSizeBytes - num(d30.database_size_bytes) : null,
    growth_30d_pretty: d30 ? formatBytes(databaseSizeBytes - num(d30.database_size_bytes)) : null,
    avg_daily_growth_bytes: avgDaily != null && Number.isFinite(avgDaily) ? Math.round(avgDaily) : null,
    avg_daily_growth_pretty: avgDaily != null && Number.isFinite(avgDaily) ? formatBytes(Math.round(avgDaily)) : null,
    insufficient_data: sorted.length < 2
  };
}

function saveSnapshot(stats, volume) {
  ensureSchema();
  const db = getDb();
  const recordedAt = nowIso();
  db.prepare(`
    INSERT INTO system_storage_metrics
      (recorded_at, database_size_bytes, volume_used_bytes, volume_total_bytes,
       table_count, index_size_bytes, toast_size_bytes, engine, database_name, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    recordedAt,
    stats.database_size_bytes,
    volume?.available ? volume.used_bytes : null,
    volume?.available ? volume.total_bytes : null,
    stats.table_count,
    stats.index_size_bytes,
    null,
    stats.engine,
    stats.database_name,
    stats.note || null
  );
  return recordedAt;
}

function listHistory(limit = 60) {
  ensureSchema();
  try {
    return getDb().prepare(`
      SELECT id, recorded_at, database_size_bytes, volume_used_bytes, volume_total_bytes,
             table_count, index_size_bytes, engine, database_name
      FROM system_storage_metrics
      ORDER BY recorded_at DESC
      LIMIT ?
    `).all(limit) || [];
  } catch (_) {
    return [];
  }
}

/**
 * Full monitor payload for Admin UI.
 * @param {{ refresh?: boolean, page?: number, pageSize?: number, actor?: object }} opts
 */
async function getStorageMonitor(opts = {}) {
  const thresholds = getThresholds();
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(opts.pageSize) || 25));
  const checkedAt = nowIso();

  try {
    ensureSchema();
    const stats = isPgMode() ? collectPostgresStats() : collectSqliteStats();
    const volume = await fetchRailwayVolumeMetrics();

    // Capacity for %: prefer Railway volume total; else env SHOP_POS_STORAGE_CAPACITY_GB; else no %
    let capacityBytes = null;
    let capacitySource = null;
    if (volume.available && volume.total_bytes > 0) {
      capacityBytes = volume.total_bytes;
      capacitySource = 'railway_volume';
    } else {
      const envGb = num(process.env.SHOP_POS_STORAGE_CAPACITY_GB || process.env.RAILWAY_VOLUME_SIZE_GB);
      if (envGb > 0) {
        capacityBytes = Math.round(envGb * 1024 * 1024 * 1024);
        capacitySource = 'env_SHOP_POS_STORAGE_CAPACITY_GB';
      }
    }

    const usedForBar = volume.available ? volume.used_bytes : stats.database_size_bytes;
    const percentUsed = capacityBytes > 0 ? (usedForBar / capacityBytes) * 100 : null;
    const freeBytes = capacityBytes != null ? Math.max(0, capacityBytes - usedForBar) : null;
    const status = percentUsed != null
      ? statusFromPercent(percentUsed, thresholds)
      : { level: 'unknown', label: 'Unknown', emoji: '⚪' };

    // Persist snapshot when refreshing or when interval elapsed
    const shouldSnapshot = opts.refresh || (Date.now() - _lastAutoSnapshotAt >= SNAPSHOT_MIN_INTERVAL_MS);
    if (shouldSnapshot) {
      try {
        saveSnapshot(stats, volume);
        _lastAutoSnapshotAt = Date.now();
      } catch (err) {
        console.warn('[system-storage] snapshot failed:', err.message || err);
      }
    }

    const historyDesc = listHistory(90);
    const historyAsc = [...historyDesc].reverse();
    const growth = growthFromHistory(historyAsc, stats.database_size_bytes);

    const totalTables = stats.tables.length;
    const start = (page - 1) * pageSize;
    const tablePage = stats.tables.slice(start, start + pageSize);

    return {
      success: true,
      checked_at: checkedAt,
      engine: stats.engine,
      is_postgres: isPgMode(),
      thresholds,
      summary: {
        database_size_bytes: stats.database_size_bytes,
        database_size_pretty: formatBytes(stats.database_size_bytes),
        database_name: stats.database_name,
        table_count: stats.table_count,
        index_count: stats.index_count,
        volume_used_bytes: volume.available ? volume.used_bytes : null,
        volume_total_bytes: volume.available ? volume.total_bytes : null,
        volume_free_bytes: volume.available ? volume.free_bytes : null,
        volume_used_pretty: volume.available ? volume.used_pretty : null,
        volume_total_pretty: volume.available ? volume.total_pretty : null,
        volume_free_pretty: volume.available ? volume.free_pretty : null,
        free_bytes: freeBytes,
        free_pretty: freeBytes != null ? formatBytes(freeBytes) : null,
        percent_used: percentUsed != null ? Math.round(percentUsed * 10) / 10 : null,
        capacity_bytes: capacityBytes,
        capacity_pretty: capacityBytes != null ? formatBytes(capacityBytes) : null,
        capacity_source: capacitySource,
        status
      },
      postgres: {
        database_name: stats.database_name,
        size_bytes: stats.database_size_bytes,
        size_pretty: formatBytes(stats.database_size_bytes),
        table_count: stats.table_count,
        index_count: stats.index_count,
        last_checked: checkedAt
      },
      railway_volume: volume,
      storage_bar: {
        used_bytes: usedForBar,
        free_bytes: freeBytes,
        total_bytes: capacityBytes,
        percent_used: percentUsed != null ? Math.round(percentUsed * 10) / 10 : null,
        used_pretty: formatBytes(usedForBar),
        free_pretty: freeBytes != null ? formatBytes(freeBytes) : 'Unavailable',
        total_pretty: capacityBytes != null ? formatBytes(capacityBytes) : 'Unavailable',
        status
      },
      breakdown: stats.breakdown,
      tables: {
        page,
        page_size: pageSize,
        total: totalTables,
        rows: tablePage
      },
      growth,
      history: historyAsc.map((h) => ({
        recorded_at: h.recorded_at,
        database_size_bytes: num(h.database_size_bytes),
        database_size_pretty: formatBytes(h.database_size_bytes),
        volume_used_bytes: h.volume_used_bytes != null ? num(h.volume_used_bytes) : null,
        volume_total_bytes: h.volume_total_bytes != null ? num(h.volume_total_bytes) : null
      })),
      alerts: percentUsed != null ? alertMessages(percentUsed, thresholds) : [],
      notes: [
        stats.note,
        !volume.available ? volume.reason : null,
        !capacityBytes
          ? 'Usage % requires Railway volume API env vars or SHOP_POS_STORAGE_CAPACITY_GB. Database size is always measured from PostgreSQL.'
          : null
      ].filter(Boolean)
    };
  } catch (err) {
    console.warn('[system-storage] getStorageMonitor:', err.message || err);
    return {
      success: false,
      error: 'Storage information temporarily unavailable.',
      detail: safeError(err),
      checked_at: checkedAt
    };
  }
}

/** Lightweight record for cron / boot — does not return secrets */
async function recordStorageSnapshot() {
  ensureSchema();
  const stats = isPgMode() ? collectPostgresStats() : collectSqliteStats();
  const volume = await fetchRailwayVolumeMetrics();
  const at = saveSnapshot(stats, volume);
  _lastAutoSnapshotAt = Date.now();
  return {
    success: true,
    recorded_at: at,
    database_size_bytes: stats.database_size_bytes,
    database_size_pretty: formatBytes(stats.database_size_bytes)
  };
}

module.exports = {
  ensureSchema,
  getStorageMonitor,
  recordStorageSnapshot,
  formatBytes,
  DEFAULT_THRESHOLDS,
  SNAPSHOT_MIN_INTERVAL_MS
};

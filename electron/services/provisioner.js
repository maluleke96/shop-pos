/**
 * Platform provisioning (Phase 6) — dry-run first, then Railway customer projects.
 * NEVER targets Chisa Food. NEVER copies Chisa business data.
 * Uses Phase 4 entitlements + Phase 5 shop records.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../database/db');
const railway = require('./railway-client');

let shops;
try { shops = require('./platform-shops'); } catch (_) { shops = null; }
let entitlements;
try { entitlements = require('./entitlements'); } catch (_) { entitlements = null; }
let platform;
try { platform = require('./platform-control'); } catch (_) { platform = null; }

const STATUSES = [
  'NOT_STARTED', 'DRY_RUN', 'PROVISIONING', 'DATABASE_CREATING',
  'DEPLOYING', 'HEALTH_CHECK', 'WAITING_HEALTH', 'SYNCING_ENTITLEMENTS',
  'READY', 'FAILED'
];

/** Health poll: ~8 minutes default (Docker cold start + migrations). */
const HEALTH_MAX_ATTEMPTS = Number(process.env.PROVISION_HEALTH_ATTEMPTS || 32);
const HEALTH_INTERVAL_MS = Number(process.env.PROVISION_HEALTH_INTERVAL_MS || 15000);

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function nowIso() { return new Date().toISOString(); }
function uid(prefix = 'prov') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function ensureSchema() {
  try {
    dbGet('SELECT 1 FROM platform_provision_jobs LIMIT 1');
    return;
  } catch (_) { /* */ }
  const files = [
    path.join(__dirname, '../database/migrations-v126.sql'),
    path.join(__dirname, '../../supabase/migrations/20260921_platform_provisioning.sql')
  ];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    try {
      getDb().exec(fs.readFileSync(f, 'utf8'));
      console.log('[provision] schema from', path.basename(f));
      return;
    } catch (e) {
      console.warn('[provision] schema:', e.message || e);
    }
  }
}

function audit(actor, action, shopId, detail) {
  try {
    dbRun(
      `INSERT INTO platform_audit_logs (actor, action, entity_type, entity_id, detail_json, created_at)
       VALUES (?,?,?,?,?,?)`,
      [actor || 'system', action, 'provision', shopId || '', JSON.stringify(railway.redact(detail || {})), nowIso()]
    );
  } catch (_) { /* */ }
}

function requirePlatform() {
  if (!platform?.isEnabled?.()) throw new Error('Platform Control is disabled');
  if (entitlements?.isChisaFoodProtected?.()) {
    throw new Error('Provisioning blocked on protected Chisa Food production');
  }
}

function slugifyProjectName(shopName) {
  const base = String(shopName || 'shop')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'shop';
  return `shop-${base}`.replace(/-+/g, '-').slice(0, 48);
}

function envKeysPlan(shop) {
  // Names only in UI — never values that are secrets
  return [
    { key: 'SHOP_ENTITLEMENT_KEY', source: 'shop.id', secret: false },
    { key: 'ENTITLEMENTS_ENFORCE', source: 'literal:true', secret: false },
    { key: 'PLATFORM_CONTROL_ENABLED', source: 'literal:false', secret: false },
    { key: 'SHOP_POS_CLOUD', source: 'literal:1', secret: false },
    { key: 'NODE_ENV', source: 'literal:production', secret: false },
    { key: 'DATABASE_URL', source: 'reference:Postgres private host + password (Railway vars)', secret: true },
    { key: 'SHOP_POS_DATABASE_URL', source: 'reference:same as DATABASE_URL', secret: true },
    { key: 'SHOP_POS_PUBLIC_URL', source: 'railway_public_domain', secret: false },
    { key: 'SHOP_POS_RPC_URL', source: 'railway_public_domain/rpc', secret: false },
    { key: 'SHOP_POS_SYNC_URL', source: 'railway_public_domain', secret: false }
  ];
}

function buildPlan(shop) {
  const repo = process.env.PROVISION_GITHUB_REPO || 'maluleke96/shop-pos';
  const branch = process.env.PROVISION_GITHUB_BRANCH || 'saas-web';
  const projectName = shop.railway_project_id
    ? `(reuse existing) ${shop.shop_name}`
    : slugifyProjectName(shop.shop_name);
  let entitlementsPayload = null;
  try {
    entitlementsPayload = entitlements?.computeEffectiveEntitlements?.(shop.id) || null;
  } catch (_) { /* */ }

  return {
    dry_run: true,
    shop_id: shop.id,
    shop_name: shop.shop_name,
    owner_name: shop.owner_name,
    owner_email: shop.owner_email,
    proposed_railway_project_name: slugifyProjectName(shop.shop_name),
    existing_railway_project_id: shop.railway_project_id || null,
    existing_railway_service_id: shop.railway_service_id || null,
    proposed_database_service: 'Postgres',
    proposed_app_service: 'shoppos',
    github_repository: repo,
    github_branch: branch,
    environment_variables: envKeysPlan(shop),
    package_id: shop.package_id,
    package_name: shop.package_name,
    addon_ids: shop.addon_ids || [],
    addon_names: shop.addon_names || [],
    initial_entitlement_flags: entitlementsPayload?.flags || null,
    proposed_shop_url: shop.shop_url || `(assigned after Railway domain for ${slugifyProjectName(shop.shop_name)})`,
    notes: [
      'Dry-run only — no Railway resources will be created.',
      'Customer database starts empty (schema via app migrations) — no Chisa Food data.',
      'Chisa Food project is blocked by ID and name checks.',
      'Secrets are never shown in this plan.'
    ],
    railway_api_configured: railway.isConfigured(),
    protected_projects_blocked: [railway.CHISA_PROJECT_ID]
  };
}

function updateShopStatus(shopId, fields, actor) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k}=?`);
    vals.push(v);
  }
  sets.push('updated_at=?', 'updated_by=?');
  vals.push(nowIso(), actor?.username || 'platform', shopId);
  dbRun(`UPDATE platform_shops SET ${sets.join(', ')} WHERE id=?`, vals);
}

function saveJob(row) {
  const existing = dbGet('SELECT id FROM platform_provision_jobs WHERE id = ?', [row.id]);
  if (existing) {
    dbRun(
      `UPDATE platform_provision_jobs SET status=?, plan_json=?, result_json=?, error_safe=?, dry_run=?, updated_at=?, updated_by=? WHERE id=?`,
      [row.status, row.plan_json, row.result_json, row.error_safe || '', row.dry_run ? 1 : 0, nowIso(), row.updated_by || 'platform', row.id]
    );
  } else {
    dbRun(
      `INSERT INTO platform_provision_jobs (id, shop_id, mode, status, plan_json, result_json, error_safe, dry_run, created_at, updated_at, created_by, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [row.id, row.shop_id, row.mode, row.status, row.plan_json, row.result_json, row.error_safe || '', row.dry_run ? 1 : 0,
        nowIso(), nowIso(), row.created_by || 'platform', row.updated_by || 'platform']
    );
  }
}

function getJob(id) {
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_provision_jobs WHERE id = ?', [id]);
  if (!row) return null;
  return {
    ...row,
    dry_run: !!row.dry_run,
    plan: (() => { try { return JSON.parse(row.plan_json || 'null'); } catch (_) { return null; } })(),
    result: (() => { try { return JSON.parse(row.result_json || 'null'); } catch (_) { return null; } })()
  };
}

function listJobs(shopId, limit = 20) {
  ensureSchema();
  const rows = shopId
    ? dbAll('SELECT * FROM platform_provision_jobs WHERE shop_id=? ORDER BY created_at DESC LIMIT ?', [shopId, limit])
    : dbAll('SELECT * FROM platform_provision_jobs ORDER BY created_at DESC LIMIT ?', [limit]);
  return rows.map((r) => getJob(r.id));
}

function dryRun(shopId, actor) {
  requirePlatform();
  ensureSchema();
  shops?.assertNotChisaFood?.({ id: shopId });
  const shopRes = shops.getShop(shopId);
  const shop = shopRes.data;
  const plan = buildPlan(shop);
  const jobId = uid('prov');
  saveJob({
    id: jobId,
    shop_id: shopId,
    mode: 'dry_run',
    status: 'DRY_RUN',
    plan_json: JSON.stringify(plan),
    result_json: JSON.stringify({ ok: true, mode: 'dry_run' }),
    dry_run: 1,
    created_by: actor?.username,
    updated_by: actor?.username
  });
  updateShopStatus(shopId, { deployment_status: 'not_provisioned' }, actor);
  audit(actor?.username, 'provision_dry_run', shopId, { job_id: jobId, project_name: plan.proposed_railway_project_name });
  return { success: true, data: { job_id: jobId, status: 'DRY_RUN', plan } };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function healthCheck(url, shopId) {
  const checks = {
    http_ok: false,
    status: null,
    rpc_ok: false,
    shop_key: null,
    entitlement_enforcement: null,
    ui_ok: false,
    readiness: 'unknown', // starting | ready | unhealthy | unreachable
    errors: []
  };
  const base = String(url).replace(/\/$/, '');
  try {
    const h = await fetch(base + '/health', { signal: AbortSignal.timeout(20000) });
    checks.status = h.status;
    if (h.status === 502 || h.status === 503 || h.status === 504) {
      checks.readiness = 'starting';
      checks.errors.push('gateway_' + h.status);
    } else {
      const body = await h.json().catch(() => ({}));
      checks.http_ok = h.ok && !!body.ok;
      checks.shop_key = body.shop_key || null;
      if (checks.http_ok) checks.readiness = 'ready';
      else {
        checks.readiness = 'unhealthy';
        checks.errors.push('health not ok');
      }
    }
  } catch (e) {
    const msg = String(e.message || e);
    checks.readiness = /timeout|ECONNREFUSED|fetch failed|network/i.test(msg) ? 'starting' : 'unreachable';
    checks.errors.push('health: ' + msg.slice(0, 120));
  }
  try {
    const ui = await fetch(base + '/', { signal: AbortSignal.timeout(20000) });
    checks.ui_ok = ui.ok || ui.status === 502 || ui.status === 503;
    if (!ui.ok && ui.status !== 502 && ui.status !== 503) checks.errors.push('ui http ' + ui.status);
  } catch (e) {
    if (checks.readiness !== 'starting') {
      checks.errors.push('ui: ' + String(e.message || e).slice(0, 120));
    }
  }
  for (const method of ['entitlements:status', 'entitlements:get']) {
    try {
      const r = await fetch(base + '/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, args: [] }),
        signal: AbortSignal.timeout(20000)
      });
      const j = await r.json().catch(() => ({}));
      if (/Unknown method/i.test(String(j.error || ''))) continue;
      const d = j.data || j;
      checks.rpc_ok = r.ok && j.success !== false;
      checks.shop_key = d.shop_key || d.shopKey || checks.shop_key;
      checks.entitlement_enforcement = d.enforcement ?? d.enforce ?? checks.entitlement_enforcement;
      break;
    } catch (e) {
      if (checks.readiness !== 'starting') {
        checks.errors.push('rpc: ' + String(e.message || e).slice(0, 120));
      }
    }
  }
  if (shopId && checks.shop_key && checks.shop_key !== shopId) {
    checks.errors.push(`shop_key mismatch: got ${checks.shop_key}`);
  }
  checks.passed = checks.http_ok && checks.ui_ok && checks.rpc_ok && checks.errors.length === 0;
  if (checks.passed) checks.readiness = 'ready';
  return checks;
}

/**
 * Verify entitlement snapshot applied (package + key flags). Never logs secrets.
 */
async function verifyEntitlementSync(url, shop) {
  const out = {
    ok: false,
    shop_key: null,
    package_id: null,
    flags: null,
    errors: []
  };
  const base = String(url).replace(/\/$/, '');
  try {
    const r = await fetch(base + '/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'entitlements:get', args: [] }),
      signal: AbortSignal.timeout(25000)
    });
    const j = await r.json().catch(() => ({}));
    if (j.success === false || /Unknown method/i.test(String(j.error || ''))) {
      out.errors.push(j.error || 'entitlements:get failed');
      return out;
    }
    const d = j.data || j;
    out.shop_key = d.shop_key || null;
    out.package_id = d.package_id || d.meta?.package_id || null;
    out.flags = d.flags || null;
    out.enforcement = d.enforcement;
    if (shop?.id && out.shop_key && out.shop_key !== shop.id) {
      out.errors.push('shop_key mismatch');
    }
    if (shop?.package_id && out.package_id && out.package_id !== shop.package_id) {
      out.errors.push('package_id mismatch');
    }
    // If shop has online add-on expectation via flags from platform snapshot
    const expectOnline = !!(shop.entitlements?.flags?.online);
    if (expectOnline && out.flags && out.flags.online !== true) {
      out.errors.push('expected online flag true');
    }
    if (out.enforcement !== true) out.errors.push('enforcement not true');
    if (!out.package_id && shop?.package_id) out.errors.push('package_id missing on customer');
    out.ok = out.errors.length === 0 && !!out.shop_key;
  } catch (e) {
    out.errors.push(String(e.message || e).slice(0, 160));
  }
  return out;
}

async function resolveSyncSecret(projectId, environmentId, serviceId, preferred) {
  // Prefer existing Railway secret so retries do not rotate and force another redeploy cycle
  try {
    const vars = await railway.getVariables({ projectId, environmentId, serviceId });
    const existing = String(vars.SAAS_SYNC_SECRET || '').trim();
    if (existing) return { secret: existing, created: false };
  } catch (_) { /* */ }
  if (preferred) return { secret: preferred, created: true };
  return { secret: crypto.randomBytes(24).toString('base64url'), created: true };
}

/**
 * Real provisioning — idempotent using IDs already stored on the shop.
 */
async function provision(shopId, actor, { force = false } = {}) {
  requirePlatform();
  ensureSchema();
  if (!railway.isConfigured()) {
    throw new Error('RAILWAY_API_TOKEN not configured — dry-run still available; set token on lab only');
  }
  shops?.assertNotChisaFood?.({ id: shopId });
  const shop = shops.getShop(shopId).data;
  if (/chisa/i.test(shop.shop_name + shop.id)) throw new Error('Chisa Food cannot be provisioned');

  const jobId = uid('prov');
  const plan = buildPlan(shop);
  plan.dry_run = false;
  saveJob({
    id: jobId, shop_id: shopId, mode: 'provision', status: 'PROVISIONING',
    plan_json: JSON.stringify(plan), result_json: '{}', dry_run: 0,
    created_by: actor?.username, updated_by: actor?.username
  });
  updateShopStatus(shopId, { deployment_status: 'provisioning' }, actor);
  audit(actor?.username, 'provision_started', shopId, { job_id: jobId });

  const result = {
    projectId: shop.railway_project_id || null,
    environmentId: shop.railway_environment_id || null,
    postgresServiceId: null,
    appServiceId: shop.railway_service_id || null,
    domain: shop.shop_url || null,
    steps: []
  };

  try {
    // 1) Project
    if (result.projectId) {
      railway.assertNotProtectedProject(result.projectId);
      const existing = await railway.getProject(result.projectId);
      if (!existing) throw new Error('Stored railway_project_id not found');
      result.environmentId = result.environmentId || existing.environments?.edges?.[0]?.node?.id;
      result.steps.push({ step: 'project', action: 'reused', id: result.projectId });
    } else {
      const created = await railway.createProject({
        name: slugifyProjectName(shop.shop_name),
        workspaceId: process.env.RAILWAY_WORKSPACE_ID,
        description: `Shop POS customer ${shop.id}`
      });
      result.projectId = created.projectId;
      result.environmentId = created.environmentId;
      updateShopStatus(shopId, {
        railway_project_id: result.projectId,
        railway_environment_id: result.environmentId,
        deployment_status: 'provisioning'
      }, actor);
      result.steps.push({ step: 'project', action: 'created', id: result.projectId });
    }

    if (!result.environmentId) {
      const p = await railway.getProject(result.projectId);
      result.environmentId = p.environments?.edges?.[0]?.node?.id;
      updateShopStatus(shopId, { railway_environment_id: result.environmentId }, actor);
    }

    // 2) Postgres
    saveJob({
      id: jobId, shop_id: shopId, mode: 'provision', status: 'DATABASE_CREATING',
      plan_json: JSON.stringify(plan), result_json: JSON.stringify(railway.redact(result)), dry_run: 0,
      updated_by: actor?.username
    });
    updateShopStatus(shopId, { deployment_status: 'pending' }, actor);

    const proj = await railway.getProject(result.projectId);
    const services = (proj.services?.edges || []).map((e) => e.node);
    let postgres = services.find((s) => /postgres/i.test(s.name));
    if (!postgres) {
      postgres = await railway.createPostgresService({
        projectId: result.projectId,
        environmentId: result.environmentId,
        name: 'Postgres'
      });
      result.steps.push({ step: 'postgres', action: 'created', id: postgres.id });
      await railway.createVolume({
        projectId: result.projectId,
        environmentId: result.environmentId,
        serviceId: postgres.id,
        mountPath: '/var/lib/postgresql/data'
      }).catch(() => null);
      // Basic postgres env (password generated)
      const pw = crypto.randomBytes(24).toString('base64url');
      await railway.upsertVariables({
        projectId: result.projectId,
        environmentId: result.environmentId,
        serviceId: postgres.id,
        variables: {
          POSTGRES_PASSWORD: pw,
          POSTGRES_USER: 'postgres',
          POSTGRES_DB: 'railway',
          PGDATA: '/var/lib/postgresql/data/pgdata'
        },
        skipDeploys: false
      });
    } else {
      result.steps.push({ step: 'postgres', action: 'reused', id: postgres.id });
    }
    result.postgresServiceId = postgres.id;

    // Safety: reject if DATABASE_URL somehow points at Chisa (best-effort)
    try {
      const pgVars = await railway.getVariables({
        projectId: result.projectId,
        environmentId: result.environmentId,
        serviceId: postgres.id
      });
      const hay = JSON.stringify(railway.redact(pgVars)).toLowerCase();
      if (hay.includes('chisafood') || hay.includes(railway.CHISA_PROJECT_ID.toLowerCase())) {
        throw new Error('Database identity check failed — appears related to Chisa Food');
      }
    } catch (e) {
      if (/Chisa Food/i.test(e.message)) throw e;
      result.steps.push({ step: 'db_identity_check', action: 'skipped', reason: String(e.message || e).slice(0, 120) });
    }

    // 3) App service
    saveJob({
      id: jobId, shop_id: shopId, mode: 'provision', status: 'DEPLOYING',
      plan_json: JSON.stringify(plan), result_json: JSON.stringify(railway.redact(result)), dry_run: 0,
      updated_by: actor?.username
    });

    let app = services.find((s) => /shoppos|shop-pos|web|app/i.test(s.name) && !/postgres/i.test(s.name));
    if (result.appServiceId) {
      app = services.find((s) => s.id === result.appServiceId) || app;
    }
    if (!app) {
      app = await railway.createServiceFromRepo({
        projectId: result.projectId,
        environmentId: result.environmentId,
        name: 'shoppos',
        repo: process.env.PROVISION_GITHUB_REPO || 'maluleke96/shop-pos',
        branch: process.env.PROVISION_GITHUB_BRANCH || 'saas-web'
      });
      result.steps.push({ step: 'app_service', action: 'created', id: app.id });
    } else {
      result.steps.push({ step: 'app_service', action: 'reused', id: app.id });
    }
    result.appServiceId = app.id;
    updateShopStatus(shopId, { railway_service_id: app.id }, actor);

    // Force Dockerfile web build + deploy branch with Dockerfile present
    try {
      await railway.configureAppServiceDocker({
        serviceId: app.id,
        environmentId: result.environmentId
      });
      result.steps.push({ step: 'app_docker_config', action: 'set', dockerfilePath: 'Dockerfile' });
      const branchFix = await railway.ensureDeployBranch({
        projectId: result.projectId,
        environmentId: result.environmentId,
        serviceId: app.id,
        branch: process.env.PROVISION_GITHUB_BRANCH || 'saas-web',
        repository: process.env.PROVISION_GITHUB_REPO || 'maluleke96/shop-pos'
      });
      result.steps.push({ step: 'app_deploy_branch', action: branchFix.action, branch: branchFix.branch });
    } catch (e) {
      result.steps.push({
        step: 'app_docker_config',
        action: 'error',
        error: String(e.message || e).slice(0, 200)
      });
      throw new Error('Failed to configure Dockerfile builder: ' + String(e.message || e).slice(0, 200));
    }

    // 4) Env vars — ALL required vars BEFORE deploy (incl. SAAS_SYNC_SECRET)
    // Prefer explicit private-network URL because image-based Postgres may lack DATABASE_URL.
    const pgUrl =
      'postgresql://postgres:${{Postgres.POSTGRES_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.POSTGRES_DB}}';
    const secretRes = await resolveSyncSecret(
      result.projectId,
      result.environmentId,
      app.id,
      null
    );
    const syncSecret = secretRes.secret;
    result.syncSecretSet = true;
    result.syncSecretCreated = !!secretRes.created;
    await railway.upsertVariables({
      projectId: result.projectId,
      environmentId: result.environmentId,
      serviceId: app.id,
      variables: {
        SHOP_ENTITLEMENT_KEY: shop.id,
        SHOP_PACKAGE_ID: shop.package_id || '',
        SHOP_ADDON_IDS: (shop.addon_ids || []).join(','),
        SHOP_SUBSCRIPTION_STATUS: shop.subscription_status || 'TRIAL',
        SHOP_NAME: shop.shop_name || '',
        ENTITLEMENTS_ENFORCE: 'true',
        PLATFORM_CONTROL_ENABLED: 'false',
        SAAS_SYNC_SECRET: syncSecret,
        SHOP_POS_CLOUD: '1',
        NODE_ENV: 'production',
        DATABASE_URL: pgUrl,
        SHOP_POS_DATABASE_URL: pgUrl,
        PGSSLMODE: 'require'
      },
      skipDeploys: true
    });
    result.steps.push({
      step: 'app_variables',
      action: 'upserted',
      keys: [
        'SHOP_ENTITLEMENT_KEY', 'SHOP_PACKAGE_ID', 'SHOP_ADDON_IDS',
        'SAAS_SYNC_SECRET', 'ENTITLEMENTS_ENFORCE', 'DATABASE_URL'
      ],
      secret_reused: !secretRes.created
    });
    // Keep secret only in memory for post-health sync — never persist to jobs/UI
    result._syncSecret = syncSecret;

    // 5) Domain — do not hard-code targetPort (Railway sets PORT, often 8080)
    let domains = await railway.listDomains({
      projectId: result.projectId,
      environmentId: result.environmentId,
      serviceId: app.id
    });
    if (!domains.length) {
      const d = await railway.createDomain({
        environmentId: result.environmentId,
        serviceId: app.id
      });
      domains = [d];
      result.steps.push({ step: 'domain', action: 'created', domain: d.domain });
    } else {
      const d0 = domains[0];
      if (d0.targetPort === 3000) {
        try {
          await railway.updateDomainPort({
            serviceDomainId: d0.id,
            environmentId: result.environmentId,
            serviceId: app.id,
            domain: d0.domain,
            targetPort: null
          });
          result.steps.push({ step: 'domain', action: 'port_cleared', domain: d0.domain });
        } catch (e) {
          result.steps.push({
            step: 'domain',
            action: 'port_fix_skipped',
            error: String(e.message || e).slice(0, 120)
          });
        }
      }
      result.steps.push({ step: 'domain', action: 'reused', domain: domains[0].domain });
    }
    const domainHost = domains[0]?.domain;
    const publicUrl = domainHost ? (domainHost.startsWith('http') ? domainHost : `https://${domainHost}`) : null;
    if (publicUrl) {
      result.domain = publicUrl;
      await railway.upsertVariables({
        projectId: result.projectId,
        environmentId: result.environmentId,
        serviceId: app.id,
        variables: {
          SHOP_POS_PUBLIC_URL: publicUrl,
          SHOP_POS_RPC_URL: `${publicUrl}/rpc`,
          SHOP_POS_SYNC_URL: publicUrl
        },
        skipDeploys: true
      });
      updateShopStatus(shopId, { shop_url: publicUrl }, actor);
    }

    // 6) Deploy AFTER all env vars are set so SAAS_SYNC_SECRET is in the running image
    saveJob({
      id: jobId, shop_id: shopId, mode: 'provision', status: 'DEPLOYING',
      plan_json: JSON.stringify(plan), result_json: JSON.stringify(railway.redact(result)), dry_run: 0,
      updated_by: actor?.username
    });
    try {
      const dep = await railway.deployService({
        environmentId: result.environmentId,
        serviceId: app.id
      });
      result.deploymentId = dep.deploymentId;
      result.steps.push({ step: 'deploy', action: 'triggered', id: dep.deploymentId });
      updateShopStatus(shopId, {
        railway_deployment_id: String(dep.deploymentId || ''),
        deployment_status: 'pending'
      }, actor);

      const wait = await railway.waitForDeployment(dep.deploymentId, {
        maxWaitMs: Number(process.env.PROVISION_DEPLOY_WAIT_MS || 10 * 60 * 1000),
        intervalMs: 15000
      });
      result.steps.push({
        step: 'deploy_wait',
        status: wait.status,
        done: wait.done,
        elapsed_ms: wait.elapsed_ms
      });
      if (wait.done && ['FAILED', 'CRASHED', 'REMOVED'].includes(wait.status)) {
        throw new Error('Railway deployment ' + wait.status + ' — check build logs on customer project');
      }
      if (!wait.done) {
        result.steps.push({ step: 'deploy_wait', action: 'still_building', status: wait.status });
      }
    } catch (e) {
      if (/Railway deployment (FAILED|CRASHED|REMOVED)/.test(String(e.message || e))) throw e;
      result.steps.push({ step: 'deploy', action: 'error', error: String(e.message || e).slice(0, 200) });
    }

    // 7) Health check — poll until ready or classify as still-starting
    saveJob({
      id: jobId, shop_id: shopId, mode: 'provision', status: 'HEALTH_CHECK',
      plan_json: JSON.stringify(plan), result_json: JSON.stringify(railway.redact(result)), dry_run: 0,
      updated_by: actor?.username
    });
    updateShopStatus(shopId, { deployment_status: 'pending' }, actor);

    let health = { passed: false, readiness: 'unknown', errors: ['not checked'] };
    if (publicUrl) {
      for (let i = 0; i < HEALTH_MAX_ATTEMPTS; i++) {
        await sleep(HEALTH_INTERVAL_MS);
        health = await healthCheck(publicUrl, shop.id);
        result.health = health;
        result.steps.push({
          step: 'health_poll',
          attempt: i + 1,
          readiness: health.readiness,
          errors: health.errors
        });
        if (health.passed) break;
        // Permanent unhealthy (not starting) after several successes of deploy — keep polling anyway
      }
    }

    if (!health.passed) {
      delete result._syncSecret;
      const stillStarting = health.readiness === 'starting' || health.readiness === 'unreachable';
      const status = stillStarting ? 'WAITING_HEALTH' : 'FAILED';
      const errMsg = stillStarting
        ? 'Application still starting — resources kept. Press Retry to continue health/sync. ' + (health.errors || []).join('; ')
        : 'Health check failed — resources kept for retry. ' + (health.errors || []).join('; ');
      updateShopStatus(shopId, {
        deployment_status: stillStarting ? 'pending' : 'error',
        shop_url: publicUrl || shop.shop_url,
        railway_project_id: result.projectId,
        railway_service_id: result.appServiceId,
        railway_environment_id: result.environmentId
      }, actor);
      saveJob({
        id: jobId, shop_id: shopId, mode: 'provision', status,
        plan_json: JSON.stringify(plan),
        result_json: JSON.stringify(railway.redact(result)),
        error_safe: errMsg.slice(0, 500),
        dry_run: 0,
        updated_by: actor?.username
      });
      audit(actor?.username, stillStarting ? 'provision_waiting_health' : 'provision_failed', shopId, {
        job_id: jobId, error: errMsg.slice(0, 300)
      });
      return {
        success: false,
        error: errMsg,
        data: { job_id: jobId, status, result: railway.redact(result), plan, retryable: true }
      };
    }

    // 8) Entitlement sync — only after deploy has SAAS_SYNC_SECRET and app is healthy
    saveJob({
      id: jobId, shop_id: shopId, mode: 'provision', status: 'SYNCING_ENTITLEMENTS',
      plan_json: JSON.stringify(plan), result_json: JSON.stringify(railway.redact(result)), dry_run: 0,
      updated_by: actor?.username
    });
    try {
      const syncMod = require('./saas-customer-sync');
      let secret = result._syncSecret;
      if (!secret) {
        const resolved = await resolveSyncSecret(
          result.projectId, result.environmentId, result.appServiceId, null
        );
        secret = resolved.secret;
      }
      const freshShop = shops.getShop(shopId).data;
      const snapshot = syncMod.buildSnapshotForShop(shopId);
      const pushed = await syncMod.pushSnapshotToCustomerUrl(publicUrl, secret, snapshot);
      result.steps.push({
        step: 'entitlement_sync',
        action: 'pushed',
        package_id: snapshot.package_id,
        addon_count: (snapshot.addon_ids || []).length
      });
      result.entitlement_sync = { ok: true, package_id: snapshot.package_id };

      // Verify customer accepted snapshot
      let verified = { ok: false, errors: ['not verified'] };
      for (let i = 0; i < 6; i++) {
        await sleep(5000);
        verified = await verifyEntitlementSync(publicUrl, freshShop);
        if (verified.ok) break;
      }
      result.entitlement_verify = {
        ok: verified.ok,
        shop_key: verified.shop_key,
        package_id: verified.package_id,
        flags: verified.flags,
        errors: verified.errors
      };
      result.steps.push({
        step: 'entitlement_verify',
        ok: verified.ok,
        package_id: verified.package_id,
        errors: verified.errors
      });
      if (!verified.ok) {
        throw new Error('Entitlement sync verification failed: ' + (verified.errors || []).join('; '));
      }
    } catch (e) {
      delete result._syncSecret;
      const errMsg = 'Entitlement sync failed — resources kept for retry. ' + String(e.message || e).slice(0, 300);
      result.steps.push({
        step: 'entitlement_sync',
        action: 'error',
        error: String(e.message || e).slice(0, 200)
      });
      updateShopStatus(shopId, {
        deployment_status: 'pending',
        shop_url: publicUrl,
        railway_project_id: result.projectId,
        railway_service_id: result.appServiceId,
        railway_environment_id: result.environmentId
      }, actor);
      saveJob({
        id: jobId, shop_id: shopId, mode: 'provision', status: 'FAILED',
        plan_json: JSON.stringify(plan),
        result_json: JSON.stringify(railway.redact(result)),
        error_safe: errMsg.slice(0, 500),
        dry_run: 0,
        updated_by: actor?.username
      });
      audit(actor?.username, 'provision_sync_failed', shopId, { job_id: jobId, error: errMsg.slice(0, 300) });
      return {
        success: false,
        error: errMsg,
        data: { job_id: jobId, status: 'FAILED', result: railway.redact(result), plan, retryable: true }
      };
    }
    delete result._syncSecret;

    updateShopStatus(shopId, {
      deployment_status: 'online',
      shop_url: publicUrl,
      railway_project_id: result.projectId,
      railway_service_id: result.appServiceId,
      railway_environment_id: result.environmentId
    }, actor);
    saveJob({
      id: jobId, shop_id: shopId, mode: 'provision', status: 'READY',
      plan_json: JSON.stringify(plan), result_json: JSON.stringify(railway.redact(result)), dry_run: 0,
      updated_by: actor?.username
    });
    audit(actor?.username, 'provision_ready', shopId, {
      job_id: jobId, project_id: result.projectId, url: publicUrl
    });
    return { success: true, data: { job_id: jobId, status: 'READY', result: railway.redact(result), plan } };
  } catch (e) {
    delete result._syncSecret;
    const safe = String(e.message || e).slice(0, 500);
    updateShopStatus(shopId, { deployment_status: 'error' }, actor);
    saveJob({
      id: jobId, shop_id: shopId, mode: 'provision', status: 'FAILED',
      plan_json: JSON.stringify(plan),
      result_json: JSON.stringify(railway.redact(result)),
      error_safe: safe,
      dry_run: 0,
      updated_by: actor?.username
    });
    audit(actor?.username, 'provision_failed', shopId, { job_id: jobId, error: safe });
    throw new Error(safe);
  }
}

function status() {
  return {
    success: true,
    phase: 6,
    railway_api_configured: railway.isConfigured(),
    default_dry_run: String(process.env.PROVISION_DEFAULT_DRY_RUN || 'true').toLowerCase() !== 'false',
    github_repo: process.env.PROVISION_GITHUB_REPO || 'maluleke96/shop-pos',
    github_branch: process.env.PROVISION_GITHUB_BRANCH || 'saas-web',
    chisa_project_blocked: railway.CHISA_PROJECT_ID,
    health_max_attempts: HEALTH_MAX_ATTEMPTS,
    health_interval_ms: HEALTH_INTERVAL_MS,
    statuses: STATUSES
  };
}

module.exports = {
  STATUSES,
  ensureSchema,
  dryRun,
  provision,
  healthCheck,
  verifyEntitlementSync,
  getJob,
  listJobs,
  buildPlan,
  slugifyProjectName,
  status
};

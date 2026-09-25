/**
 * Public shop registration applications — Platform Owner approval required.
 * Applicant submits a PENDING application only. No shop, Railway, activation, or login.
 * Lab / Platform Control only. Never Chisa Food.
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');

let platform;
try { platform = require('./platform-control'); } catch (_) { platform = null; }
let shops;
try { shops = require('./platform-shops'); } catch (_) { shops = null; }

const STATUSES = new Set([
  'PENDING',
  'UNDER_REVIEW',
  'MORE_INFORMATION_REQUIRED',
  'APPROVED',
  'REJECTED'
]);

/** Statuses from which approval is allowed */
const APPROVABLE = new Set(['PENDING', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED']);

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function nowIso() { return new Date().toISOString(); }
function uid(prefix = 'app') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}
function refCode() {
  const n = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `APP-${Date.now().toString(36).toUpperCase()}-${n}`;
}

function requireEnabled() {
  if (!platform?.isEnabled?.()) throw new Error('Platform Control is disabled on this deployment');
}

function ensureSchema() {
  dbRun(`
    CREATE TABLE IF NOT EXISTS platform_shop_applications (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      shop_name TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      whatsapp TEXT,
      phone TEXT,
      address TEXT,
      business_type TEXT,
      branches INTEGER DEFAULT 1,
      package_id TEXT,
      package_name TEXT,
      addon_ids_json TEXT DEFAULT '[]',
      addon_names_json TEXT DEFAULT '[]',
      additional_info TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      admin_notes TEXT,
      info_request TEXT,
      shop_id TEXT,
      activation_id TEXT,
      activation_link TEXT,
      provision_job_id TEXT,
      rejected_reason TEXT,
      submitted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewed_by TEXT,
      reviewed_at TEXT,
      approved_by TEXT,
      approved_at TEXT,
      source_ip TEXT,
      user_agent TEXT
    )
  `);
  try { dbRun('CREATE INDEX IF NOT EXISTS idx_psa_status ON platform_shop_applications(status)'); } catch (_) { /* */ }
  try { dbRun('CREATE INDEX IF NOT EXISTS idx_psa_submitted ON platform_shop_applications(submitted_at)'); } catch (_) { /* */ }
}

function audit(actor, action, applicationId, detail) {
  try {
    dbRun(
      `INSERT INTO platform_audit_logs (actor, action, entity_type, entity_id, detail_json, created_at)
       VALUES (?,?,?,?,?,?)`,
      [actor || 'system', action, 'shop_application', applicationId || '', JSON.stringify(detail || {}), nowIso()]
    );
  } catch (_) { /* */ }
}

function assertNotChisa(payload = {}) {
  if (shops?.assertNotChisaFood) {
    shops.assertNotChisaFood({
      shop_name: payload.shop_name,
      owner_name: payload.owner_name,
      owner_email: payload.owner_email,
      notes: payload.additional_info
    });
    return;
  }
  const hay = [
    payload.shop_name, payload.owner_name, payload.owner_email, payload.additional_info
  ].filter(Boolean).join(' ').toLowerCase();
  if (/\bchisa\b|chisafood|chisa.?food/.test(hay)) {
    throw new Error('Chisa Food is protected and cannot be registered via this form');
  }
}

function parseJsonArr(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}

function mapApplication(row) {
  if (!row) return null;
  return {
    id: row.id,
    reference: row.reference,
    shop_name: row.shop_name,
    owner_name: row.owner_name,
    owner_email: row.owner_email,
    whatsapp: row.whatsapp || '',
    phone: row.phone || '',
    address: row.address || '',
    business_type: row.business_type || '',
    branches: Number(row.branches) || 1,
    package_id: row.package_id || null,
    package_name: row.package_name || '',
    addon_ids: parseJsonArr(row.addon_ids_json),
    addon_names: parseJsonArr(row.addon_names_json),
    additional_info: row.additional_info || '',
    status: row.status,
    admin_notes: row.admin_notes || '',
    info_request: row.info_request || '',
    shop_id: row.shop_id || null,
    activation_id: row.activation_id || null,
    activation_link: row.activation_link || null,
    provision_job_id: row.provision_job_id || null,
    rejected_reason: row.rejected_reason || '',
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
    reviewed_by: row.reviewed_by || '',
    reviewed_at: row.reviewed_at || null,
    approved_by: row.approved_by || '',
    approved_at: row.approved_at || null
  };
}

/** Public catalog for the registration form — names/ids only, no secrets. */
function getPublicRegistrationOptions() {
  requireEnabled();
  ensureSchema();
  let packages = [];
  let addons = [];
  try {
    packages = dbAll(
      `SELECT id, name, description, price, currency FROM platform_packages
       WHERE COALESCE(is_active,1) = 1 ORDER BY name`
    ).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      price: p.price,
      currency: p.currency || 'ZAR'
    }));
  } catch (_) { packages = []; }
  try {
    addons = dbAll(
      `SELECT id, name, description, price, currency FROM platform_addons
       WHERE COALESCE(is_active,1) = 1 ORDER BY name`
    ).map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description || '',
      price: a.price,
      currency: a.currency || 'ZAR'
    }));
  } catch (_) { addons = []; }
  return {
    success: true,
    data: {
      packages,
      addons,
      business_types: [
        'Restaurant', 'Takeaway', 'Retail', 'Grocery', 'Butchery',
        'Cafe', 'Bar', 'Franchise', 'Other'
      ],
      notice: 'Submitting this form requests access only. You will not receive login, POS, or shop access until the platform administrator approves your application.'
    }
  };
}

/**
 * Public submit — ALWAYS creates PENDING. Ignores any client status/approved flags.
 */
function submitApplication(raw = {}, meta = {}) {
  requireEnabled();
  ensureSchema();

  // Strip any attempt to self-approve or inject privileged fields
  const data = {
    shop_name: String(raw.shop_name || raw.business_name || '').trim(),
    owner_name: String(raw.owner_name || '').trim(),
    owner_email: String(raw.owner_email || raw.email || '').trim().toLowerCase(),
    whatsapp: String(raw.whatsapp || raw.whatsapp_number || '').trim(),
    phone: String(raw.phone || raw.phone_number || '').trim(),
    address: String(raw.address || raw.business_address || '').trim(),
    business_type: String(raw.business_type || '').trim(),
    branches: Math.max(1, Math.min(999, Number(raw.branches || raw.number_of_branches) || 1)),
    package_id: raw.package_id ? String(raw.package_id).trim() : null,
    addon_ids: Array.isArray(raw.addon_ids) ? raw.addon_ids.map(String) : [],
    additional_info: String(raw.additional_info || raw.notes || '').trim().slice(0, 4000)
  };

  if (!data.shop_name) throw new Error('Business / shop name is required');
  if (!data.owner_name) throw new Error('Owner name is required');
  if (!data.owner_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.owner_email)) {
    throw new Error('A valid email is required');
  }
  if (!data.whatsapp && !data.phone) throw new Error('WhatsApp or phone number is required');
  assertNotChisa(data);

  // Resolve package/addon display names (ignore unknown ids)
  let package_name = '';
  if (data.package_id) {
    try {
      const p = dbGet('SELECT id, name, is_active FROM platform_packages WHERE id = ?', [data.package_id]);
      if (!p || Number(p.is_active) === 0) throw new Error('Selected package is not available');
      package_name = p.name;
    } catch (e) {
      if (/not available/i.test(e.message)) throw e;
      data.package_id = null;
    }
  }
  const addon_names = [];
  const cleanAddonIds = [];
  for (const aid of data.addon_ids) {
    try {
      const a = dbGet('SELECT id, name, is_active FROM platform_addons WHERE id = ?', [aid]);
      if (a && Number(a.is_active) !== 0) {
        cleanAddonIds.push(a.id);
        addon_names.push(a.name);
      }
    } catch (_) { /* */ }
  }

  // Simple anti-spam: same email cannot spam more than 5 PENDING apps in 24h
  try {
    const recent = dbGet(
      `SELECT COUNT(*) AS c FROM platform_shop_applications
       WHERE lower(owner_email) = ? AND status = 'PENDING'
         AND submitted_at >= datetime('now', '-1 day')`,
      [data.owner_email]
    );
    if (Number(recent?.c || 0) >= 5) {
      throw new Error('Too many pending applications from this email. Please wait for review.');
    }
  } catch (e) {
    if (/Too many pending/i.test(e.message)) throw e;
  }

  const id = uid('app');
  const reference = refCode();
  const now = nowIso();
  // Force PENDING — never trust client status
  const status = 'PENDING';

  dbRun(
    `INSERT INTO platform_shop_applications (
      id, reference, shop_name, owner_name, owner_email, whatsapp, phone, address,
      business_type, branches, package_id, package_name, addon_ids_json, addon_names_json,
      additional_info, status, submitted_at, updated_at, source_ip, user_agent
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, reference, data.shop_name, data.owner_name, data.owner_email,
      data.whatsapp, data.phone, data.address, data.business_type, data.branches,
      data.package_id, package_name, JSON.stringify(cleanAddonIds), JSON.stringify(addon_names),
      data.additional_info, status, now, now,
      String(meta.source_ip || '').slice(0, 80),
      String(meta.user_agent || '').slice(0, 240)
    ]
  );

  audit('public', 'shop_application_submitted', id, {
    reference,
    shop_name: data.shop_name,
    owner_email: data.owner_email,
    status,
    // never log secrets — none collected
  });

  return {
    success: true,
    data: {
      reference,
      status: 'PENDING',
      message: 'Your application has been submitted successfully. Your application is now waiting for approval from the platform administrator.',
      // Explicit: no access granted
      access_granted: false,
      shop_id: null,
      activation_link: null
    }
  };
}

function listApplications(filter = {}) {
  requireEnabled();
  ensureSchema();
  let rows = dbAll(
    `SELECT id, reference, shop_name, owner_name, owner_email, whatsapp, phone, address,
            business_type, branches, package_id, package_name, addon_ids_json, addon_names_json,
            additional_info, status, admin_notes, info_request, shop_id, activation_id,
            activation_link, provision_job_id, rejected_reason, submitted_at, updated_at,
            reviewed_by, reviewed_at, approved_by, approved_at
     FROM platform_shop_applications ORDER BY submitted_at DESC`
  );
  const q = String(filter.q || '').trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) =>
      `${r.reference} ${r.shop_name} ${r.owner_name} ${r.owner_email} ${r.phone} ${r.whatsapp} ${r.status}`
        .toLowerCase().includes(q));
  }
  if (filter.status) {
    rows = rows.filter((r) => r.status === String(filter.status).toUpperCase());
  }
  const total = rows.length;
  const limit = Math.min(Math.max(Number(filter.limit) || 50, 1), 200);
  const offset = Math.max(Number(filter.offset) || 0, 0);
  const page = rows.slice(offset, offset + limit).map(mapApplication);
  return { success: true, data: page, total, limit, offset };
}

function getApplication(id) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_shop_applications WHERE id = ? OR reference = ?', [String(id), String(id)]);
  if (!row) throw new Error('Application not found');
  return { success: true, data: mapApplication(row) };
}

function setApplicationStatus(id, nextStatus, actor, opts = {}) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_shop_applications WHERE id = ?', [String(id)]);
  if (!row) throw new Error('Application not found');
  const next = String(nextStatus || '').toUpperCase();
  if (!STATUSES.has(next)) throw new Error('Invalid application status');
  if (next === 'APPROVED') {
    throw new Error('Use approveApplication to approve — status cannot be set to APPROVED directly');
  }
  const prev = row.status;
  const by = actor?.username || 'platform';
  const now = nowIso();
  dbRun(
    `UPDATE platform_shop_applications SET
      status=?, admin_notes=?, info_request=?, rejected_reason=?,
      reviewed_by=?, reviewed_at=?, updated_at=?
     WHERE id=?`,
    [
      next,
      opts.admin_notes != null ? String(opts.admin_notes) : (row.admin_notes || ''),
      opts.info_request != null ? String(opts.info_request) : (row.info_request || ''),
      opts.rejected_reason != null ? String(opts.rejected_reason) : (row.rejected_reason || ''),
      by, now, now, id
    ]
  );
  audit(by, 'shop_application_status_changed', id, {
    reference: row.reference,
    previous: prev,
    next,
    reason: opts.rejected_reason || opts.info_request || opts.admin_notes || null
  });
  return getApplication(id);
}

/**
 * Approve → create shop + provision + entitlements + activation.
 * Server-side only. Never callable without platform session.
 */
async function approveApplication(id, actor, opts = {}) {
  requireEnabled();
  ensureSchema();
  if (!shops?.createShop) throw new Error('Shop service unavailable');

  const row = dbGet('SELECT * FROM platform_shop_applications WHERE id = ?', [String(id)]);
  if (!row) throw new Error('Application not found');
  if (row.status === 'APPROVED' && row.shop_id) {
    return { success: true, data: { ...mapApplication(row), already_approved: true } };
  }
  if (row.status === 'REJECTED') {
    throw new Error('Rejected applications cannot be approved. Ask the applicant to submit a new application.');
  }
  if (!APPROVABLE.has(row.status)) {
    throw new Error(`Cannot approve application in status ${row.status}`);
  }

  assertNotChisa(row);
  const by = actor?.username || 'platform';
  const addonIds = parseJsonArr(row.addon_ids_json);
  let packageId = row.package_id || opts.package_id || null;
  if (!packageId) throw new Error('Application has no package — assign a package before approval');

  // If owner supplies package at approval time, persist it on the application
  if (!row.package_id && opts.package_id) {
    let package_name = '';
    try {
      const p = dbGet('SELECT id, name FROM platform_packages WHERE id = ?', [String(opts.package_id)]);
      if (!p) throw new Error('Package not found');
      package_name = p.name;
      packageId = p.id;
      dbRun('UPDATE platform_shop_applications SET package_id=?, package_name=?, updated_at=? WHERE id=?',
        [packageId, package_name, nowIso(), id]);
      row.package_id = packageId;
      row.package_name = package_name;
    } catch (e) {
      throw new Error(e.message || 'Invalid package for approval');
    }
  }

  // 1) Create platform shop (control-plane record only at this step)
  const created = shops.createShop({
    shop_name: row.shop_name,
    owner_name: row.owner_name,
    owner_email: row.owner_email,
    contact_phone: row.phone || row.whatsapp || '',
    whatsapp: row.whatsapp || row.phone || '',
    address: row.address || '',
    shop_address: row.address || '',
    shop_phone: row.phone || row.whatsapp || '',
    branch_info: row.branches > 1 ? `${row.branches} branches` : '',
    package_id: packageId,
    addon_ids: addonIds,
    subscription_status: 'TRIAL',
    notes: `From application ${row.reference}. ${row.additional_info || ''}`.trim(),
    business_type: row.business_type
  }, actor);
  const shop = created?.data || created;
  const shopId = shop.id;

  // 2) Mark application approved (after shop exists)
  const now = nowIso();
  dbRun(
    `UPDATE platform_shop_applications SET
      status='APPROVED', shop_id=?, approved_by=?, approved_at=?,
      reviewed_by=?, reviewed_at=?, admin_notes=?, updated_at=?
     WHERE id=?`,
    [
      shopId, by, now, by, now,
      opts.admin_notes != null ? String(opts.admin_notes) : (row.admin_notes || ''),
      now, id
    ]
  );
  audit(by, 'shop_application_approved', id, {
    reference: row.reference,
    previous: row.status,
    next: 'APPROVED',
    shop_id: shopId
  });

  let provision = null;
  let provisionError = null;
  let sync = null;
  let activation = null;
  let activationError = null;

  // 3) Provision Railway (ONLY after approval — never on public submit)
  if (opts.skip_provision !== true) {
    try {
      const provisioner = require('./provisioner');
      provision = await provisioner.provision(shopId, actor);
      const provData = provision?.data || provision;
      const jobId = provData?.job_id || null;
      if (jobId) {
        dbRun('UPDATE platform_shop_applications SET provision_job_id=?, updated_at=? WHERE id=?', [jobId, nowIso(), id]);
      }
    } catch (e) {
      provisionError = String(e.message || e).slice(0, 300);
      audit(by, 'shop_application_provision_failed', id, { shop_id: shopId, error: provisionError });
    }
  }

  // 4) Sync entitlements (best-effort; provisioner also syncs when Railway succeeds)
  try {
    if (shops.syncCustomerEntitlements) {
      sync = await shops.syncCustomerEntitlements(shopId);
    }
  } catch (e) {
    sync = { ok: false, error: String(e.message || e).slice(0, 200) };
  }

  // 5) Generate activation link (customer onboarding — not platform login)
  try {
    const cp = require('./platform-control-plane');
    if (cp.createActivation) {
      const publicBase = String(
        opts.public_base_url
        || process.env.PLATFORM_PUBLIC_BASE_URL
        || process.env.SHOP_POS_PUBLIC_URL
        || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
        || ''
      ).replace(/\/$/, '');
      activation = await cp.createActivation(shopId, {
        expires_hours: opts.expires_hours || 72,
        public_base_url: publicBase || undefined,
        notes: `From application ${row.reference}`
      }, actor);
      const act = activation?.data || activation;
      let link = act?.activation_link || null;
      if (!link && act?.link_token) {
        try {
          const refreshed = shops.getShop(shopId)?.data;
          const base = String(refreshed?.shop_url || publicBase || '').replace(/\/$/, '');
          if (base) {
            link = `${base}/activate?token=${encodeURIComponent(act.link_token)}&shop=${encodeURIComponent(shopId)}`;
          }
        } catch (_) { /* */ }
      }
      dbRun(
        `UPDATE platform_shop_applications SET activation_id=?, activation_link=?, updated_at=? WHERE id=?`,
        [act?.id || null, link || null, nowIso(), id]
      );
    }
  } catch (e) {
    activationError = String(e.message || e).slice(0, 300);
    audit(by, 'shop_application_activation_failed', id, { shop_id: shopId, error: activationError });
  }

  const final = getApplication(id).data;
  return {
    success: true,
    data: {
      application: final,
      shop_id: shopId,
      provision: provision || null,
      provision_error: provisionError,
      entitlements_sync: sync,
      activation: activation?.data || activation || null,
      activation_error: activationError,
      next_steps: 'Send the activation link to the customer. They complete T&Cs → signature → device → owner setup → login.'
    }
  };
}

module.exports = {
  STATUSES,
  ensureSchema,
  getPublicRegistrationOptions,
  submitApplication,
  listApplications,
  getApplication,
  setApplicationStatus,
  approveApplication,
  mapApplication
};

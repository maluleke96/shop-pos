const fs = require('fs');
const path = require('path');
const { getDb, getDbPathForBackup } = require('../database/db');
const adminOverride = require('./admin-override');
const { buildFlyerPdf, getFlyer, buildWaUrl } = require('./flyers');
const whatsappSvc = require('./whatsapp');

const HUB_ROLES = ['owner', 'manager', 'assistant_manager', 'marketing_agent'];
const ADMIN_ROLES = ['owner', 'manager'];

function parseShareMode(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) { /* plain string mode */ }
  return { mode: raw };
}

function audit(actorId, actorName, action, entityId, details) {
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId || null, actorName || 'system', action, 'document_hub', entityId || null, details ? JSON.stringify(details) : null);
}

function requireHubRole(actor) {
  const { assertUserActor } = require('./authz');
  return assertUserActor(actor, HUB_ROLES);
}

function isAdmin(actor) {
  try {
    const { assertUserActor } = require('./authz');
    assertUserActor(actor, ADMIN_ROLES);
    return true;
  } catch {
    return false;
  }
}

function getAssetsDir() {
  const destDir = path.join(path.dirname(getDbPathForBackup()), 'assets', 'document-hub');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  return destDir;
}

function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) { /* ignore */ }
}

function fileExists(filePath) {
  if (!filePath) return false;
  const p = String(filePath);
  if (p.startsWith('mobile://') || p.startsWith('mobile-doc://')) return true;
  return fs.existsSync(filePath);
}

function extOf(filePath) {
  return path.extname(String(filePath || '')).toLowerCase();
}

function isImagePath(filePath) {
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extOf(filePath));
}

function mapDocument(row) {
  if (!row) return null;
  return {
    ...row,
    share_config: parseShareMode(row.share_mode)
  };
}

function defaultShareMessage(doc) {
  const shop = getDb().prepare('SELECT shop_name, phone FROM shop_settings WHERE id = 1').get() || {};
  let msg = `📄 ${doc.title}`;
  if (doc.doc_type === 'flyer') msg = `🔥 ${doc.title}\n\nCheck out our latest promotion at ${shop.shop_name || 'our store'}!`;
  if (doc.doc_type === 'menu') msg = `🍽️ ${doc.title}\n\nView our menu at ${shop.shop_name || 'our store'}.`;
  if (shop.phone) msg += `\n📞 ${shop.phone}`;
  return msg;
}

function getDocuments(filters = {}) {
  let sql = `SELECT d.*, u.full_name AS created_by_name
    FROM document_assets d
    LEFT JOIN users u ON u.id = d.created_by
    WHERE 1=1`;
  const params = [];
  if (filters.doc_type) { sql += ' AND d.doc_type = ?'; params.push(filters.doc_type); }
  if (filters.status) { sql += ' AND d.status = ?'; params.push(filters.status); }
  if (filters.branch_id) { sql += ' AND d.branch_id = ?'; params.push(filters.branch_id); }
  if (filters.search) {
    sql += ' AND d.title LIKE ?';
    params.push(`%${filters.search}%`);
  }
  if (filters.source_flyer_id) {
    sql += ' AND d.source_flyer_id = ?';
    params.push(filters.source_flyer_id);
  }
  sql += ' ORDER BY d.updated_at DESC, d.created_at DESC';
  return getDb().prepare(sql).all(...params).map(mapDocument);
}

function getDocument(id) {
  const row = getDb().prepare(`SELECT d.*, u.full_name AS created_by_name
    FROM document_assets d
    LEFT JOIN users u ON u.id = d.created_by
    WHERE d.id = ?`).get(id);
  return mapDocument(row);
}

function saveDocument(data, actor) {
  requireHubRole(actor);
  if (!data.title?.trim()) throw new Error('Title is required');
  if (!data.file_path?.trim()) throw new Error('File is required');
  if (!fileExists(data.file_path)) throw new Error('File not found on disk');

  const db = getDb();
  const docType = ['menu', 'flyer', 'other'].includes(data.doc_type) ? data.doc_type : 'other';
  const status = ['draft', 'published', 'scheduled'].includes(data.status) ? data.status : 'published';
  let thumbnail = data.thumbnail_path || null;
  if (!thumbnail && isImagePath(data.file_path)) thumbnail = data.file_path;

  if (data.id) {
    const existing = getDocument(data.id);
    if (!existing) throw new Error('Document not found');
    if (!isAdmin(actor) && existing.created_by !== actor?.id) {
      throw new Error('You can only edit your own documents');
    }
    db.prepare(`UPDATE document_assets SET title=?, doc_type=?, file_path=?, thumbnail_path=?,
      branch_id=?, status=?, updated_at=datetime('now') WHERE id=?`)
      .run(data.title.trim(), docType, data.file_path.trim(), thumbnail, data.branch_id || null, status, data.id);
    audit(actor?.id, actor?.username, 'update_document', data.id, { title: data.title });
    return getDocument(data.id);
  }

  const r = db.prepare(`INSERT INTO document_assets (title, doc_type, file_path, thumbnail_path, branch_id,
    source_flyer_id, status, created_by) VALUES (?,?,?,?,?,?,?,?)`)
    .run(data.title.trim(), docType, data.file_path.trim(), thumbnail, data.branch_id || null,
      data.source_flyer_id || null, status, actor?.id || null);
  audit(actor?.id, actor?.username, 'create_document', r.lastInsertRowid, { title: data.title, doc_type: docType });
  return getDocument(r.lastInsertRowid);
}

function deleteDocument(id, actor) {
  requireHubRole(actor);
  const doc = getDocument(id);
  if (!doc) throw new Error('Document not found');
  const isOwner = actor?.role === 'owner';
  if (!isAdmin(actor) && doc.created_by !== actor?.id) {
    throw new Error('Only admin can delete documents uploaded by others');
  }
  if (isOwner && doc.created_by && doc.created_by !== actor?.id) {
    const overrideMeta = adminOverride.assertCanModify(actor, doc.created_by, { override_reason: actor?.override_reason });
    adminOverride.logAdminOverride(actor, 'admin_override_delete_document', 'document_hub', id, {
      reason: overrideMeta.reason,
      record_owner_id: doc.created_by,
      title: doc.title
    });
  }
  getDb().prepare('DELETE FROM document_assets WHERE id = ?').run(id);
  if (!doc.source_flyer_id) {
    safeUnlink(doc.file_path);
    if (doc.thumbnail_path && doc.thumbnail_path !== doc.file_path) safeUnlink(doc.thumbnail_path);
  }
  audit(actor?.id, actor?.username, 'delete_document', id, { title: doc.title });
}

function writeFlyerPdfToHub(flyerId, sizeOverride) {
  const pdfBuffer = buildFlyerPdf(flyerId, null, sizeOverride);
  const dir = getAssetsDir();
  const suffix = sizeOverride ? `-${sizeOverride}` : '';
  const filePath = path.join(dir, `flyer-${flyerId}${suffix}.pdf`);
  fs.writeFileSync(filePath, Buffer.from(pdfBuffer));
  return filePath;
}

function pickFlyerThumbnail(flyer) {
  const canvas = flyer?.canvas || {};
  if (canvas.backgroundImage && String(canvas.backgroundImage).startsWith('data:image')) {
    try {
      const match = String(canvas.backgroundImage).match(/^data:image\/(\w+);base64,(.+)$/);
      if (match) {
        const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        const thumbPath = path.join(getAssetsDir(), `flyer-${flyer.id}-thumb.${ext}`);
        fs.writeFileSync(thumbPath, Buffer.from(match[2], 'base64'));
        return thumbPath;
      }
    } catch (_) { /* ignore */ }
  }
  const productImg = (flyer.products || []).map(p => p.picture_path || p.image_path).find(Boolean);
  if (productImg && fs.existsSync(productImg)) return productImg;
  const shop = getDb().prepare('SELECT logo_path FROM shop_settings WHERE id = 1').get();
  if (shop?.logo_path && fs.existsSync(shop.logo_path)) return shop.logo_path;
  return null;
}

function syncFlyerToHub(flyerId, options = {}) {
  const flyer = getFlyer(flyerId);
  if (!flyer) return null;
  const status = flyer.status || 'draft';
  if (!options.force && !['draft', 'scheduled'].includes(status)) return null;

  const db = getDb();
  const filePath = options.file_path && fileExists(options.file_path)
    ? options.file_path
    : writeFlyerPdfToHub(flyerId);
  const thumbnail = options.thumbnail_path || pickFlyerThumbnail(flyer);
  const title = flyer.title || flyer.promotion_name || `Flyer ${flyer.flyer_number || flyerId}`;
  const existing = db.prepare('SELECT id, file_path FROM document_assets WHERE source_flyer_id = ?').get(flyerId);

  if (existing) {
    if (existing.file_path !== filePath && existing.file_path?.includes('document-hub') && fs.existsSync(existing.file_path)) {
      safeUnlink(existing.file_path);
    }
    db.prepare(`UPDATE document_assets SET title=?, doc_type='flyer', file_path=?, thumbnail_path=?,
      branch_id=?, status='published', updated_at=datetime('now') WHERE id=?`)
      .run(title, filePath, thumbnail, flyer.branch_id || null, existing.id);
    return getDocument(existing.id);
  }

  const r = db.prepare(`INSERT INTO document_assets (title, doc_type, file_path, thumbnail_path, branch_id,
    source_flyer_id, status, created_by) VALUES (?,?,?,?,?,?,?,?)`)
    .run(title, 'flyer', filePath, thumbnail, flyer.branch_id || null, flyerId, 'published', flyer.created_by || null);
  audit(flyer.created_by, flyer.created_by_name, 'sync_flyer_to_hub', r.lastInsertRowid, { flyer_id: flyerId });
  return getDocument(r.lastInsertRowid);
}

function logWhatsAppShare({ phone, name, message, actor, branchId, documentId, url, scheduledAt }) {
  const db = getDb();
  const metadata = { url, document_id: documentId, scheduled: !!scheduledAt };
  if (scheduledAt) metadata.execute_at = scheduledAt;
  return db.prepare(`
    INSERT INTO whatsapp_messages (
      recipient_type, recipient_id, recipient_name, phone, message_type, template_id,
      campaign_id, body, status, sender_id, sender_name, branch_id, metadata_json, sent_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    'customer',
    null,
    name || null,
    phone,
    'document_share',
    null,
    null,
    message,
    scheduledAt ? 'pending' : 'pending',
    actor?.id || null,
    actor?.username || actor?.full_name || null,
    branchId || null,
    JSON.stringify(metadata),
    scheduledAt || null
  );
}

function executeShare(doc, options, actor) {
  const mode = options.mode || 'customers';
  const message = options.message?.trim() || defaultShareMessage(doc);
  const settings = whatsappSvc.getWhatsAppSettings();
  const branchId = doc.branch_id || settings.default_branch_id || null;
  const filePath = doc.file_path && fileExists(doc.file_path) ? doc.file_path : null;
  const isImage = filePath ? isImagePath(filePath) : false;
  const attachHint = filePath
    ? (isImage
      ? `\n\n📷 Attach this image in WhatsApp:\n${filePath}`
      : `\n\n📎 Attach this file in WhatsApp:\n${filePath}`)
    : '';
  const fullMessage = `${message}${attachHint}`;
  const results = {
    mode,
    message: fullMessage,
    urls: [],
    group_link: null,
    status_export: null,
    file_path: filePath,
    is_image: isImage,
    open_file: !!filePath
  };

  if (mode === 'group') {
    const groupLink = options.group_link || settings.business_group_link || settings.whatsapp_business_group_link || '';
    if (!groupLink.trim()) throw new Error('WhatsApp business group link is not configured. Add it in Document Hub settings.');
    const helperText = `${fullMessage}\n\nPaste this in your WhatsApp Business group:\n${groupLink}`;
    results.group_link = groupLink.trim();
    results.helper_text = helperText;
    results.urls.push({ type: 'group', url: groupLink.trim(), helper: helperText });
    logWhatsAppShare({
      phone: 'group',
      name: 'WhatsApp Business Group',
      message: helperText,
      actor,
      branchId,
      documentId: doc.id,
      url: groupLink.trim(),
      scheduledAt: options.schedule_at || null
    });
  } else if (mode === 'status') {
    if (!doc.source_flyer_id) throw new Error('Status export is only available for marketing flyers');
    const statusPath = writeFlyerPdfToHub(doc.source_flyer_id, 'whatsapp_status');
    results.status_export = { path: statusPath, width: 1080, height: 1920, label: 'WhatsApp Status' };
    results.file_path = statusPath;
    results.is_image = false;
    results.open_file = true;
    results.urls.push({ type: 'status', path: statusPath });
    logWhatsAppShare({
      phone: 'status',
      name: 'WhatsApp Status',
      message: `${message}\n\nStatus export (1080×1920): ${path.basename(statusPath)}`,
      actor,
      branchId,
      documentId: doc.id,
      url: statusPath,
      scheduledAt: options.schedule_at || null
    });
  } else {
    const phones = Array.isArray(options.phones) ? options.phones.filter(Boolean) : [];
    if (!phones.length) throw new Error('Select at least one customer phone number or enter a WhatsApp number');
    const customers = phones.length
      ? getDb().prepare(`
          SELECT id, name, phone FROM customers
          WHERE phone IN (${phones.map(() => '?').join(',')})
        `).all(...phones)
      : [];
    const phoneMap = new Map(customers.map(c => [c.phone, c]));
    for (const phone of phones) {
      const cust = phoneMap.get(phone) || { name: phone, phone };
      const url = buildWaUrl(phone, fullMessage);
      const ins = logWhatsAppShare({
        phone,
        name: cust.name,
        message: fullMessage,
        actor,
        branchId,
        documentId: doc.id,
        url,
        scheduledAt: options.schedule_at || null
      });
      results.urls.push({ id: ins.lastInsertRowid, phone, name: cust.name, url });
    }
  }

  return results;
}

function shareDocument(id, options = {}, actor) {
  requireHubRole(actor);
  const doc = getDocument(id);
  if (!doc) throw new Error('Document not found');

  const scheduleAt = options.schedule_at || null;
  const isScheduled = scheduleAt && new Date(scheduleAt).getTime() > Date.now();
  const sharePayload = {
    mode: options.mode || 'customers',
    phones: options.phones || [],
    message: options.message || null,
    group_link: options.group_link || null
  };

  if (isScheduled) {
    getDb().prepare(`UPDATE document_assets SET status='scheduled', schedule_at=?, share_mode=?, updated_at=datetime('now') WHERE id=?`)
      .run(scheduleAt, JSON.stringify(sharePayload), id);
    audit(actor?.id, actor?.username, 'schedule_document_share', id, sharePayload);
    return { scheduled: true, schedule_at: scheduleAt, document_id: id, share: sharePayload };
  }

  const results = executeShare(doc, { ...options, schedule_at: null }, actor);
  getDb().prepare(`UPDATE document_assets SET status='published', shared_at=datetime('now'), share_mode=?, schedule_at=NULL, updated_at=datetime('now') WHERE id=?`)
    .run(JSON.stringify(sharePayload), id);
  audit(actor?.id, actor?.username, 'share_document', id, { mode: sharePayload.mode, recipients: results.urls.length });
  return { scheduled: false, ...results, document_id: id };
}

function getScheduledDocuments() {
  return getDocuments({ status: 'scheduled' }).filter(d => d.schedule_at);
}

function processScheduledDocuments(actor = null) {
  const due = getDb().prepare(`
    SELECT * FROM document_assets
    WHERE status = 'scheduled' AND schedule_at IS NOT NULL AND datetime(schedule_at) <= datetime('now')
  `).all();
  const processed = [];
  for (const row of due) {
    const doc = mapDocument(row);
    const cfg = parseShareMode(doc.share_mode) || {};
    try {
      const results = executeShare(doc, {
        mode: cfg.mode || 'customers',
        phones: cfg.phones || [],
        message: cfg.message || null,
        group_link: cfg.group_link || null
      }, actor || { id: doc.created_by, username: 'system', role: 'owner' });
      getDb().prepare(`UPDATE document_assets SET status='published', shared_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
        .run(doc.id);
      processed.push({ id: doc.id, title: doc.title, results });
    } catch (err) {
      processed.push({ id: doc.id, title: doc.title, error: err.message });
    }
  }
  return processed;
}

function exportDocumentStatus(id, actor) {
  requireHubRole(actor);
  const doc = getDocument(id);
  if (!doc?.source_flyer_id) throw new Error('Status export requires a linked marketing flyer');
  const statusPath = writeFlyerPdfToHub(doc.source_flyer_id, 'whatsapp_status');
  return {
    path: statusPath,
    width: 1080,
    height: 1920,
    label: 'WhatsApp Status'
  };
}

module.exports = {
  HUB_ROLES,
  getDocuments,
  getDocument,
  saveDocument,
  deleteDocument,
  syncFlyerToHub,
  shareDocument,
  getScheduledDocuments,
  processScheduledDocuments,
  exportDocumentStatus
};

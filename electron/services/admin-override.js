const { getDb } = require('../database/db');
const { assertUserActor } = require('./authz');

function isOwner(actor) {
  try {
    assertUserActor(actor, ['owner']);
    return true;
  } catch {
    return false;
  }
}

function assertCanModify(actor, recordOwnerId, opts = {}) {
  const ownerId = recordOwnerId != null && recordOwnerId !== '' ? Number(recordOwnerId) : null;
  const actorId = actor?.id != null ? Number(actor.id) : null;
  if (ownerId == null || ownerId === actorId) return { override: false };
  if (isOwner(actor)) {
    const reason = String(opts.override_reason || opts.overrideReason || actor?.override_reason || '').trim();
    if (!reason) throw new Error('Owner override requires a reason when modifying another user\'s record');
    return { override: true, reason, record_owner_id: ownerId };
  }
  throw new Error('Not authorized to modify this record');
}

function logAdminOverride(actor, action, entityType, entityId, meta = {}) {
  getDb().prepare(`
    INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details)
    VALUES (?,?,?,?,?,?)`).run(
    actor?.id || null,
    actor?.username || actor?.full_name || 'system',
    action,
    entityType,
    entityId != null ? entityId : null,
    JSON.stringify({ admin_override: true, ...meta })
  );
}

module.exports = { isOwner, assertCanModify, logAdminOverride };

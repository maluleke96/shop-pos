// Owner override — edit/delete another user's records with audited reason
const AdminOverride = {
  canAdminOverride(user) {
    return user?.role === 'owner';
  },

  ownsRecord(user, recordOwnerId) {
    if (recordOwnerId == null || recordOwnerId === '') return true;
    return Number(user?.id) === Number(recordOwnerId);
  },

  canModify(user, recordOwnerId) {
    return this.ownsRecord(user, recordOwnerId) || this.canAdminOverride(user);
  },

  needsOverrideReason(user, recordOwnerId) {
    return this.canAdminOverride(user) && !this.ownsRecord(user, recordOwnerId);
  },

  confirmAdminOverride(action, recordOwner, recordOwnerName) {
    return new Promise((resolve) => {
      const ownerLabel = recordOwnerName || (recordOwner != null ? `User #${recordOwner}` : 'another user');
      Utils.showModal(`Owner Override — ${action}`, `
        <p>You are <strong>${action.toLowerCase()}</strong> a record created by <strong>${Utils.escHtml?.(ownerLabel) || ownerLabel}</strong>.</p>
        <p class="muted">This action will be logged in the audit trail.</p>
        <div class="field"><label>Reason for override *</label>
          <textarea id="override-reason" rows="3" placeholder="Explain why this override is necessary…"></textarea></div>`,
        '<button class="btn btn-ghost" id="override-cancel">Cancel</button><button class="btn btn-danger" id="override-confirm">Confirm Override</button>');
      document.getElementById('override-cancel')?.addEventListener('click', () => {
        Utils.hideModal();
        resolve(null);
      });
      document.getElementById('override-confirm')?.addEventListener('click', () => {
        const reason = document.getElementById('override-reason')?.value.trim();
        if (!reason) return Utils.toast('Override reason is required', 'error');
        Utils.hideModal();
        resolve(reason);
      });
      document.getElementById('override-reason')?.focus();
    });
  },

  async guardAction(user, action, recordOwnerId, recordOwnerName) {
    if (this.ownsRecord(user, recordOwnerId)) return { ok: true };
    if (!this.canAdminOverride(user)) {
      Utils.toast('You can only modify records you created', 'error');
      return { ok: false };
    }
    const reason = await this.confirmAdminOverride(action, recordOwnerId, recordOwnerName);
    if (!reason) return { ok: false };
    return { ok: true, override_reason: reason };
  },

  actorWithOverride(user, overrideReason) {
    return { ...user, override_reason: overrideReason || undefined };
  }
};
window.AdminOverride = AdminOverride;

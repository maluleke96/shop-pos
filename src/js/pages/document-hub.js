// Document Hub — menus, flyers, and WhatsApp sharing
const DocumentHubPage = {
  documents: [],
  customers: [],
  branches: [],
  settings: {},
  filter: { doc_type: '', status: '' },
  pendingShareId: null,
  pendingFlyerId: null,

  esc(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  isAdmin(app) {
    return ['owner', 'manager'].includes(app.user?.role);
  },

  typeLabel(type) {
    return { menu: 'Menu', flyer: 'Flyer', other: 'Document' }[type] || type;
  },

  statusPill(status) {
    const cls = { draft: 'tag-low', published: 'tag-ok', scheduled: 'tag-warn' }[status] || '';
    return `<span class="tag ${cls}">${status || 'draft'}</span>`;
  },

  async render(el, app) {
    this.app = app;
    if (!['owner', 'manager', 'assistant_manager', 'marketing_agent'].includes(app.user?.role)) {
      el.innerHTML = '<p class="muted">Document Hub is available to owner, manager, assistant manager, and marketing staff.</p>';
      return;
    }

    const [docRes, custRes, brRes, setRes] = await Promise.all([
      API.getDocuments(this.pendingFlyerId ? { source_flyer_id: this.pendingFlyerId } : this.filter),
      API.getCustomers({}),
      API.getBranches(),
      API.getWhatsAppSettings()
    ]);
    this.documents = docRes.data || [];
    this.customers = (custRes.data || []).filter(c => c.phone);
    this.branches = brRes.data || [];
    this.settings = setRes.data || {};

    el.innerHTML = `<div class="page-toolbar">
      <h3>📁 Document Hub</h3>
      <div class="toolbar-actions">
        <button class="btn btn-primary" id="dh-upload-menu">+ Upload Menu</button>
        <button class="btn btn-ghost" id="dh-upload-doc">+ Upload Document</button>
        <button class="btn btn-ghost" id="dh-settings">Settings</button>
      </div>
    </div>
    <div class="page-toolbar" style="margin-top:0">
      <select id="dh-filter-type" class="input-sm">
        <option value="">All types</option>
        <option value="menu">Menus</option>
        <option value="flyer">Flyers</option>
        <option value="other">Other</option>
      </select>
      <select id="dh-filter-status" class="input-sm">
        <option value="">All statuses</option>
        <option value="draft">Draft</option>
        <option value="published">Published</option>
        <option value="scheduled">Scheduled</option>
      </select>
      <span class="muted">${this.documents.length} document(s)</span>
      ${this.pendingFlyerId ? `<button class="btn btn-sm btn-ghost" id="dh-clear-flyer-filter">Show all documents</button>` : ''}
    </div>
    <div id="dh-grid" class="doc-hub-grid"></div>`;

    document.getElementById('dh-filter-type').value = this.filter.doc_type || '';
    document.getElementById('dh-filter-status').value = this.filter.status || '';
    document.getElementById('dh-filter-type').addEventListener('change', (e) => {
      this.filter.doc_type = e.target.value;
      this.render(el, app);
    });
    document.getElementById('dh-filter-status').addEventListener('change', (e) => {
      this.filter.status = e.target.value;
      this.render(el, app);
    });
    document.getElementById('dh-upload-menu').addEventListener('click', () => this.uploadDocument('menu'));
    document.getElementById('dh-upload-doc').addEventListener('click', () => this.uploadDocument('other'));
    document.getElementById('dh-settings').addEventListener('click', () => this.showSettingsModal());
    document.getElementById('dh-clear-flyer-filter')?.addEventListener('click', () => {
      this.pendingFlyerId = null;
      this.render(el, app);
    });

    await this.renderGrid(document.getElementById('dh-grid'));

    if (this.pendingShareId) {
      const shareId = this.pendingShareId;
      this.pendingShareId = null;
      setTimeout(() => this.showShareModal(shareId), 200);
    }
  },

  async renderGrid(container) {
    if (!this.documents.length) {
      container.innerHTML = `<div class="card"><div class="card-body muted" style="text-align:center;padding:40px">
        ${this.pendingFlyerId
          ? 'No documents linked to this campaign yet. Save or export the flyer PDF to add it to Document Hub.'
          : 'No documents yet. Upload a menu or save a marketing flyer — flyers appear here automatically.'}
      </div></div>`;
      return;
    }

    const thumbs = await Promise.all(this.documents.map(async (d) => {
      if (!d.thumbnail_path) return { id: d.id, dataUrl: null };
      const r = await API.getImageDataUrl(d.thumbnail_path);
      return { id: d.id, dataUrl: r.success ? r.dataUrl : null };
    }));
    const thumbMap = new Map(thumbs.map(t => [t.id, t.dataUrl]));

    container.innerHTML = this.documents.map(d => {
      const thumb = thumbMap.get(d.id);
      const preview = thumb
        ? `<img src="${thumb}" alt="" class="doc-hub-thumb">`
        : `<div class="doc-hub-thumb doc-hub-thumb-placeholder">${d.file_path?.endsWith('.pdf') ? '📄 PDF' : '📁 File'}</div>`;
      const canDelete = this.isAdmin(this.app) || d.created_by === this.app.user?.id;
      const needsOverride = AdminOverride.needsOverrideReason(this.app.user, d.created_by);
      return `<div class="doc-hub-card card${this.pendingFlyerId && d.source_flyer_id == this.pendingFlyerId ? ' doc-hub-card-highlight' : ''}" data-id="${d.id}">
        ${preview}
        <div class="doc-hub-card-body">
          <div class="doc-hub-card-title">${this.esc(d.title)}</div>
          <div class="doc-hub-card-meta">
            <span class="tag">${this.typeLabel(d.doc_type)}</span>
            ${this.statusPill(d.status)}
          </div>
          ${d.schedule_at ? `<div class="muted" style="font-size:12px;margin-top:4px">Scheduled: ${d.schedule_at}</div>` : ''}
          ${d.shared_at ? `<div class="muted" style="font-size:12px">Shared: ${d.shared_at}</div>` : ''}
          <div class="doc-hub-card-actions">
            <button class="btn btn-sm btn-primary dh-share" data-id="${d.id}">Share</button>
            <button class="btn btn-sm btn-ghost dh-open" data-id="${d.id}">Open</button>
            ${canDelete ? `<button class="btn btn-sm btn-danger dh-delete" data-id="${d.id}" data-owner="${d.created_by || ''}" data-owner-name="${this.esc(d.created_by_name || '')}" ${needsOverride ? 'title="Owner override — reason required"' : ''}>Delete</button>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('.dh-share').forEach(b => b.addEventListener('click', () =>
      this.showShareModal(parseInt(b.dataset.id, 10))));
    container.querySelectorAll('.dh-open').forEach(b => b.addEventListener('click', async () => {
      const doc = this.documents.find(x => x.id === parseInt(b.dataset.id, 10));
      if (!doc?.file_path) return;
      const r = await API.openPath(doc.file_path);
      if (!r.success) Utils.toast(r.error || 'Could not open file', 'error');
    }));
    container.querySelectorAll('.dh-delete').forEach(b => b.addEventListener('click', async () => {
      let actor = this.app.user;
      const ownerId = b.dataset.owner ? parseInt(b.dataset.owner, 10) : null;
      if (AdminOverride.needsOverrideReason(this.app.user, ownerId)) {
        const guard = await AdminOverride.guardAction(this.app.user, 'Delete Document', ownerId, b.dataset.ownerName || '');
        if (!guard.ok) return;
        actor = AdminOverride.actorWithOverride(this.app.user, guard.override_reason);
      }
      if (!confirm('Delete this document from the hub?')) return;
      const r = await API.deleteDocument(parseInt(b.dataset.id, 10), actor);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Document deleted', 'success');
      this.render(document.getElementById('page-content'), this.app);
    }));
  },

  async uploadDocument(docType) {
    const pick = await API.selectDocument(docType === 'menu' ? 'menu' : 'doc');
    if (!pick.success) {
      if (!pick.cancelled) Utils.toast(pick.error || 'Upload cancelled', 'error');
      return;
    }
    let filePath = pick.path;
    if (String(filePath).startsWith('mobile://')) {
      const persisted = await API.persistMobileDocument(filePath);
      if (!persisted.success) return Utils.toast(persisted.error || 'Could not save document on device', 'error');
      filePath = persisted.path;
    }
    const defaultTitle = pathBasename(pick.path || pick.fileName);
    const title = await this.promptDocumentTitle(defaultTitle);
    if (!title) return;
    const branchId = this.app.activeBranch?.id || this.branches[0]?.id || null;
    const r = await API.saveDocument({
      title,
      doc_type: docType,
      file_path: filePath,
      thumbnail_path: pick.is_image ? filePath : null,
      branch_id: branchId,
      status: 'published'
    }, this.app.user);
    if (!r.success) return Utils.toast(r.error, 'error');
    Utils.toast('Document uploaded', 'success');
    this.render(document.getElementById('page-content'), this.app);
  },

  promptDocumentTitle(defaultTitle) {
    return new Promise((resolve) => {
      Utils.showModal('Document Title', `
        <div class="field"><label>Title *</label>
          <input id="dh-doc-title" value="${this.esc(defaultTitle)}" autofocus></div>`,
        `<button type="button" class="btn btn-ghost" id="dh-doc-cancel">Cancel</button>
         <button type="button" class="btn btn-primary" id="dh-doc-save">Upload</button>`);
      const finish = (value) => { Utils.hideModal(); resolve(value); };
      document.getElementById('dh-doc-cancel')?.addEventListener('click', () => finish(null));
      document.getElementById('dh-doc-save')?.addEventListener('click', () => {
        const value = document.getElementById('dh-doc-title')?.value?.trim();
        if (!value) return Utils.toast('Title required', 'error');
        finish(value);
      });
      document.getElementById('dh-doc-title')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('dh-doc-save')?.click();
      });
    });
  },

  showSettingsModal() {
    const link = this.settings.business_group_link || this.settings.whatsapp_business_group_link || '';
    Utils.showModal('Document Hub Settings', `
      <div class="field full">
        <label>WhatsApp Business Group Invite Link</label>
        <input id="dh-group-link" value="${this.esc(link)}" placeholder="https://chat.whatsapp.com/...">
        <p class="muted" style="margin:8px 0 0">Used when sharing to your business group. Paste the invite link from WhatsApp → Group info.</p>
      </div>`,
      '<button class="btn btn-ghost" id="dh-set-cancel">Cancel</button><button class="btn btn-primary" id="dh-set-save">Save</button>');
    document.getElementById('dh-set-cancel')?.addEventListener('click', () => Utils.hideModal());
    document.getElementById('dh-set-save')?.addEventListener('click', async () => {
      const business_group_link = document.getElementById('dh-group-link').value.trim();
      const r = await API.saveWhatsAppSettings({ business_group_link, whatsapp_business_group_link: business_group_link }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      this.settings = r.data || { business_group_link };
      Utils.hideModal();
      Utils.toast('Settings saved', 'success');
    });
  },

  async showShareModal(docId) {
    const dRes = await API.getDocument(docId);
    if (!dRes.success) return Utils.toast(dRes.error, 'error');
    const doc = dRes.data;
    const defaultMsg = doc.doc_type === 'flyer'
      ? `🔥 ${doc.title}\n\nVisit ${this.app.settings?.shop_name || 'us'} for special deals!`
      : doc.doc_type === 'menu'
        ? `🍽️ ${doc.title}\n\nView our latest menu at ${this.app.settings?.shop_name || 'us'}.`
        : `📄 ${doc.title}`;
    const groupLink = this.settings.business_group_link || this.settings.whatsapp_business_group_link || '';
    const isFlyer = doc.doc_type === 'flyer' || doc.source_flyer_id;

    Utils.showModal(`Share — ${this.esc(doc.title)}`, `
      <div class="campaign-share-modal">
        <div class="field"><label>Message</label>
          <textarea id="dh-share-msg" rows="3">${this.esc(defaultMsg)}</textarea></div>
        ${doc.file_path ? `<div class="campaign-share-section"><h4>Picture / File</h4>
          <p class="muted" style="margin:0 0 8px">Opens the file so you can attach it in WhatsApp (customer chat or business group).</p>
          <button class="btn btn-ghost" id="dh-open-file">📂 Open Picture / File</button>
        </div>` : ''}
        <div class="campaign-share-section"><h4>WhatsApp Business Group</h4>
          <p class="muted" style="margin:0 0 8px">${groupLink ? 'Opens group link, copies message, and opens the picture to attach.' : 'Configure group link in Document Hub → Settings.'}</p>
          <button class="btn btn-ghost" id="dh-share-group" ${groupLink ? '' : 'disabled'}>Share to Business Group</button>
        </div>
        <div class="campaign-share-section"><h4>Customer WhatsApp</h4>
          <div class="field"><label>Or type a WhatsApp number</label>
            <input id="dh-share-phone" placeholder="e.g. 071 234 5678"></div>
          <select id="dh-share-customers" multiple size="6" style="width:100%">
            ${this.customers.map(c => `<option value="${this.esc(c.phone)}">${this.esc(c.name)} (${this.esc(c.phone)})</option>`).join('')}
          </select>
        </div>
        ${isFlyer ? `<div class="campaign-share-section"><h4>WhatsApp Status (1080×1920)</h4>
          <button class="btn btn-ghost" id="dh-export-status">Export Status Size</button></div>` : ''}
        <div class="campaign-share-section"><h4>Schedule or Send Now</h4>
          <div class="field"><label>Schedule (optional)</label>
            <input type="datetime-local" id="dh-share-schedule"></div>
        </div>
      </div>`,
      `<button class="btn btn-ghost" id="dh-share-close">Close</button>
       <button class="btn btn-success" id="dh-share-instant">Send to Customer Inbox</button>
       <button class="btn btn-primary" id="dh-share-schedule-btn">Schedule Share</button>`);

    document.getElementById('dh-share-close')?.addEventListener('click', () => Utils.hideModal());
    document.getElementById('dh-open-file')?.addEventListener('click', async () => {
      if (doc.file_path) await API.openPath(doc.file_path);
    });
    document.getElementById('dh-share-group')?.addEventListener('click', async () => {
      await this.doShare(docId, 'group', []);
    });
    document.getElementById('dh-export-status')?.addEventListener('click', async () => {
      const r = await API.exportDocumentStatus(docId, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      await API.openPath(r.data.path);
      Utils.toast('WhatsApp Status export ready — attach in Status', 'success');
    });
    document.getElementById('dh-share-instant')?.addEventListener('click', async () => {
      const phones = this.selectedPhones();
      const typed = document.getElementById('dh-share-phone')?.value.trim();
      if (typed) phones.push(typed);
      if (!phones.length) return Utils.toast('Select a customer or enter a WhatsApp number', 'error');
      await this.doShare(docId, 'customers', phones, null);
    });
    document.getElementById('dh-share-schedule-btn')?.addEventListener('click', async () => {
      const scheduleAt = document.getElementById('dh-share-schedule')?.value;
      if (!scheduleAt) return Utils.toast('Pick a schedule date and time', 'error');
      const phones = this.selectedPhones();
      const typed = document.getElementById('dh-share-phone')?.value.trim();
      if (typed) phones.push(typed);
      const mode = phones.length ? 'customers' : 'group';
      await this.doShare(docId, mode, phones, new Date(scheduleAt).toISOString());
    });
  },

  selectedPhones() {
    const sel = document.getElementById('dh-share-customers');
    return Array.from(sel?.selectedOptions || []).map(o => o.value).filter(Boolean);
  },

  async doShare(docId, mode, phones, scheduleAt) {
    const message = document.getElementById('dh-share-msg')?.value.trim();
    const r = await API.shareDocument(docId, {
      mode,
      phones,
      message,
      schedule_at: scheduleAt
    }, this.app.user);
    if (!r.success) return Utils.toast(r.error, 'error');

    if (r.data?.scheduled) {
      Utils.hideModal();
      Utils.toast(`Share scheduled for ${scheduleAt}`, 'success');
      this.render(document.getElementById('page-content'), this.app);
      return;
    }

    // Open WhatsApp first, then put the picture on the clipboard last (so paste keeps the image)
    if (mode === 'group' && r.data?.group_link) {
      window.open(r.data.group_link, '_blank');
    } else {
      for (const u of (r.data?.urls || [])) {
        if (u.url) window.open(u.url, '_blank');
      }
    }

    if (r.data?.file_path) {
      // File-on-clipboard (Windows) so paste into WhatsApp attaches the picture
      const clip = r.data.is_image
        ? await API.copyImageToClipboard(r.data.file_path).catch(() => ({ success: false }))
        : { success: false };
      if (!clip?.success) {
        await API.shareNativeFile(r.data.file_path).catch(() => API.openPath(r.data.file_path));
      }
      Utils.toast(
        clip?.success
          ? 'WhatsApp opened — picture is on clipboard; paste (Ctrl+V) into the chat/group'
          : 'WhatsApp opened — attach the opened picture from the file window',
        'success'
      );
    } else {
      Utils.toast('WhatsApp opened (no picture file on this document)', 'error');
    }
    Utils.hideModal();
    this.render(document.getElementById('page-content'), this.app);
  }
};

function pathBasename(p) {
  if (!p) return 'Document';
  const parts = String(p).replace(/\\/g, '/').split('/');
  const base = parts[parts.length - 1] || 'Document';
  return base.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
}

window.DocumentHubPage = DocumentHubPage;

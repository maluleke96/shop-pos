const SettingsPage = {
  async render(el, app) {
    this.app = app;
    const s = app.settings;
    const isOwner = app.user?.role === 'owner';
    const canBackup = ['owner', 'manager'].includes(app.user?.role);
    const pendingNote = !isOwner
      ? `<div class="card" style="margin-bottom:16px;border-color:var(--warning)"><div class="card-body">
          <strong>Approval required</strong>
          <p class="muted" style="margin:4px 0 0">Changes you submit must be approved by an owner or manager in Admin → Settings Approvals before they take effect.</p>
        </div></div>`
      : '';

    el.innerHTML = `
      <div class="page-toolbar"><h3>Settings</h3></div>
      ${pendingNote}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card"><div class="card-header"><h3>Shop Details</h3></div><div class="card-body">
          <div class="form-grid">
            <div class="field full"><label>Shop Name</label><input id="set-name" value="${s?.shop_name || ''}"></div>
            <div class="field"><label>Phone</label><input id="set-phone" value="${s?.phone || ''}"></div>
            <div class="field"><label>Currency</label>
              <select id="set-currency"><option value="R" ${s?.currency === 'R' ? 'selected' : ''}>R (Rand)</option>
              <option value="$" ${s?.currency === '$' ? 'selected' : ''}>$ (Dollar)</option>
              <option value="K" ${s?.currency === 'K' ? 'selected' : ''}>K (Kwacha)</option></select></div>
            <div class="field full"><label>Address</label><input id="set-address" value="${s?.address || ''}"></div>
            <div class="field full"><label>Receipt Footer</label><input id="set-footer" value="${s?.receipt_footer || ''}"></div>
            <div class="field"><label>Tax/VAT %</label><input type="number" id="set-tax" step="0.1" value="${s?.tax_rate || 0}"></div>
            <div class="field"><label>Theme</label>
              <select id="set-theme"><option value="light" ${s?.theme === 'light' ? 'selected' : ''}>Light</option>
              <option value="dark" ${s?.theme === 'dark' ? 'selected' : ''}>Dark</option></select></div>
          </div>
          <button class="btn btn-primary" id="save-settings" style="margin-top:16px">${isOwner ? 'Save Settings' : 'Submit for Admin Approval'}</button>
        </div></div>

        ${canBackup ? `<div class="card"><div class="card-header"><h3>Backup & Restore</h3></div><div class="card-body">
          <p class="muted" style="margin-bottom:16px">Last backup: ${s?.last_backup ? Utils.formatDateTime(s.last_backup) : 'Never'}</p>
          <div style="display:flex;flex-direction:column;gap:8px">
            <button class="btn btn-primary" id="btn-backup">💾 Backup Database</button>
            ${isOwner ? '<button class="btn btn-ghost" id="btn-restore">📂 Restore Database</button>' : ''}
            <button class="btn btn-ghost" id="btn-export">📤 Export Database</button>
          </div>
          <p class="muted" style="margin-top:16px;font-size:12px">All data is stored locally on this computer. No internet required.</p>
        </div></div>` : `<div class="card"><div class="card-body"><p class="muted">Backup & restore is available to managers and owners only.</p></div></div>`}
      </div>`;

    document.getElementById('save-settings').addEventListener('click', async () => {
      const data = {
        shop_name: document.getElementById('set-name').value.trim(),
        phone: document.getElementById('set-phone').value.trim(),
        currency: document.getElementById('set-currency').value,
        address: document.getElementById('set-address').value.trim(),
        receipt_footer: document.getElementById('set-footer').value.trim(),
        tax_rate: parseFloat(document.getElementById('set-tax').value) || 0,
        tax_enabled: parseFloat(document.getElementById('set-tax').value) > 0 ? 1 : 0,
        theme: document.getElementById('set-theme').value
      };
      if (isOwner) {
        await API.saveSettings(data, app.user);
        const res = await API.getSettingsParsed();
        if (res.success) app.settings = res.data;
        app.updateBranding();
        app.applyTheme();
        Utils.toast('Settings saved', 'success');
      } else {
        const r = await API.submitSettingsRequest(data, app.user);
        if (!r.success) return Utils.toast(r.error || 'Could not submit for approval', 'error');
        Utils.toast('Settings submitted — waiting for admin approval in Admin → Settings Approvals', 'success');
      }
    });

    if (canBackup) {
      document.getElementById('btn-backup')?.addEventListener('click', async () => {
        const res = await API.backupCreate(app.user);
        if (res.success) Utils.toast('Backup saved!', 'success');
        else Utils.toast(res.error || 'Backup failed', 'error');
      });
      document.getElementById('btn-restore')?.addEventListener('click', async () => {
        if (confirm('Restore will replace all current data. Continue?')) {
          const res = await API.backupRestore(app.user);
          if (res.success) { Utils.toast('Database restored. Restarting…', 'success'); setTimeout(() => location.reload(), 1500); }
          else Utils.toast(res.error || 'Restore failed', 'error');
        }
      });
      document.getElementById('btn-export')?.addEventListener('click', async () => {
        const res = await API.backupExport(app.user);
        if (res.success) Utils.toast('Database exported!', 'success');
        else Utils.toast(res.error || 'Export failed', 'error');
      });
    }
  }
};
window.SettingsPage = SettingsPage;

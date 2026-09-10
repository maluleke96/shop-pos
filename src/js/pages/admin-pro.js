// Extends AdminPage with professional POS admin sections
(function () {
  if (!window.AdminPage) return;

  const extraSections = [
    { id: 'database', label: '🗄️ Database Manager' },
    { id: 'automation', label: '⚡ Automation Rules' },
    { id: 'customfields', label: '📝 Custom Fields' },
    { id: 'formats', label: '📅 Formats & Numbering' },
    { id: 'developer', label: '🔧 Developer Mode' }
  ];

  if (!AdminPage.sections.some((s) => extraSections.some((e) => e.id === s.id))) {
    AdminPage.sections.push(...extraSections);
  }

  const origRenderSection = AdminPage.renderSection.bind(AdminPage);
  AdminPage.renderSection = async function (el) {
    const extras = {
      database: () => this.renderDatabase(el),
      automation: () => this.renderAutomation(el),
      customfields: () => this.renderCustomFields(el),
      formats: () => this.renderFormats(el),
      developer: () => this.renderDeveloper(el)
    };
    if (extras[this.section]) {
      el.innerHTML = '<p class="muted">Loading…</p>';
      return extras[this.section]();
    }
    return origRenderSection(el);
  };

  const origDevice = AdminPage.renderDevice.bind(AdminPage);
  AdminPage.renderDevice = async function (el) {
    await origDevice(el);
    const ss = this.settings.scanner_settings || {};
    const card = el.querySelector('.card .card-body');
    if (!card || document.getElementById('scan-type')) return;
    const extra = document.createElement('div');
    extra.innerHTML = `<h4 style="margin-top:24px">Barcode Scanner</h4>
      <div class="form-grid">
        <div class="field"><label>Scanner Type</label>
          <select id="scan-type"><option value="usb" ${ss.type==='usb'||!ss.type?'selected':''}>USB Scanner</option>
          <option value="bluetooth" ${ss.type==='bluetooth'?'selected':''}>Bluetooth Scanner</option>
          <option value="camera" ${ss.type==='camera'?'selected':''}>Camera Scanner (Tablet)</option></select></div>
        <div class="field"><label><input type="checkbox" id="scan-enabled" ${ss.enabled!==false?'checked':''}> Scanner enabled</label></div>
        <div class="field"><label><input type="checkbox" id="scan-beep" ${ss.beep_on_scan!==false?'checked':''}> Beep on scan</label></div>
        <div class="field full"><label>Prefix / Suffix (optional)</label><input id="scan-prefix" value="${ss.prefix||''}" placeholder="e.g. *"></div>
      </div>
      <button class="btn btn-ghost" id="save-scanner" style="margin-top:12px">Save Scanner Settings</button>`;
    card.appendChild(extra);
    document.getElementById('save-scanner').addEventListener('click', async () => {
      await API.saveJsonSetting('scanner_settings', {
        type: document.getElementById('scan-type').value,
        enabled: document.getElementById('scan-enabled').checked,
        beep_on_scan: document.getElementById('scan-beep').checked,
        prefix: document.getElementById('scan-prefix').value.trim()
      }, this.app.user);
      Utils.toast('Scanner settings saved', 'success');
    });
  };

  AdminPage.renderDatabase = async function (el) {
    const res = await API.getDatabaseHealth();
    const health = res.data || {};
    el.innerHTML = `<div class="admin-section"><h3>Database Manager</h3>
      <div class="stats-grid">
        <div class="stat-card"><div class="label">Tables</div><div class="value">${health.tables||0}</div></div>
        <div class="stat-card"><div class="label">Size</div><div class="value">${health.sizeMb||0} MB</div></div>
        <div class="stat-card"><div class="label">Integrity</div><div class="value">${health.integrity||'—'}</div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-body">
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <button class="btn btn-primary" id="db-optimize">Optimize Database</button>
          <button class="btn btn-ghost" id="db-repair">Repair / Reindex</button>
          <button class="btn btn-ghost" id="db-recalc">Recalculate Stock</button>
          <button class="btn btn-ghost" id="db-archive">Archive Old Records (1yr)</button>
          <button class="btn btn-warning" id="db-reset">Reset Demo Data</button>
        </div>
        <p class="muted" style="margin-top:12px">Path: ${health.path||'—'}</p>
      </div></div>
      <div class="card" style="margin-top:16px"><div class="card-header"><h3>System Logs</h3></div>
        <div class="card-body" id="db-logs"><p class="muted">Loading…</p></div></div></div>`;

    const logsRes = await API.getSystemLogs(30);
    document.getElementById('db-logs').innerHTML = (logsRes.data||[]).map(l =>
      `<div style="padding:4px 0;border-bottom:1px solid var(--border)"><small class="muted">${Utils.formatDateTime(l.created_at)}</small> [${l.level}] ${l.message}</div>`
    ).join('') || '<p class="muted">No logs</p>';

    document.getElementById('db-optimize').addEventListener('click', async () => { await API.optimizeDatabase(); Utils.toast('Database optimized', 'success'); });
    document.getElementById('db-repair').addEventListener('click', async () => { await API.repairDatabase(); Utils.toast('Database repaired', 'success'); });
    document.getElementById('db-recalc').addEventListener('click', async () => { const r = await API.recalculateStock(); Utils.toast(`Fixed ${r.data?.fixed||0} products`, 'success'); });
    document.getElementById('db-archive').addEventListener('click', async () => { const r = await API.archiveRecords(365); Utils.toast(`Archived ${r.data?.archived||0} records`, 'success'); });
    document.getElementById('db-reset').addEventListener('click', async () => {
      if (confirm('Delete all sales, quotes, lay-byes and reset counters?')) {
        await API.resetDemoData(this.app.user);
        Utils.toast('Demo data reset', 'success');
      }
    });
  };

  AdminPage.renderAutomation = async function (el) {
    const res = await API.getAutomationRules();
    const rules = res.data || [];
    el.innerHTML = `<div class="admin-section"><h3>Automation Rules</h3>
      <p class="muted">Before Sale prompts for a manager PIN. Low Stock and Shift Close create notifications (and a backup reminder on close).</p>
      <button class="btn btn-primary" id="add-rule" style="margin:12px 0">+ Add Rule</button>
      <button class="btn btn-ghost" id="rules-pdf" style="margin:12px 0;margin-left:8px">📄 Save PDF</button>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Trigger</th><th>Active</th><th></th></tr></thead>
        <tbody>${rules.map(r => `<tr><td>${r.name}</td><td>${r.trigger_type}</td><td>${r.is_active?'Yes':'No'}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-ghost edit-rule" data-id="${r.id}">Edit</button>
            <button class="btn btn-sm btn-ghost del-rule" data-id="${r.id}">Delete</button>
          </td></tr>`).join('')||'<tr><td colspan="4" class="muted">No rules yet</td></tr>'}
        </tbody></table></div></div>
      <div class="card" style="margin-top:16px"><div class="card-body"><h4>Example Rules</h4>
        <ul><li>If stock below 10 → show warning</li><li>If sale above R5,000 → require manager approval</li><li>If discount above 20% → require admin PIN</li><li>At closing → remind to backup</li></ul>
      </div></div></div>`;

    const showRuleModal = (rule = null) => {
      let cond = {};
      try { cond = typeof rule?.condition_json === 'string' ? JSON.parse(rule.condition_json) : (rule?.condition || {}); } catch (_) { cond = {}; }
      Utils.showModal(rule ? 'Edit Automation Rule' : 'New Automation Rule', `
        <div class="field"><label>Name</label><input id="ar-name" value="${Utils.escHtml(rule?.name || '')}"></div>
        <div class="field"><label>Trigger</label><select id="ar-trigger">
          <option value="before_sale" ${rule?.trigger_type === 'before_sale' ? 'selected' : ''}>Before Sale</option>
          <option value="low_stock" ${rule?.trigger_type === 'low_stock' ? 'selected' : ''}>Low Stock</option>
          <option value="shift_close" ${rule?.trigger_type === 'shift_close' ? 'selected' : ''}>Shift Close</option></select></div>
        <div class="field"><label>Min Amount (for sales)</label><input type="number" id="ar-min" placeholder="5000" value="${cond.min_amount || ''}"></div>
        <div class="field"><label>Max Discount %</label><input type="number" id="ar-disc" placeholder="20" value="${cond.max_discount_pct || ''}"></div>
        <div class="field"><label>Alert when stock is below</label><input type="number" id="ar-stock" placeholder="10" value="${cond.min_stock ?? ''}"></div>
        <div class="field"><label><input type="checkbox" id="ar-active" ${rule?.is_active !== 0 && rule?.is_active !== false ? 'checked' : ''}> Active</label></div>`,
        '<button class="btn btn-primary" id="save-rule">Save</button>');
      document.getElementById('save-rule').addEventListener('click', async () => {
        const trigger = document.getElementById('ar-trigger').value;
        await API.saveAutomationRule({
          id: rule?.id,
          name: document.getElementById('ar-name').value.trim(),
          trigger_type: trigger,
          condition: {
            min_amount: parseFloat(document.getElementById('ar-min').value) || 0,
            max_discount_pct: parseFloat(document.getElementById('ar-disc').value) || 0,
            min_stock: parseFloat(document.getElementById('ar-stock').value) || 0
          },
          action: { require_manager: trigger === 'before_sale', notify: true },
          is_active: document.getElementById('ar-active').checked
        });
        Utils.hideModal();
        this.renderAutomation(el);
        Utils.toast(rule ? 'Rule updated' : 'Rule saved', 'success');
      });
    };
    document.getElementById('add-rule').addEventListener('click', () => showRuleModal());
    el.querySelectorAll('.edit-rule').forEach((b) => b.addEventListener('click', () => {
      const rule = rules.find((r) => String(r.id) === String(b.dataset.id));
      if (rule) showRuleModal(rule);
    }));
    el.querySelectorAll('.del-rule').forEach(b => b.addEventListener('click', async () => {
      await API.deleteAutomationRule(parseInt(b.dataset.id));
      this.renderAutomation(el);
    }));
    document.getElementById('rules-pdf')?.addEventListener('click', async () => {
      const headers = ['Name', 'Trigger', 'Active', 'Conditions'];
      const rows = rules.map((r) => [
        r.name || '',
        r.trigger_type || '',
        r.is_active ? 'Yes' : 'No',
        JSON.stringify(r.condition || r.conditions || {})
      ]);
      const title = `Automation Rules — ${this.settings?.shop_name || 'Shop'}`;
      if (typeof Export?.toPDF === 'function') {
        await Export.toPDF(`automation-rules-${Utils.today()}.pdf`, title, headers, rows, {
          shop_name: this.settings?.shop_name,
          logo_path: this.settings?.logo_path
        });
      } else {
        Utils.toast('PDF export not available', 'error');
      }
    });
  };

  AdminPage.renderCustomFields = async function (el) {
    const res = await API.getCustomFields('product');
    const fields = res.data || [];
    el.innerHTML = `<div class="admin-section"><h3>Custom Fields</h3>
      <p class="muted">Add extra fields for products — OEM number, size chart, expiry batch, etc.</p>
      <button class="btn btn-primary" id="add-field" style="margin:12px 0">+ Add Field</button>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Label</th><th>Name</th><th>Type</th><th></th></tr></thead>
        <tbody>${fields.map(f => `<tr><td>${f.field_label}</td><td>${f.field_name}</td><td>${f.field_type}</td>
          <td><button class="btn btn-sm btn-ghost del-field" data-id="${f.id}">Delete</button></td></tr>`).join('')||'<tr><td colspan="4" class="muted">No custom fields</td></tr>'}
        </tbody></table></div></div></div>`;

    document.getElementById('add-field').addEventListener('click', () => {
      Utils.showModal('Add Custom Field', `
        <div class="field"><label>Label</label><input id="cf-label" placeholder="OEM Number"></div>
        <div class="field"><label>Field Name</label><input id="cf-name" placeholder="oem_number"></div>
        <div class="field"><label>Type</label><select id="cf-type"><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option></select></div>`,
        '<button class="btn btn-primary" id="save-field">Save</button>');
      document.getElementById('save-field').addEventListener('click', async () => {
        await API.saveCustomField({ entity_type: 'product', field_label: document.getElementById('cf-label').value.trim(), field_name: document.getElementById('cf-name').value.trim(), field_type: document.getElementById('cf-type').value });
        Utils.hideModal();
        this.renderCustomFields(el);
      });
    });
    el.querySelectorAll('.del-field').forEach(b => b.addEventListener('click', async () => {
      await API.deleteCustomField(parseInt(b.dataset.id));
      this.renderCustomFields(el);
    }));
  };

  AdminPage.renderFormats = async function (el) {
    const s = this.settings;
    el.innerHTML = `<div class="admin-section"><h3>Formats & Numbering</h3>
      <div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label>Date Format</label><select id="fmt-date"><option value="DD/MM/YYYY" ${s.date_format==='DD/MM/YYYY'?'selected':''}>DD/MM/YYYY</option><option value="MM/DD/YYYY" ${s.date_format==='MM/DD/YYYY'?'selected':''}>MM/DD/YYYY</option><option value="YYYY-MM-DD" ${s.date_format==='YYYY-MM-DD'?'selected':''}>YYYY-MM-DD</option></select></div>
        <div class="field"><label>Time Format</label><select id="fmt-time"><option value="24h" ${s.time_format==='24h'?'selected':''}>24 hour</option><option value="12h" ${s.time_format==='12h'?'selected':''}>12 hour</option></select></div>
        <div class="field"><label>Invoice Prefix</label><input id="fmt-inv" value="${s.invoice_prefix||'INV'}"></div>
        <div class="field"><label>Quote Prefix</label><input id="fmt-qt" value="${s.quote_prefix||'QT'}"></div>
        <div class="field"><label>Receipt Prefix</label><input id="fmt-rcp" value="${s.receipt_prefix||'RCP'}"></div>
        <div class="field"><label>Currency Position</label><select id="fmt-cur">
          <option value="before" ${s.currency_position!=='after'?'selected':''}>Before (R100)</option>
          <option value="after" ${s.currency_position==='after'?'selected':''}>After (100R)</option>
        </select></div>
      </div>
      <button class="btn btn-primary" id="save-formats" style="margin-top:16px">Save</button>
      </div></div></div>`;
    document.getElementById('save-formats').addEventListener('click', async () => {
      const patch = {
        date_format: document.getElementById('fmt-date').value,
        time_format: document.getElementById('fmt-time').value,
        invoice_prefix: document.getElementById('fmt-inv').value.trim(),
        quote_prefix: document.getElementById('fmt-qt').value.trim(),
        receipt_prefix: document.getElementById('fmt-rcp').value.trim(),
        currency_position: document.getElementById('fmt-cur').value
      };
      await API.saveSettings(patch, this.app.user);
      this.settings = { ...this.settings, ...patch };
      if (this.app) this.app.settings = { ...this.app.settings, ...patch };
      Utils.toast('Format settings saved', 'success');
    });
  };

  AdminPage.renderDeveloper = async function (el) {
    const res = await API.getDeveloperInfo(this.app.user);
    const info = res.data || {};
    el.innerHTML = `<div class="admin-section"><h3>Developer Mode</h3>
      <p class="muted">Local license flag only — it does not unlock cloud or phone sync. Shop POS runs fully without a key.</p>
      <div class="stats-grid" style="margin-top:16px">
        <div class="stat-card"><div class="label">Version</div><div class="value">${info.version||'1.1.0'}</div></div>
        <div class="stat-card"><div class="label">License</div><div class="value">${info.license?.status||'trial'}</div></div>
        <div class="stat-card"><div class="label">Device ID</div><div class="value" style="font-size:12px">${info.device?.device_id||'—'}</div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-body">
        <div class="field"><label>License Key</label><input id="dev-key" placeholder="Enter license key"></div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-primary" id="dev-activate">Activate</button>
          <button class="btn btn-ghost" id="dev-trial">Reset Trial</button>
        </div>
      </div></div>
      <div class="card" style="margin-top:16px"><div class="card-header"><h3>Recent Logs</h3></div>
        <div class="card-body">${(info.logs||[]).map(l => `<div style="padding:4px 0"><small>${l.created_at}</small> ${l.message}</div>`).join('')||'No logs'}</div></div></div>`;

    document.getElementById('dev-activate').addEventListener('click', async () => {
      const r = await API.activateLicense(document.getElementById('dev-key').value.trim(), this.app.user);
      Utils.toast(r.success ? 'License activated!' : r.error, r.success ? 'success' : 'error');
    });
    document.getElementById('dev-trial').addEventListener('click', async () => {
      if (confirm('Reset trial period?')) { await API.resetTrial(this.app.user); Utils.toast('Trial reset', 'success'); }
    });
  };
})();

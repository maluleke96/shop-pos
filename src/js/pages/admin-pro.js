// Extends AdminPage with professional POS admin sections
(function () {
  if (!window.AdminPage) return;

  const extraSections = [
    { id: 'database', label: '🗄️ Database Manager' },
    { id: 'system-health', label: '🩺 System Health · Database & Storage' },
    { id: 'automation', label: '⚡ Automation Rules' },
    { id: 'customfields', label: '📝 Custom Fields' },
    { id: 'formats', label: '📅 Formats & Numbering' },
    { id: 'developer', label: '🔧 Developer Mode' }
  ];

  for (const e of extraSections) {
    if (!AdminPage.sections.some((s) => s.id === e.id)) {
      if (e.id === 'system-health') {
        const dbIdx = AdminPage.sections.findIndex((s) => s.id === 'database');
        if (dbIdx >= 0) AdminPage.sections.splice(dbIdx + 1, 0, e);
        else AdminPage.sections.push(e);
      } else {
        AdminPage.sections.push(e);
      }
    }
  }

  function _storageBarHtml(percent, statusLevel) {
    const pct = percent == null || Number.isNaN(Number(percent)) ? null : Math.max(0, Math.min(100, Number(percent)));
    const fill = pct == null ? 0 : pct;
    const color = statusLevel === 'critical' || statusLevel === 'high' ? '#dc2626'
      : statusLevel === 'warning' ? '#ea580c' : '#16a34a';
    const label = pct == null ? 'Unavailable' : `${pct}%`;
    return `<div class="storage-bar" style="margin:10px 0 4px">
      <div style="height:18px;background:#e2e8f0;border-radius:999px;overflow:hidden;position:relative">
        <div style="height:100%;width:${fill}%;background:${color};transition:width .25s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:4px">
        <span class="muted">Storage usage</span><strong>${label}</strong>
      </div>
    </div>`;
  }

  function _growthSvg(history) {
    const pts = (history || []).filter((h) => h.database_size_bytes != null);
    if (pts.length < 2) {
      return '<p class="muted">Not enough historical measurements yet for a growth graph. Use Refresh Now over several days to build history.</p>';
    }
    const w = 560;
    const h = 140;
    const pad = 16;
    const xs = pts.map((_, i) => pad + (i * (w - pad * 2)) / Math.max(1, pts.length - 1));
    const vals = pts.map((p) => Number(p.database_size_bytes) || 0);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = Math.max(1, max - min);
    const ys = vals.map((v) => h - pad - ((v - min) / span) * (h - pad * 2));
    const poly = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
    const first = pts[0];
    const last = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="140" role="img" aria-label="Database growth">
      <polyline fill="none" stroke="#2563eb" stroke-width="2.5" points="${poly}" />
      ${xs.map((x, i) => `<circle cx="${x}" cy="${ys[i]}" r="3" fill="#1d4ed8" />`).join('')}
      <text x="${pad}" y="${h - 2}" font-size="10" fill="#64748b">${Utils.escHtml(String(first.recorded_at || '').slice(0, 10))}</text>
      <text x="${w - pad}" y="${h - 2}" font-size="10" fill="#64748b" text-anchor="end">${Utils.escHtml(String(last.recorded_at || '').slice(0, 10))}</text>
    </svg>
    <p class="muted" style="margin:4px 0 0;font-size:12px">${Utils.escHtml(first.database_size_pretty)} → ${Utils.escHtml(last.database_size_pretty)}</p>`;
  }

  AdminPage.renderSystemHealthStorage = async function (el, opts = {}) {
    const page = Number(opts.page) || 1;
    el.innerHTML = `<div class="admin-section"><h3>System Health · Database &amp; Storage</h3>
      <p class="muted">Loading storage metrics…</p></div>`;

    const res = await API.getStorageMonitor({ refresh: !!opts.refresh, page, pageSize: 25 }, this.app?.user);
    const data = res?.data;
    if (!res?.success || !data || data.success === false) {
      el.innerHTML = `<div class="admin-section"><h3>System Health · Database &amp; Storage</h3>
        <div class="card"><div class="card-body">
          <p><strong>Storage information temporarily unavailable.</strong></p>
          <p class="muted">${Utils.escHtml(data?.detail || data?.error || res?.error || 'Could not read database statistics.')}</p>
          <button type="button" class="btn btn-primary" id="sh-retry">Retry</button>
        </div></div></div>`;
      document.getElementById('sh-retry')?.addEventListener('click', () => this.renderSystemHealthStorage(el, { refresh: true }));
      return;
    }

    const s = data.summary || {};
    const status = s.status || {};
    const vol = data.railway_volume || {};
    const bar = data.storage_bar || {};
    const pg = data.postgres || {};
    const tables = data.tables || { rows: [], total: 0, page: 1, page_size: 25 };
    const growth = data.growth || {};
    const alerts = data.alerts || [];
    const notes = data.notes || [];
    const totalPages = Math.max(1, Math.ceil((tables.total || 0) / (tables.page_size || 25)));

    const volCard = vol.available
      ? `${Utils.escHtml(vol.used_pretty)} / ${Utils.escHtml(vol.total_pretty)}`
      : 'Unavailable';
    const freeCard = s.free_pretty || 'Unavailable';
    const usageCard = s.percent_used != null ? `${s.percent_used}%` : 'Unavailable';

    el.innerHTML = `<div class="admin-section storage-monitor">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <h3 style="margin:0 0 4px">System Health · Database &amp; Storage</h3>
          <p class="muted" style="margin:0">Live PostgreSQL / Railway storage monitoring. No automatic data deletion.</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="sh-refresh">Refresh Now</button>
          <button type="button" class="btn btn-ghost" id="sh-snapshot">Save snapshot</button>
        </div>
      </div>

      <div class="stats-grid" style="margin-top:16px">
        <div class="stat-card"><div class="label">PostgreSQL</div><div class="value" style="font-size:20px">${Utils.escHtml(s.database_size_pretty || '—')}</div></div>
        <div class="stat-card"><div class="label">Railway Volume</div><div class="value" style="font-size:18px">${volCard}</div></div>
        <div class="stat-card"><div class="label">Free Space</div><div class="value" style="font-size:20px">${Utils.escHtml(freeCard)}</div></div>
        <div class="stat-card"><div class="label">Usage</div><div class="value" style="font-size:20px">${Utils.escHtml(usageCard)}</div></div>
        <div class="stat-card"><div class="label">Database Tables</div><div class="value">${s.table_count ?? '—'}</div></div>
        <div class="stat-card"><div class="label">Status</div><div class="value" style="font-size:18px">${Utils.escHtml((status.emoji || '') + ' ' + (status.label || '—'))}</div></div>
      </div>

      ${alerts.length ? `<div style="margin-top:14px;display:grid;gap:8px">${alerts.map((a) => `
        <div class="card" style="border-left:4px solid ${a.level === 'warning' ? '#ea580c' : '#dc2626'}"><div class="card-body">
          <strong>${Utils.escHtml(a.title)}</strong>
          <p style="margin:6px 0 0">${Utils.escHtml(a.message)}</p>
        </div></div>`).join('')}</div>` : ''}

      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4 style="margin:0 0 8px">PostgreSQL Database</h4>
        <p>Current usage: <strong>${Utils.escHtml(pg.size_pretty || s.database_size_pretty || '—')}</strong></p>
        <p class="muted" style="margin:0">Database: <strong>${Utils.escHtml(pg.database_name || '—')}</strong>
          · Tables: <strong>${pg.table_count ?? '—'}</strong>
          · Indexes: <strong>${pg.index_count ?? '—'}</strong></p>
        <p class="muted" style="margin:8px 0 0">Last checked: <strong>${Utils.escHtml(Utils.formatDateTime?.(data.checked_at) || data.checked_at || '—')}</strong>
          · Engine: ${Utils.escHtml(data.engine || '—')}</p>
      </div></div>

      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4 style="margin:0 0 8px">Railway Volume</h4>
        ${vol.available ? `
          <p>Used: <strong>${Utils.escHtml(vol.used_pretty)}</strong>
            · Allocated: <strong>${Utils.escHtml(vol.total_pretty)}</strong>
            · Free: <strong>${Utils.escHtml(vol.free_pretty)}</strong>
            · Usage: <strong>${vol.percent_used != null ? Math.round(vol.percent_used * 10) / 10 : '—'}%</strong></p>
          <p class="muted" style="margin:0">Source: Railway API (separate from PostgreSQL database size).</p>
        ` : `
          <p><strong>Railway volume metrics unavailable from application</strong></p>
          <p class="muted" style="margin:0">${Utils.escHtml(vol.detail || vol.reason || '')}</p>
        `}
        ${_storageBarHtml(bar.percent_used, bar.status?.level || status.level)}
        <p class="muted" style="font-size:12px;margin:8px 0 0">
          Used ${Utils.escHtml(bar.used_pretty || '—')}
          · Free ${Utils.escHtml(bar.free_pretty || '—')}
          · Total ${Utils.escHtml(bar.total_pretty || '—')}
          ${s.capacity_source ? ` · Capacity source: ${Utils.escHtml(s.capacity_source)}` : ''}
        </p>
      </div></div>

      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4 style="margin:0 0 8px">Database Storage Breakdown</h4>
        <div class="stats-grid">
          <div class="stat-card"><div class="label">Tables</div><div class="value" style="font-size:16px">${Utils.escHtml(data.breakdown?.tables_pretty || 'Unavailable')}</div></div>
          <div class="stat-card"><div class="label">Indexes</div><div class="value" style="font-size:16px">${Utils.escHtml(data.breakdown?.indexes_pretty || 'Unavailable')}</div></div>
          <div class="stat-card"><div class="label">Other</div><div class="value" style="font-size:16px">${Utils.escHtml(data.breakdown?.other_pretty || 'Unavailable')}</div></div>
        </div>
      </div></div>

      <div class="card" style="margin-top:16px"><div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <h3 style="margin:0">Largest tables</h3>
        <span class="muted" style="font-size:12px">Page ${tables.page} / ${totalPages} · ${tables.total} tables</span>
      </div>
      <div class="card-body" style="padding:0">
        <div class="table-wrap"><table>
          <thead><tr><th>Table</th><th>Table size</th><th>Index size</th><th>Total</th></tr></thead>
          <tbody>
            ${(tables.rows || []).map((t) => `<tr>
              <td><strong>${Utils.escHtml(t.table_name)}</strong>${t.row_count != null ? `<div class="muted" style="font-size:11px">${t.row_count} rows</div>` : ''}</td>
              <td>${Utils.escHtml(t.table_pretty || '—')}</td>
              <td>${Utils.escHtml(t.index_pretty || '—')}</td>
              <td>${Utils.escHtml(t.total_pretty || '—')}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="muted">No tables</td></tr>'}
          </tbody>
        </table></div>
        <div style="display:flex;gap:8px;padding:12px;flex-wrap:wrap">
          <button type="button" class="btn btn-ghost btn-sm" id="sh-prev" ${tables.page <= 1 ? 'disabled' : ''}>Previous</button>
          <button type="button" class="btn btn-ghost btn-sm" id="sh-next" ${tables.page >= totalPages ? 'disabled' : ''}>Next</button>
        </div>
      </div></div>

      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4 style="margin:0 0 8px">Database Growth</h4>
        <div class="stats-grid" style="margin-bottom:12px">
          <div class="stat-card"><div class="label">Current</div><div class="value" style="font-size:16px">${Utils.escHtml(s.database_size_pretty || '—')}</div></div>
          <div class="stat-card"><div class="label">Previous snapshot</div><div class="value" style="font-size:16px">${Utils.escHtml(growth.previous_size_pretty || '—')}</div></div>
          <div class="stat-card"><div class="label">Growth 7 days</div><div class="value" style="font-size:16px">${Utils.escHtml(growth.growth_7d_pretty || 'Unavailable')}</div></div>
          <div class="stat-card"><div class="label">Growth 30 days</div><div class="value" style="font-size:16px">${Utils.escHtml(growth.growth_30d_pretty || 'Unavailable')}</div></div>
          <div class="stat-card"><div class="label">Avg daily growth</div><div class="value" style="font-size:16px">${Utils.escHtml(growth.avg_daily_growth_pretty || 'Unavailable')}</div></div>
        </div>
        ${_growthSvg(data.history)}
        ${growth.insufficient_data ? '<p class="muted">Insufficient historical data for reliable averages.</p>' : ''}
      </div></div>

      ${notes.length ? `<div class="card" style="margin-top:16px"><div class="card-body"><h4 style="margin:0 0 8px">Notes</h4>
        <ul style="margin:0;padding-left:18px">${notes.map((n) => `<li class="muted">${Utils.escHtml(n)}</li>`).join('')}</ul>
      </div></div>` : ''}

      <p class="muted" style="margin-top:16px;font-size:12px">Thresholds: warning ${data.thresholds?.warning ?? 70}% · high ${data.thresholds?.high ?? 80}% · critical ${data.thresholds?.critical ?? 90}%. Auto-refresh while this page is open: every 3 minutes.</p>
    </div>`;

    document.getElementById('sh-refresh')?.addEventListener('click', () => {
      this.renderSystemHealthStorage(el, { refresh: true, page: tables.page });
    });
    document.getElementById('sh-snapshot')?.addEventListener('click', async () => {
      const r = await API.recordStorageSnapshot(this.app?.user);
      if (!r?.success) return Utils.toast(r?.error || 'Snapshot failed', 'error');
      Utils.toast(`Snapshot saved · ${r.data?.database_size_pretty || ''}`, 'success');
      this.renderSystemHealthStorage(el, { page: tables.page });
    });
    document.getElementById('sh-prev')?.addEventListener('click', () => {
      this.renderSystemHealthStorage(el, { page: Math.max(1, tables.page - 1) });
    });
    document.getElementById('sh-next')?.addEventListener('click', () => {
      this.renderSystemHealthStorage(el, { page: tables.page + 1 });
    });

    if (this._storageMonitorTimer) clearInterval(this._storageMonitorTimer);
    this._storageMonitorTimer = setInterval(() => {
      if (this.section !== 'system-health') {
        clearInterval(this._storageMonitorTimer);
        this._storageMonitorTimer = null;
        return;
      }
      this.renderSystemHealthStorage(el, { page: tables.page });
    }, 3 * 60 * 1000);
  };

  AdminPage.renderDatabase = async function (el) {
    el.innerHTML = `<div class="admin-section"><h3>Database Manager</h3><p class="muted">Opening…</p></div>`;
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
    el.innerHTML = `<div class="admin-section"><h3>Automation Rules</h3>
      <p class="muted">Before Sale prompts for a manager PIN. Low Stock and Shift Close create notifications (and a backup reminder on close).</p>
      <button class="btn btn-primary" id="add-rule" style="margin:12px 0" disabled>+ Add Rule</button>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Trigger</th><th>Active</th><th></th></tr></thead>
        <tbody><tr><td colspan="4" class="muted">Opening…</td></tr></tbody></table></div></div></div>`;
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
    el.innerHTML = `<div class="admin-section"><h3>Custom Fields</h3><p class="muted">Opening…</p></div>`;
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
    if (!el.querySelector('#dev-activate')) {
      el.innerHTML = `<div class="admin-section"><h3>Developer Mode</h3><p class="muted">Opening…</p></div>`;
    }
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

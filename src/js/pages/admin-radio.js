/**
 * Admin Panel → Radio — matches Connection Radio mockup
 * Public link + Studio open + Staff Access toggles + Broadcast settings
 */
const AdminRadioPage = {
  data: null,
  users: [],
  tab: 'access',

  RADIO_PERMS: [
    { key: 'radio_studio_access', label: 'Radio Studio Access' },
    { key: 'radio_dashboard', label: 'Dashboard' },
    { key: 'radio_music', label: 'Music' },
    { key: 'radio_playlists', label: 'Playlists' },
    { key: 'radio_announcements', label: 'Voice' },
    { key: 'radio_live_mic', label: 'Microphone' },
    { key: 'radio_mixer', label: 'Audio Mixer' },
    { key: 'radio_sfx', label: 'Sound Effects' },
    { key: 'radio_calls', label: 'Live Calls' },
    { key: 'radio_audience', label: 'Audience Chat' },
    { key: 'radio_broadcast', label: 'Live Broadcast' },
    { key: 'radio_social', label: 'Social Broadcasting' },
    { key: 'radio_schedule', label: 'Schedule' },
    { key: 'radio_promotions', label: 'Promotions' },
    { key: 'radio_analytics', label: 'Analytics' },
    { key: 'radio_settings', label: 'Settings' }
  ],

  async render(el, app) {
    this.app = app;
    el.innerHTML = `<div class="admin-section"><h3>📻 Radio</h3><p class="muted">Loading…</p></div>`;
    try {
      const res = await API.radioAdminOverview(app.user);
      if (!res || res.success === false) throw new Error(res?.error || 'Could not load Radio');
      this.data = res.data != null ? res.data : res;
    } catch (err) {
      el.innerHTML = `<div class="admin-section"><h3>📻 Radio</h3>
        <p class="error-msg">${Utils.escHtml(err.message || 'Could not load Radio')}</p></div>`;
      return;
    }
    try {
      const ur = await API.getUsers(app.user);
      this.users = (ur?.data || ur || []).filter((u) => u && u.role !== 'referral_agent');
    } catch (_) {
      this.users = [];
    }
    this.paint(el);
  },

  origin() {
    return (location.origin || '').replace(/\/$/, '');
  },

  parsePerms(user) {
    let p = user?.permissions;
    if (typeof p === 'string') {
      try { p = JSON.parse(p); } catch { p = {}; }
    }
    return p && typeof p === 'object' ? p : {};
  },

  paint(el) {
    const d = this.data || {};
    const st = d.station?.station || {};
    const live = st.status === 'live' || !!d.online;
    const listeners = Number(d.listeners || 0);
    const publicUrl = `${this.origin()}${d.public_path || '/radio/main/'}`;
    const studioUrl = `${this.origin()}${d.studio_path || '/radio-studio/'}`;
    const fancyDomain = 'radio.chisanyamaconnection.co.za';

    el.innerHTML = `
      <div class="admin-section">
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;justify-content:space-between;margin-bottom:14px">
          <div>
            <h2 style="margin:0 0 4px">📻 Chisanyama Connection Radio</h2>
            <p class="muted" style="margin:0">Separate from Menu Builder &amp; Promo Video · Status:
              <strong style="color:${live ? '#ef4444' : 'inherit'}">${live ? '🟢 Online / LIVE' : '🔴 Offline'}</strong>
              · Listeners: <strong>${listeners}</strong>
            </p>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            <a class="btn btn-primary" href="${Utils.escHtml(studioUrl)}" target="_blank" rel="noopener">Open Studio</a>
            <a class="btn btn-ghost" href="${Utils.escHtml(publicUrl)}" target="_blank" rel="noopener">Open Radio Website</a>
          </div>
        </div>

        <div class="card" style="padding:16px;margin-bottom:14px;background:linear-gradient(135deg,rgba(225,29,46,.08),transparent)">
          <h4 style="margin:0 0 8px">📻 RADIO</h4>
          <p style="margin:0 0 6px"><strong>Public Radio Website</strong></p>
          <code style="display:block;padding:10px 12px;background:rgba(0,0,0,.06);border-radius:8px;word-break:break-all">${Utils.escHtml(publicUrl)}</code>
          <p class="muted" style="margin:8px 0 0;font-size:12px">Custom domain later: https://${Utils.escHtml(fancyDomain)}</p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
            <a class="btn btn-primary" href="${Utils.escHtml(publicUrl)}" target="_blank" rel="noopener">Open Radio Website</a>
            <button type="button" class="btn btn-ghost" id="radio-copy-public">Copy Link</button>
            <a class="btn btn-ghost" href="${Utils.escHtml(studioUrl)}" target="_blank" rel="noopener">Open Studio</a>
          </div>
          <p style="margin:14px 0 0">Radio Status: <strong>${live ? '🟢 Online' : '🔴 Offline'}</strong> · Listeners: <strong>${listeners}</strong></p>
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
          ${[['overview', 'Overview'], ['access', 'Staff Access'], ['settings', 'Broadcast Settings']].map(([id, label]) => `
            <button type="button" class="btn ${this.tab === id ? 'btn-primary' : 'btn-ghost'} btn-sm" data-rtab="${id}">${label}</button>
          `).join('')}
        </div>

        <div id="radio-tab-body">${this.tabBody(publicUrl, studioUrl, st)}</div>
      </div>
    `;

    el.querySelectorAll('[data-rtab]').forEach((b) => {
      b.addEventListener('click', () => {
        this.tab = b.dataset.rtab;
        this.paint(el);
      });
    });
    document.getElementById('radio-copy-public')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(publicUrl);
        Utils.toast('Public radio link copied', 'success');
      } catch (_) {
        prompt('Copy public radio link', publicUrl);
      }
    });
    document.getElementById('radio-save-settings')?.addEventListener('click', () => this.saveSettings(el));
    el.querySelectorAll('.radio-perm-toggle').forEach((inp) => {
      inp.addEventListener('change', () => this.togglePerm(inp, el));
    });
  },

  tabBody(publicUrl, studioUrl, st) {
    if (this.tab === 'overview') {
      return `
        <div class="card" style="padding:16px">
          <p><strong>${Utils.escHtml(st.name || 'Connection Radio')}</strong></p>
          <p class="muted">Programme: ${Utils.escHtml(st.programme_title || '—')}</p>
          <p class="muted">Upcoming: ${Utils.escHtml(st.programme_upcoming || '—')}</p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
            <a class="btn btn-primary" href="${Utils.escHtml(studioUrl)}" target="_blank" rel="noopener">Radio Studio</a>
            <a class="btn btn-ghost" href="${Utils.escHtml(publicUrl)}" target="_blank" rel="noopener">Public Website</a>
          </div>
        </div>`;
    }
    if (this.tab === 'settings') {
      return `
        <div class="card" style="padding:16px">
          <h4 style="margin:0 0 8px">Broadcast settings</h4>
          <div class="form-grid">
            <div class="field"><label>Station name</label><input id="radio-name" value="${Utils.escHtml(st.name || '')}"></div>
            <div class="field"><label>Current programme</label><input id="radio-prog" value="${Utils.escHtml(st.programme_title || '')}"></div>
            <div class="field full"><label>Upcoming</label><input id="radio-up" value="${Utils.escHtml(st.programme_upcoming || '')}"></div>
            <div class="field full"><label>Master stream URL (optional)</label><input id="radio-stream" value="${Utils.escHtml(st.stream_url || '')}" placeholder="Icecast / HLS URL — library audio works without this"></div>
            <div class="field"><label>Call-us phone</label><input id="radio-phone" value="${Utils.escHtml(st.call_phone || '')}"></div>
            <div class="field"><label>Telephony provider</label><input id="radio-tel-prov" placeholder="twilio (leave empty if not connected)"></div>
            <div class="field"><label>Telephony API key</label><input id="radio-tel-key" type="password" placeholder="Stored server-side"></div>
            <div class="field"><label><input type="checkbox" id="radio-public-on" checked> Public website enabled</label></div>
          </div>
          <button type="button" class="btn btn-primary" id="radio-save-settings" style="margin-top:12px">Save broadcast settings</button>
        </div>`;
    }

    // Staff Access table (mockup)
    const rows = (this.users || []).filter((u) => u.is_active !== false && u.is_active !== 0);
    return `
      <div class="card" style="padding:16px">
        <h4 style="margin:0 0 6px">Staff Access</h4>
        <p class="muted" style="margin:0 0 12px;font-size:12px">Toggle permissions for existing staff accounts. Owner always has full access. Turning Radio Studio Access OFF revokes active studio sessions.</p>
        <div class="table-wrap" style="overflow:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="text-align:left;border-bottom:1px solid var(--border,#e2e8f0)">
                <th style="padding:8px">Staff</th>
                <th style="padding:8px">Username</th>
                ${this.RADIO_PERMS.map((p) => `<th style="padding:8px;white-space:nowrap">${Utils.escHtml(p.label)}</th>`).join('')}
                <th style="padding:8px">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((u) => {
                const perms = this.parsePerms(u);
                const isOwner = u.role === 'owner';
                return `<tr style="border-bottom:1px solid var(--border,#e2e8f0)">
                  <td style="padding:8px;font-weight:600">${Utils.escHtml(u.full_name || '')}</td>
                  <td style="padding:8px">${Utils.escHtml(u.username || '')}</td>
                  ${this.RADIO_PERMS.map((p) => {
                    const on = isOwner ? true : !!perms[p.key];
                    return `<td style="padding:8px;text-align:center">
                      <input type="checkbox" class="radio-perm-toggle" data-uid="${u.id}" data-key="${p.key}"
                        ${on ? 'checked' : ''} ${isOwner ? 'disabled' : ''}>
                    </td>`;
                  }).join('')}
                  <td style="padding:8px"><span class="tag tag-ok">Active</span></td>
                </tr>`;
              }).join('') || '<tr><td colspan="12" class="muted" style="padding:12px">No staff users found</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;
  },

  async togglePerm(inp, el) {
    const uid = Number(inp.dataset.uid);
    const key = inp.dataset.key;
    const user = this.users.find((u) => Number(u.id) === uid);
    if (!user || user.role === 'owner') return;
    const perms = this.parsePerms(user);
    perms[key] = !!inp.checked;
    // Studio access is required for any radio feature
    if (key !== 'radio_studio_access' && inp.checked) perms.radio_studio_access = true;
    if (key === 'radio_studio_access' && !inp.checked) {
      this.RADIO_PERMS.forEach((p) => { perms[p.key] = false; });
    }
    try {
      const res = await API.updateUser(uid, { permissions: perms }, this.app.user);
      if (!res || res.success === false) throw new Error(res?.error || 'Update failed');
      user.permissions = JSON.stringify(perms);
      Utils.toast('Radio permissions updated', 'success');
      this.paint(el);
    } catch (err) {
      inp.checked = !inp.checked;
      Utils.toast(err.message || 'Could not update', 'error');
    }
  },

  async saveSettings(el) {
    const payload = {
      name: document.getElementById('radio-name')?.value,
      programme_title: document.getElementById('radio-prog')?.value,
      programme_upcoming: document.getElementById('radio-up')?.value,
      stream_url: document.getElementById('radio-stream')?.value,
      call_phone: document.getElementById('radio-phone')?.value,
      telephony_provider: document.getElementById('radio-tel-prov')?.value,
      telephony_api_key: document.getElementById('radio-tel-key')?.value,
      public_enabled: !!document.getElementById('radio-public-on')?.checked
    };
    try {
      const res = await API.radioAdminSaveSettings(payload, this.app.user);
      if (!res || res.success === false) throw new Error(res?.error || 'Save failed');
      this.data = res.data != null ? res.data : res;
      Utils.toast('Radio settings saved', 'success');
      this.paint(el);
    } catch (err) {
      Utils.toast(err.message || 'Could not save', 'error');
    }
  }
};

window.AdminRadioPage = AdminRadioPage;

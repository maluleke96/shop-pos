/**
 * Communication Centre — admin launcher (standalone portal at /communications/)
 */
const AdminCommunicationPage = {
  render(el) {
    const origin = typeof location !== 'undefined' ? location.origin.replace(/\/$/, '') : '';
    const url = `${origin}/communications/`;
    el.innerHTML = `
      <div class="admin-section" style="max-width:720px">
        <h2 style="margin:0 0 8px">📡 Communication Centre</h2>
        <p style="color:var(--text-muted,#64748b);line-height:1.55;margin:0 0 20px">
          Multi-channel messaging platform — SMS, WhatsApp, email &amp; push notifications.
          Campaigns, automations, templates, segmentation, provider management and admin audit logs
          run in the dedicated Communication Centre portal.
        </p>
        <div style="display:grid;gap:12px;margin-bottom:20px">
          <div style="padding:16px;border:1px solid var(--border,#e2e8f0);border-radius:12px;background:var(--card,#fff)">
            <strong>Standalone portal</strong>
            <p style="margin:8px 0 12px;color:var(--text-muted,#64748b);font-size:14px">
              Sign in with portal credentials (created below) or your Admin / Manager shop login.
              Server-side automations continue running when your device is off.
            </p>
            <a href="${url}" target="_blank" rel="noopener" class="btn btn-primary" style="display:inline-block;text-decoration:none">
              Open Communication Centre →
            </a>
            <code style="display:block;margin-top:10px;font-size:12px;word-break:break-all">${url}</code>
          </div>
          <div style="padding:16px;border:1px solid var(--border,#e2e8f0);border-radius:12px;background:var(--card,#fff)">
            <strong>Portal logins</strong>
            <p style="margin:8px 0 0;color:var(--text-muted,#64748b);font-size:14px">
              Create staff usernames &amp; passwords in the portal under <em>Portal Logins</em> (admin only).
            </p>
          </div>
        </div>
      </div>`;
  }
};

window.AdminCommunicationPage = AdminCommunicationPage;

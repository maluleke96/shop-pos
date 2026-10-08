Object.assign(window.AdminPage || (window.AdminPage = {}), {
  async renderCustomerAppAccess(el) {
    const res = await API.getCustomerAccessSettings().catch(() => null);
    const cfg = res?.data || res || { mode: 'full' };
    const canEdit = ['owner', 'manager'].includes(this.app?.user?.role);
    const radio = (value, title, desc) => `<label class="card" style="display:block;padding:12px;margin:6px 0;cursor:pointer;border:2px solid ${cfg.mode === value ? 'var(--primary)' : 'var(--border)'}">
        <input type="radio" name="ca-mode" value="${value}" ${cfg.mode === value ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
        <strong>${title}</strong><div class="muted" style="font-size:12px;margin-left:22px">${desc}</div></label>`;
    const check = (id, on, label, help) => `<label style="display:block;margin:8px 0">
        <input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${canEdit ? '' : 'disabled'}> ${label}
        ${help ? `<div class="muted" style="font-size:12px;margin-left:22px">${help}</div>` : ''}</label>`;

    el.innerHTML = `<div class="admin-section"><h3>Online Orders</h3>
      ${this.onlineOrdersTabsHtml('app-access')}
      <div class="card" style="margin-top:12px"><div class="card-body">
        <h4 style="margin-top:0">📱 CUSTOMER APP ACCESS</h4>
        <p class="muted" style="margin-top:0">Choose how customers sign in to Order Online. All modes use the same customer database — loyalty points, orders and preferences stay on the existing Customer ID.</p>
        ${radio('full', 'Full Registration Required', 'Existing email/phone + password sign-in and registration (current behaviour).')}
        ${radio('phone', 'Simple Phone Access', 'Customers only enter their cellphone number. Existing customers are recognised; new customers give just their name.')}
        ${radio('guest', 'Guest Access', 'Customers can browse without signing in and identify with their phone number at checkout.')}

        <h4 style="margin:18px 0 4px">CUSTOMER IDENTIFICATION</h4>
        ${check('ca-phone-matching', cfg.phone_matching !== false, 'Phone number matching', '082… , 27… and +27… are treated as the same number.')}
        ${check('ca-otp', !!cfg.require_otp, 'Require OTP verification', 'Sends a 4-digit code by WhatsApp (or SMS if configured) before points, orders or personal details are shown.')}
        ${check('ca-allow-new', cfg.allow_new_customers !== false, 'Allow new customer creation', 'Unknown numbers can create a profile with name + phone only.')}
        ${check('ca-guest-order', !!cfg.allow_guest_ordering, 'Allow guest ordering', 'Checkout asks for the cellphone number and attaches the order to the existing customer.')}
        ${check('ca-guest-browse', !!cfg.allow_guest_browsing, 'Allow guest browsing', 'Menu, specials and promotions are visible before signing in.')}
        <div class="field" style="max-width:220px"><label>OTP code expiry (minutes)</label>
          <input type="number" id="ca-otp-exp" min="3" max="30" value="${Number(cfg.otp_expiry_minutes) || 10}" ${canEdit ? '' : 'disabled'}></div>
        <div id="ca-otp-warning" class="muted" style="font-size:12px;padding:8px 10px;border-radius:8px;background:#fef3c7;color:#92400e;margin:8px 0;${cfg.mode !== 'full' && !cfg.require_otp ? '' : 'display:none'}">
          ⚠️ Without OTP, anyone who types a customer's number can see that customer's first name, points and order count. Turn on OTP to verify ownership first.
        </div>
        ${canEdit ? '<button type="button" class="btn btn-primary" id="ca-save">Save access settings</button>' : '<p class="muted">Only owners and managers can change these settings.</p>'}
      </div></div>

      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4 style="margin-top:0">🔎 Customer lookup</h4>
        <p class="muted" style="margin-top:0">Search by name, phone number, customer ID or order/receipt number.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input type="search" id="ca-search" placeholder="e.g. 0821234567, #152, R-000231, Thabo" style="flex:1;min-width:220px;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px">
          <button type="button" class="btn btn-primary" id="ca-search-btn">Search</button>
        </div>
        <div id="ca-results" style="margin-top:12px"></div>
      </div></div>
    </div>`;

    this.bindOnlineOrderTabs(el);
    const refreshWarning = () => {
      const mode = el.querySelector('input[name="ca-mode"]:checked')?.value || 'full';
      const otp = el.querySelector('#ca-otp')?.checked;
      const w = el.querySelector('#ca-otp-warning');
      if (w) w.style.display = mode !== 'full' && !otp ? '' : 'none';
      el.querySelectorAll('input[name="ca-mode"]').forEach((r) => {
        const card = r.closest('label');
        if (card) card.style.borderColor = r.checked ? 'var(--primary)' : 'var(--border)';
      });
    };
    el.querySelectorAll('input[name="ca-mode"], #ca-otp').forEach((i) => i.addEventListener('change', () => {
      const mode = el.querySelector('input[name="ca-mode"]:checked')?.value;
      if (mode === 'guest' && i.name === 'ca-mode') {
        el.querySelector('#ca-guest-order').checked = true;
        el.querySelector('#ca-guest-browse').checked = true;
      }
      refreshWarning();
    }));

    el.querySelector('#ca-save')?.addEventListener('click', async () => {
      const payload = {
        mode: el.querySelector('input[name="ca-mode"]:checked')?.value || 'full',
        phone_matching: el.querySelector('#ca-phone-matching').checked,
        require_otp: el.querySelector('#ca-otp').checked,
        allow_new_customers: el.querySelector('#ca-allow-new').checked,
        allow_guest_ordering: el.querySelector('#ca-guest-order').checked,
        allow_guest_browsing: el.querySelector('#ca-guest-browse').checked,
        otp_expiry_minutes: parseInt(el.querySelector('#ca-otp-exp').value, 10) || 10
      };
      const r = await API.saveCustomerAccessSettings(payload);
      if (r?.success === false) return Utils.toast(r.error || 'Save failed', 'error');
      Utils.toast('Customer app access saved', 'success');
      this.renderCustomerAppAccess(el);
    });

    const runSearch = async () => {
      const q = el.querySelector('#ca-search')?.value.trim();
      const box = el.querySelector('#ca-results');
      if (!q) { box.innerHTML = ''; return; }
      box.innerHTML = '<p class="muted">Searching…</p>';
      const r = await API.customerIdentitySearch(q).catch((err) => ({ success: false, error: err.message }));
      if (r?.success === false) { box.innerHTML = `<p class="muted">${Utils.escHtml(r.error || 'Search failed')}</p>`; return; }
      const rows = r?.data || r || [];
      box.innerHTML = this.customerAccessResultsHtml(Array.isArray(rows) ? rows : []);
    };
    el.querySelector('#ca-search-btn')?.addEventListener('click', runSearch);
    el.querySelector('#ca-search')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
  },

  customerAccessResultsHtml(rows) {
    if (!rows.length) return '<p class="muted">No customers found.</p>';
    const yn = (v) => (v ? '✅' : '—');
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Customer</th><th>Phone</th><th>Customer ID</th><th>Points</th><th>Orders</th><th>Communication</th><th>App account</th></tr></thead>
      <tbody>${rows.map((c) => {
        const comm = c.communication;
        const prefs = c.app?.app_notification_prefs;
        return `<tr>
          <td><strong>${Utils.escHtml(c.name || '—')}</strong>${c.email ? `<br><small class="muted">${Utils.escHtml(c.email)}</small>` : ''}
            ${c.possible_duplicates?.length ? `<br><small style="color:#b45309">⚠️ Same phone as #${c.possible_duplicates.join(', #')}</small>` : ''}</td>
          <td>${Utils.escHtml(c.phone || '—')}${c.phone_normalized && c.phone_normalized !== c.phone ? `<br><small class="muted">${Utils.escHtml(c.phone_normalized)}</small>` : ''}</td>
          <td>#${c.id}</td>
          <td>⭐ ${Math.floor(Number(c.loyalty_points) || 0)}</td>
          <td>${Number(c.orders) || 0}${c.last_order_at ? `<br><small class="muted">Last ${Utils.escHtml(Utils.formatDateTime(c.last_order_at))}</small>` : ''}</td>
          <td style="font-size:12px">${comm
            ? `WhatsApp ${yn(comm.whatsapp_marketing)} · SMS ${yn(comm.sms_marketing)}<br>Email ${yn(comm.email_marketing)} · Promos ${yn(comm.promotions)}`
            : '<span class="muted">No preferences saved</span>'}</td>
          <td style="font-size:12px"><strong>${Utils.escHtml(c.app?.label || 'No app account')}</strong>
            ${c.app?.last_sign_in ? `<br><span class="muted">Last sign-in ${Utils.escHtml(Utils.formatDateTime(c.app.last_sign_in))}</span>` : ''}
            ${prefs ? `<br>App notify: offers ${yn(Number(prefs.special_offers))} · orders ${yn(Number(prefs.order_updates))}` : ''}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }
});

const USER_PERM_KEYS = [
  'sell', 'void_sales', 'refunds', 'discounts', 'change_prices', 'view_reports', 'manage_stock',
  'customers', 'suppliers', 'gift_cards', 'cash_up', 'products', 'reports', 'operations',
  'delete_sales', 'system_settings', 'kitchen', 'quotes', 'layby', 'owner_salary', 'owner_salary_only'
];
const USER_PERM_LABELS = {
  sell: 'Make sales on POS', void_sales: 'Void sales (with supervisor code)', refunds: 'Process returns',
  discounts: 'Apply discounts', change_prices: 'Change prices', view_reports: 'View reports',
  manage_stock: 'Manage stock', customers: 'Manage customers', suppliers: 'Manage suppliers',
  gift_cards: 'Manage gift cards', cash_up: 'Cash-up operations', products: 'Manage products',
  reports: 'Full reports access', operations: 'Stock count & waste', delete_sales: 'Delete sales records',
  system_settings: 'System / admin settings', kitchen: 'Kitchen display', quotes: 'Quotes & lay-bye', layby: 'Lay-bye',
  owner_salary: 'Owner salary — pay & view under Staff tab',
  owner_salary_only: 'Staff tab — Owner Salary only (hide employee portal)'
};

function renderUserTableRows(users, app, onAction) {
  return users.map(u => `<tr>
    <td>${u.full_name}</td><td>${u.username}</td>
    <td>${Utils.roleTag(u.role)}</td>
    <td>${u.is_active ? '<span class="tag tag-ok">Active</span>' : '<span class="tag tag-out">Inactive</span>'}</td>
    <td class="actions" style="white-space:nowrap">
      <button class="btn btn-sm btn-ghost edit-user" data-id="${u.id}">Edit</button>
      ${u.id !== app.user.id && u.is_active ? `<button class="btn btn-sm btn-warning del-user" data-id="${u.id}">Deactivate</button>` : ''}
      ${u.id !== app.user.id && !u.is_active ? `<button class="btn btn-sm btn-primary restore-user" data-id="${u.id}">Restore</button>` : ''}
      ${u.id !== app.user.id ? `<button class="btn btn-sm btn-danger purge-user" data-id="${u.id}">Delete permanently</button>` : ''}
    </td></tr>`).join('');
}

const UsersPage = {
  async render(el, app) {
    this.app = app;
    el.innerHTML = `
      <div class="page-toolbar"><h3>User Management</h3><button class="btn btn-primary" id="add-user">+ Add User</button></div>
      <p class="muted" style="margin:-8px 0 12px">Edit the full user profile, deactivate access, or permanently remove a user from the system.</p>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody id="users-tbody"><tr><td colspan="5" class="muted">Loading users…</td></tr></tbody>
      </table></div></div>`;
    document.getElementById('add-user')?.addEventListener('click', () => this.showForm(null, () => this.render(el, app)));
    const res = await API.getUsers(app.user);
    if (!res.success) {
      document.getElementById('users-tbody').innerHTML = `<tr><td colspan="5" class="error-msg">${Utils.escHtml(res.error || 'Failed to load users')}</td></tr>`;
      return;
    }
    this.users = res.data || [];
    const active = this.users.filter(u => u.is_active);
    const inactive = this.users.filter(u => !u.is_active);

    el.innerHTML = `
      <div class="page-toolbar"><h3>User Management</h3><button class="btn btn-primary" id="add-user">+ Add User</button></div>
      <p class="muted" style="margin:-8px 0 12px">Edit the full user profile, deactivate access, or permanently remove a user from the system.</p>
      <h4 style="margin:16px 0 8px">Active Users</h4>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>${renderUserTableRows(active, app) || '<tr><td colspan="5" class="muted">No active users</td></tr>'}</tbody>
      </table></div></div>
      <h4 style="margin:20px 0 8px">Inactive Users</h4>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>${renderUserTableRows(inactive, app) || '<tr><td colspan="5" class="muted">No inactive users</td></tr>'}</tbody>
      </table></div></div>`;

    document.getElementById('add-user').addEventListener('click', () =>
      this.showForm(null, () => this.render(el, app)));
    el.querySelectorAll('.edit-user').forEach(b => b.addEventListener('click', () =>
      this.showForm(this.users.find(u => u.id == b.dataset.id), () => this.render(el, app))));
    el.querySelectorAll('.del-user').forEach(b => b.addEventListener('click', () =>
      this.deactivateUser(this.users.find(u => u.id == b.dataset.id), () => this.render(el, app))));
    el.querySelectorAll('.purge-user').forEach(b => b.addEventListener('click', () =>
      this.permanentlyDeleteUser(this.users.find(u => u.id == b.dataset.id), () => this.render(el, app))));
    el.querySelectorAll('.restore-user').forEach(b => b.addEventListener('click', async () => {
      const id = parseInt(b.dataset.id, 10);
      const r = await API.updateUser(id, { is_active: true }, app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not restore user', 'error');
      Utils.toast('User restored', 'success');
      this.render(el, app);
    }));
  },

  async showForm(user = null, onSaved) {
    const app = this.app;
    const branchesRes = await API.getBranches();
    const branches = branchesRes.data || [];
    let perms = {};
    if (user?.permissions) {
      try { perms = JSON.parse(user.permissions); } catch { perms = {}; }
    }
    const showPerms = !user || ['assistant_manager', 'manager', 'cashier', 'supervisor'].includes(user.role);
    const canGrantRecipe = app.user?.role === 'owner' || app.user?.role === 'manager';
    const editingOwner = user?.role === 'owner';
    let recipeAccess = null;
    if (canGrantRecipe && user?.id && !editingOwner) {
      try {
        const ar = await API.recipeAccessList(app.user);
        if (ar.success) recipeAccess = (ar.data || []).find(a => a.user_id === user.id) || null;
      } catch (_) { /* ignore */ }
    }

    Utils.showModal(user ? `Edit User — ${user.full_name}` : 'Add User', `
      <div class="form-grid">
        <div class="field"><label>Full Name *</label><input id="uf-name" value="${user?.full_name || ''}"></div>
        <div class="field"><label>Username *</label><input id="uf-username" value="${user?.username || ''}" autocomplete="off"></div>
        <div class="field"><label>Password ${user ? '(leave blank to keep)' : '*'}</label><input type="password" id="uf-password" autocomplete="new-password"></div>
        <div class="field"><label>PIN ${user?.has_pin ? '(leave blank to keep)' : '(optional)'}${user?.role === 'manager' || user?.role === 'owner' || user?.role === 'supervisor' ? ' — POS approval' : ''}</label>
          <input type="password" id="uf-pin" maxlength="6" inputmode="numeric" placeholder="6-digit PIN"></div>
        <div class="field"><label>Role</label>
          <select id="uf-role">
            ${app.user?.role === 'owner' ? `<option value="owner" ${user?.role === 'owner' ? 'selected' : ''}>Owner</option>` : ''}
            <option value="manager" ${user?.role === 'manager' ? 'selected' : ''}>Manager</option>
            <option value="assistant_manager" ${user?.role === 'assistant_manager' ? 'selected' : ''}>Assistant Manager</option>
            <option value="supervisor" ${user?.role === 'supervisor' ? 'selected' : ''}>Supervisor</option>
            <option value="marketing_agent" ${user?.role === 'marketing_agent' ? 'selected' : ''}>Marketing Agent</option>
            <option value="cashier" ${user?.role === 'cashier' ? 'selected' : ''}>Cashier</option>
          </select></div>
        <div class="field"><label>Branch</label>
          <select id="uf-branch">
            <option value="">— All branches —</option>
            ${branches.map(b => `<option value="${b.id}" ${user?.branch_id == b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
          </select></div>
        ${user ? `<div class="field full"><label><input type="checkbox" id="uf-active" ${user.is_active ? 'checked' : ''}> Active — can sign in</label></div>
        ${user.has_pin ? '<div class="field full"><label><input type="checkbox" id="uf-clear-pin"> Clear PIN</label></div>' : ''}` : ''}
        ${showPerms ? `<div class="field full" id="uf-perms-wrap"><label>Permissions <span class="muted">(optional — overrides role defaults)</span></label>
          <div style="max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;margin-top:4px">
            ${USER_PERM_KEYS.map(k => `<label style="display:block;padding:3px 0;font-size:13px"><input type="checkbox" class="uf-perm" data-key="${k}" ${perms[k] ? 'checked' : ''}> ${USER_PERM_LABELS[k] || k.replace(/_/g, ' ')}</label>`).join('')}
          </div></div>` : ''}
        ${canGrantRecipe && editingOwner ? `<div class="field full" style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
          <label style="font-weight:600">Recipe &amp; Production Management System</label>
          <p class="muted" style="margin:4px 0 0;font-size:12px">Owner / Admin is not granted access here. Sign in with this username and password on the Recipe login screen.</p>
        </div>` : ''}
        ${canGrantRecipe && !editingOwner ? `<div class="field full" id="uf-recipe-wrap" style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
          <label style="font-weight:600">Recipe &amp; Production Management System</label>
          <p class="muted" style="margin:4px 0 8px;font-size:12px">Grant only for non-owner staff. Owner / Admin uses their POS username and password — no grant needed.</p>
          <label style="display:block;margin-bottom:8px"><input type="checkbox" id="uf-recipe-enabled" ${recipeAccess?.enabled ? 'checked' : ''}> Allow login to Recipe &amp; Production System</label>
          <div class="field"><label>Recipe Role</label>
            <select id="uf-recipe-role">
              <option value="administrator" ${recipeAccess?.recipe_role === 'administrator' ? 'selected' : ''}>Administrator</option>
              <option value="production_manager" ${recipeAccess?.recipe_role === 'production_manager' ? 'selected' : ''}>Production Manager</option>
              <option value="kitchen_manager" ${recipeAccess?.recipe_role === 'kitchen_manager' ? 'selected' : ''}>Kitchen Manager</option>
              <option value="supervisor" ${recipeAccess?.recipe_role === 'supervisor' ? 'selected' : ''}>Supervisor</option>
              <option value="viewer" ${!recipeAccess || recipeAccess?.recipe_role === 'viewer' ? 'selected' : ''}>Viewer</option>
            </select>
          </div>
        </div>` : ''}
      </div>`,
      '<button class="btn btn-primary" id="save-user">Save User</button>');

    const syncRecipeGrantVisibility = () => {
      const wrap = document.getElementById('uf-recipe-wrap');
      if (!wrap) return;
      const role = document.getElementById('uf-role')?.value;
      wrap.style.display = role === 'owner' ? 'none' : '';
    };
    document.getElementById('uf-role')?.addEventListener('change', syncRecipeGrantVisibility);
    syncRecipeGrantVisibility();

    document.getElementById('save-user').addEventListener('click', async () => {
      const data = {
        full_name: document.getElementById('uf-name').value.trim(),
        username: document.getElementById('uf-username').value.trim(),
        role: document.getElementById('uf-role').value,
        branch_id: parseInt(document.getElementById('uf-branch').value, 10) || null
      };
      const password = document.getElementById('uf-password').value;
      const pin = document.getElementById('uf-pin').value;
      if (password) data.password = password;
      if (pin) data.pin = pin;
      const p = {};
      document.querySelectorAll('.uf-perm').forEach(c => { p[c.dataset.key] = c.checked; });
      if (document.querySelectorAll('.uf-perm').length) data.permissions = p;
      if (user) {
        const activeEl = document.getElementById('uf-active');
        if (activeEl) data.is_active = activeEl.checked;
        if (document.getElementById('uf-clear-pin')?.checked) data.clear_pin = true;
      }
      if (!data.full_name) return Utils.toast('Name required', 'error');
      if (!data.username) return Utils.toast('Username required', 'error');
      if (!user && !password) return Utils.toast('Password required for new users', 'error');
      const r = user
        ? await API.updateUser(user.id, data, app.user)
        : await API.createUser({ ...data, password }, app.user);
      if (!r.success) return Utils.toast(r.error || 'Save failed', 'error');

      const recipeEnabledEl = document.getElementById('uf-recipe-enabled');
      if (canGrantRecipe && recipeEnabledEl && data.role !== 'owner') {
        const uid = user?.id || (typeof r.data === 'number' ? r.data : (r.data?.id || r.data?.user?.id));
        if (uid) {
          if (recipeEnabledEl.checked) {
            const ar = await API.recipeSetAccess({
              user_id: uid,
              recipe_role: document.getElementById('uf-recipe-role').value,
              enabled: true
            }, app.user);
            if (!ar.success) Utils.toast(ar.error || 'User saved but Recipe access failed', 'error');
          } else if (recipeAccess?.enabled || recipeAccess) {
            await API.recipeRemoveAccess(uid, app.user);
          }
        }
      }

      Utils.hideModal();
      Utils.toast(user ? 'User updated' : 'User created', 'success');
      if (onSaved) onSaved();
    });
  },

  async deactivateUser(user, onDone) {
    if (!user) return;
    if (!confirm(`Deactivate "${user.full_name}" (${user.username})?\n\nThey will no longer be able to log in. You can restore or permanently delete them later.`)) return;
    const r = await API.deleteUser(user.id, this.app.user);
    if (!r.success) return Utils.toast(r.error || 'Deactivate failed', 'error');
    Utils.toast('User deactivated', 'success');
    if (onDone) onDone();
  },

  async permanentlyDeleteUser(user, onDone) {
    if (!user) return;
    const msg = user.is_active
      ? `PERMANENTLY DELETE "${user.full_name}" (${user.username})?\n\nThis removes the user completely and cannot be undone. Sales history is kept but will no longer show this cashier.\n\nType the username "${user.username}" to confirm:`
      : `PERMANENTLY DELETE "${user.full_name}" (${user.username})?\n\nThis cannot be undone.\n\nType the username "${user.username}" to confirm:`;
    const typed = prompt(msg);
    if (typed === null) return;
    if (typed.trim() !== user.username) {
      Utils.toast('Username did not match — delete cancelled', 'error');
      return;
    }
    const r = await API.permanentlyDeleteUser(user.id, typed.trim(), this.app.user);
    if (!r.success) return Utils.toast(r.error || 'Permanent delete failed', 'error');
    Utils.toast('User permanently deleted', 'success');
    if (onDone) onDone();
  }
};
window.UsersPage = UsersPage;

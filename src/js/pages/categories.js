const CategoriesPage = {
  async render(el, app) {
    this.app = app;
    const res = await API.getCategories();
    this.categories = res.data || [];

    el.innerHTML = `
      <div class="page-toolbar"><h3>Categories</h3><button class="btn btn-primary" id="add-cat">+ Add Category</button></div>
      <p class="muted" style="margin:0 0 12px">Activate/deactivate <strong>Show on POS</strong> to control which category tabs appear at checkout.</p>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Image</th><th>Name</th><th>Color</th><th>Show on POS</th><th></th></tr></thead>
        <tbody>${this.categories.map(c => `<tr>
          <td>${c.image_path ? `<img data-image-path="${c.image_path}" class="cat-thumb">` : '<span class="cat-thumb-placeholder">🏷️</span>'}</td>
          <td><strong>${c.name}</strong></td>
          <td><span style="display:inline-block;width:20px;height:20px;border-radius:4px;background:${c.color}"></span></td>
          <td>${Number(c.show_on_pos) === 0 ? '<span class="tag tag-warn">Hidden</span>' : '<span class="tag tag-success">Active</span>'}</td>
          <td class="actions">
            <button class="btn btn-sm btn-ghost edit-cat" data-id="${c.id}">Edit</button>
            <button class="btn btn-sm btn-ghost toggle-pos-cat" data-id="${c.id}" data-on="${Number(c.show_on_pos) === 0 ? 1 : 0}">
              ${Number(c.show_on_pos) === 0 ? 'Activate on POS' : 'Deactivate on POS'}
            </button>
            <button class="btn btn-sm btn-danger del-cat" data-id="${c.id}">Delete</button>
          </td></tr>`).join('') || '<tr><td colspan="5" class="muted">No categories</td></tr>'}
        </tbody></table></div></div>`;

    document.getElementById('add-cat').addEventListener('click', () => this.showForm());
    document.querySelectorAll('.edit-cat').forEach(b => b.addEventListener('click', () =>
      this.showForm(this.categories.find(c => c.id == b.dataset.id))));
    document.querySelectorAll('.toggle-pos-cat').forEach(b => b.addEventListener('click', async () => {
      const cat = this.categories.find(c => c.id == b.dataset.id);
      if (!cat) return;
      const r = await API.saveCategory({
        id: cat.id, name: cat.name, color: cat.color, image_path: cat.image_path,
        sort_order: cat.sort_order, show_on_pos: Number(b.dataset.on) === 1 ? 1 : 0
      }, app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      CategoriesPage.render(el, app);
      Utils.toast(Number(b.dataset.on) === 1 ? 'Category active on POS' : 'Category hidden from POS', 'success');
    }));
    document.querySelectorAll('.del-cat').forEach(b => b.addEventListener('click', async () => {
      if (confirm('Delete category?')) {
        const r = await API.deleteCategory(parseInt(b.dataset.id), app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        CategoriesPage.render(el, app);
        Utils.toast('Category deleted', 'success');
      }
    }));
    Utils.hydrateImages(el);
  },

  async showForm(cat = null) {
    this.imagePath = cat?.image_path || null;
    Utils.showModal(cat ? 'Edit Category' : 'Add Category', `
      <div class="field"><label>Name *</label><input id="cf-name" value="${cat?.name || ''}"></div>
      <div class="field"><label>Color</label><input type="color" id="cf-color" value="${cat?.color || '#3b82f6'}"></div>
      <div class="field"><label><input type="checkbox" id="cf-show-pos" ${cat && Number(cat.show_on_pos) === 0 ? '' : 'checked'}> Show on POS</label></div>
      <div class="field"><label>Category Image (shows on POS)</label>
        <button type="button" class="btn btn-ghost" id="cf-image-btn">Upload Image</button>
        <div id="cf-image-preview">${cat?.image_path ? '<span class="muted">Loading…</span>' : ''}</div>
      </div>`,
      '<button type="button" class="btn btn-primary" id="save-cat">Save Category</button>');

    document.getElementById('cf-image-btn').addEventListener('click', async () => {
      const r = await API.selectImage('category');
      if (r?.cancelled) return;
      if (!r?.success || !r.path) return Utils.toast(r?.error || 'Could not upload image', 'error');
      this.imagePath = r.path;
      await Utils.setImagePreview('cf-image-preview', r.path, 'max-height:80px;margin-top:8px;border-radius:8px');
    });

    if (this.imagePath) await Utils.setImagePreview('cf-image-preview', this.imagePath, 'max-height:80px;margin-top:8px;border-radius:8px');

    document.getElementById('save-cat').addEventListener('click', async () => {
      const name = document.getElementById('cf-name').value.trim();
      if (!name) return Utils.toast('Name is required', 'error');
      const btn = document.getElementById('save-cat');
      btn.disabled = true;
      const r = await API.saveCategory({
        id: cat?.id, name,
        color: document.getElementById('cf-color').value,
        image_path: this.imagePath,
        show_on_pos: document.getElementById('cf-show-pos')?.checked ? 1 : 0
      }, this.app.user);
      btn.disabled = false;
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      CategoriesPage.render(document.getElementById('page-content'), this.app);
      Utils.toast('Category saved', 'success');
    });
  }
};
window.CategoriesPage = CategoriesPage;

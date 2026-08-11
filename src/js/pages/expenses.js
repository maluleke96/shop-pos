const ExpensesPage = {
  async render(el, app) {
    this.app = app;
    el.innerHTML = `<div class="page-toolbar">
        <h3>Expenses</h3>
        <button class="btn btn-primary" id="add-exp">+ Add Expense</button>
      </div>
      ${Utils.dateFilterHTML('exp-filter')}
      <div id="exp-content"></div>`;
    document.getElementById('add-exp').addEventListener('click', () => this.showForm());
    Utils.bindDateFilter('exp-filter', (from, to) => this.load(from, to));
    this.load(Utils.monthStart(), Utils.today());
  },

  async load(from, to) {
    const res = await API.getExpenses({ from, to });
    if (!res.success) {
      document.getElementById('exp-content').innerHTML = `<p class="muted">${res.error || 'Could not load expenses'}</p>`;
      return;
    }
    this.expenses = res.data || [];
    const currency = this.app.settings?.currency || 'R';
    const total = this.expenses.reduce((s, e) => s + e.amount, 0);

    document.getElementById('exp-content').innerHTML = `
      <p style="margin:12px 0;font-weight:600">Total: ${Utils.formatMoney(total, currency)}</p>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>By</th><th></th></tr></thead>
        <tbody>${this.expenses.map(e => `<tr>
          <td>${Utils.formatDate(e.expense_date)}</td>
          <td><span class="tag">${e.category}</span></td>
          <td>${e.description || '—'}</td>
          <td>${Utils.formatMoney(e.amount, currency)}</td>
          <td>${e.user_name || '—'}</td>
          <td><button class="btn btn-sm btn-danger del-exp" data-id="${e.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No expenses in this period</td></tr>'}
        </tbody></table></div></div>`;

    document.querySelectorAll('.del-exp').forEach(b => b.addEventListener('click', async () => {
      if (confirm('Delete expense?')) {
        await API.deleteExpense(parseInt(b.dataset.id), this.app.user);
        this.load(from, to);
        Utils.toast('Expense deleted', 'success');
      }
    }));
  },

  showForm() {
    const cats = Utils.expenseCategories.map(c => `<option value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('');
    Utils.showModal('Add Expense', `
      <div class="form-grid">
        <div class="field"><label>Category</label><select id="ex-cat">${cats}</select></div>
        <div class="field"><label>Amount *</label><input type="number" id="ex-amount" step="0.01" min="0.01"></div>
        <div class="field"><label>Date</label><input type="date" id="ex-date" value="${Utils.today()}"></div>
        <div class="field full"><label>Description</label><input id="ex-desc"></div>
      </div>`,
      '<button type="button" class="btn btn-primary" id="save-exp">Save Expense</button>');
    document.getElementById('save-exp').addEventListener('click', async () => {
      const amount = parseFloat(document.getElementById('ex-amount').value);
      if (!amount || amount <= 0) return Utils.toast('Amount is required', 'error');
      const r = await API.saveExpense({
        category: document.getElementById('ex-cat').value,
        amount,
        expense_date: document.getElementById('ex-date').value,
        description: document.getElementById('ex-desc').value.trim()
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      const from = document.querySelector('#exp-filter .df-from')?.value || Utils.monthStart();
      const to = document.querySelector('#exp-filter .df-to')?.value || Utils.today();
      this.load(from, to);
      Utils.toast('Expense saved', 'success');
    });
  }
};
window.ExpensesPage = ExpensesPage;

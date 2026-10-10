window.GamesPos = {
  async open(pos) {
    const actor = pos.app?.user;
    const currency = pos.app?.settings?.currency || 'R';
    Utils.showModal('🎮 Games', `
      <div class="field"><label>Search customer</label>
        <input id="games-q" placeholder="Phone, name, email or customer id"></div>
      <div id="games-results"></div>
      <div id="games-customer"></div>`, '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
    const box = document.getElementById('games-results');
    const card = document.getElementById('games-customer');
    const search = async () => {
      const q = document.getElementById('games-q').value.trim();
      if (q.length < 2) { box.innerHTML = ''; return; }
      const res = await API.gamesPosSearch(q, actor);
      if (!res.success) { box.innerHTML = `<p class="error-msg">${Utils.escHtml(res.error || 'Search failed')}</p>`; return; }
      const rows = res.data || [];
      box.innerHTML = rows.map((row) => `<button type="button" class="btn btn-ghost btn-sm" data-id="${row.id}" style="display:block;margin:4px 0">${Utils.escHtml(row.name)} · ${row.points} pts · ${Utils.escHtml(row.phone_masked || '')}</button>`).join('') || '<p class="muted">No customer found</p>';
      box.querySelectorAll('[data-id]').forEach((btn) => btn.addEventListener('click', () => this.show(btn.dataset.id, actor, card, currency)));
    };
    document.getElementById('games-q').addEventListener('input', search);
  },

  async show(id, actor, card, currency) {
    const res = await API.gamesPosCustomer(id, actor);
    if (!res.success) { card.innerHTML = `<p class="error-msg">${Utils.escHtml(res.error || 'Could not open customer')}</p>`; return; }
    const customer = res.data;
    const rewards = (customer.rewards || []).filter((reward) => reward.status === 'UNUSED').map((reward) =>
      `<div style="display:flex;justify-content:space-between;gap:8px;margin:6px 0"><span>${Utils.escHtml(reward.prize_name)} · ${Utils.escHtml(reward.code)}</span><button type="button" class="btn btn-sm btn-primary" data-code="${Utils.escHtml(reward.code)}">Redeem</button></div>`
    ).join('') || '<p class="muted">No rewards waiting</p>';
    card.innerHTML = `<div class="card"><div class="card-body">
      <h3 style="margin-top:0">${Utils.escHtml(customer.name)}</h3>
      <p>Points: <strong>${customer.points}</strong> · Plays: <strong>${customer.available_plays}</strong></p>
      <h4>Rewards</h4>${rewards}
      <button type="button" class="btn btn-primary" id="games-play">Play game</button>
    </div></div><div id="games-frame"></div>`;
    card.querySelectorAll('[data-code]').forEach((btn) => btn.addEventListener('click', async () => {
      const done = await API.gamesPosRedeem(btn.dataset.code, {}, actor);
      if (!done.success) return Utils.toast(done.error || 'Could not redeem', 'error');
      Utils.toast(`${done.data.prize_name} redeemed`, 'success');
      this.show(id, actor, card, currency);
    }));
    document.getElementById('games-play').onclick = async () => {
      const entry = await API.gamesPosEntry(id, actor);
      if (!entry.success) return Utils.toast(entry.error || 'Could not start', 'error');
      document.getElementById('games-frame').innerHTML = `<iframe title="Play" src="/games/?kiosk=1#token=${encodeURIComponent(entry.data.token)}" style="width:100%;height:70vh;border:0;border-radius:12px;background:#140800"></iframe>`;
    };
    void currency;
  }
};

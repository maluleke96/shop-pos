const GamesAdmin = {
  view: 'dashboard',
  token: '',
  actor: null,
  error: '',

  async start() {
    try {
      this.token = sessionStorage.getItem('games_admin_token') || '';
      this.actor = JSON.parse(sessionStorage.getItem('games_admin_user') || 'null');
    } catch (_) { this.actor = null; }
    if (this.actor) {
      try { await this.load(); this.startIdle(); } catch (err) { this.error = err.message; this.actor = null; }
    }
    this.render();
  },

  async rpc(method, args) {
    const res = await fetch('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.token ? { 'X-Session-Token': this.token } : {}) },
      body: JSON.stringify({ method, args: args || [] })
    });
    const json = await res.json().catch(() => ({}));
    const next = res.headers.get('X-Session-Token') || json.sessionToken;
    if (next) {
      this.token = next;
      sessionStorage.setItem('games_admin_token', next);
    }
    if (!res.ok || json.success === false) throw new Error(json.error || 'Request failed');
    return json.data === undefined ? json : json.data;
  },

  esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  },

  async login(event) {
    event.preventDefault();
    this.error = '';
    try {
      const username = document.getElementById('user').value.trim();
      const password = document.getElementById('pass').value;
      const result = await this.rpc('auth:login', [username, password, null]);
      if (!result?.success && !result?.user) throw new Error(result?.error || 'Login failed');
      this.actor = result.user;
      sessionStorage.setItem('games_admin_user', JSON.stringify(this.actor));
      await this.load();
      this.startIdle();
      this.render();
    } catch (err) {
      this.error = err.message;
      this.render();
    }
  },

  logout() {
    this.stopIdle();
    this.actor = null;
    this.token = '';
    sessionStorage.removeItem('games_admin_token');
    sessionStorage.removeItem('games_admin_user');
    this.render();
  },

  startIdle() {
    this.stopIdle();
    this.lastUse = Date.now();
    this.onUse = () => { this.lastUse = Date.now(); };
    ['pointerdown', 'keydown'].forEach((event) => document.addEventListener(event, this.onUse));
    this.rpc('settings:getParsed').then((settings) => {
      const mins = parseInt(settings?.security_settings?.auto_logout_minutes, 10) || 0;
      if (!mins || !this.actor) return;
      this.idleMs = mins * 60000;
      this.idleTimer = setInterval(() => {
        if (this.actor && this.idleMs && Date.now() - this.lastUse >= this.idleMs) this.logout();
      }, 15000);
    }).catch(() => {});
  },

  stopIdle() {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
    if (this.onUse) ['pointerdown', 'keydown'].forEach((event) => document.removeEventListener(event, this.onUse));
    this.onUse = null;
  },

  async load() {
    this.dash = await this.rpc('games:dashboard', [this.actor]);
  },

  async render() {
    const app = document.getElementById('app');
    if (!this.actor) {
      app.innerHTML = `<form class="login" id="form">
        <h1>CHISANYAMA</h1><h2>Games Admin</h2>
        <p class="muted">Use your shop admin username and password. Forgot it? Recover it from the main shop login.</p>
        <p class="muted"><a href="/">Open shop login</a></p>
        <div class="row"><input id="user" placeholder="Username" autocomplete="username"></div>
        <div class="row"><input id="pass" type="password" placeholder="Password" autocomplete="current-password"></div>
        <p class="error">${this.esc(this.error)}</p>
        <button class="btn" type="submit">Login</button>
      </form>`;
      document.getElementById('form').onsubmit = (event) => this.login(event);
      return;
    }
    const items = ['dashboard', 'games', 'prizes', 'inventory', 'rules', 'rewards', 'plays', 'leaderboard', 'devices', 'branches', 'settings', 'permissions', 'audit'];
    let body = '';
    try { body = await this.section(); } catch (err) { body = `<p class="error">${this.esc(err.message)}</p>`; }
    app.innerHTML = `<div class="layout"><nav>
      <strong>Games</strong>
      ${items.map((id) => `<button data-view="${id}" class="${this.view === id ? 'on' : ''}">${id}</button>`).join('')}
      <button id="out">Logout</button>
    </nav><main>${body}</main></div>`;
    app.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', () => { this.view = btn.dataset.view; this.render(); }));
    document.getElementById('out').onclick = () => this.logout();
    this.bind();
  },

  async section() {
    if (this.view === 'dashboard') return this.dashboardHtml();
    if (this.view === 'games') return this.gamesHtml(await this.rpc('games:adminGames', [this.actor]));
    if (this.view === 'prizes' || this.view === 'inventory') return this.inventoryHtml(await this.rpc('games:inventory', [this.actor]));
    if (this.view === 'rules') return this.rulesHtml(await this.rpc('games:rules', [this.actor]));
    if (this.view === 'rewards') return this.table('Rewards', await this.rpc('games:rewards', [this.actor]), ['code', 'prize_name', 'status', 'customer_id', 'redeemed_by_name', 'created_at']);
    if (this.view === 'plays') return this.table('Game sessions', await this.rpc('games:plays', [this.actor]), ['id', 'game_name', 'status', 'points_spent', 'reward_code', 'channel', 'created_at']);
    if (this.view === 'leaderboard') return this.boardHtml(await this.rpc('games:leaderboard', ['week']));
    if (this.view === 'devices') return this.devicesHtml(await this.rpc('games:devices', [this.actor]));
    if (this.view === 'branches') return this.table('Branches', await this.rpc('games:branches', [this.actor]), ['id', 'name', 'code']);
    if (this.view === 'settings') return this.settingsHtml(await this.rpc('games:settings', [this.actor]));
    if (this.view === 'permissions') return this.permissionsHtml();
    if (this.view === 'audit') return this.table('Audit log', await this.rpc('games:audit', [this.actor]), ['created_at', 'user_name', 'action', 'reference_id', 'previous_json', 'next_json']);
    return '';
  },

  dashboardHtml() {
    const d = this.dash || {};
    const cards = [
      ['Total players', d.total_players], ['Today\'s plays', d.todays_plays], ['Points spent', d.points_spent],
      ['Rewards awarded', d.rewards_awarded], ['Rewards redeemed', d.rewards_redeemed], ['Active games', d.active_games],
      ['Active devices', d.active_devices], ['Top game', d.top_game || '—'], ['Top branch', d.top_branch || '—']
    ];
    return `<h1>Games management</h1>
      ${d.insufficient ? '<p class="muted">INSUFFICIENT DATA for today\'s chart. Counts below are real.</p>' : ''}
      <div class="cards">${cards.map(([label, value]) => `<div class="card"><span class="muted">${label}</span><b>${this.esc(value)}</b></div>`).join('')}</div>
      <div class="panel" style="margin-top:16px"><h3>Where games show</h3>
        <p>Website button: ${d.settings?.games_button && d.settings?.games_online ? 'ON' : 'OFF'}</p>
        <p>Apps: ${d.settings?.games_app ? 'ON' : 'OFF'} · POS: ${d.settings?.games_pos ? 'ON' : 'OFF'} · Kiosk: ${d.settings?.games_kiosk ? 'ON' : 'OFF'}</p>
      </div>`;
  },

  gamesHtml(games) {
    const rows = games.map((game) => `<tr>
      <td>${this.esc(game.name)}</td><td>${this.esc(game.game_type)}</td><td>${game.point_cost}</td>
      <td>${game.is_active ? 'ACTIVE' : 'INACTIVE'}</td>
      <td><button class="ghost" data-toggle="${game.id}" data-active="${game.is_active ? 0 : 1}">${game.is_active ? 'Turn off' : 'Turn on'}</button></td>
    </tr>`).join('');
    return `<h1>Games</h1><table><tr><th>Name</th><th>Type</th><th>Points</th><th>Status</th><th></th></tr>${rows}</table>
      <div class="panel"><h3>Add a game</h3>
        <div class="row"><input id="g-name" placeholder="Name"><input id="g-type" placeholder="Type, e.g. wheel"><input id="g-cost" placeholder="Point cost"></div>
        <button class="btn" id="add-game">Create game</button>
      </div>`;
  },

  inventoryHtml(rows) {
    const body = rows.map((row) => `<tr>
      <td>${this.esc(row.game_name)}</td><td>${this.esc(row.name)}</td><td>${row.probability}</td>
      <td>${row.stock_total == null ? 'Unlimited' : row.stock_total}</td><td>${row.stock_awarded}</td>
      <td>${row.remaining == null ? '—' : row.remaining}</td>
      <td><input data-chance="${row.id}" value="${row.probability}" style="width:70px"></td>
      <td><input data-stock="${row.id}" value="${row.stock_total == null ? '' : row.stock_total}" placeholder="Stock"></td>
    </tr>`).join('');
    return `<h1>Prize inventory</h1><p class="muted">When remaining reaches zero, that prize stops being awarded.</p>
      <table><tr><th>Game</th><th>Prize</th><th>Chance</th><th>Stock</th><th>Awarded</th><th>Remaining</th><th>New chance</th><th>Set stock</th></tr>${body}</table>
      <button class="btn" id="save-stock">Save stock</button>`;
  },

  rulesHtml(rules) {
    const rows = rules.map((rule) => `<tr><td>${this.esc(rule.rule_type)}</td><td>${this.esc(JSON.stringify(rule.tiers || rule.spend_amount || ''))}</td><td>${rule.is_active ? 'ON' : 'OFF'}</td></tr>`).join('');
    const spend = rules.find((rule) => rule.rule_type === 'spend_tiers') || rules[0];
    return `<h1>Purchase rules</h1><p class="muted">The highest matching spend wins. A full refund removes unused plays. Partial refunds leave them.</p>
      <table><tr><th>Rule</th><th>Detail</th><th>Status</th></tr>${rows}</table>
      ${spend ? `<div class="panel"><h3>Edit spend tiers</h3>
        <p class="muted">JSON list, highest spend first. Example: [{"min":200,"plays":5},{"min":100,"plays":2},{"min":50,"plays":1}]</p>
        <textarea id="tiers" rows="5" style="width:100%">${this.esc(JSON.stringify(spend.tiers || [], null, 2))}</textarea>
        <input type="hidden" id="rule-id" value="${spend.id}">
        <button class="btn" id="save-rule">Save rules</button></div>` : ''}`;
  },

  permissionsHtml() {
    const keys = ['games.view', 'games.play', 'games.manage', 'games.prizes.manage', 'games.rules.manage', 'games.analytics', 'games.devices.manage', 'games.rewards.redeem', 'games.online.toggle', 'games.pos.access'];
    return `<h1>Permissions</h1><p class="muted">Assign these on Staff profiles. The owner has all of them. Managers have all except the website button unless you grant it.</p>
      <table><tr><th>Permission</th></tr>${keys.map((key) => `<tr><td>${key}</td></tr>`).join('')}</table>`;
  },

  devicesHtml(rows) {
    const body = rows.map((row) => `<tr>
      <td>${this.esc(row.name)}</td><td>${this.esc(row.platform)}</td><td>${this.esc(row.status)}</td><td>${this.esc(row.last_online || '')}</td>
      <td><button class="ghost" data-device="${row.id}" data-status="${row.status === 'disabled' ? 'active' : 'disabled'}">${row.status === 'disabled' ? 'Enable' : 'Disable'}</button>
      <button class="ghost" data-logout="${row.id}">Force logout</button></td>
    </tr>`).join('');
    return `<h1>Devices</h1><table><tr><th>Name</th><th>Platform</th><th>Status</th><th>Last online</th><th></th></tr>${body || '<tr><td colspan="5">No devices yet</td></tr>'}</table>`;
  },

  boardHtml(data) {
    if (data.insufficient) return '<h1>Leaderboard</h1><p>INSUFFICIENT DATA</p>';
    return `<h1>Leaderboard</h1><div class="list">${data.players.map((row) => `<div class="panel">${row.rank}. ${this.esc(row.name)} — ${row.score}</div>`).join('')}</div>`;
  },

  settingsHtml(settings) {
    const flags = [
      ['games_button', 'Games button on the website'],
      ['games_online', 'Games online'],
      ['games_app', 'Games app'],
      ['games_pos', 'POS games'],
      ['games_kiosk', 'Customer kiosk']
    ];
    return `<h1>Online, POS and kiosk</h1>
      <div class="panel">${flags.map(([key, label]) => `<label class="toggle"><span>${label}</span><input type="checkbox" data-flag="${key}" ${settings[key] ? 'checked' : ''}></label>`).join('')}
        <p class="muted">The website Games button appears only when the button and Games online are both on. Turning it off does not delete the module.</p>
        <label class="toggle"><span>Kiosk timeout (seconds)</span><input id="kiosk-sec" type="number" min="15" value="${Number(settings.kiosk_timeout_sec) || 60}"></label>
        <p class="muted">Paid physical cup games stay off unless legal approval is recorded.</p>
        <button class="btn" id="save-flags">Save</button>
      </div>`;
  },

  table(title, rows, cols) {
    const head = cols.map((col) => `<th>${col}</th>`).join('');
    const body = (rows || []).map((row) => `<tr>${cols.map((col) => `<td>${this.esc(row[col])}</td>`).join('')}</tr>`).join('');
    return `<h1>${title}</h1><table><tr>${head}</tr>${body || `<tr><td colspan="${cols.length}">INSUFFICIENT DATA</td></tr>`}</table>`;
  },

  bind() {
    document.getElementById('add-game')?.addEventListener('click', async () => {
      await this.rpc('games:saveGame', [{
        name: document.getElementById('g-name').value,
        game_type: document.getElementById('g-type').value || 'wheel',
        point_cost: Number(document.getElementById('g-cost').value) || 0,
        is_active: 1
      }, this.actor]);
      this.render();
    });
    document.querySelectorAll('[data-toggle]').forEach((btn) => btn.addEventListener('click', async () => {
      const games = await this.rpc('games:adminGames', [this.actor]);
      const game = games.find((item) => item.id == btn.dataset.toggle);
      await this.rpc('games:saveGame', [{ ...game, is_active: btn.dataset.active === '1' ? 1 : 0, config: game.config }, this.actor]);
      this.render();
    }));
    document.getElementById('save-stock')?.addEventListener('click', async () => {
      const inputs = [...document.querySelectorAll('[data-stock]')];
      for (const input of inputs) {
        const games = await this.rpc('games:inventory', [this.actor]);
        const prize = games.find((item) => item.id == input.dataset.stock);
        if (!prize) continue;
        const chance = document.querySelector(`[data-chance="${input.dataset.stock}"]`);
        await this.rpc('games:savePrize', [{ ...prize, stock_total: input.value, probability: chance ? Number(chance.value) : prize.probability }, this.actor]);
      }
      this.render();
    });
    document.querySelectorAll('[data-device]').forEach((btn) => btn.addEventListener('click', async () => {
      await this.rpc('games:updateDevice', [{ id: Number(btn.dataset.device), status: btn.dataset.status }, this.actor]);
      this.render();
    }));
    document.querySelectorAll('[data-logout]').forEach((btn) => btn.addEventListener('click', async () => {
      await this.rpc('games:updateDevice', [{ id: Number(btn.dataset.logout), force_logout: 1 }, this.actor]);
      this.render();
    }));
    document.getElementById('save-rule')?.addEventListener('click', async () => {
      let tiers = [];
      try { tiers = JSON.parse(document.getElementById('tiers').value); } catch (_) { alert('The tiers must be valid JSON.'); return; }
      if (!Array.isArray(tiers)) { alert('The tiers must be a list.'); return; }
      try {
        await this.rpc('games:saveRule', [{ id: Number(document.getElementById('rule-id').value), rule_type: 'spend_tiers', tiers, is_active: 1 }, this.actor]);
        this.render();
      } catch (err) { alert(err.message); }
    });
    document.getElementById('save-flags')?.addEventListener('click', async () => {
      const body = {};
      document.querySelectorAll('[data-flag]').forEach((box) => { body[box.dataset.flag] = box.checked; });
      const timeout = document.getElementById('kiosk-sec');
      if (timeout) body.kiosk_timeout_sec = Math.max(15, Number(timeout.value) || 60);
      try {
        await this.rpc('games:saveSettings', [body, this.actor]);
        await this.load();
        this.render();
      } catch (err) { alert(err.message); }
    });
  }
};

document.addEventListener('DOMContentLoaded', () => GamesAdmin.start());

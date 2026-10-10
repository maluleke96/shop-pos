const GamesApp = {
  view: 'attract',
  token: '',
  home: null,
  game: null,
  result: null,
  config: { kiosk_timeout_sec: 60, show_button: false },
  kiosk: false,
  deviceId: '',
  busy: false,
  slide: 0,
  slides: ['Free chips this week', 'Spin the wheel', 'Win a Russian', 'Use your loyalty points'],

  async start() {
    const params = new URLSearchParams(location.search);
    this.kiosk = params.get('kiosk') === '1' || location.hash.includes('kiosk');
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const handed = hash.get('token');
    if (handed) {
      this.token = handed;
      history.replaceState(null, '', location.pathname + (this.kiosk ? '?kiosk=1' : ''));
    } else if (!this.kiosk) {
      try { this.token = localStorage.getItem('games_token') || ''; } catch (_) { this.token = ''; }
    }
    this.deviceId = this.device();
    try { this.config = await this.rpc('games:publicConfig') || this.config; } catch (_) { /* offline shell */ }
    this.register();
    this.tickSlides();
    this.armIdle();
    if (this.token) {
      try { await this.loadHome(); this.view = 'home'; } catch (_) { this.token = ''; }
    }
    this.render();
  },

  device() {
    const key = 'games_device_id';
    try {
      let id = localStorage.getItem(key);
      if (!id) {
        id = (crypto.randomUUID && crypto.randomUUID()) || `games-${Date.now()}`;
        localStorage.setItem(key, id);
      }
      return id;
    } catch (_) { return 'games-device'; }
  },

  async register() {
    try {
      const device = await this.rpc('games:registerDevice', [{
        device_id: this.deviceId,
        name: this.kiosk ? 'Kiosk' : 'Games screen',
        platform: /Android/i.test(navigator.userAgent) ? 'android' : 'windows',
        version: '1',
        kiosk: this.kiosk
      }]);
      if (device?.force_logout) this.logout();
      if (device?.status === 'disabled') this.disabled = true;
    } catch (_) { /* device registry is optional until online */ }
  },

  async rpc(method, args) {
    if (method === 'games:play' && navigator.onLine === false) throw new Error('Please reconnect to continue.');
    const res = await fetch('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args: args || [] })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error(json.error || 'Please reconnect to continue.');
    return json.data;
  },

  esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  },

  saveToken(token) {
    this.token = token || '';
    if (this.kiosk) return;
    try { localStorage.setItem('games_token', this.token); } catch (_) { /* private mode */ }
  },

  logout() {
    this.token = '';
    this.home = null;
    try { localStorage.removeItem('games_token'); } catch (_) { /* */ }
    this.view = 'attract';
    this.render();
  },

  armIdle() {
    const reset = () => {
      clearTimeout(this.idle);
      if (!this.kiosk || !this.token) return;
      this.idle = setTimeout(() => this.logout(), (this.config.kiosk_timeout_sec || 60) * 1000);
    };
    ['pointerdown', 'keydown'].forEach((event) => document.addEventListener(event, reset));
    reset();
  },

  tickSlides() {
    setInterval(() => {
      this.slide = (this.slide + 1) % this.slides.length;
      const el = document.getElementById('slide');
      if (el) el.textContent = this.slides[this.slide];
    }, 2800);
  },

  async loadHome() {
    this.home = await this.rpc('games:home', [this.token]);
  },

  nav(view) { this.view = view; this.render(); },

  async render() {
    const app = document.getElementById('app');
    if (this.disabled) {
      app.innerHTML = '<div class="login"><h1>This device is disabled</h1><p>Ask the shop to enable it in Games Admin.</p></div>';
      return;
    }
    if (this.view === 'attract' && !this.token) {
      app.innerHTML = `<section class="attract">
        <div class="brand">CHISANYAMA<br><span>PLAY &amp; WIN</span></div>
        <p class="tagline">PLAY GAMES<br>USE YOUR POINTS<br>WIN FREE FOOD</p>
        <div class="slides" id="slide">${this.esc(this.slides[this.slide])}</div>
        <button class="tap" id="start">TAP TO START</button>
      </section>`;
      document.getElementById('start').onclick = () => { this.view = 'login'; this.render(); };
      return;
    }
    let body = '';
    try { body = await this.body(); } catch (err) { body = `<p class="error">${this.esc(err.message)}</p>`; }
    const tabs = [['home', 'Home'], ['games', 'Games'], ['rewards', 'Rewards'], ['history', 'History'], ['board', 'Leaderboard'], ['profile', 'Profile']];
    app.innerHTML = `<div class="screen">
      <aside class="side">
        <strong>CHISANYAMA</strong>
        ${tabs.map(([id, label]) => `<button data-nav="${id}" class="${this.view === id ? 'active' : ''}">${label}</button>`).join('')}
        <button id="logout">Logout</button>
      </aside>
      <div class="main">${body}</div>
      <nav class="dock">
        ${tabs.slice(0, 5).map(([id, label]) => `<button data-nav="${id}" class="${this.view === id ? 'active' : ''}">${label}</button>`).join('')}
      </nav>
    </div>`;
    app.querySelectorAll('[data-nav]').forEach((btn) => btn.addEventListener('click', () => this.nav(btn.dataset.nav)));
    document.getElementById('logout')?.addEventListener('click', () => this.logout());
    this.bind(app);
  },

  async body() {
    if (this.view === 'login') return this.loginHtml();
    if (!this.token) { this.view = 'login'; return this.loginHtml(); }
    if (!this.home) await this.loadHome();
    if (this.view === 'games' || this.view === 'home') return this.gamesHtml();
    if (this.view === 'play') return this.playHtml();
    if (this.view === 'result') return this.resultHtml();
    if (this.view === 'rewards') return this.rewardsHtml();
    if (this.view === 'history') return await this.historyHtml();
    if (this.view === 'board') return await this.boardHtml();
    if (this.view === 'profile') return await this.profileHtml();
    return this.gamesHtml();
  },

  loginHtml() {
    return `<form class="login" id="login-form">
      <h1>CHISANYAMA<br>PLAY &amp; WIN</h1>
      <p class="muted">Use the same account as Chisanyama online ordering.</p>
      <div class="field"><label>Phone or email</label><input id="login-id" autocomplete="username"></div>
      <div class="field"><label>Password</label><input id="login-pass" type="password" autocomplete="current-password"></div>
      <p id="login-error" class="error"></p>
      <button class="gold" type="submit">Login</button>
      <p><button type="button" class="text-btn" id="forgot">Forgot password</button></p>
      <p class="muted">New here? <a href="/order/" style="color:#ffd15c">Register on Chisanyama</a></p>
    </form>`;
  },

  gamesHtml() {
    const h = this.home || {};
    const cards = (h.games || []).map((game) => `<article class="card">
      <div><div class="icon">${this.esc(game.icon || '🎮')}</div><h3>${this.esc(game.name)}</h3>
      <p>${this.esc(game.description || '')}</p>
      <p>Cost: ${game.point_cost} points${game.free_plays ? ` · ${game.free_plays} free` : ''}</p></div>
      <button class="play" data-game="${game.id}">Play</button>
    </article>`).join('');
    return `<div class="top"><div><p class="hello">Welcome, ${this.esc(h.name || 'Player')}</p></div>
      <div class="stats">
        <div class="stat"><b>${h.points || 0}</b><span>Points</span></div>
        <div class="stat"><b>${h.available_plays || 0}</b><span>Plays</span></div>
        <div class="stat"><b>${h.rewards || 0}</b><span>Rewards</span></div>
      </div></div>
      <div class="grid">${cards || '<p>No games are switched on.</p>'}</div>`;
  },

  playHtml() {
    const game = this.game;
    if (!game) return '<p>Choose a game.</p>';
    const head = `<p><button class="ghost" id="back">Back</button></p><h2>${this.esc(game.icon || '')} ${this.esc(game.name)}</h2><p>Cost: ${game.point_cost} points</p>`;
    if (game.game_type === 'wheel') return `${head}<div class="wheel-wrap"><div class="pointer">▼</div><div class="wheel" id="wheel"></div></div><p><button class="play" id="go">Spin now</button></p>`;
    if (game.game_type === 'mystery' || game.game_type === 'cups') {
      const count = game.config?.choices || 3;
      const icon = game.game_type === 'cups' ? '🥤' : '🎁';
      return `${head}<div class="${game.game_type === 'cups' ? 'cups' : 'boxes'}">${Array.from({ length: count }, (_, i) => `<button class="choice" data-choice="${i}">${icon}</button>`).join('')}</div>`;
    }
    if (game.game_type === 'scratch') return `${head}<div class="scratch-box"><div class="prize" id="scratch-prize">Scratch to reveal</div><canvas id="scratch"></canvas></div><p><button class="play" id="go">Get card</button></p>`;
    if (game.game_type === 'catcher') return `${head}<div class="stage"><canvas id="catcher" width="640" height="360"></canvas></div><p><button class="play" id="go">Play now</button></p>`;
    if (game.game_type === 'reaction') return `${head}<div style="text-align:center"><p id="count">READY</p><button class="big-tap" id="tap" disabled>WAIT</button><p id="time"></p></div><p><button class="play" id="go">Play now</button></p>`;
    if (game.game_type === 'memory') return `${head}<div class="memory" id="memory"></div><p><button class="play" id="go">Play now</button></p>`;
    if (game.game_type === 'lucky') {
      const max = game.config?.max || 20;
      return `${head}<div class="numbers">${Array.from({ length: max }, (_, i) => `<button class="num" data-num="${i + 1}">${i + 1}</button>`).join('')}</div><p><button class="play" id="go">Play number</button></p>`;
    }
    return `${head}<p>This game is not available.</p>`;
  },

  resultHtml() {
    const prize = this.result?.prize || {};
    const won = prize.prize_type && prize.prize_type !== 'try_again';
    return `<div class="result">
      <h2>${won ? 'You won' : 'Try again'}</h2>
      <p class="code">${this.esc(prize.name || '')}</p>
      ${prize.code ? `<p>Reward code</p><p class="code">${this.esc(prize.code)}</p>` : ''}
      <p>${this.result?.points_balance ?? ''} points left</p>
      <button class="gold" id="rewards">View my rewards</button>
      <button class="ghost" id="again">Play again</button>
    </div>`;
  },

  rewardsHtml() {
    const rows = (this.rewardRows || []).map((reward) => `<div class="row"><strong>${this.esc(reward.prize_name)}</strong><div class="code">${this.esc(reward.code)}</div><span class="muted">${this.esc(reward.status)}</span></div>`).join('');
    return `<h2>Rewards</h2><div class="list">${rows || '<p class="muted">No rewards yet.</p>'}</div>`;
  },

  async historyHtml() {
    const data = await this.rpc('games:history', [this.token]);
    this.rewardRows = data.rewards || [];
    const rows = (data.plays || []).map((play) => `<div class="row"><strong>${this.esc(play.game)}</strong><div class="muted">${this.esc(play.prize || play.status)} · ${play.points} pts</div></div>`).join('');
    return `<h2>History</h2><div class="list">${rows || '<p class="muted">No plays yet.</p>'}</div>`;
  },

  async boardHtml() {
    const data = await this.rpc('games:leaderboard', ['week']);
    if (data.insufficient) return '<h2>Top players</h2><p>INSUFFICIENT DATA</p>';
    return `<h2>Top players</h2><div class="list">${data.players.map((row) => `<div class="row">${row.rank}. ${this.esc(row.name)} — ${row.score}</div>`).join('')}</div>`;
  },

  async profileHtml() {
    const data = await this.rpc('games:profile', [this.token]);
    this.rewardRows = data.rewards || [];
    return `<h2>${this.esc(data.name)}</h2>
      <div class="stats"><div class="stat"><b>${data.points}</b><span>Points</span></div><div class="stat"><b>${data.available_plays}</b><span>Plays</span></div></div>
      <p class="muted">${this.esc(data.phone_masked || '')} ${this.esc(data.email_masked || '')}</p>
      <p>Leaderboard: ${data.leaderboard_position || '—'}</p>
      <button class="ghost" id="logout2">Logout</button>`;
  },

  bind(app) {
    document.getElementById('login-form')?.addEventListener('submit', (event) => this.onLogin(event));
    document.getElementById('forgot')?.addEventListener('click', () => this.onForgot());
    app.querySelectorAll('[data-game]').forEach((btn) => btn.addEventListener('click', () => this.openGame(Number(btn.dataset.game))));
    document.getElementById('back')?.addEventListener('click', () => this.nav('games'));
    document.getElementById('go')?.addEventListener('click', () => this.onGo());
    document.getElementById('rewards')?.addEventListener('click', async () => { await this.refreshRewards(); this.nav('rewards'); });
    document.getElementById('again')?.addEventListener('click', () => {
      this.memoryStarted = false;
      this.catcherStarted = false;
      this.pending = null;
      this.view = 'play';
      this.render();
    });
    document.getElementById('logout2')?.addEventListener('click', () => this.logout());
    app.querySelectorAll('[data-choice]').forEach((btn) => btn.addEventListener('click', () => this.startPlay({ choice: Number(btn.dataset.choice) })));
    app.querySelectorAll('[data-num]').forEach((btn) => btn.addEventListener('click', () => {
      this.lucky = Number(btn.dataset.num);
      app.querySelectorAll('.num').forEach((n) => n.classList.toggle('on', Number(n.dataset.num) === this.lucky));
    }));
  },

  onGo() {
    const type = this.game?.game_type;
    const button = document.getElementById('go');
    if (button) button.disabled = true;
    if (type === 'reaction') return this.runReaction();
    if (type === 'memory') return this.runMemory();
    if (type === 'catcher') return this.runCatcher();
    return this.startPlay();
  },

  async onLogin(event) {
    event.preventDefault();
    const id = document.getElementById('login-id').value.trim();
    const password = document.getElementById('login-pass').value;
    try {
      const data = await this.rpc('web:login', [id, password]);
      this.saveToken(data.token);
      await this.loadHome();
      this.view = 'home';
      this.render();
    } catch (err) {
      const box = document.getElementById('login-error');
      if (box) box.textContent = err.message;
    }
  },

  async onForgot() {
    const id = document.getElementById('login-id').value.trim();
    if (!id) return;
    try {
      await this.rpc('web:sendPasswordReset', [{ login: id, email: id, phone: id }]);
      document.getElementById('login-error').textContent = 'If that account exists, a reset was sent.';
    } catch (err) {
      document.getElementById('login-error').textContent = err.message;
    }
  },

  openGame(id) {
    this.game = (this.home?.games || []).find((game) => game.id === id);
    this.view = 'play';
    this.pending = null;
    this.memoryStarted = false;
    this.catcherStarted = false;
    this.render();
  },

  async startPlay(extra) {
    if (this.busy || !this.game) return;
    if (navigator.onLine === false) return alert('Please reconnect to continue.');
    this.busy = true;
    const key = this.pending || (this.pending = (crypto.randomUUID && crypto.randomUUID()) || `play-${Date.now()}`);
    try {
      const result = await this.rpc('games:play', [this.token, {
        game_id: this.game.id,
        idempotency_key: key,
        channel: this.kiosk ? 'kiosk' : 'app',
        device_id: this.deviceId,
        number: this.lucky,
        ...(extra || {})
      }]);
      this.pending = null;
      if (result.phase === 'play') {
        this.skill = result;
        return result;
      }
      if (this.game.game_type === 'scratch') {
        this.paintScratch(result);
        return result;
      }
      await this.showResult(result);
      return result;
    } catch (err) {
      alert(err.message);
      const button = document.getElementById('go');
      if (button) button.disabled = false;
      this.memoryStarted = false;
      this.catcherStarted = false;
      return null;
    } finally { this.busy = false; }
  },

  async showResult(result) {
    if (this.game?.game_type === 'wheel') await this.spinTo(result);
    this.result = result;
    this.home = null;
    this.view = 'result';
    this.render();
  },

  spinTo(result) {
    const wheel = document.getElementById('wheel');
    if (!wheel) return Promise.resolve();
    const count = result.segment_count || 8;
    const turns = 5 * 360;
    const slice = 360 / count;
    wheel.style.transform = `rotate(${turns + (count - result.segment) * slice}deg)`;
    return new Promise((resolve) => setTimeout(resolve, 4200));
  },

  paintScratch(result) {
    const canvas = document.getElementById('scratch');
    const label = document.getElementById('scratch-prize');
    if (!canvas || !label) return this.showResult(result);
    label.textContent = result.prize?.name || 'Try again';
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    ctx.fillStyle = '#8a8f98';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#333';
    ctx.font = '28px sans-serif';
    ctx.fillText('Scratch', 24, canvas.height / 2);
    let cleared = 0;
    const scratch = (event) => {
      const box = canvas.getBoundingClientRect();
      const x = ((event.clientX - box.left) / box.width) * canvas.width;
      const y = ((event.clientY - box.top) / box.height) * canvas.height;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, 24, 0, Math.PI * 2);
      ctx.fill();
      cleared += 1;
      if (cleared > 18) {
        canvas.removeEventListener('pointermove', scratch);
        this.showResult(result);
      }
    };
    canvas.addEventListener('pointerdown', scratch);
    canvas.addEventListener('pointermove', (event) => { if (event.buttons) scratch(event); });
  },

  runReaction() {
    const count = document.getElementById('count');
    const tap = document.getElementById('tap');
    if (!count || !tap) return;
    this.startPlay().then(async (started) => {
      if (!started?.play_id) return;
      for (const step of ['3', '2', '1']) {
        count.textContent = step;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      count.textContent = 'GO!';
      tap.disabled = false;
      tap.textContent = 'TAP NOW!';
      await this.rpc('games:play', [this.token, { play_id: started.play_id, action: 'arm' }]);
      const t0 = performance.now();
      tap.onclick = async () => {
        tap.disabled = true;
        const result = await this.rpc('games:play', [this.token, { play_id: started.play_id, action: 'tap' }]);
        const shown = result.reaction_ms ? (result.reaction_ms / 1000).toFixed(3) : ((performance.now() - t0) / 1000).toFixed(3);
        const time = document.getElementById('time');
        if (time) time.textContent = `Your time: ${shown} seconds`;
        setTimeout(() => this.showResult(result), 700);
      };
    });
  },

  runMemory() {
    const host = document.getElementById('memory');
    if (!host || this.memoryStarted) return;
    this.memoryStarted = true;
    const icons = ['🍗', '🍟', '🥤', '🌭', '🌽', '🍞'];
    const pairs = this.game.config?.pairs || 6;
    const deck = icons.slice(0, pairs).flatMap((icon) => [icon, icon]).sort(() => Math.random() - 0.5);
    host.innerHTML = deck.map((icon, index) => `<button class="mem" data-i="${index}">?</button>`).join('');
    let open = [];
    let matched = 0;
    this.startPlay().then((started) => {
      if (!started?.play_id) return;
      host.querySelectorAll('.mem').forEach((btn) => btn.addEventListener('click', async () => {
        const index = Number(btn.dataset.i);
        if (btn.classList.contains('open') || open.length === 2) return;
        btn.textContent = deck[index];
        btn.classList.add('open');
        open.push(btn);
        if (open.length < 2) return;
        const [a, b] = open;
        if (a.textContent === b.textContent && a !== b) {
          matched += 1;
          open = [];
          if (matched >= pairs) {
            const result = await this.rpc('games:play', [this.token, { play_id: started.play_id, matches: matched }]);
            this.memoryStarted = false;
            this.showResult(result);
          }
        } else {
          setTimeout(() => {
            open.forEach((card) => { card.textContent = '?'; card.classList.remove('open'); });
            open = [];
          }, 600);
        }
      }));
    });
  },

  runCatcher() {
    const canvas = document.getElementById('catcher');
    if (!canvas || this.catcherStarted) return;
    this.catcherStarted = true;
    const ctx = canvas.getContext('2d');
    const foods = ['🍗', '🍟', '🌭', '🥤'];
    const items = [];
    let x = 280;
    let score = 0;
    let left = 20;
    const move = (clientX) => {
      const rect = canvas.getBoundingClientRect();
      x = ((clientX - rect.left) / rect.width) * canvas.width;
    };
    canvas.addEventListener('pointermove', (event) => move(event.clientX));
    canvas.addEventListener('pointerdown', (event) => move(event.clientX));
    this.startPlay().then((started) => {
      if (!started?.play_id) { this.catcherStarted = false; return; }
      const timer = setInterval(() => { left -= 1; }, 1000);
      const loop = setInterval(() => {
        if (Math.random() < 0.4) items.push({ x: Math.random() * 600, y: 0, icon: foods[Math.floor(Math.random() * foods.length)] });
        ctx.fillStyle = '#0d0704';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = '28px sans-serif';
        items.forEach((item) => { item.y += 8; ctx.fillText(item.icon, item.x, item.y); });
        ctx.fillStyle = '#ffd15c';
        ctx.fillRect(x - 40, 320, 80, 16);
        for (let i = items.length - 1; i >= 0; i -= 1) {
          if (items[i].y > 320 && items[i].y < 350 && Math.abs(items[i].x - x) < 50) {
            score += 20;
            items.splice(i, 1);
          } else if (items[i].y > 360) items.splice(i, 1);
        }
        ctx.fillStyle = '#fff';
        ctx.fillText(`${score}  ${left}s`, 16, 32);
        if (left <= 0) {
          clearInterval(loop);
          clearInterval(timer);
          this.catcherStarted = false;
          this.rpc('games:play', [this.token, { play_id: started.play_id, score }]).then((result) => this.showResult(result)).catch((err) => alert(err.message));
        }
      }, 40);
    });
  },

  async refreshRewards() {
    const data = await this.rpc('games:history', [this.token]);
    this.rewardRows = data.rewards || [];
  }
};

document.addEventListener('DOMContentLoaded', () => GamesApp.start());

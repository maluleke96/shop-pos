(function () {
  const app = document.getElementById('app');
  const nav = document.getElementById('mo-nav');
  let state = {
    user: null,
    home: null,
    tab: 'home',
    view: 'home',
    task: null
  };

  function toast(msg) {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  function money(n, c) {
    return `${c || 'R'}${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }

  function statusBadge(t) {
    if (t.overdue) return '<span class="badge overdue">Overdue</span>';
    if (t.status === 'verified' || t.status === 'completed') return '<span class="badge done">Completed</span>';
    if (t.status === 'in_progress') return '<span class="badge progress">In Progress</span>';
    return '<span class="badge pending">Pending</span>';
  }

  function saveSession(token, user) {
    localStorage.setItem('mo_token', token);
    localStorage.setItem('mo_user', JSON.stringify(user || {}));
    state.user = user;
  }

  function clearSession() {
    localStorage.removeItem('mo_token');
    localStorage.removeItem('mo_user');
    state.user = null;
    state.home = null;
  }

  function loadUser() {
    try { state.user = JSON.parse(localStorage.getItem('mo_user') || 'null'); } catch (_) { state.user = null; }
    return !!localStorage.getItem('mo_token');
  }

  async function pickPhoto() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }

  function renderLogin(err) {
    nav.classList.add('hidden');
    app.innerHTML = `<div class="login-wrap">
      <h1>Manager Operations</h1>
      <p class="muted">Daily duties · Tasks · Reports</p>
      <p class="muted" style="font-size:13px">Use the same username and password you use for Admin / POS. Access is granted by the shop owner or manager.</p>
      ${err ? `<p style="color:#b91c1c">${err}</p>` : ''}
      <label>Username</label>
      <input class="form-input" id="mo-user" autocomplete="username">
      <label>Password</label>
      <input class="form-input" id="mo-pass" type="password" autocomplete="current-password">
      <button class="btn btn-primary" id="mo-login">Sign in</button>
    </div>`;
    app.querySelector('#mo-login').onclick = async () => {
      try {
        const u = app.querySelector('#mo-user').value;
        const p = app.querySelector('#mo-pass').value;
        const data = await ManagerOpsAPI.login(u, p, { label: navigator.userAgent });
        saveSession(data.token, data.user);
        await boot();
      } catch (e) {
        renderLogin(e.message || 'Login failed');
      }
    };
  }

  async function refreshHome() {
    state.home = await ManagerOpsAPI.home();
    return state.home;
  }

  function header(subtitle) {
    const h = state.home || {};
    return `<div class="mo-header">
      <button class="mo-bell" id="mo-msgs" type="button" title="Owner messages">🔔${(h.owner_messages || []).length ? '•' : ''}</button>
      <h1>Manager Operations</h1>
      <p>${subtitle || 'Daily Operations | Tasks | Reports'}</p>
    </div>`;
  }

  function renderHome() {
    const h = state.home || {};
    const s = h.sales || {};
    const c = h.counts || {};
    nav.classList.remove('hidden');
    setNav('home');
    app.innerHTML = `${header(`Today — ${h.work_date || ''}`)}
      <div class="panel">
        <div class="card">
          <div class="h-row"><strong>TODAY</strong><span class="muted">${h.shop_name || ''}</span></div>
          <div style="margin-top:10px">
            <div class="muted">Sales Target</div>
            <div style="font-size:1.4rem;font-weight:800">${money(s.target, s.currency)}</div>
            <div class="muted" style="margin-top:8px">Current Sales</div>
            <div style="font-size:1.25rem;font-weight:700">${money(s.sales, s.currency)}</div>
            <div class="progress"><span style="width:${Math.min(100, s.progress || 0)}%"></span></div>
            <div class="muted" style="margin-top:6px">Progress ${s.progress || 0}% · Remaining ${money(s.remaining, s.currency)}</div>
          </div>
        </div>
        <div class="stat-row">
          <div class="stat red"><div class="label">MY TASKS remaining</div><div class="value">🔴 ${c.remaining || 0}</div></div>
          <div class="stat"><div class="label">Completed</div><div class="value">🟢 ${c.completed || 0}</div></div>
        </div>
        <div class="card">
          <strong>Quick actions</strong>
          <div class="big-grid" style="margin-top:10px">
            <button class="big-btn green" data-cat="opening">OPENING CHECKLIST</button>
            <button class="big-btn blue" data-cat="sales">SALES CHECK</button>
            <button class="big-btn purple" data-cat="marketing">MARKETING</button>
            <button class="big-btn amber" data-cat="kitchen">KITCHEN CHECK</button>
            <button class="big-btn teal" data-cat="customers">CUSTOMER CHECK</button>
            <button class="big-btn slate" data-cat="stock">STOCK CHECK</button>
            <button class="big-btn red" data-go="problem">REPORT PROBLEM</button>
            <button class="big-btn green full" data-go="daily">SEND DAILY REPORT</button>
          </div>
        </div>
        <div class="card">
          <div class="h-row"><strong>My primary tasks</strong>
            <span class="muted">${h.primary_duties_done ? 'All done — team help unlocked' : 'Finish these first'}</span></div>
          ${(h.my_primary || []).slice(0, 6).map((t) => `
            <div class="task" data-task="${t.id}">
              <div style="flex:1"><div style="font-weight:700">${t.title}</div>
                <div class="muted">${t.category}${t.due_at ? ' · due ' + String(t.due_at).slice(11, 16) : ''}</div></div>
              ${statusBadge(t)}
            </div>`).join('') || '<p class="muted">No primary tasks</p>'}
        </div>
      </div>`;
    bindHomeActions();
  }

  function bindHomeActions() {
    app.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.onclick = () => {
        state.filterCat = btn.dataset.cat;
        state.tab = 'tasks';
        renderTasks();
      };
    });
    app.querySelectorAll('[data-go="problem"]').forEach((b) => { b.onclick = () => renderProblem(); });
    app.querySelectorAll('[data-go="daily"]').forEach((b) => { b.onclick = () => renderDailyReport(); });
    app.querySelectorAll('[data-task]').forEach((row) => {
      row.onclick = () => openTask(Number(row.dataset.task));
    });
    app.querySelector('#mo-msgs')?.addEventListener('click', () => renderMessages());
  }

  function renderTasks() {
    const h = state.home || {};
    let tasks = [...(h.my_primary || []), ...(h.team_tasks || [])];
    if (state.filterCat) tasks = tasks.filter((t) => t.category === state.filterCat);
    setNav('tasks');
    app.innerHTML = `${header('My Tasks')}
      <div class="panel">
        <div class="card">
          <div class="h-row"><strong>${state.filterCat ? state.filterCat.toUpperCase() : 'ALL TASKS'}</strong>
            <button class="btn btn-ghost" style="width:auto;padding:8px 12px" id="mo-clear-f">Clear filter</button></div>
          ${tasks.map((t) => `
            <div class="task" data-task="${t.id}">
              <div style="flex:1"><div style="font-weight:700">${t.title}</div>
                <div class="muted">${t.is_primary ? 'PRIMARY' : 'TEAM'} · ${t.assigned_role}${t.photo_required ? ' · 📷 required' : ''}</div></div>
              ${statusBadge(t)}
            </div>`).join('') || '<p class="muted">No tasks in this category</p>'}
        </div>
      </div>`;
    app.querySelector('#mo-clear-f').onclick = () => { state.filterCat = null; renderTasks(); };
    app.querySelectorAll('[data-task]').forEach((row) => {
      row.onclick = () => openTask(Number(row.dataset.task));
    });
  }

  async function openTask(id) {
    try {
      const task = await ManagerOpsAPI.getTask(id);
      state.task = task;
      setNav('tasks');
      app.innerHTML = `${header(task.title)}
        <div class="panel">
          <div class="card">
            <div class="h-row">${statusBadge(task)}
              <span class="muted">${task.photo_mode === 'required' ? 'Photo required' : task.photo_mode === 'optional' ? 'Photo optional' : 'No photo needed'}</span></div>
            <p class="muted">${task.category} · ${task.assigned_role}</p>
            ${(task.checklist || []).map((c) => `
              <div class="check-item">
                <input type="checkbox" ${c.completed ? 'checked' : ''} data-check="${c.id}">
                <div><strong>${c.label}</strong>${c.is_required ? '' : ' <span class="muted">(optional)</span>'}</div>
              </div>`).join('')}
            <label>Notes</label>
            <textarea id="mo-notes" class="form-input" rows="2" placeholder="Optional notes">${task.notes || ''}</textarea>
            <button class="btn btn-ghost" id="mo-photo">📷 ${task.photo_required ? 'Take required photo' : 'Take photo'}</button>
            <button class="btn btn-primary" id="mo-complete">Mark completed</button>
            <button class="btn btn-ghost" id="mo-back">Back</button>
          </div>
        </div>`;
      let photo = null;
      app.querySelectorAll('[data-check]').forEach((box) => {
        box.onchange = async () => {
          if (!box.checked) return;
          try {
            await ManagerOpsAPI.completeChecklistItem(Number(box.dataset.check), {});
            toast('Checked');
          } catch (e) { toast(e.message); box.checked = false; }
        };
      });
      app.querySelector('#mo-photo').onclick = async () => {
        photo = await pickPhoto();
        toast(photo ? 'Photo ready' : 'No photo');
      };
      app.querySelector('#mo-complete').onclick = async () => {
        try {
          await ManagerOpsAPI.completeTask(id, {
            notes: app.querySelector('#mo-notes').value,
            photo_data_url: photo
          });
          toast('Task completed');
          await refreshHome();
          renderTasks();
        } catch (e) { toast(e.message); }
      };
      app.querySelector('#mo-back').onclick = () => renderTasks();
    } catch (e) { toast(e.message); }
  }

  function renderProblem() {
    setNav('add');
    const cats = [
      'Customer complaint', 'Stock problem', 'Equipment problem', 'Staff problem',
      'Food quality', 'Supplier problem', 'Internet/POS problem', 'Cleaning problem',
      'Security problem', 'Other'
    ];
    app.innerHTML = `${header('Report a problem')}
      <div class="panel"><div class="card">
        <label>Category</label>
        <select id="mo-cat" class="form-input">${cats.map((c) => `<option>${c}</option>`).join('')}</select>
        <label>Priority</label>
        <select id="mo-pri" class="form-input">
          <option value="low">LOW</option><option value="medium" selected>MEDIUM</option>
          <option value="high">HIGH</option><option value="urgent">URGENT</option>
        </select>
        <label>Description</label>
        <textarea id="mo-desc" class="form-input" rows="4" placeholder="What happened?"></textarea>
        <label>Action taken</label>
        <textarea id="mo-act" class="form-input" rows="2"></textarea>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="mo-own"> Requires owner attention</label>
        <button class="btn btn-ghost" id="mo-ph">📷 Attach photo</button>
        <button class="btn btn-danger" id="mo-send">Submit problem</button>
        <button class="btn btn-ghost" id="mo-back">Back</button>
      </div></div>`;
    let photo = null;
    app.querySelector('#mo-ph').onclick = async () => { photo = await pickPhoto(); toast(photo ? 'Photo attached' : 'Cancelled'); };
    app.querySelector('#mo-back').onclick = () => renderHome();
    app.querySelector('#mo-send').onclick = async () => {
      try {
        await ManagerOpsAPI.reportProblem({
          category: app.querySelector('#mo-cat').value,
          priority: app.querySelector('#mo-pri').value,
          description: app.querySelector('#mo-desc').value,
          action_taken: app.querySelector('#mo-act').value,
          requires_owner: app.querySelector('#mo-own').checked,
          photo_data_url: photo
        });
        toast('Problem reported');
        await refreshHome();
        renderHome();
      } catch (e) { toast(e.message); }
    };
  }

  function renderTeam() {
    const h = state.home || {};
    setNav('team');
    app.innerHTML = `${header('Team help')}
      <div class="panel">
        <div class="card">
          <p>${h.primary_duties_done
            ? '🟢 Primary duties completed — you can help the team'
            : 'Finish your primary duties first, then help others.'}</p>
          <button class="btn btn-ghost" id="mo-need">I need help</button>
        </div>
        <div class="card">
          <strong>TEAM HELP NEEDED</strong>
          ${(h.team_help || []).map((x) => `
            <div class="task">
              <div style="flex:1">
                <div style="font-weight:700">${x.requester_name || 'Teammate'} (${x.requester_role || ''})</div>
                <div class="muted">${x.need_label || 'Needs help'} · ${x.status}</div>
              </div>
              ${x.status === 'needed' ? `<button class="btn btn-primary" style="width:auto;padding:8px 12px" data-help="${x.id}">HELP</button>` : ''}
            </div>`).join('') || '<p class="muted">No help requests</p>'}
        </div>
        <div class="card">
          <strong>Attendance</strong>
          ${(h.attendance || []).slice(0, 12).map((a) => `
            <div class="task"><div style="flex:1">${a.name}</div><span class="badge">${a.status}${a.late ? ' · late' : ''}</span></div>
          `).join('') || '<p class="muted">No attendance data</p>'}
        </div>
      </div>`;
    app.querySelector('#mo-need')?.addEventListener('click', async () => {
      const label = prompt('What do you need help with?', 'Cleaning');
      if (!label) return;
      try {
        await ManagerOpsAPI.requestHelp({ need_label: label });
        await refreshHome();
        renderTeam();
      } catch (e) { toast(e.message); }
    });
    app.querySelectorAll('[data-help]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await ManagerOpsAPI.offerHelp(Number(btn.dataset.help));
          toast('You are helping — primary duties unchanged');
          await refreshHome();
          renderTeam();
        } catch (e) { toast(e.message); }
      };
    });
  }

  async function renderDailyReport() {
    setNav('add');
    app.innerHTML = `${header('Send Daily Report')}
      <div class="panel"><div class="card">
        <p class="muted">Creates a permanent shop report and notifies the owner.</p>
        <label>Manager comments</label>
        <textarea id="mo-cmt" class="form-input" rows="4" placeholder="How did the day go?"></textarea>
        <button class="btn btn-primary" id="mo-sub">SEND DAILY REPORT</button>
        <button class="btn btn-ghost" id="mo-back">Back</button>
      </div></div>`;
    app.querySelector('#mo-back').onclick = () => renderHome();
    app.querySelector('#mo-sub').onclick = async () => {
      try {
        const rep = await ManagerOpsAPI.submitReport({ manager_comments: app.querySelector('#mo-cmt').value });
        toast('Daily report submitted');
        app.innerHTML = `${header('Report sent')}
          <div class="panel"><div class="card">
            <h3>Daily Manager Report</h3>
            <p><strong>Date:</strong> ${rep.work_date}</p>
            <p><strong>Sales:</strong> ${money(rep.sales_amount)} / ${money(rep.sales_target)}</p>
            <p><strong>Target achieved:</strong> ${rep.target_achieved ? 'YES' : 'NO'}</p>
            <p><strong>Orders:</strong> ${rep.order_count}</p>
            <p><strong>Tasks:</strong> ${rep.tasks_completed}/${rep.tasks_total}</p>
            <p><strong>Marketing:</strong> ${rep.marketing_completed}/${rep.marketing_total}</p>
            <p><strong>Problems:</strong> ${rep.incidents_count}</p>
            <button class="btn btn-primary" id="mo-home">Back home</button>
          </div></div>`;
        app.querySelector('#mo-home').onclick = async () => { await refreshHome(); renderHome(); };
      } catch (e) { toast(e.message); }
    };
  }

  async function renderMessages() {
    const msgs = await ManagerOpsAPI.ownerMessages();
    app.innerHTML = `${header('Owner messages')}
      <div class="panel"><div class="card">
        ${(msgs || []).map((m) => `
          <div class="task">
            <div style="flex:1"><div style="font-weight:700">${m.from_name || 'Owner'}</div>
              <div>${m.message}</div>
              <div class="muted">${m.created_at || ''}</div></div>
            ${!m.acknowledged ? `<button class="btn btn-primary" style="width:auto;padding:8px 12px" data-ack="${m.id}">ACK</button>` : '<span class="badge done">Seen</span>'}
          </div>`).join('') || '<p class="muted">No messages</p>'}
        <button class="btn btn-ghost" id="mo-back">Back</button>
      </div></div>`;
    app.querySelector('#mo-back').onclick = () => renderHome();
    app.querySelectorAll('[data-ack]').forEach((b) => {
      b.onclick = async () => {
        try {
          await ManagerOpsAPI.ackMessage(Number(b.dataset.ack));
          renderMessages();
        } catch (e) { toast(e.message); }
      };
    });
  }

  function renderMore() {
    setNav('more');
    app.innerHTML = `${header('More')}
      <div class="panel"><div class="card">
        <p><strong>${state.user?.full_name || state.user?.username || ''}</strong></p>
        <p class="muted">${state.user?.role || ''}</p>
        <button class="btn btn-ghost" id="mo-ref">Refresh today</button>
        <button class="btn btn-danger" id="mo-out">Sign out</button>
      </div></div>`;
    app.querySelector('#mo-ref').onclick = async () => {
      try { await refreshHome(); toast('Updated'); renderHome(); } catch (e) { toast(e.message); }
    };
    app.querySelector('#mo-out').onclick = async () => {
      try { await ManagerOpsAPI.logout(); } catch (_) { /* */ }
      clearSession();
      renderLogin();
    };
  }

  function setNav(tab) {
    state.tab = tab;
    nav.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  }

  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    const tab = btn.dataset.tab;
    if (tab === 'home') renderHome();
    else if (tab === 'tasks') { state.filterCat = null; renderTasks(); }
    else if (tab === 'add') renderProblem();
    else if (tab === 'team') renderTeam();
    else if (tab === 'more') renderMore();
  });

  async function boot() {
    try {
      await refreshHome();
      renderHome();
    } catch (e) {
      clearSession();
      renderLogin(e.message);
    }
  }

  if (loadUser()) boot();
  else renderLogin();
})();

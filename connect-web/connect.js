(function () {
  const app = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  const state = {
    token: params.get('s') || sessionStorage.getItem('connect_token') || localStorage.getItem('order_token') || '',
    screen: 'chats',
    home: null,
    threads: [],
    thread: null,
    messages: [],
    orders: [],
    calls: [],
    posts: [],
    stories: [],
    notices: [],
    call: null,
    error: '',
    busy: false
  };
  let pc = null;
  let localStream = null;
  let signalAfter = 0;
  let timer = 0;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function rpc(method, args) {
    const response = await fetch('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args: args || [] })
    });
    const body = await response.json();
    if (!body.success) throw new Error(body.error || 'Request failed');
    return body.data;
  }

  function saveToken(token) {
    state.token = token;
    sessionStorage.setItem('connect_token', token);
  }

  function nav(active) {
    const items = [
      ['chats', 'Chats'],
      ['calls', 'Calls'],
      ['groups', 'Groups'],
      ['discover', 'Discover'],
      ['profile', 'Profile']
    ];
    return `<nav class="nav">${items.map(([id, label]) =>
      `<button type="button" data-go="${id}" class="${active === id ? 'active' : ''}">${label}</button>`).join('')}</nav>`;
  }

  function shell(title, body, active) {
    const unread = state.home && state.home.unread ? ` (${state.home.unread})` : '';
    return `<div class="shell">
      <header class="top"><h1>${esc(title)}</h1><button type="button" data-go="notices">Alerts${esc(unread)}</button></header>
      <div class="body">${body}</div>${nav(active)}</div>`;
  }

  function welcome() {
    app.innerHTML = `<section class="welcome">
      <div class="brand"><div class="flame">🔥</div><h1>CHISANYAMA <span>CONNECT</span></h1><p>Food · People · Community</p></div>
      <h2>Chat · Call · Share</h2>
      <p class="lead">Use the same Chisanyama account you already use for orders.</p>
      <form id="signin">
        <label for="login">Phone or email</label>
        <input id="login" autocomplete="username" required>
        <label for="password">Password</label>
        <input id="password" type="password" autocomplete="current-password" required>
        <p class="err">${esc(state.error)}</p>
        <button class="btn" type="submit">Sign In</button>
      </form>
      <a class="btn ghost" href="/" style="display:block;text-align:center;text-decoration:none;">Back to orders</a>
    </section>`;
    app.querySelector('#signin').onsubmit = async (event) => {
      event.preventDefault();
      state.error = '';
      try {
        const signed = await rpc('web:login', [app.querySelector('#login').value, app.querySelector('#password').value]);
        saveToken(signed.token);
        localStorage.setItem('order_token', signed.token);
        await boot();
      } catch (err) {
        state.error = err.message;
        welcome();
      }
    };
  }

  async function boot() {
    if (!state.token) return welcome();
    try {
      state.home = await rpc('connect:home', [state.token]);
      await show(state.screen || 'chats');
    } catch (err) {
      state.token = '';
      state.error = err.message;
      welcome();
    }
  }

  async function show(screen) {
    stopCallPoll();
    state.screen = screen;
    if (screen === 'chats') return renderChats();
    if (screen === 'thread') return renderThread();
    if (screen === 'calls') return renderCalls();
    if (screen === 'callroom') return renderCall();
    if (screen === 'groups') return renderGroups();
    if (screen === 'discover') return renderDiscover();
    if (screen === 'profile') return renderProfile();
    if (screen === 'notices') return renderNotices();
    return renderChats();
  }

  function bind() {
    app.querySelectorAll('[data-go]').forEach((el) => {
      el.onclick = () => show(el.getAttribute('data-go'));
    });
  }

  async function renderChats() {
    state.threads = await rpc('connect:threads', [state.token]);
    state.orders = await rpc('connect:orders', [state.token]);
    const list = state.threads.map((row) => `<button class="row" data-thread="${row.id}">
      <span class="avatar">${esc((row.title || 'C').slice(0, 1))}</span>
      <span><strong>${esc(row.title)}</strong><span class="muted">${esc(row.last || row.kind)}</span></span>
    </button>`).join('') || '<p class="muted">No conversations yet. Open a branch or an order.</p>';
    const orders = state.orders.map((row) => `<button class="row" data-order="${row.id}">
      <span class="avatar">#</span><span><strong>Order ${esc(row.orderNumber)}</strong>
      <span class="muted">${esc(row.status)}${row.driver ? ' · ' + esc(row.driver) : ''}</span></span></button>`).join('');
    app.innerHTML = shell('Chats', `${orders}<h3>Conversations</h3>${list}`, 'chats');
    bind();
    app.querySelectorAll('[data-thread]').forEach((el) => {
      el.onclick = () => openThread(el.getAttribute('data-thread'));
    });
    app.querySelectorAll('[data-order]').forEach((el) => {
      el.onclick = async () => {
        const opened = await rpc('connect:openOrder', [state.token, Number(el.getAttribute('data-order'))]);
        openThread(opened.id);
      };
    });
  }

  async function openThread(id) {
    state.threadId = Number(id);
    await show('thread');
  }

  async function renderThread() {
    const data = await rpc('connect:messages', [state.token, state.threadId]);
    state.thread = data.thread;
    state.messages = data.messages;
    const bubbles = data.messages.map((row) => `<div class="bubble ${row.mine ? 'mine' : 'theirs'}">
      <strong>${esc(row.name)}</strong><div>${esc(row.body)}</div></div>`).join('');
    app.innerHTML = shell(data.thread ? data.thread.title : 'Chat', `
      <div class="thread-head">
        <button class="btn small" type="button" data-call="voice">Voice</button>
        <button class="btn small" type="button" data-call="video">Video</button>
        ${data.thread && data.thread.kind === 'branch' ? '<button class="btn small" type="button" data-call="group">Group</button>' : ''}
        ${data.thread && data.thread.orderNumber ? `<span class="chip">Order ${esc(data.thread.orderNumber)} · chat only</span>` : ''}
      </div>
      <div id="log">${bubbles}</div>
      <form class="composer" id="send"><input id="text" placeholder="Type a message..." maxlength="2000"><button class="btn small" type="submit">Send</button></form>`, 'chats');
    bind();
    app.querySelectorAll('[data-call]').forEach((el) => { el.onclick = () => startCall(el.getAttribute('data-call')); });
    app.querySelector('#send').onsubmit = async (event) => {
      event.preventDefault();
      const input = app.querySelector('#text');
      if (!input.value.trim()) return;
      await rpc('connect:send', [state.token, state.threadId, input.value]);
      input.value = '';
      renderThread();
    };
    clearInterval(timer);
    timer = setInterval(async () => {
      if (state.screen !== 'thread' || document.activeElement && document.activeElement.id === 'text') return;
      const data = await rpc('connect:messages', [state.token, state.threadId]).catch(() => null);
      const log = document.getElementById('log');
      if (!data || !log) return;
      log.innerHTML = data.messages.map((row) => `<div class="bubble ${row.mine ? 'mine' : 'theirs'}"><strong>${esc(row.name)}</strong><div>${esc(row.body)}</div></div>`).join('');
    }, 4000);
  }

  async function renderGroups() {
    const branches = (state.home && state.home.branches) || [];
    const list = branches.map((row) => `<button class="row" data-branch="${row.id}"><span class="avatar">${esc(row.name.slice(0, 1))}</span><span><strong>${esc(row.name)}</strong><span class="muted">Branch group</span></span></button>`).join('')
      || '<p class="muted">No branches are set up on this Chisanyama account yet.</p>';
    app.innerHTML = shell('Groups', list, 'groups');
    bind();
    app.querySelectorAll('[data-branch]').forEach((el) => {
      el.onclick = async () => {
        const opened = await rpc('connect:openBranch', [state.token, Number(el.getAttribute('data-branch'))]);
        openThread(opened.id);
      };
    });
  }

  async function renderCalls() {
    state.calls = await rpc('connect:calls', [state.token]);
    const list = state.calls.map((row) => `<button class="row" data-join="${row.id}" data-kind="${esc(row.kind)}">
      <span class="avatar">${row.kind === 'video' ? 'V' : 'C'}</span>
      <span><strong>${esc(row.kind)} · ${esc(row.status)}</strong><span class="muted">${esc(row.at || '')}</span></span></button>`).join('')
      || '<p class="muted">No calls yet. Open a chat and start a voice or video call.</p>';
    app.innerHTML = shell('Calls', list, 'calls');
    bind();
    app.querySelectorAll('[data-join]').forEach((el) => {
      el.onclick = () => joinCall(Number(el.getAttribute('data-join')), el.getAttribute('data-kind'), false);
    });
  }

  async function startCall(kind) {
    const call = await rpc('connect:startCall', [state.token, state.threadId, kind]);
    joinCall(call.id, call.kind, true);
  }

  async function joinCall(id, kind, mine) {
    state.call = { id, kind, mine, status: 'Connecting…' };
    signalAfter = 0;
    await show('callroom');
  }

  function stopCallPoll() {
    clearInterval(timer);
    timer = 0;
  }

  async function renderCall() {
    const call = state.call;
    if (!call) return show('calls');
    const video = call.kind === 'video' || call.kind === 'group';
    app.innerHTML = shell(call.kind === 'group' ? 'Group call' : (video ? 'Video call' : 'Voice call'), `
      <div class="call-stage">
        <video id="remote" autoplay playsinline></video>
        <video id="local" autoplay muted playsinline ${video ? '' : 'hidden'}></video>
        <p id="call-status">${esc(call.status)}</p>
        ${call.kind === 'group' ? '<p class="muted">Video connects with the person who started the call. Everyone else stays in this room.</p>' : ''}
      </div>
      <div class="call-actions">
        <button class="btn small" type="button" id="mute">Mute</button>
        <button class="btn small" type="button" id="end">End</button>
      </div>`, 'calls');
    bind();
    const remote = app.querySelector('#remote');
    const local = app.querySelector('#local');
    const status = app.querySelector('#call-status');
    app.querySelector('#end').onclick = async () => {
      await rpc('connect:setCall', [state.token, call.id, 'ended']).catch(() => {});
      hangup();
      show('calls');
    };
    app.querySelector('#mute').onclick = () => {
      if (!localStream) return;
      localStream.getAudioTracks().forEach((track) => { track.enabled = !track.enabled; });
    };
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
      local.srcObject = localStream;
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
      pc.ontrack = (event) => { remote.srcObject = event.streams[0]; status.textContent = 'Connected'; };
      pc.onicecandidate = (event) => {
        if (event.candidate) rpc('connect:signal', [state.token, call.id, { type: 'ice', candidate: event.candidate }]).catch(() => {});
      };
      if (call.mine) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await rpc('connect:signal', [state.token, call.id, { type: 'offer', sdp: pc.localDescription }]);
        await rpc('connect:setCall', [state.token, call.id, 'answered']);
      }
      status.textContent = call.mine ? 'Calling…' : 'Waiting…';
    } catch (err) {
      status.textContent = 'This device could not open the microphone. The call is still saved in history.';
    }
    stopCallPoll();
    timer = setInterval(async () => {
      if (state.screen !== 'callroom' || !pc) return;
      try {
        const pack = await rpc('connect:signals', [state.token, call.id, signalAfter]);
        for (const row of pack.signals) {
          signalAfter = row.id;
          const payload = row.payload || {};
          if (payload.type === 'offer' && !call.mine) {
            await pc.setRemoteDescription(payload.sdp);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await rpc('connect:signal', [state.token, call.id, { type: 'answer', sdp: pc.localDescription }]);
            await rpc('connect:setCall', [state.token, call.id, 'answered']);
          } else if (payload.type === 'answer' && call.mine) {
            await pc.setRemoteDescription(payload.sdp);
          } else if (payload.type === 'ice' && payload.candidate) {
            await pc.addIceCandidate(payload.candidate).catch(() => {});
          }
        }
        if (pack.status === 'ended' || pack.status === 'declined') {
          hangup();
          show('calls');
        }
      } catch (_) {}
    }, 1200);
  }

  function hangup() {
    stopCallPoll();
    if (pc) { pc.close(); pc = null; }
    if (localStream) { localStream.getTracks().forEach((track) => track.stop()); localStream = null; }
  }

  async function renderDiscover() {
    state.stories = await rpc('connect:stories', [state.token]);
    state.posts = await rpc('connect:posts', [state.token]);
    const stories = state.stories.map((row) => `<button class="story" data-story="${row.id}"><span class="ring">${esc(row.name.slice(0, 1))}</span>${esc(row.name.split(' ')[0])}</button>`).join('');
    const posts = state.posts.map((row) => `<article class="card post"><strong>${esc(row.name)}</strong><p>${esc(row.body)}</p>${row.media ? `<img alt="" src="${esc(row.media)}">` : ''}</article>`).join('')
      || '<p class="muted">The community feed is empty.</p>';
    app.innerHTML = shell('Discover', `
      <div class="stories"><button class="story" id="add-story"><span class="ring">+</span>Status</button>${stories}</div>
      <form class="card" id="post"><textarea id="post-text" maxlength="1000" placeholder="Share with the community"></textarea>
        <input id="post-photo" type="file" accept="image/*"><button class="btn" type="submit">Post</button></form>
      ${posts}`, 'discover');
    bind();
    app.querySelectorAll('[data-story]').forEach((el) => {
      el.onclick = () => {
        const row = state.stories.find((item) => String(item.id) === el.getAttribute('data-story'));
        if (row) window.alert(`${row.name}\n\n${row.body || 'Photo status'}`);
      };
    });
    app.querySelector('#add-story').onclick = async () => {
      const text = window.prompt('Status');
      if (!text) return;
      await rpc('connect:addStory', [state.token, text, '']);
      renderDiscover();
    };
    app.querySelector('#post').onsubmit = async (event) => {
      event.preventDefault();
      const file = app.querySelector('#post-photo').files[0];
      const media = file ? await readImage(file) : '';
      await rpc('connect:post', [state.token, app.querySelector('#post-text').value, media]);
      renderDiscover();
    };
  }

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 480 / img.width);
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = () => reject(new Error('Could not read that photo'));
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function renderProfile() {
    const profile = state.home.profile;
    const marketing = profile.marketingOptIn == null
      ? 'Marketing choices stay in the Marketing Centre.'
      : (profile.marketingOptIn ? 'Marketing is allowed on the main account. Chat will not send campaigns.' : 'Marketing is off on the main account. Chat will not change that.');
    app.innerHTML = shell('Profile', `
      <div class="card"><span class="avatar">${esc(profile.name.slice(0, 1))}</span>
        <h2>${esc(profile.name)}</h2>
        <p class="muted">${esc(profile.role)} · ${esc(profile.shop)}</p>
        <p>${esc(profile.phone)} ${esc(profile.email)}</p>
        <p class="note">This is your Chisanyama account. Name, phone and email come from the main profile. ${esc(marketing)}</p>
      </div>
      <form class="card" id="about"><label for="about-text">About</label>
        <input id="about-text" maxlength="180" value="${esc(profile.about)}">
        <button class="btn" type="submit">Save</button></form>
      <a class="btn ghost" href="/" style="display:block;text-align:center;text-decoration:none;">Orders</a>`, 'profile');
    bind();
    app.querySelector('#about').onsubmit = async (event) => {
      event.preventDefault();
      state.home.profile = await rpc('connect:profile', [state.token, app.querySelector('#about-text').value]);
      renderProfile();
    };
  }

  async function renderNotices() {
    state.notices = await rpc('connect:notices', [state.token]);
    const list = state.notices.map((row) => `<button class="row" data-read="${row.id}"><span><strong>${esc(row.title)}</strong><span class="muted">${esc(row.body)}</span></span></button>`).join('')
      || '<p class="muted">No alerts.</p>';
    app.innerHTML = shell('Alerts', list, 'profile');
    bind();
    app.querySelectorAll('[data-read]').forEach((el) => {
      el.onclick = async () => { await rpc('connect:readNotice', [state.token, Number(el.getAttribute('data-read'))]); renderNotices(); };
    });
  }

  boot();
})();

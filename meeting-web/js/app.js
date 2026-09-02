const MeetingApp = {
  view: 'login',
  user: null,
  meetings: [],
  current: null,
  recording: false,
  mediaRecorder: null,
  audioChunks: [],
  recordStart: 0,
  aiAvailable: false,

  esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },
  toast(msg, type) {
    const el = document.createElement('div');
    el.className = `toast ${type === 'error' ? 'error' : ''}`;
    el.textContent = msg;
    document.getElementById('toast-root').appendChild(el);
    setTimeout(() => el.remove(), 4000);
  },

  async init() {
    const tok = localStorage.getItem('meeting_token');
    if (tok) {
      try {
        const loginData = JSON.parse(localStorage.getItem('meeting_user') || '{}');
        this.user = loginData;
        this.aiAvailable = !!loginData.ai_available;
        this.meetings = await MeetingAPI.list();
        this.view = 'list';
      } catch (_) {
        localStorage.removeItem('meeting_token');
        localStorage.removeItem('meeting_user');
        this.view = 'login';
      }
    }
    this.render();
  },

  async refreshList() {
    this.meetings = await MeetingAPI.list();
    this.render();
  },

  async openMeeting(id) {
    this.current = await MeetingAPI.get(id);
    this.aiAvailable = !!this.current.ai_available;
    this.view = 'detail';
    this.render();
  },

  render() {
    const app = document.getElementById('app');
    if (this.view === 'login') {
      app.innerHTML = `<div class="portal-card">
        <h1>AI Meeting Centre</h1>
        <p class="muted">Record meetings, transcribe, and generate minutes.</p>
        <label>Username<input id="mtg-user"></label>
        <label>Password<input id="mtg-pass" type="password"></label>
        <button class="btn" data-act="login">Sign in</button>
      </div>`;
    } else if (this.view === 'list') {
      app.innerHTML = `<div class="portal-card">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div><h1>Meetings</h1><p class="muted">${this.esc(this.user?.full_name || this.user?.username)}</p></div>
          <div><button class="btn secondary" data-act="logout">Logout</button>
          <button class="btn" data-act="new-meeting">New meeting</button></div>
        </div>
        <div class="banner">Video conferencing: NOT IMPLEMENTED — WebRTC signaling server required. Audio recording works below.</div>
        <label>Search<input id="mtg-search" placeholder="Topic, decision, keyword…"></label>
        <button class="btn secondary" data-act="search">Search</button>
      </div>
      <div class="portal-card">
        <table class="table"><thead><tr><th>Title</th><th>Date</th><th>Status</th><th></th></tr></thead>
        <tbody>${(this.meetings || []).map((m) => `<tr>
          <td>${this.esc(m.title)}</td><td>${this.esc(m.meeting_date || '—')}</td>
          <td><span class="badge">${this.esc(m.status)}</span></td>
          <td><button class="btn secondary" data-act="open" data-id="${m.id}">Open</button></td>
        </tr>`).join('') || '<tr><td colspan="4" class="muted">No meetings yet</td></tr>'}
        </tbody></table>
      </div>`;
    } else if (this.view === 'detail' && this.current) {
      const m = this.current;
      const transcript = m.transcript;
      const segs = transcript?.content_json ? (typeof transcript.content_json === 'string' ? JSON.parse(transcript.content_json) : transcript.content_json) : [];
      app.innerHTML = `<div class="portal-card">
        <button class="btn secondary" data-act="back">← Back</button>
        <h1>${this.esc(m.title)}</h1>
        <p class="muted">${this.esc(m.meeting_date || '')} ${this.esc(m.meeting_time || '')} · ${this.esc(m.location || '')} · <span class="badge">${this.esc(m.status)}</span></p>
        ${m.agenda ? `<p><strong>Agenda:</strong> ${this.esc(m.agenda)}</p>` : ''}
        <div class="banner info">POPIA: Participants are notified when recording starts. Recordings are stored securely and access is restricted.</div>
        <div class="nav">
          ${m.status === 'scheduled' ? '<button class="btn" data-act="start-meeting">Start meeting & recording</button>' : ''}
          ${m.status === 'live' ? `<button class="btn danger" data-act="stop-recording">${this.recording ? '<span class="recording-dot">●</span> STOP RECORDING' : 'Stop meeting'}</button>` : ''}
          ${m.status === 'processing' || m.status === 'completed' ? '<button class="btn" data-act="process-ai">Generate AI summary & minutes</button>' : ''}
          ${m.minutes ? '<button class="btn secondary" data-act="finalize">Finalize minutes</button>' : ''}
        </div>
      </div>
      ${m.recordings?.length ? `<div class="portal-card"><h2>Recordings</h2><ul>${m.recordings.map((r) => `<li>${r.mime_type} · ${Math.round((r.size_bytes || 0) / 1024)} KB · ${r.duration_seconds || 0}s</li>`).join('')}</ul></div>` : ''}
      <div class="portal-card"><h2>Transcript</h2>
        ${segs.length ? segs.map((s) => `<div class="transcript-seg"><span class="speaker">${this.esc(s.speaker || 'Speaker')}</span><p>${this.esc(s.text)}</p></div>`).join('') : '<p class="muted">No transcript yet. Add manually or process after recording.</p>'}
        <label>Add / edit transcript segment</label>
        <input id="seg-speaker" placeholder="Speaker name">
        <textarea id="seg-text" placeholder="What was said…"></textarea>
        <button class="btn secondary" data-act="add-segment">Add segment</button>
      </div>
      ${m.extracted_points?.length ? `<div class="portal-card"><h2>Extracted points</h2>
        ${m.extracted_points.map((p) => `<p><span class="badge">${this.esc(p.point_type)}</span> ${this.esc(p.content)}</p>`).join('')}
      </div>` : ''}
      ${m.action_items?.length ? `<div class="portal-card"><h2>Action items</h2>
        <table class="table"><thead><tr><th>Person</th><th>Task</th><th>Deadline</th><th>Status</th></tr></thead>
        <tbody>${m.action_items.map((a) => `<tr><td>${this.esc(a.person)}</td><td>${this.esc(a.task)}</td><td>${this.esc(a.deadline || '—')}</td><td>${this.esc(a.status)}</td></tr>`).join('')}</tbody></table>
      </div>` : ''}
      ${m.minutes ? `<div class="portal-card"><h2>Minutes</h2><div>${m.minutes.content_html || ''}</div></div>` : ''}
      <div class="portal-card"><h2>Ask AI about this meeting</h2>
        <input id="ai-question" placeholder="What decisions were made?">
        <button class="btn secondary" data-act="ask-ai">Ask</button>
        <div id="ai-answer" class="muted" style="margin-top:8px"></div>
        ${!this.aiAvailable ? '<p class="muted">AI requires SHOP_POS_AI_API_KEY on server.</p>' : ''}
      </div>`;
    }
    this.bind();
  },

  async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(stream);
      this.mediaRecorder.ondataavailable = (e) => { if (e.data.size) this.audioChunks.push(e.data); };
      this.mediaRecorder.start(1000);
      this.recording = true;
      this.recordStart = Date.now();
      this.toast('Recording started — participants have been notified', 'success');
    } catch (err) {
      this.toast('Microphone access denied: ' + err.message, 'error');
      throw err;
    }
  },

  async stopRecordingAndSave(meetingId) {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve(null);
        return;
      }
      this.mediaRecorder.onstop = async () => {
        try {
          const blob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
          const reader = new FileReader();
          reader.onloadend = async () => {
            const duration = Math.round((Date.now() - this.recordStart) / 1000);
            await MeetingAPI.saveRecording(meetingId, {
              audio_data: reader.result,
              duration_seconds: duration
            });
            this.mediaRecorder.stream.getTracks().forEach((t) => t.stop());
            this.recording = false;
            this.mediaRecorder = null;
            resolve(duration);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        } catch (e) { reject(e); }
      };
      this.mediaRecorder.stop();
    });
  },

  bind() {
    document.getElementById('app').onclick = async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'login') {
        try {
          const r = await MeetingAPI.login(document.getElementById('mtg-user').value.trim(), document.getElementById('mtg-pass').value);
          localStorage.setItem('meeting_token', r.token);
          localStorage.setItem('meeting_user', JSON.stringify(r.user));
          this.user = r.user;
          this.aiAvailable = !!r.ai_available;
          await this.refreshList();
          this.view = 'list';
          this.render();
        } catch (err) { this.toast(err.message, 'error'); }
      }
      if (act === 'logout') {
        await MeetingAPI.logout().catch(() => {});
        localStorage.removeItem('meeting_token');
        localStorage.removeItem('meeting_user');
        this.view = 'login';
        this.render();
      }
      if (act === 'new-meeting') {
        const title = prompt('Meeting title:');
        if (!title) return;
        const meeting_date = prompt('Date (YYYY-MM-DD):', new Date().toISOString().slice(0, 10)) || null;
        const agenda = prompt('Agenda:') || '';
        try {
          const m = await MeetingAPI.save({ title, meeting_date, agenda });
          await this.openMeeting(m.id);
        } catch (err) { this.toast(err.message, 'error'); }
      }
      if (act === 'open') await this.openMeeting(Number(btn.dataset.id));
      if (act === 'back') { this.current = null; this.view = 'list'; await this.refreshList(); }
      if (act === 'search') {
        const q = document.getElementById('mtg-search')?.value;
        if (q) this.meetings = await MeetingAPI.search(q);
        this.render();
      }
      if (act === 'start-meeting' && this.current) {
        try {
          await MeetingAPI.start(this.current.id);
          await this.startRecording();
          await this.openMeeting(this.current.id);
        } catch (err) { this.toast(err.message, 'error'); }
      }
      if (act === 'stop-recording' && this.current) {
        try {
          if (this.recording) await this.stopRecordingAndSave(this.current.id);
          await MeetingAPI.stop(this.current.id);
          this.toast('Recording saved', 'success');
          await this.openMeeting(this.current.id);
        } catch (err) { this.toast(err.message, 'error'); }
      }
      if (act === 'add-segment' && this.current) {
        const speaker = document.getElementById('seg-speaker')?.value || 'Speaker';
        const text = document.getElementById('seg-text')?.value?.trim();
        if (!text) return;
        const transcript = this.current.transcript;
        let segs = transcript?.content_json ? (typeof transcript.content_json === 'string' ? JSON.parse(transcript.content_json) : transcript.content_json) : [];
        segs = [...segs, { speaker, text }];
        await MeetingAPI.saveTranscript(this.current.id, segs);
        await this.openMeeting(this.current.id);
      }
      if (act === 'process-ai' && this.current) {
        try {
          const r = await MeetingAPI.processAi(this.current.id);
          if (r.status === 'NOT_IMPLEMENTED') this.toast(r.message, 'error');
          else if (r.success) { this.toast('AI processing complete', 'success'); await this.openMeeting(this.current.id); }
          else this.toast(r.error || 'AI failed', 'error');
        } catch (err) { this.toast(err.message, 'error'); }
      }
      if (act === 'finalize' && this.current) {
        try {
          await MeetingAPI.finalizeMinutes(this.current.id);
          this.toast('Minutes finalized', 'success');
          await this.openMeeting(this.current.id);
        } catch (err) { this.toast(err.message, 'error'); }
      }
      if (act === 'ask-ai' && this.current) {
        const q = document.getElementById('ai-question')?.value;
        if (!q) return;
        try {
          const r = await MeetingAPI.ask(this.current.id, q);
          const el = document.getElementById('ai-answer');
          if (el) el.textContent = r.answer || r.message || 'No answer';
        } catch (err) { this.toast(err.message, 'error'); }
      }
    };
  }
};
MeetingApp.init();

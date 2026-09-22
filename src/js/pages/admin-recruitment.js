// Admin — Recruitment / Jobs (candidates, interviews, WhatsApp, admin approval)
// Also used from Staff Portal → Recruitment tab (must work without AdminPage loaded).
(function () {
  if (window.AdminPage?.sections && !AdminPage.sections.some(s => s.id === 'recruitment')) {
    AdminPage.sections.splice(5, 0, { id: 'recruitment', label: '💼 Recruitment', icon: 'recruitment' });
  }

  function hireToast(r) {
    const emp = r?.data?._employee || r?.data?.data?._employee;
    const pin = r?.data?._generated_pin || emp?._generated_pin;
    return emp?.employee_code
      ? `Hired — employee ${emp.employee_code}${pin ? ` · PIN ${pin}` : ''}`
      : 'Candidate approved for employment';
  }

  const AdminRecruitmentPage = {
    async render(el, admin) {
      this.admin = admin;
      this.app = admin?.app;
      if (!this.app?.user) {
        el.innerHTML = `<div class="admin-section"><p class="error-msg">Sign in required for Recruitment.</p></div>`;
        return;
      }
      this.expandedPostingId = this.expandedPostingId || null;
      const isAdmin = ['owner', 'manager'].includes(this.app.user?.role);
      const canRequestEmploy = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(this.app.user?.role);

      el.innerHTML = `<div class="admin-section"><h3>Recruitment</h3>
        <p class="muted">Record candidates, schedule interviews, send WhatsApp updates, and require admin approval for hire/reject.</p>
        <div id="rec-content"><p class="muted">Loading…</p></div></div>`;

      const content = document.getElementById('rec-content');
      const withTimeout = (promise, ms, label) => Promise.race([
        Promise.resolve(promise).catch((err) => ({ success: false, error: err?.message || String(err), _label: label })),
        new Promise((resolve) => setTimeout(() => resolve({ success: false, error: 'Timed out', _label: label }), ms))
      ]);
      let postRes, pendingRes, interviewRes, settingsRes;
      try {
        [postRes, pendingRes, interviewRes, settingsRes] = await Promise.all([
          withTimeout(API.getJobPostings({}, this.app.user), 10000, 'postings'),
          withTimeout(API.getJobCandidates({ employ_requested: true }, this.app.user), 10000, 'pending'),
          withTimeout(API.getJobCandidates({ interview_pending: true }, this.app.user), 10000, 'interviews'),
          withTimeout(API.getRecruitmentSettings(this.app.user), 8000, 'settings')
        ]);
      } catch (err) {
        content.innerHTML = `<p class="error-msg">${Utils.escHtml(err.message || 'Recruitment failed to load')}</p>
          <button type="button" class="btn btn-primary" id="rec-retry">Retry</button>`;
        document.getElementById('rec-retry')?.addEventListener('click', () => this.render(el, admin));
        return;
      }
      if (postRes?.success === false && !postRes?.data) {
        content.innerHTML = `<p class="error-msg">${Utils.escHtml(postRes.error || 'Could not load job postings')}</p>
          <button type="button" class="btn btn-primary" id="rec-retry">Retry</button>`;
        document.getElementById('rec-retry')?.addEventListener('click', () => this.render(el, admin));
        return;
      }
      const postings = postRes?.data || [];
      const pendingMap = new Map();
      [...(pendingRes?.data || []), ...(interviewRes?.data || [])]
        .filter(c => !c.admin_decision)
        .forEach(c => pendingMap.set(c.id, c));
      const pending = [...pendingMap.values()];
      const settings = settingsRes?.data || { max_pictures: 5 };

      content.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;align-items:center">
          <button class="btn btn-primary" id="rec-new-job">+ New Job Posting</button>
          ${isAdmin ? `<button class="btn btn-ghost" id="rec-settings">Recruitment Settings</button>
            <span class="muted" style="font-size:12px">Max pictures per candidate: <strong>${settings.max_pictures}</strong></span>` : ''}
        </div>
        ${isAdmin && pending.length ? `<div class="card" style="margin:12px 0;border-color:var(--warning)"><div class="card-header"><h4>Pending Employment / Interview Approvals</h4></div>
        <div class="card-body"><div class="table-wrap"><table>
          <thead><tr><th>Candidate</th><th>Job</th><th>Status</th><th>Requested by</th><th></th></tr></thead>
          <tbody>${pending.map(c => `<tr>
            <td><strong>${Utils.escHtml(c.name)}</strong><br><small>${Utils.escHtml(c.phone || '')} · ${Utils.escHtml(c.address || c.location || '')}</small></td>
            <td>${Utils.escHtml(c.posting_title || '—')}</td>
            <td><span class="tag">${Utils.escHtml(c.status || '')}</span></td>
            <td>${Utils.escHtml(c.employ_request_by_name || '—')}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm btn-ghost rec-pending-detail" data-id="${c.id}">Details</button>
              ${c.cv_path ? `<button class="btn btn-sm btn-ghost rec-pending-cv" data-path="${Utils.escHtml(c.cv_path)}">View CV</button>` : ''}
              <button class="btn btn-sm btn-success rec-pending-hire" data-id="${c.id}">Approve Hire</button>
              <button class="btn btn-sm btn-danger rec-pending-reject" data-id="${c.id}">Reject</button>
            </td></tr>`).join('')}
          </tbody></table></div></div></div>` : isAdmin ? `<p class="muted" style="margin:12px 0">No pending employment requests.</p>` : ''}
        <div class="table-wrap"><table><thead><tr><th>Title</th><th>Status</th><th>Created</th><th></th></tr></thead>
        <tbody>${postings.map(p => `<tr>
          <td><strong>${Utils.escHtml(p.title)}</strong><br><small class="muted">${Utils.escHtml((p.extra?.position || p.position_title || p.description || '').slice(0, 80))}</small>
            ${p.closes_at ? `<br><small>Closes ${Utils.escHtml(String(p.closes_at).slice(0, 10))}</small>` : ''}</td>
          <td><span class="tag">${Utils.escHtml(p.status)}</span></td>
          <td>${Utils.formatDateTime(p.created_at)}<br><small>${Utils.escHtml(p.created_by_name || '')}</small></td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-primary rec-view-cands" data-id="${p.id}">Applications</button>
            <button class="btn btn-sm btn-ghost rec-poster" data-id="${p.id}">Poster / QR</button>
            <button class="btn btn-sm btn-ghost rec-share" data-id="${p.id}">Message / link</button>
            ${isAdmin ? `<button class="btn btn-sm btn-ghost rec-edit-job" data-id="${p.id}">Edit</button>
              <button class="btn btn-sm btn-danger rec-del-job" data-id="${p.id}">Delete</button>` : ''}
            ${isAdmin && p.status === 'pending' ? `<button class="btn btn-sm btn-success rec-approve" data-id="${p.id}">Approve</button>
              <button class="btn btn-sm btn-danger rec-reject-post" data-id="${p.id}">Reject</button>` : ''}
            ${isAdmin && p.status === 'active' ? `<button class="btn btn-sm btn-warning rec-close" data-id="${p.id}">Close</button>` : ''}
          </td></tr>`).join('') || '<tr><td colspan="4" class="muted">No job postings</td></tr>'}
        </tbody></table></div>
        <div id="rec-posting-candidates" style="margin-top:16px"></div>`;

      document.getElementById('rec-settings')?.addEventListener('click', () => this.showSettingsModal(el, admin, settings));

      document.getElementById('rec-new-job')?.addEventListener('click', () => this.showJobForm(null, el, admin, isAdmin));

      content.querySelectorAll('.rec-approve').forEach(b => b.addEventListener('click', async () => {
        const r = await API.approveJobPosting(parseInt(b.dataset.id, 10), this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Job posting approved and active', 'success');
        this.render(el, admin);
      }));
      content.querySelectorAll('.rec-reject-post').forEach(b => b.addEventListener('click', async () => {
        const id = parseInt(b.dataset.id, 10);
        const posting = postings.find(p => p.id === id);
        if (!posting) return;
        const notes = prompt('Rejection reason (optional):') || '';
        const r = await API.saveJobPosting({
          id,
          title: posting.title,
          description: posting.description
            ? `${posting.description}\n\n[Rejected ${Utils.today()}]: ${notes}`.trim()
            : `[Rejected ${Utils.today()}]: ${notes}`,
          status: 'closed',
          rejection_notes: notes
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast(notes ? `Job posting rejected: ${notes}` : 'Job posting rejected', 'success');
        this.render(el, admin);
      }));
      content.querySelectorAll('.rec-close').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Close this posting?')) return;
        await API.closeJobPosting(parseInt(b.dataset.id, 10), this.app.user);
        this.render(el, admin);
      }));
      content.querySelectorAll('.rec-edit-job').forEach(b => b.addEventListener('click', () => {
        const posting = postings.find(p => p.id === parseInt(b.dataset.id, 10));
        if (posting) this.showJobForm(posting, el, admin, isAdmin);
      }));
      content.querySelectorAll('.rec-poster').forEach(b => b.addEventListener('click', () => this.showPoster(parseInt(b.dataset.id, 10))));
      content.querySelectorAll('.rec-share').forEach(b => b.addEventListener('click', () => this.showShare(parseInt(b.dataset.id, 10))));
      content.querySelectorAll('.rec-del-job').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this job posting and all its candidates?')) return;
        const r = await API.deleteJobPosting(parseInt(b.dataset.id, 10), this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Job posting deleted', 'success');
        this.render(el, admin);
      }));
      content.querySelectorAll('.rec-view-cands').forEach(b => b.addEventListener('click', () => {
        const id = parseInt(b.dataset.id, 10);
        this.expandedPostingId = this.expandedPostingId === id ? null : id;
        if (this.expandedPostingId) this.showPostingCandidates(id, content, canRequestEmploy, isAdmin);
        else document.getElementById('rec-posting-candidates').innerHTML = '';
      }));

      content.querySelectorAll('.rec-pending-cv').forEach(b => b.addEventListener('click', () => {
        const id = parseInt(b.closest('tr')?.querySelector('.rec-pending-detail')?.dataset.id || '0', 10);
        this.openCv(id, b.dataset.path);
      }));
      content.querySelectorAll('.rec-pending-detail').forEach(b => b.addEventListener('click', () => {
        this.showCandidateDetails(parseInt(b.dataset.id, 10), isAdmin, () => this.render(el, admin));
      }));
      content.querySelectorAll('.rec-pending-hire').forEach(b => b.addEventListener('click', () =>
        this.decideAndWhatsApp(parseInt(b.dataset.id, 10), 'approved', () => this.render(el, admin))));
      content.querySelectorAll('.rec-pending-reject').forEach(b => b.addEventListener('click', () =>
        this.decideAndWhatsApp(parseInt(b.dataset.id, 10), 'rejected', () => this.render(el, admin))));

      if (this.expandedPostingId) {
        await this.showPostingCandidates(this.expandedPostingId, content, canRequestEmploy, isAdmin);
      }
    },

    async showSettingsModal(el, admin, current) {
      const s = current || {};
      Utils.showModal('Recruitment Settings', `
        <p class="muted">Admin controls picture limits and professional WhatsApp templates. Use placeholders: {{CandidateName}}, {{JobTitle}}, {{Branch}}, {{Phone}}, {{InterviewAt}}, {{InterviewLocation}}</p>
        <div class="field"><label>Max pictures per candidate</label>
          <input type="number" id="rec-max-pics" min="1" max="20" value="${s.max_pictures || 5}"></div>
        <div class="field"><label>Hire message</label><textarea id="rec-hire-msg" rows="5">${Utils.escHtml(s.hire_message || '')}</textarea></div>
        <div class="field"><label>Reject message</label><textarea id="rec-reject-msg" rows="5">${Utils.escHtml(s.reject_message || '')}</textarea></div>
        <div class="field"><label>Interview invite message</label><textarea id="rec-interview-msg" rows="5">${Utils.escHtml(s.interview_message || '')}</textarea></div>
        <div class="field"><label>Waitlist message</label><textarea id="rec-wait-msg" rows="5">${Utils.escHtml(s.waitlist_message || '')}</textarea></div>`,
        '<button class="btn btn-primary" id="rec-settings-save">Save Settings</button>');
      document.getElementById('rec-settings-save')?.addEventListener('click', async () => {
        const r = await API.saveRecruitmentSettings({
          max_pictures: parseInt(document.getElementById('rec-max-pics').value, 10) || 5,
          hire_message: document.getElementById('rec-hire-msg').value,
          reject_message: document.getElementById('rec-reject-msg').value,
          interview_message: document.getElementById('rec-interview-msg').value,
          waitlist_message: document.getElementById('rec-wait-msg')?.value
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast('Recruitment settings saved', 'success');
        this.render(el, admin);
      });
    },

    async showPostingCandidates(postingId, el, canRequestEmploy, isAdmin) {
      const panel = document.getElementById('rec-posting-candidates') || el;
      const [postRes, candRes, settingsRes] = await Promise.all([
        API.getJobPostings({}, this.app.user),
        API.getJobCandidates({ posting_id: postingId }, this.app.user),
        API.getRecruitmentSettings(this.app.user)
      ]);
      const posting = (postRes.data || []).find(p => p.id === postingId);
      const candidates = candRes.data || [];
      const maxPics = settingsRes.data?.max_pictures || 5;
      panel.innerHTML = `<div class="card"><div class="card-header" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between">
        <h4 style="margin:0">Candidates — ${Utils.escHtml(posting?.title || 'Job')}</h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-primary" id="rec-add-cand">+ Add Candidate</button>
          <button class="btn btn-sm btn-ghost" id="rec-sched-selected">Schedule Interview (selected)</button>
          <button class="btn btn-sm btn-success" id="rec-wa-selected">WhatsApp Interview Invite (selected)</button>
        </div></div>
        <div class="card-body"><div class="table-wrap"><table>
          <thead><tr><th></th><th>Name</th><th>Phone</th><th>Address</th><th>Status</th><th>Interview</th><th></th></tr></thead>
          <tbody>${candidates.map(c => `<tr>
            <td><input type="checkbox" class="rec-sel" data-id="${c.id}" ${c.status === 'hired' || c.status === 'rejected' ? 'disabled' : ''}></td>
            <td><strong>${Utils.escHtml(c.name)}</strong>${(c.pictures || []).length ? `<br><small class="muted">${c.pictures.length}/${maxPics} pics</small>` : ''}</td>
            <td>${Utils.escHtml(c.phone || '—')}</td>
            <td>${Utils.escHtml(c.address || c.location || '—')}</td>
            <td><span class="tag">${Utils.escHtml(c.status)}</span>${c.admin_decision ? `<br><small>${Utils.escHtml(c.admin_decision)}</small>` : ''}</td>
            <td>${c.interview_at ? Utils.formatDateTime(c.interview_at) : '—'}<br><small>${Utils.escHtml(c.interview_status || '')}</small></td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm btn-ghost rec-detail" data-id="${c.id}">View details</button>
              ${c.cv_path ? `<button class="btn btn-sm btn-ghost rec-cv" data-id="${c.id}" data-path="${Utils.escHtml(c.cv_path)}">Download CV</button>` : ''}
              ${isAdmin && c.status !== 'hired' && c.status !== 'rejected'
                ? `<button class="btn btn-sm btn-success rec-hire" data-id="${c.id}">Approve</button>
                   <button class="btn btn-sm btn-ghost rec-wait" data-id="${c.id}">Waitlist</button>
                   <button class="btn btn-sm btn-danger rec-reject" data-id="${c.id}">Reject</button>` : ''}
              ${isAdmin ? `<button class="btn btn-sm btn-danger rec-del-cand" data-id="${c.id}">Delete</button>` : ''}
              ${canRequestEmploy && !c.employ_request_by && c.status !== 'hired' && c.status !== 'rejected'
                ? `<button class="btn btn-sm btn-primary rec-request" data-id="${c.id}">Request Hire</button>` : ''}
              ${isAdmin && c.interview_status === 'result_uploaded' && !c.admin_decision
                ? `<button class="btn btn-sm btn-success rec-iv-approve" data-id="${c.id}">Approve interview</button>
                   <button class="btn btn-sm btn-danger rec-iv-reject" data-id="${c.id}">Reject interview</button>` : ''}
            </td></tr>`).join('') || '<tr><td colspan="7" class="muted">No candidates yet</td></tr>'}
        </tbody></table></div></div></div>`;

      const selectedIds = () => [...panel.querySelectorAll('.rec-sel:checked')].map(x => parseInt(x.dataset.id, 10));

      document.getElementById('rec-add-cand')?.addEventListener('click', () => {
        this.showAddCandidateModal(postingId, el, canRequestEmploy, isAdmin, maxPics);
      });

      document.getElementById('rec-sched-selected')?.addEventListener('click', () => {
        const ids = selectedIds();
        if (!ids.length) return Utils.toast('Select at least one candidate', 'error');
        this.showScheduleInterviewModal(ids, () => this.showPostingCandidates(postingId, el, canRequestEmploy, isAdmin));
      });

      document.getElementById('rec-wa-selected')?.addEventListener('click', async () => {
        const ids = selectedIds();
        if (!ids.length) return Utils.toast('Select at least one candidate', 'error');
        const settings = (await API.getRecruitmentSettings(this.app.user)).data || {};
        Utils.showModal('WhatsApp Interview Invite', `
          <p class="muted">Sends to ${ids.length} selected candidate(s). Edit the message if needed.</p>
          <div class="field"><label>Message</label><textarea id="rec-bulk-wa" rows="8">${Utils.escHtml(settings.interview_message || '')}</textarea></div>`,
          '<button class="btn btn-success" id="rec-bulk-wa-go">Send WhatsApp</button>');
        document.getElementById('rec-bulk-wa-go')?.addEventListener('click', async () => {
          const body = document.getElementById('rec-bulk-wa').value;
          const r = await API.sendJobInterviewWhatsAppBulk(ids, this.app.user, body);
          if (!r.success) return Utils.toast(r.error, 'error');
          Utils.hideModal();
          const results = r.data || [];
          let opened = 0;
          await Utils.deliverWhatsApp({ success: true, data: { urls: results.filter(row => row.url).map(row => row.url) } });
          for (const row of results) {
            if (row.url) opened += 1;
            else if (row.error) Utils.toast(`#${row.id}: ${row.error}`, 'error');
          }
          if (!opened) Utils.toast('No chats opened — check phones', 'error');
        });
      });

      panel.querySelectorAll('.rec-detail').forEach(b => b.addEventListener('click', () => {
        this.showCandidateDetails(parseInt(b.dataset.id, 10), isAdmin, () =>
          this.showPostingCandidates(postingId, el, canRequestEmploy, isAdmin));
      }));
      panel.querySelectorAll('.rec-cv').forEach(b => b.addEventListener('click', () => this.openCv(parseInt(b.dataset.id, 10), b.dataset.path)));
      panel.querySelectorAll('.rec-request').forEach(b => b.addEventListener('click', async () => {
        const r = await API.requestEmployCandidate(parseInt(b.dataset.id, 10), this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Employment request sent to admin', 'success');
        this.showPostingCandidates(postingId, el, canRequestEmploy, isAdmin);
      }));
      panel.querySelectorAll('.rec-hire').forEach(b => b.addEventListener('click', () =>
        this.decideAndWhatsApp(parseInt(b.dataset.id, 10), 'approved', () => this.showPostingCandidates(postingId, el, canRequestEmploy, isAdmin))));
      panel.querySelectorAll('.rec-wait').forEach(b => b.addEventListener('click', () =>
        this.decideAndWhatsApp(parseInt(b.dataset.id, 10), 'waitlisted', () => this.showPostingCandidates(postingId, el, canRequestEmploy, isAdmin))));
      panel.querySelectorAll('.rec-reject').forEach(b => b.addEventListener('click', () =>
        this.decideAndWhatsApp(parseInt(b.dataset.id, 10), 'rejected', () => this.showPostingCandidates(postingId, el, canRequestEmploy, isAdmin))));
      panel.querySelectorAll('.rec-iv-approve').forEach(b => b.addEventListener('click', async () => {
        const notes = prompt('Approval notes (optional):') || '';
        const r = await API.approveJobInterview(parseInt(b.dataset.id, 10), 'approved', notes, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Interview outcome approved — candidate hired', 'success');
        this.showPostingCandidates(postingId, el, canRequestEmploy, isAdmin);
      }));
      panel.querySelectorAll('.rec-iv-reject').forEach(b => b.addEventListener('click', async () => {
        const notes = prompt('Rejection notes:') || '';
        const r = await API.approveJobInterview(parseInt(b.dataset.id, 10), 'rejected', notes, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Interview outcome rejected', 'success');
        this.showPostingCandidates(postingId, el, canRequestEmploy, isAdmin);
      }));
      panel.querySelectorAll('.rec-del-cand').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Permanently delete this application? This cannot be undone.')) return;
        const r = await API.deleteJobCandidate(parseInt(b.dataset.id, 10), this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Application permanently deleted', 'success');
        this.showPostingCandidates(postingId, el, canRequestEmploy, isAdmin);
      }));
    },

    showAddCandidateModal(postingId, el, canRequestEmploy, isAdmin, maxPics) {
      const pendingPics = [];
      Utils.showModal('Add Candidate', `
        <div class="field"><label>Name *</label><input id="jc-name"></div>
        <div class="field"><label>Phone *</label><input id="jc-phone" placeholder="e.g. 0821234567"></div>
        <div class="field full"><label>Address *</label><input id="jc-address" placeholder="Street, suburb, city"></div>
        <div class="field"><label>Location / Area</label><input id="jc-loc"></div>
        <div class="field"><label>CV / resume *</label><button type="button" class="btn btn-ghost btn-sm" id="jc-pick-cv">Upload CV</button>
          <input type="hidden" id="jc-cv-path"><span id="jc-cv-label" class="muted" style="margin-left:8px;font-size:12px"></span></div>
        <div class="field"><label>Pictures (up to ${maxPics})</label>
          <button type="button" class="btn btn-ghost btn-sm" id="jc-pick-pic">Add picture</button>
          <div id="jc-pic-list" class="muted" style="margin-top:6px;font-size:12px"></div></div>`,
        `<button class="btn btn-primary" id="jc-save">Save Candidate</button>
         ${isAdmin ? '<button class="btn btn-success" id="jc-save-hire">Save &amp; Approve Hire</button>' : ''}`);

      const refreshPicList = () => {
        document.getElementById('jc-pic-list').textContent = pendingPics.length
          ? pendingPics.map(p => p.split(/[/\\]/).pop()).join(', ')
          : 'No pictures selected';
      };
      refreshPicList();

      document.getElementById('jc-pick-cv')?.addEventListener('click', async () => {
        const pick = await API.selectDocument('doc');
        if (pick.success && pick.path) {
          document.getElementById('jc-cv-path').value = pick.path;
          document.getElementById('jc-cv-label').textContent = pick.path.split(/[/\\]/).pop();
        }
      });
      document.getElementById('jc-pick-pic')?.addEventListener('click', async () => {
        if (pendingPics.length >= maxPics) return Utils.toast(`Max ${maxPics} pictures`, 'error');
        const pick = await API.selectImage('recruit');
        if (pick.success && pick.path) {
          pendingPics.push(pick.path);
          refreshPicList();
        }
      });

      const saveCandidate = async (autoHire) => {
        const name = document.getElementById('jc-name').value.trim();
        const phone = document.getElementById('jc-phone').value.trim();
        const address = document.getElementById('jc-address').value.trim();
        const cvPath = document.getElementById('jc-cv-path').value;
        if (!name) return Utils.toast('Name required', 'error');
        if (!phone) return Utils.toast('Phone number required', 'error');
        if (!address) return Utils.toast('Address required', 'error');
        if (!cvPath) return Utils.toast('Please upload a CV', 'error');
        let r = await API.saveJobCandidate({
          posting_id: postingId, name, phone,
          location: document.getElementById('jc-loc').value.trim() || address,
          address,
          cv_path: cvPath || null
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        const id = r.data?.id;
        if (cvPath && id) await API.attachJobCandidateCv(id, cvPath, this.app.user);
        for (const pic of pendingPics) {
          const pr = await API.attachJobCandidatePicture(id, pic, this.app.user);
          if (!pr.success) Utils.toast(pr.error || 'Picture upload failed', 'error');
        }
        let hiredMsg = null;
        if (autoHire && id) {
          await API.requestEmployCandidate(id, this.app.user);
          const hr = await API.decideJobCandidate(id, 'approved', 'Admin direct hire', this.app.user);
          hiredMsg = hr?.success === false ? (hr.error || 'Hire failed') : hireToast(hr);
        } else if (!isAdmin && id) {
          await API.requestEmployCandidate(id, this.app.user);
        }
        Utils.hideModal();
        Utils.toast(autoHire ? (hiredMsg || 'Candidate saved and approved') : 'Candidate saved — admin approval required for hire', autoHire && hiredMsg && !String(hiredMsg).startsWith('Hired') ? 'error' : 'success');
        this.showPostingCandidates(postingId, el, canRequestEmploy, isAdmin);
      };
      document.getElementById('jc-save').addEventListener('click', () => saveCandidate(false));
      document.getElementById('jc-save-hire')?.addEventListener('click', () => saveCandidate(true));
    },

    showScheduleInterviewModal(ids, onDone) {
      Utils.showModal('Schedule Interview', `
        <p class="muted">Scheduling for ${ids.length} candidate(s). Admin must still approve the final hire.</p>
        <div class="field"><label>Date &amp; time *</label><input type="datetime-local" id="iv-at"></div>
        <div class="field"><label>Venue / location</label><input id="iv-loc" placeholder="Branch address or Teams link"></div>
        <div class="field"><label>Interviewer name</label><input id="iv-who" placeholder="Who will interview"></div>
        <div class="field"><label>Notes</label><textarea id="iv-notes" rows="3"></textarea></div>`,
        '<button class="btn btn-primary" id="iv-save">Save Schedule</button>');
      document.getElementById('iv-save')?.addEventListener('click', async () => {
        const interview_at = document.getElementById('iv-at').value;
        if (!interview_at) return Utils.toast('Interview date/time required', 'error');
        const r = await API.scheduleJobInterview({
          candidate_ids: ids,
          interview_at: interview_at.replace('T', ' '),
          interview_location: document.getElementById('iv-loc').value.trim(),
          interview_assigned_to: document.getElementById('iv-who').value.trim(),
          interview_notes: document.getElementById('iv-notes').value.trim()
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast('Interview scheduled', 'success');
        if (onDone) onDone();
      });
    },

    async showCandidateDetails(candidateId, isAdmin, onDone) {
      const r = await API.getJobCandidate(candidateId, this.app.user);
      if (!r.success || !r.data) return Utils.toast(r.error || 'Candidate not found', 'error');
      const c = r.data;
      const pics = c.pictures || [];
      const settings = (await API.getRecruitmentSettings(this.app.user)).data || {};
      Utils.showModal(`Candidate — ${c.name}`, `
        <div style="display:grid;gap:8px;font-size:14px">
          <div><strong>Phone:</strong> ${Utils.escHtml(c.phone || '—')}</div>
          <div><strong>Address:</strong> ${Utils.escHtml(c.address || c.location || '—')}</div>
          <div><strong>Job:</strong> ${Utils.escHtml(c.posting_title || '—')}</div>
          <div><strong>Status:</strong> ${Utils.escHtml(c.status || '—')} · Interview: ${Utils.escHtml(c.interview_status || '—')}</div>
          <div><strong>Interview:</strong> ${c.interview_at ? Utils.formatDateTime(c.interview_at) : '—'}
            ${c.interview_location ? ` @ ${Utils.escHtml(c.interview_location)}` : ''}
            ${c.interview_assigned_to ? ` · Interviewer: ${Utils.escHtml(c.interview_assigned_to)}` : ''}</div>
          ${c.interview_notes ? `<div><strong>Notes:</strong> ${Utils.escHtml(c.interview_notes)}</div>` : ''}
          <div><strong>CV:</strong> ${c.cv_path
            ? `<button class="btn btn-sm btn-ghost" id="cd-cv">Open CV</button>` : 'Not uploaded'}</div>
          <div><strong>Pictures (${pics.length}/${settings.max_pictures || 5}):</strong>
            <button class="btn btn-sm btn-ghost" id="cd-add-pic">Upload picture</button>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
              ${pics.map((p, i) => `<button class="btn btn-sm btn-ghost cd-pic" data-path="${Utils.escHtml(p)}">Pic ${i + 1}</button>`).join('') || '<span class="muted">None</span>'}
            </div>
          </div>
          <div><strong>Interview pack:</strong>
            <button class="btn btn-sm btn-ghost" id="cd-iv-pdf">Create / save PDF</button>
            ${c.interview_doc_path ? `<button class="btn btn-sm btn-ghost" id="cd-iv-open">Open form</button>` : ''}
            <button class="btn btn-sm btn-ghost" id="cd-iv-upload">Upload result</button>
            ${c.interview_result_path ? `<button class="btn btn-sm btn-ghost" id="cd-iv-result">Open result</button>` : ''}
          </div>
        </div>`,
        `<button class="btn btn-ghost" id="cd-wa-interview">WA Interview</button>
         <button class="btn btn-success" id="cd-wa-hire">WA Got the job</button>
         <button class="btn btn-danger" id="cd-wa-reject">WA Not selected</button>
         ${isAdmin && c.interview_status === 'result_uploaded' && !c.admin_decision
           ? '<button class="btn btn-success" id="cd-approve-iv">Admin approve hire</button><button class="btn btn-danger" id="cd-reject-iv">Admin reject</button>'
           : ''}
         <button class="btn btn-primary" id="cd-close">Close</button>`);

      document.getElementById('cd-close')?.addEventListener('click', () => { Utils.hideModal(); if (onDone) onDone(); });
      document.getElementById('cd-cv')?.addEventListener('click', () => API.openPath(c.cv_path));
      document.getElementById('cd-iv-open')?.addEventListener('click', () => API.openPath(c.interview_doc_path));
      document.getElementById('cd-iv-result')?.addEventListener('click', () => API.openPath(c.interview_result_path));
      document.querySelectorAll('.cd-pic').forEach(b => b.addEventListener('click', () => API.openPath(b.dataset.path)));

      document.getElementById('cd-add-pic')?.addEventListener('click', async () => {
        const pick = await API.selectImage('recruit');
        if (!pick.success || !pick.path) return;
        const pr = await API.attachJobCandidatePicture(candidateId, pick.path, this.app.user);
        if (!pr.success) return Utils.toast(pr.error, 'error');
        Utils.toast('Picture uploaded', 'success');
        Utils.hideModal();
        this.showCandidateDetails(candidateId, isAdmin, onDone);
      });

      document.getElementById('cd-iv-pdf')?.addEventListener('click', async () => {
        const doc = await API.createJobInterviewDoc(candidateId, this.app.user);
        if (!doc.success) return Utils.toast(doc.error, 'error');
        await Utils.savePdfBuffer(`interview-${candidateId}.pdf`, { success: true, data: doc.data.buffer });
        if (doc.data.path) API.openPath(doc.data.path);
      });

      document.getElementById('cd-iv-upload')?.addEventListener('click', async () => {
        const pick = await API.selectDocument('interview-result');
        if (!pick.success || !pick.path) return;
        const ur = await API.uploadJobInterviewResult(candidateId, pick.path, this.app.user);
        if (!ur.success) return Utils.toast(ur.error, 'error');
        Utils.toast('Result uploaded — waiting for admin approval', 'success');
        Utils.hideModal();
        this.showCandidateDetails(candidateId, isAdmin, onDone);
      });

      const sendWa = async (type, defaultBody) => {
        Utils.showModal(`WhatsApp — ${type}`, `
          <p class="muted">Professional message to ${Utils.escHtml(c.name)}. Edit before sending.</p>
          <div class="field"><label>Message</label><textarea id="cd-wa-body" rows="10">${Utils.escHtml(defaultBody || '')}</textarea></div>`,
          '<button class="btn btn-success" id="cd-wa-go">Open WhatsApp</button>');
        document.getElementById('cd-wa-go')?.addEventListener('click', async () => {
          const body = document.getElementById('cd-wa-body').value;
          const wr = await API.sendJobCandidateWhatsApp(candidateId, type, this.app.user, body);
          if (!wr.success) return Utils.toast(wr.error, 'error');
          Utils.hideModal();
          await Utils.deliverWhatsApp(wr, c.phone, body);
        });
      };

      document.getElementById('cd-wa-interview')?.addEventListener('click', () => sendWa('interview', settings.interview_message));
      document.getElementById('cd-wa-hire')?.addEventListener('click', () => sendWa('hire', settings.hire_message));
      document.getElementById('cd-wa-reject')?.addEventListener('click', () => sendWa('reject', settings.reject_message));

      document.getElementById('cd-approve-iv')?.addEventListener('click', async () => {
        const notes = prompt('Approval notes (optional):') || '';
        const ar = await API.approveJobInterview(candidateId, 'approved', notes, this.app.user);
        if (!ar.success) return Utils.toast(ar.error, 'error');
        Utils.toast('Approved — candidate hired', 'success');
        Utils.hideModal();
        if (onDone) onDone();
      });
      document.getElementById('cd-reject-iv')?.addEventListener('click', async () => {
        const notes = prompt('Rejection notes:') || '';
        const ar = await API.approveJobInterview(candidateId, 'rejected', notes, this.app.user);
        if (!ar.success) return Utils.toast(ar.error, 'error');
        Utils.toast('Rejected', 'success');
        Utils.hideModal();
        if (onDone) onDone();
      });
    },

    collectJobForm() {
      return {
        title: document.getElementById('jp-title')?.value.trim(),
        description: document.getElementById('jp-desc')?.value.trim(),
        status: document.getElementById('jp-status')?.value,
        position: document.getElementById('jp-position')?.value.trim(),
        department: document.getElementById('jp-dept')?.value.trim(),
        branch: document.getElementById('jp-branch')?.value.trim(),
        employment_type: document.getElementById('jp-etype')?.value,
        hours: document.getElementById('jp-hours')?.value.trim(),
        salary_text: document.getElementById('jp-salary')?.value.trim(),
        salary_type: document.getElementById('jp-stype')?.value,
        vacancies: document.getElementById('jp-vac')?.value.trim(),
        experience: document.getElementById('jp-exp')?.value.trim(),
        education: document.getElementById('jp-edu')?.value.trim(),
        requirements: document.getElementById('jp-req')?.value.trim(),
        duties: document.getElementById('jp-duties')?.value.trim(),
        benefits: document.getElementById('jp-ben')?.value.trim(),
        closes_at: (() => {
          const day = document.getElementById('jp-close')?.value;
          const tm = document.getElementById('jp-close-time')?.value || '23:59';
          return day ? `${day}T${tm}` : '';
        })(),
        contact_name: document.getElementById('jp-cname')?.value.trim(),
        contact_phone: document.getElementById('jp-cphone')?.value.trim()
      };
    },

    showJobForm(posting, el, admin, isAdmin) {
      const p = posting || {};
      const x = p.extra || {};
      Utils.showModal(posting ? 'Edit Job Posting' : 'New Job Posting', `
        <p class="muted">Fill in the vacancy professionally. A poster, WhatsApp message, and online apply link are created when you save.</p>
        <div class="form-grid">
          <div class="field"><label>Job title *</label><input id="jp-title" value="${Utils.escHtml(p.title || '')}"></div>
          <div class="field"><label>Position needed</label><input id="jp-position" value="${Utils.escHtml(x.position || p.position_title || '')}" placeholder="e.g. Grill chef, Cashier"></div>
          <div class="field"><label>Department</label><input id="jp-dept" value="${Utils.escHtml(x.department || '')}"></div>
          <div class="field"><label>Branch / site</label><input id="jp-branch" value="${Utils.escHtml(x.branch || this.app.settings?.shop_name || '')}"></div>
          <div class="field"><label>Employment type</label>
            <select id="jp-etype">${['Permanent', 'Fixed-term', 'Part-time', 'Casual', 'Temporary', 'Learnership / Training'].map(t =>
              `<option ${ (x.employment_type || 'Permanent') === t ? 'selected' : '' }>${t}</option>`).join('')}</select></div>
          <div class="field"><label>Hours / shift</label><input id="jp-hours" value="${Utils.escHtml(x.hours || '')}" placeholder="e.g. 08:00–17:00, weekends"></div>
          <div class="field"><label>Salary / amount</label><input id="jp-salary" value="${Utils.escHtml(x.salary_text || p.salary_text || '')}" placeholder="e.g. R6 500 per month or Market related"></div>
          <div class="field"><label>Pay type</label>
            <select id="jp-stype">${['Monthly', 'Weekly', 'Daily', 'Hourly', 'To be discussed'].map(t =>
              `<option ${ (x.salary_type || 'Monthly') === t ? 'selected' : '' }>${t}</option>`).join('')}</select></div>
          <div class="field"><label>Number of vacancies</label><input id="jp-vac" value="${Utils.escHtml(x.vacancies || '1')}"></div>
          <div class="field"><label>Closing date</label><input type="date" id="jp-close" value="${Utils.escHtml(String(p.closes_at || x.closing_date || '').slice(0, 10))}"></div>
          <div class="field"><label>Closing time</label><input type="time" id="jp-close-time" value="${/T/.test(String(p.closes_at || '')) ? String(p.closes_at).slice(11, 16) : '23:59'}"></div>
          <div class="field"><label>Experience needed</label><input id="jp-exp" value="${Utils.escHtml(x.experience || '')}" placeholder="e.g. 1 year braai / kitchen"></div>
          <div class="field"><label>Education</label><input id="jp-edu" value="${Utils.escHtml(x.education || '')}" placeholder="e.g. Matric advantageous"></div>
          ${posting ? `<div class="field"><label>Status</label><select id="jp-status">
            ${['pending', 'active', 'closed'].map(s => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select></div>` : ''}
          <div class="field"><label>Contact person</label><input id="jp-cname" value="${Utils.escHtml(x.contact_name || '')}"></div>
          <div class="field"><label>Contact phone</label><input id="jp-cphone" value="${Utils.escHtml(x.contact_phone || this.app.settings?.phone || '')}"></div>
          <div class="field full"><label>About the role</label><textarea id="jp-desc" rows="3">${Utils.escHtml(p.description || '')}</textarea></div>
          <div class="field full"><label>Key duties</label><textarea id="jp-duties" rows="3">${Utils.escHtml(x.duties || '')}</textarea></div>
          <div class="field full"><label>Requirements</label><textarea id="jp-req" rows="3">${Utils.escHtml(x.requirements || '')}</textarea></div>
          <div class="field full"><label>Benefits</label><textarea id="jp-ben" rows="2">${Utils.escHtml(x.benefits || '')}</textarea></div>
        </div>`,
        `<button class="btn btn-primary" id="jp-save">${posting ? 'Save posting' : 'Create posting'}</button>`);
      document.getElementById('jp-save')?.addEventListener('click', async () => {
        const data = this.collectJobForm();
        if (!data.title) return Utils.toast('Job title is required', 'error');
        if (posting) data.id = posting.id;
        const r = await API.saveJobPosting(data, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast(posting ? 'Job posting updated' : (isAdmin ? 'Job posting created — poster and apply link are ready' : 'Submitted for admin approval'), 'success');
        this.render(el, admin);
      });
    },

    async showPoster(id) {
      const r = await API.getJobPosterPdf(id, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not build poster', 'error');
      const d = r.data || {};
      const applyUrl = d.apply_url || '';
      const shopName = d.shop?.shop_name || this.app.settings?.shop_name || 'Shop';
      const [png, qrCard] = await Promise.all([
        this.drawWhatsAppPoster(d),
        this.drawApplyQrCard(applyUrl, shopName)
      ]);
      Utils.showModal('Job poster & QR', `
        <p class="muted">WhatsApp status size (1080×1920) plus a QR card. Shop name is printed on the QR with “Scan me to apply for a job”.</p>
        ${applyUrl ? `<p><strong>Apply link</strong><br><input readonly value="${Utils.escHtml(applyUrl)}" style="width:100%"></p>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;max-height:58vh;overflow:auto;background:#0f172a;border-radius:12px;padding:10px">
          <div style="text-align:center">
            ${png ? `<img id="jp-poster-img" src="${png}" alt="Job poster" style="width:min(220px,70vw);height:auto;border-radius:10px">` : '<p class="muted">Could not draw picture</p>'}
            <div class="muted" style="color:#94a3b8;margin-top:6px">Hiring poster</div>
          </div>
          <div style="text-align:center">
            ${qrCard ? `<img id="jp-qr-img" src="${qrCard}" alt="Apply QR" style="width:min(220px,70vw);height:auto;border-radius:10px;background:#fff">` : '<p class="muted">Could not draw QR</p>'}
            <div class="muted" style="color:#94a3b8;margin-top:6px">${Utils.escHtml(shopName)} — scan to apply</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-primary" id="jp-poster-view">View picture</button>
          <button class="btn btn-ghost" id="jp-poster-save-img">Save picture</button>
          <button class="btn btn-success" id="jp-poster-save-qr">Save QR</button>
          <button class="btn btn-success" id="jp-poster-wa-img">Send on WhatsApp</button>
          <button class="btn btn-ghost" id="jp-poster-save">Save PDF</button>
          <button class="btn btn-ghost" id="jp-poster-wa">Share message</button>
        </div>`, '<button class="btn btn-ghost" id="jp-poster-close">Close</button>');
      document.getElementById('jp-poster-close')?.addEventListener('click', () => Utils.hideModal());
      document.getElementById('jp-poster-view')?.addEventListener('click', () => this.viewPosterPage(png, d));
      document.getElementById('jp-poster-save-img')?.addEventListener('click', () => this.downloadPosterPng(png, id));
      document.getElementById('jp-poster-save-qr')?.addEventListener('click', () => this.downloadPosterPng(qrCard, `job-qr-${id}`));
      document.getElementById('jp-poster-wa-img')?.addEventListener('click', () => this.sharePosterWhatsApp(png, d));
      document.getElementById('jp-poster-save')?.addEventListener('click', () =>
        Utils.savePdfBuffer(`job-poster-${id}.pdf`, { success: true, data: d.buffer }));
      document.getElementById('jp-poster-wa')?.addEventListener('click', () => this.showShare(id));
    },

    qrUrl(applyUrl, size = 360) {
      return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(applyUrl || '')}`;
    },

    async drawApplyQrCard(applyUrl, shopName) {
      if (!applyUrl) return '';
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 1180;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 900, 1180);
      ctx.fillStyle = '#0f2744';
      ctx.fillRect(0, 0, 900, 18);
      ctx.fillRect(0, 1162, 900, 18);
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'center';
      ctx.font = '800 54px system-ui,sans-serif';
      this.fitText(ctx, shopName || 'Shop', 450, 160, 800, 54);
      try {
        const img = await this.loadImg(this.qrUrl(applyUrl, 420));
        ctx.drawImage(img, 210, 220, 480, 480);
      } catch (_) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '600 22px system-ui,sans-serif';
        ctx.fillText(applyUrl, 450, 460);
      }
      ctx.fillStyle = '#0f172a';
      ctx.font = '800 36px system-ui,sans-serif';
      ctx.fillText('Scan me to apply for a job', 450, 800);
      ctx.fillStyle = '#64748b';
      ctx.font = '600 22px system-ui,sans-serif';
      this.wrapText(ctx, applyUrl, 450, 860, 760, 28, 3);
      return canvas.toDataURL('image/png');
    },

    viewPosterPage(png, d) {
      const shop = d.shop?.shop_name || this.app.settings?.shop_name || 'Job poster';
      const w = window.open('', '_blank', 'noopener,noreferrer');
      if (!w) {
        Utils.toast('Allow pop-ups to view the picture', 'error');
        return;
      }
      w.document.write(`<!doctype html><html><head><title>${shop} — Hiring poster</title>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{margin:0;background:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh}
        img{width:min(100vw,420px);height:auto;display:block}</style></head>
        <body>${png ? `<img src="${png}" alt="Job poster">` : '<p style="color:#fff">No picture</p>'}</body></html>`);
      w.document.close();
    },

    downloadPosterPng(png, id) {
      if (!png) return Utils.toast('Picture not ready', 'error');
      const a = document.createElement('a');
      a.href = png;
      a.download = `job-poster-${id}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      Utils.toast('Picture saved — add it to WhatsApp status or a chat', 'success');
    },

    async sharePosterWhatsApp(png, d) {
      const body = d.share?.body || `We are hiring. Apply: ${d.apply_url || ''}`;
      const phone = d.share?.phone || this.app.settings?.phone || '';
      if (png && navigator.share && navigator.canShare) {
        try {
          const blob = await (await fetch(png)).blob();
          const file = new File([blob], 'job-poster.png', { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Now hiring', text: body });
            return;
          }
        } catch (_) { /* fall through */ }
      }
      this.downloadPosterPng(png, d.posting?.id || 'job');
      await Utils.deliverWhatsApp({ success: true }, phone, `${body}\n\n(Attach the saved poster picture for WhatsApp / status)`);
    },

    async drawWhatsAppPoster(pack) {
      const posting = pack.posting || {};
      const extra = posting.extra || {};
      const shop = pack.shop || this.app.settings || {};
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1920;
      const ctx = canvas.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, 1920);
      g.addColorStop(0, '#0f2744');
      g.addColorStop(1, '#1e3a5f');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1080, 1920);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(0, 0, 1080, 14);
      ctx.fillRect(0, 1906, 1080, 14);
      if (pack.logo_data_url) {
        try {
          const img = await this.loadImg(pack.logo_data_url);
          const size = 168;
          ctx.fillStyle = '#fff';
          this.roundRect(ctx, 456, 48, size, size, 28);
          ctx.fill();
          ctx.drawImage(img, 468, 60, 144, 144);
        } catch (_) { /* skip logo */ }
      }
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.font = '700 28px system-ui,sans-serif';
      ctx.fillText('NOW HIRING', 540, 260);
      ctx.font = '800 72px system-ui,sans-serif';
      this.fitText(ctx, shop.shop_name || 'Our shop', 540, 350, 920, 72);
      ctx.font = '700 42px system-ui,sans-serif';
      ctx.fillStyle = '#fde68a';
      this.wrapText(ctx, posting.title || extra.position || 'Vacancy', 540, 430, 920, 50, 2);
      ctx.fillStyle = '#f59e0b';
      this.roundRect(ctx, 180, 540, 720, 78, 39);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.font = '800 30px system-ui,sans-serif';
      ctx.fillText(posting.closes_at ? `CLOSES ${String(posting.closes_at).slice(0, 10)}` : 'APPLICATIONS OPEN NOW', 540, 590);
      const rows = [
        ['Position', extra.position || posting.position_title || posting.title],
        ['Type', extra.employment_type],
        ['Hours', extra.hours],
        ['Salary', extra.salary_text || posting.salary_text],
        ['Branch', extra.branch || shop.shop_name],
        ['Experience', extra.experience]
      ].filter(([, v]) => v);
      let y = 680;
      rows.forEach(([k, v]) => {
        ctx.fillStyle = 'rgba(255,255,255,.08)';
        this.roundRect(ctx, 90, y, 900, 86, 18);
        ctx.fill();
        ctx.textAlign = 'left';
        ctx.fillStyle = '#94a3b8';
        ctx.font = '700 22px system-ui,sans-serif';
        ctx.fillText(String(k).toUpperCase(), 120, y + 34);
        ctx.fillStyle = '#fff';
        ctx.font = '700 30px system-ui,sans-serif';
        ctx.fillText(String(v).slice(0, 42), 120, y + 68);
        y += 100;
      });
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '600 26px system-ui,sans-serif';
      this.wrapText(ctx, extra.requirements || posting.description || 'Apply online with your name, WhatsApp number and CV.', 540, Math.min(y + 30, 1360), 880, 34, 3);
      ctx.fillStyle = '#ffffff';
      this.roundRect(ctx, 90, 1480, 900, 380, 28);
      ctx.fill();
      try {
        const qr = await this.loadImg(this.qrUrl(pack.apply_url || '', 280));
        ctx.drawImage(qr, 130, 1520, 280, 280);
      } catch (_) { /* skip qr */ }
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'left';
      ctx.font = '800 36px system-ui,sans-serif';
      this.fitText(ctx, shop.shop_name || 'Shop', 440, 1620, 500, 36);
      ctx.font = '800 28px system-ui,sans-serif';
      ctx.fillText('Scan me to apply', 440, 1680);
      ctx.fillText('for a job', 440, 1718);
      ctx.fillStyle = '#64748b';
      ctx.font = '600 18px system-ui,sans-serif';
      ctx.fillText('Or open the apply link', 440, 1770);
      return canvas.toDataURL('image/png');
    },

    loadImg(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    },

    roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },

    fitText(ctx, text, x, y, max, size) {
      let s = size;
      ctx.font = `800 ${s}px system-ui,sans-serif`;
      while (s > 28 && ctx.measureText(text).width > max) {
        s -= 2;
        ctx.font = `800 ${s}px system-ui,sans-serif`;
      }
      ctx.fillText(text, x, y);
    },

    wrapText(ctx, text, x, y, max, lineH, maxLines) {
      const words = String(text || '').split(/\s+/);
      let line = '';
      let used = 0;
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > max && line) {
          ctx.fillText(line, x, y);
          y += lineH;
          line = word;
          used += 1;
          if (used >= maxLines - 1) break;
        } else line = test;
      }
      if (line && used < maxLines) ctx.fillText(line, x, y);
    },

    async showShare(id) {
      const r = await API.getJobShareMessage(id, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not build message', 'error');
      const d = r.data || {};
      Utils.showModal('Hiring message', `
        <p class="muted">Professional WhatsApp text with the vacancy, online ordering link, and the apply link for this posting.</p>
        <div class="field"><label>Apply link</label><input readonly value="${Utils.escHtml(d.apply_url || '')}"></div>
        <div class="field"><label>Online ordering</label><input readonly value="${Utils.escHtml(d.order_url || '')}"></div>
        <div class="field"><label>Message</label><textarea id="jp-share-body" rows="12">${Utils.escHtml(d.body || '')}</textarea></div>`,
        '<button class="btn btn-success" id="jp-share-go">Open WhatsApp</button>');
      document.getElementById('jp-share-go')?.addEventListener('click', async () => {
        const body = document.getElementById('jp-share-body').value;
        Utils.hideModal();
        await Utils.deliverWhatsApp({ success: true }, d.phone || '', body);
      });
    },

    async openCv(id, fallbackPath) {
      if (id) {
        const r = await API.downloadJobCandidateCv(id, this.app.user);
        if (r.success && r.data?.buffer) {
          const name = r.data.filename || `cv-${id}.pdf`;
          if (String(name).toLowerCase().endsWith('.pdf')) {
            await Utils.savePdfBuffer(name, { success: true, data: r.data.buffer });
          } else {
            await API.saveFile(name, [{ name: 'Document', extensions: ['*'] }], r.data.buffer);
          }
          return;
        }
      }
      if (fallbackPath) API.openPath(fallbackPath);
      else Utils.toast('CV is not available', 'error');
    },

    async decideAndWhatsApp(id, decision, onDone) {
      const notes = decision === 'rejected' ? (prompt('Rejection notes (optional):') || '') : '';
      const r = await API.decideJobCandidate(id, decision, notes, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      if (decision === 'approved') Utils.toast(hireToast(r), 'success');
      else if (decision === 'waitlisted') Utils.toast('Applicant waitlisted', 'success');
      else Utils.toast('Applicant rejected', 'success');
      const wa = r.data?._whatsapp || (await API.previewJobCandidateWhatsApp(id, decision === 'approved' ? 'hire' : decision === 'waitlisted' ? 'waitlist' : 'reject', this.app.user)).data;
      if (!wa?.phone) {
        Utils.toast('No WhatsApp number on this application', 'error');
        if (onDone) onDone();
        return;
      }
      Utils.showModal(decision === 'approved' ? 'Send offer on WhatsApp' : decision === 'waitlisted' ? 'Send waitlist WhatsApp' : 'Send rejection on WhatsApp', `
        <p class="muted">The decision is saved. Send this professional message to <strong>${Utils.escHtml(wa.name || '')}</strong> on <strong>${Utils.escHtml(wa.phone)}</strong>.</p>
        <div class="field"><label>Message</label><textarea id="dec-wa-body" rows="12">${Utils.escHtml(wa.body || '')}</textarea></div>`,
        '<button class="btn btn-success" id="dec-wa-go">Send to applicant WhatsApp</button>');
      document.getElementById('dec-wa-go')?.addEventListener('click', async () => {
        const body = document.getElementById('dec-wa-body').value;
        const wr = await API.sendJobCandidateWhatsApp(id, wa.type || 'reject', this.app.user, body);
        Utils.hideModal();
        await Utils.deliverWhatsApp(wr, wa.phone, body);
        if (onDone) onDone();
      });
    }
  };

  window.AdminRecruitmentPage = AdminRecruitmentPage;

})();

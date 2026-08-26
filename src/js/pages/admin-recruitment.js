// Admin — Recruitment / Jobs (candidates, interviews, WhatsApp, admin approval)
(function () {
  if (!window.AdminPage) return;

  if (!AdminPage.sections.some(s => s.id === 'recruitment')) {
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
      this.app = admin.app;
      this.expandedPostingId = this.expandedPostingId || null;
      const isAdmin = ['owner', 'manager'].includes(this.app.user?.role);
      const canRequestEmploy = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(this.app.user?.role);

      el.innerHTML = `<div class="admin-section"><h3>Recruitment</h3>
        <p class="muted">Record candidates, schedule interviews, send WhatsApp updates, and require admin approval for hire/reject.</p>
        <div id="rec-content"><p class="muted">Loading…</p></div></div>`;

      const content = document.getElementById('rec-content');
      const [postRes, pendingRes, interviewRes, settingsRes] = await Promise.all([
        API.getJobPostings({}, this.app.user),
        API.getJobCandidates({ employ_requested: true }, this.app.user),
        API.getJobCandidates({ interview_pending: true }, this.app.user),
        API.getRecruitmentSettings(this.app.user)
      ]);
      const postings = postRes.data || [];
      const pendingMap = new Map();
      [...(pendingRes.data || []), ...(interviewRes.data || [])]
        .filter(c => !c.admin_decision)
        .forEach(c => pendingMap.set(c.id, c));
      const pending = [...pendingMap.values()];
      const settings = settingsRes.data || { max_pictures: 5 };

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
          <td><strong>${Utils.escHtml(p.title)}</strong><br><small class="muted">${Utils.escHtml((p.description || '').slice(0, 80))}</small></td>
          <td><span class="tag">${Utils.escHtml(p.status)}</span></td>
          <td>${Utils.formatDateTime(p.created_at)}<br><small>${Utils.escHtml(p.created_by_name || '')}</small></td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-ghost rec-view-cands" data-id="${p.id}">Candidates</button>
            ${isAdmin ? `<button class="btn btn-sm btn-ghost rec-edit-job" data-id="${p.id}">Edit</button>
              <button class="btn btn-sm btn-danger rec-del-job" data-id="${p.id}">Delete</button>` : ''}
            ${isAdmin && p.status === 'pending' ? `<button class="btn btn-sm btn-success rec-approve" data-id="${p.id}">Approve</button>
              <button class="btn btn-sm btn-danger rec-reject-post" data-id="${p.id}">Reject</button>` : ''}
            ${isAdmin && p.status === 'active' ? `<button class="btn btn-sm btn-warning rec-close" data-id="${p.id}">Close</button>` : ''}
          </td></tr>`).join('') || '<tr><td colspan="4" class="muted">No job postings</td></tr>'}
        </tbody></table></div>
        <div id="rec-posting-candidates" style="margin-top:16px"></div>`;

      document.getElementById('rec-settings')?.addEventListener('click', () => this.showSettingsModal(el, admin, settings));

      document.getElementById('rec-new-job')?.addEventListener('click', () => {
        Utils.showModal('New Job Posting', `
          <div class="field"><label>Title *</label><input id="jp-title"></div>
          <div class="field"><label>Description</label><textarea id="jp-desc" rows="4"></textarea></div>`,
          '<button class="btn btn-primary" id="jp-save">Submit</button>');
        document.getElementById('jp-save').addEventListener('click', async () => {
          const title = document.getElementById('jp-title').value.trim();
          if (!title) return Utils.toast('Title required', 'error');
          const r = await API.saveJobPosting({ title, description: document.getElementById('jp-desc').value.trim() }, this.app.user);
          if (!r.success) return Utils.toast(r.error, 'error');
          Utils.hideModal();
          Utils.toast(isAdmin ? 'Job posting created' : 'Submitted for admin approval', 'success');
          this.render(el, admin);
        });
      });

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
        const id = parseInt(b.dataset.id, 10);
        const posting = postings.find(p => p.id === id);
        if (!posting) return;
        Utils.showModal('Edit Job Posting', `
          <div class="field"><label>Title *</label><input id="jp-title" value="${Utils.escHtml(posting.title || '')}"></div>
          <div class="field"><label>Description</label><textarea id="jp-desc" rows="4">${Utils.escHtml(posting.description || '')}</textarea></div>
          <div class="field"><label>Status</label><select id="jp-status">
            ${['pending', 'active', 'closed'].map(s => `<option value="${s}" ${posting.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select></div>`,
          '<button class="btn btn-primary" id="jp-save-edit">Save</button>');
        document.getElementById('jp-save-edit')?.addEventListener('click', async () => {
          const title = document.getElementById('jp-title').value.trim();
          if (!title) return Utils.toast('Title required', 'error');
          const r = await API.saveJobPosting({
            id,
            title,
            description: document.getElementById('jp-desc').value.trim(),
            status: document.getElementById('jp-status').value
          }, this.app.user);
          if (!r.success) return Utils.toast(r.error, 'error');
          Utils.hideModal();
          Utils.toast('Job posting updated', 'success');
          this.render(el, admin);
        });
      }));
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

      content.querySelectorAll('.rec-pending-cv').forEach(b => b.addEventListener('click', () => API.openPath(b.dataset.path)));
      content.querySelectorAll('.rec-pending-detail').forEach(b => b.addEventListener('click', () => {
        this.showCandidateDetails(parseInt(b.dataset.id, 10), isAdmin, () => this.render(el, admin));
      }));
      content.querySelectorAll('.rec-pending-hire').forEach(b => b.addEventListener('click', async () => {
        const r = await API.decideJobCandidate(parseInt(b.dataset.id, 10), 'approved', '', this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast(hireToast(r), 'success');
        this.render(el, admin);
      }));
      content.querySelectorAll('.rec-pending-reject').forEach(b => b.addEventListener('click', async () => {
        const notes = prompt('Rejection notes:') || '';
        await API.decideJobCandidate(parseInt(b.dataset.id, 10), 'rejected', notes, this.app.user);
        this.render(el, admin);
      }));

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
        <div class="field"><label>Interview invite message</label><textarea id="rec-interview-msg" rows="5">${Utils.escHtml(s.interview_message || '')}</textarea></div>`,
        '<button class="btn btn-primary" id="rec-settings-save">Save Settings</button>');
      document.getElementById('rec-settings-save')?.addEventListener('click', async () => {
        const r = await API.saveRecruitmentSettings({
          max_pictures: parseInt(document.getElementById('rec-max-pics').value, 10) || 5,
          hire_message: document.getElementById('rec-hire-msg').value,
          reject_message: document.getElementById('rec-reject-msg').value,
          interview_message: document.getElementById('rec-interview-msg').value
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
              ${c.cv_path ? `<button class="btn btn-sm btn-ghost rec-cv" data-path="${Utils.escHtml(c.cv_path)}">CV</button>` : ''}
              ${canRequestEmploy && !c.employ_request_by && c.status !== 'hired' && c.status !== 'rejected'
                ? `<button class="btn btn-sm btn-primary rec-request" data-id="${c.id}">Request Hire</button>` : ''}
              ${isAdmin && c.employ_request_by && !c.admin_decision
                ? `<button class="btn btn-sm btn-success rec-hire" data-id="${c.id}">Approve</button>
                   <button class="btn btn-sm btn-danger rec-reject" data-id="${c.id}">Reject</button>` : ''}
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
      panel.querySelectorAll('.rec-cv').forEach(b => b.addEventListener('click', () => API.openPath(b.dataset.path)));
      panel.querySelectorAll('.rec-request').forEach(b => b.addEventListener('click', async () => {
        const r = await API.requestEmployCandidate(parseInt(b.dataset.id, 10), this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Employment request sent to admin', 'success');
        this.showPostingCandidates(postingId, el, canRequestEmploy, isAdmin);
      }));
      panel.querySelectorAll('.rec-hire').forEach(b => b.addEventListener('click', async () => {
        const r = await API.decideJobCandidate(parseInt(b.dataset.id, 10), 'approved', '', this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast(hireToast(r), 'success');
        this.showPostingCandidates(postingId, el, canRequestEmploy, isAdmin);
      }));
      panel.querySelectorAll('.rec-reject').forEach(b => b.addEventListener('click', async () => {
        const notes = prompt('Rejection notes:') || '';
        await API.decideJobCandidate(parseInt(b.dataset.id, 10), 'rejected', notes, this.app.user);
        this.showPostingCandidates(postingId, el, canRequestEmploy, isAdmin);
      }));
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
    }
  };

  window.AdminRecruitmentPage = AdminRecruitmentPage;

  const origRenderSection = AdminPage.renderSection.bind(AdminPage);
  AdminPage.renderSection = async function (el) {
    if (this.section === 'hrcontracts' && window.AdminHrPage) {
      el.innerHTML = '<p class="muted">Loading…</p>';
      return AdminHrPage.render(el, this);
    }
    if (this.section === 'recruitment' && window.AdminRecruitmentPage) {
      el.innerHTML = '<p class="muted">Loading…</p>';
      return AdminRecruitmentPage.render(el, this);
    }
    if (this.section === 'employee-of-month' && window.AdminEmployeeMonthPage) {
      el.innerHTML = '<p class="muted">Loading…</p>';
      return AdminEmployeeMonthPage.render(el, this);
    }
    return origRenderSection(el);
  };
})();

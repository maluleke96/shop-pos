(function () {
  const Page = {
    async render(el, admin) {
      const actor = admin.app?.user || admin.user;
      el.innerHTML = '<div class="admin-section"><h3>Employee Documents</h3><p class="muted">Loading records…</p></div>';
      let board;
      let templates;
      let people;
      try {
        const [dash, forms, employees] = await Promise.all([
          API.hrDocDashboard({}, actor),
          API.hrDocTemplates(actor),
          API.hrDocEmployees(actor)
        ]);
        if (dash?.success === false) throw new Error(dash.error);
        board = dash.data || dash;
        templates = (forms.data || forms) || [];
        people = (employees.data || employees) || [];
      } catch (err) {
        el.innerHTML = `<div class="admin-section"><h3>Employee Documents</h3><p>${Utils.escHtml(err.message || 'Could not open documents')}</p></div>`;
        return;
      }
      const counts = [
        ['Templates', board.templates],
        ['Awaiting signature', board.awaiting_employee],
        ['Drafts', board.drafts],
        ['Completed', board.completed],
        ['Declined', board.declined],
        ['Expired', board.expired],
        ['Overdue', board.overdue],
        ['Cancelled', board.revoked]
      ];
      el.innerHTML = `<div class="admin-section">
        <h3>Employee Documents</h3>
        <p class="muted">A signed form is kept with the employee file. It does not pass probation, dismiss anyone, or change pay.</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin:12px 0">${counts.map(([label, n]) =>
          `<div class="box" style="min-width:120px"><strong>${Number(n) || 0}</strong><div class="muted">${Utils.escHtml(label)}</div></div>`).join('')}</div>
        <h4>Send a document</h4>
        <label>Employee</label>
        <select id="doc-employee"><option value="">Applicant, not yet an employee</option>${people.map((p) =>
          `<option value="${p.id}">${Utils.escHtml(p.name)} · ${Utils.escHtml(p.branch || '')}</option>`).join('')}</select>
        <label>Applicant name, if there is no employee record yet</label>
        <input id="doc-applicant" placeholder="Full name">
        <label>Document</label>
        <select id="doc-code">${templates.map((t) => `<option value="${Utils.escHtml(t.code)}">${Utils.escHtml(t.title)}</option>`).join('')}</select>
        <label>Link expires in days</label>
        <input id="doc-days" type="number" min="1" max="30" value="7">
        <button id="doc-send" type="button" style="margin-top:12px">Create document</button>
        <p id="doc-result" class="muted"></p>
        <h4>Records</h4>
        <input id="doc-search" placeholder="Search employee, branch, document or status">
        <div id="doc-list"></div>
      </div>`;
      const paint = (q) => {
        const needle = String(q || '').toLowerCase();
        const rows = (board.documents || []).filter((row) => !needle || `${row.title} ${row.employee} ${row.branch} ${row.status} ${row.code}`.toLowerCase().includes(needle));
        el.querySelector('#doc-list').innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>Document</th><th>Person</th><th>Branch</th><th>Status</th><th></th></tr></thead><tbody>${
          rows.map((row) => `<tr>
            <td>${Utils.escHtml(row.title || '')}<div class="muted">HR-${row.id}</div></td>
            <td>${Utils.escHtml(row.employee || '')}</td>
            <td>${Utils.escHtml(row.branch || '')}</td>
            <td>${Utils.escHtml(row.status || '')}</td>
            <td>
              ${row.status === 'submitted' ? `<button type="button" data-pdf="${row.id}">PDF</button>` : ''}
              ${row.status === 'draft' ? `<button type="button" data-fill="${row.id}">Complete</button>` : ''}
              ${['active', 'opened', 'draft'].includes(row.status) ? `<button type="button" data-revoke="${row.id}">Cancel</button>` : ''}
              ${row.status !== 'submitted' && row.status !== 'draft' ? `<button type="button" data-resend="${row.id}">New link</button>` : ''}
            </td>
          </tr>`).join('')
        }</tbody></table>` : '<p class="muted">No documents match.</p>';
      };
      paint('');
      el.querySelector('#doc-search').addEventListener('input', (event) => paint(event.target.value));
      el.querySelector('#doc-send').addEventListener('click', async () => {
        const result = el.querySelector('#doc-result');
        result.textContent = 'Creating…';
        try {
          const sent = await API.hrDocIssue({
            employee_id: el.querySelector('#doc-employee').value || null,
            applicant_name: el.querySelector('#doc-applicant').value,
            code: el.querySelector('#doc-code').value,
            expires_days: Number(el.querySelector('#doc-days').value) || 7
          }, actor);
          const data = sent.data || sent;
          if (sent.success === false) throw new Error(sent.error);
          result.textContent = data.url
            ? `Link ready. ${data.notification_sent ? 'WhatsApp was sent.' : (data.notification_error || 'Copy the link and send it yourself.')} ${data.url}`
            : 'Manager record created. Complete it from the list. It was not sent to the employee.';
          this.render(el, admin);
        } catch (err) { result.textContent = err.message || 'Could not create the document'; }
      });
      el.querySelector('#doc-list').addEventListener('click', async (event) => {
        const pdf = event.target.getAttribute('data-pdf');
        const revoke = event.target.getAttribute('data-revoke');
        const resend = event.target.getAttribute('data-resend');
        const fill = event.target.getAttribute('data-fill');
        try {
          if (pdf) {
            const file = await API.hrDocDownload(pdf, actor);
            const data = file.data || file;
            if (file.success === false) throw new Error(file.error);
            const binary = atob(data.pdf_base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
            window.open(url, '_blank', 'noopener');
          }
          if (revoke) {
            const done = await API.hrDocRevoke(revoke, actor);
            if (done.success === false) throw new Error(done.error);
            this.render(el, admin);
          }
          if (resend) {
            const done = await API.hrDocResend(resend, actor);
            const data = done.data || done;
            if (done.success === false) throw new Error(done.error);
            window.prompt('Copy this new link. The previous link no longer works.', data.url || '');
            this.render(el, admin);
          }
          if (fill) {
            const notes = window.prompt('Notes for this manager record');
            if (notes == null) return;
            const done = await API.hrDocComplete(fill, { note: notes, fields: {} }, actor);
            if (done.success === false) throw new Error(done.error);
            this.render(el, admin);
          }
        } catch (err) { Utils.toast(err.message || 'Could not update the document', 'error'); }
      });
    }
  };
  window.AdminHrDocumentsPage = Page;
})();

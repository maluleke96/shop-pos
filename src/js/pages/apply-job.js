// Public job application — /apply/?job=TOKEN, admin fallback, or in-page Order Online popup
(function () {
  async function rpc(method, args) {
    if (window.API) {
      const map = {
        'jobs:getPublicPosting': () => window.API.getPublicJobPosting?.(args[0]),
        'jobs:listPublicPostings': () => window.API.listPublicJobPostings?.(),
        'jobs:getPublicApplication': () => window.API.getPublicJobApplication?.(args[0]),
        'jobs:lookupPublicApplication': () => window.API.lookupPublicJobApplication?.(args[0], args[1]),
        'jobs:submitPublicApplication': () => window.API.submitPublicJobApplication?.(args[0], args[1]),
        'jobs:updatePublicApplication': () => window.API.updatePublicJobApplication?.(args[0], args[1]),
        'jobs:deletePublicApplication': () => window.API.deletePublicJobApplication?.(args[0])
      };
      if (typeof map[method] === 'function' && window.posAPI) {
        const r = await map[method]();
        if (r) return r;
      }
    }
    const r = await fetch('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args: args || [] })
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok && !json.error) json.error = `Request failed (${r.status})`;
    if (!Object.prototype.hasOwnProperty.call(json, 'success')) {
      return { success: !json.error, data: json.data != null ? json.data : json, error: json.error };
    }
    return json;
  }

  function storageKey(token) {
    return `shoppos_job_app_${String(token || '').trim()}`;
  }

  const ApplyJobPage = {
    async render() {
      const mount = document.getElementById('apply-mount');
      if (mount) {
        return this.renderInto(mount, { standalone: true });
      }
      document.body.innerHTML = `<div id="apply-root" style="min-height:100vh;background:#f1f5f9;color:#0f172a;font-family:system-ui,sans-serif">
        <div style="max-width:760px;margin:0 auto;padding:28px 16px 64px">
          <div id="apply-body"><p style="text-align:center;color:#64748b">Loading vacancy…</p></div>
        </div>
      </div>`;
      return this.renderInto(document.getElementById('apply-body'), { standalone: true });
    },

    async renderInto(el, opts = {}) {
      if (!el) return;
      this._opts = opts;
      const token = opts.token
        || new URLSearchParams(location.search || '').get('job')
        || new URLSearchParams(String(location.hash || '').replace(/^#/, '')).get('job')
        || '';
      if (!token) {
        return this.renderJobPicker(el, opts);
      }
      return this.renderForm(el, token, opts);
    },

    async renderJobPicker(el, opts) {
      el.innerHTML = `<p style="text-align:center;color:#64748b">Loading vacancies…</p>`;
      const r = await rpc('jobs:listPublicPostings', []);
      if (!r.success) {
        el.innerHTML = `<div style="background:#fff;border-radius:16px;padding:28px">
          <h1 style="margin:0 0 8px;font-size:22px">Careers</h1>
          <p style="color:#64748b">${this.esc(r.error || 'Could not load vacancies.')}</p></div>`;
        return;
      }
      const jobs = r.data || [];
      if (!jobs.length) {
        el.innerHTML = `<div style="background:#fff;border-radius:16px;padding:28px;text-align:center">
          <h1 style="margin:0 0 8px;font-size:22px">No open vacancies</h1>
          <p style="color:#64748b">There is no job application open right now. Please check again later.</p>
        </div>`;
        return;
      }
      if (jobs.length === 1) {
        return this.renderForm(el, jobs[0].apply_token, opts);
      }
      el.innerHTML = `<div style="background:#fff;border-radius:16px;padding:24px">
        <h1 style="margin:0 0 8px;font-size:22px">Apply for a job</h1>
        <p style="color:#64748b">Choose a vacancy to continue.</p>
        <div style="display:grid;gap:10px;margin-top:16px">
          ${jobs.map((j) => `<button type="button" class="btn btn-ghost ap-pick" data-token="${this.esc(j.apply_token)}" style="text-align:left;padding:14px">
            <strong>${this.esc(j.title)}</strong>
            ${j.closes_at ? `<div style="font-size:12px;color:#64748b">Closes ${this.esc(String(j.closes_at).slice(0, 16).replace('T', ' '))}</div>` : ''}
          </button>`).join('')}
        </div>
      </div>`;
      el.querySelectorAll('.ap-pick').forEach((b) => b.addEventListener('click', () => {
        this.renderForm(el, b.dataset.token, opts);
      }));
    },

    async renderForm(el, token, opts) {
      el.innerHTML = `<p style="text-align:center;color:#64748b">Loading vacancy…</p>`;
      const r = await rpc('jobs:getPublicPosting', [token]);
      if (!r.success) {
        el.innerHTML = `<div style="background:#fff;border-radius:16px;padding:28px">
          <h1 style="margin:0 0 8px;font-size:22px">Vacancy unavailable</h1>
          <p style="color:#64748b">${this.esc(r.error || 'This job is no longer open.')}</p></div>`;
        return;
      }
      const p = r.data;
      const extra = p.extra || {};
      const shop = p.shop || {};
      const shopName = shop.shop_name || 'Careers';
      if (opts.standalone !== false) document.title = `${shopName} — ${p.title || 'Apply'}`;
      this.setFavicon(shop.logo_url || shop.logo_data_url || '/api/logo');
      const closeAt = this.closeDate(p.closes_at);
      const closed = !!p.closed || !!(closeAt && closeAt.getTime() <= Date.now());
      let existing = null;
      const saved = this.readSaved(token);
      if (saved?.edit_token) {
        const er = await rpc('jobs:getPublicApplication', [saved.edit_token]);
        if (er.success) existing = er.data;
        else this.clearSaved(token);
      }

      el.innerHTML = `
        <header style="background:linear-gradient(160deg,#0f2744,#1e3a5f);color:#fff;border-radius:20px;padding:28px 24px 22px;margin-bottom:16px;text-align:center">
          ${shop.logo_url || shop.logo_data_url ? `<img src="${this.esc(shop.logo_data_url || shop.logo_url)}" alt="" style="height:72px;max-width:160px;object-fit:contain;background:#fff;border-radius:14px;padding:6px;margin-bottom:12px" onerror="this.style.display='none'">` : ''}
          <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.75">Now hiring</div>
          <h1 style="margin:8px 0 6px;font-size:clamp(28px,7vw,48px);line-height:1.05;letter-spacing:-.03em">${this.esc(shopName)}</h1>
          <p style="margin:0 0 14px;font-size:20px;font-weight:650">${this.esc(p.title)}</p>
          <div style="font-size:13px;opacity:.9">${[shop.address, shop.phone].filter(Boolean).map((x) => this.esc(x)).join(' · ')}</div>
          <div id="apply-close-chip" style="margin-top:14px;display:inline-block;background:#f59e0b;color:#1e293b;font-weight:800;font-size:14px;padding:8px 14px;border-radius:999px">
            ${closeAt ? `Closes ${this.esc(this.fmtClose(closeAt))}` : 'Applications open'}
          </div>
          <div id="apply-countdown" style="margin-top:10px;font-size:22px;font-weight:800;letter-spacing:.04em">${closeAt && !closed ? this.fmtRemain(closeAt) : ''}</div>
        </header>
        <section style="background:#fff;border-radius:16px;padding:20px;margin-bottom:16px;box-shadow:0 8px 24px rgba(15,23,42,.06)">
          ${this.meta(extra, p)}
          ${p.description ? `<h3>About the role</h3><p style="white-space:pre-wrap;line-height:1.5">${this.esc(p.description)}</p>` : ''}
          ${extra.duties ? `<h3>Duties</h3><p style="white-space:pre-wrap">${this.esc(extra.duties)}</p>` : ''}
          ${extra.requirements ? `<h3>Requirements</h3><p style="white-space:pre-wrap">${this.esc(extra.requirements)}</p>` : ''}
          ${extra.benefits ? `<h3>Benefits</h3><p style="white-space:pre-wrap">${this.esc(extra.benefits)}</p>` : ''}
        </section>
        <section id="apply-form-card" style="background:#fff;border-radius:16px;padding:20px;box-shadow:0 8px 24px rgba(15,23,42,.06)">
          <h2 style="margin-top:0">${existing ? 'Edit your application' : 'Submit your application'}</h2>
          <p style="color:#64748b">${existing
            ? 'You can update your details or permanently delete this application.'
            : 'Please complete your details and upload your CV. We will contact you on WhatsApp.'}</p>
          <div class="field"><label>Full name *</label><input id="ap-name" value="${this.esc(existing?.name || '')}"></div>
          <div class="field"><label>WhatsApp / phone *</label><input id="ap-phone" placeholder="e.g. 0821234567" value="${this.esc(existing?.phone || '')}"></div>
          <div class="field"><label>Email</label><input id="ap-email" type="email" value="${this.esc(existing?.email || '')}"></div>
          <div class="field"><label>Residential address</label><input id="ap-address" value="${this.esc(existing?.address || '')}"></div>
          <div class="field"><label>Area / location</label><input id="ap-loc" value="${this.esc(existing?.location || '')}"></div>
          <div class="field"><label>Cover note</label><textarea id="ap-notes" rows="3" placeholder="Why you are applying, availability, etc.">${this.esc(existing?.notes || '')}</textarea></div>
          <div class="field"><label>Upload CV (PDF or Word) ${existing?.has_cv ? '' : '*'}</label>
            <input type="file" id="ap-cv" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
            <small id="ap-cv-label" style="color:#64748b">${existing?.has_cv ? 'A CV is already on file. Upload again only if you want to replace it.' : ''}</small></div>
          ${existing ? '' : `<details style="margin:10px 0"><summary style="cursor:pointer;color:#475569">Already applied? Find your application</summary>
            <div class="field" style="margin-top:10px"><label>Phone used on the application</label>
              <input id="ap-find-phone" placeholder="e.g. 0821234567">
              <button type="button" class="btn btn-ghost" id="ap-find" style="margin-top:8px">Find application</button></div></details>`}
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
            <button type="button" class="btn btn-primary" id="ap-submit">${existing ? 'Save changes' : 'Submit application'}</button>
            ${existing ? `<button type="button" class="btn btn-danger" id="ap-delete">Delete application</button>` : ''}
          </div>
          <p id="ap-status" style="margin-top:10px;color:#64748b"></p>
        </section>
        <div id="apply-closed-overlay" style="display:none"></div>`;

      this.paintClosed(closed, shopName, closeAt);
      if (closeAt && !closed) {
        clearInterval(this._timer);
        this._timer = setInterval(() => {
          if (closeAt.getTime() <= Date.now()) {
            clearInterval(this._timer);
            this.paintClosed(true, shopName, closeAt);
            return;
          }
          const count = document.getElementById('apply-countdown');
          if (count) count.textContent = this.fmtRemain(closeAt);
        }, 1000);
      }

      let cvData = '';
      let cvName = '';
      document.getElementById('ap-cv')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) {
          document.getElementById('ap-status').textContent = 'CV must be under 8MB.';
          e.target.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          cvData = String(reader.result || '');
          cvName = file.name;
          document.getElementById('ap-cv-label').textContent = file.name;
        };
        reader.readAsDataURL(file);
      });

      document.getElementById('ap-find')?.addEventListener('click', async () => {
        const phone = document.getElementById('ap-find-phone')?.value.trim();
        document.getElementById('ap-status').textContent = 'Looking up…';
        const lr = await rpc('jobs:lookupPublicApplication', [token, phone]);
        if (!lr.success) {
          document.getElementById('ap-status').textContent = lr.error || 'Not found.';
          return;
        }
        this.writeSaved(token, lr.data);
        this.renderForm(el, token, opts);
      });

      document.getElementById('ap-delete')?.addEventListener('click', async () => {
        if (!existing?.edit_token) return;
        if (!confirm('Permanently delete this application? This cannot be undone.')) return;
        const dr = await rpc('jobs:deletePublicApplication', [existing.edit_token]);
        if (!dr.success) {
          document.getElementById('ap-status').textContent = dr.error || 'Could not delete.';
          return;
        }
        this.clearSaved(token);
        el.innerHTML = `<div style="background:#fff;border-radius:16px;padding:32px;text-align:center">
          <h1 style="margin:0 0 8px">Application deleted</h1>
          <p style="color:#64748b">Your application has been permanently removed.</p>
        </div>`;
        if (typeof opts.onDeleted === 'function') opts.onDeleted();
      });

      document.getElementById('ap-submit')?.addEventListener('click', async () => {
        if (closeAt && closeAt.getTime() <= Date.now()) {
          this.paintClosed(true, shopName, closeAt);
          return;
        }
        const name = document.getElementById('ap-name').value.trim();
        const phone = document.getElementById('ap-phone').value.trim();
        if (!name || !phone) {
          document.getElementById('ap-status').textContent = 'Name and phone are required.';
          return;
        }
        if (!existing && !cvData) {
          document.getElementById('ap-status').textContent = 'Please upload your CV.';
          return;
        }
        document.getElementById('ap-submit').disabled = true;
        document.getElementById('ap-status').textContent = existing ? 'Saving…' : 'Sending…';
        const payload = {
          name, phone,
          email: document.getElementById('ap-email').value.trim(),
          address: document.getElementById('ap-address').value.trim(),
          location: document.getElementById('ap-loc').value.trim(),
          notes: document.getElementById('ap-notes').value.trim(),
          cv_data: cvData || undefined,
          cv_name: cvName || undefined,
          edit_token: existing?.edit_token || undefined
        };
        const sr = await rpc('jobs:submitPublicApplication', [token, payload]);
        document.getElementById('ap-submit').disabled = false;
        if (!sr.success) {
          document.getElementById('ap-status').textContent = sr.error || 'Could not submit.';
          return;
        }
        const out = sr.data || {};
        this.writeSaved(token, out);
        el.innerHTML = `<div style="background:#fff;border-radius:16px;padding:32px;text-align:center">
          <h1 style="margin:0 0 8px">${out.updated ? 'Application updated' : 'Application successful'}</h1>
          <p style="color:#64748b">Thank you, ${this.esc(name)}. ${this.esc(shopName)} will review your CV and contact you on ${this.esc(phone)} if you are shortlisted.</p>
        </div>`;
        if (typeof opts.onSubmitted === 'function') {
          setTimeout(() => opts.onSubmitted(out), opts.embedded ? 1400 : 0);
        }
      });
    },

    readSaved(token) {
      try {
        return JSON.parse(localStorage.getItem(storageKey(token)) || 'null');
      } catch (_) {
        return null;
      }
    },

    writeSaved(token, data) {
      if (!data?.edit_token) return;
      try {
        localStorage.setItem(storageKey(token), JSON.stringify({
          edit_token: data.edit_token,
          id: data.id,
          name: data.name
        }));
      } catch (_) { /* ignore */ }
    },

    clearSaved(token) {
      try { localStorage.removeItem(storageKey(token)); } catch (_) { /* ignore */ }
    },

    paintClosed(closed, shopName, closeAt) {
      const overlay = document.getElementById('apply-closed-overlay');
      const form = document.getElementById('apply-form-card');
      const chip = document.getElementById('apply-close-chip');
      const count = document.getElementById('apply-countdown');
      if (!closed) {
        if (overlay) overlay.style.display = 'none';
        return;
      }
      if (form) form.style.pointerEvents = 'none';
      if (chip) chip.textContent = 'Applications closed';
      if (count) count.textContent = 'Closed';
      if (!overlay) return;
      overlay.style.cssText = 'display:flex;position:absolute;inset:0;z-index:4000;background:rgba(15,23,42,.82);align-items:center;justify-content:center;padding:24px';
      const host = overlay.parentElement;
      if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';
      overlay.innerHTML = `<div style="background:#fff;border-radius:28px;padding:36px 28px;max-width:520px;width:100%;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.35)">
        <div style="font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#64748b;font-weight:800">Applications closed</div>
        <h2 style="margin:12px 0 8px;font-size:clamp(34px,8vw,56px);line-height:1;color:#0f172a">${this.esc(shopName)}</h2>
        <p style="font-size:22px;font-weight:800;color:#b45309;margin:0 0 10px">This job is closed</p>
        <p style="color:#64748b;margin:0">${closeAt ? `Closed ${this.esc(this.fmtClose(closeAt))}.` : 'This vacancy is no longer accepting applications.'} Please watch our page for the next opening.</p>
      </div>`;
    },

    setFavicon(href) {
      let link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = href;
    },

    closeDate(v) {
      if (!v) return null;
      const s = String(v).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T23:59:59`);
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    },

    fmtClose(d) {
      return d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    },

    fmtRemain(d) {
      const ms = Math.max(0, d.getTime() - Date.now());
      const s = Math.floor(ms / 1000);
      const days = Math.floor(s / 86400);
      const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
      const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      return days ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
    },

    meta(extra, p) {
      const items = [
        ['Position', extra.position || p.position_title],
        ['Type', extra.employment_type],
        ['Department', extra.department],
        ['Hours', extra.hours],
        ['Salary', extra.salary_text || p.salary_text],
        ['Experience', extra.experience]
      ].filter(([, v]) => v);
      if (!items.length) return '';
      return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:14px">
        ${items.map(([k, v]) => `<div style="background:#f8fafc;border-radius:10px;padding:10px"><div style="font-size:11px;color:#64748b">${this.esc(k)}</div><strong>${this.esc(v)}</strong></div>`).join('')}
      </div>`;
    },

    esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }
  };

  window.ApplyJobPage = ApplyJobPage;
})();

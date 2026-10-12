(function () {
  const token = new URLSearchParams(location.search).get('t') || '';
  const app = document.getElementById('app');

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

  function fieldHtml(field) {
    const id = 'f-' + field.key;
    if (field.type === 'checkbox') {
      return `<label><input id="${id}" data-key="${esc(field.key)}" type="checkbox"> ${esc(field.label)}</label>`;
    }
    if (field.type === 'longtext') {
      return `<label for="${id}">${esc(field.label)}</label><textarea id="${id}" data-key="${esc(field.key)}"></textarea>`;
    }
    const type = field.type === 'date' ? 'date' : 'text';
    return `<label for="${id}">${esc(field.label)}</label><input id="${id}" data-key="${esc(field.key)}" type="${type}">`;
  }

  function readFields() {
    const fields = {};
    app.querySelectorAll('[data-key]').forEach((el) => {
      fields[el.getAttribute('data-key')] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return fields;
  }

  function bindPad(canvas) {
    const ctx = canvas.getContext('2d');
    function resize() {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#1c1915';
    }
    resize();
    let drawing = false;
    let dirty = false;
    function point(event) {
      const src = event.touches ? event.touches[0] : event;
      const rect = canvas.getBoundingClientRect();
      return { x: src.clientX - rect.left, y: src.clientY - rect.top };
    }
    function start(event) {
      drawing = true;
      dirty = true;
      const p = point(event);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      event.preventDefault();
    }
    function move(event) {
      if (!drawing) return;
      const p = point(event);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      event.preventDefault();
    }
    function end() { drawing = false; }
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    return {
      clear() { dirty = false; resize(); },
      image() { return dirty ? canvas.toDataURL('image/png') : ''; }
    };
  }

  function showError(message) {
    const box = app.querySelector('.error');
    if (box) box.textContent = message || '';
  }

  async function render() {
    if (!token) {
      app.innerHTML = '<h1>Document link missing</h1><p>Open the link sent by the shop. It must include the private token.</p>';
      return;
    }
    let doc;
    try { doc = await rpc('hr:publicDoc', [token]); }
    catch (err) {
      app.innerHTML = `<h1>This document is not available</h1><p>${esc(err.message)}</p>`;
      return;
    }
    app.innerHTML = `
      <p class="note">${esc(doc.employer)}</p>
      <h1>${esc(doc.title)}</h1>
      <p class="note">Reference ${esc(doc.reference)} · Version ${esc(doc.version)}</p>
      <div class="box"><p>${esc(doc.body)}</p></div>
      <p class="note">${esc(doc.employee_name)} · ${esc(doc.position)} · ${esc(doc.branch)}</p>
      ${(doc.fields || []).map(fieldHtml).join('')}
      <label>Signature</label>
      <canvas id="pad"></canvas>
      <button class="ghost" id="clear" type="button">Clear signature</button>
      <div class="box"><p class="note">${esc(doc.consent)}</p>
      <label><input id="consent" type="checkbox"> I agree to sign this version electronically</label></div>
      ${doc.needs_otp ? `<button class="ghost" id="otp" type="button">Send a code to my phone</button>
      <label for="code">Code from WhatsApp</label><input id="code" inputmode="numeric" autocomplete="one-time-code">` : ''}
      <p class="error"></p>
      <button id="submit" type="button">Submit signed document</button>
      <button class="ghost" id="decline" type="button">I decline to sign</button>`;
    const pad = bindPad(app.querySelector('#pad'));
    app.querySelector('#clear').addEventListener('click', () => pad.clear());
    app.querySelector('#otp')?.addEventListener('click', async () => {
      showError('');
      try {
        const sent = await rpc('hr:publicOtp', [token]);
        showError(sent.sent ? 'Code sent. It expires in 10 minutes.' : (sent.error || 'The code was not sent.'));
      } catch (err) { showError(err.message); }
    });
    app.querySelector('#decline').addEventListener('click', async () => {
      try {
        await rpc('hr:publicDecline', [token]);
        app.innerHTML = '<h1>Declined</h1><p>The shop has been told that this document was not signed. Nothing else about the job was changed.</p>';
      } catch (err) { showError(err.message); }
    });
    app.querySelector('#submit').addEventListener('click', async () => {
      showError('');
      const button = app.querySelector('#submit');
      button.disabled = true;
      try {
        const result = await rpc('hr:publicSubmit', [token, {
          fields: readFields(),
          signature: pad.image(),
          consent: app.querySelector('#consent').checked,
          code: app.querySelector('#code')?.value || ''
        }]);
        app.innerHTML = `<h1>Submitted</h1><p>Reference ${esc(result.reference)}. Signing this form does not change employment, probation or pay.</p>
          <button id="download" type="button">Download your copy</button>`;
        app.querySelector('#download').addEventListener('click', async () => {
          const file = await rpc('hr:publicPdf', [token]);
          const binary = atob(file.pdf_base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = file.filename || 'document.pdf';
          a.click();
          URL.revokeObjectURL(url);
        });
      } catch (err) {
        showError(err.message);
        button.disabled = false;
      }
    });
  }

  render();
})();

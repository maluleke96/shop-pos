/** Canvas posters — WhatsApp Status 9:16, unified promo theme. */
const PromoPoster = {
  W: 1080,
  H: 1920,
  theme: {
    bgTop: '#0f172a',
    bgMid: '#1e293b',
    bgBottom: '#0f172a',
    saleRed: '#ef4444',
    saleRedDark: '#dc2626',
    gold: '#fbbf24',
    text: '#f8fafc',
    muted: '#94a3b8',
    line: 'rgba(255,255,255,0.12)',
    card: 'rgba(255,255,255,0.06)'
  },

  async loadImage(url) {
    if (!url) return null;
    const raw = String(url);
    const loadFromSrc = (src) => new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    if (raw.startsWith('data:')) return loadFromSrc(raw);
    try {
      const res = await fetch(raw, { credentials: 'same-origin' });
      if (!res.ok) return loadFromSrc(raw);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const img = await loadFromSrc(objUrl);
      URL.revokeObjectURL(objUrl);
      return img || loadFromSrc(raw);
    } catch (_) {
      return loadFromSrc(raw);
    }
  },

  roundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  },

  drawCoverImage(ctx, img, x, y, w, h) {
    if (!img) return;
    const ir = img.width / img.height;
    const dr = w / h;
    let sw, sh, sx, sy;
    if (ir > dr) { sh = img.height; sw = sh * dr; sx = (img.width - sw) / 2; sy = 0; }
    else { sw = img.width; sh = sw / dr; sx = 0; sy = (img.height - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  },

  drawImagePlaceholder(ctx, x, y, w, h, label) {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#334155');
    g.addColorStop(1, '#1e293b');
    ctx.fillStyle = g;
    this.roundRect(ctx, x, y, w, h, 24);
    ctx.fill();
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 72px system-ui,Segoe UI,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(label || '?').charAt(0).toUpperCase(), x + w / 2, y + h / 2);
  },

  formatMoney(amount, currency = 'R') {
    return `${currency}${(Number(amount) || 0).toFixed(2)}`;
  },

  wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = String(text).split(/\s+/);
    let line = '';
    let lines = 0;
    for (let n = 0; n < words.length; n++) {
      const test = line ? `${line} ${words[n]}` : words[n];
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        line = words[n];
        y += lineHeight;
        lines++;
        if (lines >= maxLines - 1) {
          ctx.fillText(`${line.slice(0, 24)}…`, x, y);
          return y + lineHeight;
        }
      } else line = test;
    }
    ctx.fillText(line, x, y);
    return y + lineHeight;
  },

  paintBackground(ctx) {
    const t = this.theme;
    const grad = ctx.createLinearGradient(0, 0, 0, this.H);
    grad.addColorStop(0, t.bgTop);
    grad.addColorStop(0.5, t.bgMid);
    grad.addColorStop(1, t.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.W, this.H);
  },

  paintShopHeader(ctx, data) {
    const t = this.theme;
    const pad = 64;
    ctx.textAlign = 'center';
    ctx.fillStyle = t.text;
    ctx.font = 'bold 52px system-ui,Segoe UI,sans-serif';
    ctx.fillText(String(data.shopName || 'Our Shop').slice(0, 36), this.W / 2, 100);
    let y = 148;
    if (data.shopAddress) {
      ctx.fillStyle = t.muted;
      ctx.font = '28px system-ui,Segoe UI,sans-serif';
      y = this.wrapText(ctx, data.shopAddress, this.W / 2, y, this.W - pad * 2, 36, 2);
    }
    if (data.shopPhone) {
      ctx.fillStyle = t.muted;
      ctx.font = '26px system-ui,Segoe UI,sans-serif';
      ctx.fillText(String(data.shopPhone).slice(0, 40), this.W / 2, y + 8);
      y += 40;
    }
    if (data.branchLabel) {
      ctx.fillStyle = t.gold;
      ctx.font = 'bold 30px system-ui,Segoe UI,sans-serif';
      ctx.fillText(String(data.branchLabel).slice(0, 48), this.W / 2, y + 36);
      y += 48;
    }
    ctx.strokeStyle = t.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad, y + 24);
    ctx.lineTo(this.W - pad, y + 24);
    ctx.stroke();
    return y + 48;
  },

  paintSaleBadge(ctx, label, y) {
    const t = this.theme;
    const w = label.length > 8 ? 360 : 280;
    const x = (this.W - w) / 2;
    const grad = ctx.createLinearGradient(x, y, x + w, y + 72);
    grad.addColorStop(0, t.saleRed);
    grad.addColorStop(1, t.saleRedDark);
    ctx.fillStyle = grad;
    this.roundRect(ctx, x, y, w, 72, 36);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 34px system-ui,Segoe UI,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, this.W / 2, y + 48);
    return y + 96;
  },

  paintPriceBlock(ctx, wasPrice, nowPrice, currency, y) {
    const t = this.theme;
    ctx.textAlign = 'center';
    ctx.fillStyle = t.muted;
    ctx.font = '36px system-ui,Segoe UI,sans-serif';
    ctx.fillText('WAS', this.W / 2 - 160, y);
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 56px system-ui,Segoe UI,sans-serif';
    ctx.fillText(this.formatMoney(wasPrice, currency), this.W / 2 - 160, y + 56);
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(this.W / 2 - 250, y + 44);
    ctx.lineTo(this.W / 2 - 70, y + 44);
    ctx.stroke();
    ctx.fillStyle = t.saleRed;
    ctx.font = 'bold 36px system-ui,Segoe UI,sans-serif';
    ctx.fillText('NOW', this.W / 2 + 160, y);
    ctx.fillStyle = t.gold;
    ctx.font = 'bold 88px system-ui,Segoe UI,sans-serif';
    ctx.fillText(this.formatMoney(nowPrice, currency), this.W / 2 + 160, y + 72);
    return y + 120;
  },

  async renderPromo(data) {
    const canvas = document.createElement('canvas');
    canvas.width = this.W;
    canvas.height = this.H;
    const ctx = canvas.getContext('2d');
    const currency = data.currency || 'R';
    this.paintBackground(ctx);
    let y = this.paintShopHeader(ctx, data);
    y = this.paintSaleBadge(ctx, 'SALE', y);
    const heroImg = await this.loadImage(data.imageUrl);
    const imgY = y;
    const imgH = 680;
    ctx.save();
    this.roundRect(ctx, 64, imgY, this.W - 128, imgH, 28);
    ctx.clip();
    if (heroImg) this.drawCoverImage(ctx, heroImg, 64, imgY, this.W - 128, imgH);
    else this.drawImagePlaceholder(ctx, 64, imgY, this.W - 128, imgH, data.title);
    ctx.restore();
    y = imgY + imgH + 48;
    ctx.fillStyle = this.theme.text;
    ctx.font = 'bold 54px system-ui,Segoe UI,sans-serif';
    ctx.textAlign = 'center';
    y = this.wrapText(ctx, String(data.title || 'Special Offer').slice(0, 50), this.W / 2, y, this.W - 128, 62, 2);
    y = this.paintPriceBlock(ctx, data.wasPrice, data.nowPrice, currency, y + 24);
    if (data.dateRange) {
      ctx.fillStyle = this.theme.muted;
      ctx.font = '32px system-ui,Segoe UI,sans-serif';
      ctx.fillText(data.dateRange, this.W / 2, y + 20);
    }
    ctx.fillStyle = this.theme.card;
    this.roundRect(ctx, 64, this.H - 280, this.W - 128, 200, 20);
    ctx.fill();
    ctx.fillStyle = this.theme.text;
    ctx.font = '32px system-ui,Segoe UI,sans-serif';
    ctx.fillText('Order in-store or online today', this.W / 2, this.H - 210);
    ctx.fillStyle = this.theme.saleRed;
    ctx.font = 'bold 34px system-ui,Segoe UI,sans-serif';
    ctx.fillText('Limited time offer', this.W / 2, this.H - 155);
    return canvas;
  },

  async renderCombo(data) {
    const canvas = document.createElement('canvas');
    canvas.width = this.W;
    canvas.height = this.H;
    const ctx = canvas.getContext('2d');
    const currency = data.currency || 'R';
    this.paintBackground(ctx);
    let y = this.paintShopHeader(ctx, data);
    y = this.paintSaleBadge(ctx, 'COMBO DEAL', y);
    const imgs = [...(data.itemImages || [])];
    const slotCount = Math.max(data.itemCount || 0, imgs.length, (data.items || []).length);
    const imgY = y;
    const imgH = 620;
    if (slotCount > 1 || (data.items || []).length > 1) {
      const cols = Math.min(3, slotCount);
      const rows = Math.ceil(slotCount / cols);
      const gap = 14;
      const cellW = (this.W - 128 - gap * (cols - 1)) / cols;
      const cellH = (imgH - gap * (rows - 1)) / rows;
      for (let idx = 0; idx < slotCount; idx++) {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        const x = 64 + c * (cellW + gap);
        const cy = imgY + r * (cellH + gap);
        const loaded = imgs[idx] ? await this.loadImage(imgs[idx]) : null;
        ctx.save();
        this.roundRect(ctx, x, cy, cellW, cellH, 16);
        ctx.clip();
        if (loaded) this.drawCoverImage(ctx, loaded, x, cy, cellW, cellH);
        else this.drawImagePlaceholder(ctx, x, cy, cellW, cellH, `#${idx + 1}`);
        ctx.restore();
      }
    } else {
      const heroUrl = data.imageUrl || imgs[0];
      const heroImg = heroUrl ? await this.loadImage(heroUrl) : null;
      ctx.save();
      this.roundRect(ctx, 64, imgY, this.W - 128, imgH, 28);
      ctx.clip();
      if (heroImg) this.drawCoverImage(ctx, heroImg, 64, imgY, this.W - 128, imgH);
      else this.drawImagePlaceholder(ctx, 64, imgY, this.W - 128, imgH, data.title);
      ctx.restore();
    }
    y = imgY + imgH + 40;
    ctx.fillStyle = this.theme.text;
    ctx.font = 'bold 52px system-ui,Segoe UI,sans-serif';
    ctx.textAlign = 'center';
    y = this.wrapText(ctx, String(data.title || 'Combo').slice(0, 44), this.W / 2, y, this.W - 128, 58, 2);
    if (data.description) {
      ctx.fillStyle = this.theme.muted;
      ctx.font = '28px system-ui,Segoe UI,sans-serif';
      y = this.wrapText(ctx, String(data.description).slice(0, 120), this.W / 2, y + 12, this.W - 128, 36, 3);
      y += 8;
    }
    y = this.paintPriceBlock(ctx, data.wasPrice, data.nowPrice, currency, y + 16);
    if (data.branchLabel) {
      ctx.fillStyle = this.theme.muted;
      ctx.font = '26px system-ui,Segoe UI,sans-serif';
      ctx.fillText(String(data.branchLabel), this.W / 2, y + 28);
      y += 40;
    }
    if (data.items?.length) {
      ctx.fillStyle = this.theme.card;
      const boxH = Math.min(380, 80 + data.items.length * 48);
      this.roundRect(ctx, 64, y + 16, this.W - 128, boxH, 20);
      ctx.fill();
      ctx.fillStyle = this.theme.text;
      ctx.font = 'bold 30px system-ui,Segoe UI,sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Includes:', 96, y + 64);
      ctx.font = '26px system-ui,Segoe UI,sans-serif';
      ctx.fillStyle = '#cbd5e1';
      let iy = y + 108;
      for (const it of data.items.slice(0, 8)) {
        ctx.fillText(`• ${String(it.name || 'Item').slice(0, 38)} × ${it.qty || 1}`, 96, iy);
        iy += 44;
      }
    }
    if (data.dateRange) {
      ctx.textAlign = 'center';
      ctx.fillStyle = this.theme.muted;
      ctx.font = '28px system-ui,Segoe UI,sans-serif';
      ctx.fillText(`Available: ${data.dateRange}`, this.W / 2, this.H - 180);
    }
    ctx.fillStyle = this.theme.saleRed;
    ctx.font = 'bold 32px system-ui,Segoe UI,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Order in-store or online today', this.W / 2, this.H - 88);
    ctx.fillStyle = this.theme.gold;
    ctx.font = 'bold 28px system-ui,Segoe UI,sans-serif';
    ctx.fillText('Limited time combo offer', this.W / 2, this.H - 48);
    return canvas;
  },

  downloadCanvas(canvas, filename) {
    const link = document.createElement('a');
    link.download = filename || 'promo-poster.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  },

  showPreviewModal(canvas, opts = {}) {
    const dataUrl = canvas.toDataURL('image/png');
    const msg = opts.whatsappMessage || '';
    const groupLink = opts.groupLink || '';
    Utils.showModal(opts.title || 'Promo Poster', `
      <div class="promo-poster-preview-wrap">
        <img class="promo-poster-preview" src="${dataUrl}" alt="Poster preview">
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="pp-save">Save picture</button>
        <button class="btn btn-success" id="pp-wa" ${groupLink ? '' : 'disabled'}>Send to WhatsApp Group</button>
        ${msg ? '<button class="btn btn-ghost" id="pp-copy">Copy message</button>' : ''}
      </div>`,
      '<button class="btn btn-ghost" id="pp-close">Close</button>');
    document.getElementById('pp-close')?.addEventListener('click', () => Utils.hideModal());
    document.getElementById('pp-save')?.addEventListener('click', () => {
      this.downloadCanvas(canvas, opts.filename || 'promo-poster.png');
      Utils.toast('Poster saved — ready for WhatsApp Status', 'success');
    });
    document.getElementById('pp-copy')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(msg); Utils.toast('Message copied', 'success'); } catch (_) { Utils.toast('Copy failed', 'error'); }
    });
    document.getElementById('pp-wa')?.addEventListener('click', async () => {
      if (!groupLink) return Utils.toast('Connect WhatsApp group first', 'error');
      this.downloadCanvas(canvas, opts.filename || 'promo-poster.png');
      if (msg) { try { await navigator.clipboard.writeText(msg); } catch (_) { /* */ } }
      window.open(groupLink, '_blank', 'noopener');
      Utils.toast('Group opened — attach the saved poster and paste the message', 'success');
    });
  }
};

window.PromoPoster = PromoPoster;

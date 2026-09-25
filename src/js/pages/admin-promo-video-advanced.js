/**
 * Promo Video Builder — advanced timeline, playlist, campaigns, voice/captions helpers.
 * Extends AdminPromoVideoBuilderPage via Object.assign (loaded after main script).
 */
(function () {
  const P = window.AdminPromoVideoBuilderPage;
  if (!P) {
    console.warn('admin-promo-video-advanced.js: AdminPromoVideoBuilderPage missing');
    return;
  }

  Object.assign(P, {
    PLAYLIST_KEY: 'shoppos_promo_playlists_v1',
    CAMPAIGN_KEY: 'shoppos_promo_campaigns_v1',

    qualitySize() {
      const fmt = this.formatSize();
      const q = String(this.draft.quality || 'hd').toLowerCase();
      // Always export at the selected format's native resolution (never shrink into a padded frame)
      let w = fmt.w;
      let h = fmt.h;
      let videoBitsPerSecond = 8_000_000;
      if (q === 'whatsapp' || this.draft.outputWhatsApp) {
        // Keep full 1080×1920 / 1920×1080 / 1080×1080 — lower bitrate only for share size
        videoBitsPerSecond = 5_000_000;
      } else if (q === 'standard') {
        videoBitsPerSecond = 6_000_000;
      } else if (q === 'hd') {
        videoBitsPerSecond = 8_000_000;
      } else if (q === 'fullhd') {
        videoBitsPerSecond = 10_000_000;
      } else if (q === 'hq') {
        videoBitsPerSecond = 14_000_000;
      } else if (q === 'tv' || this.draft.outputTv) {
        videoBitsPerSecond = 12_000_000;
      }
      if (w % 2) w += 1;
      if (h % 2) h += 1;
      return { w, h, videoBitsPerSecond, label: q, format: this.draft.format, ratio: fmt.ratio };
    },

    buildPromoCaption() {
      const shop = this.shopBlock();
      const items = this.selectedItems();
      const names = items.slice(0, 5).map((i) => i.name).filter(Boolean);
      const badge = this.draft.promoBadge || '';
      const buy = this.draft.template === 'buyget'
        ? ` Buy ${this.draft.buyGetBuyQty || 2} get ${this.draft.buyGetFreeQty || 1} free.`
        : '';
      const list = names.length ? names.join(', ') : 'our specials';
      const phone = shop.phone ? ` WhatsApp ${shop.phone}.` : '';
      return `${shop.shopName}${badge ? ` — ${badge}` : ''}: ${list}.${buy}${phone} Order online now!`.replace(/\s+/g, ' ').trim();
    },

    playlistsHtml() {
      const list = this.loadPlaylists();
      return `<div class="pvb-lib-tools">
        <button type="button" class="btn btn-primary btn-sm" id="pvb-pl-new">New Playlist</button>
      </div>
      ${!list.length ? `<div class="pvb-empty">No playlists yet. Create one, then add videos from My Videos.</div>` : ''}
      <div class="pvb-lib-grid">${list.map((pl) => {
        const vids = (pl.videoIds || []).map((id) => this.videos.find((v) => v.id === id)).filter(Boolean);
        return `<div class="pvb-card"><div class="pvb-card-body">
          <h4>${this.esc(pl.name)}</h4>
          <p>${vids.length} video(s)${vids.length ? `: ${vids.map((v) => v.title).join(' → ')}` : ''}</p>
          <div class="pvb-card-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-pl-gen="${this.esc(pl.id)}">Play / Open</button>
            <button type="button" class="btn btn-ghost btn-sm" data-pl-del="${this.esc(pl.id)}">Delete</button>
          </div>
        </div></div>`;
      }).join('')}</div>`;
    },

    campaignsHtml() {
      const list = this.refreshCampaignStatuses(this.loadCampaigns());
      return `<div class="pvb-lib-tools">
        <button type="button" class="btn btn-primary btn-sm" id="pvb-camp-new">Schedule Campaign</button>
      </div>
      ${!list.length ? `<div class="pvb-empty">No campaigns. Schedule a saved video with start/end date &amp; time.</div>` : ''}
      <div class="pvb-lib-grid">${list.map((c) =>
        `<div class="pvb-card"><div class="pvb-card-body">
          <h4>${this.esc(c.title)}</h4>
          <p>${this.esc(c.startDate || '')} ${this.esc(c.startTime || '')} → ${this.esc(c.endDate || '')} ${this.esc(c.endTime || '')}<br>
          Branch: ${this.esc(c.branchId || 'all')}<br>
          <strong class="pvb-camp-status pvb-camp-${this.esc(c.status || 'active')}">${this.esc((c.status || 'active').toUpperCase())}</strong></p>
          <div class="pvb-card-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-camp-del="${this.esc(c.id)}">Delete</button>
          </div>
        </div></div>`
      ).join('')}</div>`;
    },

    refreshCampaignStatuses(list) {
      const now = Date.now();
      let changed = false;
      const out = (list || []).map((c) => {
        const start = Date.parse(`${c.startDate || ''}T${c.startTime || '00:00'}`);
        const end = Date.parse(`${c.endDate || ''}T${c.endTime || '23:59'}`);
        let status = 'active';
        if (!Number.isNaN(end) && now > end) status = 'expired';
        else if (!Number.isNaN(start) && now < start) status = 'scheduled';
        if (c.status !== status) changed = true;
        return { ...c, status };
      });
      if (changed) this.saveCampaigns(out);
      return out;
    },

    bindLibraryExtra() {
      document.getElementById('pvb-pl-new')?.addEventListener('click', () => {
        const name = prompt('Playlist name', 'Promo Playlist');
        if (!name) return;
        this.playlistCreate(name);
        this.libraryTab = 'playlists';
        this.paint();
      });
      document.getElementById('pvb-camp-new')?.addEventListener('click', () => {
        if (!this.videos.length) return this.toast('Save a video first', 'error');
        const title = prompt('Campaign title', this.draft.title || 'Campaign');
        if (!title) return;
        const startDate = prompt('Start date (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
        if (!startDate) return;
        const startTime = prompt('Start time (HH:MM)', '08:00') || '08:00';
        const endDate = prompt('End date (YYYY-MM-DD)', startDate);
        if (!endDate) return;
        const endTime = prompt('End time (HH:MM)', '22:00') || '22:00';
        this.campaignCreate(title, [this.videos[0].id], { startDate, startTime, endDate, endTime, branchId: this.branchId });
        this.libraryTab = 'campaigns';
        this.paint();
        this.toast('Campaign scheduled', 'success');
      });
      this.el?.querySelectorAll('[data-pl-gen]').forEach((btn) => {
        btn.addEventListener('click', () => this.playlistGenerate(btn.dataset.plGen));
      });
      this.el?.querySelectorAll('[data-pl-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.savePlaylists(this.loadPlaylists().filter((p) => p.id !== btn.dataset.plDel));
          this.paint();
        });
      });
      this.el?.querySelectorAll('[data-camp-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.saveCampaigns(this.loadCampaigns().filter((c) => c.id !== btn.dataset.campDel));
          this.paint();
        });
      });
      this.el?.querySelectorAll('[data-check-vid]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const changes = this.checkProductChanges(btn.dataset.checkVid) || [];
          if (!changes.length) return;
          const lines = changes.map((c) => c.type === 'price'
            ? `${c.name}: was ${this.money(c.was)} → now ${this.money(c.now)}`
            : `${c.name}: no longer available`).join('\n');
          alert(lines);
        });
      });
      this.el?.querySelectorAll('[data-add-pl]').forEach((sel) => {
        sel.addEventListener('change', () => {
          const plId = sel.value;
          if (!plId) return;
          this.playlistAddVideo(plId, sel.dataset.addPl);
          sel.value = '';
        });
      });
    },

    itemWasNow(item) {
      if (!item) return null;
      const sell = Number(item.price ?? item.selling_price) || 0;
      const was = Number(item.original_price ?? item.was_price) || 0;
      if (was > sell) return { was, now: sell };
      if (item.promo_active && was > 0 && was > sell) return { was, now: sell };
      return null;
    },

    paintWasNow(ctx, W, H, item, x, y, align) {
      const wn = this.itemWasNow(item);
      if (!wn) return;
      const short = Math.min(W, H);
      ctx.save();
      ctx.textAlign = align || 'center';
      ctx.font = `600 ${Math.round(short * 0.032)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillStyle = '#94a3b8';
      const wasTxt = `WAS ${this.money(wn.was).replace(/\.00$/, '')}`;
      ctx.fillText(wasTxt, x, y);
      const m = ctx.measureText(wasTxt);
      let x0 = x - m.width / 2;
      if (align === 'left') x0 = x;
      if (align === 'right') x0 = x - m.width;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = Math.max(2, short * 0.004);
      ctx.beginPath();
      ctx.moveTo(x0 - 4, y - Math.round(short * 0.012));
      ctx.lineTo(x0 + m.width + 4, y - Math.round(short * 0.004));
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.font = `bold ${Math.round(short * 0.048)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(`NOW ${this.money(wn.now).replace(/\.00$/, '')}`, x, y + Math.round(short * 0.06));
      ctx.restore();
    },

    paintBuyGetScene(ctx, W, H, t, shop, scene, local, dur, isLand) {
      const item = scene?.item || {};
      const buyQty = Number(this.draft.buyGetBuyQty) || 2;
      const freeQty = Number(this.draft.buyGetFreeQty) || 1;
      const key = `${item.kind}-${item.id}`;
      const img = this._itemImgs?.[key];
      const land = isLand || W > H;
      const short = Math.min(W, H);
      const shape = String(this.draft.productImageShape || 'fill');
      const fullBleed = shape === 'fill' || this.draft.fullScreenFill !== false;

      if (fullBleed && img) {
        this.drawCover(ctx, img, 0, 0, W, H);
        const veil = ctx.createLinearGradient(0, 0, 0, H);
        veil.addColorStop(0, 'rgba(0,0,0,0.5)');
        veil.addColorStop(0.45, 'rgba(0,0,0,0.2)');
        veil.addColorStop(1, 'rgba(0,0,0,0.75)');
        ctx.fillStyle = veil;
        ctx.fillRect(0, 0, W, H);
      }

      const pad = W * 0.06;
      const bannerH = H * 0.11;
      ctx.fillStyle = t.accent;
      this.roundRect(ctx, pad, H * 0.08, W - pad * 2, bannerH, 16);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.round(W * 0.045)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(`BUY ${buyQty} GET ${freeQty} FREE`, W / 2, H * 0.08 + bannerH * 0.62);

      if (fullBleed && img) {
        ctx.fillStyle = t.text;
        ctx.font = `bold ${Math.round(short * 0.05)}px system-ui,Segoe UI,sans-serif`;
        this.wrapFill(ctx, String(item.name || '').toUpperCase(), W / 2, H * 0.55, W * 0.88, Math.round(short * 0.055), 2);
        if (this.draft.showPrices !== false) {
          ctx.fillStyle = t.gold;
          ctx.font = `bold ${Math.round(short * 0.04)}px system-ui,sans-serif`;
          ctx.fillText(this.money(item.price).replace(/\.00$/, ''), W / 2, H * 0.72);
        }
        if (this.draft.promoBadge) {
          ctx.fillStyle = t.gold;
          ctx.font = `bold ${Math.round(W * 0.022)}px system-ui,sans-serif`;
          ctx.fillText(this.draft.promoBadge, W / 2, H * 0.88);
        }
        return;
      }

      const boxW = (W - pad * 3) / 2;
      const boxH = land ? H * 0.55 : H * 0.38;
      const y0 = H * 0.22;
      const slots = [
        { label: 'BUY', x: pad, img, name: item.name, price: item.price },
        { label: 'FREE', x: pad * 2 + boxW, img, name: item.name || 'Free item', price: 0 }
      ];
      slots.forEach((slot, i) => {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        this.roundRect(ctx, slot.x, y0, boxW, boxH, 20);
        ctx.fill();
        ctx.save();
        this.roundRect(ctx, slot.x + 8, y0 + 8, boxW - 16, boxH * 0.55, 14);
        ctx.clip();
        if (slot.img) {
          this.drawCover(ctx, slot.img, slot.x + 8, y0 + 8, boxW - 16, boxH * 0.55);
        } else {
          ctx.fillStyle = '#334155';
          ctx.fillRect(slot.x + 8, y0 + 8, boxW - 16, boxH * 0.55);
        }
        ctx.restore();
        ctx.fillStyle = i === 1 ? t.gold : t.text;
        ctx.font = `bold ${Math.round(W * 0.024)}px system-ui,sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(slot.label, slot.x + boxW / 2, y0 + boxH * 0.68);
        ctx.fillStyle = t.text;
        ctx.font = `600 ${Math.round(W * 0.022)}px system-ui,sans-serif`;
        this.wrapFill(ctx, String(slot.name || '').toUpperCase(), slot.x + boxW / 2, y0 + boxH * 0.78, boxW - 16, Math.round(W * 0.028), 2);
        if (i === 0 && this.draft.showPrices !== false) {
          ctx.fillStyle = t.accent;
          ctx.font = `bold ${Math.round(W * 0.03)}px system-ui,sans-serif`;
          ctx.fillText(this.money(slot.price).replace(/\.00$/, ''), slot.x + boxW / 2, y0 + boxH * 0.94);
        }
      });
      if (this.draft.promoBadge) {
        ctx.fillStyle = t.gold;
        ctx.font = `bold ${Math.round(W * 0.022)}px system-ui,sans-serif`;
        ctx.fillText(this.draft.promoBadge, W / 2, H * 0.92);
      }
    },

    paintSafeAreaOverlay(ctx, W, H) {
      if (!this.draft.safeAreaGuide) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(34,197,94,0.55)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      const mX = W * 0.08;
      const mY = H * 0.1;
      ctx.strokeRect(mX, mY, W - mX * 2, H - mY * 2);
      ctx.restore();
    },

    paintWatermark(ctx, W, H, shop) {
      if (!this.draft.showWatermark) return;
      const text = String(this.draft.watermarkText || shop.shopName || '').trim();
      if (!text) return;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${Math.round(W * 0.022)}px system-ui,sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(text, W * 0.94, H * 0.96);
      ctx.restore();
    },

    paintSceneCaption(ctx, W, H, scene, local) {
      // Preview: only when "Show captions while editing" is on
      // Export: only when "Burn captions on export" is on
      const show = this._exporting
        ? this.draft.burnCaptions !== false
        : this.draft.captionsOnVideo !== false;
      if (!show) return;
      const cap = this.captionForScene(scene);
      if (!cap) return;
      const fade = Math.min(1, local / 0.25, (scene.duration - local) / 0.25);
      ctx.save();
      ctx.globalAlpha = fade * 0.95;
      const pad = W * 0.06;
      const lh = Math.round(W * 0.034);
      const boxH = lh + 28;
      const y = H * 0.88 - boxH;
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      this.roundRect(ctx, pad, y, W - pad * 2, boxH, 12);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = `600 ${Math.round(W * 0.028)}px system-ui,sans-serif`;
      ctx.fillText(cap, W / 2, y + boxH * 0.62);
      ctx.restore();
    },

    captionForScene(scene) {
      if (!scene) return '';
      if (scene.type === 'intro') return scene.subtitle || this.draft.promoBadge || '';
      if (scene.type === 'outro') return 'Order now — tap to shop';
      if (scene.type === 'clip') return scene.label || 'Featured clip';
      const item = scene.item || {};
      const parts = [item.name];
      if (this.draft.showPrices !== false && item.price != null) {
        parts.push(this.money(item.price).replace(/\.00$/, ''));
      }
      return parts.filter(Boolean).join(' — ');
    },

    generateCaptionsList() {
      if (!this.scenes?.length) this.buildScenes();
      return this.scenes.map((s) => ({
        id: s.id,
        start: s.start,
        end: s.end,
        text: this.captionForScene(s)
      })).filter((c) => c.text);
    },

    stopVoicePreview() {
      try {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
      } catch (_) { /* */ }
      this._previewUtterance = null;
    },

    pickNarratorVoice() {
      if (!window.speechSynthesis) return null;
      const voices = window.speechSynthesis.getVoices?.() || [];
      if (!voices.length) return null;
      const gender = String(this.draft.voiceGender || 'female').toLowerCase();
      if (gender === 'auto') return voices.find((v) => /en/i.test(v.lang)) || voices[0];
      const nameHints = gender === 'male'
        ? [/male/i, /\b(david|mark|james|thomas|george|daniel|richard|microsoft david|microsoft mark|google uk english male)\b/i]
        : [/female/i, /\b(zira|susan|hazel|karen|moira|tessa|samantha|victoria|linda|heather|microsoft zira|google uk english female)\b/i];
      const scored = voices.map((v) => {
        let score = 0;
        const blob = `${v.name} ${v.lang} ${v.voiceURI || ''}`;
        if (/en/i.test(v.lang)) score += 2;
        nameHints.forEach((re) => { if (re.test(blob)) score += 5; });
        // Heuristic: many engines mark gender in name; prefer local
        if (v.localService) score += 1;
        return { v, score };
      }).sort((a, b) => b.score - a.score);
      if (scored[0]?.score >= 5) return scored[0].v;
      // Fallback: pitch-friendly — return first English voice
      return voices.find((v) => /en/i.test(v.lang)) || voices[0];
    },

    applyNarratorVoice(utterance) {
      if (!utterance) return;
      utterance.rate = Math.max(0.7, Math.min(1.4, Number(this.draft.voiceRate) || 1));
      utterance.volume = Math.max(0, Math.min(1, Number(this.draft.voiceVolume) || 1));
      const gender = String(this.draft.voiceGender || 'female').toLowerCase();
      // Pitch nudge helps when OS voice list lacks clear male/female names
      utterance.pitch = gender === 'male' ? 0.85 : gender === 'female' ? 1.15 : 1;
      const voice = this.pickNarratorVoice();
      if (voice) utterance.voice = voice;
    },

    voicePreviewForScene(scene) {
      if (!this.draft.voiceEnabled) return;
      const text = this.captionForScene(scene);
      if (!text || !window.speechSynthesis) return;
      this.stopVoicePreview();
      const u = new SpeechSynthesisUtterance(text);
      this.applyNarratorVoice(u);
      this._previewUtterance = u;
      window.speechSynthesis.speak(u);
    },

    voicePreviewFull() {
      if (!this.draft.voiceEnabled) {
        this.toast('Turn on “Speak scene captions” first', 'info');
        return;
      }
      const caps = this.generateCaptionsList();
      if (!caps.length || !window.speechSynthesis) {
        this.toast('Captions / voice not available', 'info');
        return;
      }
      this.stopVoicePreview();
      let i = 0;
      const next = () => {
        if (i >= caps.length) return;
        const u = new SpeechSynthesisUtterance(caps[i].text);
        this.applyNarratorVoice(u);
        u.onend = () => { i += 1; next(); };
        window.speechSynthesis.speak(u);
      };
      // Voices often load async on Windows
      const kick = () => next();
      if ((window.speechSynthesis.getVoices?.() || []).length) kick();
      else window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.onvoiceschanged = null; kick(); };
    },

    async ensureClipVideo(scene) {
      if (!scene?.clipDataUrl) return null;
      const id = scene.id;
      if (this._clipVideoEls[id] && this._clipVideoEls[id].src === scene.clipDataUrl) {
        return this._clipVideoEls[id];
      }
      return new Promise((resolve) => {
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.preload = 'auto';
        v.crossOrigin = 'anonymous';
        v.onloadeddata = () => {
          this._clipVideoEls[id] = v;
          resolve(v);
        };
        v.onerror = () => resolve(null);
        v.src = scene.clipDataUrl;
      });
    },

    paintClipScene(ctx, W, H, scene, local) {
      const v = this._clipVideoEls?.[scene.id];
      const cutStart = Number(scene.cutStart) || 0;
      const cutEnd = Number(scene.cutEnd) || 0;
      const dur = Math.max(0.1, scene.duration || 1);
      if (v && v.readyState >= 2) {
        const clipLen = (cutEnd > cutStart ? cutEnd - cutStart : v.duration || dur);
        const frac = Math.min(1, local / dur);
        const t = cutStart + frac * clipLen;
        try {
          if (Math.abs(v.currentTime - t) > 0.08) v.currentTime = t;
        } catch (_) { /* seek */ }
        // Edge-to-edge cover — fills whole frame in landscape and vertical
        this.drawCover(ctx, v, 0, 0, W, H);
      } else {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.font = `${Math.round(W * 0.03)}px system-ui,sans-serif`;
        ctx.fillText(scene.label || 'Video clip', W / 2, H / 2);
      }
    },

    cutClip(sceneId, startSec, endSec) {
      const scene = (this.timeline || this.scenes || []).find((s) => s.id === sceneId);
      if (!scene || scene.type !== 'clip') return this.toast('Clip not found', 'error');
      const start = Math.max(0, Number(startSec) || 0);
      const end = Math.max(start + 0.5, Number(endSec) || start + 3);
      scene.cutStart = start;
      scene.cutEnd = end;
      scene.duration = Math.min(30, end - start);
      this.timelineManual = true;
      this.materializeTimeline();
      this.refreshTimelineDom();
      this.toast('Clip trimmed', 'success');
    },

    bindTimelineDnD(container) {
      const root = container || document.getElementById('pvb-timeline');
      if (!root) return;
      let dragId = null;
      root.querySelectorAll('[data-timeline-id]').forEach((row) => {
        row.setAttribute('draggable', 'true');
        row.addEventListener('dragstart', (e) => {
          dragId = row.dataset.timelineId;
          row.classList.add('is-dragging');
          e.dataTransfer.effectAllowed = 'move';
        });
        row.addEventListener('dragend', () => {
          row.classList.remove('is-dragging');
          dragId = null;
        });
        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          row.classList.add('is-drop-target');
        });
        row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          row.classList.remove('is-drop-target');
          const targetId = row.dataset.timelineId;
          if (!dragId || !targetId || dragId === targetId) return;
          this.reorderTimeline(dragId, targetId);
        });
      });

      root.querySelectorAll('[data-scene-dur]').forEach((inp) => {
        inp.addEventListener('change', () => {
          const id = inp.dataset.sceneDur;
          const scene = (this.timeline || []).find((s) => s.id === id);
          if (!scene) return;
          scene.duration = Math.max(0.5, Math.min(60, Number(inp.value) || scene.duration));
          this.timelineManual = true;
          this.materializeTimeline();
          this.refreshTimelineDom();
          this.drawPreviewFrame(this.previewTime || 0);
        });
      });

      root.querySelectorAll('[data-scene-play]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.playSceneOnly?.(btn.dataset.scenePlay);
        });
      });

      root.querySelectorAll('[data-edit-text]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openTextSceneEditor?.(btn.dataset.editText);
        });
      });

      root.querySelectorAll('[data-edit-transition]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openTransitionEditor?.(btn.dataset.editTransition);
        });
      });

      root.querySelectorAll('[data-cut-clip]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.cutClip;
          const scene = (this.timeline || []).find((s) => s.id === id);
          if (!scene) return;
          const start = prompt('Clip start (seconds)', String(scene.cutStart || 0));
          if (start == null) return;
          const end = prompt('Clip end (seconds)', String(scene.cutEnd || (Number(start) + 5)));
          if (end == null) return;
          this.cutClip(id, start, end);
        });
      });

      root.querySelectorAll('[data-remove-scene]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.removeScene;
          if (id === 'intro' || id === 'outro') return;
          this.timeline = (this.timeline || []).filter((s) => s.id !== id);
          this.timelineManual = true;
          this.materializeTimeline();
          this.refreshTimelineDom();
          this.drawPreviewFrame(0);
        });
      });
    },

    reorderTimeline(dragId, targetId) {
      const list = this.timeline || [];
      const from = list.findIndex((s) => s.id === dragId);
      const to = list.findIndex((s) => s.id === targetId);
      if (from < 0 || to < 0) return;
      if (dragId === 'intro' || dragId === 'outro' || targetId === 'intro' || targetId === 'outro') {
        return this.toast('Intro/outro stay at edges', 'info');
      }
      const intro = list.find((s) => s.type === 'intro');
      const outro = list.find((s) => s.type === 'outro');
      const mid = list.filter((s) => s.type !== 'intro' && s.type !== 'outro');
      const fi = mid.findIndex((s) => s.id === dragId);
      const ti = mid.findIndex((s) => s.id === targetId);
      if (fi < 0 || ti < 0) return;
      // Preserve each scene's transitionIn when reordering
      const [moved] = mid.splice(fi, 1);
      mid.splice(ti, 0, moved);
      this.timeline = [intro, ...mid, outro].filter(Boolean);
      this.timelineManual = true;
      this.ensureSceneTransitions?.();
      this.materializeTimeline();
      this.refreshTimelineDom();
      this.drawPreviewFrame(this.previewTime || 0);
      this.toast('Timeline order updated', 'success');
    },

    refreshTimelineDom() {
      const sc = document.getElementById('pvb-timeline') || document.getElementById('pvb-scenes');
      if (!sc) return;
      sc.innerHTML = this.timelineHtml();
      this.bindTimelineDnD(sc);
    },

    checkProductChanges(vidId) {
      const v = this.videos.find((x) => x.id === vidId);
      if (!v?.productSnapshot?.length) {
        this.toast('No product snapshot on this video', 'info');
        return [];
      }
      const changes = [];
      v.productSnapshot.forEach((snap) => {
        const live = this.products.find((p) => Number(p.id) === Number(snap.id));
        if (!live) {
          changes.push({ id: snap.id, name: snap.name, type: 'missing' });
          return;
        }
        const livePrice = Number(live.selling_price) || 0;
        const snapPrice = Number(snap.selling_price ?? snap.price) || 0;
        if (Math.abs(livePrice - snapPrice) > 0.009) {
          changes.push({
            id: snap.id,
            name: live.name,
            type: 'price',
            was: snapPrice,
            now: livePrice
          });
        }
      });
      if (!changes.length) this.toast('Products match snapshot', 'success');
      else this.toast(`${changes.length} product change(s) since export`, 'info');
      return changes;
    },

    loadPlaylists() {
      try {
        return JSON.parse(localStorage.getItem(this.PLAYLIST_KEY) || '[]');
      } catch (_) {
        return [];
      }
    },

    savePlaylists(list) {
      try { localStorage.setItem(this.PLAYLIST_KEY, JSON.stringify(list.slice(0, 30))); } catch (_) { /* */ }
    },

    playlistCreate(name) {
      const list = this.loadPlaylists();
      list.unshift({
        id: `pl_${Date.now()}`,
        name: name || 'Playlist',
        videoIds: [],
        createdAt: new Date().toISOString()
      });
      this.savePlaylists(list);
      return list[0];
    },

    playlistAddVideo(playlistId, videoId) {
      const list = this.loadPlaylists();
      const pl = list.find((x) => x.id === playlistId);
      if (!pl) return;
      if (!pl.videoIds.includes(videoId)) pl.videoIds.push(videoId);
      this.savePlaylists(list);
      this.toast('Added to playlist', 'success');
    },

    loadCampaigns() {
      try {
        return JSON.parse(localStorage.getItem(this.CAMPAIGN_KEY) || '[]');
      } catch (_) {
        return [];
      }
    },

    saveCampaigns(list) {
      try { localStorage.setItem(this.CAMPAIGN_KEY, JSON.stringify(list.slice(0, 20))); } catch (_) { /* */ }
    },

    duplicateVideo(vidId) {
      const v = this.videos.find((x) => x.id === vidId);
      if (!v) return;
      const changes = this.checkProductChanges?.(vidId) || [];
      if (changes.length) {
        const lines = changes.map((c) => c.type === 'price'
          ? `${c.name} was ${this.money(c.was)} and is now ${this.money(c.now)}`
          : `${c.name} is missing`).join('\n');
        const ok = confirm(`Linked products changed:\n\n${lines}\n\nDuplicate and open editor with current catalogue prices?`);
        if (!ok) return;
      }
      this.mode = 'create';
      this._regenFromVidId = vidId;
      if (Array.isArray(v.productSnapshot) && v.productSnapshot.length) {
        this.selectedIds = new Set(v.productSnapshot.map((p) => Number(p.id)).filter(Boolean));
        this.sourceTab = 'products';
      }
      if (v.branchId) this.branchId = String(v.branchId);
      if (v.format) this.draft.format = v.format;
      if (v.template) this.draft.template = v.template;
      this.draft.title = `${v.title || 'Video'} (copy)`;
      this.draft.sourceLabel = v.source || this.draft.sourceLabel;
      this.timelineManual = false;
      this.buildScenes();
      this.toast('Duplicated into editor — change branch/products then generate', 'success');
      this.paint();
    },

    campaignCreate(title, videoIds, meta = {}) {
      const list = this.loadCampaigns();
      const entry = {
        id: `camp_${Date.now()}`,
        title: title || this.draft.title || 'Campaign',
        videoIds: videoIds || [],
        createdAt: new Date().toLocaleString(),
        branchId: meta.branchId || this.branchId,
        startDate: meta.startDate || '',
        startTime: meta.startTime || '',
        endDate: meta.endDate || '',
        endTime: meta.endTime || '',
        status: 'scheduled'
      };
      list.unshift(entry);
      this.saveCampaigns(this.refreshCampaignStatuses(list));
      return entry;
    },

    async playlistGenerate(playlistId) {
      const pl = this.loadPlaylists().find((x) => x.id === playlistId);
      if (!pl?.videoIds?.length) return this.toast('Playlist empty', 'error');
      const vids = pl.videoIds.map((id) => this.videos.find((v) => v.id === id)).filter((v) => v?.dataUrl);
      if (!vids.length) return this.toast('No playable videos in playlist', 'error');
      const w = window.open('', '_blank');
      if (!w) return this.toast('Allow pop-ups to preview playlist', 'error');
      const sources = vids.map((v) => v.dataUrl);
      const titles = vids.map((v) => String(v.title || 'Video').replace(/</g, ''));
      w.document.write(`<!DOCTYPE html><html><head><title>${this.esc(pl.name)}</title>
        <style>body{margin:0;background:#0f172a;color:#e2e8f0;font-family:system-ui;display:flex;flex-direction:column;align-items:center;min-height:100vh}
        video{max-width:100%;max-height:80vh;background:#000} .meta{padding:12px;text-align:center}</style></head>
        <body><div class="meta"><strong>${this.esc(pl.name)}</strong><div id="t"></div></div>
        <video id="v" controls autoplay></video>
        <script>
          const srcs=${JSON.stringify(sources)};
          const titles=${JSON.stringify(titles)};
          let i=0; const v=document.getElementById('v'); const t=document.getElementById('t');
          function play(){ if(!srcs.length) return; v.src=srcs[i%srcs.length]; t.textContent=titles[i%titles.length]+' ('+(i%srcs.length+1)+'/'+srcs.length+')'; v.play(); }
          v.addEventListener('ended',()=>{ i++; play(); });
          play();
        <\/script></body></html>`);
      w.document.close();
      this.toast(`Playlist "${pl.name}" — continuous loop opened`, 'success');
    },

    refreshAudioList() {
      const list = document.getElementById('pvb-audio-list');
      if (list) {
        list.innerHTML = this.audioTracksHtml();
        this.bindAudioTrackControls();
      }
    },

    migrateLegacyMusicToTracks() {
      if ((this.audioTracks || []).length) return;
      if (!this.draft?.musicDataUrl) return;
      const id = this.draft.musicId || `music_${Date.now()}`;
      this.audioTracks = [{
        id,
        kind: 'music',
        name: this.draft.musicName || 'Music',
        dataUrl: this.draft.musicDataUrl,
        volume: this.draft.musicVolume ?? 0.7,
        enabled: true,
        cutStart: 0,
        cutEnd: null,
        playAt: 0,
        fileDuration: 0
      }];
      this.probeTrackDuration(this.audioTracks[0]);
    },

    async addAudioFiles(fileList, kind) {
      const files = [...(fileList || [])];
      if (!files.length) return;
      for (const file of files) {
        try {
          const buf = await file.arrayBuffer();
          const dataUrl = await this.blobToDataUrl(file);
          const id = `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          this._audioBuffers[id] = buf.slice(0);
          const track = {
            id,
            kind: kind === 'voice' ? 'voice' : 'music',
            name: file.name || (kind === 'voice' ? 'Voice' : 'Music'),
            dataUrl,
            volume: kind === 'voice' ? 1 : 0.7,
            enabled: true,
            cutStart: 0,
            cutEnd: null,
            playAt: 0,
            fileDuration: 0
          };
          this.audioTracks = this.audioTracks || [];
          this.audioTracks.push(track);
          if (kind === 'music') {
            this.musicLibrary.unshift({ id, name: track.name, dataUrl });
            this.saveMusic();
          }
          await this.probeTrackDuration(track);
        } catch (err) {
          console.warn(err);
          this.toast(`Could not load ${file.name}`, 'error');
        }
      }
      // Keep primary draft music in sync for older paths
      const firstMusic = (this.audioTracks || []).find((t) => t.kind === 'music' && t.enabled !== false);
      if (firstMusic) {
        this.draft.musicDataUrl = firstMusic.dataUrl;
        this.draft.musicName = firstMusic.name;
        this.draft.musicId = firstMusic.id;
        this._musicArrayBuffer = this._audioBuffers[firstMusic.id] || null;
      }
      this.refreshAudioList();
      this.toast(`${files.length} audio file(s) added`, 'success');
    },

    async probeTrackDuration(track) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const raw = this._audioBuffers[track.id]
          || (await this.arrayBufferFromDataUrl(track.dataUrl));
        const copy = raw.slice(0);
        const decoded = await ctx.decodeAudioData(copy);
        track.fileDuration = decoded.duration;
        if (track.cutEnd == null || track.cutEnd > decoded.duration) {
          track.cutEnd = Number(decoded.duration.toFixed(2));
        }
        try { await ctx.close(); } catch (_) { /* */ }
        this.refreshAudioList();
      } catch (_) { /* */ }
    },

    async arrayBufferFromDataUrl(dataUrl) {
      if (!dataUrl) return null;
      if (dataUrl.startsWith('data:')) {
        const comma = dataUrl.indexOf(',');
        const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
      }
      const res = await fetch(dataUrl);
      return res.arrayBuffer();
    },

    stopTrackListen() {
      try { this._trackPreviewAudio?.pause(); } catch (_) { /* */ }
      this._trackPreviewAudio = null;
    },

    async listenToTrack(id) {
      const track = (this.audioTracks || []).find((t) => t.id === id);
      if (!track?.dataUrl) return;
      this.stopTrackListen();
      const audio = new Audio(track.dataUrl);
      audio.volume = Math.max(0, Math.min(1, track.volume ?? 0.7));
      const start = Math.max(0, Number(track.cutStart) || 0);
      const end = track.cutEnd != null ? Number(track.cutEnd) : null;
      audio.currentTime = start;
      const onTime = () => {
        if (end != null && audio.currentTime >= end) {
          audio.pause();
          audio.removeEventListener('timeupdate', onTime);
        }
      };
      audio.addEventListener('timeupdate', onTime);
      this._trackPreviewAudio = audio;
      try {
        await audio.play();
        this.toast(`Listening: ${track.name}`, 'info');
      } catch (err) {
        this.toast('Could not play audio — check browser permissions', 'error');
      }
    },

    saveVoiceTrackAlone(id) {
      const track = (this.audioTracks || []).find((t) => t.id === id && t.kind === 'voice');
      if (!track?.dataUrl) return this.toast('Voice track not found', 'error');
      const a = document.createElement('a');
      a.href = track.dataUrl;
      const ext = track.dataUrl.includes('audio/ogg') ? 'ogg'
        : track.dataUrl.includes('audio/wav') ? 'wav' : 'webm';
      a.download = `${String(track.name || 'voice-over').replace(/\W+/g, '-')}.${ext}`;
      a.click();
      this.toast('Voice saved to your downloads', 'success');
    },

    async startVoiceRecording() {
      if (this._voiceRecorder) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
        this._voiceChunks = [];
        this._voiceRecorder = mime
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream);
        this._voiceRecorder.ondataavailable = (e) => {
          if (e.data?.size) this._voiceChunks.push(e.data);
        };
        this._voiceRecorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(this._voiceChunks, { type: this._voiceRecorder.mimeType || 'audio/webm' });
          this._voiceRecorder = null;
          const file = new File([blob], `voice-recording-${Date.now()}.webm`, { type: blob.type });
          await this.addAudioFiles([file], 'voice');
          document.getElementById('pvb-voice-record')?.classList.remove('hidden');
          document.getElementById('pvb-voice-stop')?.classList.add('hidden');
          this.toast('Voice recording added — trim & preview below', 'success');
        };
        this._voiceRecorder.start();
        document.getElementById('pvb-voice-record')?.classList.add('hidden');
        document.getElementById('pvb-voice-stop')?.classList.remove('hidden');
        this.toast('Recording… press Stop when done', 'info');
      } catch (err) {
        console.warn(err);
        this.toast('Microphone permission needed to record', 'error');
      }
    },

    stopVoiceRecording() {
      try { this._voiceRecorder?.stop(); } catch (_) { /* */ }
    },

    bindAudioTrackControls() {
      this.el?.querySelectorAll('[data-audio-preview]').forEach((btn) => {
        btn.addEventListener('click', () => this.listenToTrack(btn.dataset.audioPreview));
      });
      this.el?.querySelectorAll('[data-audio-stop-prev]').forEach((btn) => {
        btn.addEventListener('click', () => this.stopTrackListen());
      });
      this.el?.querySelectorAll('[data-audio-save]').forEach((btn) => {
        btn.addEventListener('click', () => this.saveVoiceTrackAlone(btn.dataset.audioSave));
      });
      this.el?.querySelectorAll('[data-audio-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.audioDel;
          this.audioTracks = (this.audioTracks || []).filter((t) => t.id !== id);
          delete this._audioBuffers[id];
          this.refreshAudioList();
        });
      });
      this.el?.querySelectorAll('[data-audio-on]').forEach((inp) => {
        inp.addEventListener('change', () => {
          const tr = (this.audioTracks || []).find((t) => t.id === inp.dataset.audioOn);
          if (tr) tr.enabled = !!inp.checked;
        });
      });
      this.el?.querySelectorAll('[data-audio-vol]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const tr = (this.audioTracks || []).find((t) => t.id === inp.dataset.audioVol);
          if (tr) tr.volume = (Number(inp.value) || 0) / 100;
        });
      });
      const numBind = (sel, key) => {
        this.el?.querySelectorAll(sel).forEach((inp) => {
          inp.addEventListener('change', () => {
            const id = inp.dataset[Object.keys(inp.dataset)[0]];
            const tr = (this.audioTracks || []).find((t) => t.id === id);
            if (!tr) return;
            tr[key] = Number(inp.value) || 0;
          });
        });
      };
      this.el?.querySelectorAll('[data-audio-cut-start]').forEach((inp) => {
        inp.addEventListener('change', () => {
          const tr = (this.audioTracks || []).find((t) => t.id === inp.dataset.audioCutStart);
          if (tr) tr.cutStart = Math.max(0, Number(inp.value) || 0);
        });
      });
      this.el?.querySelectorAll('[data-audio-cut-end]').forEach((inp) => {
        inp.addEventListener('change', () => {
          const tr = (this.audioTracks || []).find((t) => t.id === inp.dataset.audioCutEnd);
          if (tr) tr.cutEnd = Math.max(0.1, Number(inp.value) || 0.1);
        });
      });
      this.el?.querySelectorAll('[data-audio-play-at]').forEach((inp) => {
        inp.addEventListener('change', () => {
          const tr = (this.audioTracks || []).find((t) => t.id === inp.dataset.audioPlayAt);
          if (tr) tr.playAt = Math.max(0, Number(inp.value) || 0);
        });
      });
    },

    TRANSITION_STYLES: [
      { id: 'fade', label: 'Fade' },
      { id: 'crossfade', label: 'Crossfade' },
      { id: 'dissolve', label: 'Dissolve' },
      { id: 'slide-left', label: 'Slide Left' },
      { id: 'slide-right', label: 'Slide Right' },
      { id: 'slide-up', label: 'Slide Up' },
      { id: 'slide-down', label: 'Slide Down' },
      { id: 'zoom-in', label: 'Zoom In' },
      { id: 'zoom-out', label: 'Zoom Out' },
      { id: 'wipe', label: 'Wipe' },
      { id: 'push', label: 'Push' },
      { id: 'pop', label: 'Pop' },
      { id: 'swipe', label: 'Swipe' },
      { id: 'cinematic', label: 'Cinematic' },
      { id: 'slide', label: 'Slide' },
      { id: 'zoom', label: 'Zoom' }
    ],

    TEXT_FONTS: [
      { id: 'system-ui,Segoe UI,sans-serif', label: 'Clean Sans' },
      { id: 'Georgia,serif', label: 'Elegant Serif' },
      { id: 'Impact,Haettenschweiler,sans-serif', label: 'Bold Impact' },
      { id: '"Arial Black",Arial,sans-serif', label: 'Heavy Black' },
      { id: '"Trebuchet MS",sans-serif', label: 'Modern' },
      { id: '"Courier New",monospace', label: 'Typewriter' }
    ],

    defaultTextProps() {
      return {
        content: 'Your promo text',
        style: 'headline',
        font: 'system-ui,Segoe UI,sans-serif',
        size: 1,
        color: '#ffffff',
        position: 'center',
        background: 'dim',
        bgColor: '#0f172a',
        animation: 'fade-up',
        duration: 3
      };
    },

    sceneHasPlayableContent(scene) {
      if (!scene) return false;
      if (scene.type === 'intro' || scene.type === 'outro') return true;
      if (scene.type === 'text') return !!(scene.text?.content || '').trim();
      if (scene.type === 'clip') return !!(scene.clipDataUrl || scene.clipUrl);
      if (scene.id === 'empty') return false;
      return !!(scene.item?.name && scene.item.name !== 'Select products');
    },

    async playSceneOnly(sceneId) {
      this.buildScenes();
      const scene = (this.scenes || []).find((s) => s.id === sceneId);
      if (!scene) return this.toast('Scene not found', 'error');
      if (!this.sceneHasPlayableContent(scene)) {
        return this.toast('Nothing to play in this scene', 'info');
      }
      if (this.previewPlaying) this.stopPreview();
      this.previewTime = scene.start || 0;
      this.drawPreviewFrame(this.previewTime);
      this.refreshTimelineDom?.();
      await this.togglePreview({
        from: scene.start || 0,
        until: scene.end || ((scene.start || 0) + (scene.duration || 1))
      });
    },

    addTextScene(props) {
      const text = { ...this.defaultTextProps(), ...(props || {}) };
      const id = `text_${Date.now()}`;
      const scene = {
        id,
        type: 'text',
        label: (text.content || 'Text').slice(0, 40),
        text,
        duration: Math.max(0.8, Math.min(30, Number(text.duration) || 3)),
        transitionIn: { style: this.draft.transition || 'fade', duration: 0.4 }
      };
      const list = this.timeline?.length ? [...this.timeline] : [];
      if (!list.length) this.buildScenes();
      const outIdx = (this.timeline || []).findIndex((s) => s.type === 'outro');
      const base = this.timeline || list;
      if (outIdx >= 0) base.splice(outIdx, 0, scene);
      else base.push(scene);
      this.timeline = base;
      this.timelineManual = true;
      this.ensureSceneTransitions?.();
      this.materializeTimeline();
      this.refreshTimelineDom?.();
      this.drawPreviewFrame(scene.start || 0);
      return scene;
    },

    updateTextScene(sceneId, props) {
      const scene = (this.timeline || []).find((s) => s.id === sceneId);
      if (!scene || scene.type !== 'text') return;
      scene.text = { ...this.defaultTextProps(), ...(scene.text || {}), ...(props || {}) };
      scene.label = (scene.text.content || 'Text').slice(0, 40);
      scene.duration = Math.max(0.8, Math.min(30, Number(scene.text.duration) || scene.duration || 3));
      this.timelineManual = true;
      this.materializeTimeline();
      this.refreshTimelineDom?.();
      this.drawPreviewFrame(scene.start || 0);
    },

    paintTextScene(ctx, W, H, t, scene, local, dur) {
      const tx = { ...this.defaultTextProps(), ...(scene?.text || {}) };
      const content = String(tx.content || '').trim() || 'Text';
      const anim = String(tx.animation || 'fade-up');
      const edge = Math.min(0.55, dur * 0.28);
      let alpha = 1;
      let dy = 0;
      let dx = 0;
      let scale = 1;
      let showChars = content.length;
      if (local < edge) {
        const p = this.ease(local / edge);
        alpha = p;
        if (anim === 'fade-up' || anim === 'slide-up') dy = (1 - p) * 48;
        else if (anim === 'slide-down') dy = -(1 - p) * 48;
        else if (anim === 'slide-left') dx = (1 - p) * 60;
        else if (anim === 'zoom' || anim === 'pop') scale = 0.7 + 0.3 * p;
        else if (anim === 'typewriter') showChars = Math.max(1, Math.floor(content.length * p));
      } else if (local > dur - edge * 0.7) {
        const p = this.ease((dur - local) / (edge * 0.7));
        alpha = p;
      }
      if (anim === 'typewriter' && local >= edge) showChars = content.length;

      // Background treatment
      if (tx.background === 'solid') {
        ctx.fillStyle = tx.bgColor || '#0f172a';
        ctx.fillRect(0, 0, W, H);
      } else if (tx.background === 'gradient') {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, tx.bgColor || '#0f172a');
        g.addColorStop(1, t?.accent || '#ef4444');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      } else if (tx.background === 'dim') {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, W, H);
      }

      let ax = W / 2;
      let ay = H / 2;
      let align = 'center';
      if (tx.position === 'top') ay = H * 0.22;
      else if (tx.position === 'bottom') ay = H * 0.78;
      else if (tx.position === 'left') { ax = W * 0.12; align = 'left'; }
      else if (tx.position === 'right') { ax = W * 0.88; align = 'right'; }

      const sizeMul = Math.max(0.5, Math.min(2.2, Number(tx.size) || 1));
      let fontPx = Math.round(W * 0.055 * sizeMul);
      if (tx.style === 'subtitle') fontPx = Math.round(W * 0.038 * sizeMul);
      if (tx.style === 'badge') fontPx = Math.round(W * 0.032 * sizeMul);

      const display = content.slice(0, showChars);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(ax + dx, ay + dy);
      ctx.scale(scale, scale);
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${fontPx}px ${tx.font || 'system-ui,sans-serif'}`;

      if (tx.style === 'badge') {
        const padX = fontPx * 0.55;
        const padY = fontPx * 0.35;
        const tw = ctx.measureText(display).width;
        ctx.fillStyle = t?.accent || '#ef4444';
        this.roundRect(ctx, (align === 'left' ? 0 : align === 'right' ? -tw : -tw / 2) - padX, -fontPx / 2 - padY, tw + padX * 2, fontPx + padY * 2, 14);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(display, 0, 0);
      } else if (tx.style === 'outline') {
        ctx.strokeStyle = tx.color || '#fff';
        ctx.lineWidth = Math.max(2, fontPx * 0.06);
        ctx.strokeText(display, 0, 0);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillText(display, 0, 0);
      } else {
        if (tx.style === 'shadow' || tx.style === 'headline') {
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillText(display, 3, 4);
        }
        ctx.fillStyle = tx.color || '#fff';
        ctx.fillText(display, 0, 0);
      }
      ctx.restore();
    },

    openTextSceneEditor(sceneId) {
      const existing = sceneId ? (this.timeline || []).find((s) => s.id === sceneId) : null;
      const tx = { ...this.defaultTextProps(), ...(existing?.text || {}) };
      document.getElementById('pvb-text-modal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'pvb-text-modal';
      modal.className = 'pvb-modal-backdrop';
      const fonts = this.TEXT_FONTS || [];
      modal.innerHTML = `
        <div class="pvb-modal" role="dialog" aria-label="Custom text scene">
          <div class="pvb-modal-head">
            <strong>${existing ? 'Edit Text Scene' : 'Add Text Scene'}</strong>
            <button type="button" class="btn btn-ghost btn-sm" data-close>×</button>
          </div>
          <div class="pvb-modal-body pvb-text-form">
            <label>Text<textarea id="pvb-tx-content" rows="3">${this.esc(tx.content)}</textarea></label>
            <label>Style
              <select id="pvb-tx-style">
                ${['headline', 'subtitle', 'badge', 'outline', 'shadow'].map((s) =>
                  `<option value="${s}" ${tx.style === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </label>
            <label>Font
              <select id="pvb-tx-font">
                ${fonts.map((f) => `<option value="${this.esc(f.id)}" ${tx.font === f.id ? 'selected' : ''}>${this.esc(f.label)}</option>`).join('')}
              </select>
            </label>
            <label>Size <input type="range" id="pvb-tx-size" min="0.5" max="2.2" step="0.1" value="${Number(tx.size) || 1}"> <span id="pvb-tx-size-val">${Number(tx.size) || 1}</span></label>
            <label>Colour <input type="color" id="pvb-tx-color" value="${this.esc(tx.color || '#ffffff')}"></label>
            <label>Position
              <select id="pvb-tx-pos">
                ${['center', 'top', 'bottom', 'left', 'right'].map((p) =>
                  `<option value="${p}" ${tx.position === p ? 'selected' : ''}>${p}</option>`).join('')}
              </select>
            </label>
            <label>Background
              <select id="pvb-tx-bg">
                ${[['none', 'None'], ['dim', 'Dim overlay'], ['solid', 'Solid'], ['gradient', 'Gradient']].map(([v, l]) =>
                  `<option value="${v}" ${tx.background === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </label>
            <label>BG colour <input type="color" id="pvb-tx-bgcolor" value="${this.esc(tx.bgColor || '#0f172a')}"></label>
            <label>Animation
              <select id="pvb-tx-anim">
                ${[['fade', 'Fade'], ['fade-up', 'Fade Up'], ['slide-up', 'Slide Up'], ['slide-down', 'Slide Down'], ['zoom', 'Zoom'], ['pop', 'Pop'], ['typewriter', 'Typewriter']].map(([v, l]) =>
                  `<option value="${v}" ${tx.animation === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </label>
            <label>Duration (s) <input type="number" id="pvb-tx-dur" min="0.8" max="30" step="0.1" value="${Number(tx.duration) || 3}"></label>
          </div>
          <div class="pvb-modal-foot">
            <button type="button" class="btn btn-ghost" data-close>Cancel</button>
            <button type="button" class="btn pvb-generate" id="pvb-tx-save">${existing ? 'Update' : 'Add to Timeline'}</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      const close = () => modal.remove();
      modal.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
      modal.querySelector('#pvb-tx-size')?.addEventListener('input', (e) => {
        const v = document.getElementById('pvb-tx-size-val');
        if (v) v.textContent = e.target.value;
      });
      modal.querySelector('#pvb-tx-save')?.addEventListener('click', () => {
        const props = {
          content: document.getElementById('pvb-tx-content')?.value || '',
          style: document.getElementById('pvb-tx-style')?.value || 'headline',
          font: document.getElementById('pvb-tx-font')?.value || this.defaultTextProps().font,
          size: Number(document.getElementById('pvb-tx-size')?.value) || 1,
          color: document.getElementById('pvb-tx-color')?.value || '#ffffff',
          position: document.getElementById('pvb-tx-pos')?.value || 'center',
          background: document.getElementById('pvb-tx-bg')?.value || 'dim',
          bgColor: document.getElementById('pvb-tx-bgcolor')?.value || '#0f172a',
          animation: document.getElementById('pvb-tx-anim')?.value || 'fade-up',
          duration: Number(document.getElementById('pvb-tx-dur')?.value) || 3
        };
        if (!String(props.content).trim()) return this.toast('Enter some text first', 'error');
        if (existing) this.updateTextScene(existing.id, props);
        else this.addTextScene(props);
        close();
        this.toast(existing ? 'Text scene updated' : 'Text scene added', 'success');
      });
    },

    openTransitionEditor(sceneId) {
      const list = this.timeline || this.scenes || [];
      const idx = list.findIndex((s) => s.id === sceneId);
      if (idx <= 0) return this.toast('No incoming transition for first scene', 'info');
      const scene = list[idx];
      const prev = list[idx - 1];
      this.ensureSceneTransitions?.();
      const tr = scene.transitionIn || { style: this.draft.transition || 'fade', duration: 0.4 };
      document.getElementById('pvb-tr-modal')?.remove();
      const styles = this.TRANSITION_STYLES || [];
      const modal = document.createElement('div');
      modal.id = 'pvb-tr-modal';
      modal.className = 'pvb-modal-backdrop';
      const prevLabel = prev.type === 'intro' ? 'Intro' : prev.type === 'text' ? (prev.text?.content || 'Text') : (prev.item?.name || prev.label || prev.type);
      const nextLabel = scene.type === 'outro' ? 'End Screen' : scene.type === 'text' ? (scene.text?.content || 'Text') : (scene.item?.name || scene.label || scene.type);
      modal.innerHTML = `
        <div class="pvb-modal" role="dialog" aria-label="Edit transition">
          <div class="pvb-modal-head">
            <strong>Transition</strong>
            <button type="button" class="btn btn-ghost btn-sm" data-close>×</button>
          </div>
          <p class="pvb-tr-path">${this.esc(String(prevLabel).slice(0, 28))} → <em id="pvb-tr-label">${this.esc((styles.find((x) => x.id === tr.style)?.label) || tr.style)}</em> → ${this.esc(String(nextLabel).slice(0, 28))}</p>
          <div class="pvb-modal-body">
            <div class="pvb-tr-grid" id="pvb-tr-grid">
              ${styles.map((s) => `<button type="button" class="pvb-tr-opt ${tr.style === s.id ? 'is-on' : ''}" data-tr-style="${s.id}">${this.esc(s.label)}</button>`).join('')}
            </div>
            <label class="pvb-tr-dur">Duration
              <input type="range" id="pvb-tr-dur" min="0.15" max="2.5" step="0.05" value="${Number(tr.duration) || 0.4}">
              <span id="pvb-tr-dur-val">${Number(tr.duration || 0.4).toFixed(2)}s</span>
            </label>
            <canvas id="pvb-tr-preview" class="pvb-tr-preview" width="320" height="180"></canvas>
          </div>
          <div class="pvb-modal-foot">
            <button type="button" class="btn btn-ghost" id="pvb-tr-preview-btn">Preview</button>
            <button type="button" class="btn btn-ghost" id="pvb-tr-apply-all">Apply to All</button>
            <button type="button" class="btn btn-ghost" data-close>Cancel</button>
            <button type="button" class="btn pvb-generate" id="pvb-tr-apply">Apply</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      let selected = tr.style || 'fade';
      let dur = Number(tr.duration) || 0.4;
      const close = () => {
        if (this._trPreviewRaf) cancelAnimationFrame(this._trPreviewRaf);
        modal.remove();
      };
      modal.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
      modal.querySelectorAll('[data-tr-style]').forEach((btn) => {
        btn.addEventListener('click', () => {
          selected = btn.dataset.trStyle;
          modal.querySelectorAll('.pvb-tr-opt').forEach((b) => b.classList.toggle('is-on', b === btn));
          const lab = document.getElementById('pvb-tr-label');
          if (lab) lab.textContent = styles.find((x) => x.id === selected)?.label || selected;
          this.previewTransitionSample?.(prev, scene, selected, dur);
        });
      });
      modal.querySelector('#pvb-tr-dur')?.addEventListener('input', (e) => {
        dur = Number(e.target.value) || 0.4;
        const v = document.getElementById('pvb-tr-dur-val');
        if (v) v.textContent = `${dur.toFixed(2)}s`;
      });
      modal.querySelector('#pvb-tr-preview-btn')?.addEventListener('click', () => {
        this.previewTransitionSample?.(prev, scene, selected, dur, true);
      });
      modal.querySelector('#pvb-tr-apply')?.addEventListener('click', () => {
        scene.transitionIn = { style: selected, duration: dur };
        this.timelineManual = true;
        this.refreshTimelineDom?.();
        close();
        this.toast('Transition updated', 'success');
      });
      modal.querySelector('#pvb-tr-apply-all')?.addEventListener('click', () => {
        (this.timeline || []).forEach((s, i) => {
          if (i === 0) return;
          s.transitionIn = { style: selected, duration: dur };
        });
        this.draft.transition = selected;
        this.timelineManual = true;
        this.refreshTimelineDom?.();
        close();
        this.toast('Applied transition to all gaps', 'success');
      });
      this.previewTransitionSample?.(prev, scene, selected, dur);
    },

    async previewTransitionSample(prev, next, style, duration, animate) {
      const canvas = document.getElementById('pvb-tr-preview');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const W = canvas.width;
      const H = canvas.height;
      await this.ensureAssets?.();
      const run = (p) => {
        // Simulate transition mid-point into next scene
        const fakeNext = { ...next, start: 0, end: 2, duration: 2, transitionIn: { style, duration } };
        const local = Math.max(0.01, Math.min(duration * 0.95, duration * p));
        // Temporarily swap scenes render via paintSceneContent with mix
        const t = this.THEMES[this.draft.theme] || this.THEMES.red;
        const shop = this.shopBlock();
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, t.bg);
        g.addColorStop(1, t.card);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        const mix = this.transitionMix(local, 2, style, duration);
        if (prev && (style === 'crossfade' || style === 'dissolve')) {
          ctx.save();
          ctx.globalAlpha = 1 - this.ease(Math.min(1, local / Math.max(0.12, duration)));
          this.paintSceneContent(ctx, W, H, t, shop, prev, (prev.duration || 1) * 0.9, prev.duration || 1, W > H, Math.abs(W - H) < 2);
          ctx.restore();
        }
        ctx.save();
        if (mix.wipe > 0 && mix.wipe < 1 && style === 'wipe') {
          ctx.beginPath();
          ctx.rect(0, 0, W * mix.wipe, H);
          ctx.clip();
        }
        ctx.globalAlpha = mix.alpha;
        ctx.translate(mix.slideX || 0, mix.slideY || 0);
        ctx.translate(W / 2, H / 2);
        ctx.scale(mix.scale || 1, mix.scale || 1);
        ctx.translate(-W / 2, -H / 2);
        this.paintSceneContent(ctx, W, H, t, shop, fakeNext, local, 2, W > H, Math.abs(W - H) < 2);
        ctx.restore();
      };
      if (!animate) {
        run(0.55);
        return;
      }
      if (this._trPreviewRaf) cancelAnimationFrame(this._trPreviewRaf);
      const t0 = performance.now();
      const len = Math.max(400, duration * 1000);
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / len);
        run(p);
        if (p < 1) this._trPreviewRaf = requestAnimationFrame(tick);
      };
      this._trPreviewRaf = requestAnimationFrame(tick);
    },

    resetTransitionsToAutomatic() {
      const style = this.draft.transition || 'fade';
      (this.timeline || []).forEach((s, i) => {
        if (i === 0) {
          delete s.transitionIn;
          return;
        }
        s.transitionIn = { style, duration: 0.4 };
      });
      this.ensureSceneTransitions?.();
      this.refreshTimelineDom?.();
      this.toast('Transitions reset to automatic', 'info');
    },

    async startPreviewAudioMix() {
      await this.stopPreviewAudioMix();
      if (this.previewAudioMuted) return null;
      this.migrateLegacyMusicToTracks?.();
      const tracks = (this.audioTracks || []).filter((t) => t.enabled !== false && t.dataUrl);
      if (!tracks.length) return null;
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        const master = audioCtx.createGain();
        master.gain.value = 1;
        master.connect(audioCtx.destination);
        const sources = [];
        const t0 = audioCtx.currentTime + 0.05;
        for (const tr of tracks) {
          try {
            let raw = this._audioBuffers[tr.id];
            if (!raw) {
              raw = await this.arrayBufferFromDataUrl(tr.dataUrl);
              this._audioBuffers[tr.id] = raw.slice(0);
            }
            const decoded = await audioCtx.decodeAudioData(raw.slice(0));
            const src = audioCtx.createBufferSource();
            src.buffer = decoded;
            const gain = audioCtx.createGain();
            gain.gain.value = Math.max(0, Math.min(1, tr.volume ?? 0.7));
            src.connect(gain);
            gain.connect(master);
            const cutStart = Math.max(0, Number(tr.cutStart) || 0);
            const cutEnd = tr.cutEnd != null ? Number(tr.cutEnd) : decoded.duration;
            const playAt = Math.max(0, Number(tr.playAt) || 0);
            const dur = Math.max(0.05, Math.min(decoded.duration - cutStart, cutEnd - cutStart));
            src.start(t0 + playAt, cutStart, dur);
            sources.push(src);
          } catch (err) {
            console.warn('Track mix skip', tr.name, err);
          }
        }
        this._previewMix = { audioCtx, sources, master };
        return this._previewMix;
      } catch (err) {
        console.warn('Preview audio mix failed', err);
        return null;
      }
    },

    async stopPreviewAudioMix() {
      try {
        this._previewMix?.sources?.forEach((s) => { try { s.stop(); } catch (_) { /* */ } });
      } catch (_) { /* */ }
      try { await this._previewMix?.audioCtx?.close(); } catch (_) { /* */ }
      this._previewMix = null;
      this.stopTrackListen();
    },

    setPreviewMixMuted(muted) {
      this.previewAudioMuted = !!muted;
      if (this._previewMix?.master) {
        this._previewMix.master.gain.value = muted ? 0 : 1;
      }
      const btn = document.getElementById('pvb-mute-audio');
      if (btn) btn.textContent = muted ? '🔇' : '🔊';
    },

    async mixAllTracksForExport(stream, totalSec) {
      this.migrateLegacyMusicToTracks?.();
      let tracks = (this.audioTracks || []).filter((t) => t.enabled !== false && t.dataUrl);
      if (!tracks.length && (this.draft.musicDataUrl || this._musicArrayBuffer)) {
        tracks = [{
          id: 'legacy',
          kind: 'music',
          dataUrl: this.draft.musicDataUrl,
          volume: this.draft.musicVolume ?? 0.7,
          cutStart: 0,
          cutEnd: null,
          playAt: 0
        }];
      }
      if (!tracks.length) return { audioCtx: null, sources: [] };
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const dest = audioCtx.createMediaStreamDestination();
      const sources = [];
      const t0 = audioCtx.currentTime + 0.02;
      for (const tr of tracks) {
        try {
          let raw = this._audioBuffers[tr.id];
          if (!raw && tr.id === 'legacy' && this._musicArrayBuffer) raw = this._musicArrayBuffer;
          if (!raw) raw = await this.arrayBufferFromDataUrl(tr.dataUrl);
          const decoded = await audioCtx.decodeAudioData(raw.slice(0));
          const src = audioCtx.createBufferSource();
          src.buffer = decoded;
          const gain = audioCtx.createGain();
          const vol = Math.max(0, Math.min(1, tr.volume ?? 0.7));
          gain.gain.value = vol;
          if (tr.kind !== 'voice' && this.draft.musicFadeIn !== false) {
            gain.gain.setValueAtTime(0, t0 + (Number(tr.playAt) || 0));
            gain.gain.linearRampToValueAtTime(vol, t0 + (Number(tr.playAt) || 0) + 1.0);
          }
          if (tr.kind !== 'voice' && this.draft.musicFadeOut !== false) {
            const end = t0 + totalSec;
            gain.gain.setValueAtTime(vol, Math.max(t0, end - 1.4));
            gain.gain.linearRampToValueAtTime(0, end);
          }
          src.connect(gain);
          gain.connect(dest);
          const cutStart = Math.max(0, Number(tr.cutStart) || 0);
          const cutEnd = tr.cutEnd != null ? Number(tr.cutEnd) : decoded.duration;
          const playAt = Math.max(0, Number(tr.playAt) || 0);
          const dur = Math.max(0.05, Math.min(decoded.duration - cutStart, cutEnd - cutStart));
          src.start(t0 + playAt, cutStart, dur);
          sources.push(src);
        } catch (err) {
          console.warn('Export track skip', err);
        }
      }
      dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      return { audioCtx, sources };
    }
  });
})();

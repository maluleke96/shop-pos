/**
 * Shared signage playback renderer — used by TV player and admin preview.
 */
const SignageRenderer = {
  esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  },

  applyTransition(el, transition) {
    if (!el) return;
    el.style.transition = 'opacity 0.5s ease';
    if (transition === 'fade') { el.style.opacity = '0'; requestAnimationFrame(() => { el.style.opacity = '1'; }); }
  },

  renderCard(stage, title, lines) {
    const bits = (Array.isArray(lines) ? lines : [lines]).filter(Boolean);
    stage.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#0c4a6e,#082f49);padding:6vw">
      <div style="max-width:80vw;text-align:center">
        <div style="width:120px;height:6px;background:#38bdf8;margin:0 auto 28px"></div>
        <h1 style="font-size:6vw;line-height:1.1;margin-bottom:24px">${this.esc(title || 'Shop display')}</h1>
        ${bits.map((line) => `<p style="font-size:2.4vw;line-height:1.45;color:#e0f2fe;margin-top:10px">${this.esc(line)}</p>`).join('')}
      </div>
    </div>`;
  },

  renderMenu(stage, menu, orientation) {
    const portrait = orientation === 'portrait';
    stage.innerHTML = `<div class="menu-slide ${portrait ? 'portrait' : ''}" style="width:100%;height:100%;padding:4vw;background:linear-gradient(135deg,#1a1a2e,#16213e);overflow:auto">
      <h1 style="font-size:${portrait ? '6vw' : '4vw'};text-align:center;margin-bottom:2vh">${this.esc(menu.title_text || menu.name)}</h1>
      ${(menu.items || []).map((i) => `<div class="menu-item" style="display:flex;justify-content:space-between;font-size:${portrait ? '4vw' : '2.5vw'};padding:1vh 0;border-bottom:1px solid rgba(255,255,255,.15)">
        <span>${this.esc(i.name)}</span><span>R${Number(i.price || 0).toFixed(0)}</span></div>`).join('')}
    </div>`;
  },

  async showItem(stage, item, ctx) {
    const dur = Number(item.duration_seconds) || 8;
    const transition = item.transition || ctx.defaultTransition || 'fade';
    if (item.item_type === 'menu' && item.menu) {
      this.renderMenu(stage, item.menu, ctx.orientation);
      this.applyTransition(stage.firstChild, transition);
      return { type: 'timed', duration_ms: dur * 1000 };
    }
    const title = item.title || item.media?.title || 'Shop display';
    const caption = item.caption || '';
    if (item.media?.url && item.media.media_type !== 'audio') {
      const url = await ctx.resolveUrl(item.media.url);
      if (item.media.media_type === 'video') {
        stage.innerHTML = `<video class="sg-vid" src="${url}" autoplay playsinline ${item.use_video_audio ? '' : 'muted'} style="max-width:100%;max-height:100%;object-fit:contain"></video>`;
        const v = stage.querySelector('.sg-vid');
        if (item.use_video_audio) v.volume = (Number(item.video_volume) || 100) / 100;
        v.onerror = () => this.renderCard(stage, title, [caption || 'This video is not on the server. Publish it again from Digital Signage.']);
        this.applyTransition(v, transition);
        return { type: 'video', element: v };
      }
      stage.innerHTML = `<img class="sg-img" src="${url}" alt="${this.esc(title)}" style="max-width:100%;max-height:100%;object-fit:contain">`;
      const img = stage.querySelector('.sg-img');
      img.onerror = () => this.renderCard(stage, title, [caption || 'This picture is not on the server. Publish it again from Digital Signage.']);
      this.applyTransition(img, transition);
      return { type: 'timed', duration_ms: dur * 1000 };
    }
    this.renderCard(stage, title, [caption || (item.media?.media_type === 'audio' ? 'Shop music is playing with this screen.' : 'Add a picture in Digital Signage, then publish it to this TV.')]);
    return { type: 'timed', duration_ms: dur * 1000 };
  }
};
window.SignageRenderer = SignageRenderer;

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
    if (item.media) {
      const url = await ctx.resolveUrl(item.media.url);
      if (item.media.media_type === 'video') {
        stage.innerHTML = `<video class="sg-vid" src="${url}" autoplay playsinline ${item.use_video_audio ? '' : 'muted'} style="max-width:100%;max-height:100%;object-fit:contain"></video>`;
        const v = stage.querySelector('.sg-vid');
        if (item.use_video_audio) v.volume = (Number(item.video_volume) || 100) / 100;
        this.applyTransition(v, transition);
        return { type: 'video', element: v };
      }
      stage.innerHTML = `<img class="sg-img" src="${url}" alt="" style="max-width:100%;max-height:100%;object-fit:contain">`;
      this.applyTransition(stage.querySelector('.sg-img'), transition);
      return { type: 'timed', duration_ms: dur * 1000 };
    }
    stage.innerHTML = `<p style="padding:40px;color:#f88">Missing media</p>`;
    return { type: 'timed', duration_ms: 3000 };
  }
};
window.SignageRenderer = SignageRenderer;

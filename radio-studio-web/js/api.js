const RadioStudioAPI = {
  rpcUrl() {
    if (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file:')) {
      return `${location.origin.replace(/\/$/, '')}/rpc`;
    }
    const c = window.__RADIO_STUDIO_CONFIG__ || {};
    return (c.rpcUrl || 'https://chisafood.up.railway.app/rpc').replace(/\/$/, '');
  },

  token() {
    return localStorage.getItem('radio_studio_token') || '';
  },

  setToken(tok) {
    if (tok) localStorage.setItem('radio_studio_token', tok);
    else localStorage.removeItem('radio_studio_token');
  },

  async call(method, args = []) {
    const headers = { 'Content-Type': 'application/json', 'X-Shop-Source': 'radio-studio' };
    const tok = this.token();
    const callArgs = [...(args || [])];
    if (tok && method !== 'radio:login') callArgs.unshift(tok);
    let res;
    try {
      res = await fetch(this.rpcUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify({ method, args: callArgs })
      });
    } catch (_) {
      throw new Error('Cannot reach server. Check your connection.');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error || json.success === false) {
      throw new Error(json.error || json.message || 'Request failed');
    }
    return json.data !== undefined ? json.data : json.result !== undefined ? json.result : json;
  },

  login(u, p, pin) {
    return this.call('radio:login', [u, p, { platform: 'web', device_name: 'Radio Studio', pin: pin || undefined }]);
  },
  logout() { return this.call('radio:logout', []); },
  profile() { return this.call('radio:profile', []); },
  check() { return this.call('radio:check', []); },
  snapshot() { return this.call('radio:studioSnapshot', []); },
  setGoLive(on) { return this.call('radio:setGoLive', [!!on]); },
  setMicDuck(p) { return this.call('radio:setMicDuck', [p]); },
  updateNowPlaying(p) { return this.call('radio:updateNowPlaying', [p]); },
  playNow(p) { return this.call('radio:playNow', [p]); },
  playTrack(id, opts) { return this.call('radio:playTrack', [id, opts || {}]); },
  playPlaylist(id) { return this.call('radio:playPlaylist', [id]); },
  advanceQueue() { return this.call('radio:advanceQueue', []); },
  saveSchedule(items) { return this.call('radio:saveSchedule', [items]); },
  saveProgramme(items) { return this.call('radio:saveProgramme', [items]); },
  addTrack(d) { return this.call('radio:addTrack', [d]); },
  updateTrack(id, d) { return this.call('radio:updateTrack', [id, d]); },
  deleteTrack(id) { return this.call('radio:deleteTrack', [id]); },
  addAnnouncement(d) { return this.call('radio:addAnnouncement', [d]); },
  savePlaylist(d) { return this.call('radio:savePlaylist', [d]); },
  deletePlaylist(id) { return this.call('radio:deletePlaylist', [id]); },
  duplicatePlaylist(id) { return this.call('radio:duplicatePlaylist', [id]); },
  saveFolder(d) { return this.call('radio:saveFolder', [d]); },
  saveSfx(d) { return this.call('radio:saveSfx', [d]); },
  playSfx(id) { return this.call('radio:playSfx', [id]); },
  saveMixer(m) { return this.call('radio:saveMixer', [m]); },
  moderateChat(id, hidden) { return this.call('radio:hideChatMessage', [id, hidden]); },
  pinChat(id, pinned) { return this.call('radio:pinChatMessage', [id, pinned]); },
  handleChat(id, handled) { return this.call('radio:handleChatMessage', [id, handled]); },
  blockChat(key, reason) { return this.call('radio:blockChatAuthor', [key, reason]); },
  staffChatReply(body) { return this.call('radio:staffChatReply', [body]); },
  upsertCall(d) { return this.call('radio:upsertCall', [d]); },
  saveSocial(d) { return this.call('radio:saveSocialDestination', [d]); },
  updateStation(d) { return this.call('radio:updateStationSettings', [d]); },
  createPromo(productId) { return this.call('radio:createPromoAnnouncement', [productId]); },
  setPlaybackState(state) { return this.call('radio:setPlaybackState', [state]); },
  playAdvert(d) { return this.call('radio:playAdvert', [d || {}]); },
  clearAdvert() { return this.call('radio:clearAdvert', []); },
  pushVoiceChunk(d) { return this.call('radio:pushVoiceChunk', [d || {}]); },
  stopVoice() { return this.call('radio:stopVoice', []); },
  scheduleAdvert(d) { return this.call('radio:scheduleAdvertJob', [d || {}]); },
  listAdvertJobs() { return this.call('radio:listAdvertJobs', []); },
  livePending() { return this.call('radio:liveStudioPending', []); },
  liveSetOffer(peerId, offer) { return this.call('radio:liveStudioSetOffer', [peerId, offer]); },
  liveSetIce(peerId, cand) { return this.call('radio:liveStudioSetIce', [peerId, cand]); },
  liveConsumeAnswer(peerId) { return this.call('radio:liveStudioConsumeAnswer', [peerId]); },

  readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read file'));
      r.readAsDataURL(file);
    });
  },

  probeDuration(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const a = new Audio();
      a.preload = 'metadata';
      a.onloadedmetadata = () => {
        const d = a.duration;
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(d) ? d : null);
      };
      a.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      a.src = url;
    });
  }
};

const RadioAPI = {
  rpcUrl() {
    if (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file:')) {
      return `${location.origin.replace(/\/$/, '')}/rpc`;
    }
    const c = window.__RADIO_CONFIG__ || {};
    return (c.rpcUrl || 'https://chisafood.up.railway.app/rpc').replace(/\/$/, '');
  },

  slug() {
    const m = String(location.pathname || '').match(/\/radio\/([^/]+)/i);
    return (m && m[1]) ? decodeURIComponent(m[1]) : 'main';
  },

  async call(method, args = []) {
    let res;
    try {
      res = await fetch(this.rpcUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shop-Source': 'radio-public' },
        body: JSON.stringify({ method, args })
      });
    } catch (_) {
      throw new Error('Cannot reach the radio server. Check your connection.');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error || json.success === false) {
      throw new Error(json.error || json.message || 'Request failed');
    }
    return json.data !== undefined ? json.data : json.result !== undefined ? json.result : json;
  },

  status() { return this.call('radio:publicStatus', [this.slug()]); },
  chatList(afterId) { return this.call('radio:publicChatList', [this.slug(), afterId || 0]); },
  chatPost(payload) { return this.call('radio:publicChatPost', [this.slug(), payload]); },
  listenerPing(sessionKey, meta) { return this.call('radio:publicListenerPing', [this.slug(), sessionKey, meta || {}]); },
  requestCall(payload) { return this.call('radio:publicRequestCall', [this.slug(), payload || {}]); },
  voiceChunks(afterSeq) { return this.call('radio:publicVoiceChunks', [this.slug(), afterSeq || 0]); },
  liveJoin(sessionKey) { return this.call('radio:liveJoin', [this.slug(), sessionKey]); },
  liveLeave(sessionKey) { return this.call('radio:liveLeave', [this.slug(), sessionKey]); },
  livePoll(sessionKey) { return this.call('radio:liveListenerPoll', [this.slug(), sessionKey]); },
  liveAnswer(sessionKey, answer) { return this.call('radio:liveListenerAnswer', [this.slug(), sessionKey, answer]); },
  liveIce(sessionKey, cand) { return this.call('radio:liveListenerIce', [this.slug(), sessionKey, cand]); },
  liveConsumeIce(sessionKey) { return this.call('radio:liveListenerConsumeIce', [this.slug(), sessionKey]); }
};

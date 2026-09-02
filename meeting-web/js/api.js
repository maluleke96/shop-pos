const MeetingAPI = {
  rpcUrl() {
    const c = window.__MEETING_CONFIG__ || {};
    return (c.rpcUrl || '/rpc').replace(/\/$/, '');
  },
  token() { return localStorage.getItem('meeting_token') || ''; },
  async call(method, args = []) {
    const tok = this.token();
    if (tok && method !== 'meeting:login') args = [tok, ...args];
    const res = await fetch(this.rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const msg = json.error || `Request failed (${res.status})`;
      if (/session|expired|not authenticated/i.test(msg)) localStorage.removeItem('meeting_token');
      throw new Error(msg);
    }
    return json.data != null ? json.data : json;
  },
  login: (u, p) => MeetingAPI.call('meeting:login', [u, p]),
  logout: () => MeetingAPI.call('meeting:logout', []),
  list: (f) => MeetingAPI.call('meeting:list', [f || {}]),
  get: (id) => MeetingAPI.call('meeting:get', [id]),
  save: (d) => MeetingAPI.call('meeting:save', [d]),
  start: (id) => MeetingAPI.call('meeting:start', [id]),
  stop: (id) => MeetingAPI.call('meeting:stop', [id]),
  saveRecording: (id, d) => MeetingAPI.call('meeting:saveRecording', [id, d]),
  saveTranscript: (id, segs) => MeetingAPI.call('meeting:saveTranscript', [id, segs]),
  processAi: (id) => MeetingAPI.call('meeting:processAi', [id]),
  finalizeMinutes: (id) => MeetingAPI.call('meeting:finalizeMinutes', [id]),
  search: (q) => MeetingAPI.call('meeting:search', [q]),
  ask: (id, q) => MeetingAPI.call('meeting:ask', [id, q])
};
window.MeetingAPI = MeetingAPI;

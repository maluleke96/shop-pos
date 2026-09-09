const CommAPI = {
  rpcUrl: (() => {
    if (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file:')) {
      return `${location.origin.replace(/\/$/, '')}/rpc`;
    }
    return (window.__COMM_CONFIG__ || {}).rpcUrl || 'https://chisafood.up.railway.app/rpc';
  })(),

  token() { return sessionStorage.getItem('comm_token') || ''; },

  async call(method, args = []) {
    const headers = { 'Content-Type': 'application/json', 'X-Shop-Source': 'communication-centre' };
    const tok = this.token();
    const publicMethods = ['commPortal:login'];
    if (tok && !publicMethods.includes(method)) args = [tok, ...args];
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method, args })
    }).catch(() => { throw new Error('Cannot reach server. Check your connection.'); });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const msg = json.error || `Request failed (${res.status})`;
      if (/session|expired|sign in|authentication/i.test(msg)) {
        sessionStorage.removeItem('comm_token');
        sessionStorage.removeItem('comm_user');
      }
      throw new Error(msg);
    }
    return json.data != null ? json.data : json;
  },

  login: (u, p) => CommAPI.call('commPortal:login', [u, p, { platform: 'web' }]),
  logout: () => CommAPI.call('commPortal:logout'),
  profile: () => CommAPI.call('commPortal:profile'),
  dashboard: (f) => CommAPI.call('commPortal:dashboard', [f || {}]),
  usage: (f) => CommAPI.call('commPortal:usage', [f || {}]),
  messages: (f) => CommAPI.call('commPortal:messages', [f || {}]),
  campaigns: (f) => CommAPI.call('commPortal:campaigns', [f || {}]),
  saveCampaign: (d) => CommAPI.call('commPortal:saveCampaign', [d]),
  startCampaign: (id) => CommAPI.call('commPortal:startCampaign', [id]),
  pauseCampaign: (id) => CommAPI.call('commPortal:pauseCampaign', [id]),
  cancelCampaign: (id) => CommAPI.call('commPortal:cancelCampaign', [id]),
  automations: () => CommAPI.call('commPortal:automations'),
  saveAutomation: (d) => CommAPI.call('commPortal:saveAutomation', [d]),
  setAutomationActive: (id, on) => CommAPI.call('commPortal:setAutomationActive', [id, !!on]),
  runAutomation: (id) => CommAPI.call('commPortal:runAutomation', [id]),
  templates: (f) => CommAPI.call('commPortal:templates', [f || {}]),
  saveTemplate: (d) => CommAPI.call('commPortal:saveTemplate', [d]),
  deleteTemplate: (id) => CommAPI.call('commPortal:deleteTemplate', [id]),
  preview: (id, vars) => CommAPI.call('commPortal:preview', [id, vars || {}]),
  sendTest: (d) => CommAPI.call('commPortal:sendTest', [d]),
  segments: () => CommAPI.call('commPortal:segments'),
  saveSegment: (d) => CommAPI.call('commPortal:saveSegment', [d]),
  evaluateSegment: (id) => CommAPI.call('commPortal:evaluateSegment', [id]),
  providers: () => CommAPI.call('commPortal:providers'),
  saveProvider: (d) => CommAPI.call('commPortal:saveProvider', [d]),
  testProvider: (id) => CommAPI.call('commPortal:testProvider', [id]),
  adminLogs: (f) => CommAPI.call('commPortal:adminLogs', [f || {}]),
  settings: () => CommAPI.call('commPortal:settings'),
  saveSettings: (d) => CommAPI.call('commPortal:saveSettings', [d]),
  portalUsers: () => CommAPI.call('commPortal:listUsers'),
  savePortalUser: (d) => CommAPI.call('commPortal:savePortalUser', [d]),
  setPortalUserActive: (id, on) => CommAPI.call('commPortal:setPortalUserActive', [id, !!on])
};

window.CommAPI = CommAPI;

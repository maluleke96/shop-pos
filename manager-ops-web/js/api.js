const ManagerOpsAPI = {
  rpcUrl() {
    if (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file:')) {
      return `${location.origin.replace(/\/$/, '')}/rpc`;
    }
    const c = window.__MANAGER_OPS_CONFIG__ || {};
    return (c.rpcUrl || '').replace(/\/$/, '') || '/rpc';
  },

  token() {
    return localStorage.getItem('mo_token') || sessionStorage.getItem('mo_token') || '';
  },

  async call(method, args = []) {
    const headers = { 'Content-Type': 'application/json' };
    const tok = this.token();
    const callArgs = [...(args || [])];
    if (tok && method !== 'managerOps:login') callArgs.unshift(tok);
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
    if (!res.ok || json.success === false) {
      const msg = json.error || `Request failed (${res.status})`;
      if (/session|expired|not authenticated|MODULE_LOCKED|not included/i.test(msg)) {
        if (!/not included|MODULE_LOCKED|package/i.test(msg)) {
          localStorage.removeItem('mo_token');
          sessionStorage.removeItem('mo_token');
          localStorage.removeItem('mo_user');
        }
      }
      throw new Error(msg);
    }
    return json.data != null ? json.data : json;
  },

  login: (u, p, d) => ManagerOpsAPI.call('managerOps:login', [u, p, d || {}]),
  logout: () => ManagerOpsAPI.call('managerOps:logout', []),
  home: () => ManagerOpsAPI.call('managerOps:home', [{}]),
  listTasks: (f) => ManagerOpsAPI.call('managerOps:listTasks', [f || {}]),
  getTask: (id) => ManagerOpsAPI.call('managerOps:getTask', [id]),
  startTask: (id) => ManagerOpsAPI.call('managerOps:startTask', [id]),
  completeChecklistItem: (id, d) => ManagerOpsAPI.call('managerOps:completeChecklistItem', [id, d || {}]),
  completeTask: (id, d) => ManagerOpsAPI.call('managerOps:completeTask', [id, d || {}]),
  sales: () => ManagerOpsAPI.call('managerOps:sales', [null]),
  reportProblem: (d) => ManagerOpsAPI.call('managerOps:reportProblem', [d || {}]),
  teamHelp: () => ManagerOpsAPI.call('managerOps:teamHelp', []),
  requestHelp: (d) => ManagerOpsAPI.call('managerOps:requestHelp', [d || {}]),
  offerHelp: (id) => ManagerOpsAPI.call('managerOps:offerHelp', [id]),
  submitReport: (d) => ManagerOpsAPI.call('managerOps:submitReport', [d || {}]),
  ownerMessages: () => ManagerOpsAPI.call('managerOps:ownerMessages', []),
  ackMessage: (id) => ManagerOpsAPI.call('managerOps:ackMessage', [id]),
  evidence: (id) => ManagerOpsAPI.call('managerOps:evidence', [id]),
  attendance: () => ManagerOpsAPI.call('managerOps:attendance', [])
};

window.ManagerOpsAPI = ManagerOpsAPI;

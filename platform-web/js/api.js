const PlatformAPI = {
  rpcUrl() { return (window.__PLATFORM_CONFIG__?.rpcUrl || '/rpc').replace(/\/$/, ''); },
  token() { return localStorage.getItem('platform_token') || ''; },
  _inflight: new Map(),
  _memo: new Map(),

  _cacheKey(method, args) {
    try { return method + '::' + JSON.stringify(args || []); } catch (_) { return method; }
  },

  /** Short TTL cache for list/read RPCs — makes tab switches feel instant */
  cached(method, args, ttlMs, fn) {
    const key = this._cacheKey(method, args);
    const hit = this._memo.get(key);
    if (hit && (Date.now() - hit.at) < ttlMs) return Promise.resolve(hit.data);
    if (this._inflight.has(key)) return this._inflight.get(key);
    const p = Promise.resolve()
      .then(fn)
      .then((data) => {
        this._memo.set(key, { at: Date.now(), data });
        this._inflight.delete(key);
        return data;
      })
      .catch((e) => {
        this._inflight.delete(key);
        throw e;
      });
    this._inflight.set(key, p);
    return p;
  },

  invalidate(prefix) {
    for (const k of [...this._memo.keys()]) {
      if (!prefix || k.startsWith(prefix)) this._memo.delete(k);
    }
  },

  async call(method, args = []) {
    const tok = this.token();
    const noTok = ['platform:login', 'platform:status'];
    if (tok && !noTok.includes(method)) args = [tok, ...args];
    const res = await fetch(this.rpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args }),
      keepalive: true
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const msg = json.error || `Request failed (${res.status})`;
      if (/session|expired|not authenticated|disabled/i.test(msg)) {
        if (!/disabled/i.test(msg)) localStorage.removeItem('platform_token');
      }
      const err = new Error(msg);
      err.payload = json;
      throw err;
    }
    // Unwrap nested { success, data } envelopes from wrapSync + rpc-app
    let out = json.data != null ? json.data : json;
    for (let i = 0; i < 4; i++) {
      if (!out || typeof out !== 'object' || Array.isArray(out)) break;
      // Prefer keeping list wrappers that have shops/applications + total
      if (Array.isArray(out.shops) || Array.isArray(out.applications) || Array.isArray(out.modules)
        || Array.isArray(out.packages) || Array.isArray(out.addons)) {
        break;
      }
      if (out.success === true && out.data != null && (
        out.shops || out.applications || out.customer || out.data?.shops || out.data?.customer
        || Array.isArray(out.data) || out.data?.id || out.data?.customer || out.data?.info
      )) {
        out = out.data;
        continue;
      }
      if (out.success === true && out.data != null && Object.keys(out).length <= 4) {
        out = out.data;
        continue;
      }
      break;
    }
    return out;
  },
  status: () => PlatformAPI.cached('platform:status', [], 60000, () => PlatformAPI.call('platform:status', [])),
  login: (u, p) => PlatformAPI.call('platform:login', [u, p]).then((r) => {
    PlatformAPI.invalidate();
    return r;
  }),
  logout: () => PlatformAPI.call('platform:logout', []).finally(() => PlatformAPI.invalidate()),
  syncCatalog: () => PlatformAPI.call('platform:syncCatalog', []).then((r) => {
    PlatformAPI.invalidate('platform:list');
    return r;
  }),
  listModules: (f) => PlatformAPI.cached('platform:listModules', [f || {}], 300000, () => PlatformAPI.call('platform:listModules', [f || {}])),
  validateModules: (ids) => PlatformAPI.call('platform:validateModules', [ids]),
  listPackages: () => PlatformAPI.cached('platform:listPackages', [], 300000, () => PlatformAPI.call('platform:listPackages', [])),
  getPackage: (id) => PlatformAPI.call('platform:getPackage', [id]),
  savePackage: (d) => PlatformAPI.call('platform:savePackage', [d]).then((r) => { PlatformAPI.invalidate('platform:listPackages'); return r; }),
  setPackageActive: (id, active) => PlatformAPI.call('platform:setPackageActive', [id, active]).then((r) => { PlatformAPI.invalidate('platform:listPackages'); return r; }),
  deletePackage: (id) => PlatformAPI.call('platform:deletePackage', [id]).then((r) => { PlatformAPI.invalidate('platform:listPackages'); return r; }),
  listAddons: () => PlatformAPI.cached('platform:listAddons', [], 300000, () => PlatformAPI.call('platform:listAddons', [])),
  saveAddon: (d) => PlatformAPI.call('platform:saveAddon', [d]).then((r) => { PlatformAPI.invalidate('platform:listAddons'); return r; }),
  deleteAddon: (id) => PlatformAPI.call('platform:deleteAddon', [id]).then((r) => { PlatformAPI.invalidate('platform:listAddons'); return r; }),
  bootstrapLabSamples: () => PlatformAPI.call('platform:bootstrapLabSamples', []).then((r) => {
    PlatformAPI.invalidate('platform:list');
    return r;
  }),
  getShopAssignment: (key) => PlatformAPI.cached('platform:getShopAssignment', [key || 'lab'], 60000, () => PlatformAPI.call('platform:getShopAssignment', [key || 'lab'])),
  saveShopAssignment: (d) => PlatformAPI.call('platform:saveShopAssignment', [d]).then((r) => {
    PlatformAPI.invalidate('platform:getShopAssignment');
    return r;
  }),
  getEntitlements: () => PlatformAPI.call('platform:getEntitlements', []),
  listShops: (f) => PlatformAPI.cached('platform:listShops', [f || {}], 15000, () => PlatformAPI.call('platform:listShops', [f || {}])),
  getShop: (id) => PlatformAPI.call('platform:getShop', [id]),
  createShop: (d) => PlatformAPI.call('platform:createShop', [d]).then((r) => { PlatformAPI.invalidate('platform:listShops'); return r; }),
  updateShop: (id, d) => PlatformAPI.call('platform:updateShop', [id, d]).then((r) => { PlatformAPI.invalidate('platform:listShops'); return r; }),
  deleteShop: (id) => PlatformAPI.call('platform:deleteShop', [id]).then((r) => { PlatformAPI.invalidate('platform:listShops'); return r; }),
  assignShop: (id, d) => PlatformAPI.call('platform:assignShop', [id, d]).then((r) => { PlatformAPI.invalidate('platform:listShops'); return r; }),
  setShopOverrides: (id, o) => PlatformAPI.call('platform:setShopOverrides', [id, o]),
  setShopStatus: (id, status) => PlatformAPI.call('platform:setShopStatus', [id, status]).then((r) => { PlatformAPI.invalidate('platform:listShops'); return r; }),
  shopHealth: (id) => PlatformAPI.call('platform:shopHealth', [id]),
  syncCustomerEntitlements: (id) => PlatformAPI.call('platform:syncCustomerEntitlements', [id]),
  shopAudit: (id, limit) => PlatformAPI.call('platform:shopAudit', [id, limit || 40]),
  bootstrapLabCustomers: () => PlatformAPI.call('platform:bootstrapLabCustomers', []).then((r) => {
    PlatformAPI.invalidate('platform:listShops');
    return r;
  }),
  customerControl: (id) => PlatformAPI.call('platform:customerControl', [id]),
  listContractVersions: () => PlatformAPI.cached('platform:listContractVersions', [], 60000, () => PlatformAPI.call('platform:listContractVersions', [])),
  getContractVersion: (id) => PlatformAPI.call('platform:getContractVersion', [id]),
  getActiveContract: () => PlatformAPI.call('platform:getActiveContract', []),
  acceptContract: (id, d) => PlatformAPI.call('platform:acceptContract', [id, d || {}]),
  printContract: (id, acceptanceId) => PlatformAPI.call('platform:printContract', [id, acceptanceId || null]),
  createContractVersion: (d) => PlatformAPI.call('platform:createContractVersion', [d]).then((r) => { PlatformAPI.invalidate('platform:listContractVersions'); return r; }),
  updateDraftContract: (id, d) => PlatformAPI.call('platform:updateDraftContract', [id, d || {}]),
  publishContract: (id, d) => PlatformAPI.call('platform:publishContract', [id, d || {}]).then((r) => { PlatformAPI.invalidate('platform:listContractVersions'); return r; }),
  previewContract: (id, shopId) => PlatformAPI.call('platform:previewContract', [id, shopId || null]),
  listContractAcceptances: (f) => PlatformAPI.call('platform:listContractAcceptances', [f || {}]),
  contractTemplate: () => PlatformAPI.cached('platform:contractTemplate', [], 300000, () => PlatformAPI.call('platform:contractTemplate', [])),
  shopFeeReport: (id, f) => PlatformAPI.call('platform:shopFeeReport', [id, f || {}]),
  createActivation: (id, d) => PlatformAPI.call('platform:createActivation', [id, d || {}]),
  regenerateActivation: (id, d) => PlatformAPI.call('platform:regenerateActivation', [id, d || {}]),
  revokeActivation: (id) => PlatformAPI.call('platform:revokeActivation', [id]),
  revokeDevice: (id) => PlatformAPI.call('platform:revokeDevice', [id]),
  upsertServiceFee: (d) => PlatformAPI.call('platform:upsertServiceFee', [d]),
  provisionStatus: () => PlatformAPI.cached('platform:provisionStatus', [], 30000, () => PlatformAPI.call('platform:provisionStatus', [])),
  provisionDryRun: (shopId) => PlatformAPI.call('platform:provisionDryRun', [shopId]),
  provisionRun: (shopId) => PlatformAPI.call('platform:provisionRun', [shopId]),
  provisionJob: (id) => PlatformAPI.call('platform:provisionJob', [id]),
  provisionJobs: (shopId) => PlatformAPI.call('platform:provisionJobs', [shopId || null]),
  listApplications: (f) => PlatformAPI.cached('platform:listApplications', [f || {}], 10000, () => PlatformAPI.call('platform:listApplications', [f || {}])),
  getApplication: (id) => PlatformAPI.call('platform:getApplication', [id]),
  setApplicationStatus: (id, status, opts) => PlatformAPI.call('platform:setApplicationStatus', [id, status, opts || {}]).then((r) => {
    PlatformAPI.invalidate('platform:listApplications');
    return r;
  }),
  approveApplication: (id, opts) => PlatformAPI.call('platform:approveApplication', [id, opts || {}]).then((r) => {
    PlatformAPI.invalidate('platform:listApplications');
    PlatformAPI.invalidate('platform:listShops');
    return r;
  })
};
window.PlatformAPI = PlatformAPI;

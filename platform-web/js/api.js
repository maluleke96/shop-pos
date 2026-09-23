const PlatformAPI = {
  rpcUrl() { return (window.__PLATFORM_CONFIG__?.rpcUrl || '/rpc').replace(/\/$/, ''); },
  token() { return localStorage.getItem('platform_token') || ''; },
  async call(method, args = []) {
    const tok = this.token();
    const noTok = ['platform:login', 'platform:status'];
    if (tok && !noTok.includes(method)) args = [tok, ...args];
    const res = await fetch(this.rpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args })
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
    return json.data != null ? json.data : json;
  },
  status: () => PlatformAPI.call('platform:status', []),
  login: (u, p) => PlatformAPI.call('platform:login', [u, p]),
  logout: () => PlatformAPI.call('platform:logout', []),
  syncCatalog: () => PlatformAPI.call('platform:syncCatalog', []),
  listModules: (f) => PlatformAPI.call('platform:listModules', [f || {}]),
  validateModules: (ids) => PlatformAPI.call('platform:validateModules', [ids]),
  listPackages: () => PlatformAPI.call('platform:listPackages', []),
  getPackage: (id) => PlatformAPI.call('platform:getPackage', [id]),
  savePackage: (d) => PlatformAPI.call('platform:savePackage', [d]),
  setPackageActive: (id, active) => PlatformAPI.call('platform:setPackageActive', [id, active]),
  deletePackage: (id) => PlatformAPI.call('platform:deletePackage', [id]),
  listAddons: () => PlatformAPI.call('platform:listAddons', []),
  saveAddon: (d) => PlatformAPI.call('platform:saveAddon', [d]),
  deleteAddon: (id) => PlatformAPI.call('platform:deleteAddon', [id]),
  bootstrapLabSamples: () => PlatformAPI.call('platform:bootstrapLabSamples', []),
  getShopAssignment: (key) => PlatformAPI.call('platform:getShopAssignment', [key || 'lab']),
  saveShopAssignment: (d) => PlatformAPI.call('platform:saveShopAssignment', [d]),
  getEntitlements: () => PlatformAPI.call('platform:getEntitlements', []),
  listShops: (f) => PlatformAPI.call('platform:listShops', [f || {}]),
  getShop: (id) => PlatformAPI.call('platform:getShop', [id]),
  createShop: (d) => PlatformAPI.call('platform:createShop', [d]),
  updateShop: (id, d) => PlatformAPI.call('platform:updateShop', [id, d]),
  deleteShop: (id) => PlatformAPI.call('platform:deleteShop', [id]),
  assignShop: (id, d) => PlatformAPI.call('platform:assignShop', [id, d]),
  setShopOverrides: (id, o) => PlatformAPI.call('platform:setShopOverrides', [id, o]),
  setShopStatus: (id, status) => PlatformAPI.call('platform:setShopStatus', [id, status]),
  shopHealth: (id) => PlatformAPI.call('platform:shopHealth', [id]),
  syncCustomerEntitlements: (id) => PlatformAPI.call('platform:syncCustomerEntitlements', [id]),
  shopAudit: (id, limit) => PlatformAPI.call('platform:shopAudit', [id, limit || 40]),
  bootstrapLabCustomers: () => PlatformAPI.call('platform:bootstrapLabCustomers', []),
  customerControl: (id) => PlatformAPI.call('platform:customerControl', [id]),
  listContractVersions: () => PlatformAPI.call('platform:listContractVersions', []),
  getContractVersion: (id) => PlatformAPI.call('platform:getContractVersion', [id]),
  getActiveContract: () => PlatformAPI.call('platform:getActiveContract', []),
  acceptContract: (id, d) => PlatformAPI.call('platform:acceptContract', [id, d || {}]),
  printContract: (id, acceptanceId) => PlatformAPI.call('platform:printContract', [id, acceptanceId || null]),
  createContractVersion: (d) => PlatformAPI.call('platform:createContractVersion', [d]),
  updateDraftContract: (id, d) => PlatformAPI.call('platform:updateDraftContract', [id, d || {}]),
  publishContract: (id, d) => PlatformAPI.call('platform:publishContract', [id, d || {}]),
  previewContract: (id, shopId) => PlatformAPI.call('platform:previewContract', [id, shopId || null]),
  listContractAcceptances: (f) => PlatformAPI.call('platform:listContractAcceptances', [f || {}]),
  contractTemplate: () => PlatformAPI.call('platform:contractTemplate', []),
  shopFeeReport: (id, f) => PlatformAPI.call('platform:shopFeeReport', [id, f || {}]),
  createActivation: (id, d) => PlatformAPI.call('platform:createActivation', [id, d || {}]),
  regenerateActivation: (id, d) => PlatformAPI.call('platform:regenerateActivation', [id, d || {}]),
  revokeActivation: (id) => PlatformAPI.call('platform:revokeActivation', [id]),
  revokeDevice: (id) => PlatformAPI.call('platform:revokeDevice', [id]),
  upsertServiceFee: (d) => PlatformAPI.call('platform:upsertServiceFee', [d]),
  provisionStatus: () => PlatformAPI.call('platform:provisionStatus', []),
  provisionDryRun: (shopId) => PlatformAPI.call('platform:provisionDryRun', [shopId]),
  provisionRun: (shopId) => PlatformAPI.call('platform:provisionRun', [shopId]),
  provisionJob: (id) => PlatformAPI.call('platform:provisionJob', [id]),
  provisionJobs: (shopId) => PlatformAPI.call('platform:provisionJobs', [shopId || null])
};
window.PlatformAPI = PlatformAPI;

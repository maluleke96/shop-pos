/**
 * Per-panel notification polling for Admin, Delivery dept, Staff portal, Recipe.
 * Uses PanelNotify for dedup + PanelSound for alerts.
 */
window.PanelNotifyHub = {
  _timers: {},
  _rpc() {
    return (method, args) => {
      if (method === 'notifications:listAcked') {
        return API.listAckedNotificationKeys(args[0], args[1]).then((r) => r?.data ?? r);
      }
      if (method === 'notifications:ackEvent') {
        return API.ackNotificationEvent(args[0], args[1], args[2]);
      }
      return API.ackNotificationEvents(args[0], args[1], args[2]);
    };
  },

  initPanel(panel, loggedIn) {
    if (!window.PanelNotify) return;
    PanelNotify.init({
      panel,
      loggedIn: loggedIn || (() => true),
      rpc: this._rpc()
    });
  },

  stop(panel) {
    if (this._timers[panel]) {
      clearInterval(this._timers[panel]);
      delete this._timers[panel];
    }
    if (PanelNotify?.panel === panel) PanelNotify.onLogout();
  },

  startPoll(panel, fn, ms = 20000) {
    this.stop(panel);
    fn().catch(() => {});
    this._timers[panel] = setInterval(() => fn().catch(() => {}), ms);
  },

  soundEnabled(panel) {
    const ns = window.App?.settings?.notification_settings || {};
    if (ns.sound_enabled === false) return false;
    return window.PanelNotify?.isSoundEnabled(panel) !== false;
  },

  /** Admin / main app bell notifications — only unread alerts ring (not approvals/reminders) */
  async pollAdmin(app) {
    if (!app?.user || app.isPosKiosk?.()) return;
    if (!['owner', 'manager', 'supervisor', 'assistant_manager'].includes(app.user.role)) return;
    try {
      window.SoundService?.stopAlert();
      if (window.PanelNotify) {
        PanelNotify.panel = 'admin';
        window.PanelSound?.setPanel('admin');
      }
      const buckets = await app.fetchNotificationBuckets(false, { fastOnly: true });
      const soundItems = (buckets.alerts || [])
        .filter((n) => app.alertQualifiesForSound?.(n.created_at) !== false)
        .map((n) => ({ ...n, _key: `admin_notif:${n.id}` }));
      const ns = app.settings?.notification_settings || {};
      PanelNotify?.syncPendingAlert(
        soundItems,
        (n) => n._key,
        this.soundEnabled('admin') && ns.loop_until_read !== false
      );
    } catch (_) { /* offline */ }
  },

  ackAdminAlert(id) {
    PanelNotify?.ack(`admin_notif:${id}`, 'read');
  },

  ackAdminPending(id) {
    PanelNotify?.ack(`admin_pending:${id}`, 'dismissed');
  },

  ackAdminReminder(id) {
    PanelNotify?.ack(`admin_reminder:${id}`, 'dismissed');
  },

  /** Delivery department — pending driver apps + pool deliveries */
  async pollDelivery(actor) {
    if (!actor) return;
    try {
      if (window.PanelNotify) {
        PanelNotify.panel = 'delivery';
        window.PanelSound?.setPanel('delivery');
      }
      if (window.PanelNotify) {
        PanelNotify.panel = 'delivery';
        window.PanelSound?.setPanel('delivery');
      }
      const [driversRes, ordersRes] = await Promise.all([
        API.listDeliveryDrivers({}, actor).catch(() => []),
        API.listDeliveries({ active: true, limit: 50 }, actor).catch(() => [])
      ]);
      const drivers = driversRes?.data || driversRes || [];
      const orders = ordersRes?.data || ordersRes || [];
      const pendingDrivers = drivers
        .filter((d) => String(d.status || '').toLowerCase() === 'pending')
        .map((d) => ({ id: d.id, _key: `delivery_driver:${d.id}` }));
      const pool = orders
        .filter((o) => String(o.status || '').toLowerCase() === 'awaiting_driver')
        .map((o) => ({ id: o.id, _key: `delivery_pool_dept:${o.id}` }));
      const items = [...pendingDrivers, ...pool];
      PanelNotify?.syncPendingAlert(items, (n) => n._key, this.soundEnabled('delivery'));
    } catch (_) { /* offline */ }
  },

  ackDeliveryDriver(id) {
    PanelNotify?.ack(`delivery_driver:${id}`, 'handled');
  },

  ackDeliveryPoolDept(id) {
    PanelNotify?.ack(`delivery_pool_dept:${id}`, 'handled');
  },

  /** Staff portal — feed, checklist warnings, contracts to sign */
  async pollStaff(employeeId, actor) {
    if (!employeeId) return;
    try {
      if (window.PanelNotify) {
        PanelNotify.panel = 'staff';
        window.PanelSound?.setPanel('staff');
      }
      if (window.PanelNotify) {
        PanelNotify.panel = 'staff';
        window.PanelSound?.setPanel('staff');
      }
      const [feedRes, warnRes, contractRes] = await Promise.all([
        API.getStaffPortalFeed(employeeId).catch(() => ({ data: [] })),
        API.getStaffChecklistWarnings(actor?.id || null, employeeId).catch(() => ({ data: [] })),
        API.getHrContractsForEmployee(employeeId, actor).catch(() => ({ data: [] }))
      ]);
      const feed = (feedRes?.data || feedRes || []).filter((f) => f.unread || f.is_new);
      const warnings = warnRes?.data || warnRes || [];
      const contracts = (contractRes?.data || contractRes || []).filter(
        (c) => c.status === 'pending_signatures' && !c.employee_signed_at
      );
      const items = [
        ...feed.map((f) => ({ id: f.id, _key: `staff_feed:${f.id}` })),
        ...warnings.map((w) => ({ id: w.id, _key: `staff_checklist:${w.id}` })),
        ...contracts.map((c) => ({ id: c.id, _key: `staff_contract:${c.id}` }))
      ];
      PanelNotify?.syncPendingAlert(items, (n) => n._key, this.soundEnabled('staff'));
    } catch (_) { /* offline */ }
  },

  ackStaffChecklist(id) {
    PanelNotify?.ack(`staff_checklist:${id}`, 'handled');
  },

  ackStaffContract(id) {
    PanelNotify?.ack(`staff_contract:${id}`, 'handled');
  },

  /** Recipe & production — pending approvals */
  async pollRecipe(user) {
    if (!user || !RecipePerms?.can(user, 'approve')) {
      PanelSound?.stop();
      return;
    }
    try {
      if (window.PanelNotify) {
        PanelNotify.panel = 'recipe';
        window.PanelSound?.setPanel('recipe');
      }
      if (window.PanelNotify) {
        PanelNotify.panel = 'recipe';
        window.PanelSound?.setPanel('recipe');
      }
      const branchFilter = RecipeProductionApp?.branchFilter?.() || {};
      const [pendingRes, prodRes, wasteRes] = await Promise.all([
        API.recipeList({ status: 'pending', ...branchFilter }, user).catch(() => ({ data: [] })),
        API.recipeProductionMeals
          ? API.recipeProductionMeals(user, branchFilter).catch(() => ({ data: {} }))
          : Promise.resolve({ data: {} }),
        API.recipeWasteList({ status: 'pending', ...branchFilter }, user).catch(() => ({ data: [] }))
      ]);
      const recipes = (pendingRes?.data || []).map((r) => ({ id: r.id, _key: `recipe_pending:${r.id}` }));
      const meals = ((prodRes?.data?.meals || prodRes?.meals || [])
        .filter((m) => ['pending', 'draft'].includes(String(m.profile_status || '')))
        .map((m) => ({ id: m.id, _key: `recipe_meal:${m.id}` })));
      const waste = (wasteRes?.data || wasteRes || [])
        .filter((w) => String(w.status || '') === 'pending')
        .map((w) => ({ id: w.id, _key: `recipe_waste:${w.id}` }));
      const items = [...recipes, ...meals, ...waste];
      PanelNotify?.syncPendingAlert(items, (n) => n._key, this.soundEnabled('recipe'));
    } catch (_) { /* offline */ }
  },

  ackRecipe(id, type) {
    PanelNotify?.ack(`recipe_${type}:${id}`, 'handled');
  }
};

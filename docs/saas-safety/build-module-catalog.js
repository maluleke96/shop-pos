/**
 * Phase 2 — generate MODULE-CATALOG.md / .json / .csv from static definitions.
 * Documentation only. Does not modify runtime behaviour or any database.
 */
const fs = require('fs');
const path = require('path');

const outDir = __dirname;
const generatedAt = new Date().toISOString();

function M(partial) {
  return {
    default_status: 'enabled_in_full_product',
    sellable_addon: false,
    related_apis: [],
    related_jobs: [],
    database_tables: [],
    dependencies: [],
    admin_menu: null,
    appears_in: [],
    notes: '',
    ...partial
  };
}

/** @type {Array<object>} */
const modules = [];

// —— Shared / core (must not be sold off alone) ——
const shared = [
  M({ id: 'core.auth', kind: 'shared_core', name: 'Authentication & Sessions', description: 'Login, logout, PIN, recovery, session verify, installer seed.', appears_in: ['All apps'], related_apis: ['auth:*', 'RPC /rpc'], database_tables: ['users', 'mobile_sessions'], dependencies: [], sellable_addon: false, notes: 'Required for every package.' }),
  M({ id: 'core.users_permissions', kind: 'shared_core', name: 'Users & Permissions', description: 'User CRUD, roles, cashier/manager permissions.', appears_in: ['Admin Panel', 'main-nav users'], admin_menu: 'permissions / cashiers', related_apis: ['auth:getUsers', 'auth:createUser', 'auth:updateUser'], database_tables: ['users'], sellable_addon: false }),
  M({ id: 'core.branches', kind: 'shared_core', name: 'Branches & Tills', description: 'Multi-branch and till device binding.', appears_in: ['Admin → Branches'], admin_menu: 'branches', related_apis: ['branches:*'], database_tables: ['branches', 'branch_settings', 'branch_stock'], sellable_addon: false }),
  M({ id: 'core.catalog', kind: 'shared_core', name: 'Products / Categories / Stock', description: 'Core catalogue and inventory movements used by POS, Online, Recipe, etc.', appears_in: ['main-nav products/categories/stock'], related_apis: ['products:*', 'categories:*', 'stock:*', 'inventory:*'], database_tables: ['products', 'categories', 'branch_stock', 'product_modifiers', 'product_variants'], sellable_addon: false, notes: 'Base commerce data.' }),
  M({ id: 'core.customers_suppliers', kind: 'shared_core', name: 'Customers & Suppliers masters', description: 'Party master data shared across sales, PO, delivery, loyalty.', appears_in: ['main-nav customers/suppliers'], related_apis: ['customers:*', 'suppliers:*'], database_tables: ['customers', 'suppliers'], sellable_addon: false }),
  M({ id: 'core.payments', kind: 'shared_core', name: 'Payment methods & gateways', description: 'POS tender types and online payment gateway config/webhooks.', appears_in: ['Admin → Payment Methods'], admin_menu: 'payments', related_apis: ['settings payment gateways', 'HTTP /api/webhooks/payments/*'], database_tables: ['payment_gateways', 'payment_transactions', 'payment_webhook_events'], related_jobs: ['payment webhook ingest'], sellable_addon: false }),
  M({ id: 'core.device_print', kind: 'shared_core', name: 'Device, Printer, Receipt', description: 'Device settings, printers, receipt designer, cash drawer.', appears_in: ['Admin device/printer/receipt'], admin_menu: 'device / printer / receipt / cashdrawer', related_apis: ['print:*', 'printers:*', 'settings device'], database_tables: ['pos_heartbeats'], sellable_addon: false }),
  M({ id: 'core.settings', kind: 'shared_core', name: 'Shop settings & setup', description: 'Shop settings, setup wizard, tax/currency, formats, operating hours, shifts config.', appears_in: ['Admin tax/formats/operating/shifts/customize'], admin_menu: 'tax / formats / operating / shifts / customize / approvals', related_apis: ['settings:*'], database_tables: ['shop_settings', 'bookkeeping_settings'], sellable_addon: false }),
  M({ id: 'core.audit_security', kind: 'shared_core', name: 'Audit, Security, Backup, DB tools', description: 'Audit log, security, backup/restore, database manager, system health, developer.', appears_in: ['Admin + main-nav audit'], admin_menu: 'security / backup / database / system-health / developer', related_apis: ['audit:*', 'backup:*', 'db:*', 'dev:*'], database_tables: ['audit_log', 'pg_schema_migrations'], related_jobs: ['storage snapshot every 6h'], sellable_addon: false }),
  M({ id: 'core.sync_notify', kind: 'shared_core', name: 'Sync & notifications hub', description: 'Cloud sync substrate and in-app notification ack hub.', appears_in: ['All cloud clients'], related_apis: ['sync:*', 'notifications:*'], database_tables: ['notifications', 'notification_acks', 'legacy_sync_outbox'], sellable_addon: false }),
  M({ id: 'core.rpc_server', kind: 'shared_core', name: 'HTTP RPC & static portal host', description: 'server.js hosts /rpc, /health, portal static mounts.', appears_in: ['Railway/cloud'], related_apis: ['POST /rpc', 'GET /health'], sellable_addon: false, notes: 'Infrastructure; not a customer SKU.' }),
  M({ id: 'core.portals_hub', kind: 'shared_core', name: 'Portals hub & shop profiles', description: 'Bookmark hub and multi-shop local profiles.', appears_in: ['/portals.html', 'shop-profiles.js'], sellable_addon: false })
];
modules.push(...shared);

// —— Major modules / apps ——
const majors = [
  M({ id: 'app.admin', kind: 'major', name: 'Admin Panel', description: 'Owner/manager configuration shell hosting all Admin sidebar sections.', appears_in: ['/admin-app.html', 'mode admin', 'Windows/Android admin shells'], admin_menu: '(host for all admin sections)', related_apis: ['settings:*', 'auth:*', 'many module APIs'], dependencies: ['core.auth', 'core.users_permissions', 'core.settings'], sellable_addon: true, notes: 'Usually included; can be sold light vs full via admin_* submodules.' }),
  M({ id: 'app.pos', kind: 'major', name: 'POS Till', description: 'Cashier sales, payments, held orders, shifts at till.', appears_in: ['/pos-app.html', 'mode pos', 'main-nav POS'], admin_menu: 'pos-menu + sales sections', related_apis: ['sales:*', 'shifts:*', 'held:*', 'print:receipt'], database_tables: ['sales', 'sale_items', 'held_orders', 'shifts', 'cash_drops'], dependencies: ['core.catalog', 'core.payments', 'core.auth'], sellable_addon: true, default_status: 'enabled_in_full_product' }),
  M({ id: 'app.staff', kind: 'major', name: 'Staff Portal', description: 'Employee clocking, leave, payslips, self-service HR views.', appears_in: ['/staff-app.html', 'mode staff', 'main-nav Staff Portal'], admin_menu: 'staffportal / staffhr', related_apis: ['staff:*'], database_tables: ['employees', 'employee_attendance', 'employee_leave', 'employee_portal_feed'], dependencies: ['core.auth', 'mod.hr'], sellable_addon: true }),
  M({ id: 'app.manager', kind: 'major', name: 'Business Manager (mobile)', description: 'Mobile manager dashboard PWA for ops overview.', appears_in: ['/manager/', 'manager shells'], admin_menu: 'business-manager / mobile-app', related_apis: ['mobile:*'], database_tables: ['mobile_app_users', 'mobile_devices', 'mobile_notifications', 'mobile_sessions'], dependencies: ['core.auth', 'app.admin'], sellable_addon: true }),
  M({ id: 'app.mgr_hr', kind: 'major', name: 'Mgr / Supervisor HR Portal', description: 'Manager/supervisor cases, recordings, staff HR ops portal.', appears_in: ['/mgr-hr-app.html', 'mode mgr-hr'], admin_menu: 'staffhr → mgr-* tabs', related_apis: ['mgrHr:*'], database_tables: ['manager_hr_*'], dependencies: ['mod.hr', 'app.staff'], sellable_addon: true }),
  M({ id: 'app.recipe', kind: 'major', name: 'Recipe & Production', description: 'Recipes, prep, production planning, waste, costing.', appears_in: ['/recipe-app.html', 'mode recipe', 'main-nav recipe'], admin_menu: 'recipe', related_apis: ['recipe:*', 'waste:*'], database_tables: ['product_recipe_items', 'production_batches', 'production_batch_items'], dependencies: ['core.catalog'], sellable_addon: true }),
  M({ id: 'app.hr', kind: 'major', name: 'HR, Payroll & Documents', description: 'Full HR workspace: payroll, contracts, training, compliance.', appears_in: ['mode hr', 'HR shells'], admin_menu: 'hr-workspace / hr-approvals / hrcontracts / payroll', related_apis: ['hr:*', 'payroll:*', 'jobs:*'], database_tables: ['hr_*', 'employee_*', 'payroll_compliance_submissions'], dependencies: ['app.staff', 'core.auth'], sellable_addon: true, notes: 'Overlaps Staff Portal; decide bundle vs separate SKUs.' }),
  M({ id: 'app.accounting', kind: 'major', name: 'Business Accounting', description: 'Ledgers, journals, banking, AR/AP, financial reports.', appears_in: ['/accounting-app.html', 'mode accounting', 'main-nav bookkeeping'], admin_menu: 'accounting-workspace', related_apis: ['acc:*', 'bookkeeping:*'], database_tables: ['acc_*', 'ledger_entries'], dependencies: ['core.catalog', 'core.payments'], sellable_addon: true }),
  M({ id: 'app.delivery', kind: 'major', name: 'Delivery Department', description: 'Dispatch desk for delivery orders, drivers, payouts.', appears_in: ['/delivery-app.html', 'mode delivery'], admin_menu: 'delivery-dept', related_apis: ['delivery:*'], database_tables: ['delivery_*'], dependencies: ['mod.online', 'app.driver'], sellable_addon: true }),
  M({ id: 'app.driver', kind: 'major', name: 'Driver App', description: 'Driver login, jobs, earnings, register/track pages.', appears_in: ['/driver/', '/driver/register.html', '/driver/track.html'], admin_menu: 'delivery-dept', related_apis: ['driver:*', 'HTTP /api/driver-doc/*'], database_tables: ['delivery_drivers', 'delivery_driver_sessions', 'delivery_assignments'], dependencies: ['app.delivery'], sellable_addon: true }),
  M({ id: 'mod.online', kind: 'major', name: 'Online Ordering', description: 'Customer web shop for delivery/collection.', appears_in: ['/order/', 'customer-web', 'order shells'], admin_menu: 'online-orders / customer-reports', related_apis: ['web:*', 'HTTP /order/*', 'online payment intents'], database_tables: ['web_*', 'online_*', 'branch_online_settings'], dependencies: ['core.catalog', 'core.payments'], related_jobs: ['order notifications via cc/whatsapp if enabled'], sellable_addon: true }),
  M({ id: 'mod.branding', kind: 'major', name: 'Online / App Branding', description: 'Logo, theme colors, banners, menu highlights for customer-facing surfaces.', appears_in: ['Admin customize + online settings + menu builder'], admin_menu: 'customize / online-orders / menu-builder', related_apis: ['settings:save', 'HTTP /api/logo', 'settings:getMenuHighlights'], database_tables: ['shop_settings', 'branch_online_settings'], dependencies: ['mod.online'], sellable_addon: true, notes: 'Candidate add-on; partially exists today without a single dedicated editor SKU.' }),
  M({ id: 'app.expenses', kind: 'major', name: 'Expense Capture', description: 'Mobile expense/waste submission portal + Admin expenses.', appears_in: ['/expenses/', 'main-nav expenses'], admin_menu: '(expenses via accounting/nav)', related_apis: ['expenses:*', 'HTTP /api/expense-*'], database_tables: ['expenses', 'expense_*', 'owner_fundings'], dependencies: ['core.auth', 'app.accounting'], sellable_addon: true }),
  M({ id: 'app.studio', kind: 'major', name: 'Menu & Promo Studio', description: 'Staff studio login into menu builder and promo video tools.', appears_in: ['/studio/', 'studio-builder mode'], admin_menu: 'menu-builder / promo-video-builder', related_apis: ['studio platform APIs via RPC/settings'], database_tables: ['flyer_templates', 'promotion_flyers', 'signage media overlap'], dependencies: ['core.catalog', 'mod.combos'], sellable_addon: true }),
  M({ id: 'app.referral_agent', kind: 'major', name: 'Referral Agent App', description: 'Agent-facing referral registration and earnings.', appears_in: ['/referral-app.html', 'mode referral'], admin_menu: 'referral-dept', related_apis: ['referral:*'], database_tables: ['mkt_referral_*', 'mkt_agent_*', 'marketing_*'], dependencies: ['mod.referral'], sellable_addon: true }),
  M({ id: 'app.referral_commission', kind: 'major', name: 'Referral & Commission Desk', description: 'Owner/manager commission department app.', appears_in: ['/referral-commission-app.html', 'mode referral-commission'], admin_menu: 'referral-dept', related_apis: ['referral:*'], database_tables: ['mkt_commissions', 'mkt_commission_*', 'mkt_agent_wallets'], dependencies: ['mod.referral'], sellable_addon: true }),
  M({ id: 'mod.referral', kind: 'major', name: 'Referral & Commission (platform)', description: 'Referral rules, agents, wallets, fraud, audits — Admin + apps.', appears_in: ['Admin referral-dept', 'both referral apps'], admin_menu: 'referral-dept', related_apis: ['referral:*'], database_tables: ['mkt_*', 'marketing_*'], sellable_addon: true }),
  M({ id: 'mod.signage', kind: 'major', name: 'Digital Signage Centre', description: 'Manage screens, media, playlists, schedules, pairing.', appears_in: ['/signage/'], admin_menu: 'digital-signage / business-modules overview', related_apis: ['signage:*', 'HTTP /signage-media/*', '/signage-sse/*'], database_tables: ['signage_*'], related_jobs: ['signage SSE push', 'schedule matching'], dependencies: ['core.auth'], sellable_addon: true }),
  M({ id: 'mod.signage_player', kind: 'major', name: 'Signage TV Player', description: 'Full-screen player; pairing code UX.', appears_in: ['/signage-player/'], admin_menu: 'digital-signage (approve pairing)', related_apis: ['signage:requestPairing', 'signage:pairingStatus', 'SSE'], database_tables: ['signage_devices', 'signage_device_pairings'], dependencies: ['mod.signage'], sellable_addon: true, notes: 'Usually bundled with Signage Centre.' }),
  M({ id: 'mod.kiosk', kind: 'major', name: 'Self-Service Kiosk', description: 'In-store customer kiosk ordering with pairing.', appears_in: ['/kiosk/'], admin_menu: 'business-modules → kiosk', related_apis: ['kiosk:*', 'HTTP /kiosk-media/*'], database_tables: ['kiosk_*'], dependencies: ['core.catalog', 'mod.online'], sellable_addon: true }),
  M({ id: 'mod.drive_thru', kind: 'major', name: 'Drive-Thru Station', description: 'Lane station UI, tokens, audio signals.', appears_in: ['/drive-thru/'], admin_menu: 'business-modules → drive-thru', related_apis: ['drive-thru platform (biz modules)'], database_tables: ['drive_thru_*'], dependencies: ['core.catalog', 'app.pos'], sellable_addon: true }),
  M({ id: 'mod.investor', kind: 'major', name: 'Investor Portal', description: 'Investor login and equity/investment views.', appears_in: ['/investor/'], admin_menu: 'business-modules → investors', related_apis: ['investor:*'], database_tables: ['investors', 'investor_*', 'investment_*'], dependencies: ['core.auth'], sellable_addon: true }),
  M({ id: 'mod.release', kind: 'major', name: 'App Release Centre', description: 'Release notes / rollout centre portal.', appears_in: ['/release/'], admin_menu: 'business-modules → release-users', related_apis: ['release:*', 'HTTP /api/mobile-releases.json'], database_tables: ['release_* (centre users)'], sellable_addon: true }),
  M({ id: 'mod.meeting', kind: 'major', name: 'AI Meeting Centre', description: 'Meeting recording, notes, transcripts portal.', appears_in: ['/meeting/'], admin_menu: 'business-modules → meeting-users', related_apis: ['meeting:*'], database_tables: ['meetings', 'meeting_*'], related_jobs: ['optional AI transcription if API key set'], sellable_addon: true }),
  M({ id: 'mod.radio', kind: 'major', name: 'Connection Radio (public)', description: 'Public listen/chat/call/order radio site.', appears_in: ['/radio/', '/radio/:slug/'], admin_menu: 'radio', related_apis: ['radio:*', 'HTTP /radio-media/*'], database_tables: ['radio_*'], related_jobs: ['scheduled adverts (radio_advert_jobs)'], dependencies: ['mod.radio_studio'], sellable_addon: true }),
  M({ id: 'mod.radio_studio', kind: 'major', name: 'Radio Studio', description: 'Live mic, music, announcements, GO LIVE.', appears_in: ['/radio-studio/'], admin_menu: 'radio', related_apis: ['radio:*'], database_tables: ['radio_broadcast_state', 'radio_media_files', 'radio_playlists'], sellable_addon: true }),
  M({ id: 'mod.kds', kind: 'major', name: 'Kitchen Display (KDS)', description: 'Full-screen kitchen order queue.', appears_in: ['/kitchen-display.html', 'Restaurant → Kitchen'], admin_menu: 'restaurant (main-nav)', related_apis: ['kitchen:*', 'tables:*'], database_tables: ['kitchen_orders', 'kitchen_order_items'], dependencies: ['app.pos', 'mod.restaurant'], sellable_addon: true }),
  M({ id: 'mod.customer_display', kind: 'major', name: 'Customer Display', description: 'Guest-facing order progress board.', appears_in: ['/customer-display.html', 'Restaurant → Customer'], related_apis: ['customer:openDisplay'], database_tables: ['kitchen_orders'], dependencies: ['mod.kds', 'app.pos'], sellable_addon: true }),
  M({ id: 'mod.restaurant', kind: 'major', name: 'Restaurant / Tables', description: 'Table service, in-app KDS/customer tabs.', appears_in: ['main-nav restaurant'], related_apis: ['tables:*'], database_tables: ['kitchen_orders'], dependencies: ['app.pos'], sellable_addon: true }),
  M({ id: 'mod.communication', kind: 'major', name: 'Communication Center', description: 'Multi-channel messaging: WhatsApp, SMS, email, social, campaigns.', appears_in: ['Admin communication-center', 'main-nav whatsapp'], admin_menu: 'communication-center / whatsapp', related_apis: ['cc:*', 'whatsapp:*', 'HTTP /api/webhooks/whatsapp'], database_tables: ['cc_*', 'comm_*', 'whatsapp_*'], related_jobs: ['cc_queue processing', 'whatsapp webhook ingest', 'scheduled campaigns'], sellable_addon: true }),
  M({ id: 'mod.loyalty', kind: 'major', name: 'Loyalty & Gift Cards', description: 'Points, gift cards, first-online gift, rewards.', appears_in: ['Admin loyalty', 'main-nav giftcards', 'POS checkout'], admin_menu: 'loyalty', related_apis: ['loyalty:*', 'giftcards:*', 'rewards:*'], database_tables: ['loyalty_*', 'gift_cards', 'gift_card_transactions', 'first_online_gift_*', 'customer_reward_*'], dependencies: ['app.pos', 'mod.online'], sellable_addon: true }),
  M({ id: 'mod.combos', kind: 'major', name: 'Combos & Promos', description: 'Combo deals, promo approvals, recipe promos.', appears_in: ['Admin combos'], admin_menu: 'combos', related_apis: ['combos:*', 'vouchers:*'], database_tables: ['combos', 'combo_items', 'combo_sale_log', 'product_promo_requests'], dependencies: ['core.catalog', 'app.pos'], sellable_addon: true }),
  M({ id: 'mod.careers', kind: 'major', name: 'Careers / Job Apply', description: 'Public job application + recruitment pipeline.', appears_in: ['/apply', 'mode apply'], admin_menu: 'recruitment', related_apis: ['jobs:*'], database_tables: ['job_postings', 'job_candidates'], dependencies: ['mod.hr'], sellable_addon: true }),
  M({ id: 'mod.document_hub', kind: 'major', name: 'Document Hub', description: 'Central documents store for shop ops.', appears_in: ['main-nav document-hub'], related_apis: ['file:*', 'document hub service'], database_tables: ['document_assets', 'financial_documents'], sellable_addon: true }),
  M({ id: 'mod.ops_compliance', kind: 'major', name: 'Operations & Compliance', description: 'Opening/closing checklists, signed rules, ops compliance.', appears_in: ['Admin opscompliance', 'main-nav operations'], admin_menu: 'opscompliance', related_apis: ['ops:*', 'cashup:*'], database_tables: ['daily_checklist_*', 'opening_checklist_templates', 'closing_checklist_templates', 'compliance_*'], sellable_addon: true }),
  M({ id: 'mod.automation', kind: 'major', name: 'Automation Rules', description: 'Configurable automation rules engine.', appears_in: ['Admin automation'], admin_menu: 'automation', related_apis: ['automation:*'], database_tables: ['automation_rules'], related_jobs: ['rule evaluation (event-driven)'], sellable_addon: true }),
  M({ id: 'mod.donations', kind: 'feature', name: 'Donations', description: 'Donation recording/approvals feature.', appears_in: ['Admin/ops surfaces'], related_apis: ['donations:*'], database_tables: ['donations', 'donation_documents'], sellable_addon: true, notes: 'Feature-sized; confirm if sold separately.' }),
  M({ id: 'mod.employee_of_month', kind: 'feature', name: 'Employee of the Month', description: 'Awards and scoring.', appears_in: ['Admin employee-of-month'], admin_menu: 'employee-of-month', related_apis: ['hr/employee-of-month'], database_tables: ['employee_of_month', 'employee_of_month_scores'], dependencies: ['mod.hr'], sellable_addon: true }),
  M({ id: 'mod.on_account', kind: 'feature', name: 'On Account & Taken Orders', description: 'Customer credit accounts and unpaid/taken orders.', appears_in: ['Admin onaccount / taken-orders'], admin_menu: 'onaccount / taken-orders', related_apis: ['credit:*', 'taken:*'], database_tables: ['customer_credit_ledger'], dependencies: ['app.pos', 'core.customers_suppliers'], sellable_addon: true }),
  M({ id: 'mod.layby_quotes', kind: 'feature', name: 'Lay-Bye & Quotes', description: 'Lay-bye plans and quotes conversion.', appears_in: ['main-nav layby/quotes'], related_apis: ['layby:*', 'quotes:*'], database_tables: ['laybyes', 'layby_*', 'quotes', 'quote_items'], dependencies: ['app.pos'], sellable_addon: true }),
  M({ id: 'mod.purchase_orders', kind: 'feature', name: 'Purchase Orders', description: 'PO create/receive flows.', appears_in: ['main-nav purchase-orders'], related_apis: ['po:*'], database_tables: ['purchase_orders', 'purchase_order_items', 'po_receipts'], dependencies: ['core.customers_suppliers', 'core.catalog'], sellable_addon: true }),
  M({ id: 'mod.reports', kind: 'feature', name: 'Reports suite', description: 'Sales/profit/stock and many operational reports.', appears_in: ['main-nav reports', 'Admin analytics'], admin_menu: 'analytics / saleexplorer / discount-report', related_apis: ['reports:*', 'analytics:*'], dependencies: ['app.pos'], sellable_addon: true, notes: 'Often bundled with Admin+POS.' }),
  M({ id: 'mod.web_analytics', kind: 'feature', name: 'Web / Customer analytics', description: 'Visitor events and customer issue reports for online.', appears_in: ['Admin customer-reports'], admin_menu: 'customer-reports', related_apis: ['web:*'], database_tables: ['web_visitor_*', 'customer_issue_reports'], dependencies: ['mod.online'], sellable_addon: true }),
  M({ id: 'mod.biz_modules_pack', kind: 'major', name: 'Business Modules (pack host)', description: 'Admin host for Investor/Release/Meeting/Kiosk/Drive-Thru toggles.', appears_in: ['Admin business-modules'], admin_menu: 'business-modules', related_apis: ['biz module settings'], database_tables: ['biz_module_settings'], dependencies: ['mod.investor', 'mod.release', 'mod.meeting', 'mod.kiosk', 'mod.drive_thru'], sellable_addon: false, notes: 'Host UI; sell children individually or as a pack.' })
];
modules.push(...majors);

// —— Admin sidebar sections (67) as admin_submodule ——
const adminSections = [
  ['overview', 'Business Dashboard', 'Hub dashboard; links into modules.', 'shared with app.admin', false],
  ['salesmgmt', 'Sales Management', 'Sales ops configuration and management.', 'app.pos', true],
  ['pos-menu', 'POS Menu & Promos', 'POS menu/promo configuration.', 'app.pos / mod.combos', true],
  ['saleexplorer', 'Sales Explorer', 'Explore historical sales.', 'app.pos / mod.reports', true],
  ['soldproducts', 'Sold Products', 'Sold product analytics.', 'mod.reports', true],
  ['returnsmgmt', 'Returns', 'Returns management admin.', 'app.pos', true],
  ['activity', 'Activity Log', 'Operational activity view.', 'core.audit_security', false],
  ['exceptions', 'Exceptions', 'Exception monitoring.', 'app.pos', true],
  ['alerts', 'Alerts Center', 'Alert centre configuration/view.', 'core.sync_notify', false],
  ['dailyclose', 'Daily Closing', 'Daily closing workflows.', 'mod.ops_compliance', true],
  ['discount-report', 'Discount Report', 'Discount reporting.', 'mod.reports', true],
  ['printer', 'Printer Setup', 'Printer configuration.', 'core.device_print', false],
  ['payments', 'Payment Methods', 'Tenders and gateways.', 'core.payments', false],
  ['receipt', 'Receipt Designer', 'Receipt layout.', 'core.device_print', false],
  ['security', 'Security', 'Security settings.', 'core.audit_security', false],
  ['quotes', 'Quotes', 'Quotes admin.', 'mod.layby_quotes', true],
  ['permissions', 'Permissions', 'Role permissions.', 'core.users_permissions', false],
  ['sales-targets', 'Sales Targets', 'Target setting.', 'app.pos', true],
  ['top-customers', 'Top Customers', 'Customer ranking.', 'core.customers_suppliers', true],
  ['approvals', 'Settings Approvals', 'Pending settings change approvals.', 'core.settings', false],
  ['tax', 'Tax & Currency', 'Tax/currency settings.', 'core.settings', false],
  ['tax-hub', 'Tax Calculations', 'Tax calculation hub.', 'app.accounting', true],
  ['cashiers', 'Cashiers & Managers', 'Cashier/manager user ops.', 'core.users_permissions', false],
  ['shifts', 'Shift Management', 'Shift rules and management.', 'core.settings / app.pos', false],
  ['operating', 'Operating Hours', 'Store hours.', 'core.settings', false],
  ['cashdrawer', 'Cash Drawer', 'Cash drawer settings.', 'core.device_print', false],
  ['analytics', 'Sales Analytics', 'Sales analytics dashboards.', 'mod.reports', true],
  ['inventory', 'Inventory', 'Inventory admin.', 'core.catalog', false],
  ['discounts', 'Discounts', 'Discount rules.', 'app.pos', true],
  ['loyalty', 'Loyalty & Gift Cards', 'Loyalty admin.', 'mod.loyalty', true],
  ['importexport', 'Import & Export', 'Data import/export.', 'core.catalog', false],
  ['customize', 'Customization', 'Theme/branding basics.', 'mod.branding / core.settings', true],
  ['branches', 'Branches', 'Branch setup.', 'core.branches', false],
  ['online-orders', 'Online Orders', 'Online ordering config.', 'mod.online', true],
  ['referral-dept', 'Referral & Commission', 'Referral department admin.', 'mod.referral', true],
  ['customer-reports', 'Customer Reports', 'Online customer reports.', 'mod.web_analytics', true],
  ['business-modules', 'Business Modules', 'Biz modules host.', 'mod.biz_modules_pack', true],
  ['digital-signage', 'Digital Signage', 'Signage admin.', 'mod.signage', true],
  ['mobile-app', 'Mobile App Users', 'Mobile app user mgmt.', 'app.manager', true],
  ['business-manager', 'Business Manager', 'Embed/link manager app.', 'app.manager', true],
  ['device', 'Device Settings', 'Device settings.', 'core.device_print', false],
  ['backup', 'Backup & Restore', 'Backup tools.', 'core.audit_security', false],
  ['opscompliance', 'Operations & Compliance', 'Ops compliance.', 'mod.ops_compliance', true],
  ['combos', 'Combos & Promos', 'Combos admin.', 'mod.combos', true],
  ['menu-builder', 'Menu Builder', 'Menu poster builder.', 'app.studio', true],
  ['promo-video-builder', 'Promo Video Builder', 'Promo video studio.', 'app.studio', true],
  ['communication-center', 'Communication Center', 'Comms hub.', 'mod.communication', true],
  ['radio', 'Radio', 'Radio admin.', 'mod.radio', true],
  ['recipe', 'Recipe & Production', 'Recipe admin.', 'app.recipe', true],
  ['staffhr', 'Staff & HR', 'Staff HR admin tabs.', 'app.staff / mod.hr', true],
  ['hr-workspace', 'HR, Payroll & Documents', 'HR workspace.', 'mod.hr / app.hr', true],
  ['hr-approvals', 'HR Approvals', 'HR approval queue.', 'mod.hr', true],
  ['accounting-workspace', 'Bookkeeping & Accounting', 'Accounting admin.', 'app.accounting', true],
  ['staffportal', 'Staff Portal', 'Staff portal config.', 'app.staff', true],
  ['onaccount', 'On Account', 'On-account admin.', 'mod.on_account', true],
  ['taken-orders', 'Taken / Unpaid Orders', 'Taken orders admin.', 'mod.on_account', true],
  ['hrcontracts', 'Contracts & Probation', 'Contracts admin.', 'mod.hr', true],
  ['recruitment', 'Recruitment', 'Recruitment admin.', 'mod.careers', true],
  ['delivery-dept', 'Deliveries', 'Delivery admin.', 'app.delivery', true],
  ['payroll', 'Payroll & Compliance', 'Payroll admin.', 'mod.hr / app.hr', true],
  ['employee-of-month', 'Employee of Month', 'EOM admin.', 'mod.employee_of_month', true],
  ['database', 'Database Manager', 'DB tools.', 'core.audit_security', false],
  ['system-health', 'System Health', 'Health/storage.', 'core.audit_security', false],
  ['automation', 'Automation Rules', 'Automations.', 'mod.automation', true],
  ['customfields', 'Custom Fields', 'Custom fields.', 'core.settings', false],
  ['formats', 'Formats & Numbering', 'Number formats.', 'core.settings', false],
  ['developer', 'Developer Mode', 'Dev/license tools.', 'core.audit_security', false]
];

for (const [id, name, desc, dep, sellable] of adminSections) {
  modules.push(M({
    id: `admin.${id}`,
    kind: 'admin_submodule',
    name,
    description: desc,
    appears_in: ['Admin Panel sidebar'],
    admin_menu: id,
    dependencies: dep.split(' / ').map((s) => s.trim()),
    sellable_addon: !!sellable,
    related_apis: [`Admin UI section ${id}`],
    notes: sellable ? 'Candidate to hide/show via package.' : 'Treat as part of core Admin / shared; do not sell alone.'
  }));
}

// —— Nested feature highlights (representative; not every tab) ——
const features = [
  M({ id: 'feat.loyalty.points', kind: 'feature', name: 'Loyalty Points', description: 'Points earn/burn.', appears_in: ['Admin loyalty → points'], admin_menu: 'loyalty/points', dependencies: ['mod.loyalty'], sellable_addon: false, notes: 'Sub-feature of loyalty.' }),
  M({ id: 'feat.loyalty.first_gift', kind: 'feature', name: 'First Online Customer Gift', description: 'First-order gift campaigns.', appears_in: ['Admin loyalty → first-gift'], dependencies: ['mod.loyalty', 'mod.online'], sellable_addon: true }),
  M({ id: 'feat.delivery.drivers', kind: 'feature', name: 'Driver pool & payouts', description: 'Driver management and payout claims.', appears_in: ['Admin delivery tabs'], dependencies: ['app.delivery', 'app.driver'], sellable_addon: false }),
  M({ id: 'feat.hr.payroll_sars', kind: 'feature', name: 'Payroll SARS compliance (UIF/PAYE/SDL/COIDA)', description: 'Compliance tabs inside payroll.', appears_in: ['Admin payroll'], dependencies: ['app.hr'], sellable_addon: true, notes: 'May be sold as HR Compliance add-on.' }),
  M({ id: 'feat.signage.schedules', kind: 'feature', name: 'Signage schedules & emergency', description: 'Scheduling and emergency announce.', appears_in: ['Signage Centre'], dependencies: ['mod.signage'], sellable_addon: false }),
  M({ id: 'feat.meeting.ai_transcript', kind: 'feature', name: 'AI transcription', description: 'Optional AI transcript for meetings.', appears_in: ['Meeting Centre'], dependencies: ['mod.meeting'], related_jobs: ['external AI API if keyed'], sellable_addon: true, notes: 'Requires server API key; confirm packaging.' }),
  M({ id: 'feat.accounting.ocr', kind: 'feature', name: 'Document OCR', description: 'OCR for accounting documents/bank statements.', appears_in: ['Accounting'], related_apis: ['ocr-engine', 'bank-statement-parser'], dependencies: ['app.accounting'], sellable_addon: true }),
  M({ id: 'feat.expenses.recurring_budgets', kind: 'feature', name: 'Expense budgets & recurring', description: 'Budgets, recurring posts, owner funding.', appears_in: ['Expenses'], related_apis: ['expenses:budgets', 'expenses:recurring', 'expenses:ownerFundings'], dependencies: ['app.expenses'], sellable_addon: false }),
  M({ id: 'feat.biz.investor_toggle', kind: 'feature', name: 'investor_enabled toggle', description: 'biz_module_settings flag.', appears_in: ['Business Modules overview'], database_tables: ['biz_module_settings'], dependencies: ['mod.investor'], sellable_addon: false }),
  M({ id: 'feat.biz.release_toggle', kind: 'feature', name: 'release_enabled toggle', description: 'biz_module_settings flag.', database_tables: ['biz_module_settings'], dependencies: ['mod.release'], sellable_addon: false }),
  M({ id: 'feat.biz.meeting_toggle', kind: 'feature', name: 'meeting_enabled toggle', description: 'biz_module_settings flag.', database_tables: ['biz_module_settings'], dependencies: ['mod.meeting'], sellable_addon: false }),
  M({ id: 'feat.marketing_legacy', kind: 'feature', name: 'Legacy marketing_* tables', description: 'Older marketing schema present in DB (mostly empty).', database_tables: ['marketing_*'], sellable_addon: false, notes: 'UNCERTAIN: confirm if still used vs mkt_* referral platform.' }),
  M({ id: 'feat.owner_salary', kind: 'feature', name: 'Owner salary', description: 'Owner salary periods/payments inside staff elevated UI.', related_apis: ['owner-salary service'], database_tables: ['owner_salary_*'], dependencies: ['app.staff'], sellable_addon: true })
];
modules.push(...features);

// Background jobs / HTTP APIs relevant to gating (catalog section)
const gatingApisJobs = {
  rpc_namespaces: [
    'acc', 'analytics', 'app', 'audit', 'auth', 'automation', 'backup', 'bookkeeping', 'branches',
    'cashup', 'categories', 'cc', 'combos', 'credit', 'customer', 'customers', 'customfields',
    'dashboard', 'db', 'delivery', 'dev', 'donations', 'driver', 'expenses', 'export', 'file',
    'giftcards', 'held', 'hr', 'inventory', 'investor', 'jobs', 'kiosk', 'kitchen', 'layby',
    'loyalty', 'meeting', 'mobile', 'mgrHr', 'notifications', 'operating', 'ops', 'payroll',
    'po', 'print', 'printers', 'products', 'quotes', 'radio', 'recipe', 'referral', 'release',
    'reports', 'returns', 'rewards', 'sales', 'search', 'security', 'settings', 'shifts',
    'signage', 'staff', 'stock', 'stockcount', 'store', 'suppliers', 'sync', 'tables', 'taken',
    'vouchers', 'waste', 'web', 'whatsapp'
  ],
  http_routes: [
    'POST /rpc', 'GET /health',
    'GET|POST /api/webhooks/whatsapp', 'POST /api/webhooks/payments/:provider',
    'GET /api/mobile-releases.json', 'GET /api/mobile-apk-status', 'POST /api/admin/mobile-apk-upload',
    'GET /api/logo', 'GET /api/notification-sound', 'GET /api/product-image/:id', 'GET /api/combo-image/:id',
    'GET /api/driver-doc/*', 'GET /api/expense-invoice/*', 'GET /api/expense-grant-photo/*', 'GET /api/expense-grant-recording/*',
    'GET /signage-media/*', 'GET /signage-sse/*', 'GET /radio-media/*', 'GET /kiosk-media/product/*',
    'STATIC /order/', '/manager/', '/driver/', '/expenses/', '/studio/', '/radio/', '/radio-studio/',
    '/investor/', '/release/', '/meeting/', '/signage/', '/signage-player/', '/kiosk/', '/drive-thru/',
    '/kitchen-display.html', '/customer-display.html', '/apply', '/portals.html'
  ],
  background_jobs: [
    'server: storage.recordStorageSnapshot every 6 hours',
    'signage: SSE fan-out to players; schedule matching on poll/publish',
    'radio: radio_advert_jobs / scheduled announcements runner',
    'communication: cc_queue send workers; WhatsApp webhook ingest',
    'whatsapp: scheduled campaign sends',
    'payments: webhook ingest → payment_transactions',
    'shifts: enforceShiftCashoutDeadlines (callable)',
    'notifications: refreshPaymentDueNotifications (callable)',
    'expenses: postRecurring (callable)',
    'meeting: optional AI transcription (external)',
    'mgr-hr shell: applyLiveUpdate poll ~45s (client)'
  ]
};

const counts = {
  major: modules.filter((m) => m.kind === 'major').length,
  admin_submodule: modules.filter((m) => m.kind === 'admin_submodule').length,
  feature: modules.filter((m) => m.kind === 'feature').length,
  shared_core: modules.filter((m) => m.kind === 'shared_core').length,
  total_catalog_entries: modules.length,
  rpc_namespaces: gatingApisJobs.rpc_namespaces.length,
  http_routes: gatingApisJobs.http_routes.length,
  background_jobs: gatingApisJobs.background_jobs.length
};

const catalog = {
  schema_version: 1,
  phase: 2,
  generated_at: generatedAt,
  source: 'shop-pos codebase inventory (admin.js, app.js, app-mode.js, server.js, mobile/handlers.js, electron/services, portals, backup table index)',
  protection_note: 'Catalog only. No entitlement checks deployed. Chisa Food production not modified. Intended for shoppos-saas-lab packaging work.',
  counts,
  gating_apis_jobs: gatingApisJobs,
  modules,
  special_dependencies: [
    { topic: 'Staff vs HR vs Mgr-HR', detail: 'Three overlapping surfaces share employee_* / hr_* tables. Selling Staff without HR may still need limited employee master data.' },
    { topic: 'Delivery ↔ Driver ↔ Online', detail: 'Driver app is weakly useful without Delivery desk; Delivery often needs Online or POS orders.' },
    { topic: 'Signage Centre ↔ Player', detail: 'Player alone only shows pairing; requires Centre (or Admin approve) to function.' },
    { topic: 'Kiosk / Drive-Thru ↔ Catalog', detail: 'Both need products/categories; Drive-Thru also couples to POS station workflows.' },
    { topic: 'Loyalty ↔ Online + POS', detail: 'Online-specific gifts need Online; POS redemption needs POS.' },
    { topic: 'Communication ↔ many modules', detail: 'Turning off Comms should stop WhatsApp/SMS/email jobs globally even if other modules remain.' },
    { topic: 'Accounting ↔ Expenses / Sales', detail: 'Accounting journals may still receive posts from sales/expenses; gating must decide whether to stop posting or only hide UI.' },
    { topic: 'Recipe ↔ Products', detail: 'Recipe components hang off products; disabling Recipe should not delete products.' },
    { topic: 'Business Modules toggles', detail: 'investor_enabled / release_enabled / meeting_enabled already exist in biz_module_settings — precursor to entitlements.' },
    { topic: 'marketing_* vs mkt_*', detail: 'Two marketing schemas in DB; confirm which is live before gating Referral.' }
  ],
  decisions_needed: [
    'Should Admin Panel always be included, with packages only toggling admin.* submodules?',
    'Sell Staff Portal separately from full HR/Payroll, or only as one People pack?',
    'Is Branding a standalone paid add-on or included with Online Ordering?',
    'Bundle Signage Player with Signage Centre always?',
    'When Accounting is off: hide UI only, or also suppress automatic journal posts from POS/expenses?',
    'Treat legacy marketing_* tables as dead (ignore) or still part of Referral?',
    'Is Apprentice Centre expected later? (not present in codebase today)',
    'Donations / Owner salary / EOM — add-ons or free with HR?'
  ]
};

fs.writeFileSync(path.join(outDir, 'MODULE-CATALOG.json'), JSON.stringify(catalog, null, 2));

// CSV
const csvEsc = (v) => {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};
const csvHeader = ['id', 'kind', 'name', 'sellable_addon', 'default_status', 'admin_menu', 'appears_in', 'dependencies', 'related_apis', 'related_jobs', 'database_tables', 'notes'];
const csvLines = [csvHeader.join(',')];
for (const m of modules) {
  csvLines.push([
    m.id, m.kind, m.name, m.sellable_addon, m.default_status, m.admin_menu || '',
    (m.appears_in || []).join('|'), (m.dependencies || []).join('|'),
    (m.related_apis || []).join('|'), (m.related_jobs || []).join('|'),
    (m.database_tables || []).join('|'), m.notes || ''
  ].map(csvEsc).join(','));
}
fs.writeFileSync(path.join(outDir, 'MODULE-CATALOG.csv'), csvLines.join('\n'));

// Markdown
const md = [];
md.push('# MODULE CATALOG — Phase 2');
md.push('');
md.push(`Generated: **${generatedAt}**`);
md.push('');
md.push('Inventory of sellable/gatable surfaces in `shop-pos`. **Documentation only** — no entitlement checks, menu hiding, schema changes, or production deploys.');
md.push('');
md.push('Companion machine-readable files: `MODULE-CATALOG.json`, `MODULE-CATALOG.csv`.');
md.push('');
md.push('## Counts');
md.push('');
md.push(`| Metric | Count |`);
md.push(`|--------|------:|`);
md.push(`| Major modules/apps | ${counts.major} |`);
md.push(`| Admin submodules (sidebar sections) | ${counts.admin_submodule} |`);
md.push(`| Nested features (catalogued) | ${counts.feature} |`);
md.push(`| Shared/core (non-sellable alone) | ${counts.shared_core} |`);
md.push(`| Total catalog entries | ${counts.total_catalog_entries} |`);
md.push(`| RPC namespaces (gating-relevant) | ${counts.rpc_namespaces} |`);
md.push(`| HTTP routes / mounts listed | ${counts.http_routes} |`);
md.push(`| Background jobs / timers listed | ${counts.background_jobs} |`);
md.push('');
md.push('## Kind legend');
md.push('');
md.push('- **major** — separate app, portal URL, or installable shell');
md.push('- **admin_submodule** — Admin sidebar section (`admin.js`)');
md.push('- **feature** — nested capability inside a module');
md.push('- **shared_core** — must stay with base product; do not disable alone');
md.push('');
md.push('## Shared / core (do not sell independently)');
md.push('');
for (const m of modules.filter((x) => x.kind === 'shared_core')) {
  md.push(`### \`${m.id}\` — ${m.name}`);
  md.push(`${m.description}`);
  md.push(`- APIs: ${(m.related_apis || []).join(', ') || '—'}`);
  md.push(`- Tables: ${(m.database_tables || []).join(', ') || '—'}`);
  md.push(`- Jobs: ${(m.related_jobs || []).join(', ') || '—'}`);
  md.push('');
}
md.push('## Major modules / apps');
md.push('');
for (const m of modules.filter((x) => x.kind === 'major')) {
  md.push(`### \`${m.id}\` — ${m.name}`);
  md.push(`${m.description}`);
  md.push(`- Appears in: ${(m.appears_in || []).join('; ') || '—'}`);
  md.push(`- Admin menu: ${m.admin_menu || '—'}`);
  md.push(`- APIs: ${(m.related_apis || []).join(', ') || '—'}`);
  md.push(`- Jobs: ${(m.related_jobs || []).join(', ') || '—'}`);
  md.push(`- Tables: ${(m.database_tables || []).join(', ') || '—'}`);
  md.push(`- Dependencies: ${(m.dependencies || []).join(', ') || '—'}`);
  md.push(`- Sellable add-on: **${m.sellable_addon}**`);
  md.push(`- Default status: ${m.default_status}`);
  if (m.notes) md.push(`- Notes: ${m.notes}`);
  md.push('');
}
md.push('## Admin submodules (67 sidebar sections)');
md.push('');
md.push('| ID | Name | Sellable toggle candidate | Depends on |');
md.push('|----|------|---------------------------|------------|');
for (const m of modules.filter((x) => x.kind === 'admin_submodule')) {
  md.push(`| \`admin.${m.admin_menu}\` | ${m.name} | ${m.sellable_addon ? 'yes' : 'no (core)'} | ${(m.dependencies || []).join(', ')} |`);
}
md.push('');
md.push('## Nested features (selected)');
md.push('');
for (const m of modules.filter((x) => x.kind === 'feature')) {
  md.push(`- **\`${m.id}\`** — ${m.name}: ${m.description}${m.notes ? ` _(${m.notes})_` : ''}`);
}
md.push('');
md.push('## APIs & jobs relevant to future module gating');
md.push('');
md.push('### RPC namespaces');
md.push(gatingApisJobs.rpc_namespaces.map((n) => `\`${n}\``).join(', '));
md.push('');
md.push('### HTTP routes / static mounts');
md.push('');
for (const r of gatingApisJobs.http_routes) md.push(`- \`${r}\``);
md.push('');
md.push('### Background jobs / timers');
md.push('');
for (const j of gatingApisJobs.background_jobs) md.push(`- ${j}`);
md.push('');
md.push('## Dependencies needing special treatment');
md.push('');
for (const s of catalog.special_dependencies) {
  md.push(`- **${s.topic}:** ${s.detail}`);
}
md.push('');
md.push('## Decisions needed from you');
md.push('');
for (const d of catalog.decisions_needed) md.push(`- ${d}`);
md.push('');
md.push('## Explicitly not found');
md.push('');
md.push('- **Apprentice Centre** — not present as an app/portal in this codebase.');
md.push('- Separate “Digital Signature” product — Digital **Signage** exists; no distinct e-signature centre module beyond admin signatures inside ops/HR flows.');
md.push('');
md.push('## STOP');
md.push('');
md.push('Phase 2 complete. Do not proceed to Phase 3 (packages) without approval.');
md.push('');

fs.writeFileSync(path.join(outDir, 'MODULE-CATALOG.md'), md.join('\n'));

// Root pointer
const rootPtr = path.join(outDir, '..', '..', 'MODULE-CATALOG.md');
fs.writeFileSync(rootPtr, `# Module Catalog\n\nPhase 2 deliverable lives at:\n\n- [docs/saas-safety/MODULE-CATALOG.md](docs/saas-safety/MODULE-CATALOG.md)\n- [docs/saas-safety/MODULE-CATALOG.json](docs/saas-safety/MODULE-CATALOG.json)\n- [docs/saas-safety/MODULE-CATALOG.csv](docs/saas-safety/MODULE-CATALOG.csv)\n\nGenerated: ${generatedAt}\n`);

console.log('WROTE_CATALOG');
console.log(JSON.stringify(counts));

# MODULE CATALOG — Phase 2

Generated: **2026-09-24T10:01:42.765Z**

Inventory of sellable/gatable surfaces in `shop-pos`. **Documentation only** — no entitlement checks, menu hiding, schema changes, or production deploys.

Companion machine-readable files: `MODULE-CATALOG.json`, `MODULE-CATALOG.csv`.

## Counts

| Metric | Count |
|--------|------:|
| Major modules/apps | 38 |
| Admin submodules (sidebar sections) | 68 |
| Nested features (catalogued) | 20 |
| Shared/core (non-sellable alone) | 12 |
| Total catalog entries | 138 |
| RPC namespaces (gating-relevant) | 73 |
| HTTP routes / mounts listed | 37 |
| Background jobs / timers listed | 11 |

## Kind legend

- **major** — separate app, portal URL, or installable shell
- **admin_submodule** — Admin sidebar section (`admin.js`)
- **feature** — nested capability inside a module
- **shared_core** — must stay with base product; do not disable alone

## Shared / core (do not sell independently)

### `core.auth` — Authentication & Sessions
Login, logout, PIN, recovery, session verify, installer seed.
- APIs: auth:*, RPC /rpc
- Tables: users, mobile_sessions
- Jobs: —

### `core.users_permissions` — Users & Permissions
User CRUD, roles, cashier/manager permissions.
- APIs: auth:getUsers, auth:createUser, auth:updateUser
- Tables: users
- Jobs: —

### `core.branches` — Branches & Tills
Multi-branch and till device binding.
- APIs: branches:*
- Tables: branches, branch_settings, branch_stock
- Jobs: —

### `core.catalog` — Products / Categories / Stock
Core catalogue and inventory movements used by POS, Online, Recipe, etc.
- APIs: products:*, categories:*, stock:*, inventory:*
- Tables: products, categories, branch_stock, product_modifiers, product_variants
- Jobs: —

### `core.customers_suppliers` — Customers & Suppliers masters
Party master data shared across sales, PO, delivery, loyalty.
- APIs: customers:*, suppliers:*
- Tables: customers, suppliers
- Jobs: —

### `core.payments` — Payment methods & gateways
POS tender types and online payment gateway config/webhooks.
- APIs: settings payment gateways, HTTP /api/webhooks/payments/*
- Tables: payment_gateways, payment_transactions, payment_webhook_events
- Jobs: payment webhook ingest

### `core.device_print` — Device, Printer, Receipt
Device settings, printers, receipt designer, cash drawer.
- APIs: print:*, printers:*, settings device
- Tables: pos_heartbeats
- Jobs: —

### `core.settings` — Shop settings & setup
Shop settings, setup wizard, tax/currency, formats, operating hours, shifts config.
- APIs: settings:*
- Tables: shop_settings, bookkeeping_settings
- Jobs: —

### `core.audit_security` — Audit, Security, Backup, DB tools
Audit log, security, backup/restore, database manager, system health, developer.
- APIs: audit:*, backup:*, db:*, dev:*
- Tables: audit_log, pg_schema_migrations
- Jobs: storage snapshot every 6h

### `core.sync_notify` — Sync & notifications hub
Cloud sync substrate and in-app notification ack hub.
- APIs: sync:*, notifications:*
- Tables: notifications, notification_acks, legacy_sync_outbox
- Jobs: —

### `core.rpc_server` — HTTP RPC & static portal host
server.js hosts /rpc, /health, portal static mounts.
- APIs: POST /rpc, GET /health
- Tables: —
- Jobs: —

### `core.portals_hub` — Portals hub & shop profiles
Bookmark hub and multi-shop local profiles.
- APIs: —
- Tables: —
- Jobs: —

## Major modules / apps

### `app.admin` — Admin Panel
Owner/manager configuration shell hosting all Admin sidebar sections.
- Appears in: /admin-app.html; mode admin; Windows/Android admin shells
- Admin menu: (host for all admin sections)
- APIs: settings:*, auth:*, many module APIs
- Jobs: —
- Tables: —
- Dependencies: core.auth, core.users_permissions, core.settings
- Sellable add-on: **true**
- Default status: enabled_in_full_product
- Notes: Usually included; can be sold light vs full via admin_* submodules.

### `app.pos` — POS Till
Cashier sales, payments, held orders, shifts at till.
- Appears in: /pos-app.html; mode pos; main-nav POS
- Admin menu: pos-menu + sales sections
- APIs: sales:*, shifts:*, held:*, print:receipt
- Jobs: —
- Tables: sales, sale_items, held_orders, shifts, cash_drops
- Dependencies: core.catalog, core.payments, core.auth
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `app.staff` — Staff Portal
Employee clocking, leave, payslips, self-service HR views.
- Appears in: /staff-app.html; mode staff; main-nav Staff Portal
- Admin menu: staffportal / staffhr
- APIs: staff:*
- Jobs: —
- Tables: employees, employee_attendance, employee_leave, employee_portal_feed
- Dependencies: core.auth, mod.hr
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `app.manager` — Business Manager (mobile)
Mobile manager dashboard PWA for ops overview.
- Appears in: /manager/; manager shells
- Admin menu: business-manager / mobile-app
- APIs: mobile:*
- Jobs: —
- Tables: mobile_app_users, mobile_devices, mobile_notifications, mobile_sessions
- Dependencies: core.auth, app.admin
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `app.mgr_hr` — Mgr / Supervisor HR Portal
Manager/supervisor cases, recordings, staff HR ops portal.
- Appears in: /mgr-hr-app.html; mode mgr-hr
- Admin menu: staffhr → mgr-* tabs
- APIs: mgrHr:*
- Jobs: —
- Tables: manager_hr_*
- Dependencies: mod.hr, app.staff
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `app.recipe` — Recipe & Production
Recipes, prep, production planning, waste, costing.
- Appears in: /recipe-app.html; mode recipe; main-nav recipe
- Admin menu: recipe
- APIs: recipe:*, waste:*
- Jobs: —
- Tables: product_recipe_items, production_batches, production_batch_items
- Dependencies: core.catalog
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `app.hr` — HR, Payroll & Documents
Full HR workspace: payroll, contracts, training, compliance.
- Appears in: mode hr; HR shells
- Admin menu: hr-workspace / hr-approvals / hrcontracts / payroll
- APIs: hr:*, payroll:*, jobs:*
- Jobs: —
- Tables: hr_*, employee_*, payroll_compliance_submissions
- Dependencies: app.staff, core.auth
- Sellable add-on: **true**
- Default status: enabled_in_full_product
- Notes: Overlaps Staff Portal; decide bundle vs separate SKUs.

### `app.accounting` — Business Accounting
Ledgers, journals, banking, AR/AP, financial reports.
- Appears in: /accounting-app.html; mode accounting; main-nav bookkeeping
- Admin menu: accounting-workspace
- APIs: acc:*, bookkeeping:*
- Jobs: —
- Tables: acc_*, ledger_entries
- Dependencies: core.catalog, core.payments
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `app.delivery` — Delivery Department
Dispatch desk for delivery orders, drivers, payouts.
- Appears in: /delivery-app.html; mode delivery
- Admin menu: delivery-dept
- APIs: delivery:*
- Jobs: —
- Tables: delivery_*
- Dependencies: mod.online, app.driver
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `app.driver` — Driver App
Driver login, jobs, earnings, register/track pages.
- Appears in: /driver/; /driver/register.html; /driver/track.html
- Admin menu: delivery-dept
- APIs: driver:*, HTTP /api/driver-doc/*
- Jobs: —
- Tables: delivery_drivers, delivery_driver_sessions, delivery_assignments
- Dependencies: app.delivery
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.online` — Online Ordering
Customer web shop for delivery/collection.
- Appears in: /order/; customer-web; order shells
- Admin menu: online-orders / customer-reports
- APIs: web:*, HTTP /order/*, online payment intents
- Jobs: order notifications via cc/whatsapp if enabled
- Tables: web_*, online_*, branch_online_settings
- Dependencies: core.catalog, core.payments
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.branding` — Online / App Branding
Logo, theme colors, banners, menu highlights for customer-facing surfaces.
- Appears in: Admin customize + online settings + menu builder
- Admin menu: customize / online-orders / menu-builder
- APIs: settings:save, HTTP /api/logo, settings:getMenuHighlights
- Jobs: —
- Tables: shop_settings, branch_online_settings
- Dependencies: mod.online
- Sellable add-on: **true**
- Default status: enabled_in_full_product
- Notes: Candidate add-on; partially exists today without a single dedicated editor SKU.

### `app.expenses` — Expense Capture
Mobile expense/waste submission portal + Admin expenses.
- Appears in: /expenses/; main-nav expenses
- Admin menu: (expenses via accounting/nav)
- APIs: expenses:*, HTTP /api/expense-*
- Jobs: —
- Tables: expenses, expense_*, owner_fundings
- Dependencies: core.auth, app.accounting
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `app.studio` — Menu & Promo Studio
Staff studio login into menu builder and promo video tools.
- Appears in: /studio/; studio-builder mode
- Admin menu: menu-builder / promo-video-builder
- APIs: studio platform APIs via RPC/settings
- Jobs: —
- Tables: flyer_templates, promotion_flyers, signage media overlap
- Dependencies: core.catalog, mod.combos
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `app.referral_agent` — Referral Agent App
Agent-facing referral registration and earnings.
- Appears in: /referral-app.html; mode referral
- Admin menu: referral-dept
- APIs: referral:*
- Jobs: —
- Tables: mkt_referral_*, mkt_agent_*, marketing_*
- Dependencies: mod.referral
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `app.referral_commission` — Referral & Commission Desk
Owner/manager commission department app.
- Appears in: /referral-commission-app.html; mode referral-commission
- Admin menu: referral-dept
- APIs: referral:*
- Jobs: —
- Tables: mkt_commissions, mkt_commission_*, mkt_agent_wallets
- Dependencies: mod.referral
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.referral` — Referral & Commission (platform)
Referral rules, agents, wallets, fraud, audits — Admin + apps.
- Appears in: Admin referral-dept; both referral apps
- Admin menu: referral-dept
- APIs: referral:*
- Jobs: —
- Tables: mkt_*, marketing_*
- Dependencies: —
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.signage` — Digital Signage Centre
Manage screens, media, playlists, schedules, pairing.
- Appears in: /signage/
- Admin menu: digital-signage / business-modules overview
- APIs: signage:*, HTTP /signage-media/*, /signage-sse/*
- Jobs: signage SSE push, schedule matching
- Tables: signage_*
- Dependencies: core.auth
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.signage_player` — Signage TV Player
Full-screen player; pairing code UX.
- Appears in: /signage-player/
- Admin menu: digital-signage (approve pairing)
- APIs: signage:requestPairing, signage:pairingStatus, SSE
- Jobs: —
- Tables: signage_devices, signage_device_pairings
- Dependencies: mod.signage
- Sellable add-on: **true**
- Default status: enabled_in_full_product
- Notes: Usually bundled with Signage Centre.

### `mod.kiosk` — Self-Service Kiosk
In-store customer kiosk ordering with pairing.
- Appears in: /kiosk/
- Admin menu: business-modules → kiosk
- APIs: kiosk:*, HTTP /kiosk-media/*
- Jobs: —
- Tables: kiosk_*
- Dependencies: core.catalog, mod.online
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.drive_thru` — Drive-Thru Station
Lane station UI, tokens, audio signals.
- Appears in: /drive-thru/
- Admin menu: business-modules → drive-thru
- APIs: drive-thru platform (biz modules)
- Jobs: —
- Tables: drive_thru_*
- Dependencies: core.catalog, app.pos
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.investor` — Investor Portal
Investor login and equity/investment views.
- Appears in: /investor/
- Admin menu: business-modules → investors
- APIs: investor:*
- Jobs: —
- Tables: investors, investor_*, investment_*
- Dependencies: core.auth
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.release` — App Release Centre
Release notes / rollout centre portal.
- Appears in: /release/
- Admin menu: business-modules → release-users
- APIs: release:*, HTTP /api/mobile-releases.json
- Jobs: —
- Tables: release_* (centre users)
- Dependencies: —
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.meeting` — AI Meeting Centre
Meeting recording, notes, transcripts portal.
- Appears in: /meeting/
- Admin menu: business-modules → meeting-users
- APIs: meeting:*
- Jobs: optional AI transcription if API key set
- Tables: meetings, meeting_*
- Dependencies: —
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.radio` — Connection Radio (public)
Public listen/chat/call/order radio site.
- Appears in: /radio/; /radio/:slug/
- Admin menu: radio
- APIs: radio:*, HTTP /radio-media/*
- Jobs: scheduled adverts (radio_advert_jobs)
- Tables: radio_*
- Dependencies: mod.radio_studio
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.radio_studio` — Radio Studio
Live mic, music, announcements, GO LIVE.
- Appears in: /radio-studio/
- Admin menu: radio
- APIs: radio:*
- Jobs: —
- Tables: radio_broadcast_state, radio_media_files, radio_playlists
- Dependencies: —
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.kds` — Kitchen Display (KDS)
Full-screen kitchen order queue.
- Appears in: /kitchen-display.html; Restaurant → Kitchen
- Admin menu: restaurant (main-nav)
- APIs: kitchen:*, tables:*
- Jobs: —
- Tables: kitchen_orders, kitchen_order_items
- Dependencies: app.pos, mod.restaurant
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.customer_display` — Customer Display
Guest-facing order progress board.
- Appears in: /customer-display.html; Restaurant → Customer
- Admin menu: —
- APIs: customer:openDisplay
- Jobs: —
- Tables: kitchen_orders
- Dependencies: mod.kds, app.pos
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.restaurant` — Restaurant / Tables
Table service, in-app KDS/customer tabs.
- Appears in: main-nav restaurant
- Admin menu: —
- APIs: tables:*
- Jobs: —
- Tables: kitchen_orders
- Dependencies: app.pos
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.communication` — Communication Center
Multi-channel messaging: WhatsApp, SMS, email, social, campaigns.
- Appears in: Admin communication-center; main-nav whatsapp
- Admin menu: communication-center / whatsapp
- APIs: cc:*, whatsapp:*, HTTP /api/webhooks/whatsapp
- Jobs: cc_queue processing, whatsapp webhook ingest, scheduled campaigns
- Tables: cc_*, comm_*, whatsapp_*
- Dependencies: —
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.loyalty` — Loyalty & Gift Cards
Points, gift cards, first-online gift, rewards.
- Appears in: Admin loyalty; main-nav giftcards; POS checkout
- Admin menu: loyalty
- APIs: loyalty:*, giftcards:*, rewards:*
- Jobs: —
- Tables: loyalty_*, gift_cards, gift_card_transactions, first_online_gift_*, customer_reward_*
- Dependencies: app.pos, mod.online
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.combos` — Combos & Promos
Combo deals, promo approvals, recipe promos.
- Appears in: Admin combos
- Admin menu: combos
- APIs: combos:*, vouchers:*
- Jobs: —
- Tables: combos, combo_items, combo_sale_log, product_promo_requests
- Dependencies: core.catalog, app.pos
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.careers` — Careers / Job Apply
Public job application + recruitment pipeline.
- Appears in: /apply; mode apply
- Admin menu: recruitment
- APIs: jobs:*
- Jobs: —
- Tables: job_postings, job_candidates
- Dependencies: mod.hr
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.document_hub` — Document Hub
Central documents store for shop ops.
- Appears in: main-nav document-hub
- Admin menu: —
- APIs: file:*, document hub service
- Jobs: —
- Tables: document_assets, financial_documents
- Dependencies: —
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.ops_compliance` — Operations & Compliance
Opening/closing checklists, signed rules, ops compliance.
- Appears in: Admin opscompliance; main-nav operations
- Admin menu: opscompliance
- APIs: ops:*, cashup:*
- Jobs: —
- Tables: daily_checklist_*, opening_checklist_templates, closing_checklist_templates, compliance_*
- Dependencies: —
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.manager_operations` — Manager Operations & Daily Tasks
Mobile manager daily duties, role-based checklists, photo evidence, incidents, sales monitoring from POS, and daily reports to the owner.
- Appears in: /manager-ops/; Admin manager-ops; Platform Control modules
- Admin menu: manager-ops
- APIs: mo:*, managerOps:*
- Jobs: daily task generation from operating hours
- Tables: mo_*
- Dependencies: app.admin, app.pos, core.users_permissions, core.sync_notify
- Sellable add-on: **true**
- Default status: enabled_in_full_product
- Notes: Alias manager_operations. Disabling never deletes mo_* history.

### `mod.automation` — Automation Rules
Configurable automation rules engine.
- Appears in: Admin automation
- Admin menu: automation
- APIs: automation:*
- Jobs: rule evaluation (event-driven)
- Tables: automation_rules
- Dependencies: —
- Sellable add-on: **true**
- Default status: enabled_in_full_product

### `mod.biz_modules_pack` — Business Modules (pack host)
Admin host for Investor/Release/Meeting/Kiosk/Drive-Thru toggles.
- Appears in: Admin business-modules
- Admin menu: business-modules
- APIs: biz module settings
- Jobs: —
- Tables: biz_module_settings
- Dependencies: mod.investor, mod.release, mod.meeting, mod.kiosk, mod.drive_thru
- Sellable add-on: **false**
- Default status: enabled_in_full_product
- Notes: Host UI; sell children individually or as a pack.

## Admin submodules (67 sidebar sections)

| ID | Name | Sellable toggle candidate | Depends on |
|----|------|---------------------------|------------|
| `admin.overview` | Business Dashboard | no (core) | shared with app.admin |
| `admin.salesmgmt` | Sales Management | yes | app.pos |
| `admin.pos-menu` | POS Menu & Promos | yes | app.pos, mod.combos |
| `admin.saleexplorer` | Sales Explorer | yes | app.pos, mod.reports |
| `admin.soldproducts` | Sold Products | yes | mod.reports |
| `admin.returnsmgmt` | Returns | yes | app.pos |
| `admin.activity` | Activity Log | no (core) | core.audit_security |
| `admin.exceptions` | Exceptions | yes | app.pos |
| `admin.alerts` | Alerts Center | no (core) | core.sync_notify |
| `admin.dailyclose` | Daily Closing | yes | mod.ops_compliance |
| `admin.discount-report` | Discount Report | yes | mod.reports |
| `admin.printer` | Printer Setup | no (core) | core.device_print |
| `admin.payments` | Payment Methods | no (core) | core.payments |
| `admin.receipt` | Receipt Designer | no (core) | core.device_print |
| `admin.security` | Security | no (core) | core.audit_security |
| `admin.quotes` | Quotes | yes | mod.layby_quotes |
| `admin.permissions` | Permissions | no (core) | core.users_permissions |
| `admin.sales-targets` | Sales Targets | yes | app.pos |
| `admin.top-customers` | Top Customers | yes | core.customers_suppliers |
| `admin.approvals` | Settings Approvals | no (core) | core.settings |
| `admin.tax` | Tax & Currency | no (core) | core.settings |
| `admin.tax-hub` | Tax Calculations | yes | app.accounting |
| `admin.cashiers` | Cashiers & Managers | no (core) | core.users_permissions |
| `admin.shifts` | Shift Management | no (core) | core.settings, app.pos |
| `admin.operating` | Operating Hours | no (core) | core.settings |
| `admin.cashdrawer` | Cash Drawer | no (core) | core.device_print |
| `admin.analytics` | Sales Analytics | yes | mod.reports |
| `admin.inventory` | Inventory | no (core) | core.catalog |
| `admin.discounts` | Discounts | yes | app.pos |
| `admin.loyalty` | Loyalty & Gift Cards | yes | mod.loyalty |
| `admin.importexport` | Import & Export | no (core) | core.catalog |
| `admin.customize` | Customization | yes | mod.branding, core.settings |
| `admin.branches` | Branches | no (core) | core.branches |
| `admin.online-orders` | Online Orders | yes | mod.online |
| `admin.referral-dept` | Referral & Commission | yes | mod.referral |
| `admin.customer-reports` | Customer Reports | yes | mod.web_analytics |
| `admin.business-modules` | Business Modules | yes | mod.biz_modules_pack |
| `admin.digital-signage` | Digital Signage | yes | mod.signage |
| `admin.mobile-app` | Mobile App Users | yes | app.manager |
| `admin.business-manager` | Business Manager | yes | app.manager |
| `admin.device` | Device Settings | no (core) | core.device_print |
| `admin.backup` | Backup & Restore | no (core) | core.audit_security |
| `admin.opscompliance` | Operations & Compliance | yes | mod.ops_compliance |
| `admin.manager-ops` | Manager Operations | yes | mod.manager_operations |
| `admin.combos` | Combos & Promos | yes | mod.combos |
| `admin.menu-builder` | Menu Builder | yes | app.studio |
| `admin.promo-video-builder` | Promo Video Builder | yes | app.studio |
| `admin.communication-center` | Communication Center | yes | mod.communication |
| `admin.radio` | Radio | yes | mod.radio |
| `admin.recipe` | Recipe & Production | yes | app.recipe |
| `admin.staffhr` | Staff & HR | yes | app.staff, mod.hr |
| `admin.hr-workspace` | HR, Payroll & Documents | yes | mod.hr, app.hr |
| `admin.hr-approvals` | HR Approvals | yes | mod.hr |
| `admin.accounting-workspace` | Bookkeeping & Accounting | yes | app.accounting |
| `admin.staffportal` | Staff Portal | yes | app.staff |
| `admin.onaccount` | On Account | yes | mod.on_account |
| `admin.taken-orders` | Taken / Unpaid Orders | yes | mod.on_account |
| `admin.hrcontracts` | Contracts & Probation | yes | mod.hr |
| `admin.recruitment` | Recruitment | yes | mod.careers |
| `admin.delivery-dept` | Deliveries | yes | app.delivery |
| `admin.payroll` | Payroll & Compliance | yes | mod.hr, app.hr |
| `admin.employee-of-month` | Employee of Month | yes | mod.employee_of_month |
| `admin.database` | Database Manager | no (core) | core.audit_security |
| `admin.system-health` | System Health | no (core) | core.audit_security |
| `admin.automation` | Automation Rules | yes | mod.automation |
| `admin.customfields` | Custom Fields | no (core) | core.settings |
| `admin.formats` | Formats & Numbering | no (core) | core.settings |
| `admin.developer` | Developer Mode | no (core) | core.audit_security |

## Nested features (selected)

- **`mod.donations`** — Donations: Donation recording/approvals feature. _(Feature-sized; confirm if sold separately.)_
- **`mod.employee_of_month`** — Employee of the Month: Awards and scoring.
- **`mod.on_account`** — On Account & Taken Orders: Customer credit accounts and unpaid/taken orders.
- **`mod.layby_quotes`** — Lay-Bye & Quotes: Lay-bye plans and quotes conversion.
- **`mod.purchase_orders`** — Purchase Orders: PO create/receive flows.
- **`mod.reports`** — Reports suite: Sales/profit/stock and many operational reports. _(Often bundled with Admin+POS.)_
- **`mod.web_analytics`** — Web / Customer analytics: Visitor events and customer issue reports for online.
- **`feat.loyalty.points`** — Loyalty Points: Points earn/burn. _(Sub-feature of loyalty.)_
- **`feat.loyalty.first_gift`** — First Online Customer Gift: First-order gift campaigns.
- **`feat.delivery.drivers`** — Driver pool & payouts: Driver management and payout claims.
- **`feat.hr.payroll_sars`** — Payroll SARS compliance (UIF/PAYE/SDL/COIDA): Compliance tabs inside payroll. _(May be sold as HR Compliance add-on.)_
- **`feat.signage.schedules`** — Signage schedules & emergency: Scheduling and emergency announce.
- **`feat.meeting.ai_transcript`** — AI transcription: Optional AI transcript for meetings. _(Requires server API key; confirm packaging.)_
- **`feat.accounting.ocr`** — Document OCR: OCR for accounting documents/bank statements.
- **`feat.expenses.recurring_budgets`** — Expense budgets & recurring: Budgets, recurring posts, owner funding.
- **`feat.biz.investor_toggle`** — investor_enabled toggle: biz_module_settings flag.
- **`feat.biz.release_toggle`** — release_enabled toggle: biz_module_settings flag.
- **`feat.biz.meeting_toggle`** — meeting_enabled toggle: biz_module_settings flag.
- **`feat.marketing_legacy`** — Legacy marketing_* tables: Older marketing schema present in DB (mostly empty). _(UNCERTAIN: confirm if still used vs mkt_* referral platform.)_
- **`feat.owner_salary`** — Owner salary: Owner salary periods/payments inside staff elevated UI.

## APIs & jobs relevant to future module gating

### RPC namespaces
`acc`, `analytics`, `app`, `audit`, `auth`, `automation`, `backup`, `bookkeeping`, `branches`, `cashup`, `categories`, `cc`, `combos`, `credit`, `customer`, `customers`, `customfields`, `dashboard`, `db`, `delivery`, `dev`, `donations`, `driver`, `expenses`, `export`, `file`, `giftcards`, `held`, `hr`, `inventory`, `investor`, `jobs`, `kiosk`, `kitchen`, `layby`, `loyalty`, `meeting`, `mobile`, `mgrHr`, `notifications`, `operating`, `ops`, `payroll`, `po`, `print`, `printers`, `products`, `quotes`, `radio`, `recipe`, `referral`, `release`, `reports`, `returns`, `rewards`, `sales`, `search`, `security`, `settings`, `shifts`, `signage`, `staff`, `stock`, `stockcount`, `store`, `suppliers`, `sync`, `tables`, `taken`, `vouchers`, `waste`, `web`, `whatsapp`

### HTTP routes / static mounts

- `POST /rpc`
- `GET /health`
- `GET|POST /api/webhooks/whatsapp`
- `POST /api/webhooks/payments/:provider`
- `GET /api/mobile-releases.json`
- `GET /api/mobile-apk-status`
- `POST /api/admin/mobile-apk-upload`
- `GET /api/logo`
- `GET /api/notification-sound`
- `GET /api/product-image/:id`
- `GET /api/combo-image/:id`
- `GET /api/driver-doc/*`
- `GET /api/expense-invoice/*`
- `GET /api/expense-grant-photo/*`
- `GET /api/expense-grant-recording/*`
- `GET /signage-media/*`
- `GET /signage-sse/*`
- `GET /radio-media/*`
- `GET /kiosk-media/product/*`
- `STATIC /order/`
- `/manager/`
- `/driver/`
- `/expenses/`
- `/studio/`
- `/radio/`
- `/radio-studio/`
- `/investor/`
- `/release/`
- `/meeting/`
- `/signage/`
- `/signage-player/`
- `/kiosk/`
- `/drive-thru/`
- `/kitchen-display.html`
- `/customer-display.html`
- `/apply`
- `/portals.html`

### Background jobs / timers

- server: storage.recordStorageSnapshot every 6 hours
- signage: SSE fan-out to players; schedule matching on poll/publish
- radio: radio_advert_jobs / scheduled announcements runner
- communication: cc_queue send workers; WhatsApp webhook ingest
- whatsapp: scheduled campaign sends
- payments: webhook ingest → payment_transactions
- shifts: enforceShiftCashoutDeadlines (callable)
- notifications: refreshPaymentDueNotifications (callable)
- expenses: postRecurring (callable)
- meeting: optional AI transcription (external)
- mgr-hr shell: applyLiveUpdate poll ~45s (client)

## Dependencies needing special treatment

- **Staff vs HR vs Mgr-HR:** Three overlapping surfaces share employee_* / hr_* tables. Selling Staff without HR may still need limited employee master data.
- **Delivery ↔ Driver ↔ Online:** Driver app is weakly useful without Delivery desk; Delivery often needs Online or POS orders.
- **Signage Centre ↔ Player:** Player alone only shows pairing; requires Centre (or Admin approve) to function.
- **Kiosk / Drive-Thru ↔ Catalog:** Both need products/categories; Drive-Thru also couples to POS station workflows.
- **Loyalty ↔ Online + POS:** Online-specific gifts need Online; POS redemption needs POS.
- **Communication ↔ many modules:** Turning off Comms should stop WhatsApp/SMS/email jobs globally even if other modules remain.
- **Accounting ↔ Expenses / Sales:** Accounting journals may still receive posts from sales/expenses; gating must decide whether to stop posting or only hide UI.
- **Recipe ↔ Products:** Recipe components hang off products; disabling Recipe should not delete products.
- **Business Modules toggles:** investor_enabled / release_enabled / meeting_enabled already exist in biz_module_settings — precursor to entitlements.
- **marketing_* vs mkt_*:** Two marketing schemas in DB; confirm which is live before gating Referral.

## Decisions needed from you

- Should Admin Panel always be included, with packages only toggling admin.* submodules?
- Sell Staff Portal separately from full HR/Payroll, or only as one People pack?
- Is Branding a standalone paid add-on or included with Online Ordering?
- Bundle Signage Player with Signage Centre always?
- When Accounting is off: hide UI only, or also suppress automatic journal posts from POS/expenses?
- Treat legacy marketing_* tables as dead (ignore) or still part of Referral?
- Is Apprentice Centre expected later? (not present in codebase today)
- Donations / Owner salary / EOM — add-ons or free with HR?

## Explicitly not found

- **Apprentice Centre** — not present as an app/portal in this codebase.
- Separate “Digital Signature” product — Digital **Signage** exists; no distinct e-signature centre module beyond admin signatures inside ops/HR flows.

## STOP

Phase 2 complete. Do not proceed to Phase 3 (packages) without approval.

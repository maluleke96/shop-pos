# Phase 3 Report — Platform Packages & Add-ons (LAB ONLY)

Completed: 2026-09-20 (UTC+2 session)

## Safety

| Check | Result |
|-------|--------|
| Target project | **shoppos-saas-lab** (`29f9f353-950f-4331-82d7-faa2565d3da1`) |
| Lab URL | https://shoppos-lab-production.up.railway.app |
| Platform UI | https://shoppos-lab-production.up.railway.app/platform/ |
| Chisa Food deploy tag | **Unchanged** (`deploy-20260920-signage-biz-modules-admin-login-v1`) |
| Entitlement enforcement | **Not implemented** (Phase 4) |
| Menu hiding / API blocking | **Not done** |
| Railway provisioner / billing | **Not done** |

Platform Control is gated by `PLATFORM_CONTROL_ENABLED=true` (set on lab only). Without that flag, `/platform/` is not served as Platform Control.

## What was created

### Schema (additive `platform_*` tables)

- `platform_modules` — synced from MODULE-CATALOG
- `platform_packages` + `platform_package_items`
- `platform_addons` + `platform_addon_items`
- `platform_owners` + `platform_sessions`
- `platform_audit_logs`

Files:

- `supabase/migrations/20260920_platform_control_packages.sql` (Postgres / Railway)
- `electron/database/migrations-v123.sql` (SQLite parity)

### Service & RPC

- `electron/services/platform-control.js`
- RPC: `platform:status|login|logout|syncCatalog|listModules|validateModules|listPackages|getPackage|savePackage|setPackageActive|deletePackage|listAddons|saveAddon|deleteAddon|bootstrapLabSamples`
- Wired via `store.js` + `mobile/handlers.js`

### Platform Admin UI (separate from shop Admin)

- `platform-web/` → `/platform/`
- Tabs: **Packages**, **Add-ons**, **Modules**
- Create/edit/delete packages; select any catalog modules + Admin submodules; price/description/active
- Create/edit/delete add-ons
- Sync catalog + validate dependencies
- Lab sample loader button

### Catalog embed for deploy

- `electron/platform-catalog/MODULE-CATALOG.json` (Docker image cannot rely on ignored `docs/`)

### Docs

- `docs/saas-safety/PHASE3-PLATFORM-PACKAGES.md`

## Module classification used

| Class | Meaning |
|-------|---------|
| `shared_core` | Always available for dependency satisfaction; not sold alone |
| `sellable` | Major modules selectable in packages/add-ons |
| `admin_submodule` | Individual Admin sidebar sections |
| `feature` | Nested features (incl. HR-related Donations / Owner Salary / EOM) |
| `legacy_compat` | Not sellable (e.g. marketing_* legacy) |

Admin shell (`app.admin`) remains selectable; **individual** `admin.*` sections are independently selectable.

## Dependency rules (enforced at save/validate)

Catalog `dependencies` + hard edges in `EXTRA_DEPS`, including:

- Signage Centre ↔ Signage Player (both required together)
- Driver → Delivery
- Drive-Thru → POS + catalog
- Kiosk → catalog
- Loyalty → POS
- Recipe → catalog
- Staff/HR/Mgr-HR chain
- Referral apps → referral platform
- Radio public → Radio Studio
- KDS/Customer display/Restaurant → POS
- Branding / web analytics → Online
- Accounting note stored as Phase-4 warning when Accounting is included

Broken combinations are **rejected** (cannot save).

## Lab login

- URL: https://shoppos-lab-production.up.railway.app/platform/
- Username: `platform`
- Password: value of `PLATFORM_OWNER_PASSWORD` on lab (currently set for lab testing — **change it**)

## Tests performed

`node scripts/test-platform-packages.js` against lab → **PHASE3_SMOKE_OK**

Covered:

- status enabled
- login
- catalog sync (136 modules)
- validate player-only → fail
- validate signage pack → ok
- create package, deactivate, edit (remove module), delete
- create/delete add-on
- reject driver-only package (missing Delivery)

## Intentionally NOT done (Phase 4+)

- Entitlement enforcement (UI/API/RPC/jobs)
- Shop assignment / subscription status / overrides UI
- Billing
- Railway auto-provision
- Any Chisa Food package assignment

## STOP

Awaiting approval before Phase 4.

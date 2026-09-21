# Phase 5 Report — Platform Shop Management (LAB ONLY)

**Date:** 2026-09-21  
**Scope:** `shoppos-saas-lab` only  
**Stopped after this report — no Phase 6 work.**

---

## Chisa Food protection

| Check | Result |
|--------|--------|
| Railway CLI project | `shoppos-saas-lab` only |
| Create shop named Chisa Food | **Rejected** |
| Shop id `chisafood` | **Rejected** |
| Chisa Railway project id link | **Rejected** |
| Production deploy/env/DB | **Not touched** |

---

## Database / schema

Additive migration `migrations-v125.sql` / `20260921_platform_shops.sql`:

`platform_shops` — id, shop_name, owner_*, contact, shop_url, railway_* reference fields (empty until Phase 6), deployment_status, package_id, subscription_status, trial_*, is_active, notes, created/updated.

Reuses Phase 4 tables:

- `platform_shop_assignments` / `_addons` / `_overrides` keyed by **shop id**
- Phase 4 **entitlements engine** (no second calculator)

---

## Platform screens

`/platform/` → **Shops** tab:

- List (search + status filter)
- Create shop (record only — no Railway)
- Detail: package/add-ons, overrides JSON, subscription status, effective entitlements
- Seed lab customers A/B

Also retains Packages / Add-ons / Modules / Lab assignment tabs.

---

## Functionality

| Feature | Behavior |
|---------|----------|
| Create shop | Platform customer record + unique id; optional package/add-ons |
| Assign package / add-ons | Calls Phase 4 `saveShopAssignment` |
| Overrides | Per-module force ON/OFF via same engine |
| Status | Manual `TRIAL` \| `ACTIVE` \| `OVERDUE` \| `SUSPENDED` |
| Suspend | Customer RPCs → `403 SHOP_SUSPENDED` when **this host’s** `SHOP_ENTITLEMENT_KEY` matches a suspended shop; data kept; Platform Control still works |
| Isolation | Each shop id has independent assignments |

---

## Lab customers

- **LAB CUSTOMER A** — Shop Floor + Online Ordering  
- **LAB CUSTOMER B** — Shop Floor only (no Online)

Changing A does not change B.

---

## Audit logging

Actions: `shop_created`, `package_assigned` / `package_changed`, `addon_added` / `addon_removed`, `module_override_*`, `subscription_status_changed`, `shop_suspended` / `shop_reactivated`.  
No passwords/tokens logged.

---

## Test results

Script: `scripts/test-phase5-shops.js`  
Target: `https://shoppos-lab-production.up.railway.app`  
**Result: 21/21 PASS** (2026-09-21)

| # | Test | Result |
|---|------|--------|
| 1 | Create customer | **PASS** |
| 2–5 | Package / add-on assign / remove / change | **PASS** |
| 6–7 | Overrides add / remove | **PASS** |
| 8 | Status ACTIVE / OVERDUE | **PASS** |
| 9–10 | Suspend → `SHOP_SUSPENDED` / Reactivate | **PASS** |
| 11–12 | Entitlements + A/B isolation | **PASS** |
| 13 | Audit log | **PASS** |
| 14 | Chisa Food protection | **PASS** |

---

## Not built (Phase 6+)

Railway API, auto Postgres, GitHub deploy, payments, Chisa migration.

---

## STOP

Await approval before Phase 6.

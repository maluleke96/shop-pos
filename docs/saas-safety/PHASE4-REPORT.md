# Phase 4 Report — Entitlement Enforcement (LAB ONLY)

**Date:** 2026-09-21  
**Scope:** `shoppos-saas-lab` only  
**Stopped after this report — no Phase 5 work.**

---

## 12. Confirmation: Chisa Food production was NOT modified

| Check | Result |
|--------|--------|
| Railway CLI linked project | `shoppos-saas-lab` (`29f9f353-950f-4331-82d7-faa2565d3da1`) |
| Chisa Food project id | `0296f469-4b4e-4b3f-99fb-063b03535e39` — **not linked, not deployed** |
| Lab env vars set | `ENTITLEMENTS_ENFORCE=true`, `SHOP_ENTITLEMENT_KEY=lab` on **shoppos-lab only** |
| Production env vars | Untouched (CLI never switched to Chisa project) |
| Production DB | Not connected to entitlement engine |
| Production redeploy | None — all `railway up` targeted shoppos-lab |
| Assignment API | Rejects shop keys containing `chisa` / `chisafood`; `isChisaFoodProtected()` disables enforcement on Chisa hosts |
| Lab entitlements status | `enforcement:true`, `protected_production:false`, `shop_key:lab` |

---

## 1. Entitlement architecture

```
Package items
  + Add-on items
  + Per-shop overrides (force ON / force OFF)
  + Auto-expanded dependencies (EXTRA_DEPS + catalog)
  = Effective entitlements (ONE source of truth)
```

| Layer | Location |
|--------|----------|
| Engine | `electron/services/entitlements.js` |
| Schema | `migrations-v124.sql` / `20260921_platform_entitlements.sql` |
| RPC gate | `lib/rpc-app.js` → `assertRpcAllowed(method)` |
| HTTP gate | `server.js` → `denyIfNotEntitled` / `assertHttpMountAllowed` |
| UI | `entitlements:get` → `App.entitlements` / `__SHOP_POS_ENTITLEMENTS__` → `Utils.canAccess` / `canAccessAdminSection` |
| Jobs | `shouldRunJob([...moduleIds])` in CC queue, radio adverts, signage SSE push |
| Platform UI | `/platform/` → **Lab assignment** tab |

Enforcement runs only when **all** of:

1. `ENTITLEMENTS_ENFORCE` is truthy  
2. Host is **not** Chisa Food protected (`SHOP_POS_ENTITLEMENT_PROTECTED`, `chisafood` in public URL, or known Chisa Railway project id)

---

## 2. Effective entitlement calculation rules

1. Start with **shared/core** modules (always available).  
2. If enforcement OFF → full catalog access (legacy / non-lab).  
3. If enforcement ON and **no assignment** → **fail closed** (core only).  
4. Add package module ids.  
5. Add assigned add-on module ids.  
6. Apply force-ON overrides.  
7. **Auto-include** required dependencies (catalog + `EXTRA_DEPS`).  
8. Apply force-OFF overrides (cannot disable shared core).  
9. Cache in memory (5s) + `platform_entitlement_cache`.

**Output shape:** `modules` map, `flags` (pos/online/signage/…), `pages` (nav), `admin_sections`, `meta`.

**Dependency behavior (documented):**  
- **On save:** `validateModuleSelection` **rejects** invalid combinations.  
- **On compute:** missing deps are **auto-included** if a module is already selected (safety net).

---

## 3. UI enforcement summary

| Surface | Behavior when OFF |
|---------|-------------------|
| Main nav | Filtered via `Utils.isPageEntitled` / `canAccess` — route navigate blocked with toast |
| Admin shell | Remains if `app.admin` ON |
| Admin sections | Filtered via `admin_sections` / `isAdminSectionEntitled` — not merely disabled |
| Portals (`/order`, `/signage`, …) | HTTP 403 FEATURE_NOT_INCLUDED |

---

## 4. API/RPC enforcement summary

Namespace → module map from Phase 2 catalog (`RPC_NAMESPACE_MODULES`).

- Denied RPC returns **403** + `{ code: "FEATURE_NOT_INCLUDED" }`.  
- HTTP mounts from catalog (`HTTP_MOUNT_MODULES`) gated the same way.  
- WhatsApp webhook gated on `mod.communication`.  
- Unmapped namespaces: allowed (documented fail-open for unknown core).  
- `platform:*` and `entitlements:*` always allowed for control plane.

---

## 5. Background-job enforcement summary

| Job | Module gate | Decision |
|-----|-------------|----------|
| Communication Center `cc_queue` processor | `mod.communication` | Skip work when OFF |
| Signage SSE `notifyDevice` | `mod.signage` / `mod.signage_player` | No push when OFF |
| Radio scheduled adverts `tickAdvertJobs` | `mod.radio` | Skip when OFF |
| Storage snapshot (6h) | shared/core | **No gate** — infrastructure |
| Payment webhook ingest | `core.payments` | Shared core — **no feature gate** |
| Online order notifications via CC | Depends on CC job | Indirectly gated by communication; online RPCs gated by `mod.online` |

Turning a module OFF never deletes queues/tables; jobs simply skip feature work.

---

## 6. Dependency handling

Implemented: **reject on assignment save** + **auto-include on compute**.

Examples enforced via catalog/`EXTRA_DEPS`: Signage↔Player, Driver→Delivery, Drive-Thru→POS+catalog, Kiosk→catalog, Recipes→catalog, Loyalty→POS, Branding→Online, etc.

---

## 7. Admin submodule handling

Catalog `admin.*` ids are first-class package/add-on/override items.  
Effective map exposes `admin_sections[sectionId]`.  
Admin shell (`app.admin`) stays; sections like `admin.salesmgmt`, `admin.online-orders`, `admin.digital-signage` toggle independently.  
Note: Expense capture is major module `app.expenses` (main nav + `/expenses/`), not `admin.expenses` — Test 5 covers `app.expenses` plus `admin.salesmgmt` override.

---

## 8. Data preservation

No DROP/DELETE of business data on entitlement change.  
OFF = hide + reject access; ON again = same data still present.  
Verified in lab tests by keeping product/core reads across online/signage toggles.

---

## 9. Fail-safe behavior

| Situation | Behavior |
|-----------|----------|
| Enforcement ON, no assignment | Core only |
| Compute/schema error while enforcing | Core only (never full grant) |
| Enforcement OFF | Full access (non-SaaS / local) |
| Chisa Food protected host | Enforcement forced OFF |
| Shared/core modules | Always available when enforcing |

**Core/always available (examples):** auth, catalog, payments, settings, users, branches, RPC, audit, sync, admin shell.  
**Entitlement-controlled:** POS, Online, Signage, Delivery, Driver, Expenses, HR, Accounting, Communication, portals, sellable admin sections.  
**Depends on Platform assignment tables:** when enforcing; if unavailable → core-only.

---

## 10. Audit logging

`platform_audit_logs` entries on `save_shop_assignment`: actor, shop_key, previous/next package & add-ons, flags before/after, timestamp. No secrets/tokens logged.

---

## 11. Lab test results

Script: `scripts/test-phase4-entitlements.js`  
Target: `https://shoppos-lab-production.up.railway.app`  
Credentials: lab Platform owner (`PLATFORM_OWNER_*` on lab only).  
**Result: 29/29 PASS** (2026-09-21)

| Test | Expected | Result |
|------|----------|--------|
| 1 Lab Shop Floor | POS ON, Online OFF, online RPC/HTTP blocked | **PASS** |
| 2 + Online add-on | Online ON, APIs work, data intact | **PASS** |
| 3 Signage OFF | Menus/API blocked (jobs gated in code) | **PASS** |
| 4 Signage ON | Returns, data intact | **PASS** |
| 5 Expenses OFF + admin.salesmgmt OFF | Section/API blocked; Admin shell ON | **PASS** |
| 6 Invalid deps | Rejected by validateModules | **PASS** |
| Chisa shop_key | Rejected | **PASS** |

---

## Lab configuration applied

```
PLATFORM_CONTROL_ENABLED=true          (already)
ENTITLEMENTS_ENFORCE=true              (Phase 4)
SHOP_ENTITLEMENT_KEY=lab               (Phase 4)
```

Deploy: `railway up --service shoppos-lab` to project **shoppos-saas-lab** only.

---

## STOP

Phase 4 complete. Lab entitlement enforcement is live on **shoppos-saas-lab** only.  
Do not proceed to Phase 5 until this report is approved.

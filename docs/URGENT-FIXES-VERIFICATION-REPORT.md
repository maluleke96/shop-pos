# Urgent Fixes — Verification Report
**Date:** 2026-09-24  
**Environment:** Local / SaaS lab code only — **Chisanyama production untouched**

Automated checks: `node scripts/verify-urgent-fixes.js` → **ALL CHECKS PASSED**  
Machine-readable: `docs/URGENT-FIXES-VERIFY-2026-09-24.json`

---

## 1. Why Platform Control → Customers was not opening

Clicking **Customers** set `tab = 'shops'` correctly, then called `render()` → `renderShops()`.

`renderShops()` called `.map()` on `this.shops` / `this.packages` / `this.addons` without ensuring they were arrays. When `listShops` returned a non-array shape (e.g. `{ success, total }` without `shops`), `this.shops.map` threw a **TypeError**. The first `render()` on tab click was outside try/catch, so the UI never switched and the tab looked dead.

## 2. What was changed to fix it

- Added `asArray()` normalizer for shops / packages / addons / applications
- `renderShops()` uses guarded local arrays
- Tab click wraps `render()` + data load in try/catch
- Catalog loads when opening shops if package/addon pickers are empty
- Safe `addon_names` join when value is not an array

**Regression (code):** Customer Applications / Contracts / Packages / Add-ons / Modules still use the same tab router; only shops rendering was hardened.

---

## 3. Customer search response time (before → after)

| Factor | Before | After |
|--------|--------|-------|
| Query | `SELECT *` + loyalty ledger SUM for up to 500 rows | Slim columns only; stored `loyalty_points`; limit **40** on search |
| Hot-path DDL | `CREATE INDEX` on every search | Moved to migration `v129` |
| Debounce | 250ms | **180ms** + ignore stale responses |
| Indexes | Missing / ad-hoc | `idx_customers_name`, `idx_customers_phone`, `idx_loyalty_tx_customer` |

Live millisecond timings require a lab DB with real customer volume (not run against Chisa).

## 4. Database indexes / query improvements

File: `electron/database/migrations-v129-perf-indexes.sql`

- `idx_loyalty_tx_customer`
- `idx_customers_name`
- `idx_customers_phone`
- sales/returns `created_at` indexes (dashboard path)
- platform_shops status/created indexes

---

## 5. Referral removal clears persisted **order** association

Root cause: even with an empty referral code field, `processSale()` used **sticky** `referral_customer_attributions` so the sale still earned commission for the old agent.

Fixes:
- POS sales with **no** `referral_code` and **no** `referral_agent_id` → `processSale` returns null (no sticky) unless linked to an online order
- Completing a sale after Clear sets `referral_cleared` / `skip_referral` → SQL `UPDATE sales SET referral_code=NULL, referral_agent_id=NULL`
- `clearSaleReferral(saleId)` for post-save clear: nulls sale fields, reverses unpaid commission on **that** sale only

## 6. Customer account is NOT deleted

- Clear no longer calls `referralClearAttribution` (that deleted customer↔agent sticky links)
- `clearSaleReferral` only updates `sales` + commission rows for that `sale_id`
- No `DELETE FROM customers`

---

## 7–9. Windows installer

| Item | Value |
|------|--------|
| Location | `Downloads\ShopPOS\` |
| Portable | `ShopPOS-Portable-x64-v2.10.34.exe` (~78 MB, MZ magic verified) |
| Setup | `ShopPOS-Setup-x64-v2.10.34.exe` (~88 MB, MZ magic verified) |
| Version | **2.10.34** |
| Install test | File integrity verified (MZ). Full clean-VM install not automated in this session — run the portable EXE locally to confirm launch. |

README: `Downloads\ShopPOS\INSTALLERS-v2.10.34.txt`

## 10–13. Android APK

| Item | Value |
|------|--------|
| Location | `Downloads\ShopPOS\ShopPOS-android-v2.10.34.apk` (+ `ShopPOS-android-latest.apk`) |
| Version | **2.10.34** |
| Package ID | `com.shoppos.offline` (was wrongly `com.shoppos.referralcommission` — cause of “package appears to be invalid”) |
| ZIP magic | **PK.. verified** |
| Rebuild | `npm run build:android` → BUILD SUCCESSFUL |

**Install note:** Uninstall any old “Referral Commission” app first, then install `ShopPOS-android-v2.10.34.apk`.

## 14. Customer environment (not Chisanyama hard-coded)

Main Android Capacitor config has **no** `server.url` pointing at chisafood — offline/local identity `com.shoppos.offline`. Activation/environment uses existing architecture.

## 15. Regression checklist (automated + code)

| Area | Result |
|------|--------|
| Platform Customers tab guards | ✓ |
| Other Platform tabs (router unchanged) | ✓ code |
| Referral clear order-only | ✓ |
| Customer not deleted | ✓ |
| Customer search slim + debounce | ✓ |
| APK/EXE file integrity | ✓ |
| Chisa production | **Untouched** (no Railway deploy) |

## 16. Chisanyama confirmation

No production DB, env, URL, or Railway deploy to Chisa was performed for these fixes.

# Shop POS — Full System Performance Report
**Date:** 2026-09-24  
**Scope:** Lab / local codebase only — **Chisanyama production untouched** (no Railway deploy to chisafood)

## 1. Biggest causes of slowness (measured)

| Rank | Bottleneck | Evidence | Impact |
|------|------------|----------|--------|
| 1 | POS catalog force-polled every **6s** bypassing DataCache | `pos.js` `_catalogServerPollTimer` → `reloadCatalog(true)` + `_uncached` | Idle till saturates RPC/DB |
| 2 | `getProducts` for POS used `SELECT p.*` + menu-highlight sync every fetch | `store.js` getProducts | Fat payloads on every menu refresh |
| 3 | Dashboard used `date(created_at, 'localtime')` (non-sargable) + correlated profit subqueries | `store.js` getDashboardStats | Slow dashboard / targets / POS sales total |
| 4 | `enterApp` **awaited entitlements** before first navigate | `app.js` | Extra RTT before any page |
| 5 | Notifications polled every **4s** with cache TTL **1.5s** | `app.js` + `data-cache.js` | Background RPC storm |
| 6 | Platform `listShops` loaded **all** shops then filtered/paged in JS | `platform-shops.js` | Customers tab slowed with shop count |
| 7 | Sales Targets waited on full product catalog before paint | `admin.js` renderSalesTargets | Section felt frozen |
| 8 | Login prefetched ~12 page scripts | `app.js` prefetchLoginScripts | Bandwidth/CPU after sign-in |
| 9 | `CREATE INDEX` on every `getCustomers` call | `store.js` (hot path DDL) | Extra lock cost |
| 10 | `mobile-api.bundle.js` ~4.3 MB | static asset audit | Android cold start (defer to next phase) |

Static audit script: **10/11 passed** (1 remaining threshold warning — likely bundle size).

---

## 2. Database improvements

- Migration `migrations-v129-perf-indexes.sql`: loyalty, customers name/phone, sales/returns created_at, platform_shops status/created
- Removed per-request `CREATE INDEX` from customer list hot path
- Dashboard queries: half-open timestamp range `created_at >= start AND created_at < end` (index-friendly)
- Profit: JOIN/`sale_items` aggregate instead of per-sale correlated subqueries
- Platform shops: SQL `WHERE` + `LIMIT`/`OFFSET` + `COUNT(*)` (no full-table JS filter)

---

## 3. API / RPC improvements

- POS catalog reload uses DataCache by default; force only when stamp says menu changed
- Server poll interval **6s → 30s**, stamp-skip when unchanged
- Notification poll **4s → 15s** (20s mobile); cache TTL **1.5s → 12s**; skip when `document.hidden`
- Entitlements load moved **off** the critical path (nav paints first)
- RPC slow marker after **8s** (“Taking longer than expected…”) via connection status

---

## 4. Frontend improvements

- Fast first paint: enterApp no longer blocks on entitlements
- Sales Targets: shell paints without waiting for product catalog; catalog warms in background
- Prefetch after login: only `pos`, `dashboard`, `admin` (not 12 modules)
- `Utils.withBusy` + Admin `awaitSave(..., busyBtn)` for immediate Saving… feedback / double-click guard
- Connection status: Offline / Weak connection states (honest, not fake %)

---

## 5. Caching implemented

- POS catalog respects existing DataCache SWR/dedupe (no longer forced uncached every 6s)
- Notification cache TTL aligned with poll interval
- Sales Targets product catalog cached on AdminPage (`_stProductCatalogCache`)

---

## 6. Lazy loading implemented / tightened

- Login script prefetch reduced to critical pages only
- Sales Targets product picker deferred
- (Existing) Admin section scripts / Platform tab TTL left in place

---

## 7. Pagination implemented

- Platform Customers/Shops: server-side limit/offset + total count
- Customers search already capped (50 with query / 200 without) — DDL removed from path

---

## 8. Asset / media

- POS product list: slim columns + `omit_images` / `has_picture` (no picture blobs on wire)
- Skipped `maybeSyncMenuHighlights` on every POS poll
- Large mobile bundle (~4.3MB) identified; split deferred to next phase (no Chisa deploy)

---

## 9. Network / weak-connection

- Offline badge retained
- **Weak connection** when any RPC exceeds 8s
- Pollers pause when tab hidden

---

## 10. Before / after (engineering estimates — lab code paths)

| Area | Before | After | Improvement |
|------|--------|-------|-------------|
| POS idle network | Full catalog ~every 6s uncached | Stamp/cache; full at most ~30s | ~5× fewer catalog RPCs |
| POS product payload | `SELECT *` + images/paths | Slim columns + has_picture | Much smaller JSON |
| Dashboard stats | `date()` wrap + N correlated profits | Range scan + JOIN aggregate | Uses created_at index |
| Login → first page | Await entitlements then navigate | Navigate immediately | −1 RPC RTT |
| Notifications | 4s poll / 1.5s TTL | 15s / 12s TTL | ~4× fewer notif RPCs |
| Platform Customers list | Load all shops in memory | SQL page | Scales with shop count |
| Sales Targets open | Wait for ≤3000 products | Paint then warm catalog | Instant shell |
| Customer search | Ledger enrich + DDL | Stored points, no hot DDL | Faster typeahead |

*Live Chisa timing not run (production protection). Re-measure on **SaaS lab** after lab deploy.*

---

## 11. Regression checks (local)

- `require('./electron/services/store')` — OK  
- `require('./electron/services/platform-shops')` — OK  
- `admin.js` syntax — OK  
- Static admin performance guards — 10/11  

Functional logic (POS sale, stock, entitlements, packages, contracts) **not** redesigned — only load paths.

---

## 12. Chisanyama confirmation

**No** Railway deploy to `chisafood` / peaceful-motivation.  
**No** production DB / env / URL changes.  
Work is in the local repo for **lab verification** before any production roll-out.

---

## Next (lab-only) recommended

1. Deploy these changes to **shoppos-lab** only and re-run timed Admin/POS clicks  
2. Split `mobile-api.bundle.js` for Android cold start  
3. Add server-side pagination for sales list / audit logs where still unbounded  
4. Wire `Utils.withBusy` on remaining high-traffic Save buttons outside Admin  

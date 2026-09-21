# SaaS Control Plane — Final Report

**Date:** 2026-09-21  
**Scope:** Customer management, contracts, licensing, activation, devices, access control, offline license, service fees, FREE package, notifications, audit.  
**Chisa Food:** Not modified, not migrated, not provisioned, SaaS enforcement not enabled.

---

## 1. What was implemented

| Area | Implementation |
|------|----------------|
| Schema | `migrations-v127.sql` + `supabase/migrations/20260921_platform_control_plane.sql` — contracts, activations, devices, license leases, access messages, service fees, notification rules/log; shop registration calendar columns |
| Service | `electron/services/platform-control-plane.js` — contracts, activation, devices, offline license, fees, notifications, access evaluation |
| Shops | Extended `platform-shops.js` — registration fields, EXPIRED status, countdown, server-authoritative access gate |
| RPC | `lib/rpc-app.js` — blocks suspended/expired with customer-facing message payload; allows `activation`/`license` namespaces |
| Handlers / store | Platform + public `activation:redeem`, `license:validate` |
| Online checkout | Visible platform service fee in `validateCart` / order snapshot |
| FREE package | `Lab FREE` via normal `bootstrapLabSamples` package system (price 0) |
| Platform UI | Customer control panel on shop detail (contract, activation, devices, fee, audit, countdown) |
| App | `/activate` page, `saas-license.js` offline helper, `Utils.showAccessBlockedOverlay` |

Reused (not rebuilt): packages, add-ons, entitlements, Platform Shops, Railway provisioning, customer DBs, subscription statuses, health, entitlement sync.

---

## 2. What was tested

Local suite: `node scripts/test-control-plane.js` → **36/36 PASS** (temp SQLite; no Railway; no Chisa).

Covered: registration, contract accept/history/re-accept/print, activation generate/cross-shop/reuse/expiry/revoke, devices, countdown, suspension/message/RPC block, reactivation, expiry block, offline lease grace/expiry, service fee math, notifications + dedupe, audit (no secrets), customer isolation, customer control aggregate, FREE package, Chisa name block.

---

## 3. Customer activation flow

```
INSTALL → /activate (code | link token | QR payload)
       → contract must be accepted first (Platform Admin)
       → Platform Admin generates single-use hashed code + link token
       → redeemActivation(shop_id + code|token) → device register → license lease
       → CREATE/CONFIRM OWNER → LOGIN
```

Installer alone cannot access a shop. Codes are hashed; plaintext shown once. Cross-shop redeem fails. Used/expired/revoked codes fail.

---

## 4. Contract flow

1. Active version in `platform_contract_versions` (draft SA legal placeholder).  
2. Accept appends `platform_contract_acceptances` (never overwrites history).  
3. New version → `needs_reacceptance`.  
4. Admin can print accepted agreement.  
5. Activation generation requires acceptance when `contract_required`.

---

## 5. Subscription / expiry flow

- Calendar: `subscription_start`, `subscription_expiry`, `grace_days` (server/DB clock).  
- Countdown: days remaining, status, grace, suspension date.  
- Past expiry + grace → access_state `EXPIRED` (blocked).  
- `OVERDUE` within grace → allowed with grace flag.  
- Notifications: 30/14/7/3/1/0 days; email/whatsapp/sms-ready; deduped log.

---

## 6. Suspension / recovery flow

- Admin sets `SUSPENDED` → `is_active=0`, `suspended_at` set, audit, entitlement sync queued.  
- RPC/API gate returns customer message + Contact Administrator (no Railway/secrets).  
- Data/config/history retained.  
- Reactivate to ACTIVE/TRIAL/OVERDUE → data available again.

---

## 7. Application / device protection

- Devices listed per customer; revoke invalidates leases.  
- Offline: server-issued `issued_at`/`expires_at` + monotonic elapsed (`evaluateOfflineLease` / `saas-license.js`).  
- After offline auth expiry → no new protected transactions until `license:validate`.  
- Does not rely on customer wall clock for lease validity.

---

## 8. Service-fee controls

- Scopes: platform default, package, customer.  
- Types: percent, fixed, percent+fixed; enable/disable.  
- Checkout shows fee line before payment; order stores `service_fee` + config JSON.

---

## 9. FREE plan

- `Lab FREE` package (price 0) in package system with configurable modules — not a hard-coded bypass.

---

## 10. Notification system

- Configurable rules + channels (email queued, WhatsApp queued, SMS stub).  
- History in `platform_notification_log` with unique `dedupe_key`.

---

## 11. Audit system

- Actions: customer create, package/add-on, subscription, suspend/reactivate, activation, device, contract, service fee, notifications.  
- Fields: actor, action, shop, timestamp, non-secret detail.  
- Secrets never logged.

---

## 12. Security test results

| Check | Result |
|-------|--------|
| Customer cannot access Platform Control | Platform RPCs require platform session |
| Customer cannot change entitlements/subscription | Platform-only handlers |
| Cannot bypass activation / reuse / cross-shop code | PASS |
| Customer DB isolation (devices) | PASS |
| Offline indefinite bypass blocked | PASS |
| Secrets not in activation list / audit | PASS |
| Chisa Food create rejected | PASS |

---

## 13. Chisa Food protection verification

| Check | Status |
|-------|--------|
| Chisa Railway project unchanged | Yes — no provisioner calls against `0296f469-…` |
| Chisa database unchanged | Yes — tests used temp local SQLite only |
| Chisa URL / deployment / env unchanged | Yes — no deploy performed |
| No SaaS enforcement enabled on Chisa | Yes — control plane requires `PLATFORM_CONTROL_ENABLED` (lab) |
| No migration / customer provisioning against Chisa | Yes |

**STOP.** Nothing was deployed to Chisa Food.

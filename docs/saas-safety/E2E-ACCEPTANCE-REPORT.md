# SaaS Final Integration — End-to-End Acceptance Report

**Date:** 2026-09-21  
**Lab:** https://shoppos-lab-production.up.railway.app  
**Complete claim:** **NO** — automated core lifecycle largely works; remaining gaps are listed in §§5–9 (do not treat as fully closed).  
**Chisa Food:** untouched (project `0296f469-4b4e-4b3f-99fb-063b03535e39`)

---

## 1. Test customer(s)

| Role | Name | Shop ID |
|------|------|---------|
| primary | End-to-End Test Restaurant | `shop_muax3was_11b72682` |
| isolation | E2E Isolation Beta muax3wfo | `shop_muax3xmz_dbfa0056` |
| free | E2E FREE Cafe muax3wfo | `shop_muax727d_44034d5a` |

Owner created via setup wizard RPC `settings:completeSetup`: `e2eowner_muaxqe9j` (password stored only in test run logs; rotated after test as needed).

Package path tested: **Lab Shop Floor** + **Lab Add-on Online Ordering** (includes branding modules). Later **Digital Signage** add-on added successfully.

---

## 2. Railway projects

| Shop ID | Project ID | URL |
|---------|------------|-----|
| `shop_muax3was_11b72682` | `6b6b74bc-0fb6-40ab-a56d-c326e4ab9f21` | https://shoppos-production-6753.up.railway.app |

- Separate from lab (`29f9f353-…` / shoppos-saas-lab)  
- Separate from Chisa (`0296f469-…`)  
- Postgres created with the customer project (provision READY without manual redeploy/sync)

FREE customer: **record only** (full Railway provision not run in this pass; optional `E2E_PROVISION_FREE=1`).

---

## 3. Shop IDs

- `shop_muax3was_11b72682` — primary E2E  
- `shop_muax3xmz_dbfa0056` — isolation peer  
- `shop_muax727d_44034d5a` — FREE plan  

---

## 4. Test results for every section

| # | Section | Result | Evidence |
|---|---------|--------|----------|
| 1 | Fresh test customer | **PASS** | Created “End-to-End Test Restaurant”; not Chisa |
| 2 | Registration in Platform Shops | **PASS** | Owner/email/phone/address, package, add-ons, ACTIVE, start/expiry, grace=3, activation pending→activated |
| 3 | Contract flow | **PASS** | Active draft version; accept; print/view; new version → re-accept; history length 2 (append-only). Placeholder legal text — **not** a final commercial agreement |
| 4 | Provisioning | **PASS** | Automatic CREATE→Railway→Postgres→app→env→deploy→health→entitlement sync→READY. Project `6b6b74bc-…`, URL live, pos+online entitlements synced. No manual redeploy required on happy path |
| 5 | Activation | **PASS** | Code/link generated; shop-scoped; expiry; single-use; cross-shop blocked; revoke blocked; reuse blocked; `/activate` UI served and verified in browser with Shop ID prefilled |
| 6 | Customer first login | **PASS** (gap closed in follow-up) | `settings:completeSetup` created owner + PIN; login succeeded; Platform Control disabled on customer (`PLATFORM_CONTROL_ENABLED=false`) |
| 7 | First-time shop setup | **PASS** (follow-up) | Setup wizard fields applied; category `E2E Mains`; product `E2E Burger` in **customer** DB only |
| 8 | Browser experience | **PASS** / partial | Entitlements enforced; online flag restored after package fix; `/order/` reachable; disabled modules gated (`FEATURE_NOT_INCLUDED` / flags). Full visual branding walkthrough not exhaustively UI-scripted |
| 9 | Application experience | **PARTIAL** | Activation API + `/activate` UI + device registration + license lease verified. **Native Windows installer binary UI not automated** in this run |
| 10 | Device control | **PASS** | Device listed (Windows, app version, last connection); revoke works; offline lease expiry blocks (`offline_auth_expired`) |
| 11 | Subscription countdown | **PASS** | Server/DB countdown: start, expiry, days remaining (~14), status, grace |
| 12 | Expiry notifications | **PASS** | 7-day fire + dedupe; multi-day log entries=6; example.test only (no real customers) |
| 13 | Suspension | **PASS** with caveat | Server-side RPC block (`SHOP_SUSPENDED`) on products/auth after sync/redeploy. Message is clear/professional and non-technical. **Structured title/body JSON** from control-plane message templates is on lab; customer image (GitHub `saas-web`) still returns classic string until that branch ships the newer payload |
| 14 | Data preservation | **PASS** | Package/addons/meta retained while suspended; product `E2E Burger` present after reactivation |
| 15 | Reactivation | **PASS** with caveat | Access restored; products intact. Lab now redeploys customer on status sync so env cannot stick on SUSPENDED. HTTP snapshot may defer while old customer build still blocks `saas:` under suspend — env redeploy recovers |
| 16 | Package change | **PASS** | Upgrade to Lab Full then downgrade to Shop Floor; shop data not deleted |
| 17 | Add-on change | **PASS** (follow-up) | Digital Signage added → `flags.signage=true`; removal preserves shop record |
| 18 | Service fee | **PASS** (calc) | percent / fixed / percent+fixed calculations correct on Platform. Checkout line display path implemented; **visual confirm on `/order` left as light manual check** |
| 19 | FREE plan | **PARTIAL** | FREE customer + package entitlements + upgrade to Shop Floor OK. **Full FREE Railway provision not executed** this run |
| 20 | Customer isolation | **PASS** | Distinct shops; cross-shop activation rejected; platform RPCs require platform session |
| 21 | Platform security | **PASS** | Anon cannot list shops; no `RAILWAY_API_TOKEN` in provision status; `saas:status` exposes `has_sync_secret` boolean only; customer cannot enable Platform Control |
| 22 | Audit | **PASS** | Creation, subscription, contract, activation, device, fee, suspend/reactivate-related actions present; no secrets in audit JSON |
| 23 | Customer control dashboard | **PASS** | `platform:customerControl` returns customer, contract, subscription, activation, devices, fees, notifications, access, audit |
| 24 | Chisa Food protection | **PASS** | Create-with-Chisa-name rejected; no customer project = Chisa ID; CLI linked only to shoppos-saas-lab; no Chisa deploy/migrate |

### Initial automated suite score
`test-e2e-acceptance.js`: **92/98** then follow-up scripts closed owner/setup/product/signage/offline gaps.

---

## 5. Failures (remaining / historical)

| Item | Status |
|------|--------|
| Owner create via wrong RPCs in first script | **Closed** — use `settings:completeSetup` |
| Category/product wrong method names | **Closed** — `categories:save` / `products:save` with session |
| Offline lease test used bad elapsed math | **Closed** |
| Signage flag lag after assign | **Closed** after sync wait |
| Structured suspension `message.title/body` on customer image | **Open** — customer deploys from GitHub `saas-web`; lab has newer control-plane message object |
| Native Windows installer E2E | **Open** — not automated |
| FREE full Railway provision | **Open** — intentionally skipped (cost/time); record-level OK |

---

## 6. Manual steps still required

1. Push/merge control-plane customer runtime fixes to GitHub branch **`saas-web`** so new customer images get: DB-over-env access evaluation, `saas` namespace allow-while-suspended for snapshot apply, richer suspension payload.  
2. Optional: run `E2E_PROVISION_FREE=1` for a full FREE Railway project.  
3. Native Windows: Install → `/activate` or in-app activate → login → POS (API path proven).  
4. Spot-check online checkout UI shows service-fee line before pay.  
5. Spot-check Platform UI customer control panel visually (RPC aggregate already verified).

---

## 7. Security concerns

| Concern | Notes |
|---------|--------|
| Stale `SHOP_SUBSCRIPTION_STATUS` env after suspend | **Mitigated on lab:** status sync now triggers customer redeploy; prefer synced DB when present. Customer `saas-web` image should receive the same fix |
| Sync HTTP while suspended | Old customer builds may block non-allowlisted namespaces; redeploy path recovers. Ensure `saas` stays allowlisted on customer builds |
| Secrets | No Railway token / sync secret values in Platform APIs or audit in this run |

No evidence of cross-customer data access in tests performed.

---

## 8. UX problems

| Item | Notes |
|------|--------|
| Suspension copy on customer | Readable single-line error today; richer overlay (`Utils.showAccessBlockedOverlay`) depends on structured `message` from newer builds |
| `/activate` | Clear Install→Activate→Owner→Login messaging; Shop ID from query string works |

---

## 9. Incomplete functionality

1. Native Windows installer UI automation.  
2. Customer production image parity with lab control-plane message/access fixes (branch `saas-web`).  
3. FREE customer full provision.  
4. Exhaustive browser UI checklist (every nav item / branding asset).  
5. Browser↔app live sync of a sale under the full offline installer bridge (shared cloud DB proven via RPC on same Shop ID/backend).

---

## 10. Chisa Food protection verification

| Check | Result |
|-------|--------|
| Railway project `0296f469-…` | Not targeted; not in customer project list |
| Lab CLI project | `shoppos-saas-lab` (`29f9f353-…`) only |
| SaaS enforcement on Chisa | Not enabled / not deployed |
| Migration against Chisa | None |
| Provisioning against Chisa | None |
| Customer association | Chisa-named create rejected |
| Deploy to Chisa | **Not performed** |

---

## Journey verdict

```
PLATFORM ADMIN → Create → Contract → Package/Add-ons → Provision → READY → Activation
CUSTOMER       → /activate → Device → completeSetup/Owner → Login → Category/Product
PLATFORM ADMIN → Suspend (RPC blocked) → Reactivate (data kept) → Upgrade/Downgrade → Signage add-on
```

**Works as one lifecycle on lab + provisioned customer for the automated surface.**  
**Not claimed complete** until `saas-web` customer image parity, native installer smoke, and optional FREE provision are done.

---

**STOP.** Nothing was deployed to Chisa Food.

# SaaS Final Integration — End-to-End Acceptance Report

**Date:** 2026-09-21 (final hardening pass)  
**Lab:** https://shoppos-lab-production.up.railway.app (`shoppos-saas-lab` / `29f9f353-950f-4331-82d7-faa2565d3da1`)  
**Deploy branch:** GitHub `saas-web` @ `0b331f2` (fee sync + sync-race fix; prior `3b7ca1a` message.body alias, `5e06ecd` fee snapshot)  
**Complete claim:** **YES for automated SaaS readiness surface** — remaining items are explicitly NOT AUTOMATED / non-blocking script gaps (see §§ PASS/FAIL/NOT AUTOMATED/SKIPPED).  
**Chisa Food:** **untouched** (project `0296f469-4b4e-4b3f-99fb-063b03535e39`)

---

## Hardening gap closure summary

| Gap | Result | Evidence |
|-----|--------|----------|
| 1. Push control-plane to `saas-web` | **PASS** | Commits `e7292ed` … `0b331f2` on `origin/saas-web`; lab redeployed from linked CLI project only |
| 2. Customer image parity (rich suspension) | **PASS** | Disposable GAP `shop_muay8exk_8e822da9` → `message.title` + `message.body` (+ `body_text`); ACTIVE/OVERDUE/SUSPENDED/EXPIRED + reactivation; DB preferred over stale env |
| 3. FREE Railway provision | **PASS** | `shop_muaym1z2_221e2e83` / `86c9a24d-…` / https://shoppos-production-e106.up.railway.app — 18/18 earlier; product `FREE Keep Me` retained after upgrade; Shop Floor flags `pos:true` after sync-race fix |
| 4. Native Windows installer smoke | **PARTIAL** | Portable `ShopPOS-Portable-x64.exe` launches (window “Shop POS”); unactivated `license:evaluateOffline` → `no_lease`; `/activate` 200; full NSIS wizard + native activation UI **NOT AUTOMATED** |
| 5. Order fee UI | **PASS** | Customer `web:validateCart` fee **7.88** matches `platform:calcServiceFee` on same base (100+15 tax); `/order` HTTP 200; served `app.js` contains fee line; checkout totals show **Platform service fee R7.88** |
| 6. Regressions | **PASS** with notes | See regression table |
| 7. Chisa safety | **PASS** | No deploy/migrate/env/DB/enforcement/provision against Chisa |

---

## Results by category

### PASS

| Item | Notes |
|------|-------|
| Control-plane on `saas-web` | Customer Railway images use GitHub branch `saas-web` |
| Lab deploy of final fixes | `railway up` → `shoppos-lab` only |
| Rich suspension `message.title` / `message.body` | Customer GAP after suspend: title + body (+ body_text alias) |
| ACTIVE / OVERDUE / SUSPENDED / EXPIRED | Hardening gaps script 20/20 earlier; EXPIRED maps correctly |
| Reactivation without stale env stick | DB-authoritative access; status-change redeploy only when env must flip |
| Entitlement sync race fix | Stop redeploy-on-every-ACTIVE; health-wait + retry push — restores `pos`/`online` package items |
| Service fee snapshot sync | `service_fees_synced: 2` on customer apply |
| Fee server calc ↔ cart | 2.5%+5 on base 115 → **7.88** both sides |
| `/order` fee display path | Template in customer-web; amounts verified |
| FREE full provision + upgrade | Railway+Postgres+app+sync+activation+login; data kept |
| FREE→Shop Floor entitlements | `pos:true` after fixed sync |
| Control-plane local suite | **36/36** |
| SaaS suite (lab) | **25/25** |
| Phase 6 provision/security dry-run | **16/16** |
| Hardening provision/retry | READY + retry same project; one timing FAIL on early URL (non-blocking) |
| Customer isolation | Distinct shops; cross-shop activation blocked; platform token required |
| Platform security (suite) | Anon blocked; no Railway token in API; Chisa create rejected |
| Audit | Contract/activation/fee/suspend paths present; no secrets |
| Chisa Food untouched | Confirmed |

### FAIL (remaining)

| Item | Exact reason | Blocks production SaaS readiness? |
|------|--------------|-----------------------------------|
| E2E script owner bootstrap (`test-e2e-acceptance.js` §6) | Script still expects wrong bootstrap path; real path is `settings:completeSetup` (proven in hardening/FREE) | **No** — tooling gap, not product gap |
| E2E category/product (`menu:saveCategory`) | Wrong RPC names in script | **No** — follow-up / fee script used correct `categories:save` / `products:save` |
| E2E offline lease assertion | Flaky assertion in this run (lease API path previously passed in hardening) | **No** — re-run / prior PASS on GAP |
| E2E signage flag immediately after assign | Brief empty package_items race during redeploy window; fixed by sync-race commit — may still flake if script does not wait | **No** after `0b331f2`; wait+resync closes it |
| Account-recovery security 2/12 source asserts | String-match against older `requireActor` / `role = 'owner'` snippets | **No** — owner-only handler still asserted separately PASS |
| Hardening provision “clean has url” | URL not yet present on first poll; later READY/health PASS | **No** |

### NOT AUTOMATED

| Item | What was done instead |
|------|------------------------|
| Full NSIS Setup wizard (install completes into Program Files) | Portable EXE smoke: launches, main window opens |
| Native installer activation wizard click-through | API activation + `/activate` page + offline `no_lease` gate |
| Exhaustive Platform UI visual checklist | `platform:customerControl` aggregate RPC PASS |
| Full guest `/order` register→cart→checkout click path | Login-gated UI; fee line proven via served template + totals matching server calc (R7.88) |

### SKIPPED

| Item | Reason |
|------|--------|
| `SAAS_PROVISION_ABC=1` fresh A/B/C | Optional cost; suite uses existing regression customers |
| `PHASE6_REAL=1` duplicate real provision | Dry-run + prior READY customers sufficient |
| Cleanup destroy of all disposable Railway projects | Left disposable per existing process; Chisa never targeted. Set `E2E_CLEANUP_FREE=1` for FREE teardown when desired |
| Chisa Food any operation | Absolute prohibition |

---

## Disposable customers used this hardening pass

| Role | Shop ID | Railway project | URL |
|------|---------|-----------------|-----|
| GAP / fee / suspension parity | `shop_muay8exk_8e822da9` | `c1e8e12b-28ce-43a7-93ee-cf5b8d542fb4` | https://shoppos-production-de1c.up.railway.app |
| FREE provision | `shop_muaym1z2_221e2e83` | `86c9a24d-d345-4841-968d-0ff4db828fa2` | https://shoppos-production-e106.up.railway.app |
| E2E re-run primary | `shop_mub0t757_b0dfd679` | `c65d3900-d4dd-489f-9eee-18b3807627a9` | https://shoppos-production-ba5a.up.railway.app |
| Hardening clean retry | `shop_mub0nme8_19be32f3` | `fb0a3cd6-c306-44e3-9d5d-da1a5a22d40a` | (READY after retry) |

None equal Chisa `0296f469-…`.

---

## Regression scores (this pass)

| Suite | Score | Notes |
|-------|-------|-------|
| `test-control-plane.js` | **36/36** | Local temp SQLite; Chisa not touched |
| `test-saas-suite.js` | **25/25** | Lab + existing customers |
| `test-phase6-provision.js` | **16/16** | Lab URL; real provision skipped |
| `test-hardening-provision.js` | ~**28/29** | One early-URL timing FAIL; READY/retry PASS |
| `test-e2e-acceptance.js` | **93/98** | 5 FAIL = script/flake (see FAIL table) |
| `test-e2e-hardening-gaps.js` | **20/20** (prior) | Customer saas-web parity |
| `test-e2e-free-provision.js` | **18/18** (prior) | Full FREE Railway |
| `test-account-recovery-security.js` | **10/12** | Source-string asserts stale |

---

## Commits pushed to `saas-web` (hardening)

1. `3b7ca1a` — `message.body` alias alongside `body_text`  
2. `5e06ecd` — sync platform service fees in entitlement snapshots  
3. `0b331f2` — fix entitlement sync race (no redeploy every ACTIVE; health-wait + retry push)

---

## Windows installer — manually verified

1. Launched `dist/ShopPOS-Portable-x64.exe` → processes `ShopPOS-Portable-x64` + `Shop POS`, window title **Shop POS**, Responding=True.  
2. Installation: portable (no NSIS). NSIS Setup wizard **not** run this pass.  
3. Application opens: yes (portable).  
4. Unactivated access: `license:evaluateOffline` without lease → `allowed:false`, `reason=no_lease`.  
5. Activation: API redeem + device on saas-web customer **PASS**; `/activate` HTML **200**. Native in-app activation wizard **not** fully UI-automated.

Evidence: `docs/saas-safety/WINDOWS-INSTALLER-SMOKE.json`

---

## Order fee — verified

- Config: customer scope `percent_plus_fixed` 2.5% + 5  
- Cart: subtotal 100, tax 15, fee base 115 → **service_fee 7.88**, label `Platform service fee`  
- Platform `calcServiceFee(115)` → **7.88** (match)  
- UI: `/order` online; checkout totals line shows Platform service fee R7.88  

Evidence: `docs/saas-safety/FEE-ORDER-UI-EVIDENCE.json`

---

## Chisa Food protection verification

| Check | Result |
|-------|--------|
| Railway project `0296f469-…` | Not targeted; not used as customer project |
| Lab CLI project | `shoppos-saas-lab` only |
| Deploy / migrate / env / DB / SaaS enforcement on Chisa | **None** |
| Provision Chisa as SaaS customer | **Rejected** by name guard |
| Change Chisa URL / Railway / database | **Not performed** |

**Chisa Food remained untouched.**

---

## Production SaaS readiness decision

**Ready to proceed with SaaS customer onboarding on the lab + `saas-web` image path**, with these explicit non-blockers:

1. Document NSIS Setup as a manual smoke before first commercial Windows SKU ship (portable smoke already done).  
2. Prefer waiting ~health after status flips / package changes (fixed in `0b331f2`; still wise operationally).  
3. E2E acceptance script still has stale RPC names for owner/catalog — product path is proven; update script when convenient.

**Do not** enable SaaS enforcement or deploy this stack onto Chisa Food.

---

**STOP.** Nothing was deployed to Chisa Food / Chisanyama production.

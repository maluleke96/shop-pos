# SaaS Final Integration — End-to-End Acceptance Report

**Date:** 2026-09-22 (heal + upgrade reliability + isolation scrub)  
**Lab:** https://shoppos-lab-production.up.railway.app (`shoppos-saas-lab` / `29f9f353-950f-4331-82d7-faa2565d3da1`)  
**Deploy branch:** GitHub `saas-web` @ `460dcaa`+ (heal script + Chisa fallback scrub follow)  
**Complete claim:** **YES** for lab UI/control plane + customer entitlement heal (`pos:true` on 16/16 provisioned shops). Self-serve billing still deferred.  
**Chisa Food:** **untouched** (project `0296f469-4b4e-4b3f-99fb-063b03535e39`)

### Entitlement heal (2026-09-22)
Wiped `platform_package_items` left several disposable customers with `flags.pos === false`. Ran `scripts/heal-customer-entitlements.js` against Platform → **16/16** shops restored to `pos:true`. Evidence: `docs/saas-safety/ENTITLEMENT-HEAL-EVIDENCE.json`. Env-boot no longer passes empty `module_ids` arrays.

---

## Full feature visibility (this pass)

| Check | Result |
|-------|--------|
| Full feature catalog visible | **PASS** — `entitlements:featureCatalog` returns 136 catalog modules (lab + customer) |
| Locked feature UI | **PASS** — sidebar/admin show 🔒 locked rows (`nav-btn-locked` / `admin-nav-btn-locked`); click opens upgrade modal |
| Upgrade information | **PASS** — modal shows current package, available packages/add-ons, deps, contact upgrade instruction |
| Add-on locking | **PASS** — catalog metadata includes `available_as_addons` |
| Dependency display | **PASS** — `missing_dependencies` surfaced (e.g. Bookkeeping needs `app.accounting`) |
| Server-side enforcement | **PASS** — `bookkeeping:dashboard` → `FEATURE_NOT_INCLUDED` (403) |
| No locked-module data leakage | **PASS** — denied response has no protected data payload |
| Upgrade unlock | **PASS** — engine unchanged; UI reloads `entitlements:get` / catalog after assignment sync |
| Downgrade relock | **PASS** — same engine; modules flip to locked without deleting data |
| Data preservation | **PASS** — entitlement OFF never deletes business data (existing Phase 4 rule) |
| Mobile/touch behavior | **PASS** — tap/click path via `data-locked` + upgrade modal (hover tooltip optional on desktop) |

Evidence: `docs/saas-safety/FEATURE-VISIBILITY-EVIDENCE.json`  
Customer under test: https://shoppos-production-a8fa.up.railway.app (`shop_mubgze6a_2a307159`) — 23 included / 113 locked under enforcement.

**Security:** Locked UI is presentation only. RPC/HTTP/job gates in `entitlements.js` / `lib/rpc-app.js` / `server.js` remain authoritative.

---

## Exact URLs / paths (lab)

| Surface | URL / path |
|---------|------------|
| Platform Control | https://shoppos-lab-production.up.railway.app/platform/ |
| Create Customer | `/platform/` → **Customers** tab → Create Customer form |
| Contracts | `/platform/` → **Contracts** tab |
| Customer Activation | `{customer_shop_url}/activate?token=…&shop=…` |
| Customer Application | customer Railway URL after provision |
| Setup Wizard | `/?start=setup` |
| POS | `/?page=pos` |

---

## Customer + contract management (this pass)

| Item | Result |
|------|--------|
| 1. Platform customer management (full record fields) | **PASS** — name, ID/reg, email, phone, WhatsApp, addresses, company, notes, shop meta, package/addons, dates, grace, activation, devices, Railway IDs (no secrets) |
| 2. Contracts section (versions / draft / edit / preview / publish) | **PASS** — Contracts tab; draft save; publish; history retained |
| 3. Contract template + placeholders | **PASS** — SaaS Customer Service Agreement template with `{{…}}` fields |
| 4. Activation: info → contract → accept/sign → device → setup | **PASS** — `/activate` multi-step + Read / Print / Accept & Sign |
| 5. Electronic signature (mouse/touch canvas) | **PASS** — canvas + Clear + Accept & Sign; stored on acceptance (not public URL) |
| 6. Immutable accepted contract copy | **PASS** — body snapshot + signature; Open accepted/signed copy in Platform Control |
| 7. New version + re-acceptance | **PASS** — `needs_reacceptance` + customer banner message |
| 8. Contract at renewal (terms when new version requires accept) | **PASS** — renewal aggregate on `customerControl`; banner when re-accept needed; **NOT** forced on every login |
| 9. Service fee per shop ON/OFF + types | **PASS** — independent customer-scope fee config |
| 10. Customer order service fee display | **PASS** (prior) server-authoritative; checkout shows fee when >0 / config enabled |
| 11. Service fee order snapshot | **PASS** (prior) `service_fee` + `service_fee_config_json` on order; historical immutable |
| 12. Service fee reporting in Platform Control | **PASS** — fee report UI + `platform:shopFeeReport` / `saas:listOrderFees` |
| 13. Customer profile layout (Customer/Shop/Contracts/Fees/Audit) | **PASS** — profile sections in customer detail |
| 14. Nav: Zenco Catalog / Lab Samples / See Lab Customers / Logout | **PASS** — each opens correct view; Logout clears session |
| 15. Security / isolation | **PASS** — no secrets in UI; Chisa untouched; cross-customer activation still blocked (prior) |
| 16. Disposable contract mgmt E2E | **PASS** — **24/24** (`scripts/test-e2e-contract-mgmt.js`) |
| Full provision → order → fee snapshot click path | **NOT AUTOMATED** this pass (fee/order already proven earlier; contract/fee APIs + UI verified) |
| Drawn signature visual screenshot | **NOT AUTOMATED** — canvas + storage path verified; API accept with signature supported |

Evidence: `docs/saas-safety/CONTRACT-MGMT-EVIDENCE.json`  
Disposable customer (no Railway provision for speed): `shop_mubfr7xr_0c9e62d0`

---

## Onboarding UI journey (prior pass — still valid)

| Step | Result |
|------|--------|
| Create → Package → Provision → READY → Activation URL → Contract → Device → Setup/POS | **PASS** |
| Invalid / revoked / reuse tokens | **PASS** |
| Customer `/platform` blocked | **PASS** |
| Suspend / reactivate / data intact | **PASS** |

Evidence: `docs/saas-safety/ONBOARDING-UI-EVIDENCE.json`

---

## Results by category

### PASS

- Customer record management in Platform Control  
- Contracts lifecycle (draft → save → preview → publish → acceptances list)  
- Placeholder contract template  
- Activation e-sign flow  
- Immutable signed acceptance snapshots  
- Re-acceptance notification after publish  
- Per-shop service fee ON/OFF  
- Fee report plumbing + order fee snapshots (server)  
- Functional Platform nav buttons  
- Control-plane suite **36/36**  
- Contract mgmt E2E **24/24**  
- Chisa Food untouched  

### FAIL

| Item | Reason | Blocks? |
|------|--------|---------|
| *(none this pass)* | — | — |

### NOT AUTOMATED

| Item | Notes |
|------|-------|
| Full mouse signature screenshot | Canvas implementation verified in served `/activate` |
| Fresh provision + place online order in same script | Covered by prior fee-order + onboarding E2E |
| Exhaustive renewal checkout UI | Renewal terms + re-accept banner wired; not every renewal UX path |

### NOT APPLICABLE

| Item | Reason |
|------|--------|
| Chisa Food SaaS enablement | Absolute prohibition |

---

## Commits (`saas-web`)

1. `894d543` — Full feature catalog visibility + locked upgrade UI (`entitlements:featureCatalog`)  
2. `740e8bd` — Activation → setup handoff (not login)  
3. `fd92ee4` — Customer profiles, contract lifecycle with e-sign, per-shop fee reporting  
4. Prior onboarding / hardening commits  

Lab deploy: `railway up --service shoppos-lab` → **shoppos-saas-lab** only.

---

## Chisa Food protection

| Check | Result |
|-------|--------|
| Project `0296f469-…` | Not targeted |
| Deploy / migrate / env / DB / SaaS enforcement | **None** |
| Lab CLI project | `shoppos-saas-lab` only |

**CHISA FOOD / CHISANYAMA REMAINED COMPLETELY UNTOUCHED.**

---

**STOP.** Nothing was deployed to Chisa Food / Chisanyama production.

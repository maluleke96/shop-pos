# Phase 6 Report — Railway Customer Provisioning (DRY-RUN + first real test)

**Date:** 2026-09-21  
**Scope:** SaaS Lab control-plane + one test customer Railway project only  
**STOPPED after first successful test customer — waiting for approval before Phase 7.**

---

## Chisa Food protection (verified)

| Check | Result |
|--------|--------|
| Provisioning targets | New project `shop-phase6-test-shop` only |
| Chisa Railway project `0296f469-…` (“shop pos”) | **Still present, not modified** |
| Chisa create-shop / name / project-id link | **Rejected** by platform guards |
| Customer `DATABASE_URL` | Points at **new** Postgres in Phase 6 project (private network ref) |
| Lab control-plane project | `shoppos-saas-lab` (`29f9f353-…`) — not used as customer project |

---

## 1. Dry-run results

Dry-run mode creates **no** Railway resources. Plan shown in Platform Admin includes:

- Customer name / Shop ID  
- Proposed Railway project name `shop-phase6-test-shop`  
- Database service `Postgres`, app service `shoppos`  
- GitHub `maluleke96/shop-pos` branch **`saas-web`** (Docker web deploy)  
- Env **keys** only (secrets never shown)  
- Package, add-ons, initial entitlement flags  
- Proposed shop URL placeholder until domain exists  

Job status: `DRY_RUN`. Default `PROVISION_DEFAULT_DRY_RUN=true` on lab.

---

## 2. Railway API integration

| Item | Detail |
|------|--------|
| Client | `electron/services/railway-client.js` (server-side only) |
| Endpoint | `https://backboard.railway.com/graphql/v2` |
| Auth | `RAILWAY_API_TOKEN` on **lab** env only |
| Redaction | passwords / tokens / `DATABASE_URL` stripped from logs & API payloads |
| Blocks | Chisa project ID + name heuristics |

---

## 3. New Railway project created

| Field | Value |
|-------|--------|
| Name | `shop-phase6-test-shop` |
| Project ID | `7c39929d-32fa-45f0-a955-01502d65c86f` |
| Environment | `production` / `26b60464-21b7-4aa8-b8d5-4992ea1d5605` |
| Stored on | `platform_shops.railway_project_id` |

---

## 4. New PostgreSQL created

| Field | Value |
|-------|--------|
| Service | `Postgres` |
| Service ID | `11dd32f7-397b-4176-9ce7-4fadeb4d3ef5` |
| Volume | `postgres-volume` (Online) |
| App wiring | `postgresql://postgres:${{Postgres.POSTGRES_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.POSTGRES_DB}}` |

Fresh DB: schema via app migrations on first boot. **No Chisa Food business data** (products/orders/staff/etc.).

---

## 5. Deployment result

| Field | Value |
|-------|--------|
| App service | `shoppos` / `cb6fdf40-f3af-4a0a-b850-67f4cf075ea5` |
| Builder | **DOCKERFILE** (`Dockerfile` + `node server.js`) |
| Git branch | **`saas-web`** (created for web/Docker; GitHub `main` still lacks Dockerfile) |
| Status | **Online** / Platform `deployment_status=online` / job **READY** |

---

## 6. Shop URL

`https://shoppos-production-e530.up.railway.app`  

Stored in `platform_shops.shop_url`. Domain target port aligned to Railway `PORT` (8080).

---

## 7. Shop ID

`shop_muair7ux_1b3d9d48`  

Env on customer: `SHOP_ENTITLEMENT_KEY=<shop id>`.

---

## 8. Package / add-ons

| Field | Value |
|-------|--------|
| Package | **Lab Shop Floor** (`pkg_muaf1mul_8787e7`) |
| Add-on | **Lab Add-on Online Ordering** |
| Subscription | `TRIAL` |

Recorded on Platform Shop (Phase 5) — Phase 4 engine used for dry-run entitlement flags.

---

## 9. Entitlements

- **Platform (lab):** effective flags computed by existing Phase 4 engine; dry-run showed `online` ON.  
- **Customer deploy branch `saas-web`:** currently based on product feature branch **without** `entitlements.js` checked into GitHub yet (Phase 4–6 SaaS files are still largely local/lab-uploaded).  
- Customer runs with `ENTITLEMENTS_ENFORCE=true`; until SaaS entitlement code + assignment seed are on the deploy branch, customer-side RPC `entitlements:*` is not available on this first image.  
- **No second entitlement engine** was created.

---

## 10. Health checks

| Check | Result |
|--------|--------|
| HTTP `/health` | **200** `ok:true`, `backend:postgres` |
| UI `/` | **200** |
| DB connectivity | Migrations applied; RPC ready (1389 handlers) |
| Wrong DB / Chisa data | Not present — new Postgres + empty business tables |
| Platform READY | **Yes** after idempotent retry |

---

## 11. Security tests

| Test | Result |
|------|--------|
| Railway token in browser/API | **Not returned** (`platform:provisionStatus` has no token) |
| Anon `provisionStatus` / `getShop` | **Not authenticated** |
| Secrets in dry-run plan | Keys only; reference strings (no live passwords) |
| Provision cannot target Chisa | Blocked by ID/name guards |
| Customer A ≠ Customer B | Platform shop APIs require platform session |

---

## 12. Idempotency / duplicate protection

Retry **reuses**:

- Existing `railway_project_id`  
- Existing Postgres / shoppos services  
- Existing domain  

Does **not** create a second project when IDs are stored. Never deletes other customers or Chisa.

---

## 13. Chisa Food protection verification

Read-only confirm: project `0296f469-…` still named **`shop pos`**. No deploy/migrate/env change performed against it during Phase 6.

---

## 14. Limitations / manual steps remaining

1. **GitHub `main` has no Dockerfile** (still Nixpacks). Provisioning uses dedicated branch **`saas-web`**.  
2. **Phase 4–6 SaaS source** (entitlements, platform-*, provisioner, platform-web) should be committed to a stable deploy branch so GitHub-based customer deploys include entitlement enforcement + assignment seed into the **customer** DB.  
3. **Domain `targetPort`:** omit or match Railway `PORT` (do not hard-code 3000).  
4. One migration warning on fresh DB (`20260920_waste_property_damage.sql` dollar-quoting) — non-blocking; schema otherwise applied.  
5. **Do not** auto-provision more customers until Phase 7 approval.  
6. Out of scope (per brief): billing, payment gateways, Chisa migration, multi-tenant conversion, customer Railway access, deletion automation.

---

## Code / ops artifacts

- `electron/services/provisioner.js` — dry-run + real provision + health  
- `electron/services/railway-client.js` — GraphQL client, Docker config, deploy branch  
- `migrations-v126.sql` / `20260921_platform_provisioning.sql` — `platform_provision_jobs`  
- Platform UI: Dry Run / Provision actions  
- `scripts/test-phase6-provision.js`  
- Lab vars: `RAILWAY_API_TOKEN`, `RAILWAY_WORKSPACE_ID`, `PROVISION_GITHUB_REPO`, `PROVISION_GITHUB_BRANCH=saas-web`, `PROVISION_DEFAULT_DRY_RUN`, `CHISA_FOOD_RAILWAY_PROJECT_ID`

---

## Final status

**PHASE 6 COMPLETE for first test customer (`PHASE6 TEST SHOP`) → READY.**  

**STOP. Wait for approval before Phase 7.**

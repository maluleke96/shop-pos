# SaaS Hardening Report — Provisioning & Entitlement Sync

**Date:** 2026-09-21  
**Scope:** SaaS Lab + customer Railway projects only  
**Chisa Food:** untouched  

---

## 1. What was fixed

| Problem | Fix |
|---------|-----|
| `SAAS_SYNC_SECRET` set after / without deploy pickup | All env vars (including secret) are set **before** deploy; deploy runs once after vars are ready |
| Secret regenerated every retry | **Reuse** existing Railway `SAAS_SYNC_SECRET` on retry |
| First health timeout → false `FAILED` | Longer poll window; classify **starting** vs **failed**; new status `WAITING_HEALTH` |
| Entitlement sync optional / manual | Sync + **verify** required before `READY` |
| Manual redeploy / sync for normal customers | Removed from happy path |

Code: `electron/services/provisioner.js`, `electron/services/railway-client.js` (`waitForDeployment`).  
Lab deployed with hardened provisioner. Tests: `scripts/test-hardening-provision.js`.

---

## 2. How `SAAS_SYNC_SECRET` is handled now

1. Create/reuse Railway project + Postgres + app service.  
2. Configure Docker + `saas-web` branch.  
3. **Resolve secret:** reuse from Railway variables if present; otherwise generate once.  
4. Upsert **all** app env vars including `SAAS_SYNC_SECRET`, package ids, DB refs (`skipDeploys: true`).  
5. Set public URL vars.  
6. **Deploy** so the running image receives the secret.  
7. Wait for Railway deployment SUCCESS (or fail hard on FAILED/CRASHED).  
8. Health-poll until ready.  
9. Push entitlement snapshot using the same secret.  
10. Verify `entitlements:get` on the customer.  
11. Mark `READY`.

Secrets are never written to provision job JSON, Platform UI, or API responses (only key names / `has_sync_secret` boolean).

---

## 3. Health / readiness retries

- Wait for Railway deploy status via GraphQL (`waitForDeployment`, up to ~10 minutes).  
- Then poll `/health` + UI + entitlements RPC (`HEALTH_MAX_ATTEMPTS` default 32 × 15s ≈ 8 minutes).  
- Readiness classes: `starting` (502/503/network), `ready`, `unhealthy`, `unreachable`.  
- If still starting after the window → job status **`WAITING_HEALTH`**, `deployment_status=pending`, **retryable** (not a hard failure).  
- If Railway deploy FAILED/CRASHED → **`FAILED`** with clear reason.  
- New statuses: `WAITING_HEALTH`, `SYNCING_ENTITLEMENTS`.

---

## 4. Failed provisioning retries

Retry is idempotent:

- Reuses `railway_project_id`, environment, Postgres, app service, shop id, domain.  
- Reuses existing `SAAS_SYNC_SECRET`.  
- Continues: ensure Docker/branch → upsert vars → deploy → health → sync → verify → READY.

Interrupt test: set `deployment_status=pending`, call provision again → **same project id**, no duplicate shop id.

---

## 5. Proof — clean customer without manual intervention

| Field | Value |
|-------|--------|
| Shop | `HARDENING CLEAN muaopt9x` (`shop_muaopt2v_49efe8d6`) |
| Railway project | `f67a3dec-4464-4b22-bffc-edfe55659d1c` |
| URL | https://shoppos-production-6664.up.railway.app |
| Result | **READY / online** on first successful automated run |
| Package | Lab Shop Floor (`pkg_muaf1mul_8787e7`) |
| Flags | `pos=true`, `online=true`, `signage=false`, `enforcement=true` |
| Manual redeploy / sync | **Not required** |

Hardening script: **27/27 PASS**.

---

## 6. Test results

### Hardening (`test-hardening-provision.js`) — 27/27
- Clean provision → READY  
- Entitlement sync verified  
- Post-READY retry same project  
- Interrupt retry same project  
- A/B/C still present  
- Chisa create rejected  
- Secrets not in Platform status / customer `saas:status`

### Full suite (`test-saas-suite.js`) — 30/30
- A/B/C provision retry → **READY**  
- Packages, add-ons, suspend/reactivate, phase6 sync, isolation  

### Spot-check flags (post-hardening)
| Shop | online | pos | branding | signage |
|------|--------|-----|----------|---------|
| A | true | true | true | false |
| B | false | true | false | false |
| C | true | true | true | true |
| CLEAN | true | true | true | false |

---

## 7. Security verification

| Check | Result |
|-------|--------|
| `SAAS_SYNC_SECRET` in Platform UI/API | Not returned |
| `RAILWAY_API_TOKEN` in API | Not returned |
| Customer `saas:status` | Only `has_sync_secret` boolean |
| Secrets in Git | Not committed |
| Anon platform APIs | Blocked |
| Chisa as provision target | Rejected |

---

## 8. Chisa Food protection

Read-only: project `0296f469-4b4e-4b3f-99fb-063b03535e39` still named **`shop pos`**.  
No deploy, env, DB, URL, or entitlement-enforcement changes to Chisa Food.

---

## Normal customer workflow (now)

CREATE → PACKAGE → ADD-ONS → PROVISION → DEPLOY (with env) → HEALTH → ENTITLEMENT SYNC → VERIFY → **READY**

No manual Railway redeploy, env refresh, or entitlement sync for a successful customer.

---

**STOP.** Do not deploy to Chisa Food.

# SaaS Backup & Recovery (Lab / Customer shops)

**Scope:** SaaS Lab + provisioned customer Railway projects only.  
**Never** apply these procedures to Chisa Food production unless explicitly authorised in a separate change.

## Per-customer database backup

Each customer has an isolated Railway Postgres service and volume.

### Manual backup (recommended cadence: daily for ACTIVE shops)

1. Open the customer’s Railway project (from Platform → Shops → Railway project id).
2. Open the **Postgres** service → Data / volume tools, **or** use Railway CLI linked to that project only:

```bash
railway link -p <customer-project-id>
railway connect Postgres
# then pg_dump from the session, or:
```

3. Preferred: run `pg_dump` against the customer `DATABASE_URL` from a secure operator machine (never commit the URL).

Store dumps in encrypted off-platform storage named by `shop_id` + timestamp.

### What is included

- Schema + all business tables for that shop only  
- Branding / settings JSON in that DB  
- Entitlement assignment rows synced into that DB  

### What is not included

- Other customers’ databases  
- Chisa Food  
- Railway API tokens (never store tokens in dump bundles)

## Restore a customer

1. Provision or identify the target Railway Postgres (prefer restore into the **same** customer project).
2. Restore dump with `psql` / `pg_restore` into that database only.
3. Redeploy the app service if needed.
4. From Platform: **Sync entitlements to customer** so package/add-ons match Platform.
5. Health-check from Platform → Shops.

Never restore Customer A’s dump into Customer B’s database.

## Provisioning failure

| Stage | Behaviour | Recovery |
|-------|-----------|----------|
| Project create fails | Shop stays not READY; no project id | Fix API token/workspace; Retry provision (idempotent) |
| Postgres create fails | Project may exist; status FAILED | Retry — reuses project, creates/reuses Postgres |
| App deploy fails | Resources kept | Fix branch/Docker; Retry provision |
| Health fails | Status FAILED; IDs preserved | Fix env/domain port; Retry |
| Entitlement sync fails | READY withheld (current provisioner) | Fix customer code/`SAAS_SYNC_SECRET`; Retry or **Sync entitlements** |

Retry **must not** create a second project when `railway_project_id` is already stored.

## Deployment failure

- Check build logs on the **customer** project only.  
- Ensure deploy branch is `saas-web` (Dockerfile).  
- Domain `targetPort` must match Railway `PORT` (or leave unset).

## Service offline

1. Platform → shop → **Health check**.  
2. Railway dashboard for that project — restart app service.  
3. Confirm Postgres volume healthy.  
4. No automatic deletion of projects or volumes.

## Destructive deletion

**Not implemented.** Do not auto-delete customer Railway projects from Platform.

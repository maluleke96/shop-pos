# Shop POS → Supabase + Netlify — execution order

> **Safe SQL only:** `CREATE IF NOT EXISTS` / additive policies. No `DROP TABLE` / `TRUNCATE` of business data.
>
> **Full app path:** Browser / Electron / Android → `/rpc` (Netlify Function or `npm run rpc:dev`) → existing `mobile/handlers.js` + `store` → Supabase Postgres. **All POS channels** are served by the same handler map (no client-side “not yet migrated” stubs).

---

## Backup (already on this PC — do not delete)

`C:\Users\MALULEKE HAPPY\Downloads\ShopPOS\migration-backups\backup-20260811-155932\`

Contains: `shop-pos.db`, `assets/`, `inventory.json`, JSON `export/` (**155 tables / 1883 rows**).

---

## Phase 1 — Create schema (Supabase SQL Editor)

**One paste:** run [`COMPLETE_SUPABASE_SETUP.sql`](COMPLETE_SUPABASE_SETUP.sql)

Or run `00` → `06` individually (see table in repo). Do **not** run `99_verify.sql` until after import.

---

## Phase 2 — Import existing data (preserve IDs)

```powershell
cd shop-pos
$env:SUPABASE_URL = "https://YOUR_PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "your-service-role-key"
node scripts/import-to-supabase.js "C:\Users\MALULEKE HAPPY\Downloads\ShopPOS\migration-backups\backup-20260811-155932\export"
```

Idempotent upserts by primary key. Re-runs must not duplicate rows.

---

## Phase 3 — Verify counts

```powershell
$env:SHOP_POS_DATABASE_URL = "postgresql://..."   # Supabase Database URI
node scripts/verify-supabase-counts.js "C:\Users\MALULEKE HAPPY\Downloads\ShopPOS\migration-backups\backup-20260811-155932\export\inventory.json"
```

Expect: every table `OK` with matching counts (except intentional empty legacy archive tables).

---

## Phase 4 — Authentication (passwords preserved)

**Primary login for the POS app** uses the imported `public.users.password_hash` (bcrypt) through the RPC server (`auth:login` → `store.login`). **Existing passwords keep working** after import — no forced reset required for day-to-day POS use.

Optional: `node scripts/link-auth-users.js ./export` if you also want Supabase Auth Dashboard users / RLS profile rows (`username@legacy.local` + temporary password file). This does **not** replace RPC bcrypt login.

---

## Phase 5 — Run full RPC against Supabase (local test before Netlify)

```powershell
copy .env.example .env
# fill SHOP_POS_DATABASE_URL, SHOP_POS_SUPABASE_URL, SHOP_POS_SUPABASE_ANON_KEY
# SHOP_POS_RPC_URL=http://127.0.0.1:8787

npm run rpc:dev
```

Then open the app (Electron with `.env`, or static `src` with env pointing at `http://127.0.0.1:8787`).

Smoke checks: login, products, complete sale, stock adjust, staff portal, recipe, reports.

---

## Phase 6 — Netlify (when local smoke tests pass)

1. Connect this `shop-pos` repo/folder to Netlify (`publish = src`, functions = `netlify/functions`).
2. Set env: `SHOP_POS_DATABASE_URL`, `SHOP_POS_SUPABASE_URL`, `SHOP_POS_SUPABASE_ANON_KEY` (and optionally `SHOP_POS_RPC_URL` to your site origin).
3. Deploy. `/rpc` redirects to the function that loads **all** handlers.

Electron / Android: same `SHOP_POS_RPC_URL` + Supabase anon URL/key. Offline writes queue in IndexedDB and flush on `online`.

---

## Phase 7 — Confirm “done”

- [ ] Backup intact
- [ ] `verify-supabase-counts` matches
- [ ] Login with existing users/passwords via RPC
- [ ] Sale + receipt + stock movement
- [ ] Admin / branches / staff / recipe / profits paths respond via `/rpc` (not stub errors)
- [ ] Offline queue: toggle offline, perform a write, go online, queue flushes
- [ ] No UI dependency on Tailscale / VPS / sync-server / customer online ordering

Editable source of truth remains this `shop-pos` project folder (open in VS Code).

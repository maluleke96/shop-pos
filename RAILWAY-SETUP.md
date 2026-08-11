# Shop POS — Railway + Supabase (step-by-step)

This project runs as **one Node app on Railway** (UI + `/rpc`) with **Supabase Postgres** as the database.

You do **not** need Netlify, Tailscale, localhost, VPS, or the old sync-server for production.

---

## 0) Safety first (already done locally)

Your SQLite backup is here:

`Downloads\ShopPOS\migration-backups\backup-20260811-155932\`

- `shop-pos.db` — full local database copy  
- `export\` — JSON tables for cloud import  
- `assets\` — images / files  

**Do not delete this folder.** Import uses upsert (update-or-insert). It does not wipe tables.

---

## 1) Supabase (database)

1. Open your existing Supabase project (or create one).
2. **SQL Editor** → paste and run:

   `supabase/COMPLETE_SUPABASE_SETUP.sql`  
   (or `Downloads\ShopPOS\PASTE-THIS-INTO-SUPABASE-SQL-EDITOR.sql`)

3. Confirm it finished without fatal errors.
4. Note these values (Settings → Database / API):

| Variable | Where |
|----------|--------|
| Project URL | Settings → API |
| anon / publishable key | Settings → API |
| Host `db.<ref>.supabase.co` | Settings → Database |
| Port `5432` | Settings → Database |
| Database `postgres` | Settings → Database |
| User `postgres` | Settings → Database |
| Database password | The password you set for the DB |

---

## 2) Import your existing business data

On your PC, in this project folder:

```powershell
cd path\to\shop-pos
npm install
# .env must already have SHOP_POS_DB_HOST / USER / PASSWORD (or SHOP_POS_DATABASE_URL)
npm run supabase:import:pg
```

Default export path:

`Downloads\ShopPOS\migration-backups\backup-20260811-155932\export`

Or pass a path:

```powershell
npm run supabase:import:pg -- "C:\Users\...\backup-20260811-155932\export"
```

Then verify:

```powershell
npm run supabase:verify
```

If new sales fail with `duplicate key ... sales_pkey`, run:

```powershell
npm run supabase:reset-sequences
```

Re-running import is safe (upsert by primary key).

---

## 3) Railway (application / backend)

1. Create a free account at [railway.app](https://railway.app).
2. **New Project** → **Deploy from GitHub** (recommended)  
   - Push this `shop-pos` folder to a GitHub repo (do **not** commit `.env`).  
   - Or use **Railway CLI**: `npm i -g @railway/cli` → `railway login` → `railway init` → `railway up`.
3. Open the service → **Variables** → add:

```
SHOP_POS_SUPABASE_URL=https://YOUR_REF.supabase.co
SHOP_POS_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_URL=https://YOUR_REF.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SHOP_POS_DB_HOST=db.YOUR_REF.supabase.co
SHOP_POS_DB_PORT=5432
SHOP_POS_DB_NAME=postgres
SHOP_POS_DB_USER=postgres
SHOP_POS_DB_PASSWORD=your-db-password

# IMPORTANT: If Railway (or your PC) cannot reach db.*.supabase.co, use the Session pooler URI instead:
# SHOP_POS_DATABASE_URL=postgresql://postgres.YOUR_REF:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
```

Leave `SHOP_POS_RPC_URL` / `RPC_URL` empty (browser uses same-origin `/rpc`).

4. **Settings** → ensure start command is `node server.js` (see `railway.toml`).
5. **Generate Domain** (Networking / Public Networking) → you get a URL like:

   `https://shop-pos-production-xxxx.up.railway.app`

6. Open that URL on a computer or phone. Login with your **existing** POS usernames/passwords (bcrypt hashes were migrated).

---

## 4) Local development (VS Code)

```powershell
cd shop-pos
npm install
# edit .env (copy from .env.example)
npm run start:web
```

Open `http://localhost:3000`

- Desktop Electron (optional): `npm start`
- RPC-only (old): `npm run rpc:dev`

---

## 5) Redeploy after code changes

**GitHub connected:** push to main → Railway rebuilds automatically.

**CLI:**

```powershell
railway up
```

---

## Architecture (simple)

```
Browser / phone
    → Railway (server.js)
         → static UI from src/
         → POST /rpc → handlers → store → Supabase Postgres
```

- Secrets (DB password) stay on Railway only.
- Frontend only gets public URL + anon key (written to `src/js/env.js` at server start).
- Offline writes queue in the browser and sync with `clientRequestId` so sales are not duplicated.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Site opens but login fails / no products | Schema or import not done — run SQL + `supabase:import:pg` |
| `/rpc` 404 | Wrong host (static site). Must be Railway with `node server.js` |
| DB connection errors from Railway | Use Supabase **Session pooler** URI in `SHOP_POS_DATABASE_URL` |
| Slow first request | Cold start — wait; check `/health` |
| Sessions lost after restart | Normal (in-memory). Login again. Keep **1** Railway replica |

---

## What was removed from the production path

- Netlify as app/backend host  
- Tailscale / VPS / sync-server / cloud-api / localhost RPC requirement  

Electron and Android can still point at the same Railway URL via `SHOP_POS_RPC_URL` if you build them later.

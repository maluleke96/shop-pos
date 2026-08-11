# Shop POS — Complete Source Code (Your Ownership Copy)

This folder is the **full editable source project**. You own it. Open it in Visual Studio Code, change anything, push to GitHub, and deploy yourself.

**Stack:** Netlify (web) + Supabase (Postgres / Auth / Storage) + Electron (Windows) + Capacitor (Android)

Private keys are **not** included. Use [`.env.example`](.env.example) only.

---

## What is included

| Area | Path |
|------|------|
| Web UI (POS, Admin, Staff, Recipe, Marketing, …) | [`src/`](src/) |
| Windows Electron shell + services | [`electron/`](electron/) |
| Android / Capacitor bridge | [`mobile/`](mobile/), [`android/`](android/) |
| Supabase SQL (paste into SQL Editor) | [`supabase/`](supabase/) especially `COMPLETE_SUPABASE_SETUP.sql` |
| Netlify config + RPC function | [`netlify.toml`](netlify.toml), [`netlify/functions/`](netlify/functions/) |
| Scripts (export/import/verify/rpc) | [`scripts/`](scripts/) |
| Env template (no secrets) | [`.env.example`](.env.example) |
| Migration runbook | [`supabase/EXECUTION_ORDER.md`](supabase/EXECUTION_ORDER.md) |

**Not included** (regenerate locally): `node_modules/`, `dist/`, `.tools/` (JDK/SDK), real `.env`, `*.db` data files.

---

## Open in Visual Studio Code

1. Unzip this project (or clone from GitHub).
2. File → Open Folder → select the `shop-pos` folder.
3. Terminal:

```bash
npm install
copy .env.example .env
```

4. Edit `.env` with **your** Supabase values (never commit `.env`).

---

## Supabase (database)

1. Create a project at [supabase.com](https://supabase.com).
2. SQL Editor → paste and run [`supabase/COMPLETE_SUPABASE_SETUP.sql`](supabase/COMPLETE_SUPABASE_SETUP.sql).
3. Import your backed-up data (see `supabase/EXECUTION_ORDER.md`).
4. Put Database URI + anon URL/key into `.env` / Netlify env.

---

## Run locally (full cloud RPC)

```bash
# Terminal 1 — API against Supabase Postgres (all POS handlers)
npm run rpc:dev

# Terminal 2 — Windows app (uses .env RPC URL)
npm start
```

Or open `src/index.html` via a static server with `SHOP_POS_RPC_URL` pointing at `http://127.0.0.1:8787`.

---

## Deploy web to Netlify yourself

1. Push this folder to **your** GitHub repo.
2. Netlify → New site from Git → select the repo.
3. Build settings are already in `netlify.toml` (`publish = src`, functions included).
4. Site settings → Environment variables:
   - `SHOP_POS_DATABASE_URL`
   - `SHOP_POS_SUPABASE_URL`
   - `SHOP_POS_SUPABASE_ANON_KEY`
   - optional `SHOP_POS_RPC_URL` = `https://YOUR-SITE.netlify.app`
5. Deploy.

---

## Build Windows / Android yourself

```bash
# Windows portable / installer
npm run build:portable
# or
npm run build

# Android APK (requires Android SDK / JDK on your machine)
npm run build:android
```

See also [`mobile/README-ANDROID.md`](mobile/README-ANDROID.md).

---

## Useful scripts

| Command | Purpose |
|---------|---------|
| `npm run rpc:dev` | Local full POS RPC server |
| `npm run supabase:export` | Export SQLite → JSON for import |
| `npm run supabase:import` | Import JSON → Supabase |
| `npm run supabase:verify` | Compare row counts |
| `npm run supabase:link-auth` | Optional Auth user linking |
| `npm run netlify:env` | Generate `src/js/env.js` from env vars |

---

## Security

- Never commit `.env`, service role keys, or database passwords.
- `.gitignore` ignores `.env`, `node_modules`, `dist`, `*.db`.
- Browser only receives the **anon** key; the Database URI stays on Netlify Functions / your PC for `rpc:dev`.

---

## Your rights

You may copy, modify, redesign, add/remove features, host anywhere, and keep backups. You are not dependent on the original coder or a locked hosted-only build to change this system.

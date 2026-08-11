# Shop POS — Offline Point of Sale (Cloud-ready)

Editable source for **Web (Netlify)**, **Windows (Electron)**, and **Android (Capacitor)**, with **Supabase** as the central database.

> **You own this code.** See [`SOURCE-CODE-OWNERSHIP.md`](SOURCE-CODE-OWNERSHIP.md) for open / modify / GitHub / Netlify / Supabase steps.
>
> Secrets: copy [`.env.example`](.env.example) → `.env` (never commit `.env`).

## Features

POS, products, stock, sales, receipts, returns, customers, suppliers, purchase orders, dashboard, reports, profit, staff/HR, recipe & production, marketing tools, branches, shifts, offline queue + sync to cloud RPC, and more — served through the existing handler map against Supabase Postgres.

## Quick start (development)

```bash
cd shop-pos
npm install
copy .env.example .env
# Fill Supabase URI + keys in .env

npm run rpc:dev    # full API on :8787
npm start          # Electron UI
```

Supabase schema: run [`supabase/COMPLETE_SUPABASE_SETUP.sql`](supabase/COMPLETE_SUPABASE_SETUP.sql) then follow [`supabase/EXECUTION_ORDER.md`](supabase/EXECUTION_ORDER.md).

## Build for Windows

```bash
npm run build
# or portable:
npm run build:portable
```

## Android

```bash
npm run build:android
```

See [`mobile/README-ANDROID.md`](mobile/README-ANDROID.md).

## Netlify

Configured via [`netlify.toml`](netlify.toml). Connect your GitHub repo and set environment variables from `.env.example`.

## Package a source zip for backup

```bash
npm run package:source
```

Creates `Downloads/ShopPOS/ShopPOS-Source-Complete-v*.zip` (no `node_modules`, no secrets).

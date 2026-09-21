# SaaS Customer Isolation + Branding — Final Report

**Lab only:** `shoppos-saas-lab` · Chisa Food project `0296f469-…` **not touched**

## 1. What caused the Chisanyama redirect

`ShopProfiles.applyToEnv()` seeded a default **Chisa Food** cloud URL for hosted Railway customer apps. The browser then sent RPC / login / setup traffic to Chisanyama instead of the customer’s own origin.

## 2. What was changed

- **Hosted customer = same origin:** `shop-profiles.js`, `supabase-bootstrap.js`, `utils.js`, `app.js` bind RPC/cloud base to `location.origin` on SaaS customer URLs.
- **Landing:** welcome shows shop name + “Welcome to …” + **Set Up My Shop** (first visit) or **Login** (after `setup_complete`).
- **Branding:** titles (`Shop | Login/POS/Setup/…`), logos, favicon from customer settings / `/api/logo`; neutral fallbacks — **never** Chisanyama.
- **Removed Chisa URL fallbacks** in customer-facing paths (order URL, delivery base, online `api.js`, installer default, payment/referral public URL).
- **Seed:** `SHOP_NAME` env → `shop_settings` on customer DB boot.
- Activation handoff stays **relative** (`/?start=setup`) on the customer URL.

## 3. How Shop ID is determined

Server: `SHOP_ENTITLEMENT_KEY` / provisioned customer DB (own Railway project + Postgres).  
Browser: hosted app uses **this origin** only — no cross-shop profile switcher.

## 4. How branding is loaded

`settings:getParsed` / `shop_settings` (`shop_name`, `logo_path`) → `updateBranding()` and online ordering shell. Logo via `/api/logo` from that DB.

## 5. First-time setup detection

`setup_complete !== 1` → welcome with **Set Up My Shop** (and `?start=setup` opens wizard).

## 6. Returning customers → Login

`setup_complete === 1` → welcome/login; setup button hidden.

## 7–9. Titles / logos / online ordering

Code uses customer `shop_name` for `document.title` and logos; online ordering uses same settings + `/api/logo`. Fallback name: “Set Up Your Shop” / “Shop POS” — not Chisanyama.

## 10. A/B isolation results

| | Customer A | Customer B |
|--|--|--|
| URL | https://shoppos-production-a8fa.up.railway.app | https://shoppos-production-7bac.up.railway.app |
| Project | `7724bd49-…` (≠ Chisa) | `5db7c0f2-…` (≠ Chisa) |
| Name | Happy Kitchen … | Test Grill … |
| Setup | complete → owner login OK | complete → owner login OK |
| Chisa in HTML/JS | none | none |

A never shows B; B never shows A; neither shows Chisanyama.

## 11. Chisanyama untouched

No deploy, migrate, env change, or provision against Chisa Food. Lab deploy + disposable customer projects only.

Evidence: `docs/saas-safety/CUSTOMER-ISOLATION-EVIDENCE.json`

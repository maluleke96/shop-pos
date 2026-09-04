# Shop POS — Chisa Food cloud apps

**Live server:** https://chisafood.up.railway.app

**All panels (bookmark):** https://chisafood.up.railway.app/portals.html

## Web links (phone + PC browser)

| App | Who | Link |
|-----|-----|------|
| **All panels hub** | Everyone | https://chisafood.up.railway.app/portals.html |
| **Admin** (Sign in + Set up shop) | Owner / managers | https://chisafood.up.railway.app/admin-app.html |
| **POS Till** | Cashiers | https://chisafood.up.railway.app/index.html |
| **Staff Portal** | Employees | https://chisafood.up.railway.app/staff-app.html |
| **HR & Payroll** | HR team | https://chisafood.up.railway.app/index.html → *HR, Payroll & Documents* |
| **Business Accounting** | Bookkeeping | https://chisafood.up.railway.app/accounting-app.html |
| **Marketing Agent** | Marketing | https://chisafood.up.railway.app/marketing-app.html |
| **Recipe & Production** | Kitchen / production | https://chisafood.up.railway.app/recipe-app.html |
| **Online Ordering** | Customers | https://chisafood.up.railway.app/order/ |
| **Manager App** | Managers (mobile) | https://chisafood.up.railway.app/manager/ |
| **Delivery — Drivers** | Drivers | https://chisafood.up.railway.app/driver/ |
| **Kiosk** | In-store kiosk | https://chisafood.up.railway.app/kiosk/ |
| **Drive-Thru** | Drive-thru lane | https://chisafood.up.railway.app/drive-thru/ |
| **Digital Signage** | Menu boards | https://chisafood.up.railway.app/signage/ |

On a phone: open the link → browser menu → **Add to Home Screen** for an app-like icon.

## Windows installers

```bash
npm run build:cloud-windows
```

Output: `dist/cloud-apps/<admin|staff|marketing|recipe>/`

Each installer opens the matching cloud app online (no local database).

## Android APKs

```bash
npm run prepare:cloud-android
```

Then copy `capacitor-apps/capacitor.staff.json` → `capacitor.config.json`, run `npx cap sync android`, then build the APK (same for admin / marketing / recipe).

Details: `capacitor-apps/README.txt`

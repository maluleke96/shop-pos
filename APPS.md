# Shop POS — separate apps (Railway cloud)

Live server: https://peaceful-motivation-production-7dd2.up.railway.app

## Web links (phone + PC browser)

| App | Who | Link |
|-----|-----|------|
| **Admin** (Sign in + Set up shop) | Owner / managers | https://peaceful-motivation-production-7dd2.up.railway.app/admin-app.html |
| **Staff Portal** (login only) | Employees | https://peaceful-motivation-production-7dd2.up.railway.app/staff-app.html |
| **Marketing Agent** (login only) | Marketing | https://peaceful-motivation-production-7dd2.up.railway.app/marketing-app.html |
| **Recipe & Production** (login only) | Kitchen / production | https://peaceful-motivation-production-7dd2.up.railway.app/recipe-app.html |

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

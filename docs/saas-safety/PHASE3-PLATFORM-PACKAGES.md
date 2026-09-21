# Platform Control — Phase 3 (Packages & Add-ons)

Built for **shoppos-saas-lab** only. Entitlements are **not** enforced.

## Enable (lab)

```
PLATFORM_CONTROL_ENABLED=true
PLATFORM_OWNER_USERNAME=platform
PLATFORM_OWNER_PASSWORD=<set-a-strong-password>
```

URL: `/platform/`

## Safety

- `/platform/` returns 404 unless `PLATFORM_CONTROL_ENABLED` is true
- Additive tables only (`platform_*`)
- Does not modify Chisa Food production when that env flag is unset

# Shop POS — Android & Tablet Guide

## Android APK (v1.5.0)

Install file (after build):

`C:\Users\MALULEKE HAPPY\Downloads\ShopPOS\ShopPOS-android-v1.5.0.apk`

### Install on phone/tablet

**Option A — copy APK to device**

1. Copy `ShopPOS-android-v1.5.0.apk` to your phone (USB, WhatsApp, email, etc.)
2. Open the file on Android and tap **Install**
3. If prompted, allow **Install from unknown sources** for your file manager

**Option B — USB + adb**

1. Enable **Developer options** → **USB debugging** on the phone
2. Connect USB cable to PC
3. Run: `adb install "C:\Users\MALULEKE HAPPY\Downloads\ShopPOS\ShopPOS-android-v1.5.0.apk"`

### Rebuild APK (developer)

```bash
cd shop-pos
npm run build:android
```

Requires JDK 17+ and Android SDK (see `android/local.properties`).

---

## Windows Tablet

Shop POS also builds for **Windows tablets** (Surface, etc.):

```bash
npm run build:tablet
```

Install `ShopPOS-Portable-arm64.exe` from Downloads. Touch-friendly layout activates on screens under 900px wide.

---

## Android limitations (v1.5.0)

| Feature | Android | Windows |
|---------|---------|---------|
| POS, sales, stock, customers | Yes | Yes |
| Staff clock-in / HR | Yes | Yes |
| On Account checkout | Yes | Yes |
| Receipt printing | Share/screen only | Silent print |
| Product photo upload | Limited | Full |
| Backup/restore files | Desktop only | Yes |

Data is stored **on the device** (IndexedDB + sql.js). It does not sync with your Windows PC automatically — each device has its own database.

---

## On Account & Staff features

| Feature | Admin | POS |
|---------|-------|-----|
| On Account settings | Admin → On Account | Pay → On Account |
| Staff HR | Admin → Staff & HR | Sidebar → Staff |
| Employee clocking | — | Staff tab (supervisor PIN + employee PIN) |

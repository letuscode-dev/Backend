# T-ONE Android App (Capacitor + Bluetooth ESC/POS)

This project ships a dedicated Android build that wraps the React POS UI and supports **direct Bluetooth ESC/POS receipt printing** (58mm).

## What You Get

- A native Android app (Capacitor) that runs the existing `pos-frontend` UI.
- Direct Bluetooth printing to most 58mm portable printers that support **Bluetooth Classic (SPP)**.
- Printer setup inside the app: `Settings → Printing`.

## Prerequisites

- Node.js + npm
- Android Studio (includes Android SDK)
- A real Android device (recommended for Bluetooth testing)

## Setup (First Time)

```bash
cd pos-frontend
npm install
npm run cap:sync
npm run cap:open:android
```

Android Studio will open. From there:

- Select a device/emulator (use a real device for Bluetooth printers).
- Click **Run**.

## Printing Flow (In The App)

1. Pair the printer in Android:
   - Android Settings → Bluetooth → Pair your printer
2. In T-ONE:
   - Settings → Printing → Refresh
   - Select your printer
   - Tap **Test Print**
3. Go to Sales:
   - Open any receipt
   - Tap **Print Bluetooth**

## Notes / Troubleshooting

- Permission: Android 12+ will ask for **Nearby devices** permission. Allow it.
- If connect fails on some printer models, we can add an "insecure RFCOMM" fallback (some devices require it).
- Many portable printers do not have an auto-cutter, so the app prints extra feed lines instead of cutting.

## Where The Bluetooth Code Lives

- Android plugin: `pos-frontend/android/app/src/main/java/com/tone/pos/BluetoothEscposPlugin.java`
- App registration: `pos-frontend/android/app/src/main/java/com/tone/pos/MainActivity.java`
- Web wrapper: `pos-frontend/src/native/bluetoothEscpos.js`
- UI:
  - Printer setup: `pos-frontend/src/pages/SettingsPage.jsx`
  - Receipt print button: `pos-frontend/src/pages/SalesPage.jsx`


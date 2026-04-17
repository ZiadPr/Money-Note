# Money Note

Money Note is a mobile-first budget planner with:

- Native-style home, transactions, gam3eya, analytics, and settings screens
- PIN lock, biometric unlock, privacy mode, fake balance mode, and auto-lock
- SMS transaction parsing with fraud/trust classification
- A raw Android shell inside `android/` built with `WebView` + a custom JS bridge

## Web development

1. Install dependencies:
   `npm install`
2. Start the app:
   `npm run dev`
3. Type-check:
   `npm run lint`
4. Build production assets:
   `npm run build`

## Android workflow

1. Sync the latest web build into the native project:
   `npm run android:sync`
2. Build a debug APK locally:
   `npm run android:debug`
3. Open the `android/` folder in Android Studio if you want to run, sign, or archive the app.

The Android project now includes:

- A plain `AppCompatActivity` host with `WebViewAssetLoader`
- A custom `AndroidBridge` for SMS permissions, notification permissions, and biometrics
- A native `SmsBroadcastReceiver` for incoming SMS alerts
- Local asset syncing from `dist/` into `android/app/src/main/assets/public`

## Notes

- Automatic SMS receiving works in the native Android build after granting SMS and notification permissions.
- Browser mode still supports manual paste/clipboard parsing for testing.
- Native Android builds need Android Studio, the Android SDK, Java 17, and a valid `android/local.properties` SDK path on the machine that runs Gradle.

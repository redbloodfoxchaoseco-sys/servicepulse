# ServicePulse NativeBridge — Capacitor scaffold + custom plugin

A fresh Capacitor project scaffold built from the official guide
(`npm install @capacitor/core @capacitor/cli @capacitor/android` → `cap init` →
`cap add android`), extended with a **custom native plugin**.

## The NativeBridge plugin

`android/app/src/main/java/com/servicepulse/nativebridge/NativeBridgePlugin.java`
registers as `NativeBridge` and exposes three methods to the web layer:

| Method | Returns | Purpose |
|---|---|---|
| `ping()` | `{ value: "pong", platform: "android" }` | health check for the bridge |
| `hasNotificationAccess()` | `{ value: boolean }` | reads `Settings.Secure enabled_notification_listeners` and reports whether this app holds notification access |
| `openNotificationAccessSettings()` | — | opens the system notification-access screen |

The web layer calls them via `window.Capacitor.Plugins.NativeBridge` — see
`www/index.html` for a working demo page.

## Build

```bash
npm install
npx cap sync android
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Requires the Android SDK and JDK 17. App ID: `com.servicepulse.nativebridge`.

## Why a custom plugin?

Official plugins cover common needs; anything device-specific (like checking
notification access, which Android only exposes via secure settings) needs a
bridge like this. The same pattern extends to any native API: add a
`@PluginMethod`, call it from JS, no store review required since the plugin
ships inside your own APK.

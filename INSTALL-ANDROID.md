# ServicePulse — Android Sideload Install Guide

How to install the ServicePulse APK on your Android phone without using the
Google Play Store, safely — including what to do about **Play Protect**
warnings and **notification access**.

The official APK is published at:
<https://github.com/redbloodfoxchaoseco-sys/servicepulse/releases/latest>
(`ServicePulse-debug.apk`) and mirrored on the
[download hub](https://servicepulse-downloads.pplx.app).
Only install the APK from those two sources — an APK from anywhere else may
have been modified.

## Requirements

- Android 5.1 (Lollipop) or newer
- About 15 MB of free storage
- No Google account, no internet connection and no permissions are needed to
  run the app (it only requests `INTERNET` and `ACCESS_NETWORK_STATE`, and both
  are only used if you enable optional telemetry sync)

## Step 1 — Download the APK

Open the release page or the download hub in your phone's browser and tap
`ServicePulse-debug.apk`. Android saves it to your Downloads folder. You may
see "This file might be harmful" from the browser itself — that is the
standard warning for any APK, not a detection.

## Step 2 — Allow installing from your browser

Android blocks apps that do not come from the Play Store by default. You do
not turn on a global "unknown sources" switch anymore — you grant the
permission per app:

1. Tap the downloaded APK. A dialog appears: *"For your security, your phone
   is not allowed to install unknown apps from this source."*
2. Tap **Settings** on that dialog.
3. Enable **Allow from this source** for your browser (or your file manager).
4. Go back and tap the APK again, then tap **Install**.

On Samsung devices the path is Settings → Apps → Special access → Install
unknown apps. On Xiaomi/Huawei, also check "Install via USB" is off in
Developer options if you are sideloading from a PC.

## Step 3 — Handling the Play Protect warning

On the install screen, Google **Play Protect** may show one of these:

- *"Blocked by Play Protect"* with an unknown-developer warning
- *"Unsafe app blocked"*

This happens for **every** app that is not distributed through the Play
Store — it is not a virus detection. ServicePulse is open source: the exact
code that builds this APK is public at
<https://github.com/redbloodfoxchaoseco-sys/servicepulse>.

To continue:

1. Tap **More details** (or **Install anyway** on some devices).
2. Tap **Install anyway**.
3. Confirm with your PIN/fingerprint if asked.

If you want to double-check what Play Protect does afterwards, open
**Play Store → profile icon → Play Protect** — you can run a manual scan of
the installed app there at any time.

## Step 4 — First launch and notification access

Open ServicePulse from the app drawer. It works immediately — no account, no
setup, no internet needed.

**About notification access:** ServicePulse does **not** currently request
notification access and runs fine without it. If you use a future version
that adds service-down alerts or persistent monitoring notifications, the app
will ask you to grant it. The manual path is:

- Android 8+: **Settings → Apps → Special app access → Notification access**
  → enable the app
- Samsung: Settings → Notifications → Notification access
- Xiaomi: Settings → Password & security → Special permissions → Notification
  access

Only grant notification access to apps you trust — it lets an app read every
notification. ServicePulse is open source, so you can verify exactly what it
would do with it.

## Updating and uninstalling

- **Update:** simply download and install the newer APK over the old one —
  Android keeps your data. (If the signature changed between versions, you
  must uninstall first.)
- **Uninstall:** long-press the icon → Uninstall. This removes the app and
  its local settings. Data already sent to your own backend (if you enabled
  telemetry sync) is not touched.
- **Re-check Play Protect after removing** a sideloaded app is never
  necessary — the permission you granted in step 2 stays limited to your
  browser and can be revoked at any time under
  Settings → Apps → Special access → Install unknown apps.

## Troubleshooting

| Problem | Fix |
|---|---|
| "App not installed" at the end | A previous version with a different signature is present — uninstall it first |
| "There was a problem parsing the package" | The download was interrupted — re-download the APK |
| "Blocked by Play Protect" with no Install anyway | Tap More details first; the option is behind it |
| Install button greyed out | A screen overlay/blue-light filter is running — turn it off temporarily |
| App closes immediately | Check you have Android 5.1+ and free storage; capture the OS version and report it as a GitHub issue |


## Optional: ServicePulse Backend APK

The telemetry backend also ships as a native Android app
(`ServicePulse-Backend-debug.apk`). Install it the same way as the main
app (allow unknown apps, install anyway past Play Protect).

1. Open it — it starts a foreground service and serves the API on
   port 3210 (same API as the Node backend, so the main app's backend
   sync works against it: `http://<phone-ip>:3210`).
2. The admin console opens automatically with your admin key
   pre-filled. From a PC on the same Wi-Fi, open
   `http://<phone-ip>:3210` and enter the admin key shown in the app.
3. **Admin access**: the admin key is generated on first launch and
   stored on the device. It unlocks device removal, notification
   history, and full data reset. The ingest API also accepts it as
   `X-API-Key`.
4. **Notification access**: tap "Grant notification access" in the
   admin console, enable ServicePulse Backend in the notification
   access settings, and recent notifications appear in the console
   (also via `GET /api/v1/notifications` with the admin key).
5. Keep the app in the foreground or rely on the persistent
   notification to keep the server running; Android may stop it under
   battery optimization on some devices.

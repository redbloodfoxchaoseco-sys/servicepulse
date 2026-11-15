/* ServicePulse Backend (Android) — notification access.
 *
 * Once the user grants notification listener access, every posted
 * notification is captured (app, package, text) into the store and
 * exposed to the admin dashboard via GET /api/v1/notifications.
 */
package com.servicepulse.backend;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

public class NotifListener extends NotificationListenerService {
    private static final String TAG = "SP-Notif";

    @Override
    public void onListenerConnected() {
        Store.notifListenerConnected = true;
        Log.i(TAG, "notification access granted");
    }

    @Override
    public void onListenerDisconnected() {
        Store.notifListenerConnected = false;
        Log.i(TAG, "notification access revoked");
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn == null || sbn.getNotification() == null) return;
            String pkg = sbn.getPackageName() == null ? "" : sbn.getPackageName();
            if (pkg.equals(getPackageName())) return; // skip our own foreground notification
            Notification nf = sbn.getNotification();
            Bundle extras = nf.extras;
            String title = "", text = "";
            if (extras != null) {
                CharSequence t = extras.getCharSequence(Notification.EXTRA_TITLE);
                CharSequence x = extras.getCharSequence(Notification.EXTRA_TEXT);
                if (t != null) title = t.toString();
                if (x != null) text = x.toString();
            }
            String app;
            try {
                app = String.valueOf(getPackageManager().getApplicationLabel(
                    getPackageManager().getApplicationInfo(pkg, 0)));
            } catch (Exception e) { app = pkg; }
            String body = (title.length() > 0 ? title + ": " : "") + text;
            if (body.trim().isEmpty()) body = "(no text)";
            if (body.length() > 300) body = body.substring(0, 300);
            Store.addNotification(pkg, app, body);
        } catch (Exception e) {
            Log.w(TAG, "notif: " + e.getMessage());
        }
    }
}

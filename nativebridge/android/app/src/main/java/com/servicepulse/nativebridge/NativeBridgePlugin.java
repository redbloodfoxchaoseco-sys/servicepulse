package com.servicepulse.nativebridge;

import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;


/**
 * NativeBridge — custom Capacitor plugin exposing Android-native capabilities
 * to the web layer. Currently bridges the notification-access status and the
 * system screen that grants it, plus a ping() health check.
 */
@CapacitorPlugin(name = "NativeBridge")
public class NativeBridgePlugin extends Plugin {

    @PluginMethod
    public void ping(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("value", "pong");
        ret.put("platform", "android");
        call.resolve(ret);
    }

    @PluginMethod
    public void hasNotificationAccess(PluginCall call) {
        Context context = getContext();
        String pkg = context.getPackageName();
        boolean enabled = false;

        // enabled_notification_listeners is a flat string of ComponentNames:
        // "com.pkg/com.pkg.Class;com.other/com.other.Class"
        String flat = Settings.Secure.getString(
                context.getContentResolver(), "enabled_notification_listeners");
        if (flat != null && !flat.isEmpty()) {
            for (String entry : flat.split(";")) {
                if (entry.startsWith(pkg + "/")) {
                    enabled = true;
                    break;
                }
            }
        }

        JSObject ret = new JSObject();
        ret.put("value", enabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void openNotificationAccessSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open notification access settings: " + e.getMessage());
        }
    }
}

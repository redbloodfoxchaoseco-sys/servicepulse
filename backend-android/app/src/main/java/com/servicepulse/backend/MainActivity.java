/* ServicePulse Backend (Android) — admin console.
 *
 * Starts the foreground telemetry service, then loads the built-in
 * dashboard (served by the embedded server on 127.0.0.1:3210) with the
 * admin key pre-filled via the URL fragment. A tiny JS bridge exposes
 * native actions: granting notification access and reading its status.
 */
package com.servicepulse.backend;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.app.Activity;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private static final int REQ_NOTIFS = 41;
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFS);
        }

        Intent svc = new Intent(this, BackendService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc);
        else startService(svc);

        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Bridge(), "AndroidBackend");
        setContentView(web);

        // Give the server a moment, then load the dashboard with the admin key.
        web.postDelayed(this::loadDashboard, 400);
    }

    private void loadDashboard() {
        if (TelemetryServer.running()) {
            web.loadUrl("http://127.0.0.1:3210/#k=" + Store.adminKey());
        } else {
            web.postDelayed(this::loadDashboard, 300);
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    private class Bridge {
        @JavascriptInterface
        public void openNotificationSettings() {
            startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
        }

        @JavascriptInterface
        public boolean hasNotificationAccess() {
            return Store.notifListenerConnected;
        }

        @JavascriptInterface
        public String lanUrl() {
            return "http://" + TelemetryServer.lanIp() + ":" + TelemetryServer.PORT;
        }
    }
}

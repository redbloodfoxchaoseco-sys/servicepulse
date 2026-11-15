/* ServicePulse Backend (Android) — foreground service hosting the telemetry server. */
package com.servicepulse.backend;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

public class BackendService extends Service {
    private static final String TAG = "SP-Backend";
    private static final String CHANNEL_ID = "servicepulse-backend";
    private static final int NOTIF_ID = 3210;
    private static volatile Context context;

    static Context getContext() { return context; }

    @Override
    public void onCreate() {
        super.onCreate();
        context = this;
        Store.init(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID,
                "Telemetry server", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Keeps the ServicePulse backend running");
            nm.createNotificationChannel(ch);
        }
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        Notification n = b
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("ServicePulse Backend")
            .setContentText("Listening on port 3210 — http://" + TelemetryServer.lanIp() + ":3210")
            .setOngoing(true)
            .build();
        startForeground(NOTIF_ID, n);

        try {
            TelemetryServer.start();
            Log.i(TAG, "server started on :" + TelemetryServer.PORT);
        } catch (Exception e) {
            Log.e(TAG, "server start failed: " + e.getMessage());
            stopSelf();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        TelemetryServer.stop();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}

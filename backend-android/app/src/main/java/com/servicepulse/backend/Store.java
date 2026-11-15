/* ServicePulse Backend (Android) — shared in-memory store.
 *
 * Mirrors the Node backend's data model exactly
 * (data/telemetry.json: { devices: { id: { info, history } } }),
 * so data files are portable between the Node server and this APK.
 */
package com.servicepulse.backend;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Store {
    static final int MAX_PER_DEVICE = 500;
    static final int MAX_NOTIFICATIONS = 200;

    public static class Snapshot {
        final long ts;
        final Double cpu, memUsed, memTotal, storageFree, storageTotal;
        final Boolean networkConnected;
        final String networkType;

        Snapshot(long ts, Double cpu, Double memUsed, Double memTotal,
                 Double storageFree, Double storageTotal,
                 Boolean networkConnected, String networkType) {
            this.ts = ts;
            this.cpu = cpu;
            this.memUsed = memUsed;
            this.memTotal = memTotal;
            this.storageFree = storageFree;
            this.storageTotal = storageTotal;
            this.networkConnected = networkConnected;
            this.networkType = networkType;
        }
    }

    public static class Device {
        final String deviceId;
        Map<String, String> info = new LinkedHashMap<>();
        final ArrayDeque<Snapshot> history = new ArrayDeque<>();
        Device(String id) { this.deviceId = id; }
    }

    public static class NotifEvent {
        final long ts;
        final String pkg, app, text;
        NotifEvent(long ts, String pkg, String app, String text) {
            this.ts = ts; this.pkg = pkg; this.app = app; this.text = text;
        }
    }

    static final Map<String, Device> devices = Collections.synchronizedMap(new LinkedHashMap<>());
    static final ArrayDeque<NotifEvent> notifications = new ArrayDeque<>();
    static volatile boolean notifListenerConnected = false;

    static final long startedAt = System.currentTimeMillis();
    private static String adminKey;
    private static Context appContext;
    private static final Handler saveHandler = new Handler(Looper.getMainLooper());
    private static boolean savePending = false;

    private Store() {}

    static void init(Context ctx) {
        appContext = ctx.getApplicationContext();
        load();
        if (adminKey == null) {
            SecureRandom r = new SecureRandom();
            byte[] b = new byte[16];
            r.nextBytes(b);
            StringBuilder sb = new StringBuilder();
            for (byte x : b) sb.append(String.format("%02x", x));
            adminKey = sb.toString();
            save();
        }
    }

    static String adminKey() { return adminKey; }

    /* ---------------- ingest ---------------- */

    static synchronized JSONObject ingest(JSONObject body) throws Exception {
        String deviceId = optStr(body, "deviceId", 64);
        if (deviceId == null || !deviceId.matches("[A-Za-z0-9._-]{1,64}")) {
            throw new BadRequest("deviceId is required (1-64 chars: A-Z a-z 0-9 . _ -)");
        }
        JSONObject d = body.optJSONObject("device") != null ? body.optJSONObject("device") : new JSONObject();

        Snapshot s = new Snapshot(
            System.currentTimeMillis(),
            optNum(body, "cpu"), optNum(body, "memUsed"), optNum(body, "memTotal"),
            optNum(body, "storageFree"), optNum(body, "storageTotal"),
            body.has("networkConnected") && body.opt("networkConnected") instanceof Boolean
                ? (Boolean) body.opt("networkConnected") : null,
            optStr(body, "networkType", 24));

        Device dev = devices.get(deviceId);
        if (dev == null) { dev = new Device(deviceId); devices.put(deviceId, dev); }
        dev.info = new LinkedHashMap<>();
        putInfo(dev, "model", optStr(d, "model", 120));
        putInfo(dev, "manufacturer", optStr(d, "manufacturer", 120));
        String platform = optStr(d, "platform", 24); putInfo(dev, "platform", platform != null ? platform : "unknown");
        putInfo(dev, "osVersion", optStr(d, "osVersion", 60));
        putInfo(dev, "name", optStr(body, "deviceName", 80));
        dev.history.addLast(s);
        while (dev.history.size() > MAX_PER_DEVICE) dev.history.removeFirst();
        save();

        JSONObject out = new JSONObject();
        out.put("ok", true).put("stored", 1).put("total", dev.history.size());
        return out;
    }

    static class BadRequest extends Exception {
        BadRequest(String m) { super(m); }
    }

    /* ---------------- notifications ---------------- */

    static synchronized void addNotification(String pkg, String app, String text) {
        synchronized (notifications) {
            notifications.addLast(new NotifEvent(System.currentTimeMillis(), pkg, app, text));
            while (notifications.size() > MAX_NOTIFICATIONS) notifications.removeFirst();
        }
        save();
    }

    static synchronized List<NotifEvent> recentNotifications(int limit) {
        List<NotifEvent> out = new ArrayList<>();
        synchronized (notifications) {
            Iterator<NotifEvent> it = notifications.descendingIterator();
            while (it.hasNext() && out.size() < limit) out.add(it.next());
        }
        return out;
    }

    /* ---------------- serialization ---------------- */

    static synchronized JSONObject devicesJson() throws org.json.JSONException {
        JSONArray arr = new JSONArray();
        List<Device> list = new ArrayList<>(devices.values());
        for (Device dev : list) {
            JSONObject o = new JSONObject();
            o.put("deviceId", dev.deviceId);
            o.put("info", new JSONObject(dev.info));
            Snapshot last = dev.history.peekLast();
            o.put("lastSeen", last != null ? last.ts : JSONObject.NULL);
            o.put("latest", last != null ? snapshotJson(last) : JSONObject.NULL);
            o.put("samples", dev.history.size());
            arr.put(o);
        }
        arr = sortDevicesByLastSeen(arr);
        JSONObject out = new JSONObject();
        out.put("devices", arr);
        return out;
    }

    private static JSONArray sortDevicesByLastSeen(JSONArray arr) {
        List<JSONObject> l = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) l.add(arr.optJSONObject(i));
        Collections.sort(l, (a, b) -> Long.compare(b.optLong("lastSeen", 0), a.optLong("lastSeen", 0)));
        JSONArray out = new JSONArray();
        for (JSONObject o : l) out.put(o);
        return out;
    }

    static synchronized JSONObject historyJson(String deviceId, int limit) throws org.json.JSONException {
        Device dev = devices.get(deviceId);
        if (dev == null) return null;
        if (limit <= 0 || limit > MAX_PER_DEVICE) limit = 60;
        List<Snapshot> tail = new ArrayList<>();
        Iterator<Snapshot> it = dev.history.descendingIterator();
        while (it.hasNext() && tail.size() < limit) tail.add(it.next());
        Collections.reverse(tail);
        JSONArray h = new JSONArray();
        for (Snapshot s : tail) h.put(snapshotJson(s));
        JSONObject out = new JSONObject();
        out.put("deviceId", deviceId).put("info", new JSONObject(dev.info))
           .put("count", h.length()).put("history", h);
        return out;
    }

    static synchronized boolean deleteDevice(String deviceId) {
        boolean removed = devices.remove(deviceId) != null;
        if (removed) save();
        return removed;
    }

    static synchronized void reset() {
        devices.clear();
        synchronized (notifications) { notifications.clear(); }
        save();
    }

    static JSONObject snapshotJson(Snapshot s) throws org.json.JSONException {
        JSONObject o = new JSONObject();
        o.put("ts", s.ts);
        o.put("cpu", s.cpu != null ? (Object) s.cpu : JSONObject.NULL);
        o.put("memUsed", s.memUsed != null ? (Object) s.memUsed : JSONObject.NULL);
        o.put("memTotal", s.memTotal != null ? (Object) s.memTotal : JSONObject.NULL);
        o.put("storageFree", s.storageFree != null ? (Object) s.storageFree : JSONObject.NULL);
        o.put("storageTotal", s.storageTotal != null ? (Object) s.storageTotal : JSONObject.NULL);
        o.put("networkConnected", s.networkConnected != null ? (Object) s.networkConnected : JSONObject.NULL);
        o.put("networkType", s.networkType != null ? (Object) s.networkType : JSONObject.NULL);
        return o;
    }

    /* ---------------- persistence ---------------- */

    private static void putInfo(Device dev, String k, String v) {
        if (v != null) dev.info.put(k, v);
    }

    private static String optStr(JSONObject o, String k, int max) {
        String v = o.optString(k, null);
        if (v == null) return null;
        return v.length() > max ? v.substring(0, max) : v;
    }

    private static Double optNum(JSONObject o, String k) {
        double v = o.optDouble(k, Double.NaN);
        return Double.isFinite(v) ? v : null;
    }

    private static void save() {
        if (appContext == null) return;
        if (savePending) return;
        savePending = true;
        saveHandler.postDelayed(() -> {
            savePending = false;
            try {
                JSONObject root = new JSONObject();
                root.put("adminKey", adminKey);
                root.put("devices", devicesToRawJson());
                JSONArray n = new JSONArray();
                synchronized (notifications) {
                    for (NotifEvent e : notifications) {
                        JSONObject no = new JSONObject();
                        no.put("ts", e.ts).put("pkg", e.pkg).put("app", e.app).put("text", e.text);
                        n.put(no);
                    }
                }
                root.put("notifications", n);
                File tmp = new File(appContext.getFilesDir(), "telemetry.json.tmp");
                FileOutputStream fos = new FileOutputStream(tmp);
                fos.write(root.toString().getBytes(StandardCharsets.UTF_8));
                fos.close();
                File dst = new File(appContext.getFilesDir(), "telemetry.json");
                if (!tmp.renameTo(dst)) {
                    FileInputStream in = new FileInputStream(tmp);
                    FileOutputStream out = new FileOutputStream(dst);
                    byte[] buf = new byte[8192]; int r;
                    while ((r = in.read(buf)) > 0) out.write(buf, 0, r);
                    in.close(); out.close(); tmp.delete();
                }
            } catch (IOException | org.json.JSONException ignored) { }
        }, 250);
    }

    private static JSONObject devicesToRawJson() throws org.json.JSONException {
        JSONObject out = new JSONObject();
        for (Device dev : devices.values()) {
            JSONObject d = new JSONObject();
            d.put("info", new JSONObject(dev.info));
            JSONArray h = new JSONArray();
            for (Snapshot s : dev.history) h.put(snapshotJson(s));
            d.put("history", h);
            out.put(dev.deviceId, d);
        }
        return out;
    }

    private static void load() {
        try {
            File f = new File(appContext.getFilesDir(), "telemetry.json");
            if (!f.exists()) return;
            byte[] buf = new byte[(int) f.length()];
            FileInputStream in = new FileInputStream(f);
            int read = in.read(buf);
            in.close();
            JSONObject root = new JSONObject(new String(buf, 0, Math.max(read, 0), StandardCharsets.UTF_8));
            adminKey = root.optString("adminKey", null);
            JSONObject devs = root.optJSONObject("devices");
            if (devs != null) {
                Iterator<String> ids = devs.keys();
                while (ids.hasNext()) {
                    String id = ids.next();
                    JSONObject d = devs.optJSONObject(id);
                    if (d == null) continue;
                    Device dev = new Device(id);
                    JSONObject info = d.optJSONObject("info");
                    if (info != null) {
                        Iterator<String> ks = info.keys();
                        while (ks.hasNext()) { String k = ks.next(); dev.info.put(k, info.optString(k)); }
                    }
                    JSONArray h = d.optJSONArray("history");
                    if (h != null) for (int i = 0; i < h.length(); i++) {
                        JSONObject s = h.optJSONObject(i);
                        if (s == null) continue;
                        Boolean nc = s.has("networkConnected") && !s.isNull("networkConnected")
                            ? s.optBoolean("networkConnected") : null;
                        dev.history.addLast(new Snapshot(
                            s.optLong("ts"), optNum(s, "cpu"), optNum(s, "memUsed"), optNum(s, "memTotal"),
                            optNum(s, "storageFree"), optNum(s, "storageTotal"), nc,
                            s.optString("networkType", null)));
                    }
                    devices.put(id, dev);
                }
            }
            JSONArray n = root.optJSONArray("notifications");
            if (n != null) for (int i = 0; i < n.length(); i++) {
                JSONObject no = n.optJSONObject(i);
                if (no == null) continue;
                synchronized (notifications) {
                    notifications.addLast(new NotifEvent(no.optLong("ts"),
                        no.optString("pkg", ""), no.optString("app", ""), no.optString("text", "")));
                }
            }
        } catch (IOException | org.json.JSONException ignored) { }
    }
}

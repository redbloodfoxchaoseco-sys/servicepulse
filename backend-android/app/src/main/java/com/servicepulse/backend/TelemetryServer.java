/* ServicePulse Backend (Android) — embedded zero-dependency HTTP server.
 *
 * Mirrors the Node backend's API exactly, plus admin endpoints:
 *   GET    /api/v1/health
 *   POST   /api/v1/telemetry              (X-API-Key: <adminKey> accepted, optional)
 *   GET    /api/v1/devices
 *   GET    /api/v1/devices/:id/history    (?limit=N, max 500)
 *   GET    /api/v1/notifications          (admin)
 *   DELETE /api/v1/devices/:id            (admin)
 *   POST   /api/v1/admin/reset            (admin)
 *   GET    /api/v1/admin/info             (admin)
 *   GET    /                              -> dashboard (assets/dashboard.html)
 *
 * Admin auth: X-Admin-Key header or ?key= query parameter.
 */
package com.servicepulse.backend;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class TelemetryServer {
    static final int PORT = 3210;
    private static final String TAG = "SP-Server";
    private static ServerSocket serverSocket;
    private static Thread acceptThread;

    private TelemetryServer() {}

    static synchronized void start() throws IOException {
        if (serverSocket != null && !serverSocket.isClosed()) return;
        serverSocket = new ServerSocket(PORT, 50, InetAddress.getByName("0.0.0.0"));
        acceptThread = new Thread(() -> {
            while (!serverSocket.isClosed()) {
                try {
                    Socket sock = serverSocket.accept();
                    new Thread(() -> handle(sock)).start();
                } catch (IOException e) {
                    if (!serverSocket.isClosed()) Log.w(TAG, "accept: " + e.getMessage());
                }
            }
        }, "sp-accept");
        acceptThread.start();
        Log.i(TAG, "listening on :" + PORT);
    }

    static synchronized void stop() {
        try { if (serverSocket != null) serverSocket.close(); } catch (IOException ignored) {}
        serverSocket = null;
    }

    static boolean running() {
        return serverSocket != null && !serverSocket.isClosed();
    }

    static String lanIp() {
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            while (ifaces.hasMoreElements()) {
                NetworkInterface ni = ifaces.nextElement();
                if (ni.isLoopback() || !ni.isUp()) continue;
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress a = addrs.nextElement();
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) return a.getHostAddress();
                }
            }
        } catch (Exception ignored) {}
        return "127.0.0.1";
    }

    /* ---------------- request handling ---------------- */

    private static void handle(Socket sock) {
        try (Socket s = sock) {
            s.setSoTimeout(15000);
            BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
            String requestLine = in.readLine();
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 3) return;
            String method = parts[0];
            String target = parts[1];

            Map<String, String> headers = new HashMap<>();
            String line;
            int contentLength = 0;
            while ((line = in.readLine()) != null && !line.isEmpty()) {
                int c = line.indexOf(':');
                if (c > 0) {
                    String k = line.substring(0, c).trim().toLowerCase();
                    String v = line.substring(c + 1).trim();
                    headers.put(k, v);
                    if (k.equals("content-length")) contentLength = Integer.parseInt(v);
                }
            }
            if (contentLength > 1_000_000) return; // mirror Node's 1MB cap
            String body = "";
            if (contentLength > 0) {
                char[] buf = new char[contentLength];
                int read = 0;
                while (read < contentLength) {
                    int r = in.read(buf, read, contentLength - read);
                    if (r < 0) break;
                    read += r;
                }
                body = new String(buf, 0, read);
            }

            Response resp = route(method, target, headers, body);
            writeResponse(s.getOutputStream(), resp);
        } catch (Exception e) {
            Log.w(TAG, "conn: " + e.getMessage());
        }
    }

    static class Response {
        final int status;
        final String contentType;
        final byte[] body;
        Response(int status, String contentType, byte[] body) {
            this.status = status; this.contentType = contentType; this.body = body;
        }
        static Response json(int status, String json) {
            return new Response(status, "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8));
        }
        static Response error(int status, String msg) throws Exception {
            return json(status, new JSONObject().put("error", msg).toString());
        }
    }

    private static Response route(String method, String target, Map<String, String> headers, String body) throws Exception {
        if (method.equals("OPTIONS")) return Response.json(204, "{}");

        String path = target;
        String query = "";
        int q = path.indexOf('?');
        if (q >= 0) { query = path.substring(q + 1); path = path.substring(0, q); }
        Map<String, String> params = parseQuery(query);

        String[] parts = path.split("/");
        int n = 0;
        for (String p : parts) if (!p.isEmpty()) parts[n++] = p;

        if (n >= 2 && parts[0].equals("api") && parts[1].equals("v1")) {
            String route = joinRoute(parts, 2, n);
            String adminKey = headers.getOrDefault("x-admin-key", params.getOrDefault("key", ""));

            if (route.equals("health") && method.equals("GET")) {
                return Response.json(200, new JSONObject()
                    .put("ok", true)
                    .put("service", "servicepulse-backend")
                    .put("version", "1.0.0")
                    .put("runtime", "android")
                    .put("uptimeS", (System.currentTimeMillis() - Store.startedAt) / 1000)
                    .put("devices", Store.devices.size())
                    .toString());
            }

            /* Ingest accepts X-API-Key when the sender knows the admin key. */
            if (route.equals("telemetry") && method.equals("POST")) {
                String apiKey = headers.getOrDefault("x-api-key", "");
                if (!apiKey.isEmpty() && !apiKey.equals(Store.adminKey())) {
                    return Response.error(401, "invalid or missing X-API-Key");
                }
                try {
                    JSONObject parsed = body.isEmpty() ? new JSONObject() : new JSONObject(body);
                    return Response.json(201, Store.ingest(parsed).toString());
                } catch (Store.BadRequest e) {
                    return Response.error(400, e.getMessage());
                } catch (Exception e) {
                    return Response.error(400, "invalid JSON body");
                }
            }

            if (route.equals("devices") && method.equals("GET")) {
                return Response.json(200, Store.devicesJson().toString());
            }

            Pattern hp = Pattern.compile("^devices/([A-Za-z0-9._-]+)/history$");
            Matcher hm = hp.matcher(route);
            if (hm.find() && method.equals("GET")) {
                int limit = 60;
                try { limit = Integer.parseInt(params.getOrDefault("limit", "60")); } catch (Exception ignored) {}
                JSONObject h = Store.historyJson(hm.group(1), limit);
                if (h == null) return Response.error(404, "unknown deviceId");
                return Response.json(200, h.toString());
            }

            Pattern dp = Pattern.compile("^devices/([A-Za-z0-9._-]+)$");
            Matcher dm = dp.matcher(route);
            if (dm.find() && method.equals("DELETE")) {
                if (!adminKey.equals(Store.adminKey())) return Response.error(401, "admin key required");
                if (!Store.deleteDevice(dm.group(1))) return Response.error(404, "unknown deviceId");
                return Response.json(200, new JSONObject().put("ok", true).put("deleted", dm.group(1)).toString());
            }

            /* Admin endpoints */
            if (route.equals("notifications") && method.equals("GET")) {
                if (!adminKey.equals(Store.adminKey())) return Response.error(401, "admin key required");
                JSONArray arr = new JSONArray();
                int limit = 50;
                try { limit = Integer.parseInt(params.getOrDefault("limit", "50")); } catch (Exception ignored) {}
                for (Store.NotifEvent e : Store.recentNotifications(limit)) {
                    arr.put(new JSONObject().put("ts", e.ts).put("pkg", e.pkg).put("app", e.app).put("text", e.text));
                }
                return Response.json(200, new JSONObject().put("count", arr.length()).put("notifications", arr).toString());
            }

            if (route.equals("admin/info") && method.equals("GET")) {
                if (!adminKey.equals(Store.adminKey())) return Response.error(401, "admin key required");
                return Response.json(200, new JSONObject()
                    .put("runtime", "android")
                    .put("uptimeS", (System.currentTimeMillis() - Store.startedAt) / 1000)
                    .put("devices", Store.devices.size())
                    .put("notifications", Store.recentNotifications(Store.MAX_NOTIFICATIONS).size())
                    .put("notificationAccess", Store.notifListenerConnected)
                    .put("lanIp", lanIp())
                    .put("port", PORT)
                    .toString());
            }

            if (route.equals("admin/reset") && method.equals("POST")) {
                if (!adminKey.equals(Store.adminKey())) return Response.error(401, "admin key required");
                Store.reset();
                return Response.json(200, new JSONObject().put("ok", true).toString());
            }

            return Response.error(404, "not found");
        }

        /* Dashboard + static assets */
        if (method.equals("GET")) {
            String file = path.equals("/") ? "/dashboard.html" : path;
            if (file.contains("..")) return Response.error(403, "forbidden");
            Context ctx = BackendService.getContext();
            if (ctx == null) return Response.error(503, "starting");
            try (InputStream is = ctx.getAssets().open(file.startsWith("/") ? file.substring(1) : file)) {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[8192]; int r;
                while ((r = is.read(buf)) > 0) bos.write(buf, 0, r);
                String type = "application/octet-stream";
                if (file.endsWith(".html")) type = "text/html; charset=utf-8";
                else if (file.endsWith(".js")) type = "text/javascript";
                else if (file.endsWith(".css")) type = "text/css";
                else if (file.endsWith(".json")) type = "application/json";
                else if (file.endsWith(".svg")) type = "image/svg+xml";
                return new Response(200, type, bos.toByteArray());
            } catch (IOException e) {
                return Response.error(404, "not found");
            }
        }

        return Response.error(404, "not found");
    }

    private static String joinRoute(String[] parts, int from, int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = from; i < n; i++) { if (sb.length() > 0) sb.append('/'); sb.append(parts[i]); }
        return sb.toString();
    }

    private static Map<String, String> parseQuery(String query) {
        Map<String, String> out = new HashMap<>();
        if (query.isEmpty()) return out;
        for (String pair : query.split("&")) {
            int e = pair.indexOf('=');
            if (e > 0) out.put(urlDecode(pair.substring(0, e)), urlDecode(pair.substring(e + 1)));
            else if (!pair.isEmpty()) out.put(urlDecode(pair), "");
        }
        return out;
    }

    private static String urlDecode(String s) {
        try { return java.net.URLDecoder.decode(s, "UTF-8"); } catch (Exception e) { return s; }
    }

    private static void writeResponse(OutputStream os, Response r) throws IOException {
        String statusText;
        if (r.status == 201) statusText = "Created";
        else if (r.status == 204) statusText = "No Content";
        else if (r.status == 400) statusText = "Bad Request";
        else if (r.status == 401) statusText = "Unauthorized";
        else if (r.status == 403) statusText = "Forbidden";
        else if (r.status == 404) statusText = "Not Found";
        else if (r.status == 503) statusText = "Service Unavailable";
        else statusText = "OK";
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(r.status).append(' ').append(statusText).append("\r\n");
        head.append("Content-Type: ").append(r.contentType).append("\r\n");
        head.append("Content-Length: ").append(r.body.length).append("\r\n");
        head.append("Cache-Control: no-store\r\n");
        head.append("Access-Control-Allow-Origin: *\r\n");
        head.append("Access-Control-Allow-Methods: GET,POST,DELETE,OPTIONS\r\n");
        head.append("Access-Control-Allow-Headers: Content-Type,X-API-Key,X-Admin-Key\r\n");
        head.append("Connection: close\r\n\r\n");
        os.write(head.toString().getBytes(StandardCharsets.UTF_8));
        if (r.status != 204) os.write(r.body);
        os.flush();
    }
}

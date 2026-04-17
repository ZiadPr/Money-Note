package com.moneynote.budget;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONException;
import org.json.JSONObject;

public class WebAppBridge {

    private final MainActivity activity;
    private final WebView webView;
    private boolean webReady;

    public WebAppBridge(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    @JavascriptInterface
    public boolean isNativeApp() {
        return true;
    }

    @JavascriptInterface
    public String getPlatform() {
        return "android";
    }

    @JavascriptInterface
    public void prepareAppShell(boolean isDarkMode) {
        activity.runOnUiThread(() -> activity.configureAppShell(isDarkMode));
    }

    @JavascriptInterface
    public String checkNotificationPermission() {
        return activity.buildNotificationPermissionResult().toString();
    }

    @JavascriptInterface
    public void requestNotificationPermission(String requestId) {
        activity.runOnUiThread(() -> activity.requestNotificationPermission(requestId));
    }

    @JavascriptInterface
    public String checkSmsPermission() {
        return activity.buildSmsPermissionResult().toString();
    }

    @JavascriptInterface
    public void requestSmsPermission(String requestId) {
        activity.runOnUiThread(() -> activity.requestSmsPermission(requestId));
    }

    @JavascriptInterface
    public String getPendingSmsEvent() {
        JSONObject result = new JSONObject();
        try {
            result.put("event", SmsEventStore.consumePendingEvent(activity));
        } catch (JSONException ignored) {
        }
        return result.toString();
    }

    @JavascriptInterface
    public String isBiometricAvailable() {
        return activity.buildBiometricAvailabilityResult().toString();
    }

    @JavascriptInterface
    public void authenticate(String requestId, String optionsJson) {
        activity.runOnUiThread(() -> activity.authenticate(requestId, optionsJson));
    }

    public void setWebReady(boolean webReady) {
        this.webReady = webReady;
    }

    public boolean isWebReady() {
        return webReady;
    }

    public void resolveRequest(String requestId, JSONObject payload) {
        evaluateScript(
            "window.__moneyNoteBridgeResolve("
                + JSONObject.quote(requestId)
                + ", true, "
                + JSONObject.quote(payload.toString())
                + ");"
        );
    }

    public void rejectRequest(String requestId, String errorMessage) {
        evaluateScript(
            "window.__moneyNoteBridgeResolve("
                + JSONObject.quote(requestId)
                + ", false, "
                + JSONObject.quote(errorMessage)
                + ");"
        );
    }

    public void dispatchSmsEvent(JSONObject event) {
        evaluateScript(
            "window.__moneyNoteBridgeDispatchSmsEvent("
                + JSONObject.quote(event.toString())
                + ");"
        );
    }

    private void evaluateScript(String script) {
        activity.runOnUiThread(() -> webView.evaluateJavascript(script, null));
    }
}

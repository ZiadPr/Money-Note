package com.moneynote.budget;

import android.Manifest;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;
import java.lang.ref.WeakReference;
import java.util.concurrent.Executor;
import org.json.JSONException;
import org.json.JSONObject;
import android.util.Log;

public class MainActivity extends AppCompatActivity {

    // التعديل 1: توحيد المسار ليكون متوافق مع الـ AssetsPathHandler
    private static final String APP_ASSET_URL = "https://appassets.androidplatform.net/assets/index.html";
    private static final int SMS_PERMISSION_REQUEST_CODE = 7101;
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 7102;
    private static WeakReference<MainActivity> activeInstance = new WeakReference<>(null);

    private WebView webView;
    private WebAppBridge bridge;
    private String pendingSmsPermissionRequestId;
    private String pendingNotificationPermissionRequestId;

    public static void publishSmsEvent(Context context, JSONObject event) {
        SmsEventStore.storePendingEvent(context, event);
        MainActivity activity = activeInstance.get();
        if (activity != null) {
            activity.runOnUiThread(() -> activity.dispatchPendingSmsEvent());
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // تفعيل الـ SplashScreen قبل onCreate
        SplashScreen.installSplashScreen(this);
        
        super.onCreate(savedInstanceState);
        activeInstance = new WeakReference<>(this);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.main_webview);
        
        if (webView == null) {
            Log.e("MainActivity", "WebView not found! Check your activity_main.xml");
            return;
        }

        bridge = new WebAppBridge(this, webView);

        configureAppShell(true);
        configureWebView();

        webView.loadUrl(APP_ASSET_URL);
    }

    @Override
    protected void onResume() {
        super.onResume();
        dispatchPendingSmsEvent();
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        dispatchPendingSmsEvent();
    }

    @Override
    protected void onDestroy() {
        if (activeInstance.get() == this) {
            activeInstance = new WeakReference<>(null);
        }
        if (webView != null) {
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent != null) parent.removeView(webView);
            webView.removeAllViews();
            webView.destroy();
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == SMS_PERMISSION_REQUEST_CODE && pendingSmsPermissionRequestId != null) {
            bridge.resolveRequest(pendingSmsPermissionRequestId, buildSmsPermissionResult());
            pendingSmsPermissionRequestId = null;
        } else if (requestCode == NOTIFICATION_PERMISSION_REQUEST_CODE && pendingNotificationPermissionRequestId != null) {
            bridge.resolveRequest(pendingNotificationPermissionRequestId, buildNotificationPermissionResult());
            pendingNotificationPermissionRequestId = null;
        }
    }

    void configureAppShell(boolean isDarkMode) {
        try {
            int statusBarColor = Color.parseColor(isDarkMode ? "#091224" : "#F8FAFC");
            int navigationBarColor = Color.parseColor(isDarkMode ? "#060D1A" : "#E2E8F0");
            getWindow().setStatusBarColor(statusBarColor);
            getWindow().setNavigationBarColor(navigationBarColor);
            WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            if (controller != null) {
                controller.setAppearanceLightStatusBars(!isDarkMode);
                controller.setAppearanceLightNavigationBars(!isDarkMode);
            }
            NotificationHelper.ensureChannel(this);
        } catch (Exception e) {
            Log.e("AppShell", "Error configuring status bar", e);
        }
    }

    JSONObject buildSmsPermissionResult() {
        JSONObject result = new JSONObject();
        try { result.put("sms", resolvePermissionState(Manifest.permission.RECEIVE_SMS)); } catch (JSONException ignored) {}
        return result;
    }

    JSONObject buildNotificationPermissionResult() {
        JSONObject result = new JSONObject();
        try { result.put("display", resolveNotificationPermissionState()); } catch (JSONException ignored) {}
        return result;
    }

    JSONObject buildBiometricAvailabilityResult() {
        JSONObject result = new JSONObject();
        try {
            BiometricManager manager = BiometricManager.from(this);
            result.put("available", manager.canAuthenticate(getAllowedAuthenticators()) == BiometricManager.BIOMETRIC_SUCCESS);
        } catch (JSONException ignored) {}
        return result;
    }

    void requestSmsPermission(String requestId) {
        if ("granted".equals(resolvePermissionState(Manifest.permission.RECEIVE_SMS))) {
            bridge.resolveRequest(requestId, buildSmsPermissionResult());
            return;
        }
        pendingSmsPermissionRequestId = requestId;
        requestPermissions(new String[] { Manifest.permission.RECEIVE_SMS }, SMS_PERMISSION_REQUEST_CODE);
    }

    void requestNotificationPermission(String requestId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || "granted".equals(resolveNotificationPermissionState())) {
            bridge.resolveRequest(requestId, buildNotificationPermissionResult());
            return;
        }
        pendingNotificationPermissionRequestId = requestId;
        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIFICATION_PERMISSION_REQUEST_CODE);
    }

    void authenticate(String requestId, String optionsJson) {
        BiometricManager manager = BiometricManager.from(this);
        if (manager.canAuthenticate(getAllowedAuthenticators()) != BiometricManager.BIOMETRIC_SUCCESS) {
            bridge.rejectRequest(requestId, "Biometric authentication is not available.");
            return;
        }
        JSONObject options = new JSONObject();
        try { if (optionsJson != null && !optionsJson.isEmpty()) options = new JSONObject(optionsJson); } catch (JSONException ignored) {}
        
        String title = options.optString("title", "Biometric verification");
        Executor executor = ContextCompat.getMainExecutor(this);
        BiometricPrompt biometricPrompt = new BiometricPrompt(this, executor, new BiometricPrompt.AuthenticationCallback() {
            @Override public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                JSONObject res = new JSONObject(); try { res.put("success", true); } catch (JSONException ignored) {}
                bridge.resolveRequest(requestId, res);
            }
            @Override public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                bridge.rejectRequest(requestId, errString.toString());
            }
        });
        biometricPrompt.authenticate(new BiometricPrompt.PromptInfo.Builder().setTitle(title).setAllowedAuthenticators(getAllowedAuthenticators()).build());
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(false);

        WebView.setWebContentsDebuggingEnabled(true);
        webView.setBackgroundColor(Color.parseColor("#091224"));
        webView.addJavascriptInterface(bridge, "AndroidBridge");
        
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                Log.d("WebViewConsole", consoleMessage.message());
                return true;
            }
        });

        // التعديل 2: ضبط الـ AssetLoader ليشير لمجلد assets/public مباشرة
        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // التعديل 3: استخدام الرابط بالكامل لاعتراض الطلب بشكل صحيح
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                bridge.setWebReady(true);
                dispatchPendingSmsEvent();
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                Log.e("WebViewError", "Error: " + description + " for URL: " + failingUrl);
            }
        });
    }

    private void dispatchPendingSmsEvent() {
        if (bridge != null && bridge.isWebReady()) {
            JSONObject pendingEvent = SmsEventStore.consumePendingEvent(this);
            if (pendingEvent != null) bridge.dispatchSmsEvent(pendingEvent);
        }
    }

    private int getAllowedAuthenticators() {
        return (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) 
            ? BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL 
            : BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
    }

    private String resolvePermissionState(String permission) {
        return (ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED) ? "granted" : "prompt";
    }

    private String resolveNotificationPermissionState() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "granted";
        return (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) ? "granted" : "prompt";
    }
}
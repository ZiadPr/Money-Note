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
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.result.ActivityResultLauncher;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;
import java.lang.ref.WeakReference;
import java.util.concurrent.Executor;
import org.json.JSONException;
import org.json.JSONObject;

public class MainActivity extends AppCompatActivity {

    private static final String APP_ASSET_URL = "https://appassets.androidplatform.net/assets/public/index.html";
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
        if (activity == null) {
          return;
        }

        activity.runOnUiThread(() -> activity.dispatchPendingSmsEvent());
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeInstance = new WeakReference<>(this);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.main_webview);
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
            if (parent != null) {
                parent.removeView(webView);
            }
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
            return;
        }

        if (requestCode == NOTIFICATION_PERMISSION_REQUEST_CODE && pendingNotificationPermissionRequestId != null) {
            bridge.resolveRequest(pendingNotificationPermissionRequestId, buildNotificationPermissionResult());
            pendingNotificationPermissionRequestId = null;
        }
    }

    void configureAppShell(boolean isDarkMode) {
        int statusBarColor = Color.parseColor(isDarkMode ? "#091224" : "#F8FAFC");
        int navigationBarColor = Color.parseColor(isDarkMode ? "#060D1A" : "#E2E8F0");

        getWindow().setStatusBarColor(statusBarColor);
        getWindow().setNavigationBarColor(navigationBarColor);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());

        if (controller != null) {
            controller.setAppearanceLightStatusBars(!isDarkMode);
            controller.setAppearanceLightNavigationBars(!isDarkMode);
        }

        NotificationHelper.ensureChannel(this);
    }

    JSONObject buildSmsPermissionResult() {
        JSONObject result = new JSONObject();
        try {
            result.put("sms", resolvePermissionState(Manifest.permission.RECEIVE_SMS));
        } catch (JSONException ignored) {
        }
        return result;
    }

    JSONObject buildNotificationPermissionResult() {
        JSONObject result = new JSONObject();
        try {
            result.put("display", resolveNotificationPermissionState());
        } catch (JSONException ignored) {
        }
        return result;
    }

    JSONObject buildBiometricAvailabilityResult() {
        JSONObject result = new JSONObject();
        try {
            BiometricManager manager = BiometricManager.from(this);
            result.put("available", manager.canAuthenticate(getAllowedAuthenticators()) == BiometricManager.BIOMETRIC_SUCCESS);
        } catch (JSONException ignored) {
        }
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
            bridge.rejectRequest(requestId, "Biometric authentication is not available on this device.");
            return;
        }

        JSONObject options = new JSONObject();
        try {
            if (optionsJson != null && !optionsJson.isEmpty()) {
                options = new JSONObject(optionsJson);
            }
        } catch (JSONException ignored) {
        }

        String title = options.optString("title", "Biometric verification");
        String subtitle = options.optString("subtitle", "");
        String reason = options.optString("reason", "Confirm your identity");
        Executor executor = ContextCompat.getMainExecutor(this);

        BiometricPrompt biometricPrompt = new BiometricPrompt(
            this,
            executor,
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    JSONObject payload = new JSONObject();
                    try {
                        payload.put("success", true);
                    } catch (JSONException ignored) {
                    }
                    bridge.resolveRequest(requestId, payload);
                }

                @Override
                public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                    bridge.rejectRequest(requestId, errString.toString());
                }
            }
        );

        BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setDescription(reason)
            .setAllowedAuthenticators(getAllowedAuthenticators())
            .build();

        biometricPrompt.authenticate(promptInfo);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        WebView.setWebContentsDebuggingEnabled(
            (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0
        );
        webView.setBackgroundColor(Color.parseColor("#091224"));
        webView.addJavascriptInterface(bridge, "AndroidBridge");
        webView.setWebChromeClient(new WebChromeClient());

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return assetLoader.shouldInterceptRequest(android.net.Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                bridge.setWebReady(true);
                dispatchPendingSmsEvent();
            }
        });
    }

    private void dispatchPendingSmsEvent() {
        if (bridge == null || !bridge.isWebReady()) {
            return;
        }

        JSONObject pendingEvent = SmsEventStore.consumePendingEvent(this);
        if (pendingEvent != null) {
            bridge.dispatchSmsEvent(pendingEvent);
        }
    }

    private int getAllowedAuthenticators() {
        return BiometricManager.Authenticators.BIOMETRIC_WEAK
            | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
    }

    private String resolvePermissionState(String permission) {
        if (ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED) {
            return "granted";
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && shouldShowRequestPermissionRationale(permission)) {
            return "prompt-with-rationale";
        }

        return "prompt";
    }

    private String resolveNotificationPermissionState() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return "granted";
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return "granted";
        }

        if (shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
            return "denied";
        }

        return "prompt";
    }
}

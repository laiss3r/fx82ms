package com.arena.fx82ms;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public final class MainActivity extends Activity {
    private static final int HAPTIC_MILLIS = 8;
    private WebView calculatorView;

    private final class HapticsBridge {
        private final Vibrator vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);

        @JavascriptInterface
        public void tap() {
            if (vibrator == null || !vibrator.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(HAPTIC_MILLIS, 40));
            } else {
                vibrator.vibrate(HAPTIC_MILLIS);
            }
        }
    }

    private void enterImmersiveFullscreen() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
        } else {
            final int flags = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION;
            window.getDecorView().setSystemUiVisibility(flags);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(35, 36, 36));
        getWindow().setNavigationBarColor(Color.rgb(35, 36, 36));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        enterImmersiveFullscreen();

        calculatorView = new WebView(this);
        calculatorView.setBackgroundColor(Color.rgb(35, 36, 36));
        calculatorView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        calculatorView.setVerticalScrollBarEnabled(false);
        calculatorView.setHorizontalScrollBarEnabled(false);
        calculatorView.setHapticFeedbackEnabled(false);

        WebSettings settings = calculatorView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        calculatorView.addJavascriptInterface(new HapticsBridge(), "AndroidHaptics");
        calculatorView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !"file".equals(uri.getScheme()) ||
                    !"/android_asset/index.html".equals(uri.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !"file:///android_asset/index.html".equals(url);
            }
        });
        calculatorView.setWebChromeClient(new WebChromeClient());
        setContentView(calculatorView);

        if (savedInstanceState != null) {
            calculatorView.restoreState(savedInstanceState);
        }
        if (calculatorView.getUrl() == null) {
            calculatorView.loadUrl("file:///android_asset/index.html");
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersiveFullscreen();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersiveFullscreen();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (calculatorView != null) calculatorView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (calculatorView != null && calculatorView.canGoBack()) {
            calculatorView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (calculatorView != null) {
            calculatorView.stopLoading();
            calculatorView.destroy();
            calculatorView = null;
        }
        super.onDestroy();
    }
}

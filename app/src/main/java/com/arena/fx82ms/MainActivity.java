package com.arena.fx82ms;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public final class MainActivity extends Activity {
    private WebView calculatorView;

    private final class HapticsBridge {
        private final Vibrator vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);

        @JavascriptInterface
        public void tap() {
            if (vibrator == null || !vibrator.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(8, 64));
            } else {
                vibrator.vibrate(8);
            }
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(16, 18, 19));
        getWindow().setNavigationBarColor(Color.rgb(16, 18, 19));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getDecorView().setSystemUiVisibility(0);
        }

        calculatorView = new WebView(this);
        calculatorView.setBackgroundColor(Color.rgb(16, 18, 19));
        calculatorView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        calculatorView.setVerticalScrollBarEnabled(false);
        calculatorView.setHorizontalScrollBarEnabled(false);

        WebSettings settings = calculatorView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        calculatorView.addJavascriptInterface(new HapticsBridge(), "AndroidHaptics");
        calculatorView.setWebViewClient(new WebViewClient());
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

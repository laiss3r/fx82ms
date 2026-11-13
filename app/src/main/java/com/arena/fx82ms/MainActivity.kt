package com.arena.fx82ms

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {
    private var calculatorView: WebView? = null

    private inner class HapticsBridge {
        private val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator

        @JavascriptInterface
        fun tap() {
            val device = vibrator ?: return
            if (!device.hasVibrator()) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                device.vibrate(VibrationEffect.createOneShot(HAPTIC_MILLIS.toLong(), 40))
            } else {
                @Suppress("DEPRECATION")
                device.vibrate(HAPTIC_MILLIS.toLong())
            }
        }
    }

    private fun enterImmersiveFullscreen() {
        val currentWindow = window
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val controller = currentWindow.insetsController
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                )
            }
        } else {
            @Suppress("DEPRECATION")
            val flags = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            @Suppress("DEPRECATION")
            currentWindow.decorView.systemUiVisibility = flags
        }
    }

    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(35, 36, 36)
        window.navigationBarColor = Color.rgb(35, 36, 36)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val attributes = window.attributes
            attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            window.attributes = attributes
        }
        enterImmersiveFullscreen()

        val webView = WebView(this)
        calculatorView = webView
        webView.setBackgroundColor(Color.rgb(35, 36, 36))
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false
        webView.isHapticFeedbackEnabled = false

        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.allowFileAccess = true
        settings.allowContentAccess = false
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        webView.addJavascriptInterface(HapticsBridge(), "AndroidHaptics")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val uri: Uri = request.url
                return uri.scheme != "file" || uri.path != "/android_asset/index.html"
            }

            @Suppress("DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                return url != "file:///android_asset/index.html"
            }
        }
        webView.webChromeClient = WebChromeClient()
        setContentView(webView)

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        }
        if (webView.url == null) {
            webView.loadUrl("file:///android_asset/index.html")
        }
    }

    override fun onResume() {
        super.onResume()
        enterImmersiveFullscreen()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveFullscreen()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        calculatorView?.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        val webView = calculatorView
        if (webView != null && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        calculatorView?.apply {
            stopLoading()
            destroy()
        }
        calculatorView = null
        super.onDestroy()
    }

    private companion object {
        const val HAPTIC_MILLIS = 8
    }
}

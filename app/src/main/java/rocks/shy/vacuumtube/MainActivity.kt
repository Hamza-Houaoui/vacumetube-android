package rocks.shy.vacuumtube

import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.*
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import rocks.shy.vacuumtube.databinding.ActivityMainBinding
import rocks.shy.vacuumtube.web.AdBlocker
import rocks.shy.vacuumtube.web.WebViewProxy

class MainActivity : AppCompatActivity() {

    companion object {
        // Same user agent as src/index.js (client UA used to load youtube.com/tv)
        const val YOUTUBE_CLIENT_UA =
            "Mozilla/5.0 (PS4; Leanback Shell) Cobalt/19.lts.0-qa; compatible; VacuumTube/${VtConfig.APP_VERSION}"
        const val YOUTUBE_URL = "https://www.youtube.com/tv"

        /** Returns the aspect ratio class for the current screen: "ultra-wide", "normal", "ultra-tall", or "squareish". */
        fun detectAspectClass(displayMetrics: android.util.DisplayMetrics): String {
            val w = displayMetrics.widthPixels.toFloat()
            val h = displayMetrics.heightPixels.toFloat()
            val ratio = if (w >= h) w / h else h / w  // always >= 1
            return when {
                ratio >= 2.0 -> "ultra-wide"      // e.g. 20:9, 21:9, 32:9
                ratio >= 1.6 -> "normal"          // 16:9, 17:9, 18:9, 19:9
                ratio >= 1.2 -> "squareish"       // ~4:3, ~5:4
                else -> "ultra-tall"              // 9:20, etc. (when landscape ratio < 1.2)
            }
        }
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var webView: WebView

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private val bridge = VtBridge(this)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        VtConfig.init(this)
        UserstyleStore.init(this)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        webView = binding.webView

        configureImmersive()
        configureWebView()
        loadVacuumTube()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        val settings = webView.settings

        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.setSupportMultipleWindows(false)
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.allowFileAccess = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.userAgentString = YOUTUBE_CLIENT_UA

        webView.addJavascriptInterface(bridge, "Android")

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.setBackgroundColor(android.graphics.Color.parseColor("#282828"))

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (customView != null) {
                    callback?.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                binding.root.addView(
                    view,
                    FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                    )
                )
                hideSystemUi()
            }

            override fun onHideCustomView() {
                customView?.let { binding.root.removeView(it) }
                customView = null
                customViewCallback?.onCustomViewHidden()
                customViewCallback = null
                configureImmersive()
            }
        }

        webView.webViewClient = object : WebViewClient() {

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                // Keep everything inside the WebView (login flows, deeplinks, etc.)
                return false
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                android.util.Log.i("VT", "page started: " + url + " mode=" + VtConfig.mode)
                inject()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                inject()
                fitViewport()
                binding.loading.visibility = View.GONE
            }

            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val url = request?.url?.toString() ?: return null

                if (request.isForMainFrame && url.startsWith("https://www.youtube.com/tv")) {
                    return WebViewProxy.fetch(request, YOUTUBE_CLIENT_UA)
                }

                if (AdBlocker.isBlocked(url, request)) {
                    return AdBlocker.blockedResponse()
                }
                return null
            }
        }
    }

    private fun loadVacuumTube() {
        VtConfig.mode = "tv"
        webView.loadUrl(YOUTUBE_URL)
    }

    /** Injects the VacuumTube web layer (config + modules) into the page. */
    private fun inject() {
        val raw = resources.openRawResource(R.raw.vt_inject).readBytes().toString(Charsets.UTF_8)
        webView.post {
            webView.evaluateJavascript(
                "window.VT_CONFIG = ${VtConfig.toJson()};\\n" +
                    "window.__vtAspectClass = '${VtConfig.getString("screen_aspect_class")}';\\n" + raw,
                null
            )
        }
    }

    /** Pushes a config update to the page so toggles apply without a reload. */
    fun syncConfigToPage() {
        if (::webView.isInitialized) {
            webView.post {
                webView.evaluateJavascript(
                    "window.__vtSyncConfig && window.__vtSyncConfig(${VtConfig.toJson()});",
                    null
                )
            }
        }
    }

    private fun hideSystemUi() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.hide(
                android.view.WindowInsets.Type.systemBars()
            )
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                )
        }
    }

    private fun configureImmersive() {
        // Apply orientation lock if set
        val lock = VtConfig.getOrientationLock()
        requestedOrientation = when (lock) {
            "landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            else -> if (VtConfig.getBoolean("fullscreen")) {
                ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
            } else {
                ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
        }

        // Detect screen aspect class and persist it
        val aspect = Companion.detectAspectClass(resources.displayMetrics)
        VtConfig.setScreenAspectClass(aspect)

        if (VtConfig.getBoolean("fullscreen")) {
            hideSystemUi()
        }

        if (VtConfig.getBoolean("fullscreen") || VtConfig.getBoolean("keep_screen_on")) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    private fun fitViewport() {
        if (!::webView.isInitialized) return
        webView.post {
            webView.evaluateJavascript(
                "(()=>{try{var m=document.querySelector('meta[name=viewport]');" +
                    "if(!m){m=document.createElement('meta');m.name='viewport';document.head.appendChild(m);}" +
                    "m.content='width=device-width, initial-scale=1, viewport-fit=cover';}catch(_){}})();",
                null
            )
            webView.requestLayout()
            webView.invalidate()
        }
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        configureImmersive()
        fitViewport()
    }

    override fun onResume() {
        super.onResume()
        configureImmersive()
        syncConfigToPage()
    }

    override fun onStop() {
        if (::webView.isInitialized && VtConfig.getBoolean("pause_on_blur")) {
            runCatching {
                webView.evaluateJavascript(
                    "(()=>{try{var p=document.querySelector('.html5-video-player');if(p&&p.pauseVideo)p.pauseVideo();}catch(_){}})();",
                    null
                )
            }
        }
        super.onStop()
    }

    override fun onBackPressed() {
        if (customView != null) {
            webView.webChromeClient?.onHideCustomView()
        } else if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
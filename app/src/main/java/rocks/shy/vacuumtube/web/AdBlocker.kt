package rocks.shy.vacuumtube.web

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import rocks.shy.vacuumtube.VtConfig
import java.io.ByteArrayInputStream

/**
 * Native ad-blocking layer. Complements the in-page (JS) ad filtering by killing
 * requests to known advertising/tracking hosts at the network layer, mirroring the
 * `csp.withgoogle.com` block in `src/index.js`.
 */
object AdBlocker {

    private val blockedHosts = listOf(
        "csp.withgoogle.com",
        "pagead2.googleadservices.com",
        "pagead2.googlesyndication.com",
        "googleads.g.doubleclick.net",
        "adservice.google.com",
        "ad.doubleclick.net",
        "doubleclick.net",
        "securepubads.g.doubleclick.net",
        "tpc.googlesyndication.com",
        "googleadservices.com",
        "ads.youtube.com",
        "www.googleadservices.com",
        "static.doubleclick.net",
        "cm.g.doubleclick.net",
        "google-analytics.com",
        "googletagmanager.com",
        "googletagservices.com"
    )

    private val blockedSubstrings = listOf(
        "doubleclick",
        "googleadservices",
        "googlesyndication",
        "adservice.google.com"
    )

    fun isBlocked(url: String, request: WebResourceRequest?): Boolean {
        if (!VtConfig.getBoolean("adblock")) return false

        val host = runCatching {
            android.net.Uri.parse(url).host?.lowercase()
        }.getOrNull() ?: return false

        if (blockedHosts.any { it == host }) return true
        if (blockedSubstrings.any { host.contains(it) }) return true

        return false
    }

    /** Empty body response used to swallow blocked requests */
    fun blockedResponse(): WebResourceResponse = WebResourceResponse(
        "text/plain",
        "utf-8",
        200,
        "OK",
        emptyMap(),
        ByteArrayInputStream(ByteArray(0))
    )
}
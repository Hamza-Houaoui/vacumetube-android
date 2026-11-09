package rocks.shy.vacuumtube.web

import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Proxies the main youtube.com/tv document so the Content-Security-Policy can be
 * rewritten, exactly like `onHeadersReceived` in src/index.js does on desktop.
 *
 * Why: YouTube Leanback ships a CSP that forbids inline styles and third-party
 * endpoints. The desktop app rewrites those headers; Android's WebView has no
 * header API, so we fetch the document ourselves and serve a rewritten copy.
 * Cookies are carried back and forth so sign-in keeps working.
 *
 * This is ONLY used for the main-frame document. All other resources load
 * normally through the WebView.
 */
object WebViewProxy {

    private const val MAX_REDIRECTS = 6

    fun fetch(request: WebResourceRequest, userAgent: String): WebResourceResponse? {
        var url = request.url.toString()
        var response: HttpURLConnection? = null

        for (redirect in 0..MAX_REDIRECTS) {
            val connection = prepare(url, request, userAgent) ?: return null

            try {
                connection.connect()
                val code = connection.responseCode

                if (code in 300..399) {
                    val location = connection.getHeaderField("Location") ?: break
                    commitCookies(connection, url)

                    val resolved = URL(URL(url), location).toString()
                    url = resolved
                    response = connection
                    continue
                }

                val input = payload(connection)
                    ?: return null

                val headers = buildHeaders(connection)
                commitCookies(connection, url)

                return WebResourceResponse(
                    mimeType(connection),
                    encoding(connection),
                    code,
                    reason(connection),
                    headers,
                    CloseShield(input, connection)
                )
            } catch (e: Exception) {
                try { connection.disconnect() } catch (_: Exception) {}
                return null
            }
        }

        try { response?.disconnect() } catch (_: Exception) {}
        return null
    }

    private fun prepare(url: String, request: WebResourceRequest, userAgent: String): HttpURLConnection? {
        val connection = runCatching { URL(url).openConnection() as HttpURLConnection }.getOrNull() ?: return null

        connection.instanceFollowRedirects = true
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.setRequestProperty("Accept-Encoding", "identity")
        connection.setRequestProperty("User-Agent", userAgent)

        request.requestHeaders?.let { headers ->
            val contain = headers["Host"]
            if (!contain.isNullOrEmpty()) connection.setRequestProperty("Host", contain)
            acceptHeader(headers)?.let { connection.setRequestProperty("Accept", it) }
        }

        val cookies = CookieManager.getInstance().getCookie(url)
        if (!cookies.isNullOrEmpty()) {
            connection.setRequestProperty("Cookie", cookies)
        }

        return connection
    }

    private fun acceptHeader(headers: Map<String, String>): String? {
        val accepted = headers["Accept"]
        return accepted?.takeIf { it.isNotBlank() }
    }

    private fun commitCookies(connection: HttpURLConnection, url: String) {
        connection.headerFields?.forEach { (key, values) ->
            if (key?.equals("Set-Cookie", ignoreCase = true) == true) {
                for (value in values) {
                    runCatching { CookieManager.getInstance().setCookie(url, value) }
                }
            }
        }
    }

    private fun payload(connection: HttpURLConnection): InputStream? {
        return runCatching { connection.inputStream }.getOrNull()
    }

    private fun mimeType(connection: HttpURLConnection): String {
        val contentType = connection.getHeaderField("Content-Type") ?: return "text/html"
        return contentType.substringBefore(';').trim()
    }

    private fun encoding(connection: HttpURLConnection): String {
        val contentType = connection.getHeaderField("Content-Type") ?: return "utf-8"
        val idx = contentType.lowercase().indexOf("charset=")
        if (idx == -1) return "utf-8"
        return contentType.substring(idx + "charset=".length).trim().trim('"')
    }

    private fun reason(connection: HttpURLConnection): String {
        return connection.responseMessage ?: "OK"
    }

    private fun buildHeaders(connection: HttpURLConnection): MutableMap<String, String> {
        val headers = mutableMapOf<String, String>()
        var contentType: String? = null

        connection.headerFields?.forEach { (key, values) ->
            if (key == null) return@forEach
            val lower = key.lowercase()

            if (lower == "content-type") {
                contentType = values.joinToString(", ")
                return@forEach
            }
            if (lower == "content-encoding" || lower == "transfer-encoding" || lower == "content-length") {
                return@forEach
            }
            if (lower == "set-cookie") {
                return@forEach
            }

            if (lower == "content-security-policy") {
                headers[key] = values.joinToString("; ") { header ->
                    rewriteCsp(header)
                }
                return@forEach
            }

            headers[key] = values.joinToString(", ")
        }

        contentType?.let { headers["Content-Type"] = it }
        return headers
    }

    /**
     * Mirrors the CSP rewrites in src/index.js: allow trusted-types removal,
     * unsafe-inline styles, data/fonts/connect-sponsor endpoints and dearrow imgs.
     */
    private fun rewriteCsp(header: String): String {
        var result = header

        result = result.replace(Regex("require-trusted-types-for\\s+'script';?\\s*"), "")

        result = result.replace(Regex("style-src\\s([^;]*)")) { match ->
            val existing = match.groupValues[1]
            val withoutNonces = existing.replace(Regex("'nonce-[^']*'"), "").trim()
            "style-src $withoutNonces 'unsafe-inline' data: *"
        }

        result = result.replace(Regex("font-src\\s([^;]*)")) { match ->
            val existing = match.groupValues[1]
            "font-src $existing * data:"
        }

        result = result.replace(Regex("connect-src\\s([^;]*)")) { match ->
            val existing = match.groupValues[1]
            "connect-src $existing sponsor.ajay.app dearrow.ajay.app dearrow-thumb.ajay.app returnyoutubedislikeapi.com data:"
        }

        result = result.replace(Regex("img-src\\s([^;]*)")) { match ->
            val existing = match.groupValues[1]
            "img-src $existing dearrow-thumb.ajay.app data:"
        }

        return result
    }

    /** Wraps the stream so closing it also disconnects the underlying connection. */
    private class CloseShield(
        private val wrapped: InputStream,
        private val connection: HttpURLConnection
    ) : InputStream() {
        override fun read(): Int = wrapped.read()

        override fun read(b: ByteArray, off: Int, len: Int): Int = wrapped.read(b, off, len)

        override fun close() {
            wrapped.close()
            try { connection.disconnect() } catch (_: Exception) {}
        }
    }
}
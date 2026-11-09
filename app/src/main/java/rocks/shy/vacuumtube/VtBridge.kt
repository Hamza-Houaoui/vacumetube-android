package rocks.shy.vacuumtube

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.webkit.JavascriptInterface
import org.json.JSONArray

/**
 * JavaScript bridge exposed to the injected VacuumTube web layer.
 * Mirrors the IPC surface the desktop preload uses: config, userstyles and
 * native actions (open settings, clipboard).
 */
class VtBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun getConfig(): String = VtConfig.toJson().toString()

    @JavascriptInterface
    fun openSettings() {
        activity.runOnUiThread {
            val intent = Intent(activity, SettingsActivity::class.java)
            activity.startActivity(intent)
        }
    }

    @JavascriptInterface
    fun getUserstyles(): String {
        val styles = UserstyleStore.load()
        val arr = JSONArray()
        for (style in styles) {
            val obj = org.json.JSONObject()
            obj.put("filename", style.filename)
            obj.put("css", style.css)
            arr.put(obj)
        }
        return arr.toString()
    }

    @JavascriptInterface
    fun copyToClipboard(text: String) {
        val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("VacuumTube", text))
    }

    @JavascriptInterface
    fun requestPause() {
        // Windows/TV "pause on blur" equivalent is handled by the OS automatically;
        // on Android the page pauses itself via lifecycle. Kept for parity.
    }

    @JavascriptInterface
    fun setVolume(value: Int) {
        VtConfig.setInt("volume", value.coerceIn(0, 100))
    }

    @JavascriptInterface
    fun setConfig(jsonText: String) {
        runCatching {
            val json = org.json.JSONObject(jsonText)
            for ((key, value) in json.toMapAsPreferred()) {
                when (value) {
                    is Boolean -> VtConfig.setBoolean(key, value)
                    is Int -> VtConfig.setInt(key, value)
                    is Double -> VtConfig.setInt(key, value.toInt())
                    is String -> VtConfig.setString(key, value)
                    else -> {}
                }
            }
        }
        activity.runOnUiThread { activity.syncConfigToPage() }
    }

    @JavascriptInterface
    fun exitApp() {
        activity.runOnUiThread { activity.finishAndRemoveTask() }
    }
}

private fun org.json.JSONObject.toMapAsPreferred(): Map<String, Any?> {
    val result = mutableMapOf<String, Any?>()
    val keys = this.keys()
    while (keys.hasNext()) {
        val key = keys.next()
        result[key] = if (isNull(key)) null else {
            when (val v = get(key)) {
                is Int -> v
                is Boolean -> v
                is Double -> v
                is Long -> v
                is String -> v
                else -> v.toString()
            }
        }
    }
    return result
}